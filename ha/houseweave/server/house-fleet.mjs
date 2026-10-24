// The house's nodes on its server: the nodes it knows, each by the key of its pair with the server, their requests checked, their backups
// kept, and the server's own requests to them -- the night's round at the house's time, and the owner's Backup, Upgrade and State, for a node or all.
//
// It is the server's side of the protocol in one place, without Node's modules, so the release server (release-server.mjs) and the simulator's tests run
// the same code: what differs is given -- the X25519 of the server's secret with a node's public key (`shared`), random bytes, the storage, the clock, the
// house kept at the pairing (house-pairing.mjs), and the post to a node. SHA-256, HMAC and HKDF are here, in plain JavaScript, and the tests pin them to
// node:crypto and to the node's own (berry/server_link.be, the mesh driver's espnow_mesh_pair_key).
//
// THE PAIR'S KEY of a node is HKDF-SHA256(salt "houseweave-server", the X25519 of the two, info "http", 32 bytes): the node's driver derives the same.
// THE NODE'S REQUESTS carry X-HouseWeave-Node, X-HouseWeave-Time and X-HouseWeave-Mac, the HMAC under the key of "method|path|time|the SHA-256 of the
// body in hex": taken within TIME_S of the server's clock, and once when it writes. THE SERVER'S REQUESTS go to the node's POST /houseweave/do, JSON
// {"v": 1, "verb", "t", "nonce", "mac": the HMAC of "houseweave-do|verb|t|node|nonce"}, and the node answers with what the verb did and its state.
//
// THE FORMER NAMES (FORMER): the firmware before these names said "casa" where they say "houseweave" (the salt, the headers, the route and the
// signed labels). A node on it is taken and called in its names until the house runs the current firmware: its requests say which names it speaks; a
// node the server knew before the names changed is called in the former ones until it is heard, and one it learnt of since in the current ones; and a
// node called at a route it does not have is called again in the other names.
//
// The nodes' routes, signed:
//   POST /api/hello     a node's word, on an event (its start, a backup, an upgrade): its state and its backup's, and a panel's the house's nodes
//   PUT  /api/backup    its backup, kept by its radio address (backups/<mac>.json), the nine before it beside it, .1 the newest
//   GET  /api/backup    its backup, or 404
//   POST /api/relayed   another node's answer to a request it relayed over the mesh, signed by that node: {"to", "nonce", "mac", "answer"}
// The OTA tab's:
//   GET  /api/fleet               the round's time, the last round, what runs, and each node: its state, its backup, the last thing asked of it
//   PUT  /api/round               {"time": "HH:MM"}: the round's time, in the house's
//   POST /api/round/now           the round, now
//   POST /api/node/<n>/<verb>     the verb (backup, upgrade, state, restore) asked of node n, and its answer
//   POST /api/all/<verb>          the verb (backup, upgrade, state) asked of every node in turn, a few seconds apart
//   POST /api/replace             {"from": a backup's radio address, "to": a node}: the hardware swap, the node restoring that backup
//
// THE HARDWARE SWAP: a node that replaces another (a panel or a bridge that died) joins the house as any node, and the owner gives it the old one's
// backup here. The server keeps the swap, asks the new node to restore, and gives it the old one's backup when it asks for its own, with "for" and the
// new node's name (a node takes no backup of another name but so); the new node's first backup of its own ends the swap. Its own backup before the
// swap stays, and its Restore brings it back.
//
// THE RELAY (the second stage): a node the server does not reach (no address, or no answer: behind another router, or with no Wi-Fi) gets its
// request through another node that the server reached last, over the mesh: the server posts that node the verb "relay", signed for it, with "to" and
// "req", the request signed for the node, with the same nonce; the node in between says "Sent", and posts the node's answer to /api/relayed when it
// comes, signed under the node's own key (the HMAC of "houseweave-done|nonce|answer"), which the server checks. The answer has RELAY_MS to come; a node in
// between that does not take the request gives way to the next one (GATEWAYS of them).
//
// THE ROUND: once a night, in the hour from its time (02:00 unless the owner sets another), the server asks each node in turn for its state, and a
// node whose configuration changed since its last backup backs up; a node that did not answer is asked once more a minute after the last (a node can
// miss a call and answer at once later). Nothing else is periodic: the nodes speak on events, and the owner asks.

