// The name table of a compiled .tft: the
// file keeps no component or page names as text in the object tables — it keeps
// a table of `u32 hash` + `u16 object index`, sorted by hash, and the runtime
// looks a name up by binary search. The `appAllvas` table hashes the `Program.s`
// globals the same way.
//
// The hash is a **plain CRC-32** (polynomial 0x04C11DB7, non-reflected, initial
// value 0xFFFFFFFF) over the name with **each character widened to a
// little-endian dword** — the same `crc32Dwords` the Editor uses for the .HMI
// directory checksum. The only difference between the two tables is padding:
//
//   component or page name  ->  NUL-padded to 14 characters, then hashed
//   Program.s global        ->  hashed as written, any length
//
// Verified out of sample: the 390 page and component names of the joBr99
// project and all 15 of its globals, including the two 16-byte ones that the
// earlier per-position table could not reach.
//
// Historical note, because it cost a campaign round: this was first recovered
// as fourteen measured per-position constants, and written up as "not a
// streaming CRC" because the positions are not related by the usual advance-one
// -byte step. They are related by an advance-*four*-bytes step, which is what
// widening each character to a dword means. The 14-byte cap is the Editor's
// interface rule for component and page names, not a property of the format.

const POLY = 0x04c11db7;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = (i << 24) >>> 0;
    for (let k = 0; k < 8; k++) r = (r & 0x80000000 ? ((r << 1) ^ POLY) : (r << 1)) >>> 0;
    t[i] = r;
  }
  return t;
})();

/** CRC-32 of `bytes`, consumed one little-endian dword at a time. */
function crc32Dwords(bytes: Uint8Array, init: number): number {
  let r = init >>> 0;
  for (let i = 0; i + 4 <= bytes.length; i += 4) {
    r = (r ^ ((bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0)) >>> 0;
    for (let k = 0; k < 4; k++) r = (((r << 8) >>> 0) ^ CRC_TABLE[(r >>> 24) & 0xff]) >>> 0;
  }
  return r >>> 0;
}

/** The name's bytes, one per little-endian dword, as the hash consumes them. */
function widen(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length * 4);
  for (let i = 0; i < bytes.length; i++) out[i * 4] = bytes[i];
  return out;
}

/** How many characters the Editor accepts in a component or page name. */
export const TFT_NAME_MAX = 14;

/**
 * The hash the compiled .tft stores for a component or page name: the name
 * NUL-padded to the 14-character field, hashed a dword per character.
 * Throws on a name the Editor itself would refuse.
 */
export function tftNameHash(name: string): number {
  const bytes = new TextEncoder().encode(name);
  if (bytes.length === 0) throw new RangeError("a name cannot be empty");
  if (bytes.length > TFT_NAME_MAX) throw new RangeError(`name longer than ${TFT_NAME_MAX} bytes: ${name}`);
  const padded = new Uint8Array(TFT_NAME_MAX);
  padded.set(bytes);
  return crc32Dwords(widen(padded), 0xffffffff);
}

/**
 * The hash the compiled .tft stores for a **`Program.s` global** in the
 * `appAllvas` table: the same hash with **no padding**, so
 * the name is consumed exactly as written. Globals are not bound by the
 * 14-character rule the Editor imposes on component names — joBr99 ships
 * `defaultFontColor` and `defaultBcoColor`, both 16 characters.
 */
export function tftGlobalNameHash(name: string): number {
  const bytes = new TextEncoder().encode(name);
  if (bytes.length === 0) throw new RangeError("a name cannot be empty");
  return crc32Dwords(widen(bytes), 0xffffffff);
}

export interface TftNameEntry {
  name: string;
  /** Index of the object in the component table; the page is 0. */
  index: number;
  hash: number;
}

/**
 * The name table as the compiler lays it out: one 6-byte entry per object
 * (`u32` hash, `u16` index), sorted by hash ascending, preceded by a `u32`
 * with the table's size in bytes.
 */
export function encodeTftNameTable(names: { name: string; index: number }[]): Uint8Array {
  const entries: TftNameEntry[] = names.map(({ name, index }) => ({ name, index, hash: tftNameHash(name) }));
  entries.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
  const out = new Uint8Array(4 + entries.length * 6);
  const view = new DataView(out.buffer);
  view.setUint32(0, entries.length * 6, true);
  entries.forEach((e, i) => {
    view.setUint32(4 + i * 6, e.hash, true);
    view.setUint16(4 + i * 6 + 4, e.index, true);
  });
  return out;
}
