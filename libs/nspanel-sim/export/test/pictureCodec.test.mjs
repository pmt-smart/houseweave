// The Editor's picture codec (pictureCodec.ts), proven against the donors:
// every encoded block decodes to its source PNG, our encoder re-creates every
// donor picture block for block (unused slots aside), the literal escape and
// the block cuts fall where the Editor puts them, and a generated track shrinks
// by the factor the donors showed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readHmiDirectory, hmiLiveEntries, hmiBlob, readHmiPictureBlob, addHmiPicture, readPictureIndex, picturePixels,
  encodeRowBlocks, encodeBlockRecord, decodeBlockRecord, encodePictureRuns, encodePicture, decodePicture, canonicalPictureBlob,
  MAX_BLOCK_WIDTH, LITERAL_ESCAPE, BLOCK_RECORD_SIZE, CODEC_HEADER_SIZE,
} from "../dist/index.js";
import { decodePng, rgbaToRgb565, testPattern } from "../scripts/lib/png.mjs";
import { pictureRgba, autoDither } from "../../layout/dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cachePath = (name) => join(root, "fixtures", "cache", name);
const load = (name) => new Uint8Array(readFileSync(cachePath(name)));
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const JOBR = "jobr99/nspanel.HMI", JOBR_TFT = "jobr99/nspanel.tft", F23 = "eseverson-hmi/23_minimal_project_23.HMI";
const have = (...names) => names.every((n) => existsSync(cachePath(n)));

/** RGB565 LE bytes from one number per pixel. */
const bytesOf = (px) => { const b = new Uint8Array(px.length * 2); px.forEach((v, i) => { b[i * 2] = v & 0xff; b[i * 2 + 1] = v >> 8; }); return b; };
const rowOf = (...runs) => runs.flatMap(([colour, n]) => Array(n).fill(colour));

/** Every encoded picture of a donor with its source PNG as RGB565. */
function donorPictures(file) {
  const live = hmiLiveEntries(readHmiDirectory(file));
  const out = [];
  for (const [name, e] of live) {
    const m = /^(\d+)\.i$/.exec(name);
    if (!m) continue;
    const rec = hmiBlob(file, e);
    const blob = rec.subarray(24);
    if (blob[0] !== 1) continue;
    const isEntry = live.get(`${m[1]}.is`);
    const b = hmiBlob(file, isEntry);
    let png = null;
    for (let at = 0; at + 8 <= b.length && !png; at++) if (b[at] === 0x89 && b[at + 1] === 0x50 && b[at + 2] === 0x4e && b[at + 3] === 0x47) png = decodePng(b.subarray(at));
    out.push({ name, width: rec[12] | (rec[13] << 8), height: rec[14] | (rec[15] << 8), blob, source: rgbaToRgb565(png.width, png.height, png.rgba) });
  }
  return out;
}

test("blocks: run form, the first nibble's cap of 14, the 119-px maximum, and the literal escape", () => {
  // a flat 100-px row is one block, `e f f f f f b`, seven slots used
  const [flat] = encodeRowBlocks(rowOf([0xffff, 100]));
  assert.deepEqual(flat.nibbles, [14, 15, 15, 15, 15, 15, 11]);
  assert.equal(flat.width, 100);
  const slots = new Array(8).fill(0x1234);
  const rec = encodeBlockRecord(flat, slots);
  assert.deepEqual([...rec.subarray(0, 4)], [0xfe, 0xff, 0xff, 0x0b]);
  assert.equal(rec[4 + 7 * 2] | (rec[5 + 7 * 2] << 8), 0x1234, "the unused eighth slot keeps its old colour");
  // 119 is one block, 120 is two
  assert.equal(encodeRowBlocks(rowOf([1, MAX_BLOCK_WIDTH])).length, 1);
  assert.deepEqual(encodeRowBlocks(rowOf([1, MAX_BLOCK_WIDTH + 1])).map((b) => b.width), [119, 1]);
  // a 15-px run at the start of a block spends two nibbles: 14 then 1
  assert.deepEqual(encodeRowBlocks(rowOf([1, 15]))[0].nibbles, [14, 1]);
  // joBr99 #23 row 12: the shape ends at 75 because the eighth nibble does
  const row12 = rowOf([0xffff, 25], [0xa514, 1], [0x9cd3, 48], [0xa514, 1], [0xffff, 25]);
  const blocks = encodeRowBlocks(row12);
  assert.deepEqual(blocks.map((b) => b.width), [75, 25]);
  assert.deepEqual(blocks[0].nibbles, [14, 11, 1, 15, 15, 15, 3, 1]);
  // eight pixels that all differ are the literal escape; a ninth equal to the eighth is not
  const distinct = [1, 2, 3, 4, 5, 6, 7, 8];
  assert.equal(encodeRowBlocks(distinct)[0].nibbles[0], LITERAL_ESCAPE);
  assert.deepEqual(encodeRowBlocks([...distinct, 8])[0].nibbles, [1, 1, 1, 1, 1, 1, 1, 2]);
  // and the record decodes back either way
  for (const row of [row12, distinct, [...distinct, 8], rowOf([7, 119])]) {
    const s = new Array(8).fill(0);
    const got = encodeRowBlocks(row).flatMap((b) => decodeBlockRecord(encodeBlockRecord(b, s)));
    assert.deepEqual(got, row);
  }
});

