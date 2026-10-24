// Tailwind's scale, as layout.
//
// This theme says "heading" with SIZE, and that is the one way of saying it the
// panel can carry -- a different font file, which is exactly what the hardware
// trades in. The `title` role is 32 pixels, like the other two (a portrait
// header holds seven characters at 48), and the source fonts have nothing between.
// What still says "Tailwind" is the rest of the scale: the 40-pixel rail and
// the 80-pixel clock.
//
// DRAWING FOR THE GLASS -- read docs/09-drawing-for-the-glass.md
// before changing a layout here. The short form, each line measured:
//   colour     RGB565: 32 levels of R/B, 64 of G; no alpha, shadow, blur or gradient attribute
//   text       five font roles, fixed sizes; no tracking, leading or synthetic weight
//   shape      a rectangle with sides >= 2 px; a border IS a component; radius only inside a picture
//   pictures   the codec pays per run: flat rows and vertical change are cheap, dither is 4x, hue is rich
//   touch      7-12 mm = 46-78 px of target; the box may be bigger than the drawing
//   budget     3 584 B of RAM a page; a Text costs 10 + txt_maxl, a Slider 28, an icon glyph nothing
import type {
  ClockLayout, GradientSliderLayout, KeyboardLayout, LabelLayout, LightCardLayout, NavHeaderLayout,
  PageRailLayout, ListRowLayout, StatusIconLayout, ZoneCounterLayout, PatternPadLayout, QrCodeLayout, ToggleSwitchLayout, WeatherRowLayout,
} from "../components.js";
import { fieldLine, keyboardGeometry, keyboardKeys, keyboardSymbolKeys, keyboardT9Keys, keyId, layoutAction, waysOf, type KeyboardMap } from "../keyboard.js";
import {
  colorToken, columns, densitySpacing, literal, shownWhile, stackRows,
  type Action, type LayoutFn, type PanelNode, type Value,
} from "../node.js";
import { scrollbarNodes } from "../scrollbar.js";
import { listRowNodes, zoneCounterFaceNodes, zoneCounterNodes, type FaceLook } from "../listRow.js";
import { patternPadNodes } from "../patternPad.js";
import { qrCodeNodes } from "../qrCode.js";
import {
  dialogScreen as dialogScreenTemplate, headerAction, listScreen as listScreenTemplate, qrScreen as qrScreenTemplate, zoneScreen as zoneScreenTemplate, thermostatScreen as thermostatScreenTemplate, coverScreen as coverScreenTemplate, houseScreen as houseScreenTemplate, meshScreen as meshScreenTemplate, lightDetailScreen as lightDetailScreenTemplate, helpScreen as helpScreenTemplate, lockScreen as lockScreenTemplate, safebootScreen as safebootScreenTemplate, SCREEN_GEOMETRY,
  type Grid, type TemplateScreen,
} from "../screenTemplates.js";

/** The letters of a keypad key as CAPS writes them. */
const cycleUpper = (cycle: readonly string[]): string => (cycle.slice(0, -1).join("").trim() || "_").toUpperCase();

export const label: LayoutFn<LabelLayout> = (props, size) => {
  const tone = props.tone ?? "body";
  return [
    {
      kind: "text",
      id: "t",
      box: { x: 0, y: 0, w: size.w, h: size.h },
      value: props.text,
      font: tone === "title" ? "title" : "body",
      color: tone === "muted" ? "text-secondary" : tone === "accent" ? "accent-blue" : tone === "warn" ? "signal-fair" : "text-primary",
      align: props.align ?? "left",
      valign: "middle",
    },
  ];
};

