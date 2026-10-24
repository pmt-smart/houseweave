// Turning a .zi font into pixels on a line
// ---------------------------------------------------------------------------
//
// `font.ts` answers "what does this glyph look like". This answers "where does
// it go", which is the other half the simulator's compiled view needs, and the
// half that had been guessed until the Editor's debugger was made to answer it.
//
// What IS measured here:
//
// - the glyph bitmap is `advance + kerningLeft + kerningRight` wide, and the
//   kerning columns CARRY INK: across the corpus, 469 of the 485 glyphs with a
//   left kerning have ink inside those columns (442 of 457 on the right). The
//   clearest case is `liber` U+006A, a `j` whose tail is drawn in the single
//   kerningLeft column. So kerning is not padding -- it is overhang, and the
//   bitmap is wider than the cell the glyph occupies on the line;
// - kerning is rare but not negligible: none at all in the big NotoSans fonts,
//   5 glyphs in `liber`, and 300 of 2248 in the two `noto-sans-*-sp5` fonts the
//   joBr99 panel actually ships;
// - the pen advances by the glyph's `advance`, and the bitmap is drawn starting
//   `kerningLeft` pixels to its LEFT, so neighbouring bitmaps overlap. MEASURED
//   on the Editor's debugger (scenario `d1-08-text-metrics`): "|iiiiiiiiii|" and
//   "|jjjjjjjjjj|" have the same advance width but differ by ten pixels of
//   bitmap, and on the glass they end at exactly the same column. Against the
//   screenshot this model correlates 0.88 and the edge-to-edge one 0.24, and
//   every line's best alignment is dx=0, dy=0 -- no fudge anywhere. The other
//   model is kept as `advanceModel: "bitmap"` only so the refutation stays
//   runnable;
// - a whole run drawn this way matches the debugger pixel for pixel, up to the
//   sandbox desktop's own 125% resampling: "Hamburgefonstiv 0123" correlates
//   0.92 at the true alignment against 0.48 one pixel off. That is as close to
//   "the glyphs draw correctly" as anything short of hardware gets;
// - where two bitmaps overlap, **the stronger pixel wins**: a glyph does not
//   paint its background over its neighbour. This one took a second font to
//   ask, because in `liber` the two candidate rules give identical pixels on
//   every string the font can write -- all five of its kerned glyphs kern only
//   to the left, so the overlap always lands on a blank column. `d1-11` brings
//   `noto-sans-32-sp5` from the joBr99 project, which has 246 glyphs with a
//   right kerning and 230 with a left one, and repeats the pair that disagrees
//   most. Of the 254 pixels where the two rules predict different values, this
//   one is closer on **239** and the other on 15.
//
// The box rules -- alignment, spacing and clipping -- are at the bottom of the
// file, each citing the component that measured it.

import { ZI_ALPHA_MAX, decodeZiGlyph, ziBitmapWidth, ziGlyphMap } from "./font.js";
import type { ZiFont, ZiGlyph } from "./font.js";

/** Where the pen goes after a glyph. `"bearing"` is the measured one. */
export type ZiAdvanceModel = "bearing" | "bitmap";

export interface ZiTextOptions {
  /** default `"bearing"`, which is the one the debugger shows */
  advanceModel?: ZiAdvanceModel;
  /**
   * Extra pixels between glyphs -- the component's `spax`. Measured (d1-09):
   * they go BETWEEN glyphs and nowhere else. With `spax` 5 the four stems of
   * "iiii" sit 11 pixels apart instead of 6, and the first one is still exactly
   * at the component's x, so there is no leading gap; nor is there a trailing
   * one. Default 0.
   */
  spacing?: number;
  /** codepoint to draw in place of one the font lacks; default: draw nothing */
  fallback?: number;
  /**
   * What happens where two bitmaps overlap -- which under the bearing model is
   * every boundary where the following glyph carries a left kerning. `"max"`
   * keeps the stronger pixel; `"overwrite"` lets the later glyph paint its
   * whole rectangle, background included. Default `"max"`, which is the one
   * the debugger shows (d1-11); `"overwrite"` is kept so the refutation stays
   * runnable. Note that `liber` cannot tell them apart at all -- see the header.
   */
  composite?: "max" | "overwrite";
}

