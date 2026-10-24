// A panel project, as data.
//
// A project is what becomes one `.HMI` and, after the Editor, one `.tft`. It
// names the device it addresses, the themes it draws from, and the
// screens it has.
//
// A screen is a LIST OF PLACEMENTS: a component, in a box, with its props. Not
// "which React screen draws this", which has two faults that are the same fault. A
// screen that names one renderer cannot mix components from several themes, which
// is what a project is supposed to be able to do. And geometry that lives
// inside a React component cannot be emitted: a Nextion page IS a list of placed
// components, so a project that does not carry boxes has nothing to compile.
//
// The old `layout: "donor"` mode went with it. Borrowing joBr99's compiled boxes
// was the exploration-phase crutch; a project that places its own
// components does not need it, and the donor screens were a second, parallel
// implementation that went around the themes entirely -- which is why a
// shadcn project still showed a joBr99 clock.
//
// What is deliberately NOT here: devices, Zigbee groups, groups, names. Those are
// configuration the user edits on the panel after the flash, not something a
// build decides.
import type { ComponentSpec, Theme } from "./theme.js";
import { IssueList, ValidationError } from "./issues.js";
import {
  ID_PATTERN, optionalString, requireArray, requireInt, requireObject, requireSchemaVersion, requireString, uniqueBy,
} from "./schema.js";

// 3: `designSystems` became `themes`, and a placement's `designSystem` became
// `theme`, one word for the tab, the documents and the code. A field rename is a
// breaking change like any other, so the version moves and an older document is
// refused as old rather than parsed with a field that is not there.
//
// 4: a project holds a LAYOUT PER PANEL instead of one `device` and one list of
// screens. The same room exists on both units -- joBr99 ships an EU file and a
// US portrait one from a single project -- and the geometry cannot be shared
// between them: the EU grid is 480x320 landscape and the US one 320x480
// portrait, so a box placed for one is meaningless on the other. Declaring both
// up front, with either allowed to be empty, is what lets a project say "this
// room is designed for EU, and the US layout has not been drawn yet" instead of
// being silently EU-only.
// 5: a placement may name a `variant` -- which of the theme's styles of that
// component to draw. A theme is allowed more than one drawing of the same
// element (theme schema 6), and without this the only way to pick the second one
// would have been to invent a second component id, which would have been a lie
// about the contract: the props, the events and the hardware obligations belong
// to the component and do not vary between styles. Omitted means `default`, so
// every project written before this one still parses and still means the same.
// 6: a placement may carry `render` -- how its generated pixels are drawn for
// the glass, starting with `dither`. Dither costs 4x on a brightness track in the
// picture codec:
// it is a look-versus-flash choice, and the place to make it is the placement
// that shows the picture, not the theme (which draws the same track for every
// project) and not only the project (a screen may want one smooth slider and
// three cheap ones). `dither: "auto"` -- the default when omitted -- turns it
// on where it makes sense and only there: a ramp dither can help (never hue) at
// a width where the bands would show; `true`/`false` overrides. It is a
// RENDERING choice: the codec is lossless and always picks the smaller form.
// 7: two things the panel does with a finger that no component owned.
//    - a placement may carry `input` -- how it takes input, starting with
//      `live` for sliders: report the value while dragging (joBr99's
//      "experimental sliders"), or only when the finger lets go. `"auto"`, the
//      default, follows the panel's own "live slider update" setting at run
//      time; `true`/`false` pin it for this slider. It is per slider, because a
//      brightness rail wants to feel immediate and a colour-temperature rail
//      does not.
//    - a screen may carry `tap` -- the screen a tap ANYWHERE on it goes to.
//      It is the screensaver's way out, and it is the screen's and not a
//      component's: on the glass it is a TouchCap (joBr99's `tc0`), which has
//      no box and hears every touch on the page.
// 8: a screen may carry `swipe` -- where each of the four directions goes. The
// panel navigates by gesture: left/right are the group carousel,
// down is settings, up is adding a device. On the glass it is the SAME TouchCap
// as `tap`, because a tap is a swipe whose vector did not clear the threshold,
// and two TouchCaps on one page would both fire on every touch.
// 9: a layout may carry `editor` -- WHICH keyboard screen the runtime opens
// when something asks to edit a name. The panel carries two: the
// QWERTY EditBoard and the T9 EditPad, and a key on each jumps to the other on
// the glass. Which one the finger STARTS on is the project's to say, not an
// ordering accident of the screens it declares. Per LAYOUT and not per project, because the answer
// genuinely differs: on the EU landscape a QWERTY key is 6.2 mm and usable, on
// the 320-wide portrait it is 4.0 mm and the keypad is the kinder default.
// 10: a project may carry `settings` -- the LIST the Settings screen pages
// through: each item's label, the preference it flips (`key`) and its Help
// lines. Settings is a template: one Nextion page with a few row slots and a
// scrollbar, the rows filled at run time from this list. So the list is content,
// read by the simulator, by the compile step (into the manifest the Berry pages
// with) and by nothing else.
// 11: a screen may carry `plan` -- everything below its header is a PLAN the
// panel draws at run time, cards of zones the user made on the glass.
// Nothing is compiled there, so no placement may reach below
// `PLAN_TOP`. The page reports when it shows, and where a finger tapped or held
// in the plan, and a left or right swipe: those are the carousel between plans,
// which lives on the other side, so a plan declares neither of them, nor a
// `tap`. The Home of a room is a plan.
// 12: a screen may carry `role` -- what the runtime knows it by. A page found by something it happens to hold (the
// detail by a slider bound to `$light.brightnessPct`, the help by a title bound to `$help.title`, the lock by its
// pattern pad) is found as the wrong one, or not at all, the moment it is redrawn with another component or a second
// page looks like it, and nothing says so. So the screen says what it is, and the generator refuses a role whose page
// lacks what the role needs. A role is one screen's of a layout, but the keyboards,
// which are three (the letters, the keypad and the signs).
// 13: a placement may carry `smallTouch` -- why it may be smaller than its component's touch minimum, which the funnel
// otherwise refuses. The row of buttons under a page's title is 48 px on both panels,
// below the 12 mm every other touch keeps, and on the EU what that page has under it shrinks too: each such placement
// says so, with the reason, and nothing else is let through.
// 14: a placement may carry `alternate` -- which of the things that take turns in one place it is. Two placements that cover the same
// pixels are refused, since on the glass the lower one cannot be touched; but two that never show together can share a place: the
// house's page has its icons where the mesh has its buttons, and the runtime shows one or the other. Both
// bind `visible` and name different alternates, or the overlap is refused as before (a hidden Nextion component takes no touch).
export const PROJECT_SCHEMA_VERSION = 14;

