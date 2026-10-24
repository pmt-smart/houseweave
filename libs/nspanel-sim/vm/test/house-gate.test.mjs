// The buttons of a device of another room are not there while its bridge is not ready (berry/panel_gate.be, berry/panel_route.be), end
// to end: a house of three bridges and two panels on one mesh and on the firmware's own cipher, each with the repo's Berry brain booted. The panel 4 shows a lamp of the bridge 2
// and one of the bridge 3, and has the gate in front of them.
//
//   G1  with the bridges in step the gate lets the devices through, and a command goes
//   G2  the bridge 2 is cut off: its device is held, at the latest when the mesh calls it silent, the command is refused and not sent, and the device of the bridge 3 is not
//   G3  the bridge 2 comes back: the device is held until it is in step for two heartbeats, and then let go, and the command goes
//   G4  a device of no bridge numbered is never held, and goes to the bridge of the house
//   G5  a bridge two hops away is heard by the neighbour whose heartbeat lists it: its device is let through, and the command gets there
//   G6  a bridge three hops away is heard by its presence: its device is let through, the command gets there, and its state comes back
import { test } from "node:test";
import assert from "node:assert/strict";
import { meshIsolate, meshHeal, meshRestart } from "../dist/index.js";
import { whole } from "./house-world.mjs";

const REAL = { air: { cipher: "real" } };
const LAMP2 = "0x00124B0000F30001";
const LAMP3 = "0x00124B0000F30002";
const OWN = "0x00124B0000F30003";

const spec = (ieee) => ({ ieee, model: "TS0505B", caps: 3, ct: [0, 0], endpoint: 1, relay: 0 });

const PANEL = `
import json
import global
global._store = PanelStore(nil)
global._zone = global._store.create_zone("home", "Room", [0, 0], [3, 3])["value"]
for id: ["${LAMP2}", "${LAMP3}", "${OWN}"]
  global._store.register_device([id, "Lamp", "light", 3, 0, 0, "", 1, 0, 0])
  global._store.add_to_zone(global._zone, id)
end
global._store.set_owner("${LAMP2}", 2)
global._store.set_owner("${LAMP3}", 3)
global._held = {}
global._mc = MeshCmd(nil)
global._gate = PanelGate(global._store, def (ieee, off) if off global._held[ieee] = true else global._held.remove(ieee) end end)
global._route = PanelRoute(global._store, global._mc)
global._route.own = / -> 1
global._route.gate = global._gate
global.house.state.wanted = / -> global._store.remote_by_owner()
global.house.state.deliver = / r -> nil
def mt_held() var l = [] for k: global._held.keys() l.push(k) end return json.dump(l) end
def mt_send(l) return global._route.send(l) end
def mt_refused() return json.dump(global._route.refused) end
`;

async function house() {
  const h = await whole(REAL);
  h.dev(2).zigbee.add(spec(LAMP2));
  h.dev(3).zigbee.add(spec(LAMP3));
  h.dev(1).zigbee.add(spec(OWN));
  assert.equal(h.dev(4).vm.run(PANEL, "panel-probes"), 0, h.dev(4).vm.error());
  return {
    ...h,
    held: () => JSON.parse(h.berry(4, "mt_held()").v).sort(),
    send: (ieee) => h.berry(4, `mt_send('ZbSend {"Device":"${ieee}","Send":{"Power":1}}')`).v,
    refused: () => JSON.parse(h.berry(4, "mt_refused()").v),
  };
}

test("with the bridges in step the gate lets the devices through, and a command goes", async () => {
  const h = await house();
  h.run(30_000);
  assert.deepEqual(h.held(), [], "nothing is held: the bridges 2 and 3 are in step");
  assert.equal(h.send(LAMP2), true);
  assert.equal(h.send(LAMP3), true);
  h.run(2000);
  assert.equal(h.dev(2).zigbee.find(LAMP2).power, 1);
  assert.equal(h.dev(3).zigbee.find(LAMP3).power, 1);
});

test("the bridge 2 is cut off: its device is held and the command is refused and not sent; the bridge 3's is not", async () => {
  const h = await house();
  h.run(30_000);
  meshIsolate(h.home, 2);
  h.run(40_000);
  assert.deepEqual(h.held(), [LAMP2], "the lamp of the bridge 2 is held, the bridge 3's is not");
  assert.equal(h.send(LAMP2), false, "a command to it is refused");
  assert.equal(h.refused()["bridge not ready"], 1, "and the reason is counted");
  h.run(2000);
  assert.equal(h.dev(2).zigbee.find(LAMP2).power, 0, "and nothing was sent");
  assert.equal(h.send(LAMP3), true, "the other bridge's lamp is acted on");
  assert.equal(h.berry(4, "global._gate.reason('" + LAMP2 + "')").v, "Bridge off");
});

