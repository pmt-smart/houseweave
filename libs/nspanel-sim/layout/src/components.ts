// The component ids, and the props a LAYOUT takes.
//
// Two prop shapes exist for a reason and it is not duplication. `ui/contracts.ts`
// keeps the REACT props -- `text: string`, `onToggle: (id) => void` -- because
// that is what a React caller can hand over, and callbacks are not a thing a
// `.tft` has. Here the same component is described in what a COMPILER can carry:
// text becomes a `Value` (so a binding can survive all the way to the manifest
// instead of being flattened into a string), and behaviour becomes an `Action`.
//
// The React wrapper converts: a string becomes a literal, a handler becomes the
// action the theme declares. That conversion is three lines per component and it
// is the only place the two vocabularies meet.
import type { Action, Align, ColorRef, NumberValue, Value } from "./node.js";
import type { RampId } from "./paint.js";

/**
 * Every component id a theme can implement.
 *
 * Lives here rather than in `ui/` because both renderers key off it and `layout/`
 * is the package neither of them owns. `ui/src/contracts.ts` re-exports it, so
 * nothing that already imported it from there had to move.
 *
 * No `screen`: the device frame is not a component a placement can name.
 */
export const COMPONENT_IDS = [
  "label", "clock", "weather-row", "status-icon",
  "nav-header", "page-rail", "list-row", "zone-counter", "light-card", "toggle-switch", "gradient-slider",
  "keyboard", "pattern-pad", "qr-code",
] as const;
export type ComponentId = (typeof COMPONENT_IDS)[number];

/**
 * A QWERTY keyboard, the whole screen.
 *
 * The letters are typed ON THE GLASS and nothing leaves the panel until the
 * finger hits OK -- which is not a shortcut, it is what the vendor's own
 * keyboard does. Nextion ships one per resolution with the Editor
 * (`keyboarden/480320/1.page`, page "keybdA"), and reading it is where the four
 * instructions this component is built out of came from: `txt+=` to append,
 * `txt-=1` to delete the last character, `btlen` to measure, and a Hotspot
 * clicked from code (`click kbRef,0`) to rewrite every cap at once when CAPS
 * flips.
 *
 * Only what `value` finally becomes reaches Berry, as one frame, whose text is
 * its last field: a comma in it stays in it (`PanelRuntime.on_payload`). The
 * signs are on a keyboard of their own, the symbols (`keyboardSymbolKeys`),
 * with every printable ASCII sign but the double quote, which a Nextion string
 * cannot carry, and the backtick, which the theme fonts cannot draw.
 */
export interface KeyboardLayout {
  /**
   * What is being edited. A binding, always: the runtime fills it with the
   * current text when it opens the page, and the glass takes it from there.
   */
  value: Value;
  /**
   * How many bytes the thing being edited can hold -- the `txt_maxl` of its
   * Text, which is fixed in the `.tft` and truncates in silence when exceeded.
   * Bound, because the keyboard is one page serving every
   * editable slot on the panel, and each has its own capacity.
   */
  max: NumberValue;
  /** OK. Carries the typed text, so the frame is built on the glass. */
  commit?: Action;
  /** The X. Reports rather than navigating: which screen to go back to is the runtime's. */
  cancel?: Action;
  /**
   * The keys that go to the other keyboards: the QWERTY, the T9 keypad and the
   * symbols. Each keyboard draws a key for the ones it leads to
   * -- `123` and `#+=` on the QWERTY, `ABC` on the keypad, `ABC` and `123` on
   * the symbols -- and a page is given the ways its project binds.
   *
   * NAVIGATIONS and not reports: the other keyboard is a page of this same
   * project, known when the page is built, so the glass jumps by itself. The
   * line survives because it is not on any of the pages (`emit.ts`,
   * keyboardGlobals).
   */
  toLetters?: Action;
  toKeypad?: Action;
  toSymbols?: Action;
}

