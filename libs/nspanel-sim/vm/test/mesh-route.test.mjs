// A frame for one node goes in unicast along the best way the sender knows (Config::routeUnicast): the destination itself when it is a
// neighbour counted on, the neighbour that lists it at two hops, or the way back; each hop with the radio's own acknowledgement and resend, and the
// flood as the fallback when a hop fails or there is no way. The core is compiled from its own source (tasmota/include/espnow_mesh_core.h); the nodes
// run over a simulated air, once with the frames flooded as before and once routed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MeshAir, MeshType, MESH } from "../dist/index.js";

const seq = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** the nodes at one place, with the links they are given and nothing else in range, all known to each other, with heartbeats */
async function links(nodes, edges, opt = {}) {
  const air = await MeshAir.create({ seed: 7, beatMs: 5000, chooseRelays: true, routeUnicast: true, ...opt });
  for (const id of nodes) air.add(id, 0, 0, 5);
  for (const [a, b, rssi = -60] of edges) air.link(a, b, rssi);
  air.syncAll();
  return air;
}

/** the frames of a key's number on the air, with whom each went to: 255 for all */
function framesOf(air, key, from = 0) {
  const counter = Number(key.split(":")[2]);
  const origin = Number(key.split(":")[0]);
  return air.log.slice(from).filter((l) => l.origin === origin && l.counter === counter);
}
const stat = (air, id, name) => air.core.stat(air.node(id).slot, name);

test("a command to a neighbour goes to it alone, in unicast, and its answer comes back the same way", async () => {
  const air = await links([1, 2, 3], [[1, 2], [1, 3], [2, 3]]);
  air.run(40000);
  const before = air.log.length;
  const key = air.send(1, MeshType.Command, 2, [7], true);
  air.run(500);
  assert.equal(air.outcomes.get(key)?.ok, true, "answered");
  const sent = framesOf(air, key, before);
  assert.deepEqual(sent.map((l) => [l.to, l.bytes[4]]), [[2, 2]], "one frame, to 2, with 2 for the next hop: no broadcast, and 3 repeats nothing");
  const acks = air.log.slice(before).filter((l) => l.origin === 2 && l.kind >> 5 === MeshType.Ack);
  assert.deepEqual(acks.map((l) => l.to), [1], "the answer in unicast to 1");
  assert.equal(air.deliveriesOf(key, 2), 1);
  assert.ok(stat(air, 1, "routed") >= 1, "counted as routed");
  // the same with the flood: the command goes to all, and the third node repeats it
  const flood = await links([1, 2, 3], [[1, 2], [1, 3], [2, 3]], { routeUnicast: false });
  flood.run(40000);
  const b2 = flood.log.length;
  const k2 = flood.send(1, MeshType.Command, 2, [7], true);
  flood.run(500);
  assert.equal(flood.outcomes.get(k2)?.ok, true);
  assert.ok(framesOf(flood, k2, b2).every((l) => l.to === 255), "flooded: in broadcast");
});

test("a command two hops away goes by the neighbour that lists the destination, one unicast a hop, and is answered", async () => {
  // a line: 1 hears 2, 2 hears 3, and 1 and 3 do not hear each other
  const air = await links([1, 2, 3], [[1, 2], [2, 3]]);
  air.run(60000);
  const before = air.log.length;
  const key = air.send(1, MeshType.Command, 3, [9], true);
  air.run(500);
  assert.equal(air.outcomes.get(key)?.ok, true, "answered");
  assert.equal(air.outcomes.get(key)?.attempts, 1, "at the first attempt");
  const sent = framesOf(air, key, before);
  assert.deepEqual(sent.map((l) => [l.from, l.to]), [[1, 2], [2, 3]], "1 to 2, then 2 to 3, in unicast");
  assert.equal(air.deliveriesOf(key, 3), 1);
});

test("a hop that the radio cannot deliver goes on by the flood from the node that tried it, and the command gets there another way", async () => {
  // 1 hears 2 strongly and 4 weakly; both hear 3. The way to 3 is by 2, whose link to 3 then goes
  const air = await links([1, 2, 3, 4], [[1, 2, -45], [2, 3], [1, 4, -75], [4, 3]]);
  air.run(60000);
  air.unlink(2, 3);
  const before = air.log.length;
  const key = air.send(1, MeshType.Command, 3, [5], true);
  air.run(1500);
  assert.equal(air.outcomes.get(key)?.ok, true, "answered");
  assert.ok(stat(air, 2, "routeFlooded") >= 1, "2 put it on the flood when its hop failed");
  const sent = framesOf(air, key, before);
  assert.ok(sent.some((l) => l.from === 2 && l.to === 255), "2 flooded it");
  assert.ok(sent.some((l) => l.from === 4), "and 4 carried it to 3");
  assert.equal(air.deliveriesOf(key, 3), 1, "delivered once");
});

