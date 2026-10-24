// A project's screens become a Nextion scenario: the compile step, at last.
//
//   node scripts/build-project-hmi.mjs living-room eu-landscape
//   node scripts/build-project-hmi.mjs living-room eu-landscape --build
//
// Everything before this turned the `.HMI` into things we could read. This goes
// the other way: it reads `projects/<id>/project.json`, takes the layout for one
// panel, and writes a scenario `build-hmi-scenario.mjs` can turn into a real
// `.HMI` -- which the Sandbox then compiles into a `.tft`.
//
// It emits a SCENARIO and not an `.HMI` directly so that the whole proven
// machine stays in the path: the scenario vocabulary is what eleven D1 measuring
// runs and the whole m1/m10/m11 corpus were written in, and what the Editor has
// already accepted. Writing a second path to the same file format would mean
// two things to keep true.
//
// The base is `eseverson-hmi/23_minimal_project_23.HMI`: one empty 480x320 page,
// no fonts, no pictures, and -- the part that matters -- the same `Modelcrc`
// 0x1ce47603 as joBr99's own file, which is the NX4832F035_011C our panel is. A
// base with the wrong model compiles happily and produces a `.tft` the panel
// refuses.
//
// Every component is laid out ONCE, in `layout/src/themes/<id>.ts`, and both the
// simulator and this script read that one answer: no second implementation of a
// component's geometry is kept in step with the React drawings by hand.
//
// WHAT "FUNCTIONAL" MEANS HERE: the pages draw, navigation
// between them works on the panel alone (`page <name>` in a Touch Release), and
// the events REPORT -- a tap sends its frame with `printh`, a slider appends its
// value on the glass and sends that (`layout/src/wire.ts`), and the brain's
// runtime (berry/panel_runtime.be), reading this project's .jsonl, splits it
// back apart. Proven by `scripts/verify-event-frames.mjs`, which
// finds every declared frame in the compiled `.tft`, exactly once.
//
// What cannot be proven here is what the glass does with these files: that is
// the panel's to show.
// Everything below says "the Editor compiled it", never "the glass accepted
// it".
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
// Built from TypeScript, so `npm run build --workspace=@nspanel-sim/layout` has to
// have run -- the same rule every other script here follows with ../dist.
import {
  BOUND_PROPS, FONT_ROLES, PAGE_OBJNAME, binding, bindingNumber, colorBinding, colorToken, emitNodes, layoutFor, layoutStyle,
  HOLD_MS, literal, literalNumber, pictureKey, printhFrame, sliderReadout, touchPayload, valueFrameLines,
} from "../../layout/dist/index.js";
// OUR rules, the same objects the simulator validates with. `export/src` never
// imports `core/` -- it describes the Editor and the format and has to stand on
// its own -- but THIS is the compile step, which puts
// `compile -> layout + core + export` on purpose.
import {
  DEVICE_VISIBLE, PLAN_CARD_RADIUS, PLAN_LEFT, PLAN_TOP, SWIPE_DIRECTIONS, checkPlacements, checkProjectAgainstThemes,
  parseProject, parseTheme, planColors, planPalette, PLAN_GLYPH_ROLES,
} from "../../core/dist/index.js";
import { readZi, ziBitmapWidth } from "../dist/font.js";
import { layoutZiText, wrapZiText, ziAdvanceTable } from "../dist/textRaster.js";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = resolve(root, "..");
const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const projectId = args[0] ?? "living-room";
const deviceId = args[1] ?? "eu-landscape";

const project = JSON.parse(readFileSync(join(workspace, "projects", projectId, "project.json"), "utf8"));

// THE FUNNEL RUNS HERE TOO. `core/` holds all three layers and the simulator runs
// them on every keystroke, and this script, the one that actually produces the
// bytes, runs them before laying anything out: otherwise the one path that
// reaches a panel would be the one with no validation on it, and a placement below
// its own theme's touch minimum, two boxes overlapping, a card binding none of
// the handlers its contract requires, a box out in the 30 columns the EU bezel
// hides would all compile, since the Editor has no opinion about any of them.
//
// Reading the same documents the simulator reads, through the same parser, is
// what makes "it is green in the browser" mean anything about the `.tft`.
const parsed = parseProject(project, `projects/${projectId}/project.json`);
const themeDocs = parsed.themes.map((id) =>
  parseTheme(
    JSON.parse(readFileSync(join(workspace, "themes", id, "theme.json"), "utf8")),
    `themes/${id}/theme.json`,
  ),
);
checkProjectAgainstThemes(parsed, themeDocs);
checkPlacements(parsed, themeDocs);

const layout = project.layouts?.[deviceId];
if (!layout) throw new Error(`${projectId} declares no ${deviceId} layout`);
if (layout.screens.length === 0) throw new Error(`${projectId}'s ${deviceId} layout has no screens yet`);

const themeId = project.themes[0];
// The themes this layout's placements draw with: the project's own first, then
// each other one it declares and a placement names.
// Every placement is resolved in ITS theme -- the
// colours, the fonts, the glyphs and the style of its layout -- and the page
// carries the fonts of every theme it draws with. What the runtime writes into a
// placement of another theme it resolves in that theme's tables, which its
// targets name by a tag ("@1"; `themeContext`). The funnel above refuses a theme
// the project does not declare.
const usedThemes = [themeId, ...project.themes.slice(1).filter((id) =>
  layout.screens.some((s) => (s.place ?? []).some((p) => String(p.component).split("/")[0] === id)))];

/**
 * How much text a box takes, by font role -- three questions with three
 * answers, all measured out of the theme's own `.zi` over the alphabet the
 * keyboard offers (letters, digits, space and a full stop).
 *
 * `textCapacity`, the widest glyph: how many characters are SURE to fit. The
 * right count for the keyboard's field, whose window slides by characters and
 * must never overflow. It is not a slot's capacity: with the narrowest place a
 * name appears deciding it everywhere, a light's name would be 6 characters long
 * on every screen because one card is 98 px.
 *
 * `bufferCapacity`, the narrowest advance: how many bytes the `txt_maxl` needs
 * so that ANY text the runtime fits to the box by width (`fitZiText`) is held
 * whole. Capped at the keyboard's own line, `RUNTIME_TEXT_MAX`.
 *
 * `typicalCapacity`, the mean lowercase advance: how many characters fit in
 * ordinary words -- what the keyboard lets the finger type for a name, taken
 * from the widest place the name is shown. A name longer than a narrower
 * place still shows there, cut with an ellipsis.
 */
const TYPEABLE = " .0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** the most a runtime text slot holds: the keyboard's own line (`kbIn`, 64 bytes) */
const RUNTIME_TEXT_MAX = 64;

/**
 * Everything one theme resolves, read once: its document, its colours, its
 * fonts in the page's font list, what its fonts measure, its glyphs, the style
 * its layouts see, and what `emitNodes` asks of it.
 *
 * The fonts, in the order they are added, chosen by ROLE. `addHmiFont` hands out
 * ids sequentially and the base has none, so a role's index is its position in
 * `FONT_ROLES` -- asserted by construction rather than assumed, because a base
 * with one font of its own would silently shift every Text on every page. A
 * theme after the project's own adds its fonts after those of the themes before
 * it, `index` times `FONT_ROLES` further on. A layout asks for a ROLE and the
 * theme answers with its own file (theme schema 5): font ids would work for one
 * theme only, since shadcn calls its title cut `title-32` and Tailwind's is
 * `title-48`.
 *
 * `tag` is "" for the project's own theme and "@<index>" for another: what the
 * runtime targets of its placements end with, and what its entries in the
 * tables' colours, glyphs and advances are named with (`generateTables`).
 */
function themeContext(id, index) {
  const doc = JSON.parse(readFileSync(join(workspace, "themes", id, "theme.json"), "utf8"));
  const iconRoles = JSON.parse(readFileSync(join(workspace, "themes", id, "fonts", "icon-roles.generated.json"), "utf8"));
  const rgb = (token) => doc.colors.find((c) => c.id === token)?.rgb565 ?? 0;
  const FONT = {};
  const FONT_FILE = {};
  FONT_ROLES.forEach((role, i) => {
    const token = doc.fonts.find((f) => f.role === role);
    if (!token) throw new Error(`${id} fills no "${role}" font role`);
    FONT[role] = index * FONT_ROLES.length + i;
    FONT_FILE[role] = token.file;
  });
  const WIDEST = {};
  const NARROWEST = {};
  const MEAN_LOWER = {};
  const ZI = {};
  for (const role of FONT_ROLES) {
    const zi = readZi(new Uint8Array(readFileSync(join(workspace, "themes", id, FONT_FILE[role]))));
    ZI[role] = zi;
    let widest = 1;
    let narrowest = Infinity;
    let lowerSum = 0;
    let lowerCount = 0;
    const byCode = new Map(zi.glyphs.map((g) => [g.code, g]));
    for (const ch of TYPEABLE) {
      const g = byCode.get(ch.codePointAt(0));
      if (!g) continue;
      widest = Math.max(widest, ziBitmapWidth(g));
      if (g.advance > 0) narrowest = Math.min(narrowest, g.advance);
      if (ch >= "a" && ch <= "z") { lowerSum += g.advance; lowerCount++; }
    }
    WIDEST[role] = widest;
    NARROWEST[role] = Number.isFinite(narrowest) ? narrowest : 1;
    MEAN_LOWER[role] = lowerCount ? lowerSum / lowerCount : widest;
  }
  /** The glyph a role resolves to, as the character the `.zi` carries. */
  const glyph = (role) => {
    // a blank role draws nothing: a list row with no icon, a counter with no kind
    if (role === "") return "";
    const entry = iconRoles[role];
    if (!entry) throw new Error(`${id} fills no icon role "${role}"`);
    return String.fromCodePoint(entry.code);
  };
  return {
    id, index, doc, iconRoles, rgb, FONT, FONT_FILE, ZI, glyph,
    tag: index === 0 ? "" : `@${index}`,
    textCapacity: (width, role) => Math.max(1, Math.floor(width / (WIDEST[role] ?? 1))),
    bufferCapacity: (width, role) => Math.max(1, Math.min(RUNTIME_TEXT_MAX, Math.floor(width / (NARROWEST[role] ?? 1)))),
    typicalCapacity: (width, role) => Math.max(1, Math.min(RUNTIME_TEXT_MAX, Math.floor(width / (MEAN_LOWER[role] ?? 1)))),
    // The style its layouts see. `doc.style` alone is not enough: a layout that
    // stacks text asks how tall its type is, and that answer comes from the
    // theme's FONTS. `fontFamily` is in the block and no layout may read it --
    // the glass has no font stack.
    style: layoutStyle(doc.style, doc.fonts),
    // The theme, as `emitNodes` needs it: five lookups and nothing else.
    // Everything a node names is a NAME -- a colour token, a font role, an icon
    // role, a screen id -- and this is the only place they turn into the numbers
    // the `.HMI` carries. A layout cannot spell out an RGB565 even by accident.
    emitTheme: {
      color: (token) => rgb(token),
      font: (role) => FONT[role],
      glyph,
      page: (screenId) => pageName(screenId),
      picture: (spec) => requestPicture(spec),
    },
  };
}
const contexts = new Map(usedThemes.map((id, i) => [id, themeContext(id, i)]));
/** the project's own theme: what is the project's and not one placement's -- its pages, its plan, its tables -- is resolved in it */
const primary = contexts.get(themeId);
const theme = primary.doc;
const iconRoles = primary.iconRoles;
const rgb = primary.rgb;
const FONT_FILE = primary.FONT_FILE;
const ZI = primary.ZI;
const glyph = primary.glyph;

const COLOR = {
  background: rgb("background"),
  screensaver: rgb("background-screensaver"),
  card: rgb("card-background"),
  textPrimary: rgb("text-primary"),
  textSecondary: rgb("text-secondary"),
  accent: rgb("accent-blue"),
  iconOff: rgb("icon-off"),
  iconOn: rgb("icon-low-sat"),
};

/** A Nextion object name: letters, digits and underscore, and short. */
const nameOf = (s, n) => (s.replace(/[^A-Za-z0-9]/g, "") + (n ?? "")).slice(0, 14);


/** Nextion page names: no dashes, and the `page` command has to name them. */
const pageName = (screenId) => nameOf(screenId);

/**
 * The objname a plan's touches report under. Like `PAGE_OBJNAME`, not a
 * component's: the cards are drawn, not compiled, and no component can be
 * called this, because every placement's name ends in a digit (`objectName`).
 */
const PLAN_OBJNAME = "plan";

// Nextion's own thresholds for the small series: how far the finger has to go
// before it is a swipe, how far it may stray on the other axis, and how often
// the Timer samples. 50 ms is the minimum the Editor accepts.
/**
 * The screen's stamp: the commit and the time its .tft was built
 * from, which the first page reports as it loads (`panel.version`) and the
 * runtime keeps for Main settings' Info. The scenario committed says "dev";
 * `--build` compiles a copy stamped with the repository's HEAD, a "+" after it
 * when a tracked file outside the Tasmota submodule differs, the time, and the
 * hash of the tables written beside it: the factory image puts the `.tft` beside
 * the `.jsonl`, and the hash is how it knows the two are of one generation
 * (firmware/overrides/panel_files.py). The brain reads the first two words.
 */
const DEV_STAMP = "dev";
const versionLine = (page, stamp) => printhFrame(`${touchPayload(page, PAGE_OBJNAME, "version")},${stamp}`);

const SWIPE_MIN_MOVE = 60;
const SWIPE_MAX_ORTHO = 30;
const SWIPE_TICK_MS = 50;

/**
 * The most Timers a page may carry: "Timer events exceed maximum in page:12",
 * the Editor's compiler on the US Living room's zone page, which had 13
 * -- twelve long presses with a Timer each, and the gesture's.
 */
const NEXTION_PAGE_TIMERS = 12;

