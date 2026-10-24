// Where the letters are, which is not a theme's decision.
//
// A theme decides how a key LOOKS -- face, gap, which one gets the accent. It
// does not get to decide that P is at the end of the top row, because the whole
// value of QWERTY is that it is the same everywhere. So the map lives here and
// the three themes read it.
//
// THE MAP IS NOT OURS EITHER. It is the vendor's, read out of the keyboard
// Nextion ships with the Editor for this exact resolution
// (`keyboarden/480320/1.page`, page "keybdA"): ten columns, q-p over a-l over
// z-m, DEL and CAPS on the letter rows. What we changed, we changed on purpose:
//
//   - the symbols are not on the letters. The alphabet there is letters,
//     digits, space, a comma and a full stop -- no accents, no icons.
//     `; ? < > " / * # @ & ! -` were all on the vendor's page and are not on
//     that one of ours. They have a page of their own, the symbols, one key away (`keyboardSymbolKeys`): every printable ASCII
//     sign but the double quote, which a Nextion string cannot carry,
//     and the backtick, which the
//     theme fonts draw blank.
//   - the digits are a FIXED ROW instead of a `123` mode. The vendor needs the
//     mode because it also offers twenty symbols; with an alphabet this small
//     everything fits on one screen, and a mode the user has to discover buys
//     nothing.
//   - the cursor keys are gone. Editing is typing and backspace; a caret to
//     move would need a second index to keep on the glass.
//   - the letter rows are CENTRED and the four keys that are not letters sit
//     together on the bottom row. The vendor
//     hangs DEL and CAPS off the ends of the letter rows, which makes every row
//     a different width and puts a destructive key next to "l".
import type { Action, KeyRole, KeyboardTarget } from "./node.js";

/** One key, before a theme gives it a box. */
export interface KeySpec {
  role: KeyRole;
  /**
   * The object-name stem, when the caption is not one: "#+=" has no letter a
   * Nextion name may carry. Absent, `keyId` derives it from the caption.
   */
  id?: string;
  /** `layout` only: the keyboard it goes to */
  to?: KeyboardTarget;
  /** draw the caption as this icon role instead of as letters */
  capIcon?: string;
  /** the caption; for a `char` key, the character it types */
  cap: string;
  /** the caption while CAPS is on; absent means the key does not change */
  capsCap?: string;
  /** `cycle` only: the characters this key steps through, in order */
  cycle?: readonly string[];
  /** `cycle` only: the same characters in upper case */
  cycleCaps?: readonly string[];
  /** which column it starts at */
  col: number;
  /** how many columns it covers */
  span: number;
  /** which row, from the top */
  row: number;
}

/**
 * The columns the grid is divided into.
 *
 * TWENTY, and a letter spans two of them. Half a letter is the resolution the
 * bottom row needs -- five keys across ten letters' worth of width -- and
 * counting in halves is what keeps every key on an integer boundary instead of
 * leaving a one-pixel seam wherever a rounding fell differently.
 */
export const KEYBOARD_COLUMNS = 20;

/** How wide one letter is, in columns. */
const LETTER = 2;

// A key whose upper case IS its lower case gets no caps form at all -- every
// digit, and the full stop. Not a nicety: `capsCap` is what puts a line in the
// block that rewrites the captions, and rewriting "." to "." is a line of glass
// code that changes nothing.
const letters = (word: string, row: number, col: number): KeySpec[] =>
  [...word].map((c, i) => {
    const upper = c.toUpperCase();
    return {
      role: "char" as const, cap: c,
      ...(upper === c ? {} : { capsCap: upper }),
      col: col + i * LETTER, span: LETTER, row,
    };
  });

/** A row of n letters, centred on the grid. */
const centred = (word: string, row: number): KeySpec[] =>
  letters(word, row, Math.floor((KEYBOARD_COLUMNS - word.length * LETTER) / 2));

/** The digits and the three letter rows, which are the same on every panel. */
const alphabet = (): KeySpec[] => [
  ...letters("1234567890", 0, 0),
  ...letters("qwertyuiop", 1, 0),
  ...centred("asdfghjkl", 2),
  // The comma and the full stop ride at the end of the last letter row, where
  // a keyboard puts them -- centred WITH the letters, as one row of nine.
  // Centring the letters and then placing the dot as if the row had one more
  // puts it 18 px inside the "m". The comma is there because a device's position
  // is typed "2,5".
  ...centred("zxcvbnm,.", 3),
];

