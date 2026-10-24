// Fetches the third-party .tft (and .HMI) files listed in fixtures/manifest.json
// into fixtures/cache/, verifying size and SHA-256 of every file. The
// binaries are other projects' compiled output and are not versioned
// here; the manifest (URL + hash) is, so the corpus the tests run
// against is reproducible without redistributing it.
//
//   node scripts/fetch-fixtures.mjs             download what is missing
//   node scripts/fetch-fixtures.mjs --from DIR  copy from a local mirror
//                                               laid out as <source>/<file>
//   node scripts/fetch-fixtures.mjs --check     only verify what is cached
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const manifest = JSON.parse(readFileSync(join(root, "fixtures", "manifest.json"), "utf8"));
const cache = join(root, "fixtures", "cache");

const args = process.argv.slice(2);
const fromIdx = args.indexOf("--from");
const mirror = fromIdx >= 0 ? resolve(args[fromIdx + 1]) : null;
const checkOnly = args.includes("--check");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function verify(entry, buf) {
  if (buf.length !== entry.bytes) return `size ${buf.length} != ${entry.bytes}`;
  const h = sha256(buf);
  if (h !== entry.sha256) return `sha256 ${h} != ${entry.sha256}`;
  return null;
}

let ok = 0, missing = 0, bad = 0;
// manifest.files: compiled .tft; manifest.hmi: Editor project sources
// (.HMI, ~7 MB each — the Editor pre-allocates 7 MB per project).
for (const entry of [...manifest.files, ...(manifest.hmi ?? [])]) {
  const target = join(cache, entry.name);
  mkdirSync(dirname(target), { recursive: true });

  if (existsSync(target)) {
    const err = verify(entry, readFileSync(target));
    if (!err) { ok++; continue; }
    console.log(`stale  ${entry.name}: ${err}`);
    if (checkOnly) { bad++; continue; }
  } else if (checkOnly) {
    console.log(`absent ${entry.name}`);
    missing++;
    continue;
  }

  let buf;
  if (mirror) {
    const src = join(mirror, entry.name);
    if (!existsSync(src)) { console.log(`absent ${entry.name} (not in mirror)`); missing++; continue; }
    buf = readFileSync(src);
  } else {
    const res = await fetch(entry.url);
    if (!res.ok) { console.log(`fail   ${entry.name}: HTTP ${res.status}`); bad++; continue; }
    buf = Buffer.from(await res.arrayBuffer());
  }

  const err = verify(entry, buf);
  if (err) { console.log(`reject ${entry.name}: ${err}`); bad++; continue; }
  writeFileSync(target, buf);
  console.log(`ok     ${entry.name} (${entry.bytes} bytes)`);
  ok++;
}

console.log(`\n${ok} verified, ${missing} missing, ${bad} rejected`);
process.exit(bad ? 1 : 0);
