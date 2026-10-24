// The list of the house on the mesh (berry/house_list.be, berry/house_mesh.be, berry/mesh_beat.be), end to end: three bridges and two panels on
// one mesh air (src/mesh-driver.ts), each with the repo's Berry brain booted and a HouseMesh made in it, as the pairing of a node that comes into the house will make one.
//
//   H1  a panel founds the house and writes the nodes into it; the others, given the first state as the pairing gives it, take the rest by their digests, and end with the same list
//   H2  a node that is not a panel writes nothing, and what a bridge says in the name of a panel is not taken
//   H3  a name written by another panel goes everywhere; two panels writing the same field end with one name, everywhere
//   H4  a node cut off from the mesh while the list changed has it when the mesh is whole again
//   H5  a node struck off is out of the driver's table of the others, and the list says it
//   H6  what a node holds is kept in the flash and is there after the power came back, with the driver not told the same twice
//   H7  the heartbeat carries the digest and the two bytes of the identity, and the alarm's replica and the house write into one buffer
//   H8  a bridge in a house has the alarm number the list gives it, not its number on the mesh
import { test } from "node:test";
import assert from "node:assert/strict";
import { meshIsolate, meshHeal } from "../dist/index.js";
import { house, founded, bridges, who, digest, ids, nameOf } from "./house-world.mjs";

test("a panel founds the house; the others take what it wrote after they were given the first state, by the digests, and end with one list", async () => {
  const h = await house();
  await founded(h);
  assert.deepEqual(ids(h, 4), [4, 5], "the founder has itself and the panel it wrote");
  assert.deepEqual(ids(h, 1), [4, 5], "a bridge was given the same");
  assert.equal(digest(h, 1), digest(h, 4), "with the same digest");
  bridges(h);
  assert.notEqual(digest(h, 1), digest(h, 4), "the panel wrote the bridges: its digest is another now");
  h.run(30_000);
  for (const id of h.ids) {
    assert.deepEqual(ids(h, id), [1, 2, 3, 4, 5], `node ${id} has the five nodes`);
    assert.equal(digest(h, id), digest(h, 4), `node ${id} has the digest of the panel that wrote`);
  }
  assert.equal(h.berry(1, "hm.list.node(2)['name']").v, "Bridge 2");
  assert.equal(h.berry(5, "hm.list.node(3)['slot']").v, 3, "the alarm number of the third bridge written is 3");
  assert.equal(h.berry(2, "hm.list.name()").v, "Cottage", "the name of the house");
  assert.equal(h.berry(1, "hm.list.node(1)['ip'].tohex()").v, "C0A80061");
});

test("a bridge writes nothing, and a frame of entries from a node that is not their author is not taken", async () => {
  const h = await house();
  await founded(h);
  bridges(h);
  h.run(30_000);
  const w = who(h, 3);
  assert.equal(h.berry(1, `hm.add_node(1, bytes('${w.key}'), bytes('${w.mac}'), nil, 'x', 9)`).v, 0, "a bridge cannot add a node");
  assert.equal(h.berry(1, "hm.rename(2, 'Stolen')").v, false, "nor rename one");
  assert.equal(h.berry(1, "hm.revoke(2)").v, false, "nor strike one off");
  assert.equal(h.berry(5, "hm.rename(9, 'x')").v, false, "a panel does not rename a node that is not in the house");
  // bridge 1 sends panel 5 entries in the name of panel 4: a new name for node 2, with a seq that would win
  const forged = "bytes('2101040100' + '63') + HouseList.encode(2, 2, 99, 99, bytes().fromstring('Evil'))";
  assert.equal(typeof h.berry(1, `espnow_mesh_send(5, 6, false, ${forged})`).v, "number", "the mesh took the frame");
  h.run(3000);
  assert.equal(nameOf(h, 5, 2), "Bridge 2", "the entry was not taken: it is of the author 4, and it came from 1");
  assert.equal(h.berry(5, "hm.list.v.find(4)").v, h.berry(4, "hm.list.mine").v, "and the vector of the author did not move");
  // a frame in the name of a panel that is not a panel of the list, from the node itself, is not taken either
  const own = "bytes('2101010100' + '63') + HouseList.encode(2, 2, 99, 99, bytes().fromstring('Evil'))";
  h.berry(1, `espnow_mesh_send(5, 6, false, ${own})`);
  h.run(3000);
  assert.equal(nameOf(h, 5, 2), "Bridge 2", "a bridge is not an author");
  // the control: the same frame, from the panel that is the author, is taken, so the two refusals above were of the author and not of a frame that did not arrive
  assert.equal(typeof h.berry(4, `espnow_mesh_send(5, 6, false, ${forged})`).v, "number");
  h.run(3000);
  assert.equal(nameOf(h, 5, 2), "Evil", "from its author the entry is taken");
});

