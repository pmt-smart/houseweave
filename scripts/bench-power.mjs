#!/usr/bin/env node
// The bench's power: cuts and restores the mains of the devices through outlets or relays
// that a Tasmota controls over HTTP, and checks what came back.
//
//   node scripts/bench-power.mjs cuts     --topology F --outlets a,b [--cycles 100] [--seed 1] [--saves] [--check-persist] [--watch panel:lamp]
//   node scripts/bench-power.mjs blackout --topology F --outlets a,b,c --order router-first [--delay 10000] [--off 8000]
//
// Without --yes it prints the plan (which outlet, when, for how long, what it would write) and sends NOTHING.
// With --yes it sends Power<channel> ON|OFF to the outlets, and reads (Status 1, Status 11, the persist file) from
// the devices behind them. The outlets are the topology's `outlets`: name, ip, channel, role (router, bridge, panel,
// other) and `powers`, the devices behind each. The outlet is a Tasmota like the others: it must answer /cm with no
// password (this script never sends one), and that is the owner's to arrange for the bench's outlets.
//
// The scenarios:
//   cuts      CYCLES times: a seeded outlet, cut at a seeded moment, off for a seeded time, back on; then the devices
//             behind it are waited for (Status 11) and checked: the boot count went up, the uptime is small, and, with
//             --check-persist, the _persist.json is whole. REFUSED unless every device behind the outlet is marked
//             sacrificial in the topology: a cut at a random moment can land in a save, and the installed devices
//             never get a test that can erase a configuration.
//             --saves makes the cuts land in saves: until the cut, the sacrificial devices save a counter in their
//             persist (`bench_n`, +1 and persist.save(), over and over, through Br), and the counter each acknowledged
//             is kept. After the boot the counter and the file must hold: no acknowledged save lost, and no key gone
//             (RB1). `bench_n` is removed from the devices at the end.
//             --watch panel:lamp watches the panel's own view of the lamp while its coordinator is cut:
//             how long until the lamp shows as unavailable, how often it flaps, and how long after the restore it
//             comes back. It reads `global.plan.<watch-field>`, "doubt" by default, the "no communication" look.
//   blackout  every chosen outlet is cut together, and restored in an ORDER: together, router-first, router-last,
//             bridges-first, panels-first or staggered (seeded). The devices are waited for from their own outlet's
//             restore: when each answered, and when the last did.
//
// The output, power.jsonl in the run directory:
//   {"kind":"power-run", scenario, seed, outlets, cycles|order, ...}
//   {"kind":"power-cycle","cycle","outlet","off_ms","cut_delay_ms","devices":[{"name","role","sacrificial","back_ms"|null,
//       "uptime_s","boot_count_before","boot_count_after","boot_delta","persist":{...}|null}],"saves":{...}|null,"watch":[...]}
//   {"kind":"power-blackout","order","off_ms","restores":[{"outlet","at_ms"}],"devices":[{"name","back_ms"|null,"since_first_ms"}],"all_back_ms"}
//   {"kind":"power-summary", cycles, back_all, ...}
// An outlet that was cut is restored whatever happens, Ctrl-C and errors included.
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
  shortHash,
  sleep,
  snapshotTopology,
  stamp,
  topologyDigest,
  writeMeta,
} from "./lib/bench.mjs";

