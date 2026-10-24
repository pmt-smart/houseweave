// The command lines of the bench scripts, run as a person runs them, against mocks on 127.0.0.1: the dry run must leave the
// mock without a single request, and --yes must do the work and write the run directory.
//
//   node --test "scripts/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMock } from "./mock-tasmota.mjs";

const repo = join(import.meta.dirname, "..", "..");
const IEEE = (n) => `0x00124B0000AA${String(n).padStart(4, "0")}`;

/** Runs a script without blocking this process: the mocks live in it, and have to answer. */
function exec(script, args) {
  return new Promise((resolveExec) => {
    const child = spawn(process.execPath, [`scripts/${script}`, ...args], { cwd: repo });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolveExec({ code, out, err }));
  });
}

const lines = (file) => readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "bench-cli-"));
  const bridge = await startMock({ name: "bridge-1", lamps: { [IEEE(1)]: 0, [IEEE(2)]: 0 } });
  const panel = await startMock({ name: "panel-a", bridge, pendingMs: 300, taps: { 130100: IEEE(1) } });
  const sacrificial = await startMock({ name: "panel-s" });
  const plug = await startMock({ name: "plug", bootDelayMs: 60 });
  plug.powers(sacrificial);
  const locked = await startMock({ name: "locked", password: true });
  const topology = {
    devices: [
      { name: "bridge-1", role: "bridge", ip: bridge.host },
      { name: "panel-a", role: "panel", ip: panel.host, bridge: "bridge-1", taps: { "lamp-1": 130100 } },
      { name: "panel-s", role: "panel", ip: sacrificial.host, sacrificial: true },
      { name: "locked", role: "panel", ip: locked.host },
    ],
    lamps: [
      { name: "lamp-1", ieee: IEEE(1), coordinator: "bridge-1" },
      { name: "lamp-2", ieee: IEEE(2), coordinator: "bridge-1" },
    ],
    outlets: [{ name: "plug", ip: plug.host, role: "panel", powers: ["panel-s"] }],
  };
  const file = join(dir, "topology.json");
  writeFileSync(file, JSON.stringify(topology));
  const mocks = [bridge, panel, sacrificial, plug, locked];
  return { dir, file, bridge, panel, sacrificial, plug, locked, mocks, close: async () => { for (const m of mocks) await m.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("a dry run leaves every device without a single request, whatever the script", async () => {
  const s = await setup();
  try {
    const out = join(s.dir, "run");
    const results = await Promise.all([
      exec("bench-logs.mjs", ["--dry-run", "--topology", s.file, "--out", out]),
      exec("bench-load.mjs", ["--topology", s.file, "--paths", "panel,tap,bridge", "--n", "3", "--out", out]),
      exec("bench-power.mjs", ["cuts", "--topology", s.file, "--outlets", "plug", "--cycles", "3", "--out", out]),
      exec("bench-power.mjs", ["blackout", "--topology", s.file, "--outlets", "plug", "--out", out]),
      exec("bench-surface.mjs", ["--topology", s.file, "--targets", "panel-s,locked", "--out", out]),
    ]);
    for (const r of results) assert.equal(r.code, 0, r.err);
    assert.ok(results.slice(1).every((r) => /Nothing was sent\. Run again with --yes\./.test(r.out)));
    for (const m of s.mocks) assert.equal(m.requests.length, 0, `${m.name} was asked something by a dry run`);
    assert.equal(existsSync(out), false, "no run directory either");
  } finally {
    await s.close();
  }
});

test("bench-logs: polls the devices from the command line and writes the run", async () => {
  const s = await setup();
  try {
    const out = join(s.dir, "logs-run");
    const r = await exec("bench-logs.mjs", ["--no-syslog", "--probes", "status11,memory", "--every", "status11=0.1,memory=0.2", "--duration", "0.6", "--out", out, `bridge=${s.bridge.host}`, `panel=${s.panel.host}`]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /done: \d+ lines/);
    const rows = lines(join(out, "logs.jsonl"));
    assert.ok(rows.some((x) => x.device === "bridge" && x.probe === "status11" && x.ok));
    assert.ok(rows.some((x) => x.device === "panel" && x.probe === "memory" && x.ok));
    assert.ok(existsSync(join(out, "meta.json")));
    for (const m of [s.bridge, s.panel]) assert.ok(m.requests.every((q) => q.path === "/cm" && /^(Status 11|Br tasmota\.memory\(\))$/.test(q.cmnd)));
    assert.equal((await exec("bench-logs.mjs", ["--no-poll", "--no-syslog"])).code, 2);
    assert.equal((await exec("bench-logs.mjs", ["--dry-run"])).code, 2);
  } finally {
    await s.close();
  }
});

test("bench-load --yes: sends the plan, reads the state back, writes load.jsonl and says what it found", async () => {
  const s = await setup();
  try {
    const out = join(s.dir, "load-run");
    const r = await exec("bench-load.mjs", ["--topology", s.file, "--paths", "panel,bridge", "--n", "4", "--gap", "0", "--confirm-timeout", "800", "--poll-ms", "15", "--panel-view", "--seed", "11", "--tag", "cli", "--out", out, "--yes"]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /RUNNING/);
    assert.match(r.out, /tcp: 4 lines, 4 confirmed/);
    assert.match(r.out, /http-bridge: 4 lines, 4 confirmed/);
    const rows = lines(join(out, "load.jsonl"));
    assert.equal(rows[0].kind, "load-run");
    assert.equal(rows[0].seed, "11");
    assert.equal(rows.filter((x) => x.kind === "load").length, 8);
    assert.ok(rows.filter((x) => x.kind === "load").every((x) => x.tag === "cli"));
    assert.equal(rows.at(-1).kind, "load-summary");
    assert.ok(existsSync(join(out, "topology.json")));
    assert.equal(s.bridge.zbSends, 8);
  } finally {
    await s.close();
  }
});

test("bench-power --yes: cuts the sacrificial device, waits for it, writes power.jsonl, leaves the outlet on", async () => {
  const s = await setup();
  try {
    const out = join(s.dir, "power-run");
    const r = await exec("bench-power.mjs", ["cuts", "--topology", s.file, "--outlets", "plug", "--cycles", "2", "--off-min", "150", "--off-max", "200", "--settle-min", "0", "--settle-max", "0", "--wait-boot", "5000", "--out", out, "--yes"]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /2 cycle\(s\), every device back: true/);
    const rows = lines(join(out, "power.jsonl"));
    assert.equal(rows.filter((x) => x.kind === "power-cycle").length, 2);
    assert.equal(s.plug.outlet.states["1"], "ON");
    assert.equal(s.sacrificial.bootCount, 3);
    // an outlet that powers a device that is not sacrificial is refused before anything is sent
    const topology = JSON.parse(readFileSync(s.file, "utf8"));
    topology.devices.find((d) => d.name === "panel-s").sacrificial = false;
    writeFileSync(s.file, JSON.stringify(topology));
    const before = s.plug.requests.length;
    const refused = await exec("bench-power.mjs", ["cuts", "--topology", s.file, "--outlets", "plug", "--yes", "--out", join(s.dir, "refused")]);
    assert.equal(refused.code, 1);
    assert.match(refused.err, /not-sacrificial/);
    assert.equal(s.plug.requests.length, before);
  } finally {
    await s.close();
  }
});

test("bench-surface --yes: probes only the named devices, and never reads a password", async () => {
  const s = await setup();
  try {
    const out = join(s.dir, "surface-run");
    const r = await exec("bench-surface.mjs", ["--topology", s.file, "--targets", "panel-s,locked", "--delay", "0", "--out", out, "--yes"]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /panel-s: password off/);
    assert.match(r.out, /locked: password on/);
    assert.match(r.out, /look for bench-surface-probe-[0-9a-f]{8}\.txt in the file manager/);
    const rows = lines(join(out, "surface.jsonl"));
    assert.equal(rows.filter((x) => x.kind === "surface-summary").length, 2);
    assert.equal(s.bridge.requests.length, 0, "a device that was not named is not touched");
    assert.equal(s.panel.requests.length, 0);
    assert.ok(s.locked.requests.every((q) => q.authorization === null));
    assert.equal((await exec("bench-surface.mjs", ["--yes"])).code, 2);
    assert.equal((await exec("bench-surface.mjs", ["--yes", "203.0.113.0/24"])).code, 1);
  } finally {
    await s.close();
  }
});
