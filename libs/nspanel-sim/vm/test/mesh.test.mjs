// The ESP-NOW mesh core of the firmware (tasmota/include/espnow_mesh_core.h), compiled from its own
// source, and the nodes that run it over a simulated air: the frame, the replay window, the flood.
// What these hold are the claims of the mesh design that a host can check: how many copies a flood
// costs, how far it goes, how long a hop takes, and how much of the air a house uses.
import { test } from "node:test";
import assert from "node:assert/strict";
import nodeCrypto from "node:crypto";
import { MeshAir, MeshCore, MeshType, MeshSub, NoticeKind, BulkSub, BULK, MESH, packKind, macOf } from "../dist/index.js";

const core = await MeshCore.load();

const frame = (over = {}) => core.encode({ kind: packKind(MeshType.Command), origin: 9, dest: 1, next: 0, hops: 3, epoch: 5, counter: 1, payload: [1, 2, 3], ...over }, true);

// --- the frame ---------------------------------------------------------------------------------

test("a frame is 14 bytes of header, the payload and 8 of tag, and comes back as it went", () => {
  const bytes = frame({ kind: packKind(MeshType.Event, true, 2, 3), origin: 7, dest: 255, next: 4, hops: 2, epoch: 0xdeadbeef, counter: 0x01020304, payload: [9, 8, 7, 6] });
  assert.equal(bytes.length, MESH.HEADER + 4 + MESH.TAG);
  assert.equal(bytes[0], MESH.VERSION);
  const f = core.decode(bytes);
  assert.deepEqual(f, { kind: packKind(MeshType.Event, true, 2, 3), origin: 7, dest: 255, next: 4, hops: 2, epoch: 0xdeadbeef, counter: 0x01020304, len: 4 });
  assert.equal(f.kind >> 5, MeshType.Event, "the type");
  assert.equal(!!(f.kind & 0x10), true, "the ack request");
  assert.equal((f.kind >> 2) & 3, 2, "the part");
  assert.equal(f.kind & 3, 3, "the attempt");
});

test("228 bytes go in a frame and 229 do not; what is not ours, or not whole, is not a frame", () => {
  assert.equal(frame({ payload: new Array(MESH.MAX_PAYLOAD).fill(1) }).length, MESH.MAX_FRAME);
  assert.equal(frame({ payload: new Array(MESH.MAX_PAYLOAD + 1).fill(1) }), null);
  const ok = frame();
  assert.equal(core.decode(ok.slice(0, MESH.HEADER + MESH.TAG - 1)), null, "shorter than a frame with no payload");
  const other = Uint8Array.from(ok);
  other[0] = 0x10;                             // a type of the direct link
  assert.equal(core.decode(other), null, "the direct link's frames are not the mesh's");
  assert.equal(core.decode(new Uint8Array(MESH.MAX_FRAME + 1).fill(MESH.VERSION)), null, "longer than ESP-NOW carries");
});

test("the tag holds from the origin to the destination: next and hops change at every hop and are not in it, the rest is", () => {
  const f = frame();
  assert.equal(core.tagMatches(f), true);
  const hop = (i, v) => { const b = Uint8Array.from(f); b[i] = v; return b; };
  assert.equal(core.tagMatches(hop(4, 7)), true, "a different next hop");
  assert.equal(core.tagMatches(hop(5, 0)), true, "fewer hops left");
  for (const [i, what] of [[1, "kind"], [2, "origin"], [3, "dest"], [6, "epoch"], [10, "counter"], [14, "payload"], [f.length - 1, "tag"]]) {
    assert.equal(core.tagMatches(hop(i, f[i] ^ 1)), false, `a changed ${what} is caught`);
  }
});

// --- a node on its own: the replay window --------------------------------------------------------

const node = (opt = {}) => {
  core.begin(0, 1, { epoch: 3, seed: 99, ...opt });
  return {
    hear: (bytes, rssi = -60, from = 9) => core.receive(0, bytes, macOf(from), rssi, 0),
    sync: (origin = 9, epoch = 5, counter = 0) => core.synced(0, origin, epoch, counter),
  };
};

test("nothing from an origin is accepted until the node knows where it is, and the origin is asked for", () => {
  const n = node();
  assert.equal(n.hear(frame()), "needsSync");
  assert.equal(core.wantsSync(0), 9);
  assert.equal(core.pop(0), null, "nothing was delivered");
  n.sync();
  assert.equal(core.wantsSync(0), 0);
  assert.equal(n.hear(frame({ counter: 1 })), "accepted");
  assert.equal(core.pop(0).origin, 9);
});

test("a counter seen is refused, one behind the window is stale, and one out of order inside it is taken once", () => {
  const n = node();
  n.sync();
  for (const c of [1, 2, 3, 10]) assert.equal(n.hear(frame({ counter: c })), "accepted", `counter ${c}`);
  assert.equal(n.hear(frame({ counter: 7 })), "accepted", "out of order, inside the window, never seen");
  assert.equal(n.hear(frame({ counter: 7 })), "repeated", "and the second time a copy");
  for (let c = 11; c <= 100; c++) { n.hear(frame({ counter: c })); core.pop(0); }   // the application takes what it is given: a full inbox takes nothing more
  assert.equal(n.hear(frame({ counter: 20 })), "stale", "80 behind the highest, outside the window of 32 and out of the copies the node remembers");
  assert.equal(n.hear(frame({ counter: 69 })), "repeated", "31 behind is inside the window, and was seen");
});

test("a number heard again after the node forgot the copy is a replay, from the window and not from the copies", () => {
  const n = node();
  n.sync();
  n.sync(10, 5, 0);
  for (let c = 1; c <= 5; c++) assert.equal(n.hear(frame({ counter: c })), "accepted");
  core.pop(0); core.pop(0); core.pop(0); core.pop(0); core.pop(0);
  // seventy frames of another origin push the copies of this one out of the node's memory
  for (let c = 1; c <= 70; c++) { assert.equal(n.hear(frame({ origin: 10, counter: c }), -60, 10), "accepted"); core.pop(0); }
  assert.equal(n.hear(frame({ counter: 3 })), "replayed");
  core.pop(0);
});

test("an epoch below the kept one is refused, and one above makes the origin unsynchronised until it is told again", () => {
  const n = node();
  n.sync();
  assert.equal(n.hear(frame({ counter: 1 })), "accepted");
  assert.equal(n.hear(frame({ epoch: 4, counter: 50 })), "stale", "an older start of the origin");
  assert.equal(n.hear(frame({ epoch: 6, counter: 1 })), "needsSync", "a start the node did not see: the moment a recording could be played back");
  assert.equal(core.wantsSync(0), 9);
  assert.equal(n.hear(frame({ epoch: 6, counter: 2 })), "needsSync", "and still, until it is told");
  n.sync(9, 6, 1);
  assert.equal(n.hear(frame({ epoch: 6, counter: 2 })), "accepted");
});

test("a retransmission passes: the same number with a higher attempt is repeated and delivered as one, once more", () => {
  const n = node();
  n.sync();
  assert.equal(n.hear(frame({ kind: packKind(MeshType.Command, true, 0, 0), counter: 20, dest: 1 })), "accepted");
  assert.equal(core.pop(0).retry, false);
  assert.equal(n.hear(frame({ kind: packKind(MeshType.Command, true, 0, 1), counter: 20, dest: 1 })), "retry");
  const d = core.pop(0);
  assert.deepEqual([d.retry, d.attempt, d.ackRequested], [true, 1, true], "so that the destination answers it again");
  assert.equal(n.hear(frame({ kind: packKind(MeshType.Command, true, 0, 1), counter: 20, dest: 1 })), "repeated", "and that attempt a second time is a copy");
});

test("an attempt that comes first, the original lost, is taken as the original", () => {
  const n = node();
  n.sync();
  assert.equal(n.hear(frame({ kind: packKind(MeshType.Command, true, 0, 2), counter: 30, dest: 1 })), "accepted");
  assert.equal(core.pop(0).retry, false, "nothing of that number was delivered before: it is to be executed");
});

test("a frame with a wrong tag is refused, and a frame of its own is not heard", () => {
  const n = node();
  n.sync();
  const f = Uint8Array.from(frame({ counter: 1 }));
  f[f.length - 1] ^= 0xff;
  assert.equal(n.hear(f), "bad");
  assert.equal(n.hear(frame({ origin: 1, counter: 1 })), "ignored", "this node's own number");
});

test("what waits to be sent goes out by priority, one frame at a time, until the radio says it is done", () => {
  node();
  const out = (now = 0) => core.nextTx(0, now)?.bytes ?? null;
  const state = core.send(0, MeshType.State, 255, [1], false, 0);
  const command = core.send(0, MeshType.Command, 255, [2], false, 0);
  const event = core.send(0, MeshType.Event, 255, [3], false, 0);
  assert.ok(state && command && event);
  const kinds = [];
  for (let i = 0; i < 3; i++) {
    const b = out();
    kinds.push(core.decode(b).kind >> 5);
    assert.equal(out(), null, "nothing more until the radio is free");
    core.txDone(0, true, 0);
  }
  assert.deepEqual(kinds, [MeshType.Event, MeshType.Command, MeshType.State], "the alarm's events, then commands, then state");
});

// --- the flood ---------------------------------------------------------------------------------

const cluster = async (n, opt = {}) => {
  const air = await MeshAir.create({ seed: 7, ...opt });
  for (let i = 1; i <= n; i++) air.add(i, 0, 0, 5);
  for (let a = 1; a <= n; a++) for (let b = a + 1; b <= n; b++) air.link(a, b, -55);
  air.syncAll();
  return air;
};

test("in a room where everyone hears everyone, a flood reaches all and costs two frames, not fourteen", async () => {
  const air = await cluster(14);
  const key = air.send(1, MeshType.State, 255, [1, 2, 3]);
  air.settle();
  const reached = air.reached(key);
  assert.equal(reached.size, 13, "every other node");
  assert.ok(air.copies(key) <= 3, `${air.copies(key)} frames on the air`);
  for (const us of reached.values()) assert.ok(us < 5000, `${us} us`);
});

test("without the suppression the same flood is a frame from every node", async () => {
  const air = await cluster(14, { suppressAt: 255 });
  const key = air.send(1, MeshType.State, 255, [1, 2, 3]);
  air.settle();
  assert.equal(air.reached(key).size, 13);
  assert.equal(air.copies(key), 14, "the origin and the thirteen that repeated it");
});

test("a flood goes the origin and five repetitions, six hops of radio: along a line it stops where the hops do, a hop in 3 to 11 ms", async () => {
  const hops = MESH.MAX_HOPS;
  assert.equal(hops, 5, "the node leaves with five repeats");
  const air = await MeshAir.create({ seed: 7 });
  for (let i = 1; i <= hops + 4; i++) air.add(i, i * 10, 0, 5);
  for (let a = 1; a < hops + 4; a++) air.link(a, a + 1, -60);
  air.syncAll();
  const key = air.send(1, MeshType.Command, 255, [9]);
  air.settle();
  const reached = air.reached(key);
  const near = Array.from({ length: hops + 1 }, (_, i) => i + 2);
  assert.deepEqual([...reached.keys()].sort(), near, "six hops from the origin, and the nodes beyond are not reached");
  assert.deepEqual(air.log.map((l) => [l.from, l.hops]), near.map((n, i) => [i + 1, hops - i]), "the hops left, and the last one is not repeated");
  const at = near.map((i) => reached.get(i));
  for (let i = 1; i < at.length; i++) {
    const hop = (at[i] - at[i - 1]) / 1000;
    assert.ok(hop >= 3 && hop <= 11, `hop ${i + 1}: ${hop} ms`);
  }
});

