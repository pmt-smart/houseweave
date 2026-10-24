// Writer for the Nextion Editor's `.HMI` project format — the inverse of
// hmi.ts, and the core of path D1: build page blobs and
// component records by code, splice them into a project the Editor opens.
//
// Everything here round-trips byte for byte against the Editor's own
// output (test/hmiWrite.test.mjs): parse a fixture, re-encode every
// component record and every page blob, compare. That is the proof the
// encoder is exact; the Editor opening the result is the proof the
// container is (D1 scenarios).
//
// Scope of this first version: component records, page blobs, and
// replacing an existing page in an existing project. Adding pages or
// fonts touches main.HMI, whose CRC is still an open question (eseverson,
// format-hmi.md H5), so it is not attempted yet.
import {
  HMI_BACKUP_DIRECTORY, HMI_ENTRY_SIZE, HMI_PAGE_HEADER_SIZE, crc32Dwords, hmiPageCrc, readHmiDirectory,
  hmiLiveEntries, hmiBlob, readHmiPage, readHmiComponents, readHmiMain, hmiMainCrc,
  type HmiComponent, type HmiEvent, type HmiPage, type HmiEntry,
} from "./hmi.js";
import { HMI_TEMPLATES } from "./hmiTemplates.generated.js";

const enc = new TextEncoder();

