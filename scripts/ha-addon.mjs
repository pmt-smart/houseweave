#!/usr/bin/env node
// HouseWeave's add-on package: the app compiled into the add-on's folder, the package's version held to what it holds,
// and the tag Home Assistant compiles each version from.
//
//   node scripts/ha-addon.mjs              compiles the app (libs/nspanel-sim/sim), puts it in ha/houseweave/app/, and checks the version
//   node scripts/ha-addon.mjs --no-build   checks the version of what the folder holds now, the app as it is
//   node scripts/ha-addon.mjs --lock       adds to the simulator's package-lock.json the native binaries the add-on's image needs (below)
//   node scripts/ha-addon.mjs --release    tags the committed version (v<version>), the one Home Assistant compiles: run after its commit
//
// THE VERSION. Home Assistant updates an add-on when its config.yaml says another version, and shows the CHANGELOG.md's lines for it. So a package
// that went out keeps no version it had: the script takes a fingerprint of the package (the SHA-256 of every file Home Assistant builds the image from:
// the server, the integration, the app, the Dockerfile, build.yaml and config.yaml, the version line left out) and holds it to the one
// ha/houseweave/version-lock.json keeps for the version it names. A version goes out with its tag, v<version>: in the add-on repository the package
// holds no compiled app, and the image's build compiles it from the source at that tag. Until the tag, the version takes the package's changes,
// and the lock follows them; after it, another fingerprint at the same version stops the script, which says to give config.yaml a new version, with
// its line in CHANGELOG.md. The lock goes in the same commit as the version.
//
// THE LOCKFILE. The image is Node's on Alpine (build.yaml), for x64 and arm64, and the app's bundler and CSS minifier are native: npm ci there takes
// their musl binaries from the lockfile, and npm, run on another platform, writes only that platform's. The script checks that every musl binary of
// those two that a locked package names as optional is in the lockfile, and --lock adds the missing ones, at the versions their packages pin, as npm
// itself writes them.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ADDON = "ha/houseweave";
export const NPM_LOCK = "libs/nspanel-sim/package-lock.json";
const LOCK = "version-lock.json";
const VERSION_LINE = /^version:\s*"?([^"\s]+)"?\s*$/m;
/** the add-on's images, Node's on Alpine for the two architectures config.yaml names: the native binaries npm ci needs there */
const ALPINE_BINARY = /-linux-(x64|arm64)-musl$/;
/** what the image is built from, in the repository: the package's folder and the app's source, which the release commits */
const RELEASED_PATHS = [ADDON, "libs/nspanel-sim", "berry", "autoexec.be", "firmware/tasmota"];

/** the files Home Assistant builds the image from, relative to the add-on's folder, in a fixed order */
export function packageFiles(dir) {
  const out = [];
  const walk = (rel) => {
    for (const name of readdirSync(path.join(dir, rel)).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      if (name === "__pycache__" || name === ".keep") continue;
      if (statSync(path.join(dir, r)).isDirectory()) walk(r);
      else out.push(r);
    }
  };
  for (const top of ["server", "custom_components", "app"]) if (existsSync(path.join(dir, top))) walk(top);
  for (const f of ["Dockerfile", "build.yaml", "config.yaml"]) if (existsSync(path.join(dir, f))) out.push(f);
  return out;
}

/** the package's fingerprint: each file's path and bytes, the version line of config.yaml left out, and text read the same whatever its line ends */
export function fingerprint(dir, files = packageFiles(dir)) {
  const h = createHash("sha256");
  for (const f of files) {
    let bytes = readFileSync(path.join(dir, f));
    if (/\.(mjs|js|json|yaml|yml|py|md|html|css|txt|svg)$|^Dockerfile$/.test(f)) {
      let text = bytes.toString("utf8").replace(/\r\n/g, "\n");
      if (f === "config.yaml") text = text.replace(VERSION_LINE, "version:");
      bytes = Buffer.from(text, "utf8");
    }
    h.update(f).update("\0").update(bytes).update("\0");
  }
  return h.digest("hex");
}

