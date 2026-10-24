#!/usr/bin/env node
// HouseWeave's server, the house's server: serves a folder over plain HTTP, the releases the nodes update from, and keeps the nodes' backups,
// which a node sends and fetches over HTTP signed with the key of its pair with the server (house-fleet.mjs).
//
//   node ha/houseweave/server/release-server.mjs <folder> [port] [app-port]      (default ports 8080 and 8099)
//
// TWO PORTS, two publics: the nodes' port, on the house's network, serves the releases and the routes the nodes sign (their hello, their
// backup, an answer another node carried); and the app's port serves HouseWeave's app (APP_DIR, the folder app/ beside this one: the compiled
// app, which asks everything at relative addresses), the owner's API (the fleet, a node's verbs, the round, the hardware swap, the pairing) and the
// releases, read only, and nothing a node asks for. The owner's API has no login of its own: the app's port listens on APP_HOST
// (127.0.0.1 unless said), the machine itself, and takes requests only from the addresses in APP_FROM when it is set (the add-on: Home Assistant's
// ingress, 172.30.32.2, which only passes a user logged in to Home Assistant).
//
// It runs on the machine Home Assistant runs on, as an add-on or as a container beside it: the folder above this one is both (config.yaml,
// Dockerfile, README.md).
//
// GET and HEAD serve any file under the folder: the releases the nodes update
// from; a Range of one span (bytes=a-b) gets that part only, as our safeboot and
// the sender of an image over the mesh ask for its blocks, a few KB at a time.
// Nothing under the folder is written, and its backup/, where the panels' backups
// went before, is not served.
//
// The server is a member of the house: paired on a panel by a code, it keeps its identity and the house in its data folder, DATA_DIR
// (for the add-on /data, for a folder <f> on a PC <f>-server beside it), which it does not serve: the OTA tab asks it for that at /api
// (house-pairing.mjs). The nodes' backups are kept there too, by each node's radio address, and the server calls each node at the night's round, at
// the house's time, and when the owner asks on the OTA tab (house-fleet.mjs).
//
// The request handler is exported on its own (createHandler), so the simulator's house runs this same code for its server.
import { createServer } from "node:http";
import { createPublicKey, diffieHellman, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addressFor, createApi, house, identity } from "./house-pairing.mjs";
import { createFleet, MAX_BACKUP } from "./house-fleet.mjs";

const TYPES = {
  ".json": "application/json", ".jsonl": "text/plain", ".be": "text/plain", ".txt": "text/plain",
  // the app's
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".map": "application/json",
};

/**
 * The server's answers, over a storage: `get(rel)` gives a file's bytes or
 * undefined. `rel` is a path under the folder, with forward slashes, checked
 * here: no `..`, no backslash, no empty segment.
 *
 * handle({ method, path, headers }) answers { status, headers, body }:
 * `headers` with their names in lower case.
 */
export function createHandler(storage) {
  return ({ method, path: url, headers }) => {
    let rel;
    try {
      rel = decodeURIComponent(String(url).split("?")[0]).replace(/^\/+/, "");
    } catch {
      return answer(400, "bad path");
    }
    if (rel === "" || rel.includes("\\") || rel.split("/").some((s) => s === "" || s === "." || s === "..")) return answer(404, "not found");
    // the panels' backups of an older way, if the folder still has them: a node's configuration is for its node alone
    if (rel.split("/")[0] === "backup") return answer(404, "not found");
    if (method === "GET" || method === "HEAD") {
      const bytes = storage.get(rel);
      if (bytes === undefined) return answer(404, "not found");
      const type = TYPES[path.extname(rel)] ?? "application/octet-stream";
      // one span of the file (`Range: bytes=a-b`, or `a-`): the sender of an image over the mesh asks for its blocks a few KB at a
      // time, which is what a panel's heap holds
      const range = /^bytes=(\d+)-(\d*)$/.exec(String(headers?.range ?? "").trim());
      if (range) {
        const from = Number(range[1]);
        const to = Math.min(range[2] === "" ? bytes.length - 1 : Number(range[2]), bytes.length - 1);
        if (from >= bytes.length || to < from) {
          return { status: 416, headers: { "Content-Range": `bytes */${bytes.length}`, "Content-Length": "0" }, body: new Uint8Array(0) };
        }
        const part = bytes.subarray(from, to + 1);
        return {
          status: 206,
          headers: { "Content-Type": type, "Content-Length": String(part.length), "Content-Range": `bytes ${from}-${to}/${bytes.length}`, "Accept-Ranges": "bytes" },
          body: method === "HEAD" ? new Uint8Array(0) : part,
        };
      }
      return { status: 200, headers: { "Content-Type": type, "Content-Length": String(bytes.length), "Accept-Ranges": "bytes" }, body: method === "HEAD" ? new Uint8Array(0) : bytes };
    }
    return answer(405, "GET or HEAD");
  };
}

