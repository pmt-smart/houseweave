#!/usr/bin/env node
// Compiles the host test of the serial bridge's Sonoff WTS01 decoding (host_test.cpp) and runs it:
//
//   node firmware/host-tests/serial-bridge-wts01/run.mjs
//
// The driver (firmware/tasmota/tasmota/tasmota_xdrv_driver/xdrv_08_serial_bridge.ino) is included as it is, over the stand-ins of host_stubs.h for
// Tasmota and its serial port. The compiler is the emscripten SDK, found as the simulator's build finds it: the folder EMSDK names, or the tools/emsdk
// folder beside the repository. Exit code 0 when every check passes. See README.md.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");
const driverDir = join(repo, "firmware/tasmota/tasmota/tasmota_xdrv_driver");
const build = join(here, ".build");

const driver = join(driverDir, "xdrv_08_serial_bridge.ino");
if (!existsSync(driver)) {
  console.error(`the driver is not at ${relative(repo, driver)}: the submodule is not checked out (git submodule update --init firmware/tasmota)`);
  process.exit(2);
}

const emsdk = process.env.EMSDK ?? join(repo, "../tools/emsdk");
const win = process.platform === "win32";
const tool = (name) => [".exe", ".bat", ""].map((x) => join(emsdk, "upstream/emscripten", name + x)).find(existsSync) ?? join(emsdk, "upstream/emscripten", name + ".exe");
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

mkdirSync(build, { recursive: true });
const out = join(build, "host_test.cjs");
const compile = spawnSync(empp, [
  "-std=c++17", "-O1", "-g", "-Wall", "-Wextra", "-Wno-unused-function", "-Wno-unused-variable", "-Wno-unused-parameter", "-Wno-unused-const-variable",
  `-I${join(here, "inc")}`, `-I${here}`, `-I${driverDir}`,
  join(here, "host_test.cpp"), "-o", out,
  "-sENVIRONMENT=node", "-sNODERAWFS=1", "-sALLOW_MEMORY_GROWTH=1",
], { env, encoding: "utf8", shell: empp.endsWith(".bat"), maxBuffer: 1 << 26 });
if (compile.status !== 0) {
  process.stderr.write(`${compile.stdout ?? ""}${compile.stderr ?? ""}`);
  console.error("compiling the host test failed");
  process.exit(1);
}

const run = spawnSync(process.execPath, [out, ...process.argv.slice(2)], { encoding: "utf8", maxBuffer: 1 << 26 });
process.stdout.write(run.stdout ?? "");
process.stderr.write(run.stderr ?? "");
process.exit(run.status ?? 1);
