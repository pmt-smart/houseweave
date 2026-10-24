// What the keyboard is supposed to DO, written once as a list of sequences.
//
// Two engines read this file. `test/keyboardGlass.test.mjs` runs each sequence
// on `glass.mjs`, which executes the instruction lines the compiled page really
// carries -- no sandbox, no desktop, runs in CI. `scripts/panel-bench.mjs`
// runs the same sequences in the Nextion Editor's own debugger, which is the
// vendor's model of their instruction set and the closest thing to the panel
// that exists without hardware, beside the emulated glass: the same bytes out,
// and the same field on the display.
//
// They are deliberately the same list. Where the two disagree, one of them is
// wrong about the glass and the disagreement is the finding: the React simulator
// can do the right thing where the compiled page does not.
//
// A scenario is:
//   id       short handle, so a run can say `--only B4`
//   what     the sentence a person would use to describe the behaviour
//   page     which screen to open before pressing anything
//   seed     the globals to set first: the text being edited and its capacity.
//            This is what `berry/brain.be` writes when a long press opens the
//            keyboard, and setting it directly is what lets the keyboard be
//            tested with no ESP32 in the loop.
//   press    what the finger does, in order: a key's hotspot name, or
//            `{ key, after }` to wait `after` ms before pressing it
//   expect   text / caps / page / frames -- only the ones a scenario is about

/** 1000 ms, the multi-tap window; the same constant the generator emits. */
export const TAP_MS = 1000;

/** Keys by the name of the Hotspot that carries their code, on both keyboards. */
const K = {
  a: "mka0", b: "mkb0", c: "mkc0", h: "mkh0", i: "mki0", m: "mkm0", o: "mko0", q: "mkq0",
  e: "mke0", s: "mks0", z: "mkz0", dot: "mkDot0", comma: "mkComma0",
  one: "mk10", two: "mk20", three: "mk30", eight: "mk80", nine: "mk90", zero: "mk00",
  caps: "mkCAPS0", del: "mkDEL0", space: "mkSPACE0", ok: "mkOK0", x: "mkX0",
  toPad: "mk1230", toBoard: "mkABC0", toSym: "mkSym0",
  // the symbols' signs, by the names their keys carry (keyboard.ts, SIGN_NAMES)
  at: "mkAt0", hash: "mkHash0", excl: "mkExcl0", under: "mkUnder0", bslash: "mkBslash0", tilde: "mkTilde0",
};

export const BOARD = "editboard";
export const PAD = "editpad";
export const SYM = "editsymbols";

