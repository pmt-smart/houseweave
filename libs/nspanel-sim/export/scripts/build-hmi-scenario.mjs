// Builds a D1 scenario: takes an Editor-made .HMI fixture, applies the page
// edits described in a scenario file (components added from the templates,
// attributes and event handlers changed), and writes the resulting project
// for the Nextion Editor to open and compile — plus an `expected.json`
// with what the compiled .tft must contain, checked afterwards by
// verify-hmi-scenario.mjs. No hardware in the loop.
//
//   node scripts/build-hmi-scenario.mjs hmi-scenarios/d1-02-text-grid.json [--out dir]
//   node scripts/build-hmi-scenario.mjs --all
//
// Scenario file: { name, base, description,
//   addFonts?: [{ fromFixture, entry } | { file }],        .zi files, in font-id order
//   addPictures?: [{ generate: "test-pattern" | "solid" | "checker" | "ramp",
//                    width, height, color?, cell?, ramp?, radius?, background?, dither? }],
//   addPages?: [{ name, attributes?, events?, add?: NewComponentSpec[] }],
//   setEncode?: 24,                                        main.HMI encode byte
//   setOrientation?: 3,                                    main.HMI +0x0C (0 portrait, 1 landscape,
//                                                          2 portrait 180, 3 landscape 180). The
//                                                          NSPanel EU is 3: its Nextion is mounted
//                                                          upside down, and 1 draws every screen
//                                                          half a turn over.
//   setUpver?: [1, 68, 1],                                 stamp the Editor version (kept for
//                                                          experiments; does NOT avoid the
//                                                          conversion/Save As)
//   program?: "...",                                       replaces Program.s
//   lenient?: true,                                       let the Editor judge what our
//                                                          writer would refuse
//   edits: { "<N>.pa": PageEdit } }
// where PageEdit = { changes?: { <objname>: { attributes?, events? } },
// add?: [{ type, objname, x, y, w, h, attributes?, events? }] } and
// attribute values are numbers (little-endian, template width) or strings
// (objname/txt, resized). Requires `npm run build` and the fixtures.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readHmiDirectory, hmiLiveEntries, hmiBlob, readHmiMain, PROJECT_TEXT, encodeHmiText, readHmiComponents, editHmiProject, LENIENT, addHmiPage, addHmiFont, addHmiPicture, setHmiUpver, setHmiEncode, setHmiOrientation, setHmiProgram, setScreenOrientation, KNOWN_LEI, RAM_SLICE_ATTRS, LAYOUT_CHANGERS,
} from "../dist/index.js";
import { testPattern, solid, checker, generated } from "./lib/png.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outDir = args.includes("--out") ? resolve(args[args.indexOf("--out") + 1]) : join(root, "hmi-scenarios", "out");
const files = args.includes("--all")
  ? readdirSync(join(root, "hmi-scenarios")).filter((n) => n.endsWith(".json")).map((n) => join(root, "hmi-scenarios", n))
  : args.filter((a) => !a.startsWith("--") && a !== outDir);
if (files.length === 0) { console.error("usage: build-hmi-scenario.mjs <scenario.json>... | --all [--out dir]"); process.exit(2); }

const typeNames = Object.fromEntries(Object.entries(KNOWN_LEI).map(([k, v]) => [v, k]));

const STRING_ATTRS = new Set(["txt", "path", "dir"]);
/** Attribute values worth recording for the verifier: those with a known
 *  immediate field for the type, txt_maxl (bounds the text), and the ones that
 *  change the block layout. Numbers little-endian, strings without the NUL pad. */
/** What the scenario JSON itself declared for this component (add or changes),
 *  restricted to the verifiable names — so a bug in hmiWrite that the Editor
 *  accepts cannot make expected and compiled agree by construction. */
function declaredAttributes(scenario, entry, objname) {
  const page = scenario.edits?.[entry];
  const added = scenario.addPages?.find((p) => p.entry === entry);
  const spec = page?.add?.find((c) => c.objname === objname) ?? added?.add?.find((c) => c.objname === objname);
  const changed = page?.changes?.[objname];
  const out = {};
  for (const src of [spec?.attributes, changed?.attributes]) {
    if (!src) continue;
    // strings are written to the .HMI as UTF-8; the verifier compares bytes, one code point per byte
    for (const [k, v] of Object.entries(src)) if (typeof v === "number") out[k] = v; else if (typeof v === "string") out[k] = Array.from(encodeHmiText(v), (b) => String.fromCharCode(b)).join("");
  }
  return out;
}