/**
 * Where a plan starts on the page: below the 78 px header and an 8 px gap, on
 * every panel. Every placement of a plan screen ends above it.
 */
export const PLAN_TOP = 86;

/**
 * The plan's left edge: none. The plan runs the visible width of the glass, edge
 * to edge; the header keeps its own margins.
 */
export const PLAN_LEFT = 0;

/**
 * Which panel the project addresses. The `.HMI` header carries a `Modelcrc`
 * saying the same thing, which is why a project cannot be shown on the wrong
 * device: it would be drawing something that will never exist.
 */
export type DeviceId = "eu-landscape" | "us-landscape" | "us-portrait";

export const DEVICES: readonly DeviceId[] = ["eu-landscape", "us-landscape", "us-portrait"];

/**
 * The Nextion grid of each panel, in pixels.
 *
 * This is the grid the Editor judges, not the glass you can see: on the EU unit
 * the bezel hides 30 of the 480 columns, and a component placed out
 * there compiles and is never seen. Placement is refused outside the GRID,
 * because that is the measured refusal — `Error:Page:page0 Fail:<obj> Position
 * Invalid.` — and the hidden strip is a design problem the
 * simulator shows rather than a build error.
 */
export const DEVICE_GRID: Record<DeviceId, { w: number; h: number }> = {
  "eu-landscape": { w: 480, h: 320 },
  "us-landscape": { w: 480, h: 320 },
  "us-portrait": { w: 320, h: 480 },
};

/**
 * Panel pixels per millimetre, which is what turns a touch minimum in
 * millimetres into a box a project can be judged against.
 *
 * The EU unit shows 450 of its 480 columns through a 69.2 mm window; the US
 * ones show all 480 through 73.4 mm. The number is the same to
 * two decimals on all three, which is a fact about the panel and not a
 * coincidence: they are the same 3.5-inch glass in different housings.
 */
export const DEVICE_PX_PER_MM: Record<DeviceId, number> = {
  "eu-landscape": 450 / 69.2,
  "us-landscape": 480 / 73.4,
  "us-portrait": 480 / 73.4,
};

/**
 * The part of the grid that is actually visible through the housing's bezel.
 *
 * The EU unit covers its **30 rightmost columns** — "the 30 most right pixels
 * are not visible in the EU model, making the useful area only 450x320"
 * (Blackymas/NSPanel_HA_Blueprint #713, and it matches what a ruler said here).
 * So the grid is 480 wide and the glass shows 0..449.
 *
 * A component placed out there compiles, costs RAM, and cannot be seen or
 * touched — which is worse than a build error, because nothing says so. The
 * Editor will not refuse it; we do.
 *
 * Note which side: the hidden strip is NOT split evenly, and assuming it is
 * puts every full-width component ten pixels behind the bezel.
 */
export const DEVICE_VISIBLE: Record<DeviceId, { x: number; y: number; w: number; h: number }> = {
  "eu-landscape": { x: 0, y: 0, w: 450, h: 320 },
  "us-landscape": { x: 0, y: 0, w: 480, h: 320 },
  "us-portrait": { x: 0, y: 0, w: 320, h: 480 },
};

/**
 * How much of a touch target the bezel stands for, when a box is flush with a
 * visible edge: half a fingertip. A finger pressing a target in the corner
 * lands half on the glass and half on the frame, and the half on the frame
 * presses nothing else (for the page-rail). So a
 * 12 mm target flush with the edge needs 7 mm of glass. Not measured on this
 * glass: the dispersion of its touch is still an open measurement.
 */
export const EDGE_CREDIT_MM = 5;

