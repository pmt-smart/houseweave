// Where a component's initial attribute values live in the compiled file: the
// page's RAM image.
//
// Every page ends with a name table (page table field 3 points at it) and, right
// after it, one `u32 len` block holding the page's initial RAM. RAM addresses
// are file-wide: the first G bytes are the globals area (G = size of the second
// pair of the code directory, 16 with the default Program.s, 328 in joBr99's
// project), and the page image starts at RAM address G. Each object owns the
// slice that starts at its own `objdatarampos`; a global object (vscope 1, or a
// Program.s int) lives in the globals area instead, at G's file offset + ram + 4.
// Inside the slice the fields are at fixed offsets per type — the same for a
// lone component on a test page and for the 885 objects of joBr99's project.
// The 24-byte descriptors of the attribute region only map those RAM slots.
//
// Widths are the bytes seen to change, or the distance to the next field; `val`
// is u32 where nothing follows it closely. Measured on Editor 1.68.1, model
// NX4832F035_011, one scenario per attribute (families m2 and m11).
import { header2Fields } from "./tftFormat.js";
import { readComponentRecord } from "./component.js";

export interface SliceField {
  /** offset from the start of the object's RAM slice */
  offset: number;
  /** bytes to read; text is NUL-padded up to txt_maxl + 1 */
  width: number;
  kind: "uint" | "text";
}

export type SliceLayout = Record<string, SliceField>;

const u = (offset: number, width: number): SliceField => ({ offset, width, kind: "uint" });
const text = (offset: number): SliceField => ({ offset, width: 0, kind: "text" });

/** Attribute fields inside the object's RAM slice, by component type (`lei`). */
export const RAM_SLICE_ATTRS: Record<number, SliceLayout> = {
  // Text (m2)
  116: { font: u(0, 1), isbr: u(1, 1), pco: u(2, 2), bco: u(4, 2), xcen: u(6, 1), ycen: u(7, 1), txt: text(9) },
  // Number
  54: { font: u(5, 1), bco: u(6, 2), pco: u(8, 2), xcen: u(10, 1), val: u(12, 4), lenth: u(16, 1), format: u(17, 1) },
  // Xfloat: the Number layout with vvs0/vvs1 in the lenth/format slots
  59: { pco: u(8, 2), val: u(12, 4), vvs0: u(16, 1), vvs1: u(17, 1) },
  // Button
  98: { font: u(0, 1), val: u(1, 1), bco: u(2, 2), bco2: u(4, 2), pco: u(6, 2), pco2: u(8, 2), txt: text(13) },
  // Dual-state button
  53: { val: u(1, 1), bco: u(2, 2), bco2: u(4, 2), pco: u(6, 2), txt: text(13) },
  // CheckBox
  56: { bco: u(4, 2), pco: u(6, 2) },
  // Radio
  57: { bco: u(0, 2), pco: u(2, 2) },
  // Curve / waveform (valid for the template `ch`)
  0: { ch: u(2, 1), bco: u(4, 2), gdc: u(6, 2), pco0: u(14, 2) },
  // Scrolling text
  55: { pco: u(8, 2), dis: u(13, 1), tim: u(14, 2), en: u(16, 1), txt: text(40) },
  // Progress bar (valid for the template `dez`); val is 0..100, one byte
  106: { val: u(2, 1), bco: u(4, 2), pco: u(6, 2) },
  // QR code
  // Qrcode: the text is not in the 16-byte RAM slice — it is immediate in the
  // code block, comp+0x9d. Its costs are no constants: the page-image cost is 20 + 4*floor(txt_maxl/4), which is 48 at
  // the template capacity of 30 and not a constant, and the scratch the compiler
  // holds aside is thousands of bytes, stepping with the QR version. Both live
  // in ramBudget.ts now (componentRamCost, qrcodeReserve).
  58: { bco: u(2, 2), pco: u(4, 2) },
  // Slider
  1: { mode: u(0, 1), wid: u(3, 1), hig: u(4, 1), bco: u(6, 2), pco: u(8, 2), val: u(10, 2), maxval: u(12, 2), minval: u(14, 2) },
  // Timer
  51: { tim: u(0, 2), en: u(2, 1) },
  // Variable
  52: { val: u(0, 4) },
  // Gauge
  122: { bco: u(2, 2), val: u(4, 2), pco: u(14, 2), wid: u(20, 1) },
  // Picture crop: vvs0/vvs1 travel in the descriptor value and as ASCII
  // literals of the xpic draw command — nothing in the slice to check.
  113: {},
};

