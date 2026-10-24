// scripts/bench-power.mjs: the plan (seeded cuts, the orders of a blackout), what it refuses, and the execution against
// mocks: an outlet that takes a device off the air and back after a boot time, a device whose persist a cut can corrupt.
// The dry run is on 203.0.113.x and sends nothing.
//
//   node --test "scripts/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { CLEAN_EXPRESSION, READ_COUNTER_EXPRESSION, SAVE_EXPRESSION, describePlan, executePower, planPower, restoreOrder, watchSummary } from "../bench-power.mjs";
import { JsonlWriter, makeClient, makeRng, validateTopology } from "../lib/bench.mjs";
import { startMock } from "./mock-tasmota.mjs";

const repo = join(import.meta.dirname, "..", "..");
const IEEE = (n) => `0x00124B0000AA${String(n).padStart(4, "0")}`;
const rows = (file) => readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

function offline() {
  return validateTopology({
    devices: [
      { name: "bridge-s", role: "bridge", ip: "203.0.113.11", sacrificial: true },
      { name: "panel-s", role: "panel", ip: "203.0.113.12", sacrificial: true, bridge: "bridge-s" },
      { name: "panel-ref", role: "panel", ip: "203.0.113.13", bridge: "bridge-s" },
    ],
    lamps: [{ name: "lamp-1", ieee: IEEE(1), coordinator: "bridge-s" }],
    outlets: [
      { name: "plug-router", ip: "203.0.113.20", role: "router" },
      { name: "plug-bridge", ip: "203.0.113.21", role: "bridge", powers: ["bridge-s"] },
      { name: "plug-panel", ip: "203.0.113.22", channel: 2, role: "panel", powers: ["panel-s"] },
      { name: "plug-ref", ip: "203.0.113.23", role: "panel", powers: ["panel-ref"] },
    ],
  });
}

test("the plan: the same seed gives the same cuts, and the numbers stay in their ranges", () => {
  const t = offline();
  const a = planPower({ topology: t, scenario: "cuts", outlets: ["plug-bridge", "plug-panel"], seed: 11, cycles: 30, offMin: 1000, offMax: 2000 });
  const b = planPower({ topology: t, scenario: "cuts", outlets: ["plug-bridge", "plug-panel"], seed: "11", cycles: 30, offMin: 1000, offMax: 2000 });
  const c = planPower({ topology: t, scenario: "cuts", outlets: ["plug-bridge", "plug-panel"], seed: 12, cycles: 30, offMin: 1000, offMax: 2000 });
  assert.deepEqual(a.cycles, b.cycles);
  assert.notDeepEqual(a.cycles, c.cycles);
  assert.ok(a.cycles.every((x) => x.off_ms >= 1000 && x.off_ms <= 2000 && x.settle_ms >= 2000 && x.cut_delay_ms === 0));
  assert.deepEqual(new Set(a.cycles.map((x) => x.outlet)), new Set(["plug-bridge", "plug-panel"]), "both outlets are cut over 30 cycles");
  const saving = planPower({ topology: t, scenario: "cuts", outlets: ["plug-bridge"], seed: 1, cycles: 10, saves: true, cutDelayMin: 100, cutDelayMax: 400 });
  assert.ok(saving.cycles.every((x) => x.cut_delay_ms >= 100 && x.cut_delay_ms <= 400));
  assert.match(describePlan(saving).join("\n"), /writes bench_n/);
});