const SPEC = {
  usage: "node scripts/bench-power.mjs cuts|blackout --topology F --outlets a,b [options]",
  summary: `
Cuts and restores the mains of the bench's devices through Tasmota outlets, with seeded moments and orders, and checks
what came back. Without --yes it prints the plan and sends nothing.`,
  options: {
    topology: { type: "string", help: "the topology file, with its outlets (required)" },
    outlets: { type: "list", help: "the outlets to use, by name (required)" },
    seed: { type: "string", help: "the seed: the same seed gives the same cuts", default: "1" },
    cycles: { type: "int", help: "cuts: how many cycles", default: 10 },
    "off-min": { type: "int", help: "cuts: shortest time off, ms", default: 3000 },
    "off-max": { type: "int", help: "cuts: longest time off, ms", default: 8000 },
    "settle-min": { type: "int", help: "cuts: shortest pause after a cycle, ms", default: 2000 },
    "settle-max": { type: "int", help: "cuts: longest pause after a cycle, ms", default: 6000 },
    "cut-delay-min": { type: "int", help: "cuts with --saves: shortest time saving before the cut, ms", default: 300 },
    "cut-delay-max": { type: "int", help: "cuts with --saves: longest time saving before the cut, ms", default: 2500 },
    saves: { type: "boolean", help: "cuts: save a counter in the persist until the cut, so that the cut lands in saves (sacrificial devices)" },
    "check-persist": { type: "boolean", help: "cuts: read _persist.json (key names and size only) before and after each cut" },
    watch: { type: "list", help: "cuts: panel:lamp pairs whose view is watched while the lamp's coordinator is cut" },
    "watch-field": { type: "string", help: "which of the panel's maps shows a lamp as unavailable", default: "doubt" },
    "watch-window": { type: "int", help: "cuts: how long after the restore the watch goes on, ms", default: 15000 },
    order: { type: "string", help: "blackout: together | router-first | router-last | bridges-first | panels-first | staggered", default: "together" },
    delay: { type: "int", help: "blackout: the pause between groups of an order, ms (the longest step of staggered)", default: 10000 },
    off: { type: "int", help: "blackout: how long everything stays off, ms", default: 8000 },
    "wait-boot": { type: "int", help: "how long a device has to answer after its restore, ms", default: 120000 },
    tag: { type: "string", help: "a label for the run" },
    out: { type: "string", help: "the run directory (default bench/<UTC time>)" },
    yes: { type: "boolean", help: "do it: cut the power. Without it only the plan is printed" },
  },
  notes: "The outlets are cut only when named: nothing is chosen for you. A device that asks for a password stops the run.",
};

const ORDERS = ["together", "router-first", "router-last", "bridges-first", "panels-first", "staggered"];

// the Berry this script sends to a sacrificial device's console (Br runs an expression, or statements)
export const SAVE_EXPRESSION = 'Br (def () import persist var n=persist.find("bench_n", 0)+1 persist.bench_n=n persist.save() return n end)()';
export const READ_COUNTER_EXPRESSION = 'Br (def () import persist return persist.find("bench_n", -1) end)()';
export const CLEAN_EXPRESSION = 'Br (def () import persist persist.remove("bench_n") persist.save() end)()';

// ---------------------------------------------------------------------------------------------------------------
// the plan: pure

export function outletDevices(topology, outlet) {
  return outlet.powers.map((n) => topology.devices.find((d) => d.name === n));
}

/** The restore order of a blackout: [{ outlet, at_ms }], earliest first. */
export function restoreOrder(order, outlets, rng, delayMs) {
  const role = (o) => o.role;
  const groups = {
    together: () => [outlets],
    "router-first": () => [outlets.filter((o) => role(o) === "router"), outlets.filter((o) => role(o) !== "router")],
    "router-last": () => [outlets.filter((o) => role(o) !== "router"), outlets.filter((o) => role(o) === "router")],
    "bridges-first": () => [outlets.filter((o) => role(o) === "bridge"), outlets.filter((o) => role(o) !== "bridge")],
    "panels-first": () => [outlets.filter((o) => role(o) === "panel"), outlets.filter((o) => role(o) !== "panel")],
  };
  if (order === "staggered") {
    let at = 0;
    return rng.shuffle(outlets).map((outlet, k) => {
      if (k > 0) at += rng.int(1000, Math.max(1000, delayMs));
      return { outlet: outlet.name, at_ms: at };
    });
  }
  const parts = groups[order]().filter((g) => g.length > 0);
  if (parts.length === 0 || (order !== "together" && parts.length < 2)) {
    throw new UsageError(`--order ${order} needs outlets of the roles it separates (router, bridge or panel) and some of another role; the chosen outlets are ${outlets.map((o) => `${o.name}(${o.role})`).join(", ")}`);
  }
  return parts.flatMap((g, k) => g.map((o) => ({ outlet: o.name, at_ms: k * delayMs })));
}

