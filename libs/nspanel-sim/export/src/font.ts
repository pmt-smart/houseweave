// Nextion font files (`.zi`): read, write, subset, merge and draw.
//
// A `.zi` goes into the `.HMI` verbatim, so this package used
// to do nothing with a font but check its magic and copy it. This module opens
// it up, down to the pixels. Every font we hold is **ZI version 6** (byte at
// +0x10): 3 from the eseverson projects (ISO-8859-1), 8 from joBr99's project
// (UTF-8), 272 bytes to 3.3 MB, plus fonts generated on purpose in the Nextion
// Editor's own Font Creator to pin the encoding down.
//
// Layout:
//
//     +0x00  44-byte header
//     +0x2c  font name, immediately followed by the encoding name, no separator
//            glyph table: one 10-byte record per glyph, ascending by codepoint
//            glyph streams, in the order the records point at them
//
// Header fields, each verified against all 11 corpus fonts:
//
//     +0x04  u8   code page (0x03 ISO-8859-1, 0x18 UTF-8) — ONE byte, not two:
//                  read as a u16 it comes out wrong in 10 of the 11 fonts
//     +0x05  u8   0, 1 or 2 in the corpus; what it selects is NOT measured
//     +0x06  u8   character width, 0 when the font is variable width
//     +0x07  u8   character height in pixels
//     +0x0a  u8   first code of the page; +0x0b last code
//     +0x0c  u32  glyph count
//     +0x10  u8   file format version — 6 in everything measured
//     +0x11  u8   length of font name + encoding name together
//     +0x14  u32  payload size — equals file length - 44 in every font
//     +0x18  u32  start of data, i.e. where the name begins — 44 in every font
//     +0x1e  u8   anti-alias flag
//     +0x1f  u8   variable width (0 monospace, 1 variable)
//     +0x20  u8   length of the font name alone
//     +0x21  u8   1 = glyph offsets are divided by 8 (for files over 16 MB)
//     +0x24  u32  number of characters of the subset
//
// GLYPH GEOMETRY. The bitmap is `(width + kerningLeft + kerningRight) * height`
// pixels — not `width * height`. That is what explains the combining marks,
// whose advance is 1 while the mark is wider, and the CJK ideographs. Checked
// on every glyph of every font: **26520 of 26520 decode to exactly that many
// pixels**.
//
// GLYPH STREAM. The first byte is the encoding of the rest: 0x01 black and
// white, 0x03 three-bit anti-aliased. It is per GLYPH, not per font — a shape
// with no soft edge is stored in black and white even inside an anti-aliased
// font. Every byte after it is one instruction, `YZdddddd`:
//
//     000xxxxx   xxxxx clear pixels
//     001xxxxx   xxxxx opaque pixels
//     010xxxxx   xxxxx clear, then 1 opaque
//     011xxxxx   xxxxx clear, then 2 opaque
//     100xxxxx   b&w: xxxxx clear, then 3 opaque   |  aa: 10 xxx ccc — xxx clear, then one pixel of alpha ccc
//     101xxxxx   b&w: xxxxx clear, then 4 opaque   |  aa: same form
//     11wwwbbb   b&w: www clear, then bbb opaque   |  aa: 11 ccc ddd — two pixels, alpha ccc then ddd
//
// How it was measured, because the order matters: the Font Creator inside the
// Sandbox generated single-glyph fonts whose shape is known (a Wingdings filled
// square, an Arial "o" at two sizes, with anti-aliasing on and off). The square
// decoded to an exact 9x8 rectangle and the "o" to a clean ring, which fixed the
// low families; the rest was confirmed against hagronnestad/nextion-font-editor's
// ZI v6 specification, which this corpus then verified at 100%. Two earlier
// models died on the way: "each byte is a fixed number of pixels" (tested as a
// linear system, 25440 of 25644 equations contradicted each other) and the
// opcode table in eseverson/nextion-hmi's findings/format-zi.md (under 2%).

export const ZI_MAGIC = Uint8Array.from([0x04, 0xff, 0x00, 0x0a]);
export const ZI_HEADER_SIZE = 44;
export const ZI_RECORD_SIZE = 10;

