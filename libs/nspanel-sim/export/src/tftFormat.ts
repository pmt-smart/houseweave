// Reverse-engineered Nextion .tft binary format primitives.
// Validated against 10 independent .tft files (own test compiles,
// a public TJC sample, and 3 real third-party production releases).

const MASK32 = 0xffffffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = (i << 24) >>> 0;
    for (let k = 0; k < 8; k++) {
      c = c & 0x80000000 ? (((c << 1) ^ 0x04c11db7) >>> 0) : (c << 1) >>> 0;
    }
    table[i] = c;
  }
  return table;
})();

// Non-reflected CRC32 (poly 0x04C11DB7) with 4 chained rounds per byte
// instead of the textbook 1 — Nextion's own recipe on top of the
// standard table, not a named variant.
export function tftCrc32(bytes: Uint8Array, init: number): number {
  let crc = init >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    let combined = (crc ^ bytes[i]) >>> 0;
    let u = (((combined << 8) >>> 0) ^ CRC_TABLE[(combined >>> 24) & 0xff]) >>> 0;
    u = (((u << 8) >>> 0) ^ CRC_TABLE[(u >>> 24) & 0xff]) >>> 0;
    u = (((u << 8) >>> 0) ^ CRC_TABLE[(u >>> 24) & 0xff]) >>> 0;
    crc = (((u << 8) >>> 0) ^ CRC_TABLE[(u >>> 24) & 0xff]) >>> 0;
  }
  return crc >>> 0;
}

export function readUInt32LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

export function checkHeader1Crc(file: Uint8Array): boolean {
  const stored = readUInt32LE(file, 0xc4);
  return tftCrc32(file.subarray(0, 0xc4), MASK32) === stored;
}

export function checkTailChecksum(file: Uint8Array): boolean {
  const stored = readUInt32LE(file, file.length - 4);
  const raw = tftCrc32(file.subarray(0, file.length - 4), MASK32);
  const mask = file[0x2e] ^ file[0x3c] ^ file[0x03];
  return (raw ^ mask) >>> 0 === stored;
}

// Writes the correct tail checksum for a file whose body (everything but
// the last 4 bytes) has already been edited in place. Proven byte-for-byte
// against a real Nextion Editor compile: patching test_a.tft's "newtxt"
// text component to "abcdef" (same byte length) and resealing with this
// function reproduces test_b.tft — the Editor's own recompile of that
// exact edit — exactly, including the 4 tail bytes.
export function sealTailChecksum(file: Uint8Array): Uint8Array {
  const out = Uint8Array.from(file);
  const raw = tftCrc32(out.subarray(0, out.length - 4), MASK32);
  const mask = out[0x2e] ^ out[0x3c] ^ out[0x03];
  const stored = (raw ^ mask) >>> 0;
  out[out.length - 4] = stored & 0xff;
  out[out.length - 3] = (stored >>> 8) & 0xff;
  out[out.length - 2] = (stored >>> 16) & 0xff;
  out[out.length - 1] = (stored >>> 24) & 0xff;
  return out;
}

// The upper bound is not fixed at 0x60000: cross-validation against real
// third-party .tft files (production builds up to 8MB) shows it scales with
// project size, and it is read from an undocumented header field at
// 0x40-0x43.
export function checkDataRegionChecksum(file: Uint8Array): boolean {
  const stored = readUInt32LE(file, 0x44);
  const regionLength = readUInt32LE(file, 0x40);
  const end = 0x10000 + regionLength;
  if (end > file.length) return false;
  return tftCrc32(file.subarray(0x10000, end), MASK32) === stored;
}

const HEADER2_SBOX = [0xb6, 0x59, 0x26, 0x58, 0x9c, 0x9c, 0x82, 0xbd];
const HEADER2_SEED_A = 0x924f6584;
const HEADER2_SEED_B = 0xfbad3bbf;

