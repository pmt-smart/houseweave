// The common part of the bench's instrumentation: scripts/bench-logs.mjs, bench-load.mjs,
// bench-power.mjs and bench-surface.mjs. Node only, no packages.
//
// What every one of them keeps to, and what lives here so that none of them can forget it:
//   - a target is ONE host the caller names (an address, a name, optionally :port). A range, a subnet, a wildcard
//     or a broadcast address is refused: nothing here scans a network;
//   - every request carries the Referer header Tasmota demands, and never a credential. A device that asks for
//     a password is not asked again: it is the owner's to remove, or to open for a test;
//   - a script that writes to a device does it only when it is run with --yes, and only through
//     `makeClient({ allowWrites: true })`. A client made read-only refuses every command that is not on the
//     read-only list below, so that a script that must only read cannot write by a typo;
//   - what a script measures goes to the run directory as JSON lines, with the control machine's clock.
import dgram from "node:dgram";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DEFAULT_BENCH_DIR = join(repoRoot, "bench");

// ---------------------------------------------------------------------------------------------------------------
// errors

export class BenchError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "BenchError";
    this.code = code;
    Object.assign(this, extra);
  }
}

export class UsageError extends BenchError {
  constructor(message) {
    super("usage", message);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// time

/** The control machine's clock, three ways: ISO (what a person reads), epoch ms, and the monotonic ms for intervals. */
export function stamp() {
  const ms = Date.now();
  return { t: new Date(ms).toISOString(), ms, mono: Math.round(performance.now() * 1000) / 1000 };
}

export function sleep(ms, signal) {
  return new Promise((resolveSleep) => {
    if (signal?.aborted || ms <= 0) {
      resolveSleep();
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolveSleep();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// a seeded generator: the same seed gives the same plan, on any machine (mulberry32 over a 32-bit hash)

function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeRng(seed) {
  const start = typeof seed === "number" && Number.isFinite(seed) ? seed >>> 0 : hashString(String(seed));
  let s = start;
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    seed,
    next,
    /** An integer in [lo, hi], both included. */
    int(lo, hi) {
      if (hi < lo) throw new BenchError("bad-range", `int(${lo}, ${hi}): the upper bound is below the lower one`);
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    pick(list) {
      if (list.length === 0) throw new BenchError("empty", "pick() of an empty list");
      return list[Math.floor(next() * list.length)];
    },
    chance(p) {
      return next() < p;
    },
    shuffle(list) {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    /** An independent stream under a label: changing what one part draws does not move what another draws. */
    fork(label) {
      return makeRng(`${String(seed)}:${label}`);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// arguments. spec = { usage, summary, options: { name: { type, default, help } }, positional, notes }
// types: string, int, number, boolean, list (comma separated), ints (comma separated integers)

function convert(name, opt, raw) {
  switch (opt.type) {
    case "int": {
      const n = Number(raw);
      if (!Number.isInteger(n)) throw new UsageError(`--${name} needs an integer, got "${raw}"`);
      return n;
    }
    case "number": {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new UsageError(`--${name} needs a number, got "${raw}"`);
      return n;
    }
    case "list":
      return String(raw).split(",").map((s) => s.trim()).filter(Boolean);
    case "ints":
      return String(raw).split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
        const n = Number(s);
        if (!Number.isInteger(n)) throw new UsageError(`--${name} needs integers, got "${s}"`);
        return n;
      });
    default:
      return String(raw);
  }
}

export function parseArgs(argv, spec) {
  const values = {};
  for (const [name, opt] of Object.entries(spec.options)) if ("default" in opt) values[name] = opt.default;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      values.help = true;
    } else if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    } else if (arg.startsWith("--")) {
      let name = arg.slice(2);
      let inline;
      const eq = name.indexOf("=");
      if (eq >= 0) {
        inline = name.slice(eq + 1);
        name = name.slice(0, eq);
      }
      const opt = spec.options[name];
      if (!opt) throw new UsageError(`unknown option --${name}`);
      if (opt.type === "boolean") {
        values[name] = inline === undefined ? true : inline !== "false";
      } else {
        const raw = inline !== undefined ? inline : argv[++i];
        if (raw === undefined) throw new UsageError(`--${name} needs a value`);
        values[name] = convert(name, opt, raw);
      }
    } else {
      positional.push(arg);
    }
  }
  return { values, positional };
}

export function helpText(spec) {
  const lines = [`usage: ${spec.usage}`, "", spec.summary.trim(), "", "options:"];
  const rows = Object.entries(spec.options).map(([name, opt]) => {
    const arg = opt.type === "boolean" ? "" : ` <${opt.type === "ints" ? "n,n,..." : opt.type === "list" ? "a,b,..." : opt.type}>`;
    const dflt = "default" in opt && opt.default !== undefined && opt.default !== false ? ` (default ${Array.isArray(opt.default) ? opt.default.join(",") : opt.default})` : "";
    return [`  --${name}${arg}`, `${opt.help}${dflt}`];
  });
  rows.push(["  --help", "this text"]);
  const width = Math.max(...rows.map((r) => r[0].length)) + 2;
  for (const [left, right] of rows) lines.push(left.padEnd(width) + right);
  if (spec.notes) lines.push("", spec.notes.trim());
  return lines.join("\n");
}

/** The tail every script shares: help, usage errors, the exit code. `main` returns the exit code or nothing. */
export async function runMain(spec, argv, main) {
  try {
    const parsed = parseArgs(argv, spec);
    if (parsed.values.help) {
      console.log(helpText(spec));
      return 0;
    }
    return (await main(parsed)) ?? 0;
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`${e.message}\n(see --help)`);
      return 2;
    }
    console.error(e instanceof BenchError ? `${e.code}: ${e.message}` : e.stack ?? String(e));
    return 1;
  }
}

/** True when the module is the script node was started on, not one that imported it. */
export function isMain(metaUrl) {
  return Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === metaUrl;
}

// ---------------------------------------------------------------------------------------------------------------
// targets: one host at a time, named by the caller

function validIpv4(text) {
  const parts = text.split(".");
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

export function splitHost(host) {
  const m = /^(.*?)(?::(\d{1,5}))?$/.exec(host);
  return { hostname: m[1], port: m[2] ? Number(m[2]) : 80 };
}

/** Refuses anything that is not a single device: a range, a subnet, a wildcard, a broadcast or multicast address. */
export function assertExplicitHost(host) {
  const bad = (why) => new BenchError("bad-target", `"${host}" is not a single host: ${why}`);
  if (typeof host !== "string" || host === "") throw bad("empty");
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*(?::\d{1,5})?$/.test(host)) throw bad("only an IPv4 address or a name, optionally :port");
  const { hostname, port } = splitHost(host);
  if (port > 65535) throw bad("port out of range");
  if (/^[\d.-]+$/.test(hostname)) {
    if (!validIpv4(hostname)) throw bad("a range or a malformed address");
    const octets = hostname.split(".").map(Number);
    if (octets[3] === 255 || octets[3] === 0 || octets[0] === 0 || (octets[0] >= 224 && octets[0] <= 239)) throw bad("a broadcast, network or multicast address");
  }
  return host;
}

// ---------------------------------------------------------------------------------------------------------------
// the topology file: the devices of the bench, their roles, which are sacrificial, the lamps and the outlets

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const IEEE_RE = /^0x[0-9A-Fa-f]{16}$/;

export function validateTopology(raw, where = "topology") {
  const fail = (message) => new BenchError("bad-topology", `${where}: ${message}`);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw fail("the file must hold one JSON object");
  const devices = raw.devices ?? [];
  const lamps = raw.lamps ?? [];
  const outlets = raw.outlets ?? [];
  if (!Array.isArray(devices) || !Array.isArray(lamps) || !Array.isArray(outlets)) throw fail("devices, lamps and outlets must be lists");
  const names = new Set();
  const claim = (name, kind) => {
    if (typeof name !== "string" || !NAME_RE.test(name)) throw fail(`${kind} name "${name}" must be letters, digits, . _ -`);
    if (names.has(name)) throw fail(`the name "${name}" is used twice`);
    names.add(name);
  };
  const out = { version: 1, devices: [], lamps: [], outlets: [] };
  for (const d of devices) {
    claim(d.name, "device");
    if (d.role !== "bridge" && d.role !== "panel") throw fail(`device "${d.name}": role must be "bridge" or "panel"`);
    try {
      assertExplicitHost(d.ip);
    } catch (e) {
      throw fail(`device "${d.name}": ${e.message}`);
    }
    const dev = { name: d.name, role: d.role, ip: d.ip, sacrificial: d.sacrificial === true };
    if (d.hostname !== undefined) dev.hostname = String(d.hostname);
    if (d.bridge !== undefined && d.bridge !== null) dev.bridge = String(d.bridge);
    if (d.taps !== undefined) {
      if (typeof d.taps !== "object" || d.taps === null || !Object.values(d.taps).every(Number.isInteger)) throw fail(`device "${d.name}": taps maps a lamp name to the integer the glass reports (x * 1000 + y)`);
      dev.taps = { ...d.taps };
    }
    if (d.mesh !== undefined) {
      if (!Number.isInteger(d.mesh?.id) || d.mesh.id < 1 || d.mesh.id > 254) throw fail(`device "${d.name}": mesh.id must be 1..254`);
      dev.mesh = { id: d.mesh.id };
    }
    out.devices.push(dev);
  }
  const byName = new Map(out.devices.map((d) => [d.name, d]));
  for (const d of out.devices) {
    if (d.bridge !== undefined) {
      if (d.role !== "panel") throw fail(`device "${d.name}": only a panel has a bridge`);
      if (byName.get(d.bridge)?.role !== "bridge") throw fail(`device "${d.name}": its bridge "${d.bridge}" is not a bridge of this file`);
    }
  }
  for (const l of lamps) {
    claim(l.name, "lamp");
    if (typeof l.ieee !== "string" || !IEEE_RE.test(l.ieee)) throw fail(`lamp "${l.name}": ieee must be 0x and 16 hex digits`);
    if (!byName.has(l.coordinator)) throw fail(`lamp "${l.name}": its coordinator "${l.coordinator}" is not a device of this file (the bridge, or the panel that holds the radio)`);
    out.lamps.push({ name: l.name, ieee: l.ieee, coordinator: l.coordinator });
  }
  for (const d of out.devices) {
    for (const lampName of Object.keys(d.taps ?? {})) {
      if (!out.lamps.some((l) => l.name === lampName)) throw fail(`device "${d.name}": a tap names the lamp "${lampName}", which is not in the file`);
    }
  }
  for (const o of outlets) {
    claim(o.name, "outlet");
    try {
      assertExplicitHost(o.ip);
    } catch (e) {
      throw fail(`outlet "${o.name}": ${e.message}`);
    }
    const channel = o.channel ?? 1;
    if (!Number.isInteger(channel) || channel < 1 || channel > 8) throw fail(`outlet "${o.name}": channel must be 1..8`);
    const role = o.role ?? "other";
    if (!["router", "bridge", "panel", "other"].includes(role)) throw fail(`outlet "${o.name}": role must be router, bridge, panel or other`);
    const powers = o.powers ?? [];
    for (const p of powers) if (!byName.has(p)) throw fail(`outlet "${o.name}": powers "${p}", which is not a device of this file`);
    out.outlets.push({ name: o.name, ip: o.ip, channel, role, powers: [...powers] });
  }
  return out;
}

export function loadTopology(file) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new BenchError("bad-topology", `${file}: ${e.message}`);
  }
  return validateTopology(raw, file);
}

export function topologyDigest(topology) {
  return createHash("sha256").update(JSON.stringify(topology)).digest("hex").slice(0, 16);
}

/**
 * The devices a script works on: the topology's (all of them, or those named by `only`), plus any `name=ip` or `ip`
 * given on the command line. A device is only ever one the caller wrote down.
 */
export function resolveDevices({ topology, positional = [], only = null }) {
  const devices = topology ? topology.devices.map((d) => ({ ...d })) : [];
  for (const arg of positional) {
    const eq = arg.indexOf("=");
    const name = eq > 0 ? arg.slice(0, eq) : arg;
    const ip = eq > 0 ? arg.slice(eq + 1) : arg;
    assertExplicitHost(ip);
    const known = devices.find((d) => d.name === name);
    if (known) throw new BenchError("bad-target", `"${name}" is already a device of the topology`);
    devices.push({ name, role: "unknown", ip, sacrificial: false });
  }
  const picked = only ? devices.filter((d) => only.includes(d.name)) : devices;
  if (only) {
    const missing = only.filter((n) => !devices.some((d) => d.name === n));
    if (missing.length) throw new BenchError("bad-target", `no such device: ${missing.join(", ")}`);
  }
  return picked;
}

// ---------------------------------------------------------------------------------------------------------------
// HTTP: node:http, one short connection a request (the ESP32 web server serves one client at a time)

export function httpRequest({ host, method = "GET", path, headers = {}, body = null, timeoutMs = 8000, headersOnly = false, maxBytes = 1 << 20 }) {
  return new Promise((resolveRequest, rejectRequest) => {
    assertExplicitHost(host);
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "authorization") throw new BenchError("credential", "this tool never sends a credential");
    }
    if (/[?&](?:user|password)=/i.test(path)) throw new BenchError("credential", "this tool never sends a credential");
    const { hostname, port } = splitHost(host);
    const sent = performance.now();
    const hdrs = { Host: host, Referer: `http://${host}/`, Connection: "close", ...headers };
    if (body !== null) hdrs["Content-Length"] = Buffer.byteLength(body);
    let finished = false;
    const finish = (fn, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      fn(value);
    };
    const req = http.request({ hostname, port, method, path, headers: hdrs, agent: false }, (res) => {
      const headMs = performance.now() - sent;
      if (headersOnly) {
        // what a secret-bearing page says about itself, never what it holds
        finish(resolveRequest, { status: res.statusCode, headers: res.headers, body: null, bytes: 0, rttMs: Math.round(headMs), truncated: true });
        res.destroy();
        req.destroy();
        return;
      }
      const chunks = [];
      let bytes = 0;
      let truncated = false;
      res.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes <= maxBytes) chunks.push(chunk);
        else truncated = true;
      });
      res.on("end", () => finish(resolveRequest, { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8"), bytes, rttMs: Math.round(performance.now() - sent), truncated }));
      res.on("error", (e) => finish(rejectRequest, mapNetError(host, e)));
      res.on("aborted", () => finish(rejectRequest, new BenchError("no-reply", `${host} closed the connection in the middle of the answer`)));
    });
    const timer = setTimeout(() => {
      finish(rejectRequest, new BenchError("timeout", `${host} did not answer in ${timeoutMs} ms`));
      req.destroy();
    }, timeoutMs);
    req.on("error", (e) => finish(rejectRequest, mapNetError(host, e)));
    req.end(body ?? undefined);
  });
}