export interface KeyboardMap {
  keys: readonly KeySpec[];
  rows: number;
  /**
   * How many columns THIS map is laid out on.
   *
   * QWERTY counts in half-letters (20) because its bottom row needs that
   * resolution; a keypad is three or four keys across and counting in halves
   * there would only invite a rounding to fall in the wrong place.
   */
  columns: number;
  /**
   * Draw a cycle key as the digit over its letters, both centred, instead of
   * one line reading "2 abc".
   *
   * Every phone keypad does it, and it needs room: two lines of type inside one
   * key. The portrait panel has that room (96 px of key height); the landscape
   * one has 58, where the same stack would leave each line cramped and the
   * single line reads perfectly well.
   */
  stacked?: boolean;
}

/**
 * The keys, for the panel this keyboard is being laid out on.
 *
 * Two arrangements, because the two panels are not the same shape and pretending
 * they are is how the portrait one ends up with keys nobody can hit.
 *
 * LANDSCAPE (5 rows). Everything that is not a letter is on the bottom row,
 * with the two that leave the keyboard on the outside, the two that edit it
 * inboard of them, and a switch either side of SPACE, which is in the middle:
 * the row reads the same from both ends, key by key and width by width:
 *
 *     1 2 3 4 5 6 7 8 9 0
 *      q w e r t y u i o p
 *       a s d f g h j k l
 *       z x c v b n m , .
 *     X  CAPS  #+= SPACE 123  DEL  OK
 *
 * PORTRAIT (6 rows). Only 320 px across, so seven keys on one row would be
 * 3 mm each. CAPS, the two switches and DEL get a row of their own above the
 * last one -- the biggest targets on the keyboard, on the panel that needs
 * them biggest:
 *
 *     1 2 3 4 5 6 7 8 9 0
 *      q w e r t y u i o p
 *       a s d f g h j k l
 *       z x c v b n m , .
 *     CAPS  #+=  123  DEL
 *     X    SPACE    OK
 *
 * The switches are the narrow ones, at a letter's width on the landscape
 * panel: CAPS and DEL are pressed while typing, a switch once a word if at
 * all. The symbols' key sits left of SPACE on the landscape panel, which puts
 * SPACE in the middle of the row with the keys beside it mirrored by width; X,
 * DEL and OK keep their places on both panels.
 */
export function keyboardKeys(size: { w: number; h: number }): KeyboardMap {
  if (size.w >= size.h) {
    return {
      rows: 5,
      columns: KEYBOARD_COLUMNS,
      keys: [
        ...alphabet(),
        { role: "cancel", cap: "X", capIcon: "cancel", col: 0, span: 3, row: 4 },
        { role: "caps", cap: "CAPS", col: 3, span: 3, row: 4 },
        // The way to the symbols, captioned as the phones caption it.
        { role: "layout", cap: "#+=", id: "Sym", to: "symbols", col: 6, span: 2, row: 4 },
        // in the middle of the row: its centre is the grid's, column 10 of 20
        { role: "space", cap: "SPACE", col: 8, span: 4, row: 4 },
        // The way to the keypad. Captioned "123" because that is what it takes
        // you to, and because a key labelled "T9" means nothing to anyone who
        // has not read this file.
        { role: "layout", cap: "123", to: "keypad", col: 12, span: 2, row: 4 },
        { role: "backspace", cap: "DEL", capIcon: "backspace", col: 14, span: 3, row: 4 },
        { role: "commit", cap: "OK", capIcon: "confirm", col: 17, span: 3, row: 4 },
      ],
    };
  }
  return {
    rows: 6,
    columns: KEYBOARD_COLUMNS,
    keys: [
      ...alphabet(),
      // The four that are neither letter nor way out, on a row of their own,
      // with the switches in the middle. The
      // ends are the wider ones: CAPS and DEL are pressed while typing, a
      // switch once a word if at all.
      { role: "caps", cap: "CAPS", col: 0, span: 6, row: 4 },
      { role: "layout", cap: "#+=", id: "Sym", to: "symbols", col: 6, span: 4, row: 4 },
      { role: "layout", cap: "123", to: "keypad", col: 10, span: 4, row: 4 },
      { role: "backspace", cap: "DEL", capIcon: "backspace", col: 14, span: 6, row: 4 },
      { role: "cancel", cap: "X", capIcon: "cancel", col: 0, span: 4, row: 5 },
      { role: "space", cap: "SPACE", col: 4, span: 12, row: 5 },
      { role: "commit", cap: "OK", capIcon: "confirm", col: 16, span: 4, row: 5 },
    ],
  };
}

