// THE ALARM-STATE ORDER RULE AS A TEST.
//
// Run:   cd libs/nspanel-sim/vm && node --test test/alarm-merge.test.mjs        (40 to 50 s; it is also part of `npm test`)
// Vectors for the Berry front:   ALARM_MERGE_UPDATE_VECTORS=1 node --test test/alarm-merge.test.mjs   rewrites
// berry/test/vectors/alarm_merge.json from the reference; without the variable the test checks the file is up to date.
//
// Four files:
//   alarm-merge-ref.mjs     THE rule, as decided: the version vector, the set of heads, the three layers, the timeline, the
//                           bridge, the window, the reach, and the bytes of every field
//   alarm-merge-world.mjs   the simulated house (true time, crystals, partitions, wall-clock decoys, an oracle of the real
//                           causal history) and the 12 situations as scripts
//   alarm-merge-legacy.mjs  the first design (8 points of history, one record), kept ONLY as a labelled control: the tests show where
//                           it fails (findings F1 and F2) and that the decided rule does not
//
// WHAT IS CHECKED
//   A  the record (52 B) and its bytes, the dot, the mark that wraps, the heartbeat part (19 B), the digest, the command stamp
//   B  the merge of two copies, layer by layer (a hand-written table, every pair both ways)
//   C  the timeline: who adopts whom, what moves with the adoption, drift (TSF), the tie of two equal ages, the limit of the clock
//   D  the 12 situations of the alarm's design, as named cases, plus its table for R1 (9 of 12) and R2 (5 of 12) as controls
//   E  properties over random runs with fixed seeds (partitions and joins, restarts with and without a clock, wrong wall clocks, two
//      restarts in isolation, other orders of joins) against an oracle of the real causal history: convergence, latest-wins, a stale
//      copy against a newer action that descends from it, a house of arms only never disarmed, the local disarm of an isolated group, no head dominated by another,
//      the state independent of the order of the joins; for the decided rule and for the first design as a control
//   F  the findings F1 (the window of 8 points) and F2 (the pairwise winner is not an order) as minimal scripts: the first design fails
//      them, the decided rule passes; the heads; the version vector against the oracle; the trust bit
//   G  the desired state reconciled by each bridge, the siren's own time, the reach and what the glass says
//   H  the freshness window of a command: a buffer, a retained message, a recorded retransmission, a group that was out
//   I  the vectors of berry/test/vectors/alarm_merge.json
//
// VECTOR FORMAT (berry/test/vectors/alarm_merge.json). Every section is a list of cases with the expected result; the Berry
// test replays them and compares. Times are milliseconds unless the name says seconds; a dot is "node:counter" (the int is
// node<<20 | counter), a timeline id is [node, epoch], a mark is in ticks of 100 ms, a version vector is written sparse, as
// {"node": counter} with the zeros left out (the record's own dot is always in it).
//   constants    the numbers of the rule (windows, sizes)
//   records      { record, wire }: the record and its exact 52 bytes (hex), both directions
//   invalid      { name, wire, valid }: bytes (hex) that are or are not a record (cut, a byte too many, a flag or padding bit, a vector
//                without the record's own dot, a dot of node 0 or of counter 0); valid is whether they are one, and the Berry valid() answers it
//   hello        { hello, applied, wire }: the 19-byte heartbeat part;  stamp: { stamp, wire }: the 6-byte command stamp
//   digest       { heads, digest }: the FNV-1a digest of a set of heads, in the order of their dots
//   merge        { name, a, b, win: "a" | "b", layer }: records as above; the answer must be the same with a and b swapped
//   mergeFuzz    150 seeded random pairs of records (any state, vector, timeline, mark, trust): { a, b, win: "a" | "b" | "same", layer }
//   epoch        a node (id, saved epoch) boots in a sequence of boots, each { epochOk, epoch }: where the flash took the new epoch the
//                timeline is [id, saved epoch + 1] and that is saved; where it did not (epochOk false) the timeline is [id, epoch] with the
//                random epoch given, the saved counter stays, and the trust bit is cleared for that life: { timeline, saved, trusted } after each.
//   timeline     a node (id, epoch, tl, off, record) hears a heartbeat {tl, mesh} at its uptime `up`: { adopted, delta, tl,
//                off, rec: {tl, mark} } afterwards. A node with no `tl` has just booted (own timeline, off 0, not adopted).
//   heads        a replica that holds some heads takes batches of copies (and may act): { heads, state, dot, digest, vv, changed }.
//                node: { id, ctr, heads: [records] } in the timeline [1,1] with off 0, adopted. Each batch is taken with take(); the
//                heads after it are the records nothing descends from, sorted by dot, the same action in two forms keeping the larger
//                mark; the state is the pairwise rule folded over them in that order. `anyOrder`: every order of the batches gives the
//                same result. `act`: { kind, up } the node acts after the batches: one head, whose vector is the join of the heads'.
//   situations   the 12 of the 46. `base`: the state every node starts with; every node starts up for 10 000 000 ms in the
//                timeline [1,1] with off 0, holding the record dot 1:1 (mark 100 800 = true second 80, timeline [1,1], vector {1:1}),
//                the counter of node 1 at 1, the others 0, epoch 1. Node i has id i+1 (order of `nodes`). `up` of a
//                node at true time t is t - boot (boot starts at -10 000 000, a "boot" step sets it to the time of the step).
//                steps, with seconds of TRUE time and no latency:
//                  ["boot", n, s]           the node restarts: epoch+1, own timeline [id, epoch], off 0, not adopted, trust ok (the 12 and the
//                                           hazards always save the epoch),
//                                           the node's vector = the join of its heads' vectors and its own counter; the heads stay
//                  ["act", n, kind, s, {lost}]  the node acts (kind: disarmed, armed_home, armed_away, triggered): counter+1,
//                                           dot, vector = the node's with its own counter, mark = floor(mesh/100), timeline = its
//                                           own; the new record is the only head
//                  ["hear", a, b, s]        a takes b's heartbeat (the timeline rule), then b's heads
//                  ["meet", a, b, s]        both heartbeats first, then both sets of heads (each one takes what the other had AFTER
//                                           the timeline step)
//                  ["meetAll", s]           round after round (5 s apart) of every pair i<j in order, until nothing changes
//                `want` is what the design says; `final` is the reference's snapshot of every node (the state shown and the record it
//                comes from: dot, timeline, mark, trust, lost, vector, wire; and the dots of the heads) for the port to match exactly.
//   hazards      the findings as scripts (same steps): { decided: the reference's snapshot, old: states of the first design, want }
//   freshness    a command stamped by an issuer (up ms) and admitted by an owner (up ms) after optional restarts: { ok, reason }
//   reconcile    one bridge, a script of passes: the desired record, whether it is synced, the answers of the devices
//   reach        { owners, applied, cur } -> { total, confirmed, missing, complete };  headline: { record, reach } -> text
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  TICK_MS, LISTEN_MS, ADOPT_EPS_MS, RESYNC_MAX_MS, FRESH_WINDOW_MS, FUTURE_TOLERANCE_MS, SIREN_MS, STAMP_BYTES, HEARTBEAT_BYTES,
  RECORD_BYTES, VV_BYTES, HEADS_MAX_BYTES, MAX_HEADS, MAX_NODE, MAX_COUNTER, BASE_UP_MS, STAMP_TICK_MS, RECONCILE_MS,
  ST, ST_NAME, mkDot, dotNode, dotCounter, dotText, parseDot, tlEq, tlTag, markOf, markCmp, markAdd, vvSparse, mkRecord, descends,
  encodeRecord, decodeRecord, encodeHello, decodeHello, encodeStamp, decodeStamp, headsDigest, hex, unhex, merge, resolve, headsOf,
  safeSide, Replica, steadyReplica, baseRecord, HOUSE_TIMELINE, stampCommand, admitCommand, admitFromOutside, Bridge, reachOf, headline,
} from "./alarm-merge-ref.mjs";
import { LegacyReplica, steadyLegacy, legacyMerge } from "./alarm-merge-legacy.mjs";
import { World, runScenario, SITUATIONS, genRun, playRun, mulberry32, sec } from "./alarm-merge-world.mjs";

const VECTORS = new URL("../../../../berry/test/vectors/alarm_merge.json", import.meta.url);
const once = (() => { const memo = new Map(); return (key, fn) => { if (!memo.has(key)) memo.set(key, fn()); return memo.get(key); }; })();

// --- spec <-> record: how a record is written in the vectors ---------------------------------------------------------------
// the vector is written sparse and always holds the record's own dot
const S = (state, dot, o = {}) => {
  const d = parseDot(dot), vv = { ...(o.vv ?? {}) };
  vv[dotNode(d)] = Math.max(vv[dotNode(d)] ?? 0, dotCounter(d));
  return { state, dot, vv, timeline: o.tl ?? [1, 1], mark: o.m ?? 1000, trusted: o.trusted ?? true, lost: o.lost ?? 0 };
};
const fromSpec = (s) => mkRecord({ st: ST[s.state], dot: parseDot(s.dot), vv: s.vv, tl: { n: s.timeline[0], e: s.timeline[1] }, m: s.mark, trusted: s.trusted, lost: s.lost });
const toSpec = (r) => ({ state: ST_NAME[r.st], dot: dotText(r.dot), vv: vvSparse(r.vv), timeline: [r.tl.n, r.tl.e], mark: r.m, trusted: r.trusted, lost: r.lost });
const record = (st, dot, tl, m, vv = {}) => fromSpec(S(st, dot, { tl, m, vv }));

// the variants of the rule the tests run: the DECIDED rule (version vector and the set of heads), the first design with 8 points of
// history and one record (a control: it fails F1 and F2), and the first design with the whole history (a control: it fails F2 only)
const PROFILES = ["mixed", "armOnly", "lonely", "blackout", "shelf"];
const VARIANTS = {
  decided: { label: "the decided rule", make: (id, st) => steadyReplica(id, st) },
  old: { label: "the first design: 8 points, one record", make: (id, st) => steadyLegacy(id, st) },
  oldExact: { label: "the first design with the whole history", make: (id, st) => steadyLegacy(id, st, undefined, { histCap: Infinity }) },
};
const classOf = (st) => (st === ST.disarmed ? "disarmed" : "armed");

// ===================================================================================================================
// A. the record and its bytes
// ===================================================================================================================

test("a record is 52 bytes, 14 fixed and a version vector of 38, and it comes back from its bytes as it went", () => {
  assert.equal(RECORD_BYTES, 52);
  assert.equal(VV_BYTES, 38);
  assert.equal(HEADS_MAX_BYTES, 780);
  assert.equal(MAX_HEADS * 15 / 15, 15, "one head per bridge at most");
  const rng = mulberry32(11);
  for (let i = 0; i < 400; i++) {
    const node = 1 + Math.floor(rng() * MAX_NODE), counter = 1 + Math.floor(rng() * MAX_COUNTER);
    const vv = Array.from({ length: MAX_NODE }, () => (rng() < 0.3 ? 0 : Math.floor(rng() * (MAX_COUNTER + 1))));
    vv[node - 1] = Math.max(vv[node - 1], counter);
    const r = mkRecord({
      st: Math.floor(rng() * 4), dot: mkDot(node, counter), vv, tl: { n: 1 + Math.floor(rng() * 15), e: Math.floor(rng() * 2 ** 32) },
      m: Math.floor(rng() * 2 ** 32), trusted: rng() < 0.5, lost: Math.floor(rng() * 256),
    });
    const bytes = encodeRecord(r);
    assert.equal(bytes.length, 52);
    assert.deepEqual(decodeRecord(bytes), r);
  }
  const full = encodeRecord(fromSpec(S("armed_away", "2:3", { vv: { 1: MAX_COUNTER, 7: 0x12345, 15: MAX_COUNTER }, tl: [3, 0xdeadbeef], m: 0xfffffffe, lost: 2 })));
  assert.equal(full[14], 0xff); assert.equal(full[15], 0xff); assert.equal(full[16] >>> 4, 0xf, "counter 1, 20 bits, then counter 2 begins");
  assert.equal(full[49], 0xff & (MAX_COUNTER >>> 12)); assert.equal(full[51], 0xf0, "the 15th counter ends on a nibble: the last 4 bits are zero");
  assert.equal(decodeRecord(full.slice(0, 51)), null, "a record that is cut is not a record");
  assert.equal(decodeRecord(Uint8Array.from([...full, 0])), null, "nor one with a byte too many");
  const bad = Uint8Array.from(full); bad[0] |= 0x08;
  assert.equal(decodeRecord(bad), null, "bits 3 to 7 of the flags are zero");
  const pad = Uint8Array.from(full); pad[51] |= 1;
  assert.equal(decodeRecord(pad), null, "so are the 4 bits of padding");
  const noOwn = Uint8Array.from(full); noOwn[1] = 0x20; noOwn[2] = 0; noOwn[3] = 0x0f;     // dot 2:15 with only 3 in the vector's 2nd counter
  assert.equal(decodeRecord(noOwn), null, "a record whose vector does not hold its own dot is not a record");
});

test("A1b a dot of node 0 or of counter 0 names no action, so it is not a record, in the decoder and in the constructor (the Berry valid() refuses them too)", () => {
  const sample = fromSpec(RECORD_SAMPLES[1].record);
  assert.deepEqual(decodeRecord(encodeRecord(sample)), sample, "the control: the sample is a record");
  // the accident this closes: a node 0 indexes the vector at -1, which is undefined, and `undefined < counter` is false, so the check
  // that the vector holds the record's own dot let such a dot through
  const node0 = Uint8Array.from(encodeRecord(sample)); node0[1] = 0; node0[2] = 0; node0[3] = 1;
  assert.equal(decodeRecord(node0), null, "node 0, counter 1");
  const ctr0 = Uint8Array.from(encodeRecord(sample)); ctr0[1] = 0x20; ctr0[2] = 0; ctr0[3] = 0;
  assert.equal(decodeRecord(ctr0), null, "node 2, counter 0 (the vector holds 0 of its own counter 0 times over)");
  const none = Uint8Array.from(encodeRecord(sample)); none[1] = 0; none[2] = 0; none[3] = 0;
  assert.equal(decodeRecord(none), null, "the dot 0:0 that 'none' is written as elsewhere is not a record's dot");
  for (const dot of [0, 1, 0x12345, 0x100000, mkDot(1, 1) | (1 << 24)]) {       // 0:0, 0:1, 0:0x12345, 1:0, and a node 17
    assert.throws(() => mkRecord({ st: 0, dot, vv: { 1: 5 }, tl: { n: 1, e: 1 }, m: 0 }), /not a dot/, `mkRecord refuses the dot 0x${dot.toString(16)}`);
  }
  assert.doesNotThrow(() => mkRecord({ st: 0, dot: mkDot(15, MAX_COUNTER), vv: { 15: MAX_COUNTER }, tl: { n: 15, e: 1 }, m: 0 }), "the last dot of the last node is one");
  assert.doesNotThrow(() => mkRecord({ st: 0, dot: mkDot(1, 1), vv: { 1: 1 }, tl: { n: 1, e: 1 }, m: 0 }), "and so is the first");
  // the cases below are in the vectors (the section "invalid"), which the Berry front replays against its valid()
  for (const c of INVALID_RECORD_CASES) {
    assert.equal(decodeRecord(unhex(c.wire)) !== null, c.valid, c.name);
  }
});