test("a frame heard from far off is repeated first: a weak one in 0 to 3 ms, a strong one in 3 to 8", async () => {
  for (const [rssi, lo, hi] of [[-80, 0, 3], [-50, 3, 8]]) {
    const air = await MeshAir.create({ seed: 11 });
    air.add(1, 0, 0, 5); air.add(2, 0, 0, 5); air.add(3, 0, 0, 5);
    air.link(1, 2, rssi); air.link(1, 3, rssi);   // 2 and 3 hear 1, and not each other
    air.syncAll();
    air.send(1, MeshType.Command, 255, [1]);
    air.settle();
    const first = air.log[0];
    const repeats = air.log.filter((l) => l.from !== 1);
    assert.equal(repeats.length, 2, "neither hears the other: both repeat");
    for (const r of repeats) {
      const wait = (r.at - (first.at + 1000 + 7.2 * first.len)) / 1000;
      assert.ok(wait >= lo - 0.2 && wait <= hi + 0.2, `at ${rssi} dBm: waited ${wait} ms`);
    }
  }
});

test("a node that sends sends one frame at a time: the air never carries two of one node's at once", async () => {
  const air = await cluster(4);
  for (let i = 0; i < 6; i++) air.send(1, MeshType.State, 255, [i]);
  air.settle();
  const own = air.log.filter((l) => l.from === 1).map((l) => l.at);
  for (let i = 1; i < own.length; i++) assert.ok(own[i] - own[i - 1] >= 1000, "a frame at least as long as the air takes");
  assert.equal(own.length >= 6, true);
});

// the house of the design: seven rooms in a row, a bridge and a panel in each, a wall between rooms
const house = async (opt = {}) => {
  const air = await MeshAir.create({ seed: 21, ...opt });
  for (let room = 0; room < 7; room++) {
    air.add(2 * room + 1, room * 6, 0, 5);          // the bridge
    air.add(2 * room + 2, room * 6 + 1.5, 1, 5);    // the panel
  }
  const roomOf = (n) => Math.floor((n.id - 1) / 2);
  air.geometry(2.2, (a, b) => 8 * Math.abs(roomOf(a) - roomOf(b)));
  air.syncAll();
  return air;
};

test("in a house of seven rooms in a row, a command crosses from one end to the other, within the hops of a flood", async () => {
  const air = await house();
  const key = air.send(1, MeshType.Command, 255, [1, 2, 3, 4, 5, 6, 7, 8]);
  air.settle();
  const reached = air.reached(key);
  assert.equal(reached.size, 13, `every node of the house; the copies on the air: ${air.copies(key)}`);
  assert.ok(air.copies(key) < 14, "fewer frames than nodes");
});

test("with losses and frames that collide, a house still delivers almost every flood to every node", async () => {
  const air = await house({ loss: 0.1 });
  let want = 0;
  let got = 0;
  let copies = 0;
  const keys = [];
  for (let i = 0; i < 60; i++) {
    const origin = 1 + ((i * 5) % 14);
    keys.push(air.send(origin, i % 3 === 0 ? MeshType.State : MeshType.Command, 255, new Array(20).fill(i)));
    air.run(250);
  }
  air.settle();
  for (const k of keys) { want += 13; got += air.reached(k).size; copies += air.copies(k); }
  assert.ok(got / want >= 0.97, `delivered ${(100 * got / want).toFixed(1)}% of ${want}`);
  assert.ok(copies / keys.length < 14, `${(copies / keys.length).toFixed(1)} frames on the air per flood`);
});

test("a busy evening in the house takes under 3% of the air: heartbeats, a command every 10 s, state at 0.2 per second", async () => {
  const air = await house({ beatMs: 5000 });
  const secs = 60;
  for (let s = 0; s < secs; s++) {
    if (s % 10 === 0) air.send(1 + (s % 14), MeshType.Command, 255, new Array(24).fill(s));
    if (s % 5 === 0) air.send(1 + ((s * 3) % 14), MeshType.State, 255, new Array(30).fill(s));
    air.run(1000);
  }
  air.settle();
  const beats = air.log.filter((l) => l.kind >> 5 === MeshType.Beat).length;
  const busy = [...air.airUs.values()].reduce((a, b) => a + b, 0) / (secs * 1e6);
  assert.ok(beats >= secs * 14 / 5.5 - 14, `${beats} heartbeats`);
  assert.ok(busy < 0.03, `${(100 * busy).toFixed(2)}% of the air`);
});

// --- the answer: acknowledgement, the way back, the resend, and the sync -------------------------

const line = async (n, opt = {}) => {
  const air = await MeshAir.create({ seed: 5, ...opt });
  for (let i = 1; i <= n; i++) air.add(i, i * 10, 0, 5);
  for (let a = 1; a < n; a++) air.link(a, a + 1, -60);
  return air;
};
const isAck = (l) => l.kind >> 5 === MeshType.Ack;

test("a command that asks for an answer is confirmed in a few milliseconds, and the answer goes back one hop at a time, never flooded", async () => {
  const air = await house();
  air.syncAll();
  const key = air.send(1, MeshType.Command, 14, [1, 2, 3], true);
  air.settle();
  const o = air.outcomes.get(key);
  assert.deepEqual([o.ok, o.attempts], [true, 1]);
  assert.ok((o.at - air.sentAt.get(key)) / 1000 < 20, `${(o.at - air.sentAt.get(key)) / 1000} ms`);
  const acks = air.log.filter(isAck);
  assert.ok(acks.length >= 1 && acks.length <= 4, `${acks.length} frames of answer`);
  assert.ok(acks.every((l) => l.to !== 255), "each to the address of the next hop, none to everyone");
  assert.equal(air.deliveriesOf(key, 14), 1, "executed once, by the destination only");
  assert.equal(air.deliveries.filter((d) => d.d.type === MeshType.Ack).length, 0, "the answer is for the core, not for the application");
});

test("when the first attempt is lost the sender sends the same number again, 100 ms later with the attempt one higher, and it is delivered as the first", async () => {
  const air = await house();
  air.syncAll();
  air.opt.loss = 1;
  const key = air.send(1, MeshType.Command, 14, [7], true);
  air.run(60);
  air.opt.loss = 0;
  air.settle();
  const o = air.outcomes.get(key);
  assert.deepEqual([o.ok, o.attempts], [true, 2]);
  const sent = air.log.filter((l) => l.origin === 1 && l.counter === 1 && l.from === 1).map((l) => [l.at / 1000, l.kind & 3]);
  assert.equal(sent.length, 2);
  assert.ok(sent[1][0] - sent[0][0] >= 100 && sent[1][0] - sent[0][0] < 110, `${sent[1][0] - sent[0][0]} ms between the attempts`);
  assert.deepEqual([sent[0][1], sent[1][1]], [0, 1]);
  const d = air.deliveries.filter((x) => x.node === 14);
  assert.deepEqual(d.map((x) => [x.d.attempt, x.d.retry]), [[1, false]], "nothing of the number had been delivered: the attempt is to be executed");
});

test("when the answer is what is lost, the destination answers every attempt and the application is told which are repeats", async () => {
  const air = await line(3);
  air.syncAll();
  air.setLinkLoss(3, 2, 1);                    // 3 hears 2 and is heard, but what 3 sends to 2 never gets there
  const key = air.send(1, MeshType.Command, 3, [7], true);
  air.run(150);
  air.setLinkLoss(3, 2, undefined);
  air.settle();
  const o = air.outcomes.get(key);
  assert.equal(o.ok, true);
  assert.equal(o.attempts, 3, "the answer came for the last attempt");
  const d = air.deliveries.filter((x) => x.node === 3).map((x) => x.d);
  assert.deepEqual(d.map((x) => [x.attempt, x.retry]), [[0, false], [1, true], [2, true]], "executed once, the first; the others say they are repeats");
});

test("a command that nobody answers is sent three times and then reported, never dropped without a word", async () => {
  const air = await MeshAir.create({ seed: 3 });
  for (let i = 1; i <= 3; i++) air.add(i, 0, 0, 5);
  air.link(1, 2, -60);                         // 3 hears no one
  air.syncAll();
  const key = air.send(1, MeshType.Command, 3, [1], true);
  air.settle();
  const o = air.outcomes.get(key);
  assert.deepEqual([o.ok, o.attempts], [false, 3]);
  assert.ok(Math.abs((o.at - air.sentAt.get(key)) / 1000 - 300) <= 5, `reported at ${(o.at - air.sentAt.get(key)) / 1000} ms`);
  assert.equal(air.core.stat(air.node(1).slot, "gaveUp"), 1);
  assert.deepEqual(air.log.filter((l) => l.from === 1).map((l) => l.kind & 3), [0, 1, 2], "the three attempts");
});

test("with 30% of the receptions lost and frames that collide, every command to another room ends confirmed or reported, and is executed once", async () => {
  const air = await house({ loss: 0.3 });
  air.syncAll();
  const keys = [];
  for (let i = 0; i < 80; i++) {
    const from = 1 + ((i * 5) % 14);
    let to = 1 + ((i * 11 + 3) % 14);
    if (to === from) to = 1 + (to % 14);
    keys.push([air.send(from, MeshType.Command, to, [i], true), to]);
    air.run(120);
  }
  air.settle(3000);
  let ok = 0;
  for (const [k, to] of keys) {
    const o = air.outcomes.get(k);
    assert.ok(o, `${k} ended with no word`);
    if (o.ok) {
      ok++;
      assert.ok((o.at - air.sentAt.get(k)) / 1000 <= 320, `${k} took ${(o.at - air.sentAt.get(k)) / 1000} ms`);
      assert.ok(air.deliveriesOf(k, to) >= 1, "confirmed means delivered");
    }
    const first = air.deliveries.filter((x) => x.node === to && `${x.d.origin}:${x.d.epoch}:${x.d.counter}` === k && !x.d.retry).length;
    assert.ok(first <= 1, `${k} was to be executed ${first} times`);
  }
  assert.ok(ok / keys.length >= 0.97, `${ok} of ${keys.length} confirmed`);
});

test("a routed frame goes along the way a frame of its destination came, one unicast hop at a time, and nobody else carries it", async () => {
  const air = await line(5);
  air.syncAll();
  assert.equal(air.sendRouted(1, MeshType.Command, 5, [9]), null, "no frame of 5 has come yet: no way to it");
  air.send(5, MeshType.State, 255, [1]);       // 5 floods, and along the line each node keeps who it heard it from
  air.settle();
  const reached = air.deliveries.filter((d) => d.d.origin === 5).map((d) => d.node).sort();
  assert.deepEqual(reached, [1, 2, 3, 4], "the flood reached every node of the line: four hops, within the six it has");
  const mark = air.log.length;
  const key = air.sendRouted(1, MeshType.Command, 5, [9]);
  assert.ok(key, "node 1 has a way to 5 now");
  air.settle();
  assert.deepEqual(air.log.slice(mark).map((l) => [l.from, l.to, l.hops]), [[1, 2, MESH.MAX_HOPS], [2, 3, MESH.MAX_HOPS - 1], [3, 4, MESH.MAX_HOPS - 2], [4, 5, MESH.MAX_HOPS - 3]], "a unicast to each next hop, the hops left going down");
  assert.equal(air.deliveriesOf(key, 5), 1);
});

test("a hop the radio cannot deliver is handed to it again, three times, and counted when it gives up", async () => {
  const air = await line(3);
  air.syncAll();
  air.send(3, MeshType.State, 255, [1]);
  air.settle();
  air.setLinkLoss(1, 2, 1);
  const key = air.sendRouted(1, MeshType.Command, 3, [9]);
  assert.ok(key);
  air.settle();
  assert.equal(air.core.stat(air.node(1).slot, "hopFailed"), 1);
  assert.equal(air.log.filter((l) => l.from === 1 && l.to === 2 && l.kind >> 5 === MeshType.Command).length, 3, "the three tries");
  assert.equal(air.deliveriesOf(key, 3), 0);
});

