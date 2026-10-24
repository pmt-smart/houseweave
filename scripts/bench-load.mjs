#!/usr/bin/env node
// The bench's load: commands that REPEAT -- the same seed gives the same plan --
// sent through the paths that exist, each one checked against the device's real state afterwards.
//
//   node scripts/bench-load.mjs --topology F --scenario single|burst|alternate --paths panel,tap,bridge,mesh \
//        --n 200 --seed 42 [--gap 500] [--burst-sizes 5,8,12] [--panel-view] [--tag soak] [--out DIR] [--yes]
//
// Without --yes it says what it would do (the plan, the first steps) and sends NOTHING, not even a read. With --yes
// it writes lamps (ZbSend of a Power) and, on the mesh path, frames (EspNowMeshSend): toggles that undo themselves.
//
// The paths, and only what exists in the repo (nothing here is a protocol of its own):
//   bridge  PC -> the coordinator's own /cm, ZbSend. The control: the lamp and the radio with no panel in the way.
//   panel   PC -> the panel, `Br global.zb_bridge.send('ZbSend ...')`: the brain's own transport (zigbee_bridge.be)
//           over whichever mode the panel is in -- tcp, direct or local, read from ZbBridgeMode and written on
//           every line -- to the bridge, which runs it through its allowed list (zbbridge_relay.be). A burst is ONE
//           Br with K sends, K lines in the same tick, as a plan with K lamps makes them.
//   tap     PC -> the panel, `Br global.plan.on_tap(n)`: the plan's own handler for a touch (panel_plan_view.be),
//           with n the point the glass reports (x * 1000 + y) that the topology gives for the lamp's card.
//   mesh    PC -> a node, EspNowMeshSend dest,type,1,text: the mesh's transport, counted at the other end
//           (EspNowMeshStatus Delivered, AcksHeard, GaveUp). The house layer that would make it "a command to a
//           device in another room" does not exist yet.
//
// What it checks, step by step: the lamp's state from the coordinator (ZbStatus3 <ieee>, the radio's own cache, which is
// the report the panel itself waits for), and, with --panel-view, the panel's own view of the lamp
// (the plan's live and doubt maps, read for the lamps in question: what it shows, and whether it shows the "?"). Before every
// command the state is read, and the command is the TOGGLE of it, so a lost command cannot hide as "already so".
// The latency is from the moment the command was sent to the first read that showed the state: an upper bound, with
// the read's own round trip in it, on the control machine's clock.
//
// The output, in the run directory, is load.jsonl:
//   {"kind":"load-run", seed, scenario, paths, n, gap_ms, tag, transports, ...}            the run's header
//   {"kind":"load","v":1,"t","ms","run","i","scenario","path","transport","via","target","ieee","cmd","pre",
//      "expected","sent":{"ok","rtt_ms","error"},"truth_ms"|null,"panel_ms"|null,"flagged"|null,"silent"|null,
//      "outcome":"confirmed|panel-late|unconfirmed|send-failed|harness-error", "burst":{"id","size","index"}?}
//   {"kind":"load-alternate", ... "pair", "offset_ms", "final", "views", "doubts", "converge_ms", "outcome"}
//   {"kind":"load-burst","i","size","confirmed","max_ms","all_ms"}
//   {"kind":"load-summary", per transport: n, confirmed, unconfirmed, send_failed, flagged, silent, p50/p95/p99}
// "flagged" is the panel showing the "?" at the end of the window, "silent" is a command that neither took effect
// nor was flagged -- the silent loss a command must never have. Both are null without --panel-view: the panel's view is the only place the
// "?" is, and it can be read only that way.
import { join } from "node:path";
import {
  BenchError,
  JsonlWriter,
  UsageError,
  isMain,
  loadTopology,
  makeClient,
  makeRng,
  openRunDir,
  panelViewExpression,
  parsePanelView,
  runMain,
  sleep,
  snapshotTopology,
  stamp,
  summarize,
  topologyDigest,
  writeMeta,
} from "./lib/bench.mjs";

