// What a component IS, before anyone draws it.
//
// A component written twice, as JSX and as an entry the compile step emits,
// would be two implementations of every screen kept in agreement by hand, and
// "the React is the source of truth" a statement of intent rather than a
// property of the code.
//
// So a component does not draw: it DECLARES. `layout(props, size, style)`
// returns a list of nodes in panel pixels, and two renderers consume that one
// list. `ui/src/PanelNodes.tsx` turns it into DOM; `emit.ts` turns it into
// Nextion records. Neither owns it, which is why this package depends on
// neither React nor the `.tft` format.
//
// It is the shape that already worked twice in this repository: an icon is one
// MDI name that becomes a vector AND a glyph (panelIcons.tsx), and a typeface is
// one declaration that becomes a CSS stack AND a `.zi` (theme schema 4). This is
// the same idea applied to geometry, which is the last thing still written down
// in two places.
//
// FOUR RULES, and each of them exists because breaking it is what put the
// geometry in two places to begin with:
//
//   1. Panel pixels, relative to the placement. Not CSS, not flex, not
//      percentages. A Nextion component is `x,y,w,h` in device pixels and there
//      is no layout engine on the glass -- a component that centred itself with
//      flexbox could not tell the compiler where it ended up.
//   2. Colours are TOKEN IDS, never hex and never RGB565. The DOM resolves a
//      token through the palette, the emitter through the theme document, and
//      the two cannot disagree about a colour they never spell out.
//   3. Fonts are ROLES, never sizes. A Nextion Text names a font id and draws it
//      at that font's own height; there is no scale attribute. A component that
//      asked for 14px was asking for something the panel cannot do, and the
//      React column was showing it anyway.
//   4. Text is a VALUE, which may be a binding. A binding compiles to an empty
//      `txt` plus a manifest entry, so `$screen.title` reaches the manifest and
//      never the glass.
//
// And one thing that is NOT a rule but a consequence: where the attribute set
// cannot express a look at all, a node declares the look anyway and the emitter
// buys it with an ASSET. A gradient track is the first case (`paint.ts`); the
// node says "this ramp", the compiler generates the picture, and the React
// column draws the same ramp as CSS. What it costs in bytes is measured, not
// guessed, and it is the compiler's problem rather than the component's.

import type { Paint } from "./paint.js";

/** A rectangle in panel pixels, relative to the placement the component was given. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The smallest side a Nextion component may have, in panel pixels.
 *
 * The Editor refuses anything thinner in a dialog -- `width and height must be
 * >= 2` -- which is a measured rule and not ours (m21/m22). It
 * matters more than it sounds: a hairline is not a thing this hardware draws. A
 * theme that asks for a one-pixel border is asking for a component that will not
 * compile, and the first project to try it was `shadcn-dark`, whose separators
 * came out 1x90 and whose header rule came out 420x1.
 */
export const MIN_SIDE = 2;

/** The room a component was given. It is never told WHERE it was placed. */
export interface Size {
  w: number;
  h: number;
}

/**
 * A colour, by the id the theme's document gives it (`"text-primary"`).
 *
 * Kebab-case because that is how `theme.json` writes an id; `PANEL_PALETTE_SLOTS`
 * in `ui/src/palette.tsx` is what maps it to a renderer slot.
 */
export type ColorToken = string;

/**
 * Which cut of the typeface, by what it is FOR.
 *
 * A closed set, because each role has to resolve to a `.zi` the theme actually
 * ships: a role nobody fills is a page that will not compile, and it should be
 * caught by a test and not by the Nextion Editor.
 */
// The order is each role's Nextion font index.
export const FONT_ROLES = ["body", "title", "display", "icon", "icon-large"] as const;
export type FontRole = (typeof FONT_ROLES)[number];

export type Align = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";

/**
 * A piece of text, which the panel either already knows or will be told.
 *
 * `literal` is baked into the `.tft`; `binding` is not. A binding compiles to an
 * empty string on the glass plus one line of runtime manifest, and the generated
 * Berry fills it by addressing the component directly. The `sample` is what the
 * simulator shows so a screen can be designed before anything runs -- it is a
 * stand-in, and it must never be what gets compiled.
 */
export type Value =
  | { kind: "literal"; text: string }
  | { kind: "binding"; path: string; sample: string };