test("a command with no way known is flooded as before, and an answer that is not had is sent again flooded", async () => {
  const air = await links([1, 2, 3], [[1, 2], [2, 3]], { beatMs: 0, chooseRelays: false });
  // no heartbeats and no frames yet: 1 knows no way to 3
  const before = air.log.length;
  const key = air.send(1, MeshType.Command, 3, [1], true);
  air.run(500);
  assert.equal(air.outcomes.get(key)?.ok, true, "answered");
  assert.equal(framesOf(air, key, before)[0].to, 255, "the first frame in broadcast: no way known");
  // the destination's answers go astray: the resend goes flooded, whatever way the first attempt took
  const quiet = await links([1, 2], [[1, 2]]);
  quiet.run(40000);
  quiet.setLinkLoss(2, 1, 1);
  const b2 = quiet.log.length;
  const k2 = quiet.send(1, MeshType.Command, 2, [2], true);
  quiet.run(600);
  const sent = framesOf(quiet, k2, b2);
  assert.equal(sent[0].to, 2, "the first attempt in unicast");
  assert.ok(sent.slice(1).some((l) => l.to === 255 && (l.kind & 3) >= 1), "a later attempt flooded");
  assert.equal(quiet.outcomes.get(k2)?.ok, false, "and no answer came: reported");
});

test("frames for everyone keep the flood", async () => {
  const air = await links([1, 2, 3], [[1, 2], [2, 3]]);
  air.run(60000);
  const before = air.log.length;
  const key = air.send(1, MeshType.Event, MESH.TO_ALL, [1, 2, 3]);
  air.run(500);
  assert.ok(framesOf(air, key, before).every((l) => l.to === 255), "in broadcast");
  assert.equal(air.reached(key).size, 2, "and both got it");
});

// --- the comparison of the decision: the house of the scale study, commands between pairs at random -----------------------------------------