/**
 * The symbols: every printable ASCII sign but two, for the Wi-Fi
 * and MQTT passwords and hosts the letters cannot type.
 *
 *   - the double quote, because a Nextion string cannot carry one: it would
 *     end the string early;
 *   - the backtick, because the theme fonts cannot draw one. Their U+0060 is
 *     a blank glyph one pixel wide, in all three (they are cut from joBr99's
 *     own font), and a key that shows nothing is a key nobody can find.
 *
 * The same frame as the letters, so the keys a finger finds without looking
 * stay where they were -- the digits across the top, X, DEL and OK, and the
 * switches -- and the letters' three rows become three rows of signs, grouped
 * the way a keyboard's shifted row and its brackets are, the last one centred
 * as the letters' are:
 *
 *     1 2 3 4 5 6 7 8 9 0
 *     ! @ # $ % ^ & * ( )
 *     - _ = + [ ] { } \ |
 *      ; : ' , / ? < > ~
 *     X   .  ABC SPACE 123  DEL  OK        (landscape)
 *
 *     .    ABC   123   DEL                 (portrait)
 *     X    SPACE    OK
 *
 * The full stop takes CAPS's place, which means nothing where nothing has a
 * case, and ABC the place of #+=, left of SPACE, which is in the middle as on
 * the letters; the comma rides with the signs. The digits are here too, so a
 * password of signs and digits is typed on one page.
 *
 * A LAYOUT WITH NO QWERTY (the US portrait) has the signs on a keypad as its
 * letters are: nine keys that cycle, each
 * through a family of signs and then its digit as a letter key does, the full
 * stop alone in CAPS's place, as it took CAPS's place on the frame above, ABC
 * back to the keypad's letters where #+= was, and the last row the keypad's:
 *
 *     1 ,:;     2 !?'     3 @#$%
 *     4 ()[]    5 {}<>    6 -_=+
 *     7 *&|     8 /\      9 ^~
 *     .         ABC       DEL
 *     X         0 _       OK
 *
 * The landscape frame has no such keypad: a landscape layout keeps its QWERTY.
 */
export function keyboardSymbolKeys(size: { w: number; h: number }, ways: KeyboardWays = ALL_WAYS): KeyboardMap {
  const signs = [
    ...letters("1234567890", 0, 0),
    ...letters("!@#$%^&*()", 1, 0),
    ...letters("-_=+[]{}\\|", 2, 0),
    ...centred(";:',/?<>~", 3),
  ];
  if (size.w >= size.h) {
    if (!ways.letters) throw new Error("the symbols in landscape go back to the letters: a landscape layout keeps its QWERTY");
    return {
      rows: 5,
      columns: KEYBOARD_COLUMNS,
      keys: [
        ...signs,
        { role: "cancel", cap: "X", capIcon: "cancel", col: 0, span: 3, row: 4 },
        { role: "char", cap: ".", col: 3, span: 3, row: 4 },
        { role: "layout", cap: "ABC", to: "letters", col: 6, span: 2, row: 4 },
        { role: "space", cap: "SPACE", col: 8, span: 4, row: 4 },
        { role: "layout", cap: "123", to: "keypad", col: 12, span: 2, row: 4 },
        { role: "backspace", cap: "DEL", capIcon: "backspace", col: 14, span: 3, row: 4 },
        { role: "commit", cap: "OK", capIcon: "confirm", col: 17, span: 3, row: 4 },
      ],
    };
  }
  if (!ways.letters) return symbolPadKeys(ways);
  const switches: KeySpec[] = [
    { role: "layout", cap: "ABC", to: "letters", col: 6, span: 4, row: 4 },
    { role: "layout", cap: "123", to: "keypad", col: 10, span: 4, row: 4 },
  ];
  return {
    rows: 6,
    columns: KEYBOARD_COLUMNS,
    keys: [
      ...signs,
      { role: "char", cap: ".", col: 0, span: 6, row: 4 },
      ...switches,
      { role: "backspace", cap: "DEL", capIcon: "backspace", col: 14, span: 6, row: 4 },
      { role: "cancel", cap: "X", capIcon: "cancel", col: 0, span: 4, row: 5 },
      { role: "space", cap: "SPACE", col: 4, span: 12, row: 5 },
      { role: "commit", cap: "OK", capIcon: "confirm", col: 16, span: 4, row: 5 },
    ],
  };
}