/**
 * The same idea for a number, which a Slider's `val` and a Number's `val` are.
 *
 * Separate from `Value` rather than stringly-typed, because the attribute it
 * compiles into is a number: writing `val="50"` into an `.HMI` is not a
 * different spelling, it is a different field width.
 */
export type NumberValue =
  | { kind: "literal"; n: number }
  | { kind: "binding"; path: string; sample: number };

export const literalNumber = (n: number): NumberValue => ({ kind: "literal", n });
export const bindingNumber = (path: string, sample = 0): NumberValue => ({ kind: "binding", path, sample });

/** The number a renderer should show: the literal, or the binding's stand-in. */
export const numberValue = (v: NumberValue): number => (v.kind === "literal" ? v.n : v.sample);

export const literal = (text: string): Value => ({ kind: "literal", text });
export const binding = (path: string, sample = ""): Value => ({ kind: "binding", path, sample });

/** The text a renderer should put on screen: the literal, or the binding's stand-in. */
export const valueText = (v: Value): string => (v.kind === "literal" ? v.text : v.sample);

/**
 * The `shownBy` of a part that is there only while a value holds something:
 * the binding itself, which the runtime writes; an empty literal, which hides
 * the part where it is drawn from a known value; nothing, for a part that is
 * always there. The header's action slot takes its `actionIcon` through this.
 */
export const shownWhile = (v: string | Value | undefined): Value | undefined =>
  v === undefined ? undefined : typeof v === "string" ? (v === "" ? literal("") : undefined) : v;

/**
 * What a touch does.
 *
 * `navigate` is the one the panel can honour ALONE: a `page <name>` in a Touch
 * Release needs no ESP32 and works with the serial cable unplugged, which is
 * what makes a generated `.tft` testable on its own. `report` needs the other
 * side and is what reaches `berry/`.
 */
export type Action =
  | { kind: "navigate"; screen: string }
  | { kind: "report"; event: string };

/**
 * A colour that may not be known until the panel is running.
 *
 * Most colours are the theme's and are baked in. Some are not: the panel sends
 * `statusUpdate~icon1~color1~icon2~color2`, so a status icon's colour arrives at
 * run time, and a light's icon changes colour with its own hue. `pco` is
 * writable from Berry, so both are bindings -- the token is what the simulator
 * draws and what the compiled page starts as.
 *
 * A token stays a token: rule 2 of this file is not weakened, because a binding
 * still never spells out a colour, it names where one will come from.
 */
export type ColorRef =
  | { kind: "token"; token: ColorToken }
  | { kind: "binding"; path: string; sample: ColorToken }
  /**
   * One of two of the THEME's colours, picked by a 0/1 binding.
   *
   * A settings row lights up when the thing it names is on. Which two colours
   * "lit" and "unlit" are is the theme's decision, and what is on is the
   * runtime's -- so the wire carries the 0 or the 1 and never a colour, and
   * the manifest carries both RGB565 values beside the path, resolved from
   * this theme's own document. The runtime picks one; no side ever spells out
   * a colour the theme did not choose.
   */
  /**
   * `alt` is a third colour, for the value 2: a list row that destroys, in
   * the theme's destructive colour. The same binding carries it,
   * so a row is unlit, lit or destructive by one number.
   */
  | { kind: "switch"; path: string; on: ColorToken; off: ColorToken; sample: number; alt?: ColorToken };

export const colorToken = (token: ColorToken): ColorRef => ({ kind: "token", token });
export const colorBinding = (path: string, sample: ColorToken): ColorRef => ({ kind: "binding", path, sample });
export const colorSwitch = (path: string, on: ColorToken, off: ColorToken, sample = 0, alt?: ColorToken): ColorRef =>
  ({ kind: "switch", path, on, off, sample, ...(alt === undefined ? {} : { alt }) });

/** The token a renderer should paint with: the declared one, or the binding's stand-in. */
export const colorOf = (c: ColorRef): ColorToken =>
  c.kind === "token" ? c.token : c.kind === "binding" ? c.sample
    : c.sample === 2 && c.alt !== undefined ? c.alt : c.sample !== 0 ? c.on : c.off;

/** A Text's colour, whichever way it was given: a bare token, or a reference. */
export const textColorOf = (c: ColorToken | ColorRef): ColorToken => (typeof c === "string" ? c : colorOf(c));

