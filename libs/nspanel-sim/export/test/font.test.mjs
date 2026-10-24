// The .zi font reader/writer/codec (src/font.ts), against every font the
// fixtures carry: 3 from the eseverson projects and 8 from joBr99's, 272 bytes
// to 3.3 MB, 26520 glyphs in all.
//
// Two rulers. The one the rest of this package uses -- read a real file, write
// it again, demand the same bytes -- and, for the glyph codec, the pixel count:
// a glyph must decode to exactly (advance + kerningLeft + kerningRight) * height
// pixels. That second one is what caught the last wrong model, because a decoder
// that is off anywhere lands off everywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readHmiDirectory, hmiLiveEntries, hmiBlob,
  readZi, writeZi, subsetZi, mergeZi, ziGlyphMap, ziIsSorted, isZi, ZI_HEADER_SIZE, ZI_RECORD_SIZE,
  decodeZiGlyph, encodeZiGlyph, ziBitmapWidth, ZI_MODE_BW, ZI_MODE_AA, ZI_ALPHA_MAX,
} from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cache = join(root, "fixtures", "cache");
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const u8 = (b, o) => b[o];
const u24 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
/** Offset of the first glyph stream, relative to the start of the glyph table. */
function firstStreamOffset(bytes) {
  const tableAt = u32(bytes, 0x18) + u8(bytes, 0x11);
  const count = u32(bytes, 0x0c);
  let first = Infinity;
  for (let i = 0; i < count; i++) first = Math.min(first, u24(bytes, tableAt + i * 10 + 5));
  return first;
}

// The .zi entries of these .HMI fixtures, de-duplicated: 11 distinct fonts,
// all ZI version 6, covering both code pages (ISO-8859-1 and UTF-8), heights 15
// to 128 and sizes from 272 bytes to 3.3 MB.
const SOURCES = [
  ["eseverson-hmi", "00_baseline_base.HMI"],
  ["eseverson-hmi", "17_more_components_17.HMI"],
  ["jobr99", "nspanel.HMI"],
];

function loadFonts() {
  const out = [];
  const seen = new Set();
  for (const [dir, file] of SOURCES) {
    const path = join(cache, dir, file);
    if (!existsSync(path)) continue;
    const bytes = new Uint8Array(readFileSync(path));
    for (const [name, entry] of hmiLiveEntries(readHmiDirectory(bytes))) {
      if (!name.endsWith(".zi")) continue;
      const blob = hmiBlob(bytes, entry);
      const key = `${blob.length}:${blob[44]}:${blob[45]}:${blob[46]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ where: `${dir}/${file}#${name}`, blob });
    }
  }
  return out;
}

const fonts = loadFonts();
const skip = fonts.length === 0 && "fixtures not fetched";

test("a .zi is recognised by its magic, and nothing else is", { skip }, () => {
  for (const { blob } of fonts) assert.ok(isZi(blob));
  assert.equal(isZi(Uint8Array.from([0x04, 0xff, 0x00, 0x0b])), false);
  assert.equal(isZi(new Uint8Array(4)), false);
  assert.throws(() => readZi(new Uint8Array(64)), /not a \.zi/);
});

test("read then write gives the same bytes, for every font in the corpus", { skip }, () => {
  assert.ok(fonts.length >= 3, `only ${fonts.length} fonts found`);
  for (const { where, blob } of fonts) {
    const again = writeZi(readZi(blob));
    assert.ok(same(again, blob), `${where}: ${again.length} bytes vs ${blob.length}`);
  }
});

test("the header describes the file it is in", { skip }, () => {
  for (const { where, blob } of fonts) {
    const f = readZi(blob);
    // payload size and header size are the two self-describing fields
    const payload = blob[0x14] | (blob[0x15] << 8) | (blob[0x16] << 16) | (blob[0x17] << 24);
    assert.equal(payload, blob.length - ZI_HEADER_SIZE, where);
    assert.ok(f.height > 0 && f.height <= 255, where);
    assert.ok(f.glyphs.length > 0, where);
    // the name field is the two strings back to back, nothing between them
    assert.equal(blob[0x11], f.name.length + f.encoding.length, where);
    assert.ok(/^(iso-8859-1|utf-8|gb2312|big5|shift-jis)/i.test(f.encoding), `${where}: encoding "${f.encoding}"`);
  }
});

