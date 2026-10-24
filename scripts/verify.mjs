#!/usr/bin/env node
// The gate before anything is written to a device: every suite of the repository, one after the other, and one line at the end that says
// which passed. There is no CI; this is what stands in for it, and what a commit that touches code is held to before it is made.
//
//   node scripts/verify.mjs            # all of it
//   node scripts/verify.mjs --quick    # the Berry suite on the native VM, the scripts' tests and the docs' checks: a few minutes
//   node scripts/verify.mjs --list     # what it would run, and nothing run
//   node scripts/verify.mjs berry mesh # only the steps whose name has one of these words
//
// It runs nothing that touches a device: the suites are Berry on a VM, the simulator's WebAssembly, the drivers' host tests and Node's own test runner, and
// the checks of the docs read files. A step's output is kept and shown only when it fails; the exit code is 0 when every step passed.
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const win = process.platform === "win32";

/**
 * The steps, in the order they run: name, the command, where it runs, and whether `--quick` keeps it. `npm` is a .cmd on Windows, which Node starts
 * only through the shell.
 */
export const STEPS = [
  { name: "berry (native VM)", cmd: ["node", "berry/test/run.mjs"], quick: true },
  { name: "berry (wasm VM)", cmd: ["node", "berry/test/run.mjs", "--vm=wasm"], quick: false },
  { name: "scripts", cmd: ["node", "--test", "scripts/test/*.test.mjs", "scripts/mesh-bench.test.mjs", "scripts/build-firmware.test.mjs", "scripts/build-stamp.test.mjs", "scripts/fork-berry-class.test.mjs", "scripts/verify.test.mjs"], quick: true },
  { name: "simulator workspaces", cmd: ["npm", "test"], cwd: "libs/nspanel-sim", quick: false, shell: true },
  { name: "mesh driver host test", cmd: ["node", "firmware/host-tests/espnow-mesh-driver/run.mjs"], quick: false },
  { name: "OTA receiver host test", cmd: ["node", "firmware/host-tests/espnow-ota-receiver/run.mjs"], quick: false },
  { name: "docs: links", cmd: ["node", "scripts/check-doc-links.mjs"], quick: true },
  { name: "docs: paths", cmd: ["node", "scripts/check-doc-paths.mjs"], quick: true },
];

/** The steps a command line asks for: `--quick` keeps the quick ones, and words keep the steps whose name has one of them. */
export function choose(argv) {
  const flags = argv.filter((a) => a.startsWith("--"));
  const words = argv.filter((a) => !a.startsWith("--")).map((w) => w.toLowerCase());
  for (const f of flags) if (!["--quick", "--list"].includes(f)) throw new Error(`${f} is not an option of verify (--quick, --list)`);
  let steps = STEPS;
  if (flags.includes("--quick")) steps = steps.filter((s) => s.quick);
  if (words.length > 0) steps = steps.filter((s) => words.some((w) => s.name.toLowerCase().includes(w)));
  if (steps.length === 0) throw new Error(`no step is named ${words.join(" or ")}: ${STEPS.map((s) => s.name).join(", ")}`);
  return { steps, list: flags.includes("--list") };
}

function run(step) {
  return new Promise((resolveRun) => {
    const started = Date.now();
    // a step through the shell is one line given to it (Node warns of arguments passed beside `shell`, which it only concatenates)
    const child = step.shell === true
      ? spawn(step.cmd.join(" "), { cwd: join(repo, step.cwd ?? "."), shell: true, stdio: ["ignore", "pipe", "pipe"] })
      : spawn(step.cmd[0], step.cmd.slice(1), { cwd: join(repo, step.cwd ?? "."), stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => out.push(d));
    child.on("error", (e) => resolveRun({ ok: false, ms: Date.now() - started, output: `${step.cmd[0]}: ${e.message}` }));
    child.on("close", (code) => resolveRun({ ok: code === 0, code, ms: Date.now() - started, output: Buffer.concat(out).toString("utf8") }));
  });
}

async function main(argv) {
  const { steps, list } = choose(argv);
  if (list) {
    for (const s of steps) console.log(`${s.name}: ${s.cmd.join(" ")}${s.cwd ? `   (in ${s.cwd})` : ""}`);
    return 0;
  }
  const results = [];
  for (const step of steps) {
    process.stdout.write(`${step.name} ... `);
    const r = await run(step);
    results.push({ step, ...r });
    console.log(`${r.ok ? "ok" : "FAILED"} (${(r.ms / 1000).toFixed(1)} s)`);
    if (!r.ok) console.log(r.output.split("\n").slice(-40).map((l) => `    ${l}`).join("\n"));
  }
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length === 0 ? `verify: all ${results.length} steps passed` : `verify: ${failed.length} of ${results.length} failed: ${failed.map((r) => r.step.name).join(", ")}`);
  return failed.length === 0 ? 0 : 1;
}

const asScript = process.argv[1] !== undefined && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (asScript) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 2;
  }
}
