// `nav-header`, for every theme. See `Label.tsx` for why this is one file.
//
// home.be: entityUpd~title~navigation. An arrow with nowhere to go draws nothing
// rather than a dimmed control -- `NO_NAV` means there is no card that way, and
// a disabled-looking target the finger can still press is worse than no target.
//
// On the glass the arrows navigate by themselves: a `page <name>` in the Touch
// Release needs no ESP32. Here they are callbacks, because the simulator has no
// pages to jump to -- it re-renders.
import { colorBinding, layoutFor, literal, type ColorToken, type PanelNode } from "@nspanel-sim/layout";
import { useLightPressGesture } from "../headless/useLightPress";
import { PanelNodes, usePlacement } from "../PanelNodes";
import { usePanelStyle } from "../panelStyle";
import { useThemeId } from "../registry";
import { MissingLayout } from "./MissingLayout";
import type { NavHeaderProps } from "../contracts";

export function NavHeader(header: NavHeaderProps) {
  const { title, onClose, onPrev, onNext, onEditTitle, onAction, actionIcon, actionIconColor, onActionHold, onMore, statusIcon } = header;
  // The sign's column is the placement's once it binds one, whatever it names
  // now -- as on the glass, where the title's box is compiled without it.
  const hasStatus = "statusIcon" in header;
  const theme = useThemeId();
  const { size, variant } = usePlacement();
  const style = usePanelStyle();
  // The title's two gestures, timed in the DOM the way the light card's are,
  // over the title's own touch box: a tap leaves, a long press opens the
  // keyboard, and the long press never also leaves on the way up. On the glass
  // the PANEL times it -- a Timer armed on press and disarmed on release, 500 ms
  // (layout/src/wire.ts) -- so what crosses the wire is already "hold". The +
  // and the arrows have no long press there, and none here either.
  const titleGesture = useLightPressGesture(() => onClose?.(), () => onEditTitle?.());
  const layout = layoutFor(theme, "nav-header", variant);
  if (!layout) return <MissingLayout theme={theme} id="nav-header" variant={variant} />;
  const props = {
    title: literal(title),
    close: onClose ? ({ kind: "report", event: "nav.close" } as const) : undefined,
    prev: onPrev ? ({ kind: "report", event: "nav.prev" } as const) : undefined,
    next: onNext ? ({ kind: "report", event: "nav.next" } as const) : undefined,
    editTitle: onEditTitle ? ({ kind: "report", event: "text.edit" } as const) : undefined,
    action: onAction ? ({ kind: "report", event: "header.action" } as const) : undefined,
    actionHold: onActionHold ? ({ kind: "report", event: "header.actionHold" } as const) : undefined,
    actionIcon: actionIcon ?? "add",
    ...(actionIconColor ? { actionIconColor: colorBinding("$header.actionIconColor", actionIconColor as ColorToken) } : {}),
    more: onMore ? ({ kind: "report", event: "header.more" } as const) : undefined,
    ...(hasStatus ? { statusIcon: statusIcon ?? "" } : {}),
  };
  const drawn = layout(props, size, style);
  const nodes = (
    <PanelNodes
      nodes={drawn}
      onAction={(action) => {
        if (action.kind !== "report") return;
        if (action.event === "nav.close") onClose?.();
        if (action.event === "nav.prev") onPrev?.();
        if (action.event === "nav.next") onNext?.();
        if (action.event === "header.action") onAction?.();
        if (action.event === "header.more") onMore?.();
      }}
    />
  );
  if (!onEditTitle) return nodes;
  const touch = drawn.find((n): n is Extract<PanelNode, { kind: "touch" }> => n.kind === "touch" && n.id === "mTitle");
  return (
    <div style={{ position: "relative", userSelect: "none", WebkitUserSelect: "none", touchAction: "manipulation" }}>
      {nodes}
      {touch && (
        <div style={{ position: "absolute", left: touch.box.x, top: touch.box.y, width: touch.box.w, height: touch.box.h, cursor: "pointer" }} {...titleGesture} />
      )}
    </div>
  );
}