test("the glyph table is ascending by codepoint, with no repeats", { skip }, () => {
  for (const { where, blob } of fonts) assert.ok(ziIsSorted(readZi(blob)), where);
});

test("every glyph decodes to exactly its bitmap's worth of pixels", { skip }, () => {
  // The whole model in one assertion. The bitmap is the advance PLUS both
  // kernings wide -- reading it as advance * height fails on the combining marks
  // and the CJK ideographs, which is how that error was found.
  let glyphs = 0;
  const bad = [];
  for (const { where, blob } of fonts) {
    const f = readZi(blob);
    for (const g of f.glyphs) {
      if (g.data.length === 0) continue;
      glyphs++;
      const px = decodeZiGlyph(g.data);
      const want = ziBitmapWidth(g) * f.height;
      if (px.length !== want && bad.length < 5)
        bad.push(`${where} U+${g.code.toString(16).toUpperCase().padStart(4, "0")}: ${px.length} != ${want}`);
    }
  }
  assert.deepEqual(bad, []);
  // an exact count, not a floor: a floor 500 below reality would stay green if a
  // whole font silently dropped out of the corpus
  assert.equal(glyphs, 26508, "224+12+224+3+95+94+7120+7120+7120+2248+2248");
});

test("the mode byte is a property of the glyph, not of the font", { skip }, () => {
  // An anti-aliased font still stores a shape with no soft edge in black and
  // white, which is why the font-level flag at +0x1e cannot be used to pick a
  // decoder.
  let bwInAaFont = 0, aaGlyphs = 0;
  for (const { blob } of fonts) {
    const f = readZi(blob);
    if (!f.antiAlias) continue;
    for (const g of f.glyphs) {
      if (g.data.length === 0) continue;
      assert.ok(g.data[0] === ZI_MODE_BW || g.data[0] === ZI_MODE_AA);
      if (g.data[0] === ZI_MODE_BW) bwInAaFont++; else aaGlyphs++;
    }
  }
  assert.ok(bwInAaFont > 0, "expected black-and-white glyphs inside anti-aliased fonts");
  assert.ok(aaGlyphs > 0);
});

test("a blank glyph is all clear, and a drawn one uses the whole alpha range", { skip }, () => {
  const f = readZi(fonts[0].blob);
  const byCode = ziGlyphMap(f);
  const space = byCode.get(0x20);
  assert.ok(space, "the corpus fonts all carry U+0020");
  assert.ok(decodeZiGlyph(space.data).every((a) => a === 0), "the space is not blank");

  const levels = new Set();
  for (const g of f.glyphs) for (const a of decodeZiGlyph(g.data)) levels.add(a);
  assert.ok(levels.has(0) && levels.has(ZI_ALPHA_MAX), "clear and opaque must both appear");
  assert.ok(levels.size > 2, "an anti-aliased font must use intermediate alphas");
  for (const a of levels) assert.ok(a >= 0 && a <= ZI_ALPHA_MAX, `alpha ${a} out of range`);
});

test("encode then decode returns the same pixels, for every glyph", { skip }, () => {
  // The encoder does not have to reproduce the Editor's byte choices -- several
  // streams decode to the same bitmap -- so what is asserted is the round trip.
  let glyphs = 0, ourBytes = 0, editorBytes = 0;
  const bad = [];
  for (const { where, blob } of fonts) {
    const f = readZi(blob);
    for (const g of f.glyphs) {
      if (g.data.length === 0) continue;
      glyphs++;
      const px = decodeZiGlyph(g.data);
      const again = encodeZiGlyph(px);
      editorBytes += g.data.length;
      ourBytes += again.length;
      const back = decodeZiGlyph(again);
      if (back.length !== px.length || !back.every((v, i) => v === px[i])) {
        if (bad.length < 5) bad.push(`${where} U+${g.code.toString(16).toUpperCase().padStart(4, "0")}`);
      }
    }
  }
  assert.deepEqual(bad, [], "glyphs that did not survive encode -> decode");
  assert.equal(glyphs, 26508);
  // not a requirement, but a runaway encoder would show up here
  // the Editor's own encoding is the benchmark; ours may be a little worse, and
  // a bound of 2x would have tolerated almost any regression
  assert.ok(ourBytes < editorBytes * 1.15, `our encoding is ${(ourBytes / editorBytes).toFixed(3)}x the Editor's`);
});

