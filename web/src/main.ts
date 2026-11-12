import { runBench } from './bench';
import { defaultParams, presetNames, presetParams, type SkyParams } from './sky/schema';
import { SkyView } from './sky/SkyView';
import { createParamPanel, type ParamPanel } from './ui/paramPanel';

// URL options (all optional): ?preset=sunset&yaw=20&pitch=12&time=0&bench=1
const query = new URLSearchParams(location.search);
const queryNumber = (key: string): number | null => {
  const raw = query.get(key);
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

const canvas = document.querySelector<HTMLCanvasElement>('#sky')!;
const presetSelect = document.querySelector<HTMLSelectElement>('#preset')!;
const resetButton = document.querySelector<HTMLButtonElement>('#reset')!;
const paramsElement = document.querySelector<HTMLElement>('#params')!;
const stats = document.querySelector<HTMLSpanElement>('#stats')!;
const status = document.querySelector<HTMLDivElement>('#status')!;
const benchOutput = document.querySelector<HTMLPreElement>('#bench')!;

const view = new SkyView(canvas);

let theta: SkyParams = defaultParams();
let yaw = 0;
let pitch = 12;
let yawFollowsSun = queryNumber('yaw') === null;

// Shown in the preset list once a slider has moved away from the preset.
const CUSTOM = '';
let basePreset = 'golden hour';
let panel: ParamPanel | null = null;

function selectPreset(name: string): void {
  basePreset = name;
  theta = presetParams(name);
  view.setParams(theta);
  panel?.sync(theta);
  // Until the user looks around, face the sun so the preset's mood is in view.
  if (yawFollowsSun) yaw = theta.sunAzimuth;
  presetSelect.value = name;
}

const customOption = new Option('(직접 조정)', CUSTOM);
customOption.hidden = true;
presetSelect.add(customOption);
for (const name of presetNames) presetSelect.add(new Option(name, name));
presetSelect.addEventListener('change', () => {
  if (presetSelect.value !== CUSTOM) selectPreset(presetSelect.value);
});
resetButton.addEventListener('click', () => selectPreset(basePreset));

const requestedPreset = query.get('preset');
selectPreset(requestedPreset && presetNames.includes(requestedPreset) ? requestedPreset : basePreset);
panel = createParamPanel(paramsElement, theta, () => {
  view.setParams(theta);
  presetSelect.value = CUSTOM;
});
yaw = queryNumber('yaw') ?? yaw;
pitch = queryNumber('pitch') ?? pitch;

// ---- Look around by dragging ------------------------------------------------
let dragging = false;
let lastX = 0;
let lastY = 0;
canvas.addEventListener('pointerdown', (event) => {
  dragging = true;
  lastX = event.clientX;
  lastY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  // The sky follows the pointer: one screen height is one vertical field of view.
  const degPerPixel = 60 / canvas.clientHeight;
  yaw -= (event.clientX - lastX) * degPerPixel;
  pitch = Math.min(89, Math.max(-89, pitch + (event.clientY - lastY) * degPerPixel));
  yaw = ((((yaw + 180) % 360) + 360) % 360) - 180;
  lastX = event.clientX;
  lastY = event.clientY;
  yawFollowsSun = false;
});
const endDrag = () => {
  dragging = false;
  canvas.classList.remove('dragging');
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// ---- Size: render scale is always 1 (CSS pixels x devicePixelRatio) ----------
function resize(): void {
  view.resize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio);
}
new ResizeObserver(resize).observe(canvas);
resize();

// ---- Frame loop -------------------------------------------------------------
const fixedTime = queryNumber('time');
const startTime = performance.now();
let frames = 0;
let statsSince = startTime;

function frame(now: number): void {
  view.setCamera(yaw, pitch);
  view.setTime(theta.time + (fixedTime ?? (now - startTime) / 1000));
  view.render();
  frames++;
  if (now - statsSince >= 500) {
    const fps = (frames * 1000) / (now - statsSince);
    stats.textContent = `${canvas.width}×${canvas.height} · ${fps.toFixed(0)} fps`;
    frames = 0;
    statsSince = now;
  }
  requestAnimationFrame(frame);
}

async function start(): Promise<void> {
  try {
    await view.init();
  } catch (error) {
    status.classList.add('error');
    status.textContent = `하늘 셰이더를 준비하지 못했습니다.\n${error instanceof Error ? error.message : String(error)}`;
    throw error;
  }
  status.hidden = true;

  if (query.has('bench')) {
    benchOutput.hidden = false;
    const rows = await runBench(view, (text) => (benchOutput.textContent = text));
    console.log('[bench]', JSON.stringify(rows));
    selectPreset(presetSelect.value);
  }
  requestAnimationFrame(frame);
}

void start();
