// scripts/bench-surface.mjs: what it asks of a device, what it never asks, and how it reads the answers, against mocks on
// 127.0.0.1: a device with no web password, one with a password (and the hole in the upload, or without it), one that is
// off. The dry run is on 203.0.113.x and sends nothing.
//
//   node --test "scripts/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { NOT_PROBED, SURFACE_PROBES, describeProbes, probeDevice } from "../bench-surface.mjs";
import { JsonlWriter, makeClient } from "../lib/bench.mjs";
import { startMock } from "./mock-tasmota.mjs";

const repo = join(import.meta.dirname, "..", "..");
const rows = (file) => readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

async function probe(mock, { upload = true, allowWrites = true, delayMs = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bench-surface-"));
  const writer = new JsonlWriter(join(dir, "surface.jsonl"));
  try {
    const summary = await probeDevice({ device: { name: "dev", ip: mock.host }, client: makeClient({ timeoutMs: 1500, allowWrites }), writer, delayMs, upload, run: 1 });
    await writer.close();
    return { summary, records: rows(join(dir, "surface.jsonl")), text: readFileSync(join(dir, "surface.jsonl"), "utf8") };
  } catch (e) {
    await writer.close();
    throw e;
  }
}

const NEVER = /^\/(u1|u2|u3|u4|rt|wi)(\/|\?|$)/;

test("the list: the probes, and what is never sent, by the paths that do something", () => {
  const paths = SURFACE_PROBES.map((p) => p.path);
  assert.ok(paths.includes("/cm?cmnd=Status") && paths.includes("/dl") && paths.includes("/ufsu"));
  assert.ok(paths.every((p) => !NEVER.test(p)), "no probe is an endpoint that acts by itself");
  assert.ok(SURFACE_PROBES.filter((p) => p.method !== "GET").length === 1, "one write only");
  for (const never of ["/u1", "/u2, /u3", "/u4", "/rt", "/wi"]) assert.ok(NOT_PROBED.some((n) => n.path === never), never);
  assert.match(describeProbes([{ name: "d", ip: "203.0.113.5" }], true).join("\n"), /never sent/);
  assert.ok(!describeProbes([{ name: "d", ip: "203.0.113.5" }], false).join("\n").includes("POST /ufsu"));
});

test("the dry run lists the probes and sends nothing; a range or a bare topology is refused", () => {
  const out = join(mkdtempSync(join(tmpdir(), "bench-surface-cli-")), "never");
  const run = (...args) => spawnSync(process.execPath, ["scripts/bench-surface.mjs", ...args], { encoding: "utf8", cwd: repo });
  const dry = run("a=203.0.113.5", "b=203.0.113.6", "--out", out);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /DRY RUN/);
  assert.match(dry.stdout, /GET \/dl/);
  assert.match(dry.stdout, /Nothing was sent\. Run again with --yes\./);
  assert.equal(existsSync(out), false);
  assert.equal(run("203.0.113.0/24").status, 1);
  assert.match(run("--yes", "203.0.113.1-9").stderr, /not a single host/);
  assert.match(run("--yes", "203.0.113.255").stderr, /not a single host/);
  assert.equal(run().status, 2);
  const file = join(mkdtempSync(join(tmpdir(), "bench-surface-topo-")), "t.json");
  writeFileSync(file, JSON.stringify({ devices: [{ name: "a", role: "bridge", ip: "203.0.113.5" }, { name: "b", role: "panel", ip: "203.0.113.6" }] }));
  const all = run("--topology", file);
  assert.equal(all.status, 2, "a topology is never all taken");
  assert.match(all.stderr, /--targets/);
  const one = run("--topology", file, "--targets", "b");
  assert.equal(one.status, 0);
  assert.match(one.stdout, /b 203\.0\.113\.6/);
  assert.doesNotMatch(one.stdout, /a 203\.0\.113\.5/);
  assert.match(run("--topology", file, "--targets", "zz").stderr, /no such device/);
});

