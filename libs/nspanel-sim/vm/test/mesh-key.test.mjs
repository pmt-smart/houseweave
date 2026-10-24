// The change of the network's key in the ESP-NOW mesh core (tasmota/include/espnow_mesh_core.h and espnow_mesh_crypto.h, compiled to WebAssembly, on the firmware's own
// cipher): two keys at a node, the one it sends with and the one the network had before.
//
//   A  the time the change has to reach the others: 120 s in which a frame under the previous key is one under the key in use, of any type, and what the node
//      that holds only the previous key cannot hear
//   B  after it, and until the change closes: the heartbeat, the sync exchange and a frame of the membership for this node alone are let through, and no more;
//      the rest is dropped and counted, and what the heartbeat says of the node's application is not taken
//   C  the key reaches a node: the frame that carries it is tagged with the key the node still has, and the house takes the node's frames again
//   D  a node that was off for the whole of the change comes back with the key it had, asks where the others are, is answered under the tag it can check, and
//      is brought up to date: the sync exchange in both directions, and the delivery
//   E  what a node that holds only the previous key cannot do, and the close
//   F  what the heartbeat says of the keys, and the restart that gives the keys back from the flash and is no change
import { test } from "node:test";
import assert from "node:assert/strict";
import { MeshAir, MeshType, MESH } from "../dist/index.js";

const CONVERGE_MS = 120_000;
const KEY_NEW = 1;                                  // the numbers the test's keys are made of (0 is the key every node starts with)

/** nodes 1 to n in one room, each knowing where the others are, with the real cipher, the clock and the words of the key in the heartbeat */
async function house(n, opt = {}) {
  const air = await MeshAir.create({ seed: 5, beatMs: 5000, cipher: "real", clock: true, keys: true, ...opt });
  for (let i = 1; i <= n; i++) air.add(i, 0, 0, 5);
  for (let i = 1; i <= n; i++) for (let j = i + 1; j <= n; j++) air.link(i, j, -55);
  air.syncAll();
  return air;
}

const stat = (air, id, name) => air.core.stat(air.node(id).slot, name);
const got = (air, node, type) => air.deliveries.filter((x) => x.node === node && x.d.type === type);
const flagged = (air, node) => air.deliveries.filter((x) => x.node === node && x.d.previousKey);

/** the nodes `ids` take the new key, as their application does when the frame that carries it arrives: version 2 under KEY_NEW */
const take = (air, ids) => { for (const id of ids) air.keyChange(id, KEY_NEW, 2); };

test("a node that took the change says so: it sends with the new key, holds the old one, and has 120 s for the change to reach the others", async () => {
  const air = await house(3);
  assert.deepEqual(air.keyState(1), { version: 1, holdsPrevious: false, converging: false, needsKey: false, previousVersion: 0 }, "a node says the key it has, and holds no other");
  air.keyChange(1, KEY_NEW, 2);
  assert.deepEqual(air.keyState(1), { version: 2, holdsPrevious: true, converging: true, needsKey: false, previousVersion: 1 });
  air.run(CONVERGE_MS - 2000);
  assert.equal(air.keyState(1).converging, true, "the time is 120 s");
  air.run(4000);
  assert.equal(air.keyState(1).converging, false);
  assert.equal(air.keyState(1).holdsPrevious, true, "and the old key is held after it, until the change closes");
});

test("in the 120 s a frame under the previous key is one under the key in use, of any type: the node takes what the nodes that have not taken the change send", async () => {
  const air = await house(3);
  air.keyChange(1, KEY_NEW, 2);
  air.run(1000);
  const ev = air.send(2, MeshType.Event, MESH.TO_ALL, [1, 2, 3]);
  const cmd = air.send(2, MeshType.Command, 1, [9], false);
  const st = air.send(3, MeshType.State, 1, [7, 7]);
  air.run(1500);
  assert.equal(air.deliveriesOf(ev, 1), 1, "an event for everyone is delivered");
  assert.equal(air.deliveriesOf(cmd, 1), 1, "a command for it alone");
  assert.equal(air.deliveriesOf(st, 1), 1, "and a state");
  assert.equal(flagged(air, 1).length, 3, "each told that it came under the previous key");
  assert.ok(stat(air, 1, "prevKeyHeard") >= 3 && stat(air, 1, "prevKeyDropped") === 0, "heard under it, and none dropped");
  // and the heartbeat is taken whole: its clock, its bytes, the version it says
  air.run(6000);
  const n = air.neighbor(1, 2);
  assert.ok(n.info.length >= 23 && n.info[22] === 1, "the heartbeat of a node that holds version 1 says so");
  assert.equal(n.keyVersion, 1);
  assert.equal(n.keyBits & 4, 4, "and the neighbour is marked as heard under the previous key");
  assert.equal(n.clockSeen > 0, true, "and its clock is taken");
});

