// A node list becomes DOM.
//
// The other half of `layout/src/emit.ts`, and written to be as boring as it is:
// this file knows five node kinds and nothing about any component. A clock is
// not mentioned here, and could not be -- which is the point, because the moment
// a renderer knows what a clock looks like there are two drawings of one again.
//
// Absolute positions in panel pixels, never flex between nodes. The placement
// box is the origin; a node's `box` is relative to it. `<Screen>` scales the
// whole thing to whatever zoom the simulator is at, so a pixel here is a pixel
// on the glass.
import { createContext, useContext, useMemo, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  CARET, DEFAULT_VARIANT, RAMPS, colorOf, cssGradient, numberValue, qrEncode, qrPlacement, textColorOf, valueText,
  type Action, type Align, type ColorToken, type KeyNode, type PanelNode, type Size, type SliderNode, type ToggleNode, type VAlign,
} from "@nspanel-sim/layout";
import { ZiTextInBox, fitToBox } from "./compiled/ziText";
import { PanelIcon, type IconRole } from "./panelIcons";
import { PANEL_PALETTE_SLOTS, usePanelPalette, type PanelPalette } from "./palette";
import { usePanelFont } from "./panelFonts";
import { usePanelStyle } from "./panelStyle";

/**
 * What the project decided about this placement: how much room, and which of the
 * theme's styles.
 *
 * Through context rather than as props because both have to reach a theme
 * component that a `<C {...props} />` call constructed, and threading them
 * through every component's props would make them part of every contract --
 * which they are not: a `variant` is not something a React caller passes, it is
 * something the placement chose. Zero room is the honest default: a component
 * rendered outside a placement, like a preview in the Themes tab, has not been
 * given any, and the previewer says how much.
 */
export interface PlacementInfo {
  size: Size;
  /** which style of this component the placement asked for */
  variant: string;
}

const PlacementContext = createContext<PlacementInfo>({ size: { w: 0, h: 0 }, variant: DEFAULT_VARIANT });

export function PlacementProvider({ size, variant = DEFAULT_VARIANT, children }: {
  size: Size;
  variant?: string;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ size, variant }), [size.w, size.h, variant]);
  return <PlacementContext.Provider value={value}>{children}</PlacementContext.Provider>;
}

export function usePlacement(): PlacementInfo {
  return useContext(PlacementContext);
}

export function usePlacementSize(): Size {
  return useContext(PlacementContext).size;
}

const JUSTIFY: Record<Align, CSSProperties["justifyContent"]> = {
  left: "flex-start",
  center: "center",
  right: "flex-end",
};
const ALIGN: Record<VAlign, CSSProperties["alignItems"]> = {
  top: "flex-start",
  middle: "center",
  bottom: "flex-end",
};
/** The same alignment as the Text's own attributes, the way `emit.ts` writes them */
const XCEN: Record<Align, 0 | 1 | 2> = { left: 0, center: 1, right: 2 };
const YCEN: Record<VAlign, 0 | 1 | 2> = { top: 0, middle: 1, bottom: 2 };

/** A colour token as CSS. Unknown tokens fall through to the page, never to black. */
function useColor(): (token: ColorToken | undefined) => string | undefined {
  const palette = usePanelPalette();
  return (token) => {
    if (token === undefined) return undefined;
    const slot = PANEL_PALETTE_SLOTS[token] as keyof PanelPalette | undefined;
    return slot ? palette[slot] : undefined;
  };
}

/**
 * `onAction` is how behaviour gets back in. A node carries an ACTION and never a
 * function, because the emitter has to be able to write it into a `.tft` -- so
 * the React wrapper says what each action means and this dispatches. On the
 * glass the same declaration becomes a `page <name>` or a reported event.
 */
export interface PanelNodesProps {
  nodes: readonly PanelNode[];
  size?: Size;
  onAction?: (action: Action) => void;
  /**
   * Every step of a drag, in the slider's own units: 0..`max`, which is a
   * percentage for every slider that has no `max` of its own. A slider with a
   * small `max` (a page-rail's) reports whole steps, because a Nextion `val`
   * is an integer and the glass would never report anything in between.
   */
  onSlide?: (nodeId: string, pct: number) => void;
  /**
   * The end of a drag.
   *
   * Separate because on the glass it is the only event that reliably carries a
   * value: the panel reports a Touch Move without a Component ID by default
   * (1024-byte serial buffer). A caller that only handled
   * `onSlide` would work in the browser and not on the panel.
   */
  onSlideCommitted?: (nodeId: string, pct: number) => void;
  /** a keyboard key was pressed; the Keyboard component owns the line */
  onKey?: (node: KeyNode) => void;
}

