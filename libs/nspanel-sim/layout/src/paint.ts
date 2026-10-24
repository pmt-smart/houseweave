// What a component wants to paint with, when a colour attribute cannot say it.
//
// A Nextion Slider has `bco` and `pco` and nothing else: one flat colour for the
// track, one for the pointer. There is no gradient attribute, no opacity, no
// second stop. So a gradient is not a colour on this hardware -- it is a
// PICTURE, and the only way to get one is to generate the pixels and let the
// Editor compile them into the `.tft`.
//
// That makes "gradient" the first of a family: a look the glass can hold but the
// attribute set cannot express, bought with bytes. The mechanism here is meant
// to serve the rest of that family too, so the next one is a new `Paint` and a
// new generator, not a new mechanism.
//
// WHERE THE BYTES GO. The Editor compresses a picture when a human IMPORTS it
// through its dialog (joBr99's 335x44 track costs 3 144 bytes against 29 480 raw),
// and copies an `.HMI` blob into the `.tft` untouched, so a generated picture that
// never went through an import would cost exactly w*h*2 + 20 bytes. The exporter
// writes the screen's own codec instead (`export/src/pictureCodec.ts`). It pays 21 bytes per
// block of up to eight RUNS of one colour, so what a picture costs is its
// colour changes per row, not its pixels:
//
//   brightness 420x32, flat      6 240 B   (0.23)     bands of ~7 px are runs
//   brightness 420x32, dithered 25 980 B   (0.97)     dither breaks every run
//   colour-temp 420x32, flat     5 358 B   (0.20)
//   hue 420x32, flat            21 612 B   (0.80)     250 colours: busy by nature
//   switch 58x32                 1 578 B   (0.42)
//
// So DITHER IS THE EXPENSIVE OPTION, by 4x on a brightness track, and
// it is a rendering choice -- the codec itself is lossless and always picks the
// smaller form. The default (`defaultDither`) turns it on where it makes sense
// and only there: a ramp it can help (brightness, colour-temp; never hue) at a
// width where the bands would show (`autoDither`). A placement overrides it
// with `render.dither`, and the build log prints what each picture cost.
//
// The pixel-count levers, which apply before the codec sees anything:
//
//   1. THE RAMP IS THE TRACK, NOT THE PLACEMENT. A slider placed in a 420x78
//      box draws a 32-pixel rail; the rest is finger room, and the picture
//      carries it as rows of the page's colour (`RampPicture.band`). A Nextion
//      Slider takes its touch where its box is, so a picture of the rail alone
//      would leave the "finger room" taking no finger at all -- a 32 px (4.9 mm)
//      target, 12 px (1.8 mm) for a compact one. Through the codec a flat row is
//      one block of 21 bytes, so the room costs about a
//      kilobyte a slider, and the finger gets the 12 mm the placement promised.
//   2. ONE PICTURE FOR BOTH HALVES. A Slider draws `pic1` from the minimum to the
//      value and `pic` from the value to the maximum; pointing both at the same
//      picture shows the whole ramp at every value -- which is the look the React
//      slider draws -- and halves the cost. (joBr99 does this on his 120x12
//      sliders and not on his 335x44 ones, which is why those carry two blobs.)
//   3. DEDUPLICATE. Two sliders asking for the same ramp at the same size are one
//      picture. `pictureKey` is what makes that automatic.
//
// Together those are worth about 6x on the light detail screen: three rails at
// 420x32 cost 80.7 kB, where three placements at 420x98 with two pictures each
// would have cost 494 kB.
//
// Nextion does not scale a picture, so the width is whatever the project drew
// and is not ours to shrink: a 335x43 Slider takes a 335x44 picture and a 120x12
// one takes 120x12.

/** A stop on a ramp: `at` in 0..1, `rgb` as 0xRRGGBB. */
export interface GradientStop {
  at: number;
  rgb: number;
}

/**
 * A left-to-right ramp.
 *
 * Horizontal only, and that is a hardware statement rather than a missing
 * feature: the sliders this exists for are horizontal, and a vertical ramp of
 * the same look would cost exactly the same bytes with the rows transposed --
 * so it can be added the day a component wants one, with no new thinking.
 */
export interface Gradient {
  stops: GradientStop[];
}

/**
 * The ramps by NAME, because a hue wheel is not a theme token.
 *
 * Rule 2 of `node.ts` says a layout names a colour and never spells one out, and
 * this is how that rule survives contact with a gradient: the layout names a
 * RAMP, and both renderers resolve the name. The stops here are the physics and
 * the product decisions behind each slider, in one place -- `ui/src/basePalette.ts`
 * derives its CSS from these, so the browser and the generated picture cannot
 * drift.
 */
