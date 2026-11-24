"""ML time per image on a CPU: ONNX Runtime, one thread (the web app also runs single-threaded).

    python ml/experiments/bench-2026-11-24/ml_time.py --model <model.onnx> --bench <bench dir>

Median of images 5..49 (the first five are warm-up), batch 1, 128x96 box-resized input.
"""
import argparse
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('--model', type=Path, required=True)
ap.add_argument('--bench', type=Path, required=True)
a = ap.parse_args()

opt = ort.SessionOptions()
opt.intra_op_num_threads = 1
sess = ort.InferenceSession(str(a.model), opt, providers=['CPUExecutionProvider'])
times = []
for i in range(50):
    im = Image.open(a.bench / 'images' / f'{i:04d}.png').resize((128, 96), Image.BOX)
    x = (np.asarray(im, np.float32) / 255).transpose(2, 0, 1)[None]
    t0 = time.perf_counter()
    sess.run(None, {'image': x})
    times.append(time.perf_counter() - t0)
print('median ms', round(float(np.median(times[5:])) * 1000, 1))
