// The common part of the bench's scripts (scripts/lib/bench.mjs), against a Tasmota on 127.0.0.1 and no other.
//
//   node --test scripts/test
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  BenchError,
  assertExplicitHost,
  brResult,
  helpText,
  httpRequest,
  isReadOnlyCommand,
  makeClient,
  makeRng,
  parseArgs,
  parseBerryText,
  parseSyslog,
  percentile,
  resolveDevices,
  resolveSyslogDevice,
  summarize,
  theilSen,
  validateTopology,
  BR_MEMORY,
  panelViewExpression,
  parsePanelView,
} from "../lib/bench.mjs";
import { startMock } from "./mock-tasmota.mjs";

test("a seeded generator repeats itself, and a fork is independent of its parent", () => {
  const a = makeRng(42);
  const b = makeRng(42);
  const first = Array.from({ length: 8 }, () => a.next());
  assert.deepEqual(first, Array.from({ length: 8 }, () => b.next()));
  assert.notDeepEqual(first, Array.from({ length: 8 }, () => makeRng(43).next()));
  assert.deepEqual(makeRng("soak").int(0, 1000), makeRng("soak").int(0, 1000));
  const c = makeRng(7);
  const d = makeRng(7);
  c.fork("gaps").next();
  assert.equal(c.next(), d.next(), "drawing from a fork does not move the parent");
  const r = makeRng(1);
  for (let i = 0; i < 500; i++) {
    const n = r.int(3, 5);
    assert.ok(n >= 3 && n <= 5 && Number.isInteger(n));
  }
  assert.deepEqual([...makeRng(9).shuffle([1, 2, 3, 4, 5])].sort(), [1, 2, 3, 4, 5]);
});

test("arguments: values, defaults, = form, lists, unknown options", () => {
  const spec = { usage: "x", summary: "s", options: { n: { type: "int", default: 5, help: "" }, yes: { type: "boolean", help: "" }, names: { type: "list", help: "" }, sizes: { type: "ints", help: "" }, tag: { type: "string", help: "" } } };
  const { values, positional } = parseArgs(["--n", "9", "--yes", "--names=a, b", "--sizes", "5,8,12", "x=1.2.3.4", "--tag=soak"], spec);
  assert.equal(values.n, 9);
  assert.equal(values.yes, true);
  assert.deepEqual(values.names, ["a", "b"]);
  assert.deepEqual(values.sizes, [5, 8, 12]);
  assert.equal(values.tag, "soak");
  assert.deepEqual(positional, ["x=1.2.3.4"]);
  assert.equal(parseArgs([], spec).values.n, 5);
  assert.throws(() => parseArgs(["--nope"], spec), /unknown option/);
  assert.throws(() => parseArgs(["--n", "x"], spec), /integer/);
  assert.throws(() => parseArgs(["--n"], spec), /needs a value/);
  assert.match(helpText(spec), /--yes/);
});

test("a target is one host: ranges, subnets, wildcards and broadcast are refused", () => {
  for (const ok of ["203.0.113.5", "203.0.113.5:8080", "panel-living.local", "127.0.0.1:9"]) assert.equal(assertExplicitHost(ok), ok);
  for (const bad of ["", "203.0.113.0/24", "203.0.113.1-5", "203.0.113.*", "203.0.113.255", "224.0.0.1", "203.0.113", "300.1.1.1", "a b", "203.0.113.5:99999", "0.0.0.0", null]) {
    assert.throws(() => assertExplicitHost(bad), BenchError, `refused: ${bad}`);
  }
});

test("the topology: what it accepts, and the references it checks", () => {
  const good = {
    devices: [
      { name: "bridge-1", role: "bridge", ip: "203.0.113.11" },
      { name: "panel-eu", role: "panel", ip: "203.0.113.12", bridge: "bridge-1", sacrificial: true, taps: { "lamp-1": 130100 }, mesh: { id: 2 } },
    ],
    lamps: [{ name: "lamp-1", ieee: "0x00124B0000AA0001", coordinator: "bridge-1" }],
    outlets: [{ name: "plug-1", ip: "203.0.113.20", channel: 2, role: "bridge", powers: ["bridge-1"] }],
  };
  const t = validateTopology(good);
  assert.equal(t.devices[1].sacrificial, true);
  assert.equal(t.devices[0].sacrificial, false);
  assert.equal(t.outlets[0].channel, 2);
  const broken = (patch, re) => {
    const copy = structuredClone(good);
    patch(copy);
    assert.throws(() => validateTopology(copy), re);
  };
  broken((x) => (x.devices[1].bridge = "nobody"), /not a bridge/);
  broken((x) => (x.devices[0].name = "panel-eu"), /twice/);
  broken((x) => (x.devices[0].role = "router"), /role/);
  broken((x) => (x.devices[0].ip = "203.0.113.0/24"), /not a single host/);
  broken((x) => (x.lamps[0].ieee = "0x12"), /ieee/);
  broken((x) => (x.lamps[0].coordinator = "x"), /coordinator/);
  broken((x) => (x.outlets[0].powers = ["x"]), /powers/);
  broken((x) => (x.devices[1].taps = { ghost: 1 }), /not in the file/);
  assert.throws(() => validateTopology([]), /one JSON object/);
});