function mapNetError(host, e) {
  if (e instanceof BenchError) return e;
  const code = e.code;
  if (code === "ECONNREFUSED") return new BenchError("refused", `${host} refused the connection`);
  if (code === "ECONNRESET" || /hang up/.test(e.message)) return new BenchError("no-reply", `${host} closed the connection with no answer (a Referer it does not accept, or the device is going down)`);
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH" || code === "ENOTFOUND" || code === "EAI_AGAIN") return new BenchError("unreachable", `${host} is unreachable (${code})`);
  if (code === "ETIMEDOUT") return new BenchError("timeout", `${host} timed out`);
  return new BenchError("network", `${host}: ${e.message}`);
}

// ---------------------------------------------------------------------------------------------------------------
// the Tasmota console over HTTP

export const BR_MEMORY = "Br tasmota.memory()";

/**
 * The panel's own view of some lamps, one console line: what it shows each (global.plan.live, "on" or "off") and whether it
 * shows it with the "?" (global.plan.doubt, the "no communication" look; `field` names another map of the plan). The answer is a
 * list, two for each lamp, live then flag: nil for a lamp the map does not hold. A line has room for about 15 lamps.
 */
export function panelViewExpression(ieees, field = "doubt") {
  if (!/^[a-z_]+$/.test(field)) throw new BenchError("bad-field", `"${field}" is not the name of a map of the plan`);
  for (const ieee of ieees) if (!IEEE_RE.test(ieee)) throw new BenchError("bad-ieee", `"${ieee}" is not an IEEE address`);
  const body = `Br (def () var l=global.plan.live var d=global.plan.${field} return [${ieees.map((i) => `l.find("${i}"), d.find("${i}")`).join(", ")}] end)()`;
  if (body.length > 1100) throw new BenchError("too-long", `the view of ${ieees.length} lamps is ${body.length} bytes, more than one console line takes`);
  return body;
}