export function planPower({ topology, scenario, outlets: names, seed = "1", cycles = 10, offMin = 3000, offMax = 8000, settleMin = 2000, settleMax = 6000, cutDelayMin = 300, cutDelayMax = 2500, saves = false, checkPersist = false, watch = [], order = "together", delayMs = 10000, offMs = 8000 }) {
  if (!["cuts", "blackout"].includes(scenario)) throw new UsageError("name the scenario: cuts or blackout");
  if (!names || names.length === 0) throw new UsageError("--outlets is required: the outlets are cut only when named");
  const byName = new Map(topology.outlets.map((o) => [o.name, o]));
  const outlets = names.map((n) => {
    const o = byName.get(n);
    if (!o) throw new UsageError(`no outlet "${n}" in the topology (${[...byName.keys()].join(", ") || "none"})`);
    return o;
  });
  seed = String(seed);
  const rng = makeRng(seed);
  const plan = { scenario, seed, outlets: outlets.map((o) => o.name), warnings: [], checkPersist, saves, watch: [] };
  const powered = [...new Set(outlets.flatMap((o) => o.powers))].map((n) => topology.devices.find((d) => d.name === n));
  plan.devices = powered.map((d) => d.name);
  if (scenario === "cuts") {
    for (const o of outlets) {
      const bad = outletDevices(topology, o).filter((d) => !d.sacrificial);
      if (bad.length) throw new BenchError("not-sacrificial", `cuts refuses the outlet "${o.name}": it powers ${bad.map((d) => d.name).join(", ")}, not marked sacrificial in the topology. A cut at a random moment can land in a save, and the installed devices never get a test that can erase a configuration`);
    }
    if (saves) {
      const unfit = powered.filter((d) => !d.sacrificial);
      if (powered.length === 0 || unfit.length) throw new BenchError("not-sacrificial", "--saves writes to the devices' persist: it needs outlets that power sacrificial devices");
    }
    if (!(cycles >= 1)) throw new UsageError("--cycles needs 1 or more");
    const pr = rng.fork("cuts");
    plan.cycles = Array.from({ length: cycles }, (_, c) => ({
      cycle: c,
      outlet: pr.pick(outlets).name,
      off_ms: pr.int(offMin, offMax),
      cut_delay_ms: saves ? pr.int(cutDelayMin, cutDelayMax) : 0,
      settle_ms: pr.int(settleMin, settleMax),
    }));
    for (const w of watch) {
      const [panelName, lampName] = String(w).split(":");
      const panel = topology.devices.find((d) => d.name === panelName && d.role === "panel");
      const lamp = topology.lamps.find((l) => l.name === lampName);
      if (!panel || !lamp) throw new UsageError(`--watch ${w}: needs panel:lamp, a panel and a lamp of the topology`);
      const covered = outlets.filter((o) => o.powers.includes(lamp.coordinator));
      if (covered.length === 0) plan.warnings.push(`--watch ${w}: no chosen outlet powers the coordinator "${lamp.coordinator}", so it is never watched`);
      plan.watch.push({ panel: panel.name, lamp: lamp.name, ieee: lamp.ieee, coordinator: lamp.coordinator });
    }
  } else {
    if (!ORDERS.includes(order)) throw new UsageError(`--order: ${ORDERS.join(", ")}`);
    plan.order = order;
    plan.off_ms = offMs;
    plan.restores = restoreOrder(order, outlets, rng.fork("order"), delayMs);
    const installed = powered.filter((d) => !d.sacrificial);
    if (installed.length) plan.warnings.push(`blackout also cuts devices not marked sacrificial (${installed.map((d) => d.name).join(", ")}): the power loss of a whole house, which is what it tests`);
  }
  for (const o of outlets.filter((x) => x.role === "router")) {
    plan.warnings.push(`${o.name} cuts the router: its restore has to reach the outlet while the router is off (an outlet with its own access point or on a wire, and this machine on that wire). If the outlet is on the very network it cuts, the restore cannot arrive and the router stays off until someone turns it on`);
  }
  return plan;
}

export function describePlan(plan) {
  const lines = [`scenario ${plan.scenario}, seed ${plan.seed}, outlets ${plan.outlets.join(", ")}, devices behind them: ${plan.devices.join(", ") || "none"}`];
  if (plan.scenario === "cuts") {
    lines.push(`${plan.cycles.length} cycles${plan.saves ? ", each cut landing in saves (writes bench_n to the sacrificial devices' persist)" : ""}${plan.checkPersist ? ", _persist.json read before and after" : ""}`);
    for (const c of plan.cycles.slice(0, 8)) lines.push(`  #${c.cycle} cut ${c.outlet}${plan.saves ? ` after ${c.cut_delay_ms} ms of saves` : ""}, off ${c.off_ms} ms, then ${c.settle_ms} ms apart`);
    if (plan.cycles.length > 8) lines.push(`  ... and ${plan.cycles.length - 8} more`);
    for (const w of plan.watch) lines.push(`  watch: ${w.panel} for ${w.lamp} (its coordinator ${w.coordinator})`);
  } else {
    lines.push(`everything off together for ${plan.off_ms} ms, then restored in the order ${plan.order}:`);
    for (const r of plan.restores) lines.push(`  at +${r.at_ms} ms: ${r.outlet}`);
  }
  for (const w of plan.warnings) lines.push(`warning: ${w}`);
  return lines;
}

