// `toggle-switch`, dispatched to the theme in force. The drawings live in
// `themes/<id>/ToggleSwitch.tsx`.
import { useComponent } from "../registry";
import type { ToggleSwitchProps } from "../contracts";

export type { ToggleSwitchProps } from "../contracts";

export function ToggleSwitch(props: ToggleSwitchProps) {
  const Impl = useComponent("toggle-switch");
  return Impl ? <Impl {...props} /> : null;
}
