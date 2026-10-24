// `list-row`, for every theme. See `Label.tsx` for why this is one file.
//
// A row of the generic list, and of a zone's device list:
// an icon, a name that lights up, a grey hint, and a tail with a touch
// of its own. The row is one target -- a short tap is its action, a long press
// its secondary one -- and the tail another, whose tap is the row's and whose
// long press is the tail's (a device's position). A zone's device row (the
// `device` variant) has a third, its icon, whose tap and long press are its
// own. Targets that touch and never overlap, as on the glass: each is the box
// the layout gives its touch node, so the two columns cannot disagree on where
// one ends.
import { colorBinding, layoutFor, literal, literalNumber, type ColorToken, type PanelNode } from "@nspanel-sim/layout";
import { PanelNodes, usePlacement } from "../PanelNodes";
import { usePanelStyle } from "../panelStyle";
import { useThemeId } from "../registry";
import { MissingLayout } from "./MissingLayout";
import { useLightPressGesture } from "../headless/useLightPress";
import type { ListRowProps } from "../contracts";

export function ListRow({ icon, iconColor, label, hint, tail, on, onChange, onHold, onTailHold, onIconTap, onIconHold }: ListRowProps) {
  const theme = useThemeId();
  const { size, variant } = usePlacement();
  const style = usePanelStyle();
  const gestures = {
    mRow: useLightPressGesture(() => onChange?.(), () => onHold?.()),
    mTail: useLightPressGesture(() => onChange?.(), () => onTailHold?.()),
    mIcon: useLightPressGesture(() => onIconTap?.(), () => onIconHold?.()),
    // the `button` variant: the face is the row's touch
    bRow: useLightPressGesture(() => onChange?.(), () => onHold?.()),
  };
  const layout = layoutFor(theme, "list-row", variant);
  if (!layout) return <MissingLayout theme={theme} id="list-row" variant={variant} />;
  const props = {
    ...(icon !== undefined ? { icon } : {}),
    ...(iconColor ? { iconColor: colorBinding("$row.iconColor", iconColor as ColorToken) } : {}),
    label: literal(label ?? ""),
    ...(hint !== undefined ? { hint: literal(hint) } : {}),
    ...(tail !== undefined ? { tail: literal(tail) } : {}),
    // 2 is a row that destroys, in the theme's destructive colour, as on the glass
    on: literalNumber(on === 2 ? 2 : on ? 1 : 0),
    change: onChange ? ({ kind: "report", event: "list.row" } as const) : undefined,
    hold: onHold ? ({ kind: "report", event: "list.hold" } as const) : undefined,
    tailHold: onTailHold ? ({ kind: "report", event: "list.slot" } as const) : undefined,
    iconTap: onIconTap ? ({ kind: "report", event: "zone.icon" } as const) : undefined,
    iconHold: onIconHold ? ({ kind: "report", event: "zone.iconHold" } as const) : undefined,
  };
  const nodes = layout(props, size, style);
  const touches = nodes.filter((n): n is Extract<PanelNode, { kind: "touch" | "button" }> => (n.kind === "touch" || n.kind === "button") && n.id in gestures);
  // The gesture is the DOM's here. On the glass the PANEL times it with its own
  // Timer, so a long press works with the serial cable unplugged; what crosses
  // the wire is already "tap" or "hold".
  return (
    <div style={{ position: "relative", userSelect: "none", WebkitUserSelect: "none", touchAction: "manipulation" }}>
      <PanelNodes nodes={nodes} />
      {touches.map((n) => (
        <div
          key={n.id}
          style={{ position: "absolute", left: n.box.x, top: n.box.y, width: n.box.w, height: n.box.h, cursor: "pointer" }}
          {...gestures[n.id as keyof typeof gestures]}
        />
      ))}
    </div>
  );
}
