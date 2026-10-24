// The glass's pixels: an RGB565 frame, and what the Nextion draws into it.
//
// Text goes through export/src/textRaster.ts, the Editor's text geometry as
// measured on its debugger (bearings, centring, the clip at the box), blended
// over the background with the colour, channel by channel: the glass has no
// alpha, its fonts' antialiasing is a blend at draw time.
import { rasterizeZiTextInBox, ziAlphaTo255, type ZiFont } from "@nspanel-sim/export";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const r5 = (c: number) => (c >> 11) & 31;
const g6 = (c: number) => (c >> 5) & 63;
const b5 = (c: number) => c & 31;

/** c over under at a (0..255), per channel */
export function blend565(under: number, c: number, a: number): number {
  if (a <= 0) return under;
  if (a >= 255) return c;
  const mix = (u: number, v: number) => Math.round((u * (255 - a) + v * a) / 255);
  return (mix(r5(under), r5(c)) << 11) | (mix(g6(under), g6(c)) << 5) | mix(b5(under), b5(c));
}

/** RGB565 to 0xRRGGBB, the channels widened as the panel's LCD widens them */
export function rgb888(c: number): number {
  const r = r5(c), g = g6(c), b = b5(c);
  return (((r << 3) | (r >> 2)) << 16) | (((g << 2) | (g >> 4)) << 8) | ((b << 3) | (b >> 2));
}

export class Frame {
  readonly pixels: Uint16Array;
  /** counts every change, so a view knows when to paint again */
  version = 0;

  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint16Array(width * height);
  }

  private clip(box: Box): Box | null {
    const x0 = Math.max(0, box.x), y0 = Math.max(0, box.y);
    const x1 = Math.min(this.width, box.x + box.w), y1 = Math.min(this.height, box.y + box.h);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  fill(box: Box, color: number) {
    const b = this.clip(box);
    if (!b) return;
    for (let y = b.y; y < b.y + b.h; y++) this.pixels.fill(color & 0xffff, y * this.width + b.x, y * this.width + b.x + b.w);
    this.version++;
  }

  set(x: number, y: number, color: number) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.pixels[y * this.width + x] = color & 0xffff;
  }

  /**
   * The first octant of the Nextion's circles, from the top: stepping x, y goes
   * down at column x when x² + 2x + y² − y − r² ≥ 2, y being the row before. It
   * is the midpoint test of the next column, so y stays at r for a column or
   * two more than on the true circle, and the four extremes come out flat: 7
   * pixels wide at r = 16, where floor(√(r² − x²)) gives 1. Measured in the
   * Editor's debugger for every radius from 1 to 24, `cir` and `cirs` alike,
   * pixel for pixel.
   */
  private static octant(r: number): Array<[number, number]> {
    const points: Array<[number, number]> = [[0, r]];
    for (let x = 1, y = r; ; x++) {
      if (x * x + 2 * x + y * y - y - r * r >= 2) y--;
      if (x > y) break;
      points.push([x, y]);
    }
    return points;
  }

  /** `cirs`: the outline `cir` draws, every row filled between its two ends */
  disc(cx: number, cy: number, r: number, color: number) {
    if (r < 0) return;
    const half = new Map<number, number>();
    const reach = (dy: number, dx: number) => half.set(dy, Math.max(half.get(dy) ?? 0, dx));
    for (const [x, y] of Frame.octant(r)) { reach(y, x); reach(-y, x); reach(x, y); reach(-x, y); }
    for (const [dy, h] of half) for (let dx = -h; dx <= h; dx++) this.set(cx + dx, cy + dy, color);
    this.version++;
  }

  /** `cir`: the ring of radius r, the octant in its eight places */
  ring(cx: number, cy: number, r: number, color: number) {
    if (r < 0) return;
    for (const [x, y] of Frame.octant(r)) {
      for (const [a, b] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]]) this.set(cx + a, cy + b, color);
    }
    this.version++;
  }

  /** `line` / `draw`: Bresenham, both ends included */
  line(x0: number, y0: number, x1: number, y1: number, color: number) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    this.version++;
  }

  /**
   * A picture, or the part of it under a box: `crop` draws the picture's
   * pixels at the SAME position as the box (the Nextion's crop image is a
   * full-screen picture seen through the component), otherwise its top-left
   * corner goes at the box's.
   */
  picture(pic: { width: number; height: number; pixels: Uint16Array }, box: Box, crop = false) {
    const b = this.clip(box);
    if (!b) return;
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        const px = crop ? x : x - box.x;
        const py = crop ? y : y - box.y;
        if (px < 0 || py < 0 || px >= pic.width || py >= pic.height) continue;
        this.pixels[y * this.width + x] = pic.pixels[py * pic.width + px];
      }
    }
    this.version++;
  }

  /** a run of text in a box: the background is already there, and the glyphs blend over it */
  text(font: ZiFont, text: string, box: Box, color: number, xcen: number, ycen: number, spax = 0) {
    if (text === "" || box.w <= 0 || box.h <= 0) return;
    const { alpha } = rasterizeZiTextInBox(font, text, box, { xcen: xcen as 0 | 1 | 2, ycen: ycen as 0 | 1 | 2, spax });
    for (let y = 0; y < box.h; y++) {
      const fy = box.y + y;
      if (fy < 0 || fy >= this.height) continue;
      for (let x = 0; x < box.w; x++) {
        const a = alpha[y * box.w + x];
        if (!a) continue;
        const fx = box.x + x;
        if (fx < 0 || fx >= this.width) continue;
        const i = fy * this.width + fx;
        this.pixels[i] = blend565(this.pixels[i], color, ziAlphaTo255(a));
      }
    }
    this.version++;
  }

  /** the frame as RGBA bytes, for a canvas */
  rgba(out = new Uint8ClampedArray(this.width * this.height * 4)): Uint8ClampedArray {
    for (let i = 0; i < this.pixels.length; i++) {
      const c = rgb888(this.pixels[i]);
      out[i * 4] = c >> 16;
      out[i * 4 + 1] = (c >> 8) & 0xff;
      out[i * 4 + 2] = c & 0xff;
      out[i * 4 + 3] = 255;
    }
    return out;
  }
}
