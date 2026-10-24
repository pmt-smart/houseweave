#!/usr/bin/env node
// The matrix of the choice of repeaters: flooding as it was against the relay set, on the houses of the scale study
// (rooms 6 m apart in a grid, a bridge and a panel in each, 8 dB for every wall). One run is one house, one way of repeating and some seeds, and
// prints a JSON line for each seed with, for the three things the plan asks:
//   events  one flood from every node in turn, twice: the frames of each and the share of the other nodes that got it
//   load    300 commands that ask for an answer at 6.7 a second, and 120 at one a second, between pairs drawn at random: the answers, the ones at the first
//           attempt, the median and the 95th percentile of the time from the command to its answer, the frames, the channel
//   cold    a house that starts all at once from nothing, over 30 s: when 99% and all of the pairs a frame can cross are known, the frames and the channel
//
//   node scripts/mesh-relay-matrix.mjs run <rooms> <relays 0|1> <seed,seed,...> ['{"loss":0.05,"scenarios":"events,load,cold","startSlotMs":300}']
//   node scripts/mesh-relay-matrix.mjs table <file.jsonl> ...        the means over the seeds of each house and way of repeating, from lines written by `run`
//
// The options are the air's (see AirOptions in src/mesh.ts: `routeUnicast` sets the commands along the best way, against the flood) and `scenarios`, which names what to run; `loss` is the fraction of the receptions lost at
// random. It needs the simulator built (`npm run build` in vm, and `node scripts/build-mesh-wasm.mjs` when the core changed).
import { readFileSync } from "node:fs";
import { MeshAir, MeshType, MESH, airtimeUs } from "../dist/index.js";

const columns = (rooms) => (rooms <= 7 ? rooms : Math.ceil(Math.sqrt(rooms * 1.5)));

async function house(rooms, options) {
  const air = await MeshAir.create({ beatMs: 5000, startSync: true, ...options });
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

/** the share of the time the channel is busy somewhere, from the frames of `air.log` from index `logFrom` on */
function busyShare(air, fromUs, toUs, logFrom = 0) {
  const iv = air.log.slice(logFrom).filter((l) => l.at < toUs && l.at + airtimeUs(l.len) > fromUs)
    .map((l) => [Math.max(l.at, fromUs), Math.min(l.at + airtimeUs(l.len) + (l.to !== 255 ? 300 : 0), toUs)]).sort((a, b) => a[0] - b[0]);
  let busy = 0, end = -1;
  for (const [a, b] of iv) { if (a > end) { busy += b - a; end = b; } else if (b > end) { busy += b - end; end = b; } }
  return busy / (toUs - fromUs);
}

function coldStart(air, seconds = 30) {
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

async function run(rooms, relays, seeds, opts) {
  const scenarios = (opts.scenarios ?? "events,load,cold").split(",");
  delete opts.scenarios;
  for (const seed of seeds) {
    const options = { seed, chooseRelays: relays, ...opts };
    const res = { rooms, nodes: rooms * 2, relays: relays ? 1 : 0, seed, options: opts };
    if (scenarios.includes("events")) {
      const air = await house(rooms, options);
      air.run(60000);
      const ids = air.nodes.map((n) => n.id);
      let frames = 0, reached = 0, possible = 0, worst = 1, latency = 0, latencyN = 0;
      for (let rep = 0; rep < 2; rep++) {
        for (const id of ids) {
          const key = air.send(id, MeshType.Event, MESH.TO_ALL, [id, rep, 9, 9, 9, 9, 9, 9]);
          air.run(700);
          const got = air.reached(key);
          frames += air.copies(key);
          reached += got.size;
          possible += ids.length - 1;
          worst = Math.min(worst, got.size / (ids.length - 1));
          for (const v of got.values()) { latency += v; latencyN++; }
        }
      }
      res.events = { sent: 2 * ids.length, framesPer: frames / (2 * ids.length), delivery: reached / possible, worst, latencyMs: latency / latencyN / 1000 };
    }
    if (scenarios.includes("load")) {
      for (const [n, gap, label] of [[300, 150, "fast"], [120, 1000, "slow"]]) {
        const air = await house(rooms, options);
        air.run(60000);
        const ids = air.nodes.map((x) => x.id);
        let rnd = 12345 + seed;
        const next = () => (rnd = (rnd * 1103515245 + 12345) & 0x7fffffff);
        const t0 = air.t, log0 = air.log.length;
        const keys = [];
        const sentAt = new Map();
        for (let i = 0; i < n; i++) {
          const a = ids[next() % ids.length];
          let b = ids[next() % ids.length];
          if (b === a) b = ids[(ids.indexOf(a) + 1) % ids.length];
          const k = air.send(a, MeshType.Command, b, [i & 255], true);
          keys.push(k);
          sentAt.set(k, air.t);
          air.run(gap);
        }
        air.run(1500);
        const answered = keys.map((k) => [k, air.outcomes.get(k)]).filter(([, o]) => o?.ok);
        const ms = answered.map(([k, o]) => (o.at - sentAt.get(k)) / 1000).sort((x, y) => x - y);
        const pick = (q) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(q * ms.length))] : null);
        res[label] = { n, ok: answered.length, firstTry: answered.filter(([, o]) => o.attempts === 1).length, none: keys.filter((k) => !air.outcomes.get(k)).length,
                       ms50: pick(0.5), ms95: pick(0.95), frames: air.log.length - log0, busy: busyShare(air, t0, air.t, log0) };
      }
    }
    if (scenarios.includes("cold")) res.cold = coldStart(await house(rooms, options));
    console.log(JSON.stringify(res));
  }
}