test("a dot is one int, node << 20 | counter: 15 nodes and a million actions each, and a repeated dot is the same action", () => {
  assert.equal(mkDot(2, 5), (2 << 20) | 5);
  assert.equal(dotNode(mkDot(15, MAX_COUNTER)), 15);
  assert.equal(dotCounter(mkDot(15, MAX_COUNTER)), MAX_COUNTER);
  assert.ok(mkDot(15, MAX_COUNTER) < 2 ** 24, "three bytes");
  assert.equal(dotText(parseDot("7:42")), "7:42");
  assert.throws(() => mkDot(0, 1)); assert.throws(() => mkDot(16, 1)); assert.throws(() => mkDot(1, 0)); assert.throws(() => mkDot(1, MAX_COUNTER + 1));
  const r = steadyReplica(2, "disarmed");
  const a = r.act("armed_away", 1000), b = r.act("disarmed", 2000);
  assert.deepEqual([dotText(a.dot), dotText(b.dot)], ["2:1", "2:2"], "the counter of a node goes up by one per action");
  assert.deepEqual(vvSparse(b.vv), { 1: 1, 2: 2 }, "and its vector says it has seen the initial record and its own two actions");
  r.ctr = MAX_COUNTER;
  assert.throws(() => r.act("armed_away", 3000), /exhausted/);
  // why the counter is saved BEFORE the action is used: a dot that comes twice is ONE action to everybody, and the
  // copy with the larger mark is kept, so a disarm that reused an arm's dot could be taken for it and lose
  const first = fromSpec(S("armed_away", "2:5", { m: 9000 })), reused = fromSpec(S("disarmed", "2:5", { m: 100 }));
  assert.equal(merge(first, reused).layer, "same");
  assert.equal(merge(first, reused).win, first, "the new action vanished into the old one");
});

test("a mark is a uint32 of 100 ms ticks, compared by the signed difference, and it survives the wrap", () => {
  assert.equal(markOf(10_000_000), 100_000);
  assert.equal(markOf(99), 0);
  assert.ok(markCmp(10, 5) > 0 && markCmp(5, 10) < 0 && markCmp(7, 7) === 0);
  assert.ok(markCmp(5, 0xfffffffb) > 0, "5 is 10 ticks after the wrap");
  assert.equal(markAdd(0xfffffffb, 10), 5);
  assert.ok(markCmp(0x7fffffff, 0) > 0 && markCmp(0x80000001, 0) < 0, "right while less than 2^31 ticks (6.8 years) apart");
});

test("the heartbeat part is 19 bytes and the command stamp 6, and both come back as they went", () => {
  const rng = mulberry32(3);
  for (let i = 0; i < 200; i++) {
    const h = { tl: { n: 1 + Math.floor(rng() * 15), e: Math.floor(rng() * 2 ** 32) }, mesh: Math.floor(rng() * 2 ** 48), digest: Math.floor(rng() * 2 ** 32), count: 1 + Math.floor(rng() * 15), synced: rng() < 0.5 };
    const applied = rng() < 0.2 ? 0 : mkDot(1 + Math.floor(rng() * 15), 1 + Math.floor(rng() * 1000));
    const bytes = encodeHello(h, applied);
    assert.equal(bytes.length, HEARTBEAT_BYTES);
    assert.deepEqual(decodeHello(bytes), { ...h, applied });
    const st = { tag: Math.floor(rng() * 65536), issued: Math.floor(rng() * 2 ** 32) };
    assert.equal(encodeStamp(st).length, STAMP_BYTES);
    assert.deepEqual(decodeStamp(encodeStamp(st)), st);
  }
  assert.equal(HEARTBEAT_BYTES, 19);
  assert.equal(32 - HEARTBEAT_BYTES, 13, "19 of the 32 bytes of application the heartbeat carries, 13 left for the lists");
  assert.equal(decodeHello(new Uint8Array(18)), null);
  assert.equal(decodeStamp(new Uint8Array(5)), null);
});

test("the digest of the heads: the same copies give the same number, and any change of an action, a timeline or a mark changes it", () => {
  assert.equal(headsDigest([]), 0x811c9dc5, "the FNV-1a offset basis");
  const a = fromSpec(S("armed_away", "2:1", { tl: [2, 2], m: 500 })), b = fromSpec(S("disarmed", "3:1", { tl: [1, 1], m: 9000 }));
  const d = headsDigest([a, b]);
  assert.equal(headsDigest([a, b]), d);
  assert.notEqual(headsDigest([b, a]), d, "the order of the dots is part of it: heads are always sorted");
  assert.notEqual(headsDigest([a]), d);
  for (const other of [S("armed_away", "2:2", { tl: [2, 2], m: 500, vv: { 2: 2 } }), S("armed_away", "2:1", { tl: [2, 3], m: 500 }), S("armed_away", "2:1", { tl: [2, 2], m: 501 })]) {
    assert.notEqual(headsDigest([fromSpec(other), b]), d);
  }
  assert.equal(headsDigest([fromSpec({ ...S("armed_away", "2:1", { tl: [2, 2], m: 500 }), lost: 3, trusted: false }), b]), d, "state, trust and lost are not in it: the same action in the same timeline and mark is the same copy");
  // two replicas that hold the same action in two timelines still see that they differ, and exchange it (the one in the older timeline wins)
  const x1 = fromSpec(S("armed_away", "2:1", { tl: [2, 2], m: 500 })), x2 = fromSpec(S("armed_away", "2:1", { tl: [1, 1], m: 900_500 }));
  assert.notEqual(headsDigest([x1]), headsDigest([x2]));
});

// ===================================================================================================================
// B. the merge of two copies, layer by layer
// ===================================================================================================================

const MERGE_CASES = [
  { name: "the same action in two timelines keeps the larger mark, the older timeline's", a: S("disarmed", "2:1", { tl: [2, 2], m: 500 }), b: S("disarmed", "2:1", { tl: [1, 1], m: 900_500 }), win: "b", layer: "same" },
  { name: "the same action with equal marks keeps the smaller timeline id", a: S("disarmed", "2:1", { tl: [2, 2], m: 500 }), b: S("disarmed", "2:1", { tl: [1, 1], m: 500 }), win: "b", layer: "same" },
  { name: "layer 1: what descends wins over a later mark and over the disarmed", a: S("disarmed", "1:5", { m: 9000 }), b: S("armed_away", "2:2", { vv: { 1: 5 }, m: 100 }), win: "b", layer: "descent" },
  { name: "layer 1: a copy that descends wins across timelines and with an untrusted mark", a: S("disarmed", "1:5"), b: S("armed_away", "2:2", { vv: { 1: 5 }, tl: [9, 9], trusted: false, m: 1 }), win: "b", layer: "descent" },
  { name: "layer 1: a vector that has gone past the counter descends from it too (it does not need the dot itself)", a: S("disarmed", "1:5", { tl: [9, 9] }), b: S("armed_away", "2:9", { vv: { 1: 40 } }), win: "b", layer: "descent" },
  { name: "layer 1: there is no window: an ancestor a million actions back is still seen", a: S("disarmed", "1:3", { tl: [9, 9] }), b: S("armed_away", "2:9", { vv: { 1: 1_048_575 }, tl: [8, 8] }), win: "b", layer: "descent" },
  { name: "layer 1: a node's later action descends its earlier ones, whatever else its vector says", a: S("disarmed", "2:2", { tl: [9, 9], m: 5 }), b: S("armed_away", "2:3", { m: 1, tl: [8, 8] }), win: "b", layer: "descent" },
  { name: "layer 1 is strict about the counter: a vector one short of it does not descend, and the clock decides", a: S("disarmed", "1:5", { m: 10 }), b: S("armed_away", "2:2", { vv: { 1: 4 }, m: 9000 }), win: "b", layer: "clock" },
  { name: "layer 2: inside one timeline the later mark wins (an arm after a disarm)", a: S("armed_away", "2:2", { m: 2000 }), b: S("disarmed", "3:1", { m: 1000 }), win: "a", layer: "clock" },
  { name: "layer 2: ... and a disarm after an arm", a: S("armed_away", "2:2", { m: 1000 }), b: S("disarmed", "3:1", { m: 2000 }), win: "b", layer: "clock" },
  { name: "layer 2: marks compare across the wrap of the counter", a: S("armed_away", "2:2", { m: 5 }), b: S("disarmed", "3:1", { m: 0xfffffffb }), win: "a", layer: "clock" },
  { name: "layer 2: a trigger after a disarm wins", a: S("triggered", "2:2", { m: 3000 }), b: S("disarmed", "3:1", { m: 2000 }), win: "a", layer: "clock" },
  { name: "layer 2: a trigger before a later disarm loses", a: S("triggered", "2:2", { m: 1000 }), b: S("disarmed", "3:1", { m: 2000 }), win: "b", layer: "clock" },
  { name: "layer 2, equal marks: nobody can say which is later, the disarmed wins", a: S("armed_away", "2:2", { m: 777 }), b: S("disarmed", "3:1", { m: 777 }), win: "b", layer: "tie" },
  { name: "layer 2, equal marks: of two armed ones the more severe (away over home)", a: S("armed_home", "2:2", { m: 777 }), b: S("armed_away", "3:1", { m: 777 }), win: "b", layer: "tie" },
  { name: "layer 2, equal marks: a trigger over an arm", a: S("armed_away", "2:2", { m: 777 }), b: S("triggered", "3:1", { m: 777 }), win: "b", layer: "tie" },
  { name: "layer 2, equal marks and severity: the larger dot, only to be the same everywhere", a: S("armed_away", "2:7", { m: 777 }), b: S("armed_away", "3:2", { m: 777 }), win: "b", layer: "tie" },
  { name: "layer 3: different timelines, the disarmed wins whatever the marks", a: S("disarmed", "2:2", { tl: [1, 1], m: 10 }), b: S("armed_away", "3:1", { tl: [2, 2], m: 999_999 }), win: "a", layer: "safe" },
  { name: "layer 3: different timelines, two armed ones: the more severe", a: S("armed_home", "2:2", { tl: [1, 1] }), b: S("armed_away", "3:1", { tl: [2, 2] }), win: "b", layer: "safe" },
  { name: "layer 3: different timelines, same severity: the larger dot", a: S("armed_away", "2:7", { tl: [1, 1] }), b: S("armed_away", "3:2", { tl: [2, 2] }), win: "b", layer: "safe" },
  { name: "layer 3: the same timeline but an untrusted mark is not placed: the disarmed wins over the later arm", a: S("armed_away", "2:2", { m: 9000 }), b: S("disarmed", "3:1", { m: 10, trusted: false }), win: "b", layer: "safe" },
];

for (const c of MERGE_CASES) {
  test(`B ${c.name}`, () => {
    const a = fromSpec(c.a), b = fromSpec(c.b);
    const want = c.win === "a" ? a : b;
    for (const [x, y] of [[a, b], [b, a]]) {
      const r = merge(x, y);
      assert.equal(r.layer, c.layer);
      assert.deepEqual(r.win, want, "the winner is the same whichever way the copies are given");
    }
  });
}

// seeded random pairs: any state, vector, timeline, mark and trust, from a small domain so that every layer is reached
function randomPairs(count, seed) {
  const rng = mulberry32(seed);
  const rand = () => {
    const node = 1 + Math.floor(rng() * 4), counter = 1 + Math.floor(rng() * 8);
    const vv = {};
    for (let n = 1; n <= 4; n++) if (rng() < 0.3) vv[n] = Math.floor(rng() * 6);
    return S(ST_NAME[Math.floor(rng() * 4)], `${node}:${counter}`, { vv, tl: [1 + Math.floor(rng() * 2), 1], m: [100, 100, 5, 4294967290][Math.floor(rng() * 4)] + Math.floor(rng() * 2) * 50, trusted: rng() < 0.85 });
  };
  const out = [];
  while (out.length < count) {
    const a = rand(), b = rand();
    const ra = fromSpec(a), rb = fromSpec(b);
    if (descends(ra, rb) && descends(rb, ra)) continue;       // two actions that each have the other in their past cannot happen
    out.push({ a, b, ra, rb });
  }
  return out;
}

test("B merge is symmetric and idempotent over thousands of random pairs, and never invents a state", () => {
  const layers = new Set();
  for (const { ra, rb } of randomPairs(6000, 99)) {
    const x = merge(ra, rb), y = merge(rb, ra);
    layers.add(x.layer);
    assert.equal(x.win.dot, y.win.dot);
    assert.equal(x.layer, y.layer);
    assert.ok(x.win === ra || x.win === rb, "the winner is one of the two");
    assert.equal(merge(ra, ra).win, ra);
  }
  assert.deepEqual([...layers].sort(), ["clock", "descent", "safe", "same", "tie"], "the random pairs reach every layer");
});

test("B the heads of a set of copies: only causality discards, whatever the order the copies come in", () => {
  const rng = mulberry32(7);
  const T = randomPairs(300, 5).flatMap((p) => [p.ra, p.rb]);
  let multi = 0;
  for (let i = 0; i < 400; i++) {
    const set = Array.from({ length: 2 + Math.floor(rng() * 5) }, () => T[Math.floor(rng() * T.length)]);
    const byDot = new Map(set.map((r) => [r.dot, r]));                         // two different records with one dot cannot exist
    const records = [...byDot.values()];
    let heads;
    try { heads = headsOf(records); } catch { continue; }                      // a loop in the pasts cannot happen
    multi += heads.length > 1 ? 1 : 0;
    for (const h of heads) assert.ok(!heads.some((g) => g !== h && descends(g, h)), "no head descends from another");
    for (const r of records) assert.ok(heads.includes(r) || records.some((g) => descends(g, r)), "whatever is not a head has a copy above it");
    const shuffled = records.slice().sort(() => rng() - 0.5);
    assert.deepEqual(headsOf(shuffled).map((h) => h.dot), heads.map((h) => h.dot), "the same heads in any order");
    assert.equal(resolve(headsOf(shuffled)).dot, resolve(heads).dot, "and the same state");
  }
  assert.ok(multi > 20, "sets with two or more heads were exercised");
});