/**
 * The joBr99 rail: the WHOLE track carries the dimension's ramp instead of a
 * single-colour fill up to the value -- the same pattern as Home Assistant's
 * ha-control-slider, which is where the look comes from. The pointer is a thin
 * white bar that only marks the position.
 *
 * Forty, because this theme says everything with size.
 *
 * The track is 40 pixels tall inside whatever box the project gives it, and
 * that is not cosmetic: the generated picture is exactly the track, so a
 * placement 98 pixels tall costs the bytes of 40 rows and not of 98. The rest of
 * the box is the finger's, which is the part a 12 mm target needs and a 40-pixel
 * ramp does not.
 */
export const gradientSlider: LayoutFn<GradientSliderLayout> = (props, size) => {
  const h = Math.min(props.trackHeight ?? 40, size.h);
  return [
    {
      kind: "slider",
      id: "h",
      // the whole placement is the Slider, so the whole placement is touch;
      // the rail the eye sees is the band the picture paints (paint.ts, lever 1)
      box: { x: 0, y: 0, w: size.w, h: size.h },
      value: props.pct,
      track: { kind: "ramp", ramp: props.ramp, height: h },
      pointerWidth: 4,
      pointerHeight: Math.max(4, h - 10),
      // a pill, which is what all three React tracks draw. It is not an
      // attribute on the glass -- it is painted into the picture, for free.
      radius: Math.round(h / 2),
      action: props.change,
      live: props.live,
    },
  ];
};

/**
 * THIS theme's clock model: the time as heavy as the token allows, and the date
 * in a filled chip under it -- how Tailwind's own documentation presents a
 * secondary fact next to a headline.
 *
 * The chip is a text node with a BACKGROUND, which a Nextion Text draws by
 * itself: `sta: 1` fills the box in `bco` before the letters, so the fill costs
 * no extra component. What it cannot do is the `borderRadius: 9999` -- the chip
 * is a rectangle on the glass. Making it a pill would mean generating a picture
 * behind it, the way the gradient track does (`paint.ts`); the mechanism is
 * there, and nobody has decided the pill is worth the bytes.
 */
export const clock: LayoutFn<ClockLayout> = (props, size, style) => {
  const { gap, pad } = densitySpacing(style);
  const [time, chip] = stackRows(size, [style.fontHeight.display, style.fontHeight.body + pad], gap);
  // the chip hugs its text rather than spanning the box, which is what a chip is
  const chipW = Math.max(1, Math.round(size.w * 0.45));
  return [
    { kind: "text", id: "tTime", box: time, value: props.time, font: "display", color: "text-primary", align: "center", valign: "middle" },
    {
      kind: "text", id: "tDate",
      box: { ...chip, x: Math.round((size.w - chipW) / 2), w: chipW },
      value: props.date, font: "body", color: "text-secondary", background: "card-background",
      align: "center", valign: "middle",
    },
  ];
};

/**
 * The current condition big and in the accent, the forecast in filled chips
 * beside it -- what Tailwind does with a list of small values.
 *
 * Chips rather than columns for a reason that is about this hardware: a filled
 * shape survives RGB565 where a hairline separator does not. A one-pixel border
 * in a near-neutral colour is exactly the detail that vanishes on the glass, so
 * this theme never leans on one.
 */
export const weatherRow: LayoutFn<WeatherRowLayout> = (props, size, style) => {
  const { gap, pad } = densitySpacing(style);
  const [current, ...rest] = props.items;
  if (!current) return [];
  const currentW = Math.round(size.w * 0.28);
  const chips = columns({ w: Math.max(1, size.w - currentW - gap), h: size.h }, Math.max(1, rest.length), gap);
  const nodes: PanelNode[] = [
    { kind: "text", id: "tNow", box: { x: 0, y: 0, w: currentW, h: size.h }, value: current.temp, font: "title", color: "accent-blue", align: "center", valign: "middle" },
  ];
  rest.forEach((item, i) => {
    const x = currentW + gap + chips[i].x;
    const inner = { w: chips[i].w, h: size.h - pad };
    const [label, temp] = stackRows(inner, [style.fontHeight.body, style.fontHeight.body], 0);
    nodes.push(
      { kind: "fill", id: `fChip${i}`, box: { x, y: Math.round(pad / 2), w: chips[i].w, h: inner.h }, color: "card-background" },
      { kind: "text", id: `tWd${i}`, box: { ...label, x, y: label.y + Math.round(pad / 2) }, value: item.label, font: "body", color: "text-secondary", background: "card-background", align: "center", valign: "middle" },
      { kind: "text", id: `tTemp${i}`, box: { ...temp, x, y: temp.y + Math.round(pad / 2) }, value: item.temp, font: "body", color: "text-primary", background: "card-background", align: "center", valign: "middle" },
    );
  });
  return nodes;
};

