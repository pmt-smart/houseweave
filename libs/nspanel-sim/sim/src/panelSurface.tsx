// What every view of the simulated panel shares: the touch areas, which are
// the glass's components, and the housing, whose two buttons are the panel's
// own. The finger, which is always the glass's, is in panelHooks.ts.
//
// Both views -- the emulated Nextion and the project's React screens -- are
// the same panel: a touch on either is pressed on the glass, whose compiled
// code is what answers it, and what either shows is what the glass holds. So
// they cannot disagree about which page is up or whether a light is on.
import { useEffect, useRef, type ReactNode } from "react";
import type { DeviceId, DevicePreset } from "@nspanel-sim/ui";
import { Enclosure, type HousingColor } from "./Enclosure";
import { useRigTick } from "./panelHooks";
import type { Rig } from "./rig";

/**
 * What takes a touch on the page on show: every visible component with a box,
 * as the glass has them, drawn over the whole grid (the housing crops it as it
 * crops the frame). The same boxes on both views, because both hand the touch
 * to the glass.
 */
export function TouchAreas({ rig }: { rig: Rig }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { width, height } = rig.glass.frame;
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    let seen = -1;
    let raf = 0;
    const paint = () => {
      const version = rig.glass.frame.version;
      if (version !== seen) {
        seen = version;
        ctx.clearRect(0, 0, width, height);
        ctx.strokeStyle = "rgba(255, 64, 160, 0.9)";
        ctx.lineWidth = 1;
        for (const c of rig.glass.components()) {
          if (!c.vis || !c.def.geometric || c.def.type === "Text") continue;
          ctx.strokeRect(c.def.x + 0.5, c.def.y + 0.5, c.def.w - 1, c.def.h - 1);
        }
      }
      raf = requestAnimationFrame(paint);
    };
    // the first at once: what is on the glass is there before the next frame
    paint();
    return () => cancelAnimationFrame(raf);
  }, [rig, width, height]);
  return <canvas ref={ref} width={width} height={height} style={{ display: "block", position: "absolute", left: 0, top: 0, pointerEvents: "none" }} />;
}

export interface RigEnclosureProps {
  rig: Rig;
  device: DevicePreset;
  deviceId: DeviceId;
  monitorPxPerMm: number;
  color: HousingColor;
  children: ReactNode;
}

/**
 * The housing of a view, and its two buttons are the panel's: held for as long
 * as the mouse is down, they go to the panel's button driver at its next scan.
 * It looks at the relays ten times a second; the screen inside is its parent's
 * and is not drawn again for it.
 */
export function RigEnclosure({ rig, device, deviceId, monitorPxPerMm, color, children }: RigEnclosureProps) {
  useRigTick(rig, 10);
  const p = rig.panel;
  return (
    <Enclosure
      device={device}
      deviceId={deviceId}
      monitorPxPerMm={monitorPxPerMm}
      color={color}
      buttons={{ pressed: p.buttons, relays: p.relays, onPress: (n, down) => p.pressButton(n, down) }}
    >
      {children}
    </Enclosure>
  );
}
