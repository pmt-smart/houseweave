// Plano C's patch technique, formalized: a text component's literal
// string is stored as raw, unencrypted ASCII near the end of the file
// (found in practice by searching for the old string), with no other
// structure depending on its byte length as long as the replacement is
// the exact same length. Growing or shrinking the text shifts every
// table after it (page/component/string addresses in header2) and is
// out of scope here.
import { sealTailChecksum, strdataaddr } from "./tftFormat.js";

export class TextLengthMismatchError extends Error {
  constructor(oldText: string, newText: string) {
    super(
      `patchAsciiText: replacement must be the same byte length as the original ` +
        `(${JSON.stringify(oldText)} is ${oldText.length} bytes, ${JSON.stringify(newText)} is ${newText.length} bytes) — ` +
        `changing length requires regenerating the surrounding tables, not a byte patch.`,
    );
    this.name = "TextLengthMismatchError";
  }
}

function latin1Bytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, fromIndex: number): number {
  outer: for (let i = fromIndex; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

// Component text lives in the string/table area at or after
// strdataaddr (0x10000 + header field 0x40) — the search starts there,
// not at the end of the headers. Everything below strdataaddr is fonts,
// pictures and the display's own bootloader/firmware: a coincidental
// match inside that blob (an earlier version searched from 0x190 and
// allowed it) would have patched firmware bytes and then resealed the
// file into one every checksum accepts. Restricting the search to the
// region where text can legitimately be is what closes the risk of a
// match elsewhere; uniqueness inside that
// region is still not proof the match is the intended field, so callers
// should pass a value specific enough to appear once.
function searchStart(file: Uint8Array): number {
  return strdataaddr(file);
}

// Locates `oldText` (raw ASCII/Latin-1) in the file. Throws if it is
// missing or ambiguous (found more than once) — callers should pass an
// old value specific enough to be unique in the file.
export function findAsciiTextOffset(file: Uint8Array, oldText: string): number {
  const needle = latin1Bytes(oldText);
  const first = indexOfBytes(file, needle, searchStart(file));
  if (first === -1) {
    throw new Error(`findAsciiTextOffset: ${JSON.stringify(oldText)} not found in file`);
  }
  const second = indexOfBytes(file, needle, first + 1);
  if (second !== -1) {
    throw new Error(
      `findAsciiTextOffset: ${JSON.stringify(oldText)} appears more than once (at least at ${first} and ${second}) — pass a more specific value`,
    );
  }
  return first;
}

// Patches a component's raw text in place and reseals the tail checksum.
// `oldText` and `newText` must be the same byte length. Returns a new
// buffer; does not mutate `file`.
export function patchAsciiText(file: Uint8Array, oldText: string, newText: string): Uint8Array {
  if (oldText.length !== newText.length) {
    throw new TextLengthMismatchError(oldText, newText);
  }
  const offset = findAsciiTextOffset(file, oldText);
  const out = Uint8Array.from(file);
  out.set(latin1Bytes(newText), offset);
  return sealTailChecksum(out);
}