/**
 * The signs on the keypad of a layout with no QWERTY (`keyboardSymbolKeys`): each key a family, then its digit, as the
 * letters' keys end in theirs. Every printable ASCII sign the symbols' page types, the full stop on its own key. A sign has
 * no case: the keys have no CAPS caption, and CAPS has no key here.
 */
const SYMBOL_CYCLES: readonly (readonly string[])[] = [
  [",", ":", ";", "1"],
  ["!", "?", "'", "2"],
  ["@", "#", "$", "%", "3"],
  ["(", ")", "[", "]", "4"],
  ["{", "}", "<", ">", "5"],
  ["-", "_", "=", "+", "6"],
  ["*", "&", "|", "7"],
  ["/", "\\", "8"],
  ["^", "~", "9"],
];

/** The signs' keypad, in the portrait keypad's frame (`keyboardT9Keys`). */
function symbolPadKeys(ways: KeyboardWays): KeyboardMap {
  const signs: KeySpec[] = SYMBOL_CYCLES.map((cycle, i) => ({
    role: "cycle", cap: cycleCap(cycle), cycle, cycleCaps: cycle,
    col: i % 3, span: 1, row: Math.floor(i / 3),
  }));
  return {
    rows: 5, columns: 3, stacked: true,
    keys: [
      ...signs,
      { role: "char", cap: ".", col: 0, span: 1, row: 3 },
      ...(ways.keypad ? [{ role: "layout", cap: "ABC", to: "keypad", col: 1, span: 1, row: 3 } as KeySpec] : []),
      { role: "backspace", cap: "DEL", capIcon: "backspace", col: 2, span: 1, row: 3 },
      { role: "cancel", cap: "X", capIcon: "cancel", col: 0, span: 1, row: 4 },
      { role: "cycle", cap: "0 _", cycle: [" ", "0"], cycleCaps: [" ", "0"], col: 1, span: 1, row: 4 },
      { role: "commit", cap: "OK", capIcon: "confirm", col: 2, span: 1, row: 4 },
    ],
  };
}

/** The props that carry a keyboard's three ways to the others (`KeyboardLayout`). */
export interface KeyboardTargets {
  toLetters?: Action;
  toKeypad?: Action;
  toSymbols?: Action;
}

/**
 * Which other keyboards a page has a way to: the keys that switch are drawn for
 * these, and a layout with no QWERTY (the US portrait) draws
 * no ABC that would go nowhere.
 */
export interface KeyboardWays {
  letters: boolean;
  keypad: boolean;
  symbols: boolean;
}

/** Every way: the map a keyboard is drawn with when nothing says otherwise, as before the ways were asked. */
export const ALL_WAYS: KeyboardWays = { letters: true, keypad: true, symbols: true };

/**
 * The ways a placement's props give it; none at all is a keyboard drawn on its own, a sample or a test, and gets every one, as
 * before the ways were asked.
 */
export const waysOf = (props: KeyboardTargets): KeyboardWays =>
  props.toLetters === undefined && props.toKeypad === undefined && props.toSymbols === undefined
    ? ALL_WAYS
    : { letters: props.toLetters !== undefined, keypad: props.toKeypad !== undefined, symbols: props.toSymbols !== undefined };

