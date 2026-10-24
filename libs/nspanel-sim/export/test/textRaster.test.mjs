// The text rasterizer: where glyphs land on a line.
//
// Two kinds of test here. The synthetic ones build a font whose metrics are
// chosen, so the arithmetic of pen, kerning and spacing is pinned exactly and
// runs without the fixture cache. The corpus ones render real strings from
// `liber` and demand that the result actually look like text -- separated
// letters, ink where letters are and none between them -- because a layout that
// stacks every glyph at x=0 would pass every arithmetic test ever written.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readHmiDirectory, hmiLiveEntries, hmiBlob, readZi, encodeZiGlyph, decodeZiGlyph,
  layoutZiText, rasterizeZiText, rasterizeZiGlyph, ziEncodeText, ziRasterToAscii, ziAlphaTo255,
  placeZiText, rasterizeZiTextInBox,
} from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** A font whose glyph metrics we choose, so the layout arithmetic is exact. */
function syntheticFont(height, specs) {
  const base = readZi(new Uint8Array(readFileSync(join(root, "fixtures", "fonts", "ar16bw.zi"))));
  const glyphs = specs.map(({ code, advance, kerningLeft = 0, kerningRight = 0, fill = 7 }) => {
    const width = advance + kerningLeft + kerningRight;
    const pixels = new Uint8Array(width * height).fill(fill);
    return { code, advance, kerningLeft, kerningRight, data: encodeZiGlyph(pixels), gapBefore: new Uint8Array(0) };
  });
  return { ...base, height, codePage: 0x03, glyphs };
}

test("the pen advances by the advance, and a kerned glyph hangs left of it", () => {
  // A: 10 wide, no kerning. B: advance 6 but 8 pixels of bitmap, one hanging
  // off each side -- the shape of `liber`'s j.
  const font = syntheticFont(4, [
    { code: 0x41, advance: 10 },
    { code: 0x42, advance: 6, kerningLeft: 1, kerningRight: 1 },
  ]);
  const layout = layoutZiText(font, "AB");
  assert.equal(layout.advanceModel, "bearing");
  assert.deepEqual(layout.placements.map((p) => p.pen), [0, 10]);
  assert.deepEqual(layout.placements.map((p) => p.x), [0, 9]);
  assert.deepEqual(layout.placements.map((p) => p.width), [10, 8]);
  assert.equal(layout.advance, 16);
  assert.equal(layout.left, 0);
  assert.equal(layout.right, 17); // B's bitmap ends one past its cell
});

test("the other model lays the bitmaps edge to edge, and says so", () => {
  const font = syntheticFont(4, [
    { code: 0x41, advance: 10 },
    { code: 0x42, advance: 6, kerningLeft: 1, kerningRight: 1 },
  ]);
  const layout = layoutZiText(font, "AB", { advanceModel: "bitmap" });
  assert.equal(layout.advanceModel, "bitmap");
  assert.deepEqual(layout.placements.map((p) => p.x), [0, 10]);
  assert.equal(layout.advance, 18);
  assert.equal(layout.left, 0);
  assert.equal(layout.right, 18);
  // and the two models differ by exactly the kerning they do or do not absorb
  const bearing = layoutZiText(font, "AB");
  assert.equal(layout.advance - bearing.advance, 2);
});

test("the first glyph of a run can start left of the origin", () => {
  const font = syntheticFont(4, [{ code: 0x42, advance: 6, kerningLeft: 2 }]);
  const layout = layoutZiText(font, "B");
  assert.equal(layout.left, -2);
  const raster = rasterizeZiText(font, "B");
  assert.equal(raster.originX, 2);
  assert.equal(raster.width, 8);
});

test("spacing goes between glyphs and not after the last one", () => {
  const font = syntheticFont(4, [{ code: 0x41, advance: 10 }]);
  assert.equal(layoutZiText(font, "AAA").advance, 30);
  assert.equal(layoutZiText(font, "AAA", { spacing: 3 }).advance, 36);
  assert.equal(layoutZiText(font, "A", { spacing: 3 }).advance, 10);
  assert.equal(layoutZiText(font, "", { spacing: 3 }).advance, 0);
});

