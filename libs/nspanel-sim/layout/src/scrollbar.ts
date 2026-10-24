// A paged list's scrollbar, as nodes -- shared by every theme's `page-rail`.
//
// One vertical Slider and nothing else. The themes only choose the groove's
// colour: how a scrollbar WORKS on this glass is not a look, and three copies
// of it would be three chances for the pointer's arithmetic to disagree with
// the paging the runtime does on the other side.
//
// What each piece costs, which is the point of doing it this way (the
// list template):
//   - the Slider is 28 B of page RAM and one component record;
//   - the groove is one generated picture of the whole touch box, page colour
//     but for a thin stripe -- three runs a row, so it compresses to almost
//     nothing, and a project pays for it once however many lists use it;
//   - the paging is nearly free: `maxval = pageCount - 1` and an integer `val`
//     make the pages, and one line on release lands the pointer on its page
//     (`land`), which it does not do by itself.
import type { PageRailLayout } from "./components.js";
import { numberValue, type ColorToken, type PanelNode, type Size } from "./node.js";

/** The measurements of the drawing. The TOUCH box is the placement's, never these. */
export const SCROLLBAR = {
  /** the stripe the eye follows, in panel pixels */
  grooveWidth: 6,
  /** the pointer, a little wider than the stripe so it reads as riding on it */
  thumbWidth: 10,
  /**
   * How far the track stops short of the box's top. The box starts right under
   * the header, and a track touching it reads as part of it.
   */
  inset: 10,
  /**
   * How far the track stops short of the box's BOTTOM: the top's 10 plus the
   * screen's 15 px margin, so it ends where the list's last label does. The
   * box runs on to the glass's edge, and those pixels stay touch -- the
   * slider's `tail` (drawn higher, touchable to the edge).
   */
  insetBottom: 25,
  /** the shortest a pointer may get before it stops being something to aim at */
  minThumb: 24,
} as const;

export interface ScrollbarLook {
  /** the stripe's colour */
  groove: ColorToken;
}

/**
 * The nodes of one scrollbar in a `size` box: nothing at all for a list that
 * fits on one page (home.be:NO_NAV -- a control with nowhere to go is worse
 * than no control), else the slider.
 */
export function scrollbarNodes(props: PageRailLayout, size: Size, look: ScrollbarLook): PanelNode[] {
  const pageCount = numberValue(props.pageCount);
  // A count the runtime decides compiles the slider whatever its sample says:
  // the runtime hides it on a view of one page and shows it on a longer one.
  const bound = props.pageCount.kind === "binding";
  if (pageCount <= 1 && !bound) return [];
  const inset = Math.min(SCROLLBAR.inset, Math.floor(size.h / 4));
  const below = Math.min(SCROLLBAR.insetBottom, Math.floor(size.h / 4));
  const trackH = Math.max(2, size.h - inset - below);
  // one page's share of the track, the way a scrollbar's thumb says how much
  // of the list is on screen -- never so short it cannot be seen
  const thumb = Math.min(trackH, Math.max(SCROLLBAR.minThumb, Math.floor(trackH / pageCount)));
  return [
    {
      kind: "slider",
      id: "hPage",
      box: { x: 0, y: inset, w: size.w, h: trackH },
      value: props.page,
      max: Math.max(1, pageCount - 1),
      land: true,
      ...(bound ? { pages: props.pageCount.kind === "binding" ? props.pageCount.path : undefined } : {}),
      orientation: "vertical",
      track: { kind: "groove", color: look.groove, width: Math.min(SCROLLBAR.grooveWidth, size.w) },
      pointerWidth: Math.min(SCROLLBAR.thumbWidth, size.w),
      pointerHeight: thumb,
      radius: 0,
      action: props.change,
      // on release only: a page turn rewrites every row, and doing that at the
      // drag's 100 ms cadence would be serial traffic for pages the finger is
      // only passing through
      live: false,
      // the box under the track, still touch: a tap there is the last page
      tail: size.h - inset - trackH,
    },
  ];
}
