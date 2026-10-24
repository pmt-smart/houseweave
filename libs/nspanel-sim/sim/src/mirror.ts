// The React screens, fed from what the glass shows.
//
// Nothing on this page keeps a copy of the panel's state: it lives on the
// ESP32 (the panel's Berry) and on the glass (what the Berry wrote there). The
// React screens are the project's placements (@nspanel-sim/ui PlacedScreen),
// and every value they are bound to is read back off the glass.
//
// The generator's manifest (export/hmi-scenarios/*.runtime.json) says, for
// every path the runtime writes, which component and attribute it lands on and
// how the value was rendered there (`set` and `render` of the generated .be).
// Undoing that rendering gives the value back: a glyph is the icon role whose
// glyph it is, a colour the theme token of that RGB565, a switch whether its
// colour is the "on" one, a paged list's scrollbar its page and its count.
//
// What is not a component -- the plan's cards, and the colour picker drawn
// where they go -- the Berry draws straight onto the glass, and the React
// screen shows those pixels (ReactPanelView).
//
// It imports nothing of its own folder but types: the panel's tests load it in
// node, where the bundler's imports do not resolve. The tables it reads with
// come from readBack.ts.
import { textOf, type Glass, type HmiDef } from "@nspanel-sim/glass";

/** one write of the runtime: `path` lands on `page.objname.attribute`, rendered as `kind` says */
export interface Binding {
  page: string;
  objname: string;
  attribute: string;
  path: string;
  kind?: "glyph" | "switch" | "flip" | "pages" | "vis" | "paged" | "present";
  on?: number;
  off?: number;
  /** `switch`: the colour of the value 2, a row that destroys */
  alt?: number;
  max?: number;
}

/** the part of a generated project's manifest the React screens read */
export interface RuntimeManifest {
  project: string;
  device: string;
  theme: string;
  bindings: Binding[];
}

/** the generated runtime's two tables, the other way round */
export interface ReadBack {
  /** a glyph -> the icon role it draws */
  roles: Map<string, string>;
  /** an RGB565 -> the colour token that is it */
  tokens: Map<number, string>;
}

type Attrs = Record<string, string | number>;

function valueOf(b: Binding, attrs: Attrs, vis: boolean, back: ReadBack): unknown {
  const v = attrs[b.attribute];
  switch (b.kind) {
    // no glyph is no role: "", which a header's action takes as "none here"
    case "glyph": {
      const glyph = textOf(String(v ?? ""));
      return glyph === "" ? "" : back.roles.get(glyph);
    }
    case "switch":
      return b.alt !== undefined && Number(v) === b.alt ? 2 : Number(v) === b.on;
    case "vis":
      return vis;
    // the scrollbar of a paged list: its last page, and shown only with a second
    case "pages":
      return vis ? Number(attrs.maxval) + 1 : 1;
    // written as the last page less the page, so the top of the bar is the first
    case "flip":
      return Number(attrs.maxval) - Number(v);
  }
  if (b.attribute === "txt") return textOf(String(v ?? ""));
  if (b.attribute === "pco" || b.attribute === "bco") return back.tokens.get(Number(v));
  return Number(v);
}

/** "$zone.rows.0.label" -> tree.zone.rows[0].label; the first binding of a path wins */
function put(tree: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.slice(1).split(".");
  let node: Record<string, unknown> = tree;
  for (let i = 0; i < keys.length - 1; i++) {
    const next = node[keys[i]];
    if (next === undefined || typeof next !== "object" || next === null) {
      const made = /^\d+$/.test(keys[i + 1]) ? [] : {};
      node[keys[i]] = made;
      node = made as Record<string, unknown>;
    } else node = next as Record<string, unknown>;
  }
  const last = keys[keys.length - 1];
  if (!(last in node)) node[last] = value;
}

