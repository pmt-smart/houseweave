// Glyphs no font carries, drawn from ones it does.
//
// A theme names one as "<mdi-name>:<effect>" -- the plan's "no power" is
// "lightbulb-outline:dashed" -- and scripts/build-theme-fonts.mjs draws it from
// the plain glyph. It needs a codepoint of its own, and the joBr99 icon table
// fills the whole private-use area and runs on to U+FAEF, so derived glyphs
// take the codes right after it, in the order of this list. Append only: a
// code that moved would point a saved icon at a different drawing.

export const DERIVED_GLYPHS = [
  "lightbulb-outline:dashed",
  "power-plug-outline:dashed",
  "toggle-switch-off-outline:dashed",
  // the other kinds' "no power" and "no answer":
  // their contour broken into dashes, and, since no kind but the lamp has an
  // icon with a question mark, the mark drawn on each
  "fan:dashed-outline",
  "window-shutter:dashed-silhouette",
  "power-plug-outline:question",
  "toggle-switch-off-outline:question",
  "fan:question",
  "window-shutter:question",
  "power-plug-outline:dashed-outline",
  "toggle-switch-off-outline:dashed-outline",
  // the thermostat's: the heating coil, with the mark and with the contour dashed
  "heating-coil:question",
  "heating-coil:dashed-silhouette",
  // the blind's: the roller shade down, with the mark and with the contour dashed
  "roller-shade-closed:question",
  "roller-shade-closed:dashed-silhouette",
  // a window's and a gate's, the blinds a switch of two channels opens and closes: closed, with the mark and
  // with the contour dashed; the garage door's slats closed first, as the shade's
  "window-closed-variant:question",
  "window-closed-variant:dashed-outline",
  "garage:question",
  "garage:dashed-silhouette",
] as const;

/** the first code after the last one the joBr99 table uses */
export const DERIVED_GLYPH_BASE = 0xfaf0;

/**
 * dashed: the ink cut into dashes around its centre; dashed-outline: the edge of
 * its silhouette broken into dashes, for any drawing; dashed-silhouette: the
 * same of the silhouette closed first, for bars open at the sides; question:
 * the drawing smaller, with QUESTION_MARK at its lower right
 */
export const DERIVED_EFFECTS = ["dashed", "dashed-outline", "dashed-silhouette", "question"] as const;

/** the Material Design Icon a "question" glyph takes its mark from; cut to draw, and not carried */
export const QUESTION_MARK = "help";

export interface DerivedGlyph {
  /** the Material Design Icons name it is drawn from */
  base: string;
  effect: (typeof DERIVED_EFFECTS)[number];
  code: number;
}

/** What a derived name stands for; null for a plain icon name. Throws for one nobody listed. */
export function derivedGlyph(name: string): DerivedGlyph | null {
  const i = name.indexOf(":");
  if (i < 0) return null;
  const k = (DERIVED_GLYPHS as readonly string[]).indexOf(name);
  if (k < 0) throw new Error(`"${name}" is a derived glyph nobody listed; add it to DERIVED_GLYPHS`);
  const effect = name.slice(i + 1) as DerivedGlyph["effect"];
  if (!(DERIVED_EFFECTS as readonly string[]).includes(effect)) throw new Error(`"${name}": no effect called "${effect}"`);
  return { base: name.slice(0, i), effect, code: DERIVED_GLYPH_BASE + k };
}
