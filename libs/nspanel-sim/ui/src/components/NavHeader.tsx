// `nav-header`, dispatched to the theme in force. The drawings live in
// `themes/<id>/NavHeader.tsx`.
import { useComponent } from "../registry";
import type { NavHeaderProps } from "../contracts";

export type { NavHeaderProps } from "../contracts";

export function NavHeader(props: NavHeaderProps) {
  const Impl = useComponent("nav-header");
  return Impl ? <Impl {...props} /> : null;
}
