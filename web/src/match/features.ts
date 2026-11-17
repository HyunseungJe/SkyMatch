// "Mood distance" between a photo and a sky render, both display-referred 8-bit sRGB at the same size,
// compared only inside the photo's sky mask. Units are roughly CIE76 ΔE: 0 = same, ~2 = hard to tell,
// ~10 = clearly different. Every term is position-tolerant enough that clouds in different places
// still count as the same mood.
import { SRGB_TO_LINEAR } from './image';

const BANDS = 8; // vertical profile: horizon-to-zenith gradient
const GX = 6, GY = 4; // coarse grid: where the glow and the bright side are

export interface Features {
  bands: Float32Array; // BANDS × (L, a, b)
  grid: Float32Array; // GX*GY × (L, a, b)
  /** L at the 10th, 50th and 90th percentile, mean chroma, std of a, std of b. */
  stats: Float32Array;
  /** Mean |∇L| at the analysis scale and at half scale (cloud structure). */
  texture: Float32Array;
}

const labF = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (t * 24389) / 27 / 116 + 16 / 116);
// 8-bit sRGB -> Lab is expensive; cache per channel triple is too big, so cache f() per channel instead.
const FX = new Float32Array(256 * 3), FY = new Float32Array(256 * 3), FZ = new Float32Array(256 * 3);
for (let i = 0; i < 256; i++) {
  const c = SRGB_TO_LINEAR[i];
  FX[i] = (0.4124564 * c) / 0.95047; FX[256 + i] = (0.3575761 * c) / 0.95047; FX[512 + i] = (0.1804375 * c) / 0.95047;
  FY[i] = 0.2126729 * c; FY[256 + i] = 0.7151522 * c; FY[512 + i] = 0.072175 * c;
  FZ[i] = (0.0193339 * c) / 1.08883; FZ[256 + i] = (0.119192 * c) / 1.08883; FZ[512 + i] = (0.9503041 * c) / 1.08883;
}

export class FeatureExtractor {
  readonly count: number;
  private readonly band: Int16Array;
  private readonly cell: Int16Array;
  private readonly bandWeight = new Float32Array(BANDS);
  private readonly cellWeight = new Float32Array(GX * GY);
  private readonly pixels: Int32Array;
  private readonly L: Float32Array;
  private readonly sorted: Float32Array;