function setByte(value: number, position: number, newByte: number): number {
  const shift = position * 8;
  return ((value & (~(0xff << shift) >>> 0)) >>> 0) | ((newByte & 0xff) << shift);
}

function getByte(value: number, position: number): number {
  return (value >>> (position * 8)) & 0xff;
}

function sub32(a: number, b: number, c: number): number {
  return (a - b - c) >>> 0;
}

// Discovery-series header2 cipher (caseD_20 in achmi.bin). Seeded by
// param3 = the header's own 0x2E-0x31 "model checksum" field, read
// directly — not derived. Applies to exactly the 200 bytes at
// 0xC8-0x18F; other Nextion series use a different, simpler XOR chain
// (irrelevant to this project's NX4832F035_011C hardware).
export function header2Encrypt(buffer: Uint8Array, param3Seed: number): Uint8Array {
  const buf = Uint8Array.from(buffer);
  const length4 = buf.length & ~3;
  let seedA = HEADER2_SEED_A;
  let seedB = HEADER2_SEED_B;
  let sboxIndex = 0;
  let offset = 0;
  let carryA = seedA;
  let carryB = seedB;
  let param3 = param3Seed >>> 0;

  while (offset < length4) {
    const key = HEADER2_SBOX[sboxIndex];
    const a1 = (((carryB << (key & 7)) >>> 0) + carryA + param3) >>> 0;

    const orig = readUInt32LE(buf, offset);
    const b1 = (((orig ^ a1) >>> 0) + a1 + param3) >>> 0;

    let local1c = (param3 * 2) >>> 0;
    const newLow = (getByte(local1c, 0) + (key ^ 0xbc)) & 0xff;
    local1c = setByte(local1c, 0, newLow);
    param3 = local1c;

    const seedAOld = seedA;
    const a2 = (seedB + seedAOld + param3) >>> 0;
    const b2 = (((a2 ^ b1) >>> 0) + a2 + seedAOld) >>> 0;

    seedA = (seedAOld * 4) >>> 0;
    const pos = 3 - (key & 3);
    seedA = setByte(seedA, pos, (getByte(seedA, pos) + (key ^ 0x58)) & 0xff);

    const seedBOld = seedB;
    const c1 = (((seedA + param3) >>> 0) ^ seedBOld) >>> 0;

    seedB = (seedBOld * 8) >>> 0;
    let c2 = ((((~c1) >>> 0) - offset - 8) >>> 0);
    const pos2 = 3 - (key & 3);
    seedB = setByte(seedB, pos2, (getByte(seedB, pos2) + (key ^ 0x7a)) & 0xff);

    const result = (((c2 ^ b2) >>> 0) + seedBOld + c2) >>> 0;
    buf[offset] = result & 0xff;
    buf[offset + 1] = (result >>> 8) & 0xff;
    buf[offset + 2] = (result >>> 16) & 0xff;
    buf[offset + 3] = (result >>> 24) & 0xff;

    offset += 4;
    sboxIndex = sboxIndex === 7 ? 0 : sboxIndex + 1;
    carryA = seedA;
    carryB = seedB;
  }
  return buf;
}

