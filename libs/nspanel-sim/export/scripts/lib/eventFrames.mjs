// Every declared event's frame, found inside a compiled `.tft`: the check of
// scripts/verify-event-frames.mjs, and of the pre-flight's record
// (scripts/preflight-tft.mjs --record).
//
// The scenario verifier checks ATTRIBUTE values, and an event is not an
// attribute: it is bytecode in the object's code block. So a page could pass
// every check and still have no way of telling anyone it was touched -- which is
// exactly what the pages did until the frames were added, and nothing would have
// said so.
//
// The frame is a constant computed at build time (`layout/src/wire.ts`), so the
// check is the honest one: is it in the file, once per declared event.
//
// Looked for as HEX TEXT and not as bytes, which cost a wrong answer first: the
// Editor stores a `printh` with its operand as the literal source text -- the
// characters `55 BB 12 00 65 76 ...` -- and not as the bytes they denote. So the
// payload `ev,home,bCard1,tap` never appears in the file as ASCII, and searching
// for it says "absent" about something the debugger disassembles happily.
//
// A slider's report is different: its value is appended ON THE GLASS, so the
// frame's bytes exist only when the finger moves. For those (marked `value` in
// the manifest) the text to find is the payload PREFIX, `ev,<page>,<obj>,
// <gesture>,` -- the string literal the glass-side build starts from. Measured:
// the instructions around it (`covx`, `crcrest`, `prints`...) are
// compiled to bytecode and do not survive as text; the literal does, exactly
// once, like a frame.
import { printhFrame, touchPayload, valuePayloadPrefix } from "../../../layout/dist/wire.js";

/** Where `needle` occurs in `bytes`, as absolute offsets. */
function occurrences(bytes, needle) {
  const at = [];
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let k = 0; k < needle.length; k++) if (bytes[i + k] !== needle[k]) continue outer;
    at.push(i);
  }
  return at;
}

/**
 * Each event of the runtime manifest, with where its frame is in the `.tft`:
 * found once is right; none, or more than one, is not.
 */
export function eventFrames(tft, runtime) {
  return runtime.events.map((event) => {
    // the operand exactly as the Editor writes it, without the mnemonic -- or,
    // for a report that carries a value, the line that starts the glass-side
    // build of the frame (`vaSend.txt="ev,<page>,<obj>,<gesture>,"`): the frame's
    // bytes do not exist until the finger moves, so this is the text to find.
    // `text` is the keyboard's OK, and it is the same case as a slider's: the
    // payload ends in something the glass knows and the build does not, so what
    // survives as text is the prefix.
    const operand = event.value || event.text
      ? valuePayloadPrefix(event.page, event.objname, event.gesture)
      : printhFrame(touchPayload(event.page, event.objname, event.gesture)).slice("printh ".length);
    let at = occurrences(tft, [...operand].map((c) => c.charCodeAt(0)));
    // The screen's stamp is a text event whose text is known when the .tft is
    // built (panel.version): it goes out in one printh, like a tap,
    // and what survives is its prefix as the printh's hex text.
    if (at.length === 0 && (event.value || event.text)) {
      const hex = [...operand].map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")).join(" ");
      at = occurrences(tft, [...hex].map((c) => c.charCodeAt(0)));
    }
    return { event, at };
  });
}
