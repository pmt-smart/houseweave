// Tests of scripts/mesh-bench.mjs against mock devices: local HTTP servers on 127.0.0.1 that answer the
// way Tasmota's HTTP API does, and record what they are asked. No device of the bench is ever asked: the
// dry run is tried with the addresses of the documentation range (203.0.113.x), which it must not touch.
//
//   node --test scripts/mesh-bench.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, refuseDuplicates } from "./mesh-bench.mjs";
import { articulationPoints, clockSummary, components, healthGraph, healthSummary, houseSummary } from "./lib/mesh-collect.mjs";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "mesh-bench.mjs");

// --- the line ---------------------------------------------------------------------------------------

test("the options of setup are checked as they are read", () => {
  const ok = parseArgs(["setup", "10.0.0.1", "10.0.0.2", "--channel", "6", "--network", "1", "--yes"]);
  assert.deepEqual(ok.words, ["10.0.0.1", "10.0.0.2"]);
  assert.deepEqual([...ok.flags], [["channel", 6], ["network", 1], ["yes", true]]);
  assert.equal(parseArgs(["setup", "a", "b", "--channel=11"]).flags.get("channel"), 11);
  assert.equal(parseArgs(["setup", "a", "b", "--channel", "0"]).flags.get("channel"), 0, "0 leaves the channel, and it is a number");
  // --channel --yes: the --yes is not the channel, and it is not swallowed
  assert.throws(() => parseArgs(["setup", "a", "b", "--channel", "--yes"]), /--channel needs a number, 0 to 13/);
  assert.throws(() => parseArgs(["setup", "a", "b", "--network"]), /--network needs a number, 0 to 7/);
  assert.throws(() => parseArgs(["setup", "a", "b", "--channel", "six"]), /--channel is a number from 0 to 13, not 'six'/);
  assert.throws(() => parseArgs(["setup", "a", "b", "--channel", "6x"]), /not '6x'/);
  assert.throws(() => parseArgs(["setup", "a", "b", "--channel", "14"]), /from 0 to 13, not '14'/);
  assert.throws(() => parseArgs(["setup", "a", "b", "--network", "8"]), /from 0 to 7, not '8'/);
  assert.throws(() => parseArgs(["setup", "a", "b", "--channel", "-1"]), /needs a number|not '-1'/);
  assert.throws(() => parseArgs(["setup", "a", "b", "--chanel", "6"]), /--chanel is not an option of setup/);
  assert.throws(() => parseArgs(["setup", "a", "b", "--yes=1"]), /--yes takes no value/);
  assert.throws(() => parseArgs(["setup", "a", "b", "--yes", "--yes"]), /--yes is given twice/);
  // the verbs that read have no options, and a send's text is whatever it is
  assert.throws(() => parseArgs(["status", "10.0.0.1", "--yes"]), /--yes is not an option of status/);
  assert.deepEqual(parseArgs(["send", "10.0.0.1", "2", "0", "1", "--hello"]).words, ["10.0.0.1", "2", "0", "1", "--hello"]);
});

test("an address named twice is refused, by either spelling of it", () => {
  refuseDuplicates(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);
  assert.throws(() => refuseDuplicates(["10.0.0.1", "10.0.0.2", "10.0.0.1"]), /10\.0\.0\.1 is named twice/);
  assert.throws(() => refuseDuplicates(["10.0.0.1", "10.0.0.1:80"]), /named twice/);
  assert.throws(() => refuseDuplicates(["Bench-A.local", "bench-a.local"]), /named twice/);
  refuseDuplicates(["10.0.0.1:8080", "10.0.0.1:8081"]);
});

// --- the devices --------------------------------------------------------------------------------------

const events = []; // [device, command], in the order the devices were asked, across all of them

