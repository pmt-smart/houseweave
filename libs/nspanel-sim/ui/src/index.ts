// Shared UI definition — the NSPanel screens as React components, with
// the same data contract berry/brain.be, berry/home.be and
// berry/light.be already use.

export * from "./devices";
export * from "./basePalette";
export * from "./palette";
export * from "./panelStyle";
export * from "./panelIcons";
export * from "./panelFonts";
export * from "./PanelNodes";
export * from "./contracts";
export * from "./registry";
export * from "./PlacedScreen";
export * from "./deviceContext";
export * from "./useDevicePixelRatio";

// The .zi types the simulator needs in order to hold a loaded font.
export type { ZiFont, ZiGlyph } from "@nspanel-sim/export";
export * from "./types";
export * from "./lightMath";
export * from "./rgb565";
export * from "./devicePreviewMath";
export * from "./components/registry";

// The compiled render: panel text drawn from the theme's own .zi, with
// the geometry measured on the Editor's debugger.
export * from "./compiled/ziText";

// The MUI theme is exported so the simulator chrome can mount previews
// of panel components OUTSIDE <Screen> (Theme tab) — inside
// <Screen> it already comes bundled.
export { muiTheme, makePanelMuiTheme } from "./muiTheme";

export { Screen } from "./components/Screen";
export { Label } from "./layouts/Label";
export { Clock } from "./layouts/Clock";
export { WeatherRow } from "./layouts/WeatherRow";
export { StatusIconView } from "./layouts/StatusIconView";
export { NavHeader } from "./layouts/NavHeader";
export { LightCard } from "./layouts/LightCard";
export { ToggleSwitch } from "./layouts/ToggleSwitch";
export { GradientSlider } from "./layouts/GradientSlider";
export { LightbulbIcon } from "./components/icons/LightbulbIcon";


