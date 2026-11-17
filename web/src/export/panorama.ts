// Bakes the current sky to an equirect OpenEXR panorama for Blender, Unity or Godot.
import * as THREE from 'three';
import { panoramaFragmentShader, vertexShader } from '../sky/skyShader';
import type { SkyView } from '../sky/SkyView';
import { ExrWriter } from './exr';

/**
 * Where north sits in each tool's panorama (u = column / width). Checked by rendering in each tool:
 * Blender World Environment Texture and Unity Skybox/Panoramic read the same file; Godot's
 * PanoramaSkyMaterial is turned a further quarter. Value = azimuth offset added to the web u.
 */
export const PANORAMA_TARGETS = {
  'blender-unity': { label: 'Blender · Unity', uShift: 0.25 },
  godot: { label: 'Godot', uShift: 0.5 },
} as const;
export type PanoramaTarget = keyof typeof PANORAMA_TARGETS;

const TILE_W = 2048;
const TILE_H = 256; // one strip of rows per readback; small draws keep every GPU call short

export async function bakePanorama(
  view: SkyView,
  target: PanoramaTarget,
  width: number,
  onProgress: (fraction: number) => void,
): Promise<Blob> {
  const height = width / 2;
  const renderer = view.renderer;
  if (!renderer.extensions.has('EXT_color_buffer_float')) throw new Error('이 브라우저는 float 렌더 타깃을 지원하지 않습니다.');

  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader: panoramaFragmentShader,
    uniforms: {
      ...view.skyUniforms(),
      u_panoSize: { value: new THREE.Vector2(width, height) },
      u_tileOffset: { value: new THREE.Vector2() },
      u_uShift: { value: PANORAMA_TARGETS[target].uShift },
    },
    depthTest: false,
    depthWrite: false,
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const tile = new THREE.WebGLRenderTarget(TILE_W, TILE_H, { type: THREE.FloatType, depthBuffer: false });
  const tilePixels = new Float32Array(TILE_W * TILE_H * 4);
  const strip = new Float32Array(width * TILE_H * 4);
  const writer = new ExrWriter(width, height);

  try {
    const strips = Math.ceil(height / TILE_H);
    for (let s = 0; s < strips; s++) {
      // Strips run top to bottom; the render target's row 0 is the strip's bottom row.
      const rows = Math.min(TILE_H, height - s * TILE_H);
      const bottom = height - s * TILE_H - rows;
      for (let x0 = 0; x0 < width; x0 += TILE_W) {
        const cols = Math.min(TILE_W, width - x0);
        (material.uniforms.u_tileOffset.value as THREE.Vector2).set(x0, bottom);
        renderer.setRenderTarget(tile);
        renderer.render(scene, camera);
        renderer.readRenderTargetPixels(tile, 0, 0, cols, rows, tilePixels);
        for (let r = 0; r < rows; r++) {
          const src = tilePixels.subarray((rows - 1 - r) * cols * 4, (rows - r) * cols * 4);
          strip.set(src, (r * width + x0) * 4);
        }
      }
      renderer.setRenderTarget(null);
      writer.addRows(strip, rows);
      onProgress((s + 1) / strips);
      await new Promise((resolve) => setTimeout(resolve, 0)); // keep the page responsive
    }
    return writer.finish();
  } finally {
    renderer.setRenderTarget(null);
    tile.dispose();
    geometry.dispose();
    material.dispose();
  }
}
