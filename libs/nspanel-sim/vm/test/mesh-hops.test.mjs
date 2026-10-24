// The hops of a flood: a node leaves with `kMaxHops` repeats, 5 by default: the origin's own hop of radio and five repeats, six in all (it was 3: four).
// The core is compiled from its own source (tasmota/include/espnow_mesh_core.h), the nodes run over a simulated air.
//
//   H1 the hops are the sender's: a frame says how many times it may still be repeated, and a node repeats as many times as the frame says, whatever its own
//      constant is, which is what lets nodes built with 3 and with 5 live in one house, in any order of rollout
//   H2 a corridor of rooms in a row, the deepest house there is: a flood reaches the nodes within six hops of its origin and no others
//   H3 the frames of a flood on the houses of the scale study: the flood is stopped by the numbers a node has heard, not by the hops, so what a flood costs is
//      what it cost with 3 where the house is not deeper than 4
//   H4 the answer to a command comes back along the way the flood came, with the hops of the node that answers: a command across six hops is answered
//
// What these cannot say is how a house with some nodes of 3 and some of 5 behaves when it is deeper than four hops: an answer is sent with the hops of the node that
// answers, so a node of 3 answers a command that came from five hops away and the answer does not get back (scripts of the study; the bench).
import { test } from "node:test";
import assert from "node:assert/strict";
import { MeshAir, MeshType, MESH, macOf, packKind } from "../dist/index.js";

/** the nodes of a house of `rooms` rooms: a bridge and a panel in each (the nodes 2r+1 and 2r+2), 8 dB for every wall between, the signal of the log-distance model with the exponent 2.2 */
async function house(at, spacing, opt = {}) {
  const air = await MeshAir.create({ seed: 11, beatMs: 5000, ...opt });
  at.forEach(([x, y], r) => {
    air.add(2 * r + 1, x, y, 5);
    air.add(2 * r + 2, x + 1.5, y + 1, 5);
  });
  const roomOf = (n) => Math.floor((n.id - 1) / 2);
  air.geometry(2.2, (a, b) => {
    const [ax, ay] = at[roomOf(a)], [bx, by] = at[roomOf(b)];
    return 8 * (Math.abs(ax - bx) / spacing + Math.abs(ay - by) / spacing);
  });
  air.syncAll();
  air.run(30000);
  return air;
}
const columns = (rooms) => (rooms <= 7 ? rooms : Math.ceil(Math.sqrt(rooms * 1.5)));
const gridAt = (rooms, spacing) => Array.from({ length: rooms }, (_, r) => [(r % columns(rooms)) * spacing, Math.floor(r / columns(rooms)) * spacing]);
const corridorAt = (rooms, spacing) => Array.from({ length: rooms }, (_, r) => [r * spacing, 0]);