/** `"<theme id>/<component id>"` */
const COMPONENT_REF = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface Placement {
  /** the reference as written, `"<theme>/<component>"` */
  component: string;
  /** the theme half, which is what lets one screen mix several */
  theme: string;
  /** the component half */
  componentId: string;
  /**
   * Which of the theme's styles of this component to draw.
   *
   * `default` when the placement does not say, which is the common case. The
   * theme declares what it offers (`components[].variants`), so a name nothing
   * fills is refused by the funnel and not discovered in the Editor.
   */
  variant: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * The component's props. A string beginning with `$` is a binding into the
   * panel's runtime state (`$clock.time`, `$lights.0`, `$screen.title`);
   * anything else is a literal. Keeping both in one map is what lets a placement
   * be read as "this component, here, showing this" in one line.
   */
  bind: Record<string, string | number | boolean>;
  /**
   * How this placement's generated pixels are drawn for the glass (schema 6).
   *
   * `dither`: `"auto"` turns it on where it makes sense and only there -- a ramp
   * dither can help (brightness, colour-temp; never hue) at a width where the
   * bands would show; `true`/`false` force it. Dither is the smoother look and,
   * since the codec pays per run of one colour, about 4x the flash for a
   * brightness track. Nothing here changes what the simulator draws.
   */
  render: { dither: "auto" | boolean };
  /**
   * How this placement takes input (schema 7).
   *
   * `live`: for a slider, whether the value is reported while the finger drags
   * (`true`), only when it lets go (`false`), or as the panel's own "live slider
   * update" setting says at run time (`"auto"`, the default). Ignored by
   * components that have no drag.
   */
  input: { live: "auto" | boolean };
  /**
   * Why this placement may be smaller than its component's touch minimum (schema 13), or null: the minimum holds. The
   * row under a page's title, and what it leaves on the EU.
   */
  smallTouch: string | null;
  /**
   * Which of the things that take turns in this place the placement is (schema 14), or null: it takes no turns. Two that overlap are
   * let through when both name an alternate, different ones, and both bind `visible`: the runtime never shows the two at once.
   */
  alternate: string | null;
}

/**
 * One panel's worth of a project: the screens as laid out for THAT grid.
 *
 * Not shared between panels, and it cannot be: 480x320 landscape and 320x480
 * portrait have nothing in common but the component vocabulary. An empty
 * `screens` is legal and means exactly what it says -- this panel is declared
 * and not drawn yet.
 */
export interface Layout {
  device: DeviceId;
  screens: Screen[];
  /**
   * The keyboard screen the runtime opens (schema 9).
   *
   * Absent means the first screen of this layout that places a keyboard, which
   * is what the generator did before anyone could say otherwise. Naming it is
   * how a project stops depending on the order its screens happen to be in.
   */
  editor?: string;
}

/**
 * The panels every project has to declare, empty or not.
 *
 * The two that exist as real hardware with a preview preset, and the two joBr99
 * himself publishes (`nspanel.tft` and `nspanel_US_P.tft`). `us-landscape` is a
 * known device id and stays optional: no preset draws it and nothing targets it.
 */
export const REQUIRED_DEVICES: readonly DeviceId[] = ["eu-landscape", "us-portrait"];

export interface Screen {
  id: string;
  title: string;
  /**
   * The colour token this page is painted in, from one of the project's design
   * systems. Optional, defaulting to `background`.
   *
   * It belongs to the SCREEN and not to the theme because a Nextion page
   * carries its own `bco`, and because joBr99 genuinely uses two: his cards are
   * ha-dark (6371) and his screensaver is pure black (0). A theme with a
   * single background token could not say that, and the simulator drew his
   * screensaver in the wrong colour for a week.
   */
  background?: string;
  /**
   * The screen a tap ANYWHERE on this one goes to (schema 7) -- the
   * screensaver's way out. On the glass it is a TouchCap, which hears every
   * touch on the page whatever component is under the finger; in the
   * simulator, a click on the screen. Absent means the screen has to offer
   * its own navigation, and a screen with none at all is refused by the
   * compile step rather than given an invented exit.
   */
  tap?: string;
  /**
   * Where a swipe goes, per direction (schema 8).
   *
   * The decided navigation of the panel: left/right are the group carousel,
   * down is settings, up is adding a device. Each names a screen
   * of this same layout, and an unknown one is refused exactly like `tap`'s.
   *
   * On the glass this and `tap` are the SAME TouchCap: a tap is a swipe whose
   * vector did not clear the threshold, so one component answers both and the
   * release decides which happened. That is not an optimisation -- two
   * TouchCaps on a page would both see every touch and both act.
   */
  swipe?: { left?: string; right?: string; up?: string; down?: string };
  /**
   * Everything below the header is a plan the panel draws at run time
   * (schema 11): the cards of the zones, from the store, and nothing compiled.
   * The glass reports `show`, where a finger tapped or held (`plan.tap`,
   * `plan.hold`, the point it went down at) and the left and right swipes
   * (`nav.swipe`), which move between plans on the other side.
   */
  plan?: boolean;
  /** what the runtime knows this screen by (schema 12); at most one screen of a layout has each role, but the keyboards */
  role?: ScreenRole;
  place: Placement[];
}

