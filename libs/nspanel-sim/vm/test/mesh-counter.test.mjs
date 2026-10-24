// The end of the frame counter. The number of a message is its origin, its epoch and a 32-bit counter, and it is also the nonce of the cipher: a number
// sent twice under a key would give the two frames away. A node whose counter passes kCounterRenew (0xFFFF0000) takes the next epoch and numbers from 1
// again, as a start does, once its application has kept that epoch (Config::renewEpoch); when it cannot, it goes on to 0xFFFFFFFE and then has no number to
// give, so it sends nothing until it is started again. The core is compiled from its own source (tasmota/include/espnow_mesh_core.h).
import { test } from "node:test";
import assert from "node:assert/strict";
import { MeshAir, MeshType, MESH } from "../dist/index.js";

const RENEW = 0xffff0000;
const LAST = 0xfffffffe;

/** three nodes in one room that hear each other, each knowing where the others are */
async function room(opt = {}, epochOf1 = 5) {
  const air = await MeshAir.create({ seed: 3, beatMs: 5000, ...opt });
  air.add(1, 0, 0, epochOf1);
  air.add(2, 0, 0, 5);
  air.add(3, 0, 0, 5);
  air.link(1, 2, -55);
  air.link(1, 3, -55);
  air.link(2, 3, -55);
  air.syncAll();
  return air;
}

/** every frame that node `id` put on the air itself, by the number it carries and what it carries */
function frames(air, id) {
  return air.log.filter((l) => l.from === id && l.origin === id).map((l) => {
    const f = air.core.decode(l.bytes);
    return { epoch: f.epoch, counter: f.counter, body: Buffer.from(l.bytes.slice(MESH.HEADER, l.bytes.length - MESH.TAG)).toString("hex"), kind: l.kind };
  });
}

/** no number was used for two different messages: the frames that share one carry the same bytes (a repeat, or a resend) */
function numbersUnique(list) {
  const seen = new Map();
  for (const f of list) {
    const key = `${f.epoch}:${f.counter}`;
    if (seen.has(key)) assert.equal(seen.get(key), f.body, `the number ${key} carried two different messages`);
    else seen.set(key, f.body);
  }
  return seen;
}

test("a node whose counter passes 0xFFFF0000 takes the next epoch, numbers from 1 under it, and the traffic goes on with no number used twice", async () => {
  const air = await room({ cipher: "real" });
  const slot = air.node(1).slot;
  air.core.advanceCounter(slot, 0xfffeffe0);
  assert.equal(air.core.epoch(slot), 5);
  // 40 events and a command that asks for an answer, 60 ms apart, across the end of the counter
  const keys = [];
  for (let i = 0; i < 40; i++) {
    air.core.send(slot, MeshType.Event, MESH.TO_ALL, [i, 7, 7, 7], false, air.ms);
    air.run(60);
  }
  air.run(12000);
  assert.equal(air.core.epoch(slot), 6, "the epoch is the next one, once");
  assert.equal(air.core.stat(slot, "epochRenewed"), 1);
  assert.equal(air.core.stat(slot, "counterOut"), 0, "and the node never had no number to give");
  const own = frames(air, 1);
  const epochs = [...new Set(own.map((f) => f.epoch))].sort();
  assert.deepEqual(epochs, [5, 6], "its frames carry the two epochs");
  const before = own.filter((f) => f.epoch === 5), after = own.filter((f) => f.epoch === 6);
  assert.ok(Math.max(...before.map((f) => f.counter)) < RENEW + 40, "the first epoch ended where the counter passed 0xFFFF0000");
  assert.ok(Math.max(...before.map((f) => f.counter)) >= RENEW, "after the point, not before it");
  assert.equal(Math.min(...after.map((f) => f.counter)), 1, "the next epoch numbers from 1");
  assert.ok(Math.max(...own.map((f) => f.counter)) < 0xffffffff, "no number is the last one, or beyond it");
  numbersUnique(own);
  // the counter rises by one a frame inside an epoch, and the epoch never goes back
  const order = air.log.filter((l) => l.from === 1 && l.origin === 1).map((l) => air.core.decode(l.bytes));
  let last = null;
  for (const f of order) {
    if (last !== null) assert.ok(f.epoch > last.epoch || (f.epoch === last.epoch && f.counter >= last.counter - 3), `${last.epoch}:${last.counter} then ${f.epoch}:${f.counter}`);
    last = f;
  }
  // the others learn of it as they learn of a start: they ask where it is, and take its frames again
  assert.equal(air.knows(2, 1) && air.knows(3, 1), true, "the others know it again");
  assert.ok(air.core.stat(air.node(2).slot, "syncDone") >= 1, "by a new exchange");
  // and what it sends after that gets across, sealed under the new epoch, with the answer asked for
  for (let i = 0; i < 6; i++) { keys.push(air.send(1, MeshType.Command, 2 + (i % 2), [i], true)); air.run(300); }
  const ev = air.send(1, MeshType.State, MESH.TO_ALL, [9, 9, 9]);
  air.run(1500);
  assert.deepEqual(keys.filter((k) => !air.outcomes.get(k)?.ok), [], "every command to a node that has asked it where it is, answered");
  assert.equal(air.reached(ev).size, 2, "and a flood reaches both");
  assert.equal(air.nodes.reduce((s, n) => s + air.core.stat(n.slot, "cipherBad"), 0), 0, "no frame failed to open");
});

