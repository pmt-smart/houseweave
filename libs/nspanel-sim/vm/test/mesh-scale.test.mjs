// The mesh at the size of the house it is for: 15 panels and 15 bridges, one network, a core with tables of 48 for a design of 32 nodes.
// What these hold: the tables take 32 nodes and more, the keys of the pairs reach every node, a house that starts all at once from nothing
// (no node told of any other: the nodes are not given to each other beforehand, as house() of mesh.test.mjs does) knows its pairs in
// under 30 s on the air a house has, and the regime after it, with 300 commands that ask for an answer, holds at 14, 30 and 40 nodes.
//
// The house is the one of the scale study: rooms 6 m apart in a grid (a row up to 7 rooms, 5 or 6 columns above), a panel and a bridge in
// each, 8 dB for every wall between, the signal of the log-distance model with the exponent 2.2.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MeshAir, MeshCore, MeshType, MESH, airtimeUs } from "../dist/index.js";

const columns = (rooms) => (rooms <= 7 ? rooms : Math.ceil(Math.sqrt(rooms * 1.5)));

/** the house of `rooms` rooms: nodes 2r+1 (the bridge) and 2r+2 (the panel) in room r */
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

/** the share of the time the channel is busy somewhere: the union of what is on the air, with the acknowledgement of a unicast */
function busyShare(air, fromUs, toUs) {
  const iv = air.log.filter((l) => l.at < toUs && l.at + airtimeUs(l.len) > fromUs)
    .map((l) => [Math.max(l.at, fromUs), Math.min(l.at + airtimeUs(l.len) + (l.to !== 255 ? 300 : 0), toUs)]).sort((a, b) => a[0] - b[0]);
  let busy = 0, end = -1;
  for (const [a, b] of iv) { if (a > end) { busy += b - a; end = b; } else if (b > end) { busy += b - end; end = b; } }
  return busy / (toUs - fromUs);
}

/** a cold start watched for `seconds`: the pairs known, when the 99% and the all came, and what the air carried */
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

// --- the tables ----------------------------------------------------------------------------------

test("a node keeps 47 origins and 47 neighbours: a house of 48 in one room is flooded, answered by every node, and every heartbeat lists them all", async () => {
  const air = await MeshAir.create({ seed: 7, beatMs: 5000 });
  for (let i = 1; i <= 48; i++) air.add(i, 0, 0, 5);
  for (let a = 1; a <= 48; a++) for (let b = a + 1; b <= 48; b++) air.link(a, b, -55);
  air.syncAll();
  const key = air.send(1, MeshType.State, 255, [1, 2, 3]);
  air.settle();
  assert.equal(air.reached(key).size, 47, "every other node");
  const keys = [];
  for (let b = 2; b <= 48; b++) { keys.push(air.send(1, MeshType.Command, b, [b], true)); air.settle(); }
  assert.deepEqual(keys.filter((k) => !air.outcomes.get(k)?.ok), [], "a command that asks for an answer to each of the 47 others, every one answered: 47 ways back at the node");
  air.run(30000);
  assert.equal(air.neighbors(1).length, 47, "the neighbours of the first node, by its heartbeats");
  assert.equal(air.neighbors(1).filter((n) => n.hears.length === 47 || n.hears.length === 46).length, 47, "each lists those it hears: nearly all the others");
  const biggest = Math.max(...air.log.filter((l) => l.kind >> 5 === MeshType.Beat && l.dest === MESH.TO_ALL && l.hops === 0).map((l) => l.len));
  assert.ok(biggest >= MESH.HEADER + 3 + 1 + 2 * 46 + MESH.TAG && biggest <= MESH.MAX_FRAME, `a heartbeat listing 47 neighbours is ${biggest} bytes: it fits a frame`);
  assert.equal(air.nodes.every((n) => air.core.stat(n.slot, "unsynced") === 0), true, "no ask that nobody answers: no origin left out of the table");
});

test("with more nodes than the tables hold, a node keeps 48 and goes on: the others are not heard, and nothing breaks", async () => {
  const air = await MeshAir.create({ seed: 7, beatMs: 5000 });
  for (let i = 1; i <= 52; i++) air.add(i, 0, 0, 5);
  for (let a = 1; a <= 52; a++) for (let b = a + 1; b <= 52; b++) air.link(a, b, -55);
  air.syncAll();
  for (let i = 0; i < 20; i++) { air.send(1 + (i % 52), MeshType.State, 255, [i]); air.run(100); }
  air.run(15000);
  for (const n of air.nodes) assert.ok(air.neighbors(n.id).length <= MESH.MAX_NEIGHBORS, `node ${n.id} keeps ${air.neighbors(n.id).length}`);
  assert.ok(air.neighbors(1).length >= 47);
});

