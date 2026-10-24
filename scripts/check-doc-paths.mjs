// Every source path the documentation names, checked against the repository.
//
// `check-doc-links.mjs` checks links between documents; this checks the other
// kind of rot, which is worse because it reads as fact: a chapter that names
// `screens/donor/HomeDonor.tsx` after that file was deleted is not a broken
// link, it is a wrong description of the system. The sweep that produced this
// script found ten such paths in one chapter alone.
//
//   node scripts/check-doc-paths.mjs
//
// Only paths inside backticks that end in a source extension are considered,
// and they are looked for under the handful of roots the docs write paths
// relative to. IGNORED holds the ones that are legitimately not files here:
// upstream Tasmota, the vendored reference projects, and generic names used as
// examples rather than as references.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = [
  "", "libs/nspanel-sim/", "libs/nspanel-sim/ui/", "libs/nspanel-sim/ui/src/",
  "libs/nspanel-sim/ui/src/components/", "libs/nspanel-sim/sim/", "libs/nspanel-sim/sim/src/",
  "libs/nspanel-sim/core/", "libs/nspanel-sim/core/src/", "libs/nspanel-sim/export/",
  "libs/nspanel-sim/export/src/", "libs/nspanel-sim/export/scripts/", "libs/nspanel-sim/export/test/",
  "libs/nspanel-sim/themes/", "libs/nspanel-sim/vm/test/", "libs/nspanel-sim/vm/scripts/",
  "berry/", "scripts/", "reference/", "reference/joBr99/",
  "firmware/", "firmware/tasmota/", "firmware/tasmota/pio-tools/", "firmware/overrides/",
  // every theme's own directory and its fonts/, derived rather than listed: a
  // hardcoded "themes/lovelace-jobr99/fonts/" went stale the moment a second
  // theme arrived, and a checker that rots is worse than none
  ...themeRoots(),
];

function themeRoots() {
  const base = "libs/nspanel-sim/themes";
  if (!existsSync(join(root, base))) return [];
  return readdirSync(join(root, base), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => [`${base}/${d.name}/`, `${base}/${d.name}/fonts/`]);
}

/** Not files in this repository, and not meant to be. */
const IGNORED = new Set([
  // generic names used as examples, not as references
  "project.json", "theme.json",
  // files that live on a device or on the house's server, not in the repository: a node's saved configuration, the releases' index, the
  // house the server is paired with
  "_persist.json", "index.json", "house.json",
]);
const RE = /`([A-Za-z0-9_./-]+\.(?:ts|tsx|mjs|be|json|zi|py|s|ino|h|cpp|c|ini|ps1|csv|md|yaml|yml))`/g;

// The firmware's files (the drivers, their headers, the build's .ini and .ps1) and the documents are named in the docs by their own name, and the
// docs write them relative to a dozen places (the driver directory, the core's include, the host test, the fork's libraries): a name of these kinds is
// found when a file of the repository, the fork's included, ends with it. The kinds above keep the roots of ROOTS, which is stricter.
const BY_NAME = /\.(?:ino|h|cpp|c|ini|ps1|csv|md|yaml|yml)$/;
const SKIPPED_DIRS = new Set([".git", "node_modules", "dist", ".pio", ".build", "releases", "bench", "scratch", ".tools", ".claude"]);

/** every file of the repository by its path from the root, with the directories nothing of the sources is in left out */
function files() {
  const out = [];
  const walk = (dir, rel) => {
    for (const d of readdirSync(join(dir), { withFileTypes: true })) {
      if (d.isDirectory()) {
        if (!SKIPPED_DIRS.has(d.name)) walk(join(dir, d.name), `${rel}${d.name}/`);
      } else if (BY_NAME.test(d.name)) {
        out.push(`${rel}${d.name}`);
      }
    }
  };
  walk(root, "");
  return out;
}

let bad = 0;
const known = files();
// The journal is a LOG, not a description: an entry that says a file existed on
// the day it existed is correct, and rewriting it to match today would be
// falsifying the record. Corrections there are dated, not applied in place.
const HISTORY = new Set(["00-journal.md"]);

for (const file of readdirSync(join(root, "docs")).filter((n) => n.endsWith(".md") && !HISTORY.has(n)).sort()) {
  const text = readFileSync(join(root, "docs", file), "utf8");
  const missing = new Set();
  for (const m of text.matchAll(RE)) {
    const p = m[1];
    if (IGNORED.has(p) || IGNORED.has(p.split("/").pop())) continue;
    if (ROOTS.some((r) => existsSync(join(root, r + p)))) continue;
    if (BY_NAME.test(p) && known.some((f) => f === p || f.endsWith(`/${p}`))) continue;
    missing.add(p);
  }
  if (missing.size) {
    console.log(`${file}`);
    for (const p of [...missing].sort()) console.log(`  ${p}`);
    bad += missing.size;
  }
}
console.log(bad ? `\n${bad} path(s) named in the docs that are not in the repository` : "every source path the docs name exists");
if (bad) process.exitCode = 1;
