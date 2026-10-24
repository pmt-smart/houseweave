// `light-card`, for every theme. See `Label.tsx` for why this is one file.
//
// The whole card is ONE touch target: a short tap toggles, a long press opens
// the detail. That pair is the PANEL's obligation and not the theme's
// -- a theme that drew only the tap would ship a card whose detail
// screen is unreachable on the glass -- so the gesture lives here, shared, and
// the themes only decide what the card looks like.
//
// One target, not two nested ones: the icon takes 98 of the card's 122 pixels,
// so "tap the card" would only work in a 1.8 mm frame around it.
import { layoutFor } from "@nspanel-sim/layout";
import { colorBinding, literal } from "@nspanel-sim/layout";
import { PanelNodes, usePlacement } from "../PanelNodes";
import { usePanelStyle } from "../panelStyle";
import { useThemeId } from "../registry";
import { MissingLayout } from "./MissingLayout";
import { useLightPressGesture } from "../headless/useLightPress";
import type { LightCardProps } from "../contracts";

export function LightCard({ light, onToggle, onOpenDetail }: LightCardProps) {
  const theme = useThemeId();
  const { size, variant } = usePlacement();
  const style = usePanelStyle();
  const handlers = useLightPressGesture(() => onToggle(light.id), () => onOpenDetail(light.id));
  const layout = layoutFor(theme, "light-card", variant);
  if (!layout) return <MissingLayout theme={theme} id="light-card" variant={variant} />;
  const props = {
    name: literal(light.name),
    icon: light.power === 1 ? "lightOn" : "lightOff",
    // the colour follows the light's own hue, so the panel is told it at run
    // time (`pco` is writable) rather than it being baked per card
    iconColor: colorBinding(`$lights.${light.id}.iconColor`, light.power === 1 ? "icon-low-sat" : "icon-off"),
    tap: { kind: "report", event: "light.toggle" } as const,
    hold: { kind: "report", event: "light.detail" } as const,
  };
  // The gesture is the DOM's here. On the glass the PANEL times it, with a
  // Timer armed on press and disarmed on release (layout/src/wire.ts) -- 500 ms,
  // measured on joBr99's own tmLP. So a long press works with the serial cable
  // unplugged, and what crosses the wire is already "tap" or "hold".
  return (
    <div style={{ userSelect: "none", WebkitUserSelect: "none", touchAction: "manipulation", cursor: "pointer" }} {...handlers}>
      <PanelNodes nodes={layout(props, size, style)} />
    </div>
  );
}
