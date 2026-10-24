// scripts/bench-logs.mjs: the syslog it receives, the polls it makes, and that it only reads. Against mocks on
// 127.0.0.1 and a syslog sender on 127.0.0.1; the dry run is on 203.0.113.x (documentation addresses) and sends
// nothing.
//
//   node --test "scripts/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { PROBES, extract, parseEvery, planLogs, runLogs } from "../bench-logs.mjs";
import { isReadOnlyCommand, validateTopology } from "../lib/bench.mjs";
import { startMock } from "./mock-tasmota.mjs";

const lines = (dir) => readFileSync(join(dir, "logs.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const tmp = () => mkdtempSync(join(tmpdir(), "bench-logs-"));

test("--every: a probe's interval, with the others at their default", () => {
  const e = parseEvery(["status11=0.5", "mesh=2"]);
  assert.equal(e.status11, 0.5);
  assert.equal(e.mesh, 2);
  assert.equal(e.status0, PROBES.status0.every);
  assert.throws(() => parseEvery(["nope=1"]), /no probe/);
  assert.throws(() => parseEvery(["mesh=0"]), /above 0/);
});

test("extract: the numbers taken out of each probe's answer", () => {
  assert.deepEqual(extract("status11", { StatusSTS: { UptimeSec: 7, Heap: 170, Wifi: { RSSI: 60 }, LoadAvg: 3, Sleep: 50 } }), { uptime_s: 7, heap_kb: 170, rssi: 60, load: 3, sleep: 50 });
  assert.equal(extract("status4", { StatusMEM: { Heap: 163, Free: 700 } }).heap_kb, 163);
  assert.equal(extract("status0", { StatusPRM: { BootCount: 4, OtaUrl: "x" }, StatusFWR: { Version: "15" } }).boot_count, 4);
  assert.equal(extract("memory", { heap_free: 176, frag: 34 }).heap_free_kb, 176);
  assert.equal(extract("mesh", { EspNowMeshStatus: { Epoch: 9, Delivered: 3 } }).epoch, 9);
  assert.deepEqual(extract("status12", { StatusSTK: { Reason: "Software/System restart", Epc1: "0x4008", CallChain: [1, 2] } }), { reason: "Software/System restart", fields: 3 });
  assert.deepEqual(extract("status12", { Status: { Topic: "x" } }), { reason: undefined, fields: 0 }, "a device with nothing to say of a dump");
  assert.deepEqual(extract("clock", { EspNowMeshClock: { Synced: 1, Timeline: "AB12", Taken: 1, Steps: 4, EventsLost: 0, Count: 3, List: [{ Id: 2, Seen: 2 }, { Id: 3, Seen: 1 }, { Id: 4, Seen: 1 }] } }),
    { synced: 1, timeline: "AB12", taken: 1, steps: 4, events_lost: 0, neighbors: 3, other_timeline: 2 });
  assert.deepEqual(extract("house", { HouseStatus: { Me: 4, Up: 1, Name: "Cottage", Key: 2, Pending: 1, Nodes: [{ Id: 1 }, { Id: 4 }] } }), { me: 4, up: 1, name: "Cottage", key: 2, pending: 1, nodes: 2 });
});

test("the probes of the soak: the dump of a restart, the mesh's clock and the house are polled, and each by a read the client allows", () => {
  assert.equal(PROBES.status12.command, "Status 12");
  assert.equal(PROBES.clock.command, "EspNowMeshClock");
  assert.equal(PROBES.house.command, "HouseStatus");
  for (const p of ["status12", "clock", "house"]) assert.equal(isReadOnlyCommand(PROBES[p].command), true, `${p} is a read`);
  // the pages of the lists, too, and nothing that writes or says the Zigbee network's key
  assert.equal(isReadOnlyCommand("EspNowMeshClock 5"), true);
  assert.equal(isReadOnlyCommand("EspNowMeshHealth 10"), true);
  assert.equal(isReadOnlyCommand("ZbConfig"), false, "ZbConfig says the key of the Zigbee network");
  assert.equal(isReadOnlyCommand("HouseFound Cottage"), false);
  assert.equal(isReadOnlyCommand("HouseWelcome 2"), false, "the welcome carries the key of the network");
  assert.equal(isReadOnlyCommand("EspNowMeshClock 5; Restart 1"), false);
});

test("the dry run says what it would bind and ask, and sends nothing", () => {
  const t = validateTopology({ devices: [{ name: "b", role: "bridge", ip: "203.0.113.11" }, { name: "p", role: "panel", ip: "203.0.113.12", bridge: "b" }] });
  const plan = planLogs({ devices: t.devices, probes: Object.keys(PROBES), every: parseEvery(), syslog: true, poll: true, syslogPort: 5514, syslogBind: "0.0.0.0", dir: "bench/x" });
  assert.match(plan.join("\n"), /203\.0\.113\.11/);
  assert.match(plan.join("\n"), /LogHost/);
  // the command line, with no network at all: a dry run is a process that writes lines and exits, and creates no directory
  const out = join(tmp(), "never");
  const r = spawnSync(process.execPath, ["scripts/bench-logs.mjs", "--dry-run", "--out", out, "b=203.0.113.11", "p=203.0.113.12", "--every", "status11=5"], { encoding: "utf8", cwd: join(import.meta.dirname, "..", "..") });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /dry run/);
  assert.match(r.stdout, /b 203\.0\.113\.11/);
  assert.equal(existsSync(out), false, "a dry run creates nothing");
  const bad = spawnSync(process.execPath, ["scripts/bench-logs.mjs", "--dry-run", "x=203.0.113.0/24"], { encoding: "utf8", cwd: join(import.meta.dirname, "..", "..") });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /not a single host/);
});

