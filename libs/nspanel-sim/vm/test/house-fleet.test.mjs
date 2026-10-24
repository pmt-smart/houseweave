// The house's nodes on its server (ha/houseweave/server/house-fleet.mjs): its SHA-256, HMAC and HKDF against node:crypto, the key of the
// pair and the two signatures pinned as the node's side pins them (berry/test/test_server_link.be, the mesh driver's host test), the nodes' requests
// checked, their backups kept, the server's requests to them, the round at the house's time, and the OTA tab's routes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, randomBytes } from "node:crypto";
import { BACKUP_VERSIONS, CURRENT, FORMER, MAX_BACKUP, RELAY_MS, RELAY_STEP_MS, RETRY_MS, ROUND_GAP_MS, TIME_S, createFleet, doRequest, doneMac, hex, hkdf, hmac, pairKey, requestMac, said, sha256, utf8 } from "../../../../ha/houseweave/server/house-fleet.mjs";

// the pinned secrets: the node's 0x3C..., the server's 0x5A...
const raw = (b) => createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b656e04220420", "hex"), Buffer.alloc(32, b)]), format: "der", type: "pkcs8" });
const pubOf = (k) => createPublicKey(k).export({ type: "spki", format: "der" }).subarray(12).toString("hex");
const NODE = raw(0x3c);
const SERVER = raw(0x5a);
const NODE_PUB = pubOf(NODE);
const SERVER_PUB = pubOf(SERVER);
const K = "463c97311c85ec6df2640aeefc4be01b89b330283b2fb200af9ff9bc1e7dd238";
// and the key of the same pair in the names of the firmware before them
const K_FORMER = "0362be37b29b1735b58762e5179f885a16085191f4404f161220e8d30925472e";
const x25519 = (key) => (pub) => {
  try {
    return new Uint8Array(diffieHellman({ privateKey: key, publicKey: createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), Buffer.from(pub)]), format: "der", type: "spki" }) }));
  } catch {
    return null;
  }
};

test("SHA-256, HMAC and HKDF in plain JavaScript, as node:crypto has them", () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 70000]) {
    const d = new Uint8Array(randomBytes(n));
    assert.equal(hex(sha256(d)), createHash("sha256").update(d).digest("hex"), `SHA-256 of ${n} bytes`);
    const k = new Uint8Array(randomBytes(n % 100));
    assert.equal(hex(hmac(k, d)), createHmac("sha256", k).update(d).digest("hex"), `HMAC of ${n} bytes under ${k.length}`);
  }
  const salt = utf8("houseweave-server");
  const ikm = new Uint8Array(randomBytes(32));
  for (const n of [16, 32, 42, 80]) assert.equal(hex(hkdf(salt, ikm, utf8("http"), n)), Buffer.from(hkdfSync("sha256", ikm, salt, utf8("http"), n)).toString("hex"), `HKDF of ${n}`);
});

test("the key of the pair and the two signatures, pinned as the node pins them", () => {
  assert.equal(SERVER_PUB, "b0d08f35b4683381489afb32825e59152d47d19bc9e050d6d5a954984c9d1e2c");
  assert.equal(hex(pairKey(x25519(SERVER), NODE_PUB)), K, "the server's side");
  assert.equal(hex(pairKey(x25519(NODE), SERVER_PUB)), K, "and the node's, the same");
  assert.equal(pairKey(x25519(SERVER), "00".repeat(32)), null, "a point of small order gives none");
  assert.equal(pairKey(x25519(SERVER), "abcd"), null, "nor a key of the wrong size");
  const key = Buffer.from(K, "hex");
  assert.equal(requestMac(key, "PUT", "/api/backup", 1760000000, utf8('{"v":1}')), "b188046ab010fb3aa6224f1319961b4bab6ee0ffe7fe921fe2c4b880ef8261ee");
  assert.equal(doRequest(key, 1, "backup", 1760000000, "00112233aabbccdd").mac, "f8ed022f190a5ac856320104599ce8a1a99f739340654de60f054b216794f015");
  // the former names: the same pins as the firmware before them
  assert.equal(hex(pairKey(x25519(SERVER), NODE_PUB, FORMER)), K_FORMER);
  const former = Buffer.from(K_FORMER, "hex");
  assert.equal(requestMac(former, "PUT", "/api/backup", 1760000000, utf8('{"v":1}')), "63ba8140b71a64be34d06f32b197486081f83928ddee28a2ad65c4b8850ab602");
  assert.equal(doRequest(former, 1, "backup", 1760000000, "00112233aabbccdd", FORMER).mac, "bcb050a6a087b8a627488e00f1e0646e83f713e7b72b0ee0d125320701d4a167");
});

