// The light card's gesture, headless.
//
// It lives apart from any drawing because it is not a look: it is what the
// PANEL does. On the glass the pair is Touch Press plus Touch Release on one
// Nextion component -- two separate checkboxes in the Editor, and only one is
// usually on. A theme that reimplemented this and forgot the
// second event would ship a card whose detail screen is unreachable on hardware,
// and nobody would find out in a browser.
//
// So every theme's card uses this one. What they vary is what the card
// looks like while it happens.
import { useEffect, useRef } from "react";

/**
 * How long the finger has to stay down for the press to mean "open the
 * detail" instead of "toggle". 500 ms is the platform convention
 * (Android's ViewConfiguration long-press timeout), which matters here
 * because the gesture is invisible: the only thing telling a user how
 * long to hold is what every other device taught them.
 */
const LONG_PRESS_MS = 500;

/**
 * The card's two gestures as pointer handlers: a short press toggles, a
 * press held for LONG_PRESS_MS opens the detail. "pressing" while the
 * timer is still running, "long" once it has fired; releasing only
 * toggles from "pressing", so the long press never also toggles on the
 * way up, and leaving the target cancels both. Shared with the donor
 * layout's card (screens/donor/HomeDonor.tsx): the gesture is a product
 * decision, the box it lives in is not.
 */
export function useLightPressGesture(onShortPress: () => void, onLongPress: () => void) {
  const press = useRef<"idle" | "pressing" | "long">("idle");
  const timer = useRef<number | undefined>(undefined);

  const cancel = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    press.current = "idle";
  };
  useEffect(() => cancel, []);

  return {
    onPointerDown: () => {
      press.current = "pressing";
      timer.current = window.setTimeout(() => {
        if (press.current !== "pressing") return;
        press.current = "long";
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onPointerUp: () => {
      const wasPressing = press.current === "pressing";
      cancel();
      if (wasPressing) onShortPress();
    },
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  };
}