function table(files) {
  const rows = files.flatMap((f) => readFileSync(f, "utf8").split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l)));
  const groups = new Map();
  for (const r of rows) {
    const k = `${String(r.nodes).padStart(3)} nodes  ${r.relays ? "relay set" : "flooding "}  ${JSON.stringify(r.options)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
  const fmt = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? "-" : v.toFixed(d));
  for (const [k, rs] of [...groups].sort()) {
    const e = rs.map((r) => r.events).filter(Boolean), f = rs.map((r) => r.fast).filter(Boolean), s = rs.map((r) => r.slow).filter(Boolean), c = rs.map((r) => r.cold).filter(Boolean);
    const parts = [k, `(${rs.length} seeds)`];
    if (e.length) parts.push(`events: ${fmt(mean(e.map((x) => x.framesPer)))} frames, ${fmt(100 * mean(e.map((x) => x.delivery)), 2)}% delivered (worst flood ${fmt(100 * Math.min(...e.map((x) => x.worst)), 1)}%)`);
    if (f.length) parts.push(`6.7/s: ${fmt(mean(f.map((x) => x.ok)))}/300 answered, ${fmt(mean(f.map((x) => x.frames)), 0)} frames, channel ${fmt(100 * mean(f.map((x) => x.busy)))}%`);
    if (s.length) parts.push(`1/s: ${fmt(mean(s.map((x) => x.ok)))}/120`);
    if (c.length) parts.push(`cold: 99% at ${fmt(mean(c.map((x) => x.t99 ?? 30)))} s, all at ${fmt(mean(c.map((x) => x.t100 ?? 30)))} s${c.some((x) => x.t100 === null) ? "+" : ""}, ${fmt(mean(c.map((x) => x.frames)), 0)} frames, channel ${fmt(100 * mean(c.map((x) => x.busy)))}% (${fmt(100 * mean(c.map((x) => x.busyPeak)), 0)}% at the worst second)`);
    console.log(parts.join(" | "));
  }
}

const [command, ...args] = process.argv.slice(2);
if (command === "run" && args.length >= 3) await run(Number(args[0]), args[1] !== "0", args[2].split(",").map(Number), args[3] ? JSON.parse(args[3]) : {});
else if (command === "table" && args.length >= 1) table(args);
else { console.error("usage: mesh-relay-matrix.mjs run <rooms> <relays 0|1> <seed,...> [options json] | table <file.jsonl> ..."); process.exit(1); }