// ===================================================================================================================
// C. the timeline
// ===================================================================================================================

test(`a node is synced when it has adopted a timeline, or has listened to the heartbeats for ${LISTEN_MS / 1000} s and found nobody older`, () => {
  const alone = new Replica(2, { rec: baseRecord("armed_away"), epoch: 2 });
  assert.equal(alone.isSynced(0), false);
  assert.equal(alone.isSynced(LISTEN_MS - 1), false);
  assert.equal(alone.isSynced(LISTEN_MS), true, "alone: its own timeline is the one");
  const joined = new Replica(3, { rec: baseRecord("armed_away"), epoch: 2 });
  joined.hear(steadyReplica(1, "armed_away").hello(50_000_000), 1_000);
  assert.equal(joined.isSynced(1_000), true, "it adopted the others' timeline: synced at once");
  assert.equal(steadyReplica(1, "armed_away").isSynced(0), true, "a node that has been up with the others is synced");
  const again = new Replica(2, { rec: baseRecord("armed_away"), epoch: 2 });
  again.reboot();
  assert.equal(again.isSynced(500), false, "a restart starts it over");
});

test("the node that has been up less adopts the timeline of the one that has been up longer, and what it did alone moves with it", () => {
  const old = steadyReplica(1, "armed_away");                       // in the timeline [1,1], mesh = uptime
  const young = new Replica(2, { rec: baseRecord("armed_away"), epoch: 2 });  // just booted: its own timeline [2,2]
  assert.deepEqual(young.tl, { n: 2, e: 2 });
  const mine = young.act("disarmed", 60_000);                       // 60 s after its boot, alone
  assert.equal(mine.m, 600);
  assert.deepEqual(mine.tl, { n: 2, e: 2 });
  const hello = old.hello(90_000_000);                              // at that moment the older one has been up 90 000 s
  const r = young.hear(hello, 61_000);
  assert.deepEqual(r, { adopted: true, delta: 90_000_000 - 61_000 });
  assert.deepEqual(young.tl, { n: 1, e: 1 });
  assert.equal(young.mesh(61_000), 90_000_000, "the two count the same time now");
  assert.deepEqual(young.rec.tl, { n: 1, e: 1 }, "its own action is in the adopted timeline");
  assert.equal(young.rec.m, 600 + Math.round((90_000_000 - 61_000) / TICK_MS), "and its mark moved by the difference of the two times");
  assert.equal(young.rec.dot, mine.dot);
  assert.deepEqual(vvSparse(young.rec.vv), vvSparse(mine.vv), "the vector does not move: the past is the same");
  const back = old.hear(young.hello(61_000), 90_000_001);           // the older one hears the young one: nothing moves
  assert.deepEqual(back, { adopted: false, delta: 0 });
  assert.deepEqual(old.tl, { n: 1, e: 1 });
});

test("a record carried across a restart is in a timeline nobody counts any more: it is not translated, and nobody compares its mark", () => {
  const carried = record("disarmed", "3:4", [3, 7], 5000);          // written in a life of node 3 that is over
  const r = new Replica(2, { rec: carried, epoch: 2 });
  const hello = steadyReplica(1, "armed_away").hello(50_000_000);
  assert.equal(r.hear(hello, 5_000).adopted, true);
  assert.deepEqual(r.rec, carried, "untouched");
  assert.deepEqual(r.tl, { n: 1, e: 1 });
});

test("inside one timeline a node follows a larger time (the 802.11 TSF), up to a drift and not beyond; a smaller time is ignored", () => {
  const a = steadyReplica(1, "armed_away"), b = steadyReplica(2, "armed_away");
  assert.equal(b.hear(a.hello(1_000_050), 1_000_000).adopted, false);
  assert.equal(b.mesh(1_000_000), 1_000_050, "b follows a, which is 50 ms ahead");
  b.hear(a.hello(900_000), 1_000_000);
  assert.equal(b.mesh(1_000_000), 1_000_050, "a time behind is ignored, the clock never goes back");
  b.hear(a.hello(1_000_050 + RESYNC_MAX_MS + 1), 1_000_000);
  assert.equal(b.mesh(1_000_000), 1_000_050, "an hour ahead with the same timeline id is not a drift: not followed");
});

test("two timelines of the same age (a hop of latency apart) merge: exactly one adopts the other, whoever hears first", () => {
  for (const [ageA, ageB] of [[5_000_000, 5_000_000], [5_000_000, 5_000_000 + 15], [5_000_000 + 15, 5_000_000]]) {
    const A = new Replica(1, { rec: baseRecord("armed_away"), epoch: 4 }), B = new Replica(2, { rec: baseRecord("armed_away"), epoch: 9 });
    const hA = A.hello(ageA), hB = B.hello(ageB);
    const lat = 3;
    const rA = A.hear(hB, ageA + lat), rB = B.hear(hA, ageB + lat);
    assert.equal(Number(rA.adopted) + Number(rB.adopted), 1, `ages ${ageA}/${ageB}: one and only one adopts`);
    assert.ok(tlEq(A.tl, B.tl), "and both are in one timeline");
  }
  assert.ok(ADOPT_EPS_MS > 7, "the band is wider than the latency the simulator draws (1 to 7 ms)");
});

test("the drift of two crystals: 30 days of heartbeats keep two nodes within a few ms; without them they would be minutes apart", () => {
  const a = steadyReplica(1, "armed_away"), b = steadyReplica(2, "armed_away");
  const ppmA = 40, ppmB = -40;
  const upOf = (t, ppm) => Math.floor((t + 10_000_000) * (1 + ppm * 1e-6));
  let worst = 0;
  for (let t = 0; t < 30 * 86_400_000; t += 60_000) {
    a.hear(b.hello(upOf(t, ppmB)), upOf(t + 3, ppmA));
    b.hear(a.hello(upOf(t, ppmA)), upOf(t + 3, ppmB));
    worst = Math.max(worst, Math.abs(a.mesh(upOf(t, ppmA)) - b.mesh(upOf(t, ppmB))));
  }
  assert.ok(worst < 10, `the two clocks were never more than ${worst} ms apart`);
  const bare = Math.abs(upOf(30 * 86_400_000, ppmA) - upOf(30 * 86_400_000, ppmB));
  assert.ok(bare > 200_000, `without a heartbeat in the same timeline they would be ${Math.round(bare / 1000)} s apart`);
});

test("a day of isolation costs about 7 s of disagreement between two sides, and one heartbeat takes it back to the latency", () => {
  const a = steadyReplica(1, "armed_away"), b = steadyReplica(2, "armed_away");
  const day = 86_400_000;
  const upA = (t) => Math.floor((t + 10_000_000) * (1 + 40e-6)), upB = (t) => Math.floor((t + 10_000_000) * (1 - 40e-6));
  const start = Math.abs(a.mesh(upA(0)) - b.mesh(upB(0)));                       // the two have been up for 10 000 s already
  const gap = Math.abs(a.mesh(upA(day)) - b.mesh(upB(day))) - start;
  assert.ok(gap > 6_500 && gap < 7_000, `${gap} ms in a day: what the owner's "150 ms in an hour" implies, at 80 ppm between the two`);
  b.hear(a.hello(upA(day)), upB(day) + 3);
  assert.ok(Math.abs(a.mesh(upA(day)) - b.mesh(upB(day))) <= 5, "one heartbeat later: back to the latency");
});

test("the limit of the relative clock: after two days apart the two sides disagree by 14 s, so two actions seconds apart are put in the wrong order", () => {
  // two nodes in one timeline, crystals +40 and -40 ppm, that have not heard each other for two days; A disarms, B arms 3 s later
  const order = (gap) => {
    const w = new World({ names: ["A", "B"], base: "armed_away", ppm: [40, -40] });
    const t = 2 * 86_400_000;
    w.act("A", "disarmed", t);
    w.act("B", "armed_away", t + gap);
    w.meetAll(t + gap + 60_000);
    return { state: w.agreedState(), marks: w.nodes.map((n) => n.r.rec.m) };
  };
  assert.equal(order(3_000).state, "disarmed", "A's clock is ahead: its earlier disarm looks later than B's arm 3 s after it");
  assert.equal(order(30_000).state, "armed_away", "30 s apart is more than the 14 s of drift: the later action wins");
});

// ===================================================================================================================
// D. the 12 situations, and the 46's table for the other two rules
// ===================================================================================================================

for (const sc of SITUATIONS) {
  test(`D ${sc.id} ${sc.title}`, () => {
    const w = runScenario(sc);
    assert.ok(w.agreed(), "every node holds the same copies at the end");
    assert.equal(w.agreedState(), sc.want);
    assert.equal(w.nodes.reduce((n, x) => n + x.wallReads, 0), 0, "the wall clock was never read");
  });
}

test("D the first design, with 8 points or with the whole history, also gets the 12 (they fail F1 and F2, not these)", () => {
  for (const v of ["old", "oldExact"]) {
    for (const sc of SITUATIONS) assert.equal(runScenario(sc, { makeReplica: VARIANTS[v].make }).agreedState(), sc.want, `${v} ${sc.id}`);
  }
});

test("D observation: a trigger counts as an arm, so a trigger made on a side that never saw the disarm, and later by the clock, wins over it", () => {
  // the entry-delay case in a split house: B's door sensor trips 30 s after the owner disarmed at A, but B is cut off and still armed
  const w = new World({ names: ["A", "B"], base: "armed_away" });
  w.act("A", "disarmed", sec(100));
  w.act("B", "triggered", sec(130));
  w.meetAll(sec(300));
  assert.equal(w.agreedState(), "triggered", "the latest signal wins: the siren sounds after the disarm; the 12 situations do not cover a trigger (for the owner to decide)");
  const earlier = new World({ names: ["A", "B"], base: "armed_away" });
  earlier.act("B", "triggered", sec(100));
  earlier.act("A", "disarmed", sec(130));
  earlier.meetAll(sec(300));
  assert.equal(earlier.agreedState(), "disarmed", "a trigger before the disarm is cancelled by it");
});

// the design's two controls: R1 "the disarmed always wins" and R2 "the latest by the wall clock", run on the replica of the first design with
// another pairwise rule. A World that reproduces their columns of the table is the same model the draft used.
const ruleR1 = (a, b) => ({ win: (a.st === ST.disarmed) !== (b.st === ST.disarmed) ? (a.st === ST.disarmed ? a : b) : (a.dot >= b.dot ? a : b), layer: "r1" });
class WallReplica extends LegacyReplica {
  act(kind, up, opts) { const r = super.act(kind, up, opts); this.rec = Object.freeze({ ...r, wall: opts.wallClock }); return this.rec; }
  _translate() { /* the wall clock knows nothing of timelines */ }
}
const ruleWall = (a, b) => ({ win: a.wall !== b.wall ? (a.wall > b.wall ? a : b) : safeSide(a, b), layer: "wall" });
const makeR1 = (id, st) => steadyLegacy(id, st, ruleR1);
const makeWall = (id, st) => { const r = steadyLegacy(id, st, ruleWall, {}, WallReplica); r.rec = Object.freeze({ ...r.rec, wall: 80_000 }); return r; };

test("D the design's table: R1 (the first text) gets 9 of 12 and R2 (the wall clock alone) 5 of 12, and the rule 12", () => {
  const score = (make) => SITUATIONS.map((sc) => runScenario(sc, { makeReplica: make }).agreedState() === sc.want);
  const r1 = score(makeR1), r2 = score(makeWall), r6 = score(undefined);
  assert.deepEqual(SITUATIONS.filter((_, i) => !r1[i]).map((s) => s.id), ["S1", "S3", "S11"]);
  assert.deepEqual(SITUATIONS.filter((_, i) => !r2[i]).map((s) => s.id), ["S4", "S5", "S6", "S7", "S8", "S10", "S12"]);
  assert.equal(r1.filter(Boolean).length, 9);
  assert.equal(r2.filter(Boolean).length, 5);
  assert.equal(r6.filter(Boolean).length, 12);
});

// ===================================================================================================================
// E. properties over random runs, with fixed seeds
// ===================================================================================================================

// the highest counter of each node in the past of an action, the action itself included (what a version vector would say)
const maxCounters = (x) => {
  const v = new Array(MAX_NODE + 1).fill(0);
  for (const d of [...x.anc, x.dot]) v[dotNode(d)] = Math.max(v[dotNode(d)], dotCounter(d));
  return v;
};

// What the oracle says about a joined world. Returns the set of violated properties.
function analyse(w, { clocks }) {
  const v = new Set();
  const W = w.agreed();
  if (!W) { v.add("consensus"); return v; }
  const T = [...w.truth.values()];
  const desc = (x) => T.filter((y) => y.anc.has(x.dot));
  const concurrent = (x, y) => x.dot !== y.dot && !x.anc.has(y.dot) && !y.anc.has(x.dot);
  const Wt = w.truth.get(W.dot);
  const baseDot = baseRecord("disarmed").dot;
  if (desc(Wt).length) v.add("stale-beats-descendant");
  if (W.st === ST.disarmed && desc(Wt).some((x) => x.kind !== "disarmed")) v.add("disarm-beats-later-arm");            // a disarm over a later arm
  const humanDisarms = T.filter((x) => x.human && x.kind === "disarmed" && x.dot !== baseDot);
  const somethingArmed = T.some((x) => x.kind !== "disarmed");                 // the initial record counts when it is an arm
  if (W.st === ST.disarmed && humanDisarms.length === 0 && somethingArmed) v.add("disarmed-without-a-human-disarm");
  if (clocks === "exact" && W.st !== ST.disarmed) {
    for (const D of T.filter((x) => x.human && x.kind === "disarmed")) {
      const ok = T.some((x) => x.kind !== "disarmed" && (x.anc.has(D.dot) || (concurrent(x, D) && x.t >= D.t - 50)));
      if (!ok) { v.add("local-disarm-lost"); break; }                                                              // a disarm lost to an older copy it never saw
    }
  }
  // the first design's safe side must only decide what nothing else could place
  for (const m of w.merges) {
    if (m.layer !== "safe" || m.a.dot === m.b.dot) continue;
    const ta = w.truth.get(m.a.dot), tb = w.truth.get(m.b.dot);
    if (ta.anc.has(tb.dot) || tb.anc.has(ta.dot)) { v.add("safe-side-despite-descent"); break; }
  }
  // the decided rule: the heads of a replica are pairwise concurrent for the oracle (a node's later action counts as after its earlier ones)
  if (w.nodes[0].r.heads) {
    const mx = new Map(T.map((x) => [x.dot, maxCounters(x)]));
    const below = (x, y) => x.dot !== y.dot && mx.get(y.dot)[dotNode(x.dot)] >= dotCounter(x.dot);          // x is in y's past
    for (const n of w.nodes) {
      const hs = n.r.heads;
      if (hs.some((x) => hs.some((y) => below(x, y)))) { v.add("dominated-head-kept"); break; }
    }
    if (w.nodes[0].r.heads.length > 1) v.add("x:run-ending-with-2-or-more-heads");
  }
  // markers of what the run exercised (so that a property that holds because nothing was tried can be seen)
  if (T.length - 1 >= 9) v.add("x:run-with-9-or-more-actions");
  if (w.merges.some((m) => m.layer === "safe")) v.add("x:run-with-a-safe-side-decision");
  if (W.st !== ST.disarmed && humanDisarms.length > 0) v.add("x:armed-in-the-end-with-a-human-disarm-in-the-run");
  return v;
}

