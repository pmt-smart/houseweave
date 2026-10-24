// Help's body is written as paragraphs and broken into lines at the width of
// the layout it lands in: `wrapZiText`, which the generator breaks the glass's
// lines with and the simulator calls for the browser. Lines cut by hand for the
// 290 px portrait panel would stop at two thirds of the 420 px landscape one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIT_FIRST, readZi, wrapZiText, ziAdvanceTable } from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fonts = join(root, "..", "themes", "lovelace-jobr99", "fonts");
const body = ziAdvanceTable(readZi(new Uint8Array(readFileSync(join(fonts, "noto-sans-24.zi")))));
const width = (s) => [...s].reduce((w, ch) => {
  const cp = ch.codePointAt(0);
  return w + (cp === 0x22 || cp < FIT_FIRST || cp > 0xff ? 0 : body[cp - FIT_FIRST]);
}, 0);

const LIVE = ["Changes the light while dragging the slider, not only on release.", "", "Off saves serial traffic."];

test("the same body breaks where each layout's width ends", () => {
  // Help's line on the EU landscape panel (420 px) and on the US portrait (290 px)
  assert.deepEqual(wrapZiText(body, LIVE, 420), [
    "Changes the light while dragging the slider, not",
    "only on release.",
    "",
    "Off saves serial traffic.",
  ]);
  assert.deepEqual(wrapZiText(body, LIVE, 290), [
    "Changes the light while dragging",
    "the slider, not only on release.",
    "",
    "Off saves serial traffic.",
  ]);
});

test("every line fits, and none could have taken the next word", () => {
  const paragraphs = [
    "Renaming opens a 12-key pad instead of QWERTY.",
    "Faster with gloves on, slower past a few letters.",
    "A placeholder, to prove Settings pages to a second page.",
    "The living room lamp with a shade, and the reading lamp beside the café table",
  ];
  for (const w of [120, 200, 290, 420]) {
    for (const p of paragraphs) {
      const lines = wrapZiText(body, [p], w);
      assert.equal(lines.join(" "), p, `the words of ${JSON.stringify(p)} came back changed at ${w} px`);
      lines.forEach((line, i) => {
        assert.ok(width(line) <= w, `${JSON.stringify(line)} is ${width(line)} px in ${w}`);
        const next = lines[i + 1]?.split(" ")[0];
        if (next !== undefined) assert.ok(width(`${line} ${next}`) > w, `${JSON.stringify(next)} would still fit after ${JSON.stringify(line)} at ${w} px`);
      });
    }
  }
});

test("a line that already fits is a paragraph that stays one line", () => {
  // so lines cut by hand for 290 px read the same
  const old = ["Changes the light while", "dragging the slider, not", "only on release.", "", "Off saves serial traffic."];
  assert.deepEqual(wrapZiText(body, old, 290), old);
});

test("a blank paragraph is a blank line, and spaces do not pile up", () => {
  assert.deepEqual(wrapZiText(body, ["", "a  b ", ""], 420), ["", "a b", ""]);
  assert.deepEqual(wrapZiText(body, [], 420), []);
});

test("a word wider than a whole line is split where it stops fitting", () => {
  const word = "Wohnzimmerdeckenbeleuchtung";
  const lines = wrapZiText(body, [`Die ${word} an`], 120);
  assert.equal(lines.join("").replace(/ /g, ""), `Die${word}an`);
  for (const line of lines) assert.ok(width(line) <= 120, `${JSON.stringify(line)} is ${width(line)} px`);
  // and a box narrower than one letter still ends, a letter per line
  assert.deepEqual(wrapZiText(body, ["WW"], 1), ["W", "W"]);
});
