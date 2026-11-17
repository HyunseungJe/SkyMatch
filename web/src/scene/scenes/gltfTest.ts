import { disposeContent, type SceneContent } from '../sceneContent';

/** Original procedural fixture, not a downloaded model. Development only. */
export const gltfTestScene: SceneContent = {
  id: 'gltf-test',
  label: 'glTF 불러오기 테스트',
  async build(ctx) {
    const root = await ctx.loadGltf('gltf-test', 'fixture.glb');
    return {
      root,
      spawn: { position: new ctx.THREE.Vector3(0, 2, -7), yaw: 0, pitch: -8 },
      shadowBounds: new ctx.THREE.Box3(new ctx.THREE.Vector3(-4, 0, -4), new ctx.THREE.Vector3(4, 3, 4)),
      dispose: () => disposeContent(root),
    };
  },
};
