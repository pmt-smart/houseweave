// Tests of scripts/build-firmware.ps1 that need no build: the checks it makes before it copies or
// compiles anything (-DryRun), and the functions in its marked blocks, which run here on their own,
// in temporary folders. A build takes minutes per env and is not run.
//
//   node --test scripts/build-firmware.test.mjs
//
// Windows PowerShell only: the script is a PowerShell one, and on another system these are skipped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "build-firmware.ps1");
const source = readFileSync(script, "utf8");

const found = process.platform === "win32" && spawnSync("powershell", ["-NoProfile", "-Command", "1"]).status === 0;
const skip = found ? false : "needs Windows PowerShell";

const ps = (args) => spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args], { encoding: "utf8" });
const run = (...args) => ps(["-File", script, ...args]);

// The text of one of the script's marked blocks: `# --- <name>: begin` to `# --- <name>: end`
const block = (name) => {
  const begin = source.indexOf(`# --- ${name}: begin`);
  const end = source.indexOf(`# --- ${name}: end`);
  assert.ok(begin >= 0 && end > begin, `the ${name} block is in the script`);
  return source.slice(begin, end);
};

// A PowerShell script made of a block and some lines of ours, run in a folder of its own
const withTemp = (fn) => {
  const dir = mkdtempSync(path.join(tmpdir(), "build-firmware-test-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const runBlock = (dir, name, lines) => {
  const file = path.join(dir, "run.ps1");
  writeFileSync(file, `$ErrorActionPreference = "Stop"\n${block(name)}\n${lines}\n`, "ascii");
  return ps(["-File", file]);
};

test("-DryRun with no env names the envs of the panels and the bridge, and builds nothing", { skip }, () => {
  const r = run("-DryRun");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /dry run: would build tasmota32-houseweave-living-room-eu, tasmota32-houseweave-living-room-us, tasmota32-houseweave-bridge,/);
});

test("the base env is refused by name unless -AllowBase says so", { skip }, () => {
  const refused = run("-DryRun", "tasmota32-houseweave");
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /is the base env the others extend/);
  assert.doesNotMatch(refused.stdout, /dry run/);
  // and not when it comes among others
  const among = run("-DryRun", "tasmota32-houseweave-living-room-us", "tasmota32-houseweave");
  assert.notEqual(among.status, 0);
  const allowed = run("-DryRun", "-AllowBase", "tasmota32-houseweave");
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.match(allowed.stdout, /would build tasmota32-houseweave,/);
});

test("a name that is not an env of the override is refused before anything is copied", { skip }, () => {
  const r = run("-DryRun", "tasmota32-houseweave-living-room-xx");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /is not an env of firmware\/overrides\/platformio_override\.ini/);
  // a name that was once an env, and is not one of the override's
  const bench = run("-DryRun", "tasmota32-mesh-bench");
  assert.notEqual(bench.status, 0);
});

test("the build stamp becomes a file name: the fork's commit after a dash, and the marks kept", { skip }, () => {
  withTemp((dir) => {
    mkdirSync(path.join(dir, "g"));
    const gen = (stamp) => writeFileSync(path.join(dir, "g", "panel_build.be"), `class PanelBuild\n    static var COMMIT = "${stamp}"\n    static var DATE = "2026-10-12T05:50"\nend\n`);
    const stampOf = () => {
      const r = runBlock(dir, "releases", `Get-BuildStamp "${path.join(dir, "g", "panel_build.be")}"`);
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    gen("6224248a+/d4e9afd6");
    assert.equal(stampOf(), "6224248a+-d4e9afd6");
    gen("6224248a/d4e9afd6+");
    assert.equal(stampOf(), "6224248a-d4e9afd6+");
    // a copy that is not there, or has no stamp, is "unknown", and never an empty name
    rmSync(path.join(dir, "g", "panel_build.be"));
    assert.equal(stampOf(), "unknown");
    writeFileSync(path.join(dir, "g", "panel_build.be"), "class PanelBuild\nend\n");
    assert.equal(stampOf(), "unknown");
  });
});

test("Keep-Release copies both images by <env>-<stamp> and never overwrites one", { skip }, () => {
  withTemp((dir) => {
    const from = path.join(dir, "build_output");
    const to = path.join(dir, "releases");
    mkdirSync(from);
    const keep = (stamp = "abc12345+-def67890") => {
      const r = runBlock(dir, "releases", `Keep-Release "tasmota32-x" "${stamp}" "${from}" "${to}"`);
      assert.equal(r.status, 0, r.stderr);
      return r;
    };
    const names = () => (existsSync(to) ? readdirSync(to).sort() : []);
    writeFileSync(path.join(from, "tasmota32-x.bin"), "app one");
    writeFileSync(path.join(from, "tasmota32-x.factory.bin"), "factory one");

    keep();
    assert.deepEqual(names(), ["tasmota32-x-abc12345+-def67890.bin", "tasmota32-x-abc12345+-def67890.factory.bin"]);
    assert.equal(readFileSync(path.join(to, "tasmota32-x-abc12345+-def67890.bin"), "utf8"), "app one");

    // the same bytes again: left as they are
    const again = keep();
    assert.equal(names().length, 2);
    assert.match(again.stdout, /already kept as/);

    // other bytes under the same stamp (a build of the same commit with the tree changed): a new name, the first intact
    writeFileSync(path.join(from, "tasmota32-x.bin"), "app two");
    keep();
    writeFileSync(path.join(from, "tasmota32-x.bin"), "app three");
    keep();
    assert.deepEqual(names(), [
      "tasmota32-x-abc12345+-def67890-2.bin",
      "tasmota32-x-abc12345+-def67890-3.bin",
      "tasmota32-x-abc12345+-def67890.bin",
      "tasmota32-x-abc12345+-def67890.factory.bin",
    ]);
    assert.equal(readFileSync(path.join(to, "tasmota32-x-abc12345+-def67890.bin"), "utf8"), "app one");
    assert.equal(readFileSync(path.join(to, "tasmota32-x-abc12345+-def67890-2.bin"), "utf8"), "app two");
    assert.equal(readFileSync(path.join(to, "tasmota32-x-abc12345+-def67890-3.bin"), "utf8"), "app three");

    // another commit is another name; and an image the build did not write is said, not invented
    rmSync(path.join(from, "tasmota32-x.factory.bin"));
    const other = keep("11111111-22222222");
    assert.match(other.stdout + other.stderr, /tasmota32-x\.factory\.bin is not in/);
    assert.equal(names().length, 5);
    assert.ok(existsSync(path.join(to, "tasmota32-x-11111111-22222222.bin")));
  });
});
