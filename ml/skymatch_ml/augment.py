"""Train-time augmentation (documented in ml/DATASET.md section 7).

Augmentation v1 has ONE step: a foreground silhouette over the lower part of the image.
Real photos show ground, trees or buildings below (and a little above) the horizon; the
renders show the shader's flat ground band there instead. The silhouette hides it.

Per sample, from its own random stream SeedSequence([aug_seed, epoch, index]):
  apply       with probability P_APPLY, only when the horizon is inside the frame or at most
              10 % of the image height below it (otherwise there is no ground to hide)
  top line    horizon row (from camera pitch / fov) minus a lift of U[0, 0.25] x image height,
              so the silhouette may also cover some sky, like trees or roofs do
  profile     K ~ U{2..24} knots of height U[0, 1] x a relief of U[0, 0.3] x image height,
              joined either as steps (buildings, 50 %) or linearly (hills, trees, 50 %),
              plus per-column jitter of U[0, 0.03] x image height (foliage edge)
  colour      one flat colour, each sRGB channel U[0, 1] x a darkness factor U[0.05, 0.6]
              (foregrounds are usually darker than the sky)
Everything below the profile is replaced. The same (seed, epoch, index) gives the same image.
"""
from __future__ import annotations

import math

import numpy as np
import torch

P_APPLY = 0.9
LIFT = (0.0, 0.25)
KNOTS = (2, 24)
RELIEF = (0.0, 0.3)
JITTER = (0.0, 0.03)
DARKNESS = (0.05, 0.6)


def horizon_row(pitch_deg: float, fov_deg: float) -> float:
    """Horizon position as a fraction of image height from the top (pinhole, no roll)."""
    return 0.5 * (1 + math.tan(math.radians(pitch_deg)) / math.tan(math.radians(fov_deg) / 2))


def sample_silhouette(aug_seed: int, epoch: int, index: int, pitch: float, fov: float, width: int):
    """CPU, per sample: (profile[width] as fraction of height from the top, rgb[3]) or None."""
    rng = np.random.default_rng(np.random.SeedSequence([aug_seed, epoch, index]))
    hz = horizon_row(pitch, fov)
    if rng.random() >= P_APPLY or hz > 1.1:
        return None
    top = hz - rng.uniform(*LIFT)
    k = int(rng.integers(KNOTS[0], KNOTS[1] + 1))
    knots = rng.uniform(0, 1, k) * rng.uniform(*RELIEF)
    x = np.linspace(0, 1, width)
    if rng.random() < 0.5:
        bump = knots[np.minimum((x * k).astype(int), k - 1)]
    else:
        bump = np.interp(x, np.linspace(0, 1, k), knots)
    profile = top + (np.max(knots) - bump) + rng.uniform(0, 1, width) * rng.uniform(*JITTER)
    rgb = rng.uniform(0, 1, 3) * rng.uniform(*DARKNESS)
    return profile.astype(np.float32), rgb.astype(np.float32)


def apply_silhouettes(images: torch.Tensor, sil: list) -> torch.Tensor:
    """images: float [B, 3, H, W] in [0, 1] on the GPU. sil: per sample (profile, rgb) or None."""
    b, _, h, w = images.shape
    idx = [i for i, s in enumerate(sil) if s is not None]
    if not idx:
        return images
    dev = images.device
    prof = torch.from_numpy(np.stack([sil[i][0] for i in idx])).to(dev)        # [n, W]
    rgb = torch.from_numpy(np.stack([sil[i][1] for i in idx])).to(dev)         # [n, 3]
    rows = (torch.arange(h, device=dev, dtype=torch.float32) + 0.5) / h        # [H]
    mask = rows[None, :, None] >= prof[:, None, :]                             # [n, H, W]
    fill = rgb[:, :, None, None].expand(-1, -1, h, w)
    sel = torch.tensor(idx, device=dev)
    sub = images[sel]
    images[sel] = torch.where(mask[:, None], fill, sub)
    return images