const SPEC = {
  usage: "node scripts/bench-load.mjs --topology F [options]",
  summary: `
Repeatable load, seeded: N commands per path, bursts of 5/8/12 lines, taps alternated across panels, each checked against
the device's real state. Without --yes it prints the plan and sends nothing.`,
  options: {
    topology: { type: "string", help: "the topology file: devices, lamps (ieee, coordinator), taps, mesh ids (required)" },
    scenario: { type: "string", help: "single | burst | alternate", default: "single" },
    paths: { type: "list", help: "bridge, panel, tap, mesh", default: ["panel"] },
    n: { type: "int", help: "commands per path (single), bursts per size (burst), pairs (alternate)", default: 200 },
    seed: { type: "string", help: "the seed: the same seed gives the same plan", default: "1" },
    gap: { type: "int", help: "mean pause between steps in ms, with a seeded jitter of 50%", default: 500 },
    "burst-sizes": { type: "ints", help: "lines per burst", default: [5, 8, 12] },
    "offset-max": { type: "int", help: "alternate: the second command comes 0..this many ms after the first", default: 500 },
    "confirm-timeout": { type: "int", help: "how long a command has to show in the state, in ms", default: 3000 },
    "poll-ms": { type: "int", help: "pause between two reads of a state, in ms", default: 50 },
    "panel-view": { type: "boolean", help: "also read the panel's own view of the lamp (what it shows, and the \"?\")" },
    "mesh-type": { type: "int", help: "mesh: the type of the frames (0..7)", default: 0 },
    tag: { type: "string", help: "a label for the run, e.g. soak" },
    out: { type: "string", help: "the run directory (default bench/<UTC time>)" },
    yes: { type: "boolean", help: "do it: write to the devices. Without it only the plan is printed" },
  },
  notes: "The topology's sacrificial flag does not matter here: a toggle of a lamp undoes itself. A device that asks for a password stops the run.",
};

// ---------------------------------------------------------------------------------------------------------------
// the commands this script sends: the only ones

/** What a coordinator is told to do with a lamp. Keys as panel_plan_commands.be writes them. */
export function zbSendCommand(ieee, power) {
  return `ZbSend {"Device":"${ieee}","Send":{"Power":${power}}}`;
}