/**
 * What a screen is to the runtime (schema 12): `rest` the screensaver, `plan` the Home, `zone` a zone's screen,
 * `thermostat` a thermostat's, `cover` a blind's, `detail` a light's, `list` the paged list (Settings and every other view of it),
 * `house` the house's (the list under its icons), `mesh` the mesh's (the list under its cog), `dialog` a confirmation, `qr` the
 * code's, `help`, `lock` the pattern that guards Settings, `keyboard`, and `safeboot`, the page the safeboot image draws while it
 * writes the firmware, which no runtime of the app writes to.
 */
export const SCREEN_ROLES = [
  "rest", "plan", "zone", "thermostat", "cover", "detail", "list", "house", "mesh", "dialog", "qr", "help", "lock", "keyboard", "safeboot",
] as const;
export type ScreenRole = (typeof SCREEN_ROLES)[number];

/** The four directions, in the order the generated event code tests them. */
export const SWIPE_DIRECTIONS = ["left", "right", "up", "down"] as const;
export type SwipeDirection = (typeof SWIPE_DIRECTIONS)[number];

/**
 * One entry of the Settings list (schema 10).
 *
 * `label` is drawn twice -- as a row, and as Help's title -- so it has to fit
 * the smaller of the two budgets it meets. `help` is PARAGRAPHS, "" for a
 * blank line: a Nextion Text does not wrap, so each layout breaks
 * them into lines at its own Help width, in its theme's font -- the generator
 * for the glass, the simulator for the browser, with one function
 * (`wrapZiText`). A line cut by hand for the narrowest panel still reads the
 * same: a line that fits 290 px is a paragraph that fits it. Each paragraph takes at least a line, so there are
 * at most `HELP_LINE_COUNT` of them; how many lines they BREAK into is only
 * known per layout, and the generator refuses a body that outgrows the screen.
 * `key` names the preference: the runtime on each side owns what flipping it
 * DOES, and a key that side has no action for is still remembered there as a
 * plain on/off (`brain.be`'s `flags`), so the row shows what it was left at.
 */
export interface SettingsItem {
  label: string;
  key: string;
  help: string[];
}

/** How many body lines Help shows; `layout`'s `SCREEN_GEOMETRY.helpLineCount`, which `core` cannot import. */
export const HELP_LINE_COUNT = 5;

export interface Project {
  schemaVersion: number;
  id: string;
  name: string;
  description: string;
  /** theme ids this project draws from; a placement may name any of them */
  themes: string[];
  /** one per panel, in `REQUIRED_DEVICES` order first, then any extras */
  layouts: Layout[];
  /** what the Settings screen lists, in order (schema 10); empty when it has none */
  settings: { items: SettingsItem[] };
}

/** This project's layout for one panel, if it declares that panel at all. */
export function layoutFor(project: Project, device: DeviceId): Layout | undefined {
  return project.layouts.find((l) => l.device === device);
}

/** Every screen of every panel, for the counts and sweeps that want all of them. */
export function allScreens(project: Project): { device: DeviceId; screen: Screen }[] {
  return project.layouts.flatMap((l) => l.screens.map((screen) => ({ device: l.device, screen })));
}

function parsePlacement(at: IssueList, entry: unknown, grid: { w: number; h: number }): Placement {
  const o = requireObject(at, entry);
  const component = requireString(at, o, "component");
  if (component && !COMPONENT_REF.test(component))
    at.add({
      path: "component", rule: "bad-format", source: "ours",
      message: 'a placement names "<theme>/<component>"', got: component,
    });
  const [theme = "", componentId = ""] = component.split("/");

  const x = requireInt(at, o, "x", { min: 0, max: grid.w - 1 });
  const y = requireInt(at, o, "y", { min: 0, max: grid.h - 1 });
  // 2 is the Editor's own floor: a side below it is refused in a dialog
  // (m21/m22)
  const w = requireInt(at, o, "w", { min: 2, max: grid.w, source: "editor", measuredIn: "the Editor refuses a side under 2 px" });
  const h = requireInt(at, o, "h", { min: 2, max: grid.h, source: "editor", measuredIn: "the Editor refuses a side under 2 px" });
  if (x + w > grid.w || y + h > grid.h)
    at.add({
      path: "", rule: "off-screen", source: "editor",
      measuredIn: "Error:Page:page0 Fail:<obj> Position Invalid.",
      message: `the box runs off the ${grid.w}x${grid.h} grid`,
      got: `${x},${y} ${w}x${h}`, want: `x+w <= ${grid.w}, y+h <= ${grid.h}`,
    });

  const bindRaw = o.bind === undefined ? {} : requireObject(at.at("bind"), o.bind, "");
  const bind: Placement["bind"] = {};
  for (const [k, v] of Object.entries(bindRaw)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") bind[k] = v;
    else
      at.at("bind").add({
        path: k, rule: "bad-binding", source: "ours",
        message: "a prop is a literal or a $binding, not an object", got: typeof v,
      });
  }
  const variant = o.variant === undefined ? "default" : requireString(at, o, "variant", { pattern: ID_PATTERN });
  const render: Placement["render"] = { dither: "auto" };
  if (o.render !== undefined) {
    const r = requireObject(at.at("render"), o.render, "");
    if (r.dither !== undefined) {
      if (r.dither === "auto" || typeof r.dither === "boolean") render.dither = r.dither;
      else
        at.at("render").add({
          path: "dither", rule: "bad-render", source: "ours",
          message: '`"auto"`, `true` or `false`', got: r.dither,
        });
    }
  }
  const input: Placement["input"] = { live: "auto" };
  if (o.input !== undefined) {
    const inp = requireObject(at.at("input"), o.input, "");
    if (inp.live !== undefined) {
      if (inp.live === "auto" || typeof inp.live === "boolean") input.live = inp.live;
      else
        at.at("input").add({
          path: "live", rule: "bad-input", source: "ours",
          message: '`"auto"`, `true` or `false`', got: inp.live,
        });
    }
  }
  const smallTouch = o.smallTouch === undefined ? null : requireString(at, o, "smallTouch");
  const alternate = o.alternate === undefined ? null : requireString(at, o, "alternate");
  return { component, theme, componentId, variant, x, y, w, h, bind, render, input, smallTouch, alternate };
}

