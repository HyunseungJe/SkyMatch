// Photo analysis before fitting: sky mask, horizon, camera guess, warm glow, time-of-day hint.
// Hand-written heuristics, no learned model and no external data.
import { imageLab, resizeImage, type RgbaImage } from './image';

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

export interface SkyDetection {
  /** 1 = sky, at the size of the analysed image. */
  mask: Uint8Array;
  width: number;
  height: number;
  /** Fraction of the image height (0 = top) where the sky ends; > 1 means no horizon in view. */
  horizonY: number;
  coverage: number;
  /** 0..1, low when the boundary is ragged or the sky was not found. */
  confidence: number;
  /** True when no sky region was found and the upper half was assumed. */
  fallback: boolean;
}

/**
 * Sky = region connected to the top edge through pixels that look like sky (not foliage, not a dark
 * flat silhouette, not strongly textured unless clearly bright, blue or warm). Each column is then cut
 * at the first sustained non-sky run, so holes under trees and buildings never count as sky.
 * Analysis runs at most 256 pixels wide.
 */
export function detectSky(image: RgbaImage): SkyDetection {
  const w = Math.min(256, image.width);
  const h = Math.max(1, Math.round((image.height * w) / image.width));
  const small = w === image.width ? image : resizeImage(image, w, h);
  const n = w * h;
  const lab = imageLab(small);
  const L = (p: number) => lab[p * 3];

  const topRows = Math.max(1, Math.ceil(h * 0.15));
  const top: number[] = [];
  for (let p = 0; p < w * topRows; p++) top.push(L(p));
  const upper = median(top);
  const night = upper < 12;
  const floorL = night ? Math.max(1.5, upper * 0.35) : clamp(upper * 0.45, 8, 30);

  const possible = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x, i = p * 4;
      const r = small.data[i], g = small.data[i + 1], b = small.data[i + 2];
      const l = L(p), A = lab[p * 3 + 1], B = lab[p * 3 + 2];
      const rough = Math.abs(l - L(y * w + Math.max(0, x - 1))) + Math.abs(l - L(Math.max(0, y - 1) * w + x));
      const foliage = g > r * 1.1 + 4 && g > b * 1.05 + 4;
      const blue = B < -6 && b > r;
      const warm = A + B > 18 && r > b;
      const chroma = Math.hypot(A, B);
      const darkFlat = l < floorL && chroma < 6;
      possible[p] = night
        ? +(!foliage && rough < 8)
        : +(!foliage && !darkFlat && (l > floorL || blue) && (rough < 14 || blue || warm || l > floorL * 1.6 || y < h * 0.1));
    }
  }

  const sky = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  // Several top rows: a branch along the very top edge must not block the whole sky.
  for (let y = 0; y < Math.max(1, Math.ceil(h * 0.06)); y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (possible[p] && !sky[p]) {
        sky[p] = 1;
        queue[tail++] = p;
      }
    }
  }
  while (head < tail) {
    const p = queue[head++], x = p % w;
    const neighbours = [x > 0 ? p - 1 : -1, x + 1 < w ? p + 1 : -1, p - w, p + w];
    for (const q of neighbours) {
      if (q >= 0 && q < n && possible[q] && !sky[q]) {
        sky[q] = 1;
        queue[tail++] = q;
      }
    }
  }

  const run = Math.max(2, Math.ceil(h * 0.02));
  const boundaries: number[] = [];
  for (let x = 0; x < w; x++) {
    let boundary = h, misses = 0;
    for (let y = Math.floor(h * 0.1); y < h; y++) {
      misses = sky[y * w + x] ? 0 : misses + 1;
      if (misses >= run) {
        boundary = y - run + 1;
        break;
      }
    }
    // Above the cut, small holes (birds, the sun's bloom, a cloud edge) are sky; below it nothing is.
    for (let y = 0; y < h; y++) sky[y * w + x] = y < boundary ? (y < Math.floor(h * 0.1) ? sky[y * w + x] : 1) : 0;
    boundaries.push(boundary / h);
  }

  let count = 0;
  for (let p = 0; p < n; p++) count += sky[p];
  let fallback = false;
  if (count < n * 0.03) {
    fallback = true;
    sky.fill(0);
    for (let p = 0; p < w * Math.ceil(h * 0.5); p++) sky[p] = 1;
    count = w * Math.ceil(h * 0.5);
  }
  const horizon = median(boundaries);
  const spread = boundaries.reduce((s, v) => s + Math.abs(v - horizon), 0) / w;
  const horizonY = fallback ? 0.5 : horizon > 0.98 ? 1.15 : horizon;
  const coverage = count / n;
  const confidence = fallback ? 0.1 : clamp(0.95 - spread * 2 - (coverage < 0.15 ? 0.3 : 0), 0.15, 0.95);
  return { mask: sky, width: w, height: h, horizonY, coverage, confidence, fallback };
}

