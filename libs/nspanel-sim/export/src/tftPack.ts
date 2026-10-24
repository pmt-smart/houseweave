// The panel's .tft, stored compressed in its file system.
//
// The display needs the .tft byte for byte, and only the display: the panel
// sends it over the UART 4 KB at a time, and its file system can hold it in any
// form the flash can turn back into those bytes. A .tft is 8% filler and most of
// the rest repeats, and stored this way the US's takes some 127
// blocks of 4 KB of the file system where the raw one took 318.
//
// The form, "NXLZ" format 1, little-endian:
//
//   0   "NXLZ"
//   4   u8   format, 1
//   5   u8   log2 of the chunk size, 12: chunks of 4096 bytes, the display's block
//   6   u16  0
//   8   u32  the .tft's size
//   12  u32  n, the number of chunks
//   16  u32 * (n + 1)  where each chunk starts in this file; the last is the file's size
//
// Each chunk is compressed alone, so any byte of the .tft is a lookup in the
// index and one chunk to decode -- the jump the display asks for when it holds
// part of the file already (berry/nextion_driver.be, resume_at) -- and the
// decoder keeps one chunk. A chunk that does not shrink is kept as it is, and
// is told by its length, which equals the chunk's. Otherwise it is LZ4
// sequences: a token, the literal count in its high nibble and the match length
// less 4 in its low one, 15 saying more bytes follow, each adding up to 255
// until one is less; the literals; the match's offset back, u16 from 1; and the
// match length's own extra bytes. A match reaches back only inside its chunk,
// and may overlap what it writes (an offset of 1 is a run). The last sequence
// may have literals only.
//
// berry/tft_pack.be decodes it on the panel. A file that does not start with
// the magic is a .tft as the Editor wrote it, and is flashed as it is.

export const TFT_PACK_MAGIC = "NXLZ";
export const TFT_PACK_FORMAT = 1;
export const TFT_PACK_CHUNK = 4096;
const CHUNK_LOG2 = 12;
const HEADER = 16;
const MIN_MATCH = 4;
// how many earlier places with the same 4 bytes a match is looked for at: the
// ratio stops improving around here, and a chunk is 4 KB
const CHAIN = 64;

const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const put32 = (b: Uint8Array, o: number, v: number) => {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
  b[o + 2] = (v >>> 16) & 0xff;
  b[o + 3] = (v >>> 24) & 0xff;
};

/** Whether these bytes start like a packed .tft. */
export function isPackedTft(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === TFT_PACK_MAGIC;
}

/**
 * One chunk as LZ4 sequences, greedy over a hash chain, or the chunk itself
 * when the sequences would not be shorter. Deterministic: the same chunk makes
 * the same bytes, so a packed file is reproducible.
 */
export function packChunk(src: Uint8Array): Uint8Array {
  const n = src.length;
  const out: number[] = [];
  const head = new Int32Array(1 << 12).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const hash = (i: number) => (Math.imul(src[i] | (src[i + 1] << 8) | (src[i + 2] << 16) | (src[i + 3] << 24), 2654435761) >>> 20);
  const insert = (i: number) => {
    if (i + MIN_MATCH > n) return;
    const h = hash(i);
    prev[i] = head[h];
    head[h] = i;
  };
  const length = (count: number) => {
    // the bytes after the token that a count of 15 or more takes
    let rest = count - 15;
    while (rest >= 255) {
      out.push(255);
      rest -= 255;
    }
    out.push(rest);
  };
  const sequence = (litStart: number, litEnd: number, offset: number, match: number) => {
    const lit = litEnd - litStart;
    const m = match > 0 ? match - MIN_MATCH : 0;
    out.push((Math.min(lit, 15) << 4) | Math.min(m, 15));
    if (lit >= 15) length(lit);
    for (let k = litStart; k < litEnd; k++) out.push(src[k]);
    if (match > 0) {
      out.push(offset & 0xff, offset >>> 8);
      if (m >= 15) length(m);
    }
  };
  let litStart = 0;
  let i = 0;
  while (i + MIN_MATCH <= n) {
    let best = 0;
    let bestAt = -1;
    let c = head[hash(i)];
    for (let tries = 0; c >= 0 && tries < CHAIN; tries++) {
      let l = 0;
      while (i + l < n && src[c + l] === src[i + l]) l++;
      if (l > best) {
        best = l;
        bestAt = c;
      }
      c = prev[c];
    }
    if (best >= MIN_MATCH) {
      sequence(litStart, i, i - bestAt, best);
      for (let k = 0; k < best; k++) insert(i + k);
      i += best;
      litStart = i;
    } else {
      insert(i);
      i++;
    }
  }
  if (litStart < n) sequence(litStart, n, 0, 0);
  return out.length < n ? Uint8Array.from(out) : src.slice();
}

