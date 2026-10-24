// The Nextion Editor's picture codec -- the `flag 1` form of a `.i` blob, which
// the compiler copies into the `.tft` untouched and the panel's firmware draws
// from flash.
//
// DECODED against every encoded block of every donor `.HMI` in fixtures/cache
// (14 072 blocks, 26 pictures, all with their source PNG): each one
// reconstructs its pixels exactly (test/pictureCodec.test.mjs).
//
// THE UNIT IS A BLOCK, not a row: a horizontal slice of one row, described by
// one width byte and one 20-byte record:
//
//   4 bytes   eight NIBBLES, low nibble of byte 0 first: run lengths, 0..15
//   16 bytes  eight RGB565 colours, one per nibble, in the same order
//
// A run of one colour is written as nibbles of 15 until fewer than 15 remain,
// each nibble taking its own colour slot. Eight slots per block, so a block
// holds at most eight nibbles: a row breaks into a new block when they are used
// up, whatever the pixels are doing -- which is why a 100-px row with a shape in
// its middle is stored as `75 25` and the same shape two pixels wider as `73 27`.
//
// Two conventions the Editor follows, reproduced so its own decoder (and the
// panel's) sees nothing new:
//
//   * the FIRST nibble of a block never exceeds 14, because 15 there is the
//     escape for a LITERAL block: eight pixels, one per colour slot, the other
//     seven nibbles written as 1 and not read. The encoder takes it exactly
//     when the eight runs would all be 1 -- the escape is that block's
//     spelling, and the form with eight 1-nibbles never occurs (0 of 14 072).
//     A flat 100-px row is therefore `e f f f f f b`, and the widest block is
//     14 + 7 * 15 = 119 pixels;
//   * slots the block does not use keep whatever colour they held before.
//     That is the encoder's leftover state, not information: the eighth word
//     of a flat 100-px block is a colour from elsewhere in the picture, or from
//     the picture the Editor encoded before it. This encoder carries the slots
//     across blocks the same way, starting from zero.
//
// THE CONTAINER, around the blocks:
//
//   +0   u32   1
//   +4   u32   rowIndexAt        offset of the row index from the blob start
//   +8   12B   zero
//   +20        the records, 20 bytes each, every block in row-major order
//   rowIndexAt: h pairs of u32 (recordAt, widthsAt), offsets from the blob start
//   then       the width bytes, one per block, in the same order
//
// WHAT IT BUYS. A row costs 21 bytes per block instead of 2 bytes per pixel, so
// a flat 119-px block is 21 bytes against 238, and a picture is cheaper encoded
// whenever its rows have fewer than about one colour change every ten pixels.
// Dense pictures cost MORE (a literal block is 2.5 bytes a pixel, plus the
// index), which is why `encodePicture` measures both and keeps the smaller --
// the same choice the Editor makes, since its tiny pictures are stored raw.
//
// The decoder in the panel is fixed silicon: this has to be its format, not a
// better one. Same situation as the `.zi` fonts.

/** Colour slots -- and therefore nibbles -- in one block record. */
export const BLOCK_SLOTS = 8;
/** The longest run one nibble can hold. */
export const RUN_MAX = 15;
/** The first nibble's cap: 15 there is the literal escape. */
export const FIRST_RUN_MAX = 14;
export const LITERAL_ESCAPE = 15;
export const BLOCK_RECORD_SIZE = 4 + BLOCK_SLOTS * 2;
/** The widest a run block can be: 14 + 7 * 15. */
export const MAX_BLOCK_WIDTH = FIRST_RUN_MAX + (BLOCK_SLOTS - 1) * RUN_MAX;
export const CODEC_HEADER_SIZE = 20;
export const FLAG_RAW = 0;
export const FLAG_ENCODED = 1;

export interface PictureBlock {
  /** run lengths, one per slot; `nibbles[0] === LITERAL_ESCAPE` marks a literal block */
  nibbles: number[];
  /** RGB565, one per slot; unused slots carry the encoder's leftover state */
  colours: number[];
  /** pixels this block covers */
  width: number;
}