interface NodeBase {
  /**
   * A stem for the Nextion object name, unique within one component.
   *
   * Only a stem: the emitter appends the placement's index and truncates to the
   * 14 characters a `.HMI` allows, because uniqueness is per PAGE and a
   * component does not know how many times it was placed.
   */
  id: string;
  box: Box;
  /**
   * A value this node is on the glass only while it holds something: shown
   * while the text is not empty, hidden -- no drawing, no touch -- while it
   * is. A binding compiles to the node's `vis`, which the runtime writes with
   * the value (`present`). The header's action slot is the case: a view with
   * no action draws no plate there and takes no touch (and no empty filled
   * square).
   */
  shownBy?: Value;
}

/**
 * Text. `background` is the box it paints before the letters, because a Nextion
 * has no transparency: every Text fills its own rectangle in `bco` first, and
 * omitting it leaves the previous page's pixels behind the words. `undefined`
 * means the page's own colour, which is the common case.
 */
export interface TextNode extends NodeBase {
  kind: "text";
  value: Value;
  /**
   * What this text says when the keyboard is in CAPS, for the one case that
   * needs it: the stacked keypad key draws its letters as a Text under its
   * digit, so the letters cannot ride on a key's own `capsCap`. Given here,
   * the Text joins the block `kbRef` rewrites and the mode becomes visible
   * (without it CAPS would change what the keypad types and nothing it shows).
   */
  capsValue?: string;
  font: FontRole;
  /**
   * A token nearly always. A `ColorRef` when the colour changes at run time --
   * a settings row's label lights up with the setting (`kind: "switch"`) --
   * because `pco` is writable from Berry on a Text exactly as on an icon.
   */
  color: ColorToken | ColorRef;
  background?: ColorToken;
  align: Align;
  valign: VAlign;
}

/**
 * What a touchable node carries.
 *
 * `hold` is the long press, and it is separate because the panel cannot tell the
 * two apart on its own: a Nextion reports Touch Press and Touch Release, and
 * deciding that 500 ms passed between them is the other end's job. A component
 * that declared only `action` would be a light card whose detail screen is
 * unreachable, which is exactly the obligation `ui/src/contracts.ts` says is the
 * panel's and not the theme's.
 */
export interface Touchable {
  action?: Action;
  hold?: Action;
}

/** A filled rectangle, optionally the thing that takes the tap. */
export interface FillNode extends NodeBase, Touchable {
  kind: "fill";
  color: ColorToken;
}

/**
 * An icon, by the role the screens ask for -- never by name and never by
 * codepoint. Which drawing a role resolves to is the theme's, and the three in
 * this repository answer differently.
 */
export interface IconNode extends NodeBase {
  kind: "icon";
  /**
   * Which drawing, by role -- a compile-time string, or a `Value` when the role
   * is decided at run time (a bulb that shows `lightOn` or `lightOff` by its
   * state). A bound role reaches the manifest as a `glyph` binding: the wire
   * carries the ROLE NAME, and the generated runtime turns it into the glyph
   * with the theme's own role table, so no codepoint ever crosses the wire.
   */
  role: string | Value;
  color: ColorRef;
  background?: ColorToken;
  /** icon size is a font choice, not a scale (panelIcons.tsx) */
  font: Extract<FontRole, "icon" | "icon-large">;
}

/**
 * A track with a pointer on it.
 *
 * The one node whose look the attribute set cannot fully carry: a Nextion Slider
 * has `bco` and `pco` and no gradient, so a ramp track becomes a generated
 * PICTURE and the emitter asks for one (`paint.ts`). That is the first member of
 * a family -- looks the glass can hold but the attributes cannot name, bought
 * with bytes -- and the mechanism is meant to carry the rest of it.
 */
