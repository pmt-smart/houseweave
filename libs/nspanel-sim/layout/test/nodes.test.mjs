// The checks that make "one declaration" a property rather than an intention.
//
// Nothing here draws anything. What it holds is what would otherwise be true
// only because two people wrote it to agree: that a layout names only colours, fonts
// and ramps its theme actually has, that the emitter moves no geometry, that a
// binding never gets compiled onto the glass, and that a generated picture is no
// bigger than the thing it paints.
//
// What it deliberately does NOT check is what the picture costs in the compiled
// `.tft`: that belongs to the exporter, which owns the codec
// (`export/test/pictureCodec.test.mjs` measures it). The dithering tests below
// are about how a ramp LOOKS and which default it gets, not about bytes.
//
// It also holds every theme to the one rule about rules: a theme file carries
// the "DRAWING FOR THE GLASS" block that points at docs/09, so the next theme
// starts from what was measured and not from a screenshot.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import {
  BOUND_PROPS, COMPONENT_IDS, FONT_ROLES, LAYOUTS, RAMPS,
  binding, bindingNumber, cssGradient, emitNodes, layoutFor, literal, literalNumber,
  roundTempC, formatTempC, NO_READING,
  autoDither, defaultDither, colorBinding, colorOf, colorToken, crc16Modbus, encodeFrame, printhFrame, HOLD_MS, MIN_SIDE,
  layoutStyle, pictureKey, picturePixels, rampPixels,
  sampleGradient, variantsOf, DEFAULT_VARIANT, SCREEN_GEOMETRY, listScreen, zoneScreen, thermostatScreen, coverScreen, lightDetailScreen, PAGE_BUTTON_ROW, THERMOSTAT_LINES, THERMOSTAT_MODES, THERMOSTAT_FACE_GAP, objectName,
} from "../dist/index.js";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const THEME_IDS = Object.keys(LAYOUTS);
const themes = Object.fromEntries(
  THEME_IDS.map((id) => [id, JSON.parse(readFileSync(join(workspace, "themes", id, "theme.json"), "utf8"))]),
);
/** What a layout is handed, derived exactly the way the compile step derives it. */
const styleOf = (id) => layoutStyle(themes[id].style, themes[id].fonts);

/** Boxes worth trying: a wide strip, a tall one, and one smaller than the type. */
const BOXES = [
  { w: 450, h: 26 },
  { w: 420, h: 98 },
  { w: 100, h: 200 },
  { w: 12, h: 12 },
];

/** Props worth trying, per component. Every converted component belongs here. */
const PROPS = {
  label: [
    { text: literal("Living Room"), tone: "title", align: "center" },
    { text: literal("dimmed"), tone: "muted", align: "right" },
    { text: literal("plain") },
    { text: binding("$screen.title"), tone: "title" },
  ],
  clock: [
    { time: binding("$clock.time", "21:51"), date: binding("$clock.date", "04/09/2026") },
    { time: literal("00:00"), date: literal("") },
    // a long date is what makes a clock overflow its box, and the panel clips it
    { time: literal("23:59"), date: literal("Wednesday, 16 September 2026") },
  ],
  "weather-row": [
    {
      items: Array.from({ length: 5 }, (_, i) => ({
        label: binding(`$weather.${i}.label`, ["", "Fri", "Sat", "Sun", "Mon"][i]),
        temp: binding(`$weather.${i}.temp`, "18.1\u00b0C"),
      })),
    },
    // a row with nothing in it: the panel still has to draw the cells
    { items: Array.from({ length: 5 }, () => ({ label: literal(""), temp: literal("\u2014") })) },
  ],
  "status-icon": [
    { role: "power", color: colorBinding("$status.left.color", "icon-low-sat"), side: "left" },
    { role: "lightOn", color: colorToken("icon-off"), side: "right" },
    // half-bound on purpose: a placement that names neither still has to draw
    { side: "left" },
  ],
  "nav-header": [
    { title: binding("$screen.title", "Home"), prev: { kind: "report", event: "nav.prev" }, next: { kind: "report", event: "nav.next" } },
    // the end of the deck: no arrows at all, which is NO_NAV
    { title: literal("Settings") },
    { title: literal("Only forward"), next: { kind: "navigate", screen: "home" } },
    // a screen that is left: no X, the title is the way back
    { title: binding("$light.name", "Living Room"), close: { kind: "report", event: "nav.close" } },
    // left AND renamed: the tap closes, the hold opens the keyboard
    { title: binding("$screen.title", "Home"), close: { kind: "report", event: "nav.close" }, editTitle: { kind: "report", event: "text.edit" } },
    // the Home's: its action and the sign that the panel is open to a phone,
    // with a next arrow for the column order
    {
      title: binding("$screen.title", "Home"), close: { kind: "report", event: "nav.close" },
      action: { kind: "report", event: "header.action" }, actionIcon: binding("$plan.actionIcon", "add"),
      statusIcon: binding("$plan.statusIcon", ""), next: { kind: "navigate", screen: "zone" },
    },
  ],
  "light-card": [
    {
      name: binding("$lights.0.name", "Ceiling"),
      icon: "lightOff",
      iconColor: colorBinding("$lights.0.iconColor", "icon-off"),
      tap: { kind: "report", event: "light.toggle" },
      hold: { kind: "report", event: "light.detail" },
    },
    { name: literal("Lamp"), icon: "lightOn", iconColor: colorToken("icon-low-sat") },
  ],
  "toggle-switch": [
    { on: literalNumber(0), change: { kind: "report", event: "toggle.change" } },
    { on: bindingNumber("$settings.liveSliderUpdate") },
  ],
  "list-row": [
    {
      label: literal("Live update"), on: literalNumber(0),
      change: { kind: "report", event: "list.row" },
      hold: { kind: "report", event: "list.hold" },
    },
    // no hold at all: the row still draws and flips, it just has no Help to open
    { label: literal("Setting A"), on: literalNumber(1) },
    // a SLOT of the list template: its lit colour follows a binding
    { label: literal("Keypad"), on: bindingNumber("$list.rows.1.on"), change: { kind: "report", event: "list.row" } },
    // a device of a zone: every part, and the tail's own long press
    {
      icon: "lightOn", iconColor: colorToken("icon-low-sat"), label: literal("Middle 1"), hint: literal("80%"),
      tail: literal("1,1"), on: literalNumber(1),
      change: { kind: "report", event: "zone.row" }, hold: { kind: "report", event: "zone.hold" },
      tailHold: { kind: "report", event: "zone.slot" },
    },
  ],
  "zone-counter": [
    { count: literal("12"), icon: "lightOn", tap: { kind: "report", event: "zone.count" }, hold: { kind: "report", event: "zone.count" } },
    // a counter the zone has no kind for: blank, and still the same target
    { count: literal(""), icon: "" },
  ],
  "pattern-pad": [
    { wrong: literalNumber(0), drawn: { kind: "report", event: "lock.try" } },
    // the lock's own: every dot painted wrong by a binding
    { wrong: bindingNumber("$lock.wrong") },
  ],
  "qr-code": [
    { code: literal("WIFI:T:nopass;S:tasmota-3E51A7-6960;;") },
    // the page's own: a binding the runtime writes, into the capacity it says
    { code: binding("$qr.code"), capacity: 134 },
  ],
  "page-rail": [
    { page: literalNumber(0), pageCount: literalNumber(2), change: { kind: "report", event: "list.page" } },
    { page: bindingNumber("$settings.page"), pageCount: literalNumber(7) },
    // one page: `pageCount <= 1` is the signal to draw nothing at all
    { page: literalNumber(0), pageCount: literalNumber(1) },
  ],
  "gradient-slider": [
    { pct: literalNumber(0), ramp: "hue" },
    { pct: literalNumber(100), ramp: "brightness" },
    { pct: bindingNumber("$light.brightnessPct"), ramp: "color-temp" },
    { pct: literalNumber(50), ramp: "hue", trackHeight: 12 },
  ],
  keyboard: [
    {
      value: binding("$keyboard.value"), max: bindingNumber("$keyboard.max"),
      commit: { kind: "report", event: "text.commit" },
      cancel: { kind: "report", event: "text.cancel" },
    },
    // and with nothing bound to OK or X: the keys still draw, they just do not
    // report -- the same rule every other component follows
    { value: binding("$keyboard.value"), max: bindingNumber("$keyboard.max") },
  ],
};

/**
 * Every node a converted component can produce: every theme, every VARIANT,
 * every box, every set of props.
 *
 * The variant loop is what keeps a second style from being a place where the
 * rules stop applying -- a compact slider that named a colour its theme does not
 * have would be just as broken as a default one, and only harder to notice.
 */
function everyLayout() {
  const out = [];
  for (const themeId of THEME_IDS)
    for (const componentId of Object.keys(LAYOUTS[themeId]))
      for (const variant of variantsOf(themeId, componentId))
        for (const box of BOXES)
          for (const props of PROPS[componentId] ?? [])
            out.push({
              themeId, componentId, variant, box,
              nodes: layoutFor(themeId, componentId, variant)(props, box, styleOf(themeId)),
            });
  return out;
}

/** A theme resolved the way the compile step resolves one, from its own document. */
function emitThemeFor(themeId, pictures = []) {
  const doc = themes[themeId];
  const ids = new Map();
  return {
    color: (token) => doc.colors.find((c) => c.id === token).rgb565,
    font: (role) => FONT_ROLES.indexOf(role),
    glyph: () => "?",
    page: (screen) => screen,
    picture: (spec) => {
      const key = pictureKey(spec);
      if (!ids.has(key)) {
        ids.set(key, pictures.length);
        pictures.push({ key, ...spec });
      }
      return ids.get(key);
    },
  };
}

const emitAt = (index) => ({ pageName: "home", origin: { x: 37, y: 11 }, background: "background", index });