/** the version config.yaml says */
export function versionOf(configText) {
  const m = VERSION_LINE.exec(configText);
  return m ? m[1] : null;
}

/**
 * What the package's version is to do: {ok, message, lock}. `lock` is what version-lock.json keeps ({version, fingerprint}, or null), `released`
 * whether the version's tag exists, and the returned `lock`, when there is one, is what it is to keep from now on.
 */
export function verdict({ version, print, lock, changelog, released = false }) {
  if (!version) return { ok: false, message: "config.yaml says no version" };
  if (!new RegExp(`^## ${version.replace(/\./g, "\\.")}\\b`, "m").test(changelog ?? "")) {
    return { ok: false, message: `version ${version} has no line in CHANGELOG.md ("## ${version}")` };
  }
  if (lock && lock.version === version) {
    if (lock.fingerprint === print) return { ok: true, message: `the package is version ${version}, as it was` };
    if (released) {
      return { ok: false, message: `the package changed since version ${version}, released (tag v${version}): give config.yaml a new version, with its line in CHANGELOG.md, and run this again` };
    }
    return { ok: true, message: `the package is version ${version}, not released yet: the lock follows it`, lock: { version, fingerprint: print } };
  }
  return { ok: true, message: `the package is version ${version} from now on`, lock: { version, fingerprint: print } };
}

/** where npm finds `name` from the package at `from` (a lockfile path): the first of its own node_modules and its ancestors' that the lockfile has */
function resolveFrom(packages, from, name) {
  let dir = from;
  for (;;) {
    const at = `${dir ? `${dir}/` : ""}node_modules/${name}`;
    if (at in packages) return at;
    if (!dir) return null;
    const i = dir.lastIndexOf("node_modules/");
    dir = i < 0 ? "" : dir.slice(0, i).replace(/\/$/, "");
  }
}

/** the musl binaries of x64 and arm64 that a locked package names as optional and the lockfile lacks: [{at, name, version, parent}] */
export function missingBinaries(lock) {
  const out = [];
  for (const [from, p] of Object.entries(lock.packages)) {
    for (const [name, version] of Object.entries(p.optionalDependencies ?? {})) {
      if (!ALPINE_BINARY.test(name) || resolveFrom(lock.packages, from, name)) continue;
      // beside its package, as npm places a sibling binary (sim/node_modules/rolldown's, in sim/node_modules/@rolldown/)
      const i = from.lastIndexOf("node_modules/");
      const base = i >= 0 ? from.slice(0, i) : from ? `${from}/` : "";
      out.push({ at: `${base}node_modules/${name}`, name, version, parent: from });
    }
  }
  return out;
}

/** the lockfile with the missing binaries in, each entry as npm writes it: `meta(name, version)` gives the registry's word for the package */
export function withBinaries(lock, meta) {
  const packages = { ...lock.packages };
  for (const m of missingBinaries(lock)) {
    const r = meta(m.name, m.version);
    const flags = Object.fromEntries(["dev", "devOptional", "peer"].filter((f) => lock.packages[m.parent][f]).map((f) => [f, true]));
    packages[m.at] = {
      version: m.version, resolved: r.dist.tarball, integrity: r.dist.integrity,
      ...(r.cpu ? { cpu: r.cpu } : {}), ...flags, ...(r.libc ? { libc: r.libc } : {}), ...(r.license ? { license: r.license } : {}),
      optional: true, ...(r.os ? { os: r.os } : {}), ...(r.engines ? { engines: r.engines } : {}), ...(r.funding ? { funding: r.funding } : {}),
    };
  }
  const keys = Object.keys(packages).sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b, "en")));
  return { ...lock, packages: Object.fromEntries(keys.map((k) => [k, packages[k]])) };
}

function git(repo, ...args) {
  return spawnSync("git", args, { cwd: repo, encoding: "utf8" });
}