/** how far a request's time may be from the server's clock, in seconds */
export const TIME_S = 600;
/** the largest backup taken */
export const MAX_BACKUP = 64 * 1024;
/** the versions of a backup kept: the one there and the nine before it */
export const BACKUP_VERSIONS = 10;
/** the round's time when the owner set none */
export const ROUND = "02:00";
/** the round starts in this many minutes from its time, or waits for the next night */
export const ROUND_WINDOW_MIN = 60;
/** between one node and the next, in a round or an "all" */
export const ROUND_GAP_MS = 5000;
/** a node that did not answer, in a round or an "all", is asked again this long after the last */
export const RETRY_MS = 60000;
/** a request relayed over the mesh waits this long for its answer, looking every RELAY_STEP_MS */
export const RELAY_MS = 20000;
export const RELAY_STEP_MS = 500;
/** the nodes tried in turn to relay a request, the ones the server reached last first */
export const GATEWAYS = 2;
/** what the owner asks of a node */
export const VERBS = ["backup", "upgrade", "state"];
/** what the owner asks of one node: those, and the restore of its backup */
export const NODE_VERBS = [...VERBS, "restore"];
const ROLES = { 1: "bridge", 2: "panel", 3: "server" };
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** the protocol's names: the salt of the pair's key, the prefix of the node's headers, the server's route on the node and its signed labels' word */
export const CURRENT = { id: "current", salt: "houseweave-server", header: "x-houseweave-", route: "/houseweave/do", label: "houseweave" };
/** the ones of the firmware before them, taken until every node of the house runs the current firmware */
export const FORMER = { id: "former", salt: "casa-server", header: "x-casa-", route: "/casa/do", label: "casa" };

// --- SHA-256 (FIPS 180-4), HMAC (RFC 2104), HKDF (RFC 5869) ------------------------------------------------------------------------------

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);

/** SHA-256 of bytes */
export function sha256(data) {
  const l = data.length;
  const n = (((l + 9) + 63) >> 6) << 6;
  const m = new Uint8Array(n);
  m.set(data);
  m[l] = 0x80;
  const v = new DataView(m.buffer);
  v.setUint32(n - 8, Math.floor(l / 0x20000000));
  v.setUint32(n - 4, (l * 8) >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const ror = (x, r) => (x >>> r) | (x << (32 - r));
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = v.getUint32(o + 4 * i);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15];
      const b = w[i - 2];
      w[i] = w[i - 16] + (ror(a, 7) ^ ror(a, 18) ^ (a >>> 3)) + w[i - 7] + (ror(b, 17) ^ ror(b, 19) ^ (b >>> 10));
    }
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) | 0;
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      k = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += k;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(4 * i, h[i]);
  return out;
}

/** HMAC-SHA256 of bytes under a key of bytes */
export function hmac(key, data) {
  const k = key.length > 64 ? sha256(key) : key;
  const inner = new Uint8Array(64 + data.length);
  const outer = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) {
    const b = i < k.length ? k[i] : 0;
    inner[i] = b ^ 0x36;
    outer[i] = b ^ 0x5c;
  }
  inner.set(data, 64);
  outer.set(sha256(inner), 64);
  return sha256(outer);
}

/** HKDF-SHA256: `length` bytes */
export function hkdf(salt, ikm, info, length) {
  const prk = hmac(salt, ikm);
  const out = new Uint8Array(length);
  let t = new Uint8Array(0);
  for (let i = 1, at = 0; at < length; i++, at += 32) {
    const m = new Uint8Array(t.length + info.length + 1);
    m.set(t);
    m.set(info, t.length);
    m[m.length - 1] = i;
    t = hmac(prk, m);
    out.set(t.subarray(0, Math.min(32, length - at)), at);
  }
  return out;
}