function u32le(v: number): Uint8Array {
  return Uint8Array.of(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** A component to encode: attribute values in the Editor's order, plus event handlers. */
import { checkAttributeRanges } from "./attrRanges.js";
import { checkPageRam, countProgramInts, globalsRamCost, type RamComponent } from "./ramBudget.js";
import { SCREEN, checkComponentCount, checkOnScreen, checkPageCount, checkResourceRefs, projectResourceCounts, type ResourceCounts } from "./projectLimits.js";
import { tftNameHash } from "./nameHash.js";
import { FLAG_ENCODED, decodePicture, encodePicture, encodePictureRaw } from "./pictureCodec.js";

export interface ComponentSpec {
  attributes: { name: string; value: Uint8Array }[];
  events: HmiEvent[];
}

/** One attribute record: typebyte 0x10 + width, 3 zero bytes, 8-byte name, 8 zero bytes, value. */
export function encodeAttribute(name: string, value: Uint8Array): Uint8Array {
  if (value.length > 0xef) throw new RangeError(`attribute ${name}: width ${value.length} out of range`);
  const nameBytes = enc.encode(name);
  if (nameBytes.length > 8) throw new RangeError(`attribute name "${name}" longer than 8 bytes`);
  const out = new Uint8Array(20 + value.length);
  out[0] = 0x10 + value.length;
  out.set(nameBytes, 4);
  out.set(value, 20);
  return out;
}

/** The "att-NN" header + NN attribute records + event blocks + terminator. */
export function encodeComponentRecord(spec: ComponentSpec): Uint8Array {
  const header = enc.encode(`att-${spec.attributes.length}`);
  const parts: Uint8Array[] = [u32le(header.length), header];
  for (const a of spec.attributes) parts.push(encodeAttribute(a.name, a.value));
  for (const ev of spec.events) {
    const label = enc.encode(`codes${ev.event}-${ev.lines.length}`);
    parts.push(u32le(label.length), label);
    ev.lines.forEach((line, i) => {
      // lines read from a project keep their original bytes; new lines are UTF-8
      const bytes = ev.rawLines?.[i] ?? enc.encode(line);
      parts.push(u32le(bytes.length), bytes);
    });
  }
  parts.push(u32le(0));
  return concat(parts);
}

/** Re-encodes a parsed component exactly as it was read (attributes and handlers in order). */
export function componentToSpec(c: HmiComponent): ComponentSpec {
  return {
    attributes: c.attributes.map((a) => ({ name: a.name, value: Uint8Array.from(a.value) })),
    events: c.events.map((e) => ({ event: e.event, lines: [...e.lines], rawLines: e.rawLines?.map((r) => Uint8Array.from(r)) })),
  };
}

/** Header fields the page blob needs besides what the records imply. */
export interface PageHeaderSpec {
  name: string;
  lockpassword?: number;
  pagelock?: number;
  pagelei?: number;
  upver: [number, number, number];
  /** the reserved header dwords at +0x2c/+0x30/+0x34; copied from a template page */
  reserved?: [number, number, number];
  res1?: number;
}

/**
 * A page blob: 0x38-byte header, one 12-byte content row per record
 * (offsets relative to the row table, i.e. to 0x38), the records, and the
 * chained CRC in the first dword. `records[0]` must be the page's own
 * record (type 121).
 */
export function encodePageBlob(header: PageHeaderSpec, records: Uint8Array[]): Uint8Array {
  const n = records.length;
  const rows = new Uint8Array(12 * n);
  let rel = 12 * n;
  for (let i = 0; i < n; i++) {
    rows.set(u32le(rel), i * 12);
    rows.set(u32le(records[i].length), i * 12 + 4);
    rel += records[i].length;
  }
  const body = concat(records);
  const total = HMI_PAGE_HEADER_SIZE + rows.length + body.length;
  const blob = new Uint8Array(total);
  const view = new DataView(blob.buffer);
  view.setUint32(4, total, true);
  view.setUint32(8, HMI_PAGE_HEADER_SIZE, true);
  view.setUint32(0x0c, n, true);
  view.setUint32(0x10, header.lockpassword ?? 0, true);
  blob[0x14] = header.pagelock ?? 0;
  blob[0x15] = 0x4f;
  blob[0x16] = 0x21;
  blob[0x17] = header.pagelei ?? 0;
  const nameBytes = enc.encode(header.name);
  if (nameBytes.length > 16) throw new RangeError(`page name "${header.name}" longer than 16 bytes`);
  blob.set(nameBytes, 0x18);
  blob[0x28] = header.upver[0];
  blob[0x29] = header.upver[1];
  blob[0x2a] = header.upver[2];
  blob[0x2b] = header.res1 ?? 0;
  const reserved = header.reserved ?? [0, 0, 0];
  view.setUint32(0x2c, reserved[0], true);
  view.setUint32(0x30, reserved[1], true);
  view.setUint32(0x34, reserved[2], true);
  blob.set(rows, HMI_PAGE_HEADER_SIZE);
  blob.set(body, HMI_PAGE_HEADER_SIZE + rows.length);
  view.setUint32(0, hmiPageCrc(blob), true);
  return blob;
}

/** The header spec of an existing page blob, for re-encoding it. */
export function pageHeaderSpec(blob: Uint8Array, page: HmiPage): PageHeaderSpec {
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  return {
    name: page.name,
    lockpassword: page.lockpassword,
    pagelock: page.pagelock,
    pagelei: page.pagelei,
    upver: page.upver,
    res1: blob[0x2b],
    reserved: [view.getUint32(0x2c, true), view.getUint32(0x30, true), view.getUint32(0x34, true)],
  };
}

/**
 * Replaces the blob of one live directory entry: the new blob is appended
 * at the end of the file (the Editor's own append-only habit), the entry
 * points at it, the backup directory mirrors the primary, and the
 * directory checksum is recomputed. Returns a new file.
 */
export function replaceHmiEntry(file: Uint8Array, entryName: string, blob: Uint8Array): Uint8Array {
  const dir = readHmiDirectory(file);
  const entry = dir.entries.find((e) => e.name === entryName && !e.deleted);
  if (!entry) throw new Error(`no live entry "${entryName}"`);
  const out = new Uint8Array(file.length + blob.length);
  out.set(file, 0);
  out.set(blob, file.length);
  const o = 4 + entry.index * HMI_ENTRY_SIZE;
  const view = new DataView(out.buffer);
  view.setUint32(o + 0x10, file.length, true);
  view.setUint32(o + 0x14, blob.length, true);
  // pages and Program.s carry size >> 8/16/24 in the three tail bytes
  if (/\.pa$|^Program\.s$/.test(entryName)) {
    out[o + 0x19] = (blob.length >>> 8) & 0xff;
    out[o + 0x1a] = (blob.length >>> 16) & 0xff;
    out[o + 0x1b] = (blob.length >>> 24) & 0xff;
  }
  const dirLen = 4 + dir.count * HMI_ENTRY_SIZE;
  const withSentinel = new Uint8Array(dirLen + 4);
  withSentinel.set(out.subarray(0, dirLen), 0);
  withSentinel.set([0x41, 0x44, 0x45, 0x43], dirLen);
  view.setUint32(dirLen, crc32Dwords(withSentinel, 0xffffffff), true);
  out.set(out.subarray(0, dirLen + 4), HMI_BACKUP_DIRECTORY);
  return out;
}

// ---------------------------------------------------------------------------
// Composition: new components from the Editor's own templates
// ---------------------------------------------------------------------------
//
// Proof that this is what the Editor does (test/hmiWrite.test.mjs): taking
// fixture 06's main page and appending the Hotspot record of fixture 07
// rebuilds 07's page blob byte for byte, and 06 -> 07 differ in nothing
// else (main.HMI and Program.s untouched). So adding a component is: one
// more record at the end of the page, id = row index, page CRC recomputed.

/** A value for one attribute: number (little-endian, template width), string (resized), or raw bytes. */
export type HmiAttrValue = number | string | Uint8Array;

/** What a new component needs; everything else comes from the type's template. */
export interface NewComponentSpec {
  /** component type: `KNOWN_LEI` number or template name ("Text", "Hotspot", ...) */
  type: number | string;
  objname: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** per-attribute overrides by Editor name ("txt", "pco", "font", ...) */
  attributes?: Record<string, HmiAttrValue>;
  /** event handlers; slots missing here stay empty ("codesdown-0") */
  events?: HmiEvent[];
}

/** Attributes whose width is the string length (the Editor resizes them). */
const STRING_ATTRIBUTES = new Set(["objname", "txt", "path", "dir"]);

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function leBytes(v: number, width: number): Uint8Array {
  // the Editor stores signed attributes (val of a Number, an int of Program.s)
  // as two's complement in their width; -1 in 4 bytes is ff ff ff ff
  if (v < 0) v += 2 ** (8 * width);
  if (!Number.isInteger(v) || v < 0 || v >= 2 ** (8 * width)) throw new RangeError(`value ${v} does not fit ${width} byte(s)`);
  const out = new Uint8Array(width);
  for (let i = 0; i < width; i++) out[i] = Math.floor(v / 2 ** (8 * i)) & 0xff;
  return out;
}

function leNumber(bytes: Uint8Array): number {
  let r = 0;
  for (let i = bytes.length - 1; i >= 0; i--) r = r * 256 + bytes[i];
  return r;
}

/**
 * The project's `encode` byte, which decides how a `txt` is turned into bytes:
 * **3 is ISO-8859-1 and 24 is UTF-8** (main.HMI +0x0d; every eseverson fixture
 * is 3, the joBr99 production project is 24).
 *
 * It is not decoration. The bytes of `txt` reach the panel verbatim -- the
 * Editor does not re-encode them at compile time -- and the firmware indexes
 * the font by byte. Measured on the Editor's debugger (d1-09, `over`): a
 * macron written as its two UTF-8 bytes into an `encode` 3 project rendered as
 * the two ISO-8859-1 glyphs those bytes name, `Â` and `¯`, matching a
 * rasterization of "Â¯_Â¯_Â¯_Â¯_" with correlation 0.92 while the character
 * asked for correlates with nothing. Before this the writer encoded every
 * string as UTF-8 regardless, so "Café" would have reached the glass as
 * "CafÃ©" on exactly the projects our scenarios are built from.
 *
 * Set by the caller before building, the way `LENIENT` is. It defaults to 24
 * because that is what a project of ours will be: a UTF-8 font is the only way
 * to reach the icons in the private use area.
 */
export const PROJECT_TEXT = { encode: 24 };

/**
 * A component string as the bytes the project stores. Throws rather than
 * substituting: a character with no place in the project's code page would
 * otherwise reach the panel as a different letter, or as two.
 */
export function encodeHmiText(text: string): Uint8Array {
  if (PROJECT_TEXT.encode !== 3) return enc.encode(text);
  const out = new Uint8Array(text.length);
  let i = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp > 0xff)
      throw new RangeError(`text "${text}": U+${cp.toString(16).toUpperCase()} has no ISO-8859-1 byte, and this project is encode 3`);
    out[i++] = cp;
  }
  return out.subarray(0, i);
}

function encodeValue(name: string, width: number, value: HmiAttrValue): Uint8Array {
  if (value instanceof Uint8Array) {
    if (!STRING_ATTRIBUTES.has(name) && value.length !== width) throw new RangeError(`attribute ${name}: expected ${width} byte(s), got ${value.length}`);
    return Uint8Array.from(value);
  }
  if (typeof value === "string") {
    if (!STRING_ATTRIBUTES.has(name)) throw new TypeError(`attribute ${name} is numeric; got a string`);
    return encodeHmiText(value); // an empty string is typebyte 0x10, width 0 (the Editor writes blank txt that way)
  }
  return leBytes(value, width);
}