/**
 * What a watch of a lamp's unavailable flag says. `changes` is [[ms since the cut, flag], ...], one entry each time the
 * flag changed (and the first reading); `restoreAt` is when the power came back, in the same time. unavailable_ms is when
 * it first showed unavailable; flaps counts the times it went back to available BEFORE the restore (a flicker: the lamp's
 * owner is still cut); returned_ms is how long after the restore it showed available again.
 */
export function watchSummary(changes, restoreAt) {
  const first = changes.find(([, flag]) => flag === true);
  if (!first) return { unavailable_ms: null, flaps: null, returned_ms: null };
  const flaps = changes.filter(([ms, flag], i) => flag === false && i > 0 && ms <= restoreAt && ms > first[0]).length;
  const flagAtRestore = [...changes].reverse().find(([ms]) => ms <= restoreAt)?.[1] ?? null;
  const back = changes.find(([ms, flag]) => flag === false && ms > restoreAt);
  return { unavailable_ms: first[0], flaps, returned_ms: flagAtRestore === false ? 0 : back ? back[0] - restoreAt : null };
}

// ---------------------------------------------------------------------------------------------------------------
// the execution

export async function executePower({ plan, topology, client, writer, options = {}, signal, log = () => {} }) {
  const deviceBy = new Map(topology.devices.map((d) => [d.name, d]));
  const outletBy = new Map(topology.outlets.map((o) => [o.name, o]));
  const waitBootMs = options.waitBootMs ?? 120000;
  const watchField = options.watchField ?? "doubt";
  const watchWindowMs = options.watchWindowMs ?? 15000;
  const quick = makeClient({ timeoutMs: options.quickTimeoutMs ?? 1500 });
  const tag = options.tag ?? null;
  const run = options.run ?? stamp().ms;
  const off = new Set(); // the outlets that are cut right now: restored in the finally
  const stoppers = new Set(); // what ends the saves and the watches of a cycle, called in the finally too

  const setOutlet = async (outlet, on) => {
    // an outlet is counted as cut before the command goes: if the answer is lost, it is still restored at the end
    if (!on) off.add(outlet.name);
    // a restore that does not arrive leaves a device without power: it is tried again, a cut is not
    const attempts = on ? options.restoreAttempts ?? 3 : 1;
    for (let attempt = 1; ; attempt++) {
      try {
        const { json } = await client.cmd(outlet.ip, `Power${outlet.channel} ${on ? "ON" : "OFF"}`, { write: true });
        const answer = json[`POWER${outlet.channel}`] ?? json.POWER;
        const ok = String(answer).toUpperCase() === (on ? "ON" : "OFF");
        if (!ok) throw new BenchError("outlet", `${outlet.name} answered ${JSON.stringify(json).slice(0, 80)} to Power${outlet.channel} ${on ? "ON" : "OFF"}`);
        break;
      } catch (e) {
        // a command that never left (no --yes, a password) cut nothing
        if (!on && (e.code === "write-blocked" || e.code === "auth")) off.delete(outlet.name);
        if (e.code === "write-blocked" || e.code === "auth" || attempt >= attempts) throw e;
        await sleep(options.restoreRetryMs ?? 1000);
      }
    }
    if (on) off.delete(outlet.name);
    return Math.round(performance.now());
  };

  const bootCount = async (device) => {
    try {
      const { json } = await quick.cmd(device.ip, "Status 1");
      return json?.StatusPRM?.BootCount ?? null;
    } catch (e) {
      if (e.code === "auth") throw e;
      return null;
    }
  };

  const waitBack = async (device, fromMono) => {
    const deadline = fromMono + waitBootMs;
    for (;;) {
      try {
        const { json } = await quick.cmd(device.ip, "Status 11");
        return { back_ms: Math.round(performance.now() - fromMono), uptime_s: json?.StatusSTS?.UptimeSec ?? null };
      } catch (e) {
        if (e.code === "auth") throw e;
      }
      if (performance.now() >= deadline || signal?.aborted) return { back_ms: null, uptime_s: null };
      await sleep(options.backPollMs ?? 500, signal);
    }
  };

  /** The persist file: its keys and size, never its content. */
  const readPersistFile = async (device) => {
    try {
      const res = await client.get(device.ip, "/ufsd?download=/_persist.json", { timeoutMs: 5000 });
      if (res.status !== 200) return { ok: false, reason: `status ${res.status}` };
      let doc;
      try {
        doc = JSON.parse(res.body);
      } catch {
        return { ok: false, reason: "not JSON", bytes: res.bytes };
      }
      if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return { ok: false, reason: "not an object", bytes: res.bytes };
      return { ok: true, bytes: res.bytes, keys: Object.keys(doc).sort(), bench_n: typeof doc.bench_n === "number" ? doc.bench_n : null, hash: shortHash(res.body) };
    } catch (e) {
      if (e.code === "auth") throw e;
      return { ok: false, reason: e.message };
    }
  };

  // whether the panel shows the lamp as unavailable: its map `watchField`
  const viewOf = async (panel, ieee) => {
    const { value } = await client.br(panel.ip, panelViewExpression([ieee], watchField));
    return parsePanelView([ieee], value).doubt;
  };

  writer.append({ kind: "power-run", v: 1, ...stamp(), run, scenario: plan.scenario, seed: plan.seed, outlets: plan.outlets, devices: plan.devices, cycles: plan.cycles?.length ?? null, order: plan.order ?? null, saves: plan.saves, check_persist: plan.checkPersist, wait_boot_ms: waitBootMs, tag, topology: topologyDigest(topology) });
  let cycles = 0;
  let allBack = true;
  try {
    if (plan.scenario === "cuts") {
      for (const c of plan.cycles) {
        if (signal?.aborted) break;
        const outlet = outletBy.get(c.outlet);
        const devices = outletDevices(topology, outlet);
        const record = { kind: "power-cycle", v: 1, ...stamp(), run, cycle: c.cycle, outlet: outlet.name, channel: outlet.channel, off_ms: c.off_ms, cut_delay_ms: c.cut_delay_ms, tag, devices: [], saves: null, watch: [] };
        // what the devices were before
        const before = new Map();
        for (const d of devices) before.set(d.name, { boot: await bootCount(d), file: plan.checkPersist || plan.saves ? await readPersistFile(d) : null });
        // the saves, until the cut
        const savers = [];
        let saving = true;
        if (plan.saves) {
          for (const d of devices) {
            const state = { name: d.name, sent: 0, acked: 0, last_ack: null, errors: 0 };
            savers.push(state);
            state.loop = (async () => {
              while (saving && !signal?.aborted) {
                state.sent++;
                try {
                  const r = await client.br(d.ip, SAVE_EXPRESSION, { write: true });
                  if (typeof r.value === "number") {
                    state.acked++;
                    state.last_ack = r.value;
                  }
                } catch (e) {
                  if (e.code === "auth" || e.code === "write-blocked") throw e;
                  state.errors++;
                  await sleep(20, signal);
                }
              }
            })();
            // an error of the loop is raised where it is awaited, after the restore: never as an unhandled rejection
            state.loop.catch(() => {});
          }
          await sleep(c.cut_delay_ms, signal);
        }
        // the watch of the panels' views: from the cut until the devices are back and a window after
        const watchers = [];
        let watching = true;
        const tCut = performance.now();
        const watchEnd = { restoreAt: null };
        const stop = () => {
          saving = false;
          watching = false;
        };
        stoppers.add(stop);
        for (const w of plan.watch.filter((x) => devices.some((d) => d.name === x.coordinator))) {
          const panel = deviceBy.get(w.panel);
          const state = { panel: w.panel, lamp: w.lamp, field: watchField, changes: [] };
          watchers.push(state);
          state.loop = (async () => {
            let last = null;
            while (watching && !signal?.aborted) {
              try {
                const flag = (await viewOf(panel, w.ieee))[w.ieee] === true;
                if (flag !== last) {
                  state.changes.push([Math.round(performance.now() - tCut), flag]);
                  last = flag;
                }
              } catch (e) {
                if (e.code === "auth") throw e;
              }
              await sleep(options.watchPollMs ?? 250, signal);
            }
          })();
          state.loop.catch(() => {});
        }
        // the cut
        await setOutlet(outlet, false);
        record.t_cut = stamp().t;
        saving = false;
        await Promise.all(savers.map((s) => s.loop));
        await sleep(c.off_ms, signal);
        // the restore, and what came back
        const tRestore = performance.now();
        watchEnd.restoreAt = Math.round(tRestore - tCut);
        await setOutlet(outlet, true);
        const backs = await Promise.all(devices.map((d) => waitBack(d, tRestore)));
        for (const [k, d] of devices.entries()) {
          const entry = { name: d.name, role: d.role, sacrificial: d.sacrificial, back_ms: backs[k].back_ms, uptime_s: backs[k].uptime_s, boot_count_before: before.get(d.name).boot, boot_count_after: null, boot_delta: null, persist: null };
          if (backs[k].back_ms === null) allBack = false;
          else {
            entry.boot_count_after = await bootCount(d);
            entry.boot_delta = entry.boot_count_after !== null && entry.boot_count_before !== null ? entry.boot_count_after - entry.boot_count_before : null;
            if (plan.checkPersist || plan.saves) {
              const after = await readPersistFile(d);
              const was = before.get(d.name).file;
              const saver = savers.find((s) => s.name === d.name);
              let bootN = null;
              if (plan.saves) {
                try {
                  const r = await client.br(d.ip, READ_COUNTER_EXPRESSION);
                  bootN = typeof r.value === "number" ? r.value : null;
                } catch (e) {
                  if (e.code === "auth") throw e;
                }
              }
              const floor = Math.max(saver?.last_ack ?? 0, was?.bench_n ?? 0);
              const lost = was?.ok && after.ok ? was.keys.filter((k2) => k2 !== "bench_n" && !after.keys.includes(k2)) : null;
              const reasons = [];
              // what can be concluded: the file, when it could be read before; the counter, when saves ran
              const fileChecked = Boolean(was?.ok);
              const counterChecked = plan.saves && bootN !== null;
              if (fileChecked && !after.ok) reasons.push(`the file was readable before the cut and is not after it (${after.reason})`);
              if (lost && lost.length) reasons.push(`${lost.length} key(s) gone`);
              if (plan.saves && bootN === null) reasons.push("the counter cannot be read after the boot");
              if (counterChecked && bootN < floor) reasons.push(`the counter is ${bootN}, below the ${floor} that a save acknowledged`);
              const conclusive = fileChecked || counterChecked || reasons.length > 0;
              entry.persist = { file_ok: after.ok, bytes: after.bytes ?? null, key_count: after.keys?.length ?? null, lost_keys: lost, counter_floor: plan.saves ? floor : null, counter_after: bootN, ok: conclusive ? reasons.length === 0 : null, reasons };
            }
          }
          record.devices.push(entry);
        }
        if (plan.saves) record.saves = savers.map(({ name, sent, acked, last_ack, errors }) => ({ name, sent, acked, last_ack, errors }));
        // the watch ends a window after the restore
        await sleep(watchers.length ? watchWindowMs : 0, signal);
        watching = false;
        await Promise.all(watchers.map((w) => w.loop));
        for (const w of watchers) record.watch.push({ panel: w.panel, lamp: w.lamp, field: w.field, ...watchSummary(w.changes, watchEnd.restoreAt), changes: w.changes, restore_at_ms: watchEnd.restoreAt });
        writer.append(record);
        cycles++;
        log(c);
        await sleep(c.settle_ms, signal);
      }
    } else {
      const outletList = plan.outlets.map((n) => outletBy.get(n));
      const devices = [...new Set(outletList.flatMap((o) => o.powers))].map((n) => deviceBy.get(n));
      const before = new Map();
      for (const d of devices) before.set(d.name, await bootCount(d));
      const record = { kind: "power-blackout", v: 1, ...stamp(), run, order: plan.order, off_ms: plan.off_ms, restores: plan.restores, tag, devices: [], all_back_ms: null };
      await Promise.all(outletList.map((o) => setOutlet(o, false)));
      record.t_cut = stamp().t;
      await sleep(plan.off_ms, signal);
      const t0 = performance.now();
      const results = new Map();
      await Promise.all(plan.restores.map(async (r) => {
        await sleep(Math.max(0, r.at_ms - (performance.now() - t0)), signal);
        const outlet = outletBy.get(r.outlet);
        await setOutlet(outlet, true);
        const tOwn = performance.now();
        const backs = await Promise.all(outletDevices(topology, outlet).map(async (d) => [d, await waitBack(d, tOwn)]));
        for (const [d, b] of backs) results.set(d.name, { ...b, since_first_ms: b.back_ms === null ? null : Math.round(tOwn - t0 + b.back_ms) });
      }));
      for (const d of devices) {
        const r = results.get(d.name) ?? { back_ms: null, since_first_ms: null, uptime_s: null };
        const after = r.back_ms !== null ? await bootCount(d) : null;
        record.devices.push({ name: d.name, role: d.role, back_ms: r.back_ms, since_first_ms: r.since_first_ms, uptime_s: r.uptime_s, boot_count_before: before.get(d.name), boot_count_after: after, boot_delta: after !== null && before.get(d.name) !== null ? after - before.get(d.name) : null });
        if (r.back_ms === null) allBack = false;
      }
      record.all_back_ms = allBack && record.devices.length ? Math.max(...record.devices.map((x) => x.since_first_ms)) : null;
      writer.append(record);
      cycles = 1;
    }
  } finally {
    for (const stop of stoppers) stop();
    // whatever happened, nothing is left without power
    for (const name of [...off]) {
      try {
        await setOutlet(outletBy.get(name), true);
      } catch (e) {
        console.error(`could not restore ${name}: ${e.message}. Restore it by hand.`);
      }
    }
    if (plan.saves) {
      for (const d of plan.devices.map((n) => deviceBy.get(n))) {
        try {
          await client.br(d.ip, CLEAN_EXPRESSION, { write: true });
        } catch {
          // the device is not back, or has no counter: the owner can remove the key bench_n by hand
        }
      }
    }
  }
  const summary = { kind: "power-summary", v: 1, ...stamp(), run, scenario: plan.scenario, cycles, all_back: allBack, aborted: Boolean(signal?.aborted), tag };
  writer.append(summary);
  return summary;
}

