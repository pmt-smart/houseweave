// scripts/bench-load.mjs: the plan (seeded, repeatable), the dry run (nothing sent), and the execution against mocks on
// 127.0.0.1: a bridge with lamps, panels that forward to it, a pair of mesh nodes. The dry run is on 203.0.113.x.
//
//   node --test "scripts/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { executeLoad, meshSendCommand, panelSendExpression, planLoad, powerOf, tapExpression, zbSendCommand } from "../bench-load.mjs";
import { JsonlWriter, makeClient, panelViewExpression, parsePanelView, validateTopology } from "../lib/bench.mjs";
import { startMock } from "./mock-tasmota.mjs";

const IEEE = (n) => `0x00124B0000AA${String(n).padStart(4, "0")}`;
const repo = join(import.meta.dirname, "..", "..");

function offlineTopology(lampCount = 12) {
  return validateTopology({
    devices: [
      { name: "bridge-1", role: "bridge", ip: "203.0.113.11" },
      { name: "panel-a", role: "panel", ip: "203.0.113.12", bridge: "bridge-1", taps: { "lamp-1": 130100, "lamp-2": 130200 }, mesh: { id: 1 } },
      { name: "panel-b", role: "panel", ip: "203.0.113.13", bridge: "bridge-1", mesh: { id: 2 } },
    ],
    lamps: Array.from({ length: lampCount }, (_, i) => ({ name: `lamp-${i + 1}`, ieee: IEEE(i + 1), coordinator: "bridge-1" })),
  });
}

const rows = (file) => readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

/** A bridge with `count` lamps (all off), and panels that forward to it. */
async function bench({ lamps = 6, bridgeOptions = {}, panels = 2, panelOptions = {} } = {}) {
  const lampMap = Object.fromEntries(Array.from({ length: lamps }, (_, i) => [IEEE(i + 1), 0]));
  const bridge = await startMock({ name: "bridge-1", lamps: lampMap, ...bridgeOptions });
  const ps = [];
  for (let i = 0; i < panels; i++) {
    ps.push(await startMock({ name: `panel-${i}`, bridge, mode: i === 0 ? "tcp" : "direct", pendingMs: 300, taps: { 130100: IEEE(1), 130200: IEEE(2) }, ...panelOptions }));
  }
  const topology = validateTopology({
    devices: [
      { name: "bridge-1", role: "bridge", ip: bridge.host },
      ...ps.map((p, i) => ({ name: `panel-${i}`, role: "panel", ip: p.host, bridge: "bridge-1", taps: { "lamp-1": 130100, "lamp-2": 130200 }, mesh: { id: i + 1 } })),
    ],
    lamps: Array.from({ length: lamps }, (_, i) => ({ name: `lamp-${i + 1}`, ieee: IEEE(i + 1), coordinator: "bridge-1" })),
  });
  const close = async () => {
    for (const p of ps) await p.close();
    await bridge.close();
  };
  return { bridge, panels: ps, topology, close };
}

async function run(plan, topology, { yes = true, options = {}, signal } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bench-load-"));
  const writer = new JsonlWriter(join(dir, "load.jsonl"));
  try {
    const summary = await executeLoad({ plan, topology, client: makeClient({ timeoutMs: 1500, allowWrites: yes }), writer, signal, options: { confirmTimeoutMs: 800, pollMs: 10, ...options } });
    await writer.close();
    return { summary, records: rows(join(dir, "load.jsonl")), dir };
  } catch (e) {
    await writer.close();
    e.dir = dir;
    throw e;
  }
}

