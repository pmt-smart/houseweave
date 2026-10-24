// The change of the network's key, from the panel that strikes a node off to every node that is left (berry/house_key.be, HouseKey), end to end on
// the firmware's own cipher: three bridges and two panels, each with the repo's Berry brain booted and a HouseMesh in it, the list of the house in every node.
//
//   K1  a panel strikes a node off: the key changes, every node that is left takes it from the panel in a frame only it can read, the change closes at every node, and the node struck off hears nothing
//   K2  a node that is cut off while the key changes takes it when it is heard again, and the change is pending (and says whom it waits for) until it has
//   K3  the same when the node was cut off for longer than the change has to reach the others: the sync, the key, the close
//   K4  the panel that carries the change out loses its power in the middle of it, and finishes when it is back
//   K5  what is not a panel's key is not taken: a bridge's, and a version that is not above the one the node has
//   K6  a second node struck off while the first change is open: the key changes again, and the nodes at the first take the second
//   K7  the owner closes a change that a node did not answer, and the node is left as it is
import { test } from "node:test";
import assert from "node:assert/strict";
import { meshIsolate, meshHeal } from "../dist/index.js";
import { whole } from "./house-world.mjs";

const REAL = { air: { cipher: "real" } };
const version = (h, id) => h.status(id).GroupVersion;
const previous = (h, id) => h.status(id).PrevVersion;
const pending = (h, id) => h.berry(id, "hm.key.pend == nil ? nil : hm.key.pend['v']").v;
const waiting = (h, id) => h.berry(id, "hm.key.waiting()").v;

/** the events of type 3 (a state of the application, to everyone) that a device's rules were told, by their data */
const events = (h, id) => h.dev(id).mesh.told.map((l) => JSON.parse(l).EspNowMesh).filter((e) => e.Type === 3 && e.Data !== undefined).map((e) => e.Data);
const say = (h, from, text) => h.berry(from, `espnow_mesh_send(255, 3, false, bytes().fromstring('${text}'))`);

test("a panel strikes a node off: every node that is left takes the new key, closes the change, and the node struck off hears nothing of the house", async () => {
  const h = await whole(REAL);
  for (const id of h.ids) assert.equal(version(h, id), 1, `node ${id} starts with the key of version 1`);
  assert.equal(h.berry(4, "hm.revoke(3)").v, true);
  assert.equal(version(h, 4), 2, "the panel has the new key at once");
  assert.equal(previous(h, 4), 1, "and the one it had as the previous");
  assert.equal(pending(h, 4), 2, "and a change to carry out");
  h.run(40_000);
  for (const id of [1, 2, 4, 5]) {
    assert.equal(version(h, id), 2, `node ${id} has the key of version 2`);
    assert.equal(previous(h, id), 0, `and has let the previous go`);
  }
  assert.equal(pending(h, 4), null, "the change is done at the panel");
  assert.equal(version(h, 3), 1, "the node struck off has the old key");
  // what flows under the new key: an event of a bridge reaches the others; and the old key reaches none of them
  say(h, 1, "novo");
  say(h, 3, "velho");
  h.run(3000);
  const hear = events(h, 2).map((d) => Buffer.from(d, "hex").toString());
  assert.ok(hear.includes("novo"), "the bridge 2 hears the bridge 1");
  assert.ok(!hear.includes("velho"), "and not the node that was struck off");
  assert.ok(h.status(2).PrevKeyDropped + h.status(2).Bad > 0, "which the others counted");
  // nobody printed the key
  const key = h.berry(4, "hm.key.pend").v;
  assert.equal(key, null, "no change is open, and so no key is kept");
  assert.ok(!h.logs.some((l) => /[0-9A-F]{64}/i.test(l.line)), "the key of the network is in no log line");
});

test("a node that is cut off while the key changes takes it when it is heard again, and the change waits for it", async () => {
  const h = await whole(REAL);
  meshIsolate(h.home, 2);
  assert.equal(h.berry(4, "hm.revoke(3)").v, true);
  h.run(40_000);
  for (const id of [1, 4, 5]) assert.equal(version(h, id), 2, `node ${id} has the new key`);
  assert.equal(pending(h, 4), 2, "the change is open at the panel");
  assert.deepEqual(waiting(h, 4), [2], "and it waits for the node that was cut off");
  assert.equal(previous(h, 4), 1, "the panel keeps its previous key while a node has not the new one: it closes its own when every node has the key");
  assert.equal(version(h, 2), 1);
  meshHeal(h.home);
  h.run(60_000);
  assert.equal(version(h, 2), 2, "the node that was cut off has the key");
  assert.equal(previous(h, 2), 0, "and has closed the change");
  assert.equal(pending(h, 4), null, "the change is done");
  say(h, 2, "voltei");
  h.run(3000);
  assert.ok(events(h, 5).map((d) => Buffer.from(d, "hex").toString()).includes("voltei"), "and it is heard");
});