test("the codec survives bitmaps that end on an awkward boundary", () => {
  // The corpus cannot catch these: a real glyph's last pixel is background, so
  // 26520 round trips never exercise a bitmap that ENDS on a partial alpha. The
  // two-pixel form writes exactly two pixels, and reaching for it with one pixel
  // left appended a phantom one -- found by attacking the encoder rather than by
  // running it over more of the same data.
  const cases = [
    [7, 3],
    [3],
    [0, 0, 3],
    [...new Array(20).fill(0), 3],
    [...new Array(40).fill(0), 3],
    [7, 3, 5],
    [3, 7, 5],
    [1, 0, 2, 0, 3, 0, 4],
    [0, 1, 2, 3, 4, 5, 6, 7],
    [4, 0, 0],
    [7],
    [0],
    [],
  ];
  for (const px of cases) {
    const back = decodeZiGlyph(encodeZiGlyph(px));
    assert.deepEqual([...back], px, `[${px.join(",")}]`);
  }
});

test("encode then decode returns the same pixels for random bitmaps too", () => {
  // A deterministic pseudo-random sweep, because hand-picked cases only find
  // the bugs someone thought of. The mix is skewed towards clear and opaque, the
  // way a real glyph is, but every length and every alpha shows up.
  let seed = 20260912;
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let round = 0; round < 400; round++) {
    const len = 1 + Math.floor(next() * 200);
    const px = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      const r = next();
      px[i] = r < 0.55 ? 0 : r < 0.85 ? 7 : 1 + Math.floor(next() * 6);
    }
    const encoded = encodeZiGlyph(px);
    const back = decodeZiGlyph(encoded);
    assert.equal(back.length, px.length, `round ${round}: ${px.length} pixels in, ${back.length} out`);
    assert.deepEqual([...back], [...px], `round ${round}`);
    // and the mode must follow the content, not the caller
    const hasPartial = [...px].some((a) => a !== 0 && a !== ZI_ALPHA_MAX);
    assert.equal(encoded[0], hasPartial ? ZI_MODE_AA : ZI_MODE_BW, `round ${round}: wrong mode`);
  }
});

test("the codec handles the shapes a generator will actually produce", { skip: false }, () => {
  const H = 8, W = 6;
  const solid = new Uint8Array(W * H).fill(ZI_ALPHA_MAX);
  assert.equal(encodeZiGlyph(solid)[0], ZI_MODE_BW);
  assert.deepEqual([...decodeZiGlyph(encodeZiGlyph(solid))], [...solid]);

  const blank = new Uint8Array(W * H);
  assert.deepEqual([...decodeZiGlyph(encodeZiGlyph(blank))], [...blank]);

  // a diagonal, which forces the clear-then-opaque forms
  const diag = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) diag[y * W + (y % W)] = ZI_ALPHA_MAX;
  assert.deepEqual([...decodeZiGlyph(encodeZiGlyph(diag))], [...diag]);

  // partial alpha forces the anti-aliased mode
  const soft = new Uint8Array(W * H);
  for (let i = 0; i < soft.length; i++) soft[i] = i % 8;
  assert.equal(encodeZiGlyph(soft)[0], ZI_MODE_AA);
  assert.deepEqual([...decodeZiGlyph(encodeZiGlyph(soft))], [...soft]);

  // a run longer than one instruction can carry
  const longRun = new Uint8Array(200).fill(ZI_ALPHA_MAX);
  assert.deepEqual([...decodeZiGlyph(encodeZiGlyph(longRun))], [...longRun]);

  assert.throws(() => encodeZiGlyph([0, 8]), /outside 0\.\.7/);
  assert.throws(() => decodeZiGlyph(Uint8Array.from([0x02, 0x00])), /unknown mode/);
});