export interface LabelLayout {
  text: Value;
  /** what the words are FOR, which is what a theme styles: `accent` and `warn` are the safeboot's bar and its warning */
  tone?: "title" | "body" | "muted" | "accent" | "warn";
  align?: Align;
}

export interface GradientSliderLayout {
  /** 0..100 */
  pct: NumberValue;
  /**
   * Which ramp, by name -- and a LITERAL, never a binding.
   *
   * A gradient is baked into the `.tft` as a picture, so it cannot arrive at run
   * time the way a title can; a binding resolved to a CSS string would work only
   * where the browser is the only consumer.
   */
  ramp: RampId;
  /** the track's height inside the box; the rest is the touch area around it */
  trackHeight?: number;
  /**
   * What a new value reports. It carries the value, so on the glass it is not a
   * constant frame but joBr99's build-and-send recipe (`wire.ts`) -- on Touch
   * Release always, and on Touch Move too when `live` says so.
   */
  change?: Action;
  /**
   * Report while dragging (`true`), only on release (`false`), or as the panel's
   * own "live slider update" setting says (`"auto"`, the default). A project
   * pins it per placement (`input.live`, schema 7): a brightness rail wants to
   * feel immediate, a colour-temperature rail may not.
   */
  live?: "auto" | boolean;
}

/**
 * What a clock is GIVEN. Not what a clock looks like.
 *
 * The component id fixes the data and the obligations, never the drawing -- so
 * these are the facts a clock may draw from, and a theme uses the ones its own
 * model needs and ignores the rest. The three in this repository already
 * disagree about the model: one puts a rule under the time, one puts the date
 * ABOVE it as a muted label, one puts the date in a filled chip. A fourth that
 * wanted an analogue face, or a seconds ring, or no date at all, is a different
 * `clock` layout and nothing else -- it returns whatever nodes it wants,
 * including a generated picture (`paint.ts`), and no code outside its own file
 * assumes a shape.
 *
 * Optional fields are OFFERED, not required. Adding one here costs nothing to
 * the themes that do not draw it; a theme that needs a fact nobody offers yet
 * asks for it to be added, and the projects that bind it get it.
 */
export interface ClockLayout {
  /** already formatted by whoever supplies it: the panel does no strftime */
  time: Value;
  date: Value;
  /** offered for a model that wants it; the three here do not draw it yet */
  weekday?: Value;
}

/**
 * One cell of a forecast row. The temperature arrives FORMATTED: the panel does
 * no arithmetic and no units, and whoever fills the binding decides whether that
 * is "18.1°C", "18°" or "--".
 */
export interface WeatherCell {
  label: Value;
  temp: Value;
}

/**
 * What a weather row is given.
 *
 * A fixed-length list, because a Nextion page is geometry frozen at compile
 * time: there is no attribute that takes an array and no way to grow a row at
 * run time. The project binds one array (`"items": "$weather"`) and the compile
 * step expands it into indexed bindings, one per cell -- `$weather.0.temp` and
 * so on -- which is what the generated Berry addresses.
 *
 * How many cells is the THEME's, not the contract's: `brain.be` sends five
 * (`weatherUpdate~item1~..~item5`), and a theme that wanted three would draw
 * three and leave the rest unbound.
 */
export interface WeatherRowLayout {
  items: WeatherCell[];
}

/**
 * What a status icon is given.
 *
 * The colour is a ColorRef and not a token because the panel SENDS it:
 * `statusUpdate~icon1~color1~icon2~color2`. `side` is which of the two fixed
 * slots this is, which decides what the compiled page binds to -- where it sits
 * on the screen is the placement's business and not the component's.
 */
export interface StatusIconLayout {
  /**
   * Which drawing, by role. Compile time, because the glyph is baked into the
   * component's `txt`.
   *
   * The panel's own `statusUpdate` sends an icon NAME as well as a colour, and
   * `txt` is writable, so one day this can be a binding too -- it needs somebody
   * to decide how an icon name crosses the wire, and inventing that here would
   * be inventing protocol. Until then a screen picks its role and the colour is
   * what moves.
   */
  role?: string | Value;
  /** the colour the panel sends: `statusUpdate~icon1~color1~icon2~color2` */
  color?: ColorRef;
  /** which of the two fixed slots this is; it decides what the page binds to */
  side?: "left" | "right";
}

