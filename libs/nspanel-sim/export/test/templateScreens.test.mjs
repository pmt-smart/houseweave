// The screens a template generates are written INTO project.json (the zone, the
// list and its short twin, the confirmation, Help and the lock): 30 of the 39
// placements on the EU, 37 of the 46 on the US. Nothing else reads the
// templates, so a template changed and not run again would leave every panel on
// the old geometry, and the simulator with it, with nothing to say so.
// This runs the generator's own --check on every project that
// ships: the same code that writes them, told to compare instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = resolve(root, "..");
const script = join(root, "scripts", "build-settings-screens.mjs");
const ready = existsSync(join(workspace, "layout", "dist", "index.js")) && existsSync(join(workspace, "core", "dist", "index.js"));
const skip = !ready && "run `npm run build --workspace=core --workspace=layout` first";

const projects = readdirSync(join(workspace, "projects")).filter((id) => !id.startsWith("guard-") && existsSync(join(workspace, "projects", id, "project.json")));

test("every project holds the template screens as the templates generate them now", { skip }, () => {
  assert.ok(projects.length >= 3, "the three shipped projects");
  for (const id of projects) {
    const theme = JSON.parse(readFileSync(join(workspace, "projects", id, "project.json"), "utf8")).themes[0];
    const r = spawnSync(process.execPath, [script, id, theme, "--check"], { encoding: "utf8" });
    assert.equal(r.status, 0, `${id}: ${r.stderr || r.stdout}`);
  }
});

test("a template screen that drifted from its template is caught", { skip }, () => {
  // a copy, never the real project: an edit in place can lose an uncommitted
  // change
  const id = "guard-template-drift";
  const dir = join(workspace, "projects", id);
  try {
    const doc = JSON.parse(readFileSync(join(workspace, "projects", "living-room", "project.json"), "utf8"));
    // an edit the funnel takes, so that only the check has anything to say
    doc.layouts["eu-landscape"].screens.find((s) => s.id === "zone").title = "Room";
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "project.json"), JSON.stringify({ ...doc, id }, null, 2) + "\n");
    const r = spawnSync(process.execPath, [script, id, "lovelace-jobr99", "--check"], { encoding: "utf8" });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /does not hold what the templates generate now/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
