// Composition on top of the Editor's own templates (hmiWrite.ts): adding a
// component built from a template reproduces what the Editor itself wrote.
// Fixture 06 -> 07 differ by exactly one Hotspot on the main page, so
// 06 + buildComponent(Hotspot) must equal 07 byte for byte, page blob and
// project alike (every other entry untouched).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readHmiDirectory, hmiLiveEntries, hmiBlob, readHmiComponents, readHmiPage,
  encodeComponentRecord, buildComponent, withChanges, editPageBlob, editHmiProject, hmiTemplate, HMI_TEMPLATES,
} from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cachePath = (name) => join(root, "fixtures", "cache", "eseverson-hmi", name);
const load = (name) => new Uint8Array(readFileSync(cachePath(name)));
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const page0 = (file) => hmiBlob(file, hmiLiveEntries(readHmiDirectory(file)).get("0.pa"));
const le = (u8) => u8.reduce((acc, b, i) => acc + b * 2 ** (8 * i), 0);
const attr = (spec, name) => spec.attributes.find((a) => a.name === name).value;
const text = (u8) => new TextDecoder().decode(u8);

const skip = !(existsSync(cachePath("06_bco_magenta_06.HMI")) && existsSync(cachePath("07_add_hotspot_07.HMI"))) && "fixtures not fetched";

test("templates cover the component types the fixtures use, each with id/objname first", () => {
  const names = Object.values(HMI_TEMPLATES).map((t) => t.name);
  for (const n of ["Page", "Text", "Button", "Slider", "Picture", "Hotspot", "Prog", "XFloat", "Timer", "Vari"]) assert.ok(names.includes(n), n);
  for (const t of Object.values(HMI_TEMPLATES)) {
    assert.equal(t.attributes[0].name, "type");
    assert.equal(t.attributes[1].name, "id");
    assert.equal(t.attributes[2].name, "objname");
    assert.equal(le(Uint8Array.from(Buffer.from(t.attributes[0].defaultHex, "hex"))), t.type);
  }
  assert.equal(hmiTemplate("text").type, 116);
  assert.equal(hmiTemplate(109).name, "Hotspot");
});

test("06 + Hotspot built from the template == 07's main page, byte for byte", { skip }, () => {
  const b06 = page0(load("06_bco_magenta_06.HMI"));
  const b07 = page0(load("07_add_hotspot_07.HMI"));
  const rebuilt = editPageBlob(b06, { add: [{ type: "Hotspot", objname: "m1", x: 0, y: 0, w: 60, h: 60 }] });
  assert.ok(same(rebuilt, b07));
  assert.equal(readHmiPage(rebuilt).numberobj, readHmiPage(b06).numberobj + 1);
  const added = readHmiComponents(rebuilt).at(-1);
  assert.equal(added.id, 30);
  assert.equal(added.objname, "m1");
});

test("editHmiProject(06, add Hotspot) leaves every other entry identical to 07's", { skip }, () => {
  const f06 = load("06_bco_magenta_06.HMI");
  const f07 = load("07_add_hotspot_07.HMI");
  const out = editHmiProject(f06, { "0.pa": { add: [{ type: "Hotspot", objname: "m1", x: 0, y: 0, w: 60, h: 60 }] } });
  const d = readHmiDirectory(out);
  assert.ok(d.checksumOk && d.backupIdentical && d.sentinelOk && d.magicOk);
  const liveOut = hmiLiveEntries(d);
  const live07 = hmiLiveEntries(readHmiDirectory(f07));
  assert.deepEqual([...liveOut.keys()].sort(), [...live07.keys()].sort());
  for (const [name, e] of live07) assert.ok(same(hmiBlob(out, liveOut.get(name)), hmiBlob(f07, e)), `${name} identical to 07`);
});

