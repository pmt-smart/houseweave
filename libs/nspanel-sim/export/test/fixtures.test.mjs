// Conformance against real Nextion Editor output: the 32 third-party
// .tft files in fixtures/manifest.json (fetched into fixtures/cache/ by
// scripts/fetch-fixtures.mjs — the binaries are not versioned). Every
// test here skips, not fails, when a fixture is absent, so the suite is
// useful offline; run `npm run fetch-fixtures` first for the full run.
//
// The properties asserted are the ones a survey of the corpus found to hold
// in all 32 files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkHeader1Crc, checkTailChecksum, checkDataRegionChecksum, header1Fields, header2Fields, strdataaddr,
  RECORD_SIZE, readComponentRecord, KNOWN_LEI, preflightTft, NSPANEL_EU_LANDSCAPE, NSPANEL_US_PORTRAIT,
  objxinxiAddress, componentRecordOffset, writeComponentGeometry, GEOMETRY_OFFSET,
  readPictureIndex, pictureIndexAddress, PICTURE_RECORD_SIZE, PICTURE_BLOB_HEADER_SIZE,
  patchAsciiText, findAsciiTextOffset, onlyTailChanged, sealTailChecksum, serialRateAssignments,
} from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "fixtures", "manifest.json"), "utf8"));
const cachePath = (name) => join(root, "fixtures", "cache", name);
const load = (name) => new Uint8Array(readFileSync(cachePath(name)));
const present = manifest.files.filter((f) => existsSync(cachePath(f.name)));
const NSPANEL_SEED = 0x1ce47603;

test(`fixtures: ${present.length}/${manifest.files.length} cached`, { skip: present.length === 0 && "run `npm run fetch-fixtures`" }, () => {
  assert.ok(present.length > 0);
});

for (const entry of manifest.files) {
  const skip = !existsSync(cachePath(entry.name)) && "fixture not fetched";

  test(`${entry.name}: three checksums verify and the size field matches`, { skip }, () => {
    const file = load(entry.name);
    assert.equal(file.length, entry.bytes);
    assert.ok(checkHeader1Crc(file), "header1 CRC");
    assert.ok(checkDataRegionChecksum(file), "resource-region checksum");
    assert.ok(checkTailChecksum(file), "tail checksum");
    assert.equal(header1Fields(file).fileSize, file.length);
  });

  test(`${entry.name}: header2 decrypts into plausible tables, all after the resource region`, { skip }, () => {
    const file = load(entry.name);
    const h1 = header1Fields(file);
    const h2 = header2Fields(file);
    assert.equal(h2.resourcesfileaddr, 0x10000);
    assert.equal(h2.strdataaddr, strdataaddr(file), "strdataaddr == 0x10000 + field 0x40");
    assert.equal(h1.resourceRegionLength % 0x10000, 0, "resource region is 64 KB aligned");
    assert.ok(h2.pageqty >= 1 && h2.objqty >= h2.pageqty);
    assert.ok(h2.objxinxiadd >= h2.strdataaddr, "object table never starts inside the resource region");
    const tableEnd = h2.objxinxiadd + h2.objqty * RECORD_SIZE;
    assert.ok(tableEnd <= file.length - 4 && file.length - tableEnd <= 8, "object table is the last structure before the tail");
    let pages = 0;
    for (let i = 0; i < h2.objqty; i++) {
      const rec = readComponentRecord(file, h2.objxinxiadd + i * RECORD_SIZE);
      if (rec.lei === KNOWN_LEI.Page) pages++;
      assert.equal(rec.endx, rec.x + rec.w - 1, `record ${i} endx`);
      assert.equal(rec.endy, rec.y + rec.h - 1, `record ${i} endy`);
    }
    assert.equal(pages, h2.pageqty, "one Page record per page");
  });

  test(`${entry.name}: preflight verdict matches what the panel would say`, { skip }, () => {
    const file = load(entry.name);
    const h1 = header1Fields(file);
    const expect = h1.orientation === 2 ? NSPANEL_US_PORTRAIT : NSPANEL_EU_LANDSCAPE;
    const result = preflightTft(file, expect);
    const failed = result.checks.filter((c) => !c.ok && c.severity === "block").map((c) => c.id);
    const isNspanelProduction = ["jobr99", "blackymas", "lovejoy777"].includes(entry.source);
    if (isNspanelProduction && h1.orientation === expect.orientation) {
      assert.ok(result.ok, `production NSPanel file must pass: ${failed.join(", ")}`);
    } else if (h1.modelSeed !== NSPANEL_SEED) {
      assert.ok(failed.includes("model-seed"), "another model must fail the seed gate");
    } else {
      // Dev-board compiles for the same seed: 0x33 differs (a warning,
      // not a block — its meaning is unconfirmed), orientation may
      // differ where the test project was rotated, and the serial rate is
      // the Editor's default 9600 (or whatever the experiment set), which
      // would leave an NSPanel deaf to its ESP32. Nothing else may block.
      const variant = result.checks.find((c) => c.id === "variant-flag");
      assert.ok(variant && !variant.ok && variant.severity === "warn", "dev-board compile must raise the 0x33 warning");
      const unexpected = failed.filter((id) => id !== "orientation" && id !== "serial-rate");
      assert.deepEqual(unexpected, [], "no blocking failure besides orientation and the serial rate");
    }
  });
}