function assertQuotable(command) {
  if (/['\\;\n]/.test(command)) throw new BenchError("bad-command", `a command to be quoted in Berry has a character that does not travel: ${command}`);
  return command;
}

/** The panel's transport, one Br: one send, or K sends in the same tick. Under 1100 bytes: the console's limit is near 1200. */
export function panelSendExpression(commands) {
  const body = commands.length === 1
    ? `Br global.zb_bridge.send('${assertQuotable(commands[0])}')`
    : `Br var b=global.zb_bridge ${commands.map((c) => `b.send('${assertQuotable(c)}')`).join(" ")}`;
  if (body.length > 1100) throw new BenchError("too-long", `a burst of ${commands.length} lines is ${body.length} bytes, more than one console line takes`);
  return body;
}

export const tapExpression = (point) => `Br global.plan.on_tap(${point})`;
export const meshSendCommand = (dest, type, text) => `EspNowMeshSend ${dest},${type},1,${text}`;

// ---------------------------------------------------------------------------------------------------------------
// the plan: pure, from the topology and the seed

function cycler(rng, items) {
  let order = [];
  let last;
  return () => {
    if (order.length === 0) {
      order = rng.shuffle(items);
      if (items.length > 1 && order[0] === last) order.push(order.shift());
    }
    last = order.shift();
    return last;
  };
}

export function panelLamps(topology, panel) {
  return topology.lamps.filter((l) => l.coordinator === panel.name || l.coordinator === panel.bridge);
}

export function planLoad({ topology, scenario = "single", paths = ["panel"], n = 200, seed = "1", gapMs = 500, burstSizes = [5, 8, 12], offsetMax = 500, panelView = false }) {
  if (!["single", "burst", "alternate"].includes(scenario)) throw new UsageError(`--scenario: single, burst or alternate, not "${scenario}"`);
  for (const p of paths) if (!["bridge", "panel", "tap", "mesh"].includes(p)) throw new UsageError(`--paths: bridge, panel, tap or mesh, not "${p}"`);
  if (!(n >= 1)) throw new UsageError("--n needs 1 or more");
  seed = String(seed); // 42 and "42" are the same seed: the command line only has strings
  const rng = makeRng(seed);
  const gaps = rng.fork("gap");
  const warnings = [];
  const steps = [];
  const wait = () => (gapMs > 0 ? gaps.int(Math.floor(gapMs / 2), Math.ceil((gapMs * 3) / 2)) : 0);
  const panels = topology.devices.filter((d) => d.role === "panel");
  const lampsByName = new Map(topology.lamps.map((l) => [l.name, l]));
  const add = (step) => steps.push({ i: steps.length, scenario, ...step, wait_ms: wait() });

  if (scenario === "single") {
    for (const path of paths) {
      const pr = rng.fork(`single:${path}`);
      if (path === "bridge") {
        if (topology.lamps.length === 0) {
          warnings.push("path bridge: the topology has no lamps");
          continue;
        }
        const next = cycler(pr, topology.lamps);
        for (let k = 0; k < n; k++) {
          const lamp = next();
          add({ path, via: lamp.coordinator, target: lamp.name, ieee: lamp.ieee, coordinator: lamp.coordinator });
        }
      } else if (path === "panel") {
        const usable = panels.filter((p) => panelLamps(topology, p).length > 0);
        if (usable.length === 0) {
          warnings.push("path panel: no panel has a lamp on its own bridge (or its own radio) in the topology");
          continue;
        }
        const nextPanel = cycler(pr, usable);
        const nextLamp = new Map(usable.map((p) => [p.name, cycler(pr.fork(p.name), panelLamps(topology, p))]));
        for (let k = 0; k < n; k++) {
          const panel = nextPanel();
          const lamp = nextLamp.get(panel.name)();
          add({ path, via: panel.name, target: lamp.name, ieee: lamp.ieee, coordinator: lamp.coordinator });
        }
      } else if (path === "tap") {
        const usable = panels.filter((p) => Object.keys(p.taps ?? {}).some((name) => panelLamps(topology, p).some((l) => l.name === name)));
        if (usable.length === 0) {
          warnings.push("path tap: no panel has a tap (the point of a lamp's card) for a lamp on its own bridge");
          continue;
        }
        const nextPanel = cycler(pr, usable);
        const nextTap = new Map(usable.map((p) => [p.name, cycler(pr.fork(p.name), Object.keys(p.taps).filter((name) => panelLamps(topology, p).some((l) => l.name === name)))]));
        for (let k = 0; k < n; k++) {
          const panel = nextPanel();
          const lamp = lampsByName.get(nextTap.get(panel.name)());
          add({ path, via: panel.name, target: lamp.name, ieee: lamp.ieee, coordinator: lamp.coordinator, tap: panel.taps[lamp.name] });
        }
      } else {
        const nodes = topology.devices.filter((d) => d.mesh);
        if (nodes.length < 2) {
          warnings.push("path mesh: it needs two devices with a mesh id in the topology");
          continue;
        }
        const nextNode = cycler(pr, nodes);
        for (let k = 0; k < n; k++) {
          const from = nextNode();
          const to = pr.pick(nodes.filter((x) => x !== from));
          add({ path, via: from.name, to: to.name, to_id: to.mesh.id, text: `b${steps.length}` });
        }
      }
    }
  } else if (scenario === "burst") {
    for (const path of paths) if (path !== "panel") warnings.push(`path ${path}: a burst is the panel's (K lines in one tick); this path is left out`);
    if (paths.includes("panel")) {
      const pr = rng.fork("burst");
      for (const size of burstSizes) {
        const usable = panels.filter((p) => panelLamps(topology, p).length >= size);
        if (usable.length === 0) {
          warnings.push(`burst of ${size}: no panel has ${size} lamps on its coordinator in the topology; left out`);
          continue;
        }
        const nextPanel = cycler(pr.fork(`size${size}`), usable);
        for (let k = 0; k < n; k++) {
          const panel = nextPanel();
          const lamps = pr.shuffle(panelLamps(topology, panel)).slice(0, size);
          add({ path: "panel", via: panel.name, size, targets: lamps.map((l) => ({ target: l.name, ieee: l.ieee, coordinator: l.coordinator })) });
        }
      }
    }
  } else {
    if (!panelView) throw new UsageError("--scenario alternate compares the panels' own views: it needs --panel-view");
    for (const path of paths) if (path !== "panel") warnings.push(`path ${path}: alternate runs on the panel path only; this path is left out`);
    const pr = rng.fork("alternate");
    const shared = topology.lamps.filter((l) => panels.filter((p) => panelLamps(topology, p).includes(l)).length >= 2);
    if (shared.length === 0) {
      warnings.push("alternate: no lamp is reachable from two panels in the topology");
    } else if (paths.includes("panel")) {
      const next = cycler(pr, shared);
      for (let k = 0; k < n; k++) {
        const lamp = next();
        const two = pr.shuffle(panels.filter((p) => panelLamps(topology, p).includes(lamp))).slice(0, 2);
        const first = pr.chance(0.5) ? "on" : "off";
        add({
          path: "panel",
          target: lamp.name,
          ieee: lamp.ieee,
          coordinator: lamp.coordinator,
          pair: [{ via: two[0].name, intent: first }, { via: two[1].name, intent: first === "on" ? "off" : "on" }],
          offset_ms: pr.int(0, offsetMax),
        });
      }
    }
  }
  const writes = steps.reduce((sum, s) => sum + (s.size ?? (s.pair ? 2 : 1)), 0);
  const estimateMs = steps.reduce((sum, s) => sum + s.wait_ms + 1200, 0);
  return { seed, scenario, paths, n, gapMs, steps, warnings, writes, estimateMs };
}

export function describeStep(step) {
  if (step.pair) return `#${step.i} alternate ${step.target} ${step.pair.map((p) => `${p.via}:${p.intent}`).join(" then ")} after ${step.offset_ms} ms`;
  if (step.size) return `#${step.i} burst of ${step.size} via ${step.via}: ${step.targets.map((t) => t.target).join(",")}`;
  if (step.path === "mesh") return `#${step.i} mesh ${step.via} -> ${step.to} (node ${step.to_id})`;
  return `#${step.i} ${step.path} via ${step.via} -> ${step.target}${step.tap !== undefined ? ` (tap ${step.tap})` : ""}`;
}

// ---------------------------------------------------------------------------------------------------------------
// the execution

/** The Power of the ZbStatus3 answer: 1, 0, or null when it says none. */
export function powerOf(json) {
  const entry = Array.isArray(json?.ZbStatus3) ? json.ZbStatus3[0] : null;
  if (!entry) return null;
  const p = entry.Power;
  if (p === 1 || p === "1" || p === "ON" || p === "On" || p === true) return 1;
  if (p === 0 || p === "0" || p === "OFF" || p === "Off" || p === false) return 0;
  return null;
}

function refused(json) {
  return /error|unknown|invalid|fail|not found/i.test(JSON.stringify(json ?? {}));
}

export async function executeLoad({ plan, topology, client, writer, options, signal, log = () => {} }) {
  const devices = new Map(topology.devices.map((d) => [d.name, d]));
  const ip = (name) => devices.get(name).ip;
  const confirmMs = options.confirmTimeoutMs ?? 3000;
  const pollMs = options.pollMs ?? 50;
  const panelView = options.panelView === true;
  const run = options.run ?? stamp().ms;
  const tag = options.tag ?? null;
  const transports = {};
  const tally = new Map();

  const truthOf = async (lampOrTarget) => {
    const { json } = await client.cmd(ip(lampOrTarget.coordinator), `ZbStatus3 ${lampOrTarget.ieee}`);
    return powerOf(json);
  };
  const viewOf = async (panel, ieees) => {
    const { value } = await client.br(ip(panel), panelViewExpression(ieees));
    return parsePanelView(ieees, value);
  };
  const transportOf = (step) => (step.path === "bridge" ? "http-bridge" : step.path === "mesh" ? "mesh" : transports[step.via] ?? "unknown");
  const noteOutcome = (transport, record) => {
    const t = tally.get(transport) ?? { n: 0, confirmed: 0, panel_late: 0, unconfirmed: 0, send_failed: 0, harness_error: 0, flagged: 0, silent: 0, ms: [] };
    t.n++;
    if (record.outcome === "confirmed") t.confirmed++;
    else if (record.outcome === "panel-late") t.panel_late++;
    else if (record.outcome === "unconfirmed") t.unconfirmed++;
    else if (record.outcome === "send-failed") t.send_failed++;
    else t.harness_error++;
    if (record.flagged === true) t.flagged++;
    if (record.silent === true) t.silent++;
    if (typeof record.truth_ms === "number") t.ms.push(record.truth_ms);
    tally.set(transport, t);
  };
  const emit = (record) => {
    writer.append(record);
    if (record.kind === "load") noteOutcome(record.transport, record);
  };

  // the modes the panels are in, read once: the path's name on every line
  for (const name of new Set(plan.steps.flatMap((s) => [s.path === "panel" || s.path === "tap" ? s.via : null, ...(s.pair ?? []).map((p) => p.via)]).filter(Boolean))) {
    const { json } = await client.cmd(ip(name), "ZbBridgeMode");
    transports[name] = String(json.ZbBridgeMode ?? "unknown").toLowerCase();
    if (transports[name] === "off") throw new BenchError("panel-off", `${name} is in ZbBridgeMode off: it sends nothing anywhere`);
  }
  writer.append({ kind: "load-run", v: 1, ...stamp(), run, seed: plan.seed, scenario: plan.scenario, paths: plan.paths, n: plan.n, gap_ms: plan.gapMs, steps: plan.steps.length, tag, panel_view: panelView, confirm_timeout_ms: confirmMs, poll_ms: pollMs, transports, topology: topologyDigest(topology) });

  /** Reads until the check holds or the deadline: the milliseconds from t0 it first held, or null. */
  async function until(t0, deadline, read, holds) {
    let polls = 0;
    let okReads = 0;
    let error = null;
    let last = null;
    for (;;) {
      let fresh = false;
      try {
        const value = await read();
        if (value !== null) {
          okReads++;
          last = value;
          fresh = true;
        }
      } catch (e) {
        // a password or a blocked write ends the run; any other read that failed showed nothing, and the loop goes on
        if (e.code === "auth" || e.code === "write-blocked") throw e;
        error = e;
      }
      polls++;
      const at = performance.now() - t0;
      if (fresh && holds(last)) return { ms: Math.round(at), polls, okReads, last, error };
      if (performance.now() >= deadline || signal?.aborted) return { ms: null, polls, okReads, last, error };
      await sleep(pollMs, signal);
    }
  }

  async function group(step) {
    // the lamps, with the state each is in now: the command is its opposite
    const targets = step.targets ?? [{ target: step.target, ieee: step.ieee, coordinator: step.coordinator }];
    const transport = transportOf(step);
    const base = (t, k) => ({ kind: "load", v: 1, ...stamp(), run, i: step.i, scenario: step.scenario, path: step.path, transport, via: step.via, target: t.target, ieee: t.ieee, tag, wait_ms: step.wait_ms, ...(step.size ? { burst: { id: step.i, size: step.size, index: k } } : {}) });
    const pres = await Promise.all(targets.map((t) => truthOf(t).catch((e) => {
      if (e.code === "auth" || e.code === "write-blocked") throw e;
      return { error: e };
    })));
    const records = targets.map((t, k) => base(t, k));
    const live = [];
    pres.forEach((pre, k) => {
      if (pre === null || pre?.error) {
        Object.assign(records[k], { outcome: "harness-error", error: pre?.error ? pre.error.message : "ZbStatus3 says no Power", sent: null });
      } else {
        const expected = pre ? "off" : "on";
        Object.assign(records[k], { pre: pre ? "on" : "off", expected });
        live.push(k);
      }
    });
    if (live.length > 0) {
      const commands = live.map((k) => zbSendCommand(records[k].ieee, records[k].expected === "on" ? 1 : 0));
      let expression;
      let sentRtt = null;
      const t0 = performance.now();
      try {
        if (step.path === "bridge") {
          const r = await client.cmd(ip(step.via), commands[0], { write: true });
          sentRtt = r.rttMs;
          if (refused(r.json)) throw new BenchError("refused", `the coordinator answered ${JSON.stringify(r.json).slice(0, 80)}`);
          expression = commands[0];
        } else if (step.path === "tap") {
          expression = tapExpression(step.tap);
          const r = await client.br(ip(step.via), expression, { write: true });
          sentRtt = r.rttMs;
        } else {
          expression = panelSendExpression(commands);
          const r = await client.br(ip(step.via), expression, { write: true });
          sentRtt = r.rttMs;
        }
        live.forEach((k, j) => Object.assign(records[k], { cmd: step.path === "tap" ? expression : commands[j], sent: { ok: true, rtt_ms: sentRtt } }));
      } catch (e) {
        if (e.code === "auth" || e.code === "write-blocked") throw e;
        live.forEach((k) => Object.assign(records[k], { cmd: expression, sent: { ok: false, error: e.message }, outcome: "send-failed" }));
        live.length = 0;
      }
      if (live.length > 0) {
        const deadline = t0 + confirmMs;
        const wantPanel = panelView && step.path !== "bridge";
        const viewLoop = wantPanel
          ? (async () => {
              const seen = new Map();
              const result = await until(t0, deadline, () => viewOf(step.via, live.map((k) => records[k].ieee)), (view) => {
                for (const k of live) {
                  if (!seen.has(k) && view.live[records[k].ieee] === records[k].expected && !view.doubt[records[k].ieee]) seen.set(k, Math.round(performance.now() - t0));
                }
                return seen.size === live.length;
              });
              return { seen, last: result.last };
            })()
          : Promise.resolve({ seen: new Map(), last: null });
        const truthLoops = live.map((k) => until(t0, deadline, () => truthOf(targets[k]), (p) => (p === 1 ? "on" : "off") === records[k].expected));
        const [truths, view] = await Promise.all([Promise.all(truthLoops), viewLoop]);
        live.forEach((k, j) => {
          const r = records[k];
          r.truth_ms = truths[j].ms;
          r.polls = truths[j].polls;
          if (truths[j].okReads === 0) {
            // not one read of the state worked: the harness could not look, and says so, instead of calling it a loss
            Object.assign(r, { outcome: "harness-error", error: truths[j].error?.message ?? "no read of the state", panel_ms: null, flagged: null, silent: null });
            return;
          }
          if (wantPanel) {
            r.panel_ms = view.seen.get(k) ?? null;
            r.flagged = view.last ? view.last.doubt[r.ieee] === true : null;
          } else {
            r.panel_ms = null;
            r.flagged = null;
          }
          const lampOk = r.truth_ms !== null;
          const panelOk = !wantPanel || r.panel_ms !== null;
          r.outcome = lampOk && panelOk ? "confirmed" : lampOk ? "panel-late" : "unconfirmed";
          r.silent = wantPanel && r.flagged !== null ? r.outcome !== "confirmed" && r.flagged === false : null;
        });
      }
    }
    for (const r of records) emit(r);
    if (step.size) {
      const ok = records.filter((r) => r.truth_ms !== null && r.truth_ms !== undefined);
      writer.append({ kind: "load-burst", v: 1, ...stamp(), run, i: step.i, size: step.size, via: step.via, transport, confirmed: ok.length, max_ms: ok.length ? Math.max(...ok.map((r) => r.truth_ms)) : null, all_ms: ok.length === step.size ? Math.max(...ok.map((r) => r.truth_ms)) : null, tag });
    }
  }

  async function alternate(step) {
    const lamp = { ieee: step.ieee, coordinator: step.coordinator };
    const record = { kind: "load-alternate", v: 1, ...stamp(), run, i: step.i, scenario: "alternate", path: "panel", target: step.target, ieee: step.ieee, pair: step.pair.map((p) => ({ ...p, transport: transports[p.via] })), offset_ms: step.offset_ms, tag };
    try {
      record.pre = (await truthOf(lamp)) ? "on" : "off";
    } catch (e) {
      if (e.code === "auth" || e.code === "write-blocked") throw e;
      Object.assign(record, { outcome: "harness-error", error: e.message });
      writer.append(record);
      return;
    }
    const send = async (p) => {
      const r = await client.br(ip(p.via), panelSendExpression([zbSendCommand(step.ieee, p.intent === "on" ? 1 : 0)]), { write: true });
      return r.rttMs;
    };
    try {
      await send(step.pair[0]);
      await sleep(step.offset_ms, signal);
      const t1 = performance.now();
      await send(step.pair[1]);
      const deadline = t1 + confirmMs;
      let views = {};
      let truth = null;
      const result = await until(t1, deadline, async () => {
        const [tr, a, b] = await Promise.all([truthOf(lamp), viewOf(step.pair[0].via, [step.ieee]), viewOf(step.pair[1].via, [step.ieee])]);
        views = { [step.pair[0].via]: a, [step.pair[1].via]: b };
        truth = tr;
        return { tr, a, b };
      }, ({ tr, a, b }) => {
        const state = tr === 1 ? "on" : "off";
        return [a, b].every((v) => v.live[step.ieee] === state && !v.doubt[step.ieee]);
      });
      if (result.okReads === 0) {
        // not one read of the lamp or of the views worked: the harness could not look
        Object.assign(record, { outcome: "harness-error", error: result.error?.message ?? "no read of the state" });
        writer.append(record);
        return;
      }
      const state = truth === 1 ? "on" : truth === 0 ? "off" : null;
      Object.assign(record, {
        final: state,
        views: Object.fromEntries(Object.entries(views).map(([k, v]) => [k, v.live[step.ieee] ?? null])),
        doubts: Object.fromEntries(Object.entries(views).map(([k, v]) => [k, v.doubt[step.ieee] === true])),
        converge_ms: result.ms,
        polls: result.polls,
      });
      record.outcome = result.ms !== null ? "converged" : Object.values(record.doubts).some(Boolean) ? "doubt-stuck" : "diverged";
    } catch (e) {
      if (e.code === "auth" || e.code === "write-blocked") throw e;
      Object.assign(record, { outcome: "send-failed", error: e.message });
    }
    writer.append(record);
  }

  async function meshStep(step) {
    const from = devices.get(step.via);
    const to = devices.get(step.to);
    const record = { kind: "load", v: 1, ...stamp(), run, i: step.i, scenario: step.scenario, path: "mesh", transport: "mesh", via: step.via, target: step.to, tag, wait_ms: step.wait_ms, ieee: null };
    const counters = async (d) => {
      const { json } = await client.cmd(d.ip, "EspNowMeshStatus");
      const s = json.EspNowMeshStatus;
      if (!s || typeof s.Delivered !== "number") throw new BenchError("no-mesh", `${d.name} answered EspNowMeshStatus with no counters (the image has no mesh driver, or it does not run)`);
      return { delivered: s.Delivered, acks: s.AcksHeard ?? 0, gaveUp: s.GaveUp ?? 0 };
    };
    let before;
    let senderBefore;
    try {
      [before, senderBefore] = await Promise.all([counters(to), counters(from)]);
    } catch (e) {
      if (e.code === "auth" || e.code === "write-blocked") throw e;
      Object.assign(record, { outcome: "harness-error", error: e.message, sent: null });
      emit(record);
      return;
    }
    const cmd = meshSendCommand(step.to_id, options.meshType ?? 0, step.text);
    const t0 = performance.now();
    try {
      const r = await client.cmd(from.ip, cmd, { write: true });
      record.cmd = cmd;
      record.sent = { ok: !refused(r.json), rtt_ms: r.rttMs, answer: JSON.stringify(r.json).slice(0, 60) };
    } catch (e) {
      if (e.code === "auth" || e.code === "write-blocked") throw e;
      Object.assign(record, { cmd, sent: { ok: false, error: e.message }, outcome: "send-failed" });
      emit(record);
      return;
    }
    const deadline = t0 + confirmMs;
    const result = await until(t0, deadline, async () => {
      const [r, s] = await Promise.all([counters(to), counters(from)]);
      return { r, s };
    }, ({ r, s }) => r.delivered > before.delivered && (s.acks > senderBefore.acks || s.gaveUp > senderBefore.gaveUp));
    const last = result.last;
    const delivered = last ? last.r.delivered > before.delivered : false;
    Object.assign(record, {
      truth_ms: delivered ? (result.ms ?? Math.round(performance.now() - t0)) : null,
      panel_ms: null,
      acked: last ? last.s.acks > senderBefore.acks : null,
      flagged: last ? last.s.gaveUp > senderBefore.gaveUp : null,
      polls: result.polls,
    });
    record.silent = record.flagged === null ? null : !delivered && record.flagged === false;
    record.outcome = delivered ? "confirmed" : "unconfirmed";
    emit(record);
  }

  for (const step of plan.steps) {
    if (signal?.aborted) break;
    if (step.path === "mesh") await meshStep(step);
    else if (step.pair) await alternate(step);
    else await group(step);
    log(step);
    await sleep(step.wait_ms, signal);
  }
  const summary = {};
  for (const [transport, t] of tally) {
    const { ms, ...counts } = t;
    summary[transport] = { ...counts, truth_ms: summarize(ms) };
  }
  writer.append({ kind: "load-summary", v: 1, ...stamp(), run, scenario: plan.scenario, steps_planned: plan.steps.length, aborted: Boolean(signal?.aborted), tag, summary });
  return summary;
}

export async function main({ values }) {
  if (!values.topology) throw new UsageError("--topology is required: the lamps, their coordinators, the panels' taps and the mesh ids come from it");
  const topology = loadTopology(values.topology);
  const plan = planLoad({
    topology,
    scenario: values.scenario,
    paths: values.paths,
    n: values.n,
    seed: values.seed,
    gapMs: values.gap,
    burstSizes: values["burst-sizes"],
    offsetMax: values["offset-max"],
    panelView: values["panel-view"],
  });
  if (values["panel-view"] && values["confirm-timeout"] < 2500) console.log("note: the panel shows the \"?\" 2 s after a command (PENDING_MS); a window under 2.5 s cannot see it");
  console.log(`bench-load: ${values.yes ? "RUNNING" : "DRY RUN, nothing is sent"}`);
  console.log(`scenario ${plan.scenario}, seed ${plan.seed}, paths ${plan.paths.join(",")}, ${plan.steps.length} steps, ${plan.writes} commands, about ${Math.round(plan.estimateMs / 60000)} min`);
  for (const w of plan.warnings) console.log(`warning: ${w}`);
  if (plan.steps.length === 0) throw new BenchError("empty-plan", "the topology gives no step for these paths and this scenario");
  for (const step of plan.steps.slice(0, 8)) console.log(`  ${describeStep(step)}`);
  if (plan.steps.length > 8) console.log(`  ... and ${plan.steps.length - 8} more`);
  if (!values.yes) {
    console.log("Nothing was sent. Run again with --yes.");
    return 0;
  }
  const dir = openRunDir(values.out);
  snapshotTopology(dir, topology);
  const writer = new JsonlWriter(join(dir, "load.jsonl"));
  const stop = new AbortController();
  process.once("SIGINT", () => stop.abort());
  writeMeta(dir, "bench-load", { started: stamp().t, argv: process.argv.slice(2), seed: plan.seed, scenario: plan.scenario });
  const client = makeClient({ timeoutMs: 5000, allowWrites: true });
  try {
    const summary = await executeLoad({
      plan,
      topology,
      client,
      writer,
      signal: stop.signal,
      options: { confirmTimeoutMs: values["confirm-timeout"], pollMs: values["poll-ms"], panelView: values["panel-view"], meshType: values["mesh-type"], tag: values.tag },
      log: (step) => {
        if (step.i % 25 === 24) console.log(`  ${step.i + 1}/${plan.steps.length} steps`);
      },
    });
    for (const [transport, t] of Object.entries(summary)) console.log(`${transport}: ${t.n} lines, ${t.confirmed} confirmed, ${t.unconfirmed} unconfirmed, ${t.send_failed} not sent, ${t.silent} silent; p95 ${t.truth_ms.p95 ?? "-"} ms`);
  } finally {
    await writer.close();
    writeMeta(dir, "bench-load", { ended: stamp().t, lines: writer.count });
  }
  console.log(`written to ${dir}`);
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = await runMain(SPEC, process.argv.slice(2), main);