test("a node that was cut off for longer than the change has to reach the others comes back with the key it had, is known again, and is given the key", async () => {
  const h = await whole(REAL);
  meshIsolate(h.home, 2);
  assert.equal(h.berry(4, "hm.revoke(3)").v, true);
  h.run(200_000);
  assert.equal(version(h, 2), 1);
  meshHeal(h.home);
  h.run(90_000);
  assert.equal(version(h, 2), 2, "the key reached the node after the 120 s the others had for it");
  assert.equal(pending(h, 4), null);
  assert.ok(h.status(1).PrevKeyHeard + h.status(4).PrevKeyHeard > 0, "the others let its frames through, under the previous key");
});

test("the panel that carries the change out loses its power in the middle of it, and finishes it when it is back", async () => {
  const h = await whole(REAL);
  meshIsolate(h.home, 2);
  assert.equal(h.berry(4, "hm.revoke(3)").v, true);
  h.run(20_000);
  assert.equal(pending(h, 4), 2);
  await h.power(4, 3000);
  h.load(4);
  h.run(20_000);
  assert.equal(version(h, 4), 2, "the panel has the key it gave itself");
  assert.equal(pending(h, 4), 2, "and the change it was carrying out, from the flash");
  assert.deepEqual(waiting(h, 4), [2]);
  meshHeal(h.home);
  h.run(60_000);
  assert.equal(version(h, 2), 2);
  assert.equal(pending(h, 4), null);
  for (const id of [1, 2, 4, 5]) assert.equal(previous(h, id), 0);
});

test("what is not a panel's key is not taken: a bridge's, and a version that is not above the one the node has", async () => {
  const h = await whole(REAL);
  const key = "11".repeat(32);
  // bridge 1 sends panel 5 a key of version 2, as a panel would
  assert.equal(typeof h.berry(1, `espnow_mesh_send(5, 6, false, bytes('230102' + '${key}'))`).v, "number");
  h.run(3000);
  assert.equal(version(h, 5), 1, "a bridge is not a panel: the key is not taken");
  // the panel 4 changes the key (a node 3 is struck off) and then a played-back frame of version 1 is sent: below the version in use, it is not taken
  assert.equal(h.berry(4, "hm.revoke(3)").v, true);
  h.run(40_000);
  assert.equal(version(h, 5), 2);
  assert.equal(typeof h.berry(4, `espnow_mesh_send(5, 6, false, bytes('230101' + '${key}'))`).v, "number");
  h.run(3000);
  assert.equal(version(h, 5), 2, "a version that is not above the one in use is not taken");
  // and one that is, from a panel, is: so the two refusals were of the rule and not of a frame that did not arrive
  assert.equal(typeof h.berry(4, `espnow_mesh_send(5, 6, false, bytes('230103' + '${key}'))`).v, "number");
  h.run(3000);
  assert.equal(version(h, 5), 3, "from a panel, a version above is taken");
});

test("a second node struck off while the first change is open: the key changes again, the nodes at the first take the second, and the node that never had the first has no way back", async () => {
  const h = await whole(REAL);
  meshIsolate(h.home, 2);
  assert.equal(h.berry(4, "hm.revoke(3)").v, true);
  h.run(30_000);
  assert.equal(version(h, 5), 2);
  assert.equal(h.berry(4, "hm.revoke(1)").v, true, "a second change is allowed while the first is open: a node was struck off with it");
  assert.equal(version(h, 4), 3, "the second change is the third key");
  assert.equal(previous(h, 4), 2, "and the previous key is the second");
  h.run(40_000);
  assert.equal(version(h, 5), 3, "the node at the second key takes the third");
  assert.deepEqual(waiting(h, 4), [2], "the change waits for the node that was cut off");
  meshHeal(h.home);
  h.run(90_000);
  // the node that was cut off has the key before the first change, and the panel's previous key is the second: the frame that brings the third can be checked by nobody
  // that has only the first (a second change leaves behind the node that did not take the first, and the button brings it back)
  assert.equal(version(h, 2), 1, "the node that never had the second key has no path back to the house");
  assert.deepEqual(waiting(h, 4), [2]);
  assert.equal(h.berry(4, "hm.key.finish()").v, true, "the owner closes the change");
  h.run(15_000);
  for (const id of [4, 5]) assert.equal(previous(h, id), 0, `node ${id} closed`);
});

test("the owner closes a change that a node did not answer, and the node is left as it is", async () => {
  const h = await whole(REAL);
  meshIsolate(h.home, 2);
  assert.equal(h.berry(4, "hm.revoke(3)").v, true);
  h.run(30_000);
  assert.deepEqual(waiting(h, 4), [2]);
  assert.equal(h.berry(4, "hm.key.finish()").v, true);
  assert.equal(pending(h, 4), null);
  assert.equal(previous(h, 4), 0, "the panel let go of the previous key");
  h.run(15_000);
  for (const id of [1, 5]) assert.equal(previous(h, id), 0, `and the nodes that had the key were told to close (${id})`);
  assert.equal(h.berry(4, "hm.key.finish()").v, false, "once");
  meshHeal(h.home);
  h.run(60_000);
  assert.equal(version(h, 2), 1, "the node that did not answer is left with the key it had: it needs the button");
});
