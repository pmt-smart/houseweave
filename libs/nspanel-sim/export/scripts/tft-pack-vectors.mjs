// The vectors berry/tft_pack.be is tested against (berry/test/test_tft_pack.be):
// files packed by src/tftPack.ts, each with the size and the SHA-256 of what it
// stands for, so the Berry decodes what this packer writes.
//
//   node scripts/tft-pack-vectors.mjs           # checks berry/test/vectors/tft_pack.json
//   node scripts/tft-pack-vectors.mjs --write   # writes it
//
// The cases are made here, deterministically, to reach every path of the
// decoder: a chunk kept as it is, runs (a match overlapping what it writes),
// a short period, ordinary text, literal counts and match lengths past 15 and
// past 270 (the extra bytes, one and two of them), and a last chunk shorter
// than the others. The last case is the .tft berry/test/test_nextion_flash.be
// makes (its tft(N)), which that test flashes from the file system packed.
// test/tftPack.test.mjs runs the check.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packTft, unpackTft } from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "..", "..", "..", "berry", "test", "vectors", "tft_pack.json");

// xorshift, so the noise is the same everywhere
let seed = 0x2545f491;
const noise = (n) => {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed >>>= 0;
    b[i] = seed & 0xff;
  }
  return b;
};
const text = (s) => new TextEncoder().encode(s);
const repeat = (unit, n) => {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = unit[i % unit.length];
  return b;
};
const join2 = (...parts) => {
  const b = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  parts.reduce((o, p) => (b.set(p, o), o + p.length), 0);
  return b;
};

// the flash test's file the preflight takes: its header fields, and the byte's own offset after them
function flashTestTft(n) {
  const b = new Uint8Array(n);
  const put = (o, v, w) => { for (let k = 0; k < w; k++) b[o + k] = (v >>> (8 * k)) & 0xff; };
  put(0x03, 0x4e, 1);
  put(0x14, 3, 1);
  put(0x2e, 0x1ce47603, 4);
  put(0x33, 0xff, 1);
  put(0x3c, n, 4);
  for (let i = 0x48; i < n; i++) b[i] = i & 0xff;
  return b;
}

function cases() {
  const lines = [];
  for (let k = 0; k < 150; k++) lines.push(`zone ${k % 7} light ${(k * 13) % 101} on;`);
  const block = noise(2000);
  return [
    ["ten bytes, kept as they are", text("0123456789")],
    ["a run of 0xFF over three chunks, the last short", repeat([0xff], 9000)],
    ["a period of three", repeat(text("abc"), 5000)],
    ["text that repeats with changes", text(lines.join("\n"))],
    ["noise: a chunk kept as it is, and a short one", noise(4196)],
    ["300 bytes of noise, then them again: a literal count and a match past 270", (() => { const n = noise(300); return join2(n, n, text("end")); })()],
    ["2000 bytes of noise twice: a match of 2000", join2(block, block)],
    ["the flash test's .tft, 10000 bytes", flashTestTft(10000)],
  ];
}

const made = {
  note: "Files packed by libs/nspanel-sim/export/src/tftPack.ts, written by libs/nspanel-sim/export/scripts/tft-pack-vectors.mjs --write; size and sha256 are of what each stands for.",
  chunk: 4096,
  cases: cases().map(([name, raw]) => {
    const packed = packTft(raw);
    const back = unpackTft(packed);
    if (back.length !== raw.length || back.some((v, i) => v !== raw[i])) throw new Error(`${name}: the packer does not read back`);
    return { name, size: raw.length, sha256: createHash("sha256").update(raw).digest("hex"), packed: Buffer.from(packed).toString("hex") };
  }),
};
const want = JSON.stringify(made, null, 1) + "\n";

if (process.argv.includes("--write")) {
  writeFileSync(file, want);
  console.log(`wrote ${made.cases.length} cases into ${file}`);
} else {
  let have = "";
  try { have = readFileSync(file, "utf8"); } catch { /* missing */ }
  if (have.replace(/\r\n/g, "\n") !== want) {
    console.error(`${file} is not what the packer writes now: node scripts/tft-pack-vectors.mjs --write`);
    process.exit(1);
  }
  console.log(`${file}: ${made.cases.length} cases, as the packer writes them`);
}