  constructor(readonly width: number, readonly height: number, readonly mask: Uint8Array) {
    const n = width * height;
    const list: number[] = [];
    for (let p = 0; p < n; p++) if (mask[p]) list.push(p);
    if (!list.length) throw new Error('하늘 영역이 없습니다.');
    this.pixels = Int32Array.from(list);
    this.count = list.length;
    this.band = new Int16Array(n);
    this.cell = new Int16Array(n);
    // Bands span the sky's own vertical extent, so a low horizon still gets all eight bands.
    let top = height, bottom = 0;
    for (const p of list) {
      const y = Math.floor(p / width);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
    for (const p of list) {
      const x = p % width, y = Math.floor(p / width);
      this.band[p] = Math.min(BANDS - 1, Math.floor(((y - top) * BANDS) / (bottom - top + 1)));
      this.cell[p] = Math.min(GY - 1, Math.floor((y * GY) / height)) * GX + Math.min(GX - 1, Math.floor((x * GX) / width));
      this.bandWeight[this.band[p]]++;
      this.cellWeight[this.cell[p]]++;
    }
    this.L = new Float32Array(n);
    this.sorted = new Float32Array(this.count);
  }

  extract(rgba: Uint8Array | Uint8ClampedArray): Features {
    const { width: w, height: h, mask, L } = this;
    const bands = new Float32Array(BANDS * 3), grid = new Float32Array(GX * GY * 3);
    let sumA = 0, sumB = 0, sumA2 = 0, sumB2 = 0, sumC = 0;
    for (let k = 0; k < this.count; k++) {
      const p = this.pixels[k], i = p * 4;
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      const fx = labF(FX[r] + FX[256 + g] + FX[512 + b]);
      const fy = labF(FY[r] + FY[256 + g] + FY[512 + b]);
      const fz = labF(FZ[r] + FZ[256 + g] + FZ[512 + b]);
      const l = 116 * fy - 16, a = 500 * (fx - fy), bb = 200 * (fy - fz);
      L[p] = l;
      this.sorted[k] = l;
      const j = this.band[p] * 3, c = this.cell[p] * 3;
      bands[j] += l; bands[j + 1] += a; bands[j + 2] += bb;
      grid[c] += l; grid[c + 1] += a; grid[c + 2] += bb;
      sumA += a; sumB += bb; sumA2 += a * a; sumB2 += bb * bb; sumC += Math.hypot(a, bb);
    }
    for (let k = 0; k < BANDS; k++) for (let c = 0; c < 3; c++) bands[k * 3 + c] /= Math.max(1, this.bandWeight[k]);
    for (let k = 0; k < GX * GY; k++) for (let c = 0; c < 3; c++) grid[k * 3 + c] /= Math.max(1, this.cellWeight[k]);
    this.sorted.sort();
    const q = (f: number) => this.sorted[Math.min(this.count - 1, Math.floor(f * this.count))];
    const n = this.count;
    const stats = Float32Array.of(
      q(0.1), q(0.5), q(0.9), sumC / n,
      Math.sqrt(Math.max(0, sumA2 / n - (sumA / n) ** 2)), Math.sqrt(Math.max(0, sumB2 / n - (sumB / n) ** 2)),
    );
    // Texture: gradients only where both neighbours are sky (mask edges are not clouds).
    let t1 = 0, c1 = 0, t2 = 0, c2 = 0;
    for (let k = 0; k < this.count; k++) {
      const p = this.pixels[k], x = p % w, y = Math.floor(p / w);
      if (x + 1 < w && y + 1 < h && mask[p + 1] && mask[p + w]) {
        t1 += Math.abs(L[p + 1] - L[p]) + Math.abs(L[p + w] - L[p]);
        c1++;
      }
      if ((x & 1) === 0 && (y & 1) === 0 && x + 3 < w && y + 3 < h && mask[p + 3 + 3 * w] && mask[p + 2] && mask[p + 2 * w]) {
        const block = (o: number) => (L[o] + L[o + 1] + L[o + w] + L[o + w + 1]) / 4;
        const here = block(p);
        t2 += Math.abs(block(p + 2) - here) + Math.abs(block(p + 2 * w) - here);
        c2++;
      }
    }
    const texture = Float32Array.of(c1 ? t1 / c1 : 0, c2 ? t2 / c2 : 0);
    return { bands, grid, stats, texture };
  }

  /** Weighted squared distances per term; total = sqrt(sum), roughly ΔE. */
  distance(a: Features, b: Features): { total: number; terms: Record<string, number> } {
    const de2 = (x: Float32Array, y: Float32Array, k: number) =>
      (x[k] - y[k]) ** 2 + (x[k + 1] - y[k + 1]) ** 2 + (x[k + 2] - y[k + 2]) ** 2;
    let profile = 0, pw = 0;
    for (let k = 0; k < BANDS; k++) {
      profile += this.bandWeight[k] * de2(a.bands, b.bands, k * 3);
      pw += this.bandWeight[k];
    }
    let grid = 0, gw = 0;
    for (let k = 0; k < GX * GY; k++) {
      grid += this.cellWeight[k] * de2(a.grid, b.grid, k * 3);
      gw += this.cellWeight[k];
    }
    let stats = 0;
    for (let k = 0; k < 6; k++) stats += (a.stats[k] - b.stats[k]) ** 2;
    const texture = 4 * ((a.texture[0] - b.texture[0]) ** 2 + (a.texture[1] - b.texture[1]) ** 2);
    const terms = { profile: profile / pw, grid: (0.5 * grid) / gw, stats: 0.25 * stats, texture };
    const total = Math.sqrt(terms.profile + terms.grid + terms.stats + terms.texture);
    return { total, terms };
  }
}

/** Mean per-pixel CIE76 ΔE inside the mask (a plain image error for evaluation). */
export function meanDeltaE(ext: FeatureExtractor, a: Uint8Array | Uint8ClampedArray, b: Uint8Array | Uint8ClampedArray): number {
  let sum = 0, count = 0;
  const lab = (d: Uint8Array | Uint8ClampedArray, i: number) => {
    const r = d[i], g = d[i + 1], bl = d[i + 2];
    const fx = labF(FX[r] + FX[256 + g] + FX[512 + bl]);
    const fy = labF(FY[r] + FY[256 + g] + FY[512 + bl]);
    const fz = labF(FZ[r] + FZ[256 + g] + FZ[512 + bl]);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  };
  for (let p = 0; p < ext.width * ext.height; p++) {
    if (!ext.mask[p]) continue;
    const x = lab(a, p * 4), y = lab(b, p * 4);
    sum += Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
    count++;
  }
  return count ? sum / count : 0;
}
