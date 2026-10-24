// Nodes become Nextion records.
//
// This is what replaces the hand-written `EMIT` table in
// `export/scripts/build-project-hmi.mjs`. The difference is not that the code
// moved: it is that this function has no idea what a clock looks like. It knows
// five node kinds and how each becomes a record, and every piece of geometry it
// writes came from the same `layout()` the simulator drew. There is nothing left
// for the two to disagree about.
//
// It emits the record SHAPE that `build-hmi-scenario.mjs` already takes, rather
// than touching an `.HMI` directly, because that vocabulary is what eleven
// measuring runs and the whole m1/m10/m11 corpus were written in and what the
// Nextion Editor has already accepted.
import { MULTITAP_MS } from "./keyboard.js";
import { MIN_SIDE } from "./node.js";
import type { Action, ColorRef, ColorToken, FontRole, NumberValue, PanelNode, Touchable, Value } from "./node.js";
import { defaultDither, rgb565To24, type PictureSpec } from "./paint.js";
import { HOLD_MS, SLIDE_COOLDOWN_MS, printhFrame, textFrameLines, touchPayload, valueFrameLines, type ValueGesture } from "./wire.js";

/**
 * Text written into a string of the Nextion's instructions, as it reads one: the backslash and the double quote escaped, which it reads as
 * one character each. A caption is an attribute and needs none; what the code writes, the signs' keypad's backslash above all, does.
 */
export const nextionLiteral = (c: string): string => c.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** A Nextion component as a scenario describes it. */
export interface NextionRecord {
  type: string;
  objname: string;
  /** omitted for the types whose template has none, such as a Timer */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  attributes?: Record<string, string | number>;
  events?: { event: string; lines: string[] }[];
}

/**
 * One thing the panel does not know yet.
 *
 * A binding is the reason a compiled page can be generic: the `.tft` carries an
 * empty string and the generated Berry fills it by name. Without this the
 * compiler had two bad options, and took the worse one -- it wrote the binding
 * EXPRESSION onto the glass, so a real panel would have displayed the literal
 * text `$screen.title`.
 */
export interface BindingEntry {
  page: string;
  objname: string;
  /** the Nextion attribute to set: `txt` for text, `val` for a number */
  attribute: string;
  /** the path the project declared, e.g. `$screen.title` */
  path: string;
  /**
   * `glyph` when the value that arrives is an icon ROLE and the runtime has to
   * turn it into the theme's glyph before writing `txt`. `switch` when it is a
   * 0/1 and the runtime writes `on` or `off` (RGB565, below) into `pco` -- a
   * settings row lighting up. `flip` when it is a position on a vertical
   * slider whose Nextion minimum sits at the other end from the node's 0, and
   * the runtime writes `max - value`. `pages` when it is a paged list's page
   * COUNT: the runtime writes the slider's `maxval` (count - 1), remembers it
   * for the `flip` of the same slider, and shows the slider only when there is
   * more than one page. `paged` when it is that count too, for a part of the
   * scrollbar that goes with it: `vis` 1 with a second page, 0 without (its
   * tail). `present` when the value decides whether the component is there at
   * all: `vis` 1 while it holds something, 0 while it is empty
   * (`NodeBase.shownBy`). Absent, the value is written as it comes (text
   * quoted, number bare, colour token resolved).
   */
  kind?: "glyph" | "switch" | "flip" | "pages" | "paged" | "present";
  /** `switch` only: the theme's two colours, already RGB565, and a third for the value 2 */
  on?: number;
  off?: number;
  alt?: number;
  /** `flip` only: the slider's `maxval` */
  max?: number;
  /**
   * How many BYTES this slot can hold, when the emitter was given a way to
   * measure: the `txt_maxl` written into the page. A buffer, not a promise --
   * the runtime fits every text it writes to the box by width (`fit`), and this
   * only has to hold whatever fits.
   */
  maxl?: number;
  /**
   * `txt` slots only: the box's width and the font role it is drawn in, so the
   * runtime can cut a text at the last whole character that fits
   * (`export/src/textRaster.ts`, `fitZiText`).
   */
  fit?: { width: number; font: FontRole };
  /**
   * What the page was compiled showing, when that is not blank. The runtime
   * starts from it: an editable title has to have a value before anyone has
   * ever edited it, and the project's own `screen.title` is that value.
   */
  initial?: string;
  /**
   * The tag of the placement's theme, when it is not the project's own
   * (`EmitOptions.themeTag`): the runtime resolves an icon role, a fitted text's
   * font and a colour token for this target in that theme's tables.
   */
  theme?: string;
}

/** A touch the panel reports rather than handles by itself. */
export interface EventEntry {
  page: string;
  objname: string;
  /**
   * What the touch was about, as the project's own binding.
   *
   * Without it an event is unactionable: `ev,home,bCard1,tap` says WHICH
   * component and not WHICH LIGHT, and four cards on a page all mean
   * "light.toggle". The placement knows -- it binds `"light": "$lights.0"` --
   * so the compile step puts it here and the generated Berry resolves it.
   *
   * Absent for a component that is about nothing in particular, like a nav
   * arrow.
   */
  subject?: string;
  event: string;
  /**
   * Which gesture: a tap, or a press held down.
   *
   * The PANEL decides which, with a Timer (`wire.ts`), and says so in the
   * payload. So this is not something the other end has to work out -- it is the
   * mapping from what arrives on the wire to what it means, which is the one
   * thing the page deliberately does not know.
   */
  gesture: "tap" | "hold" | "change" | "slide" | "text" | "show";
  /**
   * `true` when the payload carries a number after the gesture -- a slider's
   * position on release (`change`) or during the drag (`slide`). The runtime
   * splits it off and hands it over with the event (`wire.ts:splitValuePayload`).
   */
  value?: true;
  /**
   * `true` when the payload carries TEXT after the gesture -- what the keyboard
   * typed. Separate from `value` because the reader must not demand digits of
   * it, and because a name is the one payload whose length is not known when
   * the page is built (`wire.ts:splitTextPayload`).
   */
  text?: true;
}

/** What a theme resolves to, once its document has been read. */
export interface EmitTheme {
  /** colour token id -> RGB565 */
  color(token: ColorToken): number;
  /** font role -> the font's id in the compiled `.HMI` */
  font(role: FontRole): number;
  /** icon role -> the character the theme's icon `.zi` carries for it */
  glyph(role: string): string;
  /** screen id -> the Nextion page objname, for `page <name>` */
  page(screen: string): string;
  /**
   * A picture the attribute set cannot express, in exchange for its id.
   *
   * The caller is what decides whether this is a NEW picture or one already
   * asked for: two sliders wanting the same ramp at the same size must get the
   * same id back, or the project pays twice for identical pixels. `pictureKey`
   * in `paint.ts` is the identity to deduplicate on.
   */
  picture(spec: PictureSpec): number;
}

