import { useState } from "react";
import { DEFAULT_MONITOR_PPI } from "@nspanel-sim/ui";

// Real physical size calibration — shared between the screens (the
// Panel tab's views) and Enclosure (the housing), so both scale
// consistently. See
// ui/src/devicePreviewMath.ts for why it has to be manual (short
// version: no browser API gives physical size, by privacy design).
//
// TWO numbers, and only one of them is stored:
//
//   ppi           the monitor's physical pixel density. Invariant: it
//                 does not change with zoom or with OS scaling, so it
//                 is the thing worth persisting.
//   referenceDpr  the devicePixelRatio the drawing is anchored to.
//                 Deliberately NOT persisted — see below.
//
// Why an anchor at all: dividing by the LIVE devicePixelRatio keeps the
// panel physically correct at every zoom, which sounds right and is
// horrible to use — the panel then cancels the zoom exactly, so Ctrl+=
// grows the whole page except the one thing you were trying to inspect.
// Dividing by a fixed anchor lets the panel scale with the page like
// any other element.
//
// Why the anchor is not stored: devicePixelRatio is OS scaling TIMES
// browser zoom, and nothing in the platform separates them. An anchor
// captured while the page happened to be zoomed — or on a monitor with
// different scaling — is wrong, and persisting it makes a transient
// mistake permanent: the panel comes back small every session with no
// hint why. Captured per load instead, the worst case lasts until the
// next reload, and reloading at 100% zoom is always right.
//
// Calibrating re-anchors immediately, and SettingsTab shows the anchor
// against the live value so a drift is visible rather than mysterious.

const PPI_KEY = "nspanel-sim.monitor-ppi";

export interface Calibration {
  ppi: number;
  referenceDpr: number;
}

function loadPpi(): number {
  try {
    const v = window.localStorage.getItem(PPI_KEY);
    const n = v ? parseFloat(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_MONITOR_PPI;
  } catch {
    return DEFAULT_MONITOR_PPI;
  }
}

function savePpi(ppi: number) {
  try {
    window.localStorage.setItem(PPI_KEY, String(ppi));
  } catch {
    // localStorage unavailable (private window etc.) — the calibration just does not persist
  }
}

export interface CalibrationControls {
  calibration: Calibration;
  /** Stores a measurement and anchors it to the zoom it was taken at. */
  calibrate: (ppi: number, dpr: number) => void;
  /** Keeps the measurement, moves the anchor to the current zoom. */
  reanchor: (dpr: number) => void;
}

export function useMonitorCalibration(): CalibrationControls {
  const [ppi, setPpi] = useState(loadPpi);
  // Read once, on purpose. Making this live would put the panel back to
  // cancelling the zoom.
  const [referenceDpr, setReferenceDpr] = useState(() => window.devicePixelRatio || 1);

  const calibrate = (nextPpi: number, dpr: number) => {
    const value = Number.isFinite(nextPpi) && nextPpi > 0 ? nextPpi : DEFAULT_MONITOR_PPI;
    setPpi(value);
    savePpi(value);
    setReferenceDpr(Number.isFinite(dpr) && dpr > 0 ? dpr : 1);
  };

  const reanchor = (dpr: number) => setReferenceDpr(Number.isFinite(dpr) && dpr > 0 ? dpr : 1);

  return { calibration: { ppi, referenceDpr }, calibrate, reanchor };
}
