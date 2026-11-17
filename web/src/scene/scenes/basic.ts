import { disposeContent, type SceneContent } from '../sceneContent';
import type { BufferGeometry, MeshStandardMaterial } from 'three';

export const basicScene: SceneContent = {
  id: 'basic',
  label: '기본',
  async build({ THREE }) {
    const root = new THREE.Group();
    const add = (geometry: BufferGeometry, material: MeshStandardMaterial, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
      root.add(mesh); return mesh;
    };
    const ground = add(new THREE.PlaneGeometry(10000, 10000), new THREE.MeshStandardMaterial({ color: 0x777b80, roughness: 0.95 }), 0, -0.01, 0);
    ground.rotation.x = -Math.PI / 2; ground.castShadow = false;
    add(new THREE.SphereGeometry(1.1, 48, 32), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.06 }), -1.65, 1.1, 0);
    const box = add(new THREE.BoxGeometry(1.5, 1.5, 1.5), new THREE.MeshStandardMaterial({ color: 0xb86b40, roughness: 0.85 }), 1.25, 0.75, 0.15);
    box.rotation.y = 0.35;
    const white = new THREE.MeshStandardMaterial({ color: 0xe5e6e4, roughness: 0.75 });
    add(new THREE.CapsuleGeometry(0.35, 1, 6, 20), white, 0.4, 0.85, 1.7);
    add(new THREE.SphereGeometry(0.31, 24, 16), white, 0.4, 1.95, 1.7);
    return {
      root,
      spawn: { position: new THREE.Vector3(-3.0314168, 2.6628336, -8.3287492), yaw: 20, pitch: -10 },
      // Include the nearby ground receiving long golden-hour shadows.
      shadowBounds: new THREE.Box3(new THREE.Vector3(-12, 0, -35), new THREE.Vector3(12, 3, 12)),
      dispose: () => disposeContent(root),
    };
  },
};