export interface SliderNode extends NodeBase {
  kind: "slider";
  /** 0..`max`, and the thing the panel is told at run time */
  value: NumberValue;
  /**
   * The top of the range, `maxval` on the glass. 100 unless said: every slider
   * that moves a light is a percentage. A page-rail's is the last page's index,
   * and it is what makes that rail PAGED -- `val` is an integer, so a rail with
   * `max` 1 has two values. The pointer does not jump between them: it follows
   * the finger, and goes to its value's place when `val` is written (`land`).
   */
  max?: number;
  /**
   * The position is a page: as the finger lets go, the pointer goes to the
   * place of the value it stopped on, before the release reports. Without it,
   * it stayed where the finger left it until the runtime wrote the page back,
   * and moved on its own a moment later (on the glass).
   */
  land?: boolean;
  /**
   * A binding carrying the list's page COUNT, when the runtime decides it: the
   * slider's `maxval` becomes a runtime value, and the slider is hidden on a
   * list of one page. `max` is then only what it compiles with.
   */
  pages?: string;
  /**
   * `mode` on the glass: 0 horizontal, 1 vertical (the only two the Editor
   * accepts). Horizontal unless said. In the node, a vertical
   * slider's 0 is at the TOP, the way a list reads; which end the Nextion puts
   * its minimum at is the emitter's business (`VERTICAL_MIN_AT_BOTTOM`).
   */
  orientation?: "horizontal" | "vertical";
  track: Paint;
  /** the pointer bar's size in panel pixels (`wid` and `hig`) */
  pointerWidth: number;
  pointerHeight: number;
  /**
   * Rounded ends, in panel pixels.
   *
   * A Nextion Slider has no radius attribute, so this is not an attribute on the
   * compiled side -- it is painted into the track picture (`PictureSpec.radius`)
   * at no extra pixels. A solid track cannot honour it and draws square.
   */
  radius: number;
  /**
   * What a change of value reports. Unlike a tap it carries the value, so on
   * the glass it is not a constant `printh` but joBr99's build-and-send recipe
   * (`wire.ts:valueFrameLines`), run on Touch Release -- and on Touch Move too
   * when `live` says so.
   */
  action?: Action;
  /**
   * Whether the value is reported WHILE the finger drags, or only when it lets
   * go. `true`/`false` decide here; `"auto"` (the default) follows the panel's
   * own "live slider update" setting, a global Variable the emitter is told
   * about (`EmitOptions.liveFlag`) -- so the same page can be told either way
   * at run time, and a placement can pin one.
   */
  live?: "auto" | boolean;
  /**
   * Touch past the track's bottom end, in panel pixels, drawn as nothing. A
   * tap there puts the pointer at that end and reports it, as a release at
   * the end of the track would. Vertical sliders only.
   *
   * It exists because a Nextion Slider's touch IS where its pointer runs:
   * a box taller than the drawing would carry the pointer below the stripe.
   * So the track stops where the eye wants it, and a Hotspot under it gives
   * the finger the rest (the scrollbar, drawn up to
   * the last row's label, touchable to the glass's edge). A drag that STARTS
   * there does not move the pointer -- that belongs to the track.
   */
  tail?: number;
}

/**
 * A control that keeps its own two states.
 *
 * A Nextion dual-state Button flips and repaints itself on tap without waiting
 * for the ESP32 to answer, which is the whole reason to use one: a switch that
 * needed a round trip to show that it moved would feel broken on a panel that
 * may have no network.
 *
 * The rail and knob the three themes draw are not attributes -- a ButtonT has
 * two fill colours and nothing else -- so a theme that wants the real shape asks
 * for `art`, and the compile step generates the two pictures (`paint.ts`). A
 * theme that does not gets two coloured rectangles, which is what the attribute
 * set can say by itself.
 */
export interface ToggleNode extends NodeBase, Touchable {
  kind: "toggle";
  /** 0 or 1, and what the panel is told when the state changes elsewhere */
  value: NumberValue;
  off: ColorToken;
  on: ColorToken;
  /** the knob, when this theme asks for generated art; ignored otherwise */
  knob: ColorToken;
  /** draw the rail and knob as pictures instead of flat fills */
  art: boolean;
  /** corner radius of the generated rail, in panel pixels */
  radius: number;
  /**
   * A `page.objname` whose `val` follows this switch ON THE GLASS, written in
   * the same Touch Release that reports the change. It is how the "live slider
   * update" switch reaches the sliders' Touch Move handlers without a round
   * trip: they read that Variable, not the ESP32.
   */
  mirror?: string;
}