/**
 * The same icon on a filled chip: Tailwind's badge, and the counterpart of
 * shadcn's bordered square. It is one component where the outline is three,
 * which is the cheaper answer on this hardware -- and it is a rectangle rather
 * than a circle, because a Nextion fill has no radius and nobody has decided a
 * round plate is worth a generated picture.
 */
export const statusIcon: LayoutFn<StatusIconLayout> = (props, size) => [
  { kind: "fill", id: "fChip", box: { x: 0, y: 0, w: size.w, h: size.h }, color: "card-background" },
  { kind: "icon", id: "tIcon", box: { x: 0, y: 0, w: size.w, h: size.h }, role: (props.role ?? "lightOn"), color: props.color ?? colorToken("icon-low-sat"), background: "card-background", font: "icon" },
];

/**
 * Filled round buttons for the arrows and a heavy title, ending with space
 * rather than a rule -- Tailwind separates by elevation and gap. The fill is
 * real on the glass; the roundness is not, and is the part that goes.
 */
export const navHeader: LayoutFn<NavHeaderLayout> = (props, size, style) => {
  const side = Math.min(SCREEN_GEOMETRY.headerIconWidth, size.h, Math.floor(size.w / 3));
  // A gutter only where an icon actually sits -- see lovelace-jobr99's
  // navHeader for why: the common case has no prev arrow, and the title
  // should start at the same x as the content under it, not centred away
  // from it for a gap nothing occupies. And the whole icon box where one does
  // sit: its filled square is drawn after the title and is opaque, so a title
  // let run under it would be covered by it. `close` takes
  // no slot: there is no X, the title is the way back (NavHeaderLayout.close).
  // the view's action takes the far right; a next arrow moves in beside it
  // the action to the visible edge (`headerBox`); with nothing on the right,
  // the title keeps the margin there
  const act = headerAction(size.w);
  const actionGutter = props.action ? act.touch.w : 0;
  const moreGutter = props.more ? side : 0;
  // the header's sign, left of the action and the options: a rail's width,
  // taken whether it shows or not (NavHeaderLayout.statusIcon)
  // -- when the title keeps at least as much, which only a degenerate box does not
  const leftGutter = props.prev ? side : 0;
  const others = leftGutter + (props.next ? side : 0) + actionGutter + moreGutter;
  const statusGutter = props.statusIcon !== undefined && size.w - others - act.glyph.w >= act.glyph.w ? act.glyph.w : 0;
  const rightGutter = Math.max((props.next ? side : 0) + actionGutter + moreGutter + statusGutter, act.room);
  const titleBox = { x: leftGutter, y: 0, w: Math.max(1, size.w - leftGutter - rightGutter), h: size.h };
  const nodes: PanelNode[] = [
    { kind: "text", id: "tTitle", box: titleBox, value: props.title, font: "title", color: "text-primary", align: "left", valign: "middle" },
  ];
  // The title's gestures, over the words: a tap leaves, a long press opens the
  // keyboard. A Hotspot and not a touch on the Text, for the reason
  // lovelace-jobr99 gives: a heading can be restyled without the gesture moving.
  if (props.close || props.editTitle) nodes.push({ kind: "touch", id: "mTitle", box: titleBox, action: props.close, hold: props.editTitle });
  const arrow = (id: string, role: string | Value, x: number, action: Action) => ([
    { kind: "fill" as const, id: `f${id}`, box: { x, y: 0, w: side, h: size.h }, color: "card-background" },
    { kind: "icon" as const, id: `t${id}`, box: { x, y: 0, w: side, h: size.h }, role, color: colorToken("text-primary"), background: "card-background", font: "icon" as const },
    { kind: "touch" as const, id: `m${id}`, box: { x, y: 0, w: side, h: size.h }, action },
  ]);
  if (props.prev) nodes.push(...arrow("Prev", "navPrev", 0, props.prev));
  if (props.next) nodes.push(...arrow("Next", "navNext", size.w - actionGutter - moreGutter - statusGutter - side, props.next));
  // the sign, a glyph alone in the accent: something is open that the eye should find
  if (props.statusIcon !== undefined && statusGutter > 0) {
    nodes.push({
      kind: "icon", id: "tStatus", box: { x: size.w - actionGutter - moreGutter - statusGutter, y: 0, w: statusGutter, h: size.h },
      role: props.statusIcon, color: colorToken("accent-blue"), font: "icon", shownBy: shownWhile(props.statusIcon),
    });
  }
  // The action's plate is the glyph's own box, filled: a Text paints its whole
  // box in its background. There only while the view has an action: an empty
  // filled square on a view without one would be a button that does nothing.
  // The plate is the glyph's box, on the rail's axis; the touch runs wider,
  // to the visible edge.
  if (props.action) {
    const shownBy = shownWhile(props.actionIcon);
    nodes.push({ kind: "icon", id: "tAction", box: { x: act.glyph.x, y: 0, w: act.glyph.w, h: size.h }, role: props.actionIcon ?? "add", color: props.actionIconColor ?? colorToken("text-primary"), background: "card-background", font: "icon", shownBy });
    nodes.push({ kind: "touch", id: "mAction", box: { x: act.touch.x, y: 0, w: act.touch.w, h: size.h }, action: props.action, hold: props.actionHold, shownBy });
  }
  // the view's options, the ⋯, beside the action
  if (props.more) nodes.push(...arrow("More", "more", size.w - actionGutter - side, props.more));
  void style;
  return nodes;
};

