// The health of a mesh, from what the heartbeats say: how well each neighbour's heartbeats get here, which neighbours a node
// counts on, the groups they fall in, which of them is its only way to some node, and which neighbour a full radio table gives up. The core is
// compiled from its own source (tasmota/include/espnow_mesh_core.h); the nodes run over a simulated air.
//
// What a node can say is limited by what it sees, two hops: a node that is a point of failure for the house always shows more than one group of neighbours
// (never missed), and one that shows more than one is not always one (a ring of five or more shows it at every node). The reports of all the nodes put together
// say for certain, and healthGraph and articulationPoints are what a tool that collects them would run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MeshAir, MeshCore, MeshType, MESH, PeerRole, macOf, packKind, healthGraph, articulationPoints } from "../dist/index.js";

/** a house with the links it is given, in dBm, and nothing else in range: every node knows every other, as if its start had gone by */
async function links(nodes, edges, opt = {}) {
  const air = await MeshAir.create({ seed: 7, beatMs: 5000, ...opt });
  for (const id of nodes) air.add(id, 0, 0, 5);
  for (const [a, b, rssi = -60] of edges) air.link(a, b, rssi);
  air.syncAll();
  return air;
}
const seq = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const ring = (n) => seq(1, n).map((i) => [i, (i % n) + 1]);
const flagged = (air) => air.nodes.filter((n) => air.health(n.id).branches > 1).map((n) => n.id);

const columns = (rooms) => (rooms <= 7 ? rooms : Math.ceil(Math.sqrt(rooms * 1.5)));
/** the house of the scale study: rooms 6 m apart in a grid, a bridge and a panel in each, 8 dB for every wall; `extra` are nodes elsewhere, {id, x, y}, each in a room of its own */
async function grid(rooms, opt = {}, extra = []) {
  const air = await MeshAir.create({ seed: 5, beatMs: 5000, startSync: true, ...opt });
  const room = new Map();
  for (let r = 0; r < rooms; r++) {
    const x = (r % columns(rooms)) * 6, y = Math.floor(r / columns(rooms)) * 6;
    room.set(2 * r + 1, [x, y]);
    room.set(2 * r + 2, [x, y]);
    air.add(2 * r + 1, x, y, 5);
    air.add(2 * r + 2, x + 1.5, y + 1, 5);
  }
  for (const e of extra) { room.set(e.id, [e.x, e.y]); air.add(e.id, e.x, e.y, 5); }
  air.geometry(2.2, (a, b) => {
    const [ax, ay] = room.get(a.id), [bx, by] = room.get(b.id);
    return 8 * (Math.abs(ax - bx) / 6 + Math.abs(ay - by) / 6);
  });
  return air;
}

// --- the neighbourhood of a node ---------------------------------------------------------------------

test("a line of five: the middle node shows two groups of neighbours and two ways that are its only ones, and the three that are cut points are the ones flagged", async () => {
  const air = await links(seq(1, 5), [[1, 2], [2, 3], [3, 4], [4, 5]]);
  air.run(60000);
  const h3 = air.health(3);
  assert.equal(h3.neighbors, 2, "node 3 hears 2 and 4");
  assert.equal(h3.twoHop, 2, "and, past them, 1 and 5");
  assert.equal(h3.branches, 2, "2 and 4 do not hear each other, nor a node in common: two groups");
  assert.equal(h3.soleWays, 2, "2 is its only way to 1, and 4 to 5");
  assert.deepEqual(h3.links.map((l) => [l.id, l.only, l.reach]).sort(), [[2, 1, 1], [4, 1, 1]]);
  assert.notEqual(h3.links[0].branch, h3.links[1].branch, "each neighbour in a group of its own");
  const h2 = air.health(2);
  assert.equal(h2.branches, 2, "node 2: 1 and 3 do not meet within two hops");
  assert.equal(h2.soleWays, 1, "3 is its only way to 4");
  const h1 = air.health(1);
  assert.deepEqual([h1.neighbors, h1.branches, h1.soleWays], [1, 1, 1], "an end has one neighbour, which is its only way to all the rest: that neighbour is its point of failure, and the end is not one");
  assert.deepEqual(flagged(air), [2, 3, 4], "what the nodes flag of themselves: the three in the middle");
  assert.deepEqual(articulationPoints(healthGraph(air)), [2, 3, 4], "and the reports put together say the same, for certain");
});

