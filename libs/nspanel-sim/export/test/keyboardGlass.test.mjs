// The keyboard, RUN rather than read.
//
// `verify-hmi-scenario.mjs` proves the compiled `.tft` carries the components
// and attributes the scenario asked for; `verify-event-frames.mjs` proves every
// declared frame is in it exactly once. Neither presses a key. This does: it
// takes the instruction lines the page really carries and executes them on
// `scripts/lib/glass.mjs`, one scenario at a time.
//
// The scenarios are in `scripts/lib/keyboardScenarios.mjs` and are shared with
// `scripts/panel-bench.mjs`, which runs the same list in the Nextion
// Editor's own debugger. This file is the one that runs anywhere; that one is
// the one whose verdict comes from the vendor.
//
// Both panels are covered, because they are not the same keyboard: the EU is
// landscape with a five-row QWERTY, the US is portrait with a stacked keypad
// and no QWERTY, and a rule that holds on one has said nothing
// about the other.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Glass } from "../scripts/lib/glass.mjs";
import { scenarios } from "../scripts/lib/keyboardScenarios.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PANELS = ["p1-living-room-eu-landscape", "p1-living-room-us-portrait"];

const load = (name) => JSON.parse(readFileSync(join(root, "hmi-scenarios", `${name}.json`), "utf8"));

// panel-bench.mjs names each scenario's pictures by its id: two of one id, and the
// second picture is written over the first
test("every scenario has an id of its own", () => {
  const ids = scenarios.map((s) => s.id);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), []);
});

/**
 * Sets up one run: open the keyboard page with the globals a long press would
 * have written, then press what the scenario says.
 *
 * The press is by COORDINATE and not by name, on purpose: every key's code is
 * guarded by `vaLx`/`vaLy`, so a run that called the handler directly would
 * skip the guard and pass on a keyboard whose keys are in the wrong place.
 */
/**
 * How many characters the field shows at once, read back out of the page.
 *
 * Out of the page and not recomputed: the window is a number the layout
 * derived from the field's width and the theme's widest glyph, and a test that
 * derived it a second way would be checking its own arithmetic. `kbDraw`
 * compares the line's length against it, so the comparison IS the number.
 */
function windowOf(doc, page) {
  const draw = doc.addPages.find((p) => p.name === page).add.find((c) => c.objname === "kbDraw");
  const n = /if\(sys0>(\d+)\)/.exec(JSON.stringify(draw.events));
  assert.ok(n, `${page}: kbDraw does not compare the line against a window`);
  return Number(n[1]);
}

function run(scenario, doc) {
  const g = new Glass(doc, scenario.page);
  const seed = scenario.seed ?? { text: "", max: 60 };
  // `fill` asks for a line `window + fill` long, in the widest glyph there is,
  // so the scenario does not have to know the number.
  const text = scenario.fill === undefined
    ? seed.text
    : "m".repeat(Math.max(0, windowOf(doc, scenario.page) + scenario.fill));
  g.set(`${g.zeroName}.kbIn.txt`, text);
  g.set(`${g.zeroName}.kbMax.val`, seed.max);
  g.set(`${g.zeroName}.kbCaps.val`, seed.caps ?? 0);
  g.open(scenario.page);           // the load event draws the field from the globals
  g.wire = "";                     // ...and anything before the first press is setup
  for (const step of scenario.press) {
    const name = typeof step === "string" ? step : step.key;
    if (typeof step !== "string" && step.after) g.advance(step.after);
    const key = g.page.components.get(name);
    assert.ok(key, `${scenario.id}: no key "${name}" on page "${g.page.name}"`);
    const hit = g.press(key.x + Math.floor(key.w / 2), key.y + Math.floor(key.h / 2));
    assert.equal(hit, name, `${scenario.id}: pressing the middle of "${name}" reached "${hit}" instead`);
  }
  if (scenario.advance) g.advance(scenario.advance);
  return g;
}

