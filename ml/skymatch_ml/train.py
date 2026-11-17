"""Train the sky estimator: photo -> θ.

    python -m skymatch_ml.train --data <dataset dir> --out <run dir> [--epochs 10] [--limit N]
        [--arch resnet18|resnet34|resnet50|mobilenet_v3_large] [--no-silhouette] [--aug noise,flip,blur]

Model: a torchvision backbone (default ResNet-18) with ImageNet weights (IMAGENET1K_V1); only its
last classifier layer is replaced by one linear layer giving the regress targets
(skymatch_ml/targets.py) and the nightEffect logits.
Input: sRGB in [0, 1], 4:3, default 128x96; ImageNet normalisation happens inside the model.
Loss (equal weights, nothing else):
  regress   Smooth L1 (beta 0.05) on normalised targets, masked by the `active` labels;
            every parameter weighs 1 (a colour's 3 channels share that weight)
  classify  cross entropy on nightEffect, only where it is active (night)
  total     regress + classify
Augmentation: skymatch_ml/augment.py (seeded per sample and epoch): silhouette (default on), then
the optional --aug steps in the fixed order flip, blur, noise.
Run dir: run.json (args, git, dataset manifest, versions), log.jsonl (per epoch), best.pt,
model.onnx + model.json (web inference), written at the end.
"""
from __future__ import annotations

import argparse
import json
import math
import platform
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision

from .augment import apply_extra, apply_silhouettes, parse_extra, sample_extra, sample_silhouette
from .generate import git_state
from .targets import Targets

IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)
SMOOTH_L1_BETA = 0.05


ARCHS = {  # name -> (constructor, ImageNet weights used)
    'resnet18': (torchvision.models.resnet18, torchvision.models.ResNet18_Weights.IMAGENET1K_V1),
    'resnet34': (torchvision.models.resnet34, torchvision.models.ResNet34_Weights.IMAGENET1K_V1),
    'resnet50': (torchvision.models.resnet50, torchvision.models.ResNet50_Weights.IMAGENET1K_V1),
    'mobilenet_v3_large': (torchvision.models.mobilenet_v3_large, torchvision.models.MobileNet_V3_Large_Weights.IMAGENET1K_V1),
}


def model_description(arch: str, pretrained: bool) -> str:
    return f'torchvision {arch}' + (f' ({ARCHS[arch][1].name})' if pretrained else ' (random init)')


class SkyNet(nn.Module):
    def __init__(self, n_regress: int, n_classes: int, pretrained: bool = True, arch: str = 'resnet18'):
        super().__init__()
        make, weights = ARCHS[arch]
        self.backbone = make(weights=weights if pretrained else None)
        if arch.startswith('resnet'):
            self.backbone.fc = nn.Linear(self.backbone.fc.in_features, n_regress + n_classes)
        else:  # mobilenet_v3: classifier = Linear, Hardswish, Dropout, Linear(1280, 1000)
            last = self.backbone.classifier[-1]
            self.backbone.classifier[-1] = nn.Linear(last.in_features, n_regress + n_classes)
        self.n_regress = n_regress
        self.register_buffer('mean', torch.tensor(IMAGENET_MEAN).view(1, 3, 1, 1))
        self.register_buffer('std', torch.tensor(IMAGENET_STD).view(1, 3, 1, 1))

    def forward(self, x):  # x: sRGB [B, 3, H, W] in [0, 1]
        y = self.backbone((x - self.mean) / self.std)
        return y[:, :self.n_regress], y[:, self.n_regress:]


# ---- data -------------------------------------------------------------------------------------

