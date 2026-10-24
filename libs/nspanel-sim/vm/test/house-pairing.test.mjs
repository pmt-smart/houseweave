// The release server as a member of the house (ha/houseweave/server/house-pairing.mjs): its identity, its request to the panel and the panel's
// answer, proved by the code, the house kept, and its routes. The panel's side is berry/house_server.be, whose test pins the same HMAC as here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FORMER_PAIRING, PAIRING, addressFor, createApi, hmac, house, identity, pair, pairRequest, welcomeChecks } from "../../../../ha/houseweave/server/house-pairing.mjs";

const KEY = "9a968a150000000000000000000000000000000000000000000000000000fd5f";
const temp = () => mkdtempSync(join(tmpdir(), "house-pairing-"));

test("HMAC-SHA256 as RFC 4231 says it, and the pairing's request, pinned as the panel's test pins it", () => {
  assert.equal(hmac("Jefe", "what do ya want for nothing?"), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  const r = pairRequest({ key: KEY, host: "192.168.2.108", port: 8099, name: "Home Assistant", code: "123456", nonce: "0011223344556677" });
  assert.deepEqual(r, { v: 1, key: KEY, host: "192.168.2.108", port: 8099, name: "Home Assistant", nonce: "0011223344556677",
                        mac: "d3390a5fcc3546613c19927edbb7a3ce02986118c90a48f47fc3dd589b8b6782" });
  // and in the labels of the firmware before them
  assert.equal(pairRequest({ key: KEY, host: "192.168.2.108", port: 8099, name: "Home Assistant", code: "123456", nonce: "0011223344556677" }, FORMER_PAIRING).mac,
               "cffd0da3f5de72981a4afa5e64595ea9f134e256f97632ab4a58f5ed05289640");
});

test("its identity: an X25519 key made once, kept, its public half 32 bytes", () => {
  const dir = temp();
  try {
    const a = identity(dir);
    assert.match(a.public, /^[0-9a-f]{64}$/);
    assert.equal(identity(dir).public, a.public, "the same at the next start");
    if (process.platform !== "win32") assert.equal(statSync(join(dir, "server-x25519.pem")).mode & 0o077, 0, "read by its owner alone");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// the panel, as house_server.be answers: the code checked, the server given its number; in the names it speaks, and a route of the others is
// none of its own, as the release server reads a 404
const panel = (code, { error, house: name = "Cottage", node = 9, names = PAIRING } = {}) => async (url, body) => {
  panel.asked = [url, body];
  (panel.urls ??= []).push(url);
  if (new URL(url).pathname !== names.route) return { error: "no such route" };
  if (error) return { v: 1, error };
  if (body.mac !== hmac(code, `${names.label}-pair-1|${body.key}|${body.host}|${body.port}|${body.name}|${body.nonce}`)) return { v: 1, error: "code" };
  return { v: 1, node, house: name, panel: 1, nodes: [[1, 2, "P-Desk", "192.168.2.113"], [5, 1, "B-PC", "192.168.2.115"]],
           mac: hmac(code, `${names.label}-pair-2|${body.nonce}|${node}|${name}`) };
};

test("paired on a panel: the request proved by the code, the answer checked, the house kept", async () => {
  const dir = temp();
  try {
    const r = await pair({ panel: "192.168.2.113", code: "482913", dir, address: { host: "192.168.2.108", port: 8099 }, post: panel("482913"),
                           now: () => new Date("2026-10-21T02:00:00Z") });
    assert.equal(panel.asked[0], "http://192.168.2.113/houseweave/pair");
    assert.equal(panel.asked[1].key, identity(dir).public, "its credential");
    assert.deepEqual([panel.asked[1].host, panel.asked[1].port, panel.asked[1].name], ["192.168.2.108", 8099, "Home Assistant"]);
    assert.ok(!JSON.stringify(panel.asked[1]).includes("482913"), "the code is not sent");
    assert.deepEqual(r, { node: 9, house: "Cottage", panel: 1, panelHost: "192.168.2.113", nodes: [[1, 2, "P-Desk", "192.168.2.113"], [5, 1, "B-PC", "192.168.2.115"]],
                          paired: "2026-10-21T02:00:00.000Z" });
    assert.deepEqual(house(dir), r, "kept");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a panel on the firmware before the names: asked at its own route, in its own labels, and paired", async () => {
  const dir = temp();
  try {
    panel.urls = [];
    const r = await pair({ panel: "192.168.2.113", code: "482913", dir, address: { host: "192.168.2.108", port: 8099 }, post: panel("482913", { names: FORMER_PAIRING }) });
    assert.deepEqual(panel.urls, ["http://192.168.2.113/houseweave/pair", "http://192.168.2.113/casa/pair"], "the current route first, and the former when the panel has not it");
    assert.deepEqual([r.node, r.house], [9, "Cottage"]);
    panel.urls = [];
    assert.match((await pair({ panel: "192.168.2.113", code: "000000", dir, address: { host: "192.168.2.108", port: 8099 }, post: panel("482913") })).error, /not the panel's/);
    assert.deepEqual(panel.urls, ["http://192.168.2.113/houseweave/pair"], "a panel of the current names that refuses the code is not asked again at the former route");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("what does not pair: a wrong code, a window closed, an answer that is not the panel's, no answer, and what is not asked right", async () => {
  const dir = temp();
  const at = { host: "192.168.2.108", port: 8099 };
  try {
    assert.match((await pair({ panel: "192.168.2.113", code: "000000", dir, address: at, post: panel("482913") })).error, /not the panel's/);
    assert.match((await pair({ panel: "192.168.2.113", code: "482913", dir, address: at, post: panel("482913", { error: "closed" }) })).error, /window is closed/);
    const liar = async (url, body) => ({ v: 1, node: 9, house: "Cottage", mac: "00".repeat(32) });
    assert.match((await pair({ panel: "192.168.2.113", code: "482913", dir, address: at, post: liar })).error, /not the panel's/);
    const mute = async () => { throw new Error("timeout"); };
    assert.match((await pair({ panel: "192.168.2.113", code: "482913", dir, address: at, post: mute })).error, /did not answer/);
    assert.match((await pair({ panel: "192.168.2.113", code: "48291", dir, address: at, post: panel("482913") })).error, /6 digits/);
    assert.match((await pair({ panel: "panel.local", code: "482913", dir, address: at, post: panel("482913") })).error, /address/);
    assert.match((await pair({ panel: "192.168.2.113", code: "482913", dir, address: null, post: panel("482913") })).error, /SERVER_HOST/);
    assert.equal(house(dir), null, "nothing kept");
    assert.equal(welcomeChecks(null, "482913", "00"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("its address for the panel: the one given, else this machine's on the panel's network", () => {
  const ifaces = { lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }], wsl: [{ family: "IPv4", address: "172.20.0.1", internal: false }],
                   wifi: [{ family: "IPv4", address: "192.168.2.108", internal: false }] };
  assert.deepEqual(addressFor("192.168.2.113", null, 8099, ifaces), { host: "192.168.2.108", port: 8099 });
  assert.deepEqual(addressFor("10.0.0.5", null, 8099, ifaces), { host: "172.20.0.1", port: 8099 }, "none on its network: the first");
  assert.deepEqual(addressFor("192.168.2.113", { host: "192.168.2.50", port: 8123 }, 8099, ifaces), { host: "192.168.2.50", port: 8123 });
});

test("its routes: the status, the pairing, and none other", async () => {
  const dir = temp();
  try {
    const api = createApi({ dir, address: () => ({ host: "192.168.2.108", port: 8099 }), post: panel("482913") });
    const body = (a) => JSON.parse(Buffer.from(a.body).toString("utf8"));
    let a = await api({ method: "GET", path: "/api/status" });
    assert.deepEqual([a.status, body(a).house, body(a).address], [200, null, { host: "192.168.2.108", port: 8099 }]);
    a = await api({ method: "POST", path: "/api/pair", body: Buffer.from(JSON.stringify({ panel: "192.168.2.113", code: "482913" })) });
    assert.deepEqual([a.status, body(a).node, body(a).house], [200, 9, "Cottage"]);
    a = await api({ method: "GET", path: "/api/status" });
    assert.equal(body(a).house.house, "Cottage");
    a = await api({ method: "POST", path: "/api/pair", body: Buffer.from(JSON.stringify({ panel: "192.168.2.113", code: "111111" })) });
    assert.equal(a.status, 409);
    a = await api({ method: "POST", path: "/api/pair", body: Buffer.from("nonsense") });
    assert.equal(a.status, 400);
    assert.equal((await api({ method: "GET", path: "/api/nothing" })).status, 404);
    assert.equal(await api({ method: "GET", path: "/ota/index.json" }), null, "a path not of the API is the folder's");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
