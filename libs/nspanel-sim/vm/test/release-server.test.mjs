// The house's release server (ha/houseweave/server/release-server.mjs), whose request handler the simulated house runs: what it serves, and
// nothing it takes -- the nodes' backups are the house's server's (house-fleet.mjs, its own test) -- the address it gives the house, and the
// integration it copies into Home Assistant.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FORMER_DOMAIN, answerFor, createHandler, installIntegration, retireFormerIntegration, serverAddress } from "../../../../ha/houseweave/server/release-server.mjs";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function server() {
  const files = new Map();
  const handle = createHandler({ get: (rel) => files.get(rel) });
  return { files, handle };
}

test("a Range of one span gets that part of a file, as the mesh's sender asks for an image's blocks", () => {
  const { files, handle } = server();
  const blocks = new Uint8Array(10000).map((_, i) => i & 0xff);
  files.set("releases/living-us.ota/blocks.bin", blocks);
  const part = handle({ method: "GET", path: "/releases/living-us.ota/blocks.bin", headers: { range: "bytes=4096-8191" } });
  assert.equal(part.status, 206);
  assert.equal(part.headers["Content-Range"], "bytes 4096-8191/10000");
  assert.equal(part.headers["Content-Length"], "4096");
  assert.deepEqual(part.body, blocks.subarray(4096, 8192));
  const tail = handle({ method: "GET", path: "/releases/living-us.ota/blocks.bin", headers: { range: "bytes=8192-" } });
  assert.equal(tail.status, 206, "to the end");
  assert.equal(tail.body.length, 1808);
  const past = handle({ method: "GET", path: "/releases/living-us.ota/blocks.bin", headers: { range: "bytes=9000-20000" } });
  assert.equal(past.headers["Content-Range"], "bytes 9000-9999/10000", "a span past the end ends at the end");
  const beyond = handle({ method: "GET", path: "/releases/living-us.ota/blocks.bin", headers: { range: "bytes=10000-10001" } });
  assert.equal(beyond.status, 416, "a span that starts past the end is refused");
  assert.equal(beyond.headers["Content-Range"], "bytes */10000");
  const whole = handle({ method: "GET", path: "/releases/living-us.ota/blocks.bin", headers: { range: "bytes=0-1,5-6" } });
  assert.equal(whole.status, 200, "more than one span is not asked for, and gets the whole file");
  assert.equal(whole.headers["Accept-Ranges"], "bytes");
});

test("the releases are served as files, and nothing outside the folder", () => {
  const { files, handle } = server();
  files.set("living-room-eu/tasmota32-houseweave-living-room-eu.bin", new Uint8Array([1, 2, 3]));
  const got = handle({ method: "GET", path: "/living-room-eu/tasmota32-houseweave-living-room-eu.bin" });
  assert.deepEqual([got.status, got.headers["Content-Type"], [...got.body]], [200, "application/octet-stream", [1, 2, 3]]);
  for (const path of ["/../secret", "/living-room-eu/../../x", "/a//b", "/a\\b", "/%2e%2e/x", "/", "/%E0%A4%A"]) {
    assert.ok([400, 404].includes(handle({ method: "GET", path }).status), `${path} refused`);
  }
});

test("nothing is written, and the panels' backups of an older way are not served", () => {
  const { files, handle } = server();
  files.set("backup/240ac43e51a7.json", new TextEncoder().encode('{"v":1}'));
  assert.equal(handle({ method: "GET", path: "/backup/240ac43e51a7.json" }).status, 404, "a node's configuration is its node's alone");
  for (const method of ["PUT", "POST", "DELETE"]) assert.equal(handle({ method, path: "/living-room-eu/tasmota.bin" }).status, 405, `${method}: a release is never written`);
});