/** The QWERTY: one key, one character, and the four keys that are not letters. */
export const boardScenarios = [
  {
    id: "A1", what: "the field opens with what the slot says and a caret after it",
    page: BOARD, seed: { text: "Home", max: 13 }, press: [],
    expect: { text: "Home", shown: "Home|" },
  },
  {
    id: "A2", what: "the caret blinks, and blinking never touches the text",
    page: BOARD, seed: { text: "Home", max: 13 }, press: [], advance: 500,
    expect: { text: "Home", shown: "Home" },
  },
  {
    id: "A3", what: "the caret comes back on the next blink",
    page: BOARD, seed: { text: "Home", max: 13 }, press: [], advance: 1000,
    expect: { text: "Home", shown: "Home|" },
  },
  {
    id: "A4", what: "a letter appends, and the caret stays behind it",
    page: BOARD, seed: { text: "Home", max: 13 }, press: [K.a],
    expect: { text: "Homea", shown: "Homea|" },
  },
  {
    id: "A5", what: "typing holds the caret solid instead of leaving it mid-blink",
    page: BOARD, seed: { text: "Home", max: 13 }, press: [K.a], advance: 400,
    expect: { shown: "Homea|" },
  },
  {
    id: "A6", what: "CAPS rewrites the legends and the next letter is upper case",
    page: BOARD, seed: { text: "", max: 13 }, press: [K.caps, K.a],
    expect: { text: "A", caps: 1, legend: { ka0: "A", kz0: "Z" } },
  },
  {
    id: "A7", what: "CAPS again goes back, legends and all",
    page: BOARD, seed: { text: "", max: 13 }, press: [K.caps, K.caps, K.a],
    expect: { text: "a", caps: 0, legend: { ka0: "a" } },
  },
  {
    id: "A8", what: "a digit is a digit in either case",
    page: BOARD, seed: { text: "", max: 13 }, press: [K.caps, K.two],
    expect: { text: "2" },
  },
  {
    id: "A9", what: "space, comma and dot are typeable and nothing else is",
    page: BOARD, seed: { text: "a", max: 13 }, press: [K.space, K.comma, K.dot],
    expect: { text: "a ,." },
  },
  {
    id: "A10", what: "backspace takes the last character",
    page: BOARD, seed: { text: "Home", max: 13 }, press: [K.del],
    expect: { text: "Hom", shown: "Hom|" },
  },
  {
    id: "A11", what: "backspace on an empty line does nothing at all",
    page: BOARD, seed: { text: "", max: 13 }, press: [K.del, K.del],
    expect: { text: "", shown: "|" },
  },
  {
    id: "A12", what: "the line stops at the slot's capacity",
    page: BOARD, seed: { text: "abcde", max: 6 }, press: [K.a, K.b],
    expect: { text: "abcdea" },
  },
  {
    id: "A13", what: "backspace at capacity frees exactly one place",
    page: BOARD, seed: { text: "abcdef", max: 6 }, press: [K.del, K.z],
    expect: { text: "abcdez" },
  },
  {
    id: "A14", what: "OK sends the typed line, once",
    page: BOARD, seed: { text: "Sofa", max: 13 }, press: [K.ok],
    expect: { frames: ["ev,editboard,mkOK0,text,Sofa"] },
  },
  {
    id: "A15", what: "OK on an empty line sends nothing -- an empty name never leaves the glass",
    page: BOARD, seed: { text: "", max: 13 }, press: [K.ok],
    expect: { frames: [] },
  },
  {
    id: "A16", what: "OK sends what was typed, not what the slot held",
    page: BOARD, seed: { text: "Home", max: 13 }, press: [K.del, K.del, K.del, K.del, K.s, K.a, K.ok],
    expect: { text: "sa", frames: ["ev,editboard,mkOK0,text,sa"] },
  },
  {
    id: "A17", what: "X reports the cancel and leaves the line alone",
    page: BOARD, seed: { text: "Home", max: 13 }, press: [K.a, K.x],
    expect: { text: "Homea", frames: ["ev,editboard,mkX0,tap"] },
  },
  {
    id: "A18", what: "123 crosses to the keypad and the line crosses with it",
    page: BOARD, seed: { text: "Sof", max: 13 }, press: [K.toPad],
    expect: { page: PAD, text: "Sof", shown: "Sof|" },
  },
  {
    id: "A19", what: "the caret is drawn on the keypad too, by its own page's load",
    page: BOARD, seed: { text: "Sof", max: 13 }, press: [K.toPad], advance: 500,
    expect: { page: PAD, shown: "Sof" },
  },
  {
    id: "A20", what: "CAPS survives the crossing AND so do the legends it wrote",
    page: BOARD, seed: { text: "", max: 13 }, press: [K.caps, K.toPad, K.toBoard, K.a],
    expect: { page: BOARD, caps: 1, text: "A", legend: { ka0: "A" } },
  },
];

