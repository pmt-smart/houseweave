// A differential test against FOREIGN code.
//
// The adversarial round showed that the pixel-count ruler is blind to pixel
// values, and that almost every codec test was our encoder talking to our
// decoder. `fontPixels.test.mjs` answers that with control glyphs whose shape is
// known. This file answers it a second way, which is stronger still: an
// INDEPENDENT implementation of the same format, written by someone else, with
// no knowledge of this project.
//
// `hagronnestad/nextion-font-editor` (C#, `ZiLib/FileVersion/V5/ZiCharacterV5.cs`,
// method `Decode`) draws glyphs in a font editor. The function below is a literal
// translation of it — deliberately shaped like the C#, not like our own decoder,
// so that a shared mistake is less likely than an independent agreement.
//
// It agrees with ours on all seven drawing modes, on the order of the two pixels
// in the `11 ccc ddd` form, on the direction of the alpha ramp (their
// `(255/7) * alpha`), on the bitmap being `Width + KerningLeft + KerningRight`
// wide (their `TotalWidth`), and on the pixels going out row by row (their
// `NumberToPoint`: `Y = floor(n / width)`, `X = n % width`).
//
// That is what makes the alpha model external evidence rather than our own word.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readHmiDirectory, hmiLiveEntries, hmiBlob, readZi, decodeZiGlyph, encodeZiGlyph, ziBitmapWidth } from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cache = join(root, "fixtures", "cache");

/**
 * ZiCharacterV5.Decode, translated line for line. Returns one alpha 0..7 per
 * pixel, in the order it assigns pixel numbers. `totalWidth * height` bounds it,
 * the way their SetPixelNumber drops anything past the end of the bitmap.
 */
function foreignDecode(charData, totalWidth, height) {
  const out = [];
  const limit = totalWidth * height;
  const put = (alpha) => { if (out.length < limit) out.push(alpha); };
  if (charData.length === 0) return out;
  const bitdepth = charData[0];

  for (let i = 1; i < charData.length; i++) {
    const item = charData[i];
    const drawingMode = item >> 6;
    const drawingMode2 = (item & 0b00100000) >> 5;
    let number = item & 0b00011111;

    if (drawingMode === 0) {
      if (drawingMode2 === 0) for (let p = 0; p < number; p++) put(0);
      if (drawingMode2 === 1) for (let p = 0; p < number; p++) put(7);
    }

    if (drawingMode === 1) {
      for (let p = 0; p < number; p++) put(0);
      put(7);
      if (drawingMode2 === 1) put(7);
    }

    if (drawingMode === 2) {
      if (bitdepth === 1) {
        for (let p = 0; p < number; p++) put(0);
        put(7);
        put(7);
        put(7);
        if (drawingMode2 === 1) put(7);
      } else {
        number = (item & 0b00111000) >> 3;
        const alpha = item & 0b00000111;
        for (let p = 0; p < number; p++) put(0);
        put(alpha);
      }
    }

    if (drawingMode === 3) {
      if (bitdepth === 1) {
        const whites = (item & 0b00111000) >> 3;
        const blacks = item & 0b00000111;
        for (let p = 0; p < whites; p++) put(0);
        for (let p = 0; p < blacks; p++) put(7);
      } else {
        const alpha1 = (item & 0b00111000) >> 3;
        const alpha2 = item & 0b00000111;
        put(alpha1);
        put(alpha2);
      }
    }
  }
  return out;
}

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

test("our decoder agrees pixel for pixel with the C# font editor's, on every glyph", { skip }, () => {
  let glyphs = 0, pixels = 0, aaGlyphs = 0, partials = 0;
  const disagreements = [];
  for (const { where, blob } of fonts) {
    const font = readZi(blob);
    for (const g of font.glyphs) {
      if (g.data.length === 0) continue;
      glyphs++;
      const width = ziBitmapWidth(g);
      const ours = decodeZiGlyph(g.data);
      const theirs = foreignDecode(g.data, width, font.height);
      pixels += ours.length;
      if (g.data[0] === 0x03) {
        aaGlyphs++;
        partials += [...ours].filter((a) => a !== 0 && a !== 7).length;
      }
      if (ours.length !== theirs.length || !theirs.every((v, i) => v === ours[i])) {
        if (disagreements.length < 5) {
          const at = theirs.findIndex((v, i) => v !== ours[i]);
          disagreements.push(`${where} U+${g.code.toString(16).toUpperCase().padStart(4, "0")}: ${ours.length} vs ${theirs.length} px, first difference at ${at}`);
        }
      }
    }
  }
  assert.deepEqual(disagreements, []);
  assert.equal(glyphs, 26508);
  // and the agreement has to actually cover the interesting part: a corpus of
  // black-and-white glyphs would prove nothing about the alpha model
  assert.ok(aaGlyphs > 20000, `only ${aaGlyphs} anti-aliased glyphs compared`);
  assert.ok(partials > 1000000, `only ${partials} partial-alpha pixels compared`);
  assert.ok(pixels > 30000000, `only ${pixels} pixels compared`);
});

test("what our ENCODER writes is read back correctly by the foreign decoder too", () => {
  // The other direction, and the one that matters for a font we generate: it is
  // no use decoding the Editor's bytes correctly if the bytes we write mean
  // something else to whoever reads them. Encode a bitmap here, hand the stream
  // to the C# translation, and demand the pixels back.
  let seed = 20260913;
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const shapes = [];

  // a filled rectangle inside a cell, like the Wingdings square
  {
    const w = 11, h = 16, px = new Uint8Array(w * h);
    for (let y = 3; y <= 10; y++) for (let x = 1; x <= 9; x++) px[y * w + x] = 7;
    shapes.push({ label: "rectangle", w, h, px });
  }
  // a soft disc, which forces the anti-aliased forms
  {
    const w = 18, h = 24, px = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const d = Math.hypot(x - 8.5, y - 11.5);
        px[y * w + x] = d <= 6.5 ? 7 : d >= 8.5 ? 0 : Math.round(((8.5 - d) / 2) * 7);
      }
    shapes.push({ label: "soft disc", w, h, px });
  }
  // and random bitmaps, because hand-picked shapes only exercise what we thought of
  for (let i = 0; i < 60; i++) {
    const w = 1 + Math.floor(next() * 24);
    const h = 1 + Math.floor(next() * 24);
    const px = new Uint8Array(w * h);
    for (let k = 0; k < px.length; k++) {
      const r = next();
      px[k] = r < 0.5 ? 0 : r < 0.8 ? 7 : 1 + Math.floor(next() * 6);
    }
    shapes.push({ label: `random ${i}`, w, h, px });
  }

  for (const { label, w, h, px } of shapes) {
    const stream = encodeZiGlyph(px);
    const theirs = foreignDecode(stream, w, h);
    assert.equal(theirs.length, px.length, `${label}: ${theirs.length} pixels back, ${px.length} in`);
    assert.deepEqual(theirs, [...px], label);
  }
});