const pairsKnown = (air) => {
  let k = 0;
  for (const a of air.nodes) for (const b of air.nodes) if (a !== b && air.knows(a.id, b.id)) k++;
  return k;
};

// What this holds is the exchange, from a house whose nodes already know each other (house() syncs them all first): the ask of every node of
// every other, all at once, and the first command between the pairs that did not get through. The start of a house from nothing is in
// mesh-scale.test.mjs, with no sync of the nodes beforehand.
test("every node of a house that knows itself asking every other where it is, all at once, ends with nearly all the pairs, and the rest on the first command between them", async () => {
  const air = await house({ seed: 5 });
  air.handshake(0);
  air.run(4000);
  const total = 14 * 13;
  assert.ok(pairsKnown(air) >= 0.9 * total, `${pairsKnown(air)} of ${total} pairs known`);
  assert.equal(air.deliveries.length, 0, "nothing was delivered to an application: it was all the exchange");
  // a command between nodes that never heard each other: the first attempt finds the destination unsynchronised, which asks,
  // and the resend gets through
  for (const a of air.nodes) {
    for (const b of air.nodes) {
      if (a === b || air.knows(b.id, a.id)) continue;
      const key = air.send(a.id, MeshType.Command, b.id, [1], true);
      air.settle();
      const o = air.outcomes.get(key);
      assert.ok(o && o.ok, `${a.id} to ${b.id}: ${JSON.stringify(o)}`);
    }
  }
});

test("a node that restarts is asked in its turn by the others before its first data frame, so the frame is not lost", async () => {
  const air = await house();
  air.syncAll();
  const before = air.log.length;
  air.restart(7);
  air.boot(7);
  // the thirteen others ask it at once, and it answers at most 8 a second: they all know it in about three seconds, not in one
  air.run(4000);
  const key = air.send(7, MeshType.State, 255, [10]);
  air.settle();
  assert.equal(air.reached(key).size, 13, "every other node");
  assert.ok(air.log.length - before < 200, `${air.log.length - before} frames for a node to start and be known to the house`);
});

test("a frame recorded before a restart is refused after it", async () => {
  const air = await house();
  air.syncAll();
  air.send(7, MeshType.Command, 255, [1, 2, 3]);
  air.settle();
  const recorded = air.log.find((l) => l.from === 7 && l.counter === 1).bytes;
  air.restart(7);
  air.boot(7);
  air.run(1500);
  assert.equal(core.decode(recorded).epoch, 5);
  const replay = () => air.nodes.filter((n) => n.id !== 7).map((n) => air.core.receive(n.slot, recorded, macOf(7), -60, air.ms));
  assert.ok(replay().every((v) => v === "repeated"), "while the nodes remember the copy, it is a copy");
  // after seventy other frames they have forgotten it, and the epoch is what refuses it
  for (let i = 0; i < 70; i++) { air.send(2, MeshType.State, 255, [i]); air.run(30); }
  air.settle();
  assert.deepEqual(new Set(replay()), new Set(["stale"]));
});

// the proof of the sync answer, as the module computes it: FNV-1a over the key, the pair and the three numbers
const fnv = (h, bytes) => { for (const b of bytes) { h ^= BigInt(b); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; } return h; };
const le32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
const proof = (a, b, nonce, epoch, counter) => {
  let h = fnv(0xcbf29ce484222325n, [0x5a, 0xc3, 0x96, 0x1f]);
  h = fnv(h, [Math.min(a, b), Math.max(a, b)]);
  h = fnv(h, [...le32(nonce), ...le32(epoch), ...le32(counter)]);
  return Array.from({ length: 8 }, (_, i) => Number((h >> BigInt(8 * i)) & 255n));
};

test("a sync answer counts only with the nonce of the exchange this node started and the proof of the pair", async () => {
  const air = await MeshAir.create({ seed: 9 });
  air.add(1, 0, 0, 5);
  air.add(2, 0, 0, 5);                         // 9 is not in the air: its answers are made up here
  air.link(1, 2, -60);
  air.boot(1);
  air.run(40);
  const ask = air.log.find((l) => l.from === 1 && l.kind >> 5 === MeshType.Sync);
  const nonce = new DataView(ask.bytes.buffer, ask.bytes.byteOffset).getUint32(MESH.HEADER + 1, true);
  const slot = air.node(1).slot;
  const answer = (n, counter, p) => core.encode({
    kind: packKind(MeshType.Sync), origin: 9, dest: 1, next: 1, hops: 3, epoch: 5, counter,
    payload: [2, ...le32(n), ...le32(5), ...le32(40), ...p],
  }, true);
  const before = air.core.stat(slot, "syncDone");
  air.core.receive(slot, answer(nonce + 1, 101, proof(9, 1, nonce + 1, 5, 40)), macOf(9), -60, air.ms);
  assert.equal(air.core.stat(slot, "syncDone"), before, "another nonce is no answer of this node's");
  air.core.receive(slot, answer(nonce, 102, proof(9, 3, nonce, 5, 40)), macOf(9), -60, air.ms);
  assert.equal(air.core.stat(slot, "syncBad"), 1, "the nonce is right, the proof is not the pair's");
  air.core.receive(slot, answer(nonce, 103, proof(9, 1, nonce, 5, 40)), macOf(9), -60, air.ms);
  assert.equal(air.knows(1, 9), true, "with both, it counts");
});

// --- the supervision: the heartbeat, the neighbourhood, a node that goes quiet, the noise ---------

const isBeatFrame = (l) => l.kind >> 5 === MeshType.Beat;
const subOf = (l) => l.bytes[MESH.HEADER];
const heartbeats = (air) => air.log.filter((l) => isBeatFrame(l) && subOf(l) === MeshSub.Beat);
const verdictFrames = (air) => air.log.filter((l) => isBeatFrame(l) && subOf(l) === MeshSub.Verdict);
const seconds = (us) => us / 1e6;

test("every node sends a heartbeat every 5 s, in broadcast, and nobody repeats it", async () => {
  const air = await house({ beatMs: 5000 });
  air.run(30000);
  const beats = heartbeats(air);
  for (const n of air.nodes) {
    const own = beats.filter((l) => l.origin === n.id);
    assert.ok(own.length >= 5 && own.length <= 7, `node ${n.id} sent ${own.length}`);
    assert.ok(own.every((l) => l.from === n.id && l.to === 255 && l.hops === 0), "to everyone, with no hops left");
  }
  assert.equal(new Set(beats.map((l) => `${l.origin}:${l.counter}`)).size, beats.length, "each heartbeat is on the air once");
  assert.ok(beats.every((l) => l.len <= 80), "a heartbeat is a short frame: " + Math.max(...beats.map((l) => l.len)) + " bytes at most");
});

test("from the heartbeats a node knows who it hears, who hears it back, and who they hear", async () => {
  const air = await house({ beatMs: 5000 });
  air.run(20000);
  assert.deepEqual(air.neighbors(1).map((n) => n.id).sort((a, b) => a - b), [2, 3, 4, 5, 6], "the rooms its signal reaches");
  const three = air.neighbor(1, 3);
  assert.equal(three.listsMe, 1, "node 3 says it hears node 1");
  assert.ok(three.hears.includes(1) && three.hears.includes(2) && !three.hears.includes(14), "and what else it hears, which is how a node sees two hops");
  assert.ok(three.rssi < 0 && three.theirRssi < 0 && Math.abs(three.rssi - three.theirRssi) <= 3, `heard at ${three.rssi}, hears at ${three.theirRssi}`);
  assert.equal(three.state, "alive");
});

test("the application's own bytes ride in the heartbeat, and a neighbour has the last it heard", async () => {
  const air = await house({ beatMs: 5000 });
  air.core.setInfo(air.node(3).slot, [7, 8, 9]);
  air.run(12000);
  assert.deepEqual([...air.neighbor(1, 3).info], [7, 8, 9]);
  air.core.setInfo(air.node(3).slot, [1]);
  air.run(12000);
  assert.deepEqual([...air.neighbor(1, 3).info], [1]);
  assert.equal(air.core.send(air.node(1).slot, MeshType.Beat, 255, [0], false, 0), 0, "the heartbeat type is not the application's to send");
});

test("a node that goes off is suspected after 15 s without a heartbeat, tried by a ping and two neighbours, and said to be silent to the house 10 s later", async () => {
  const air = await house({ beatMs: 5000 });
  air.run(20000);
  air.power(3, false);
  const t0 = air.t;
  air.run(45000);
  const others = air.nodes.filter((n) => n.id !== 3);
  const told = others.map((n) => {
    const got = air.noticesOf(n.id, NoticeKind.Silent, 3);
    assert.ok(got.length >= 1, `node ${n.id} was never told`);
    return seconds(got[0].at - t0);
  });
  assert.ok(Math.min(...told) >= 19 && Math.max(...told) <= 28, `told between ${Math.min(...told).toFixed(1)} and ${Math.max(...told).toFixed(1)} s after`);
  for (const n of others) assert.equal(air.core.isSilent(n.slot, 3), true, `node ${n.id}`);
  for (const n of others) for (const m of others) assert.equal(air.core.isSilent(n.slot, m.id), false, "nobody else was condemned");
  const declared = new Set(verdictFrames(air).filter((l) => l.bytes[MESH.HEADER + 2] === 1).map((l) => l.origin));
  assert.ok(declared.size >= 1 && declared.size <= 3, `${declared.size} nodes declared it: the others, still trying, took the verdict`);
  const sum = (stat) => others.reduce((a, n) => a + air.core.stat(n.slot, stat), 0);
  assert.ok(sum("pings") >= 3 && sum("probes") >= 3, `${sum("pings")} pings, ${sum("probes")} probes`);
  assert.equal(sum("rescued"), 0, "nobody answered for it");
});

test("a node declared silent that comes back is said to be back by the one that declared it, and the house forgets it was silent", async () => {
  const air = await house({ beatMs: 5000 });
  air.run(20000);
  air.power(3, false);
  air.run(35000);
  assert.ok(air.nodes.filter((n) => n.id !== 3).every((n) => air.core.isSilent(n.slot, 3)));
  air.restart(3);
  air.boot(3);
  const t1 = air.t;
  air.run(20000);
  for (const n of air.nodes.filter((x) => x.id !== 3)) {
    assert.equal(air.core.isSilent(n.slot, 3), false, `node ${n.id} still thinks 3 is silent`);
    assert.ok(air.noticesOf(n.id, NoticeKind.Back, 3).some((x) => x.at > t1), `node ${n.id} was not told`);
  }
});

test("a neighbour that cannot be heard but is reached through another is not given up: it is tried through the others and stays", async () => {
  const air = await MeshAir.create({ seed: 4, beatMs: 5000 });
  for (let i = 1; i <= 3; i++) air.add(i, 0, 0, 5);
  air.link(1, 2, -55); air.link(1, 3, -55); air.link(2, 3, -55);
  air.syncAll();
  air.run(15000);
  assert.equal(air.neighbors(1).length, 2);
  air.setLinkLoss(1, 2, 1);
  air.setLinkLoss(2, 1, 1);                    // 1 and 2 no longer reach each other; 3 reaches them both
  air.run(60000);
  const one = air.node(1).slot;
  assert.equal(air.noticesOf(1, NoticeKind.Silent).length, 0, "node 1 never gave 2 up");
  assert.equal(air.core.isSilent(one, 2), false);
  assert.ok(air.core.stat(one, "probes") >= 2 && air.core.stat(one, "rescued") >= 2, `${air.core.stat(one, "probes")} probes, ${air.core.stat(one, "rescued")} rescued`);
  assert.equal(air.verdicts.length > 0 && verdictFrames(air).length, 0, "and no verdict went on the air");
});

