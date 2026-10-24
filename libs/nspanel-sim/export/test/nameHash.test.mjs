// The name hash and the name table of a compiled .tft.
// The expected values were read out of .tft files the Nextion Editor itself
// compiled in the sandbox, one per name; they are the ground
// truth this implementation was derived from and must keep reproducing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tftNameHash, tftGlobalNameHash, encodeTftNameTable, TFT_NAME_MAX } from "../dist/index.js";

/** name -> u32 hash, read from the name table of the compiled scenario. */
const MEASURED = {
  a: 0xea00d314, b: 0x47c15cb9, c: 0x237e2622, d: 0x18835e54, e: 0x7c3c24cf,
  z: 0x3e084aba, A: 0x48e31b10, i: 0xc2b82115, q: 0xbb713716,
  aa: 0x8b1884c5, ab: 0x11a9a94d, ba: 0x26d90b68, aaa: 0x539fc593, aaaa: 0x335ada76,
  a1: 0x15b4e0e3, t1: 0xb64689a1, t2: 0x2cf7a429, t3: 0x5a98bf51, t4: 0x1d54e28e,
  t5: 0x6b3bf9f6, page0: 0xac967926, aVeryLongName: 0xa258630f,
};

test("tftNameHash reproduces every name measured in a compiled .tft", () => {
  for (const [name, hash] of Object.entries(MEASURED)) {
    assert.equal(tftNameHash(name), hash, `hash of "${name}"`);
  }
});

test("the hash is linear over GF(2): equal bit deltas give equal hash deltas", () => {
  // 'b'^'c' == 'd'^'e' == 0x01, and the hash deltas match
  assert.equal(tftNameHash("b") ^ tftNameHash("c"), tftNameHash("d") ^ tftNameHash("e"));
  // 'b'^'e' == 'c'^'d' == 0x07
  assert.equal(tftNameHash("b") ^ tftNameHash("e"), tftNameHash("c") ^ tftNameHash("d"));
});

test("a byte's map depends on its position, not on the name's length", () => {
  // the first character's delta is the same in a one- and a two-character name
  assert.equal(tftNameHash("a") ^ tftNameHash("b"), tftNameHash("aa") ^ tftNameHash("ba"));
});

test("encodeTftNameTable matches the bytes the Editor emitted", () => {
  // from m7-00-control.tft: a page "page0" (index 0) and a Text "t1" (index 1)
  const expected = Uint8Array.from([
    0x0c, 0x00, 0x00, 0x00,             // 12 bytes of entries
    0x26, 0x79, 0x96, 0xac, 0x00, 0x00, // page0 -> object 0
    0xa1, 0x89, 0x46, 0xb6, 0x01, 0x00, // t1    -> object 1
  ]);
  const got = encodeTftNameTable([{ name: "page0", index: 0 }, { name: "t1", index: 1 }]);
  assert.deepEqual(got, expected);
});

test("entries come out sorted by hash, whatever order they are given in", () => {
  // aVeryLongName hashes below page0, so it has to come first
  const got = encodeTftNameTable([{ name: "page0", index: 0 }, { name: "aVeryLongName", index: 1 }]);
  const view = new DataView(got.buffer);
  assert.equal(view.getUint32(4, true), tftNameHash("aVeryLongName"));
  assert.equal(view.getUint32(10, true), tftNameHash("page0"));
  assert.ok(view.getUint32(4, true) < view.getUint32(10, true));
});

test("names the Editor refuses are refused here too", () => {
  assert.equal(TFT_NAME_MAX, 14);
  assert.throws(() => tftNameHash(""), RangeError);
  assert.throws(() => tftNameHash("a".repeat(15)), RangeError);
  assert.doesNotThrow(() => tftNameHash("a".repeat(14)));
});

// The appAllvas table hashes a Program.s global with the same
// CRC as a component name, but with no padding.
test("tftGlobalNameHash reproduces the measured globals table", () => {
  const measured = {
    a: 0x6f60065b, ab: 0x808123dc, abc: 0x9c518b2c, abcde: 0xfa0fc852, abcdef: 0xaa82b9ae,
    abcdefgh: 0xc6760c3c, abcdefghij: 0xdd27109c, abcdefghijkl: 0xf0f078af,
    abcdefghijklm: 0x791ed516, abcdefghijklmn: 0x7cef810d,
    sys0: 0xd9f18195, sys1: 0xdd309c22, sys2: 0xd073bafb, sys3: 0xd4b2a74c, sys4: 0xcaf5f749,
  };
  for (const [name, hash] of Object.entries(measured)) assert.equal(tftGlobalNameHash(name) >>> 0, hash, name);
});

test("tftGlobalNameHash matches the globals of the joBr99 project", () => {
  // ten of the fifteen entries of d2-01; the other five are covered above
  const donor = {
    bufferPos: 0xb479b59a, recvCrc: 0x5b2c54e6, payloadLength: 0xe167922e, par0: 0x3bd61948,
    par1: 0x3f1704ff, sleepTimeout: 0xbcd1b243, sleepValue: 0x1e751376, dimValue: 0xa2faffd3,
    dimValueNormal: 0x1d812526, featNewSliders: 0x2a82b965,
  };
  for (const [name, hash] of Object.entries(donor)) assert.equal(tftGlobalNameHash(name) >>> 0, hash, name);
});

// The hash is a plain CRC-32 over the name widened a dword
// per character, so a global is not bound by the Editor's 14-character rule for
// component names. These two are the joBr99 globals a per-position table
// could not reach.
test("tftGlobalNameHash reaches the 16-byte globals of the joBr99 project", () => {
  assert.equal(tftGlobalNameHash("defaultFontColor") >>> 0, 0xa2f81fbc);
  assert.equal(tftGlobalNameHash("defaultBcoColor") >>> 0, 0xa3842c4f);
  assert.throws(() => tftGlobalNameHash(""), /cannot be empty/);
});

// The hash is linear over GF(2), so names of four characters or fewer cannot
// collide at all (32 input bits onto 32 output bits, and the map is one to one).
// From five characters up collisions exist, and the Editor detects a duplicate
// name by hash: it answers "Illegal name (CRC)". This pair is the one the
// campaign solved for and put in front of the Editor.
test("the name hash collides where the Editor says it does", () => {
  assert.equal(tftNameHash("aaaaaaaa") >>> 0, tftNameHash("gasukkwk") >>> 0);
  assert.notEqual(tftNameHash("aaaaaaaa") >>> 0, tftNameHash("gasukkwj") >>> 0);
});