export async function main({ values, positional }) {
  const scenario = positional[0];
  if (!values.topology) throw new UsageError("--topology is required");
  const topology = loadTopology(values.topology);
  const plan = planPower({
    topology,
    scenario,
    outlets: values.outlets,
    seed: values.seed,
    cycles: values.cycles,
    offMin: values["off-min"],
    offMax: values["off-max"],
    settleMin: values["settle-min"],
    settleMax: values["settle-max"],
    cutDelayMin: values["cut-delay-min"],
    cutDelayMax: values["cut-delay-max"],
    saves: values.saves,
    checkPersist: values["check-persist"],
    watch: values.watch ?? [],
    order: values.order,
    delayMs: values.delay,
    offMs: values.off,
  });
  console.log(`bench-power: ${values.yes ? "RUNNING" : "DRY RUN, nothing is sent"}`);
  for (const line of describePlan(plan)) console.log(line);
  if (!values.yes) {
    console.log("Nothing was sent. Run again with --yes.");
    return 0;
  }
  const dir = openRunDir(values.out);
  snapshotTopology(dir, topology);
  const writer = new JsonlWriter(join(dir, "power.jsonl"));
  const stop = new AbortController();
  process.once("SIGINT", () => stop.abort());
  writeMeta(dir, "bench-power", { started: stamp().t, argv: process.argv.slice(2), seed: plan.seed, scenario });
  try {
    const summary = await executePower({
      plan,
      topology,
      client: makeClient({ timeoutMs: 5000, allowWrites: true }),
      writer,
      signal: stop.signal,
      options: { waitBootMs: values["wait-boot"], watchField: values["watch-field"], watchWindowMs: values["watch-window"], tag: values.tag },
      log: (c) => console.log(`  cycle ${c.cycle + 1}/${plan.cycles.length} done`),
    });
    console.log(`${summary.cycles} cycle(s), every device back: ${summary.all_back}${summary.aborted ? " (aborted)" : ""}`);
  } finally {
    await writer.close();
    writeMeta(dir, "bench-power", { ended: stamp().t, lines: writer.count });
  }
  console.log(`written to ${dir}`);
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = await runMain(SPEC, process.argv.slice(2), main);