for (const panel of PANELS) {
  const doc = load(panel);
  for (const s of scenarios) {
    // Some behaviour has no panel-independent wording: the keypad draws one
    // Button per key in landscape and a digit over its letters in portrait, so
    // "CAPS shows" names a different component on each.
    if (s.panel && !panel.endsWith(s.panel)) continue;
    test(`${panel} ${s.id}: ${s.what}`, () => {
      const g = run(s, doc);
      // A sliding scenario checks the one rule that holds at every length:
      // the whole line when it fits, and otherwise ".." and the last
      // `window - 1` characters of it, with the caret after them.
      if (s.fill !== undefined) {
        // the page it ended on, which is not always the one it started on
        const win = windowOf(doc, g.page.name);
        const line = String(g.get(`${g.zeroName}.kbIn.txt`));
        const shown = line.length > win ? ".." + line.slice(-(win - 1)) : line;
        assert.equal(g.get("kbShow.txt"), shown + (s.caretOff ? "" : "|"),
          `the field should show ${JSON.stringify(shown)} of ${JSON.stringify(line)}`);
        return;
      }
      const e = s.expect;
      if (e.page !== undefined) assert.equal(g.page.name, e.page, "ended on the wrong page");
      if (e.text !== undefined) assert.equal(g.get(`${g.zeroName}.kbIn.txt`), e.text, "the typed line");
      if (e.caps !== undefined) assert.equal(g.get(`${g.zeroName}.kbCaps.val`), e.caps, "the CAPS flag");
      if (e.shown !== undefined) assert.equal(g.get("kbShow.txt"), e.shown, "what the field shows");
      if (e.legend) {
        for (const [obj, cap] of Object.entries(e.legend)) {
          assert.equal(g.get(`${obj}.txt`), cap, `the legend on ${obj}`);
        }
      }
      if (e.frames !== undefined) {
        // Every press says so as it lands, from the page's TouchCap: the
        // runtime's screensaver clock. One a press, and apart
        // from what the keys send.
        const touches = g.frames.filter((f) => f.includes(",page,touch"));
        const keys = g.frames.filter((f) => !f.includes(",page,touch"));
        assert.equal(touches.length, s.press.length, `one touch frame a press: ${JSON.stringify(g.frames)}`);
        // A tap's whole frame is one `printh` of pre-encoded bytes, envelope
        // and all; the OK key builds its payload at run time. So the count is
        // exact and the content is checked by what it CARRIES -- the envelope
        // belongs to `verify-event-frames.mjs`, against the compiled .tft.
        assert.equal(keys.length, e.frames.length, `frames sent: ${JSON.stringify(g.frames)}`);
        for (const [i, want] of e.frames.entries()) {
          assert.ok(keys[i].includes(want), `frame ${i} is ${JSON.stringify(keys[i])}, which does not carry ${JSON.stringify(want)}`);
        }
      }
    });
  }
}

// The interpreter refuses an instruction it does not know rather than skipping
// it, and this is what makes the suite above mean anything: a generator that
// starts emitting something new gets a failure here instead of a green run over
// a line nobody executed.
test("the interpreter refuses an instruction it has no rule for", () => {
  const doc = load(PANELS[0]);
  const g = new Glass(doc, "editboard");
  assert.throws(() => g.step("wepo 0,1"), /no rule for the instruction/);
  assert.throws(() => g.step("kbShow.txt=nosuch.attr"), /no component/);
});

// The two keys that leave the keyboard are icons, the ✕ and the ✓, on every
// keyboard of every project: with CAPS
// on, the "x" key said "X" too, and the two differed only by their colour. The
// ✓ is the header's own, the theme's `confirm`; the ✕ its `cancel`.
test("the keys that leave the keyboard are the theme's ✕ and ✓, in its icon font, on every keyboard", () => {
  const themeOf = { "living-room": "lovelace-jobr99", "living-room-shadcn": "shadcn-dark", "living-room-tailwind": "tailwind-slate" };
  for (const [project, theme] of Object.entries(themeOf)) {
    const roles = JSON.parse(readFileSync(join(root, "..", "themes", theme, "fonts", "icon-roles.generated.json"), "utf8"));
    const glyph = (role) => String.fromCodePoint(roles[role].code);
    for (const device of ["eu-landscape", "us-portrait"]) {
      const doc = load(`p1-${project}-${device}`);
      const pages = doc.addPages.filter((p) => p.add.some((c) => c.objname === "kOK0"));
      // the US portrait has the keypad and the symbols, and no QWERTY
      assert.ok(pages.length >= (device === "eu-landscape" ? 3 : 2), `${project} ${device}: the letters, the keypad and the symbols`);
      for (const p of pages) {
        const key = (name) => p.add.find((c) => c.objname === name).attributes;
        const where = `${project} ${device} ${p.name}`;
        assert.equal(key("kX0").txt, glyph("cancel"), `${where}: the way out without a change is the ✕`);
        assert.equal(key("kOK0").txt, glyph("confirm"), `${where}: the way out with it is the ✓`);
        assert.equal(key("kX0").font, key("kDEL0").font, `${where}: in the icon font, as the backspace`);
        assert.equal(key("kOK0").font, key("kDEL0").font, `${where}: in the icon font, as the backspace`);
      }
    }
  }
});
