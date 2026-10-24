// Which neighbours repeat a flooded frame: each node chooses, from the lists in its neighbours' heartbeats, the few that
// between them hear every node at two hops (the multipoint relays of RFC 3626), says whom in its heartbeat, and a node that the sender did not choose
// waits for the chosen ones before it repeats. The core is compiled from its own source (tasmota/include/espnow_mesh_core.h); the nodes run over a
// simulated air, once with every node repeating as before and once with the choice, on the houses of the scale study.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MeshAir, MeshType, MESH, airtimeUs } from "../dist/index.js";

/** the nodes at one place, with the links they are given and nothing else in range, all known to each other; a node chooses relays from the first neighbour it counts on, unless it is told how many it needs */
async function links(nodes, edges, opt = {}) {
  const air = await MeshAir.create({ seed: 7, beatMs: 5000, chooseRelays: true, relayMinNeighbors: 1, ...opt });
  for (const id of nodes) air.add(id, 0, 0, 5);
  for (const [a, b, rssi = -60] of edges) air.link(a, b, rssi);
  air.syncAll();
  return air;
}
const chosen = (air, id) => air.health(id).links.filter((l) => l.chosen).map((l) => l.id).sort((a, b) => a - b);
const seq = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const columns = (rooms) => (rooms <= 7 ? rooms : Math.ceil(Math.sqrt(rooms * 1.5)));
/** the house of the scale study: rooms 6 m apart in a grid, a bridge and a panel in each, 8 dB for every wall */
async function grid(rooms, opt = {}) {
  const air = await MeshAir.create({ seed: 5, beatMs: 5000, startSync: true, ...opt });
  const at = [];
  for (let r = 0; r < rooms; r++) {
    const x = (r % columns(rooms)) * 6, y = Math.floor(r / columns(rooms)) * 6;
    at.push([x, y]);
    air.add(2 * r + 1, x, y, 5);
    air.add(2 * r + 2, x + 1.5, y + 1, 5);
  }
  const roomOf = (n) => Math.floor((n.id - 1) / 2);
  air.geometry(2.2, (a, b) => {
    const [ax, ay] = at[roomOf(a)], [bx, by] = at[roomOf(b)];
    return 8 * (Math.abs(ax - bx) / 6 + Math.abs(ay - by) / 6);
  });
  return air;
}

/** the ordered pairs a frame can get across: by the links of -85 dBm or better, in the hops of radio of a flood (the origin's own and its repeats) */
function reachable(air, hops = MESH.MAX_HOPS + 1, floor = -85) {
  const ids = air.nodes.map((n) => n.id);
  const out = [];
  for (const a of ids) {
    const dist = new Map([[a, 0]]);
    const queue = [a];
    while (queue.length) {
      const x = queue.shift();
      if (dist.get(x) >= hops) continue;
      for (const y of ids) if (!dist.has(y) && (air.heard(x, y) ?? -999) >= floor && (air.heard(y, x) ?? -999) >= floor) { dist.set(y, dist.get(x) + 1); queue.push(y); }
    }
    for (const b of dist.keys()) if (b !== a) out.push([a, b]);
  }
  return out;
}
function busyShare(air, fromUs, toUs) {
  const iv = air.log.filter((l) => l.at < toUs && l.at + airtimeUs(l.len) > fromUs)
    .map((l) => [Math.max(l.at, fromUs), Math.min(l.at + airtimeUs(l.len) + (l.to !== 255 ? 300 : 0), toUs)]).sort((a, b) => a[0] - b[0]);
  let busy = 0, end = -1;
  for (const [a, b] of iv) { if (a > end) { busy += b - a; end = b; } else if (b > end) { busy += b - end; end = b; } }
  return busy / (toUs - fromUs);
}
function watchStart(air, seconds = 30) {
  const pairs = reachable(air);
  const known = () => pairs.filter(([a, b]) => air.knows(a, b)).length;
  const r = { pairs: pairs.length, known: 0, t99: null, t100: null, frames: 0, busy: 0, busyPeak: 0 };
  const t0 = air.t;
  for (let t = 250; t <= seconds * 1000; t += 250) {
    air.run(250);
    const k = known();
    if (r.t99 === null && k >= 0.99 * pairs.length) r.t99 = (air.t - t0) / 1e6;
    if (r.t100 === null && k === pairs.length) r.t100 = (air.t - t0) / 1e6;
  }
  r.known = known();
  r.frames = air.log.length;
  r.busy = busyShare(air, t0, air.t);
  for (let w = t0; w + 1e6 <= air.t; w += 250000) r.busyPeak = Math.max(r.busyPeak, busyShare(air, w, w + 1e6));
  return r;
}