function answer(status, text) {
  const body = new TextEncoder().encode(text + "\n");
  return { status, headers: { "Content-Type": "text/plain", "Content-Length": String(body.length) }, body };
}

/** a folder as the storage: a file read whole, and written whole, beside and then over the old one; and the files of a folder of it */
export function folderStorage(root) {
  const full = (rel) => path.join(root, ...rel.split("/"));
  return {
    list(prefix) {
      const dir = full(prefix.replace(/\/$/, ""));
      return existsSync(dir) ? readdirSync(dir).map((n) => prefix + n) : [];
    },
    get(rel) {
      const f = full(rel);
      return existsSync(f) && statSync(f).isFile() ? new Uint8Array(readFileSync(f)) : undefined;
    },
    put(rel, bytes) {
      const f = full(rel);
      mkdirSync(path.dirname(f), { recursive: true });
      writeFileSync(`${f}.tmp`, bytes);
      renameSync(`${f}.tmp`, f);
    },
  };
}

/**
 * Where the nodes reach this server, {host, port}, or null: SERVER_HOST and
 * SERVER_PORT (the port it listens on by default), or, for the add-on, the
 * Supervisor's word: the machine's address on its primary network, and the
 * port Home Assistant maps to the one this listens on, which the add-on's
 * Network tab may change. The pairing tells the house (house-pairing.mjs).
 * `fetch` and `env` are the process's, or a test's.
 */
export async function serverAddress(listening, env = process.env, get = fetch) {
  if (env.SERVER_HOST) return { host: env.SERVER_HOST, port: Number(env.SERVER_PORT ?? listening) };
  if (!env.SUPERVISOR_TOKEN) return null;
  const ask = async (p) => (await (await get(`http://supervisor${p}`, { headers: { Authorization: `Bearer ${env.SUPERVISOR_TOKEN}` } })).json())?.data;
  try {
    const network = await ask("/network/info");
    const ifaces = network?.interfaces ?? [];
    const iface = ifaces.find((i) => i.primary && i.ipv4?.address?.length) ?? ifaces.find((i) => i.ipv4?.address?.length);
    if (!iface) return null;
    const host = String(iface.ipv4.address[0]).split("/")[0];
    const mapped = (await ask("/addons/self/info"))?.network?.[`${listening}/tcp`];
    // no port mapped: the panels cannot reach this one
    if (mapped === null) return null;
    return { host, port: Number(mapped ?? listening) };
  } catch (e) {
    console.log(`SERVER: no address from the Supervisor (${e.message})`);
    return null;
  }
}

/**
 * The integration this add-on carries (custom_components/houseweave), copied into Home Assistant's
 * custom_components at its own version: `from` is the add-on's copy, `to` Home Assistant's folder of them. Nothing is
 * done without Home Assistant's folder (a container beside Home Assistant Container, where the integration is copied by
 * hand), nor when the version there is this one. Says what it did: "copied", "current" or "none".
 */
export function installIntegration(from, to) {
  if (!existsSync(from) || !to || !existsSync(path.dirname(to))) return "none";
  const version = (dir) => {
    try {
      return JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")).version;
    } catch {
      return null;
    }
  };
  if (existsSync(to) && version(to) === version(from)) return "current";
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true, filter: (p) => !p.includes("__pycache__") });
  return "copied";
}

/**
 * The answer to a request on one of the two ports (`kind`: "nodes" or "app"), from the parts that answer them: `fleet` (house-fleet.mjs), `api`
 * (house-pairing.mjs) and `files` (createHandler). The nodes' port takes the nodes' signed routes and the releases, and refuses the owner's API; the
 * app's port takes the owner's API and the releases, read only, from the addresses in `from` (none: any that reaches it), and none of the nodes'
 * routes. `req` is {method, path, headers, body, length, from}.
 */
export function answerFor(kind, { fleet, api, files, app = null, from = [] }) {
  const refused = (status, text) => {
    const body = new TextEncoder().encode(text + "\n");
    return { status, headers: { "Content-Type": "text/plain", "Content-Length": String(body.length) }, body };
  };
  return async (req) => {
    const rel = String(req.path).split("?")[0];
    const owner = rel === "/api" || rel.startsWith("/api/");
    if (kind === "nodes") {
      const a = fleet.handleNode(req);
      if (a) return a;
      // the owner's API is the app's port's alone
      if (owner) return refused(404, "not here: the owner's API is on the app's port");
      return files(req);
    }
    if (from.length > 0 && !from.includes(req.from)) return refused(403, "the app's port answers Home Assistant's ingress alone");
    if (owner) {
      const a = (await fleet.handleOwner(req)) ?? (await api(req));
      if (a) return a;
      return refused(404, "no such route of the owner's");
    }
    if (req.method !== "GET" && req.method !== "HEAD") return refused(405, "GET or HEAD");
    // the app first, its page at the root; then the releases
    if (app) {
      const page = rel === "/" || rel === "" ? { ...req, path: "/index.html" } : req;
      const a = app(page);
      if (a.status !== 404) return a;
    }
    if (rel === "/" || rel === "") return refused(404, "HouseWeave's app is not in this package: the package script builds it into app/");
    return files(req);
  };
}

