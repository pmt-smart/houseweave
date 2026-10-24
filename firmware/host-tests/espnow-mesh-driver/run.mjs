#!/usr/bin/env node
// Compiles the host test of the ESP-NOW mesh driver (host_test.cpp) and runs it:
//
//   node firmware/host-tests/espnow-mesh-driver/run.mjs
//
// The driver (firmware/tasmota/tasmota/tasmota_xdrv_driver/xdrv_98_1_espnow_mesh.ino) is included as it is, over the stand-ins of host_stubs.h for the
// ESP-IDF, FreeRTOS, NVS, Tasmota and Berry, and its core (tasmota/include/espnow_mesh_core.h and espnow_mesh_crypto.h) is the firmware's own. The cipher needs
// BearSSL, which is compiled from the submodule's copy, once, into .build/. The compiler is the emscripten SDK, found as the simulator's build finds it:
// the folder EMSDK names, or the tools/emsdk folder beside the repository. Exit code 0 when every check passes. See README.md.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");
const include = join(repo, "firmware/tasmota/tasmota/include");
const driverDir = join(repo, "firmware/tasmota/tasmota/tasmota_xdrv_driver");
const bearssl = join(repo, "firmware/tasmota/lib/lib_ssl/bearssl-esp8266/src");
const build = join(here, ".build");

for (const [what, path] of [["the core", join(include, "espnow_mesh_core.h")], ["the driver", join(driverDir, "xdrv_98_1_espnow_mesh.ino")], ["BearSSL", join(bearssl, "aead/ccm.c")]]) {
  if (!existsSync(path)) {
    console.error(`${what} is not at ${relative(repo, path)}: the submodule is not checked out (git submodule update --init firmware/tasmota)`);
    process.exit(2);
  }
}

const emsdk = process.env.EMSDK ?? join(repo, "../tools/emsdk");
const win = process.platform === "win32";
const tool = (name) => [".exe", ".bat", ""].map((x) => join(emsdk, "upstream/emscripten", name + x)).find(existsSync) ?? join(emsdk, "upstream/emscripten", name + ".exe");
const emcc = tool("emcc");
const empp = tool("em++");
if (!existsSync(empp)) {
  console.error(`emscripten not found at ${emsdk}: install it (https://emscripten.org) and set EMSDK to its folder`);
  process.exit(2);
}
const pick = (dir) => (existsSync(dir) ? readdirSync(dir).map((d) => join(dir, d)).find((d) => statSync(d).isDirectory()) : undefined);
const pyDir = pick(join(emsdk, "python"));
const nodeDir = pick(join(emsdk, "node"));
const env = {
  ...process.env,
  EMSDK: emsdk,
  EMSDK_PYTHON: process.env.EMSDK_PYTHON ?? (pyDir ? join(pyDir, win ? "python.exe" : "bin/python3") : "python3"),
  ...(nodeDir ? { EMSDK_NODE: join(nodeDir, win ? "node.exe" : "bin/node") } : {}),
  EM_CONFIG: join(emsdk, ".emscripten"),
  PATH: [emsdk, join(emsdk, "upstream/emscripten"), process.env.PATH].join(win ? ";" : ":"),
};
const shell = (exe) => exe.endsWith(".bat");

/** runs a tool, shows what it said only when it fails */
function sh(exe, args, what) {
  const r = spawnSync(exe, args, { env, encoding: "utf8", shell: shell(exe), maxBuffer: 1 << 26 });
  if (r.status !== 0) {
    process.stderr.write(`${r.stdout ?? ""}${r.stderr ?? ""}`);
    console.error(`${what} failed`);
    process.exit(1);
  }
}

// BearSSL, the part of it the mesh's cipher uses, as C, a file at a time (the same files the simulator's build compiles)
const sources = ["aead/ccm.c", "symcipher/aes_ct_ctrcbc.c", "symcipher/aes_ct_ctr.c", "symcipher/aes_ct.c", "kdf/hkdf.c", "mac/hmac.c", "hash/sha2small.c", "ec/ec_c25519_m15.c", "symcipher/aes_ct_enc.c", "codec/dec32be.c", "codec/enc32be.c", "codec/dec32le.c", "codec/enc32le.c", "codec/ccopy.c"];
const objDir = join(build, "obj");
mkdirSync(objDir, { recursive: true });
const objects = [];
for (const src of sources) {
  const obj = join(objDir, src.replace(/[\\/]/g, "_").replace(/\.c$/, ".o"));
  if (!existsSync(obj)) sh(emcc, ["-O2", "-Wno-everything", `-I${bearssl}`, "-c", join(bearssl, src), "-o", obj], `compiling ${src}`);
  objects.push(obj);
}

const out = join(build, "host_test.cjs");
sh(empp, [
  "-std=c++17", "-O1", "-g", "-Wall", "-Wextra", "-Wno-unused-function", "-Wno-unused-variable", "-Wno-unused-parameter", "-Wno-unused-const-variable",
  `-I${join(here, "inc")}`, `-I${here}`, `-I${include}`, `-I${driverDir}`, `-I${bearssl}`,
  join(here, "host_test.cpp"), ...objects, "-o", out,
  "-sENVIRONMENT=node", "-sNODERAWFS=1", "-sALLOW_MEMORY_GROWTH=1", "-sSTACK_SIZE=1048576",
], "compiling the host test");

const run = spawnSync(process.execPath, [out, ...process.argv.slice(2)], { encoding: "utf8", maxBuffer: 1 << 26 });
process.stdout.write(run.stdout ?? "");
process.stderr.write(run.stderr ?? "");
process.exit(run.status ?? 1);