/** every node sends one event to everyone, one after another, on a house that has settled: the frames of each flood and who got it */
function floods(air, reps = 1) {
  const ids = air.nodes.map((n) => n.id);
  let frames = 0, reached = 0, possible = 0, worst = 1;
  for (let rep = 0; rep < reps; rep++) {
    for (const id of ids) {
      const key = air.send(id, MeshType.Event, MESH.TO_ALL, [id, rep, 9, 9, 9, 9, 9, 9]);
      air.run(700);
      const got = air.reached(key).size;
      frames += air.copies(key);
      reached += got;
      possible += ids.length - 1;
      worst = Math.min(worst, got / (ids.length - 1));
    }
  }
  return { framesPer: frames / (reps * ids.length), delivery: reached / possible, worst };
}

/** commands that ask for an answer between pairs drawn at random, one every `gapMs` */
function commands(air, n, gapMs, seed = 5) {
  const ids = air.nodes.map((x) => x.id);
  let rnd = 12345 + seed;
  const next = () => (rnd = (rnd * 1103515245 + 12345) & 0x7fffffff);
  const t0 = air.t, log0 = air.log.length;
  const keys = [];
  for (let i = 0; i < n; i++) {
    const a = ids[next() % ids.length];
    let b = ids[next() % ids.length];
    if (b === a) b = ids[(ids.indexOf(a) + 1) % ids.length];
    keys.push(air.send(a, MeshType.Command, b, [i & 255], true));
    air.run(gapMs);
  }
  air.run(1500);
  return { ok: keys.filter((k) => air.outcomes.get(k)?.ok).length, unanswered: keys.filter((k) => !air.outcomes.get(k)).length, frames: air.log.length - log0, busy: busyShare(air, t0, air.t) };
}

// --- the choice ----------------------------------------------------------------------------------

test("a node chooses as relays the neighbours that are the only ones to hear some node at two hops, and then the ones that hear the most of what is left", async () => {
  // 1 hears 2, 3 and 4. 2 hears 5, 6, 7; 3 hears 5, 6; 4 hears 7, 8: 8 is heard by 4 alone, so 4 is a relay; 5 and 6 are heard by 2 and 3 alike,
  // and 7 by 2 and 4: after 4 the nodes left are 5 and 6, which 2 and 3 cover alike, and one of them is enough
  const air = await links(seq(1, 8), [[1, 2], [1, 3], [1, 4], [2, 5], [2, 6], [2, 7], [3, 5], [3, 6], [4, 7], [4, 8]], { startSync: false });
  air.run(70000);
  const set = chosen(air, 1);
  assert.equal(set.length, 2, "4 for 8, and one of 2 and 3 for 5 and 6");
  assert.ok(set.includes(4) && (set.includes(2) !== set.includes(3)), `${set}`);
  assert.equal(air.health(1).relays, 2);
  // two neighbours hear the one node at two hops: one of them is enough
  const only = await links(seq(1, 4), [[1, 2], [1, 3], [2, 4], [3, 4]]);
  only.run(70000);
  assert.equal(chosen(only, 1).length, 1, "4 is heard by both 2 and 3: one of them");
  const solo = await links(seq(1, 5), [[1, 2], [1, 3], [2, 4], [3, 5]]);
  solo.run(70000);
  assert.deepEqual(chosen(solo, 1), [2, 3], "each is the only one to hear a node of its own: both");
});

