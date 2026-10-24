// The `objxinxi` component record (232 bytes each, table at the absolute
// file offset in header2's objxinxiadd field — unlike most header2
// address fields, this one is NOT relative to strdataaddr).
//
// Byte layout, confirmed against real records read straight out of
// eseverson/nextion-hmi's base.tft (4 known records: 1 Page + 3 XFloat,
// geometry matching exactly):
//
//   0      lei              u8   component type code
//   1      id               u8   component id, unique within its page
//   2-3    const            u16  always 0x3700 in every sample seen
//   4-7    bytecodeOffset   u32  offset into the compiled event bytecode
//   8-27   address slots    5 x u32, 0xFFFFFFFF when unused — NOT padding.
//                           First read as "always 0xFF" from 4 records;
//                           30 of the 41 records in eseverson's base.tft
//                           carry a value at +8, some at +12..+20. They
//                           relocate together with bytecodeOffset and the
//                           Attstrpianyi indices when data before the
//                           table grows (5 labelled pairs:
//                           every changed field moved by exactly the
//                           inserted size — +12, +24, +4/+54 — and the
//                           geometry never moved).
//   28-31  objdatarampos    u32  moves with the compiled bytecode (+4 in
//                           16_loop, where maincodehex grew by 4)
//   32-39  unknown          8 bytes, mostly zero; byte 35 is 0x7f in the
//                           eseverson projects and 0x00 in every project we
//                           generate — meaning not established
//   40-41  x                u16
//   42-43  y                u16
//   44-45  w                u16
//   46-47  h                u16
//   48-49  endx             u16  always x + w - 1
//   50-51  endy             u16  always y + h - 1
//   52-231 Attstrpianyi     180 bytes, attribute-index tail (not fully
//                           decoded). Its first 4
//                           bytes duplicate bytecodeOffset exactly.
//
// Known `lei` codes. Fourteen of nineteen are now byte-verified by us,
// via two rounds of the same technique: diff a real compile against the
// same project with one or more components added, using a proper
// multiset diff (accounting for how many times each record shape
// appears, not just whether it appears — a naive set-diff was tried
// first and got Hotspot/Text backwards, fooled by a page-block
// reordering; the multiset version was sanity-checked against
// `11_add_page`, which correctly reports a new Page record, before
// trusting it for anything else — see `export/scripts/diff-components.mjs`).
//
// Round 1: Page, XFloat, Text, Hotspot, Picture — one component added per
// diff. Text was cross-checked against a file known to be one Page plus one
// Text component.
//
// Round 2: `base.tft` → `17_more_components.tft` adds ten
// records across (evidently) several pages in one compile, zero
// removed — a single clean diff that confirms Picture again and nine
// brand-new codes at once: Curve, Touchcap, Button_T, GText, CheckBox,
// Radio, Qrcode, Picc, Zhizhen. Every one lands on a code eseverson's
// table already claimed, with plausible geometry for the name (Qrcode
// 82x82 square, CheckBox/Radio 20x20 square, Touchcap 1x1 — an
// invisible touch-capture point, Picc 60x60 square crop region).
//
// The table itself comes from `eseverson/nextion-hmi`'s
// `findings/next-steps.md`: an `ATTPOSUP_TABLE_T1`, extracted from
// IL-decompiling the Nextion Editor's own `hmitype.dll`
// (`GuiObj<Kind>.GetAtts_WithNoHead`, F-series branch) — the type
// registry's actual source, not a byte guess. Still unverified by us:
// Slider (1), Timer (51), Vari (52), Button (98), Prog (106) — all
// five are already present once each in `base.tft` itself (so no
// "added" diff can show them), and no fixture pair found so far
// isolates a clean add or remove of any of them. `lei=1` (their
// "Slider") shows up as a 300x25 record — wide and short, a plausible
// horizontal slider — in `eseverson/source/nextion.hmi.tft`, on a page
// that also has a Hotspot, a Text and a `lei=98` ("Button") record,
// i.e. a coherent control panel, not a coincidence — geometry
// corroboration, not byte verification.
//   0 ✅ Curve      51    Timer      98    Button     116 ✅ Text
//   1    Slider     52    Vari       106   Prog       121 ✅ Page
//   5 ✅ Touchcap   53 ✅ Button_T   109 ✅ Hotspot    122 ✅ Zhizhen
//  55 ✅ GText      56 ✅ CheckBox   112 ✅ Pic (Picture)
//  57 ✅ Radio      58 ✅ Qrcode     113 ✅ Picc (Picture Crop)
//  59 ✅ XFloat
// `Picc` ("Picture Crop") is a strong candidate for what
// nspanel-sim's minimum scope calls "Picture-region" — a cropped,
// presumably touchable picture area — rather than composing plain
// Picture (112) with an overlaid Hotspot (109); now byte-verified as a
// real, distinct component type, though its runtime crop behavior is
// still unobserved (needs a rendered sample, not just a table entry).