test("a neighbour heard now and then that does not hear this node is not pinged in vain: it is tried through the others at once, and stays", async () => {
  const air = await MeshAir.create({ seed: 4, beatMs: 5000 });
  for (let i = 1; i <= 3; i++) air.add(i, 0, 0, 5);
  air.link(1, 2, -55); air.link(2, 3, -55); air.link(1, 3, -80);
  air.setLinkLoss(1, 3, 1);                    // 3 never hears 1
  air.setLinkLoss(3, 1, 0.85);                 // and 1 hears 3 now and then
  air.syncAll();
  air.run(120000);
  const one = air.node(1).slot;
  assert.equal(air.core.neighbors(one, air.localMs(air.node(1))).find((x) => x.id === 3)?.listsMe, 2, "node 1 knows that 3 does not hear it");
  const before = { pings: air.core.stat(one, "pings"), hopFailed: air.core.stat(one, "hopFailed"), probes: air.core.stat(one, "probes") };
  air.run(180000);
  assert.equal(air.core.stat(one, "pings") - before.pings, 0, "node 1 pings nobody");
  assert.equal(air.core.stat(one, "hopFailed") - before.hopFailed, 0, "and no unicast of its fails");
  assert.ok(air.core.stat(one, "probes") - before.probes >= 2, `node 1 asked 2 to try 3: ${air.core.stat(one, "probes") - before.probes} probes`);
  assert.equal(air.noticesOf(1, NoticeKind.Silent).length, 0, "and never gave 3 up");
});

test("a neighbour whose heartbeats are too seldom heard to say whether it hears this node is tried through the others too, not pinged", async () => {
  // 1 hears 3 one frame in twenty-five, mostly what 3 repeats for 5, and 3 never hears 1: two heartbeats of 3, which would tell, do not reach 1
  const air = await MeshAir.create({ seed: 6, beatMs: 5000 });
  for (const i of [1, 2, 3, 5]) air.add(i, 0, 0, 5);
  air.link(1, 2, -55); air.link(2, 3, -55); air.link(3, 5, -55); air.link(1, 3, -80);
  air.setLinkLoss(1, 3, 1);
  air.setLinkLoss(3, 1, 0.96);
  air.syncAll();
  const one = air.node(1).slot;
  const flood = (seconds) => { for (let j = 0; j < seconds; j++) { air.send(5, MeshType.Event, 255, [j], false); air.run(1000); } };
  flood(30);
  const before = { pings: air.core.stat(one, "pings"), hopFailed: air.core.stat(one, "hopFailed"), probes: air.core.stat(one, "probes") };
  flood(270);
  assert.equal(air.core.neighbors(one, air.localMs(air.node(1))).find((x) => x.id === 3)?.listsMe, 0, "node 1 has not been told whether 3 hears it");
  assert.equal(air.core.stat(one, "pings") - before.pings, 0, "node 1 pings nobody");
  assert.equal(air.core.stat(one, "hopFailed") - before.hopFailed, 0, "and no unicast of its fails");
  assert.ok(air.core.stat(one, "probes") - before.probes >= 5, `node 1 asked 2 to try 3: ${air.core.stat(one, "probes") - before.probes} probes`);
  assert.equal(air.noticesOf(1, NoticeKind.Silent).length, 0, "and never gave 3 up");
});

test("a node told that it is silent says that it is not", async () => {
  const air = await house({ beatMs: 5000 });
  air.run(10000);
  const slot = air.node(3).slot;
  const lie = core.encode({ kind: packKind(MeshType.Beat), origin: 5, dest: 255, next: 0, hops: 3, epoch: 5, counter: 9999, payload: [MeshSub.Verdict, 3, 1] }, true);
  air.core.receive(slot, lie, macOf(5), -60, air.ms);
  air.run(2000);
  const back = verdictFrames(air).filter((l) => l.origin === 3 && l.bytes[MESH.HEADER + 1] === 3 && l.bytes[MESH.HEADER + 2] === 0);
  assert.ok(back.length >= 1, "it flooded a verdict that it is back, about itself");
});

test("a node that has heard two copies still repeats when it is the only way to a neighbour, and drops its own when it is not", async () => {
  const build = async (zHearsThem) => {
    const air = await MeshAir.create({ seed: 8, beatMs: 5000 });
    for (let i = 1; i <= 4; i++) air.add(i, 0, 0, 5);   // 1 sends, 2 repeats, 3 hears both, 4 hears only 3 (or all)
    air.link(1, 2, -55); air.link(1, 3, -55); air.link(2, 3, -55); air.link(3, 4, -55);
    if (zHearsThem) { air.link(1, 4, -55); air.link(2, 4, -55); }
    air.syncAll();
    air.run(20000);
    const keys = [];
    for (let i = 0; i < 40; i++) { keys.push(air.send(1, MeshType.State, 255, [i])); air.run(100); }
    air.settle();
    return { air, got: keys.filter((k) => air.reached(k).has(4)).length, m: air.node(3).slot };
  };
  const only = await build(false);
  assert.equal(only.got, 40, "node 4 hears only node 3, which has to repeat it each time");
  assert.ok(only.air.core.stat(only.m, "keptAsOnlyWay") >= 3, `kept ${only.air.core.stat(only.m, "keptAsOnlyWay")} times`);
  assert.equal(only.air.core.stat(only.m, "suppressed"), 0);
  const many = await build(true);
  assert.equal(many.got, 40);
  assert.equal(many.air.core.stat(many.m, "keptAsOnlyWay"), 0, "everyone it hears is covered by the two it heard");
  assert.ok(many.air.core.stat(many.m, "suppressed") >= 3, `dropped ${many.air.core.stat(many.m, "suppressed")} times`);
});

test("a neighbour that does not hear this node is no way back to anywhere: the answer goes round it", async () => {
  const air = await MeshAir.create({ seed: 6, beatMs: 5000 });
  for (let i = 1; i <= 3; i++) air.add(i, 0, 0, 5);
  air.link(1, 3, -55); air.link(2, 3, -55);
  air.link(1, 2, -120, -60);                   // 1 hears 2, and 2 does not hear 1
  air.syncAll();
  air.run(20000);
  assert.equal(air.neighbor(1, 2).listsMe, 2, "node 2's heartbeat does not list node 1");
  const key = air.send(2, MeshType.Command, 1, [5], true);
  air.settle();
  const o = air.outcomes.get(key);
  assert.deepEqual([o.ok, o.attempts], [true, 2], "the first copy had no way back; the second attempt was answered round it");
  assert.ok(air.log.filter(isAck).filter((l) => l.from === 1).every((l) => l.to === 3), "node 1 sent its answer to 3, never to 2");
  assert.equal(air.deliveriesOf(key, 1), 2, "delivered twice, the second marked as a repeat");
});

test("when more than a third of what should get through does not, for two minutes running, the channel is called noisy, to the house; calm again when it clears", async () => {
  const air = await house({ beatMs: 5000, loss: 0.45 });
  air.run(200000);
  const noisy = air.nodes.filter((n) => air.core.noisy(n.slot));
  assert.ok(noisy.length >= 10, `${noisy.length} of 14 nodes call their channel noisy`);
  const loss = air.nodes.map((n) => air.core.lossPercent(n.slot));
  assert.ok(Math.min(...loss) >= 25 && Math.max(...loss) <= 70, `the loss they measure, near the 45% there is: ${loss.join(",")}`);
  const told = air.nodes.filter((n) => air.noticesOf(n.id, NoticeKind.Noisy).some((x) => x.notice.by !== n.id));
  assert.ok(told.length >= 12, `${told.length} nodes were told of another's noise`);
  air.opt.loss = 0;
  air.run(260000);
  assert.equal(air.nodes.filter((n) => air.core.noisy(n.slot)).length, 0, "all calm");
  assert.ok(air.nodes.filter((n) => air.noticesOf(n.id, NoticeKind.Calm).length > 0).length >= 10);
});

test("a tenth of the receptions lost is no noise, and a node that goes off is not noise either: no notice of it in either case", async () => {
  const air = await house({ beatMs: 5000, loss: 0.1 });
  air.run(200000);
  assert.equal(air.nodes.filter((n) => air.core.noisy(n.slot)).length, 0);
  assert.equal(air.notices.filter((x) => x.notice.kind === NoticeKind.Noisy).length, 0);
  const calm = await house({ beatMs: 5000 });
  calm.run(20000);
  calm.power(3, false);
  calm.run(150000);
  assert.equal(calm.notices.filter((x) => x.notice.kind === NoticeKind.Noisy).length, 0, "the pings to a node that is gone fail, and are not counted against the channel");
});

test("the whole supervision of a house is a node's few kilobytes, and its heartbeat is a frame under 80 bytes", async () => {
  const air = await house({ beatMs: 5000 });
  air.core.setInfo(air.node(1).slot, new Array(20).fill(1));
  air.run(20000);
  const biggest = Math.max(...heartbeats(air).map((l) => l.len));
  assert.ok(biggest <= 14 + 2 + 20 + 1 + 2 * 12 + 8, `${biggest} bytes`);
  assert.ok(air.core.sizeOf() < 20000, `a node of the core is ${air.core.sizeOf()} bytes`);   // with the tables of 48 origins and 48 neighbours: 12.7 KB with 16; the mesh clock (its time, its timeline, 8 events, the skew of each neighbour) took 456 bytes more, and the outcome of the last unicast frames to each neighbour 384
});

test("the way back is replaced only by one as near, by the hops the frame had left, and a way that fails is demoted and gives place to the next copy", () => {
  const n = node();
  n.sync();
  const via = () => core.routeTo(0, 9)?.[5];
  assert.equal(n.hear(frame({ counter: 1, hops: 3 }), -60, 7), "accepted");
  assert.equal(via(), 7, "the first copy is the way");
  n.hear(frame({ counter: 2, hops: 1 }), -60, 8);
  assert.equal(via(), 7, "a copy heard with fewer hops left came a longer way round: it does not take the place");
  n.hear(frame({ counter: 3, hops: 3 }), -60, 8);
  assert.equal(via(), 8, "one as near does: the way follows the neighbours that are as near as the one kept");
  // a hop to node 8 that the radio cannot deliver, three times
  assert.ok(core.sendRouted(0, MeshType.Command, 9, [1], 0));
  for (let i = 0; i < 3; i++) {
    const out = core.nextTx(0, 10 * (i + 1));
    assert.equal(out.to[5], 8);
    core.txDone(0, false, 10 * (i + 1));
  }
  assert.equal(via(), 8, "the way is kept, for there may be no other yet");
  n.hear(frame({ counter: 4, hops: 1 }), -60, 6);
  assert.equal(via(), 6, "but the next frame heard, however far it came, takes its place");
});

// --- messages longer than a frame, and lists in pieces --------------------------------------------

const bytesOf = (n, seed = 1) => Array.from({ length: n }, (_, i) => (i * 7 + seed) & 255);

test("a message that does not fit a frame goes in two, each with a number of its own, and the destination has the two to join", async () => {
  const air = await house();
  const data = bytesOf(400);
  const keys = air.sendParts(1, MeshType.State, 14, data, true);
  assert.ok(keys, "it went");
  air.settle();
  const got = air.deliveries.filter((d) => d.node === 14).map((d) => d.d);
  assert.deepEqual(got.map((d) => d.part).sort(), [1, 2], "the first part and the second");
  const [first, second] = [got.find((d) => d.part === 1), got.find((d) => d.part === 2)];
  assert.notEqual(first.counter, second.counter, "a number each, so that no nonce is used twice");
  assert.equal(second.joins, first.counter, "the second names the first");
  assert.deepEqual([...first.payload, ...second.payload], data, "joined, the message as it was sent");
  assert.equal(first.payload.length, MESH.MAX_PAYLOAD);
  for (const k of keys) assert.ok(air.outcomes.get(k)?.ok, "each part confirmed on its own");
});