/** The answer of panelViewExpression, as { live: {ieee: "on"|"off"}, doubt: {ieee: true} } (only what the panel holds). */
export function parsePanelView(ieees, value) {
  if (!Array.isArray(value) || value.length !== ieees.length * 2) throw new BenchError("bad-answer", `the panel's view is not a list of ${ieees.length * 2}: ${JSON.stringify(value)?.slice(0, 80)}`);
  const view = { live: {}, doubt: {} };
  ieees.forEach((ieee, i) => {
    if (typeof value[2 * i] === "string") view.live[ieee] = value[2 * i];
    if (value[2 * i + 1] === true) view.doubt[ieee] = true;
  });
  return view;
}

/** The commands a read-only client may send: what answers a question and changes nothing. */
const READ_ONLY = [
  /^Status(?:\s+(?:[0-9]|1[0-4]))?$/i,
  /^EspNowMeshStatus$/i,
  /^EspNowMeshNeighbors(?:\s+\d{1,3})?$/i,
  /^EspNowMeshHealth(?:\s+\d{1,3})?$/i,
  /^EspNowMeshClock(?:\s+\d{1,3})?$/i,
  /^HouseStatus$/i,
  /^ZbBridgeMode$/i,
  /^ZbStatus[123](?:\s+\S+)?$/i,
  /^Power\d?$/i,
];
const READ_ONLY_EXACT = new Set([BR_MEMORY, "Br tasmota.millis()", "Br tasmota.get_free_heap()"]);
const READ_ONLY_VIEW = /^Br \(def \(\) var l=global\.plan\.live var d=global\.plan\.[a-z_]+ return \[(?:l\.find\("0x[0-9A-Fa-f]{16}"\), d\.find\("0x[0-9A-Fa-f]{16}"\)(?:, )?)+\] end\)\(\)$/;

