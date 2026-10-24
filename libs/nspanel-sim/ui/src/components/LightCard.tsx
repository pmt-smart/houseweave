// `light-card`, dispatched to the theme in force.
//
// The drawing lives in `themes/<id>/LightCard.tsx`; this only picks one.
// Screens keep importing `LightCard` by name, so which theme is drawing
// is a property of where the screen is MOUNTED, not of what it imports -- which
// is what lets the same screen be rendered in three looks without three copies
// of the screen.
import { useComponent } from "../registry";
import type { LightCardProps } from "../contracts";

export type { LightCardProps } from "../contracts";
export { useLightPressGesture } from "../headless/useLightPress";

export function LightCard(props: LightCardProps) {
  const Impl = useComponent("light-card");
  return Impl ? <Impl {...props} /> : null;
}