/**
 * A paged list's scrollbar, on the right under the header
 * (screenTemplates.ts `railColumn`): the groove in the colour of what is off,
 * as the other two themes draw it. How it works is shared by every theme
 * (`scrollbar.ts`); only the colour is this one's. The border tone is 2:1 on
 * the page, and the thumb would seem to float with no track under it.
 */
export const pageRail: LayoutFn<PageRailLayout> = (props, size) => scrollbarNodes(props, size, { groove: "icon-off" });

/** A filled surface, which is how Tailwind says "card" -- no border anywhere. */
export const lightCard: LayoutFn<LightCardLayout> = (props, size, style) => {
  const iconH = Math.min(style.fontHeight["icon-large"], Math.round(size.h * 0.55));
  const nameH = Math.min(style.fontHeight.body, Math.max(1, size.h - iconH));
  return [
    { kind: "fill", id: "bCard", box: { x: 0, y: 0, w: size.w, h: size.h }, color: "card-background" },
    { kind: "icon", id: "tIcon", box: { x: 0, y: 0, w: size.w, h: iconH }, role: props.icon, color: props.iconColor, background: "card-background", font: "icon-large" },
    { kind: "text", id: "tName", box: { x: 0, y: size.h - nameH, w: size.w, h: nameH }, value: props.name, font: "body", color: "text-primary", background: "card-background", align: "center", valign: "middle" },
    // The touch is a Hotspot ON TOP, and it has to be. Measured in the Editor's
    // debugger: when components overlap, the
    // TOPMOST one takes the press -- even a Text with no event at all, which
    // simply swallows it. With the tap on the fill underneath, the icon and the
    // name would be dead pixels: two thirds of this card, and exactly the two
    // thirds anyone aims at.
    { kind: "touch", id: "mCard", box: { x: 0, y: 0, w: size.w, h: size.h }, action: props.tap, hold: props.hold },
  ];
};