export function isReadOnlyCommand(command) {
  const text = String(command).trim();
  return READ_ONLY_EXACT.has(text) || READ_ONLY_VIEW.test(text) || READ_ONLY.some((re) => re.test(text));
}

/**
 * A client for one script. `readOnly` makes it refuse everything that is not on the read-only list; a write needs
 * `allowWrites`, which a script sets from --yes. `http` is replaceable, for the tests.
 */
export function makeClient({ timeoutMs = 5000, readOnly = false, allowWrites = false, http: send = httpRequest } = {}) {
  async function cmd(host, command, { write = false, timeoutMs: own } = {}) {
    if (write) {
      if (readOnly || !allowWrites) throw new BenchError("write-blocked", `a write to ${host} (${command.slice(0, 40)}) needs --yes`);
    } else if (readOnly && !isReadOnlyCommand(command)) {
      throw new BenchError("write-blocked", `"${command.slice(0, 40)}" is not on the read-only list`);
    }
    const res = await send({ host, path: `/cm?cmnd=${encodeURIComponent(command)}`, timeoutMs: own ?? timeoutMs });
    if (res.status === 401) throw new BenchError("auth", `${host} asks for a password: it is the owner's to remove or to open for the test; this tool never sends one`);
    let json;
    try {
      json = JSON.parse(res.body);
    } catch {
      throw new BenchError("bad-json", `${host} answered ${res.status} with something that is not JSON: ${String(res.body).slice(0, 80)}`);
    }
    return { json, status: res.status, rttMs: res.rttMs };
  }
  /** Berry through the console: the answer parsed from the text Tasmota gives it. */
  async function br(host, expression, options = {}) {
    const { json, rttMs } = await cmd(host, expression.startsWith("Br ") ? expression : `Br ${expression}`, options);
    return { value: brResult(json), rttMs };
  }
  /** A GET of a page. A GET that changes something (a file deleted through the file manager) says `write: true`. */
  async function get(host, path, options = {}) {
    if (readOnly) throw new BenchError("write-blocked", "a read-only client reads through cmd() only");
    if (options.write && !allowWrites) throw new BenchError("write-blocked", `a write to ${host} (GET ${path.slice(0, 40)}) needs --yes`);
    return send({ host, path, timeoutMs: options.timeoutMs ?? timeoutMs, headersOnly: options.headersOnly ?? false, ...(options.maxBytes ? { maxBytes: options.maxBytes } : {}) });
  }
  async function raw(host, request) {
    if (readOnly || !allowWrites) throw new BenchError("write-blocked", `a write to ${host} (${request.method} ${request.path}) needs --yes`);
    return send({ host, timeoutMs, ...request });
  }
  return { cmd, br, get, raw, readOnly, allowWrites, timeoutMs };
}