/** The keypad: twelve keys, multi-tap, and a window that a timer owns. */
export const padScenarios = [
  {
    id: "B1", what: "one press of 2 is an a",
    page: PAD, seed: { text: "", max: 13 }, press: [K.two],
    expect: { text: "a" },
  },
  {
    id: "B2", what: "three quick presses of 2 is a c, and the line never grew past one",
    page: PAD, seed: { text: "", max: 13 }, press: [K.two, K.two, K.two],
    expect: { text: "c" },
  },
  {
    id: "B3", what: "the fourth press is the digit, where every phone has put it since 1997",
    page: PAD, seed: { text: "", max: 13 }, press: [K.two, K.two, K.two, K.two],
    expect: { text: "2" },
  },
  {
    id: "B4", what: "the fifth press wraps back to a",
    page: PAD, seed: { text: "", max: 13 }, press: [K.two, K.two, K.two, K.two, K.two],
    expect: { text: "a" },
  },
  {
    id: "B5", what: "waiting out the window types a second letter instead of cycling",
    page: PAD, seed: { text: "", max: 13 }, press: [K.two, { key: K.two, after: TAP_MS + 50 }],
    expect: { text: "aa" },
  },
  {
    // 400 ms of margin and not 100. The interpreter runs on a virtual clock and
    // would happily check the exact edge, but the debugger bench presses with a
    // real mouse: between the two RELEASES sit the key's own dwell and the cost
    // of each batch step, which put a nominal 900 ms interval at ~990, and an
    // exact edge would fail on both panels while B5 passes. A scenario has to
    // ask for something both engines can deliver; the edge itself is the
    // interpreter's to guard, and B5 already holds the other side of it.
    id: "B6", what: "well inside the window still cycles",
    page: PAD, seed: { text: "", max: 13 }, press: [K.two, { key: K.two, after: TAP_MS - 400 }],
    expect: { text: "b" },
  },
  {
    id: "B7", what: "backspace closes the window: 2, backspace, 2 is an a and not a b",
    page: PAD, seed: { text: "", max: 13 }, press: [K.two, K.del, K.two],
    expect: { text: "a" },
  },
  {
    id: "B8", what: "a different key starts its own letter rather than cycling this one",
    page: PAD, seed: { text: "", max: 13 }, press: [K.two, K.three],
    expect: { text: "ad" },
  },
  {
    id: "B9", what: "CAPS types upper case on the keypad as well",
    page: PAD, seed: { text: "", max: 13 }, press: [K.caps, K.two, K.two],
    expect: { text: "B", caps: 1 },
  },
  {
    id: "B10", what: "the 1 key carries the dot, with the digit last",
    page: PAD, seed: { text: "", max: 13 }, press: [K.one],
    expect: { text: "." },
  },
  {
    id: "B11", what: "the second press of 1 is the comma",
    page: PAD, seed: { text: "", max: 13 }, press: [K.one, K.one],
    expect: { text: "," },
  },
  {
    id: "B21", what: "the third press of 1 is the digit",
    page: PAD, seed: { text: "", max: 13 }, press: [K.one, K.one, K.one],
    expect: { text: "1" },
  },
  {
    id: "B12", what: "the 0 key is the space, with its digit last",
    page: PAD, seed: { text: "a", max: 13 }, press: [K.zero],
    expect: { text: "a " },
  },
  {
    id: "B13", what: "a full line refuses a new key",
    page: PAD, seed: { text: "abcdef", max: 6 }, press: [K.two],
    expect: { text: "abcdef" },
  },
  {
    id: "B14", what: "a full line does not even REMEMBER the key -- the next press must not cycle into a character the finger never typed",
    page: PAD, seed: { text: "abcdef", max: 6 }, press: [K.two, K.two],
    expect: { text: "abcdef" },
  },
  {
    id: "B15", what: "cycling at capacity is allowed, because it replaces instead of growing",
    page: PAD, seed: { text: "abcde", max: 6 }, press: [K.two, K.two],
    expect: { text: "abcdeb" },
  },
  {
    id: "B16", what: "ABC crosses back to the QWERTY with the line intact",
    page: PAD, seed: { text: "Sof", max: 13 }, press: [K.two, K.toBoard],
    expect: { page: BOARD, text: "Sofa" },
  },
  {
    id: "B17", what: "OK on the keypad sends the same shape of frame the QWERTY does",
    page: PAD, seed: { text: "Sofa", max: 13 }, press: [K.ok],
    expect: { frames: ["ev,editpad,mkOK0,text,Sofa"] },
  },
  {
    id: "B18", what: "X on the keypad reports the cancel and changes nothing",
    page: PAD, seed: { text: "Sofa", max: 13 }, press: [K.x],
    expect: { text: "Sofa", frames: ["ev,editpad,mkX0,tap"] },
  },
];