export type RampId = "brightness" | "color-temp" | "hue";

export const RAMPS: Record<RampId, Gradient> = {
  // Black to white only. It deliberately does NOT fold in the light's hue and
  // saturation: a brightness slider should say darker and lighter and nothing
  // else.
  brightness: { stops: [{ at: 0, rgb: 0x000000 }, { at: 1, rgb: 0xffffff }] },
  // ctMin (cool) -> ctMax (warm), the same direction as lightMath.ts's
  // `ctRawToDisplayPct`, so the slider and the number agree about which end is
  // which.
  "color-temp": { stops: [{ at: 0, rgb: 0xaed9ff }, { at: 1, rgb: 0xffb74d }] },
  // hue 0..254, the sequence the colour wheel used before it was a bar
  hue: {
    stops: [
      { at: 0 / 6, rgb: 0xff0000 },
      { at: 1 / 6, rgb: 0xffff00 },
      { at: 2 / 6, rgb: 0x00ff00 },
      { at: 3 / 6, rgb: 0x00ffff },
      { at: 4 / 6, rgb: 0x0000ff },
      { at: 5 / 6, rgb: 0xff00ff },
      { at: 6 / 6, rgb: 0xff0000 },
    ],
  },
};

/**
 * Which ramps dither is worth anything on.
 *
 * Dither has a price in the codec: the two ramps with FEW colours (brightness passes through 64 greys, colour-temp
 * through 42) band visibly on RGB565 and are worth the smoother look at about
 * 4x the bytes; hue passes through 250 colours and changes almost every pixel
 * anyway, so dither would only add noise and buy nothing -- it is never
 * dithered by default, whatever its width.
 */
export const RAMP_DITHER: Record<RampId, boolean> = {
  brightness: true,
  "color-temp": true,
  hue: false,
};

/**
 * The dither a ramp gets when the placement says `"auto"` or nothing: on where
 * it makes sense, and only there. Two conditions, both needed -- the ramp is
 * one dither can help (`RAMP_DITHER`), AND the track is wide enough for the
 * bands to show (`autoDither`: a colour step under 4 px reads as a gradient
 * already, so a 200-px brightness track stays flat and pays nothing).
 * `render.dither: true|false` on the placement overrides both.
 */
export function defaultDither(ramp: RampId, width: number): boolean {
  return RAMP_DITHER[ramp] && autoDither(ramp, width);
}

/**
 * What a component paints a surface with.
 *
 * `groove` is a thin stripe down the middle of a box that is much wider than
 * it -- a scrollbar's track inside the touch area around it. The box is what
 * the finger needs (12 mm), the stripe is what the eye needs (a few pixels),
 * and a Nextion Slider has one rectangle for both: its `bco` would paint the
 * whole 78 px. So the stripe is a generated picture of the whole box, page
 * colour everywhere but the stripe.
 */
export type Paint =
  | { kind: "solid"; color: string }
  /**
   * `height` is the drawn track's, centred across the box: the rest of the box
   * is touch and the page's colour. Absent, the ramp fills the box.
   */
  | { kind: "ramp"; ramp: RampId; height?: number }
  | { kind: "groove"; color: string; width: number };

/** The ramp as CSS, for the React column. One declaration, two renderings. */
export function cssGradient(gradient: Gradient): string {
  const stops = gradient.stops
    .map((s) => `#${s.rgb.toString(16).padStart(6, "0")} ${(s.at * 100).toFixed(4).replace(/\.?0+$/, "")}%`)
    .join(", ");
  return `linear-gradient(to right, ${stops})`;
}

/** The colour at `t` (0..1) along a ramp, as 0xRRGGBB. Linear between stops, like CSS. */
export function sampleGradient(gradient: Gradient, t: number): number {
  const stops = gradient.stops;
  const at = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < stops.length - 2 && stops[i + 1].at < at) i++;
  const a = stops[i];
  const b = stops[i + 1] ?? a;
  const span = b.at - a.at;
  const k = span <= 0 ? 0 : (at - a.at) / span;
  const mix = (shift: number) => {
    const ca = (a.rgb >> shift) & 0xff;
    const cb = (b.rgb >> shift) & 0xff;
    return Math.round(ca + (cb - ca) * k);
  };
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