export interface ZiPlacement {
  /** the codepoint asked for */
  code: number;
  /** the glyph used -- `undefined` when the font has neither it nor a fallback */
  glyph: ZiGlyph | undefined;
  /** pen position before this glyph, relative to the run's origin */
  pen: number;
  /** left edge of the bitmap; under `bearing` this is `pen - kerningLeft` */
  x: number;
  /** bitmap width, i.e. `ziBitmapWidth(glyph)` */
  width: number;
}

export interface ZiTextLayout {
  placements: ZiPlacement[];
  /** where the pen ends: what the next run would start from */
  advance: number;
  /** leftmost bitmap edge; negative when the first glyph overhangs to the left */
  left: number;
  /** rightmost bitmap edge */
  right: number;
  height: number;
  /** codepoints the font did not have, in order, without duplicates */
  missing: number[];
  advanceModel: ZiAdvanceModel;
}

/**
 * Turns a string into the codepoints a `.zi` stores, which is not always what
 * `String#codePointAt` gives:
 *
 * - code page 0x03 is ISO-8859-1, one byte per character, so anything above
 *   U+00FF has no representation at all;
 * - code page 0x18 is UTF-8, and the glyph records key on the Unicode
 *   codepoint in a u16 field -- the Basic Multilingual Plane and no more, which
 *   is why an emoji outside it cannot be addressed even when the font has art
 *   for it. The panel's own icons live in the private use area (U+E000..U+F8FF)
 *   and fit.
 *
 * Throws rather than dropping characters: a label silently losing a letter on
 * the glass is worse than a build that stops.
 */
export function ziEncodeText(font: ZiFont, text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (font.codePage === 0x03 && cp > 0xff)
      throw new RangeError(`.zi text: U+${cp.toString(16).toUpperCase()} has no place in an ISO-8859-1 font ("${font.name}")`);
    if (cp > 0xffff)
      throw new RangeError(`.zi text: U+${cp.toString(16).toUpperCase()} is outside the BMP, and a glyph record's code is 16 bits`);
    out.push(cp);
  }
  return out;
}

/** Places each codepoint of a string on the line. Does not decode any pixels. */
export function layoutZiText(font: ZiFont, text: string, options: ZiTextOptions = {}): ZiTextLayout {
  const model = options.advanceModel ?? "bearing";
  const spacing = options.spacing ?? 0;
  const map = ziGlyphMap(font);
  const fallback = options.fallback === undefined ? undefined : map.get(options.fallback);

  const placements: ZiPlacement[] = [];
  const missing: number[] = [];
  let pen = 0;
  let left = 0;
  let right = 0;
  let first = true;

  for (const code of ziEncodeText(font, text)) {
    let glyph = map.get(code);
    if (glyph === undefined) {
      if (!missing.includes(code)) missing.push(code);
      glyph = fallback;
    }
    if (glyph === undefined) {
      placements.push({ code, glyph: undefined, pen, x: pen, width: 0 });
      continue;
    }
    const width = ziBitmapWidth(glyph);
    const x = model === "bearing" ? pen - glyph.kerningLeft : pen;
    placements.push({ code, glyph, pen, x, width });
    if (first) {
      left = x;
      right = x + width;
      first = false;
    } else {
      left = Math.min(left, x);
      right = Math.max(right, x + width);
    }
    pen += (model === "bearing" ? glyph.advance : width) + spacing;
  }
  // the trailing spacing is a gap after the last glyph, not part of the run
  if (spacing !== 0 && placements.length > 0) pen -= spacing;

  return { placements, advance: pen, left, right, height: font.height, missing, advanceModel: model };
}

export interface ZiRaster {
  width: number;
  height: number;
  /** one alpha per pixel, 0 (clear) to 7 (opaque), row by row */
  alpha: Uint8Array;
  /** x of the run's origin inside the raster: `-layout.left`, so never negative */
  originX: number;
  layout: ZiTextLayout;
}

/**
 * Draws a string into an alpha plane exactly wide enough to hold it. The plane
 * starts at the leftmost ink, which under `bearing` can be left of the pen --
 * `originX` says by how much, so a caller that wants the pen at a given x knows
 * where to put the plane.
 *
 * Overlapping bitmaps composite by taking the stronger alpha, which is what the
 * debugger shows (see the header).
 */
