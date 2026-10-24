// Multiset diff of the objxinxi component table between two .tft files
// (the technique that tells Hotspot and Text apart: counts each (lei,id,x,y,w,h) signature on
// each side, not just presence, so a reordered-but-unchanged record
// does not look like an add+remove. Sanity-checked against
// `11_add_page`, which must report exactly one new Page (lei 121)
// record and nothing else.
//
//   node scripts/diff-components.mjs <before.tft> <after.tft>
import { readFileSync } from "node:fs";
import { header2Fields } from "../dist/tftFormat.js";
import { RECORD_SIZE, readComponentRecord } from "../dist/component.js";

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error("usage: node scripts/diff-components.mjs <before.tft> <after.tft>");
  process.exit(2);
}

function load(path) {
  const buf = readFileSync(path);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function records(file) {
  const h2 = header2Fields(file);
  const out = [];
  for (let i = 0; i < h2.objqty; i++) {
    out.push(readComponentRecord(file, h2.objxinxiadd + i * RECORD_SIZE));
  }
  return out;
}

function sig(r) {
  return `lei=${r.lei} id=${r.id} x=${r.x} y=${r.y} w=${r.w} h=${r.h}`;
}

function multiset(records) {
  const m = new Map();
  for (const r of records) {
    const k = sig(r);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

const before = load(beforePath);
const after = load(afterPath);
const beforeRecords = records(before);
const afterRecords = records(after);
console.log(`${beforePath}: ${beforeRecords.length} records`);
console.log(`${afterPath}: ${afterRecords.length} records`);

const beforeMs = multiset(beforeRecords);
const afterMs = multiset(afterRecords);

const added = [];
const removed = [];
const allKeys = new Set([...beforeMs.keys(), ...afterMs.keys()]);
for (const k of allKeys) {
  const b = beforeMs.get(k) ?? 0;
  const a = afterMs.get(k) ?? 0;
  if (a > b) added.push({ sig: k, count: a - b });
  if (b > a) removed.push({ sig: k, count: b - a });
}

console.log(`\nadded (${added.length} distinct signatures):`);
for (const x of added) console.log(`  +${x.count}  ${x.sig}`);
console.log(`\nremoved (${removed.length} distinct signatures):`);
for (const x of removed) console.log(`  -${x.count}  ${x.sig}`);