/** The template for a type, by `KNOWN_LEI` number or by name (case-insensitive). */
export function hmiTemplate(type: number | string) {
  const t = typeof type === "number"
    ? HMI_TEMPLATES[String(type)]
    : Object.values(HMI_TEMPLATES).find((x) => x.name.toLowerCase() === type.toLowerCase());
  if (!t) throw new Error(`no HMI template for component type ${type}`);
  return t;
}

/**
 * Builds the record spec of a new component with the given id: template
 * defaults, then geometry (`endx`/`endy` derived), then explicit
 * overrides. Event slots follow the template; handlers given fill theirs.
 */
/**
 * The Editor's rules for a component or page name:
 * 1 to 14 bytes, and the first character is not a digit. Throws with the
 * Editor's own wording so the phase-1 validation reads like the Editor.
 */
/**
 * The names the Editor refuses to use as a system variable (m49). All ten the
 * campaign measured are refused, for a component AND for a page, in a dialog at
 * load time. Note `RED`: the Editor's colour constants are system variables too,
 * which is why a component cannot take their names.
 *
 * This is the measured list, not the Editor's whole table: a system variable
 * nobody put in front of it will still get through here.
 *
 * `sys0` is NOT on it, and that is the interesting case: it is refused, but with
 * a different error — `Global variable definition failed:Conflict with Component
 * name:page0.sys0` — because it collides with the `int sys0` the Editor's own
 * default `Program.s` declares. That is a collision rule, not a reserved word,
 * and `checkProgramNameClash` below computes it instead of enumerating it.
 */
const RESERVED_NAMES = new Map<string, string>([
  ...["dim", "dims", "baud", "bauds", "sleep", "delay", "bkcmd", "thsp", "sendxy", "RED"].map((n) => [n, `m49-sys-${n.toLowerCase()}`] as [string, string]),
  ...["wup", "usup", "ussp", "thup", "recmod", "spax", "crcval"].map((n) => [n, `m57-sys-${n}`] as [string, string]),
  // An ARRAY of system variables, and the first one the campaign never thought
  // to try: `eq0` through `eq9` are all refused, while `eq` and `eq10` open
  // fine (measured). A keyboard that names a key's border after the key
  // produces `eq0` for the "q" key, and the Editor refuses the whole project
  // with a bare "Illegal name" dialog naming nothing. Ten opens of the Editor to bisect,
  // because a dialog is all the answer there is.
  ...Array.from({ length: 10 }, (_, i) => [`eq${i}`, "z-eq-family"] as [string, string]),
]);

/**
 * The alphabet a name may use: letters, digits, `_`, and non-ASCII bytes
 * (accented names compile and hash correctly — m23-utf8, m41-name-accented).
 * Everything else the campaign tried is refused: `.`, `[`, `+`, `/` and a
 * leading `.` in a dialog at load, `$` and a space at compile time with
 * `Error:Invalid Variables` (m49).
 */
const NAME_ALPHABET = /^[A-Za-z0-9_\u0080-\uffff]+$/;

export function checkNextionName(name: string, what = "objname"): void {
  const bytes = enc.encode(name).length;
  if (LENIENT.on) return;
  if (bytes < 1 || bytes > 14) throw new RangeError(`${what} "${name}": Min Length 1 byte, Max Length 14 bytes (got ${bytes})`);
  if (/^[0-9]/.test(name)) throw new RangeError(`${what} "${name}": First character of a Name can not be number`);
  if (!NAME_ALPHABET.test(name)) throw new RangeError(`${what} "${name}": Illegal character in Name (letters, digits, _ and non-ASCII only; measured in m23-hyphen, m49-chr-*)`);
  const reservedIn = RESERVED_NAMES.get(name);
  if (reservedIn) throw new RangeError(`${what} "${name}": the Editor refuses to open a project with this name (a dialog at load, whose text the batch cannot read; measured in ${reservedIn})`);
}

/**
 * A component may not take the name of a `Program.s` global: the Editor answers
 * `Error:Global variable definition failed:Conflict with Component
 * name:page0.<name>` (m57-sys-sys0, where the collision is with the `int sys0`
 * of the Editor's own default Program.s). Computed from the project, not
 * enumerated — which is why `sys0` is absent from RESERVED_NAMES.
 *
 * The parser reads the form every measured `Program.s` uses: one declaration
 * statement per line, with line comments only. A declaration hidden inside a C
 * style block comment would be read as real, and two declarations separated by a
 * semicolon on one line would miss the second. No `Program.s` in the corpus uses
 * either form.
 */
/** Splits on LF and drops a trailing CR, without a regex literal. */
function splitLines(text: string): string[] {
  return text.split(String.fromCharCode(10)).map((l) => l.split(String.fromCharCode(13)).join(""));
}

export function checkProgramNameClash(objname: string, program: string, pageName = "page0"): void {
  if (LENIENT.on) return;
  for (const raw of splitLines(program)) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    const m = /^int\s+(.+)$/.exec(line);
    if (!m) continue;
    for (const decl of m[1].split(",")) {
      const name = decl.split("=")[0].trim();
      if (name === objname) throw new Error(`Global variable definition failed:Conflict with Component name:${pageName}.${objname}`);
    }
  }
}

