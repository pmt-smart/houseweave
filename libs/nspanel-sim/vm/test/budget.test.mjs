// The panel's budgets as guards that stop the tests.
// A panel is planned for up to twice the Living room, the house's biggest
// room: at that, with the house's broker and its server up and paired, so the MQTT,
// the backup and the HTTP come up as on the wall, the brain's live heap with the
// biggest zone on the glass stays under what the panel leaves it, and the backup
// it sends under what it reads back. The numbers are the simulator's, and
// provisional until the bench. The file system's room is the
// build's guard (firmware/overrides/panel_files.py).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SimHouse, SimPanel, SimBridge, networkOf } from "../dist/index.js";
import { repoFiles, bridgeFiles, livingRoomConfig, houseFlash, REPO } from "../dist/files-node.js";
import { Glass, readScenario, fontOf, pictureOf, textOf } from "@nspanel-sim/glass";
import { houseServer } from "./house-server.mjs";

const SCENARIOS = join(REPO, "libs/nspanel-sim/export/hmi-scenarios");

/** how many times the Living room a panel is planned for */
const TIMES = 2;
/**
 * The heap the brain may keep live, in KB: the ~99 KB the panel leaves it -- the
 * 176 KB free measured on the bench, less the 60 KB floor, the ~7 KB the brain
 * asks of the firmware and the ~10 KB of garbage between collections -- less the
 * ~16 KB Z2T's device table of two Living rooms took from the same heap in local mode,
 * where the panel was the coordinator. The local mode and the panel's
 * Z2T are gone, and the 16 KB stay out until the bench measures the
 * image without them: the 176 KB were measured on one with Z2T compiled in.
 */
const CEILING_KB = 83;

/**
 * The Living room n times: each copy with its zones on a screen of its own and Zigbee
 * devices of its own, its names one letter longer; the panel's 4 relay devices
 * once, as a panel has them. From `base`, the Living room as the house's
 * flash has it: its groups in the numbers the panel's place in the house gives
 * them, and the copies' after them.
 */
function livingRoomTimes(n, base = livingRoomConfig()) {
  const doc = JSON.parse(JSON.stringify(base));
  const devices = [...doc.devices];
  const zones = [...doc.zones];
  const screens = [...doc.screens];
  let zid = doc.nextZid;
  for (let k = 1; k < n; k++) {
    const zigbee = (dev) => dev.startsWith("0x");
    const id = (dev) => `0x00124B00${k.toString(16).padStart(2, "0")}${dev.slice(12)}`;
    const copy = (m) => Object.fromEntries(Object.entries(m ?? {}).filter(([dev]) => zigbee(dev)).map(([dev, v]) => [id(dev), v]));
    for (const d of doc.devices) if (zigbee(d[0])) devices.push([id(d[0]), d[1] + String.fromCharCode(97 + k), ...d.slice(2)]);
    const screen = `s${k}`;
    screens.push({ id: screen, title: `Living room ${k + 1}`, cards: doc.screens[0].cards.map(([ref, ...at]) => [`${ref}${k}`, ...at]) });
    for (const z of doc.zones) {
      zones.push({ ...z, id: `${z.id}${k}`, name: `${z.name} ${k + 1}`, screen, buttons: [], zid: z.zid !== 0 ? zid++ : 0,
        members: copy(z.members), zstate: copy(z.zstate) });
    }
  }
  return { ...doc, devices, zones, screens, nextZid: zid };
}

/** the panel's live Berry heap, in bytes: two full collections, then what is allocated */
function heapOf(panel) {
  assert.equal(panel.vm.run("def _heap() import gc gc.collect() gc.collect() return str(gc.allocated()) end", "heap"), 0, panel.vm.error());
  return () => Number(panel.vm.call("_heap"));
}

/** what the persist module takes of the heap here, in KB: a file in the simulator, in the panel's flash */
async function persistCodeKB() {
  const panel = await SimPanel.create({ files: repoFiles(), persist: {}, relays: [true, true] });
  const heap = heapOf(panel);
  const before = heap();
  assert.equal(panel.vm.run("import persist", "persist"), 0, panel.vm.error());
  return (heap() - before) / 1024;
}

/**
 * A panel with twice the Living room, on a house with its broker and its server, paired
 * on the panel: the heap above the classes and the modules the
 * firmware has in its flash, after 20 s and a backup the server asked for, and
 * with the Middle, the biggest zone, on the glass; and the backup the server got.
 */
