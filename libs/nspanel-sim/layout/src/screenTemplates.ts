// Screen TEMPLATES: the same geometry, for every theme, for every screen
// that carries a page-rail or that a page-rail leads to.
//
// A project is a flat list of placements (a Nextion page IS one, and geometry
// that lived inside a component could not be emitted), but the placements a
// paginated screen needs are not typed out by hand, one project at a time:
// every number in them -- the rail's width, the row height, the gap between
// rows, how far below the header the first row sits -- is this arithmetic,
// done once.
//
// Themes call this with their OWN id and get back plain placements in their
// OWN `<theme>/<component>` form (`themes/lovelace-jobr99.ts` and its two
// siblings each export a thin `settingsScreens`/`helpScreen` bound to their
// own id) -- so `@nspanel-sim/layout`'s per-theme namespaces are where a
// project imports these FROM, the same way it already reaches a theme's
// `navHeader` or `pageRail`. The geometry itself does not vary by theme: a
// 78 px row is a 12 mm touch target regardless of who draws inside it, and
// two themes disagreeing about where the rail ends would be two themes
// disagreeing about a measurement, not a look.
//
// This package still owns neither React nor the `.tft` format (see
// index.ts) -- what it returns is JSON-shaped, deliberately: the same shape
// a project's `place` array already carries, so a script can splice the
// result straight into a project's JSON and a person reading that JSON
// afterwards sees exactly what they would have typed by hand.

/** A placement, exactly as project.json spells one. */
export interface TemplatePlacement {
  component: string;
  /** which of the theme's styles of the component; absent is its default */
  variant?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  bind: Record<string, string | number | boolean>;
  /** how the glass reports the component's input: the brightness slider's `live`, written as it moves */
  input?: { live?: boolean };
  /** why the box may be smaller than its component's touch minimum (project schema 13): the row under a page's title */
  smallTouch?: string;
  /** which of the things that take turns in this place it is (project schema 14): the house's icons, or the mesh's buttons */
  alternate?: string;
}

/** A screen, exactly as project.json spells one. */
export interface TemplateScreen {
  id: string;
  title: string;
  /** what the runtime knows it by (project schema 12, `SCREEN_ROLES`) */
  role: string;
  place: TemplatePlacement[];
}

/** The grid a screen is being placed on -- a layout's device, in panel pixels. */
export interface Grid {
  w: number;
  h: number;
}

/**
 * The measurements every paginated screen (and Help, which one leads to)
 * shares. Hardware/ergonomic facts -- touch minimums and the row height
 * they force, mostly -- not a style choice, which is why these are one
 * constant each and not a per-theme table: a theme varies COLOUR, FONT and
 * SHAPE (its own `navHeader`/`pageRail`/`listRow`), never how much room
 * a 12 mm target needs.
 */
export const SCREEN_GEOMETRY = {
  /** the margin every screen's content keeps from a visible edge */
  margin: 15,
  /**
   * The right-hand column, flush with the visible edge: the page-rail, and the
   * header's action drawn over it. Past it is the bezel,
   * and the part of a finger that lands there presses nothing else, so 48 px
   * of glass (7.4 mm) is the rail's target where it had 78 kept inside the
   * margin -- its pointer drawn 47 px from the edge, now 24.
   */
  railWidth: 48,
  /** nav-header's height, the same on every screen this project places */
  navHeaderHeight: 78,
  /**
   * The header's action, as a touch: 64 px (9.8 mm) wide, to the visible edge.
   * Its glyph is drawn over the rail's column, on the rail's axis.
   */
  headerIconWidth: 64,
  /**
   * the gap between the header and the first row/line below it: three rows fit
   * the EU panel, 78 + 8 + 3 x 78 is its 320 px exactly.
   */
  headerGap: 8,
  /** a settings-row's height -- again the 12 mm floor, see themes' own settings-row notes */
  rowHeight: 78,
  /**
   * the gap between one settings-row and the next: none. A row draws only its label, centred in a 12 mm box, so the eye
   * reads the 78 px pitch and not the boxes; a gap was dead glass between two
   * targets the floor already sizes, and it would cost the EU panel its third row.
   * Touch boxes may touch, never overlap.
   */
  rowGap: 0,
  /** a Help body line's height -- one line of `body`-role text, no wrap */
  helpLineHeight: 28,
  /** how many body lines Help's template carries; a theme with a wider body could fit words, never more of them THIS way -- see runtime.ts's HELP_CONTENT for what filling fewer than this looks like */
  helpLineCount: 5,
} as const;

/**
 * Where page-rail sits on a grid: the right-hand column, flush with the
 * visible edge. The header's action glyph shares its axis (the themes' `navHeader`).
 */
export function railColumn(grid: Grid): { x: number; w: number } {
  const w = Math.min(SCREEN_GEOMETRY.railWidth, grid.w);
  return { x: grid.w - w, w };
}

/**
 * Where a nav-header goes: from the margin to the VISIBLE EDGE, so its
 * action's touch reaches the edge the finger can lean on. The header keeps the
 * margin itself for its words: its title stops short of the edge by it.
 */
export function headerBox(grid: Grid): { x: number; w: number } {
  const g = SCREEN_GEOMETRY;
  return { x: g.margin, w: Math.max(1, grid.w - g.margin) };
}

/**
 * A nav-header's action slot, in a header `w` wide that `headerBox` placed:
 * the touch, 64 px to the header's right end (the visible edge), and the box
 * its glyph is drawn in, the rail's column, so the glyph and the rail below it
 * share an axis. `room` is what the title keeps free on its right when there is
 * no action at all: the margin, for its words.
 */
export function headerAction(w: number): { touch: { x: number; w: number }; glyph: { x: number; w: number }; room: number } {
  const g = SCREEN_GEOMETRY;
  const touchW = Math.max(1, Math.min(g.headerIconWidth, Math.floor(w / 3)));
  const glyphW = Math.min(g.railWidth, touchW);
  return { touch: { x: w - touchW, w: touchW }, glyph: { x: w - glyphW, w: glyphW }, room: Math.min(g.margin, Math.floor(w / 3)) };
}

/**
 * How many rows a list screen holds on this grid: as many as fit under the
 * header at `rowHeight + rowGap` apart -- three on the EU panel's 320 px, five
 * on the US portrait's 480, with no gaps: the same pitch on both. The length of the LIST is not in here and must
 * not be: the template is the same page whatever the list holds.
 */