// A device. `image` false is a Tasmota with no mesh driver; `password` one with a web password;
// `failOn` a command it answers with {"Command":"Error"}; `pages` one that lists 12 neighbours five to a page, with the Next the driver gives ("stuck": a Next that does not advance);
// `groupVersion` one that holds a key of the network of that version; `noKeyClose` one whose image has no EspNowMeshKeyClose.
// `id` is the node number its EspNowMeshStatus says; `health`, `clock` and `house` are what it answers to EspNowMeshHealth, EspNowMeshClock (a head and a list,
// five entries to a page, with the Next the driver gives) and HouseStatus.
async function device(name, { image = true, password = false, failOn = null, pages = false, groupVersion = undefined, noKeyClose = false, id = 0, health = null, clock = null, house = null } = {}) {
  const received = [];
  const server = createServer((req, res) => {
    const command = new URL(req.url, "http://device").searchParams.get("cmnd");
    received.push(command);
    events.push([name, command]);
    if (password) {
      res.statusCode = 401;
      res.end("Unauthorized");
      return;
    }
    const verb = command.split(" ")[0];
    let body;
    if (verb.startsWith("EspNowMesh") && !image) body = { Command: "Unknown" };
    else if (failOn === verb) body = { Command: "Error" };
    else if (verb === "EspNowMeshKeyClose" && noKeyClose) body = { Command: "Unknown" };
    else if (verb === "EspNowMeshStatus") body = { EspNowMeshStatus: { Running: 0, Id: id, ...(groupVersion !== undefined ? { Group: 1, GroupVersion: groupVersion } : {}), Heap: 100000 } };
    else if ((verb === "EspNowMeshHealth" && health) || (verb === "EspNowMeshClock" && clock)) {
      const { head, list } = verb === "EspNowMeshHealth" ? health : clock;
      const from = Number(command.split(" ")[1] ?? 0);
      const page = list.slice(from, from + 5);
      const more = from + 5 < list.length;
      body = { [verb]: { ...head, Count: list.length, From: from, List: page, ...(more ? { Next: from + 5 } : {}) } };
    } else if (verb === "HouseStatus" && house) body = { HouseStatus: house };
    else if (verb === "EspNowMeshNeighbors" && pages) {
      const from = Number(command.split(" ")[1] ?? 0);
      const List = Array.from({ length: 12 }, (_, k) => ({ Id: 100 + k })).slice(from, from + 5);
      const more = from + 5 < 12;
      body = { EspNowMeshNeighbors: { Count: 12, From: from, List, ...(more ? { Next: pages === "stuck" ? from : from + 5 } : {}) } };
    } else if (verb === "EspNowMeshPublic") body = { EspNowMeshPublic: { Mac: `AA:BB:CC:00:00:0${name}`, Public: name.repeat(64) } };
    else body = { [verb]: "Done" };
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { name, received, ip: `127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function withDevices(specs, fn) {
  events.length = 0;
  const devices = [];
  try {
    for (const [i, spec] of specs.entries()) devices.push(await device(String(i + 1), spec));
    return await fn(devices);
  } finally {
    for (const d of devices) await d.close();
  }
}

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const writes = (received) => received.filter((c) => c !== "EspNowMeshStatus");

// --- setup ----------------------------------------------------------------------------------------------

test("with no --yes, setup says what it would do, and asks nobody", async () => {
  await withDevices([{}, {}], async (devs) => {
    const r = await run(["setup", devs[0].ip, devs[1].ip, "--channel", "6"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Would set up 2 devices/);
    assert.match(r.stdout, /EspNowMeshChannel 6/);
    assert.match(r.stdout, /Nothing was sent/);
    assert.deepEqual(events, []);
  });
  // and a documentation address, which nothing may reach, answers at once
  const started = Date.now();
  const r = await run(["setup", "203.0.113.1", "203.0.113.2"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Nothing was sent/);
  assert.ok(Date.now() - started < 5000, "no wait on a device that is not there");
});

test("--channel --yes is refused, and does not turn into a dry run that looks like a run", async () => {
  await withDevices([{}, {}], async (devs) => {
    const r = await run(["setup", devs[0].ip, devs[1].ip, "--channel", "--yes"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--channel needs a number/);
    assert.deepEqual(events, []);
  });
});

test("an address twice is refused before any device is asked", async () => {
  await withDevices([{}, {}], async (devs) => {
    const r = await run(["setup", devs[0].ip, devs[1].ip, devs[0].ip, "--yes"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /is named twice/);
    assert.deepEqual(events, []);
  });
});

test("setup --yes: every device is read before any is written, the mesh ends started, the direct link is not turned on, the key stays in the process", async () => {
  await withDevices([{}, {}, {}], async (devs) => {
    const r = await run(["setup", ...devs.map((d) => d.ip), "--channel", "6", "--network", "1", "--yes"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const firstWrite = events.findIndex(([, c]) => c !== "EspNowMeshStatus");
    const lastStatus = events.map(([, c]) => c).lastIndexOf("EspNowMeshStatus");
    assert.equal(events.slice(0, 3).every(([, c]) => c === "EspNowMeshStatus"), true, "the three reads come first");
    assert.ok(lastStatus < firstWrite, "all the reads before the first write");
    assert.equal(new Set(events.slice(0, firstWrite).map(([d]) => d)).size, 3, "one read of each device");
    for (const d of devs) {
      const w = writes(d.received);
      assert.equal(w[0], "EspNowEnable 0");
      assert.equal(w[1], `EspNowMeshId ${d.name}`);
      assert.equal(w[2], "EspNowMeshPublic");
      assert.deepEqual(w.slice(-2), ["EspNowMeshEnable 1", "EspNowMeshReady 1"], "the mesh is the last thing that is started, and then told that the application is ready");
      assert.ok(w.includes("EspNowMeshChannel 6") && w.includes("EspNowMeshNetwork 1"));
      assert.equal(w.filter((c) => c.startsWith("EspNowMeshNode ")).length, 2, "each of the others");
      assert.ok(!d.received.includes("EspNowEnable 1"), "the direct link is not turned on again");
    }
    // one key for all, never in the output
    const keys = devs.map((d) => writes(d.received).find((c) => c.startsWith("EspNowMeshGroupKey ")).split(" ")[1]);
    assert.equal(new Set(keys).size, 1);
    assert.match(keys[0], /^[0-9a-f]{64},1$/);
    assert.ok(!(r.stdout + r.stderr).includes(keys[0].slice(0, 64)), "the key of the network is not printed");
    for (const d of devs) {
      const w = writes(d.received);
      assert.equal(w[w.findIndex((c) => c.startsWith("EspNowMeshGroupKey ")) + 1], "EspNowMeshKeyClose", "a setup is not a change of the key: what the device had is not kept as the previous key");
    }
  });
});

test("setup gives the key a version above the highest any device holds: a key that is not the one a device has is a change, and the same version is refused", async () => {
  await withDevices([{ groupVersion: 3 }, { groupVersion: 7 }, {}], async (devs) => {
    const r = await run(["setup", ...devs.map((d) => d.ip), "--yes"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const keys = devs.map((d) => writes(d.received).find((c) => c.startsWith("EspNowMeshGroupKey ")).split(" ")[1]);
    assert.equal(new Set(keys).size, 1, "one key, and one version, for all");
    assert.match(keys[0], /^[0-9a-f]{64},8$/);
  });
  // the version goes round at 255, to 1: it is a number of one byte, 1 to 255
  await withDevices([{ groupVersion: 255 }, {}], async (devs) => {
    const r = await run(["setup", ...devs.map((d) => d.ip), "--yes"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(writes(devs[0].received).find((c) => c.startsWith("EspNowMeshGroupKey ")), /,1$/);
  });
});

test("an image that has no EspNowMeshKeyClose is set up as before: it has no previous key to close", async () => {
  await withDevices([{ noKeyClose: true }, {}], async (devs) => {
    const r = await run(["setup", ...devs.map((d) => d.ip), "--yes"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(writes(devs[0].received).slice(-2), ["EspNowMeshEnable 1", "EspNowMeshReady 1"], "it ends started and ready");
    assert.equal(writes(devs[0].received).filter((c) => c === "EspNowMeshKeyClose").length, 1, "the command was tried, once");
  });
});

test("a device with no mesh in its image stops setup with nothing written to any", async () => {
  await withDevices([{}, { image: false }, {}], async (devs) => {
    const r = await run(["setup", ...devs.map((d) => d.ip), "--yes"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /nothing was written/);
    assert.match(r.stderr, new RegExp(`${esc(devs[1].ip)} says Unknown to EspNowMeshStatus: its image has no mesh driver`));
    for (const d of devs) assert.deepEqual(writes(d.received), [], `device ${d.name}: nothing but reads`);
    assert.ok(devs[2].received.includes("EspNowMeshStatus"), "the others were read too: all the bad ones are said at once");
  });
});

test("a device that asks for a password stops setup with nothing written", async () => {
  await withDevices([{}, { password: true }], async (devs) => {
    const r = await run(["setup", ...devs.map((d) => d.ip), "--yes"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /asks for a password: it is the owner's to remove/);
    assert.match(r.stderr, /nothing was written/);
    for (const d of devs) assert.deepEqual(writes(d.received), []);
  });
});

test("a failure after the writes began says which devices had been written to", async () => {
  await withDevices([{}, { failOn: "EspNowMeshGroupKey" }], async (devs) => {
    const r = await run(["setup", ...devs.map((d) => d.ip), "--yes"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /says Error to EspNowMeshGroupKey/);
    assert.match(r.stderr, new RegExp(`Written to before it: ${esc(devs[0].ip)}, ${esc(devs[1].ip)}`));
    assert.ok(!r.stderr.match(/[0-9a-f]{64}/), "and the line that failed, with the key in it, is not printed");
  });
});

// --- the reads ------------------------------------------------------------------------------------------

test("status says what a device answers, and an unknown command is a failure, not an answer", async () => {
  await withDevices([{}, { image: false }], async (devs) => {
    const r = await run(["status", ...devs.map((d) => d.ip)]);
    assert.equal(r.status, 1, "one of them failed");
    assert.match(r.stdout, new RegExp(`${esc(devs[0].ip)}  \\{"EspNowMeshStatus":`));
    assert.match(r.stdout, /says Unknown to EspNowMeshStatus/);
  });
});

test("neighbors asks for each page where the one before said the next begins, until none says it, and does not go round on a Next that does not advance", async () => {
  await withDevices([{ pages: true }, { pages: "stuck" }, { image: false }], async (devs) => {
    const r = await run(["neighbors", devs[0].ip]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(devs[0].received, ["EspNowMeshNeighbors", "EspNowMeshNeighbors 5", "EspNowMeshNeighbors 10"], "three pages, from where each Next said");
    const lines = r.stdout.trim().split("\n").map((l) => JSON.parse(l.slice(l.indexOf("  ") + 2)).EspNowMeshNeighbors);
    assert.deepEqual(lines.map((p) => p.From), [0, 5, 10]);
    assert.deepEqual(lines.flatMap((p) => p.List.map((e) => e.Id)), Array.from({ length: 12 }, (_, k) => 100 + k), "every neighbour once");
    assert.equal(lines[2].Next, undefined, "the last page has no Next");
    // a device that says the page after the first begins where the first did is told so, and asked no more
    const stuck = await run(["neighbors", devs[1].ip]);
    assert.equal(stuck.status, 1);
    assert.match(stuck.stdout, /pages do not advance/);
    assert.deepEqual(devs[1].received, ["EspNowMeshNeighbors"], "asked once");
    // a device with no mesh driver, and one named with the others
    const mixed = await run(["neighbors", devs[2].ip, devs[0].ip]);
    assert.equal(mixed.status, 1);
    assert.match(mixed.stdout, /says Unknown to EspNowMeshNeighbors/);
    assert.match(mixed.stdout, new RegExp(`${esc(devs[0].ip)}  \{"EspNowMeshNeighbors":\{"Count":12,"From":10`));
  });
});

// --- the collectors: health, clock, house ----------------------------------------------

// a node's report of its neighbours: those it counts on (Usable 1) and those it hears and does not count (Usable 0)
const links = (counted, heard = []) => [...counted.map((Id) => ({ Id, Quality: 95, Usable: 1 })), ...heard.map((Id) => ({ Id, Quality: 20, Usable: 0 }))];
const report = (id, counted, heard, cut = 0) => ({ id, list: links(counted, heard), cut });
const graphOf = (edges) => {
  const g = new Map();
  for (const [a, b] of edges) {
    if (!g.has(a)) g.set(a, new Set());
    if (!g.has(b)) g.set(b, new Set());
    g.get(a).add(b);
    g.get(b).add(a);
  }
  return g;
};

test("the single points of failure of a graph: a line, a star, a ring, two houses joined by one node, and a piece alone", () => {
  assert.deepEqual(articulationPoints(graphOf([[1, 2], [2, 3], [3, 4]])), [2, 3], "a line: the two in the middle");
  assert.deepEqual(articulationPoints(graphOf([[1, 2], [1, 3], [1, 4], [1, 5]])), [1], "a star: the hub");
  assert.deepEqual(articulationPoints(graphOf([[1, 2], [2, 3], [3, 4], [4, 5], [5, 1]])), [], "a ring of five: none");
  assert.deepEqual(articulationPoints(graphOf([[1, 2], [2, 3], [3, 1], [3, 4], [4, 5], [5, 6], [6, 4]])), [3, 4], "two triangles joined by an edge: both ends of it");
  assert.deepEqual(articulationPoints(graphOf([[1, 2], [2, 3], [3, 1], [3, 4], [4, 5], [5, 3]])), [3], "two triangles that share a node: it");
  assert.deepEqual(articulationPoints(graphOf([[1, 2], [3, 4]])), [], "pieces with no node whose going splits one");
  assert.equal(components(graphOf([[1, 2], [3, 4]])), 2);
  assert.equal(components(graphOf([[1, 2], [2, 3]])), 1);
});

test("an edge is a link the two ends count on: a node that counts on one that does not count back is a link of one hand, said apart", () => {
  const { graph, oneSided } = healthGraph([report(1, [2]), report(2, [1, 3]), report(3, [])]);
  assert.deepEqual([...graph].map(([k, v]) => [k, [...v]]), [[1, [2]], [2, [1]], [3, []]], "1 and 2 count on each other; 2 counts on 3 and 3 does not on 2");
  assert.deepEqual(oneSided, [[2, 3]]);
  // a neighbour that is not one of the devices asked is not an edge, and not a one hand: it is only not read
  const outside = healthGraph([report(1, [2, 99]), report(2, [1])]);
  assert.deepEqual([...outside.graph.get(1)], [2]);
  assert.deepEqual(outside.oneSided, []);
});

test("health: a line of four marks the two in the middle, the devices that marked themselves are held against it, and a ring of five is every node's false alarm", () => {
  const line = healthSummary([report(1, [2], [], 0), report(2, [1, 3], [], 1), report(3, [2, 4], [], 1), report(4, [3], [], 0)]);
  assert.deepEqual(line, { nodes: [1, 2, 3, 4], edges: [[1, 2], [2, 3], [3, 4]], components: 1, articulation: [2, 3], marked: [2, 3], falseAlarm: [], missed: [], oneSided: [] });
  // a ring of five: each node sees two hops, finds more than one branch, and marks itself; none is a single point of failure
  const ring = healthSummary([report(1, [2, 5], [], 1), report(2, [1, 3], [], 1), report(3, [2, 4], [], 1), report(4, [3, 5], [], 1), report(5, [4, 1], [], 1)]);
  assert.deepEqual(ring.articulation, []);
  assert.deepEqual(ring.falseAlarm, [1, 2, 3, 4, 5], "the collector is the answer, and the devices' own Cut is a false alarm in every one");
  // a single point a device did not mark: one it could not see
  const missed = healthSummary([report(1, [2], [], 0), report(2, [1, 3], [], 0), report(3, [2], [], 0)]);
  assert.deepEqual([missed.articulation, missed.missed], [[2], [2]]);
  // a house that is two pieces already
  const split = healthSummary([report(1, [2]), report(2, [1]), report(3, [4]), report(4, [3])]);
  assert.equal(split.components, 2);
});

test("health reads every device to its last page, and puts together what they say", async () => {
  // node 2's list is 7 long: two pages
  const crowd = links([1, 3], [11, 12, 13, 14, 15]);
  await withDevices([
    { id: 1, health: { head: { Neighbors: 1, Cut: 0, Alone: 1 }, list: links([2]) } },
    { id: 2, health: { head: { Neighbors: 2, Cut: 1, Alone: 0 }, list: crowd } },
    { id: 3, health: { head: { Neighbors: 1, Cut: 0, Alone: 1 }, list: links([2]) } },
  ], async (devs) => {
    const r = await run(["health", ...devs.map((d) => d.ip)]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(devs[1].received, ["EspNowMeshStatus", "EspNowMeshHealth", "EspNowMeshHealth 5"], "node 2: its number, then its two pages from where the Next said");
    assert.deepEqual(devs[0].received, ["EspNowMeshStatus", "EspNowMeshHealth"], "node 1: one page");
    const last = r.stdout.trim().split("\n").pop();
    assert.match(last, /^mesh {2}/);
    const joined = JSON.parse(last.slice(6));
    assert.deepEqual(joined.articulation, [2], "the middle of the line is the single point");
    assert.deepEqual(joined.marked, [2], "and it marked itself");
    assert.deepEqual(joined.edges, [[1, 2], [2, 3]]);
    // the line of a device says its number, its head and the whole list
    const two = JSON.parse(r.stdout.split("\n").find((l) => l.startsWith(devs[1].ip)).slice(devs[1].ip.length + 2));
    assert.equal(two.Id, 2);
    assert.equal(two.List.length, 7);
  });
});

test("a device that does not answer is said, nothing is joined without it, and the exit says so", async () => {
  await withDevices([
    { id: 1, health: { head: { Cut: 0 }, list: links([2]) } },
    { image: false },
  ], async (devs) => {
    const r = await run(["health", ...devs.map((d) => d.ip)]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /says Unknown to EspNowMeshStatus/);
    assert.match(r.stdout, /mesh {2}no join: 1 of 2 devices did not answer/);
    assert.ok(!r.stdout.includes('"articulation"'), "no graph from half the house");
  });
  // a device with no number (the mesh not set up) and one named twice
  await withDevices([{ id: 0 }, { id: 2, health: { head: {}, list: [] } }], async (devs) => {
    const r = await run(["health", ...devs.map((d) => d.ip)]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /has no node number/);
  });
  await withDevices([{ id: 3, health: { head: {}, list: [] } }, { id: 3, health: { head: {}, list: [] } }], async (devs) => {
    const r = await run(["health", ...devs.map((d) => d.ip)]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /two devices have the same node number/);
  });
  const one = await run(["health", "203.0.113.1"]);
  assert.equal(one.status, 1);
  assert.match(one.stderr, /health needs at least two devices/);
});

test("clock: one timeline and all synchronised is a house at rest; a neighbour in another timeline, one that is not synchronised, the skews and the lost events are said", () => {
  const head = (extra = {}) => ({ Clock: 1, Synced: 1, Adopted: 1, Timeline: "AB12", Tag: 1, Mesh: 5000, Ticks10: 3, Taken: 0, Steps: 4, EventsLost: 0, ...extra });
  const at = (Id, Skew, Seen = 2) => ({ Id, Seen, Sync: 1, Skew, Timeline: "AB12" });
  const rest = clockSummary([
    { id: 1, clock: head(), list: [at(2, -1), at(3, 0)] },
    { id: 2, clock: head({ Taken: 1 }), list: [at(1, -3), at(3, -2)] },
    { id: 3, clock: head({ Taken: 1, Steps: 9 }), list: [at(1, -1), at(2, -7)] },
  ]);
  assert.deepEqual(rest, { nodes: [1, 2, 3], timelines: ["AB12"], sameTimeline: true, unsynced: [], taken: [2, 3], otherTimeline: [], noClock: [], skewMs: { min: -7, max: 0 }, steps: { 1: 4, 2: 4, 3: 9 }, eventsLost: [] });
  const apart = clockSummary([
    { id: 1, clock: head(), list: [at(2, 4, 1), at(3, 0, 0)] },
    { id: 2, clock: head({ Timeline: "CD34", Synced: 0, EventsLost: 2 }), list: [at(1, 4, 1)] },
  ]);
  assert.deepEqual([apart.sameTimeline, apart.timelines, apart.unsynced, apart.otherTimeline, apart.noClock, apart.eventsLost], [false, ["AB12", "CD34"], [2], [[1, 2], [2, 1]], [[1, 3]], [2]]);
  assert.equal(clockSummary([{ id: 1, clock: head(), list: [] }]).skewMs, null, "no neighbour, no skew");
});

test("the clock verb reads each device's clock to the last page and joins the timelines", async () => {
  const head = (Timeline) => ({ Clock: 1, Synced: 1, Adopted: 1, Timeline, Tag: 1, Mesh: 5000, Ticks10: 3, Taken: 0, Steps: 4, EventsLost: 0 });
  const many = Array.from({ length: 7 }, (_, k) => ({ Id: 10 + k, Seen: 2, Sync: 1, Skew: -k, Timeline: "AB12" }));
  await withDevices([
    { id: 1, clock: { head: head("AB12"), list: many } },
    { id: 2, clock: { head: head("AB12"), list: [{ Id: 1, Seen: 2, Sync: 1, Skew: -2, Timeline: "AB12" }] } },
  ], async (devs) => {
    const r = await run(["clock", ...devs.map((d) => d.ip)]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(devs[0].received, ["EspNowMeshStatus", "EspNowMeshClock", "EspNowMeshClock 5"]);
    const joined = JSON.parse(r.stdout.trim().split("\n").pop().slice(6));
    assert.equal(joined.sameTimeline, true);
    assert.deepEqual(joined.skewMs, { min: -6, max: 0 });
  });
});

test("house: the nodes agree on the name, the key and the list; a node with another key, a node missing from a list and a mesh that is down are said by node", () => {
  const node = (Id, Role = "Bridge", Name = `n${Id}`, Revoked = 0) => ({ Id, Role, Name, Revoked });
  const status = (Me, Nodes, extra = {}) => ({ Me, Up: 1, Name: "Cottage", Key: 1, Pending: 0, Nodes, ...extra });
  const all = [node(1), node(2, "Panel"), node(3)];
  const same = houseSummary([{ id: 1, house: status(1, all) }, { id: 2, house: status(2, all) }, { id: 3, house: status(3, all) }]);
  assert.deepEqual([same.sameName, same.sameKey, same.sameList, same.missing, same.down, same.pending], [true, true, true, {}, [], []]);
  const apart = houseSummary([
    { id: 1, house: status(1, all) },
    { id: 2, house: status(2, [node(1), node(2, "Panel")], { Key: 2, Pending: 1 }) },
    { id: 3, house: status(3, all, { Up: 0, Name: "Other" }) },
  ]);
  assert.deepEqual([apart.sameName, apart.names, apart.sameKey, apart.keyVersions, apart.sameList, apart.down, apart.pending], [false, ["Cottage", "Other"], false, [1, 2], false, [3], [2]]);
  assert.deepEqual(apart.missing, { 2: ["3:Bridge:0:n3"] }, "node 2 lacks node 3");
  // a revoked node is another entry of the list: the nodes that disagree on it disagree on the list
  const struck = houseSummary([{ id: 1, house: status(1, [node(1), node(2, "Bridge", "n2", 1)]) }, { id: 2, house: status(2, [node(1), node(2)]) }]);
  assert.equal(struck.sameList, false);
  assert.deepEqual(houseSummary([{ id: 1, house: status(1, all, { Digest: "AA" }) }, { id: 2, house: status(2, all, { Digest: "BB" }) }]).sameDigest, false, "a digest, when the nodes say one, is held too");
});

test("the house verb asks each device for its HouseStatus and joins it", async () => {
  const node = (Id) => ({ Id, Role: "Bridge", Name: `n${Id}`, Revoked: 0 });
  const one = (Me) => ({ Me, Up: 1, Name: "Cottage", Key: 1, Pending: 0, Nodes: [node(1), node(2)] });
  await withDevices([{ id: 1, house: one(1) }, { id: 2, house: one(2) }], async (devs) => {
    const r = await run(["house", ...devs.map((d) => d.ip)]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(devs[0].received, ["EspNowMeshStatus", "HouseStatus"]);
    const joined = JSON.parse(r.stdout.trim().split("\n").pop().slice(6));
    assert.deepEqual([joined.sameName, joined.sameKey, joined.sameList], [true, true, true]);
  });
  // a device with no house layer answers HouseStatus with something that is not a house: a failure, and no join
  await withDevices([{ id: 1, house: one(1) }, { id: 2 }], async (devs) => {
    const r = await run(["house", ...devs.map((d) => d.ip)]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /no join/);
  });
});