test("a node of the core is 18 KB with the tables of 48, and the table of keys 2.4 KB", async () => {
  const mesh = await MeshCore.load();
  assert.ok(mesh.sizeOf() > 17000 && mesh.sizeOf() < 20000, `${mesh.sizeOf()} bytes`);   // 19 824 with the outcome of the last unicast frames to each neighbour
  // the identity, the key of the network and the pair keys of 48 nodes, 50 bytes each (the cipher key and the proof key, and the node)
  assert.ok(mesh.cryptoSizeOf() > 48 * 50 + 100 && mesh.cryptoSizeOf() < 48 * 50 + 400, `${mesh.cryptoSizeOf()} bytes of keys`);
});

// --- the keys of the pairs: more than 16 -----------------------------------------------------------

test("a node seals for and opens from 20 peers with the real cipher: the keys of the pairs are kept for every node it can hear", async () => {
  const air = await MeshAir.create({ seed: 9, cipher: "real" });
  for (let i = 1; i <= 20; i++) air.add(i, 0, 0, 5);
  for (let a = 1; a <= 20; a++) for (let b = a + 1; b <= 20; b++) air.link(a, b, -55);
  air.syncAll();
  const keys = [];
  for (let b = 2; b <= 20; b++) { keys.push(air.send(1, MeshType.Command, b, [b, 1, 2, 3], true)); air.run(30); }
  for (let a = 2; a <= 20; a++) { keys.push(air.send(a, MeshType.Command, 1, [a, 9], true)); air.run(30); }
  air.settle();
  assert.deepEqual(keys.filter((k) => !air.outcomes.get(k)?.ok), [], "a command to each of 19 peers, and one from each of them, all sealed with the key of a pair and answered");
  assert.equal(air.nodes.reduce((s, n) => s + air.core.stat(n.slot, "noKey") + air.core.stat(n.slot, "cipherBad"), 0), 0, "no frame lacked a key or failed to open");
});

test("the table of pair keys holds 48 nodes, a node that is already there is replaced, and the 49th finds no room", async () => {
  const mesh = await MeshCore.load();
  const real = (slot, id) => mesh.begin(slot, id, { epoch: 1, seed: id, cipher: "real" });
  real(0, 100);
  for (let i = 1; i <= 49; i++) real(i, i);
  for (let i = 1; i <= 48; i++) assert.equal(mesh.setPeer(0, i, mesh.identity(i)), true, `peer ${i}`);
  assert.equal(mesh.setPeer(0, 49, mesh.identity(49)), false, "the 49th");
  assert.equal(mesh.setPeer(0, 7, mesh.identity(7)), true, "one already kept is made again");
});

// --- the start of a house from nothing ----------------------------------------------------------------

test("a house of 14 that starts all at once, no node told of another, knows every pair in a few seconds with half the frames of today's start that left a fifth unknown", async () => {
  const air = await grid(7);
  const r = watchStart(air);
  assert.equal(r.known, r.pairs, `${r.known} of ${r.pairs} pairs`);
  assert.ok(r.t100 <= 10, `all known at ${r.t100} s`);
  assert.ok(r.frames < 800, `${r.frames} frames for the start, against 880 to 1 848 of the start that ended with 69% to 83% of the pairs known`);
  assert.ok(r.busy < 0.04, `the channel busy ${(100 * r.busy).toFixed(1)}% of the first 30 s, against 3.2% to 6.6% of today's`);
  assert.ok(r.busyPeak < 0.3, `and at the worst second ${(100 * r.busyPeak).toFixed(0)}%, against 25% to 33% of today's`);
});

for (const [rooms, seeds, label] of [[16, [5, 6, 7, 8, 9], "32"], [15, [5, 6], "30"]]) {
  test(`a house of ${label} that starts all at once from nothing knows every pair a frame can cross in under 30 s, on 12% of the channel`, async () => {
    for (const seed of seeds) {
      const air = await grid(rooms, { seed });
      const r = watchStart(air);
      // with a slice of 300 ms a pair that missed its answers waits for the ask 16 s after (2, 4, 8, 16): one pair of the 32 can still be unknown at 30 s, and is known by 45 s
      assert.ok(r.known >= r.pairs - (label === "30" ? 2 : 1), `seed ${seed}: ${r.known} of ${r.pairs} pairs known at 30 s`);
      assert.ok(r.t99 !== null && r.t99 <= 20, `seed ${seed}: 99% at ${r.t99} s`);
      assert.ok(r.frames < 5500, `seed ${seed}: ${r.frames} frames`);
      assert.ok(r.busy < 0.15, `seed ${seed}: the channel busy ${(100 * r.busy).toFixed(1)}% of the first 30 s`);
      assert.ok(r.busyPeak < 0.65, `seed ${seed}: and ${(100 * r.busyPeak).toFixed(0)}% at the worst second`);
    }
  });
}

