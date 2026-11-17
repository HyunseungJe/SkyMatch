"""The distribution forms used in dataset configs (ml/datasets/*.toml). Nothing else is allowed,
so every sampled value can be explained from the config alone."""
from __future__ import annotations

import math

import numpy as np


def sample(spec: dict, rng: np.random.Generator):
    if 'const' in spec:
        return spec['const']
    if 'uniform' in spec:
        a, b = spec['uniform']
        return float(rng.uniform(a, b))
    if 'log_uniform' in spec:
        a, b = spec['log_uniform']
        return float(math.exp(rng.uniform(math.log(a), math.log(b))))
    if 'choice' in spec:
        values = spec['choice']
        return values[int(rng.choice(len(values), p=spec.get('p')))]
    if 'mixture' in spec:
        parts = spec['mixture']
        w = np.array([p['w'] for p in parts], dtype=float)
        part = parts[int(rng.choice(len(parts), p=w / w.sum()))]
        return sample({k: v for k, v in part.items() if k != 'w'}, rng)
    raise ValueError(f'Unknown distribution: {spec}')
