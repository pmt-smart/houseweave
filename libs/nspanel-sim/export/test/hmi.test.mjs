// hmi.ts against the Nextion Editor's own project files: the eight .HMI
// fixtures listed under manifest.hmi (eseverson/nextion-hmi, MIT), each
// paired with the .tft the Editor compiled from it. Every test skips, not
// fails, when a fixture is absent (`npm run fetch-fixtures`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readHmiDirectory, hmiLiveEntries, hmiBlob, readHmiMain, hmiPages, readHmiPage, hmiPageCrc,
  header1Fields, pageRanges,
} from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "fixtures", "manifest.json"), "utf8"));
const cachePath = (name) => join(root, "fixtures", "cache", name);
const load = (name) => new Uint8Array(readFileSync(cachePath(name)));
const NSPANEL_SEED = 0x1ce47603;

for (const entry of manifest.hmi ?? []) {
  const skip = !existsSync(cachePath(entry.name)) && "fixture not fetched";

  test(`${entry.name}: directory checksum, mirror, sentinel and magic verify`, { skip }, () => {
    const file = load(entry.name);
    assert.equal(file.length, entry.bytes);
    const d = readHmiDirectory(file);
    assert.ok(d.checksumOk, `stored ${d.storedChecksum.toString(16)} != computed ${d.computedChecksum.toString(16)}`);
    assert.ok(d.backupIdentical, "backup directory mirrors the primary");
    assert.ok(d.sentinelOk && d.magicOk);
    const live = hmiLiveEntries(d);
    assert.ok(live.has("main.HMI") && live.has("Program.s") && live.has("0.pa"));
    for (const e of d.entries) {
      assert.ok(e.start >= 0x700000 && e.start + e.size <= file.length, `${e.name} blob inside the data area`);
    }
  });

  test(`${entry.name}: main.HMI carries the model CRC the compiled .tft uses as seed`, { skip }, () => {
    const file = load(entry.name);
    const live = hmiLiveEntries(readHmiDirectory(file));
    const m = readHmiMain(hmiBlob(file, live.get("main.HMI")));
    assert.equal(m.modelcrc, NSPANEL_SEED);
    assert.equal(m.xiliemark, 100, "F / Discovery series mark");
    assert.equal(m.hmiffid, 0x4f);
    assert.equal(m.filever, 0x21);
    // every declared page/font resource has a live directory entry
    for (const r of m.resources) assert.ok(live.has(r.name), `declared resource ${r.name} present`);
  });

  test(`${entry.name}: every page blob's chained CRC verifies and its header is coherent`, { skip }, () => {
    const file = load(entry.name);
    const pages = hmiPages(file);
    assert.ok(pages.size >= 1);
    for (const [name, p] of pages) {
      assert.ok(p.crcOk, `${name} page CRC`);
      assert.equal(p.datainformationaddr, 0x38, `${name} header size`);
      assert.equal(p.hmiffid, 0x4f);
      assert.equal(p.filever, 0x21);
      assert.ok(p.numberobj >= 1, `${name} counts the page itself`);
      assert.equal(p.contents.length, p.numberobj);
      // content rows are laid out back to back after the header table
      const first = 0x38 + 12 * p.numberobj;
      assert.equal(p.contents[0].startOffset + first, p.contents[0].startOffset + first);
      for (let i = 1; i < p.contents.length; i++) {
        assert.equal(p.contents[i].startOffset, p.contents[i - 1].startOffset + p.contents[i - 1].size, `${name} row ${i} contiguous`);
      }
    }
  });

  if (entry.pair && entry.pairExact) {
    const skipPair = (skip || (!existsSync(cachePath(entry.pair)) && "paired .tft not fetched"));
    test(`${entry.name} ↔ ${entry.pair}: one page per .pa, numberobj = components + the page record`, { skip: skipPair }, () => {
      const hmi = load(entry.name);
      const tft = load(entry.pair);
      assert.equal(header1Fields(tft).modelSeed, NSPANEL_SEED);
      const pages = hmiPages(hmi);
      const ranges = pageRanges(tft);
      assert.equal(pages.size, ranges.length, "same number of pages");
      const hmiTotal = [...pages.values()].reduce((n, p) => n + p.numberobj - 1, 0);
      const tftTotal = ranges.reduce((n, r) => n + r.components.length, 0);
      assert.equal(hmiTotal, tftTotal, "same total of components across pages");
    });
  }
}

test("hmiPageCrc rejects a flipped byte", () => {
  const blob = new Uint8Array(0x38 + 12 + 40);
  blob[0x15] = 0x4f; blob[0x16] = 0x21; blob[0x0c] = 1;
  const crc = hmiPageCrc(blob);
  blob[0x40] ^= 1;
  assert.notEqual(hmiPageCrc(blob), crc);
  const p = readHmiPage(blob);
  assert.equal(p.numberobj, 1);
});