test("devices from the command line join the topology's, and only by explicit address", () => {
  const t = validateTopology({ devices: [{ name: "b", role: "bridge", ip: "203.0.113.1" }] });
  assert.deepEqual(resolveDevices({ topology: t, positional: ["p=203.0.113.2", "203.0.113.3"] }).map((d) => d.name), ["b", "p", "203.0.113.3"]);
  assert.throws(() => resolveDevices({ topology: t, positional: ["b=203.0.113.9"] }), /already/);
  assert.throws(() => resolveDevices({ topology: t, positional: ["x=203.0.113.0/24"] }), BenchError);
  assert.deepEqual(resolveDevices({ topology: t, only: ["b"] }).map((d) => d.name), ["b"]);
  assert.throws(() => resolveDevices({ topology: t, only: ["zz"] }), /no such device/);
});

test("Berry's own text is read back: maps, lists, nested, quotes, nil, instances", () => {
  assert.deepEqual(parseBerryText("{'heap_free': 176, 'frag': 34, 'iram_free': 57}"), { heap_free: 176, frag: 34, iram_free: 57 });
  assert.deepEqual(parseBerryText("{'live': {'0x00124B0000AA0001': 'on'}, 'doubt': {}}"), { live: { "0x00124B0000AA0001": "on" }, doubt: {} });
  assert.deepEqual(parseBerryText("[1, 'two', true, nil, 1.5, -3]"), [1, "two", true, null, 1.5, -3]);
  assert.deepEqual(parseBerryText(`{"it's": 'a "b"', 'c': "d'e"}`), { "it's": 'a "b"', c: "d'e" });
  assert.deepEqual(parseBerryText("{1: 'x'}"), { 1: "x" });
  assert.equal(parseBerryText("<instance: Foo()>"), "<instance: Foo()>");
  assert.throws(() => parseBerryText("{'a': "), BenchError);
  assert.equal(brResult({ Br: "57" }), 57);
  assert.equal(brResult({ Br: "hello" }), "hello");
  assert.deepEqual(brResult({ Br: "{'a': 1}" }), { a: 1 });
  assert.equal(brResult({ Br: "" }), "");
  assert.throws(() => brResult({ Br: "[attribute_error] 'nil' object has no attribute 'plan'" }), /attribute_error/);
  assert.throws(() => brResult({ Nope: 1 }), /no Br/);
});

test("syslog: the lines Tasmota sends, and which device they came from", () => {
  const line = parseSyslog(Buffer.from("<134>1 1970-01-01T00:00:02.096000+01:00 nspanel-living tasmota - - - HTP: Web server active on nspanel-living\n"));
  assert.equal(line.severity, 6);
  assert.equal(line.facility, 16);
  assert.equal(line.host, "nspanel-living");
  assert.equal(line.device_ts, "1970-01-01T00:00:02.096000+01:00");
  assert.equal(line.msg, "HTP: Web server active on nspanel-living");
  assert.equal(parseSyslog("<131>legacy text").msg, "legacy text");
  assert.equal(parseSyslog("not syslog at all").pri, null);
  const devices = [{ name: "a", ip: "203.0.113.1", hostname: "ha" }, { name: "b", ip: "203.0.113.2" }, { name: "c", ip: "203.0.113.2:8080", hostname: "hc" }];
  assert.equal(resolveSyslogDevice(devices, "203.0.113.1", "x").name, "a");
  assert.equal(resolveSyslogDevice(devices, "203.0.113.2", "hc").name, "c");
  assert.equal(resolveSyslogDevice(devices, "203.0.113.2", "other"), null);
  assert.equal(resolveSyslogDevice(devices, "198.51.100.9", "ha").name, "a");
});

