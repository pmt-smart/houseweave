// `qr-code`, for every theme. See `Label.tsx` for why this is one file.
//
// A code a phone's camera reads. On the glass the Nextion
// encodes the text and draws the symbol; here the node is drawn by
// `PanelNodes`, with the standard's encoder (layout/src/qr.ts).
import { literal, layoutFor } from "@nspanel-sim/layout";
import { PanelNodes, usePlacement } from "../PanelNodes";
import { usePanelStyle } from "../panelStyle";
import { useThemeId } from "../registry";
import { MissingLayout } from "./MissingLayout";
import type { QrCodeProps } from "../contracts";

export function QrCode({ code, capacity }: QrCodeProps) {
  const theme = useThemeId();
  const { size, variant } = usePlacement();
  const style = usePanelStyle();
  const layout = layoutFor(theme, "qr-code", variant);
  if (!layout) return <MissingLayout theme={theme} id="qr-code" variant={variant} />;
  return <PanelNodes nodes={layout({ code: literal(code ?? ""), capacity }, size, style)} />;
}
