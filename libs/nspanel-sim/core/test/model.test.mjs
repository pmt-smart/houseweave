// The domain model against the real documents in the repository, plus the
// refusals. A refusal is an interface here: what is asserted is not
// only THAT a bad document fails, but that the issue says where, which rule, and
// whose rule it is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseTheme, tryParseTheme, parseProject, tryParseProject,
  checkProjectAgainstThemes, checkPlacements, projectComponents, themesUsed, ValidationError,
  THEME_SCHEMA_VERSION, PROJECT_SCHEMA_VERSION, RGB565_MAX, REQUIRED_COLOR_TOKENS, REQUIRED_DEVICES,
  DRAWING_RULES, PLAN_TOP, PLAN_COLOR_TOKENS, PLAN_ICON_TOKENS, PLAN_ICON_CONTRAST, planColors, contrastRatio,
} from "../dist/index.js";
import { LAYOUTS } from "@nspanel-sim/layout";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const readJson = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));


// Schema 4 keeps a layout PER PANEL, so a test that wants "the screens" has to
// say which panel's. Everything here works on the EU one, because that is the
// panel every project in the repository has actually been drawn for.
const EU = "eu-landscape";
const euScreens = (project) => project.layouts.find((l) => l.device === EU)?.screens ?? [];
/** the same project with the EU layout replaced, the US one left as it is */
const withScreens = (project, screens) => ({
  ...project,
  layouts: project.layouts.map((l) => (l.device === EU ? { ...l, screens } : l)),
});
/**
 * The same raw JSON with the EU layout replaced, for the parse-level tests.
 *
 * `editor` goes with the screens: it NAMES one of them (schema 9), so a layout
 * given a different set of screens has no editor -- and leaving the
 * old name behind would make every one of these fixtures fail on a rule that
 * has nothing to do with what they are testing.
 */
const rawWithScreens = (raw, screens) => ({
  ...raw,
  layouts: { ...raw.layouts, [EU]: { ...raw.layouts[EU], screens, editor: undefined } },
});

const DS_PATH = "themes/lovelace-jobr99/theme.json";
const PROJECT_PATH = "projects/living-room/project.json";

test("the theme in the repository parses", () => {
  const ds = parseTheme(readJson(DS_PATH), DS_PATH);
  assert.equal(ds.id, "lovelace-jobr99");
  assert.equal(ds.schemaVersion, THEME_SCHEMA_VERSION);
  assert.ok(ds.colors.length >= 9);
  assert.ok(ds.fonts.length >= 3);
  assert.ok(ds.components.length >= 8);
  for (const c of ds.colors) assert.ok(c.rgb565 >= 0 && c.rgb565 <= RGB565_MAX, c.id);
  // Every colour of THIS theme is measured, and that is the whole claim
  // it makes: it says it is joBr99's UI as he ships it, so its colours are read
  // out of his compiled pages, not eyeballed from screenshots (his text is pure
  // white, his accent is #00aaf7, his cards have no fill and no border).
  // The exceptions say so: a colour for something his system does not have
  // (the plan's card fill, and its unlit icons lifted to stand
  // 3:1 over that card, and the warm tone of a thermostat that is heating, his UI has no thermostat; and the green of a blind all the way up, nor a
  // blind; and the three colours of a signal by its dBm)
  // is "ours", never passed off as his.
  assert.ok(ds.colors.every((c) => c.provenance === "exact" || c.provenance === "ours"), "a colour of joBr99's system that is not measured");
  assert.deepEqual(ds.colors.filter((c) => c.provenance === "ours").map((c) => c.id),
    ["plan-card", "signal-good", "signal-fair", "signal-poor", "icon-heating", "icon-open", "plan-icon-off", "plan-icon-no-answer", "plan-icon-no-power", "plan-icon-heating", "plan-icon-open", "pressed"]);
  for (const c of ds.colors) assert.ok(c.origin.length > 20, `${c.id} cites no source`);
  // the three the firmware itself sends, as a spot check on the numbers
  const byId = Object.fromEntries(ds.colors.map((c) => [c.id, c.rgb565]));
  assert.equal(byId.background, 6371, "ha-dark, mqtt-manager/panel.py");
  assert.equal(byId["icon-off"], 17299, "default_color_off [68,115,158]");
  assert.equal(byId["icon-low-sat"], 65222, "default_color_on [253,216,53]");
  assert.equal(byId["text-primary"], 65535, "pure white, the pco of every Text he compiles");
  assert.equal(byId["background-screensaver"], 0, "his screensaver is black, not ha-dark");
});

test("the project in the repository parses and agrees with its theme", () => {
  const ds = parseTheme(readJson(DS_PATH), DS_PATH);
  const project = parseProject(readJson(PROJECT_PATH), PROJECT_PATH);
  assert.equal(project.id, "living-room");
  assert.equal(project.schemaVersion, PROJECT_SCHEMA_VERSION);
  // both panels are declared, and the EU one is the one drawn so far
  assert.deepEqual(project.layouts.map((l) => l.device), ["eu-landscape", "us-portrait"]);
  assert.ok(euScreens(project).length >= 1);
  assert.doesNotThrow(() => checkProjectAgainstThemes(project, [ds]));
  assert.ok(projectComponents(project, [ds]).length >= 8);
});

test("a document written for a newer schema is refused, not guessed at", () => {
  const doc = { ...readJson(PROJECT_PATH), schemaVersion: PROJECT_SCHEMA_VERSION + 1 };
  const r = tryParseProject(doc);
  assert.equal(r.ok, false);
  assert.ok(r.error.issues.some((i) => i.rule === "schema-too-new"));
});

test("a placement's render.dither: auto when omitted, forced when said, refused when nonsense (schema 6)", () => {
  const doc = readJson(PROJECT_PATH);
  const place = doc.layouts["eu-landscape"].screens[0].place;
  assert.ok(place.length >= 2);
  place[0].render = { dither: false };
  place[1].render = { dither: true };
  const r = tryParseProject(doc);
  assert.ok(r.ok, JSON.stringify(r.ok ? null : r.error.issues));
  const parsed = euScreens(r.value)[0].place;
  assert.equal(parsed[0].render.dither, false);
  assert.equal(parsed[1].render.dither, true);
  // omitted means auto -- the layout decides by whether RGB565 would band
  assert.ok(parsed.slice(2).every((p) => p.render.dither === "auto"));
  place[0].render = { dither: "always" };
  const bad = tryParseProject(doc);
  assert.equal(bad.ok, false);
  assert.ok(bad.error.issues.some((i) => i.rule === "bad-render" && /dither$/.test(i.path)), JSON.stringify(bad.error.issues));
});

