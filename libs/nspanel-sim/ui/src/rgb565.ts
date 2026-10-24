// RGB565 — the Nextion's real colour depth (16 bits: 5R 6G 5B).
// berry/light.be and berry/brain.be already compute
// this to send colour to the TFT (ICON_OFF_COLOR=17299,
// bg_color_565=6371, etc.) — this is the same conversion in TS, used in
// two places:
//   1. sim/: quantising the "device view" preview, to show the gradient
//      banding that would really appear on the hardware.
//   2. export/: generating the real colour values that go into the
//      Nextion commands and into the `.HMI` the Editor compiles.

export function hexToRgb565(hex: string): number {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
}

export function rgb565ToHex(value: number): string {
  const r5 = (value >> 11) & 0x1f;
  const g6 = (value >> 5) & 0x3f;
  const b5 = value & 0x1f;
  // Expand back to 8 bits per channel (the same bit-replication technique
  // any RGB565->RGB888 converter uses, so the colour is not darkened).
  const r8 = (r5 << 3) | (r5 >> 2);
  const g8 = (g6 << 2) | (g6 >> 4);
  const b8 = (b5 << 3) | (b5 >> 2);
  const toHex = (x: number) => x.toString(16).padStart(2, "0");
  return `#${toHex(r8)}${toHex(g8)}${toHex(b8)}`;
}

/**
 * RGB565 -> the three 8-bit channels, which is what a canvas wants. Same
 * bit-replication as `rgb565ToHex`, without going through a string: drawing a
 * glyph blends per pixel, and parsing "#rrggbb" once per pixel is absurd.
 */
export function rgb565ToRgb(value: number): { r: number; g: number; b: number } {
  const r5 = (value >> 11) & 0x1f;
  const g6 = (value >> 5) & 0x3f;
  const b5 = value & 0x1f;
  return { r: (r5 << 3) | (r5 >> 2), g: (g6 << 2) | (g6 >> 4), b: (b5 << 3) | (b5 >> 2) };
}

// Rounds a hex colour to the nearest value representable in RGB565 —
// this is what reveals the gradient banding a 24-bit browser would not
// show on its own.
export function quantizeToRgb565(hex: string): string {
  return rgb565ToHex(hexToRgb565(hex));
}

// Per-channel versions in pure integers (no string round-trip), for
// quantising a whole ImageData (hundreds of thousands of pixels) without
// paying hexToRgb565/rgb565ToHex per pixel. Same maths as the two
// functions above, just operating directly on the 0-255 channel.
export function quantizeChannel5(v: number): number {
  const q = v >> 3;
  return (q << 3) | (q >> 2);
}

export function quantizeChannel6(v: number): number {
  const q = v >> 2;
  return (q << 2) | (q >> 4);
}