export interface NavHeaderLayout {
  title: Value;
  /**
   * A tap on the TITLE leaves this screen, going back to wherever the finger
   * came from. There is no X: the title row is the way back -- a target as wide
   * as the header, where an X would be 64 px in one corner and cost the title
   * that much room.
   *
   * The detail screen is opened by a long press on a card of SOME group screen,
   * and with more than one group screen the way back is not a
   * fixed page -- so this reports an event and the runtime decides, instead of
   * compiling a `page <name>` that would always return to the same one.
   */
  close?: Action;
  /**
   * Left and right arrows. undefined means there is no card that way --
   * home.be:NO_NAV.
   *
   * The decided navigation between group screens is a SWIPE carousel, and these
   * are its accessible fallback: they stay in the contract because
   * the swipe depends on a hardware measurement nobody has taken yet, and a
   * panel that cannot be navigated is worse than one with arrows on it.
   */
  prev?: Action;
  next?: Action;
  /**
   * A long press on the TITLE, which is how a screen gets renamed.
   *
   * A hold and not a tap, because the title is not a button: it has to keep
   * looking like a heading and behaving like one for anyone who touches it by
   * accident. The 500 ms the panel already times for a light card is the same
   * gesture here (`wire.ts:HOLD_MS`), so nothing new had to be measured.
   */
  editTitle?: Action;
  /**
   * The view's own action, at the far right of the header: the
   * + that draws a dashed card on a plan, the check that confirms one. Absent
   * means the header has no action slot at all.
   */
  action?: Action;
  /**
   * Which icon the action shows, by ROLE -- a binding, because the runtime
   * decides: `add`, `confirm`, or a role the theme has not got, which draws
   * nothing. The page starts on `add`.
   */
  actionIcon?: string | Value;
  /**
   * The action's colour, a binding the runtime writes a theme colour into: the
   * schedule's clock on a thermostat's page is lit in the accent while its
   * schedule is on, and unlit while it is off. Absent, the
   * theme's text colour, as the + and the check have.
   */
  actionIconColor?: ColorRef;
  /**
   * A long press on the action, timed by the panel as the title's is: the
   * schedule's clock opens the device's schedule. Absent, the
   * action has the tap only.
   */
  actionHold?: Action;
  /**
   * The view's options, the ⋯: left of the action, or at the
   * far right when there is none. Its icon is always the theme's `more`.
   */
  more?: Action;
  /**
   * A sign the header carries left of the action, by ROLE, there only while it
   * names one: the Home's hotspot, while the panel is open to a phone.
   * A binding, because the runtime decides; given, it takes a rail's
   * width from the title whether it shows or not -- the glass cannot move a
   * Text at run time. Not a control: nothing happens when it is touched.
   */
  statusIcon?: string | Value;
}

/**
 * The scrollbar of a paged list: which page of it is showing, and the way to
 * another one.
 *
 * A list screen is ONE Nextion page whatever its length (the list
 * template): its rows are slots the runtime fills, and turning a page is the
 * runtime writing the next rows into the same slots. Nothing about the length
 * is in the `.tft` but `pageCount`, so adding a setting is a change on the
 * other side of the wire and never a new page to flash.
 *
 * On the glass it is ONE vertical Slider with `maxval = pageCount - 1`. A
 * slider's `val` is an integer, so the pointer jumps from page to page by
 * itself -- the paging costs no code at all. The pointer is as tall as one
 * page's share of the track, the way a scrollbar's thumb says how much of the
 * list fits on screen.
 *
 * `page` is 0-based, where the pointer starts: the glass resets a page's
 * components each time it loads, so a list always opens at its first page and
 * the runtime renders that one when the page says it is showing.
 *
 * No `close`: leaving the screen is a tap on `nav-header`'s title, as on every
 * other screen. The rail keeps the right-hand column.
 */