export function rasterizeZiText(font: ZiFont, text: string, options: ZiTextOptions = {}): ZiRaster {
  const layout = layoutZiText(font, text, options);
  const originX = -layout.left;
  const width = Math.max(0, layout.right - layout.left);
  const height = font.height;
  const alpha = new Uint8Array(width * height);
  const overwrite = options.composite === "overwrite";

  for (const p of layout.placements) {
    if (p.glyph === undefined || p.glyph.data.length === 0) continue;
    const pixels = decodeZiGlyph(p.glyph.data, p.width * height);
    const x0 = p.x + originX;
    for (let y = 0; y < height; y++) {
      const src = y * p.width;
      const dst = y * width + x0;
      for (let x = 0; x < p.width; x++) {
        const a = pixels[src + x];
        if (overwrite || a > alpha[dst + x]) alpha[dst + x] = a;
      }
    }
  }
  return { width, height, alpha, originX, layout };
}

/**
 * A single glyph as an alpha plane -- the case the icon sets need, where a
 * "text" is one private-use codepoint.
 */
export function rasterizeZiGlyph(font: ZiFont, code: number): ZiRaster {
  return rasterizeZiText(font, String.fromCodePoint(code));
}

/**
 * Alpha 0..7 as 0..255, the way the C# font editor does it (`(255/7) * alpha`).
 * Kept as the one place that conversion lives, so a renderer never invents it.
 */
export function ziAlphaTo255(alpha: number): number {
  return Math.round((255 / ZI_ALPHA_MAX) * alpha);
}

/**
 * The raster as text, for eyeballing in a terminal and for a test failure that
 * has to be readable by a human. Ten steps because the alpha has eight.
 */
export function ziRasterToAscii(raster: ZiRaster, ramp = " .:-=+*#%@"): string {
  const lines: string[] = [];
  for (let y = 0; y < raster.height; y++) {
    let line = "";
    for (let x = 0; x < raster.width; x++)
      line += ramp[Math.min(ramp.length - 1, Math.round((raster.alpha[y * raster.width + x] / ZI_ALPHA_MAX) * (ramp.length - 1)))];
    lines.push(line);
  }
  return lines.join("\n");
}


// ---------------------------------------------------------------------------
// Placing a run inside a component's box
//
// Everything below is measured on the Editor's debugger, in `d1-09` and
// `d1-10`, each rule against a rasterization of the same string: the predicted
// position wins at dx=0, dy=0 with no offset fitted anywhere, and one pixel off
// in either direction is visibly worse. `scripts/compare-debugger.mjs` is the
// harness, and the scenario descriptions say which component measures what.

/** The component's rectangle, in display pixels. */
export interface ZiTextBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** `xcen` and `ycen`: 0 near edge, 1 centre, 2 far edge. */
export interface ZiBoxAlign {
  xcen?: 0 | 1 | 2;
  ycen?: 0 | 1 | 2;
  /** the component's `spax` */
  spax?: number;
}

export interface ZiBoxPlacement {
  /** where the pen starts, in display coordinates */
  penX: number;
  /** display row the glyph's top row lands on */
  topY: number;
  /** the box clips the drawing to these display columns, both inclusive */
  clipLeft: number;
  clipRight: number;
  /** true when the run is wider than the box, so the tail never reaches the glass */
  clipped: boolean;
  layout: ZiTextLayout;
}

/**
 * Where a single-line Text component puts its run.
 *
 * - `xcen` 0 puts the pen at the box's x; 1 at `x + floor((w - advance) / 2)`,
 *   flooring the half pixel (measured with an odd remainder, `d1-10` `odd`:
 *   441 - 72 is 369, and the run sits at 204, not 205); 2 at `x + w - advance`.
 *   The width that matters is the sum of the advances, not the ink extent --
 *   which is how the centred "|iiiiiiiiii|" and "|jjjjjjjjjj|" of `d1-09` land
 *   on exactly the same column despite different bitmaps.
 * - `ycen` mirrors it over the FONT's height, not the ink's: 0 puts the glyph's
 *   top row on the box's y, 1 at `y + floor((h - height) / 2)`, 2 at
 *   `y + h - height`.
 * - a run too wide is **clipped at the box and nothing else**: it is not
 *   wrapped, not shrunk, not dropped. Measured on `d1-10` `ovf`, 234 pixels of
 *   text in a 100-pixel box: it starts at the box's x as usual and the last
 *   inked column is `x + w - 1`, mid-letter. `spay` changes nothing (`wrap`
 *   renders identically), so a Text is one line whatever you set.
 *
 * What this does NOT cover, because it was not measured: the vertical clip (no
 * scenario yet puts a run taller than its box), and what a centring whose
 * remainder is negative does -- `xcen` 1 with a run wider than the box would
 * compute a pen left of it, and the Editor may well clamp instead.
 */
