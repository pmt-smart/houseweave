// The Berry of the panel and of the bridge as the devices compile it: globals by
// name, and strict (xdrv_52_9_berry.ino), which every simulated device sets before
// it loads anything.
//
// Strict is checked by the boot itself: a file the device would refuse leaves a
// "failed to load" in the log. What a boot cannot see is a function that the
// compiler gets wrong without saying so. Past 256 constants in one function, a
// constant no longer fits in the instruction, and more than one of the
// compiler's ways around that goes wrong (firmware/tasmota/lib/libesp32/berry/
// src/be_code.c):
//   - a global read by name goes through a register (`GETNGBL Rn Rm`, the name
//     loaded into Rm) and its value lands in the register after, so a call
//     that takes the global as an argument gets its NAME -- `f(g1, g2)`
//     receives "g1" and the value of g1, and `o.m()` calls a method of "o";
//   - an `import` whose name is loaded that way leaves the register count one
//     off, and a `for` after it calls the module's name as its iterator.
// So no function of the panel's, nor of the bridge's relay, may pass
// 256 constants: `K255` is the last. None does today; a view grows with every case,
// and this fails before the device does. (The generated project is data, a
// .jsonl the runtime reads, and has no functions of its own.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { SimPanel, SimBridge, BRAIN_FILES, BRIDGE_FILES } from "../dist/index.js";
import { repoFiles, bridgeFiles, livingRoomConfig } from "../dist/files-node.js";

/** the class each file names, by the line it names it with */
const classOf = (src) => /^#@\s*solidify:(\w+)/m.exec(src)[1];
/** a constant past the 256th, or a global by name through a register: the defect's marks */
const DEFECT = /\bK(25[6-9]|2[6-9]\d|[3-9]\d\d|\d{4,})\b|\b[GS]ETNGBL\s+R\d+\s+R\d+/;

/** the classes, with every method and every function inside one: solidify writes their bytecode out, one instruction a line */
function classesClean(device, names) {
  for (const name of names) {
    const code = device.vm.run(
      `import solidify\nimport global\nvar f = open("/dump.h", "w")\nsolidify.dump(global.${name}, true, f)\nf.close()`,
      "dump",
    );
    assert.equal(code, 0, `${name}: ${device.vm.error()}`);
    const text = device.vm.readFile("/dump.h");
    assert.match(text, new RegExp(`Solidified class: ${name}\\b`), `${name}: nothing was dumped`);
    const hit = text.split("\n").find((l) => DEFECT.test(l));
    assert.equal(hit, undefined, `${name}: ${hit}`);
  }
}

/** the top level of every file, which is a function of its own, as the device's log gets its dump */
function filesClean(device, log, sources) {
  for (const [file, src] of Object.entries(sources)) {
    log.length = 0;
    device.vm.writeFile("/probe.be", src);
    const code = device.vm.run(
      `import debug\nvar fh = open("/probe.be")\nvar src = fh.read()\nfh.close()\ndebug.codedump(compile(src))`,
      "codedump",
    );
    assert.equal(code, 0, `${file}: ${device.vm.error()}`);
    assert.ok(log.some((l) => /\bRET\b/.test(l)), `${file}: nothing was dumped`);
    const hit = log.find((l) => DEFECT.test(l));
    assert.equal(hit, undefined, `${file}: ${hit}`);
  }
}

for (const project of ["p1-living-room-eu-landscape", "p1-living-room-us-portrait"]) {
  test(`${project}: no function of the panel's Berry passes 256 constants`, async () => {
    const log = [];
    const files = repoFiles(project);
    const panel = await SimPanel.create({
      files,
      project,
      persist: { panel_config: livingRoomConfig() },
      relays: [true, true],
      onLog: (_level, line) => log.push(line),
    });
    panel.advance(100);
    assert.ok(!log.some((l) => /failed to load/.test(l)), log.filter((l) => /failed/.test(l)).join("\n"));
    classesClean(panel, Object.values(files.brain).map(classOf));
    filesClean(panel, log, { "autoexec.be": files.flash["autoexec.be"], ...Object.fromEntries(BRAIN_FILES.map((f) => [f, files.brain[f]])) });
  });
}

test("the bridge: no function of its relay's Berry passes 256 constants", async () => {
  const log = [];
  const files = bridgeFiles();
  const bridge = await SimBridge.create({ files, onLog: (_level, line) => log.push(line) });
  bridge.advance(100);
  assert.ok(!log.some((l) => /failed to load/.test(l)), log.filter((l) => /failed/.test(l)).join("\n"));
  classesClean(bridge, BRIDGE_FILES.map((f) => classOf(files.brain[f])));
  filesClean(bridge, log, { "autoexec.be": files.flash["autoexec.be"], ...Object.fromEntries(BRIDGE_FILES.map((f) => [f, files.brain[f]])) });
});
