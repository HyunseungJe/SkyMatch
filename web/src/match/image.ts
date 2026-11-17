// Small RGBA images and colour helpers for photo analysis. Everything stays in the browser.

/** 8-bit sRGB RGBA pixels, row 0 at the top (ImageData layout). */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** sRGB 8-bit -> linear, table. */
export const SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

export function linearToSrgb8(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

const labF = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (t * 24389) / 27 / 116 + 16 / 116);

/** CIE Lab (D65) of an 8-bit sRGB colour: L in 0..100, a/b in roughly -128..127. */
export function srgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = SRGB_TO_LINEAR[r], G = SRGB_TO_LINEAR[g], B = SRGB_TO_LINEAR[b];
  const fx = labF((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047);
  const fy = labF(0.2126729 * R + 0.7151522 * G + 0.072175 * B);
  const fz = labF((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Lab of every pixel, packed L,a,b. */
export function imageLab(image: RgbaImage): Float32Array {
  const n = image.width * image.height;
  const out = new Float32Array(n * 3);
  for (let p = 0; p < n; p++) {
    const [L, a, b] = srgbToLab(image.data[p * 4], image.data[p * 4 + 1], image.data[p * 4 + 2]);
    out[p * 3] = L;
    out[p * 3 + 1] = a;
    out[p * 3 + 2] = b;
  }
  return out;
}

/** Area-averaging resize (also handles enlargement and any aspect). */
export function resizeImage(image: RgbaImage, width: number, height: number): RgbaImage {
  const out = new Uint8ClampedArray(width * height * 4);
  const sx = image.width / width, sy = image.height / height;
  const sum = [0, 0, 0, 0];
  for (let y = 0; y < height; y++) {
    const top = y * sy, bottom = (y + 1) * sy;
    for (let x = 0; x < width; x++) {
      const left = x * sx, right = (x + 1) * sx;
      sum[0] = sum[1] = sum[2] = sum[3] = 0;
      let total = 0;
      for (let yy = Math.floor(top); yy < Math.ceil(bottom); yy++) {
        const wy = Math.min(bottom, yy + 1) - Math.max(top, yy);
        const row = Math.min(image.height - 1, yy) * image.width;
        for (let xx = Math.floor(left); xx < Math.ceil(right); xx++) {
          const w = wy * (Math.min(right, xx + 1) - Math.max(left, xx));
          const i = (row + Math.min(image.width - 1, xx)) * 4;
          for (let k = 0; k < 4; k++) sum[k] += image.data[i + k] * w;
          total += w;
        }
      }
      for (let k = 0; k < 4; k++) out[(y * width + x) * 4 + k] = sum[k] / total;
    }
  }
  return { width, height, data: out };
}

/** Nearest-neighbour resize of a 0/1 mask, then 0/1 again by majority of the covered area. */
export function resizeMask(mask: Uint8Array, w: number, h: number, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  const sx = w / width, sy = h / height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = 0, all = 0;
      for (let yy = Math.floor(y * sy); yy < Math.max(Math.floor(y * sy) + 1, Math.ceil((y + 1) * sy)); yy++) {
        for (let xx = Math.floor(x * sx); xx < Math.max(Math.floor(x * sx) + 1, Math.ceil((x + 1) * sx)); xx++) {
          on += mask[Math.min(h - 1, yy) * w + Math.min(w - 1, xx)];
          all++;
        }
      }
      // A cell is sky only when (almost) all of it is sky: mixed edge pixels carry foreground colour.
      out[y * width + x] = on >= all * 0.9 ? 1 : 0;
    }
  }
  return out;
}

/** Fits the longest side into `longest` pixels, keeping the aspect ratio. */
export function fitSize(width: number, height: number, longest: number): [number, number] {
  const s = longest / Math.max(width, height);
  return [Math.max(1, Math.round(width * s)), Math.max(1, Math.round(height * s))];
}

/** Decodes a photo file (EXIF orientation applied) into an RGBA image no larger than `longest`. */
export async function loadPhoto(file: Blob, longest = 1024): Promise<RgbaImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const [w, h] = fitSize(bitmap.width, bitmap.height, Math.min(longest, Math.max(bitmap.width, bitmap.height)));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const data = ctx.getImageData(0, 0, w, h, { colorSpace: 'srgb' }).data;
  return { width: w, height: h, data };
}