async function measure(device) {
  const project = `p1-living-room-${device}`;
  const eu = device === "eu-landscape";
  const broker = { host: "192.168.0.10", user: "home", password: "secret" };
  const home = new SimHouse({ broker });
  await home.enableMesh();
  const hmi = readScenario(JSON.parse(readFileSync(join(SCENARIOS, `${project}.json`), "utf8")));
  const log = [];
  const early = [];
  let panel;
  const glass = new Glass(hmi, {
    width: eu ? 480 : 320,
    height: eu ? 320 : 480,
    fonts: hmi.fonts.map((f) => fontOf(readFileSync(join(SCENARIOS, f)))),
    pictures: hmi.pictures.map(pictureOf),
    send: (b) => (panel ? panel.uartReceive(b) : early.push(b)),
  });
  // the panel's Zigbee is its house's bridge's: the two from the flash of a house made once, with the lamps on the bridge's network
  const flash = await houseFlash();
  const doc = livingRoomTimes(TIMES, flash.panel.persist.panel_config);
  const epoch = Date.UTC(2026, 9, 4, 12, 0, 0) / 1000;
  const bridge = await SimBridge.create({ ...flash.bridge, house: home, files: bridgeFiles(), epoch, timezone: 0 });
  panel = await SimPanel.create({
    ...flash.panel,
    house: home, files: repoFiles(project), project,
    persist: { ...flash.panel.persist, panel_config: doc },
    relays: [true, true], mqtt: { ...broker, port: 1883 },
    epoch, timezone: 0,
    onLog: (level, line) => log.push(`[L${level}] ${line}`),
    onUart: (b) => glass.receive(b),
  });
  for (const { spec, groups } of networkOf(doc)) bridge.zigbee.add(spec, groups);
  for (const b of early) panel.uartReceive(b);
  glass.start();
  const heap = heapOf(panel);
  // the modules native on the panel are files here: their code before the boot, as the classes'
  assert.equal(panel.vm.run("import mqtt import path import crypto import webserver import gpio", "natives"), 0, panel.vm.error());
  const base = heap();
  const run = (ms) => {
    for (let t = 0; t < ms; t += 5) {
      home.advance(5);
      glass.advance(5);
    }
  };
  const tap = (x, y, hold = 60) => {
    glass.press(x, y);
    run(hold);
    glass.release();
    run(400);
  };
  run(10000);
  // the house's server, paired on the panel as the owner pairs it, and its Backup of the panel (house.test.mjs runs the same)
  const server = await houseServer(home, panel, { run });
  run(5000);
  await server.fleet.ask(server.node(panel), "backup");
  for (let t = 0; t < 5000 && !server.backupOf(panel); t += 100) run(100);
  run(5000);
  const booted = heap();
  // the screensaver's tap, and the Middle's card held: its lamps' joint page, whose card is the zone's screen
  tap(eu ? 240 : 160, eu ? 160 : 240);
  tap(eu ? 260 : 240, eu ? 160 : 250, 800);
  run(1000);
  const card = glass.components().find((c) => c.def.type === "Button" && /^bRow/.test(c.def.objname));
  if (card) tap(card.def.x + card.def.w / 2, card.def.y + card.def.h / 2);
  run(1000);
  const zone = heap();
  assert.equal(panel.vm.run("def _max() return str(PanelHttp.MAX) end", "max"), 0, panel.vm.error());
  const backup = server.files.get(`backups/${panel.mac.replaceAll(":", "").toLowerCase()}.json`);
  return {
    bootKB: (booted - base) / 1024,
    zoneKB: (zone - base) / 1024,
    title: textOf(String(glass.components().find((c) => c.def.objname === "tTitle1")?.attrs.txt ?? "")),
    backup: backup?.length ?? 0,
    max: Number(panel.vm.call("_max")),
    errors: log.filter((l) => /error|exception/i.test(l)),
  };
}

const rooms = new Map();
const roomOf = (device) => {
  if (!rooms.has(device)) rooms.set(device, measure(device));
  return rooms.get(device);
};

test(`${TIMES} times the Living room: the brain's live heap with its biggest zone on the glass stays under ${CEILING_KB} KB, on the EU and the US`, async (t) => {
  const code = await persistCodeKB();
  for (const device of ["eu-landscape", "us-portrait"]) {
    const r = await roomOf(device);
    assert.deepEqual(r.errors, [], `${device}: the boot went clean`);
    assert.equal(r.title, "Middle", `${device}: the Middle on the glass`);
    const boot = r.bootKB - code;
    const zone = r.zoneKB - code;
    t.diagnostic(`${device}: ${boot.toFixed(1)} KB after 20 s, ${zone.toFixed(1)} KB with the Middle on the glass (persist's code, ${code.toFixed(1)} KB, taken out)`);
    assert.ok(zone <= CEILING_KB, `${device}: ${zone.toFixed(1)} KB live with the Middle on the glass, over the ${CEILING_KB} KB the panel leaves the brain`);
  }
});

test(`${TIMES} times the Living room: the backup the panel sends stays under what it reads back`, async (t) => {
  const r = await roomOf("eu-landscape");
  t.diagnostic(`${r.backup} bytes, of ${r.max}`);
  assert.ok(r.backup > 0, `no backup went to the server: the panel sends none past the ${r.max} bytes it reads back`);
  assert.ok(r.backup <= r.max, `${r.backup} bytes, over the ${r.max} the panel reads back (PanelHttp.MAX): one past them is never restored`);
});
