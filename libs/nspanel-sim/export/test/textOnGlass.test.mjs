// What a Text shows on the glass, checked on the scenarios the projects compile
// to (`hmi-scenarios/p1-*.json`, written by build-project-hmi.mjs), not on the
// React tree -- the simulator draws text in the browser's font, 25-28 % wider
// than the panel's `.zi` (measured), so a check made by eye there is
// a check of something else.
//
// Two rules, both from the way a Nextion page is drawn:
//
//   1. Nothing drawn AFTER a Text may cross its box. Components are painted in
//      id order and every one of them paints its whole box -- a Text in its
//      background colour too, not only where its glyphs are. A header's icon
//      that reached 20 px into the title's box would paint over the end of the
//      title: invisibly where its background is the page's, and as a square in
//      the themes whose buttons are filled.
//   2. The text compiled into a Text or a Button fits its box, in the font that
//      box names. What does not fit is cut at the box edge, mid-letter, and
//      nothing says so.
//
// The slots whose text arrives at run time are the generator's business: it
// sizes them and refuses a Settings label that does not fit (`slotCapacity`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readZi, layoutZiText } from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scenarios = join(root, "hmi-scenarios");
// p1-guard-* are buildProjectGuards' throwaway builds, written and deleted while
// this runs beside it: half written at the moment of the scan, and not what ships
const shipped = readdirSync(scenarios).filter((f) => /^p1-.*\.json$/.test(f) && !f.endsWith(".runtime.json") && !f.startsWith("p1-guard-"));

/** Components that draw nothing: they cannot cover anything. */
const INVISIBLE = new Set(["Hotspot", "Touchcap", "Timer", "Vari"]);

const pagesOf = (doc) => [
  { name: doc.edits?.["0.pa"]?.changes?.page0?.attributes?.objname ?? "page0", add: doc.edits?.["0.pa"]?.add ?? [] },
  ...(doc.addPages ?? []),
];
const crosses = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("the projects compile to at least one scenario each", () => {
  // otherwise the two tests below pass by looking at nothing
  assert.ok(shipped.length >= 6, `only ${shipped.join(", ")}`);
});

/**
 * What the runtime shows and hides, by page and component: the path of each `vis` binding. Two components hidden under
 * different paths take turns in their place (project schema 14, `alternate`), which the project's own check allows only
 * when both are hideable: the one hidden paints nothing, and crosses nothing (the safeboot's page).
 */
function visPaths(file) {
  const runtime = join(scenarios, file.replace(/(\.stamped)?\.json$/, ".runtime.json"));
  const paths = new Map();
  try {
    for (const b of JSON.parse(readFileSync(runtime, "utf8")).bindings ?? [])
      if (b.kind === "vis") paths.set(`${b.page}.${b.objname}`, b.path);
  } catch {
    // a scenario without its manifest: every crossing counts
  }
  return paths;
}

test("nothing drawn after a Text crosses its box", () => {
  const found = [];
  for (const file of shipped) {
    const doc = JSON.parse(readFileSync(join(scenarios, file), "utf8"));
    const vis = visPaths(file);
    for (const page of pagesOf(doc)) {
      const turns = (a, b) => {
        const pa = vis.get(`${page.name}.${a.objname}`), pb = vis.get(`${page.name}.${b.objname}`);
        return pa !== undefined && pb !== undefined && pa !== pb;
      };
      page.add.forEach((text, i) => {
        if (text.type !== "Text") return;
        for (const later of page.add.slice(i + 1)) {
          if (INVISIBLE.has(later.type) || later.w === undefined) continue;
          if (crosses(text, later) && !turns(text, later)) found.push(`${file} ${page.name}: ${text.objname} (${text.x}+${text.w}) is painted over by ${later.type} ${later.objname} (${later.x}+${later.w})`);
        }
      });
    }
  }
  assert.deepEqual(found, []);
});

test("the text compiled into every Text and Button fits its box in its own font", () => {
  const found = [];
  for (const file of shipped) {
    const doc = JSON.parse(readFileSync(join(scenarios, file), "utf8"));
    const fonts = (doc.addFonts ?? []).map((f) => readZi(new Uint8Array(readFileSync(resolve(scenarios, f.file)))));
    for (const page of pagesOf(doc)) {
      for (const c of page.add) {
        if (c.type !== "Text" && c.type !== "Button") continue;
        const txt = c.attributes?.txt;
        if (typeof txt !== "string" || txt === "") continue;
        const font = fonts[c.attributes.font ?? 0];
        assert.ok(font, `${file} ${page.name}.${c.objname}: font ${c.attributes.font} is not in the scenario`);
        const { advance, missing } = layoutZiText(font, txt);
        if (missing.length) found.push(`${file} ${page.name}.${c.objname}: ${JSON.stringify(txt)} has characters its font does not carry`);
        else if (advance > c.w) found.push(`${file} ${page.name}.${c.objname}: ${JSON.stringify(txt)} is ${advance} px in a ${c.w} px box`);
      }
    }
  }
  assert.deepEqual(found, []);
});
