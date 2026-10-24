#!/usr/bin/env node
// Mechanical half of the "check origin, pull the collaborator's work,
// validate it" loop.
// Deliberately does NOT decide what to test
// or flash — that needs judgment on whatever the new commits actually
// say, which isn't scriptable. This script only does the part that is:
// fetch, fast-forward, build, and run the two test suites, then print a
// short report of what changed so the next step (human or agent) knows
// where to look.
//
//   node scripts/auto-sync.mjs
//
// Exit code 0 with "no new commits" printed when there is nothing to do
// (safe to run on a timer). Exit code 1 if fetch/merge/build/test fails
// -- that is itself a signal worth surfacing, not something to paper over.
import { execSync } from "node:child_process";

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
}

function runInherit(cmd, opts = {}) {
  execSync(cmd, { stdio: "inherit", ...opts });
}

const status = run("git status --short").trim();
if (status) {
  console.error("working tree not clean, refusing to touch it:\n" + status);
  process.exit(1);
}

run("git fetch origin");
const newCommits = run("git log --oneline HEAD..origin/master").trim();
if (!newCommits) {
  console.log("no new commits on origin/master");
  process.exit(0);
}

console.log("new commits:\n" + newCommits + "\n");
runInherit("git merge --ff-only origin/master");

const changedFiles = run("git diff --name-only HEAD@{1} HEAD").trim();
console.log("\nchanged files:\n" + changedFiles + "\n");

console.log("--- building export/ ---");
runInherit("npm run build", { cwd: "libs/nspanel-sim/export" });

console.log("--- export/ test suite ---");
runInherit("npm test", { cwd: "libs/nspanel-sim/export" });

console.log("--- doc links ---");
runInherit("node scripts/check-doc-links.mjs");

console.log("\nsync complete. Review the changed files above for what to test/flash next.");