/** Offsets of the header fields this module reads or rewrites. */
const F = {
  codePage: 0x04,
  charsetMode: 0x05,
  characterWidth: 0x06,
  height: 0x07,
  glyphCount: 0x0c,
  version: 0x10,
  nameFieldLen: 0x11,
  payloadSize: 0x14,
  startOfData: 0x18,
  antiAlias: 0x1e,
  variableWidth: 0x1f,
  nameLen: 0x20,
  align8: 0x21,
  subsetCount: 0x24,
} as const;

/** Alpha levels a glyph pixel can take: 0 clear to 7 opaque. */
export const ZI_ALPHA_MAX = 7;
export const ZI_MODE_BW = 0x01;
export const ZI_MODE_AA = 0x03;

export interface ZiGlyph {
  /** codepoint, u16 — in the font's own encoding */
  code: number;
  /** advance width in pixels (u8 at +2) */
  advance: number;
  /**
   * Kerning, left and right. They are not decoration: the glyph's bitmap is
   * `(advance + kerningLeft + kerningRight) * height` pixels, which is what
   * explains the combining marks (advance 1, a wider mark) and the CJK
   * ideographs. Use `ziBitmapWidth` rather than reading the advance.
   */
  kerningLeft: number;
  kerningRight: number;
  /** the glyph stream, as stored; `decodeZiGlyph` turns it into pixels */
  data: Uint8Array;
  /**
   * Bytes sitting between the previous glyph's stream and this one that no
   * record points at. Three of the eleven fonts carry a few; they are kept so
   * that reading a file and writing it again gives the same bytes.
   */
  gapBefore: Uint8Array;
}

export interface ZiFont {
  /** the 44 header bytes, carried verbatim except for the fields writeZi recomputes */
  header: Uint8Array;
  name: string;
  encoding: string;
  height: number;
  /** ZI file format version — 6 in everything measured */
  version: number;
  /** code page id: 0x03 ISO-8859-1, 0x18 UTF-8 */
  codePage: number;
  /**
   * The byte at +0x05: how much of its code page the font covers. Measured, the
   * Editor writes **2 for every subset** — its own 12-glyph font, and every
   * font its Font Creator produced for us. A font that covers its whole page
   * carries 1 (`liber`, all 224 of ISO-8859-1). One corpus font disagrees with
   * any simple rule (`NotoSand-Bold-TxtOnly-128`, 95 glyphs, carries 0), so
   * only the subset case is treated as known; the rest is carried verbatim.
   */
  charsetMode: number;
  /** the font was generated with anti-aliasing on */
  antiAlias: boolean;
  /** glyph offsets are stored divided by 8 (files over 16 MB) */
  align8: boolean;
  glyphs: ZiGlyph[];
  /** trailing bytes no record points at, kept for the same reason as `gapBefore` */
  tail: Uint8Array;
}

const u8 = (b: Uint8Array, o: number) => b[o];
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u24 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const latin1 = (b: Uint8Array, o: number, n: number) =>
  Array.from(b.subarray(o, o + n), (c) => String.fromCharCode(c)).join("");

function putU32(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
  b[o + 2] = (v >>> 16) & 0xff;
  b[o + 3] = (v >>> 24) & 0xff;
}

export function isZi(bytes: Uint8Array): boolean {
  return bytes.length >= ZI_HEADER_SIZE && ZI_MAGIC.every((m, i) => bytes[i] === m);
}

