"""Look-based score for every method on the same synthetic test images (the final report's table).

    python ml/experiments/bench-2026-11-24/look_all.py --bench <bench dir> --data <dataset v2> \
        --run resnet18=<r18 run> --run resnet50=<r50 run> --run final=<r50-aug3 run> --out <json>   (needs EGL)

Same definition as look.py: each method's 15 learned values are rendered with the image's TRUE camera
(label values for everything else) at 256x192 and compared with the original image: SSIM (7x7 window
on luma, standard constants) and mean |difference| per channel (0..255).

Methods: the mean baseline (train-label means; night effect "none"), each --run model (same
128x96 box-downsampled input as training), and CMA-ES from cmaes_pred.json in the bench dir.
"""
import argparse
import glob
import json
import sys
from pathlib import Path

import numpy as np
import torch
from numpy.lib.stride_tricks import sliding_window_view
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from skymatch_ml.evaluate import load_model
from skymatch_ml.render import Renderer
from skymatch_ml.schema import Schema
from skymatch_ml.targets import Targets
from skymatch_ml.visibility import box_downsample

LEARNED = ('sunElevation', 'zenithColor', 'horizonColor', 'sunGlowColor', 'haze', 'cloudCover', 'cloudDensity',
           'cloudScale', 'cloudSoftness', 'storm', 'stars', 'nightEffect', 'milkyWayBrightness', 'auroraIntensity',
           'auroraHue')
COLORS = ('zenithColor', 'horizonColor', 'sunGlowColor')

ap = argparse.ArgumentParser()
ap.add_argument('--bench', type=Path, required=True, help='dir from export.py, with cmaes_pred.json')
ap.add_argument('--data', type=Path, required=True, help='dataset dir (train labels give the mean baseline)')
ap.add_argument('--run', action='append', default=[], help='name=<run dir>, repeatable')
ap.add_argument('--out', type=Path, required=True)
a = ap.parse_args()

schema = Schema()
labels = [json.loads(l) for l in (a.bench / 'labels.jsonl').read_text(encoding='utf-8').splitlines()]
imgs = [np.asarray(Image.open(a.bench / 'images' / f'{i:04d}.png').convert('RGB')) for i in range(len(labels))]
num = lambda v: int(v[1:], 16) if isinstance(v, str) else v


def mean_theta():
    """Mean of each learned value over the train labels (over samples where it is active)."""
    sums = {k: 0.0 for k in LEARNED if k not in COLORS and k != 'nightEffect'}
    cnt = dict.fromkeys(sums, 0)
    csum = {k: np.zeros(3) for k in COLORS}
    n = 0
    for f in sorted(glob.glob(str(a.data / 'train' / 'labels-*.jsonl'))):
        for line in open(f, encoding='utf-8'):
            lab = json.loads(line)
            p, act = lab['params'], lab.get('active', {})
            for k in sums:
                if act.get(k, True):
                    sums[k] += p[k]
                    cnt[k] += 1
            for k in COLORS:
                v = num(p[k])
                csum[k] += [(v >> 16) & 255, (v >> 8) & 255, v & 255]
            n += 1
    out = {k: sums[k] / max(cnt[k], 1) for k in sums}
    for k in COLORS:
        r, g, b = np.round(csum[k] / n).astype(int)
        out[k] = int(r) << 16 | int(g) << 8 | int(b)
    out['nightEffect'] = 0
    return out


def model_preds(run):
    targets, dev = Targets(), torch.device('cuda')
    model, _, _, _ = load_model(run, targets, dev)
    x = np.stack([box_downsample(im, 128, 96) for im in imgs]).astype(np.float32) / 255
    with torch.no_grad():
        reg, logits = model(torch.from_numpy(x.transpose(0, 3, 1, 2)).to(dev))
    return [targets.decode(t, l) for t, l in zip(reg.float().cpu().numpy(), logits.float().cpu().numpy())]


def true_theta(lab):
    return {**schema.default_params(), **{k: num(v) for k, v in lab['params'].items()}}


def estimated_theta(lab, pred):
    p = true_theta(lab)
    for k in LEARNED:
        v = num(pred[k])
        p[k] = int(round(v)) if k == 'nightEffect' else v
    return p


def ssim(x, y):
    luma = lambda im: im.astype(np.float64) @ [0.299, 0.587, 0.114]
    wx, wy = sliding_window_view(luma(x), (7, 7)), sliding_window_view(luma(y), (7, 7))
    mx, my = wx.mean((-1, -2)), wy.mean((-1, -2))
    vx, vy = wx.var((-1, -2)), wy.var((-1, -2))
    cxy = (wx * wy).mean((-1, -2)) - mx * my
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    return float((((2 * mx * my + c1) * (2 * cxy + c2)) / ((mx ** 2 + my ** 2 + c1) * (vx + vy + c2))).mean())


mt = mean_theta()
methods = {'mean_baseline': [mt] * len(labels)}
for spec in a.run:
    name, run = spec.split('=', 1)
    methods[name] = model_preds(Path(run))
methods['cmaes'] = [r['theta'] for r in json.loads((a.bench / 'cmaes_pred.json').read_text(encoding='utf-8'))]

out = {'definition': __doc__, 'n': len(labels), 'mean_theta': mt}
with Renderer('egl') as ren:
    out['true_theta_ssim_first10'] = round(float(np.mean([ssim(ren.render(true_theta(l), l['camera'], 256, 192), im)
                                                          for l, im in zip(labels[:10], imgs[:10])])), 4)
    for name, preds in methods.items():
        s, d = [], []
        for lab, pred, im in zip(labels, preds, imgs):
            r = ren.render(estimated_theta(lab, pred), lab['camera'], 256, 192)
            s.append(ssim(r, im))
            d.append(float(np.abs(r.astype(int) - im.astype(int)).mean()))
        out[name] = {'ssim_mean': round(float(np.mean(s)), 4), 'ssim_ge_0.9': round(float(np.mean(np.array(s) >= 0.9)), 3),
                     'abs_diff_mean': round(float(np.mean(d)), 2)}
        print(name, out[name], flush=True)
a.out.write_text(json.dumps(out, indent=1), encoding='utf-8')