export interface PageRailLayout {
  /** where the pointer is, 0-based */
  page: NumberValue;
  /** how many pages the list has; one or none draws nothing at all */
  pageCount: NumberValue;
  /** the finger let go on another page: reports it, 0-based */
  change?: Action;
}

/**
 * One row of a list: an icon, a name that lights up, a grey hint
 * at the right, and a discreet tail with a touch of its own. Settings is a list
 * whose rows have only the name, lit when the setting is on; the zone's screen
 * is a list whose rows have all four, the tail being the device's position.
 *
 * `on`/`off` is a colour change (an accent when lit, muted when not), which is
 * free: a Nextion Text already pays for a colour, and a second component just to
 * hold a knob would be a second thing to place, bind and keep in step with the
 * first for a fact the text itself can say.
 *
 * The row and the tail are two targets that touch and never overlap. The tap is
 * the same on both; the long press is the row's secondary action on the row,
 * and the tail's own on the tail.
 */
export interface ListRowLayout {
  /** the icon at the left, by role; absent gives the label the room, "" draws a blank */
  icon?: string | Value;
  /** the icon's colour, when it is not the theme's plain icon colour */
  iconColor?: ColorRef;
  label: Value;
  /**
   * 0 or 1; which colour the label draws in. A BINDING compiles to a
   * `switch` colour on the label's `pco` -- the theme's lit and unlit colours
   * both go in the manifest and the runtime picks one -- so the glass follows
   * the row instead of keeping the colour it was compiled with.
   */
  on: NumberValue;
  /** the grey text at the right: "on network", "80%", "3 free" */
  hint?: Value;
  /** the hint's colour, when it says something by it (a signal's dBm); the theme's quiet colour otherwise */
  hintColor?: ColorRef;
  /** the discreet text at the far right, with its own touch box: "l1c2 +3"; in the `stacked` variant, at the right of the name, with no touch of its own */
  tail?: Value;
  /** the tail's colour, as the hint's */
  tailColor?: ColorRef;
  /** the short tap, on the row and on the tail */
  change?: Action;
  /** the long press on the row: its secondary action (Help, the detail, the options) */
  hold?: Action;
  /** the long press on the tail: the tail's own (editing a position) */
  tailHold?: Action;
  /** the `device` variant's icon, a touch of its own: the short tap (switching the device) */
  iconTap?: Action;
  /** the `device` variant's icon: the long press (the device's detail) */
  iconHold?: Action;
  /**
   * A `page.objname` on the glass whose `val` follows this row in the same
   * touch that reports the change. Set by the compile step; the React column
   * ignores it. The same mechanism `toggle-switch` carries as
   * `ToggleSwitchLayout.mirror`.
   */
  mirror?: string;
}

/**
 * One counter of a zone's top card: how many devices of a
 * kind, and the kind's icon. A tap toggles only that kind; a long press opens
 * its joint mode. The runtime writes "" into a counter the zone has no kind for.
 */
export interface ZoneCounterLayout {
  count: Value;
  icon: string | Value;
  iconColor?: ColorRef;
  tap?: Action;
  hold?: Action;
}

/**
 * The 3 x 3 pattern that guards Settings. The glass follows the
 * finger and lights the dots itself; the runtime only hears the release, and
 * answers by painting every dot wrong or by leaving the page.
 */
export interface PatternPadLayout {
  /** 0 or 1: every dot in the wrong colour. Bound, it compiles to a `switch` on each dot's `pco` */
  wrong: NumberValue;
  /** the release: reports the dots the finger went through, as one number */
  drawn?: Action;
}

/**
 * A QR code: the text a phone's camera reads -- a `WIFI:`
 * string, so the phone joins the panel's own network. The glass encodes it and
 * draws the symbol by itself; the page is only told the text.
 */