// a server's nodes, over a store in memory, with its clock and its posts in the test's hands. `kept` is a fleet.json the server starts from;
// `speaks` gives the names a node at an address speaks, which answers a route of the others as release-server.mjs reads a 404
function fleetOf({ nodes, minutes = () => 600, kept: fleetJson, speaks = {} } = {}) {
  const files = new Map();
  if (fleetJson) files.set("fleet.json", utf8(JSON.stringify(fleetJson)));
  const store = { get: (rel) => files.get(rel), put: (rel, bytes) => files.set(rel, new Uint8Array(bytes)), list: (prefix) => [...files.keys()].filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/")) };
  const clock = { now: 1760000000000 };
  const posted = [];
  const answers = [];
  const waits = [];
  let kept = { node: 8, house: "Cottage", nodes: nodes ?? [[1, 2, "P-Desk", "192.168.2.113", NODE_PUB, "aabbccddeeff"], [5, 1, "B-PC", "192.168.2.115", SERVER_PUB, "b0b0b0000005"]],
               paired: "2026-10-21T02:00:00.000Z" };
  const fleet = createFleet({
    shared: x25519(SERVER), random: (n) => new Uint8Array(n).fill(0x11), store, house: () => kept, now: () => clock.now, minutes: (ms) => minutes(ms),
    post: async (url, body) => {
      posted.push([url, body]);
      const names = speaks[new URL(url).hostname];
      if (names && new URL(url).pathname !== names.route) return { error: "no such route" };
      const a = answers.shift();
      if (a instanceof Error) throw a;
      return a ?? { v: 1, node: 1, verb: body.verb, state: { role: "panel", build: "b2" } };
    },
    wait: async (ms) => {
      waits.push(ms);
      await f.onWait?.(ms);
    },
  });
  const f = { fleet, files, clock, posted, answers, waits, rehouse: (h) => (kept = h), onWait: null };
  return f;
}

// a node's request, signed as server_link.be signs it, or as the firmware before the names did (`former`)
const key1 = Buffer.from(K, "hex");
function signed(f, method, path, body, { node = 1, key = key1, t = Math.floor(f.clock.now / 1000), mac, former = false } = {}) {
  const b = body === undefined ? new Uint8Array(0) : utf8(typeof body === "string" ? body : JSON.stringify(body));
  const h = former ? "X-Casa-" : "X-HouseWeave-";
  return f.fleet.handleNode({ method, path, body: b, length: b.length, from: "192.168.2.213",
    headers: { [h + "Node"]: String(node), [h + "Time"]: String(t), [h + "Mac"]: mac ?? requestMac(key, method, path, t, b) } });
}
const panelBackup = (at, extra = {}) => ({ v: 1, panel: "aabbccddeeff", project: "p1", from: "AA:BB:CC:DD:EE:FF", at, keys: { panel_config: { v: 7 } }, ...extra });

test("a node's hello: taken when the node signs it, once, on time, and it says the node's state", () => {
  const f = fleetOf();
  assert.equal(f.fleet.handleNode({ method: "GET", path: "/ota/index.json", headers: {} }), null, "a path that is not the nodes'");
  assert.equal(signed(f, "POST", "/api/hello", { node: 1, kind: "boot", role: "panel", image: "tasmota32-houseweave-living-room-us", build: "b1", date: "2026-10-20", backup: { at: null, dirty: true } }).status, 204);
  const one = f.fleet.fleet().nodes[0];
  assert.deepEqual([one.node, one.role, one.name, one.ip, one.kind, one.state.build, one.state.backup, one.seen], [1, "panel", "P-Desk", "192.168.2.213", "boot", "b1", { at: null, dirty: true }, f.clock.now],
    "known by its number, at the address its request came from");
  const t = Math.floor(f.clock.now / 1000);
  const b = utf8(JSON.stringify({ node: 1, kind: "backup" }));
  const req = { method: "POST", path: "/api/hello", body: b, length: b.length, headers: { "x-houseweave-node": "1", "x-houseweave-time": String(t), "x-houseweave-mac": requestMac(key1, "POST", "/api/hello", t, b) } };
  assert.equal(f.fleet.handleNode(req).status, 204);
  assert.equal(f.fleet.handleNode(req).status, 401, "the same request again: once");
  assert.equal(signed(f, "POST", "/api/hello", { node: 1 }, { mac: "00".repeat(32) }).status, 401, "not signed by the pair's key");
  assert.equal(signed(f, "POST", "/api/hello", { node: 1 }, { key: Buffer.alloc(32, 7) }).status, 401, "signed by another key");
  assert.equal(signed(f, "POST", "/api/hello", { node: 1 }, { t: Math.floor(f.clock.now / 1000) - TIME_S - 1 }).status, 401, "from more than 10 minutes ago");
  assert.equal(signed(f, "POST", "/api/hello", { node: 1 }, { node: 9 }).status, 401, "a node the server does not know");
});

test("a panel's hello brings the house's nodes: a new one learnt, one gone forgotten", () => {
  const f = fleetOf();
  const NEW = "11".repeat(32);
  assert.equal(signed(f, "POST", "/api/hello", { node: 1, kind: "boot", role: "panel", nodes: [[1, 2, "P-Desk", "192.168.2.113", NODE_PUB, "aabbccddeeff"], [6, 2, "P-Living", "192.168.2.118", NEW, "c0c0c0000006"]] }).status, 204);
  assert.deepEqual(f.fleet.fleet().nodes.map((n) => [n.node, n.name]), [[1, "P-Desk"], [6, "P-Living"]]);
});

test("a node's backup: kept by its radio address, given back to it alone, the nine before it beside it", () => {
  const f = fleetOf();
  assert.equal(signed(f, "GET", "/api/backup").status, 404, "none yet");
  assert.equal(signed(f, "PUT", "/api/backup", panelBackup(1)).status, 204);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(f.files.get("backups/aabbccddeeff.json"))), panelBackup(1), "by its radio address, out of the folder served");
  const got = signed(f, "GET", "/api/backup");
  assert.deepEqual([got.status, JSON.parse(new TextDecoder().decode(got.body)).at], [200, 1]);
  for (let at = 2; at <= 12; at++) {
    f.clock.now += 1000;
    assert.equal(signed(f, "PUT", "/api/backup", panelBackup(at)).status, 204);
  }
  assert.equal(JSON.parse(new TextDecoder().decode(f.files.get("backups/aabbccddeeff.json.1"))).at, 11, ".1 the newest of the ones before");
  assert.equal(JSON.parse(new TextDecoder().decode(f.files.get(`backups/aabbccddeeff.json.${BACKUP_VERSIONS - 1}`))).at, 3, "and the oldest kept the tenth");
  assert.equal(f.files.has(`backups/aabbccddeeff.json.${BACKUP_VERSIONS}`), false);
  assert.deepEqual(f.fleet.fleet().nodes[0].backup, { at: 12, size: f.files.get("backups/aabbccddeeff.json").length, versions: BACKUP_VERSIONS });
  // a bridge's has its own name, and its own file
  assert.equal(signed(f, "PUT", "/api/backup", { v: 1, bridge: "b0b0b0000005", at: 5, keys: {} }, { node: 5, key: pairKey(x25519(SERVER), SERVER_PUB) }).status, 204);
  assert.equal(f.files.has("backups/b0b0b0000005.json"), true);
  // what is not a backup
  assert.equal(signed(f, "PUT", "/api/backup", "<html>").status, 400, "not JSON");
  assert.equal(signed(f, "PUT", "/api/backup", panelBackup(1, { v: 2 })).status, 400, "another format");
  assert.equal(signed(f, "PUT", "/api/backup", panelBackup(1, { keys: [] })).status, 400, "keys that are not an object");
  assert.equal(signed(f, "PUT", "/api/backup", { v: 1, keys: {} }).status, 400, "neither a panel's nor a bridge's");
  const big = utf8(JSON.stringify(panelBackup(1)));
  const t = Math.floor(f.clock.now / 1000);
  assert.equal(f.fleet.handleNode({ method: "PUT", path: "/api/backup", body: big, length: MAX_BACKUP + 1,
    headers: { "x-houseweave-node": "1", "x-houseweave-time": String(t), "x-houseweave-mac": requestMac(key1, "PUT", "/api/backup", t, big) } }).status, 413, "past the most it takes");
  assert.equal(signed(f, "DELETE", "/api/backup").status, 405, "nothing is deleted");
});

