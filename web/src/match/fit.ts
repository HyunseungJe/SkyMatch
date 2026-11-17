// Baseline Sky Match: numerical optimisation. Renders candidate skies small, measures the mood
// distance to the photo inside its sky mask, and searches θ with CMA-ES.
import { defaultParams, formatColor, paramDefs, type SkyParams } from '../sky/schema';
import { Cma, type Candidate } from './cmaes';
import { detectGlow, detectSky, estimateCamera, type GlowDetection, type SkyDetection, type TimeHint } from './detect';
import { FeatureExtractor, type Features } from './features';
import type { FitCamera, FitRenderer } from './fitRenderer';
import { fitSize, linearToSrgb8, resizeImage, resizeMask, SRGB_TO_LINEAR, type RgbaImage } from './image';

/** Sky time used for every candidate render (clouds and stars are compared as statistics, not positions). */
export const FIT_TIME = 0;

type DimKind = 'linear' | 'log' | 'periodic' | 'color';
interface Dim {
  key: string; // θ param, or "pitch"
  kind: DimKind;
  min: number;
  max: number;
  channel?: number; // colour channel 0..2 (sRGB 0..1)
}

const COLOR_PARAMS = ['zenithColor', 'horizonColor', 'sunGlowColor'];
const range = (name: string): [number, number] => [paramDefs[name].min!, paramDefs[name].max!];

function dayDims(pitch: number): Dim[] {
  const dims: Dim[] = [
    { key: 'sunElevation', kind: 'linear', min: -12, max: 60 },
    { key: 'sunAzimuth', kind: 'periodic', min: -180, max: 180 },
    // Camera pitch is a nuisance: the horizon line in a photo is often hidden by trees and buildings.
    { key: 'pitch', kind: 'linear', min: Math.max(-15, pitch - 8), max: Math.min(75, pitch + 12) },
  ];
  for (const name of COLOR_PARAMS) for (let c = 0; c < 3; c++) dims.push({ key: name, kind: 'color', min: 0, max: 1, channel: c });
  for (const name of ['haze', 'cloudCover', 'cloudSoftness', 'storm', 'stars']) dims.push({ key: name, kind: 'linear', min: range(name)[0], max: range(name)[1] });
  for (const name of ['cloudDensity', 'cloudScale']) dims.push({ key: name, kind: 'log', min: range(name)[0], max: range(name)[1] });
  return dims;
}

const NIGHT_DIMS: Record<number, Dim[]> = {
  0: [],
  1: [{ key: 'milkyWayBrightness', kind: 'linear', min: 0, max: 2 }],
  2: [
    { key: 'auroraIntensity', kind: 'linear', min: 0, max: 3 },
    { key: 'auroraHue', kind: 'linear', min: 0, max: 1 },
  ],
};

interface State {
  theta: SkyParams;
  pitch: number;
}