// ---------------------------------------------------------------------------------------------------------------
// what Berry prints: {'heap_free': 176, 'frag': 34} and friends, read back into values

const BERRY_ERROR_RE = /^\[[a-z_]+\]\s/;

export function parseBerryText(text) {
  const s = String(text);
  let i = 0;
  const fail = () => new BenchError("berry-parse", `cannot read "${s.slice(0, 60)}" at ${i}`);
  const space = () => {
    while (i < s.length && /\s/.test(s[i])) i++;
  };
  function quoted() {
    const q = s[i++];
    let out = "";
    while (i < s.length && s[i] !== q) {
      if (s[i] === "\\" && i + 1 < s.length) {
        i++;
        const c = s[i];
        if (c === "n") out += "\n";
        else if (c === "r") out += "\r";
        else if (c === "t") out += "\t";
        else if (c === "x" && /^[0-9a-fA-F]{2}/.test(s.slice(i + 1, i + 3))) {
          out += String.fromCharCode(parseInt(s.slice(i + 1, i + 3), 16));
          i += 2;
        } else out += c;
      } else out += s[i];
      i++;
    }
    if (s[i] !== q) throw fail();
    i++;
    return out;
  }
  function value() {
    space();
    const c = s[i];
    if (c === "{") {
      i++;
      const map = {};
      space();
      if (s[i] === "}") {
        i++;
        return map;
      }
      for (;;) {
        const key = value();
        space();
        if (s[i] !== ":") throw fail();
        i++;
        map[String(key)] = value();
        space();
        if (s[i] === ",") i++;
        else if (s[i] === "}") {
          i++;
          return map;
        } else throw fail();
      }
    }
    if (c === "[") {
      i++;
      const list = [];
      space();
      if (s[i] === "]") {
        i++;
        return list;
      }
      for (;;) {
        list.push(value());
        space();
        if (s[i] === ",") i++;
        else if (s[i] === "]") {
          i++;
          return list;
        } else throw fail();
      }
    }
    if (c === "'" || c === '"') return quoted();
    if (c === "<") {
      let depth = 0;
      const start = i;
      while (i < s.length) {
        if (s[i] === "<") depth++;
        else if (s[i] === ">" && --depth === 0) break;
        i++;
      }
      i++;
      return s.slice(start, i);
    }
    const m = /^[^,\]}:\s]+/.exec(s.slice(i));
    if (!m) throw fail();
    i += m[0].length;
    if (m[0] === "nil") return null;
    if (m[0] === "true") return true;
    if (m[0] === "false") return false;
    const n = Number(m[0]);
    return Number.isNaN(n) ? m[0] : n;
  }
  const v = value();
  space();
  if (i < s.length) throw fail();
  return v;
}

