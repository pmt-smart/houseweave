// Visual palette — two different origins, not to be confused:
//
// 1. Colours with a REAL RGB565 value, already in production in this
//    project's own Berry code (no approximation at all — it is the exact
//    number that reaches the TFT today): background (bg_color_565 from
//    brain.be, "ha-dark" from the reference implementation's original
//    theme.py), iconOff and iconLowSat
//    (ICON_OFF_COLOR/ICON_LOW_SAT_COLOR from light.be).
//    Converted here with the same RGB565->RGB888 maths as the rest of
//    the project (rgb565.ts), not hex guessed by hand.
// 2. The rest of the palette: a visual approximation eyeballed from the
//    reference screenshots of joBr99's pages — no real value for
//    these is known in our code, and the original .HMI/.tft is closed.
//
// The real background is #181c18 (blue 24, the same as red): converting
// RGB565 in one's head instead of running rgb565ToHex gets the blue channel
// wrong.
import { RAMPS, cssGradient } from "@nspanel-sim/layout";

import { rgb565ToHex } from "./rgb565";

const BG_COLOR_565 = 6371; // brain.be: "ha-dark" (theme.py original)
const ICON_OFF_COLOR_565 = 17299; // light.be: ICON_OFF_COLOR
const ICON_LOW_SAT_COLOR_565 = 65222; // light.be: ICON_LOW_SAT_COLOR
const PLAN_CARD_565 = 10597; // themes/lovelace-jobr99/theme.json: plan-card

// Named BASE_PALETTE and not `theme`: a "theme" in this project is the whole
// document a panel is drawn from (colours, type, icons,
// components), and this is only the colours the panel runs TODAY -- the floor a
// theme's own palette is laid over.
export const BASE_PALETTE = {
  background: rgb565ToHex(BG_COLOR_565),
  cardBackground: "#1b201a",
  cardBorder: "#2a3028",
  textPrimary: "#f2f2f0",
  textSecondary: "#8c948a",
  divider: "#33392f",
  accentBlue: "#2fa8e0",
  // No red is measured off the panel as it runs -- joBr99 draws none. Material
  // red 500, which is what Home Assistant uses for the same job.
  accentRed: "#f44336",
  iconOff: rgb565ToHex(ICON_OFF_COLOR_565),
  iconLowSat: rgb565ToHex(ICON_LOW_SAT_COLOR_565),
  // the lovelace theme's own (themes/lovelace-jobr99/theme.json): the plan's
  // cards, the keyboard's keys and the thermostat's faces
  planCard: rgb565ToHex(PLAN_CARD_565),
} as const;

// HSV -> hex, the same algorithm as light.be:hsv_to_rgb565 (h/s/v in
// 0..1), only returning CSS hex instead of RGB565, for the simulator.
// The colour logic is the real bulb's, not a reinvention.
export function hsvToHex(h: number, s: number, v: number): string {
  let r: number, g: number, b: number;
  if (s <= 0) {
    r = g = b = v;
  } else {
    const hh = h * 6;
    const i = Math.floor(hh);
    const f = hh - i;
    const p = v * (1 - s);
    const q = v * (1 - s * f);
    const t = v * (1 - s * (1 - f));
    switch (i % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      default: r = v; g = p; b = q; break;
    }
  }
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Track gradients for the horizontal LightDetail sliders — they show the
// whole dimension (black->colour, cool->warm, full hue) instead of a
// single-colour fill up to the current value: the bar itself changes
// colour, brightness or temperature.
// A visual approximation, not a measured value — category 2 from the
// comment above.
// DERIVED from the stops in `@nspanel-sim/layout`'s RAMPS, so the browser's
// gradient and the picture compiled into the `.tft` are not two declarations of
// one ramp. The stops are the declaration; this is one of its two renderings.
export const CT_GRADIENT = cssGradient(RAMPS["color-temp"]);
export const HUE_GRADIENT = cssGradient(RAMPS.hue);
export const BRIGHTNESS_GRADIENT = cssGradient(RAMPS.brightness);

// Same threshold as light.be: sat < 25/254 uses the fallback yellow
// instead of the computed colour (avoids a near-white, invisible icon).
const ICON_LOW_SAT_THRESHOLD_254 = 25;

/**
 * The bulb icon's colour, the same rule light.be applies on the panel. Takes the
 * palette rather than reading the module's own, so a screen drawn in another
 * theme's colours gets ITS "off" and "low saturation" instead of this
 * one's -- the two are real RGB565 values, and which one is right depends on the
 * theme, not on this file.
 */
export function lightIconColor(
  power: number,
  hue254: number,
  sat254: number,
  palette: { iconOff: string; iconLowSat: string } = BASE_PALETTE,
): string {
  if (power === 0) return palette.iconOff;
  if (sat254 < ICON_LOW_SAT_THRESHOLD_254) return palette.iconLowSat;
  return hsvToHex(hue254 / 254, sat254 / 254, 1);
}
