// Minimal OpenEXR writer: scanline, RGB half float, ZIP compression (16 lines per block).
// Written for 8K sky panoramas: rows are added a strip at a time, so the full float image never
// has to sit in memory. Spec: https://openexr.com/en/latest/OpenEXRFileLayout.html
import { zlibSync } from 'three/examples/jsm/libs/fflate.module.js';

const LINES_PER_BLOCK = 16;

// float32 -> half via lookup tables (round toward zero, like three's DataUtils).
const halfBase = new Uint16Array(512);
const halfShift = new Uint8Array(512);
for (let i = 0; i < 256; i++) {
  const e = i - 127;
  let base: number;
  let shift: number;
  if (e < -24) [base, shift] = [0, 24];
  else if (e < -14) [base, shift] = [0x0400 >> (-e - 14), -e - 1];
  else if (e <= 15) [base, shift] = [(e + 15) << 10, 13];
  else if (e < 128) [base, shift] = [0x7c00, 24];
  else [base, shift] = [0x7c00, 13];
  halfBase[i] = base;
  halfBase[i | 0x100] = base | 0x8000;
  halfShift[i] = halfShift[i | 0x100] = shift;
}

class ByteWriter {
  private bytes: number[] = [];
  u8(v: number) { this.bytes.push(v & 0xff); }
  i32(v: number) { for (let i = 0; i < 4; i++) this.u8(v >>> (8 * i)); }
  f32(v: number) { const b = new Uint8Array(new Float32Array([v]).buffer); b.forEach((x) => this.u8(x)); }
  str(s: string) { for (const c of s) this.u8(c.charCodeAt(0)); this.u8(0); }
  attr(name: string, type: string, write: (w: ByteWriter) => void) {
    const body = new ByteWriter();
    write(body);
    this.str(name);
    this.str(type);
    this.i32(body.bytes.length);
    this.bytes.push(...body.bytes);
  }
  toArray() { return new Uint8Array(this.bytes); }
}

export class ExrWriter {
  private readonly blocks: Uint8Array[] = [];
  private readonly pending: Uint16Array; // one block of half rows: per line B, G, R planes
  private pendingLines = 0;
  private nextLine = 0;

  constructor(readonly width: number, readonly height: number) {
    this.pending = new Uint16Array(width * 3 * LINES_PER_BLOCK);
  }

  /** Adds rows top-down. `rgba` holds `rows` rows of width RGBA float pixels, top row first. */
  addRows(rgba: Float32Array, rows: number): void {
    const w = this.width;
    const bits = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.length);
    for (let r = 0; r < rows; r++) {
      const line = this.pending.subarray(this.pendingLines * w * 3, (this.pendingLines + 1) * w * 3);
      for (let x = 0; x < w; x++) {
        const s = (r * w + x) * 4;
        // Channels are stored alphabetically: B, G, R.
        for (let c = 0; c < 3; c++) {
          const f = bits[s + 2 - c];
          const k = (f >>> 23) & 0x1ff;
          line[c * w + x] = halfBase[k] + ((f & 0x7fffff) >>> halfShift[k]);
        }
      }
      this.pendingLines++;
      if (this.pendingLines === LINES_PER_BLOCK || this.nextLine + this.pendingLines === this.height) this.flush();
    }
  }

  private flush(): void {
    const lines = this.pendingLines;
    const raw = new Uint8Array(this.pending.buffer, 0, lines * this.width * 3 * 2);
    // ZIP predictor: split even and odd bytes, then store byte differences.
    const t = new Uint8Array(raw.length);
    const half = (raw.length + 1) >> 1;
    for (let i = 0, a = 0, b = half; i < raw.length; i += 2) {
      t[a++] = raw[i];
      if (i + 1 < raw.length) t[b++] = raw[i + 1];
    }
    let prev = t[0];
    for (let i = 1; i < t.length; i++) {
      const cur = t[i];
      t[i] = (cur - prev + 128 + 256) & 0xff;
      prev = cur;
    }
    let data: Uint8Array = zlibSync(t, { level: 4 });
    if (data.length >= raw.length) data = raw.slice(); // uncompressed block is allowed
    const block = new Uint8Array(8 + data.length);
    const view = new DataView(block.buffer);
    view.setInt32(0, this.nextLine, true);
    view.setInt32(4, data.length, true);
    block.set(data, 8);
    this.blocks.push(block);
    this.nextLine += lines;
    this.pendingLines = 0;
  }

  finish(): Blob {
    if (this.nextLine !== this.height) throw new Error(`EXR has ${this.nextLine} of ${this.height} rows`);
    const h = new ByteWriter();
    [0x76, 0x2f, 0x31, 0x01].forEach((b) => h.u8(b));
    h.i32(2); // version 2, single-part scanline
    h.attr('channels', 'chlist', (w) => {
      for (const name of ['B', 'G', 'R']) {
        w.str(name);
        w.i32(1); // HALF
        w.u8(0); w.u8(0); w.u8(0); w.u8(0); // pLinear + reserved
        w.i32(1);
        w.i32(1);
      }
      w.u8(0);
    });
    h.attr('compression', 'compression', (w) => w.u8(3)); // ZIP_COMPRESSION
    const box = (w: ByteWriter) => { w.i32(0); w.i32(0); w.i32(this.width - 1); w.i32(this.height - 1); };
    h.attr('dataWindow', 'box2i', box);
    h.attr('displayWindow', 'box2i', box);
    h.attr('lineOrder', 'lineOrder', (w) => w.u8(0)); // INCREASING_Y: first row is the top
    h.attr('pixelAspectRatio', 'float', (w) => w.f32(1));
    h.attr('screenWindowCenter', 'v2f', (w) => { w.f32(0); w.f32(0); });
    h.attr('screenWindowWidth', 'float', (w) => w.f32(1));
    h.u8(0);
    const header = h.toArray();
    const table = new DataView(new ArrayBuffer(8 * this.blocks.length));
    let offset = header.length + table.byteLength;
    this.blocks.forEach((block, i) => {
      table.setBigUint64(i * 8, BigInt(offset), true);
      offset += block.length;
    });
    return new Blob([header, table.buffer, ...this.blocks] as BlobPart[], { type: 'image/x-exr' });
  }
}
