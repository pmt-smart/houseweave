#!/usr/bin/env node
// Builds the ESP-NOW mesh core of the firmware into WebAssembly: vm/wasm/mesh.mjs.
//
//   node scripts/build-mesh-wasm.mjs
//
// The source is the firmware submodule's own header (tasmota/include/espnow_mesh_core.h),
// compiled as it is, with native/mesh_sim.cpp, which gives a host the nodes it needs. It
// needs emscripten, as build-wasm.mjs does (EMSDK names its folder; the default is
// the tools/emsdk folder beside the repository). The result is committed, so nobody else needs the SDK.
//
// With MESH_SANITIZE_OUT=<file.mjs> it builds instead a copy of the module with the address and the
// undefined-behaviour sanitizers on, to that file, and writes nothing else: for fuzzing the core, which
// parses frames from the air (vm/test/mesh-fuzz.test.mjs runs it when the file is there).
//
// With MESH_VARIANT_OUT=<file.mjs> it builds a copy of the module to that file and writes nothing else, and MESH_DEFINES="NAME=VALUE ..." gives the compiler
// defines (either of the two builds takes them), for the studies of a build with another constant: MESH_DEFINES=ESPNOW_MESH_MAX_HOPS=3 is the core as it left with
// 3 repeats, which scripts/mesh-hops-matrix.mjs sets against this one. MESH_INCLUDE=<dir> takes espnow_mesh_core.h and espnow_mesh_crypto.h from that directory
// and not from the fork's: the core of an earlier commit, for scripts/mesh-clock-matrix.mjs.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, "..");
const repo = join(pkg, "../../..");
const include = process.env.MESH_INCLUDE ?? join(repo, "firmware/tasmota/tasmota/include");
const out = join(pkg, "wasm");

const emsdk = process.env.EMSDK ?? join(repo, "../tools/emsdk");
const win = process.platform === "win32";
const tool = (name) => [".exe", ".bat", ""].map((x) => join(emsdk, "upstream/emscripten", name + x)).find(existsSync) ?? join(emsdk, "upstream/emscripten", name);
const emcc = tool("emcc");
const empp = tool("em++");
if (!existsSync(empp)) {
  console.error(`emscripten not found at ${emsdk}: install it (https://emscripten.org) and set EMSDK`);
  process.exit(1);
}
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

const exported = ["_mesh_begin", "_mesh_send", "_mesh_send_routed", "_mesh_receive", "_mesh_next_tx", "_mesh_tx_done", "_mesh_tick", "_mesh_next_due",
  "_mesh_pop", "_mesh_pop_outcome", "_mesh_synced", "_mesh_request_sync", "_mesh_wants_sync", "_mesh_knows", "_mesh_stat", "_mesh_queued", "_mesh_busy", "_mesh_waiting",
  "_mesh_route_to", "_mesh_next_hop", "_mesh_send_parts", "_mesh_send_bulk_piece", "_mesh_set_info", "_mesh_set_deliver", "_mesh_deliver_enabled", "_mesh_neighbor", "_mesh_health", "_mesh_peer_role", "_mesh_epoch", "_mesh_counter", "_mesh_advance_counter", "_mesh_epoch_wanted", "_mesh_pop_notice", "_mesh_is_silent", "_mesh_noisy", "_mesh_loss_percent", "_mesh_set_udp", "_mesh_tag_as", "_mesh_identity", "_mesh_set_peer", "_mesh_forget", "_mesh_x25519", "_mesh_hmac", "_mesh_hkdf", "_mesh_ccm", "_mesh_ctr", "_mesh_max_payload", "_mesh_sizeof", "_mesh_crypto_sizeof", "_mesh_encode", "_mesh_decode", "_mesh_tag_matches", "_mesh_key_set", "_mesh_key_change", "_mesh_key_close", "_mesh_key_state", "_mesh_clock", "_mesh_clock_stamp", "_mesh_clock_age", "_mesh_pop_clock_event", "_malloc", "_free"];
