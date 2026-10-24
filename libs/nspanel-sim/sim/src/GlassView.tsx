// The glass of the simulated panel, at true physical size, in its housing.
//
// What is drawn is the emulated Nextion's own frame (@nspanel-sim/glass):
// RGB565, the compiled pages with what the panel's Berry wrote on them. A
// touch here is a touch on the glass, at the pixel under the finger: the
// component there runs its compiled code, which is what reaches the panel.
//
// The bezel hides part of the grid (the EU shows 450 of its 480 columns, on
// the right, devices.ts), so the frame is cropped to what the glass shows, as
// the housing crops it.
//
// How it reaches the monitor is the Real column's own treatment: the panel's pixels are packed down to the calibrated physical
// size by canvas2D's own smoothing, into a canvas exactly `target` CSS pixels
// wide. Every part of that is load-bearing, and each was worth breaking once
// to find out:
//
//   canvas2D's filter, not CSS. It is coarser than the compositor's, and the
//   roughness it leaves is what makes this side read as a device rather than
//   a web page. Handing the downscale to CSS erased it -- which is what this
//   view did for a day, and the glass looked as polished as the React screens
//   beside it. Nearest-neighbour went the other way and shredded the text.
//
//   `target` pixels, NOT target x devicePixelRatio. The HiDPI move uses every
//   monitor pixel there is, and that extra sharpness is exactly the sharpness
//   a 6.5 px/mm screen does not have.
//
//   Quantised ONCE, at native resolution: the frame is RGB565 already.
//   Quantising the packed-down result again puts every pixel on the RGB565
//   grid and flattens the anti-aliased edges of text into posterised
//   outlines, clean and vector-looking, which is not what a panel looks like.
//
// Accuracy to the monitor is not the goal. Looking like the device is.
import { useEffect, useRef } from "react";
import { targetCanvasSize, type DeviceId, type DevicePreset } from "@nspanel-sim/ui";
import type { HousingColor } from "./Enclosure";
import { useGlassTouch } from "./panelHooks";
import { RigEnclosure, TouchAreas } from "./panelSurface";
import type { Rig } from "./rig";

export interface GlassViewProps {
  rig: Rig;
  device: DevicePreset;
  deviceId: DeviceId;
  monitorPxPerMm: number;
  housingColor: HousingColor;
  /** outline what takes a touch: every visible component with a box */
  outlines: boolean;
}

export function GlassView({ rig, device, deviceId, monitorPxPerMm, housingColor, outlines }: GlassViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const touch = useGlassTouch(rig, device);
  const target = targetCanvasSize(device, monitorPxPerMm);
  const scale = monitorPxPerMm / device.pxPerMm;
  const { width, height } = rig.glass.frame;
  const { visibleWidthPx, heightPx } = device;

  // the frame, when it changed: whole into the panel's own grid, then the
  // visible part of it packed down to the physical size
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const grid = document.createElement("canvas");
    grid.width = width;
    grid.height = height;
    const gctx = grid.getContext("2d");
    if (!canvas || !ctx || !gctx) return;
    const image = gctx.createImageData(width, height);
    let seen = -1;
    let raf = 0;
    const paint = () => {
      const frame = rig.glass.frame;
      if (frame.version !== seen) {
        seen = frame.version;
        frame.rgba(image.data);
        gctx.putImageData(image, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(grid, 0, 0, visibleWidthPx, heightPx, 0, 0, canvas.width, canvas.height);
      }
      raf = requestAnimationFrame(paint);
    };
    // the first at once: what is on the glass is there before the next frame
    paint();
    return () => cancelAnimationFrame(raf);
  }, [rig, width, height, visibleWidthPx, heightPx, target.widthPx, target.heightPx]);

  return (
    <RigEnclosure rig={rig} device={device} deviceId={deviceId} monitorPxPerMm={monitorPxPerMm} color={housingColor}>
      <div style={{ width: target.widthPx, height: target.heightPx, overflow: "hidden", position: "relative", touchAction: "none", cursor: "pointer" }} {...touch}>
        <canvas ref={canvasRef} width={target.widthPx} height={target.heightPx} style={{ display: "block", width: target.widthPx, height: target.heightPx }} />
        {outlines && (
          <div style={{ position: "absolute", left: 0, top: 0, width: visibleWidthPx, height: heightPx, transform: `scale(${scale})`, transformOrigin: "top left", pointerEvents: "none" }}>
            <TouchAreas rig={rig} />
          </div>
        )}
      </div>
    </RigEnclosure>
  );
}