export function buildComponent(spec: NewComponentSpec, id: number, resources?: ResourceCounts): ComponentSpec {
  checkNextionName(spec.objname);
  const t = hmiTemplate(spec.type);
  const defaults = new Map(t.attributes.map((a) => [a.name, fromHex(a.defaultHex)]));
  const has = (n: string) => defaults.has(n);
  const num = (n: string) => leNumber(defaults.get(n)!);
  const geometric = has("x");
  if (!geometric && [spec.x, spec.y, spec.w, spec.h].some((v) => v !== undefined)) throw new Error(`${t.name} has no geometry`);
  const overrides: Record<string, HmiAttrValue> = { id, objname: spec.objname, ...(spec.attributes ?? {}) };
  if (geometric) {
    const x = spec.x ?? num("x"), y = spec.y ?? num("y"), w = spec.w ?? num("w"), h = spec.h ?? num("h");
    // The Editor refuses a side below 2, in a dialog whose text the batch
    // cannot read (m21-one-by-one, m22-tiny); 2x2 compiles on all eight types
    // m44 tried. And everything has to fit
    // the screen: `Error:Page:page0 Fail:c1 Position Invalid.`, measured on both
    // sides for eight component types (m44) and for x, y and both overflows
    // (m21, m37-y-negative).
    if (!LENIENT.on) {
      if (w < 2 || h < 2) throw new RangeError(`${spec.objname}: width and height must be >= 2`);
      checkOnScreen(spec.objname, x, y, w, h);
    }
    Object.assign(overrides, { x, y, w, h, endx: x + w - 1, endy: y + h - 1 });
  }
  if (has("txt") && typeof overrides.txt === "string" && overrides.txt_maxl === undefined) {
    // Raising the capacity to fit the text is a convenience, but the raised
    // value is the one the Editor will judge: m20-qrcode-txt200 sets a 200-byte
    // txt with no txt_maxl and is refused with `qr0.txt_maxlOut of range`.
    overrides.txt_maxl = Math.max(num("txt_maxl"), encodeHmiText(overrides.txt).length);
  }
  for (const n of Object.keys(overrides)) if (!has(n)) throw new Error(`${t.name} has no attribute "${n}"`);
  if (!LENIENT.on) {
    // The Editor's own refusals, on the effective values: what
    // the caller set, over what the template already carries.
    const effective: Record<string, unknown> = {};
    for (const a of t.attributes) effective[a.name] = leNumber(defaults.get(a.name)!);
    // `overrides`, not `spec.attributes`: it carries the resolved geometry and
    // the txt_maxl the writer may have raised, which is what the Editor judges.
    Object.assign(effective, overrides);
    checkAttributeRanges(t.name, effective, spec.objname);
    checkTextFits(overrides, spec.objname);
    if (resources) checkResourceRefs(effective, resources, spec.objname);
  }
  const attributes = t.attributes.map((a) => ({
    name: a.name,
    value: a.name in overrides ? encodeValue(a.name, a.width, overrides[a.name]) : defaults.get(a.name)!,
  }));
  const given = new Map((spec.events ?? []).map((e) => [e.event, e.lines]));
  for (const e of given.keys()) if (!t.events.includes(e)) throw new Error(`${t.name} has no event "${e}" (has ${t.events.join(", ")})`);
  const events = t.events.map((event) => ({ event, lines: [...(given.get(event) ?? [])] }));
  return { attributes, events };
}

/** Changes to one existing component: attribute values and/or event handlers. */
/**
 * A `txt` longer than the declared `txt_maxl` is refused by the Editor, in a
 * dialog the batch cannot read: `page0.t1.txtThe length exceeds the maximum
 * value.`. `buildComponent` raises `txt_maxl` on its own
 * when the caller did not set one, so this only fires when both were given.
 */
function checkTextFits(values: Record<string, HmiAttrValue>, label: string): void {
  const txt = values.txt, maxl = values.txt_maxl;
  if (typeof txt !== "string" || typeof maxl !== "number") return;
  const len = encodeHmiText(txt).length;
  if (len > maxl) throw new RangeError(`${label}.txt is ${len} bytes but txt_maxl is ${maxl}: the length exceeds the maximum value`);
}

export interface ComponentChanges {
  attributes?: Record<string, HmiAttrValue>;
  events?: HmiEvent[];
}

/** A parsed component with changes applied, as a new spec (the component is not mutated). */
export function withChanges(c: HmiComponent, changes: ComponentChanges, resources?: ResourceCounts): ComponentSpec {
  const spec = componentToSpec(c);
  const attrs = changes.attributes ?? {};
  for (const [name, value] of Object.entries(attrs)) {
    const a = spec.attributes.find((x) => x.name === name);
    if (!a) throw new Error(`${c.objname} has no attribute "${name}"`);
    a.value = encodeValue(name, a.value.length, value);
    if (name === "txt" && typeof value === "string" && !("txt_maxl" in attrs)) {
      const m = spec.attributes.find((x) => x.name === "txt_maxl");
      const len = encodeHmiText(value).length;
      if (m && len > leNumber(m.value)) m.value = leBytes(len, m.value.length);
    }
  }
  if (["x", "y", "w", "h"].some((n) => n in attrs) && !("endx" in attrs)) {
    const get = (n: string) => leNumber(spec.attributes.find((x) => x.name === n)!.value);
    const set = (n: string, v: number) => { const a = spec.attributes.find((x) => x.name === n)!; a.value = leBytes(v, a.value.length); };
    set("endx", get("x") + get("w") - 1);
    set("endy", get("y") + get("h") - 1);
  }
  for (const ev of changes.events ?? []) {
    const slot = spec.events.find((x) => x.event === ev.event);
    if (!slot) throw new Error(`${c.objname} has no event "${ev.event}"`);
    slot.lines = [...ev.lines];
  }
  if (!LENIENT.on) {
    // an edit goes through the same rules as a creation: a rename through the
    // name rules, a move through the geometry ones, a changed font through the
    // resource one
    if (typeof attrs.objname === "string" && attrs.objname !== c.objname) checkNextionName(attrs.objname);
    const effective: Record<string, unknown> = {};
    for (const a of spec.attributes) effective[a.name] = leNumber(a.value);
    checkAttributeRanges(hmiTemplate(c.type).name, effective, c.objname);
    if (hmiTemplate(c.type).attributes.some((a) => a.name === "x")) {
      const g = (n: string) => leNumber(spec.attributes.find((x) => x.name === n)!.value);
      const w = g("w"), h = g("h");
      if (w < 2 || h < 2) throw new RangeError(`${c.objname}: width and height must be >= 2`);
      checkOnScreen(c.objname, g("x"), g("y"), w, h);
    }
    if (resources) checkResourceRefs(effective, resources, c.objname);
    // the same txt / txt_maxl rule as buildComponent, on the values that came
    // out of the edit: shrinking the capacity under an existing text is the
    // case the creation path cannot see
    const txt = spec.attributes.find((x) => x.name === "txt");
    const maxl = spec.attributes.find((x) => x.name === "txt_maxl");
    if (txt && maxl) {
      const len = txt.value.findIndex((b) => b === 0);
      checkTextFits({ txt: new TextDecoder().decode(txt.value.subarray(0, len < 0 ? txt.value.length : len)), txt_maxl: leNumber(maxl.value) }, c.objname);
    }
  }
  return spec;
}

/** Edits to one page: changes to existing components (by objname) and new ones appended. */
export interface PageEdit {
  changes?: Record<string, ComponentChanges>;
  add?: NewComponentSpec[];
}

