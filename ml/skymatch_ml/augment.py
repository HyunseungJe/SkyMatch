"""Train-time augmentation (documented in ml/DATASET.md section 7).

Step 1 (default on, --no-silhouette turns it off): a foreground silhouette over the lower part
of the image.
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

Steps 2-4 (off by default, --aug flip,blur,noise), always applied in this order after the
silhouette. Their per-sample values come from the child stream
SeedSequence([aug_seed, epoch, index], spawn_key=(1,)) so the silhouette stream is unchanged,
and all values are drawn whether or not a step is on (turning one on does not move the others):
  flip    p 0.5: mirror left-right (labels unchanged; the sun azimuth is not a target)
  blur    p 0.3: Gaussian blur, sigma U[0.3, 1.0] px at 128x96 (scaled with the width),
          separable kernel of radius ceil(3 x 1.0 px, scaled), reflect padding
  noise   p 0.5: Gaussian noise on sRGB [0, 1], std = s x (1 - 0.7 x luma) with s ~ U[0, 0.04]
          (luma = Rec.709 weights of the pixel before noise; darker pixels get more noise),
          independent per channel, clipped to [0, 1]. The noise field comes from a torch
          Generator seeded with an integer drawn from the sample's stream.
"""
from __future__ import annotations

import math

import numpy as np
import torch
import torch.nn.functional as F

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


# ---- photometric / geometric steps after the silhouette ----------------------------------------

EXTRA = ('flip', 'blur', 'noise')     # application order
P_FLIP = 0.5
P_BLUR = 0.3
BLUR_SIGMA = (0.3, 1.0)               # pixels at REF_WIDTH
REF_WIDTH = 128
P_NOISE = 0.5
NOISE_S = (0.0, 0.04)
NOISE_DARK = 0.7
LUMA = (0.2126, 0.7152, 0.0722)


def parse_extra(text: str | None) -> tuple[str, ...]:
    """'noise,flip' -> ('flip', 'noise'): the steps to turn on, in application order."""
    names = {v.strip() for v in (text or '').split(',') if v.strip()}
    if names - set(EXTRA):
        raise ValueError(f'--aug takes a comma list of {EXTRA}, got {text!r}')
    return tuple(v for v in EXTRA if v in names)


def sample_extra(aug_seed: int, epoch: int, index: int, enabled: tuple[str, ...], width: int):
    """CPU, per sample: dict of the steps to apply, e.g. {'flip': True, 'blur': sigma, 'noise': (s, seed)}."""
    rng = np.random.default_rng(np.random.SeedSequence([aug_seed, epoch, index], spawn_key=(1,)))
    u_flip, u_blur, sigma, u_noise, s = rng.random(5)
    noise_seed = int(rng.integers(0, 2**62))
    out = {}
    if 'flip' in enabled and u_flip < P_FLIP:
        out['flip'] = True
    if 'blur' in enabled and u_blur < P_BLUR:
        out['blur'] = float(BLUR_SIGMA[0] + sigma * (BLUR_SIGMA[1] - BLUR_SIGMA[0])) * width / REF_WIDTH
    if 'noise' in enabled and u_noise < P_NOISE:
        out['noise'] = (float(NOISE_S[0] + s * (NOISE_S[1] - NOISE_S[0])), noise_seed)
    return out


def _blur(x: torch.Tensor, sigmas: list[float]) -> torch.Tensor:
    """x: [n, 3, H, W]; one Gaussian sigma per sample (separable, reflect padding)."""
    n, c, h, w = x.shape
    r = math.ceil(3 * BLUR_SIGMA[1] * w / REF_WIDTH)   # fixed per input size, not per batch
    t = torch.arange(-r, r + 1, device=x.device, dtype=torch.float32)
    sig = torch.tensor(sigmas, device=x.device, dtype=torch.float32)[:, None]
    k = torch.exp(-0.5 * (t[None] / sig) ** 2)
    k = (k / k.sum(1, keepdim=True)).repeat_interleave(c, 0)                  # [n*3, 2r+1]
    y = x.reshape(1, n * c, h, w)
    y = F.conv2d(F.pad(y, (r, r, 0, 0), mode='reflect'), k[:, None, None, :], groups=n * c)
    y = F.conv2d(F.pad(y, (0, 0, r, r), mode='reflect'), k[:, None, :, None], groups=n * c)
    return y.reshape(n, c, h, w)


_noise_gen: dict = {}


def apply_extra(images: torch.Tensor, extra: list[dict]) -> torch.Tensor:
    """images: float [B, 3, H, W] in [0, 1]. extra: per sample, from sample_extra."""
    dev = images.device
    sel = [i for i, e in enumerate(extra) if 'flip' in e]
    if sel:
        t = torch.tensor(sel, device=dev)
        images[t] = images[t].flip(3)
    sel = [i for i, e in enumerate(extra) if 'blur' in e]
    if sel:
        t = torch.tensor(sel, device=dev)
        images[t] = _blur(images[t], [extra[i]['blur'] for i in sel])
    sel = [i for i, e in enumerate(extra) if 'noise' in e]
    if sel:
        _, c, h, w = images.shape
        gen = _noise_gen.get(dev)
        if gen is None:
            gen = _noise_gen[dev] = torch.Generator(device=dev)
        z = torch.empty(len(sel), c, h, w, device=dev)
        for j, i in enumerate(sel):
            gen.manual_seed(extra[i]['noise'][1])
            z[j] = torch.randn(c, h, w, generator=gen, device=dev)
        t = torch.tensor(sel, device=dev)
        sub = images[t]
        luma = (sub * torch.tensor(LUMA, device=dev).view(1, 3, 1, 1)).sum(1, keepdim=True)
        s = torch.tensor([float(extra[i]['noise'][0]) for i in sel], device=dev, dtype=torch.float32).view(-1, 1, 1, 1)
        images[t] = (sub + z * s * (1 - NOISE_DARK * luma)).clamp_(0, 1)
    return images
