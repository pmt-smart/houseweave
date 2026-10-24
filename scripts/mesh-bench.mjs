#!/usr/bin/env node
// The bench of the ESP-NOW mesh: sets up the devices that run an image with the
// mesh driver (every image), and
// reads them, through the Tasmota HTTP API.
//
//   node scripts/mesh-bench.mjs setup  <ip> <ip> [<ip>...] [--channel 0..13] [--network 0..7] [--yes]
//   node scripts/mesh-bench.mjs status <ip> [<ip>...]
//   node scripts/mesh-bench.mjs neighbors <ip> [<ip>...]
//   node scripts/mesh-bench.mjs send <ip> <dest> <type> <ack 0|1> <text>
//   node scripts/mesh-bench.mjs off    <ip> [<ip>...]
//   node scripts/mesh-bench.mjs health <ip> <ip> [<ip>...]     (the graph the devices describe, and its single points of failure)
//   node scripts/mesh-bench.mjs clock  <ip> <ip> [<ip>...]     (one timeline, all synchronised, the skews)
//   node scripts/mesh-bench.mjs house  <ip> <ip> [<ip>...]     (the house as each node has it, and whether they agree)
//
// `health`, `clock` and `house` only read: each asks every device for its own list, to the last page (the Next of each), and puts the answers together in
// a line that starts with `mesh`, the one thing no single device can say. A device that does not answer is said, and nothing is joined without it.
//
// `setup` gives the devices the numbers 1, 2, 3... in the order of the addresses, makes the key of the
// network (32 random bytes, kept in this process and sent to each device, never printed or written),
// takes each device's address and public key and gives them to all the others, and starts the mesh.
// It writes to the devices, so it only says what it would do until it is run with --yes. The numbers
// and the keys it gives replace the ones the devices had. A device that asks for a password stops it:
// the password is the owner's to remove, and this script never sends one.
//
// Before it writes anything, `setup --yes` asks every device for EspNowMeshStatus, a read, and goes on
// only if every one of them answers it: a device whose image has no mesh (it says {"Command":"Unknown"}),
// one that does not answer, or one that asks for a password stops it with nothing written. A failure
// after the writes began says which devices had been written to by then; the others are as they were.
// An address named twice, an option with no number or a number out of its range, or one the verb does
// not have, is refused before any of it.
//
// The direct link of xdrv_98 and the mesh share the radio: ESP-NOW has one receive callback, and the
// mesh driver rides on the direct link's when that is up (the driver's header).
// `setup` turns the direct link off (EspNowEnable 0) on each device before it starts the mesh there,
// so that the bench's first proofs measure the mesh alone, and it does not turn it on again: the proof of the
// two together, is with EspNowEnable 1 given at the devices by hand.
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { clockSummary, healthSummary, houseSummary } from "./lib/mesh-collect.mjs";

// What each verb takes: the options by name, with the range of a numeric one (a boolean has none)
const OPTIONS = {
  setup: { yes: null, channel: [0, 13], network: [0, 7] },
};

// The line, as words and options: every one the verb has gets its value checked here, before any device is asked
export function parseArgs(argv) {
  const [verb, ...rest] = argv;
  const allowed = OPTIONS[verb] ?? {};
  const flags = new Map();
  const words = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    // the text of a send is the owner's words, whatever they start with
    if (verb === "send" || !arg.startsWith("--")) {
      words.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = arg.slice(2, eq < 0 ? undefined : eq);
    if (!Object.hasOwn(allowed, name)) throw new Error(`--${name} is not an option of ${verb ?? "this"}`);
    if (flags.has(name)) throw new Error(`--${name} is given twice`);
    const range = allowed[name];
    if (range === null) {
      if (eq >= 0) throw new Error(`--${name} takes no value`);
      flags.set(name, true);
      continue;
    }
    let value = eq >= 0 ? arg.slice(eq + 1) : rest[i + 1];
    // the next word is the value, unless it is another option: --channel --yes is a missing number, not a channel
    if (eq < 0) {
      if (value === undefined || value.startsWith("--")) throw new Error(`--${name} needs a number, ${range[0]} to ${range[1]}`);
      i++;
    }
    if (!/^\d+$/.test(value) || Number(value) < range[0] || Number(value) > range[1]) {
      throw new Error(`--${name} is a number from ${range[0]} to ${range[1]}, not '${value}'`);
    }
    flags.set(name, Number(value));
  }
  return { verb, flags, words };
}