/**
 * A row of a list: the shared layout (`listRow.ts`), in this theme's colours --
 * the name lit in the accent, a muted hint and tail, and a plain icon colour.
 */
export const listRow: LayoutFn<ListRowLayout> = (props, size) =>
  listRowNodes(props, size, { lit: "accent-blue", unlit: "text-primary", quiet: "text-secondary", icon: "icon-off", danger: "accent-red" });

/** The generic list's row: the label from the row's left edge, and the icon after it (`listRowNodes`, flush). */
export const listRowFlush: LayoutFn<ListRowLayout> = (props, size) =>
  listRowNodes(props, size, { lit: "accent-blue", unlit: "text-primary", quiet: "text-secondary", icon: "icon-off", danger: "accent-red" }, "flush");

/** The tall list's row: the name over the value, the glyph at the end (`listRowNodes`, stacked). */
export const listRowStacked: LayoutFn<ListRowLayout> = (props, size) =>
  listRowNodes(props, size, { lit: "accent-blue", unlit: "text-primary", quiet: "text-secondary", icon: "icon-off", danger: "accent-red" }, "stacked");

/** A zone's device row: the name, and the icon at the right end (`listRowNodes`, device). */
export const listRowDevice: LayoutFn<ListRowLayout> = (props, size) =>
  listRowNodes(props, size, { lit: "accent-blue", unlit: "text-primary", quiet: "text-secondary", icon: "icon-off", danger: "accent-red" }, "device");

/** A counter of a zone's top card: the shared layout, in this theme's colours. */
export const zoneCounter: LayoutFn<ZoneCounterLayout> = (props, size) =>
  zoneCounterNodes(props, size, { count: "text-primary", icon: "icon-off" });

/**
 * The faces of the thermostat's page: the cards' face with the plain text, and lit, the accent with the
 * page's dark words, as the keyboard's OK key; the press in the theme's `pressed`, painted by the glass.
 */
const FACES: FaceLook = { face: "plan-card", text: "text-primary", litFace: "accent-blue", litText: "background", pressed: "pressed" };

/** A row that is a button: the thermostat's modes, side by side (`listRowNodes`, button). */
export const listRowButton: LayoutFn<ListRowLayout> = (props, size) =>
  listRowNodes(props, size, { lit: "accent-blue", unlit: "text-primary", quiet: "text-secondary", icon: "icon-off", danger: "accent-red" }, "button", FACES);

/** A counter with a face and no number: the thermostat's - and + (`zoneCounterFaceNodes`). */
export const zoneCounterFace: LayoutFn<ZoneCounterLayout> = (props, size) =>
  zoneCounterFaceNodes(props, size, { count: "text-primary", icon: "icon-off" }, FACES);

/** The lock's pattern pad: the shared layout, the dots in the plain icon colour, lit in the accent. */
export const patternPad: LayoutFn<PatternPadLayout> = (props, size) =>
  patternPadNodes(props, size, { dot: "icon-off", lit: "accent-blue", wrong: "accent-red" });

/** The QR code: the shared layout, dark on this theme's lightest text colour (`qrCode.ts`). */
export const qrCode: LayoutFn<QrCodeLayout> = (props, size) =>
  qrCodeNodes(props, size, { dark: "background", light: "text-primary" });

/**
 * The big rounded-full rail Tailwind's own docs show, with a large knob and the
 * accent filling the whole thing when on. No border: this theme says "on" with
 * fill, the same decision its cards make.
 *
 * It is also the most expensive switch of the three, and for a stated reason:
 * the rail is generated as two pictures and it is the biggest of them, so a
 * chunkier control really does cost more flash here.
 */
