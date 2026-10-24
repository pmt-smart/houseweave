// The bench's checks (src/bench.ts), run on this emulator for every project the
// Living room compiles to: every touch the runtime manifest declares has a check, the
// finger lands where the check means it to, and the frame the manifest
// declares is the one the page sends. The same checks go to the Nextion
// Editor's debugger (export/scripts/panel-bench.mjs); this is the half that
// needs no Editor, and it runs in CI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BenchOracle, benchSessions, fontOf, pictureOf, readScenario } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const SCENARIOS = join(here, "..", "..", "export", "hmi-scenarios");
const PROJECTS = ["living-room", "living-room-shadcn", "living-room-tailwind"].flatMap((p) =>
  ["eu-landscape", "us-portrait"].map((d) => `p1-${p}-${d}`));

function load(name) {
  const json = JSON.parse(readFileSync(join(SCENARIOS, `${name}.json`), "utf8"));
  const manifest = JSON.parse(readFileSync(join(SCENARIOS, `${name}.runtime.json`), "utf8"));
  const hmi = readScenario(json);
  const [width, height] = name.endsWith("portrait") ? [320, 480] : [480, 320];
  const project = { name, width, height, hmi, events: manifest.events, bindings: manifest.bindings };
  const oracle = new BenchOracle(hmi, {
    width, height,
    fonts: hmi.fonts.map((f) => fontOf(readFileSync(join(SCENARIOS, f)))),
    pictures: hmi.pictures.map(pictureOf),
  });
  return { project, manifest, oracle };
}

for (const name of PROJECTS) {
  test(`${name}: every touch the manifest declares has a check, and sends its frame`, () => {
    const { project, manifest, oracle } = load(name);
    const sessions = benchSessions(project);
    const ids = new Set(sessions.flatMap((s) => s.checks.map((c) => c.id)));
    for (const e of manifest.events) {
      if (e.gesture === "show" || e.gesture === "version") continue;
      assert.ok(ids.has(`${e.page}/${e.objname}.${e.gesture}`), `no check for ${e.page} ${e.objname} ${e.gesture}`);
    }
    const problems = [];
    for (const s of sessions) {
      for (const c of s.checks) {
        const out = oracle.run(c);
        const frames = out.messages.filter((m) => m.kind === "frame").map((m) => m.text);
        for (const want of c.declares)
          if (!frames.some((f) => f === want || f.startsWith(want + ","))) problems.push(`${c.id}: wanted "${want}", sent ${JSON.stringify(frames)}`);
        if (c.target && !out.landed.every((l) => l === c.target)) problems.push(`${c.id}: the finger landed on ${JSON.stringify(out.landed)}, not ${c.target}`);
        const refused = out.messages.filter((m) => m.kind === "reply");
        if (refused.length) problems.push(`${c.id}: the glass answered ${refused.map((m) => m.text).join(", ")}`);
        if (c.count === "exact" && c.declares.length === 0 && out.sent.length) problems.push(`${c.id}: sent ${out.sent.length} bytes where it should send none`);
      }
    }
    assert.deepEqual(problems, []);
  });
}

test("a frame and a reply are told apart the way the glass wrote them", async () => {
  const { benchMessages } = await import("../dist/index.js");
  const text = new TextEncoder().encode("ev,zone,mRow6,tap,0");
  const frame = [0x55, 0xbb, text.length, 0, ...text, 0x12, 0x34];
  const got = benchMessages(Uint8Array.from([...frame, 0x1a, 0xff, 0xff, 0xff]));
  assert.deepEqual(got.map((m) => [m.kind, m.bytes, m.text]), [["frame", text.length + 6, "ev,zone,mRow6,tap,0"], ["reply", 4, "1a"]]);
});