test("the address the nodes find: SERVER_HOST, or the Supervisor's word for the add-on, or none", async () => {
  assert.deepEqual(await serverAddress(8080, { SERVER_HOST: "192.168.2.10" }), { host: "192.168.2.10", port: 8080 });
  assert.deepEqual(await serverAddress(8080, { SERVER_HOST: "house.lan", SERVER_PORT: "9000" }), { host: "house.lan", port: 9000 });
  assert.equal(await serverAddress(8080, {}), null, "neither: no address");
  // the Supervisor: the primary network's address, and the port Home Assistant maps to 8080
  const asked = [];
  const supervisor = (answers) => async (url, opts) => {
    asked.push([url, opts.headers.Authorization]);
    return { json: async () => ({ result: "ok", data: answers[new URL(url).pathname] }) };
  };
  const answers = {
    "/network/info": { interfaces: [{ interface: "wlan0", primary: false, ipv4: { address: ["10.0.0.5/24"] } },
                                    { interface: "eth0", primary: true, ipv4: { address: ["192.168.2.10/24"] } }] },
    "/addons/self/info": { network: { "8080/tcp": 8081 } },
  };
  assert.deepEqual(await serverAddress(8080, { SUPERVISOR_TOKEN: "t" }, supervisor(answers)), { host: "192.168.2.10", port: 8081 });
  assert.deepEqual(asked, [["http://supervisor/network/info", "Bearer t"], ["http://supervisor/addons/self/info", "Bearer t"]]);
  assert.deepEqual(await serverAddress(8080, { SUPERVISOR_TOKEN: "t" }, supervisor({ ...answers, "/addons/self/info": { network: {} } })),
    { host: "192.168.2.10", port: 8080 }, "no word of the port: the one it listens on");
  assert.equal(await serverAddress(8080, { SUPERVISOR_TOKEN: "t" }, supervisor({ ...answers, "/addons/self/info": { network: { "8080/tcp": null } } })),
    null, "the port unmapped in the add-on's Network tab: the panels cannot reach it");
  assert.equal(await serverAddress(8080, { SUPERVISOR_TOKEN: "t" }, async () => { throw new Error("down"); }), null, "no Supervisor: none");
});