test("where two bitmaps overlap the stronger alpha wins, so ink is never erased", () => {
  // B hangs one pixel into A's cell. A is solid; if the overlap were a plain
  // copy, B's column would overwrite A's ink with B's -- here both are 7, so
  // make B faint and check the overlap keeps the strong one.
  const font = syntheticFont(2, [
    { code: 0x41, advance: 4 },
    { code: 0x42, advance: 4, kerningLeft: 1, fill: 2 },
  ]);
  const raster = rasterizeZiText(font, "AB");
  assert.equal(raster.width, 8);
  // column 3 is A's last, and also B's first (B starts at x=3)
  assert.equal(raster.alpha[3], 7);
  assert.equal(raster.alpha[4], 2);
});

test("a codepoint the font lacks is reported, and the fallback is drawn in its place", () => {
  const font = syntheticFont(2, [{ code: 0x41, advance: 4 }, { code: 0x3f, advance: 6 }]);
  const bare = layoutZiText(font, "AZA");
  assert.deepEqual(bare.missing, [0x5a]);
  assert.equal(bare.advance, 8); // the missing one takes no room at all
  assert.equal(bare.placements[1].glyph, undefined);

  const fell = layoutZiText(font, "AZA", { fallback: 0x3f });
  assert.deepEqual(fell.missing, [0x5a]);
  assert.equal(fell.advance, 14);
  assert.equal(fell.placements[1].glyph.code, 0x3f);
});

test("text that cannot be encoded in the font's code page stops the build", () => {
  const latin = syntheticFont(2, [{ code: 0x41, advance: 4 }]);
  assert.deepEqual(ziEncodeText(latin, "Aç"), [0x41, 0xe7]);
  assert.throws(() => ziEncodeText(latin, "—"), /ISO-8859-1/);
  const utf8 = { ...latin, codePage: 0x18 };
  assert.deepEqual(ziEncodeText(utf8, ""), [0xe334]); // the panel's icons
  assert.throws(() => ziEncodeText(utf8, "\u{1f600}"), /outside the BMP/);
});

test("alpha reaches 255 the way the font editor scales it", () => {
  assert.equal(ziAlphaTo255(0), 0);
  assert.equal(ziAlphaTo255(7), 255);
  assert.equal(ziAlphaTo255(4), 146);
});

// ---------------------------------------------------------------------------
// Against the corpus: it has to look like text, not just add up

const cachedBase = join(root, "fixtures", "cache", "eseverson-hmi", "00_baseline_base.HMI");

function liber24() {
  if (!existsSync(cachedBase)) return undefined;
  const bytes = new Uint8Array(readFileSync(cachedBase));
  for (const [name, entry] of hmiLiveEntries(readHmiDirectory(bytes))) {
    if (!name.endsWith(".zi")) continue;
    const font = readZi(hmiBlob(bytes, entry));
    if (font.name === "liber" && font.height === 24) return font;
  }
  return undefined;
}

const liber = liber24();
const skip = liber === undefined && "fixtures not fetched";

test("one glyph rasterized alone is exactly the glyph's own bitmap", { skip }, () => {
  for (const code of [0x48, 0x6f, 0x30, 0x40]) {
    const glyph = liber.glyphs.find((g) => g.code === code);
    const width = glyph.advance + glyph.kerningLeft + glyph.kerningRight;
    const raster = rasterizeZiGlyph(liber, code);
    assert.equal(raster.width, width);
    assert.equal(raster.height, liber.height);
    assert.deepEqual([...raster.alpha], [...decodeZiGlyph(glyph.data, width * liber.height)]);
  }
});

