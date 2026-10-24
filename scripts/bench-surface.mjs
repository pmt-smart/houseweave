#!/usr/bin/env node
// The bench's attack surface: for each device it is NAMED, what answers
// WITHOUT a credential. The inventory of what a hand on the same LAN could reach: the command console, the pages of
// the configuration, the downloads of the settings and of the files, and the upload of a file.
//
//   node scripts/bench-surface.mjs --yes name=ip [name=ip ...] [--delay 400] [--no-upload] [--out DIR]
//   node scripts/bench-surface.mjs --yes --topology F --targets panel-sacrificial,bridge-2
//
// It runs ONLY with --yes, and ONLY on the devices listed one by one: a range, a subnet or a wildcard is refused, and
// nothing here scans a network. Without --yes it prints each device's probes and sends nothing.
//
// What it sends, per device, one request at a time (--delay apart): GETs of pages (only the headers are read; the body of a
// page that may hold a password or the settings is never read, never stored), and one POST: a 20-byte text file to the file
// manager (/ufsu), the test of the upload's hole, which writes only if the device lets it, is checked by the file manager and removed
// again, and is skipped with --no-upload. Every request carries the Referer header Tasmota demands (it is no credential,
// a hand on the LAN forges it), and never a password: this tool never authenticates.
//
// What it does NOT send, ever, because the request itself does something: /u1 (an OTA from a URL), /u2 and /u3 (the
// upload handlers, which restart the device when one succeeds), /u4 (switches the boot partition), /rt (resets the
// configuration), /wi (starts a Wi-Fi scan that takes the radio off its channel, and the mesh and `direct` live on it),
// and any command through /cm but Status.
//
// The output, surface.jsonl in the run directory:
//   {"kind":"surface","v":1,"t","ms","mono","device","ip","probe","method","path","class","status"|null,"verdict","content_type",
//      "content_length","challenge":bool,"rtt_ms","error"?, ...}
//       verdict: open (200) | auth (401) | redirect | forbidden | absent (404) | no-reply | error | status-N
//       for the upload: verdict accepted | auth | refused | no-reply, "written": true|false|null (null: not known), "cleanup"
//   {"kind":"surface-summary","device","password":"off|on|unknown","command_console":"open|auth|...","open_reads":[ids],
//      "open_secret_reads":[ids],"upload":verdict,"upload_file","upload_written","needs_owner_check":bool,"not_probed":[...]}
// A 401 on the upload does NOT prove that no file was written: the upload's loop checks the Referer and not the password
// (xdrv_50_filesystem.ino, HandleUploadUFSLoop), the 401 comes from the handler after it. So with a password on, the file
// is the owner's to look for, with the password, in the file manager (the summary says its name).
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  BenchError,
  JsonlWriter,
  UsageError,
  isMain,
  loadTopology,
  makeClient,
  openRunDir,
  resolveDevices,
  runMain,
  sleep,
  snapshotTopology,
  stamp,
  writeMeta,
} from "./lib/bench.mjs";

const SPEC = {
  usage: "node scripts/bench-surface.mjs --yes [--topology F --targets a,b] [name=ip ...]",
  summary: `
Which endpoints of each named device answer without a credential: the command console, the configuration pages, the downloads,
and one harmless file uploaded to the file manager. Runs only with --yes, only on the devices listed.`,
  options: {
    topology: { type: "string", help: "the topology file (with --targets)" },
    targets: { type: "list", help: "which devices of the topology, by name: they are never all taken" },
    delay: { type: "int", help: "pause between two requests to one device, ms", default: 400 },
    timeout: { type: "int", help: "HTTP timeout, ms", default: 8000 },
    "no-upload": { type: "boolean", help: "skip the harmless upload (the only write)" },
    out: { type: "string", help: "the run directory (default bench/<UTC time>)" },
    yes: { type: "boolean", help: "do it. Without it only the list of probes is printed" },
  },
};