function u16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}

function u32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

function putU16(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >> 8) & 0xff;
}

function putU32(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >> 8) & 0xff;
  b[o + 2] = (v >> 16) & 0xff;
  b[o + 3] = (v >>> 24) & 0xff;
}

/** The blocks of one row, cut the way the Editor cuts them. */
export function encodeRowBlocks(row: ArrayLike<number>): PictureBlock[] {
  const blocks: PictureBlock[] = [];
  let x = 0;
  while (x < row.length) {
    const nibbles: number[] = [];
    const colours: number[] = [];
    const start = x;
    while (nibbles.length < BLOCK_SLOTS && x < row.length) {
      const colour = row[x];
      const cap = nibbles.length === 0 ? FIRST_RUN_MAX : RUN_MAX;
      let n = 1;
      while (n < cap && x + n < row.length && row[x + n] === colour) n++;
      nibbles.push(n);
      colours.push(colour);
      x += n;
    }
    // eight runs of one pixel are spelt as the literal escape
    const allOnes: boolean = nibbles.every((n) => n === 1);
    if (nibbles.length === BLOCK_SLOTS && allOnes) nibbles[0] = LITERAL_ESCAPE;
    blocks.push({ nibbles, colours, width: x - start });
  }
  return blocks;
}

/** One block's 20-byte record; `slots` is the leftover state, updated in place. */
export function encodeBlockRecord(block: PictureBlock, slots: number[]): Uint8Array {
  const rec = new Uint8Array(BLOCK_RECORD_SIZE);
  for (let k = 0; k < block.nibbles.length; k++) {
    rec[k >> 1] |= (block.nibbles[k] & 0xf) << ((k & 1) * 4);
    slots[k] = block.colours[k];
  }
  for (let k = 0; k < BLOCK_SLOTS; k++) putU16(rec, 4 + k * 2, slots[k]);
  return rec;
}

/** The pixels of one 20-byte record. */
export function decodeBlockRecord(rec: Uint8Array, at = 0): number[] {
  if ((rec[at] & 0xf) === LITERAL_ESCAPE) {
    return Array.from({ length: BLOCK_SLOTS }, (_, k) => u16(rec, at + 4 + k * 2));
  }
  const out: number[] = [];
  for (let k = 0; k < BLOCK_SLOTS; k++) {
    const n = (rec[at + (k >> 1)] >> ((k & 1) * 4)) & 0xf;
    const colour = u16(rec, at + 4 + k * 2);
    for (let i = 0; i < n; i++) out.push(colour);
  }
  return out;
}

/** RGB565 little-endian bytes -> one number per pixel. */
function pixelsOf(rgb565: Uint8Array): Uint16Array {
  const px = new Uint16Array(rgb565.length / 2);
  for (let i = 0; i < px.length; i++) px[i] = u16(rgb565, i * 2);
  return px;
}

/**
 * The `flag 1` blob: 20-byte header, records, row index, widths. Always
 * encodes -- `encodePicture` is the one that decides whether that was worth it.
 */
export function encodePictureRuns(width: number, height: number, rgb565: Uint8Array): Uint8Array {
  if (rgb565.length !== width * height * 2) throw new RangeError(`picture: expected ${width * height * 2} bytes, got ${rgb565.length}`);
  const px = pixelsOf(rgb565);
  const rows = Array.from({ length: height }, (_, y) => encodeRowBlocks(px.subarray(y * width, (y + 1) * width)));
  const total = rows.reduce((n, r) => n + r.length, 0);
  const rowIndexAt = CODEC_HEADER_SIZE + total * BLOCK_RECORD_SIZE;
  const widthsAt = rowIndexAt + height * 8;
  const out = new Uint8Array(widthsAt + total);
  putU32(out, 0, FLAG_ENCODED);
  putU32(out, 4, rowIndexAt);
  const slots = new Array<number>(BLOCK_SLOTS).fill(0);
  let rec = CODEC_HEADER_SIZE;
  let wat = widthsAt;
  rows.forEach((blocks, y) => {
    putU32(out, rowIndexAt + y * 8, rec);
    putU32(out, rowIndexAt + y * 8 + 4, wat);
    for (const b of blocks) {
      out.set(encodeBlockRecord(b, slots), rec);
      rec += BLOCK_RECORD_SIZE;
      out[wat++] = b.width;
    }
  });
  return out;
}