function lookup(tree: Record<string, unknown>, keys: readonly string[]): unknown {
  let node: unknown = tree;
  for (const k of keys) {
    if (node === undefined || node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[k];
  }
  return node;
}

/** What the glass shows now of every value the runtime wrote. */
export interface Mirror {
  /** the compiled page on show */
  page: string;
  tree: Record<string, unknown>;
  /** the same, as text: a new one is a change */
  key: string;
}

/** the global components of the compiled pages: there on every page, as `page.objname` */
export function globalsOf(hmi: HmiDef): Set<string> {
  const out = new Set<string>();
  for (const p of hmi.pages) for (const c of p.components) if (c.global) out.add(`${p.name}.${c.objname}`);
  return out;
}

/**
 * Reads the glass: every binding whose component is there to read, on the page
 * on show or global. A local component of another page is gone -- the glass
 * rebuilt its page when it loaded -- so its value is not the page's to show.
 */
export function readGlass(glass: Glass, manifest: RuntimeManifest, back: ReadBack, globals: Set<string>): Mirror {
  const page = glass.page.name;
  const live = new Map(glass.components().map((c) => [c.def.objname, c]));
  const tree: Record<string, unknown> = {};
  for (const b of manifest.bindings) {
    // whether a part is shown, never what the value is: the value is read off
    // the part that draws it (the scrollbar, the action's glyph)
    if (b.kind === "paged" || b.kind === "present") continue;
    if (b.page === page) {
      const c = live.get(b.objname);
      if (c) put(tree, b.path, valueOf(b, c.attrs as Attrs, c.vis, back));
    } else if (globals.has(`${b.page}.${b.objname}`)) {
      try {
        put(tree, b.path, valueOf(b, { [b.attribute]: glass.read(`${b.page}.${b.objname}.${b.attribute}`) as string | number }, true, back));
      } catch {
        // not readable after all: the value is missing, as a missing binding is
      }
    }
  }
  // The keyboard's CAPS: the glass keeps it next to the line (kbCaps, a
  // global of the page the generator puts kbIn on), and no runtime path names
  // it, because only the glass types.
  const kb = [...globals].find((g) => g.endsWith(".kbCaps"));
  if (kb) {
    try {
      put(tree, "$keyboard.caps", Number(glass.read(`${kb}.val`)) === 1);
    } catch {
      // no CAPS to read: the keyboard shows its small letters
    }
  }
  return { page, tree, key: `${page}|${JSON.stringify(tree)}` };
}

const noop = () => {};

/** a prop that is a handler: `onChange`, `onClose` -- and not a value named `on` */
const HANDLER = /^on[A-Z]/;

/**
 * A screen's `$path` -> its value, as the glass shows it.
 *
 * `$screen.title` is the one path the generator resolves itself: a screen's
 * own title compiles as its words, or as `$screen.<id>.title` when the user
 * may rename it (build-project-hmi.mjs).
 *
 * A handler (`onAction`, `onClose`: `on` and a capital) does nothing here,
 * because a touch on the React screen is a touch on the glass, whose compiled
 * code is what answers it. But it is there: a component draws what its
 * handlers make it -- a header shows its action only with an `onAction` -- as
 * the compile step lays it out from the same props. A list row's `on` is no
 * handler but its colour, read off the glass like any value: taken for one,
 * every row's label would draw lit.
 */
export function resolverOf(
  mirror: Mirror,
  screen: { id: string; title: string; place: readonly { bind: Record<string, string | number | boolean> }[] },
): (ref: string) => unknown {
  const handlers = new Set<string>();
  for (const p of screen.place)
    for (const [prop, v] of Object.entries(p.bind)) if (HANDLER.test(prop) && typeof v === "string" && v.startsWith("$")) handlers.add(v);
  return (ref) => {
    if (ref === "$screen.title") return lookup(mirror.tree, ["screen", screen.id, "title"]) ?? screen.title;
    // The keyboard draws the glass's line and CAPS only when it is told it
    // does not own them, which is what a handler says to it; and it switches
    // layout through one (PlacedScreen).
    if (handlers.has(ref) || ref === "$keyboard.change" || ref === "$keyboard.capsChange" || ref === "$keyboard.goto") return noop;
    const value = lookup(mirror.tree, ref.slice(1).split("."));
    // the one list the React side takes whole: the glass shows each slot's
    // temperature as the text formatTempC made of it
    if (ref === "$weather" && Array.isArray(value)) {
      return value.map((w: { label?: string; temp?: string }) => {
        const c = Number.parseFloat(w?.temp ?? "");
        return { label: w?.label ?? "", tempC: Number.isFinite(c) ? c : null };
      });
    }
    return value;
  };
}

/**
 * The page a screen compiles to: its id, letters and digits only, in 14 bytes
 * (`nameOf` in build-project-hmi.mjs) -- "light-detail" is `lightdetail`.
 */
export function pageNameOf(screenId: string): string {
  return screenId.replace(/[^A-Za-z0-9]/g, "").slice(0, 14);
}
