// Pre-flight validation of a .tft before it is ever offered to a panel.
//
// The panel's own gates, in the order they fire, are what this file
// mirrors locally (sources: Nextion Upload Protocol v1.2, nxt-doc, and
// the failure reports collected on the bench):
//
//   1. model gate      — "Model does not match": rejected BEFORE writing,
//                        the installed TFT survives.
//   2. integrity gate  — "Data Error" at the end of the transfer: the
//                        file did not arrive intact, or was compiled by
//                        an Editor too old for the panel's flash IC
//                        (< 1.63.3 on units made since mid-2021).
//   3. incomplete      — "System data ERROR!" if the upload stops midway.
//
// What none of those gates catch is a structurally valid file that is
// wrong INSIDE — the case that has left at least one NSPanel refusing
// every further upload until it was reflashed over its test points.
// So beyond mirroring the gates, the checks below also assert the
// things a correct file always has in the 32-file corpus: header2 that
// decrypts into plausible tables, an object table that lies after the
// resource region, and component geometry that is self-consistent.
//
// Everything here is read-only and needs no hardware.

import {
  RESOURCE_REGION_START,
  checkDataRegionChecksum,
  checkHeader1Crc,
  checkTailChecksum,
  header1Fields,
  header2Fields,
  strdataaddr,
} from "./tftFormat.js";
import { RECORD_SIZE, readComponentRecord } from "./component.js";

export interface PreflightExpectation {
  /** Model checksum / cipher seed the panel reports for (0x2E-0x31). */
  modelSeed: number;
  /** Logical resolution the project must declare (0x0C-0x0F). */
  width: number;
  height: number;
  /** 0x14 — see Header1Fields.orientation. */
  orientation: number;
  /**
   * 0x33 — see Header1Fields.variantFlag. Every production NSPanel .tft
   * has 0xFF here and every dev-board compile 0x00. Reported as a
   * WARNING, not a block: a 2023 forum report (unofficialnextion
   * /t/1999, Intelligent NX4827P043) shows a file compiled for the
   * `_011` entry loading fine on a `_011C` device once a transmission
   * bug was fixed — so at least on that series the letter is not a gate,
   * and we cannot tell from data alone whether it is one on the
   * Discovery. Either way the cost of being wrong is a rejected upload
   * (the panel refuses before writing), not damage.
   */
  variantFlag: number;
  vendor: string;
  /** Oldest Editor version known to be accepted by this hardware. */
  minEditor: readonly [major: number, minor: number];
  /**
   * The only serial rate the file may set (`baud=` or `bauds=`): the one the
   * ESP32 driver speaks (berry/nextion_driver.be). A file that sets another
   * leaves the display at that rate after every boot, where the ESP32 hears
   * garbage and cannot start another upload.
   */
  baud: number;
}

// The prototype: Sonoff NSPanel EU, NX4832F035_011C, landscape. Seed
// and flag read from three independent production files that are known
// to load on this exact hardware (joBr99 lui-release, Blackymas
// nspanel_eu, lovejoy777 Thermo_01); orientation 3 (270°) from all of
// them; Editor floor from Nextion's own "Data Error" FAQ.
export const NSPANEL_EU_LANDSCAPE: PreflightExpectation = {
  modelSeed: 0x1ce47603,
  width: 480,
  height: 320,
  orientation: 3,
  variantFlag: 0xff,
  vendor: "N",
  minEditor: [1, 63],
  baud: 115200,
};

// Production target: US model, portrait. Same seed and flag (same
// display module); orientation 2 (180°) in both joBr99's nspanel_US_P
// and Blackymas' nspanel_us. Not yet verified against a physical US
// unit.
export const NSPANEL_US_PORTRAIT: PreflightExpectation = {
  ...NSPANEL_EU_LANDSCAPE,
  orientation: 2,
};

export type PreflightSeverity = "block" | "warn";

export interface PreflightCheck {
  id: string;
  ok: boolean;
  severity: PreflightSeverity;
  detail: string;
}

export interface PreflightResult {
  /** True when no blocking check failed. Warnings do not clear this. */
  ok: boolean;
  checks: PreflightCheck[];
}

const hex = (n: number, width = 8) => "0x" + (n >>> 0).toString(16).padStart(width, "0");