export function listRows(grid: Grid): number {
  const g = SCREEN_GEOMETRY;
  const room = grid.h - g.navHeaderHeight - g.headerGap + g.rowGap;
  return Math.max(1, Math.floor(room / (g.rowHeight + g.rowGap)));
}

/**
 * How many device rows the zone's screen holds under its top card: two on the
 * EU panel's 320 px, four on the US portrait's 480.
 */
export function zoneRows(grid: Grid): number {
  const g = SCREEN_GEOMETRY;
  const room = grid.h - g.navHeaderHeight - g.headerGap - g.rowHeight + g.rowGap;
  return Math.max(1, Math.floor(room / (g.rowHeight + g.rowGap)));
}

/**
 * How many counters the zone's top card carries on this grid: one per kind, as
 * many as fit between the rail's column and a word the finger can still hit
 * (`ZONE_NAME_MIN`) -- three on the EU panel, two on the US portrait. A zone
 * of more kinds shows the commonest.
 */
export function zoneCounters(grid: Grid): number {
  const g = SCREEN_GEOMETRY;
  const room = grid.w - g.margin - g.railWidth - ZONE_NAME_MIN;
  return Math.max(1, Math.min(3, Math.floor(room / ZONE_COUNTER_WIDTH)));
}

/**
 * The narrowest the row beside the counters may get: 100 px, 15 mm, a word the
 * finger can still hit. It holds the word that opens the zone's options, which
 * the title does not.
 */
export const ZONE_NAME_MIN = 100;

/** A zone counter's box: 12 mm square, the number and the kind's icon. */
export const ZONE_COUNTER_WIDTH = 78;

/**
 * THE list, as a TEMPLATE: one Nextion page whatever it lists.
 *
 * Settings, Add, Pair, the options, Screens and the confirmations are all views
 * of it: a nav-header whose title is the way back and whose action is the
 * view's (✓ while pairing, ↻ to search again), a page-rail in the right-hand
 * column under it (`railColumn`), and `listRows(grid)` list-rows from the
 * margin to the rail. The rows are SLOTS -- `$list.rows.<k>.*` -- which the
 * runtime fills with whichever page of whichever view is showing. Turning a
 * page, or opening another view, is the runtime writing the rows into the same
 * components, so a new view costs nothing in the `.tft`.
 *
 * The page count is a BINDING (`$list.pageCount`): it changes with the view,
 * so the runtime writes the scrollbar's `maxval`. The sample it compiles with
 * only sizes the pointer.
 *
 * The rows end where the rail starts, with no gap: touch boxes may touch,
 * never overlap, and the rail's drawing is a thin groove on its column's axis,
 * so the eye still sees room.
 *
 * The rows are `stacked`, the value on the line under the name, both as wide as the row: the values are words (a Wi-Fi's
 * state, a network's name) that a row with the value at its end would give 98 px. One list, on both layouts.
 */
export function listScreen(theme: string, grid: Grid, id = "settings"): TemplateScreen {
  const g = SCREEN_GEOMETRY;
  const rail = railColumn(grid);
  const place: TemplatePlacement[] = [
    // Rail first, header second: placement order is what numbers the objects
    // on the glass (`mTitle1`, `mRow2`, ...), and the Berry side keys events by
    // those names.
    {
      // Touch to the glass's bottom edge, drawn short of it: the track ends
      // where the list's last label does and the rest is the slider's `tail`
      // (scrollbar.ts).
      component: `${theme}/page-rail`, x: rail.x, y: g.navHeaderHeight, w: rail.w,
      h: Math.max(1, grid.h - g.navHeaderHeight),
      bind: { page: "$list.page", pageCount: "$list.pageCount", onChange: "$list.setPage" },
    },
    ...listPlacements(theme, grid, Math.max(1, rail.x - g.margin)),
  ];
  return { id, title: "Main settings", role: "list", place };
}

/** A list page's header and rows, the rows `rowWidth` wide from the margin. */
function listPlacements(theme: string, grid: Grid, rowWidth: number): TemplatePlacement[] {
  const g = SCREEN_GEOMETRY;
  const header = headerBox(grid);
  return [
    {
      component: `${theme}/nav-header`, x: header.x, y: 0, w: header.w, h: g.navHeaderHeight,
      bind: {
        title: "$list.title", onClose: "$nav.close", onEditTitle: "$list.editTitle",
        actionIcon: "$list.actionIcon", onAction: "$list.onAction",
      },
    },
    ...Array.from({ length: listRows(grid) }, (_, k): TemplatePlacement => ({
      // the name from the row's edge, under the title, the value under the
      // name, and the row's glyph at its end (listRow.ts, stacked)
      component: `${theme}/list-row`,
      variant: "stacked",
      x: g.margin,
      y: g.navHeaderHeight + g.headerGap + k * (g.rowHeight + g.rowGap),
      w: rowWidth,
      h: g.rowHeight,
      bind: {
        icon: `$list.rows.${k}.icon`,
        iconColor: `$list.rows.${k}.iconColor`,
        label: `$list.rows.${k}.label`,
        hint: `$list.rows.${k}.hint`,
        // a value that says something by its colour: a signal's dBm
        hintColor: `$list.rows.${k}.hintColor`,
        on: `$list.rows.${k}.on`,
        onChange: `$list.rows.${k}.tap`,
        onHold: `$list.rows.${k}.hold`,
      },
    })),
  ];
}

/**
 * A zone's own screen, as a TEMPLATE: every zone is this page.
 *
 * Under the header, the zone's top card: the word that opens its options, and
 * `zoneCounters(grid)` counters, one per kind, laid from the rail's column
 * leftwards -- the first, the zone's commonest kind, against it.
 * Under that, `zoneRows(grid)` device rows, the name from the margin and the
 * icon at the row's end, under the first counter's icon, with the page-rail
 * beside them.
 *
 * The header carries the zone's action: the + that adds a device (drawn only
 * with Editing on and room in the grid).
 */
