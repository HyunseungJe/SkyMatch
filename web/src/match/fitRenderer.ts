// Small off-screen sky renders for fitting: the same shader and display transform as the screen
// (exposure -> AgX), no dither, read back as 8-bit sRGB rows top-down.
import * as THREE from 'three';
import type { SkyParams } from '../sky/schema';
import { fragmentShader, skyUniforms, vertexShader } from '../sky/skyShader';

export interface FitCamera {
  /** Compass azimuth of the view centre in degrees. */
  yaw: number;
  /** Degrees above the horizon. */
  pitch: number;
  /** Vertical field of view in degrees. */
  fov: number;
}

export class FitRenderer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.RawShaderMaterial;
  private readonly cameraMatrix = new THREE.Matrix3();
  private targets = new Map<string, THREE.WebGLRenderTarget>();
  /** Renders done so far (for budgets and reports). */
  renders = 0;

  constructor(private readonly renderer: THREE.WebGLRenderer, noise: THREE.Texture) {
    const uniforms: Record<string, THREE.IUniform> = {
      iTime: { value: 0 },
      skyV1_noiseTexture: { value: noise },
      u_resolution: { value: new THREE.Vector2(1, 1) },
      u_camera: { value: this.cameraMatrix },
      u_tanHalfFov: { value: 0.5 },
      u_exposure: { value: 1 },
      u_dither: { value: 0 },
    };
    for (const u of skyUniforms) uniforms[u.uniform] = { value: u.type === 'vec3' ? new THREE.Color() : 0 };
    // Same sources as the screen material, so three.js reuses the compiled program (no second compile).
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  /** Renders θ seen through `camera` at `time` seconds; returns RGBA rows top-down. */
  render(theta: SkyParams, camera: FitCamera, time: number, width: number, height: number, exposure = 1): Uint8Array {
    const u = this.material.uniforms;
    for (const s of skyUniforms) {
      const value = theta[s.param];
      if (s.type === 'vec3') (u[s.uniform].value as THREE.Color).setHex(value, THREE.SRGBColorSpace);
      else u[s.uniform].value = s.type === 'int' ? Math.round(value) : value;
    }
    u.iTime.value = time;
    u.u_exposure.value = exposure;
    u.u_tanHalfFov.value = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const yaw = THREE.MathUtils.degToRad(camera.yaw), pitch = THREE.MathUtils.degToRad(camera.pitch);
    const f = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const up = new THREE.Vector3().crossVectors(f, r);
    this.cameraMatrix.set(r.x, up.x, f.x, r.y, up.y, f.y, r.z, up.z, f.z);
    (u.u_resolution.value as THREE.Vector2).set(width, height);

    const key = `${width}x${height}`;
    let target = this.targets.get(key);
    if (!target) {
      target = new THREE.WebGLRenderTarget(width, height, { depthBuffer: false, stencilBuffer: false, type: THREE.UnsignedByteType });
      this.targets.set(key, target);
    }
    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    const raw = new Uint8Array(width * height * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, width, height, raw);
    this.renderer.setRenderTarget(previous);
    this.renders++;
    // GL rows start at the bottom; images start at the top.
    const out = new Uint8Array(raw.length), row = width * 4;
    for (let y = 0; y < height; y++) out.set(raw.subarray((height - 1 - y) * row, (height - y) * row), y * row);
    return out;
  }

  dispose(): void {
    for (const t of this.targets.values()) t.dispose();
    this.targets.clear();
    this.material.dispose();
  }
}
