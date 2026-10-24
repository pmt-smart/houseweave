// Reader for the Nextion Editor's project source format, `.HMI` — the
// starting point of path D1: generate the project by code
// and let the Editor compile it. Layout as documented by eseverson
// (findings/format-hmi.md, directory-checksum.md, MIT) and verified here
// against the Editor outputs he published for the F/Discovery series.
//
// File-level layout:
//   0x000000  primary directory: u32 count + count * 28-byte entries,
//             then a u32 checksum (CRC32_T over the directory bytes + "ADEC")
//   0x080000  backup directory, byte-identical mirror
//   0x380000  u32 sentinel 0xFFFFFFFF
//   0x6FFFF8  ASCII "ver21234"
//   0x700000  data blobs (append-only journal: a save appends and tombstones)
//
// Directory entry (28 bytes): 16-byte NUL-padded name, u32 start (absolute
// offset of the blob), u32 size, u8 deleted (1 = tombstoned), 3 bytes of
// per-kind tail data (for pages and Program.s: size >> 8, 16, 24).
//
// Page blob (`N.pa`): u32 crc (five-segment chained CRC-32, see pageCrc),
// u32 datasize, u32 datainformationaddr (0x38), u32 datainformationqyt
// (= number of components), u32 lockpassword, u8 pagelock, u8 hmiffid
// (0x4F), u8 filever (0x21), u8 pagelei, 16-byte name, 3 version bytes,
// then `datainformationqyt` 12-byte PageContentHeader rows (startOffset,
// size, unknown) and the per-component data.
//
// `main.HMI` blob: 96-byte project header; +0x10 holds Modelcrc, which is
// the same value the compiled .tft carries at 0x2E (our "model seed").
import { tftCrc32 } from "./tftFormat.js";

export const HMI_BACKUP_DIRECTORY = 0x80000;
export const HMI_SENTINEL = 0x380000;
export const HMI_MAGIC_OFFSET = 0x6ffff8;
export const HMI_DATA_START = 0x700000;
export const HMI_ENTRY_SIZE = 28;
export const HMI_MAGIC = "ver21234";
export const HMI_PAGE_HEADER_SIZE = 0x38;

const MASK32 = 0xffffffff;

// The same non-reflected CRC-32 (poly 0x04C11DB7, 4 rounds per step) as
// tftCrc32, but XORing a whole little-endian dword per step instead of a
// byte. Native: achmi.dll CRC32_T. Only used for the directory checksum.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = (i << 24) >>> 0;
    for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (((c << 1) ^ 0x04c11db7) >>> 0) : (c << 1) >>> 0;
    table[i] = c;
  }
  return table;
})();