/** The keypad again, for the one thing it shows rather than types. */
padScenarios.push(
  {
    id: "B19", panel: "eu-landscape",
    what: "CAPS shows on the keypad, because a mode with no sign is a trap",
    page: PAD, seed: { text: "", max: 13 }, press: [K.caps],
    expect: { caps: 1, legend: { k20: "2 ABC", k90: "9 WXYZ" } },
  },
  {
    id: "B20", panel: "us-portrait",
    what: "CAPS shows on the stacked keypad, on the letters and not on the digit",
    page: PAD, seed: { text: "", max: 13 }, press: [K.caps],
    expect: { caps: 1, legend: { l20: "ABC", l90: "WXYZ", n20: "2" } },
  },
);

/**
 * The symbols: a page of signs one key from the
 * letters, sharing their line, and back.
 */
export const symbolScenarios = [
  {
    id: "C1", what: "#+= crosses to the symbols and the line crosses with it",
    page: BOARD, seed: { text: "Sof", max: 13 }, press: [K.toSym],
    expect: { page: SYM, text: "Sof", shown: "Sof|" },
  },
  {
    id: "C2", what: "a sign types itself",
    page: SYM, seed: { text: "p", max: 13 }, press: [K.at, K.hash, K.excl, K.under],
    expect: { text: "p@#!_", shown: "p@#!_|" },
  },
  {
    id: "C3", what: "the backslash and the tilde type themselves, one character each",
    page: SYM, seed: { text: "", max: 13 }, press: [K.bslash, K.tilde],
    expect: { text: "\\~" },
  },
  {
    id: "C4", what: "the digits are on the symbols too, and so are the full stop and the comma",
    page: SYM, seed: { text: "", max: 13 }, press: [K.one, K.dot, K.two, K.comma],
    expect: { text: "1.2," },
  },
  {
    id: "C5", what: "ABC crosses back to the letters with the line intact",
    page: SYM, seed: { text: "p@", max: 13 }, press: [K.toBoard, K.a],
    expect: { page: BOARD, text: "p@a" },
  },
  {
    id: "C6", what: "123 on the symbols goes to the keypad",
    page: SYM, seed: { text: "p@", max: 13 }, press: [K.toPad],
    expect: { page: PAD, text: "p@", shown: "p@|" },
  },
  {
    id: "C7", what: "CAPS set on the letters survives a trip through the symbols, legends and all",
    page: BOARD, seed: { text: "", max: 13 }, press: [K.caps, K.toSym, K.toBoard, K.a],
    expect: { page: BOARD, caps: 1, text: "A", legend: { ka0: "A" } },
  },
  {
    id: "C8", what: "a full line refuses a sign",
    page: SYM, seed: { text: "abcdef", max: 6 }, press: [K.at],
    expect: { text: "abcdef" },
  },
  {
    id: "C9", what: "DEL takes the last sign back",
    page: SYM, seed: { text: "a@", max: 13 }, press: [K.del],
    expect: { text: "a" },
  },
  {
    id: "C10", what: "OK on the symbols sends the typed line, signs and all",
    page: SYM, seed: { text: "p@ss;w,rd", max: 13 }, press: [K.ok],
    expect: { frames: ["ev,editsymbols,mkOK0,text,p@ss;w,rd"] },
  },
  {
    id: "C11", what: "X on the symbols reports the cancel and changes nothing",
    page: SYM, seed: { text: "p@", max: 13 }, press: [K.x],
    expect: { text: "p@", frames: ["ev,editsymbols,mkX0,tap"] },
  },
];