test("the add-on copies its integration into Home Assistant's configuration, at its own version, and only when it changed", () => {
  const base = mkdtempSync(join(tmpdir(), "ci-integration-"));
  try {
    const from = join(base, "addon", "houseweave");
    mkdirSync(join(from, "__pycache__"), { recursive: true });
    writeFileSync(join(from, "manifest.json"), JSON.stringify({ domain: "houseweave", version: "1.2.0" }));
    writeFileSync(join(from, "calendar.py"), "# the calendars");
    writeFileSync(join(from, "__pycache__", "calendar.pyc"), "x");
    const ha = join(base, "homeassistant");
    const to = join(ha, "custom_components", "houseweave");
    assert.equal(installIntegration(from, to), "none", "no Home Assistant's folder of integrations: a container beside it");
    assert.equal(installIntegration(from, null), "none");
    mkdirSync(join(ha, "custom_components"), { recursive: true });
    assert.equal(installIntegration(from, to), "copied");
    assert.equal(readFileSync(join(to, "calendar.py"), "utf8"), "# the calendars");
    assert.equal(existsSync(join(to, "__pycache__")), false, "no Python's cache of the add-on's");
    assert.equal(installIntegration(from, to), "current", "the same version is left as it is");
    writeFileSync(join(to, "old.py"), "a file of an older version");
    writeFileSync(join(from, "manifest.json"), JSON.stringify({ domain: "houseweave", version: "1.3.0" }));
    assert.equal(installIntegration(from, to), "copied", "a new version replaces it");
    assert.equal(existsSync(join(to, "old.py")), false, "whole");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the integration the add-on copied under its former domain is taken out, and nothing that is not it", () => {
  const base = mkdtempSync(join(tmpdir(), "ci-integration-"));
  try {
    const components = join(base, "custom_components");
    const former = join(components, FORMER_DOMAIN);
    assert.equal(retireFormerIntegration(components), false, "none there");
    assert.equal(retireFormerIntegration(null), false);
    mkdirSync(former, { recursive: true });
    writeFileSync(join(former, "manifest.json"), JSON.stringify({ domain: "someone_else", version: "1.0.0" }));
    assert.equal(retireFormerIntegration(components), false, "a folder of that name that is another integration stays");
    assert.equal(existsSync(former), true);
    writeFileSync(join(former, "manifest.json"), JSON.stringify({ domain: FORMER_DOMAIN, version: "1.4.0" }));
    assert.equal(retireFormerIntegration(components), true, "this add-on's, under the former domain");
    assert.equal(existsSync(former), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("two ports: the nodes' takes their signed routes and the releases, never the owner's API; the app's takes the owner's API and the releases, read only, from its own addresses", async () => {
  const { files, handle } = server();
  files.set("ota/index.json", new TextEncoder().encode("{}"));
  const asked = [];
  const fleet = {
    handleNode: (req) => (String(req.path).startsWith("/api/hello") ? (asked.push(["node", req.path]), { status: 204, headers: {}, body: new Uint8Array(0) }) : null),
    handleOwner: async (req) => (req.path === "/api/fleet" ? (asked.push(["owner", req.path]), { status: 200, headers: {}, body: new Uint8Array(0) }) : null),
  };
  const api = async (req) => (req.path === "/api/pair" ? (asked.push(["api", req.path]), { status: 200, headers: {}, body: new Uint8Array(0) }) : null);
  const deps = { fleet, api, files: (req) => handle({ method: req.method, path: req.path, headers: req.headers }) };
  const nodes = answerFor("nodes", deps);
  const app = answerFor("app", { ...deps, from: ["172.30.32.2"] });
  const req = (method, path, from = "172.30.32.2") => ({ method, path, headers: {}, body: new Uint8Array(0), length: 0, from });
  assert.equal((await nodes(req("POST", "/api/hello", "192.168.2.111"))).status, 204, "a node's hello, on the nodes' port");
  assert.equal((await nodes(req("GET", "/ota/index.json", "192.168.2.111"))).status, 200, "and the releases");
  for (const [m, p] of [["GET", "/api/fleet"], ["POST", "/api/pair"], ["POST", "/api/node/4/restore"], ["POST", "/api/replace"]]) {
    assert.equal((await nodes(req(m, p, "192.168.2.50"))).status, 404, `the owner's ${p} is not on the nodes' port`);
  }
  assert.equal((await app(req("GET", "/api/fleet"))).status, 200, "the owner's fleet, on the app's port, from the ingress");
  assert.equal((await app(req("POST", "/api/pair"))).status, 200, "and the pairing");
  assert.equal((await app(req("GET", "/ota/index.json"))).status, 200, "and the releases, to read");
  assert.equal((await app(req("POST", "/api/hello"))).status, 404, "a node's route is not on the app's port");
  assert.equal((await app(req("PUT", "/ota/index.json"))).status, 405, "nor any write of a file");
  assert.equal((await app(req("GET", "/api/fleet", "192.168.2.50"))).status, 403, "another address than the ingress's is refused");
  assert.deepEqual(asked, [["node", "/api/hello"], ["owner", "/api/fleet"], ["api", "/api/pair"]], "each part asked only on its own port");
  const open = answerFor("app", deps);
  assert.equal((await open(req("GET", "/api/fleet", "127.0.0.1"))).status, 200, "with no addresses given, the app's port answers whoever reaches it");
});

test("the app on the app's port: its page at the root and its files, then the releases; nothing of it on the nodes' port", async () => {
  const { files, handle } = server();
  files.set("ota/index.json", new TextEncoder().encode("{}"));
  const appFiles = new Map([["index.html", new TextEncoder().encode("<!doctype html><title>HouseWeave</title>")], ["assets/index.js", new TextEncoder().encode("1")]]);
  const appHandle = createHandler({ get: (rel) => appFiles.get(rel) });
  const fleet = { handleNode: () => null, handleOwner: async () => null };
  const deps = { fleet, api: async () => null, files: (req) => handle({ method: req.method, path: req.path, headers: req.headers }) };
  const app = answerFor("app", { ...deps, app: (req) => appHandle({ method: req.method, path: req.path, headers: req.headers }) });
  const nodes = answerFor("nodes", deps);
  const req = (path) => ({ method: "GET", path, headers: {}, body: new Uint8Array(0), length: 0, from: "127.0.0.1" });
  const page = await app(req("/"));
  assert.deepEqual([page.status, page.headers["Content-Type"]], [200, "text/html; charset=utf-8"], "the page, at the root");
  const js = await app(req("/assets/index.js"));
  assert.deepEqual([js.status, js.headers["Content-Type"]], [200, "text/javascript"], "its files, by their own type");
  assert.equal((await app(req("/ota/index.json"))).status, 200, "and the releases, which the app reads");
  assert.equal((await nodes(req("/"))).status, 404, "the nodes' port has no app");
  assert.equal((await nodes(req("/assets/index.js"))).status, 404, "nor its files");
  const bare = answerFor("app", deps);
  const none = await bare(req("/"));
  assert.equal(none.status, 404, "a package without the app says so at the root");
  assert.match(new TextDecoder().decode(none.body), /not in this package/);
});
