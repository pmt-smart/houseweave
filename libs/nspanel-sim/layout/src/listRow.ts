// A row of a list, and a counter of a zone's top card, as nodes -- shared by
// every theme, the way `scrollbar.ts` is.
//
// The three themes' Settings rows were the same code word for word: a label in
// the accent colour when lit and the muted one when not, over one Hotspot. The
// generic list keeps that and adds what a row of devices needs --
// an icon at the left, a grey hint at the right, and a discreet tail with a
// touch box of its own (a device's position). How a row is laid
// out is not a look; which colours it uses is, and each theme passes its own.
import type { ListRowLayout, ZoneCounterLayout } from "./components.js";
import { colorSwitch, colorToken, numberValue, type ColorToken, type PanelNode, type Size } from "./node.js";

/** The widths a row gives its parts, in panel pixels. The height is the row's. */
export const LIST_ROW = {
  /**
   * The icon's column: a 32 px glyph with 2 px either side. A row with no icon
   * of its own (Settings) still has the column, blank, because the glass cannot
   * move the label at runtime; a wider one would set the labels well to the
   * right of the title above them.
   */
  icon: 36,
  /** a zone counter's icon, beside its number: the room the 48 px column always had */
  counterIcon: 48,
  /** the hint's share at most: "Panel · 4 zones", "on network", "80%" */
  hint: 130,
  /**
   * What the label keeps before the hint gets anything: a name of ten or so
   * letters. On a narrow row -- a zone's devices on the US portrait -- the hint
   * is what goes, not the name.
   */
  label: 110,
  /** the tail's own column, a 12 mm touch box on either panel */
  tail: 78,
  /**
   * The flush row's glyph at its end -- the accessory that says what a tap
   * does there: a chevron opens another view, a switch toggles, a dot is a
   * choice. 39 px, a zone counter's icon half, so a list's glyphs and a zone's
   * device icons stand in columns of one width.
   */
  accessory: 39,
  /**
   * The value's share of what the flush row has for words, right-aligned
   * before the glyph. Measured on the runtime's own words: labels are the property ("Position", "Button 1"), values its
   * state ("2,5", "Panel"), and neither side wants much more than half.
   */
  valueShare: 0.45,
  /**
   * One line of the `stacked` row: the 28 px a Help or a dialog line takes for
   * the body cut. Two of them, the name over the value, stand in the middle of
   * a 78 px row.
   */
  line: 28,
} as const;

export interface ListRowLook {
  /** the label when lit */
  lit: ColorToken;
  /** the label when not */
  unlit: ColorToken;
  /** the hint and the tail */
  quiet: ColorToken;
  /** an icon with no colour of its own */
  icon: ColorToken;
  /** the label of a row that destroys (`on` 2): Delete, Remove */
  danger?: ColorToken;
}

/**
 * The faces of a row that is a button (the `button` variant), and of a counter that has one (`face`): the face
 * and the words on it, unlit and lit, and the face while the finger is down, which the glass paints itself.
 */
export interface FaceLook {
  face: ColorToken;
  text: ColorToken;
  litFace: ColorToken;
  litText: ColorToken;
  pressed: ColorToken;
}

/** How a row lays its parts out: the variants of `list-row`. */
export type ListRowMode = "default" | "flush" | "device" | "stacked" | "button";

/** The `stacked` row's tail, at the right of the name: "Wi-Fi -100dBm" in the body's font, 121 px, and a breath. */
const STACKED_TAIL = 126;

/** The narrowest hint the `device` row draws: "80%". Less than that, the name keeps it. */
const DEVICE_HINT_MIN = 40;

/**
 * One row. What is absent takes no room: a Settings row is a label alone, the
 * way it was; a row of the zone's list has all four parts.
 *
 * The row's touch covers everything but the tail, and the tail's covers the
 * tail: two boxes that touch and never overlap, because the one drawn later
 * would take every press on the shared pixels.
 *
 * `flush` is the generic list's row (`flushRowNodes`): the label from the
 * row's own left edge, the value right-aligned, the row's glyph at its end.
 *
 * `device` is a zone's device row (`deviceRowNodes`).
 *
 * `stacked` is the tall list's row (`stackedRowNodes`): the name over the value.
 */
