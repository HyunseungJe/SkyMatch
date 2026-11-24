"""CMA-ES vs ML, step 4: how close the re-rendered sky looks to the original.

    python ml/experiments/bench-2026-11-24/look.py --bench <bench dir> --out <json>   (needs EGL)

Each method's estimated parameters (the 15 learned ones) are rendered with the image's TRUE camera
and the label's values for everything else, at 256x192, and compared with the original image:
SSIM (7x7 uniform window on luma, standard constants) and mean |Δ| per channel (0..255).
Sanity check first: re-rendering the true θ must give SSIM 1.
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from skymatch_ml.render import Renderer
from skymatch_ml.schema import Schema

LEARNED = ('sunElevation', 'zenithColor', 'horizonColor', 'sunGlowColor', 'haze', 'cloudCover', 'cloudDensity',
           'cloudScale', 'cloudSoftness', 'storm', 'stars', 'nightEffect', 'milkyWayBrightness', 'auroraIntensity',
           'auroraHue')

ap = argparse.ArgumentParser()
ap.add_argument('--bench', type=Path, required=True)
ap.add_argument('--out', type=Path, required=True)
a = ap.parse_args()

schema = Schema()
labels = [json.loads(l) for l in (a.bench / 'labels.jsonl').read_text(encoding='utf-8').splitlines()]
imgs = [np.asarray(Image.open(a.bench / 'images' / f'{i:04d}.png').convert('RGB')) for i in range(len(labels))]
num = lambda v: int(v[1:], 16) if isinstance(v, str) else v


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


read = lambda name: json.loads((a.bench / name).read_text(encoding='utf-8'))
methods = {'ml': read('ml_pred.json'),
           'cmaes': [r['theta'] for r in read('cmaes_pred.json')],
           'cmaes_true_camera': [r['theta'] for r in read('cmaes_cam_pred.json')]}
out = {'definition': __doc__}
with Renderer('egl') as ren:
    out['true_theta_ssim'] = round(float(np.mean([ssim(ren.render(true_theta(l), l['camera'], 256, 192), im)
                                                  for l, im in zip(labels[:10], imgs[:10])])), 4)
    for name, preds in methods.items():
        s, d = [], []
        for lab, pred, im in zip(labels, preds, imgs):
            r = ren.render(estimated_theta(lab, pred), lab['camera'], 256, 192)
            s.append(ssim(r, im))
            d.append(float(np.abs(r.astype(int) - im.astype(int)).mean()))
        out[name] = {'ssim_mean': round(float(np.mean(s)), 4), 'ssim_ge_0.9': round(float(np.mean(np.array(s) >= 0.9)), 3),
                     'abs_diff_mean': round(float(np.mean(d)), 2)}
        print(name, out[name])
a.out.write_text(json.dumps(out, indent=1), encoding='utf-8')
