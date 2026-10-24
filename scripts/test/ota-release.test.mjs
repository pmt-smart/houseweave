// The release tool (scripts/ota-release.mjs): the record the safeboot checks, the blocks it inflates, the key it is signed with.
// What ties this to the safeboot's receiver is RFC 8032's first test vector: Node's Ed25519 signs it here as the RFC says, and the
// receiver's host test (firmware/host-tests/espnow-ota-receiver) verifies the same vector with the firmware's own code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { BLOCK_KB, MANIFEST_MAX, RECORD_LEN, SAFEBOOT_FILE, buildOf, checks, cString, keyPath, makeKey, manifestText, packImage, publish, rawPublic, readKey, record, signFile } from "../ota-release.mjs";

const hex = (h) => Buffer.from(h, "hex");
const b64url = (b) => Buffer.from(b).toString("base64url");
const RFC_SEED = hex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
const RFC_PUBLIC = hex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
const RFC_EMPTY_SIGNATURE = hex("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b");
const rfcKey = () => createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", d: b64url(RFC_SEED), x: b64url(RFC_PUBLIC) }, format: "jwk" });

/** an image like a firmware: text that compresses, and noise that does not */
function image(size, seed) {
  const d = Buffer.alloc(size);
  let s = seed;
  for (let i = 0; i < size; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    d[i] = i % 3000 < 1800 ? "Tasmota safeboot ".charCodeAt(i % 17) : s >>> 24;
  }
  d[0] = 0xe9;
  return d;
}

test("Node's Ed25519 signs RFC 8032's first vector as the RFC says, which the receiver verifies", () => {
  const key = rfcKey();
  assert.deepEqual(rawPublic(key), RFC_PUBLIC);
  assert.deepEqual(sign(null, Buffer.alloc(0), key), RFC_EMPTY_SIGNATURE);
  assert.equal(cString(RFC_PUBLIC), '"\\xd7\\x5a\\x98\\x01\\x82\\xb1\\x0a\\xb7\\xd5\\x4b\\xfe\\xd3\\xc9\\x64\\x07\\x3a\\x0e\\xe1\\x72\\xf3\\xda\\xa6\\x23\\x25\\xaf\\x02\\x1a\\x68\\xf7\\x07\\x51\\x1a"',
    "the public half as the C string the build carries");
});

test("the record is the receiver's 39 bytes: size, blocks, block size, SHA-256", () => {
  const r = record(150000, 3, 64, Buffer.alloc(32, 0xab));
  assert.equal(r.length, RECORD_LEN);
  assert.equal(r.readUInt32LE(0), 150000);
  assert.equal(r.readUInt16LE(4), 3);
  assert.equal(r[6], 64);
  assert.deepEqual(r.subarray(7), Buffer.alloc(32, 0xab));
});

test("an image packed: blocks of 64 KB, each inflating to its part of the image, and an offer of 103 bytes, signed", () => {
  const img = image(150000, 1);
  const key = rfcKey();
  const { manifest, blocks } = packImage(img, key);
  assert.equal(manifest.blockKb, BLOCK_KB);
  assert.equal(manifest.blocks.length, 3);
  let at = 0;
  manifest.blocks.forEach((length, i) => {
    const out = inflateRawSync(blocks.subarray(at, at + length));
    assert.deepEqual(out, img.subarray(i * 65536, (i + 1) * 65536), `block ${i}, after the ones before it, inflates to its part`);
    at += length;
  });
  assert.equal(at, blocks.length);
  assert.ok(blocks.length < img.length, "and the whole is smaller");
  const offer = hex(manifest.offer);
  assert.equal(offer.length, 103);
  assert.deepEqual(offer.subarray(0, RECORD_LEN), hex(manifest.record));
  assert.deepEqual(offer.subarray(RECORD_LEN), hex(manifest.signature));
  assert.ok(checks(img, manifest, RFC_PUBLIC), "the signature checks, and says this image");
  const changed = Buffer.from(img);
  changed[1000] ^= 1;
  assert.ok(!checks(changed, manifest, RFC_PUBLIC), "a changed image does not");
  const other = generateKeyPairSync("ed25519").publicKey;
  assert.ok(!checks(img, manifest, rawPublic(other)), "nor does another key");
});

test("the manifest of the largest image a sender takes (48 blocks, 3 MB that do not compress) fits what a device's JSON parser reads", () => {
  const noise = Buffer.alloc(48 * 65536);
  for (let i = 0, s = 3; i < noise.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    noise[i] = s >>> 24;
  }
  const { manifest } = packImage(noise, rfcKey());
  assert.equal(manifest.blocks.length, 48);
  const text = manifestText("tasmota32-houseweave-living-room-us-0123abcd+-4567cdef+.bin", manifest);
  assert.ok(text.length <= MANIFEST_MAX, `${text.length} bytes`);
  assert.deepEqual(JSON.parse(text).blocks, manifest.blocks);
  assert.throws(() => manifestText("x".repeat(MANIFEST_MAX), manifest), /past the 2047 a device reads/, "one past it is refused");
});