// runs a variant over every profile; `healSeeds` are the orders of the joins; returns { runs, tally, seeds }
function suite(variant, { clocks, runs, healSeeds, profiles = PROFILES }) {
  return once(`${variant}/${clocks}/${runs}/${healSeeds}/${profiles}`, () => {
    const make = VARIANTS[variant].make;
    const tally = {}, seeds = {};
    let total = 0;
    for (const profile of profiles) {
      for (let seed = 1; seed <= runs; seed++) {
        const run = genRun(seed, { profile, exactClocks: clocks === "exact" });
        total++;
        const worlds = Array.from({ length: healSeeds }, (_, i) => playRun(run, { makeReplica: make, healSeed: i + 1 }));
        const tags = analyse(worlds[0], { clocks });
        const finals = worlds.map((w) => w.agreed()?.st ?? -1);
        if (new Set(finals).size > 1) tags.add("order-dependent-state");
        if (new Set(finals.map(classOf)).size > 1) tags.add("order-dependent-armed-or-not");
        for (const t of tags) { tally[t] = (tally[t] ?? 0) + 1; (seeds[t] ??= []).push(`${profile}:${seed}`); }
        if (worlds.some((w) => w.nodes.some((n) => n.wallReads > 0))) tally["wall-clock-read"] = (tally["wall-clock-read"] ?? 0) + 1;
      }
    }
    return { total, tally, seeds };
  });
}

const RUNS = 250;            // runs per profile, with clocks that drift (5 profiles)
const ORDERS = 2;            // orders of the joins each run is replayed in
const RUNS_EXACT = 200;      // runs per profile with exact clocks (the properties that depend on what the clocks say)
const none = (r, tag, what = "") => assert.equal(r.tally[tag] ?? 0, 0, `${tag} ${what}: ${(r.seeds[tag] ?? []).slice(0, 8).join(", ")}`);

test(`convergence: after every join all the replicas hold the same copies, in every order of joins (${PROFILES.length * RUNS} runs x ${ORDERS} orders)`, () => {
  for (const v of ["decided", "old"]) {
    const r = suite(v, { clocks: "drift", runs: RUNS, healSeeds: ORDERS });
    assert.equal(r.total, PROFILES.length * RUNS);
    none(r, "consensus", v);
  }
});

test("the wall clock is never read, and the result does not change if every clock is right, wrong, or missing", () => {
  const r = suite("decided", { clocks: "drift", runs: RUNS, healSeeds: ORDERS });
  assert.equal(r.tally["wall-clock-read"] ?? 0, 0);
  const rng = mulberry32(5);
  let compared = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const run = genRun(seed, { profile: PROFILES[seed % PROFILES.length] });
    const variant = (f) => ({ ...run, events: run.events.map((e) => f(e)) });
    const right = variant((e) => (e[0] === "boot" ? ["boot", e[1], e[2], e[3], true] : e[0] === "skew" ? ["skew", e[1], e[2], 0] : e));
    const nothing = variant((e) => (e[0] === "boot" ? ["boot", e[1], e[2], e[3], false] : e[0] === "skew" ? ["skew", e[1], e[2], Math.floor((rng() - 0.5) * 8e8)] : e));
    const snap = (x) => playRun(x, { healSeed: 2 }).snapshot();
    assert.deepEqual(snap(right), snap(nothing), `run ${seed}: the date changes nothing`);
    assert.deepEqual(snap(run), snap(right));
    compared++;
  }
  assert.equal(compared, 60);
});

test("control: a rule that orders by the wall clock IS caught by the same runs (the properties have teeth)", () => {
  let bad = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const w = playRun(genRun(seed, { profile: PROFILES[seed % PROFILES.length], exactClocks: true }), { makeReplica: makeWall });
    const t = analyse(w, { clocks: "exact" });
    if (t.has("local-disarm-lost") || t.has("disarm-beats-later-arm") || t.has("stale-beats-descendant")) bad++;
  }
  assert.ok(bad >= 5, `the wall-clock rule broke ${bad} of 120 runs`);
});

test("control: 'the disarmed always wins' (R1) loses a later arm in the runs: the arms-only property catches it", () => {
  let bad = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const w = playRun(genRun(seed, { profile: PROFILES[seed % PROFILES.length] }), { makeReplica: makeR1 });
    if (analyse(w, { clocks: "drift" }).has("disarm-beats-later-arm")) bad++;
  }
  assert.ok(bad >= 5, `R1 broke ${bad} of 120 runs`);
});

test("with no restart at all the rule is exactly 'the latest action wins': every run ends in the state of the latest action, in every order", () => {
  for (const variant of ["decided", "old"]) {
    let checked = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const run = genRun(seed, { profile: "mixed", reboots: false, exactClocks: true });
      for (const healSeed of [1, 2]) {
        const w = playRun(run, { makeReplica: VARIANTS[variant].make, healSeed });
        const T = [...w.truth.values()];
        const latest = T.reduce((a, b) => (b.t >= a.t ? b : a));
        assert.equal(w.agreed()?.dot, latest.dot, `${variant} run ${seed}`);
        assert.equal(w.merges.filter((m) => m.layer === "safe").length, 0, "nothing needed the safe side: every pair could be placed");
        checked++;
      }
    }
    assert.equal(checked, 800);
  }
});

test("nothing but arms, restarts, partitions and joins never disarms the house, not even with a bridge that sat out 9 actions or more (shelfArm)", (t) => {
  for (const variant of ["decided", "old", "oldExact"]) {
    none(suite(variant, { clocks: "drift", runs: RUNS, healSeeds: ORDERS, profiles: ["armOnly"] }), "disarmed-without-a-human-disarm", `${variant}: a house of arms, restarts and splits`);
  }
  const shelf = Object.fromEntries(["decided", "old", "oldExact"].map((v) => [v, suite(v, { clocks: "drift", runs: RUNS, healSeeds: ORDERS, profiles: ["shelfArm"] })]));
  const n = (v) => shelf[v].tally["disarmed-without-a-human-disarm"] ?? 0;
  t.diagnostic(`with a bridge on a shelf and nothing but arms (${shelf.decided.total} runs): the decided rule ends disarmed in ${n("decided")}, the first design with 8 points in ${n("old")} (${(shelf.old.seeds["disarmed-without-a-human-disarm"] ?? []).slice(0, 5).join(" ")}), with the whole history in ${n("oldExact")}`);
  none(shelf.decided, "disarmed-without-a-human-disarm", "shelfArm");
  assert.equal(n("oldExact"), 0);
  assert.ok(n("old") / shelf.old.total < 0.1, "the first design: a hazard of the window, not an everyday event");
});

test(`the local disarm of an isolated group is never lost to a copy it did not see, unless that copy is concurrent and later (exact clocks, ${PROFILES.length * RUNS_EXACT} runs x ${ORDERS} orders)`, () => {
  for (const variant of ["decided", "old", "oldExact"]) {
    const r = suite(variant, { clocks: "exact", runs: RUNS_EXACT, healSeeds: ORDERS });
    none(r, "local-disarm-lost", variant);
    assert.ok((r.tally["x:armed-in-the-end-with-a-human-disarm-in-the-run"] ?? 0) > 100, "the property was exercised: many runs end armed with a human disarm somewhere in them");
  }
});

test("no head is ever dominated by another one, so only causality discards; the first design's safe side decided pairs whose causality it had lost", () => {
  const decided = suite("decided", { clocks: "drift", runs: RUNS, healSeeds: ORDERS });
  none(decided, "dominated-head-kept", "decided");
  assert.ok((decided.tally["x:run-ending-with-2-or-more-heads"] ?? 0) > 20, "runs end with open conflicts: the heads were exercised");
  const exact = suite("oldExact", { clocks: "drift", runs: RUNS, healSeeds: ORDERS });
  none(exact, "safe-side-despite-descent", "with the whole history a safe-side decision is always about two copies that did not see each other");
  const old = suite("old", { clocks: "drift", runs: RUNS, healSeeds: ORDERS });
  assert.ok((old.tally["x:run-with-a-safe-side-decision"] ?? 0) > 50, "the safe side was exercised");
  const rate = (old.tally["safe-side-despite-descent"] ?? 0) / old.total;
  assert.ok(rate < 0.03, `with 8 points it happened in ${(rate * 100).toFixed(2)}% of the runs: the history was too short (finding F1)`);
});

test("a copy older than a newer action that descends from it never wins, and the house is never disarmed over a later arm (findings F1, F2: the decided rule has none)", (t) => {
  const decided = suite("decided", { clocks: "drift", runs: RUNS, healSeeds: ORDERS });
  const old = suite("old", { clocks: "drift", runs: RUNS, healSeeds: ORDERS });
  const oldExact = suite("oldExact", { clocks: "drift", runs: RUNS, healSeeds: ORDERS });
  const line = (x) => `${x.total} runs, ${x.tally["stale-beats-descendant"] ?? 0} with a stale copy over a descendant, ${x.tally["disarm-beats-later-arm"] ?? 0} of them ending disarmed over a later arm`;
  t.diagnostic(`the decided rule: ${line(decided)}`);
  t.diagnostic(`the first design, 8 points: ${line(old)} (${(old.seeds["disarm-beats-later-arm"] ?? []).slice(0, 6).join(" ")})`);
  t.diagnostic(`the first design, whole history: ${line(oldExact)}`);
  assert.ok((decided.tally["x:run-with-9-or-more-actions"] ?? 0) > 100, "the runs are long enough to pass the 8 points");
  none(decided, "stale-beats-descendant", "decided");
  none(decided, "disarm-beats-later-arm", "decided");
  assert.ok((old.tally["disarm-beats-later-arm"] ?? 0) / old.total < 0.03);
  assert.ok((oldExact.tally["disarm-beats-later-arm"] ?? 0) <= (old.tally["disarm-beats-later-arm"] ?? 0), "a whole causal history alone already takes part of it away");
});

test("the order of the joins: the decided rule ends in the same state in every order; the first design does not in a few runs (finding F2)", (t) => {
  const decided = suite("decided", { clocks: "drift", runs: RUNS, healSeeds: ORDERS });
  const old = suite("old", { clocks: "drift", runs: RUNS, healSeeds: ORDERS });
  const oldExact = suite("oldExact", { clocks: "drift", runs: RUNS, healSeeds: ORDERS });
  const line = (x) => `${x.tally["order-dependent-state"] ?? 0} of ${x.total} runs end in a different state in another order of joins, ${x.tally["order-dependent-armed-or-not"] ?? 0} of them armed or not`;
  t.diagnostic(`the decided rule: ${line(decided)}`);
  t.diagnostic(`the first design, 8 points: ${line(old)} (${(old.seeds["order-dependent-armed-or-not"] ?? []).slice(0, 6).join(" ")})`);
  t.diagnostic(`the first design, whole history: ${line(oldExact)}`);
  none(decided, "order-dependent-state", "decided");
  none(decided, "order-dependent-armed-or-not", "decided");
  assert.ok((old.tally["order-dependent-armed-or-not"] ?? 0) / old.total < 0.03);
});

test(`with exact clocks the state does not depend on the order of the joins either (${PROFILES.length * RUNS_EXACT} runs x ${ORDERS} orders): what is left after weeks of isolation is the clock's uncertainty, not the rule`, () => {
  none(suite("decided", { clocks: "exact", runs: RUNS_EXACT, healSeeds: ORDERS }), "order-dependent-state", "decided, exact clocks");
});

test("what the correction does not close: after 17 days of isolation a translated mark carries the drift of those days, and the order of the joins can flip two actions 28 s apart", (t) => {
  // reduced from a run of the stress (blackout:280): the house restarts and splits in three groups; one group arms, another disarms 1 099 s after
  // and a third arms 28 s after that, 17 days later. The groups join in one order or another and each adopts the older timeline, translating
  // what it did with the difference of the clocks AT THAT MOMENT, which includes 17 days of the drift between two crystals (about 90 s at 76 ppm).
  const run = { seed: 280, n: 5, base: "disarmed", ppm: [-35.1, 1.5, -37, 39.3, -1], profile: "blackout", events: [
    ["boot", 4, 6993099997, true, false], ["split", 6993120693, [[0], [3], [4], [1, 2]], false], ["boot", 1, 6993163628, true, false],
    ["boot", 4, 6993168266, true, false], ["boot", 3, 6993210648, true, false], ["boot", 2, 6993229866, true, false], ["boot", 0, 6993283507, true, false],
    ["split", 6993339190, [[2], [0, 1], [3, 4]], true], ["act", 0, "armed_away", 6993355500, 0], ["act", 1, "armed_away", 8487128605, 0],
    ["act", 3, "disarmed", 8488227115, 0], ["act", 2, "armed_away", 8488255304, 0]] };
  const states = (r) => Array.from({ length: 12 }, (_, i) => playRun(r, { healSeed: i + 1 }).agreedState());
  const drift = new Set(states(run)), exact = new Set(states({ ...run, ppm: run.ppm.map(() => 0) }));
  t.diagnostic(`with the drift of the crystals the 12 orders of the joins give ${[...drift].join(" and ")}; with exact clocks ${[...exact].join(" and ")}`);
  assert.deepEqual([...exact], ["armed_away"], "with exact clocks the later arm wins in every order");
  assert.ok(drift.size > 1, "with the drift the order can matter: the clock's uncertainty (about 7 s per day of isolation), which no rule built on a relative clock removes");
});