test("a header's sign takes a rail's width from the title, left of the action, and is there only while it names a role", () => {
  // the Home says so while the panel is open to a phone
  const action = { kind: "report", event: "header.action" };
  for (const themeId of THEME_IDS) {
    const size = { w: 435, h: 78 };
    const without = layoutFor(themeId, "nav-header")({ title: literal("Home"), action, actionIcon: "add" }, size, styleOf(themeId));
    const nodes = layoutFor(themeId, "nav-header")({ title: literal("Home"), action, actionIcon: "add", statusIcon: binding("$plan.statusIcon", "") }, size, styleOf(themeId));
    const title = (ns) => ns.find((n) => n.id === "tTitle").box;
    const sign = nodes.find((n) => n.id === "tStatus");
    const act = nodes.find((n) => n.id === "tAction");
    assert.ok(sign, `${themeId}: no sign`);
    assert.equal(title(without).w - title(nodes).w, sign.box.w, `${themeId}: the title gave the sign its column`);
    assert.equal(sign.box.w, SCREEN_GEOMETRY.railWidth, `${themeId}: a rail's width`);
    assert.ok(sign.box.x + sign.box.w <= act.box.x, `${themeId}: left of the action's glyph`);
    assert.ok(title(nodes).x + title(nodes).w <= sign.box.x, `${themeId}: and right of the title`);
    assert.deepEqual(sign.shownBy, binding("$plan.statusIcon", ""), `${themeId}: shown by its own value`);
    assert.equal(nodes.some((n) => n.kind === "touch" && n.id === "mStatus"), false, `${themeId}: not a control`);
  }
});

test("a header is left by a tap on its title, and draws no X", () => {
  // No X beside the title: the title row is the way back. So `close` is the TITLE's tap, over the whole title box,
  // and the title has the room an X would take.
  const close = { kind: "report", event: "nav.close" };
  const editTitle = { kind: "report", event: "text.edit" };
  for (const themeId of THEME_IDS) {
    const size = { w: 290, h: 78 };
    const nodes = layoutFor(themeId, "nav-header")({ title: literal("Living Room"), close, editTitle }, size, styleOf(themeId));
    assert.equal(nodes.some((n) => n.kind === "icon"), false, `${themeId}: an icon in a header with nothing but close`);
    const title = nodes.find((n) => n.id === "tTitle");
    // the whole row but the margin: a header runs to the visible edge
    // (headerBox), and its words keep the margin from it
    assert.equal(title.box.w, size.w - SCREEN_GEOMETRY.margin, `${themeId}: the title does not get the whole row`);
    const touches = nodes.filter((n) => n.kind === "touch");
    assert.equal(touches.length, 1, `${themeId}: one target for the title, not ${touches.length}`);
    assert.deepEqual(touches[0].box, title.box, `${themeId}: the target is not the title`);
    assert.equal(touches[0].action, close, `${themeId}: a tap on the title does not close`);
    assert.equal(touches[0].hold, editTitle, `${themeId}: the long press no longer renames`);
  }
});

test("nothing a component draws after a text crosses that text's box", () => {
  // The Nextion paints in order and every component paints its WHOLE box -- a
  // Text in its background colour, not only its glyphs. So a node drawn later
  // that reaches into a text's box paints over it, whatever React shows.
  // The compiled pages are checked the same way in export/test/textOnGlass.test.mjs.
  // every kind but `touch`, which is a Hotspot and draws nothing
  const DRAWS = new Set(["text", "field", "icon", "fill", "key", "slider", "toggle"]);
  const crosses = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const found = new Set();
  for (const { themeId, componentId, variant, box, nodes } of everyLayout()) {
    nodes.forEach((text, i) => {
      if (text.kind !== "text" && text.kind !== "field") return;
      for (const later of nodes.slice(i + 1)) {
        if (!DRAWS.has(later.kind) || !later.box) continue;
        if (crosses(text.box, later.box)) found.add(`${themeId}/${componentId}@${variant} ${box.w}x${box.h}: ${text.id} under ${later.kind} ${later.id}`);
      }
    });
  }
  assert.deepEqual([...found], []);
});

test("a text drawn over a fill paints it in the fill's own colour", () => {
  // The other way round: a Text drawn AFTER a fill it reaches into paints its
  // box in its own background, so over a fill of another colour it cuts a hole.
  // A card's name on the card's colour is the pattern; a Text on the page's colour
  // over a rule at its cell's edge would draw the rule in pieces, which the test
  // above cannot see.
  // What is under a text is read at the corners and the middle of each place it
  // crosses a fill: whatever was painted last there, before the text.
  const crosses = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const inside = (p, b) => p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + b.h;
  // A key is a Button, and a Button paints its whole face in its own colour:
  // the keypad's digit and letters sit on the face, inside shadcn's outline.
  const PAINTS = new Set(["fill", "text", "icon", "key"]);
  const paintOf = (n) => (n.kind === "fill" || n.kind === "key" ? n.color : n.background ?? "background");
  const found = new Set();
  for (const { themeId, componentId, variant, box, nodes } of everyLayout()) {
    nodes.forEach((text, i) => {
      if (text.kind !== "text" && text.kind !== "icon") return;
      const under = nodes.slice(0, i).filter((n) => PAINTS.has(n.kind) && n.box);
      for (const fill of under) {
        if (fill.kind !== "fill" || !crosses(fill.box, text.box)) continue;
        const x0 = Math.max(fill.box.x, text.box.x), y0 = Math.max(fill.box.y, text.box.y);
        const x1 = Math.min(fill.box.x + fill.box.w, text.box.x + text.box.w) - 1;
        const y1 = Math.min(fill.box.y + fill.box.h, text.box.y + text.box.h) - 1;
        for (const p of [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x0, y: y1 }, { x: x1, y: y1 }, { x: (x0 + x1) >> 1, y: (y0 + y1) >> 1 }]) {
          const top = under.filter((n) => inside(p, n.box)).at(-1);
          if (top && paintOf(top) !== paintOf(text))
            found.add(`${themeId}/${componentId}@${variant} ${box.w}x${box.h}: ${text.id} (${paintOf(text)}) over ${top.id} (${paintOf(top)})`);
        }
      }
    });
  }
  assert.deepEqual([...found], []);
});

test("every converted component has props to exercise it", () => {
  // Otherwise `everyLayout` skips it silently and every check below passes by
  // testing nothing, which is the worst way for a suite to be green.
  for (const componentId of Object.keys(LAYOUTS[THEME_IDS[0]]))
    assert.ok(PROPS[componentId]?.length, `${componentId} is converted but the tests never call it`);
});

test("every component a theme lays out has a default style", () => {
  // `default` is what a placement that names no variant gets. A component whose
  // default were a special case would make every unannotated placement a
  // surprise, and there are 30-odd of those in the projects today.
  for (const themeId of THEME_IDS)
    for (const componentId of Object.keys(LAYOUTS[themeId]))
      assert.ok(
        variantsOf(themeId, componentId).includes(DEFAULT_VARIANT),
        `${themeId}/${componentId} offers ${variantsOf(themeId, componentId).join(", ")} and no default`,
      );
});

test("the styles a theme DRAWS are the styles it DECLARES", () => {
  // Both directions, and each has its own failure. A variant in the code that
  // the document does not list is a style nothing can discover -- not the Themes
  // tab, not a project author. One in the document that the code does not fill
  // is a placement the funnel accepts and the compile step cannot draw.
  for (const themeId of THEME_IDS)
    for (const componentId of Object.keys(LAYOUTS[themeId])) {
      const spec = themes[themeId].components.find((c) => c.id === componentId);
      assert.ok(spec, `${themeId} lays out "${componentId}" and its document does not list it`);
      assert.deepEqual(
        variantsOf(themeId, componentId).slice().sort(),
        spec.variants.slice().sort(),
        `${themeId}/${componentId}: the code draws [${variantsOf(themeId, componentId)}] and the document declares [${spec.variants}]`,
      );
    }
});

test("a second style is a different drawing of the SAME component", () => {
  // The point of variants, stated as a check: same props in, same kinds of node
  // out. A variant that answered different props would be a different component
  // wearing this one's id, and every project binding it would be lying.
  //
  // KINDS and not counts. The keyboard's `t9` variant is the same alphabet on
  // twelve keys instead of forty-four -- same props, same primitives, a
  // different number of them -- and counting would have called that a different
  // component. What must not change is WHICH primitives a project is asking the
  // hardware for.
  //
  // One exception, and a narrow one: the faces of the thermostat's page are a single Button where the row and
  // the counter have Texts and a Hotspot, because only a Button paints its own press over a face the runtime writes. Same
  // props in, the same events out, and their document declares the primitive.
  const FACES = { "list-row": "button", "zone-counter": "face" };
  for (const themeId of THEME_IDS)
    for (const componentId of Object.keys(LAYOUTS[themeId])) {
      const variants = variantsOf(themeId, componentId);
      if (variants.length < 2) continue;
      const props = PROPS[componentId][0];
      const kindsOf = (variant) =>
        layoutFor(themeId, componentId, variant)(props, { w: 420, h: 98 }, styleOf(themeId))
          .reduce((kinds, node) => kinds.add(node.kind), new Set());
      const same = (a, b) => a.size === b.size && [...a].every((k) => b.has(k));
      const base = kindsOf(DEFAULT_VARIANT);
      for (const variant of variants) {
        if (FACES[componentId] === variant) {
          const spec = themes[themeId].components.find((c) => c.id === componentId);
          assert.deepEqual([...kindsOf(variant)], ["button"], `${themeId}/${componentId}@${variant} is a face, one Button`);
          assert.ok(spec.primitives.includes("Button"), `${themeId}/${componentId}: the document declares the Button its ${variant} draws`);
          continue;
        }
        assert.ok(same(kindsOf(variant), base), `${themeId}/${componentId}@${variant} builds different primitives from the default`);
      }
    }
});

test("every theme lays out the same components, and all of them are real ids", () => {
  const sets = THEME_IDS.map((id) => Object.keys(LAYOUTS[id]).sort().join(","));
  assert.equal(new Set(sets).size, 1, `themes have diverged: ${JSON.stringify(sets)}`);
  for (const themeId of THEME_IDS)
    for (const componentId of Object.keys(LAYOUTS[themeId]))
      assert.ok(COMPONENT_IDS.includes(componentId), `${themeId} lays out unknown component "${componentId}"`);
});