test("the server asks a node: signed for it, at its address, and the answer kept", async () => {
  const f = fleetOf();
  const a = await f.fleet.ask(1, "backup");
  assert.equal(f.posted[0][0], "http://192.168.2.113/houseweave/do", "the list's address, before the node said hello");
  const body = f.posted[0][1];
  assert.deepEqual(body, doRequest(key1, 1, "backup", Math.floor(f.clock.now / 1000), "1111111111111111"), "as server_link.be checks it");
  assert.deepEqual([a.verb, f.fleet.fleet().nodes[0].did.verb, f.fleet.fleet().nodes[0].state.build], ["backup", "backup", "b2"]);
  f.answers.push(new Error("timeout"));
  assert.match((await f.fleet.ask(5, "state")).error, /no answer/);
  assert.deepEqual(await f.fleet.ask(9, "state"), { error: "no such node" });
});

test("the round: once a night, in the hour from its time, every node in turn, a few seconds apart", async () => {
  let now = 2 * 60 + 10;
  const f = fleetOf({ minutes: () => now });
  now = 12 * 60;
  assert.equal(f.fleet.tick(), false, "at noon: nothing");
  now = 2 * 60 + 10;
  assert.equal(f.fleet.tick(), true, "at 02:10: the round");
  assert.equal(f.fleet.tick(), false, "and not twice");
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(f.posted.map(([url, b]) => [url, b.verb]), [["http://192.168.2.113/houseweave/do", "round"], ["http://192.168.2.115/houseweave/do", "round"]]);
  assert.deepEqual(f.waits, [ROUND_GAP_MS], "a pause between the two");
  f.clock.now += 30 * 60000;
  now = 2 * 60 + 40;
  assert.equal(f.fleet.tick(), false, "later in the hour: done tonight");
  f.clock.now += 24 * 3600000;
  now = 2 * 60 + 1;
  assert.equal(f.fleet.tick(), true, "the next night");
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  f.clock.now += 24 * 3600000;
  now = 3 * 60 + 5;
  assert.equal(f.fleet.tick(), false, "a night the server came up past the hour: none");
});