test("a neighbour that loses most of its heartbeats is not chosen, however strong, and the choice does not shift from one heartbeat to the next", async () => {
  const edges = [[1, 2, -45], [1, 3, -60], [1, 4, -60], [2, 5, -60], [3, 5, -60], [4, 6, -60]];
  const air = await links(seq(1, 6), edges);
  air.setLinkLoss(2, 1, 0.7);
  air.run(120000);
  assert.equal(air.neighbors(1).find((n) => n.id === 2).usable, false, "2 delivers little");
  assert.deepEqual(chosen(air, 1), [3, 4], "3 does the work of 2 for 5, and 4 stands for 6");
  const seen = new Set();
  for (let i = 0; i < 24; i++) { air.run(5000); seen.add(chosen(air, 1).join(",")); }
  assert.equal(seen.size, 1, `the choice of 24 heartbeats: ${[...seen].join(" | ")}`);
});

test("a node with few neighbours chooses none and says nothing of relays: it leaves the repeating to flooding", async () => {
  const air = await links(seq(1, 5), [[1, 2], [1, 3], [2, 4], [3, 5]], { relayMinNeighbors: 0 });
  air.run(70000);
  // the heartbeat of node 1 ends where its list of neighbours does
  const beat = air.log.filter((l) => l.origin === 1 && l.kind >> 5 === MeshType.Beat && l.dest === MESH.TO_ALL && l.hops === 0).pop();
  const p = beat.bytes.slice(MESH.HEADER, beat.bytes.length - MESH.TAG);
  const listed = p[3 + p[2]];
  assert.equal(p.length, 3 + p[2] + 1 + 2 * listed, "no count of relays after the neighbours");
  assert.equal(air.health(1).relays, 0);
});

test("with ten neighbours a node's heartbeat names its relays after its neighbours, and the others read the count and the numbers", async () => {
  // 1 hears 2..11, and 12..14 are heard by 2, 3 and 4 alone each
  const edges = [...seq(2, 11).map((n) => [1, n]), [2, 12], [3, 13], [4, 14]];
  const air = await links(seq(1, 14), edges, { relayMinNeighbors: 0 });
  air.run(90000);
  const beat = air.log.filter((l) => l.origin === 1 && l.kind >> 5 === MeshType.Beat && l.dest === MESH.TO_ALL && l.hops === 0).pop();
  const p = beat.bytes.slice(MESH.HEADER, beat.bytes.length - MESH.TAG);
  const listed = p[3 + p[2]];
  const at = 3 + p[2] + 1 + 2 * listed;
  assert.equal(listed, 10);
  assert.equal(p[at], 3, "three relays");
  assert.deepEqual([...p.slice(at + 1, at + 4)].sort((a, b) => a - b), [2, 3, 4], "2, 3 and 4, each the only one to hear a node");
  assert.equal(p.length, at + 4, "and nothing after them");
  assert.equal(air.neighbors(2).find((n) => n.id === 1).selectsMe, 1, "node 2 reads that it was chosen");
  assert.equal(air.neighbors(5).find((n) => n.id === 1).selectsMe, 2, "and node 5 that it was not");
  // nodes that choose none say nothing: they read as not known
  assert.equal(air.neighbors(2).find((n) => n.id === 12).selectsMe, 0, "node 12 has one neighbour and chose none");
});

