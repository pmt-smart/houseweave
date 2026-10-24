// `gradient-slider`, dispatched to the theme in force.
//
// The three implementations differ in shape, not in behaviour: the drag value
// and the commit-on-release semantics are the panel's (a Touch Move carries no
// Component ID) and live in every implementation through the same
// helper, so a theme cannot accidentally drop the only event that
// reliably reports a value on the glass.
import { useComponent } from "../registry";
import type { GradientSliderProps } from "../contracts";

export type { GradientSliderProps } from "../contracts";

export function GradientSlider(props: GradientSliderProps) {
  const Impl = useComponent("gradient-slider");
  return Impl ? <Impl {...props} /> : null;
}
