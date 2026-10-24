// The generated runtime's two tables, the other way round, for the mirror
// (mirror.ts) to read the glass back with. Apart from it because it reads the
// themes' icon fonts, which only the bundler loads (fonts.ts), and the mirror
// runs in node too: the panel's tests read the glass through it.
import type { Theme } from "@nspanel-sim/core";
import { iconRolesOf } from "./fonts";
import type { ReadBack } from "./mirror";

/**
 * The tables the generated runtime renders with, inverted. Both come from the
 * project's first theme, as the generator's do (build-project-hmi.mjs:
 * `self.colors` and `self.glyphs`). Two tokens of the same colour read back as
 * the first: they draw the same.
 */
export function readBackOf(primary: Theme | undefined): ReadBack {
  const roles = new Map<string, string>();
  const tokens = new Map<number, string>();
  if (!primary) return { roles, tokens };
  for (const [role, entry] of Object.entries(iconRolesOf(primary))) {
    const glyph = String.fromCodePoint(entry.code);
    if (!roles.has(glyph)) roles.set(glyph, role);
  }
  for (const c of primary.colors) if (!tokens.has(c.rgb565)) tokens.set(c.rgb565, c.id);
  return { roles, tokens };
}
