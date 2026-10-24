// The brain as the firmware build takes it, and the bridge's
// relay too, which its own image compiles in the same way.
//
// The build compiles each file of the brain into the flash with Tasmota's
// custom_berry_solidify: it runs every file's top level in a Berry VM of its
// own, and then writes into the firmware the class the file's `#@ solidify:`
// line names, and nothing else. So whatever a file does at its top level
// besides declaring that class happens in the build and never on the panel: a
// module imported there is a global the panel does not have ('string'
// undeclared, the first time a method runs), and an instance built or a command
// registered there is nowhere. The simulator loads the files as files, where
// all of that works. These checks hold each file to what survives the build:
//   - one `#@ solidify:` line, naming the one class the file declares;
//   - it compiles, strict and with globals by name as the device compiles, in a
//     VM whose only globals are the firmware's and the brain's classes: a
//     method that names a module imports it itself;
//   - its top level, run in a VM with none of Tasmota in it, declares that
//     class and nothing else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Berry, BRAIN_FILES, BRIDGE_FILES } from "../dist/index.js";
import { REPO } from "../dist/files-node.js";

/** the globals of the firmware's Berry that the brain names: Tasmota's */
const FIRMWARE = ["tasmota", "log", "serial", "tcpclient", "webclient", "gpio", "light", "wire1", "wire2", "udp",
  // the backup's HTTP (panel_http.be): the asynchronous TCP client
  "tcpclientasync"];