/**
 * Attributes whose value changes the layout of the type, per `lei`. `sta`
 * (background: colour, image, crop) drops the colour fields from the slice —
 * one descriptor goes for a Text with sta 2, and joBr99's dual-state
 * buttons with image backgrounds carry other bytes where bco/bco2 sit. The
 * offsets here were measured with the template `sta`; `m26-sta2-*` measures
 * the other layouts.
 */
export const LAYOUT_CHANGERS: Record<number, string[]> = {
  116: ["sta"], 54: ["sta"], 59: ["sta"], 98: ["sta"], 53: ["sta"], 56: ["sta"], 57: ["sta"],
  0: ["ch", "sta"], 55: ["sta"], 106: ["dez", "sta"], 58: ["sta"], 1: ["sta"], 122: ["sta"],
};

/**
 * A slice layout measured for a NON-template value of a layout changer.
 *
 * Without one of these a component that moves a layout changer is skipped
 * entirely -- correct, and useless: the first project to draw a slider with an
 * image track compiled with three components nobody checked. A variant turns
 * "we cannot read this" back into "we read this, and it is right".
 */
export interface SliceVariant {
  /** the layout-changer values this layout was measured at */
  when: Record<string, number>;
  layout: SliceLayout;
}

/**
 * Measured on p1-living-room-eu-landscape (Editor 1.68.1), by
 * compiling three Sliders that differ in nothing but their picture id and
 * diffing their 28-byte RAM slices: exactly two bytes moved, `+6` and `+22`.
 *
 * In image mode the slot the colour layout uses for `bco` carries `pic`
 * instead -- which is what made the guard refuse the whole component, because
 * reading it as `bco` gives 0, 1, 2 where the project asked for 6371. There is
 * no `bco`/`bco1` in this layout at all, and that is not a gap: an image track
 * has no background colour to hold.
 *
 * `sta` and `psta` are listed because they were measured here (+1 and +2) and
 * the colour layout above never mapped them.
 */
export const RAM_SLICE_VARIANTS: Record<number, SliceVariant[]> = {
  // Dual-state Button with picture states (sta 2), measured the same way on the
  // same file: the slots the colour layout uses for `bco` and `bco2` carry `pic`
  // and `pic2`, which is the same substitution the Slider makes and is starting
  // to look like the rule for image mode rather than a coincidence.
  //
  // `val` and `pco` do not move. `pco2` is here because it was measured at +8 and
  // the colour layout never mapped it. `txt` is deliberately NOT mapped: the one
  // instance measured carries an empty string, so its offset in image mode is
  // unverified and a guess would be a check that passes on nothing.
  53: [{
    when: { sta: 2 },
    layout: { val: u(1, 1), pic: u(2, 2), pic2: u(4, 2), pco: u(6, 2), pco2: u(8, 2) },
  }],
  // Slider with an image track (sta 2)
  1: [{
    when: { sta: 2 },
    layout: {
      mode: u(0, 1), sta: u(1, 1), psta: u(2, 1), wid: u(3, 1), hig: u(4, 1),
      pic: u(6, 2), pco: u(8, 2), val: u(10, 2), maxval: u(12, 2), minval: u(14, 2),
      pic1: u(22, 2),
    },
  }],
};

/**
 * The code offset of an object. The u32 at +4 of the record
 * is the offset for most types; Curve, Slider, Touchcap, Timer, Vari and Hotspot
 * carry 0xffffffff there and only the u16 at +52, which is the low half of the
 * offset and wraps past 64 KB of code (joBr99 has 441 KB). `anchor` is a full
 * offset known to precede the object in the same page (its page record's), used
 * to pick the 64 KB window.
 */
export function codeOffsetOf(rec: { bytecodeOffset: number; codeOffset16: number }, anchor = 0): number {
  if (rec.bytecodeOffset !== 0xffffffff) return rec.bytecodeOffset;
  let off = (anchor & ~0xffff) + rec.codeOffset16;
  if (off < anchor) off += 0x10000;
  return off;
}

export interface RamImage {
  /** absolute offset of the first byte of the image (after its u32 length) */
  body: number;
  length: number;
  /** RAM address the first byte of the image stands for: the globals area size */
  baseRam: number;
  /** absolute offset of the globals area (code directory, second pair) */
  globalsAt: number;
  /** the page's objects, in record order; `global` when the slice is in the globals area */
  objects: { index: number; lei: number; ram: number; sliceStart: number; global: boolean }[];
}

/**
 * Locates the RAM image of a page: the block after the page's name table. Its
 * first byte stands for RAM address G, the size of the globals area (second
 * pair of the code directory); objects with `objdatarampos` below G are global
 * and their slice is in that area, at its file offset + ram + 4.
 */
