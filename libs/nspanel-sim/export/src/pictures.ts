// Picture resources of a compiled .tft (Discovery series, as compiled by
// Nextion Editor 1.6x): where every picture lives, its dimensions and how
// it is stored. Byte-verified against five donors
// (joBr99 EU, Blackymas EU, lovejoy777, Gaggiuino, eseverson 15_picture).
//
// Layout:
//   header2.picxinxiadd is an ABSOLUTE file offset (inside the resource
//   region) of a table of `picqty` records of 24 bytes:
//     +0  u32  0x0301640a         marker (bytes 0a 64 01 03), every record
//     +4  u32  id                 0..picqty-1
//     +8  u32  offset             of the blob, relative to the table start;
//                                 the first blob starts right after the
//                                 table (offset == 24 * picqty), and the
//                                 blobs are contiguous in id order
//     +12 u16  width
//     +14 u16  height
//     +16 u32  size               of the blob in bytes, 20-byte header included
//     +20 u32  0
//   Each blob starts with a 20-byte header: u32 flag, u32 codecField, 12
//   zero bytes. flag 0 = raw RGB565 little-endian (size == w*h*2 + 20; the
//   Editor's choice for tiny pictures); flag 1 = run-encoded, and the second
//   u32 is the offset of the row index. The whole encoding is decoded and
//   written by pictureCodec.ts; `picturePixels` reads either.
import { header2Fields } from "./tftFormat.js";
import { decodePicture } from "./pictureCodec.js";

export const PICTURE_RECORD_SIZE = 24;
export const PICTURE_BLOB_HEADER_SIZE = 20;
export const PICTURE_RECORD_MARKER = 0x0301640a;

export interface PictureRecord {
  index: number;
  id: number;
  /** absolute file offset of the blob (20-byte header included) */
  dataOffset: number;
  width: number;
  height: number;
  /** blob size in bytes, header included */
  size: number;
  storage: "raw" | "compressed";
  /**
   * Second u32 of the blob header; 0 for raw pictures.
   *
   * For an encoded picture it is the offset of the ROW INDEX from the start of
   * the blob: one (recordAt, widthsAt) pair of u32 per row. It is a multiple of
   * 20 in every sample because the 20-byte BLOCK records start at 20 and the
   * index comes right after the last of them. What the blocks are, and the
   * whole codec, is in pictureCodec.ts.
   */
  codecField: number;
}

function u16(file: Uint8Array, offset: number): number {
  return file[offset] | (file[offset + 1] << 8);
}

function u32(file: Uint8Array, offset: number): number {
  return (file[offset] | (file[offset + 1] << 8) | (file[offset + 2] << 16) | (file[offset + 3] << 24)) >>> 0;
}

/** Absolute file offset of the picture index table. */
export function pictureIndexAddress(file: Uint8Array): number {
  return header2Fields(file).picxinxiadd;
}

/** Reads the picture index. Throws if a record does not carry the marker. */
export function readPictureIndex(file: Uint8Array): PictureRecord[] {
  const h2 = header2Fields(file);
  const table = h2.picxinxiadd;
  const records: PictureRecord[] = [];
  for (let i = 0; i < h2.picqty; i++) {
    const at = table + i * PICTURE_RECORD_SIZE;
    const marker = u32(file, at);
    if (marker !== PICTURE_RECORD_MARKER) {
      throw new Error(`picture record ${i} at 0x${at.toString(16)} has marker 0x${marker.toString(16)}, expected 0x${PICTURE_RECORD_MARKER.toString(16)}`);
    }
    const dataOffset = table + u32(file, at + 8);
    const flag = u32(file, dataOffset);
    records.push({
      index: i,
      id: u32(file, at + 4),
      dataOffset,
      width: u16(file, at + 12),
      height: u16(file, at + 14),
      size: u32(file, at + 16),
      storage: flag === 0 ? "raw" : "compressed",
      codecField: u32(file, dataOffset + 4),
    });
  }
  return records;
}

/** Raw RGB565 pixels of a picture stored uncompressed; null for compressed ones. */
export function rawPixels(file: Uint8Array, record: PictureRecord): Uint8Array | null {
  if (record.storage !== "raw") return null;
  const start = record.dataOffset + PICTURE_BLOB_HEADER_SIZE;
  return file.subarray(start, start + record.width * record.height * 2);
}

/** RGB565 little-endian pixels of any picture, decoding the run-encoded ones. */
export function picturePixels(file: Uint8Array, record: PictureRecord): Uint8Array {
  return decodePicture(file.subarray(record.dataOffset, record.dataOffset + record.size), record.width, record.height);
}
