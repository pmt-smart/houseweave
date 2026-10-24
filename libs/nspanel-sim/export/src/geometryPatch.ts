// Repositioning a component of a compiled .tft by patch — the mechanism
// proven on the panel.
//
// A visible component's geometry lives in three places:
//   1. the u16 slot of its objxinxi record (x,y,w,h,endx,endy) — NOT what
//      the panel renders from (7b moved it alone: nothing changed);
//   2. one or two ASCII copies "x,y,w,h," inside the owning page's
//      compiled bytecode, each preceded by the marker 09 <len> 04|08 —
//      this is what the page reads when it loads (7b' moved them: the
//      component moved).
// The ASCII copies are length-prefixed, so a patch must keep the byte
// length of the string; the panel parses leading zeros as decimal (7d:
// "0,010,450,32," rendered at y=10), so any value that fits the original
// digit width of its field is reachable by zero-padding.
//
// Nothing here reseals the tail checksum: apply every edit to a file,
// then call sealTailChecksum() once (tftFormat.ts), as patchText.ts does.
import { header2Fields, objxinxiAddress } from "./tftFormat.js";
import {
  KNOWN_LEI, componentRecordOffset, readComponentRecord, writeComponentGeometry,
  type ComponentRecord,
} from "./component.js";

export interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageRange {
  /** page number in table order (0-based) */
  page: number;
  /** index of the Page record in the objxinxi table */
  pageRecord: number;
  /** absolute file offset where the page's bytecode starts */
  start: number;
  /** absolute file offset where it ends (next page's start, or the objxinxi table) */
  end: number;
  /** objxinxi indexes of the page's components (Page record excluded) */
  components: number[];
}

export interface GeometryStringHit {
  /** absolute file offset of the first character of "x,y,w,h," */
  offset: number;
  /** the three marker bytes before it, e.g. "09 0d 04" */
  marker: string;
  text: string;
}

/** Digit width of each field in the ASCII geometry string — the patch budget. */
export interface DigitBudget {
  x: number;
  y: number;
  w: number;
  h: number;
}

const enc = new TextEncoder();

/** Pages as bytecode ranges, in table order. */
export function pageRanges(file: Uint8Array): PageRange[] {
  const h2 = header2Fields(file);
  const base = objxinxiAddress(file);
  const sd = h2.strdataaddr;
  const pages: PageRange[] = [];
  for (let i = 0; i < h2.objqty; i++) {
    const r = readComponentRecord(file, componentRecordOffset(base, i));
    if (r.lei === KNOWN_LEI.Page) {
      pages.push({ page: pages.length, pageRecord: i, start: sd + r.bytecodeOffset, end: base, components: [] });
    } else if (pages.length) {
      pages[pages.length - 1].components.push(i);
    }
  }
  for (let p = 0; p + 1 < pages.length; p++) pages[p].end = pages[p + 1].start;
  return pages;
}

/** The page that owns a component record, or null for Page records / out of range. */
export function pageOfRecord(file: Uint8Array, recordIndex: number): PageRange | null {
  for (const p of pageRanges(file)) if (p.components.includes(recordIndex)) return p;
  return null;
}

export function geometryText(g: Geometry): string {
  return `${g.x},${g.y},${g.w},${g.h},`;
}

export function digitBudget(record: Geometry): DigitBudget {
  return { x: String(record.x).length, y: String(record.y).length, w: String(record.w).length, h: String(record.h).length };
}

/**
 * Formats a target geometry into the original field widths. Values with
 * fewer digits are zero-padded (the panel reads them as decimal, 7d);
 * values with more digits than the budget do not fit and throw.
 */
export function formatGeometry(target: Geometry, budget: DigitBudget): string {
  const fit = (name: keyof Geometry, value: number) => {
    if (!Number.isInteger(value) || value < 0) throw new RangeError(`${name}=${value} is not a non-negative integer`);
    const s = String(value);
    if (s.length > budget[name]) throw new RangeError(`${name}=${value} needs ${s.length} digits, the original field has ${budget[name]}`);
    return s.padStart(budget[name], "0");
  };
  return `${fit("x", target.x)},${fit("y", target.y)},${fit("w", target.w)},${fit("h", target.h)},`;
}