export function zoneScreen(theme: string, grid: Grid, id = "zone"): TemplateScreen {
  const g = SCREEN_GEOMETRY;
  const rail = railColumn(grid);
  const header = headerBox(grid);
  const cardTop = g.navHeaderHeight + g.headerGap;
  const rowsTop = cardTop + g.rowHeight;
  const counters = zoneCounters(grid);
  const countersLeft = rail.x - counters * ZONE_COUNTER_WIDTH;
  const rows = zoneRows(grid);
  const place: TemplatePlacement[] = [
    {
      component: `${theme}/page-rail`, x: rail.x, y: rowsTop, w: rail.w,
      h: Math.max(1, grid.h - rowsTop),
      bind: { page: "$zone.page", pageCount: "$zone.pageCount", onChange: "$zone.setPage" },
    },
    {
      component: `${theme}/nav-header`, x: header.x, y: 0, w: header.w, h: g.navHeaderHeight,
      bind: {
        title: "$zone.title", onClose: "$nav.close", onEditTitle: "$zone.editTitle",
        actionIcon: "$zone.actionIcon", onAction: "$zone.onAction",
      },
    },
    {
      // the zone's options: a tap or a hold opens them
      component: `${theme}/list-row`, x: g.margin, y: cardTop, w: Math.max(1, countersLeft - g.margin), h: g.rowHeight,
      bind: { label: "$zone.name.label", on: 0, onChange: "$zone.name.tap", onHold: "$zone.name.hold" },
    },
    // right to left: counter 0, the commonest kind, against the rail's column
    ...Array.from({ length: counters }, (_, i): TemplatePlacement => ({
      component: `${theme}/zone-counter`,
      x: rail.x - (i + 1) * ZONE_COUNTER_WIDTH, y: cardTop, w: ZONE_COUNTER_WIDTH, h: g.rowHeight,
      bind: {
        count: `$zone.counts.${i}.count`, icon: `$zone.counts.${i}.icon`, iconColor: `$zone.counts.${i}.iconColor`,
        onTap: `$zone.counts.${i}.tap`, onHold: `$zone.counts.${i}.hold`,
      },
    })),
    // A device row: the name where the options' word starts, and the icon at
    // the row's end -- which ends where the first counter does, against the
    // rail, so the icon stands under that counter's. Its place and its state in
    // words are in its options and its Info.
    ...Array.from({ length: rows }, (_, k): TemplatePlacement => ({
      component: `${theme}/list-row`,
      variant: "device",
      x: g.margin,
      y: rowsTop + k * (g.rowHeight + g.rowGap),
      w: Math.max(1, rail.x - g.margin),
      h: g.rowHeight,
      bind: {
        icon: `$zone.rows.${k}.icon`,
        iconColor: `$zone.rows.${k}.iconColor`,
        label: `$zone.rows.${k}.label`,
        on: `$zone.rows.${k}.on`,
        onChange: `$zone.rows.${k}.tap`,
        onHold: `$zone.rows.${k}.hold`,
        onIconTap: `$zone.rows.${k}.iconTap`,
        onIconHold: `$zone.rows.${k}.iconHold`,
      },
    })),
  ];
  return { id, title: "Zone", role: "zone", place };
}

/**
 * How many lines of words a thermostat's page has under its target, and how many modes it has room for. One
 * line: the temperatures. The lit mode says what the heating is doing.
 */
export const THERMOSTAT_LINES = 1;
export const THERMOSTAT_MODES = 2;
/** The room between two modes' faces, and between them and the glass's edge. */
export const THERMOSTAT_FACE_GAP = 8;

/**
 * The row of buttons under the title of a page of advanced options: a lamp's detail, a thermostat's
 * page and a blind's, of a device or of a zone's group. On the left, a place for each icon the page can have, Identify (an
 * exclamation), Settings (a cog) and Schedule, each a face with its icon and no number, the Schedule's lit in the theme's
 * accent while the schedule is on; on the right, the card's name in words, with the rest of the row, which opens the zone's
 * screen. The runtime puts the icons the page has against the card and hides the places it does not use
 * (berry/panel_page_buttons.be). The row is 48 px tall on both panels and each face 44 px in its middle, below the 12 mm
 * every other touch keeps: each place says so (`smallTouch`).
 */
export const PAGE_BUTTON_ROW = 48;
const PAGE_BUTTON_FACE = 44;
const PAGE_BUTTON_GAP = 8;
const PAGE_ICON_WIDTH = 56;
/** the reason a box under a page's title, or one the row leaves short on the EU, is under the touch minimum */
export const ROW_SMALL_TOUCH = "the row under a page's title, 48 px on both panels, and what it leaves on the EU";

/** The row, from `x0` to `x1`, under the header: `icons` places for icons, and the card's; their paths start with `$page`. */
export function pageButtons(theme: string, page: string, x0: number, x1: number, icons: number): TemplatePlacement[] {
  const g = SCREEN_GEOMETRY;
  const y = g.navHeaderHeight + Math.floor((PAGE_BUTTON_ROW - PAGE_BUTTON_FACE) / 2);
  const out = Array.from({ length: icons }, (_, k): TemplatePlacement => ({
    component: `${theme}/zone-counter`, variant: "face", x: x0 + k * (PAGE_ICON_WIDTH + PAGE_BUTTON_GAP), y, w: PAGE_ICON_WIDTH, h: PAGE_BUTTON_FACE,
    bind: {
      count: `$${page}.icons.${k}.count`, icon: `$${page}.icons.${k}.icon`, iconColor: `$${page}.icons.${k}.iconColor`,
      onTap: `$${page}.icons.${k}.tap`, visible: `$${page}.icons.${k}.shown`,
    },
    smallTouch: ROW_SMALL_TOUCH,
  }));
  const cardX = x0 + icons * (PAGE_ICON_WIDTH + PAGE_BUTTON_GAP);
  out.push({
    component: `${theme}/list-row`, variant: "button", x: cardX, y, w: Math.max(1, x1 - cardX), h: PAGE_BUTTON_FACE,
    bind: { label: `$${page}.card.label`, on: 0, onChange: `$${page}.card.tap`, visible: `$${page}.card.shown` },
    smallTouch: ROW_SMALL_TOUCH,
  });
  return out;
}

/** a box the row left shorter than 12 mm says why; one of full height says nothing */
const shortOf = (h: number): Pick<TemplatePlacement, "smallTouch"> =>
  h < SCREEN_GEOMETRY.rowHeight ? { smallTouch: ROW_SMALL_TOUCH } : {};

/**
 * A lamp's page of advanced options, its detail, as a TEMPLATE: every lamp, and every group of
 * lamps, is this page, and the runtime writes what is on it (`$light.*`). The title; the row of buttons under it; and the
 * three sliders, brightness, colour temperature and colour, each shown only while its target has it, the brightness written as
 * it moves. The sliders share what the row leaves: 64 px each on the EU, 78 on the US.
 */
