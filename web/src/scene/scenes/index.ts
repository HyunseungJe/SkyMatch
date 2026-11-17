import type { SceneContent } from '../sceneContent';
import { basicScene } from './basic';
import { gltfTestScene } from './gltfTest';

export const sceneContents: readonly SceneContent[] = [
  basicScene,
  ...(import.meta.env.DEV ? [gltfTestScene] : []),
];

export const defaultSceneId = basicScene.id;
export const findScene = (id: string): SceneContent => sceneContents.find((scene) => scene.id === id) ?? basicScene;
