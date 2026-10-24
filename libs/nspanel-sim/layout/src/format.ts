// Turning a reading into the characters the glass shows.
//
// Here and not in `ui/` because the panel does no arithmetic and no units: by
// the time a value reaches a Nextion attribute it is already a string, so
// whoever fills the binding decides what it says (`components.ts`,
// `WeatherCell`). That "whoever" is the React renderer today and `brain.be`
// once a sensor exists, which is exactly the shape that grows a second
// implementation -- so the rule lives in the one package both renderers read.
//
// The Berry side cannot import this. When a reading reaches `brain.be`, it
// mirrors `roundTempC` by hand and the tests on both sides carry the same
// table; there is no way around that across two languages, and a rule written
// down in one place is the closest thing to a guarantee available.

/**
 * What a cell shows when there is no reading at all.
 *
 * Two hyphens and not an em dash: no theme font carries U+2014. They are
 * 191-glyph subsets built from a declared charset
 * (`scripts/build-theme-fonts.mjs`), so a string this code PRODUCES must be
 * inside it, or every empty slot on the screensaver addresses a glyph that does
 * not exist -- which nobody can see fail in the browser: the desktop has the
 * character, and the panel does not.
 */
export const NO_READING = "--";

/**
 * A temperature to a whole degree, with the tenth deciding on MAGNITUDE.
 *
 * `.0` through `.5` keep the degree, `.6` and up go to the next one: 18.5 is
 * 18, 18.6 is 19. Deliberately not `Math.round`, which turns 18.5 into 19.
 *
 * Away from zero on the negative side, symmetrically: -18.5 is -18 and -18.6 is
 * -19, so the number shown never depends on which side of zero it fell. The
 * alternative (rounding -18.5 down to -19) makes the rule read differently
 * above and below freezing, which is the half of the scale where it matters.
 *
 * A single degree either way is under the accuracy of any sensor that will feed
 * this, so the choice is about legibility, not truth: one character less on a
 * 58-pixel cell.
 */
export function roundTempC(celsius: number): number {
  const sign = celsius < 0 ? -1 : 1;
  // the epsilon is for 18.6 arriving as 18.599999999999998, which floors to 18
  const whole = sign * Math.floor(Math.abs(celsius) + 0.4 + 1e-9);
  return whole === 0 ? 0 : whole; // never "-0"
}

/**
 * What a weather cell shows: a whole degree and the unit, or `NO_READING`.
 *
 * Measured against the real `.zi`, in pixels of pen advance: the
 * four small cells (`body`, 24 px) hold every form down to `-100°C` (55 px) in
 * both panels. The big first cell is the tight one.
 */
export function formatTempC(celsius: number | null): string {
  return celsius === null ? NO_READING : `${roundTempC(celsius)}°C`;
}