export function parseProject(raw: unknown, where = "project"): Project {
  const issues = new IssueList();
  const doc = requireObject(issues, raw);
  const schemaVersion = requireSchemaVersion(issues, doc, PROJECT_SCHEMA_VERSION);
  const id = requireString(issues, doc, "id", { pattern: ID_PATTERN });
  const name = requireString(issues, doc, "name", { maxLength: 60 });
  const themes = requireArray(issues, doc, "themes", { min: 1 }).map((v, i) => {
    const s = String(v);
    if (!ID_PATTERN.test(s))
      issues.at("themes").add({ path: String(i), rule: "bad-format", message: `not a theme id`, source: "ours", got: s });
    return s;
  });

  const layoutsRaw = requireObject(issues.at("layouts"), doc.layouts, "");
  const declared = Object.keys(layoutsRaw);
  for (const d of declared)
    if (!DEVICES.includes(d as DeviceId))
      issues.at("layouts").add({
        path: d, rule: "unknown-device", source: "hardware",
        measuredIn: "the .HMI header carries a Modelcrc naming the panel",
        message: "no panel with this id", got: d, want: DEVICES.join(", "),
      });
  for (const d of REQUIRED_DEVICES)
    if (!declared.includes(d))
      issues.at("layouts").add({
        path: d, rule: "panel-not-declared", source: "ours",
        message: "every project declares a layout for each panel, even an empty one -- otherwise \"not drawn yet\" and \"not supported\" look the same",
        got: declared.join(", ") || "none", want: REQUIRED_DEVICES.join(", "),
      });

  // required panels first and in their own order, then anything extra, so the
  // tool offers the panels in a stable order rather than in JSON key order
  const order = [...REQUIRED_DEVICES, ...DEVICES.filter((d) => !REQUIRED_DEVICES.includes(d))];
  const layouts: Layout[] = order
    .filter((d) => declared.includes(d))
    .map((device) => {
      const at = issues.at(`layouts/${device}`);
      const lo = requireObject(at, layoutsRaw[device], "");
      const grid = DEVICE_GRID[device] ?? DEVICE_GRID["eu-landscape"];
      // no `min`: an empty layout is the whole point -- it says this panel is
      // declared and not drawn yet, which is different from not existing
      const screens: Screen[] = requireArray(at, lo, "screens").map((entry, index) => {
        const sat = at.at(`screens/${index}`);
        const o = requireObject(sat, entry);
        const place = requireArray(sat, o, "place", { min: 1 }).map((pp, i) => parsePlacement(sat.at(`place/${i}`), pp, grid));
        return {
          id: requireString(sat, o, "id", { pattern: ID_PATTERN }),
          title: requireString(sat, o, "title", { maxLength: 40 }),
          background: o.background === undefined ? undefined : String(o.background),
          tap: o.tap === undefined ? undefined : requireString(sat, o, "tap", { pattern: ID_PATTERN }),
          swipe: parseSwipe(sat, o),
          plan: parsePlan(sat, o),
          role: parseRole(sat, o),
          place,
        };
      });
      uniqueBy(at.at("screens"), screens, (sc) => sc.id, "screen id");
      // a role is found by name, so two screens with one is a page that is either of them; the keyboards are the three of a kind
      const holder = new Map<string, number>();
      screens.forEach((sc, index) => {
        if (sc.role === undefined || sc.role === "keyboard") return;
        const first = holder.get(sc.role);
        if (first === undefined) holder.set(sc.role, index);
        else
          at.at(`screens/${index}`).add({
            path: "role", rule: "role-taken", source: "ours",
            message: `screen "${screens[first].id}" has the role ${sc.role} already: the runtime finds a page by its role`, got: sc.role,
          });
        // a plan is its flag and its role, or neither: the generator reads the one and the runtime the other
        if (sc.role === "plan" && sc.plan !== true)
          at.at(`screens/${index}`).add({ path: "role", rule: "plan-role", source: "ours", message: "the plan's role goes with `plan: true`", got: sc.role });
      });
      screens.forEach((sc, index) => {
        if (sc.plan === true && sc.role !== "plan")
          at.at(`screens/${index}`).add({ path: "role", rule: "plan-role", source: "ours", message: "a plan screen has the role plan", got: sc.role });
      });
      // a tap and a swipe go to a screen of THIS layout, or they go nowhere on
      // the glass -- the same check, because they compile to the same `page`
      screens.forEach((sc, index) => {
        const known = (id: string) => screens.some((other) => other.id === id);
        const list = screens.map((s) => s.id).join(", ");
        if (sc.tap !== undefined && !known(sc.tap))
          at.at(`screens/${index}`).add({
            path: "tap", rule: "unknown-screen", source: "ours",
            message: `no screen "${sc.tap}" in this layout`, got: sc.tap, want: list,
          });
        if (sc.plan) {
          const sat = at.at(`screens/${index}`);
          // the carousel and the tap are the runtime's on a plan: a jump the
          // glass took by itself would leave the plan the Berry is drawing
          if (sc.tap !== undefined)
            sat.add({ path: "tap", rule: "plan-owns-touch", source: "ours", message: "a plan reports its taps; it cannot also jump on one", got: sc.tap });
          for (const dir of ["left", "right"] as const)
            if (sc.swipe?.[dir] !== undefined)
              sat.add({
                path: `swipe/${dir}`, rule: "plan-owns-touch", source: "ours",
                message: "left and right on a plan are the carousel between plans, which the runtime moves", got: sc.swipe[dir],
              });
          sc.place.forEach((p, i) => {
            if (p.y + p.h > PLAN_TOP)
              sat.add({
                path: `place/${i}`, rule: "inside-plan", source: "ours",
                message: `a plan is drawn at run time below y ${PLAN_TOP}; nothing compiled may reach into it`,
                got: p.y + p.h, want: `<= ${PLAN_TOP}`,
              });
          });
        }
        for (const dir of SWIPE_DIRECTIONS) {
          const target = sc.swipe?.[dir];
          if (target !== undefined && !known(target))
            at.at(`screens/${index}`).add({
              path: `swipe/${dir}`, rule: "unknown-screen", source: "ours",
              message: `no screen "${target}" in this layout`, got: target, want: list,
            });
        }
      });
      const editor = lo.editor === undefined ? undefined : requireString(at, lo, "editor", { pattern: ID_PATTERN });
      if (editor !== undefined && !screens.some((sc) => sc.id === editor))
        at.add({
          path: "editor", rule: "unknown-screen", source: "ours",
          message: `no screen "${editor}" in this layout`, got: editor,
          want: screens.map((sc) => sc.id).join(", "),
        });
      return { device, screens, editor };
    });

  const settings = parseSettings(issues.at("settings"), doc.settings);

  return issues.check(where, {
    schemaVersion, id, name, description: optionalString(doc, "description"), themes, layouts, settings,
  });
}

