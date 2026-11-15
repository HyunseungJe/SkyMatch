// Draws the reference sky full-screen with three.js (WebGL2).
import * as THREE from 'three';
import noiseUrl from '../../../sky/textures/noise256.png?url';
import { defaultParams, type SkyParams } from './schema';
import { fragmentShader, skyUniforms, vertexShader } from './skyShader';

export const VERTICAL_FOV_DEG = 60;

export class SkyView {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.RawShaderMaterial;
  private readonly cameraMatrix = new THREE.Matrix3();
  private shaderError: string | null = null;

  constructor(canvas: HTMLCanvasElement) {
    // The sky is one full-screen shader: MSAA, depth and stencil would only cost time.
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      depth: false,
      stencil: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.debug.onShaderError = (gl, _program, vs, fs) => {
      this.shaderError = [gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)].filter(Boolean).join('\n');
    };

    const uniforms: Record<string, THREE.IUniform> = {
      iTime: { value: 0 },
      skyV1_noiseTexture: { value: null },
      u_resolution: { value: new THREE.Vector2(1, 1) },
      u_camera: { value: this.cameraMatrix },
      u_tanHalfFov: { value: Math.tan(THREE.MathUtils.degToRad(VERTICAL_FOV_DEG) / 2) },
      u_exposure: { value: 1 },
    };
    for (const u of skyUniforms) uniforms[u.uniform] = { value: u.type === 'vec3' ? new THREE.Color() : 0 };

    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });

    // One oversized triangle covers the screen without a diagonal seam.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);

    this.setParams(defaultParams());
    this.setCamera(0, 0);
  }

  /** Loads the noise texture and compiles the shader without blocking the page. */
  async init(): Promise<void> {
    const texture = await new THREE.TextureLoader().loadAsync(noiseUrl);
    // Data texture: PNG row zero stays GL row zero, no colour conversion, no mipmaps.
    texture.flipY = false;
    texture.premultiplyAlpha = false;
    texture.colorSpace = THREE.NoColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    this.material.uniforms.skyV1_noiseTexture.value = texture;

    await this.renderer.compileAsync(this.scene, this.camera);
    if (this.shaderError) throw new Error(this.shaderError);
  }

  setParams(theta: SkyParams): void {
    const uniforms = this.material.uniforms;
    for (const u of skyUniforms) {
      const value = theta[u.param];
      // Colours are sRGB in θ; setHex converts to the linear values the sky expects.
      if (u.type === 'vec3') (uniforms[u.uniform].value as THREE.Color).setHex(value, THREE.SRGBColorSpace);
      else uniforms[u.uniform].value = u.type === 'int' ? Math.round(value) : value;
    }
    uniforms.u_exposure.value = theta.exposure ?? 1;
  }

  setTime(seconds: number): void {
    this.material.uniforms.iTime.value = seconds;
  }

  /**
   * Yaw is a compass azimuth (0 = north = sky +Z, 90 = east = sky +X); pitch is
   * degrees above the horizon.
   */
  setCamera(yawDeg: number, pitchDeg: number): void {
    const yaw = THREE.MathUtils.degToRad(yawDeg);
    const pitch = THREE.MathUtils.degToRad(pitchDeg);
    const forward = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const up = new THREE.Vector3().crossVectors(forward, right);
    this.cameraMatrix.set(right.x, up.x, forward.x, right.y, up.y, forward.y, right.z, up.z, forward.z);
  }

  /** Resizes the drawing buffer to CSS size x devicePixelRatio (render scale is always 1). */
  resize(cssWidth: number, cssHeight: number, pixelRatio: number): void {
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(cssWidth, cssHeight, false);
  }

  render(target: THREE.WebGLRenderTarget | null = null): void {
    const size = this.material.uniforms.u_resolution.value as THREE.Vector2;
    if (target) size.set(target.width, target.height);
    else this.renderer.getDrawingBufferSize(size);
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }
}
