// The mesh clock of the ESP-NOW mesh core (tasmota/include/espnow_mesh_core.h, compiled to WebAssembly): the relative clock and the timelines that
// the alarm's order rule stands on, checked against the reference model of that
// rule (alarm-merge-ref.mjs: TimelineNode), which is what the core has to do case by case.
//
//   A  the heartbeat: what it carries, the bytes that are the node's and the ones that are the application's, the 32 bytes the budget leaves
//   B  the rules, case by case, against the reference: which timeline is taken, by how much, the rounding of the ticks, the tie of two of the same age,
//      the window of the band that leaves two timelines apart at the first exchange and the persistence that closes it (B3b), two heartbeats that cross
//      and make the two nodes pass each other (B3c), following a greater time inside a timeline, the limit of an hour, and what is not a clock at all
//   C  a house of nodes with crystals of +-40 ppm: the whole house restarting at once, a node restarting, a lone node meeting an old house, a house
//      split in three groups that drift apart for 17 days and join again, with the loss of the air, and groups of nodes that start within a few tens of ms
//      of each other, each pair with a delay of its own, which the band alone leaves in two timelines for minutes
//   D  the stamp and the age: the 32-bit arithmetic across the 497 days a stamp wraps in, and the checks of the rule that Berry runs on them
//   E  the same on the simulated air, collisions and the repetition of the other frames included
//   F  no wall clock: nothing of the result depends on one
//
// The house of C is the core's nodes over a bus that carries only their heartbeats (what the clock rides on), each node on a counter of its own that
// runs fast or slow by its crystal's ppm; every receiving node is mirrored by a reference node that is given the same heartbeat at the same time, and the
// two have to agree on the timeline, the time, the synced bit and the event, at every step. The reference is the alarm's (alarm-merge-ref.mjs, TimelineNode)
// with the two refinements that the core has and the alarm's does not (ClockRef, below): the time of a node never goes back, and a timeline of a lower
// identity that is just beyond the band is taken after three heartbeats in a row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MeshAir, MeshCore, MeshType, MeshSub, ClockEventKind, MESH, packKind, macOf } from "../dist/index.js";
import { TimelineNode, tlEq, tlCmp, tlTag, encodeStamp, stampCommand, admitCommand, ADOPT_EPS_MS, LISTEN_MS, RESYNC_MAX_MS, TICK_MS, STAMP_TICK_MS, FRESH_WINDOW_MS, FUTURE_TOLERANCE_MS } from "./alarm-merge-ref.mjs";
import { mulberry32 } from "./alarm-merge-world.mjs";

const core = await MeshCore.load();

// --- helpers ----------------------------------------------------------------------------------------------------------

