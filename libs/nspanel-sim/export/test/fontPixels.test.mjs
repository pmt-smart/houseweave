// What the pixel-COUNT ruler cannot see.
//
// `font.test.mjs` proves that every glyph decodes to exactly the right NUMBER of
// pixels, and that encoding and decoding agree with each other. Both are blind
// to the pixel VALUES: a decoder that inverts the anti-aliased alpha scale, or
// that swaps the two pixels of the `11 ccc ddd` form, produces the same counts
// and round-trips against its own encoder just as happily. It would draw 98% of
// the corpus wrong and every one of those tests would still pass.
//
// So this file asserts values, against fonts the Nextion Editor's own Font
// Creator produced from characters whose SHAPE IS KNOWN (fixtures/fonts/). That
// is the only external evidence in the project for what a glyph's pixels mean.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readZi, ziGlyphMap, ziBitmapWidth, decodeZiGlyph, ZI_MODE_BW, ZI_MODE_AA, ZI_ALPHA_MAX } from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fontPath = (name) => join(root, "fixtures", "fonts", name);
const load = (name) => readZi(new Uint8Array(readFileSync(fontPath(name))));
const skip = !existsSync(fontPath("wd16bw.zi")) && "control fonts missing";

/** The glyph as a grid of alpha values, one row per array entry. */
function bitmap(font, code) {
  const g = ziGlyphMap(font).get(code);
  assert.ok(g, `U+${code.toString(16)} missing`);
  const w = ziBitmapWidth(g);
  const px = decodeZiGlyph(g.data);
  assert.equal(px.length, w * font.height);
  const rows = [];
  for (let y = 0; y < font.height; y++) rows.push([...px.slice(y * w, (y + 1) * w)]);
  return { rows, w, h: font.height, mode: g.data[0] };
}

test("the Wingdings square decodes to the exact rectangle it is", { skip }, () => {
  // Wingdings 'n' is a filled square. At 16 px with anti-aliasing off it comes
  // out 9 wide and 8 tall, starting at x=1, y=3, inside an 11x16 cell. Every
  // pixel is asserted: this is what pins clear vs opaque and the packed
  // `11 www bbb` form, and it is checkable by anyone who can read a rectangle.
  const { rows, w, h, mode } = bitmap(load("wd16bw.zi"), 0x6e);
  assert.equal(mode, ZI_MODE_BW);
  assert.equal(w, 11);
  assert.equal(h, 16);
  const expected = [];
  for (let y = 0; y < 16; y++) {
    const row = new Array(11).fill(0);
    if (y >= 3 && y <= 10) for (let x = 1; x <= 9; x++) row[x] = ZI_ALPHA_MAX;
    expected.push(row);
  }
  assert.deepEqual(rows, expected);
});

test("a shape with no soft edge stays black and white even with anti-aliasing on", { skip }, () => {
  // Same square, generated with the anti-alias box ticked. The mode byte is a
  // property of the GLYPH, so the font-level flag at +0x1e cannot be used to
  // pick a decoder.
  const aa = load("wd16aa.zi");
  assert.equal(aa.antiAlias, true);
  const { rows, mode } = bitmap(aa, 0x6e);
  assert.equal(mode, ZI_MODE_BW, "a rectangle has no partial alpha, so it is stored black and white");
  for (const row of rows) for (const a of row) assert.ok(a === 0 || a === ZI_ALPHA_MAX);
});

test("the anti-aliased 'o' is left-right symmetric, which is what pins the pair order", { skip }, () => {
  // `11 ccc ddd` carries two pixels. Swapping them keeps every length identical,
  // so the count ruler and the round-trip tests cannot tell the difference --
  // but the letter 'o' is symmetric by construction, and swapping shifts every
  // pair by one column and visibly ruins that. Measured: 115 under the model we
  // use, 319 swapped.
  const font = load("ar48aa.zi");
  const { rows, w, h, mode } = bitmap(font, 0x6f);
  assert.equal(mode, ZI_MODE_AA);
  let asymmetry = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < Math.floor(w / 2); x++)
      asymmetry += Math.abs(rows[y][x] - rows[y][w - 1 - x]);
  assert.ok(asymmetry < 200, `left-right asymmetry ${asymmetry}; swapping the pair measures 319`);
});

test("the anti-aliased ramp runs towards the ink, which is what pins the alpha direction", { skip }, () => {
  // Inverting the alpha scale (ccc -> 7-ccc) also keeps every length identical.
  // What it cannot keep is the meaning of an edge: a partial pixel sits between
  // ink and background, so its alpha must track its neighbourhood. Measured:
  // r = +0.83 under the model we use, r = -0.12 inverted.
  const font = load("ar48aa.zi");
  const { rows, w, h } = bitmap(font, 0x6f);
  let n = 0, sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const a = rows[y][x];
      if (a === 0 || a === ZI_ALPHA_MAX) continue;
      const around = (rows[y - 1][x] + rows[y + 1][x] + rows[y][x - 1] + rows[y][x + 1]) / 4;
      n++; sx += a; sy += around; sxy += a * around; sxx += a * a; syy += around * around;
    }
  assert.ok(n > 40, `only ${n} edge pixels to judge by`);
  const r = (n * sxy - sx * sy) / Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  assert.ok(r > 0.6, `edge correlation ${r.toFixed(3)}; inverting the scale measures -0.12`);
});

test("the 'o' is a ring: ink on the sides, background through the middle", { skip }, () => {
  // A shape check nobody can misread. The middle row of an 'o' must be
  // background in the centre and ink towards both edges -- the property that
  // dies first if the pixels come out in the wrong order.
  const font = load("ar48aa.zi");
  const { rows, w, h } = bitmap(font, 0x6f);
  const middle = rows[Math.floor(h / 2)];
  const centre = middle[Math.floor(w / 2)];
  assert.equal(centre, 0, "the hole of the 'o' must be empty");
  assert.ok(middle.slice(0, Math.floor(w / 2)).some((a) => a === ZI_ALPHA_MAX), "left stroke missing");
  assert.ok(middle.slice(Math.floor(w / 2)).some((a) => a === ZI_ALPHA_MAX), "right stroke missing");
  // and the top and bottom rows of the cell are empty, as any glyph's are
  assert.ok(rows[0].every((a) => a === 0));
  assert.ok(rows[h - 1].every((a) => a === 0));
});

test("at 16 px the Editor's anti-aliasing does not even engage", { skip }, () => {
  // Both 16 px 'o's come out black and white, which is why the 48 px pair had to
  // be generated at all -- and why the alpha model rests on exactly one glyph.
  for (const name of ["ar16bw.zi", "ar16aa.zi"]) {
    const { mode } = bitmap(load(name), 0x6f);
    assert.equal(mode, ZI_MODE_BW, name);
  }
  const big = bitmap(load("ar48aa.zi"), 0x6f);
  const partial = big.rows.flat().filter((a) => a !== 0 && a !== ZI_ALPHA_MAX).length;
  assert.equal(partial, 78, "the only partial alphas in the whole control set");
});