test("the bridge 2 comes back: the device is held until the bridge is in step for two heartbeats", async () => {
  const h = await house();
  h.run(30_000);
  meshIsolate(h.home, 2);
  h.run(40_000);
  assert.deepEqual(h.held(), [LAMP2]);
  meshHeal(h.home);
  h.run(300);
  assert.deepEqual(h.held(), [LAMP2], "the instant it is heard again the device is still held");
  h.run(30_000);
  assert.deepEqual(h.held(), [], "and is let go once the bridge has been in step for two heartbeats");
  assert.equal(h.send(LAMP2), true, "and the command goes");
  h.run(2000);
  assert.equal(h.dev(2).zigbee.find(LAMP2).power, 1);
});

test("a device of no bridge numbered is never held, and goes to the bridge of the house", async () => {
  const h = await house();
  meshIsolate(h.home, 2);
  meshIsolate(h.home, 3);
  h.run(60_000);
  assert.deepEqual(h.held(), [LAMP2, LAMP3], "both of the bridges' are held");
  assert.equal(h.berry(4, `global._gate.available('${OWN}')`).v, true, "the device of no bridge numbered is not");
  assert.equal(h.send(OWN), true, "and goes to the bridge of the house, over the mesh");
  h.run(2000);
  assert.equal(h.dev(1).zigbee.find(OWN).power, 1, "which runs it");
});

test("a bridge the panel has never heard, two hops away: its device is let through, by the neighbour whose heartbeat lists it, and the command gets there (the bench, 2026-10-18)", async () => {
  const h = await house();
  h.run(30_000);
  // the panel on the radio alone, as the bench's panels are (EspNowMeshNetwork 0); its mesh starts again out of the bridge 2's reach, which the others hear
  h.berry(4, "tasmota.cmd('EspNowMeshNetwork 0')");
  h.run(10_000);
  meshRestart(h.dev(4));
  h.home.mesh.air.unlink(4, 2);
  h.run(60_000);
  const by = h.berry(4, "global.house.heard_by(2)").v;
  assert.equal(by?.state, 0, "the panel hears the bridge 2");
  assert.ok(by?.far === true || by?.id !== 2, "not as a neighbour: by its presence, or by the neighbour that lists it");
  assert.deepEqual(h.held(), [], "and does not hold its lamp");
  assert.equal(h.send(LAMP2), true, "a command to it goes");
  h.run(2000);
  assert.equal(h.dev(2).zigbee.find(LAMP2).power, 1, "and gets there, two hops away");
  meshIsolate(h.home, 2);
  h.run(60_000);
  assert.deepEqual(h.held(), [LAMP2], "the bridge 2 cut off from all: held, though the mesh may keep a way back to it");
});

test("a bridge three hops away is heard by its presence: its device is let through, the command gets there, and its state comes back", async () => {
  const h = await house();
  h.run(30_000);
  // every node on the radio alone, as the bench's are (EspNowMeshNetwork 0); then a chain, 4 - 5 - 3 - 2, and 1 beside 3: the bridge 2 is three hops from
  // the panel 4, the bridge 3 two
  for (const id of [1, 2, 3, 4, 5]) h.berry(id, "tasmota.cmd('EspNowMeshNetwork 0')");
  h.run(10_000);
  for (const id of [1, 2, 3, 4, 5]) meshRestart(h.dev(id));
  for (const [a, b] of [[4, 1], [4, 2], [4, 3], [5, 1], [5, 2], [1, 2]]) h.home.mesh.air.unlink(a, b);
  h.run(90_000);
  const by = h.berry(4, "global.house.heard_by(2)").v;
  assert.equal(by?.id, 2, "the panel 4 hears the bridge 2 itself");
  assert.equal(by?.far, true, "by its presence");
  assert.equal(by?.state, 0, "fresh");
  assert.deepEqual(h.held(), [], "and holds neither lamp, the one two hops away nor the one three");
  const heard = h.berry(4, "global.house.state.heard").v;
  assert.ok(heard > 0, "the panel marked the lamps and has their state");
  assert.equal(h.send(LAMP2), true, "a command to the lamp three hops away goes");
  h.run(3000);
  assert.equal(h.dev(2).zigbee.find(LAMP2).power, 1, "and gets there");
  assert.ok(h.berry(4, "global.house.state.heard").v > heard, "and its new state comes back");
  meshIsolate(h.home, 2);
  h.run(60_000);
  assert.deepEqual(h.held(), [LAMP2], "the bridge 2 cut off from all: held once its presence is old");
});
