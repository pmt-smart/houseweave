// The form the panel stores its .tft in (src/tftPack.ts): what it
// packs reads back byte for byte, a chunk that does not shrink is kept as it
// is, the header and the index say the truth, a damaged file is refused, the
// real screens shrink as measured, and the Berry's vectors are this packer's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  packTft, unpackTft, packChunk, unpackChunk, packedTftHeader, isPackedTft, TFT_PACK_CHUNK,
} from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "hmi-scenarios", "out");

let seed = 0x9e3779b9;
const noise = (n) => {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed >>>= 0;
    b[i] = seed & 0xff;
  }
  return b;
};
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

test("what is packed reads back, at every size around a chunk's", () => {
  const sizes = [0, 1, 3, 4, 5, 100, TFT_PACK_CHUNK - 1, TFT_PACK_CHUNK, TFT_PACK_CHUNK + 1, 3 * TFT_PACK_CHUNK + 17];
  for (const n of sizes) {
    for (const raw of [new Uint8Array(n).fill(0xff), noise(n), Uint8Array.from({ length: n }, (_, i) => (i * 7) % 13)]) {
      const packed = packTft(raw);
      assert.ok(isPackedTft(packed), `${n}: magic`);
      assert.ok(same(unpackTft(packed), raw), `${n}: reads back`);
    }
  }
});

test("a chunk that does not shrink is kept as it is, and one that does is LZ", () => {
  const n = noise(TFT_PACK_CHUNK);
  assert.ok(same(packChunk(n), n));
  const run = new Uint8Array(TFT_PACK_CHUNK).fill(0);
  const p = packChunk(run);
  // one literal and one match of 4095 at offset 1: a token, the zero, the offset and the length's bytes
  assert.ok(p.length < 30, `${p.length} bytes for a run`);
  assert.equal(p[0] >> 4, 1);
  assert.equal(p[2] | (p[3] << 8), 1);
  assert.ok(same(unpackChunk(p, TFT_PACK_CHUNK), run));
});

test("the header and the index say the truth", () => {
  const raw = noise(2 * TFT_PACK_CHUNK + 10);
  const packed = packTft(raw);
  assert.equal(String.fromCharCode(...packed.subarray(0, 4)), "NXLZ");
  assert.equal(packed[4], 1);
  assert.equal(packed[5], 12);
  assert.equal(u32(packed, 8), raw.length);
  assert.equal(u32(packed, 12), 3);
  const h = packedTftHeader(packed);
  assert.deepEqual(h.offsets, [32, 32 + 4096, 32 + 8192, 32 + 8192 + 10]);
  assert.equal(h.offsets[3], packed.length);
});

test("the same .tft packs to the same bytes", () => {
  const raw = Uint8Array.from({ length: 20000 }, (_, i) => (i % 97) ^ (i >> 9));
  assert.ok(same(packTft(raw), packTft(raw)));
});

test("a damaged file is refused", () => {
  const raw = Uint8Array.from({ length: 9000 }, (_, i) => i % 251);
  const packed = packTft(raw);
  assert.throws(() => unpackTft(packed.subarray(0, packed.length - 1)), /not whole/);
  assert.throws(() => unpackTft(packed.subarray(0, 10)), /shorter than its header/);
  const other = packed.slice();
  other[4] = 2;
  assert.throws(() => unpackTft(other), /format 2/);
  const magicless = packed.slice();
  magicless[0] = 0;
  assert.throws(() => unpackTft(magicless), /no NXLZ magic/);
  // a match that reaches before its chunk
  assert.throws(() => unpackChunk(Uint8Array.from([0x10, 0x41, 0x05, 0x00]), 10), /does not fit/);
  // literals past the end
  assert.throws(() => unpackChunk(Uint8Array.from([0x50, 0x41]), 10), /literals run past/);
});

const screens = existsSync(out) ? readdirSync(out).filter((n) => /^p1-.*\.tft$/.test(n)) : [];
test("the real screens read back, at 36 to 45% of their size", { skip: screens.length === 0 && "no compiled screens in hmi-scenarios/out" }, () => {
  for (const n of screens) {
    const raw = new Uint8Array(readFileSync(join(out, n)));
    const packed = packTft(raw);
    assert.ok(same(unpackTft(packed), raw), `${n} reads back`);
    const ratio = packed.length / raw.length;
    assert.ok(ratio > 0.36 && ratio < 0.45, `${n}: ${(100 * ratio).toFixed(1)}%`);
  }
});

test("the Berry's vectors are what this packer writes", () => {
  const r = spawnSync(process.execPath, [join(root, "scripts", "tft-pack-vectors.mjs")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