test("a name written by another panel goes everywhere, and two panels writing the same field end with one name", async () => {
  const h = await house();
  await founded(h);
  bridges(h);
  h.run(30_000);
  assert.equal(h.berry(5, "hm.rename(2, 'Kitchen')").v, true);
  h.run(25_000);
  for (const id of h.ids) assert.equal(nameOf(h, id, 2), "Kitchen", `node ${id}`);
  // both panels write the name of node 3 in the same instant: the greater seq wins, and, with the same seq, the lower author
  assert.equal(h.berry(4, "hm.rename(3, 'Garage')").v, true);
  assert.equal(h.berry(5, "hm.rename(3, 'Workshop')").v, true);
  h.run(30_000);
  const names = new Set(h.ids.map((id) => nameOf(h, id, 3)));
  assert.equal(names.size, 1, `one name everywhere: ${[...names]}`);
  const winner = h.berry(1, "hm.list.field(2, 3)").v;
  assert.ok(winner[0] === 4 || winner[0] === 5, "of the author of one of them");
  assert.equal(new Set(h.ids.map((id) => digest(h, id))).size, 1, "and one digest");
});

test("a node cut off from the mesh while the list changed has the changes when the mesh is whole again", async () => {
  const h = await house();
  await founded(h);
  bridges(h);
  h.run(30_000);
  meshIsolate(h.home, 2);
  assert.equal(h.berry(4, "hm.rename(1, 'Living room')").v, true);
  assert.equal(h.berry(5, "hm.rename(3, 'Bedroom')").v, true);
  h.run(40_000);
  assert.equal(nameOf(h, 2, 1), "Bridge 1", "the node that was cut off has not heard");
  assert.notEqual(digest(h, 2), digest(h, 4));
  meshHeal(h.home);
  h.run(60_000);
  assert.equal(nameOf(h, 2, 1), "Living room");
  assert.equal(nameOf(h, 2, 3), "Bedroom");
  assert.equal(digest(h, 2), digest(h, 4), "it holds what the others hold");
});

test("a node struck off is taken out of the driver's table of the others, and the list says it", async () => {
  const h = await house();
  await founded(h);
  bridges(h);
  h.run(30_000);
  const listed = (id) => h.cmd(id, "EspNowMeshNode").EspNowMeshNode.map((n) => n.Id).sort();
  assert.ok(listed(5).includes(3), "the driver of panel 5 has the bridge 3");
  assert.equal(h.berry(4, "hm.revoke(3)").v, true);
  assert.equal(h.berry(4, "hm.revoke(3)").v, false, "once");
  assert.equal(h.berry(4, "hm.revoke(4)").v, false, "a panel does not strike itself off");
  h.run(30_000);
  for (const id of [1, 2, 4, 5]) {
    assert.deepEqual(ids(h, id), [1, 2, 4, 5], `node ${id}: the house without the bridge 3`);
    assert.equal(h.berry(id, "hm.list.revoked(3)").v, true);
    assert.ok(!listed(id).includes(3), `the driver of node ${id} has no node 3`);
  }
  assert.equal(h.berry(1, "hm.list.next_id()").v, 6, "the number 3 is not given again: the next is 6");
  assert.equal(h.berry(1, "hm.list.free_slot()").v, 3, "and its alarm number is free");
  // the bridge that was struck off took the entry that says it, and left the house: no number, no list, the driver's mesh stopped
  assert.deepEqual([h.berry(3, "hm.list.me").v, h.berry(3, "hm.up").v, h.cmd(3, "EspNowMeshId").EspNowMeshId], [0, false, 0], "the bridge that was struck off left the house");
});

