// "ML 모델" estimate: one forward pass of the trained network (ml/skymatch_ml/train.py) in the
// browser with onnxruntime-web. The photo never leaves the browser; only the model is downloaded.
// Pre-processing and decoding follow the model's own model.json, written by the training code.
import { defaultParams, type SkyParams } from '../sky/schema';
import { detectSky, estimateCamera } from './detect';
import type { FitCamera } from './fitRenderer';
import { resizeImage, type RgbaImage } from './image';

interface RegressTarget {
  name: string;
  kind: 'linear' | 'log' | 'color';
  column: number;
  width: number;
  min?: number;
  max?: number;
}

export interface ModelInfo {
  input: { name: string; width: number; height: number };
  regress: RegressTarget[];
  n_regress: number;
  classify: { name: string; n: number };
  trained?: { run: string; epoch: number; dataset: string };
}

export interface MlResult {
  theta: SkyParams;
  camera: FitCamera;
  /** Softmax of the night effect classes. */
  classProb: number[];
  ms: number;
  model: ModelInfo;
}

type Ort = typeof import('onnxruntime-web/wasm');
type Session = import('onnxruntime-web/wasm').InferenceSession;

const MODEL_DIR = 'models/sky-v1/';
let loading: Promise<{ ort: Ort; session: Session; info: ModelInfo }> | null = null;

function modelUrl(file: string): string {
  return new URL(`${import.meta.env.BASE_URL}${MODEL_DIR}${file}`, document.baseURI).href;
}

/** Loads onnxruntime and the model once (about 45 MB, cached by the browser afterwards). */
export function loadModel() {
  loading ??= (async () => {
    const [ort, info] = await Promise.all([
      import('onnxruntime-web/wasm'),
      fetch(modelUrl('model.json')).then((r) => {
        if (!r.ok) throw new Error(`model.json: HTTP ${r.status}`);
        return r.json() as Promise<ModelInfo>;
      }),
    ]);
    ort.env.wasm.numThreads = 1; // GitHub Pages is not cross-origin isolated
    const session = await ort.InferenceSession.create(modelUrl('model.onnx'), { executionProviders: ['wasm'] });
    return { ort, session, info };
  })();
  loading.catch(() => (loading = null));
  return loading;
}

/** Centre crop to the model's aspect ratio (4:3), then area resize. */
function modelInput(photo: RgbaImage, width: number, height: number): Float32Array {
  const aspect = width / height;
  let cw = photo.width, ch = photo.height;
  if (cw / ch > aspect) cw = Math.round(ch * aspect);
  else ch = Math.round(cw / aspect);
  const x0 = Math.floor((photo.width - cw) / 2), y0 = Math.floor((photo.height - ch) / 2);
  const crop = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const from = ((y0 + y) * photo.width + x0) * 4;
    crop.set(photo.data.subarray(from, from + cw * 4), y * cw * 4);
  }
  const small = resizeImage({ width: cw, height: ch, data: crop }, width, height);
  const n = width * height;
  const out = new Float32Array(3 * n);
  for (let p = 0; p < n; p++) for (let c = 0; c < 3; c++) out[c * n + p] = small.data[p * 4 + c] / 255;
  return out;
}

export async function estimatePhoto(photo: RgbaImage): Promise<MlResult> {
  const { ort, session, info } = await loadModel();
  const started = performance.now();
  const { width, height } = info.input;
  const feeds = { [info.input.name]: new ort.Tensor('float32', modelInput(photo, width, height), [1, 3, height, width]) };
  const out = await session.run(feeds);
  const reg = out.regress.data as Float32Array;
  const logits = Array.from(out.logits.data as Float32Array);

  // Same decoding as skymatch_ml/targets.py: clamp to [0, 1], undo the normalisation.
  // Everything not learned keeps the schema default, exactly as in the training data.
  const theta = defaultParams();
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  for (const t of info.regress) {
    if (t.kind === 'color') {
      const [r, g, b] = [0, 1, 2].map((k) => Math.round(clamp01(reg[t.column + k]) * 255));
      theta[t.name] = (r << 16) | (g << 8) | b;
    } else if (t.kind === 'log') {
      const lo = Math.log(t.min!), hi = Math.log(t.max!);
      theta[t.name] = Math.exp(lo + clamp01(reg[t.column]) * (hi - lo));
    } else {
      theta[t.name] = t.min! + clamp01(reg[t.column]) * (t.max! - t.min!);
    }
  }
  const peak = Math.max(...logits);
  const exp = logits.map((v) => Math.exp(v - peak));
  const sum = exp.reduce((a, b) => a + b, 0);
  const classProb = exp.map((v) => v / sum);
  theta[info.classify.name] = classProb.indexOf(Math.max(...classProb));

  // The network does not estimate the camera; reuse the photo matcher's horizon guess.
  const guess = estimateCamera(photo.width, photo.height, detectSky(photo).horizonY);
  return { theta, camera: { yaw: 0, pitch: guess.pitch, fov: guess.fov }, classProb, ms: performance.now() - started, model: info };
}