export const utf8 = (s) => new TextEncoder().encode(String(s));
export const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export function fromHex(s) {
  const t = String(s);
  if (!/^([0-9a-fA-F]{2})*$/.test(t)) return new Uint8Array(0);
  return Uint8Array.from(t.match(/../g) ?? [], (x) => parseInt(x, 16));
}

/** two texts compared whole, whatever they differ in */
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** the key of the server's pair with a node, from `shared` (the X25519 of the server's secret with a public key: bytes, or null), or null */
export function pairKey(shared, nodePublicHex, names = CURRENT) {
  const pub = fromHex(nodePublicHex);
  const z = pub.length === 32 ? shared(pub) : null;
  return z ? hkdf(utf8(names.salt), z, utf8("http"), 32) : null;
}

/** the X-HouseWeave-Mac of a node's request */
export function requestMac(key, method, path, time, body) {
  return hex(hmac(key, utf8(`${method}|${path}|${time}|${hex(sha256(body ?? new Uint8Array(0)))}`)));
}

/** the server's request to a node, signed */
export function doRequest(key, node, verb, t, nonce, names = CURRENT) {
  return { v: 1, verb, t, nonce, mac: hex(hmac(key, utf8(`${names.label}-do|${verb}|${t}|${node}|${nonce}`))) };
}

/** the signature of a node's answer to a request relayed over the mesh */
export function doneMac(key, nonce, answer, names = CURRENT) {
  return hex(hmac(key, utf8(`${names.label}-done|${nonce}|${answer}`)));
}

function json(status, value) {
  return { status, headers: { "Content-Type": "application/json" }, body: utf8(JSON.stringify(value)) };
}
function text(status, t) {
  const body = utf8(t + "\n");
  return { status, headers: { "Content-Type": "text/plain", "Content-Length": String(body.length) }, body };
}
const none = () => ({ status: 204, headers: { "Content-Length": "0" }, body: new Uint8Array(0) });

/** what a node said to a verb, without the answer's frame and its state: {"backup": "Saving"}, the round's included, or {"error"} */
export function said(a) {
  if (a === null || typeof a !== "object") return {};
  const { v: _v, node: _n, verb: _verb, state: _s, ...rest } = a;
  return rest;
}

/** the minutes of the day, in this machine's time: the house's, as Home Assistant's add-on runs in its zone */
const localMinutes = (ms) => {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
};

/**
 * The server's side of the house's nodes.
 *   shared(pub)       the X25519 of the server's secret with a node's public key (32 bytes), or null
 *   random(n)         n random bytes
 *   store             get(rel) -> bytes or undefined, put(rel, bytes): the data folder, which the server does not serve
 *   house()           the house kept at the pairing ({node, house, nodes: [[n, role, name, address, key, mac]], paired}), or null
 *   post(url, body)   posts JSON to a node and gives its answer's JSON (a Promise)
 *   now()             the clock, in ms of the Unix time; minutes(ms) the minutes of the day in the house's time; wait(ms) a Promise
 */