test("a subset keeps the streams intact and shrinks the file", { skip }, () => {
  const { blob } = fonts[0];
  const full = readZi(blob);
  const keep = full.glyphs.slice(0, 5).map((g) => g.code);
  const small = subsetZi(full, keep);
  assert.equal(small.glyphs.length, keep.length);

  const bytes = writeZi(small);
  assert.ok(bytes.length < blob.length, `${bytes.length} is not smaller than ${blob.length}`);
  const back = readZi(bytes);
  assert.equal(back.glyphs.length, keep.length);
  assert.ok(ziIsSorted(back));
  assert.equal(back.height, full.height);
  assert.equal(back.name, full.name);

  const before = ziGlyphMap(full);
  const after = ziGlyphMap(back);
  for (const code of keep) {
    assert.ok(same(after.get(code).data, before.get(code).data), `stream of U+${code.toString(16)} changed`);
    assert.equal(after.get(code).advance, before.get(code).advance);
    assert.equal(after.get(code).kerningLeft, before.get(code).kerningLeft);
    assert.equal(after.get(code).kerningRight, before.get(code).kerningRight);
  }
  // the header must now describe the smaller file, not the one it came from
  const payload = bytes[0x14] | (bytes[0x15] << 8) | (bytes[0x16] << 16) | (bytes[0x17] << 24);
  assert.equal(payload, bytes.length - ZI_HEADER_SIZE);
  // ...plus the alignment padding: the first glyph stream starts on an 8-byte
  // boundary in all 11 corpus fonts, three of which pad to make it so, and the
  // writer reproduces that.
  const table = ZI_HEADER_SIZE + back.name.length + back.encoding.length + keep.length * ZI_RECORD_SIZE;
  const pad = (8 - ((keep.length * ZI_RECORD_SIZE) % 8)) % 8;
  assert.equal(bytes.length, table + pad + keep.reduce((n, c) => n + after.get(c).data.length, 0));
  assert.equal(firstStreamOffset(bytes) % 8, 0, "the first glyph stream must be 8-byte aligned");
});

test("the first glyph stream is 8-byte aligned in every corpus font", { skip }, () => {
  // Not a compiler requirement -- d1-07-own-font had a table of 140 bytes, a
  // misaligned first stream, and the Editor compiled it clean. But 11 of 11
  // fonts the Editor wrote ARE aligned, three of them by padding with zeros, so
  // the writer matches it: the panel's own reader has never been tested.
  for (const { where, blob } of fonts) {
    assert.equal(firstStreamOffset(blob) % 8, 0, where);
  }
});

test("the code page is one byte, and reading the pair as a u16 would be wrong", { skip }, () => {
  // +0x05 is a separate field taking 0, 1 and 2. Read as a u16 the code page
  // comes out wrong in 10 of the 11 fonts -- the same defect class as reading
  // the name length as a u32 and swallowing the align8 flag.
  let wrongIfU16 = 0;
  for (const { where, blob } of fonts) {
    const f = readZi(blob);
    assert.ok(f.codePage === 0x03 || f.codePage === 0x18, `${where}: code page 0x${f.codePage.toString(16)}`);
    assert.equal(f.codePage, blob[0x04]);
    assert.ok([0, 1, 2].includes(f.charsetMode), `${where}: +0x05 = ${f.charsetMode}`);
    if ((blob[0x04] | (blob[0x05] << 8)) !== f.codePage) wrongIfU16++;
  }
  assert.ok(wrongIfU16 >= 10, `only ${wrongIfU16} fonts would break under a u16 read`);
});

test("a subset asking for a glyph the font has not got fails only when strict", { skip }, () => {
  const full = readZi(fonts[0].blob);
  const absent = 0xfffe; // not in any of these fonts
  assert.equal(subsetZi(full, [full.glyphs[0].code, absent]).glyphs.length, 1);
  assert.throws(() => subsetZi(full, [absent], { strict: true }), /has no glyph for U\+FFFE/);
});

test("splitting a font in two and merging it back gives the same glyph set", { skip }, () => {
  // The merge that matters is assembling an icon set out of glyph streams, but
  // this is the version that can be checked against a known answer.
  const full = readZi(fonts[0].blob);
  const codes = full.glyphs.map((g) => g.code);
  const even = subsetZi(full, codes.filter((_, i) => i % 2 === 0));
  const odd = subsetZi(full, codes.filter((_, i) => i % 2 === 1));
  const rejoined = mergeZi([even, odd]);

  assert.equal(rejoined.glyphs.length, full.glyphs.length);
  assert.ok(ziIsSorted(rejoined));
  const before = ziGlyphMap(full);
  for (const g of rejoined.glyphs) assert.ok(same(g.data, before.get(g.code).data), `U+${g.code.toString(16)}`);
  // and it survives a trip through the file format
  assert.equal(readZi(writeZi(rejoined)).glyphs.length, full.glyphs.length);
});