export function header2Decrypt(buffer: Uint8Array, param3Seed: number): Uint8Array {
  const buf = Uint8Array.from(buffer);
  const length4 = buf.length & ~3;
  let seedA = HEADER2_SEED_A;
  let seedB = HEADER2_SEED_B;
  let sboxIndex = 0;
  let offset = 0;
  let carryA = seedA;
  let carryB = seedB;
  let param3 = param3Seed >>> 0;

  while (offset < length4) {
    const key = HEADER2_SBOX[sboxIndex];
    const a1 = (((carryB << (key & 7)) >>> 0) + carryA + param3) >>> 0;
    const param3Before = param3;

    let local1c = (param3 * 2) >>> 0;
    const newLow = (getByte(local1c, 0) + (key ^ 0xbc)) & 0xff;
    local1c = setByte(local1c, 0, newLow);
    param3 = local1c;

    const seedAOld = seedA;
    const a2 = (seedB + seedAOld + param3) >>> 0;

    seedA = (seedAOld * 4) >>> 0;
    const pos = 3 - (key & 3);
    seedA = setByte(seedA, pos, (getByte(seedA, pos) + (key ^ 0x58)) & 0xff);

    const seedBOld = seedB;
    const c1 = (((seedA + param3) >>> 0) ^ seedBOld) >>> 0;

    seedB = (seedBOld * 8) >>> 0;
    const c2 = ((((~c1) >>> 0) - offset - 8) >>> 0);
    const pos2 = 3 - (key & 3);
    seedB = setByte(seedB, pos2, (getByte(seedB, pos2) + (key ^ 0x7a)) & 0xff);

    const resultVal = readUInt32LE(buf, offset);
    const b2 = (c2 ^ sub32(resultVal, seedBOld, c2)) >>> 0;
    const b1 = (a2 ^ sub32(b2, a2, seedAOld)) >>> 0;
    const orig = (a1 ^ sub32(b1, a1, param3Before)) >>> 0;

    buf[offset] = orig & 0xff;
    buf[offset + 1] = (orig >>> 8) & 0xff;
    buf[offset + 2] = (orig >>> 16) & 0xff;
    buf[offset + 3] = (orig >>> 24) & 0xff;

    offset += 4;
    sboxIndex = sboxIndex === 7 ? 0 : sboxIndex + 1;
    carryA = seedA;
    carryB = seedB;
  }
  return buf;
}

// param3 for the Discovery cipher is simply this header field.
export function header2Seed(file: Uint8Array): number {
  return readUInt32LE(file, 0x2e);
}

// Decrypted 200-byte header2 (0xC8-0x18F), for reading its fields.
export function decryptedHeader2(file: Uint8Array): Uint8Array {
  return header2Decrypt(file.subarray(0xc8, 0x190), header2Seed(file));
}

// Absolute file offset of the objxinxi component table. Unlike most
// header2 address fields (pageadd, strdataaddr itself, ...), this one
// is NOT relative to strdataaddr — confirmed by reading real records
// straight off this offset in eseverson/nextion-hmi's base.tft.
export function objxinxiAddress(file: Uint8Array): number {
  return readUInt32LE(decryptedHeader2(file), 0x1c);
}

// Component count (objqty, header2 field +0x3A).
export function objectCount(file: Uint8Array): number {
  const header2 = decryptedHeader2(file);
  return header2[0x3a] | (header2[0x3b] << 8);
}

// ---------------------------------------------------------------------
// Header1 (0x00-0xC7), decoded. Offsets come from nxt-doc where it has
// them (0x03, 0x0C-0x0F, 0x14, 0x2E, 0x3C, 0xC4) and from a byte-by-byte
// diff of 32 real files from 9 projects for the rest:
// every byte that varies between
// files sits in a few short runs; everything else is constant or 0xFF
// padding.

export const RESOURCE_REGION_START = 0x10000;

