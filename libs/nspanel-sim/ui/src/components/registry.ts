// The components are declared in the theme document, `themes/<id>/theme.json`,
// where each one also declares the Nextion primitives it compiles into and the
// theme's own floor for touch targets. `core/` validates it and the simulator
// renders it. The NOTES below are what is known about each component. Do not
// add to this list; add to the document.
//
// Component whitelist — what has been confirmed to work (or not) on
// the real hardware (Nextion Discovery + ESP32), not just in the web
// simulator. It grows incrementally as each component is tested, and
// nothing is ever promoted to "hardware-validated" by assumption.
//
// Why it exists: the simulator runs in a browser and has none of the
// Nextion Discovery's real constraints (serial buffer, Touch Move Event
// without Send Component ID, `recmod`, minimum touch-target size).
// A component can look perfect in the browser and be
// unusable or poor on the real panel. This list is what decides whether
// a component may reach the exporter or stays confined to the simulator
// until validated.

export type ComponentStatus =
  | "simulator-only" // only ever run in a browser, never on hardware
  | "hardware-validated" // confirmed working on the real NSPanel
  | "rejected"; // tested and discarded — reason in `notes`

export interface ComponentRegistryEntry {
  /** The React component's name, e.g. "ToggleSwitch" */
  name: string;
  status: ComponentStatus;
  /** Why it is in that status — always filled in, never empty. */
  notes: string;
  /** Recommended minimum size, where applicable. */
  minSizeMm?: { w: number; h: number };
  /** The date it became hardware-validated, if it has been. */
  validatedOn?: string;
}

export const COMPONENT_REGISTRY: ComponentRegistryEntry[] = [
  {
    name: "ToggleSwitch",
    status: "simulator-only",
    notes:
      "An equivalent native Nextion component exists (dual-state button). Minimum touch target applies (12 mm bare finger / 15 mm industrial).",
    minSizeMm: { w: 15, h: 15 },
  },
  {
    name: "GradientSlider",
    status: "simulator-only",
    notes:
      "Replaces VerticalSlider (vertical) and ColorWheel, both removed " +
      "2026-09-04 — a horizontal bar with a gradient track (brightness, " +
      "colour temperature, and now hue/colour too, previously on the " +
      "wheel). Same constraint as the native Nextion Slider: Touch Move " +
      "Event does not send a Component ID by default (1024 B serial " +
      "buffer), so continuous dragging may not reflect in real time " +
      "without extra work on the TFT. This is the original goal of the whole " +
      "screen-improvement effort — validate carefully before promoting.",
    minSizeMm: { w: 40, h: 15 },
  },
  {
    name: "LightCard",
    status: "simulator-only",
    notes:
      "Icon + name over a single Hotspot on a native Picture/Button. " +
      "One target, two gestures (2026-09-05): a short tap toggles, a " +
      "long press (500 ms) opens the detail. That is NO LONGER the " +
      "lowest-complexity interaction it used to be — the panel has to " +
      "send BOTH Touch Press and Touch Release Events for the component " +
      "(each is a separate checkbox in the Nextion Editor; only one is " +
      "usually enabled) and Berry has to time the gap between them. " +
      "Validate the pair of events before the gesture: with only one of " +
      "them the card answers every press the same way and the detail " +
      "screen becomes unreachable.",
    minSizeMm: { w: 15, h: 15 },
  },
  {
    name: "NavHeader",
    status: "simulator-only",
    notes: "Two arrow buttons + title. Simple interaction (single tap).",
  },
  {
    name: "Clock",
    status: "simulator-only",
    notes: "Text only, no interaction — low risk of not carrying over to hardware.",
  },
  {
    name: "WeatherRow",
    status: "simulator-only",
    notes: "Text and icons only, no interaction.",
  },
  {
    name: "StatusIcon",
    status: "simulator-only",
    notes: "A coloured icon only, no interaction.",
  },
  {
    name: "Settings",
    status: "simulator-only",
    notes:
      "List of panel-wide settings (device level, not per light) — new " +
      "feature, no equivalent screen in the reference. Each row is just " +
      "text + Switch, single tap — low risk of not carrying over to " +
      "hardware, same category as NavHeader.",
  },
];

export function getComponentStatus(name: string): ComponentRegistryEntry | undefined {
  return COMPONENT_REGISTRY.find((c) => c.name === name);
}
