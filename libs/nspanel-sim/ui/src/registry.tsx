// Which theme draws which component.
//
// A component is addressed as `<theme>/<component>`, and that pair is
// what a project places on a screen. It is a pair and not a name because the
// whole point is that a project may mix: the nav header from one theme
// over cards from another, if that is what the room needs.
//
// The contract is per COMPONENT and not per theme (contracts.ts), which
// is what makes mixing safe -- every implementation of `light-card` takes the
// same props, fires the same events and carries the same hardware obligations.
// A theme that wanted different props would be declaring a different
// component, under its own id.
//
// A theme need not implement everything. What it does not implement it
// inherits from `lovelace-jobr99`, which is the one the panel actually runs
// today -- and the inheritance is REPORTED (`componentProvenance`) rather than
// silent, because "this screen is half another theme" is exactly the
// kind of thing that should be visible in the tool instead of discovered later.
import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import type { ComponentId } from "./contracts";


// The converted components: ONE implementation each, for every theme. What the
// theme changes is the LAYOUT it resolves, and that comes from context -- so
// three identical React files per component would have been the same
// duplication this whole effort removes, one level up.
import { Label } from "./layouts/Label";
import { Clock } from "./layouts/Clock";
import { WeatherRow } from "./layouts/WeatherRow";
import { StatusIconView } from "./layouts/StatusIconView";
import { NavHeader } from "./layouts/NavHeader";
import { PageRail } from "./layouts/PageRail";
import { ListRow } from "./layouts/ListRow";
import { ZoneCounter } from "./layouts/ZoneCounter";
import { PatternPad } from "./layouts/PatternPad";
import { QrCode } from "./layouts/QrCode";
import { LightCard } from "./layouts/LightCard";
import { ToggleSwitch } from "./layouts/ToggleSwitch";
import { Keyboard } from "./layouts/Keyboard";
import { GradientSlider } from "./layouts/GradientSlider";

/** The theme every other one falls back to: the panel as it runs. */
export const BASE_THEME = "lovelace-jobr99";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = ComponentType<any>;

/**
 * The implementations, by theme and component id -- and every entry is now the
 * SAME component, which is the point rather than an oversight.
 *
 * Since the drawing moved to `@nspanel-sim/layout`, a React component's whole
 * job is: read the theme from context, resolve the layout for it, convert the
 * caller's props, render the nodes. None of that varies by theme, so three
 * copies of each file would have been the very duplication this effort removes.
 * What varies is the LAYOUT, and `layoutFor(theme, id, variant)` is where that
 * is chosen.
 *
 * This table stays because a theme is still allowed to bring a React component
 * of its own -- for something the node kinds cannot express yet -- and because
 * `componentProvenance` reads it.
 *
 * The original note follows.
 *
 * The implementations, by theme and component id.
 *
 * Inheritance is declared, never silent: a theme that does not list a component
 * falls back to the base one, and `componentProvenance` says which. Nothing
 * falls back today -- all three themes draw all eight themselves, so the projects
 * are fully independent of one another.
 *
 * `screen` is not here: it is the DEVICE FRAME, which `PlacedScreen` imports
 * directly, and not a component a placement can name.
 */
export const IMPLEMENTATIONS: Record<string, Partial<Record<ComponentId, AnyComponent>>> = {
  "lovelace-jobr99":  {
    label: Label,
    clock: Clock,
    "weather-row": WeatherRow,
    "status-icon": StatusIconView,
    "nav-header": NavHeader,
    "page-rail": PageRail,
    "list-row": ListRow,
    "zone-counter": ZoneCounter,
    "pattern-pad": PatternPad,
    "qr-code": QrCode,
    "light-card": LightCard,
    "toggle-switch": ToggleSwitch,
    "gradient-slider": GradientSlider,
    keyboard: Keyboard,
  },
  "shadcn-dark":  {
    label: Label,
    clock: Clock,
    "weather-row": WeatherRow,
    "status-icon": StatusIconView,
    "nav-header": NavHeader,
    "page-rail": PageRail,
    "list-row": ListRow,
    "zone-counter": ZoneCounter,
    "pattern-pad": PatternPad,
    "qr-code": QrCode,
    "light-card": LightCard,
    "toggle-switch": ToggleSwitch,
    "gradient-slider": GradientSlider,
    keyboard: Keyboard,
  },
  "tailwind-slate":  {
    label: Label,
    clock: Clock,
    "weather-row": WeatherRow,
    "status-icon": StatusIconView,
    "nav-header": NavHeader,
    "page-rail": PageRail,
    "list-row": ListRow,
    "zone-counter": ZoneCounter,
    "pattern-pad": PatternPad,
    "qr-code": QrCode,
    "light-card": LightCard,
    "toggle-switch": ToggleSwitch,
    "gradient-slider": GradientSlider,
    keyboard: Keyboard,
  },
};

/** Where a component actually came from, once inheritance is resolved. */
export interface ComponentProvenance {
  /** the theme asked for */
  asked: string;
  /** the theme that supplied the drawing */
  from: string;
  inherited: boolean;
}

export function resolveComponent(theme: string, id: ComponentId): { component?: AnyComponent; provenance: ComponentProvenance } {
  const own = IMPLEMENTATIONS[theme]?.[id];
  if (own) return { component: own, provenance: { asked: theme, from: theme, inherited: false } };
  const base = IMPLEMENTATIONS[BASE_THEME]?.[id];
  return { component: base, provenance: { asked: theme, from: BASE_THEME, inherited: true } };
}

/** Every component of a theme, saying which ones it draws itself. */
export function componentProvenance(theme: string): { id: ComponentId; from: string; inherited: boolean }[] {
  const ids = Object.keys(IMPLEMENTATIONS[BASE_THEME] ?? {}) as ComponentId[];
  return ids.map((id) => {
    const { provenance } = resolveComponent(theme, id);
    return { id, from: provenance.from, inherited: provenance.inherited };
  });
}

const PanelThemeContext = createContext<string>(BASE_THEME);

/** The theme in force for everything rendered inside. */
export function PanelThemeProvider({ id, children }: { id: string; children: ReactNode }) {
  return <PanelThemeContext.Provider value={id}>{children}</PanelThemeContext.Provider>;
}

export function useThemeId(): string {
  return useContext(PanelThemeContext);
}

/**
 * The implementation of a component under the theme in force.
 *
 * `from` lets a caller override it for one component, which is what "a project
 * may mix" means in practice: a placement can name a theme of its own
 * and this resolves that one instead.
 */
export function useComponent(id: ComponentId, from?: string): AnyComponent | undefined {
  const current = useThemeId();
  return resolveComponent(from ?? current, id).component;
}
