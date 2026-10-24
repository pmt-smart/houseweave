#!/usr/bin/env node
// Compiles the host test of ESP-NOW OTA (host_test.cpp) and runs it:
//
//   node firmware/host-tests/espnow-ota-receiver/run.mjs
//
// The receiver and its display (firmware/tasmota/tasmota/tasmota_xdrv_driver/xdrv_98_5_espnow_ota_receiver.ino and xdrv_98_6_espnow_ota_display.ino)
// and the sender (xdrv_98_7_espnow_ota_sender.ino) are included as they are, over the stand-ins of host_stubs.h for the ESP-IDF, the ROM's inflater,
// FreeRTOS, Arduino, the HTTP client, the mesh driver and Tasmota; their Ed25519 is the firmware's (tasmota/include/ed25519.h), their hashes BearSSL and
// the sender's JSON the fork's JsonParser, compiled from the submodule, once, into .build/. Before it runs, the release tool
// (scripts/ota-release.mjs) packs an image into .build/fixture/, signed with RFC 8032's first test key, which the sender sends the receiver over a
// simulated radio: the same files a release is. The compiler is the emscripten SDK, found as the simulator's build finds it: the folder EMSDK names,
// or the tools/emsdk folder beside the repository. Exit code 0 when every check passes. See README.md.
import { spawnSync } from "node:child_process";
import { createPrivateKey } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");
const tasmota = join(repo, "firmware/tasmota/tasmota");
const driverDir = join(tasmota, "tasmota_xdrv_driver");
const bearssl = join(repo, "firmware/tasmota/lib/lib_ssl/bearssl-esp8266/src");
const jsmn = join(repo, "firmware/tasmota/lib/default/jsmn-shadinger-1.0/src");
const build = join(here, ".build");

for (const [what, path] of [["the receiver", join(driverDir, "xdrv_98_5_espnow_ota_receiver.ino")], ["the sender", join(driverDir, "xdrv_98_7_espnow_ota_sender.ino")],
  ["Ed25519", join(tasmota, "include/ed25519.h")], ["BearSSL", join(bearssl, "hash/sha2big.c")], ["JsonParser", join(jsmn, "JsonParser.cpp")]]) {
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

// BearSSL, the part of it the receiver uses (SHA-256, SHA-512, HMAC, HKDF), as C, and the fork's JsonParser, as C++, a file at a time
const sources = ["hash/sha2small.c", "hash/sha2big.c", "mac/hmac.c", "kdf/hkdf.c", "codec/dec32be.c", "codec/enc32be.c", "codec/dec64be.c", "codec/enc64be.c"];
const objDir = join(build, "obj");
mkdirSync(objDir, { recursive: true });
const objects = [];
for (const src of sources) {
  const obj = join(objDir, src.replace(/[\\/]/g, "_").replace(/\.c$/, ".o"));
  if (!existsSync(obj)) sh(emcc, ["-O2", "-Wno-everything", `-I${bearssl}`, "-c", join(bearssl, src), "-o", obj], `compiling ${src}`);
  objects.push(obj);
}
for (const src of ["jsmn.cpp", "JsonParser.cpp"]) {
  const obj = join(objDir, `jsmn_${src.replace(/\.cpp$/, ".o")}`);
  if (!existsSync(obj)) sh(empp, ["-std=c++17", "-O2", "-Wno-everything", `-I${join(here, "inc")}`, `-I${jsmn}`, "-c", join(jsmn, src), "-o", obj], `compiling ${src}`);
  objects.push(obj);
}

// The image the sender sends, packed by the release tool as a release is: the deterministic bytes, the manifest and the blocks
const { manifestText, packImage, signFile } = await import(pathToFileURL(join(repo, "scripts/ota-release.mjs")).href);
const fixture = join(build, "fixture");
mkdirSync(join(fixture, "living.ota"), { recursive: true });
const image = Buffer.alloc(200000);
for (let i = 0, s = 7; i < image.length; i++) {
  s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
  image[i] = i % 3000 < 1800 ? "Tasmota mesh image ".charCodeAt(i % 19) : s >>> 24;
}
image[0] = 0xe9;
const b64url = (h) => Buffer.from(h, "hex").toString("base64url");
const rfcKey = createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", d: b64url("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"),
  x: b64url("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a") }, format: "jwk" });
const packed = packImage(image, rfcKey);
writeFileSync(join(fixture, "image.bin"), image);
writeFileSync(join(fixture, "living.ota", "manifest.json"), manifestText("image.bin", packed.manifest));
writeFileSync(join(fixture, "living.ota", "blocks.bin"), packed.blocks);
// and the manifest of the largest image a sender takes, 48 blocks of noise, which the sender's JSON parser must read whole
const noise = Buffer.alloc(48 * 65536);
for (let i = 0, s = 5; i < noise.length; i++) {
  s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
  noise[i] = s >>> 24;
}
const largest = packImage(noise, rfcKey);
mkdirSync(join(fixture, "largest.ota"), { recursive: true });
writeFileSync(join(fixture, "largest.ota", "manifest.json"), manifestText("tasmota32-houseweave-living-room-us-0123abcd+-4567cdef+.bin", largest.manifest));
writeFileSync(join(fixture, "largest.ota", "total"), String(largest.blocks.length));
// and a safeboot image, signed whole as the tool signs one, and once more under a key no build carries (RFC 8032's third)
const safeboot = Buffer.alloc(300000);
for (let i = 0, s = 11; i < safeboot.length; i++) {
  s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
  safeboot[i] = s >>> 24;
}
safeboot[0] = 0xe9;
const otherKey = createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", d: b64url("c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7"),
  x: b64url("fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025") }, format: "jwk" });
writeFileSync(join(fixture, "safeboot.bin"), safeboot);
writeFileSync(join(fixture, "safeboot.bin.sig.json"), JSON.stringify({ file: "safeboot.bin", ...signFile(safeboot, rfcKey) }, null, 2) + "\n");
writeFileSync(join(fixture, "safeboot-other.sig.json"), JSON.stringify({ file: "safeboot.bin", ...signFile(safeboot, otherKey) }, null, 2) + "\n");
// and the same app image packed under that key, a release no build takes
const other = packImage(image, otherKey);
mkdirSync(join(fixture, "other.ota"), { recursive: true });
writeFileSync(join(fixture, "other.ota", "manifest.json"), manifestText("image.bin", other.manifest));
writeFileSync(join(fixture, "other.ota", "blocks.bin"), other.blocks);

const out = join(build, "host_test.cjs");
sh(empp, [
  "-std=c++17", "-O1", "-g", "-Wall", "-Wextra", "-Wno-unused-function", "-Wno-unused-variable", "-Wno-unused-parameter", "-Wno-unused-const-variable",
  `-I${join(here, "inc")}`, `-I${here}`, `-I${tasmota}`, `-I${driverDir}`, `-I${bearssl}`, `-I${jsmn}`,
  join(here, "host_test.cpp"), ...objects, "-o", out,
  "-sENVIRONMENT=node", "-sNODERAWFS=1", "-sALLOW_MEMORY_GROWTH=1", "-sSTACK_SIZE=1048576",
], "compiling the host test");

const run = spawnSync(process.execPath, [out, fixture, ...process.argv.slice(2)], { encoding: "utf8", maxBuffer: 1 << 26 });
process.stdout.write(run.stdout ?? "");
process.stderr.write(run.stderr ?? "");
process.exit(run.status ?? 1);