/**
 * The pictures the pages ask for, deduplicated.
 *
 * A gradient is not an attribute on this hardware -- it is a picture, and the
 * Editor turns the pixels we generate into a compressed blob in the `.tft`. Two
 * sliders wanting the same ramp at the same size have to come back with the same
 * id, or the project pays for identical pixels twice. `pictureKey` is the
 * identity, and the id is the position in this list because `addHmiPicture`
 * hands them out in order and the base has none.
 */
const pictures = [];
const pictureIds = new Map();
const requestPicture = (spec) => {
  const key = pictureKey(spec);
  if (pictureIds.has(key)) return pictureIds.get(key);
  const id = pictures.length;
  pictureIds.set(key, id);
  pictures.push({ generate: spec.kind, key, ...spec });
  return id;
};

/**
 * A placement's `bind` block as layout props.
 *
 * The only thing this knows is which props hold text (`TEXT_PROPS`); everything
 * else passes through as the setting it is. A `$`-prefixed string becomes a
 * BINDING and not a string, which is the whole reason the first generated `.tft`
 * had `$screen.title` written on the glass and this one will not.
 */
const layoutProps = (componentId, bind) => {
  const bound = BOUND_PROPS[componentId] ?? {};
  const isRef = (v) => typeof v === "string" && v.startsWith("$");
  const out = {};

  for (const [key, value] of Object.entries(bind)) {
    if ((bound.text ?? []).includes(key)) {
      // `{ $binding, sample }` is a binding that knows what the page should
      // START as -- only the editable title uses it today (see `editableTitle`).
      out[key] = value && typeof value === "object" && value.$binding
        ? binding(value.$binding, String(value.sample ?? ""))
        : isRef(value) ? binding(value) : literal(String(value ?? ""));
    } else if ((bound.glyph ?? []).includes(key)) {
      // an icon ROLE the runtime decides: the page starts on the component's
      // own first role, and the manifest says where the real one comes from
      out[key] = isRef(value) ? binding(value, GLYPH_SAMPLE[componentId]?.[key] ?? "") : String(value);
    } else if ((bound.number ?? []).includes(key)) {
      // a page count the runtime decides compiles as three pages: it only sizes
      // the pointer, and the runtime writes the real one
      out[key] = isRef(value) ? bindingNumber(value, key === "pageCount" ? 3 : 0) : literalNumber(Number(value) || 0);
    } else if ((bound.color ?? []).includes(key)) {
      // a colour the panel sends: `pco` is writable from Berry, so the page
      // starts at a declared token and the manifest says where the real one
      // comes from
      out[key] = isRef(value) ? colorBinding(value, COLOR_SAMPLE[componentId]?.[key] ?? "text-primary") : colorToken(String(value));
    } else if (bound.list?.[key]) {
      // An array binding cannot survive as one -- no Nextion attribute takes a
      // list -- so it becomes indexed bindings, one per field per cell. The
      // length is fixed because the page is: there is no growing a row on the
      // glass.
      const { length, fields } = bound.list[key];
      const base = isRef(value) ? String(value) : null;
      out[key] = Array.from({ length }, (_, i) =>
        Object.fromEntries(fields.map((field) => [
          field,
          base ? binding(`${base}.${i}.${field}`) : literal(""),
        ])));
    } else {
      out[key] = value;
    }
  }

  // an action the project did not bind is an action the component does not get:
  // a nav-header on a screen with nowhere to go draws no arrows at all
  for (const [key, event] of Object.entries(ACTIONS[componentId] ?? {}))
    if (bind[key] !== undefined) out[event.prop] = { kind: "report", event: event.name };

  // A slider's report says WHICH dimension it moves, and that is in the setter
  // the project bound (`$light.setBrightnessPct`), not in the component -- the
  // same gradient-slider drives brightness, colour temperature and hue. The
  // event carries the value; the subject (`SUBJECT`) says which light's.
  if (componentId === "toggle-switch" && bind.onChange !== undefined) {
    const named = TOGGLE_EVENTS[String(bind.onChange).split(".").pop()];
    if (named) out.change = { kind: "report", event: named };
  }

  if (componentId === "gradient-slider" && bind.onChange !== undefined) {
    const setter = String(bind.onChange).split(".").pop();
    const event = SLIDER_EVENTS[setter];
    if (!event) throw new Error(`gradient-slider onChange "${bind.onChange}": no event for setter "${setter}" (known: ${Object.keys(SLIDER_EVENTS).join(", ")})`);
    out.change = { kind: "report", event };
  }

  // A list row is generic -- one shape, whichever view it shows -- so its
  // events are named by the VIEW's namespace, the first segment of what it
  // shows: `$list.rows.0.label` reports `list.row`, `$zone.rows.0.label`
  // `zone.row`, and the zone's name row `zone.row` with its own subject. What
  // the row means is the runtime's, from the subject and the page the frame
  // carries.
  if (componentId === "list-row" || componentId === "zone-counter") {
    const shown = componentId === "list-row" ? bind.label : bind.count;
    const ns = typeof shown === "string" && shown.startsWith("$") ? shown.slice(1).split(".")[0] : null;
    if (!ns) throw new Error(`${componentId} shows "${shown}", which is not a binding: its events are named by the view it belongs to`);
    for (const prop of ["change", "hold", "tailHold", "iconTap", "iconHold", "tap"]) {
      if (out[prop]?.kind === "report") out[prop] = { kind: "report", event: `${ns}.${out[prop].event}` };
    }
  }

  Object.assign(out, EXPAND[componentId]?.(bind) ?? {});
  return out;
};

/**
 * The arrows of a nav header, as `page <name>` and not as a reported event.
 *
 * The simulator's `$nav.prev`/`$nav.next` move to the previous and next SCREEN
 * of this layout -- so on the glass they are navigation, and a Nextion does
 * navigation by itself. Compiling them as reports was making the panel ask the
 * ESP32 for permission to do something it can do with the cable unplugged, and
 * leaving two events in the manifest that nothing on the Berry side could
 * answer.
 *
 * An arrow with nowhere to go gets nothing at all, which is `home.be`'s NO_NAV:
 * the layout draws no arrow rather than a dead one.
 */
const navigationFor = (componentId, bind, screenIndex, screens) => {
  // The keyboard's layout keys: the project names the OTHER keyboard screens
  // -- the letters, the keypad and the symbols -- and the glass
  // jumps there by itself. A report would be a round trip for something the
  // panel can do with the cable unplugged.
  if (componentId === "keyboard") {
    const out = {};
    for (const [key, prop] of [["onLetters", "toLetters"], ["onKeypad", "toKeypad"], ["onSymbols", "toSymbols"]]) {
      const to = bind[key];
      if (to === undefined) continue;
      if (!screens.some((s) => s.id === to))
        throw new Error(`keyboard ${key}: no screen "${to}" in this layout (has ${screens.map((s) => s.id).join(", ")})`);
      out[prop] = { kind: "navigate", screen: to };
    }
    return out;
  }
  if (componentId !== "nav-header") return {};
  const out = {};
  if (bind.onPrev !== undefined && screenIndex > 0)
    out.prev = { kind: "navigate", screen: screens[screenIndex - 1].id };
  if (bind.onNext !== undefined && screenIndex < screens.length - 1)
    out.next = { kind: "navigate", screen: screens[screenIndex + 1].id };
  return out;
};

/**
 * Bindings that name an OBJECT, and what the panel addresses instead.
 *
 * A project writes `"light": "$lights.0"` because the simulator resolves it to a
 * whole device and hands it to React. The glass has no such thing: it has a
 * `txt` on one component and a `pco` on another, and each needs its own path. So
 * this is the adapter between the project's vocabulary and what a Nextion can be
 * told, and it is a table because a guess here is a card that shows the wrong
 * light's name with nothing to say so.
 *
 * The React side has its own adapter, inside `ui/src/layouts/<Component>.tsx`,
 * and they are not duplicates: that one starts from a RESOLVED object and this
 * one from a path.
 */
const EXPAND = {
  "light-card": (bind) => {
    const base = typeof bind.light === "string" && bind.light.startsWith("$") ? bind.light : null;
    return {
      name: base ? binding(`${base}.name`) : literal(String(bind.light ?? "")),
      // The icon follows the light's STATE at run time: a `glyph` binding, so
      // the wire carries a role name (`lightOn`/`lightOff`) and the generated
      // runtime turns it into this theme's glyph with the theme's own table --
      // no codepoint is agreed on between the two sides. The page starts on
      // `lightOff`. A literal light keeps the compile-time role.
      icon: base ? binding(`${base}.icon`, "lightOff") : "lightOff",
      iconColor: base ? colorBinding(`${base}.iconColor`, "icon-off") : colorToken("icon-off"),
    };
  },
};

/**
 * Which bound handler becomes which declared action.
 *
 * The project writes `"onPrev": "$nav.prev"`, and a `.tft` has no callbacks --
 * what it has is an event on a component. This is the one place the two
 * vocabularies meet, and it is a table rather than a guess: a handler nobody
 * lists produces no event, so a card that silently did nothing when tapped would
 * be a missing line here and not a mystery on the glass.
 */
/**
 * Which bound prop says what a placement is ABOUT.
 *
 * Four light cards on a page all report "light.toggle"; the objname tells them
 * apart and means nothing to the Berry. The subject is what the project already
 * wrote -- `"light": "$lights.0"` -- and carrying it into the manifest is what
 * makes an event actionable.
 */
const SUBJECT = {
  "light-card": "light",
  "gradient-slider": "pct",
  "status-icon": "color",
  // A long press on a heading says WHICH text it is offering to edit, and the
  // answer is the binding the heading already shows. The keyboard itself is
  // about nothing in particular: it edits whatever the runtime last handed it.
  "nav-header": "title",
  // A list row is a SLOT of whatever view the list shows (`$list.rows.<k>.label`),
  // so what it is about is which slot: the runtime turns the slot and the
  // page the frame carries into the row of its view.
  "list-row": "label",
  "zone-counter": "count",
  // A list's scrollbar is about the list (`$list.page`).
  "page-rail": "page",
};

/**
 * What a slider's value report is called, by the setter the project bound.
 *
 * The Berry side answers these with `light.set_brightness`, `set_color_temp`
 * and `set_hue_pct` on the light whose detail page is open (`open_detail_id`).
 * Not in `ACTIONS`, because there the event name is the component's and here
 * it is the binding's.
 */
/**
 * A switch that is not the "live slider update" one.
 *
 * Same shape as `SLIDER_EVENTS` and for the same reason: the component is
 * generic -- two states, one report -- and WHICH setting it flips is in the
 * setter the project bound, not in the component. A toggle with no entry here
 * is the plain one and reports `toggle.change`.
 */
const TOGGLE_EVENTS = {
  setKeyboardKind: "keyboard.kind",
};


const SLIDER_EVENTS = {
  setBrightnessPct: "light.brightness",
  setColorTempPct: "light.colorTemp",
  setHuePct: "light.hue",
};

/**
 * The role a bound icon starts as, per component: what the page shows until
 * the runtime writes the first role. It has to be one the theme carries -- the
 * glyph is baked into the compiled Text.
 */
/**
 * The token a bound colour starts as, per component, where it is not the text's. A status icon starts as the screensaver's own
 * background -- invisible -- and the runtime lights it (the alarm's and the notifications' signs): a page that
 * loads shows nothing until the brain says there is something to show.
 */
const COLOR_SAMPLE = {
  "status-icon": { color: "background-screensaver" },
  // a row's hint and tail start in the theme's quiet colour, as the rows with no colour of their own stay
  "list-row": { hintColor: "text-secondary", tailColor: "text-secondary" },
};

const GLYPH_SAMPLE = {
  // the sign starts blank: a page loads as compiled, and an empty Text draws
  // nothing until the runtime names a role
  "nav-header": { actionIcon: "add", statusIcon: "" },
};

const ACTIONS = {
  // `nav-header`'s ARROWS are not here: they are navigation and not a report,
  // see `navigationFor`. Its `onClose` (a tap on the title) is, and the
  // difference is the whole reason both exist: an arrow goes to a page known at
  // compile time, and the close goes back to
  // whichever group screen the long press came from -- which only the runtime
  // knows. `gradient-slider` is not here either: its event name
  // comes from the setter it binds (`SLIDER_EVENTS`).
  "nav-header": {
    onClose: { prop: "close", name: "nav.close" },
    onEditTitle: { prop: "editTitle", name: "text.edit" },
    // the view's own action: + on a plan, the check on a dashed card
    onAction: { prop: "action", name: "header.action" },
    // and its long press: the schedule's clock opens the device's schedule
    onActionHold: { prop: "actionHold", name: "header.actionHold" },
    // the view's options, the ⋯
    onMore: { prop: "more", name: "header.more" },
  },
  // The scrollbar reports the page the finger let go on, and the runtime writes
  // that page's rows into the same slots -- a page turn is never a `page` jump
  // on a list template. No X of its own: closing is `nav-header`'s job.
  "page-rail": {
    onChange: { prop: "change", name: "list.page" },
  },
  "light-card": {
    onToggle: { prop: "tap", name: "light.toggle" },
    onOpenDetail: { prop: "hold", name: "light.detail" },
  },
  "toggle-switch": {
    onChange: { prop: "change", name: "toggle.change" },
  },
  // A list row's tap, its long press and its tail's long press. The names are
  // completed by the view's namespace (`list.row`, `zone.slot`), below.
  "list-row": {
    onChange: { prop: "change", name: "row" },
    onHold: { prop: "hold", name: "hold" },
    onTailHold: { prop: "tailHold", name: "slot" },
    // the device row's icon: `zone.icon` switches, `zone.iconHold` opens the detail
    onIconTap: { prop: "iconTap", name: "icon" },
    onIconHold: { prop: "iconHold", name: "iconHold" },
  },
  // A counter of the zone's top card: the tap toggles that kind, the hold opens
  // its joint mode -- two events, because the runtime is told the event and not
  // the gesture.
  "zone-counter": {
    onTap: { prop: "tap", name: "count" },
    onHold: { prop: "hold", name: "countHold" },
  },
  // OK and X. Both report for the same reason the X of a detail page does: what
  // the typed name BELONGS to, and which screen the finger came from, are the
  // runtime's to remember. The typing itself never reports --
  // it happens on the glass, key by key.
  keyboard: {
    onCommit: { prop: "commit", name: "text.commit" },
    onCancel: { prop: "cancel", name: "text.cancel" },
  },
  // The lock's pad: the release, with the dots the finger joined.
  // The joining itself never reports -- it happens on the glass.
  "pattern-pad": {
    onTry: { prop: "drawn", name: "lock.try" },
  },
};


