// The palette the panel screens draw in, as a value rather than an import.
//
// Until now every component imported `theme` directly, which meant the palette
// was a constant of the code: one panel, one look, and a theme that
// declared colours could only ever LIST them. With more than one theme
// on disk, choosing one has to repaint the panel, or the choice is
// decoration.
//
// So the colours come through React context, with `theme` as the default. That
// keeps every existing caller working -- a screen rendered outside a provider is
// exactly what it was -- and lets the simulator hand each project the palette of
// the theme that project declares.
//
// The SHAPE stays here and not in `core/`: these are the slots the renderers
// actually paint with, and `ui/` is what knows them. A theme's document
// maps ITS token ids onto these, and that mapping is the theme's
// problem, not this file's.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { BASE_PALETTE } from "./basePalette";

/** Every colour slot a panel screen can paint with. */
export type PanelPalette = {
  background: string;
  cardBackground: string;
  cardBorder: string;
  textPrimary: string;
  textSecondary: string;
  divider: string;
  accentBlue: string;
  /** cancel, and anything else that undoes rather than does */
  accentRed: string;
  iconOff: string;
  iconLowSat: string;
  /** the plan's cards, and a face on them: a key, and the thermostat's buttons */
  planCard: string;
};

/**
 * The palette of the panel as it runs today: real RGB565 values where they
 * exist, screenshot approximations where they do not (see basePalette.ts).
 */
export const DEFAULT_PALETTE: PanelPalette = BASE_PALETTE;

const PaletteContext = createContext<PanelPalette>(DEFAULT_PALETTE);

/**
 * Provides a palette to everything rendered inside. Partial on purpose: a
 * theme that names only some of the slots gets the default for the
 * rest, which is better than a screen rendering with holes in it -- and the
 * simulator reports what was missing rather than hiding it.
 */
export function PanelPaletteProvider({ palette, children }: { palette?: Partial<PanelPalette>; children: ReactNode }) {
  const value = useMemo(() => ({ ...DEFAULT_PALETTE, ...palette }), [palette]);
  return <PaletteContext.Provider value={value}>{children}</PaletteContext.Provider>;
}

/** The palette in force. Outside any provider, the panel's own. */
export function usePanelPalette(): PanelPalette {
  return useContext(PaletteContext);
}

/**
 * The colour token ids a theme has to provide, and the slot each one
 * fills. Kebab-case on the left because that is how a theme's document
 * writes an id (theme.json), camelCase on the right because that is how
 * a renderer reads it.
 *
 * This list is the contract between the two, and it lives here because `ui/` is
 * what actually paints with these. A theme missing one of them cannot
 * be drawn faithfully -- the renderer falls back to the panel's own colour, and
 * whoever chose the theme deserves to be told, not quietly given a
 * colour from somewhere else.
 */
export const PANEL_PALETTE_SLOTS: Record<string, keyof PanelPalette> = {
  background: "background",
  "card-background": "cardBackground",
  "card-border": "cardBorder",
  "text-primary": "textPrimary",
  "text-secondary": "textSecondary",
  divider: "divider",
  "accent-blue": "accentBlue",
  "accent-red": "accentRed",
  "icon-off": "iconOff",
  "icon-low-sat": "iconLowSat",
  "plan-card": "planCard",
};

export interface PanelPaletteFromTokens {
  palette: Partial<PanelPalette>;
  /** slots the theme did not name: these fall back to the panel's own */
  missing: string[];
  /** tokens the theme named that no renderer paints with */
  unused: string[];
}

/**
 * Builds a palette from a theme's colour tokens, and says what did not
 * line up in both directions. Takes `{ id, hex }` rather than the document's own
 * shape so `ui/` stays free of `core/`: converting RGB565 to hex is the caller's
 * job, and it already has `rgb565ToHex`.
 */
export function panelPaletteFromTokens(tokens: readonly { id: string; hex: string }[]): PanelPaletteFromTokens {
  const palette: Partial<PanelPalette> = {};
  const seen = new Set<string>();
  const unused: string[] = [];
  for (const t of tokens) {
    const slot = PANEL_PALETTE_SLOTS[t.id];
    if (slot === undefined) { unused.push(t.id); continue; }
    palette[slot] = t.hex;
    seen.add(t.id);
  }
  return { palette, missing: Object.keys(PANEL_PALETTE_SLOTS).filter((id) => !seen.has(id)), unused };
}