/** The cost-bearing view of a component, for the RAM budget. */
function ramViewOfExisting(c: HmiComponent): RamComponent {
  const attributes: Record<string, unknown> = {};
  for (const a of c.attributes) if (["txt_maxl", "ch", "vscope", "sta"].includes(a.name)) attributes[a.name] = leNumber(a.value);
  return { type: hmiTemplate(c.type).name, attributes, w: c.w };
}

/**
 * Applies `edit` to a page blob and returns the new blob (header kept, CRC
 * recomputed). The RAM budget is NOT checked here: it depends on the whole
 * project, so `editHmiProject` checks it once the edits are in.
 */
export function editPageBlob(blob: Uint8Array, edit: PageEdit, resources?: ResourceCounts): Uint8Array {
  const page = readHmiPage(blob);
  const comps = readHmiComponents(blob);
  const pending = new Set(Object.keys(edit.changes ?? {}));
  const records = comps.map((c) => {
    const ch = edit.changes?.[c.objname];
    if (!ch) return encodeComponentRecord(componentToSpec(c));
    pending.delete(c.objname);
    return encodeComponentRecord(withChanges(c, ch, resources));
  });
  if (pending.size) throw new Error(`no component named ${[...pending].join(", ")} on page ${page.name}`);
  let nextId = comps.reduce((m, c) => Math.max(m, c.id), -1) + 1;
  // The Editor checks a page's names by HASH, not by text: its refusal is
  // `Error:Illegal name (CRC):page0:t1-t1`, and a pair of DIFFERENT names that
  // collide gets the same answer — measured with aaaaaaaa / gasukkwk.
  // Names of four BYTES or fewer cannot collide: the hash
  // is linear over GF(2) and 32 input bits map one to one onto 32 output bits.
  const taken = new Map<number, string>();
  for (const c of comps) taken.set(tftNameHash(c.objname), c.objname);
  for (const spec of edit.add ?? []) {
    if (!LENIENT.on) {
      const h = tftNameHash(spec.objname);
      const clash = taken.get(h);
      if (clash !== undefined) throw new Error(`Illegal name (CRC):${page.name}:${clash}-${spec.objname}${clash === spec.objname ? "" : " (different names, same hash)"}`);
      taken.set(h, spec.objname);
    }
    records.push(encodeComponentRecord(buildComponent(spec, nextId++, resources)));
  }
  if (!LENIENT.on) {
    // the page's own record is row 0, so the count is records - 1
    checkComponentCount(page.name, records.length - 1);
  }
  // A page's name lives in TWO places -- the 0x38-byte page header and the
  // page's own component record -- and renaming one without the other makes a
  // file the Editor refuses with `Error:Invalid Page ID:<name>`. It reads the
  // HEADER for its page list, so a record renamed on its own points every
  // `page <name>` at a page that, as far as the compiler is concerned, does not
  // exist. Measured on p1-living-room-eu-landscape: a project compiled with a
  // record renamed on its own fails on exactly this and nothing else.
  const header = pageHeaderSpec(blob, page);
  const renamed = readHmiComponents(encodePageBlob(header, records)).find((c) => c.type === 121);
  if (renamed && renamed.objname !== header.name) {
    if (!LENIENT.on) checkNextionName(renamed.objname, "page name");
    header.name = renamed.objname;
  }
  return encodePageBlob(header, records);
}

/** Applies page edits (keyed by entry name, e.g. "0.pa") to a whole project; returns the new file. */
/**
 * Lenient mode: skip every guard that mirrors a rule of the Editor's, so the
 * campaign can author projects it will refuse and measure the refusal instead
 * of assuming it. It turns off the name rules (length,
 * first character, alphabet, system variables, `Program.s` collision, hash
 * uniqueness), the geometry rules (side >= 2 and fitting the screen), the
 * attribute ranges, the txt/txt_maxl rule, the resource references, the
 * component and page ceilings and the RAM budget. Never on in normal use.
 */
export const LENIENT = { on: false };

/**
 * The size of the project's globals area, the `Global Memory` the compiler
 * prints: 4 bytes, plus 4 per `int` of `Program.s`, plus the full cost of every
 * component declared global anywhere in the project.
 *
 * The globals of a project are charged to EVERY page, so leaving the global
 * components out here does not merely misreport a number — it makes the budget
 * check pass pages the Editor refuses. Reproduces the `Global Memory` line of
 * all 600 reports that print one.
 */
/** The project's `Program.s` as text, or "" when it has none. */
export function programText(file: Uint8Array): string {
  const entry = hmiLiveEntries(readHmiDirectory(file)).get("Program.s");
  return entry ? new TextDecoder().decode(hmiBlob(file, entry)) : "";
}

export function projectGlobalsRam(file: Uint8Array): number {
  const live = hmiLiveEntries(readHmiDirectory(file));
  const program = programText(file);
  const globals: RamComponent[] = [];
  for (const [name, e] of live) {
    if (!name.endsWith(".pa")) continue;
    for (const c of readHmiComponents(hmiBlob(file, e))) {
      if (hmiTemplate(c.type).name === "Page") continue;
      const view = ramViewOfExisting(c);
      if (view.attributes?.vscope === 1) globals.push(view);
    }
  }
  return globalsRamCost(countProgramInts(program), globals);
}

export function editHmiProject(file: Uint8Array, edits: Record<string, PageEdit>): Uint8Array {
  let out = file;
  for (const [entryName, edit] of Object.entries(edits)) {
    const live = hmiLiveEntries(readHmiDirectory(out));
    const entry = live.get(entryName);
    if (!entry) throw new Error(`no live page "${entryName}" (have ${[...live.keys()].filter((n) => n.endsWith(".pa")).join(", ")})`);
    out = replaceHmiEntry(out, entryName, editPageBlob(hmiBlob(out, entry), edit, projectResourceCounts(out)));
  }
  if (!LENIENT.on) {
    const program = programText(out);
    for (const [entryName, edit] of Object.entries(edits)) {
      const e = hmiLiveEntries(readHmiDirectory(out)).get(entryName);
      const pageName = e ? readHmiPage(hmiBlob(out, e)).name : entryName;
      for (const spec of edit.add ?? []) checkProgramNameClash(spec.objname, program, pageName);
      for (const [objname, ch] of Object.entries(edit.changes ?? {})) {
        const renamed = ch.attributes?.objname;
        checkProgramNameClash(typeof renamed === "string" ? renamed : objname, program, pageName);
      }
    }
    checkProjectRam(out);
  }
  return out;
}

