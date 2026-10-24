// Internal-consistency properties of the .tft primitives. These need no
// fixtures: they check that the pieces agree with each other (a sealed
// file verifies, a decrypted header reads back what was written, a
// geometry write touches only the geometry bytes). Conformance with
// what the Nextion Editor actually produces is fixtures.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tftCrc32, checkHeader1Crc, checkTailChecksum, sealTailChecksum, checkDataRegionChecksum,
  header2Encrypt, header2Decrypt, header2Seed, decryptedHeader2, objxinxiAddress, objectCount,
  readUInt32LE, header1Fields, header2Fields, strdataaddr, RESOURCE_REGION_START,
  RECORD_SIZE, GEOMETRY_OFFSET, readComponentRecord, writeComponentGeometry, componentRecordOffset,
  onlyTailChanged,
} from "../dist/index.js";

// Deterministic xorshift so a failure reproduces.
let seed = 0x12345678;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed; };
const rndBytes = (n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = rnd() & 0xff; return b; };
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

test("crc: empty message returns init; deterministic; init-sensitive", () => {
  assert.equal(tftCrc32(new Uint8Array(0), 0xffffffff), 0xffffffff);
  const m = rndBytes(1000);
  assert.equal(tftCrc32(m, 0xffffffff), tftCrc32(m, 0xffffffff));
  assert.notEqual(tftCrc32(m, 0xffffffff), tftCrc32(m, 0));
});

test("crc: affine over GF(2) — a table-driven shift/xor recipe must satisfy f(a)^f(b)^f(a^b) == f(0)", () => {
  for (let t = 0; t < 200; t++) {
    const n = 1 + (rnd() % 64);
    const a = rndBytes(n), b = rndBytes(n), z = new Uint8Array(n), x = a.map((v, i) => v ^ b[i]);
    const f = (m) => tftCrc32(m, 0xffffffff);
    assert.equal((f(a) ^ f(b) ^ f(x)) >>> 0, f(z));
  }
});

test("header2 cipher: roundtrip, non-identity, seed sensitivity, block chaining", () => {
  for (let t = 0; t < 2000; t++) {
    const buf = rndBytes(200), s = rnd();
    const enc = header2Encrypt(buf, s);
    assert.ok(eq(header2Decrypt(enc, s), buf), "decrypt(encrypt(x)) must equal x");
    assert.ok(!eq(enc, buf), "encrypt must not be identity");
    assert.ok(!eq(header2Encrypt(buf, (s ^ 1) >>> 0), enc), "a different seed must give a different ciphertext");
    if (t < 200) {
      const k = rnd() % 50;
      const buf2 = Uint8Array.from(buf); buf2[k * 4] ^= 0x01;
      const enc2 = header2Encrypt(buf2, s);
      assert.ok(eq(enc.subarray(0, k * 4), enc2.subarray(0, k * 4)), "blocks before the change must be unaffected");
      assert.ok(!eq(enc.subarray(k * 4, k * 4 + 4), enc2.subarray(k * 4, k * 4 + 4)), "the changed block must differ");
    }
  }
  const odd = rndBytes(203); const e = header2Encrypt(odd, 7);
  assert.ok(eq(e.subarray(200), odd.subarray(200)) && eq(header2Decrypt(e, 7), odd), "a trailing partial block is left as is");
});

test("checksums on a synthetic file: write, verify, break, reseal", () => {
  const file = rndBytes(RESOURCE_REGION_START + 0x2000 + 4);
  const v = new DataView(file.buffer);
  v.setUint32(0x40, 0x2000, true);
  v.setUint32(0x3c, file.length, true);
  v.setUint32(0x44, tftCrc32(file.subarray(RESOURCE_REGION_START, RESOURCE_REGION_START + 0x2000), 0xffffffff), true);
  v.setUint32(0xc4, tftCrc32(file.subarray(0, 0xc4), 0xffffffff), true);
  assert.ok(checkDataRegionChecksum(file));
  assert.ok(checkHeader1Crc(file));

  const sealed = sealTailChecksum(file);
  assert.ok(checkTailChecksum(sealed));
  assert.ok(eq(sealed.subarray(0, sealed.length - 4), file.subarray(0, file.length - 4)), "seal only writes the last 4 bytes");

  const flipped = Uint8Array.from(sealed); flipped[0x11000] ^= 0x80;
  assert.ok(!checkTailChecksum(flipped));
  assert.ok(checkTailChecksum(sealTailChecksum(flipped)));

  const oversized = Uint8Array.from(file); new DataView(oversized.buffer).setUint32(0x40, 0xffffff, true);
  assert.ok(!checkDataRegionChecksum(oversized), "a region running past the file must not verify");
});