const columns = (rooms) => (rooms <= 7 ? rooms : Math.ceil(Math.sqrt(rooms * 1.5)));
/** the house of the scale study: rooms 6 m apart in a grid, a bridge and a panel in each, 8 dB for every wall */
async function grid(rooms, opt = {}) {
  const air = await MeshAir.create({ seed: 5, beatMs: 5000, startSync: true, chooseRelays: true, ...opt });
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

/** commands that ask for an answer between pairs drawn at random, one every `gapMs`: the answered, the attempts and the frames on the air */
function commands(air, n, gapMs, seed = 5) {
  const ids = air.nodes.map((x) => x.id);
  let rnd = 12345 + seed;
  const next = () => (rnd = (rnd * 1103515245 + 12345) & 0x7fffffff);
  const log0 = air.log.length;
  const keys = [];
  for (let i = 0; i < n; i++) {
    const a = ids[next() % ids.length];
    let b = ids[next() % ids.length];
    if (b === a) b = ids[(ids.indexOf(a) + 1) % ids.length];
    keys.push(air.send(a, MeshType.Command, b, [i & 255], true));
    air.run(gapMs);
  }
  air.run(1500);
  const done = keys.map((k) => air.outcomes.get(k)).filter(Boolean);
  return {
    ok: done.filter((o) => o.ok).length,
    firstTry: done.filter((o) => o.ok && o.attempts === 1).length,
    frames: air.log.length - log0,
  };
}

test("in a house of seven rooms, the routed commands are answered as often as the flooded ones, more of them at the first attempt, with fewer frames", async () => {
  const out = {};
  for (const route of [false, true]) {
    const air = await grid(7, { routeUnicast: route, loss: 0.05 });
    air.run(60000);
    out[route ? "routed" : "flooded"] = commands(air, 120, 300);
  }
  const { routed, flooded } = out;
  assert.ok(routed.ok >= flooded.ok - 2, `answered: routed ${routed.ok}, flooded ${flooded.ok} of 120`);
  assert.ok(routed.firstTry >= flooded.firstTry, `at the first attempt: routed ${routed.firstTry}, flooded ${flooded.firstTry}`);
  assert.ok(routed.frames < flooded.frames, `frames: routed ${routed.frames}, flooded ${flooded.frames}`);
  console.log(`# seven rooms, 120 commands, 5% loss: flooded ${JSON.stringify(flooded)}, routed ${JSON.stringify(routed)}`);
});

test("a neighbour whose radio link went is no way within the heard window, though the probes through the others keep it alive (the adversarial review of 2026-10-18)", async () => {
  const air = await links([1, 2, 3], [[1, 2], [1, 3], [2, 3]]);
  air.run(40000);
  assert.deepEqual(air.core.nextHop(air.node(1).slot, 2, air.localMs(air.node(1))), [2, 1], "a neighbour heard: itself");
  air.unlink(1, 2);
  air.run(20000);
  const n2 = air.core.neighbors(air.node(1).slot, air.localMs(air.node(1))).find((x) => x.id === 2);
  assert.ok(n2 !== undefined, "the node 2 is still a neighbour of 1");
  assert.deepEqual(air.core.nextHop(air.node(1).slot, 2, air.localMs(air.node(1))), [3, 2], "20 s after the link went, a frame for 2 goes by 3, which lists it");
  const before = air.log.length;
  const key = air.send(1, MeshType.Command, 2, [9], true);
  air.run(500);
  assert.equal(air.outcomes.get(key)?.ok, true, "answered");
  assert.equal(air.outcomes.get(key)?.attempts, 1, "on the first attempt");
  assert.deepEqual(framesOf(air, key, before).map((l) => l.to), [3, 2], "two hops, to 3 and from 3 to 2, and none from 1 to 2 directly (the probes of the supervision still try 2)");
});

test("a neighbour this node's frames do not get to is no way, whatever its heartbeats say, and is tried again a minute later", async () => {
  // 1 hears 2 strongly and 3 weakly, both hear 4; the frames of 1 get to 2 one time in five, the heartbeats of 2 get to 1 every time
  const air = await links([1, 2, 3, 4], [[1, 2, -45], [1, 3, -70], [2, 4], [3, 4]]);
  air.run(40000);
  const slot = air.node(1).slot;
  const hop = () => air.core.nextHop(slot, 4, air.localMs(air.node(1)));
  assert.deepEqual(hop(), [2, 2], "a frame for 4 goes by 2, the stronger");
  air.setLinkLoss(1, 2, 0.8);
  let first = 0;
  const N = 30;
  for (let i = 0; i < N; i++) {
    const key = air.send(1, MeshType.Command, 4, [i], true);
    air.run(1000);
    if (air.outcomes.get(key)?.attempts === 1) first++;
  }
  const n2 = air.core.neighbors(slot, air.localMs(air.node(1))).find((x) => x.id === 2);
  assert.ok(n2.sendQuality < 50, `this node's frames get to 2 ${n2.sendQuality}% of the time`);
  assert.deepEqual(hop(), [3, 2], "and a frame for 4 goes by 3");
  assert.ok(first >= N - 5, `${first} of ${N} answered at the first attempt`);
  // the link heals; a minute with no frame to 2 forgets what they did, and 2 is the way again
  air.setLinkLoss(1, 2, undefined);
  air.run(65000);
  assert.deepEqual(hop(), [2, 2], "a minute later, 2 is tried again");
});

test("a neighbour whose frames all got through, forgotten after a minute, is no way after three that do not", async () => {
  const air = await links([1, 2, 3, 4], [[1, 2, -45], [1, 3, -70], [2, 4], [3, 4]]);
  air.run(40000);
  const slot = air.node(1).slot;
  const hop = () => air.core.nextHop(slot, 4, air.localMs(air.node(1)));
  const fwd = () => air.core.neighbors(slot, air.localMs(air.node(1))).find((x) => x.id === 2).sendQuality;
  for (let i = 0; i < 10; i++) {
    air.send(1, MeshType.Command, 4, [i], true);
    air.run(1000);
  }
  assert.equal(fwd(), 100, "the frames of 1 get to 2");
  // a minute with no frame to 2, and then 2 stops taking the frames of 1
  air.run(65000);
  air.setLinkLoss(1, 2, 1);
  air.send(1, MeshType.Command, 4, [99], true);
  air.run(1000);
  assert.ok(fwd() <= 100, `a percent: ${fwd()}`);
  assert.equal(fwd(), 0, "what the frames before the minute did is forgotten, and the three hops that failed say it all");
  assert.deepEqual(hop(), [3, 2], "and a frame for 4 goes by 3");
});