export interface PhotoCamera {
  /** Vertical field of view in degrees. */
  fov: number;
  /** Degrees above the horizon of the image centre. */
  pitch: number;
}

/** Long side of a typical phone main camera (26 mm equivalent) spans about 66 degrees. */
export const DEFAULT_LONG_SIDE_FOV = 66;

/** Vertical FOV from the long-side FOV and the aspect ratio. */
export function verticalFov(width: number, height: number, longSideFov = DEFAULT_LONG_SIDE_FOV): number {
  const t = Math.tan((longSideFov * Math.PI) / 360) * (height / Math.max(width, height));
  return (2 * Math.atan(t) * 180) / Math.PI;
}

/** Pitch that puts the horizon at `horizonY` (0 = top of the image). */
export function estimateCamera(width: number, height: number, horizonY: number): PhotoCamera {
  const fov = verticalFov(width, height);
  if (horizonY > 1) return { fov, pitch: fov / 2 + 5 };
  const t = Math.tan((fov * Math.PI) / 360);
  return { fov, pitch: (Math.atan((2 * clamp(horizonY, 0, 1) - 1) * t) * 180) / Math.PI };
}

export type TimeHint = 'day' | 'golden' | 'sunset' | 'twilight' | 'night';

export interface GlowDetection {
  present: boolean;
  /** Warm glow centroid, 0..1 from the left / top. */
  x: number;
  y: number;
  /** Mean warmth-weighted brightness, 0..1. */
  strength: number;
  /** Mean sky lightness (Lab L, 0..100). */
  meanL: number;
  timeHint: TimeHint;
}

/** Broad warm luminous area inside the sky mask (sunset glow) and a coarse time-of-day hint. */
export function detectGlow(image: RgbaImage, mask: Uint8Array): GlowDetection {
  const { width: w, height: h } = image;
  const lab = imageLab(image);
  let weight = 0, sx = 0, sy = 0, sumL = 0, count = 0, warmCount = 0, bright = 0, bx = 0, by = 0;
  for (let p = 0; p < w * h; p++) {
    if (!mask[p]) continue;
    const L = lab[p * 3], A = lab[p * 3 + 1], B = lab[p * 3 + 2];
    const warmth = Math.max(0, B + 0.35 * A - 4) / 60;
    const q = warmth * Math.max(0, L - 15) / 85;
    const x = ((p % w) + 0.5) / w, y = (Math.floor(p / w) + 0.5) / h;
    weight += q; sx += q * x; sy += q * y;
    const s = Math.max(0, L - 92) ** 2;
    bright += s; bx += s * x; by += s * y;
    sumL += L;
    warmCount += +(warmth > 0.2 && L > 30);
    count++;
  }
  if (!count) return { present: false, x: 0.5, y: 0.8, strength: 0, meanL: 0, timeHint: 'day' };
  const meanL = sumL / count;
  const strength = weight / count;
  const warmPresent = strength > 0.01 && warmCount / count > 0.01;
  const present = warmPresent || bright > 0;
  const x = warmPresent ? sx / weight : bright ? bx / bright : 0.5;
  const y = warmPresent ? sy / weight : bright ? by / bright : 0.8;
  const timeHint: TimeHint =
    meanL < 12 ? 'night' : warmPresent ? (warmCount / count > 0.35 || meanL < 45 ? 'sunset' : 'golden') : meanL < 35 ? 'twilight' : 'day';
  return { present, x, y, strength: clamp(strength / 0.2, 0, 1), meanL, timeHint };
}
