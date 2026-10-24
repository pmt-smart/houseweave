#!/usr/bin/env node
// The bench's eyes: receives the SYSLOG of the devices and ASKS them, over HTTP and only to read,
// every few seconds: Status 0, Status 4, Status 11, EspNowMeshStatus and Br tasmota.memory(), and, more slowly, Status 12
// (the dump a restart leaves), EspNowMeshClock and HouseStatus. Every line it writes carries the device and the control machine's clock.
//
//   node scripts/bench-logs.mjs [--topology F] [name=ip ...] [--every status11=10,mesh=30] [--duration S] [--out DIR]
//   node scripts/bench-logs.mjs --dry-run ...          # what it would bind and ask, and nothing sent
//
// It writes nothing to a device: its client refuses every command that is not on the read-only list of
// scripts/lib/bench.mjs, so a typo here cannot become a write. The devices are given the control machine's
// address by the owner, once, with their own console (this script does not set it, it would be a write):
//     LogHost <address of this machine>      LogPort <the --syslog-port>      SysLog 2
//
// The output, in the run directory (default bench/<UTC time>/), is logs.jsonl, one JSON object a line:
//   {"kind":"poll","v":1,"t":ISO,"ms":epoch,"mono":ms,"device","role","ip","probe","ok","rtt_ms","data","x"}
//       probe: status0|status4|status11|mesh|memory|status12|clock|house; data = what the device answered; x = the numbers taken out of
//       it (uptime_s, heap_kb, boot_count, ...); on a failure ok=false and "error" and "code" instead.
//   {"kind":"syslog","v":1,"t","ms","mono","device"|null,"src":"ip:port","pri","severity","host","device_ts","msg"}
// and a meta.json that says what was asked, and how many lines of each kind came.
//
// Every Br leaves 16 bytes alive in the device's Berry: the memory probe is slow by default (60 s),
// and each memory line says how many Br this run has made to that device ("br_reads").
import { join } from "node:path";
import os from "node:os";
import {
  BR_MEMORY,
  JsonlWriter,
  isMain,
  makeClient,
  openRunDir,
  parseSyslog,
  resolveDevices,
  resolveSyslogDevice,
  runMain,
  sleep,
  snapshotTopology,
  stamp,
  startSyslogServer,
  loadTopology,
  writeMeta,
  UsageError,
} from "./lib/bench.mjs";

export const PROBES = {
  status0: { command: "Status 0", every: 600 },
  status4: { command: "Status 4", every: 60 },
  status11: { command: "Status 11", every: 10 },
  mesh: { command: "EspNowMeshStatus", every: 30 },
  memory: { command: BR_MEMORY, every: 60 },
  // the dump the watchdog of the main loop leaves behind: Tasmota keeps it until the next one, and the log of the web does not survive the restart
  status12: { command: "Status 12", every: 300 },
  // the mesh's clock: a neighbour in another timeline minutes after the start is the clock's 20 ms window, and only a poll across hours sees how often
  clock: { command: "EspNowMeshClock", every: 60 },
  // the house as the node has it: the key version, a change pending, the nodes of the list
  house: { command: "HouseStatus", every: 60 },
};

const SPEC = {
  usage: "node scripts/bench-logs.mjs [options] [name=ip ...]",
  summary: `
Receives the devices' syslog (UDP) and polls them over HTTP, read-only, marking every line with the device and the
control machine's clock. Writes bench/<run>/logs.jsonl. Devices: the topology's, plus any name=ip given.`,
  options: {
    topology: { type: "string", help: "the topology file (devices, roles, which are sacrificial)" },
    only: { type: "list", help: "poll only these devices of the topology" },
    probes: { type: "list", help: "which probes (status0,status4,status11,mesh,memory,status12,clock,house)", default: Object.keys(PROBES) },
    every: { type: "list", help: "seconds between polls, per probe: status11=10,mesh=30 (the others keep their default)" },
    "syslog-port": { type: "int", help: "UDP port of the syslog receiver (0 picks one)", default: 5514 },
    "syslog-bind": { type: "string", help: "address of the syslog receiver", default: "0.0.0.0" },
    "no-syslog": { type: "boolean", help: "do not receive syslog" },
    "no-poll": { type: "boolean", help: "do not poll, only receive syslog" },
    duration: { type: "number", help: "stop after this many seconds (default: until Ctrl-C)" },
    timeout: { type: "int", help: "HTTP timeout of a poll, in ms", default: 5000 },
    out: { type: "string", help: "the run directory (default bench/<UTC time>)" },
    "dry-run": { type: "boolean", help: "say what it would bind and ask, and send nothing" },
  },
  notes: "Each device is asked one thing at a time, and the devices in parallel. A device that does not answer is a line with ok=false, not a stop.",
};