test("header1Fields / strdataaddr read the documented offsets", () => {
  const file = rndBytes(0x200);
  file[0x03] = 0x4e; file[0x01] = 1; file[0x02] = 68; file[0x14] = 3; file[0x33] = 0xff;
  const v = new DataView(file.buffer);
  v.setUint16(0x0c, 480, true); v.setUint16(0x0e, 320, true); v.setUint16(0x10, 320, true); v.setUint16(0x12, 480, true);
  v.setUint32(0x2e, 0x1ce47603, true); v.setUint32(0x3c, 123456, true); v.setUint32(0x40, 0x50000, true);
  const h = header1Fields(file);
  assert.deepEqual(
    [h.vendor, h.editorMajor, h.editorMinor, h.width, h.height, h.panelShort, h.panelLong, h.orientation, h.variantFlag, h.modelSeed, h.fileSize, h.resourceRegionLength],
    ["N", 1, 68, 480, 320, 320, 480, 3, 0xff, 0x1ce47603, 123456, 0x50000],
  );
  assert.equal(strdataaddr(file), 0x60000);
});

test("header2 helpers read back a synthetic decrypted header", () => {
  const file = rndBytes(0x400);
  const plain = new Uint8Array(200);
  const pv = new DataView(plain.buffer);
  pv.setUint32(0x10, RESOURCE_REGION_START, true);
  pv.setUint32(0x14, 0x60000, true);
  pv.setUint32(0x1c, 0x00012345, true);
  pv.setUint16(0x38, 7, true); pv.setUint16(0x3a, 42, true); pv.setUint16(0x44, 3, true);
  file.set(header2Encrypt(plain, header2Seed(file)), 0xc8);
  assert.ok(eq(decryptedHeader2(file), plain));
  assert.equal(objxinxiAddress(file), 0x00012345);
  assert.equal(objectCount(file), 42);
  const f = header2Fields(file);
  assert.equal(f.resourcesfileaddr, RESOURCE_REGION_START);
  assert.equal(f.strdataaddr, 0x60000);
  assert.equal(f.pageqty, 7);
  assert.equal(f.zimoqty, 3);
});

test("component geometry: write/read roundtrip, derived endx/endy, no collateral bytes", () => {
  const file = rndBytes(0x2000);
  const off = componentRecordOffset(0x1000, 3);
  assert.equal(off, 0x1000 + 3 * RECORD_SIZE);
  const out = writeComponentGeometry(file, off, { x: 12, y: 34, w: 100, h: 20 });
  const rec = readComponentRecord(out, off);
  assert.deepEqual([rec.x, rec.y, rec.w, rec.h, rec.endx, rec.endy], [12, 34, 100, 20, 111, 53]);
  for (let i = 0; i < file.length; i++) {
    const inGeom = i >= off + GEOMETRY_OFFSET && i < off + GEOMETRY_OFFSET + 12;
    if (!inGeom) assert.equal(out[i], file[i], `byte ${i} outside the geometry must be untouched`);
  }
  assert.notEqual(out, file, "input buffer must not be mutated");
});

test("onlyTailChanged: identical below strdataaddr passes; a byte in the resource region fails", () => {
  const file = rndBytes(RESOURCE_REGION_START + 0x20000);
  new DataView(file.buffer).setUint32(0x40, 0x10000, true); // strdataaddr = 0x20000
  const fine = Uint8Array.from(file); fine[0x25000] ^= 1; fine[fine.length - 1] ^= 1;
  assert.ok(onlyTailChanged(file, fine).ok);
  const bad = Uint8Array.from(file); bad[0x15000] ^= 1;
  const r = onlyTailChanged(file, bad);
  assert.ok(!r.ok);
  assert.equal(r.firstDiff, 0x15000);
  assert.ok(!onlyTailChanged(file, file.subarray(0, file.length - 1)).ok, "a length change is rejected");
});
