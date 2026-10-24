// `clock`, dispatched to the theme in force. The drawings live in
// `themes/<id>/Clock.tsx`.
import { useComponent } from "../registry";
import type { ClockProps } from "../contracts";

export type { ClockProps } from "../contracts";

export function Clock(props: ClockProps) {
  const Impl = useComponent("clock");
  return Impl ? <Impl {...props} /> : null;
}
