import { useMemo, type CSSProperties, type ReactNode } from "react";
import { ThemeProvider } from "@mui/material/styles";
import { DEVICES, type DeviceId } from "../devices";
import { usePanelPalette } from "../palette";
import { usePanelStyle } from "../panelStyle";
import { makePanelMuiTheme } from "../muiTheme";

export interface ScreenProps {
  device: DeviceId;
  children: ReactNode;
  /**
   * The page's own colour, when the screen names one. A Nextion page carries its
   * own `bco`, and a theme can legitimately have more than one
   * background -- joBr99's cards are ha-dark and his screensaver is black.
   */
  background?: string;
  /**
   * A tap anywhere on the screen (project schema 7, `screen.tap`). On the glass
   * it is a TouchCap, which hears every touch on the page; here it is a click on
   * the frame, which the components' own clicks bubble up to -- "anywhere" on
   * both sides.
   */
  onTap?: () => void;
}

// The device frame — exact size in px, unscaled, so any target
// measurement actually holds inside it.
//
// Uses visibleWidthPx, NOT widthPx: the usable area (what shows through
// the physical bezel) is the real design canvas, not widthPx with a crop
// applied after rendering. Cropping after drawing solves nothing —
// anything centred or positioned against the full logical grid ends up
// offset relative to what is actually visible (compared against the physical
// EU unit). Locking the
// canvas to the visible size makes it physically impossible to place a
// component in the hidden strip, instead of merely hiding it afterwards.
// widthPx (the complete Nextion grid) still lives in devices.ts — it is
// what places this content on the panel's real grid, taking
// hiddenPixelsSide into account.
//
// The MUI ThemeProvider sits at this root so every screen using <Screen>
// gets MUI components with our palette, without having to remember to
// wrap each place that calls renderScreen().
export function Screen({ device, children, background, onTap }: ScreenProps) {
  const palette = usePanelPalette();
  // one theme per palette, not per render: MUI's createTheme is not cheap and
  // every screen mounts through here
  const style = usePanelStyle();
  const mui = useMemo(() => makePanelMuiTheme(palette, style), [palette, style]);
  const preset = DEVICES[device];
  const frame: CSSProperties = {
    width: preset.visibleWidthPx,
    height: preset.heightPx,
    background: background ?? palette.background,
    color: palette.textPrimary,
    fontFamily: style.fontFamily,
    position: "relative",
    overflow: "hidden",
    boxSizing: "border-box",
    userSelect: "none",
  };
  return (
    <ThemeProvider theme={mui}>
      <div style={{ ...frame, cursor: onTap ? "pointer" : undefined }} onClick={onTap}>{children}</div>
    </ThemeProvider>
  );
}
