// MUI theme — the same palette as theme.ts (real RGB565 colours where
// they exist, screenshot approximations where they don't — see there for
// the origin of each), only feeding the MUI components instead of our
// own inline styles. Roboto (see sim/index.html) is the font Home
// Assistant uses by default in the "ha-dark" theme the panel inherits
// (bg_color_565 in theme.ts comes from there) — not a guess, it matches
// the real screenshots.
//
// Why MUI: rather than nudging pixels
// to copy the reference look by hand, use components from a real library
// (Material Design, the same visual language as HA) to land close by
// construction. Not the only library considered — others come in later,
// screen by screen.
import { createTheme, type Theme } from "@mui/material/styles";
import { DEFAULT_PALETTE, type PanelPalette } from "./palette";
import { DEFAULT_STYLE, type PanelStyle } from "./panelStyle";

/**
 * The MUI theme for a given panel palette. A factory rather than a constant
 * because the palette is now a choice (palette.tsx): a theme that
 * repaints the panel has to repaint the MUI components too, or half the screen
 * changes and half does not.
 */
export function makePanelMuiTheme(palette: PanelPalette, style: PanelStyle = DEFAULT_STYLE): Theme {
  return createTheme({
    palette: {
      mode: "dark",
      background: {
        default: palette.background,
        paper: palette.cardBackground,
      },
      primary: {
        main: palette.accentBlue,
      },
      text: {
        primary: palette.textPrimary,
        secondary: palette.textSecondary,
      },
      divider: palette.divider,
    },
    typography: {
      // the theme's own stack, so MUI's components agree with ours
      fontFamily: style.fontFamily,
    },
    shape: {
      borderRadius: 4,
    },
  });
}

/** The panel as it runs today -- what a screen rendered outside a provider gets. */
export const muiTheme = makePanelMuiTheme(DEFAULT_PALETTE);
