// The scenario helpers (src/scenario.ts): a node loses its power or restarts, the radio goes quiet for a node, a pair or the
// house, a share of the frames is lost, the router goes away. Each is what the bench's tests do, in a line,
// over what a house and an air already had; these tests hold what each does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Air, SimHouse, SimBridge, IDEAL_TIMING, IDEAL_LOOP, powerFailure, restart, quiet, loss, routerOff, routerOn } from "../dist/index.js";
import { bridgeFiles } from "../dist/files-node.js";

const A = "A0A0A0000001";
const B = "B0B0B0000001";
const text = (mac) => mac.match(/../g).join(":");

/** two radios with the same key and each other's address, on channel 6, the link up */
async function linked() {
  const air = new Air();
  air.timing = IDEAL_TIMING;
  const a = await air.device(A, 11);
  const b = await air.device(B, 22);
  for (const [dev, peer] of [[a, B], [b, A]]) {
    dev.set("mode", 1);
    dev.set("channel", 6);
    dev.cmd(`EspNowPeerMac ${text(peer)}`);
    dev.cmd("EspNowSecret2 a secret of the bench");
    dev.cmd("EspNowEnable 1");
  }
  assert.ok(air.until(() => [a, b].every((d) => d.cmd("EspNowStatus").EspNowStatus.PeerKnown === 1), 3000), "the link comes up");
  return { air, a, b };
}

/** the events of a kind a device has taken from its queue so far */
const heard = (dev) => dev.eventsOf("Word").map((e) => e.n);

test("quiet: a pair, a node or the whole air hears nothing for the time given, and then everything again", async () => {
  const { air, a, b } = await linked();
  const send = (n) => a.cmd(`EspNowEvent {"Word":{"n":${n}}}`);
  send(1);
  air.run(50);
  assert.deepEqual(heard(b), [1], "before: heard");
  const q = quiet(air, 2000, { between: [a, b] });
  send(2);
  air.run(50);
  assert.deepEqual(heard(b), [1], "in the quiet: the frame never arrives, and nothing is said to the sender");
  assert.ok(q.dropped >= 1, `and the fault counts what it took: ${q.dropped}`);
  air.run(2100);
  send(3);
  air.run(50);
  assert.deepEqual(heard(b), [1, 3], "after its time: heard again (the link went on: nothing here is a restart)");
  // a node's scope is every frame of it, both ways; a quiet that is ended says no more
  const node = quiet(air, 60000, { node: b });
  send(4);
  b.cmd('EspNowEvent {"Word":{"n":40}}');
  air.run(50);
  assert.deepEqual([heard(b), heard(a)], [[1, 3], []], "a node that is quiet neither hears nor is heard");
  node.end();
  send(5);
  air.run(50);
  assert.deepEqual(heard(b), [1, 3, 5], "ended before its time, the air is as it was");
  // the whole air, and nothing else in the scope
  const all = quiet(air, 500);
  send(6);
  air.run(50);
  all.end();
  assert.deepEqual(heard(b), [1, 3, 5], "the whole house quiet: no frame of anyone");
});

test("loss: a share of the frames is lost, drawn from a seed, so that the same run is the same run; the scope narrows it", async () => {
  const run = async (rate, seed, scope) => {
    const { air, a, b } = await linked();
    const l = loss(air, rate, seed, scope?.(a, b));
    for (let i = 0; i < 400; i++) {
      a.cmd(`EspNowEvent {"Word":{"n":${i}}}`);
      air.run(10);
    }
    air.run(100);
    return { dropped: l.dropped, heard: heard(b) };
  };
  const first = await run(0.3, 7);
  assert.ok(first.dropped > 0.2 * 400 && first.dropped < 0.4 * 400, `about 30% of 400 lost: ${first.dropped}`);
  assert.equal(first.heard.length + first.dropped, 400, "every frame is lost or heard, and each event is one frame");
  assert.deepEqual(await run(0.3, 7), first, "the same seed, the same loss, frame by frame");
  assert.notDeepEqual((await run(0.3, 8)).heard, first.heard, "another seed, another loss");
  const none = await run(0, 7);
  assert.deepEqual([none.dropped, none.heard.length], [0, 400], "no loss is no loss");
  // only the frames of a, to b: the replies of the link are b's and none is lost
  const narrow = await run(1, 7, (a, b) => ({ only: (f) => f.from === a.mac && f.hex.startsWith("21") }));
  assert.deepEqual([narrow.dropped, narrow.heard.length], [400, 0], "every event of a is lost, and the link's own frames (a different kind) are not");
});

test("a node that loses its power is gone for the time and comes back from its flash, its clock lost; a restart keeps the clock; the house goes on without it", async () => {
  const house = new SimHouse({ air: IDEAL_TIMING, loop: IDEAL_LOOP });
  const make = (n) => SimBridge.create({ house, files: bridgeFiles(), mac: `A0:B7:65:77:00:0${n}`, ip: `192.168.0.6${n}`, hostname: `zbbridge-${n}`, epoch: Date.UTC(2026, 9, 12, 12, 0, 0) / 1000 });
  let one = await make(1);
  const two = await make(2);
  house.advance(5000);
  one.vm.run("import persist persist.kept_word = 42 persist.save()", "word");
  assert.equal(one.wifi.up, true, "on the network");
  const rtc = (d) => JSON.parse(d.vm.call("sim_cmd", "Time"))?.Epoch ?? 0;
  assert.ok(rtc(one) > 1_700_000_000, "it knows the time");
  const before = one;
  const stood = house.devices.length;
  const back = powerFailure(house, one, 8000);
  assert.ok(!house.devices.includes(before), "while it has no power it is not in the house");
  one = await back;
  assert.notEqual(one, before, "a new node, from its flash");
  assert.equal(house.devices.length, stood, "and the house has it again");
  assert.equal(house.now, 13000, "the house went on 8 s without it");
  assert.equal(JSON.parse(one.vm.readFile("/_persist.json")).kept_word, 42, "what it kept is in its flash");
  assert.ok(rtc(one) < 1_700_000_000, `and its clock was lost with the power: ${rtc(one)}`);
  house.advance(10000);
  assert.equal(one.wifi.up, true, "it is on the network again");
  // a restart, now: the clock stays, the flash too
  house.advance(3000);
  const hadTime = rtc(one);
  const again = await restart(one);
  assert.notEqual(again, one);
  assert.equal(JSON.parse(again.vm.readFile("/_persist.json")).kept_word, 42);
  assert.ok(Math.abs(rtc(again) - hadTime) <= 1, `a restart keeps the clock the RTC kept: ${rtc(again)} for ${hadTime}`);
  assert.ok(house.devices.includes(two) && house.devices.includes(again) && !house.devices.includes(one), "the old node is out of the house and the new one in");
});

test("the router goes away: every station leaves its network and the connections of it end, and when it is back they join again", async () => {
  const house = new SimHouse({ air: IDEAL_TIMING, loop: IDEAL_LOOP });
  const bridge = await SimBridge.create({ house, files: bridgeFiles() });
  house.advance(8000);
  assert.equal(bridge.wifi.up, true);
  routerOff(house);
  house.advance(3000);
  assert.equal(bridge.wifi.up, false, "no access point in range: the station is off its network");
  routerOn(house);
  house.advance(20000);
  assert.equal(bridge.wifi.up, true, "the access point back: Tasmota's WiFi joins again");
});
