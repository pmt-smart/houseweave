// scripts/verify.mjs, the gate before the bench: which steps a command line chooses, and that --list runs nothing. The steps themselves are not run here
// (they are the suites of the whole repository: running them from a test of the gate would run the test of the gate).
//
//   node --test scripts/verify.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STEPS, choose } from "./verify.mjs";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "verify.mjs");

test("all of it by default, in the order the suites are held to", () => {
  const { steps, list } = choose([]);
  assert.equal(list, false);
  assert.deepEqual(steps.map((s) => s.name), STEPS.map((s) => s.name));
  assert.deepEqual(steps.map((s) => s.name).slice(0, 2), ["berry (native VM)", "berry (wasm VM)"]);
  assert.ok(steps.some((s) => s.name === "mesh driver host test"));
  assert.ok(steps.some((s) => s.name === "docs: links") && steps.some((s) => s.name === "docs: paths"), "both checks of the docs, as CLAUDE.md asks");
});

test("--quick keeps the steps that take a few minutes, and words keep the steps they name", () => {
  const quick = choose(["--quick"]).steps.map((s) => s.name);
  assert.deepEqual(quick, ["berry (native VM)", "scripts", "docs: links", "docs: paths"]);
  assert.deepEqual(choose(["mesh"]).steps.map((s) => s.name), ["mesh driver host test"]);
  assert.deepEqual(choose(["berry", "docs"]).steps.map((s) => s.name), ["berry (native VM)", "berry (wasm VM)", "docs: links", "docs: paths"]);
  assert.deepEqual(choose(["--quick", "berry"]).steps.map((s) => s.name), ["berry (native VM)"]);
  assert.equal(choose(["--list"]).list, true);
});

test("an option that is not one, and a word that names no step, are refused", () => {
  assert.throws(() => choose(["--fast"]), /--fast is not an option of verify/);
  assert.throws(() => choose(["nothing-of-the-kind"]), /no step is named nothing-of-the-kind/);
});

test("--list says what it would run and runs none of it", () => {
  const r = spawnSync(process.execPath, [script, "--list"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.length, STEPS.length);
  assert.match(lines[0], /^berry \(native VM\): node berry\/test\/run\.mjs$/);
  assert.match(r.stdout, /simulator workspaces: npm test {3}\(in libs\/nspanel-sim\)/);
  assert.ok(!/ok \(|FAILED/.test(r.stdout), "no step ran");
  const bad = spawnSync(process.execPath, [script, "--fast"], { encoding: "utf8" });
  assert.equal(bad.status, 2);
});
