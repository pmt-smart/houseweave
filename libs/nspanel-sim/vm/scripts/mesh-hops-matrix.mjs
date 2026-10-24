#!/usr/bin/env node
// What the hops of a flood do: the houses of the scale study (14, 30, 32 and 40 nodes) and corridors of rooms in a row, with a node that leaves with 3
// repeats, with 5, and with the two mixed in one house. For each house: the diameter of the radio graph, the share of the nodes each flood reaches, the frames on the air for
// a flood, the time to the last delivery, and the commands that ask for an answer, delivered and answered, by the hops between the two nodes.
//
//   node scripts/mesh-hops-matrix.mjs [seeds] [loss] [signal floor in dBm] [metres between the rooms]
//
// The module of this build is the one with 5. The one with 3 is built from the same source with the constant the other way:
//   MESH_DEFINES=ESPNOW_MESH_MAX_HOPS=3 MESH_VARIANT_OUT=/tmp/mesh-h3.mjs node scripts/build-mesh-wasm.mjs
// and handed to this with MESH_H3=/tmp/mesh-h3.mjs; without it only the 5 is run. In the mixed houses each node is of the build its number says (alt: the even
// numbers are 5, the odd 3; half: the first half is 3, the second 5; first5: only node 1 is 5), the nodes of the two builds on one air through a core that
// gives each slot to the module of its build. Every node knows every other (syncAll) and the house has run 30 s of heartbeats when the floods start.
import { pathToFileURL } from "node:url";
import { MeshAir, MeshCore, MeshType } from "../dist/index.js";

const [seedsArg = "3", lossArg = "0", floorArg = "-90", metresArg = "6"] = process.argv.slice(2);
const seeds = Number(seedsArg), loss = Number(lossArg), floor = Number(floorArg), metres = Number(metresArg);
const h3File = process.env.MESH_H3;
const create3 = h3File ? (await import(pathToFileURL(h3File).href)).default : null;