/** What a `layout` key does: the way to the keyboard it names, when the page was given one. */
export const layoutAction = (props: KeyboardTargets, to: KeyboardTarget | undefined): Action | undefined =>
  to === "letters" ? props.toLetters : to === "keypad" ? props.toKeypad : to === "symbols" ? props.toSymbols : undefined;

/**
 * The T9 keypad, which is the same alphabet on twelve keys instead of forty.
 *
 * WHY IT EXISTS. QWERTY on a 69 mm window gives a key 6,2 mm across -- below
 * every standard for a bare finger
 * collects, and the owner said so after seeing it. Four columns instead of ten
 * gives 16 mm, which is above even the industrial floor. The trade is taps per
 * letter, not accuracy.
 *
 * MULTI-TAP, NOT PREDICTION. "T9" properly means a dictionary guessing the word
 * from one press per letter. That needs a wordlist on the panel and a language
 * to pick; this is the other half of the same keypad -- press twice for B,
 * three times for C -- which needs no dictionary and no language, and is what
 * every phone fell back to anyway. The window is `MULTITAP_MS`; pressing the
 * same key inside it steps to the next character and replaces the last one.
 *
 * The digit is last in each cycle, where every phone keypad has put it since
 * 1997: it is the character reached for least.
 *
 *     1 .      2 abc    3 def     DEL
 *     4 ghi    5 jkl    6 mno     CAPS
 *     7 pqrs   8 tuv    9 wxyz    ABC
 *     X            0 _            OK
 *
 * The bottom-left and bottom-right are X and OK in the SAME PLACE as on the
 * QWERTY layout, because those two are the ones a finger reaches for without
 * looking, and a keyboard that moves them when you switch layout is a keyboard
 * that throws your work away by surprise.
 */
const T9_CYCLES: readonly (readonly string[])[] = [
  // the full stop and the comma (a position is typed "2,5")
  [".", ",", "1"],
  ["a", "b", "c", "2"],
  ["d", "e", "f", "3"],
  ["g", "h", "i", "4"],
  ["j", "k", "l", "5"],
  ["m", "n", "o", "6"],
  ["p", "q", "r", "s", "7"],
  ["t", "u", "v", "8"],
  ["w", "x", "y", "z", "9"],
];

/** How long the multi-tap window stays open, in milliseconds. */
export const MULTITAP_MS = 1000;

/** The caption of a cycle key: the digit big, the letters after it. */
const cycleCap = (cycle: readonly string[]): string => {
  const digit = cycle[cycle.length - 1];
  return `${digit} ${cycle.slice(0, -1).join("")}`;
};

/**
 * The same caption with CAPS on.
 *
 * A cycle key needs one for the same reason a letter key does: CAPS changes
 * what the key TYPES, and a mode that changes what a key does without changing
 * what it says is a trap: CAPS would flip the flag and not one pixel move, so
 * the only way to find out which case you are in would be to type a letter and
 * look (the B19/B20 scenarios hold it). The digit is not a letter and does not
 * move.
 */
const cycleCapsCap = (cycle: readonly string[]): string => {
  const digit = cycle[cycle.length - 1];
  return `${digit} ${cycle.slice(0, -1).join("").toUpperCase()}`;
};

/**
 * The T9 keypad, which is three keys across in portrait and four in landscape.
 *
 * LANDSCAPE. A fourth column down the right-hand side for the keys that are not
 * characters, because 320 px of height only divides into four comfortable rows:
 *
 *     1 .      2 abc    3 def     DEL
 *     4 ghi    5 jkl    6 mno     CAPS
 *     7 pqrs   8 tuv    9 wxyz    ABC
 *     X            0 _            OK
 *
 * PORTRAIT. 480 px of height is room for five rows, so the digits keep the
 * whole width in three fat columns and DEL, CAPS and the switch get a row of
 * their own above the last:
 *
 *     1 .      2 abc    3 def
 *     4 ghi    5 jkl    6 mno
 *     7 pqrs   8 tuv    9 wxyz
 *     CAPS     ABC      <backspace>
 *     X        0 _      OK
 *
 * In both, X and OK sit where they sit on the QWERTY layout -- bottom left and
 * bottom right. They are the two a finger reaches for without looking, and a
 * keyboard that moves them when you switch layout throws your work away by
 * surprise.
 *
 * A LAYOUT WITH NO QWERTY (the US portrait) has the keypad for its letters, and
 * the switch is #+=, to the symbols: every sign the panel types stays one key
 * away.
 */