def load_split(data: Path, split: str, size: tuple[int, int], targets: Targets, limit: int | None):
    """Images downsampled (box filter) to size and cached next to the dataset; labels encoded."""
    w, h = size
    cache = data / 'cache' / f'{split}-{w}x{h}.npy'
    shards = sorted((data / split).glob('images-*.npy'))
    if not cache.exists():
        cache.parent.mkdir(exist_ok=True)
        n = sum(np.load(p, mmap_mode='r').shape[0] for p in shards)
        out = np.lib.format.open_memmap(cache.with_suffix('.tmp.npy'), mode='w+', dtype=np.uint8, shape=(n, h, w, 3))
        i = 0
        for p in shards:
            src = np.load(p, mmap_mode='r')
            fy, fx = src.shape[1] // h, src.shape[2] // w
            assert src.shape[1] == h * fy and src.shape[2] == w * fx, 'size must divide the stored size'
            for s in range(0, len(src), 512):
                blk = src[s:s + 512].astype(np.uint16).reshape(-1, h, fy, w, fx, 3).sum((2, 4))
                out[i:i + len(blk)] = ((blk + fy * fx // 2) // (fy * fx)).astype(np.uint8)
                i += len(blk)
        out.flush()
        del out
        cache.with_suffix('.tmp.npy').replace(cache)
    images = np.load(cache, mmap_mode='r')
    t, m, c, ca, cam = [], [], [], [], []
    for p in sorted((data / split).glob('labels-*.jsonl')):
        for line in p.read_text(encoding='utf-8').splitlines():
            row = json.loads(line)
            a, b, k, ka = targets.encode(row['params'], row['active'])
            t.append(a); m.append(b); c.append(k); ca.append(ka)
            cam.append((row['index'], row['camera']['pitch'], row['camera']['fov']))
    n = len(t) if limit is None else min(limit, len(t))
    return {'images': np.ascontiguousarray(images[:n]), 't': np.stack(t[:n]), 'm': np.stack(m[:n]),
            'c': np.array(c[:n], np.int64), 'ca': np.array(ca[:n], np.float32), 'cam': cam[:n]}


def to_device(d: dict, dev) -> dict:
    return {'images': torch.from_numpy(d['images']).to(dev), 't': torch.from_numpy(d['t']).to(dev),
            'm': torch.from_numpy(d['m']).to(dev), 'c': torch.from_numpy(d['c']).to(dev),
            'ca': torch.from_numpy(d['ca']).to(dev), 'cam': d['cam']}


def batch_images(d, idx, aug_seed=None, epoch=0, silhouette=True, extra=()):
    x = d['images'][idx].permute(0, 3, 1, 2).float().div_(255)
    if aug_seed is not None:
        w = x.shape[3]
        rows = idx.tolist()
        if silhouette:
            sil = [sample_silhouette(aug_seed, epoch, *d['cam'][i], w) for i in rows]
            x = apply_silhouettes(x, sil)
        if extra:
            x = apply_extra(x, [sample_extra(aug_seed, epoch, d['cam'][i][0], extra, w) for i in rows])
    return x.contiguous(memory_format=torch.channels_last)


# ---- loss and metrics -------------------------------------------------------------------------

def param_weights(targets: Targets, dev) -> torch.Tensor:
    """Per output column weight so that each parameter counts once (colour channels share it)."""
    w = torch.zeros(targets.n_regress, device=dev)
    for _, _, col, width in targets.items:
        w[col:col + width] = 1.0 / width
    return w


def losses(reg, logits, t, m, c, ca, pw):
    l1 = F.smooth_l1_loss(reg.float(), t, beta=SMOOTH_L1_BETA, reduction='none')
    wm = m * pw
    reg_loss = (l1 * wm).sum() / wm.sum().clamp_min(1e-6)
    ce = F.cross_entropy(logits.float(), c, reduction='none')
    cls_loss = (ce * ca).sum() / ca.sum().clamp_min(1.0)
    return reg_loss, cls_loss


@torch.no_grad()
def evaluate(model, d, targets: Targets, pw, batch: int) -> dict:
    model.eval()
    n = len(d['t'])
    err_sum = torch.zeros(targets.n_regress, device=d['t'].device)
    cnt = torch.zeros(targets.n_regress, device=d['t'].device)
    reg_l = cls_l = 0.0
    correct = total_c = 0.0
    for s in range(0, n, batch):
        idx = torch.arange(s, min(n, s + batch), device=d['t'].device)
        with torch.autocast('cuda', dtype=torch.bfloat16):
            reg, logits = model(batch_images(d, idx))
        t, m, c, ca = d['t'][idx], d['m'][idx], d['c'][idx], d['ca'][idx]
        rl, cl = losses(reg, logits, t, m, c, ca, pw)
        reg_l += rl.item() * len(idx); cls_l += cl.item() * len(idx)
        err_sum += ((reg.float().clamp(0, 1) - t).abs() * m).sum(0)
        cnt += m.sum(0)
        correct += ((logits.argmax(1) == c).float() * ca).sum().item(); total_c += ca.sum().item()
    mae = (err_sum / cnt.clamp_min(1)).tolist()
    per = {}
    for name, kind, col, width in targets.items:
        if kind == 'color':
            per[name] = round(sum(mae[col:col + 3]) / 3 * 255, 2)          # mean |Δ| per channel, 0..255
        elif kind == 'log':
            d_ = targets.schema.params[name]
            per[name] = round(mae[col] * (math.log(d_['max']) - math.log(d_['min'])), 4)  # |Δ ln v|
        else:
            d_ = targets.schema.params[name]
            per[name] = round(mae[col] * (d_['max'] - d_['min']), 4)        # parameter units
    per[targets.class_name + '_acc'] = round(correct / max(1, total_c), 4)
    model.train()
    return {'loss_regress': reg_l / n, 'loss_classify': cls_l / n, 'mae': per}


# ---- export -----------------------------------------------------------------------------------

def export_onnx(model: SkyNet, targets: Targets, size, out: Path, meta: dict) -> None:
    model = model.float().eval().cpu()
    w, h = size
    dummy = torch.rand(1, 3, h, w)
    torch.onnx.export(model, (dummy,), out / 'model.onnx', input_names=['image'], output_names=['regress', 'logits'],
                      dynamic_axes={'image': {0: 'batch'}, 'regress': {0: 'batch'}, 'logits': {0: 'batch'}},
                      opset_version=17, dynamo=False)
    info = {'format': 'skymatch-model', 'version': 1, 'input': {'name': 'image', 'width': w, 'height': h,
            'layout': 'NCHW', 'encoding': 'sRGB float in [0, 1]; center-crop the photo to 4:3, box-filter resize'},
            'outputs': {'regress': 'normalised targets (see regress[]): clamp to [0, 1] then decode',
                        'logits': 'softmax over classify values'},
            **targets.describe(), **meta}
    (out / 'model.json').write_text(json.dumps(info, indent=2, ensure_ascii=False), encoding='utf-8')


# ---- main -------------------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--data', type=Path, required=True)
    ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--size', default='128x96')
    ap.add_argument('--epochs', type=int, default=10)
    ap.add_argument('--batch', type=int, default=256)
    ap.add_argument('--lr', type=float, default=1e-3)
    ap.add_argument('--weight-decay', type=float, default=1e-4)
    ap.add_argument('--warmup-steps', type=int, default=500)
    ap.add_argument('--seed', type=int, default=0, help='weight init / batch order')
    ap.add_argument('--aug-seed', type=int, default=1)
    ap.add_argument('--no-pretrained', action='store_true')
    ap.add_argument('--limit', type=int, default=None, help='use the first N train images (smoke tests)')
    ap.add_argument('--arch', choices=sorted(ARCHS), default='resnet18')
    ap.add_argument('--no-silhouette', action='store_true', help='turn the silhouette augmentation off')
    ap.add_argument('--aug', default='', help='extra augmentation steps, comma list of flip,blur,noise')
    a = ap.parse_args()
    extra = parse_extra(a.aug)

    size = tuple(int(v) for v in a.size.split('x'))
    a.out.mkdir(parents=True, exist_ok=True)
    torch.manual_seed(a.seed)
    torch.backends.cudnn.benchmark = True
    dev = torch.device('cuda')
    targets = Targets()
    t0 = time.time()
    train = to_device(load_split(a.data, 'train', size, targets, a.limit), dev)
    val = to_device(load_split(a.data, 'val', size, targets, None), dev)
    print(f'data loaded in {time.time() - t0:.0f} s: train {len(train["t"])}, val {len(val["t"])}', flush=True)

    model = SkyNet(targets.n_regress, targets.n_classes, not a.no_pretrained, a.arch).to(dev).to(memory_format=torch.channels_last)
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=a.weight_decay)
    n = len(train['t'])
    steps_per_epoch = n // a.batch
    total = steps_per_epoch * a.epochs
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1, (s + 1) / a.warmup_steps)
                                              * 0.5 * (1 + math.cos(math.pi * min(1, s / total))))
    pw = param_weights(targets, dev)
    dataset_manifest = json.loads((a.data / 'manifest.json').read_text(encoding='utf-8'))
    run = {'args': {k: str(v) if isinstance(v, Path) else v for k, v in vars(a).items()}, 'git': git_state(),
           'dataset': {k: dataset_manifest[k] for k in ('name', 'created', 'config_sha256', 'counts', 'git')},
           'arch': a.arch, 'model': model_description(a.arch, not a.no_pretrained),
           'augment': (['silhouette'] if not a.no_silhouette else []) + list(extra),
           'loss': f'smooth_l1(beta={SMOOTH_L1_BETA}) masked, per-parameter weight 1 + masked cross entropy',
           'versions': {'torch': torch.__version__, 'torchvision': torchvision.__version__,
                        'python': platform.python_version()}, 'gpu': torch.cuda.get_device_name(0)}
    (a.out / 'run.json').write_text(json.dumps(run, indent=2, ensure_ascii=False), encoding='utf-8')
    log = (a.out / 'log.jsonl').open('a', encoding='utf-8')
    gen = torch.Generator(device='cpu').manual_seed(a.seed)
    best = math.inf
    step = 0
    for epoch in range(a.epochs):
        e0 = time.time()
        order = torch.randperm(n, generator=gen).to(dev)
        rl_sum = cl_sum = 0.0
        for s in range(steps_per_epoch):
            idx = order[s * a.batch:(s + 1) * a.batch]
            x = batch_images(train, idx, a.aug_seed, epoch, not a.no_silhouette, extra)
            with torch.autocast('cuda', dtype=torch.bfloat16):
                reg, logits = model(x)
            rl, cl = losses(reg, logits, train['t'][idx], train['m'][idx], train['c'][idx], train['ca'][idx], pw)
            loss = rl + cl
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step(); sched.step(); step += 1
            rl_sum += rl.item(); cl_sum += cl.item()
            if s % 100 == 0:
                print(f'epoch {epoch} step {s}/{steps_per_epoch} reg {rl.item():.4f} cls {cl.item():.4f} '
                      f'({(s + 1) * a.batch / (time.time() - e0):.0f} img/s)', flush=True)
        train_s = time.time() - e0
        ev = evaluate(model, val, targets, pw, 1024)
        rec = {'epoch': epoch, 'train_seconds': round(train_s, 1), 'lr': sched.get_last_lr()[0],
               'train_loss_regress': rl_sum / steps_per_epoch, 'train_loss_classify': cl_sum / steps_per_epoch,
               'val_loss_regress': ev['loss_regress'], 'val_loss_classify': ev['loss_classify'], 'val_mae': ev['mae']}
        log.write(json.dumps(rec) + '\n'); log.flush()
        print(json.dumps(rec), flush=True)
        val_total = ev['loss_regress'] + ev['loss_classify']
        if val_total < best:
            best = val_total
            torch.save({'model': model.state_dict(), 'epoch': epoch, 'val': ev, 'size': size, 'arch': a.arch},
                       a.out / 'best.pt')
    ckpt = torch.load(a.out / 'best.pt', map_location='cpu')
    model.load_state_dict(ckpt['model'])
    export_onnx(model, targets, size, a.out, {'arch': a.arch, 'trained': {'run': a.out.name, 'epoch': ckpt['epoch'],
                'git': run['git'], 'dataset': run['dataset']['name'], 'val_mae': ckpt['val']['mae']}})
    print(f'done -> {a.out}', flush=True)


if __name__ == '__main__':
    main()
