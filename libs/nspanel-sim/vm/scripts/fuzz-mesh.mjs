// Frames from the air, with the tag right and everything else hostile, into a node of the core built with the sanitizers:
//
//   MESH_SANITIZE_OUT=/tmp/mesh.asan.mjs node scripts/build-mesh-wasm.mjs
//   MESH_SANITIZE_OUT=/tmp/mesh.asan.mjs node scripts/fuzz-mesh.mjs [seed] [plain|udp|toy|real] [frames]
//
// A report of the address sanitizer or of the undefined-behaviour one stops the run and is printed. The frames carry a
// valid tag (the tag is what the core checks before it parses), a type, a kind, a number and a payload at random, with the
// shapes of each type's own payloads, so that the parsers of the heartbeat, the bulk transfer and the sync get hit.
import { pathToFileURL } from "node:url";

const moduleFile = process.env.MESH_SANITIZE_OUT;
if (!moduleFile) { console.error("MESH_SANITIZE_OUT names the sanitized module (see the top of this file)"); process.exit(1); }
const createMeshModule = (await import(pathToFileURL(moduleFile).href)).default;
const mod = await createMeshModule({ print: () => {}, printErr: (l) => console.error(l) });
let seed = Number(process.argv[2] ?? 1) >>> 0 || 1;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed; };
const pick = (a) => a[rnd() % a.length];
const range = (lo, hi) => lo + (rnd() % (hi - lo + 1));