test("a layout's editor (schema 9): which keyboard opens, and the two ways of naming it wrong", () => {
  // The panel carries two keyboards and a key on each jumps to the other; which
  // one the finger STARTS on is the layout's to say, not an ordering accident.
  const doc = readJson(PROJECT_PATH);
  const eu = doc.layouts["eu-landscape"];
  const r = tryParseProject(doc);
  assert.ok(r.ok, JSON.stringify(r.ok ? null : r.error.issues));
  const parsed = r.value.layouts.find((l) => l.device === "eu-landscape");
  assert.equal(parsed.editor, eu.editor);
  assert.ok(parsed.screens.some((s) => s.id === parsed.editor), "the editor is a screen of this layout");

  // absent is legal: it means the first keyboard the layout declares, which is
  // what the generator did before a project could say otherwise
  delete doc.layouts["eu-landscape"].editor;
  assert.equal(tryParseProject(doc).ok, true);

  // a screen that is not there
  doc.layouts["eu-landscape"].editor = "nowhere";
  const bad = tryParseProject(doc);
  assert.equal(bad.ok, false);
  assert.ok(bad.error.issues.some((i) => i.rule === "unknown-screen" && i.path.endsWith("editor")), JSON.stringify(bad.error.issues));

  // and a screen that IS there but has no keyboard on it -- layer 3's, because
  // only there is a component id more than a string
  doc.layouts["eu-landscape"].editor = "home";
  const r2 = tryParseProject(doc);
  assert.ok(r2.ok, "naming a real screen parses; whether it is an editor is the next layer's question");
  assert.throws(() => checkPlacements(r2.value, themesOnDisk()), (e) =>
    e.issues.some((i) => i.rule === "not-an-editor"), "a screen with no keyboard is not an editor");
});

test("the Settings list (schema 10): the project's own, its limits, and a blank Help line is content", () => {
  // Settings is a template: one page, a few row slots, and this list paged
  // through them at run time. The list is what both runtimes read, so it is
  // validated here, once, and never discovered as a blank row on the glass.
  const doc = readJson(PROJECT_PATH);
  const r = tryParseProject(doc);
  assert.ok(r.ok, JSON.stringify(r.ok ? null : r.error.issues));
  assert.ok(r.value.settings.items.length > 0, "the repository's project lists its settings");
  assert.ok(r.value.settings.items.some((item) => item.help.includes("")), "a blank line separates two thoughts in Help");

  // absent is legal and means an empty list: a project without Settings
  const none = { ...readJson(PROJECT_PATH) };
  delete none.settings;
  assert.deepEqual(tryParseProject(none).value.settings, { items: [] });

  const bad = (items) => {
    const d = readJson(PROJECT_PATH);
    d.settings = { items };
    const out = tryParseProject(d);
    assert.equal(out.ok, false);
    return out.error.issues;
  };
  // two items flipping the same preference would be two rows that are one
  assert.ok(bad([{ label: "A", key: "same" }, { label: "B", key: "same" }]).some((i) => i.path.startsWith("settings/items")));
  // a key the runtimes look up by name
  assert.ok(bad([{ label: "A", key: "Not-A-Key" }]).some((i) => i.path.endsWith("key")));
  // Help carries five lines, and a label is also Help's title
  assert.ok(bad([{ label: "A", key: "a", help: ["1", "2", "3", "4", "5", "6"] }]).some((i) => i.rule === "too-many-lines"));
  assert.ok(bad([{ label: "x".repeat(27), key: "a" }]).some((i) => i.path.endsWith("label")));
});

test("a placement's input.live and a screen's tap (schema 7): defaults, values, and a tap to nowhere refused", () => {
  const doc = readJson(PROJECT_PATH);
  const screens = doc.layouts["eu-landscape"].screens;
  const detail = screens.find((s) => s.id === "light-detail");
  const sliders = detail.place.filter((p) => p.component.endsWith("/gradient-slider"));
  assert.equal(sliders.length, 3);
  // the repository pins the brightness rail live and leaves the others to the panel's setting
  const r = tryParseProject(doc);
  assert.ok(r.ok, JSON.stringify(r.ok ? null : r.error.issues));
  const parsed = euScreens(r.value).find((s) => s.id === "light-detail").place.filter((p) => p.componentId === "gradient-slider");
  assert.deepEqual(parsed.map((p) => p.input.live), [true, "auto", "auto"]);
  // the screensaver leaves on a tap, to a screen of this layout
  assert.equal(euScreens(r.value).find((s) => s.id === "screensaver").tap, "home");
  // a tap to a screen that is not there is refused, and says which screens are
  screens.find((s) => s.id === "screensaver").tap = "nowhere";
  const bad = tryParseProject(doc);
  assert.equal(bad.ok, false);
  const issue = bad.error.issues.find((i) => i.rule === "unknown-screen");
  assert.ok(issue, JSON.stringify(bad.error.issues));
  assert.match(issue.want, /home/);
  // and a live value that is neither auto nor boolean is refused where it sits
  screens.find((s) => s.id === "screensaver").tap = "home";
  sliders[1].input = { live: "sometimes" };
  const bad2 = tryParseProject(doc);
  assert.equal(bad2.ok, false);
  assert.ok(bad2.error.issues.some((i) => i.rule === "bad-input" && /live$/.test(i.path)), JSON.stringify(bad2.error.issues));
});

test("an issue says where, which rule, and whose rule", () => {
  const doc = readJson(DS_PATH);
  doc.colors = [...doc.colors, { id: "too-bright", rgb565: 70000, provenance: "exact", origin: "invented", use: ["nothing"] }];
  const r = tryParseTheme(doc);
  assert.equal(r.ok, false);
  const issue = r.error.issues.find((i) => i.rule === "above-maximum");
  assert.ok(issue, "expected the colour to be refused");
  assert.match(issue.path, /^colors\/\d+\/rgb565$/);
  // the panel is RGB565: this is the hardware's limit, not a taste of ours, and
  // the message has to say so or nobody can tell whether it is negotiable
  assert.equal(issue.source, "hardware");
  assert.ok(issue.measuredIn);
  assert.match(r.error.message, /hardware/);
});

test("a component may not use a primitive its theme does not admit", () => {
  const doc = readJson(DS_PATH);
  doc.components = [...doc.components, { id: "chart", render: "ChartView", primitives: ["Curve"], notes: "" }];
  const r = tryParseTheme(doc);
  assert.equal(r.ok, false);
  const issue = r.error.issues.find((i) => i.rule === "primitive-not-allowed");
  assert.ok(issue);
  assert.equal(issue.source, "ours", "being stricter than the Editor is OUR rule, and must be labelled as such");
  assert.match(issue.message, /does not admit/);
});

test("a primitive the Editor has no component for is a different failure", () => {
  const doc = readJson(DS_PATH);
  doc.rules.allowedPrimitives = [...doc.rules.allowedPrimitives, "Sparkline"];
  const r = tryParseTheme(doc);
  assert.equal(r.ok, false);
  const issue = r.error.issues.find((i) => i.rule === "unknown-primitive");
  assert.ok(issue);
  assert.equal(issue.source, "editor");
});