/** What the panel has to be TOLD, and what it has to report. Written beside the scenario. */
const bindings = [];
const events = [];

const screens = layout.screens;
/**
 * The panel's "live slider update" setting, as the glass sees it.
 *
 * A project that places a switch bound to `$settings.liveSliderUpdate` gets a
 * global Variable `vaLive` on its first page. The switch writes it in the same
 * touch that reports the change (`ToggleNode.mirror`), every slider whose
 * `input.live` is `"auto"` reads it in its Touch Move handler, and the Berry
 * side writes it too when it restores the preference -- three parties, one
 * Variable, no round trip for the finger. A project with no such switch has no
 * Variable, and `"auto"` means release-only there, because there is nothing to
 * read.
 */
/**
 * The page that carries the keyboard's shared Variables.
 *
 * The first one, global, exactly like `vaLive` -- because there are TWO
 * keyboard screens (QWERTY and the T9 keypad, each with a key that jumps to the
 * other) and the line being typed cannot live on either: the jump would leave
 * it behind. A project with no keyboard gets none of this.
 */
const HAS_KEYBOARD = (project.layouts?.[deviceId]?.screens ?? [])
  .some((s) => s.place.some((p) => String(p.component).endsWith("/keyboard")));

/**
 * What the keyboard's own field can show, filled in as the pages are laid out.
 *
 * Two different boxes hold the same string: the SLOT being renamed, and the
 * keyboard's field. `kbMax` is measured against the slot -- that is the promise
 * that the name will fit where it is going -- and the field is measured too,
 * because of what the Editor's debugger shows of a line wider than the field: a
 * Nextion Text clips on the right and says nothing. 26 "m" in the 440 px field draw exactly the same picture as 20, and
 * since the caret is a CHARACTER at the end of the line, the caret is the first
 * thing to disappear -- so the finger types on with the screen frozen.
 */
const KEYBOARD_FIELD = { fits: null, where: null };

const LIVE_SETTING = "$settings.liveSliderUpdate";
/**
 * The Settings list (schema 10), the same parsed object the simulator reads.
 *
 * A list template's rows are slots, so nothing on the glass names a setting,
 * which is why "does this project have the live setting?" is
 * asked of the LIST as well as of the placements: a row that shows it is
 * only a slot the runtime might fill with it.
 */
const SETTINGS_ITEMS = parsed.settings.items;

/**
 * Help's body, broken into lines where it lands.
 *
 * The project writes each item's `help` as paragraphs, and the lines are this
 * LAYOUT's: `wrapZiText` at the width and in the font of the Text that shows
 * them, so the landscape panel fills its 420 px and the portrait one breaks
 * sooner at 290; lines cut by hand for the narrowest panel would stop at two
 * thirds of the landscape one's width.
 *
 * The first Help line the emit step sizes sets the width, and every other one
 * must agree -- the body is broken once, at one width. `slots` is how many
 * lines the Help screen has, which the wrapped body must not outgrow.
 */
const HELP_BODY = { width: undefined, role: undefined, zi: undefined, slots: new Set() };
function helpLinesOf(item) {
  if (HELP_BODY.width === undefined) return item.help;
  return wrapZiText(ziAdvanceTable(HELP_BODY.zi), item.help, HELP_BODY.width);
}

/**
 * Every value the runtime will ever write into a slot, where the PROJECT holds
 * them all: the Settings labels (a row, and Help's title) and each Help line.
 * Undefined for a slot whose text arrives from outside -- a name somebody types.
 */
const HELP_LINE = /^\$help\.lines\.(\d+)$/;
const ROW_LABEL = /^\$list\.rows\.\d+\.label$/;
function knownTexts(path, width, role, ctx) {
  if (path === "$help.title" || (typeof path === "string" && ROW_LABEL.test(path))) return SETTINGS_ITEMS.map((i) => i.label);
  const line = typeof path === "string" ? HELP_LINE.exec(path) : null;
  if (line) {
    if (HELP_BODY.width === undefined) Object.assign(HELP_BODY, { width, role, zi: ctx.ZI[role] });
    else if (HELP_BODY.width !== width || HELP_BODY.role !== role || HELP_BODY.zi !== ctx.ZI[role])
      throw new Error(`${themeId}: Help's lines are ${HELP_BODY.width} px of ${HELP_BODY.role} and ${width} px of ${role} -- its body is broken at one width, so its lines must share it`);
    HELP_BODY.slots.add(Number(line[1]));
    return SETTINGS_ITEMS.map((i) => helpLinesOf(i)[Number(line[1])] ?? "");
  }
  return undefined;
}

/**
 * The `txt_maxl` of a slot, knowing which binding it shows.
 *
 * A slot whose text arrives from outside gets `bufferCapacity`: room for
 * whatever the runtime fits to the box by width. A slot whose values are all
 * known here holds exactly the longest of them, and no more -- after each is
 * measured in the theme's own font against the box, because a Settings label
 * that does not fit is a project error to report at build time, not a text to
 * cut with an ellipsis on the glass. (Sizing those by the buffer rule too cost
 * Help ~200 bytes of RAM for five lines whose words never change.)
 */
const slotCapacityIn = (ctx) => (width, role, path) => {
  const known = knownTexts(path, width, role, ctx);
  if (!known) return ctx.bufferCapacity(width, role);
  // The Settings labels and their Help are known here, and are checked here
  // against the box. But the list and Help show other things too -- a zone's
  // name, a device's info -- that arrive at run time and are fitted then, so
  // the slot gets the buffer a runtime text needs, or the longest known text
  // if that is longer.
  for (const text of known) {
    const { advance, missing } = layoutZiText(ctx.ZI[role], text);
    if (missing.length)
      throw new Error(`${ctx.id}: ${JSON.stringify(text)} (${path}) has characters the ${role} font does not carry: ${missing.map((c) => "U+" + c.toString(16).toUpperCase().padStart(4, "0")).join(", ")}`);
    if (advance > width)
      throw new Error(`${ctx.id}: ${JSON.stringify(text)} (${path}) is ${advance} px in the ${role} font, and its box is ${width} px -- shorten it in settings.items`);
  }
  return Math.max(ctx.bufferCapacity(width, role), ...known.map((t) => Buffer.byteLength(t, "utf8")));
};
const usesLiveSetting = screens.some((s) => s.place.some((p) => p.bind?.on === LIVE_SETTING))
  || SETTINGS_ITEMS.some((item) => item.key === "liveSliderUpdate");
const LIVE_FLAG = usesLiveSetting ? `${pageName(screens[0].id)}.vaLive` : undefined;

/** `$list.rows.<k>.<field>` or `$zone.rows.<k>.<field>` -> k, or null for any other binding. */
const ROW_SLOT = /^\$(?:list|zone)\.rows\.(\d+)\./;
const rowSlot = (v) => {
  const m = typeof v === "string" ? ROW_SLOT.exec(v) : null;
  return m ? Number(m[1]) : null;
};
// A page is what its screen SAYS it is (`role`, project schema 12), and not what it happens to hold: a slider bound to
// `$light.brightnessPct`, a title or a pad would find the wrong page, or none, the moment a screen is drawn another way.
const screenWith = (role) => screens.find((s) => s.role === role);

/**
 * The generic list: its rows are slots of whichever view it shows, and so are a confirmation's two answers, the QR's
 * one and the house's screens under its icons.
 */
const LIST_ROLES = new Set(["list", "house", "mesh", "dialog", "qr"]);
const isListScreen = (screen) => LIST_ROLES.has(screen.role);
/** The lock: the page with the pattern pad. */
const isLockScreen = (screen) => screen.role === "lock";
/** A zone's own screen: its rows are the zone's devices. */
const isZoneScreen = (screen) => screen.role === "zone";
/** A thermostat's own screen: every word on it is the thermostat on show's, written after it loads. */
const isThermostatScreen = (screen) => screen.role === "thermostat";
/** A blind's own screen: the same, for a blind. */
const isCoverScreen = (screen) => screen.role === "cover";

// What each role needs of its page, for the runtime writes to it by name: a page that says it is the zone's and has no device rows
// would be written to blind.
const hasBinding = (screen, field, start) => screen.place.some((p) => typeof p.bind?.[field] === "string" && p.bind[field].startsWith(start));
const hasComponent = (screen, name) => screen.place.some((p) => String(p.component).endsWith(`/${name}`));
const LIST_ROWS = [(s) => hasBinding(s, "label", "$list.rows."), "rows (`$list.rows.*`)"];
const ROLE_NEEDS = {
  zone: [(s) => hasBinding(s, "label", "$zone.rows."), "device rows (`$zone.rows.*`)"],
  list: LIST_ROWS,
  house: [(s) => hasBinding(s, "label", "$list.rows.") && hasBinding(s, "count", "$house.icons."), "rows (`$list.rows.*`) and icons (`$house.icons.*`)"],
  mesh: [(s) => hasBinding(s, "label", "$list.rows.") && hasBinding(s, "count", "$mesh.cog."), "rows (`$list.rows.*`) and its cog (`$mesh.cog.*`)"],
  dialog: [(s) => hasBinding(s, "text", "$dialog.lines."), "lines (`$dialog.lines.*`)"],
  qr: [(s) => hasComponent(s, "qr-code"), "a qr-code"],
  help: [(s) => s.place.some((p) => p.bind?.title === "$help.title"), "a title (`$help.title`)"],
  detail: [(s) => s.place.some((p) => p.bind?.pct === "$light.brightnessPct"), "a brightness slider (`$light.brightnessPct`)"],
  lock: [(s) => hasComponent(s, "pattern-pad"), "a pattern pad"],
  keyboard: [(s) => hasComponent(s, "keyboard"), "a keyboard"],
  thermostat: [(s) => hasBinding(s, "text", "$thermostat."), "its target and lines (`$thermostat.*`)"],
  cover: [(s) => hasBinding(s, "text", "$cover."), "its position and words (`$cover.*`)"],
  safeboot: [(s) => hasBinding(s, "text", "$safeboot.title") && hasComponent(s, "qr-code"), "its title (`$safeboot.title`) and a qr-code"],
};
for (const s of screens) {
  const need = ROLE_NEEDS[s.role];
  if (need && !need[0](s)) throw new Error(`${projectId}/${deviceId}: screen "${s.id}" has the role ${s.role} and none of ${need[1]}`);
}

