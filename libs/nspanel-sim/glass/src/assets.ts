// The fonts and pictures a scenario names, as the glass holds them: a .zi
// read by the exporter's reader, and a generated picture's pixels from the
// same function the generator compiles it with (layout/src/paint.ts).
import { readZi, type ZiFont } from "@nspanel-sim/export";
import { picturePixels, type PictureSpec } from "@nspanel-sim/layout";
import type { Picture } from "./glass.js";

export function fontOf(bytes: Uint8Array): ZiFont {
  return readZi(bytes);
}

export function pictureOf(spec: Record<string, unknown>): Picture {
  const le = picturePixels(spec as unknown as PictureSpec);
  const pixels = new Uint16Array(le.length / 2);
  for (let i = 0; i < pixels.length; i++) pixels[i] = le[2 * i] | (le[2 * i + 1] << 8);
  return { width: Number(spec.width), height: Number(spec.height), pixels };
}