test("a later font wins the codepoints it shares with an earlier one", { skip }, () => {
  const full = readZi(fonts[0].blob);
  const a = subsetZi(full, full.glyphs.slice(0, 4).map((g) => g.code));
  const b = subsetZi(full, full.glyphs.slice(2, 6).map((g) => g.code));
  // give b's copies a distinguishable advance
  b.glyphs = b.glyphs.map((g) => ({ ...g, advance: 1 }));
  const merged = ziGlyphMap(mergeZi([a, b]));
  assert.equal(merged.size, 6);
  assert.equal(merged.get(full.glyphs[0].code).advance, full.glyphs[0].advance);
  assert.equal(merged.get(full.glyphs[3].code).advance, 1, "b should have won the overlap");
});

test("a subset is marked as one in the header, the way the Editor marks its own", { skip }, () => {
  // The Editor writes 2 at +0x05 for every subset we can check -- its own
  // 12-glyph font, and everything its Font Creator produced for us. Before this
  // was noticed our subsets carried the parent's value, so a 14-glyph font
  // declared the complete ISO-8859-1 character set.
  const full = readZi(fonts.find((f) => readZi(f.blob).glyphs.length > 100).blob);
  const small = writeZi(subsetZi(full, full.glyphs.slice(0, 6).map((g) => g.code)));
  assert.equal(small[0x05], 2, "a subset must say it is one");
  assert.equal(readZi(small).charsetMode, 2);
  // a font that keeps every glyph is not a subset, and keeps what it had
  const whole = writeZi(readZi(fonts[0].blob));
  assert.equal(whole[0x05], fonts[0].blob[0x05]);
});

test("the writer never leaves the align8 flag set, because it writes plain offsets", { skip }, () => {
  // A font over 16 MB stores offsets divided by 8 and sets +0x21. We always
  // write them unscaled, so leaving the flag on produced a file this module's
  // own reader threw on -- which is exactly the shape that appears when an
  // align8 font is SUBSET below 16 MB.
  const font = readZi(fonts[0].blob);
  const forged = { ...font, align8: true };
  const bytes = writeZi(forged);
  assert.equal(bytes[0x21], 0);
  assert.doesNotThrow(() => readZi(bytes));
  assert.equal(readZi(bytes).glyphs.length, font.glyphs.length);
});

test("a truncated or over-running stream is caught when the caller says what it expects", { skip }, () => {
  const font = readZi(fonts[0].blob);
  const g = font.glyphs.find((x) => x.data.length > 12);
  const want = ziBitmapWidth(g) * font.height;
  assert.equal(decodeZiGlyph(g.data, want).length, want);
  // the stream carries no length of its own, so without `expected` neither of
  // these can be noticed
  assert.throws(() => decodeZiGlyph(g.data.subarray(0, g.data.length - 3), want), /decodes to \d+ pixels, expected/);
  const longer = new Uint8Array(g.data.length + 1);
  longer.set(g.data);
  longer[g.data.length] = 0x2f; // 15 more opaque pixels
  assert.throws(() => decodeZiGlyph(longer, want), /decodes to \d+ pixels, expected/);
});

test("fonts that disagree about height, encoding or version are refused", { skip }, () => {
  const a = readZi(fonts[0].blob);
  assert.throws(() => mergeZi([a, { ...a, height: a.height + 1 }]), /height/);
  assert.throws(() => mergeZi([a, { ...a, encoding: "utf-8x" }]), /encoding/);
  assert.throws(() => mergeZi([a, { ...a, version: a.version + 1 }]), /version/);
  assert.throws(() => mergeZi([a, { ...a, codePage: 0x99 }]), /code page/);
  assert.throws(() => mergeZi([a, { ...a, antiAlias: !a.antiAlias }]), /anti-alias/);
  // the width model is as much a property of the whole font as the height is:
  // the merged font keeps the first header, so a monospace font merged into a
  // variable one would declare a fixed cell while carrying every advance
  const mono = { ...a, header: Uint8Array.from(a.header) };
  mono.header[0x06] = 12;
  mono.header[0x1f] = 0;
  assert.throws(() => mergeZi([a, mono]), /width model|variable-width/);
  assert.throws(() => mergeZi([]), /nothing to merge/);
});