test("a message of two parts for everyone reaches everyone, and what does not fit in two, or fits in one, is not sent", async () => {
  const air = await house();
  const data = bytesOf(440);
  const keys = air.sendParts(5, MeshType.State, 255, data);
  assert.ok(keys);
  air.settle();
  for (const n of air.nodes.filter((x) => x.id !== 5)) {
    const own = air.deliveries.filter((d) => d.node === n.id && d.d.origin === 5).map((d) => d.d).sort((a, b) => a.part - b.part);
    assert.deepEqual(own.map((d) => d.part), [1, 2], `node ${n.id}`);
    assert.deepEqual([...own[0].payload, ...own[1].payload], data);
  }
  const before = air.log.length;
  assert.equal(air.sendParts(5, MeshType.State, 255, bytesOf(2 * MESH.MAX_PAYLOAD - 3)), null, "453 bytes are one too many for two parts");
  assert.equal(air.sendParts(5, MeshType.State, 255, bytesOf(MESH.MAX_PAYLOAD)), null, "and what fits a frame is sent as one");
  assert.ok(air.sendParts(5, MeshType.State, 255, bytesOf(2 * MESH.MAX_PAYLOAD - 4)), "452, two frames less four, is the most");
  air.settle();
  assert.ok(air.log.length > before);
});

// a list as the sender's application would send it: pieces as the queue has room, and the ones asked for sent again
const le32of = (p, at) => (p[at] | (p[at + 1] << 8) | (p[at + 2] << 16) | (p[at + 3] << 24)) >>> 0;
const transfer = (air, from, to, id, data, maxMs = 4000) => {
  const total = Math.ceil(data.length / BULK.PIECE);
  const piece = (i) => data.slice(i * BULK.PIECE, (i + 1) * BULK.PIECE);
  const queue = [...Array(total).keys()];
  let seen = air.deliveries.length;
  let done = false;
  let naks = 0;
  const end = air.t + maxMs * 1000;
  while (air.t < end && !done) {
    while (queue.length && air.core.queued(air.node(from).slot) < 6) {
      const i = queue.shift();
      if (!air.sendBulkPiece(from, to, id, i, total, piece(i))) { queue.unshift(i); break; }
    }
    air.run(10);
    for (; seen < air.deliveries.length; seen++) {
      const x = air.deliveries[seen];
      if (x.node !== from || x.d.type !== MeshType.Bulk) continue;
      const p = x.d.payload;
      if (p[0] === BulkSub.Done) done = true;
      if (p[0] === BulkSub.Nak) {
        naks++;
        const mask = le32of(p, 3);
        for (let i = 0; i < total; i++) if ((mask >>> i) & 1) queue.push(i);
      }
    }
  }
  return { done, naks, total };
};
const piecesAt = (air, node, id) => {
  const out = [];
  for (const x of air.deliveries) {
    const p = x.d.payload;
    if (x.node === node && x.d.type === MeshType.Bulk && p[0] === BulkSub.Piece && (p[1] | (p[2] << 8)) === id) out.push({ index: p[3], total: p[4], data: Array.from(p.slice(5)) });
  }
  return out;
};
const joined = (pieces) => pieces.sort((a, b) => a.index - b.index).filter((p, i, all) => i === 0 || p.index !== all[i - 1].index).flatMap((p) => p.data);

test("a list of forty devices goes as eight pieces along the way back, three hops, and the node that asked is told when it has them all", async () => {
  const air = await house();
  air.send(1, MeshType.Command, 255, [9]);       // the request floods, and the bridge far off keeps the way back to the panel
  air.settle();
  const list = bytesOf(1500, 3);
  const mark = air.log.length;
  const t0 = air.t;
  const r = transfer(air, 13, 1, 77, list);
  assert.equal(r.done, true, "the sender was told it all came");
  assert.equal(r.total, 8);
  assert.deepEqual(joined(piecesAt(air, 1, 77)), list, "the list, whole");
  assert.equal(piecesAt(air, 1, 77).length, 8, "each piece given to the application once");
  const frames = air.log.slice(mark).filter((l) => l.kind >> 5 === MeshType.Bulk);
  assert.ok(frames.every((l) => l.to !== 255), "every frame of it a unicast to the next hop: nothing of it floods");
  assert.ok(frames.length >= 8 * 3, `${frames.length} frames for 8 pieces over the hops`);
  assert.ok((air.t - t0) / 1000 < 300, `${((air.t - t0) / 1000).toFixed(0)} ms`);
  const notice = air.noticesOf(1, NoticeKind.BulkDone, 13);
  assert.equal(notice.length, 1);
  assert.equal(notice[0].notice.value, 77, "told which transfer");
  assert.equal(air.core.stat(air.node(1).slot, "naksSent"), 0, "no piece was missing");
});

test("with a third of the receptions lost the pieces that are missing are asked for, and sent again, until the list is whole", async () => {
  const air = await house({ loss: 0.3 });
  air.send(1, MeshType.Command, 255, [9], false);
  air.settle();
  const list = bytesOf(2200, 5);
  const r = transfer(air, 13, 1, 12, list, 8000);
  assert.equal(r.done, true);
  assert.deepEqual(joined(piecesAt(air, 1, 12)), list);
  assert.equal(air.core.stat(air.node(1).slot, "bulkLost"), 0);
});

test("a sender that stops is asked three times, 300 ms apart, and the transfer is given up with a notice, never left hanging", async () => {
  const air = await house();
  air.send(1, MeshType.Command, 255, [9]);
  air.settle();
  const list = bytesOf(1000, 9);
  for (let i = 0; i < 3; i++) air.sendBulkPiece(13, 1, 5, i, 5, list.slice(i * 200, (i + 1) * 200));   // three of the five, and then nothing
  const mark = air.log.length;
  air.run(2000);
  const naks = air.log.slice(mark).filter((l) => l.kind >> 5 === MeshType.Bulk && l.origin === 1 && l.bytes[MESH.HEADER] === BulkSub.Nak && l.hops === MESH.MAX_HOPS);
  assert.equal(naks.length, 3, "three asks");
  const gaps = naks.slice(1).map((l, i) => (l.at - naks[i].at) / 1000);
  assert.ok(gaps.every((g) => g >= 295 && g <= 330), `${gaps.map((g) => g.toFixed(0))} ms apart`);
  assert.equal(air.noticesOf(1, NoticeKind.BulkLost, 13).length, 1);
  assert.equal(air.core.stat(air.node(1).slot, "bulkLost"), 1);
  assert.equal(air.noticesOf(1, NoticeKind.BulkDone).length, 0);
});

test("a piece that comes again after the list is whole is not given to the application, and the sender, which did not hear it was done, is told again", async () => {
  const air = await house();
  air.send(1, MeshType.Command, 255, [9]);
  air.settle();
  const list = bytesOf(600, 2);
  assert.equal(transfer(air, 13, 1, 3, list).done, true);
  const given = piecesAt(air, 1, 3).length;
  const dones = () => air.log.filter((l) => l.kind >> 5 === MeshType.Bulk && l.origin === 1 && l.bytes[MESH.HEADER] === BulkSub.Done).length;
  const before = dones();
  air.sendBulkPiece(13, 1, 3, 1, 3, list.slice(200, 400));
  air.settle();
  assert.equal(piecesAt(air, 1, 3).length, given, "not given again");
  assert.ok(dones() > before, "and the answer that the list is whole goes again");
  assert.equal(air.core.stat(air.node(1).slot, "piecesRepeated"), 1);
});

test("with no way back to the node, a piece is flooded to it, and the rest of the transfer is as before", async () => {
  const air = await house();
  const list = bytesOf(500, 4);
  const mark = air.log.length;
  const r = transfer(air, 3, 1, 8, list);
  assert.equal(r.done, true, "the answers found a way back from the pieces themselves");
  assert.deepEqual(joined(piecesAt(air, 1, 8)), list);
  const first = air.log.slice(mark).find((l) => l.kind >> 5 === MeshType.Bulk && l.origin === 3);
  assert.equal(first.to, 255, "the first piece had no way to node 1, and went to everyone for it");
});