/** The value a `{"Br":"..."}` answer holds; a Berry error is thrown as one. */
export function brResult(json) {
  const raw = json?.Br ?? json?.BR ?? json?.br;
  if (typeof raw !== "string") throw new BenchError("bad-answer", `no Br in ${JSON.stringify(json).slice(0, 80)}`);
  if (BERRY_ERROR_RE.test(raw)) throw new BenchError("berry-error", raw.replace(/\s+/g, " ").slice(0, 200));
  const text = raw.trim();
  if (text === "") return "";
  if (/^[{[<]/.test(text) || text === "nil" || text === "true" || text === "false" || /^-?\d+(\.\d+)?$/.test(text)) {
    try {
      return parseBerryText(text);
    } catch {
      return text;
    }
  }
  return raw;
}

// ---------------------------------------------------------------------------------------------------------------
// syslog: what Tasmota sends to LogHost:LogPort (support.ino, SyslogAsync): RFC 5424 with the device's own time

const SYSLOG_5424 = /^<(\d{1,3})>1 (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) ?([\s\S]*)$/;
const SYSLOG_LEGACY = /^<(\d{1,3})>([\s\S]*)$/;

export function parseSyslog(datagram) {
  const text = Buffer.isBuffer(datagram) ? datagram.toString("utf8") : String(datagram);
  const body = text.replace(/[\r\n]+$/, "");
  let m = SYSLOG_5424.exec(body);
  if (m) {
    const pri = Number(m[1]);
    return { pri, facility: pri >> 3, severity: pri & 7, device_ts: m[2], host: m[3], app: m[4], msg: m[8].slice(0, 4096) };
  }
  m = SYSLOG_LEGACY.exec(body);
  if (m) {
    const pri = Number(m[1]);
    return { pri, facility: pri >> 3, severity: pri & 7, device_ts: null, host: null, app: null, msg: m[2].slice(0, 4096) };
  }
  return { pri: null, facility: null, severity: null, device_ts: null, host: null, app: null, msg: body.slice(0, 4096) };
}

/** Which device a datagram came from: its address, or, when several share one, the host its header says. */
export function resolveSyslogDevice(devices, address, headerHost) {
  const sameAddress = devices.filter((d) => splitHost(d.ip).hostname === address);
  if (sameAddress.length === 1) return sameAddress[0];
  const pool = sameAddress.length > 1 ? sameAddress : devices;
  return pool.find((d) => headerHost && (d.hostname === headerHost || d.name === headerHost)) ?? null;
}

/** Listens on UDP; `onMessage(buffer, remote)`. Port 0 picks one, read back from `port`. */
export function startSyslogServer({ port, address = "0.0.0.0", onMessage }) {
  return new Promise((resolveServer, rejectServer) => {
    const socket = dgram.createSocket("udp4");
    socket.on("error", rejectServer);
    socket.on("message", onMessage);
    socket.bind(port, address, () => {
      socket.removeListener("error", rejectServer);
      socket.on("error", (e) => console.error(`syslog: ${e.message}`));
      resolveServer({ socket, port: socket.address().port, close: () => new Promise((done) => socket.close(done)) });
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// output: JSON lines in a run directory (bench/<run>/), which git does not keep

export class JsonlWriter {
  constructor(file) {
    mkdirSync(dirname(file), { recursive: true });
    this.file = file;
    this.count = 0;
    this.stream = createWriteStream(file, { flags: "a" });
  }
  append(record) {
    this.stream.write(`${JSON.stringify(record)}\n`);
    this.count++;
  }
  close() {
    return new Promise((done) => this.stream.end(done));
  }
}

export function defaultRunName(date = new Date()) {
  return date.toISOString().replace(/\.\d+Z$/, "").replace(/[-:]/g, "").replace("T", "-");
}

/** The run directory: --out, or bench/<UTC time> in the repository. Made if it is not there. */
export function openRunDir(out, date = new Date()) {
  const dir = resolve(out ?? join(DEFAULT_BENCH_DIR, defaultRunName(date)));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function readMeta(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
  } catch {
    return { v: 1, scripts: {} };
  }
}

/** What a script says about itself in the run: its arguments, when it ran, what it counted. Merged by script. */
export function writeMeta(dir, script, info) {
  const meta = readMeta(dir);
  meta.v = 1;
  meta.host = os.hostname();
  meta.node = process.version;
  meta.scripts = { ...meta.scripts, [script]: { ...(meta.scripts?.[script] ?? {}), ...info } };
  writeFileSync(join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
}

/** The topology the run used, copied once, so that a report can be read without the file it came from. */
export function snapshotTopology(dir, topology) {
  const file = join(dir, "topology.json");
  if (topology && !existsSync(file)) writeFileSync(file, `${JSON.stringify(topology, null, 2)}\n`);
}

// ---------------------------------------------------------------------------------------------------------------
// numbers

/** Nearest rank, on a list sorted ascending. */
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

export function summarize(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return { n: 0, min: null, p50: null, p95: null, p99: null, max: null, mean: null };
  const sum = sorted.reduce((a, b) => a + b, 0);
  return { n: sorted.length, min: sorted[0], p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99), max: sorted[sorted.length - 1], mean: Math.round((sum / sorted.length) * 10) / 10 };
}

/** The Theil-Sen slope (the median of the slopes between pairs): robust to the odd sample. Points are [x, y]. */
export function theilSen(points, maxPoints = 300) {
  let pts = points;
  if (pts.length > maxPoints) {
    const step = pts.length / maxPoints;
    pts = Array.from({ length: maxPoints }, (_, i) => points[Math.floor(i * step)]);
  }
  const slopes = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[j][0] - pts[i][0];
      if (dx !== 0) slopes.push((pts[j][1] - pts[i][1]) / dx);
    }
  }
  if (slopes.length === 0) return null;
  slopes.sort((a, b) => a - b);
  return slopes[Math.floor(slopes.length / 2)];
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
}

// ---------------------------------------------------------------------------------------------------------------
// text

export function table(rows, { gap = 2 } = {}) {
  if (rows.length === 0) return "";
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => String(r[c] ?? "").length)));
  return rows.map((r) => r.map((cell, c) => (c === r.length - 1 ? String(cell ?? "") : String(cell ?? "").padEnd(widths[c] + gap))).join("").trimEnd()).join("\n");
}

export function shortHash(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 8);
}