// The same device by two spellings is one device: the case of a name, and the port a plain address has
const sameDevice = (ip) => ip.toLowerCase().replace(/:80$/, "");

export function refuseDuplicates(addresses) {
  const seen = new Set();
  for (const ip of addresses) {
    const key = sameDevice(ip);
    if (seen.has(key)) throw new Error(`the address ${ip} is named twice: every device is a node of its own`);
    seen.add(key);
  }
}

// One command to one device, and its answer as an object. A device that does not take the command says
// {"Command":"Unknown"} (and one that takes it with a bad value, {"Command":"Error"}): both are an error here
async function cmd(ip, command) {
  const url = `http://${ip}/cm?cmnd=${encodeURIComponent(command)}`;
  const res = await fetch(url, { headers: { Referer: `http://${ip}/` }, signal: AbortSignal.timeout(8000) });
  if (res.status === 401) throw new Error(`${ip} asks for a password: it is the owner's to remove`);
  const text = await res.text();
  let answer;
  try {
    answer = JSON.parse(text);
  } catch {
    throw new Error(`${ip} answered ${res.status}: ${text.slice(0, 120)}`);
  }
  const verdict = answer && typeof answer === "object" ? answer.Command : undefined;
  if (verdict === "Unknown" || verdict === "Error") {
    // the name of the command only: the line may carry the key of the network
    throw new Error(`${ip} says ${verdict} to ${command.split(" ")[0]}`);
  }
  return answer;
}

const show = (ip, value) => console.log(`${ip}  ${JSON.stringify(value)}`);

// Every device answers EspNowMeshStatus, which writes nothing: the ones that do not are all said at once. Returns the highest version of the network's
// key that any of them holds (0 when none holds one): the key a setup gives has to be another version than the key a device has
async function preflight(nodes) {
  const bad = [];
  let version = 0;
  for (const n of nodes) {
    try {
      const status = (await cmd(n.ip, "EspNowMeshStatus")).EspNowMeshStatus;
      if (!status || typeof status !== "object") throw new Error(`${n.ip} answered EspNowMeshStatus with no status`);
      console.log(`${n.ip}  runs the mesh image (Running ${status.Running}, Id ${status.Id})`);
      if (Number.isInteger(status.GroupVersion) && status.GroupVersion > version) version = status.GroupVersion;
    } catch (e) {
      bad.push(e.message.includes("says Unknown") ? `${e.message}: its image has no mesh driver (one built before 2026-10-15)` : e.message);
    }
  }
  if (bad.length > 0) throw new Error(`nothing was written. ${bad.join("; ")}`);
  return version;
}

