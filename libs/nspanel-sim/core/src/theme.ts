// A theme, as data.
//
// A theme is a document, not code, so a project can use several and the
// simulator can offer them in a dropdown, and adding one is adding a file.
//
// What a theme carries, and why each part is here rather than in the
// project:
//
//   tokens      colour and spacing. Colour keeps the distinction that matters
//               most about this palette: a value that is EXACT on the panel
//               (an RGB565 number the firmware already sends) versus one that
//               was eyeballed from a screenshot and is safe to refine.
//   fonts       not decoration. Every text on the panel points at a compiled
//               font, and the panel's icons ARE glyphs, so a
//               theme that does not declare its fonts cannot be drawn.
//   components  what may be used, with the restrictions this theme
//               imposes ON TOP of what the Editor allows. Being stricter than
//               the Editor is the whole point of the funnel.
import { FONT_ROLES, MIN_SIDE, type FontRole } from "@nspanel-sim/layout";
import { IssueList, ValidationError } from "./issues.js";
import {
  ID_PATTERN, optionalBoolean, optionalString, requireArray, requireInt, requireNumber, requireObject,
  requireSchemaVersion, requireString, requireStringArray, uniqueBy,
} from "./schema.js";

// 2: `style`, `icons` and `components[].requires` became required, and `screen`
// stopped being a placeable component. A version 1 document is not a lesser
// version of this one -- it has none of those -- so it is refused as too old
// rather than failing field by field with messages that do not say why.
//
// 3: every colour and every font says what it is FOR, as a list of short tags,
// and a font's prose moved to `notes`. The Themes tab is a catalogue where each
// element appears exactly once -- a colour is not listed twice because two
// things paint with it -- so "where may this be used" has to be a property of
// the element. Inventing those tags in the tool would make them the tool's
// opinion; declared here, they are the theme's.
//
// 4: the typeface is declared ONCE. `style.fontFamily` is gone; a `typeface`
// block names the family the theme WANTS and each font says its `weight`
// outright. Before this the face was declared twice and independently -- a CSS
// stack here, a `.zi` cut from whatever source there -- and the weight was not
// declared at all but guessed from a filename, which got `tailwind-slate`'s
// 80-pixel clock wrong: the file is called `clock-80.zi`, the regex saw no
// "bold", and the `.zi` inside is NotoSans-Bold. What the `.zi` actually carries
// is now READ from the file by the build and written to
// `fonts/typeface.generated.json`, the same way an icon's glyph and vector are
// generated together from one declared name.
//
// 5: every font declares the ROLE it fills, out of a closed set, and the five
// roles have to be covered exactly once. The three themes here ship different
// font IDS for the same job -- `text-32`, `title-32` and `title-48` are all "the
// title cut" -- and the compile step was naming ids directly, with
// `FONT_ORDER = ["text-24", "text-32", "clock-80", ...]` written into it. That
// worked for exactly one theme: compiling a `shadcn-dark` project threw
// `declares no font "text-32"` at it. A layout asks for a role and the theme
// answers with its own file, which is also what keeps the type scale a property
// of the theme -- Tailwind's title really is 48 pixels where the other two are
// 32, and that difference now survives the trip to the glass.
//
// 6: a component declares the STYLES it offers, as `variants`. A theme is
// allowed more than one drawing of the same element -- a full-width rail on a
// detail screen and a thin one inside a card row are both `gradient-slider`,
// with the same props, the same events and the same hardware obligations. Before
// this the registry had one slot per (theme, component), so the only way to
// offer a second style was to invent a second component id, which would have
// been a lie about the contract. `default` is what a placement gets when it
// names none, so every component has it.
//
// 7: the document carries `drawing` -- the rules of drawing for the glass, verbatim, at the
// top of every theme. They were already pasted at the head of every
// `layout/src/themes/<id>.ts`, which covers the person writing the LAYOUT and
// misses the person writing the THEME: a theme is a document anyone can add to
// the platform without opening a `.ts` file at all, and that person was the one
// the rules were written for. The parser refuses a theme without them, so
// "pasted by default" is true of the next theme and not only of today's three.
export const THEME_SCHEMA_VERSION = 7;

/**
 * What every theme document carries at its top, word for word.
 *
 * The short form of the rules of drawing for the glass, where each
 * line is a measurement and not a preference -- the panel has no alpha, no
 * tracking, no native radius, and 3 584 bytes of RAM a page. Copied into the
 * document rather than linked from it because a link is not read when someone
 * is writing colours at two in the morning, and because a theme travels: it can
 * be handed to another repository, or to a model, with nothing else attached.
 *
 * `parseTheme` compares line by line. Changing a rule here means re-pasting it
 * in every theme, which is the cost of the guarantee and is paid by a refusal
 * that prints the expected text.
 */
