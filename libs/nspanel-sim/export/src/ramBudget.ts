// The panel's RAM budget for a page, and what each component costs in it
//.
//
// The compiler prints the whole model on every build:
//
//     Available Memory:3584
//     Global Memory:16
//     Page:page0 Memory Occupied:16+48=64
//
// and refuses the page when `globals + page > 3584`, inclusive: a total of
// exactly 3584 compiles and 3588 does not (m43-cut-3584 / m43-cut-3588).
//
// The page image is
//
//     page = 20 + sum of the component costs + 4 * floor(n / 4)
//
// with `n` the number of components drawn on the page. The trailing term is
// per page, not per type: it reproduces the heterogeneous pages of the campaign
// (m25-thirty-mixed 732, m27-comps-250 1268, m43-page-mixed-9 200) as well as
// the pages of Texts it was first measured on.
//
// Everything here is measured, one component per empty page, and then checked
// against every single-page report the campaign produced.

import { HMI_TEMPLATES } from "./hmiTemplates.generated.js";
import { KNOWN_LEI } from "./component.js";

/** What the compiler prints as `Available Memory` on this panel. */
export const PANEL_RAM = 3584;

/** What an empty page costs before any component. */
export const EMPTY_PAGE_RAM = 20;

/** Round up to the next multiple of 4. */
function align4(v: number): number {
  return (v + 3) & ~3;
}

/**
 * Flat per-type cost, in bytes of the page's RAM image. Measured with one
 * component of the type on an empty page (`cost = page - 20`). Types whose
 * cost depends on an attribute or on the geometry are NOT in this table; they
 * are handled in `componentRamCost`.
 */
/**
 * A Vari declared as a string (`sta = 1`) is not the 4-byte Vari: it carries a
 * buffer sized by its capacity, plus one byte for the terminator and a 4-byte
 * header.
 *
 *     cost = align4(txt_maxl + 1) + 4
 *
 * Exact on six capacities — 10, 15, 20, 40, 100 and 250 (m51-vari-sta1,
 * m60-vari-str-*, m61-page-varistr-15) — and a global one costs exactly the
 * same, measured at four more (m61-global-varistr-*).
 *
 * An earlier reading of the same data said `align4(6 + txt_maxl)`. It fits five
 * of the six and misses capacity 15 by four bytes, which is precisely the error
 * that made the model refuse the joBr99 project by 4 bytes. Compiling that
 * project with the instrument is what caught it: every one of its 23 pages
 * matched, and only the globals were off.
 */
function variStringRam(txtMaxl: number): number {
  return align4(txtMaxl + 1) + 4;
}

const FLAT_RAM: Record<string, number> = {
  Hotspot: 0,
  Touchcap: 4,
  Timer: 4,
  Vari: 4,
  Picture: 4,
  Radio: 8,
  Prog: 8,
  PictureCrop: 8,
  CheckBox: 12,
  Number: 24,
  XFloat: 24,
  Zhizhen: 24,
  Slider: 28,
};

export interface RamComponent {
  type: string;
  /** Only the attributes that move the cost are read: txt_maxl, ch, vscope. */
  attributes?: Record<string, unknown>;
  /** Only the Curve reads this: it is the one type whose cost follows the width. */
  w?: number;
}

/**
 * The value the cost depends on: what the caller set, else the type template's
 * own default. Reading the default from the template matters — a Qrcode with
 * no `txt_maxl` given is 30, not 15, and costs 48 instead of 32.
 */
function attrNumber(c: RamComponent, name: string): number {
  const v = c.attributes?.[name];
  if (typeof v === "number") return v;
  return templateDefault(c.type, name);
}

function templateDefault(type: string, name: string): number {
  const lei = (KNOWN_LEI as Record<string, number>)[type];
  const tpl = lei === undefined ? undefined : (HMI_TEMPLATES as Record<string, { attributes: { name: string; defaultHex: string }[] }>)[String(lei)];
  const a = tpl?.attributes.find((x) => x.name === name);
  if (!a) throw new RangeError(`type "${type}" has no attribute "${name}" to size its RAM with`);
  let v = 0;
  for (let i = a.defaultHex.length - 2; i >= 0; i -= 2) v = v * 256 + parseInt(a.defaultHex.slice(i, i + 2), 16);
  return v;
}

