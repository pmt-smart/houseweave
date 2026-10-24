// What a font ROLE resolves to, on the web side.
//
// A layout asks for `"title"` and never for a size, because that is the only
// request a Nextion can honour: a Text names a font id and draws its glyphs at
// that font's own height. So the size is not the component's choice and not the
// renderer's -- it is whatever `.zi` the theme assigned to the role, and this is
// where that answer arrives in `ui/`.
//
// Which is also how the React column stops lying about the type. The three
// `Label` implementations asked for 18/14, 15/13 and 22/15 CSS pixels, and none
// of those five numbers is a font this panel has: the sizes on the glass are
// 24, 32, 48 and 80. The React column was drawing a type scale that could not be
// built. Now it draws the one that can.
import { createContext, useContext, type ReactNode } from "react";
import type { FontRole } from "@nspanel-sim/layout";
import type { ZiFont } from "@nspanel-sim/export";

export interface PanelFont {
  /**
   * The `.zi` cell height in panel pixels -- the height a text node's box is
   * sized for, and the CSS `font-size` of the fallback below.
   */
  height: number;
  /** what the `.zi` was cut at, READ from the file by the build (theme schema 4) */
  weight: number;
  /**
   * The `.zi` itself, once loaded. With it, text in the panel tree is drawn
   * from its glyphs (`ZiTextInBox`), which is what the glass shows. Without it
   * -- before it arrives, or outside the simulator -- text falls back to the
   * browser's font at `height`, which is 25-28 % WIDER than the glass
   * (measured: a `.zi` spends its height on the whole line, CSS on
   * the letter), so the fallback is a placeholder and never a measurement.
   */
  zi?: ZiFont;
}

export type PanelFontSet = Partial<Record<FontRole, PanelFont>>;

/** The base theme's cuts: the panel as it runs today. */
const DEFAULT_FONTS: PanelFontSet = {
  body: { height: 24, weight: 400 },
  title: { height: 32, weight: 400 },
  display: { height: 80, weight: 700 },
  icon: { height: 32, weight: 400 },
  "icon-large": { height: 48, weight: 400 },
};

const FontsContext = createContext<PanelFontSet>(DEFAULT_FONTS);

export function PanelFontsProvider({ fonts, children }: { fonts?: PanelFontSet; children: ReactNode }) {
  return <FontsContext.Provider value={fonts ?? DEFAULT_FONTS}>{children}</FontsContext.Provider>;
}

export function usePanelFonts(): PanelFontSet {
  return useContext(FontsContext);
}

/**
 * The cut a role resolves to. Falls back to the base theme's rather than to
 * nothing: a theme that has not been loaded yet should render as the panel does,
 * not as 16px of browser default.
 */
export function usePanelFont(role: FontRole): PanelFont {
  const fonts = usePanelFonts();
  return fonts[role] ?? DEFAULT_FONTS[role] ?? { height: 24, weight: 400 };
}
