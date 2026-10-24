#!/usr/bin/env node
// What the band of the mesh clock leaves in two timelines, and what the persistence and the time that never go back do about it: nodes that start within
// a few ms to some seconds of each other, each pair with a delay of its own, on crystals of +-40 ppm, with only their heartbeats in the air.
//
//   node scripts/mesh-clock-matrix.mjs [runs]
//
// runs is the whole-house restarts of each kind (300), the pairs and the groups are scaled from it. The module of this build is the core as it is. The core as it was before
// the change is the same source with the header of the fork before it, built to a file of its own, and handed with MESH_BEFORE=<file>:
//   git -C firmware/tasmota show 913060d:tasmota/include/espnow_mesh_core.h > /tmp/before/espnow_mesh_core.h   (and espnow_mesh_crypto.h of the same commit)
//   MESH_INCLUDE=/tmp/before MESH_VARIANT_OUT=/tmp/mesh-before.mjs node scripts/build-mesh-wasm.mjs
// Without it only the core as it is is run. Each kind of run is told as the runs that ended in more than one timeline, how long the others took to be one (from the last
// start), and the most timelines one node took on the way (a node that takes more than there are nodes is going round).
import { pathToFileURL } from "node:url";
import { MeshCore, MeshType, MeshSub, ClockEventKind, MESH, macOf } from "../dist/index.js";

const runsPer = Number(process.argv[2] ?? 300);
const beforeFile = process.env.MESH_BEFORE;
const cores = [];
if (beforeFile) cores.push(["before", await MeshCore.load((await import(pathToFileURL(beforeFile).href)).default)]);
cores.push(["now", await MeshCore.load()]);

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hexOf = (b) => Buffer.from(b).toString("hex");

/** nodes: { id, boot (ms), ppm, seed }; lat(sender, receiver, rng) the ms a heartbeat takes; one run until `untilMs`, or until the nodes have been in one timeline for `quietMs` */
function run(core, nodes, { lat, rng, untilMs = 180_000, stepMs = 100, quietMs = 0, loss = 0 }) {
  const slots = nodes.map((nd, i) => ({ ...nd, slot: i, on: false, epoch: 1, took: 0, lastTaken: 0 }));
  const local = (nd, t) => Math.floor((t - nd.boot) * (1 + nd.ppm * 1e-6));
  let pending = [], unifiedSince = null, lastTaken = 0;
  const lastBoot = Math.max(...nodes.map((n) => n.boot));
  for (let t = Math.floor(Math.min(...nodes.map((n) => n.boot))); t <= untilMs; t += stepMs) {
    for (const nd of slots) {
      if (nd.on || t < nd.boot) continue;
      nd.on = true;
      core.begin(nd.slot, nd.id, { epoch: nd.epoch, seed: nd.seed, clock: true, beatMs: 5000 });
      core.tick(nd.slot, 0);
      for (const o of slots) if (o !== nd) { core.synced(o.slot, nd.id, nd.epoch, 0); if (o.on) core.synced(nd.slot, o.id, o.epoch, 0); }
    }
    const due = pending.filter((p) => p.at <= t).sort((a, b) => a.at - b.at);
    if (due.length) {
      pending = pending.filter((p) => p.at > t);
      for (const p of due) {
        core.receive(p.to.slot, p.bytes, macOf(p.from.id), -60, local(p.to, p.at) >>> 0);
        for (let e = core.popClockEvent(p.to.slot); e; e = core.popClockEvent(p.to.slot)) if (e.kind === ClockEventKind.Timeline) { p.to.took++; lastTaken = p.at; }
      }
    }
    for (const nd of slots) {
      if (!nd.on) continue;
      const L = local(nd, t) >>> 0;
      core.tick(nd.slot, L);
      for (let o = core.nextTx(nd.slot, L); o; o = core.nextTx(nd.slot, L)) {
        core.txDone(nd.slot, true, L);
        if ((o.bytes[1] >> 5) !== MeshType.Beat || o.bytes[MESH.HEADER] !== MeshSub.Beat) continue;
        for (const r of slots) if (r !== nd && r.on && !(loss && rng() < loss)) pending.push({ at: t + lat(nd, r, rng), to: r, from: nd, bytes: o.bytes });
      }
    }
    if (quietMs && t % 1000 === 0 && slots.every((s) => s.on)) {
      const one = new Set(slots.map((nd) => hexOf(core.clock(nd.slot, local(nd, t) >>> 0).timeline))).size === 1;
      if (one) { unifiedSince ??= t; if (t - Math.max(unifiedSince, lastTaken) >= quietMs) break; } else unifiedSince = null;
    }
  }
  const timelines = new Set(slots.map((nd) => hexOf(core.clock(nd.slot, local(nd, untilMs) >>> 0).timeline))).size;
  return { timelines, settled: Math.max(0, lastTaken - lastBoot), most: Math.max(...slots.map((s) => s.took)), n: slots.length, slots };
}