test("a component with bindable props declares them, and vice versa", () => {
  // `BOUND_PROPS` is what tells the compile step where a binding may live. A
  // converted component missing from it compiles its bindings as visible text,
  // which is precisely the bug this whole change exists to remove.
  for (const componentId of Object.keys(LAYOUTS[THEME_IDS[0]]))
    assert.ok(BOUND_PROPS[componentId], `${componentId} is converted but declares no BOUND_PROPS`);
  for (const componentId of Object.keys(BOUND_PROPS))
    assert.ok(COMPONENT_IDS.includes(componentId), `BOUND_PROPS names unknown component "${componentId}"`);
});

test("a layout never names a colour its theme does not have", () => {
  for (const { themeId, componentId, nodes } of everyLayout()) {
    const ids = new Set(themes[themeId].colors.map((c) => c.id));
    const tokenOf = (c) => (c === undefined ? undefined : typeof c === "string" ? c : colorOf(c));
    for (const node of nodes) {
      const tokens = [tokenOf(node.color), node.background, node.pointer, node.off, node.on, node.knob];
      if (node.track?.kind === "solid") tokens.push(node.track.color);
      for (const token of tokens.filter(Boolean))
        assert.ok(ids.has(token), `${themeId}/${componentId} names colour "${token}", which the theme does not declare`);
    }
  }
});

test("a layout never names a font role its theme does not fill", () => {
  for (const { themeId, componentId, nodes } of everyLayout()) {
    const filled = new Set(themes[themeId].fonts.map((f) => f.role));
    for (const node of nodes)
      if (node.font !== undefined) {
        assert.ok(FONT_ROLES.includes(node.font), `${themeId}/${componentId} asks for unknown role "${node.font}"`);
        assert.ok(filled.has(node.font), `${themeId}/${componentId} asks for "${node.font}", which ${themeId} does not fill`);
      }
  }
});

test("a layout never names a ramp that does not exist", () => {
  for (const { themeId, componentId, nodes } of everyLayout())
    for (const node of nodes)
      if (node.track?.kind === "ramp")
        assert.ok(RAMPS[node.track.ramp], `${themeId}/${componentId} asks for unknown ramp "${node.track.ramp}"`);
});

test("every theme fills every font role exactly once", () => {
  // The compile step turns a role into a font INDEX by position, so a role
  // filled twice would make which file answers depend on document order.
  for (const themeId of THEME_IDS) {
    const roles = themes[themeId].fonts.map((f) => f.role);
    assert.deepEqual([...roles].sort(), [...FONT_ROLES].sort(), `${themeId} does not fill the roles exactly once`);
  }
});

test("a layout stays inside the box it was given", () => {
  for (const { themeId, componentId, box, nodes } of everyLayout())
    for (const node of nodes) {
      const where = `${themeId}/${componentId} node "${node.id}" in ${box.w}x${box.h}`;
      assert.ok(node.box.x >= 0 && node.box.y >= 0, `${where} starts outside the box`);
      assert.ok(node.box.x + node.box.w <= box.w, `${where} runs past the right edge`);
      assert.ok(node.box.y + node.box.h <= box.h, `${where} runs past the bottom edge`);
    }
});

test("node ids are unique within a component, so two records cannot collide", () => {
  for (const { themeId, componentId, nodes } of everyLayout()) {
    const ids = nodes.map((n) => n.id);
    assert.equal(new Set(ids).size, ids.length, `${themeId}/${componentId} repeats a node id: ${ids.join(",")}`);
  }
});

test("every Button is emitted flat, not in the template's 3D style", () => {
  // The Editor's Button template says style 4, "3D_Auto", and a Button left at
  // it is drawn with a bevel the themes do not have: measured in the Editor's
  // debugger on the screensaver's rule, white over two rows that
  // came out light grey over dark grey. Every fill and every key is a Button.
  for (const { themeId, componentId, nodes } of everyLayout()) {
    const { records } = emitNodes(nodes, emitThemeFor(themeId), emitAt(4));
    for (const r of records)
      if (r.type === "Button" || r.type === "ButtonT")
        assert.equal(r.attributes?.style, 0, `${themeId}/${componentId}: ${r.objname} is a ${r.type} with style ${r.attributes?.style}`);
  }
});

test("the emitter moves no geometry", () => {
  // The one thing the old `EMIT` table could not promise. Every rectangle in the
  // scenario is the rectangle the layout declared, offset by where the project
  // put the placement -- and nothing in between gets to round it.
  for (const { themeId, componentId, nodes } of everyLayout()) {
    const { records, dropped } = emitNodes(nodes, emitThemeFor(themeId), emitAt(4));
    // Some records have no node, and every one of them is machinery rather than
    // drawing: a hold Timer, so the panel can time a long press by itself
    // (`wire.ts`); the keyboard's string Variables, which hold the line being
    // typed; and its two Hotspots, `kbRef` (the CAPS key clicks it to rewrite
    // every cap at once) and `kbDraw` (every key clicks it to redraw the line
    // with the caret). None of them is geometry a layout declared, which is what this
    // test is about. A node thinner than MIN_SIDE is not a component at all, so
    // it is dropped rather than moved. Everything left is one record per node.
    const machinery = new Set(["kbRef", "kbDraw"]);
    // A key is TWO records: the Button that draws it and a Hotspot of the same
    // box, emitted last, that carries the code -- because the topmost component
    // takes the press (measured in the debugger) and a theme may draw the
    // digit over the letters. The Hotspot is named after its Button, so it is
    // recognisable without guessing.
    const buttons = new Set(records.map((r) => r.objname));
    const isKeyTouch = (r) => r.type === "Hotspot" && r.objname.startsWith("m") && buttons.has(r.objname.slice(1));
    // A slider's `tail` is a Hotspot right under its track -- the scrollbar's
    // touch that runs past its drawing. The layout declares it as
    // pixels on the slider, not as a node, so it is checked against that --
    // and only where the slider reports something a tap there could say.
    const tails = new Map(nodes.filter((n) => n.kind === "slider" && n.tail && n.action).map((n) => [objectName(`${n.id}End`, 4), n]));
    for (const [name, n] of tails) {
      const r = records.find((x) => x.objname === name);
      assert.deepEqual(
        { type: r?.type, x: r?.x, y: r?.y, w: r?.w, h: r?.h },
        { type: "Hotspot", x: 37 + n.box.x, y: 11 + n.box.y + n.box.h, w: n.box.w, h: n.tail },
        `${themeId}/${componentId}: the tail of "${n.id}" is not right under its track`,
      );
    }
    const drawn = records.filter((r) => r.type !== "Timer" && r.type !== "Vari" && !machinery.has(r.objname) && !isKeyTouch(r) && !tails.has(r.objname));
    const kept = nodes.filter((n) => n.box.w >= MIN_SIDE && n.box.h >= MIN_SIDE)
      // the pattern pad is one node and nine records: a Text per dot, where the dot is
      .flatMap((n) => n.kind === "pattern"
        ? n.dots.map((d, i) => ({ id: `${n.id}.${i + 1}`, box: { x: n.box.x + d.x, y: n.box.y + d.y, w: d.w, h: d.h } }))
        : [n]);
    const nodeCount = nodes.filter((n) => n.box.w >= MIN_SIDE && n.box.h >= MIN_SIDE).length;
    assert.equal(dropped.length, nodes.length - nodeCount, `${themeId}/${componentId}: dropped does not account for the difference`);
    assert.equal(drawn.length, kept.length, `${themeId}/${componentId} emitted a different number of records`);
    for (const [i, record] of drawn.entries()) {
      const node = kept[i];
      assert.deepEqual(
        { x: record.x, y: record.y, w: record.w, h: record.h },
        { x: 37 + node.box.x, y: 11 + node.box.y, w: node.box.w, h: node.box.h },
        `${themeId}/${componentId} moved node "${node.id}"`,
      );
    }
  }
});

test("a binding compiles to an empty string and a manifest line", () => {
  for (const themeId of THEME_IDS) {
    const nodes = layoutFor(themeId, "label")(
      { text: binding("$screen.title"), tone: "title" },
      { w: 400, h: 32 },
      styleOf(themeId),
    );
    const { records, bindings } = emitNodes(nodes, emitThemeFor(themeId), emitAt(2));
    assert.equal(records[0].attributes.txt, "", `${themeId} compiled a binding onto the glass`);
    assert.deepEqual(bindings, [
      { page: "home", objname: records[0].objname, attribute: "txt", path: "$screen.title" },
    ]);
  }
});

test("a numeric binding compiles to val, not to text", () => {
  for (const themeId of THEME_IDS) {
    const nodes = layoutFor(themeId, "gradient-slider")(
      { pct: bindingNumber("$light.brightnessPct"), ramp: "brightness" },
      { w: 420, h: 98 },
      styleOf(themeId),
    );
    const { records, bindings } = emitNodes(nodes, emitThemeFor(themeId), emitAt(1));
    assert.equal(records[0].type, "Slider");
    assert.deepEqual(bindings, [
      { page: "home", objname: records[0].objname, attribute: "val", path: "$light.brightnessPct" },
    ]);
  }
});

test("a literal is compiled as itself and binds nothing", () => {
  for (const themeId of THEME_IDS) {
    const nodes = layoutFor(themeId, "label")({ text: literal("Living Room") }, { w: 400, h: 32 }, styleOf(themeId));
    const { records, bindings } = emitNodes(nodes, emitThemeFor(themeId), emitAt(0));
    assert.equal(records[0].attributes.txt, "Living Room");
    assert.deepEqual(bindings, []);
  }
});

