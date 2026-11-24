"""CMA-ES vs ML, step 1: the first N synthetic test images of a dataset as PNG, their labels, and
the model's predictions on them (128x96 box-downsampled input, as in training).

    python ml/experiments/bench-2026-11-24/export.py --data <dataset v2> --run <run dir> --out <bench dir> [--n 200]

Writes <bench dir>/images/NNNN.png, labels.jsonl, ml_pred.json. The test split is sampled i.i.d.,
so its first N images are a random sample.
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from skymatch_ml.evaluate import load_model
from skymatch_ml.targets import Targets
from skymatch_ml.visibility import box_downsample

ap = argparse.ArgumentParser()
ap.add_argument('--data', type=Path, required=True)
ap.add_argument('--run', type=Path, required=True)
ap.add_argument('--out', type=Path, required=True)
ap.add_argument('--n', type=int, default=200)
a = ap.parse_args()

(a.out / 'images').mkdir(parents=True, exist_ok=True)
imgs = np.load(a.data / 'test' / 'images-00000.npy', mmap_mode='r')[:a.n]
lines = (a.data / 'test' / 'labels-00000.jsonl').read_text(encoding='utf-8').splitlines()[:a.n]
labels = [json.loads(l) for l in lines]
assert len(imgs) == len(labels) == a.n
for i, im in enumerate(imgs):
    Image.fromarray(np.asarray(im)).save(a.out / 'images' / f'{i:04d}.png')
(a.out / 'labels.jsonl').write_text('\n'.join(lines) + '\n', encoding='utf-8')

targets, dev = Targets(), torch.device('cuda')
model, _, _, _ = load_model(a.run, targets, dev)
x = np.stack([box_downsample(np.asarray(im), 128, 96) for im in imgs]).astype(np.float32) / 255
with torch.no_grad():
    reg, logits = model(torch.from_numpy(x.transpose(0, 3, 1, 2)).to(dev))
preds = [targets.decode(t, l) for t, l in zip(reg.float().cpu().numpy(), logits.float().cpu().numpy())]
(a.out / 'ml_pred.json').write_text(json.dumps(preds), encoding='utf-8')
print('exported', a.n, 'images; night effect active in', sum(l['active']['nightEffect'] for l in labels))
