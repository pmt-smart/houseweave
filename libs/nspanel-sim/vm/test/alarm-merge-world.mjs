// The simulated house the alarm-merge tests run the reference replicas in (see alarm-merge-ref.mjs and alarm-merge.test.mjs).
//
// It owns what the replicas must NOT own: the TRUE time (the one nobody on the device knows), each node's crystal (a drift of
// some tens of ppm, and the power cut that restarts its uptime), the radio (a few ms of latency per hop), the partitions of the
// mesh, and the wall clock (decoys: a wrong date, or none, per node; the rule never reads them, and the controls do, to show the
// tests can see it). It also owns an ORACLE: the full causal history of every action, which a replica only has as far as its rule keeps
// it (the first design carried 8 points; the decided rule carries a version vector), so the tests can say whether a copy that won was
// really older than one that lost.
//
// Two ways to drive it.
//
// 1. EXPLICIT SCRIPTS (the 12 situations, and any case written by hand). Steps, in seconds of true time; the same semantics the
//    Berry port must give the vectors in berry/test/vectors/alarm_merge.json:
//      ["boot",  node, secs, opts?]           a power cut and boot: uptime restarts, the persisted record stays
//      ["act",   node, action, secs, opts?]   a person (or a sensor, for "triggered") acts at that node; opts.lost is the count of who was left out
//      ["hear",  hearer, sender, secs]        one way: the hearer takes the sender's heartbeat (timeline rule) and then its copy
//      ["meet",  a, b, secs]                  two ways: both heartbeats first (the younger timeline adopts the older, translating
//                                             its own record), then both copies are taken
//      ["meetAll", secs]                      every pair meets, in order of declaration, round after round (5 s apart) until a
//                                             whole round changes nothing
//    Nothing happens between steps: two nodes that never meet never exchange anything.
//
// 2. RANDOM RUNS (the property tests). The mesh is a set of GROUPS (partitions). Nodes of one group hear each other's heartbeats
//    all the time, so before every event the group is brought up to date (the pairs meet in a seeded random order, until nothing
//    changes) and a node that has just booted joins its group only after READY_MS (the first heartbeat). An event can cut or
//    join the groups. The order of every meeting comes from a seed, so the same events with other seeds are "another order of
//    joins", and a run is replayed exactly from its events and its seed.
import { steadyReplica, ST, ST_NAME, isArmed } from "./alarm-merge-ref.mjs";

export const sec = (s) => Math.round(s * 1000);
export const READY_MS = 6_000;           // a node that booted is heard by its group from the first heartbeat (5 s) and a margin