export function listRowNodes(props: ListRowLayout, size: Size, look: ListRowLook, mode: ListRowMode = "default", faces?: FaceLook): PanelNode[] {
  if (mode === "button") return buttonRowNodes(props, size, faces ?? { face: "plan-card", text: look.unlit, litFace: look.lit, litText: "background", pressed: "pressed" });
  if (mode === "device") return deviceRowNodes(props, size, look);
  if (mode === "flush") return flushRowNodes(props, size, look);
  if (mode === "stacked") return stackedRowNodes(props, size, look);
  const h = size.h;
  const iconW = props.icon !== undefined ? Math.min(LIST_ROW.icon, Math.floor(size.w / 4)) : 0;
  const tailW = props.tail !== undefined ? Math.min(LIST_ROW.tail, Math.floor(size.w / 4)) : 0;
  const room = size.w - iconW - tailW;
  const hintW = props.hint !== undefined ? Math.max(0, Math.min(LIST_ROW.hint, room - LIST_ROW.label)) : 0;
  const labelW = Math.max(1, size.w - iconW - hintW - tailW);
  const color = labelColor(props, look);
  const nodes: PanelNode[] = [];
  // the icon first, then the label
  const labelX = iconW;
  if (props.icon !== undefined) {
    nodes.push({
      kind: "icon", id: "tIcon", box: { x: 0, y: 0, w: iconW, h },
      role: props.icon, color: props.iconColor ?? colorToken(look.icon), font: "icon",
    });
  }
  nodes.push({
    kind: "text", id: "tLabel", box: { x: labelX, y: 0, w: labelW, h },
    value: props.label, font: "body", color, align: "left", valign: "middle",
  });
  if (props.hint !== undefined && hintW > 0) {
    nodes.push({
      kind: "text", id: "tHint", box: { x: iconW + labelW, y: 0, w: hintW, h },
      value: props.hint, font: "body", color: look.quiet, align: "right", valign: "middle",
    });
  }
  if (props.tail !== undefined) {
    nodes.push({
      kind: "text", id: "tTail", box: { x: size.w - tailW, y: 0, w: tailW, h },
      value: props.tail, font: "body", color: look.quiet, align: "right", valign: "middle",
    });
  }
  nodes.push({
    kind: "touch", id: "mRow", box: { x: 0, y: 0, w: size.w - tailW, h },
    action: props.change, hold: props.hold, mirror: props.mirror, light: true,
  });
  // the tail's tap is the row's; its long press is its own
  if (props.tail !== undefined && (props.change || props.tailHold)) {
    nodes.push({ kind: "touch", id: "mTail", box: { x: size.w - tailW, y: 0, w: tailW, h }, action: props.change, hold: props.tailHold, light: true });
  }
  return nodes;
}

/**
 * The generic list's row (the `flush` variant): the name from the row's own
 * left edge, under the title; the value right-aligned; and the row's glyph at
 * its very end, the accessory that says what a tap there does. One touch over
 * all of it.
 *
 * The glyph's column is at the end, where a glyph belongs and reads as the row's
 * affordance, instead of a gap between the name and the value that every row
 * would reserve though few draw in it, cutting a value at 73 px on the US portrait
 * while the row has room.
 */
function flushRowNodes(props: ListRowLayout, size: Size, look: ListRowLook): PanelNode[] {
  const h = size.h;
  const glyphW = props.icon !== undefined ? Math.min(LIST_ROW.accessory, Math.floor(size.w / 4)) : 0;
  const words = size.w - glyphW;
  const hintW = props.hint !== undefined ? Math.max(0, Math.round(words * LIST_ROW.valueShare)) : 0;
  const labelW = Math.max(1, words - hintW);
  const nodes: PanelNode[] = [
    {
      kind: "text", id: "tLabel", box: { x: 0, y: 0, w: labelW, h },
      value: props.label, font: "body", color: labelColor(props, look), align: "left", valign: "middle",
    },
  ];
  if (props.hint !== undefined && hintW > 0) {
    nodes.push({
      kind: "text", id: "tHint", box: { x: labelW, y: 0, w: hintW, h },
      value: props.hint, font: "body", color: look.quiet, align: "right", valign: "middle",
    });
  }
  if (props.icon !== undefined) {
    nodes.push({
      kind: "icon", id: "tIcon", box: { x: size.w - glyphW, y: 0, w: glyphW, h },
      role: props.icon, color: props.iconColor ?? colorToken(look.icon), font: "icon",
    });
  }
  nodes.push({ kind: "touch", id: "mRow", box: { x: 0, y: 0, w: size.w, h }, action: props.change, hold: props.hold, mirror: props.mirror, light: true });
  return nodes;
}

/**
 * A row that is a button (the `button` variant): a face with its label centred on it, which is the touch too.
 * Lit, the face is the theme's lit one and the words its dark ones, as the keyboard's OK key has them; unlit, the face is
 * the cards' and the words the plain text. A bound `on` switches both at run time, the face's `bco` and the words' `pco`,
 * and the glass draws the press itself (`ButtonNode`). The thermostat's modes, side by side.
 */