export function preflightTft(file: Uint8Array, expect: PreflightExpectation): PreflightResult {
  const checks: PreflightCheck[] = [];
  const add = (id: string, ok: boolean, detail: string, severity: PreflightSeverity = "block") =>
    checks.push({ id, ok, severity, detail });

  // A file shorter than the resource region start cannot even hold the
  // headers the panel reads first; bail before indexing past the end.
  if (file.length < RESOURCE_REGION_START + 4) {
    add("length", false, `file is ${file.length} bytes; a .tft is at least ${RESOURCE_REGION_START + 4}`);
    return { ok: false, checks };
  }
  add("length", true, `${file.length} bytes`);

  const h1 = header1Fields(file);

  add("vendor", h1.vendor === expect.vendor, `header 0x03 is '${h1.vendor}', expected '${expect.vendor}'`);
  add(
    "editor-version",
    h1.editorMajor > expect.minEditor[0] ||
      (h1.editorMajor === expect.minEditor[0] && h1.editorMinor >= expect.minEditor[1]),
    `compiled by Editor ${h1.editorMajor}.${h1.editorMinor}; panel needs >= ${expect.minEditor[0]}.${expect.minEditor[1]} ("Data Error" otherwise)`,
  );
  add(
    "resolution",
    h1.width === expect.width && h1.height === expect.height,
    `${h1.width}x${h1.height}, expected ${expect.width}x${expect.height}`,
  );
  add("orientation", h1.orientation === expect.orientation, `${h1.orientation}, expected ${expect.orientation}`);
  add(
    "model-seed",
    h1.modelSeed === expect.modelSeed,
    `0x2E = ${hex(h1.modelSeed)}, expected ${hex(expect.modelSeed)} — mismatch means "Model does not match"`,
  );
  add(
    "variant-flag",
    h1.variantFlag === expect.variantFlag,
    `0x33 = ${hex(h1.variantFlag, 2)}, expected ${hex(expect.variantFlag, 2)} (0xFF in every production NSPanel file; 0x00 in dev-board compiles; meaning unconfirmed — see PreflightExpectation.variantFlag)`,
    "warn",
  );
  add("size-field", h1.fileSize === file.length, `0x3C says ${h1.fileSize}, file is ${file.length}`);
  add("crc-header1", checkHeader1Crc(file), "CRC over 0x00-0xC3 stored at 0xC4");
  add(
    "crc-resource-region",
    checkDataRegionChecksum(file),
    `checksum over [0x10000, 0x10000+${hex(h1.resourceRegionLength)}) stored at 0x44`,
  );
  add("crc-tail", checkTailChecksum(file), "masked CRC over the whole file stored in the last 4 bytes");
  add(
    "resource-region-aligned",
    h1.resourceRegionLength % 0x10000 === 0 && h1.resourceRegionLength > 0,
    `0x40 = ${hex(h1.resourceRegionLength)}; every real file is a multiple of 64 KB`,
    "warn",
  );

  // Header2 only decrypts meaningfully with the right seed; if the seed
  // check above failed these will fail too, which is the point — a file
  // for another model must not look plausible here.
  const h2 = header2Fields(file);
  const strdata = strdataaddr(file);
  add("h2-resourcesfileaddr", h2.resourcesfileaddr === RESOURCE_REGION_START, `header2 +0x10 = ${hex(h2.resourcesfileaddr)}, expected ${hex(RESOURCE_REGION_START)}`);
  add("h2-strdataaddr", h2.strdataaddr === strdata, `header2 +0x14 = ${hex(h2.strdataaddr)}, 0x10000 + field 0x40 = ${hex(strdata)}`);
  add("h2-pageqty", h2.pageqty >= 1 && h2.pageqty <= 255, `pageqty = ${h2.pageqty}`);
  add("h2-objqty", h2.objqty >= 1, `objqty = ${h2.objqty}`);

  const tableEnd = h2.objxinxiadd + h2.objqty * RECORD_SIZE;
  add(
    "objtable-after-resources",
    h2.objxinxiadd >= strdata,
    `objxinxi table at ${hex(h2.objxinxiadd)} must not start before strdataaddr ${hex(strdata)} — that region holds the display firmware`,
  );
  add(
    "objtable-inside-file",
    tableEnd <= file.length - 4,
    `objxinxi table ends at ${hex(tableEnd)}; file body ends at ${hex(file.length - 4)}`,
  );

  if (h2.objxinxiadd >= strdata && tableEnd <= file.length - 4) {
    let bad = 0;
    let pages = 0;
    for (let i = 0; i < h2.objqty; i++) {
      const rec = readComponentRecord(file, h2.objxinxiadd + i * RECORD_SIZE);
      if (rec.lei === 121) pages++;
      const derived = rec.endx === rec.x + rec.w - 1 && rec.endy === rec.y + rec.h - 1;
      // Per axis, against the SCREEN, not the panel. header1 always reports the
      // panel as 480x320; orientation 0 and 2 turn it on its side, so the screen
      // is 320 wide and 480 tall. Comparing both axes against the longer side,
      // as this did, let a component hang off the bottom of a landscape screen.
      // The 2-pixel minimum the Editor enforces is NOT checked
      // here: an invisible record (Timer, Vari) is legitimately 1x1 once compiled.
      const portrait = h1.orientation === 0 || h1.orientation === 2;
      const screenW = portrait ? Math.min(h1.width, h1.height) : Math.max(h1.width, h1.height);
      const screenH = portrait ? Math.max(h1.width, h1.height) : Math.min(h1.width, h1.height);
      const inside = rec.w > 0 && rec.h > 0 && rec.x >= 0 && rec.y >= 0 && rec.x + rec.w <= screenW && rec.y + rec.h <= screenH;
      if (!derived || !inside) bad++;
    }
    add("component-geometry", bad === 0, `${h2.objqty - bad}/${h2.objqty} records have endx/endy = x+w-1/y+h-1 and lie inside the panel`);
    add("page-records", pages === h2.pageqty, `${pages} Page records (lei 121) for pageqty ${h2.pageqty}`, "warn");

    // The rate the display will speak after the upload. The Editor's default
    // Program.s says baud=9600, and a file that keeps it leaves the display deaf
    // to the ESP32 at every boot, with no upload able to reach it again.
    const rates = serialRateAssignments(file);
    const wrong = rates.filter((r) => r.rate !== expect.baud);
    add(
      "serial-rate",
      wrong.length === 0,
      rates.length === 0
        ? "sets no serial rate: the display keeps the one it has"
        : `${rates.map((r) => `${r.name}=${r.rate ?? "<expression>"}`).join(", ")}; the ESP32 speaks ${expect.baud} only`,
    );
  }

  return { ok: checks.every((c) => c.ok || c.severity === "warn"), checks };
}

