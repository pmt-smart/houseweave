// Runs the local pre-flight (src/preflight.ts) on compiled .tft
// files: the panel's own gates, mirrored, plus what they do not cover. Prints
// every check, the size and the SHA-256, which is what a flash is judged by.
//
//   node scripts/preflight-tft.mjs hmi-scenarios/out/p1-living-room-eu-landscape.tft
//   node scripts/preflight-tft.mjs --all        # every p1-*.tft in hmi-scenarios/out
//   node scripts/preflight-tft.mjs --record hmi-scenarios/out/p1-living-room-eu-landscape.tft
//
// The expectation comes from the file's name: a portrait project is the US
// panel (orientation 2), a landscape one the EU (orientation 3). A project's
// file is also checked against what it was generated from, found by its name:
// every declared event's frame (scripts/lib/eventFrames.mjs, against
// hmi-scenarios/<name>.runtime.json) and every component's values
// (scripts/verify-hmi-scenario.mjs, against hmi-scenarios/out/<name>.expected.json).
// Exits 1 when any file fails a blocking check; warnings are printed and do not
// fail.
//
// `--record` writes the verdict beside each file, <name>.preflight.json, with the
// file's SHA-256, passing or not: the factory image takes a .tft only with a
// passing record of that very file (firmware/overrides/panel_files.py), and
// sandbox-compile.mjs records each project it compiles. A record passes only
// with the frames and the values checked, so a file whose project is not found
// by its name is recorded as failing. A file that passes is also packed, as the
// panel's file system keeps it (src/tftPack.ts): <name>.tftz, read
// back byte for byte before it is written, and named in the record with its
// SHA-256, which is the copy the image takes. A file that fails leaves no
// packed copy behind.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { NSPANEL_EU_LANDSCAPE, NSPANEL_US_PORTRAIT, packTft, preflightTft, unpackTft } from "../dist/index.js";
import { eventFrames } from "./lib/eventFrames.mjs";

const root = resolve(import.meta.dirname, "..");
const scenariosDir = join(root, "hmi-scenarios");
const outDir = join(scenariosDir, "out");
const args = process.argv.slice(2);
const record = args.includes("--record");
const verbose = args.includes("--verbose");
const files = args.includes("--all")
  ? readdirSync(outDir).filter((n) => /^p1-.*\.tft$/.test(n)).sort().map((n) => join(outDir, n))
  : args.filter((a) => !a.startsWith("--")).map((a) => resolve(a));
if (!files.length) { console.error("usage: preflight-tft.mjs [--record] [--verbose] <file.tft>... | --all"); process.exit(2); }

let failed = 0;
for (const file of files) {
  const name = basename(file);
  const project = name.replace(/\.tft$/i, "");
  const expect = /portrait/.test(name) ? NSPANEL_US_PORTRAIT : NSPANEL_EU_LANDSCAPE;
  const bytes = new Uint8Array(readFileSync(file));
  const sha = createHash("sha256").update(bytes).digest("hex");
  const r = preflightTft(bytes, expect);
  const blocking = r.checks.filter((c) => !c.ok && c.severity === "block");
  const warnings = r.checks.filter((c) => !c.ok && c.severity === "warn");
  console.log(`\n${name}: ${bytes.length} bytes, sha256 ${sha}`);
  console.log(`  ${r.checks.filter((c) => c.ok).length}/${r.checks.length} checks pass${warnings.length ? `, ${warnings.length} warning(s)` : ""}${blocking.length ? `, ${blocking.length} BLOCKING` : ""}`);
  for (const c of r.checks) if (!c.ok || verbose) console.log(`  ${c.ok ? "ok  " : c.severity === "block" ? "FAIL" : "warn"} ${c.id}: ${c.detail}`);

  // the frames: null when the project's runtime manifest is not there to say them
  const runtimeFile = join(scenariosDir, `${project}.runtime.json`);
  let frames = null;
  if (existsSync(runtimeFile)) {
    const found = eventFrames(bytes, JSON.parse(readFileSync(runtimeFile, "utf8")));
    const bad = found.filter((f) => f.at.length !== 1);
    frames = { events: found.length, bad: bad.length };
    console.log(`  ${found.length - bad.length} of ${found.length} event frames present, exactly once`);
    for (const { event, at } of bad)
      console.log(`  FAIL ${event.page}/${event.objname} ${event.gesture} -> ${event.event}: ${at.length === 0 ? "not in the .tft" : `${at.length} times`}`);
  } else {
    console.log(`  no ${basename(runtimeFile)} in hmi-scenarios: the event frames are not checked`);
  }

  // the values: null when the scenario's expectation is not there to say them
  const expectedFile = join(outDir, `${project}.expected.json`);
  let values = null;
  if (existsSync(expectedFile)) {
    const v = spawnSync(process.execPath, [join(root, "scripts", "verify-hmi-scenario.mjs"), expectedFile, file], { encoding: "utf8" });
    values = v.status === 0;
    console.log(`  the components' values ${values ? "match" : "DO NOT MATCH"} ${basename(expectedFile)}`);
    if (!values || verbose) process.stdout.write(v.stdout.trimEnd().split("\n").map((l) => "    " + l).join("\n") + "\n");
  } else {
    console.log(`  no ${basename(expectedFile)} in hmi-scenarios/out: the components' values are not checked`);
  }

  // what was checked has to pass; a record has to have checked everything
  const ok = r.ok && (frames === null ? !record : frames.bad === 0) && (values === null ? !record : values);
  if (record) {
    // the copy the panel's file system keeps, only of a file that passes
    const packedAt = join(dirname(file), `${project}.tftz`);
    let packed = null;
    rmSync(packedAt, { force: true });
    if (ok) {
      const p = packTft(bytes);
      const back = unpackTft(p);
      if (back.length !== bytes.length || back.some((v, i) => v !== bytes[i])) throw new Error(`${name}: the packed copy does not read back`);
      writeFileSync(packedAt, p);
      packed = { file: basename(packedAt), size: p.length, sha256: createHash("sha256").update(p).digest("hex") };
      console.log(`  packed for the panel's file system: ${basename(packedAt)}, ${p.length} bytes (${(100 * p.length / bytes.length).toFixed(1)}%)`);
    }
    const at = join(dirname(file), `${project}.preflight.json`);
    writeFileSync(at, JSON.stringify({
      file: name,
      size: bytes.length,
      sha256: sha,
      ok,
      checks: r.checks.length,
      blocking: blocking.map((c) => `${c.id}: ${c.detail}`),
      warnings: warnings.map((c) => `${c.id}: ${c.detail}`),
      frames,
      values,
      packed,
      at: new Date().toISOString(),
    }, null, 2) + "\n");
    console.log(`  recorded in ${basename(at)}: ${ok ? "passes" : "FAILS"}`);
  }
  if (!ok) failed++;
}
if (failed) { console.log(`\n${failed} file(s) fail the pre-flight`); process.exit(1); }
console.log(`\nall ${files.length} file(s) pass the pre-flight`);