export const DRAWING_RULES: readonly string[] = [
  "READ docs/09-drawing-for-the-glass.md before drawing for this theme. The short form, each line measured:",
  "colour    RGB565: 32 levels of R/B, 64 of G; no alpha, shadow, blur or gradient attribute",
  "text      five font roles, fixed sizes; no tracking, leading or synthetic weight",
  "shape     a rectangle with sides >= 2 px; a border IS a component; radius only inside a picture",
  "pictures  the codec pays per run: flat rows and vertical change are cheap, dither is 4x, hue is rich",
  "touch     7-12 mm = 46-78 px of target; the box may be bigger than the drawing",
  "budget    3 584 B of RAM a page; a Text costs 10 + txt_maxl, a Slider 28, an icon glyph nothing",
];

/** How much a colour can be trusted. */
export type ColorProvenance =
  /** an RGB565 number the panel already displays; changing it means changing firmware */
  | "exact"
  /** taken by eye from a screenshot; no known real value */
  | "approximate"
  /**
   * chosen by this project, for something the source system does not have --
   * the plan's card fill in joBr99's theme, whose cards have none
   */
  | "ours";

export interface ColorToken {
  id: string;
  /** RGB565, 0..65535 — the panel's own colour depth, not 24-bit */
  rgb565: number;
  provenance: ColorProvenance;
  /** where the value came from: a Berry file, a screenshot, a scenario */
  origin: string;
  /** what it paints, as short tags: "screen ground", "card fill", "button label" */
  use: string[];
}

export interface FontToken {
  id: string;
  /** the `.zi` this font is, relative to the theme directory */
  file: string;
  /** glyph height in pixels, as the `.zi` header carries it */
  height: number;
  /** the `.zi` code page: `utf-8` is 0x18 and `iso-8859-1` is 0x03 */
  encoding: FontEncoding;
  /**
   * The weight this size is cut at, 100..900.
   *
   * Declared and not guessed: read off the source's filename, `tailwind-slate`'s
   * clock would be drawn Regular in the React column and Bold on the panel (the
   * file is `clock-80.zi` and the `.zi` inside is NotoSans-Bold). The build checks
   * this number against the face name in the `.zi` itself, so the two cannot
   * drift.
   */
  weight: number;
  /**
   * Which of the five slots a layout can ask for this font fills.
   *
   * A layout names a ROLE and never a font id, because a Nextion Text draws the
   * font it names at that font's own height and there is no scale: asking for
   * "the title cut" is the only request the hardware can actually honour, and
   * which file answers it is the theme's to decide. The roles are covered
   * exactly once each, so a role never resolves to two files and never to none.
   */
  role: FontRole;
  /** what this size is for, as short tags: "title", "button label", "clock" */
  use: string[];
  /** the reasoning, when there is any worth writing down */
  notes: string;
  /**
   * Where the `.zi` is generated from, when it is. A theme's fonts are
   * subsets of the fonts a reference project already runs on the panel — the
   * full ones carry thousands of glyphs — so the file on disk is built by
   * `export/scripts/build-theme-fonts.mjs` out of these two fields, and
   * the script is also what checks it is still up to date.
   */
  source?: { fixture: string; entry: string };
  /**
   * Which characters the subset keeps: `ranges` as `"U+0020..U+007E"`, and
   * `icons` as Material Design Icons NAMES, never codepoints — on this panel an
   * icon is a glyph, and the name is resolved through the same mapping the
   * joBr99 backend uses.
   */
  include?: { ranges?: string[]; icons?: string[]; iconRoles?: boolean };
}

/**
 * The colour tokens every theme has to name, because the renderers
 * paint with exactly these (`ui/src/palette.tsx`). A document missing one is
 * refused here rather than drawn with a colour borrowed from another design
 * system -- which is the restrictive side of the funnel doing its job: the
 * Editor would happily compile a page in whatever colours it was given.
 */
export const REQUIRED_COLOR_TOKENS = [
  "background", "card-background", "card-border",
  "text-primary", "text-secondary", "divider",
  "accent-blue", "accent-red", "icon-off", "icon-low-sat",
  // a signal's value, by its dBm: green, yellow and red
  "signal-good", "signal-fair", "signal-poor",
  // the plan's card and its icons' appearances, each theme's own
  // and none borrowed: PLAN_ICON_TOKENS below
  "plan-card", "plan-icon-on", "plan-icon-off", "plan-icon-no-answer", "plan-icon-no-power", "plan-icon-pending",
  // a thermostat that is heating now: its icon in the plan, and in a zone's rows and counters
  "plan-icon-heating", "icon-heating",
  // a blind all the way up: green, its icon in the plan, and in a zone's rows and counters
  "plan-icon-open", "icon-open",
  // a key or a list's row under the finger, which the glass paints itself
  "pressed",
] as const;

/**
 * The plan's icon appearances: a lamp lit with no colour of its
 * own, unlit, with no communication, with no power, a command on its way, a
 * thermostat that is heating, and a blind all the way up.
 * Each one stands at least PLAN_ICON_CONTRAST to 1 over the theme's plan card,
 * which the theme is refused without.
 */