export function lightDetailScreen(theme: string, grid: Grid, id = "light-detail"): TemplateScreen {
  const g = SCREEN_GEOMETRY;
  const header = headerBox(grid);
  const top = g.navHeaderHeight + PAGE_BUTTON_ROW;
  const left = g.margin;
  const right = grid.w - g.margin;
  const h = Math.min(g.rowHeight, Math.floor((grid.h - top) / 3));
  const slider = (k: number, pct: string, ramp: string, onChange: string, visible: string): TemplatePlacement => ({
    component: `${theme}/gradient-slider`, x: left, y: top + k * h, w: Math.max(1, right - left), h,
    bind: { pct, ramp, onChange, visible },
    ...(k === 0 ? { input: { live: true } } : {}),
    ...shortOf(h),
  });
  const place: TemplatePlacement[] = [
    {
      component: `${theme}/nav-header`, x: header.x, y: 0, w: header.w, h: g.navHeaderHeight,
      bind: { title: "$light.name", onClose: "$nav.close", onEditTitle: "$light.editTitle" },
    },
    ...pageButtons(theme, "light", left, right, 3),
    slider(0, "$light.brightnessPct", "brightness", "$light.setBrightnessPct", "$light.brightnessVisible"),
    slider(1, "$light.colorTempPct", "color-temp", "$light.setColorTempPct", "$light.colorTempVisible"),
    slider(2, "$light.huePct", "hue", "$light.setHuePct", "$light.hueVisible"),
  ];
  return { id, title: "Light detail", role: "detail", place };
}

/**
 * A thermostat's own screen, as a TEMPLATE: every thermostat is this page, and the runtime writes what is on it.
 *
 * Under the header, the row of buttons. Under it, the target: the minus button, the target itself between the two
 * buttons, in the title's type, and the plus button. Under that, a line of words, the room's and the floor's temperatures. At the
 * foot, a gap above the glass's edge, the modes side by side, Off and Heat, which are the whole of a thermostat for heating. Every
 * button is a face, 12 mm tall: the - and the + the zone's counter with a face and no number (its
 * `face` variant), and a mode a row that is a button (`button`), the lit one filled in the theme's accent. The same page on both
 * panels but for the width and the height: on the EU the target's row takes what the row of buttons leaves, 72 px, and the US
 * keeps its 78.
 *
 * What the page says is the runtime's (berry/panel_thermostat_view.be): the buttons' icons and tones, so a button that can go
 * no further is dim, the target and the lines, and which mode is lit.
 */
export function thermostatScreen(theme: string, grid: Grid, id = "thermostat"): TemplateScreen {
  const g = SCREEN_GEOMETRY;
  const header = headerBox(grid);
  const top = g.navHeaderHeight + PAGE_BUTTON_ROW + 2;
  const left = g.margin;
  const right = grid.w - g.margin;
  const step = ZONE_COUNTER_WIDTH;
  const modesTop = grid.h - THERMOSTAT_FACE_GAP - g.rowHeight;
  const targetH = Math.max(1, Math.min(g.rowHeight, modesTop - top - THERMOSTAT_LINES * g.helpLineHeight - 6));
  const linesTop = top + targetH + 4;
  const modeWidth = Math.floor((right - left - (THERMOSTAT_MODES - 1) * THERMOSTAT_FACE_GAP) / THERMOSTAT_MODES);
  const button = (name: "minus" | "plus", x: number): TemplatePlacement => ({
    component: `${theme}/zone-counter`, variant: "face", x, y: top, w: step, h: targetH,
    bind: {
      count: `$thermostat.${name}.count`, icon: `$thermostat.${name}.icon`, iconColor: `$thermostat.${name}.iconColor`,
      onTap: `$thermostat.${name}.tap`,
    },
    ...shortOf(targetH),
  });
  const place: TemplatePlacement[] = [
    {
      component: `${theme}/nav-header`, x: header.x, y: 0, w: header.w, h: g.navHeaderHeight,
      bind: { title: "$thermostat.name", onClose: "$nav.close", onEditTitle: "$thermostat.editTitle" },
    },
    ...pageButtons(theme, "thermostat", left, right, 2),
    button("minus", left),
    {
      component: `${theme}/label`, x: left + step, y: top, w: Math.max(1, right - left - 2 * step), h: targetH,
      bind: { text: "$thermostat.target", tone: "title", align: "center" },
    },
    button("plus", right - step),
    ...Array.from({ length: THERMOSTAT_LINES }, (_, k): TemplatePlacement => ({
      component: `${theme}/label`, x: left, y: linesTop + k * g.helpLineHeight, w: Math.max(1, right - left), h: g.helpLineHeight,
      bind: { text: `$thermostat.lines.${k}`, tone: "muted", align: "center" },
    })),
    ...Array.from({ length: THERMOSTAT_MODES }, (_, k): TemplatePlacement => ({
      component: `${theme}/list-row`, variant: "button", x: left + k * (modeWidth + THERMOSTAT_FACE_GAP), y: modesTop, w: modeWidth, h: g.rowHeight,
      bind: { label: `$thermostat.modes.${k}.label`, on: `$thermostat.modes.${k}.on`, onChange: `$thermostat.modes.${k}.tap` },
    })),
  ];
  return { id, title: "Thermostat", role: "thermostat", place };
}

/** A blind's page: the slider's 21 places, 100% at the top and 0% at the bottom in steps of 5. */
export const COVER_PLACES = 21;
/** The room between the page's pieces, where the glass has it: none between the EU's three keys, whose column is the page's height. */
export const COVER_GAP = 8;

/**
 * A blind's own screen, as a TEMPLATE: every blind is this page, and the runtime writes what is on it.
 *
 * The page speaks of a blind that goes up and down, and everything on it stands in a column. On the right, the
 * slider: the lists' own scrollbar, the same `page-rail`, its 21 places 100% at the top and 0% at the bottom, its pointer
 * where the blind is and its release where it goes. Left of it, the switch's three keys, up, stop and down, as on the wall, each a
 * face 12 mm tall like the thermostat's where the glass has the height. On the left, the position in the title's type and what
 * the blind is doing under it, and the ventilation, a row that is a button: beside the keys on the EU, where the keys take the
 * page's whole height, and under them on the US, which has the height and not the width. Under the header, the row of buttons,
 * as wide as the page left of the slider; on the EU the keys and the ventilation take what it leaves, 64 px each.
 *
 * What the page says is the runtime's (berry/panel_cover_view.be): the position, the words, the keys' tones, the slider's place and
 * the ventilation's words.
 */
