// The alarm's replica sees the bridges three hops away by their presence (berry/house_mesh.be, heard_all), end to end on the house of three
// bridges and two panels of house-world.mjs, each with the repo's Berry brain booted, every node on the radio alone and the radio cut into a chain:
// 1 - 4 - 5 - 2, with 3 beside 5 and 2. The bridge 1 has no bridge for a neighbour, and is three hops from the others.
//
//   AF1  the replica of the bridge 1 counts the three bridges, the two far ones by their presence, and an arm made on the bridge 2 reaches it
//   AF2  the bridge 1, which did not hear the flood of an arm, has it from the digest in the others' presence: no heartbeat of a bridge reaches it
import { test } from "node:test";
import assert from "node:assert/strict";
import { meshRestart } from "../dist/index.js";
import { whole } from "./house-world.mjs";

async function chain() {
  const h = await whole({ air: { cipher: "real" } });
  h.run(30_000);
  for (const id of [1, 2, 3, 4, 5]) h.berry(id, "tasmota.cmd('EspNowMeshNetwork 0')");
  h.run(10_000);
  // the mesh of each starts again with its links: the cuts come after
  for (const id of [1, 2, 3, 4, 5]) meshRestart(h.dev(id));
  for (const [a, b] of [[1, 2], [1, 3], [1, 5], [2, 4], [3, 4]]) h.home.mesh.air.unlink(a, b);
  h.run(90_000);
  return h;
}
const st = (h, id) => h.berry(id, "global.zbbridge_relay.alarm.st").v;
const reach = (h, id) => h.berry(id, "global.zbbridge_relay.alarm.mesh.reach()").v;
const arm = (h, id) => h.berry(id, `global.zbbridge_relay.alarm.cmd({"do": "arm", "mode": "away", "by": "panel"})`).v;

test("the replica of a bridge three hops from the others counts them, by their presence, and an arm made on another bridge reaches it", async () => {
  const h = await chain();
  assert.equal(h.berry(1, "global.zbbridge_relay.house.heard_by(2)['far']").v, true, "the bridge 1 hears the bridge 2 by its presence");
  assert.deepEqual(reach(h, 1).slice(0, 2), [3, 3], "its replica counts the three bridges, the two far ones too");
  arm(h, 2);
  h.run(3000);
  assert.notEqual(st(h, 1), "disarmed", "an arm on the bridge 2 reaches the bridge 1, three hops away");
});

test("a bridge three hops from the others that did not hear the flood of an arm has it from the digest in their presence", async () => {
  const h = await chain();
  // everything the bridge 1 hears is lost for four seconds: the flood of the arm with it
  for (const from of [2, 3, 4, 5]) h.home.mesh.air.setLinkLoss(from, 1, 1);
  arm(h, 2);
  h.run(4000);
  assert.equal(st(h, 1), "disarmed", "the bridge 1 did not hear the arm");
  for (const from of [2, 3, 4, 5]) h.home.mesh.air.setLinkLoss(from, 1, undefined);
  h.run(40_000);
  assert.notEqual(st(h, 1), "disarmed", "and has it from the digest in the others' presence, with no bridge for a neighbour");
});