export const toggleSwitch: LayoutFn<ToggleSwitchLayout> = (props, size) => {
  const h = Math.min(32, size.h);
  const w = Math.min(60, size.w);
  return [
    {
      kind: "toggle",
      id: "btSwitch",
      box: { x: Math.round((size.w - w) / 2), y: Math.round((size.h - h) / 2), w, h },
      value: props.on,
      off: "card-background",
      on: "accent-blue",
      knob: "text-primary",
      art: true,
      radius: Math.round(h / 2),
      action: props.change,
      mirror: props.mirror,
    },
  ];
};

/**
 * The keyboard, Tailwind's way: the line you are typing is the loud thing.
 *
 * This theme says "heading" with SIZE -- its `title` role is a 48-pixel cut
 * against 32 in the other two -- so the field gets the room that needs and the
 * keys give it up: a 3-pixel gap instead of 4 or 6, which buys the taller
 * field back and makes every key slightly wider in the bargain.
 */
const keyboardWith = (map: KeyboardMap): LayoutFn<KeyboardLayout> => (props, size, style) => {
  const field = Math.min(72, Math.max(style.fontHeight.title + 12, 56));
  // NO MARGIN. The keyboard is the one screen where every pixel is a bigger
  // target: it already owns the whole visible panel, and a margin there only
  // shrinks forty-four keys to draw empty space against an edge that is already
  // the edge of the glass. The EU panel's own
  // dead strip is handled where it belongs -- the placement is 450 wide, not
  // 480 -- so zero here means zero of what can be SEEN.
  const g = keyboardGeometry(size, { margin: 0, gap: 3, fieldHeight: field, fieldGap: 8 }, map);
  const nodes: PanelNode[] = [
    // the field, and the line inset in it (FIELD_INSET)
    { kind: "fill", id: "kbPad", box: g.field, color: "card-background" },
    {
      kind: "field", id: "kbField", box: fieldLine(g.field), value: props.value, max: props.max,
      font: "title", color: "text-primary", background: "card-background", align: "left",
    },
  ];
  for (const key of map.keys) {
    const box = g.box(key);
    // The digit over its letters, both centred, when the map asks for it and
    // there is room -- which is what every phone keypad looks like. Two Texts
    // over the key rather than one caption, because a Nextion Text is one line
    // and does not wrap.
    if (map.stacked && key.cycle && key.cycle.length > 1) {
      const half = Math.floor(box.h / 2);
      nodes.push({
        kind: "key", id: keyId(key), box, touch: g.cell(key), role: key.role, cap: "",
        cycle: key.cycle, cycleCaps: key.cycleCaps,
        color: "card-background", textColor: "text-primary", font: "body",
      });
      nodes.push({
        kind: "text", id: `n${keyId(key).slice(1)}`,
        box: { x: box.x, y: box.y, w: box.w, h: half },
        value: literal(key.cycle[key.cycle.length - 1]),
        font: "title", color: "text-primary", background: "card-background",
        align: "center", valign: "middle",
      });
      nodes.push({
        kind: "text", id: `l${keyId(key).slice(1)}`,
        box: { x: box.x, y: box.y + half, w: box.w, h: box.h - half },
        value: literal(key.cycle.slice(0, -1).join("").trim() || "_"),
        // The letters say which case they will type. The digit above them does
        // not change, so it stays out of the rewrite.
        // signs have no case, and stay out of the rewrite (the signs' keypad)
        ...(cycleUpper(key.cycle) !== (key.cycle.slice(0, -1).join("").trim() || "_") ? { capsValue: cycleUpper(key.cycle) } : {}),
        font: "body", color: "text-secondary", background: "card-background",
        align: "center", valign: "middle",
      });
      continue;
    }
    nodes.push({
      kind: "key", id: keyId(key), box, touch: g.cell(key),
      role: key.role, to: key.to, cap: key.cap, capsCap: key.capsCap, capIcon: key.capIcon,
      cycle: key.cycle, cycleCaps: key.cycleCaps,
      color: key.role === "commit" ? "accent-blue" : key.role === "cancel" ? "accent-red" : "card-background",
      activeColor: key.role === "caps" ? "accent-blue" : undefined,
      // On an accent face the caption is the page's colour: white
      // on a light accent reads at 2 to 2.6:1, under the 3:1 a large caption
      // needs.
      textColor: key.role === "commit" || key.role === "cancel" ? "background" : "text-primary",
      font: "body",
      action: key.role === "commit" ? props.commit
        : key.role === "cancel" ? props.cancel
        : key.role === "layout" ? layoutAction(props, key.to)
        : undefined,
    });
  }
  return nodes;
};