test("a node with two neighbours that do not hear each other is a point of failure; with two that do, it is not", async () => {
  const apart = await links([1, 2, 3], [[1, 2], [1, 3]]);
  apart.run(40000);
  assert.equal(apart.health(1).branches, 2, "2 and 3 are two groups");
  assert.equal(apart.health(1).neighbors, 2);
  assert.deepEqual(articulationPoints(healthGraph(apart)), [1]);
  const together = await links([1, 2, 3], [[1, 2], [1, 3], [2, 3]]);
  together.run(40000);
  assert.equal(together.health(1).branches, 1, "2 and 3 list each other: one group");
  assert.equal(together.health(1).soleWays, 0, "and no neighbour is the only way to anything");
  assert.deepEqual(articulationPoints(healthGraph(together)), []);
  assert.deepEqual(flagged(together), []);
});

test("two nodes that hear a third and a fourth in common are one group, though they do not hear each other", async () => {
  // 1 hears 2 and 3; 2 and 3 both hear 4, and not each other: they meet at 4, which lies at two hops
  const air = await links([1, 2, 3, 4], [[1, 2], [1, 3], [2, 4], [3, 4]]);
  air.run(40000);
  const h = air.health(1);
  assert.equal(h.branches, 1, "a square: the two ways round meet");
  assert.equal(h.twoHop, 1);
  assert.equal(h.soleWays, 0, "and neither is the only way to 4");
  assert.deepEqual(articulationPoints(healthGraph(air)), []);
});

test("a ring of four has no point of failure and none shows one; of six, none is, and the two-hop view of each node cannot tell it from a line, which the reports of all of them can", async () => {
  const four = await links(seq(1, 4), ring(4));
  four.run(60000);
  assert.deepEqual(flagged(four), [], "four in a ring: each node's two neighbours meet at the fourth");
  assert.deepEqual(articulationPoints(healthGraph(four)), []);
  const six = await links(seq(1, 6), ring(6));
  six.run(60000);
  assert.deepEqual(articulationPoints(healthGraph(six)), [], "no node of a ring is a point of failure");
  assert.deepEqual(flagged(six), seq(1, 6), "yet each node of it sees two groups: past two hops it cannot tell the ring from a line");
  for (const n of six.nodes) assert.equal(six.health(n.id).soleWays, 2, "and each of its two neighbours is its only way to one node it knows of, which is not a way to nowhere else");
  // the line it would be, and the way to tell them apart
  const line = await links(seq(1, 6), ring(6).slice(0, 5));
  line.run(60000);
  assert.deepEqual(articulationPoints(healthGraph(line)), [2, 3, 4, 5], "a line of six: the four in the middle");
  assert.deepEqual(flagged(line), [2, 3, 4, 5], "all of which the nodes flag: a point of failure is never missed");
});

test("the heartbeats of a house, one node in each wing and one between: a point of failure that is never missed, and a repeater takes it away", async () => {
  // a house of 14, and a wing of two nodes that hear one node of it and nothing else
  const air = await grid(7, {}, [{ id: 91, x: 400, y: 0 }, { id: 92, x: 402, y: 0 }, { id: 93, x: 400, y: 6 }]);
  air.power(93, false);                    // the repeater is not there yet
  air.link(14, 91, -60);
  air.link(14, 92, -60);
  air.link(91, 92, -55);
  air.syncAll();
  air.run(60000);
  const x = air.health(14);
  assert.equal(x.branches, 2, "node 14 shows two groups: the wing, and the house");
  assert.equal(x.soleWays, 0, "no neighbour of it is the only way to a node at two hops: the wing's two nodes are its own neighbours, and what the house has beyond is listed by more than one");
  assert.equal(air.health(91).neighbors, 2, "a node of the wing hears the other and node 14: its way out is one node");
  assert.deepEqual(articulationPoints(healthGraph(air)), [14], "for certain: the house is split at node 14 alone");
  assert.ok(flagged(air).includes(14), "and node 14 says it of itself");
  assert.equal(flagged(air).filter((id) => id !== 14).length, 0, "no other node of the house says it");
  // a repeater that hears the wing and a node of the house on the other side
  air.link(93, 91, -60);
  air.link(93, 92, -60);
  air.link(93, 12, -70);
  air.power(93, true);
  air.run(90000);
  assert.deepEqual(articulationPoints(healthGraph(air)), [], "with the repeater no node is a point of failure");
  assert.equal(air.health(14).branches, 1, "node 14 shows one group again: the wing's two nodes and the house meet at the repeater");
  assert.deepEqual(flagged(air), [], "and no node of the house flags itself");
});

