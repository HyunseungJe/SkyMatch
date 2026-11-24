"""Report figure: real photos next to the sky the model estimated from each (needs EGL).

    python ml/experiments/bench-2026-11-24/examples.py --real <real-v1> --run <run dir> --out <dir>

The six CC0 photos of docs/images/photo-vs-ml.jpg (docs/images/CREDITS.md), found in the
real-photo set by their Commons file names. The network does not estimate the camera, so every
sky is rendered with one fixed camera (pitch 10°, vertical fov 55°); parameters the network
does not learn keep the schema default. Writes examples.png and examples.json.
"""
import argparse
import csv
import json
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from skymatch_ml.evaluate import load_model, web_input
from skymatch_ml.render import Renderer
from skymatch_ml.schema import Schema
from skymatch_ml.targets import Targets

KEYS = ['VIBRANT_ASSET_OF_NATURE', 'Orange_hazy_sunset', 'Supercell_059', 'Blake_Richard_Verdoorn',
        'Luxembourg_City_Hall', 'Milky_way_%2B_Perseids']
CAMERA = {'yaw': 0.0, 'pitch': 10.0, 'fov': 55.0}
W, H = 256, 192

ap = argparse.ArgumentParser()
ap.add_argument('--real', type=Path, required=True)
ap.add_argument('--run', type=Path, required=True)
ap.add_argument('--out', type=Path, required=True)
a = ap.parse_args()

rows = list(csv.DictReader((a.real / 'split.csv').open(encoding='utf-8')))
pick = [next(r for r in rows if k.lower() in (r['source_page'] + r['file_url']).lower()) for k in KEYS]
a.out.mkdir(parents=True, exist_ok=True)
targets, schema, dev = Targets(), Schema(), torch.device('cuda')
model, ckpt, _, _ = load_model(a.run, targets, dev)
w, h = ckpt['size']
with torch.no_grad():
    reg, logits = model(torch.from_numpy(np.stack([web_input(a.real / r['file'], w, h) for r in pick])).to(dev))
tiles, info = [], []
with Renderer('egl') as ren:
    for r, t, l in zip(pick, reg.float().cpu().numpy(), logits.float().cpu().numpy()):
        th = targets.decode(t, l)
        p = {**schema.default_params(), **{k: int(v[1:], 16) if isinstance(v, str) else v for k, v in th.items()}}
        photo = (web_input(a.real / r['file'], W, H).transpose(1, 2, 0) * 255).round().astype(np.uint8)
        tiles.append((photo, ren.render(p, CAMERA, W, H)))
        info.append({'id': r['id'], 'split': r['split'], 'author': r['author'], 'licence': r['licence'],
                     'source_page': r['source_page'], 'theta': th})
gap, pad = 6, 14
sheet = Image.new('RGB', (3 * (2 * W + gap) + 2 * pad, 2 * H + gap), 'white')
for i, (photo, sky) in enumerate(tiles):
    x, y = (i % 3) * (2 * W + gap + pad), (i // 3) * (H + gap)
    sheet.paste(Image.fromarray(photo), (x, y))
    sheet.paste(Image.fromarray(sky), (x + W + 2, y))
sheet.save(a.out / 'examples.png')
(a.out / 'examples.json').write_text(json.dumps(info, indent=1, ensure_ascii=False), encoding='utf-8')