/**
 * Checks every page of a finished project against the panel's RAM budget.
 *
 * This has to be a project-level pass, not a per-page one: the globals area is
 * charged to EVERY page, and it grows with the `Program.s` and with any
 * component declared global — including one the same edit just added. Checking
 * a page while the edits are still going would read a globals area that is not
 * the one the compiler will see, and would miss the pages the edit did not
 * touch but whose budget it shrank.
 */
export function checkProjectRam(file: Uint8Array): void {
  const globals = projectGlobalsRam(file);
  for (const [name, entry] of hmiLiveEntries(readHmiDirectory(file))) {
    if (!name.endsWith(".pa")) continue;
    const blob = hmiBlob(file, entry);
    const page = readHmiPage(blob);
    const comps = readHmiComponents(blob)
      .filter((c) => hmiTemplate(c.type).name !== "Page")
      .map(ramViewOfExisting);
    checkPageRam(page.name, comps, globals);
  }
}

// ---------------------------------------------------------------------------
// Project-level composition: new pages, main.HMI, Program.s
// ---------------------------------------------------------------------------
//
// Proof (test/hmiAddPage.test.mjs): fixture 10 is fixture 11 minus the page
// "scratch" the Editor added; addHmiPage(10, "scratch") reproduces 11's
// `4.pa` and `main.HMI` blobs byte for byte. The Editor itself reuses
// tombstoned space and grows the directory in the middle; we append at
// the end of the file and of the directory, which is the same structure.

/** main.HMI re-encoded from an existing blob's 0x60-byte header with a new resource list; CRC recomputed. */
export function encodeHmiMain(template: Uint8Array, resources: { ext: string; name: string; flag?: number }[]): Uint8Array {
  const out = new Uint8Array(0x60 + 16 * resources.length);
  out.set(template.subarray(0, 0x60), 0);
  const view = new DataView(out.buffer);
  view.setUint32(0x18, 0x60, true);
  view.setUint32(0x1c, resources.length, true);
  resources.forEach((r, i) => {
    const ext = enc.encode(r.ext), name = enc.encode(r.name);
    if (ext.length > 7 || name.length > 8) throw new RangeError(`resource ${r.name}: ext longer than 7 or name longer than 8 bytes`);
    out.set(ext, 0x60 + i * 16);
    out[0x60 + i * 16 + 7] = r.flag ?? 0;
    out.set(name, 0x60 + i * 16 + 8);
  });
  view.setUint32(0, hmiMainCrc(out), true);
  return out;
}

function sealDirectory(out: Uint8Array, count: number): void {
  const dirLen = 4 + count * HMI_ENTRY_SIZE;
  const withSentinel = new Uint8Array(dirLen + 4);
  withSentinel.set(out.subarray(0, dirLen), 0);
  withSentinel.set([0x41, 0x44, 0x45, 0x43], dirLen);
  new DataView(out.buffer).setUint32(dirLen, crc32Dwords(withSentinel, 0xffffffff), true);
  out.set(out.subarray(0, dirLen + 4), HMI_BACKUP_DIRECTORY);
}

/**
 * Adds a new live directory entry pointing at `blob`, appended at the end
 * of the file; the entry goes after the last one, the checksum moves down
 * 28 bytes, the backup directory mirrors. The three tail bytes are left
 * zero: in the Editor's own files they vary between saves of identical
 * blobs (uninitialised memory), so nothing reads them.
 */
export function appendHmiEntry(file: Uint8Array, name: string, blob: Uint8Array): Uint8Array {
  const dir = readHmiDirectory(file);
  if (dir.entries.some((e) => e.name === name && !e.deleted)) throw new Error(`entry "${name}" already exists`);
  const nameBytes = enc.encode(name);
  if (nameBytes.length > 16) throw new RangeError(`entry name "${name}" longer than 16 bytes`);
  if (4 + (dir.count + 1) * HMI_ENTRY_SIZE + 4 > HMI_BACKUP_DIRECTORY) throw new RangeError("directory full");
  const out = new Uint8Array(file.length + blob.length);
  out.set(file, 0);
  out.set(blob, file.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, dir.count + 1, true);
  const o = 4 + dir.count * HMI_ENTRY_SIZE;
  out.fill(0, o, o + HMI_ENTRY_SIZE);
  out.set(nameBytes, o);
  view.setUint32(o + 0x10, file.length, true);
  view.setUint32(o + 0x14, blob.length, true);
  sealDirectory(out, dir.count + 1);
  return out;
}

/** Options for a new page: attribute overrides for its Page record (bco, pic, ...) and event handlers. */
export interface NewPageSpec {
  name: string;
  attributes?: Record<string, HmiAttrValue>;
  events?: HmiEvent[];
}

/** Result of adding a page: the new project plus where the page landed. */
export interface AddPageResult {
  file: Uint8Array;
  /** directory entry, e.g. "4.pa" */
  entryName: string;
  /** compiled page index (position among the .pa resources of main.HMI) */
  pageIndex: number;
}

/**
 * Adds an empty page the way the Editor does: a fresh `N.pa` (N = lowest
 * unused page number) holding one Page record — white background, the
 * page's name as objname — and one more `pa` resource at the end of
 * main.HMI's list. Components go in afterwards with editHmiProject.
 */
export function addHmiPage(file: Uint8Array, spec: NewPageSpec): AddPageResult {
  checkNextionName(spec.name, "page");
  const live = hmiLiveEntries(readHmiDirectory(file));
  const mainEntry = live.get("main.HMI");
  if (!mainEntry) throw new Error("project has no main.HMI");
  const mainBlob = hmiBlob(file, mainEntry);
  const main = readHmiMain(mainBlob);
  const pages = main.resources.filter((r) => r.ext === "pa");
  if (!LENIENT.on) checkPageCount(pages.length + 1);
  for (const entry of pages) {
    const e = live.get(entry.name);
    if (!LENIENT.on && e && readHmiPage(hmiBlob(file, e)).name === spec.name) throw new Error(`page "${spec.name}" already exists`);
  }
  let n = 0;
  while (pages.some((r) => r.name === `${n}.pa`) || live.has(`${n}.pa`)) n++;
  const entryName = `${n}.pa`;
  const upver: [number, number, number] = [mainBlob[8], mainBlob[9], mainBlob[0x24]];
  // the page IS the screen, the way the project is turned: 480x320 in landscape,
  // 320x480 in portrait (`setScreenOrientation`), not the template's landscape default
  const record = buildComponent({ type: "Page", objname: spec.name, x: 0, y: 0, w: SCREEN.width, h: SCREEN.height, attributes: { bco: 0xffff, ...(spec.attributes ?? {}) }, events: spec.events }, 0, projectResourceCounts(file));
  const blob = encodePageBlob({ name: spec.name, upver }, [encodeComponentRecord(record)]);
  let out = appendHmiEntry(file, entryName, blob);
  out = replaceHmiEntry(out, "main.HMI", encodeHmiMain(mainBlob, [...main.resources, { ext: "pa", name: entryName }]));
  return { file: out, entryName, pageIndex: pages.length };
}