export interface EmitOptions {
  /** the page this placement is on, for the manifest */
  pageName: string;
  /** where the placement sits on that page, in panel pixels */
  origin: { x: number; y: number };
  /** the page's own colour, for nodes that name none */
  background: ColorToken;
  /** the placement's index, which is what makes two of the same component distinct */
  index: number;
  /** what this placement is about, for the events it reports (`EventEntry.subject`) */
  subject?: string;
  /**
   * Force dithering on or off for the pictures this placement generates.
   *
   * Left out -- the normal case -- each picture gets `defaultDither`: on where
   * it makes sense and only there (a ramp dither helps, never hue, at a width
   * where the bands would show). The caller resolves it from the
   * placement's `render.dither` first and the project's `pictures.dither` second
   * (build-project-hmi.mjs), so a screen can have one smooth slider and three
   * cheap ones. It is a real price: the codec pays per run of one colour, and a
   * dithered brightness track costs about 4x the flat one (`paint.ts`).
   */
  dither?: boolean;
  /**
   * The global Variable (`page.objname`) that says whether sliders report while
   * dragging -- the panel's "live slider update" setting as the glass sees it.
   * A slider whose `live` is `"auto"` reads it in its Touch Move handler;
   * absent, `"auto"` means release-only, because there is nothing to read.
   */
  liveFlag?: string;
  /**
   * The page Variables holding where the finger LAST WAS, kept by the gesture
   * block's 50 ms Timer. Given, every tap and hold is guarded: it fires only if
   * the finger let go inside this component's own box.
   *
   * MEASURED in the Editor's debugger, because the rule is not the one every
   * GUI toolkit uses. A Nextion component fires BOTH its
   * press and its release whenever the PRESS landed on it -- wherever the finger
   * ended up. Press a card, drag off it, let go: the card still fires. And the
   * reverse never fires: press outside, release inside, and the component under
   * the finger stays silent.
   *
   * So "started outside and ended inside is a swipe" is already true of the
   * hardware and needs nothing; "started inside and left is a swipe" is not, and
   * is what this guard implements. The test is on where the finger ENDED, not on
   * whether it ever left, so a finger that wandered out of a card and came back
   * is a tap.
   *
   * It has to come from the Timer: `tch0`/`tch1` are zeroed at release, so a
   * component cannot read its own release position. That is what ties the two
   * together -- a page with touchable components needs the gesture block even
   * when it declares no swipe at all.
   */
  pointerVars?: { x: string; y: string };
  /**
   * On a page whose vertical swipe is the page's own -- a paged list, which it
   * scrolls: the Variable holding how far the finger has gone up
   * or down since it landed, and the move from which it is a swipe. Every tap
   * and hold on the page fires only below it, so a swipe over one row turns the
   * list's page and does not also press the row.
   */
  still?: { variable: string; below: number };
  /**
   * How many bytes a Text showing a binding needs for its buffer (`txt_maxl`),
   * given its box and font role. Supplied by the compile step, which has the
   * theme's `.zi` files; the simulator has no need of it and passes nothing.
   *
   * A Text that shows a LITERAL does not need it -- what it says is already
   * decided. One that shows a BINDING does: its `txt_maxl` is the buffer the
   * runtime writes into, and the Editor's template default for it is ten bytes.
   * The runtime fits each text to the box by width before writing it
   * (`BindingEntry.fit`), so the buffer only has to hold whatever fits.
   *
   * `path` is the binding the Text shows, so the compile step can size a slot
   * whose every value it already knows -- the Settings labels, the Help lines
   * -- by those values rather than by the worst case a typist could reach.
   */
  textCapacity?: (width: number, font: FontRole, path?: string) => number;
  /**
   * How many characters the keyboard's field shows at once -- the count its
   * window slides by. A COUNT that must never overflow the box, so the compile
   * step answers it with the widest glyph, which is not the buffer's question.
   * Falls back to `textCapacity`.
   */
  windowCapacity?: (width: number, font: FontRole) => number;
  /**
   * The page that carries the keyboard's shared Variables, when they are not on
   * this one.
   *
   * There are TWO keyboard pages -- QWERTY and the T9 keypad, and a key on each
   * jumps to the other -- so the line being typed cannot live on either: a
   * `page` jump would leave it behind. It lives as a global (`vscope` 1) on the
   * project's first page, the same place and the same mechanism as `vaLive`,
   * and both keyboards address it as `<page>.kbIn`.
   *
   * Absent, the Variables are emitted here and named bare, which is what a
   * single keyboard with nowhere to switch to needs.
   */
  keyboardGlobals?: string;
  /**
   * A number every tap and hold of this placement reports along with itself,
   * read on the glass at the moment of the touch: `lines` put it somewhere
   * `covx` can read, `expr` names that place.
   *
   * It is how a row of a paged list says which PAGE it was on. The page lives
   * on the glass, as the page-rail slider's own `val`, and the Nextion resets
   * it whenever the page is loaded again -- so a copy kept on the other side
   * would go stale the first time the finger left and came back. Carrying it
   * in the frame means the other side never keeps one (`sliderReadout`).
   */
  carry?: { lines: string[]; expr: string };
  /**
   * The tag of this placement's theme when it is another than the project's own
   * ("@1"): every binding it emits carries it, so the runtime resolves what it
   * writes here in that theme's tables (`BindingEntry.theme`). Absent for the
   * project's own theme, and in the simulator, which resolves nothing.
   */
  themeTag?: string;
}

/**
 * Which end of a VERTICAL Nextion Slider its minimum sits at.
 *
 * NOT MEASURED YET, and the one assumption this file makes about the vertical
 * mode: a fader's convention, minimum at the bottom, which is what the vendor's
 * examples suggest. A node's vertical 0 is at the TOP (a list reads down), so
 * with this `true` the compiled `val` is `max - value` and every report turns
 * it back before it leaves the glass (`sliderReadout`); the manifest marks the
 * binding `flip` so a write from the runtime lands the same way round. When the
 * Editor's debugger says otherwise, this one constant is the whole fix.
 */
export const VERTICAL_MIN_AT_BOTTOM = true;

/**
 * The instructions that leave a slider's position, in the NODE's terms, where
 * `covx` can read it -- and the expression that reads it.
 *
 * A horizontal slider, or a vertical one whose minimum is already at the top,
 * needs nothing: `<obj>.val` is the answer. A flipped one computes `max - val`
 * into `sys2` first -- `covx` takes a variable, not an expression, and `sys0`
 * is `btlen`'s scratch in the frame recipe itself (`wire.ts:valueFrameLines`).
 *
 * The maximum is read off the slider itself, `maxval`, and not written in as
 * the compiled number: a paged list's scrollbar gets its `maxval` from the
 * runtime, whenever the view it shows changes length.
 */
export function sliderReadout(objname: string, orientation: "horizontal" | "vertical" | undefined, max: number): { lines: string[]; expr: string } {
  void max;
  if (orientation === "vertical" && VERTICAL_MIN_AT_BOTTOM) return { lines: [`sys2=${objname}.maxval-${objname}.val`], expr: "sys2" };
  return { lines: [], expr: `${objname}.val` };
}

/** A node the Editor would have refused, and why. */
export interface DroppedNode {
  page: string;
  id: string;
  w: number;
  h: number;
  reason: string;
}

export interface Emitted {
  records: NextionRecord[];
  bindings: BindingEntry[];
  events: EventEntry[];
  /**
   * Page-level components these records rely on and did not create, by name:
   * `value-frame` when a slider reports a value (it needs the page's `vaSend`
   * and `vaTmp` string Variables, shared by every slider on the page). The
   * caller adds each once per page; a placement cannot, because it does not
   * know who else is on the page.
   */
  helpers: string[];
  /**
   * Nodes that did not become components.
   *
   * Reported and not silent. A node too thin to draw is usually a theme token
   * that means something in CSS and nothing on this glass -- a one-pixel border
   * -- and whoever chose it deserves to be told, not to find a rule missing from
   * a photograph of the panel.
   */
  dropped: DroppedNode[];
  /**
   * The editing field this placement drew, when it drew one.
   *
   * Here because the CALLER is the only one that can use it: what the field can
   * show has to be compared with what the edited SLOT declares it can hold, and
   * the slot is on another page, in another font, laid out by another
   * placement. A Nextion Text clips on the right without a word, and the caret
   * is a character at the end -- so the first thing an overflowing line loses is
   * the only sign that anything is being typed at all.
   */
  keyboardField?: { width: number; font: FontRole };
  /**
   * The pattern pad this placement drew, when it drew one: where its dots are
   * on the page, and what to light them in. The CALLER writes the tests, into
   * the page's gesture block -- the one TouchCap and Timer every page shares,
   * which a placement does not own.
   */
  pattern?: PatternPad;
}

/** A pattern pad on a page, for the gesture block that follows the finger over it. */
export interface PatternPad {
  /** the name its release reports under */
  objname: string;
  /** the dots, 1 to 9: each one's Text, and its centre on the page */
  dots: { objname: string; cx: number; cy: number }[];
  radius: number;
  /** RGB565 */
  lit: number;
}

/**
 * The pattern pad's dots, by name. Fixed and not numbered by placement, like
 * the keyboard's: a page holds one pad, and the gesture block names them.
 */
export const PATTERN_DOT = "tDot";

/** Nextion's "no picture": every pic/picc attribute of an unpictured component. */
const NO_PICTURE = 65535;

/**
 * A Button's `style`, flat. The Editor's template says 4, "3D_Auto", and a
 * Button left at it is drawn with a bevel: a light top row and a dark bottom
 * one. Measured in the Editor's debugger, on the screensaver's
 * rule, a white Button 2 px tall that came out (230,226,230) over (65,68,65).
 * No theme draws a bevel, and every fill and key here is a Button.
 */
export const BUTTON_FLAT = 0;

/**
 * The keyboard's page-level components, by name.
 *
 * Fixed rather than derived from the placement index, the way `vaSend` and
 * `vaTmp` are: a page holds one keyboard, every key names these, and a name
 * that moved with the index would have to be threaded through forty records to
 * say the same thing.
 */
const KB = {
  in: "kbIn", show: "kbShow", max: "kbMax", caps: "kbCaps", ref: "kbRef",
  /** the caret: the Hotspot that redraws the line, its Timer and its on/off */
  draw: "kbDraw", blink: "kbBlink", on: "kbOn",
  /** the end of a line longer than the field, which `kbDraw` shows after ".." */
  tail: "kbTail",
  /** T9 only, and page-local: which key was last pressed and how far round it is */
  key: "kbKey", step: "kbStep", tap: "kbTap",
} as const;

