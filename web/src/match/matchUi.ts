// "사진으로 맞추기": choose, drop or paste a photo; the sky is matched in the browser and applied.
// Builds its own DOM so the page markup stays untouched.
import type * as THREE from 'three';
import type { SkyParams } from '../sky/schema';
import { FIT_TIME, matchPhoto, scoreTheta, type MatchResult } from './fit';
import { FitRenderer, type FitCamera } from './fitRenderer';
import { fitSize, loadPhoto, resizeImage, type RgbaImage } from './image';
import { estimatePhoto, loadModel } from './mlEstimate';

export interface MatchUiHooks {
  renderer: THREE.WebGLRenderer;
  noise: () => THREE.Texture;
  /** Called with the matched sky and the photo's camera. */
  apply: (theta: SkyParams, camera: FitCamera) => void;
}

const NIGHT_LABELS = ['없음', '은하수', '오로라'];
const PREVIEW = 200; // longest side of the photo / matched-sky thumbnails, CSS pixels

function drawImage(canvas: HTMLCanvasElement, image: RgbaImage): void {
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
}

export function createMatchUi(hooks: MatchUiHooks): { open: (file: Blob, name?: string) => Promise<void> } {
  let fitRenderer: FitRenderer | null = null;
  const renderer = () => (fitRenderer ??= new FitRenderer(hooks.renderer, hooks.noise()));

  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'match-photo';
  button.textContent = '사진으로 맞추기';
  button.title = '사진을 고르거나 끌어다 놓거나 붙여 넣으면 하늘을 자동으로 맞춥니다. 사진은 브라우저 밖으로 나가지 않습니다.';
  document.querySelector('#panel')!.append(button);
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.hidden = true;
  document.body.append(input);

  const panel = document.createElement('section');
  panel.id = 'match';
  panel.hidden = true;
  panel.innerHTML = `
    <header><strong>사진으로 맞추기</strong><span class="match-name"></span><button type="button" class="match-close" title="닫기">×</button></header>
    <div class="match-pair">
      <figure><canvas class="match-photo"></canvas><figcaption>사진</figcaption></figure>
      <figure><canvas class="match-sky"></canvas><figcaption>맞춘 하늘</figcaption></figure>
    </div>
    <div class="match-options">
      <label class="match-method">방식 <select>
        <option value="ml">ML 모델</option>
        <option value="fit">최적화 (CMA-ES)</option>
      </select></label>
      <label class="match-mask-toggle"><input type="checkbox" /> 하늘 영역 보기</label>
    </div>
    <div class="match-status"></div>`;
  document.body.append(panel);
  const photoCanvas = panel.querySelector<HTMLCanvasElement>('.match-photo')!;
  const skyCanvas = panel.querySelector<HTMLCanvasElement>('.match-sky')!;
  const status = panel.querySelector<HTMLDivElement>('.match-status')!;
  const maskToggle = panel.querySelector<HTMLInputElement>('.match-mask-toggle input')!;
  const nameLabel = panel.querySelector<HTMLSpanElement>('.match-name')!;
  const methodSelect = panel.querySelector<HTMLSelectElement>('.match-method select')!;
  let lastFile: { file: Blob; name: string } | null = null;
  methodSelect.addEventListener('change', () => {
    if (lastFile) void open(lastFile.file, lastFile.name);
  });

  let thumb: RgbaImage | null = null;
  let last: Pick<MatchResult, 'detection'> | null = null;
  let running: AbortController | null = null;

  const drawPhoto = () => {
    if (!thumb) return;
    drawImage(photoCanvas, thumb);
    if (maskToggle.checked && last?.detection) {
      const { mask, width, height } = last.detection;
      const ctx = photoCanvas.getContext('2d')!;
      const overlay = ctx.getImageData(0, 0, thumb.width, thumb.height);
      for (let y = 0; y < thumb.height; y++) {
        for (let x = 0; x < thumb.width; x++) {
          const sky = mask[Math.min(height - 1, Math.floor((y * height) / thumb.height)) * width + Math.min(width - 1, Math.floor((x * width) / thumb.width))];
          const i = (y * thumb.width + x) * 4;
          if (sky) overlay.data[i + 2] = Math.min(255, overlay.data[i + 2] * 0.5 + 128);
          else for (let c = 0; c < 3; c++) overlay.data[i + c] *= 0.3;
        }
      }
      ctx.putImageData(overlay, 0, 0);
      // Detected horizon line.
      if (last.detection.horizonY <= 1) {
        ctx.strokeStyle = '#ffd36b';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, last.detection.horizonY * thumb.height);
        ctx.lineTo(thumb.width, last.detection.horizonY * thumb.height);
        ctx.stroke();
      }
    }
  };
  maskToggle.addEventListener('change', drawPhoto);

  // Sit just below the top bar, which can wrap to two rows on narrow windows.
  const toolbar = document.querySelector<HTMLElement>('#panel')!;
  const place = () => (panel.style.top = `${Math.round(toolbar.getBoundingClientRect().bottom + 8)}px`);
  new ResizeObserver(place).observe(toolbar);

  async function open(file: Blob, name = ''): Promise<void> {
    running?.abort();
    const controller = (running = new AbortController());
    lastFile = { file, name };
    panel.hidden = false;
    nameLabel.textContent = name;
    last = null;
    skyCanvas.width = skyCanvas.height = 1;
    status.classList.remove('error');
    status.textContent = '사진을 읽는 중입니다…';
    try {
      const photo = await loadPhoto(file);
      const [tw, th] = fitSize(photo.width, photo.height, PREVIEW * Math.min(2, window.devicePixelRatio));
      thumb = resizeImage(photo, tw, th);
      drawPhoto();
      if (methodSelect.value === 'ml') {
        status.textContent = '모델을 불러오는 중입니다… (처음 한 번, 약 95MB)';
        await loadModel();
        if (controller !== running) return;
        status.textContent = '추정하는 중입니다…';
        const r = await estimatePhoto(photo);
        if (controller !== running) return;
        const sky = renderer().render(r.theta, r.camera, FIT_TIME, tw, th);
        drawImage(skyCanvas, { width: tw, height: th, data: sky });
        hooks.apply(r.theta, r.camera);
        const night = r.theta.sunElevation < -6
          ? ` · 밤 효과 ${NIGHT_LABELS[r.theta.nightEffect]} (${r.classProb.map((p, c) => `${NIGHT_LABELS[c]} ${(p * 100).toFixed(0)}%`).join(', ')})`
          : '';
        status.textContent = `ML 모델 (${r.model.trained?.run ?? '?'}) · ${r.ms.toFixed(0)} ms · 해 고도 ${r.theta.sunElevation.toFixed(1)}°${night}`;
        return;
      }
      const result = await matchPhoto(photo, renderer(), {
        signal: controller.signal,
        onProgress: (f, stage) => {
          status.textContent = stage === 'detect' ? '하늘을 찾는 중입니다…' : `하늘을 맞추는 중입니다… ${Math.round(f * 100)}%`;
        },
      });
      if (controller !== running) return;
      last = result;
      drawPhoto();
      const sky = renderer().render(result.theta, result.camera, FIT_TIME, tw, th);
      drawImage(skyCanvas, { width: tw, height: th, data: sky });
      hooks.apply(result.theta, result.camera);
      const night = result.classLoss
        ? ` · 밤 효과 ${NIGHT_LABELS[result.theta.nightEffect]} (${[0, 1, 2].map((c) => `${NIGHT_LABELS[c]} ${result.classLoss![c].toFixed(1)}`).join(', ')})`
        : '';
      status.textContent =
        `분위기 거리 ${result.loss.toFixed(1)} · ${(result.ms / 1000).toFixed(1)}초 · 렌더 ${result.renders}회` +
        ` · 하늘 ${(result.detection.coverage * 100).toFixed(0)}%, 신뢰도 ${result.detection.confidence.toFixed(2)}` +
        ` · 해 고도 ${result.theta.sunElevation.toFixed(1)}°${night}`;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      status.classList.add('error');
      status.textContent = `맞추지 못했습니다: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      if (controller === running) running = null;
    }
  }

  button.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) void open(file, file.name);
  });
  panel.querySelector('.match-close')!.addEventListener('click', () => {
    running?.abort();
    panel.hidden = true;
  });
  // Drop or paste an image anywhere on the page.
  window.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });
  window.addEventListener('drop', (event) => {
    const file = [...(event.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    void open(file, file.name);
  });
  window.addEventListener('paste', (event) => {
    const item = [...(event.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (file) void open(file, '붙여 넣은 사진');
  });

  // Development only: hooks for the local evaluation harness (verify/, not part of the app).
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__skyMatch = {
      render: (theta: SkyParams, camera: FitCamera, time: number, w: number, h: number) => Array.from(renderer().render(theta, camera, time, w, h)),
      score: (pixels: number[], w: number, h: number, theta: SkyParams, options: Record<string, unknown> = {}) => {
        const r = scoreTheta({ width: w, height: h, data: Uint8ClampedArray.from(pixels) }, renderer(), theta, options);
        return { total: r.total, terms: r.terms, camera: r.camera, glow: r.glow, horizonY: r.horizonY,
          target: { bands: Array.from(r.target.bands), stats: Array.from(r.target.stats), texture: Array.from(r.target.texture) },
          render: { bands: Array.from(r.render.bands), stats: Array.from(r.render.stats), texture: Array.from(r.render.texture) } };
      },
      match: async (pixels: number[], w: number, h: number, options: Record<string, unknown> = {}) => {
        const r = await matchPhoto({ width: w, height: h, data: Uint8ClampedArray.from(pixels) }, renderer(), options);
        return { theta: r.theta, camera: r.camera, loss: r.loss, terms: r.terms, classLoss: r.classLoss, renders: r.renders, ms: r.ms,
          detection: { horizonY: r.detection.horizonY, coverage: r.detection.coverage, confidence: r.detection.confidence, fallback: r.detection.fallback },
          glow: r.glow, analysis: { width: r.analysis.width, height: r.analysis.height, mask: Array.from(r.analysis.mask) } };
      },
    };
  }
  return { open };
}
