#!/usr/bin/env node
// Serves ONE file over plain HTTP for the panel's `FlashNextion <url>`
// command, with HTTP Range support and a log line per request.
//
//   node scripts/serve-tft.mjs <file.tft> [port]      (default port 8000)
//
// Why not `python -m http.server`: it ignores the `Range` header and
// answers 200 with the whole file. The Berry driver (berry/nextion_driver.be,
// open_url_at) sends `Range: bytes=<offset>-` when the panel asks to
// resume at an offset (the 0x08 reply that skips the unchanged resource
// region), and a server that ignored it would stream the file from byte 0
// while the panel writes it at <offset>. This server honours Range (206 +
// Content-Range), answers HEAD, and refuses anything else.
//
// What it serves is the file as it was read at startup, whole, and only at its
// own path: a rebuild while it runs, or between the first GET and the ranged
// one, would otherwise hand the panel two halves of two files. And it serves
// nothing that fails the local pre-flight: a file the panel would
// take and then be left deaf by, at another serial rate, never leaves this
// machine. The pre-flight needs libs/nspanel-sim built (`npm test` there).
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const file = process.argv[2];
const port = Number(process.argv[3] ?? 8000);
if (!file) {
  console.error("usage: node scripts/serve-tft.mjs <file.tft> [port]");
  process.exit(2);
}
const bytes = readFileSync(file);
const size = bytes.length;
const name = path.basename(file);
const sha = createHash("sha256").update(bytes).digest("hex");

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "libs", "nspanel-sim", "export", "dist", "index.js");
if (!existsSync(dist)) {
  console.error(`the pre-flight is not built (${dist}): run \`npm test\` in libs/nspanel-sim first`);
  process.exit(2);
}
const { preflightTft, NSPANEL_EU_LANDSCAPE, NSPANEL_US_PORTRAIT } = await import(pathToFileURL(dist).href);
// a portrait file is for the US panel, anything else for the EU one, as scripts/preflight-tft.mjs decides
const us = /portrait|_US_P/i.test(name);
const verdict = preflightTft(new Uint8Array(bytes.buffer, bytes.byteOffset, size), us ? NSPANEL_US_PORTRAIT : NSPANEL_EU_LANDSCAPE);
const blocking = verdict.checks.filter((c) => !c.ok && c.severity === "block");
for (const c of verdict.checks) if (!c.ok) console.log(`  ${c.severity === "block" ? "FAIL" : "warn"} ${c.id}: ${c.detail}`);
if (blocking.length) {
  console.error(`${name} fails the pre-flight for the ${us ? "US portrait" : "EU landscape"} panel: not served`);
  process.exit(1);
}

const server = createServer((req, res) => {
  const stamp = new Date().toISOString().slice(11, 19);
  const from = req.socket.remoteAddress;
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    console.log(`${stamp} ${from} ${req.method} ${req.url} -> 405`);
    return;
  }
  if (decodeURIComponent(req.url.split("?")[0]) !== `/${name}`) {
    res.writeHead(404).end();
    console.log(`${stamp} ${from} ${req.method} ${req.url} -> 404 (this server has /${name} only)`);
    return;
  }
  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!m || Number(m[1]) >= size) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
      console.log(`${stamp} ${from} ${req.method} ${req.url} Range=${range} -> 416`);
      return;
    }
    start = Number(m[1]);
    if (m[2]) end = Math.min(Number(m[2]), size - 1);
    status = 206;
  }
  const headers = {
    "Content-Type": "application/octet-stream",
    "Content-Length": end - start + 1,
    "Accept-Ranges": "bytes",
    "Connection": "close",
  };
  if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  res.writeHead(status, headers);
  console.log(`${stamp} ${from} ${req.method} ${req.url}${range ? " Range=" + range : ""} -> ${status}, ${end - start + 1} bytes from ${start}`);
  if (req.method === "HEAD") { res.end(); return; }
  res.end(bytes.subarray(start, end + 1));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`serving ${file} (${size} bytes, sha256 ${sha}), checked for the ${us ? "US portrait" : "EU landscape"} panel, on port ${port}`);
  for (const [ifname, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) {
        console.log(`  FlashNextion http://${a.address}:${port}/${name}    (${ifname})`);
      }
    }
  }
  console.log("Ctrl+C to stop.");
});
