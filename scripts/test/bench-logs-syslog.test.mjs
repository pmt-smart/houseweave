// scripts/bench-logs.mjs, the syslog half: datagrams sent to 127.0.0.1 the way Tasmota sends them (RFC 5424, with the
// device's own time) land in logs.jsonl with the device and the control machine's clock.
//
//   node --test "scripts/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEvery, startLogs } from "../bench-logs.mjs";
import { sendSyslog, startMock } from "./mock-tasmota.mjs";

const lines = (dir) => readFileSync(join(dir, "logs.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

test("syslog: received on UDP, parsed, tied to its device, marked with the control machine's time", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bench-syslog-"));
  const devices = [
    { name: "panel-eu", role: "panel", ip: "127.0.0.1:1", hostname: "nspanel-eu" },
    { name: "bridge-1", role: "bridge", ip: "127.0.0.1:2", hostname: "zbbridge-1" },
  ];
  const run = await startLogs({ devices, probes: [], every: parseEvery(), out: dir, syslog: true, poll: false, syslogPort: 0, syslogBind: "127.0.0.1" });
  try {
    assert.ok(run.syslogPort > 0);
    const before = Date.now();
    await sendSyslog(run.syslogPort, { hostname: "nspanel-eu", text: "HTP: Web server active on nspanel-eu", level: 2 });
    await sendSyslog(run.syslogPort, { hostname: "zbbridge-1", text: "ZBBRIDGE_RELAY: forwarding ZbReceived", level: 3, ts: "2026-10-12T10:00:03.000000-03:00" });
    await sendSyslog(run.syslogPort, { hostname: "stranger", text: "who is this", level: 1 });
    await new Promise((done) => setTimeout(done, 150));
    const after = Date.now();
    const result = await run.stop();
    assert.equal(result.counts.syslog.total, 3);
    assert.equal(result.counts.syslog.unknown_source, 1);
    const rows = lines(dir).filter((l) => l.kind === "syslog");
    assert.equal(rows.length, 3);
    const panel = rows.find((r) => r.msg.startsWith("HTP:"));
    assert.equal(panel.device, "panel-eu");
    assert.equal(panel.host, "nspanel-eu");
    assert.equal(panel.severity, 6);
    assert.equal(panel.device_ts, "1970-01-01T00:00:02.096000+01:00", "the device's own time is kept as it came, next to ours");
    assert.ok(panel.ms >= before - 5 && panel.ms <= after + 5, "the control machine's clock");
    assert.ok(panel.src.startsWith("127.0.0.1:"));
    const bridge = rows.find((r) => r.msg.startsWith("ZBBRIDGE_RELAY"));
    assert.equal(bridge.device, "bridge-1");
    assert.equal(bridge.device_ts, "2026-10-12T10:00:03.000000-03:00");
    assert.equal(bridge.severity, 7);
    assert.equal(rows.find((r) => r.msg === "who is this").device, null);
  } finally {
    await run.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("syslog and polls together in one file, and a stop that is asked twice is harmless", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bench-both-"));
  const mock = await startMock({ name: "m" });
  const devices = [{ name: "m", role: "bridge", ip: mock.host, hostname: "mock-host" }];
  const run = await startLogs({ devices, probes: ["status11"], every: parseEvery(["status11=0.1"]), out: dir, syslog: true, poll: true, syslogPort: 0, syslogBind: "127.0.0.1", timeoutMs: 800 });
  try {
    await sendSyslog(run.syslogPort, { hostname: "mock-host", text: "SLG: hello" });
    await new Promise((done) => setTimeout(done, 400));
    const [a, b] = await Promise.all([run.stop(), run.stop()]);
    assert.equal(a, b);
    const rows = lines(dir);
    assert.ok(rows.some((r) => r.kind === "poll" && r.device === "m" && r.ok));
    assert.ok(rows.some((r) => r.kind === "syslog" && r.device === "m"));
  } finally {
    await mock.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