export function PanelNodes({ nodes, size, onAction, onSlide, onSlideCommitted, onKey }: PanelNodesProps) {
  const box = usePlacementSize();
  const room = size ?? box;
  return (
    // An explicit height, because `PlacedScreen` centres its child vertically in
    // the placement: a box that already IS the placement's height makes that
    // centring a no-op, and the components not yet converted keep theirs.
    <div style={{ position: "relative", width: room.w, height: room.h }}>
      {/* a node there only while a value holds something is not there while
          it is empty, as the glass hides it (`NodeBase.shownBy`) */}
      {nodes.filter((node) => !node.shownBy || valueText(node.shownBy) !== "").map((node) => (
        <PanelNodeView key={node.id} node={node} onAction={onAction} onSlide={onSlide} onSlideCommitted={onSlideCommitted} onKey={onKey} />
      ))}
    </div>
  );
}

function PanelNodeView({
  node, onAction, onSlide, onSlideCommitted, onKey,
}: {
  node: PanelNode;
  onAction?: (action: Action) => void;
  onKey?: (node: KeyNode) => void;
  onSlide?: (nodeId: string, pct: number) => void;
  onSlideCommitted?: (nodeId: string, pct: number) => void;
}) {
  const color = useColor();
  const style = usePanelStyle();
  // Hooks are unconditional, so the font is resolved for every kind; only text
  // and icons use it, and both name a role.
  const font = usePanelFont(
    node.kind === "key" && node.capIcon !== undefined ? "icon"
      : node.kind === "text" || node.kind === "icon" || node.kind === "key" || node.kind === "field" || node.kind === "pattern" || node.kind === "button" ? node.font
      : "body",
  );

  const frame: CSSProperties = {
    position: "absolute",
    left: node.box.x,
    top: node.box.y,
    width: node.box.w,
    height: node.box.h,
    boxSizing: "border-box",
    overflow: "hidden",
  };
  // What draws and does not act lets the press through to what is under it,
  // as the glass does: its touch targets are on top of everything
  // (layout/src/emit.ts). A keypad key's digit and letters, two Texts over the
  // key, would otherwise take every press on it here.
  const inert: CSSProperties = { ...frame, pointerEvents: "none" };

  switch (node.kind) {
    case "text":
      // The glyphs of the theme's `.zi`, where the glass puts them -- see
      // `ZiTextInBox` for why the browser's font is not good enough here --
      // and cut to the box the way the runtime cuts it (`fitToBox`). A binding
      // that names nothing arrives undefined (`resolveBinding`) and draws as an
      // empty Text -- the "" the runtime writes to a Help line past the body.
      if (font.zi) return (
        <div style={{ ...inert, background: color(node.background) }}>
          <ZiTextInBox
            font={font.zi} text={fitToBox(font.zi, valueText(node.value) ?? "", node.box.w)} w={node.box.w} h={node.box.h}
            align={{ xcen: XCEN[node.align], ycen: YCEN[node.valign] }} color={color(textColorOf(node.color))}
          />
        </div>
      );
      return (
        <div
          style={{
            ...inert,
            display: "flex",
            justifyContent: JUSTIFY[node.align],
            alignItems: ALIGN[node.valign],
            background: color(node.background),
            color: color(textColorOf(node.color)),
            fontFamily: style.fontFamily,
            fontSize: font.height,
            fontWeight: font.weight,
            // A Nextion Text is one line in a box and clips at its edge. Wrapping
            // here would show a second line the panel will not draw.
            whiteSpace: "nowrap",
            lineHeight: 1,
          }}
        >
          {valueText(node.value)}
        </div>
      );

    case "icon":
      return (
        <div
          style={{
            ...inert,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            background: color(node.background),
          }}
        >
          <PanelIcon role={node.role as IconRole} size={font.height} color={color(colorOf(node.color))} />
        </div>
      );

    case "slider":
      return (
        <>
          <SliderView node={node} frame={frame} onSlide={onSlide} onSlideCommitted={onSlideCommitted} />
          {/* the touch under the track (`SliderNode.tail`): the bottom end, as on the glass */}
          {node.tail !== undefined && node.tail > 0 && onSlideCommitted && (
            <div
              style={{ ...frame, top: node.box.y + node.box.h, height: node.tail, cursor: "pointer" }}
              onClick={() => onSlideCommitted(node.id, node.max ?? 100)}
            />
          )}
        </>
      );

    // A face with its words, or its glyph, centred on it, and the touch: a
    // Nextion Button. Square, as a fill is.
    case "button": {
      const ink = color(textColorOf(node.color));
      const role = node.role === undefined ? undefined : typeof node.role === "string" ? node.role : valueText(node.role);
      const words = node.value === undefined ? "" : valueText(node.value) ?? "";
      return (
        <div
          style={{
            ...frame, display: "flex", justifyContent: "center", alignItems: "center",
            background: color(typeof node.face === "string" ? node.face : colorOf(node.face)),
            cursor: node.action && onAction ? "pointer" : undefined,
          }}
          onClick={node.action && onAction ? () => onAction(node.action!) : undefined}
        >
          {role !== undefined ? (
            <PanelIcon role={role as IconRole} size={font.height} color={ink} />
          ) : font.zi ? (
            <ZiTextInBox
              font={font.zi} text={fitToBox(font.zi, words, node.box.w)} w={node.box.w} h={node.box.h}
              align={{ xcen: XCEN.center, ycen: YCEN.middle }} color={ink}
            />
          ) : (
            <span style={{ color: ink, fontFamily: style.fontFamily, fontSize: font.height, fontWeight: font.weight, whiteSpace: "nowrap", lineHeight: 1 }}>
              {words}
            </span>
          )}
        </div>
      );
    }

    case "fill":
      return (
        <div
          // square: a fill is a Nextion Button, and the glass has no radius
          // but inside a generated picture
          style={{ ...frame, background: color(node.color), cursor: node.action ? "pointer" : undefined }}
          onClick={node.action && onAction ? () => onAction(node.action!) : undefined}
        />
      );

    // Draws nothing, on purpose: a hotspot is a rectangle the panel listens to.
    // The simulator shows it only when the project asks for outlines, which
    // `PlacedScreen` already draws around the placement.
    case "toggle":
      return <ToggleView node={node} frame={frame} onAction={onAction} />;

    case "touch":
      return (
        <div
          style={{ ...frame, cursor: node.action && onAction ? "pointer" : undefined }}
          onClick={node.action && onAction ? () => onAction(node.action!) : undefined}
        />
      );

    // The line being typed. A div and not an <input>: the panel has no caret
    // and no selection, and showing one here would promise an editing model the
    // glass does not have -- the only way to change the line is the keys.
    case "field":
      // With the `.zi`: the glass's own drawing. No padding -- `kbShow` is a
      // Text on the field's box -- and the caret is the CHARACTER the panel
      // appends every other 500 ms (`CARET`), so a centred line shifts as it
      // blinks, exactly as it does there.
      if (font.zi) {
        const align = { xcen: XCEN[node.align], ycen: 1 as const };
        const run = (text: string, blink: string) => (
          <div style={{ position: "absolute", inset: 0, animation: `${blink} 1s step-end infinite` }}>
            <ZiTextInBox font={font.zi!} text={text} w={node.box.w} h={node.box.h} align={align} color={color(node.color)} />
          </div>
        );
        // a keypad's character still open: no caret, and nothing blinks
        if (node.caretOff)
          return (
            <div style={{ ...frame, background: color(node.background) }}>
              <ZiTextInBox font={font.zi!} text={valueText(node.value)} w={node.box.w} h={node.box.h} align={align} color={color(node.color)} />
            </div>
          );
        return (
          <div style={{ ...frame, background: color(node.background) }}>
            {run(valueText(node.value) + CARET, "nspanel-caret")}
            {run(valueText(node.value), "nspanel-caret-off")}
            <style>{"@keyframes nspanel-caret{0%,50%{opacity:1}50.01%,100%{opacity:0}}@keyframes nspanel-caret-off{0%,50%{opacity:0}50.01%,100%{opacity:1}}"}</style>
          </div>
        );
      }
      return (
        <div
          style={{
            ...frame,
            display: "flex",
            justifyContent: JUSTIFY[node.align],
            alignItems: "center",
            padding: "0 8px",
            background: color(node.background),
            color: color(node.color),
            fontFamily: style.fontFamily,
            fontSize: font.height,
            fontWeight: font.weight,
            whiteSpace: "nowrap",
            lineHeight: 1,
          }}
        >
          {valueText(node.value)}
          {/*
            The caret. On the glass it is a CHARACTER appended to the line by a
            Timer (`emit.ts`, KB.draw), because the panel cannot measure text and
            a rectangle could not be placed next to the last letter. Here it is a
            span with the same 500 ms blink, for the same reason it is there:
            the keyboard has one place the next letter goes, and it says where.
          */}
          {!node.caretOff && <span style={{ animation: "nspanel-caret 1s step-end infinite", marginLeft: 1 }}>|</span>}
          <style>{"@keyframes nspanel-caret{0%,50%{opacity:1}50.01%,100%{opacity:0}}"}</style>
        </div>
      );

    case "key":
      return (
        <div
          style={{
            ...frame,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            background: color(node.color),
            color: color(node.textColor),
            // square, as the Button it is on the glass
            fontFamily: style.fontFamily,
            fontSize: font.height,
            fontWeight: font.weight,
            userSelect: "none",
            cursor: "pointer",
          }}
          onClick={() => {
            onKey?.(node);
            if (node.action && onAction) onAction(node.action);
          }}
        >
          {/* An icon caption is a glyph of the icon font on the glass; here it
              is the same role drawn as SVG, which is how every other icon in
              this simulator is drawn. */}
          {node.capIcon !== undefined
            ? <PanelIcon role={node.capIcon as IconRole} size={font.height} color={color(node.textColor)} />
            : font.zi
              // centred both ways: the Button template's own xcen/ycen, which
              // emit.ts leaves as they are
              ? <ZiTextInBox font={font.zi} text={node.cap} w={node.box.w} h={node.box.h} align={{ xcen: 1, ycen: 1 }} color={color(node.textColor)} />
              : node.cap}
        </div>
      );

    case "pattern":
      // The dots as the page compiles them, unlit. Following the finger is the
      // pattern pad's own (layouts/PatternPad.tsx), as it is the gesture
      // block's on the glass.
      return (
        <div style={{ ...frame, overflow: "visible" }}>
          {node.dots.map((box, i) => (
            <div key={i} style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <PanelIcon role={node.role as IconRole} size={font.height} color={color(colorOf(node.color))} />
            </div>
          ))}
        </div>
      );

    // A Nextion Qrcode: the glass encodes the text and draws the symbol. Here
    // the same text, encoded by the standard's smallest version at level L, in
    // whole modules with a quiet zone (layout/src/qr.ts) -- a code a phone can
    // read off the screen. What the Nextion draws for the same text has not
    // been measured.
    case "qrcode": {
      const text = valueText(node.value) ?? "";
      const symbol = text === "" ? null : qrEncode(text);
      if (!symbol) return <div style={{ ...inert, background: color(node.light) }} />;
      const at = qrPlacement(symbol.size, node.box);
      const dark = color(node.dark);
      return (
        <div style={{ ...inert, background: color(node.light) }}>
          <svg width={node.box.w} height={node.box.h} style={{ display: "block" }} shapeRendering="crispEdges">
            {symbol.modules.flatMap((row, y) => row.map((on, x) => (on
              ? <rect key={y * symbol.size + x} x={at.x + x * at.scale} y={at.y + y * at.scale} width={at.scale} height={at.scale} fill={dark} />
              : null)))}
          </svg>
        </div>
      );
    }
  }
}