/** a post to a node (its /houseweave/do): its answer's JSON. A node answers at once, or is not there */
async function postNode(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  return r.json();
}

async function main() {
  const root = process.argv[2];
  const port = Number(process.argv[3] ?? 8080);
  const appPort = Number(process.argv[4] ?? process.env.APP_PORT ?? 8099);
  if (!root || !existsSync(root) || !statSync(root).isDirectory() || appPort === port) {
    console.error("usage: node ha/houseweave/server/release-server.mjs <folder> [port] [app-port]   (two ports: the nodes' and the app's)");
    process.exit(2);
  }
  // the integration, into Home Assistant's configuration, which the add-on maps at /homeassistant: the add-on's copy is beside this folder
  const integration = installIntegration(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "custom_components", "houseweave"),
    process.env.HA_CONFIG === "" ? null : path.join(process.env.HA_CONFIG ?? "/homeassistant", "custom_components", "houseweave"));
  if (integration === "copied") console.log("INTEGRATION: copied into Home Assistant: restart it, then add HouseWeave in Devices & services");
  if (integration === "current") console.log("INTEGRATION: Home Assistant has this version");
  // where the nodes reach this one, and its data, which it does not serve (house-pairing.mjs)
  const given = await serverAddress(port);
  const dataDir = process.env.DATA_DIR ?? path.join(path.dirname(path.resolve(root)), path.basename(path.resolve(root)) + "-server");
  const api = createApi({ dir: dataDir, address: (panelHost) => addressFor(panelHost ?? "", given, port) });
  // the house's nodes: the server's X25519 with a node's key, their backups in the data folder, and the night's round (house-fleet.mjs)
  const me = identity(dataDir);
  const fleet = createFleet({
    shared: (pub) => {
      try {
        const spki = Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), Buffer.from(pub)]);
        return new Uint8Array(diffieHellman({ privateKey: me.key, publicKey: createPublicKey({ key: spki, format: "der", type: "spki" }) }));
      } catch {
        return null;
      }
    },
    random: (n) => new Uint8Array(randomBytes(n)),
    store: folderStorage(dataDir),
    house: () => house(dataDir),
    post: postNode,
    log: console.log,
  });
  setInterval(() => fleet.tick(), 30000);
  const handle = createHandler(folderStorage(root));
  const files = (req) => handle({ method: req.method, path: req.path, headers: req.headers });
  // the compiled app, beside this folder unless APP_DIR says another
  const appDir = process.env.APP_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app");
  const appFiles = existsSync(path.join(appDir, "index.html")) ? createHandler(folderStorage(appDir)) : null;
  const app = appFiles ? (req) => appFiles({ method: req.method, path: req.path, headers: req.headers }) : null;
  const serve = (kind, answer) => createServer((req, res) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size <= MAX_BACKUP + 1) chunks.push(c);
    });
    req.on("end", async () => {
      const body = new Uint8Array(Buffer.concat(chunks));
      const from = String(req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
      const a = await answer({ method: req.method, path: req.url, headers: req.headers, body, length: size, from });
      res.writeHead(a.status, a.headers).end(Buffer.from(a.body));
      const stamp = new Date().toISOString().slice(11, 19);
      console.log(`${stamp} ${kind} ${req.socket.remoteAddress} ${req.method} ${req.url} -> ${a.status}`);
    });
  });
  const appHost = process.env.APP_HOST ?? "127.0.0.1";
  const appFrom = String(process.env.APP_FROM ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  serve("nodes", answerFor("nodes", { fleet, api, files })).listen(port, () =>
    console.log(`serving ${path.resolve(root)} to the nodes on port ${port}; its house and the nodes' backups in ${dataDir}`));
  serve("app", answerFor("app", { fleet, api, files, app, from: appFrom })).listen(appPort, appHost, () =>
    console.log(`the app's port: ${appHost}:${appPort}${appFrom.length ? `, from ${appFrom.join(", ")} only` : ""}; the app ${app ? `from ${appDir}` : "not in this package"}`));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
