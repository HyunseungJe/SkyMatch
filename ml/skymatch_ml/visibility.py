"""Is a sample's night effect visible in its image? (dataset label rule, ml/DATASET.md section 6.1)

The night effect (milky way / aurora) is only a learnable label when it leaves a trace in the
image. Sampling can produce effects that leave none: an aurora whose sector lies outside the
view, a milky way with brightness near 0, a band below the frame or under thick cloud.

Rule (parameters from the dataset config, [labels.night_visibility]):
  render the same θ and camera with nightEffect = 0, box-downsample both images to
  measure_size, and take the given percentile of |Δ| over all pixels and channels (8-bit).
  The effect counts as visible when that value >= min_diff.
"""
from __future__ import annotations

import numpy as np


def box_downsample(img: np.ndarray, width: int, height: int) -> np.ndarray:
    """uint8 H×W×3 -> uint8 height×width×3, mean over whole blocks, rounded half up (= train.py cache)."""
    fy, fx = img.shape[0] // height, img.shape[1] // width
    if img.shape[0] != height * fy or img.shape[1] != width * fx:
        raise ValueError('measure size must divide the stored image size')
    b = img.astype(np.uint16).reshape(height, fy, width, fx, 3).sum((1, 3))
    return ((b + fy * fx // 2) // (fy * fx)).astype(np.uint8)


def night_visibility(img: np.ndarray, img_without: np.ndarray, cfg: dict) -> float:
    """Percentile of |Δ| (0..255) between the image and the same image without its night effect."""
    w, h = cfg['measure_size']
    a, b = box_downsample(img, w, h), box_downsample(img_without, w, h)
    return float(np.percentile(np.abs(a.astype(np.int16) - b.astype(np.int16)), cfg['percentile']))