test("a build's name says its image and its build, as the image's stamp says it", () => {
  assert.deepEqual(buildOf("releases/tasmota32-houseweave-living-room-us-a91d8b13-319cddad.bin"),
    { image: "tasmota32-houseweave-living-room-us", build: "a91d8b13/319cddad" });
  assert.deepEqual(buildOf("tasmota32-houseweave-bridge-9fd01b78+-3a69628a+.bin"),
    { image: "tasmota32-houseweave-bridge", build: "9fd01b78+/3a69628a+" }, "a build of changes nobody committed keeps its +");
  assert.equal(buildOf("tasmota32-houseweave-living-room-us-a91d8b13-319cddad.factory.bin"), null, "a factory image is not a release");
  assert.equal(buildOf("houseweave-safeboot.bin"), null);
});

test("published: each image packed in its folder, the safeboot image signed whole, and the index of the builds", () => {
  const dir = mkdtempSync(join(tmpdir(), "ota-publish-"));
  try {
    const src = join(dir, "src");
    mkdirSync(src);
    const app = image(150000, 2);
    const boot = image(90000, 3);
    writeFileSync(join(src, "tasmota32-houseweave-living-room-us-a91d8b13-319cddad.bin"), app);
    writeFileSync(join(src, "tasmota32-houseweave-safeboot-a91d8b13-319cddad.bin"), boot);
    const to = join(dir, "ota");
    const key = rfcKey();
    const at = new Date(2026, 9, 20, 23, 26);
    const index = publish([join(src, "tasmota32-houseweave-living-room-us-a91d8b13-319cddad.bin"), join(src, "tasmota32-houseweave-safeboot-a91d8b13-319cddad.bin")], to, key, at);
    assert.deepEqual(index.images["tasmota32-houseweave-living-room-us"],
      { path: "tasmota32-houseweave-living-room-us.ota", build: "a91d8b13/319cddad", size: 150000, date: "2026-10-20T23:26",
        sha256: createHash("sha256").update(app).digest("hex") }, "with the image's SHA-256, by which a neighbour knows the release a node waits for");
    assert.deepEqual(Object.keys(index.images), ["tasmota32-houseweave-living-room-us"], "the safeboot image has none");
    assert.deepEqual(index.safeboot, { path: SAFEBOOT_FILE, build: "a91d8b13/319cddad", size: 90000, date: "2026-10-20T23:26" });
    assert.deepEqual(JSON.parse(readFileSync(join(to, "index.json"), "utf8")), index, "the index, as written");
    const manifest = JSON.parse(readFileSync(join(to, "tasmota32-houseweave-living-room-us.ota", "manifest.json"), "utf8"));
    assert.ok(checks(app, manifest, RFC_PUBLIC), "the image's manifest, signed");
    assert.equal(readFileSync(join(to, "tasmota32-houseweave-living-room-us.ota", "blocks.bin")).length, manifest.blocks.reduce((a, b) => a + b, 0));
    assert.deepEqual(readFileSync(join(to, SAFEBOOT_FILE)), boot);
    assert.ok(checks(boot, JSON.parse(readFileSync(join(to, SAFEBOOT_FILE + ".sig.json"), "utf8")), RFC_PUBLIC), "the safeboot image, signed whole");
    // a later build of another image leaves this one's as it was
    const bridge = image(120000, 4);
    writeFileSync(join(src, "tasmota32-houseweave-bridge-b0000001-319cddad.bin"), bridge);
    const after = publish([join(src, "tasmota32-houseweave-bridge-b0000001-319cddad.bin")], to, key, at);
    assert.equal(after.images["tasmota32-houseweave-bridge"].build, "b0000001/319cddad");
    assert.equal(after.images["tasmota32-houseweave-living-room-us"].build, "a91d8b13/319cddad");
    assert.equal(after.safeboot.build, "a91d8b13/319cddad");
    assert.throws(() => publish([join(src, "tasmota32-houseweave-living-room-us-a91d8b13-319cddad.bin.copy")], to, key), /not a build's name/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a file that goes whole is signed with no blocks", () => {
  const data = Buffer.from("a .jsonl line\n".repeat(100));
  const signed = signFile(data, rfcKey());
  const r = hex(signed.record);
  assert.equal(r.readUInt32LE(0), data.length);
  assert.equal(r.readUInt16LE(4), 0);
  assert.equal(r[6], 0);
  assert.ok(checks(data, signed, RFC_PUBLIC));
});

test("the house's key: made once, outside the repository, never written over", () => {
  const dir = mkdtempSync(join(tmpdir(), "ota-release-"));
  try {
    const path = keyPath({ HOUSEWEAVE_RELEASE_KEY: join(dir, "keys", "release.pem") });
    assert.throws(() => readKey(path), /no key at/);
    const made = makeKey(path);
    assert.ok(existsSync(path));
    assert.match(readFileSync(path, "utf8"), /BEGIN PRIVATE KEY/);
    assert.deepEqual(rawPublic(readKey(path)), rawPublic(made), "read back, the same key");
    assert.throws(() => makeKey(path), /exists/, "a second one is refused");
    const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
    assert.ok(!keyPath({}).startsWith(repoRoot), "and by default it is beside the repository, not in it");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