test("the plan refuses what could erase an installed device's configuration, and what it was not told to do", () => {
  const t = offline();
  assert.throws(() => planPower({ topology: t, scenario: "cuts", outlets: ["plug-ref"] }), (e) => e.code === "not-sacrificial" && /panel-ref/.test(e.message));
  assert.throws(() => planPower({ topology: t, scenario: "cuts", outlets: ["plug-bridge", "plug-ref"] }), (e) => e.code === "not-sacrificial");
  assert.doesNotThrow(() => planPower({ topology: t, scenario: "cuts", outlets: ["plug-router"] }), "a router has nothing to erase");
  assert.throws(() => planPower({ topology: t, scenario: "cuts", outlets: ["plug-router"], saves: true }), (e) => e.code === "not-sacrificial");
  assert.throws(() => planPower({ topology: t, scenario: "cuts" }), /--outlets is required/);
  assert.throws(() => planPower({ topology: t, scenario: "cuts", outlets: ["nope"] }), /no outlet "nope"/);
  assert.throws(() => planPower({ topology: t, scenario: "rain", outlets: ["plug-bridge"] }), /cuts or blackout/);
  assert.throws(() => planPower({ topology: t, scenario: "blackout", outlets: ["plug-bridge"], order: "sideways" }), /--order/);
  assert.throws(() => planPower({ topology: t, scenario: "cuts", outlets: ["plug-bridge"], watch: ["panel-s:ghost"] }), /panel:lamp/);
  const warned = planPower({ topology: t, scenario: "cuts", outlets: ["plug-panel"], watch: ["panel-ref:lamp-1"] });
  assert.match(warned.warnings.join(" "), /never watched/);
  // a blackout of an installed device is allowed, and said
  const black = planPower({ topology: t, scenario: "blackout", outlets: ["plug-router", "plug-ref"], order: "router-first" });
  assert.match(black.warnings.join(" "), /panel-ref/);
});

test("the six orders of a blackout", () => {
  const t = offline();
  const rng = () => makeRng("o");
  const all = t.outlets;
  const at = (order, outlets = all, delay = 1000) => Object.fromEntries(restoreOrder(order, outlets, rng(), delay).map((r) => [r.outlet, r.at_ms]));
  assert.deepEqual(at("together"), { "plug-router": 0, "plug-bridge": 0, "plug-panel": 0, "plug-ref": 0 });
  assert.deepEqual(at("router-first"), { "plug-router": 0, "plug-bridge": 1000, "plug-panel": 1000, "plug-ref": 1000 });
  assert.deepEqual(at("router-last"), { "plug-bridge": 0, "plug-panel": 0, "plug-ref": 0, "plug-router": 1000 });
  assert.deepEqual(at("bridges-first"), { "plug-bridge": 0, "plug-router": 1000, "plug-panel": 1000, "plug-ref": 1000 });
  assert.deepEqual(at("panels-first"), { "plug-panel": 0, "plug-ref": 0, "plug-router": 1000, "plug-bridge": 1000 });
  const stag = restoreOrder("staggered", all, rng(), 3000);
  assert.equal(stag.length, 4);
  assert.equal(stag[0].at_ms, 0);
  for (let k = 1; k < stag.length; k++) assert.ok(stag[k].at_ms > stag[k - 1].at_ms && stag[k].at_ms - stag[k - 1].at_ms <= 3000);
  assert.deepEqual(restoreOrder("staggered", all, rng(), 3000), stag, "seeded");
  assert.throws(() => restoreOrder("router-first", [all[1], all[2]], rng(), 1000), /needs outlets of the roles/);
  assert.throws(() => restoreOrder("bridges-first", [all[0]], rng(), 1000), /needs outlets/);
});

test("the watch of a lamp's flag: when it showed unavailable, whether it flickered, when it came back", () => {
  assert.deepEqual(watchSummary([[0, false], [1200, true], [9000, false]], 8000), { unavailable_ms: 1200, flaps: 0, returned_ms: 1000 });
  assert.deepEqual(watchSummary([[0, false], [1200, true], [2000, false], [2400, true], [3100, false], [3300, true], [9500, false]], 8000), { unavailable_ms: 1200, flaps: 2, returned_ms: 1500 });
  assert.deepEqual(watchSummary([[0, false]], 8000), { unavailable_ms: null, flaps: null, returned_ms: null });
  assert.deepEqual(watchSummary([[0, false], [1000, true]], 8000), { unavailable_ms: 1000, flaps: 0, returned_ms: null }, "never came back");
  assert.deepEqual(watchSummary([[0, false], [1000, true], [7000, false]], 8000), { unavailable_ms: 1000, flaps: 1, returned_ms: 0 }, "already back at the restore");
});

