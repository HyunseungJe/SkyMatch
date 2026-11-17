"""Learning targets: how θ maps to the network's outputs and back.

Every regress parameter of the schema becomes one *target* in a normalised space where the
schema range is about [0, 1]:
  linear parameter    t = (v - min) / (max - min)
  log-scale parameter t = (ln v - ln min) / (ln max - ln min)
  colour              3 values: sRGB channels / 255
The classify parameter (nightEffect) is a softmax over its values.
The decoding below is the exact inverse; the web app reads the same description from
model.json so both sides decode identically.
"""
from __future__ import annotations

import math

import numpy as np

from .schema import Schema


class Targets:
    def __init__(self, schema: Schema | None = None):
        self.schema = schema or Schema()
        self.items = []  # (name, kind, first output column, width)
        col = 0
        for name in self.schema.regress:
            d = self.schema.params[name]
            kind = 'color' if d.get('type') == 'color' else ('log' if d.get('scale') == 'log' else 'linear')
            width = 3 if kind == 'color' else 1
            self.items.append((name, kind, col, width))
            col += width
        self.n_regress = col
        (self.class_name,) = self.schema.classify
        self.n_classes = len(self.schema.params[self.class_name]['values'])

    def describe(self) -> dict:
        """Written to model.json for the web decoder."""
        out = []
        for name, kind, col, width in self.items:
            d = self.schema.params[name]
            out.append({'name': name, 'kind': kind, 'column': col, 'width': width,
                        **({} if kind == 'color' else {'min': d['min'], 'max': d['max']})})
        return {'regress': out, 'n_regress': self.n_regress,
                'classify': {'name': self.class_name, 'n': self.n_classes}}

    def encode(self, params: dict, active: dict) -> tuple[np.ndarray, np.ndarray, int, bool]:
        """params as in the labels file (colours '#rrggbb'). Returns (t, t_mask, class, class_active)."""
        t = np.zeros(self.n_regress, np.float32)
        m = np.zeros(self.n_regress, np.float32)
        for name, kind, col, width in self.items:
            v = params[name]
            if kind == 'color':
                x = int(v[1:], 16)
                t[col:col + 3] = [(x >> 16 & 255) / 255, (x >> 8 & 255) / 255, (x & 255) / 255]
            else:
                d = self.schema.params[name]
                if kind == 'log':
                    t[col] = (math.log(v) - math.log(d['min'])) / (math.log(d['max']) - math.log(d['min']))
                else:
                    t[col] = (v - d['min']) / (d['max'] - d['min'])
            m[col:col + width] = 1.0 if active[name] else 0.0
        return t, m, int(params[self.class_name]), bool(active[self.class_name])

    def decode(self, t: np.ndarray, logits: np.ndarray) -> dict:
        """Network outputs -> θ params (only the learned ones; colours '#rrggbb'), clamped to the schema."""
        out = {}
        for name, kind, col, width in self.items:
            if kind == 'color':
                r, g, b = (int(round(float(np.clip(c, 0, 1)) * 255)) for c in t[col:col + 3])
                out[name] = f'#{r:02x}{g:02x}{b:02x}'
                continue
            d = self.schema.params[name]
            x = float(np.clip(t[col], 0, 1))
            out[name] = math.exp(math.log(d['min']) + x * (math.log(d['max']) - math.log(d['min']))) \
                if kind == 'log' else d['min'] + x * (d['max'] - d['min'])
        out[self.class_name] = int(np.argmax(logits))
        return out