test("a touch target below the theme's own floor is refused", () => {
  const doc = readJson(DS_PATH);
  doc.components = doc.components.map((c) => (c.id === "light-card" ? { ...c, minTouchMm: { w: 5, h: 5 } } : c));
  const r = tryParseTheme(doc);
  assert.equal(r.ok, false);
  assert.ok(r.error.issues.some((i) => i.rule === "below-theme-floor"));
});

test("duplicate ids are caught, and the message points at the first one", () => {
  const doc = readJson(DS_PATH);
  doc.colors = [...doc.colors, doc.colors[0]];
  const r = tryParseTheme(doc);
  assert.equal(r.ok, false);
  const issue = r.error.issues.find((i) => i.rule === "duplicate-id");
  assert.ok(issue);
  assert.match(issue.message, /already used at index 0/);
});

test("a project naming a theme nobody loaded is refused with the list", () => {
  const ds = parseTheme(readJson(DS_PATH), DS_PATH);
  const project = { ...parseProject(readJson(PROJECT_PATH), PROJECT_PATH), themes: ["ghost"] };
  try {
    checkProjectAgainstThemes(project, [ds]);
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(e instanceof ValidationError);
    const issue = e.issues.find((i) => i.rule === "unknown-theme");
    assert.ok(issue);
    assert.equal(issue.want, "lovelace-jobr99");
  }
});

test("a placement of a component the theme does not offer is refused", () => {
  const ds = parseTheme(readJson(DS_PATH), DS_PATH);
  const base = parseProject(readJson(PROJECT_PATH), PROJECT_PATH);
  const place = [{ component: "lovelace-jobr99/nonexistent", theme: "lovelace-jobr99", componentId: "nonexistent", x: 0, y: 0, w: 10, h: 10, bind: {} }];
  const project = withScreens(base, [{ id: "x", title: "X", place }]);
  assert.throws(() => checkProjectAgainstThemes(project, [ds]), /unknown-component/);
});

test("a placement may only use a theme the project declares", () => {
  // This is the rule that makes mixing safe rather than loose: a screen can take
  // a header from another theme, but only from one the project put on
  // the table -- otherwise a project would pull in a whole system by accident
  // and carry its fonts to the panel.
  const ds = parseTheme(readJson(DS_PATH), DS_PATH);
  const base = parseProject(readJson(PROJECT_PATH), PROJECT_PATH);
  const place = [{ component: "someone-else/clock", theme: "someone-else", componentId: "clock", x: 0, y: 0, w: 10, h: 10, bind: {} }];
  const project = withScreens(base, [{ id: "x", title: "X", place }]);
  assert.throws(() => checkProjectAgainstThemes(project, [ds]), /undeclared-theme/);
});

test("a box that runs off the panel's grid is refused, the way the Editor refuses it", () => {
  const raw = JSON.parse(readFileSync(join(root, PROJECT_PATH), "utf8"));
  raw.layouts["eu-landscape"].screens[0].place[0].x = 470;
  raw.layouts["eu-landscape"].screens[0].place[0].w = 40; // 470 + 40 > 480
  try {
    parseProject(raw, PROJECT_PATH);
    assert.fail("should have thrown");
  } catch (e) {
    const issue = e.issues.find((i) => i.rule === "off-screen");
    assert.ok(issue, `expected off-screen, got ${e.issues.map((i) => i.rule).join(", ")}`);
    assert.equal(issue.source, "editor");
    assert.match(issue.measuredIn, /Position Invalid/);
  }
});

test("the model takes a placement from a second declared theme", () => {
  // Mixing is free: a
  // project is born of a theme and may take components of others, the
  // `<theme>/<component>` address. No shipped project mixes, so it is exercised
  // on a copy: the Tailwind project with a shadcn header. The compile step resolves each placement in
  // its own theme (export/test/buildProjectGuards.test.mjs).
  const doc = readJson("projects/living-room-tailwind/project.json");
  doc.themes = ["tailwind-slate", "shadcn-dark"];
  const home = doc.layouts["eu-landscape"].screens.find((s) => s.id === "home");
  home.place.find((p) => p.component.endsWith("/nav-header")).component = "shadcn-dark/nav-header";
  const project = parseProject(doc, "living-room-tailwind");
  const used = themesUsed(project);
  assert.equal(used.length, 2, `the copy uses only ${used.join(", ")}`);
  for (const ds of used) assert.ok(project.themes.includes(ds), `${ds} is placed but not declared`);
});

test("every problem is reported at once, not one per run", () => {
  const r = tryParseProject({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "BAD ID", name: "", themes: [],
    layouts: { watch: { screens: [] } },
  });
  assert.equal(r.ok, false);
  assert.ok(r.error.issues.length >= 4, `only ${r.error.issues.length} issues: ${r.error.message}`);
  const rules = new Set(r.error.issues.map((i) => i.rule));
  assert.ok(rules.has("bad-format"), "the id");
  assert.ok(rules.has("too-few"), "no themes");
  assert.ok(rules.has("unknown-device"), "there is no panel called watch");
  // and both required panels missing, reported as two, not as one summary
  assert.equal(r.error.issues.filter((i) => i.rule === "panel-not-declared").length, 2);
});

test("a theme derived from a web palette says its colours are approximations", () => {
  // The counterpart: shadcn and Tailwind are web hex quantised to RGB565 and
  // never measured on glass, and claiming otherwise would be the worse lie.
  // Provenance is only worth carrying if both values actually occur.
  const derived = themesOnDisk().filter((d) => d.id !== "lovelace-jobr99");
  assert.ok(derived.length > 0, "no derived theme to check");
  for (const ds of derived)
    assert.ok(ds.colors.every((c) => c.provenance === "approximate"), `${ds.id} claims a measured colour it cannot have`);
});

test("a theme that does not name a colour the renderers paint with is refused", () => {
  // The restrictive side of the funnel. Without this the document parses, the
  // simulator draws, and the missing slot silently comes from ANOTHER design
  // system's palette -- a preview that is not the theme it claims.
  const raw = JSON.parse(readFileSync(join(root, DS_PATH), "utf8"));
  raw.colors = raw.colors.filter((c) => c.id !== "text-primary" && c.id !== "icon-off");
  try {
    parseTheme(raw, DS_PATH);
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(e instanceof ValidationError);
    const issue = e.issues.find((i) => i.rule === "missing-colour-token");
    assert.ok(issue, `expected a missing-colour-token issue, got ${e.issues.map((i) => i.rule).join(", ")}`);
    assert.equal(issue.source, "ours");
    assert.match(issue.got, /text-primary/);
    assert.match(issue.got, /icon-off/);
  }
  // and the untouched document still passes, so the rule is not just always-fail
  assert.ok(parseTheme(JSON.parse(readFileSync(join(root, DS_PATH), "utf8")), DS_PATH));
});