// The thermostat's buttons: one Button each, which is the face, the words and the touch. Lit, the face and the
// words switch at run time, and the glass draws the press in the theme's `pressed` itself, whatever face the runtime wrote.
test("a row that is a button is one Button: its face and its words switch with the row, the press is the glass's, and the tap is its own", () => {
  for (const themeId of THEME_IDS) {
    const color = emitThemeFor(themeId).color;
    const nodes = layoutFor(themeId, "list-row", "button")(
      { label: binding("$thermostat.modes.1.label", "Heat"), on: bindingNumber("$thermostat.modes.1.on"), change: { kind: "report", event: "thermostat.row" } },
      { w: 206, h: 78 }, styleOf(themeId),
    );
    const { records, bindings } = emitNodes(nodes, emitThemeFor(themeId), emitAt(7));
    assert.deepEqual(records.map((r) => r.type), ["Button"], `${themeId}: one Button, and nothing over it to take the press`);
    const b = records[0];
    assert.deepEqual([b.x, b.y, b.w, b.h, b.attributes.xcen, b.attributes.ycen, b.attributes.sta, b.attributes.txt], [37, 11, 206, 78, 1, 1, 1, "Heat"],
      `${themeId}: the whole box, a flat face, the words centred`);
    assert.deepEqual([b.attributes.bco2, b.attributes.pco2], [color("pressed"), color("text-primary")], `${themeId}: pressed, the theme's own, and the plain words`);
    const bound = (attribute) => bindings.find((x) => x.objname === b.objname && x.attribute === attribute);
    assert.deepEqual(bound("bco"), { page: "home", objname: b.objname, attribute: "bco", path: "$thermostat.modes.1.on", kind: "switch", on: color("accent-blue"), off: color("plan-card") },
      `${themeId}: the face lit in the accent, and the cards' when not`);
    assert.deepEqual(bound("pco"), { page: "home", objname: b.objname, attribute: "pco", path: "$thermostat.modes.1.on", kind: "switch", on: color("background"), off: color("text-primary") },
      `${themeId}: the words in the page's dark on the accent, as the keyboard's OK key`);
    assert.equal(bound("txt").path, "$thermostat.modes.1.label", `${themeId}: the words bound`);
    assert.ok(b.events?.some((e) => e.event === "up" && e.lines.join("\n").includes("printh")), `${themeId}: the tap is the Button's own`);
    // and its long press, as every row's: the Button arms the hold's Timer
    const held = emitNodes(layoutFor(themeId, "list-row", "button")(
      { label: literal("Heat"), on: literalNumber(0), change: { kind: "report", event: "thermostat.row" }, hold: { kind: "report", event: "thermostat.rowHold" } },
      { w: 206, h: 78 }, styleOf(themeId),
    ), emitThemeFor(themeId), emitAt(7)).records;
    assert.deepEqual(held.map((r) => r.type).sort(), ["Button", "Timer"], `${themeId}: a row's hold is the button's too`);
    assert.ok(held.find((r) => r.type === "Button").events.some((e) => e.event === "down"), `${themeId}: the press arms it`);
  }
});

test("a counter with a face is one Button: the icon alone, in the counter's colour, on the cards' face, with no number", () => {
  for (const themeId of THEME_IDS) {
    const color = emitThemeFor(themeId).color;
    const nodes = layoutFor(themeId, "zone-counter", "face")(
      {
        count: binding("$thermostat.plus.count"), icon: binding("$thermostat.plus.icon", "add"),
        iconColor: colorBinding("$thermostat.plus.iconColor", "text-primary"), tap: { kind: "report", event: "thermostat.count" },
      },
      { w: 78, h: 78 }, styleOf(themeId),
    );
    const { records, bindings } = emitNodes(nodes, emitThemeFor(themeId), emitAt(3));
    assert.deepEqual(records.map((r) => r.type), ["Button"], `${themeId}: one Button, and nothing over it`);
    const b = records[0];
    assert.deepEqual([b.attributes.bco, b.attributes.bco2, b.w, b.h], [color("plan-card"), color("pressed"), 78, 78], `${themeId}: the cards' face, the theme's pressed`);
    assert.deepEqual(bindings.map((x) => `${x.attribute} ${x.path} ${x.kind ?? ""}`).sort(),
      ["pco $thermostat.plus.iconColor ", "txt $thermostat.plus.icon glyph"], `${themeId}: its glyph and its colour bound, and no number`);
  }
});

test("an object name fits the 14 characters a .HMI allows", () => {
  for (const { themeId, componentId, nodes } of everyLayout()) {
    const { records } = emitNodes(nodes, emitThemeFor(themeId), emitAt(999));
    for (const record of records) {
      assert.ok(record.objname.length <= 14, `${themeId}/${componentId} produced "${record.objname}"`);
      assert.match(record.objname, /^[A-Za-z_][A-Za-z0-9_]*$/, `"${record.objname}" is not a usable Nextion name`);
    }
  }
});

test("a bound colour reaches the manifest as pco, and the page starts on a real token", () => {
  // `statusUpdate~icon1~color1~icon2~color2`: the panel sends the colour, and
  // `pco` is writable from Berry. What must NOT happen is the page starting
  // blank while it waits, so the declared token is compiled in.
  for (const themeId of THEME_IDS) {
    const nodes = layoutFor(themeId, "status-icon")(
      { role: "power", color: colorBinding("$status.left.color", "icon-low-sat"), side: "left" },
      { w: 40, h: 32 }, styleOf(themeId),
    );
    const { records, bindings } = emitNodes(nodes, emitThemeFor(themeId), emitAt(0));
    const icon = records.find((r) => r.attributes?.pco !== undefined && r.type === "Text");
    assert.ok(icon, `${themeId} drew no glyph for a status icon`);
    assert.notEqual(icon.attributes.pco, undefined);
    assert.deepEqual(
      bindings.filter((b) => b.attribute === "pco"),
      [{ page: "home", objname: icon.objname, attribute: "pco", path: "$status.left.color" }],
    );
  }
});

test("navigation is honoured on the glass, with no ESP32 in the path", () => {
  // The one action a panel can carry out alone, and what makes a generated
  // `.tft` walkable before any Berry exists.
  for (const themeId of THEME_IDS) {
    const nodes = layoutFor(themeId, "nav-header")(
      { title: literal("Home"), next: { kind: "navigate", screen: "settings" } },
      { w: 450, h: 60 }, styleOf(themeId),
    );
    const { records, events } = emitNodes(nodes, emitThemeFor(themeId), emitAt(0));
    const touch = records.filter((r) => r.type === "Hotspot");
    assert.equal(touch.length, 1, `${themeId} drew ${touch.length} targets for one arrow`);
    assert.deepEqual(touch[0].events, [{ event: "up", lines: ["page settings"] }]);
    assert.deepEqual(events, [], "a navigation needs nothing reported");
  }
});

test("an arrow with nowhere to go is not drawn at all", () => {
  // NO_NAV. A dimmed-looking control the finger can still press is worse than
  // no control, and on the glass there is no dimming anyway.
  for (const themeId of THEME_IDS) {
    const nodes = layoutFor(themeId, "nav-header")({ title: literal("Settings") }, { w: 450, h: 60 }, styleOf(themeId));
    const { records } = emitNodes(nodes, emitThemeFor(themeId), emitAt(0));
    assert.equal(records.filter((r) => r.type === "Hotspot").length, 0, `${themeId} left a touch target with no destination`);
  }
});

test("a switch is a dual-state button, and its art is two pictures", () => {
  // It keeps its own state and repaints on tap without waiting for the ESP32,
  // which is the whole reason to use one on a panel that may have no network.
  for (const themeId of THEME_IDS) {
    const pictures = [];
    const nodes = layoutFor(themeId, "toggle-switch")({ on: literalNumber(0) }, { w: 90, h: 44 }, styleOf(themeId));
    const { records } = emitNodes(nodes, emitThemeFor(themeId, pictures), emitAt(0));
    const button = records.find((r) => r.type === "ButtonT");
    assert.ok(button, `${themeId} did not draw a dual-state button`);
    assert.equal(pictures.length, 2, `${themeId} asked for ${pictures.length} switch pictures, not one per state`);
    assert.deepEqual(pictures.map((p) => p.side), ["left", "right"]);
    assert.notEqual(button.attributes.pic, button.attributes.pic2, "both states cannot be the same picture");
  }
});

test("the switch art puts the knob at opposite ends, and nowhere else", () => {
  // The two states are mirror images. If they were not, the knob would appear to
  // jump by a pixel or two on every tap, which is the kind of thing that looks
  // like a loose connection.
  const base = { kind: "switch", width: 60, height: 32, radius: 16, track: 0x00aaf7, knob: 0xffffff, background: 0x181c18 };
  const left = picturePixels({ ...base, side: "left" });
  const right = picturePixels({ ...base, side: "right" });
  const at = (px, x, y) => px[(y * 60 + x) * 2] | (px[(y * 60 + x) * 2 + 1] << 8);
  const white = 0xffff;
  assert.equal(at(left, 16, 16), white, "the knob is not at the left end of the off state");
  assert.equal(at(right, 44, 16), white, "the knob is not at the right end of the on state");
  assert.notEqual(at(left, 44, 16), white, "the off state has a knob at the right end too");
  assert.notEqual(at(right, 16, 16), white, "the on state has a knob at the left end too");
});

// --- the generated pictures: what the gradient costs and what it looks like ---

test("two sliders wanting the same ramp at the same size are one picture", () => {
  // Without this the light detail screen would be fine -- three ramps, three
  // pictures -- and a screen with two brightness sliders would quietly carry
  // 26 880 bytes of identical pixels twice.
  for (const themeId of THEME_IDS) {
    const pictures = [];
    const theme = emitThemeFor(themeId, pictures);
    const nodes = layoutFor(themeId, "gradient-slider")(
      { pct: literalNumber(50), ramp: "hue" }, { w: 420, h: 98 }, styleOf(themeId),
    );
    for (const index of [0, 1, 2]) emitNodes(nodes, theme, emitAt(index));
    assert.equal(pictures.length, 1, `${themeId} asked for ${pictures.length} pictures where one would do`);
  }
});

