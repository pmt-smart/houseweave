// The release server as a member of the house: its identity, its pairing on a panel, and the house it keeps.
//
// The server has an X25519 key pair of its own, made once and kept in its data folder (DATA_DIR, outside the folder it serves): the public half is its
// credential in the house's list, as every node's is. A panel's mesh page opens Add server, a window with a code of 6 digits and the panel's address; the owner
// types both on the OTA tab, which asks this server to pair: it posts to the panel's /houseweave/pair its key, its address and port, its name and a nonce,
// with the HMAC-SHA256 of those under the code, and the panel, whose code checks it, writes the server into the house's list and answers with the server's
// number, the house's name and the nodes of its mesh, with an HMAC under the code too (berry/house_server.be says the two messages). The code never goes on
// the network. A panel on the firmware before these names has /casa/pair and says "casa" in the labels (house-fleet.mjs, FORMER): it is posted to there when
// it has no route of the current names.
//
// The house is kept in the data folder as house.json: {"node", "house", "panel", "panelHost", "nodes", "paired"}. The routes, under /api:
//   GET  /api/status   {"key", "address": {"host", "port"} or null, "house": the house kept, or null}
//   POST /api/pair     {"panel": its address, "code": the 6 digits} -> the house kept, or {"error"}
import { createHmac, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** the server's name in the house, when nothing else says it */
export const NAME = "Home Assistant";
/** how long the panel is waited for */
export const PAIR_MS = 8000;

/** HMAC-SHA256 of the text `msg` under the text `key`, in lower-case hex: the panel's (HouseServer.hmac) */
export const hmac = (key, msg) => createHmac("sha256", Buffer.from(key, "utf8")).update(Buffer.from(msg, "utf8")).digest("hex");

/** the server's identity, made the first time in `dir`: the public half as 64 hex, and the key */
export function identity(dir) {
  const file = path.join(dir, "server-x25519.pem");
  let key;
  if (existsSync(file)) {
    key = createPrivateKey(readFileSync(file, "utf8"));
  } else {
    mkdirSync(dir, { recursive: true });
    key = generateKeyPairSync("x25519").privateKey;
    writeFileSync(file, key.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
  }
  const der = createPublicKey(key).export({ type: "spki", format: "der" });
  return { key, public: der.subarray(der.length - 32).toString("hex") };
}

/** the panel's route and the labels' word: the firmware's, and the one before it */
export const PAIRING = { route: "/houseweave/pair", label: "houseweave" };
export const FORMER_PAIRING = { route: "/casa/pair", label: "casa" };

/** what the server posts to the panel, proved by the code */
export function pairRequest({ key, host, port, name, code, nonce }, names = PAIRING) {
  return { v: 1, key, host, port, name, nonce, mac: hmac(code, `${names.label}-pair-1|${key}|${host}|${port}|${name}|${nonce}`) };
}

/** whether the panel's answer is the panel's: its HMAC under the code */
export function welcomeChecks(answer, code, nonce, names = PAIRING) {
  if (!answer || typeof answer !== "object" || !Number.isInteger(answer.node) || typeof answer.house !== "string" || typeof answer.mac !== "string") return false;
  return answer.mac.toLowerCase() === hmac(code, `${names.label}-pair-2|${nonce}|${answer.node}|${answer.house}`);
}

/** the address this server is reached at by a panel at `panelHost`: the one given (SERVER_HOST, the Supervisor's), else this machine's on the panel's network */
export function addressFor(panelHost, given, listening, ifaces = os.networkInterfaces()) {
  if (given) return given;
  const net24 = (a) => String(a).split(".").slice(0, 3).join(".");
  const own = Object.values(ifaces).flat().filter((i) => i && i.family === "IPv4" && !i.internal);
  const same = own.find((i) => net24(i.address) === net24(panelHost)) ?? own[0];
  return same ? { host: same.address, port: listening } : null;
}

/** the house kept, or null */
export function house(dir) {
  try {
    return JSON.parse(readFileSync(path.join(dir, "house.json"), "utf8"));
  } catch {
    return null;
  }
}

/** The pairing on the panel at `panel` with `code`: the house kept, or {error}. `post(url, body)` posts JSON and gives the answer's JSON (fetch, unless a test's) */
export async function pair({ panel, code, dir, address, name = NAME, post = postJson, nonce = randomBytes(8).toString("hex"), now = () => new Date() }) {
  if (!/^\d{6}$/.test(String(code ?? ""))) return { error: "the code is the 6 digits on the panel" };
  if (!/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(String(panel ?? ""))) return { error: "the panel's address, as its screen says it" };
  if (!address) return { error: "no address of this server for the panel: set SERVER_HOST" };
  const me = identity(dir);
  let answer;
  let names;
  for (names of [PAIRING, FORMER_PAIRING]) {
    try {
      answer = await post(`http://${panel}${names.route}`, pairRequest({ key: me.public, host: address.host, port: address.port, name, code, nonce }, names));
    } catch (e) {
      return { error: `the panel did not answer (${e.message})` };
    }
    if (answer?.error !== "no such route") break;
  }
  if (answer?.error) {
    const why = { closed: "the panel's window is closed: open Add server on it", code: "the code is not the panel's", request: "the panel refused the request",
                  house: "the panel could not add it to its house" };
    return { error: why[answer.error] ?? answer.error };
  }
  if (!welcomeChecks(answer, code, nonce, names)) return { error: "the answer is not the panel's" };
  const kept = { node: answer.node, house: answer.house, panel: answer.panel, panelHost: String(panel).split(":")[0], nodes: answer.nodes ?? [],
                 paired: now().toISOString() };
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "house.json");
  writeFileSync(file + ".tmp", JSON.stringify(kept, null, 2) + "\n");
  renameSync(file + ".tmp", file);
  return kept;
}

async function postJson(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(PAIR_MS) });
  return r.status === 404 ? { error: "no such route" } : r.json();
}

/** The routes under /api: an answer {status, headers, body}, or null for a path that is not one of them. `address(panelHost)` gives this server's */
export function createApi({ dir, address, post }) {
  const json = (status, value) => ({ status, headers: { "Content-Type": "application/json" }, body: new Uint8Array(Buffer.from(JSON.stringify(value))) });
  return async ({ method, path: url, body }) => {
    const rel = String(url).split("?")[0];
    if (!rel.startsWith("/api/")) return null;
    if (rel === "/api/status" && method === "GET") {
      return json(200, { key: identity(dir).public, address: address(null), house: house(dir) });
    }
    if (rel === "/api/pair" && method === "POST") {
      let ask;
      try {
        ask = JSON.parse(Buffer.from(body ?? []).toString("utf8"));
      } catch {
        return json(400, { error: "a JSON body: {panel, code}" });
      }
      const panelHost = String(ask?.panel ?? "").split(":")[0];
      const r = await pair({ panel: ask?.panel, code: ask?.code, dir, address: address(panelHost), name: ask?.name ?? NAME, post });
      return json(r.error ? 409 : 200, r);
    }
    return json(404, { error: "no such route" });
  };
}
