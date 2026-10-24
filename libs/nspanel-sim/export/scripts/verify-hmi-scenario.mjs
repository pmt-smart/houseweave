// Closes the D1 loop without hardware: compares a .tft the Nextion Editor
// compiled from a generated scenario against the scenario's expected.json
// (written by build-hmi-scenario.mjs). Per page: component count, and for
// each component its type, id and geometry as the compiled record carries
// them; optionally a byte comparison with a reference .tft from the corpus.
//
//   node scripts/verify-hmi-scenario.mjs hmi-scenarios/out/d1-02-text-grid.expected.json path/to/compiled.tft
//
// Exit code 0 = everything matches. Requires `npm run build`.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  header2Fields, objxinxiAddress, componentRecordOffset, readComponentRecord, pageRanges, findGeometryStrings,
  checkHeader1Crc, checkTailChecksum, header2Seed, checkSliceAttrs, pageRamImage, codeOffsetOf, HMI_TEMPLATES,
} from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [expectedPath, tftPath] = process.argv.slice(2);
if (!expectedPath || !tftPath) { console.error("usage: verify-hmi-scenario.mjs <expected.json> <compiled.tft>"); process.exit(2); }

const expected = JSON.parse(readFileSync(expectedPath, "utf8"));
const tft = new Uint8Array(readFileSync(tftPath));
const h2 = header2Fields(tft);
const base = objxinxiAddress(tft);
const ranges = pageRanges(tft);
let failures = 0;
const fail = (msg) => { failures++; console.log(`  FAIL ${msg}`); };

/** The template's own value of every numeric attribute of a type (to spot a
 *  layout-changing attribute moved off its default). */
function templateValues(lei) {
  const t = HMI_TEMPLATES[String(lei)];
  if (!t) return {};
  const out = {};
  for (const a of t.attributes) {
    const bytes = a.defaultHex.match(/../g)?.map((h) => parseInt(h, 16)) ?? [];
    out[a.name] = a.name === "txt" ? String.fromCharCode(...bytes).replace(/\0+$/, "") : bytes.reduce((v, b, i) => v + b * 2 ** (8 * i), 0);
  }
  return out;
}

console.log(`${expected.scenario}: ${tftPath} (${tft.length} bytes)`);
console.log(`  header1 crc ${checkHeader1Crc(tft) ? "ok" : "BAD"}, tail checksum ${checkTailChecksum(tft) ? "ok" : "BAD"}, model seed 0x${header2Seed(tft).toString(16)}, pages ${h2.pageqty}, objects ${h2.objqty}, fonts ${h2.zimoqty}`);
if (!checkHeader1Crc(tft)) fail("header1 CRC does not match");
if (!checkTailChecksum(tft)) fail("tail checksum does not match");
if (h2.pageqty !== expected.pages.length) fail(`page count: tft ${h2.pageqty}, expected ${expected.pages.length}`);