/**
 * THE FIELD SLIDES. A line longer than the field shows its TAIL, so the caret
 * and the character just typed are always the ones on screen, and backspace
 * walks the window back. Before this the glass clipped on the right in silence
 * and the caret -- a character at the end of the line -- was the first thing to
 * go, which left the finger typing at a frozen screen (measured in the Editor's
 * debugger).
 *
 * `window` is a number only the layout knows -- it comes from the field's width
 * and the widest typeable glyph -- so these scenarios do not name a length.
 * `fill` seeds the line with `window + fill` characters (negative for short of
 * it) and the runner checks the ONE rule that has to hold at every length: the
 * whole line when it fits, and otherwise ".." and the last `window - 1`
 * characters of it, the mark every other cut on the panel carries,
 * with the caret after them. `caretOff` expects the blink to have taken the
 * caret away without disturbing the window.
 */
export const slidingScenarios = [
  { id: "S1", what: "a line that fits is shown whole", page: BOARD, fill: -4, press: [] },
  { id: "S2", what: "a line exactly the width of the window still shows whole", page: BOARD, fill: 0, press: [] },
  { id: "S3", what: "one past the window, the head scrolls off the left", page: BOARD, fill: 1, press: [] },
  { id: "S4", what: "far past the window, what shows is the last window characters", page: BOARD, fill: 12, press: [] },
  { id: "S5", what: "typing one more slides the window by exactly one", page: BOARD, fill: 4, press: [K.z] },
  { id: "S6", what: "backspace walks the window back", page: BOARD, fill: 4, press: [K.del, K.del] },
  { id: "S7", what: "backspacing under the window shows the whole line again", page: BOARD, fill: 2, press: [K.del, K.del, K.del, K.del] },
  { id: "S8", what: "the keypad's field slides by the same rule", page: PAD, fill: 6, press: [] },
  { id: "S13", what: "and the symbols' field too", page: SYM, fill: 6, press: [] },
  { id: "S9", what: "the caret still blinks while the window is scrolled", page: BOARD, fill: 5, press: [], advance: 500, caretOff: true },
  // Crossing keyboards with the window scrolled. The two pages compute their
  // own window from their own field, so this is the one place where the line
  // stays put and what is SHOWN can legitimately change -- and the page that
  // receives it has to redraw rather than inherit whatever the other one left.
  { id: "S10", what: "crossing to the keypad with the window scrolled redraws it there", page: BOARD, fill: 6, press: ["mk1230"] },
  { id: "S11", what: "and crossing back redraws it on the QWERTY", page: PAD, fill: 6, press: ["mkABC0"] },
  // CAPS while scrolled: the legends are rewritten and the window is not
  // disturbed, because they are two different Hotspots doing two different jobs.
  { id: "S12", what: "CAPS leaves the scrolled window where it was", page: BOARD, fill: 4, press: ["mkCAPS0"] },
];

/**
 * The US portrait has no QWERTY: its keypad goes to the
 * symbols by #+=, and the symbols come back to it by ABC, with no 123.
 */
export const portraitScenarios = [
  {
    id: "D1", panel: "us-portrait", what: "#+= on the keypad crosses to the symbols, and the line crosses with it",
    page: PAD, seed: { text: "Sof", max: 13 }, press: [K.toSym],
    expect: { page: SYM, text: "Sof", shown: "Sof|" },
  },
  {
    id: "D2", panel: "us-portrait", what: "a character still open crosses as it is, and is final there, the caret after it",
    page: PAD, seed: { text: "Sof", max: 13 }, press: [K.two, K.toSym],
    expect: { page: SYM, text: "Sofa", shown: "Sofa|" },
  },
  {
    id: "D3", panel: "us-portrait", what: "ABC on the symbols goes back to the keypad with the line intact",
    page: SYM, seed: { text: "p@", max: 13 }, press: [K.toBoard],
    expect: { page: PAD, text: "p@", shown: "p@|" },
  },
];