const inP = mod._malloc(512), outP = mod._malloc(512), srcP = mod._malloc(16), toP = mod._malloc(16), metaP = mod._malloc(16), payP = mod._malloc(512);
const MODE = process.argv[3] ?? "plain";
const cipher = MODE === "real" ? 2 : MODE === "toy" ? 1 : 0;
mod._mesh_begin(0, 1, 3, 99, 1, -70, 2, 5000, 0, cipher, 0, MODE === "udp" ? 1 : 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1);   // with the ask at start, which the first ticks send, the choice of repeaters from the first neighbour, and the mesh clock
if (MODE === "udp") mod._mesh_set_udp(0, 1);
// forty origins: more than the tables of 16 of before held, fewer than the 48 of now, and the frames of the others (0, 1, 255, 77) beyond them
const origins = Array.from({ length: 40 }, (_, i) => i + 2);
const epochs = new Map();
for (const o of origins) { epochs.set(o, 5); mod._mesh_synced(0, o, 5, 0); }
const counters = new Map(origins.map((o) => [o, 0]));
if (cipher === 2) {
  // a node with the real cipher needs the others' public keys: the module builds the same identities from the numbers
  for (const o of origins) {
    const slot = o; // a second slot for each, only to read its public key
    mod._mesh_begin(slot, o, 5, 7, 1, -70, 2, 5000, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    mod._mesh_identity(slot, outP);
    mod._mesh_set_peer(0, o, outP);
  }
}

let heard = 0, accepted = 0;
let curTimeline = [1, 0, 0, 0, 3];                        // the timeline the node counts on, read now and then, so that heartbeats of the same one come (the clock follows them)
let now = 1000;
const verdicts = new Map();
const N = Number(process.argv[4] ?? 60000);
for (let i = 0; i < N; i++) {
  const origin = rnd() % 40 === 0 ? pick([0, 1, 255, 77]) : pick(origins);
  const type = rnd() % 3 === 0 ? 4 : rnd() % 8;
  const kind = (type << 5) | ((rnd() & 1) << 4) | ((rnd() & 3) << 2) | (rnd() & 3);
  let payload;
  const L = rnd() % 4 === 0 ? range(0, 228) : range(0, 30);
  payload = Array.from({ length: L }, () => rnd() & 255);
  if (type === 4) { payload[0] = range(0, 6); if (payload[0] === 0 && L > 3) { payload[1] = rnd() & 1; payload[2] = rnd() % 40; payload[3] = rnd() % 60; } }
  // a heartbeat that is whole: the neighbours it hears, from the origins this node knows, and then the repeaters it has chosen, as many as it says or a count that lies
  let beat = false;
  if (type === 4 && rnd() % 2 === 0) {
    beat = true;
    // half of them carry a clock in the application's bytes: the layout (or not), a timeline that is one of a few so that they meet, and a time that is zero, near the node's own, huge or anything
    const clocked = rnd() % 2 === 0;
    const info = clocked ? range(17, 32) : rnd() % 4, heardN = rnd() % 30, chosenN = rnd() % 8;
    const timeAt = pick([0, 1, 1000, now, now + range(-60, 60), now + range(0, 4000), now + 3_600_000, now + 3_600_001, 2 ** 31, 2 ** 32 + 5, 2 ** 47, 2 ** 48 - 1, rnd() * 4096]);
    const clockBytes = [rnd() % 9 === 0 ? rnd() & 255 : 1, ...(rnd() % 3 === 0 ? curTimeline : [pick([origin, 1, 2, 77, rnd() & 255]), 0, 0, 0, pick([3, 5, 9, 200])]), ...Array.from({ length: 6 }, (_, k) => Math.floor(Math.max(0, timeAt) / 2 ** (8 * (5 - k))) & 255)];
    const infoBytes = clocked ? [...clockBytes, ...Array.from({ length: Math.max(0, info - clockBytes.length) }, () => rnd() & 255)].slice(0, info) : Array.from({ length: info }, () => rnd() & 255);
    payload = [0, rnd() & 1, info, ...infoBytes, heardN, ...Array.from({ length: heardN }, () => [pick(rnd() % 3 === 0 ? [1, 0, 255] : origins), 0x80 | (rnd() & 0x3f)]).flat(), rnd() % 9 === 0 ? 200 : chosenN, ...Array.from({ length: rnd() % 12 }, () => pick(rnd() % 3 === 0 ? [1, 0] : origins))];
    if (rnd() % 7 === 0) payload.length = range(0, payload.length);
  }
  if (type === 5 && L > 5) { payload[0] = rnd() % 4; payload[3] = rnd() % 40; payload[4] = rnd() % 40; }
  if (type === 7 && L > 0) payload[0] = rnd() % 4;
  const epoch = rnd() % 60 === 0 ? pick([4, 6, 7, 0xffffffff]) : 5;
  let counter;
  if (rnd() % 5 === 0) counter = rnd() >>> 0; else { counter = (counters.get(origin) ?? 0) + range(0, 3) - (rnd() % 4 === 0 ? 40 : 0); counter = Math.max(1, counter); if (origins.includes(origin)) counters.set(origin, Math.max(counters.get(origin), counter)); }
  const dest = beat ? 255 : rnd() % 2 ? 1 : pick([255, 1, 2, 3, 200]);
  const next = !beat && rnd() % 12 === 0 ? pick([1, 1, 2, 7]) : 0;
  const hops = beat ? 0 : range(0, 4);
  mod.HEAPU8.set(payload, payP);
  const n = mod._mesh_encode(kind, origin, dest, next, hops, epoch, counter >>> 0, payP, payload.length, 1, inP);
  if (n <= 0) continue;
  if (cipher) mod._mesh_tag_as(0, inP, n);
  mod.HEAPU8.set([0x24, 0x0a, 0xc4, 0, 0, pick([...origins, 0, 1, 200])], srcP);
  now += range(0, 40);
  const v = mod._mesh_receive(0, inP, n, srcP, -pick([40, 60, 75, 89]), now >>> 0, MODE === "udp" && rnd() % 2 ? 1 : 0);
  verdicts.set(v, (verdicts.get(v) ?? 0) + 1);
  heard++;
  if (v === 0 || v === 1) accepted++;
  if (i % 25 === 0) for (const o of origins) mod._mesh_synced(0, o, 5, (counters.get(o) ?? 0) - 2 > 0 ? (counters.get(o) ?? 0) - 2 : 0);
  if (i % 5 === 0) mod._mesh_tick(0, now >>> 0);
  if (i % 3 === 0) {
    for (let k = 0; k < 4; k++) {
      const len = mod._mesh_next_tx(0, now >>> 0, outP, toP, metaP);
      if (len <= 0) break;
      mod._mesh_tx_done(0, rnd() % 4 ? 1 : 0, now >>> 0);
    }
  }
  if (i % (MODE === "plain" ? 40 : 7) === 0) { while (mod._mesh_pop(0, outP) > 0);   // the plain run drains slowly, so the inbox fills and the node says no
    while (mod._mesh_pop_outcome(0, outP) > 0); while (mod._mesh_pop_notice(0, outP) > 0); }
  // the counter of the node near the end of its 32 bits, now and then: it takes the next epoch, and numbers from 1
  if (i % 9973 === 0) mod._mesh_advance_counter(0, 0xfffeff00 + (rnd() % 0x300));
  if (i % 50 === 0) { mod.HEAPU8.set([1, 2, 3], payP); mod._mesh_send(0, pick([0, 2, 3]), pick([255, 2, 3]), payP, range(0, 60), rnd() & 1, now >>> 0); }
  if (i % 997 === 0) { for (let j = 0; j < 48; j++) { mod._mesh_neighbor(0, j, outP, now >>> 0); } }
  // the clock: read, stamped, a stamp aged (of any length), and what it told the application taken; the application's bytes in the heartbeat of any length
  if (i % 211 === 0) {
    mod._mesh_clock(0, now >>> 0, outP); curTimeline = Array.from(mod.HEAPU8.slice(outP + 2, outP + 7)); mod._mesh_clock_stamp(0, now >>> 0, outP);
    const len = pick([6, 6, 6, 0, 1, 5, 7, 40]);
    mod.HEAPU8.set(Array.from({ length: len }, () => rnd() & 255), payP);
    mod._mesh_clock_age(0, (now - range(0, 5000)) >>> 0, now >>> 0, payP, len, outP);
    while (mod._mesh_pop_clock_event(0, outP) > 0);
  }
  if (i % 313 === 0) { const len = range(0, 40); mod.HEAPU8.set(Array.from({ length: len }, () => rnd() & 255), payP); mod._mesh_set_info(0, payP, len); }
  // what the node says of its surroundings and of its peers, from whatever the heartbeats left in its tables
  if (i % 101 === 0) { mod._mesh_health(0, now >>> 0, outP); for (const o of [origins[0], origins[7], 77, 200]) mod._mesh_peer_role(0, o, now >>> 0); }
}
// let everything come due
while (mod._mesh_pop_clock_event(0, outP) > 0);
for (let t = 0; t < 400; t++) { now += 100; mod._mesh_tick(0, now >>> 0); while (mod._mesh_next_tx(0, now >>> 0, outP, toP, metaP) > 0) mod._mesh_tx_done(0, 1, now >>> 0); }
console.log(`${MODE}: ${heard} frames, ${accepted} taken; verdicts`, Object.fromEntries([...verdicts.entries()].sort((a, b) => a[0] - b[0])));
console.log(`${MODE}: the clock stepped ${mod._mesh_stat(0, 47)} times, took ${mod._mesh_stat(0, 48)} timelines, and lost ${mod._mesh_stat(0, 49)} events to a full queue`);