mkdirSync(out, { recursive: true });

// BearSSL, the part of it the mesh's cipher uses, from the firmware's own copy: compiled as C, a file at a time, into objects
const bearssl = join(repo, "firmware/tasmota/lib/lib_ssl/bearssl-esp8266/src");
const sources = ["aead/ccm.c", "symcipher/aes_ct_ctrcbc.c", "symcipher/aes_ct_ctr.c", "symcipher/aes_ct.c", "kdf/hkdf.c", "mac/hmac.c", "hash/sha2small.c", "ec/ec_c25519_m15.c", "symcipher/aes_ct_enc.c", "codec/dec32be.c", "codec/enc32be.c", "codec/dec32le.c", "codec/enc32le.c", "codec/ccopy.c"];
const objDir = join(pkg, "wasm/.obj");
mkdirSync(objDir, { recursive: true });
const objects = [];
for (const src of sources) {
  const obj = join(objDir, src.replace(/[\\/]/g, "_").replace(/\.c$/, ".o"));
  const c = spawnSync(emcc, ["-O2", "-Wno-everything", `-I${bearssl}`, "-c", join(bearssl, src), "-o", obj], { cwd: pkg, env, encoding: "utf8", shell: emcc.endsWith(".bat") });
  process.stderr.write(c.stdout + c.stderr);
  if (c.status !== 0) process.exit(1);
  objects.push(obj);
}

const sanitizeOut = process.env.MESH_SANITIZE_OUT;
const variantOut = process.env.MESH_VARIANT_OUT;
const defines = (process.env.MESH_DEFINES ?? "").split(/\s+/).filter(Boolean).map((d) => "-D" + d);
const r = spawnSync(empp, [
  "-std=c++17", ...(sanitizeOut ? ["-O1", "-g", "-fsanitize=address,undefined", "-fno-omit-frame-pointer"] : ["-O2"]), "-Wall", "-Wextra", ...defines, `-I${include}`, `-I${bearssl}`, join(pkg, "native/mesh_sim.cpp"), ...objects, "-o", sanitizeOut ?? variantOut ?? join(out, "mesh.mjs"),
  "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sEXPORT_NAME=createMeshModule", "-sENVIRONMENT=web,worker,node", "-sSINGLE_FILE=1",
  "-sALLOW_MEMORY_GROWTH=1", `-sEXPORTED_FUNCTIONS=${exported.join(",")}`, "-sEXPORTED_RUNTIME_METHODS=HEAPU8",
], { cwd: pkg, env, encoding: "utf8", shell: empp.endsWith(".bat") });
process.stderr.write(r.stdout + r.stderr);
if (r.status !== 0) process.exit(1);
if (sanitizeOut) {
  console.log(`wrote the sanitized module to ${sanitizeOut}`);
  process.exit(0);
}
if (variantOut) {
  console.log(`wrote the variant module (${defines.join(" ") || "no defines"}) to ${variantOut}`);
  process.exit(0);
}

const git = (args, cwd) => spawnSync("git", args, { cwd, encoding: "utf8" }).stdout.trim();
const version = spawnSync(emcc, ["--version"], { env, encoding: "utf8", shell: emcc.endsWith(".bat") }).stdout.split("\n")[0].trim();
writeFileSync(join(out, "mesh.build.json"), JSON.stringify({
  mesh: { submodule: "firmware/tasmota", commit: git(["rev-parse", "HEAD"], join(repo, "firmware/tasmota")), header: "tasmota/include/espnow_mesh_core.h" },
  emscripten: version,
  bytes: statSync(join(out, "mesh.mjs")).size,
}, null, 2) + "\n");
console.log(`wrote ${relative(repo, join(out, "mesh.mjs"))} (${statSync(join(out, "mesh.mjs")).size} bytes)`);
