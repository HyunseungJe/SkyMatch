// Offscreen frame-time measurement (open the app with ?bench=1).
// Renders each preset into a 1920x1080 target and waits for the GPU, so the
// number is real GPU time rather than the display's vsync interval.
import * as THREE from 'three';
import { presetNames, presetParams } from './sky/schema';
import type { SkyView } from './sky/SkyView';

const WIDTH = 1920;
const HEIGHT = 1080;
const FRAMES = 15;
// Other work on the GPU only ever adds time, so the fastest of several runs is the estimate.
const RUNS = 4;
const BUDGET_MS = 6;
// A single frame slower than this stops the run: a stalled GPU is a bug.
const ABORT_MS = 150;

export interface BenchRow {
  preset: string;
  yaw: number;
  pitch: number;
  ms: number;
}

// A timer, not requestAnimationFrame: the run must also finish in a background tab.
const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function runBench(view: SkyView, log: (text: string) => void): Promise<BenchRow[]> {
  const gl = view.renderer.getContext();
  const target = new THREE.WebGLRenderTarget(WIDTH, HEIGHT, { depthBuffer: false });
  const pixel = new Uint8Array(4);
  const drawAndWait = (frames: number): number => {
    const start = performance.now();
    for (let i = 0; i < frames; i++) view.render(target);
    // Reading one pixel back forces every queued frame to finish.
    view.renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel);
    gl.finish();
    return (performance.now() - start) / frames;
  };

  const rows: BenchRow[] = [];
  const lines = [`offscreen ${WIDTH}x${HEIGHT}, best of ${RUNS} x ${FRAMES} frames, budget ${BUDGET_MS} ms`];
  log(lines.join('\n'));
  view.setTime(0);
  outer: for (const preset of presetNames) {
    const theta = presetParams(preset);
    view.setParams(theta);
    // Toward the sun near the horizon (longest cloud march) and a higher view.
    for (const pitch of [12, 40]) {
      const yaw = theta.sunAzimuth;
      view.setCamera(yaw, pitch);
      const first = drawAndWait(1);
      if (first > ABORT_MS) {
        lines.push(`${preset} pitch ${pitch}: first frame ${first.toFixed(0)} ms, aborted`);
        log(lines.join('\n'));
        break outer;
      }
      drawAndWait(4);
      let ms = Infinity;
      for (let run = 0; run < RUNS; run++) ms = Math.min(ms, drawAndWait(FRAMES));
      rows.push({ preset, yaw, pitch, ms });
      lines.push(`${preset.padEnd(18)} pitch ${String(pitch).padStart(2)}  ${ms.toFixed(2)} ms${ms > BUDGET_MS ? '  OVER' : ''}`);
      log(lines.join('\n'));
      await nextFrame();
    }
  }
  if (rows.length) {
    const worst = rows.reduce((a, b) => (b.ms > a.ms ? b : a));
    lines.push(`max ${worst.ms.toFixed(2)} ms (${worst.preset}, pitch ${worst.pitch})`);
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    if (info) lines.push(String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)));
    log(lines.join('\n'));
  }
  target.dispose();
  return rows;
}