export async function setup({ flags, words }) {
  if (words.length < 2) throw new Error("setup needs at least two devices");
  if (words.length > 254) throw new Error("the mesh numbers its nodes 1 to 254");
  refuseDuplicates(words);
  const yes = flags.get("yes") === true;
  const key = randomBytes(32).toString("hex");
  const channel = flags.get("channel");
  const network = flags.get("network");
  const nodes = words.map((ip, i) => ({ ip, id: i + 1, mac: "", pub: "" }));
  console.log(`${yes ? "Setting up" : "Would set up"} ${nodes.length} devices as the nodes ${nodes.map((n) => `${n.id}=${n.ip}`).join(", ")}`);
  if (!yes) {
    console.log("First, EspNowMeshStatus to each (a read), to be sure they run the mesh image.");
    console.log("Each then gets: EspNowEnable 0, EspNowMeshId, EspNowMeshGroupKey (one version above the highest any holds: a key that is not the one a device has is a change of the key, which needs another version),"
      + " EspNowMeshKeyClose (a setup gives the network a key, it does not change it: the key a device had is not kept as the previous one; an image without the command is left as it is), a EspNowMeshNode for each of the others"
      + `${channel !== undefined ? ", EspNowMeshChannel " + channel : ""}${network !== undefined ? ", EspNowMeshNetwork " + network : ""}, EspNowMeshEnable 1, EspNowMeshReady 1 (the bench images run no application that says it is ready, and a node that is not delivers nothing and acks nothing).`);
    console.log("Nothing was sent. Run again with --yes.");
    return;
  }
  const held = await preflight(nodes);
  const version = (held % 255) + 1;
  const written = [];
  const write = async (n, command) => {
    try {
      const answer = await cmd(n.ip, command);
      if (!written.includes(n.ip)) written.push(n.ip);
      return answer;
    } catch (e) {
      throw new Error(`${e.message}. Written to before it: ${written.length > 0 ? written.join(", ") : "no device"}; the others are as they were`);
    }
  };
  for (const n of nodes) {
    await write(n, "EspNowEnable 0");
    await write(n, `EspNowMeshId ${n.id}`);
    const answer = await write(n, "EspNowMeshPublic");
    const info = answer.EspNowMeshPublic;
    if (!info?.Mac || !info?.Public) throw new Error(`${n.ip}: no public key in ${JSON.stringify(answer)}. Written to before it: ${written.join(", ")}`);
    n.mac = info.Mac;
    n.pub = info.Public;
    console.log(`${n.ip}  node ${n.id}  ${n.mac}  public ${n.pub.slice(0, 16)}...`);
  }
  for (const n of nodes) {
    await write(n, `EspNowMeshGroupKey ${key},${version}`);
    // the key a device had was not the network's to keep: a setup is not a change of the key, and the previous key held after one would let the old key in. An image that
    // has no such command has no previous key to close
    try {
      await write(n, "EspNowMeshKeyClose");
    } catch (e) {
      if (!e.message.includes("says Unknown")) throw e;
    }
    for (const other of nodes) {
      if (other !== n) await write(n, `EspNowMeshNode ${other.id},${other.mac},${other.pub},${other.ip}`);
    }
    if (channel !== undefined) await write(n, `EspNowMeshChannel ${channel}`);
    if (network !== undefined) await write(n, `EspNowMeshNetwork ${network}`);
  }
  for (const n of nodes) show(n.ip, await write(n, "EspNowMeshEnable 1"));
  // The driver delivers to the application only when the application says it is ready (the first espnow_mesh_info of a Berry
  // that loaded, or this command). A bench image has no such application, and a node that is not ready refuses what is for it
  // as a full inbox: no ack, no window moved.
  for (const n of nodes) show(n.ip, await write(n, "EspNowMeshReady 1"));
}

async function each(words, command) {
  if (words.length < 1) throw new Error("name at least one device address");
  for (const ip of words) {
    try {
      show(ip, await cmd(ip, command));
    } catch (e) {
      console.log(`${ip}  ${e.message}`);
      process.exitCode = 1;
    }
  }
}

// A list the driver answers in pages (EspNowMeshNeighbors, EspNowMeshHealth, EspNowMeshClock): a page holds as many entries as a message takes, and says where
// the next one starts ("Next", only when some remain), so the pages are asked for from there, not from a count of entries
async function eachPaged(words, command) {
  if (words.length < 1) throw new Error("name at least one device address");
  for (const ip of words) {
    try {
      let from = 0;
      for (let page = 0; ; page++) {
        const answer = await cmd(ip, from === 0 ? command : `${command} ${from}`);
        show(ip, answer);
        const next = answer?.[command]?.Next;
        if (next === undefined) break;
        if (!Number.isInteger(next) || next <= from || page >= 63) throw new Error(`${command} says Next ${JSON.stringify(next)} after the page from ${from}: the pages do not advance`);
        from = next;
      }
    } catch (e) {
      console.log(`${ip}  ${e.message}`);
      process.exitCode = 1;
    }
  }
}

// A list the driver answers in pages, read to the end as one answer: the fields of the first page, and the entries of every page in order
export async function readPaged(ip, command) {
  let from = 0;
  let head = null;
  const list = [];
  for (let page = 0; ; page++) {
    const answer = await cmd(ip, from === 0 ? command : `${command} ${from}`);
    const body = answer?.[command];
    if (!body || typeof body !== "object") throw new Error(`${ip} answered ${command} with no list: ${JSON.stringify(answer).slice(0, 120)}`);
    head ??= body;
    if (Array.isArray(body.List)) list.push(...body.List);
    const next = body.Next;
    if (next === undefined) break;
    if (!Number.isInteger(next) || next <= from || page >= 63) throw new Error(`${command} says Next ${JSON.stringify(next)} after the page from ${from}: the pages do not advance`);
    from = next;
  }
  const { List: _list, Next: _next, From: _from, ...rest } = head;
  return { ...rest, List: list };
}