// The serial rate a file leaves the display at. Program.s of the Editor's
// default project says baud=9600, and a generated project that kept it would
// boot every NSPanel deaf to its ESP32, which speaks 115200 only: the gate must
// block it and pass the files that are known to run on the panel.
test("the serial-rate gate passes the NSPanel files and blocks the Editor's 9600", {
  skip: !["jobr99/nspanel.tft", "jobr99/nspanel_US_P.tft", "eseverson/23_minimal_project.tft"].every((n) => existsSync(cachePath(n))) && "fixture not fetched",
}, () => {
  const rates = (name) => serialRateAssignments(load(name)).map((r) => `${r.name}=${r.rate}`);
  assert.deepEqual(rates("jobr99/nspanel.tft"), ["bauds=115200", "bauds=115200", "bauds=115200"]);
  assert.deepEqual(rates("eseverson/23_minimal_project.tft"), ["baud=9600"]);
  const gate = (name, expect) => preflightTft(load(name), expect).checks.find((c) => c.id === "serial-rate");
  assert.equal(gate("jobr99/nspanel.tft", NSPANEL_EU_LANDSCAPE).ok, true);
  assert.equal(gate("jobr99/nspanel_US_P.tft", NSPANEL_US_PORTRAIT).ok, true);
  const minimal = gate("eseverson/23_minimal_project.tft", NSPANEL_EU_LANDSCAPE);
  assert.equal(minimal.ok, false);
  assert.equal(minimal.severity, "block");
});

// The labelled text edit in eseverson's corpus: 05_text_qqqqqqqq set a
// Text component to "QQQQQQQQ". Patching it to another 8-byte string
// must keep every checksum valid, touch nothing below strdataaddr, and
// patching it back must reproduce the original byte for byte.
test("patchAsciiText on a real file: same-length roundtrip is byte-exact and stays out of the resource region", {
  skip: !existsSync(cachePath("eseverson/05_text_qqqqqqqq.tft")) && "fixture not fetched",
}, () => {
  const original = load("eseverson/05_text_qqqqqqqq.tft");
  const offset = findAsciiTextOffset(original, "QQQQQQQQ");
  assert.ok(offset >= strdataaddr(original), "the match lies in the string/table area");
  const patched = patchAsciiText(original, "QQQQQQQQ", "RRRRRRRR");
  assert.ok(checkTailChecksum(patched) && checkHeader1Crc(patched) && checkDataRegionChecksum(patched));
  assert.ok(onlyTailChanged(original, patched).ok);
  const back = patchAsciiText(patched, "RRRRRRRR", "QQQQQQQQ");
  assert.deepEqual(Buffer.from(back), Buffer.from(original));
});

