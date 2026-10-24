// HouseWeave's add-on package (scripts/ha-addon.mjs): the files Home Assistant builds the image from, their
// fingerprint, what the package's version is to do with it, and the native binaries the image's npm ci needs from the lockfile.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NPM_LOCK, fingerprint, missingBinaries, packageFiles, verdict, versionOf, withBinaries } from "../ha-addon.mjs";

const repo = fileURLToPath(new URL("../..", import.meta.url));

function addon() {
  const dir = mkdtempSync(join(tmpdir(), "ha-addon-"));
  const put = (rel, text) => {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  put("config.yaml", 'name: HouseWeave\nversion: "1.5.0"\nslug: x\n');
  put("Dockerfile", "FROM node\n");
  put("build.yaml", "build_from: {}\n");
  put("server/release-server.mjs", "// the server\n");
  put("custom_components/houseweave/__init__.py", "# the integration\n");
  put("custom_components/houseweave/__pycache__/x.pyc", "compiled");
  put("app/.keep", "the app goes here");
  put("app/index.html", "<!doctype html>");
  put("app/assets/index.js", "1");
  put("README.md", "not in the image");
  return { dir, put };
}

test("the package is what Home Assistant builds the image from: the server, the integration, the app, the Dockerfile, build.yaml and config.yaml", () => {
  const { dir } = addon();
  assert.deepEqual(packageFiles(dir), [
    "server/release-server.mjs", "custom_components/houseweave/__init__.py", "app/assets/index.js", "app/index.html", "Dockerfile", "build.yaml", "config.yaml",
  ], "no compiled Python, no placeholder, no README");
});

test("the fingerprint changes with the package, and not with the version line nor with how the lines end", () => {
  const { dir, put } = addon();
  const first = fingerprint(dir);
  put("config.yaml", 'name: HouseWeave\nversion: "1.6.0"\nslug: x\n');
  assert.equal(fingerprint(dir), first, "the version is not the package");
  put("server/release-server.mjs", "// the server\r\n");
  assert.equal(fingerprint(dir), first, "a checkout's line ends are not a change");
  put("app/assets/index.js", "2");
  assert.notEqual(fingerprint(dir), first, "a change of the app is");
  assert.equal(versionOf('name: HouseWeave\nversion: "1.6.0"\n'), "1.6.0");
  assert.equal(versionOf("version: 1.7.0\n"), "1.7.0", "with or without quotes");
});

test("the version: as it was; changed before its tag (the lock follows) and after it (refused); a new one, with its line and without", () => {
  const lock = { version: "1.5.0", fingerprint: "aa" };
  const log = "## 1.5.0 (2026-10-22)\n";
  assert.deepEqual(verdict({ version: "1.5.0", print: "aa", lock, changelog: log }), { ok: true, message: "the package is version 1.5.0, as it was" });
  const open = verdict({ version: "1.5.0", print: "bb", lock, changelog: log });
  assert.deepEqual([open.ok, open.lock], [true, { version: "1.5.0", fingerprint: "bb" }], "not released: the version takes the change");
  const stale = verdict({ version: "1.5.0", print: "bb", lock, changelog: log, released: true });
  assert.equal(stale.ok, false, "released: it does not");
  assert.match(stale.message, /changed since version 1\.5\.0, released \(tag v1\.5\.0\)/);
  const bare = verdict({ version: "1.6.0", print: "bb", lock, changelog: log });
  assert.equal(bare.ok, false);
  assert.match(bare.message, /no line in CHANGELOG\.md/);
  assert.equal(verdict({ version: "1.6.0", print: "bb", lock, changelog: "## 1.6.0\n" }).lock.version, "1.6.0", "taken, and kept");
  assert.equal(verdict({ version: "1.6.0", print: "bb", lock, changelog: "## 1.6.01\n" }).ok, false, "a line of another version is not its");
  assert.equal(verdict({ version: "1.5.0", print: "aa", lock, changelog: "" }).ok, false, "nor is a version without its line, even as it was");
  assert.deepEqual(verdict({ version: "1.5.0", print: "aa", lock: null, changelog: "## 1.5.0 - the name\n" }).lock, { version: "1.5.0", fingerprint: "aa" }, "the first lock");
  assert.equal(verdict({ version: null, print: "aa", lock, changelog: "" }).ok, false);
});

test("the lockfile: the musl binaries of x64 and arm64 a package names and npm left out, added beside it as npm writes them", () => {
  const lock = {
    name: "nspanel-sim", lockfileVersion: 3, requires: true,
    packages: {
      "": { name: "nspanel-sim" },
      "node_modules/@rolldown/binding-linux-arm64-musl": { version: "1.2.7" },
      "sim/node_modules/rolldown": {
        version: "1.2.7", dev: true,
        optionalDependencies: {
          "@rolldown/binding-linux-arm64-musl": "1.2.7", "@rolldown/binding-linux-x64-gnu": "1.2.7",
          "@rolldown/binding-linux-x64-musl": "1.2.7", "@rolldown/binding-win32-x64-msvc": "1.2.7",
        },
      },
      "sim/node_modules/@rolldown/binding-win32-x64-msvc": { version: "1.2.7", optional: true },
      "sim": { name: "@nspanel-sim/sim", optionalDependencies: { "lightningcss-linux-x64-musl": "1.33.0" } },
    },
  };
  assert.deepEqual(missingBinaries(lock), [
    { at: "sim/node_modules/@rolldown/binding-linux-x64-musl", name: "@rolldown/binding-linux-x64-musl", version: "1.2.7", parent: "sim/node_modules/rolldown" },
    { at: "sim/node_modules/lightningcss-linux-x64-musl", name: "lightningcss-linux-x64-musl", version: "1.33.0", parent: "sim" },
  ], "only musl's, and not the arm64 one an ancestor's node_modules has");
  const asked = [];
  const meta = (name, version) => {
    asked.push(`${name}@${version}`);
    return { dist: { tarball: `https://registry/${name}.tgz`, integrity: "sha512-x" }, os: ["linux"], cpu: ["x64"], libc: ["musl"], license: "MIT", engines: { node: ">=20" } };
  };
  const out = withBinaries(lock, meta);
  assert.deepEqual(asked, ["@rolldown/binding-linux-x64-musl@1.2.7", "lightningcss-linux-x64-musl@1.33.0"]);
  const entry = out.packages["sim/node_modules/@rolldown/binding-linux-x64-musl"];
  assert.deepEqual(Object.keys(entry), ["version", "resolved", "integrity", "cpu", "dev", "libc", "license", "optional", "os", "engines"], "npm's order");
  assert.equal(entry.dev, true, "a dev package's binary is dev");
  assert.equal(out.packages["sim/node_modules/lightningcss-linux-x64-musl"].dev, undefined);
  assert.deepEqual(Object.keys(out.packages), ["", "node_modules/@rolldown/binding-linux-arm64-musl", "sim", "sim/node_modules/@rolldown/binding-linux-x64-musl",
    "sim/node_modules/@rolldown/binding-win32-x64-msvc", "sim/node_modules/lightningcss-linux-x64-musl", "sim/node_modules/rolldown"], "sorted, the root first");
  assert.deepEqual(missingBinaries(out), [], "and none left");
});

test("the repository's lockfile has the add-on image's binaries, and the image fetches from the fork the folder the app reads", () => {
  const lock = JSON.parse(readFileSync(join(repo, NPM_LOCK), "utf8"));
  assert.deepEqual(missingBinaries(lock).map((m) => m.at), [], "an npm install on another platform left some out: node scripts/ha-addon.mjs --lock");
  const read = readFileSync(join(repo, "libs/nspanel-sim/sim/src/panelFiles.ts"), "utf8").match(/firmware\/tasmota\/([^"*]+)\/\*/g) ?? [];
  assert.ok(read.length > 0, "the app reads Tasmota's Berry library from the submodule");
  const docker = readFileSync(join(repo, "ha/houseweave/Dockerfile"), "utf8");
  const fetched = /git sparse-checkout set ([^;]+);/.exec(docker)?.[1].trim().split(/\s+/) ?? [];
  for (const r of read) {
    const folder = r.replace(/^firmware\/tasmota\//, "").replace(/\/\*$/, "");
    assert.ok(fetched.some((f) => folder === f || folder.startsWith(`${f}/`)), `the image's build fetches ${folder}`);
  }
});
