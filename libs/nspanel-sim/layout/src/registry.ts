// Which theme lays out which component, and in which STYLES.
//
// The same shape as `ui/src/registry.tsx`, and deliberately a SECOND registry
// rather than a field added to that one: this one has to be readable from a
// `.mjs` compile script with no React in the process, and that one holds React
// components.
//
// Three levels, and the third is the newest. A component id fixes the DATA and
// the obligations -- `gradient-slider` means "a track with a value on it,
// reporting on release" in every theme -- and everything under that is free:
//
//   theme      how this design system draws it. The three here differ in MODEL
//              and not just in tint: one clock puts a rule under the time, one
//              puts the date above it, one puts it in a chip.
//   variant    how this theme draws it THIS TIME. A theme is allowed more than
//              one style of the same element -- a full-width rail on a detail
//              screen and a thin one inside a card row are both sliders: same
//              props, same events, same hardware obligations, different drawing.
//              A placement picks with `"variant"`.
//
// `default` is what a placement gets when it does not ask, and every component a
// theme lays out has to have one. A theme's variants are declared in its own
// document (`theme.json`, `components[].variants`) and the tests hold this table
// to that declaration in both directions -- a variant offered here and not
// declared there is a style nothing can discover, and one declared there and
// missing here is a placement that will not compile.
import type { ComponentId } from "./components.js";
import type { LayoutFn } from "./node.js";

import * as lovelaceJobr99 from "./themes/lovelace-jobr99.js";
import * as shadcnDark from "./themes/shadcn-dark.js";
import * as tailwindSlate from "./themes/tailwind-slate.js";

/** The theme every other one falls back to: the panel as it runs. */
export const BASE_THEME = "lovelace-jobr99";

/** The style a placement gets when it names none. */
export const DEFAULT_VARIANT = "default";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyLayout = LayoutFn<any>;

/** The styles of one component, by variant name. `default` is required. */
export type ComponentLayouts = Record<string, AnyLayout>;

/**
 * The layouts, by theme, component id and variant.
 *
 * A missing entry here means "not laid out by this theme" and not "inherits
 * from the base one". There is no silent fallback: `layoutFor` returns `undefined` and the
 * caller decides, because a compile step that quietly emitted another theme's
 * geometry would be the two-implementations problem wearing a different hat.
 */
export const LAYOUTS: Record<string, Partial<Record<ComponentId, ComponentLayouts>>> = {
  "lovelace-jobr99": {
    label: { default: lovelaceJobr99.label },
    clock: { default: lovelaceJobr99.clock },
    "weather-row": { default: lovelaceJobr99.weatherRow },
    "status-icon": { default: lovelaceJobr99.statusIcon },
    keyboard: { default: lovelaceJobr99.keyboard, t9: lovelaceJobr99.keyboardT9, symbols: lovelaceJobr99.keyboardSymbols },
    "nav-header": { default: lovelaceJobr99.navHeader },
    "page-rail": { default: lovelaceJobr99.pageRail },
    "list-row": { default: lovelaceJobr99.listRow, flush: lovelaceJobr99.listRowFlush, device: lovelaceJobr99.listRowDevice, stacked: lovelaceJobr99.listRowStacked, button: lovelaceJobr99.listRowButton },
    "zone-counter": { default: lovelaceJobr99.zoneCounter, face: lovelaceJobr99.zoneCounterFace },
    "pattern-pad": { default: lovelaceJobr99.patternPad },
    "qr-code": { default: lovelaceJobr99.qrCode },
    "light-card": { default: lovelaceJobr99.lightCard },
    "toggle-switch": { default: lovelaceJobr99.toggleSwitch },
    "gradient-slider": {
      default: lovelaceJobr99.gradientSlider,
      // the thin rail his card rows use, and the reason variants exist at all:
      // the same component, the same events, drawn small
      compact: lovelaceJobr99.gradientSliderCompact,
    },
  },
  "shadcn-dark": {
    keyboard: { default: shadcnDark.keyboard, t9: shadcnDark.keyboardT9, symbols: shadcnDark.keyboardSymbols },
    label: { default: shadcnDark.label },
    clock: { default: shadcnDark.clock },
    "weather-row": { default: shadcnDark.weatherRow },
    "status-icon": { default: shadcnDark.statusIcon },
    "nav-header": { default: shadcnDark.navHeader },
    "page-rail": { default: shadcnDark.pageRail },
    "list-row": { default: shadcnDark.listRow, flush: shadcnDark.listRowFlush, device: shadcnDark.listRowDevice, stacked: shadcnDark.listRowStacked, button: shadcnDark.listRowButton },
    "zone-counter": { default: shadcnDark.zoneCounter, face: shadcnDark.zoneCounterFace },
    "pattern-pad": { default: shadcnDark.patternPad },
    "qr-code": { default: shadcnDark.qrCode },
    "light-card": { default: shadcnDark.lightCard },
    "toggle-switch": { default: shadcnDark.toggleSwitch },
    "gradient-slider": { default: shadcnDark.gradientSlider },
  },
  "tailwind-slate": {
    keyboard: { default: tailwindSlate.keyboard, t9: tailwindSlate.keyboardT9, symbols: tailwindSlate.keyboardSymbols },
    label: { default: tailwindSlate.label },
    clock: { default: tailwindSlate.clock },
    "weather-row": { default: tailwindSlate.weatherRow },
    "status-icon": { default: tailwindSlate.statusIcon },
    "nav-header": { default: tailwindSlate.navHeader },
    "page-rail": { default: tailwindSlate.pageRail },
    "list-row": { default: tailwindSlate.listRow, flush: tailwindSlate.listRowFlush, device: tailwindSlate.listRowDevice, stacked: tailwindSlate.listRowStacked, button: tailwindSlate.listRowButton },
    "zone-counter": { default: tailwindSlate.zoneCounter, face: tailwindSlate.zoneCounterFace },
    "pattern-pad": { default: tailwindSlate.patternPad },
    "qr-code": { default: tailwindSlate.qrCode },
    "light-card": { default: tailwindSlate.lightCard },
    "toggle-switch": { default: tailwindSlate.toggleSwitch },
    "gradient-slider": { default: tailwindSlate.gradientSlider },
  },
};

export function layoutFor(theme: string, id: ComponentId, variant = DEFAULT_VARIANT): AnyLayout | undefined {
  return LAYOUTS[theme]?.[id]?.[variant];
}

/** Which styles a theme offers for one component. Empty when it does not lay it out. */
export function variantsOf(theme: string, id: ComponentId): string[] {
  return Object.keys(LAYOUTS[theme]?.[id] ?? {});
}

/** Which components each theme lays out, and in how many styles. */
export function layoutCoverage(): Record<string, Record<string, string[]>> {
  return Object.fromEntries(
    Object.entries(LAYOUTS).map(([theme, byId]) => [
      theme,
      Object.fromEntries(Object.entries(byId).map(([id, variants]) => [id, Object.keys(variants ?? {})])),
    ]),
  );
}