export interface Header1Fields {
  /** 0x03 — 'N' Nextion, 'T' TJC. */
  vendor: string;
  /** 0x01 / 0x02 — Nextion Editor version that compiled the file. */
  editorMajor: number;
  editorMinor: number;
  /** 0x0C-0x0F — logical resolution as the project sees it. */
  width: number;
  height: number;
  /**
   * 0x10-0x13 — the panel's physical short and long sides, independent
   * of orientation (320/480 on every 3.5" file, 240/320 on a 2.8" one).
   * Not in nxt-doc; consistent across the whole corpus.
   */
  panelShort: number;
  panelLong: number;
  /** 0x14 — 0=0°, 1=90°, 2=180°, 3=270°. NSPanel EU landscape is 3, US portrait is 2. */
  orientation: number;
  /**
   * 0x33 — stamped by the project's `encode`: 0xFF when
   * `encode` is 24 (UTF-8), 0x00 when it is 3. That is why every production
   * NSPanel .tft has 0xFF (joBr99 EU/US, Blackymas, lovejoy777) and every
   * dev-board compile 0x00 (eseverson, Gaggiuino) — the two groups differ in
   * the project setting, not in the hardware. The earlier reading, that this
   * was the touch-variant letter (`_011C` vs `_011R`), is dead: the model seed
   * at 0x2E is the same across both groups because the model IS the same.
   * Kept under this name for compatibility; being born right means compiling
   * the project with `encode` 24.
   */
  variantFlag: number;
  /** 0x2E-0x31 — "model checksum", also the header2 cipher seed. */
  modelSeed: number;
  /** 0x3C-0x3F — total file length. */
  fileSize: number;
  /** 0x40-0x43 — length of the checksummed resource region starting at 0x10000. */
  resourceRegionLength: number;
  /** 0x44-0x47 — checksum over that region. */
  resourceRegionChecksum: number;
  /** 0xC4-0xC7 — CRC over 0x00-0xC3. */
  header1Crc: number;
}

function readUInt16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

export function header1Fields(file: Uint8Array): Header1Fields {
  return {
    vendor: String.fromCharCode(file[0x03]),
    editorMajor: file[0x01],
    editorMinor: file[0x02],
    width: readUInt16LE(file, 0x0c),
    height: readUInt16LE(file, 0x0e),
    panelShort: readUInt16LE(file, 0x10),
    panelLong: readUInt16LE(file, 0x12),
    orientation: file[0x14],
    variantFlag: file[0x33],
    modelSeed: readUInt32LE(file, 0x2e),
    fileSize: readUInt32LE(file, 0x3c),
    resourceRegionLength: readUInt32LE(file, 0x40),
    resourceRegionChecksum: readUInt32LE(file, 0x44),
    header1Crc: readUInt32LE(file, 0xc4),
  };
}

// Where the resource region (fonts, pictures, and the display's own
// bootloader/firmware — nxt-doc puts the bootloader at 0x10080-0x2A046)
// ends and the structural data (strings, page and component tables)
// begins. Equal to header2's strdataaddr in every file checked, and
// always 64 KB aligned. Nothing a content or layout patch does may
// touch a byte below this address.
export function strdataaddr(file: Uint8Array): number {
  return RESOURCE_REGION_START + readUInt32LE(file, 0x40);
}

// Header2 (0xC8-0x18F, decrypted), the fields verified field-by-field
// against labelled diffs. Offsets are into the
// decrypted 200-byte block.
export interface Header2Fields {
  staticstrBeg: number;
  appAllvasAddr: number;
  appAllvasQty: number;
  attdataaddr: number;
  resourcesfileaddr: number;
  strdataaddr: number;
  pageadd: number;
  objxinxiadd: number;
  picxinxiadd: number;
  mainCodeHex: number;
  pageqty: number;
  objqty: number;
  picqty: number;
  zimoqty: number;
  encode: number;
}

export function header2Fields(file: Uint8Array): Header2Fields {
  const h = decryptedHeader2(file);
  return {
    staticstrBeg: readUInt32LE(h, 0x00),
    appAllvasAddr: readUInt32LE(h, 0x04),
    appAllvasQty: readUInt32LE(h, 0x08),
    attdataaddr: readUInt32LE(h, 0x0c),
    resourcesfileaddr: readUInt32LE(h, 0x10),
    strdataaddr: readUInt32LE(h, 0x14),
    pageadd: readUInt32LE(h, 0x18),
    objxinxiadd: readUInt32LE(h, 0x1c),
    picxinxiadd: readUInt32LE(h, 0x20),
    mainCodeHex: readUInt32LE(h, 0x34),
    pageqty: readUInt16LE(h, 0x38),
    objqty: readUInt16LE(h, 0x3a),
    picqty: readUInt16LE(h, 0x3c),
    zimoqty: readUInt16LE(h, 0x44),
    encode: readUInt32LE(h, 0x48),
  };
}
