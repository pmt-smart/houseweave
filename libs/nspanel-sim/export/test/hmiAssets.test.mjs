// Fonts and pictures in the .HMI (hmiWrite.ts): the picture blob format
// round-trips byte for byte against the Editor's .i/.is/.ib entries, the
// compiled .tft carries the .i payload verbatim, and adding fonts and a
// picture to the minimal project yields the Editor's resource order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readHmiDirectory, hmiLiveEntries, hmiBlob, readHmiMain, readHmiPictureBlob, encodeRawPictureBlob, encodePngPictureBlob,
  addHmiFont, addHmiPicture, addHmiPage, editHmiProject, readHmiComponents, readPictureIndex,
} from "../dist/index.js";
import { testPattern } from "../scripts/lib/png.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cachePath = (name) => join(root, "fixtures", "cache", name);
const load = (name) => new Uint8Array(readFileSync(cachePath(name)));
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const live = (file) => hmiLiveEntries(readHmiDirectory(file));
const F00 = "eseverson-hmi/00_baseline_base.HMI", F15 = "eseverson-hmi/15_picture_15.HMI", T15 = "eseverson/15_picture.tft", F23 = "eseverson-hmi/23_minimal_project_23.HMI";
const have = (...names) => names.every((n) => existsSync(cachePath(n)));

for (const fixture of [F00, F15]) {
  test(`${fixture}: .i/.is/.ib re-encode byte for byte from their decoded payloads`, { skip: !have(fixture) && "fixture not fetched" }, () => {
    const file = load(fixture);
    const l = live(file);
    const raw = readHmiPictureBlob(hmiBlob(file, l.get("0.i")));
    assert.equal(raw.kind, 3);
    assert.equal(raw.payload.length, raw.width * raw.height * 2);
    assert.ok(same(encodeRawPictureBlob(raw.width, raw.height, raw.payload), hmiBlob(file, l.get("0.i"))));
    for (const name of ["0.is", "0.ib"]) {
      const p = readHmiPictureBlob(hmiBlob(file, l.get(name)));
      assert.equal(p.kind, 1);
      assert.ok(same(encodePngPictureBlob(p.width, p.height, p.payload), hmiBlob(file, l.get(name))));
    }
    const is = readHmiPictureBlob(hmiBlob(file, l.get("0.is")));
    assert.equal(is.width, raw.width);
    assert.equal(is.height, raw.height);
  });
}

test("the compiled .tft embeds the .i payload (20-byte header + RGB565) verbatim", { skip: !have(F15, T15) && "fixtures not fetched" }, () => {
  const file = load(F15);
  const blob = hmiBlob(file, live(file).get("0.i"));
  const tft = load(T15);
  const [pic] = readPictureIndex(tft);
  assert.equal(pic.width, 213);
  assert.equal(pic.height, 158);
  assert.equal(pic.size, blob.length - 0x18);
  assert.ok(same(tft.subarray(pic.dataOffset, pic.dataOffset + pic.size), blob.subarray(0x18)));
});

test("fonts and a picture added to the minimal project: Editor resource order, ids, blobs verbatim, pages still there", { skip: !have(F00, F23) && "fixtures not fetched" }, () => {
  const f00 = load(F00), l00 = live(f00);
  let out = load(F23);
  const fonts = ["0.zi", "1.zi", "2.zi"].map((n) => hmiBlob(f00, l00.get(n)));
  const ids = [];
  for (const zi of fonts) { const r = addHmiFont(out, zi); out = r.file; ids.push(r.id); }
  assert.deepEqual(ids, [0, 1, 2]);
  const pat = testPattern(64, 48);
  const pic = addHmiPicture(out, { width: 64, height: 48, rgb565: pat.rgb565, png: pat.png });
  out = pic.file;
  assert.equal(pic.id, 0);
  assert.equal(pic.entryName, "0.i");
  const d = readHmiDirectory(out);
  assert.ok(d.checksumOk && d.backupIdentical && d.sentinelOk && d.magicOk);
  const l = hmiLiveEntries(d);
  const main = readHmiMain(hmiBlob(out, l.get("main.HMI")));
  assert.ok(main.crcOk);
  assert.deepEqual(main.resources.map((r) => r.name), ["0.i", "0.zi", "1.zi", "2.zi", "0.pa"]);
  fonts.forEach((zi, i) => assert.ok(same(hmiBlob(out, l.get(`${i}.zi`)), zi)));
  const raw = readHmiPictureBlob(hmiBlob(out, l.get("0.i")));
  assert.deepEqual([raw.width, raw.height], [64, 48]);
  assert.ok(same(raw.payload, pat.rgb565));
  assert.ok(same(readHmiPictureBlob(hmiBlob(out, l.get("0.ib"))).payload, pat.png));
  // a page added afterwards lands after the assets, and a Picture component can point at the picture
  const page = addHmiPage(out, { name: "gallery" });
  out = editHmiProject(page.file, { [page.entryName]: { add: [{ type: "Picture", objname: "p0", x: 8, y: 8, w: 64, h: 48, attributes: { pic: 0 } }] } });
  assert.deepEqual(readHmiMain(hmiBlob(out, live(out).get("main.HMI"))).resources.map((r) => r.name), ["0.i", "0.zi", "1.zi", "2.zi", "0.pa", "1.pa"]);
  assert.equal(readHmiComponents(hmiBlob(out, live(out).get("1.pa")))[1].objname, "p0");
  assert.throws(() => addHmiFont(out, Uint8Array.of(1, 2, 3, 4)), /not a \.zi/);
});
