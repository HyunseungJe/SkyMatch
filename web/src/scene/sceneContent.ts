import * as THREE from 'three';

export interface SceneSpawn {
  position: THREE.Vector3;
  /** Compass degrees: north = +Z, east = +X; pitch is above the horizon. */
  yaw: number;
  pitch: number;
}

export interface BuiltScene {
  root: THREE.Object3D;
  spawn: SceneSpawn;
  /** World-space bounds of the area that needs directional shadows. */
  shadowBounds: THREE.Box3;
  /** Owns content geometries, materials and textures, never renderer resources. */
  dispose(): void;
}

export interface SceneBuildContext {
  THREE: typeof THREE;
  renderer: THREE.WebGLRenderer;
  assetUrl(sceneId: string, path: string): string;
  loadGltf(sceneId: string, path: string): Promise<THREE.Group>;
}

export interface SceneContent {
  id: string;
  label: string;
  build(ctx: SceneBuildContext): Promise<BuiltScene>;
}

/** Dispose shared glTF resources only once, including textures and skeletons. */
export function disposeContent(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => {
    texture.dispose();
    if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) texture.image.close();
  });
  skeletons.forEach((skeleton) => skeleton.dispose());
}

export function createSceneContext(renderer: THREE.WebGLRenderer): SceneBuildContext {
  const assetUrl = (sceneId: string, path: string): string => {
    const root = new URL(`${import.meta.env.BASE_URL}scenes/${encodeURIComponent(sceneId)}/`, document.baseURI); // BASE_URL is relative ('./') in builds
    const url = new URL(path, root);
    if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) throw new Error('Scene assets must stay inside their local scene folder');
    return url.href;
  };
  return {
    THREE, renderer, assetUrl,
    async loadGltf(sceneId, path) {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const manager = new THREE.LoadingManager();
      // Includes secondary .bin/image requests: local scenes never fetch a CDN.
      manager.setURLModifier((url) => {
        if (url.startsWith('data:') || url.startsWith('blob:')) return url;
        const resolved = new URL(url, location.href);
        if (resolved.origin !== location.origin) throw new Error('External scene resources are disabled');
        return resolved.href;
      });
      const gltf = await new GLTFLoader(manager).loadAsync(assetUrl(sceneId, path));
      gltf.scene.traverse((object) => {
        if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; }
      });
      return gltf.scene;
    },
  };
}