function expectedAttributes(c) {
  const layout = RAM_SLICE_ATTRS[c.type] ?? {};
  const wanted = new Set([...Object.keys(layout), "txt_maxl", "sta", ...(LAYOUT_CHANGERS[c.type] ?? [])]);
  const out = {};
  for (const a of c.attributes) {
    if (!wanted.has(a.name)) continue;
    // text as latin1 code points, one per byte: the .HMI holds the project's
    // encoding, not necessarily UTF-8, and the verifier compares bytes
    if (STRING_ATTRS.has(a.name) && a.name !== "dir") out[a.name] = Array.from(a.value, (b) => String.fromCharCode(b)).join("").replace(/\0+$/, ""); // one code point per byte (TextDecoder("latin1") is windows-1252)
    else { let v = 0; for (let i = a.value.length - 1; i >= 0; i--) v = v * 256 + a.value[i]; out[a.name] = v; }
  }
  return out;
}
mkdirSync(outDir, { recursive: true });

/** Compiled page order is the order of the `.pa` resources declared in main.HMI. */
function pageOrder(file) {
  const live = hmiLiveEntries(readHmiDirectory(file));
  const main = readHmiMain(hmiBlob(file, live.get("main.HMI")));
  return main.resources.filter((r) => r.ext === "pa").map((r) => r.name);
}

function describe(file, scenario) {
  const live = hmiLiveEntries(readHmiDirectory(file));
  return pageOrder(file).map((entry, index) => {
    const comps = readHmiComponents(hmiBlob(file, live.get(entry)));
    return {
      index,
      entry,
      name: comps[0].objname,
      numberobj: comps.length,
      components: comps.slice(1).map((c) => ({
        type: c.type, typeName: typeNames[c.type] ?? String(c.type), id: c.id, objname: c.objname,
        ...(Number.isNaN(c.x) ? {} : { x: c.x, y: c.y, w: c.w, h: c.h }),
        // the values the verifier can locate in the compiled block (attrLayout.ts, RAM slice),
        // plus the ones that decide whether that layout applies
        attributes: { ...expectedAttributes(c), ...declaredAttributes(scenario, entry, c.objname) },
        events: Object.fromEntries(c.events.filter((e) => e.lines.length).map((e) => [e.event, e.lines])),
      })),
    };
  });
}