const hexOf = (b) => Buffer.from(b).toString("hex");
const be32 = (b, o) => (((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
const be48 = (b, o) => ((b[o] << 8) | b[o + 1]) * 2 ** 32 + be32(b, o + 2);
const tlBytes = (tl) => [tl.n, (tl.e >>> 24) & 255, (tl.e >>> 16) & 255, (tl.e >>> 8) & 255, tl.e & 255];
const tlOf = (b) => ({ n: b[0], e: be32(b, 1) });
const tlHex = (tl) => hexOf(tlBytes(tl));
const day = 86_400_000;

// The core is the rule of the alarm (TimelineNode.hear) in every decision of one heartbeat, with two refinements that the alarm's reference, written for the order of the
// alarm's records and not for the clock of nodes that start together, does not have; ClockRef is the reference with them:
//   - the time of a node never goes back. The reference moves the clock by the difference in taking a timeline, which for one of a lower identity within the band can be negative,
//     up to 20 ms back; the core moves it by the difference when that is positive and only changes the name when it is not. A move back of up to 20 ms is no ticks of the alarm's
//     marks, so the alarm cannot tell them apart; and without it the nodes of two groups that see each other at the band take the timelines of one another in turn (C12), each time
//     moving back by up to the band and then forward by more than the band;
//   - a timeline of a lower identity that is behind the node's by more than the band and by no more than 100 ms is taken when three heartbeats in a row of the same neighbour have
//     shown it. Each side sees the difference of two timelines greater or smaller than it is by what the frames take in its own direction, so for two of about the same age the node
//     of the higher identity can see the lower one's behind it by more than the band while that one sees the other's within it, and neither takes the other's (the window that B3
//     measures, as wide as the two delays together): the crystals take minutes to move the pair out of it. The decision of one heartbeat is the reference's, and what the third
//     does is B3b.
class ClockRef extends TimelineNode {
  static WIDE_MS = 100;
  static WIDE_BEATS = 3;
  constructor(...args) {
    super(...args);
    this.last = new Map();                       // the timeline of the last heartbeat of each neighbour
    this.hold = new Map();                       // the heartbeats of each neighbour in a row that show a timeline to be taken
  }
  hear(h, up) {
    const d = h.mesh - this.mesh(up);
    const from = h.from;
    const prev = this.last.get(from);
    this.last.set(from, h.tl);
    if (!(prev && tlEq(prev, h.tl))) this.hold.set(from, 0);
    if (tlEq(h.tl, this.tl)) {
      this.hold.set(from, 0);
      if (d > 0 && d <= RESYNC_MAX_MS) this.off += d;
      return { adopted: false, delta: 0 };
    }
    let take = d > ADOPT_EPS_MS || (d >= -ADOPT_EPS_MS && tlCmp(h.tl, this.tl) < 0);
    if (!take && tlCmp(h.tl, this.tl) < 0 && d >= -ClockRef.WIDE_MS) {
      const count = Math.min(255, (this.hold.get(from) ?? 0) + 1);
      this.hold.set(from, count);
      take = count >= ClockRef.WIDE_BEATS;
    } else if (!take) {
      this.hold.set(from, 0);
    }
    if (!take) return { adopted: false, delta: 0 };
    const old = this.tl;
    const step = Math.max(d, 0);
    this.off += step;
    this.tl = { ...h.tl };
    this.adopted = true;
    this.hold.clear();
    this._translate(old, step);
    return { adopted: true, delta: step };
  }
}

// a reference node on the timeline [id, epoch], its own, as a run of the node starts it
const refNode = (id, epoch) => {
  const n = new ClockRef(id, { epoch: epoch - 1, ctr: 0 });
  n.startLife({ epochOk: true });
  return n;
};

// the heartbeat of a node, as bytes the core takes: origin `origin`, `info` the application's bytes, numbered `counter`
let beatCounter = 0;
const beatFrame = (origin, info, { epoch = 5, counter = ++beatCounter, hears = [] } = {}) => {
  const payload = [MeshSub.Beat, 0, info.length, ...info, hears.length, ...hears.flatMap((h) => [h, 0xc4])];
  return core.encode({ kind: packKind(MeshType.Beat), origin, dest: MESH.TO_ALL, next: 0, hops: 0, epoch, counter, payload }, true);
};
// the 20 bytes of the application's part of a heartbeat that has a clock in it
const clockInfo = (tl, mesh, { flags = 0, len = 20, fill = 0 } = {}) => {
  const info = new Array(len).fill(fill);
  info[0] = 1;
  tlBytes(tl).forEach((b, i) => { info[1 + i] = b; });
  for (let i = 0; i < 6; i++) info[6 + i] = Math.floor(mesh / 2 ** (8 * (5 - i))) & 255;
  info[19] = flags;
  return info;
};
// the application's bytes in the heartbeat a node sent: a frame of the beat type and the beat's sub-type, with no cipher on
const infoOf = (bytes) => Array.from(bytes.slice(MESH.HEADER + 3, MESH.HEADER + 3 + bytes[MESH.HEADER + 2]));
const isBeat = (bytes) => (bytes[1] >> 5) === MeshType.Beat && bytes[MESH.HEADER] === MeshSub.Beat;

// A node alone on a slot of the core: begun, its clock started at the counter's 0 (the first call arms it)
const lone = (slot, id, epoch, opt = {}) => {
  core.begin(slot, id, { epoch, seed: 17 + id, clock: true, beatMs: 5000, ...opt });
  core.tick(slot, 0);
};
// carries a node's counter to `upMs` in steps a 32-bit counter can follow (it wraps in 49.7 days, and the core follows a counter that is called at least
// every 24 days), as a node that runs for a year is: the ticks it gets are what the task's loop gives it, every few ms
const advance = (slot, fromMs, toMs) => {
  let up = fromMs;
  while (up < toMs) {
    up = Math.min(toMs, up + 2_000_000_000);
    core.tick(slot, up >>> 0);
  }
  return up;
};

// --- the house ---------------------------------------------------------------------------------------------------------

class House {
  /** `reach(a, b)`: whether b hears a (the nodes of one group by default) */
  constructor({ beatMs = 5000, seed = 1, loss = 0, lat = [1, 7], latFor = null, reach = (a, b) => a.group === b.group } = {}) {
    this.reach = reach;
    this.latFor = latFor;                 // (sender, receiver) -> the ms a heartbeat of the sender takes to the receiver, in place of a draw within `lat`
    this.beatMs = beatMs;
    this.loss = loss;
    this.lat = lat;
    this.rng = mulberry32(seed);
    this.nodes = [];
    this.t = 0;                         // the true time, ms
    this.mismatch = [];                 // where the core and the reference differ
    this.taken = [];                    // the timelines taken: { t, id, from, to, delta, ticks }
    this.synced = [];                   // the nodes that became synced: { t, id }
    this.beats = 0;
    this.lost = 0;
  }

  node(id) { return this.nodes.find((n) => n.id === id); }
  /** a node's own counter, ms: it runs at its crystal's ppm, from the instant it started */
  local(n, t) { return Math.floor((t - n.boot) * (1 + n.ppm * 1e-6)) >>> 0; }

  /** a node of the house, started at the true time `at` (it is off until then) */
  add(id, { ppm = 0, group = 0, at = this.t } = {}) {
    const n = { id, slot: this.nodes.length, ppm, group, epoch: 0, boot: at, bootAt: at, on: false, ref: null };
    this.nodes.push(n);
    return n;
  }

  /** the node starts: a new run, under the next epoch, whose clock begins at 0; the others know where it is, as they do once they have asked */
  start(n, at) {
    n.epoch += 1;
    n.boot = at;
    n.on = true;
    core.begin(n.slot, n.id, { epoch: n.epoch, seed: 1 + n.id * 7919 + n.epoch * 31, clock: true, beatMs: this.beatMs, tagged: true });
    core.tick(n.slot, 0);
    n.ref = refNode(n.id, n.epoch);
    for (const o of this.nodes) {
      if (o === n) continue;
      if (o.epoch > 0) core.synced(o.slot, n.id, n.epoch, 0);
      if (o.on) core.synced(n.slot, o.id, o.epoch, 0);
    }
  }

  /** a node restarts at `at` (power cut and back at once, or after `delayMs`) */
  restart(n, at) {
    n.on = false;
    n.bootAt = at;
  }

  say(text) { this.mismatch.push(`t=${Math.round(this.t)}: ${text}`); }

  /** one instant: every running node ticks, and what the heartbeats it queued say is heard by the nodes it reaches, a few ms later */
  step(t) {
    this.t = t;
    for (const n of this.nodes) if (!n.on && n.bootAt <= t) this.start(n, n.bootAt);
    const out = [];
    for (const n of this.nodes) {
      if (!n.on) continue;
      const L = this.local(n, t);
      core.tick(n.slot, L);
      this.collect(n, null);
      for (let o = core.nextTx(n.slot, L); o; o = core.nextTx(n.slot, L)) {
        core.txDone(n.slot, true, L);
        if (isBeat(o.bytes)) { this.checkSent(n, o.bytes, L); out.push([n, o.bytes]); }
      }
    }
    for (const [a, bytes] of out) this.deliver(a, bytes, t);
  }

  /** what the clock of a node told its application, taken as it comes; `res` is what the reference made of the heartbeat that came with it */
  collect(r, res, was = null) {
    const events = [];
    for (let e = core.popClockEvent(r.slot); e; e = core.popClockEvent(r.slot)) events.push(e);
    const left = events.filter((e) => e.kind === ClockEventKind.Timeline);
    for (const e of events.filter((x) => x.kind === ClockEventKind.Synced)) {
      this.synced.push({ t: this.t, id: r.id });
      if (!e.synced) this.say(`node ${r.id} told it is not synced`);
    }
    if (res?.adopted) {
      if (left.length !== 1) { this.say(`node ${r.id} took a timeline and the core told ${left.length}`); return; }
      const e = left[0];
      const want = { from: tlBytes(was), to: tlBytes(r.ref.tl), delta: res.delta, ticks: Math.round(res.delta / TICK_MS) | 0 };
      if (hexOf(e.from) !== hexOf(want.from) || hexOf(e.to) !== hexOf(want.to) || e.delta !== want.delta || e.ticks !== want.ticks) {
        this.say(`node ${r.id}: the event is ${hexOf(e.from)} ${hexOf(e.to)} ${e.delta} ${e.ticks}, the reference says ${hexOf(want.from)} ${hexOf(want.to)} ${want.delta} ${want.ticks}`);
      }
      this.taken.push({ t: this.t, id: r.id, from: tlHex(was), to: tlHex(r.ref.tl), delta: e.delta, ticks: e.ticks });
    } else if (left.length > 0) {
      this.say(`node ${r.id}: a timeline taken that the reference did not take`);
    }
  }

  /** what the sender said is what its own clock was when the heartbeat was made */
  checkSent(a, bytes, La) {
    const info = infoOf(bytes);
    if (info[0] !== 1 || hexOf(info.slice(1, 6)) !== tlHex(a.ref.tl) || be48(info, 6) !== a.ref.mesh(La) || (info[19] & 1) !== (a.ref.isSynced(La) ? 1 : 0)) {
      this.say(`node ${a.id} sent ${hexOf(info.slice(0, 12))} flags ${info[19]}, its reference clock is ${tlHex(a.ref.tl)} ${a.ref.mesh(La)} ${a.ref.isSynced(La)}`);
    }
  }

  deliver(a, bytes, t) {
    const info = infoOf(bytes);
    const hello = { tl: tlOf(info.slice(1, 6)), mesh: be48(info, 6), from: a.id };
    for (const r of this.nodes) {
      if (r === a || !r.on || !this.reach(a, r)) continue;
      this.beats++;
      if (this.loss > 0 && this.rng() < this.loss) { this.lost++; continue; }
      const lat = this.latFor ? this.latFor(a, r) : this.lat[0] + Math.floor(this.rng() * (this.lat[1] - this.lat[0] + 1));
      const Lr = this.local(r, t + lat);
      const was = { ...r.ref.tl };
      core.receive(r.slot, bytes, macOf(a.id), -60, Lr);
      const res = r.ref.hear(hello, Lr);
      this.collect(r, res, was);
    }
  }

  /** every node's clock against its reference's */
  check() {
    for (const n of this.nodes) {
      if (!n.on) continue;
      const L = this.local(n, this.t);
      const c = core.clock(n.slot, L);
      const want = { tl: tlHex(n.ref.tl), mesh: n.ref.mesh(L), synced: n.ref.isSynced(L), adopted: n.ref.adopted };
      if (hexOf(c.timeline) !== want.tl || c.mesh !== want.mesh || c.synced !== want.synced || c.adopted !== want.adopted) {
        this.say(`node ${n.id}: the core has ${hexOf(c.timeline)} ${c.mesh} ${c.synced} ${c.adopted}, the reference ${want.tl} ${want.mesh} ${want.synced} ${want.adopted}`);
      }
    }
  }

  /** steps of `spacing` ms to `untilT`, the last one shorter when it has to be */
  run(untilT, spacing, { every = 1 } = {}) {
    let i = 0;
    for (let t = this.t; t < untilT;) {
      t = Math.min(untilT, t + spacing);
      this.step(t);
      if (++i % every === 0) this.check();
    }
  }

  clockOf(n) { return core.clock(n.slot, this.local(n, this.t)); }
  /** the mesh time of every running node of a group (or of all), now */
  times(group = null) { return this.nodes.filter((n) => n.on && (group === null || n.group === group)).map((n) => this.clockOf(n).mesh); }
  spread(group = null) { const t = this.times(group); return Math.max(...t) - Math.min(...t); }
  timelines(group = null) { return new Set(this.nodes.filter((n) => n.on && (group === null || n.group === group)).map((n) => hexOf(this.clockOf(n).timeline))); }
  /** nobody disagrees with the reference, and every event matched */
  assertSound() { assert.deepEqual(this.mismatch.slice(0, 6), [], `${this.mismatch.length} places where the core and the reference differ`); }
}

// =================================================================================================================================
// A. the heartbeat
// =================================================================================================================================

test("a heartbeat with the clock on carries the layout, the timeline, the 48-bit time and the synced bit, and is 20 bytes of the application's when it gave none", () => {
  lone(0, 7, 0xdeadbeef);
  const beats = [];
  for (let t = 100; t <= 16_000; t += 100) {
    core.tick(0, t);
    for (let o = core.nextTx(0, t); o; o = core.nextTx(0, t)) { core.txDone(0, true, t); if (isBeat(o.bytes)) beats.push({ t, info: infoOf(o.bytes) }); }
  }
  assert.ok(beats.length >= 3, `${beats.length} heartbeats`);
  const first = beats[0], last = beats.at(-1);
  assert.equal(first.info.length, 20);
  assert.equal(first.info[0], 1, "the layout");
  assert.deepEqual(first.info.slice(1, 6), [7, 0xde, 0xad, 0xbe, 0xef], "the node's number and its epoch, most significant byte first");
  assert.equal(be48(first.info, 6), first.t, "the time it was made at: the time since the clock started");
  assert.equal(first.info[19] & 1, 0, "not synced yet");
  assert.deepEqual(first.info.slice(12, 19), [0, 0, 0, 0, 0, 0, 0], "the bytes the application did not give are 0");
  assert.equal(be48(last.info, 6), last.t);
  assert.equal(last.info[19] & 1, 1, "10 s later it has found no timeline to take, and is synced");
});

test("the application's bytes are kept as it gave them, up to the 32 of the budget, except the 12 the clock fills in and the synced bit; with the clock off nothing is touched", () => {
  lone(0, 7, 3);
  core.setInfo(0, new Array(32).fill(0xaa));
  core.tick(0, 6000);
  let got = null;
  for (let t = 6100; t < 12_000 && !got; t += 100) { core.tick(0, t); for (let o = core.nextTx(0, t); o; o = core.nextTx(0, t)) { core.txDone(0, true, t); if (isBeat(o.bytes)) got = o.bytes; } }
  const info = infoOf(got);
  assert.equal(info.length, 32, "all 32 go, and the heartbeat's layout is the budget exactly");
  assert.ok(info.slice(12, 19).every((b) => b === 0xaa) && info.slice(20).every((b) => b === 0xaa), "bytes 12 to 18 and 20 to 31 are the application's");
  assert.equal(info[0], 1, "the layout is the node's");
  assert.equal(info[19], 0xaa, "and the flags are the application's, with the synced bit the node's: 0xaa has it clear, and the node is not synced here");
  core.setInfo(0, new Array(40).fill(0xff));
  let more = null;
  for (let t = 12_000; t < 20_000 && !more; t += 100) { core.tick(0, t); for (let o = core.nextTx(0, t); o; o = core.nextTx(0, t)) { core.txDone(0, true, t); if (isBeat(o.bytes)) more = o.bytes; } }
  assert.equal(infoOf(more).length, 32, "more than 32 is cut at 32");
  assert.equal(infoOf(more)[19], 0xff, "and with the node synced the bit is set");
  core.setInfo(0, [7, 8, 9]);
  let short = null;
  for (let t = 20_000; t < 28_000 && !short; t += 100) { core.tick(0, t); for (let o = core.nextTx(0, t); o; o = core.nextTx(0, t)) { core.txDone(0, true, t); if (isBeat(o.bytes)) short = o.bytes; } }
  const s = infoOf(short);
  assert.equal(s.length, 20, "3 bytes are made 20, up to the flags");
  assert.equal(s[0], 1, "the clock's over the first of them");
  assert.deepEqual(s.slice(12, 19), [0, 0, 0, 0, 0, 0, 0]);
  // the clock off: the bytes go as they are, and a clock in a heartbeat is not read
  lone(1, 8, 3, { clock: false });
  core.setInfo(1, [7, 8, 9]);
  core.synced(1, 9, 5, 0);
  core.tick(1, 6000);
  let plain = null;
  for (let t = 6100; t < 12_000 && !plain; t += 100) { core.tick(1, t); for (let o = core.nextTx(1, t); o; o = core.nextTx(1, t)) { core.txDone(1, true, t); if (isBeat(o.bytes)) plain = o.bytes; } }
  assert.deepEqual(infoOf(plain), [7, 8, 9], "the clock off: the application's bytes as they were");
  assert.equal(core.receive(1, beatFrame(9, clockInfo({ n: 9, e: 1 }, 99_999_999)), macOf(9), -60, 6_000), "accepted");
  assert.equal(core.clock(1, 6_000).adopted, false, "and the clock in a heartbeat it hears does not move it");
  assert.equal(core.neighbors(1, 6000)[0].clockSeen, 0);
});

test("a heartbeat of another layout, or with fewer than 20 bytes, is no clock: nothing is taken from it", () => {
  const other = { n: 9, e: 1 };
  for (const [what, info] of [["layout 2", (() => { const i = clockInfo(other, 50_000_000); i[0] = 2; return i; })()], ["19 bytes", clockInfo(other, 50_000_000).slice(0, 19)], ["no bytes", []], ["3 bytes", [1, 2, 3]]]) {
    lone(0, 1, 5);
    core.synced(0, 9, 5, 0);
    core.tick(0, 1000);
    assert.equal(core.receive(0, beatFrame(9, info), macOf(9), -60, 1000), "accepted", what);
    assert.equal(core.clock(0, 1000).adopted, false, `${what}: not adopted`);
    assert.equal(core.popClockEvent(0), null, `${what}: no event`);
    assert.equal(core.neighbors(0, 1000)[0].clockSeen, 0, `${what}: its heartbeat carried no clock`);
  }
});

test("a heartbeat with a clock in it, and 31 neighbours, is the 32 bytes of the budget and fits a frame with room to spare", () => {
  lone(0, 7, 3);
  core.setInfo(0, new Array(32).fill(1));
  for (let n = 10; n < 41; n++) { core.synced(0, n, 5, 0); core.receive(0, beatFrame(n, clockInfo({ n, e: 5 }, 100), { counter: 1 }), macOf(n), -60, 100); }
  let beat = null;
  for (let t = 200; t < 8000 && !beat; t += 100) { core.tick(0, t); for (let o = core.nextTx(0, t); o; o = core.nextTx(0, t)) { core.txDone(0, true, t); if (isBeat(o.bytes)) beat = o.bytes; } }
  // header 14, sub-type, flags, length, 32 bytes, a count, 31 neighbours of 2 bytes, the tag 8
  assert.equal(beat.length, 14 + 3 + 32 + 1 + 62 + 8, "the heartbeat of a node with 31 neighbours");
  assert.ok(beat.length < MESH.MAX_FRAME - 100, `${beat.length} bytes of the 250`);
});

// =================================================================================================================================
// B. the rules, case by case, against the reference
// =================================================================================================================================

// one node, `ageMs` into its own run, hears one heartbeat; the reference node does the same
const meet = ({ mine = { n: 5, e: 3 }, ageMs = 50_000, theirs, theirMesh, flags = 0 }) => {
  core.begin(0, mine.n, { epoch: mine.e, seed: 3, clock: true, beatMs: 5000 });
  core.tick(0, 0);
  core.tick(0, ageMs);
  core.synced(0, 9, 5, 0);
  const ref = refNode(mine.n, mine.e);
  const verdict = core.receive(0, beatFrame(9, clockInfo(theirs, theirMesh, { flags })), macOf(9), -60, ageMs);
  const res = ref.hear({ tl: theirs, mesh: theirMesh }, ageMs);
  const events = [];
  for (let e = core.popClockEvent(0); e; e = core.popClockEvent(0)) events.push(e);
  return { verdict, res, ref, events, clock: core.clock(0, ageMs), neighbor: core.neighbors(0, ageMs)[0] };
};

test("a node takes the timeline of the one that has been up longer, by the difference, and tells its application: the same as the reference in every case", () => {
  const ages = 50_000;
  const rows = [];
  for (const d of [-5_000_000, -1000, -21, -20, -19, -1, 0, 1, 19, 20, 21, 5000, 999_999, 5_000_000_000, 2 ** 40]) {
    for (const theirs of [{ n: 3, e: 9 }, { n: 5, e: 2 }, { n: 5, e: 3 }, { n: 5, e: 4 }, { n: 7, e: 1 }]) {
      const r = meet({ ageMs: ages, theirs, theirMesh: ages + d >= 0 ? ages + d : 0 });
      const delta = Math.max((ages + d >= 0 ? ages + d : 0) - ages, 0);       // the time never goes back: a tie that is behind moves the name and not the clock
      assert.equal(r.verdict, "accepted");
      assert.equal(r.clock.adopted, r.res.adopted, `d=${d} ${tlHex(theirs)}`);
      assert.equal(hexOf(r.clock.timeline), tlHex(r.ref.tl), `d=${d} ${tlHex(theirs)}: the timeline`);
      assert.equal(r.clock.mesh, r.ref.mesh(ages), `d=${d} ${tlHex(theirs)}: the time`);
      assert.equal(r.clock.synced, r.ref.isSynced(ages), `synced d=${d}`);
      if (r.res.adopted) {
        assert.equal(r.events.filter((e) => e.kind === ClockEventKind.Timeline).length, 1);
        const e = r.events.find((x) => x.kind === ClockEventKind.Timeline);
        assert.equal(e.delta, delta, `d=${d}: the difference in ms, none when the timeline is behind`);
        assert.equal(e.ticks, Math.round(delta / TICK_MS) | 0, `d=${d}: the ticks of 100 ms, rounded as the reference rounds them`);
        assert.equal(hexOf(e.from), "0500000003");
        assert.equal(hexOf(e.to), tlHex(theirs));
        assert.equal(e.synced, true, "a node that took a timeline is synced");
      } else {
        assert.equal(r.events.filter((e) => e.kind === ClockEventKind.Timeline).length, 0, `d=${d} ${tlHex(theirs)}: no event`);
      }
      rows.push(`${d}:${tlHex(theirs).slice(0, 2)}${tlHex(theirs).slice(-2)}=${r.res.adopted ? "T" : "-"}`);
    }
  }
  assert.ok(rows.some((x) => x.endsWith("=T")) && rows.some((x) => x.endsWith("=-")), "both outcomes were exercised");
});

test("the rounding of the ticks: the nearest, and up from half; no move is ever negative, in ms or in ticks, because the time of a node never goes back; and a move beyond 32 bits of ticks is its low 32 bits", () => {
  const ageMs = 10_000_000;
  const cases = [[21, 0], [49, 0], [50, 1], [51, 1], [149, 1], [150, 2], [1049, 10], [1050, 11], [123_456_789, 1_234_568], [2 ** 40 + 51, Math.round((2 ** 40 + 51) / 100) | 0], [2 ** 44, Math.round(2 ** 44 / 100) | 0]];
  for (const [d, ticks] of cases) {
    const r = meet({ mine: { n: 5, e: 3 }, ageMs, theirs: { n: 1, e: 1 }, theirMesh: ageMs + d });
    const e = r.events.find((x) => x.kind === ClockEventKind.Timeline);
    assert.ok(e, `d=${d}: taken`);
    assert.equal(e.ticks, ticks, `d=${d}`);
    assert.equal(e.delta, d);
    assert.equal(ticks, Math.round(d / TICK_MS) | 0, `the table agrees with the reference's rounding at ${d}`);
  }
  // the band: a timeline of a lower identity within 20 ms, of either sign, is taken, and the move is 0 ticks; an older one beyond it, and a younger one beyond it, are what they were
  for (const d of [-20, -19, -1, 0, 1, 19, 20]) {
    const r = meet({ mine: { n: 5, e: 3 }, ageMs, theirs: { n: 1, e: 1 }, theirMesh: ageMs + d });
    const e = r.events.find((x) => x.kind === ClockEventKind.Timeline);
    assert.ok(e, `d=${d}: taken: the same age, and a lower identity`);
    assert.equal(e.ticks, 0, `d=${d}`);
    assert.equal(e.delta, Math.max(d, 0), "and the clock moves by the ms when the timeline is ahead, and not at all when it is behind: a clock does not go back in taking a timeline");
    assert.ok(e.delta >= 0, "ever");
    assert.ok(r.clock.mesh >= ageMs, "and the node's time is where it was or later");
  }
  for (const d of [-21, -50, -1000, -5_000_000]) {
    const r = meet({ mine: { n: 5, e: 3 }, ageMs, theirs: { n: 1, e: 1 }, theirMesh: ageMs + d });
    assert.equal(r.events.filter((x) => x.kind === ClockEventKind.Timeline).length, 0, `d=${d}: the younger is not taken, whatever its identity`);
  }
});

test("two timelines of the same age, within 20 ms, settle on one: whoever hears first, the node of the higher identity takes the lower; and the window in which they do not, which the band leaves where the latency of the two directions adds to the gap", (t) => {
  const pairs = [[{ n: 2, e: 9 }, { n: 5, e: 4 }], [{ n: 5, e: 4 }, { n: 2, e: 9 }], [{ n: 7, e: 1 }, { n: 3, e: 6 }], [{ n: 3, e: 6 }, { n: 7, e: 1 }]];
  const cmp = (x, y) => (x.n - y.n) || (x.e - y.e);
  let settled = 0, apart = 0, exact = 0;
  const window = [];
  for (const gap of [0, 1, 7, 15, 19, 20, 21, 25, 27, 28, 40]) {
    for (const l1 of [0, 3, 7]) {
      for (const l2 of [0, 3, 7]) {
        for (const [older, younger] of pairs) {
          // `older` has run `gap` ms longer; the younger's heartbeat reaches the older after l1 ms, and the older's the younger after l2
          const ageB = 10_000, ageA = ageB + gap;
          const A = refNode(older.n, older.e), B = refNode(younger.n, younger.e);
          const rA = A.hear({ tl: younger, mesh: ageB }, ageA + l1), rB = B.hear({ tl: older, mesh: ageA }, ageB + l2);
          core.begin(0, older.n, { epoch: older.e, seed: 5, clock: true, beatMs: 5000 });
          core.begin(1, younger.n, { epoch: younger.e, seed: 6, clock: true, beatMs: 5000 });
          core.tick(0, 0); core.tick(1, 0); core.tick(0, ageA); core.tick(1, ageB);
          core.synced(0, younger.n, younger.e, 0); core.synced(1, older.n, older.e, 0);
          core.receive(0, beatFrame(younger.n, clockInfo(younger, ageB), { epoch: younger.e, counter: 1 }), macOf(younger.n), -60, ageA + l1);
          core.receive(1, beatFrame(older.n, clockInfo(older, ageA), { epoch: older.e, counter: 1 }), macOf(older.n), -60, ageB + l2);
          const cA = core.clock(0, ageA + l1), cB = core.clock(1, ageB + l2);
          const where = `gap ${gap} l1 ${l1} l2 ${l2} ${tlHex(older)} older than ${tlHex(younger)}`;
          assert.equal(cA.adopted, rA.adopted, `${where}: the older`);
          assert.equal(cB.adopted, rB.adopted, `${where}: the younger`);
          assert.equal(hexOf(cA.timeline), tlHex(A.tl), where);
          assert.equal(hexOf(cB.timeline), tlHex(B.tl), where);
          assert.equal(cA.mesh, A.mesh(ageA + l1), where);
          assert.equal(cB.mesh, B.mesh(ageB + l2), where);
          assert.ok(!(rA.adopted && rB.adopted), `${where}: never both: they would pass each other`);
          const together = hexOf(cA.timeline) === hexOf(cB.timeline);
          assert.equal(together, rA.adopted || rB.adopted, where);
          // what the band is meant to do: no gap of 20 ms or less leaves two timelines, when the frames take no time; and when the older has the lower identity the
          // younger always takes it
          if (l1 === 0 && l2 === 0 && gap <= ADOPT_EPS_MS) assert.ok(together, `${where}: settled`);
          if (cmp(older, younger) < 0) assert.ok(together, `${where}: the older has the lower identity: the younger takes it`);
          // and the window the analysis gives: the older has the higher identity, and the two directions disagree on whose turn it is
          const predicted = cmp(older, younger) > 0 && gap + l1 > ADOPT_EPS_MS && gap - l2 <= ADOPT_EPS_MS;
          assert.equal(!together, predicted, `${where}: apart exactly in the window (20 - l1, 20 + l2]`);
          if (together) settled++; else { apart++; window.push(`${gap}/${l1}/${l2}`); }
          exact++;
        }
      }
    }
  }
  assert.equal(ADOPT_EPS_MS, 20, "the band is the 20 ms of the decision");
  assert.ok(settled > apart && apart > 0, "both outcomes were exercised");
  t.diagnostic(`${exact} meetings of two timelines within 40 ms: ${settled} settle on one at the first exchange, ${apart} do not (the older has the higher identity and gap + latency of its direction passes 20 ms while gap - latency of the other does not reach it)`);
});

const cmpId = (x, y) => (x.n - y.n) || (x.e - y.e);

test("B3b the window closes: two timelines the band leaves apart at the first exchange are one at the third heartbeat of each, the time of neither node ever goes back, and the core is the reference at every step", (t) => {
  const pairs = [[{ n: 2, e: 9 }, { n: 5, e: 4 }], [{ n: 3, e: 6 }, { n: 7, e: 1 }], [{ n: 1, e: 1 }, { n: 40, e: 3 }]];
  let windows = 0, closed = 0, runs = 0;
  const lastRound = [];
  for (const gap of [0, 7, 14, 17, 20, 21, 24, 27, 28, 31, 40, 80, 99, 120]) {
    for (const l1 of [1, 4, 7]) {
      for (const l2 of [1, 4, 7]) {
        for (const [low, high] of pairs) {
          // the older node has the higher identity: the case the window of the band is in; `l1` is what the heartbeat of the younger takes to the older, `l2` the other way
          const ageB = 10_000, ageA = ageB + gap;
          const refs = [refNode(high.n, high.e), refNode(low.n, low.e)];
          const who = [high, low], ages = [ageA, ageB], slots = [0, 1];
          core.begin(0, high.n, { epoch: high.e, seed: 5, clock: true, beatMs: 5000 });
          core.begin(1, low.n, { epoch: low.e, seed: 6, clock: true, beatMs: 5000 });
          core.tick(0, 0); core.tick(1, 0); core.tick(0, ageA); core.tick(1, ageB);
          core.synced(0, low.n, low.e, 0); core.synced(1, high.n, high.e, 0);
          const delay = [l1, l2];                       // the delay a heartbeat takes to node 0 (from node 1) and to node 1 (from node 0)
          let counter = 0;
          let apartAfterFirst = null;
          for (let round = 0; round < 3; round++) {
            const at = round * 5000;
            // both heartbeats are made at `at`, with the timeline and the time each node has then, and are heard after their delays
            const made = slots.map((i) => { const c = core.clock(i, ages[i] + at); return { tl: tlOf(c.timeline), mesh: c.mesh }; });
            counter += 1;
            const heard = [[0, 1], [1, 0]].map(([to, from]) => ({ to, from, when: ages[to] + at + delay[to] }));
            for (const ev of heard.sort((x, y) => x.when - y.when)) {
              const before = core.clock(ev.to, ev.when).mesh;
              core.receive(ev.to, beatFrame(who[ev.from].n, clockInfo(made[ev.from].tl, made[ev.from].mesh), { epoch: who[ev.from].e, counter }), macOf(who[ev.from].n), -60, ev.when);
              refs[ev.to].hear({ tl: made[ev.from].tl, mesh: made[ev.from].mesh, from: who[ev.from].n }, ev.when);
              const c = core.clock(ev.to, ev.when);
              const where = `gap ${gap} l1 ${l1} l2 ${l2} round ${round} node ${who[ev.to].n}`;
              assert.equal(hexOf(c.timeline), tlHex(refs[ev.to].tl), `${where}: the timeline is the reference's`);
              assert.equal(c.mesh, refs[ev.to].mesh(ev.when), `${where}: the time is the reference's`);
              assert.ok(c.mesh >= before, `${where}: the time did not go back (${before} to ${c.mesh})`);
            }
            if (round === 0) apartAfterFirst = hexOf(core.clock(0, ageA + 100).timeline) !== hexOf(core.clock(1, ageB + 100).timeline);
          }
          const together = hexOf(core.clock(0, ageA + 20_000).timeline) === hexOf(core.clock(1, ageB + 20_000).timeline);
          runs++;
          if (apartAfterFirst) {
            windows++;
            assert.ok(cmpId(high, low) > 0 && gap + l1 > ADOPT_EPS_MS && gap - l2 <= ADOPT_EPS_MS, `the window is where the analysis puts it: gap ${gap} l1 ${l1} l2 ${l2}`);
          }
          assert.ok(together, `gap ${gap} l1 ${l1} l2 ${l2} ${tlHex(high)} and ${tlHex(low)}: one timeline after three heartbeats`);
          if (apartAfterFirst && together) closed++;
          lastRound.push(core.stat(0, "timelinesTaken") + core.stat(1, "timelinesTaken"));
        }
      }
    }
  }
  assert.ok(windows > 0 && closed === windows, `${windows} meetings were left apart by the first exchange, and all ${closed} were one timeline after the third`);
  assert.ok(Math.max(...lastRound) <= 2, "and the two nodes took no more than a timeline each");
  t.diagnostic(`${runs} meetings of two timelines up to 120 ms apart: ${windows} left apart by the first exchange (the older has the higher identity and gap + delay passes 20 ms while gap - delay does not), all one timeline by the third`);
});

test("B3c two nodes whose heartbeats cross just as the count of the older one is complete take each other's timelines at once, and are one timeline at the next heartbeat: no loop, at most two timelines taken by a node, the time of neither going back", (t) => {
  const high = { n: 5, e: 4 }, low = { n: 2, e: 9 };
  let swaps = 0, runs = 0;
  for (const gap of [22, 23, 24, 25, 26, 27]) {
    for (const crossAt of [2]) {
      // the older node A has the higher identity: it sees the younger one's timeline behind its own by gap + 7 ms at each heartbeat and counts them; the younger one B sees the older's
      // ahead by gap - 7 ms (within the band) and does not take it, until the heartbeat of A that is heard after 1 ms and not after 7: it sees gap - 1 ms, which passes the band
      const ageB = 10_000, ageA = ageB + gap;
      const refs = [refNode(high.n, high.e), refNode(low.n, low.e)];
      const who = [high, low], ages = [ageA, ageB];
      core.begin(0, high.n, { epoch: high.e, seed: 5, clock: true, beatMs: 5000 });
      core.begin(1, low.n, { epoch: low.e, seed: 6, clock: true, beatMs: 5000 });
      core.tick(0, 0); core.tick(1, 0); core.tick(0, ageA); core.tick(1, ageB);
      core.synced(0, low.n, low.e, 0); core.synced(1, high.n, high.e, 0);
      let counter = 0;
      const took = [0, 0];
      for (let round = 0; round < crossAt + 3; round++) {
        const at = round * 5000;
        const made = [0, 1].map((i) => { const c = core.clock(i, ages[i] + at); return { tl: tlOf(c.timeline), mesh: c.mesh }; });
        counter += 1;
        // the heartbeat of A reaches B after 7 ms, but in the round of the crossing after 1; the heartbeat of B reaches A after 7 ms
        const delay = [7, round === crossAt ? 1 : 7];
        const arrivals = [[0, 1], [1, 0]].map(([to, from]) => ({ to, from, when: ages[to] + at + delay[to] }));
        // both heartbeats were made before either is heard: the one heard first does not change what the other said
        for (const ev of arrivals.sort((x, y) => (x.when - ages[x.to]) - (y.when - ages[y.to]))) {
          const before = core.clock(ev.to, ev.when).mesh;
          const taken0 = core.stat(ev.to, "timelinesTaken");
          core.receive(ev.to, beatFrame(who[ev.from].n, clockInfo(made[ev.from].tl, made[ev.from].mesh), { epoch: who[ev.from].e, counter }), macOf(who[ev.from].n), -60, ev.when);
          refs[ev.to].hear({ tl: made[ev.from].tl, mesh: made[ev.from].mesh, from: who[ev.from].n }, ev.when);
          const c = core.clock(ev.to, ev.when);
          const where = `gap ${gap} cross at ${crossAt} round ${round} node ${who[ev.to].n}`;
          assert.equal(hexOf(c.timeline), tlHex(refs[ev.to].tl), `${where}: the timeline is the reference's`);
          assert.equal(c.mesh, refs[ev.to].mesh(ev.when), `${where}: the time is the reference's`);
          assert.ok(c.mesh >= before, `${where}: the time did not go back`);
          took[ev.to] += core.stat(ev.to, "timelinesTaken") - taken0;
        }
        const a = hexOf(core.clock(0, ages[0] + at + 100).timeline), b = hexOf(core.clock(1, ages[1] + at + 100).timeline);
        if (round === crossAt) {
          assert.equal(a, tlHex(low), `gap ${gap}: the older took the timeline of the younger, which its third heartbeat showed`);
          assert.equal(b, tlHex(high), `gap ${gap}: and the younger took the older's, which the heartbeat that crossed it showed: they passed each other`);
          swaps++;
        } else if (round > crossAt) {
          assert.equal(a, b, `gap ${gap} cross at ${crossAt}: one timeline at the heartbeat after the crossing`);
        }
      }
      runs++;
      assert.deepEqual(took, [1, 2], `gap ${gap}: the older took one timeline, the younger two (the older's and then the lower back)`);
      assert.equal(hexOf(core.clock(0, ages[0] + 40_000).timeline), tlHex(low), "and it is the lower identity's");
    }
  }
  t.diagnostic(`${runs} meetings in which the heartbeats of the two cross at the third one: ${swaps} passed each other (A to the younger's timeline, B to the older's) and every one was one timeline at the next heartbeat, the lower identity's, by two timelines taken by the younger node and one by the older`);
});

test("inside one timeline a node follows a greater time heard, up to an hour, and never goes back; a step is counted and no event is told", () => {
  const same = { n: 5, e: 3 };
  const ageMs = 2_000_000;
  for (const [d, follows] of [[1, true], [50, true], [RESYNC_MAX_MS, true], [RESYNC_MAX_MS + 1, false], [0, false], [-1, false], [-900_000, false]]) {
    const r = meet({ ageMs, theirs: same, theirMesh: ageMs + d });
    assert.equal(r.clock.mesh, ageMs + (follows ? d : 0), `d=${d}`);
    assert.equal(r.clock.mesh, r.ref.mesh(ageMs), "as the reference does");
    assert.equal(r.clock.adopted, false, "no timeline was taken");
    assert.equal(r.events.filter((e) => e.kind === ClockEventKind.Timeline).length, 0);
    assert.equal(r.neighbor.clockSeen, 2, "the neighbour is in this node's timeline");
    assert.equal(r.neighbor.clockSkew, Math.max(-32768, Math.min(32767, d)), `d=${d}: the skew its heartbeat had, held within 16 bits`);
  }
  assert.equal(RESYNC_MAX_MS, 3_600_000);
  // the steps are counted, and each one is a change of the clock the application can see
  core.begin(0, 5, { epoch: 3, seed: 3, clock: true, beatMs: 5000 });
  core.tick(0, 0);
  core.synced(0, 9, 5, 0);
  const v0 = core.clock(0, 100).version;
  core.receive(0, beatFrame(9, clockInfo(same, 150)), macOf(9), -60, 100);
  assert.equal(core.stat(0, "clockSteps"), 1);
  assert.ok(core.clock(0, 100).version > v0, "the version of the clock moved");
  core.receive(0, beatFrame(9, clockInfo(same, 100)), macOf(9), -60, 100 + 100 - 50);
  assert.equal(core.stat(0, "clockSteps"), 1, "a time that is not greater is not a step");
});

test("the clock never reads anything but the counter it is given: it follows a counter that wraps in 49.7 days, goes on past 2^32 ms and past the 497 days a stamp wraps in", () => {
  lone(0, 5, 3);
  let up = 0;
  const mesh = [];
  for (const target of [1_000_000, 2_000_000_000, 4_000_000_000, 6_000_000_000, 12_000_000_000, 43_000_000_000, 43_000_001_000]) {
    up = advance(0, up, target);
    mesh.push(core.clock(0, up >>> 0).mesh);
    assert.equal(mesh.at(-1), target, `the time at ${target} ms is ${mesh.at(-1)}`);
  }
  // a beat made now carries the 48 bits whole (what was queued while the counter was carried is as old as the time it was made at)
  core.tick(0, up >>> 0);
  for (let o = core.nextTx(0, up >>> 0); o; o = core.nextTx(0, up >>> 0)) core.txDone(0, true, up >>> 0);
  let got = null;
  for (let t = up + 100; t < up + 8000 && !got; t += 100) { core.tick(0, t >>> 0); for (let o = core.nextTx(0, t >>> 0); o; o = core.nextTx(0, t >>> 0)) { core.txDone(0, true, t >>> 0); if (isBeat(o.bytes)) got = { t, info: infoOf(o.bytes) }; } }
  assert.equal(be48(got.info, 6), got.t, "43e9 ms in 48 bits");
  assert.ok(got.t > 2 ** 32, "which is more than 32");
  // a counter value from a moment ago, read after a later one, moves nothing back
  const now = core.clock(0, (got.t + 500) >>> 0).mesh;
  core.tick(0, (got.t + 500) >>> 0);
  core.tick(0, (got.t + 400) >>> 0);
  assert.equal(core.clock(0, (got.t + 500) >>> 0).mesh, now, "a value behind the last does not move the clock back");
});

test("a time that cannot be a running node's, 2^47 ms (4 400 years) and more, is not taken, whatever its timeline: the 48 bits it travels in always hold the clock", () => {
  const ageMs = 60_000;
  for (const theirs of [{ n: 1, e: 1 }, { n: 9, e: 9 }]) {
    const r = meet({ ageMs, theirs, theirMesh: 2 ** 47 });
    assert.equal(r.clock.adopted, false, "not taken");
    assert.equal(r.clock.mesh, ageMs);
    assert.equal(r.events.filter((e) => e.kind === ClockEventKind.Timeline).length, 0);
    assert.equal(r.neighbor.clockSeen, 0, "and it is no clock");
    const big = meet({ ageMs, theirs, theirMesh: 2 ** 48 - 1 });
    assert.equal(big.clock.adopted, false);
  }
  const edge = meet({ ageMs, theirs: { n: 9, e: 9 }, theirMesh: 2 ** 47 - 1 });
  assert.equal(edge.clock.adopted, true, "just under it, it is taken");
  assert.equal(edge.clock.mesh, 2 ** 47 - 1);
  // the same timeline: no step either
  const same = meet({ ageMs, theirs: { n: 5, e: 3 }, theirMesh: 2 ** 47 });
  assert.equal(same.clock.mesh, ageMs);
});

// =================================================================================================================================
// C. a house, with crystals
// =================================================================================================================================

const PPM = [38.1, -35.4, 12.2, -40, 27.7, -3.3, 39.9, -21, 5.5, -33.3, 18, -8.1, 31.2, -26.4];

test("the whole house restarts at once: every node, on a crystal of its own, ends in one timeline, the oldest node's, and what the core does is what the reference does", (t) => {
  const results = [];
  for (let seed = 1; seed <= 12; seed++) {
    const h = new House({ seed });
    const rng = mulberry32(seed * 31);
    const boots = [];
    for (let id = 1; id <= 14; id++) {
      const at = 1000 + Math.floor(rng() * 3000);
      boots.push({ id, at });
      h.add(id, { ppm: PPM[id - 1], at });
    }
    h.run(60_000, 100);
    h.assertSound();
    assert.equal(h.timelines().size, 1, `seed ${seed}: one timeline after 60 s: ${[...h.timelines()].join(" ")}`);
    const oldest = boots.reduce((a, b) => (b.at < a.at ? b : a));
    const second = boots.filter((b) => b !== oldest).reduce((a, b) => (b.at < a.at ? b : a));
    const winner = h.node(oldest.id);
    if (second.at - oldest.at > 2 * ADOPT_EPS_MS) {
      assert.equal([...h.timelines()][0], tlHex(winner.ref.tl), `seed ${seed}: the oldest node's timeline: node ${oldest.id}`);
      assert.deepEqual(winner.ref.tl, { n: oldest.id, e: 1 }, "which is its own");
      assert.equal(h.taken.filter((x) => x.id === oldest.id).length, 0, "and it took nothing");
    }
    assert.ok(h.nodes.every((n) => h.clockOf(n).synced), "every node is synced");
    assert.ok(h.spread() < 20, `seed ${seed}: the clocks of the house are within ${h.spread()} ms of each other`);
    results.push({ seed, spread: h.spread(), taken: h.taken.length, oldest: oldest.id });
  }
  t.diagnostic(`12 restarts of 14 nodes: spread of the clocks after 60 s ${Math.max(...results.map((r) => r.spread))} ms at most; timelines taken ${results.map((r) => r.taken).join(",")}`);
});

test("a whole house that restarts in the same millisecond settles on the timeline of the lowest number, whichever order the heartbeats come in", () => {
  const winners = new Set();
  for (let seed = 1; seed <= 20; seed++) {
    const h = new House({ seed, lat: [1, 7] });
    for (let id = 1; id <= 8; id++) h.add(id, { ppm: PPM[id - 1], at: 1000 });
    h.run(40_000, 100);
    h.assertSound();
    assert.equal(h.timelines().size, 1, `seed ${seed}`);
    winners.add([...h.timelines()][0]);
  }
  assert.equal(winners.size, 1, `the same timeline every time: ${[...winners].join(" ")}`);
  assert.equal([...winners][0], "0100000001", "node 1's, the lowest number, as the 20 ms band decides");
});

test("a node that restarts is in a timeline of its own until it hears the others, and takes theirs: its time is theirs by its first heartbeat, and the others stay where they are", (t) => {
  const h = new House({ seed: 3 });
  for (let id = 1; id <= 6; id++) h.add(id, { ppm: PPM[id - 1], at: 100 });
  h.run(3 * 3_600_000, 5600, { every: 50 });
  h.assertSound();
  const house = [...h.timelines()][0];
  const before = h.nodes.filter((n) => n.id !== 4).map((n) => h.clockOf(n));
  // node 4 loses its power and comes back after 20 s: its epoch is one higher, its time starts at 0
  const t0 = h.t + 3000;
  h.node(4).group = 9;                                                 // out of reach for the instant of the restart: no heartbeat of the house can be heard in it
  h.restart(h.node(4), t0);
  h.step(t0);
  const fresh = h.clockOf(h.node(4));
  assert.equal(hexOf(fresh.timeline), "0400000002", "its own timeline, node 4, epoch 2");
  assert.equal(fresh.synced, false, "not synced");
  assert.equal(core.stamp(h.node(4).slot, h.local(h.node(4), h.t)), null, "and no stamp to give");
  h.node(4).group = 0;
  const taken0 = h.taken.length;
  let heardAt = null;
  for (let k = 1; k <= 400 && heardAt === null; k++) { h.step(t0 + 100 * k); h.check(); if (h.clockOf(h.node(4)).adopted) heardAt = 100 * k; }
  assert.ok(heardAt !== null && heardAt <= 6000, `node 4 took the house's timeline ${heardAt} ms after it started`);
  assert.equal(hexOf(h.clockOf(h.node(4)).timeline), house, "the house's");
  assert.equal(h.clockOf(h.node(4)).synced, true, "and it is synced from the moment it took it");
  assert.equal(h.taken.length, taken0 + 1, "one timeline taken, by node 4");
  const e = h.taken.at(-1);
  assert.equal(e.id, 4);
  assert.ok(Math.abs(e.delta - 3 * 3_600_000) < 15_000, `the move is the house's age: ${e.delta} ms for a house up for ${3 * 3_600_000}`);
  for (const n of h.nodes.filter((x) => x.id !== 4)) assert.equal(hexOf(h.clockOf(n).timeline), house, `node ${n.id} stayed in the house's timeline`);
  const after = h.nodes.filter((n) => n.id !== 4).map((n) => h.clockOf(n));
  after.forEach((c, i) => assert.ok(c.mesh >= before[i].mesh, "no clock of the house went back"));
  h.assertSound();
  assert.ok(h.spread() < 20, `and the clocks agree within ${h.spread()} ms`);
  t.diagnostic(`node 4 took the timeline of a house up for 3 h ${heardAt} ms after it started, by ${e.delta} ms (${e.ticks} ticks)`);
});

test("a node that restarts twice before it meets anybody is in a third timeline, and the house still counts on its own", () => {
  const h = new House({ seed: 4 });
  for (let id = 1; id <= 4; id++) h.add(id, { ppm: PPM[id - 1], at: 100 });
  h.run(600_000, 5600);
  const house = [...h.timelines()][0];
  const n4 = h.node(4);
  // cut off: node 4 on a group of its own, restarts, and again 30 s later, before the house hears it
  n4.group = 9;
  h.restart(n4, h.t + 1000);
  h.run(h.t + 30_000, 500);
  h.restart(n4, h.t + 500);
  h.run(h.t + 5000, 500);
  assert.equal(hexOf(h.clockOf(n4).timeline), "0400000003", "its own, the third");
  assert.equal(h.clockOf(n4).adopted, false);
  assert.notEqual(hexOf(h.clockOf(n4).timeline), house);
  // it hears the house again
  n4.group = 0;
  const takenBefore = h.taken.length;
  h.run(h.t + 20_000, 500);
  h.assertSound();
  assert.equal(h.timelines().size, 1);
  assert.equal([...h.timelines()][0], house, "the house's timeline is the one everybody counts on");
  assert.deepEqual(h.taken.slice(takenBefore).map((x) => [x.id, x.from]), [[4, "0400000003"]], "node 4 took it, from the third timeline, and nobody else moved");
});

test("the oldest node of a house that restarts is the one that was not restarted: a house that has been up takes in the nodes that come back, whichever one they hear first", () => {
  const h = new House({ seed: 5 });
  for (let id = 1; id <= 10; id++) h.add(id, { ppm: PPM[id - 1], at: 100 });
  h.run(86_400_000, 56_000, { every: 40 });
  const house = [...h.timelines()][0];
  // four nodes, among them the lowest number, restart at different times; the rest of the house goes on
  const rng = mulberry32(77);
  for (const id of [1, 6, 7, 3]) h.restart(h.node(id), h.t + 1000 + Math.floor(rng() * 30_000));
  h.run(h.t + 120_000, 100);
  h.assertSound();
  assert.equal(h.timelines().size, 1);
  assert.equal([...h.timelines()][0], house, "the house's own, whose root is node 1 of the first run, which is gone: the timeline outlives its node");
  assert.ok(h.taken.length >= 4, `${h.taken.length} timelines taken, one by each node that came back`);
  assert.ok(h.nodes.every((n) => h.clockOf(n).synced));
});

test("nodes that start within a few tens of ms of each other, each pair with a delay of its own in each direction, end in one timeline, no node takes more timelines than there are nodes, and the core is the reference at every step: the band alone leaves some of them in two for minutes", (t) => {
  const report = [];
  for (const [n, spread, seeds] of [[2, 40, 40], [3, 40, 40], [6, 40, 40], [15, 200, 30]]) {
    let slowest = 0, mostTaken = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const rng = mulberry32(seed * 7919 + n);
      const delay = new Map();
      const h = new House({ seed, latFor: (a, r) => { const k = a.id * 64 + r.id; if (!delay.has(k)) delay.set(k, 1 + Math.floor(rng() * 7)); return delay.get(k); } });
      const pool = Array.from({ length: 40 }, (_, i) => i + 1);
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      let lastBoot = 0;
      for (const id of pool.slice(0, n)) {
        const at = 1000 + Math.floor(rng() * (spread + 1));
        lastBoot = Math.max(lastBoot, at);
        h.add(id, { ppm: (rng() * 2 - 1) * 40, at });
      }
      h.run(90_000, 100);
      h.assertSound();
      assert.equal(h.timelines().size, 1, `${n} nodes, seed ${seed}: one timeline after 90 s: ${[...h.timelines()].join(" ")}`);
      for (const node of h.nodes) {
        const took = h.taken.filter((x) => x.id === node.id).length;
        mostTaken = Math.max(mostTaken, took);
        assert.ok(took <= n - 1, `${n} nodes, seed ${seed}: node ${node.id} took ${took} timelines`);
      }
      const lastTaken = Math.max(0, ...h.taken.map((x) => x.t));
      slowest = Math.max(slowest, lastTaken - lastBoot);
      assert.ok(lastTaken - lastBoot < 30_000, `${n} nodes, seed ${seed}: the last timeline was taken ${lastTaken - lastBoot} ms after the last start`);
    }
    report.push(`${n} nodes within ${spread} ms: ${seeds} runs, one timeline each, the last one taken ${(slowest / 1000).toFixed(1)} s after the last start at the most, ${mostTaken} timelines at the most by a node`);
  }
  t.diagnostic(report.join("; "));
});

// a house of 14 in a row, each node hearing the two on each side: the oldest timeline gets from one end to the other a hop of 2 nodes at a heartbeat, and the loss
// of the air makes it wait for the next
for (const loss of [0, 0.05, 0.1, 0.15]) {
  test(`with ${loss * 100}% of the heartbeats lost, a house in a row that restarts at once settles on one timeline, the oldest node's, and the clocks agree`, (t) => {
    const settle = [];
    const ends = [];
    for (let seed = 1; seed <= 12; seed++) {
      const h = new House({ seed: 100 + seed, loss, reach: (a, b) => Math.abs(a.id - b.id) <= 2 });
      const rng = mulberry32(seed * 13);
      const boots = [];
      for (let id = 1; id <= 14; id++) { const at = 500 + Math.floor(rng() * 2500); boots.push({ id, at }); h.add(id, { ppm: PPM[id - 1], at }); }
      let when = null;
      for (let k = 1; k <= 3000; k++) {
        h.step(3000 + 100 * k);
        if (when === null && h.nodes.every((n) => n.on) && h.timelines().size === 1 && h.nodes.every((n) => h.clockOf(n).synced)) when = 100 * k;
        if (k % 25 === 0) h.check();
      }
      h.check();
      h.assertSound();
      assert.notEqual(when, null, `seed ${seed}: one timeline within 300 s`);
      assert.ok(when <= 150_000, `seed ${seed}: settled after ${when} ms`);
      assert.equal(h.timelines().size, 1);
      assert.ok(h.spread() < 40, `seed ${seed}: ${h.spread()} ms apart in the end, the 13 hops of the row`);
      // each neighbour is within a few ms of the next
      let worst = 0;
      for (let i = 1; i < 14; i++) worst = Math.max(worst, Math.abs(h.clockOf(h.node(i)).mesh - h.clockOf(h.node(i + 1)).mesh));
      assert.ok(worst < 15, `seed ${seed}: the neighbours are within ${worst} ms`);
      ends.push(h.spread());
      settle.push(when);
      assert.ok(loss === 0 || h.lost > 0, "the loss was applied");
      const oldest = boots.reduce((a, b) => (b.at < a.at ? b : a));
      const second = boots.filter((b) => b !== oldest).reduce((a, b) => (b.at < a.at ? b : a));
      if (second.at - oldest.at > 2 * ADOPT_EPS_MS + 14) assert.equal([...h.timelines()][0], `${hexOf([oldest.id])}00000001`, `seed ${seed}: the oldest node's`);
    }
    const sorted = [...settle].sort((a, b) => a - b);
    t.diagnostic(`loss ${loss * 100}%: a row of 14 settled after ${sorted[0] / 1000} to ${sorted.at(-1) / 1000} s (median ${sorted[6] / 1000} s); the clocks of the row end within ${Math.max(...ends)} ms of each other`);
  });
}

test("C6b the same with the 14 nodes all hearing each other, 5 to 15% lost: the house settles in one heartbeat or two, whatever the loss", (t) => {
  for (const loss of [0.05, 0.1, 0.15]) {
    const settle = [];
    for (let seed = 1; seed <= 12; seed++) {
      const h = new House({ seed: 200 + seed, loss });
      const rng = mulberry32(seed * 17);
      for (let id = 1; id <= 14; id++) h.add(id, { ppm: PPM[id - 1], at: 500 + Math.floor(rng() * 2500) });
      let when = null;
      for (let k = 1; k <= 600; k++) {
        h.step(3000 + 100 * k);
        if (when === null && h.nodes.every((n) => n.on) && h.timelines().size === 1 && h.nodes.every((n) => h.clockOf(n).synced)) when = 100 * k;
        if (k % 20 === 0) h.check();
      }
      h.assertSound();
      assert.ok(when !== null && when <= 45_000, `loss ${loss} seed ${seed}: settled after ${when}`);
      assert.ok(h.spread() < 20);
      settle.push(when);
    }
    t.diagnostic(`loss ${loss * 100}%, all hearing all: settled after ${Math.min(...settle) / 1000} to ${Math.max(...settle) / 1000} s`);
  }
});

test("crystals of +-40 ppm over 30 days of heartbeats keep the whole house within a few ms of each other; left alone they would be minutes apart", (t) => {
  const h = new House({ seed: 7 });
  for (let id = 1; id <= 8; id++) h.add(id, { ppm: PPM[id - 1], at: 100 });
  h.step(100);
  const bare = (id) => Math.floor((30 * day) * (1 + PPM[id - 1] * 1e-6));
  let worst = 0;
  const gaps = [];
  for (let d = 1; d <= 30; d++) {
    h.run(h.t + day, 60_600, { every: 500 });
    worst = Math.max(worst, h.spread());
    gaps.push(h.spread());
  }
  h.assertSound();
  assert.ok(worst < 10, `the clocks were never more than ${worst} ms apart at the end of a day`);
  assert.ok(Math.max(...[1, 2, 3, 4, 5, 6, 7, 8].map(bare)) - Math.min(...[1, 2, 3, 4, 5, 6, 7, 8].map(bare)) > 200_000, "without heartbeats the fastest and the slowest crystals are more than 200 s apart in 30 days");
  assert.equal(h.taken.length, 7, "one timeline in the house, taken by the 7 nodes that were not the root");
  t.diagnostic(`30 days, 8 nodes, 60 s heartbeats: the clocks were never more than ${worst} ms apart; bare crystals ${Math.max(...[1, 2, 3, 4, 5, 6, 7, 8].map(bare)) - Math.min(...[1, 2, 3, 4, 5, 6, 7, 8].map(bare))} ms apart`);
});

// The house that splits in three groups for 17 days (after 17 days of isolation a translated mark carries about 90 s of the drift of
// the crystals): two of the groups lose their power meanwhile and come back in timelines of their own, and each takes the oldest one when they meet, by the difference of
// the clocks at that moment, which is the true difference of the ages of the two runs plus the drift of the days. The core and the reference are given the same heartbeats
// and agree to the millisecond; here the numbers are put against the physics of the crystals.
const GROUPS = { 1: [1, 2, 3], 2: [4, 5], 3: [6, 7, 8] };
const GROUP_PPM = { 1: 35.2, 2: -10.4, 3: 20.1, 4: -38.2, 5: 5.0, 6: 30.3, 7: -40, 8: 12.6 };

const splitHouse = (t, { restarts }) => {
  const h = new House({ seed: 8 });
  for (const ids of Object.values(GROUPS)) for (const id of ids) h.add(id, { ppm: GROUP_PPM[id], group: 0, at: 100 + id * 10 });
  h.run(3_600_000, 5600, { every: 100 });
  h.assertSound();
  const house = [...h.timelines()][0];
  const splitAt = h.t;
  for (const [g, ids] of Object.entries(GROUPS)) for (const id of ids) h.node(id).group = Number(g);
  const gaps = [];
  const isolated = (until) => { while (h.t < until) { h.run(Math.min(until, h.t + day), 60_600, { every: 700 }); gaps.push([1, 2, 3].map((g) => h.spread(g))); } };
  if (restarts) {
    isolated(splitAt + 2 * day);
    for (const id of GROUPS[2]) h.restart(h.node(id), h.t + 1000 + id * 30);
    isolated(splitAt + 9 * day);
    for (const id of GROUPS[3]) h.restart(h.node(id), h.t + 1000 + id * 30);
  }
  isolated(splitAt + 17 * day);
  h.assertSound();
  return { h, house, gaps, splitAt };
};

test("a house split in three groups for 17 days, two of them restarted meanwhile, joins again: each takes the oldest timeline by the difference of the ages and the drift of those days, as the reference does, and the clocks agree within 10 ms after", (t) => {
  const { h, house, gaps } = splitHouse(t, { restarts: true });
  const tl = (g) => [...h.timelines(g)];
  assert.ok([1, 2, 3].every((g) => tl(g).length === 1), "one timeline in each group");
  assert.equal(tl(1)[0], house, "the group that never restarted is still in the house's timeline");
  assert.notEqual(tl(2)[0], house);
  assert.notEqual(tl(3)[0], house);
  assert.notEqual(tl(2)[0], tl(3)[0]);
  const within = Math.max(...gaps.flat());
  assert.ok(within < 10, `inside each group the clocks were never more than ${within} ms apart while the groups were cut off`);
  const reads = [1, 2, 3].map((g) => Math.max(...h.times(g)));
  t.diagnostic(`just before the join the three groups' clocks read ${reads.map((m) => (m / day).toFixed(5)).join(", ")} days`);

  // they hear each other again
  const takenBefore = h.taken.length;
  for (const n of h.nodes) n.group = 0;
  h.run(h.t + 90_000, 5600);
  h.assertSound();
  assert.equal(h.timelines().size, 1, "one timeline after the join");
  assert.equal([...h.timelines()][0], house, "the oldest: the group 1's");
  const moved = h.taken.slice(takenBefore);
  assert.deepEqual(moved.map((m) => m.id).filter((id, i, a) => a.indexOf(id) === i).sort((a, b) => a - b), [4, 5, 6, 7, 8], "the five nodes of the two groups that restarted, and no other, took it");
  assert.ok(moved.every((m) => m.to === house), "each of them took the oldest timeline");

  // the move of a node is the root group's time at the meeting less its own group's: each group runs at the pace of its fastest crystal, the others following it
  const lead = (ids) => Math.max(...ids.map((i) => GROUP_PPM[i])) * 1e-6;
  const rows = [];
  for (const m of moved.filter((x, i) => moved.findIndex((y) => y.id === x.id) === i)) {
    const g = Number(Object.entries(GROUPS).find(([, ids]) => ids.includes(m.id))[0]);
    const n = h.node(m.id);
    // from when the group's clock has run: its nodes restarted together, at most a few hundred ms apart
    const start = Math.min(...GROUPS[g].map((i) => h.node(i).boot));
    const meetAt = h.t - 90_000;                                  // the instant of the join, to within a round
    const rootGroupAge = (meetAt - h.node(1).boot) * (1 + lead(GROUPS[1]));
    const ownGroupAge = (meetAt - start) * (1 + lead(GROUPS[g]));
    const trueDiff = n.boot - h.node(1).boot;                     // what the move would be with exact clocks
    rows.push({ id: m.id, g, delta: m.delta, trueDiff, drift: m.delta - trueDiff, analytic: rootGroupAge - ownGroupAge });
  }
  for (const r of rows) {
    assert.ok(Math.abs(r.delta - r.analytic) < 12_000, `node ${r.id}: the move ${r.delta} ms is the analytic ${Math.round(r.analytic)} ms within the span of the join (one round of 5.6 s and the lag of the group's followers)`);
    assert.ok(Math.abs(r.drift) < 17 * day * 85e-6 + 1000, `node ${r.id}: ${(r.drift / 1000).toFixed(1)} s off the true difference of the ages, at most the drift of 17 days at 85 ppm`);
  }
  assert.ok(rows.some((r) => Math.abs(r.drift) > 20_000), "the drift of the days is tens of seconds in the translation, as the reference says (E10: about 90 s at 76 ppm over 17 days)");
  assert.ok(h.spread() < 10, `after the join the 8 clocks are within ${h.spread()} ms of each other`);
  assert.ok(h.nodes.every((n) => h.clockOf(n).synced));
  t.diagnostic(`the moves of the nodes that took the timeline: ${rows.map((r) => `node ${r.id} ${(r.delta / 1000).toFixed(1)} s (the ages differ by ${(r.trueDiff / 1000).toFixed(1)} s: ${(r.drift / 1000).toFixed(1)} s of drift)`).join("; ")}; after the join the 8 clocks are ${h.spread()} ms apart`);
});

test("the same split without a restart, all in one timeline: the groups' clocks are a minute apart after 17 days, and the join follows the fastest by that step, to within 10 ms, with no event for the application", (t) => {
  const { h, house } = splitHouse(t, { restarts: false });
  assert.equal(h.timelines().size, 1, "one timeline in the whole house all along");
  const reads = [1, 2, 3].map((g) => Math.max(...h.times(g)));
  const apart = Math.max(...reads) - Math.min(...reads);
  const expected = (Math.max(...[1, 2, 3].map((g) => Math.max(...GROUPS[g].map((i) => GROUP_PPM[i])))) - Math.min(...[1, 2, 3].map((g) => Math.max(...GROUPS[g].map((i) => GROUP_PPM[i]))))) * 1e-6 * 17 * day;
  assert.ok(Math.abs(apart - expected) < 400, `the groups read ${apart} ms apart, by the drift of 17 days at the paces of their fastest crystals ${Math.round(expected)} ms`);
  const takenBefore = h.taken.length;
  for (const n of h.nodes) n.group = 0;
  h.run(h.t + 90_000, 5600);
  h.assertSound();
  assert.equal(h.taken.length, takenBefore, "no timeline was taken: the application is told nothing, and the marks it made in these 17 days stay as they are");
  assert.ok(h.spread() < 10, `after the join the clocks are within ${h.spread()} ms of each other`);
  assert.equal([...h.timelines()][0], house);
  t.diagnostic(`17 days apart at 60 s heartbeats: the groups' clocks read ${apart} ms apart (${(apart / 1000).toFixed(1)} s, the reference's drift of 7 s a day at 80 ppm between two crystals, here at ${((expected / 17 / day) * 1e6).toFixed(1)} ppm); the join stepped the slow ones forward to the fastest, after it ${h.spread()} ms`);
});

// =================================================================================================================================
// D. the stamp and the age
// =================================================================================================================================

// the checks of the rule on a stamp that Berry makes (the core gives the time, the tag, the synced bit and the age; it does not decide), as the reference's admitCommand decides them
const berryVerdict = ({ synced, sameTimeline, ageMs }, window = FRESH_WINDOW_MS) => {
  if (!synced) return "owner-not-synced";
  if (!sameTimeline) return "other-timeline";
  if (ageMs > window) return "stale";
  if (ageMs < -FUTURE_TOLERANCE_MS) return "from-the-future";
  return "ok";
};

test("the tag of a timeline and the stamp of a message are the reference's, byte for byte; a node that is not synced has none to give", () => {
  for (const [n, e] of [[1, 1], [7, 0xdeadbeef], [254, 0xffffffff], [3, 0x00010000], [15, 0x80000000], [200, 12_345_678], [9, 0], [1, 0x0001ffff]]) {
    lone(0, n, e);
    assert.equal(core.clock(0, 0).tag, tlTag({ n, e }), `[${n}, ${e}]`);
  }
  for (const up of [10_000, 123_456, 50_000_000, 5_000_000_000, 42_949_672_900, 42_949_673_000]) {
    lone(0, 7, 5);
    advance(0, 0, up);
    const ref = refNode(7, 5);
    const bytes = core.stamp(0, up >>> 0);
    const cmd = stampCommand(ref, up, {});
    assert.ok(bytes && cmd, `up ${up}: synced`);
    assert.deepEqual([...bytes], [...encodeStamp(cmd)], `up ${up}: the 6 bytes`);
    assert.equal(bytes.length, 6);
  }
  lone(0, 7, 5);
  core.tick(0, LISTEN_MS - 1);
  assert.equal(core.stamp(0, LISTEN_MS - 1), null, "not synced: no stamp");
  assert.equal(stampCommand(refNode(7, 5), LISTEN_MS - 1, {}), null, "and the reference gives none");
  core.tick(0, LISTEN_MS);
  assert.ok(core.stamp(0, LISTEN_MS), "10 s into the run, with no timeline to take: synced");
});

test("the age of a stamp is the difference of 32 bits with its sign, in ticks of 10 ms, right across the 497 days in which it wraps: the verdict of the checks Berry runs is the reference's", () => {
  let cases = 0;
  const ups = [60_000, 50_000_000, 42_949_672_900];                  // the last one is 60 ms before the stamp wraps
  for (const up of ups) {
    lone(0, 7, 5);
    advance(0, 0, up);
    const ref = refNode(7, 5);
    const now = up >>> 0;
    const c = core.clock(0, now);
    for (const ago of [-100_000, -2_000, -300, -260, -250, -240, -10, 0, 10, 990, 1000, 1010, 2990, 3000, 3010, 60_000, 86_400_000, 2_000_000_000]) {
      for (const tagOk of [true, false]) {
        const issued = Math.floor((up - ago) / STAMP_TICK_MS) >>> 0;
        const cmd = { tag: tlTag(ref.tl) ^ (tagOk ? 0 : 1), issued };
        const a = core.age(0, encodeStamp(cmd), now);
        const want = admitCommand(ref, cmd, up);
        const got = berryVerdict({ synced: c.synced, sameTimeline: a.sameTimeline, ageMs: a.ageMs });
        assert.equal(got, want.reason, `up ${up}, ${ago} ms ago, tag ${tagOk}`);
        if (want.ageMs !== undefined) assert.equal(a.ageMs, want.ageMs, `up ${up}, ${ago} ms ago: the age`);
        cases++;
      }
    }
    // a stamp is checked at the time it is read, not when its frame came: the age of the same stamp grows with the counter, and a clock read at another point works the same
    const stamp = core.stamp(0, now);
    assert.equal(core.age(0, stamp, now).ageMs, 0);
    assert.equal(core.age(0, stamp, now + 1234).ageMs, 1230, "1234 ms later: 1230, in ticks of 10 ms");
    assert.equal(core.age(0, stamp, now + 1234, now).ageMs, 1230, "from a point of the clock taken before, as the task of the driver makes it for the main loop");
  }
  // not synced
  lone(0, 7, 5);
  core.tick(0, 5000);
  const a = core.age(0, encodeStamp({ tag: core.clock(0, 5000).tag, issued: 500 }), 5000);
  assert.equal(berryVerdict({ synced: core.clock(0, 5000).synced, sameTimeline: a.sameTimeline, ageMs: a.ageMs }), "owner-not-synced");
  assert.equal(core.age(0, [1, 2, 3, 4, 5], 5000), null, "5 bytes are not a stamp");
  assert.equal(core.age(0, [1, 2, 3, 4, 5, 6, 7], 5000), null, "nor 7");
  // the window of the sensitive: 1 s
  lone(0, 7, 5);
  advance(0, 0, 100_000);
  for (const [ago, ok] of [[990, true], [1000, true], [1010, false], [3000, false]]) {
    const a2 = core.age(0, encodeStamp({ tag: core.clock(0, 100_000).tag, issued: (100_000 - ago) / 10 }), 100_000);
    assert.equal(berryVerdict({ synced: true, sameTimeline: a2.sameTimeline, ageMs: a2.ageMs }, 1000) === "ok", ok, `${ago} ms ago in a window of 1 s`);
  }
  assert.ok(cases >= 100, `${cases} cases`);
});

test("a stamp made by one node of a house is read by another a few ms later at the age it has: the clocks agree within what the rule's -250 ms and 3 s leave room for", (t) => {
  const run = (name, opt, spacing) => {
    const h = new House({ seed: 31, ...opt });
    for (let id = 1; id <= 14; id++) h.add(id, { ppm: PPM[id - 1], at: 100 });
    h.run(2 * 3_600_000, spacing, { every: 100 });
    h.assertSound();
    assert.equal(h.timelines().size, 1);
    const transit = 14;
    let worst = 0;
    const ages = [];
    for (const a of h.nodes) {
      for (const b of h.nodes) {
        if (a === b) continue;
        const stamp = core.stamp(a.slot, h.local(a, h.t));
        assert.ok(stamp, "a node of a settled house is synced");
        const age = core.age(b.slot, stamp, h.local(b, h.t + transit));
        assert.ok(age.sameTimeline);
        ages.push(age.ageMs);
        worst = Math.max(worst, Math.abs(age.ageMs - transit));
      }
    }
    t.diagnostic(`${name}: stamps between the 14 nodes ${transit} ms apart read ${Math.min(...ages)} to ${Math.max(...ages)} ms (error at most ${worst} ms; the rule leaves 250 ms to the future and 3 s to the past)`);
    return worst;
  };
  assert.ok(run("all hearing all", {}, 5600) <= 30, "the clocks of one hop agree within a tick or two");
  assert.ok(run("a row, each node hearing two on each side", { reach: (a, b) => Math.abs(a.id - b.id) <= 2 }, 5600) <= 40, "and across the 13 hops of a row, within a few tens of ms: the 60 ms the rule budgets");
});

// =================================================================================================================================
// C (continued). a lone node and an old house, with the real start of the node
// =================================================================================================================================

test("a lone node that restarts and meets an old house takes the house's timeline, and is synced only from then: before, it refuses to stamp and tells nothing", () => {
  const h = new House({ seed: 10 });
  for (let id = 1; id <= 5; id++) h.add(id, { ppm: PPM[id - 1], at: 100 });
  h.run(6 * 3_600_000, 56_000, { every: 100 });
  const house = [...h.timelines()][0];
  // node 5 is cut off for a while, loses its power and comes back: still alone, nothing to hear
  const n5 = h.node(5);
  n5.group = 7;
  h.restart(n5, h.t + 500);
  h.step(h.t + 500);
  h.synced.length = 0;                                                 // what was told while the house formed is not what is asked here
  const events = [];
  const poll = () => { for (const e of h.synced.splice(0)) events.push(["synced", e.id]); };
  let before = null;
  for (let k = 1; k <= 90; k++) {                                      // 9 s: it listens, with nobody to hear
    h.step(h.t + 100);
    poll();
    const c = h.clockOf(n5);
    before = c;
    assert.equal(c.synced, false, `${k * 100} ms: not synced`);
    assert.equal(core.stamp(n5.slot, h.local(n5, h.t)), null, "and has no stamp to give");
    assert.equal(c.adopted, false);
  }
  assert.equal(hexOf(before.timeline), "0500000002");
  assert.equal(events.length, 0, "told nothing");
  // it hears the house for the first time at about the 9th second
  n5.group = 0;
  const taken0 = h.taken.length;
  let heardAt = null;
  for (let k = 1; k <= 100 && heardAt === null; k++) { h.step(h.t + 100); poll(); if (h.clockOf(n5).adopted) heardAt = h.t - n5.boot; }
  h.assertSound();
  assert.ok(heardAt !== null && heardAt < 14_000, `it took the house's timeline ${heardAt} ms after it started`);
  assert.equal(hexOf(h.clockOf(n5).timeline), house);
  assert.equal(h.clockOf(n5).synced, true, "synced");
  assert.ok(core.stamp(n5.slot, h.local(n5, h.t)), "and it stamps now");
  assert.deepEqual(events, [["synced", 5]], "the application heard it become synced once, when it took the timeline, not at 10 s");
  assert.equal(h.taken.length, taken0 + 1);
  const e = h.taken.at(-1);
  assert.ok(Math.abs(e.delta - 6 * 3_600_000) < 20_000, `by the house's age: ${e.delta} ms for a house up 6 hours`);
});

test("a node that is alone for good is synced 10 s after it could first hear anyone: from its start when it has no ask to make, from its ask at start when it makes one, which for the node of the 30th number is some 19 s", () => {
  lone(0, 1, 5);                                                       // no ask at start (startSync false)
  core.tick(0, 9_999);
  assert.equal(core.clock(0, 9_999).synced, false);
  core.tick(0, 10_000);
  assert.equal(core.clock(0, 10_000).synced, true);
  assert.equal(core.popClockEvent(0)?.kind, ClockEventKind.Synced);
  assert.equal(core.popClockEvent(0), null, "told once");
  const synced = {};
  for (const id of [1, 8, 30]) {
    core.begin(0, id, { epoch: 5, seed: 40 + id, clock: true, beatMs: 5000, startSync: true });
    core.tick(0, 0);
    let at = null, asked = null;
    for (let t = 1; t <= 40_000 && at === null; t++) {
      core.tick(0, t);
      if (asked === null && core.stat(0, "startAsks") > 0) asked = t;
      for (let o = core.nextTx(0, t); o; o = core.nextTx(0, t)) core.txDone(0, true, t);
      if (core.clock(0, t).synced) at = t;
    }
    synced[id] = { asked, at };
    assert.ok(asked !== null && at - asked >= 9_999 && at - asked <= 10_001, `node ${id}: synced ${at - asked} ms after its ask at ${asked}`);
  }
  assert.ok(synced[1].at < 12_000, `node 1: ${synced[1].at}`);
  assert.ok(synced[30].at > 18_500 && synced[30].at < 19_300, `node 30: ${synced[30].at}`);
});

// =================================================================================================================================
// E. on the simulated air
// =================================================================================================================================

// the house of seven rooms in a row of mesh.test.mjs, two nodes a room, each wall costing 8 dB, with the clock on and the ask at start
const rowHouse = async (opt = {}) => {
  const air = await MeshAir.create({ seed: 21, beatMs: 5000, clock: true, startSync: true, ...opt });
  for (let room = 0; room < 7; room++) {
    air.add(2 * room + 1, room * 6, 0, 5);
    air.add(2 * room + 2, room * 6 + 1.5, 1, 5);
  }
  const roomOf = (n) => Math.floor((n.id - 1) / 2);
  air.geometry(2.2, (a, b) => 8 * Math.abs(roomOf(a) - roomOf(b)));
  air.syncAll();
  return air;
};
const airTimelines = (air) => new Set(air.nodes.map((n) => hexOf(air.clock(n.id).timeline)));

test("on the air, with collisions and the loss of 10%, a house of 14 in a row that restarts at once settles on one timeline, and a node that restarts alone takes the house's", async (t) => {
  const air = await rowHouse({ loss: 0.1 });
  air.run(40_000);
  assert.equal(airTimelines(air).size, 1, "a house that started together is in one timeline after 40 s");
  assert.ok(air.nodes.every((n) => air.clock(n.id).synced));
  const start = [...airTimelines(air)][0];
  const rng = mulberry32(5);
  // the power goes: every node is off for 5 s, so that the old timeline has no node left to carry it, and then they come back, one after another within 3 s
  const order = air.nodes.map((n) => n.id).sort(() => rng() - 0.5);
  for (const n of air.nodes) air.power(n.id, false);
  air.run(5000);
  air.clockEvents.length = 0;
  for (const id of order) { air.run(Math.floor(rng() * 400)); air.restart(id); }
  let settled = null;
  for (let s = 1; s <= 120 && settled === null; s++) {
    air.run(1000);
    if (airTimelines(air).size === 1 && air.nodes.every((n) => air.clock(n.id).synced)) settled = s;
  }
  assert.notEqual(settled, null, "one timeline, all synced, within 120 s");
  assert.notEqual([...airTimelines(air)][0], start, "a new timeline: the house lost its old one when every node restarted");
  const spread = (() => { const m = air.nodes.map((n) => air.clock(n.id).mesh); return Math.max(...m) - Math.min(...m); })();
  assert.ok(spread < 60, `the clocks are within ${spread} ms of each other across the 13 hops`);
  const adoptions = air.clockEvents.filter((e) => e.event.kind === ClockEventKind.Timeline);
  assert.ok(adoptions.length >= 8, `${adoptions.length} timelines taken in the settling`);
  assert.ok(adoptions.every((e) => e.event.synced));
  // a single node restarts: it takes the house's, the others stay
  const house = [...airTimelines(air)][0];
  air.run(30_000);
  air.clockEvents.length = 0;
  const houseAge = air.clock(1).mesh;
  air.restart(9);
  let took = null;
  for (let s = 1; s <= 60 && took === null; s++) { air.run(1000); if (air.clock(9).adopted) took = s; }
  assert.ok(took !== null && took <= 40, `node 9 took the house's timeline ${took} s after it restarted`);
  assert.equal(hexOf(air.clock(9).timeline), house);
  assert.equal(airTimelines(air).size, 1);
  assert.deepEqual(air.clockEvents.filter((e) => e.event.kind === ClockEventKind.Timeline).map((e) => e.node), [9], "and nobody else took a timeline");
  const e = air.clockEvents.find((x) => x.event.kind === ClockEventKind.Timeline).event;
  assert.ok(Math.abs(e.delta - houseAge) < 15_000, `by about the age of the house: ${e.delta} ms, the house was ${houseAge} ms old when the node restarted`);
  t.diagnostic(`on the air: the 14 nodes settled on one timeline ${settled} s after the last restart; the clocks of the row within ${spread} ms; a node that restarted alone took the house's ${took} s later, by ${e.delta} ms`);
});

test("a command stamped by one end of the house is read by the other end with the age it has: none of 100 is refused by K=16 or by the window of 3 s, at 10% loss", async (t) => {
  const air = await rowHouse({ loss: 0.1, startSync: false });
  air.run(60_000);
  assert.equal(airTimelines(air).size, 1);
  const rng = mulberry32(9);
  const waits = [];
  let refused = 0, lostCommands = 0, farthestBehind = 0;
  for (let i = 0; i < 100; i++) {
    const from = rng() < 0.5 ? 1 : 2, to = rng() < 0.5 ? 14 : 13;
    const stamp = air.core.stamp(air.node(from).slot, air.ms);
    assert.ok(stamp, "the origin is synced");
    const key = air.send(from, MeshType.Command, to, [...stamp, 0xc0, i & 255], true);
    air.run(1500);
    const got = air.deliveries.find((d) => d.node === to && `${d.d.origin}:${d.d.epoch}:${d.d.counter}` === key);
    if (!got) { lostCommands++; continue; }
    const d = got.d;
    assert.deepEqual([...d.payload.slice(0, 6)], [...stamp], "the stamp came with the command, as Berry puts it in the payload");
    // the Berry layer of the owner runs it when the frame is handed over: the age is read at that moment, from the clock as it stood then
    const at = Math.floor(got.at / 1000);
    const a = air.core.age(air.node(to).slot, d.payload.slice(0, 6), at);
    const wait = Math.floor((got.at - air.sentAt.get(key)) / 1000);
    waits.push(a.ageMs);
    assert.ok(Math.abs(a.ageMs - wait) <= 40, `the age ${a.ageMs} ms is the time the command took, ${wait} ms, within the clocks' error`);
    farthestBehind = Math.max(farthestBehind, d.behind);
    if (d.behind > 16 || a.ageMs > FRESH_WINDOW_MS || a.ageMs < -FUTURE_TOLERANCE_MS || !a.sameTimeline) refused++;
  }
  assert.equal(refused, 0, "a legitimate command is never refused by the checks");
  assert.ok(lostCommands <= 3, `${lostCommands} of 100 never arrived in 1.5 s (the loss of 10% over 6 hops, with 3 attempts)`);
  const sorted = [...waits].sort((x, y) => x - y);
  t.diagnostic(`100 commands across the row at 10% loss: read ${sorted[0]} to ${sorted.at(-1)} ms old (median ${sorted[Math.floor(sorted.length / 2)]} ms), behind at most ${farthestBehind}; ${lostCommands} lost; ${refused} refused`);
});

// =================================================================================================================================
// F. no wall clock, and the size
// =================================================================================================================================

const here = dirname(fileURLToPath(import.meta.url));
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
// what would read the date or the time of day, in a header that is the firmware's: the C library's, the ESP-IDF's, Tasmota's and the standard library's
const WALL = /\b(time|gettimeofday|clock_gettime|localtime|gmtime|mktime|strftime|settimeofday|esp_timer_get_time|esp_log_timestamp|millis|micros|UtcTime|LocalTime|RtcTime|Rtc|ntp|sntp|chrono|steady_clock|system_clock)\s*[(.:<]/i;

test("the core reads no clock of its own: it includes no header of time, and calls no function that reads the date, the time of day or the counter of the chip", () => {
  const core_h = readFileSync(join(here, "../../../../firmware/tasmota/tasmota/include/espnow_mesh_core.h"), "utf8");
  const code = stripComments(core_h);
  const includes = [...code.matchAll(/#include\s*[<"]([^>"]+)[>"]/g)].map((m) => m[1]);
  assert.deepEqual(includes.sort(), ["stddef.h", "stdint.h", "string.h"], "it needs the types and memcpy, and nothing of time");
  const hit = code.match(WALL);
  assert.equal(hit, null, `the core calls ${hit?.[0]}`);
  // the scan sees what it is meant to see
  assert.ok(WALL.test("uint32_t t = millis();") && WALL.test("auto n = time(nullptr);") && WALL.test("x = UtcTime.year") && WALL.test("std::chrono::steady_clock::now()") && !WALL.test("uint32_t now = clockOff_;"));
});

test("the clock of the driver reads the counter of the task and nothing else: the date and the time of day that Tasmota keeps do not appear in the driver", () => {
  const src = readFileSync(join(here, "../../../../firmware/tasmota/tasmota/tasmota_xdrv_driver/xdrv_98_1_espnow_mesh.ino"), "utf8");
  const code = stripComments(src);
  for (const n of ["UtcTime", "LocalTime", "RtcTime", "Rtc.", "GetDateAndTime", "GetEpochTime", "RtcSettings", "time(nullptr)", "gettimeofday", "sntp", "NtpServer"]) assert.ok(!code.includes(n), `the driver uses ${n}`);
  // what it reads of the counter is millis(), and only where the core is given the time or the main loop reads the clock
  assert.ok((code.match(/millis\(\)/g) ?? []).length > 10);
});

test("the same scenario, run with the date and the time of day of the machine set to anything, gives the same timelines, the same times and the same events", () => {
  const scenario = () => {
    const h = new House({ seed: 77, loss: 0.1 });
    const rng = mulberry32(3);
    for (let id = 1; id <= 6; id++) h.add(id, { ppm: PPM[id - 1], at: 200 + Math.floor(rng() * 1500) });
    h.run(120_000, 100);
    h.restart(h.node(3), h.t + 2000);
    h.run(h.t + 60_000, 100);
    return JSON.stringify({ taken: h.taken, synced: h.synced, mesh: h.times(), tl: [...h.timelines()], stamp: hexOf(core.stamp(h.node(1).slot, h.local(h.node(1), h.t))), mismatch: h.mismatch });
  };
  const RealDate = globalThis.Date;
  const results = [];
  for (const wall of [0, 1_700_000_000_000, 4_102_444_800_000, 987_654_321_000]) {
    globalThis.Date = class extends RealDate {
      constructor(...a) { super(...(a.length ? a : [wall])); }
      static now() { return wall; }
    };
    try { results.push(scenario()); } finally { globalThis.Date = RealDate; }
  }
  assert.ok(results.every((r) => r === results[0]), "the result does not depend on the date");
  assert.equal(JSON.parse(results[0]).mismatch.length, 0);
  assert.ok(JSON.parse(results[0]).taken.length >= 5);
});

test("a node of the core is some 19 KB, a few hundred bytes more than before the clock: its time, its timeline, the events and the skew of each neighbour", (t) => {
  const size = core.sizeOf();
  assert.ok(size > 17_000 && size < 20_000, `${size} bytes`);
  t.diagnostic(`sizeof(Node) is ${size} bytes (18 880 before the clock, 19 336 with it, 19 624 with the second slot of the network key: the key words of each neighbour and the tag of each origin, and 19 824 with the outcome of the last unicast frames to each neighbour)`);
});