test("both halves of the track point at the same picture", () => {
  // A Slider draws `pic1` up to the value and `pic` past it. Two pictures would
  // cost twice the bytes for the same look -- which is exactly what joBr99's
  // 335x44 sliders do, at 3 144 bytes each.
  for (const themeId of THEME_IDS) {
    const nodes = layoutFor(themeId, "gradient-slider")(
      { pct: literalNumber(50), ramp: "hue" }, { w: 420, h: 98 }, styleOf(themeId),
    );
    const { records } = emitNodes(nodes, emitThemeFor(themeId), emitAt(0));
    const a = records[0].attributes;
    assert.equal(a.pic, a.pic1, `${themeId} pays for two pictures where one shows the same ramp`);
    assert.equal(a.sta, 2, "image mode, which is what every one of joBr99's 18 sliders uses");
  }
});

test("a slider's touch is its whole placement, and the ramp only the rail drawn in it", () => {
  // A Nextion Slider takes its touch where its box is, so the box is the whole
  // placement and not the drawn rail, or its finger room would take no touch:
  // 32 px, and 12 on a compact rail. The picture covers the box, the ramp a band across its middle and the page's colour
  // above and below it, which the codec pays for with one run a row.
  for (const themeId of THEME_IDS) {
    for (const variant of variantsOf(themeId, "gradient-slider")) {
      const pictures = [];
      const nodes = layoutFor(themeId, "gradient-slider", variant)(
        { pct: literalNumber(50), ramp: "hue" }, { w: 420, h: 78 }, styleOf(themeId),
      );
      const { records } = emitNodes(nodes, emitThemeFor(themeId, pictures), emitAt(0));
      const slider = records.find((r) => r.type === "Slider");
      assert.deepEqual([slider.w, slider.h], [420, 78], `${themeId}/${variant}: the slider is ${slider.w}x${slider.h}, not its placement`);
      assert.equal(pictures.length, 1);
      assert.deepEqual([pictures[0].width, pictures[0].height], [420, 78], "the picture is the Slider's box");
      assert.ok(pictures[0].band !== undefined && pictures[0].band <= 40, `${themeId}/${variant}: the rail is a band, ${pictures[0].band} rows`);
      const pixels = rampPixels(pictures[0]);
      const at = (x, y) => pixels[(y * 420 + x) * 2] | (pixels[(y * 420 + x) * 2 + 1] << 8);
      assert.equal(at(210, 0), at(10, 0), "the row above the band is the page, one colour");
      assert.notEqual(at(210, 39), at(10, 39), "the middle row is the ramp");
    }
  }
});

test("a ramp picture is exactly w*h*2 bytes, and its rows are identical", () => {
  const spec = { ramp: "hue", width: 64, height: 8, radius: 4, background: 0x181c18, dither: false };
  const pixels = rampPixels(spec);
  assert.equal(pixels.length, 64 * 8 * 2, "anything else makes the .HMI `.i` entry malformed");
  // The ramp is horizontal, so the middle band repeats. A row that differed
  // would mean the corner blending had leaked out of the corners.
  for (let x = 0; x < 64; x++) {
    const a = (3 * 64 + x) * 2;
    const b = (4 * 64 + x) * 2;
    assert.equal(pixels[a], pixels[b], `rows 3 and 4 differ at x=${x}`);
  }
});

test("the rounded ends are the page's colour and the middle is the ramp", () => {
  const spec = { ramp: "hue", width: 64, height: 16, radius: 8, background: 0x181c18, dither: false };
  const pixels = rampPixels(spec);
  const at = (x, y) => pixels[(y * 64 + x) * 2] | (pixels[(y * 64 + x) * 2 + 1] << 8);
  const bg565 = ((0x18 >> 3) << 11) | ((0x1c >> 2) << 5) | (0x18 >> 3);
  assert.equal(at(0, 0), bg565, "the top-left corner is outside the pill");
  assert.equal(at(63, 15), bg565, "and so is the bottom-right one");
  assert.notEqual(at(32, 8), bg565, "the middle of the track has to be the ramp");
});

test("dithering is only worth it where the ramp actually bands", () => {
  // "Flat is cheap and dither is expensive, full stop" is false on the hue wheel: 420 pixels of hue land on 250 distinct
  // RGB565 values, so there is no band to smooth and dithering changes nothing.
  // Brightness and colour temperature land on 64 and 42, which IS banding, and
  // smoothing them costs five to eight times the transitions.
  const runs = (pixels) => {
    let n = 1;
    for (let i = 1; i < pixels.length / 2; i++)
      if (pixels[i * 2] !== pixels[(i - 1) * 2] || pixels[i * 2 + 1] !== pixels[(i - 1) * 2 + 1]) n++;
    return n;
  };
  const at = (ramp, dither) => runs(rampPixels({ ramp, width: 420, height: 32, radius: 0, background: 0x181c18, dither }));

  for (const ramp of ["brightness", "color-temp"]) {
    assert.ok(autoDither(ramp, 420), `${ramp} bands at 420 px and should be dithered`);
    assert.ok(at(ramp, true) > at(ramp, false) * 3, `${ramp}: flat ${at(ramp, false)}, dithered ${at(ramp, true)}`);
  }

  assert.equal(autoDither("hue", 420), false, "the hue wheel does not band at 420 px");
  // and the reason it does not: it already uses more distinct colours than a
  // four-pixel band limit allows room for
  assert.ok(at("hue", false) > at("brightness", false) * 3, "hue is high-frequency before anything is dithered");
});

test("auto dither: on where it makes sense, and only there", () => {
  // the two ramps dither helps, at a width where the bands would show
  assert.equal(defaultDither("brightness", 420), true);
  assert.equal(defaultDither("color-temp", 420), true);
  // hue never: 250 colours already change almost every pixel, dither is noise
  assert.equal(defaultDither("hue", 420), false);
  for (const w of [60, 200, 480]) assert.equal(defaultDither("hue", w), false, `hue at ${w} px`);
  // a narrow brightness track has steps under 4 px, which read as a gradient already
  assert.equal(autoDither("brightness", 200), false);
  assert.equal(defaultDither("brightness", 200), false);
});

test("every theme file opens with the DRAWING FOR THE GLASS block that points at docs/09", () => {
  const dir = join(workspace, "layout", "src", "themes");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  assert.ok(files.length >= THEME_IDS.length, `${files.length} theme files for ${THEME_IDS.length} registered themes`);
  for (const f of files) {
    const head = readFileSync(join(dir, f), "utf8").split("\n").slice(0, 60).join("\n");
    assert.match(head, /DRAWING FOR THE GLASS -- read docs\/09-drawing-for-the-glass\.md/, `${f} lacks the block`);
    // and the block is the whole short form, not just the pointer
    for (const line of ["colour", "text", "shape", "pictures", "touch", "budget"]) assert.match(head, new RegExp(`^//   ${line} `, "m"), `${f}: ${line} line`);
  }
  // the doc it points at exists, so the pointer is not a promise
  assert.ok(readFileSync(join(workspace, "..", "..", "docs", "09-drawing-for-the-glass.md"), "utf8").includes("DRAWING FOR THE GLASS"));
});

test("a narrow ramp does not band, however slow it is", () => {
  // `autoDither` is not a property of the ramp: the same brightness ramp that
  // needs dithering across 420 pixels does not need it across 210, because the
  // steps are already under half a millimetre on this glass.
  assert.equal(autoDither("brightness", 420), true);
  assert.equal(autoDither("brightness", 210), false);
});

test("the CSS gradient and the generated pixels come from the same stops", () => {
  // One declaration, two renderings -- the reason `basePalette.ts` stopped
  // spelling out its own `linear-gradient(...)` strings.
  for (const [id, gradient] of Object.entries(RAMPS)) {
    const css = cssGradient(gradient);
    for (const stop of gradient.stops)
      assert.ok(css.includes(`#${stop.rgb.toString(16).padStart(6, "0")}`), `${id}'s CSS is missing a stop`);
    assert.equal(sampleGradient(gradient, 0), gradient.stops[0].rgb, `${id} does not start on its first stop`);
    assert.equal(sampleGradient(gradient, 1), gradient.stops[gradient.stops.length - 1].rgb, `${id} does not end on its last`);
  }
});

test("a picture's identity covers everything that changes its pixels", () => {
  // Deduplication keys on this. A field it forgot would hand back the id of a
  // DIFFERENT picture, and the slider would draw someone else's ramp.
  const base = { ramp: "hue", width: 420, height: 32, radius: 16, background: 0x181c18, dither: false };
  const variants = [
    { ...base, ramp: "brightness" },
    { ...base, width: 210 },
    { ...base, height: 24 },
    { ...base, radius: 0 },
    { ...base, background: 0x000000 },
    { ...base, dither: true },
  ];
  const keys = new Set([pictureKey(base), ...variants.map(pictureKey)]);
  assert.equal(keys.size, variants.length + 1, "two different pictures share a key");
  for (const v of variants)
    assert.notDeepEqual(rampPixels(v), rampPixels(base), `${pictureKey(v)} produces the same pixels as the baseline`);
});

// --- what gets off the glass ------------------------------------------------

test("the frame is CRC-16/MODBUS, checked against the standard vector", () => {
  // Not a round trip against my own implementation, which would agree with
  // itself however wrong it was. 0x4B37 over "123456789" is the published check
  // value for CRC-16/MODBUS, and it is what `crc16` in nextion_driver.be
  // computes with its default polynomial.
  const bytes = [..."123456789"].map((c) => c.charCodeAt(0));
  assert.equal(crc16Modbus(bytes), 0x4b37);
});