test("the list is in the flash: a node that lost its power has it back, and the driver is not given again what it has", async () => {
  const h = await house();
  await founded(h);
  bridges(h);
  h.run(30_000);
  const before = digest(h, 2);
  const record = h.dev(2).nvm["espnowmesh/settings"];
  await h.power(2, 3000);
  h.load(2);
  h.run(30_000);
  assert.equal(digest(h, 2), before, "the list was read from the flash");
  assert.deepEqual(ids(h, 2), [1, 2, 3, 4, 5]);
  // the record is as it was but for the epoch (bytes 8 to 11), which rises with every start: no node was given to the driver again
  const unepoch = (r) => r.slice(0, 16) + r.slice(24);
  assert.equal(unepoch(h.dev(2).nvm["espnowmesh/settings"]), unepoch(record), "the driver's record is as it was");
  // a change made while it was off
  h.run(1000);
  assert.equal(h.berry(4, "hm.rename(5, 'Family room')").v, true);
  h.run(30_000);
  assert.equal(nameOf(h, 2, 5), "Family room");
});

test("the heartbeat carries the digest and the first two bytes of the key, and the alarm's replica and the house write into one buffer", async () => {
  const h = await house();
  await founded(h);
  bridges(h);
  h.run(30_000);
  const d = digest(h, 4);
  const want = [(d >> 16) & 255, (d >> 8) & 255, d & 255];
  const info = (a, b) => {
    const n = h.berry(a, `espnow_mesh_neighbors()`).v.find((x) => x.id === b);
    return Buffer.from(n.info, "hex");
  };
  const fromPanel5 = info(1, 5);
  assert.equal(fromPanel5.length >= 28, true, "a panel's heartbeat has the bytes of the house");
  assert.deepEqual([...fromPanel5.subarray(25, 28)], want, "its digest");
  assert.deepEqual([...fromPanel5.subarray(23, 25)], [...Buffer.from(who(h, 5).key, "hex").subarray(0, 2)], "and the two first bytes of its key");
  // a bridge has an alarm number, so its replica has bytes of its own in the buffer (the digest of its heads, bits of the sign byte), and the house's are there too
  const fromBridge = info(4, 2);
  assert.deepEqual([...fromBridge.subarray(25, 28)], want, "the digest of the list in the heartbeat of a bridge");
  assert.equal(fromBridge[0], 1, "with the layout of the alarm's replica");
  assert.equal(h.berry(2, "global.zbbridge_relay.alarm.mesh != nil").v, true, "which has its replica");
  assert.notDeepEqual([...fromBridge.subarray(12, 16)], [0, 0, 0, 0], "and the digest of its heads");
});

test("a bridge in a house has the alarm number the list gives it, and not its number on the mesh", async () => {
  const h = await house();
  await founded(h);
  // the bridges are written in another order than their numbers: 3 first, then 1, then 2
  for (const id of [3, 1, 2]) {
    const w = who(h, id);
    assert.equal(h.berry(4, `hm.add_node(1, bytes('${w.key}'), bytes('${w.mac}'), nil, 'Bridge ${id}', ${id})`).v, id);
  }
  h.run(40_000);
  for (const id of h.ids) {
    assert.deepEqual([3, 1, 2].map((n) => h.berry(id, `hm.list.node(${n})['slot']`).v), [1, 2, 3], `node ${id}: the alarm numbers are in the order the bridges were written`);
  }
  const rep = (id) => h.berry(id, "global.zbbridge_relay.alarm.mesh.rep.id").v;
  assert.deepEqual([1, 2, 3].map(rep), [1, 2, 3], "the replicas were built before the list: with the interim, the mesh number");
  // a bridge that starts again is in the house, and builds its replica with the number of the list
  await h.power(3, 3000);
  h.load(3);
  h.run(40_000);
  assert.equal(rep(3), 1, "the bridge 3 is the first bridge of the house: its replica is the alarm 1");
  await h.power(1, 3000);
  h.load(1);
  h.run(40_000);
  assert.equal(rep(1), 2, "and the bridge 1 is the alarm 2");
  assert.equal(h.berry(1, "global.zbbridge_relay.alarm.nomesh").v, false);
});
