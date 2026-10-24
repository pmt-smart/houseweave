// `toggle-switch`, for every theme. See `Label.tsx` for why this is one file.
//
// A Nextion dual-state Button keeps its own state and repaints on tap without
// waiting for the ESP32 -- which is the whole reason to use one on a panel that
// may have no network. The rail and knob each theme draws are not attributes, so
// they are generated as two pictures (`layout/src/paint.ts`); here the same
// shapes are CSS.
import { layoutFor } from "@nspanel-sim/layout";
import { literalNumber, numberValue } from "@nspanel-sim/layout";
import { PanelNodes, usePlacement } from "../PanelNodes";
import { usePanelStyle } from "../panelStyle";
import { useThemeId } from "../registry";
import { MissingLayout } from "./MissingLayout";
import type { ToggleSwitchProps } from "../contracts";

export function ToggleSwitch({ on, onChange }: ToggleSwitchProps) {
  const theme = useThemeId();
  const { size, variant } = usePlacement();
  const style = usePanelStyle();
  const layout = layoutFor(theme, "toggle-switch", variant);
  if (!layout) return <MissingLayout theme={theme} id="toggle-switch" variant={variant} />;
  const nodes = layout({ on: literalNumber(on ? 1 : 0), change: { kind: "report", event: "toggle" } }, size, style);
  void numberValue;
  return <PanelNodes nodes={nodes} onAction={() => onChange(!on)} />;
}