test("a frame is header, length, payload and CRC, and the CRC covers the rest", () => {
  const payload = "ev,home,bCard1,tap";
  const frame = encodeFrame(payload);
  assert.deepEqual(frame.slice(0, 2), [0x55, 0xbb], "the header berry/nextion_driver.be splits on");
  assert.deepEqual(frame.slice(2, 4), [payload.length & 0xff, payload.length >> 8], "length is u16 little-endian");
  assert.equal(String.fromCharCode(...frame.slice(4, 4 + payload.length)), payload);
  const crc = crc16Modbus(frame.slice(0, -2));
  assert.deepEqual(frame.slice(-2), [crc & 0xff, crc >> 8]);
  // and the driver takes msg[4..-3] as the payload, which is exactly this span
  assert.equal(frame.length, payload.length + 6);
});

test("the whole frame is one printh, because our payloads are compile-time constants", () => {
  // joBr99 needs eleven instructions and a scratch Text per page, because his
  // payload is built on the panel. Ours is known when the page is written.
  const line = printhFrame("ev,home,bCard1,tap");
  assert.match(line, /^printh( [0-9A-F]{2})+$/);
  assert.equal(line.split(" ").length - 1, encodeFrame("ev,home,bCard1,tap").length);
});

test("a long press is timed ON THE GLASS, and the tap is suppressed when it fires", () => {
  // This is the check that the corrected claim is really implemented. joBr99's
  // `tmLP` proves the panel can do it: press arms, release disarms, 500 ms
  // fires. An earlier version of `emit.ts` said it was impossible.
  for (const themeId of THEME_IDS) {
    const nodes = layoutFor(themeId, "light-card")(
      {
        name: literal("Ceiling"), icon: "lightOff", iconColor: colorToken("icon-off"),
        tap: { kind: "report", event: "light.toggle" },
        hold: { kind: "report", event: "light.detail" },
      },
      { w: 105, h: 122 }, styleOf(themeId),
    );
    const { records } = emitNodes(nodes, emitThemeFor(themeId), emitAt(1));
    const timer = records.find((r) => r.type === "Timer");
    assert.ok(timer, `${themeId} drew no timer for a long press`);
    assert.equal(timer.attributes.tim, HOLD_MS, "500 ms, measured on joBr99's tmLP (tim = 244,1)");
    assert.equal(timer.attributes.en, 0, "armed by the press, not by the page loading");

    const target = records.find((r) => r.events?.some((e) => e.event === "down"));
    assert.ok(target, `${themeId} armed no timer on press`);
    const down = target.events.find((e) => e.event === "down").lines;
    const up = target.events.find((e) => e.event === "up").lines;
    assert.deepEqual(down, [`${timer.objname}.en=1`]);
    assert.ok(up[0].startsWith(`if(${timer.objname}.en==1)`), "the tap has to check the timer first");
    assert.ok(up.some((l) => l.includes("printh 55 BB")), "and send the tap frame inside it");
    assert.ok(timer.events[0].lines.some((l) => l.includes("printh 55 BB")), "the hold frame is the timer's");
  }
});

test("a slider's report carries its value: joBr99's recipe on release, and on the drag only where live says", () => {
  const slider = (live, liveFlag) => {
    const nodes = layoutFor("lovelace-jobr99", "gradient-slider")(
      { pct: literalNumber(40), ramp: "brightness", change: { kind: "report", event: "light.brightness" }, live },
      { w: 420, h: 78 }, styleOf("lovelace-jobr99"),
    );
    return emitNodes(nodes, emitThemeFor("lovelace-jobr99"), { ...emitAt(1), liveFlag });
  };
  // release: the value is appended on the glass, so the frame is built there, instruction for instruction as he does
  const { records, events, helpers } = slider("auto", "screensaver.vaLive");
  const h = records.find((r) => r.type === "Slider");
  // a solid pointer: psta=1 is an image pointer, and with no pic2 it draws none
  assert.equal(h.attributes.psta, 0);
  const up = h.events.find((e) => e.event === "up").lines;
  assert.equal(up[0], 'vaSend.txt="ev,home,h1,change,"', "the payload prefix, the value to follow");
  assert.equal(up[1], "covx h1.val,vaTmp.txt,0,0", "the slider's own value as text");
  assert.ok(up.includes("crcrest 1,0xffff") && up.includes("prints crcval,2"), "a real CRC, computed on the glass");
  assert.ok(up.includes("printh 55 bb") && up.includes("prints sys0,2"), "header and length, like every other frame");
  assert.deepEqual(helpers, ["value-frame"], "and the page is asked for the two scratch Variables once");
  // the manifest marks both reports as carrying a value, about the dimension
  assert.deepEqual(events.map((e) => [e.gesture, e.value === true]), [["change", true], ["slide", true]]);
  // auto: the drag report exists and is gated by the panel's own Variable, then by the cooldown timer
  const slide = h.events.find((e) => e.event === "slide").lines;
  assert.equal(slide[0], "if(screensaver.vaLive.val==1)");
  assert.ok(slide.some((l) => l.trim() === "if(tmSlh1.en==0)"), "a 100 ms cooldown per slider, joBr99's tmCooldown");
  const timer = records.find((r) => r.type === "Timer");
  assert.equal(timer.attributes.tim, 100);
  // live: the drag report is only gated by the cooldown
  const on = slider(true, "screensaver.vaLive").records.find((r) => r.type === "Slider").events.find((e) => e.event === "slide").lines;
  assert.equal(on[0], "if(tmSlh1.en==0)");
  // release-only: no drag report, no timer
  const off = slider(false, "screensaver.vaLive");
  assert.equal(off.records.find((r) => r.type === "Slider").events.some((e) => e.event === "slide"), false);
  assert.equal(off.records.some((r) => r.type === "Timer"), false);
  assert.deepEqual(off.events.map((e) => e.gesture), ["change"]);
  // auto with nothing to read is release-only too
  assert.equal(slider("auto", undefined).records.find((r) => r.type === "Slider").events.some((e) => e.event === "slide"), false);
  // and the recipe's frame IS the frame encodeFrame would make for the same payload
  const payload = "ev,page,h1,change,40";
  const frame = encodeFrame(payload);
  assert.equal(frame.length, 4 + payload.length + 2);
});

test("a switch that mirrors a Variable writes it in the touch that reports the change", () => {
  const nodes = layoutFor("lovelace-jobr99", "toggle-switch")(
    { on: literalNumber(0), change: { kind: "report", event: "toggle.change" }, mirror: "screensaver.vaLive" },
    { w: 110, h: 98 }, styleOf("lovelace-jobr99"),
  );
  const { records } = emitNodes(nodes, emitThemeFor("lovelace-jobr99"), emitAt(3));
  const bt = records.find((r) => r.type === "ButtonT");
  const up = bt.events.find((e) => e.event === "up").lines;
  assert.equal(up[0], "screensaver.vaLive.val=btSwitch3.val", "the Variable first, so the sliders see it before anything else");
  assert.ok(up.some((l) => l.startsWith("printh 55 BB")), "then the report");
});

test("a touch target that mirrors flips the Variable as 1-x, the form the Editor compiles", () => {
  const { records } = emitNodes([{
    kind: "touch", id: "mRow", box: { x: 0, y: 0, w: 200, h: 78 },
    action: { kind: "report", event: "settings.row" }, mirror: "screensaver.vaLive",
  }], emitThemeFor("lovelace-jobr99"), emitAt(0));
  const up = records.find((r) => r.type === "Hotspot").events.find((e) => e.event === "up").lines.map((l) => l.trim());
  assert.ok(up.includes("screensaver.vaLive.val=1-screensaver.vaLive.val"));
  // `x.val=x.val==0` is refused: "Invalid Variables"
  assert.equal(up.some((l) => /^[\w.]+=[^=]*==/.test(l)), false, "never a comparison as the value of an assignment");
});

test("an icon role decided at run time is a glyph binding: the wire carries the role, the runtime owns the glyph", () => {
  for (const themeId of THEME_IDS) {
    const nodes = layoutFor(themeId, "light-card")(
      { name: literal("Ceiling"), icon: binding("$lights.0.icon", "lightOff"), iconColor: colorToken("icon-off") },
      { w: 105, h: 122 }, styleOf(themeId),
    );
    const { records, bindings } = emitNodes(nodes, emitThemeFor(themeId), emitAt(1));
    const glyph = bindings.find((b) => b.kind === "glyph");
    assert.ok(glyph, `${themeId}: a glyph binding`);
    assert.equal(glyph.path, "$lights.0.icon");
    assert.equal(glyph.attribute, "txt");
    const icon = records.find((r) => r.objname === glyph.objname);
    assert.equal(icon.attributes.txt, emitThemeFor(themeId).glyph("lightOff"), "the page starts on the sample role's glyph");
  }
});

test("a tap with no long press needs no timer at all", () => {
  for (const themeId of THEME_IDS) {
    const nodes = layoutFor(themeId, "toggle-switch")(
      { on: literalNumber(0), change: { kind: "report", event: "toggle.change" } },
      { w: 90, h: 44 }, styleOf(themeId),
    );
    const { records } = emitNodes(nodes, emitThemeFor(themeId), emitAt(0));
    assert.equal(records.filter((r) => r.type === "Timer").length, 0);
    const button = records.find((r) => r.type === "ButtonT");
    assert.deepEqual(button.events, [{ event: "up", lines: [printhFrame("ev,home,btSwitch0,tap")] }]);
  }
});

test("a node too thin to be a component is dropped, and said", () => {
  // The Editor refuses a side below 2, so a one-pixel rule is not
  // a thin component -- it is not a component. Found the hard way: compiling
  // shadcn-dark for the first time produced separators of 1x90 and a header rule
  // of 420x1, and the Editor rejected the whole file.
  //
  // Dropped and REPORTED, because a rule that silently stopped existing is worse
  // than one that never compiled.
  const theme = emitThemeFor(THEME_IDS[0]);
  const hairline = [
    { kind: "fill", id: "fThin", box: { x: 0, y: 0, w: 420, h: 1 }, color: "card-border" },
    { kind: "fill", id: "fFat", box: { x: 0, y: 2, w: 420, h: 2 }, color: "card-border" },
  ];
  const { records, dropped } = emitNodes(hairline, theme, emitAt(0));
  assert.equal(records.length, 1, "the 2-pixel one is a component and the 1-pixel one is not");
  assert.equal(records[0].objname, "fFat0");
  assert.deepEqual(dropped.map((d) => [d.id, d.w, d.h]), [["fThin", 420, 1]]);
});

