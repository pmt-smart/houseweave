// geometryPatch.ts against the real joBr99 file: the mechanism the panel
// confirmed. The SHA-256 anchors are the exact
// files that were flashed, so a refactor that changes a single byte of
// the output fails here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  pageRanges, pageOfRecord, findGeometryStrings, digitBudget, formatGeometry, findRecords,
  patchComponentGeometry, sealTailChecksum, preflightTft, onlyTailChanged, NSPANEL_EU_LANDSCAPE,
  header2Fields, objxinxiAddress, componentRecordOffset, readComponentRecord, KNOWN_LEI,
} from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const donorPath = join(root, "fixtures", "cache", "jobr99", "nspanel.tft");
const skip = !existsSync(donorPath) && "fixture not fetched";
const load = () => new Uint8Array(readFileSync(donorPath));
const sha = (u8) => createHash("sha256").update(u8).digest("hex");

// the screensaver date field, located by signature (see patch-step7-geometry.mjs)
const dateField = (file) => {
  const hits = findRecords(file, (r) => r.lei === KNOWN_LEI.Text && r.x === 0 && r.y === 165 && r.w === 450 && r.h === 32);
  assert.equal(hits.length, 1);
  return hits[0];
};

test("formatGeometry: zero-pads to the field budget and refuses overflow", () => {
  const budget = { x: 1, y: 3, w: 3, h: 2 };
  assert.equal(formatGeometry({ x: 0, y: 95, w: 450, h: 32 }, budget), "0,095,450,32,");
  assert.equal(formatGeometry({ x: 0, y: 10, w: 450, h: 32 }, budget), "0,010,450,32,");
  assert.throws(() => formatGeometry({ x: 12, y: 165, w: 450, h: 32 }, budget), RangeError);
  assert.throws(() => formatGeometry({ x: 0, y: 165, w: 450, h: 100 }, budget), RangeError);
});

test("pageRanges: 23 pages covering every non-Page record, bytecode ranges contiguous", { skip }, () => {
  const file = load();
  const h2 = header2Fields(file);
  const pages = pageRanges(file);
  assert.equal(pages.length, h2.pageqty);
  const covered = pages.reduce((n, p) => n + p.components.length, 0);
  assert.equal(covered, h2.objqty - h2.pageqty);
  for (let i = 0; i + 1 < pages.length; i++) assert.equal(pages[i].end, pages[i + 1].start);
  assert.equal(pages[pages.length - 1].end, objxinxiAddress(file));
  assert.equal(pageOfRecord(file, dateField(file)).page, 3);
});

test("findGeometryStrings: the date field has two ASCII copies with the known markers", { skip }, () => {
  const file = load();
  const hits = findGeometryStrings(file, dateField(file));
  assert.deepEqual(hits.map((h) => [h.offset, h.marker, h.text]), [
    [0x6d6f39, "09 1c 08", "0,165,450,32,"],
    [0x6d6fa6, "09 0d 04", "0,165,450,32,"],
  ]);
  assert.deepEqual(digitBudget(readComponentRecord(file, componentRecordOffset(objxinxiAddress(file), dateField(file)))), { x: 1, y: 3, w: 3, h: 2 });
});

test("patchComponentGeometry reproduces the 7b' file byte for byte (y 165 -> 140)", { skip }, () => {
  const file = load();
  const res = patchComponentGeometry(file, dateField(file), { x: 0, y: 140, w: 450, h: 32 });
  const sealed = sealTailChecksum(res.file);
  assert.equal(sha(sealed), "c73794345774de452b3f688048b5a81287c60abe0f4e8984e475bb4859c4194e");
  assert.equal(res.asciiCopies.length, 2);
  assert.ok(preflightTft(sealed, NSPANEL_EU_LANDSCAPE).ok);
  assert.ok(onlyTailChanged(file, sealed).ok);
  let changed = 0;
  const allowed = new Set([...res.touched, sealed.length - 1, sealed.length - 2, sealed.length - 3, sealed.length - 4]);
  for (let i = 0; i < file.length; i++) if (file[i] !== sealed[i]) { changed++; assert.ok(allowed.has(i), `stray byte at 0x${i.toString(16)}`); }
  assert.equal(changed, 10);
});

test("patchComponentGeometry reproduces the 7d zero-padded file (y 165 -> 95)", { skip }, () => {
  const file = load();
  const sealed = sealTailChecksum(patchComponentGeometry(file, dateField(file), { x: 0, y: 95, w: 450, h: 32 }).file);
  assert.equal(sha(sealed), "4da3c142fc7d6ad35ab42394cd0a6f91331daf5e3a44e418dee2b11ac85c5f68");
});

test("patchComponentGeometry refuses invisible records and overflowing targets", { skip }, () => {
  const file = load();
  const timer = findRecords(file, (r) => r.lei === KNOWN_LEI.Timer)[0];
  assert.throws(() => patchComponentGeometry(file, timer, { x: 0, y: 0, w: 1, h: 1 }), /no ASCII geometry copy/);
  assert.throws(() => patchComponentGeometry(file, dateField(file), { x: 10, y: 165, w: 450, h: 32 }), RangeError);
  const pageRecord = pageRanges(file)[0].pageRecord;
  assert.throws(() => patchComponentGeometry(file, pageRecord, { x: 0, y: 0, w: 480, h: 320 }), /is a Page/);
});

test("every visible component of the donor can be located and has a positive digit budget", { skip }, () => {
  const file = load();
  let visible = 0;
  for (const p of pageRanges(file)) {
    for (const i of p.components) {
      const r = readComponentRecord(file, componentRecordOffset(objxinxiAddress(file), i));
      if (r.w === 1 && r.h === 1) continue;
      visible++;
      assert.ok(findGeometryStrings(file, i).length >= 1, `record ${i} on page ${p.page}`);
    }
  }
  assert.equal(visible, 489);
});
