// `weather-row`, for every theme. See `Label.tsx` for why this is one file.
//
// brain.be: weatherUpdate~item1~..~item5. The temperature is FORMATTED before
// it reaches a binding -- the glass does no arithmetic and no units -- so a
// missing reading becomes an em dash rather than a dimmed cell. The dimming the
// three React versions used (`opacity` 0.25/0.35/0.4) is not a thing the glass
// can do, so it is gone from both sides.
//
// The formatting itself lives in `layout/src/format.ts` and not here: the panel
// side has to say the same thing, and a rule written twice is written wrong on
// the second correction.
import { layoutFor, formatTempC } from "@nspanel-sim/layout";
import { literal } from "@nspanel-sim/layout";
import { PanelNodes, usePlacement } from "../PanelNodes";
import { usePanelStyle } from "../panelStyle";
import { useThemeId } from "../registry";
import { MissingLayout } from "./MissingLayout";
import type { WeatherRowProps } from "../contracts";

export function WeatherRow({ items }: WeatherRowProps) {
  const theme = useThemeId();
  const { size, variant } = usePlacement();
  const style = usePanelStyle();
  const layout = layoutFor(theme, "weather-row", variant);
  if (!layout) return <MissingLayout theme={theme} id="weather-row" variant={variant} />;
  const cells = items.map((item) => ({ label: literal(item.label), temp: literal(formatTempC(item.tempC)) }));
  return <PanelNodes nodes={layout({ items: cells }, size, style)} />;
}