function buildOne(path) {
  const scenario = JSON.parse(readFileSync(path, "utf8"));
  const basePath = join(root, "fixtures", "cache", scenario.base);
  if (!existsSync(basePath)) { console.error(`${scenario.name}: base fixture missing (${scenario.base}); run npm run fetch-fixtures`); process.exitCode = 1; return; }
  let out = new Uint8Array(readFileSync(basePath));
  // The project's encode byte decides how every txt is turned into bytes: they
  // reach the panel verbatim and the firmware indexes the font by byte, so a
  // UTF-8 string in an encode-3 project shows up as two wrong glyphs (measured
  // on the debugger, d1-09). A scenario that sets encode gets that one; every
  // other one inherits the base project's.
  PROJECT_TEXT.encode = typeof scenario.setEncode === "number"
    ? scenario.setEncode
    : readHmiMain(hmiBlob(out, hmiLiveEntries(readHmiDirectory(out)).get("main.HMI"))).encode;
  const newPages = [];
  // assets first: fonts as .zi files taken from another fixture (or a local file), pictures generated
  for (const f of scenario.addFonts ?? []) {
    let zi;
    if (f.fromFixture) {
      const src = new Uint8Array(readFileSync(join(root, "fixtures", "cache", f.fromFixture)));
      zi = hmiBlob(src, hmiLiveEntries(readHmiDirectory(src)).get(f.entry));
    } else zi = new Uint8Array(readFileSync(resolve(dirname(path), f.file)));
    const r = addHmiFont(out, zi);
    out = r.file;
    newPages.push(`${r.entryName} FONT ${r.id} <- ${f.fromFixture ? `${f.fromFixture}/${f.entry}` : f.file} (${zi.length} bytes)`);
  }
  for (const p of scenario.addPictures ?? []) {
    const gen = {
      "test-pattern": () => testPattern(p.width, p.height),
      solid: () => solid(p.width, p.height, p.color),
      checker: () => checker(p.width, p.height, p.cell),
      // the ones a real project uses: a gradient track, a switch rail and a
      // scrollbar's groove, drawn from the same declaration the React column renders
      ramp: () => generated(p),
      switch: () => generated(p),
      groove: () => generated(p),
    }[p.generate];
    if (!gen) throw new Error(`${scenario.name}: unknown picture source ${p.generate}`);
    const pat = gen();
    const r = addHmiPicture(out, { width: p.width, height: p.height, rgb565: pat.rgb565, png: pat.png });
    out = r.file;
    newPages.push(`${r.entryName} PICTURE ${r.id} ${p.width}x${p.height} ${p.key ?? p.generate} ${r.storage} ${r.ratio.toFixed(3)}`);
  }
  // lenient must be on before any page or component is written
  LENIENT.on = scenario.lenient === true;
  // and so must the screen's orientation: a portrait project places on 320x480,
  // and the on-screen wall (m21/m44) is checked against the panel the right way up
  setScreenOrientation(typeof scenario.setOrientation === "number" ? scenario.setOrientation : 3);
  for (const p of scenario.addPages ?? []) {
    const added = addHmiPage(out, { name: p.name, attributes: p.attributes, events: p.events });
    out = editHmiProject(added.file, { [added.entryName]: { add: p.add ?? [], changes: p.changes } });
    newPages.push(`${added.entryName} "${p.name}" [page ${added.pageIndex}] NEW ${(p.add ?? []).map((a) => `+${a.objname}(${a.type})`).join(" ")}`);
  }
  // Program.s is the project-wide script the Editor runs before any page
  if (typeof scenario.program === "string") { out = setHmiProgram(out, scenario.program); newPages.push(`Program.s <- ${scenario.program.length} bytes`); }
  out = editHmiProject(out, scenario.edits ?? {});
  // A project saved by an older Editor is converted (and left dirty) when the
  // current one opens it, which makes "TFT file output" ask for a Save As and
  // stalls the unattended compile — see setHmiUpver.
  if (scenario.setUpver) { out = setHmiUpver(out, scenario.setUpver); newPages.push(`main.HMI upver <- ${scenario.setUpver.join(".")}`); }
  if (typeof scenario.setEncode === "number") { out = setHmiEncode(out, scenario.setEncode); newPages.push(`main.HMI encode <- ${scenario.setEncode}`); }
  if (typeof scenario.setOrientation === "number") { out = setHmiOrientation(out, scenario.setOrientation); newPages.push(`main.HMI orientation <- ${scenario.setOrientation}`); }
  const dir = readHmiDirectory(out);
  if (!(dir.checksumOk && dir.backupIdentical && dir.sentinelOk && dir.magicOk)) throw new Error(`${scenario.name}: output directory does not verify`);
  const hmiName = `${scenario.name}.HMI`;
  writeFileSync(join(outDir, hmiName), out);
  const expected = {
    scenario: scenario.name,
    description: scenario.description,
    base: scenario.base,
    hmi: hmiName,
    compareTft: scenario.compareTft ?? null,
    builtAt: new Date().toISOString(),
    pages: describe(out, scenario),
  };
  writeFileSync(join(outDir, `${scenario.name}.expected.json`), JSON.stringify(expected, null, 2) + "\n");
  const touched = Object.keys(scenario.edits ?? {}).map((e) => {
    const p = expected.pages.find((x) => x.entry === e);
    const added = scenario.edits[e].add?.map((a) => `+${a.objname}(${a.type})`) ?? [];
    const changed = Object.keys(scenario.edits[e].changes ?? {}).map((n) => `~${n}`);
    return `${e} "${p.name}" [page ${p.index}] ${[...changed, ...added].join(" ")}`;
  });
  console.log(`${scenario.name}: ${basename(hmiName)} (${out.length} bytes) <- ${scenario.base}\n  ${[...newPages, ...touched].join("\n  ")}`);
}

let failed = 0;
for (const path of files) {
  try { buildOne(path); } catch (e) { failed++; console.error(`${path}: ${e.message}`); process.exitCode = 1; }
}
if (failed) console.error(`${failed} scenario(s) not built`);
console.log(`\noutput in ${outDir}`);