test("a house of 14, of 30 and of 40 of the scale study has no point of failure, and none of its nodes shows one", async () => {
  for (const rooms of [7, 15, 20]) {
    const air = await grid(rooms);
    air.run(60000);
    assert.deepEqual(articulationPoints(healthGraph(air)), [], `${rooms * 2} nodes: none`);
    assert.deepEqual(flagged(air), [], `${rooms * 2} nodes: none shows more than one group`);
    for (const n of air.nodes) {
      const h = air.health(n.id);
      assert.ok(h.neighbors >= 5, `node ${n.id} counts on ${h.neighbors} neighbours`);
      assert.equal(h.weak, 0, "none heard and not counted on");
    }
  }
});

// --- the quality of a link, by delivery ----------------------------------------------------------------------

test("the quality of a neighbour is how many of its heartbeats come: a strong signal that loses most of them is heard and not counted on", async () => {
  // nodes 2 and 3 are heard at the same strength by 1, and 2 loses 60% of what it sends to it
  const air = await links([1, 2, 3], [[1, 2, -50], [1, 3, -50]]);
  air.setLinkLoss(2, 1, 0.6);
  air.run(10000);
  const early = air.neighbors(1).find((n) => n.id === 3);
  assert.equal(early.quality, 255, "too few intervals to judge: not known, and counted on");
  assert.equal(early.usable, true);
  air.run(110000);
  const bad = air.neighbors(1).find((n) => n.id === 2), good = air.neighbors(1).find((n) => n.id === 3);
  assert.equal(good.quality, 100, "the one that loses nothing");
  assert.ok(bad.quality < 50, `the one that loses 60% reads ${bad.quality}%, though it is heard as loud`);
  assert.equal(bad.usable, false);
  assert.equal(good.usable, true);
  assert.equal(bad.rssi, good.rssi, "by the signal alone they are the same");
  const h = air.health(1);
  assert.deepEqual([h.neighbors, h.weak], [1, 1], "one counted on, one heard and not counted on");
  assert.equal(h.links.find((l) => l.id === 2).usable, false);
  assert.ok(Math.abs(h.links.find((l) => l.id === 2).quality - bad.quality) <= 0, "the health report says the same");
});

test("the quality is of the radio: heartbeats that come by the network do not raise it", async () => {
  const air = await links([1, 2], [[1, 2, -50]], { net: true });
  air.setLinkLoss(2, 1, 0.7);
  air.run(120000);
  const n = air.neighbors(1).find((x) => x.id === 2);
  assert.ok(n.quality < 50, `${n.quality}%: every heartbeat of 2 arrives, but by the network`);
  assert.ok(air.core.stat(air.node(1).slot, "udpHeard") > 15, "and many did come by it");
});

test("a neighbour that stops talking falls as the intervals pass, and one that comes back climbs", async () => {
  const air = await links([1, 2, 3], [[1, 2], [1, 3], [2, 3]]);
  air.run(60000);
  assert.equal(air.neighbors(1).find((n) => n.id === 2).quality, 100);
  air.power(2, false);
  air.run(12000);
  const q1 = air.neighbors(1).find((n) => n.id === 2).quality;
  assert.ok(q1 < 100 && q1 >= 50, `after 12 s with no heartbeat: ${q1}%`);
  air.run(10000);
  const q2 = air.neighbors(1).find((n) => n.id === 2);
  assert.ok(q2 === undefined || q2.quality < q1, "and lower still after 22 s");
  air.power(2, true);
  air.run(120000);
  assert.equal(air.neighbors(1).find((n) => n.id === 2).quality > 85, true, "heard again, the delivery recovers as the old intervals leave the window");
});