function findAll(file: Uint8Array, needle: Uint8Array, from: number, to: number): number[] {
  const hits: number[] = [];
  outer: for (let i = from; i + needle.length <= to; i++) {
    for (let j = 0; j < needle.length; j++) if (file[i + j] !== needle[j]) continue outer;
    hits.push(i);
  }
  return hits;
}

/** The ASCII copies of a component's geometry inside its page's bytecode. */
export function findGeometryStrings(file: Uint8Array, recordIndex: number): GeometryStringHit[] {
  const page = pageOfRecord(file, recordIndex);
  if (!page) return [];
  const rec = readComponentRecord(file, componentRecordOffset(objxinxiAddress(file), recordIndex));
  const text = geometryText(rec);
  return findAll(file, enc.encode(text), page.start, page.end).map((offset) => ({
    offset,
    marker: Array.from(file.subarray(offset - 3, offset)).map((b) => b.toString(16).padStart(2, "0")).join(" "),
    text,
  }));
}

/** Indexes of the records satisfying `predicate` (Page records included unless filtered). */
export function findRecords(file: Uint8Array, predicate: (record: ComponentRecord, index: number) => boolean): number[] {
  const h2 = header2Fields(file);
  const base = objxinxiAddress(file);
  const out: number[] = [];
  for (let i = 0; i < h2.objqty; i++) {
    if (predicate(readComponentRecord(file, componentRecordOffset(base, i)), i)) out.push(i);
  }
  return out;
}

export interface GeometryPatchResult {
  file: Uint8Array;
  recordIndex: number;
  from: Geometry;
  to: Geometry;
  /** absolute offset of the record's 12-byte geometry slot */
  slotOffset: number;
  /** the ASCII copies rewritten, with the text written into each */
  asciiCopies: { offset: number; marker: string; text: string }[];
  /** every byte offset this patch is allowed to have changed (for exact accounting) */
  touched: number[];
}

/**
 * Moves/resizes one component: rewrites the objxinxi slot AND every ASCII
 * copy in the page bytecode. Refuses when no ASCII copy exists (the record
 * is invisible, 1x1 Timer/Vari, or the file is not laid out like this) or
 * when the target does not fit the field widths. Returns an unsealed copy.
 */
export function patchComponentGeometry(file: Uint8Array, recordIndex: number, target: Geometry): GeometryPatchResult {
  const base = objxinxiAddress(file);
  const recordOffset = componentRecordOffset(base, recordIndex);
  const rec = readComponentRecord(file, recordOffset);
  if (rec.lei === KNOWN_LEI.Page) throw new Error(`record ${recordIndex} is a Page`);
  if (target.x < 0 || target.y < 0 || target.w < 1 || target.h < 1) throw new RangeError("geometry out of range");
  const hits = findGeometryStrings(file, recordIndex);
  if (hits.length === 0) throw new Error(`record ${recordIndex} has no ASCII geometry copy in its page bytecode -- nothing to move`);
  const newText = formatGeometry(target, digitBudget(rec));
  const newBytes = enc.encode(newText);

  const out = writeComponentGeometry(file, recordOffset, target);
  const touched: number[] = [];
  const slotOffset = recordOffset + 40;
  for (let i = 0; i < 12; i++) touched.push(slotOffset + i);
  const asciiCopies = hits.map((h) => {
    out.set(newBytes, h.offset);
    for (let j = 0; j < newBytes.length; j++) touched.push(h.offset + j);
    return { offset: h.offset, marker: h.marker, text: newText };
  });
  return {
    file: out,
    recordIndex,
    from: { x: rec.x, y: rec.y, w: rec.w, h: rec.h },
    to: { ...target },
    slotOffset,
    asciiCopies,
    touched,
  };
}