/**
 * The bytes one component takes in its page's RAM image.
 *
 * Four types are not a constant:
 *
 * - **Text** grows with its declared capacity: `align4(10 + txt_maxl)`, exact
 *   on the seven points from `txt_maxl` 255 to 3542.
 * - **Button**, **ButtonT** and **GText** grow with the capacity too, on the
 *   same `align4(10 + txt_maxl)` body as the Text plus a per-type constant: 4
 *   for the buttons, 28 for the scroller (m51, six capacities each from 4 to
 *   250). A flat 24 or 48 is those formulas at the template's own default and
 *   nowhere else — a Button captioned at capacity
 *   250 costs 264 bytes, not 24.
 * - **Vari** does NOT — as long as it is an int: 4 bytes at every capacity up to
 *   1935, the largest the joBr99 project ships (m51-vari-maxl-*). Declared as a
 *   **string** (`sta = 1`) it does pay, `align4(txt_maxl + 1) + 4`, and that is
 *   the kind joBr99 uses 226 times.
 * - **Qrcode** is `20 + 4*floor(txt_maxl / 4)`, exact on thirteen points from
 *   10 to 154. The flat 48 the old table gave is the value at one
 *   unnamed capacity.
 * - **Curve** is the only type that depends on its **geometry**: the
 *   same curve costs 56 bytes at 2x2 and 676 at 480x320. Every other type
 *   measures the same at both.
 */
export function componentRamCost(c: RamComponent): number {
  if (c.type === "Vari" && attrNumber(c, "sta") === 1) return variStringRam(attrNumber(c, "txt_maxl"));
  const flat = FLAT_RAM[c.type];
  if (flat !== undefined) return flat;
  switch (c.type) {
    case "Text":
      return align4(10 + attrNumber(c, "txt_maxl"));
    case "GText":
      return align4(10 + attrNumber(c, "txt_maxl")) + 28;
    case "Button":
    case "ButtonT":
      return align4(10 + attrNumber(c, "txt_maxl")) + 4;
    case "Qrcode":
      return 20 + 4 * Math.floor(attrNumber(c, "txt_maxl") / 4);
    case "Curve":
      return curveRamCost(attrNumber(c, "ch"), c.w ?? templateDefault("Curve", "w"));
    default:
      throw new RangeError(`RAM cost of type "${c.type}" is not measured`);
  }
}

/**
 * The Curve is the only type whose RAM depends on its geometry, and only on its
 * **width**: m48 measures seven heights from 2 to 320 at one width and they are
 * all the same. It keeps one buffer per channel:
 *
 *     cost = 36 + ch * (align4(floor(13 * w / 10)) + 16)
 *
 * The 13/10 is measured, not derived: whatever the panel keeps per column, it
 * is thirteen bytes for every ten pixels of width, rounded down and then up to
 * a multiple of four. Fitted on widths 2 to 480 and on one to four channels.
 */
export function curveRamCost(ch: number, w: number): number {
  return 36 + ch * curveChannelBytes(w);
}

function curveChannelBytes(w: number): number {
  return align4(Math.floor((13 * w) / 10)) + CURVE_CHANNEL_OVERHEAD;
}

const CURVE_CHANNEL_OVERHEAD = 16;

/**
 * The RAM image of a page holding these components. A component with
 * `vscope = 1` is global: its data lives in the globals area, so it adds nothing
 * to the page, but it still counts as a component for the per-four term.
 */
export function pageRamCost(components: RamComponent[]): number {
  const sum = components.reduce((a, c) => a + (isGlobal(c) ? GLOBAL_STUB_RAM : componentRamCost(c)), 0);
  return EMPTY_PAGE_RAM + sum + 4 * Math.floor(components.length / 4);
}

function isGlobal(c: RamComponent): boolean {
  return attrNumber(c, "vscope") === 1;
}

/**
 * What a global component leaves behind in the page that declares it: nothing.
 * Its data moves to the globals area — but it still counts as a component for
 * the per-four term, which is how m19-global-text40 lands on 76 and not 72
 * (m19-global-*, m36-global-text-24).
 */
const GLOBAL_STUB_RAM = 0;