export function keyboardT9Keys(size: { w: number; h: number }, ways: KeyboardWays = ALL_WAYS): KeyboardMap {
  const portrait = size.h > size.w;
  const columns = portrait ? 3 : 4;
  const digits: KeySpec[] = T9_CYCLES.map((cycle, i) => ({
    role: "cycle", cap: cycleCap(cycle), capsCap: cycleCapsCap(cycle), cycle,
    cycleCaps: cycle.map((c) => c.toUpperCase()),
    col: i % 3, span: 1, row: Math.floor(i / 3),
  }));
  // The way back to QWERTY is captioned with what it TAKES YOU TO, the way
  // every phone labels this key, and not with what you are on; with no QWERTY,
  // the way to the symbols, captioned as the letters caption it.
  const toOther = (col: number, row: number): KeySpec[] => ways.letters
    ? [{ role: "layout", cap: "ABC", to: "letters", col, span: 1, row }]
    : ways.symbols ? [{ role: "layout", cap: "#+=", id: "Sym", to: "symbols", col, span: 1, row }] : [];
  if (portrait) {
    return {
      rows: 5, columns, stacked: true,
      keys: [
        ...digits,
        // CAPS, the switch, then backspace -- left to right. It puts delete next to OK, which is where the hand
        // already is when it finishes a name.
        { role: "caps", cap: "CAPS", col: 0, span: 1, row: 3 },
        ...toOther(1, 3),
        { role: "backspace", cap: "DEL", capIcon: "backspace", col: 2, span: 1, row: 3 },
        { role: "cancel", cap: "X", capIcon: "cancel", col: 0, span: 1, row: 4 },
        { role: "cycle", cap: "0 _", cycle: [" ", "0"], cycleCaps: [" ", "0"], col: 1, span: 1, row: 4 },
        { role: "commit", cap: "OK", capIcon: "confirm", col: 2, span: 1, row: 4 },
      ],
    };
  }
  return {
    rows: 4, columns,
    keys: [
      ...digits,
      { role: "backspace", cap: "DEL", capIcon: "backspace", col: 3, span: 1, row: 0 },
      { role: "caps", cap: "CAPS", col: 3, span: 1, row: 1 },
      ...toOther(3, 2),
      { role: "cancel", cap: "X", capIcon: "cancel", col: 0, span: 1, row: 3 },
      { role: "cycle", cap: "0 _", cycle: [" ", "0"], cycleCaps: [" ", "0"], col: 1, span: 2, row: 3 },
      { role: "commit", cap: "OK", capIcon: "confirm", col: 3, span: 1, row: 3 },
    ],
  };
}

/** The geometry a theme lays the map out on. */
export interface KeyboardGrid {
  /** the outer margin, on all four sides */
  margin: number;
  /** the gap between two keys: the drawn key is this much smaller than its cell */
  gap: number;
  /** the height of the line being edited */
  fieldHeight: number;
  /** the space between the field and the first row of keys */
  fieldGap: number;
}

export interface KeyBox { x: number; y: number; w: number; h: number }

/**
 * The boxes, for one size, one map and one theme's spacing.
 *
 * Everything is clamped to the box, because a layout that runs past the box it
 * was given is a layout that draws behind the bezel or off the page. The sizes a
 * theme asks for are what it gets when there is room and the most it can have
 * when there is not -- and the KEYS have first claim on the height, because a
 * line of text with no keyboard under it is not a keyboard.
 */
/**
 * How far the line being typed stands in from its field's edges, in panel
 * pixels. The keys keep no margin; the TEXT does not follow them onto the edge
 * of the glass. A Text has no padding, so the field is a fill of the
 * field's colour and the line a Text inset over it.
 */
export const FIELD_INSET = 8;