/** QWERTY, which is different on the two panels (`keyboardKeys`). */
export const keyboard: LayoutFn<KeyboardLayout> = (props, size, style) =>
  keyboardWith(keyboardKeys(size))(props, size, style);

/** The T9 keypad, which is the same twelve keys on both. */
export const keyboardT9: LayoutFn<KeyboardLayout> = (props, size, style) =>
  keyboardWith(keyboardT9Keys(size, waysOf(props)))(props, size, style);

/** The symbols, in the letters frame (`keyboardSymbolKeys`). */
export const keyboardSymbols: LayoutFn<KeyboardLayout> = (props, size, style) =>
  keyboardWith(keyboardSymbolKeys(size, waysOf(props)))(props, size, style);

// Screen templates -- Settings (however many pages) and Help -- bound to
// THIS theme's own component ids. The geometry is shared (`screenTemplates.js`,
// one set of measurements for every theme); what is theme-specific is only
// the string a project ends up with, `tailwind-slate/nav-header` and not
// some other theme's. A project imports these the same way it already
// reaches this theme's `navHeader`: `tailwindSlate.settingsScreen(...)`.
export const listScreen = (grid: Grid, id?: string): TemplateScreen =>
  listScreenTemplate("tailwind-slate", grid, id);
export const dialogScreen = (grid: Grid, id?: string): TemplateScreen =>
  dialogScreenTemplate("tailwind-slate", grid, id);
export const qrScreen = (grid: Grid, id?: string): TemplateScreen =>
  qrScreenTemplate("tailwind-slate", grid, id);
export const zoneScreen = (grid: Grid, id?: string): TemplateScreen =>
  zoneScreenTemplate("tailwind-slate", grid, id);
export const lockScreen = (grid: Grid, id?: string): TemplateScreen =>
  lockScreenTemplate("tailwind-slate", grid, id);
/** The safeboot's page, from the shared template. */
export const safebootScreen = (grid: Grid, id?: string): TemplateScreen =>
  safebootScreenTemplate("tailwind-slate", grid, id);
/** The thermostat's screen, from the shared template. */
export const thermostatScreen = (grid: Grid, id?: string): TemplateScreen =>
  thermostatScreenTemplate("tailwind-slate", grid, id);
export const coverScreen = (grid: Grid, id?: string): TemplateScreen =>
  coverScreenTemplate("tailwind-slate", grid, id);
export const houseScreen = (grid: Grid, id?: string): TemplateScreen =>
  houseScreenTemplate("tailwind-slate", grid, id);
/** The mesh's own page, its nodes under its cog. */
export const meshScreen = (grid: Grid, id?: string): TemplateScreen =>
  meshScreenTemplate("tailwind-slate", grid, id);
/** A lamp's detail, from the shared template. */
export const lightDetailScreen = (grid: Grid, id?: string): TemplateScreen =>
  lightDetailScreenTemplate("tailwind-slate", grid, id);

export const helpScreen = (grid: Grid, id?: string): TemplateScreen =>
  helpScreenTemplate("tailwind-slate", grid, id);