test("the heartbeat with the relays fits a frame at the most neighbours a node keeps", async () => {
  const air = await MeshAir.create({ seed: 7, beatMs: 5000, chooseRelays: true });
  for (let i = 1; i <= 48; i++) air.add(i, 0, 0, 5);
  for (let a = 1; a <= 48; a++) for (let b = a + 1; b <= 48; b++) air.link(a, b, -55);
  air.syncAll();
  air.run(40000);
  const sizes = air.log.filter((l) => l.kind >> 5 === MeshType.Beat && l.dest === MESH.TO_ALL && l.hops === 0).map((l) => l.len);
  assert.ok(Math.max(...sizes) <= MESH.MAX_FRAME, `${Math.max(...sizes)} bytes`);
  assert.equal(air.health(1).relays, 0, "in one room every node hears every other: there is no node at two hops, and no relay to choose");
});

// --- what a node that is not chosen does -----------------------------------------------------------------

test("a node that the sender did not choose repeats later, and not at all when it hears enough of the others", async () => {
  // S (1) hears A (2), B (3), and eight more; B is the only one to hear U (13), so B is chosen; A hears T (12) as B does, and is not
  const edges = [...seq(2, 11).map((n) => [1, n]), [3, 13], [2, 12], [3, 12]];
  for (const mode of [false, true]) {
    const air = await links(seq(1, 13), edges, { chooseRelays: mode });
    air.run(90000);
    const before = air.log.length;
    const key = air.send(1, MeshType.Event, MESH.TO_ALL, [1, 2, 3]);
    air.run(500);
    const frames = air.log.slice(before).filter((l) => l.origin === 1 && l.counter === Number(key.split(":")[2]));
    const got = air.reached(key);
    assert.equal(got.size, 12, `${mode ? "with" : "without"} the choice every other node gets it`);
    if (mode) {
      const from = frames.map((l) => l.from);
      assert.ok(from.includes(3), "B repeats");
      const waited = frames.filter((l) => l.from !== 1 && l.from !== 3);
      assert.ok(waited.every((l) => l.at - frames[0].at >= 30000), "any other repeats only after the wait of 30 ms or more");
      assert.ok(air.core.stat(air.node(2).slot, "relayHeld") > 0, "the node counted a repeat it held back");
    }
  }
});

test("when the chosen relay is gone, a node that was not chosen repeats after its wait, and the frame still gets to the node behind it", async () => {
  // S (1) hears 2..11; 12 hears 2 and 3; 3 is chosen for 13 (heard by 3 alone) and also hears 12
  const edges = [...seq(2, 11).map((n) => [1, n]), [2, 12], [3, 12], [3, 13]];
  const air = await links(seq(1, 13), edges);
  air.run(90000);
  assert.deepEqual(chosen(air, 1), [3], "3 alone: it hears 13, and 12 as well");
  air.power(3, false);
  const key = air.send(1, MeshType.Event, MESH.TO_ALL, [1]);
  air.run(500);
  const got = air.reached(key);
  assert.ok(got.has(12), "12 gets it from 2, which was not chosen and repeated when no copy of the chosen one came");
  assert.ok(got.get(12) >= 30000, `and not before the wait of 30 ms: ${got.get(12) / 1000} ms`);
  assert.equal(got.has(13), false, "13 had no other way: nothing can be done for it");
  assert.ok(air.core.stat(air.node(2).slot, "relayHeld") > 0, "node 2 had held its repeat back");
});

test("a mixed house, some nodes choosing and some repeating as before, delivers every flood", async () => {
  const air = await grid(15, { chooseRelays: false });
  // the nodes of the odd rooms choose, the others do not: the ones that do not leave their heartbeats as they were
  for (const n of air.nodes) air.core.begin(n.slot, n.id, { epoch: n.epoch, seed: 5 + n.id * 7919, tagged: true, beatMs: 5000, startSync: true, chooseRelays: Math.floor((n.id - 1) / 2) % 2 === 1 });
  air.run(70000);
  const f = floods(air);
  assert.equal(f.delivery, 1, "every node got every flood");
  assert.equal(f.worst, 1);
});

// --- the houses of the scale study, flooding as it was against the choice ----------------------------------