/** The line's own box inside a field's, `FIELD_INSET` in from either side. */
export function fieldLine(field: { x: number; y: number; w: number; h: number }, inset = FIELD_INSET) {
  const i = Math.max(0, Math.min(inset, Math.floor((field.w - 2) / 2)));
  return { x: field.x + i, y: field.y, w: Math.max(1, field.w - 2 * i), h: field.h };
}

export function keyboardGeometry(size: { w: number; h: number }, grid: KeyboardGrid, map: KeyboardMap) {
  const margin = Math.max(0, Math.min(grid.margin, Math.floor(size.h / 20), Math.floor(size.w / 20)));
  const fieldGap = Math.max(0, Math.min(grid.fieldGap, Math.floor(size.h / 20)));
  // Never wider than the box: a keyboard asked to fit twelve pixels gets twelve,
  // and its keys clamp to one pixel each. Floor of one column would have let the
  // grid spill past the right edge of a degenerate box, which on the EU panel
  // means spilling behind the bezel.
  const usable = Math.max(1, size.w - margin * 2);
  /**
   * Where a column STARTS, as a proportion of the whole width.
   *
   * Not `col * floor(usable / columns)`. Twenty columns rarely divide a panel
   * exactly -- 310/20 is 15.5 on the US portrait and 438/20 is 21.9 on the EU --
   * and flooring throws the remainder away: 10 px and 18 px, all of it piling up
   * on the RIGHT margin, so the whole keyboard sits visibly left of centre.
   *
   * Deriving each edge from the full width instead spends every pixel: the keys
   * come out within one pixel of each other, which no finger can tell, and
   * nothing is left over to pile up anywhere.
   */
  const edge = (col: number) => Math.round((col * usable) / map.columns);
  const colW = Math.max(1, Math.floor(usable / map.columns));
  const available = size.h - margin * 2 - fieldGap;
  const fieldHeight = Math.max(1, Math.min(grid.fieldHeight, available - map.rows));
  const gridW = usable;
  const field: KeyBox = { x: margin, y: margin, w: Math.max(1, gridW), h: fieldHeight };
  const top = field.y + field.h + fieldGap;
  const rowH = Math.max(1, Math.floor((size.h - top - margin) / map.rows));
  // The gap is taken OUT of the cell, so it can never be as big as the cell.
  const gap = Math.max(0, Math.min(grid.gap, rowH - 1, colW - 1));
  const box = (k: KeySpec): KeyBox => {
    // Half the gap on each side, so the row's own ends get what sits BETWEEN two
    // keys everywhere else. Taking the whole gap off the right-hand side (which
    // is what subtracting it from the width alone does) left every row four
    // pixels closer to the left edge than to the right.
    const x = margin + Math.min(edge(k.col) + Math.floor(gap / 2), Math.max(0, gridW - 1));
    const y = top + k.row * rowH;
    return {
      x, y,
      // the cell runs to where the NEXT column starts, less the gap, so the
      // remainder is spread across the row instead of dropped off its end
      w: Math.max(1, Math.min(edge(k.col + k.span) - edge(k.col) - gap, margin + gridW - x)),
      h: Math.max(1, Math.min(rowH - gap, size.h - margin - y)),
    };
  };
  /**
   * A key's CELL: its face and the gap around it, the finger's box. Cells of
   * two neighbours touch and never overlap, because both edges come from the
   * same `edge`: with the touch on the face, a finger between two keys -- 3 to
   * 10 px, by theme -- would type nothing.
   */
  const cell = (k: KeySpec): KeyBox => {
    const x = margin + edge(k.col);
    const y = top + k.row * rowH;
    return {
      x, y,
      w: Math.max(1, Math.min(edge(k.col + k.span) - edge(k.col), margin + gridW - x)),
      h: Math.max(1, Math.min(rowH, size.h - margin - y)),
    };
  };
  return { colW, rowH, gap, field, box, cell };
}

/**
 * What one key does to the line, as a function.
 *
 * The glass runs its own version of this -- four Nextion instructions the
 * emitter writes per key (`emit.ts`, case "key") -- and it has to, because a
 * keystroke cannot wait for a round trip. This is the same RULE for the
 * simulator, generated from the same `KeyRole`s, so there is one place to read
 * what a key means even though there are two machines running it.
 *
 * `caps` is not here: it changes the captions, not the line, and a caption is
 * the caller's state.
 *
 * Returns the line unchanged for a key that does not edit it -- commit and
 * cancel are the caller's business.
 */
