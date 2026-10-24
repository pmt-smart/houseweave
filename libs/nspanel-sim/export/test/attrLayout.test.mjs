// The RAM-slice attribute table and the checker built on it.
// The table is measured data; these tests keep it internally consistent and
// exercise the checker and the image locator on synthetic bytes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RAM_SLICE_ATTRS, LAYOUT_CHANGERS, checkSliceAttrs } from "../dist/index.js";

test("no two fields of one type overlap, and every width is 1, 2 or 4", () => {
  for (const [lei, layout] of Object.entries(RAM_SLICE_ATTRS)) {
    const fields = Object.entries(layout).filter(([, f]) => f.kind === "uint").sort((a, b) => a[1].offset - b[1].offset);
    for (let i = 0; i < fields.length; i++) {
      const [name, f] = fields[i];
      assert.ok([1, 2, 4].includes(f.width), `${lei}.${name} width ${f.width}`);
      if (i + 1 < fields.length) {
        const [next, g] = fields[i + 1];
        assert.ok(f.offset + f.width <= g.offset, `${lei}: ${name} (+${f.offset}, ${f.width}) overlaps ${next} (+${g.offset})`);
      }
    }
  }
});

test("the sixteen measured types are present, with the Text txt at slice+9", () => {
  for (const lei of [116, 54, 59, 98, 53, 56, 57, 0, 55, 106, 58, 1, 51, 52, 122, 113]) assert.ok(lei in RAM_SLICE_ATTRS, `type ${lei}`);
  assert.deepEqual(RAM_SLICE_ATTRS[116].txt, { offset: 9, width: 0, kind: "text" });
  assert.deepEqual(LAYOUT_CHANGERS[0], ["ch", "sta"]);
});

test("checker reads little-endian fields and NUL-terminated text in the slice", () => {
  const slice = 0x40;
  const f = new Uint8Array(slice + 0x40);
  // Text: pco = 0xf800 at +2, bco = 0x07e0 at +4, txt "hey" at +9
  f.set([0x00, 0xf8], slice + 2);
  f.set([0xe0, 0x07], slice + 4);
  f.set(new TextEncoder().encode("hey"), slice + 9);
  const ok = checkSliceAttrs(f, slice, 116, { pco: 63488, bco: 2016, txt: "hey", txt_maxl: 10 });
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.checked.sort(), ["bco", "pco", "txt"]);
  const bad = checkSliceAttrs(f, slice, 116, { pco: 1, txt: "olaf", txt_maxl: 10 });
  assert.equal(bad.problems.length, 2, bad.problems.join("; "));
  assert.match(bad.problems[0], /pco 63488 != 1/);
});

test("a layout-changing attribute off its template value skips the component", () => {
  const f = new Uint8Array(0x80);
  const r = checkSliceAttrs(f, 0, 0, { ch: 2, bco: 0 }, { ch: 1 });
  assert.equal(r.checked.length, 0);
  assert.match(r.skipped, /ch differs/);
  const s = checkSliceAttrs(f, 0, 0, { ch: 1, bco: 0 }, { ch: 1 });
  assert.deepEqual(s.checked.sort(), ["bco", "ch"]);
});