test("a picture round-trips through encode and decode, and the container lays out as the donors do", () => {
  const w = 100, h = 25;
  const px = [];
  for (let y = 0; y < h; y++) px.push(...(y >= 10 && y <= 13 ? rowOf([0xffff, 25], [0xa514, 1], [0x9cd3, 48], [0xa514, 1], [0xffff, 25]) : rowOf([0xffff, 100])));
  const blob = encodePictureRuns(w, h, bytesOf(px));
  // 25 rows, four of them two blocks: 29 records, index at 20 + 29*20 = 600, widths at 800, 829 in all -- joBr99 #23 exactly
  assert.equal(blob.length, 829);
  assert.equal(blob[4] | (blob[5] << 8), 600);
  assert.ok(same(decodePicture(blob, w, h), bytesOf(px)));
  // raw is chosen when the runs form is not smaller: eight distinct pixels a row costs 2.5 B/px encoded
  const dense = encodePicture(16, 4, bytesOf([...Array(64).keys()].map((i) => (i * 2053) & 0xffff)));
  assert.equal(dense.storage, "raw");
  assert.equal(dense.blob.length, CODEC_HEADER_SIZE + 16 * 4 * 2);
  assert.ok(same(decodePicture(dense.blob, 16, 4), bytesOf([...Array(64).keys()].map((i) => (i * 2053) & 0xffff))));
});

test("joBr99: every encoded picture decodes to its source PNG, and re-encodes to the same blocks", { skip: !have(JOBR) && "fixture not fetched" }, () => {
  const pics = donorPictures(load(JOBR));
  assert.ok(pics.length >= 20, `${pics.length} encoded pictures`);
  let identical = 0;
  for (const p of pics) {
    assert.ok(same(decodePicture(p.blob, p.width, p.height), p.source), `${p.name} decodes to its PNG`);
    const ours = encodePictureRuns(p.width, p.height, p.source);
    assert.equal(ours.length, p.blob.length, `${p.name}: same size`);
    // the only permitted difference is the leftover colour in slots no nibble uses
    assert.ok(same(canonicalPictureBlob(ours), canonicalPictureBlob(p.blob)), `${p.name}: same nibbles, same used slots, same widths, same index`);
    if (same(ours, p.blob)) identical++;
  }
  // the leftovers do mostly agree too, because both encoders carry them the same way
  assert.ok(identical >= pics.length / 2, `${identical} of ${pics.length} byte-identical`);
});

test("joBr99: the compiled .tft carries every .HMI picture blob verbatim, and picturePixels reads them", { skip: !have(JOBR, JOBR_TFT) && "fixtures not fetched" }, () => {
  const hmi = load(JOBR), tft = load(JOBR_TFT);
  const pics = donorPictures(hmi);
  const idx = readPictureIndex(tft);
  for (const p of pics) {
    const r = idx.find((r) => same(tft.subarray(r.dataOffset, r.dataOffset + r.size), p.blob));
    assert.ok(r, `${p.name} is in the .tft byte for byte`);
    assert.ok(same(picturePixels(tft, r), p.source));
  }
});

test("addHmiPicture stores the generated tracks encoded and reads them back; the cost follows the colour changes", { skip: !have(F23) && "fixture not fetched" }, () => {
  const track = (ramp, dither) => rgbaToRgb565(420, 32, pictureRgba({ kind: "ramp", ramp, width: 420, height: 32, radius: 16, background: 0, dither }));
  const pat = testPattern(420, 32);
  // brightness undithered: 64 colours in bands of about 7 px -- runs, so the donors' ratio
  const bri = addHmiPicture(load(F23), { width: 420, height: 32, rgb565: track("brightness", false), png: pat.png });
  assert.equal(bri.storage, "encoded");
  assert.ok(bri.ratio < 0.3, `brightness ratio ${bri.ratio.toFixed(3)}`);
  const back = readHmiPictureBlob(hmiBlob(bri.file, hmiLiveEntries(readHmiDirectory(bri.file)).get("0.i")));
  assert.equal(back.storage, "encoded");
  assert.ok(same(back.payload, track("brightness", false)));
  assert.equal(back.size, Math.round(bri.ratio * (CODEC_HEADER_SIZE + 420 * 32 * 2)));
  // the same track DITHERED, which is what `autoDither` picks at this width:
  // dither breaks every run, and a block of eight one-pixel runs is 2.5 bytes a
  // pixel, so the codec buys almost nothing. Measured 0.966. This is the price
  // of the smoother look, and it was invisible while everything went raw.
  const dithered = addHmiPicture(load(F23), { width: 420, height: 32, rgb565: track("brightness", autoDither("brightness", 420)), png: pat.png });
  assert.ok(dithered.ratio > 0.9 && dithered.ratio <= 1, `dithered brightness ratio ${dithered.ratio.toFixed(3)}`);
  // hue: 250 distinct colours across 420 px, close to the worst case even flat.
  // A track that changes colour every other pixel has no runs to give.
  const hue = addHmiPicture(load(F23), { width: 420, height: 32, rgb565: track("hue", false), png: pat.png });
  assert.equal(hue.storage, "encoded");
  assert.ok(hue.ratio > 0.7 && hue.ratio < 0.9, `hue ratio ${hue.ratio.toFixed(3)}`);
  // a record is 20 bytes and the container is what the donors have
  assert.equal(BLOCK_RECORD_SIZE, 20);
});