test("no theme asks for a border the panel cannot draw", () => {
  // `borderWidth: 1` is a CSS hairline. On this glass a border IS a component,
  // so it is either absent or at least MIN_SIDE. `core` refuses anything else;
  // this holds the documents to it from the other side.
  for (const themeId of THEME_IDS) {
    const width = themes[themeId].style.borderWidth;
    assert.ok(
      width === 0 || width >= MIN_SIDE,
      `${themeId} asks for a ${width}px border, which compiles to nothing`,
    );
  }
});

// A whole degree, with the tenth deciding on magnitude: .0-.5 keeps the degree,
// .6 and up goes to the next. Written as a table because the interesting cases are the ones nobody pictures -- the exact half,
// the same half below zero, and the -0 that a sign-and-floor produces if
// nothing catches it.
test("a temperature rounds at .6, not at .5, and the same way below zero", () => {
  const table = [
    [0, 0], [0.4, 0], [0.5, 0], [0.6, 1], [0.9, 1],
    [17.9, 18], [18.0, 18], [18.4, 18], [18.5, 18], [18.6, 19], [18.9, 19],
    // the mirror of every line above, so the rule does not change at freezing
    [-0.4, 0], [-0.5, 0], [-0.6, -1],
    [-18.4, -18], [-18.5, -18], [-18.6, -19],
    [-9.5, -9], [-9.6, -10], [-40.6, -41],
    [99.6, 100], [-100.5, -100],
  ];
  for (const [given, want] of table) assert.equal(roundTempC(given), want, `${given} -> ${want}`);
  // -0 prints as "-0" and would reach the glass that way
  assert.ok(!Object.is(roundTempC(-0.5), -0), "-0.5 must not produce negative zero");
  assert.equal(formatTempC(-0.5), "0°C");
});

test("a cell with no reading says so, and every other one carries the unit", () => {
  assert.equal(formatTempC(null), NO_READING);
  assert.equal(formatTempC(18.5), "18°C");
  assert.equal(formatTempC(-18.6), "-19°C");
  // no decimal survives, which is the point of the change
  for (const v of [18.1, -3.7, 0.5]) assert.ok(!formatTempC(v).includes("."), `${v} still shows a decimal`);
});

// The four small cells hold every form; the big first one is the tight one, and
// this pins the measurement so a font or a box that changes says so here rather
// than on the glass, where a run too wide is clipped in silence.
test("every temperature a small weather cell can show fits it, in every theme", async () => {
  const { readZi, layoutZiText } = await import("../../export/dist/index.js");
  // through the formatter, so the strings checked are the ones it really emits
  const forms = [formatTempC(null), formatTempC(18.4), formatTempC(-18.6), formatTempC(-100.2), formatTempC(99.6)];
  for (const themeId of THEME_IDS) {
    const doc = JSON.parse(readFileSync(join(workspace, "themes", themeId, "theme.json"), "utf8"));
    const token = doc.fonts.find((f) => f.role === "body");
    const font = readZi(new Uint8Array(readFileSync(join(workspace, "themes", themeId, token.file))));
    for (const form of forms) {
      const { advance, missing } = layoutZiText(font, form);
      assert.equal(missing.length, 0, `${themeId}/body has no glyph for ${JSON.stringify(form)}`);
      // the narrower of the two panels: us-portrait's row is 290 px over 5 cells
      assert.ok(advance <= 58, `${themeId}/body draws "${form}" in ${advance} px, past the 58 px cell`);
    }
  }
});

// A HANDLER A THEME QUIETLY DROPS. A theme whose header ignores `onEditTitle`
// would compile into a panel with keyboard pages and nothing that opens them,
// and every check upstream would be happy because a missing Hotspot is not a
// wrong byte. The generator refuses it (`build-project-hmi.mjs`); this is the same rule where the layouts live, so a
// fourth theme meets it before a project does.
test("every theme draws a touch for every action a component is given", () => {
  const ACTION_PROPS = {
    "nav-header": ["close", "editTitle", "prev", "next", "action"],
    "light-card": ["tap", "hold"],
    "toggle-switch": ["change"],
    "list-row": ["change", "hold", "tailHold"],
    "zone-counter": ["tap", "hold"],
    "page-rail": ["change"],
    "pattern-pad": ["drawn"],
  };
  for (const themeId of THEME_IDS) {
    for (const [componentId, props] of Object.entries(ACTION_PROPS)) {
      for (const prop of props) {
        const action = { kind: "report", event: `probe.${prop}` };
        const base = {
          title: literal("Home"), name: literal("Lamp"), icon: "lightOn",
          iconColor: colorToken("accent"), on: literalNumber(1),
          label: literal("Live update"), page: literalNumber(0), pageCount: literalNumber(2),
          // a tail, so a tail's long press has something to be the long press of
          tail: literal("1,1"), count: literal("12"), wrong: literalNumber(0),
        };
        const nodes = layoutFor(themeId, componentId)({ ...base, [prop]: action }, { w: 420, h: 110 }, styleOf(themeId));
        assert.ok(
          JSON.stringify(nodes).includes(JSON.stringify(action)),
          `${themeId}/${componentId} was given "${prop}" and draws nothing that carries it`,
        );
      }
    }
  }
});

// SETTINGS SHOWS THREE ROWS ON THE EU PANEL: at least three there, at the same spacing on the US portrait -- and a row may
// not shrink under the 12 mm every theme declares for it, so the room came out
// of the gaps (`SCREEN_GEOMETRY.rowGap`, `headerGap`) and not out of the rows.
test("Settings holds three rows on the EU panel and five on the US, at one pitch, none under its touch floor", () => {
  // the visible area of each panel (core's DEVICE_VISIBLE) and its density
  // (DEVICE_PX_PER_MM), which `layout` cannot import
  const panels = {
    "eu-landscape": { grid: { w: 450, h: 320 }, pxPerMm: 450 / 69.2, rows: 3 },
    "us-portrait": { grid: { w: 320, h: 480 }, pxPerMm: 480 / 73.4, rows: 5 },
  };
  const pitches = new Set();
  for (const id of THEME_IDS) {
    const floorMm = themes[id].components.find((c) => c.id === "list-row").minTouchMm.h;
    for (const [panel, { grid, pxPerMm, rows: want }] of Object.entries(panels)) {
      const screen = listScreen(id, grid);
      const rows = screen.place.filter((p) => p.component === `${id}/list-row`);
      assert.equal(rows.length, want, `${id} on ${panel}: ${rows.length} rows`);
      // and the scrollbar is touch down to the glass's edge but DRAWN a margin
      // short of it: run to the edge, the track read as going past the list.
      // The pixels between are the slider's `tail`.
      const rail = screen.place.find((p) => p.component === `${id}/page-rail`);
      assert.equal(rail.y + rail.h, grid.h, `${id} on ${panel}: the rail's touch ends at ${rail.y + rail.h} of ${grid.h}`);
      const [track] = layoutFor(id, "page-rail")(
        { page: literalNumber(0), pageCount: literalNumber(3), change: { kind: "report", event: "list.page" } },
        { w: rail.w, h: rail.h }, styleOf(id),
      );
      const drawnTo = rail.y + track.box.y + track.box.h;
      assert.ok(drawnTo <= grid.h - SCREEN_GEOMETRY.margin, `${id} on ${panel}: the track is drawn down to ${drawnTo} of ${grid.h}`);
      assert.equal(track.box.y + track.box.h + track.tail, rail.h, `${id} on ${panel}: the tail leaves a gap under the track`);
      assert.ok(rows[0].y >= SCREEN_GEOMETRY.navHeaderHeight, `${id} on ${panel}: the first row starts under the header`);
      rows.forEach((r, k) => {
        assert.ok(r.h >= Math.round(floorMm * pxPerMm), `${id} on ${panel}: a ${r.h} px row is under ${floorMm} mm`);
        assert.ok(r.y + r.h <= grid.h, `${id} on ${panel}: row ${k} ends at ${r.y + r.h}, past the glass's ${grid.h}`);
        if (k === 0) return;
        assert.ok(r.y >= rows[k - 1].y + rows[k - 1].h, `${id} on ${panel}: rows ${k - 1} and ${k} overlap`);
        pitches.add(r.y - rows[k - 1].y);
      });
    }
  }
  assert.deepEqual([...pitches], [SCREEN_GEOMETRY.rowHeight + SCREEN_GEOMETRY.rowGap], "the panels space their rows differently");
});