// No per-object checksum, and the relocation rule for inserting bytes
// before the table: between base.tft and a variant
// that grew by N bytes with the same component set, every record field
// that changed moved by exactly N (bytecodeOffset, the +8..+27 address
// slots, the u16 indices in Attstrpianyi) and the 20 bytes of
// unknown+geometry at +32..+51 never changed. A per-record checksum
// would show up here as a delta that is not N.
for (const [variant, growth] of [["eseverson/06_bco_magenta.tft", 12], ["eseverson/05_text_qqqqqqqq.tft", 12], ["eseverson/04_red_val_deadbeef.tft", 12]]) {
  test(`${variant}: record fields relocate by exactly +${growth}; geometry untouched`, {
    skip: !(existsSync(cachePath("eseverson/base.tft")) && existsSync(cachePath(variant))) && "fixture not fetched",
  }, () => {
    const a = load("eseverson/base.tft"), b = load(variant);
    assert.equal(b.length - a.length, growth);
    const ha = header2Fields(a), hb = header2Fields(b);
    assert.equal(ha.objqty, hb.objqty);
    const u32 = (buf, o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;
    const u16 = (buf, o) => buf[o] | (buf[o + 1] << 8);
    let relocated = 0;
    for (let i = 0; i < ha.objqty; i++) {
      const oa = ha.objxinxiadd + i * RECORD_SIZE, ob = hb.objxinxiadd + i * RECORD_SIZE;
      for (const k of [4, 8, 12, 16, 20, 24, 28]) {
        const va = u32(a, oa + k), vb = u32(b, ob + k);
        if (va !== vb) { assert.equal((vb - va) | 0, growth, `record ${i} u32 @+${k}`); relocated++; }
      }
      for (let k = 52; k < RECORD_SIZE; k += 2) {
        const va = u16(a, oa + k), vb = u16(b, ob + k);
        if (va !== vb) assert.equal(vb - va, growth, `record ${i} u16 @+${k}`);
      }
      for (let k = 32; k < 52; k++) assert.equal(a[oa + k], b[ob + k], `record ${i} byte +${k} (unknown/geometry) must not change`);
    }
    assert.ok(relocated > 0, "the variant must have relocated at least one address");
  });
}

test("eseverson/01_orientation_flip.tft: rotating the project changes nothing in the object table", {
  skip: !(existsSync(cachePath("eseverson/base.tft")) && existsSync(cachePath("eseverson/01_orientation_flip.tft"))) && "fixture not fetched",
}, () => {
  const a = load("eseverson/base.tft"), b = load("eseverson/01_orientation_flip.tft");
  assert.equal(a.length, b.length);
  assert.notEqual(header1Fields(a).orientation, header1Fields(b).orientation);
  const ha = header2Fields(a);
  assert.equal(ha.objxinxiadd, header2Fields(b).objxinxiadd);
  const tableA = a.subarray(ha.objxinxiadd, ha.objxinxiadd + ha.objqty * RECORD_SIZE);
  const tableB = b.subarray(ha.objxinxiadd, ha.objxinxiadd + ha.objqty * RECORD_SIZE);
  assert.deepEqual(Buffer.from(tableA), Buffer.from(tableB), "stored geometry is logical; orientation is applied by the panel");
});

test("eseverson/17_more_components.tft: multiset diff against base.tft byte-verifies 9 new lei codes at once", {
  skip: !(existsSync(cachePath("eseverson/base.tft")) && existsSync(cachePath("eseverson/17_more_components.tft"))) && "fixture not fetched",
}, () => {
  // Count each (lei,id,x,y,w,h) signature on each side instead
  // of just checking presence, so nothing here can be fooled by a
  // reordered-but-unchanged record, as
  // export/scripts/diff-components.mjs does.
  const records = (file) => {
    const h2 = header2Fields(file);
    const out = [];
    for (let i = 0; i < h2.objqty; i++) out.push(readComponentRecord(file, h2.objxinxiadd + i * RECORD_SIZE));
    return out;
  };
  const sig = (r) => `${r.lei},${r.id},${r.x},${r.y},${r.w},${r.h}`;
  const multiset = (recs) => {
    const m = new Map();
    for (const r of recs) m.set(sig(r), (m.get(sig(r)) ?? 0) + 1);
    return m;
  };
  const before = multiset(records(load("eseverson/base.tft")));
  const after = multiset(records(load("eseverson/17_more_components.tft")));

  const added = [];
  for (const k of after.keys()) {
    const delta = (after.get(k) ?? 0) - (before.get(k) ?? 0);
    if (delta > 0) added.push(k);
  }
  const removed = [...before.keys()].filter((k) => (after.get(k) ?? 0) < before.get(k));

  assert.equal(removed.length, 0, "no record should disappear when components are only added");
  const addedLei = added.map((k) => Number(k.split(",")[0])).sort((a, b) => a - b);
  assert.deepEqual(
    addedLei,
    [0, 5, 53, 55, 56, 57, 58, 112, 113, 122],
    "expected exactly these lei codes to appear as new records (Curve, Touchcap, Button_T, GText, CheckBox, Radio, Qrcode, Picture, PictureCrop, Zhizhen)",
  );
});

test("sealTailChecksum reproduces the Editor's own tail on every fixture", { skip: present.length === 0 && "run `npm run fetch-fixtures`" }, () => {
  for (const entry of present) {
    const file = load(entry.name);
    const resealed = sealTailChecksum(file);
    assert.deepEqual(Buffer.from(resealed.subarray(file.length - 4)), Buffer.from(file.subarray(file.length - 4)), entry.name);
  }
});

test("jobr99/nspanel.tft: moving the screensaver date field rewrites only its geometry slot and the tail (step 7b script)", {
  skip: !existsSync(cachePath("jobr99/nspanel.tft")) && "fixture not fetched",
}, () => {
  const file = load("jobr99/nspanel.tft");
  const h2 = header2Fields(file);
  const base = objxinxiAddress(file);
  const hits = [];
  for (let i = 0; i < h2.objqty; i++) {
    const off = componentRecordOffset(base, i);
    const r = readComponentRecord(file, off);
    if (r.lei === KNOWN_LEI.Text && r.x === 0 && r.y === 165 && r.w === 450 && r.h === 32) hits.push(off);
  }
  assert.equal(hits.length, 1, "the date field signature is unique in the table");
  const off = hits[0];
  const patched = sealTailChecksum(writeComponentGeometry(file, off, { x: 0, y: 140, w: 450, h: 32 }));
  assert.equal(patched.length, file.length);
  assert.ok(checkTailChecksum(patched), "tail resealed");
  assert.ok(preflightTft(patched, NSPANEL_EU_LANDSCAPE).ok, "preflight still passes");
  assert.ok(onlyTailChanged(file, patched).ok);
  const back = readComponentRecord(patched, off);
  assert.deepEqual([back.x, back.y, back.w, back.h, back.endx, back.endy], [0, 140, 450, 32, 449, 171]);
  let changed = 0;
  for (let i = 0; i < file.length; i++) {
    if (file[i] === patched[i]) continue;
    changed++;
    const inGeometry = i >= off + GEOMETRY_OFFSET && i < off + GEOMETRY_OFFSET + 12;
    const inTail = i >= file.length - 4;
    assert.ok(inGeometry || inTail, `unexpected byte changed at 0x${i.toString(16)}`);
  }
  assert.ok(changed >= 2 && changed <= 16, `changed ${changed} bytes`);
});

test("jobr99/nspanel.tft: every visible component's geometry is also in the page bytecode as ASCII \"x,y,w,h,\" (7b' premise)", {
  skip: !existsSync(cachePath("jobr99/nspanel.tft")) && "fixture not fetched",
}, () => {
  const file = load("jobr99/nspanel.tft");
  const h2 = header2Fields(file);
  const sd = strdataaddr(file);
  const base = objxinxiAddress(file);
  const enc = new TextEncoder();
  const count = (s) => {
    const t = enc.encode(s);
    let n = 0;
    outer: for (let i = sd; i + t.length <= base; i++) {
      for (let j = 0; j < t.length; j++) if (file[i + j] !== t[j]) continue outer;
      n++;
    }
    return n;
  };
  let visible = 0;
  let withCopy = 0;
  for (let i = 0; i < h2.objqty; i++) {
    const r = readComponentRecord(file, componentRecordOffset(base, i));
    if (r.lei === KNOWN_LEI.Page || (r.w === 1 && r.h === 1)) continue;
    visible++;
    if (count(`${r.x},${r.y},${r.w},${r.h},`) >= 1) withCopy++;
  }
  assert.equal(withCopy, visible, `${withCopy}/${visible} visible components have an ASCII geometry copy`);
  // the screensaver date field specifically: exactly two copies, both inside its page's bytecode
  assert.equal(count("0,165,450,32,"), 2);
});

for (const entry of manifest.files) {
  const skip = !existsSync(cachePath(entry.name)) && "fixture not fetched";
  test(`${entry.name}: picture index is a contiguous table of 24-byte records at an absolute offset`, { skip }, () => {
    const file = load(entry.name);
    const h2 = header2Fields(file);
    const pics = readPictureIndex(file);
    assert.equal(pics.length, h2.picqty);
    if (pics.length === 0) return;
    const table = pictureIndexAddress(file);
    assert.ok(table >= 0x10000 && table < strdataaddr(file), "table lives in the resource region");
    assert.equal(pics[0].dataOffset, table + PICTURE_RECORD_SIZE * pics.length, "first blob right after the table");
    for (let i = 0; i < pics.length; i++) {
      const p = pics[i];
      assert.equal(p.id, i);
      assert.ok(p.width > 0 && p.height > 0 && p.width <= 4096 && p.height <= 4096, `pic ${i} dims ${p.width}x${p.height}`);
      assert.ok(p.dataOffset + p.size <= strdataaddr(file), `pic ${i} ends inside the resource region`);
      if (i > 0) assert.equal(p.dataOffset, pics[i - 1].dataOffset + pics[i - 1].size, `pic ${i} contiguous`);
      if (p.storage === "raw") {
        assert.equal(p.size, p.width * p.height * 2 + PICTURE_BLOB_HEADER_SIZE, `pic ${i} raw size`);
        assert.equal(p.codecField, 0);
      } else {
        assert.ok(p.size < p.width * p.height * 2 + PICTURE_BLOB_HEADER_SIZE, `pic ${i} compressed smaller than raw`);
      }
    }
  });
}