const call = async (f, method, path, body) => {
  const a = await f.fleet.handleOwner({ method, path, body: body === undefined ? undefined : utf8(JSON.stringify(body)) });
  return a === null ? null : [a.status, JSON.parse(new TextDecoder().decode(a.body))];
};

test("the OTA tab's routes: the nodes, the round's time, a verb for a node or for all", async () => {
  const f = fleetOf();
  assert.equal(await call(f, "GET", "/api/status"), null, "the pairing's, not these");
  const [s, view] = await call(f, "GET", "/api/fleet");
  assert.deepEqual([s, view.round, view.lastRound, view.running, view.nodes.map((n) => [n.node, n.role, n.name, n.ip, n.backup])],
    [200, "02:00", null, null, [[1, "panel", "P-Desk", "192.168.2.113", null], [5, "bridge", "B-PC", "192.168.2.115", null]]]);
  assert.deepEqual(await call(f, "PUT", "/api/round", { time: "3:00" }), [400, { error: "a time of the day, HH:MM" }]);
  assert.deepEqual(await call(f, "PUT", "/api/round", { time: "03:30" }), [200, { round: "03:30" }]);
  assert.equal(JSON.parse(new TextDecoder().decode(f.files.get("fleet.json"))).round, "03:30", "kept");
  const [one, a] = await call(f, "POST", "/api/node/1/upgrade");
  assert.deepEqual([one, a.verb, f.posted.at(-1)[1].verb], [200, "upgrade", "upgrade"]);
  assert.deepEqual(await call(f, "POST", "/api/node/1/dance"), [404, { error: "no such verb" }]);
  f.answers.push({ v: 1, error: "mac" });
  assert.deepEqual(await call(f, "POST", "/api/node/1/backup"), [502, { v: 1, error: "mac" }], "what the node refused, said");
  assert.deepEqual(await call(f, "POST", "/api/all/backup"), [202, { started: "backup" }]);
  assert.deepEqual(await call(f, "POST", "/api/round/now"), [409, { error: "a round runs already" }], "one at a time");
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(f.posted.slice(-2).map(([url, b]) => [url, b.verb]), [["http://192.168.2.113/houseweave/do", "backup"], ["http://192.168.2.115/houseweave/do", "backup"]]);
  assert.deepEqual(await call(f, "POST", "/api/round/now"), [202, { started: "round" }]);
  assert.equal((await call(f, "GET", "/api/fleet"))[1].lastRound, f.clock.now, "the owner's round is the last one");
  assert.deepEqual(said({ v: 1, node: 1, verb: "round", backup: "Up to date", state: { build: "b" } }), { backup: "Up to date" }, "what the round said, without its frame");
});

test("the house paired again: its nodes are the new pairing's", () => {
  const f = fleetOf();
  f.rehouse({ node: 3, house: "Cottage 2", nodes: [[2, 1, "B-New", "192.168.2.120", NODE_PUB, "dddddddddddd"]], paired: "2026-10-22T10:00:00.000Z" });
  assert.deepEqual(f.fleet.fleet().nodes.map((n) => [n.node, n.name, n.mac]), [[2, "B-New", "dddddddddddd"]]);
});