/** the hops of radio between nodes, over the links that both ways are heard */
function distances(air, from) {
  const ids = air.nodes.map((n) => n.id);
  const dist = new Map([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const x = queue.shift();
    for (const y of ids) if (!dist.has(y) && air.heard(x, y) !== undefined && air.heard(y, x) !== undefined) { dist.set(y, dist.get(x) + 1); queue.push(y); }
  }
  return dist;
}
const diameter = (air) => Math.max(...air.nodes.flatMap((n) => [...distances(air, n.id).values()]));

// =====================================================================================================================================
// H1. the hops are the sender's
// =====================================================================================================================================

test("a frame is repeated as many times as it says, not as many as the node's own constant: frames that left with 3, 5 and 7 repeats reach 4, 6 and 8 nodes of a line", async () => {
  assert.equal(MESH.MAX_HOPS, 5, "this build leaves with five repeats");
  const air = await MeshAir.create({ seed: 4 });
  for (let i = 1; i <= 12; i++) air.add(i, i * 10, 0, 5);
  for (let a = 1; a < 12; a++) air.link(a, a + 1, -60);
  air.syncAll();
  // the origins of the frames are nodes that are not in the house: one built with 3, with 5 and with 7 would send these, heard by the first node of the line
  const legacy = [[21, 3], [22, 5], [23, 7]];
  for (const [origin] of legacy) for (const n of air.nodes) air.core.synced(n.slot, origin, 5, 0);
  for (const [origin, hops] of legacy) {
    const frame = air.core.encode({ kind: packKind(MeshType.Command), origin, dest: MESH.TO_ALL, next: 0, hops, epoch: 5, counter: 1, payload: [hops] }, true);
    assert.ok(frame, "the frame is made");
    const mark = air.log.length;
    air.core.receive(air.node(1).slot, frame, macOf(origin), -60, air.localMs(1));
    air.wake(1);
    air.settle();
    const reached = air.deliveries.filter((x) => x.d.origin === origin).map((x) => x.node).sort((a, b) => a - b);
    assert.deepEqual(reached, Array.from({ length: hops + 1 }, (_, i) => i + 1), `a frame with ${hops} repeats goes ${hops + 1} hops of radio, the one the origin made and ${hops} repeats`);
    assert.deepEqual(air.log.slice(mark).map((l) => l.hops), Array.from({ length: hops }, (_, i) => hops - 1 - i), "each repeat sends it on with one less (the first hop was the origin's, off the air of the house), and the last is not repeated");
  }
  // and a frame of the node itself leaves with the constant: five repeats
  const key = air.send(1, MeshType.Command, MESH.TO_ALL, [1]);
  air.settle();
  assert.deepEqual([...air.reached(key).keys()].sort((a, b) => a - b), [2, 3, 4, 5, 6, 7], "its own: six hops from it");
});

// =====================================================================================================================================
// H2. a corridor
// =====================================================================================================================================

test("along a corridor of rooms in a row a flood reaches the nodes within six hops of its origin and none beyond: 13 rooms (six hops across) are covered, 15 (seven) are not, from the ends", async () => {
  const covered = await house(corridorAt(13, 6), 6);
  assert.equal(diameter(covered), 6, "13 rooms: six hops across");
  const key = covered.send(1, MeshType.Event, MESH.TO_ALL, [1]);
  covered.settle();
  assert.equal(covered.reached(key).size, covered.nodes.length - 1, "a flood from one end reaches the other");
  const back = covered.send(26, MeshType.Event, MESH.TO_ALL, [2]);
  covered.settle();
  assert.equal(covered.reached(back).size, covered.nodes.length - 1, "and the other end reaches this one");

  const deep = await house(corridorAt(15, 6), 6);
  assert.equal(diameter(deep), 7, "15 rooms: seven hops across");
  const dist = distances(deep, 1);
  const within = [...dist.entries()].filter(([id, d]) => id !== 1 && d <= MESH.MAX_HOPS + 1).map(([id]) => id).sort((a, b) => a - b);
  const far = [...dist.entries()].filter(([, d]) => d > MESH.MAX_HOPS + 1).map(([id]) => id);
  assert.ok(far.length > 0 && within.length > 0, "there are nodes in reach and nodes out of it");
  const k2 = deep.send(1, MeshType.Event, MESH.TO_ALL, [3]);
  deep.settle();
  assert.deepEqual([...deep.reached(k2).keys()].sort((a, b) => a - b), within, "the flood reaches the nodes within six hops, and not the ones at seven");
});

// =====================================================================================================================================
// H3. what a flood costs
// =====================================================================================================================================

/** every node floods an event in turn: the frames on the air for each, the nodes reached, the time to the last */
function floods(air) {
  const frames = [];
  let reached = 0, lastMs = 0;
  for (const n of air.nodes) {
    const key = air.send(n.id, MeshType.Event, MESH.TO_ALL, [n.id, 1, 2, 3]);
    air.settle(3000);
    frames.push(air.copies(key));
    const got = air.reached(key);
    reached += got.size;
    lastMs = Math.max(lastMs, ...[...got.values()].map((v) => v / 1000));
    air.run(500);
  }
  const mean = frames.reduce((s, v) => s + v, 0) / frames.length;
  return { mean, max: Math.max(...frames), reachedShare: reached / (air.nodes.length * (air.nodes.length - 1)), lastMs };
}

test("on the houses of the scale study (diameter 2 to 4) a flood costs no more than it cost with 3 repeats (4.6 frames at 14 nodes, 10.1 at 30, 12.4 at 32, 16.5 at 40, over five seeds), all reached, each node repeating a frame once at the most", async (t) => {
  for (const [rooms, want] of [[7, 4.6], [15, 10.1], [16, 12.4], [20, 16.5]]) {
    const air = await house(gridAt(rooms, 6), 6);
    assert.ok(diameter(air) <= 4, `${rooms} rooms: ${diameter(air)} hops across`);
    const r = floods(air);
    assert.equal(r.reachedShare, 1, `${2 * rooms} nodes: every flood reaches every node`);
    assert.ok(r.mean <= want + 1.5, `${2 * rooms} nodes: ${r.mean.toFixed(1)} frames a flood, ${want} with 3 repeats`);   // one seed here, and a seed moves it by a frame
    assert.ok(r.max < air.nodes.length, `${2 * rooms} nodes: at most ${r.max} frames for one flood: a frame is repeated once by each node at the most`);
    assert.ok(r.lastMs < 20, `${2 * rooms} nodes: the last delivery in ${r.lastMs.toFixed(1)} ms`);
    t.diagnostic(`${2 * rooms} nodes, diameter ${diameter(air)}: ${r.mean.toFixed(1)} frames a flood (most ${r.max}), the last delivery after ${r.lastMs.toFixed(1)} ms`);
  }
});

test("H3b on a deep house (10 m between rooms, -80 dBm heard: 6 to 8 hops across) the flood reaches what 3 repeats could not, for a few frames more, still fewer than there are nodes", async (t) => {
  for (const rooms of [7, 15]) {
    const air = await house(gridAt(rooms, 10), 10, { sensitivity: -80 });
    const d = diameter(air);
    assert.ok(d >= 6, `${2 * rooms} nodes: ${d} hops across`);
    const r = floods(air);
    assert.ok(r.reachedShare > 0.99, `${2 * rooms} nodes: ${(100 * r.reachedShare).toFixed(2)}% of the nodes reached by a flood (with 3 repeats: 86% at 14 nodes and 94% at 30)`);
    assert.ok(r.max < air.nodes.length, `${2 * rooms} nodes: at most ${r.max} frames for one flood`);
    t.diagnostic(`${2 * rooms} nodes, ${d} hops across: ${(100 * r.reachedShare).toFixed(2)}% reached, ${r.mean.toFixed(1)} frames a flood (most ${r.max})`);
  }
});

// =====================================================================================================================================
// H4. the answer
// =====================================================================================================================================

test("a command that asks for an answer across six hops is answered, and one across seven is not: the answer goes back with the hops of the node that answers", async () => {
  const covered = await house(corridorAt(13, 6), 6);
  const k = covered.send(1, MeshType.Command, 26, [1], true);
  covered.settle(2000);
  assert.equal(covered.deliveriesOf(k, 26) >= 1, true, "it reaches the node six hops away");
  assert.equal(covered.outcomes.get(k)?.ok, true, "and the answer comes back");

  const deep = await house(corridorAt(15, 6), 6);
  const dist = distances(deep, 1);
  const far = [...dist.entries()].find(([, d]) => d === 7)[0];
  const k2 = deep.send(1, MeshType.Command, far, [1], true);
  deep.settle(2000);
  assert.equal(deep.deliveriesOf(k2, far), 0, "a command to a node at seven hops is not delivered");
  assert.equal(deep.outcomes.get(k2)?.ok, false, "and the sender is told it was not answered");
});