/** A touch target that draws nothing. */
export interface TouchNode extends NodeBase, Touchable {
  kind: "touch";
  /**
   * A `page.objname` whose `val` flips ON THE GLASS, in the same Touch
   * Release that reports the change -- the same mechanism `ToggleNode.mirror`
   * gives a switch, for a component with no `val` of its own to copy from. A
   * `touch` node has nothing on the glass that already tracks the state (no
   * ButtonT to read `val` off), so the release toggles the target itself:
   * `mirror.val=1-mirror.val`, rather than copying a state that does not
   * exist here.
   */
  mirror?: string;
  /**
   * The placement's texts light while the finger is down on it, in the theme's
   * `pressed`, and go back as it leaves: painted by the glass itself, with no
   * word to the ESP32. A list's row
   * says it, and the whole row lights whichever of its touches the finger took.
   */
  light?: boolean;
}

/**
 * What one key of the on-screen keyboard does.
 *
 * Only two of the six reach the ESP32. The rest happen entirely on the glass,
 * which is the whole point: a keystroke that had to cross the serial line would
 * put a round trip between the finger and the letter.
 *
 *   char       appends its OWN CAPTION, so CAPS works by rewriting captions
 *              rather than by remembering a second alphabet (the vendor's trick)
 *   space      appends a literal blank; its caption says "SPACE"
 *   backspace  `txt-=1`, one instruction
 *   caps       flips the case of every char key on the page
 *   commit     reports the typed text and lets the runtime decide what it means
 *   cancel     reports, so the runtime can send the finger back where it came from
 */
export type KeyRole = "char" | "space" | "backspace" | "caps" | "commit" | "cancel" | "cycle" | "layout";

/**
 * The keyboard a `layout` key goes to: the QWERTY (`letters`), the T9 keypad
 * (`keypad`) or the symbols (`symbols`). The glass jumps to its
 * page by itself; the simulator re-renders.
 */
export type KeyboardTarget = "letters" | "keypad" | "symbols";

export interface KeyNode extends NodeBase {
  kind: "key";
  /**
   * Where the finger counts as on this key, when that is more than its face:
   * the key's cell, gap included (`keyboardGeometry().cell`). The face is
   * `box`, what the eye sees.
   */
  touch?: Box;
  role: KeyRole;
  /** the caption, and for `char` the character it inserts */
  cap: string;
  /**
   * The caption while CAPS is on. A char key without one does not change with
   * CAPS -- which is every digit, and the full stop.
   */
  capsCap?: string;
  /**
   * Draw the caption as an ICON ROLE instead of as letters.
   *
   * The backspace key wants the arrow everyone knows, and the theme fonts are
   * 191-glyph subsets of ASCII and Latin-1 -- it is not in there, nor is an em
   * dash. On this panel an icon IS
   * a glyph of the icon font, so the honest way to draw one is to name a role
   * and let the theme answer, exactly as an `icon` node does.
   */
  capIcon?: string;
  /** the key's face */
  color: ColorToken;
  /** the face while CAPS is on, for the CAPS key itself */
  activeColor?: ColorToken;
  textColor: ColorToken;
  font: FontRole;
  /**
   * `cycle` only: the characters this key steps through, in order.
   *
   * Multi-tap, which is the whole of T9 without a dictionary: press once for
   * the first, again inside the window for the second, and so on round. The
   * digit goes last, the way every phone keypad has done it since 1997 -- it is
   * the one everybody reaches for least.
   */
  cycle?: readonly string[];
  /** `cycle` only: the same characters in upper case, when CAPS is on */
  cycleCaps?: readonly string[];
  /**
   * `commit` and `cancel` report; `layout` navigates to another keyboard.
   *
   * The switch is a `page` jump the glass takes by itself, which is what keeps
   * changing layout free: no round trip, and the line survives because it does
   * not live on any of the pages (`emit.ts`, the keyboard's globals).
   */
  action?: Action;
  /** `layout` only: which keyboard it goes to, for a renderer with no pages to jump to */
  to?: KeyboardTarget;
}

/**
 * The line being edited: what the finger has typed so far.
 *
 * Two components, not one, and the second is invisible. A Nextion Text holds a
 * string but a Text on a page the finger is not looking at is awkward to build
 * a frame from, so the VALUE lives in a string Variable (`kbIn`) and the Text
 * (`kbShow`) only displays it. Every key writes both -- one instruction each.
 */
export interface FieldNode extends NodeBase {
  kind: "field";
  value: Value;
  max: NumberValue;
  font: FontRole;
  color: ColorToken;
  background?: ColorToken;
  align: Align;
  /**
   * The caret off: a keypad's character the same key can still change. The glass decides it by
   * itself (`kbTap`, emit.ts); this is the simulator's drawing of the same moment.
   */
  caretOff?: boolean;
}

