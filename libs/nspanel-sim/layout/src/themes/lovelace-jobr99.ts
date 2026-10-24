// joBr99's Lovelace UI, as layout rather than as drawing.
//
// What survives the move and what does not is the interesting part. A label on
// this panel is a font, a colour and a box -- and that is the whole of it. The
// React version also carried `lineHeight: 1.25`, which a Nextion Text has no
// attribute for, so the simulator was showing leading the glass cannot produce.
// It is gone rather than approximated: the point of this package is that what
// you see is what compiles.
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
  type Box, type LayoutFn, type PanelNode,
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
      // The type scale is the THEME's, expressed as which `.zi` each role
      // resolves to -- here a 32-pixel cut for a title over the 24 of body text.
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
 * Thirty-two pixels of track is what this theme draws today, and what the reference screenshots show.
 *
 * The track is 32 pixels tall inside whatever box the project gives it, and the
 * rest of the box is the finger's, which is the part a 12 mm target needs and a
 * 32-pixel ramp does not. The Slider is the whole box -- a Nextion Slider takes
 * its touch where its box is -- and its picture paints the rail as a band with
 * the page's colour around it: a Slider of the rail alone would leave the
 * finger's room with no touch at all.
 */
export const gradientSlider: LayoutFn<GradientSliderLayout> = (props, size) => {
  const h = Math.min(props.trackHeight ?? 32, size.h);
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
 * THIS theme's clock model: a big heavy time, the date under it, and a rule.
 * Another theme's is another function; nothing here is "the" clock.
 *
 * The rule is why this conversion went first. The React clock drew a
 * `<Divider>` and the compile step emitted nothing at all, so the simulator has
 * had a line under the clock that the panel has never drawn. It is a `fill` node
 * now -- a Nextion Button of the divider colour, two pixels tall -- and both
 * sides draw it or neither does.
 *
 * What did NOT survive: the divider's `opacity: 0.6`. There is no alpha on this
 * glass. The theme declares `divider` as 65535 and its own note says it is
 * "drawn at reduced opacity" -- the opacity was the browser's, so the rule is
 * white on both sides now. A theme that wants a dimmer rule declares a dimmer
 * token, which is a colour the panel can actually hold.
 */
export const clock: LayoutFn<ClockLayout> = (props, size, style) => {
  const { gap } = densitySpacing(style);
  const RULE_H = 2;
  const [time, date, rule] = stackRows(size, [style.fontHeight.display, style.fontHeight.body, RULE_H], gap);
  const inset = Math.round(size.w * 0.08);
  return [
    { kind: "text", id: "tTime", box: time, value: props.time, font: "display", color: "text-primary", align: "center", valign: "middle" },
    { kind: "text", id: "tDate", box: date, value: props.date, font: "body", color: "text-primary", align: "center", valign: "middle" },
    // inset from both edges the way the React rule is (`mx: 4`), in panel pixels
    { kind: "fill", id: "fRule", box: { ...rule, x: inset, w: Math.max(1, size.w - 2 * inset) }, color: "divider" },
  ];
};

/**
 * The same slider, drawn small: the thin rail a card row carries next to a name
 * instead of the full rail a detail screen gives a dimension.
 *
 * This is what variants are for, and why it is not a second component id: the
 * props are identical, the events are identical, the hardware obligation is
 * identical (a Touch Move carries no Component ID, so the value arrives on
 * release). Only the drawing is smaller. joBr99's own file has both -- 335x43
 * rails on his light pages and 120x12 ones on his card rows.
 *
 * It is also cheaper, and measurably so: the generated track is 12 rows instead
 * of 32, and a picture costs two bytes a pixel (`paint.ts`), so a compact rail
 * is 37% of a full one.
 */
export const gradientSliderCompact: LayoutFn<GradientSliderLayout> = (props, size) => {
  const h = Math.min(props.trackHeight ?? 12, size.h);
  return [
    {
      kind: "slider",
      id: "h",
      // the whole placement is the Slider, so the whole placement is touch;
      // the rail the eye sees is the band the picture paints (paint.ts, lever 1)
      box: { x: 0, y: 0, w: size.w, h: size.h },
      value: props.pct,
      track: { kind: "ramp", ramp: props.ramp, height: h },
      // a thinner rail wants a thinner pointer, or the pointer IS the rail
      pointerWidth: 3,
      pointerHeight: Math.max(2, h - 2),
      radius: Math.round(h / 2),
      action: props.change,
      live: props.live,
    },
  ];
};

/**
 * THIS theme's forecast row: five equal columns, the current condition first and
 * larger, the label above each temperature. The reference screensaver.
 *
 * The React version dimmed a cell with `opacity: 0.25` when there is no reading.
 * There is no alpha on the glass, so a missing value is whatever the binding
 * puts there -- an em dash -- in the same colour as the rest. The dimming was
 * the browser's opinion of absent data; the panel says it with the text.
 */
export const weatherRow: LayoutFn<WeatherRowLayout> = (props, size, style) => {
  const cells = columns(size, props.items.length || 1);
  const { gap } = densitySpacing(style);
  return props.items.flatMap((item, i) => {
    const inner = { w: cells[i].w, h: size.h };
    // Every cell stacked as the first one is, a title's height for the
    // temperature, so the five labels share one top: stacked by their own
    // heights, the four small cells would sit 4 px lower than the first.
    const [label, temp] = stackRows(inner, [style.fontHeight.body, style.fontHeight.title], gap);
    const at = (box: Box) => ({ ...box, x: cells[i].x + box.x });
    return [
      { kind: "text" as const, id: `tWd${i}`, box: at(label), value: item.label, font: "body" as const, color: "text-secondary", align: "center" as const, valign: "middle" as const },
      { kind: "text" as const, id: `tTemp${i}`, box: at(temp), value: item.temp, font: i === 0 ? ("title" as const) : ("body" as const), color: "accent-blue", align: "center" as const, valign: "middle" as const },
    ];
  });
};

/** A bare glyph in the colour the panel sends. No plate, no border: his corners are empty. */
export const statusIcon: LayoutFn<StatusIconLayout> = (props, size) => [
  { kind: "icon", id: "tIcon", box: { x: 0, y: 0, w: size.w, h: size.h }, role: (props.role ?? "lightOn"), color: props.color ?? colorToken("icon-low-sat"), font: "icon" },
];

/**
 * Left arrow, title, right arrow -- and the arrows are Text plus a Hotspot on
 * top, because a Nextion Text takes no touch. That overlap is what the Editor
 * warns about on this page, and it is deliberate. A screen that is left by
 * `close` has no X: a tap on the title leaves it.
 *
 * An arrow with nowhere to go draws nothing at all rather than a dimmed one:
 * `home.be:NO_NAV` means there is no card that way, and a disabled-looking
 * control the finger can press is worse than no control.
 */
export const navHeader: LayoutFn<NavHeaderLayout> = (props, size, style) => {
  const side = Math.min(SCREEN_GEOMETRY.headerIconWidth, size.h, Math.floor(size.w / 3));
  // A gutter only where an icon actually sits -- reserving one on a side with
  // nothing in it would either centre the title away from the content below
  // for no reason, or (left-aligned) leave a dead gap in front of it. Most
  // screens have no prev arrow, so the common case is the title starting
  // flush with whatever margin the placement itself was given -- the same
  // margin the content under it uses, because both start at x=0 of a box the
  // project placed at the same x.
  //
  // Where an icon DOES sit, the title stops at the icon's box, not at its
  // glyph. The glyph is drawn centred and narrower than `side`, and a title run
  // under that empty margin would look right only in React. On the glass the
  // icon is a Text too, a Text paints its whole box in its background colour,
  // and it comes after the title: the title under it is painted over, in the page
  // colour here and as a visible square in the themes whose buttons are filled. Nothing the header draws may cross
  // a Text's box (export/test/textOnGlass.test.mjs).
  //
  // `close` takes no slot: there is no X, the title itself
  // is the way back (NavHeaderLayout.close).
  // The view's action takes the far right, to the visible edge
  // the header is placed to (`headerBox`), and a next arrow moves in beside
  // it. With nothing on the right, the title keeps the margin there.
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
  // The title's gestures: a tap leaves the screen, a long press opens the
  // keyboard. A Hotspot over the words rather than a touch on the Text itself:
  // a Text with an event on it is still a Text, and keeping the target
  // separate means the heading can be restyled without moving the gesture.
  if (props.close || props.editTitle) nodes.push({ kind: "touch", id: "mTitle", box: titleBox, action: props.close, hold: props.editTitle });
  if (props.prev) {
    nodes.push({ kind: "icon", id: "tPrev", box: { x: 0, y: 0, w: side, h: size.h }, role: "navPrev", color: colorToken("text-primary"), font: "icon" });
    nodes.push({ kind: "touch", id: "mPrev", box: { x: 0, y: 0, w: side, h: size.h }, action: props.prev });
  }
  if (props.next) {
    const x = size.w - actionGutter - moreGutter - statusGutter - side;
    nodes.push({ kind: "icon", id: "tNext", box: { x, y: 0, w: side, h: size.h }, role: "navNext", color: colorToken("text-primary"), font: "icon" });
    nodes.push({ kind: "touch", id: "mNext", box: { x, y: 0, w: side, h: size.h }, action: props.next });
  }
  // the sign, in the accent: something is open that the eye should find
  if (props.statusIcon !== undefined && statusGutter > 0) {
    nodes.push({
      kind: "icon", id: "tStatus", box: { x: size.w - actionGutter - moreGutter - statusGutter, y: 0, w: statusGutter, h: size.h },
      role: props.statusIcon, color: colorToken("accent-blue"), font: "icon", shownBy: shownWhile(props.statusIcon),
    });
  }
  // The + or the check, which one the runtime's to say: the touch to the
  // visible edge, the glyph on the rail's axis. The icon cut, as the other two
  // themes draw it: the large one (joBr99's header icons) stands half again as
  // tall as the title beside it.
  if (props.action) {
    // there only while the view has an action: no glyph, no touch otherwise
    const shownBy = shownWhile(props.actionIcon);
    nodes.push({ kind: "icon", id: "tAction", box: { x: act.glyph.x, y: 0, w: act.glyph.w, h: size.h }, role: props.actionIcon ?? "add", color: props.actionIconColor ?? colorToken("text-primary"), font: "icon", shownBy });
    nodes.push({ kind: "touch", id: "mAction", box: { x: act.touch.x, y: 0, w: act.touch.w, h: size.h }, action: props.action, hold: props.actionHold, shownBy });
  }
  // the view's options, the ⋯, beside the action
  if (props.more) {
    const box = { x: size.w - actionGutter - side, y: 0, w: side, h: size.h };
    nodes.push({ kind: "icon", id: "tMore", box, role: "more", color: colorToken("text-primary"), font: "icon-large" });
    nodes.push({ kind: "touch", id: "mMore", box, action: props.more });
  }
  void style;
  return nodes;
};

/**
 * A paged list's scrollbar, on the right under the header
 * (screenTemplates.ts `railColumn` centres it there): the groove in the same
 * grey the unlit bulbs use, so it reads as structure and never as a setting
 * that is on. How it works is shared by every theme (`scrollbar.ts`); only the
 * colour is this one's.
 */
export const pageRail: LayoutFn<PageRailLayout> = (props, size) => scrollbarNodes(props, size, { groove: "icon-off" });

/**
 * An icon over a name, on the page, with NO card around it. That absence is the
 * design decision: the reference screenshots show the bulbs floating.
 *
 * The whole thing is ONE touch target -- short tap toggles, long press opens the
 * detail. Two nested ones would leave "tap the card" a 1.8 mm frame around an
 * icon that takes 98 of the card's 122 pixels.
 */
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
 * Material's rocker, as far as a dual-state Button goes -- and with `art`, all
 * the way: the rail and the knob are generated pictures, so the control on the
 * glass is the control in the design and not a two-colour rectangle.
 */
export const toggleSwitch: LayoutFn<ToggleSwitchLayout> = (props, size) => {
  const h = Math.min(32, size.h);
  const w = Math.min(58, size.w);
  return [
    {
      kind: "toggle",
      id: "btSwitch",
      box: { x: Math.round((size.w - w) / 2), y: Math.round((size.h - h) / 2), w, h },
      value: props.on,
      off: "text-secondary",
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
 * The keyboard, joBr99's way: flat faces with no borders, the accent reserved
 * for the two keys that end the edit.
 *
 * The faces are a step off the page, in the colour the plan's cards have
 * (`plan-card`). On the page's own colour a key would be a letter floating in
 * the dark: nothing would say where one key ends and the next begins, and the
 * field would be a line of text with no box around it.
 *
 * Sizes, on the 450 columns the EU housing leaves visible: a cell of 45x48 and
 * a key of 41x44 drawn inside it -- 6.3 x 6.8 mm. That is below the 12 mm this
 * theme demands of a light card and it is deliberate: ten letters have to fit
 * across a 69 mm window, and the vendor's own keyboard for this panel draws
 * them at 40x45. A keyboard is the one screen where the alternative to a small
 * target is no target at all.
 */
const keyboardWith = (map: KeyboardMap): LayoutFn<KeyboardLayout> => (props, size) => {
  // NO MARGIN. The keyboard is the one screen where every pixel is a bigger
  // target: it already owns the whole visible panel, and a margin there only
  // shrinks forty-four keys to draw empty space against an edge that is already
  // the edge of the glass. The EU panel's own
  // dead strip is handled where it belongs -- the placement is 450 wide, not
  // 480 -- so zero here means zero of what can be SEEN.
  const g = keyboardGeometry(size, { margin: 0, gap: 4, fieldHeight: 56, fieldGap: 10 }, map);
  const nodes: PanelNode[] = [
    // the field, and the line inset in it (FIELD_INSET)
    { kind: "fill", id: "kbPad", box: g.field, color: "plan-card" },
    {
      kind: "field", id: "kbField", box: fieldLine(g.field), value: props.value, max: props.max,
      font: "title", color: "text-primary", background: "plan-card", align: "left",
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
        color: "plan-card", textColor: "text-primary", font: "body",
      });
      nodes.push({
        kind: "text", id: `n${keyId(key).slice(1)}`,
        box: { x: box.x, y: box.y, w: box.w, h: half },
        value: literal(key.cycle[key.cycle.length - 1]),
        font: "title", color: "text-primary", background: "plan-card",
        align: "center", valign: "middle",
      });
      nodes.push({
        kind: "text", id: `l${keyId(key).slice(1)}`,
        box: { x: box.x, y: box.y + half, w: box.w, h: box.h - half },
        value: literal(key.cycle.slice(0, -1).join("").trim() || "_"),
        // The letters say which case they will type. The digit above them does
        // not change, so it stays out of the rewrite, and nor do
        // signs, which have no case (the signs' keypad).
        ...(cycleUpper(key.cycle) !== (key.cycle.slice(0, -1).join("").trim() || "_") ? { capsValue: cycleUpper(key.cycle) } : {}),
        font: "body", color: "text-secondary", background: "plan-card",
        align: "center", valign: "middle",
      });
      continue;
    }
    nodes.push({
      kind: "key", id: keyId(key), box, touch: g.cell(key),
      role: key.role, to: key.to, cap: key.cap, capsCap: key.capsCap, capIcon: key.capIcon,
      cycle: key.cycle, cycleCaps: key.cycleCaps,
      // The two that leave the keyboard are the two that get colour. Everything
      // else is the same face, because forty keys in four colours is a puzzle
      // and not a keyboard.
      color: key.role === "commit" ? "accent-blue" : key.role === "cancel" ? "accent-red" : "plan-card",
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
// the string a project ends up with, `lovelace-jobr99/nav-header` and not
// some other theme's. A project imports these the same way it already
// reaches this theme's `navHeader`: `lovelaceJobr99.settingsScreen(...)`.
export const listScreen = (grid: Grid, id?: string): TemplateScreen =>
  listScreenTemplate("lovelace-jobr99", grid, id);
export const dialogScreen = (grid: Grid, id?: string): TemplateScreen =>
  dialogScreenTemplate("lovelace-jobr99", grid, id);
export const qrScreen = (grid: Grid, id?: string): TemplateScreen =>
  qrScreenTemplate("lovelace-jobr99", grid, id);
export const zoneScreen = (grid: Grid, id?: string): TemplateScreen =>
  zoneScreenTemplate("lovelace-jobr99", grid, id);
export const lockScreen = (grid: Grid, id?: string): TemplateScreen =>
  lockScreenTemplate("lovelace-jobr99", grid, id);
/** The safeboot's page, from the shared template. */
export const safebootScreen = (grid: Grid, id?: string): TemplateScreen =>
  safebootScreenTemplate("lovelace-jobr99", grid, id);
/** The thermostat's screen, from the shared template. */
export const thermostatScreen = (grid: Grid, id?: string): TemplateScreen =>
  thermostatScreenTemplate("lovelace-jobr99", grid, id);
export const coverScreen = (grid: Grid, id?: string): TemplateScreen =>
  coverScreenTemplate("lovelace-jobr99", grid, id);
export const houseScreen = (grid: Grid, id?: string): TemplateScreen =>
  houseScreenTemplate("lovelace-jobr99", grid, id);
/** The mesh's own page, its nodes under its cog. */
export const meshScreen = (grid: Grid, id?: string): TemplateScreen =>
  meshScreenTemplate("lovelace-jobr99", grid, id);
/** A lamp's detail, from the shared template. */
export const lightDetailScreen = (grid: Grid, id?: string): TemplateScreen =>
  lightDetailScreenTemplate("lovelace-jobr99", grid, id);

export const helpScreen = (grid: Grid, id?: string): TemplateScreen =>
  helpScreenTemplate("lovelace-jobr99", grid, id);