const pages = screens.map((screen, si) => {
  // a paged list whose vertical swipe is its own: the swipe scrolls it anywhere
  // on the page, and its taps and holds are the ones that did not travel one
  const scrollPage = screen.place.some((pl) => String(pl.component).endsWith("/page-rail")) && !screen.swipe?.up && !screen.swipe?.down;
  const bg = screen.background ? rgb(screen.background) : COLOR.background;
  // Declared here because two things below need it: the page's `load` event and
  // the size of the frame buffer its OK key needs.
  const showsKeyboard = screen.place.some((p) => String(p.component).endsWith("/keyboard"));
  let n = 0;
  const add = [];
  // the objects of the placements that take turns in a place (project schema 14), by their alternate: never shown together
  const turnsOf = new Map();
  const helpers = new Set();
  // A plan reports where the finger was, which only the glass knows: its frames
  // are built there, in the same two Variables a slider's report uses.
  if (screen.plan) helpers.add("value-frame");
  // The page-rail's slider on THIS page, once it has been laid out -- the rows
  // after it carry its position in every frame (`EmitOptions.carry`). Rail
  // first is the template's order (screenTemplates.ts), and a row laid out
  // before any rail simply carries nothing: its page is the first one.
  let pageSlider = null;
  // The pattern pad on THIS page, once it has been laid out: the gesture block
  // follows the finger over its dots (`gestureComponents`).
  let patternPad = null;
  for (const p of screen.place) {
    const [placementTheme, componentId] = p.component.split("/");
    const index = n++;

    // One declaration, read here exactly as the simulator reads it, and no second
    // path: a component this theme does not lay out is refused rather than drawn
    // from somewhere else.
    // the theme this placement is resolved in: its own (themeContext)
    const ctx = contexts.get(placementTheme);
    const layoutFn = layoutFor(placementTheme, componentId, p.variant);
    if (!layoutFn)
      throw new Error(`${placementTheme} does not lay out "${componentId}" in the "${p.variant ?? "default"}" style`);
    {
      // `$screen.title` is the one binding the compile step resolves itself: the
      // title is a property of the screen the placement is on, known here and
      // constant for the life of the page. Left as a binding it became ONE path
      // written to every page's header at once, so every page carried the last
      // title anybody set.
      // `$screen.title` is resolved HERE and not left as a binding, because one
      // path written to every page's header at once made every page carry the
      // last title anybody set. A screen whose title the user may EDIT gets a
      // path of its own instead -- `$screen.<id>.title` -- so the write lands on
      // one page; the project's word stays as what the page compiles with, so
      // the panel says "Home" from the first frame after a flash.
      const editableTitle = p.bind.title === "$screen.title" && p.bind.onEditTitle !== undefined;
      const titlePath = `$screen.${screen.id}.title`;
      // A row slot COMPILES showing the list's first page -- which is what the
      // glass resets it to whenever the page loads -- so the page reads right
      // before the runtime has said a word; the runtime then writes the colours
      // and anything the page turns to.
      const slot = componentId === "list-row" ? rowSlot(p.bind.label) : null;
      const bind = {
        ...p.bind,
        ...(p.bind.title === "$screen.title"
          ? { title: editableTitle ? { $binding: titlePath, sample: screen.title } : screen.title }
          : {}),
      };
      const props = {
        ...layoutProps(componentId, bind),
        ...navigationFor(componentId, bind, si, screens),
        // how this slider reports (project schema 7): while dragging, on release,
        // or as the panel's setting says
        ...(componentId === "gradient-slider" ? { live: p.input?.live ?? "auto" } : {}),
        // the row/switch that IS the setting mirrors into the Variable the sliders read
        ...(componentId === "toggle-switch" && bind.on === LIVE_SETTING && LIVE_FLAG ? { mirror: LIVE_FLAG } : {}),
      };
      const nodes = layoutFn(props, { w: p.w, h: p.h }, ctx.style);
      // A HANDLER THE THEME QUIETLY DROPPED. `ACTIONS` turns every `on...` the
      // project binds into a `{ kind: "report" }` prop and `navigationFor` into
      // a `{ kind: "navigate" }` one, and this checks that the layout uses them:
      // a header that ignored an `onEditTitle` the project asked for would compile
      // into a panel with keyboard pages and no door to them, and nothing would say
      // a word -- not the funnel, not the verifier, not the Editor, because a
      // missing Hotspot is not a wrong byte.
      {
        const asked = Object.entries(props)
          .filter(([, v]) => v && typeof v === "object" && (v.kind === "report" || v.kind === "navigate"));
        const drawn = JSON.stringify(nodes);
        // Identity by serialisation: the layout puts the SAME object on the
        // node it draws, so its JSON appears verbatim inside the tree's.
        const dropped = asked.filter(([, v]) => !drawn.includes(JSON.stringify(v)));
        if (dropped.length)
          throw new Error(
            `${placementTheme}/${componentId} on screen "${screen.id}" ignores ` +
            `${dropped.map(([k]) => k).join(", ")}: the project bound it and the layout draws nothing for it`,
          );
      }
      const emitted = emitNodes(nodes, ctx.emitTheme, {
        pageName: pageName(screen.id),
        origin: { x: p.x, y: p.y },
        background: screen.background ?? "background",
        index,
        liveFlag: LIVE_FLAG,
        // Where the finger last was, so every tap and hold fires only if it let go
        // inside its own box (emit.ts:pointerVars). The names are the gesture
        // block's, and the block is on every page that has anything touchable --
        // which is why the two are emitted together and not independently.
        pointerVars: { x: "vaLx", y: "vaLy" },
        ...(scrollPage ? { still: { variable: "vaAy", below: SWIPE_MIN_MOVE } } : {}),
        // How big a buffer each runtime Text needs, in the theme's own font: it
        // becomes the Text's `txt_maxl`, and the runtime fits every text to the
        // box by width before writing it. The keyboard's field
        // asks the other question -- how many characters its window shows --
        // and gets the widest glyph's answer.
        textCapacity: slotCapacityIn(ctx),
        windowCapacity: ctx.textCapacity,
        // a placement of another theme than the project's: what the runtime
        // writes into it is resolved in that theme's tables (generateTables)
        ...(ctx.tag ? { themeTag: ctx.tag } : {}),
        // Where `kbIn` and friends live, when this project has a keyboard: the
        // first page, global. Both keyboard layouts address them there.
        ...(HAS_KEYBOARD ? { keyboardGlobals: pageName(screens[0].id) } : {}),
        // what this placement is ABOUT, so an event says which light and not
        // only which component. The project already wrote it; nothing else knows.
        // A heading held says which text it offers to rename: the screen's own
        // title, or the binding a view's title is (`$zone.title`, `$list.title`),
        // whose view the runtime knows.
        subject: componentId === "nav-header"
          ? (editableTitle ? titlePath
            : p.bind.onEditTitle !== undefined && typeof p.bind.title === "string" && p.bind.title.startsWith("$") ? p.bind.title : undefined)
          : SUBJECT[componentId] ? p.bind[SUBJECT[componentId]] : undefined,
        // The placement's own `render.dither` (project schema 6) wins, then the
        // project-wide `pictures.dither`; undefined means "nobody has an opinion",
        // and the layout then dithers where it makes sense and only there
        // (`defaultDither`: never hue, and only at widths where bands would show).
        // Passing false here unconditionally was once a bug: it forced every ramp
        // flat, so the brightness slider came out banded -- the exact thing the
        // default exists to prevent. Since the codec was decoded, the choice has a price:
        // a dithered brightness track costs about 4x the flat one,
        // and the build log prints the ratio of every picture.
        dither: typeof p.render?.dither === "boolean" ? p.render.dither
          : typeof project.pictures?.dither === "boolean" ? project.pictures.dither : undefined,
        // a list row says which page it was on, read off the scrollbar at the
        // moment of the touch: the page lives on the glass, never on the other side
        ...(slot !== null && pageSlider ? { carry: pageSlider } : {}),
      });
      if (emitted.pattern) patternPad = emitted.pattern;
      if (componentId === "page-rail") {
        const s = emitted.records.find((r) => r.type === "Slider");
        if (s) pageSlider = sliderReadout(s.objname, s.attributes.mode === 1 ? "vertical" : "horizontal", s.attributes.maxval);
      }
      // A TEXT COMPILED INTO THE PAGE HAS TO FIT ITS BOX. What runs past is cut
      // at the box edge, mid-letter, and nothing on the glass says so. A text
      // that arrives at run time is fitted by the runtime, with an ellipsis;
      // one compiled in -- a literal, or the sample a slot shows until the
      // first write -- has nobody to fit it, so it is refused here, which is
      // also what lets the simulator fit EVERY text the way the runtime does.
      for (const r of emitted.records) {
        if ((r.type !== "Text" && r.type !== "Button") || typeof r.attributes?.txt !== "string" || r.attributes.txt === "") continue;
        const role = FONT_ROLES[(r.attributes.font ?? 0) % FONT_ROLES.length];
        const { advance } = layoutZiText(ctx.ZI[role], r.attributes.txt);
        if (advance > r.w)
          throw new Error(`${placementTheme}/${componentId} on screen "${screen.id}": ${JSON.stringify(r.attributes.txt)} is ${advance} px in the ${role} font, and ${r.objname} is ${r.w} px wide -- the glass would cut it mid-letter`);
      }
      add.push(...emitted.records);
      bindings.push(...emitted.bindings);
      if (p.alternate && typeof p.bind.visible === "string" && p.bind.visible.startsWith("$"))
        for (const r of emitted.records) turnsOf.set(r, p.alternate);
      // A placement the runtime may hide (`"visible": "$light.hueVisible"`): a
      // detail shows only the sliders its target can use. Every
      // object the placement drew answers the same `vis`, which the runtime
      // sends while that page is up.
      if (typeof p.bind.visible === "string" && p.bind.visible.startsWith("$")) {
        for (const r of emitted.records) {
          if (r.x === undefined || r.type === "Timer" || r.type === "Vari") continue;
          bindings.push({ page: pageName(screen.id), objname: r.objname, attribute: "vis", path: p.bind.visible, kind: "vis" });
        }
      }
      events.push(...emitted.events);
      for (const h of emitted.helpers) helpers.add(h);
      // The narrowest editing field in the whole layout, for the capacity check
      // after every page is laid out. The narrowest and not this one, because a
      // line typed on the QWERTY can be carried to the keypad by the 123 key
      // and has to still be readable when it lands there.
      if (emitted.keyboardField) {
        const fits = ctx.textCapacity(emitted.keyboardField.width, emitted.keyboardField.font) - 1;  // the caret is a character
        if (KEYBOARD_FIELD.fits === null || fits < KEYBOARD_FIELD.fits) {
          KEYBOARD_FIELD.fits = fits;
          KEYBOARD_FIELD.where = `${pageName(screen.id)}.kbShow`;
        }
      }
    }
  }
  // What a slider's value report needs on ITS page and shares with every other
  // slider there: the two string Variables joBr99's recipe builds the frame in
  // (`valueFrameLines`: his `tSend` is a Vari with txt_maxl 200). A Vari draws
  // nothing and costs `txt_maxl + 1` rounded up plus 4 of the page's RAM.
  if (helpers.has("value-frame")) {
    // `val: 0` said out loud on a STRING Vari, and it is not noise. The Vari
    // template carries defaultHex "46290000" -- 10566 -- which is whatever the
    // donor project this template was harvested from happened to have in that
    // field, not a default of the Editor's. The Editor compiles a string Vari
    // with val 0, so leaving it out made the writer predict 10566 and the
    // verifier fail against every real compile (measured on five projects, two
    // Varis each). A harvested value is only a default for the
    // fields the donor was not using.
    // 48 was enough while the only value-carrying frame was a slider's three
    // digits. The keyboard's OK carries the TYPED LINE: the prefix is 23 bytes
    // and `kbIn` holds 64, so the worst case is 87 and a 48-byte buffer would
    // cut a long name ON THE WIRE -- `prints` sends what the buffer holds and
    // nothing says it was short.
    //
    // And the headroom is NOT free: a STRING Vari costs align4(8 + txt_maxl) of
    // RAM, not the flat 4 of a numeric one (`ramBudget.ts`, measured -- and the
    // comment just above had it right all along). So the page that needs 96
    // gets 96, and the pages that only move sliders keep their 48.
    add.push({ type: "Vari", objname: "vaSend", attributes: { sta: 1, txt: "", txt_maxl: showsKeyboard ? 96 : 48, val: 0 } });
    // 10 on the lock's page: its number is a digit a dot, and nine dots are nine digits
    add.push({ type: "Vari", objname: "vaTmp", attributes: { sta: 1, txt: "", txt_maxl: patternPad ? 10 : 8, val: 0 } });
  }
  // The "live slider update" Variable lives on the first page, global, so every
  // page's sliders can read it (`vscope` 1 is global, measured in m10-*), and the
  // Berry side writes it by the same binding the switch is bound to.
  if (si === 0 && LIVE_FLAG) {
    add.push({ type: "Vari", objname: "vaLive", attributes: { vscope: 1, sta: 0, val: 0 } });
    bindings.push({ page: pageName(screen.id), objname: "vaLive", attribute: "val", path: LIVE_SETTING });
  }
  // The keyboard's three, on the same page and for the same reason: both
  // keyboard layouts read them, and neither may own them. `sta` 1 is a STRING
  // Variable -- getting that wrong makes the Editor refuse the whole project.
  if (si === 0 && HAS_KEYBOARD) {
    add.push({ type: "Vari", objname: "kbIn", attributes: { vscope: 1, sta: 1, txt: "", txt_maxl: 64, val: 0 } });
    add.push({ type: "Vari", objname: "kbMax", attributes: { vscope: 1, sta: 0, val: 0 } });
    add.push({ type: "Vari", objname: "kbCaps", attributes: { vscope: 1, sta: 0, val: 0 } });
    bindings.push({ page: pageName(screen.id), objname: "kbIn", attribute: "txt", path: "$keyboard.value" });
    bindings.push({ page: pageName(screen.id), objname: "kbMax", attribute: "val", path: "$keyboard.max" });
  }
  // A tap anywhere on the screen goes to `tap` (schema 7) and a swipe goes to
  // `swipe.<direction>` (schema 8) -- both through ONE TouchCap, which is how
  // joBr99's own screensaver hears the finger (`tc0`): it has no box and gets
  // every touch on the page whatever component is under it.
  //
  // One, and not one each, because two TouchCaps on a page would both see every
  // touch and both act. The unification is also the honest model: a tap IS a
  // swipe whose vector never cleared the threshold, so the release decides which
  // of the two happened and there is no separate tap detector to disagree.
  // The gesture block goes on a page that declares a gesture OR has anything
  // touchable on it: the per-component guard reads this block's `vaLx`/`vaLy`,
  // so a page with cards and no swipe still needs it. A page with neither --
  // nothing to touch, nowhere to go -- gets nothing.
  // Every box on this page a finger can act on, which the swipe block needs in
  // order NOT to fire inside one of them (see gestureComponents).
  const touchBoxes = add
    .filter((c) => (c.events ?? []).some((e) => e.event === "down" || e.event === "up" || e.event === "slide"))
    .filter((c) => c.w > 0 && c.h > 0)
    .map((c) => ({ x: c.x, y: c.y, w: c.w, h: c.h, slider: c.type === "Slider" }));
  // A paged list's rail (scrollbar.ts's `hPage`), which a vertical swipe turns
  const rail = add.find((c) => c.type === "Slider" && /^hPage\d+$/.test(c.objname))?.objname ?? null;
  if (screen.tap || screen.swipe || screen.plan || patternPad || touchBoxes.length > 0) {
    add.push(...gestureComponents(screen, touchBoxes, patternPad, rail));
    // the touch the TouchCap reports on its press, whatever it turns out to be
    events.push({ page: pageName(screen.id), objname: PAGE_OBJNAME, event: "panel.touch", gesture: "touch" });
    // a paged list's vertical swipe, which the runtime turns into a page
    if (rail !== null && !screen.swipe?.up && !screen.swipe?.down) {
      for (const d of ["up", "down"])
        events.push({ page: pageName(screen.id), objname: PAGE_OBJNAME, event: "list.swipe", gesture: d, subject: d });
    }
  }
  // A page takes at most NEXTION_PAGE_TIMERS Timers: past that, the long
  // presses share one (`shareHoldTimers`), and a page that still does not fit
  // is refused here rather than by the Editor.
  if (add.filter((c) => c.type === "Timer").length > NEXTION_PAGE_TIMERS) shareHoldTimers(add);
  {
    const timers = add.filter((c) => c.type === "Timer").length;
    if (timers > NEXTION_PAGE_TIMERS)
      throw new Error(`screen "${screen.id}" needs ${timers} Timers, and a page takes ${NEXTION_PAGE_TIMERS}`);
  }
  // What a plan says to the runtime: the point a tap or a hold
  // went down at, one number, and the carousel's two swipes.
  if (screen.plan) {
    const page = pageName(screen.id);
    events.push({ page, objname: PLAN_OBJNAME, event: "plan.tap", gesture: "tap", value: true });
    events.push({ page, objname: PLAN_OBJNAME, event: "plan.hold", gesture: "hold", value: true });
    events.push({ page, objname: PAGE_OBJNAME, event: "nav.swipe", gesture: "left", subject: "left" });
    events.push({ page, objname: PAGE_OBJNAME, event: "nav.swipe", gesture: "right", subject: "right" });
    // and up and down, unless the project jumps somewhere with them: the
    // runtime opens Wireless settings with the first and Main settings with the
    // second, through the pattern, which is a view of the list's
    // page and no page of its own to jump to: a jump of the glass's own would show
    // the list for a moment, with a pattern, before the lock took its place
    if (!screen.swipe?.up) events.push({ page, objname: PAGE_OBJNAME, event: "nav.swipe", gesture: "up", subject: "up" });
    if (!screen.swipe?.down) events.push({ page, objname: PAGE_OBJNAME, event: "nav.swipe", gesture: "down", subject: "down" });
  }
  // A screen with no way out is refused rather than given one: the project says
  // how the finger leaves, or the build stops and names the screen.
  //
  // TWO kinds of way out. A `page`
  // jump the glass takes by itself is one. The other is an event the RUNTIME
  // answers with a jump: a long press reporting `light.detail` leaves this
  // screen just as surely, and the arrows came out of the group screens exactly
  // because that path is the real one. Counting only the first
  // would have forced every screen to keep a decorative arrow to satisfy a
  // check.
  // `text.edit` opens the keyboard and `text.commit`/`text.cancel` leave it --
  // all three are jumps the runtime takes, for the same reason `nav.close` is:
  // the page the finger came from is not known when the page is built.
  // A component that carries code and is COVERED by a later one is a control
  // that cannot be pressed. Measured in the Editor's debugger: when two
  // components overlap, the topmost takes the press -- and a Text with no event
  // at all simply swallows it. A card's tap under its own icon and its own name
  // is what nothing else would report: the page compiles, the frame is in the
  // `.tft`, and the finger does nothing.
  //
  // Later means higher id means on top. Components with no box (a Timer, a
  // Vari, the gesture TouchCap) are not in this: they are not on the glass.
  // Nor is a pair that takes turns in its place (`alternate`, project schema
  // 14): the runtime hides one while it shows the other, and a hidden Nextion
  // component takes no touch.
  const boxed = add.filter((c) => c.x !== undefined && c.w !== undefined);
  const turns = (a, b) => turnsOf.has(a) && turnsOf.has(b) && turnsOf.get(a) !== turnsOf.get(b);
  boxed.forEach((c, i) => {
    if (!c.events?.some((e) => e.lines.length)) return;
    const covered = boxed.slice(i + 1).find((later) =>
      c.x < later.x + later.w && later.x < c.x + c.w && c.y < later.y + later.h && later.y < c.y + c.h && !turns(c, later));
    if (covered)
      throw new Error(
        `screen "${screen.id}": ${c.objname} carries code and is covered by ${covered.objname}, ` +
        `which is drawn later and so takes the press (d3-03-overlap). ` +
        `Put the touch on a component ABOVE the drawing.`,
      );
  });

  const NAVIGATING_EVENTS = new Set(["light.detail", "nav.close", "text.edit", "text.commit", "text.cancel", "settings.help"]);
  // Trimmed: a `page` inside an `if` block is indented, and testing the raw
  // line missed every one of them -- the gesture block puts all of its
  // navigation inside nested `if`s, so the screensaver looked like a dead end.
  const jumpsOnGlass = add.some((c) => c.events?.some((e) => e.lines.some((l) => l.trim().startsWith("page "))));
  const reportsNavigation = events.some((e) => e.page === pageName(screen.id) && NAVIGATING_EVENTS.has(e.event));
  // The safeboot's page is the one page with no way out on purpose: the safeboot image draws it while it writes the
  // firmware, and leaves it by restarting the device.
  if (!jumpsOnGlass && !reportsNavigation && screens.length > 1 && screen.role !== "safeboot")
    throw new Error(
      `screen "${screen.id}" has no way out: give it a "tap" target, a nav-header with onPrev/onNext/onClose, ` +
      `or a component whose event the runtime navigates on (${[...NAVIGATING_EVENTS].join(", ")})`,
    );
  // A keyboard page shows the line the moment it opens, and it has to be told:
  // the line is a global on the first page, and a Text does not follow one. The
  // `load` event is the page's own, fired before it draws -- which is what makes
  // switching layout look like one keyboard changing shape rather than two
  // keyboards, one of which forgot what you typed.
  // `click kbDraw,0` and not a write: the caret and the blink are decided in one
  // place (emit.ts), and the page's `load` wants the same drawing every key
  // wants. The vendor's own keyboard clicks a Hotspot from its `load` too.
  //
  // `click kbRef,0` FIRST. CAPS is a global -- it has to be, or crossing to the
  // other keyboard would forget it -- but the legends it writes are page-local
  // attributes that come back as compiled the moment the page loads. Without it,
  // after 123 and then ABC the flag says upper case, every key reads lower case,
  // and a key types ITS OWN CAPTION: the keyboard types lower case while claiming
  // otherwise, and the next press of CAPS appears to do nothing because it turns
  // the flag OFF. Rebuilding
  // the legends from the flag on every load is what makes the two agree.
  // Caught by `test/keyboardGlass.test.mjs` A20, which presses CAPS, 123, ABC
  // and a letter and looks at what came out.
  // `kbRef` only exists on a keyboard that has something to rewrite, so the
  // click is conditional on the page really carrying one -- a `click` on a
  // name that is not there is a compile error, and this is the kind of thing
  // a keyboard without a CAPS key would hit.
  //
  // A LIST page says when it shows, from the same `load`. Its rows compile
  // showing the first page of the list, and the glass resets them to that
  // whenever the page loads -- but what each row's colour should be (is the
  // setting on?) is only known on the other side, so the page asks: one
  // constant frame, and the runtime paints the first page's rows. Without it a
  // lit setting would read unlit every time Settings opened.
  const listShow = isListScreen(screen) || isZoneScreen(screen) || isThermostatScreen(screen) || isCoverScreen(screen) ? [printhFrame(touchPayload(pageName(screen.id), PAGE_OBJNAME, "show"))] : [];
  if (isListScreen(screen))
    events.push({ page: pageName(screen.id), objname: PAGE_OBJNAME, event: "list.show", gesture: "show", subject: "$list.page" });
  // The lock's too: its title says what the runtime is waiting for, and a page
  // that loads comes back with every dot unlit -- which is how a wrong pattern
  // is cleared (the runtime loads the page again).
  if (isLockScreen(screen)) {
    listShow.push(printhFrame(touchPayload(pageName(screen.id), PAGE_OBJNAME, "show")));
    events.push({ page: pageName(screen.id), objname: PAGE_OBJNAME, event: "lock.show", gesture: "show" });
  }
  // The safeboot's page says it too, to the safeboot image and not to the runtime: that it is in this .tft, and up,
  // before the safeboot writes a word to it. A .tft without the page says nothing, and the screen stays as it was.
  if (screen.role === "safeboot") {
    listShow.push(printhFrame(touchPayload(pageName(screen.id), PAGE_OBJNAME, "show")));
    events.push({ page: pageName(screen.id), objname: PAGE_OBJNAME, event: "safeboot.show", gesture: "show" });
  }
  // the zone's page too: every word on it is the zone on show's, written after it loads
  if (isZoneScreen(screen))
    events.push({ page: pageName(screen.id), objname: PAGE_OBJNAME, event: "zone.show", gesture: "show", subject: "$zone.page" });
  // and the thermostat's: the same, for a different page
  if (isThermostatScreen(screen))
    events.push({ page: pageName(screen.id), objname: PAGE_OBJNAME, event: "thermostat.show", gesture: "show" });
  // and a blind's
  if (isCoverScreen(screen))
    events.push({ page: pageName(screen.id), objname: PAGE_OBJNAME, event: "cover.show", gesture: "show" });
  // A PLAN says when it shows for a stronger reason still: everything below its
  // header is drawn by the runtime, and a page that loads comes back as it was
  // compiled -- empty. Nothing is there until this frame is answered.
  if (screen.plan) {
    listShow.push(printhFrame(touchPayload(pageName(screen.id), PAGE_OBJNAME, "show")));
    events.push({ page: pageName(screen.id), objname: PAGE_OBJNAME, event: "plan.show", gesture: "show" });
  }
  // The first page, the one the panel starts on and the screensaver comes back
  // to, says which build the screen is as it loads.
  if (si === 0)
    events.push({ page: pageName(screen.id), objname: PAGE_OBJNAME, event: "panel.version", gesture: "version", text: true });
  const loadLines = [
    ...(showsKeyboard ? [...(add.some((c) => c.objname === "kbRef") ? ["click kbRef,0"] : []), "click kbDraw,0"] : []),
    ...listShow,
    ...(si === 0 ? [versionLine(pageName(screen.id), DEV_STAMP)] : []),
  ];
  const pageEvents = loadLines.length ? [{ event: "load", lines: loadLines }] : undefined;
  return {
    id: screen.id, name: pageName(screen.id), attributes: { bco: bg }, add,
    ...(pageEvents ? { events: pageEvents } : {}),
  };
});