// ===================================================================================================================
// F. findings: two minimal counter-examples to the first design, which the decided rule passes
// ===================================================================================================================

const HAZARD_ORDERS = (() => {
  const pre = [["boot", "B", 100], ["act", "B", "armed_away", 200], ["boot", "B", 300], ["act", "A", "disarmed", 400], ["hear", "C", "A", 401], ["act", "C", "armed_home", 500]];
  return {
    alpha: [...pre, ["meet", "B", "C", 600], ["meet", "B", "A", 601], ["meet", "A", "C", 602], ["meetAll", 700]],
    beta: [...pre, ["meet", "B", "A", 600], ["meet", "A", "C", 601], ["meet", "B", "C", 602], ["meetAll", 700]],
  };
})();
const SHELF = (actions, armsOnly = false) => {
  const acts = []; let t = 200;
  for (let i = 0; i < actions; i++) { acts.push(["act", i % 2 ? "B" : "A", armsOnly ? (i % 2 ? "armed_home" : "armed_away") : i % 2 === 0 ? "armed_away" : "disarmed", t]); acts.push(["meet", "A", "B", t + 1]); t += 10; }
  return [["boot", "A", 100], ["boot", "B", 101], ["meet", "A", "B", 120], ...acts, ["boot", "Z", 1000], ["meet", "Z", "A", 1020], ["meetAll", 1100]];
};
// what each variant gives: `decided` is the rule; `old` the first design with 8 points; `oldExact` the first design with the whole history
const HAZARDS = [
  { id: "F1-shelf-9", title: "a bridge that sat out nine actions returns with its old 'disarmed' after the house restarted: the first design ends the house DISARMED", base: "disarmed", nodes: ["Z", "A", "B"], steps: SHELF(9), decided: "armed_away", old: "disarmed", oldExact: "armed_away" },
  { id: "F1-shelf-arms-only-9", title: "nine ARMS and no disarm anywhere, a house restart, and the bridge from the shelf comes back with the initial 'disarmed': the first design ends the house disarmed, with no one having disarmed it", base: "disarmed", nodes: ["Z", "A", "B"], steps: SHELF(9, true), decided: "armed_away", old: "disarmed", oldExact: "armed_away" },
  { id: "F1-shelf-7", title: "the same with seven actions: the eight points still reach back to the old copy, and the house stays armed", base: "disarmed", nodes: ["Z", "A", "B"], steps: SHELF(7), decided: "armed_away", old: "armed_away", oldExact: "armed_away" },
  { id: "F2-order-alpha", title: "B restarts twice alone and arms in between; A disarms; C arms home after A. Joins B-C first: the first design ends DISARMED, and C's later arm is lost", base: "disarmed", nodes: ["A", "B", "C"], steps: HAZARD_ORDERS.alpha, decided: "armed_away", old: "disarmed", oldExact: "disarmed" },
  { id: "F2-order-beta", title: "the same events, joins B-A first: the first design ends armed home; the decided rule gives the same state as in the other order", base: "disarmed", nodes: ["A", "B", "C"], steps: HAZARD_ORDERS.beta, decided: "armed_away", old: "armed_home", oldExact: "armed_home" },
];

for (const h of HAZARDS) {
  test(`F ${h.id}: ${h.title}`, () => {
    for (const v of ["decided", "old", "oldExact"]) {
      const w = runScenario(h, { makeReplica: VARIANTS[v].make });
      assert.ok(w.agreed(), `${v}: the replicas agree`);
      assert.equal(w.agreedState(), h[v], v);
    }
  });
}

test("the 8 points of history were a window: the old copy was seen to be an ancestor up to 8 actions back and not at the 9th; the vector sees it at any distance", () => {
  // SHELF(k) makes k actions after the initial record, the last of them an arm when k is odd; the shelf node holds the initial record
  for (const k of [1, 3, 5, 7, 9, 11, 13, 41]) {
    const sc = { nodes: ["Z", "A", "B"], base: "disarmed", steps: SHELF(k) };
    assert.equal(runScenario(sc, { makeReplica: VARIANTS.old.make }).agreedState(), k >= 9 ? "disarmed" : "armed_away", `${k} actions, 8 points`);
    assert.equal(runScenario(sc, { makeReplica: VARIANTS.oldExact.make }).agreedState(), "armed_away", `${k} actions, the whole history`);
    assert.equal(runScenario(sc).agreedState(), "armed_away", `${k} actions, the decided rule`);
  }
});

test("the first design could throw away a copy that a later one descends from, because the pairwise winner is not one order: B beats C, A beats B, C beats A", () => {
  const w = runScenario({ nodes: ["A", "B", "C"], base: "disarmed", steps: HAZARD_ORDERS.alpha.slice(0, 6) }, { makeReplica: VARIANTS.old.make });
  const [a, b, c] = [w.nodes[0].r.rec, w.nodes[1].r.rec, w.nodes[2].r.rec];     // the three records before any join
  assert.deepEqual([a.st, b.st, c.st].map((x) => ST_NAME[x]), ["disarmed", "armed_away", "armed_home"]);
  assert.ok(c.hist.includes(a.dot), "C's arm descends from A's disarm");
  assert.equal(legacyMerge(c, a).win, c, "layer 1: C over A");
  assert.equal(legacyMerge(a, b).win, a, "layer 3: A (disarmed) over B, B is in a timeline nobody counts");
  assert.equal(legacyMerge(b, c).win, b, "layer 3 again: B over C, both armed, B the more severe");
  // the decided rule folds the same three records but throws none away on that: it only drops what is below another
  const d = runScenario({ nodes: ["A", "B", "C"], base: "disarmed", steps: HAZARD_ORDERS.alpha.slice(0, 6) });
  const [da, db, dc] = d.nodes.map((n) => n.r.rec);
  assert.ok(descends(dc, da), "C descends from A");
  assert.deepEqual(headsOf([da, db, dc]).map((h) => dotText(h.dot)), ["2:1", "3:1"], "A is below C and goes; B and C are concurrent and both stay");
});

test("F the heads: after the joins every replica holds B's arm and C's, A's disarm is gone (C descends it), and the state is the same in all six orders of the three joins", () => {
  const w = runScenario({ nodes: ["A", "B", "C"], base: "disarmed", steps: HAZARD_ORDERS.alpha });
  for (const n of w.nodes) assert.deepEqual(n.r.heads.map((h) => dotText(h.dot)), ["2:1", "3:1"]);
  assert.ok(w.nodes.every((n) => n.r.heads.length <= MAX_HEADS));
  const pairs = [["A", "B"], ["A", "C"], ["B", "C"]];
  const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const pre = HAZARD_ORDERS.alpha.slice(0, 6);
  const finals = orders.map((o) => runScenario({ nodes: ["A", "B", "C"], base: "disarmed", steps: [...pre, ...o.map((i, k) => ["meet", ...pairs[i], 600 + k]), ["meetAll", 700]] }).agreedState());
  assert.deepEqual([...new Set(finals)], ["armed_away"], "one state, whatever the order");
  const first = runScenario({ nodes: ["A", "B", "C"], base: "disarmed", steps: [...pre, ["meetAll", 700]] });
  const second = runScenario({ nodes: ["C", "B", "A"], base: "disarmed", steps: [["boot", "B", 100], ["act", "B", "armed_away", 200], ["boot", "B", 300], ["act", "C", "disarmed", 400], ["hear", "A", "C", 401], ["act", "A", "armed_home", 500], ["meetAll", 700]] });
  assert.equal(first.agreedState(), second.agreedState(), "and the same when the bridges are named in another order");
});

test("F a version vector of 15 counters says exactly what the oracle says is in an action's past (and that one node's actions are in order), in every run", () => {
  // The oracle knows the true causal past of every action. The vector says "y descends x" when vv_y[node(x)] >= counter(x): the whole
  // past in 15 numbers, and one thing more than the oracle's knowledge: a node's later action is after its own earlier ones, which a
  // replica that forgot the earlier one across a restart would not know and the counter does.
  let pairs = 0, ownOrder = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const w = playRun(genRun(seed, { profile: PROFILES[seed % PROFILES.length] }));
    const T = [...w.truth.values()];
    for (const x of T) for (const y of T) {
      if (x.dot === y.dot) continue;
      const byVector = descends(y.rec, x.rec);
      const byOracle = y.anc.has(x.dot);
      const sameNodeLater = T.some((z) => dotNode(z.dot) === dotNode(x.dot) && dotCounter(z.dot) > dotCounter(x.dot) && (z.dot === y.dot || y.anc.has(z.dot)));
      assert.equal(byVector, byOracle || sameNodeLater, `${dotText(y.dot)} over ${dotText(x.dot)}`);
      if (byVector && !byOracle) ownOrder++;
      pairs++;
    }
  }
  assert.ok(pairs > 1000);
  assert.equal(MAX_NODE * 20 / 8, 37.5, "15 counters of 20 bits: 38 bytes, instead of the 24 of the 8 points");
  assert.ok(ownOrder >= 0);
});

test("a boot whose epoch could not be saved takes a random one: reusing the old epoch would give the new life the id of a timeline the others may still be in, and they would adopt a clock that is days off", () => {
  // reduced from a run of the stress (armOnly:1918, exact clocks): node 0 (the root of the house's timeline [1,1]) restarts with the flash
  // refusing the epoch; later node 1 restarts and hears node 0 first, which is older than it is; it adopts node 0's [1,1] (a life of 8 days) and
  // translates what it does into a clock that is 14 days behind the house's real [1,1]: its trigger gets two different marks in two replicas.
  const events = (collide) => [["boot", 0, 2073841358, false, false, collide], ["boot", 1, 10898593173, true, false], ["split", 10898676708, [[0, 1, 3], [2]], false],
    ["act", 2, "armed_away", 10903415320, 0], ["act", 1, "triggered", 11994700224, 0]];
  const states = (collide) => [...new Set(Array.from({ length: 12 }, (_, i) => playRun({ seed: 1918, n: 4, base: "armed_away", ppm: [0, 0, 0, 0], profile: "armOnly", events: events(collide) }, { healSeed: i + 1 }).agreedState()))];
  assert.deepEqual(states(false), ["triggered"], "with a random epoch the trigger, later than the arm, wins in every order");
  assert.ok(states(true).length > 1, "with the old epoch reused the orders disagree");
  const w = new World({ names: ["A"], base: "armed_away" });
  w.boot("A", sec(100), { epochOk: false });
  assert.notDeepEqual(w.nodes[0].r.tl, { n: 1, e: 1 }, "the new life is not in the old timeline");
  assert.equal(w.nodes[0].r.epoch, 1, "and the saved counter was left alone");
  assert.throws(() => new Replica(1, { rec: baseRecord("armed_away"), epoch: 1 }).reboot({ epochOk: false }), /random one/);
});

test("F the trust bit: a life whose timeline id repeats an old one (a random epoch that collides, 2^-32) is never ordered by mark, or an old arm would beat its new disarm", () => {
  // life 1 of timeline [2,2] (node 2's): node 4 adopted it and armed at mark 5000, which reached node 3. Node 2 restarts, cannot save
  // the new epoch, and the random one it takes happens to be 2 again (forced here): the id [2,2] repeats, and it disarms 10 s into the new
  // life: concurrent with node 4's arm, and later in real time.
  const oldArm = record("armed_away", "4:1", [2, 2], 5000, { 1: 1 });
  const n2 = new Replica(2, { rec: baseRecord("disarmed"), epoch: 2, ctr: 1 });   // the dot counter WAS saved (2:1 is spent); the epoch was not
  n2.reboot({ epochOk: false, epoch: 2 });                        // forced: the epoch that repeats by chance (2^-32), the case the bit is for
  assert.deepEqual(n2.tl, { n: 2, e: 2 }, "the same timeline id as the life before");
  assert.equal(n2.trusted, false);
  const dis = n2.act("disarmed", 10_000);
  assert.equal(dis.trusted, false);
  assert.ok(dis.m < 5000, "its mark is far below the old life's: by mark the old arm looks later");
  assert.ok(!descends(dis, oldArm) && !descends(oldArm, dis), "the two never saw each other");
  const untrusted = merge(oldArm, dis);
  assert.equal(untrusted.layer, "safe");
  assert.equal(untrusted.win, dis, "the disarmed wins: a copy that cannot be placed falls to the safe side");
  const naive = merge(oldArm, mkRecord({ ...dis, trusted: true }));
  assert.equal(naive.layer, "clock");
  assert.equal(naive.win, oldArm, "without the bit the old arm would have won by mark, against a disarm a person made later");
});

// ===================================================================================================================
// G. the desired state reconciled by each bridge, the siren's own time, the reach
// ===================================================================================================================

class Fleet {
  // owners: { name: [devices] }. The bridges share one World (heartbeats and copies); the devices live here.
  constructor(names, owners, { base = "disarmed", loss = 0, seed = 1, sirenMs = SIREN_MS } = {}) {
    this.w = new World({ names, base, seed });
    this.rng = mulberry32(seed + 1000);
    this.loss = loss;
    this.bridges = names.map((n, i) => { const b = new Bridge(this.w.nodes[i].r, owners[n] ?? [], { sirenMs }); this.w.nodes[i].bridge = b; return b; });
    this.phys = new Map();                 // device id -> is it physically on
    this.dead = new Set();                 // devices that never answer
    this.off = new Set();                  // bridges that are powered off: no pass, no heartbeat
    this.log = [];
    this.w.setGroups([names.map((_, i) => i)]);
  }
  drive(t, dev, on) { this.log.push([t, dev.id, on]); if (this.dead.has(dev.id) || this.rng() < this.loss) return false; this.phys.set(dev.id, on); return true; }
  groups(...lists) { this.w.setGroups(lists.map((g) => g.map((n) => this.w.idx(n)).filter((i) => !this.off.has(i)))); }
  run(from, to, step = RECONCILE_MS) {
    for (let t = from; t <= to; t += step) {
      this.w.syncGroups(t);
      this.bridges.forEach((b, i) => { if (!this.off.has(i)) b.reconcile(this.w.up(i, t), (dev, on) => this.drive(t, dev, on)); });
    }
  }
  sounding() { return [...this.phys].filter(([, on]) => on).map(([id]) => id).sort(); }
  // what bridge `name` knows of the others' applied dot: its group's heartbeats (and its own)
  appliedBy(name) {
    const me = this.w.idx(name);
    const g = this.w.groups.find((x) => x.includes(me)) ?? [me];
    return new Map(g.map((i) => [this.w.nodes[i].id, this.bridges[i].applied]));
  }
  reachFor(name, owners) { return reachOf(this.w.nodes[this.w.idx(name)].r.rec.dot, owners, this.appliedBy(name)); }
}
const siren = (id) => ({ id, kind: "siren" });
const sensor = (id) => ({ id, kind: "sensor" });