// The number a device has in the mesh (and in the house): what its neighbours call it
async function nodeNumber(ip) {
  const status = (await cmd(ip, "EspNowMeshStatus")).EspNowMeshStatus;
  if (!status || typeof status !== "object" || !Number.isInteger(status.Id) || status.Id < 1) {
    throw new Error(`${ip} has no node number (EspNowMeshStatus Id ${JSON.stringify(status?.Id)}): the mesh is not set up there`);
  }
  return status.Id;
}

// The collectors: every device read for what `ask` takes of it, and the answers put together by `join`. A device that fails is said, and no join is made without it
async function collect(words, verb, ask, join) {
  if (words.length < 2) throw new Error(`${verb} needs at least two devices: it puts together what each says`);
  refuseDuplicates(words);
  const reports = [];
  const failed = [];
  for (const ip of words) {
    try {
      const id = await nodeNumber(ip);
      const report = await ask(ip, id);
      reports.push(report);
      show(ip, report.line);
    } catch (e) {
      console.log(`${ip}  ${e.message}`);
      failed.push(ip);
    }
  }
  if (failed.length > 0) {
    console.log(`mesh  no join: ${failed.length} of ${words.length} devices did not answer (${failed.join(", ")})`);
    process.exitCode = 1;
    return;
  }
  const ids = reports.map((r) => r.id);
  if (new Set(ids).size !== ids.length) {
    console.log(`mesh  no join: two devices have the same node number (${ids.join(", ")})`);
    process.exitCode = 1;
    return;
  }
  console.log(`mesh  ${JSON.stringify(join(reports))}`);
}

const healthVerb = (words) => collect(words, "health", async (ip, id) => {
  const health = await readPaged(ip, "EspNowMeshHealth");
  const { List, ...head } = health;
  return { id, list: List, cut: head.Cut, line: { Id: id, ...head, List } };
}, healthSummary);

const clockVerb = (words) => collect(words, "clock", async (ip, id) => {
  const clock = await readPaged(ip, "EspNowMeshClock");
  const { List, ...head } = clock;
  return { id, clock: head, list: List, line: { Id: id, ...head, Neighbours: List.length } };
}, clockSummary);

const houseVerb = (words) => collect(words, "house", async (ip, id) => {
  const answer = await cmd(ip, "HouseStatus");
  const house = answer?.HouseStatus;
  if (!house || typeof house !== "object") throw new Error(`${ip} answered HouseStatus with no house: ${JSON.stringify(answer).slice(0, 120)}`);
  return { id, house, line: house };
}, houseSummary);

async function main(argv) {
  const parsed = parseArgs(argv);
  const { verb, words } = parsed;
  switch (verb) {
    case "setup": await setup(parsed); break;
    case "status": await each(words, "EspNowMeshStatus"); break;
    case "neighbors": await eachPaged(words, "EspNowMeshNeighbors"); break;
    case "health": await healthVerb(words); break;
    case "clock": await clockVerb(words); break;
    case "house": await houseVerb(words); break;
    case "off": await each(words, "EspNowMeshEnable 0"); break;
    case "send": {
      const [ip, dest, type, ack, ...text] = words;
      if (!ip || dest === undefined || type === undefined || ack === undefined || text.length === 0) throw new Error("send <ip> <dest> <type> <ack 0|1> <text>");
      show(ip, await cmd(ip, `EspNowMeshSend ${dest},${type},${ack},${text.join(" ")}`));
      break;
    }
    default:
      console.log("usage: node scripts/mesh-bench.mjs setup|status|neighbors|health|clock|house|send|off <ip>...");
      process.exitCode = 1;
  }
}

// Run as a script; imported (by the test), it only gives the functions above
const asScript = process.argv[1] !== undefined && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (asScript) {
  try {
    await main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