/**
 * The globals area: 4 bytes of its own plus 4 per `int` declared in
 * `Program.s`, plus the full cost of every component declared global
 * (m46-dir-*, m46-global-token).
 */
export function globalsRamCost(programInts: number, globalComponents: RamComponent[] = []): number {
  return 4 + 4 * programInts + globalComponents.reduce((a, c) => a + componentRamCost(c), 0);
}

/** How many `int` a `Program.s` declares, counting comma-separated names. */
export function countProgramInts(program: string): number {
  let n = 0;
  for (const raw of program.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    const m = /^int\s+(.+)$/.exec(line);
    if (!m) continue;
    n += m[1].split(",").filter((s) => s.trim().length > 0).length;
  }
  return n;
}

/**
 * A Qrcode makes the compiler hold a scratch buffer aside while it renders, and
 * the page has to fit in what is left. The size steps with the **QR version**,
 * not with the capacity: it is constant inside a version and jumps between them.
 *
 * Derived from the refusals, where the compiler prints how much it was short:
 * `needed = 3584 - total + deficit`.
 *
 * | capacity | version | reserve |
 * |---|---|---|
 * | 154 | 7 | 2823 |
 * | 155, 192 | 8 | 3382 |
 *
 * The 135 boundary is not a measurement: it is where QR version 7 starts, since
 * version 6 tops out at 134 bytes in byte mode. Version 6 (107 to 134) was never
 * pushed far enough to make it fail, so its reserve is only bounded: at most
 * 2712, from m59-qr-134-fill24 compiling at a page of 868 plus 4 of globals.
 * The QR's page carries one of 134, and the
 * bound is what the budget holds it to: a page that fits under it is a page
 * measured to compile, and one that does not may still compile but is refused
 * here, which is the safe side. Below version 6 no page of ours has a QR, and
 * this returns `null`: the budget leaves the term out rather than guess.
 */
export function qrcodeReserve(txtMaxl: number): number | null {
  if (txtMaxl >= 155) return 3382;   // version 8, measured at 155 and 192
  if (txtMaxl >= 135) return 2823;   // version 7, measured at 154
  if (txtMaxl >= 107) return 2712;   // version 6: a bound, measured to compile at 134
  return null;                        // version 5 and under: never forced to fail
}

export interface RamVerdict {
  globals: number;
  page: number;
  total: number;
  /** Scratch the compiler holds back for a Qrcode on this page, 0 when there is none. */
  reserve: number;
  fits: boolean;
  /** The compiler's own wording, for a message that matches what it would say. */
  summary: string;
}

/** What the compiler would print and decide for one page. */
export function pageRamVerdict(components: RamComponent[], globals: number): RamVerdict {
  const page = pageRamCost(components);
  const total = globals + page;
  // the largest Qrcode on the page decides the scratch the compiler holds back
  let reserve = 0;
  for (const c of components) {
    if (c.type !== "Qrcode") continue;
    const r = qrcodeReserve(attrNumber(c, "txt_maxl"));
    if (r !== null && r > reserve) reserve = r;
  }
  return {
    globals,
    page,
    total,
    reserve,
    fits: total + reserve <= PANEL_RAM,
    summary: `${globals}+${page}=${total}`,
  };
}

/**
 * Throws when the page would not fit, with the arithmetic the compiler prints.
 * The Editor's own refusal is
 * `Error:Page:page0 Error! Memory overflow:16+3584=3600`.
 */
export function checkPageRam(pageName: string, components: RamComponent[], globals: number): RamVerdict {
  const v = pageRamVerdict(components, globals);
  if (!v.fits) {
    if (v.reserve > 0 && v.total <= PANEL_RAM) {
      throw new RangeError(
        `page ${pageName}: the remaining memory is not enough to run the temporary use of QR code ` +
          `(-${v.total + v.reserve - PANEL_RAM}); ${v.summary} plus ${v.reserve} bytes of QR scratch is over ${PANEL_RAM}`,
      );
    }
    throw new RangeError(
      `page ${pageName}: memory overflow ${v.summary}, over the panel's ${PANEL_RAM} bytes ` +
        `(globals ${v.globals} + page ${v.page}); drop components or shrink a txt_maxl`,
    );
  }
  return v;
}
