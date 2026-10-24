// The Berry class the test stubs of berry/test stand in for, asked the same questions where it really runs: Tasmota's own
// timers (tasmota_class.be), on the VM the simulator's devices have. berry/test/test_stub_timers.be holds the stub's timers
// to what these say: a stub that disagrees with the firmware's own class hides the defects of
// the code that runs on it, and this is where the firmware's answer is read, not remembered.
//
// Its persist (persist.be) is held to in berry/test/test_stub_persist.be, which runs the firmware's own file over a file
// system that fails: this VM's file system cannot say what the firmware's does when a write fails, because its stdio
// buffers the write and loses the failure (the save of a map of 40 KB, its second write refused, comes back as saved), where the firmware's raises io_error out of f.write.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SimBridge, SimHouse } from "../dist/index.js";
import { bridgeFiles } from "../dist/files-node.js";

/** a bridge with nothing paired, its Berry running, and a way to ask it things: what its code prints comes back as lines */
async function device() {
  const house = new SimHouse();
  const printed = [];
  const bridge = await SimBridge.create({ house, files: bridgeFiles(), onLog: (_level, line) => printed.push(line) });
  house.advance(1000);
  return { house, bridge, printed, say: (code) => {
    printed.length = 0;
    assert.equal(bridge.vm.run(code, "fidelity"), 0, bridge.vm.error());
    return [...printed];
  } };
}

test("ZbForget finds a device that ZbLeave took off the network, and takes it out of the list, as Z2T's does: the panel sends the one and then the other", async () => {
  const { bridge } = await device();
  const z = bridge.zigbee;
  const lamp = (ieee) => ({ ieee, model: "TRADFRI bulb", caps: 0, ct: [153, 500], endpoint: 1, relay: 0 });
  z.add(lamp("0x00124B00AAAA0001"));
  z.add(lamp("0x00124B00AAAA0002"));
  const said = (name, ieee) => JSON.parse(z.command(name, ieee))[name];
  assert.equal(said("ZbLeave", "0x00124B00AAAA0001"), "Done", "the lamp is asked to leave");
  assert.deepEqual(z.devices.map((d) => [d.ieee, d.joined]), [["0x00124B00AAAA0001", false], ["0x00124B00AAAA0002", true]], "it is off the network and still in the list");
  assert.equal(said("ZbLeave", "0x00124B00AAAA0001"), "Unknown device", "a device that left cannot be asked to leave again");
  assert.equal(said("ZbForget", "0x00124B00AAAA0001"), "Done", "but it can be forgotten");
  assert.deepEqual(z.devices.map((d) => d.ieee), ["0x00124B00AAAA0002"], "and it is out of the list");
  assert.equal(said("ZbForget", "0x00124B00AAAA0001"), "Unknown device", "a device not in the list is unknown");
  assert.equal(said("ZbForget", "0x00124B00AAAA0002"), "Done", "and one still on the network is forgotten as well");
  assert.deepEqual(z.devices, [], "which leaves the list empty");
});

test("Tasmota's timers stack: two of one id are two, remove_timer(id) takes out every one, and a one shot is gone once it ran", async () => {
  const { house, say } = await device();
  say(`import global
global.ran = []
def tag(s) return / -> global.ran.push(s) end
tasmota.set_timer(100, tag("a"), "x")
tasmota.set_timer(300, tag("b"), "x")
tasmota.set_timer(200, tag("c"), "y")
global.count = def (id) var n = 0 for t: tasmota._timers if t.id == id n += 1 end end return n end`);
  assert.equal(say(`print(global.count("x"), global.count("y"))`)[0], "2 1", "two timers of an id are two: the second did not replace the first");
  house.advance(150);
  assert.equal(say(`print(global.ran)`)[0], "['a']", "and the first fires at its time, the second still pending");
  assert.equal(say(`print(global.count("x"))`)[0], "1", "a timer that ran is gone: one shot");
  say(`tasmota.set_timer(500, tag("d"), "x")
tasmota.set_timer(500, tag("e"), "x")`);
  assert.equal(say(`print(global.count("x"))`)[0], "3");
  say(`tasmota.remove_timer("x")`);
  assert.equal(say(`print(global.count("x"), global.count("y"))`)[0], "0 1", "remove_timer takes out every timer of the id, and no other");
  house.advance(1000);
  assert.equal(say(`print(global.ran)`)[0], "['a', 'c']", "and what was removed never runs");
});

test("Tasmota's timers run in the order they were set when due together, and one set by a timer that runs, and due, runs in the same pass", async () => {
  const { house, say } = await device();
  say(`import global
global.ran = []
def tag(s) return / -> global.ran.push(s) end
tasmota.set_timer(100, tag("first"), "p")
tasmota.set_timer(100, tag("second"), "q")
tasmota.set_timer(100, def () global.ran.push("third") tasmota.set_timer(0, tag("again"), "r") end, "p")`);
  house.advance(200);
  assert.equal(say(`print(global.ran)`)[0], "['first', 'second', 'third', 'again']", "in the order set, then what they set");
});

test("set_timer refuses a bound method where it wants a closure, as the firmware's does", async () => {
  const { say } = await device();
  const out = say(`class Holder
  def go() end
  def method() return self.go end
end
try
  tasmota.set_timer(10, Holder().method())
  print("accepted")
except .. as e
  print(e)
end
tasmota.set_timer(10, / -> Holder().go())
print("closure accepted")`);
  assert.deepEqual(out, ["type_error", "closure accepted"]);
});

test("the free heap is what the device says, 128 KB as the panel's boots, and a test lowers it where the code under test waits for heap", async () => {
  const { bridge, say } = await device();
  assert.equal(say(`print(tasmota.memory()["heap_free"], tasmota.memory("heap_max"), tasmota.get_free_heap())`)[0], "128 110 131072");
  bridge.heapFreeKb = 25;
  assert.equal(say(`print(tasmota.memory()["heap_free"], tasmota.get_free_heap())`)[0], "25 25600");
  bridge.heapFreeKb = 10;
  assert.equal(say(`print(tasmota.memory("heap_max"))`)[0], "0", "and the largest block is not below zero");
});
