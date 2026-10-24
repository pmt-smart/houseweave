// The list, a zone's screen, Help and the lock, generated from a theme's own screen
// templates, and not typed out by hand in each project.
//
//   node scripts/build-settings-screens.mjs living-room lovelace-jobr99
//   node scripts/build-settings-screens.mjs living-room-shadcn shadcn-dark
//   node scripts/build-settings-screens.mjs living-room-tailwind tailwind-slate
//   node scripts/build-settings-screens.mjs living-room lovelace-jobr99 --check
//
// With --check it writes nothing: it says whether the project still holds what
// the templates generate now, and fails if not. The generated screens live in
// project.json, written out, so a template changed and not run again would
// leave every panel on the old geometry with nothing to say so
// (export/test/templateScreens.test.mjs runs this for every project).
//
// The list is a TEMPLATE: ONE screen, whatever it lists -- a header, a few row slots
// and a scrollbar -- and the runtime fills the rows with whichever page of
// whichever view is showing; Settings is one of those views. A zone's screen
// is the same idea: one page for every zone. The geometry (the
// rail's column, a row's height, how many rows fit) lives ONCE, in
// `layout/src/screenTemplates.ts`, and every theme's `listScreen`/`zoneScreen`/
// `helpScreen`/`lockScreen` (the per-theme thin wrappers in `layout/src/themes/*.ts`) reads
// the same numbers. This script is the one place a project turns that into its
// own `zone`, `settings`, `help` and `lock` screens, for both panels.
//
// WHAT THIS DOES NOT GENERATE: which parameters exist, what each is called
// and what its Help says. That is the project's own `settings.items`
// (schema 10), content the simulator and the compile step both read. Not even
// its length: the list's page count is the runtime's since it lists more than
// Settings, so adding a parameter is one entry there and nothing here.
//
// Built from TypeScript, so `npm run build --workspace=@nspanel-sim/layout`
// has to have run -- the same rule every other script here follows.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lovelaceJobr99, shadcnDark, tailwindSlate } from "../../layout/dist/index.js";
import { DEVICE_VISIBLE, parseProject } from "../../core/dist/index.js";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(scriptsDir, "../..");

const THEME_TEMPLATES = {
  "lovelace-jobr99": lovelaceJobr99,
  "shadcn-dark": shadcnDark,
  "tailwind-slate": tailwindSlate,
};

const check = process.argv.includes("--check");
const [projectId, theme] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!projectId || !theme) {
  console.error("usage: node build-settings-screens.mjs <project-id> <theme> [--check]");
  process.exit(2);
}
const templates = THEME_TEMPLATES[theme];
if (!templates) throw new Error(`no screen templates for theme "${theme}" (known: ${Object.keys(THEME_TEMPLATES).join(", ")})`);

const file = resolve(workspace, "projects", projectId, "project.json");
const doc = JSON.parse(readFileSync(file, "utf8"));
// through the parser, so a malformed project is refused here with the same
// message the simulator gives, not discovered as a blank row on the glass
parseProject(doc, `projects/${projectId}/project.json`);

// Any list, zone, Help or lock screen, from before the template (settings-1,
// settings-2, help-1) or from it (settings, zone, help, lock): all replaced by
// what is generated now.
// and the short list: the paged list's twin for a view of one page,
// and the tall list, the US portrait's for the Wireless settings,
// and the QR's page, the Hotspot's and the Web setup's
// and the blind's page, and the lamp's detail, with the row under its title
// and the house's page, its screens under its icons
// and the safeboot's page, which the safeboot image draws and no runtime of the app writes to
const isSettingsOrHelp = (s) => /^(light-detail|settings|house|mesh|confirm|qr|help|zone|thermostat|cover|lock|safeboot)(-\d+)?$/.test(s.id);

let touched = 0;
for (const [device, layout] of Object.entries(doc.layouts)) {
  // The VISIBLE area, not the raw Nextion grid: the EU housing hides its 30
  // rightmost columns (devices.ts), so a template that placed
  // content against the full 480 would run behind the bezel on that one
  // panel while looking fine on the two that show their whole grid.
  const grid = DEVICE_VISIBLE[device];
  if (!grid) continue;
  if (!layout.screens.some(isSettingsOrHelp)) {
    console.log(`${projectId} [${device}]: no Settings screen, leaving screens as they are`);
    continue;
  }
  // Splice the generated screens back in where the first removed one was --
  // counted in `kept`, the array that gets sliced, not in the original.
  const kept = layout.screens.filter((s) => !isSettingsOrHelp(s));
  const firstRemoved = layout.screens.findIndex(isSettingsOrHelp);
  const at = layout.screens.slice(0, firstRemoved).filter((s) => !isSettingsOrHelp(s)).length;
  // One list, its rows the value under the name, on both layouts, and the house's rows the same: the US portrait's
  // (one look for every list, the Wireless settings', and the bytes of the old one back), and the EU landscape's
  // the same day. The flush list and its short twin are gone.
  const generated = [
    templates.lightDetailScreen(grid), templates.zoneScreen(grid), templates.thermostatScreen(grid), templates.coverScreen(grid), templates.listScreen(grid),
    templates.houseScreen(grid), templates.meshScreen(grid), templates.dialogScreen(grid), templates.qrScreen(grid), templates.helpScreen(grid), templates.lockScreen(grid),
    templates.safebootScreen(grid),
  ];
  layout.screens = [...kept.slice(0, at), ...generated, ...kept.slice(at)];
  // anything that still points at a page of the old paginated screens
  for (const s of layout.screens)
    for (const dir of Object.keys(s.swipe ?? {}))
      if (/^settings(-\d+)?$/.test(s.swipe[dir])) s.swipe[dir] = "settings";
  touched++;
  const count = (screen) => screen.place.filter((p) => p.component.endsWith("/list-row") && p.variant !== "button").length;
  console.log(`${projectId} [${device}]: lamp detail + zone (${count(generated[1]) - 1} device rows) + thermostat + blind + list (${count(generated[4])} rows) + house + mesh + confirmation + QR + help + lock + safeboot`);
}

if (check) {
  // the same document the file holds, key for key, or a drift
  const held = JSON.stringify(JSON.parse(readFileSync(file, "utf8")));
  if (held !== JSON.stringify(doc)) {
    console.error(`${projectId}: project.json does not hold what the templates generate now -- run node scripts/build-settings-screens.mjs ${projectId} ${theme}`);
    process.exit(1);
  }
  console.log(`${projectId}: the template screens are what the templates generate`);
} else if (touched > 0) writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