/**
 * How fast the caret blinks, in milliseconds.
 *
 * 500 is what a text field has blinked at since the VT52, and it is slow enough
 * that a Nextion Timer firing it costs nothing worth measuring.
 */
const BLINK_MS = 500;

/**
 * The caret, and why it is a CHARACTER and not a component.
 *
 * The glass cannot measure text -- there is no instruction that says how wide a
 * string is in a proportional font -- so a caret drawn as a rectangle could not
 * be put next to the last letter. Appended to the string, it lands there by
 * construction, and the font already carries it (U+007C, inside the ASCII range
 * every theme font covers). Exported so the simulator appends the same one.
 */
export const CARET = "|";

/**
 * What the field shows in front of a line that slid: the same two dots a
 * runtime text is cut with (`FIT_ELLIPSIS`, export/src/textRaster.ts), so a
 * cut reads the same wherever it is.
 */
const FIELD_CUT = "..";

/**
 * How long a typed line may get, in bytes.
 *
 * Not the limit the user meets -- that is `kbMax`, read from whatever is being
 * edited -- but the size of the buffer behind it. 64 is comfortably more than
 * the longest slot on the panel, and it is NOT free: a Vari declared as a
 * string pays `align4(txt_maxl + 1) + 4` (`export/src/ramBudget.ts`), so this
 * one costs align4(65) + 4 = 72 bytes -- 72 of the 100 bytes of globals that
 * every page of `living-room` pays, on a 3584-byte panel. The flat 4 bytes is
 * the INT Vari, and an earlier version of this comment claimed it for both.
 */
const KB_MAX_BYTES = 64;

/**
 * A Nextion Slider's pointer colour: white, by choice.
 *
 * With `psta=0`, the Slider template's own default and what the emitter writes,
 * the Editor keeps the colour asked (1374 compiled and read back) and `pco` can
 * even be written at run time; with `psta=1`, an IMAGE pointer whose picture
 * (`pic2`) is none, the Editor has no colour to keep and the debugger draws no
 * pointer at all. So a themed pointer is possible; white is what the React thumb
 * draws, and the constant stays until a theme wants otherwise.
 */
export const SLIDER_POINTER_RGB565 = 65535;

const XCEN = { left: 0, center: 1, right: 2 } as const;
const YCEN = { top: 0, middle: 1, bottom: 2 } as const;

/** A Nextion object name: letters, digits and underscore, and at most 14 of them. */
export const objectName = (stem: string, index: number): string =>
  (stem.replace(/[^A-Za-z0-9_]/g, "") + index).slice(0, 14);