/** A preference key: a JSON-ish identifier, because both runtimes look it up by name. */
const SETTING_KEY = /^[a-z][A-Za-z0-9]*$/;

function parseSettings(at: IssueList, raw: unknown): Project["settings"] {
  if (raw === undefined) return { items: [] };
  const o = requireObject(at, raw, "");
  const items = requireArray(at, o, "items").map((entry, i): SettingsItem => {
    const it = at.at(`items/${i}`);
    const e = requireObject(it, entry);
    // 26 is Help's line budget on the narrowest panel -- a label is
    // also Help's title, and the title role is the bigger cut
    const label = requireString(it, e, "label", { maxLength: 26 });
    const key = requireString(it, e, "key", { pattern: SETTING_KEY });
    // Not `requireStringArray`: a blank line is how a Help body leaves a gap
    // between two thoughts, so "" is content here and not a missing value.
    const help = (e.help === undefined ? [] : requireArray(it, e, "help")).map((line, j) => {
      if (typeof line !== "string")
        it.add({ path: `help/${j}`, rule: "bad-type", source: "ours", message: "a Help line is a string", got: typeof line });
      return String(line);
    });
    if (help.length > HELP_LINE_COUNT)
      it.add({
        path: "help", rule: "too-many-lines", source: "ours",
        message: `Help's template carries ${HELP_LINE_COUNT} lines`, got: help.length, want: `<= ${HELP_LINE_COUNT}`,
      });
    return { label, key, help };
  });
  uniqueBy(at.at("items"), items, (item) => item.key, "setting key");
  return { items };
}

export function tryParseProject(raw: unknown, where = "project"): { ok: true; value: Project } | { ok: false; error: ValidationError } {
  try {
    return { ok: true, value: parseProject(raw, where) };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e };
    throw e;
  }
}

/**
 * Layer 2 of the funnel: the project against the themes it
 * actually uses. Parsing a project alone cannot do this — a placement's design
 * system is only wrong once you know which ones are on the table.
 */
