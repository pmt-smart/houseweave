#!/usr/bin/env node
// Builds the Berry VM of Tasmota into WebAssembly: vm/wasm/berry.mjs.
//
//   node scripts/build-wasm.mjs
//
// The sources are the firmware submodule's (firmware/tasmota/lib/libesp32):
// Berry itself, its regex, its mapping and int64 libraries, as the Berry
// Makefile builds the host interpreter the Berry tests run on. They are copied
// out first, into vm/.build (gitignored), because the Makefile's own step writes
// Berry's constant tables (`coc`) into its source tree, and the submodule stays
// untouched. On top of them, three files of this package: native/host.c, the
// bridge to the page; native/tasmota_core.cpp, which compiles the panel's
// button driver from the firmware's own source; and native/radio_core.cpp, which
// compiles the WiFi station and ESP-NOW drivers the same way, with the part of
// the firmware's BearSSL they use (lib_ssl, compiled where it is).
//
// Needs emscripten (https://emscripten.org). EMSDK names its folder; the default
// is the tools/emsdk folder beside the repository. The result
// is committed, so nobody else needs the SDK to run the simulator.
import { spawnSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, "..");
const repo = join(pkg, "../../..");
const lib = join(repo, "firmware/tasmota/lib/libesp32");
const driverDir = join(repo, "firmware/tasmota/tasmota/tasmota_xdrv_driver");
const stage = join(pkg, ".build");
const out = join(pkg, "wasm");

const emsdk = process.env.EMSDK ?? join(repo, "../tools/emsdk");
const win = process.platform === "win32";
// emcc.exe on Windows since emscripten 5; emcc.bat before
const tool = (name) => [".exe", ".bat", ""].map((x) => join(emsdk, "upstream/emscripten", name + x)).find(existsSync) ?? join(emsdk, "upstream/emscripten", name);
const emcc = tool("emcc");
const empp = tool("em++");
if (!existsSync(emcc)) {
  console.error(`emscripten not found at ${emsdk}: install it (https://emscripten.org) and set EMSDK`);
  process.exit(1);
}
// the SDK's own Python and node, as emsdk_env would set them
const pick = (dir) => (existsSync(dir) ? readdirSync(dir).map((d) => join(dir, d)).find((d) => statSync(d).isDirectory()) : undefined);
const pyDir = pick(join(emsdk, "python"));
const nodeDir = pick(join(emsdk, "node"));
const python = process.env.EMSDK_PYTHON ?? (pyDir ? join(pyDir, win ? "python.exe" : "bin/python3") : "python3");
const env = {
  ...process.env,
  EMSDK: emsdk,
  EMSDK_PYTHON: python,
  ...(nodeDir ? { EMSDK_NODE: join(nodeDir, win ? "node.exe" : "bin/node") } : {}),
  EM_CONFIG: join(emsdk, ".emscripten"),
  PATH: [emsdk, join(emsdk, "upstream/emscripten"), process.env.PATH].join(win ? ";" : ":"),
};

const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, env, encoding: "utf8", shell: cmd.endsWith(".bat") });
  if (r.status !== 0) {
    process.stderr.write(r.stdout + r.stderr);
    throw new Error(`${cmd} ${args.slice(0, 3).join(" ")}... failed`);
  }
  return r.stdout + r.stderr;
};

// --- the sources, out of the submodule --------------------------------------------------------
rmSync(stage, { recursive: true, force: true });
const copy = (from, to) => cpSync(join(lib, from), join(stage, "libesp32", to ?? from), { recursive: true });
copy("berry/src");
copy("berry/default");
copy("berry/tools/coc");
copy("re1.5");
copy("berry_mapping/src");
copy("berry_int64/src");
copy("berry_custom/src");
const berry = join(stage, "libesp32/berry");
mkdirSync(join(berry, "generate"), { recursive: true });

// Berry's constant tables for exactly these sources, as `make prebuild` makes them
const srcDirs = ["src", "default", "../re1.5", "../berry_mapping/src", "../berry_int64/src"];
run(python, ["tools/coc/coc", "-o", "generate", ...srcDirs, "-c", "default/berry_conf.h"], berry);

// --- compile ----------------------------------------------------------------------------------
const cflags = ["-std=c99", "-O2", "-DUSE_BERRY_INT64", "-ffp-contract=off", "-Wno-everything",
  ...["src", "default", "../re1.5", "../berry_mapping/src", "../berry_int64/src", "generate"].map((d) => `-I${join(berry, d)}`)];