/**
 * Stamps the "saved by" version of the project (`upver` in main.HMI:
 * bytes 8, 9 and 0x24) and recomputes the CRC. The Editor converts a
 * project saved by an older build when it opens it, which leaves the
 * project dirty and makes "TFT file output" demand a Save As first —
 * that is what joBr99's 1.65.1 project does in the Editor 1.68.1.
 * Stamping the running build's version keeps the
 * unattended compile a straight line. Nothing else in the project
 * depends on this field.
 */
export function setHmiUpver(file: Uint8Array, upver: [number, number, number]): Uint8Array {
  const dir = readHmiDirectory(file);
  const entry = hmiLiveEntries(dir).get("main.HMI");
  if (!entry) throw new Error("no main.HMI entry");
  const blob = new Uint8Array(hmiBlob(file, entry));
  blob[8] = upver[0];
  blob[9] = upver[1];
  blob[0x24] = upver[2];
  return replaceHmiEntry(file, "main.HMI", encodeHmiMain(blob, readHmiMain(blob).resources));
}

/** Sets the project's `encode` byte (main.HMI +0x0d; 3 in the eseverson fixtures, 24 = UTF-8 in joBr99's). */
export function setHmiEncode(file: Uint8Array, encode: number): Uint8Array {
  const dir = readHmiDirectory(file);
  const entry = hmiLiveEntries(dir).get("main.HMI");
  if (!entry) throw new Error("no main.HMI entry");
  const blob = new Uint8Array(hmiBlob(file, entry));
  blob[0x0d] = encode & 0xff;
  return replaceHmiEntry(file, "main.HMI", encodeHmiMain(blob, readHmiMain(blob).resources));
}

/**
 * The project's screen orientation, at `main.HMI` +0x0C.
 *
 * Measured, not guessed: eseverson's `00_baseline_base` carries 1 and his
 * `01_orientation_flip_01` -- the same project with only that setting changed --
 * carries 3, and those two bytes plus the header CRC at +0x00 are the ONLY
 * difference between the files. joBr99's own EU project carries 3 as well.
 *
 * It matters more than it looks: 1 and 3 are both landscape, 180 degrees apart,
 * and the Nextion inside an NSPanel is mounted upside down. A project left at 1
 * compiles, passes every checksum, and draws every screen rotated half a turn on
 * the glass. The preflight is what catches it -- and it caught
 * exactly this on the first project we compiled from one of our own.
 *
 *   0 portrait   1 landscape   2 portrait 180   3 landscape 180
 *
 * The NSPanel EU wants 3, the US portrait unit 2 (`preflight.ts`).
 */
export function setHmiOrientation(file: Uint8Array, orientation: number): Uint8Array {
  if (!Number.isInteger(orientation) || orientation < 0 || orientation > 3)
    throw new RangeError(`orientation ${orientation}: 0..3 (0 portrait, 1 landscape, 2 portrait 180, 3 landscape 180)`);
  const entry = hmiLiveEntries(readHmiDirectory(file)).get("main.HMI");
  if (!entry) throw new Error("no main.HMI entry");
  const blob = new Uint8Array(hmiBlob(file, entry));
  blob[0x0c] = orientation;
  return replaceHmiEntry(file, "main.HMI", encodeHmiMain(blob, readHmiMain(blob).resources));
}

/** Program.s is plain ASCII with no header or CRC; this replaces it. */
export function setHmiProgram(file: Uint8Array, text: string): Uint8Array {
  // NOTE: the RAM budget is re-checked at the end, because every int declared
  // here grows the globals area and that is charged to EVERY page.
  // the collision can be created from this side too: declaring an int that a
  // component already answers to (m57-sys-sys0)
  if (!LENIENT.on) {
    for (const [name, entry] of hmiLiveEntries(readHmiDirectory(file))) {
      if (!name.endsWith(".pa")) continue;
      const blob = hmiBlob(file, entry);
      const pageName = readHmiPage(blob).name;
      for (const c of readHmiComponents(blob)) {
        if (hmiTemplate(c.type).name === "Page") continue;
        checkProgramNameClash(c.objname, text, pageName);
      }
    }
  }
  const out = replaceHmiEntry(file, "Program.s", enc.encode(text));
  if (!LENIENT.on) checkProjectRam(out);
  return out;
}

// ---------------------------------------------------------------------------
// Assets: fonts (.zi) and pictures (.i / .is / .ib)
// ---------------------------------------------------------------------------
//
// Measured on fixtures 00/15/17:
// - `N.zi` is the Nextion font file verbatim (magic 04 ff 00 0a).
// - A picture is three entries with a common 24-byte header:
//     +0  0a 64 01 <kind>   kind 3 = raw RGB565 (.i), 1 = PNG (.is, .ib)
//     +4  u32 0
//     +8  u32 dataOffset     0x18 for raw, 0x1b for PNG ("png" tag first)
//     +c  u16 w, u16 h
//     +10 u32 size           bytes from dataOffset to the end
//     +14 u32 0
//   .i  = header + 20 zero bytes + w*h*2 bytes of RGB565 (little-endian);
//         the compiler copies .i[0x18:] into the .tft picture region as is
//   .is = header + "png" + PNG of the picture at its component size
//   .ib = header + "png" + PNG of the original import (any size)
// - main.HMI lists pictures first (`i`), then fonts (`zi`), then pages.
// The Editor numbers fonts and pictures by their position in that list.

const PICTURE_MAGIC = [0x0a, 0x64, 0x01];
/** the `.i` entry: pixels, raw or run-encoded -- the codec flag inside says which */
const PICTURE_PIXELS = 3;
const PICTURE_PNG = 1;

/** Decoded header of a picture entry. */
export interface HmiPictureBlob {
  kind: number;
  dataOffset: number;
  width: number;
  height: number;
  size: number;
  /** pixels (kind 3): RGB565 little-endian, decoded if the blob was run-encoded; png: the PNG file */
  payload: Uint8Array;
  /** how the entry stores it: the two pixel forms, or a PNG */
  storage: "raw" | "encoded" | "png";
}