export function coverScreen(theme: string, grid: Grid, id = "cover"): TemplateScreen {
  const g = SCREEN_GEOMETRY;
  const header = headerBox(grid);
  const rail = railColumn(grid);
  const top = g.navHeaderHeight + PAGE_BUTTON_ROW + 2;
  const left = g.margin;
  const portrait = grid.h > grid.w;
  const keyH = Math.max(1, Math.min(g.rowHeight, Math.floor((grid.h - top) / 3)));
  const gap = Math.max(0, Math.min(COVER_GAP, Math.floor((grid.h - top - 3 * keyH) / 2)));
  const keysX = rail.x - COVER_GAP - ZONE_COUNTER_WIDTH;
  const words = Math.max(1, keysX - COVER_GAP - left);
  const key = (name: "up" | "stop" | "down", k: number): TemplatePlacement => ({
    component: `${theme}/zone-counter`, variant: "face", x: keysX, y: top + k * (keyH + gap), w: ZONE_COUNTER_WIDTH, h: keyH,
    bind: { count: `$cover.${name}.count`, icon: `$cover.${name}.icon`, iconColor: `$cover.${name}.iconColor`, onTap: `$cover.${name}.tap` },
    ...shortOf(keyH),
  });
  const keysEnd = top + 3 * keyH + 2 * gap;
  const vent: TemplatePlacement = portrait
    ? { component: `${theme}/list-row`, variant: "button", x: left, y: Math.min(grid.h - COVER_GAP - g.rowHeight, keysEnd + COVER_GAP),
        w: Math.max(1, rail.x - COVER_GAP - left), h: g.rowHeight,
        bind: { label: "$cover.vent.label", on: "$cover.vent.on", onChange: "$cover.vent.tap" } }
    : { component: `${theme}/list-row`, variant: "button", x: left, y: grid.h - keyH, w: words, h: keyH,
        bind: { label: "$cover.vent.label", on: "$cover.vent.on", onChange: "$cover.vent.tap" }, ...shortOf(keyH) };
  const place: TemplatePlacement[] = [
    {
      component: `${theme}/nav-header`, x: header.x, y: 0, w: header.w, h: g.navHeaderHeight,
      bind: { title: "$cover.name", onClose: "$nav.close", onEditTitle: "$cover.editTitle" },
    },
    ...pageButtons(theme, "cover", left, rail.x - COVER_GAP, 2),
    {
      component: `${theme}/page-rail`, x: rail.x, y: g.navHeaderHeight, w: rail.w, h: Math.max(1, grid.h - g.navHeaderHeight),
      bind: { page: "$cover.page", pageCount: COVER_PLACES, onChange: "$cover.setPlace" },
    },
    {
      component: `${theme}/label`, x: left, y: top, w: words, h: keyH,
      bind: { text: "$cover.position", tone: "title", align: "center" },
    },
    {
      component: `${theme}/label`, x: left, y: top + keyH, w: words, h: g.helpLineHeight,
      bind: { text: "$cover.state", tone: "muted", align: "center" },
    },
    key("up", 0),
    key("stop", 1),
    key("down", 2),
    vent,
  ];
  return { id, title: "Blind", role: "cover", place };
}

/** The house's icons: Main settings, Wireless settings, the calendar, the alarm, the notifications and the mesh. */
export const HOUSE_ICONS = 6;

/**
 * How many lines the house's icons take on this grid: as few as hold the six, each line holding the same number, so the US
 * portrait's two lines are three and three where four would fit on the first.
 */
export function houseIconLines(grid: Grid): number {
  const g = SCREEN_GEOMETRY;
  const room = railColumn(grid).x - g.margin + PAGE_BUTTON_GAP;
  const fit = Math.max(1, Math.floor(room / (PAGE_ICON_WIDTH + PAGE_BUTTON_GAP)));
  return Math.ceil(HOUSE_ICONS / fit);
}

/**
 * The house's own screen, as a TEMPLATE: the list of the house's screens, the groups the plan's carousel
 * shows, under the house's icons.
 *
 * The header is the list's, and so are the rows and the rail: they bind the same `$list.*`, and the runtime draws the house's
 * view here as it draws every other view on the list, a page at a time (berry/panel_ui.be, `page_of`). Its title is the house's
 * name, which a long press renames. Under it, the icons, in the row of a page of advanced options: Main settings, Wireless
 * settings, the calendar, the alarm, the notifications and the mesh, each a face with its icon and no number, from the margin.
 * The six take one line on the EU and two of three on the US portrait (`houseIconLines`), the line 48 px tall and each face 44 px
 * in its middle, below the 12 mm every other touch keeps, as the row of a page does. An image without the alarm has fewer,
 * and the runtime packs the ones it has from the first place and hides the rest (berry/panel_house_view.be).
 *
 * Under the icons, the rows: two on the EU and three on the US, with the rail beside them, `stacked` as the list's
 * (`listScreen`).
 *
 * The mesh (the house's nodes) is drawn on this page too, with its own icon where the house's are: the settings, the house's
 * channel in them. Its +, which adds a node to the house, is the header's.
 */