export interface QrCodeLayout {
  /** the text the code carries: a binding, which the runtime writes */
  code: Value;
  /** the most bytes the runtime may write into it, the Qrcode's `txt_maxl`; `QR_CAPACITY` unless said */
  capacity?: number;
}

/**
 * What a light card is given.
 *
 * `tap` and `hold` are both here because both are the PANEL's obligation: the
 * short tap toggles and the long press opens the detail screen, and
 * a theme that drew only one would ship a card whose detail is unreachable on
 * the glass. Not a look, and not the theme's to vary.
 *
 * The panel tells them apart BY ITSELF, with a Timer (`wire.ts`), so a long
 * press works with nothing on the other end of the serial line.
 */
export interface LightCardLayout {
  name: Value;
  /** the drawing for the light's state, by role: the theme decides which; a `Value` when the state arrives at run time */
  icon: string | Value;
  iconColor: ColorRef;
  tap?: Action;
  hold?: Action;
}

export interface ToggleSwitchLayout {
  /** 0 or 1 */
  on: NumberValue;
  change?: Action;
  /**
   * A `page.objname` on the glass whose `val` follows this switch in the same
   * touch that reports the change -- the "live slider update" switch mirrors
   * into the Variable the sliders' Touch Move handlers read, with no ESP32 in
   * the path. Set by the compile step; the React column ignores it.
   */
  mirror?: string;
}

/**
 * Which props of each component can carry a BINDING, and of which sort.
 *
 * The compile step needs this and the React side does not, which is why it is a
 * declaration and not a type: a project writes `"text": "$screen.title"` in its
 * `bind` block, and something has to know that `text` is a place a binding may
 * live while `tone` and `align` are not. Getting it wrong is not subtle -- an
 * unlisted binding is compiled as its own expression and the panel displays the
 * literal characters `$screen.title`.
 *
 * Text and number are separate lists because they compile into different
 * attributes: `txt` takes a string of a declared width, `val` takes a number.
 */
export interface BoundProps {
  text?: readonly string[];
  number?: readonly string[];
  /** props whose binding fills a `pco`, which Berry can write at run time */
  color?: readonly string[];
  /**
   * Props that are an icon ROLE which may arrive at run time. The wire carries
   * the role's name and the generated runtime turns it into the theme's glyph
   * (`txt`), so a bound icon costs what a bound text costs and no codepoint is
   * ever agreed on between the two sides.
   */
  glyph?: readonly string[];
  /**
   * Props that are a LIST.
   *
   * A Nextion attribute takes one value, so an array binding cannot survive as
   * one: the project writes `"items": "$weather"` and the compile step expands
   * it into `$weather.0.label`, `$weather.0.temp`, `$weather.1.label` and so on,
   * one binding per field per cell. The length is fixed at compile time because
   * the page is -- there is no way to grow a row on the glass.
   */
  list?: Record<string, { length: number; fields: readonly string[] }>;
}

export const BOUND_PROPS: Partial<Record<ComponentId, BoundProps>> = {
  label: { text: ["text"] },
  clock: { text: ["time", "date", "weekday"] },
  "weather-row": { list: { items: { length: 5, fields: ["label", "temp"] } } },
  "status-icon": { color: ["color"], glyph: ["role"] },
  "nav-header": { text: ["title"], glyph: ["actionIcon", "statusIcon"], color: ["actionIconColor"] },
  "page-rail": { number: ["page", "pageCount"] },
  "list-row": { text: ["label", "hint", "tail"], number: ["on"], glyph: ["icon"], color: ["iconColor", "hintColor", "tailColor"] },
  "zone-counter": { text: ["count"], glyph: ["icon"], color: ["iconColor"] },
  "light-card": { text: ["name"], color: ["iconColor"], glyph: ["icon"] },
  "toggle-switch": { number: ["on"] },
  "gradient-slider": { number: ["pct"] },
  keyboard: { text: ["value"], number: ["max"] },
  "pattern-pad": { number: ["wrong"] },
  "qr-code": { text: ["code"] },
};