test("a device with no web password: the console, the pages and the downloads answer, the upload is accepted, checked and removed", async () => {
  const mock = await startMock({ name: "open" });
  try {
    const { summary, records, text } = await probe(mock);
    assert.equal(summary.password, "off");
    assert.equal(summary.command_console, "open");
    for (const id of ["root", "command-console", "mqtt", "backup", "file-download", "files"]) assert.ok(summary.open_reads.includes(id), id);
    assert.deepEqual(summary.open_secret_reads.sort(), ["backup", "console-log", "file-download", "mqtt"]);
    assert.equal(summary.upload, "accepted");
    assert.equal(summary.upload_written, true);
    assert.match(summary.upload_file, /^bench-surface-probe-[0-9a-f]{8}\.txt$/);
    assert.equal(summary.needs_owner_check, false);
    const up = records.find((r) => r.probe === "file-upload");
    assert.equal(up.cleanup, "removed");
    assert.equal(up.status, 200);
    assert.equal(Object.keys(mock.files).filter((k) => /bench-surface-probe/.test(k)).length, 0, "the probe file is gone");
    assert.equal(mock.uploads.length, 1);
    // an absent page is absent, and every record says what it asked
    assert.equal(records.find((r) => r.probe === "file-editor").verdict, "open");
    assert.ok(records.filter((r) => r.kind === "surface").every((r) => r.v === 1 && r.device === "dev" && typeof r.ms === "number" && r.method && r.path));
    // no body was read or kept: the settings dump of /dl (4096 bytes of X) is nowhere in the file
    assert.ok(!text.includes("XXXX"));
    assert.equal(records.find((r) => r.probe === "backup").content_length, 4096);
    assert.match(records.find((r) => r.probe === "backup").content_type, /octet-stream/);
  } finally {
    await mock.close();
  }
});

test("a device with a web password: 401 on every read, and the upload's 401 is NOT taken as proof that nothing was written", async () => {
  const hole = await startMock({ name: "n9", password: true, ufsuOpen: true });
  const sound = await startMock({ name: "sound", password: true });
  try {
    for (const mock of [hole, sound]) {
      const { summary, records } = await probe(mock);
      assert.equal(summary.password, "on");
      assert.equal(summary.command_console, "auth");
      assert.deepEqual(summary.open_reads, []);
      assert.deepEqual(summary.open_secret_reads, []);
      assert.ok(records.filter((r) => r.kind === "surface" && r.method === "GET").every((r) => r.verdict === "auth" && r.status === 401));
      // the pages ask for a login; the console over HTTP answers 401 with a JSON warning and no challenge
      assert.ok(records.filter((r) => r.kind === "surface" && r.method === "GET" && r.probe !== "command-console").every((r) => r.challenge === true));
      assert.equal(summary.upload, "auth");
      assert.equal(summary.upload_written, null, "unknown, not false");
      assert.equal(summary.needs_owner_check, true);
      assert.match(summary.upload_file, /^bench-surface-probe-/);
    }
    // the mock shows why: with the hole the file IS written under a 401
    assert.equal(hole.uploads.length, 1);
    assert.equal(sound.uploads.length, 0);
    // the script did not try to remove it (it cannot: removal needs the password), and no request carried one
    assert.ok(hole.requests.every((r) => r.authorization === null && !/delete=/.test(r.query)));
  } finally {
    await hole.close();
    await sound.close();
  }
});

test("--no-upload sends no POST at all", async () => {
  const mock = await startMock({ name: "open" });
  try {
    const { summary } = await probe(mock, { upload: false });
    assert.equal(summary.upload, "skipped");
    assert.equal(mock.requests.filter((r) => r.method === "POST").length, 0);
  } finally {
    await mock.close();
  }
});

test("never an endpoint that acts by itself, never a command but Status, always the Referer, never a credential, and a pause between requests", async () => {
  const mock = await startMock({ name: "open" });
  try {
    await probe(mock, { delayMs: 25 });
    assert.ok(mock.requests.length >= SURFACE_PROBES.length);
    for (const r of mock.requests) {
      assert.ok(!NEVER.test(r.path), `${r.method} ${r.path}`);
      assert.equal(r.referer, `http://${mock.host}/`);
      assert.equal(r.authorization, null);
      if (r.path === "/cm") assert.equal(r.cmnd, "Status");
      if (r.method === "POST") assert.equal(r.path, "/ufsu");
      if (r.path === "/ufsd" && r.query.includes("delete")) assert.match(r.query, /^\?delete=\/bench-surface-probe-[0-9a-f]{8}\.txt$/, "only the file this run made is ever deleted");
    }
    for (let k = 1; k < mock.requests.length; k++) assert.ok(mock.requests[k].at - mock.requests[k - 1].at >= 20, "requests are spaced");
  } finally {
    await mock.close();
  }
});

test("a device that is off: every probe is no-reply, and the next device is still asked", async () => {
  const dead = await startMock({ name: "dead" });
  dead.alive = false;
  try {
    const { summary, records } = await probe(dead);
    assert.equal(summary.password, "unknown");
    assert.ok(records.filter((r) => r.kind === "surface").every((r) => r.verdict === "no-reply" && r.status === null));
    assert.equal(summary.upload, "no-reply");
  } finally {
    await dead.close();
  }
});

test("the upload is a write: a client without --yes cannot make it", async () => {
  const mock = await startMock({ name: "open" });
  try {
    await assert.rejects(probe(mock, { allowWrites: false }), (e) => e.code === "write-blocked");
    assert.equal(mock.requests.filter((r) => r.method === "POST").length, 0);
  } finally {
    await mock.close();
  }
});