export function houseScreen(theme: string, grid: Grid, id = "house"): TemplateScreen {
  const g = SCREEN_GEOMETRY;
  const header = headerBox(grid);
  const rail = railColumn(grid);
  const lines = houseIconLines(grid);
  const perLine = Math.ceil(HOUSE_ICONS / lines);
  const iconsEnd = g.navHeaderHeight + lines * PAGE_BUTTON_ROW;
  const top = iconsEnd + g.headerGap;
  const rows = Math.max(1, Math.floor((grid.h - top + g.rowGap) / (g.rowHeight + g.rowGap)));
  const icon = (k: number): TemplatePlacement => ({
    component: `${theme}/zone-counter`, variant: "face",
    x: g.margin + (k % perLine) * (PAGE_ICON_WIDTH + PAGE_BUTTON_GAP),
    y: g.navHeaderHeight + Math.floor(k / perLine) * PAGE_BUTTON_ROW + Math.floor((PAGE_BUTTON_ROW - PAGE_BUTTON_FACE) / 2),
    w: PAGE_ICON_WIDTH, h: PAGE_BUTTON_FACE,
    bind: {
      count: `$house.icons.${k}.count`, icon: `$house.icons.${k}.icon`, iconColor: `$house.icons.${k}.iconColor`,
      onTap: `$house.icons.${k}.tap`, visible: `$house.icons.${k}.shown`,
    },
    smallTouch: ROW_SMALL_TOUCH,
  });
  const place: TemplatePlacement[] = [
    // the rail first, as on the list: placement order numbers the objects on the glass
    {
      component: `${theme}/page-rail`, x: rail.x, y: iconsEnd, w: rail.w, h: Math.max(1, grid.h - iconsEnd),
      bind: { page: "$list.page", pageCount: "$list.pageCount", onChange: "$list.setPage" },
    },
    {
      component: `${theme}/nav-header`, x: header.x, y: 0, w: header.w, h: g.navHeaderHeight,
      bind: {
        title: "$list.title", onClose: "$nav.close", onEditTitle: "$list.editTitle",
        actionIcon: "$list.actionIcon", onAction: "$list.onAction",
      },
    },
    ...Array.from({ length: HOUSE_ICONS }, (_, k) => icon(k)),
    ...Array.from({ length: rows }, (_, k): TemplatePlacement => ({
      component: `${theme}/list-row`,
      variant: "stacked",
      x: g.margin,
      y: top + k * (g.rowHeight + g.rowGap),
      w: Math.max(1, rail.x - g.margin),
      h: g.rowHeight,
      bind: {
        icon: `$list.rows.${k}.icon`,
        iconColor: `$list.rows.${k}.iconColor`,
        label: `$list.rows.${k}.label`,
        hint: `$list.rows.${k}.hint`,
        on: `$list.rows.${k}.on`,
        onChange: `$list.rows.${k}.tap`,
        onHold: `$list.rows.${k}.hold`,
      },
    })),
  ];
  return { id, title: "House", role: "house", place };
}

/**
 * The mesh's own screen, as a TEMPLATE: the house's nodes in the list's rows, under one button,
 * the mesh's settings, a cog at the margin in the row of buttons of a page of advanced options, the face 44 px in its 48 px line,
 * as the house's icons and a lamp's buttons are. The header is the list's, with the + that adds a node, and so are the rows and the
 * rail: they bind the same `$list.*`, and the runtime draws the mesh here as it draws every other view on the list, a page at a time
 * (berry/panel_ui.be, `page_of`). The rows are `stacked`, as the house's.
 */
export function meshScreen(theme: string, grid: Grid, id = "mesh"): TemplateScreen {
  const g = SCREEN_GEOMETRY;
  const header = headerBox(grid);
  const rail = railColumn(grid);
  const iconsEnd = g.navHeaderHeight + PAGE_BUTTON_ROW;
  const top = iconsEnd + g.headerGap;
  const rows = Math.max(1, Math.floor((grid.h - top + g.rowGap) / (g.rowHeight + g.rowGap)));
  const place: TemplatePlacement[] = [
    // the rail first, as on the list: placement order numbers the objects on the glass
    {
      component: `${theme}/page-rail`, x: rail.x, y: iconsEnd, w: rail.w, h: Math.max(1, grid.h - iconsEnd),
      bind: { page: "$list.page", pageCount: "$list.pageCount", onChange: "$list.setPage" },
    },
    {
      component: `${theme}/nav-header`, x: header.x, y: 0, w: header.w, h: g.navHeaderHeight,
      bind: {
        title: "$list.title", onClose: "$nav.close", onEditTitle: "$list.editTitle",
        actionIcon: "$list.actionIcon", onAction: "$list.onAction",
      },
    },
    {
      component: `${theme}/zone-counter`, variant: "face",
      x: g.margin, y: g.navHeaderHeight + Math.floor((PAGE_BUTTON_ROW - PAGE_BUTTON_FACE) / 2), w: PAGE_ICON_WIDTH, h: PAGE_BUTTON_FACE,
      bind: { count: "$mesh.cog.count", icon: "$mesh.cog.icon", iconColor: "$mesh.cog.iconColor", onTap: "$mesh.cog.tap" },
      smallTouch: ROW_SMALL_TOUCH,
    },
    ...Array.from({ length: rows }, (_, k): TemplatePlacement => ({
      component: `${theme}/list-row`,
      variant: "stacked",
      x: g.margin,
      y: top + k * (g.rowHeight + g.rowGap),
      w: Math.max(1, rail.x - g.margin),
      h: g.rowHeight,
      bind: {
        // no icon: a node says how it is tied to the mesh under its name, and its Wi-Fi at the right of it, each in the colour of its signal
        label: `$list.rows.${k}.label`,
        hint: `$list.rows.${k}.hint`,
        hintColor: `$list.rows.${k}.hintColor`,
        tail: `$list.rows.${k}.tail`,
        tailColor: `$list.rows.${k}.tailColor`,
        on: `$list.rows.${k}.on`,
        onChange: `$list.rows.${k}.tap`,
        onHold: `$list.rows.${k}.hold`,
      },
    })),
  ];
  return { id, title: "Mesh", role: "mesh", place };
}

/**
 * The lock: the title, which says what to do and what went
 * wrong and cancels when tapped, and the pattern pad under it, as large as the
 * room allows up to 96 px a cell -- 234 px on the EU panel, 288 on the US.
 */
export function lockScreen(theme: string, grid: Grid, id = "lock"): TemplateScreen {
  const g = SCREEN_GEOMETRY;
  const w = Math.max(1, grid.w - g.margin * 2);
  const top = g.navHeaderHeight + g.headerGap;
  const room = Math.max(1, grid.h - top);
  const side = Math.min(w, room, 3 * 96);
  const header = headerBox(grid);
  const place: TemplatePlacement[] = [
    {
      component: `${theme}/nav-header`, x: header.x, y: 0, w: header.w, h: g.navHeaderHeight,
      bind: { title: "$lock.title", onClose: "$nav.close" },
    },
    {
      component: `${theme}/pattern-pad`,
      x: Math.floor((grid.w - side) / 2), y: top + Math.floor((room - side) / 2), w: side, h: side,
      bind: { wrong: "$lock.wrong", onTry: "$lock.try" },
    },
  ];
  return { id, title: "Draw pattern", role: "lock", place };
}

/**
 * Help: no rail. It never has more than one page in this project,
 * so the rail is left out ENTIRELY rather than placed with
 * `pageCount: 1` -- a placement still costs its box even when it draws
 * nothing (placements may not overlap, checkPlacements), so a screen that
 * is not paginated gets the full margin every other one-page screen uses
 * (`light-detail`, `home`), not a dead gutter reserved for a rail that is
 * never there. Title and body both come from `$help.*`, filled in by
 * whichever row's long press opened it (the runtime fills them from that
 * item's own `help` lines before -- in the simulator -- or right after -- on
 * the glass -- the jump).
 */