// THE SCROLLBAR'S TOUCH RUNS PAST ITS DRAWING. A Nextion Slider's
// touch is where its pointer runs, so the pixels under the track are a Hotspot
// that puts the pointer at the bottom and runs the slider's own release -- the
// report is the slider's, byte for byte, and the runtime needs nothing new.
test("a tap under the scrollbar's track is the last page, reported by the slider itself", () => {
  const change = { kind: "report", event: "list.page" };
  const nodes = layoutFor("lovelace-jobr99", "page-rail")(
    { page: literalNumber(0), pageCount: literalNumber(3), change },
    { w: 78, h: 242 }, styleOf("lovelace-jobr99"),
  );
  const [track] = nodes;
  const origin = { x: 357, y: 78 };
  const { records } = emitNodes(nodes, emitThemeFor("lovelace-jobr99"), {
    pageName: "settings", origin, background: "background", index: 0, pointerVars: { x: "vaLx", y: "vaLy" },
  });
  const slider = records.find((r) => r.type === "Slider");
  const tail = records.find((r) => r.type === "Hotspot");
  assert.ok(tail, "no touch under the track");
  // right under the track, the track's width, down to the bottom of the box
  assert.deepEqual([tail.x, tail.y, tail.w, tail.h], [slider.x, slider.y + slider.h, slider.w, track.tail]);
  assert.equal(slider.y + slider.h + tail.h, origin.y + 242);
  // on a page that scrolls, a tap is one that did not travel a swipe (emit.ts:still)
  {
    const { records: guarded } = emitNodes([{
      kind: "touch", id: "mRow", box: { x: 0, y: 0, w: 387, h: 78 }, action: { kind: "report", event: "list.row" },
    }], emitThemeFor("lovelace-jobr99"), { ...emitAt(2), pointerVars: { x: "vaLx", y: "vaLy" }, still: { variable: "vaAy", below: 60 } });
    const tapLines = guarded.find((r) => r.type === "Hotspot").events.find((e) => e.event === "up").lines.map((l) => l.trim());
    assert.ok(tapLines.includes("if(vaAy.val<60)"), tapLines.join(" / "));
  }
  // the slider's own release puts the pointer on its page before it reports:
  // it stays where the finger left it otherwise
  const release = slider.events.find((e) => e.event === "up").lines;
  assert.equal(release[0], `${slider.objname}.val=${slider.objname}.val`, release.join(" / "));
  // and nothing while it is dragged: writing val at every move makes it worse on the glass
  assert.equal(slider.events.find((e) => e.event === "slide"), undefined);
  assert.ok(release.slice(1).some((l) => l.includes("printh") || l.includes("covx")), release.join(" / "));
  const up = tail.events.find((e) => e.event === "up").lines.map((l) => l.trim());
  // the Nextion's minimum is at the bottom, so the last page is val 0; then the
  // slider's OWN release sends the frame
  const set = up.indexOf(`${slider.objname}.val=0`);
  assert.ok(set >= 0 && up[set + 1] === `click ${slider.objname},0`, up.join(" / "));
  // guarded like every tap: only a finger that lets go inside it
  assert.ok(up[0].startsWith("if(vaLx.val>="), up[0]);
  // and a rail that draws nothing (one page) has nothing to tap under either
  const none = layoutFor("lovelace-jobr99", "page-rail")(
    { page: literalNumber(0), pageCount: literalNumber(1) }, { w: 78, h: 242 }, styleOf("lovelace-jobr99"),
  );
  assert.deepEqual(none, []);
});

// THE THERMOSTAT'S PAGE is the same page on both panels but for its width, built of components that already
// exist, and its bindings are what the runtime writes (berry/panel_thermostat_view.be): so they are held here, by name.
test("the thermostat's page has its two buttons around the target, two lines of words and two modes, bound to what the runtime writes", () => {
  const panels = {
    "eu-landscape": { w: 450, h: 320 },
    "us-portrait": { w: 320, h: 480 },
  };
  for (const id of THEME_IDS) {
    for (const [panel, grid] of Object.entries(panels)) {
      const where = `${id} on ${panel}`;
      const screen = thermostatScreen(id, grid);
      assert.equal(screen.role, "thermostat", where);
      const by = (component) => screen.place.filter((p) => p.component === `${id}/${component}`);
      const minus = by("zone-counter").find((p) => p.bind.count === "$thermostat.minus.count");
      const plus = by("zone-counter").find((p) => p.bind.count === "$thermostat.plus.count");
      assert.deepEqual([minus.variant, plus.variant], ["face", "face"], `${where}: the - and the + are faces`);
      const target = by("label").find((p) => p.bind.text === "$thermostat.target");
      assert.equal(by("zone-counter").length, 4, `${where}: a minus and a plus, and the row's two icons`);
      assert.equal(by("nav-header").length, 1, `${where}: one header`);
      assert.deepEqual(by("nav-header")[0].bind, { title: "$thermostat.name", onClose: "$nav.close", onEditTitle: "$thermostat.editTitle" },
        `${where}: no action in the header, the schedule is the row's`);
      assert.ok(minus.y >= SCREEN_GEOMETRY.navHeaderHeight + PAGE_BUTTON_ROW, `${where}: the target under the row`);
      for (const [button, name] of [[minus, "minus"], [plus, "plus"]]) {
        assert.deepEqual(button.bind, {
          count: `$thermostat.${name}.count`, icon: `$thermostat.${name}.icon`, iconColor: `$thermostat.${name}.iconColor`, onTap: `$thermostat.${name}.tap`,
        }, `${where}: the ${name} button`);
      }
      // the target lies between the buttons, edge to edge, and the buttons keep the margin
      assert.equal(minus.x, SCREEN_GEOMETRY.margin, `${where}: the minus keeps the margin`);
      assert.equal(minus.x + minus.w, target.x, `${where}: the target starts where the minus ends`);
      assert.equal(target.x + target.w, plus.x, `${where}: and ends where the plus starts`);
      assert.equal(plus.x + plus.w, grid.w - SCREEN_GEOMETRY.margin, `${where}: the plus keeps the margin`);
      assert.deepEqual([target.bind.tone, target.bind.align], ["title", "center"], `${where}: the target in the title's type`);
      // the lines of words, one under the other
      const lines = by("label").filter((p) => String(p.bind.text).startsWith("$thermostat.lines."));
      assert.equal(lines.length, THERMOSTAT_LINES, `${where}: the lines`);
      lines.forEach((p, k) => {
        assert.equal(p.bind.text, `$thermostat.lines.${k}`, where);
        assert.ok(p.y >= target.y + target.h, `${where}: line ${k} is under the target`);
        assert.ok(k === 0 || p.y >= lines[k - 1].y + lines[k - 1].h, `${where}: the lines do not overlap`);
      });
      // the modes, side by side to the margins, under the lines
      const modes = by("list-row").filter((p) => String(p.bind.label).startsWith("$thermostat.modes."));
      assert.equal(modes.length, THERMOSTAT_MODES, `${where}: the modes`);
      modes.forEach((p, k) => {
        assert.deepEqual(p.bind, { label: `$thermostat.modes.${k}.label`, on: `$thermostat.modes.${k}.on`, onChange: `$thermostat.modes.${k}.tap` }, `${where}: mode ${k}`);
        assert.equal(p.variant, "button", `${where}: a mode is a face`);
        assert.ok(p.y >= lines.at(-1).y + lines.at(-1).h, `${where}: mode ${k} is under the lines`);
        assert.ok(p.y + p.h <= grid.h - THERMOSTAT_FACE_GAP, `${where}: mode ${k} ends a gap above the glass's edge`);
        assert.ok(k === 0 || p.x === modes[k - 1].x + modes[k - 1].w + THERMOSTAT_FACE_GAP, `${where}: the faces side by side, a gap apart`);
      });
      assert.equal(modes[0].x, SCREEN_GEOMETRY.margin, where);
      assert.ok(modes.at(-1).x + modes.at(-1).w <= grid.w - SCREEN_GEOMETRY.margin, `${where}: the modes end inside the margin`);
      // every box is a 12 mm button or more wherever a finger lands, but what the row leaves short on the EU, which says so
      for (const p of [minus, plus, ...modes])
        assert.ok(p.h >= SCREEN_GEOMETRY.rowHeight || p.smallTouch, `${where}: a ${p.h} px box is under a row's height and says nothing`);
      assert.equal(panel === "us-portrait" ? minus.h : 0, panel === "us-portrait" ? SCREEN_GEOMETRY.rowHeight : 0, `${where}: the US keeps its 78`);
    }
  }
});

test("the row under a page's title: its icons from the left, the card with the rest, 48 px under the header, each saying it is under 12 mm", () => {
  const panels = {
    "eu-landscape": { w: 450, h: 320 },
    "us-portrait": { w: 320, h: 480 },
  };
  for (const id of THEME_IDS) {
    for (const [panel, grid] of Object.entries(panels)) {
      for (const [screen, page, icons] of [[lightDetailScreen(id, grid), "light", 3], [thermostatScreen(id, grid), "thermostat", 2], [coverScreen(id, grid), "cover", 2]]) {
        const where = `${id} ${page} on ${panel}`;
        const row = screen.place.filter((p) => String(p.bind.count ?? p.bind.label).match(new RegExp(`^[$]${page}[.](icons|card)[.]`)));
        assert.equal(row.length, icons + 1, `${where}: its icons and the card`);
        row.forEach((p, k) => {
          assert.ok(p.y >= SCREEN_GEOMETRY.navHeaderHeight && p.y + p.h <= SCREEN_GEOMETRY.navHeaderHeight + PAGE_BUTTON_ROW, `${where}: place ${k} in the row`);
          assert.ok(p.smallTouch, `${where}: place ${k} says why it is under 12 mm`);
          assert.ok(k === 0 || p.x > row[k - 1].x + row[k - 1].w, `${where}: the places side by side`);
        });
        const card = row.at(-1);
        assert.deepEqual([card.component, card.variant, card.bind.label, card.bind.visible], [`${id}/list-row`, "button", `$${page}.card.label`, `$${page}.card.shown`], where);
        row.slice(0, -1).forEach((p, k) => assert.deepEqual([p.variant, p.bind.icon, p.bind.visible], ["face", `$${page}.icons.${k}.icon`, `$${page}.icons.${k}.shown`], where));
        assert.equal(row[0].x, SCREEN_GEOMETRY.margin, `${where}: the row keeps the margin`);
      }
      // the lamp's detail: its three sliders under the row, 64 px on the EU and 78 on the US
      const detail = lightDetailScreen(id, grid);
      const sliders = detail.place.filter((p) => p.component === `${id}/gradient-slider`);
      assert.deepEqual(sliders.map((p) => p.bind.pct), ["$light.brightnessPct", "$light.colorTempPct", "$light.huePct"], id);
      assert.deepEqual([sliders[0].y, sliders[0].h], [SCREEN_GEOMETRY.navHeaderHeight + PAGE_BUTTON_ROW, panel === "eu-landscape" ? 64 : 78], `${id} on ${panel}`);
      assert.ok(sliders.at(-1).y + sliders.at(-1).h <= grid.h, `${id} on ${panel}: the sliders fit`);
      assert.deepEqual(sliders.map((p) => p.input?.live === true), [true, false, false], `${id}: the brightness written as it moves`);
    }
  }
});