export function applyKey(line: string, key: { role: KeyRole; cap: string }, max: number): string {
  switch (key.role) {
    // The capacity test is `btlen`'s on the glass: BYTES, not characters. They
    // are the same number for this alphabet, which has no character outside
    // ASCII -- and that is a property of the alphabet, so it is worth saying
    // where someone might add an accent later.
    case "char": return line.length < max ? line + key.cap : line;
    case "space": return line.length < max ? line + " " : line;
    case "backspace": return line.slice(0, -1);
    default: return line;
  }
}

/**
 * A key's object-name stem, which has to survive `objectName`'s sanitiser.
 *
 * A cycle key is named for its DIGIT -- "2 abc" has a space in it, and the
 * caption is not an identifier. The digit is unique on the keypad, which is the
 * whole reason phones number these keys.
 */
export const keyId = (key: KeySpec): string => {
  if (key.id !== undefined) return `k${key.id}`;
  if (key.cycle) return `k${key.cycle[key.cycle.length - 1]}`;
  return `k${SIGN_NAMES[key.cap] ?? key.cap}`;
};

/**
 * A sign's name in an object name, which takes letters, digits and underscore
 * only: the full stop, the comma and the symbols' page. Each is unique, so no two keys of a page
 * share a name the way `objectName`'s sanitiser would make them.
 */
export const SIGN_NAMES: Readonly<Record<string, string>> = {
  ".": "Dot", ",": "Comma",
  "!": "Excl", "@": "At", "#": "Hash", "$": "Dollar", "%": "Pct", "^": "Caret", "&": "Amp", "*": "Star",
  "(": "LParen", ")": "RParen", "-": "Minus", "_": "Under", "=": "Equal", "+": "Plus",
  "[": "LBrack", "]": "RBrack", "{": "LBrace", "}": "RBrace", "\\": "Bslash", "|": "Pipe",
  ";": "Semi", ":": "Colon", "'": "Apos", "/": "Slash", "?": "Quest", "<": "Less", ">": "Great",
  "~": "Tilde",
};

/** The caption a key shows, which is the only thing CAPS changes. */
export const keyCap = (key: { cap: string; capsCap?: string }, caps: boolean): string =>
  (caps && key.capsCap !== undefined ? key.capsCap : key.cap);

/** Where a multi-tap key is, between presses. */
export interface MultiTap {
  /** the key being cycled, by its object-name stem */
  key: string;
  /** how far round its cycle */
  step: number;
  /** when the window closes, in milliseconds */
  until: number;
}

/**
 * One press of a multi-tap key.
 *
 * The glass runs its own copy of this -- the emitter writes it as Nextion
 * instructions, because a keystroke cannot wait for a round trip -- and the two
 * have to agree on the same two branches:
 *
 *   CYCLING replaces. The press landed on the same key inside the window, so
 *   the character already there comes off and the next one goes on. The line
 *   does not grow, which is why no capacity test is needed and why one cannot
 *   fail half way and leave a character missing.
 *
 *   STARTING appends, and is refused at capacity -- INCLUDING the bookkeeping.
 *   A line already full must not remember the key either, or the next press on
 *   it would find the window open and eat a character the finger never typed.
 */
export function applyCycleKey(
  line: string,
  key: { id: string; cycle: readonly string[] },
  tap: MultiTap | null,
  max: number,
  now: number,
  caps: boolean,
): { line: string; tap: MultiTap | null } {
  const at = (i: number) => (caps ? key.cycle[i].toUpperCase() : key.cycle[i]);
  const open = tap !== null && tap.key === key.id && now < tap.until;
  if (open) {
    const step = (tap.step + 1) % key.cycle.length;
    return { line: line.slice(0, -1) + at(step), tap: { key: key.id, step, until: now + MULTITAP_MS } };
  }
  if (line.length >= max) return { line, tap };
  return { line: line + at(0), tap: { key: key.id, step: 0, until: now + MULTITAP_MS } };
}
