// The hooks the views of the simulated panel share (panelSurface.tsx has the
// components). A touch on any view is pressed on the glass, whose compiled code
// is what answers it: the Nextion and the React screens are one panel.
import { useEffect, useRef, useState } from "react";
import type { DevicePreset } from "@nspanel-sim/ui";
import type { Rig } from "./rig";

/** a view that reads the rig a few times a second, not at every frame */
export function useRigTick(rig: Rig, hz = 5) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000 / hz);
    return () => window.clearInterval(id);
  }, [rig, hz]);
}

/**
 * The finger on a view of the panel: the pixel of the grid under it, pressed on
 * the glass. The handlers go on the box the size of the visible glass.
 */
export function useGlassTouch(rig: Rig, device: DevicePreset) {
  const down = useRef(false);
  const at = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * device.visibleWidthPx, ((e.clientY - r.top) / r.height) * device.heightPx] as const;
  };
  const lift = () => {
    if (!down.current) return;
    down.current = false;
    rig.glass.release();
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      down.current = true;
      rig.glass.press(...at(e));
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (down.current) rig.glass.move(...at(e));
    },
    onPointerUp: lift,
    onPointerCancel: lift,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
}
