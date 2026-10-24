// Drawing panel text the way the panel draws it.
//
// Everywhere else in `ui/` a label is a DOM node in a browser font: right for
// deciding colour and form, and useless for the question "will this fit, and
// what will it look like at 24 pixels on glass". This draws the real thing --
// the theme's own `.zi`, decoded glyph by glyph, at one panel pixel per
// pixel -- so the two can be compared side by side.
//
// The geometry is the measured one (`export/src/textRaster.ts`): the pen
// advances by the glyph's advance, a kerned bitmap hangs to the left of it,
// alignment inside a box follows the component's `xcen`/`ycen`, and a run too
// wide is clipped at the box. Every one of those was read off the Nextion
// Editor's debugger, so what appears here is not a stylised preview -- within
// the limits of the model, it is the pixels.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  fitZiText, rasterizeZiGlyph, rasterizeZiTextInBox, readZi, wrapZiText, ziAdvanceTable, ziAlphaTo255,
  type ZiBoxAlign, type ZiFont, type ZiTextBox,
} from "@nspanel-sim/export";
import { rgb565ToRgb } from "../rgb565";
import { useDevicePixelRatio } from "../useDevicePixelRatio";

/** A `.zi` fetched once per URL and shared by every component that asks. */
const cache = new Map<string, Promise<ZiFont>>();

export function loadZiFont(url: string): Promise<ZiFont> {
  let pending = cache.get(url);
  if (pending === undefined) {
    pending = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((b) => readZi(new Uint8Array(b)));
    cache.set(url, pending);
  }
  return pending;
}

export interface ZiFontState {
  font?: ZiFont;
  error?: string;
}

/** Loads a `.zi` by URL. Returns the font, or the reason there isn't one. */
export function useZiFont(url: string | undefined): ZiFontState {
  const [state, setState] = useState<ZiFontState>({});
  useEffect(() => {
    if (url === undefined) { setState({}); return; }
    let live = true;
    setState({});
    loadZiFont(url).then(
      (font) => { if (live) setState({ font }); },
      (e: Error) => { if (live) setState({ error: e.message }); },
    );
    return () => { live = false; };
  }, [url]);
  return state;
}

export interface ZiTextProps {
  font: ZiFont;
  text: string;
  /** the component's box in panel pixels; defaults to the run's own size */
  box?: ZiTextBox;
  align?: ZiBoxAlign;
  /** foreground, as the panel carries it: RGB565 */
  pco?: number;
  /** background; leave undefined for transparent, which is how a preview wants it */
  bco?: number;
  /** panel pixels per CSS pixel. 1 is life size on a 1:1 display */
  zoom?: number;
  /** draw the box's edge, so clipping and alignment are visible */
  showBox?: boolean;
  title?: string;
}

/**
 * One run of panel text on a canvas, at `zoom` device pixels per panel pixel.
 *
 * Alpha is blended the way the glyph carries it -- 0 to 7, scaled the way the
 * font editor does -- over `bco`, or over whatever is behind the canvas when no
 * `bco` is given. Nearest-neighbour on purpose: a smoothed upscale would hide
 * exactly the jaggedness the panel will show.
 */
export function ZiText({ font, text, box, align, pco = 0xffff, bco, zoom = 1, showBox = false, title }: ZiTextProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const dpr = useDevicePixelRatio();
  const { placement, alpha } = rasterizeZiTextInBox(
    font,
    text,
    box ?? { x: 0, y: 0, w: Math.max(1, runWidth(font, text, align)), h: font.height },
    align,
  );
  const w = box ? box.w : Math.max(1, placement.layout.right - placement.layout.left);
  const h = box ? box.h : font.height;
  const scale = integerDeviceScale(zoom, dpr);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const image = ctx.createImageData(w, h);
    const fg = rgb565ToRgb(pco);
    const bg = bco === undefined ? undefined : rgb565ToRgb(bco);
    for (let i = 0; i < w * h; i++) {
      const a = ziAlphaTo255(alpha[i] ?? 0);
      if (bg === undefined) {
        image.data[i * 4] = fg.r;
        image.data[i * 4 + 1] = fg.g;
        image.data[i * 4 + 2] = fg.b;
        image.data[i * 4 + 3] = a;
      } else {
        const mix = (f: number, b: number) => Math.round((f * a + b * (255 - a)) / 255);
        image.data[i * 4] = mix(fg.r, bg.r);
        image.data[i * 4 + 1] = mix(fg.g, bg.g);
        image.data[i * 4 + 2] = mix(fg.b, bg.b);
        image.data[i * 4 + 3] = 255;
      }
    }
    // draw at 1:1 into an offscreen canvas, then blow it up with smoothing off
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    off.getContext("2d")?.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  }, [alpha, w, h, pco, bco, scale]);

  return (
    <span style={{ position: "relative", display: "inline-block", lineHeight: 0 }} title={title}>
      <canvas
        ref={ref}
        width={w * scale}
        height={h * scale}
        style={{ display: "block", width: (w * scale) / dpr, height: (h * scale) / dpr, imageRendering: "pixelated" }}
      />
      {showBox && (
        <span
          aria-hidden
          style={{
            position: "absolute", inset: 0, pointerEvents: "none",
            outline: `1px dashed ${placement.clipped ? "#e06c75" : "rgba(255,255,255,0.35)"}`,
            outlineOffset: 0,
          }}
        />
      )}
    </span>
  );
}