test("the hardware swap: the old node's backup given to a new node of its kind, which restores it, until its own; and undone by its own Restore", async () => {
  // node 1 a panel, node 6 the panel that replaces another one (aabbccddeeff), node 5 a bridge
  const PANEL6 = "22".repeat(32);
  const f = fleetOf({ nodes: [[1, 2, "P-Desk", "192.168.2.113", NODE_PUB, "aabbccddeeff"], [5, 1, "B-PC", "192.168.2.115", SERVER_PUB, "b0b0b0000005"],
                              [6, 2, "P-New", "192.168.2.120", PANEL6, "cccccccccccc"]] });
  const key6 = pairKey(x25519(SERVER), PANEL6);
  assert.equal(signed(f, "PUT", "/api/backup", panelBackup(7)).status, 204, "the old panel's backup, before it died");
  assert.equal(signed(f, "PUT", "/api/backup", panelBackup(9, { panel: "cccccccccccc" }), { node: 6, key: key6 }).status, 204, "and the new one's own");
  const list = (await call(f, "GET", "/api/fleet"))[1].backups;
  assert.deepEqual(list.map((b) => [b.mac, b.kind, b.node, b.replaced]), [["aabbccddeeff", "panel", 1, null], ["cccccccccccc", "panel", 6, null]], "the backups the server keeps, by their nodes");
  // what is not a swap
  assert.deepEqual(await call(f, "POST", "/api/replace", { from: "aabbccddeeff", to: 5 }), [400, { error: "a bridge takes a bridge's backup" }]);
  assert.deepEqual(await call(f, "POST", "/api/replace", { from: "cccccccccccc", to: 6 }), [400, { error: "the node's own backup: its Restore" }]);
  assert.deepEqual(await call(f, "POST", "/api/replace", { from: "dddddddddddd", to: 6 }), [404, { error: "no such backup" }]);
  assert.deepEqual(await call(f, "POST", "/api/replace", { from: "aabbccddeeff", to: 9 }), [404, { error: "no such node" }]);
  assert.equal((await call(f, "POST", "/api/replace", { from: "x", to: 6 }))[0], 400);
  // the swap: the new node is asked to restore, and given the old one's backup, for it by name
  const [st] = await call(f, "POST", "/api/replace", { from: "aabbccddeeff", to: 6 });
  assert.deepEqual([st, f.posted.at(-1)[0], f.posted.at(-1)[1].verb], [200, "http://192.168.2.120/houseweave/do", "restore"]);
  const got = signed(f, "GET", "/api/backup", undefined, { node: 6, key: key6 });
  const doc = JSON.parse(new TextDecoder().decode(got.body));
  assert.deepEqual([got.status, doc.panel, doc.at, doc.for], [200, "aabbccddeeff", 7, "cccccccccccc"], "the old one's, for the new one");
  const view = (await call(f, "GET", "/api/fleet"))[1];
  assert.deepEqual([view.nodes.find((n) => n.node === 6).swap.from, view.backups.find((b) => b.mac === "aabbccddeeff").replaced.by], ["aabbccddeeff", 6]);
  // the new node's own backup ends it: its own again
  f.clock.now += 1000;
  assert.equal(signed(f, "PUT", "/api/backup", panelBackup(11, { panel: "cccccccccccc" }), { node: 6, key: key6 }).status, 204);
  f.clock.now += 1000;
  const own = JSON.parse(new TextDecoder().decode(signed(f, "GET", "/api/backup", undefined, { node: 6, key: key6 }).body));
  assert.deepEqual([own.panel, own.at, own.for], ["cccccccccccc", 11, undefined], "the swap over: the node's own backup");
  // a swap undone by the node's own Restore: its own backup, kept
  await call(f, "POST", "/api/replace", { from: "aabbccddeeff", to: 6 });
  assert.equal(f.fleet.fleet().nodes.find((n) => n.node === 6).swap.from, "aabbccddeeff");
  const [rs] = await call(f, "POST", "/api/node/6/restore");
  assert.deepEqual([rs, f.posted.at(-1)[1].verb, f.fleet.fleet().nodes.find((n) => n.node === 6).swap], [200, "restore", null], "Restore: the node's own, the swap undone");
  assert.equal(f.fleet.fleet().backups.find((x) => x.mac === "aabbccddeeff").replaced, null, "and the old backup no longer given");
  assert.equal(JSON.parse(new TextDecoder().decode(signed(f, "GET", "/api/backup", undefined, { node: 6, key: key6, t: Math.floor(f.clock.now / 1000) }).body)).panel, "cccccccccccc");
  assert.deepEqual(await call(f, "POST", "/api/all/restore"), [404, { error: "no such verb" }], "never every node's at once");
});

test("a round asks a node that did not answer once more, a minute after the last, and only that one", async () => {
  const f = fleetOf();
  f.answers.push(new Error("The operation was aborted due to timeout"));
  assert.equal(f.fleet.all("round"), true);
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
  assert.deepEqual(f.posted.map(([url, b]) => [url, b.verb]), [["http://192.168.2.113/houseweave/do", "round"], ["http://192.168.2.115/houseweave/do", "round"],
    ["http://192.168.2.113/houseweave/do", "round"]], "the first missed the call, the second answered, and the first is asked again");
  assert.deepEqual(f.waits, [ROUND_GAP_MS, RETRY_MS]);
  assert.equal(f.fleet.fleet().nodes[0].did.answer.verb, "round", "and its answer kept");
});

