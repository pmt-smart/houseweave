// The Berry tests of the repo (berry/test), on the two VMs they run on: the
// interpreter vendored in the firmware submodule, and this package's WebAssembly
// build, the simulator's backend, which must behave as the first. Both pass, and
// their outputs are the same line by line, but for the folder each run keeps its
// files in, which the WebAssembly VM sees as /work.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const interpreter = ["berry.exe", "berry"].map((n) => join(repo, "firmware/tasmota/lib/libesp32/berry", n)).find(existsSync);

/** a run of the suite, and its output with the run's own folder named as the WebAssembly VM sees it */
function suite(args) {
  const r = spawnSync(process.execPath, [join(repo, "berry/test/run.mjs"), ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { ...r, lines: r.stdout.replace(/[^\s'"]*berry-test-[A-Za-z0-9]+/g, "/work").split("\n") };
}

/** a run with no test failed: run.mjs says one on stderr, and exits with 1 */
function passed(r, vm) {
  const failed = `${r.stdout}\n${r.stderr}`.match(/^FAIL: .*/gm) ?? [];
  assert.deepEqual(failed, [], `${vm}: ${r.stdout.slice(-2000)}${r.stderr}`);
  assert.equal(r.status, 0, `${vm}: ${r.stdout.slice(-2000)}${r.stderr}`);
}

let wasm;
const onWasm = () => (wasm ??= suite(["--vm=wasm"]));

test("every Berry test passes on the WebAssembly VM", () => {
  passed(onWasm(), "the WebAssembly VM");
});

test("and the WebAssembly VM says what the vendored interpreter says, line by line",
  { skip: interpreter ? false : "no vendored interpreter: git submodule update --init firmware/tasmota" }, () => {
    const host = suite([]);
    passed(host, "the interpreter");
    assert.deepEqual(onWasm().lines, host.lines, "the two VMs' outputs");
  });