/** Parses a `.zi`. Throws on anything the 11 measured fonts never do. */
export function readZi(bytes: Uint8Array): ZiFont {
  if (!isZi(bytes)) throw new Error("not a .zi font file (magic 04 ff 00 0a)");
  const headerSize = u32(bytes, F.startOfData);
  if (headerSize !== ZI_HEADER_SIZE) throw new Error(`.zi: header size ${headerSize}, expected ${ZI_HEADER_SIZE}`);
  const payload = u32(bytes, F.payloadSize);
  if (payload !== bytes.length - ZI_HEADER_SIZE)
    throw new Error(`.zi: payload says ${payload}, file carries ${bytes.length - ZI_HEADER_SIZE}`);

  const nameLen = u8(bytes, F.nameLen);
  const nameFieldLen = u8(bytes, F.nameFieldLen);
  if (nameLen > nameFieldLen) throw new Error(`.zi: name ${nameLen} longer than name+encoding ${nameFieldLen}`);
  const tableAt = headerSize + nameFieldLen;
  const count = u32(bytes, F.glyphCount);
  // Over 16 MB the format cannot express an offset in 24 bits, so it stores it
  // divided by 8 and sets a flag. Nothing in the corpus needs it, but reading
  // the flag wrong would silently address the wrong glyph.
  const scale = u8(bytes, F.align8) === 1 ? 8 : 1;

  const glyphs: ZiGlyph[] = [];
  // Records may point at the same stream. Hand those glyphs the SAME array
  // object, because that identity is what tells writeZi to keep sharing one
  // copy instead of writing the bytes twice.
  const emitted = new Map<number, Uint8Array>();
  // the first stream starts right after the table, so offsets are relative to
  // the table's own start
  let cursor = count * ZI_RECORD_SIZE;
  for (let i = 0; i < count; i++) {
    const r = tableAt + i * ZI_RECORD_SIZE;
    const off = u24(bytes, r + 5) * scale;
    const len = u16(bytes, r + 8);
    if (tableAt + off + len > bytes.length) throw new Error(`.zi: glyph ${i} runs past the end of the file`);
    // keyed by offset AND length: two records pointing at one offset with
    // different lengths are overlapping slices, and treating them as the same
    // blob silently grows the file when it is written back
    let data = emitted.get(off * 0x10000 + len);
    let gapBefore: Uint8Array = new Uint8Array(0);
    if (data === undefined) {
      if (off > cursor) gapBefore = bytes.subarray(tableAt + cursor, tableAt + off);
      data = bytes.subarray(tableAt + off, tableAt + off + len);
      emitted.set(off * 0x10000 + len, data);
      cursor = Math.max(cursor, off + len);
    }
    glyphs.push({
      code: u16(bytes, r),
      advance: u8(bytes, r + 2),
      kerningLeft: u8(bytes, r + 3),
      kerningRight: u8(bytes, r + 4),
      data,
      gapBefore,
    });
  }

  return {
    header: bytes.slice(0, ZI_HEADER_SIZE),
    name: latin1(bytes, ZI_HEADER_SIZE, nameLen),
    encoding: latin1(bytes, ZI_HEADER_SIZE + nameLen, nameFieldLen - nameLen),
    height: u8(bytes, F.height),
    version: u8(bytes, F.version),
    codePage: u8(bytes, F.codePage),
    charsetMode: u8(bytes, F.charsetMode),
    antiAlias: u8(bytes, F.antiAlias) === 1,
    align8: u8(bytes, F.align8) === 1,
    glyphs,
    tail: bytes.subarray(tableAt + cursor),
  };
}

/**
 * Serialises a font. Reading a `.zi` and writing it again gives the same bytes:
 * verified on all 11 fonts of the corpus.
 *
 * Two records pointing at the SAME offset keep sharing one copy; two records
 * whose streams merely have equal CONTENT stay separate, because that is how
 * the Editor writes them (`liber` stores the blank of U+0020 and U+00A0 twice).
 */