export const PLAN_ICON_TOKENS = ["plan-icon-on", "plan-icon-off", "plan-icon-no-answer", "plan-icon-no-power", "plan-icon-pending", "plan-icon-heating", "plan-icon-open"] as const;

/** WCAG's contrast for graphics, and the glass's floor for an icon */
export const PLAN_ICON_CONTRAST = 3;

/** WCAG's contrast ratio of two RGB565 colours, as the panel shows them */
export function contrastRatio(a: number, b: number): number {
  const luminance = (v: number) => {
    const r5 = (v >> 11) & 31, g6 = (v >> 5) & 63, b5 = v & 31;
    const [r, g, bl] = [(r5 << 3) | (r5 >> 2), (g6 << 2) | (g6 >> 4), (b5 << 3) | (b5 >> 2)].map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The icon roles every theme has to fill. Roles and not icon names,
 * because what a screen needs is "the one that means the light is on", and which
 * drawing means that is precisely what a theme decides -- a filled bulb
 * in one, a stroked outline in another. The list mirrors
 * `ui/src/components/muiLovelacePreset.ts`, which had the same vocabulary long
 * before a theme could supply the glyphs.
 */
export const REQUIRED_ICON_ROLES = [
  // No `closePopup`: a screen is left by a tap on its title, and a header draws
  // no X. No `pageUp`/`pageDown`: the list's rail is a scrollbar, with no
  // arrows. A role nothing draws
  // would still cost every theme a glyph in two icon fonts.
  "navPrev", "navNext",
  "lightOn", "lightOff",
  "colorMode", "brightness", "colorTemp", "power",
  // The keyboard's backspace. An icon and not the word "DEL" because the arrow
  // is what everyone recognises, and it cannot be a letter: the theme text
  // fonts are 191-glyph subsets of ASCII and Latin-1, and U+232B is not in
  // there.
  "backspace",
  // The plan: a lamp the panel has no communication with,
  // the lamp with "?", one without power -- a dashed outline, which a theme
  // names as "<icon>:dashed" and the font builder draws from the plain one --
  // and the header's + and check.
  "lightNoAnswer", "lightNoPower",
  "add", "confirm",
  // The zone's screen and the lists: the header's ⋯,
  // the pairing's search again, the pattern's nine dots, and a device of each
  // kind that is not a light, lit and unlit, for the zone's counters and rows.
  "more", "refresh", "dotOff", "dotOn",
  "plugOn", "plugOff", "switchOn", "switchOff", "fanOn", "fanOff", "coverOn", "coverOff",
  "sensor", "remote",
  // and their "no answer" and "no power", as the lamp's:
  // a glyph of their own and not the unlit one
  "plugNoAnswer", "plugNoPower", "switchNoAnswer", "switchNoPower",
  "fanNoAnswer", "fanNoPower", "coverNoAnswer", "coverNoPower",
  // the thermostat: one glyph, the heating coil, in the four appearances;
  // lit, unlit and heating differ in colour alone, and the last two are drawn from the first
  "thermostatOn", "thermostatOff", "thermostatNoAnswer", "thermostatNoPower",
  // the schedule's clock, the action of a thermostat's page: lit while its schedule is on
  "schedule",
  // and its page's two buttons: the + is `add`, and the - is this
  "minus",
  // a blind that is a window or a gate, which a switch of two channels opens and closes, in the four appearances
  "windowOn", "windowOff", "windowNoAnswer", "windowNoPower", "gateOn", "gateOff", "gateNoAnswer", "gateNoPower",
  // a blind's page: its switch's three keys, up, stop and down
  "coverUp", "coverStop", "coverDown",
  // the row under a page's title: Identify, an exclamation and not a lamp, and Settings, beside the
  // schedule's own
  "identify", "settings",
  // The Home's sign that the panel is open to a phone: the web
  // setup up today, and the Hotspot from the plan's step 7.
  "hotspot",
  // The keyboard's way out without a change, an X that is no letter: with CAPS
  // on, the "x" key said "X" too, beside it.
  // Its way out with one is `confirm`, the header's check.
  "cancel",
  // the two signs of the screensaver's corner: the alarm's events not seen, and the house's notifications not
  // seen. Each is compiled in beside the clock, blank until the runtime gives it a colour
  "alarmSignal", "noticeSignal",
  // the house's screen: its icons, beside Settings, the schedule's and the two signs above, are the Wireless
  // settings and the mesh, a graph of nodes
  "wifi", "mesh",
] as const;

/**
 * The colours a plan is drawn in, as theme tokens: the
 * simulator and the compile step both resolve them here, so the browser and
 * the glass paint the same numbers. All of them are required tokens: the card
 * and each icon appearance are the theme's own, and no theme
 * draws with another's.
 */
export const PLAN_COLOR_TOKENS = {
  page: "background",
  card: "plan-card",
  label: "text-primary",
  iconOff: "plan-icon-off",
  iconOn: "plan-icon-on",
  noAnswer: "plan-icon-no-answer",
  noPower: "plan-icon-no-power",
  pending: "plan-icon-pending",
  ghost: "text-secondary",
  // a thermostat that is heating now: warm, over the plain lit one
  heating: "plan-icon-heating",
  // a blind all the way up: green; one that moves is the pending tone, the theme's accent
  open: "plan-icon-open",
  // the second of two numbers on a summed-up card: the thermostat's floor, after the room's in the label's colour
  secondary: "text-secondary",
} as const;

export type PlanColors = Record<keyof typeof PLAN_COLOR_TOKENS, number>;

type IconRole = (typeof REQUIRED_ICON_ROLES)[number];

/**
 * The icon roles a plan draws each kind of device with: on,
 * off, no answer and no power. Every kind that acts has an icon of its own for
 * the last two; a sensor, a remote and a generic device show
 * one icon. The simulator and the compile step both read this, so a kind looks
 * the same in the browser and on the glass.
 */
export const PLAN_GLYPH_ROLES = {
  light: ["lightOn", "lightOff", "lightNoAnswer", "lightNoPower"],
  plug: ["plugOn", "plugOff", "plugNoAnswer", "plugNoPower"],
  switch: ["switchOn", "switchOff", "switchNoAnswer", "switchNoPower"],
  fan: ["fanOn", "fanOff", "fanNoAnswer", "fanNoPower"],
  cover: ["coverOn", "coverOff", "coverNoAnswer", "coverNoPower"],
  // a blind that is a window or a gate: how it looks, by what it opens and closes
  window: ["windowOn", "windowOff", "windowNoAnswer", "windowNoPower"],
  gate: ["gateOn", "gateOff", "gateNoAnswer", "gateNoPower"],
  thermostat: ["thermostatOn", "thermostatOff", "thermostatNoAnswer", "thermostatNoPower"],
  sensor: ["sensor", "sensor", "sensor", "sensor"],
  remote: ["remote", "remote", "remote", "remote"],
  generic: ["power", "power", "power", "power"],
} as const satisfies Record<string, readonly IconRole[]>;

/** The corner radius of a plan's cards, in panel pixels. */
export const PLAN_CARD_RADIUS = 6;

/**
 * The hues a zone's card may take after the theme's own card colour:
 * blue, teal, amber and purple, as RGB565. The same in every theme; the
 * page each one is mixed with is the theme's.
 */
export const PLAN_ZONE_HUES = [15220, 11343, 50245, 31444] as const;

/** A theme's zone palette: its card colour, then the hues. */
export const planPalette = (theme: Theme): number[] => [planColors(theme).card, ...PLAN_ZONE_HUES];

/** A theme's plan colours, as RGB565: every token is one parseTheme required. */
export function planColors(theme: Theme): PlanColors {
  const out = {} as PlanColors;
  for (const [role, token] of Object.entries(PLAN_COLOR_TOKENS) as [keyof PlanColors, string][]) {
    const named = theme.colors.find((c) => c.id === token);
    if (named === undefined) throw new Error(`${theme.id}: names no ${token}, which the plan's ${role} is`);
    out[role] = named.rgb565;
  }
  return out;
}

/**
 * The typeface, declared once.
 *
 * `family` is what the theme ASKS for -- shadcn wants Inter, Tailwind wants the
 * OS UI face -- and it is what the React column draws with. What the panel will
 * actually draw is whatever face the `.zi` was cut from, and the only source we
 * have is the Noto Sans of the joBr99 project. Those two are allowed to differ:
 * it is a real constraint of the hardware, not a mistake.
 *
 * What is NOT allowed is for the difference to be invisible. The face inside
 * each `.zi` is read from the file by `export/scripts/build-theme-fonts.mjs` and
 * written to `fonts/typeface.generated.json`, so the simulator can say "asked
 * for Inter, carries NotoSans-Regular" instead of leaving a reader to assume
 * they are the same. One declaration, both renderings derived from it -- the
 * shape the icons already had.
 */
export interface Typeface {
  /** the family the theme asks for, e.g. "Inter" */
  family: string;
  /** what the browser should fall back to, in order */
  fallback: string[];
}

/** `typeface` as a CSS stack: the family quoted, then the fallbacks. */
export function cssFontStack(t: Typeface): string {
  const quote = (n: string) => (/^[A-Za-z][A-Za-z0-9-]*$/.test(n) ? n : `"${n}"`);
  return [quote(t.family), ...t.fallback].join(", ");
}

/** How a theme draws, as opposed to what it draws in. */
export interface PanelStyleTokens {
  /** corner radius in panel pixels */
  radius: number;
  /** border thickness in panel pixels; 0 draws none */
  borderWidth: number;
  /** how a card presents itself: nothing at all, a border, or a filled surface */
  cardStyle: "plain" | "outlined" | "filled";
  /** how much room things get */
  density: "compact" | "comfortable";
  /** weight of the biggest type (the clock, the main temperature) */
  displayWeight: number;
  /** weight of titles and labels */
  titleWeight: number;
  /** an icon's size as a fraction of the box it sits in */
  iconScale: number;
  /**
   * The CSS font stack the React column draws with. DERIVED, not declared: it is
   * `typeface.family` followed by `typeface.fallback`, built at parse time so
   * every renderer keeps the one field it already used.
   */
  fontFamily: string;
}

export const CARD_STYLES = ["plain", "outlined", "filled"] as const;
export const DENSITIES = ["compact", "comfortable"] as const;

/** Which fonts hold the icons, and which drawing fills each role. */
export interface IconSet {
  /**
   * The fonts the icons live in, by id — more than one, at different heights.
   *
   * Icon size is a FONT CHOICE, not a scale. A Nextion Text names a font id and
   * draws its glyphs at that font's height; there is no scale attribute, and no
   * amount of CSS on our side changes that. Asking a 32-pixel font for a 73-pixel
   * icon is not something the panel can do, and drawing it blown up in the
   * simulator would show a picture of something that cannot happen.
   *
   * So a theme declares the sizes it has — joBr99 ships icons at 32, 48
   * and 80 — and a component picks the largest that fits the box it was given.
   */
  fonts: string[];
  /** role -> Material Design Icons name; the codepoint is the same at every size */
  roles: Record<string, string>;
}

/** The encodings a `.zi` code page can name. */
export const FONT_ENCODINGS = ["utf-8", "iso-8859-1"] as const;
export type FontEncoding = (typeof FONT_ENCODINGS)[number];

/** A component the theme offers, and the limits it puts on its use. */
export interface ComponentSpec {
  id: string;
  /** the React component that draws it */
  render: string;
  /** the Nextion primitives it compiles into, in draw order */
  primitives: string[];
  /** smallest touch target, in millimetres; omitted when the component is not touchable */
  minTouchMm?: { w: number; h: number };
  /**
   * The styles this theme draws this component in. Always contains `default`.
   *
   * More than one is the theme saying "I have a second way of drawing this", not
   * a second component: the contract, the props and the events belong to the
   * component id and do not vary. A placement names one with `"variant"`.
   *
   * Declared here and not only in the code so the Themes tab can LIST what a
   * theme offers, and so a project naming a style that does not exist is refused
   * by the funnel instead of compiling into something nobody asked for.
   */
  variants: string[];
  /** true once the component has been seen working on the real panel */
  hardwareValidated: boolean;
  /**
   * The props a placement HAS to bind.
   *
   * Without this the contract in `ui/src/contracts.ts` would be enforced
   * nowhere: a placement would hand whatever it liked, the registry casts to
   * `any`, and a `light-card` with no `onToggle` would render a card that
   * silently does nothing when tapped. TypeScript cannot catch it (the component is resolved at
   * runtime) so the funnel must.
   */
  requires: string[];
  notes: string;
}

export interface Theme {
  schemaVersion: number;
  id: string;
  name: string;
  description: string;
  /** DRAWING_RULES, verbatim — see the note on that constant */
  drawing: readonly string[];
  colors: ColorToken[];
  fonts: FontToken[];
  /** the face the theme asks for; what the `.zi` carries is read from the files */
  typeface: Typeface;
  /** how this theme draws: radius, borders, weights, density */
  style: PanelStyleTokens;
  /** the icon drawing for each role the screens need */
  icons: IconSet;
  components: ComponentSpec[];
  /** restrictions that apply to every component of this theme */
  rules: {
    /** touch targets below this are refused even though the Editor allows them */
    minTouchMm: { w: number; h: number };
    /** only these Nextion primitives may appear in a compiled page */
    allowedPrimitives: string[];
  };
}

const PRIMITIVES = [
  "Text", "Number", "XFloat", "Button", "ButtonT", "CheckBox", "Radio", "Slider", "Prog",
  "Picture", "PictureCrop", "Hotspot", "Touchcap", "Timer", "Vari", "Qrcode", "Curve", "GText", "Zhizhen",
];

/** The panel's colour depth: 5 bits red, 6 green, 5 blue. */
export const RGB565_MAX = 0xffff;

/**
 * The optional `source`/`include` pair. Either both or neither: a `source` with
 * nothing to include would write an empty font, and an `include` with no source
 * says which characters to keep without saying what to keep them from.
 */
function parseFontBuild(at: IssueList, o: Record<string, unknown>): Pick<FontToken, "source" | "include"> {
  const hasSource = o.source !== undefined;
  const hasInclude = o.include !== undefined;
  if (!hasSource && !hasInclude) return {};
  if (hasSource !== hasInclude) {
    at.add({
      path: hasSource ? "include" : "source", rule: "font-build-incomplete",
      message: "a generated font needs both `source` and `include`", source: "ours",
    });
    return {};
  }
  const src = requireObject(at.at("source"), o.source, "");
  const inc = requireObject(at.at("include"), o.include, "");
  const ranges = (inc.ranges === undefined ? [] : requireArray(at.at("include"), inc, "ranges")).map(String);
  const icons = (inc.icons === undefined ? [] : requireArray(at.at("include"), inc, "icons")).map(String);
  for (const [i, r] of ranges.entries())
    if (!/^U\+[0-9A-Fa-f]{4,6}(\.\.U\+[0-9A-Fa-f]{4,6})?$/.test(r))
      at.at("include/ranges").add({
        path: String(i), rule: "bad-codepoint-range",
        message: 'want "U+0020" or "U+0020..U+007E"', source: "ours", got: r,
      });
  if (ranges.length === 0 && icons.length === 0 && inc.iconRoles !== true)
    at.at("include").add({ path: "", rule: "font-include-empty", message: "selects no characters at all", source: "ours" });
  return {
    source: { fixture: requireString(at.at("source"), src, "fixture"), entry: requireString(at.at("source"), src, "entry") },
    include: { ranges, icons, iconRoles: inc.iconRoles === true },
  };
}

/**
 * The styles a component is offered in.
 *
 * `default` is required and has to be first: it is what a placement that names
 * no variant gets, and a theme whose `default` were a special case would make
 * every unannotated placement a surprise.
 */
function parseVariants(at: IssueList, o: Record<string, unknown>): string[] {
  const variants = (o.variants === undefined ? ["default"] : requireArray(at, o, "variants", { min: 1 })).map(String);
  if (!variants.includes("default"))
    at.add({
      path: "variants", rule: "variant-default-missing", source: "ours",
      message: 'every component needs a "default" style: it is what a placement that names none gets',
      got: variants.join(", "),
    });
  const seen = new Set<string>();
  for (const [i, v] of variants.entries()) {
    if (!ID_PATTERN.test(v))
      at.add({ path: `variants/${i}`, rule: "bad-variant-name", source: "ours", message: "not a usable id", got: v });
    if (seen.has(v))
      at.add({ path: `variants/${i}`, rule: "duplicate-variant", source: "ours", message: "listed twice", got: v });
    seen.add(v);
  }
  return variants;
}

/**
 * A border is either absent or drawable, and nothing in between.
 *
 * On this hardware a border is a COMPONENT -- the border colour with the page
 * colour inset on top of it -- and the Editor refuses a component with a side
 * below 2 (`MIN_SIDE`). So `borderWidth: 1` is a CSS hairline, not
 * a panel border: it compiles to nothing and the theme silently loses its
 * outlines.
 *
 * Found by compiling `shadcn-dark` for the first time, whose weather separators
 * came out 1x90 and whose header rule came out 420x1. The generator had been
 * producing them happily for a while; nothing looked at them until the Editor
 * did, which is the whole argument for the funnel being stricter than it.
 */
function parseBorderWidth(at: IssueList, style: Record<string, unknown>): number {
  const value = requireInt(at, style, "borderWidth", { min: 0, max: 8 });
  if (value > 0 && value < MIN_SIDE)
    at.add({
      path: "borderWidth", rule: "border-too-thin", source: "editor",
      measuredIn: "Error: width and height must be >= 2 (m21/m22)",
      message: "a border is a component on this panel, and a component thinner than 2 px does not compile",
      got: String(value), want: `0, or ${MIN_SIDE} and up`,
    });
  return value;
}

export function parseTheme(raw: unknown, where = "theme"): Theme {
  const issues = new IssueList();
  const doc = requireObject(issues, raw);
  const schemaVersion = requireSchemaVersion(issues, doc, THEME_SCHEMA_VERSION);
  const id = requireString(issues, doc, "id", { pattern: ID_PATTERN });
  const name = requireString(issues, doc, "name", { maxLength: 60 });

  // The rules of drawing for the glass, carried by the document itself. Compared line by line
  // and not merely required to exist: a `drawing` that drifted is worse than
  // none, because it reads as current. The refusal prints what to paste.
  const drawingRaw = Array.isArray(doc.drawing) ? doc.drawing.map((l) => String(l)) : undefined;
  if (drawingRaw === undefined || drawingRaw.length !== DRAWING_RULES.length || DRAWING_RULES.some((l, i) => drawingRaw[i] !== l)) {
    issues.add({
      path: "drawing",
      rule: drawingRaw === undefined ? "missing-drawing-rules" : "stale-drawing-rules",
      source: "ours",
      message:
        "every theme carries the drawing rules of docs/09-drawing-for-the-glass.md at its top, word for word — paste the `want` lines as the `drawing` array",
      want: DRAWING_RULES.join(" | "),
      got: drawingRaw === undefined ? "absent" : drawingRaw.join(" | "),
    });
  }

  const colors: ColorToken[] = requireArray(issues, doc, "colors").map((entry, index) => {
    const at = issues.at(`colors/${index}`);
    const o = requireObject(at, entry);
    return {
      id: requireString(at, o, "id", { pattern: ID_PATTERN }),
      rgb565: requireInt(at, o, "rgb565", {
        min: 0, max: RGB565_MAX, source: "hardware",
        measuredIn: "the panel is RGB565; 65536 is refused",
      }),
      provenance: requireString(at, o, "provenance", { oneOf: ["exact", "approximate", "ours"] }) as ColorProvenance,
      origin: requireString(at, o, "origin"),
      use: requireStringArray(at, o, "use", { min: 1, maxLength: 40 }),
    };
  });
  uniqueBy(issues.at("colors"), colors, (c) => c.id, "colour id");
  {
    const named = new Set(colors.map((c) => c.id));
    const missing = REQUIRED_COLOR_TOKENS.filter((t) => !named.has(t));
    if (missing.length > 0)
      issues.at("colors").add({
        path: "", rule: "missing-colour-token", source: "ours",
        message: "every theme has to name the colours the renderers paint with",
        want: REQUIRED_COLOR_TOKENS.join(", "), got: missing.join(", ") + " not named",
      });
    // the plan's icons over the plan's card: an unlit lamp that the eye has to
    // look for is a plan that lies about the room
    const card = colors.find((c) => c.id === "plan-card");
    for (const token of PLAN_ICON_TOKENS) {
      const icon = colors.find((c) => c.id === token);
      if (card === undefined || icon === undefined) continue;
      const ratio = contrastRatio(icon.rgb565, card.rgb565);
      if (ratio < PLAN_ICON_CONTRAST)
        issues.at("colors").add({
          path: token, rule: "plan-icon-contrast", source: "ours",
          message: "a plan's icon stands at least 3:1 over the theme's plan card",
          want: `${PLAN_ICON_CONTRAST}:1 or more`, got: `${ratio.toFixed(2)}:1 over plan-card`,
        });
    }
  }

  const fonts: FontToken[] = requireArray(issues, doc, "fonts").map((entry, index) => {
    const at = issues.at(`fonts/${index}`);
    const o = requireObject(at, entry);
    return {
      id: requireString(at, o, "id", { pattern: ID_PATTERN }),
      file: requireString(at, o, "file"),
      // the .zi header keeps the height in one byte
      height: requireInt(at, o, "height", { min: 1, max: 255, source: "hardware", measuredIn: "the .zi header, one byte" }),
      // not free text: the byte at +0x04 of a .zi takes 0x03 or 0x18 and
      // nothing else has been seen, and getting it wrong puts two glyphs on the
      // glass where one was meant
      encoding: requireString(at, o, "encoding", { oneOf: [...FONT_ENCODINGS] }) as FontEncoding,
      weight: requireInt(at, o, "weight", { min: 100, max: 900 }),
      role: requireString(at, o, "role", { oneOf: [...FONT_ROLES] }) as FontRole,
      use: requireStringArray(at, o, "use", { min: 1, maxLength: 40 }),
      notes: optionalString(o, "notes"),
      ...parseFontBuild(at, o),
    };
  });
  uniqueBy(issues.at("fonts"), fonts, (f) => f.id, "font id");
  // Exactly once each, in both directions. A role filled twice is a layout whose
  // font depends on which entry the compile step happened to find first; a role
  // filled by nobody is a page the Editor refuses, and it should be said here
  // rather than discovered in the Sandbox twenty minutes later.
  uniqueBy(issues.at("fonts"), fonts, (f) => f.role, "font role");
  for (const role of FONT_ROLES)
    if (!fonts.some((f) => f.role === role))
      issues.at("fonts").add({
        path: "", rule: "font-role-unfilled", source: "ours",
        message: `no font fills the "${role}" role, and a layout may ask for it`,
      });

  const typefaceRaw = requireObject(issues.at("typeface"), doc.typeface, "");
  const typeface: Typeface = {
    family: requireString(issues.at("typeface"), typefaceRaw, "family", { maxLength: 60 }),
    fallback: requireStringArray(issues.at("typeface"), typefaceRaw, "fallback", { min: 1, maxLength: 40 }),
  };

  const styleRaw = requireObject(issues.at("style"), doc.style, "");
  const style: PanelStyleTokens = {
    // a panel pixel is a panel pixel: a 40-pixel radius on a 480x320 screen is
    // not a design choice, it is a mistake, so the range is narrow on purpose
    radius: requireInt(issues.at("style"), styleRaw, "radius", { min: 0, max: 40 }),
    borderWidth: parseBorderWidth(issues.at("style"), styleRaw),
    cardStyle: requireString(issues.at("style"), styleRaw, "cardStyle", { oneOf: CARD_STYLES }) as PanelStyleTokens["cardStyle"],
    density: requireString(issues.at("style"), styleRaw, "density", { oneOf: DENSITIES }) as PanelStyleTokens["density"],
    // the .zi carries no weight axis, so these apply to the React column and to
    // anything the panel draws as a picture -- text on the glass is whatever
    // weight the font was generated at
    displayWeight: requireInt(issues.at("style"), styleRaw, "displayWeight", { min: 100, max: 900 }),
    titleWeight: requireInt(issues.at("style"), styleRaw, "titleWeight", { min: 100, max: 900 }),
    iconScale: requireNumber(issues.at("style"), styleRaw, "iconScale", { min: 0.2, max: 1 }),
    fontFamily: cssFontStack(typeface),
  };

  const iconsRaw = requireObject(issues.at("icons"), doc.icons, "");
  const iconRolesRaw = requireObject(issues.at("icons/roles"), iconsRaw.roles, "");
  const icons: IconSet = {
    fonts: requireArray(issues.at("icons"), iconsRaw, "fonts", { min: 1 }).map(String),
    roles: Object.fromEntries(Object.entries(iconRolesRaw).map(([k, v]) => [k, String(v)])),
  };
  {
    const missing = REQUIRED_ICON_ROLES.filter((r) => typeof icons.roles[r] !== "string" || icons.roles[r].length === 0);
    if (missing.length > 0)
      issues.at("icons/roles").add({
        path: "", rule: "missing-icon-role", source: "ours",
        message: "every theme has to say which drawing fills each role the screens need",
        want: REQUIRED_ICON_ROLES.join(", "), got: missing.join(", ") + " not named",
      });
    const unknown = Object.keys(icons.roles).filter((r) => !(REQUIRED_ICON_ROLES as readonly string[]).includes(r));
    if (unknown.length > 0)
      issues.at("icons/roles").add({
        path: "", rule: "unknown-icon-role", source: "ours",
        message: "no screen asks for this role, so the glyph would be carried to the panel and never drawn",
        want: REQUIRED_ICON_ROLES.join(", "), got: unknown.join(", "),
      });
    for (const [i, id] of icons.fonts.entries())
      if (!fonts.some((f) => f.id === id))
        issues.at("icons/fonts").add({
          path: String(i), rule: "unknown-font", source: "ours",
          message: "the icons have to live in a font this theme declares",
          want: fonts.map((f) => f.id).join(", "), got: id,
        });
  }

  const rulesRaw = requireObject(issues.at("rules"), doc.rules, "");
  const minTouch = requireObject(issues.at("rules/minTouchMm"), rulesRaw.minTouchMm, "");
  const rules = {
    minTouchMm: {
      w: requireInt(issues.at("rules/minTouchMm"), minTouch, "w", { min: 1, max: 100 }),
      h: requireInt(issues.at("rules/minTouchMm"), minTouch, "h", { min: 1, max: 100 }),
    },
    allowedPrimitives: requireArray(issues.at("rules"), rulesRaw, "allowedPrimitives", { min: 1 }).map((p, i) => {
      const v = String(p);
      if (!PRIMITIVES.includes(v))
        issues.at("rules/allowedPrimitives").add({
          path: String(i), rule: "unknown-primitive",
          message: `no Nextion component type is called this`, source: "editor",
          measuredIn: "export/src/hmiTemplates.generated.ts", got: v,
        });
      return v;
    }),
  };

  const components: ComponentSpec[] = requireArray(issues, doc, "components").map((entry, index) => {
    const at = issues.at(`components/${index}`);
    const o = requireObject(at, entry);
    const primitives = requireArray(at, o, "primitives", { min: 1 }).map((p, i) => {
      const v = String(p);
      if (!rules.allowedPrimitives.includes(v))
        at.add({
          path: `primitives/${i}`, rule: "primitive-not-allowed",
          message: `this theme does not admit "${v}"`, source: "ours", got: v,
          want: rules.allowedPrimitives.join(", "),
        });
      return v;
    });
    const touch = o.minTouchMm === undefined ? undefined : requireObject(at.at("minTouchMm"), o.minTouchMm, "");
    const spec: ComponentSpec = {
      id: requireString(at, o, "id", { pattern: ID_PATTERN }),
      render: requireString(at, o, "render"),
      primitives,
      hardwareValidated: optionalBoolean(o, "hardwareValidated"),
      variants: parseVariants(at, o),
      requires: (o.requires === undefined ? [] : requireArray(at, o, "requires")).map(String),
      notes: optionalString(o, "notes"),
    };
    if (touch) {
      const w = requireInt(at.at("minTouchMm"), touch, "w", { min: 1, max: 100 });
      const h = requireInt(at.at("minTouchMm"), touch, "h", { min: 1, max: 100 });
      // the theme's own floor wins over a component that asks for less
      if (w < rules.minTouchMm.w || h < rules.minTouchMm.h)
        at.add({
          path: "minTouchMm", rule: "below-theme-floor",
          message: `smaller than this theme's floor of ${rules.minTouchMm.w}x${rules.minTouchMm.h} mm`,
          source: "ours", got: `${w}x${h}`,
        });
      spec.minTouchMm = { w, h };
    }
    return spec;
  });
  uniqueBy(issues.at("components"), components, (c) => c.id, "component id");

  return issues.check(where, {
    schemaVersion, id, name,
    description: optionalString(doc, "description"),
    drawing: DRAWING_RULES,
    colors, fonts, typeface, style, icons, components, rules,
  });
}

/** True when the document parses; useful when a caller wants the issues, not a throw. */
export function tryParseTheme(raw: unknown, where = "theme"): { ok: true; value: Theme } | { ok: false; error: ValidationError } {
  try {
    return { ok: true, value: parseTheme(raw, where) };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e };
    throw e;
  }
}