// A Help body that breaks into more lines than the screen has would lose its
// end on the glass, with nothing to say so: the runtime writes the lines it
// has slots for. Refused here, where the width that broke it is known.
if (HELP_BODY.width !== undefined) {
  for (const item of SETTINGS_ITEMS) {
    const wrapped = helpLinesOf(item);
    if (wrapped.length > HELP_BODY.slots.size)
      throw new Error(
        `${themeId}: the help of "${item.label}" breaks into ${wrapped.length} lines at ${HELP_BODY.width} px in the ` +
        `${HELP_BODY.role} font, and the Help screen shows ${HELP_BODY.slots.size} -- shorten it in settings.items`,
      );
  }
}

// Program.s, what the display runs once at power on, before page 0. The base's
// is the Editor's default, and its `baud=9600` would leave the display talking
// at 9600 after every boot while the ESP32 listens at 115200: a panel deaf and
// mute, that FlashNextion cannot reach again either. Every
// production NSPanel file sets `bauds=115200`, which the display also keeps for
// its bootloader after a failed upload. joBr99's EU file runs
// `lcd_dev fffb 0002 0000 0020` before anything else and the US file does not,
// so each panel starts the way joBr99's file for it starts. The three
// ints are the page code's scratch registers (sys0 to sys2), and the printh is
// the ready message nextion_driver.be waits for.
function programFor(device) {
  return [
    "int sys0=0,sys1=0,sys2=0",
    "bauds=115200",
    "dim=100",
    "recmod=0",
    ...(device === "eu-landscape" ? ["lcd_dev fffb 0002 0000 0020"] : []),
    "printh 00 00 00 ff ff ff 88 ff ff ff",
    "page 0",
  ].join("\r\n") + "\r\n";
}

// The first screen takes over the base's own empty page; the rest are appended.
const [first, ...rest] = pages;
const scenario = {
  name: `p1-${projectId}-${deviceId}`,
  description:
    `${project.name} on ${deviceId}, compiled from projects/${projectId}/project.json by ` +
    `scripts/build-project-hmi.mjs. ${screens.length} screens, ` +
    `${screens.reduce((t, s) => t + s.place.length, 0)} placements becoming ` +
    `${pages.reduce((t, p) => t + p.add.length, 0)} Nextion components, in the theme "${themeId}". ` +
    "The base is the minimal eseverson project: one empty page, no fonts, and the same Modelcrc as " +
    "joBr99's file, which is the NX4832F035_011C this panel is. Pages draw and navigate on their own; " +
    "the serial protocol to berry/ is not in this step.",
  base: "eseverson-hmi/23_minimal_project_23.HMI",
  // every theme's fonts, the project's own first, in the order themeContext numbers them
  addFonts: usedThemes.flatMap((id) => FONT_ROLES.map((role) => ({
    file: join("..", "..", "themes", id, contexts.get(id).FONT_FILE[role]).replace(/\\/g, "/"),
  }))),
  ...(pictures.length ? { addPictures: pictures } : {}),
  setEncode: 24,
  // The Nextion inside an NSPanel is mounted upside down, so EU landscape is 3
  // and not 1. Measured (setHmiOrientation) and caught by the preflight: a
  // project left at the base's 1 compiles, passes every checksum, and draws
  // every screen half a turn over on the glass.
  setOrientation: { "eu-landscape": 3, "us-landscape": 3, "us-portrait": 2 }[deviceId] ?? 3,
  program: programFor(deviceId),
  addPages: rest.map(({ id, ...p }) => p),
  edits: {
    "0.pa": {
      // the base's page is renamed, not just repainted: `page <name>` is how one
      // page reaches another, so a page still called `page0` is a page nothing
      // can navigate to
      // the base's page is 480x320; a portrait project turns it on its side too,
      // or the first screen would be the one page still landscape
      changes: { page0: {
        attributes: { bco: first.attributes.bco, objname: first.name, ...(deviceId === "us-portrait" ? { w: 320, h: 480 } : {}) },
        // and its own load: the screen stamp it says, as the first page
        ...(first.events ? { events: first.events } : {}),
      } },
      add: first.add,
    },
  },
};