/**
 * How many DEVICE pixels one panel pixel gets. An integer, always.
 *
 * This is the whole reason a bitmap font can look crisp at all, and getting it
 * wrong makes these previews ragged. A backing store sized at `w * zoom * dpr`
 * with the element at `w * zoom` CSS pixels asks, on a 1.25 display, for a
 * 1.25x nearest-neighbour upscale, so
 * four panel pixels out of five become one device pixel and the fifth becomes
 * two. Rows and columns of the glyph come out at different thicknesses -- which
 * reads as "pixelated" far more than honest square pixels ever do. Sizing the
 * backing store in device pixels did not fix that; it only moved the resampling
 * from the browser into our own `drawImage`.
 *
 * So the scale is rounded to an integer and the element is then sized at
 * `w * scale / dpr` CSS pixels, which is exactly `w * scale` device pixels. One
 * panel pixel becomes N device pixels, N whole, every time. The cost is that the
 * zoom the user asked for is honoured to the nearest whole device pixel.
 */
export function integerDeviceScale(zoom: number, dpr: number): number {
  return Math.max(1, Math.round(zoom * dpr));
}

const advanceTables = new WeakMap<ZiFont, Uint8Array>();

/**
 * `text` as the panel runtime writes it into a box `width` pixels wide: whole
 * when it fits, else cut at a whole character with an ellipsis -- the same
 * `fitZiText` and the same advance table the generated PanelRuntime uses.
 *
 * Applied to every text, fixed or not, and that is honest because the
 * generator refuses a COMPILED text that does not fit its box
 * (`build-project-hmi.mjs`): what can reach the glass unfitted always fits, so
 * fitting it here changes nothing, and what the runtime writes is cut here
 * exactly as it will be there.
 */
export function fitToBox(font: ZiFont, text: string, width: number): string {
  return fitZiText(advanceTableOf(font), text, width);
}

/**
 * Paragraphs broken into the lines a body of stacked Texts shows at `width`
 * pixels -- the same `wrapZiText` the generator breaks Help's lines with for
 * the glass, so both columns break at the word the panel breaks at.
 */
export function wrapToBox(font: ZiFont, paragraphs: readonly string[], width: number): string[] {
  return wrapZiText(advanceTableOf(font), paragraphs, width);
}

function advanceTableOf(font: ZiFont): Uint8Array {
  let table = advanceTables.get(font);
  if (table === undefined) {
    table = ziAdvanceTable(font);
    advanceTables.set(font, table);
  }
  return table;
}

/**
 * A component's text as the panel draws it, for the PANEL TREE: one CSS pixel
 * per panel pixel, inside the component's own box.
 *
 * `ZiText` above is the inspector's version and sizes itself in whole DEVICE
 * pixels, which is right for looking at a glyph and wrong here: the panel tree
 * is laid out in panel pixels, `<Screen>` scales all of it at once, and the
 * Real column rasterises it at exactly one pixel each (html2canvas copies a
 * canvas as it is). So the backing store is the box, the element is the box,
 * and the scaling is the tree's.
 *
 * The browser's font at the `.zi`'s height would not do: a `.zi` spends that
 * height on the whole line, not on the letter, and every text would come out
 * 25-28 % wider than the glass shows it.
 * This draws the glyphs themselves, placed by the measured rules
 * (`rasterizeZiTextInBox`: advance, kerning, `xcen`/`ycen`, clipped at the box),
 * and a character the font does not carry is simply not drawn -- as there.
 *
 * The colour is CSS, painted through the glyphs' alpha, for the reason
 * `ZiGlyphView` gives: quantising is the Real column's job, further down.
 */
