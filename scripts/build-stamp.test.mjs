// The stamp a build gives the brain, <repository>/<fork>, and the warning the build script gives before it:
// firmware/overrides/panel_build.py (the stamp) and Get-ForkState in scripts/build-firmware.ps1 (the warning) run
// here on the same scenarios, in temporary repositories shaped like this one (a repository with the fork at
// firmware/tasmota as its own repository, recorded in HEAD as a gitlink), because they have to say the same thing.
//
//   node --test scripts/build-stamp.test.mjs
//
// panel_build.py needs a Python 3, found in .tools/pio-venv (the PlatformIO one) or in PYTHON; without it those
// tests are skipped. The PowerShell one needs Windows PowerShell.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const panelBuildPy = path.join(repoRoot, "firmware", "overrides", "panel_build.py");
const panelBuildBe = path.join(repoRoot, "berry", "panel_build.be");
const ps1 = readFileSync(path.join(here, "build-firmware.ps1"), "utf8");

const python = [process.env.PYTHON, path.join(repoRoot, ".tools", "pio-venv", "Scripts", "python.exe"), "python3", "python"]
  .filter(Boolean)
  .find((p) => {
    const r = spawnSync(p, ["--version"], { encoding: "utf8" });
    return r.status === 0 && /Python 3/.test(r.stdout + r.stderr);
  });
const powershell = process.platform === "win32" && spawnSync("powershell", ["-NoProfile", "-Command", "1"]).status === 0;
const skipPy = python ? false : "needs a Python 3 (.tools/pio-venv or PYTHON)";
const skipPs = powershell ? false : "needs Windows PowerShell";

const git = (dir, ...args) => {
  const r = spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const write = (dir, file, text) => {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), text);
};
const commit = (dir, message) => {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
};

// A repository with a fork inside it. The fork holds the three files a build rewrites, and one more
const REWRITTEN = ["sdkconfig.defaults", "CMakeLists.txt", "lib/libesp32/berry_custom/src/modules.h"];
const make = (withFork = true) => {
  const dir = mkdtempSync(path.join(tmpdir(), "build-stamp-test-"));
  git(dir, "init", "-q");
  write(dir, "berry/panel_build.be", readFileSync(panelBuildBe, "utf8"));
  write(dir, "notes.txt", "one\n");
  const fork = path.join(dir, "firmware", "tasmota");
  mkdirSync(fork, { recursive: true });
  if (withFork) {
    git(fork, "init", "-q");
    for (const f of REWRITTEN) write(fork, f, "upstream\n");
    write(fork, "tasmota/driver.ino", "driver\n");
    commit(fork, "fork one");
  }
  commit(dir, "repository one");
  return { dir, fork };
};
const clean = (dir) => rmSync(dir, { recursive: true, force: true });

// panel_build.py, run the way PlatformIO runs it: Import("env") gives it an env that knows $PROJECT_DIR
const harness = `
import runpy, sys
class Env:
    def __init__(self, project): self.project = project
    def subst(self, s): return s.replace("$PROJECT_DIR", self.project).replace("$PIOENV", "tasmota32-houseweave-test")
    def Exit(self, code): raise SystemExit(code)
runpy.run_path(sys.argv[1], init_globals={"Import": lambda *a, **k: None, "env": Env(sys.argv[2])})
`;
const stampOf = (t) => {
  const runner = path.join(t.dir, "..", `harness-${path.basename(t.dir)}.py`);
  writeFileSync(runner, harness);
  try {
    const r = spawnSync(python, ["-I", runner, panelBuildPy, t.fork], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const generated = readFileSync(path.join(t.dir, "firmware", "overrides", "generated", "panel_build.be"), "utf8");
    const m = /static var COMMIT = "([^"]*)"/.exec(generated);
    assert.ok(m, generated);
    assert.match(generated, /static var DATE = "\d{4}-\d\d-\d\dT\d\d:\d\d"/);
    assert.match(generated, /static var IMAGE = "tasmota32-houseweave-test"/, "the image, the build's env");
    return m[1];
  } finally {
    rmSync(runner, { force: true });
  }
};

// Get-ForkState and Write-ForkWarnings, from the script's own marked block, on a folder of ours
const forkBlock = () => {
  const begin = ps1.indexOf("# --- fork: begin");
  const end = ps1.indexOf("# --- fork: end");
  assert.ok(begin >= 0 && end > begin, "the fork block is in the script");
  return ps1.slice(begin, end);
};
const stateOf = (t) => {
  const file = path.join(t.dir, "..", `state-${path.basename(t.dir)}.ps1`);
  writeFileSync(
    file,
    `$ErrorActionPreference = "Stop"\n${forkBlock()}\n$s = Get-ForkState "${t.dir}" "${t.fork}"\nif ($null -eq $s) { "none" } else { "head=$($s.Head) recorded=$($s.Recorded) moved=$($s.Moved) dirty=$($s.Dirty)" }\nWrite-ForkWarnings $s\n`,
    "ascii",
  );
  try {
    const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.split(/\r?\n/);
    // the host wraps a warning at its width and says its prefix in the system's language
    return { state: lines[0], text: (r.stdout + r.stderr).replace(/\s+/g, " ") };
  } finally {
    rmSync(file, { force: true });
  }
};

const parts = (stamp) => {
  const m = /^([0-9a-f]+\+?)\/([0-9a-f]{8,}\+?|unknown)$/.exec(stamp);
  assert.ok(m, `a stamp of <repository>/<fork>: ${stamp}`);
  return { repo: m[1], fork: m[2] };
};

