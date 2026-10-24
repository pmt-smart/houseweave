// What the .tft holds, read from the scenario the generator compiles it from
// (export/hmi-scenarios/p1-*.json, build-project-hmi.mjs): the pages, their
// components with every attribute as compiled, and each one's event code.
//
// A component is its type's template (the Editor's own record, HMI_TEMPLATES)
// with the scenario's attributes over it -- exactly what hmiWrite.ts's
// buildComponent() writes into the .HMI, so the emulator starts from the
// values the glass starts from.
import { hmiTemplate } from "@nspanel-sim/export";

export type AttrValue = number | string;

export interface ComponentDef {
  /** its id on the page: the page is 0, components count from 1 in the order declared */
  id: number;
  type: string;
  objname: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** a component with a box the finger can land on (Timer, Vari and Touchcap have none) */
  geometric: boolean;
  attrs: Record<string, AttrValue>;
  events: Record<string, readonly string[]>;
  /** vscope 1: it keeps its values across pages, and other pages reach it as page.obj */
  global: boolean;
}

export interface PageDef {
  id: number;
  name: string;
  attrs: Record<string, AttrValue>;
  components: ComponentDef[];
  events: Record<string, readonly string[]>;
}

export interface HmiDef {
  pages: PageDef[];
  /** the fonts, by id: the files the scenario names, relative to its own folder */
  fonts: string[];
  /** the pictures, by id: the generated specs (layout/src/paint.ts) */
  pictures: Record<string, unknown>[];
}

interface ScenarioComponent {
  type: string;
  objname: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  attributes?: Record<string, AttrValue>;
  events?: { event: string; lines: string[] }[];
}

interface Scenario {
  addFonts?: { file: string }[];
  addPictures?: Record<string, unknown>[];
  addPages: { name: string; attributes?: Record<string, AttrValue>; add: ScenarioComponent[]; events?: { event: string; lines: string[] }[] }[];
  edits?: Record<string, {
    changes?: Record<string, { attributes?: Record<string, AttrValue>; events?: { event: string; lines: string[] }[] }>;
    add?: ScenarioComponent[];
  }>;
}

/** a text attribute's compiled bytes, one char per byte: the page's encoding is UTF-8 */
export function byteString(text: string): string {
  return Array.from(new TextEncoder().encode(text), (b) => String.fromCharCode(b)).join("");
}

export function textOf(bytes: string): string {
  return new TextDecoder().decode(Uint8Array.from(bytes, (c) => c.charCodeAt(0) & 0xff));
}

const TEXT_ATTRIBUTES = new Set(["txt", "objname"]);

/** the template's values, decoded: numbers little-endian, text as bytes */
function defaults(type: string): Record<string, AttrValue> {
  const t = hmiTemplate(type);
  const out: Record<string, AttrValue> = {};
  for (const a of t.attributes) {
    const bytes = (a.defaultHex.match(/../g) ?? []).map((h) => parseInt(h, 16));
    out[a.name] = TEXT_ATTRIBUTES.has(a.name)
      ? String.fromCharCode(...bytes)
      : bytes.reduceRight((acc, b) => acc * 256 + b, 0);
  }
  return out;
}

function component(spec: ScenarioComponent, id: number): ComponentDef {
  const attrs = defaults(spec.type);
  const geometric = "x" in attrs;
  for (const [k, v] of Object.entries(spec.attributes ?? {})) attrs[k] = typeof v === "string" ? byteString(v) : v;
  if (geometric) Object.assign(attrs, { x: spec.x ?? attrs.x, y: spec.y ?? attrs.y, w: spec.w ?? attrs.w, h: spec.h ?? attrs.h });
  attrs.id = id;
  attrs.objname = spec.objname;
  return {
    id,
    type: spec.type,
    objname: spec.objname,
    x: Number(attrs.x ?? 0),
    y: Number(attrs.y ?? 0),
    w: Number(attrs.w ?? 0),
    h: Number(attrs.h ?? 0),
    geometric,
    attrs,
    events: Object.fromEntries((spec.events ?? []).map((e) => [e.event, e.lines])),
    global: Number(attrs.vscope ?? 0) === 1,
  };
}

/** The scenario's pages, as compiled over the base project's single page. */
export function readScenario(json: unknown): HmiDef {
  const s = json as Scenario;
  const edit0 = s.edits?.["0.pa"];
  const page0Attrs = { ...defaults("Page"), ...(edit0?.changes?.page0?.attributes ?? {}) };
  const pages: PageDef[] = [
    {
      id: 0,
      name: String(page0Attrs.objname ?? "page0"),
      attrs: page0Attrs,
      components: (edit0?.add ?? []).map((c, i) => component(c, i + 1)),
      // its own events, as the base page is edited: its load says the screen stamp
      events: Object.fromEntries((edit0?.changes?.page0?.events ?? []).map((e) => [e.event, e.lines])),
    },
  ];
  s.addPages.forEach((p, i) => {
    pages.push({
      id: i + 1,
      name: p.name,
      attrs: { ...defaults("Page"), ...(p.attributes ?? {}), objname: p.name },
      components: p.add.map((c, k) => component(c, k + 1)),
      events: Object.fromEntries((p.events ?? []).map((e) => [e.event, e.lines])),
    });
  });
  return { pages, fonts: (s.addFonts ?? []).map((f) => f.file), pictures: s.addPictures ?? [] };
}