export interface RampPicture {
  kind: "ramp";
  ramp: RampId;
  width: number;
  height: number;
  /**
   * Rounded ends, in panel pixels, painted INTO the picture.
   *
   * A Nextion Slider has no corner radius, so the React pill and the compiled
   * rectangle were going to be different shapes -- one more thing the browser
   * could show and the glass could not. But we are generating the pixels
   * anyway, and a corner costs the same bytes whether it is square or round:
   * the picture simply carries the page's own colour where the pill does not
   * reach. So the radius comes back for free, and it is the clearest example of
   * what this whole mechanism is for.
   *
   * The cost is not quite zero -- the anti-aliased edge is the only part of the
   * image the codec cannot run-length -- but it is a few dozen pixels at the two
   * ends, against a track thousands of pixels wide.
   */
  radius: number;
  /** what surrounds the pill, as 0xRRGGBB: the page's ground, resolved by the caller */
  background: number;
  /**
   * How many rows the ramp takes, centred in `height`; the rows above and below
   * are the page's ground, and the radius rounds the band. Absent, every row is
   * the ramp. It is how a slider's box is its whole placement -- the Slider
   * takes its touch where its box is -- while the eye still sees a 32 px rail.
   */
  band?: number;
  /**
   * Whether these pixels are dithered. Part of the identity, so two specs that
   * differ only here are two pictures and never share an id.
   *
   * A caller that does not want to decide asks `defaultDither` (which is what
   * the compile step does): on where it helps and the bands would show, never
   * on hue. Which one LOOKS right is a judgement. What each COSTS is the
   * codec's (export/src/pictureCodec.ts): it pays for runs of one colour, and
   * dither breaks every run. Measured on a 420x32 brightness track: 6 240 bytes
   * flat, 25 980 dithered -- 4x for the smoother look. Read the price in
   * `scripts/build-picture-cost.mjs` before deciding for a new ramp.
   */
  dither: boolean;
}

/**
 * A switch rail with its knob drawn INTO it, which is the only way a Nextion can
 * show one.
 *
 * A dual-state Button has two fill colours and nothing else: no rail, no knob,
 * no radius. Left to the attribute set, every theme's switch is the same
 * two-colour rectangle -- and the three here draw genuinely different controls
 * (Material's 58-pixel rocker, shadcn's short bordered rail, Tailwind's big
 * filled pill). So the shape is generated, one picture per state, and the
 * ButtonT names them in `pic` and `pic2`.
 *
 * Two pictures per switch: a 58x32 pair is 7 464 bytes raw, 3 156 through the
 * Editor's codec (ratio 0.42 -- a rail is mostly runs, the knob's edge is not).
 * That is the price of the control looking like the design instead of like the
 * attribute set, and it is the same trade the gradient track makes.
 */
export interface SwitchPicture {
  kind: "switch";
  width: number;
  height: number;
  /** the rail's corner radius; half the height is a pill */
  radius: number;
  /** which end the knob sits at: `off` on the left, `on` on the right */
  side: "left" | "right";
  /** 0xRRGGBB, resolved from tokens by the caller */
  track: number;
  knob: number;
  background: number;
}

/**
 * A scrollbar's track: a rounded stripe centred across a wider box.
 *
 * Cheap by construction, which is the reason it is a picture and not a second
 * component under the slider: every row is the same three runs (page, stripe,
 * page) except the few at the rounded ends, and the codec pays per run
 * (`pictureCodec.ts`). A second component would also overlap the slider, and
 * on the glass the topmost component takes the touch.
 */
export interface GroovePicture {
  kind: "groove";
  width: number;
  height: number;
  /** the stripe's own width, centred in `width` */
  stripe: number;
  /** 0xRRGGBB, resolved from tokens by the caller */
  color: number;
  background: number;
}

export type PictureSpec = RampPicture | SwitchPicture | GroovePicture;

/**
 * The widest a band may be before the eye calls it a band.
 *
 * A pixel on this panel is 0.146 mm (480 px across 70 mm of glass), so four of
 * them is a shade over half a millimetre. A step that narrow reads as a
 * gradient at arm's length; a ten-pixel step reads as a stripe, which is what
 * the brightness ramp does undithered.
 */
const BAND_LIMIT_PX = 4;

/**
 * Should this ramp be dithered at this size?
 *
 * Yes only when quantising to RGB565 would leave visible bands -- that is, when
 * the ramp has fewer distinct colours than the picture has room for steps. It is
 * counted rather than assumed, because the answer is not a property of the ramp
 * alone: the same hue wheel at 60 pixels wide IS banded, and the same brightness
 * ramp at 40 pixels wide is not.
 */
export function autoDither(ramp: RampId, width: number): boolean {
  const gradient = RAMPS[ramp];
  const seen = new Set<number>();
  for (let x = 0; x < width; x++) {
    const rgb = sampleGradient(gradient, width === 1 ? 0 : x / (width - 1));
    seen.add(
      ((((rgb >> 16) & 0xff) >> 3) << 11) | ((((rgb >> 8) & 0xff) >> 2) << 5) | ((rgb & 0xff) >> 3),
    );
  }
  return seen.size * BAND_LIMIT_PX < width;
}