test("the nodes that have not taken the change cannot check what the node that has taken it sends, and say they need the key after 15 s of hearing nothing else", async () => {
  const air = await house(2);
  air.keyChange(1, KEY_NEW, 2);
  air.run(8000);
  assert.ok(stat(air, 2, "bad") >= 1, "the frames of the new key are not ones it can check");
  assert.equal(stat(air, 2, "delivered"), 0, "and it hears nothing of it");
  assert.equal(air.keyState(2).needsKey, false, "not yet: 15 s");
  air.run(14000);
  assert.equal(air.keyState(2).needsKey, true, "after 15 s of that it needs the key");
  // its heartbeat says so, in the bit the node leaves for it
  air.run(6000);
  const n = air.neighbor(1, 2);
  assert.equal(n.keyBits & 2, 2, "the neighbour says it needs the key");
  assert.equal(n.keyVersion, 1, "and which key it has");
});

test("a command that asks for an answer from a node that has not taken the change is not answered in a way it can read: the answer is under the new key", async () => {
  const air = await house(2);
  air.keyChange(1, KEY_NEW, 2);
  air.run(500);
  const key = air.send(2, MeshType.Command, 1, [1], true);
  air.run(2500);
  assert.ok(air.reached(key).has(1), "the command is taken (and again at each attempt, for the answer does not come back)");
  const outcome = air.outcomes.get(key);
  assert.ok(outcome === undefined || outcome.ok === false, "and the sender is not told it arrived");
});

test("after the 120 s only what brings a node up to date is let through: its heartbeat, a sync exchange and a frame of the membership for this node alone", async () => {
  const air = await house(3);
  air.keyChange(1, KEY_NEW, 2);
  air.run(CONVERGE_MS + 6000);
  assert.equal(air.keyState(1).converging, false);
  const before = stat(air, 1, "delivered");
  const dropped = stat(air, 1, "prevKeyDropped");
  const keys = [
    air.send(2, MeshType.Event, MESH.TO_ALL, [1]),
    air.send(2, MeshType.Command, 1, [2]),
    air.send(3, MeshType.State, 1, [3]),
    air.send(3, MeshType.State, MESH.TO_ALL, [4]),
    air.send(2, MeshType.Membership, MESH.TO_ALL, [5]),
  ];
  air.run(2500);
  for (const k of keys) assert.equal(air.deliveriesOf(k, 1), 0, `${k} is not delivered`);
  assert.equal(stat(air, 1, "delivered"), before, "nothing of the application's reached it");
  assert.ok(stat(air, 1, "prevKeyDropped") >= dropped + 5, `all of them dropped, and counted: ${stat(air, 1, "prevKeyDropped") - dropped}`);
  // a frame of the membership for this node alone is let through, and says that it came under the previous key
  const member = air.send(2, MeshType.Membership, 1, [6, 6]);
  air.run(1500);
  assert.equal(air.deliveriesOf(member, 1), 1, "the membership frame for this node alone is delivered");
  assert.equal(flagged(air, 1).filter((x) => x.d.type === MeshType.Membership).length, 1, "and it says it came under the previous key");
});

test("the heartbeat of a node that holds only the previous key is taken for its presence and the key it says, and not its clock, its bytes or its list of neighbours", async () => {
  const air = await house(3);
  air.keyChange(1, KEY_NEW, 2);
  air.run(CONVERGE_MS + 12000);
  const n = air.neighbor(1, 2);
  assert.ok(n !== undefined, "the node is a neighbour");
  assert.equal(n.state, "alive", "it is alive");
  assert.equal(n.info.length, 0, "no bytes of the application are taken");
  assert.equal(n.clockSeen, 0, "no clock");
  assert.equal(n.hears.length, 0, "and no list of whom it hears");
  assert.equal(n.keyVersion, 1, "it says it has version 1");
  assert.equal(n.keyBits & 4, 4, "under the previous key");
  assert.ok(stat(air, 1, "beatsHeard") > 0);
  assert.equal(air.clockEvents.filter((e) => e.node === 1 && e.event.kind === 1 && e.at > CONVERGE_MS * 1000).length, 0, "and the clock of the node has not moved by it");
});