export function writeZi(font: ZiFont): Uint8Array {
  const nameField = font.name + font.encoding;
  const nameBytes = Uint8Array.from(nameField, (c) => {
    const v = c.charCodeAt(0);
    if (v > 0xff) throw new Error(`.zi: name "${nameField}" has a character outside latin1`);
    return v;
  });
  if (nameBytes.length > 0xff) throw new Error(`.zi: name + encoding is ${nameBytes.length} bytes, the field holds one`);

  const pool: Uint8Array[] = [];
  const placed = new Map<Uint8Array, number>();
  const offsets: number[] = [];
  let cursor = font.glyphs.length * ZI_RECORD_SIZE;
  let first = true;
  for (const g of font.glyphs) {
    const already = placed.get(g.data);
    if (already !== undefined) {
      offsets.push(already);
      continue;
    }
    if (g.gapBefore.length) {
      pool.push(g.gapBefore);
      cursor += g.gapBefore.length;
    } else if (first && cursor % 8 !== 0) {
      // The first glyph stream starts on an 8-byte boundary in all 11 corpus
      // fonts, and three of them carry zero padding to make it so (2, 2 and 4
      // bytes). No LATER stream is aligned, so it is the start of the stream
      // area specifically.
      //
      // It is not a compiler requirement: d1-07-own-font had 14 glyphs, a table
      // of 140 bytes and therefore a misaligned first stream, and the Editor
      // compiled it with no errors and produced a .tft that verified. We pad
      // anyway, because matching what the Editor emits costs at most 7 bytes
      // and the PANEL's reader has never been tested.
      const pad = new Uint8Array(8 - (cursor % 8));
      pool.push(pad);
      cursor += pad.length;
    }
    first = false;
    placed.set(g.data, cursor);
    offsets.push(cursor);
    pool.push(g.data);
    cursor += g.data.length;
  }
  if (font.tail.length) pool.push(font.tail);

  const table = new Uint8Array(font.glyphs.length * ZI_RECORD_SIZE);
  font.glyphs.forEach((g, i) => {
    const r = i * ZI_RECORD_SIZE;
    const o = offsets[i];
    table[r] = g.code & 0xff;
    table[r + 1] = (g.code >>> 8) & 0xff;
    table[r + 2] = g.advance;
    table[r + 3] = g.kerningLeft;
    table[r + 4] = g.kerningRight;
    table[r + 5] = o & 0xff;
    table[r + 6] = (o >>> 8) & 0xff;
    table[r + 7] = (o >>> 16) & 0xff;
    table[r + 8] = g.data.length & 0xff;
    table[r + 9] = (g.data.length >>> 8) & 0xff;
  });

  if (cursor > 0xffffff) throw new Error(`.zi: ${cursor} bytes of glyph data does not fit a 24-bit offset; align8 is not implemented`);
  const bodyLen = nameBytes.length + table.length + pool.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(ZI_HEADER_SIZE + bodyLen);
  out.set(font.header, 0);
  let p = ZI_HEADER_SIZE;
  out.set(nameBytes, p);
  p += nameBytes.length;
  out.set(table, p);
  p += table.length;
  for (const blob of pool) {
    out.set(blob, p);
    p += blob.length;
  }

  // the header fields that describe what was just written
  const sourceCount = u32(font.header, F.glyphCount);
  const hadCodeSpaceEqualToCount = u32(font.header, F.subsetCount) === sourceCount;
  putU32(out, F.glyphCount, font.glyphs.length);
  putU32(out, F.payloadSize, out.length - ZI_HEADER_SIZE);
  putU32(out, F.startOfData, ZI_HEADER_SIZE);
  out[F.nameLen] = font.name.length;
  out[F.nameFieldLen] = nameBytes.length;
  out[F.height] = font.height;
  out[F.version] = font.version;
  out[F.codePage] = font.codePage;
  out[F.antiAlias] = font.antiAlias ? 1 : 0;
  // We always write offsets unscaled, so the flag must say so. Leaving it set
  // produced a file this module's own reader rejected — the shape that reaches
  // here whenever an align8 font is subset below 16 MB.
  out[F.align8] = 0;
  // Fewer glyphs than the font we came from means a subset, and the Editor marks
  // those with 2 at +0x05 — every one of its own we can check does.
  if (font.glyphs.length < sourceCount) out[F.charsetMode] = 2;
  else out[F.charsetMode] = font.charsetMode;
  // In 8 of the 11 fonts the code space mirrors the glyph count; in the three
  // big UTF-8 ones it is a flat 0x10000. Follow whichever this font did.
  if (hadCodeSpaceEqualToCount) putU32(out, F.subsetCount, font.glyphs.length);
  return out;
}

/** The glyphs by codepoint. The last record wins if a font repeats one. */
export function ziGlyphMap(font: ZiFont): Map<number, ZiGlyph> {
  const map = new Map<number, ZiGlyph>();
  for (const g of font.glyphs) map.set(g.code, g);
  return map;
}

/** True when the records are in ascending codepoint order, with no repeats. */
export function ziIsSorted(font: ZiFont): boolean {
  for (let i = 1; i < font.glyphs.length; i++) if (font.glyphs[i].code <= font.glyphs[i - 1].code) return false;
  return true;
}

/**
 * Keeps only the requested codepoints. The point is flash: joBr99's
 * NotoSans-Bold at 80 px is 3.3 MB for 7120 glyphs, and a panel that shows
 * digits and a handful of letters needs a fraction of that.
 *
 * Codepoints the font does not have are skipped silently unless `strict`, which
 * is what a generator wants: a theme asking for a glyph that is not
 * there should fail loudly rather than draw nothing.
 */
