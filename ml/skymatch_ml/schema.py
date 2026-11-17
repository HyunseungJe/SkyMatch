"""The frozen sky schema (sky/sky_schema_v1.json) as seen by the ML pipeline.

Which parameters are learning targets comes from each parameter's `role`; when a target is
visible in the image comes from its `mask` / `activeWhen` condition. Both are read from the
schema file, never restated here, so the dataset and the shader can't drift apart.
"""
from __future__ import annotations

import json
import operator
import re
from functools import cached_property
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCHEMA_PATH = REPO / 'sky' / 'sky_schema_v1.json'

_OPS = {'<': operator.lt, '<=': operator.le, '>': operator.gt, '>=': operator.ge, '==': operator.eq}
_CLAUSE = re.compile(r'^\s*(\w+)\s*(<=|>=|==|<|>)\s*(-?\d+(?:\.\d+)?)\s*$')


def condition(text: str):
    """Parse a schema condition such as `nightEffect == 1 && sunElevation < -6` (no eval)."""
    clauses = []
    for part in text.split('&&'):
        m = _CLAUSE.match(part)
        if not m:
            raise ValueError(f'Unsupported schema condition: {text!r}')
        clauses.append((m[1], _OPS[m[2]], float(m[3])))
    return lambda params: all(op(float(params[name]), value) for name, op, value in clauses)


class Schema:
    def __init__(self, path: Path = SCHEMA_PATH):
        self.path = Path(path)
        self.raw = json.loads(self.path.read_text(encoding='utf-8'))
        self.version = self.raw['version']
        self.params: dict[str, dict] = self.raw['params']

    def default_params(self) -> dict:
        out = {}
        for name, d in self.params.items():
            v = d['default']
            out[name] = int(v[1:], 16) if d.get('type') == 'color' else v
        return out

    @cached_property
    def regress(self) -> list[str]:
        return [n for n, d in self.params.items() if d['role'] == 'regress']

    @cached_property
    def classify(self) -> list[str]:
        return [n for n, d in self.params.items() if d['role'] == 'classify']

    @cached_property
    def _active_rules(self):
        rules = {}
        for name, d in self.params.items():
            if 'mask' in d:  # inactive while the mask condition holds
                masked = condition(d['mask'])
                rules[name] = lambda p, masked=masked: not masked(p)
            elif 'activeWhen' in d:
                rules[name] = condition(d['activeWhen'])
        return rules

    def active(self, params: dict) -> dict[str, bool]:
        """Per target: does it visibly affect the image for these params? (False -> masked in the loss)."""
        rules = self._active_rules
        return {n: bool(rules[n](params)) if n in rules else True for n in self.regress + self.classify}

    def to_json_params(self, params: dict) -> dict:
        """thetaFile.ts-compatible params (colours as #rrggbb)."""
        out = {}
        for name, d in self.params.items():
            v = params[name]
            out[name] = f'#{int(v):06x}' if d.get('type') == 'color' else v
        return out