export function placeZiText(font: ZiFont, text: string, box: ZiTextBox, align: ZiBoxAlign = {}, options: ZiTextOptions = {}): ZiBoxPlacement {
  const layout = layoutZiText(font, text, { ...options, spacing: align.spax ?? options.spacing ?? 0 });
  const xcen = align.xcen ?? 0;
  const ycen = align.ycen ?? 0;
  const penX = box.x + (xcen === 0 ? 0 : xcen === 1 ? Math.floor((box.w - layout.advance) / 2) : box.w - layout.advance);
  const topY = box.y + (ycen === 0 ? 0 : ycen === 1 ? Math.floor((box.h - layout.height) / 2) : box.h - layout.height);
  return {
    penX,
    topY,
    clipLeft: box.x,
    clipRight: box.x + box.w - 1,
    clipped: layout.advance > box.w,
    layout,
  };
}

/**
 * The component as it reaches the glass: an alpha plane the size of the box,
 * with the run placed and clipped inside it. This is what a compiled view draws
 * -- blend it over the component's `bco` with its `pco` and the result is the
 * pixels the panel shows.
 */
export function rasterizeZiTextInBox(font: ZiFont, text: string, box: ZiTextBox, align: ZiBoxAlign = {}, options: ZiTextOptions = {}): { placement: ZiBoxPlacement; alpha: Uint8Array } {
  const placement = placeZiText(font, text, box, align, options);
  const run = rasterizeZiText(font, text, { ...options, spacing: align.spax ?? options.spacing ?? 0 });
  const alpha = new Uint8Array(box.w * box.h);
  const left = placement.penX - run.originX;
  for (let y = 0; y < run.height; y++) {
    const dy = placement.topY - box.y + y;
    if (dy < 0 || dy >= box.h) continue;
    for (let x = 0; x < run.width; x++) {
      const dx = left - box.x + x;
      if (dx < 0 || dx >= box.w) continue;
      alpha[dy * box.w + dx] = run.alpha[y * run.width + x];
    }
  }
  return { placement, alpha };
}

// ---------------------------------------------------------------------------
// Fitting a runtime text to its box, the way the panel runtime does it
// ---------------------------------------------------------------------------
//
// A Text whose value arrives at run time is WRITTEN by the ESP32 (the
// generated PanelRuntime, `export/scripts/build-project-hmi.mjs`), and the
// glass neither wraps nor shrinks: what runs past the box is cut at the box
// edge, mid-letter. So the runtime cuts first, at a whole character, and
// keeps the longest start of the text whose advances add up to the box, and
// not a character COUNT -- the widest glyph's worth, and the narrowest place the
// text appears -- which would let a light's name be 6 characters everywhere
// because one card is 98 px wide.
//
// The runtime measures with a table rather than a font: one advance per code
// point from U+0020 to U+00FF (`ziAdvanceTable`), 224 bytes, which is every
// character the theme text fonts carry. The same table drives `fitZiText`, so
// the simulator, the tests and the panel make the same cut.

/** First and last code point the runtime can measure. */
export const FIT_FIRST = 0x20;
export const FIT_LAST = 0xff;

/**
 * The advance of every code point U+0020..U+00FF, in pixels; 0 where the font
 * has no glyph, which on the glass draws nothing and moves nothing.
 */
export function ziAdvanceTable(font: ZiFont): Uint8Array {
  const map = ziGlyphMap(font);
  const table = new Uint8Array(FIT_LAST - FIT_FIRST + 1);
  for (let cp = FIT_FIRST; cp <= FIT_LAST; cp++) table[cp - FIT_FIRST] = Math.min(255, map.get(cp)?.advance ?? 0);
  return table;
}