test("the commands: what the console is told, and what does not travel", () => {
  assert.equal(zbSendCommand(IEEE(1), 1), `ZbSend {"Device":"0x00124B0000AA0001","Send":{"Power":1}}`);
  assert.equal(panelSendExpression([zbSendCommand(IEEE(1), 0)]), `Br global.zb_bridge.send('ZbSend {"Device":"0x00124B0000AA0001","Send":{"Power":0}}')`);
  const burst = panelSendExpression([1, 2, 3].map((n) => zbSendCommand(IEEE(n), 1)));
  assert.match(burst, /^Br var b=global\.zb_bridge b\.send\('ZbSend[^']+'\) b\.send\(/);
  assert.equal((burst.match(/b\.send\(/g) ?? []).length, 3);
  assert.equal(tapExpression(130100), "Br global.plan.on_tap(130100)");
  assert.equal(meshSendCommand(2, 0, "b1"), "EspNowMeshSend 2,0,1,b1");
  assert.throws(() => panelSendExpression(["ZbSend {'x':1}"]), /does not travel/);
  assert.throws(() => panelSendExpression(["a;b"]), /does not travel/);
  assert.ok(panelSendExpression(Array.from({ length: 12 }, (_, n) => zbSendCommand(IEEE(n + 1), 1))).length < 1100, "12 lines fit in one console line");
  assert.equal(powerOf({ ZbStatus3: [{ Power: 1 }] }), 1);
  assert.equal(powerOf({ ZbStatus3: [{ Power: "OFF" }] }), 0);
  assert.equal(powerOf({ ZbStatus3: [] }), null);
  assert.equal(powerOf({ ZbStatus3: [{ Name: "x" }] }), null);
});

test("the plan is the seed's: the same seed repeats it, another seed does not, panels alternate", () => {
  const t = offlineTopology();
  const a = planLoad({ topology: t, paths: ["panel"], n: 40, seed: 42 });
  const b = planLoad({ topology: t, paths: ["panel"], n: 40, seed: 42 });
  const c = planLoad({ topology: t, paths: ["panel"], n: 40, seed: 43 });
  assert.deepEqual(a.steps, b.steps);
  assert.notDeepEqual(a.steps.map((s) => s.target), c.steps.map((s) => s.target));
  assert.equal(a.steps.length, 40);
  assert.equal(a.writes, 40);
  for (let k = 1; k < a.steps.length; k++) assert.notEqual(a.steps[k].via, a.steps[k - 1].via, "touches alternate between panels");
  assert.ok(a.steps.every((s) => s.wait_ms >= 250 && s.wait_ms <= 750));
  assert.ok(new Set(a.steps.map((s) => s.target)).size >= 10, "the lamps are cycled through, not drawn with repeats");
  assert.equal(planLoad({ topology: t, paths: ["panel"], n: 3, seed: 1, gapMs: 0 }).steps.every((s) => s.wait_ms === 0), true);
  // each path has its own stream: asking for another path too does not move this one
  const both = planLoad({ topology: t, paths: ["panel", "tap"], n: 40, seed: 42 });
  assert.deepEqual(both.steps.filter((s) => s.path === "panel").map((s) => [s.via, s.target]), a.steps.map((s) => [s.via, s.target]));
});

test("the plan, per path and scenario, and what it says when the topology cannot give it", () => {
  const t = offlineTopology(12);
  const tap = planLoad({ topology: t, paths: ["tap"], n: 6, seed: 1 });
  assert.ok(tap.steps.every((s) => s.via === "panel-a" && [130100, 130200].includes(s.tap)));
  const mesh = planLoad({ topology: t, paths: ["mesh"], n: 6, seed: 1 });
  assert.ok(mesh.steps.every((s) => s.via !== s.to && [1, 2].includes(s.to_id)));
  const bridge = planLoad({ topology: t, paths: ["bridge"], n: 5, seed: 1 });
  assert.ok(bridge.steps.every((s) => s.via === "bridge-1"));
  const burst = planLoad({ topology: t, scenario: "burst", paths: ["panel", "bridge"], n: 2, seed: 1, burstSizes: [5, 8, 12] });
  assert.deepEqual(burst.steps.map((s) => s.size), [5, 5, 8, 8, 12, 12]);
  assert.equal(burst.writes, 2 * (5 + 8 + 12));
  assert.ok(burst.steps.every((s) => new Set(s.targets.map((x) => x.target)).size === s.size), "a burst is on distinct lamps");
  assert.match(burst.warnings.join(" "), /path bridge/);
  const few = planLoad({ topology: offlineTopology(6), scenario: "burst", n: 1, seed: 1, burstSizes: [5, 12] });
  assert.deepEqual(few.steps.map((s) => s.size), [5]);
  assert.match(few.warnings.join(" "), /12 lamps/);
  assert.throws(() => planLoad({ topology: t, scenario: "alternate" }), /--panel-view/);
  const alt = planLoad({ topology: t, scenario: "alternate", n: 5, seed: 3, panelView: true, offsetMax: 500 });
  assert.ok(alt.steps.every((s) => s.pair[0].via !== s.pair[1].via && s.pair[0].intent !== s.pair[1].intent && s.offset_ms >= 0 && s.offset_ms <= 500));
  assert.equal(planLoad({ topology: validateTopology({ devices: [{ name: "b", role: "bridge", ip: "203.0.113.1" }] }), paths: ["panel", "mesh"], n: 3 }).steps.length, 0);
  assert.throws(() => planLoad({ topology: t, paths: ["serial"] }), /--paths/);
  assert.throws(() => planLoad({ topology: t, scenario: "storm" }), /--scenario/);
});

test("the dry run says what it would send, sends nothing, and writes nothing; --yes is what sends", () => {
  const dir = mkdtempSync(join(tmpdir(), "bench-load-cli-"));
  const file = join(dir, "topology.json");
  writeFileSync(file, JSON.stringify(offlineTopology(8)));
  try {
    const out = join(dir, "never");
    const r = spawnSync(process.execPath, ["scripts/bench-load.mjs", "--topology", file, "--paths", "panel,tap", "--n", "20", "--seed", "9", "--out", out], { encoding: "utf8", cwd: repo });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /DRY RUN/);
    assert.match(r.stdout, /40 steps, 40 commands/);
    assert.match(r.stdout, /Nothing was sent\. Run again with --yes\./);
    assert.match(r.stdout, /#0 /);
    assert.equal(existsSync(out), false);
    const again = spawnSync(process.execPath, ["scripts/bench-load.mjs", "--topology", file, "--paths", "panel,tap", "--n", "20", "--seed", "9", "--out", out], { encoding: "utf8", cwd: repo });
    assert.equal(again.stdout, r.stdout, "the same seed prints the same plan");
    assert.equal(spawnSync(process.execPath, ["scripts/bench-load.mjs"], { encoding: "utf8", cwd: repo }).status, 2);
    assert.equal(spawnSync(process.execPath, ["scripts/bench-load.mjs", "--help"], { encoding: "utf8", cwd: repo }).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("without --yes a client cannot write: the run stops at the first write, and nothing reached the lamps", async () => {
  const b = await bench({ lamps: 2 });
  try {
    const plan = planLoad({ topology: b.topology, paths: ["bridge"], n: 2, seed: 1, gapMs: 0 });
    await assert.rejects(run(plan, b.topology, { yes: false }), (e) => e.code === "write-blocked");
    assert.equal(b.bridge.zbSends, 0);
    assert.equal(b.bridge.requests.filter((r) => /zbsend/i.test(r.cmnd ?? "")).length, 0);
  } finally {
    await b.close();
  }
});

test("single, on the bridge path: every command toggles a lamp, is read back, and is timed", async () => {
  const b = await bench({ lamps: 3, bridgeOptions: { latencyMs: 40 } });
  try {
    const plan = planLoad({ topology: b.topology, paths: ["bridge"], n: 12, seed: 5, gapMs: 0 });
    const { records, summary } = await run(plan, b.topology);
    const loads = records.filter((r) => r.kind === "load");
    assert.equal(loads.length, 12);
    for (const r of loads) {
      assert.equal(r.outcome, "confirmed");
      assert.equal(r.path, "bridge");
      assert.equal(r.transport, "http-bridge");
      assert.ok(r.truth_ms >= 40 && r.truth_ms < 800, `latency ${r.truth_ms}`);
      assert.ok(r.cmd.startsWith("ZbSend "));
      assert.notEqual(r.pre, r.expected);
      assert.equal(r.sent.ok, true);
      assert.equal(r.flagged, null, "without --panel-view the panel's \"?\" is not observed");
      assert.equal(r.silent, null);
    }
    assert.equal(summary["http-bridge"].confirmed, 12);
    assert.equal(summary["http-bridge"].truth_ms.n, 12);
    const header = records.find((r) => r.kind === "load-run");
    assert.equal(header.seed, "5", "the seed is kept as the command line gives it: text");
    assert.equal(header.steps, 12);
    assert.equal(records.at(-1).kind, "load-summary");
    // each lamp went on and off by turns: 12 toggles over 3 lamps is 4 each, an even number: all off again
    for (const lamp of Object.values(b.bridge.lamps)) assert.equal(lamp.power, 0);
  } finally {
    await b.close();
  }
});

test("the panel path: the brain's transport, labelled with the mode the panel is in, the panel's view read back", async () => {
  const b = await bench({ lamps: 4 });
  try {
    const plan = planLoad({ topology: b.topology, paths: ["panel"], n: 10, seed: 7, gapMs: 0 });
    const { records } = await run(plan, b.topology, { options: { panelView: true } });
    const loads = records.filter((r) => r.kind === "load");
    assert.equal(loads.length, 10);
    assert.deepEqual(new Set(loads.map((r) => r.transport)), new Set(["tcp", "direct"]), "panel-0 is in tcp, panel-1 in direct, and each line says which");
    assert.ok(loads.every((r) => r.outcome === "confirmed" && r.panel_ms !== null && r.panel_ms >= r.truth_ms - 5 && r.flagged === false && r.silent === false));
    assert.ok(loads.every((r) => r.cmd.startsWith("ZbSend")));
    // the panel was driven only through the brain's own call
    for (const p of b.panels) {
      const writes = p.requests.filter((r) => r.path === "/cm" && /^Br /.test(r.cmnd) && !/global\.plan\.(live|on_tap)|\{"live"/.test(r.cmnd) );
      assert.ok(writes.every((r) => r.cmnd.startsWith("Br global.zb_bridge.send('ZbSend ")));
    }
    assert.equal(b.bridge.zbSends, 10, "each command reached the coordinator once");
  } finally {
    await b.close();
  }
});

test("a lost command is read as unconfirmed; the panel's \"?\" makes it flagged, and without it it is silent", async () => {
  // every second ZbSend is lost at the coordinator
  const flagged = await bench({ lamps: 2, bridgeOptions: { dropEvery: 2 }, panels: 1 });
  const silent = await bench({ lamps: 2, bridgeOptions: { dropEvery: 2 }, panels: 1, panelOptions: { pendingMs: 60000 } });
  try {
    const plan = (b) => planLoad({ topology: b.topology, paths: ["panel"], n: 6, seed: 2, gapMs: 0 });
    const a = await run(plan(flagged), flagged.topology, { options: { panelView: true, confirmTimeoutMs: 700 } });
    const lost = a.records.filter((r) => r.kind === "load" && r.outcome === "unconfirmed");
    assert.equal(lost.length, 3);
    assert.ok(lost.every((r) => r.flagged === true && r.silent === false), "the panel said \"?\": not a silent loss");
    assert.equal(a.records.filter((r) => r.outcome === "confirmed").length, 3);
    const s = await run(plan(silent), silent.topology, { options: { panelView: true, confirmTimeoutMs: 400 } });
    const loss = s.records.filter((r) => r.kind === "load" && r.outcome === "unconfirmed");
    assert.equal(loss.length, 3);
    assert.ok(loss.every((r) => r.flagged === false && r.silent === true), "no \"?\": the silent loss a command must never have");
    assert.equal(s.summary.tcp.silent, 3);
    // and the same loss without the panel's view is unconfirmed, flagged unknown
    const blind = await run(plan(flagged), flagged.topology, { options: { panelView: false, confirmTimeoutMs: 200 } });
    assert.ok(blind.records.filter((r) => r.outcome === "unconfirmed").every((r) => r.flagged === null && r.silent === null));
  } finally {
    await flagged.close();
    await silent.close();
  }
});

test("the tap path: the plan's own handler, toggling the lamp of the card", async () => {
  const b = await bench({ lamps: 2, panels: 1 });
  try {
    const plan = planLoad({ topology: b.topology, paths: ["tap"], n: 4, seed: 3, gapMs: 0 });
    const { records } = await run(plan, b.topology, { options: { panelView: true } });
    const loads = records.filter((r) => r.kind === "load");
    assert.equal(loads.length, 4);
    assert.ok(loads.every((r) => r.outcome === "confirmed" && /^Br global\.plan\.on_tap\(1[0-9]+\)$/.test(r.cmd) && r.transport === "tcp"));
    assert.ok(b.panels[0].requests.some((r) => /on_tap\(130[12]00\)/.test(r.cmnd ?? "")));
  } finally {
    await b.close();
  }
});

test("a burst is one Br with K lines in the same tick, and every lamp is timed on its own", async () => {
  const b = await bench({ lamps: 6, panels: 1 });
  try {
    const plan = planLoad({ topology: b.topology, scenario: "burst", paths: ["panel"], n: 2, seed: 4, burstSizes: [5], gapMs: 0 });
    const { records } = await run(plan, b.topology, { options: { panelView: true } });
    const loads = records.filter((r) => r.kind === "load");
    assert.equal(loads.length, 10);
    assert.ok(loads.every((r) => r.burst.size === 5 && r.outcome === "confirmed"));
    assert.deepEqual([...new Set(loads.map((r) => r.burst.id))].length, 2);
    const bursts = records.filter((r) => r.kind === "load-burst");
    assert.equal(bursts.length, 2);
    assert.ok(bursts.every((x) => x.size === 5 && x.confirmed === 5 && x.all_ms > 0 && x.all_ms === x.max_ms));
    const calls = b.panels[0].requests.filter((r) => /^Br var b=global\.zb_bridge/.test(r.cmnd ?? ""));
    assert.equal(calls.length, 2, "one Br per burst");
    assert.ok(calls.every((r) => (r.cmnd.match(/b\.send\(/g) ?? []).length === 5));
    assert.equal(b.bridge.zbSends, 10);
  } finally {
    await b.close();
  }
});

test("alternate: two panels send opposite commands to one lamp, and the views are checked against the lamp", async () => {
  const b = await bench({ lamps: 2, panels: 2 });
  try {
    const plan = planLoad({ topology: b.topology, scenario: "alternate", n: 4, seed: 6, panelView: true, offsetMax: 120 });
    const { records } = await run(plan, b.topology, { options: { panelView: true, confirmTimeoutMs: 1200 } });
    const alt = records.filter((r) => r.kind === "load-alternate");
    assert.equal(alt.length, 4);
    for (const r of alt) {
      assert.equal(r.outcome, "converged", JSON.stringify(r));
      assert.ok(r.converge_ms !== null && r.converge_ms < 1200);
      assert.ok(["on", "off"].includes(r.final));
      assert.ok(Object.values(r.views).every((v) => v === r.final));
      assert.ok(Object.values(r.doubts).every((d) => d === false));
      assert.equal(r.pair.length, 2);
      assert.ok(r.offset_ms >= 0 && r.offset_ms <= 120);
    }
    assert.equal(b.bridge.zbSends, 8, "two commands a pair");
  } finally {
    await b.close();
  }
});

test("the mesh path: frames sent with an ack, counted at the other end", async () => {
  const a = await startMock({ name: "node-1", meshId: 1 });
  const c = await startMock({ name: "node-2", meshId: 2 });
  a.mesh.peer = c;
  c.mesh.peer = a;
  const topology = validateTopology({
    devices: [
      { name: "node-1", role: "bridge", ip: a.host, mesh: { id: 1 } },
      { name: "node-2", role: "panel", ip: c.host, mesh: { id: 2 } },
    ],
  });
  try {
    const plan = planLoad({ topology, paths: ["mesh"], n: 6, seed: 1, gapMs: 0 });
    const { records, summary } = await run(plan, topology);
    const loads = records.filter((r) => r.kind === "load");
    assert.equal(loads.length, 6);
    assert.ok(loads.every((r) => r.outcome === "confirmed" && r.transport === "mesh" && r.acked === true && r.flagged === false && r.truth_ms >= 20));
    assert.ok(loads.every((r) => /^EspNowMeshSend [12],0,1,b\d+$/.test(r.cmd)));
    assert.equal(summary.mesh.confirmed, 6);
    assert.equal(a.mesh.sent + c.mesh.sent, 6);
    // a lossy link: every second frame is lost, and the sender gives up on it, which is a flag, not a silence
    a.mesh.lossEvery = 2;
    c.mesh.lossEvery = 2;
    const lossy = await run(planLoad({ topology, paths: ["mesh"], n: 6, seed: 1, gapMs: 0 }), topology, { options: { confirmTimeoutMs: 400 } });
    const lost = lossy.records.filter((r) => r.kind === "load" && r.outcome === "unconfirmed");
    assert.ok(lost.length >= 2);
    assert.ok(lost.every((r) => r.flagged === true && r.silent === false));
  } finally {
    await a.close();
    await c.close();
  }
});

test("a send that fails is not a loss: it is a send-failed line, and a password stops the run", async () => {
  const b = await bench({ lamps: 2, panels: 1, panelOptions: {} });
  try {
    b.panels[0].onCommand = (text) => {
      if (/send\(/.test(text)) b.panels[0].errorsOnBr = true;
    };
    const plan = planLoad({ topology: b.topology, paths: ["panel"], n: 3, seed: 1, gapMs: 0 });
    const { records } = await run(plan, b.topology);
    assert.ok(records.filter((r) => r.kind === "load").every((r) => r.outcome === "send-failed" && r.sent.ok === false && /attribute_error/.test(r.sent.error)));
  } finally {
    await b.close();
  }
  const locked = await startMock({ name: "locked", password: true });
  const topology = validateTopology({
    devices: [{ name: "bridge-1", role: "bridge", ip: locked.host }],
    lamps: [{ name: "lamp-1", ieee: IEEE(1), coordinator: "bridge-1" }],
  });
  try {
    await assert.rejects(run(planLoad({ topology, paths: ["bridge"], n: 2, gapMs: 0 }), topology), (e) => e.code === "auth");
    assert.ok(locked.requests.every((r) => r.authorization === null));
  } finally {
    await locked.close();
  }
});

test("a panel with its bridge off is refused before anything is sent", async () => {
  const b = await bench({ lamps: 2, panels: 1, panelOptions: { mode: "off" } });
  try {
    const plan = planLoad({ topology: b.topology, paths: ["panel"], n: 2, seed: 1, gapMs: 0 });
    await assert.rejects(run(plan, b.topology), (e) => e.code === "panel-off");
    assert.equal(b.bridge.zbSends, 0);
  } finally {
    await b.close();
  }
});

test("an abort ends the run at a step, with the summary written", async () => {
  const b = await bench({ lamps: 2, panels: 1 });
  try {
    const stop = new AbortController();
    const plan = planLoad({ topology: b.topology, paths: ["bridge"], n: 50, seed: 1, gapMs: 100 });
    setTimeout(() => stop.abort(), 350);
    const { records } = await run(plan, b.topology, { signal: stop.signal });
    const loads = records.filter((r) => r.kind === "load");
    assert.ok(loads.length >= 1 && loads.length < 50);
    const summary = records.at(-1);
    assert.equal(summary.kind, "load-summary");
    assert.equal(summary.aborted, true);
  } finally {
    await b.close();
  }
});

test("the panel's view is asked for the lamps in question, in one short console line, and read back as live and doubt", () => {
  const a = IEEE(1);
  const b = IEEE(2);
  assert.equal(panelViewExpression([a, b]), `Br (def () var l=global.plan.live var d=global.plan.doubt return [l.find("${a}"), d.find("${a}"), l.find("${b}"), d.find("${b}")] end)()`);
  assert.match(panelViewExpression([a], "unavailable"), /var d=global\.plan\.unavailable /);
  assert.deepEqual(parsePanelView([a, b], ["on", true, null, null]), { live: { [a]: "on" }, doubt: { [a]: true } });
  assert.deepEqual(parsePanelView([a], [null, null]), { live: {}, doubt: {} });
  assert.throws(() => parsePanelView([a, b], ["on", true]), /not a list of 4/);
  assert.throws(() => parsePanelView([a], "nil"), /not a list/);
  assert.throws(() => panelViewExpression(["0x12"]), /not an IEEE/);
  assert.throws(() => panelViewExpression([a], "doubt; Restart"), /name of a map/);
  const twelve = Array.from({ length: 12 }, (_, i) => IEEE(i + 1));
  assert.ok(panelViewExpression(twelve).length < 1100, "the view of a zone of 12 fits in one console line");
  assert.throws(() => panelViewExpression(Array.from({ length: 30 }, (_, i) => IEEE(i + 1))), /more than one console line/);
});
