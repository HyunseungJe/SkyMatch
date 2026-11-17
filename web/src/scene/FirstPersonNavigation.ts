import * as THREE from 'three';
import type { SceneSpawn } from './sceneContent';

const movementKeys = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight']);
const editing = () => document.activeElement instanceof HTMLElement &&
  !!document.activeElement.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"])');

/** Compass-space first-person controls; projection/display conventions stay outside. */
export class FirstPersonNavigation {
  private enabled = false;
  private yaw = 0;
  private pitch = 0;
  private speed = 8; // units (≈ metres) per second; Shift ×3, wheel adjusts
  private readonly keys = new Set<string>();
  private readonly removeEvents: (() => void)[] = [];

  constructor(private readonly camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement) {
    let pointer: number | null = null, x = 0, y = 0;
    const release = () => {
      this.keys.clear();
      if (pointer !== null && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
      pointer = null; canvas.classList.remove('dragging');
    };
    const down = (event: PointerEvent) => {
      if (!this.enabled || event.button !== 0) return;
      // Clicking the canvas explicitly leaves a focused editor/control.
      if (editing() && document.activeElement instanceof HTMLElement) document.activeElement.blur();
      event.stopImmediatePropagation(); pointer = event.pointerId; x = event.clientX; y = event.clientY;
      canvas.setPointerCapture(pointer); canvas.classList.add('dragging');
    };
    const move = (event: PointerEvent) => {
      if (!this.enabled) return;
      event.stopImmediatePropagation();
      if (pointer !== event.pointerId || editing()) return;
      // Mouse-look: dragging right/up turns the head right/up (compass yaw increases toward east).
      this.yaw = THREE.MathUtils.euclideanModulo(this.yaw + (event.clientX - x) * 0.25 + 180, 360) - 180;
      this.pitch = THREE.MathUtils.clamp(this.pitch - (event.clientY - y) * 0.2, -89, 89);
      x = event.clientX; y = event.clientY; this.look();
    };
    const up = () => { pointer = null; canvas.classList.remove('dragging'); };
    const wheel = (event: WheelEvent) => {
      if (!this.enabled || editing()) return;
      event.preventDefault(); this.speed = THREE.MathUtils.clamp(this.speed * Math.exp(-event.deltaY * 0.001), 0.25, 30);
    };
    const keydown = (event: KeyboardEvent) => {
      if (!this.enabled || editing() || event.altKey || event.ctrlKey || event.metaKey || !movementKeys.has(event.code)) return;
      event.preventDefault(); this.keys.add(event.code);
    };
    const keyup = (event: KeyboardEvent) => { this.keys.delete(event.code); };
    const focus = () => { if (editing()) release(); };
    canvas.addEventListener('pointerdown', down, true); canvas.addEventListener('pointermove', move, true);
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('lostpointercapture', up); canvas.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup);
    window.addEventListener('blur', release); document.addEventListener('visibilitychange', release); document.addEventListener('focusin', focus);
    this.removeEvents.push(() => {
      release(); canvas.removeEventListener('pointerdown', down, true); canvas.removeEventListener('pointermove', move, true);
      canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', release);
      canvas.removeEventListener('lostpointercapture', up); canvas.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', release); document.removeEventListener('visibilitychange', release); document.removeEventListener('focusin', focus);
    });
  }

  setEnabled(on: boolean): void { this.enabled = on; this.keys.clear(); }

  setSpawn(spawn: SceneSpawn): void {
    this.keys.clear(); this.camera.position.copy(spawn.position); this.camera.position.y = Math.max(0.3, this.camera.position.y);
    this.yaw = spawn.yaw; this.pitch = THREE.MathUtils.clamp(spawn.pitch, -89, 89); this.look();
  }

  private look(): void {
    const yaw = THREE.MathUtils.degToRad(this.yaw), pitch = THREE.MathUtils.degToRad(this.pitch);
    this.camera.lookAt(this.camera.position.clone().add(new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))));
    this.camera.updateMatrixWorld();
  }

  update(dt: number): void {
    if (!this.enabled || editing() || !Number.isFinite(dt) || dt <= 0) return;
    const axis = (positive: string, negative: string) => Number(this.keys.has(positive)) - Number(this.keys.has(negative));
    const forward = axis('KeyW', 'KeyS'), right = axis('KeyD', 'KeyA'), up = axis('KeyE', 'KeyQ');
    const movement = new THREE.Vector3(right, up, forward);
    if (movement.lengthSq() === 0) return;
    movement.normalize().multiplyScalar(this.speed * dt * (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 3 : 1));
    const yaw = THREE.MathUtils.degToRad(this.yaw), sin = Math.sin(yaw), cos = Math.cos(yaw);
    this.camera.position.add(new THREE.Vector3(movement.x * cos + movement.z * sin, movement.y, -movement.x * sin + movement.z * cos));
    this.camera.position.y = Math.max(0.3, this.camera.position.y); this.look();
  }

  getState(): { position: number[]; yaw: number; pitch: number; speed: number } {
    return { position: this.camera.position.toArray(), yaw: this.yaw, pitch: this.pitch, speed: this.speed };
  }

  dispose(): void { this.removeEvents.forEach((remove) => remove()); }
}