test("the frame that carries the key is tagged with the key the node still has: the node takes it, and then it is heard again", async () => {
  const air = await house(3);
  air.keyChange(1, KEY_NEW, 2);
  air.run(CONVERGE_MS + 6000);
  // without the previous tag the new key cannot be delivered: the node cannot check it
  const bad = stat(air, 2, "bad");
  const lost = air.send(1, MeshType.Membership, 2, [8, 8]);
  air.run(800);
  assert.equal(air.deliveriesOf(lost, 2), 0, "a frame under the new key is not taken by the node that does not have it");
  assert.ok(stat(air, 2, "bad") > bad);
  const key = air.send(1, MeshType.Membership, 2, [9, 9, 9], false, true);
  air.run(800);
  assert.equal(air.deliveriesOf(key, 2), 1, "the frame tagged with the previous key is taken");
  const d = got(air, 2, MeshType.Membership).at(-1).d;
  assert.deepEqual(Array.from(d.payload), [9, 9, 9]);
  assert.equal(d.previousKey, false, "and it is not one under the previous key for the node: it is under the key it has");
  // it takes the key, and the house hears it again
  take(air, [2]);
  assert.equal(air.keyState(2).version, 2);
  const ev = air.send(2, MeshType.Event, MESH.TO_ALL, [4, 4]);
  air.run(1500);
  assert.equal(air.deliveriesOf(ev, 1), 1, "what it sends is delivered");
  assert.equal(air.deliveriesOf(ev, 3), 0, "(node 3 has not taken it)");
  const back = air.send(1, MeshType.Event, MESH.TO_ALL, [5, 5]);
  air.run(1500);
  assert.equal(air.deliveriesOf(back, 2), 1, "and it hears what the others send");
  assert.equal(air.keyState(2).needsKey, false);
});

test("the whole house takes the change: the key goes to every node, and everything flows under it", async () => {
  const air = await house(6);
  air.keyChange(1, KEY_NEW, 2);
  air.run(300);
  const keys = [];
  for (let id = 2; id <= 6; id++) keys.push([id, air.send(1, MeshType.Membership, id, [id], false, true)]);
  air.run(1500);
  for (const [id, key] of keys) assert.equal(air.deliveriesOf(key, id), 1, `node ${id} took the frame that carries the key`);
  take(air, [2, 3, 4, 5, 6]);
  for (let id = 1; id <= 6; id++) assert.equal(air.keyState(id).version, 2, `node ${id} is at version 2`);
  air.run(8000);
  for (let from = 1; from <= 6; from++) {
    const k = air.send(from, MeshType.Event, MESH.TO_ALL, [from, 0]);
    air.run(600);
    for (let to = 1; to <= 6; to++) if (to !== from) assert.equal(air.deliveriesOf(k, to), 1, `${from} reached ${to}`);
  }
  assert.equal(flagged(air, 1).length, 0, "nothing of it was under the previous key");
  // the change closes: the nodes let the previous key go, and the old key is nothing to them
  for (let id = 1; id <= 6; id++) air.keyClose(id);
  for (let id = 1; id <= 6; id++) assert.equal(air.keyState(id).holdsPrevious, false);
  assert.equal(air.keyState(1).previousVersion, 0);
});

