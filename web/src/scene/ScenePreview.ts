import * as THREE from 'three';
import { fragmentShader, vertexShader } from '../sky/skyShader';
import type { SkyParams } from '../sky/schema';
import type { SkyView } from '../sky/SkyView';
import { FirstPersonNavigation } from './FirstPersonNavigation';
import { createSceneContext, type BuiltScene } from './sceneContent';
import { defaultSceneId, findScene } from './scenes';

const CUBE_SIZE = 128;
const SETTLE_MS = 250;
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const displayFunctions = fragmentShader.slice(fragmentShader.indexOf('vec3 display_transform'), fragmentShader.lastIndexOf('void main()'));

// The exact sky wrapper, with only its final display conversion removed. The
// two-pixel probe uses this same program, so edits never create shader variants.
// Every edit must match exactly once: if the sky wrapper changes, fail loudly instead of
// silently rendering dither or display transforms into the linear HDR environment.
const linearSky = ([
  // A single return also avoids ANGLE's HLSL uninitialized-return warning when
  // the direction comes from a uniform probe on some Windows GPU drivers.
  ['return max(skyV1_aerial(color,normalize(vec3(rd.x+0.0001,0.0,rd.z)),sun),vec3(0.0));\n  }\n  if',
    'color = skyV1_aerial(color,normalize(vec3(rd.x+0.0001,0.0,rd.z)),sun);\n  } else {\n  if'],
  ['return max(skyV1_aerial(color,rd,sun),vec3(0.0));',
    'color = skyV1_aerial(color,rd,sun);\n  }\n  return max(color,vec3(0.0));'],
  ['out vec4 outColor;', 'uniform bool u_probe;\nuniform vec3 u_sunDirection;\nuniform vec3 u_moonDirection;\nout vec4 outColor;'],
  ['vec3 color = display_transform(skyV1_radiance(rd));', `
  if (u_probe) rd = gl_FragCoord.x < 1.0 ? u_sunDirection : u_moonDirection;
  vec3 color = skyV1_radiance(rd);`],
  ['color + u_dither * display_dither(gl_FragCoord.xy) / 255.0', 'color'],
] as const).reduce((source, [from, to]) => {
  if (source.split(from).length !== 2) throw new Error(`Scene sky wrapper is out of date: ${from.slice(0, 40)}`);
  return source.replace(from, to);
}, fragmentShader.replace(/\r\n/g, '\n'));