export interface SerialRateAssignment {
  name: "baud" | "bauds";
  /** The rate, when the code sets a literal; null for an expression. */
  rate: number | null;
  /** Where in the file the assignment is compiled. */
  at: number;
}

/**
 * Every `baud=` and `bauds=` the file's code sets, Program.s included. Compiled,
 * an assignment is the system variable's token (04, the variable's id, 1A 04 for
 * baud and 0A 08 for bauds, then 00 00), '=' and, for a literal, 03 and a u32:
 * the Editor's default `baud=9600` is `04 04 1a 00 00 3d 03 80 25 00 00`. Read in
 * the code region, between strdataaddr and the object table, on the 32-file
 * corpus: joBr99's and Blackymas's NSPanel files set bauds=115200, eseverson's
 * dev-board compiles baud=9600, lovejoy777's none.
 */
export function serialRateAssignments(file: Uint8Array): SerialRateAssignment[] {
  const h2 = header2Fields(file);
  const from = h2.strdataaddr;
  const to = Math.min(h2.objxinxiadd, file.length - 4);
  const tokens: Array<[SerialRateAssignment["name"], readonly number[]]> = [
    ["baud", [0x04, 0x04, 0x1a, 0x00, 0x00]],
    ["bauds", [0x04, 0x08, 0x0a, 0x00, 0x00]],
  ];
  const out: SerialRateAssignment[] = [];
  for (let i = from; i + 7 <= to; i++) {
    for (const [name, token] of tokens) {
      if (file[i + 5] !== 0x3d || !token.every((b, k) => file[i + k] === b)) continue;
      const literal = file[i + 6] === 0x03 && i + 11 <= to;
      const rate = literal ? (file[i + 7] | (file[i + 8] << 8) | (file[i + 9] << 16) | (file[i + 10] << 24)) >>> 0 : null;
      out.push({ name, rate, at: i });
    }
  }
  return out;
}

export interface RegionDiff {
  ok: boolean;
  /** Offset of the first differing byte below strdataaddr, if any. */
  firstDiff?: number;
  detail: string;
}

// Guard for patched files: a content or layout patch is only allowed to
// change bytes at or after strdataaddr (strings, tables) and the 4-byte
// tail checksum. Anything below that is fonts, pictures and the
// display's own firmware — a byte changed there by accident (a text
// search matching inside a font blob, say) would still reseal into a
// file every checksum accepts, and the panel would run it.
export function onlyTailChanged(original: Uint8Array, patched: Uint8Array): RegionDiff {
  if (original.length !== patched.length) {
    return { ok: false, detail: `length changed ${original.length} -> ${patched.length}; a same-length patch was expected` };
  }
  const limit = strdataaddr(original);
  if (strdataaddr(patched) !== limit) {
    return { ok: false, firstDiff: 0x40, detail: "resource region length (0x40) changed" };
  }
  for (let i = 0; i < limit; i++) {
    if (original[i] !== patched[i]) {
      return {
        ok: false,
        firstDiff: i,
        detail: `byte ${hex(i)} differs but lies below strdataaddr ${hex(limit)} (resource/firmware region)`,
      };
    }
  }
  return { ok: true, detail: `all bytes below ${hex(limit)} identical` };
}