// the functions of the core that take the slot of a node first: a house of mixed builds sends each to the module its node is of
const slotFirst = new Set(Object.getOwnPropertyNames(MeshCore.prototype).filter((name) => name !== "constructor" && /^[A-Za-z]+\(slot\b/.test(MeshCore.prototype[name].toString())));
function mixedCore(c5, c3, buildOfSlot) {
  return new Proxy(c5, {
    get(target, prop) {
      const f = target[prop];
      if (typeof f !== "function") return f;
      if (!slotFirst.has(prop)) return f.bind(target);
      return (...args) => (buildOfSlot(args[0]) === 3 ? c3 : c5)[prop](...args);
    },
  });
}

const columns = (rooms) => (rooms <= 7 ? rooms : Math.ceil(Math.sqrt(rooms * 1.5)));
const gridAt = (rooms, step) => Array.from({ length: rooms }, (_, r) => [(r % columns(rooms)) * step, Math.floor(r / columns(rooms)) * step]);
const corridorAt = (rooms, step) => Array.from({ length: rooms }, (_, r) => [r * step, 0]);

/** a house of `at.length` rooms, a bridge and a panel in each (the nodes 2r+1 and 2r+2), 8 dB for every wall, `build(id)` the build of each node (3 or 5) */
async function house(at, step, seed, build) {
  const nodes = 2 * at.length;
  const builds = new Set(Array.from({ length: nodes }, (_, i) => build(i + 1, nodes)));
  let core;
  if (builds.size === 2) core = mixedCore(await MeshCore.load(), await MeshCore.load(create3), (slot) => build(slot + 1, nodes));
  else core = await MeshCore.load(builds.has(3) ? create3 : undefined);
  const air = await MeshAir.create({ seed, beatMs: 5000, sensitivity: floor, loss }, core);
  at.forEach(([x, y], r) => { air.add(2 * r + 1, x, y, 5); air.add(2 * r + 2, x + 1.5, y + 1, 5); });
  const roomOf = (n) => Math.floor((n.id - 1) / 2);
  air.geometry(2.2, (a, b) => 8 * (Math.abs(at[roomOf(a)][0] - at[roomOf(b)][0]) + Math.abs(at[roomOf(a)][1] - at[roomOf(b)][1])) / step);
  air.syncAll();
  air.run(30000);
  return air;
}

/** the hops of radio from a node to every other, over the links heard both ways */
function distances(air, from) {
  const ids = air.nodes.map((n) => n.id);
  const dist = new Map([[from, 0]]);
  for (const queue = [from]; queue.length;) {
    const x = queue.shift();
    for (const y of ids) if (!dist.has(y) && air.heard(x, y) !== undefined && air.heard(y, x) !== undefined) { dist.set(y, dist.get(x) + 1); queue.push(y); }
  }
  return dist;
}

function study(air) {
  const ids = air.nodes.map((n) => n.id);
  const dist = new Map(ids.map((a) => [a, distances(air, a)]));
  const diameter = Math.max(...ids.flatMap((a) => [...dist.get(a).values()]));
  const frames = [], lastMs = [];
  let reached = 0;
  for (const a of ids) {
    const key = air.send(a, MeshType.Event, 255, [a, 1, 2, 3]);
    air.settle(3000);
    const got = air.reached(key);
    frames.push(air.copies(key));
    reached += got.size;
    lastMs.push(Math.max(0, ...[...got.values()]) / 1000);
    air.run(500);
  }
  const pairs = ids.flatMap((a) => ids.filter((b) => b !== a).map((b) => [a, b]));
  const step = Math.max(1, Math.floor(pairs.length / 500));
  const by = new Map();
  let sent = 0, answered = 0, delivered = 0, cmdFrames = 0;
  for (let i = 0; i < pairs.length; i += step) {
    const [a, b] = pairs[i];
    const mark = air.log.length;
    const key = air.send(a, MeshType.Command, b, [1], true);
    air.settle(2000);
    cmdFrames += air.log.length - mark;
    const d = dist.get(a).get(b), ok = air.outcomes.get(key)?.ok === true, got = air.reached(key).has(b);
    const e = by.get(d) ?? [0, 0, 0];
    e[0]++; if (got) e[1]++; if (ok) e[2]++;
    by.set(d, e);
    sent++; if (ok) answered++; if (got) delivered++;
    air.run(100);
  }
  return { nodes: ids.length, diameter, reached, possible: ids.length * (ids.length - 1), frames, lastMs, sent, answered, delivered, cmdFrames, by };
}

const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;
const pct = (a, b) => (b ? (100 * a) / b : 0).toFixed(1);
const houses = [
  ["7 rooms (14 nodes)", gridAt(7, metres)], ["15 rooms (30)", gridAt(15, metres)], ["16 rooms (32)", gridAt(16, metres)], ["20 rooms (40)", gridAt(20, metres)],
  ["corridor of 11 rooms (22)", corridorAt(11, metres)], ["corridor of 13 (26)", corridorAt(13, metres)], ["corridor of 15 (30)", corridorAt(15, metres)], ["corridor of 19 (38)", corridorAt(19, metres)],
];
const builds = [["5", () => 5]];
if (create3) builds.unshift(["3", () => 3], ["mixed alt", (id) => (id % 2 === 0 ? 5 : 3)], ["mixed half", (id, n) => (id <= n / 2 ? 3 : 5)], ["mixed first5", (id) => (id === 1 ? 5 : 3)]);
console.log(`signal floor ${floor} dBm, ${metres} m between rooms, ${(100 * loss).toFixed(0)}% of the receptions lost, ${seeds} seeds`);
console.log("house                       build         diam  reached%  frames/flood (most)  last ms (most)  delivered%  answered%  frames/command  [hops: delivered/answered of sent]");
for (const [name, at] of houses) {
  for (const [label, build] of builds) {
    const runs = [];
    for (let s = 1; s <= seeds; s++) runs.push(study(await house(at, metres, 100 + s, build)));
    const sum = (k) => runs.reduce((t, r) => t + r[k], 0);
    const by = new Map();
    for (const r of runs) for (const [d, e] of r.by) { const x = by.get(d) ?? [0, 0, 0]; by.set(d, x.map((v, i) => v + e[i])); }
    const frames = runs.flatMap((r) => r.frames), last = runs.flatMap((r) => r.lastMs);
    const dist = [...by.keys()].sort((a, b) => a - b).map((d) => `${d}: ${by.get(d)[1]}/${by.get(d)[2]} of ${by.get(d)[0]}`).join("  ");
    console.log(`${name.padEnd(27)} ${label.padEnd(13)} ${String(runs[0].diameter).padStart(3)}   ${pct(sum("reached"), sum("possible")).padStart(6)}   ${mean(frames).toFixed(1).padStart(5)} (${Math.max(...frames)})`.padEnd(90) +
      `${mean(last).toFixed(0).padStart(4)} (${Math.max(...last).toFixed(0)})   ${pct(sum("delivered"), sum("sent")).padStart(8)}  ${pct(sum("answered"), sum("sent")).padStart(8)}  ${(sum("cmdFrames") / sum("sent")).toFixed(1).padStart(8)}      [${dist}]`);
  }
}
