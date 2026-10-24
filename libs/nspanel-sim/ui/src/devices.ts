// Device presets — the hardware's real dimensions and density, not
// invented ones.

export type DeviceId = "eu-landscape" | "us-portrait";

/**
 * Which side of the logical grid the hidden pixels (widthPx -
 * visibleWidthPx) sit on, when visibleWidthPx < widthPx.
 *
 * NOT read by anything today — neither by the simulator (design and
 * rendering work directly on `visibleWidthPx` as if it were the whole
 * canvas, see components/Screen.tsx, so no component can exist in the
 * hidden strip in the first place) nor by the exporter, which refuses
 * an out-of-strip placement through `core/`'s `DEVICE_VISIBLE` instead:
 * a rectangle, not a side. The field stays because it says something
 * `DEVICE_VISIBLE` cannot — WHICH side the bezel eats — and that is the
 * answer needed the day a layout wants to paste `visibleWidthPx` of
 * content onto the `widthPx` grid at an offset (0 for "right",
 * widthPx-visibleWidthPx for "left", half the difference for "split").
 *
 * For the EU model this is an ASSUMPTION today (see visibleWidthPx
 * below), not a fact verified on hardware — it exists as an explicit
 * field, hardcoded nowhere, precisely so it is easy to correct once we
 * actually measure.
 */
export type HiddenPixelsSide = "right" | "left" | "split";

export interface DevicePreset {
  id: DeviceId;
  label: string;
  /** Width of the entire logical Nextion grid — what the protocol addresses. */
  widthPx: number;
  heightPx: number;
  /**
   * The panel's density, which is the only number here that was not measured on the
   * hardware — both devices use the same 3.5" Nextion panel, so it is a
   * single value.
   *
   * CORROBORATED indirectly: after calibrating the
   * monitor with an ID-1 card, the rendered screen matched a ruler at
   * the 69.2 x 49.2 mm that 6.5 predicts for the EU model. That
   * validates the whole chain — calibration, visibleWidthPx and this
   * density — to within the precision of a ruler held against a
   * monitor, about 0.5 mm.
   *
   * What it does NOT settle: the common 3.5" 480x320 panel has a
   * nominal pitch of 0.153 mm, i.e. 6.536 px/mm, which would give
   * 68.85 x 48.96 mm. The difference is 0.38 mm in width — below what a
   * ruler can distinguish. So 6.5 is right FOR THE SIMULATOR, but if the
   * Nextion exporter ever needs sub-millimetre placement on the real
   * grid, this ambiguity returns and it will take callipers, not a
   * ruler.
   */
  pxPerMm: number;
  /**
   * The width ACTUALLY visible through the physical bezel, in px — can
   * be smaller than `widthPx`. This is what the simulator uses as its
   * design canvas (see components/Screen.tsx), not `widthPx`: it makes
   * it physically impossible for a component to exist in the hidden
   * strip, rather than merely hiding the strip after rendering.
   */
  visibleWidthPx: number;
  /** See HiddenPixelsSide. Only matters when visibleWidthPx < widthPx. */
  hiddenPixelsSide: HiddenPixelsSide;
}

export const DEVICES: Record<DeviceId, DevicePreset> = {
  "eu-landscape": {
    id: "eu-landscape",
    label: "EU — landscape",
    widthPx: 480,
    heightPx: 320,
    pxPerMm: 6.5,
    // Confirmed by the community (Blackymas/NSPanel_HA_Blueprint,
    // discussion #713): "The 30 most right pixels are not visible in
    // the EU model, making the useful area only 450x320" — the EU
    // housing's bezel physically covers part of the Nextion grid. It
    // matches a ruler on the unit (the web width larger than the real one,
    // the height matching). This is
    // not a precision fault in the panel — it is the physical housing's
    // glass covering real pixels.
    visibleWidthPx: 450,
    // ⚠️ "right" comes from the community source and is NOT verified on
    // our hardware — a single secondary source, never confirmed against
    // the physical panel. It does not affect the simulator today (design
    // works only on visibleWidthPx, see HiddenPixelsSide above), but it
    // will matter for the exporter: if the 30 hidden px are on the left
    // instead, or split, content drawn at 450px has to be pasted at a
    // different offset on the panel's real 480px grid. To verify in
    // practice: send a test pattern with markers in known columns (e.g.
    // 0, 15, 30, 450, 465, 479) and see which stay visible behind the
    // real bezel.
    hiddenPixelsSide: "right",
  },
  "us-portrait": {
    id: "us-portrait",
    label: "US — portrait",
    widthPx: 320,
    heightPx: 480,
    pxPerMm: 6.5,
    // Confirmed on the physical US unit: no crop, it shows the entire Nextion grid.
    visibleWidthPx: 320,
    hiddenPixelsSide: "right", // no effect — visibleWidthPx == widthPx
  },
};

// Minimum touch-target size in mm, converted to pixels of the active
// device (ISO/TS 9241-411 bare finger, IEC 61131 / ISA 101 industrial).
export const TARGET_SIZE_MM = {
  bareFinger: 12,
  industrial: 15,
} as const;

export function mmToPx(mm: number, device: DevicePreset): number {
  return Math.round(mm * device.pxPerMm);
}