test("every theme on disk names every required colour", () => {
  // The rule applied to the content, not only to a synthetic mutation: adding a
  // theme that forgets one has to fail here, not on someone's screen.
  for (const dir of readdirSync(join(root, "themes"), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const path = join("themes", dir.name, "theme.json");
    if (!existsSync(join(root, path))) continue;
    const ds = parseTheme(JSON.parse(readFileSync(join(root, path), "utf8")), path);
    const named = new Set(ds.colors.map((c) => c.id));
    assert.deepEqual(REQUIRED_COLOR_TOKENS.filter((t) => !named.has(t)), [], `${dir.name} is missing colours`);
  }
});

test("a theme that leaves an icon role unfilled is refused", () => {
  // Roles and not icon names, because "the drawing that means the light is on"
  // is exactly what a theme decides. One left unfilled means a screen
  // with nothing to draw, so it is a refusal and not a fallback.
  const raw = JSON.parse(readFileSync(join(root, DS_PATH), "utf8"));
  delete raw.icons.roles.lightOn;
  delete raw.icons.roles.colorTemp;
  try {
    parseTheme(raw, DS_PATH);
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(e instanceof ValidationError);
    const issue = e.issues.find((i) => i.rule === "missing-icon-role");
    assert.ok(issue, `expected missing-icon-role, got ${e.issues.map((i) => i.rule).join(", ")}`);
    assert.match(issue.got, /lightOn/);
    assert.match(issue.got, /colorTemp/);
  }
});

test("an icon role no screen asks for is refused too, because its glyph would be carried and never drawn", () => {
  const raw = JSON.parse(readFileSync(join(root, DS_PATH), "utf8"));
  raw.icons.roles.somethingNobodyDraws = "lightbulb";
  try {
    parseTheme(raw, DS_PATH);
    assert.fail("should have thrown");
  } catch (e) {
    const issue = e.issues.find((i) => i.rule === "unknown-icon-role");
    assert.ok(issue, `expected unknown-icon-role, got ${e.issues.map((i) => i.rule).join(", ")}`);
    assert.match(issue.got, /somethingNobodyDraws/);
  }
});

test("the icons have to live in a font the theme declares", () => {
  const raw = JSON.parse(readFileSync(join(root, DS_PATH), "utf8"));
  raw.icons.fonts = ["a-font-that-is-not-there"];
  try {
    parseTheme(raw, DS_PATH);
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(e.issues.some((i) => i.rule === "unknown-font"), e.issues.map((i) => i.rule).join(", "));
  }
});

test("the style tokens are read, and a radius nobody could want is refused", () => {
  const ds = parseTheme(readJson(DS_PATH), DS_PATH);
  assert.equal(typeof ds.style.radius, "number");
  assert.ok(["plain", "outlined", "filled"].includes(ds.style.cardStyle));
  assert.ok(ds.style.iconScale > 0 && ds.style.iconScale <= 1);

  const raw = JSON.parse(readFileSync(join(root, DS_PATH), "utf8"));
  raw.style.radius = 120; // on a 480x320 screen this is not a design choice
  raw.style.cardStyle = "shadow";
  try {
    parseTheme(raw, DS_PATH);
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(e.issues.some((i) => i.rule === "above-maximum"), e.issues.map((i) => i.rule).join(", "));
    assert.ok(e.issues.some((i) => i.rule === "not-allowed"), e.issues.map((i) => i.rule).join(", "));
  }
});

test("the themes on disk do not all draw the same way", () => {
  // The complaint that produced all this: three themes that differed
  // by a background colour and nothing else. If this ever passes trivially
  // again, the theme layer has gone back to being decoration.
  const styles = [];
  for (const dir of readdirSync(join(root, "themes"), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const path = join("themes", dir.name, "theme.json");
    if (!existsSync(join(root, path))) continue;
    styles.push(parseTheme(JSON.parse(readFileSync(join(root, path), "utf8")), path).style);
  }
  if (styles.length < 2) return;
  for (const key of ["radius", "cardStyle", "iconScale"]) {
    const distinct = new Set(styles.map((s) => s[key]));
    assert.ok(distinct.size > 1, `every theme has the same ${key} (${[...distinct][0]})`);
  }
});

// ---------------------------------------------------------------------------
// Layer 3: what a placement has to satisfy.
//
// A rule that is only DECLARED is not kept: run on the repository's own projects,
// these found placements under the touch minimum their theme declares, pairs
// overlapping, and light cards binding neither handler their component cannot
// work without. Each test therefore does two things — it proves the rule
// fires on a mutation, and it proves the shipped projects pass it.

// The Home is a plan (schema 11), so no screen of the project places a
// light card. These rules are about a placement, and the light card is
// the component that has every kind of prop, so the Home gets one back here.
function withLightCard() {
  const doc = readJson(PROJECT_PATH);
  const home = doc.layouts[EU].screens.find((s) => s.id === "home");
  delete home.plan;
  delete home.role;
  home.place.push({
    component: "lovelace-jobr99/light-card", x: 15, y: 90, w: 98, h: 110,
    bind: { light: "$lights.0", onToggle: "$onToggleLight", onOpenDetail: "$onOpenLightDetail" },
  });
  return parseProject(doc, PROJECT_PATH);
}

test("a placement smaller than its component's touch minimum is refused", () => {
  const systems = themesOnDisk();
  const project = withLightCard();
  const screen = euScreens(project).find((s) => s.place.some((p) => p.componentId === "light-card"));
  const place = screen.place.map((p) => (p.componentId === "light-card" ? { ...p, w: 40, h: 40 } : p));
  const broken = withScreens(project, [{ ...screen, place }]);
  try {
    checkPlacements(broken, systems);
    assert.fail("should have thrown");
  } catch (e) {
    const issue = e.issues.find((i) => i.rule === "below-touch-minimum");
    assert.ok(issue, `expected below-touch-minimum, got ${e.issues.map((i) => i.rule).join(", ")}`);
    assert.match(issue.measuredIn, /mm at .* px\/mm/);
    assert.match(issue.want, /\d+x\d+ px/);
  }
});

test("a placement missing a prop its component cannot work without is refused", () => {
  // The one that was live: twelve cards bound `light` and neither handler, so a
  // tap did nothing and no layer of the funnel had an opinion about it.
  const systems = themesOnDisk();
  const project = withLightCard();
  const screen = euScreens(project).find((s) => s.place.some((p) => p.componentId === "light-card"));
  const place = screen.place.map((p) => {
    if (p.componentId !== "light-card") return p;
    const bind = { ...p.bind };
    delete bind.onToggle;
    return { ...p, bind };
  });
  try {
    checkPlacements(withScreens(project, [{ ...screen, place }]), systems);
    assert.fail("should have thrown");
  } catch (e) {
    const issue = e.issues.find((i) => i.rule === "missing-binding");
    assert.ok(issue, `expected missing-binding, got ${e.issues.map((i) => i.rule).join(", ")}`);
    assert.match(issue.path, /onToggle$/);
  }
});

test("the Home is a plan, and nothing compiled reaches into it", () => {
  const project = parseProject(readJson(PROJECT_PATH), PROJECT_PATH);
  for (const layout of project.layouts) {
    const home = layout.screens.find((s) => s.id === "home");
    assert.equal(home.plan, true, layout.device);
    for (const p of home.place) assert.ok(p.y + p.h <= PLAN_TOP, `${layout.device}: ${p.componentId} ends at ${p.y + p.h}`);
  }
});

test("a plan refuses a placement inside it, a tap, and the carousel's swipes", () => {
  const doc = readJson(PROJECT_PATH);
  const home = doc.layouts[EU].screens.find((s) => s.id === "home");
  home.tap = "settings";
  home.swipe = { ...home.swipe, left: "settings" };
  home.place.push({ component: "lovelace-jobr99/label", x: 15, y: 80, w: 200, h: 30, bind: { text: "x" } });
  const r = tryParseProject(doc, PROJECT_PATH);
  assert.equal(r.ok, false);
  const rules = r.error.issues.map((i) => `${i.rule} ${i.path}`);
  const has = (rule, end) => rules.some((x) => x.startsWith(`${rule} `) && x.endsWith(end));
  assert.ok(has("plan-owns-touch", "tap"), rules.join("; "));
  assert.ok(has("plan-owns-touch", "swipe/left"), rules.join("; "));
  assert.ok(has("inside-plan", "place/1"), rules.join("; "));
  // and down is declared by nobody now: the runtime opens Settings with it, as it opens Wireless settings with up
  assert.ok(!rules.some((x) => x.endsWith("swipe/down")), rules.join("; "));
});

test("a plan's colours come from the theme's own tokens, every one of them, and its icons stand 3:1 over its card", () => {
  // the card and each icon appearance are
  // the theme's, with none borrowed from another design system
  for (const ds of themesOnDisk()) {
    const colors = planColors(ds);
    for (const [role, token] of Object.entries(PLAN_COLOR_TOKENS)) {
      const named = ds.colors.find((c) => c.id === token);
      assert.ok(named, `${ds.id} names its plan's ${role}, ${token}`);
      assert.equal(colors[role], named.rgb565, `${ds.id} ${role}`);
    }
    for (const token of PLAN_ICON_TOKENS) {
      const icon = ds.colors.find((c) => c.id === token).rgb565;
      const ratio = contrastRatio(icon, colors.card);
      assert.ok(ratio >= PLAN_ICON_CONTRAST, `${ds.id}: ${token} stands ${ratio.toFixed(2)}:1 over its plan card`);
    }
  }
  // the ratio itself, against WCAG's own corners
  assert.equal(contrastRatio(0xffff, 0x0000).toFixed(1), "21.0");
  assert.equal(contrastRatio(0x1234, 0x1234), 1);
});

test("a theme with no plan card of its own, or a plan icon under 3:1 over it, is refused", () => {
  const raw = () => JSON.parse(readFileSync(join(root, "themes/shadcn-dark/theme.json"), "utf8"));
  const refusal = (doc) => {
    try {
      parseTheme(doc, "themes/shadcn-dark/theme.json");
    } catch (e) {
      assert.ok(e instanceof ValidationError);
      return e.issues;
    }
    assert.fail("should have thrown");
  };
  // no card: nothing is borrowed
  const noCard = raw();
  noCard.colors = noCard.colors.filter((c) => c.id !== "plan-card");
  const missing = refusal(noCard).find((i) => i.rule === "missing-colour-token");
  assert.ok(missing, "a theme with no plan card is refused");
  assert.match(missing.got, /plan-card/);
  // an unlit icon the eye has to look for: zinc-700 on zinc-900
  const dim = raw();
  dim.colors.find((c) => c.id === "plan-icon-off").rgb565 = 14823;
  const low = refusal(dim).find((i) => i.rule === "plan-icon-contrast");
  assert.ok(low, "an icon under 3:1 over its card is refused");
  assert.match(low.path, /plan-icon-off/);
  assert.match(low.got, /:1 over plan-card/);
  // and lovelace's own unlit blue over its card: the 2.74:1 that started it
  assert.ok(contrastRatio(17299, 10597) < PLAN_ICON_CONTRAST);
  assert.ok(parseTheme(raw(), "themes/shadcn-dark/theme.json"), "the untouched document passes");
});

test("two placements covering the same pixels are refused", () => {
  const systems = themesOnDisk();
  const project = parseProject(readJson(PROJECT_PATH), PROJECT_PATH);
  const screen = euScreens(project)[0];
  const place = [screen.place[0], { ...screen.place[1], x: screen.place[0].x, y: screen.place[0].y }];
  try {
    checkPlacements(withScreens(project, [{ ...screen, place }]), systems);
    assert.fail("should have thrown");
  } catch (e) {
    const issue = e.issues.find((i) => i.rule === "overlaps");
    assert.ok(issue, `expected overlaps, got ${e.issues.map((i) => i.rule).join(", ")}`);
    assert.match(issue.message, /cannot be touched/);
  }
});

test("two placements that take turns in one place may cover the same pixels: different alternates, both hideable (schema 14)", () => {
  const systems = themesOnDisk();
  const project = parseProject(readJson(PROJECT_PATH), PROJECT_PATH);
  const screen = euScreens(project)[0];
  const a = screen.place[0];
  const turn = (p, alternate, visible) => ({ ...p, alternate, bind: visible ? { ...p.bind, visible } : p.bind });
  const over = (b) => ({ ...b, x: a.x, y: a.y });
  const overlaps = (place) => {
    try {
      checkPlacements(withScreens(project, [{ ...screen, place }]), systems);
      return false;
    } catch (e) {
      return e.issues.some((i) => i.rule === "overlaps");
    }
  };
  assert.equal(overlaps([turn(a, "icons", "$t.a"), over(turn(screen.place[1], "buttons", "$t.b"))]), false, "the icons and the buttons, each hidden while the other shows");
  assert.equal(overlaps([turn(a, "icons", "$t.a"), over(turn(screen.place[1], "icons", "$t.b"))]), true, "two of the same alternate show together");
  assert.equal(overlaps([turn(a, "icons", "$t.a"), over(turn(screen.place[1], "buttons", null))]), true, "one the runtime cannot hide covers the other");
  assert.equal(overlaps([turn(a, "icons", "$t.a"), over(screen.place[1])]), true, "and one that takes no turns, as before");
});

test("every project in the repository passes all three layers", () => {
  // The counterpart of the mutations above: the rules are not only runnable,
  // they are met. A rule the shipped content violates is a rule nobody believes.
  const systems = themesOnDisk();
  for (const dir of readdirSync(join(root, "projects"), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const path = join("projects", dir.name, "project.json");
    if (!existsSync(join(root, path))) continue;
    const project = parseProject(readJson(path), path);
    assert.doesNotThrow(() => checkProjectAgainstThemes(project, systems), `${dir.name} layer 2`);
    assert.doesNotThrow(() => checkPlacements(project, systems), `${dir.name} layer 3`);
  }
});

test("no theme offers a component no placement could ever use", () => {
  // `screen` sat in all three catalogues and was not placeable: the page frame
  // is mounted by the renderer, not by a placement. A catalogue entry nobody CAN
  // use is a promise the tool does not keep.
  //
  // "Can", and not "does". This asserted that some project places the component,
  // which is a different claim and a weaker one: it would make the catalogue a
  // function of whatever today's three projects happen to draw, and a component
  // laid out by all three themes, compiled and tested, would fail the day no
  // screen placed it. What makes an entry a broken promise is having no layout the
  // compiler can call, so that is what is checked.
  const layoutable = new Map(Object.entries(LAYOUTS).map(([theme, byId]) => [theme, new Set(Object.keys(byId))]));
  for (const ds of themesOnDisk())
    for (const c of ds.components)
      assert.ok(
        layoutable.get(ds.id)?.has(c.id),
        `${ds.id} offers "${c.id}", which no layout in LAYOUTS draws — nothing could place it`,
      );
});

// The other direction of the same pair, which the first one cannot see: a
// layout that exists for a component the theme document never offers is a
// drawing no placement can name, because the funnel checks the placement
// against the CATALOGUE.
test("every layout a theme has is a component its document offers", () => {
  const byId = new Map(themesOnDisk().map((ds) => [ds.id, new Set(ds.components.map((c) => c.id))]));
  for (const [theme, layouts] of Object.entries(LAYOUTS))
    for (const componentId of Object.keys(layouts))
      assert.ok(
        byId.get(theme)?.has(componentId),
        `LAYOUTS["${theme}"] draws "${componentId}", which themes/${theme}/theme.json does not offer`,
      );
});

function themesOnDisk() {
  const out = [];
  for (const dir of readdirSync(join(root, "themes"), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const path = join("themes", dir.name, "theme.json");
    if (existsSync(join(root, path))) out.push(parseTheme(readJson(path), path));
  }
  return out;
}

test("a placement under the housing's bezel is refused", () => {
  // The EU unit covers its 30 rightmost columns, so the grid is 480 wide and the
  // glass shows 450. A box out there COMPILES -- the Editor has no objection --
  // costs RAM, and can be neither seen nor touched. That is worse than an error,
  // because nothing says so.
  //
  // It is also the mistake that shipped: assuming the hidden strip was split 15
  // and 15 instead of 30 on the right put every full-width component ten pixels
  // behind the bezel in all three projects, and the first adversarial pass
  // reported "none" because the check itself had the wrong number.
  const systems = themesOnDisk();
  const project = parseProject(readJson(PROJECT_PATH), PROJECT_PATH);
  const screen = euScreens(project)[0];
  const place = [{ ...screen.place[0], x: 20, w: 440 }]; // 460 > 450
  try {
    checkPlacements(withScreens(project, [{ ...screen, place }]), systems);
    assert.fail("should have thrown");
  } catch (e) {
    const issue = e.issues.find((i) => i.rule === "behind-the-bezel");
    assert.ok(issue, `expected behind-the-bezel, got ${e.issues.map((i) => i.rule).join(", ")}`);
    // it is the housing's doing, not a rule of ours, and the message must say so
    assert.equal(issue.source, "hardware");
    assert.match(issue.measuredIn, /30 rightmost/);
  }
});

test("a box inside the grid but outside the glass is the Editor's blind spot", () => {
  // The two rules are different and both have to exist: the Editor refuses
  // outside 480 (measured), and we refuse outside 450 (the housing). A box at
  // 455 passes the first and fails the second, which is exactly the case that
  // would otherwise reach the panel invisible.
  const systems = themesOnDisk();
  const project = parseProject(readJson(PROJECT_PATH), PROJECT_PATH);
  const screen = euScreens(project)[0];
  const place = [{ ...screen.place[0], x: 455, y: 0, w: 20, h: 20 }];
  assert.doesNotThrow(() => parseProject(rawWithScreens(readJson(PROJECT_PATH), [{ id: "x", title: "X", place: [{ component: place[0].component, x: 455, y: 0, w: 20, h: 20, bind: {} }] }]), "grid-ok"),
    "455 + 20 = 475 is inside the 480 grid, so parsing must accept it");
  assert.throws(() => checkPlacements(withScreens(project, [{ ...screen, place }]), systems), /behind-the-bezel/);
});

test("a theme carries its icons at more than one size, because size is a font choice", () => {
  // A Nextion Text names a font id and draws its glyphs at that font's height.
  // There is no scale attribute, so an icon bigger than the font is not
  // something the panel can do — and blowing a 32-pixel glyph up to 73 in the
  // simulator would draw a picture of something impossible. A theme therefore carries the heights it
  // needs, and a component picks.
  for (const ds of themesOnDisk()) {
    assert.ok(ds.icons.fonts.length > 1, `${ds.id} carries icons at one size only, so a component has nothing to pick from`);
    const heights = ds.icons.fonts.map((id) => ds.fonts.find((f) => f.id === id)?.height);
    assert.ok(heights.every((h) => typeof h === "number"), `${ds.id}: an icon font it names is not one of its fonts`);
    assert.equal(new Set(heights).size, heights.length, `${ds.id} declares two icon fonts of the same height`);
  }
});


// --------------------------------------------------------------- use tags

test("every element of every theme says what it is for", () => {
  for (const ds of themesOnDisk()) {
    for (const c of ds.colors) {
      assert.ok(c.use.length >= 1, `${ds.id}: colour ${c.id} declares no use`);
      for (const u of c.use) assert.ok(u.length <= 40, `${ds.id}: ${c.id} use "${u}" is prose, not a tag`);
    }
    for (const f of ds.fonts) {
      assert.ok(f.use.length >= 1, `${ds.id}: font ${f.id} declares no use`);
      for (const u of f.use) assert.ok(u.length <= 40, `${ds.id}: ${f.id} use "${u}" is prose, not a tag`);
    }
  }
});

// The Themes tab lists every element ONCE with the tags saying where it may be
// used, so an element with no tags is an element the catalogue cannot place.
// Letting it through would put the tool back to guessing, which is the thing the
// field exists to stop.
test("a colour with no declared use is refused, and the issue says which one", () => {
  const doc = readJson(DS_PATH);
  doc.colors = doc.colors.map((c) => (c.id === "accent-blue" ? { ...c, use: [] } : c));
  const r = tryParseTheme(doc, DS_PATH);
  assert.equal(r.ok, false);
  const issue = r.error.issues.find((i) => i.rule === "too-few" && i.path.endsWith("/use"));
  assert.ok(issue, `no issue named the missing use: ${r.error.issues.map((i) => i.path + " " + i.rule).join(", ")}`);
  assert.equal(issue.source, "ours");
});

test("a use written as prose is refused: these are read as tags", () => {
  const doc = readJson(DS_PATH);
  doc.fonts = doc.fonts.map((f, i) =>
    i === 0 ? { ...f, use: ["the colour used for body text and for the labels on cards, and also titles"] } : f);
  const r = tryParseTheme(doc, DS_PATH);
  assert.equal(r.ok, false);
  assert.ok(r.error.issues.some((i) => i.rule === "too-long" && i.path.startsWith("fonts/0/use")));
});

test("an older theme is refused as too old, not patched up", () => {
  const doc = { ...readJson(DS_PATH), schemaVersion: THEME_SCHEMA_VERSION - 1 };
  const r = tryParseTheme(doc, DS_PATH);
  assert.equal(r.ok, false);
  const issue = r.error.issues.find((i) => i.rule === "schema-too-old");
  assert.ok(issue, "an old document has to be refused as OLD, not as a list of missing fields");
  assert.equal(issue.path, "schemaVersion");
  assert.equal(issue.source, "ours");
});


// ------------------------------------------------- the typeface, declared once

// The gap this closes: a face declared TWICE and independently -- a CSS stack in
// `style.fontFamily`, and a `.zi` cut from whatever source a font entry named --
// with the weight inferred from a filename. That inference is wrong for
// `tailwind-slate`'s clock: `clock-80.zi`, source `1.zi`, neither says bold, and
// the `.zi` inside is NotoSans-Bold, so the React column would draw Regular where
// the panel draws Bold, and nothing could notice.
test("every theme declares its typeface once, and the CSS stack is derived from it", () => {
  for (const ds of themesOnDisk()) {
    assert.ok(ds.typeface.family.length > 0, `${ds.id}: no typeface family`);
    assert.ok(ds.typeface.fallback.length >= 1, `${ds.id}: no fallback`);
    // derived, not declared: the document has no style.fontFamily at all
    const raw = readJson(`themes/${ds.id}/theme.json`);
    assert.equal(raw.style.fontFamily, undefined, `${ds.id}: style.fontFamily is back`);
    assert.ok(ds.style.fontFamily.startsWith(ds.typeface.family.includes(" ") ? `"${ds.typeface.family}"` : ds.typeface.family));
    for (const f of ds.typeface.fallback) assert.ok(ds.style.fontFamily.includes(f), `${ds.id}: ${f} missing from the stack`);
  }
});

test("a font with no declared weight is refused", () => {
  const doc = readJson(DS_PATH);
  doc.fonts = doc.fonts.map((f, i) => (i === 0 ? { ...f, weight: undefined } : f));
  const r = tryParseTheme(doc, DS_PATH);
  assert.equal(r.ok, false);
  assert.ok(r.error.issues.some((i) => i.path === "fonts/0/weight"));
});

// The binding itself, as a test rather than only as a build-time check: the
// weight a theme DECLARES has to be the weight the `.zi` it ships actually is,
// and what the `.zi` is comes from reading the file, never from a second
// declaration. `build-theme-fonts.mjs` writes that reading out; this asserts the
// two agree for every font of every theme.
test("the declared weight is the weight the .zi actually carries", () => {
  for (const ds of themesOnDisk()) {
    const iconFont = ds.fonts.find((f) => ds.icons.fonts.includes(f.id)) ?? ds.fonts[0];
    const dir = iconFont.file.replace(/[^/]+$/, "");
    const path = join(root, "themes", ds.id, dir, "typeface.generated.json");
    assert.ok(existsSync(path), `${ds.id}: typeface.generated.json missing — run npm run build-fonts in export/`);
    const carried = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(carried.asked, ds.typeface.family, `${ds.id}: the generated table asks for another family`);
    for (const f of ds.fonts) {
      const got = carried.fonts[f.id];
      assert.ok(got, `${ds.id}/${f.id}: nothing generated for it`);
      assert.equal(got.weight, f.weight, `${ds.id}/${f.id}: declares ${f.weight}, the .zi "${got.ziName}" is ${got.weight}`);
      assert.equal(got.height, f.height, `${ds.id}/${f.id}: declares ${f.height} px, the .zi is ${got.height}`);
    }
  }
});

// ------------------------------------------------- one project, both panels

/**
 * Every project declares a layout for every required panel, drawn or not.
 *
 * The point is that "not drawn yet" and "not supported" stop looking the same.
 * Before schema 4 a project named ONE `device`, so a room designed for the EU
 * unit simply had nothing to say about the US one -- and nothing to say is
 * indistinguishable from nothing to draw. Declaring both, with either allowed to
 * be empty, makes the gap visible and countable.
 */
test("every project declares a layout for each panel, even an empty one", () => {
  for (const dir of readdirSync(join(root, "projects"), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const path = join("projects", dir.name, "project.json");
    if (!existsSync(join(root, path))) continue;
    const project = parseProject(readJson(path), path);
    for (const device of REQUIRED_DEVICES)
      assert.ok(project.layouts.some((l) => l.device === device), `${project.id} declares no ${device} layout`);
  }
});

test("a project that leaves a panel out is refused, and the issue names the panel", () => {
  const raw = readJson(PROJECT_PATH);
  const r = tryParseProject({ ...raw, layouts: { [EU]: raw.layouts[EU] } });
  assert.equal(r.ok, false);
  const issue = r.error.issues.find((i) => i.rule === "panel-not-declared");
  assert.ok(issue, r.error.issues.map((i) => i.rule).join(", "));
  assert.equal(issue.path, "layouts/us-portrait");
});

// An empty layout is not a broken one, and the funnel has to agree or the whole
// idea collapses back into "one project, one panel".
test("an empty layout is legal and passes all three layers", () => {
  const systems = themesOnDisk();
  // the repository's US layout is drawn, so the emptiness this test is about is
  // made here: "declared, not drawn yet"
  // has to stay a legal state whatever the projects on disk look like
  const doc = readJson(PROJECT_PATH);
  doc.layouts["us-portrait"] = { screens: [] };
  const project = parseProject(doc, PROJECT_PATH);
  const us = project.layouts.find((l) => l.device === "us-portrait");
  assert.ok(us, "the US layout is declared");
  assert.equal(us.screens.length, 0, "and not drawn");
  assert.doesNotThrow(() => checkProjectAgainstThemes(project, systems));
  assert.doesNotThrow(() => checkPlacements(project, systems));
});

test("the repository's US layout is drawn, and passes all three layers on its own panel", () => {
  const systems = themesOnDisk();
  const project = parseProject(readJson(PROJECT_PATH), PROJECT_PATH);
  const us = project.layouts.find((l) => l.device === "us-portrait");
  // Sixteen: the screensaver, the Home, the light's detail, the zone, the thermostat, the blind, the list, the house, the mesh,
  // the confirmation, the QR, Help, the lock, the safeboot, and two keyboards (the keypad and the symbols; no QWERTY).
  // The count is asserted rather than the ids because what this test is about
  // is that the US layout is DRAWN at all -- a project that quietly stopped
  // carrying one would still pass every other check here.
  assert.ok(us && us.screens.length === 16, "sixteen screens on the US panel");
  assert.ok(us.screens.every((s) => s.place.every((p) => p.x + p.w <= 320 && p.y + p.h <= 480)), "inside 320x480");
  assert.doesNotThrow(() => checkPlacements(project, systems));
});

// Each layout is checked against ITS OWN panel: the EU unit hides 30 columns
// behind the housing and the US one hides none, so a box that is fine on one
// can be wrong on the other. Checking both against EU numbers would be checking
// the US layout against a panel it will never run on.
test("a layout is measured against its own panel, not the project's first one", () => {
  const systems = themesOnDisk();
  const project = parseProject(readJson(PROJECT_PATH), PROJECT_PATH);
  const place = euScreens(project)[0].place;
  // 300..320 is inside the US portrait grid (320 wide, no crop) and off the
  // right edge of nothing; on EU landscape 470..490 would run past the grid
  const onUs = {
    ...project,
    layouts: project.layouts.map((l) =>
      l.device === "us-portrait"
        ? { ...l, screens: [{ id: "x", title: "X", place: [{ ...place[0], x: 300, y: 0, w: 20, h: 20 }] }] }
        : l),
  };
  assert.doesNotThrow(() => checkPlacements(onUs, systems), "300+20 = 320 fits the US grid exactly");
});

// The drawing rules travel INSIDE the theme document. They were already at
// the head of every `layout/src/themes/<id>.ts`, which reaches whoever writes a
// layout and misses whoever writes a theme -- and a theme is a document anyone
// can add to the platform without opening a `.ts` file at all. Carried verbatim
// rather than linked, because a theme can be handed to another repository, or to
// a model, with nothing else attached.
test("every theme on disk carries the drawing rules, word for word", () => {
  const dirs = readdirSync(join(root, "themes"), { withFileTypes: true }).filter((d) => d.isDirectory());
  assert.ok(dirs.length >= 3, "there is more than one theme to check");
  for (const d of dirs) {
    const ds = parseTheme(readJson(`themes/${d.name}/theme.json`), d.name);
    assert.deepEqual([...ds.drawing], [...DRAWING_RULES], `${d.name} carries the rules`);
  }
  // and the doc they point at is the doc that exists, with that same short form
  const doc = readFileSync(join(root, "..", "..", "docs", "09-drawing-for-the-glass.md"), "utf8");
  for (const line of DRAWING_RULES.slice(1)) {
    const topic = line.split(/\s{2,}/)[0];
    assert.ok(doc.includes(topic), `docs/09 still covers "${topic}"`);
  }
});

test("a theme without the drawing rules is refused, and the refusal says what to paste", () => {
  const { drawing, ...withoutRules } = readJson(DS_PATH);
  assert.ok(drawing, "the document really had them");
  const r = tryParseTheme(withoutRules, DS_PATH);
  assert.equal(r.ok, false);
  const issue = r.error.issues.find((i) => i.path === "drawing");
  assert.ok(issue, "the issue points at the field");
  assert.equal(issue.rule, "missing-drawing-rules");
  assert.equal(issue.source, "ours");
  // the refusal has to be actionable on its own: it carries the text to paste
  assert.ok(issue.want.includes("docs/09-drawing-for-the-glass.md"));
  assert.ok(issue.want.includes("3 584 B of RAM a page"));
});

// Drifted is worse than absent: a stale block still reads as current, and the
// person following it does not know they are following last month's panel.
test("a theme whose drawing rules drifted is refused as stale, not accepted as close enough", () => {
  const doc = readJson(DS_PATH);
  const drifted = [...doc.drawing];
  drifted[5] = "touch     any size the Editor accepts";
  const r = tryParseTheme({ ...doc, drawing: drifted }, DS_PATH);
  assert.equal(r.ok, false);
  const issue = r.error.issues.find((i) => i.path === "drawing");
  assert.equal(issue.rule, "stale-drawing-rules");
  assert.match(issue.got, /any size the Editor accepts/);
});

// A screen says what it is (schema 12): the generator finds each page by that, and not by what the page happens to hold.
test("a screen's role is one of the known ones, one screen's of a layout but the keyboards', and a plan's goes with its flag", () => {
  const raw = () => readJson(PROJECT_PATH);
  const issues = (doc) => {
    try {
      parseProject(doc, PROJECT_PATH);
    } catch (e) {
      assert.ok(e instanceof ValidationError);
      return e.issues;
    }
    return [];
  };
  assert.deepEqual(issues(raw()), [], "the shipped project passes");
  const screens = (doc) => doc.layouts[EU].screens;
  const byId = (doc, id) => screens(doc).find((s) => s.id === id);
  // every screen of the shipped project has one, and the keyboards share theirs
  const doc0 = raw();
  assert.ok(screens(doc0).every((s) => s.role !== undefined), "every screen of the shipped project says what it is");
  assert.equal(screens(doc0).filter((s) => s.role === "keyboard").length, 3, "the letters, the keypad and the signs");
  // a name nobody knows
  const unknown = raw();
  byId(unknown, "zone").role = "climate";
  assert.ok(issues(unknown).some((i) => i.rule === "unknown-role" && /role/.test(i.path)), "a role nobody named is refused");
  // two screens, one role: the runtime would find either
  const twice = raw();
  byId(twice, "house").role = "list";
  const taken = issues(twice).find((i) => i.rule === "role-taken");
  assert.ok(taken && /settings/.test(taken.message), "a second screen with a role is refused, naming the first");
  // the keyboards are the exception
  const board = raw();
  byId(board, "edit-pad").role = "keyboard";
  assert.deepEqual(issues(board), [], "three keyboards, one role");
  // a plan has both its flag and its role, or neither
  const noRole = raw();
  delete byId(noRole, "home").role;
  assert.ok(issues(noRole).some((i) => i.rule === "plan-role"), "a plan with no role is refused");
  const noFlag = raw();
  byId(noFlag, "zone").role = "plan";
  assert.ok(issues(noFlag).some((i) => i.rule === "plan-role"), "a role of plan on a screen that is no plan is refused");
  // a screen with no role at all is a screen the runtime does not address, and is allowed
  const bare = raw();
  delete byId(bare, "help").role;
  assert.deepEqual(issues(bare), [], "no role is allowed: nothing finds the page by one");
});