/** One chunk back to its `size` bytes. Throws when the bytes do not make exactly that. */
export function unpackChunk(src: Uint8Array, size: number): Uint8Array {
  if (src.length === size) return src.slice();
  const out = new Uint8Array(size);
  let o = 0;
  let i = 0;
  const more = (count: number) => {
    let e = 255;
    while (e === 255) {
      if (i >= src.length) throw new Error("a length runs past the chunk");
      e = src[i++];
      count += e;
    }
    return count;
  };
  while (i < src.length) {
    const t = src[i++];
    let lit = t >> 4;
    if (lit === 15) lit = more(lit);
    if (i + lit > src.length || o + lit > size) throw new Error("literals run past the chunk");
    out.set(src.subarray(i, i + lit), o);
    o += lit;
    i += lit;
    if (i >= src.length) break;
    if (i + 2 > src.length) throw new Error("an offset runs past the chunk");
    const offset = src[i] | (src[i + 1] << 8);
    i += 2;
    let match = (t & 15) + MIN_MATCH;
    if ((t & 15) === 15) match = more(match);
    if (offset === 0 || offset > o || o + match > size) throw new Error(`a match of ${match} at ${offset} back does not fit at ${o}`);
    for (let k = 0; k < match; k++) out[o + k] = out[o + k - offset];
    o += match;
  }
  if (o !== size) throw new Error(`the chunk decodes to ${o} bytes, not ${size}`);
  return out;
}

/** The .tft, packed: header, index and chunks. */
export function packTft(raw: Uint8Array): Uint8Array {
  const count = Math.ceil(raw.length / TFT_PACK_CHUNK);
  const chunks: Uint8Array[] = [];
  for (let k = 0; k < count; k++) chunks.push(packChunk(raw.subarray(k * TFT_PACK_CHUNK, Math.min(raw.length, (k + 1) * TFT_PACK_CHUNK))));
  const start = HEADER + 4 * (count + 1);
  const total = chunks.reduce((s, c) => s + c.length, start);
  const out = new Uint8Array(total);
  for (let k = 0; k < 4; k++) out[k] = TFT_PACK_MAGIC.charCodeAt(k);
  out[4] = TFT_PACK_FORMAT;
  out[5] = CHUNK_LOG2;
  put32(out, 8, raw.length);
  put32(out, 12, count);
  let at = start;
  for (let k = 0; k < count; k++) {
    put32(out, HEADER + 4 * k, at);
    out.set(chunks[k], at);
    at += chunks[k].length;
  }
  put32(out, HEADER + 4 * count, at);
  return out;
}

export interface PackedTftHeader {
  /** the .tft's size */
  size: number;
  /** its chunks */
  count: number;
  /** where each chunk starts in the packed file, and its end */
  offsets: number[];
}

/** The header and the index of a packed .tft, checked against the file's length. Throws when it is not whole. */
export function packedTftHeader(packed: Uint8Array): PackedTftHeader {
  if (!isPackedTft(packed)) throw new Error("not a packed .tft: no NXLZ magic");
  if (packed.length < HEADER) throw new Error("a packed .tft shorter than its header");
  if (packed[4] !== TFT_PACK_FORMAT || packed[5] !== CHUNK_LOG2) throw new Error(`a packed .tft of format ${packed[4]}, chunks of 2^${packed[5]}: this reads format ${TFT_PACK_FORMAT}, chunks of 2^${CHUNK_LOG2}`);
  const size = u32(packed, 8);
  const count = u32(packed, 12);
  if (count !== Math.ceil(size / TFT_PACK_CHUNK)) throw new Error(`${count} chunks for ${size} bytes`);
  if (packed.length < HEADER + 4 * (count + 1)) throw new Error("a packed .tft shorter than its index");
  const offsets: number[] = [];
  for (let k = 0; k <= count; k++) offsets.push(u32(packed, HEADER + 4 * k));
  if (offsets[0] !== HEADER + 4 * (count + 1)) throw new Error(`the first chunk starts at ${offsets[0]}, not right after the index`);
  for (let k = 0; k < count; k++) if (offsets[k + 1] <= offsets[k]) throw new Error(`chunk ${k} has no bytes`);
  if (offsets[count] !== packed.length) throw new Error(`the index ends at ${offsets[count]}, and the file has ${packed.length} bytes: it is not whole`);
  return { size, count, offsets };
}

/** The .tft a packed file stands for. Throws when the file is damaged. */
export function unpackTft(packed: Uint8Array): Uint8Array {
  const { size, count, offsets } = packedTftHeader(packed);
  const out = new Uint8Array(size);
  for (let k = 0; k < count; k++) {
    const chunkSize = Math.min(TFT_PACK_CHUNK, size - k * TFT_PACK_CHUNK);
    out.set(unpackChunk(packed.subarray(offsets[k], offsets[k + 1]), chunkSize), k * TFT_PACK_CHUNK);
  }
  return out;
}