/**
 * The pattern pad's nine dots, which the finger joins.
 *
 * A node of its own because what it asks of the page is not a component's. The
 * finger is followed ON THE GLASS by the gesture block every page carries (the
 * one TouchCap and its 50 ms Timer): each tick tests the finger against the
 * dots, lights the one it reached and draws the line to it. Only the release
 * leaves the panel, as one number: a digit a dot, 1 to 9 left to right and top
 * to bottom, in the order the finger went.
 */
export interface PatternNode extends NodeBase {
  kind: "pattern";
  /** each dot's box, left to right and top to bottom, in the node's own coordinates */
  dots: Box[];
  /** how far from a dot's centre, along either axis, the finger counts as on it */
  radius: number;
  /** the dot's drawing, by role */
  role: string;
  /** the dots before the finger comes -- a switch on the binding that paints them wrong */
  color: ColorRef;
  /** a dot the finger reached, and the line to it: written by the glass, never the runtime */
  lit: ColorToken;
  font: Extract<FontRole, "icon" | "icon-large">;
  /** the release, carrying the dots */
  action?: Action;
}

/**
 * A QR code: a text a phone's camera reads, which the glass
 * encodes and draws by itself -- a Nextion Qrcode. The page only writes the
 * text, so a view that has one is a view that writes a string.
 *
 * `capacity` is its `txt_maxl`: the most bytes the runtime will write into it,
 * and what the component reserves page RAM for, by the QR version that many
 * bytes need. A text longer than it would be cut by the glass,
 * and a cut QR text is a code that reads as something else, so the runtime
 * refuses one instead (berry/panel_ui.be).
 *
 * The modules are `dark` on `light`, whatever the theme: a camera reads a code
 * dark on light, and the box is the quiet zone around it.
 */
export interface QrNode extends NodeBase {
  kind: "qrcode";
  value: Value;
  capacity: number;
  dark: ColorToken;
  light: ColorToken;
}

/**
 * A Nextion Button that is its own face and its own touch: the face, what is
 * written on it -- words, or a glyph by its role -- and the glass's own pressed
 * look while the finger is down, the Button's `bco2` and `pco2`, which the glass
 * paints and undoes whatever face the runtime last wrote. A `light` touch could
 * not: it puts back the face it was compiled with. The face and the words change
 * at run time as a `ColorRef`, the lit mode of a thermostat's page.
 */
export interface ButtonNode extends NodeBase, Touchable {
  kind: "button";
  /** the words on it; nothing when `role` puts a glyph there */
  value?: Value;
  /** the glyph on it, by role, as an icon's: a compile-time string, or a `Value` decided at run time */
  role?: string | Value;
  font: FontRole;
  /** the words', or the glyph's, colour */
  color: ColorToken | ColorRef;
  face: ColorToken | ColorRef;
  /** the face while the finger is down, and the words on it then */
  pressed: ColorToken;
  pressedText: ColorToken;
}

export type PanelNode =
  | TextNode | FillNode | IconNode | SliderNode | ToggleNode | TouchNode
  | KeyNode | FieldNode | PatternNode | QrNode | ButtonNode;

/**
 * How a theme draws, as values rather than code: radius, borders, weights,
 * density, and the CSS stack the React column honours.
 *
 * This is the theme document's `style` block. It lives here and not in `ui/`
 * because a layout function reads it and a layout function may not import React
 * -- and `ui/src/panelStyle.tsx` re-exports it so nothing else moved.
 */
export interface PanelStyle {
  /** corner radius in panel pixels */
  radius: number;
  /** border thickness in panel pixels; 0 draws none */
  borderWidth: number;
  cardStyle: "plain" | "outlined" | "filled";
  density: "compact" | "comfortable";
  /** weight of the biggest type: the clock, the main temperature */
  displayWeight: number;
  /** weight of titles and labels */
  titleWeight: number;
  /** an icon's size as a fraction of the box it sits in */
  iconScale: number;
  /**
   * The cell height of each font role, in panel pixels.
   *
   * A layout that stacks text has to know how tall the type is, and on this
   * hardware that is not its choice: a Nextion Text draws the font it names at
   * THAT font's height. Without this the clock would be back to picking numbers
   * -- which is exactly how the React one ended up asking for 72 pixels of a
   * typeface the panel only has at 80.
   *
   * Derived from the theme's own font tokens, so it cannot disagree with the
   * `.zi` the page will name.
   */
  fontHeight: Record<FontRole, number>;
  /**
   * The CSS font stack this theme's typography asks for.
   *
   * The React column honours it; the Real column does not and must not -- the
   * panel draws the theme's `.zi`, which is cut from the only face we have. The
   * two columns disagreeing about the typeface is not a bug, it is the gap
   * between the design and what the hardware can carry.
   */
  fontFamily: string;
}

