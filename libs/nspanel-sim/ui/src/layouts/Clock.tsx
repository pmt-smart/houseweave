// `clock`, for every theme. See `Label.tsx` for why this is one file.
//
// brain.be: update_clock() sends time~/date~. The MODEL -- whether the date
// goes under the time, above it, or into a chip, and whether there is a rule --
// belongs to each theme's layout and to nothing here. A fourth theme with an
// analogue face changes no file in this directory.
import { literal, layoutFor } from "@nspanel-sim/layout";
import { PanelNodes, usePlacement } from "../PanelNodes";
import { usePanelStyle } from "../panelStyle";
import { useThemeId } from "../registry";
import { MissingLayout } from "./MissingLayout";
import type { ClockProps } from "../contracts";

export function Clock({ time, date }: ClockProps) {
  const theme = useThemeId();
  const { size, variant } = usePlacement();
  const style = usePanelStyle();
  const layout = layoutFor(theme, "clock", variant);
  if (!layout) return <MissingLayout theme={theme} id="clock" variant={variant} />;
  return <PanelNodes nodes={layout({ time: literal(time), date: literal(date) }, size, style)} />;
}