/** The classes: page = a page; command = the console; secret = what may hold a credential or the settings, headers only. */
export const SURFACE_PROBES = [
  { id: "root", method: "GET", path: "/", class: "page", note: "the main page" },
  { id: "command-console", method: "GET", path: "/cm?cmnd=Status", class: "command", note: "the console over HTTP: a 200 means any command runs" },
  { id: "menu", method: "GET", path: "/mn", class: "page" },
  { id: "configuration", method: "GET", path: "/cn", class: "page" },
  { id: "module", method: "GET", path: "/md", class: "page" },
  { id: "template", method: "GET", path: "/tp", class: "page" },
  { id: "logging", method: "GET", path: "/lg", class: "page" },
  { id: "other", method: "GET", path: "/co", class: "page" },
  { id: "information", method: "GET", path: "/in", class: "page" },
  { id: "mqtt", method: "GET", path: "/mq", class: "secret", note: "its form holds the MQTT login" },
  { id: "console-log", method: "GET", path: "/cs?c2=0", class: "secret", note: "the log" },
  { id: "backup", method: "GET", path: "/dl", class: "secret", note: "the settings file, with the logins" },
  { id: "restore-form", method: "GET", path: "/rs", class: "page", note: "only the form: the restore itself is a POST this tool never sends" },
  { id: "upgrade-form", method: "GET", path: "/up", class: "page", note: "only the form: the upload handlers are never sent anything" },
  { id: "files", method: "GET", path: "/ufsd", class: "page", note: "the file manager" },
  { id: "file-download", method: "GET", path: "/ufsd?download=/_persist.json", class: "secret", note: "a file of the device, headers only" },
  { id: "file-editor", method: "GET", path: "/ufse", class: "page", note: "present only where the editor is built in" },
  { id: "file-upload", method: "POST", path: "/ufsu", class: "write", note: "a 20-byte text file; the upload's loop does not ask for the password" },
];

export const NOT_PROBED = [
  { path: "/u1", why: "GET /u1?o=<url> starts an OTA from a URL" },
  { path: "/u2, /u3", why: "the upload handlers: a successful one restarts the device" },
  { path: "/u4", why: "switches the boot partition and restarts" },
  { path: "/rt", why: "resets the configuration" },
  { path: "/wi", why: "starts a Wi-Fi scan that takes the radio off its channel (the mesh and direct live on it)" },
  { path: "/cm?cmnd=<anything but Status>", why: "a command does what it says" },
];

const MARKER = "bench-surface probe\n";

function multipart(boundary, name, filename, content) {
  return `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`;
}

function verdictOf(status) {
  if (status === 200) return "open";
  if (status === 401) return "auth";
  if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) return "redirect";
  if (status === 403) return "forbidden";
  if (status === 404) return "absent";
  return `status-${status}`;
}