/** `status11=10,mesh=0.5` -> { status0: 600, ..., status11: 10, mesh: 0.5 }. */
export function parseEvery(list = []) {
  const every = Object.fromEntries(Object.entries(PROBES).map(([k, p]) => [k, p.every]));
  for (const item of list) {
    const [name, value] = item.split("=");
    if (!(name in PROBES)) throw new UsageError(`--every: no probe "${name}" (${Object.keys(PROBES).join(", ")})`);
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) throw new UsageError(`--every ${name}= needs seconds above 0`);
    every[name] = n;
  }
  return every;
}

/** The numbers worth keeping apart from a probe's answer, in the units the answer used. */
export function extract(probe, data) {
  switch (probe) {
    case "status11": {
      const s = data?.StatusSTS ?? {};
      return { uptime_s: s.UptimeSec, heap_kb: s.Heap, rssi: s.Wifi?.RSSI, load: s.LoadAvg, sleep: s.Sleep };
    }
    case "status4": {
      const s = data?.StatusMEM ?? {};
      return { heap_kb: s.Heap, free_kb: s.Free };
    }
    case "status0":
      return { boot_count: data?.StatusPRM?.BootCount, version: data?.StatusFWR?.Version, heap_kb: data?.StatusMEM?.Heap ?? data?.StatusSTS?.Heap, uptime_s: data?.StatusSTS?.UptimeSec, ota_url: data?.StatusPRM?.OtaUrl, sleep: data?.StatusPRM?.Sleep };
    case "mesh": {
      const s = data?.EspNowMeshStatus ?? {};
      return { running: s.Running, id: s.Id, epoch: s.Epoch, heap_b: s.Heap, neighbors: s.Neighbors, delivered: s.Delivered, acks_heard: s.AcksHeard, gave_up: s.GaveUp, sent_own: s.SentOwn };
    }
    case "memory":
      return { heap_free_kb: data?.heap_free, frag: data?.frag, iram_free_kb: data?.iram_free };
    case "status12": {
      // what a dump of the stack says varies with the chip and the build: the reason and how many fields it has are kept apart, and the whole answer stays in `data`
      const s = data?.StatusSTK ?? {};
      return { reason: s.Reason, fields: Object.keys(s).length };
    }
    case "clock": {
      const c = data?.EspNowMeshClock ?? {};
      const list = Array.isArray(c.List) ? c.List : [];
      return { synced: c.Synced, timeline: c.Timeline, taken: c.Taken, steps: c.Steps, events_lost: c.EventsLost, neighbors: c.Count, other_timeline: list.filter((n) => n.Seen === 1).length };
    }
    case "house": {
      const h = data?.HouseStatus ?? {};
      return { me: h.Me, up: h.Up, name: h.Name, key: h.Key, pending: h.Pending, nodes: Array.isArray(h.Nodes) ? h.Nodes.length : undefined };
    }
    default:
      return {};
  }
}

/** The plan: what a run would bind and ask, and nothing sent. */
export function planLogs({ devices, probes, every, syslog, poll, syslogPort, syslogBind, dir }) {
  const lines = [];
  lines.push(`run directory: ${dir}`);
  if (syslog) {
    const mine = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
    lines.push(`syslog: would listen on udp ${syslogBind}:${syslogPort}`);
    lines.push(`  each device sends to it once the owner has set, on its console: LogHost <address of this machine> (${mine.join(", ") || "no address found"}), LogPort ${syslogPort}, SysLog 2`);
  } else {
    lines.push("syslog: off");
  }
  if (poll) {
    lines.push(`polls (HTTP, read-only), ${devices.length} device(s):`);
    for (const d of devices) lines.push(`  ${d.name} ${d.ip} (${d.role}): ${probes.map((p) => `${p} every ${every[p]} s [${PROBES[p].command}]`).join("; ")}`);
  } else {
    lines.push("polls: off");
  }
  return lines;
}

/**
 * Starts a run: the syslog receiver and the polls. Returns { dir, syslogPort, stop }, where stop() ends it and
 * resolves to what the run wrote. The port is the receiver's own, so that a port of 0 can be asked what it chose.
 */