/**
 * A box cut into equal columns, in panel pixels.
 *
 * The last column takes the rounding, so the row ends exactly on the right edge
 * instead of a pixel or two short of it -- which on a five-column weather row is
 * the difference between a tidy strip and one that looks off-centre.
 */
export function columns(size: Size, count: number, gap = 0): Box[] {
  // The gap has to fit, and a test caught it not fitting: five cells with four
  // pixels between them in a twelve-pixel box left the last one starting past
  // the right edge. A component outside its placement is refused by the Editor,
  // so the gap gives way before the cells do.
  const room = Math.max(0, Math.floor((size.w - count) / Math.max(1, count - 1)));
  const g = Math.max(0, Math.min(gap, room));
  const inner = Math.max(0, size.w - g * (count - 1));
  const w = Math.floor(inner / count);
  let x = 0;
  return Array.from({ length: count }, (_, i) => {
    const w2 = i === count - 1 ? Math.max(1, size.w - x) : Math.max(1, w);
    const box = { x, y: 0, w: w2, h: size.h };
    x += w2 + g;
    return box;
  });
}

/**
 * Rows stacked down the middle of a box, in panel pixels.
 *
 * Vertically centred while they fit, and scaled down proportionally when they do
 * not -- never allowed out of the box, because the box is the contract with the
 * compiler and a node that overflowed would emit a component overlapping its
 * neighbour. A clock asked to live in twelve pixels gets a twelve-pixel clock,
 * clipped, which is what the glass would do with it anyway.
 */
export function stackRows(size: Size, heights: readonly number[], gap = 0): Box[] {
  const n = heights.length;
  if (n === 0) return [];
  const natural = heights.reduce((a, b) => a + b, 0) + gap * (n - 1);
  if (natural <= size.h) {
    let y = Math.round((size.h - natural) / 2);
    return heights.map((h) => {
      const box = { x: 0, y, w: size.w, h };
      y += h + gap;
      return box;
    });
  }
  const scale = size.h / natural;
  let y = 0;
  return heights.map((h, i) => {
    // the last row takes whatever rounding left over, so the stack ends exactly
    // on the bottom edge instead of a pixel short of it
    const h2 = i === n - 1 ? Math.max(1, size.h - y) : Math.max(1, Math.round(h * scale));
    // NOT clamped to MIN_SIDE here: a box too small for its rows is a real
    // situation and squeezing them to 2 each would push the last one out. What
    // happens instead is that the emitter drops what cannot be drawn and says so.
    const box = { x: 0, y, w: size.w, h: h2 };
    y += h2 + Math.round(gap * scale);
    return box;
  });
}

/** Spacing in panel pixels at a given density. */
export function densitySpacing(style: PanelStyle): { gap: number; pad: number } {
  return style.density === "compact" ? { gap: 2, pad: 4 } : { gap: 4, pad: 8 };
}

/**
 * The style a layout receives: the theme's own `style` block, plus what its
 * fonts resolve to.
 *
 * Here and not in each caller because there are four of them -- the simulator's
 * runtime, the Themes tab, the compile step and the tests -- and the first
 * version of this had the derivation written in two of them and missing from the
 * other two, so the clock crashed the moment it asked how tall its own type was.
 */
export function layoutStyle(
  style: Omit<PanelStyle, "fontHeight">,
  fonts: readonly { role: FontRole; height: number }[],
): PanelStyle {
  return { ...style, fontHeight: Object.fromEntries(fonts.map((f) => [f.role, f.height])) as Record<FontRole, number> };
}

/** A layout function: what every theme component is, once it stops drawing. */
export type LayoutFn<P> = (props: P, size: Size, style: PanelStyle) => PanelNode[];