/**
 * What a cut text ends in, so nobody reads it as the whole name. Two full
 * stops, and not U+2026: the theme text fonts
 * are ASCII and Latin-1 subsets, and "…" is in neither.
 */
export const FIT_ELLIPSIS = "..";

const utf8Size = (cp: number) => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);
const advanceOf = (table: Uint8Array, cp: number) => (cp === 0x22 || cp < FIT_FIRST || cp > FIT_LAST ? 0 : table[cp - FIT_FIRST]);

/**
 * `text` as the runtime writes it into a box `width` pixels wide with a
 * `maxBytes` buffer (the Text's `txt_maxl`): whole when it fits, and otherwise
 * the longest start that still leaves room for `FIT_ELLIPSIS`, trailing spaces
 * dropped, with the ellipsis after it. Never cut mid-letter, which is what the
 * glass does to a text that runs past its box.
 *
 * A double quote is measured as nothing, because the runtime drops it before
 * writing (a Nextion string has no escape for it); anything past U+00FF too,
 * because no theme text font carries it.
 */
export function fitZiText(table: Uint8Array, text: string, width: number, maxBytes = Infinity): string {
  const chars = [...text];
  // how many characters of the text fit `w` pixels and `b` bytes
  const longest = (w: number, b: number) => {
    let pen = 0;
    let bytes = 0;
    let n = 0;
    for (; n < chars.length; n++) {
      const cp = chars[n].codePointAt(0) as number;
      if (pen + advanceOf(table, cp) > w || bytes + utf8Size(cp) > b) break;
      pen += advanceOf(table, cp);
      bytes += utf8Size(cp);
    }
    return n;
  };
  if (longest(width, maxBytes) === chars.length) return text;
  let tail = 0;
  for (const ch of FIT_ELLIPSIS) tail += advanceOf(table, ch.codePointAt(0) as number);
  const room = width - tail;
  const roomBytes = maxBytes - FIT_ELLIPSIS.length;
  // a box too narrow for even the ellipsis keeps what fits of the text itself
  if (room < 0 || roomBytes < 0) return chars.slice(0, longest(width, maxBytes)).join("");
  return chars.slice(0, longest(room, roomBytes)).join("").replace(/ +$/, "") + FIT_ELLIPSIS;
}

/**
 * `paragraphs` broken into lines no wider than `width` pixels, for a body
 * drawn as several Texts one under another (Help's). A Nextion Text does not
 * wrap, so the lines are cut here -- by the build for the glass, and by the
 * simulator with this same function -- at the width of the layout the text
 * lands in. Cut by hand, once, for the narrowest panel, the landscape one would
 * show them in two thirds of its width.
 *
 * Each paragraph starts a line of its own, and "" is a blank line. Words stay
 * whole; one wider than a whole line on its own is split at the letter that no
 * longer fits, because otherwise the glass cuts it in the middle of one.
 * Measured like `fitZiText`, so a line this returns is one it keeps whole.
 */
export function wrapZiText(table: Uint8Array, paragraphs: readonly string[], width: number): string[] {
  const measure = (s: string) => {
    let pen = 0;
    for (const ch of s) pen += advanceOf(table, ch.codePointAt(0) as number);
    return pen;
  };
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    let line = "";
    for (const word of paragraph.split(" ").filter(Boolean)) {
      const joined = line ? `${line} ${word}` : word;
      if (measure(joined) <= width) {
        line = joined;
        continue;
      }
      if (line) lines.push(line);
      let rest = [...word];
      for (;;) {
        let pen = 0;
        let n = 0;
        for (; n < rest.length; n++) {
          const step = advanceOf(table, rest[n].codePointAt(0) as number);
          if (pen + step > width) break;
          pen += step;
        }
        // at least one letter a line, or a box narrower than a letter never ends
        n = Math.max(1, n);
        if (n >= rest.length) break;
        lines.push(rest.slice(0, n).join(""));
        rest = rest.slice(n);
      }
      line = rest.join("");
    }
    lines.push(line);
  }
  return lines;
}