test("buildComponent: geometry derives endx/endy, txt resizes and grows txt_maxl, unknowns are rejected", () => {
  const t = buildComponent({ type: "Text", objname: "d1a", x: 10, y: 20, w: 100, h: 30, attributes: { txt: "twenty characters!!!", pco: 63488, font: 1 } }, 7);
  assert.equal(le(attr(t, "id")), 7);
  assert.equal(text(attr(t, "objname")), "d1a");
  assert.equal(le(attr(t, "endx")), 109);
  assert.equal(le(attr(t, "endy")), 49);
  assert.equal(text(attr(t, "txt")), "twenty characters!!!");
  assert.equal(le(attr(t, "txt_maxl")), 20);
  assert.equal(le(attr(t, "pco")), 63488);
  assert.equal(le(attr(t, "font")), 1);
  assert.deepEqual(t.events.map((e) => e.event), ["down", "up"]);
  const rec = encodeComponentRecord(t);
  assert.equal(text(rec.subarray(4, 10)), "att-39");
  assert.throws(() => buildComponent({ type: "Text", objname: "x", attributes: { nope: 1 } }, 1), /no attribute "nope"/);
  assert.throws(() => buildComponent({ type: "Text", objname: "x", attributes: { pco: 70000 } }, 1), /does not fit/);
  assert.throws(() => buildComponent({ type: "Timer", objname: "tm9", x: 1 }, 1), /no geometry/);
  assert.throws(() => buildComponent({ type: "Hotspot", objname: "m9", events: [{ event: "timer", lines: [] }] }, 1), /no event "timer"/);
  const h = buildComponent({ type: "Hotspot", objname: "m9", x: 1, y: 2, w: 3, h: 4, events: [{ event: "down", lines: ['t0.txt="hot"'] }] }, 3);
  assert.deepEqual(h.events, [{ event: "down", lines: ['t0.txt="hot"'] }, { event: "up", lines: [] }]);
});

test("withChanges: moving a component recomputes endx/endy; longer txt grows txt_maxl", { skip }, () => {
  const comps = readHmiComponents(page0(load("06_bco_magenta_06.HMI")));
  const t0 = comps.find((c) => c.objname === "t0");
  const moved = withChanges(t0, { attributes: { x: 20, y: 25, w: 120, h: 40 } });
  assert.equal(le(attr(moved, "endx")), 139);
  assert.equal(le(attr(moved, "endy")), 64);
  const longer = withChanges(t0, { attributes: { txt: "a much longer text than fifteen" } });
  assert.equal(le(attr(longer, "txt_maxl")), 31);
  assert.equal(text(attr(withChanges(t0, { attributes: { txt: "ok" } }), "txt")), "ok");
  assert.throws(() => withChanges(t0, { attributes: { zzz: 1 } }), /no attribute "zzz"/);
  assert.throws(() => editPageBlob(page0(load("06_bco_magenta_06.HMI")), { changes: { ghost: { attributes: { x: 1 } } } }), /no component named ghost/);
  // the Editor checks a page's names by hash, and so do we
  assert.throws(() => editPageBlob(page0(load("06_bco_magenta_06.HMI")), { add: [{ type: "Text", objname: "t0" }] }), /Illegal name \(CRC\).*t0-t0/);
  // two DIFFERENT names that collide get the same refusal from the Editor
  assert.throws(
    () => editPageBlob(page0(load("06_bco_magenta_06.HMI")), { add: [{ type: "Text", objname: "aaaaaaaa" }, { type: "Text", objname: "gasukkwk" }] }),
    /different names, same hash/,
  );
});

// -------------------------------------- the page name lives in two places

/**
 * Renaming a page has to move BOTH copies of its name.
 *
 * A page's name sits in the 0x38-byte page header and, again, in the page's own
 * component record. The Editor reads the header for its page list, so with the
 * record alone renamed `page <name>` would point at a page that, as far as the
 * compiler is concerned, does not exist. Its answer is
 * `Error:Invalid Page ID:<name>`.
 */
test("renaming a page moves the header name too, not just the record", () => {
  const file = load("23_minimal_project_23.HMI");
  if (!existsSync(cachePath("23_minimal_project_23.HMI"))) return;
  const before = page0(file);
  assert.equal(readHmiPage(before).name, "page0");

  const after = editPageBlob(before, { changes: { page0: { attributes: { objname: "screensaver" } } } });
  const record = readHmiComponents(after).find((c) => hmiTemplate(c.type).name === "Page");
  assert.equal(record.objname, "screensaver", "the page record");
  assert.equal(readHmiPage(after).name, "screensaver", "and the page header, which is the one the Editor reads");
});

test("a page renamed to something the Editor refuses is refused here first", () => {
  const file = load("23_minimal_project_23.HMI");
  if (!existsSync(cachePath("23_minimal_project_23.HMI"))) return;
  assert.throws(
    () => editPageBlob(page0(file), { changes: { page0: { attributes: { objname: "0bad" } } } }),
    /First character of a Name can not be number/,
  );
});