function main() {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dir = path.join(repo, ADDON);
  const args = process.argv.slice(2);
  const npmLockPath = path.join(repo, NPM_LOCK);
  const npmLock = JSON.parse(readFileSync(npmLockPath, "utf8"));
  if (args.includes("--lock")) {
    const missing = missingBinaries(npmLock);
    const meta = (name, version) => {
      // one command line through the shell, npm being a .cmd on Windows (as verify.mjs runs it)
      const r = spawnSync(`npm view ${name}@${version} --json`, { encoding: "utf8", shell: true });
      if (r.status !== 0) throw new Error(`npm view ${name}@${version}: ${r.stderr.trim()}`);
      return JSON.parse(r.stdout);
    };
    writeFileSync(npmLockPath, JSON.stringify(withBinaries(npmLock, meta), null, 2) + "\n");
    console.log(`ha-addon: ${missing.length} binaries added to ${NPM_LOCK}${missing.map((m) => `\n  ${m.at} ${m.version}`).join("")}`);
    return;
  }
  const missing = missingBinaries(npmLock);
  if (missing.length > 0) {
    console.error(`ha-addon: ${NPM_LOCK} lacks the binaries of the add-on's image (${missing.map((m) => m.name).join(", ")}): run with --lock`);
    process.exit(1);
  }
  if (!args.includes("--no-build") && !args.includes("--release")) {
    const workspace = path.join(repo, "libs", "nspanel-sim");
    console.log("ha-addon: compiling the app");
    // npm is a .cmd on Windows, which Node starts only through a shell: one command line, as verify.mjs does
    const r = spawnSync("npm run build --workspace=@nspanel-sim/sim", { cwd: workspace, stdio: "inherit", shell: true });
    if (r.status !== 0) {
      console.error("ha-addon: the app did not compile");
      process.exit(1);
    }
    const app = path.join(dir, "app");
    for (const name of readdirSync(app)) if (name !== ".keep") rmSync(path.join(app, name), { recursive: true, force: true });
    cpSync(path.join(workspace, "sim", "dist"), app, { recursive: true });
    console.log(`ha-addon: the app is in ${ADDON}/app`);
  }
  if (!existsSync(path.join(dir, "app", "index.html"))) {
    console.error(`ha-addon: ${ADDON}/app holds no app: run this without --no-build`);
    process.exit(1);
  }
  const lockPath = path.join(dir, LOCK);
  const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, "utf8")) : null;
  const changelogPath = path.join(dir, "CHANGELOG.md");
  const version = versionOf(readFileSync(path.join(dir, "config.yaml"), "utf8"));
  const tag = `v${version}`;
  const released = git(repo, "rev-parse", "-q", "--verify", `refs/tags/${tag}`).status === 0;
  const print = fingerprint(dir);
  const v = verdict({ version, print, lock, changelog: existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : "", released });
  if (args.includes("--release")) {
    if (released) {
      console.error(`ha-addon: version ${version} is released already (tag ${tag})`);
      process.exit(1);
    }
    // the tag is what Home Assistant compiles: the package and the app's source committed, and the lock the package's
    const dirty = git(repo, "status", "--porcelain", "--ignore-submodules=dirty", "--", ...RELEASED_PATHS).stdout.trim();
    if (dirty) {
      console.error(`ha-addon: commit the package and the app's source before the release:\n${dirty}`);
      process.exit(1);
    }
    if (!v.ok || !lock || lock.version !== version || lock.fingerprint !== print) {
      console.error(`ha-addon: ${v.ok ? "the lock is not the package's: run this without --release, and commit its lock" : v.message}`);
      process.exit(1);
    }
    const t = git(repo, "tag", "-a", tag, "-m", `HouseWeave ${version}`);
    if (t.status !== 0) {
      console.error(`ha-addon: ${t.stderr.trim()}`);
      process.exit(1);
    }
    console.log(`ha-addon: version ${version} is tagged ${tag}; push it: git push origin ${tag}`);
    return;
  }
  console.log(`ha-addon: ${v.message}`);
  if (!v.ok) process.exit(1);
  if (v.lock) writeFileSync(lockPath, JSON.stringify(v.lock, null, 2) + "\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