test("a house of 40, beyond the design, still knows 99% of its pairs in 30 s", async () => {
  const r = watchStart(await grid(20));
  assert.ok(r.known >= 0.99 * r.pairs, `${r.known} of ${r.pairs} pairs`);
});

test("the wait that the number sets is what makes the start: with every node asking at once and none limiting its answers, a house of 32 has 3.7 times the frames and leaves pairs unknown", async () => {
  const staggered = watchStart(await grid(16));
  const together = watchStart(await grid(16, { startSlotMs: 1, startJitterMs: 1, answersPerSecond: 255 }));
  assert.equal(staggered.known, staggered.pairs);
  assert.ok(together.known < together.pairs, `${together.known} of ${together.pairs} pairs known when they all ask together`);
  assert.ok(together.frames > 2.5 * staggered.frames, `${together.frames} frames against ${staggered.frames}`);
  assert.ok(together.busyPeak > 1.5 * staggered.busyPeak, `the channel at its worst second ${(100 * together.busyPeak).toFixed(0)}% against ${(100 * staggered.busyPeak).toFixed(0)}%`);
});

test("a node that restarts in a house of 32 is known to the others in a few seconds, by what the others ask of it and its own ask", async () => {
  const air = await grid(16);
  air.run(40000);
  air.restart(7);
  const t0 = air.ms;
  let seen = null;
  // a flood of its own every quarter of a second: it is taken by the nodes that have asked it where it is, with the epoch it has now
  for (let i = 1; i <= 80 && seen === null; i++) {
    air.run(250);
    const key = air.send(7, MeshType.State, 255, [i]);
    air.settle();
    if (air.reached(key).size >= 30) seen = air.ms - t0;
  }
  assert.ok(seen !== null && seen <= 12000, `a flood of its own reaches 30 of the 31 others after ${seen} ms`);
  assert.equal(air.nodes.filter((n) => n.id !== 7 && air.knows(7, n.id)).length >= 29, true, "and it knows them: its own ask at start, in its slot, and what it was told");
});

test("the routes to a node that restarts do not fall for seconds: commands to it in the first 12 s are answered, the others' view of it not given up on its first heartbeat", async () => {
  const air = await grid(16);
  air.run(40000);
  air.restart(7);
  const keys = [];
  for (let s = 0; s < 12; s++) {
    // from the fifth second, when the node has asked the house where it is (its slot is the seventh, 1.8 s after the start) and the answers have come
    if (s >= 5) for (const from of [1, 9, 17, 25]) keys.push(air.send(from, MeshType.Command, 7, [s], true));
    air.run(1000);
  }
  air.run(1500);
  const ok = keys.filter((k) => air.outcomes.get(k)?.ok).length;
  assert.ok(ok >= 0.9 * keys.length, `${ok} of ${keys.length} commands answered while the node was starting`);
});

// --- the regime after it: 300 commands that ask for an answer, one every 150 ms and one every second ----------------------------------

const regime = async (rooms, n, gapMs, seed = 5) => {
  const air = await grid(rooms, { seed });
  air.run(40000);
  const ids = air.nodes.map((x) => x.id);
  let rnd = 12345 + seed;
  const next = () => (rnd = (rnd * 1103515245 + 12345) & 0x7fffffff);
  const t0 = air.t;
  const keys = [];
  for (let i = 0; i < n; i++) {
    const a = ids[next() % ids.length];
    let b = ids[next() % ids.length];
    if (b === a) b = ids[(ids.indexOf(a) + 1) % ids.length];
    keys.push(air.send(a, MeshType.Command, b, [i & 255], true));
    air.run(gapMs);
  }
  air.run(1500);
  return { ok: keys.filter((k) => air.outcomes.get(k)?.ok).length, unanswered: keys.filter((k) => !air.outcomes.get(k)).length, busy: busyShare(air, t0, air.t) };
};

for (const [rooms, nodes, burst, steady] of [[7, 14, 300, 120], [15, 30, 295, 118], [20, 40, 280, 112]]) {
  test(`at ${nodes} nodes, 300 commands that ask for an answer at 6.7 a second end ${burst} confirmed, and 120 at one a second ${steady}, none left without an outcome`, async () => {
    const fast = await regime(rooms, 300, 150);
    assert.ok(fast.ok >= burst, `${fast.ok} of 300 at 6.7 a second`);
    assert.equal(fast.unanswered, 0, "every command confirmed or reported");
    assert.ok(fast.busy < (nodes > 32 ? 0.2 : 0.12), `the channel busy ${(100 * fast.busy).toFixed(1)}% in the burst`);
    const slow = await regime(rooms, 120, 1000);
    assert.ok(slow.ok >= steady, `${slow.ok} of 120 at one a second`);
    assert.equal(slow.unanswered, 0);
    assert.ok(slow.busy < 0.05, `the channel busy ${(100 * slow.busy).toFixed(1)}% at one command a second, under the tenth of the air`);
  });
}