export function emitNodes(nodes: readonly PanelNode[], theme: EmitTheme, opts: EmitOptions): Emitted {
  const records: NextionRecord[] = [];
  const bindings: BindingEntry[] = [];
  const events: EventEntry[] = [];
  const dropped: DroppedNode[] = [];
  const helpers: string[] = [];
  /** the touches that light what is under them while the finger is down: a row's, and a key's with its face */
  const lit: { touch: NextionRecord; face?: { x: number; y: number; w: number; h: number } }[] = [];
  /** the keyboard's page-level half, filled as its keys go by */
  const keyboard: {
    /** the editing field's box and font, when this placement drew one */
    field?: { width: number; font: FontRole; window: number };
    varis: NextionRecord[];
    caps: { objname: string; lower: string; upper: string }[];
    /** a T9 page needs the multi-tap timer; a QWERTY one does not */
    multitap: boolean;
    /** every key's touch target, pushed last so nothing can be drawn over it */
    touches: NextionRecord[];
  } = { varis: [], caps: [], multitap: false, touches: [] };
  let pattern: PatternPad | undefined;
  /** `kbIn` and friends, qualified when they live on another page. */
  const kb = (name: string) => (opts.keyboardGlobals ? `${opts.keyboardGlobals}.${name}` : name);
  /** which multi-tap key was last pressed, as a number the glass can compare */
  let cycleKeys = 0;
  /**
   * Has this keyboard any caption to rewrite when CAPS flips?
   *
   * Known before the loop because the CAPS key needs the answer while it is
   * being compiled, and it may come before the letters. QWERTY rewrites
   * twenty-six; the T9 keypad rewrites nothing -- its keys say "2 abc" in either
   * case, and what CAPS changes there is only which character the next press
   * inserts.
   */
  // A Text counts too: the stacked keypad key draws its letters as one, and a
  // keyboard whose only CAPS captions are Texts would have a CAPS key that changes
  // the flag and clicks nothing (scenario B20).
  const rewritesCaps = nodes.some((n) =>
    (n.kind === "key" && n.capsCap !== undefined) || (n.kind === "text" && n.capsValue !== undefined));
  /**
   * Has this keyboard multi-tap keys? Known before the loop for the same reason
   * as `rewritesCaps`: the backspace key needs the answer while it is being
   * compiled, and `kbKey`/`kbTap` only exist on a page that has them.
   */
  const hasCycle = nodes.some((n) => n.kind === "key" && n.role === "cycle");

  /**
   * Append `expr` to the line, if the line has room.
   *
   * The capacity test is the vendor's, instruction for instruction: `btlen`
   * into a scratch, compare with the slot's own maximum, and only then append.
   * Without it the Text truncates in silence at `txt_maxl` and the panel shows
   * a name the user never typed.
   */
  /**
   * Redraw the line with the caret showing, and restart the blink.
   *
   * One Hotspot holds those instructions and every key clicks it, the same
   * trick the CAPS key uses for the caption rewrite -- and the same trick the
   * vendor's own keyboard uses, from a Touch Release and from the page's `load`
   * alike. Restarting the blink is what makes the caret solid while you type
   * instead of blinking out from under your finger.
   */
  const redraw = `click ${KB.draw},0`;

  const appendLines = (expr: string): string[] => [
    `btlen ${kb(KB.in)}.txt,sys0`,
    `if(sys0<${kb(KB.max)}.val)`, "{",
    `  ${kb(KB.in)}.txt+=${expr}`,
    `  ${redraw}`,
    "}",
  ];

  const bg = (token: ColorToken | undefined) => theme.color(token ?? opts.background);

  /** The number that gets baked in, and the manifest line when it must not be. */
  const compiledNumber = (objname: string, attribute: string, value: NumberValue): number => {
    if (value.kind === "literal") return value.n;
    bindings.push({ page: opts.pageName, objname, attribute, path: value.path });
    return value.sample;
  };

  /**
   * The colour that gets baked in, and the manifest line when it will change.
   *
   * `pco` is writable from Berry, which is what makes a status icon's colour --
   * sent by the panel as `statusUpdate~icon1~color1~...` -- a binding rather than
   * a constant. The compiled page starts at the declared token so the screen is
   * never blank while it waits.
   */
  const compiledColor = (objname: string, attribute: string, colour: ColorRef): number => {
    if (colour.kind === "token") return theme.color(colour.token);
    if (colour.kind === "switch") {
      // both colours travel in the manifest, resolved HERE from the theme, so
      // the runtime picks between two numbers and never names a colour
      const on = theme.color(colour.on);
      const off = theme.color(colour.off);
      const alt = colour.alt === undefined ? undefined : theme.color(colour.alt);
      bindings.push({ page: opts.pageName, objname, attribute, path: colour.path, kind: "switch", on, off, ...(alt === undefined ? {} : { alt }) });
      return colour.sample === 2 && alt !== undefined ? alt : colour.sample !== 0 ? on : off;
    }
    bindings.push({ page: opts.pageName, objname, attribute, path: colour.path });
    return theme.color(colour.sample);
  };

  /**
   * The role whose glyph gets baked in, and the `glyph` manifest line: the wire
   * will carry a role NAME and the runtime owns the role -> glyph table.
   */
  const compiledGlyphRole = (objname: string, role: Value): string => {
    if (role.kind === "literal") return role.text;
    bindings.push({ page: opts.pageName, objname, attribute: "txt", path: role.path, kind: "glyph" });
    return role.sample;
  };

  /** The text that gets baked in, and the manifest line when it must not be. */
  const compiledText = (objname: string, attribute: string, value: Value, maxl?: number, fit?: BindingEntry["fit"]): string => {
    if (value.kind === "literal") return value.text;
    // The sample is what the page is COMPILED with, so a binding nobody has
    // written yet shows something rather than a blank box -- and for a title
    // the sample is the project's own word for the screen, which is what the
    // panel should say from the first frame after a flash.
    bindings.push({
      page: opts.pageName, objname, attribute, path: value.path,
      ...(maxl === undefined ? {} : { maxl }),
      ...(fit === undefined ? {} : { fit }),
      ...(value.sample === "" ? {} : { initial: value.sample }),
    });
    return value.sample;
  };

  /**
   * A touch, and what the panel does with it before anyone else hears.
   *
   * THREE THINGS, and the middle one was wrong here until it was measured:
   *
   *   navigate  a `page <name>` in the Touch Release. Needs nothing on the other
   *             end of the serial line, which is what makes a generated `.tft`
   *             walkable before any Berry exists.
   *   hold      a Timer, armed on press and disarmed on release. This file used
   *             to say the panel "cannot tell them apart" and that timing the
   *             gap was the other end's job -- joBr99's own file disproves it:
   *             `bEntity1.down` does `tmLP.en=1`, `bEntity1.up` does
   *             `tmLP.en=0`, and `tmLP` carries `tim = 244,1` = 500 ms. The
   *             panel discriminates by itself and always could.
   *   report    a `printh` of the whole frame. Constant at compile time, so it
   *             is one instruction and not his eleven (`wire.ts`).
   *
   * The tap is suppressed when the hold already fired, and the timer's own `en`
   * is what remembers: still running means the finger came up early. That costs
   * no extra component, where joBr99 accepts the double.
   */
  /**
   * Wrap `body` so it runs only when the finger let go inside `box`.
   *
   * Four nested tests because the instruction set has no `&&` and no rectangle
   * test. Indented, which is cosmetic in the compiled bytecode and the
   * difference between reading this and not.
   */
  const insideBox = (box: { x: number; y: number; w: number; h: number }, body: string[]): string[] => {
    const p = opts.pointerVars;
    if (!p || body.length === 0) return body;
    const pad = (n: number) => " ".repeat(n * 2);
    const s = opts.still;
    const inner = s ? [`if(${s.variable}.val<${s.below})`, "{", ...body.map((l) => pad(1) + l), "}"] : body;
    return [
      `if(${p.x}.val>=${box.x})`, "{",
      `${pad(1)}if(${p.x}.val<=${box.x + box.w - 1})`, `${pad(1)}{`,
      `${pad(2)}if(${p.y}.val>=${box.y})`, `${pad(2)}{`,
      `${pad(3)}if(${p.y}.val<=${box.y + box.h - 1})`, `${pad(3)}{`,
      ...inner.map((l) => pad(4) + l),
      `${pad(3)}}`, `${pad(2)}}`, `${pad(1)}}`, "}",
    ];
  };

  const attach = (record: NextionRecord, touch: Touchable, mirror?: string) => {
    const lines: { event: string; lines: string[] }[] = [];
    const holding = touch.hold !== undefined;
    // the box this component occupies on the page, which is what the guard tests
    const box = { x: record.x ?? 0, y: record.y ?? 0, w: record.w ?? 0, h: record.h ?? 0 };
    // A component with no `val` of its own to copy from (a Hotspot, unlike a
    // ButtonT) mirrors by flipping the TARGET Variable in place, in the same
    // release that reports the tap -- `TouchNode.mirror`'s own doc has the why.
    // `1-x`, not `x==0`: the Editor refuses a comparison as the right-hand side
    // of an assignment ("Invalid Variables", measured: a project that mirrors
    // with it does not compile), and the Variable only ever holds 0 or 1.
    const mirrorLine = mirror ? [`${mirror}.val=1-${mirror}.val`] : [];

    if (holding) {
      // one Timer per holdable component: a page-wide one would need a second
      // place to remember WHICH component armed it
      const timer = `tm${record.objname}`.slice(0, 14);
      // no geometry at all: a Timer is not on the screen, and `buildComponent`
      // refuses x/y/w/h on a type whose template has none
      records.push({
        type: "Timer",
        objname: timer,
        attributes: { tim: HOLD_MS, en: 0 },
        // The hold is guarded too, and on the same box: a long press that has
        // already been dragged off the card is a swipe in progress, not a hold.
        // It fires mid-gesture rather than at release, which is exactly why the
        // guard reads the LIVE position and not a release coordinate.
        events: [{ event: "timer", lines: [`${timer}.en=0`, ...insideBox(box, actionLines(record.objname, touch.hold!, "hold"))] }],
      });
      lines.push({ event: "down", lines: [`${timer}.en=1`] });
      const up = [...actionLines(record.objname, touch.action, "tap"), ...mirrorLine];
      // the timer still running means this was a tap; already stopped means the
      // hold fired and the finger is only coming back up -- the mirror flips
      // only on that same branch, never on a hold that opens Help instead
      lines.push({ event: "up", lines: [`if(${timer}.en==1)`, "{", `  ${timer}.en=0`, ...insideBox(box, up).map((l) => "  " + l), "}"] });
    } else if (touch.action || mirror) {
      const up = [...actionLines(record.objname, touch.action, "tap"), ...mirrorLine];
      lines.push({ event: "up", lines: insideBox(box, up) });
    }

    if (lines.length > 0) record.events = lines;
    return record;
  };

  /** What one action becomes on the glass, and what it leaves in the manifest. */
  function actionLines(objname: string, action: Action | undefined, gesture: "tap" | "hold"): string[] {
    if (action === undefined) return [];
    if (action.kind === "navigate") return [`page ${theme.page(action.screen)}`];
    events.push({
      page: opts.pageName, objname, event: action.event, gesture,
      ...(opts.subject === undefined ? {} : { subject: opts.subject }),
      ...(opts.carry === undefined ? {} : { value: true as const }),
    });
    // A touch that carries a number cannot be one constant `printh`: the number
    // is only known on the glass. Same recipe a slider's report uses.
    if (opts.carry !== undefined) {
      helpers.push("value-frame");
      return [...opts.carry.lines, ...valueFrameLines(opts.pageName, objname, gesture, opts.carry.expr, "vaSend", "vaTmp")];
    }
    return [printhFrame(touchPayload(opts.pageName, objname, gesture))];
  }

  for (const node of nodes) {
    const objname = objectName(node.id, opts.index);
    const box = {
      x: opts.origin.x + node.box.x,
      y: opts.origin.y + node.box.y,
      w: node.box.w,
      h: node.box.h,
    };

    // The Editor refuses a side below 2 (`MIN_SIDE`), so a node thinner than
    // that is not a component -- it is a look the hardware does not have.
    if (node.box.w < MIN_SIDE || node.box.h < MIN_SIDE) {
      dropped.push({
        page: opts.pageName, id: node.id, w: node.box.w, h: node.box.h,
        reason: `a Nextion component is at least ${MIN_SIDE}x${MIN_SIDE}`,
      });
      continue;
    }

    // what this node adds, for its `shownBy` below
    const before = records.length;
    switch (node.kind) {
      case "text": {
        // Only a bound Text gets a capacity: a literal already fits, by the fact
        // that someone wrote it and can see it.
        const maxl = node.value.kind === "binding" && opts.textCapacity
          ? opts.textCapacity(box.w, node.font, node.value.path)
          : undefined;
        records.push({
          type: "Text",
          objname,
          ...box,
          attributes: {
            ...(maxl === undefined ? {} : { txt_maxl: maxl }),
            txt: compiledText(objname, "txt", node.value, maxl, maxl === undefined ? undefined : { width: box.w, font: node.font }),
            font: theme.font(node.font),
            pco: typeof node.color === "string" ? theme.color(node.color) : compiledColor(objname, "pco", node.color),
            bco: bg(node.background),
            // no transparency on a Nextion: every Text paints its own rectangle
            // first, and leaving it off keeps the previous page behind the words
            sta: 1,
            xcen: XCEN[node.align],
            ycen: YCEN[node.valign],
          },
        });
        // A Text that says what a key types joins the CAPS rewrite. The only
        // one today is the letters half of a stacked keypad key.
        if (node.capsValue !== undefined && node.value.kind === "literal") {
          keyboard.caps.push({ objname, lower: node.value.text, upper: node.capsValue });
        }
        break;
      }

      case "icon":
        records.push({
          type: "Text",
          objname,
          ...box,
          attributes: {
            // a role decided at run time is a `glyph` binding: the page starts on
            // the sample role's glyph and the runtime writes the theme's glyph for
            // whatever role the wire names
            txt: theme.glyph(typeof node.role === "string" ? node.role : compiledGlyphRole(objname, node.role)),
            font: theme.font(node.font),
            pco: compiledColor(objname, "pco", node.color),
            bco: bg(node.background),
            sta: 1,
            xcen: 1,
            ycen: 1,
          },
        });
        break;

      case "pattern": {
        const dots = node.dots.map((d, i) => {
          const name = `${PATTERN_DOT}${i + 1}`;
          const at = { x: box.x + d.x, y: box.y + d.y, w: d.w, h: d.h };
          records.push({
            type: "Text",
            objname: name,
            ...at,
            attributes: {
              txt: theme.glyph(node.role),
              font: theme.font(node.font),
              pco: compiledColor(name, "pco", node.color),
              bco: bg(undefined),
              sta: 1,
              xcen: 1,
              ycen: 1,
            },
          });
          return { objname: name, cx: at.x + Math.floor(at.w / 2), cy: at.y + Math.floor(at.h / 2) };
        });
        // the release carries the dots as a number, built on the glass
        if (node.action?.kind === "report") {
          events.push({ page: opts.pageName, objname, event: node.action.event, gesture: "change", value: true });
          helpers.push("value-frame");
        }
        pattern = { objname, dots, radius: node.radius, lit: theme.color(node.lit) };
        break;
      }

      case "fill":
        records.push(
          attach(
            {
              type: "Button",
              objname,
              ...box,
              attributes: {
                txt: "",
                font: theme.font("body"),
                pco: theme.color(node.color),
                bco: theme.color(node.color),
                bco2: theme.color(node.color),
                sta: 1,
                style: BUTTON_FLAT,
              },
            },
            node,
          ),
        );
        break;

      // A face with its words or its glyph on it, and the touch: one Button. The
      // glass draws `bco2` and `pco2` while it is pressed and goes back to what
      // `bco` and `pco` hold then, which the runtime may have written since.
      case "button": {
        const glyph = node.role !== undefined;
        const value = node.value;
        // a capacity for bound words only, as a Text's (a glyph is one character)
        const maxl = !glyph && value?.kind === "binding" && opts.textCapacity
          ? opts.textCapacity(box.w, node.font, value.path)
          : undefined;
        const txt = glyph
          ? theme.glyph(typeof node.role === "string" ? node.role : compiledGlyphRole(objname, node.role!))
          : value === undefined ? ""
            : compiledText(objname, "txt", value, maxl, maxl === undefined ? undefined : { width: box.w, font: node.font });
        records.push(
          attach(
            {
              type: "Button",
              objname,
              ...box,
              attributes: {
                ...(maxl === undefined ? {} : { txt_maxl: maxl }),
                txt,
                font: theme.font(node.font),
                pco: typeof node.color === "string" ? theme.color(node.color) : compiledColor(objname, "pco", node.color),
                pco2: theme.color(node.pressedText),
                bco: typeof node.face === "string" ? theme.color(node.face) : compiledColor(objname, "bco", node.face),
                bco2: theme.color(node.pressed),
                sta: 1,
                style: BUTTON_FLAT,
                xcen: 1,
                ycen: 1,
              },
            },
            node,
          ),
        );
        break;
      }

      case "slider": {
        // `sta` 2 is image mode and 1 is a flat fill. Measured on joBr99's file:
        // all 18 of his sliders are `sta=2` with `pic`/`pic1` set and
        // `picc`/`picc1` left at 65535, so crop mode is available but unused.
        //
        // `pic` is the track from the value to the maximum and `pic1` from the
        // minimum to the value. Pointing BOTH at the same picture is what shows
        // the whole ramp at every position -- the look the React slider draws,
        // and the look Home Assistant's ha-control-slider has -- and it costs one
        // picture where two would cost two. joBr99 does this on his 120x12
        // sliders and not on his 335x44 ones, which is exactly why those cost
        // 3 144 bytes each instead of sharing one.
        const ramp = node.track.kind === "ramp" ? theme.picture({
          kind: "ramp",
          ramp: node.track.ramp,
          width: node.box.w,
          height: node.box.h,
          // the drawn rail, centred in a box that is all touch (paint.ts, lever 1)
          ...(node.track.height !== undefined && node.track.height < node.box.h ? { band: node.track.height } : {}),
          radius: node.radius,
          // the ground the rounded ends blend into, as the panel will show it
          background: rgb565To24(theme.color(opts.background)),
          // the placement's `render.dither` when it says; else on where it makes
          // sense -- a ramp dither helps (never hue) at a width where bands show
          dither: opts.dither ?? defaultDither(node.track.ramp, node.box.w),
        }) : node.track.kind === "groove" ? theme.picture({
          // the whole touch box, page colour but for a thin stripe down the
          // middle: the finger gets 12 mm and the eye gets a scrollbar
          kind: "groove",
          width: node.box.w,
          height: node.box.h,
          stripe: node.track.width,
          color: rgb565To24(theme.color(node.track.color)),
          background: rgb565To24(theme.color(opts.background)),
        }) : undefined;
        const flat = node.track.kind === "solid" ? theme.color(node.track.color) : bg(undefined);
        const max = node.max ?? 100;
        const vertical = node.orientation === "vertical";
        const flipped = vertical && VERTICAL_MIN_AT_BOTTOM;
        // a bound position that the runtime may write has to land the same way
        // round as the compiled one, so a flipped slider's binding says so
        // a list whose length the runtime decides: the count sets `maxval`
        if (node.pages) bindings.push({ page: opts.pageName, objname, attribute: "maxval", path: node.pages, kind: "pages" });
        const startsAt = node.value.kind === "binding"
          ? (() => {
            bindings.push({
              page: opts.pageName, objname, attribute: "val", path: node.value.path,
              ...(flipped ? { kind: "flip" as const, max } : {}),
            });
            return node.value.sample;
          })()
          : node.value.n;
        const slider: NextionRecord = {
          type: "Slider",
          objname,
          ...box,
          attributes: {
            mode: vertical ? 1 : 0,
            sta: ramp === undefined ? 1 : 2,
            // a solid pointer in `pco`. `psta=1` is an image pointer (`pic2`),
            // and with no picture it drew NOTHING in the Editor's debugger, on
            // every slider of every project (measured); it is also why `pco`
            // does not survive a compile with it (SLIDER_POINTER_RGB565)
            psta: 0,
            pic: ramp ?? NO_PICTURE,
            pic1: ramp ?? NO_PICTURE,
            pic2: NO_PICTURE,
            picc: NO_PICTURE,
            picc1: NO_PICTURE,
            bco: flat,
            bco1: flat,
            pco: SLIDER_POINTER_RGB565,
            wid: node.pointerWidth,
            hig: node.pointerHeight,
            val: flipped ? max - startsAt : startsAt,
            minval: 0,
            maxval: max,
          },
        };
        // A slider's report carries its VALUE, so it is not a constant `printh`
        // like a tap: it is joBr99's build-and-send recipe (`valueFrameLines`),
        // run on Touch Release -- and on Touch Move too, when this slider is
        // live: always (`true`), never (`false`), or as the page's global
        // "live slider update" Variable says (`"auto"`, read on the glass, so
        // the setting flips without a round trip). The Move report is gated by a
        // 100 ms Timer per slider, joBr99's `tmCooldown`, because a Nextion fires
        // Touch Move at its scan rate and the serial buffer is 1024 bytes.
        const action = node.action;
        if (action?.kind === "report") {
          // the position in the NODE's terms: a flipped vertical slider turns
          // its own val back before it leaves the glass
          const readout = sliderReadout(objname, node.orientation, max);
          const report = (gesture: ValueGesture) => {
            events.push({
              page: opts.pageName, objname, event: action.event, gesture, value: true,
              ...(opts.subject === undefined ? {} : { subject: opts.subject }),
            });
            return [...readout.lines, ...valueFrameLines(opts.pageName, objname, gesture, readout.expr, "vaSend", "vaTmp")];
          };
          helpers.push("value-frame");
          // A paged list's rail lands on its page as the finger lets go
          // (`SliderNode.land`): writing `val` puts the pointer on its place.
          const land = node.land ? [`${objname}.val=${objname}.val`] : [];
          slider.events = [{ event: "up", lines: [...land, ...report("change")] }];
          // Not while it is dragged: the same line at every move of the finger,
          // meant to keep the pointer on the pages' places, makes the rail worse
          // on the glass.
          const live = node.live ?? "auto";
          const liveLines = live === true ? report("slide") : live === "auto" && opts.liveFlag ? report("slide") : null;
          if (liveLines) {
            const cooldown = `tmSl${objname}`.slice(0, 14);
            records.push({
              type: "Timer",
              objname: cooldown,
              attributes: { tim: SLIDE_COOLDOWN_MS, en: 0 },
              events: [{ event: "timer", lines: [`${cooldown}.en=0`] }],
            });
            const gated = [`if(${cooldown}.en==0)`, "{", ...liveLines.map((l) => "  " + l), `  ${cooldown}.en=1`, "}"];
            slider.events.push({
              event: "slide",
              lines: live === "auto" ? [`if(${opts.liveFlag}.val==1)`, "{", ...gated.map((l) => "  " + l), "}"] : gated,
            });
          }
        } else if (action?.kind === "navigate") {
          slider.events = [{ event: "up", lines: [`page ${theme.page(action.screen)}`] }];
        }
        records.push(slider);
        // The touch under the track (`SliderNode.tail`): a Hotspot whose release
        // moves the pointer to the bottom end and runs the slider's OWN release
        // with `click`, so the report is the slider's, byte for byte, and the
        // other side cannot tell the two apart. None for a slider that reports
        // nothing: a tap there would have nothing to say.
        if (node.tail && node.tail > 0 && node.action) {
          if (!vertical) throw new Error(`${opts.pageName}.${objname}: a tail is touch past the BOTTOM of a vertical track`);
          const tail = { x: box.x, y: box.y + box.h, w: box.w, h: node.tail };
          const tailName = objectName(`${node.id}End`, opts.index);
          records.push({
            type: "Hotspot",
            objname: tailName,
            ...tail,
            // guarded like every tap: only a finger that lets go inside it
            events: [{ event: "up", lines: insideBox(tail, [`${objname}.val=${flipped ? 0 : max}`, `click ${objname},0`]) }],
          });
          // Hidden with the slider on a list of one page: with the slider alone
          // gone, a tap on the empty corner under it would still send the last
          // page, and the runtime would write every row again.
          if (node.pages) bindings.push({ page: opts.pageName, objname: tailName, attribute: "vis", path: node.pages, kind: "paged" });
        }
        break;
      }

      case "toggle": {
        // A dual-state Button keeps its own state and repaints on tap without
        // waiting for the ESP32, which is the point: a switch that needed a
        // round trip to show it moved would feel broken on a panel that may have
        // no network at all.
        //
        // `pic`/`pic2` are the two states as pictures when the theme asks for
        // art; without them a ButtonT is two flat colours, which is everything
        // the attribute set can say about a switch.
        const artFor = (side: "left" | "right") => theme.picture({
          kind: "switch",
          width: node.box.w,
          height: node.box.h,
          radius: node.radius,
          side,
          track: rgb565To24(theme.color(side === "left" ? node.off : node.on)),
          knob: rgb565To24(theme.color(node.knob)),
          background: rgb565To24(theme.color(opts.background)),
        });
        const off = node.art ? artFor("left") : undefined;
        const on = node.art ? artFor("right") : undefined;
        records.push(attach({
          type: "ButtonT",
          objname,
          ...box,
          attributes: {
            txt: "",
            font: theme.font("body"),
            sta: node.art ? 2 : 1,
            style: BUTTON_FLAT,
            bco: theme.color(node.off),
            bco2: theme.color(node.on),
            pco: theme.color(node.knob),
            pco2: theme.color(node.knob),
            pic: off ?? NO_PICTURE,
            pic2: on ?? NO_PICTURE,
            val: compiledNumber(objname, "val", node.value),
          },
        }, node));
        // the switch that mirrors a global Variable writes it in the same touch
        // that reports the change: the sliders' Touch Move handlers read the
        // Variable, so the setting takes effect with no round trip to the ESP32
        if (node.mirror) {
          const rec = records[records.length - 1];
          const up = rec.events?.find((e) => e.event === "up");
          const line = `${node.mirror}.val=${objname}.val`;
          if (up) up.lines.unshift(line);
          else rec.events = [...(rec.events ?? []), { event: "up", lines: [line] }];
        }
        break;
      }

      case "touch": {
        const rec = attach({ type: "Hotspot", objname, ...box }, node, node.mirror);
        records.push(rec);
        if (node.light) lit.push({ touch: rec });
        break;
      }

      // A Nextion Qrcode: the glass encodes the text and draws the symbol. Its
      // text is written as it comes -- no `fit`, which would cut it by width
      // and make it a code for something else -- and `txt` always goes with
      // `txt_maxl`: the template's own text is 24 bytes, and one longer than
      // the capacity is a dialog the Editor refuses.
      case "qrcode":
        records.push({
          type: "Qrcode",
          objname,
          ...box,
          attributes: {
            txt_maxl: node.capacity,
            txt: compiledText(objname, "txt", node.value, node.capacity),
            pco: theme.color(node.dark),
            bco: theme.color(node.light),
          },
        });
        break;

      case "field": {
        // HOW MUCH THE FIELD SHOWS AT ONCE, which is not what the slot holds.
        // The two are different boxes in different fonts, and a Nextion Text
        // neither wraps nor scrolls -- it clips on the right in silence, and
        // the caret is a character at the end, so the caret goes first
        // (measured in the debugger: 26 "m" in a 440 px field draw
        // the same picture as 20). `kbDraw` slides the window instead; this is
        // the number it slides by, off the widest typeable glyph like every
        // other capacity here, less one for the caret's own place.
        const windowOf = opts.windowCapacity ?? opts.textCapacity;
        const window = windowOf
          ? Math.max(1, windowOf(box.w, node.font) - 1)
          : KB_MAX_BYTES;
        keyboard.field = { width: box.w, font: node.font, window };
        // Two components for one string, and the invisible one is the value.
        // `kbShow` is what the eye reads; `kbIn` is what every key appends to
        // and what the OK frame is built from.
        //
        // ONE WRITER. The field carried the same binding as the line, so the
        // runtime wrote both when it opened the keyboard -- and the blink takes
        // the caret off with `txt-=1`, which only means "remove the caret"
        // while the field ends in one. A write from the other side with the
        // page already open would have the blink eat a real character 500 ms
        // later. `open_keyboard` writes before its `page` and the page's load
        // redraws; but that is an ordering, not a guarantee. The line keeps the
        // binding, the field is drawn from it, and nothing else touches the field.
        //
        // It also saves two writes down the wire on every open, and two writes
        // into a page that is not loaded -- which is still an open question.
        records.push({
          type: "Text",
          objname: KB.show,
          ...box,
          attributes: {
            txt: "",
            font: theme.font(node.font),
            pco: theme.color(node.color),
            bco: bg(node.background),
            sta: 1,
            xcen: XCEN[node.align],
            ycen: YCEN.middle,
            // The window plus the caret, and not the whole line: the field
            // never shows more than it slides by, and a Text costs
            // `align4(10 + txt_maxl)` of the page's RAM -- 76 bytes at 65,
            // 28 at 15. A line that slid shows ".." and one character less of
            // the window, which is one byte more; then the caret, and one byte
            // of slack, because a buffer exactly the size of its contents is a
            // buffer with no room for the day the window is computed one larger.
            txt_maxl: window + 3,
          },
        });
        // The three the two keyboards SHARE. When `keyboardGlobals` names
        // another page they are already there, as globals, and this page only
        // reads them -- which is the whole reason the line survives a switch
        // from one keyboard layout to the other.
        if (opts.keyboardGlobals === undefined) {
          keyboard.varis.push(
            // `sta` 1 is a STRING Variable and 0 an integer one. Getting it wrong
            // is not a warning: the Editor refuses the whole project with
            // "Invalid Variables:kbIn.txt", because every line that appends to it
            // is addressing a field the component does not have.
            { type: "Vari", objname: KB.in, attributes: { sta: 1, txt: compiledText(KB.in, "txt", node.value), txt_maxl: KB_MAX_BYTES, val: 0 } },
            // The capacity of whatever is being edited, which only the runtime
            // knows: one keyboard page serves every editable slot on the panel and
            // each Text has its own txt_maxl.
            { type: "Vari", objname: KB.max, attributes: { sta: 0, val: compiledNumber(KB.max, "val", node.max) } },
            { type: "Vari", objname: KB.caps, attributes: { sta: 0, val: 0 } },
          );
        }
        break;
      }

      case "key": {
        // The name that REPORTS is the Hotspot's, because the Hotspot is what
        // fires: a payload naming the Button would be a frame blaming a
        // component that never saw the finger. Computed first, because the
        // commit key writes it into the frame it builds.
        const touchName = `m${node.id}${opts.index}`.slice(0, 14);
        // The DRAWING. Its code goes on a Hotspot pushed after every node
        // (`keyboard.touches`), because the topmost component takes the press --
        // measured in the debugger -- and a theme
        // that draws the digit over the letters would otherwise kill the key.
        const record: NextionRecord = {
          type: "Button",
          objname,
          ...box,
          attributes: {
            // A key captioned with an ICON draws the icon font's glyph for that
            // role; everything else draws its own letters in the theme's body
            // cut. Same resolution an `icon` node gets, and for the same reason:
            // no codepoint is ever written down here.
            txt: node.capIcon === undefined ? node.cap : theme.glyph(node.capIcon),
            font: theme.font(node.capIcon === undefined ? node.font : "icon"),
            pco: theme.color(node.textColor),
            bco: theme.color(node.color),
            bco2: theme.color(node.activeColor ?? node.color),
            sta: 1,
            style: BUTTON_FLAT,
          },
        };
        // Where the finger counts: the key's whole cell when the layout gives
        // one (`KeyNode.touch`), so the gap between two faces types the nearer
        // key instead of nothing; the face otherwise.
        const touchBox = node.touch
          ? { x: opts.origin.x + node.touch.x, y: opts.origin.y + node.touch.y, w: node.touch.w, h: node.touch.h }
          : box;
        // A key is guarded like any other target: the finger has to let go
        // inside it. Dragging across the keyboard types nothing, which matters
        // more here than anywhere -- forty-four boxes side by side is where a
        // sloppy release would otherwise land on the wrong letter.
        const guard = (lines: string[]) => insideBox(touchBox, lines);
        // Any key with a CAPS caption joins the rewrite, whatever its role: the
        // keypad's cycle keys are the ones that DO change what they type with
        // CAPS, and pressing CAPS there must move what they show.
        if (node.capsCap !== undefined) keyboard.caps.push({ objname, lower: node.cap, upper: node.capsCap });
        switch (node.role) {
          case "char":
            // `+=` the key's OWN caption, so CAPS is a caption rewrite and not a
            // second alphabet to keep in step. Straight from the vendor's page.
            record.events = [{ event: "up", lines: guard(appendLines(`${objname}.txt`)) }];
            break;
          case "space":
            record.events = [{ event: "up", lines: guard(appendLines('" "')) }];
            break;
          case "backspace":
            record.events = [{
              event: "up",
              lines: guard([
                // `-=1` on an empty string is not a measured behaviour, and this
                // page has never run on a panel: guard rather than find out in
                // someone's hallway. The test costs one instruction.
                `btlen ${kb(KB.in)}.txt,sys0`,
                "if(sys0>0)", "{",
                `  ${kb(KB.in)}.txt-=1`, "}",
                // Deleting CLOSES the multi-tap window, and it has to. Without
                // this, `2` then backspace then `2` inside the second lands in
                // the cycling branch: it takes a character off a line that just
                // lost one and writes "b" where the finger asked for "a". The
                // simulator has always done this (one `tap = null`); the glass
                // did not, which is the two of them disagreeing about what a
                // key means -- the one thing this whole generator exists to
                // prevent.
                ...(hasCycle ? [`${KB.key}.val=0`, `${KB.tap}.en=0`] : []),
                redraw,
              ]),
            }];
            break;
          case "caps":
            record.events = [{
              event: "up",
              lines: guard([
                `if(${kb(KB.caps)}.val==0)`, "{", `  ${kb(KB.caps)}.val=1`, "}else", "{", `  ${kb(KB.caps)}.val=0`, "}",
                // one Hotspot holds the rewrite for all of them, clicked from
                // here: forty lines written once instead of once per key
                ...(rewritesCaps ? [`click ${KB.ref},0`] : []),
              ]),
            }];
            break;
          case "commit": {
            const action = node.action;
            if (action?.kind === "report") {
              events.push({
                page: opts.pageName, objname: touchName, event: action.event, gesture: "text", text: true,
                ...(opts.subject === undefined ? {} : { subject: opts.subject }),
              });
              helpers.push("value-frame");
              // An empty line never leaves the glass. Blank-but-not-empty is the
              // runtime's to refuse, because trimming on the glass would be a
              // loop and on the other side it is one function with a test.
              record.events = [{
                event: "up",
                lines: guard([
                  `btlen ${kb(KB.in)}.txt,sys0`,
                  "if(sys0>0)", "{",
                  ...textFrameLines(opts.pageName, touchName, kb(KB.in), "vaSend", "vaTmp").map((l) => "  " + l),
                  "}",
                ]),
              }];
            } else if (action) {
              record.events = [{ event: "up", lines: guard(actionLines(touchName, action, "tap")) }];
            }
            break;
          }
          case "cancel":
            if (node.action) record.events = [{ event: "up", lines: guard(actionLines(touchName, node.action, "tap")) }];
            break;

          // The other keyboard. A `page` jump the glass takes by itself, which
          // is what keeps changing layout free -- and the line is not on either
          // page, so there is nothing to carry across (`keyboardGlobals`).
          case "layout":
            if (node.action) record.events = [{ event: "up", lines: guard(actionLines(touchName, node.action, "tap")) }];
            break;

          // Multi-tap: press once for the first character, again inside the
          // window for the second, round and round. The window is one Timer for
          // the whole page, re-armed by every press and disarmed when it fires.
          //
          // Two branches, and the difference between them is the bug this shape
          // exists to avoid. CYCLING replaces: it removes the character it put
          // there and puts the next one, so the line does not grow and the
          // capacity test cannot fail. STARTING is an append, and it is guarded
          // -- because a line already at capacity must not remember the key
          // either, or the next press on it would take the window as open and
          // eat a character the finger never typed.
          case "cycle": {
            const cycle = node.cycle ?? [];
            const caps = node.cycleCaps ?? cycle;
            keyboard.multitap = true;
            const id = ++cycleKeys;
            const put = (i: number): string[] => (cycle[i] === caps[i]
              ? [`${kb(KB.in)}.txt+="${nextionLiteral(cycle[i])}"`]
              : [
                `if(${kb(KB.caps)}.val==1)`, "{",
                `  ${kb(KB.in)}.txt+="${nextionLiteral(caps[i])}"`, "}else", "{",
                `  ${kb(KB.in)}.txt+="${nextionLiteral(cycle[i])}"`, "}",
              ]);
            const arm = [`${KB.tap}.en=0`, `${KB.tap}.en=1`];
            // The window is armed BEFORE the redraw: `kbDraw` leaves the caret off
            // while it is open, for the character at the end can still change,
            // and the window's end draws it.
            const start = [
              `if(sys0<${kb(KB.max)}.val)`, "{",
              `  ${KB.step}.val=0`,
              `  ${KB.key}.val=${id}`,
              ...put(0).map((l) => "  " + l),
              ...arm.map((l) => "  " + l),
              `  ${redraw}`,
              "}",
            ];
            const step = [
              `${kb(KB.in)}.txt-=1`,
              `${KB.step}.val=${KB.step}.val+1`,
              `if(${KB.step}.val>${cycle.length - 1})`, "{", `  ${KB.step}.val=0`, "}",
              ...cycle.flatMap((_, i) => [`if(${KB.step}.val==${i})`, "{", ...put(i).map((l) => "  " + l), "}"]),
              ...arm,
              redraw,
            ];
            record.events = [{
              event: "up",
              lines: guard([
                `btlen ${kb(KB.in)}.txt,sys0`,
                `if(${KB.key}.val==${id})`, "{",
                `  if(${KB.tap}.en==1)`, "  {",
                ...step.map((l) => "    " + l),
                "  }else", "  {",
                ...start.map((l) => "    " + l),
                "  }",
                "}else", "{",
                ...start.map((l) => "  " + l),
                "}",
              ]),
            }];
            break;
          }
        }
        // The events leave the Button and become a Hotspot of the same box,
        // emitted last. `objname` is the Hotspot's, so the frame names the
        // component that really sent it.
        const touch = record.events;
        delete record.events;
        if (touch) {
          const hotspot: NextionRecord = { type: "Hotspot", objname: touchName, ...touchBox, events: touch };
          keyboard.touches.push(hotspot);
          // the key lights under the finger: its face, and what a stacked
          // keypad draws over it
          lit.push({ touch: hotspot, face: box });
        }
        records.push(record);
        break;
      }
    }
    // A node that is there only while a value holds something (`shownBy`):
    // every component it became answers that value's `vis`. A Timer or a
    // Variable is not on the screen and has none.
    if (node.shownBy?.kind === "binding") {
      for (const r of records.slice(before)) {
        if (r.x === undefined || r.type === "Timer" || r.type === "Vari") continue;
        bindings.push({ page: opts.pageName, objname: r.objname, attribute: "vis", path: node.shownBy.path, kind: "present" });
      }
    }
  }

  // Every key's touch target, on top of everything any theme drew.
  records.push(...keyboard.touches);

  // The page-level half of the keyboard, which only exists once every key has
  // been seen: the rewrite block names them all. Any page with the editing
  // field has it: the symbols have no CAPS captions and no multi-tap, and the
  // field alone needs the caret, its blink and `kbDraw`.
  if (keyboard.field !== undefined || keyboard.caps.length > 0 || keyboard.varis.length > 0 || keyboard.multitap) {
    records.push(...keyboard.varis);
    if (keyboard.multitap) {
      records.push(
        // Page-local, both of them: which key is mid-cycle is this keyboard's
        // business and means nothing on the other one.
        { type: "Vari", objname: KB.key, attributes: { sta: 0, val: 0 } },
        { type: "Vari", objname: KB.step, attributes: { sta: 0, val: 0 } },
        {
          type: "Timer", objname: KB.tap, attributes: { tim: MULTITAP_MS, en: 0 },
          // Disarms itself, which is what makes a repeating Nextion Timer behave
          // as a one-shot: `en == 1` IS the window, so closing it is the whole
          // job. The same trick as the sliders' report cooldown. And the
          // character at the end is final then: the redraw puts the caret after
          // it, and the blink starts.
          events: [{ event: "timer", lines: [`${KB.tap}.en=0`, redraw] }],
        },
      );
    }
    // The caret: a Hotspot nobody touches, a Timer, and a flag. Every key clicks
    // the Hotspot instead of writing the Text, so what the line looks like is
    // decided in ONE place -- and the Timer is what makes it blink when the
    // finger is still.
    const slide = keyboard.field?.window ?? KB_MAX_BYTES;
    /** the blink's lines, on a keypad only while no character is open */
    const caretOnly = (lines: string[]): string[] =>
      keyboard.multitap ? [`if(${KB.tap}.en==0)`, "{", ...lines.map((l) => "  " + l), "}"] : lines;
    records.push(
      { type: "Vari", objname: KB.on, attributes: { sta: 0, val: 1 } },
      // Where `kbDraw` cuts the tail of a long line to, before it joins the
      // dots: `substr` writes a whole string, and the glass has no way to put
      // one in front of another but to append it. One byte of slack.
      { type: "Vari", objname: KB.tail, attributes: { sta: 1, txt: "", txt_maxl: slide, val: 0 } },
      {
        type: "Timer", objname: KB.blink, attributes: { tim: BLINK_MS, en: 1 },
        // The blink does not re-read the line: `kbDraw` leaves the window
        // ending in a caret, and blinking is adding that one character or
        // taking it off. Cheaper, and it cannot disagree with the window about
        // which part of the line is showing.
        // On a keypad, not while a character can still change: the caret is
        // off then, and the blink leaves it so.
        events: [{
          event: "timer",
          lines: caretOnly([
            `if(${KB.on}.val==0)`, "{",
            `  ${KB.on}.val=1`,
            `  ${KB.show}.txt+="${CARET}"`,
            "}else", "{",
            `  ${KB.on}.val=0`,
            `  ${KB.show}.txt-=1`,
            "}",
          ]),
        }],
      },
      {
        type: "Hotspot", objname: KB.draw,
        // Beside `kbRef` and not on top of it: two Hotspots in the same two
        // pixels would be one more overlapping pair for the Editor to warn
        // about, for nothing -- `click` addresses them by name either way.
        x: opts.origin.x + 2, y: opts.origin.y, w: 2, h: 2,
        events: [{
          event: "up",
          lines: [
            `${KB.on}.val=1`,
            // THE WINDOW. A line longer than the field shows its TAIL: the text
            // slides left as it grows, so the caret and the character just
            // typed are always the ones on screen. Without this the glass
            // simply clips on the right and says nothing -- 26 "m" in a
            // 440 px field draw the same picture as 20 (measured in the
            // debugger), and since the caret is a character at the end of the
            // line it is the first thing to disappear: the finger types on with
            // the screen frozen.
            //
            // `window` counts CHARACTERS and the field is in pixels, so it is
            // derived from the widest typeable glyph -- the same conservative
            // measure `txt_maxl` uses. Any `window` characters fit, whatever
            // they are, with the caret's place already taken out.
            //
            // `substr` takes a literal start, so the offset is computed into
            // `sys0` first (`substr t1.txt,t1.txt,0,1` is the measured form).
            //
            // AND THE CUT SAYS SO. A line that slid starts with
            // "..", the mark every other cut on this panel carries: without it
            // the tail of "Living room lamp" read as a name of its own. The dots
            // take the place of one character of the window, and two of them
            // are narrower than the widest glyph the window is counted in.
            // The glass cannot put one string in front of another, only append:
            // the tail goes to `kbTail` first, and the field is the dots and
            // then the tail.
            `btlen ${kb(KB.in)}.txt,sys0`,
            `if(sys0>${slide})`, "{",
            `  sys0=sys0-${slide - 1}`,
            `  substr ${kb(KB.in)}.txt,${KB.tail}.txt,sys0,${slide - 1}`,
            `  ${KB.show}.txt="${FIELD_CUT}"`,
            `  ${KB.show}.txt+=${KB.tail}.txt`,
            "}else", "{",
            `  ${KB.show}.txt=${kb(KB.in)}.txt`,
            "}",
            // the caret, but not after a character the keypad's window can still change
            ...(keyboard.multitap
              ? [`if(${KB.tap}.en==0)`, "{", `  ${KB.show}.txt+="${CARET}"`, "}else", "{", `  ${KB.on}.val=0`, "}"]
              : [`${KB.show}.txt+="${CARET}"`]),
            `${KB.blink}.en=0`,
            `${KB.blink}.en=1`,
          ],
        }],
      },
    );
    // A keyboard whose CAPS key changes what the keys TYPE and nothing they
    // SHOW is a mode with no sign. There is no refusal here for it, and the reason is worth
    // writing down: a box too small for its letter keys drops them (see
    // `dropped`) and keeps the CAPS key, so the rule would fire on a keyboard
    // that is degenerate for other reasons -- a guard with false positives on
    // legitimate input costs more than it catches. The behaviour is pinned
    // instead where it can be pressed: scenarios A6, A7, A20, B19 and B20 in
    // `export/scripts/lib/keyboardScenarios.mjs`, on both panels, in CI.
    if (keyboard.caps.length > 0) {
    records.push({
      type: "Hotspot",
      objname: KB.ref,
      // Two pixels in the corner. It is never touched by a finger -- `click
      // kbRef,0` from the CAPS key is what runs it -- but a Hotspot is the only
      // component that carries code without drawing, and the Editor refuses a
      // side below 2.
      x: opts.origin.x, y: opts.origin.y, w: 2, h: 2,
      events: [{
        event: "up",
        lines: [
          `if(${kb(KB.caps)}.val==1)`, "{",
          ...keyboard.caps.map((k) => `  ${k.objname}.txt="${nextionLiteral(k.upper)}"`),
          "}else", "{",
          ...keyboard.caps.map((k) => `  ${k.objname}.txt="${nextionLiteral(k.lower)}"`),
          "}",
        ],
      }],
    });
    }
  }

  // What the finger lights while it is down:
  // a list's row, all its texts, and a key, its face and what is
  // drawn on it, in the theme's `pressed`; and back to what each was compiled
  // with as the finger leaves, wherever it lets go -- the release goes to the
  // component the press went to, so a drag that started on a row keeps it lit
  // until then. Painted by the glass, before the touch's own code and outside
  // its guard; no word to the ESP32. A component the runtime writes the `bco`
  // of would be left in its compiled one: none of these is one.
  if (lit.length > 0) {
    const pressed = theme.color("pressed");
    const solid = records.filter((r) => (r.type === "Text" || r.type === "Button") && r.attributes?.sta === 1 && typeof r.attributes.bco === "number");
    const within = (r: NextionRecord, b: { x: number; y: number; w: number; h: number }) =>
      (r.x ?? 0) >= b.x && (r.y ?? 0) >= b.y && (r.x ?? 0) + (r.w ?? 0) <= b.x + b.w && (r.y ?? 0) + (r.h ?? 0) <= b.y + b.h;
    for (const { touch, face } of lit) {
      const faces = face ? solid.filter((r) => within(r, face)) : solid.filter((r) => r.type === "Text");
      if (faces.length === 0) continue;
      const events = touch.events ?? [];
      const merge = (event: string, lines: string[]) => {
        const at = events.find((e) => e.event === event);
        if (at) at.lines = [...lines, ...at.lines];
        else events.push({ event, lines });
      };
      merge("down", faces.map((r) => `${r.objname}.bco=${pressed}`));
      merge("up", faces.map((r) => `${r.objname}.bco=${r.attributes!.bco}`));
      touch.events = events;
    }
  }

  const tagged = opts.themeTag ? bindings.map((b) => ({ ...b, theme: opts.themeTag })) : bindings;
  return { records, bindings: tagged, events, dropped, helpers: [...new Set(helpers)], keyboardField: keyboard.field, ...(pattern ? { pattern } : {}) };
}
