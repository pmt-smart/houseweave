// raw <-> display-pct conversions — the same maths as berry/light.be
// (set_brightness, set_color_temp, send_detail), not
// a reinvention. Keeps the UI and the "backend" (mock or real) speaking
// the same value for the same slider.

export interface BriRange {
  briMinPct: number; // light.be BRI_MIN_PCT
  briMaxPct: number; // light.be BRI_MAX_PCT
}

// light.be:send_detail — raw_bri_pct = bri*100/254, then remapped from
// the [briMinPct, briMaxPct] range to [0,100] for display.
export function briRawToDisplayPct(bri254: number, range: BriRange): number {
  const rawPct = (bri254 * 100) / 254;
  const displayPct = ((rawPct - range.briMinPct) * 100) / (range.briMaxPct - range.briMinPct);
  return Math.max(0, Math.min(100, displayPct));
}

// light.be:set_brightness — display pct [0,100] -> pct clamped inside
// [briMinPct, briMaxPct] -> level 0-254.
export function briDisplayPctToRaw(displayPct: number, range: BriRange): number {
  const clampedPct = range.briMinPct + ((range.briMaxPct - range.briMinPct) * displayPct) / 100;
  return Math.round((clampedPct * 254) / 100);
}

export interface CtRange {
  ctMin: number; // light.be CT_MIN (mireds)
  ctMax: number; // light.be CT_MAX (mireds)
}

// light.be:send_detail — ct_pct = (ct - ctMin) * 100 / (ctMax - ctMin)
export function ctRawToDisplayPct(ctMireds: number, range: CtRange): number {
  const pct = ((ctMireds - range.ctMin) * 100) / (range.ctMax - range.ctMin);
  return Math.max(0, Math.min(100, pct));
}

// light.be:set_color_temp — pct [0,100] -> mireds within [ctMin,ctMax]
export function ctDisplayPctToRaw(pct: number, range: CtRange): number {
  return Math.round(range.ctMin + ((range.ctMax - range.ctMin) * pct) / 100);
}
