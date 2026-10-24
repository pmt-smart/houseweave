import { useEffect, useState } from "react";

// devicePixelRatio changes live when the user zooms the browser
// (Ctrl+scroll) or changes OS scaling — and there is no dedicated event
// for it. The standard trick is a media query matched to the CURRENT
// value: it stops matching the moment the value changes, firing
// `change`. Then it re-registers for the new value. That is why the
// effect depends on `dpr` — each value needs its own query.
//
// This is what keeps the calibration valid without recalibrating:
// consumers convert PPI -> CSS px per mm by dividing by this number (see
// ui/src/devicePreviewMath.ts:cssPxPerMmFromPpi).
export function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);

  useEffect(() => {
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const onChange = () => setDpr(window.devicePixelRatio || 1);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [dpr]);

  return dpr;
}