/**
 * The identity of a picture, for deduplication.
 *
 * Two sliders on the same page asking for the same ramp at the same size are one
 * picture in the `.HMI` and one blob in the `.tft`. Without this the light
 * detail screen would carry three ramps where it needs three, but a screen with
 * two brightness sliders would carry the same pixels twice.
 */
const hex = (v: number) => v.toString(16).padStart(6, "0");

export function pictureKey(spec: PictureSpec): string {
  const size = `${spec.width}x${spec.height}`;
  if (spec.kind === "switch")
    return ["switch", size, `r${spec.radius}`, spec.side, hex(spec.track), hex(spec.knob), hex(spec.background)].join("-");
  if (spec.kind === "groove")
    return ["groove", size, `s${spec.stripe}`, hex(spec.color), hex(spec.background)].join("-");
  const band = spec.band !== undefined && spec.band < spec.height ? [`b${spec.band}`] : [];
  return [spec.ramp, size, ...band, `r${spec.radius}`, `bg${hex(spec.background)}`, spec.dither ? "dither" : "flat"].join("-");
}

/**
 * The pixels, as RGB565 little-endian -- the format the `.HMI` carries in its
 * `.i` entry and the panel holds in memory.
 *
 * Every row is identical, because the ramp is horizontal. It is written out in
 * full anyway: the codec charges per row (measured), and nothing in the file
 * format lets a picture declare that it repeats.
 *
 * The 4x4 ordered (Bayer) dither is the classic one. It spreads the quantisation
 * error spatially rather than accumulating it along the row, so a band edge
 * turns into a stipple instead of a step -- and it does it deterministically,
 * which matters here because a picture that changed between two runs would
 * defeat the deduplication and make every rebuild a different `.tft`.
 */
const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/**
 * How much of the pixel at (x, y) is inside a rounded rectangle.
 *
 * 1 well inside, 0 well outside, and a fraction on the edge -- sampled on a 4x4
 * grid, which is enough for a 16-pixel radius and cheap enough to run per pixel.
 * Without it the corner is a staircase, and a staircase is what a 32-pixel-tall
 * pill looks worst as.
 */
function roundedCoverage(x: number, y: number, w: number, h: number, radius: number): number {
  const r = Math.min(radius, w / 2, h / 2);
  if (r <= 0) return 1;
  let inside = 0;
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const px = x + (sx + 0.5) / 4;
      const py = y + (sy + 0.5) / 4;
      // distance to the nearest corner circle's centre, clamped into the middle
      // band where the shape is a plain rectangle
      const cx = Math.min(Math.max(px, r), w - r);
      const cy = Math.min(Math.max(py, r), h - r);
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= r * r) inside++;
    }
  }
  return inside / 16;
}

/** RGB565 little-endian pixels for any generated picture. */
export function picturePixels(spec: PictureSpec): Uint8Array {
  if (spec.kind === "switch") return switchPixels(spec);
  if (spec.kind === "groove") return groovePixels(spec);
  return rampPixels(spec);
}

/**
 * The stripe, pill-ended, blended against the page: one rounded rectangle of
 * `stripe` x `height` centred across the box. The ends are the only rows that
 * differ, so the picture compresses to almost nothing.
 */
export function groovePixels(spec: GroovePicture): Uint8Array {
  const { width, height, color, background } = spec;
  const stripe = Math.max(1, Math.min(spec.stripe, width));
  const left = Math.floor((width - stripe) / 2);
  const out = new Uint8Array(width * height * 2);
  const ch = (c: number, shift: number) => (c >> shift) & 0xff;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cover = roundedCoverage(x - left, y, stripe, height, stripe / 2);
      let v = 0;
      for (const shift of [16, 8, 0]) {
        const mixed = ch(background, shift) * (1 - cover) + ch(color, shift) * cover;
        const bits = shift === 8 ? 6 : 5;
        v = (v << bits) | Math.min((1 << bits) - 1, Math.round(mixed) >> (8 - bits));
      }
      const i = (y * width + x) * 2;
      out[i] = v & 0xff;
      out[i + 1] = v >> 8;
    }
  }
  return out;
}

/**
 * The rail, and the knob inside it.
 *
 * Drawn as two rounded rectangles blended against the page: the rail in the
 * track colour, the knob in its own, inset by the same margin at both ends so
 * the two states are mirror images. Anti-aliased on both shapes -- a knob with a
 * staircase edge is the first thing that gives a generated control away.
 */