const out = join(root, "hmi-scenarios", `${scenario.name}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(scenario, null, 2) + "\n");

/**
 * The half of the compile that does NOT go into the `.tft`.
 *
 * A binding is a component whose text the panel will be told at run time, by
 * name: `page0.t3.txt="Living Room"`. That is a Nextion instruction and not a
 * protocol of ours -- `nextion_driver.be` already has `CustomSend` -- so the two
 * sides need no shared vocabulary beyond this file, which is generated from the
 * same declaration as the page it addresses.
 */
const runtime = {
  project: projectId,
  device: deviceId,
  theme: themeId,
  scenario: scenario.name,
  bindings,
  events,
};
const runtimeOut = join(root, "hmi-scenarios", `${scenario.name}.runtime.json`);
writeFileSync(runtimeOut, JSON.stringify(runtime, null, 2) + "\n");

const tablesOut = join(root, "hmi-scenarios", `${scenario.name}.jsonl`);
// the theme's role -> glyph table, so a bound icon role becomes THIS theme's
// drawing on arrival and nothing about codepoints ever crosses the wire
writeFileSync(tablesOut, generateTables(runtime, theme, Object.fromEntries(Object.keys(iconRoles).map((role) => [role, glyph(role)]))));

/**
 * The other half of the compiled page: the tables the brain fills it and reads
 * it with (berry/panel_runtime.be).
 *
 * Generated from the same manifest as the `.HMI`, which is the whole reason
 * there is no protocol to agree on. The page knows objnames and gestures; this
 * knows what they MEAN; and both come out of one `layout()`.
 *
 * Data and not code, in JSON Lines, so the panel reads no more of it than the
 * page on show needs:
 *   - the first line is what every page needs: the pages the views are drawn
 *     on, the theme's colours, glyphs and font advances, the plan's style, the
 *     writes every page may make, and the index of the lines below, name ->
 *     where its line starts, from the second line's start (a line runs to the
 *     next one's start);
 *   - a line per page: what a binding writes on it, and what each touch on it
 *     means;
 *   - a line per table only some pages need: the Settings list, and what the
 *     keyboard opens with and lets the finger type.
 * The panel parses the first line once, at boot, a page's line when that page
 * comes up, and a table's when a page asks for it; the heap holds the project's
 * own tables and ONE page's, however many pages the project has.
 */
function generateTables(runtime, theme, glyphs) {
  // the themes the layout draws with, the project's own first, and each by the
  // tag its placements' targets carry ("" for the project's own)
  const drawn = [...contexts.values()];
  const byTag = new Map(drawn.map((c) => [c.tag, c]));
  // path -> [[page, objname, attribute, ...], ...]
  const writes = new Map();
  // the font roles some text is fitted in, for the advance tables below
  const fitRoles = new Set();
  for (const b of runtime.bindings) {
    if (!writes.has(b.path)) writes.set(b.path, []);
    // a fourth element only when the value needs translating on arrival:
    // "glyph" turns an icon ROLE into this theme's glyph before it is written,
    // "switch" picks one of the two colours after it, "flip" writes max - value,
    // "fit" cuts a text to the box's width in its font, with an ellipsis
    if (b.fit && !b.kind) fitRoles.add(b.fit.font + (b.theme ?? ""));
    // and last, the tag of a placement of another theme than the project's, on
    // a target whose value the runtime resolves in a theme's tables: an icon
    // role, a text fitted in a font, a colour token (themeContext)
    const tag = b.theme ? [b.theme] : [];
    writes.get(b.path).push(
      b.kind === "switch" ? [b.page, b.objname, b.attribute, b.kind, b.on, b.off, ...(b.alt === undefined ? [] : [b.alt])]
        : b.kind === "flip" ? [b.page, b.objname, b.attribute, b.kind, b.max]
          : b.kind === "glyph" ? [b.page, b.objname, b.attribute, b.kind, ...tag]
            : b.kind ? [b.page, b.objname, b.attribute, b.kind]
              : b.fit ? [b.page, b.objname, b.attribute, "fit", b.fit.width, b.fit.font, b.maxl ?? RUNTIME_TEXT_MAX, ...tag]
                : [b.page, b.objname, b.attribute, ...(b.attribute === "txt" || b.attribute === "val" ? [] : tag)],
    );
  }
  // The Settings list, for the runtime to page through: how many row slots
  // this LAYOUT's template has (three on EU, five on the US portrait -- the same
  // list pages differently on each), the items in order, and which page Help is.
  // Two list pages may share the `$list.*` slots: the one with a
  // rail, for a view longer than one page, and its twin without one, whose
  // rows run to the margin. The rail's is THE list page; the other is short.
  // and a confirmation's page, whose two answers are list slots too, under its
  // sentence (`$dialog.lines.*`); and the QR's page, whose one row is the list's too:
  // the way to stop the Hotspot, under its code. Each is the screen that says so. (The US portrait's list puts
  // the value under the name, and has no short twin: the list's own rows say how)
  const qrScreenOf = screenWith("qr");
  const qrCode = qrScreenOf ? pages.find((p) => p.id === qrScreenOf.id).add.find((c) => c.type === "Qrcode") : undefined;
  const listScreen = screenWith("list");
  const dialogScreen = screenWith("dialog");
  const houseScreenOf = screenWith("house");
  const meshScreenOf = screenWith("mesh");
  const rowsOf = (screen) => (screen ? screen.place.filter((p) => rowSlot(p.bind?.label) !== null).length : 0);
  const listRows = rowsOf(listScreen);
  // The components every page may address, `page.objname`: what a binding
  // writes into one of them is written from any page, so it goes in the
  // project's line and not in its page's.
  const globals = new Set(pages.flatMap((p) => p.add.filter((c) => Number(c.attributes?.vscope) === 1).map((c) => `${p.name}.${c.objname}`)));
  const zoneScreenOf = screenWith("zone");
  const thermostatScreenOf = screenWith("thermostat");
  const coverScreenOf = screenWith("cover");
  const countOf = (screen, field, start) => (screen ? screen.place.filter((p) => typeof p.bind?.[field] === "string" && p.bind[field].startsWith(start)).length : 0);
  const zoneRows = zoneScreenOf ? zoneScreenOf.place.filter((p) => rowSlot(p.bind?.label) !== null).length : 0;
  const zoneCounters = zoneScreenOf ? zoneScreenOf.place.filter((p) => String(p.component).endsWith("/zone-counter")).length : 0;
  const helpScreen = screenWith("help");
  const detailScreen = screenWith("detail");
  const lockScreenOf = screenWith("lock");
  const planScreen = screenWith("plan");
  const page = (screen) => (screen ? pageName(screen.id) : null);

  // One line per page of the .tft, even one with nothing to write or read: a
  // page the runtime is told of and finds no line for is a page it cannot know.
  const perPage = new Map(pages.map((p) => [p.name, { page: p.name, writes: {}, events: {} }]));
  // page -> path -> the targets on that page's components every page may address
  const shared = {};
  // On a line a target is [objname, attribute, ...]: its page is the line's, or
  // its group's in `shared`, and not repeated in every target.
  const vises = new Set(["vis", "pages", "paged", "present"]);
  for (const [path, targets] of writes) {
    for (const [page, ...target] of targets) {
      if (globals.has(`${page}.${target[0]}`)) {
        // vis takes no page, and so reaches only the page on show: a component
        // written from any page cannot be shown or hidden from all of them
        if (vises.has(target[2])) throw new Error(`${path} shows or hides ${page}.${target[0]}, which every page may address`);
        ((shared[page] ??= {})[path] ??= []).push(target);
      } else {
        const line = perPage.get(page);
        if (!line) throw new Error(`${path} writes on ${page}, which is no page of this project`);
        (line.writes[path] ??= []).push(target);
      }
    }
  }
  // A binding with one target holds the target itself, and one with more the
  // list of them: a list of one would cost the ESP32 a list.
  const direct = (w) => { for (const path of Object.keys(w)) if (w[path].length === 1) w[path] = w[path][0]; };
  for (const line of perPage.values()) direct(line.writes);
  for (const group of Object.values(shared)) direct(group);
  // A touch is found by "<objname>,<gesture>" in its page's line, the rest of
  // the frame the glass sends ("ev,<page>,<objname>,<gesture>[,<value>]"): the
  // two cannot hold the comma the frame is split at.
  for (const e of runtime.events) {
    for (const [what, v] of [["the objname", e.objname], ["the gesture", e.gesture], ["the page", e.page]]) {
      if (String(v).includes(",")) throw new Error(`${what} ${JSON.stringify(v)} holds the comma the glass's frame is split at`);
    }
    const line = perPage.get(e.page);
    if (!line) throw new Error(`${e.objname} reports from ${e.page}, which is no page of this project`);
    // [event, subject]; with `true` when the frame ends in a number, "text"
    // when it ends in what the keyboard typed
    line.events[`${e.objname},${e.gesture}`] = [e.event, e.subject ? e.subject : null, ...(e.value ? [true] : e.text ? ["text"] : [])];
  }

  // Which page is the FIRST group screen, as this project declares it: the one
  // the screensaver hands the finger to. A close falls back to it when nothing
  // opened the screen it is closing -- after a reboot with the detail showing,
  // say. Taken from the manifest rather than written as "home" in brain.be,
  // which would be a page name invented on the Berry side.
  const homePage = screens[0]?.tap ? pageName(screens[0].tap) : pageName(screens[Math.min(1, screens.length - 1)].id);
  // How much the keyboard lets the finger type for each slot a text arrives in:
  // what fits in ordinary words in the WIDEST place the text is
  // shown, and not the narrowest place's worst case, which would hold a light's
  // name to 6 characters on every screen for one 98 px card: a narrower place
  // shows the start of it with an ellipsis (`fit`).
  const limits = new Map();
  for (const b of runtime.bindings) {
    if (b.maxl === undefined || !b.fit) continue;
    limits.set(b.path, Math.max(limits.get(b.path) ?? 0, (b.theme ? byTag.get(b.theme) : primary).typicalCapacity(b.fit.width, b.fit.font)));
  }
  // What the page was compiled showing. A title the user may rename has to have
  // a value before anyone ever renames it, and the project's own word for the
  // screen is that value -- read from here rather than written twice.
  const initial = new Map();
  for (const b of runtime.bindings) if (b.initial !== undefined) initial.set(b.path, b.initial);
  // Which keyboard opens: the one the layout NAMES (`editor`, schema 9), and
  // failing that the first it declares -- which is what this did before the
  // project could say, and which made an ordering accident into a decision.
  // The other one is a key away, on the glass. No page name is invented on the
  // Berry side either way, the same rule `home_page` follows.
  const isKeyboard = (s) => s.role === "keyboard";
  const named = layout.editor === undefined ? undefined : screens.find((s) => s.id === layout.editor);
  const keyboardScreen = named ?? screens.find(isKeyboard);
  // ALL of them, by kind, so the SETTING can pick. `keyboard_page` is the
  // factory default -- what the layout's `editor` names -- and the panel's own
  // switch overrides it at run time. The kind comes from the placement's
  // variant (`t9`, `symbols`), never from the screen's id. The symbols are
  // never the one a keyboard opens on: the finger reaches them from the
  // letters, on the glass.
  const kindOf = (s) => {
    const variant = s.place.find((p) => String(p.component).endsWith("/keyboard"))?.variant;
    return variant === "t9" ? "t9" : variant === "symbols" ? "symbols" : "qwerty";
  };
  if (keyboardScreen && kindOf(keyboardScreen) === "symbols")
    throw new Error(`${projectId}/${deviceId}: the keyboard it opens on is the symbols; name the letters or the keypad in "editor"`);
  // two keyboards of letters, the QWERTY and the keypad, for the Keypad switch to choose between: the US portrait has the keypad alone,
  // and no switch
  const hasBothPads = ["qwerty", "t9"].every((k) => screens.some((s) => isKeyboard(s) && kindOf(s) === k));
  // The plan: which page, and what it is drawn with. Resolved
  // HERE, from the theme, by the functions the simulator's plan layer resolves it
  // with (`planColors`, the font roles' order, the icon roles), so the glass and
  // the browser paint the same numbers. The area is what is left of the
  // visible grid below the header, inside the header's margins. A summary
  // card's name is fitted in the body font, whose advances the
  // style names rather than repeats.
  let planStyle = null;
  if (planScreen) {
    fitRoles.add("body");
    const vis = DEVICE_VISIBLE[deviceId];
    const glyphOf = (role) => glyphs[role] ?? glyphs.lightOff ?? "";
    const font = (role) => FONT_ROLES.indexOf(role);
    planStyle = {
      origin: [PLAN_LEFT, PLAN_TOP], area: [vis.w - 2 * PLAN_LEFT, vis.h - PLAN_TOP], radius: PLAN_CARD_RADIUS,
      colors: planColors(theme),
      // the zone colours' hues, the theme's card colour first
      palette: planPalette(theme),
      fonts: { icon: font("icon"), iconLarge: font("icon-large"), body: font("body") },
      // a kind's glyphs by state, [on, off, noanswer, nopower]: PanelDraw.GLYPH
      glyphs: Object.fromEntries(Object.entries(PLAN_GLYPH_ROLES).map(([kind, roles]) => [kind, roles.map(glyphOf)])),
      // the glyphs the screens drawn here use beyond the devices': the Alarm screen's cog
      icons: { settings: glyphOf("settings") },
      advances: "body",
    };
  }

  // The tables only some pages need, each a line of its own: the Settings list
  // (the list, its choices and Help), and the keyboard's two
  const tableLines = {
    // the Settings list, in order: [label, key, [help lines]], the Help lines
    // as THIS layout breaks them (`helpLinesOf`), not the paragraphs
    // the Keypad switch only where there are two keyboards of letters to switch between: the US portrait has the keypad alone
    settings: { items: SETTINGS_ITEMS.filter((item) => item.key !== "keyboardKind" || hasBothPads).map((item) => [item.label, item.key, helpLinesOf(item)]) },
    keyboard: {
      // binding path -> how many characters the keyboard lets the finger type
      limits: Object.fromEntries([...limits].sort((a, b) => a[0].localeCompare(b[0]))),
      // binding path -> what the compiled page already shows
      initial: Object.fromEntries([...initial].sort((a, b) => a[0].localeCompare(b[0]))),
    },
  };
  const lines = [];
  let at = 0;
  // a line after the first, and where it starts, from the second line's start
  const place = (line) => {
    const text = JSON.stringify(line);
    lines.push(text);
    const where = at;
    at += Buffer.byteLength(text, "utf8") + 1;
    return where;
  };
  const index = Object.fromEntries([...perPage].map(([p, line]) => [p, place(line)]));
  const tables = Object.fromEntries(Object.entries(tableLines).map(([name, t]) => [name, place({ table: name, ...t })]));
  const head = {
    // what berry/panel_runtime.be reads: a file of another format is refused
    // at boot, by name, and not misread
    format: 3,
    project: runtime.project, device: runtime.device, theme: runtime.theme, scenario: runtime.scenario,
    pages: index,
    tables,
    // page -> binding path -> its target(s) on that page's components every page may address
    shared,
    // theme colour token -> RGB565; another theme's, by the tag its placements'
    // targets carry, "icon-off@1" (themeContext)
    colors: Object.fromEntries(drawn.flatMap((c) => c.doc.colors.map((k) => [k.id + c.tag, k.rgb565]))),
    // icon role -> the glyph this theme's icon font carries, and another theme's by its tag
    glyphs: { ...glyphs, ...Object.fromEntries(drawn.slice(1).flatMap((c) => Object.keys(c.iconRoles).map((role) => [role + c.tag, c.glyph(role)]))) },
    // font role -> the advance of U+0020..U+00FF, a byte each, in hex: 224
    // bytes where a map of advances would cost the ESP32 kilobytes; another
    // theme's font role by its tag, "body@1"
    advances: Object.fromEntries([...fitRoles].sort().map((key) => {
      const at = key.indexOf("@");
      const role = at < 0 ? key : key.slice(0, at);
      const zi = (at < 0 ? primary : byTag.get(key.slice(at))).ZI[role];
      return [key, Buffer.from(ziAdvanceTable(zi)).toString("hex")];
    })),
    // the keyboard this project opens on, from the factory, and both by kind
    keyboard_page: page(keyboardScreen),
    keyboard_pads: Object.fromEntries(screens.filter(isKeyboard).map((s) => [kindOf(s), pageName(s.id)])),
    // where a close with no history lands (the screensaver's tap target)
    home_page: homePage,
    // the list page (Settings and every other list) and how many row slots it
    // has; a confirmation's page: the question, its sentence, two answers
    list_page: page(listScreen), list_rows: listRows, dialog_page: page(dialogScreen),
    // the house's page: its screens in list slots under its icons, and how many of each it has
    house_page: page(houseScreenOf), house_rows: rowsOf(houseScreenOf), house_icons: countOf(houseScreenOf, "count", "$house.icons."),
    // the mesh's page: its nodes in list slots under its cog, and how many rows it has
    mesh_page: page(meshScreenOf), mesh_rows: rowsOf(meshScreenOf),
    // the QR's page, the most bytes its code takes (a longer text the glass
    // would cut, and a cut code reads as another), and how many lines it has
    qr_page: page(qrScreenOf), qr_max: qrCode ? qrCode.attributes.txt_maxl : 0,
    qr_lines: qrScreenOf ? qrScreenOf.place.filter((p) => typeof p.bind?.text === "string" && p.bind.text.startsWith("$qr.lines.")).length : 0,
    // a zone's own page, how many device rows it has, and how many kind
    // counters its top card has
    zone_page: page(zoneScreenOf), zone_rows: zoneRows, zone_counters: zoneCounters,
    // a thermostat's own page, how many lines of words it has and how many modes
    thermostat_page: page(thermostatScreenOf),
    thermostat_lines: countOf(thermostatScreenOf, "text", "$thermostat.lines."),
    thermostat_modes: countOf(thermostatScreenOf, "label", "$thermostat.modes."),
    // a blind's own page
    cover_page: page(coverScreenOf),
    // the detail of a light, and of a joint mode
    detail_page: page(detailScreen),
    // the Help page, and how many body lines it has
    help_page: page(helpScreen),
    help_lines: helpScreen ? helpScreen.place.filter((p) => typeof p.bind?.text === "string" && p.bind.text.startsWith("$help.lines.")).length : 0,
    // the page with the pattern that guards Settings
    lock_page: page(lockScreenOf),
    // the page whose cards the runtime draws, and what that plan
    // is drawn with: berry/panel_draw.be's style
    plan_page: page(planScreen), plan_style: planStyle,
  };
  return [JSON.stringify(head), ...lines].join("\n") + "\n";
}