test("the order is repeated until a device confirms it, and the bridge says it applied the state only when it did", () => {
  const f = new Fleet(["A"], { A: [siren("a")] }, { base: "armed_away", loss: 0.7, seed: 3 });
  f.run(20_000, 30_000);
  f.w.act("A", "triggered", 31_000);
  const dot = f.w.nodes[0].r.rec.dot;
  let confirmedAt = null;
  for (let t = 32_000; t <= 200_000; t += RECONCILE_MS) {
    f.run(t, t);
    if (f.bridges[0].applied === dot) { confirmedAt = t; break; }
    assert.equal(f.phys.get("a") ?? false, false, "while the device has not confirmed, the bridge does not claim the state");
  }
  assert.ok(confirmedAt, "it got through at last");
  assert.equal(f.phys.get("a"), true);
  const sends = f.log.filter((e) => e[1] === "a").length;
  assert.ok(sends > 1, `${sends} tries with 70% of the answers lost`);
  const before = f.log.length;
  f.run(confirmedAt + RECONCILE_MS, confirmedAt + 10 * RECONCILE_MS);
  assert.equal(f.log.length, before, "once confirmed it stops sending");
});

test("a newer desired state replaces a pending one: a disarm after a trigger that never got through never sends the siren on", () => {
  const f = new Fleet(["A"], { A: [siren("a")] }, { base: "armed_away" });
  f.run(20_000, 30_000);
  f.dead.add("a");
  f.w.act("A", "triggered", 31_000);
  f.run(32_000, 44_000);
  assert.ok(f.log.some((e) => e[2] === true), "it tried to sound it");
  assert.equal(f.bridges[0].applied === f.w.nodes[0].r.rec.dot, false, "and it did not claim it");
  f.w.act("A", "disarmed", 45_000);
  const mark = f.log.length;
  f.dead.delete("a");
  f.run(46_000, 60_000);
  const after = f.log.slice(mark);
  assert.ok(after.every((e) => e[2] === false), "from the disarm on it never sent the siren ON (it sent nothing: the siren was never on)");
  assert.equal(f.phys.get("a"), false);
  assert.equal(f.bridges[0].applied, f.w.nodes[0].r.rec.dot);
});

test("three sirens in three bridges; with one bridge off and one siren dead the alarm still sounds, with no leader", () => {
  const f = new Fleet(["A", "B", "C"], { A: [siren("a")], B: [siren("b")], C: [siren("c")] }, { base: "armed_away" });
  f.run(20_000, 30_000);
  f.off.add(0); f.groups(["A", "B", "C"]);           // bridge A has no power
  f.dead.add("c");                                   // the siren of C does not answer
  f.w.act("B", "triggered", 31_000);                 // the sensor is at B
  f.run(32_000, 60_000);
  assert.deepEqual(f.sounding(), ["b"], "B's siren sounds: another one alive is enough");
  assert.equal(f.w.nodes[2].r.rec.st, ST.triggered, "C knows, and tries its own siren, without waiting for anybody");
  assert.ok(f.log.some((e) => e[1] === "c"), "C kept trying");
  f.off.delete(0); f.w.boot("A", 70_000); f.groups(["A", "B", "C"]);
  f.run(71_000, 100_000);
  assert.deepEqual(f.sounding().filter((x) => x === "a"), ["a"], "A comes back, hears it, and sounds its own too");
  f.w.act("C", "disarmed", 101_000);
  f.dead.delete("c");
  f.run(102_000, 130_000);
  assert.deepEqual(f.sounding(), [], "the disarm reaches all three and every siren stops");
});

test("an isolated bridge that missed the disarm silences its siren by its own time; the others see partial reach, then complete", () => {
  const f = new Fleet(["A", "B", "C"], { A: [siren("a")], B: [siren("b")], C: [sensor("c")] }, { base: "armed_away", sirenMs: 60_000 });
  f.run(20_000, 30_000);
  f.w.act("B", "triggered", 31_000);
  f.run(32_000, 50_000);
  assert.deepEqual(f.sounding(), ["a", "b"]);
  f.groups(["A"], ["B", "C"]);                       // A is cut off from the others
  f.w.syncGroups(51_000);
  f.w.act("B", "disarmed", 52_000);                  // a person disarms on the other side
  f.run(53_000, 80_000);
  assert.deepEqual(f.sounding(), ["a"], "B's siren stops, A never heard the disarm");
  const owners = [1, 2, 3];
  const during = f.reachFor("B", owners);
  assert.deepEqual([during.confirmed, during.total, during.missing, during.complete], [2, 3, [1], false]);
  assert.equal(headline(f.w.nodes[1].r.rec, during).text, "Disarmed here, 1 part out of reach");
  f.run(81_000, 100_000);
  assert.deepEqual(f.sounding(), [], "A's siren has its own time: 60 s after it started it stops, with no disarm");
  assert.equal(f.w.nodes[0].r.rec.st, ST.triggered, "A still shows the old state, it has not been told");
  f.groups(["A", "B", "C"]);
  f.run(101_000, 120_000);
  const after = f.reachFor("B", owners);
  assert.equal(after.complete, true);
  assert.equal(headline(f.w.nodes[1].r.rec, after).text, "Disarmed, 3 of 3");
  assert.equal(f.w.nodes[0].r.rec.st, ST.disarmed, "and A takes the disarm when it is back");
});

test("a bridge that restarted holds until it is synced (an armed alarm stays armed), and a siren the restart left on is switched off", () => {
  const f = new Fleet(["A", "B"], { A: [siren("a")], B: [siren("b")] }, { base: "armed_away" });
  f.run(20_000, 30_000);
  f.w.act("A", "triggered", 31_000);
  f.run(32_000, 45_000);
  assert.deepEqual(f.sounding(), ["a", "b"]);
  f.w.act("B", "disarmed", 46_000);                  // B disarms, then A loses power before it hears
  f.groups(["B"]); f.off.add(0);
  f.run(47_000, 60_000);
  assert.deepEqual(f.sounding(), ["a"], "A's siren was left on by the bridge that went down (nothing could tell it)");
  f.off.delete(0);
  f.w.boot("A", 70_000);                             // A is back, alone for now, with the copy it persisted (triggered)
  f.groups(["A"], ["B"]);
  const held = f.bridges[0].reconcile(f.w.up(0, 72_000), () => { throw new Error("a held bridge must not send anything"); });
  assert.equal(held.held, true);
  assert.equal(f.w.nodes[0].r.rec.st, ST.triggered, "it neither disarms nor re-sounds anything from a copy it has not checked");
  f.groups(["A", "B"]);
  f.run(75_000, 100_000);
  assert.equal(f.w.nodes[0].r.rec.st, ST.disarmed, "it heard the others: the disarm descends from its copy");
  assert.deepEqual(f.sounding(), [], "and the siren that stayed on is switched off after the restart");
});

test("what the glass says, and that it never says 'Armed' or 'Disarmed' in full without every owner confirming", () => {
  const cur = mkDot(2, 3);
  const rec = (st, lost = 0) => ({ st: ST[st], lost });
  const full = reachOf(cur, [1, 2, 3], new Map([[1, cur], [2, cur], [3, cur]]));
  const part = reachOf(cur, [1, 2, 3], new Map([[1, cur], [2, mkDot(2, 2)]]));
  assert.deepEqual(full, { total: 3, confirmed: 3, missing: [], complete: true });
  assert.deepEqual(part, { total: 3, confirmed: 1, missing: [2, 3], complete: false });
  assert.equal(headline(rec("disarmed"), full).text, "Disarmed, 3 of 3");
  assert.equal(headline(rec("disarmed"), part).text, "Disarmed here, 2 parts out of reach");
  assert.equal(headline(rec("armed_away"), full).text, "Armed away, 3 of 3");
  assert.equal(headline(rec("armed_home"), part).text, "Armed only here");
  assert.deepEqual(headline(rec("armed_away"), part).unprotected, [2, 3], "and it lists what is not protected");
  assert.equal(headline(rec("armed_away", 2), full).text, "Armed away, 3 of 3, 2 without protection");
  assert.equal(headline(rec("armed_away", 2), part).text, "Armed only here, 2 without protection", "the two marks add up");
  assert.equal(headline(rec("disarmed", 2), full).text, "Disarmed, 3 of 3", "a disarm carries no 'without protection'");
  assert.equal(headline(rec("triggered"), part).text, "Triggered here, 2 parts out of reach");
  for (const st of ["disarmed", "armed_home", "armed_away", "triggered"]) {
    assert.equal(headline(rec(st), part).kind, "partial", "never complete while an owner is missing");
  }
  assert.equal(reachOf(cur, [], new Map()).complete, true, "an alarm with nothing to reach has nothing out of reach");
});

test("the arm keeps who was left out, as a count in the record, and every replica shows it", () => {
  const w = new World({ names: ["A", "B"], base: "disarmed" });
  w.act("A", "armed_away", sec(100), { lost: 2 });
  w.meetAll(sec(200));
  for (const n of w.nodes) assert.equal(n.r.rec.lost, 2);
  assert.equal(decodeRecord(encodeRecord(w.nodes[1].r.rec)).lost, 2, "and it is one byte of the record");
  w.act("B", "disarmed", sec(300));
  w.meetAll(sec(400));
  assert.equal(w.nodes[0].r.rec.lost, 0);
});

// ===================================================================================================================
// H. the freshness window of a command
// ===================================================================================================================

const FRESH_CASES = [
  { name: "a command a moment old is taken", issuerUp: 50_000_000, ownerUp: 50_000_400, ok: true, reason: "ok", ageMs: 400 },
  { name: "the window is closed at 3 s: 3000 ms old is taken", issuerUp: 50_000_000, ownerUp: 50_003_000, ok: true, reason: "ok", ageMs: 3000 },
  { name: "... and 3010 ms is not", issuerUp: 50_000_000, ownerUp: 50_003_010, ok: false, reason: "stale", ageMs: 3010 },
  { name: "stuck in a TCP socket that closed 15 s late (U19): refused", issuerUp: 50_000_000, ownerUp: 50_015_000, ok: false, reason: "stale", ageMs: 15_000 },
  { name: "a stamp a little ahead is the error of two relative clocks: taken", issuerUp: 50_000_000, ownerUp: 49_999_900, ok: true, reason: "ok", ageMs: -100 },
  { name: "a stamp far ahead is refused", issuerUp: 50_000_000, ownerUp: 49_999_600, ok: false, reason: "from-the-future", ageMs: -400 },
  { name: "a replay INSIDE the window is not the window's business (the mesh counter stops it): taken", issuerUp: 50_000_000, ownerUp: 50_001_000, ok: true, reason: "ok", ageMs: 1000 },
  { name: "the stamp wraps in 497 days and the age is still right across it", issuerUp: 42_949_672_900, ownerUp: 42_949_673_000, ok: true, reason: "ok", ageMs: 100 },
];

for (const c of FRESH_CASES) {
  test(`H ${c.name}`, () => {
    const issuer = steadyReplica(1, "armed_away"), owner = steadyReplica(2, "armed_away");
    const cmd = stampCommand(issuer, c.issuerUp, { to: "light" });
    assert.ok(cmd);
    assert.equal(STAMP_BYTES, encodeStamp(cmd).length);
    const r = admitCommand(owner, cmd, c.ownerUp);
    assert.equal(r.ok, c.ok);
    assert.equal(r.reason, c.reason);
    assert.equal(r.ageMs, c.ageMs);
  });
}

test("H a recorded retransmission: a frame taken off the air and played again after the owner restarted is refused, inside the 2.6 minutes the replay window forgot", () => {
  const issuer = steadyReplica(1, "armed_away");
  const owner = steadyReplica(2, "armed_away");
  const frame = stampCommand(issuer, 50_000_000, { to: "gate", open: true });
  assert.equal(admitCommand(owner, frame, 50_000_500).ok, true, "the original");
  owner.reboot();                                                     // the owner restarts: new timeline, uptime 0, nothing remembered
  assert.deepEqual(admitCommand(owner, frame, 2_000), { ok: false, reason: "owner-not-synced" }, "while it listens it takes nothing");
  assert.deepEqual(admitCommand(owner, frame, 20_000), { ok: false, reason: "other-timeline" }, "synced alone, the stamp is in a timeline it does not count");
  owner.hear(issuer.hello(50_160_000), 156_000);                      // 2.6 minutes later it hears the others: it adopts their timeline
  assert.equal(owner.tl.n, 1);
  const again = admitCommand(owner, frame, 156_000);
  assert.deepEqual([again.ok, again.reason], [false, "stale"], "even on the same timeline again the frame is 2.6 minutes old");
});

test("H a retained message (C18): the window cannot refuse what an outside publisher never stamped, so the retain flag does, and a stamped one is judged by its age", () => {
  const bridge = steadyReplica(2, "armed_away");
  assert.deepEqual(admitFromOutside(bridge, 50_000_000, { retained: true, body: { set: "on" } }), { ok: false, reason: "retained" });
  const fresh = admitFromOutside(bridge, 50_000_000, { retained: false, body: { set: "on" } });
  assert.equal(fresh.ok, true);
  assert.equal(admitCommand(bridge, fresh.cmd, 50_000_100).ok, true);
  // a stamp made on arrival measures nothing: the same retained message, delivered an hour later, would look brand new
  const naive = stampCommand(bridge, 50_000_000 + 3_600_000, { set: "on" });
  assert.equal(admitCommand(bridge, naive, 50_000_000 + 3_600_050).ok, true, "which is why 'retained' is refused by the flag and never by the age");
  // a retained message that WAS stamped by a mesh node when it was published is old and refused
  const issued = stampCommand(steadyReplica(1, "armed_away"), 50_000_000, { set: "on" });
  assert.equal(admitCommand(bridge, issued, 50_000_000 + 3_600_000).reason, "stale");
});