export function helpScreen(theme: string, grid: Grid, id = "help"): TemplateScreen {
  const g = SCREEN_GEOMETRY;
  const w = Math.max(1, grid.w - g.margin * 2);
  const header = headerBox(grid);
  const place: TemplatePlacement[] = [
    {
      component: `${theme}/nav-header`, x: header.x, y: 0, w: header.w, h: g.navHeaderHeight,
      bind: { title: "$help.title", onClose: "$nav.close" },
    },
    ...Array.from({ length: g.helpLineCount }, (_, i): TemplatePlacement => ({
      component: `${theme}/label`,
      x: g.margin,
      y: g.navHeaderHeight + g.headerGap + i * g.helpLineHeight,
      w, h: g.helpLineHeight,
      bind: { text: `$help.lines.${i}`, tone: "muted" },
    })),
  ];
  return { id, title: "Help", role: "help", place };
}

/** How many lines the QR's page carries beside its code: the network, its password, the address, and what is happening. */
export const QR_LINES = 4;

/**
 * The QR's page, as a TEMPLATE: the Hotspot's, which is also the
 * Web setup's. A code a phone's camera reads to join the panel's network, and
 * beside it -- under it on the portrait -- the network's name, its password,
 * where the phone goes and what is happening, one line each; and at the
 * bottom, where the thumb is, the way to stop it, as a row of the list's
 * (`$list.rows.0`), so a tap on it is the list's tap. The title is the list's
 * too, and its tap the way back.
 *
 * A page of its own because a Nextion Qrcode reserves 2.8 KB of the page's
 * 3.5 KB, and little else fits beside one: one QR a page is a
 * rule of the design.
 */
export function qrScreen(theme: string, grid: Grid, id = "qr"): TemplateScreen {
  const g = SCREEN_GEOMETRY;
  const header = headerBox(grid);
  const top = g.navHeaderHeight + g.headerGap;
  const place: TemplatePlacement[] = [
    {
      component: `${theme}/nav-header`, x: header.x, y: 0, w: header.w, h: g.navHeaderHeight,
      bind: { title: "$list.title", onClose: "$nav.close" },
    },
  ];
  const line = (x: number, y: number, w: number, i: number): TemplatePlacement => ({
    component: `${theme}/label`, x, y, w, h: g.helpLineHeight, bind: { text: `$qr.lines.${i}` },
  });
  const row = (x: number, w: number): TemplatePlacement => ({
    component: `${theme}/list-row`, variant: "flush", x, y: grid.h - g.rowHeight, w, h: g.rowHeight,
    bind: { label: "$list.rows.0.label", on: "$list.rows.0.on", onChange: "$list.rows.0.tap", onHold: "$list.rows.0.hold" },
  });
  if (grid.w > grid.h) {
    // the code at the left, as tall as the room under the header allows and no
    // wider than half the glass; the lines and the row in the column beside it
    const side = Math.max(1, Math.min(grid.h - top - g.headerGap, Math.floor((grid.w - 3 * g.margin) / 2)));
    const x = g.margin + side + g.margin;
    const w = Math.max(1, grid.w - g.margin - x);
    place.push({ component: `${theme}/qr-code`, x: g.margin, y: top, w: side, h: side, bind: { code: "$qr.code" } });
    for (let i = 0; i < QR_LINES; i++) place.push(line(x, top + i * g.helpLineHeight, w, i));
    place.push(row(x, w));
  } else {
    // the code on top, centred; the lines under it, and the row at the bottom
    const rowTop = grid.h - g.rowHeight;
    const linesTop = rowTop - QR_LINES * g.helpLineHeight;
    const side = Math.max(1, Math.min(grid.w - 2 * g.margin, linesTop - top - g.headerGap));
    const w = Math.max(1, grid.w - 2 * g.margin);
    place.push({ component: `${theme}/qr-code`, x: Math.floor((grid.w - side) / 2), y: top, w: side, h: side, bind: { code: "$qr.code" } });
    for (let i = 0; i < QR_LINES; i++) place.push(line(g.margin, linesTop + i * g.helpLineHeight, w, i));
    place.push(row(g.margin, w));
  }
  return { id, title: "Hotspot", role: "qr", place };
}

/**
 * The safeboot's page: what the panel shows while the safeboot image writes the firmware, and when it stops
 * there. No runtime of the app writes to it: the safeboot draws it over the screen's serial, with neither Berry nor the
 * manifest, so it addresses each component by the name the placement order gives it, the same on every theme and both
 * panels (`SAFEBOOT_NAMES`, which a test holds every project to):
 *
 *   t0 the title and t1 the node's name, always;
 *   taking turns as the STATUS: t2 the percentage, t3 the bar's place (an empty label in the accent, whose box and colour
 *   the safeboot reads and fills), t4 to t7 the lines, t8 the warning;
 *   taking turns as the CODE: qCode9, the Hotspot's QR, and t10 and t11, its network and its address;
 *   bRow12 and bRow13, the two buttons (Open hotspot or Close hotspot, and Restart), hidden while it writes.
 *
 * The QR carries `SAFEBOOT_QR_CAPACITY` bytes, an open network's `WIFI:` string: under 107 a Nextion Qrcode holds back no
 * page RAM, which is what lets it share a page with eleven texts.
 */