export async function startLogs({ devices, probes, every, out, syslog = true, poll = true, syslogPort = 5514, syslogBind = "0.0.0.0", timeoutMs = 5000, signal, client, topology, argv = [] }) {
  const dir = openRunDir(out);
  snapshotTopology(dir, topology);
  const writer = new JsonlWriter(join(dir, "logs.jsonl"));
  const stop = new AbortController();
  if (signal) signal.aborted ? stop.abort() : signal.addEventListener("abort", () => stop.abort(), { once: true });
  const readClient = client ?? makeClient({ timeoutMs, readOnly: true });
  const counts = { poll: { ok: 0, failed: 0 }, syslog: { total: 0, unknown_source: 0 }, br_reads: {} };
  const startedAt = stamp();
  writeMeta(dir, "bench-logs", { started: startedAt.t, argv, devices: devices.map((d) => d.name), probes, every });

  let server = null;
  if (syslog) {
    server = await startSyslogServer({
      port: syslogPort,
      address: syslogBind,
      onMessage: (buf, remote) => {
        const parsed = parseSyslog(buf);
        const device = resolveSyslogDevice(devices, remote.address, parsed.host);
        counts.syslog.total++;
        if (!device) counts.syslog.unknown_source++;
        writer.append({ kind: "syslog", v: 1, ...stamp(), device: device?.name ?? null, src: `${remote.address}:${remote.port}`, ...parsed });
      },
    });
  }

  async function probeOnce(device, probe) {
    const begin = stamp();
    const record = { kind: "poll", v: 1, ...begin, device: device.name, role: device.role, ip: device.ip, probe };
    try {
      const isBr = PROBES[probe].command.startsWith("Br ");
      let data;
      let rttMs;
      if (isBr) {
        counts.br_reads[device.name] = (counts.br_reads[device.name] ?? 0) + 1;
        const r = await readClient.br(device.ip, PROBES[probe].command);
        data = r.value;
        rttMs = r.rttMs;
      } else {
        const r = await readClient.cmd(device.ip, PROBES[probe].command);
        data = r.json;
        rttMs = r.rttMs;
      }
      Object.assign(record, { ok: true, rtt_ms: rttMs, data, x: extract(probe, data) });
      if (isBr) record.x.br_reads = counts.br_reads[device.name];
      counts.poll.ok++;
    } catch (e) {
      Object.assign(record, { ok: false, rtt_ms: Math.round(performance.now() - begin.mono), error: e.message, code: e.code ?? "error" });
      counts.poll.failed++;
    }
    writer.append(record);
  }

  async function loop(device, index) {
    const due = Object.fromEntries(probes.map((p) => [p, 0]));
    await sleep(index * 250, stop.signal);
    while (!stop.signal.aborted) {
      let next = Infinity;
      for (const probe of probes) {
        if (stop.signal.aborted) break;
        if (due[probe] <= performance.now()) {
          await probeOnce(device, probe);
          due[probe] = performance.now() + every[probe] * 1000;
        }
        next = Math.min(next, due[probe]);
      }
      await sleep(Math.min(Math.max(20, next - performance.now()), 1000), stop.signal);
    }
  }

  const loops = poll ? devices.map((d, i) => loop(d, i)) : [];
  let ended = null;
  const end = async () => {
    stop.abort();
    await Promise.all(loops);
    if (server) await server.close();
    await writer.close();
    writeMeta(dir, "bench-logs", { ended: stamp().t, lines: writer.count, counts });
    return { dir, counts, lines: writer.count };
  };
  return { dir, syslogPort: server?.port ?? null, aborted: stop.signal, stop: () => (ended ??= end()) };
}

/** Runs until the signal aborts or durationMs is up. Returns the run directory and what it counted. */
export async function runLogs({ durationMs = 0, signal, ...options }) {
  const run = await startLogs({ ...options, signal });
  const over = new AbortController();
  if (durationMs > 0) setTimeout(() => over.abort(), durationMs).unref();
  await new Promise((done) => {
    const finish = () => done();
    if (over.signal.aborted || signal?.aborted) return done();
    over.signal.addEventListener("abort", finish, { once: true });
    signal?.addEventListener("abort", finish, { once: true });
  });
  return run.stop();
}

export async function main({ values, positional }) {
  const topology = values.topology ? loadTopology(values.topology) : null;
  const devices = resolveDevices({ topology, positional, only: values.only ?? null });
  const poll = !values["no-poll"];
  const syslog = !values["no-syslog"];
  if (!poll && !syslog) throw new UsageError("--no-poll and --no-syslog leave nothing to do");
  if (poll && devices.length === 0) throw new UsageError("name the devices: a topology file (--topology) or name=ip arguments");
  for (const p of values.probes) if (!(p in PROBES)) throw new UsageError(`--probes: no probe "${p}"`);
  const every = parseEvery(values.every);
  const plan = planLogs({ devices, probes: values.probes, every, syslog, poll, syslogPort: values["syslog-port"], syslogBind: values["syslog-bind"], dir: values.out ?? "bench/<UTC time>" });
  if (values["dry-run"]) {
    console.log("bench-logs: dry run. Nothing is bound, nothing is created and nothing is sent.");
    for (const line of plan) console.log(line);
    return 0;
  }
  const stop = new AbortController();
  process.once("SIGINT", () => stop.abort());
  for (const line of plan) console.log(line);
  const result = await runLogs({
    devices,
    probes: values.probes,
    every,
    out: values.out,
    syslog,
    poll,
    syslogPort: values["syslog-port"],
    syslogBind: values["syslog-bind"],
    durationMs: values.duration ? values.duration * 1000 : 0,
    timeoutMs: values.timeout,
    signal: stop.signal,
    topology,
    argv: process.argv.slice(2),
  });
  console.log(`done: ${result.lines} lines in ${result.dir} (polls ${result.counts.poll.ok} ok, ${result.counts.poll.failed} failed; syslog ${result.counts.syslog.total})`);
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = await runMain(SPEC, process.argv.slice(2), main);