test("H a group that was out: what the network sent while it was away is refused, what it sends once it is back is taken", () => {
  const net = steadyReplica(1, "armed_away");                         // the network, in the house timeline
  const group = new Replica(2, { rec: baseRecord("armed_away"), epoch: 2 });  // a bridge that restarted and is on its own
  group.act("disarmed", 15_000);
  const sentWhileOut = stampCommand(net, 90_000_000, { to: "lamp", on: true });
  assert.deepEqual(admitCommand(group, sentWhileOut, 20_000), { ok: false, reason: "other-timeline" }, "alone: the stamp is in a timeline it does not count");
  assert.equal(stampCommand(group, 5_000, {}), null, "and a group that is not synced yet issues no stamp");
  group.hear(net.hello(90_020_000), 40_000);                          // it hears the network 20 s later and adopts its timeline
  assert.deepEqual(group.tl, net.tl);
  const late = admitCommand(group, sentWhileOut, 40_100);
  assert.equal(late.reason, "stale", "the command that was in flight to it all that time is 20 s old: not applied");
  assert.equal(late.ok, false);
  const fresh = stampCommand(net, 90_020_000, { to: "lamp", on: false });
  assert.equal(admitCommand(group, fresh, 40_100).ok, true);
  assert.equal(admitCommand(steadyReplica(3, "armed_away"), fresh, 90_020_100).ok, true);
});

test("H an owner that has not synced refuses everything, even a perfectly fresh command from its own timeline", () => {
  const issuer = steadyReplica(1, "armed_away");
  const owner = new Replica(2, { rec: baseRecord("armed_away"), epoch: 2 });
  const cmd = stampCommand(issuer, 50_000_000, {});
  assert.equal(admitCommand(owner, cmd, LISTEN_MS - 1).reason, "owner-not-synced");
  owner.hear(issuer.hello(50_001_000), 1_000);
  assert.equal(admitCommand(owner, stampCommand(issuer, 50_001_050, {}), 1_050).ok, true, "adopted the timeline: synced");
  assert.equal(FRESH_WINDOW_MS, 3000);
  assert.equal(FUTURE_TOLERANCE_MS, 250);
  assert.equal(STAMP_TICK_MS, 10);
});

// ===================================================================================================================
// I. the vectors for the Berry front
// ===================================================================================================================

const TIMELINE_CASES = [
  { name: "the younger timeline adopts the older and its own record moves", node: { id: 2, epoch: 2, record: S("disarmed", "2:1", { tl: [2, 2], m: 600, vv: { 1: 1 } }) }, up: 61_000, hello: { tl: [1, 1], mesh: 90_000_000 } },
  { name: "the older node keeps its timeline", node: { id: 1, epoch: 1, tl: [1, 1], off: 0, record: S("armed_away", "1:1", { tl: [1, 1], m: 100_800 }) }, up: 90_000_000, hello: { tl: [2, 2], mesh: 61_000 } },
  { name: "a record from a timeline that is over is not translated", node: { id: 2, epoch: 2, record: S("disarmed", "3:4", { tl: [3, 7], m: 5000 }) }, up: 5_000, hello: { tl: [1, 1], mesh: 50_000_000 } },
  { name: "the same timeline: a larger time is followed, nothing is translated", node: { id: 2, epoch: 1, tl: [1, 1], off: 0, record: S("armed_away", "1:1", { tl: [1, 1], m: 100_800 }) }, up: 1_000_000, hello: { tl: [1, 1], mesh: 1_000_050 } },
  { name: "the same timeline: an hour ahead is not a drift and is not followed", node: { id: 2, epoch: 1, tl: [1, 1], off: 0, record: S("armed_away", "1:1", { tl: [1, 1], m: 100_800 }) }, up: 1_000_000, hello: { tl: [1, 1], mesh: 1_000_000 + RESYNC_MAX_MS + 1 } },
  { name: "equal ages: the smaller timeline id wins, so this side (the larger id) adopts", node: { id: 2, epoch: 9, record: S("disarmed", "2:1", { tl: [2, 9], m: 100 }) }, up: 5_000_003, hello: { tl: [1, 4], mesh: 5_000_000 } },
  { name: "equal ages: and this side (the smaller id) keeps its own", node: { id: 1, epoch: 4, record: S("disarmed", "1:2", { tl: [1, 4], m: 100 }) }, up: 5_000_003, hello: { tl: [2, 9], mesh: 5_000_000 } },
];

function runTimelineCase(c) {
  const rec = fromSpec(c.node.record);
  const r = new Replica(c.node.id, { rec, ctr: 0, epoch: c.node.epoch, tl: c.node.tl ? { n: c.node.tl[0], e: c.node.tl[1] } : undefined, off: c.node.off });
  const res = r.hear({ tl: { n: c.hello.tl[0], e: c.hello.tl[1] }, mesh: c.hello.mesh }, c.up);
  return { adopted: res.adopted, delta: res.delta, timeline: [r.tl.n, r.tl.e], off: r.off, record: { timeline: [r.rec.tl.n, r.rec.tl.e], mark: r.rec.m } };
}

// boots of one node, some of them with a flash that refuses the epoch (then the node takes the random one it is given, for that life only)
const EPOCH_CASES = [
  { name: "the epoch is saved, counted from the saved one, and the timeline is the node's own", node: { id: 3, epoch: 4 },
    boots: [{ epochOk: true }, { epochOk: true }], want: [{ timeline: [3, 5], saved: 5, trusted: true }, { timeline: [3, 6], saved: 6, trusted: true }] },
  { name: "a flash that refuses the epoch: a random one for this life, the saved counter left alone, the trust bit cleared; the next boot counts from the saved one", node: { id: 3, epoch: 4 },
    boots: [{ epochOk: false, epoch: 0xcafebabe }, { epochOk: false, epoch: 0x12345678 }, { epochOk: true }], want: [{ timeline: [3, 0xcafebabe], saved: 4, trusted: false }, { timeline: [3, 0x12345678], saved: 4, trusted: false }, { timeline: [3, 5], saved: 5, trusted: true }] },
];
function runEpochCase(c) {
  const r = new Replica(c.node.id, { rec: baseRecord("armed_away"), epoch: c.node.epoch });
  return c.boots.map((b) => { r.reboot(b); return { timeline: [r.tl.n, r.tl.e], saved: r.epoch, trusted: r.trusted }; });
}

const RECORD_SAMPLES = [
  { name: "the initial record of the house", record: toSpec(baseRecord("armed_away")) },
  { name: "an arm with a wide vector and two devices left out", record: S("armed_away", "2:3", { vv: { 1: MAX_COUNTER, 7: 0x12345, 15: MAX_COUNTER }, tl: [3, 0xdeadbeef], m: 0xfffffffe, lost: 2 }) },
  { name: "a trigger, untrusted, from the last node", record: S("triggered", "15:1048575", { vv: { 1: 4, 14: 1_000_000 }, tl: [15, 1], m: 7, trusted: false }) },
  { name: "a disarm with only its own dot in the vector", record: S("disarmed", "9:1", { tl: [9, 2], m: 0 }) },
];

// Bytes that are, or are not, a record: the sample of the wide vector with one thing changed, and whether the changed bytes are a record
// (written by hand: A1b checks the reference against it). The vectors carry the bytes (the section "invalid") and the Berry front's
// valid() must answer the same for each one
const INVALID_RECORD_CASES = (() => {
  const wide = encodeRecord(fromSpec(RECORD_SAMPLES[1].record));
  const edit = (change) => { const b = Uint8Array.from(wide); change(b); return b; };
  const dot = (b, node, counter) => { b[1] = (node << 4) | (counter >>> 16); b[2] = (counter >>> 8) & 255; b[3] = counter & 255; };
  return [
    { name: "the sample: a record", bytes: wide, valid: true },
    { name: "cut by a byte", bytes: wide.slice(0, 51), valid: false },
    { name: "a byte too many", bytes: Uint8Array.from([...wide, 0]), valid: false },
    { name: "empty", bytes: new Uint8Array(0), valid: false },
    { name: "bit 3 of the flags set", bytes: edit((b) => { b[0] |= 0x08; }), valid: false },
    { name: "bit 7 of the flags set", bytes: edit((b) => { b[0] |= 0x80; }), valid: false },
    { name: "a padding bit set", bytes: edit((b) => { b[51] |= 1; }), valid: false },
    { name: "the vector does not hold the record's own dot (2:15, 3 in the second counter)", bytes: edit((b) => dot(b, 2, 15)), valid: false },
    { name: "a dot of node 0 and counter 1", bytes: edit((b) => dot(b, 0, 1)), valid: false },
    { name: "a dot of node 0 and a large counter", bytes: edit((b) => dot(b, 0, 0x12345)), valid: false },
    { name: "the dot 0:0", bytes: edit((b) => dot(b, 0, 0)), valid: false },
    { name: "a dot of node 2 and counter 0", bytes: edit((b) => dot(b, 2, 0)), valid: false },
    { name: "a dot of node 15 and counter 0", bytes: edit((b) => dot(b, 15, 0)), valid: false },
    { name: "the first dot of the first node (the vector holds 1:1)", bytes: edit((b) => dot(b, 1, 1)), valid: true },
    { name: "the last dot of the last node (the vector holds 15:1048575)", bytes: edit((b) => dot(b, 15, MAX_COUNTER)), valid: true },
  ].map((c) => ({ name: c.name, wire: hex(c.bytes), valid: c.valid }));
})();

const HEADS_CASES = [
  { name: "two concurrent copies are both kept, and the safe side shows the disarmed", anyOrder: true,
    node: { id: 4, ctr: 0, heads: [S("armed_away", "1:1", { tl: [1, 1], m: 100_800 })] },
    takes: [[S("armed_away", "2:1", { tl: [2, 2], m: 500, vv: { 1: 1 } })], [S("disarmed", "3:1", { tl: [1, 1], m: 9000, vv: { 1: 1 } })]],
    want: { heads: ["2:1", "3:1"], state: "disarmed", dot: "3:1" } },
  { name: "a descendant replaces the head it descends from and leaves the other one (the finding F2 in three copies)", anyOrder: true,
    node: { id: 4, ctr: 0, heads: [S("armed_away", "1:1", { tl: [1, 1], m: 100_800 })] },
    takes: [[S("armed_away", "2:1", { tl: [2, 2], m: 500, vv: { 1: 1 } })], [S("disarmed", "1:2", { tl: [1, 1], m: 104_000, vv: { 1: 2 } })], [S("armed_home", "3:1", { tl: [1, 1], m: 105_000, vv: { 1: 2 } })]],
    want: { heads: ["2:1", "3:1"], state: "armed_away", dot: "2:1" } },
  { name: "a copy that descends from every head leaves one head", anyOrder: false,
    node: { id: 5, ctr: 0, heads: [S("armed_away", "2:1", { tl: [2, 2], m: 500, vv: { 1: 1 } }), S("armed_home", "3:1", { tl: [1, 1], m: 9000, vv: { 1: 1 } })] },
    takes: [[S("disarmed", "4:1", { tl: [1, 1], m: 12_000, vv: { 1: 1, 2: 1, 3: 1 } })]],
    want: { heads: ["4:1"], state: "disarmed", dot: "4:1" } },
  { name: "the same action in two forms keeps the one in the older timeline, the larger mark", anyOrder: true,
    node: { id: 4, ctr: 0, heads: [S("disarmed", "2:1", { tl: [2, 2], m: 500, vv: { 1: 1 } })] },
    takes: [[S("disarmed", "2:1", { tl: [1, 1], m: 900_500, vv: { 1: 1 } })]],
    want: { heads: ["2:1"], state: "disarmed", dot: "2:1", timeline: [1, 1], mark: 900_500 } },
  { name: "a later action of the same node is above the earlier one, whatever its vector says of the others", anyOrder: false,
    node: { id: 4, ctr: 0, heads: [S("disarmed", "2:2", { tl: [9, 9], m: 5, vv: { 1: 1 } })] },
    takes: [[S("armed_away", "2:3", { tl: [8, 8], m: 1 })]],
    want: { heads: ["2:3"], state: "armed_away", dot: "2:3" } },
  { name: "an ancestor of a head is not added back, and nothing changes", anyOrder: false,
    node: { id: 4, ctr: 0, heads: [S("armed_home", "3:1", { tl: [1, 1], m: 105_000, vv: { 1: 2 } })] },
    takes: [[S("disarmed", "1:2", { tl: [1, 1], m: 104_000, vv: { 1: 2 } })]],
    want: { heads: ["3:1"], state: "armed_home", dot: "3:1", changed: false } },
  { name: "acting replaces the heads that were shown: the new record is the only head and its vector is the join of theirs", anyOrder: false,
    node: { id: 4, ctr: 0, heads: [S("armed_away", "2:1", { tl: [1, 1], m: 500, vv: { 1: 1 } }), S("disarmed", "3:1", { tl: [1, 1], m: 9000, vv: { 1: 2 } })] },
    takes: [],
    act: { kind: "armed_home", up: 60_000 },
    want: { heads: ["4:1"], state: "armed_home", dot: "4:1", timeline: [1, 1], mark: 600, vv: { 1: 2, 2: 1, 3: 1, 4: 1 } } },
];

const digestHex = (heads) => hex(Uint8Array.of(...[24, 16, 8, 0].map((s) => (headsDigest(heads) >>> s) & 255)));

// the batches of copies, taken in the given order; the result is what the vectors record
function runHeadsCase(c, order = c.takes.map((_, i) => i)) {
  const r = new Replica(c.node.id, { heads: c.node.heads.map(fromSpec), ctr: c.node.ctr, epoch: 1, tl: HOUSE_TIMELINE, off: 0 });
  const before = r.sig();
  for (const i of order) r.take(c.takes[i].map(fromSpec));
  if (c.act) r.act(c.act.kind, c.act.up);
  const changed = r.sig() !== before;                               // the heads are not the ones the replica started with
  const rec = r.rec;
  return { heads: r.heads.map((h) => dotText(h.dot)), state: ST_NAME[rec.st], dot: dotText(rec.dot), timeline: [rec.tl.n, rec.tl.e], mark: rec.m, vv: vvSparse(rec.vv), digest: digestHex(r.heads), changed };
}
const permutations = (n) => (n <= 1 ? [Array.from({ length: n }, (_, i) => i)] : permutations(n - 1).flatMap((p) => Array.from({ length: n }, (_, k) => [...p.slice(0, k), n - 1, ...p.slice(k)])));