/** Reusable sky-lit scene. Call init after SkyView.init; both share one renderer. */
export class ScenePreview {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly cubeScene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
  private readonly screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly screenScene = new THREE.Scene();
  private readonly target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true, samples: 4 });
  private readonly probeTarget = new THREE.WebGLRenderTarget(2, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  private readonly cubeTarget = new THREE.WebGLCubeRenderTarget(CUBE_SIZE, { type: THREE.HalfFloatType, generateMipmaps: false, depthBuffer: false });
  private readonly cubeCamera = new THREE.CubeCamera(0.1, 10, this.cubeTarget);
  private readonly pmrem: THREE.PMREMGenerator;
  private environment: THREE.WebGLCubeRenderTarget | null = null;
  private readonly sun = new THREE.DirectionalLight(0xffffff, 0);
  private readonly moon = new THREE.DirectionalLight(0xffffff, 0);
  private readonly sunDirection = new THREE.Vector3();
  private readonly moonDirection = new THREE.Vector3();
  readonly navigation: FirstPersonNavigation;
  private readonly depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.BackSide });
  private readonly shadowBounds = new THREE.Box3();
  private content: BuiltScene | null = null;
  private loading = false;
  private disposed = false;
  currentSceneId = '';
  private readonly skyMaterial: THREE.RawShaderMaterial;
  private readonly displayMaterial: THREE.RawShaderMaterial;
  private readonly geometry: THREE.BufferGeometry;
  private theta: SkyParams = {};
  private parameterKey = '';
  private refreshAt = Infinity;
  private ready = false;
  private enabled = false;
  private lastRefreshTime = 0;
  /** CPU submission + the single two-pixel lighting readback, updated per IBL refresh. */
  lastIblRefreshMs = 0;
  iblRefreshCount = 0;

  constructor(private readonly sky: SkyView, canvas: HTMLCanvasElement) {
    this.renderer = sky.renderer;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.skyMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader, fragmentShader: linearSky,
      depthTest: false, depthWrite: false,
      uniforms: { ...sky.skyUniforms(), u_resolution: { value: new THREE.Vector2() },
        u_camera: { value: new THREE.Matrix3() }, u_tanHalfFov: { value: 1 }, u_exposure: { value: 1 },
        u_probe: { value: false }, u_sunDirection: { value: this.sunDirection }, u_moonDirection: { value: this.moonDirection } },
    });
    const background = () => {
      const mesh = new THREE.Mesh(this.geometry, this.skyMaterial);
      mesh.frustumCulled = false;
      mesh.renderOrder = -1000;
      mesh.onBeforeRender = (renderer, _scene, camera) => {
        const target = renderer.getRenderTarget();
        const size = this.skyMaterial.uniforms.u_resolution.value as THREE.Vector2;
        if (target) size.set(target.width, target.height);
        else renderer.getDrawingBufferSize(size);
        const m = camera.matrixWorld.elements;
        (this.skyMaterial.uniforms.u_camera.value as THREE.Matrix3).set(m[0], m[4], -m[8], m[1], m[5], -m[9], m[2], m[6], -m[10]);
        this.skyMaterial.uniforms.u_tanHalfFov.value = camera instanceof THREE.PerspectiveCamera ? Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) : 1;
      };
      return mesh;
    };
    this.scene.add(background());
    this.cubeScene.add(background());
    this.displayMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader, depthTest: false, depthWrite: false,
      uniforms: { u_image: { value: this.target.texture }, u_resolution: { value: new THREE.Vector2() }, u_exposure: { value: 1 } },
      fragmentShader: `precision highp float;
        uniform sampler2D u_image; uniform vec2 u_resolution; uniform float u_exposure;
        out vec4 outColor;
        ${displayFunctions}
        void main() {
          vec2 uv = gl_FragCoord.xy / u_resolution;
          // SkyView puts east on screen-right while looking north. Reflect the
          // finished image to match it, preserving normal camera face culling.
          outColor = vec4(display_transform(texture(u_image, vec2(1.0 - uv.x, uv.y)).rgb)
          + display_dither(gl_FragCoord.xy) / 255.0, 1.0); }`,
    });
    const screen = new THREE.Mesh(this.geometry, this.displayMaterial);
    screen.frustumCulled = false;
    this.screenScene.add(screen);
    this.navigation = new FirstPersonNavigation(this.camera, canvas);
    for (const light of [this.sun, this.moon]) {
      light.castShadow = true;
      light.shadow.mapSize.set(1024, 1024);
      light.shadow.normalBias = 0.035; light.shadow.bias = -0.0002;
      this.scene.add(light, light.target);
    }
  }

  /** Build and precompile before releasing the previous content's GPU resources. */
  async setScene(id: string, progress: (text: string) => void = () => {}): Promise<void> {
    if (this.disposed) throw new Error('Scene preview is disposed');
    if (this.loading) throw new Error('A scene is already loading');
    const definition = findScene(id);
    if (definition.id === this.currentSceneId) return;
    this.loading = true; this.navigation.setEnabled(false);
    const previous = this.content;
    let candidate: BuiltScene | null = null;
    try {
      progress('장면을 불러오는 중입니다…');
      candidate = await definition.build(createSceneContext(this.renderer));
      if (this.disposed) throw new Error('Scene preview is disposed');
      candidate.root.traverse((object) => {
        if (object instanceof THREE.Mesh && object.castShadow) object.customDepthMaterial = this.depthMaterial;
      });
      this.scene.add(candidate.root);
      if (previous) previous.root.visible = false;
      progress('장면과 그림자 셰이더를 준비하는 중입니다…');
      await this.compileContent(candidate);
      if (this.disposed) throw new Error('Scene preview is disposed');
      this.content = candidate;
      this.currentSceneId = definition.id;
      this.shadowBounds.copy(candidate.shadowBounds);
      this.navigation.setSpawn(candidate.spawn);
      this.fitShadowCameras();
      this.renderer.shadowMap.needsUpdate = true;
      if (previous) { this.scene.remove(previous.root); previous.dispose(); }
      this.renderer.renderLists.dispose();
    } catch (error) {
      if (candidate) { this.scene.remove(candidate.root); candidate.dispose(); }
      if (previous) previous.root.visible = true;
      throw error;
    } finally {
      this.renderer.setRenderTarget(null);
      this.loading = false; this.navigation.setEnabled(this.enabled && !this.disposed);
    }
  }

  private async compileContent(content: BuiltScene): Promise<void> {
    const depthScene = new THREE.Scene();
    depthScene.add(this.sun.clone(), this.moon.clone());
    content.root.updateMatrixWorld(true);
    content.root.traverse((object) => {
      if (object instanceof THREE.Mesh && object.castShadow) {
        const copy = object.clone(false);
        copy.material = this.depthMaterial;
        copy.matrixAutoUpdate = false; copy.matrix.copy(object.matrixWorld);
        depthScene.add(copy);
      }
    });
    this.renderer.setRenderTarget(this.probeTarget);
    await this.renderer.compileAsync(depthScene, this.sun.shadow.camera);
    await nextTask();
    this.renderer.setRenderTarget(this.target);
    await this.renderer.compileAsync(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    await nextTask();
  }

  private fitShadowCameras(): void {
    if (this.shadowBounds.isEmpty()) return;
    const center = this.shadowBounds.getCenter(new THREE.Vector3());
    const radius = Math.max(1, this.shadowBounds.getSize(new THREE.Vector3()).length() / 2);
    for (const [light, direction] of [[this.sun, this.sunDirection], [this.moon, this.moonDirection]] as const) {
      light.position.copy(center).addScaledVector(direction, radius * 2 + 1);
      light.target.position.copy(center); light.target.updateMatrixWorld(); light.updateMatrixWorld();
      const camera = light.shadow.camera;
      camera.position.copy(light.position); camera.lookAt(center); camera.updateMatrixWorld();
      const bounds = this.shadowBounds.clone().applyMatrix4(camera.matrixWorldInverse);
      const padding = radius * 0.05;
      camera.left = bounds.min.x - padding; camera.right = bounds.max.x + padding;
      camera.bottom = bounds.min.y - padding; camera.top = bounds.max.y + padding;
      camera.near = Math.max(0.1, -bounds.max.z - padding); camera.far = Math.max(camera.near + 1, -bounds.min.z + padding);
      camera.updateProjectionMatrix();
    }
  }

  update(dt: number): void { if (!this.loading) this.navigation.update(dt); }

  private direction(elevation: number, azimuth: number): THREE.Vector3 {
    const e = THREE.MathUtils.degToRad(elevation), a = THREE.MathUtils.degToRad(azimuth);
    return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
  }

  setParams(theta: SkyParams): void {
    this.theta = { ...theta };
    this.sky.setParams(theta);
    this.displayMaterial.uniforms.u_exposure.value = theta.exposure ?? 1;
    // Exposure is a display-only edit and needs no new lighting.
    const key = JSON.stringify(Object.entries(theta).filter(([name]) => name !== 'exposure').sort(([a], [b]) => a.localeCompare(b)));
    if (key !== this.parameterKey) { this.parameterKey = key; this.refreshAt = performance.now() + SETTLE_MS; }
  }

  setTime(seconds: number): void { this.sky.setTime(seconds); }
  setEnabled(on: boolean): void { this.enabled = on; this.navigation.setEnabled(on && !this.loading); }

  /** Compile one family at a time; PMREM's lazy shaders are captured before any draw. */
  async init(progress: (text: string) => void = () => {}, sceneId = defaultSceneId): Promise<void> {
    const previous = this.renderer.debug.onShaderError;
    let shaderError: string | null = null;
    this.renderer.debug.onShaderError = (gl, _program, vs, fs) => {
      shaderError = [gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)].filter(Boolean).join('\n');
    };
    try {
      await this.prepare(progress, sceneId);
      if (shaderError) throw new Error(shaderError);
    } finally { this.renderer.debug.onShaderError = previous; }
  }

  private async prepare(progress: (text: string) => void, sceneId: string): Promise<void> {
    progress('장면의 하늘 셰이더를 준비하는 중입니다…');
    this.renderer.setRenderTarget(this.cubeTarget);
    await this.renderer.compileAsync(this.cubeScene, this.cubeCamera.children[0] as THREE.Camera);
    this.renderer.setRenderTarget(null);
    await nextTask();
    progress('반사와 환경광 셰이더를 준비하는 중입니다…');
    const pending = new Map<THREE.Material, { scene: THREE.Scene; camera: THREE.Camera; target: THREE.WebGLRenderTarget | null }>();
    const render = this.renderer.render;
    // Three's PMREM API has no compileAsync entry point. Capture its draw objects
    // once, then compile those exact programs through the renderer's async API.
    this.renderer.render = (object, camera) => {
      object.traverse((child) => {
        if (!(child instanceof THREE.Mesh) || Array.isArray(child.material) || pending.has(child.material)) return;
        const scene = new THREE.Scene(); scene.add(new THREE.Mesh(child.geometry, child.material));
        pending.set(child.material, { scene, camera, target: this.renderer.getRenderTarget() });
      });
    };
    try { this.environment = this.pmrem.fromCubemap(this.cubeTarget.texture); }
    finally { this.renderer.render = render; this.renderer.setRenderTarget(null); }
    for (const { scene, camera, target } of pending.values()) {
      this.renderer.setRenderTarget(target);
      await this.renderer.compileAsync(scene, camera); await nextTask();
    }
    this.renderer.setRenderTarget(null);
    this.refreshLighting();
    this.scene.environment = this.environment!.texture;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    await this.setScene(sceneId, progress);
    await this.renderer.compileAsync(this.screenScene, this.screenCamera);
    this.ready = true;
  }

  /** A 128px linear HDR cube + reusable PMREM; no allocations or recompiles on edits. */
  refreshLighting(): void {
    const started = performance.now();
    this.sunDirection.copy(this.direction(this.theta.sunElevation, this.theta.sunAzimuth));
    this.moonDirection.copy(this.direction(this.theta.moonElevation, this.theta.moonAzimuth));
    this.cubeCamera.update(this.renderer, this.cubeScene);
    this.environment = this.pmrem.fromCubemap(this.cubeTarget.texture, this.environment ?? undefined);
    this.scene.environment = this.environment.texture;
    // Only at an IBL refresh: two HDR pixels evaluate the sky *at* each disk,
    // including cloud occlusion. Never read pixels in the ordinary frame path.
    this.skyMaterial.uniforms.u_probe.value = true;
    this.renderer.setRenderTarget(this.probeTarget); this.renderer.render(this.cubeScene, this.screenCamera);
    const values = new Uint16Array(8);
    this.renderer.readRenderTargetPixels(this.probeTarget, 0, 0, 2, 1, values);
    this.skyMaterial.uniforms.u_probe.value = false;
    const night = 1 - THREE.MathUtils.smoothstep(this.theta.sunElevation, -8, -3);
    for (const [i, light, direction, elevation, strength] of [
      [0, this.sun, this.sunDirection, this.theta.sunElevation, 0.14 * (1 - night)],
      [1, this.moon, this.moonDirection, this.theta.moonElevation, 0.12 * night * this.theta.moonBrightness],
    ] as const) {
      light.color.setRGB(...[0, 1, 2].map((c) => Math.max(0, THREE.DataUtils.fromHalfFloat(values[i * 4 + c]))) as [number, number, number]);
      light.intensity = strength * THREE.MathUtils.smoothstep(elevation, -1, 3);
      light.position.copy(direction).multiplyScalar(15); light.target.position.set(0, 0, 0);
    }
    this.fitShadowCameras();
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.setRenderTarget(null);
    this.refreshAt = Infinity;
    this.lastRefreshTime = this.sky.skyUniforms().iTime.value as number;
    this.lastIblRefreshMs = performance.now() - started;
    this.iblRefreshCount++;
  }

  render(output: THREE.WebGLRenderTarget | null = null): void {
    if (!this.enabled || !this.ready || this.loading || this.disposed) return;
    const time = this.sky.skyUniforms().iTime.value as number;
    // Animated skies refresh at most every two seconds; camera motion does not.
    if (performance.now() >= this.refreshAt || (this.refreshAt === Infinity && Math.abs(time - this.lastRefreshTime) >= 2)) this.refreshLighting();
    const size = output ? new THREE.Vector2(output.width, output.height) : this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (this.target.width !== size.x || this.target.height !== size.y) this.target.setSize(size.x, size.y);
    this.camera.aspect = size.x / size.y; this.camera.updateProjectionMatrix();
    (this.displayMaterial.uniforms.u_resolution.value as THREE.Vector2).copy(size);
    this.renderer.setRenderTarget(this.target); this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(output); this.renderer.render(this.screenScene, this.screenCamera);
    this.renderer.setRenderTarget(null);
  }

  dispose(): void {
    this.disposed = true;
    this.navigation.dispose();
    if (this.content) { this.scene.remove(this.content.root); this.content.dispose(); this.content = null; }
    this.depthMaterial.dispose(); this.geometry.dispose(); this.skyMaterial.dispose(); this.displayMaterial.dispose();
    this.target.dispose(); this.probeTarget.dispose(); this.cubeTarget.dispose(); this.environment?.dispose(); this.pmrem.dispose();
    this.sun.shadow.dispose(); this.moon.shadow.dispose();
  }
}