function buttonRowNodes(props: ListRowLayout, size: Size, look: FaceLook): PanelNode[] {
  const on = props.on;
  const lit = on.kind === "binding" ? null : numberValue(on) !== 0;
  return [{
    kind: "button", id: "bRow", box: { x: 0, y: 0, w: size.w, h: size.h },
    value: props.label, font: "body",
    color: on.kind === "binding" ? colorSwitch(on.path, look.litText, look.text, on.sample) : lit ? look.litText : look.text,
    face: on.kind === "binding" ? colorSwitch(on.path, look.litFace, look.face, on.sample) : lit ? look.litFace : look.face,
    pressed: look.pressed, pressedText: look.text,
    action: props.change, hold: props.hold,
  }];
}

/**
 * The list's row (the `stacked` variant): the name on the top
 * line and the value on the one under it, each as wide as the row but for the
 * glyph at its end, which stands in the row's middle. One touch over all of it.
 *
 * For values that are words more than numbers -- the Wi-Fi, the Zigbee and the
 * pairing -- which a row with the value at its end would give 98 px on the US
 * portrait, cutting "Not connected".
 * Here the value has the 218 px the name has.
 *
 * The two lines keep their places when a row has no value: the glass cannot
 * move a Text at run time, so a name alone reads on the top line, as the other
 * names beside it do.
 */
function stackedRowNodes(props: ListRowLayout, size: Size, look: ListRowLook): PanelNode[] {
  const h = size.h;
  const glyphW = props.icon !== undefined ? Math.min(LIST_ROW.accessory, Math.floor(size.w / 4)) : 0;
  const words = Math.max(1, size.w - glyphW);
  const line = Math.max(1, Math.min(LIST_ROW.line, Math.floor(h / 2)));
  const top = Math.max(0, Math.floor((h - 2 * line) / 2));
  // the tail at the right of the name, on its line: a node's Wi-Fi on the mesh's page, as wide as "Wi-Fi -100dBm" in the body's font
  const tailW = props.tail !== undefined ? Math.min(STACKED_TAIL, Math.floor(words / 2)) : 0;
  const nodes: PanelNode[] = [
    {
      kind: "text", id: "tLabel", box: { x: 0, y: top, w: words - tailW, h: line },
      value: props.label, font: "body", color: labelColor(props, look), align: "left", valign: "middle",
    },
  ];
  if (props.tail !== undefined) {
    nodes.push({
      kind: "text", id: "tTail", box: { x: words - tailW, y: top, w: tailW, h: line },
      value: props.tail, font: "body", color: props.tailColor ?? look.quiet, align: "right", valign: "middle",
    });
  }
  if (props.hint !== undefined) {
    nodes.push({
      kind: "text", id: "tHint", box: { x: 0, y: top + line, w: words, h: line },
      value: props.hint, font: "body", color: props.hintColor ?? look.quiet, align: "left", valign: "middle",
    });
  }
  if (props.icon !== undefined) {
    nodes.push({
      kind: "icon", id: "tIcon", box: { x: size.w - glyphW, y: 0, w: glyphW, h },
      role: props.icon, color: props.iconColor ?? colorToken(look.icon), font: "icon",
    });
  }
  nodes.push({ kind: "touch", id: "mRow", box: { x: 0, y: 0, w: size.w, h }, action: props.change, hold: props.hold, mirror: props.mirror, light: true });
  return nodes;
}

/**
 * A zone's device row (the `device` variant): the
 * name at the left, where the title's column starts, and the icon at the right
 * end, under the icon of the counter above it. The zone's screen places it with
 * those two alone; a tail and a hint, when a row has them, go before the name
 * and after it. Touches that touch and never overlap:
 *
 * - the tail's: a tap is the name's, a long press is the tail's own;
 * - the name's: a tap opens the device's options, a long press renames it;
 * - the icon's, over the hint and the icon: a tap switches the device, a long
 *   press opens its detail. It is never narrower than the 12 mm floor, and
 *   takes the end of the name's box for it when the row is narrow.
 */
