// `pattern-pad`, for every theme. See `Label.tsx` for why this is one file.
//
// The lock's nine dots. On the glass the page's gesture Timer
// follows the finger every 50 ms, lights each dot it reaches and draws the line
// to it; here the pointer does the same with the same geometry -- the dots the
// layout placed and the same radius -- and the release reports what the glass
// reports: the dots as one number, a digit each, in the order they were reached.
//
// The lit dots and the lines are this component's until the page loads again,
// as on the glass: the runtime clears them by loading the page, which here is
// the screen mounting again.
import { useRef, useState, type PointerEvent } from "react";
import { layoutFor, literalNumber, type PatternNode } from "@nspanel-sim/layout";
import { usePlacement } from "../PanelNodes";
import { usePanelStyle } from "../panelStyle";
import { useThemeId } from "../registry";
import { PanelIcon, type IconRole } from "../panelIcons";
import { PANEL_PALETTE_SLOTS, usePanelPalette, type PanelPalette } from "../palette";
import { usePanelFont } from "../panelFonts";
import { MissingLayout } from "./MissingLayout";
import type { PatternPadProps } from "../contracts";

export function PatternPad({ wrong, onTry }: PatternPadProps) {
  const theme = useThemeId();
  const { size, variant } = usePlacement();
  const style = usePanelStyle();
  const palette = usePanelPalette();
  const font = usePanelFont("icon");
  const [lit, setLit] = useState<number[]>([]);
  const drawing = useRef<number[] | null>(null);
  const layout = layoutFor(theme, "pattern-pad", variant);
  if (!layout) return <MissingLayout theme={theme} id="pattern-pad" variant={variant} />;
  const node = layout({ wrong: literalNumber(wrong ? 1 : 0), drawn: onTry ? { kind: "report", event: "lock.try" } : undefined }, size, style)
    .find((n): n is PatternNode => n.kind === "pattern");
  if (!node) return null;
  const css = (token: string) => {
    const slot = PANEL_PALETTE_SLOTS[token] as keyof PanelPalette | undefined;
    return slot ? palette[slot] : undefined;
  };
  const centre = (i: number) => ({ x: node.dots[i].x + node.dots[i].w / 2, y: node.dots[i].y + node.dots[i].h / 2 });
  const unlit = node.color.kind === "switch" ? (node.color.sample !== 0 ? node.color.on : node.color.off) : node.color.kind === "token" ? node.color.token : node.color.sample;

  // the glass's test: within `radius` of a centre on both axes
  const dotAt = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) * size.w) / r.width;
    const y = ((e.clientY - r.top) * size.h) / r.height;
    const i = node.dots.findIndex((_, k) => Math.abs(centre(k).x - x) <= node.radius && Math.abs(centre(k).y - y) <= node.radius);
    return i < 0 ? undefined : i + 1;
  };
  const reach = (e: PointerEvent<HTMLDivElement>) => {
    const d = dotAt(e);
    const path = drawing.current;
    if (!path || d === undefined || path.includes(d)) return;
    path.push(d);
    setLit([...path]);
  };

  return (
    <div
      style={{ position: "relative", width: size.w, height: size.h, touchAction: "none", userSelect: "none", cursor: "pointer" }}
      onPointerDown={(e) => {
        // the stroke keeps coming here if the finger leaves the pad; a pointer
        // the browser does not know (a script's) cannot be captured, and draws anyway
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // nothing to capture
        }
        drawing.current = [...lit];
        reach(e);
      }}
      onPointerMove={reach}
      onPointerUp={() => {
        const path = drawing.current;
        drawing.current = null;
        if (path && path.length > 0) onTry?.(Number(path.join("")));
      }}
    >
      <svg width={size.w} height={size.h} style={{ position: "absolute", left: 0, top: 0 }} aria-hidden>
        {lit.slice(1).map((d, k) => {
          const a = centre(lit[k] - 1);
          const b = centre(d - 1);
          return <line key={k} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={css(node.lit)} strokeWidth={1} />;
        })}
      </svg>
      {node.dots.map((box, i) => (
        <div
          key={i}
          style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <PanelIcon role={node.role as IconRole} size={font.height} color={css(!wrong && lit.includes(i + 1) ? node.lit : unlit)} />
        </div>
      ))}
    </div>
  );
}
