// The ceilings of a project and the references a component makes, so the writer
// refuses what the Editor would refuse.

import { readHmiDirectory, hmiLiveEntries, hmiBlob, readHmiMain } from "./hmi.js";
import { OUR_RULES } from "./attrRanges.js";

/**
 * Components on one page. 250 compiles and 251 answers `Too many components.`
 * — both measured, so this wall is exact (m27/m31).
 */
export const MAX_COMPONENTS_PER_PAGE = 250;

/**
 * Pages in one project. 251 compiles and 252 answers `Too many pages.`, both
 * measured — 249, 250 and 251 were only built in the fifth round, which is what
 * turned the old printed 251 from a guess into the wall (m47-pages-*).
 */
export const MAX_PAGES = 251;

/**
 * The screen this panel draws on. `header1` reports the panel as 480x320 and
 * the orientation turns it on its side; the Editor refuses anything that does
 * not fit, with `Error:Page:page0 Fail:<objname> Position Invalid.` Measured on
 * both sides for eight component types at once (m44-*-full compile,
 * m44-*-over refuse) and for each edge separately (m21, m37-y-negative).
 */
export const SCREEN = { width: 480, height: 320 };

/**
 * Turn the screen the way the project's orientation does, before any page is
 * written. The panel is 480x320 and `main.HMI` +0x0C says which way up: 0 and 2
 * are portrait, so a component is placed on 320x480 (joBr99's own `nspanel_US_P`
 * does exactly that); 1 and 3 are landscape. The walls measured in m21/m44 are
 * the panel's edges, and the edges move with the orientation -- checking a
 * portrait page against 480x320 refused the US layouts at y >= 320.
 */
export function setScreenOrientation(orientation: number): void {
  const portrait = orientation === 0 || orientation === 2;
  SCREEN.width = portrait ? 320 : 480;
  SCREEN.height = portrait ? 480 : 320;
}

/**
 * The largest picture the Editor takes. 700x880 (616.000 px) compiles and
 * 700x890 (623.000 px) answers
 * `Error:Picture ID:N Resolution beyond the maximum support range` — it is a
 * pixel count, not a per-side limit: 640x960 compiles. The wall
 * is somewhere in between, so this is the largest value proven to work
 * (m35-pic-800x776 compiles, m35-pic-700x890 does not).
 */
export const MAX_PICTURE_PIXELS = 620_800;

export interface ResourceCounts {
  fonts: number;
  pictures: number;
}

/**
 * How many fonts and pictures the project declares. A font is one `.zi`
 * resource; a picture is three entries (`.i`, `.is`, `.ib`) and is counted by
 * its `.i`.
 */
export function projectResourceCounts(file: Uint8Array): ResourceCounts {
  const entry = hmiLiveEntries(readHmiDirectory(file)).get("main.HMI");
  if (!entry) return { fonts: 0, pictures: 0 };
  const { resources } = readHmiMain(hmiBlob(file, entry));
  let fonts = 0, pictures = 0;
  for (const r of resources) {
    if (r.ext === "zi") fonts++;
    else if (r.ext === "i") pictures++;
  }
  return { fonts, pictures };
}

/**
 * Attributes that name a picture id. Besides `pic`/`picc` and their numbered
 * forms, the Prog carries `bpic` and `ppic`.
 */
const PICTURE_ATTRS = /^[bp]?picc?\d*$/;

/**
 * `0xFFFF` means "no picture". It is the default of 28 of the 29 picture
 * attributes across the templates; the exception is `Picture.pic`, which
 * defaults to 0 because a Picture without one draws nothing.
 */
const NO_PICTURE = 0xffff;

/**
 * A component pointing at a resource the project does not have. The two halves
 * were measured (m50) and they do NOT behave the same:
 *
 * - a **font** id past the last font is refused:
 *   `Error:Page:page0 Fail:t1.font InputVal Invalid:Invalid Font ID`;
 * - a **picture** id past the last picture **compiles**. The Editor does not
 *   check it — not on a Picture (`m50-pic-dangling`), not on a `picc` that is
 *   never drawn (`m50-picc-dangling`), not even on one that IS drawn with
 *   `sta = 1` (`m50-picc-used`), and not on the Prog's `bpic`/`ppic`
 *   (`m50-prog-bpic`).
 *
 * So the picture half is OUR rule, and it is off unless `OUR_RULES.on`: what
 * the panel draws for a dangling picture is untested, and testing it means
 * flashing. This is why the campaign's `safeComponent` exists at all: a template
 * carries the resource ids of the project it was lifted from.
 */
export function checkResourceRefs(values: Record<string, unknown>, counts: ResourceCounts, label: string): void {
  for (const [name, raw] of Object.entries(values)) {
    if (typeof raw !== "number") continue;
    if (name === "font") {
      if (raw < 0 || raw >= counts.fonts) throw new RangeError(`Fail:${label}.font InputVal Invalid:Invalid Font ID (${raw}, and the project has ${counts.fonts} font(s); measured in m50-font-dangling)`);
    } else if (PICTURE_ATTRS.test(name) && OUR_RULES.on) {
      if (raw === NO_PICTURE) continue;
      if (raw < 0 || raw >= counts.pictures) throw new RangeError(`${label}.${name} = ${raw}, but the project has ${counts.pictures} picture(s) (our rule; the Editor compiles it — m50-pic-dangling — and what the panel draws is untested)`);
    }
  }
}

/** The Editor's `Too many components.` wall, before the Editor. */
export function checkComponentCount(pageName: string, count: number): void {
  if (count > MAX_COMPONENTS_PER_PAGE) {
    throw new RangeError(`page ${pageName}: ${count} components, over the ${MAX_COMPONENTS_PER_PAGE} the panel takes (the Editor answers "Too many components.")`);
  }
}

/** The Editor's `Too many pages.` wall, before the Editor. */
export function checkPageCount(count: number): void {
  if (count > MAX_PAGES) {
    throw new RangeError(`${count} pages, over the ${MAX_PAGES} the panel takes (the Editor answers "Too many pages.")`);
  }
}

/** The Editor's `Position Invalid.` wall, before the Editor. */
export function checkOnScreen(objname: string, x: number, y: number, w: number, h: number): void {
  if (x < 0 || y < 0 || x + w > SCREEN.width || y + h > SCREEN.height) {
    throw new RangeError(`Fail:${objname} Position Invalid. (${x},${y} ${w}x${h} does not fit the ${SCREEN.width}x${SCREEN.height} screen)`);
  }
}

/** The Editor's `Resolution beyond the maximum support range` wall. */
export function checkPictureSize(id: number, width: number, height: number): void {
  if (width * height > MAX_PICTURE_PIXELS) {
    throw new RangeError(`Picture ID:${id} Resolution beyond the maximum support range (${width}x${height} = ${width * height} px, over the ${MAX_PICTURE_PIXELS} proven to work)`);
  }
}