export function ZiTextInBox({ font, text, w, h, align, color = "currentColor" }: {
  font: ZiFont;
  text: string;
  w: number;
  h: number;
  align: ZiBoxAlign;
  color?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const cw = Math.max(1, Math.round(w));
  const ch = Math.max(1, Math.round(h));
  const { alpha } = useMemo(
    () => rasterizeZiTextInBox(font, text, { x: 0, y: 0, w: cw, h: ch }, align),
    [font, text, cw, ch, align.xcen, align.ycen, align.spax],
  );
  // A layout effect and not an effect: the Real column rasterises on the DOM
  // mutation that mounted this canvas, and a canvas painted after that would be
  // captured blank.
  useLayoutEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const image = ctx.createImageData(cw, ch);
    for (let i = 0; i < cw * ch; i++) image.data[i * 4 + 3] = ziAlphaTo255(alpha[i] ?? 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.putImageData(image, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, cw, ch);
    ctx.globalCompositeOperation = "source-over";
  }, [alpha, color, cw, ch]);
  return (
    <canvas
      ref={ref}
      width={cw}
      height={ch}
      style={{ display: "block", width: cw, height: ch, imageRendering: "pixelated" }}
    />
  );
}

/** The width a run needs when no box was given: the ink, not the advance. */
function runWidth(font: ZiFont, text: string, align?: ZiBoxAlign): number {
  const { placement } = rasterizeZiTextInBox(font, text, { x: 0, y: 0, w: 1 << 15, h: font.height }, { ...align, xcen: 0 });
  return placement.layout.right - placement.layout.left;
}

/**
 * One glyph of a `.zi`, tinted with a CSS colour.
 *
 * This is how an icon reaches the screen now that an icon IS a glyph:
 * the alpha comes from the font, the colour from the light's own state,
 * exactly as `berry/light.be` composes them on the panel.
 *
 * A CSS colour and not RGB565 on purpose. The bulb's colour is computed from its
 * hue and saturation (`lightIconColor`), and quantising it is the Real column's
 * job further down the pipeline -- doing it here would quantise twice.
 *
 * `...View` and not `ZiGlyph` because `ZiGlyph` is already the TYPE of a glyph
 * inside a parsed font, and `ui/` re-exports that type. One name meaning both a
 * record and a React component is the kind of thing TypeScript resolves in a way
 * nobody predicts -- here the type won and the component could not be called.
 */
export function ZiGlyphView({ font, code, color = "currentColor", title, zoom = 1 }: {
  font: ZiFont;
  code: number;
  color?: string;
  title?: string;
  /**
   * Magnification for LOOKING at the glyph, never for drawing a bigger icon.
   *
   * The panel cannot scale a glyph -- a Nextion Text draws the font it names at
   * that font's height -- so a bigger icon on the panel is a bigger FONT, chosen
   * by `pickIconFont`. This is the inspector's magnifying glass and nothing else,
   * which is why it lands on whole device pixels like everything else here.
   */
  zoom?: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const raster = useMemo(() => rasterizeZiGlyph(font, code), [font, code]);
  const w = Math.max(1, raster.width);
  const h = Math.max(1, raster.height);
  const dpr = useDevicePixelRatio();
  const scale = integerDeviceScale(zoom, dpr);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx || raster.width === 0) return;
    // the glyph as an alpha mask, then the colour painted through it: keeping
    // the mask separate is what lets the same glyph be any colour without
    // decoding it again
    const mask = document.createElement("canvas");
    mask.width = raster.width;
    mask.height = raster.height;
    const mctx = mask.getContext("2d");
    if (!mctx) return;
    const image = mctx.createImageData(raster.width, raster.height);
    for (let i = 0; i < raster.width * raster.height; i++) image.data[i * 4 + 3] = ziAlphaTo255(raster.alpha[i]);
    mctx.putImageData(image, 0, 0);
    mctx.globalCompositeOperation = "source-in";
    mctx.fillStyle = color;
    mctx.fillRect(0, 0, mask.width, mask.height);

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(mask, 0, 0, canvas.width, canvas.height);
  }, [raster, color, scale]);

  if (raster.width === 0) return null;
  // Whole device pixels per panel pixel -- see `integerDeviceScale`. On a 1:1
  // display this is life size; on a 1.25 one the glyph is drawn at one device
  // pixel each and so occupies 0.8 CSS pixels per panel pixel, which is smaller
  // on screen and exact, rather than life-sized and smeared.
  return (
    <canvas
      ref={ref}
      width={w * scale}
      height={h * scale}
      title={title}
      style={{ display: "block", width: (w * scale) / dpr, height: (h * scale) / dpr, imageRendering: "pixelated" }}
    />
  );
}
