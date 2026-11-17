"""Headless OpenGL renderer of the unchanged sky shader, matching the web photo-fit renderer.

The GLSL is never copied: sky/skyV1.glsl and the web wrapper templates in
web/src/sky/skyShader.ts are read at start-up, exactly as web/src/match/fitRenderer.ts uses them
(exposure 1 -> AgX display transform, no dither, 8-bit sRGB, top-down rows).
Parity with the web renderer was measured on 2026-11-17: 99.96 % of channel values identical,
max difference 5/255 at one cloud-boundary pixel (float rounding in the cloud jitter hash).

Backends: 'wgl' (Windows, hidden context) or 'egl' (Linux, headless, no display needed).
"""
from __future__ import annotations

import hashlib
import math
import re
import sys
from pathlib import Path

import moderngl
import numpy as np
from PIL import Image

from .schema import REPO, Schema


def shader_sources(repo: Path = REPO):
    sky = (repo / 'sky/skyV1.glsl').read_text(encoding='utf-8')
    # Same preprocessing as skyShader.ts: drop uniform initialisers (GLSL ES 3.0 forbids them).
    sky = re.sub(r'^(\s*uniform\s+\w+\s+\w+)\s*=[^;]*;', r'\1;', sky, flags=re.M)
    ts = (repo / 'web/src/sky/skyShader.ts').read_text(encoding='utf-8')

    def extract(name: str) -> str:
        m = re.search(r'export const ' + name + r'\s*=\s*/\* glsl \*/\s*`([\s\S]*?)`;', ts)
        if not m:
            raise ValueError(f'Web shader template changed: {name}')
        body = m[1].replace('${sky}', sky)
        if '${' in body:
            raise ValueError('Unrecognised template expression in skyShader.ts')
        return '#version 330\n' + body  # desktop GL instead of three.js' "#version 300 es"

    uniforms = re.findall(r'^\s*uniform\s+(float|int|vec3)\s+u_sky_(\w+)\s*;', sky, re.M)
    return extract('vertexShader'), extract('fragmentShader'), uniforms


def source_hashes(repo: Path = REPO) -> dict[str, str]:
    files = ['sky/skyV1.glsl', 'sky/sky_schema_v1.json', 'sky/textures/noise256.png', 'web/src/sky/skyShader.ts']
    return {f: hashlib.sha256((repo / f).read_bytes()).hexdigest() for f in files}


def srgb_to_linear(packed: int) -> tuple[float, float, float]:
    # three.js ColorManagement SRGBToLinear, with its exact constants.
    channels = [((int(packed) >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(c * .0773993808 if c < .04045 else (c * .9478672986 + .0521327014) ** 2.4 for c in channels)


class Renderer:
    def __init__(self, backend: str = 'auto', repo: Path = REPO):
        self.repo = Path(repo)
        self.schema = Schema(self.repo / 'sky' / 'sky_schema_v1.json')
        if backend == 'auto':
            backend = 'wgl' if sys.platform == 'win32' else 'egl'
        self.backend = backend
        kwargs = {'require': 330}
        if backend == 'egl':
            kwargs['backend'] = 'egl'
        self.ctx = moderngl.create_standalone_context(**kwargs)
        self.ctx.disable(moderngl.BLEND | moderngl.DEPTH_TEST | moderngl.CULL_FACE)
        vs, fs, self.uniforms = shader_sources(self.repo)
        self.program = self.ctx.program(vertex_shader=vs, fragment_shader=fs)
        self.vbo = self.ctx.buffer(np.array([-1, -1, 0, 3, -1, 0, -1, 3, 0], dtype='f4').tobytes())
        self.vao = self.ctx.vertex_array(self.program, [(self.vbo, '3f', 'position')])
        # Noise texture bytes as-is (web: flipY=false, no colour conversion, no mipmaps, linear, repeat).
        with Image.open(self.repo / 'sky/textures/noise256.png') as im:
            im = im.convert('RGBA')
            self.noise = self.ctx.texture(im.size, 4, im.tobytes(), alignment=1)
        self.noise.filter = (moderngl.LINEAR, moderngl.LINEAR)
        self.noise.repeat_x = self.noise.repeat_y = True
        self._targets: dict[tuple[int, int], moderngl.Framebuffer] = {}

    @property
    def info(self) -> dict:
        return {'backend': self.backend, 'renderer': self.ctx.info['GL_RENDERER'], 'version': self.ctx.info['GL_VERSION']}

    def _target(self, width: int, height: int) -> moderngl.Framebuffer:
        if (width, height) not in self._targets:
            self._targets[(width, height)] = self.ctx.framebuffer([self.ctx.texture((width, height), 4, dtype='f1')])
        return self._targets[(width, height)]

    def render(self, params: dict, camera: dict, width: int, height: int) -> np.ndarray:
        """params: full numeric θ (colours packed 0xRRGGBB, sRGB). camera: yaw/pitch/fov in degrees (fov vertical).

        Returns uint8 H×W×3, top row first. θ.exposure is ignored (always 1, as in photo fitting);
        θ.time drives cloud motion / aurora flow / star twinkle.
        """
        p = self.program
        for typ, name in self.uniforms:
            key = 'u_sky_' + name
            if key in p:
                v = params[name]
                p[key].value = srgb_to_linear(v) if typ == 'vec3' else math.floor(v + .5) if typ == 'int' else float(v)
        for key, value in [('iTime', float(params['time'])), ('u_exposure', 1.0), ('u_dither', 0.0),
                           ('skyV1_noiseTexture', 0), ('u_resolution', (width, height)),
                           ('u_tanHalfFov', math.tan(math.radians(camera['fov']) / 2))]:
            if key in p:
                p[key].value = value
        yaw, pitch = math.radians(camera['yaw']), math.radians(camera['pitch'])
        f = (math.sin(yaw) * math.cos(pitch), math.sin(pitch), math.cos(yaw) * math.cos(pitch))
        r = (math.cos(yaw), 0.0, -math.sin(yaw))
        p['u_camera'].write(np.array([r, np.cross(f, r), f], dtype='f4').tobytes())  # rows = matrix columns
        fb = self._target(width, height)
        fb.use()
        self.ctx.viewport = (0, 0, width, height)
        self.noise.use(0)
        self.vao.render(mode=moderngl.TRIANGLES, vertices=3)
        raw = fb.read(components=4, alignment=1)
        return np.frombuffer(raw, np.uint8).reshape(height, width, 4)[::-1, :, :3].copy()

    def close(self) -> None:
        for fb in self._targets.values():
            for a in fb.color_attachments:
                a.release()
            fb.release()
        for obj in (self.vao, self.vbo, self.program, self.noise, self.ctx):
            obj.release()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