test("a rendered word has one ink island per letter, with clear gaps between", { skip }, () => {
  // The test a layout that stacks everything at x=0 fails, and an off-by-one in
  // the pen does not: count the runs of inked columns in "III".
  const raster = rasterizeZiText(liber, "III");
  const inked = [];
  for (let x = 0; x < raster.width; x++) {
    let sum = 0;
    for (let y = 0; y < raster.height; y++) sum += raster.alpha[y * raster.width + x];
    inked.push(sum > 0);
  }
  let islands = 0;
  for (let x = 0; x < inked.length; x++) if (inked[x] && !inked[x - 1]) islands++;
  assert.equal(islands, 3, `expected three separated letters, got ${islands}:\n${ziRasterToAscii(raster)}`);

  // and the three are the same shape, shifted by one advance each
  const w = liber.glyphs.find((g) => g.code === 0x49).advance;
  assert.equal(raster.layout.advance, 3 * w);
  const col = (r, x) => Array.from({ length: r.height }, (_, y) => r.alpha[y * r.width + x]);
  for (let x = 0; x < w; x++) {
    assert.deepEqual(col(raster, x), col(raster, x + w));
    assert.deepEqual(col(raster, x), col(raster, x + 2 * w));
  }
});

test("the run is as wide as the sum of the advances, plus whatever hangs off the ends", { skip }, () => {
  const text = "Living room jazz_";
  const layout = layoutZiText(liber, text);
  let sum = 0;
  for (const ch of text) sum += liber.glyphs.find((g) => g.code === ch.codePointAt(0)).advance;
  assert.equal(layout.advance, sum);
  assert.ok(layout.left <= 0, `first glyph should not start right of the origin, got ${layout.left}`);
  assert.ok(layout.right >= layout.advance - 1);
});

test("the j is the glyph that tells the two advance models apart", { skip }, () => {
  // Ten j's: the pen model gives ten advances, the bitmap model ten bitmaps,
  // and the difference is exactly ten kerning columns. This is the measurement
  // the Editor's debugger has to settle (see textRaster.ts, and the d1-08
  // scenario); the test is here so that the day it IS settled, the number the
  // scenario reads off a screenshot has something to be compared against.
  const j = liber.glyphs.find((g) => g.code === 0x6a);
  assert.equal(j.kerningLeft, 1);
  const bearing = layoutZiText(liber, "jjjjjjjjjj");
  const bitmap = layoutZiText(liber, "jjjjjjjjjj", { advanceModel: "bitmap" });
  assert.equal(bearing.advance, 10 * j.advance);
  assert.equal(bitmap.advance, 10 * (j.advance + j.kerningLeft + j.kerningRight));
  assert.equal(bitmap.advance - bearing.advance, 10);
  // ...and the shapes really do differ on screen, not just in the totals
  assert.notDeepEqual([...rasterizeZiText(liber, "jjjjjjjjjj").alpha], [...rasterizeZiText(liber, "jjjjjjjjjj", { advanceModel: "bitmap" }).alpha]);
});

test("every printable character of the font renders without throwing", { skip }, () => {
  // decodeZiGlyph is called with an expected pixel count, so a glyph whose
  // stream disagrees with its metrics would throw here rather than draw a
  // skewed letter -- which is the whole point of passing the count.
  let drawn = 0;
  for (const g of liber.glyphs) {
    if (g.code < 0x20) continue;
    const raster = rasterizeZiGlyph(liber, g.code);
    assert.equal(raster.alpha.length, raster.width * raster.height);
    drawn++;
  }
  assert.ok(drawn > 200, `only ${drawn} glyphs drawn`);
});

// ---------------------------------------------------------------------------
// The box rules, as the Editor's debugger drew them. Every number below is a
// prediction that won at dx=0, dy=0 against a screenshot -- d1-08 for the
// advance model, d1-09 for centring and spax, d1-10 for the far edges, the odd
// remainder and the overflow. `scripts/compare-debugger.mjs` is the harness.