test("numbers: nearest-rank percentiles, a summary, and a robust slope", () => {
  const v = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(v, 95), 95);
  assert.equal(percentile(v, 50), 50);
  assert.equal(percentile([], 95), null);
  const s = summarize([5, 1, 3, 100, 2]);
  assert.deepEqual([s.n, s.min, s.p50, s.max], [5, 1, 3, 100]);
  assert.equal(summarize([]).n, 0);
  const pts = Array.from({ length: 50 }, (_, i) => [i, 100 - 2 * i]);
  pts[10][1] = 900;
  assert.ok(Math.abs(theilSen(pts) + 2) < 0.01, "an outlier does not bend it");
});

test("the read-only list: what may be asked, and what may not", () => {
  for (const ok of ["Status 0", "Status 11", "Status", "EspNowMeshStatus", "ZbStatus3 0x00124B0000AA0001", "Power", BR_MEMORY, panelViewExpression(["0x00124B0000AA0001"]), panelViewExpression(["0x00124B0000AA0001", "0x00124B0000AA0002"], "unavailable"), "ZbBridgeMode"]) assert.ok(isReadOnlyCommand(ok), ok);
  for (const bad of ["Restart 1", "Power1 OFF", "ZbSend {}", "EspNowMeshSend 2,0,1,x", "Br persist.save()", "Br global.zb_bridge.send('x')", "Status 0; Restart 1", "Reset 1", "ZbBridgeMode tcp", "Status 11 x", 'Br (def () var l=global.plan.live var d=global.plan.doubt return [l.find("0x00124B0000AA0001"), d.find("0x00124B0000AA0001")] end)(); Restart 1', 'Br (def () var l=global.plan.live var d=global.plan.doubt global.zb_bridge.send("x") return [l.find("0x00124B0000AA0001"), d.find("0x00124B0000AA0001")] end)()']) assert.ok(!isReadOnlyCommand(bad), bad);
});

test("the client sends the Referer, never a credential, and gives a password back to its owner", async () => {
  const open = await startMock({ name: "open" });
  const locked = await startMock({ name: "locked", password: true });
  try {
    const client = makeClient({ timeoutMs: 1500, readOnly: true });
    const { json } = await client.cmd(open.host, "Status 11");
    assert.ok(json.StatusSTS.Heap > 0);
    assert.equal(open.requests.at(-1).referer, `http://${open.host}/`);
    assert.equal(open.requests.at(-1).authorization, null);
    await assert.rejects(client.cmd(locked.host, "Status 11"), (e) => e.code === "auth" && /owner/.test(e.message));
    assert.ok(locked.requests.every((r) => r.authorization === null));
    // read-only: a write is refused before it leaves, even a write that has the flag
    await assert.rejects(client.cmd(open.host, "Restart 1"), (e) => e.code === "write-blocked");
    await assert.rejects(client.cmd(open.host, "Power1 OFF", { write: true }), (e) => e.code === "write-blocked");
    assert.ok(open.requests.every((r) => !/restart|power1/i.test(r.cmnd ?? "")));
    // a client that may not write says so for a plain one too
    const plain = makeClient({ timeoutMs: 1500 });
    await assert.rejects(plain.cmd(open.host, "Power1 OFF", { write: true }), (e) => e.code === "write-blocked");
    const yes = makeClient({ timeoutMs: 1500, allowWrites: true });
    await yes.cmd(open.host, "Power1 OFF", { write: true });
    // Berry through the console
    const mem = await client.br(open.host, BR_MEMORY);
    assert.equal(mem.value.heap_free, 176);
    // a password or a user in a URL is refused by the transport itself
    await assert.rejects(httpRequest({ host: open.host, path: "/cm?cmnd=Status&password=x" }), /credential/);
    await assert.rejects(httpRequest({ host: open.host, path: "/", headers: { Authorization: "Basic xx" } }), /credential/);
  } finally {
    await open.close();
    await locked.close();
  }
});

test("a device that says nothing, or is not there, is an error the caller can name", async () => {
  const dead = await startMock({ name: "dead" });
  dead.alive = false;
  try {
    const client = makeClient({ timeoutMs: 800 });
    await assert.rejects(client.cmd(dead.host, "Status 11"), (e) => e.code === "no-reply");
  } finally {
    await dead.close();
  }
  // a port nobody listens on
  const server = http.createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  await assert.rejects(makeClient({ timeoutMs: 800 }).cmd(`127.0.0.1:${port}`, "Status 11"), (e) => e.code === "refused");
  // slow: the answer comes after the time
  const slow = http.createServer(() => {});
  await new Promise((done) => slow.listen(0, "127.0.0.1", done));
  try {
    await assert.rejects(makeClient({ timeoutMs: 150 }).cmd(`127.0.0.1:${slow.address().port}`, "Status 11"), (e) => e.code === "timeout");
  } finally {
    slow.closeAllConnections();
    await new Promise((done) => slow.close(done));
  }
});
