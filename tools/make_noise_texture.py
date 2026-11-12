"""Generate the shared 2D noise texture used by sky shaders (web, Blender, other ports).

Spec (do not change without regenerating every port's copy):
- 256x256, RGBA8, sRGB-free (read as linear data, no color management), wrap = repeat, filter = linear.
- G: white noise from numpy default_rng(20261112).
- R: G sampled at (x + 37, y + 17) mod 256, so one bilinear fetch at uv gives two neighbouring
  z-slices of a 3D value noise when a slice z is laid out at offset z * (37, 17) texels:
  .g = slice z, .r = slice z + 1.
- B: one more independent white-noise channel (free for 2D noise / dithering).
- A: constant 255 (browsers may premultiply alpha when decoding images, which would corrupt RGB).
Usage: uv run tools/make_noise_texture.py [out.png]
"""
# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "pillow"]
# ///
import sys
import numpy as np
from PIL import Image

OFFSET = (37, 17)
rng = np.random.default_rng(20261112)
g = rng.integers(0, 256, (256, 256), dtype=np.uint8)
b = rng.integers(0, 256, (256, 256), dtype=np.uint8)
a = np.full((256, 256), 255, dtype=np.uint8)
# array index is [y, x]; R(x, y) = G(x + 37, y + 17)
r = np.roll(np.roll(g, -OFFSET[0], axis=1), -OFFSET[1], axis=0)
out = sys.argv[1] if len(sys.argv) > 1 else 'sky/textures/noise256.png'
Image.fromarray(np.dstack([r, g, b, a]), 'RGBA').save(out)
assert int(r[0, 0]) == int(g[17, 37])
print('wrote', out)