test("the relay (the second stage): a node the server does not reach is asked through the one it reached last, over the mesh, and its answer taken when that node signs it", async () => {
  const f = fleetOf();
  const key5 = Buffer.from(pairKey(x25519(SERVER), SERVER_PUB));
  const t = Math.floor(f.clock.now / 1000);
  const nonce = "1111111111111111";
  assert.equal((await f.fleet.ask(5, "state")).node, 1, "node 5 answers: the server reached it");
  // node 1 does not answer at its address; node 5 takes the request for it
  f.answers.push(new Error("connect ETIMEDOUT"), { v: 1, node: 5, verb: "relay", relay: "Sent", state: {} });
  const answer = JSON.stringify({ v: 1, node: 1, verb: "state", state: { role: "panel", build: "b9" } });
  const reply = (over = {}) => signed(f, "POST", "/api/relayed", { to: 1, nonce, mac: doneMac(key1, nonce, answer), answer, ...over },
    { node: 5, key: key5 });
  const refusals = [];
  f.onWait = () => {
    if (refusals.length > 0) return;
    refusals.push(reply({ mac: "00".repeat(32) }).status, reply({ nonce: "2222222222222222" }).status, reply({ to: 5 }).status);
    refusals.push(reply().status, signed(f, "POST", "/api/relayed", { to: 1, nonce, mac: doneMac(key1, nonce, answer), answer }).status,
      reply().status);
  };
  const a = await f.fleet.ask(1, "state");
  assert.deepEqual(refusals, [401, 404, 404, 204, 404, 401],
    "not signed by node 1, for no request waiting, or for another node: refused; then taken, once, whichever node of the house brings it");
  const [url, body] = f.posted[2];
  assert.equal(url, "http://192.168.2.115/houseweave/do", "the request went to node 5");
  assert.deepEqual([body.verb, body.to, body.nonce, body.mac], ["relay", 1, nonce, doRequest(key5, 5, "relay", t, nonce).mac], "signed for node 5, for node 1");
  assert.deepEqual(body.req, doRequest(key1, 1, "state", t, nonce), "with node 1's own request, signed for it, the same nonce");
  assert.deepEqual([a.node, a.state.build], [1, "b9"], "node 1's answer");
  const rec = f.fleet.fleet().nodes.find((n) => n.node === 1);
  assert.deepEqual([rec.did.via, rec.did.answer.node, rec.state.build], [5, 1, "b9"], "kept, through node 5");
  assert.deepEqual(f.waits, [RELAY_STEP_MS], "the answer came at the first look");
  // no answer through node 5: a while, and it says so, the way the round's retry knows
  f.onWait = null;
  f.waits.length = 0;
  f.answers.push(new Error("connect ETIMEDOUT"), { v: 1, node: 5, verb: "relay", relay: "Sent", state: {} });
  assert.equal((await f.fleet.ask(1, "state")).error, "no answer (through node 5)");
  assert.equal(f.waits.length, RELAY_MS / RELAY_STEP_MS);
  // node 5 does not take it: the direct call's error stands
  f.answers.push(new Error("connect ETIMEDOUT"), { v: 1, node: 5, verb: "relay", relay: "No such node", state: {} });
  assert.equal((await f.fleet.ask(1, "state")).error, "no answer (connect ETIMEDOUT)");
});

test("a request lost on its way goes again, the same, through the next neighbour: the late answer of the first is taken, and the node's \"again\" is a request it ran", async () => {
  const f = fleetOf({ nodes: [[1, 2, "P-Desk", "192.168.2.113", NODE_PUB, "aabbccddeeff"], [5, 1, "B-PC", "192.168.2.115", SERVER_PUB, "b0b0b0000005"],
    [6, 1, "B-Desk", "192.168.2.116", SERVER_PUB, "b0b0b0000006"]] });
  const key5 = Buffer.from(pairKey(x25519(SERVER), SERVER_PUB));
  const nonce = "1111111111111111";
  await f.fleet.ask(6, "state");
  f.clock.now += 1000;
  await f.fleet.ask(5, "state");
  f.posted.length = 0;
  // node 1 does not answer at its address; node 5 (reached last) takes it and says nothing back; node 6 takes it too, and node 5's answer comes then
  f.answers.push(new Error("connect ETIMEDOUT"), { v: 1, node: 5, verb: "relay", relay: "Sent", state: {} }, { v: 1, node: 6, verb: "relay", relay: "Sent", state: {} });
  const answer = JSON.stringify({ v: 1, node: 1, verb: "restore", restore: "Looking", state: { role: "panel", build: "b9" } });
  let looks = 0;
  f.onWait = () => {
    looks++;
    if (looks === RELAY_MS / RELAY_STEP_MS + 1) {
      signed(f, "POST", "/api/relayed", { to: 1, nonce, mac: doneMac(key1, nonce, answer), answer }, { node: 5, key: key5 });
    }
  };
  const a = await f.fleet.ask(1, "restore");
  assert.deepEqual(f.posted.map(([u, b]) => [u, b.verb, b.to]), [["http://192.168.2.113/houseweave/do", "restore", undefined],
    ["http://192.168.2.115/houseweave/do", "relay", 1], ["http://192.168.2.116/houseweave/do", "relay", 1]], "direct, then node 5, then node 6");
  const direct = f.posted[0][1];
  assert.deepEqual([f.posted[1][1].req, f.posted[2][1].req], [direct, direct], "one request, the same nonce and signature, every way: the node runs it once");
  assert.deepEqual([a.restore, f.fleet.fleet().nodes.find((n) => n.node === 1).did.via], ["Looking", 5], "node 5's answer, late, taken while node 6 was waited on");
  // the node had taken it on a way whose answer was lost: "again", and the state it is in, asked at once
  f.onWait = () => {
    const again = JSON.stringify({ v: 1, error: "again" });
    signed(f, "POST", "/api/relayed", { to: 1, nonce, mac: doneMac(key1, nonce, again), answer: again }, { node: 5, key: key5 });
    f.onWait = null;
  };
  f.clock.now += 1000;
  f.posted.length = 0;
  f.answers.push(new Error("connect ETIMEDOUT"), { v: 1, node: 5, verb: "relay", relay: "Sent", state: {} }, { v: 1, node: 1, verb: "state", state: { build: "b9" } });
  const b = await f.fleet.ask(1, "restore");
  assert.deepEqual([b.again, b.verb, b.state?.build, f.posted.map(([, x]) => x.verb)], [true, "restore", "b9", ["restore", "relay", "state"]],
    "taken before, its answer lost: said so, with the node's state");
});