// --- the cipher, the toy one of the simulator and the firmware's own on BearSSL: what a relay does not read, and what a stranger cannot make ----------------------
for (const cipher of [true, "real"]) {
const label = cipher === "real" ? "(BearSSL) " : "(toy) ";

const keyCounter = (key) => Number(key.split(":")[2]);
const onAir = (air, key) => air.log.filter((l) => l.origin === Number(key.split(":")[0]) && l.counter === keyCounter(key));

test(label + "with the cipher the payload is enciphered on the air, for one node with the key of the pair and for all with the network's, and the destination reads what was sent", async () => {
  const air = await house({ cipher });
  const secret = bytesOf(40, 11);
  const pair = air.send(1, MeshType.Command, 14, secret, true);
  const group = air.send(1, MeshType.State, 255, secret);
  air.settle();
  assert.deepEqual([...air.delivered.get(pair).get(14).d.payload], secret, "the destination reads it");
  assert.deepEqual([...air.delivered.get(group).get(14).d.payload], secret);
  assert.ok(air.outcomes.get(pair).ok);
  const frames = [...onAir(air, pair), ...onAir(air, group)];
  assert.ok(frames.length >= 3);
  for (const l of frames) assert.notDeepEqual([...l.bytes.slice(MESH.HEADER, MESH.HEADER + secret.length)], secret, "no frame on the air carries it as it is, whoever repeats it");
  assert.equal(onAir(air, pair)[0].len, MESH.HEADER + secret.length + 8 + MESH.TAG, "a frame for one node carries the tag of its seal");
  assert.equal(onAir(air, group)[0].len, MESH.HEADER + secret.length + MESH.TAG, "and one for all carries none");
  // redirected, by a node that has the network's key, to another node: it has the key of its own pair with the origin, not the one of the pair that was meant
  air.opt.loss = 1;                            // a frame that nobody hears, so that node 5 has not seen it
  const lost = air.send(1, MeshType.Command, 14, secret, false);
  air.run(50);
  air.opt.loss = 0;
  const redirected = Uint8Array.from(onAir(air, lost)[0].bytes);
  redirected[3] = 5;
  assert.equal(air.core.receive(air.node(5).slot, air.core.tagAs(air.node(3).slot, redirected), macOf(1), -60, air.ms), "bad", "node 5 cannot open what was for node 14");
  assert.equal(air.core.stat(air.node(5).slot, "cipherBad"), 1);
  const copies = onAir(air, pair).filter((l) => l.kind === onAir(air, pair)[0].kind);
  assert.ok(copies.every((l) => Buffer.compare(Buffer.from(l.bytes.slice(MESH.HEADER, l.len - MESH.TAG)), Buffer.from(copies[0].bytes.slice(MESH.HEADER, copies[0].len - MESH.TAG))) === 0), "every copy of a frame has the same payload: the relays add nothing");
});

test(label + "a frame for one node alone has 220 bytes for its payload, one for everyone 228, and a node with no key for the destination sends nothing", async () => {
  const air = await house({ cipher });
  const slot = air.node(1).slot;
  assert.equal(air.core.maxPayload(slot, 14), 220);
  assert.equal(air.core.maxPayload(slot, 255), 228);
  assert.ok(air.core.send(slot, MeshType.Command, 14, bytesOf(220), false, air.ms), "220 go");
  assert.equal(air.core.send(slot, MeshType.Command, 14, bytesOf(221), false, air.ms), 0, "221 do not");
  assert.ok(air.core.send(slot, MeshType.State, 255, bytesOf(228), false, air.ms), "228 go to all");
  assert.equal(air.core.send(slot, MeshType.Command, 200, [1], false, air.ms), 0, "no key for the node 200");
  assert.equal(air.core.stat(slot, "noKey"), 1);
  const parts = air.sendParts(1, MeshType.State, 14, bytesOf(420, 6), true);
  assert.ok(parts, "two parts of 220 and 204: the most a pair has is 2 x 220 less 4");
  assert.equal(air.sendParts(1, MeshType.State, 14, bytesOf(437), true), null, "437 is one too many");
});

test(label + "a frame forged in the name of another node, by one that has the network's key and not the pair's, is refused, and does not move the window of the one it pretends to be", async () => {
  const air = await house({ cipher });
  const slot = air.node(14).slot;
  const forged = air.core.tagAs(air.node(5).slot, core.encode({ kind: packKind(MeshType.Command, true), origin: 3, dest: 14, next: 0, hops: 3, epoch: 5, counter: 5000, payload: new Array(28).fill(7) }, false));
  assert.equal(air.core.receive(slot, forged, macOf(5), -60, air.ms), "bad", "the envelope's tag is right, the seal of the pair is not");
  assert.equal(air.core.stat(slot, "cipherBad"), 1);
  assert.equal(air.core.pop(slot), null, "nothing reached the application");
  const key = air.send(3, MeshType.Command, 14, [1, 2, 3], true);
  air.settle();
  assert.ok(air.outcomes.get(key).ok, "the real node 3 is still heard, its counter far below the forged one");
  assert.deepEqual([...air.delivered.get(key).get(14).d.payload], [1, 2, 3]);
  // a frame for all, forged by one that has the network's key, is what a network key gives: nothing is said to protect it
});

test(label + "with losses, the commands to other rooms are enciphered, sent again with the same bytes, and delivered as they were", async () => {
  const air = await house({ loss: 0.3, cipher });
  const keys = [];
  for (let i = 0; i < 40; i++) {
    const from = 1 + ((i * 5) % 14);
    let to = 1 + ((i * 11 + 3) % 14);
    if (to === from) to = 1 + (to % 14);
    const payload = bytesOf(30, i);
    keys.push([air.send(from, MeshType.Command, to, payload, true), to, payload]);
    air.run(120);
  }
  air.settle(3000);
  let ok = 0;
  for (const [k, to, payload] of keys) {
    const o = air.outcomes.get(k);
    assert.ok(o, `${k} ended with no word`);
    if (!o.ok) continue;
    ok++;
    for (const d of air.deliveries.filter((x) => x.node === to && `${x.d.origin}:${x.d.epoch}:${x.d.counter}` === k)) assert.deepEqual([...d.d.payload], payload);
    const sent = onAir(air, k).filter((l) => l.from === Number(k.split(":")[0]));
    const bodies = new Set(sent.map((l) => Buffer.from(l.bytes.slice(MESH.HEADER, l.len - MESH.TAG)).toString("hex")));
    assert.equal(bodies.size, 1, "the attempts carry the same enciphered bytes, the attempt number being no part of the seal");
  }
  assert.ok(ok / keys.length >= 0.95, `${ok} of ${keys.length}`);
});

test(label + "a list in pieces, and a heartbeat that carries the application's bytes, cross the house enciphered", async () => {
  const air = await house({ cipher, beatMs: 5000 });
  air.core.setInfo(air.node(3).slot, [7, 8, 9]);
  air.run(12000);
  assert.deepEqual([...air.neighbor(1, 3).info], [7, 8, 9], "the heartbeat's bytes, opened");
  air.send(1, MeshType.Command, 255, [9]);
  air.settle();
  const list = bytesOf(1500, 3);
  assert.equal(transfer(air, 13, 1, 77, list).done, true);
  assert.deepEqual(joined(piecesAt(air, 1, 77)), list);
  const frame = air.log.find((l) => l.kind >> 5 === MeshType.Bulk && l.origin === 13);
  const read = air.deliveries.find((d) => d.d.origin === 13 && d.d.counter === frame.counter).d.payload;
  assert.notDeepEqual([...frame.bytes.slice(MESH.HEADER, MESH.HEADER + 8)], [...read.slice(0, 8)], "and a piece on the air is not what the destination reads");
});

test(label + "a node that goes off is found silent by the supervision of an enciphered house in the same time", async () => {
  const air = await house({ cipher, beatMs: 5000 });
  air.run(20000);
  air.power(3, false);
  const t0 = air.t;
  air.run(45000);
  const others = air.nodes.filter((n) => n.id !== 3);
  const told = others.map((n) => {
    const got = air.noticesOf(n.id, NoticeKind.Silent, 3);
    assert.ok(got.length >= 1, `node ${n.id} was never told`);
    return seconds(got[0].at - t0);
  });
  assert.ok(Math.min(...told) >= 19 && Math.max(...told) <= 28, `told between ${Math.min(...told).toFixed(1)} and ${Math.max(...told).toFixed(1)} s`);
});
}

// --- the keys and the cipher on BearSSL, against the standards --------------------------------------

const hex = (h) => Uint8Array.from(h.replace(/\s+/g, "").match(/../g) ?? [], (x) => parseInt(x, 16));
const toHex = (b) => Buffer.from(b).toString("hex");
const fill = (n, f) => Uint8Array.from({ length: n }, (_, i) => f(i));

test("X25519 gives the vectors of RFC 7748, both sides of an exchange agree, and a point of small order gives no key", () => {
  const aliceSecret = hex("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a");
  const alicePublic = hex("8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a");
  const bobSecret = hex("5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb");
  const bobPublic = hex("de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f");
  const shared = "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742";
  const base = fill(32, (i) => (i === 0 ? 9 : 0));
  assert.equal(toHex(core.x25519(aliceSecret, base)), toHex(alicePublic), "a public key from a secret, RFC 7748 section 6.1");
  assert.equal(toHex(core.x25519(bobSecret, base)), toHex(bobPublic));
  assert.equal(toHex(core.x25519(aliceSecret, bobPublic)), shared, "the shared secret, one side");
  assert.equal(toHex(core.x25519(bobSecret, alicePublic)), shared, "and the other");
  const scalar = hex("a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4");
  const u = hex("e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c");
  assert.equal(toHex(core.x25519(scalar, u)), "c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552", "RFC 7748 section 5.2");
  assert.equal(core.x25519(aliceSecret, new Uint8Array(32)), null, "the point of order 1 gives no key");
});

