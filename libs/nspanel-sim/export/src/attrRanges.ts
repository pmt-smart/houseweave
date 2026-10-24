// The attribute values the Nextion Editor refuses, so that the writer refuses
// them first.
//
// Every entry here is a measured wall: a scenario with the value inside the
// range compiled, and one outside it was refused with
//
//     Error:page0.s0.disOut of range
//
// Two things this table deliberately does NOT do. It does not guess a wall
// nobody bisected — where the campaign only knows "this value passed", the
// entry carries `maxMeasured` and the check lets anything below it through
// while refusing only what was actually seen to fail. And it does not dress our
// own caution up as the Editor's: the Slider entries are marked `ours`, because
// the Editor validates nothing on a Slider at all (m20).

/**
 * Our own rules — the ones marked `ours`, which the Editor does not make — can
 * be turned off on their own. `LENIENT` turns off everything, including the
 * measured refusals, and is for the campaign's probes; this is for a caller who
 * deliberately wants, say, an inverted Slider.
 */
export const OUR_RULES = { on: true };

export interface AttrRange {
  /** Smallest value measured to compile. Below it the Editor refuses. */
  min?: number;
  /** Largest value measured to compile, with the next one measured to fail. */
  max?: number;
  /**
   * Largest value known to compile when the wall above it was never found.
   * Values above this are allowed: we do not know they are wrong.
   */
  maxMeasured?: number;
  /** A value measured to be refused even though it sits inside the range. */
  refused?: number[];
  /** The scenario family that measured it. */
  source: string;
  /** True when this is our rule, not a refusal the Editor was seen to make. */
  ours?: boolean;
}

/** Keyed by component type, then by attribute name. */
export const ATTR_RANGES: Record<string, Record<string, AttrRange>> = {
  CheckBox: { val: { min: 0, max: 1, source: "m30-checkbox-val-1 ok, m20-checkbox-val2 refused" } },
  Radio: { val: { min: 0, max: 1, source: "m30-radio-val-1 ok, m38-radio-val-2 refused" } },
  Curve: {
    ch: { min: 1, max: 4, source: "m30-curve-ch-1 and m30-curve-ch-4 ok, m20-curve-ch0 and m20-curve-ch5 refused" },
    // 0 to 9 all refuse, the 4 included; 1000 compiles and 65535 refuses, so the upper wall is somewhere
    // in between and nobody has bisected it.
    // 1000 is the largest measured to compile and 1024 the smallest measured to
    // refuse, so the wall is somewhere in 1001..1023. Refusing from 1024 up is
    // exactly what was measured; 1001..1023 is let through because nobody has
    // shown it fails.
    dis: { min: 10, max: 1023, source: "m30-curve-dis-1000 ok, m57-curve-dis-1024 refused (and 4096, 16384, 32767, 32768, 65534, plus m47-curve-dis-65535)" },
  },
  GText: {
    dis: { min: 2, source: "m30-gtext-dis-2 ok, m30-gtext-dis-1 refused" },
    tim: { min: 80, source: "m34-gtext-tim-80 ok, m35-gtext-tim-79 refused" },
  },
  Number: {
    format: { min: 0, max: 2, source: "m30-number-format-2 ok, m20-number-format3 refused" },
    lenth: { min: 0, max: 15, source: "m34-number-lenth-15 / m38-number-lenth-0 ok, m32-number-lenth-16 refused" },
  },
  Prog: {
    val: { min: 0, max: 100, source: "m30-prog-val-100 ok, m20-prog-val101 refused" },
    dez: { min: 0, max: 1, source: "m54-prog-dez-1 ok, m54-prog-dez-2 refused" },
  },
  Timer: { tim: { min: 50, max: 65534, source: "m30-timer-tim-50 and m30-timer-tim-65534 ok, m30-timer-tim-49 and m20-timer-tim65535 refused" } },
  Zhizhen: {
    val: { min: 0, max: 360, source: "m30-zhizhen-val-360 ok, m30-zhizhen-val-361 refused" },
    wid: { min: 1, max: 20, source: "m34-zhizhen-wid-20 ok, m35-zhizhen-wid-21 refused" },
  },
  XFloat: {
    vvs0: { min: 0, max: 10, source: "m20-xfloat-vvs0-10 ok, m30-xfloat-vvs0-11 refused" },
    vvs1: { min: 0, max: 8, source: "m32-xfloat-vvs1-8 ok, m30-xfloat-vvs1-9 refused" },
  },
  Qrcode: {
    // The wall is 192, not 154: capacity 192 is representable (it fails only for
    // memory) and 193 answers `txt_maxlOut of range` (m59-qr-cap-192 / -193).
    // 192 is the byte-mode capacity of QR version 8, which is also where the
    // memory reservation steps — see qrcodeReserve in ramBudget.ts. The old
    // 154 was a budget threshold read as a range wall, and it refused capacities
    // the Editor compiles.
    txt_maxl: { max: 192, source: "m59-qr-cap-192 representable, m59-qr-cap-193 refused as Out of range" },
  },
  // The Editor accepts anything on a Slider — maxval below minval, val outside
  // both, wid 0 (m20). These are ours, so that a design that cannot work is
  // caught before the panel shows it.
  Slider: {
    wid: { min: 1, source: "ours: the Editor compiles m20-slider-wid0", ours: true },
    // the Editor DOES validate this one, unlike the rest of the Slider
    mode: { min: 0, max: 1, source: "m54-slider-mode-1 ok, m54-slider-mode-2 refused" },
  },
};