/**
 * The US portrait's signs are on a keypad as its letters are: each key cycles through
 * a family of signs and then its digit, the full stop alone where CAPS is.
 */
export const symbolPadScenarios = [
  {
    id: "F1", panel: "us-portrait", what: "a key's first press types its first sign",
    page: SYM, seed: { text: "p", max: 13 }, press: [K.three],
    expect: { text: "p@" },
  },
  {
    id: "F2", panel: "us-portrait", what: "pressed again in the window, the next sign takes its place",
    page: SYM, seed: { text: "p", max: 13 }, press: [K.three, K.three],
    expect: { text: "p#" },
  },
  {
    id: "F3", panel: "us-portrait", what: "the backslash is the 8's second, one character",
    page: SYM, seed: { text: "", max: 13 }, press: [K.eight, K.eight],
    expect: { text: "\\" },
  },
  {
    id: "F4", panel: "us-portrait", what: "the tilde is the 9's second",
    page: SYM, seed: { text: "", max: 13 }, press: [K.nine, K.nine],
    expect: { text: "~" },
  },
  {
    id: "F5", panel: "us-portrait", what: "the full stop has a key of its own, and a key's digit ends its cycle",
    page: SYM, seed: { text: "", max: 13 }, press: [K.dot, K.one, K.one, K.one, K.one],
    expect: { text: ".1" },
  },
  {
    id: "F6", panel: "us-portrait", what: "a full line refuses a sign",
    page: SYM, seed: { text: "abcdef", max: 6 }, press: [K.three],
    expect: { text: "abcdef" },
  },
];

/**
 * The caret on the keypad: while the same key can still change the character at
 * the end, there is no caret, and nothing blinks; the window's end makes the character final, and the caret comes
 * after it and blinks.
 */
export const caretScenarios = [
  {
    id: "E1", what: "while the key can still change the character, the field shows no caret",
    page: PAD, seed: { text: "Sof", max: 13 }, press: [K.two],
    expect: { text: "Sofa", shown: "Sofa" },
  },
  {
    id: "E2", what: "cycling keeps it off",
    page: PAD, seed: { text: "", max: 13 }, press: [K.two, K.two],
    expect: { text: "b", shown: "b" },
  },
  {
    id: "E3", what: "the blink does not bring it back while the window is open",
    page: PAD, seed: { text: "Sof", max: 13 }, press: [K.two], advance: 600,
    expect: { shown: "Sofa" },
  },
  {
    id: "E4", what: "when the window closes, the character is final and the caret comes after it",
    page: PAD, seed: { text: "Sof", max: 13 }, press: [K.two], advance: TAP_MS + 10,
    expect: { text: "Sofa", shown: "Sofa|" },
  },
  {
    id: "E5", what: "and from then it blinks",
    page: PAD, seed: { text: "Sof", max: 13 }, press: [K.two], advance: TAP_MS + 510,
    expect: { shown: "Sofa" },
  },
  {
    id: "E6", what: "backspace closes the window, and the caret is back at once",
    page: PAD, seed: { text: "Sof", max: 13 }, press: [K.two, K.del],
    expect: { text: "Sof", shown: "Sof|" },
  },
];

/** What presses the QWERTY, or crosses to it, or goes by the symbols' 123, or presses the symbols' QWERTY: the EU's alone since the US has
 * neither (its signs are a keypad). */
const QWERTY_ONLY = new Set(["B16", "C2", "C3", "C4", "C5", "C6", "C8", "S11"]);

export const scenarios = [...boardScenarios, ...padScenarios, ...symbolScenarios, ...slidingScenarios, ...portraitScenarios, ...symbolPadScenarios, ...caretScenarios]
  .map((s) => s.panel === undefined && (s.page === BOARD || QWERTY_ONLY.has(s.id)) ? { ...s, panel: "eu-landscape" } : s);