test("HMAC-SHA256 and HKDF-SHA256 give the vectors of RFC 4231 and RFC 5869, and agree with the platform's on any input", () => {
  assert.equal(toHex(core.hmac(Buffer.from("Jefe"), Buffer.from("what do ya want for nothing?"))), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  const okm = core.hkdf(hex("000102030405060708090a0b0c"), fill(22, () => 0x0b), hex("f0f1f2f3f4f5f6f7f8f9"), 42);
  assert.equal(toHex(okm), "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865", "RFC 5869 test case 1");
  for (const n of [1, 31, 32, 33, 64, 200]) {
    const key = nodeCrypto.randomBytes(n), data = nodeCrypto.randomBytes(3 * n + 1);
    assert.equal(toHex(core.hmac(key, data)), nodeCrypto.createHmac("sha256", key).update(data).digest("hex"));
    const salt = nodeCrypto.randomBytes(n), info = nodeCrypto.randomBytes(1 + (n % 20));
    assert.equal(toHex(core.hkdf(salt, key, info, 16 + (n % 40))), Buffer.from(nodeCrypto.hkdfSync("sha256", key, salt, info, 16 + (n % 40))).toString("hex"));
  }
});

test("AES-128-CCM gives the vector of RFC 3610, agrees with the platform's for the nonce, tag and header the mesh uses, and refuses what was changed", () => {
  const key = hex("c0c1c2c3c4c5c6c7c8c9cacbcccdcecf");
  const sealed = core.ccmSeal(key, hex("00000003020100a0a1a2a3a4a5"), hex("0001020304050607"), hex("08090a0b0c0d0e0f101112131415161718191a1b1c1d1e"), 8);
  assert.equal(toHex(sealed.data) + toHex(sealed.tag), "588c979a61c663d2f066d0c2c0f989806d5f6b61dac38417e8d12cfdf926e0", "RFC 3610, packet vector 1");
  for (const len of [1, 2, 15, 16, 17, 100, 220]) {
    const nonce = nodeCrypto.randomBytes(9), aad = nodeCrypto.randomBytes(14), plain = nodeCrypto.randomBytes(len);
    const mine = core.ccmSeal(key, nonce, aad, plain, 8);
    const cipher = nodeCrypto.createCipheriv("aes-128-ccm", key, nonce, { authTagLength: 8 });
    cipher.setAAD(aad, { plaintextLength: len });
    const theirs = Buffer.concat([cipher.update(plain), cipher.final()]);
    assert.equal(toHex(mine.data), theirs.toString("hex"), `ciphertext of ${len}`);
    assert.equal(toHex(mine.tag), cipher.getAuthTag().toString("hex"), `tag of ${len}`);
    assert.equal(toHex(core.ccmOpen(key, nonce, aad, mine.data, mine.tag)), toHex(plain), "and it opens");
    const flip = (b, i) => { const c = Uint8Array.from(b); c[i % c.length] ^= 1; return c; };
    assert.equal(core.ccmOpen(key, nonce, aad, flip(mine.data, 3), mine.tag), null, "a changed ciphertext");
    assert.equal(core.ccmOpen(key, nonce, flip(aad, 5), mine.data, mine.tag), null, "a changed header");
    assert.equal(core.ccmOpen(key, nonce, aad, mine.data, flip(mine.tag, 2)), null, "a changed tag");
    assert.equal(core.ccmOpen(key, flip(nonce, 4), aad, mine.data, mine.tag), null, "another nonce");
  }
});

test("AES-128-CTR, for the frames to everyone, agrees with the platform's, with the nonce of nine bytes and the counter at 0", () => {
  for (const len of [1, 16, 17, 100, 228]) {
    const key = nodeCrypto.randomBytes(16), nonce = nodeCrypto.randomBytes(9), plain = nodeCrypto.randomBytes(len);
    const c = nodeCrypto.createCipheriv("aes-128-ctr", key, Buffer.concat([nonce, Buffer.alloc(7)]));
    const theirs = Buffer.concat([c.update(plain), c.final()]);
    assert.equal(toHex(core.ctr(key, nonce, plain)), theirs.toString("hex"), `${len} bytes`);
  }
});

// --- the second way: the network the nodes share --------------------------------------------------

const counterOf = (key) => Number(key.split(":")[2]);
const radioFrames = (air, key) => air.log.filter((l) => l.origin === Number(key.split(":")[0]) && l.counter === counterOf(key));
const udpFrames = (air, key) => air.udpLog.filter((l) => l.origin === Number(key.split(":")[0]) && l.counter === counterOf(key));

test("two nodes with no radio between them find each other by the network, and a command is confirmed over it, the radio's frame heard by no one", async () => {
  const air = await MeshAir.create({ seed: 3, net: true, beatMs: 5000 });
  air.add(1, 0, 0, 5);
  air.add(2, 500, 0, 5);                       // no signal between them
  air.syncAll();
  air.run(20000);
  const heard = air.neighbor(1, 2);
  assert.ok(heard, "the heartbeat came by the network");
  assert.equal(heard.rssi, 0, "and never on the radio");
  assert.equal(heard.state, "alive");
  const key = air.send(1, MeshType.Command, 2, [1, 2, 3], true);
  air.settle();
  const o = air.outcomes.get(key);
  assert.deepEqual([o.ok, o.attempts], [true, 1]);
  assert.ok((o.at - air.sentAt.get(key)) / 1000 < 10, `${(o.at - air.sentAt.get(key)) / 1000} ms`);
  assert.equal(radioFrames(air, key).filter((l) => l.from !== 1).length, 0, "the radio is tried, a frame, in case the node is there by hops, and nobody repeats it");
  assert.ok(udpFrames(air, key).every((l) => l.to === 2), "to the address of the node it is for, not to everyone");
  assert.equal(air.deliveriesOf(key, 2), 1);
  assert.ok(air.udpLog.some((l) => l.kind >> 5 === MeshType.Ack && l.from === 2 && l.to === 1), "and the answer came back the way the frame came");
});

test("an event goes by the radio and by the network at once and is the application's once at every node, the far ones first", async () => {
  const air = await house({ net: true });
  const key = air.send(1, MeshType.Event, 255, [7, 7]);
  air.settle();
  for (const n of air.nodes.filter((x) => x.id !== 1)) assert.equal(air.deliveriesOf(key, n.id), 1, `node ${n.id}`);
  assert.equal(udpFrames(air, key).length, 1, "one frame to all of them on the network");
  assert.equal(udpFrames(air, key)[0].to, 0);
  assert.ok(radioFrames(air, key).length >= 3, "and the radio's flood");
  const at = air.reached(key);
  assert.ok(at.get(14) / 1000 <= 3, `the farthest room in ${at.get(14) / 1000} ms: the network does not need the hops`);
  const state = air.send(1, MeshType.State, 255, [1]);
  air.settle();
  assert.equal(udpFrames(air, state).length, 0, "a state is not an event: the radio alone");
});

test("when the radio has not heard a neighbour for 15 s, a command to it goes by both ways, and is confirmed over the network", async () => {
  const air = await MeshAir.create({ seed: 4, net: true, beatMs: 5000 });
  air.add(1, 0, 0, 5);
  air.add(2, 10, 0, 5);
  air.link(1, 2, -60);
  air.syncAll();
  air.run(12000);
  const before = air.send(1, MeshType.Command, 2, [1], true);
  air.settle();
  assert.equal(udpFrames(air, before).length, 0, "with the radio in order: the radio alone");
  air.setLinkLoss(1, 2, 1);
  air.setLinkLoss(2, 1, 1);                    // the radio between them is gone; the network is not
  air.run(5000);
  const soon = air.send(1, MeshType.Command, 2, [2], true);
  air.settle();
  assert.equal(udpFrames(air, soon).length, 0, "a few seconds are not enough to say the radio is gone");
  assert.equal(air.outcomes.get(soon).ok, false, "and the radio alone does not deliver");
  air.run(16000);
  const key = air.send(1, MeshType.Command, 2, [3], true);
  air.settle();
  const o = air.outcomes.get(key);
  assert.deepEqual([o.ok, o.attempts], [true, 1], "after 15 s of no radio, the network carries it");
  assert.ok(udpFrames(air, key).length >= 1 && radioFrames(air, key).length >= 1, "the radio is still tried, for it may come back");
  assert.equal(air.deliveriesOf(key, 2), 1);
  assert.equal(air.notices.filter((x) => x.notice.kind === NoticeKind.Silent).length, 0, "and neither is given up as silent: its heartbeats come by the network");
});

test("with the network down no frame is given it, and a node on the network alone is reached through one that has a radio and is set to relay", async () => {
  const quiet = await house({ net: true });
  for (const n of quiet.nodes) quiet.core.setUdp(n.slot, false);
  const key = quiet.send(1, MeshType.Event, 255, [1]);
  quiet.settle();
  assert.equal(quiet.udpLog.length, 0, "the network is down for all of them");
  assert.equal(quiet.reached(key).size, 13, "and the radio did it all");

  // a node with no radio in use (as a panel in tcp mode had): bridge B (2) hears X (3) on the radio and P (1) on the network
  const air = await MeshAir.create({ seed: 6, net: [1, 2], udpOnly: [1], udpRelay: [2], beatMs: 5000 });
  air.add(1, 0, 0, 5);
  air.add(2, 20, 0, 5);
  air.add(3, 40, 0, 5);
  air.link(2, 3, -60);
  air.syncAll();
  air.run(20000);
  assert.equal(air.neighbor(2, 1).rssi, 0, "the bridge hears the panel on the network only");
  assert.equal(air.neighbor(2, 1).state, "alive");
  // X floods a state: it reaches the panel only because B repeats it on the network
  const state = air.send(3, MeshType.State, 255, [4, 5, 6]);
  air.settle();
  assert.equal(air.deliveriesOf(state, 1), 1, "the panel, with no radio, has the state, once");
  assert.ok(udpFrames(air, state).every((l) => l.from === 2), "repeated on the network by the bridge");
  // the panel's command to X, which is not on the network: it goes to everyone on it, B repeats it on the radio, and the answer comes back
  const command = air.send(1, MeshType.Command, 3, [9], true);
  air.settle();
  const o = air.outcomes.get(command);
  assert.ok(o && o.ok, JSON.stringify(o));
  assert.equal(air.deliveriesOf(command, 3), 1);
  assert.equal(air.log.filter((l) => l.from === 1).length, 0, "the panel never used a radio");
});

test("the second way costs the network little: the heartbeats of a house by it are a frame each, and nothing is delivered twice", async () => {
  const air = await house({ net: true, beatMs: 5000 });
  for (let s = 0; s < 30; s++) {
    if (s % 5 === 0) air.send(1 + (s % 14), MeshType.Event, 255, [s]);
    if (s % 3 === 0) air.send(1 + ((s * 3) % 14), MeshType.Command, 255, [s]);
    air.run(1000);
  }
  air.settle();
  const seen = new Map();
  for (const d of air.deliveries) {
    if (d.d.type === MeshType.Beat) continue;
    const k = `${d.node}:${d.d.origin}:${d.d.epoch}:${d.d.counter}`;
    seen.set(k, (seen.get(k) ?? 0) + (d.d.retry ? 0 : 1));
  }
  assert.ok([...seen.values()].every((v) => v === 1), "no message was delivered twice to a node, the network or not");
  const beats = air.udpLog.filter((l) => l.kind >> 5 === MeshType.Beat && l.bytes[MESH.HEADER] === MeshSub.Beat).length;
  assert.ok(beats >= 14 * 5, `${beats} heartbeats went on the network`);
});

// --- the order and the freshness of the commands --------------------------------------------------

// What the bridge that owns a device does with the deliveries for it, as a reference for the layer in Berry: A, a number
// of its origin older than the last one executed for that device is obsolete; B, one that is more than `reach` numbers behind the
// newest of its origin is obsolete too, for a command that must be fresh. An obsolete one is still answered, so that it is not resent
class Orderer {
  constructor(reach = 99) { this.reach = reach; this.last = new Map(); }
  take(d, device) {
    const key = `${d.origin}:${device}`;
    const last = this.last.get(key) ?? { epoch: 0, counter: 0 };
    const newer = d.epoch > last.epoch || (d.epoch === last.epoch && d.counter > last.counter);
    if (!newer || d.behind > this.reach) return "obsolete";
    this.last.set(key, { epoch: d.epoch, counter: d.counter });
    return "execute";
  }
}

test("a delivery says how far behind the newest of its origin it came, 0 for the newest", async () => {
  const air = await cluster(3);
  const keys = [air.send(1, MeshType.Command, 2, [1]), air.send(1, MeshType.Command, 2, [2]), air.send(1, MeshType.Command, 2, [3])];
  air.settle();
  assert.deepEqual(keys.map((k) => air.delivered.get(k).get(2).d.behind), [0, 0, 0], "in order: none behind");
  const n = node();
  n.sync();
  for (const c of [10, 11, 12]) assert.equal(n.hear(frame({ counter: c })), "accepted");
  assert.equal(core.pop(0).behind, 0);
  core.pop(0);
  core.pop(0);
  assert.equal(n.hear(frame({ counter: 8 })), "accepted", "late, inside the window");
  assert.equal(core.pop(0).behind, 4, "four numbers behind the newest, 12");
  assert.equal(n.hear(frame({ counter: 13 })), "accepted");
  assert.equal(core.pop(0).behind, 0, "and a newer one is the newest again");
});

test("a command resent after a newer one comes later and as new: the order of its number tells the bridge to leave it", async () => {
  const air = await cluster(3);
  const bridge = new Orderer();
  air.opt.loss = 1;
  const open = air.send(1, MeshType.Command, 2, [1], true);       // the user taps "open", and the first attempt is lost
  air.run(20);
  air.opt.loss = 0;
  const close = air.send(1, MeshType.Command, 2, [2], true);      // a moment later, "close", which gets through
  air.settle();
  const seen = air.deliveries.filter((d) => d.node === 2).map((d) => d.d);
  assert.deepEqual(seen.map((d) => d.payload[0]), [2, 1], "close, and then the resend of open, delivered as a new one");
  assert.equal(seen[1].retry, false, "the core has never delivered that number: it cannot say it is a repeat");
  assert.equal(seen[1].behind, 1);
  assert.deepEqual(seen.map((d) => bridge.take(d, 7)), ["execute", "obsolete"], "the bridge executes close and leaves the stale open");
  assert.ok(air.outcomes.get(open).ok && air.outcomes.get(close).ok, "and both were answered, so that the origin stops resending");
});

test("a command held and let go later, with nothing newer for its device, is refused when the origin has said more than K things since", async () => {
  const air = await cluster(3);
  const strict = new Orderer(2);
  const lax = new Orderer();
  // "unlock" for the device 7, sent with no answer asked, and nobody hears it: it is held
  air.opt.loss = 1;
  const held = air.send(1, MeshType.Command, 2, [7], false);
  air.run(20);
  air.opt.loss = 0;
  // and the origin goes on talking, about other devices
  for (let i = 0; i < 3; i++) { air.send(1, MeshType.Command, 2, [8 + i], true); air.run(30); }
  air.settle();
  const bytes = Uint8Array.from(air.log.find((l) => l.origin === 1 && l.counter === Number(held.split(":")[2])).bytes);
  const slot = air.node(2).slot;
  assert.equal(air.core.receive(slot, bytes, macOf(1), -60, air.ms), "accepted", "inside the window and never seen: the core takes it, once");
  const late = air.core.pop(slot);
  assert.equal(late.behind, 3);
  assert.equal(strict.take(late, 7), "obsolete", "three behind is too far for a command that must be fresh");
  assert.equal(lax.take(late, 7), "execute", "and with no such rule it would have been executed");
  // the newest, in the same way, is executed
  const fresh = air.send(1, MeshType.Command, 2, [7], true);
  air.settle();
  assert.equal(strict.take(air.delivered.get(fresh).get(2).d, 7), "execute");
});

// --- what the application has room for, the numbers the sync covers, the second heartbeat, and the start of a node -----------------------

// the frames a node has ready to send at the time `now`, one after another as the radio would take them
const takeTx = (now) => {
  const out = [];
  for (let o = core.nextTx(0, now); o; o = core.nextTx(0, now)) { out.push(core.decode(o.bytes)); core.txDone(0, true, now); }
  return out;
};
const withAck = (counter, attempt = 0, over = {}) => frame({ kind: packKind(MeshType.Command, true, 0, attempt), dest: 1, counter, ...over });
const acks = (now = 0) => takeTx(now).filter((f) => f.kind >> 5 === MeshType.Ack).length;

test("a frame for this node alone that its application has no room for is not taken: no answer goes, no window moves, and the resend is taken as the first", () => {
  const n = node();
  n.sync();
  for (let c = 1; c <= 8; c++) assert.equal(n.hear(withAck(c)), "accepted");
  assert.equal(acks(), 8, "the eight the application has were answered");
  assert.equal(n.hear(withAck(9)), "full", "the inbox holds eight, and the ninth finds it full");
  assert.equal(acks(), 0, "and is not answered: the sender is not told it arrived");
  assert.equal(core.stat(0, "delivered"), 8);
  assert.equal(core.stat(0, "inboxFull"), 1);
  core.pop(0);
  // 100 ms later the sender's second attempt finds room, and it is the first the node has taken of that number
  assert.equal(n.hear(withAck(9, 1)), "accepted", "the window had not moved: not a repeat");
  const d = [...Array(8)].map(() => core.pop(0)).pop();
  assert.equal(d.counter, 9);
  assert.equal(d.retry, false, "delivered as new, for nothing of that number had been");
  assert.equal(acks(), 1, "and now answered");
  assert.equal(n.hear(withAck(9)), "replayed", "and now the number is in the window");
});

test("a frame for everyone is passed on whether or not the application has room for it: nobody waits for an answer to it", () => {
  const n = node();
  n.sync();
  for (let c = 1; c <= 8; c++) n.hear(withAck(c));
  takeTx(0);
  assert.equal(n.hear(frame({ counter: 20, dest: 255, kind: packKind(MeshType.State) })), "accepted");
  assert.equal(core.stat(0, "delivered"), 8, "the application did not get it");
  assert.equal(core.stat(0, "inboxFull"), 1);
  assert.equal(takeTx(20).filter((f) => f.kind >> 5 === MeshType.State).length, 1, "and it was repeated for the others");
});

test("a piece of a bulk transfer is counted as had only when the application has it, and a piece it was refused comes again", () => {
  const n = node();
  n.sync();
  const piece = (counter, index, total = 2) => frame({ kind: packKind(MeshType.Bulk), counter, dest: 1, payload: [0, 7, 0, index, total, 1, 2, 3] });
  for (let c = 1; c <= 8; c++) n.hear(withAck(c));
  assert.equal(n.hear(piece(20, 0)), "full");
  assert.equal(core.stat(0, "piecesNew"), 0, "not counted as had");
  for (let i = 0; i < 8; i++) core.pop(0);
  assert.equal(n.hear(piece(21, 0)), "accepted", "the same piece, in another frame, is the first the node has");
  assert.equal(core.stat(0, "piecesNew"), 1);
  assert.equal(core.pop(0).payload[3], 0, "and the application has it");
  n.hear(piece(22, 0));
  assert.equal(core.stat(0, "piecesRepeated"), 1);
  assert.equal(core.pop(0), null, "a piece it has had is not given again");
  n.hear(piece(23, 1));
  assert.equal(core.stat(0, "bulkDone"), 1, "and the transfer is complete when the last has been given");
});

test("the numbers an origin had used when it told where it was are covered: a first attempt of one is no frame of the origin's now, and a later attempt is, as new", () => {
  const n = node();
  n.sync(9, 5, 10);
  assert.equal(n.hear(frame({ counter: 10 })), "covered", "the number it answered with");
  assert.equal(n.hear(frame({ counter: 4 })), "covered", "and any before it in the window: a frame sent before, or a recording of one");
  assert.equal(core.pop(0), null);
  assert.equal(core.stat(0, "covered"), 2);
  // what the origin is still waiting an answer for comes again with a higher attempt, and is the first the node has of it
  assert.equal(n.hear(withAck(10, 1)), "accepted");
  const first = core.pop(0);
  assert.deepEqual([first.counter, first.retry, first.attempt], [10, false, 1], "delivered as new, not as a repeat of what was never delivered");
  assert.equal(n.hear(withAck(10, 2)), "retry", "and the attempt after it is a repeat");
  assert.equal(core.pop(0).retry, true);
  assert.equal(n.hear(frame({ counter: 11 })), "accepted", "the origin's next number is taken");
  assert.equal(core.pop(0).counter, 11);
  assert.equal(n.hear(frame({ counter: 3 })), "covered", "while the ones before the sync still are not");
  // once the window has moved a whole length on, a number that was never seen is the origin's, sent after the sync
  assert.equal(n.hear(frame({ counter: 60 })), "accepted");
  assert.equal(n.hear(frame({ counter: 40 })), "accepted");
  core.pop(0);
  core.pop(0);
});

test("an origin told again where it is, when this node already knows it at that epoch, is moved forward by the answer and never back", () => {
  const n = node();
  n.sync(10, 5, 0);
  for (let c = 1; c <= 5; c++) { assert.equal(n.hear(frame({ origin: 10, counter: c }), -60, 10), "accepted"); core.pop(0); }
  core.synced(0, 10, 5, 2);
  // seventy frames of another origin push the copies of those out of the node's memory: what is left to refuse them is the window
  n.sync();
  for (let c = 1; c <= 70; c++) { assert.equal(n.hear(frame({ counter: c })), "accepted"); core.pop(0); }
  assert.equal(n.hear(frame({ origin: 10, counter: 3 }), -60, 10), "replayed", "an answer that says 2 does not make 3 a new number");
  core.synced(0, 10, 5, 20);
  assert.equal(n.hear(frame({ origin: 10, counter: 12 }), -60, 10), "covered", "one that says 20 covers what it had used by then");
  assert.equal(n.hear(frame({ origin: 10, counter: 21 }), -60, 10), "accepted");
});

test("a neighbour is taken for one that does not hear this node only from its second heartbeat since it was made known: the first can list no one", () => {
  const n = node({ beatMs: 5000 });
  n.sync();
  const beat = (counter, list = []) => frame({ kind: packKind(MeshType.Beat), origin: 9, dest: 255, hops: 0, counter, payload: [0, 0, 0, list.length, ...list.flatMap((id) => [id, 200])] });
  assert.equal(n.hear(frame({ counter: 1, hops: 3 })), "accepted");
  assert.notEqual(core.routeTo(0, 9), null, "a way back to the origin, by the neighbour it was heard from");
  assert.equal(n.hear(beat(2)), "accepted");
  assert.equal(core.neighbors(0)[0].listsMe, 0, "its first heartbeat lists no one, and says nothing");
  assert.notEqual(core.routeTo(0, 9), null, "so the way back stays");
  assert.equal(n.hear(beat(3)), "accepted");
  assert.equal(core.neighbors(0)[0].listsMe, 2, "the second does: it does not hear this node");
  assert.equal(core.routeTo(0, 9), null, "and the way back by it is given up");
  assert.equal(n.hear(beat(4, [1])), "accepted");
  assert.equal(core.neighbors(0)[0].listsMe, 1, "one that lists this node is heard back at once");
});

test("a node that starts waits, by the place its number has among 32 and a draw, before it asks everyone where they are, and asks once", () => {
  const firstAsk = (id) => {
    core.begin(0, id, { epoch: 3, seed: 1000 + id, startSync: true });
    for (let t = 0; t <= 11000; t += 10) {
      core.tick(0, t);
      const sent = takeTx(t).filter((f) => f.kind >> 5 === MeshType.Sync && f.dest === 255);
      if (sent.length > 0) {
        let more = 0;
        for (let u = t; u <= 20000; u += 10) { core.tick(0, u); more += takeTx(u).filter((f) => f.kind >> 5 === MeshType.Sync && f.dest === 255).length; }
        return { at: t, more };
      }
    }
    return null;
  };
  const at = (id) => firstAsk(id).at;
  assert.ok(at(1) < 260, `the first number asks at once: ${at(1)} ms`);
  assert.ok(at(9) >= 2400 && at(9) < 2660, `the ninth after eight slots of 300 ms: ${at(9)} ms`);
  assert.ok(at(32) >= 9300 && at(32) < 9560, `the thirty-second at the end of the 9.3 s: ${at(32)} ms`);
  assert.ok(at(33) < 260, "a number above 32 goes round to the first slot");
  assert.equal(firstAsk(5).more, 0, "once");
  core.begin(0, 5, { epoch: 3, seed: 1, startSync: false });
  for (let t = 0; t <= 11000; t += 10) { core.tick(0, t); assert.equal(core.nextTx(0, t), null, "a node told not to ask, asks no one"); }
});

test("the answers a node gives to asks go out one after another at the rate it has, and an answer that would wait longer than the asker does is not sent", () => {
  const answersAt = (perSecond, asks) => {
    core.begin(0, 1, { epoch: 3, seed: 7, answersPerSecond: perSecond });
    for (let k = 0; k < asks; k++) core.receive(0, frame({ kind: packKind(MeshType.Sync), origin: 2 + k, dest: 1, hops: 3, counter: 1, payload: [1, k, 0, 0, 0] }), macOf(2 + k), -60, 0);
    const at = [];
    for (let t = 0; t <= 4000; t += 5) for (let o = core.nextTx(0, t); o; o = core.nextTx(0, t)) { at.push(t); core.txDone(0, true, t); }
    return at;
  };
  const slow = answersAt(4, 10);
  assert.equal(slow.length, 7, "at 4 a second the line is 250 ms apart, and what would wait over 1.5 s is shed");
  for (let i = 1; i < slow.length; i++) assert.ok(slow[i] - slow[i - 1] >= 250 - 20 && slow[i] - slow[i - 1] <= 250 + 20, `the answers are ${slow[i] - slow[i - 1]} ms apart`);
  assert.equal(core.stat(0, "syncShed"), 3);
  const free = answersAt(255, 10);
  assert.equal(free.length, 10);
  assert.ok(Math.max(...free) < 20, "with no limit they all go within the few milliseconds of the spread");
  assert.equal(core.stat(0, "syncShed"), 0);
  const dflt = answersAt(0, 20);
  assert.ok(dflt.length >= 12 && dflt.length < 20, `by default 8 a second: ${dflt.length} of 20 in the 1.5 s the asker waits`);
});

test("an ask is answered by the neighbour it came from even when that neighbour's heartbeat does not list this node: it has not yet had this node's answer to its own ask", () => {
  const n = node({ beatMs: 5000 });
  n.sync();
  const beat = (counter) => frame({ kind: packKind(MeshType.Beat), origin: 9, dest: 255, hops: 0, counter, payload: [0, 0, 0, 0] });
  n.hear(frame({ counter: 1, hops: 3 }));
  core.pop(0);
  n.hear(beat(2));
  n.hear(beat(3));
  assert.equal(core.neighbors(0)[0].listsMe, 2, "the neighbour does not list this node, and the way back by it is given up");
  assert.equal(core.routeTo(0, 9), null);
  takeTx(0);
  const ask = frame({ kind: packKind(MeshType.Sync), origin: 9, dest: 1, hops: 3, counter: 4, payload: [1, 7, 7, 7, 7] });
  n.hear(ask);
  const answers = takeTx(100).filter((f) => f.kind >> 5 === MeshType.Sync);
  assert.equal(answers.length, 1, "it is answered");
  assert.deepEqual([answers[0].dest, answers[0].next], [9, 9], "along the way the ask came, to the neighbour that sent it, and not flooded");
});

test("an ask whose way back cannot be kept, the neighbour it came by being no node this one knows the address of, is answered by flooding to its origin", () => {
  const n = node();
  n.sync();
  const ask = frame({ kind: packKind(MeshType.Sync), origin: 9, dest: 1, hops: 3, counter: 4, payload: [1, 7, 7, 7, 7] });
  n.hear(ask, -60, 0);
  const answers = takeTx(100).filter((f) => f.kind >> 5 === MeshType.Sync);
  assert.equal(answers.length, 1);
  assert.deepEqual([answers[0].dest, answers[0].next], [9, 0], "flooded, with no next hop: the one that asked is reached, and nothing is lost for want of a way");
});

test("an origin heard and not known is asked again after 2 s, 4, 8 and 16 and then every 16, the first two asks the way back to it and the third on flooded", () => {
  core.begin(0, 1, { epoch: 3, seed: 5 });
  core.receive(0, frame({ counter: 1, hops: 3 }), macOf(9), -60, 0);
  const asks = [];
  for (let t = 0; t <= 60000; t += 5) {
    core.tick(0, t);
    for (const f of takeTx(t)) if (f.kind >> 5 === MeshType.Sync && f.dest === 9) asks.push({ at: t, flooded: f.next === 0 });
  }
  assert.deepEqual(asks.slice(0, 4).map((a) => a.flooded), [false, false, true, true], "routed, routed, then flooded");
  for (let k = 1; k < asks.length; k++) {
    const gap = asks[k].at - asks[k - 1].at, base = 1000 << Math.min(k, 4);
    assert.ok(gap >= base - 10 && gap <= base * 1.5 + 10, `ask ${k + 1} came ${gap} ms after the one before: ${base} ms and a draw of up to half as much`);
  }
  assert.ok(asks.length >= 5 && asks.length <= 7, `${asks.length} asks in a minute`);
});
