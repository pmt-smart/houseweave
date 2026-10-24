// `label`, for every theme.
//
// One file and not three, because once the drawing moved to
// `layout/src/themes/<id>.ts` the three React wrappers were identical except for
// a string -- and that string is already in context. What is left here is the
// only thing React genuinely owns: turning a caller's props into layout props.
//
// A theme that does not lay this out says so on the glass rather than rendering
// nothing. Silence is how a screen ends up with a hole in it that nobody
// notices until the panel is on a wall.
import { literal, layoutFor } from "@nspanel-sim/layout";
import { PanelNodes, usePlacement } from "../PanelNodes";
import { usePanelStyle } from "../panelStyle";
import { useThemeId } from "../registry";
import { MissingLayout } from "./MissingLayout";
import type { LabelProps } from "../contracts";

export function Label({ text, tone = "body", align = "left" }: LabelProps) {
  const theme = useThemeId();
  const { size, variant } = usePlacement();
  const style = usePanelStyle();
  const layout = layoutFor(theme, "label", variant);
  if (!layout) return <MissingLayout theme={theme} id="label" variant={variant} />;
  return <PanelNodes nodes={layout({ text: literal(text), tone, align }, size, style)} />;
}
