// The subset of MUI approved for emulating the Lovelace/HA-Dashboard
// look the panel inherits — not "any MUI component", but a specific
// configuration (variant, weight, orientation) validated against the
// real reference screenshots (docs/img/screensaver.png, card-grid.png,
// popupLight.gif). A dimension SEPARATE from registry.ts:
// that one tracks HARDWARE validation, this one tracks DESIGN fidelity
// against the visual reference, library by library — MUI is the first,
// others enter here the same way when we decide to use them.
//
// Why separate: "we use MUI Typography" says nothing on its own. MUI's
// default Typography (Roboto, weight 400, plain Material sizes) has
// been tried and does NOT match Lovelace without adjustment (see
// Clock.tsx/WeatherRow.tsx — the time needs weight 700+ and a size well
// beyond any stock MUI h1-h6 variant). What matters to record is the
// approved CONFIGURATION, not just the component's name.

// Font — Roboto (see sim/index.html for the Google Fonts load), with
// weight assigned by semantic ROLE, not "pick whatever". Each role has
// the weight and size that matched the real screenshot, not an
// arbitrary value.
export const LOVELACE_FONT = {
  family: '"Roboto", "system-ui", sans-serif',
  weights: {
    display: 700, // clock time, main temperature — docs/img/screensaver.png
    body: 400, // date, entity name, running text
    caption: 400, // small labels (weekday, "Brightness"/"Colour temp.")
  },
} as const;

// Icons — @mui/icons-material, mapped by semantic ROLE. Never a bare
// Unicode character (◄/►/✕ and the like) as an icon: the visual weight
// is wrong, already tried in NavHeader (thin arrows against the
// original's solid ones).
export const LOVELACE_ICON_MAPPING: Record<string, string> = {
  navPrev: "ArrowBackIosNew",
  navNext: "ArrowForwardIos",
  lightOn: "Lightbulb", // filled — light.be:ICON_LIGHTBULB is a solid glyph, not an outline
  lightOff: "Lightbulb", // same icon, the colour changes (theme.iconOff) — not the glyph
  colorMode: "Palette", // seen in popupLight.gif, colour mode
  brightness: "Brightness6", // icon left of the brightness bar, in place of a text label
  colorTemp: "DeviceThermostat", // icon left of the colour-temperature bar
};

export type UiLibrary = "mui" | "custom";

export interface LovelaceComponentMapping {
  /** Our component (the name matches registry.ts, where it exists there) */
  ourComponent: string;
  library: UiLibrary;
  /** The library component used underneath */
  libraryComponent: string;
  /** The specific approved configuration — not the "raw" component */
  approvedConfig: string;
  /** Where that approval was checked against the real reference */
  verifiedAgainst: string;
}

export const LOVELACE_MUI_MAPPING: LovelaceComponentMapping[] = [
  {
    ourComponent: "Clock",
    library: "mui",
    libraryComponent: "Typography",
    approvedConfig: "Custom sx (fontSize 72, fontWeight 700) for the time — no stock MUI h1-h6 variant matches; body1 for the date",
    verifiedAgainst: "docs/img/screensaver.png",
  },
  {
    ourComponent: "WeatherRow",
    library: "mui",
    libraryComponent: "Typography",
    approvedConfig: "fontWeight 700, accent colour — variant=caption for the weekday label",
    verifiedAgainst: "docs/img/screensaver.png",
  },
  {
    ourComponent: "LightCard",
    library: "mui",
    libraryComponent: "IconButton + Typography",
    approvedConfig:
      'IconButton sx={{width:size, height:size, padding:0}} around the icon (tap = toggle) — the size comes from mmToPx(15,...), not from MUI default padding; Typography variant="caption" for the name, same pattern as WeatherRow',
    verifiedAgainst: "docs/img/card-grid.png",
  },
  {
    ourComponent: "NavHeader",
    library: "mui",
    libraryComponent: "IconButton + @mui/icons-material",
    approvedConfig: "ArrowBackIosNew/ArrowForwardIos (solid icon) — NOT the Unicode characters ◄/► (wrong visual weight, already tested)",
    verifiedAgainst: "docs/img/card-grid.png",
  },
  {
    ourComponent: "ToggleSwitch",
    library: "mui",
    libraryComponent: "Switch",
    approvedConfig: "default, primary colour (accentBlue from the theme)",
    verifiedAgainst: "docs/img/popupLight.gif",
  },
  {
    ourComponent: "GradientSlider",
    library: "mui",
    libraryComponent: "Slider",
    approvedConfig:
      "horizontal (default), sx putting the whole-dimension gradient on .MuiSlider-rail (black->colour / cool->warm / full hue) instead of a single-colour fill — replaces VerticalSlider (vertical) and ColorWheel (removed), user request 2026-09-04",
    verifiedAgainst: "docs/img/popupLight.gif (adapted — the gif shows vertical/wheel, not horizontal with a gradient)",
  },
  {
    ourComponent: "Clock (divider)",
    library: "mui",
    libraryComponent: "Divider",
    approvedConfig: 'borderColor="text.primary", reduced opacity — the MUI default is too thin and the wrong colour',
    verifiedAgainst: "docs/img/screensaver.png",
  },
  {
    ourComponent: "SliderRow (chip \"AUTO\")",
    library: "mui",
    libraryComponent: "Chip",
    approvedConfig:
      'clickable, size="small", variant="filled" in primary when active / "outlined" when inactive — replaces the original Switch (new feature, 2026-09-04, no visual reference for "auto"; more compact, and closer to the quick-action chip pattern of the modern HA "more info" dialog than a rectangular switch)',
    verifiedAgainst: "n/a — new feature, no visual reference",
  },
  {
    ourComponent: "Settings (settings row)",
    library: "mui",
    libraryComponent: "Typography + Switch (via ToggleSwitch)",
    approvedConfig:
      "standard settings-list row: label on the left (Typography), Switch on the right — no new configuration, reuses ToggleSwitch (orphaned until now, no screen used it)",
    verifiedAgainst: "n/a — new feature, the reference panel has no settings screen",
  },
  {
    ourComponent: "(structural, any screen)",
    library: "mui",
    libraryComponent: "Box / Stack",
    approvedConfig: "always allowed — pure layout, not a visual choice that has to match the reference",
    verifiedAgainst: "n/a",
  },
];

// Outside the approved set for now — Lovelace/HADashboard does not use
// these Material patterns, and matching the look would take heavy
// customisation. Do not use without a new, explicit decision:
export const LOVELACE_MUI_REJECTED = [
  "Button (rectangular, with ripple) — Lovelace does not use Material buttons; the tap is directly on the icon/area",
  "Card/Paper with default elevation/shadow — Lovelace is flat, no shadow",
  "AppBar/Toolbar — does not exist on the NSPanel, there is no app bar",
  "Dialog/Modal — our 'popup' is the whole screen (a page change), not an overlaid modal",
] as const;