test("with no epoch to be had, a node gives numbers up to 0xFFFFFFFE and then none: nothing is sent, and the number 0xFFFFFFFF and the wrap are never used", async () => {
  const air = await room({ declineEpoch: [1], beatMs: 0, cipher: true });
  const slot = air.node(1).slot;
  air.core.advanceCounter(slot, 0xfffffff0);
  assert.equal(air.core.epochWanted(slot), false);
  const counters = [];
  let refused = 0;
  for (let i = 0; i < 24; i++) {
    const c = air.core.send(slot, MeshType.Event, MESH.TO_ALL, [i, 5, 5, 5], false, air.ms);
    if (c === 0) refused++; else counters.push(c);
    air.run(40);
  }
  assert.equal(air.core.epochWanted(slot), true, "past the point the node asked its application for the next epoch, and was refused");
  assert.equal(air.core.epoch(slot), 5, "so the epoch is the same");
  assert.deepEqual(counters, Array.from({ length: 14 }, (_, i) => 0xfffffff1 + i), "the numbers given, to 0xFFFFFFFE");
  assert.equal(refused, 10, "and the ten after it were refused");
  assert.equal(air.core.stat(slot, "counterOut"), 10, "counted");
  const own = frames(air, 1);
  assert.equal(Math.max(...own.map((f) => f.counter)), LAST, "on the air the highest number is 0xFFFFFFFE");
  assert.equal(own.some((f) => f.counter === 0 || f.counter === 0xffffffff), false, "no frame has the number 0 or the one past the end");
  numbersUnique(own);
  // nothing else gets a number either: not an answer, not a heartbeat
  assert.equal(air.core.send(slot, MeshType.Command, 2, [1], true, air.ms), 0);
  assert.equal(air.core.sendRouted(slot, MeshType.Ack, 2, [1, 2, 3, 4, 5], air.ms), 0);
  // started again, with an epoch above, it sends, and the others take it up again
  air.restart(1);
  assert.equal(air.core.epoch(air.node(1).slot), 6);
  assert.equal(air.core.counter(air.node(1).slot), 0);
  // the first frame of the new epoch is refused by the others for want of a sync, which they then ask for
  air.send(1, MeshType.State, MESH.TO_ALL, [3, 3]);
  air.run(6000);
  const key = air.send(1, MeshType.State, MESH.TO_ALL, [4, 4]);
  air.run(2000);
  assert.equal(air.reached(key).size, 2, "after the start and the exchange the others hear it");
  assert.ok(air.core.counter(air.node(1).slot) >= 1 && air.core.counter(air.node(1).slot) < 100);
});

test("a node already at the last epoch cannot take another, and ends as one whose application refuses", async () => {
  const air = await room({ beatMs: 0 }, 0xffffffff);
  const slot = air.node(1).slot;
  assert.equal(air.core.epoch(slot), 0xffffffff);
  air.core.advanceCounter(slot, 0xfffffff8);
  const given = [];
  for (let i = 0; i < 12; i++) { const c = air.core.send(slot, MeshType.Event, MESH.TO_ALL, [i], false, air.ms); if (c !== 0) given.push(c); air.run(30); }
  assert.deepEqual(given, [0xfffffff9, 0xfffffffa, 0xfffffffb, 0xfffffffc, 0xfffffffd, 0xfffffffe]);
  assert.equal(air.core.epoch(slot), 0xffffffff, "the epoch did not wrap to 0");
  assert.equal(air.core.stat(slot, "epochRenewed"), 0);
});

test("a counter that is far from its end is not touched: numbers start at 1 and rise by one", async () => {
  const air = await room({ beatMs: 0 });
  const slot = air.node(1).slot;
  const c = [1, 2, 3].map((i) => air.core.send(slot, MeshType.Event, MESH.TO_ALL, [i], false, air.ms));
  assert.deepEqual(c, [1, 2, 3]);
  air.core.advanceCounter(slot, 2);
  assert.equal(air.core.counter(slot), 3, "the counter is never moved back");
  assert.equal(air.core.epoch(slot), 5);
  assert.equal(air.core.stat(slot, "epochRenewed"), 0);
});
