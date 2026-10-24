#!/usr/bin/env node
// Runs a Berry file on the WebAssembly VM, the way the vendored berry.exe runs
// one: what it prints goes to stdout, and an uncaught exception exits 1.
//
//   node scripts/run-berry.mjs [-s] [-g] [--mount /virtual=C:/real/dir]... /virtual/file.be
//
// -s and -g are the REPL's: strict mode, and globals by name.
//
// The VM sees only what is mounted: a folder of this machine at a path of its
// own, so a test written for berry.exe runs unchanged once its paths point
// there (berry/test/run.mjs --vm=wasm does the pointing).

import { loadBerry } from "../dist/node.js";

const args = process.argv.slice(2);
const mounts = [];
let file;
let strict = false;
let namedGlobals = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--mount") mounts.push(args[++i].split("="));
  else if (args[i] === "-s") strict = true;
  else if (args[i] === "-g") namedGlobals = true;
  else file = args[i];
}
if (!file) {
  console.error("usage: run-berry.mjs [--mount /virtual=real]... file.be");
  process.exit(2);
}
const vm = await loadBerry({ print: (s) => process.stdout.write(s + "\n") });
vm.compiler({ namedGlobals, strict });
for (const [virtual, real] of mounts) vm.mount(virtual, real);
const source = vm.readFile(file);
const code = vm.run(source, file);
// exitCode, not exit(): an abrupt exit while stdout drains trips an assertion in
// libuv on Windows ("UV_HANDLE_CLOSING", src/win/async.c)
process.exitCode = code === 0 ? 0 : 1;