export function readHmiPictureBlob(blob: Uint8Array): HmiPictureBlob {
  if (blob[0] !== 0x0a || blob[1] !== 0x64 || blob[2] !== 0x01) throw new Error("not a picture blob");
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const kind = blob[3];
  const dataOffset = view.getUint32(8, true);
  const size = view.getUint32(0x10, true);
  const width = view.getUint16(0xc, true), height = view.getUint16(0xe, true);
  if (dataOffset + size !== blob.length) throw new Error(`picture blob: dataOffset ${dataOffset} + size ${size} != ${blob.length}`);
  if (kind !== PICTURE_PIXELS) return { kind, dataOffset, width, height, size, payload: blob.subarray(dataOffset), storage: "png" };
  // kind 3 covers both pixel forms; the codec flag inside the 20-byte header tells them apart
  const codec = blob.subarray(dataOffset);
  const storage = codec[0] === FLAG_ENCODED ? "encoded" : "raw";
  return { kind, dataOffset, width, height, size, payload: decodePicture(codec, width, height), storage };
}

function pictureHeader(kind: number, dataOffset: number, width: number, height: number, size: number): Uint8Array {
  const h = new Uint8Array(0x18);
  h.set(PICTURE_MAGIC, 0);
  h[3] = kind;
  const view = new DataView(h.buffer);
  view.setUint32(8, dataOffset, true);
  view.setUint16(0xc, width, true);
  view.setUint16(0xe, height, true);
  view.setUint32(0x10, size, true);
  return h;
}

/** The `.i` entry with the pixels stored raw: RGB565 little-endian, row-major. */
export function encodeRawPictureBlob(width: number, height: number, rgb565: Uint8Array): Uint8Array {
  const codec = encodePictureRaw(width, height, rgb565);
  return concat([pictureHeader(PICTURE_PIXELS, 0x18, width, height, codec.length), codec]);
}

/**
 * The `.i` entry in whichever pixel form is smaller -- the Editor's own codec
 * when the picture has runs to give it, raw when it does not (pictureCodec.ts).
 * The compiler copies this blob into the `.tft` untouched, so the choice made
 * here is the cost the panel pays.
 */
export function encodePictureBlob(width: number, height: number, rgb565: Uint8Array): { blob: Uint8Array; storage: "raw" | "encoded"; ratio: number } {
  const p = encodePicture(width, height, rgb565);
  return { blob: concat([pictureHeader(PICTURE_PIXELS, 0x18, width, height, p.blob.length), p.blob]), storage: p.storage, ratio: p.ratio };
}

/** The `.is` / `.ib` entries: a PNG file behind the header. */
export function encodePngPictureBlob(width: number, height: number, png: Uint8Array): Uint8Array {
  if (!(png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47)) throw new Error("not a PNG file");
  return concat([pictureHeader(PICTURE_PNG, 0x1b, width, height, png.length), enc.encode("png"), png]);
}

/** Inserts a resource keeping the Editor's grouping: pictures, fonts, pages. */
function insertResource(resources: { ext: string; name: string }[], entry: { ext: string; name: string }): { ext: string; name: string }[] {
  const rank = (ext: string) => (ext === "i" ? 0 : ext === "zi" ? 1 : 2);
  const out = [...resources];
  let at = out.length;
  for (let i = 0; i < out.length; i++) if (rank(out[i].ext) > rank(entry.ext)) { at = i; break; }
  out.splice(at, 0, entry);
  return out;
}

function lowestFree(live: Map<string, HmiEntry>, resources: { ext: string; name: string }[], ext: string): number {
  let n = 0;
  while (resources.some((r) => r.name === `${n}.${ext}`) || live.has(`${n}.${ext}`)) n++;
  return n;
}

export interface AddAssetResult {
  file: Uint8Array;
  entryName: string;
  /** the font or picture id the components refer to */
  id: number;
  /** pictures only: which pixel form won, and its size against raw */
  storage?: "raw" | "encoded";
  ratio?: number;
}

/** Adds a font: the `.zi` file as an entry plus a `zi` resource; id = its position among the fonts. */
export function addHmiFont(file: Uint8Array, zi: Uint8Array): AddAssetResult {
  if (!(zi[0] === 0x04 && zi[1] === 0xff && zi[2] === 0x00 && zi[3] === 0x0a)) throw new Error("not a .zi font file");
  const live = hmiLiveEntries(readHmiDirectory(file));
  const mainBlob = hmiBlob(file, live.get("main.HMI")!);
  const main = readHmiMain(mainBlob);
  const n = lowestFree(live, main.resources, "zi");
  const entryName = `${n}.zi`;
  const resources = insertResource(main.resources, { ext: "zi", name: entryName });
  let out = appendHmiEntry(file, entryName, zi);
  out = replaceHmiEntry(out, "main.HMI", encodeHmiMain(mainBlob, resources));
  return { file: out, entryName, id: resources.filter((r) => r.ext === "zi").findIndex((r) => r.name === entryName) };
}

export interface NewPictureSpec {
  width: number;
  height: number;
  /** RGB565 little-endian, width*height*2 bytes */
  rgb565: Uint8Array;
  /** PNG of the same picture (goes to .is) */
  png: Uint8Array;
  /** the original import (goes to .ib); defaults to `png` at the same size */
  original?: { width: number; height: number; png: Uint8Array };
}

/** Adds a picture: `.i`, `.is`, `.ib` entries plus an `i` resource; id = its position among the pictures. */
export function addHmiPicture(file: Uint8Array, spec: NewPictureSpec): AddAssetResult {
  const live = hmiLiveEntries(readHmiDirectory(file));
  const mainBlob = hmiBlob(file, live.get("main.HMI")!);
  const main = readHmiMain(mainBlob);
  const n = lowestFree(live, main.resources, "i");
  const entryName = `${n}.i`;
  const original = spec.original ?? { width: spec.width, height: spec.height, png: spec.png };
  const pixels = encodePictureBlob(spec.width, spec.height, spec.rgb565);
  let out = appendHmiEntry(file, entryName, pixels.blob);
  out = appendHmiEntry(out, `${n}.is`, encodePngPictureBlob(spec.width, spec.height, spec.png));
  out = appendHmiEntry(out, `${n}.ib`, encodePngPictureBlob(original.width, original.height, original.png));
  const resources = insertResource(main.resources, { ext: "i", name: entryName });
  out = replaceHmiEntry(out, "main.HMI", encodeHmiMain(mainBlob, resources));
  return { file: out, entryName, id: resources.filter((r) => r.ext === "i").findIndex((r) => r.name === entryName), storage: pixels.storage, ratio: pixels.ratio };
}