test("it asks every probe of every device, only to read, and writes the device and the time on each line", async () => {
  const a = await startMock({ name: "bridge", heapKb: 170, lamps: { "0x00124B0000AA0001": 0 } });
  const b = await startMock({ name: "panel", heapKb: 163 });
  const dir = tmp();
  try {
    const devices = [
      { name: "bridge", role: "bridge", ip: a.host, sacrificial: false },
      { name: "panel", role: "panel", ip: b.host, sacrificial: false },
    ];
    const every = parseEvery(["status0=0.3", "status4=0.2", "status11=0.1", "mesh=0.2", "memory=0.25", "status12=0.3", "clock=0.3", "house=0.3"]);
    const before = Date.now();
    const result = await runLogs({ devices, probes: Object.keys(PROBES), every, out: dir, syslog: false, durationMs: 700, timeoutMs: 800 });
    const after = Date.now();
    const all = lines(dir);
    assert.equal(all.length, result.lines);
    for (const device of ["bridge", "panel"]) {
      for (const probe of Object.keys(PROBES)) {
        const mine = all.filter((l) => l.device === device && l.probe === probe);
        assert.ok(mine.length >= 1, `${device} ${probe}`);
        assert.ok(mine.every((l) => l.ok === true && l.kind === "poll" && l.v === 1 && l.ms >= before - 5 && l.ms <= after + 5 && typeof l.t === "string" && typeof l.mono === "number" && l.rtt_ms >= 0));
      }
    }
    const heap = all.find((l) => l.device === "bridge" && l.probe === "memory");
    assert.equal(heap.x.heap_free_kb, 170);
    assert.equal(heap.x.br_reads, 1, "each memory line counts the Br reads made to that device");
    assert.equal(all.filter((l) => l.device === "bridge" && l.probe === "memory").at(-1).x.br_reads, all.filter((l) => l.device === "bridge" && l.probe === "memory").length);
    assert.equal(all.find((l) => l.device === "panel" && l.probe === "status11").x.heap_kb, 163);
    assert.ok(all.find((l) => l.probe === "status0").x.version);
    // read-only: only GET /cm, and only the questions of the read-only list
    for (const mock of [a, b]) {
      assert.ok(mock.requests.length > 0);
      for (const r of mock.requests) {
        assert.equal(r.method, "GET");
        assert.equal(r.path, "/cm");
        assert.match(r.cmnd, /^(Status( \d+)?|EspNowMeshStatus|EspNowMeshClock|HouseStatus|Br tasmota\.memory\(\))$/);
        assert.equal(r.authorization, null);
      }
    }
    assert.equal(a.zbSends, 0);
    const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
    assert.equal(meta.scripts["bench-logs"].counts.poll.failed, 0);
  } finally {
    await a.close();
    await b.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a device that is down is a line with ok=false and the others go on; a password is never answered", async () => {
  const up = await startMock({ name: "up" });
  const down = await startMock({ name: "down" });
  const locked = await startMock({ name: "locked", password: true });
  down.alive = false;
  const dir = tmp();
  try {
    const devices = [
      { name: "up", role: "bridge", ip: up.host },
      { name: "down", role: "panel", ip: down.host },
      { name: "locked", role: "panel", ip: locked.host },
    ];
    await runLogs({ devices, probes: ["status11"], every: parseEvery(["status11=0.1"]), out: dir, syslog: false, durationMs: 600, timeoutMs: 500 });
    const all = lines(dir);
    assert.ok(all.filter((l) => l.device === "up" && l.ok).length >= 2);
    assert.ok(all.filter((l) => l.device === "down").every((l) => l.ok === false && l.code === "no-reply"));
    assert.ok(all.filter((l) => l.device === "locked").every((l) => l.ok === false && l.code === "auth"));
    assert.ok(locked.requests.every((r) => r.authorization === null));
  } finally {
    await up.close();
    await down.close();
    await locked.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