test("the relay: a node with no address at all is asked through another too, and with none to go through, it has no address", async () => {
  const f = fleetOf({ nodes: [[1, 2, "P-Desk", "", NODE_PUB, "aabbccddeeff"], [5, 1, "B-PC", "192.168.2.115", SERVER_PUB, "b0b0b0000005"]] });
  assert.deepEqual(await f.fleet.ask(1, "state"), { error: "no address" }, "no node reached yet to go through");
  assert.equal(f.posted.length, 0);
  await f.fleet.ask(5, "state");
  f.answers.push({ v: 1, node: 5, verb: "relay", relay: "Sent", state: {} });
  assert.equal((await f.fleet.ask(1, "backup")).error, "no answer (through node 5)");
  assert.deepEqual(f.posted.map(([u, b]) => [u, b.verb, b.req?.verb]), [["http://192.168.2.115/houseweave/do", "state", undefined],
    ["http://192.168.2.115/houseweave/do", "relay", "backup"]]);
});

test("a hello another node carried over the mesh (berry/mesh_http.be): taken on the node's own signature; no address for the node until one of its own", async () => {
  const f = fleetOf();
  await f.fleet.ask(5, "state");
  const hello = (from, via) => {
    f.clock.now += 1000;
    const t = Math.floor(f.clock.now / 1000);
    const b = utf8(JSON.stringify({ kind: "boot", role: "panel", build: "b9" }));
    const headers = { "X-HouseWeave-Node": "1", "X-HouseWeave-Time": String(t), "X-HouseWeave-Mac": requestMac(key1, "POST", "/api/hello", t, b) };
    if (via) headers["X-HouseWeave-Via"] = via;
    return f.fleet.handleNode({ method: "POST", path: "/api/hello", body: b, length: b.length, from, headers });
  };
  assert.equal(hello("192.168.2.111", "7").status, 204, "carried by node 7, signed by node 1");
  const one = () => f.fleet.fleet().nodes.find((x) => x.node === 1);
  assert.deepEqual([one().ip, one().state.build, one().seen !== null], ["", "b9", true],
    "seen, its state kept, and no address: neither the carrier's nor the list's, which answers no more, as seen on the bench");
  f.answers.push({ v: 1, node: 5, verb: "relay", relay: "Sent", state: {} });
  await f.fleet.ask(1, "state");
  assert.deepEqual(f.posted.slice(1).map(([u, b]) => [u, b.verb, b.req?.verb]), [["http://192.168.2.115/houseweave/do", "relay", "state"]],
    "asked through another at once, without the 5 s of a call to the old address");
  assert.equal(hello("192.168.2.120").status, 204, "its own hello again, with its Wi-Fi back");
  assert.equal(one().ip, "192.168.2.120");
});

// the house as a server kept it before the names changed: its nodes, paired, none of them heard since
const keptBefore = () => ({
  v: 1, round: "02:00", lastRound: null, paired: "2026-10-21T02:00:00.000Z", swaps: {}, replaced: {},
  nodes: { 1: { node: 1, role: "panel", name: "P-Desk", ip: "192.168.2.113", key: NODE_PUB, mac: "aabbccddeeff" },
           5: { node: 5, role: "bridge", name: "B-PC", ip: "192.168.2.115", key: SERVER_PUB, mac: "b0b0b0000005" } },
});