const seeds = [5, 6, 7];
for (const [rooms, label, framesMax] of [[7, "14", 1.5], [15, "30", 0.75], [20, "40", 0.8]]) {
  test(`${label} nodes: the same floods with the choice take fewer frames than with every node repeating, and none of them is lost`, async () => {
    let flood = 0, choice = 0, deliveredFlood = 0, deliveredChoice = 0;
    for (const seed of seeds) {
      const a = await grid(rooms, { seed });
      a.run(60000);
      const fa = floods(a);
      const b = await grid(rooms, { seed, chooseRelays: true });
      b.run(60000);
      const fb = floods(b);
      flood += fa.framesPer;
      choice += fb.framesPer;
      deliveredFlood += fa.delivery;
      deliveredChoice += fb.delivery;
      assert.equal(fb.delivery, 1, `seed ${seed}: ${(100 * fb.delivery).toFixed(2)}% of the floods delivered`);
      assert.equal(fb.worst, 1, `seed ${seed}: the worst flood`);
    }
    assert.ok(choice <= framesMax * flood, `${(choice / seeds.length).toFixed(1)} frames a flood with the choice against ${(flood / seeds.length).toFixed(1)}`);
    assert.ok(deliveredChoice >= deliveredFlood, "and the delivery is not lower than with flooding");
  });
}

for (const [rooms, label, burst] of [[7, "14", 300], [15, "30", 296], [20, "40", 292]]) {
  test(`${label} nodes: 300 commands that ask for an answer at 6.7 a second end as many answered with the choice as without it, on less of the channel`, async () => {
    const a = await grid(rooms);
    a.run(60000);
    const flood = commands(a, 300, 150);
    const b = await grid(rooms, { chooseRelays: true });
    b.run(60000);
    const choice = commands(b, 300, 150);
    assert.ok(choice.ok >= flood.ok, `${choice.ok} against ${flood.ok}`);
    assert.ok(choice.ok >= burst, `${choice.ok} of 300`);
    assert.equal(choice.unanswered, 0, "every command confirmed or reported");
    if (rooms > 7) assert.ok(choice.frames < 0.8 * flood.frames, `${choice.frames} frames against ${flood.frames}`);
    assert.ok(choice.busy <= flood.busy * 1.1, `the channel busy ${(100 * choice.busy).toFixed(1)}% against ${(100 * flood.busy).toFixed(1)}%`);
  });
}

test("a house that starts all at once from nothing knows its pairs as soon with the choice as without it", async () => {
  for (const [rooms, seed] of [[7, 5], [15, 5], [16, 7]]) {
    const flood = watchStart(await grid(rooms, { seed }));
    const choice = watchStart(await grid(rooms, { seed, chooseRelays: true }));
    assert.ok(choice.known >= flood.known - 1, `${rooms * 2} nodes: ${choice.known} of ${choice.pairs} pairs known at 30 s against ${flood.known}`);
    assert.ok(choice.t99 !== null && choice.t99 <= (flood.t99 ?? 30) + 2, `99% at ${choice.t99} s against ${flood.t99} s`);
    assert.ok(choice.frames <= flood.frames * 1.1, `${choice.frames} frames against ${flood.frames}`);
    assert.ok(choice.busyPeak <= flood.busyPeak + 0.1, `${(100 * choice.busyPeak).toFixed(0)}% at the worst second against ${(100 * flood.busyPeak).toFixed(0)}%`);
  }
});

test("with 15% of the receptions lost at random the choice delivers every flood that flooding delivers, in a house of 30", async () => {
  let a = 0, b = 0, n = 0;
  for (const seed of [5, 6, 7, 8]) {
    const flood = await grid(15, { seed, loss: 0.15 });
    flood.run(60000);
    const choice = await grid(15, { seed, loss: 0.15, chooseRelays: true });
    choice.run(60000);
    a += floods(flood).delivery;
    b += floods(choice).delivery;
    n++;
  }
  assert.ok(b / n >= a / n - 0.0005, `${(100 * b / n).toFixed(2)}% with the choice, ${(100 * a / n).toFixed(2)}% without`);
});
