// The project's React screens, on the same panel as the glass.
//
// The screens are the project's placements drawn by @nspanel-sim/ui -- the
// design as written -- and what they show is what the glass shows: every value
// is read back off the glass (mirror.ts), and every touch is pressed on the
// glass (panelSurface.tsx). So this panel is the Nextion's twin in everything
// but the drawing, and the drawing is the difference worth looking at: the
// design as React beside what the .tft draws.
//
// The plan's cards are not placements: the Berry draws them on the glass
// (berry/panel_draw.be), and the colour picker where they go. That area of the
// React screen is the glass's own pixels.
import { useEffect, useMemo, useRef, useState } from "react";
import { PlacedScreen, rgb565ToHex, targetCanvasSize, type DeviceId, type DevicePreset } from "@nspanel-sim/ui";
import { DEVICE_VISIBLE, PLAN_LEFT, PLAN_TOP, layoutFor, type Project, type Screen, type Theme } from "@nspanel-sim/core";
import { themesOf } from "./content";
import type { HousingColor } from "./Enclosure";
import { globalsOf, pageNameOf, readGlass, resolverOf, type Mirror, type ReadBack } from "./mirror";
import { readBackOf } from "./readBack";
import { useGlassTouch } from "./panelHooks";
import { RigEnclosure, TouchAreas } from "./panelSurface";
import type { Rig } from "./rig";
import { useThemeRuntimes } from "./themeRuntime";

export interface ReactPanelViewProps {
  rig: Rig;
  project: Project;
  device: DevicePreset;
  deviceId: DeviceId;
  monitorPxPerMm: number;
  housingColor: HousingColor;
  /** outline what takes a touch: the glass's components, which take it */
  outlines: boolean;
}

interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** where a plan is drawn: the rule the generator gives the runtime (build-project-hmi.mjs, `plan_style`) */
function planArea(deviceId: DeviceId): Area {
  const vis = DEVICE_VISIBLE[deviceId];
  return { x: PLAN_LEFT, y: PLAN_TOP, w: vis.w - 2 * PLAN_LEFT, h: vis.h - PLAN_TOP };
}

/** a screen's own page colour, when it names one (joBr99's screensaver is black) */
function backgroundOf(screen: Screen, systems: readonly Theme[]): string | undefined {
  if (!screen.background) return undefined;
  for (const ds of systems) {
    const token = ds.colors.find((c) => c.id === screen.background);
    if (token) return rgb565ToHex(token.rgb565);
  }
  return undefined;
}

/** the glass read twenty times a second; a new value is a new render, the same values are none */
function useMirror(rig: Rig, back: ReadBack, globals: Set<string>): Mirror | null {
  const [mirror, setMirror] = useState<Mirror | null>(null);
  useEffect(() => {
    let last = "";
    const id = window.setInterval(() => {
      const m = readGlass(rig.glass, rig.manifest, back, globals);
      if (m.key === last) return;
      last = m.key;
      setMirror(m);
    }, 50);
    return () => window.clearInterval(id);
  }, [rig, back, globals]);
  return mirror;
}

/**
 * A part of the glass's frame, where it is on the page: what the Berry drew
 * there, pixel for pixel.
 */
function GlassPixels({ rig, area }: { rig: Rig; area: Area }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { x, y, w, h } = area;
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const whole = ctx.createImageData(rig.glass.frame.width, rig.glass.frame.height);
    let seen = -1;
    let raf = 0;
    const paint = () => {
      const frame = rig.glass.frame;
      if (frame.version !== seen) {
        seen = frame.version;
        frame.rgba(whole.data);
        ctx.putImageData(whole, -x, -y, x, y, w, h);
      }
      raf = requestAnimationFrame(paint);
    };
    // the first at once: what is on the glass is there before the next frame
    paint();
    return () => cancelAnimationFrame(raf);
  }, [rig, x, y, w, h]);
  return <canvas ref={ref} width={w} height={h} style={{ display: "block", position: "absolute", left: x, top: y }} />;
}

export function ReactPanelView({ rig, project, device, deviceId, monitorPxPerMm, housingColor, outlines }: ReactPanelViewProps) {
  const systems = useMemo(() => themesOf(project), [project]);
  const runtimes = useThemeRuntimes(systems);
  const primary = systems[0]?.id ?? "";
  const back = useMemo(() => readBackOf(systems[0]), [systems]);
  const globals = useMemo(() => globalsOf(rig.glass.hmi), [rig]);
  const screens = useMemo(() => layoutFor(project, deviceId)?.screens ?? [], [project, deviceId]);
  const mirror = useMirror(rig, back, globals);
  const touch = useGlassTouch(rig, device);
  const target = targetCanvasSize(device, monitorPxPerMm);
  const scale = monitorPxPerMm / device.pxPerMm;

  const screen = mirror ? screens.find((s) => pageNameOf(s.id) === mirror.page) : undefined;
  const drawn = !mirror ? null : screen ? (
    <PlacedScreen
      // a page loaded is built again, as the glass builds it
      key={screen.id}
      device={deviceId}
      placements={screen.place}
      primaryTheme={primary}
      runtimes={runtimes.byId}
      resolve={resolverOf(mirror, screen)}
      background={backgroundOf(screen, systems)}
      overlay={screen.plan ? <GlassPixels rig={rig} area={planArea(deviceId)} /> : undefined}
    />
  ) : (
    // a page no screen of this layout compiles to: the glass's own, whole
    <div style={{ position: "relative", width: device.visibleWidthPx, height: device.heightPx }}>
      <GlassPixels rig={rig} area={{ x: 0, y: 0, w: device.visibleWidthPx, h: device.heightPx }} />
    </div>
  );

  // the glass's touch areas, over the whole grid and cropped by the housing
  const areas = outlines ? (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      <div style={{ width: device.visibleWidthPx, height: device.heightPx, transform: `scale(${scale})`, transformOrigin: "top left", position: "relative" }}>
        <TouchAreas rig={rig} />
      </div>
    </div>
  ) : null;

  return (
    <RigEnclosure rig={rig} device={device} deviceId={deviceId} monitorPxPerMm={monitorPxPerMm} color={housingColor}>
      <div style={{ width: target.widthPx, height: target.heightPx, position: "relative", overflow: "hidden", touchAction: "none", cursor: "pointer" }} {...touch}>
        <div
          style={{
            width: device.visibleWidthPx,
            height: device.heightPx,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            // The housing zeroes line-height on the glass so a canvas sits
            // flush; real text needs it back, or every line box collapses.
            lineHeight: "normal",
            // the touch is the glass's: the React tree only shows
            pointerEvents: "none",
          }}
        >
          {drawn}
        </div>
        {areas}
      </div>
    </RigEnclosure>
  );
}