const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const sec = (ms) => (Number.isNaN(ms) ? "-" : (ms / 1000).toFixed(1));
const PPM = [38.1, -35.4, 12.2, -40, 27.7, -3.3, 39.9, -21, 5.5, -33.3, 18, -8.1, 31.2, -26.4, 22, -17, 3, -29, 36, -12, 9, -38, 14, -5, 30, -24, 11, -2, 25, -35];
const keptDelays = (rng) => { const m = new Map(); return (a, r) => { const k = a.id * 64 + r.id; if (!m.has(k)) m.set(k, 1 + Math.floor(rng() * 7)); return m.get(k); }; };
const drawnDelay = (a, r, rng) => 1 + Math.floor(rng() * 7);

console.log(`${runsPer} whole-house restarts of each kind, 3 minutes each (a node's boot drawn within the spread; the delay of a heartbeat drawn at every reception or kept for the pair)`);
console.log("nodes  spread  delays  core     in 2+ timelines  to one timeline, from the last start: median / 90% / slowest (s)  most taken by a node");
for (const n of [15, 30]) for (const spread of [200, 1000, 3000, 10000]) for (const delays of ["drawn", "kept"]) for (const [name, core] of cores) {
  let apart = 0, most = 0;
  const settle = [];
  for (let seed = 1; seed <= runsPer; seed++) {
    const rng = mulberry32(seed);
    const nodes = Array.from({ length: n }, (_, i) => ({ id: i + 1, boot: Math.floor(rng() * spread), ppm: PPM[i % PPM.length] * (i >= PPM.length ? -1 : 1), seed: 1 + (i + 1) * 7919 }));
    const r = run(core, nodes, { lat: delays === "kept" ? keptDelays(rng) : drawnDelay, rng });
    if (r.timelines > 1) apart++; else settle.push(r.settled);
    most = Math.max(most, r.most);
  }
  console.log(`${String(n).padStart(4)}  ${String(spread).padStart(6)}  ${delays.padEnd(6)}  ${name.padEnd(7)}  ${String(apart).padStart(5)} of ${runsPer}      ${sec(q(settle, 0.5))} / ${sec(q(settle, 0.9))} / ${sec(Math.max(...settle))}                                  ${most}`);
}

console.log("\ntwo nodes whose clocks started `gap` ms apart, the older with the higher identity (the case of the window) and the other way round, every delay of 1, 4 and 7 ms each way, two pairs of crystals");
console.log("core     runs   left in two timelines   the gaps (ms) of those   most taken by a node   slowest to one (s)");
for (const [name, core] of cores) {
  let runs = 0, apart = 0, most = 0, slowest = 0;
  const gaps = new Set();
  for (const olderHigher of [true, false]) for (let gap = 0; gap <= 60; gap++) for (const l1 of [1, 4, 7]) for (const l2 of [1, 4, 7]) for (const [pa, pb] of [[0, 0], [40, -40]]) {
    const older = olderHigher ? 5 : 2, younger = olderHigher ? 2 : 5;
    const nodes = [{ id: older, boot: 1000, ppm: pa, seed: 11 + older }, { id: younger, boot: 1000 + gap, ppm: pb, seed: 17 + younger }];
    const r = run(core, nodes, { lat: (a) => (a.id === younger ? l1 : l2), rng: mulberry32(gap * 31 + l1 * 7 + l2), untilMs: 120_000, stepMs: 10, quietMs: 40_000 });
    runs++;
    if (r.timelines > 1) { apart++; gaps.add(gap); } else slowest = Math.max(slowest, r.settled);
    most = Math.max(most, r.most);
  }
  const g = [...gaps].sort((a, b) => a - b);
  console.log(`${name.padEnd(7)}  ${String(runs).padStart(5)}   ${String(apart).padStart(6)}                  ${g.length ? `${g[0]} to ${g[g.length - 1]}` : "none"}`.padEnd(75) + `${most}                      ${sec(slowest)}`);
}

console.log("\ngroups of nodes starting within the spread, a delay of 1 to 7 ms kept for each pair, identities in any order, crystals of +-40 ppm");
console.log("nodes  spread  core     in 2+ timelines   most taken by a node   runs in which a node took as many as there are nodes   slowest to one (s)");
for (const [n, spread] of [[3, 40], [6, 40], [15, 200]]) for (const [name, core] of cores) {
  let apart = 0, most = 0, around = 0, slowest = 0;
  const groupRuns = Math.max(40, Math.floor(runsPer / 2));
  for (let seed = 1; seed <= groupRuns; seed++) {
    const rng = mulberry32(seed * 7919 + n);
    const pool = Array.from({ length: 40 }, (_, i) => i + 1);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const nodes = pool.slice(0, n).map((id) => ({ id, boot: 1000 + Math.floor(rng() * (spread + 1)), ppm: (rng() * 2 - 1) * 40, seed: 1 + seed * 31 + id * 7919 }));
    const r = run(core, nodes, { lat: keptDelays(rng), rng, untilMs: 120_000, stepMs: 10, quietMs: 40_000 });
    if (r.timelines > 1) apart++; else slowest = Math.max(slowest, r.settled);
    most = Math.max(most, r.most);
    if (r.most >= n) around++;
  }
  console.log(`${String(n).padStart(4)}  ${String(spread).padStart(6)}  ${name.padEnd(7)}  ${String(apart).padStart(5)} of ${groupRuns}    ${String(most).padStart(4)}                   ${String(around).padStart(5)}                                                  ${sec(slowest)}`);
}
