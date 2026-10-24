// The key of a bridge's Zigbee network, on the relay's own Berry and the simulator's Z2T: a
// network the Z2T formed on its own has a key made of the chip's address (the same 64 bits in both halves, which the Wi-Fi and
// the beacons say aloud), and a bridge whose network has no device yet takes a random one, once, before a lamp joins.
//
//   K1  a new bridge, no device on its network: a random key, ZbConfig restarting the bridge, and nothing again after
//   K2  a bridge whose network has devices keeps the key it has: a new one would leave the lamps orphaned
//   K3  a random key already is left alone
//   K4  the PAN IDs a first boot derives (the radio held, the MAC read as zero) are drawn with the key, in the same restart
//   K5  a random key with the derived PAN IDs: the PAN IDs alone, once
import { test } from "node:test";
import assert from "node:assert/strict";
import { SimBridge, SimHouse } from "../dist/index.js";
import { bridgeFiles } from "../dist/files-node.js";

/** a bridge on a network, so that its pairing window does not hold it for the first minutes: what a boot with a saved Wi-Fi does */
async function bridge(zigbee, lamps = 0) {
  const house = new SimHouse();
  const printed = [];
  const b = await SimBridge.create({ house, files: bridgeFiles(), wifi: { ssid1: "Cottage" }, zigbee, onLog: (level, line) => printed.push([level, line]) });
  for (let i = 0; i < lamps; i++) b.zigbee.add({ ieee: `0x00124B00AAAA00${i.toString(16).padStart(2, "0")}`, model: "TRADFRI bulb", caps: 0, ct: [153, 500], endpoint: 1, relay: 0 });
  return { house, b, printed };
}

test("a new bridge, no device on its network, takes a random key, once, and the restart does not ask for another", async () => {
  const { house, b } = await bridge({ keyDerived: true });
  assert.equal(b.zigbee.keyL, b.zigbee.keyH, "the key it formed with is made of the address: the halves are the same");
  house.advance(15_000);
  assert.deepEqual(b.restarts, [], "it looks at the key 20 s after boot, and not before");
  house.advance(15_000);
  assert.deepEqual(b.restarts, ["ZbConfig"], "and then ZbConfig with a zero key restarts the bridge");
  assert.notEqual(b.zigbee.keyL, b.zigbee.keyH, "two different halves: the chip's random generator's");
  assert.notEqual(b.zigbee.keyL, "0x6F0000AA01020304", "and not the one of the address");
  assert.notEqual(b.zigbee.panId, "0x0001", "the PAN ID drawn in the same restart (K4)");
  assert.ok(!b.zigbee.extPanId.startsWith("0xCCCCCCCC"), "and the extended one, not the derived one");
  const key = [b.zigbee.keyL, b.zigbee.keyH];
  const again = await b.reboot({ house, files: bridgeFiles(), wifi: { ssid1: "Cottage" } });
  again.advance(120_000);
  assert.deepEqual(again.restarts, [], "the bridge that came back asks for nothing");
  assert.deepEqual([again.zigbee.keyL, again.zigbee.keyH], key, "and its network is on the key it took");
});

test("a bridge whose network has devices keeps a key made of the address, and the log says why", async () => {
  const { house, b, printed } = await bridge({ keyDerived: true }, 3);
  const key = [b.zigbee.keyL, b.zigbee.keyH];
  house.advance(60_000);
  assert.deepEqual(b.restarts, [], "no restart");
  assert.deepEqual([b.zigbee.keyL, b.zigbee.keyH], key, "the key is the one it had");
  assert.ok(printed.some(([, line]) => /has devices: its identity and its channel stay/.test(line)), "and the log says that it stays, and why");
});

test("a random key is left alone", async () => {
  const { house, b } = await bridge({});
  const key = [b.zigbee.keyL, b.zigbee.keyH];
  assert.notEqual(key[0], key[1]);
  house.advance(120_000);
  assert.deepEqual(b.restarts, [], "no restart");
  assert.deepEqual([b.zigbee.keyL, b.zigbee.keyH], key, "and the same key");
});

test("two bridges out of their boxes on the bench, both with the identity of a radio held at the first boot, end on different PAN IDs", async () => {
  const one = await bridge({ keyDerived: true });
  const two = await bridge({ keyDerived: true });
  assert.deepEqual([one.b.zigbee.panId, two.b.zigbee.panId], ["0x0001", "0x0001"], "the bench of 2026-10-17: the same PAN ID on both");
  one.house.advance(30_000);
  two.house.advance(30_000);
  assert.deepEqual([one.b.restarts, two.b.restarts], [["ZbConfig"], ["ZbConfig"]], "each restarts once, the key and the PAN IDs in one ZbConfig");
  const pan = Number(one.b.zigbee.panId);
  assert.ok(pan >= 1 && pan <= 0x3ffe, "a PAN ID in Z2T's range");
  assert.notEqual(one.b.zigbee.extPanId, two.b.zigbee.extPanId, "and two extended PAN IDs that are not the same");
});

test("a random key with the derived PAN IDs takes the PAN IDs alone, once", async () => {
  const { house, b } = await bridge({ panDerived: true });
  const key = [b.zigbee.keyL, b.zigbee.keyH];
  house.advance(30_000);
  assert.deepEqual(b.restarts, ["ZbConfig"], "one restart");
  assert.deepEqual([b.zigbee.keyL, b.zigbee.keyH], key, "the key it had");
  assert.notEqual(b.zigbee.panId, "0x0001", "and a PAN ID drawn");
  const again = await b.reboot({ house, files: bridgeFiles(), wifi: { ssid1: "Cottage" } });
  again.advance(120_000);
  assert.deepEqual(again.restarts, [], "the bridge that came back asks for nothing");
});