/**
 * A track with a pointer on it.
 *
 * The gradient is built from the SAME stops the compiled picture is generated
 * from (`RAMPS`), so the browser and the glass cannot show two different ramps.
 * The rounded ends are CSS here and painted pixels there -- different mechanisms
 * for one declaration, which is the whole shape of this package.
 *
 * Hand-rolled rather than MUI's Slider because the geometry has to be the node's:
 * a component that let a library decide its own height could not tell the
 * compiler how tall a picture to generate.
 */
function SliderView({
  node, frame, onSlide, onSlideCommitted,
}: {
  node: SliderNode;
  frame: CSSProperties;
  onSlide?: (nodeId: string, pct: number) => void;
  onSlideCommitted?: (nodeId: string, pct: number) => void;
}) {
  const color = useColor();
  const track = useRef<HTMLDivElement>(null);
  const max = node.max ?? 100;
  const vertical = node.orientation === "vertical";
  const value = Math.min(max, Math.max(0, numberValue(node.value)));
  // a percentage slider reports the exact position, as it always has; one
  // with a small range reports whole steps, the only thing its `val` can hold
  const quantise = (v: number) => (max === 100 ? v : Math.round(v));

  const pctAt = (event: ReactPointerEvent<HTMLDivElement>): number => {
    const box = track.current?.getBoundingClientRect();
    if (!box || (vertical ? box.height : box.width) === 0) return value;
    // a vertical node's 0 is at the TOP, the way a list reads
    const t = vertical ? (event.clientY - box.top) / box.height : (event.clientX - box.left) / box.width;
    return quantise(Math.min(max, Math.max(0, t * max)));
  };

  // A groove is a thin stripe down the middle of a wide touch box: page colour
  // everywhere but the stripe, which is exactly what the generated picture is.
  const groove = node.track.kind === "groove" ? node.track : undefined;
  // A ramp is drawn as the band the picture paints (`RampPicture.band`): the
  // rail across the middle, the rest of the box the page's and the finger's.
  const band = node.track.kind === "ramp" ? Math.min(node.box.h, node.track.height ?? node.box.h) : undefined;
  const rampCss = node.track.kind === "ramp" ? cssGradient(RAMPS[node.track.ramp]) : undefined;
  const background = node.track.kind === "solid" ? color(node.track.color) : undefined;
  // the pointer marks the position and does not fill up to it: the whole ramp
  // stays visible at every value, which is what `pic` and `pic1` pointing at one
  // picture does on the panel
  const along = (room: number) => (max === 0 ? 0 : Math.round((room * value) / max));
  const pointer: CSSProperties = vertical
    ? { left: Math.round((node.box.w - node.pointerWidth) / 2), top: along(node.box.h - node.pointerHeight) }
    : { left: along(node.box.w - node.pointerWidth), top: Math.round((node.box.h - node.pointerHeight) / 2) };

  return (
    <div
      ref={track}
      style={{ ...frame, background, borderRadius: node.radius, touchAction: "none", cursor: onSlide || onSlideCommitted ? "pointer" : undefined }}
      onPointerDown={(event) => {
        if (!onSlide && !onSlideCommitted) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        onSlide?.(node.id, pctAt(event));
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        onSlide?.(node.id, pctAt(event));
      }}
      onPointerUp={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        onSlideCommitted?.(node.id, pctAt(event));
      }}
    >
      {band !== undefined && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: Math.floor((node.box.h - band) / 2),
            width: node.box.w,
            height: band,
            borderRadius: node.radius,
            background: rampCss,
          }}
        />
      )}
      {groove && (
        <div
          style={{
            position: "absolute",
            left: Math.floor((node.box.w - groove.width) / 2),
            top: 0,
            width: groove.width,
            height: node.box.h,
            borderRadius: groove.width / 2,
            background: color(groove.color),
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          ...pointer,
          width: node.pointerWidth,
          height: node.pointerHeight,
          borderRadius: Math.min(2, node.pointerWidth / 2),
          // the same white the emitter asks for (SLIDER_POINTER_RGB565): a
          // themed thumb here has to be a themed pco there first
          background: "#ffffff",
          boxShadow: "0 0 3px rgba(0,0,0,0.7)",
        }}
      />
    </div>
  );
}