test("xcen puts the pen where the debugger put it, and the width that counts is the advance", { skip }, () => {
  const box = { x: 20, y: 10, w: 440, h: 30 };
  // 72 is the advance of both strings; their bitmaps differ by ten pixels
  for (const text of ["|iiiiiiiiii|", "|jjjjjjjjjj|"]) {
    assert.equal(layoutZiText(liber, text).advance, 72);
    assert.equal(placeZiText(liber, text, box, { xcen: 0 }).penX, 20);
    assert.equal(placeZiText(liber, text, box, { xcen: 1 }).penX, 204); // d1-09 cenA/cenB
    assert.equal(placeZiText(liber, text, box, { xcen: 2 }).penX, 388); // d1-10 rgt
  }
  // the half pixel of an odd remainder is floored, not rounded (d1-10 odd)
  assert.equal(placeZiText(liber, "|iiiiiiiiii|", { ...box, w: 441 }, { xcen: 1 }).penX, 204);
});

test("ycen mirrors it over the font's height, not the ink's", { skip }, () => {
  const text = "Hamburgefonstiv 0123";
  assert.equal(placeZiText(liber, text, { x: 20, y: 130, w: 440, h: 30 }, { ycen: 0 }).topY, 130); // d1-08 prose
  assert.equal(placeZiText(liber, text, { x: 20, y: 200, w: 440, h: 60 }, { ycen: 1 }).topY, 218); // d1-09 vcen
  assert.equal(placeZiText(liber, text, { x: 20, y: 200, w: 440, h: 60 }, { ycen: 2 }).topY, 236); // d1-10 bot
});

test("spax goes between the glyphs and nowhere else", { skip }, () => {
  // d1-09 sp0/sp5: the four stems of "iiii" measured 6 pixels apart with spax
  // 0 and 11 with spax 5, and the first stem stayed at the component's x.
  const box = { x: 240, y: 90, w: 200, h: 30 };
  const pens = (spax) => placeZiText(liber, "iiii", box, { spax }).layout.placements.map((p) => p.pen);
  assert.deepEqual(pens(0), [0, 6, 12, 18]);
  assert.deepEqual(pens(5), [0, 11, 22, 33]);
  assert.equal(placeZiText(liber, "iiii", box, { spax: 5 }).penX, 240);
});

test("a run too wide for its box is clipped at the box, not wrapped or shrunk", { skip }, () => {
  // d1-10 ovf: 234 pixels of text in a 100-pixel box, starting at the box's x,
  // and the last lit column on the glass was x + w - 1, in the middle of a letter.
  const box = { x: 20, y: 90, w: 100, h: 30 };
  const placement = placeZiText(liber, "Hamburgefonstiv 0123", box);
  assert.equal(placement.penX, 20);
  assert.equal(placement.clipped, true);
  assert.equal(placement.clipRight, 119);

  const { alpha } = rasterizeZiTextInBox(liber, "Hamburgefonstiv 0123", box);
  assert.equal(alpha.length, box.w * box.h);
  let last = -1;
  for (let x = 0; x < box.w; x++)
    for (let y = 0; y < box.h; y++) if (alpha[y * box.w + x] > 0) { last = x; break; }
  assert.equal(last, box.w - 1, "the ink should run right up to the box's last column");
  // and a run that fits is not marked clipped
  assert.equal(placeZiText(liber, "Ham", box).clipped, false);
});

test("in liber the two compositing rules are indistinguishable, on every string it can write", { skip }, () => {
  // Worth a test rather than a comment: it is why the compositing needed a
  // second font to measure (d1-11, noto-sans-32-sp5). All five kerned glyphs of
  // liber have a left kerning and no right one, so an overlap always falls on a
  // blank column of the glyph underneath, and the two rules agree everywhere.
  assert.ok(liber.glyphs.filter((g) => g.kerningRight > 0).length === 0);
  for (const text of ["¯_¯_¯_¯_", "jjjjjjjjjj", "Living room jazz_", "Hamburgefonstiv 0123"]) {
    const max = rasterizeZiText(liber, text);
    const over = rasterizeZiText(liber, text, { composite: "overwrite" });
    assert.deepEqual([...max.alpha], [...over.alpha], text);
  }
});