function decode(x: number[], dims: Dim[], base: State): State {
  const theta = { ...base.theta };
  let pitch = base.pitch;
  const rgb: Record<string, number[]> = {};
  dims.forEach((d, i) => {
    const u = x[i];
    let v: number;
    if (d.kind === 'log') v = Math.exp(Math.log(d.min) + u * (Math.log(d.max) - Math.log(d.min)));
    else if (d.kind === 'periodic') v = d.min + (u - Math.floor(u)) * (d.max - d.min);
    else v = d.min + u * (d.max - d.min);
    if (d.kind === 'color') {
      const hex = theta[d.key];
      rgb[d.key] ??= [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
      rgb[d.key][d.channel!] = Math.round(v * 255);
    } else if (d.key === 'pitch') pitch = v;
    else theta[d.key] = v;
  });
  for (const [name, [r, g, b]] of Object.entries(rgb)) theta[name] = (r << 16) | (g << 8) | b;
  return { theta, pitch };
}

function encode(state: State, dims: Dim[]): number[] {
  return dims.map((d) => {
    if (d.kind === 'color') return ((state.theta[d.key] >> (16 - 8 * d.channel!)) & 255) / 255;
    const v = d.key === 'pitch' ? state.pitch : state.theta[d.key];
    if (d.kind === 'log') return (Math.log(v) - Math.log(d.min)) / (Math.log(d.max) - Math.log(d.min));
    const u = (v - d.min) / (d.max - d.min);
    return d.kind === 'periodic' ? u - Math.floor(u) : Math.min(1, Math.max(0, u));
  });
}

export interface MatchOptions {
  /** Total candidate renders (default 900). */
  budget?: number;
  /** Longest side of the analysis image in pixels (default 96). */
  size?: number;
  /** Exposure used for candidate renders (estimation constant, default 1). */
  exposure?: number;
  /** Known camera; otherwise estimated from the horizon. */
  camera?: Partial<FitCamera>;
  /** Precomputed sky mask at any size (1 = sky); otherwise detected. */
  mask?: { data: Uint8Array; width: number; height: number };
  seed?: number;
  onProgress?: (fraction: number, stage: string) => void;
  signal?: AbortSignal;
}

export interface MatchResult {
  theta: SkyParams;
  camera: FitCamera;
  loss: number;
  terms: Record<string, number>;
  /** Mood distance of the best fit per night effect class (only when night classes were compared). */
  classLoss: Record<number, number> | null;
  detection: SkyDetection;
  glow: GlowDetection;
  analysis: { width: number; height: number; mask: Uint8Array; photo: RgbaImage };
  renders: number;
  ms: number;
}

const nextTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Mean linear colour of the top and bottom quarters of the sky (for colour seeding). */
function bandColours(rgba: ArrayLike<number>, ext: FeatureExtractor): [number[], number[]] {
  const { width: w, height: h, mask } = ext;
  let top = h, bottom = 0;
  for (let p = 0; p < w * h; p++) if (mask[p]) { const y = Math.floor(p / w); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  const span = bottom - top + 1;
  const hi = [0, 0, 0, 0], lo = [0, 0, 0, 0];
  for (let p = 0; p < w * h; p++) {
    if (!mask[p]) continue;
    const y = Math.floor(p / w), into = (y - top) / span;
    const acc = into < 0.25 ? hi : into >= 0.75 ? lo : null;
    if (!acc) continue;
    for (let c = 0; c < 3; c++) acc[c] += SRGB_TO_LINEAR[rgba[p * 4 + c]];
    acc[3]++;
  }
  const mean = (a: number[]) => [a[0] / Math.max(1, a[3]), a[1] / Math.max(1, a[3]), a[2] / Math.max(1, a[3])];
  return [mean(hi), mean(lo)];
}

const packLinear = (rgb: number[]) => (linearToSrgb8(rgb[0]) << 16) | (linearToSrgb8(rgb[1]) << 8) | linearToSrgb8(rgb[2]);
const unpackLinear = (hex: number) => [SRGB_TO_LINEAR[(hex >> 16) & 255], SRGB_TO_LINEAR[(hex >> 8) & 255], SRGB_TO_LINEAR[hex & 255]];

/** Detection, analysis image, sky mask, camera guess and the photo's features. */
export function prepare(photo: RgbaImage, options: MatchOptions = {}) {
  const detection = detectSky(photo);
  const [w, h] = fitSize(photo.width, photo.height, options.size ?? 96);
  const small = resizeImage(photo, w, h);
  const maskSource = options.mask ?? { data: detection.mask, width: detection.width, height: detection.height };
  const mask = resizeMask(maskSource.data, maskSource.width, maskSource.height, w, h);
  if (mask.reduce((a, b) => a + b, 0) < 20) {
    // Too little sky after shrinking: fall back to the upper half rather than failing.
    mask.fill(0);
    for (let p = 0; p < w * Math.ceil(h / 2); p++) mask[p] = 1;
  }
  const glow = detectGlow(small, mask);
  const guess = estimateCamera(photo.width, photo.height, detection.horizonY);
  const camera0: FitCamera = { yaw: 0, fov: options.camera?.fov ?? guess.fov, pitch: options.camera?.pitch ?? guess.pitch };
  const ext = new FeatureExtractor(w, h, mask);
  const target: Features = ext.extract(small.data);
  return { detection, w, h, small, mask, glow, camera0, ext, target };
}

/** Mood distance of one θ to the photo (for inspection and tests). */
export function scoreTheta(photo: RgbaImage, renderer: FitRenderer, theta: SkyParams, options: MatchOptions & { pitch?: number } = {}) {
  const { w, h, camera0, ext, target, glow, detection } = prepare(photo, options);
  const pixels = renderer.render(theta, { ...camera0, pitch: options.pitch ?? camera0.pitch }, FIT_TIME, w, h, options.exposure ?? 1);
  return { ...ext.distance(target, ext.extract(pixels)), camera: camera0, glow, horizonY: detection.horizonY, target, render: ext.extract(pixels) };
}

export async function matchPhoto(photo: RgbaImage, renderer: FitRenderer, options: MatchOptions = {}): Promise<MatchResult> {
  const started = performance.now();
  const rendersBefore = renderer.renders;
  const budget = options.budget ?? 900;
  const exposure = options.exposure ?? 1;
  const progress = options.onProgress ?? (() => {});
  const check = () => {
    if (options.signal?.aborted) throw new DOMException('맞추기를 취소했습니다.', 'AbortError');
  };

  // ---- 1. Detection ---------------------------------------------------------
  progress(0, 'detect');
  const { detection, w, h, small, mask, glow, camera0, ext, target } = prepare(photo, options);

  // ---- 2. Loss --------------------------------------------------------------
  let bestState: State | null = null, bestLoss = Infinity, bestTerms: Record<string, number> = {};
  const evaluate = (state: State): number => {
    const pixels = renderer.render(state.theta, { ...camera0, pitch: state.pitch }, FIT_TIME, w, h, exposure);
    const { total, terms } = ext.distance(target, ext.extract(pixels));
    if (total < bestLoss) {
      bestLoss = total;
      bestState = { theta: { ...state.theta }, pitch: state.pitch };
      bestTerms = terms;
    }
    return total;
  };
  const used = () => renderer.renders - rendersBefore;

  // ---- 3. Seeds: time-of-day basins × cloud cover, colours taken from the photo -
  const base = defaultParams();
  base.time = FIT_TIME;
  base.horizonWarmth = 0; // fixed by the schema decision (only the artist sets it)
  base.moonBrightness = 0;
  const [photoTop, photoBottom] = bandColours(small.data, ext);
  base.zenithColor = packLinear(photoTop);
  base.horizonColor = packLinear(photoBottom);
  base.sunGlowColor = glow.present ? packLinear(photoBottom.map((v) => v * 1.4)) : base.sunGlowColor;
  const hfov = (2 * Math.atan(Math.tan((camera0.fov * Math.PI) / 360) * (w / h)) * 180) / Math.PI;
  const glowAzimuth = (Math.atan((2 * glow.x - 1) * Math.tan((hfov * Math.PI) / 360)) * 180) / Math.PI;
  const elevations: Record<TimeHint, number[]> = {
    day: [35, 15], golden: [8, 3], sunset: [1, -2.5], twilight: [-3, -7], night: [-8, -11],
  };
  const azimuths = glow.present ? [glowAzimuth] : [glowAzimuth, glowAzimuth + 180];
  const seeds: State[] = [];
  for (const elevation of elevations[glow.timeHint]) {
    for (const azimuth of azimuths) {
      for (const cover of [0.1, 0.55]) {
        seeds.push({ theta: { ...base, sunElevation: elevation, sunAzimuth: ((azimuth + 540) % 360) - 180, cloudCover: cover, stars: glow.timeHint === 'night' ? 1 : base.stars }, pitch: camera0.pitch });
      }
    }
  }
  progress(0.02, 'seed');
  const scored = seeds.map((s) => ({ s, loss: evaluate(s) })).sort((a, b) => a.loss - b.loss);
  check();

  // Colour calibration of the best seeds: scale each sky colour so the render's top/bottom band means
  // match the photo's (two multiplicative passes), then keep whichever version scores better.
  const calibrate = (state: State): State => {
    let s = { theta: { ...state.theta }, pitch: state.pitch };
    for (let pass = 0; pass < 2; pass++) {
      const [rTop, rBottom] = bandColours(renderer.render(s.theta, { ...camera0, pitch: s.pitch }, FIT_TIME, w, h, exposure), ext);
      const scale = (name: string, want: number[], got: number[]) => {
        const lin = unpackLinear(s.theta[name]);
        s.theta[name] = packLinear(lin.map((v, c) => Math.min(1, v * Math.min(4, Math.max(0.25, (want[c] + 1e-4) / (got[c] + 1e-4))))));
      };
      scale('zenithColor', photoTop, rTop);
      scale('horizonColor', photoBottom, rBottom);
      s = { theta: { ...s.theta }, pitch: s.pitch };
    }
    return s;
  };
  const starts: State[] = [];
  for (const { s, loss } of scored.slice(0, 2)) {
    const c = calibrate(s);
    starts.push(evaluate(c) < loss ? c : s);
  }

  // ---- 4. CMA-ES runs -----------------------------------------------------------
  const dims = dayDims(camera0.pitch);
  const runCma = async (start: State, d: Dim[], sigma: number, until: number, seed: number) => {
    const cma = new Cma({ mean: encode(start, d), sigma, periodic: d.flatMap((x, i) => (x.kind === 'periodic' ? [i] : [])), seed });
    let runBest: { state: State; loss: number } = { state: start, loss: evaluate(start) };
    let stall = 0;
    while (used() + cma.lambda <= until) {
      check();
      const population: Candidate[] = cma.ask().map((x) => {
        const state = decode(x, d, start);
        const loss = evaluate(state);
        if (loss < runBest.loss - 1e-4) { runBest = { state, loss }; stall = 0; }
        return { x, loss };
      });
      cma.tell(population);
      stall++;
      progress(Math.min(0.99, used() / budget), 'fit');
      await nextTurn();
      if (cma.sigma < 2e-3 || stall > 25) break;
    }
    return runBest;
  };
  const seedBase = options.seed ?? 1;
  await runCma(starts[0], dims, 0.18, budget * 0.5, seedBase);
  if (starts[1]) await runCma(starts[1], dims, 0.18, budget * 0.72, seedBase + 1);

  // ---- 5. Night effect classification: refit per class and keep the lowest distance -
  let classLoss: Record<number, number> | null = null;
  const current = bestState as State | null;
  if (current && (current.theta.sunElevation < -5 || glow.timeHint === 'night')) {
    classLoss = {};
    const share = (budget - used()) / 3;
    let winner: { state: State; loss: number } | null = null;
    for (const cls of [0, 1, 2]) {
      const start: State = { theta: { ...current.theta, nightEffect: cls }, pitch: current.pitch };
      const r = await runCma(start, [...dims, ...NIGHT_DIMS[cls]], 0.06, used() + share, seedBase + 10 + cls);
      classLoss[cls] = r.loss;
      if (!winner || r.loss < winner.loss) winner = r;
    }
    // The global best may mix classes; report exactly the winning class's best point.
    bestState = null;
    bestLoss = Infinity;
    evaluate(winner!.state);
  } else if (current) {
    // Day: spend the rest polishing the best point with a small step.
    await runCma(current, dims, 0.05, budget, seedBase + 2);
  }

  const best = bestState as State | null;
  if (!best) throw new Error('맞추기 결과가 없습니다.');
  progress(1, 'done');
  return {
    theta: best.theta,
    camera: { ...camera0, pitch: best.pitch },
    loss: bestLoss,
    terms: bestTerms,
    classLoss,
    detection,
    glow,
    analysis: { width: w, height: h, mask, photo: small },
    renders: used(),
    ms: performance.now() - started,
  };
}

/** Human-readable θ summary for logs. */
export function describeTheta(theta: SkyParams): string {
  return `elev ${theta.sunElevation.toFixed(1)}° az ${theta.sunAzimuth.toFixed(0)}° zenith ${formatColor(theta.zenithColor)} horizon ${formatColor(theta.horizonColor)} glow ${formatColor(theta.sunGlowColor)} cover ${theta.cloudCover.toFixed(2)} night ${theta.nightEffect}`;
}
