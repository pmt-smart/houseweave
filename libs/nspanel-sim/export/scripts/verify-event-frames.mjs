// Every declared event's frame, found inside the compiled `.tft`
// (scripts/lib/eventFrames.mjs has the check, and why it looks as it does).
//
//   node scripts/verify-event-frames.mjs p1-living-room-eu-landscape
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eventFrames } from "./lib/eventFrames.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const name = process.argv[2] ?? "p1-living-room-eu-landscape";
const tft = new Uint8Array(readFileSync(join(root, "hmi-scenarios", "out", `${name}.tft`)));
const runtime = JSON.parse(readFileSync(join(root, "hmi-scenarios", `${name}.runtime.json`), "utf8"));

let bad = 0;
for (const { event, at } of eventFrames(tft, runtime)) {
  const ok = at.length === 1;
  if (!ok) bad++;
  console.log(
    `${ok ? "ok  " : "FAIL"}  ${`${event.page}/${event.objname}`.padEnd(24)} ${event.gesture.padEnd(5)}` +
    ` -> ${event.event.padEnd(14)} ${at.length === 0 ? "not in the .tft" : at.length === 1 ? `at 0x${at[0].toString(16)}` : `${at.length} times`}`,
  );
}
console.log(`\n${runtime.events.length - bad} of ${runtime.events.length} frames present, exactly once`);
if (bad > 0) process.exitCode = 1;