for (const page of expected.pages) {
  const range = ranges[page.index];
  if (!range) { fail(`page ${page.index} "${page.name}" missing in tft`); continue; }
  const records = range.components.map((i) => ({ index: i, ...readComponentRecord(tft, componentRecordOffset(base, i)) }));
  const label = `page ${page.index} "${page.name}"`;
  let attrsChecked = 0;
  const attrsSkipped = [];
  let image = null;
  try { image = pageRamImage(tft, page.index); } catch (e) { fail(`${label}: RAM image not located: ${e.message}`); }
  // the page record's offset anchors the 64 KB window of the u16-only offsets
  const pageRec = readComponentRecord(tft, componentRecordOffset(base, range.pageRecord));
  const pageCode = pageRec.bytecodeOffset;
  if (records.length !== page.components.length) fail(`${label}: ${records.length} components in tft, expected ${page.components.length}`);
  page.components.forEach((c, i) => {
    const r = records[i];
    if (!r) { fail(`${label}: ${c.objname} (#${i}) has no tft record`); return; }
    const problems = [];
    if (r.lei !== c.type) problems.push(`type ${r.lei} != ${c.type} (${c.typeName})`);
    if (r.id !== c.id) problems.push(`id ${r.id} != ${c.id}`);
    if (c.x !== undefined) {
      if (r.x !== c.x || r.y !== c.y || r.w !== c.w || r.h !== c.h) problems.push(`geometry ${r.x},${r.y},${r.w}x${r.h} != ${c.x},${c.y},${c.w}x${c.h}`);
      // the draw commands carry "x,y,w,h," in ASCII inside the object's own
      // code blocks; look for the expected string there, not for the
      // one derived from the record (which was the same thing twice)
      const want = `${c.x},${c.y},${c.w},${c.h},`;
      // walk the object's own first blocks (draw command, auxiliaries, fill),
      // following the u32 lengths; another object's code offset may point
      // inside them in big projects (joBr99), so the next offset is no bound
      if (c.type !== 109 && c.type !== 51 && c.type !== 52 && c.type !== 5) {
        const bytes = Array.from(new TextEncoder().encode(want));
        const regionEnd = h2.strdataaddr + h2.staticstrBeg;
        let o = h2.strdataaddr + codeOffsetOf(r, pageCode), found = false;
        // Radio and Prog draw through a compiled script and only reach
        // the plain "x,y,w,h," of their erase fill after several blocks
        for (let b = 0; b < 12 && o + 4 <= regionEnd && !found; b++) {
          const len = tft[o] | (tft[o + 1] << 8) | (tft[o + 2] << 16) | (tft[o + 3] << 24);
          const end = Math.min(regionEnd, o + 4 + len);
          scan: for (let q = o + 4; q + bytes.length <= end; q++) { for (let k = 0; k < bytes.length; k++) if (tft[q + k] !== bytes[k]) continue scan; found = true; break; }
          o = end;
        }
        if (!found) problems.push(`no "${want}" in the object's first code blocks`);
      }
    }
    // initial attribute values: the object's slice of the page's RAM image,
    // located by objdatarampos
    if (c.attributes && Object.keys(c.attributes).length && image) {
      const template = templateValues(c.type);
      const slot = image.objects.find((o) => o.index === r.index);
      const a = slot ? checkSliceAttrs(tft, slot.sliceStart, c.type, c.attributes, template) : { checked: [], problems: ["no RAM slice for this record"] };
      attrsChecked += a.checked.length;
      if (a.skipped) attrsSkipped.push(`${c.objname}: ${a.skipped}`);
      problems.push(...a.problems.map((p) => `attribute ${p}`));
    }
    if (problems.length) fail(`${label}: ${c.objname} (${c.typeName} #${i}): ${problems.join("; ")}`);
  });
  console.log(`  ${label}: ${records.length} components checked${records.length === page.components.length ? "" : " (count differs)"}, ${attrsChecked} attribute value(s)${attrsSkipped.length ? ` (skipped: ${attrsSkipped.join("; ")})` : ""}`);
}

if (expected.compareTft) {
  const refPath = join(root, "fixtures", "cache", expected.compareTft);
  if (!existsSync(refPath)) console.log(`  (reference ${expected.compareTft} not fetched; byte comparison skipped)`);
  else {
    const ref = new Uint8Array(readFileSync(refPath));
    let diff = 0, first = -1;
    const n = Math.max(ref.length, tft.length);
    for (let i = 0; i < n; i++) if (ref[i] !== tft[i]) { diff++; if (first < 0) first = i; }
    console.log(`  vs ${expected.compareTft}: ${ref.length} bytes, ${diff} differing byte(s)${first >= 0 ? ` (first at 0x${first.toString(16)})` : ""}`);
    if (diff) console.log("  (a different Editor build can legitimately change bytes; the checks above are the verdict)");
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nPASS: the compiled .tft matches the scenario");
process.exit(failures ? 1 : 0);