export function safebootScreen(theme: string, grid: Grid, id = "safeboot"): TemplateScreen {
  const g = SCREEN_GEOMETRY;
  const line = g.helpLineHeight;
  const w = Math.max(1, grid.w - 2 * g.margin);
  const text = (x: number, y: number, width: number, h: number, path: string, tone: string, turn?: string, align?: string): TemplatePlacement => ({
    component: `${theme}/label`, x, y, w: width, h,
    bind: { text: path, tone, ...(align ? { align } : {}), ...(turn ? { visible: `$safeboot.${turn}.shown` } : {}) },
    ...(turn ? { alternate: turn } : {}),
  });
  const button = (x: number, y: number, width: number, k: number): TemplatePlacement => ({
    component: `${theme}/list-row`, variant: "button", x, y, w: width, h: g.rowHeight,
    bind: { label: `$safeboot.buttons.${k}.label`, on: 0, onChange: `$safeboot.buttons.${k}.tap`, visible: `$safeboot.buttons.shown` },
    alternate: "actions",
  });
  const head: TemplatePlacement[] = [
    text(g.margin, 4, w, 48, "$safeboot.title", "title"),
    text(g.margin, 52, w, line, "$safeboot.node", "muted"),
  ];
  const top = g.navHeaderHeight + g.headerGap;
  if (grid.w > grid.h) {
    // the buttons side by side at the bottom; the status above them, its last line and the warning where the buttons are,
    // which it shows only while they are hidden; the code at the left, its two lines beside it
    const buttonsTop = grid.h - g.rowHeight;
    const half = Math.floor((w - g.margin) / 2);
    const side = Math.max(1, buttonsTop - top - g.headerGap);
    const beside = g.margin + side + g.margin;
    return {
      id, title: "Safeboot", role: "safeboot", place: [
        ...head,
        text(g.margin, top, w, 48, "$safeboot.big", "title", "status"),
        text(g.margin, top + 52, w, 12, "", "accent", "status"),
        ...Array.from({ length: SAFEBOOT_LINES }, (_, i) => text(g.margin, top + 68 + i * line, w, line, `$safeboot.lines.${i}`, "muted", "status")),
        text(g.margin, top + 68 + SAFEBOOT_LINES * line, w, line, "$safeboot.warn", "warn", "status"),
        { component: `${theme}/qr-code`, x: g.margin, y: top, w: side, h: side, bind: { code: "$safeboot.code", capacity: SAFEBOOT_QR_CAPACITY, visible: "$safeboot.code.shown" }, alternate: "code" },
        text(beside, top, Math.max(1, grid.w - g.margin - beside), line, "$safeboot.network", "body", "code"),
        text(beside, top + line, Math.max(1, grid.w - g.margin - beside), line, "$safeboot.address", "muted", "code"),
        button(g.margin, buttonsTop, half, 0),
        button(g.margin + half + g.margin, buttonsTop, w - half - g.margin, 1),
      ],
    };
  }
  // the portrait: the status under the title, the warning over the buttons; the code where the status is, its lines under it
  const buttonsTop = grid.h - 2 * g.rowHeight;
  const warnTop = buttonsTop - line - 6;
  const linesTop = top + 80;
  const side = Math.max(1, Math.min(w, buttonsTop - 2 * line - top - g.headerGap));
  return {
    id, title: "Safeboot", role: "safeboot", place: [
      ...head,
      text(g.margin, top + 6, w, 48, "$safeboot.big", "title", "status", "center"),
      text(g.margin, top + 60, w, 12, "", "accent", "status"),
      ...Array.from({ length: SAFEBOOT_LINES }, (_, i) => text(g.margin, linesTop + i * line, w, line, `$safeboot.lines.${i}`, "muted", "status")),
      text(g.margin, warnTop, w, line, "$safeboot.warn", "warn", "status", "center"),
      { component: `${theme}/qr-code`, x: Math.floor((grid.w - side) / 2), y: top, w: side, h: side, bind: { code: "$safeboot.code", capacity: SAFEBOOT_QR_CAPACITY, visible: "$safeboot.code.shown" }, alternate: "code" },
      text(g.margin, top + side + 2, w, line, "$safeboot.network", "body", "code", "center"),
      text(g.margin, top + side + 2 + line, w, line, "$safeboot.address", "muted", "code", "center"),
      button(g.margin, buttonsTop, w, 0),
      button(g.margin, buttonsTop + g.rowHeight, w, 1),
    ],
  };
}

/** The safeboot page's lines of status: the block, who sends, the time left, and the fourth the US portrait has room for. */
export const SAFEBOOT_LINES = 4;

/** The bytes the safeboot's QR carries: `WIFI:T:nopass;S:<network>;;` for a network name of up to 32. */
export const SAFEBOOT_QR_CAPACITY = 64;

/** The names the safeboot addresses its page's components by, in the placement order of `safebootScreen`. */
export const SAFEBOOT_NAMES = ["t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "qCode9", "t10", "t11", "bRow12", "bRow13"] as const;

/** How many lines a dialog's body carries at most: a sentence or two, broken where the glass is. */
export const DIALOG_LINES_MAX = 4;

/**
 * A confirmation, as a TEMPLATE: what destroys asks first,
 * and says what it will do in a sentence.
 *
 * The header's title is the question, and its tap is the way back, which is
 * Cancel. Under it the sentence, over as many 28 px lines as the room leaves,
 * which the runtime breaks at the lines' own width (the generated `wrap`).
 * At the bottom, where the thumb is, the two answers as rows: the one that
 * destroys, in the theme's destructive colour, and Cancel under it. The rows
 * are the list's own slots (`$list.rows.0` and `.1`), so a tap on one is the
 * list's tap, and the view is the list's. A sentence in a list's first row would
 * be cut at the label's box ("Its 12 devic.." on the US portrait) and drawn like
 * the rows a finger can press.
 */
export function dialogScreen(theme: string, grid: Grid, id = "confirm"): TemplateScreen {
  const g = SCREEN_GEOMETRY;
  const header = headerBox(grid);
  const w = Math.max(1, grid.w - g.margin * 2);
  const answersTop = grid.h - 2 * g.rowHeight;
  const bodyTop = g.navHeaderHeight + g.headerGap;
  const lines = Math.max(1, Math.min(DIALOG_LINES_MAX, Math.floor((answersTop - bodyTop) / g.helpLineHeight)));
  const place: TemplatePlacement[] = [
    {
      component: `${theme}/nav-header`, x: header.x, y: 0, w: header.w, h: g.navHeaderHeight,
      bind: { title: "$list.title", onClose: "$nav.close" },
    },
    ...Array.from({ length: lines }, (_, i): TemplatePlacement => ({
      component: `${theme}/label`,
      x: g.margin,
      y: bodyTop + i * g.helpLineHeight,
      w, h: g.helpLineHeight,
      bind: { text: `$dialog.lines.${i}` },
    })),
    ...[0, 1].map((k): TemplatePlacement => ({
      component: `${theme}/list-row`,
      variant: "flush",
      x: g.margin,
      y: answersTop + k * g.rowHeight,
      w,
      h: g.rowHeight,
      bind: {
        label: `$list.rows.${k}.label`,
        on: `$list.rows.${k}.on`,
        onChange: `$list.rows.${k}.tap`,
        onHold: `$list.rows.${k}.hold`,
      },
    })),
  ];
  return { id, title: "Confirm", role: "dialog", place };
}
