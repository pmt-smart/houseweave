// hmiWrite.ts round-trips the Editor's own output byte for byte: every
// component record and every page blob of every .HMI fixture re-encodes
// to exactly the original bytes, and replacing a page with its own
// re-encoded blob yields a project whose directory still verifies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readHmiDirectory, hmiLiveEntries, hmiBlob, readHmiPage, readHmiComponents,
  encodeComponentRecord, componentToSpec, encodePageBlob, pageHeaderSpec, replaceHmiEntry,
  setHmiOrientation,
} from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "fixtures", "manifest.json"), "utf8"));
const cachePath = (name) => join(root, "fixtures", "cache", name);
const load = (name) => new Uint8Array(readFileSync(cachePath(name)));
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

for (const entry of manifest.hmi ?? []) {
  const skip = !existsSync(cachePath(entry.name)) && "fixture not fetched";

  test(`${entry.name}: every component record and page blob re-encodes byte for byte`, { skip }, () => {
    const file = load(entry.name);
    const live = hmiLiveEntries(readHmiDirectory(file));
    let records = 0;
    for (const [name, e] of live) {
      if (!/^\d+\.pa$/.test(name)) continue;
      const blob = hmiBlob(file, e);
      const page = readHmiPage(blob);
      const comps = readHmiComponents(blob);
      const encoded = comps.map((c) => {
        const bytes = encodeComponentRecord(componentToSpec(c));
        assert.ok(same(bytes, blob.subarray(c.offset, c.offset + c.size)), `${name} row ${c.row} (${c.objname}) re-encodes exactly`);
        records++;
        return bytes;
      });
      const rebuilt = encodePageBlob(pageHeaderSpec(blob, page), encoded);
      assert.ok(same(rebuilt, blob), `${name} page blob re-encodes exactly (CRC included)`);
    }
    assert.ok(records > 0);
  });

  test(`${entry.name}: replacing a page with its own re-encoding keeps the directory valid`, { skip }, () => {
    const file = load(entry.name);
    const live = hmiLiveEntries(readHmiDirectory(file));
    const e = live.get("0.pa");
    const blob = hmiBlob(file, e);
    const out = replaceHmiEntry(file, "0.pa", Uint8Array.from(blob));
    assert.equal(out.length, file.length + blob.length);
    const d = readHmiDirectory(out);
    assert.ok(d.checksumOk && d.backupIdentical && d.sentinelOk && d.magicOk);
    const e2 = hmiLiveEntries(d).get("0.pa");
    assert.equal(e2.start, file.length);
    assert.equal(e2.size, blob.length);
    assert.ok(same(hmiBlob(out, e2), blob));
  });
}

// ------------------------------------------------------------ orientation

/**
 * `main.HMI` +0x0C is the screen orientation, and the NSPanel needs 3.
 *
 * Measured from eseverson's pair: `00_baseline_base` and `01_orientation_flip_01`
 * are the same project with only that setting changed, and they differ in
 * exactly two places -- +0x0C (1 -> 3) and the header CRC at +0x00. joBr99's own
 * EU project carries 3 as well.
 *
 * 1 and 3 are BOTH landscape, half a turn apart, and the Nextion inside an
 * NSPanel is mounted upside down: a project left at 1 compiles, passes every
 * checksum, and draws every screen rotated 180 degrees on the glass.
 */
test("the orientation byte is where the flip fixture says it is", () => {
  const baseName = "eseverson-hmi/00_baseline_base.HMI", flipName = "eseverson-hmi/01_orientation_flip_01.HMI";
  if (!existsSync(cachePath(baseName)) || !existsSync(cachePath(flipName))) return;
  const mainOf = (f) => hmiBlob(f, hmiLiveEntries(readHmiDirectory(f)).get("main.HMI"));
  const a = mainOf(load(baseName)), b = mainOf(load(flipName));
  assert.equal(a[0x0c], 1, "baseline is landscape");
  assert.equal(b[0x0c], 3, "the flip is landscape 180");
  // and nothing else in the header moves except the CRC at +0x00
  const moved = [];
  for (let i = 4; i < Math.min(a.length, b.length, 0x60); i++) if (a[i] !== b[i]) moved.push(i);
  assert.deepEqual(moved.filter((i) => i !== 0x0c && i !== 0x1c), [], `unexpected bytes moved: ${moved}`);
});

test("setHmiOrientation writes it and keeps the file readable", () => {
  const name = "eseverson-hmi/23_minimal_project_23.HMI";
  if (!existsSync(cachePath(name))) return;
  const out = setHmiOrientation(load(name), 3);
  const main = hmiBlob(out, hmiLiveEntries(readHmiDirectory(out)).get("main.HMI"));
  assert.equal(main[0x0c], 3);
  const dir = readHmiDirectory(out);
  assert.ok(dir.checksumOk && dir.backupIdentical && dir.sentinelOk && dir.magicOk, "the container still verifies");
});

test("an orientation outside 0..3 is refused", () => {
  const name = "eseverson-hmi/23_minimal_project_23.HMI";
  if (!existsSync(cachePath(name))) return;
  assert.throws(() => setHmiOrientation(load(name), 4), /0\.\.3/);
});
