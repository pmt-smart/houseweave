// Measurable facts about a loaded `.zi`, for the Real columns to state.
//
// Exists because of a fair question: "the Real column looks too polished -- is it
// real?" It is, and the reason it looks that way is a property of the font, not
// of the rendering: a `.zi` stores THREE BITS of coverage per pixel, so a glyph
// arrives with eight levels of alpha and genuinely smooth edges. Drawing it
// black-and-white to look more "hardware" would be the lie.
//
// Measured off the glyphs rather than assumed, because the codec has both modes
// (`export/scripts/build-own-font.mjs` builds one glyph of each on purpose): a
// font of hard-edged drawings really would come back with two levels.
import { rasterizeZiGlyph, type ZiFont } from "@nspanel-sim/export";

/**
 * How many distinct coverage levels this font's glyphs actually use, 1..8.
 *
 * Stops at the first glyph that reaches eight, and looks at no more than a few
 * dozen in any case: the answer is a property of how the font was cut, so the
 * first handful of glyphs settle it and decoding all 191 to prove it again
 * would cost a visible pause for nothing.
 */
export function ziAlphaLevels(font: ZiFont): number {
  const seen = new Set<number>();
  for (const g of font.glyphs.slice(0, 40)) {
    const r = rasterizeZiGlyph(font, g.code);
    for (const a of r.alpha) {
      seen.add(a);
      if (seen.size === 8) return 8;
    }
  }
  return Math.max(1, seen.size);
}