export function checkProjectAgainstThemes(project: Project, available: readonly Theme[]): void {
  const issues = new IssueList();
  const byId = new Map(available.map((d) => [d.id, d]));

  project.themes.forEach((wanted, index) => {
    if (!byId.has(wanted))
      issues.at("themes").add({
        path: String(index), rule: "unknown-theme",
        message: "no theme with this id was loaded", source: "ours", got: wanted,
        want: [...byId.keys()].join(", ") || "none loaded",
      });
  });

  const declared = new Set(project.themes);
  project.layouts.forEach((layout) => {
    layout.screens.forEach((screen, si) => {
    screen.place.forEach((p, pi) => {
      const at = issues.at(`layouts/${layout.device}/screens/${si}/place/${pi}`);
      if (!declared.has(p.theme)) {
        at.add({
          path: "component", rule: "undeclared-theme", source: "ours",
          message: "a placement may only use a theme the project declares",
          got: p.theme, want: [...declared].join(", "),
        });
        return;
      }
      const ds = byId.get(p.theme);
      if (!ds) return; // already reported above
      if (!ds.components.some((c) => c.id === p.componentId))
        at.add({
          path: "component", rule: "unknown-component", source: "ours",
          message: `"${p.theme}" offers no component with this id`,
          got: p.componentId, want: ds.components.map((c) => c.id).sort().join(", "),
        });
    });
    });
  });

  issues.check(`project "${project.id}"`, project);
}

/**
 * Layer 3 of the funnel: what a PLACEMENT has to satisfy, which is everything
 * the theme said about a component and the project's geometry never
 * had to answer for.
 *
 * Placements smaller than the touch minimum their own theme declares, pairs
 * overlapping, and cards binding none of the handlers their contract requires
 * are what these three catch. A rule that is written down and never run is
 * worse than no rule -- it reads as a guarantee.
 */
export function checkPlacements(project: Project, available: readonly Theme[]): void {
  const issues = new IssueList();
  const byId = new Map(available.map((d) => [d.id, d]));
  // Per LAYOUT, because the metrics are the panel's: 6.50 px/mm and a 30-column
  // bezel on the EU unit, a 320x480 grid and no crop on the US one. Checking a
  // US layout against EU numbers would be checking nothing.
  project.layouts.forEach((layout) => {
  const pxPerMm = DEVICE_PX_PER_MM[layout.device] ?? DEVICE_PX_PER_MM["eu-landscape"];

  // The screen `editor` names has to BE an editor. That it exists is layer 1's
  // check; that it carries a keyboard is this one's, because only here is a
  // placement's component id anything more than a string -- and a project that
  // sent the finger to a screen with no keyboard on it would look like it
  // worked right up until someone held a title down.
  if (layout.editor !== undefined) {
    const screen = layout.screens.find((s) => s.id === layout.editor);
    if (screen && !screen.place.some((p) => p.componentId === "keyboard"))
      issues.at(`layouts/${layout.device}`).add({
        path: "editor", rule: "not-an-editor", source: "ours",
        message: `screen "${layout.editor}" places no keyboard, so nothing would be there to type on`,
        got: screen.place.map((p) => p.componentId).join(", ") || "nothing",
        want: "a placement of \"keyboard\"",
      });
  }

  layout.screens.forEach((screen, si) => {
    // the page's own colour has to be a token some theme of this project
    // actually defines, or the page is painted in a colour from nowhere
    if (screen.background !== undefined) {
      const known = project.themes.some((d) => byId.get(d)?.colors.some((c) => c.id === screen.background));
      if (!known)
        issues.at(`layouts/${layout.device}/screens/${si}`).add({
          path: "background", rule: "unknown-colour-token", source: "ours",
          message: "no theme this project declares defines that colour",
          got: screen.background,
          want: [...new Set(project.themes.flatMap((d) => byId.get(d)?.colors.map((c) => c.id) ?? []))].join(", "),
        });
    }
    screen.place.forEach((p, pi) => {
      const at = issues.at(`layouts/${layout.device}/screens/${si}/place/${pi}`);
      const ds = byId.get(p.theme);
      const spec: ComponentSpec | undefined = ds?.components.find((c) => c.id === p.componentId);
      if (!ds || !spec) return; // checkProjectAgainstThemes already said so

      // the glass this panel shows, for the touch minimum and the bezel below
      const vis = DEVICE_VISIBLE[layout.device] ?? DEVICE_VISIBLE["eu-landscape"];

      // The touch minimum, in the pixels this panel actually has. A box flush
      // with a VISIBLE edge counts the bezel past it, up to half a fingertip
      // (EDGE_CREDIT_MM): the part of a finger that lands on the bezel presses
      // nothing else, so the finger's target is the box and that strip: the
      // reason for the rail in the corner.
      // A placement that says why it may be smaller (`smallTouch`, schema 13) is let through, and no other.
      const min = spec.minTouchMm;
      if (min && p.smallTouch === null) {
        const credit = Math.round(EDGE_CREDIT_MM * pxPerMm);
        const onEdgeX = p.x <= vis.x || p.x + p.w >= vis.x + vis.w;
        const onEdgeY = p.y <= vis.y || p.y + p.h >= vis.y + vis.h;
        const needW = Math.round(min.w * pxPerMm) - (onEdgeX ? credit : 0);
        const needH = Math.round(min.h * pxPerMm) - (onEdgeY ? credit : 0);
        if (p.w < needW || p.h < needH)
          at.add({
            path: "", rule: "below-touch-minimum", source: "ours",
            measuredIn: `${min.w}x${min.h} mm at ${pxPerMm.toFixed(2)} px/mm${onEdgeX || onEdgeY ? `, less ${EDGE_CREDIT_MM} mm of bezel on an edge` : ""}`,
            message: `the box is smaller than the touch target "${spec.id}" requires`,
            got: `${p.w}x${p.h} px`, want: `${needW}x${needH} px`,
          });
      }

      // and inside the glass, not merely inside the grid
      if (p.x < vis.x || p.y < vis.y || p.x + p.w > vis.x + vis.w || p.y + p.h > vis.y + vis.h)
        at.add({
          path: "", rule: "behind-the-bezel", source: "hardware",
          measuredIn: "the EU housing covers the 30 rightmost columns (devices.ts)",
          message: "part of this box is under the housing: it compiles, costs RAM, and can be neither seen nor touched",
          got: `${p.x},${p.y} ${p.w}x${p.h}`,
          want: `inside ${vis.w}x${vis.h}`,
        });

      // a style this theme does not draw. It would compile into whatever the
      // registry happened to have -- or nothing -- and the first sign of it
      // would be a blank rectangle on the glass.
      if (!spec.variants.includes(p.variant))
        at.add({
          path: "variant", rule: "unknown-variant", source: "ours",
          message: `"${ds.id}" does not draw "${spec.id}" in that style`,
          got: p.variant, want: spec.variants.join(", "),
        });

      // every prop the component says a placement must bind
      for (const req of spec.requires)
        if (!(req in p.bind))
          at.at("bind").add({
            path: req, rule: "missing-binding", source: "ours",
            message: `"${spec.id}" cannot work without this prop, and nothing downstream would notice`,
            want: spec.requires.join(", "),
          });
    });

    // two components in the same place: on the glass the one underneath is
    // unreachable, and the Editor compiles it happily. Unless they take turns
    // there (`alternate`, schema 14): different alternates, both hideable
    const shown = (p: Placement) => typeof p.bind.visible === "string" && p.bind.visible.startsWith("$");
    const turns = (a: Placement, b: Placement) => a.alternate !== null && b.alternate !== null && a.alternate !== b.alternate && shown(a) && shown(b);
    for (let i = 0; i < screen.place.length; i++)
      for (let j = i + 1; j < screen.place.length; j++) {
        const a = screen.place[i], b = screen.place[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h && !turns(a, b))
          issues.at(`layouts/${layout.device}/screens/${si}/place/${j}`).add({
            path: "", rule: "overlaps", source: "ours",
            message: "two placements cover the same pixels; on the panel the lower one cannot be touched",
            got: `${b.component} at ${b.x},${b.y} ${b.w}x${b.h}`,
            want: `clear of ${a.component} at ${a.x},${a.y} ${a.w}x${a.h}`,
          });
      }
  });
  });

  issues.check(`project "${project.id}"`, project);
}

