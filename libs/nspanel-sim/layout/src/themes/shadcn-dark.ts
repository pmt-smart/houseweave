// shadcn's restraint, as layout.
//
// The React version said "this is a heading" with letter spacing (-0.2 on a
// title, +0.2 on a label) rather than with size, which was the whole identity of
// the type here. A Nextion Text has no tracking attribute, so that identity does
// not reach the glass and the letter spacing is gone -- the simulator was
// drawing a distinction the panel cannot make.
//
// What is left of the restraint is real and does compile: the title cut is
// `title-32`, the same 32 pixels as the base theme and as Tailwind (48 would hold
// seven characters across a portrait header), so the size does not tell them apart.
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
  type Action, type Box, type LayoutFn, type PanelNode, type Value,
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
 * Twenty-four, because restraint is this theme's whole identity: it is the one that does not get bigger.
 *
 * The track is 24 pixels tall inside whatever box the project gives it, and
 * that is not cosmetic: the generated picture is exactly the track, so a
 * placement 98 pixels tall costs the bytes of 24 rows and not of 98. The rest of
 * the box is the finger's, which is the part a 12 mm target needs and a 24-pixel
 * ramp does not.
 */
export const gradientSlider: LayoutFn<GradientSliderLayout> = (props, size) => {
  const h = Math.min(props.trackHeight ?? 24, size.h);
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
 * THIS theme's clock model, and it is a different model rather than a different
 * skin: the date sits ABOVE the time as a small muted label -- how shadcn labels
 * a value -- and there is no rule, because this design separates with space and
 * never with a line under a heading.
 *
 * The uppercase and the 1.5 of tracking are gone: a Nextion Text has neither,
 * and the label's case is whatever the backend sends. What remains and does
 * compile is the ORDER -- date first -- and the muted colour, which is most of
 * the identity.
 */
export const clock: LayoutFn<ClockLayout> = (props, size, style) => {
  const { gap } = densitySpacing(style);
  const [date, time] = stackRows(size, [style.fontHeight.body, style.fontHeight.display], gap);
  return [
    { kind: "text", id: "tDate", box: date, value: props.date, font: "body", color: "text-secondary", align: "center", valign: "middle" },
    { kind: "text", id: "tTime", box: time, value: props.time, font: "display", color: "text-primary", align: "center", valign: "middle" },
  ];
};

/**
 * Five equal cells with a thin rule between them -- shadcn's way of showing a row
 * of related values, and the reason its Separator exists. No cell is larger than
 * the others: the current condition is told apart by being FIRST and by carrying
 * the foreground colour while the forecast sits in the muted one. Hierarchy from
 * colour and order rather than from type size, which is the house style.
 *
 * The rule is a one-pixel `fill`, not a CSS border: the glass has no borders,
 * and a hairline that only the browser drew would be one more thing the panel
 * silently disagreed about.
 */
export const weatherRow: LayoutFn<WeatherRowLayout> = (props, size, style) => {
  const cells = columns(size, props.items.length || 1);
  const { gap } = densitySpacing(style);
  return props.items.flatMap((item, i) => {
    const inner = { w: cells[i].w, h: size.h };
    const [label, temp] = stackRows(inner, [style.fontHeight.body, style.fontHeight.body], gap);
    // Clear of the rule at the cell's left edge: a Text paints its whole box,
    // and a cell's Texts started on the rule's column would paint over it and
    // draw each rule in three pieces.
    const rule = i > 0 && style.borderWidth > 0 ? style.borderWidth : 0;
    const at = (box: Box) => ({ ...box, x: cells[i].x + box.x + rule, w: Math.max(0, box.w - rule) });
    const nodes: PanelNode[] = [
      { kind: "text", id: `tWd${i}`, box: at(label), value: item.label, font: "body", color: "text-secondary", align: "center", valign: "middle" },
      { kind: "text", id: `tTemp${i}`, box: at(temp), value: item.temp, font: "body", color: i === 0 ? "text-primary" : "text-secondary", align: "center", valign: "middle" },
    ];
    if (i > 0 && style.borderWidth > 0)
      nodes.unshift({ kind: "fill", id: `fSep${i}`, box: { x: cells[i].x, y: 0, w: style.borderWidth, h: size.h }, color: "card-border" });
    return nodes;
  });
};

/**
 * The icon inside a small bordered square, the shape shadcn gives a badge that
 * carries an icon rather than text.
 *
 * The border is two fills and not an attribute: a Nextion component has a fill
 * colour and no edge, so an outline is the border colour with the page colour
 * inset on top of it. Two components for one border -- which is what an outline
 * costs here, and why this theme's plate is the expensive one and Tailwind's
 * filled chip is not.
 */
export const statusIcon: LayoutFn<StatusIconLayout> = (props, size, style) => {
  const b = Math.max(1, style.borderWidth);
  return [
    { kind: "fill", id: "fEdge", box: { x: 0, y: 0, w: size.w, h: size.h }, color: "card-border" },
    { kind: "fill", id: "fFace", box: { x: b, y: b, w: Math.max(1, size.w - b * 2), h: Math.max(1, size.h - b * 2) }, color: "background" },
    { kind: "icon", id: "tIcon", box: { x: b, y: b, w: Math.max(1, size.w - b * 2), h: Math.max(1, size.h - b * 2) }, role: (props.role ?? "lightOn"), color: props.color ?? colorToken("icon-low-sat"), background: "background", font: "icon" },
  ];
};

/**
 * The arrows as outline buttons and a rule along the bottom -- which is how
 * shadcn ends a header: the rule is part of the component, not a Divider dropped
 * after it.
 *
 * The touch target keeps the bare-finger minimum even though shadcn would draw
 * the button smaller. The size is the panel's rule; the border and the radius
 * are the theme's, and the radius is the part that does not survive.
 */
export const navHeader: LayoutFn<NavHeaderLayout> = (props, size, style) => {
  const rule = Math.max(1, style.borderWidth);
  const body = Math.max(1, size.h - rule);
  const side = Math.min(SCREEN_GEOMETRY.headerIconWidth, body, Math.floor(size.w / 3));
  const b = Math.max(1, style.borderWidth);
  // A gutter only where an icon actually sits -- see lovelace-jobr99's
  // navHeader for why: the common case has no prev arrow, and the title
  // should start at the same x as the content under it, not centred away
  // from it for a gap nothing occupies. And the whole icon box where one does
  // sit: its outlined square is drawn after the title and is opaque, so a title
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
  const titleBox = { x: leftGutter, y: 0, w: Math.max(1, size.w - leftGutter - rightGutter), h: body };
  const nodes: PanelNode[] = [
    // the title cut, as the other two themes' headers, and not `body`, the size of
    // every row under it
    { kind: "text", id: "tTitle", box: titleBox, value: props.title, font: "title", color: "text-primary", align: "left", valign: "middle" },
    { kind: "fill", id: "fRule", box: { x: 0, y: size.h - rule, w: size.w, h: rule }, color: "card-border" },
  ];
  // The title's gestures, over the words: a tap leaves, a long press opens the
  // keyboard. A Hotspot and not a touch on the Text, for the reason
  // lovelace-jobr99 gives: a heading can be restyled without the gesture moving.
  if (props.close || props.editTitle) nodes.push({ kind: "touch", id: "mTitle", box: titleBox, action: props.close, hold: props.editTitle });
  const arrow = (id: string, role: string | Value, x: number, action: Action) => ([
    { kind: "fill" as const, id: `f${id}`, box: { x, y: 0, w: side, h: body }, color: "card-border" },
    { kind: "fill" as const, id: `g${id}`, box: { x: x + b, y: b, w: Math.max(1, side - b * 2), h: Math.max(1, body - b * 2) }, color: "background" },
    // inside the outline: a Text paints its whole box, and one as big as the
    // outline would paint the page over it
    { kind: "icon" as const, id: `t${id}`, box: { x: x + b, y: b, w: Math.max(1, side - b * 2), h: Math.max(1, body - b * 2) }, role, color: colorToken("text-primary"), font: "icon" as const },
    { kind: "touch" as const, id: `m${id}`, box: { x, y: 0, w: side, h: body }, action },
  ]);
  if (props.prev) nodes.push(...arrow("Prev", "navPrev", 0, props.prev));
  if (props.next) nodes.push(...arrow("Next", "navNext", size.w - actionGutter - moreGutter - statusGutter - side, props.next));
  // the sign, a glyph alone in the accent: something is open that the eye should find
  if (props.statusIcon !== undefined && statusGutter > 0) {
    nodes.push({
      kind: "icon", id: "tStatus", box: { x: size.w - actionGutter - moreGutter - statusGutter, y: 0, w: statusGutter, h: body },
      role: props.statusIcon, color: colorToken("accent-blue"), font: "icon", shownBy: shownWhile(props.statusIcon),
    });
  }
  // The action is the glyph alone, there only while the view has one. Its
  // outline was never on the glass: the icon's Text, drawn after the two
  // Buttons of the outline with the same box, painted the page over them.
  // the glyph on the rail's axis, the touch to the visible edge
  if (props.action) {
    const shownBy = shownWhile(props.actionIcon);
    nodes.push({ kind: "icon", id: "tAction", box: { x: act.glyph.x, y: 0, w: act.glyph.w, h: body }, role: props.actionIcon ?? "add", color: props.actionIconColor ?? colorToken("text-primary"), font: "icon", shownBy });
    nodes.push({ kind: "touch", id: "mAction", box: { x: act.touch.x, y: 0, w: act.touch.w, h: body }, action: props.action, hold: props.actionHold, shownBy });
  }
  // the view's options, the ⋯, beside the action
  if (props.more) nodes.push(...arrow("More", "more", size.w - actionGutter - side, props.more));
  return nodes;
};

/**
 * A paged list's scrollbar, on the right under the header
 * (screenTemplates.ts `railColumn`): the groove in the colour of what is off,
 * as the other two themes draw it. How it works is shared by every theme
 * (`scrollbar.ts`); only the colour is this one's. The border colour is 1.3:1
 * on the page: right for an outline, which a card's
 * fill already separates, and too faint for the one line that says the list
 * goes on.
 */
export const pageRail: LayoutFn<PageRailLayout> = (props, size) => scrollbarNodes(props, size, { groove: "icon-off" });

/** An outlined card: the border shadcn puts around everything, as two fills. */
export const lightCard: LayoutFn<LightCardLayout> = (props, size, style) => {
  const b = Math.max(1, style.borderWidth);
  const inner = { w: Math.max(1, size.w - b * 2), h: Math.max(1, size.h - b * 2) };
  const iconH = Math.min(style.fontHeight["icon-large"], Math.round(inner.h * 0.55));
  const nameH = Math.min(style.fontHeight.body, Math.max(1, inner.h - iconH));
  return [
    { kind: "fill", id: "bEdge", box: { x: 0, y: 0, w: size.w, h: size.h }, color: "card-border" },
    { kind: "fill", id: "bCard", box: { x: b, y: b, w: inner.w, h: inner.h }, color: "card-background" },
    { kind: "icon", id: "tIcon", box: { x: b, y: b, w: inner.w, h: iconH }, role: props.icon, color: props.iconColor, background: "card-background", font: "icon-large" },
    { kind: "text", id: "tName", box: { x: b, y: size.h - b - nameH, w: inner.w, h: nameH }, value: props.name, font: "body", color: "text-primary", background: "card-background", align: "center", valign: "middle" },
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
 * shadcn's switch is nothing like Material's: a short rail, a small knob, muted
 * off and primary on. Short enough that the DRAWING is under the bare-finger
 * minimum, so the box stays big and the rail sits in the middle of it -- the
 * padding is what makes it reachable.
 */
export const toggleSwitch: LayoutFn<ToggleSwitchLayout> = (props, size) => {
  const h = Math.min(24, size.h);
  const w = Math.min(44, size.w);
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
 * The keyboard, shadcn's way: every key is an outlined card, because that is
 * what this theme says a surface is.
 *
 * It costs what it says it costs. A border IS a component on this hardware, so
 * forty-four outlined keys are eighty-eight records and about 1.9 KB of the
 * page's 3 584 -- against half that for a theme that draws them flat. The
 * alternative was a keyboard that did not look like the rest of the panel,
 * which is the one thing a design system cannot trade away.
 *
 * The gap is wider than the other two themes': this one is the airy one, and
 * the space between the keys is where that shows.
 */
const keyboardWith = (map: KeyboardMap): LayoutFn<KeyboardLayout> => (props, size, style) => {
  const b = Math.max(1, style.borderWidth);
  // NO MARGIN. The keyboard is the one screen where every pixel is a bigger
  // target: it already owns the whole visible panel, and a margin there only
  // shrinks forty-four keys to draw empty space against an edge that is already
  // the edge of the glass. The EU panel's own
  // dead strip is handled where it belongs -- the placement is 450 wide, not
  // 480 -- so zero here means zero of what can be SEEN.
  const g = keyboardGeometry(size, { margin: 0, gap: 6, fieldHeight: 56, fieldGap: 12 }, map);
  const nodes: PanelNode[] = [
    { kind: "fill", id: "kbEdge", box: g.field, color: "card-border" },
    // inside the border, the field; and the line inset in it (FIELD_INSET)
    { kind: "fill", id: "kbPad", box: { x: g.field.x + b, y: g.field.y + b, w: g.field.w - b * 2, h: g.field.h - b * 2 }, color: "card-background" },
    {
      kind: "field", id: "kbField",
      box: fieldLine({ x: g.field.x + b, y: g.field.y + b, w: g.field.w - b * 2, h: g.field.h - b * 2 }),
      value: props.value, max: props.max,
      font: "title", color: "text-primary", background: "card-background", align: "left",
    },
  ];
  for (const key of map.keys) {
    const cell = g.box(key);
    const id = keyId(key).slice(1);
    // The two keys that LEAVE the keyboard are the two that get colour, and
    // they get different ones: one commits and one throws away.
    const face = key.role === "commit" ? "accent-blue" : key.role === "cancel" ? "accent-red" : undefined;
    // `ke` and not `e`: with `e` the "q" key's border came out as `eq0`, which
    // is a Nextion system variable (`eq0`..`eq9`, the ten measured) and makes
    // the Editor refuse to open the project at all.
    nodes.push({ kind: "fill", id: `ke${id}`, box: cell, color: face ?? "card-border" });
    const inner = { x: cell.x + b, y: cell.y + b, w: cell.w - b * 2, h: cell.h - b * 2 };
    // The digit over its letters inside the outline, when the map asks for it,
    // as the other two themes draw the keypad, and not "2 abc" on one line, the
    // digit no bigger than the letters beside it.
    if (map.stacked && key.cycle && key.cycle.length > 1) {
      const half = Math.floor(inner.h / 2);
      nodes.push({
        kind: "key", id: `k${id}`, touch: g.cell(key), box: inner, role: key.role, cap: "",
        cycle: key.cycle, cycleCaps: key.cycleCaps,
        color: "card-background", textColor: "text-primary", font: "body",
      });
      nodes.push({
        kind: "text", id: `n${id}`,
        box: { x: inner.x, y: inner.y, w: inner.w, h: half },
        value: literal(key.cycle[key.cycle.length - 1]),
        font: "title", color: "text-primary", background: "card-background",
        align: "center", valign: "middle",
      });
      nodes.push({
        kind: "text", id: `l${id}`,
        box: { x: inner.x, y: inner.y + half, w: inner.w, h: inner.h - half },
        value: literal(key.cycle.slice(0, -1).join("").trim() || "_"),
        // The letters say which case they will type; the digit does not change.
        // signs have no case, and stay out of the rewrite (the signs' keypad)
        ...(cycleUpper(key.cycle) !== (key.cycle.slice(0, -1).join("").trim() || "_") ? { capsValue: cycleUpper(key.cycle) } : {}),
        font: "body", color: "text-secondary", background: "card-background",
        align: "center", valign: "middle",
      });
      continue;
    }
    nodes.push({
      kind: "key", id: `k${id}`, touch: g.cell(key),
      box: inner,
      role: key.role, to: key.to, cap: key.cap, capsCap: key.capsCap, capIcon: key.capIcon,
      cycle: key.cycle, cycleCaps: key.cycleCaps,
      color: face ?? "card-background",
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
// the string a project ends up with, `shadcn-dark/nav-header` and not some
// other theme's. A project imports these the same way it already reaches
// this theme's `navHeader`: `shadcnDark.settingsScreen(...)`.
export const listScreen = (grid: Grid, id?: string): TemplateScreen =>
  listScreenTemplate("shadcn-dark", grid, id);
export const dialogScreen = (grid: Grid, id?: string): TemplateScreen =>
  dialogScreenTemplate("shadcn-dark", grid, id);
export const qrScreen = (grid: Grid, id?: string): TemplateScreen =>
  qrScreenTemplate("shadcn-dark", grid, id);
export const zoneScreen = (grid: Grid, id?: string): TemplateScreen =>
  zoneScreenTemplate("shadcn-dark", grid, id);
export const lockScreen = (grid: Grid, id?: string): TemplateScreen =>
  lockScreenTemplate("shadcn-dark", grid, id);
/** The safeboot's page, from the shared template. */
export const safebootScreen = (grid: Grid, id?: string): TemplateScreen =>
  safebootScreenTemplate("shadcn-dark", grid, id);
/** The thermostat's screen, from the shared template. */
export const thermostatScreen = (grid: Grid, id?: string): TemplateScreen =>
  thermostatScreenTemplate("shadcn-dark", grid, id);
export const coverScreen = (grid: Grid, id?: string): TemplateScreen =>
  coverScreenTemplate("shadcn-dark", grid, id);
export const houseScreen = (grid: Grid, id?: string): TemplateScreen =>
  houseScreenTemplate("shadcn-dark", grid, id);
/** The mesh's own page, its nodes under its cog. */
export const meshScreen = (grid: Grid, id?: string): TemplateScreen =>
  meshScreenTemplate("shadcn-dark", grid, id);
/** A lamp's detail, from the shared template. */
export const lightDetailScreen = (grid: Grid, id?: string): TemplateScreen =>
  lightDetailScreenTemplate("shadcn-dark", grid, id);

export const helpScreen = (grid: Grid, id?: string): TemplateScreen =>
  helpScreenTemplate("shadcn-dark", grid, id);
