// A runtime text is written FITTED to its box: whole when it fits, and
// otherwise cut at a whole character with an ellipsis -- by the generated
// PanelRuntime on the panel, and by the simulator with the same `fitZiText`.
// The literals below are pinned in the Berry test of the
// generated runtime too (berry/test/test_panel_runtime.be), which is what
// keeps the two implementations of one rule from drifting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIT_ELLIPSIS, FIT_FIRST, fitZiText, readZi, ziAdvanceTable } from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fonts = join(root, "..", "themes", "lovelace-jobr99", "fonts");
const body = ziAdvanceTable(readZi(new Uint8Array(readFileSync(join(fonts, "noto-sans-24.zi")))));
const title = ziAdvanceTable(readZi(new Uint8Array(readFileSync(join(fonts, "noto-sans-32.zi")))));
const width = (table, s) => [...s].reduce((w, ch) => {
  const cp = ch.codePointAt(0);
  return w + (cp === 0x22 || cp < FIT_FIRST || cp > 0xff ? 0 : table[cp - FIT_FIRST]);
}, 0);

test("the same cuts the generated runtime makes", () => {
  // the EU home card (98 px, body) and the detail's title (420 px, title)
  assert.equal(fitZiText(body, "Living Room", 98, 19), "Living Roo..");
  assert.equal(fitZiText(title, "Living Room", 420, 64), "Living Room");
  assert.equal(fitZiText(body, "Ceiling", 98, 19), "Ceiling");
  assert.equal(fitZiText(body, "Living room lamp with a shade", 98, 19), "Living roo..");
  assert.equal(fitZiText(title, "Living room lamp with a shade", 420, 64), "Living room lamp with a shade");
  assert.equal(fitZiText(body, "Café terrace", 98, 19), "Café terra..");
});

test("a cut text fits, ends in the ellipsis, and could not keep one more character", () => {
  for (const [table, w] of [[body, 60], [body, 98], [body, 135], [title, 226], [title, 290]]) {
    for (const s of ["Living Room", "Kitchen counter lights", "Living room lamp with a shade", "MMMMMMMMMMMMMMMMMMMMMMMM"]) {
      const out = fitZiText(table, s, w);
      assert.ok(width(table, out) <= w, `${JSON.stringify(out)} is ${width(table, out)} px in ${w}`);
      if (out === s) continue;
      assert.ok(out.endsWith(FIT_ELLIPSIS), `${JSON.stringify(out)} was cut without an ellipsis`);
      const kept = out.slice(0, -FIT_ELLIPSIS.length);
      assert.ok(s.startsWith(kept), `${JSON.stringify(out)} is not the start of ${JSON.stringify(s)}`);
      const next = s.slice(0, [...kept].length + 1).trimEnd();
      if (next.length > kept.length) assert.ok(width(table, next + FIT_ELLIPSIS) > w, `${JSON.stringify(next + FIT_ELLIPSIS)} would still fit ${w}`);
    }
  }
});

test("the ellipsis never follows a space", () => {
  // a width that ends the room exactly after "Desk " -- the cut drops the space
  const w = width(body, "Desk ") + width(body, FIT_ELLIPSIS);
  assert.equal(fitZiText(body, "Desk lamp", w), "Desk..");
});

test("the buffer is respected in bytes, as the panel counts them", () => {
  const out = fitZiText(body, "Café terrace", 1000, 8);
  assert.ok(Buffer.byteLength(out, "utf8") <= 8, `${JSON.stringify(out)} is ${Buffer.byteLength(out, "utf8")} bytes`);
  assert.ok(out.endsWith(FIT_ELLIPSIS));
});

test("a double quote measures nothing, because the runtime drops it", () => {
  const w = width(body, "Say hi");
  assert.equal(fitZiText(body, 'Say "hi"', w), 'Say "hi"');
});

test("a box too narrow for the ellipsis keeps what fits of the text", () => {
  const w = width(body, FIT_ELLIPSIS) - 1;
  const out = fitZiText(body, "iiiiii", w);
  assert.ok(!out.endsWith(FIT_ELLIPSIS));
  assert.ok(width(body, out) <= w);
});

test("every runtime text target carries its own box's width and its own buffer", () => {
  // the runtime measures against what the manifest says; if that ever parted
  // from the compiled Text, the cut would be made for a box that is not there
  const dir = join(root, "hmi-scenarios");
  for (const f of readdirSync(dir).filter((f) => /^p1-.*\.runtime\.json$/.test(f))) {
    const rt = JSON.parse(readFileSync(join(dir, f), "utf8"));
    const doc = JSON.parse(readFileSync(join(dir, f.replace(".runtime.json", ".json")), "utf8"));
    const pages = [{ name: doc.edits["0.pa"].changes?.page0?.attributes?.objname ?? "page0", add: doc.edits["0.pa"].add }, ...doc.addPages];
    for (const b of rt.bindings.filter((b) => b.fit)) {
      const c = pages.find((p) => p.name === b.page)?.add.find((x) => x.objname === b.objname);
      assert.ok(c, `${f}: ${b.page}.${b.objname} is not on the page`);
      assert.equal(b.fit.width, c.w, `${f}: ${b.page}.${b.objname} is fitted to ${b.fit.width} px and is ${c.w}`);
      assert.equal(b.maxl, c.attributes.txt_maxl, `${f}: ${b.page}.${b.objname} buffer`);
    }
  }
});
