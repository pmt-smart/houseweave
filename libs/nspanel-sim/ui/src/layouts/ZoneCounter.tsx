// `zone-counter`, for every theme. See `Label.tsx` for why this is one file.
//
// A counter of a zone's top card: the number and the kind's
// icon, one target. A tap toggles that kind, a long press opens its joint mode.
import { colorBinding, layoutFor, literal, type ColorToken } from "@nspanel-sim/layout";
import { PanelNodes, usePlacement } from "../PanelNodes";
import { usePanelStyle } from "../panelStyle";
import { useThemeId } from "../registry";
import { MissingLayout } from "./MissingLayout";
import { useLightPressGesture } from "../headless/useLightPress";
import type { ZoneCounterProps } from "../contracts";

export function ZoneCounter({ count, icon, iconColor, onTap, onHold }: ZoneCounterProps) {
  const theme = useThemeId();
  const { size, variant } = usePlacement();
  const style = usePanelStyle();
  const handlers = useLightPressGesture(() => onTap?.(), () => onHold?.());
  const layout = layoutFor(theme, "zone-counter", variant);
  if (!layout) return <MissingLayout theme={theme} id="zone-counter" variant={variant} />;
  const props = {
    count: literal(count ?? ""),
    icon: icon ?? "",
    ...(iconColor ? { iconColor: colorBinding("$counter.iconColor", iconColor as ColorToken) } : {}),
    tap: onTap ? ({ kind: "report", event: "zone.count" } as const) : undefined,
    hold: onHold ? ({ kind: "report", event: "zone.countHold" } as const) : undefined,
  };
  return (
    <div style={{ userSelect: "none", WebkitUserSelect: "none", touchAction: "manipulation", cursor: "pointer" }} {...handlers}>
      <PanelNodes nodes={layout(props, size, style)} />
    </div>
  );
}