export function pageRamImage(file: Uint8Array, pageIndex: number): RamImage {
  const h = header2Fields(file);
  const u32 = (o: number) => (file[o] | (file[o + 1] << 8) | (file[o + 2] << 16) | (file[o + 3] << 24)) >>> 0;
  const u16 = (o: number) => file[o] | (file[o + 1] << 8);
  if (pageIndex >= h.pageqty) throw new RangeError(`page ${pageIndex}: the file has ${h.pageqty} page(s)`);
  const globalsAt = h.strdataaddr + u32(h.strdataaddr + 16);
  const baseRam = u32(h.strdataaddr + 20);
  let first = 0;
  for (let p = 0; p < pageIndex; p++) first += u16(h.pageadd + p * 16 + 2);
  const entry = h.pageadd + pageIndex * 16;
  const count = u16(entry + 2);
  const nameTable = h.strdataaddr + u32(entry + 4);
  const image = nameTable + 4 + u32(nameTable);
  const length = u32(image);
  const body = image + 4;
  const objects = [];
  for (let i = 0; i < count; i++) {
    const r = readComponentRecord(file, h.objxinxiadd + (first + i) * 232);
    const global = r.objdatarampos < baseRam;
    objects.push({ index: first + i, lei: r.lei, ram: r.objdatarampos, global, sliceStart: global ? globalsAt + r.objdatarampos + 4 : body + (r.objdatarampos - baseRam) });
  }
  return { body, length, baseRam, globalsAt, objects };
}

/**
 * Compares the fields of one object's RAM slice with the values the project
 * declares. `expected` maps attribute name to a number or a string; names not
 * in the type's layout are ignored. `template` carries the type's defaults, to
 * tell whether a layout-changing attribute was moved off its template value.
 */
export function checkSliceAttrs(
  file: Uint8Array,
  sliceStart: number,
  lei: number,
  expected: Record<string, number | string>,
  template: Record<string, number | string> = {},
): { checked: string[]; problems: string[]; skipped?: string } {
  let layout = RAM_SLICE_ATTRS[lei];
  if (!layout) return { checked: [], problems: [] };
  const moved = (LAYOUT_CHANGERS[lei] ?? []).filter(
    (name) => name in expected && name in template && expected[name] !== template[name],
  );
  if (moved.length > 0) {
    // A layout measured at exactly these values, if anyone has measured one.
    const variant = (RAM_SLICE_VARIANTS[lei] ?? []).find((v) =>
      Object.entries(v.when).every(([name, value]) => expected[name] === value));
    if (!variant) {
      return {
        checked: [], problems: [],
        skipped: `${moved.join(", ")} differs from the template and no variant layout has been measured for it`,
      };
    }
    layout = variant.layout;
  }
  const checked: string[] = [];
  const problems: string[] = [];
  for (const [name, field] of Object.entries(layout)) {
    if (!(name in expected)) continue;
    const want = expected[name];
    const at = sliceStart + field.offset;
    if (field.kind === "text") {
      // byte-transparent: the .HMI stores the text in the project's `encode`
      // (a single 0xb0 for "°" in an encode-3 project) and the .tft copies the
      // bytes; `expected` carries them as latin1 code points
      const bytes = latin1Bytes(String(want));
      const got = file.subarray(at, at + bytes.length);
      const same = got.length === bytes.length && got.every((b, i) => b === bytes[i]);
      const maxl = typeof expected.txt_maxl === "number" ? expected.txt_maxl : undefined;
      const terminated = maxl === undefined || bytes.length >= maxl || file[at + bytes.length] === 0;
      if (!same || !terminated) problems.push(`${name} ${JSON.stringify(decodeText(file, at, maxl ?? bytes.length))} != ${JSON.stringify(want)}`);
    } else {
      let got = 0;
      for (let i = field.width - 1; i >= 0; i--) got = got * 256 + file[at + i];
      const wantNum = Number(want) % 2 ** (8 * field.width);
      if (got !== wantNum) problems.push(`${name} ${got} != ${wantNum} (at slice+${field.offset})`);
    }
    checked.push(name);
  }
  return { checked, problems };
}

function decodeText(file: Uint8Array, at: number, maxLen: number): string {
  let end = at;
  while (end < at + maxLen && file[end] !== 0) end++;
  return Array.from(file.subarray(at, end), (b) => String.fromCharCode(b)).join(""); // one code point per byte
}

/** One byte per code point (the string must hold code points 0..255). */
export function latin1Bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}