test("a node that was off for the whole of the change comes back with the key it had, and the house and the node learn where they are by the sync exchange, under the tag each can check", async () => {
  const air = await house(4, { startSync: true });
  air.run(3000);
  air.power(4, false);
  air.keyChange(1, KEY_NEW, 2);
  air.run(200);
  for (const id of [2, 3]) air.send(1, MeshType.Membership, id, [id], false, true);
  air.run(1000);
  take(air, [2, 3]);
  air.run(CONVERGE_MS + 10000);
  assert.equal(air.keyState(1).converging, false, "the time for the change is over");
  // the node comes back, as a restart: new epoch, nothing known, the key the flash holds is the one it had
  air.restart(4);
  air.run(25000);
  for (const id of [1, 2, 3]) {
    assert.equal(air.knows(id, 4), true, `${id} knows where 4 is`);
    assert.equal(air.knows(4, id), true, `and 4 knows where ${id} is`);
  }
  assert.ok(stat(air, 4, "syncDone") >= 1, "node 4 was answered when it asked");
  for (const id of [1, 2, 3]) assert.ok(stat(air, id, "prevKeyHeard") > 0, `${id} let through what 4 sent under the previous key`);
  assert.ok(stat(air, 4, "bad") > 0, "while 4 cannot check what the house sends, and is answered under the tag it can");
  const n = air.neighbor(1, 4);
  assert.ok(n !== undefined && n.keyVersion === 1, "node 1 hears it say it has version 1");
  assert.equal(n.info.length, 0, "and takes nothing of its bytes");
  // it cannot speak to the house yet, and the house is not heard by it
  const lost = air.send(4, MeshType.Event, MESH.TO_ALL, [7]);
  const heard = air.send(1, MeshType.Event, MESH.TO_ALL, [8]);
  air.run(1500);
  assert.equal(air.deliveriesOf(lost, 1) + air.deliveriesOf(lost, 2) + air.deliveriesOf(lost, 3), 0, "what it sends is dropped");
  assert.equal(air.deliveriesOf(heard, 4), 0, "and it cannot hear what the house sends");
  assert.equal(air.keyState(4).needsKey, true, "it needs the key");
  // the delivery
  const key = air.send(1, MeshType.Membership, 4, [4, 4, 4, 4], false, true);
  air.run(1500);
  assert.equal(air.deliveriesOf(key, 4), 1, "the frame that carries the key is taken");
  take(air, [4]);
  air.run(8000);
  const ev = air.send(4, MeshType.Event, MESH.TO_ALL, [9]);
  const back = air.send(2, MeshType.Event, MESH.TO_ALL, [10]);
  air.run(1500);
  for (const id of [1, 2, 3]) assert.equal(air.deliveriesOf(ev, id), 1, `${id} hears 4 again`);
  assert.equal(air.deliveriesOf(back, 4), 1, "and 4 hears the house");
  assert.equal(air.keyState(4).needsKey, false);
});

test("a node that holds only the previous key and was struck off cannot speak to the house after the 120 s: its floods are dropped, and counted", async () => {
  const air = await house(4);
  take(air, [1, 2, 3]);
  air.run(CONVERGE_MS + 10000);
  const dropped = [1, 2, 3].map((id) => stat(air, id, "prevKeyDropped"));
  const sends = [];
  for (const type of [MeshType.Event, MeshType.State, MeshType.Command, MeshType.Membership, MeshType.Bulk]) sends.push(air.send(4, type, MESH.TO_ALL, [type, 1, 2, 3, 4]));
  air.run(2500);
  for (const k of sends) for (const id of [1, 2, 3]) assert.equal(air.deliveriesOf(k, id), 0, `${k} did not reach ${id}`);
  [1, 2, 3].forEach((id, i) => assert.ok(stat(air, id, "prevKeyDropped") > dropped[i], `node ${id} counted them`));
  // and the clock of the house is not pulled by it: it is the heartbeat that carries the time, and the bytes of it are not taken
  for (const id of [1, 2, 3]) {
    const n = air.neighbor(id, 4);
    assert.ok(n === undefined || (n.info.length === 0 && n.clockSeen === 0), `${id} takes nothing of the bytes of the heartbeat of 4`);
  }
});

test("a frame whose tag is of neither key is a bad frame, and is not counted as one under the previous key", async () => {
  const air = await house(3);
  take(air, [1, 2]);
  air.keySet(3, 2, 3);                                // node 3 has another key altogether, and no previous
  air.run(CONVERGE_MS + 10000);
  const heard = stat(air, 1, "prevKeyHeard");
  const dropped = stat(air, 1, "prevKeyDropped");
  const bad = stat(air, 1, "bad");
  const key = air.send(3, MeshType.Event, MESH.TO_ALL, [1]);
  air.run(1500);
  assert.equal(air.deliveriesOf(key, 1), 0);
  assert.ok(stat(air, 1, "bad") > bad, "it is a bad frame");
  assert.equal(stat(air, 1, "prevKeyHeard"), heard, "and not one under the previous key");
  assert.equal(stat(air, 1, "prevKeyDropped"), dropped);
});