// THE FIELD SLIDES, so a slot is not capped by what the field can show.
//
// Two different boxes hold the same string -- the slot being renamed and the
// keyboard's field -- in two different fonts, so the slot can easily hold more
// than the field displays: on shadcn-dark the header is set in the body cut and
// the field in the title cut, 18 against 17. Cutting the declared capacity down
// to the field would make the panel refuse a name it has room to store.
//
// So the line slides. `kbDraw` shows the TAIL of anything longer than the window, so the caret and the character just
// typed are always on screen, and backspace walks it back. The slot keeps its
// own capacity, and this only reports what the field shows at a time.
const fieldWindow = KEYBOARD_FIELD.fits;

console.log(`${project.name} · ${deviceId} · theme ${themeId}`);
for (const p of pages)
  console.log(`  ${p.name.padEnd(16)} ${String(p.add.length).padStart(3)} components`);
for (const id of usedThemes) {
  const ctx = contexts.get(id);
  console.log(`\nfonts${ctx.tag ? ` of ${id} (${ctx.tag})` : ""}: ${FONT_ROLES.map((role) => `${ctx.FONT[role]}=${role}:${ctx.FONT_FILE[role].split("/").pop()}`).join("  ")}`);
}
for (const [i, p] of pictures.entries())
  console.log(`  picture ${i}: ${p.key}  ${p.width * p.height * 2} bytes raw`);
if (fieldWindow !== null) console.log(`  the editing field shows ${fieldWindow} characters at a time and slides for anything longer`);
console.log(`bindings: ${bindings.length}   reported events: ${events.length}`);
console.log(`wrote ${out}`);
console.log(`wrote ${runtimeOut}`);
console.log(`wrote ${tablesOut}`);

