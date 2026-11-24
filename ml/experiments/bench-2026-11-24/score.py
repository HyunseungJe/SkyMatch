"""CMA-ES vs ML, step 3: parameter error of both methods on the same images, with the metric
definitions of train.evaluate (masked by each label's active flags), plus the CMA-ES time.

    python ml/experiments/bench-2026-11-24/score.py --bench <bench dir> --out <json>
"""
import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from skymatch_ml.targets import Targets

ap = argparse.ArgumentParser()
ap.add_argument('--bench', type=Path, required=True)
ap.add_argument('--out', type=Path, required=True)
a = ap.parse_args()

read = lambda name: json.loads((a.bench / name).read_text(encoding='utf-8'))
labels = [json.loads(l) for l in (a.bench / 'labels.jsonl').read_text(encoding='utf-8').splitlines()]
T = Targets()
hexc = lambda v: v if isinstance(v, str) else f'#{int(v):06x}'
ALL = {n: True for n, *_ in T.items} | {T.class_name: True}


def score(preds):
    err, cnt = np.zeros(T.n_regress), np.zeros(T.n_regress)
    ok = tot = 0
    for lab, p in zip(labels, preds):
        q = {n: hexc(p[n]) if k == 'color' else float(p[n]) for n, k, *_ in T.items}
        q[T.class_name] = int(round(p[T.class_name]))
        tp, _, cp, _ = T.encode(q, ALL)
        tl, m, cl, ca = T.encode(lab['params'], lab['active'])
        err += np.abs(np.clip(tp, 0, 1) - tl) * m
        cnt += m
        ok += (cp == cl) * ca
        tot += ca
    mae = err / np.maximum(cnt, 1)
    out = {}
    for n, k, col, w in T.items:
        d = T.schema.params[n]
        out[n] = round(float(mae[col:col + 3].mean() * 255), 2) if k == 'color' else \
            round(float(mae[col] * (math.log(d['max']) - math.log(d['min']))), 4) if k == 'log' else \
            round(float(mae[col] * (d['max'] - d['min'])), 4)
    out['nightEffect_acc'] = round(ok / max(1, tot), 4)
    out['mean_normalised_error'] = round(float(err.sum() / cnt.sum()), 4)
    return out


cma, cma_cam = read('cmaes_pred.json'), read('cmaes_cam_pred.json')
res = {'n': len(labels), 'night_effect_active': int(sum(l['active']['nightEffect'] for l in labels)),
       'ml': score(read('ml_pred.json')),
       'cmaes': score([r['theta'] for r in cma]),
       'cmaes_true_camera': score([r['theta'] for r in cma_cam]),
       'cmaes_ms_median': round(float(np.median([r['ms'] for r in cma]))),
       'cmaes_true_camera_ms_median': round(float(np.median([r['ms'] for r in cma_cam]))),
       'cmaes_renders_median': int(np.median([r['renders'] for r in cma]))}
a.out.write_text(json.dumps(res, indent=1), encoding='utf-8')
print(json.dumps(res, indent=1))