/** What one device answers without a credential. Records go to the writer; the summary is returned. */
export async function probeDevice({ device, client, writer, delayMs = 400, upload = true, wait = sleep, run }) {
  const results = {};
  const emit = (probe, fields) => {
    const record = { kind: "surface", v: 1, ...stamp(), run, device: device.name, ip: device.ip, probe: probe.id, method: probe.method, path: probe.path, class: probe.class, ...fields };
    writer.append(record);
    results[probe.id] = record;
    return record;
  };
  const request = async (probe, options) => {
    try {
      const res = await client.get(device.ip, options.path ?? probe.path, options);
      return { res };
    } catch (e) {
      if (e.code === "write-blocked") throw e;
      return { error: e };
    }
  };
  for (const probe of SURFACE_PROBES.filter((p) => p.method === "GET")) {
    const { res, error } = await request(probe, { headersOnly: true });
    if (error) {
      emit(probe, { status: null, verdict: error.code === "no-reply" ? "no-reply" : "error", error: error.message, code: error.code });
    } else {
      emit(probe, {
        status: res.status,
        verdict: verdictOf(res.status),
        content_type: res.headers["content-type"] ?? null,
        content_length: res.headers["content-length"] !== undefined ? Number(res.headers["content-length"]) : null,
        challenge: Boolean(res.headers["www-authenticate"]),
        location: res.headers.location ? String(res.headers.location).replace(/^https?:\/\/[^/]+/, "") : undefined,
        rtt_ms: res.rttMs,
      });
    }
    await wait(delayMs);
  }
  // the upload, the only write
  const probe = SURFACE_PROBES.find((p) => p.id === "file-upload");
  let file = null;
  if (upload) {
    file = `bench-surface-probe-${randomBytes(4).toString("hex")}.txt`;
    const boundary = `----bench${randomBytes(6).toString("hex")}`;
    const body = multipart(boundary, "ufsu", file, MARKER);
    const shown = { ...probe, path: "/ufsu?fsz=20" };
    let fields;
    try {
      const res = await client.raw(device.ip, { method: "POST", path: `/ufsu?fsz=${Buffer.byteLength(MARKER)}`, headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` }, body });
      const ok = res.status === 200 && /success/i.test(res.body ?? "");
      fields = {
        status: res.status,
        verdict: ok ? "accepted" : res.status === 401 ? "auth" : res.status === 200 ? "refused" : verdictOf(res.status),
        challenge: Boolean(res.headers["www-authenticate"]),
        rtt_ms: res.rttMs,
        file,
        written: null,
        cleanup: "not needed",
      };
    } catch (e) {
      if (e.code === "write-blocked") throw e;
      fields = { status: null, verdict: e.code === "no-reply" ? "no-reply" : "error", error: e.message, code: e.code, file, written: null, cleanup: "not needed" };
    }
    if (fields.verdict === "accepted") {
      // is it there? and then it is removed: only the file this run made, by its exact name
      await wait(delayMs);
      const check = await request(probe, { path: `/ufsd?download=/${file}`, maxBytes: 4096 });
      fields.written = check.res ? check.res.status === 200 && (check.res.body ?? "").includes("bench-surface probe") : null;
      if (fields.written) {
        await wait(delayMs);
        const del = await request(probe, { path: `/ufsd?delete=/${file}`, write: true });
        await wait(delayMs);
        const gone = await request(probe, { path: `/ufsd?download=/${file}`, maxBytes: 4096 });
        fields.cleanup = del.res && gone.res && !(gone.res.body ?? "").includes("bench-surface probe") ? "removed" : `failed: remove /${file} by hand`;
      }
    }
    // written once the checks are in, so that the line holds what they found
    emit(shown, fields);
  }
  const verdicts = Object.fromEntries(Object.entries(results).map(([id, r]) => [id, r.verdict]));
  const cmd = verdicts["command-console"];
  const password = cmd === "open" ? "off" : cmd === "auth" ? "on" : "unknown";
  const up = results["file-upload"];
  const summary = {
    kind: "surface-summary",
    v: 1,
    ...stamp(),
    run,
    device: device.name,
    ip: device.ip,
    password,
    command_console: cmd ?? "unknown",
    open_reads: SURFACE_PROBES.filter((p) => p.class !== "write" && verdicts[p.id] === "open").map((p) => p.id),
    open_secret_reads: SURFACE_PROBES.filter((p) => p.class === "secret" && verdicts[p.id] === "open").map((p) => p.id),
    upload: up ? up.verdict : "skipped",
    upload_file: up?.file ?? null,
    upload_written: up ? up.written : null,
    needs_owner_check: Boolean(up && up.verdict === "auth"),
    not_probed: NOT_PROBED.map((n) => n.path),
  };
  writer.append(summary);
  return summary;
}

export function describeProbes(devices, upload) {
  const lines = [];
  for (const d of devices) {
    lines.push(`${d.name} ${d.ip}:`);
    for (const p of SURFACE_PROBES) {
      if (p.class === "write" && !upload) continue;
      lines.push(`  ${p.method} ${p.path} (${p.class}${p.class === "secret" ? ", headers only" : ""})${p.note ? ` -- ${p.note}` : ""}`);
    }
  }
  lines.push("never sent:");
  for (const n of NOT_PROBED) lines.push(`  ${n.path} -- ${n.why}`);
  return lines;
}

export async function main({ values, positional }) {
  const topology = values.topology ? loadTopology(values.topology) : null;
  if (topology && !values.targets) throw new UsageError("--topology needs --targets: the devices are named one by one, never all taken");
  if (!topology && positional.length === 0) throw new UsageError("name the devices: name=ip arguments, or --topology with --targets");
  const devices = resolveDevices({ topology, positional, only: values.targets ? values.targets.concat(positional.map((p) => (p.includes("=") ? p.split("=")[0] : p))) : null });
  if (devices.length === 0) throw new BenchError("no-targets", "no device to probe");
  console.log(`bench-surface: ${values.yes ? "RUNNING" : "DRY RUN, nothing is sent"}, ${devices.length} device(s)`);
  for (const line of describeProbes(devices, !values["no-upload"])) console.log(line);
  if (!values.yes) {
    console.log("Nothing was sent. Run again with --yes.");
    return 0;
  }
  const dir = openRunDir(values.out);
  snapshotTopology(dir, topology);
  const writer = new JsonlWriter(join(dir, "surface.jsonl"));
  writeMeta(dir, "bench-surface", { started: stamp().t, argv: process.argv.slice(2), devices: devices.map((d) => d.name) });
  const client = makeClient({ timeoutMs: values.timeout, allowWrites: true });
  const run = stamp().ms;
  try {
    for (const device of devices) {
      const s = await probeDevice({ device, client, writer, delayMs: values.delay, upload: !values["no-upload"], run });
      console.log(`${device.name}: password ${s.password}; open without a credential: ${s.open_reads.join(", ") || "nothing"}; upload ${s.upload}${s.needs_owner_check ? ` (look for ${s.upload_file} in the file manager, with the password)` : ""}`);
    }
  } finally {
    await writer.close();
    writeMeta(dir, "bench-surface", { ended: stamp().t, lines: writer.count });
  }
  console.log(`written to ${dir}`);
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = await runMain(SPEC, process.argv.slice(2), main);
