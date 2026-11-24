"""Evaluate a training run on the synthetic test split and on the real-photo dev split.

    python -m skymatch_ml.evaluate --run <run dir> --data <dataset dir> --real <real photo set dir>

1. Synthetic test: best.pt on the whole `test` split with train.evaluate() (no augmentation).
2. Real dev: every photo with split == dev in <real>/split.csv (the test split is read only with
   --real-split test, the single final evaluation of the chosen model -> eval-test.json),
   pre-processed like the web app (web/src/match/image.ts loadPhoto + mlEstimate.ts modelInput):
   EXIF orientation -> longest side at most 1024 -> centre crop to the model's 4:3 -> area
   (box) resize to the run's input size -> sRGB [0, 1]. Inference in float32 like the web.
   Per photo -> real-dev.jsonl (id, time of day, decoded θ subset, night effect + probabilities).
3. Real dev metrics per time_of_day: median sun elevation, share seen as night (< -6°), share
   seen at >= 10°, night effect distribution of the night photos seen as night, and the two key
   numbers: night photos seen as night, day photos seen as night.
Everything goes to <run>/eval.json.
"""
from __future__ import annotations

import argparse
import csv
import json
import time
from collections import Counter
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageOps

from .targets import Targets
from .train import SkyNet, evaluate, load_split, param_weights, to_device

NIGHT = -6.0
HIGH = 10.0
TIMES = ('day', 'low-sun', 'twilight', 'night', 'unknown')


def web_input(path: Path, w: int, h: int) -> np.ndarray:
    """Photo -> float32 [3, h, w] in [0, 1], like the web app."""
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert('RGB')
        im.thumbnail((1024, 1024), Image.LANCZOS)
        pw, ph = im.size
        cw, ch = pw, ph
        if cw / ch > w / h:
            cw = round(ch * w / h)
        else:
            ch = round(cw * h / w)
        x0, y0 = (pw - cw) // 2, (ph - ch) // 2
        im = im.crop((x0, y0, x0 + cw, y0 + ch)).resize((w, h), Image.BOX)
        return (np.asarray(im, np.float32) / 255).transpose(2, 0, 1)


def load_model(run: Path, targets: Targets, dev):
    ckpt = torch.load(run / 'best.pt', map_location='cpu')
    run_json = json.loads((run / 'run.json').read_text(encoding='utf-8'))
    arch = ckpt.get('arch') or run_json.get('arch') or run_json['args'].get('arch') or 'resnet18'
    model = SkyNet(targets.n_regress, targets.n_classes, pretrained=False, arch=arch)
    model.load_state_dict(ckpt['model'])
    return model.to(dev).eval(), ckpt, run_json, arch


def real_dev(model, targets: Targets, real: Path, size, dev, split: str = 'dev') -> tuple[list[dict], dict]:
    w, h = size
    rows = [r for r in csv.DictReader((real / 'split.csv').open(encoding='utf-8')) if r['split'] == split]
    out = []
    for s in range(0, len(rows), 64):
        chunk = rows[s:s + 64]
        x = torch.from_numpy(np.stack([web_input(real / r['file'], w, h) for r in chunk])).to(dev)
        with torch.no_grad():
            reg, logits = model(x)
        reg, prob = reg.float().cpu().numpy(), torch.softmax(logits.float(), 1).cpu().numpy()
        for r, t, p in zip(chunk, reg, prob):
            th = targets.decode(t, p)
            out.append({'id': r['id'], 'time_of_day': r['time_of_day'],
                        'sunElevation': round(th['sunElevation'], 3), 'zenithColor': th['zenithColor'],
                        'horizonColor': th['horizonColor'], 'sunGlowColor': th['sunGlowColor'],
                        'cloudCover': round(th['cloudCover'], 4), 'haze': round(th['haze'], 4),
                        'nightEffect': th['nightEffect'], 'nightEffect_prob': [round(float(v), 4) for v in p]})
    by = {}
    for tod in TIMES:
        sel = [o for o in out if o['time_of_day'] == tod]
        if not sel:
            continue
        el = np.array([o['sunElevation'] for o in sel])
        night = [o for o in sel if o['sunElevation'] < NIGHT]
        by[tod] = {'n': len(sel), 'median_sun_elevation': round(float(np.median(el)), 2),
                   'seen_as_night': len(night), 'seen_as_night_frac': round(len(night) / len(sel), 4),
                   'seen_high_frac': round(float((el >= HIGH).mean()), 4),
                   'night_effect_when_seen_as_night': {k: v for k, v in sorted(
                       Counter(('none', 'milkyWay', 'aurora')[o['nightEffect']] for o in night).items())}}
    key = {'night_as_night': by.get('night', {}).get('seen_as_night', 0), 'night_n': by.get('night', {}).get('n', 0),
           'day_as_night': by.get('day', {}).get('seen_as_night', 0), 'day_n': by.get('day', {}).get('n', 0)}
    key['night_as_night_frac'] = round(key['night_as_night'] / max(1, key['night_n']), 4)
    key['day_as_night_frac'] = round(key['day_as_night'] / max(1, key['day_n']), 4)
    return out, {'n': len(out), 'key': key, 'by_time_of_day': by}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--run', type=Path, required=True)
    ap.add_argument('--data', type=Path, required=True)
    ap.add_argument('--real', type=Path, required=True)
    ap.add_argument('--real-split', choices=['dev', 'test'], default='dev',
                    help='test = the one final evaluation of the chosen model; writes eval-test.json / real-test.jsonl')
    a = ap.parse_args()
    tag = a.real_split
    t0 = time.time()
    dev = torch.device('cuda')
    targets = Targets()
    model, ckpt, run_json, arch = load_model(a.run, targets, dev)
    size = tuple(ckpt['size'])

    test = to_device(load_split(a.data, 'test', size, targets, None), dev)
    synth = evaluate(model, test, targets, param_weights(targets, dev), 1024)
    model.eval()  # evaluate() leaves the model in train mode
    del test
    torch.cuda.empty_cache()
    print('synthetic test:', json.dumps(synth['mae']), flush=True)

    rows, real = real_dev(model, targets, a.real, size, dev)
    with (a.run / 'real-dev.jsonl').open('w', encoding='utf-8') as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')
    print('real dev:', json.dumps(real['key']), flush=True)

    log = [json.loads(l) for l in (a.run / 'log.jsonl').read_text(encoding='utf-8').splitlines() if l.strip()]
    onnx = a.run / 'model.onnx'
    result = {
        'run': a.run.name, 'arch': arch, 'args': run_json.get('args'), 'git': run_json.get('git'),
        'augment': run_json.get('augment', ['silhouette']),
        'size': list(size), 'best_epoch': ckpt['epoch'], 'epochs_logged': len(log),
        'train_seconds': round(sum(r['train_seconds'] for r in log), 1),
        'model_onnx_bytes': onnx.stat().st_size if onnx.exists() else None,
        'synthetic_test': {'loss_regress': synth['loss_regress'], 'loss_classify': synth['loss_classify'],
                           'mae': synth['mae']},
        f'real_{tag}': real,
        'eval_seconds': round(time.time() - t0, 1),
    }
    out = a.run / ('eval.json' if tag == 'dev' else f'eval-{tag}.json')
    out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f'-> {out}', flush=True)


if __name__ == '__main__':
    main()