test("the dry run says what it would cut and sends nothing; a refusal is an error before anything happens", () => {
  const dir = mkdtempSync(join(tmpdir(), "bench-power-cli-"));
  const file = join(dir, "topology.json");
  writeFileSync(file, JSON.stringify(offline()));
  try {
    const out = join(dir, "never");
    const r = spawnSync(process.execPath, ["scripts/bench-power.mjs", "cuts", "--topology", file, "--outlets", "plug-bridge,plug-panel", "--cycles", "12", "--seed", "3", "--saves", "--out", out], { encoding: "utf8", cwd: repo });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /DRY RUN/);
    assert.match(r.stdout, /12 cycles/);
    assert.match(r.stdout, /Nothing was sent\. Run again with --yes\./);
    assert.equal(existsSync(out), false);
    const again = spawnSync(process.execPath, ["scripts/bench-power.mjs", "cuts", "--topology", file, "--outlets", "plug-bridge,plug-panel", "--cycles", "12", "--seed", "3", "--saves", "--out", out], { encoding: "utf8", cwd: repo });
    assert.equal(again.stdout, r.stdout);
    const refused = spawnSync(process.execPath, ["scripts/bench-power.mjs", "cuts", "--topology", file, "--outlets", "plug-ref"], { encoding: "utf8", cwd: repo });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /not-sacrificial/);
    const none = spawnSync(process.execPath, ["scripts/bench-power.mjs", "cuts", "--topology", file], { encoding: "utf8", cwd: repo });
    assert.equal(none.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** An outlet mock that powers `targets`, and the topology that names them. */
async function bench({ targets = [{ name: "bridge-s", role: "bridge", options: {} }], plugOptions = {}, extra = [] } = {}) {
  const plug = await startMock({ name: "plug", bootDelayMs: 100, ...plugOptions });
  const devices = [];
  const mocks = [];
  for (const t of targets) {
    const mock = await startMock({ name: t.name, ...t.options });
    mocks.push(mock);
    devices.push({ name: t.name, role: t.role, ip: mock.host, sacrificial: t.sacrificial !== false, ...(t.bridge ? { bridge: t.bridge } : {}) });
  }
  plug.powers(...mocks);
  const close = async () => {
    await plug.close();
    for (const m of mocks) await m.close();
  };
  let topology;
  try {
    topology = validateTopology({
      devices,
      lamps: devices.some((d) => d.name === "bridge-s") ? [{ name: "lamp-1", ieee: IEEE(1), coordinator: "bridge-s" }] : [],
      outlets: [{ name: "plug", ip: plug.host, role: targets[0].role, powers: devices.map((d) => d.name) }, ...extra.map((e) => e.outlet)],
    });
  } catch (e) {
    await close();
    throw e;
  }
  return { plug, mocks, topology, close };
}

async function run(plan, topology, { options = {}, signal, client } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bench-power-"));
  const writer = new JsonlWriter(join(dir, "power.jsonl"));
  try {
    const summary = await executePower({ plan, topology, client: client ?? makeClient({ timeoutMs: 1500, allowWrites: true }), writer, signal, options: { waitBootMs: 3000, quickTimeoutMs: 400, watchPollMs: 40, backPollMs: 40, restoreRetryMs: 20, ...options } });
    await writer.close();
    return { summary, records: rows(join(dir, "power.jsonl")) };
  } catch (e) {
    await writer.close();
    throw e;
  }
}

const quickPlan = (topology, over = {}) => ({ ...planPower({ topology, scenario: "cuts", outlets: ["plug"], seed: 1, cycles: 3, offMin: 150, offMax: 250, settleMin: 0, settleMax: 0, ...over }) });

test("cuts: the outlet is turned off and on, and the device behind it is waited for and found rebooted", async () => {
  const b = await bench();
  try {
    const { records, summary } = await run(quickPlan(b.topology), b.topology);
    const cycles = records.filter((r) => r.kind === "power-cycle");
    assert.equal(cycles.length, 3);
    assert.equal(summary.all_back, true);
    for (const c of cycles) {
      assert.equal(c.devices.length, 1);
      const d = c.devices[0];
      assert.equal(d.name, "bridge-s");
      assert.ok(d.back_ms >= 90 && d.back_ms < 3000, `back ${d.back_ms}`);
      assert.equal(d.boot_delta, 1, "one more boot");
      assert.ok(d.uptime_s <= 3);
      assert.equal(d.persist, null, "the persist is read only when asked");
    }
    const power = b.plug.requests.filter((r) => /^Power1 /.test(r.cmnd ?? "")).map((r) => r.cmnd);
    assert.deepEqual(power, ["Power1 OFF", "Power1 ON", "Power1 OFF", "Power1 ON", "Power1 OFF", "Power1 ON"]);
    assert.equal(b.plug.outlet.states["1"], "ON");
    assert.equal(b.mocks[0].bootCount, 4);
    assert.equal(records[0].kind, "power-run");
    assert.equal(records.at(-1).kind, "power-summary");
  } finally {
    await b.close();
  }
});

test("cuts with saves: the counter the device acknowledged is there after the boot, and the key is cleaned away", async () => {
  const b = await bench({ targets: [{ name: "panel-s", role: "panel", options: {} }] });
  try {
    const plan = quickPlan(b.topology, { saves: true, checkPersist: true, cutDelayMin: 120, cutDelayMax: 220 });
    const { records } = await run(plan, b.topology);
    const cycles = records.filter((r) => r.kind === "power-cycle");
    assert.equal(cycles.length, 3);
    for (const c of cycles) {
      const d = c.devices[0];
      assert.ok(c.saves[0].acked >= 1, "saves ran before the cut");
      assert.equal(c.saves[0].last_ack, c.saves[0].acked + (cycles.indexOf(c) === 0 ? 0 : cycles.slice(0, cycles.indexOf(c)).reduce((s, x) => s + x.saves[0].acked, 0)));
      assert.equal(d.persist.ok, true, JSON.stringify(d.persist));
      assert.equal(d.persist.file_ok, true);
      assert.deepEqual(d.persist.lost_keys, []);
      assert.ok(d.persist.counter_after >= d.persist.counter_floor);
    }
    const mock = b.mocks[0];
    assert.ok(mock.requests.some((r) => r.cmnd === SAVE_EXPRESSION));
    assert.ok(mock.requests.some((r) => r.cmnd === READ_COUNTER_EXPRESSION));
    assert.ok(mock.requests.some((r) => r.cmnd === CLEAN_EXPRESSION), "the counter is removed at the end");
    assert.equal("bench_n" in JSON.parse(mock.files["/_persist.json"]), false);
    // the other keys the device had are as they were
    assert.deepEqual(Object.keys(JSON.parse(mock.files["/_persist.json"])).sort(), ["panel_config", "zb_bridge_mode"]);
  } finally {
    await b.close();
  }
});

test("a cut that corrupts the persist is found: the file gone to {}, the keys lost, the counter below what was acknowledged", async () => {
  const b = await bench({ targets: [{ name: "panel-s", role: "panel", options: { persistCorruptOnCut: "always" } }] });
  try {
    const plan = quickPlan(b.topology, { saves: true, checkPersist: true, cutDelayMin: 120, cutDelayMax: 200, cycles: 2 });
    const { records } = await run(plan, b.topology);
    const cycles = records.filter((r) => r.kind === "power-cycle");
    const first = cycles[0].devices[0].persist;
    assert.equal(first.ok, false);
    assert.ok(first.lost_keys.includes("panel_config") && first.lost_keys.includes("zb_bridge_mode"));
    assert.ok(first.reasons.some((x) => /key\(s\) gone/.test(x)));
    assert.ok(first.reasons.some((x) => /below the/.test(x)) || first.counter_after === null || first.counter_after < first.counter_floor);
  } finally {
    await b.close();
  }
});

test("--check-persist alone reads the file's keys before and after, and never keeps its content", async () => {
  const b = await bench({ targets: [{ name: "panel-s", role: "panel", options: {} }] });
  try {
    const { records } = await run(quickPlan(b.topology, { checkPersist: true, cycles: 2 }), b.topology);
    for (const c of records.filter((r) => r.kind === "power-cycle")) {
      assert.equal(c.devices[0].persist.ok, true);
      assert.equal(c.devices[0].persist.key_count, 2);
    }
    assert.ok(!JSON.stringify(records).includes("zb_bridge_mode"), "key names are in the plan of the file check only as a count");
    assert.equal(b.mocks[0].requests.filter((r) => r.cmnd === SAVE_EXPRESSION).length, 0, "no saves without --saves");
  } finally {
    await b.close();
  }
});

test("a file that cannot be read is not a loss: the check says it cannot conclude", async () => {
  const b = await bench({ targets: [{ name: "panel-s", role: "panel", options: {} }] });
  try {
    // the file manager is off: the file cannot be read at all
    const mock = b.mocks[0];
    delete mock.files["/_persist.json"];
    mock.files["/_persist.json"] = "not json";
    const { records } = await run(quickPlan(b.topology, { checkPersist: true, cycles: 1 }), b.topology);
    assert.equal(records.find((r) => r.kind === "power-cycle").devices[0].persist.ok, null);
  } finally {
    await b.close();
  }
});

test("the watch: how long until the panel shows the lamp unavailable, and how long after the restore it is back", async () => {
  const bridge = await startMock({ name: "bridge-s", lamps: { [IEEE(1)]: 0 } });
  const panel = await startMock({ name: "panel-w", bridge, unavailableAfterMs: 120, clearAfterMs: 90 });
  const plug = await startMock({ name: "plug", bootDelayMs: 100 });
  plug.powers(bridge);
  const topology = validateTopology({
    devices: [
      { name: "bridge-s", role: "bridge", ip: bridge.host, sacrificial: true },
      { name: "panel-w", role: "panel", ip: panel.host, bridge: "bridge-s" },
    ],
    lamps: [{ name: "lamp-1", ieee: IEEE(1), coordinator: "bridge-s" }],
    outlets: [{ name: "plug", ip: plug.host, role: "bridge", powers: ["bridge-s"] }],
  });
  try {
    const plan = planPower({ topology, scenario: "cuts", outlets: ["plug"], seed: 1, cycles: 2, offMin: 600, offMax: 700, settleMin: 0, settleMax: 0, watch: ["panel-w:lamp-1"] });
    const { records } = await run(plan, topology, { options: { watchWindowMs: 500 } });
    const cycles = records.filter((r) => r.kind === "power-cycle");
    assert.equal(cycles.length, 2);
    for (const c of cycles) {
      assert.equal(c.watch.length, 1);
      const w = c.watch[0];
      assert.equal(w.panel, "panel-w");
      assert.equal(w.field, "doubt");
      assert.ok(w.unavailable_ms >= 100 && w.unavailable_ms < 600, `unavailable after ${w.unavailable_ms}`);
      assert.equal(w.flaps, 0);
      assert.ok(w.returned_ms !== null && w.returned_ms >= 0 && w.returned_ms < 800, `returned ${w.returned_ms}`);
      assert.ok(w.restore_at_ms >= 600);
    }
    // a lamp whose coordinator the outlet does not power is not watched
    assert.ok(panel.requests.some((r) => /global\.plan\.doubt/.test(r.cmnd ?? "")));
  } finally {
    await panel.close();
    await bridge.close();
    await plug.close();
  }
});

test("blackout: every outlet off together, restored in the order asked, every device waited for from its own restore", async () => {
  const router = await startMock({ name: "plug-router", bootDelayMs: 50 });
  const pb = await startMock({ name: "plug-bridge", bootDelayMs: 50 });
  const pp = await startMock({ name: "plug-panel", bootDelayMs: 50 });
  const bridge = await startMock({ name: "bridge-s", lamps: { [IEEE(1)]: 0 } });
  const panel = await startMock({ name: "panel-s", bridge });
  pb.powers(bridge);
  pp.powers(panel);
  const topology = validateTopology({
    devices: [
      { name: "bridge-s", role: "bridge", ip: bridge.host },
      { name: "panel-s", role: "panel", ip: panel.host, bridge: "bridge-s" },
    ],
    outlets: [
      { name: "plug-router", ip: router.host, role: "router" },
      { name: "plug-bridge", ip: pb.host, role: "bridge", powers: ["bridge-s"] },
      { name: "plug-panel", ip: pp.host, role: "panel", powers: ["panel-s"] },
    ],
  });
  try {
    const onTime = (mock) => mock.requests.filter((r) => r.cmnd === "Power1 ON").at(-1).at;
    const offTime = (mock) => mock.requests.filter((r) => r.cmnd === "Power1 OFF").at(-1).at;
    const go = (order) => run(planPower({ topology, scenario: "blackout", outlets: ["plug-router", "plug-bridge", "plug-panel"], order, delayMs: 400, offMs: 200, seed: 5 }), topology);
    // router first: the router comes back, and the others a delay later
    const a = await go("router-first");
    const rec = a.records.find((r) => r.kind === "power-blackout");
    assert.equal(rec.order, "router-first");
    assert.equal(rec.devices.length, 2);
    assert.ok(rec.devices.every((d) => d.back_ms !== null && d.boot_delta === 1));
    assert.ok(rec.all_back_ms >= 400, `the last device is waited for from the first restore: ${rec.all_back_ms}`);
    assert.ok(onTime(pb) - onTime(router) >= 380 && onTime(pp) - onTime(router) >= 380);
    assert.ok(Math.abs(offTime(router) - offTime(pb)) < 100, "everything is cut together");
    // together
    const g = await go("together");
    const rec2 = g.records.find((r) => r.kind === "power-blackout");
    assert.ok(Math.abs(onTime(pb) - onTime(pp)) < 100 && Math.abs(onTime(router) - onTime(pb)) < 100);
    assert.ok(rec2.all_back_ms < 400);
    // panels first
    await go("panels-first");
    assert.ok(onTime(pb) - onTime(pp) >= 380);
    assert.equal(bridge.alive && panel.alive, true);
  } finally {
    for (const m of [router, pb, pp, bridge, panel]) await m.close();
  }
});

test("a device that does not come back in time is a back_ms of null, and the run says every device was not back", async () => {
  const b = await bench({ plugOptions: { bootDelayMs: 60000 } });
  try {
    const { records, summary } = await run(quickPlan(b.topology, { cycles: 1 }), b.topology, { options: { waitBootMs: 500 } });
    assert.equal(records.find((r) => r.kind === "power-cycle").devices[0].back_ms, null);
    assert.equal(summary.all_back, false);
  } finally {
    await b.close();
  }
});

test("what was cut is restored whatever happens: an abort in the middle of an off time, and an error", async () => {
  const b = await bench({ plugOptions: { bootDelayMs: 50 } });
  try {
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 120);
    const { summary } = await run(quickPlan(b.topology, { cycles: 5, offMin: 2000, offMax: 2500 }), b.topology, { signal: stop.signal });
    assert.equal(summary.aborted, true);
    assert.equal(b.plug.outlet.states["1"], "ON", "the outlet was turned back on");
    await new Promise((done) => setTimeout(done, 200));
    assert.equal(b.mocks[0].alive, true);
    // an error between the cut and the restore: the outlet answers the OFF and the next command fails
    const flaky = await bench({ plugOptions: { bootDelayMs: 50 } });
    try {
      let n = 0;
      // the OFF is the first Power command; the ON is refused three times (every attempt of the restore), and then the finally gets through
      flaky.plug.rejectCommand = (text) => /^Power1 /.test(text) && ++n >= 2 && n <= 4;
      await assert.rejects(run(quickPlan(flaky.topology, { cycles: 1, offMin: 100, offMax: 100 }), flaky.topology));
      // the finally restored it by sending ON again
      assert.equal(flaky.plug.outlet.states["1"], "ON");
    } finally {
      await flaky.close();
    }
  } finally {
    await b.close();
  }
});

test("without --yes the client cannot cut, and an outlet that asks for a password stops the run", async () => {
  const b = await bench();
  try {
    await assert.rejects(run(quickPlan(b.topology), b.topology, { client: makeClient({ timeoutMs: 800 }) }), (e) => e.code === "write-blocked");
    assert.equal(b.plug.requests.filter((r) => /^Power1 /.test(r.cmnd ?? "")).length, 0);
    assert.equal(b.mocks[0].alive, true);
  } finally {
    await b.close();
  }
  const locked = await bench({ plugOptions: { password: true } });
  try {
    await assert.rejects(run(quickPlan(locked.topology), locked.topology), (e) => e.code === "auth");
    assert.ok(locked.plug.requests.every((r) => r.authorization === null));
    assert.equal(locked.mocks[0].alive, true);
  } finally {
    await locked.close();
  }
});

test("an error in a watch, after the cut, still ends with the outlet turned back on and the loops stopped", async () => {
  const bridge = await startMock({ name: "bridge-s", lamps: { [IEEE(1)]: 0 } });
  const panel = await startMock({ name: "panel-w", bridge, password: true });
  const plug = await startMock({ name: "plug", bootDelayMs: 60 });
  plug.powers(bridge);
  const topology = validateTopology({
    devices: [
      { name: "bridge-s", role: "bridge", ip: bridge.host, sacrificial: true },
      { name: "panel-w", role: "panel", ip: panel.host, bridge: "bridge-s" },
    ],
    lamps: [{ name: "lamp-1", ieee: IEEE(1), coordinator: "bridge-s" }],
    outlets: [{ name: "plug", ip: plug.host, role: "bridge", powers: ["bridge-s"] }],
  });
  try {
    const plan = planPower({ topology, scenario: "cuts", outlets: ["plug"], seed: 1, cycles: 1, offMin: 200, offMax: 200, settleMin: 0, settleMax: 0, watch: ["panel-w:lamp-1"] });
    await assert.rejects(run(plan, topology, { options: { watchWindowMs: 100 } }), (e) => e.code === "auth");
    assert.equal(plug.outlet.states["1"], "ON", "restored although the watch failed");
    const watched = panel.requests.length;
    await new Promise((done) => setTimeout(done, 300));
    assert.equal(panel.requests.length, watched, "the watch loop is not running on");
    assert.ok(panel.requests.every((r) => r.authorization === null));
  } finally {
    await panel.close();
    await bridge.close();
    await plug.close();
  }
});

test("a restore that does not arrive is tried again, and a router's outlet comes with a warning about how the restore can reach it", async () => {
  const b = await bench({ plugOptions: { bootDelayMs: 40 } });
  try {
    let n = 0;
    // the OFF goes through, the first ON is refused, the second goes through
    b.plug.rejectCommand = (text) => /^Power1 /.test(text) && ++n === 2;
    const { records, summary } = await run(quickPlan(b.topology, { cycles: 1, offMin: 100, offMax: 100 }), b.topology);
    assert.equal(summary.all_back, true);
    assert.equal(records.filter((r) => r.kind === "power-cycle").length, 1);
    assert.deepEqual(b.plug.requests.filter((r) => /^Power1 /.test(r.cmnd ?? "")).map((r) => r.cmnd), ["Power1 OFF", "Power1 ON", "Power1 ON"]);
  } finally {
    await b.close();
  }
  const t = offline();
  assert.match(planPower({ topology: t, scenario: "blackout", outlets: ["plug-router", "plug-bridge"], order: "router-first" }).warnings.join(" "), /plug-router cuts the router/);
  assert.match(planPower({ topology: t, scenario: "cuts", outlets: ["plug-router"] }).warnings.join(" "), /router stays off/);
  assert.equal(planPower({ topology: t, scenario: "cuts", outlets: ["plug-bridge"] }).warnings.length, 0);
});