const RECONCILE_SCRIPTS = [
  { name: "a trigger is repeated until the siren confirms, and only then applied", sirenMs: 300_000, devices: [{ id: "s", kind: "siren" }], desired: { state: "triggered", dot: "2:3" }, passes: [
    { up: 20_000, synced: true, drive: [false], want: { held: false, sent: 1, pending: 1, applied: "0:0" } },
    { up: 23_000, synced: true, drive: [false], want: { held: false, sent: 1, pending: 1, applied: "0:0" } },
    { up: 26_000, synced: true, drive: [true], want: { held: false, sent: 1, pending: 0, applied: "2:3" } },
    { up: 29_000, synced: true, drive: [], want: { held: false, sent: 0, pending: 0, applied: "2:3" } }] },
  { name: "a bridge that is not synced holds: it sends nothing and applies nothing", sirenMs: 300_000, devices: [{ id: "s", kind: "siren" }], desired: { state: "triggered", dot: "2:3" }, passes: [
    { up: 5_000, synced: false, drive: [], want: { held: true, sent: 0, pending: 0, applied: "0:0" } }] },
  { name: "a siren that never heard the disarm stops at its own time, and the trigger is not re-sounded", sirenMs: 60_000, devices: [{ id: "s", kind: "siren" }], desired: { state: "triggered", dot: "2:3" }, passes: [
    { up: 20_000, synced: true, drive: [true], want: { held: false, sent: 1, pending: 0, applied: "2:3" } },
    { up: 79_000, synced: true, drive: [], want: { held: false, sent: 0, pending: 0, applied: "2:3" } },
    { up: 80_000, synced: true, drive: [true], want: { held: false, sent: 1, pending: 0, applied: "2:3" } },
    { up: 83_000, synced: true, drive: [], want: { held: false, sent: 0, pending: 0, applied: "2:3" } }] },
  { name: "a restart forgets what the devices confirmed: the first pass asserts the target even when it is OFF (A01)", sirenMs: 300_000, devices: [{ id: "s", kind: "siren" }, { id: "z", kind: "sensor" }], desired: { state: "disarmed", dot: "3:1" }, passes: [
    { up: 12_000, synced: true, drive: [true], want: { held: false, sent: 1, pending: 0, applied: "3:1" } },
    { up: 15_000, synced: true, drive: [], want: { held: false, sent: 0, pending: 0, applied: "3:1" } }] },
];

function runReconcile(sc) {
  const stub = { rec: { st: ST[sc.desired.state], dot: parseDot(sc.desired.dot) }, synced: true, isSynced() { return this.synced; } };
  const bridge = new Bridge(stub, sc.devices, { sirenMs: sc.sirenMs });
  return sc.passes.map((p) => {
    stub.synced = p.synced;
    const answers = [...p.drive];
    const r = bridge.reconcile(p.up, () => { if (!answers.length) throw new Error("the script gave no answer for a device that was sent a command"); return answers.shift(); });
    assert.equal(answers.length, 0, `${sc.name}: every scripted answer was used`);
    return { held: r.held, sent: r.sent, pending: r.pending, applied: dotText(bridge.applied) };       // a dot of 0 is "none": "0:0"
  });
}

// a script of admissions: the issuer stamps once (at issuerUp); the owner admits at ownerUp, and may restart in between
function runFreshnessScript(sc) {
  const issuer = steadyReplica(1, "armed_away"), owner = steadyReplica(2, "armed_away");
  if (sc.issuerRestarts) issuer.reboot();
  const cmd = stampCommand(issuer, sc.issuerUp, { to: "light" });
  if (sc.issuerRestarts) return cmd;
  const got = [];
  for (const step of sc.steps) {
    if (step.ownerRestarts) { owner.reboot(); continue; }
    const r = admitCommand(owner, cmd, step.ownerUp);
    got.push(Object.fromEntries(Object.keys(step.want).map((k) => [k, r[k]])));
  }
  return got;
}

const FRESHNESS_VECTORS = FRESH_CASES.map((c) => ({ name: c.name, issuerUp: c.issuerUp, ownerUp: c.ownerUp, want: { ok: c.ok, reason: c.reason, ageMs: c.ageMs } }));
const FRESHNESS_SCRIPTS = [
  { name: "a recorded retransmission after the owner restarted: refused while it listens, then in another timeline", issuerUp: 50_000_000, steps: [{ ownerUp: 50_000_500, want: { ok: true, reason: "ok", ageMs: 500 } }, { ownerRestarts: true }, { ownerUp: 2_000, want: { ok: false, reason: "owner-not-synced" } }, { ownerUp: 20_000, want: { ok: false, reason: "other-timeline" } }] },
  { name: "an issuer that is not synced issues no stamp", issuerRestarts: true, issuerUp: 5_000, want: null },
];

const REACH_CASES = [
  { name: "everybody applied the current dot", cur: "2:3", owners: [1, 2, 3], applied: { 1: "2:3", 2: "2:3", 3: "2:3" } },
  { name: "one applied an older dot and one is not heard", cur: "2:3", owners: [1, 2, 3], applied: { 1: "2:3", 2: "2:2" } },
  { name: "no owners: nothing is out of reach", cur: "2:3", owners: [], applied: {} },
];
const HEADLINE_CASES = [
  { state: "disarmed", lost: 0, reach: { total: 12, confirmed: 12, missing: [] } },
  { state: "disarmed", lost: 0, reach: { total: 12, confirmed: 9, missing: [3, 7, 9] } },
  { state: "armed_away", lost: 0, reach: { total: 3, confirmed: 3, missing: [] } },
  { state: "armed_home", lost: 0, reach: { total: 3, confirmed: 1, missing: [2, 3] } },
  { state: "armed_away", lost: 2, reach: { total: 3, confirmed: 3, missing: [] } },
  { state: "armed_away", lost: 2, reach: { total: 3, confirmed: 2, missing: [3] } },
  { state: "triggered", lost: 0, reach: { total: 3, confirmed: 2, missing: [3] } },
];

// seeded random pairs of records for the port to fuzz its merge against: the answer of the reference, and the layer that decided
function mergeFuzzCases(count) {
  return randomPairs(count, 2026).map(({ a, b, ra, rb }) => {
    const r = merge(ra, rb);
    return { a, b, win: r.win === ra && r.win !== rb ? "a" : r.win === rb && r.win !== ra ? "b" : "same", layer: r.layer };
  });
}

function buildVectors() {
  const situations = SITUATIONS.map((sc) => {
    const w = runScenario(sc);
    return { id: sc.id, title: sc.title, base: sc.base, nodes: sc.nodes, ...(sc.skew ? { skew: sc.skew } : {}), steps: sc.steps, want: sc.want, final: w.snapshot() };
  });
  const hazards = HAZARDS.map((h) => ({
    id: h.id, title: h.title, base: h.base, nodes: h.nodes, steps: h.steps,
    decided: runScenario(h).snapshot(),
    old: { states: runScenario(h, { makeReplica: VARIANTS.old.make }).states(), note: "the first design (8 points of history, one record): a control that is NOT to be ported, here to show what the rule replaced" },
    want: { decided: h.decided, old: h.old },
  }));
  const digestSets = [[], [baseRecord("armed_away")], RECORD_SAMPLES.map((r) => fromSpec(r.record)).sort((x, y) => x.dot - y.dot)];
  return {
    about: "The alarm-state order rule (the version vector and the set of heads) and what hangs from it: written by libs/nspanel-sim/vm/test/alarm-merge.test.mjs from the reference implementation libs/nspanel-sim/vm/test/alarm-merge-ref.mjs, which also checks this file is current. The Berry port replays every section and must give the same answers. The format is documented in the header of the test.",
    constants: { TICK_MS, LISTEN_MS, ADOPT_EPS_MS, RESYNC_MAX_MS, STAMP_TICK_MS, FRESH_WINDOW_MS, FUTURE_TOLERANCE_MS, RECONCILE_MS, SIREN_MS, MAX_NODE, MAX_HEADS, MAX_COUNTER, VV_BYTES, RECORD_BYTES, HEADS_MAX_BYTES, HEARTBEAT_BYTES, STAMP_BYTES, BASE_UP_MS, house_timeline: [HOUSE_TIMELINE.n, HOUSE_TIMELINE.e] },
    dots: [["1:1", mkDot(1, 1)], ["2:5", mkDot(2, 5)], ["15:1048575", mkDot(15, MAX_COUNTER)]],
    records: RECORD_SAMPLES.map((r) => ({ name: r.name, record: r.record, wire: hex(encodeRecord(fromSpec(r.record))) })),
    invalid: INVALID_RECORD_CASES,
    hello: [
      { hello: { timeline: [1, 1], mesh: 90_000_000, digest: headsDigest([baseRecord("armed_away")]), heads: 1, synced: true }, applied: "2:2", wire: hex(encodeHello({ tl: { n: 1, e: 1 }, mesh: 90_000_000, digest: headsDigest([baseRecord("armed_away")]), count: 1, synced: true }, parseDot("2:2"))) },
      { hello: { timeline: [15, 4_000_000_000], mesh: 281_474_976_710_655, digest: 0xdeadbeef, heads: 15, synced: false }, applied: "0:0", wire: hex(encodeHello({ tl: { n: 15, e: 4_000_000_000 }, mesh: 281_474_976_710_655, digest: 0xdeadbeef, count: 15, synced: false }, 0)) },
    ],
    digest: digestSets.map((hs) => ({ heads: hs.map(toSpec), digest: digestHex(hs) })),
    stamp: [{ stamp: { tag: tlTag({ n: 1, e: 1 }), issued: 5_000_000 }, wire: hex(encodeStamp({ tag: tlTag({ n: 1, e: 1 }), issued: 5_000_000 })) }],
    merge: MERGE_CASES.map((c) => ({ name: c.name, a: c.a, b: c.b, win: c.win, layer: c.layer })),
    mergeFuzz: mergeFuzzCases(150),
    epoch: EPOCH_CASES.map((c) => ({ ...c, want: runEpochCase(c) })),
    timeline: TIMELINE_CASES.map((c) => ({ name: c.name, node: c.node, up: c.up, hello: c.hello, want: runTimelineCase(c) })),
    heads: HEADS_CASES.map((c) => ({ name: c.name, anyOrder: c.anyOrder, node: c.node, takes: c.takes, ...(c.act ? { act: c.act } : {}), want: runHeadsCase(c) })),
    situations,
    hazards,
    freshness: { cases: FRESHNESS_VECTORS, scripts: FRESHNESS_SCRIPTS },
    reconcile: RECONCILE_SCRIPTS.map((sc) => ({ ...sc, passes: sc.passes.map((p, i) => ({ ...p, want: runReconcile(sc)[i] })) })),
    reach: REACH_CASES.map((c) => ({ ...c, want: reachOf(parseDot(c.cur), c.owners, new Map(Object.entries(c.applied).map(([k, v]) => [Number(k), parseDot(v)]))) })),
    headline: HEADLINE_CASES.map((c) => ({ ...c, want: headline({ st: ST[c.state], lost: c.lost }, { ...c.reach, complete: c.reach.missing.length === 0 }) })),
  };
}

test("I the vectors: each hand-written expectation holds in the reference, and berry/test/vectors/alarm_merge.json is the reference's output", () => {
  // what is written by hand is checked against the reference before it is written down
  for (const c of TIMELINE_CASES) {
    const got = runTimelineCase(c);
    if (c.name.startsWith("the younger")) { assert.equal(got.adopted, true); assert.deepEqual(got.timeline, [1, 1]); assert.equal(got.record.mark, 600 + Math.round((90_000_000 - 61_000) / 100)); }
    if (c.name.startsWith("the older")) assert.equal(got.adopted, false);
    if (c.name.startsWith("a record from")) assert.deepEqual(got.record, { timeline: [3, 7], mark: 5000 });
    if (c.name.startsWith("the same timeline: a larger")) assert.deepEqual([got.adopted, got.off], [false, 50]);
    if (c.name.startsWith("the same timeline: an hour")) assert.deepEqual([got.adopted, got.off], [false, 0]);
    if (c.name.includes("this side (the larger id)")) assert.deepEqual([got.adopted, got.timeline], [true, [1, 4]]);
    if (c.name.includes("this side (the smaller id)")) assert.deepEqual([got.adopted, got.timeline], [false, [1, 4]]);
  }
  for (const c of EPOCH_CASES) assert.deepEqual(runEpochCase(c), c.want, c.name);
  for (const r of RECORD_SAMPLES) {
    const bytes = encodeRecord(fromSpec(r.record));
    assert.equal(bytes.length, 52);
    assert.deepEqual(toSpec(decodeRecord(bytes)), r.record);
    assert.deepEqual(decodeRecord(unhex(hex(bytes))), fromSpec(r.record));
  }
  for (const c of HEADS_CASES) {
    const got = runHeadsCase(c);
    for (const [k, v] of Object.entries(c.want)) assert.deepEqual(got[k], v, `${c.name}: ${k}`);
    if (c.anyOrder) for (const order of permutations(c.takes.length)) assert.deepEqual(runHeadsCase(c, order), got, `${c.name}: order ${order}`);
  }
  for (const sc of FRESHNESS_SCRIPTS) {
    const got = runFreshnessScript(sc);
    if (sc.issuerRestarts) assert.equal(got, sc.want, sc.name);
    else assert.deepEqual(got, sc.steps.filter((x) => x.want).map((x) => x.want), sc.name);
  }
  const fuzz = mergeFuzzCases(150);
  assert.ok(new Set(fuzz.map((c) => c.layer)).size === 5, "the fuzz pairs reach every layer");
  for (const sc of RECONCILE_SCRIPTS) {
    const got = runReconcile(sc);
    sc.passes.forEach((p, i) => assert.deepEqual(got[i], p.want, `${sc.name}, pass ${i + 1}`));
  }
  for (const c of REACH_CASES) {
    const r = reachOf(parseDot(c.cur), c.owners, new Map(Object.entries(c.applied).map(([k, v]) => [Number(k), parseDot(v)])));
    assert.equal(r.complete, c.owners.length === Object.entries(c.applied).filter(([, v]) => v === c.cur).length);
  }
  const built = JSON.parse(JSON.stringify(buildVectors()));
  if (process.env.ALARM_MERGE_UPDATE_VECTORS) {
    fs.writeFileSync(VECTORS, `${JSON.stringify(built, null, 1)}\n`);
    return;
  }
  assert.ok(fs.existsSync(VECTORS), "berry/test/vectors/alarm_merge.json is missing: run with ALARM_MERGE_UPDATE_VECTORS=1");
  const onDisk = JSON.parse(fs.readFileSync(VECTORS, "utf8"));
  assert.deepEqual(onDisk, built, "the vectors are out of date: run with ALARM_MERGE_UPDATE_VECTORS=1 and read the diff");
});
