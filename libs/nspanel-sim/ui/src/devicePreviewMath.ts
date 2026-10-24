// Pure maths for the "device view" — real physical size calibration and
// the target size in CSS px. No DOM or canvas here on purpose (that
// lives in sim/, which is what knows how to rasterise); this part is
// only numbers, testable and reusable.
//
// WHY MANUAL CALIBRATION IS NEEDED
//
// No browser API reports the monitor's physical size, and that is a
// deliberate vendor position rather than a gap to be filled: PPI
// combined with resolution is close to a unique identifier, so exposing
// it would feed fingerprinting. Verified in Chrome:
//
//   - The CSS "physical" units are fake. `1in` measures exactly 96px
//     and `100mm` exactly 377.95px, by definition in the spec (the
//     pixel is the anchor unit for screen media). They bear no relation
//     to the glass.
//   - `window.screen` only has width/height/avail*/colorDepth/
//     orientation — all in CSS px, nothing physical.
//   - `devicePixelRatio` is the CSS-px:device-px ratio. It says how much
//     the OS or zoom is scaling, not the panel's density.
//   - The Window Management API (`ScreenDetailed`), the newest of the
//     family, exposes left/top/isPrimary/isInternal/devicePixelRatio/
//     label. No physical property at all.
//
// So calibration goes through a reference object: the user holds
// something of standardised size against the screen and adjusts until
// it matches. The standard used here is ISO/IEC 7810 ID-1 — bank card,
// driving licence, ID card, work badge — 85.60 x 53.98 mm, to
// hundredth-of-a-millimetre tolerance. It is the same technique behind
// any "actual size" ruler on the web, and the reference beats the
// monitor diagonal for three reasons: it does not depend on the user
// knowing the monitor's spec sheet (vendors advertise a rounded
// "class"), it does not depend on `window.screen` (which proved
// unreliable in this project, returning 0x0), and it measures exactly
// the quantity used when rendering instead of deriving it through
// Pythagoras.
//
// What gets stored is the panel's PHYSICAL PPI (device px per inch),
// not CSS px per mm. PPI is invariant: it does not change with browser
// zoom or OS scaling, which is precisely what `devicePixelRatio`
// absorbs. Calibrating once is enough forever on that monitor.

import type { DevicePreset } from "./devices";

/** ISO/IEC 7810 ID-1 — bank card / driving licence / ID card. Nominal, in mm. */
export const ID1_CARD_WIDTH_MM = 85.6;
export const ID1_CARD_HEIGHT_MM = 53.98;

/**
 * Starting PPI when nobody has calibrated yet: 96, the value CSS itself
 * assumes (`1in` == 96px). Dead on for a ~96 PPI monitor with coherent
 * OS scaling — the common desktop case, and exactly the Dell P2317H
 * (1920x1080 at 23", 95.8 PPI). Badly wrong on a HiDPI laptop. A
 * starting guess, not a measurement.
 */
export const DEFAULT_MONITOR_PPI = 96;

/**
 * CSS px per mm of glass. Divides by the CURRENT devicePixelRatio, and
 * that is why the calibration survives zoom: zooming the browser
 * multiplies the dpr and grows the CSS px in the same proportion, so the
 * quotient stays correct without recalibrating.
 */
export function cssPxPerMmFromPpi(monitorPpi: number, devicePixelRatio: number): number {
  return monitorPpi / devicePixelRatio / 25.4;
}

/**
 * The inverse, used by the calibration: the user adjusted something
 * until it really measured `realMm`, and that took up `cssPx` CSS px on
 * the page. Multiplying by the dpr converts back to device px, which is
 * what makes the resulting PPI invariant to zoom and scaling.
 */
export function ppiFromCssPxMeasurement(
  cssPx: number,
  realMm: number,
  devicePixelRatio: number,
): number {
  return (cssPx / realMm) * devicePixelRatio * 25.4;
}

export interface PhysicalSizeMm {
  widthMm: number;
  heightMm: number;
}

// The PHYSICAL size of the device's visible area, in mm. A hardware
// constant — it does not depend on the monitor or on the calibration.
// It serves two purposes: feeding targetCanvasSize, and telling the
// user in the interface what they should find if they measure the
// screen with a ruler. Since the calibration is a value the user sets
// (see the top of this file), that check is the only way to know
// whether it is right.
export function physicalScreenSizeMm(device: DevicePreset): PhysicalSizeMm {
  return {
    widthMm: device.visibleWidthPx / device.pxPerMm,
    heightMm: device.heightPx / device.pxPerMm,
  };
}

export interface TargetCanvasSize {
  widthPx: number;
  heightPx: number;
}

// The size in CSS px that reproduces the device's real PHYSICAL size on
// the user's screen. Since the panel (device.pxPerMm, ~6.5) is usually
// denser than the monitor (monitorPxPerMm), this normally reduces the
// pixel count — packing several device pixels into each monitor pixel,
// not enlarging.
//
// Uses `visibleWidthPx`, not `widthPx`: the real physical size is that
// of the AREA VISIBLE through the bezel, which can be smaller than the
// full logical grid (see devices.ts). Whoever draws
// (sim/GlassView) is responsible for CROPPING the source to
// `visibleWidthPx` before scaling to this size — not for drawing the
// whole grid and covering the excess afterwards, which leaves the
// screen looking off-centre inside the housing (the right bezel wider than
// the left).
export function targetCanvasSize(device: DevicePreset, monitorPxPerMm: number): TargetCanvasSize {
  const { widthMm, heightMm } = physicalScreenSizeMm(device);
  return {
    widthPx: Math.max(1, Math.round(widthMm * monitorPxPerMm)),
    heightPx: Math.max(1, Math.round(heightMm * monitorPxPerMm)),
  };
}