export function createFleet({ shared, random, store, house = () => null, post, now = () => Date.now(), minutes = localMinutes,
                              wait = (ms) => new Promise((r) => setTimeout(r, ms)), log = () => {} }) {
  let state = { v: 1, round: ROUND, lastRound: null, paired: null, nodes: {}, swaps: {}, replaced: {} };
  try {
    const kept = JSON.parse(new TextDecoder().decode(store.get("fleet.json")));
    if (kept && kept.v === 1 && typeof kept.nodes === "object") state = { ...state, ...kept };
  } catch {
    // none kept yet
  }
  const seen = new Map();   // the macs of the nodes' requests taken, until their time is past
  const relayed = new Map(); // nonce -> {node, key, answer}: a request relayed over the mesh, waiting for its answer
  let running = null;       // {verb, done, total} while a round or an "all" runs

  const save = () => store.put("fleet.json", utf8(JSON.stringify(state, null, 2) + "\n"));

  // a node of the house's list, as the pairing and a panel's hello give it: [number, role, name, address, public key, radio address]
  const learn = (n) => {
    if (!Array.isArray(n) || !Number.isInteger(n[0]) || n[1] === 3 || !/^[0-9a-f]{64}$/i.test(String(n[4]))) return null;
    const old = state.nodes[n[0]];
    const key = String(n[4]).toLowerCase();
    const kept = old && old.key === key ? old : { names: CURRENT.id };
    state.nodes[n[0]] = { ...kept, node: n[0], role: ROLES[n[1]] ?? "node", name: String(n[2] ?? ""), ip: String(n[3] ?? ""), key,
                          mac: String(n[5] ?? "").toLowerCase() };
    return n[0];
  };

  // the house paired again: its nodes are the new pairing's
  const sync = () => {
    const h = house();
    if (!h || h.paired === state.paired) return;
    state.paired = h.paired;
    state.nodes = {};
    for (const n of h.nodes ?? []) learn(n);
    save();
  };
  sync();

  // a node's address: the one its last hello came from, or the list's; none while its hellos come carried over the mesh
  const where = (rec) => (rec.carried ? null : rec.from || rec.ip);

  // the names a node speaks: the ones of its last request taken or of its last answer, the current ones for a node learnt of since they changed,
  // and the former ones for a node kept from before
  const namesOf = (rec) => (rec.names === CURRENT.id ? CURRENT : FORMER);

  // a node's request, checked: its record, or the answer that refuses it. Its headers say the names it speaks
  const check = ({ method, path, headers, body }) => {
    const h = Object.fromEntries(Object.entries(headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const names = h[CURRENT.header + "node"] !== undefined ? CURRENT : FORMER;
    const n = Number(h[names.header + "node"]);
    const rec = Number.isInteger(n) ? state.nodes[n] : undefined;
    if (!rec) return [null, text(401, "a node of the house's")];
    const s = Math.floor(now() / 1000);
    const t = Number(h[names.header + "time"]);
    if (!Number.isInteger(t) || Math.abs(s - t) > TIME_S) return [null, text(401, "the node's clock is off")];
    const key = pairKey(shared, rec.key, names);
    const mac = String(h[names.header + "mac"] ?? "").toLowerCase();
    if (!key || !same(requestMac(key, method, String(path), t, body), mac)) return [null, text(401, "not the node's signature")];
    // a request that writes is taken once; a read again in the same second is the same read (a look, then the restore)
    if (method !== "GET" && method !== "HEAD") {
      for (const [m, until] of seen) if (until < s) seen.delete(m);
      if (seen.has(mac)) return [null, text(401, "a request taken already")];
      seen.set(mac, s + TIME_S);
    }
    rec.names = names.id;
    return [rec, null];
  };

  // what the server keeps of a node's backup: its moment, its size and its versions
  const kept = (rec) => {
    const rel = `backups/${rec.mac}.json`;
    const b = store.get(rel);
    if (b === undefined) return null;
    let at = null;
    try {
      at = JSON.parse(new TextDecoder().decode(b)).at ?? null;
    } catch {
      // kept as it came
    }
    let versions = 1;
    while (versions < BACKUP_VERSIONS && store.get(`${rel}.${versions}`) !== undefined) versions++;
    return { at, size: b.length, versions };
  };

  /** A node's request: the answer, or null for a path that is none of the nodes' */
  function handleNode(req) {
    const rel = String(req.path).split("?")[0];
    if (rel !== "/api/hello" && rel !== "/api/backup" && rel !== "/api/relayed") return null;
    sync();
    const [rec, refused] = check(req);
    if (refused) return refused;
    const body = req.body ?? new Uint8Array(0);
    if (rel === "/api/relayed") {
      if (req.method !== "POST") return text(405, "POST of a relayed answer");
      let m;
      try {
        m = JSON.parse(new TextDecoder().decode(body));
      } catch {
        return text(400, "not JSON");
      }
      // an answer to a request the server relayed, signed by the node it was for: from whichever node of the house brings it, since one asked
      // before may bring it while another is waited on
      const p = relayed.get(String(m?.nonce));
      if (!p || p.node !== m.to || p.answer !== null || typeof m.answer !== "string") return text(404, "no such request relayed");
      if (!same(doneMac(p.key, m.nonce, m.answer, p.names), String(m.mac ?? "").toLowerCase())) return text(401, "not the node's signature");
      let a;
      try {
        a = JSON.parse(m.answer);
      } catch {
        return text(400, "the answer is not JSON");
      }
      p.answer = a !== null && typeof a === "object" ? a : { error: "no answer" };
      p.via = rec.node;
      return none();
    }
    if (rel === "/api/hello" && req.method === "POST") {
      let m;
      try {
        m = JSON.parse(new TextDecoder().decode(body));
      } catch {
        return text(400, "not JSON");
      }
      rec.seen = now();
      rec.kind = String(m?.kind ?? "");
      rec.state = { role: m?.role, image: m?.image, build: m?.build, date: m?.date, backup: m?.backup ?? null };
      // its address; or, when another node carried the hello for it over the mesh (berry/mesh_http.be), none: the carrier's is not the node's, and
      // the one it had answers no more, so the server asks it through another at once, until a hello of its own
      const via = Object.entries(req.headers ?? {}).some(([k]) => [CURRENT, FORMER].some((names) => k.toLowerCase() === names.header + "via"));
      if (via) rec.carried = true;
      else if (req.from) {
        rec.from = req.from;
        delete rec.carried;
      }
      // a panel's hello has the house's nodes: the ones the list has, as it has them now
      if (rec.role === "panel" && Array.isArray(m?.nodes) && m.nodes.length > 0) {
        const ids = new Set(m.nodes.map(learn).filter((x) => x !== null));
        if (ids.has(rec.node)) for (const n of Object.keys(state.nodes)) if (!ids.has(Number(n))) delete state.nodes[n];
      }
      save();
      return none();
    }
    const file = `backups/${rec.mac}.json`;
    if (req.method === "GET") {
      // in a swap, the old one's, given to this node by its name
      const swap = state.swaps?.[rec.node];
      if (swap) {
        const old = store.get(`backups/${swap.from}.json`);
        if (old === undefined) return text(404, "no backup of the node it replaces");
        const doc = JSON.parse(new TextDecoder().decode(old));
        doc.for = rec.mac;
        const b = utf8(JSON.stringify(doc));
        return { status: 200, headers: { "Content-Type": "application/json", "Content-Length": String(b.length) }, body: b };
      }
      const b = store.get(file);
      return b === undefined ? text(404, "no backup of this node") : { status: 200, headers: { "Content-Type": "application/json", "Content-Length": String(b.length) }, body: b };
    }
    if (req.method !== "PUT") return text(405, "GET or PUT of the node's backup");
    if ((req.length ?? body.length) > MAX_BACKUP) return text(413, `a backup is at most ${MAX_BACKUP} bytes`);
    let doc;
    try {
      doc = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    } catch {
      return text(400, "not JSON");
    }
    if (doc === null || typeof doc !== "object" || Array.isArray(doc) || doc.v !== 1 || (typeof doc.panel !== "string" && typeof doc.bridge !== "string") ||
        doc.keys === null || typeof doc.keys !== "object" || Array.isArray(doc.keys)) {
      return text(400, "not a backup of a node");
    }
    // the ones before it move one back, .1 the newest, and the oldest past the tenth version is written over
    const before = store.get(file);
    if (before !== undefined) {
      for (let i = BACKUP_VERSIONS - 2; i >= 1; i--) {
        const older = store.get(`${file}.${i}`);
        if (older !== undefined) store.put(`${file}.${i + 1}`, older);
      }
      store.put(`${file}.1`, before);
    }
    store.put(file, new Uint8Array(body));
    rec.saved = now();
    // the node's own backup: a swap it was in is over
    if (state.swaps?.[rec.node]) {
      log(`FLEET: node ${rec.node} (${rec.name}) took the backup of ${state.swaps[rec.node].from}`);
      delete state.swaps[rec.node];
    }
    save();
    log(`FLEET: the backup of node ${rec.node} (${rec.name}), ${body.length} bytes`);
    return none();
  }

  // a request posted to a node, at the route of the names it is signed in: its answer, or {error}, "no such route" from a node that speaks the
  // other names
  async function call(addr, body, names) {
    let a;
    try {
      a = await post(`http://${addr}${names.route}`, body);
    } catch (e) {
      a = { error: `no answer (${e.message})` };
    }
    return a !== null && typeof a === "object" ? a : { error: "no answer" };
  }

  // A request to a node at its address, `signed(names)`, in the names it speaks, and in the other ones when it has no route of those. [its answer,
  // the names it went in]; a node that answers speaks them
  async function callNode(rec, signed) {
    const order = namesOf(rec) === CURRENT ? [CURRENT, FORMER] : [FORMER, CURRENT];
    let a;
    for (const names of order) {
      a = await call(where(rec), signed(names), names);
      if (!a.error) rec.names = names.id;
      if (a.error !== "no such route") return [a, names];
    }
    return [a, order[0]];
  }

  // the nodes that may relay a request for node n: the ones the server reached last, then the ones it heard from last
  const gateways = (n) => Object.values(state.nodes).filter((r) => r.node !== n && where(r) && (r.reached || r.seen))
    .sort((a, b) => (b.reached ?? 0) - (a.reached ?? 0) || (b.seen ?? 0) - (a.seen ?? 0)).slice(0, GATEWAYS);

  // The server's request for node n, `req`, given to node g to take over the mesh, with the request's own nonce: "sent" when g took it, "refused"
  // when g said it would not, and "unknown" when the call came to no answer, which says nothing of whether g took it (as seen on the bench)
  async function relay(g, n, req) {
    if (!pairKey(shared, g.key)) return "refused";
    const [r] = await callNode(g, (names) => ({ ...doRequest(pairKey(shared, g.key, names), g.node, "relay", req.t, req.nonce, names), to: n, req }));
    if (!r.error && r.relay === "Sent") {
      g.reached = now();
      return "sent";
    }
    log(`FLEET: node ${g.node} (${g.name}) did not relay to node ${n}: ${JSON.stringify(said(r))}`);
    return r.error?.startsWith("no answer") ? "unknown" : "refused";
  }

  // Node n's request through the others, one after another while no answer comes: {a: the answer, via: the node that brought it}, {a: {error}}
  // when one took it, or may have, and none came, or null when none did. The wait is open before the first is called, and an answer is taken from
  // whichever of them brings it: the signature checked is node n's, in the names its request is in
  async function through(n, key, req, names) {
    const p = { node: n, key, names, answer: null, via: null };
    relayed.set(req.nonce, p);
    const tried = [];
    try {
      for (const g of gateways(n)) {
        if (p.answer !== null) break;
        if ((await relay(g, n, req)) === "refused") continue;
        tried.push(g.node);
        for (let waited = 0; waited < RELAY_MS && p.answer === null; waited += RELAY_STEP_MS) await wait(RELAY_STEP_MS);
      }
    } finally {
      relayed.delete(req.nonce);
    }
    if (p.answer !== null) return { a: p.answer, via: p.via };
    return tried.length > 0 ? { a: { error: `no answer (through node ${tried.join(" and node ")})` }, via: null } : null;
  }

  /** A verb asked of node n: its answer, or {error}. A node the server does not reach is asked through another, over the mesh */
  async function ask(n, verb) {
    const rec = state.nodes[n];
    if (!rec) return { error: "no such node" };
    if (!pairKey(shared, rec.key)) return { error: "no pair with it" };
    // one request, with one nonce, whichever way it goes: the node runs it once, and to the same request again says "again"
    const t = Math.floor(now() / 1000);
    const nonce = hex(random(8));
    const signed = (names) => doRequest(pairKey(shared, rec.key, names), n, verb, t, nonce, names);
    let [a, names] = where(rec) ? await callNode(rec, signed) : [{ error: "no address" }, namesOf(rec)];
    let via = null;
    if (!a.error) rec.reached = now();
    if (a.error === "no address" || a.error?.startsWith("no answer")) {
      const r = await through(n, pairKey(shared, rec.key, names), signed(names), names);
      if (r !== null) {
        a = r.a;
        via = r.via;
      }
    }
    // "again": the node took the request on a way whose answer was lost (a call that timed out, another neighbour's), so it ran; its state says how
    if (a.error === "again") {
      const s = await ask(n, "state");
      a = { v: 1, node: n, verb, again: true, ...(s.state ? { state: s.state } : {}) };
    }
    if (a.error === "no address") return a;
    rec.did = { verb, at: now(), answer: a, ...(via !== null ? { via } : {}) };
    if (!a.error && a.state && typeof a.state === "object") {
      rec.state = { ...(rec.state ?? {}), ...a.state };
      rec.seen = now();
    }
    save();
    log(`FLEET: ${verb} to node ${n} (${rec.name})${via !== null ? ` through node ${via}` : ""}: ${JSON.stringify(said(a))}`);
    return a;
  }

  /** A verb asked of every node in turn, a few seconds apart; the round's is "round". False when one runs already */
  function all(verb) {
    if (running) return false;
    const nodes = Object.keys(state.nodes).map(Number).sort((a, b) => a - b);
    running = { verb, done: 0, total: nodes.length, started: now() };
    // a round, the night's or the owner's: the last one, and the night's waits two hours from it
    if (verb === "round") {
      state.lastRound = now();
      save();
    }
    (async () => {
      const missed = [];
      for (const n of nodes) {
        if (running.done > 0) await wait(ROUND_GAP_MS);
        const a = await ask(n, verb);
        if (a.error && a.error.startsWith("no answer")) missed.push(n);
        running.done++;
      }
      // the ones that did not answer, once more
      for (const n of missed) {
        await wait(RETRY_MS);
        log(`FLEET: node ${n} asked again`);
        await ask(n, verb);
      }
    })().finally(() => {
      running = null;
    });
    return true;
  }

  /** the round, once a night in the hour from its time: whether it started */
  function tick() {
    sync();
    if (running) return false;
    const [hh, mm] = state.round.split(":").map(Number);
    const into = (minutes(now()) - (hh * 60 + mm) + 1440) % 1440;
    if (into >= ROUND_WINDOW_MIN || (state.lastRound !== null && now() - state.lastRound < 2 * ROUND_WINDOW_MIN * 60000)) return false;
    log("FLEET: the night's round");
    return all("round");
  }

  /** the backups the server keeps, each by its radio address: its kind, its room, its moment, the node of the house that has that address, and a swap */
  function backups() {
    const names = (store.list?.("backups/") ?? []).map((rel) => /^backups\/([0-9a-f]{12})\.json$/.exec(rel)?.[1]).filter(Boolean);
    return names.sort().map((mac) => {
      let doc = null;
      try {
        doc = JSON.parse(new TextDecoder().decode(store.get(`backups/${mac}.json`)));
      } catch {
        // kept as it came
      }
      const owner = Object.values(state.nodes).find((r) => r.mac === mac);
      return { mac, kind: typeof doc?.bridge === "string" ? "bridge" : "panel", project: doc?.project ?? null, at: doc?.at ?? null, node: owner?.node ?? null,
               replaced: state.replaced?.[mac] ?? null };
    });
  }

  /** What the OTA tab sees */
  function fleet() {
    sync();
    return {
      round: state.round, lastRound: state.lastRound, running,
      nodes: Object.values(state.nodes).sort((a, b) => a.node - b.node).map((r) => ({
        node: r.node, role: r.role, name: r.name, ip: where(r) ?? "", mac: r.mac, seen: r.seen ?? null, kind: r.kind ?? null, state: r.state ?? null,
        did: r.did ?? null, backup: kept(r), swap: state.swaps?.[r.node] ?? null,
      })),
      backups: backups(),
    };
  }

  /** The hardware swap: the backup of `from` (a radio address) given to node `to`, which is asked to restore it. Its answer, or {error} */
  async function replace(from, to) {
    const rec = state.nodes[to];
    if (!rec) return { error: "no such node" };
    const old = store.get(`backups/${from}.json`);
    if (old === undefined) return { error: "no such backup" };
    if (from === rec.mac) return { error: "the node's own backup: its Restore" };
    let doc = null;
    try {
      doc = JSON.parse(new TextDecoder().decode(old));
    } catch {
      return { error: "not a backup" };
    }
    if ((typeof doc?.bridge === "string" ? "bridge" : "panel") !== rec.role) return { error: `a ${rec.role} takes a ${rec.role}'s backup` };
    state.swaps[to] = { from, at: now() };
    state.replaced[from] = { by: to, at: now() };
    save();
    log(`FLEET: the backup of ${from} given to node ${to} (${rec.name})`);
    return ask(to, "restore");
  }

  /** The OTA tab's request: the answer (a Promise), or null for a path that is none of its */
  async function handleOwner({ method, path, body }) {
    const rel = String(path).split("?")[0];
    if (rel === "/api/fleet" && method === "GET") return json(200, fleet());
    if (rel === "/api/round" && method === "PUT") {
      let m;
      try {
        m = JSON.parse(new TextDecoder().decode(body ?? new Uint8Array(0)));
      } catch {
        m = null;
      }
      if (!TIME.test(String(m?.time ?? ""))) return json(400, { error: "a time of the day, HH:MM" });
      state.round = m.time;
      save();
      return json(200, { round: state.round });
    }
    if (rel === "/api/round/now" && method === "POST") {
      sync();
      return all("round") ? json(202, { started: "round" }) : json(409, { error: "a round runs already" });
    }
    const one = /^\/api\/node\/(\d+)\/([a-z]+)$/.exec(rel);
    if (one && method === "POST") {
      if (!NODE_VERBS.includes(one[2])) return json(404, { error: "no such verb" });
      sync();
      // the restore the owner asks of a node is of its own backup: a swap it was in is undone
      if (one[2] === "restore" && state.swaps?.[Number(one[1])]) {
        const from = state.swaps[Number(one[1])].from;
        if (state.replaced?.[from]?.by === Number(one[1])) delete state.replaced[from];
        delete state.swaps[Number(one[1])];
        save();
      }
      const a = await ask(Number(one[1]), one[2]);
      return json(a.error ? 502 : 200, a);
    }
    if (rel === "/api/replace" && method === "POST") {
      let m;
      try {
        m = JSON.parse(new TextDecoder().decode(body ?? new Uint8Array(0)));
      } catch {
        m = null;
      }
      if (!/^[0-9a-f]{12}$/.test(String(m?.from ?? "")) || !Number.isInteger(m?.to)) return json(400, { error: "{from: a backup's radio address, to: a node}" });
      sync();
      const a = await replace(m.from, m.to);
      return json(a.error ? (a.error.startsWith("no such") ? 404 : 400) : 200, a);
    }
    const every = /^\/api\/all\/([a-z]+)$/.exec(rel);
    if (every && method === "POST") {
      if (!VERBS.includes(every[1])) return json(404, { error: "no such verb" });
      sync();
      return all(every[1]) ? json(202, { started: every[1] }) : json(409, { error: "a round runs already" });
    }
    return null;
  }

  return { handleNode, handleOwner, ask, all, tick, fleet, get running() { return running; } };
}
