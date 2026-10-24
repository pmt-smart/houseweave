// `status-icon`, dispatched to the theme in force. The drawings live in
// `themes/<id>/StatusIconView.tsx`.
import { useComponent } from "../registry";
import type { StatusIconViewProps } from "../contracts";

export type { StatusIconViewProps } from "../contracts";

export function StatusIconView(props: StatusIconViewProps) {
  const Impl = useComponent("status-icon");
  return Impl ? <Impl {...props} /> : null;
}
