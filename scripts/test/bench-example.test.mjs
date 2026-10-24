// scripts/bench-topology.example.json: the file the docs point a new bench at must be valid, must be on addresses that
// reach no device (203.0.113.0/24, reserved for documentation), and every script must make its plan from it without sending.
//
//   node --test "scripts/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadTopology } from "../lib/bench.mjs";

const repo = join(import.meta.dirname, "..", "..");
const example = join(repo, "scripts", "bench-topology.example.json");
const run = (script, ...args) => spawnSync(process.execPath, [`scripts/${script}`, ...args], { encoding: "utf8", cwd: repo, timeout: 20000 });

test("the example topology is valid and on no real address", () => {
  const t = loadTopology(example);
  assert.equal(t.devices.length, 5);
  assert.equal(t.lamps.length, 18);
  assert.equal(t.outlets.length, 3);
  for (const host of [...t.devices.map((d) => d.ip), ...t.outlets.map((o) => o.ip)]) assert.match(host, /^203\.0\.113\.\d+$/, "a documentation address: running it by mistake reaches nothing");
  assert.ok(!/192\.168\.|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\./.test(readFileSync(example, "utf8")));
  assert.equal(t.lamps.filter((l) => l.coordinator === "bridge-1").length, 12, "the zone of 12 of the first degree");
  assert.deepEqual(t.devices.filter((d) => d.sacrificial).map((d) => d.name), ["bridge-fabrica", "panel-us-novo"]);
});

test("every script makes its plan from the example, and sends nothing", () => {
  const load = run("bench-load.mjs", "--topology", example, "--scenario", "burst", "--burst-sizes", "5,8,12", "--n", "2", "--paths", "panel", "--seed", "1");
  assert.equal(load.status, 0, load.stderr);
  assert.match(load.stdout, /DRY RUN/);
  assert.match(load.stdout, /burst of 12 via panel-/);
  const singles = run("bench-load.mjs", "--topology", example, "--paths", "panel,tap,bridge", "--n", "10", "--seed", "1");
  assert.equal(singles.status, 0, singles.stderr);
  assert.match(singles.stdout, /30 steps/);
  const power = run("bench-power.mjs", "cuts", "--topology", example, "--outlets", "plug-bridge-fabrica,plug-panel-novo", "--cycles", "5", "--saves", "--check-persist");
  assert.equal(power.status, 0, power.stderr);
  assert.match(power.stdout, /DRY RUN/);
  const blackout = run("bench-power.mjs", "blackout", "--topology", example, "--outlets", "plug-router,plug-bridge-fabrica,plug-panel-novo", "--order", "router-first");
  assert.equal(blackout.status, 0, blackout.stderr);
  assert.match(blackout.stdout, /router-first/);
  const surface = run("bench-surface.mjs", "--topology", example, "--targets", "panel-us-novo,bridge-fabrica");
  assert.equal(surface.status, 0, surface.stderr);
  assert.match(surface.stdout, /DRY RUN/);
  assert.match(surface.stdout, /panel-us-novo 203\.0\.113\.15/);
  const logs = run("bench-logs.mjs", "--topology", example, "--dry-run");
  assert.equal(logs.status, 0, logs.stderr);
  assert.match(logs.stdout, /bridge-fabrica 203\.0\.113\.14/);
});