// `--build` also writes the `.HMI` from the scenario just regenerated, so the two are never of different
// generations.
if (flags.includes("--build")) {
  const build = join(root, "scripts", "build-hmi-scenario.mjs");
  // the copy the Editor compiles, stamped; the committed scenario keeps "dev"
  const stamp = buildStamp(tablesOut);
  const first = pageName(screens[0].id);
  const text = readFileSync(out, "utf8");
  const dev = JSON.stringify(versionLine(first, DEV_STAMP));
  if (text.split(dev).length !== 2) throw new Error(`${out}: the first page's stamp is not there once`);
  const stamped = out.replace(/\.json$/, ".stamped.json");
  writeFileSync(stamped, text.replace(dev, () => JSON.stringify(versionLine(first, stamp))));
  console.log(`
stamped ${stamped}: ${stamp}
building it ...`);
  const r = spawnSync(process.execPath, [build, stamped], { stdio: "inherit", cwd: root });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/**
 * "<commit>[+] <yyyy-mm-ddThh:mm> <tables>": the repository's HEAD, now, and the
 * first 8 hex digits of the SHA-256 of the tables file as written. Eight, and
 * not more: with them the first page's printh is 207 characters, 210 with the
 * "+", and the longest line of code measured to compile is 210 (the
 * m27 family).
 */
function buildStamp(tables) {
  const repo = resolve(root, "..", "..", "..");
  const git = (args) => {
    const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim() : "";
  };
  const commit = git(["rev-parse", "--short", "HEAD"]) || "unknown";
  const changed = git(["status", "--porcelain", "--untracked-files=no", "--", ".", ":(exclude)firmware/tasmota"]);
  const d = new Date();
  const two = (n) => String(n).padStart(2, "0");
  const hash = createHash("sha256").update(readFileSync(tables)).digest("hex").slice(0, 8);
  return `${commit}${changed ? "+" : ""} ${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())} ${hash}`;
}

/**
 * What the gesture Timer does on a page with a pattern pad, every tick the
 * finger is down.
 *
 * The finger is tested against the dots' COLUMNS and ROWS, three bands each
 * of `radius` either side of a centre, rather than against nine boxes: six
 * tests instead of nine, and none nested deeper than two. A finger in a
 * column band and a row band is on that dot -- `vaHit`, 1 to 9 -- and in
 * neither it is between dots, which is the point of a radius smaller than the
 * cell: the stroke from 1 to 6 passes between 2 and 5 without taking them.
 *
 * A dot the finger reaches for the first time -- its `pco` is not yet the lit
 * colour -- lights, adds its digit to `vaPat`, and gets a `line` from the
 * last one. The line is a drawing instruction, gone when the page loads again:
 * which is how the runtime clears a wrong pattern.
 */
function patternTick(pattern) {
  const r = pattern.radius;
  const lit = pattern.lit;
  const bands = (values) => [...new Set(values)].sort((a, b) => a - b);
  const xs = bands(pattern.dots.map((d) => d.cx));
  const ys = bands(pattern.dots.map((d) => d.cy));
  if (xs.length !== 3 || ys.length !== 3 || pattern.dots.length !== 9)
    throw new Error(`a pattern pad is nine dots in three columns and three rows, not ${pattern.dots.length} in ${xs.length} x ${ys.length}`);
  const band = (v, of, target) => of.flatMap((c, i) => [
    `if(${v}.val>=${c - r})`, "{", `  if(${v}.val<=${c + r})`, "  {", `    ${target}.val=${i + 1}`, "  }", "}",
  ]);
  return [
    "vaCol.val=0",
    ...band("vaLx", xs, "vaCol"),
    "vaRow.val=0",
    ...band("vaLy", ys, "vaRow"),
    "vaHit.val=0",
    "if(vaCol.val>0)", "{", "  if(vaRow.val>0)", "  {",
    // left to right: (row * 3 + column) - 3, the dot's number
    "    vaHit.val=vaRow.val*3+vaCol.val-3",
    "  }", "}",
    ...pattern.dots.flatMap((d, i) => [
      `if(vaHit.val==${i + 1})`, "{",
      `  if(${d.objname}.pco!=${lit})`, "  {",
      `    ${d.objname}.pco=${lit}`,
      `    vaPat.val=vaPat.val*10+${i + 1}`,
      "    if(vaPx.val>0)", "    {",
      `      line vaPx.val,vaPy.val,${d.cx},${d.cy},${lit}`,
      "    }",
      `    vaPx.val=${d.cx}`,
      `    vaPy.val=${d.cy}`,
      "  }", "}",
    ]),
  ];
}

/**
 * The long presses of a page on ONE Timer, for a page that would carry more
 * than it may.
 *
 * Each holdable component has a Timer of its own (layout/src/emit.ts, `attach`)
 * because a page-wide one needs a second place to remember WHICH component
 * armed it -- which is all this adds: `vaHold`, set by the press. The rest
 * stays what it was. The panel takes one finger, and a release reaches the
 * component the press did, so only one hold is ever counting: the release asks
 * the shared Timer whether it is still running (a tap) exactly as it asked its
 * own, and the Timer runs the hold of whichever component armed it.
 *
 * Only on a page that needs it, so a page that already compiles keeps its
 * bytes.
 */
function shareHoldTimers(add) {
  const holds = [];
  for (const t of add) {
    if (t.type !== "Timer" || t.attributes?.tim !== HOLD_MS || t.objname === "tmPlan") continue;
    const arm = `${t.objname}.en=1`;
    const owner = add.find((c) => c.events?.some((e) => e.event === "down" && e.lines.length === 1 && e.lines[0] === arm));
    if (owner) holds.push({ timer: t, owner });
  }
  if (holds.length < 2) return;
  const lines = ["tmHold.en=0"];
  holds.forEach(({ timer, owner }, i) => {
    // the Timer's own first line disarms it; the shared one did that above
    lines.push(`if(vaHold.val==${i + 1})`, "{", ...timer.events[0].lines.slice(1).map((l) => "  " + l), "}");
    const own = `${timer.objname}.en`;
    for (const e of owner.events) {
      if (e.event === "down") e.lines = [`vaHold.val=${i + 1}`, "tmHold.en=1"];
      else e.lines = e.lines.map((l) => l.split(own).join("tmHold.en"));
    }
    add.splice(add.indexOf(timer), 1);
  });
  add.push({ type: "Vari", objname: "vaHold", attributes: { sta: 0, val: 0 } });
  add.push({ type: "Timer", objname: "tmHold", attributes: { tim: HOLD_MS, en: 0 }, events: [{ event: "timer", lines }] });
}

/**
 * The gesture block of one screen: a TouchCap, a Timer and five Varis.
 *
 * Nextion's own recipe for the small series
 * (https://nextion.tech/2025/03/31/swipe-gestures-on-small-nextion-hmi/), which
 * only the Intelligent (P) series has natively -- Basic, Enhanced and Discovery
 * need this, per page. In short, `tch2`/`tch3` are documented to hold
 * the RELEASE coordinate and do not, so nothing here reads them. The Timer polls
 * `tch0`/`tch1` while the finger drags, and the last vector it computed is the
 * answer.
 *
 * Exercised end to end in the Editor's debugger: RIGHT 384, LEFT -384, UP -240, DOWN 240, and
 * `none` for a 32 px move, 23 Timer ticks per drag.
 */
function gestureComponents(screen, touchBoxes, pattern = null, rail = null) {
  const go = (id) => `page ${pageName(id)}`;
  const sw = screen.swipe ?? {};
  const out = [];
  const plan = screen.plan === true;
  const page = pageName(screen.id);
  // The pattern pad's own: the dots so far as a number, a digit each (vaPat),
  // the centre of the last one (vaPx/vaPy, where the next line starts), and the
  // column, row and dot the finger is on this tick.
  if (pattern)
    for (const v of ["vaPat", "vaPx", "vaPy", "vaCol", "vaRow", "vaHit"])
      out.push({ type: "Vari", objname: v, attributes: { sta: 0, val: 0 } });

  // vaGx/vaGy: where the finger went down. vaAx/vaAy: |vector|, computed on
  // release because the instruction set has no abs. vaVx/vaVy: the vector the
  // Timer keeps up to date, and the thing the release reads. vaHeld, on a plan:
  // the hold already reported this touch.
  for (const v of ["vaGx", "vaGy", "vaVx", "vaVy", "vaAx", "vaAy", "vaLx", "vaLy", "vaSame", "vaIn", ...(plan ? ["vaHeld"] : [])])
    out.push({ type: "Vari", objname: v, attributes: { sta: 0, val: 0 } });

  // |vaVx| and |vaVy| into vaAx and vaAy: the release needs them, and so does
  // the plan's hold, which has to tell a finger that stayed from a drag
  const absLines = [
    "vaAx.val=vaVx.val",
    "vaAy.val=vaVy.val",
    "if(vaAx.val<0)",
    "{",
    "  vaAx.val=0-vaAx.val",
    "}",
    "if(vaAy.val<0)",
    "{",
    "  vaAy.val=0-vaAy.val",
    "}",
  ];
  // A plan's report carries the point the finger went down at, as one number:
  // x * 1000 + y. One number because every value report has one field after the
  // fourth comma, and the runtime splits it back. Into `sys2` first because
  // `covx` takes a variable and not an expression, and `sys0` is the recipe's
  // own scratch (`sliderReadout` does the same). Evaluated left to right, the
  // only order the instruction set has.
  const planReport = (gesture) => [
    "sys2=vaGx.val*1000+vaGy.val",
    ...valueFrameLines(page, PLAN_OBJNAME, gesture, "sys2", "vaSend", "vaTmp"),
  ];
  const indent = (lines, depth) => lines.map((l) => "  ".repeat(depth) + l);

  // The plan's long press: a Timer the press arms when it lands in the plan,
  // and the release disarms. If it fires, the finger is still down, and it
  // counts as a hold only if it has not travelled as far as a swipe -- the
  // Timer that samples `tch0`/`tch1` keeps the vector current. One Timer for
  // the page and not one per card, because the cards are not components: the
  // runtime decides which card the point is in.
  if (plan) {
    out.push({
      type: "Timer", objname: "tmPlan", attributes: { tim: HOLD_MS, en: 0 },
      events: [{
        event: "timer",
        lines: [
          "tmPlan.en=0",
          ...absLines,
          `if(vaAx.val<${SWIPE_MIN_MOVE})`,
          "{",
          `  if(vaAy.val<${SWIPE_MIN_MOVE})`,
          "  {",
          "    vaHeld.val=1",
          ...indent(planReport("hold"), 2),
          "  }",
          "}",
        ],
      }],
    });
  }

  out.push({
    type: "Timer", objname: "tmGest", attributes: { tim: SWIPE_TICK_MS, en: 0 },
    events: [{
      event: "timer",
      // Guarded on tch0: the firmware zeroes the live pair at release, and a
      // tick landing in that window would rewrite the vector as `0 - origin`,
      // throwing the measurement away a millisecond before the release reads it.
      lines: [
        "if(tch0!=0)",
        "{",
        "  vaLx.val=tch0",
        "  vaLy.val=tch1",
        "  vaVx.val=tch0-vaGx.val",
        "  vaVy.val=tch1-vaGy.val",
        // how far up or down so far, kept live for the taps of a page that scrolls
        "  vaAy.val=vaVy.val",
        "  if(vaAy.val<0)",
        "  {",
        "    vaAy.val=0-vaAy.val",
        "  }",
        ...(pattern ? indent(patternTick(pattern), 1) : []),
        "}",
      ],
    }],
  });

  const release = [
    "tmGest.en=0",
    ...(plan ? ["tmPlan.en=0"] : []),
    ...absLines,
  ];
  // The pad's one report: the dots, when the finger reached any. Whatever the
  // gesture was otherwise -- the pad is not a touch box, so nothing gates it.
  if (pattern)
    release.push("if(vaPat.val>0)", "{", ...indent(valueFrameLines(page, pattern.objname, "change", "vaPat.val", "vaSend", "vaTmp"), 1), "}");

  // A gesture that began and ENDED in the same touchable box is that
  // component's, not the page's. Without this a
  // 60 px drag inside a 98 px card would be a tap AND a carousel swipe, and
  // dragging the 420 px brightness rail would page away mid-adjustment.
  //
  // Tested per box because the instruction set has no rectangle test and no
  // list: the generator knows every box it emitted, so the code is written out
  // rather than looked up. It is flash, not RAM.
  // ONLY when the page has a gesture of its own to suppress. `vaSame` exists to
  // stop a drag inside one component from also being the page's swipe -- so on a
  // page with no swipe and no tap it is a flag nothing reads, and writing it
  // costs about thirty lines PER touchable box. The keyboard has forty-four of
  // them: 1 369 lines of bytecode computing an answer nobody asks for. The Timer that tracks `vaLx`/`vaLy` is separate and stays --
  // every component's own guard reads it.
  // A page with a paged list has one too: its vertical swipe turns the page.
  const scrolls = rail !== null && !screen.swipe?.up && !screen.swipe?.down;
  // a plan reports its four swipes to the runtime, so it has a gesture whatever the project declares for them
  const pageHasGesture = Boolean(screen.tap) || plan || SWIPE_DIRECTIONS.some((d) => screen.swipe?.[d]) || scrolls;
  release.push("vaSame.val=0");
  // On a page that scrolls, only a slider keeps a gesture from being the page's:
  // its drag is its own. A row, a counter or a title does not, and the swipe that
  // starts or ends on one scrolls; their taps are the ones that did
  // not travel a swipe (emit.ts:still).
  for (const b of pageHasGesture ? (scrolls ? touchBoxes.filter((t) => t.slider) : touchBoxes) : []) {
    const x2 = b.x + b.w - 1;
    const y2 = b.y + b.h - 1;
    // Two passes of four tests rather than one of eight: the origin sets a
    // scratch flag, then the end is only tested when that flag is up. Same
    // answer, five levels of nesting instead of nine -- and nobody here knows
    // how deep the Editor lets an `if` go, so the shallower shape is the one
    // that does not have to find out.
    const inside = (vx, vy, then, depth) => {
      const pad = (n) => "  ".repeat(depth + n);
      return [
        `${pad(0)}if(${vx}.val>=${b.x})`, `${pad(0)}{`,
        `${pad(1)}if(${vx}.val<=${x2})`, `${pad(1)}{`,
        `${pad(2)}if(${vy}.val>=${b.y})`, `${pad(2)}{`,
        `${pad(3)}if(${vy}.val<=${y2})`, `${pad(3)}{`,
        `${pad(4)}${then}`,
        `${pad(3)}}`, `${pad(2)}}`, `${pad(1)}}`, `${pad(0)}}`,
      ];
    };
    release.push(
      "vaIn.val=0",
      ...inside("vaGx", "vaGy", "vaIn.val=1", 0),
      "if(vaIn.val==1)",
      "{",
      ...inside("vaLx", "vaLy", "vaSame.val=1", 1),
      "}",
    );
  }

  // Everything from here on is the PAGE's gesture, so none of it runs when the
  // finger stayed inside one component: that gesture belongs to the component,
  // and the component's own release already decided what to do with it.
  //
  // No `return` anywhere below: the instruction set has none ("Invalid
  // command", the Editor's compiler). None is needed either -- the
  // branches exclude each other by their own tests: a horizontal swipe clears
  // |vx| >= 60, which the vertical branch (|vx| <= 30) and the tap (|vx| < 60)
  // both refuse, and a vertical one likewise.
  let gated = [];

  // Left and right on a plan are the carousel between plans, and the plans are
  // all this one page, drawn by the runtime -- so the glass reports them rather
  // than jumping. The schema refuses a plan that declares either (schema 11).
  if (plan) {
    gated.push(
      `if(vaAx.val>=${SWIPE_MIN_MOVE})`, "{", `  if(vaAy.val<=${SWIPE_MAX_ORTHO})`, "  {",
      "    if(vaVx.val<0)", "    {", `      ${printhFrame(touchPayload(page, PAGE_OBJNAME, "left"))}`, "    }",
      "    if(vaVx.val>0)", "    {", `      ${printhFrame(touchPayload(page, PAGE_OBJNAME, "right"))}`, "    }",
      "  }", "}",
    );
  }

  // Horizontal first, then vertical, then the tap. Order matters: a gesture that
  // cleared both thresholds is diagonal and the orthogonal test rejects it in
  // both branches, so it falls through to the tap -- which is the safe end, not
  // a random one of the two.
  // Each direction goes where it was declared and nowhere else: a swipe the
  // other way cleared the threshold too, so neither the tap nor the other
  // axis takes it, and it goes nowhere: a direction written without its sign
  // would make the up swipe on a plan open Settings as the down one does.
  if (sw.left || sw.right) {
    gated.push(`if(vaAx.val>=${SWIPE_MIN_MOVE})`, "{", `  if(vaAy.val<=${SWIPE_MAX_ORTHO})`, "  {");
    if (sw.right) gated.push("    if(vaVx.val>0)", "    {", `      ${go(sw.right)}`, "    }");
    if (sw.left) gated.push("    if(vaVx.val<0)", "    {", `      ${go(sw.left)}`, "    }");
    gated.push("  }", "}");
  }
  // Up and down on a plan with no page declared for them are reported, as left
  // and right are: the runtime opens Wireless settings with the first and Main
  // settings with the second.
  const planUp = plan && !sw.up;
  const planDown = plan && !sw.down;
  if (sw.up || sw.down || planUp || planDown) {
    // y grows downward, so a positive vector is DOWN.
    gated.push(`if(vaAy.val>=${SWIPE_MIN_MOVE})`, "{", `  if(vaAx.val<=${SWIPE_MAX_ORTHO})`, "  {");
    if (sw.down) gated.push("    if(vaVy.val>0)", "    {", `      ${go(sw.down)}`, "    }");
    if (sw.up) gated.push("    if(vaVy.val<0)", "    {", `      ${go(sw.up)}`, "    }");
    if (planUp) gated.push("    if(vaVy.val<0)", "    {", `      ${printhFrame(touchPayload(page, PAGE_OBJNAME, "up"))}`, "    }");
    if (planDown) gated.push("    if(vaVy.val>0)", "    {", `      ${printhFrame(touchPayload(page, PAGE_OBJNAME, "down"))}`, "    }");
    gated.push("  }", "}");
  }
  // A page with a paged list and no vertical swipe of its own: the swipe turns
  // the list's page, the way a finger scrolls a list -- up to the next page,
  // down to the one before. The glass reports it, as a
  // plan reports its carousel, and the runtime turns the page and writes the
  // rail, and does nothing at either end. Until the same day it moved the rail
  // and ran the rail's release with `click`, which turned nothing on the glass.
  if (scrolls) {
    gated.push(`if(vaAy.val>=${SWIPE_MIN_MOVE})`, "{", `  if(vaAx.val<=${SWIPE_MAX_ORTHO})`, "  {",
      "    if(vaVy.val<0)", "    {", `      ${printhFrame(touchPayload(page, PAGE_OBJNAME, "up"))}`, "    }",
      "    if(vaVy.val>0)", "    {", `      ${printhFrame(touchPayload(page, PAGE_OBJNAME, "down"))}`, "    }",
      "  }", "}");
  }
  // Last, and only when the vector cleared nothing: this is the tap.
  if (screen.tap) {
    gated.push(`if(vaAx.val<${SWIPE_MIN_MOVE})`, "{", `  if(vaAy.val<${SWIPE_MIN_MOVE})`, "  {", `    ${go(screen.tap)}`, "  }", "}");
  }
  // A plan's tap is reported with its point, when it went down in the plan: the
  // header above it is components, and they answer their own touches.
  if (plan) {
    gated.push(
      `if(vaAx.val<${SWIPE_MIN_MOVE})`, "{", `  if(vaAy.val<${SWIPE_MIN_MOVE})`, "  {",
      `    if(vaGy.val>=${PLAN_TOP})`, "    {", ...indent(planReport("tap"), 3), "    }",
      "  }", "}",
    );
  }

  // On a plan, a hold has already reported this touch: the finger is only
  // coming back up, wherever it has wandered since, and none of it runs.
  if (plan && gated.length > 0) gated = ["if(vaHeld.val==0)", "{", ...indent(gated, 1), "}"];

  // The gate. `vaSame` was set above when the gesture began AND ended inside one
  // component's box -- in which case the gesture was that component's, and the
  // page keeps its hands off.
  if (gated.length > 0) {
    release.push("if(vaSame.val==0)", "{", ...gated.map((l) => "  " + l), "}");
  }
  out.push({
    type: "Touchcap", objname: "tcGest", attributes: { val: 0 },
    events: [
      {
        event: "down",
        lines: [
          // every touch says so, first: the runtime's screensaver clock starts
          // again, and a screen it turned off lights up. The
          // keyboard's keys, a slider's drag and the pattern's strokes tell the
          // runtime nothing until they end, so without this they were no touch
          printhFrame(touchPayload(page, PAGE_OBJNAME, "touch")),
          "vaGx.val=tch0", "vaGy.val=tch1", "vaLx.val=tch0", "vaLy.val=tch1", "vaVx.val=0", "vaVy.val=0", "vaAx.val=0", "vaAy.val=0", "tmGest.en=1",
          // a new stroke: no dots yet, and no line to start from
          ...(pattern ? ["vaPat.val=0", "vaPx.val=0", "vaPy.val=0"] : []),
          // a press in the plan arms its hold; one in the header does not
          ...(plan ? ["vaHeld.val=0", `if(vaGy.val>=${PLAN_TOP})`, "{", "  tmPlan.en=1", "}"] : []),
        ],
      },
      { event: "up", lines: release },
    ],
  });

  return out;
}