test("the firmware before the names: a node the server kept from then is called in the former names, and taken in them, until it speaks the current ones", async () => {
  const f = fleetOf({ kept: keptBefore(), speaks: { "192.168.2.113": FORMER } });
  const former1 = Buffer.from(K_FORMER, "hex");
  const t = Math.floor(f.clock.now / 1000);
  assert.equal((await f.fleet.ask(1, "state")).verb, "state");
  assert.deepEqual(f.posted[0], ["http://192.168.2.113/casa/do", doRequest(former1, 1, "state", t, "1111111111111111", FORMER)],
    "at the former route, signed under the former key in the former label");
  assert.equal(signed(f, "POST", "/api/hello", { kind: "backup" }, { key: former1, former: true }).status, 204, "its request in the former names, taken");
  assert.equal(signed(f, "POST", "/api/hello", { kind: "x" }, { key: key1, former: true }).status, 401, "the former headers with the current key: not its signature");
  assert.equal(signed(f, "POST", "/api/hello", { kind: "y" }, { key: former1 }).status, 401, "nor the current headers with the former key");
  // the node upgraded: its hello in the current names, and the server calls it in them
  assert.equal(signed(f, "POST", "/api/hello", { kind: "boot" }).status, 204);
  f.posted.length = 0;
  await f.fleet.ask(1, "state");
  assert.deepEqual(f.posted.map(([u]) => u), ["http://192.168.2.213/houseweave/do"], "at the address its hello came from");
});

test("the firmware before the names: a node called at a route it has not is called in the other names, and spoken to in them from then", async () => {
  // node 5 was kept from before, and runs the current firmware already
  const f = fleetOf({ kept: keptBefore(), speaks: { "192.168.2.115": CURRENT } });
  const key5 = Buffer.from(pairKey(x25519(SERVER), SERVER_PUB));
  const t = Math.floor(f.clock.now / 1000);
  assert.equal((await f.fleet.ask(5, "state")).verb, "state");
  assert.deepEqual(f.posted.map(([u, b]) => [u, b.mac]), [["http://192.168.2.115/casa/do", doRequest(Buffer.from(pairKey(x25519(SERVER), SERVER_PUB, FORMER)), 5, "state", t, "1111111111111111", FORMER).mac],
    ["http://192.168.2.115/houseweave/do", doRequest(key5, 5, "state", t, "1111111111111111").mac]], "the former route first, then the current one, with the same nonce");
  f.posted.length = 0;
  await f.fleet.ask(5, "state");
  assert.deepEqual(f.posted.map(([u]) => u), ["http://192.168.2.115/houseweave/do"], "and the current one alone after it answered there");
});

test("the firmware before the names: a request relayed to a node on it goes in its names, and its answer is taken in them; a hello carried says so in them too", async () => {
  const f = fleetOf({ kept: keptBefore() });
  const former1 = Buffer.from(K_FORMER, "hex");
  const key5 = Buffer.from(pairKey(x25519(SERVER), SERVER_PUB));
  const t = Math.floor(f.clock.now / 1000);
  const nonce = "1111111111111111";
  // node 5 speaks the current names; node 1 is still on the former firmware and out of the server's reach
  assert.equal(signed(f, "POST", "/api/hello", { kind: "boot" }, { node: 5, key: key5 }).status, 204);
  await f.fleet.ask(5, "state");
  f.answers.push(new Error("connect ETIMEDOUT"), { v: 1, node: 5, verb: "relay", relay: "Sent", state: {} });
  const answer = JSON.stringify({ v: 1, node: 1, verb: "state", state: { role: "panel", build: "b8" } });
  const statuses = [];
  f.onWait = () => {
    if (statuses.length > 0) return;
    statuses.push(signed(f, "POST", "/api/relayed", { to: 1, nonce, mac: doneMac(former1, nonce, answer), answer: answer + " " }, { node: 5, key: key5 }).status);
    statuses.push(signed(f, "POST", "/api/relayed", { to: 1, nonce, mac: doneMac(former1, nonce, answer, FORMER), answer }, { node: 5, key: key5 }).status);
  };
  const a = await f.fleet.ask(1, "state");
  assert.deepEqual(statuses, [401, 204], "the answer signed in node 1's names, the former, taken");
  const [url, body] = f.posted.at(-1);
  assert.deepEqual([url, body.mac], ["http://192.168.2.213/houseweave/do", doRequest(key5, 5, "relay", t, nonce).mac], "the node in between asked in its own names, at the address of its hello");
  assert.deepEqual(body.req, doRequest(former1, 1, "state", t, nonce, FORMER), "node 1's request in its own");
  assert.equal(a.state.build, "b8");
  // a hello of node 1's, carried by a neighbour on the former firmware
  f.clock.now += 1000;
  const t2 = Math.floor(f.clock.now / 1000);
  const b = utf8(JSON.stringify({ kind: "boot", role: "panel", build: "b8" }));
  const r = f.fleet.handleNode({ method: "POST", path: "/api/hello", body: b, length: b.length, from: "192.168.2.111",
    headers: { "X-Casa-Node": "1", "X-Casa-Time": String(t2), "X-Casa-Mac": requestMac(former1, "POST", "/api/hello", t2, b), "X-Casa-Via": "7" } });
  assert.deepEqual([r.status, f.fleet.fleet().nodes.find((n) => n.node === 1).ip], [204, ""], "carried: no address of its own");
});