// A small deterministic PRNG (mulberry32): the same seed gives the same run on any machine.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class World {
  // names: the nodes (node i has the id i+1). base: the state every node starts with, in the steady timeline of the house.
  // makeReplica(id, base): the replica under test (the reference one, a variant, or a control that reads the wall clock).
  constructor({ names, base = "armed_away", makeReplica = (id, st) => steadyReplica(id, st), ppm = [], seed = 1 }) {
    this.names = names;
    this.nodes = names.map((name, i) => ({
      name, id: i + 1, r: makeReplica(i + 1, base), boot: -10_000_000, since: -Infinity, ppm: ppm[i] ?? 0, wallReads: 0,
      wallSkew: 0, wallValid: true,
    }));
    this.truth = new Map();
    this.known = this.nodes.map(() => new Set());
    const b = this.nodes[0].r.rec;
    this.truth.set(b.dot, { dot: b.dot, kind: ST_NAME[b.st], t: 80_000, node: 0, anc: new Set(), human: true, rec: b });
    for (const k of this.known) k.add(b.dot);
    this.merges = [];
    this.now = 0;
    this.groups = null;                       // null: scripted mode (nothing happens unless a step says so)
    this.rng = mulberry32(seed * 104729 + 7);
  }

  idx(x) { return typeof x === "number" ? x : this.names.indexOf(x); }
  up(i, t) { const n = this.nodes[i]; return Math.max(0, Math.floor((t - n.boot) * (1 + n.ppm * 1e-6))); }

  boot(i, t, opts = {}) {
    i = this.idx(i);
    const n = this.nodes[i];
    n.boot = t;
    n.since = t;
    // a boot whose epoch could not be saved takes a random one (here a hash of the node and the time); opts.collide reuses the old
    // epoch instead, which is what the rule must NOT do (the test of finding F3 forces it)
    const failed = opts.epochOk === false;
    n.r.reboot({ epochOk: !failed, epoch: failed ? (opts.collide ? n.r.epoch : (Math.imul(n.id, 2654435761) ^ Math.floor(t)) >>> 0) : undefined });
    n.wallValid = !!opts.wall;                       // a decoy: the wall clock after a boot is usually not valid
    n.bridge?.restart();
    // what a node knows after a restart: what its persisted copies have in their past
    this.known[i] = new Set();
    for (const rec of n.r.offer()) { this.known[i].add(rec.dot); for (const d of this.truth.get(rec.dot).anc) this.known[i].add(d); }
    this.now = Math.max(this.now, t);
  }

  act(i, kind, t, opts = {}) {
    i = this.idx(i);
    const n = this.nodes[i];
    if (kind === "triggered" && n.r.rec.st === ST.disarmed) return null;       // a sensor only trips an armed alarm
    this.now = Math.max(this.now, t);
    const rec = n.r.act(kind, this.up(i, t), {
      lost: opts.lost ?? 0,
      get wallClock() { n.wallReads++; return n.wallValid ? t + n.wallSkew : t - n.boot; },   // controls read it; the reference must not (no clock after a boot: it counts from the boot)
    });
    this.truth.set(rec.dot, { dot: rec.dot, kind, t, node: i, anc: new Set(this.known[i]), human: kind !== "triggered", rec });
    this.known[i].add(rec.dot);
    return rec;
  }

  _take(i, recs, t, from) {
    const n = this.nodes[i];
    const before = n.r.rec;
    const res = n.r.take(recs);
    // the log keeps only the decisions that needed more than "the same copy" or "a copy that descends" (and that is what the tests ask)
    if (res.layer !== "same" && res.layer !== "descent") this.merges.push({ t, at: i, from, layer: res.layer, a: before, b: recs[0], win: res.win });
    const known = this.known[i];
    for (const rec of recs) {
      if (known.has(rec.dot)) continue;                      // what a node knows is closed under ancestry: nothing to add
      known.add(rec.dot);
      for (const d of this.truth.get(rec.dot).anc) known.add(d);
    }
    return res;
  }

  hear(i, j, t, lat = 0) {
    i = this.idx(i); j = this.idx(j);
    const h = this.nodes[j].r.hello(this.up(j, t));
    this.nodes[i].r.hear(h, this.up(i, t + lat));
    this._take(i, this.nodes[j].r.offer(), t, j);
    this.now = Math.max(this.now, t + lat);
  }

  meet(i, j, t, lat = 0) {
    i = this.idx(i); j = this.idx(j);
    const ni = this.nodes[i], nj = this.nodes[j];
    const hi = ni.r.hello(this.up(i, t)), hj = nj.r.hello(this.up(j, t));
    ni.r.hear(hj, this.up(i, t + lat));
    nj.r.hear(hi, this.up(j, t + lat));
    const ri = ni.r.offer(), rj = nj.r.offer();
    this._take(i, rj, t, j);
    this._take(j, ri, t, i);
    this.now = Math.max(this.now, t + lat);
  }

  // every pair of `ids` meets, round after round, until a whole round changes nothing. `order` reorders the pairs of a round.
  _settle(ids, t, { order = null, lat = () => 0, spacing = 5_000 } = {}) {
    let rounds = 0;
    const sig = () => ids.map((i) => this.nodes[i].r.sig()).join(",");
    for (; rounds < 40; rounds++) {
      const before = sig();
      let pairs = [];
      for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) pairs.push([ids[a], ids[b]]);
      if (order) pairs = order(pairs);
      for (const [i, j] of pairs) this.meet(i, j, t + rounds * spacing, lat());
      if (sig() === before) { rounds++; break; }
    }
    return rounds;
  }

  meetAll(t) { return this._settle(this.nodes.map((_, i) => i), t); }

  // --- random runs: the mesh as groups ---
  setGroups(groups) { this.groups = groups; }
  _shuffle(pairs) { return pairs.map((p) => [this.rng(), p]).sort((x, y) => x[0] - y[0]).map((x) => x[1]); }
  syncGroups(t) {
    for (const g of this.groups) {
      const ready = g.filter((i) => t - this.nodes[i].since >= READY_MS);
      if (ready.length < 2) continue;
      const first = this.nodes[ready[0]].r;
      const quiet = ready.every((i) => this.nodes[i].r.sig() === first.sig() && this.nodes[i].r.tl.n === first.tl.n && this.nodes[i].r.tl.e === first.tl.e);
      if (!quiet) { this._settle(ready, t, { order: (p) => this._shuffle(p), lat: () => 1 + Math.floor(this.rng() * 7), spacing: 0 }); continue; }
      // everybody already holds the same copy on the same timeline: only the clocks follow the fastest, the way the heartbeats make them
      let lead = ready[0];
      for (const i of ready) if (this.nodes[i].r.mesh(this.up(i, t)) > this.nodes[lead].r.mesh(this.up(lead, t))) lead = i;
      const h = this.nodes[lead].r.hello(this.up(lead, t));
      for (const i of ready) if (i !== lead) this.nodes[i].r.hear(h, this.up(i, t + 3));
    }
  }

  states() { return this.nodes.map((x) => x.r.state); }
  agreed() {
    const s = new Set(this.nodes.map((x) => x.r.sig()));
    return s.size === 1 ? this.nodes[0].r.rec : null;
  }
  agreedState() { const a = new Set(this.states()); return a.size === 1 ? [...a][0] : null; }

  snapshot() { return this.nodes.map((x) => ({ node: x.name, ...x.r.describe() })); }
}