export function crc32Dwords(bytes: Uint8Array, init: number): number {
  let r = init >>> 0;
  for (let i = 0; i + 4 <= bytes.length; i += 4) {
    const word = (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0;
    r = (r ^ word) >>> 0;
    for (let k = 0; k < 4; k++) r = (((r << 8) >>> 0) ^ CRC_TABLE[(r >>> 24) & 0xff]) >>> 0;
  }
  return (r & MASK32) >>> 0;
}

function u32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

function ascii(b: Uint8Array, o: number, n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) {
    const c = b[o + i];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

export interface HmiEntry {
  index: number;
  name: string;
  start: number;
  size: number;
  deleted: boolean;
  /** the three trailing bytes of the entry, raw */
  tail: [number, number, number];
}

export interface HmiDirectory {
  count: number;
  entries: HmiEntry[];
  /** offset where the stored checksum sits: 4 + count * 28 */
  checksumOffset: number;
  storedChecksum: number;
  computedChecksum: number;
  checksumOk: boolean;
  backupIdentical: boolean;
  sentinelOk: boolean;
  magicOk: boolean;
}

export function readHmiDirectory(file: Uint8Array): HmiDirectory {
  const count = u32(file, 0);
  if (count === 0 || count > 4096) throw new Error(`implausible HMI directory count ${count}`);
  const entries: HmiEntry[] = [];
  for (let i = 0; i < count; i++) {
    const o = 4 + i * HMI_ENTRY_SIZE;
    entries.push({
      index: i,
      name: ascii(file, o, 16),
      start: u32(file, o + 0x10),
      size: u32(file, o + 0x14),
      deleted: file[o + 0x18] === 1,
      tail: [file[o + 0x19], file[o + 0x1a], file[o + 0x1b]],
    });
  }
  const checksumOffset = 4 + count * HMI_ENTRY_SIZE;
  const dirBytes = file.subarray(0, checksumOffset);
  const withSentinel = new Uint8Array(dirBytes.length + 4);
  withSentinel.set(dirBytes, 0);
  withSentinel.set([0x41, 0x44, 0x45, 0x43], dirBytes.length); // "ADEC"
  const computedChecksum = crc32Dwords(withSentinel, 0xffffffff);
  const storedChecksum = u32(file, checksumOffset);
  let backupIdentical = true;
  const backupLen = checksumOffset + 4;
  for (let i = 0; i < backupLen; i++) {
    if (file[i] !== file[HMI_BACKUP_DIRECTORY + i]) { backupIdentical = false; break; }
  }
  return {
    count,
    entries,
    checksumOffset,
    storedChecksum,
    computedChecksum,
    checksumOk: storedChecksum === computedChecksum,
    backupIdentical,
    sentinelOk: u32(file, HMI_SENTINEL) === 0xffffffff,
    magicOk: ascii(file, HMI_MAGIC_OFFSET, 8) === HMI_MAGIC,
  };
}

/** Live (not tombstoned) entries, by name. */
export function hmiLiveEntries(dir: HmiDirectory): Map<string, HmiEntry> {
  const map = new Map<string, HmiEntry>();
  for (const e of dir.entries) if (!e.deleted) map.set(e.name, e);
  return map;
}

export function hmiBlob(file: Uint8Array, entry: HmiEntry): Uint8Array {
  return file.subarray(entry.start, entry.start + entry.size);
}

export interface HmiPageContentHeader {
  startOffset: number;
  size: number;
  unknown: number;
}

export interface HmiPage {
  crc: number;
  computedCrc: number;
  crcOk: boolean;
  datasize: number;
  datainformationaddr: number;
  /** number of components on the page */
  numberobj: number;
  lockpassword: number;
  pagelock: number;
  hmiffid: number;
  filever: number;
  pagelei: number;
  name: string;
  upver: [number, number, number];
  contents: HmiPageContentHeader[];
}

/**
 * The page CRC: a five-segment chained CRC-32 over the blob with the
 * leading u32 excluded, then four short re-mixes of header fields
 * (eseverson, page_crc.py). The header is expected to already carry the
 * Editor's own values in [0x15..0x17] (0x4F, 0x21) — we verify, we do not
 * patch.
 */
export function hmiPageCrc(blob: Uint8Array): number {
  let crc = tftCrc32(blob.subarray(4), 0xffffffff);
  crc = tftCrc32(blob.subarray(4, 8), crc);
  crc = tftCrc32(blob.subarray(0x0c, 0x10), crc);
  crc = tftCrc32(blob.subarray(0x14, 0x15), crc);
  crc = tftCrc32(blob.subarray(0x15, 0x16), crc);
  return crc >>> 0;
}

export function readHmiPage(blob: Uint8Array): HmiPage {
  const numberobj = u32(blob, 0x0c);
  const contents: HmiPageContentHeader[] = [];
  for (let i = 0; i < numberobj; i++) {
    const o = HMI_PAGE_HEADER_SIZE + i * 12;
    contents.push({ startOffset: u32(blob, o), size: u32(blob, o + 4), unknown: u32(blob, o + 8) });
  }
  const crc = u32(blob, 0);
  const computedCrc = hmiPageCrc(blob);
  return {
    crc,
    computedCrc,
    crcOk: crc === computedCrc,
    datasize: u32(blob, 4),
    datainformationaddr: u32(blob, 8),
    numberobj,
    lockpassword: u32(blob, 0x10),
    pagelock: blob[0x14],
    hmiffid: blob[0x15],
    filever: blob[0x16],
    pagelei: blob[0x17],
    name: ascii(blob, 0x18, 16),
    upver: [blob[0x28], blob[0x29], blob[0x2a]],
    contents,
  };
}

export interface HmiMainHeader {
  crc: number;
  datasize: number;
  upver: [number, number, number];
  filever: number;
  xiliemark: number;
  guidire: number;
  encode: number;
  hmiffid: number;
  otp: number;
  modelcrc: number;
  password: number;
  resourcesFileTypeAddr: number;
  resourcesFileQty: number;
  /** declared resources, in declaration order: { ext: "i" | "zi" | "pa", name: "N.i" | "N.zi" | "N.pa", flag: byte 7 of the entry } */
  resources: { ext: string; name: string; flag?: number }[];
  computedCrc: number;
  crcOk: boolean;
}

/**
 * The `main.HMI` CRC: the same four-round kernel as the pages, chained
 * over the body and then four header fields — Modelcrc [0x10,0x14),
 * Datasize [4,8), filever [0xa,0xb), hmiffid [0xe,0xf). Found by
 * enumerating segment chains against the 6 distinct main.HMI blobs of the
 * 14 fixtures; closes eseverson's H5 for this entry. Datasize
 * and ResourcesFileTypeAddr are both 0x60 in every fixture, so [4,8) and
 * [0x18,0x1c) are indistinguishable there; Datasize is the natural reading.
 */
export function hmiMainCrc(blob: Uint8Array): number {
  let r = tftCrc32(blob.subarray(4), 0xffffffff);
  for (const [s, e] of [[0x10, 0x14], [4, 8], [0x0a, 0x0b], [0x0e, 0x0f]]) r = tftCrc32(blob.subarray(s, e), r);
  return r >>> 0;
}

export function readHmiMain(blob: Uint8Array): HmiMainHeader {
  const qty = u32(blob, 0x1c);
  const addr = u32(blob, 0x18);
  const resources: { ext: string; name: string; flag?: number }[] = [];
  const trimNul = (s: Uint8Array) => Array.from(s).filter((c) => c !== 0).map((c) => String.fromCharCode(c)).join("");
  for (let i = 0; i < qty; i++) {
    const o = addr + i * 16;
    // ext in the first 7 bytes; byte 7 is a flag (0x01 on two of joBr99's pictures, 0 everywhere else)
    resources.push({ ext: trimNul(blob.subarray(o, o + 7)), flag: blob[o + 7], name: trimNul(blob.subarray(o + 8, o + 16)) });
  }
  return {
    crc: u32(blob, 0),
    datasize: u32(blob, 4),
    upver: [blob[8], blob[9], blob[0x24]],
    filever: blob[0x0a],
    xiliemark: blob[0x0b],
    guidire: blob[0x0c],
    encode: blob[0x0d],
    hmiffid: blob[0x0e],
    otp: blob[0x0f],
    modelcrc: u32(blob, 0x10),
    password: u32(blob, 0x14),
    resourcesFileTypeAddr: addr,
    resourcesFileQty: qty,
    resources,
    computedCrc: hmiMainCrc(blob),
    crcOk: hmiMainCrc(blob) === u32(blob, 0),
  };
}

// ---------------------------------------------------------------------------
// Component records inside a page blob.
//
// The PageContentHeader rows point (relative to offset 0x38, the start of
// the row table) at one record per component, row 0 being the page itself
// (type 121). A record is self-describing:
//
//   u32 nameLen, "att-NN"            NN = number of attribute records
//   NN attribute records             each: u8 typebyte = 0x10 + width,
//                                    3 zero bytes, 8-byte NUL-padded name,
//                                    8 zero bytes, `width` value bytes
//                                    (a 20-char txt has typebyte 0x24)
//   event blocks                     each: u32 len, "codes<event>-<n>",
//                                    then n script lines (u32 len, ASCII);
//                                    events seen: load, loadend, down, up,
//                                    unload, timer, slide, ...
//   u32 0                            terminator
//
// The first attributes are always type, id, objname, then the geometry
// (x, y, w, h, endx, endy) and the type-specific ones. Values are little-
// endian; colours are RGB565 in 2 bytes; objname/txt are raw ASCII.

export interface HmiAttribute {
  name: string;
  width: number;
  /** offset of the value inside the component record */
  valueOffset: number;
  value: Uint8Array;
}

export interface HmiEvent {
  /** e.g. "down", "up", "load", "timer" */
  event: string;
  /** the Nextion script lines of the handler, as typed in the Editor (decoded as UTF-8 for display) */
  lines: string[];
  /** the lines' original bytes when read from a project, so re-encoding is byte-exact in any encoding */
  rawLines?: Uint8Array[];
}

const utf8 = new TextDecoder("utf-8");

export interface HmiComponent {
  /** PageContentHeader row index (0 = the page record) */
  row: number;
  /** absolute offset of the record inside the page blob, and its size */
  offset: number;
  size: number;
  /** the "att-NN" header */
  header: string;
  type: number;
  id: number;
  objname: string;
  x: number;
  y: number;
  w: number;
  h: number;
  attributes: HmiAttribute[];
  events: HmiEvent[];
}

function le(bytes: Uint8Array): number {
  let v = 0;
  for (let i = bytes.length - 1; i >= 0; i--) v = (v * 256) + bytes[i];
  return v;
}

function isAsciiRun(b: Uint8Array, o: number, n: number): boolean {
  for (let i = 0; i < n; i++) {
    const c = b[o + i];
    if (c < 32 || c > 126) return false;
  }
  return true;
}

/** Parses one component record starting at `offset` within a page blob. */
export function readHmiComponentRecord(blob: Uint8Array, offset: number, size: number, row: number): HmiComponent {
  const end = offset + size;
  let o = offset;
  const nameLen = u32(blob, o);
  const header = ascii(blob, o + 4, nameLen);
  if (!header.startsWith("att-")) throw new Error(`row ${row}: expected an att-NN header at 0x${offset.toString(16)}, found "${header}"`);
  o += 4 + nameLen;
  const declared = Number(header.slice(4));
  const attributes: HmiAttribute[] = [];
  for (let i = 0; i < declared && o < end; i++) {
    // typebyte 0x10 + width; 0x10 itself is an empty string (joBr99's blank txt fields)
    const tb = blob[o];
    if (tb < 0x10 || blob[o + 1] !== 0 || blob[o + 2] !== 0 || blob[o + 3] !== 0 || !isAsciiRun(blob, o + 4, 1)) {
      throw new Error(`row ${row}: attribute ${i} of ${declared} at 0x${o.toString(16)} does not look like an attribute record`);
    }
    const width = tb - 0x10;
    attributes.push({ name: ascii(blob, o + 4, 8), width, valueOffset: o + 20, value: blob.subarray(o + 20, o + 20 + width) });
    o += 20 + width;
  }
  const events: HmiEvent[] = [];
  while (o < end) {
    const len = u32(blob, o);
    if (len === 0) { o += 4; break; }
    if (len > 64 || !isAsciiRun(blob, o + 4, len)) throw new Error(`row ${row}: unexpected bytes at 0x${o.toString(16)}`);
    const label = ascii(blob, o + 4, len);
    o += 4 + len;
    const m = /^codes([a-z]+)-(\d+)$/.exec(label);
    if (!m) throw new Error(`row ${row}: unexpected event label "${label}"`);
    const lines: string[] = [];
    const rawLines: Uint8Array[] = [];
    for (let k = 0; k < Number(m[2]); k++) {
      const ll = u32(blob, o);
      // script text in the project's encoding (iso-8859-1 or UTF-8); the raw
      // bytes are kept so re-encoding stays byte-exact whatever it was
      rawLines.push(blob.subarray(o + 4, o + 4 + ll));
      lines.push(utf8.decode(blob.subarray(o + 4, o + 4 + ll)));
      o += 4 + ll;
    }
    events.push({ event: m[1], lines, rawLines });
  }
  const get = (name: string) => attributes.find((a) => a.name === name);
  const num = (name: string) => { const a = get(name); return a ? le(a.value) : NaN; };
  const objnameAttr = get("objname");
  return {
    row,
    offset,
    size,
    header,
    type: num("type"),
    id: num("id"),
    objname: objnameAttr ? Array.from(objnameAttr.value).filter((c) => c !== 0).map((c) => String.fromCharCode(c)).join("") : "",
    x: num("x"), y: num("y"), w: num("w"), h: num("h"),
    attributes,
    events,
  };
}

/** Every component of a page blob, row 0 being the page record. */
export function readHmiComponents(blob: Uint8Array): HmiComponent[] {
  const page = readHmiPage(blob);
  return page.contents.map((c, i) => readHmiComponentRecord(blob, HMI_PAGE_HEADER_SIZE + c.startOffset, c.size, i));
}

/** Convenience: every live page of the project, keyed by its `N.pa` entry name. */
export function hmiPages(file: Uint8Array): Map<string, HmiPage> {
  const live = hmiLiveEntries(readHmiDirectory(file));
  const pages = new Map<string, HmiPage>();
  for (const [name, entry] of live) {
    if (/^\d+\.pa$/.test(name)) pages.set(name, readHmiPage(hmiBlob(file, entry)));
  }
  return pages;
}