export function subsetZi(font: ZiFont, codes: Iterable<number>, options: { strict?: boolean } = {}): ZiFont {
  const have = ziGlyphMap(font);
  const wanted = [...new Set(codes)].sort((a, b) => a - b);
  const glyphs: ZiGlyph[] = [];
  const missing: number[] = [];
  for (const code of wanted) {
    const g = have.get(code);
    if (!g) {
      missing.push(code);
      continue;
    }
    glyphs.push({ ...g, gapBefore: new Uint8Array(0) });
  }
  if (options.strict && missing.length)
    throw new RangeError(
      `.zi "${font.name}" has no glyph for ${missing.slice(0, 8).map((c) => "U+" + c.toString(16).toUpperCase().padStart(4, "0")).join(", ")}` +
        (missing.length > 8 ? ` (+${missing.length - 8} more)` : ""),
    );
  return { ...font, glyphs, tail: new Uint8Array(0) };
}

/**
 * Merges fonts into one, later fonts overriding earlier ones on a shared
 * codepoint. This is how a theme assembles its own font: the panel's
 * icons ARE glyphs, not images, so an icon set is a merge of
 * glyph streams rather than a pile of pictures.
 *
 * The guards are not fussiness. Height is a property of the whole font, so
 * glyphs of a different height would draw at the wrong size; the encoding
 * decides how a codepoint is even read; and the version byte separates the two
 * generations of the format seen in the corpus, whose streams were produced by
 * different Editors.
 */
export function mergeZi(fonts: ZiFont[], name?: string): ZiFont {
  if (!fonts.length) throw new Error("mergeZi: nothing to merge");
  const [first] = fonts;
  for (const f of fonts.slice(1)) {
    if (f.height !== first.height) throw new Error(`mergeZi: height ${f.height} != ${first.height} — a font has one height`);
    if (f.encoding !== first.encoding) throw new Error(`mergeZi: encoding "${f.encoding}" != "${first.encoding}"`);
    if (f.version !== first.version) throw new Error(`mergeZi: version ${f.version} != ${first.version}`);
    if (f.codePage !== first.codePage)
      throw new Error(`mergeZi: code page 0x${f.codePage.toString(16)} != 0x${first.codePage.toString(16)}`);
    // The merged font keeps the first header, so a width model that disagrees
    // would be silently overwritten: a monospace font merged into a variable
    // one would still declare a fixed cell while carrying every advance.
    if (f.header[F.characterWidth] !== first.header[F.characterWidth])
      throw new Error(`mergeZi: character width ${f.header[F.characterWidth]} != ${first.header[F.characterWidth]} — a font has one width model`);
    if (f.header[F.variableWidth] !== first.header[F.variableWidth])
      throw new Error(`mergeZi: variable-width flag ${f.header[F.variableWidth]} != ${first.header[F.variableWidth]}`);
    if (f.antiAlias !== first.antiAlias)
      throw new Error(`mergeZi: anti-alias ${f.antiAlias} != ${first.antiAlias}`);
  }
  const byCode = new Map<number, ZiGlyph>();
  for (const f of fonts) for (const g of f.glyphs) byCode.set(g.code, { ...g, gapBefore: new Uint8Array(0) });
  const glyphs = [...byCode.values()].sort((a, b) => a.code - b.code);
  return { ...first, name: name ?? first.name, glyphs, tail: new Uint8Array(0) };
}

// ---------------------------------------------------------------------------
// The glyph codec
// ---------------------------------------------------------------------------

/** Pixels across the glyph's bitmap: the advance plus both kernings. */
export function ziBitmapWidth(g: ZiGlyph): number {
  return g.advance + g.kerningLeft + g.kerningRight;
}

/**
 * Decodes a glyph stream into one alpha value per pixel, 0 (clear) to 7
 * (opaque), in reading order — row by row, left to right, which is what the
 * rendered control glyphs show (test/fontPixels.test.mjs).
 *
 * Pass `expected` to have a truncated or over-running stream throw instead of
 * returning a bitmap of the wrong size. Without it the function cannot tell:
 * the stream carries no length of its own.
 */