function deviceRowNodes(props: ListRowLayout, size: Size, look: ListRowLook): PanelNode[] {
  const h = size.h;
  const w = size.w;
  const coordW = props.tail !== undefined ? Math.min(LIST_ROW.tail, Math.floor(w / 4)) : 0;
  // the icon's box is a counter's (zoneCounterNodes, on a counter as wide as
  // the tail's column): the row ends where the first counter does, so the two
  // icons, both centred in boxes of one width, stand one over the other
  const iconW = props.icon !== undefined ? Math.min(LIST_ROW.counterIcon, Math.floor(LIST_ROW.tail / 2), Math.floor(w / 4)) : 0;
  const room = w - coordW - iconW;
  const spare = props.hint !== undefined ? Math.min(LIST_ROW.hint, room - LIST_ROW.label) : 0;
  const hintW = spare >= DEVICE_HINT_MIN ? spare : 0;
  const touchIcon = iconW > 0 && (props.iconTap || props.iconHold);
  const iconTouchW = touchIcon ? Math.min(Math.max(hintW + iconW, LIST_ROW.tail), w - coordW - 1) : 0;
  // The name ends where its own touch does: run on under the icon's box, a tap on
  // the end of a long name would switch the light instead of opening its options.
  const labelW = Math.max(1, (touchIcon ? w - coordW - iconTouchW : room) - (touchIcon ? 0 : hintW));
  const nodes: PanelNode[] = [];
  if (props.tail !== undefined) {
    nodes.push({
      kind: "text", id: "tTail", box: { x: 0, y: 0, w: coordW, h },
      value: props.tail, font: "body", color: look.quiet, align: "left", valign: "middle",
    });
  }
  nodes.push({
    kind: "text", id: "tLabel", box: { x: coordW, y: 0, w: labelW, h },
    value: props.label, font: "body", color: labelColor(props, look), align: "left", valign: "middle",
  });
  if (props.hint !== undefined && hintW > 0) {
    nodes.push({
      // right against the icon, inside the icon's touch, which covers both
      kind: "text", id: "tHint", box: { x: touchIcon ? w - iconW - hintW : coordW + labelW, y: 0, w: hintW, h },
      value: props.hint, font: "body", color: look.quiet, align: "right", valign: "middle",
    });
  }
  if (props.icon !== undefined) {
    nodes.push({
      kind: "icon", id: "tIcon", box: { x: w - iconW, y: 0, w: iconW, h },
      role: props.icon, color: props.iconColor ?? colorToken(look.icon), font: "icon",
    });
  }
  if (props.tail !== undefined && (props.change || props.tailHold)) {
    nodes.push({ kind: "touch", id: "mTail", box: { x: 0, y: 0, w: coordW, h }, action: props.change, hold: props.tailHold, light: true });
  }
  nodes.push({
    kind: "touch", id: "mRow", box: { x: coordW, y: 0, w: w - coordW - iconTouchW, h },
    action: props.change, hold: props.hold, mirror: props.mirror, light: true,
  });
  if (touchIcon) {
    nodes.push({ kind: "touch", id: "mIcon", box: { x: w - iconTouchW, y: 0, w: iconTouchW, h }, action: props.iconTap, hold: props.iconHold, light: true });
  }
  return nodes;
}

/**
 * The label's colour. Bound, the glass follows the row: both colours go in
 * the manifest and the runtime picks one (`colorSwitch`); literal, it is
 * decided here.
 */
function labelColor(props: ListRowLayout, look: ListRowLook) {
  return props.on.kind === "binding"
    ? colorSwitch(props.on.path, look.lit, look.unlit, props.on.sample, look.danger)
    : numberValue(props.on) === 2 && look.danger !== undefined ? look.danger
      : numberValue(props.on) !== 0 ? look.lit : look.unlit;
}

export interface ZoneCounterLook {
  count: ColorToken;
  icon: ColorToken;
}

/**
 * A counter of the zone's top card: the number, then the kind's icon, and one
 * touch over both -- a tap toggles that kind, a hold opens its joint mode.
 * Blank, it draws nothing a finger could mistake for a control:
 * the runtime writes "" into a counter the zone has no kind for.
 */
export function zoneCounterNodes(props: ZoneCounterLayout, size: Size, look: ZoneCounterLook): PanelNode[] {
  const iconW = Math.min(LIST_ROW.counterIcon, Math.floor(size.w / 2));
  const countW = Math.max(1, size.w - iconW);
  return [
    {
      kind: "text", id: "tCount", box: { x: 0, y: 0, w: countW, h: size.h },
      value: props.count, font: "body", color: look.count, align: "right", valign: "middle",
    },
    {
      kind: "icon", id: "tKind", box: { x: countW, y: 0, w: iconW, h: size.h },
      role: props.icon, color: props.iconColor ?? colorToken(look.icon), font: "icon",
    },
    { kind: "touch", id: "mCount", box: { x: 0, y: 0, w: size.w, h: size.h }, action: props.tap, hold: props.hold },
  ];
}

/**
 * A counter with a face (the `face` variant): the icon alone on the cards' face, which is the touch too and
 * which the glass lights while the finger is down. No number: the thermostat's - and +, which say what a touch does and
 * count nothing. The icon's colour is the counter's, bound or not -- a button that can go no further is dim.
 */
export function zoneCounterFaceNodes(props: ZoneCounterLayout, size: Size, look: ZoneCounterLook, faces: FaceLook): PanelNode[] {
  return [{
    kind: "button", id: "bCount", box: { x: 0, y: 0, w: size.w, h: size.h },
    role: props.icon, font: "icon",
    color: props.iconColor ?? colorToken(look.icon),
    face: faces.face, pressed: faces.pressed, pressedText: faces.text,
    action: props.tap, hold: props.hold,
  }];
}