/**
 * A control that keeps its own two states.
 *
 * The rail and the knob are CSS here and two generated PICTURES on the glass
 * (`layout/src/paint.ts`), because a Nextion dual-state Button has two fill
 * colours and nothing else. Same declaration, two renderings -- and the reason
 * the knob's inset and diameter are computed the same way in both places is that
 * getting them different is exactly how the two would drift.
 */
function ToggleView({ node, frame, onAction }: {
  node: ToggleNode;
  frame: CSSProperties;
  onAction?: (action: Action) => void;
}) {
  const color = useColor();
  const on = numberValue(node.value) !== 0;
  const inset = Math.max(1, Math.round(node.box.h * 0.12));
  const knob = Math.max(2, node.box.h - inset * 2);
  return (
    <div
      style={{
        ...frame,
        background: color(on ? node.on : node.off),
        borderRadius: node.radius,
        cursor: node.action && onAction ? "pointer" : undefined,
        transition: "background 120ms linear",
      }}
      onClick={node.action && onAction ? () => onAction(node.action!) : undefined}
    >
      <div
        style={{
          position: "absolute",
          top: inset,
          left: on ? Math.max(inset, node.box.w - inset - knob) : inset,
          width: knob,
          height: knob,
          borderRadius: knob / 2,
          background: color(node.knob),
          transition: "left 120ms ease-out",
        }}
      />
    </div>
  );
}