test("two heartbeats of the same interval are counted once, and a window of 16 intervals is a minute and a half", async () => {
  const core = await MeshCore.load();
  core.begin(0, 1, { epoch: 3, seed: 5, beatMs: 5000 });
  core.synced(0, 9, 5, 0);
  const beat = (counter, hears = [1]) => core.encode({ kind: packKind(MeshType.Beat), origin: 9, dest: 255, next: 0, hops: 0, epoch: 5, counter, payload: [0, 0, 0, hears.length, ...hears.flatMap((h) => [h, 0xc4])] }, true);
  const at = (c) => core.receive(0, beat(c), macOf(9), -60, 5000 * c);
  for (let c = 1; c <= 8; c++) assert.equal(at(c), "accepted");
  const q = (now) => core.neighbors(0, now).find((n) => n.id === 9);
  assert.equal(q(5000 * 8).quality, 100, "eight intervals, eight heartbeats");
  // the 9th and 10th do not come, the 11th does
  assert.equal(at(11), "accepted");
  const after = q(5000 * 11).quality;
  assert.equal(after, Math.floor(9 * 100 / 11), "11 intervals, 9 heartbeats");
  // a long silence is the whole window
  assert.equal(q(5000 * 11 + 200000).quality, 0, "nothing for 200 s: nothing delivered");
});

// --- the peer that a full radio table gives up ------------------------------------------------------------------

test("what a neighbour is worth as a peer: the only way to some node is never given up, a redundant one before it, one that is not heard first", async () => {
  const air = await links(seq(1, 5), [[1, 2], [2, 3], [3, 4], [4, 5]]);
  air.run(60000);
  const role = (a, b) => air.core.peerRole(air.node(a).slot, b, air.ms);
  assert.equal(role(3, 2), PeerRole.OnlyWay, "2 is node 3's only way to 1");
  assert.equal(role(3, 4), PeerRole.OnlyWay, "and 4 to 5");
  assert.equal(role(2, 1), PeerRole.Redundant, "1 leads nowhere that 2 reaches otherwise not: a leaf that nobody else lists");
  assert.equal(role(2, 3), PeerRole.OnlyWay, "3 is node 2's way to 4");
  assert.equal(role(3, 5), PeerRole.Gone, "a node that is no neighbour of it, and one that never was");
  assert.equal(role(1, 99), PeerRole.Gone);
  // in a triangle with a tail, the two that list each other and the tail's own node are each redundant for the other
  const tri = await links(seq(1, 4), [[1, 2], [1, 3], [2, 3], [3, 4]]);
  tri.run(60000);
  const r2 = (a, b) => tri.core.peerRole(tri.node(a).slot, b, tri.ms);
  assert.equal(r2(1, 2), PeerRole.Redundant, "node 1: 3 lists 4 and 2 does not: 3 is the only way to 4, and 2 leads nowhere that 3 does not");
  assert.equal(r2(1, 3), PeerRole.OnlyWay);
  // a neighbour that delivers too little is given up before a redundant one
  const air3 = await links([1, 2, 3, 4], [[1, 2, -50], [1, 3, -50], [1, 4, -50], [2, 3], [2, 4], [3, 4]]);
  air3.setLinkLoss(2, 1, 0.7);
  air3.run(120000);
  const r3 = (b) => air3.core.peerRole(air3.node(1).slot, b, air3.ms);
  assert.equal(r3(2), PeerRole.Weak, "heard, and not counted on");
  assert.equal(r3(3), PeerRole.Redundant);
  // and one that went silent is gone
  air3.power(4, false);
  air3.run(40000);
  assert.equal(r3(4), PeerRole.Gone);
});