/** The raw blob: a zero 20-byte header, then the pixels. */
export function encodePictureRaw(width: number, height: number, rgb565: Uint8Array): Uint8Array {
  if (rgb565.length !== width * height * 2) throw new RangeError(`picture: expected ${width * height * 2} bytes, got ${rgb565.length}`);
  const out = new Uint8Array(CODEC_HEADER_SIZE + rgb565.length);
  out.set(rgb565, CODEC_HEADER_SIZE);
  return out;
}

export interface EncodedPicture {
  blob: Uint8Array;
  storage: "raw" | "encoded";
  /** blob size against the raw blob's */
  ratio: number;
}

/** The smaller of the two forms, which is the choice the Editor makes too. */
export function encodePicture(width: number, height: number, rgb565: Uint8Array): EncodedPicture {
  const raw = encodePictureRaw(width, height, rgb565);
  const runs = encodePictureRuns(width, height, rgb565);
  return runs.length < raw.length
    ? { blob: runs, storage: "encoded", ratio: runs.length / raw.length }
    : { blob: raw, storage: "raw", ratio: 1 };
}

/** The pixels of a blob in either form, as RGB565 little-endian bytes. */
export function decodePicture(blob: Uint8Array, width: number, height: number): Uint8Array {
  const flag = u32(blob, 0);
  if (flag === FLAG_RAW) {
    if (blob.length !== CODEC_HEADER_SIZE + width * height * 2) throw new RangeError(`raw picture blob: ${blob.length} bytes for ${width}x${height}`);
    return blob.slice(CODEC_HEADER_SIZE);
  }
  if (flag !== FLAG_ENCODED) throw new RangeError(`picture blob: unknown flag ${flag}`);
  const rowIndexAt = u32(blob, 4);
  const out = new Uint8Array(width * height * 2);
  for (let y = 0; y < height; y++) {
    const recAt = u32(blob, rowIndexAt + y * 8);
    const wat = u32(blob, rowIndexAt + y * 8 + 4);
    const wend = y + 1 < height ? u32(blob, rowIndexAt + (y + 1) * 8 + 4) : blob.length;
    let x = 0;
    for (let k = 0; k < wend - wat; k++) {
      const px = decodeBlockRecord(blob, recAt + k * BLOCK_RECORD_SIZE);
      if (px.length !== blob[wat + k]) throw new RangeError(`picture row ${y} block ${k}: nibbles sum to ${px.length}, width byte says ${blob[wat + k]}`);
      for (const v of px) putU16(out, (y * width + x++) * 2, v);
    }
    if (x !== width) throw new RangeError(`picture row ${y}: blocks cover ${x} of ${width} pixels`);
  }
  return out;
}

/**
 * A blob with its unused colour slots zeroed -- the encoder's leftover state
 * removed, which is the only part of an encoded picture that two encoders of
 * the same pixels may legitimately differ on.
 */
export function canonicalPictureBlob(blob: Uint8Array): Uint8Array {
  if (u32(blob, 0) !== FLAG_ENCODED) return blob.slice();
  const out = blob.slice();
  const rowIndexAt = u32(blob, 4);
  for (let at = CODEC_HEADER_SIZE; at + BLOCK_RECORD_SIZE <= rowIndexAt; at += BLOCK_RECORD_SIZE) {
    const literal = (out[at] & 0xf) === LITERAL_ESCAPE;
    for (let k = 0; k < BLOCK_SLOTS; k++) {
      const n = (out[at + (k >> 1)] >> ((k & 1) * 4)) & 0xf;
      if (!literal && n === 0) putU16(out, at + 4 + k * 2, 0);
    }
  }
  return out;
}