export function decodeZiGlyph(data: Uint8Array, expected?: number): Uint8Array {
  if (data.length === 0) return new Uint8Array(0);
  const mode = data[0];
  if (mode !== ZI_MODE_BW && mode !== ZI_MODE_AA) throw new Error(`.zi glyph: unknown mode 0x${mode.toString(16)}`);
  const aa = mode === ZI_MODE_AA;
  // worst case is two pixels per byte in the packed forms and 31 in the runs
  const out: number[] = [];
  const clear = (n: number) => { for (let i = 0; i < n; i++) out.push(0); };
  const opaque = (n: number) => { for (let i = 0; i < n; i++) out.push(ZI_ALPHA_MAX); };
  for (let i = 1; i < data.length; i++) {
    const d = data[i];
    const run = d & 0x1f;
    switch (d >> 5) {
      case 0: clear(run); break;
      case 1: opaque(run); break;
      case 2: clear(run); opaque(1); break;
      case 3: clear(run); opaque(2); break;
      case 4:
        if (aa) { clear((d >> 3) & 7); out.push(d & 7); } else { clear(run); opaque(3); }
        break;
      case 5:
        if (aa) { clear((d >> 3) & 7); out.push(d & 7); } else { clear(run); opaque(4); }
        break;
      default:
        if (aa) { out.push((d >> 3) & 7); out.push(d & 7); }
        else { clear((d >> 3) & 7); opaque(d & 7); }
    }
  }
  if (expected !== undefined && out.length !== expected)
    throw new RangeError(`.zi glyph: stream decodes to ${out.length} pixels, expected ${expected}`);
  return Uint8Array.from(out);
}

/**
 * Encodes pixels back into a glyph stream. The mode is chosen from the content:
 * a bitmap whose pixels are only clear or opaque goes out black and white, which
 * is what the Editor does even inside an anti-aliased font.
 *
 * It does not try to reproduce the Editor's byte-for-byte choices — several
 * encodings decode to the same bitmap — but it is checked to round-trip: decode,
 * encode, decode again gives the same pixels for every glyph of the corpus.
 */
export function encodeZiGlyph(pixels: ArrayLike<number>): Uint8Array {
  const n = pixels.length;
  for (let i = 0; i < n; i++)
    if (pixels[i] < 0 || pixels[i] > ZI_ALPHA_MAX) throw new RangeError(`.zi glyph: alpha ${pixels[i]} outside 0..${ZI_ALPHA_MAX}`);
  let aa = false;
  for (let i = 0; i < n; i++) if (pixels[i] !== 0 && pixels[i] !== ZI_ALPHA_MAX) { aa = true; break; }

  const out: number[] = [aa ? ZI_MODE_AA : ZI_MODE_BW];
  let i = 0;
  while (i < n) {
    // how many clear pixels start here, and what follows them
    let clear = 0;
    while (i + clear < n && pixels[i + clear] === 0) clear++;

    if (!aa) {
      let opaque = 0;
      while (i + clear + opaque < n && pixels[i + clear + opaque] === ZI_ALPHA_MAX) opaque++;
      // the packed form carries up to 7 of each in a single byte
      if (clear <= 7 && opaque >= 1 && opaque <= 7) { out.push(0xc0 | (clear << 3) | opaque); i += clear + opaque; continue; }
      if (clear > 0 && clear <= 31 && opaque >= 1 && opaque <= 4) {
        out.push(((opaque === 1 ? 2 : opaque === 2 ? 3 : opaque === 3 ? 4 : 5) << 5) | clear);
        i += clear + opaque;
        continue;
      }
      if (clear > 0) { const k = Math.min(clear, 31); out.push(k); i += k; continue; }
      const k = Math.min(opaque, 31);
      out.push(0x20 | k);
      i += k;
      continue;
    }

    // anti-aliased
    if (clear > 0) {
      const next = i + clear < n ? pixels[i + clear] : -1;
      if (clear <= 7 && next > 0 && next < ZI_ALPHA_MAX) { out.push(0x80 | (clear << 3) | next); i += clear + 1; continue; }
      const k = Math.min(clear, 31);
      out.push(k);
      i += k;
      continue;
    }
    let opaque = 0;
    while (i + opaque < n && pixels[i + opaque] === ZI_ALPHA_MAX) opaque++;
    if (opaque > 0) { const k = Math.min(opaque, 31); out.push(0x20 | k); i += k; continue; }
    // A partial pixel. The two-pixel form writes exactly two, so it may not be
    // used on the last pixel of a bitmap: doing so appends a phantom pixel, and
    // the corpus never catches it because a real glyph's last pixel is
    // background. With one pixel left, `10 000 ccc` writes that one alone.
    const a = pixels[i];
    if (i + 1 < n) {
      out.push(0xc0 | (a << 3) | pixels[i + 1]);
      i += 2;
    } else {
      out.push(0x80 | a);
      i += 1;
    }
  }
  return Uint8Array.from(out);
}