export function switchPixels(spec: SwitchPicture): Uint8Array {
  const { width, height, radius, side, track, knob, background } = spec;
  const inset = Math.max(1, Math.round(height * 0.12));
  const knobD = Math.max(2, height - inset * 2);
  const knobX = side === "left" ? inset : Math.max(inset, width - inset - knobD);
  const out = new Uint8Array(width * height * 2);
  const ch = (c: number, shift: number) => (c >> shift) & 0xff;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rail = roundedCoverage(x, y, width, height, radius);
      const dot = roundedCoverage(x - knobX, y - inset, knobD, knobD, knobD / 2);
      let v = 0;
      for (const shift of [16, 8, 0]) {
        // page under rail under knob, in that order
        const base = ch(background, shift) * (1 - rail) + ch(track, shift) * rail;
        const mixed = base * (1 - dot) + ch(knob, shift) * dot;
        const bits = shift === 8 ? 6 : 5;
        const max = (1 << bits) - 1;
        v = (v << bits) | Math.min(max, Math.round(mixed) >> (8 - bits));
      }
      const i = (y * width + x) * 2;
      out[i] = v & 0xff;
      out[i + 1] = v >> 8;
    }
  }
  return out;
}

export function rampPixels(spec: RampPicture): Uint8Array {
  const gradient = RAMPS[spec.ramp];
  const { width, height, dither, radius, background } = spec;
  // the rows the ramp takes, centred; the others are the page's ground
  const band = Math.max(1, Math.min(height, spec.band ?? height));
  const top = Math.floor((height - band) / 2);
  const bgR = (background >> 16) & 0xff;
  const bgG = (background >> 8) & 0xff;
  const bgB = background & 0xff;
  const out = new Uint8Array(width * height * 2);
  for (let x = 0; x < width; x++) {
    const rgb = sampleGradient(gradient, width === 1 ? 0 : x / (width - 1));
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = rgb & 0xff;
    for (let y = 0; y < height; y++) {
      const inBand = y >= top && y < top + band;
      const cover = inBand ? roundedCoverage(x, y - top, width, band, radius) : 0;
      const mr = r * cover + bgR * (1 - cover);
      const mg = g * cover + bgG * (1 - cover);
      const mb = b * cover + bgB * (1 - cover);
      // 5, 6 and 5 bits: the error a channel can carry is 7, 3 and 7 of 255.
      // The rows off the band are the page itself and stay one run each.
      const t = dither && inBand ? BAYER_4X4[y & 3][x & 3] : 0;
      const r5 = Math.min(31, (mr + ((t * 8) >> 4)) >> 3);
      const g6 = Math.min(63, (mg + ((t * 4) >> 4)) >> 2);
      const b5 = Math.min(31, (mb + ((t * 8) >> 4)) >> 3);
      const v = (r5 << 11) | (g6 << 5) | b5;
      const i = (y * width + x) * 2;
      out[i] = v & 0xff;
      out[i + 1] = v >> 8;
    }
  }
  return out;
}

/** The same pixels as 8-bit RGBA, for the PNG the `.HMI` also carries. */
export function pictureRgba(spec: PictureSpec): Uint8Array {
  const rgb565 = picturePixels(spec);
  const out = new Uint8Array(spec.width * spec.height * 4);
  for (let i = 0; i < spec.width * spec.height; i++) {
    const v = rgb565[i * 2] | (rgb565[i * 2 + 1] << 8);
    // back to 8 bits the way the panel does: replicate the high bits, so the
    // PNG the Editor imports is exactly what the panel will show
    const r5 = (v >> 11) & 0x1f;
    const g6 = (v >> 5) & 0x3f;
    const b5 = v & 0x1f;
    out[i * 4] = (r5 << 3) | (r5 >> 2);
    out[i * 4 + 1] = (g6 << 2) | (g6 >> 4);
    out[i * 4 + 2] = (b5 << 3) | (b5 >> 2);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * RGB565 back to 0xRRGGBB, replicating the high bits the way the panel does.
 *
 * The generator needs the page's ground colour as 24-bit to blend a rounded
 * corner against, and the theme document carries it as RGB565. Going through
 * this rather than through a hex string keeps the corner blending against the
 * colour the glass will actually show, not against the designer's original.
 */
export function rgb565To24(v: number): number {
  const r5 = (v >> 11) & 0x1f;
  const g6 = (v >> 5) & 0x3f;
  const b5 = v & 0x1f;
  return (((r5 << 3) | (r5 >> 2)) << 16) | (((g6 << 2) | (g6 >> 4)) << 8) | ((b5 << 3) | (b5 >> 2));
}