const read = (f) => readFileSync(join(REPO, "berry", f), "utf8");
const sources = Object.fromEntries([...new Set([...BRAIN_FILES, ...BRIDGE_FILES])].map((f) => [f, read(f)]));
const named = (src) => [...src.matchAll(/^#@\s*solidify:([A-Za-z0-9_]+)(,[a-z]+)*[ \t]*\r?$/gm)].map((m) => m[1]);
const declared = (src) => [...src.matchAll(/^class\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
const CLASSES = BRAIN_FILES.map((f) => named(sources[f])[0]);
const BRIDGE_CLASSES = BRIDGE_FILES.map((f) => named(sources[f])[0]);

/**
 * A VM as the build's is, strict with globals by name, with only these
 * declared, and a way to run a file's top level there that leaves no global of
 * its own behind.
 */
async function vmWith(globals) {
  const printed = [];
  const vm = await Berry.create({ print: (l) => printed.push(l) });
  vm.compiler({ namedGlobals: true, strict: true });
  // Driver is a class: four of the brain's extend it, and a class needs its
  // superclass when its file's top level runs
  const prelude = [
    "import global",
    "class Driver end",
    ...globals.map((n) => `global.${n} = nil`),
    "def _top(name) var fh = open(name) var src = fh.read() fh.close() compile(src)() end",
    "def _compile(name) var fh = open(name) var src = fh.read() fh.close() compile(src) end",
    "def _globals() var out = [] for n: global() out.push(n) end return out end",
  ].join("\n");
  assert.equal(vm.run(prelude, "prelude"), 0, vm.error());
  return { vm, printed };
}

for (const [who, files, classes] of [["the brain", BRAIN_FILES, CLASSES], ["the bridge's relay", BRIDGE_FILES, BRIDGE_CLASSES]]) {
  test(`every file of ${who} names the one class it declares`, () => {
    for (const f of files) {
      assert.equal(named(sources[f]).length, 1, `${f}: one #@ solidify: line`);
      assert.deepEqual(declared(sources[f]), [named(sources[f])[0]], `${f}: the class its line names, and no other`);
    }
    assert.equal(new Set(classes).size, classes.length, "no two files name the same class");
  });

  test(`every file of ${who} compiles without a module or anything else as a global`, async () => {
    const { vm } = await vmWith([...FIRMWARE, ...classes]);
    for (const f of files) {
      vm.writeFile(`/${f}`, sources[f]);
      assert.equal(vm.run(`_compile("/${f}")`, f), 0, `${f}: ${vm.error()}`);
    }
  });

  test(`the top level of every file of ${who} declares its class and does nothing else`, async () => {
    for (const f of files) {
      // tasmota and the natives are there to be named, and are nil: a top level
      // that called one fails here, where the build would take the call and the
      // device would never see it
      const { vm, printed } = await vmWith([...FIRMWARE, ...classes]);
      vm.writeFile(`/${f}`, sources[f]);
      const probe = [
        "var _before = _globals()",
        `_top("/${f}")`,
        "var _new = []",
        'for n: _globals() if _before.find(n) == nil && n != "_before" && n != "_new" _new.push(n) end end',
        'print("NEW " + _new.concat(","))',
      ].join("\n");
      assert.equal(vm.run(probe, f), 0, `${f}: ${vm.error()}`);
      assert.equal(printed.find((l) => l.startsWith("NEW ")), "NEW ", `${f}: its top level left a global of its own`);
      const cls = named(sources[f])[0];
      assert.equal(vm.run(`if type(global.${cls}) != "class" raise "value_error", "a " + type(global.${cls}) end`, "class"), 0,
        `${f}: ${cls} is not a class after its top level: ${vm.error()}`);
    }
  });
}

test("the boot knows every class of the brain, to say which ones run from a file", () => {
  const listed = /static CLASSES = \[([^\]]*)\]/.exec(sources["panel_boot.be"]);
  assert.ok(listed, "panel_boot.be lists the brain's classes");
  assert.deepEqual([...listed[1].matchAll(/"(\w+)"/g)].map((m) => m[1]).sort(), [...CLASSES].sort());
});

/** An env's `custom_berry_solidify`, as the list of files it names. */
function solidifyOf(env) {
  const ini = readFileSync(join(REPO, "firmware/overrides/platformio_override.ini"), "utf8");
  const section = env === null ? ini : ini.slice(ini.indexOf(`[env:${env}]`));
  assert.ok(env === null || ini.includes(`[env:${env}]`), `platformio_override.ini has the env ${env}`);
  const listed = /^custom_berry_solidify[ \t]*=[ \t]*(.*(?:\r?\n[ \t]+[^;\r\n]\S*)*)/m.exec(section);
  assert.ok(listed, `platformio_override.ini names the files of ${env ?? "the brain"}`);
  return listed[1].split(/\s+/).filter(Boolean);
}

test("the firmware compiles in the files the simulator loads, the build's prelude first", () => {
  const files = solidifyOf(null);
  assert.equal(files[0], "../overrides/_brain_prelude.be");
  // panel_build.be goes in as the copy the build stamps with its commit (panel_build.py)
  const path = (f) => (f === "panel_build.be" ? "../overrides/generated/panel_build.be" : `../../berry/${f}`);
  assert.deepEqual(files.slice(1), BRAIN_FILES.map(path));
});

test("the bridge's image compiles in its relay's files and no part of the panel's brain but the build's stamp, the prelude first", () => {
  const files = solidifyOf("tasmota32-houseweave-bridge");
  assert.equal(files[0], "../overrides/_brain_prelude.be");
  // the build's stamp, which the house's Info of a node says (house_mesh.be), goes in as the panel's does: the copy the build stamps
  const path = (f) => (f === "panel_build.be" ? "../overrides/generated/panel_build.be" : `../../berry/${f}`);
  assert.deepEqual(files.slice(1), BRIDGE_FILES.map(path));
  // the autoexec.be of the bridge loads a fix of any of them, in this order
  const autoexec = read("zbbridge_autoexec.be");
  const loads = /for f: \[([^\]]*)\]/.exec(autoexec);
  assert.ok(loads, "zbbridge_autoexec.be names the relay's files");
  assert.deepEqual([...loads[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]), BRIDGE_FILES);
});

// The build's script registers the class it finds after the FIRST "#@ solidify:"
// of a file, anywhere in it and with anything after it (solidify-from-url.py,
// addEntryToModtab): a comment that quotes the directive above the real one
// registers the comment, and the firmware does not compile. Its `.*` is Python's,
// which stops at a line feed only: a file with CRLF registers "Brain\r", and
// the build's modules.h does not compile either.
test("the class the firmware build registers for each file is the file's class", () => {
  const prelude = readFileSync(join(REPO, "firmware/overrides/_brain_prelude.be"), "utf8");
  const registered = (src) => /(?<=#@ solidify:)[^\n]*/.exec(src)?.[0].split(",")[0];
  assert.equal(registered(prelude), "BrainPrelude", "the prelude's own");
  for (const f of [...BRAIN_FILES, ...BRIDGE_FILES]) assert.equal(registered(sources[f]), named(sources[f])[0], f);
});
