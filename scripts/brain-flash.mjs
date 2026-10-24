// What the brain costs in the app's flash, file by file.
//
//   node scripts/brain-flash.mjs            # per file, and the 25 biggest functions
//   node scripts/brain-flash.mjs --top 60   # more functions
//
// It reads the headers the last firmware build solidified, in
// firmware/tasmota/lib/libesp32/berry_custom/src/solidify/ (a build of a panel's
// env writes them; a bridge build writes the bridge's), and compiles each one
// with the firmware's own xtensa gcc at -Os: for the
// brain, the flash of an object is its .text, .rodata, .data and .literal. The
// strings live apart, in the firmware's constant string table, shared with
// Tasmota's: the brain's own are the ones nothing else in lib/libesp32 names,
// counted at 16 bytes of bcstring plus the characters and the NUL, an
// estimate. A function's weight is its bytecode, 4 bytes an instruction.
//
// The toolchain is found under PLATFORMIO_CORE_DIR, C:\pio by default, as
// scripts/build-firmware.ps1 sets it.
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lib = join(root, "firmware", "tasmota", "lib", "libesp32");
const solidify = join(lib, "berry_custom", "src", "solidify");
const core = process.env.PLATFORMIO_CORE_DIR || "C:\\pio";
const bin = join(core, "packages", "toolchain-xtensa-esp-elf", "bin");
const cc = join(bin, "xtensa-esp32-elf-gcc.exe");
const size = join(bin, "xtensa-esp32-elf-size.exe");
const topIndex = process.argv.indexOf("--top");
const TOP = topIndex > 0 ? Number(process.argv[topIndex + 1]) : 25;

const headers = readdirSync(solidify).filter((n) => /^solidified_.*\.h$/.test(n)).sort();
if (headers.length === 0) {
  console.error(`no solidified headers in ${solidify}: build a panel's env first`);
  process.exit(2);
}
const berry = join(lib, "berry");
const includes = [join(berry, "src"), join(berry, "default"), join(berry, "generate"), join(lib, "berry_tasmota", "src"), join(lib, "berry_mapping", "src")];
const work = mkdtempSync(join(tmpdir(), "brain-flash-"));
const STRING = /be_(?:kv_str|nested_str_weak|nested_str_long|nested_str|const_str_weak|str_weak|const_key_weak|const_key|str)\(([A-Za-z0-9_]*)\)/g;
const decode = (s) => s.replace(/_X([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

const rows = [];
const functions = [];
const brainStrings = new Map();
try {
  for (const h of headers) {
    const name = h.replace(/^solidified_/, "").replace(/\.h$/, "");
    const text = readFileSync(join(solidify, h), "utf8");
    let fn = null;
    let instructions = 0;
    for (const line of text.split("\n")) {
      const m = line.match(/Solidified function: (\S+)/);
      if (m) functions.push((fn = { file: name, name: m[1], instructions: 0 }));
      if (/^\s+0x[0-9A-F]{8},\s+\/\/\s+[0-9A-F]{4}\s+/.test(line)) {
        instructions++;
        if (fn) fn.instructions++;
      }
    }
    for (const m of text.matchAll(STRING)) if (!brainStrings.has(m[1])) brainStrings.set(m[1], name);
    const c = join(work, `${name}.c`);
    writeFileSync(c, `#include "be_constobj.h"\n#include "${join(solidify, h).replace(/\\/g, "/")}"\n`);
    const o = join(work, `${name}.o`);
    const run = spawnSync(cc, ["-Os", "-DTASMOTA", "-DESP32", "-w", "-c", ...includes.map((i) => `-I${i}`), "-o", o, c], { encoding: "utf8" });
    if (run.status !== 0) {
      console.error(`${h} did not compile:\n${(run.stderr || run.error?.message || "").slice(0, 600)}`);
      process.exit(1);
    }
    const sections = spawnSync(size, ["-A", o], { encoding: "utf8" }).stdout;
    let flash = 0;
    for (const line of sections.split("\n")) {
      const m = line.match(/^\.(text|rodata|data|literal)\S*\s+(\d+)/);
      if (m) flash += Number(m[2]);
    }
    rows.push({ name, flash, instructions });
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

// Strings the rest of the firmware names too are already in its table
const others = new Set();
(function walk(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (p === solidify) continue;
    if (statSync(p).isDirectory()) {
      if (!/^(generate|examples|tests)$/.test(n)) walk(p);
      continue;
    }
    if (!/\.(h|c|cpp)$/.test(n)) continue;
    const s = readFileSync(p, "utf8");
    for (const m of s.matchAll(STRING)) others.add(m[1]);
    for (const m of s.matchAll(/be_const_str_([A-Za-z0-9_]+)/g)) others.add(m[1]);
  }
})(lib);
let own = 0;
let ownBytes = 0;
for (const [s] of brainStrings) {
  if (others.has(s)) continue;
  own++;
  ownBytes += 16 + decode(s).length + 1;
}

rows.sort((a, b) => b.flash - a.flash);
const total = rows.reduce((s, r) => s + r.flash, 0);
const kb = (n) => (n / 1024).toFixed(1).padStart(6);
console.log("file".padEnd(30), "flash B".padStart(8), "   KB", "instructions".padStart(13));
for (const r of rows) if (r.flash > 0) console.log(r.name.padEnd(30), String(r.flash).padStart(8), kb(r.flash), String(r.instructions).padStart(13));
console.log("objects".padEnd(30), String(total).padStart(8), kb(total), String(rows.reduce((s, r) => s + r.instructions, 0)).padStart(13));
console.log(`strings: ${brainStrings.size} named, ${own} of them the brain's own, ~${kb(ownBytes).trim()} KB`);
console.log(`the brain: ~${kb(total + ownBytes).trim()} KB of the app's flash`);
console.log(`\nthe ${TOP} biggest functions, by bytecode:`);
functions.sort((a, b) => b.instructions - a.instructions);
for (const f of functions.slice(0, TOP)) console.log(String(f.instructions * 4).padStart(6), "B ", `${f.file}.${f.name}`);
