"""Mean-value baseline through the SAME loss and metrics as training (train.evaluate).

    python ml/experiments/bench-2026-11-24/baseline_loss.py --data <dataset v2> --out <json>

regress  = per-target mean of the train labels over the samples where the target is active
classify = log of the train class prior (over samples where the night effect is active);
           its argmax is "none", the most common class
"""
import argparse
import json
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from skymatch_ml.targets import Targets
from skymatch_ml.train import evaluate, load_split, param_weights, to_device

ap = argparse.ArgumentParser()
ap.add_argument('--data', type=Path, required=True)
ap.add_argument('--out', type=Path, required=True)
a = ap.parse_args()

dev = torch.device('cuda')
targets = Targets()
size = (128, 96)
tr = load_split(a.data, 'train', size, targets, None)
t, m, c, ca = (torch.as_tensor(tr[k]) for k in ('t', 'm', 'c', 'ca'))
t, m, ca = t.float(), m.float(), ca.float()
mean = (t * m).sum(0) / m.sum(0).clamp_min(1)
prior = torch.stack([(ca * (c == k).float()).sum() for k in range(targets.n_classes)])
prior = prior / prior.sum()
del tr


class Constant(torch.nn.Module):
    def forward(self, x):
        n = x.shape[0]
        return mean.to(x.device).expand(n, -1), prior.log().to(x.device).expand(n, -1)

    def eval(self):
        return self

    def train(self, mode=True):
        return self


out = {'definition': __doc__, 'class_prior': [round(float(p), 4) for p in prior]}
for split in ('val', 'test'):
    d = to_device(load_split(a.data, split, size, targets, None), dev)
    r = evaluate(Constant(), d, targets, param_weights(targets, dev), 1024)
    out[split] = {'loss_regress': r['loss_regress'], 'loss_classify': r['loss_classify'],
                  'loss_total': r['loss_regress'] + r['loss_classify'], 'mae': r['mae']}
    print(split, round(out[split]['loss_total'], 4), json.dumps(r['mae']))
a.out.write_text(json.dumps(out, indent=1), encoding='utf-8')