test("once the change is closed the previous key is no key: the frames under it are bad frames, and nothing of them is let through", async () => {
  const air = await house(3);
  take(air, [1]);
  air.run(CONVERGE_MS + 10000);
  const key = air.send(2, MeshType.Membership, 1, [1]);
  air.run(1200);
  assert.equal(air.deliveriesOf(key, 1), 1, "before the close the membership frame for the node is let through");
  air.keyClose(1);
  assert.equal(air.keyState(1).holdsPrevious, false);
  const heard = stat(air, 1, "prevKeyHeard");
  const bad = stat(air, 1, "bad");
  const again = air.send(2, MeshType.Membership, 1, [2]);
  air.run(1200);
  assert.equal(air.deliveriesOf(again, 1), 0, "after it, it is not");
  assert.ok(stat(air, 1, "bad") > bad && stat(air, 1, "prevKeyHeard") === heard, "a bad frame, and not one under the previous key");
});

test("the heartbeat says the version of the key, whether the node holds a previous one and whether it needs the key; the bytes the application gave are kept", async () => {
  const air = await house(3);
  air.core.setInfo(air.node(1).slot, new Uint8Array(32).fill(0xaa));
  take(air, [1, 2, 3]);
  air.run(7000);
  const n = air.neighbor(2, 1);
  assert.equal(n.info.length, 32, "the application's 32 bytes");
  assert.equal(n.info[22], 2, "the version of the key is the device's");
  assert.equal(n.info[19] & 0x20, 0x20, "it holds a previous key");
  assert.equal(n.info[19] & 0x40, 0, "and does not need the key");
  assert.equal(n.info[12], 0xaa, "the bytes it did not make are the application's");
  assert.equal(n.info[23], 0xaa);
  assert.equal(n.keyVersion, 2);
  assert.equal(n.keyBits, 1, "the neighbour list says it holds the previous key");
  for (const id of [1, 2, 3]) air.keyClose(id);
  air.run(7000);
  const after = air.neighbor(2, 1);
  assert.equal(after.info[19] & 0x20, 0, "closed: it holds none");
  assert.equal(after.keyBits, 0);
});

test("a node that says nothing of its keys (the application did not say which it holds) adds nothing to its heartbeat, and a node that does adds 3 bytes to the 20 of the clock", async () => {
  const quiet = await house(2, { keys: false });
  quiet.run(7000);
  assert.equal(quiet.neighbor(1, 2).info.length, 20);
  assert.equal(quiet.neighbor(1, 2).keyVersion, 0);
  const says = await house(2);
  says.run(7000);
  assert.equal(says.neighbor(1, 2).info.length, 23);
  assert.equal(says.neighbor(1, 2).keyVersion, 1);
});

test("a start gives the keys back, as the flash holds them, and is no change: the previous key is held and has no time left", async () => {
  const air = await house(3);
  take(air, [1]);
  air.run(5000);
  assert.equal(air.keyState(1).converging, true);
  air.restart(1);
  const k = air.keyState(1);
  assert.equal(k.version, 2);
  assert.equal(k.holdsPrevious, true);
  assert.equal(k.previousVersion, 1);
  assert.equal(k.converging, false, "a start is no change: there is no new time for it");
  // under the previous key only the heartbeat, the sync and the frame for this node: the restart did not open the door again
  air.run(3000);
  const dropped = stat(air, 1, "prevKeyDropped");
  air.send(2, MeshType.Event, MESH.TO_ALL, [1]);
  air.run(1500);
  assert.ok(stat(air, 1, "prevKeyDropped") > dropped, "a flood under the previous key is dropped");
});

test("a frame that is sent under the previous key by a node that holds none goes with the usual tag", async () => {
  const air = await house(2);
  const key = air.send(1, MeshType.Event, MESH.TO_ALL, [3], false, true);
  air.run(1500);
  assert.equal(air.deliveriesOf(key, 2), 1, "the tag of the key in use, as there is no other");
  assert.equal(flagged(air, 2).length, 0);
});