const objDir = join(stage, "obj");
mkdirSync(objDir, { recursive: true });
const units = [];
for (const d of srcDirs) {
  for (const f of readdirSync(join(berry, d)).filter((f) => f.endsWith(".c"))) {
    // the REPL's main(): the page is this VM's host
    if (d === "default" && f === "berry.c") continue;
    units.push({ tool: emcc, src: join(berry, d, f), flags: cflags });
  }
}
units.push({ tool: emcc, src: join(pkg, "native/host.c"), flags: cflags });
units.push({ tool: empp, src: join(pkg, "native/tasmota_core.cpp"), flags: ["-std=c++17", "-O2", "-Wno-everything", `-I${driverDir}`, `-I${join(pkg, "native")}`] });
// The WiFi station and ESP-NOW drivers, from the firmware's own source, and the
// part of the firmware's BearSSL their HMAC and X25519 use, compiled where it is:
// nothing of it is written into.
const bearssl = join(repo, "firmware/tasmota/lib/lib_ssl/bearssl-esp8266/src");
units.push({ tool: empp, src: join(pkg, "native/radio_core.cpp"), flags: ["-std=c++17", "-O2", "-Wno-everything", "-DUSE_BERRY_INT64",
  `-I${driverDir}`, `-I${join(pkg, "native")}`, `-I${join(pkg, "native/idf")}`, `-I${bearssl}`,
  ...["src", "default", "generate"].map((d) => `-I${join(berry, d)}`)] });
for (const f of ["ec/ec_c25519_m15.c", "mac/hmac.c", "hash/sha2small.c", "codec/dec32be.c", "codec/enc32be.c", "codec/ccopy.c"]) {
  units.push({ tool: emcc, src: join(bearssl, f), flags: ["-std=c99", "-O2", "-Wno-everything", `-I${bearssl}`] });
}

const compile = (u) => new Promise((resolve, reject) => {
  const obj = join(objDir, relative(stage, u.src).replace(/[\\/:.]/g, "_") + ".o");
  const p = spawn(u.tool, [...u.flags, "-c", u.src, "-o", obj], { env, shell: u.tool.endsWith(".bat") });
  let err = "";
  p.stderr.on("data", (d) => (err += d));
  p.stdout.on("data", (d) => (err += d));
  p.on("close", (code) => (code === 0 ? resolve(obj) : reject(new Error(`${u.src}\n${err}`))));
});
const objs = [];
const queue = [...units];
const workers = Array.from({ length: Math.max(2, os.cpus().length) }, async () => {
  while (queue.length > 0) objs.push(await compile(queue.shift()));
});
await Promise.all(workers);
console.log(`compiled ${objs.length} units`);

// --- link -------------------------------------------------------------------------------------
mkdirSync(out, { recursive: true });
const exported = ["_bh_init", "_bh_compiler", "_bh_run", "_bh_call", "_bh_error", "_bh_btn_init", "_bh_btn_scan", "_bh_btn_command",
  "_bh_radio_init", "_bh_radio_set", "_bh_radio_tick", "_bh_radio_command", "_bh_radio_receive", "_bh_radio_draining", "_bh_radio_listening",
  "_bh_radio_state", "_bh_radio_x25519", "_bh_radio_hmac", "_malloc", "_free"];
run(empp, [
  "-O2", ...objs, "-o", join(out, "berry.mjs"), "-lnodefs.js",
  "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sEXPORT_NAME=createBerryModule",
  "-sENVIRONMENT=web,worker,node", "-sSINGLE_FILE=1", "-sFORCE_FILESYSTEM=1",
  "-sALLOW_MEMORY_GROWTH=1", "-sINITIAL_MEMORY=33554432", "-sSTACK_SIZE=2097152",
  `-sEXPORTED_FUNCTIONS=${exported.join(",")}`,
  "-sEXPORTED_RUNTIME_METHODS=FS,NODEFS,ccall,cwrap,UTF8ToString,stringToNewUTF8",
], pkg);

// where it came from, so a rebuild can be told apart from the one committed
const git = (args, cwd) => spawnSync("git", args, { cwd, encoding: "utf8" }).stdout.trim();
const version = run(emcc, ["--version"], pkg).split("\n")[0].trim();
writeFileSync(join(out, "build.json"), JSON.stringify({
  berry: { submodule: "firmware/tasmota", commit: git(["rev-parse", "HEAD"], join(repo, "firmware/tasmota")) },
  emscripten: version,
  bytes: statSync(join(out, "berry.mjs")).size,
}, null, 2) + "\n");
console.log(`wrote ${relative(repo, join(out, "berry.mjs"))} (${statSync(join(out, "berry.mjs")).size} bytes)`);