/**
 * `sta` picks the background kind, and both sides are now measured (m53):
 *
 * - `0` (crop an image out of the page background) compiles on every type tried
 *   and costs the same RAM as the default;
 * - `2` (its own image) is refused on the **Prog**, the **Qrcode** and the
 *   **Vari**, accepted on the rest;
 * - `3` is refused on all five types tried (Text, Button, Number, Vari,
 *   Zhizhen), so 2 is the ceiling for those. Applying it to the other types is
 *   an extrapolation from five — smaller than the old one-point guess, and still
 *   an extrapolation.
 *
 * CheckBox, Radio and Picture have no `sta` at all, so the question does not
 * arise for them.
 */
/**
 * `key` binds a component to an on-screen keyboard page. Two values are
 * measured to compile: `0xFF`, the "none" sentinel every template that has the
 * attribute carries, and `0` (m60-key-zero). A real page id is refused, whether
 * the page exists or not — pointing at page 1 of a two-page project gives the
 * same words as pointing at a page that is not there (m54-text-key-1,
 * m60-key-valid). So the target has to BE a keyboard page, and nothing in this
 * writer can build one.
 */
const KEY_NONE = 0xff;
const KEY_ALSO_OK = 0;

const STA_MAX = 2;
const STA_REFUSED_BY_TYPE: Record<string, number[]> = { Prog: [2], Qrcode: [2], Vari: [2] };

import { HMI_TEMPLATES } from "./hmiTemplates.generated.js";
import { KNOWN_LEI } from "./component.js";

/** Does the type's template carry this attribute at all? */
function typeHasAttribute(type: string, name: string): boolean {
  const lei = (KNOWN_LEI as Record<string, number>)[type];
  const tpl = lei === undefined ? undefined : (HMI_TEMPLATES as Record<string, { attributes: { name: string }[] }>)[String(lei)];
  return tpl ? tpl.attributes.some((a) => a.name === name) : true;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

/**
 * Throws on the first attribute value the Editor is known to refuse. `label` is
 * used in the message, so pass the objname — the Editor's own wording is
 * `page0.s0.disOut of range`.
 */
export function checkAttributeRanges(type: string, values: Record<string, unknown>, label = type): void {
  const table = ATTR_RANGES[type] ?? {};
  for (const [attr, rule] of Object.entries(table)) {
    const v = asNumber(values[attr]);
    if (v === undefined) continue;
    if (rule.ours && !OUR_RULES.on) continue;
    const who = rule.ours ? "our rule" : "the Editor refuses it";
    if (rule.min !== undefined && v < rule.min) throw new RangeError(`${label}.${attr} = ${v} is out of range (min ${rule.min}; ${who}, measured in ${rule.source})`);
    if (rule.max !== undefined && v > rule.max) throw new RangeError(`${label}.${attr} = ${v} is out of range (max ${rule.max}; ${who}, measured in ${rule.source})`);
    if (rule.refused?.includes(v)) throw new RangeError(`${label}.${attr} = ${v} is refused (measured in ${rule.source})`);
  }
  const sta = asNumber(values.sta);
  if (sta !== undefined && typeHasAttribute(type, "sta")) {
    if (sta < 0 || sta > STA_MAX) throw new RangeError(`${label}.sta = ${sta} is out of range (0 to ${STA_MAX}; measured in m53-*-sta0 ok, m53-*-sta3 refused)`);
    if (STA_REFUSED_BY_TYPE[type]?.includes(sta)) throw new RangeError(`${label}.sta = ${sta} is out of range on a ${type} (measured in m26-sta2-*, m53-vari-sta2)`);
  }
  const key = asNumber(values.key);
  if (key !== undefined && key !== KEY_NONE && key !== KEY_ALSO_OK) {
    throw new RangeError(`${label}.key = ${key}: Lost on-screen keyboard page — the target has to be a keyboard page, and this writer cannot build one (m54-text-key-1, m60-key-valid)`);
  }
  checkSliderConsistency(type, values, label);
}

/**
 * The Editor lets a Slider through with any combination, so nothing here is a
 * measured refusal — it is the writer refusing a control that cannot work.
 */
function checkSliderConsistency(type: string, values: Record<string, unknown>, label: string): void {
  if (type !== "Slider" || !OUR_RULES.on) return;
  const minval = asNumber(values.minval), maxval = asNumber(values.maxval), val = asNumber(values.val);
  if (minval !== undefined && maxval !== undefined && maxval < minval) throw new RangeError(`${label}: maxval ${maxval} is below minval ${minval} (our rule; the Editor accepts it)`);
  if (val !== undefined && minval !== undefined && val < minval) throw new RangeError(`${label}: val ${val} is below minval ${minval} (our rule; the Editor accepts it)`);
  if (val !== undefined && maxval !== undefined && val > maxval) throw new RangeError(`${label}: val ${val} is above maxval ${maxval} (our rule; the Editor accepts it)`);
}