export const RECORD_SIZE = 232;
// Five u32 address slots at +8..+27 (see the layout comment above).
export const ADDRESS_SLOTS_OFFSET = 8;
export const ADDRESS_SLOTS_COUNT = 5;
export const GEOMETRY_OFFSET = 40;
// +52: u16 copy of the component's code offset (221, 340, 393 measured — the
// same values as the u32 at +4). The attribute index table proper starts after
// it; its indices are relative to the page's attribute region, not to the file.
// ATTSTRPIANYI_OFFSET keeps pointing at +52 because every
// tool that reports "attstrpianyi+N" was written against that origin.
export const CODE_OFFSET16_OFFSET = 52;
export const ATTSTRPIANYI_OFFSET = 52;
export const ATTSTRPIANYI_LENGTH = 180;

// Fourteen of these are byte-verified by us (see the comment above for
// which two diffs proved each). Slider, Timer, Vari, Button, Prog are
// not — kept here anyway because they are common/likely-needed types,
// sourced only from eseverson's IL-decompiled table.
export const KNOWN_LEI = {
  Curve: 0,
  Slider: 1,
  Touchcap: 5,
  Timer: 51,
  Vari: 52,
  ButtonT: 53,
  /** Number (n0…): Text-like attributes plus val/lenth/format — seen in joBr99's project */
  Number: 54,
  GText: 55,
  CheckBox: 56,
  Radio: 57,
  Qrcode: 58,
  XFloat: 59,
  Button: 98,
  Prog: 106,
  Hotspot: 109,
  Picture: 112,
  PictureCrop: 113,
  Text: 116,
  Page: 121,
  Zhizhen: 122,
} as const;

export interface ComponentRecord {
  lei: number;
  id: number;
  bytecodeOffset: number;
  /** u16 at +52: the low 16 bits of the code offset. Equal to bytecodeOffset while the
   *  code region is under 64 KB; wraps in big projects (joBr99: 441 KB of code), and is
   *  the only offset the types with bytecodeOffset = 0xffffffff carry */
  codeOffset16: number;
  objdatarampos: number;
  x: number;
  y: number;
  w: number;
  h: number;
  endx: number;
  endy: number;
}

function readUInt16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUInt32LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

export function componentRecordOffset(objxinxiaddAbs: number, index: number): number {
  return objxinxiaddAbs + index * RECORD_SIZE;
}

export function readComponentRecord(file: Uint8Array, recordOffset: number): ComponentRecord {
  return {
    lei: file[recordOffset],
    id: file[recordOffset + 1],
    bytecodeOffset: readUInt32LE(file, recordOffset + 4),
    codeOffset16: readUInt16LE(file, recordOffset + CODE_OFFSET16_OFFSET),
    objdatarampos: readUInt32LE(file, recordOffset + 28),
    x: readUInt16LE(file, recordOffset + GEOMETRY_OFFSET),
    y: readUInt16LE(file, recordOffset + GEOMETRY_OFFSET + 2),
    w: readUInt16LE(file, recordOffset + GEOMETRY_OFFSET + 4),
    h: readUInt16LE(file, recordOffset + GEOMETRY_OFFSET + 6),
    endx: readUInt16LE(file, recordOffset + GEOMETRY_OFFSET + 8),
    endy: readUInt16LE(file, recordOffset + GEOMETRY_OFFSET + 10),
  };
}

// Rewrites a component's geometry in place (endx/endy are derived, not
// taken from the caller, since every real record enforces endx=x+w-1 /
// endy=y+h-1). Does not reseal the tail checksum — callers should pass
// the result through sealTailChecksum from tftFormat.ts, same as
// patchText.ts does, once all edits for this file are applied.
export function writeComponentGeometry(
  file: Uint8Array,
  recordOffset: number,
  geometry: { x: number; y: number; w: number; h: number },
): Uint8Array {
  const out = Uint8Array.from(file);
  const { x, y, w, h } = geometry;
  const endx = x + w - 1;
  const endy = y + h - 1;
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint16(recordOffset + GEOMETRY_OFFSET, x, true);
  view.setUint16(recordOffset + GEOMETRY_OFFSET + 2, y, true);
  view.setUint16(recordOffset + GEOMETRY_OFFSET + 4, w, true);
  view.setUint16(recordOffset + GEOMETRY_OFFSET + 6, h, true);
  view.setUint16(recordOffset + GEOMETRY_OFFSET + 8, endx, true);
  view.setUint16(recordOffset + GEOMETRY_OFFSET + 10, endy, true);
  return out;
}