test("a clean checkout, the fork where the repository records it: two commits and no +", { skip: skipPy }, () => {
  const t = make();
  try {
    const s = parts(stampOf(t));
    assert.equal(s.repo, git(t.dir, "rev-parse", "--short", "HEAD"));
    assert.ok(git(t.fork, "rev-parse", "HEAD").startsWith(s.fork));
    assert.equal(s.fork.length >= 8, true);
  } finally {
    clean(t.dir);
  }
});

test("the fork at another commit than the one the repository records says so with a +, the repository does not", { skip: skipPy }, () => {
  const t = make();
  try {
    write(t.fork, "tasmota/driver.ino", "driver, changed\n");
    commit(t.fork, "fork two");
    const s = parts(stampOf(t));
    assert.equal(s.repo, git(t.dir, "rev-parse", "--short", "HEAD"), "the repository itself is as committed");
    assert.ok(s.fork.endsWith("+"), s.fork);
    assert.ok(git(t.fork, "rev-parse", "HEAD").startsWith(s.fork.slice(0, -1)), "and it is the fork's own HEAD");
    // recorded in the repository, it is clean again
    commit(t.dir, "repository two");
    const after = parts(stampOf(t));
    assert.equal(after.fork, s.fork.slice(0, -1));
    assert.equal(after.repo, git(t.dir, "rev-parse", "--short", "HEAD"));
  } finally {
    clean(t.dir);
  }
});

test("a fork with a tracked file changed has a +; the files the build rewrites are not changes", { skip: skipPy }, () => {
  const t = make();
  try {
    for (const f of REWRITTEN) write(t.fork, f, "rewritten by a build\n");
    assert.equal(parts(stampOf(t)).fork.endsWith("+"), false, "the three rewritten files");
    write(t.fork, "tasmota/driver.ino", "edited by hand\n");
    assert.equal(parts(stampOf(t)).fork.endsWith("+"), true, "a file of the driver");
    // an untracked file is nothing, as it has always been for the repository
    git(t.fork, "checkout", "--", "tasmota/driver.ino");
    write(t.fork, "scratch.txt", "x\n");
    assert.equal(parts(stampOf(t)).fork.endsWith("+"), false, "an untracked file");
  } finally {
    clean(t.dir);
  }
});

test("the repository with a tracked file changed has a +, and the fork's commit does not make it dirtier", { skip: skipPy }, () => {
  const t = make();
  try {
    write(t.dir, "notes.txt", "two\n");
    const s = parts(stampOf(t));
    assert.equal(s.repo, git(t.dir, "rev-parse", "--short", "HEAD") + "+");
    assert.equal(s.fork.endsWith("+"), false);
  } finally {
    clean(t.dir);
  }
});

test("a fork that is not a checkout says unknown, and does not borrow the repository's HEAD", { skip: skipPy }, () => {
  const t = make(false);
  try {
    const s = parts(stampOf(t));
    assert.equal(s.fork, "unknown");
    assert.equal(s.repo, git(t.dir, "rev-parse", "--short", "HEAD"));
  } finally {
    clean(t.dir);
  }
});

test("the build script's check says what the stamp says, scenario by scenario", { skip: skipPs }, () => {
  const t = make();
  try {
    const head = git(t.fork, "rev-parse", "HEAD");
    let r = stateOf(t);
    assert.equal(r.state, `head=${head} recorded=${head} moved=False dirty=False`);
    assert.doesNotMatch(r.text, /WARNING|AVISO/);

    write(t.fork, "tasmota/driver.ino", "driver, changed\n");
    commit(t.fork, "fork two");
    const head2 = git(t.fork, "rev-parse", "HEAD");
    r = stateOf(t);
    assert.equal(r.state, `head=${head2} recorded=${head} moved=True dirty=False`);
    assert.match(r.text, /(WARNING|AVISO): the fork is at [0-9a-f]{8} and this repository's HEAD records [0-9a-f]{40} for it/);
    assert.match(r.text, /git submodule update first/);

    commit(t.dir, "repository two");
    for (const f of REWRITTEN) write(t.fork, f, "rewritten by a build\n");
    r = stateOf(t);
    assert.equal(r.state, `head=${head2} recorded=${head2} moved=False dirty=False`, "what a build rewrites is not a change");

    write(t.fork, "tasmota/driver.ino", "edited by hand\n");
    r = stateOf(t);
    assert.equal(r.state, `head=${head2} recorded=${head2} moved=False dirty=True`);
    assert.match(r.text, /(WARNING|AVISO): a tracked file of the fork differs from its commit/);
  } finally {
    clean(t.dir);
  }
});

test("the build script's check on a fork that is not a checkout answers none and warns", { skip: skipPs }, () => {
  const t = make(false);
  try {
    const r = stateOf(t);
    assert.equal(r.state, "none");
    assert.match(r.text, /(WARNING|AVISO): firmware\\tasmota is not a checkout of the fork/);
  } finally {
    clean(t.dir);
  }
});

test("the files the stamp's exclusions name are the ones the build script puts back", () => {
  const py = readFileSync(panelBuildPy, "utf8");
  const restored = /git -C \$tasmota checkout -- ([^\r\n]+)/.exec(ps1);
  assert.ok(restored, "the build script restores files of the fork");
  for (const f of restored[1].trim().split(/\s+/)) {
    assert.ok(py.includes(`"${f}"`), `panel_build.py leaves ${f} out of the fork's changes`);
    assert.ok(ps1.includes(`":(exclude)${f}"`), `Get-ForkState leaves ${f} out of the fork's changes`);
  }
  assert.ok(existsSync(panelBuildBe));
});
