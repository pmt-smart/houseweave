// The display's device-pixel ratio, kept current.
//
// Needed because a bitmap font only looks right at a WHOLE number of device
// pixels per panel pixel, and on the machine this was found on the ratio is
// 1.25: at that ratio four panel pixels out of five get one device pixel and
// the fifth gets two, so a glyph comes out ragged instead of merely square.
// Knowing the ratio is what lets `integerDeviceScale` round the zoom to a whole
// number of device pixels and then size the element to match. Sizing the backing
// store in device pixels is NOT on its own enough -- that only moves the
// resampling from the browser into our own `drawImage`.
//
// It changes while the page is open (the window moves to another monitor, the
// user zooms), so it is watched rather than read once.
import { useEffect, useState } from "react";

export function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1));
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    let media: MediaQueryList | undefined;
    const watch = () => {
      if (cancelled) return;
      const next = window.devicePixelRatio || 1;
      setDpr(next);
      // the query only fires once, for the ratio it was made with, so it is
      // remade after each change
      media = window.matchMedia(`(resolution: ${next}dppx)`);
      media.addEventListener("change", watch, { once: true });
    };
    watch();
    return () => {
      cancelled = true;
      media?.removeEventListener("change", watch);
    };
  }, []);
  return dpr;
}
