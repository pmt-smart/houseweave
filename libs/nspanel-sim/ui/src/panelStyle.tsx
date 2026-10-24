// How a theme DRAWS, as opposed to what it draws in.
//
// The palette (palette.tsx) is only half of it. With colours alone, two themes
// differ by a background and nothing else, and the point of a theme is to give
// the components a different LOOK, not a different tint. Radius, borders,
// weight, density and the icon set as constants inside the renderers would let
// no document vary them.
//
// So they come through context too, with the panel's own values as the default.
// The renderers keep their STRUCTURE -- a light is an icon over a name, in every
// theme -- and the theme decides how that structure presents
// itself: shadcn puts a border around it and keeps the type light, Tailwind
// fills a rounded surface and makes it heavy, the joBr99 one draws no card at
// all because the reference screenshots do not.
//
// What a theme cannot change here is geometry: a screen with
// `layout: "donor"` sits in the boxes joBr99's compiled pages give it,
// and those are fixed. Radius and border live inside a box; the box
// itself is the donor's.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { densitySpacing, type PanelStyle } from "@nspanel-sim/layout";

// The SHAPE now lives in `@nspanel-sim/layout`, because a layout function
// reads it and a layout function may not import React. Re-exported here so every
// caller that already knew where to find it still does.
export type { PanelStyle } from "@nspanel-sim/layout";

/**
 * The panel as it draws today: Material through Home Assistant's ha-dark, which
 * is what every screenshot in `docs/img/` shows.
 */
export const DEFAULT_STYLE: PanelStyle = {
  radius: 4,
  borderWidth: 1,
  cardStyle: "plain",
  density: "comfortable",
  displayWeight: 700,
  titleWeight: 400,
  iconScale: 0.75,
  // the base theme's cuts; a theme that loads replaces all five
  fontHeight: { body: 24, title: 32, display: 80, icon: 32, "icon-large": 48 },
  // Home Assistant's ha-dark, which is where this palette comes from
  fontFamily: '"Roboto", system-ui, sans-serif',
};

const StyleContext = createContext<PanelStyle>(DEFAULT_STYLE);

export function PanelStyleProvider({ style, children }: { style?: Partial<PanelStyle>; children: ReactNode }) {
  const value = useMemo(() => ({ ...DEFAULT_STYLE, ...style }), [style]);
  return <StyleContext.Provider value={value}>{children}</StyleContext.Provider>;
}

export function usePanelStyle(): PanelStyle {
  return useContext(StyleContext);
}

/**
 * Spacing in panel pixels at the current density. The numbers live in
 * `densitySpacing` so a layout function, which has no hooks, gets the same ones.
 */
export function useDensitySpacing(): { gap: number; pad: number } {
  return densitySpacing(usePanelStyle());
}

/**
 * The CSS a card gets under the current style. `plain` really means nothing at
 * all -- not a transparent border, which would still take a pixel and shift
 * everything inside a donor box by one.
 */
export function useCardDecoration(palette: { cardBackground: string; cardBorder: string }): {
  background?: string;
  border?: string;
  borderRadius?: number;
  padding?: number;
} {
  const style = usePanelStyle();
  const { pad } = useDensitySpacing();
  if (style.cardStyle === "plain") return {};
  if (style.cardStyle === "outlined")
    return {
      border: `${style.borderWidth}px solid ${palette.cardBorder}`,
      borderRadius: style.radius,
      padding: pad,
    };
  return { background: palette.cardBackground, borderRadius: style.radius, padding: pad };
}