/** The components a project may use, and which theme each comes from. */
export function projectComponents(project: Project, available: readonly Theme[]): { id: string; from: string }[] {
  const byId = new Map(available.map((d) => [d.id, d]));
  const out: { id: string; from: string }[] = [];
  for (const dsId of project.themes) {
    const ds = byId.get(dsId);
    if (!ds) continue;
    for (const c of ds.components) out.push({ id: c.id, from: ds.id });
  }
  return out;
}

/** Every theme a project's placements actually use, in order of first use. */
export function themesUsed(project: Project): string[] {
  const seen: string[] = [];
  for (const l of project.layouts)
    for (const s of l.screens) for (const p of s.place) if (!seen.includes(p.theme)) seen.push(p.theme);
  return seen;
}

/** A screen's `role`: one of SCREEN_ROLES or absent, and nothing else. */
function parseRole(at: IssueList, o: Record<string, unknown>): ScreenRole | undefined {
  if (o.role === undefined) return undefined;
  if (typeof o.role !== "string" || !(SCREEN_ROLES as readonly string[]).includes(o.role)) {
    at.add({ path: "role", rule: "unknown-role", source: "ours", message: "no role with this name", got: o.role, want: SCREEN_ROLES.join(", ") });
    return undefined;
  }
  return o.role as ScreenRole;
}

/** A screen's `plan` flag: true, false or absent, and nothing else. */
function parsePlan(at: IssueList, o: Record<string, unknown>): boolean | undefined {
  if (o.plan === undefined) return undefined;
  if (typeof o.plan !== "boolean") {
    at.add({ path: "plan", rule: "not-boolean", source: "ours", message: "plan is true or false", got: o.plan });
    return undefined;
  }
  return o.plan;
}

/**
 * A screen's `swipe` block, or undefined when it declares none.
 *
 * Refuses a direction nobody has heard of rather than ignoring it: `"swipeLeft"`
 * or `"west"` in a document would otherwise be a gesture that silently does
 * nothing, discovered on the glass.
 */
function parseSwipe(at: IssueList, o: Record<string, unknown>): Screen["swipe"] {
  if (o.swipe === undefined) return undefined;
  const raw = requireObject(at.at("swipe"), o.swipe, "");
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!(SWIPE_DIRECTIONS as readonly string[]).includes(key)) {
      at.add({
        path: "swipe", rule: "bad-direction", source: "ours",
        message: "a swipe has four directions and no others",
        got: key, want: SWIPE_DIRECTIONS.join(", "),
      });
      continue;
    }
    out[key] = String(value);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
