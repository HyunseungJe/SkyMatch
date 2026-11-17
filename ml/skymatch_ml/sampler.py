"""Sample one dataset item (θ + camera) from a dataset config, deterministically per index."""
from __future__ import annotations

import math

import numpy as np

from .dist import sample
from .schema import Schema

SPLIT_STREAM = 'SeedSequence([seed, split_id, index])'


def rng_for(seed: int, split_id: int, index: int) -> np.random.Generator:
    return np.random.default_rng(np.random.SeedSequence([seed, split_id, index]))


# ---- OKLab (Björn Ottosson, 2020) <-> linear sRGB -------------------------------------------

def oklch_to_linear_srgb(L: float, C: float, h_deg: float) -> np.ndarray:
    h = math.radians(h_deg)
    a, b = C * math.cos(h), C * math.sin(h)
    l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s_ = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return np.array([4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
                     -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
                     -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_])


def linear_to_packed_srgb(rgb: np.ndarray) -> int:
    rgb = np.clip(rgb, 0, 1)
    enc = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(rgb, 1 / 2.4) - 0.055)
    r, g, b = (int(round(float(c) * 255)) for c in enc)
    return (r << 16) | (g << 8) | b


def oklch_to_packed(L: float, C: float, h: float) -> int:
    """Gamut mapping: keep L and h, reduce chroma (bisection) until the colour fits sRGB."""
    rgb = oklch_to_linear_srgb(L, C, h)
    if np.all(rgb >= -1e-6) and np.all(rgb <= 1 + 1e-6):
        return linear_to_packed_srgb(rgb)
    lo, hi = 0.0, C
    for _ in range(24):
        mid = (lo + hi) / 2
        rgb = oklch_to_linear_srgb(L, mid, h)
        if np.all(rgb >= -1e-6) and np.all(rgb <= 1 + 1e-6):
            lo = mid
        else:
            hi = mid
    return linear_to_packed_srgb(oklch_to_linear_srgb(L, lo, h))


def _u(rng, ab):
    return float(rng.uniform(ab[0], ab[1]))


def sample_colors(cfg: dict, sun_elevation: float, rng: np.random.Generator) -> tuple[dict, str]:
    if rng.random() >= cfg['p_plausible']:
        return {k: int(rng.integers(0, 1 << 24)) for k in ('zenithColor', 'horizonColor', 'sunGlowColor')}, 'random'
    c = cfg['plausible']
    phase = max((p for p in ('day', 'twilight', 'night') if sun_elevation >= c[p]['min_elevation']),
                key=lambda p: c[p]['min_elevation'])
    band = c[phase]
    zL = _u(rng, band['zenith_L'])
    hL = float(np.clip(zL + _u(rng, band['horizon_offset']), 0, 0.98))
    if rng.random() < c['zenith_grey_p']:
        zenith = oklch_to_packed(zL, _u(rng, [0, 0.02]), _u(rng, [0, 360]))
    else:
        zenith = oklch_to_packed(zL, _u(rng, c['zenith_chroma']), _u(rng, c['zenith_hue']))
    ex0, ex1 = c['horizon_hue_excluded']
    h = _u(rng, [0, 360 - (ex1 - ex0)])
    h = h if h < ex0 else h + (ex1 - ex0)  # uniform over the hue circle minus the excluded band
    horizon = oklch_to_packed(hL, _u(rng, c['horizon_chroma']), h)
    if rng.random() < c['glow_none_p']:
        glow = 0
    else:
        gh = _u(rng, c['glow_warm_hue']) if rng.random() < c['glow_warm_p'] else _u(rng, [0, 360])
        glow = oklch_to_packed(_u(rng, c['glow_L']), _u(rng, c['glow_chroma']), gh)
    return {'zenithColor': zenith, 'horizonColor': horizon, 'sunGlowColor': glow}, f'plausible-{phase}'


def sample_item(config: dict, schema: Schema, split_id: int, index: int) -> dict:
    """One item: full numeric θ, camera, active-target flags and the colour mode used."""
    rng = rng_for(config['seed'], split_id, index)
    params = schema.default_params()
    # Fixed order (config order) keeps the stream reproducible.
    for name, spec in config['params'].items():
        params[name] = sample(spec, rng)
    for name, spec in config['nuisance'].items():
        params[name] = sample(spec, rng)
    colors, mode = sample_colors(config['colors'], params['sunElevation'], rng)
    params.update(colors)
    camera = {k: float(sample(spec, rng)) for k, spec in config['camera'].items()}
    for name, d in schema.params.items():  # stay inside the frozen schema ranges
        if 'min' in d and d.get('type') != 'color':
            params[name] = min(max(params[name], d['min']), d['max'])
    return {'split_id': split_id, 'index': index, 'params': params, 'camera': camera,
            'active': schema.active(params), 'color_mode': mode}
