// main.HMI and page insertion (hmiWrite.ts): the main.HMI CRC chain
// verifies on every fixture; re-encoding main.HMI from its own header and
// resource list is byte-exact; and adding the page "scratch" to fixture 10
// reproduces fixture 11's new page and main.HMI byte for byte (the Editor
// did exactly that between the two).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readHmiDirectory, hmiLiveEntries, hmiBlob, readHmiMain, readHmiPage, readHmiComponents, hmiMainCrc,
  encodeHmiMain, appendHmiEntry, addHmiPage, setHmiProgram, editHmiProject,
} from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "fixtures", "manifest.json"), "utf8"));
const cachePath = (name) => join(root, "fixtures", "cache", name);
const load = (name) => new Uint8Array(readFileSync(cachePath(name)));
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const live = (file) => hmiLiveEntries(readHmiDirectory(file));
const F10 = "eseverson-hmi/10_timer_extra_line_10.HMI", F11 = "eseverson-hmi/11_add_page_11.HMI";
const skipPair = !(existsSync(cachePath(F10)) && existsSync(cachePath(F11))) && "fixtures not fetched";

for (const entry of manifest.hmi ?? []) {
  const skip = !existsSync(cachePath(entry.name)) && "fixture not fetched";
  test(`${entry.name}: main.HMI CRC verifies and main.HMI re-encodes byte for byte`, { skip }, () => {
    const file = load(entry.name);
    const blob = hmiBlob(file, live(file).get("main.HMI"));
    const main = readHmiMain(blob);
    assert.ok(main.crcOk, `stored ${main.crc.toString(16)} computed ${hmiMainCrc(blob).toString(16)}`);
    assert.ok(same(encodeHmiMain(blob, main.resources), blob));
  });
}

test("appendHmiEntry: one more live entry, blob at the end, directory still verifies", { skip: skipPair }, () => {
  const file = load(F10);
  const before = readHmiDirectory(file);
  const out = appendHmiEntry(file, "9.pa", Uint8Array.of(1, 2, 3));
  const d = readHmiDirectory(out);
  assert.equal(d.count, before.count + 1);
  assert.ok(d.checksumOk && d.backupIdentical && d.sentinelOk && d.magicOk);
  const e = hmiLiveEntries(d).get("9.pa");
  assert.equal(e.start, file.length);
  assert.deepEqual([...hmiBlob(out, e)], [1, 2, 3]);
  assert.throws(() => appendHmiEntry(out, "9.pa", Uint8Array.of(1)), /already exists/);
});

test("addHmiPage(10, 'scratch') reproduces fixture 11's 4.pa and main.HMI byte for byte", { skip: skipPair }, () => {
  const f10 = load(F10), f11 = load(F11);
  const { file: out, entryName, pageIndex } = addHmiPage(f10, { name: "scratch" });
  assert.equal(entryName, "4.pa");
  assert.equal(pageIndex, 4);
  const d = readHmiDirectory(out);
  assert.ok(d.checksumOk && d.backupIdentical && d.sentinelOk && d.magicOk);
  const lo = hmiLiveEntries(d), l11 = live(f11);
  assert.deepEqual([...lo.keys()].sort(), [...l11.keys()].sort());
  for (const [name, e] of l11) assert.ok(same(hmiBlob(out, lo.get(name)), hmiBlob(f11, e)), `${name} identical to 11`);
  const page = readHmiPage(hmiBlob(out, lo.get("4.pa")));
  assert.equal(page.name, "scratch");
  assert.equal(page.numberobj, 1);
  assert.ok(page.crcOk);
  assert.equal(readHmiMain(hmiBlob(out, lo.get("main.HMI"))).resources.at(-1).name, "4.pa");
  assert.throws(() => addHmiPage(out, { name: "scratch" }), /already exists/);
});

test("a new page takes components like any other; Program.s is replaced as plain text", { skip: skipPair }, () => {
  const { file, entryName } = addHmiPage(load(F10), { name: "d1page", attributes: { bco: 31 } });
  const out = setHmiProgram(editHmiProject(file, { [entryName]: { add: [{ type: "Text", objname: "hello", x: 10, y: 10, w: 200, h: 40, attributes: { txt: "hello from D1" } }] } }), "int sys0=0\npage 0\n");
  const l = live(out);
  const comps = readHmiComponents(hmiBlob(out, l.get(entryName)));
  assert.equal(comps.length, 2);
  assert.equal(comps[1].objname, "hello");
  assert.equal(comps[1].id, 1);
  assert.equal(new TextDecoder().decode(hmiBlob(out, l.get("Program.s"))), "int sys0=0\npage 0\n");
  const d = readHmiDirectory(out);
  assert.ok(d.checksumOk && d.backupIdentical);
});
