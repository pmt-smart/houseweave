// `gradient-slider`, for every theme. See `Label.tsx` for why this is one file.
//
// The ramp reaches the glass as a generated PICTURE, because a Nextion Slider
// has no gradient attribute at all (`layout/src/paint.ts`); here the same stops
// are CSS. One declaration, two renderings.
import { useEffect, useState } from "react";
import { literalNumber, layoutFor } from "@nspanel-sim/layout";
import { PanelNodes, usePlacement } from "../PanelNodes";
import { usePanelStyle } from "../panelStyle";
import { useThemeId } from "../registry";
import { MissingLayout } from "./MissingLayout";
import type { GradientSliderProps } from "../contracts";

/**
 * The value the thumb shows while a finger is on it.
 *
 * Kept local and synced from the prop, because on the panel the value may only
 * come back on release (`liveSliderUpdate` off, and on the glass a Touch Move
 * carries no Component ID at all). Without this the thumb would
 * stick or fight the finger while the real value has not moved yet. It is
 * behaviour and not decoration, so it lives here and no theme gets to forget it.
 */
function useDragValue(pct: number) {
  const [local, setLocal] = useState(pct);
  useEffect(() => setLocal(pct), [pct]);
  return [local, setLocal] as const;
}

export function GradientSlider({ pct, ramp, onChange, onChangeCommitted, dimmed, height }: GradientSliderProps) {
  const theme = useThemeId();
  const { size, variant } = usePlacement();
  const style = usePanelStyle();
  const [localPct, setLocalPct] = useDragValue(pct);
  const layout = layoutFor(theme, "gradient-slider", variant);
  if (!layout) return <MissingLayout theme={theme} id="gradient-slider" variant={variant} />;
  return (
    // `dimmed` is the colour/temperature mutual exclusion, and it is CSS-only on
    // purpose: on the glass it would be a SECOND generated picture per slider,
    // switched at run time through the manifest. That is a real option -- `pic`
    // is settable from Berry -- and it doubles the bytes, so it waits for
    // somebody to decide the look is worth them.
    <div style={{ opacity: dimmed ? 0.35 : 1 }}>
      <PanelNodes
        nodes={layout({ pct: literalNumber(localPct), ramp, trackHeight: height }, size, style)}
        onSlide={(_id, value) => { setLocalPct(value); onChange(value); }}
        onSlideCommitted={(_id, value) => onChangeCommitted?.(value)}
      />
    </div>
  );
}
