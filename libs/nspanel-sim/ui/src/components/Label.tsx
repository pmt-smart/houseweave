// `label`, dispatched to the theme in force. The drawings live in
// `themes/<id>/Label.tsx`.
//
// Every theme implements `label` and the registry resolves it for placed
// screens; this dispatcher draws one outside a placement, for the Themes tab,
// which draws each component the theme declares.
import { useComponent } from "../registry";
import type { LabelProps } from "../contracts";

export type { LabelProps } from "../contracts";

export function Label(props: LabelProps) {
  const Impl = useComponent("label");
  return Impl ? <Impl {...props} /> : null;
}
