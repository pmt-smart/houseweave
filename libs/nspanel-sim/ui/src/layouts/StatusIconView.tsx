// `status-icon`, for every theme. See `Label.tsx` for why this is one file.
//
// brain.be: statusUpdate~icon1~color1~icon2~color2 -- two fixed slots in the
// top corners. The COLOUR is what moves: `pco` is writable from Berry, so on the
// glass it is a binding and here it is the token the binding resolves to.
//
// Taking the whole `StatusIcon` object and returning null when it is absent
// would draw nothing in the corners of the simulator while every compiled page
// draws two glyphs: the kind of divergence the node contract exists to remove.
import { colorToken, layoutFor } from "@nspanel-sim/layout";
import { PanelNodes, usePlacement } from "../PanelNodes";
import { usePanelStyle } from "../panelStyle";
import { useThemeId } from "../registry";
import { MissingLayout } from "./MissingLayout";
import type { StatusIconViewProps } from "../contracts";

export function StatusIconView({ side, role = "lightOn", color = "icon-low-sat" }: StatusIconViewProps) {
  const theme = useThemeId();
  const { size, variant } = usePlacement();
  const style = usePanelStyle();
  const layout = layoutFor(theme, "status-icon", variant);
  if (!layout) return <MissingLayout theme={theme} id="status-icon" variant={variant} />;
  return <PanelNodes nodes={layout({ role, color: colorToken(color), side }, size, style)} />;
}