// --- scripted scenarios ---------------------------------------------------------------------------------------------------

export function runScenario(sc, { makeReplica, ppm } = {}) {
  const w = new World({ names: sc.nodes, base: sc.base, makeReplica, ppm });
  for (const [name, secs] of Object.entries(sc.skew ?? {})) w.nodes[w.idx(name)].wallSkew = sec(secs);   // decoys: a wall clock that is wrong
  for (const step of sc.steps) {
    const [op, ...a] = step;
    switch (op) {
      case "boot": w.boot(a[0], sec(a[1]), a[2] ?? {}); break;
      case "act": w.act(a[0], a[1], sec(a[2]), a[3] ?? {}); break;
      case "hear": w.hear(a[0], a[1], sec(a[2])); break;
      case "meet": w.meet(a[0], a[1], sec(a[2])); break;
      case "meetAll": w.meetAll(sec(a[0])); break;
      default: throw new Error(`unknown step ${op}`);
    }
  }
  return w;
}

// --- random runs ------------------------------------------------------------------------------------------------------------

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const weighted = (rng, table) => {
  let total = 0; for (const [, w] of table) total += w;
  let x = rng() * total;
  for (const [v, w] of table) { x -= w; if (x < 0) return v; }
  return table[table.length - 1][0];
};
const range = (n) => Array.from({ length: n }, (_, i) => i);
const shuffle = (rng, arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// A run is plain data: { seed, n, base, ppm, events, profile }. Events (times in ms of true time, increasing):
//   ["act", node, action, t, lost]   ["boot", node, t, epochOk, wallValid, collide?]   ["split", t, groups, skipSync]   ["skew", node, t, ms]
// profile: "mixed" (everything), "armOnly" (no disarm action ever: then the house is never disarmed), "lonely" (one node keeps leaving and
// restarting alone), "blackout" (the whole house loses power and boots staggered, more often), "shelf" (one node sits on a
// shelf for the whole run: the stale copy that comes back), "shelfArm" (the same with nothing but arms).
export function genRun(seed, { n = 0, steps = 0, base = "", profile = "mixed", maxActions = Infinity, reboots = true, exactClocks = false } = {}) {
  const rng = mulberry32(seed * 7919 + 13);
  n = n || 2 + Math.floor(rng() * 7);
  steps = steps || 12 + Math.floor(rng() * 60);
  base = base || (rng() < 0.5 ? "armed_away" : "disarmed");
  const ppm = range(n).map(() => (exactClocks ? 0 : Math.round((rng() * 80 - 40) * 10) / 10));
  const lonely = Math.floor(rng() * n);
  let t = sec(100);
  let groups = [range(n)];
  const events = [];
  let actions = 0;
  const shelf = profile === "shelf" || profile === "shelfArm";
  const kinds = profile === "armOnly" || profile === "shelfArm"
    ? [["armed_home", 20], ["armed_away", 55], ["triggered", 25]]
    : [["disarmed", 38], ["armed_home", 14], ["armed_away", 32], ["triggered", 16]];
  const others = range(n).filter((i) => i !== lonely);
  if (shelf || profile === "lonely") { groups = [[lonely], others]; events.push(["split", t, groups, false]); }
  for (let s = 0; s < steps; s++) {
    const r = rng();
    t += Math.floor(r < 0.7 ? 1000 + rng() * 60_000 : r < 0.95 ? 60_000 + rng() * 1_800_000 : 1_800_000 + rng() * 3_456_000_000);
    const table = [["act", 26], ["split", shelf ? 0 : 9], ["join", shelf ? 0 : 7], ["skew", 3]];
    if (reboots) table.push(["boot", profile === "lonely" ? 18 : 8], ["blackout", profile === "blackout" ? 9 : 1]);
    const ev = weighted(rng, table);
    const wholeHouse = shelf ? others : range(n);
    if (ev === "act") {
      if (actions >= maxActions) continue;
      const node = shelf ? pick(rng, others) : profile === "lonely" && rng() < 0.6 ? lonely : Math.floor(rng() * n);
      const kind = weighted(rng, kinds);
      events.push(["act", node, kind, t, isArmed(ST[kind]) && kind !== "triggered" && rng() < 0.2 ? 1 + Math.floor(rng() * 3) : 0]);
      actions++;
    } else if (ev === "boot") {
      const node = shelf ? pick(rng, others) : profile === "lonely" && rng() < 0.6 ? lonely : Math.floor(rng() * n);
      events.push(["boot", node, t, rng() < 0.97, rng() < 0.4]);
    } else if (ev === "blackout") {
      let tb = t;
      for (const node of shuffle(rng, wholeHouse)) { tb += Math.floor(rng() * 90_000); events.push(["boot", node, tb, true, false]); }
      t = tb;
    } else if (ev === "split") {
      const k = 1 + Math.floor(rng() * Math.min(4, n));
      groups = Array.from({ length: k }, () => []);
      for (const i of range(n)) groups[Math.floor(rng() * k)].push(i);
      if (profile === "lonely") groups = [[lonely], others];
      groups = groups.filter((g) => g.length);
      events.push(["split", t, groups, rng() < 0.3]);
    } else if (ev === "join") {
      groups = profile === "lonely" ? groups : [range(n)];
      events.push(["split", t, groups, rng() < 0.3]);
    } else if (ev === "skew") {
      events.push(["skew", Math.floor(rng() * n), t, Math.floor((rng() - 0.5) * 2 * 3 * 86_400_000)]);
    }
  }
  return { seed, n, base, ppm, events, profile };
}

export function newWorld(run, makeReplica, seed = 1) {
  return new World({ names: range(run.n).map((i) => String.fromCharCode(65 + i)), base: run.base, makeReplica, ppm: run.ppm, seed });
}

// Replays a run; `healSeed` picks the order of every meeting (the order of the joins). The run ends with the whole mesh joined.
export function playRun(run, { makeReplica, healSeed = 1 } = {}) {
  const w = newWorld(run, makeReplica, healSeed);
  w.setGroups([range(run.n)]);
  for (const ev of run.events) {
    const op = ev[0];
    if (op === "act") { w.syncGroups(ev[3]); w.act(ev[1], ev[2], ev[3], { lost: ev[4] }); }
    else if (op === "boot") { w.syncGroups(ev[2]); w.boot(ev[1], ev[2], { epochOk: ev[3], wall: ev[4], collide: ev[5] }); }
    else if (op === "split") { if (!ev[3]) w.syncGroups(ev[1]); w.setGroups(ev[2]); w.syncGroups(ev[1] + 1); w.now = Math.max(w.now, ev[1]); }
    else if (op === "skew") { w.nodes[ev[1]].wallSkew = ev[3]; }
  }
  w.healStart = w.merges.length;
  w.setGroups([range(run.n)]);
  w.syncGroups(w.now + 60_000);
  return w;
}

// Delta debugging of a run: drop events while `fails(run)` stays true. Returns the smallest run found.
export function shrinkRun(run, fails) {
  let cur = { ...run, events: run.events.slice() };
  let chunk = Math.max(1, cur.events.length >> 1);
  while (chunk >= 1) {
    let progress = false;
    for (let at = 0; at < cur.events.length;) {
      const events = cur.events.slice(0, at).concat(cur.events.slice(at + chunk));
      if (events.length !== cur.events.length && fails({ ...cur, events })) { cur = { ...cur, events }; progress = true; } else at += chunk;
    }
    if (!progress) chunk = chunk >> 1;
  }
  return cur;
}

// --- the 12 situations of the draft model, as scripts -------------------------------------------------
// Times are seconds of TRUE time. The house starts with every node up for 10 000 s, in one timeline, with one initial record
// made at true second 80; "arm" in the draft is "armed_away" here. `want` is the state every node must end with.
export const SITUATIONS = [
  { id: "S1", want: "armed_away", base: "disarmed", nodes: ["A", "B", "C"],
    title: "a copy comes back from a power cut with an old 'disarmed'; the house was armed meanwhile",
    steps: [["boot", "C", 100], ["act", "A", "armed_away", 200], ["hear", "B", "A", 200], ["meetAll", 300]] },
  { id: "S2", want: "disarmed", base: "armed_away", nodes: ["A", "B"],
    title: "armed; in a split someone disarms on one side, nothing else",
    steps: [["act", "B", "disarmed", 150], ["meetAll", 400]] },
  { id: "S3", want: "armed_away", base: "armed_away", nodes: ["A", "B"],
    title: "armed; one side disarms at 150; the other disarms at 160 and arms again at 240",
    steps: [["act", "B", "disarmed", 150], ["act", "A", "disarmed", 160], ["act", "A", "armed_away", 240], ["meetAll", 400]] },
  { id: "S4", want: "disarmed", base: "armed_away", nodes: ["A", "C"],
    title: "armed; a node restarts with no clock, alone, and the owner disarms there; nothing else happens",
    steps: [["boot", "C", 100], ["act", "C", "disarmed", 150], ["meetAll", 400]] },
  { id: "S5", want: "disarmed", base: "armed_away", nodes: ["A", "C"],
    title: "as S4, but the rest of the house disarmed at 120 and armed again at 200; the owner at the lone node disarms at 250",
    steps: [["boot", "C", 100], ["act", "A", "disarmed", 120], ["act", "A", "armed_away", 200], ["act", "C", "disarmed", 250], ["meetAll", 400]] },
  { id: "S6", want: "disarmed", base: "disarmed", nodes: ["A", "D"], skew: { D: 600 },
    title: "a node whose clock is 10 minutes ahead arms; the owner, in contact, disarms two seconds later",
    steps: [["act", "D", "armed_away", 200], ["hear", "A", "D", 200], ["act", "A", "disarmed", 202], ["meetAll", 400]] },
  { id: "S7", want: "disarmed", base: "armed_away", nodes: ["A", "E"], skew: { E: -600 },
    title: "a node whose clock is 10 minutes behind disarms an armed house",
    steps: [["act", "E", "disarmed", 300], ["meetAll", 400]] },
  { id: "S8", want: "disarmed", base: "disarmed", nodes: ["A", "B"],
    title: "the whole house boots with no clock after a power cut; B boots later, hears A, which armed, and disarms",
    steps: [["boot", "A", 50], ["boot", "B", 250], ["act", "A", "armed_away", 150], ["hear", "B", "A", 250], ["act", "B", "disarmed", 300], ["meetAll", 400]] },
  { id: "S9", want: "armed_away", base: "armed_away", nodes: ["Y", "X"],
    title: "half the house loses power at 100 and returns at 300; the other half disarmed at 150 and armed again at 250",
    steps: [["boot", "X", 300], ["act", "Y", "disarmed", 150], ["act", "Y", "armed_away", 250], ["meetAll", 320]] },
  { id: "S10", want: "disarmed", base: "armed_away", nodes: ["Y", "X"],
    title: "the half that came back is alone and the owner there DISARMS at 320; the other half disarmed at 150 and armed at 250",
    steps: [["boot", "X", 300], ["act", "Y", "disarmed", 150], ["act", "Y", "armed_away", 250], ["act", "X", "disarmed", 320], ["meetAll", 400]] },
  { id: "S11", want: "armed_away", base: "armed_away", nodes: ["Y", "X"],
    title: "the half that came back is alone and disarms at 320 (a copy still showed armed); the other half had disarmed at 150 and ARMS at 350",
    steps: [["boot", "X", 300], ["act", "Y", "disarmed", 150], ["act", "X", "disarmed", 320], ["act", "Y", "armed_away", 350], ["meetAll", 400]] },
  { id: "S12", want: "disarmed", base: "armed_away", nodes: ["Y", "X"],
    title: "as S11, but the lone node restarted again at 330 before meeting anyone: its disarm cannot be placed in time",
    steps: [["boot", "X", 300], ["act", "Y", "disarmed", 150], ["act", "X", "disarmed", 320], ["boot", "X", 330], ["act", "Y", "armed_away", 350], ["meetAll", 400]] },
];
