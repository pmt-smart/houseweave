// The panel and the bridge together, each on a VM of its own with the
// firmware's radio drivers compiled in, in one house (src/house.ts) with its
// mesh: the bridge added to the panel's house from the glass over ESP-NOW,
// the Wi-Fi one of them gives the other, and the lamps over the mesh. Nothing of either side is imitated: the
// Berry is the repo's, the drivers are the fork's C, and the glass runs the
// Living room's compiled pages.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SimHouse, SimPanel, SimBridge, networkOf, thermostatsOf, coversOf, sensorsOf, SIM_AIR, BRIDGE_FILES, IDEAL_TIMING, IDEAL_LOOP, REAL_TIMING, REAL_LOOP } from "../dist/index.js";
import { classesOf, staticsScript } from "./statics.mjs";
import { repoFiles, bridgeFiles, livingRoomConfig, REPO } from "../dist/files-node.js";
import { Glass, readScenario, fontOf, pictureOf, textOf } from "@nspanel-sim/glass";
import { houseServer } from "./house-server.mjs";

const SCENARIOS = join(REPO, "libs/nspanel-sim/export/hmi-scenarios");
const PROJECT = "p1-living-room-eu-landscape";

// The bridge's image keeps the statics of the relay's classes in its flash too,
// as the panel's does the brain's (panel.test.mjs): after each test, every static
// of the bridge a house came up with reads as it did then (statics.mjs).
const BRIDGE_STATICS = staticsScript(classesOf(BRIDGE_FILES));
const bridges = [];
afterEach(() => {
  for (const { bridge, frozen } of bridges.splice(0)) assert.equal(bridge.vm.call("_statics"), frozen, "a static of the bridge's relay was written");
});

/**
 * The radio these tests have by default, which is not the hardware's. The simulator's own defaults are (src/radio.ts): a
 * frame takes its time on the air, a device's loop drains the receive queue every Sleep (50 ms) and what it runs keeps
 * it busy, and Z2T says every device's ZbInfo in the same instant. This is what the simulator had before that, a radio
 * that takes no time: frames arrive as they are sent, the loop drains every 5 ms turn at no cost, and a ZbInfo comes 10
 * ms after the one before. The tests of the pairing, the Wi-Fi, the MQTT, the schedule and the rest are not about the
 * radio, and several of them stand on a seed that the real emission would break: with the real
 * radio the panel maps 4 lamps of the Living room's 30. `radio: "real"` is the hardware's: the section at the end of this file holds
 * those, as characterization (each marked `known issue, flip when fixed`).
 */
const IDEAL_RADIO = { house: { air: IDEAL_TIMING, loop: IDEAL_LOOP }, zigbee: { infoGapMs: 10 } };

/**
 * A house with the Living room's panel and its bridge, both with the mesh driver in their image and from their box: the panel founds its house
 * (house_mesh.be, found_own) and the bridge is not in it until the panel adds it (inHouse). The lamps on the bridge's
 * network (none, for a bridge fresh from its box), the panel with no chip of its
 * own (its Zigbee is the house's bridges'), on the Wi-Fi each is given ("Cottage" when not said). The
 * panel and the bridge are the house's, a new one after a restart. `thermostats` and `covers` are the ones
 * (ThermostatSpec and CoverSpec, zigbee.ts) the bridge's network has already, as the lamps are. `restored`, the
 * flash of each that another house kept ({panel, bridge}, a device's kept()), is a house that boots
 * from it as the simulator in the browser does at a reload (sim/src/rig.ts): its network made from
 * the panel's configuration, the lamps and the thermostats of it. `config` is the panel's configuration when it is not
 * the Living room's, and `radio` is "ideal" (IDEAL_RADIO) or "real", the simulator's own, the hardware's; `infoGapMs` is the time
 * between one ZbInfo of Z2T and the next, whatever the radio (zigbee.ts).
 */
async function house({ panelWifi, bridgeWifi, lamps = true, networks, broker, mqtt, thermostats = [], covers = [], sensors = [], restored, config, radio = "ideal", infoGapMs, bridgeEpoch } = {}) {
  const real = radio === "real";
  const home = new SimHouse({ networks, broker, ...(real ? {} : IDEAL_RADIO.house) });
  await home.enableMesh();
  const zigbee = infoGapMs !== undefined ? { infoGapMs } : real ? undefined : IDEAL_RADIO.zigbee;
  const log = [];
  // a device's Wi-Fi as the browser keeps it: without the networks it saw around it
  const wifiOf = (kept) => {
    const { around: _around, ...wifi } = kept.wifi ?? {};
    return wifi;
  };
  const bridge = await SimBridge.create({ house: home, files: bridgeFiles(), wifi: restored ? wifiOf(restored.bridge) : bridgeWifi, mqtt, zigbee,
    persist: restored?.bridge.persist, nvm: restored?.bridge.nvm, mesh: restored?.bridge.mesh ?? { id: 0 },
    // the computer's time, unless a test gives it the panel's: on the wall both have it from NTP, and the house's server checks a node's clock
    ...(bridgeEpoch !== undefined ? { epoch: bridgeEpoch, timezone: 0 } : {}),
    onLog: (level, line) => log.push(`${home.now} bridge [L${level}] ${line}`) });
  const doc = restored ? restored.panel.persist.panel_config : (config ?? livingRoomConfig());
  const hmi = readScenario(JSON.parse(readFileSync(join(SCENARIOS, `${PROJECT}.json`), "utf8")));
  const glassNotes = [];
  const early = [];
  let panel;
  const glass = new Glass(hmi, {
    width: 480,
    height: 320,
    fonts: hmi.fonts.map((f) => fontOf(readFileSync(join(SCENARIOS, f)))),
    pictures: hmi.pictures.map(pictureOf),
    // to the panel of the house, a new one after a restart: the screen stays up
    // through it, and what it says while the ESP32 boots is lost, as on the wall
    send: (b) => (panel ? home.devices.find((d) => d instanceof SimPanel)?.uartReceive(b) : early.push(b)),
    onDiagnostic: (m) => glassNotes.push(m),
  });
  panel = await SimPanel.create({
    house: home,
    files: repoFiles(PROJECT),
    project: PROJECT,
    zigbee,
    persist: restored ? restored.panel.persist : { panel_config: doc },
    nvm: restored?.panel.nvm,
    mesh: restored?.panel.mesh ?? { id: 0 },
    relays: [true, true],
    wifi: restored ? wifiOf(restored.panel) : panelWifi,
    mqtt,
    epoch: Date.UTC(2026, 8, 30, 20, 0, 0) / 1000,
    timezone: 0,
    onLog: (level, line) => log.push(`${home.now} panel [L${level}] ${line}`),
    onUart: (b) => glass.receive(b),
  });
  for (const b of early) panel.uartReceive(b);
  // the Living room's lamps, on the bridge's network, fed by the panel's relays
  if (lamps) for (const { spec, groups } of networkOf(doc)) bridge.zigbee.add(spec, groups);
  for (const t of restored ? thermostatsOf(doc) : thermostats) bridge.zigbee.addThermostat(t);
  for (const c of restored ? coversOf(doc) : covers) bridge.zigbee.addCover(c);
  for (const s of restored ? sensorsOf(doc) : sensors) bridge.zigbee.addSensor(s);
  glass.start();
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
  const texts = () => glass.components().filter((c) => c.def.type === "Text").map((c) => textOf(String(c.attrs.txt)));
  const shows = (label) => texts().includes(label);
  /** a row of a list, or a button on show, tapped where its label is */
  const tapRow = (label) => {
    const c = glass.components().find((k) => (k.def.type === "Text" || (k.def.type === "Button" && k.vis)) && textOf(String(k.attrs.txt)) === label);
    assert.ok(c, `"${label}" on the glass, which shows ${JSON.stringify(texts().filter(Boolean))}`);
    tap(c.def.x + c.def.w / 2, c.def.y + c.def.h / 2);
  };
  /** a row of a dialog: the glass takes no tap in its first 700 ms, as a confirmation does (panel_ui.be) */
  const tapDialog = (label) => {
    run(800);
    tapRow(label);
  };
  /** runs until the glass shows the label, for at most `ms`: false when it never did */
  const until = (label, ms) => {
    for (let t = 0; t < ms; t += 100) {
      if (shows(label)) return true;
      run(100);
    }
    return shows(label);
  };
  /** typed on the glass's keyboard, key by key, and OK */
  const type = (text) => {
    for (const k of [...text, "OK"]) {
      const c = glass.components().find((x) => x.def.objname === `mk${k}0`);
      assert.ok(c, `the key ${k} on the glass, on its page ${glass.page.name}`);
      tap(c.def.x + c.def.w / 2, c.def.y + c.def.h / 2);
    }
  };
  /** keys of the glass's keyboard, by their names (a..z, 0..9, Dot, SPACE, Sym, Semi, ABC, OK) */
  const keys = (...names) => {
    for (const k of names) {
      const c = glass.components().find((x) => x.def.objname === `mk${k}0`);
      assert.ok(c, `the key ${k} on the glass, on its page ${glass.page.name}`);
      tap(c.def.x + c.def.w / 2, c.def.y + c.def.h / 2);
    }
  };
  run(3000);
  assert.equal(bridge.vm.run(BRIDGE_STATICS, "statics"), 0, bridge.vm.error());
  bridges.push({ bridge, frozen: bridge.vm.call("_statics") });
  return {
    home, glass, run, tap, tapRow, tapDialog, type, keys, shows, texts, until, log, glassNotes,
    get panel() { return home.devices.find((d) => d instanceof SimPanel); },
    get bridge() { return home.devices.find((d) => d instanceof SimBridge); },
  };
}

/** a swipe on the glass, as panel.test.mjs makes one */
function drag(h, from, to, ms = 300) {
  h.glass.press(...from);
  const steps = ms / 25;
  for (let i = 1; i <= steps; i++) {
    h.glass.move(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
    h.run(25);
  }
  h.glass.release();
  h.run(400);
}

/** the mesh's +, at the right of its title: the search for a node to add to the house */
const tapPlus = (h) => h.tap(425, 39);

/** from the screensaver to the mesh's screen, as the house's page's icon opens it (berry/panel_house_view.be, icon_tap), with Editing on: its
 * nodes, and its + and its button, which change the house with Editing on, as the panel starts */
function toMesh(h) {
  h.tap(240, 160);
  assert.equal(h.panel.vm.run(`import global
global.panel_ui.network.emit(global.panel_ui.open(["house"]))`, "mesh"), 0, h.panel.vm.error());
  h.run(500);
}


const persistOf = (dev) => JSON.parse(dev.vm.readFile("/_persist.json"));

/** a Berry expression's value on a device, as JSON */
function probe(dev, expr) {
  assert.equal(dev.vm.run(`import global
import json
def _probe() return json.dump(${expr}) end`, "probe"), 0, dev.vm.error());
  return JSON.parse(dev.vm.call("_probe"));
}

/** the link up for real: the bridge of the panel's house in step on the mesh, the panel's session with it up (zigbee_bridge.be) */
const linkUp = (h) => probe(h.panel, "global.zb_bridge != nil && global.zb_bridge.link_state()") === true;

/** the names of the bridges of the panel's house, by its list */
function houseBridges(h) {
  assert.equal(h.panel.vm.run(`import global
import json
def _bridges()
    var out = []
    if global.house != nil for id: global.house.bridges() out.push(global.house.list.node(id)['name']) end end
    return json.dump(out)
end`, "bridges"), 0, h.panel.vm.error());
  return JSON.parse(h.panel.vm.call("_bridges"));
}

/** the bridge is in the panel's house, and the panel in the bridge's */
const together = (h) => houseBridges(h).includes(h.bridge.hostname) &&
  probe(h.bridge, "global.zbbridge_relay.house != nil && size(global.zbbridge_relay.house.list.ids(false)) >= 2") === true;

/** runs until the link is up for real, for at most `ms` */
function untilLinked(h, ms) {
  for (let t = 0; t < ms; t += 500) {
    if (linkUp(h)) return true;
    h.run(500);
  }
  return linkUp(h);
}

/** a tap on the Middle's card, and its lamps on the bridge's network */
function middle(h) {
  const lamps = h.bridge.zigbee.devices.filter((d) => d.groups.includes(3));
  assert.ok(lamps.length > 0 && lamps.every((d) => d.power === 0), "the Middle's lamps, on the bridge's network, are off");
  h.tap(240, 180);
  h.run(1000);
  return lamps;
}

test("a bridge with no network is added to the panel's house from the glass over ESP-NOW: heard on its own channel, it blinks, and Give puts it on the panel's Wi-Fi", async () => {
  const h = await house({ bridgeWifi: { ssid1: "" } });
  const { bridge } = h;
  assert.equal(bridge.wifi.up, false, "the bridge has no network");
  assert.ok(bridge.blinking(1500), "and at boot, with none saved, its window is open: the LED blinks");
  toMesh(h);
  assert.ok(!h.shows("zbbridge-living"), "the panel's house has no bridge: its Zigbee is off until one is added");
  tapPlus(h);
  assert.ok(h.shows("Searching"), "the search, on the panel's channel first");
  assert.ok(h.until("zbbridge-living", 12000), `the bridge heard, on its own channel: ${h.log.filter((l) => /PAIR|ESPNOW|STA/.test(l)).slice(-12).join("\n")}`);
  assert.ok(h.until("nearest", 6000), "the search over, the nearest marked");
  h.tapRow("zbbridge-living");
  assert.ok(h.until("Is zbbridge-living blinking?", 5000), `the bridge asked: ${h.texts().filter(Boolean)}`);
  assert.ok(bridge.blinking(500), "and it blinks fast");
  h.tapDialog("Yes");
  assert.ok(h.until("Give the bridge Wi-Fi?", 15000), `added, and the bridge has no network: ${h.texts().filter(Boolean)}\n${h.log.filter((l) => /PAIR|ESPNOW|RELAY|HOUSE/.test(l)).slice(-20).join("\n")}`);
  assert.ok(together(h), `the bridge in the panel's house, by the name it said, and the panel in the bridge's: ${JSON.stringify(houseBridges(h))}`);
  assert.equal(persistOf(bridge).zb_relay_peer, undefined, "and no pair kept on either side");
  assert.equal(persistOf(h.panel).zb_bridge_peer, undefined);
  h.tapDialog("Give");
  assert.ok(h.until("Its address shows in the house in a minute.", 20000), `the panel's network given, and the adding over: no word back, its address shows in the house: ${h.texts().filter(Boolean)}`);
  for (let t = 0; t < 50000 && !bridge.wifi.up; t += 500) h.run(500);
  assert.equal(bridge.wifi.up, true, `the bridge is on Cottage: ${h.log.filter((l) => /PAIR|ESPNOW|RELAY|STA/.test(l)).slice(-25).join("\n")}`);
  assert.equal(bridge.wifi.ssid[0], "Cottage", "saved there, once it worked");
  h.tapDialog("Done");
  assert.ok(untilLinked(h, 30000), `in step on the mesh, the two of them on Cottage's channel: ${h.log.filter((l) => /HOUSE|RELAY|GATE|ZBBRIDGE/.test(l)).slice(-20).join("\n")}`);
  assert.ok(h.until("zbbridge-living", 10000), "back on the mesh's screen, where the adding started: the bridge among the house's nodes");
  assert.ok(heardOnGlass(h, 10000), "and heard on the mesh");
  // the bridge's row: its page in the house
  h.tapRow("zbbridge-living");
  assert.ok(h.shows("Main settings") && h.shows("Wireless settings"), `the bridge's page in the house, its two settings as a panel's: ${h.texts().filter(Boolean)}`);
  h.tapRow("Main settings");
  assert.ok(h.until("Zigbee channel", 8000), `its Main settings, as the bridge draws them, asked over the mesh: ${h.texts().filter(Boolean)}\n${h.log.filter((l) => /HOUSE/.test(l)).slice(-10).join("\n")}`);
  h.tapRow("Info");
  assert.ok(h.until("Firmware", 8000), `its Info, asked over the mesh and answered by the bridge: ${h.texts().filter(Boolean)}\n${h.log.filter((l) => /HOUSE/.test(l)).slice(-10).join("\n")}`);
  toPlan(h);
  assert.ok(middle(h).every((d) => d.power === 1), "a card's tap: its group to the bridge over the mesh, and the lamps on");
  assert.deepEqual(h.glassNotes, []);
});

/** the glass's Add to this house, from the mesh's screen to the Wi-Fi's offer: the search, the blink, and Yes */
function pairFromGlass(h, offer) {
  toMesh(h);
  tapPlus(h);
  assert.ok(h.until("zbbridge-living", 12000), "the bridge heard");
  h.tapRow("zbbridge-living");
  assert.ok(h.until("Is zbbridge-living blinking?", 10000), `the bridge asked to blink: ${h.texts().filter(Boolean)}`);
  h.tapDialog("Yes");
  assert.ok(h.until(offer, 15000), `paired, and the Wi-Fi offered: ${h.texts().filter(Boolean)}`);
}

/** the mesh's screen says a node is heard: how strong, and how many links it has ("Strong, 1 link"), or "Heard" */
function heardOnGlass(h, ms) {
  // the panel's own row and the node's: each says how it is tied, and a node heard says it hears some ("Mesh Strong(5), Wi-Fi Good")
  const said = () => h.texts().filter((x) => /^Mesh (-\d+dBm|Heard)\(\d+\)|^Heard$/.test(x)).length >= 2;
  for (let t = 0; t < ms; t += 100) {
    if (said()) return true;
    h.run(100);
  }
  return said();
}

/** back from a view of Wireless settings to the plan, title by title */
function toPlan(h) {
  for (let i = 0; i < 8 && h.glass.page.name !== "home"; i++) {
    h.tap(100, 40);
    h.run(300);
  }
  assert.equal(h.glass.page.name, "home");
}

test("a panel with no network adds a bridge its button opened, keeps its radio on the bridge's channel, and Use puts the panel on the bridge's Wi-Fi", async () => {
  const h = await house({ panelWifi: { ssid1: "" } });
  const { panel, bridge } = h;
  assert.equal(panel.wifi.on, false, "the panel has no network, and its radio is off");
  assert.equal(bridge.wifi.up, true, "the bridge is on Cottage");
  assert.ok(!bridge.blinking(1500), "with a network, the bridge opens no window at boot");
  bridge.holdButton();
  h.run(1500);
  assert.ok(bridge.blinking(1000), "its button held 5 s: the window, and the LED blinks");
  pairFromGlass(h, "Use the bridge's Wi-Fi?");
  // the house's channel is the bridge's network's, which every node takes from the list half a second later, this panel too
  h.run(1000);
  assert.equal(((dev) => JSON.parse(dev.console("EspNowMeshChannel")).EspNowMeshChannel)(panel), 6, "on no network, the panel keeps its radio where the bridge is, Cottage's 6: the house's mesh is there (EspNowMeshChannel)");
  assert.ok(h.shows("Cottage. The panel joins it."), "the bridge's network, by name");
  h.tapDialog("Use");
  assert.ok(h.until("Joined Cottage", 30000), `the panel joined the bridge's network: ${h.texts().filter(Boolean)}\n${h.log.filter((l) => /PAIR|ENW|RELAY|STA/.test(l)).slice(-20).join("\n")}`);
  assert.equal(panel.wifi.up, true, "the panel is on Cottage");
  assert.equal(panel.wifi.ssid[0], "Cottage", "saved there, once it worked");
  h.tapDialog("Done");
  assert.ok(untilLinked(h, 30000), "and the bridge in step on the mesh, on the network's channel");
  assert.ok(heardOnGlass(h, 10000), "as the mesh's screen says of the bridge, back where the adding started");
  assert.deepEqual(h.glassNotes, []);
});

test("a bridge left with no network after it is added keeps its radio on the channel of the panel's network, where the house's mesh is, and the lamps answer over the mesh", async () => {
  const h = await house({ bridgeWifi: { ssid1: "" } });
  const { bridge } = h;
  pairFromGlass(h, "Give the bridge Wi-Fi?");
  h.tapDialog("Not now");
  assert.equal(bridge.wifi.up, false, "the bridge has no network: the mesh is its only way");
  // the simulator's mesh has no channels: on the device, the radio of a node on no network goes to this one
  assert.equal(((dev) => JSON.parse(dev.console("EspNowMeshChannel")).EspNowMeshChannel)(bridge), 6, "the house's radio channel, Cottage's, as the panel said it in the adding (EspNowMeshChannel)");
  const trace = () => h.log.filter((l) => /HOUSE|RELAY|GATE/.test(l) && !/dropped/.test(l)).slice(-12).join("\n");
  assert.ok(untilLinked(h, 60000), `in step on the mesh: ${trace()}`);
  toPlan(h);
  assert.ok(middle(h).every((d) => d.power === 1), "a card's tap reaches the lamps");
  assert.deepEqual(h.glassNotes, []);
});

test("a panel with no network and no bridge, its radio off from its boot, adds a bridge with no network: the radio is held for the mesh, and the bridge is heard", async () => {
  // a bench case: both factory reset, the bridge paired from the panel's glass with neither on a network, and the bridge in "No signal"
  const h = await house({ panelWifi: { ssid1: "" }, bridgeWifi: { ssid1: "" } });
  const { panel, bridge } = h;
  assert.equal(panel.wifi.on, false, "the panel has no network, and its radio is off");
  assert.equal((panel.radio.state().mode & 1) !== 0, false, "off: the house had no bridge at its boot");
  assert.ok(bridge.blinking(1500), "the bridge with no network opens its window at boot");
  toMesh(h);
  tapPlus(h);
  assert.ok(h.until("zbbridge-living", 12000), "the bridge heard");
  h.tapRow("zbbridge-living");
  assert.ok(h.until("Is zbbridge-living blinking?", 10000), `the bridge asked to blink: ${h.texts().filter(Boolean)}`);
  h.tapDialog("Yes");
  h.run(20000);
  assert.equal(bridge.wifi.up, false, "neither has a network to give the other");
  assert.equal((panel.radio.state().mode & 1) !== 0, true, "the house has a bridge now: the panel's radio is held on, with no network, for the mesh");
  assert.ok(h.log.some((l) => /the radio held with no network, for the mesh/.test(l)), "and says so");
  const trace = () => h.log.filter((l) => /HOUSE|RELAY|GATE|WIFI|STA/.test(l) && !/dropped/.test(l)).slice(-16).join("\n");
  assert.ok(untilLinked(h, 60000), `in step on the mesh: ${trace()}`);
  toMesh(h);
  assert.ok(heardOnGlass(h, 10000), `the mesh's screen hears the bridge: ${h.texts().filter(Boolean)}`);
  assert.deepEqual(h.glassNotes, []);
});

test("a panel fresh from its box, with no network and no bridge, holds its radio to make its identity, founds its own house, and lets the radio go", async () => {
  // with no network the radio would stay off, no identity could be made, and the mesh would say "Starting this house" for ever
  const h = await house({ panelWifi: { ssid1: "" }, bridgeWifi: { ssid1: "" } });
  const { panel } = h;
  let founded = false;
  for (let t = 0; t < 30000 && !founded; t += 500) {
    h.run(500);
    founded = probe(panel, "global.house.up && global.house.list.me == 1") === true;
  }
  assert.ok(founded, "its own house is founded, with its number");
  assert.ok(h.log.some((l) => /the radio held with no network, for the mesh/.test(l)), "the radio held for its identity");
  h.run(3000);
  assert.equal((panel.radio.state().mode & 1) !== 0, false, "and let go once the house is founded, with no bridge in it");
  toMesh(h);
  assert.ok(h.texts().some((x) => /^Panel [0-9A-F]{6} \*$/.test(x)) && h.texts().some((x) => /^Mesh None\(0\)/.test(x)), `the mesh shows the panel itself, with a * by its name, how it is tied (none heard on the radio) and its Wi-Fi: ${h.texts().filter(Boolean)}`);
  assert.deepEqual(h.glassNotes, []);
});

test("a bridge fresh from its box forms its network on the Zigbee channel the panel chose for the room, once the adding is over", async () => {
  const h = await house({ bridgeWifi: { ssid1: "" }, lamps: false });
  assert.equal(h.bridge.zigbee.channel, 11, "Z2T's own, as nothing changed it");
  pairFromGlass(h, "Give the bridge Wi-Fi?");
  assert.equal(probe(h.bridge, "global.zbbridge_relay.next_channel"), 26, "the panel's word: its network forms on 26 once the adding is over");
  h.tapDialog("Give");
  for (let t = 0; t < 50000 && !h.bridge.wifi.up; t += 500) h.run(500);
  assert.ok(h.bridge.wifi.up, "the bridge on the panel's network first");
  for (let t = 0; t < 30000 && !h.bridge.restartDue; t += 500) h.run(500);
  assert.deepEqual(h.bridge.restarts, ["ZbConfig"], "then the channel saved, and the bridge restarts");
  await h.home.settle();
  assert.equal(h.bridge.zigbee.channel, 26, "on Cottage's Wi-Fi 6, with no other room heard: 26, the farthest from it");
  assert.ok(untilLinked(h, 20000), "and the bridge back, in step on the mesh");
  assert.equal(h.bridge.restarts.length, 0, "once");
  assert.deepEqual(h.glassNotes, []);
});

test("a bridge with lamps on its network keeps its channel: moved, they would be orphaned", async () => {
  const h = await house({ bridgeWifi: { ssid1: "" } });
  pairFromGlass(h, "Give the bridge Wi-Fi?");
  assert.equal(probe(h.bridge, "global.zbbridge_relay.next_channel"), null, "the panel's channel not taken: its network stays where it is");
  h.tapDialog("Give");
  for (let t = 0; t < 50000 && !h.bridge.wifi.up; t += 500) h.run(500);
  assert.ok(h.bridge.wifi.up);
  h.run(20000);
  assert.deepEqual(h.bridge.restarts, [], "no restart");
  assert.equal(h.bridge.zigbee.channel, 11);
});

/** both on Cottage, the bridge added to the panel's house from the glass, its button held, and in step on the mesh; with what else a house takes */
async function inHouse(extra = {}) {
  const h = await house(extra);
  h.bridge.holdButton();
  h.run(1500);
  toMesh(h);
  tapPlus(h);
  assert.ok(h.until("zbbridge-living", 12000), "the bridge heard");
  h.tapRow("zbbridge-living");
  assert.ok(h.until("Is zbbridge-living blinking?", 10000), `the bridge asked to blink: ${h.texts().filter(Boolean)}`);
  h.tapDialog("Yes");
  assert.ok(untilLinked(h, 60000), `added, both on Cottage: nothing to offer, and the bridge in step on the mesh: ${h.texts().filter(Boolean)}\n${h.log.filter((l) => /PAIR|HOUSE|RELAY/.test(l)).slice(-20).join("\n")}`);
  return h;
}

/** from the screensaver to the MQTT view of Wireless settings */
function toMqtt(h) {
  h.tap(240, 160);
  drag(h, [240, 300], [240, 120]);
  h.run(500);
  h.tapRow("MQTT");
}

test("MQTT saved on the glass is the house's: the bridge takes the same broker over the mesh, both restart once, both are on it, and the view says so", async () => {
  const broker = { host: "192.168.0.10", user: "home", password: "se;cr et" };
  const h = await inHouse({ broker });
  // from the mesh, where the adding ended, to the plan, and Wireless settings by the swipe up
  toPlan(h);
  drag(h, [240, 300], [240, 120]);
  h.run(500);
  assert.ok(h.shows("MQTT") && h.shows("Off"), `Wireless settings: MQTT, with no broker: ${h.texts().filter(Boolean)}`);
  h.tapRow("MQTT");
  assert.ok(h.shows("Host") && h.shows("None") && h.shows("1883"), `the MQTT view: ${h.texts().filter(Boolean)}`);
  h.tapRow("Host");
  h.keys("1", "9", "2", "Dot", "1", "6", "8", "Dot", "0", "Dot", "1", "0", "OK");
  assert.ok(h.until("192.168.0.10", 2000), `the host, in the draft: ${h.texts().filter(Boolean)}`);
  drag(h, [200, 290], [200, 110]);
  h.tapRow("User");
  h.type("home");
  assert.ok(h.until("home", 2000));
  h.tapRow("Password");
  // a ; and a space: a Backlog would have cut it, each setting goes alone
  h.keys("s", "e", "Sym", "Semi", "ABC", "c", "r", "SPACE", "e", "t", "OK");
  assert.ok(h.until("Changed", 2000), `the password, as the draft has it: ${h.texts().filter(Boolean)}`);
  drag(h, [200, 290], [200, 110]);
  assert.ok(h.shows("Applies to") && h.shows("The house"), `in a house, the setting is the house's: ${h.texts().filter(Boolean)}`);
  h.tapRow("Save");
  assert.ok(h.until("Save and restart?", 2000));
  assert.ok(h.texts().filter(Boolean).join(" ").includes("The panel restarts to connect to 192.168.0.10."), `the confirmation: ${h.texts().filter(Boolean)}`);
  h.tapDialog("Save");
  for (let t = 0; t < 10000 && !(h.panel.restartDue && h.bridge.restartDue); t += 250) h.run(250);
  const trace = () => h.log.filter((l) => /ZBBRIDGE|ZBPAIR|MQTT|MQT:/.test(l) && !/dropped/.test(l)).slice(-20).join("\n");
  assert.ok(h.panel.restartDue && h.bridge.restartDue, `both asked to restart: ${trace()}`);
  assert.deepEqual(h.panel.restarts, ["MqttHost", "MqttPort", "MqttUser", "MqttPassword"], "the panel's settings, each alone");
  assert.deepEqual(h.bridge.restarts, ["MqttHost", "MqttPort", "MqttUser", "MqttPassword"], "and the bridge's, from the house's list over the mesh");
  assert.ok(!h.log.some((l) => l.includes("se;cr et") && !/CMD:/.test(l)), `the password in no log but a command's: ${h.log.filter((l) => l.includes("se;cr et")).join("\n")}`);
  await h.home.settle();
  for (const d of [h.panel, h.bridge]) assert.deepEqual(d.mqtt, { ...broker, port: 1883 }, "the settings through the restart, as the flash keeps them");
  assert.equal(h.panel.restarts.length + h.bridge.restarts.length, 0, "each restarted once");
  assert.ok(untilLinked(h, 60000), `the bridge in step again after the restarts: ${trace()}`);
  assert.ok(h.panel.mqttConnected && h.bridge.mqttConnected, "both on the house's broker");
  h.run(3000);
  toMqtt(h);
  assert.ok(h.shows("Connected") && h.shows("192.168.0.10"), `the panel on its broker: ${h.texts().filter(Boolean)}`);
  drag(h, [200, 290], [200, 110]);
  assert.ok(h.shows("Set"), `its password kept, and not shown: ${h.texts().filter(Boolean)}`);
  // the screen stayed up through the panel's restart: the driver's string for a
  // display left in Protocol Reparse, which one not in it refuses (nextion_driver.be)
  assert.deepEqual(h.glassNotes.filter((m) => !m.includes("DRAKJHSUYDGBNCJHGJKSHBDN")), []);
});

/** from the screensaver, or a page of the plan's, to the Backup view of Wireless settings, on the list's first page or its second, as the rows before it fall, and through the OTA in a house */
function toBackup(h) {
  if (h.glass.page.name === "screensaver") h.tap(240, 160);
  toPlan(h);
  drag(h, [240, 300], [240, 120]);
  h.run(500);
  if (!h.shows("Backup") && !h.shows("OTA")) drag(h, [200, 290], [200, 110]);
  // a panel in a house has it in its OTA
  if (h.shows("OTA")) {
    h.tapRow("OTA");
    h.run(500);
  }
  h.tapRow("Backup");
}

/** the Hall renamed on the glass, as the owner does it: its card held, its title held, and the keyboard */
function renameHall(h, ...keys) {
  toPlan(h);
  h.tap(40, 160, 800);
  assert.equal(h.glass.page.name, "zone", "the Hall");
  h.tap(100, 40, 800);
  assert.equal(h.glass.page.name, "editboard");
  h.keys(...keys, "OK");
  h.run(500);
}

test("the backup through the house's server: paired on a panel, it keeps the panel's and the bridge's, a change waits for the night's round or for Back up now, and the server's backup restores, the pattern the panel's own", async () => {
  // the bridge on the house's time, as the panel: NTP gives it to both on the wall, and the server checks each node's clock
  const h = await inHouse({ bridgeEpoch: Date.UTC(2026, 8, 30, 20, 0, 0) / 1000 });
  let server;
  const trace = () => `${JSON.stringify(server?.log ?? [])}\n${h.log.filter((l) => /BACKUP|BRY|FLEET/.test(l)).slice(-12).join("\n")}`;
  const puts = () => server.log.filter((r) => r.method === "PUT").length;
  const hallOf = (doc) => doc.zones.find((z) => z.id === "hall").name;
  const hall = (b) => hallOf(b.keys.panel_config);
  toBackup(h);
  assert.ok(h.shows("Last backup") && h.shows("None"), `the backup view, with no server: ${h.texts().filter(Boolean)}`);
  // the server paired on the panel: the house's list has it, and every node finds it there
  server = await houseServer(h.home, h.panel, { run: (ms) => h.run(ms) });
  const P = server.node(h.panel);
  const B = server.node(h.bridge);
  assert.deepEqual(server.house.nodes.map((n) => n[0]).sort(), [B, P].sort(), "the pairing's answer: the house's nodes, with their keys");
  for (let t = 0; t < 10000 && !server.log.some((r) => r.path === "/api/backup"); t += 250) h.run(250);
  assert.ok(server.log.some((r) => r.method === "GET" && r.path === "/api/backup" && r.status === 404), `the panel looked at the server, signed, and found none: ${trace()}`);
  assert.ok(server.log.some((r) => r.method === "POST" && r.path === "/api/hello" && r.status === 204), `and said hello: ${trace()}`);
  h.run(60000);
  assert.equal(puts(), 0, `nothing goes by itself: the configuration waits for the round, or for someone to ask: ${trace()}`);
  toBackup(h);
  assert.ok(h.shows("Back up now") && h.shows("Not saved"), `not saved: ${h.texts().filter(Boolean)}`);
  drag(h, [200, 290], [200, 110]);
  assert.ok(h.shows("Server") && h.shows("Home Assistant"), `and the server by its name: ${h.texts().filter(Boolean)}`);
  // the panel's Tasmota settings, as Tasmota keeps them in its file: a block of 4 096 bytes, its header first
  const settingsOf = (fill) => Uint8Array.from({ length: 4096 }, (_, i) => (i < 2 ? 0x5a : fill));
  h.panel.vm.writeFile("/.settings", settingsOf(1));
  // the server's Backup, for the panel
  assert.equal((await server.fleet.ask(P, "backup")).backup, "Saving", `the server's Backup: ${trace()}`);
  for (let t = 0; t < 5000 && !server.backupOf(h.panel); t += 100) h.run(100);
  const first = server.backupOf(h.panel);
  assert.ok(first, `the panel's backup, on the server: ${trace()}`);
  assert.equal(first.panel, h.panel.mac.replaceAll(":", "").toLowerCase(), "the panel's, by its name");
  assert.equal(first.project, PROJECT, "for its room");
  assert.equal(first.keys.panel_config.zones.length, livingRoomConfig().zones.length, "with the Living room's configuration");
  assert.ok(Object.keys(first.keys).every((k) => ["panel_config", "panel_texts", "panel_prefs"].includes(k)), `and nothing else: ${Object.keys(first.keys)}`);
  assert.equal(first.keys.panel_prefs?.pattern, undefined, "never the pattern");
  assert.deepEqual([first.settings.v, typeof first.settings.kv, Buffer.from(first.settings.d, "base64").length], [1, "number", 12 + 4096 + 16],
    "the Tasmota settings, sealed under the house's key");
  assert.ok(!Buffer.from(first.settings.d, "base64").includes(Buffer.from(settingsOf(1).subarray(0, 64))), "and not in the clear");
  assert.equal(persistOf(h.panel).panel_backup.last.by, "server", "asked by the server");
  // the bridge: the list took the server to it over the mesh; it says hello, and at the round its configuration is one it never backed up
  for (let t = 0; t < 30000 && !server.fleet.fleet().nodes.find((n) => n.node === B)?.seen; t += 500) h.run(500);
  assert.ok(server.fleet.fleet().nodes.find((n) => n.node === B)?.seen, `the bridge said hello: ${trace()}`);
  for (let t = 0; t < 10000 && (await server.fleet.ask(B, "round")).backup !== "Saving"; t += 1000) h.run(1000);
  for (let t = 0; t < 5000 && !server.backupOf(h.bridge); t += 100) h.run(100);
  const bridge = server.backupOf(h.bridge);
  assert.ok(bridge, `the bridge's backup, at the round: ${trace()}`);
  assert.equal(bridge.bridge, h.bridge.mac.replaceAll(":", "").toLowerCase(), "the bridge's, by its name");
  assert.ok(Object.keys(bridge.keys).every((k) => k.startsWith("zb_")), `its devices' names, its alarm, its drivers: ${Object.keys(bridge.keys)}`);
  assert.equal((await server.fleet.ask(B, "round")).backup, "Up to date", "and the next round finds no change");
  // a change on the glass: not saved until the round
  renameHall(h, "SPACE", "a", "b");
  assert.equal(hallOf(persistOf(h.panel).panel_config), "Hall ab");
  const before = puts();
  h.run(60000);
  assert.equal(puts(), before, "a change waits");
  const round = await server.fleet.ask(P, "round");
  assert.deepEqual([round.backup, round.state.backup.dirty], ["Saving", true], `the round: the change goes, and the panel says it was not saved: ${trace()}`);
  for (let t = 0; t < 5000 && puts() === before; t += 100) h.run(100);
  assert.equal(hall(server.backupOf(h.panel)), "Hall ab", `the change, at the round: ${trace()}`);
  assert.equal(hall(JSON.parse(new TextDecoder().decode(server.files.get(`backups/${h.panel.mac.replaceAll(":", "").toLowerCase()}.json.1`)))), "Hall",
    "the one before kept beside it");
  assert.equal((await server.fleet.ask(P, "round")).backup, "Up to date", "the next round: nothing to go");
  // Back up now on the glass
  renameHall(h, "c");
  toBackup(h);
  assert.ok(h.until("Back up now", 2000), `Back up now while the change has none: ${h.texts().filter(Boolean)}`);
  h.tapRow("Back up now");
  for (let t = 0; t < 5000 && hall(server.backupOf(h.panel)) !== "Hall abc"; t += 100) h.run(100);
  assert.equal(hall(server.backupOf(h.panel)), "Hall abc", `Back up now: at once: ${trace()}`);
  assert.equal(persistOf(h.panel).panel_backup.last.by, "glass");
  assert.equal(h.panel.console("BackupNow"), JSON.stringify({ BackupNow: "Up to date" }), "and the console's, with nothing to save");
  // the server's backup restored, over a change made since: its Button 2 the panel's, as its backup says, and the driver's the factory's
  renameHall(h, "d");
  assert.equal(hallOf(persistOf(h.panel).panel_config), "Hall abcd");
  const theirs = server.backupOf(h.panel);
  theirs.keys.panel_prefs = { ...(theirs.keys.panel_prefs ?? {}), buttons: ["relay", "panel"] };
  server.files.set(`backups/${h.panel.mac.replaceAll(":", "").toLowerCase()}.json`, new TextEncoder().encode(JSON.stringify(theirs)));
  assert.match(h.panel.console("ButtonDecouple") ?? "", /\[0,0\]/, "the panel's buttons, the relays'");
  // and its Tasmota settings changed since: the restore puts the backup's back
  h.panel.vm.writeFile("/.settings", settingsOf(2));
  toBackup(h);
  assert.ok(h.until("Restore", 5000), `the server's backup, to restore: ${h.texts().filter(Boolean)}\n${trace()}`);
  h.tapRow("Restore");
  assert.ok(h.until("Restore the backup?", 2000), `Restore asks first: ${h.texts().filter(Boolean)}`);
  const said = h.texts().filter(Boolean).join(" ");
  assert.ok(said.includes("5 zones, 34 devices and the settings"), `with what it brings: ${said}`);
  h.tapDialog("Restore");
  for (let t = 0; t < 10000 && !h.panel.restartDue; t += 250) h.run(250);
  assert.deepEqual(h.panel.restarts, ["Restart 99"], `fetched again, signed, checked, written, and the panel restarts without saving its settings over them: ${trace()}`);
  assert.deepEqual(Buffer.from(h.panel.vm.module.FS.readFile("/.settings")), Buffer.from(settingsOf(1)), "the Tasmota settings of the backup, opened by the house's key and written");
  await h.home.settle();
  const restored = persistOf(h.panel);
  assert.equal(hallOf(restored.panel_config), "Hall abc", "the server's configuration, in place of the change made since");
  assert.equal(restored.panel_backup.last.by, "restore", "its last backup, the one it restored");
  assert.match(h.panel.console("ButtonDecouple") ?? "", /\[0,1\]/, "and its buttons the backup's, in the driver the boot reads them from");
  assert.deepEqual(restored.panel_prefs.buttons, ["relay", "panel"], "as the preferences say");
  assert.deepEqual(h.glassNotes.filter((m) => !m.includes("DRAKJHSUYDGBNCJHGJKSHBDN")), []);
});

test("the relay (the second stage): the server does not reach the bridge, and asks it through the panel, over the mesh; the bridge's answer comes back signed, and its backup at the round goes to the server by itself", async () => {
  const h = await inHouse({ bridgeEpoch: Date.UTC(2026, 8, 30, 20, 0, 0) / 1000 });
  const unreachable = new Set();
  const server = await houseServer(h.home, h.panel, { run: (ms) => h.run(ms), unreachable });
  const trace = () => `${JSON.stringify(server.log)}\n${h.log.filter((l) => /BACKUP|BRY|FLEET|HOUSE/.test(l)).slice(-12).join("\n")}`;
  const P = server.node(h.panel);
  const B = server.node(h.bridge);
  for (let t = 0; t < 30000 && !server.fleet.fleet().nodes.find((n) => n.node === B)?.seen; t += 500) h.run(500);
  assert.equal((await server.fleet.ask(P, "state")).node, P, `the server reaches the panel: ${trace()}`);
  // the bridge, behind another router: the server's call to it goes nowhere
  unreachable.add(h.bridge.ip);
  const a = await server.fleet.ask(B, "state");
  assert.deepEqual([a.node, a.verb, a.state?.role], [B, "state", "bridge"], `the bridge's answer, through the panel: ${JSON.stringify(a)}\n${trace()}`);
  assert.equal(server.fleet.fleet().nodes.find((n) => n.node === B).did.via, P, "kept, through the panel");
  assert.ok(server.log.some((r) => r.method === "POST" && r.path === "/api/relayed" && r.status === 204), `the panel posted it, and the server took it: ${trace()}`);
  // the round, through the panel: the bridge reaches the server, and its backup goes by itself
  for (let t = 0; t < 10000 && (await server.fleet.ask(B, "round")).backup !== "Saving"; t += 1000) h.run(1000);
  for (let t = 0; t < 5000 && !server.backupOf(h.bridge); t += 100) h.run(100);
  assert.ok(server.backupOf(h.bridge), `the bridge's backup, at a round it was asked through the panel: ${trace()}`);
  assert.equal(server.fleet.fleet().nodes.find((n) => n.node === B).did.answer.backup, "Saving");
  // and the bridge's own address back: called direct again
  unreachable.delete(h.bridge.ip);
  const back = await server.fleet.ask(B, "state");
  assert.deepEqual([back.node, server.fleet.fleet().nodes.find((n) => n.node === B).did.via], [B, undefined], "direct again");
});

test("a bridge with no Wi-Fi (the case 3): its hello and its backup carried by the panel over the mesh, signed by the bridge; the server knows it with no address, and asks it through the panel", async () => {
  const h = await inHouse({ bridgeWifi: { ssid1: "" }, bridgeEpoch: Date.UTC(2026, 8, 30, 20, 0, 0) / 1000 });
  // the bridge offered the panel's network: not now, it stays with none
  h.tapDialog("Not now");
  const server = await houseServer(h.home, h.panel, { run: (ms) => h.run(ms) });
  const trace = () => `${JSON.stringify(server.log)}\n${h.log.filter((l) => /BACKUP|BRY|FLEET|HOUSE/.test(l)).slice(-12).join("\n")}`;
  const B = server.node(h.bridge);
  const rec = () => server.fleet.fleet().nodes.find((n) => n.node === B);
  for (let t = 0; t < 30000 && !rec()?.seen; t += 500) h.run(500);
  assert.ok(rec()?.seen, `the bridge's hello, carried by the panel: ${trace()}`);
  assert.equal(rec().ip, "", "and no address for it: the panel's is not the bridge's");
  // the server's round, through the panel (the relay), and the bridge's backup through the panel too
  for (let t = 0; t < 20000 && (await server.fleet.ask(B, "round")).backup !== "Saving"; t += 1000) h.run(1000);
  for (let t = 0; t < 20000 && !server.backupOf(h.bridge); t += 200) h.run(200);
  const b = server.backupOf(h.bridge);
  assert.ok(b, `the bridge's backup on the server, carried by the panel: ${trace()}`);
  assert.equal(b.bridge, h.bridge.mac.replaceAll(":", "").toLowerCase(), "the bridge's, by its name");
  assert.equal(rec().did.via, server.node(h.panel), "asked through the panel");
  assert.equal((await server.fleet.ask(B, "round")).backup, "Up to date", "and the next round finds no change");
});

test("the weather Home Assistant says on the house's MQTT: the screensaver shows it at once, a panel that comes up after it finds it retained, and an empty one takes it away", async () => {
  const broker = { host: "192.168.0.10", user: "home", password: "secret" };
  const h = await house({ broker, mqtt: { ...broker, port: 1883 } });
  const TOPIC_WEATHER = "houseweave/weather";
  const temps = () => [0, 1, 2, 3, 4].map((i) => textAt(h, `tTemp${i}`));
  const labels = () => [0, 1, 2, 3, 4].map((i) => textAt(h, `tWd${i}`));
  assert.equal(temps().length, 5);
  assert.equal(h.glass.page.name, "screensaver");
  assert.deepEqual(temps(), ["--", "--", "--", "--", "--"], "nothing said: the row says --");
  // the panel's clock: the house's start, 2026-09-30 20:00 UTC, and the time run since
  const at = Date.UTC(2026, 8, 30, 20, 0, 0) / 1000 + Math.floor(h.home.now / 1000);
  const forecast = JSON.stringify({ at, cells: [["Now", 18.6], ["Thu", 21], ["Fri", 19.2], ["Sat", null], ["Sun", -2.6]] });
  h.home.mqttPublish(TOPIC_WEATHER, forecast, true, "home-assistant");
  h.run(500);
  assert.deepEqual(labels(), ["Now", "Thu", "Fri", "Sat", "Sun"], `the days: ${h.texts().filter(Boolean)}`);
  assert.deepEqual(temps(), ["19°C", "21°C", "19°C", "--", "-3°C"], "and the degrees, whole");
  assert.equal(h.glass.page.name, "screensaver", "on the page it was, the glass not woken");
  // a panel that comes up after it: the broker gives it the retained one
  const old = h.panel;
  old.unplug();
  await SimPanel.create({
    house: h.home, files: repoFiles(PROJECT), project: PROJECT, persist: persistOf(old), relays: [true, true], mqtt: { ...broker, port: 1883 },
    mac: old.mac, ip: "192.168.0.70", epoch: at, timezone: 0,
    onLog: (level, line) => h.log.push(`${h.home.now} panel2 [L${level}] ${line}`),
    onUart: (b) => h.glass.receive(b),
  });
  assert.notEqual(h.panel, old);
  h.run(5000);
  assert.deepEqual(temps(), ["19°C", "21°C", "19°C", "--", "-3°C"], `the restarted panel finds it: ${h.texts().filter(Boolean)}`);
  // Home Assistant takes it back, with an empty retained message
  h.home.mqttPublish(TOPIC_WEATHER, "", true, "home-assistant");
  h.run(500);
  assert.deepEqual(temps(), ["--", "--", "--", "--", "--"], "gone: --");
  assert.deepEqual(labels(), ["", "", "", "", ""]);
});

/** the text a Text of the page on show carries, by its id: the compiled name is the id and the page's digit */
function textAt(h, id) {
  const c = h.glass.components().find((k) => k.def.type === "Text" && k.def.objname.length === id.length + 1 && k.def.objname.startsWith(id));
  assert.ok(c, `a ${id} on ${h.glass.page.name}`);
  return textOf(String(c.attrs.txt));
}

test("Home Assistant's discovery from the bridge: every lamp of the Living room by the panel's name, its state, a command from Home Assistant, and a lamp whose power went, offline", async () => {
  const broker = { host: "192.168.0.10", user: "home", password: "secret" };
  const h = await inHouse({ broker, mqtt: { ...broker, port: 1883 } });
  const { home, bridge } = h;
  const lamps = networkOf(livingRoomConfig());
  const names = new Map(livingRoomConfig().devices.map((d) => [String(d[0]), String(d[1])]));
  const config = (ieee) => JSON.parse(home.retained.get(`homeassistant/light/${ieee}/light/config`) ?? "null");
  const trace = () => h.log.filter((l) => /DISCOVERY|ZbRelayName|MQT/.test(l)).slice(-15).join("\n");
  // the names over the link, each a moment apart, and the lamps announced again with them
  for (let t = 0; t < 30000 && !lamps.every(({ spec }) => config(spec.ieee)?.dev.name === names.get(spec.ieee)); t += 500) h.run(500);
  assert.equal(bridge.mqttConnected, true, "the bridge on the broker");
  for (const { spec } of lamps) {
    const c = config(spec.ieee);
    assert.ok(c, `${spec.ieee} announced: ${trace()}`);
    assert.equal(c.dev.name, names.get(spec.ieee), "by the panel's name");
    assert.deepEqual(c.sup_clrm, ["hs", "color_temp"], "a colour lamp with its white");
    assert.equal(home.retained.get(`zigbee/${spec.ieee}/availability`), "online");
  }
  assert.equal(home.retained.get(`tele/${bridge.mqttTopic}/LWT`), "Online", "the bridge's LWT, the second availability of each");
  // Home Assistant turns a lamp on, bright
  const { spec } = lamps.find(({ spec }) => spec.relay === 0) ?? lamps[0];
  home.mqttPublish(`zigbee/${spec.ieee}/set`, JSON.stringify({ state: "ON", brightness: 200, color: { h: 90, s: 50 } }));
  h.run(2000);
  const lamp = bridge.zigbee.devices.find((d) => d.ieee === spec.ieee);
  assert.deepEqual([lamp.power, lamp.dimmer, lamp.hue, lamp.sat], [1, 200, 64, 127], `ZbSend from Home Assistant's command: ${trace()}`);
  const state = JSON.parse(home.retained.get(`zigbee/${spec.ieee}/state`));
  assert.deepEqual([state.state, state.brightness, state.color_mode], ["ON", 200, "hs"], "and its state back, from its report");
  // the Living room's relay 2 cuts the lamps it feeds, all of them: Z2T does not
  // reach them, and Home Assistant hears it, the bridge still up
  const fed = lamps.filter(({ spec }) => spec.relay === 2).map(({ spec }) => spec.ieee);
  assert.equal(fed.length, lamps.length, "every lamp of the Living room on relay 2");
  h.panel.command("Power2 0");
  h.run(61000);
  assert.ok(fed.every((ieee) => home.retained.get(`zigbee/${ieee}/availability`) === "offline"), `the lamps on relay 2, offline: ${trace()}`);
  assert.equal(home.retained.get(`tele/${bridge.mqttTopic}/LWT`), "Online", "and the bridge still up");
  // a lamp removed on the panel, ZbLeave and ZbForget over the link as the glass sends them: out of
  // Home Assistant a moment later, where the ones with no power stay, unavailable
  const gone = lamps[1].spec.ieee;
  assert.equal(h.panel.vm.run(`import global
global.zb_bridge.send("ZbLeave ${gone}")
global.zb_bridge.send("ZbForget ${gone}")`, "remove"), 0, h.panel.vm.error());
  h.run(8000);
  assert.equal(config(gone), null, `the lamp removed, out of Home Assistant: ${trace()}`);
  assert.ok(lamps.filter(({ spec }) => spec.ieee !== gone).every(({ spec }) => config(spec.ieee) !== null), "the lamps with no power, still there");
  // the Discovery turned off on the glass, its Save the house's, as the MQTT view saves it, with no password typed:
  // the house's first setting, on the broker the panel is on, each node keeping its own password. The bridge restarts on its way, in
  // the middle of the clearing, and its next connection clears what is left; Home Assistant's commands are not obeyed
  const off = JSON.stringify({ host: broker.host, port: 1883, user: broker.user, discovery: false, expire: 0 });
  assert.equal(h.panel.vm.run(`import global
import json
global.panel_ui.mqtt.run("save", [json.load(${JSON.stringify(off)})])`, "off"), 0, h.panel.vm.error());
  for (let t = 0; t < 10000 && !h.bridge.restartDue; t += 250) h.run(250);
  assert.ok(h.bridge.restartDue, `the Save restarts the bridge: ${trace()}`);
  assert.ok(lamps.some(({ spec }) => config(spec.ieee) !== null), "with the clearing not done");
  await h.home.settle();
  for (let t = 0; t < 150000 && lamps.some(({ spec }) => config(spec.ieee) !== null); t += 1000) h.run(1000);
  assert.ok(lamps.every(({ spec }) => config(spec.ieee) === null), `every lamp out of Home Assistant after the restart: ${trace()}`);
  h.panel.command("Power2 1");
  h.run(15000);
  const before = h.bridge.zigbee.devices.find((d) => d.ieee === spec.ieee).power;
  home.mqttPublish(`zigbee/${spec.ieee}/set`, JSON.stringify({ state: before ? "OFF" : "ON" }));
  h.run(3000);
  assert.equal(h.bridge.zigbee.devices.find((d) => d.ieee === spec.ieee).power, before, "and Home Assistant's command, with the discovery off, not obeyed");
  // the panel restarted too, the house's MQTT being every node's: the screen stayed up, and the driver's string for a display left in
  // Protocol Reparse, which one not in it refuses (nextion_driver.be), is the only note
  assert.deepEqual(h.glassNotes.filter((m) => !m.includes("DRAKJHSUYDGBNCJHGJKSHBDN")), []);
});

/** The panel's lamps with no communication, the lamp with "?": the plan's doubt, read in its VM */
function doubtOf(h) {
  assert.equal(h.panel.vm.run(`import global
import json
global.doubt_probe = def (a) return json.dump(global.plan.doubt) end`, "doubt"), 0, h.panel.vm.error());
  return JSON.parse(h.panel.vm.call("doubt_probe", ""));
}

test("a lamp the Middle's command missed: no communication when its time is up, nothing sent again, and back to what it said when its ping comes back over the bridge's link; with the bridge gone, it stays", async () => {
  const h = await inHouse();
  toPlan(h);
  // the map of the network first: the bridge says it a frame every 80 ms, and a report from a lamp the map lacks is no report
  for (let t = 0; t < 15000 && !(mapOf(h).count > 0 && mapOf(h).mapped >= mapOf(h).count); t += 250) h.run(250);
  const lamps = h.bridge.zigbee.devices.filter((d) => d.groups.includes(3));
  assert.ok(lamps.length > 1 && lamps.every((d) => d.power === 0), "the Middle's lamps, on the bridge's network, are off");
  const missed = lamps[0];
  // the zone's broadcast does not reach it, as one that nobody acknowledges can be lost
  missed.misses = 1;
  const trace = () => h.log.filter((l) => /PLAN|ZIGBEE|ZbPing|ZBBRIDGE/.test(l)).slice(-12).join("\n");
  h.tap(240, 180);
  let seen = false;
  for (let t = 0; t < 6000 && !seen; t += 20) {
    h.run(20);
    seen = missed.ieee in doubtOf(h);
  }
  assert.ok(seen, `the lamp the command missed, with no communication when its time was up: ${trace()}`);
  assert.deepEqual(Object.keys(doubtOf(h)), [missed.ieee], "and only that one: the others reported");
  h.run(2000);
  assert.deepEqual(doubtOf(h), {}, `its ping answered, over the link, takes it back to what it said: ${trace()}`);
  assert.equal(missed.power, 0, "and nothing was sent to it again");
  assert.ok(lamps.filter((d) => d !== missed).every((d) => d.power === 1), "the others did what the tap asked");
  // the bridge gone, its connection dead with no word to the panel: the next
  // command reaches nobody, and nothing comes back, not even to the ping
  h.home.remove(h.bridge);
  h.tap(240, 180);
  h.run(10000);
  const left = Object.keys(doubtOf(h));
  assert.equal(left.length, lamps.length - 1, `with nothing answering, the lamps asked to change keep their "?": ${trace()}`);
  assert.ok(!left.includes(missed.ieee), "the one already off was asked for nothing");
  assert.deepEqual(h.glassNotes, []);
});

/** a device's state as the plan's picture has it ("on", "off"), read in the panel's VM, or undefined */
function liveOf(h, ieee) {
  assert.equal(h.panel.vm.run(`import global
import json
global.live_probe = def (a) return json.dump(global.plan.live) end`, "live"), 0, h.panel.vm.error());
  return JSON.parse(h.panel.vm.call("live_probe", ""))[ieee];
}

test("a command the lamp did whose report was lost: no communication when its time is up, and its ping answered, the panel reads the lamp, so the card takes what it really is and not what it last said", async () => {
  const h = await inHouse();
  toPlan(h);
  // the seed: the bridge's ZbInfo, 2 s after the link came up, says every lamp is off
  h.run(4000);
  const lamps = h.bridge.zigbee.devices.filter((d) => d.groups.includes(3));
  assert.ok(lamps.length > 1 && lamps.every((d) => d.power === 0), "the Middle's lamps, on the bridge's network, are off");
  const lost = lamps[0];
  // the group's command is done by it, and its report never comes
  lost.lostReports = 1;
  const trace = () => h.log.filter((l) => /PLAN|ZIGBEE|ZbPing|ZbSend|ZBBRIDGE/.test(l)).slice(-12).join("\n");
  assert.equal(liveOf(h, lost.ieee), "off", "the plan has it off, as its last report said");
  h.tap(240, 180);
  let seen = false;
  for (let t = 0; t < 6000 && !seen; t += 20) {
    h.run(20);
    seen = lost.ieee in doubtOf(h);
  }
  assert.ok(seen, `the lamp with no report, no communication when its time was up: ${trace()}`);
  assert.equal(lost.power, 1, "though it did what the command said");
  assert.deepEqual(Object.keys(doubtOf(h)), [lost.ieee], "and only that one: the others reported");
  h.run(3000);
  assert.deepEqual(doubtOf(h), {}, `its ping answered takes the "?" away: ${trace()}`);
  assert.equal(liveOf(h, lost.ieee), "on", `and the read the ping asked for told the panel what it is, on, where what it last said was off: ${trace()}`);
  assert.ok(lamps.every((d) => liveOf(h, d.ieee) === "on"), "every lamp of the Middle is on for the plan, as it is");
  // the tap after it is the other word: the card is not stuck on the one before
  h.tap(240, 180);
  h.run(2000);
  assert.ok(lamps.every((d) => d.power === 0), "the next tap turns them off");
  assert.deepEqual(h.glassNotes, []);
});

// --- the thermostats: the bridge's driver, the link, and the panel's side --------------------------------

const THERMO = "0x00124B0000B00001";

/**
 * Berry probes for the panel and the bridge: what the panel knows of a thermostat, one of the views' actions carried
 * out as the brain does, some effects run, and what the bridge's host keeps.
 */
const PANEL_PROBES = `
import json
import global
def _thermostat(id)
    var ui = global.panel_ui
    var c = ui.network.thermostat
    var z = ui.store.zone_of(id)
    return json.dump({"device": ui.store.find_device(id), "state": c.state.find(id), "shape": c.shape.find(id), "live": ui.live.find(id),
                      "zone": z != nil ? z["id"] : nil, "unconfirmed": ui.unconfirmed.contains(id), "doubt": ui.doubt.contains(id)})
end
def _act(arg)
    var ui = global.panel_ui
    ui.network.run(ui.act(json.load(arg)))
    return "ok"
end
def _run(arg)
    var ui = global.panel_ui
    ui.network.run(json.load(arg))
    return "ok"
end
def _wrong(id)
    var st = global.panel_ui.network.thermostat.state.find(id)
    st["set"] = 999
    return "ok"
end
def _editing(_)
    global.panel_ui.prefs["editing"] = true
    return "ok"
end
def _bedroom(id)
    var ui = global.panel_ui
    var st = ui.store
    var made = st.create_zone(st.doc["screens"][0]["id"], "Bedroom", [8, 0], [3, 3])
    st.add_to_zone(made["value"], id)
    st.set_display(made["value"], "adaptive")
    ui.network.run(ui.to_plan())
    return made["value"]
end
def _card(zid)
    var plan = global.plan
    var card = nil
    for c: plan.store.doc["screens"][0]["cards"] if c[0] == "z:" + zid card = c end end
    return json.dump(PanelDraw.card_icons(plan.store, card, plan.view(), plan.style))
end
def _style(_)
    return json.dump(global.plan.style["colors"])
end
def _settings(id)
    var c = global.panel_ui.network.thermostat
    var s = c.schema.find(id)
    var p = c.parts.find(id)
    return json.dump({"schema": s != nil ? size(s) : -1, "parts": p != nil ? size(p) : -1, "values": c.values.find(id)})
end
def _alarm(_)
    var al = global.panel_ui.alarm.alarm
    var cv = global.plan.canvas
    return json.dump({"st": al.st, "mode": al.mode, "events": size(al.events), "warnings": al.warnings(),
                      "notice": al.notice != nil ? al.notice["kind"] : nil, "canvas": cv != nil ? (isinstance(cv, PanelAlarmCanvas) ? cv.mode : "other") : nil})
end
def _alarm_cfg(_)
    var c = global.panel_ui.alarm.alarm.cfg
    return json.dump({"pd": c.find("pd"), "np": c.find("np"), "s": c.find("s")})
end
def _canvas(_)
    var cv = global.plan.canvas
    if cv == nil return "[]" end
    var out = []
    for op: cv.ops(global.plan.style) if op[0] == "xstr" out.push(op[11]) end end
    return json.dump(out)
end
def _sensor(id)
    var ui = global.panel_ui
    return json.dump({"device": ui.store.find_device(id), "live": ui.live.find(id), "doubt": ui.doubt.contains(id)})
end
def _devask(first)
    var h = global.house
    h.devices.ask(h.bridges()[0], int(first))
    return "ok"
end
def _devpage(_)
    return json.dump(global.house.devices.current())
end
def _devtake(arg)
    var a = json.load(arg)
    var ui = global.panel_ui
    var h = global.house
    var r = ui.store.add_remote_device(a[0], h.bridges()[0], h.devices.current()[0][a[1]])
    if r["ok"] ui.network.run([["save"]]) end
    return json.dump(r)
end
`;
const BRIDGE_PROBES = `
import json
import global
def _kept(_)
    return json.dump(global.zbbridge_relay.drivers.kept)
end
def _assigned(_)
    return json.dump(global.zbbridge_relay.drivers.assigned)
end
def _alarm_start(_)
    var a = global.zbbridge_relay.alarm
    global._said = []
    a.tap = def (w) global._said.push(w) end
    return "ok"
end
def _alarm_do(arg)
    return json.dump(global.zbbridge_relay.alarm.cmd(json.load(arg)))
end
def _alarm_view(_)
    var a = global.zbbridge_relay.alarm
    return json.dump({"st": a.st, "mode": a.mode, "cause": a.cause, "events": size(a.events), "said": global._said})
end
`;

/** the panel's view of a thermostat, from its Berry */
const seen = (h, id = THERMO) => JSON.parse(h.panel.vm.call("_thermostat", id));
const probed = (h) => {
  assert.equal(h.panel.vm.run(PANEL_PROBES, "probes"), 0, h.panel.vm.error());
  assert.equal(h.bridge.vm.run(BRIDGE_PROBES, "probes"), 0, h.bridge.vm.error());
};
/**
 * A device of the bridge's network taken into a zone as the +'s Existing device takes it (panel_remote_view.be): the house's bridge asked
 * for its devices a page at a time over the mesh, and the one with the IEEE taken. A panel learns no device from a ZbInfo: the house's network is not its.
 */
function takeExisting(h, ieee, zone = "hall") {
  for (let first = 0; first < 200; first += 5) {
    h.panel.vm.call("_devask", String(first));
    let page = null;
    for (let t = 0; t < 30000; t += 250) {
      page = JSON.parse(h.panel.vm.call("_devpage", ""));
      if (page && page[2] !== null && page[0].length === Math.min(5, page[2] - first)) break;
      h.run(250);
    }
    assert.ok(page && page[2] !== null, `the bridge's page of devices from ${first}: ${JSON.stringify(page)}`);
    const i = page[0].findIndex((it) => it[0].toUpperCase() === ieee.toUpperCase());
    if (i >= 0) {
      const r = JSON.parse(h.panel.vm.call("_devtake", JSON.stringify([zone, i])));
      assert.ok(r.ok, `${ieee} taken into ${zone}: ${JSON.stringify(r)}`);
      h.run(1000);
      return;
    }
    if (first + 5 >= page[2]) break;
  }
  assert.fail(`${ieee} among the bridge's devices`);
}

/** runs until the panel has the thermostat's state, for at most `ms` */
function untilKnown(h, ms, id = THERMO) {
  for (let t = 0; t < ms; t += 250) {
    const s = seen(h, id);
    if (s.device && s.state && s.state.cur !== undefined) return s;
    h.run(250);
  }
  return seen(h, id);
}

/** a Moes ZHT-SR on the network the panel pairs a bridge of: described, its state, a tap, the dial, a target, off */
async function moes(h) {
  probed(h);
  const dev = h.bridge.zigbee.devices.find((d) => d.ieee === THERMO);
  const trace = () => h.log.filter((l) => /DRIVERS|THERMOSTAT|BRY|RELAY|ZBBRIDGE/.test(l) && !/dropped/.test(l)).slice(-12).join("\n");
  const s0 = untilKnown(h, 40000);
  assert.deepEqual(s0.device, [THERMO, "Thermostat 1", "thermostat", 48, 50, 350, "TS0601", 1, 0, 0], `registered from its description: ${trace()}`);
  assert.equal(s0.zone, null, "a device the network had before the panel: in no zone");
  assert.deepEqual(s0.state, { cur: 200, set: 210, mode: "off", dem: 0, floor: 270 }, `its state, asked of it by the driver: ${trace()}`);
  assert.equal(s0.live, "off");
  assert.deepEqual([s0.shape.floor, s0.shape.step, s0.shape.modes, s0.shape.drv], [true, 5, ["off", "heat"], "thermostat"], "what the screens need of its description");
  assert.deepEqual(JSON.parse(h.bridge.vm.call("_kept")), { [THERMO]: "thermostat" }, "the bridge keeps whose it is");

  // a tap on its row: heat, written to its datapoint, and the device's own echo is the confirmation
  h.panel.vm.call("_act", JSON.stringify(["toggleDevice", THERMO]));
  h.run(2500);
  assert.equal(dev.thermo.dps.get(1).value, 1, `the driver wrote datapoint 1: ${trace()}`);
  const s1 = seen(h);
  assert.deepEqual([s1.live, s1.state.mode, s1.state.dem, s1.unconfirmed, s1.doubt], ["on", "heat", 100, false, false], "on, heating, and nothing left to wait for");
  // the dial turned below the room's temperature: it rests
  h.bridge.zigbee.thermostat(THERMO, { set: 180 });
  h.run(1500);
  const s2 = seen(h);
  assert.deepEqual([s2.state.set, s2.state.dem, s2.state.mode, s2.live], [180, 0, "heat", "on"], "the dial is heard: the target, and the heating that stopped");
  // a target from the views, as the detail's + will ask it
  h.panel.vm.call("_run", JSON.stringify([["thermostat", [THERMO], "target", 225]]));
  h.run(2500);
  assert.equal(dev.thermo.set, 225, "written");
  const s3 = seen(h);
  assert.deepEqual([s3.state.set, s3.state.dem], [225, 100], "the echo says it, and the room is below it again");
  // off again
  h.panel.vm.call("_act", JSON.stringify(["toggleDevice", THERMO]));
  h.run(2500);
  assert.equal(dev.thermo.dps.get(1).value, 0);
  const s4 = seen(h);
  assert.deepEqual([s4.live, s4.state.mode, s4.state.dem], ["off", "off", 0]);
  assert.deepEqual(h.log.filter((l) => /BRY: Exception|failed on/.test(l)), [], "nothing raised on either side");
  assert.deepEqual(h.glassNotes, []);
}

/** the time over the link, on a paired house: set by hand on the panel, then the panel's power cycled */
async function timeOverTheLink(h) {
  const utcOf = (d) => d.kept().epoch;
  const clockOf = (d) => {
    assert.equal(d.vm.run("def _clock() for p: global.panel_ui.providers if classname(p) == 'PanelClock' return p.source end end end", "clock"), 0, d.vm.error());
    return d.vm.call("_clock");
  };
  assert.ok(Math.abs(utcOf(h.bridge) - utcOf(h.panel)) > 60, "the two clocks apart: the bridge's is the computer's, the panel's the house's");
  // 2026-10-07 14:15, set by hand (the clock's own screen does it in panel.test.mjs), in the house's UTC
  const set = Date.UTC(2026, 9, 7, 14, 15) / 1000;
  assert.equal(h.panel.vm.run("for p: global.panel_ui.providers if classname(p) == 'PanelClock' p.set_local(" + Math.floor(set / 86400) + ", " + (set % 86400) / 60 + ") end end", "set"), 0, h.panel.vm.error());
  h.run(1000);
  assert.ok(Math.abs(utcOf(h.panel) - set) <= 1, "the panel's clock set");
  assert.ok(Math.abs(utcOf(h.bridge) - utcOf(h.panel)) <= 1, `the bridge took it: ${utcOf(h.bridge) - utcOf(h.panel)} s apart`);
  assert.equal(clockOf(h.panel), "you", "and the panel's is still the user's: the bridge's answer is its own time back");

  await h.panel.powerCycle();
  assert.ok(utcOf(h.panel) < 1451602800, "the power cycle lost the panel's clock");
  assert.equal(clockOf(h.panel), null, "and the panel boots with none");
  // the link back up, in its own time
  for (let t = 0; t < 60000 && clockOf(h.panel) !== "bridge"; t += 500) h.run(500);
  assert.ok(Math.abs(utcOf(h.panel) - utcOf(h.bridge)) <= 1, `the panel took the bridge's time when the link came up: ${utcOf(h.panel) - utcOf(h.bridge)} s apart`);
  assert.ok(utcOf(h.panel) >= set, "the time set by hand, gone on with");
  assert.equal(clockOf(h.panel), "bridge", "and the clock says it came from the bridge");
  assert.deepEqual(h.log.filter((l) => /BRY: Exception|failed on/.test(l)), [], "nothing raised on either side");
}

test("the time over the link: a time set by hand on the panel goes to its bridge over ESP-NOW, and a panel that lost its power takes it back when the link comes up", async () => {
  await timeOverTheLink(await inHouse());
});

test("the schedule, end to end: an event made on the glass for the Moes, one Home Assistant makes for a lamp over the house's MQTT, an overlap refused in the glass's words, the clock run to their starts and ends, and a touch in the middle that is the last word", async () => {
  const broker = { host: "192.168.0.10", user: "home", password: "secret" };
  const h = await inHouse({ broker, mqtt: { ...broker, port: 1883 }, thermostats: [{ ieee: THERMO, profile: "tuya" }] });
  probed(h);
  untilKnown(h, 40000);
  const home = h.home;
  const moes = h.bridge.zigbee.devices.find((d) => d.ieee === THERMO);
  const LAMP = "0x00124B0000C00001";
  const lamp = () => h.bridge.zigbee.devices.find((d) => d.ieee === LAMP);
  // a touch through the views, and the moment a finger takes before the next: the page it loads says so first
  const ui = (code) => {
    assert.equal(h.panel.vm.run("import global\nvar ui = global.panel_ui\n" + code, "ui"), 0, h.panel.vm.error());
    h.run(400);
  };
  // the panel's clock: the house's start, 2026-09-30 20:00 UTC, and the time run since; the panel's zone is UTC
  const minute = () => Math.floor((Date.UTC(2026, 8, 30, 20, 0, 0) / 1000 + Math.floor(home.now / 1000)) / 60) % 1440;
  const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, "0") + String(m % 60).padStart(2, "0");
  const words = (m) => hhmm(m).slice(0, 2) + ":" + hhmm(m).slice(2);
  const until = (m) => { for (let t = 0; t < 400000 && minute() < m; t += 1000) h.run(1000); h.run(4000); };
  const start = minute() + 2;

  // on the glass: the thermostat's schedule, a new event, its times typed, its start's action on its page, and the check
  ui('ui.prefs["editing"] = true');
  ui('ui.network.run(ui.act(["schedule", "open", "' + THERMO + '"]))');
  ui("ui.network.run(ui.action())");
  // Start as a finger goes: its row, the Time marked on its screen (the option marked takes a tap too), and the keyboard,
  // empty, taking keys
  for (let i = 0; i < 3 && !h.shows("Start"); i++) drag(h, [200, 290], [200, 110]);
  h.tapRow("Start");
  assert.ok(h.until("Sunrise", 3000), `Start's screen: ${h.texts().filter(Boolean)}`);
  h.tapRow("Time");
  assert.equal(h.glass.page.name, "editboard", "the time marked opens its keyboard");
  assert.equal(textOf(String(h.glass.read("screensaver.kbIn.txt"))), "", "empty");
  h.keys(...hhmm(start).split(""), "OK");
  assert.ok(h.until(words(start), 3000), `back on the event, with the time typed: ${h.texts().filter(Boolean)}`);
  ui('ui.network.run(ui.act(["open", "eventTime", "to"]))');
  ui('ui.network.run(ui.open_keyboard(["keyboard", "schedule", "to"]))');
  ui('ui.network.run(ui.commit("' + hhmm(start + 3) + '"))');
  ui('ui.network.run(ui.act(["schedule", "action", 7]))');
  for (let i = 0; i < 3; i++) ui('ui.network.run(ui.thermostat_step("$thermostat.plus.count"))');
  ui("ui.network.run(ui.close())");
  ui("ui.network.run(ui.action())");
  h.run(4000);
  assert.equal(h.panel.vm.run("import global\nimport json\nglobal._events = def (a) return json.dump(global.panel_ui.schedule.sched.events()) end", "probe"), 0);
  const events = () => JSON.parse(h.panel.vm.call("_events", ""));
  assert.deepEqual(events().map((e) => [e[1], e[3], e[4], e[5], e[7]]), [[THERMO, start, start + 3, null, 225]], "saved from the glass, at 22.5°C");

  // Home Assistant: the panel's word on the house's MQTT, retained, and a command on its topic
  const base = [...home.retained.keys()].find((t) => t.startsWith("houseweave/schedule/") && t.endsWith("/panel")).replace(/panel$/, "");
  const said = JSON.parse(home.retained.get(base + "panel"));
  assert.deepEqual([said.command, said.result], ["cmnd/" + h.panel.mqttTopic + "/Schedule", "stat/" + h.panel.mqttTopic + "/RESULT"], "where the panel is asked");
  // what the panel says on the broker goes one message at a time: the event after the panel and every device of it
  for (let t = 0; t < 20000 && !home.retained.get(base + "event/" + events()[0][0]); t += 500) h.run(500);
  assert.equal(JSON.parse(home.retained.get(base + "device/" + THERMO)).name, "Thermostat 1", "the thermostat, a calendar of Home Assistant");
  assert.equal(JSON.parse(home.retained.get(base + "event/" + events()[0][0])).during, "22.5°C", "and its event");
  const answers = [];
  home.mqttService(said.result, (topic, payload) => { const a = JSON.parse(payload).Schedule; if (a) answers.push(a); });
  const ask = (q) => { home.mqttPublish(said.command, JSON.stringify(q), false, "home-assistant"); h.run(1500); return answers.at(-1); };
  const lampEvent = { for: LAMP, day: "2026-09-30", from: words(start + 1), to: words(start + 4), during: "Corridor: 60% blue" };
  const made = ask({ n: 1, op: "put", event: lampEvent });
  assert.equal(made.ok, true, "Home Assistant's event for the lamp, taken: " + JSON.stringify(made));
  assert.deepEqual(ask({ n: 2, op: "put", event: { ...lampEvent, for: THERMO, during: "20" } }),
    { n: 2, ok: false, error: "overlap", message: "Thermostat 1 already has an event on Wed 30/09 " + words(start) + "-" + words(start + 3) + "." },
    "one that overlaps the thermostat's is refused, in the glass's words");
  h.run(3000);
  assert.ok(home.retained.has(base + "event/" + made.uid), "the lamp's event said back, retained, for every calendar");

  // the clock run to the starts: the thermostat heats to its target, the lamp lights blue at 60%
  until(start);
  assert.deepEqual([moes.thermo.dps.get(1).value, moes.thermo.set], [1, 225], "the Moes on, at 22.5°C, as its page would put it");
  until(start + 1);
  assert.deepEqual([lamp().power, lamp().dimmer, lamp().hue], [1, 149, 167], "the lamp on, at 60% and blue, as its sliders would");
  // a touch in the middle: the lamp off by hand, and the schedule does not turn it back
  ui('ui.network.run(ui.act(["toggleDevice", "' + LAMP + '"]))');
  h.run(3000);
  assert.equal(lamp().power, 0, "off by hand");
  until(start + 3);
  assert.equal(lamp().power, 0, "and left off: the touch was the last word");
  assert.equal(moes.thermo.dps.get(1).value, 0, "the thermostat's event over: off");
  until(start + 4);
  assert.equal(lamp().power, 0, "the lamp's over too");
  assert.deepEqual(h.log.filter((l) => /BRY: Exception|failed on|schedule's commands failed/.test(l)), [], "nothing raised on either side");
  assert.deepEqual(h.glassNotes, []);
});

test("a Moes ZHT-SR on the bridge's network, over ESP-NOW: its driver describes it to the panel when the link comes up, its state follows, a tap turns it on and the echo confirms it, and the dial and a target are heard", async () => {
  await moes(await inHouse({ thermostats: [{ ieee: THERMO, profile: "tuya" }] }));
});

test("a ZCL thermostat joins while the Hall's + searches: the bridge's driver takes its interview and describes it, the panel puts it in the Hall, a mode is read back, and the dial's mode, which a ZCL device never reports, is read when the panel asks", async () => {
  const h = await inHouse();
  probed(h);
  toPlan(h);
  h.tap(40, 160, 800);
  assert.equal(h.glass.page.name, "zone", "the Hall");
  h.tap(425, 39);
  h.tapRow("Zigbee device");
  // a house with a bridge: a new device or one the bridge has, and the one bridge the new one is paired on
  h.tapRow("Pair new device");
  h.run(1000);
  assert.ok(h.bridge.zigbee.permitUntil > h.home.now, "the network open");
  const dev = h.bridge.zigbee.joinThermostat({ ieee: THERMO, profile: "zcl" });
  assert.ok(dev, "it joins");
  const trace = () => h.log.filter((l) => /DRIVERS|THERMOSTAT|BRY|RELAY|ZIGBEE/.test(l) && !/dropped/.test(l)).slice(-12).join("\n");
  const s0 = untilKnown(h, 15000);
  assert.deepEqual(s0.device.slice(0, 8), [THERMO, "Thermostat 1", "thermostat", 48, 50, 300, "SIMTHERM", 1], `registered from its description: ${trace()}`);
  assert.equal(s0.zone, "hall", "in the zone the + searched for");
  assert.deepEqual(s0.state, { cur: 200, set: 210, mode: "off", dem: 0 }, "read as a ZCL thermostat is: no floor probe");
  assert.equal(h.bridge.zigbee.devices.find((d) => d.ieee === THERMO).thermo.mode, 0);

  // a tap on its row: SystemMode 4, which a ZCL device does not report, read back a moment after
  h.panel.vm.call("_act", JSON.stringify(["toggleDevice", THERMO]));
  h.run(3000);
  assert.equal(dev.thermo.mode, 4, "SystemMode written");
  const s1 = seen(h);
  assert.deepEqual([s1.live, s1.state.mode, s1.state.dem, s1.unconfirmed, s1.doubt], ["on", "heat", 100, false, false], `confirmed by the read-back: ${trace()}`);
  // the dial turns it off: nothing is reported, and the panel shows what it knew
  h.bridge.zigbee.thermostat(THERMO, { on: false });
  h.run(2000);
  assert.equal(seen(h).live, "on", "a ZCL thermostat's mode on the dial is not heard");
  h.panel.vm.call("_run", JSON.stringify([["thermostat", [THERMO], "read", null]]));
  h.run(2500);
  const s2 = seen(h);
  assert.deepEqual([s2.live, s2.state.mode], ["off", "off"], "asked, it says it");
  assert.deepEqual(h.log.filter((l) => /BRY: Exception|failed on/.test(l)), [], "nothing raised on either side");
});

// --- a switch of several channels: each channel a device of the panel --------------------------------

const SWITCH = "0x00124B0000B0C001";
const CHANNEL_PROBES = `
import json
import global
def _dev(id)
    var ui = global.panel_ui
    var z = ui.store.zone_of(id)
    return json.dump({"device": ui.store.find_device(id), "zone": z != nil ? z["id"] : nil, "live": ui.live.find(id)})
end
def _cover(id)
    return json.dump(global.panel_ui.network.cover.state.find(id))
end
def _owed(_)
    return json.dump(global.panel_ui.provider_of("driver", nil).owed)
end
`;
const dev = (h, id) => JSON.parse(h.panel.vm.call("_dev", id));

test("a two-channel switch joins in the Hall's search: two devices, each channel obeying alone and heard from its own endpoint", async () => {
  const h = await inHouse();
  probed(h);
  assert.equal(h.panel.vm.run(CHANNEL_PROBES, "channels"), 0, h.panel.vm.error());
  toPlan(h);
  h.tap(40, 160, 800);
  assert.equal(h.glass.page.name, "zone", "the Hall");
  h.tap(425, 39);
  h.tapRow("Zigbee device");
  // a house with a bridge: a new device or one the bridge has, and the one bridge the new one is paired on
  h.tapRow("Pair new device");
  h.run(1000);
  const ds = h.bridge.zigbee.joinSwitch({ ieee: SWITCH, channels: 2 });
  assert.ok(ds, "it joins");
  const trace = () => h.log.filter((l) => /BRY|RELAY|ZIGBEE|PAIR/.test(l) && !/dropped/.test(l)).slice(-12).join("\n");
  let a = dev(h, SWITCH);
  let b = dev(h, SWITCH + "/2");
  for (let t = 0; t < 15000 && !(a.device && b.device); t += 250) {
    h.run(250);
    a = dev(h, SWITCH);
    b = dev(h, SWITCH + "/2");
  }
  assert.deepEqual([a.device?.slice(0, 3), b.device?.slice(0, 3), a.zone, b.zone],
    [[SWITCH, "Switch 1", "switch"], [SWITCH + "/2", "Switch 2", "switch"], "hall", "hall"], `two devices, both switches, both in the Hall: ${trace()}`);
  h.run(2000);
  assert.deepEqual(ds.map((d) => d.startUpOnOff), [0, 0], "each channel is asked to come back off, on its endpoint");
  // the second channel on, from the panel: its endpoint alone
  h.panel.vm.call("_act", JSON.stringify(["toggleDevice", SWITCH + "/2"]));
  h.run(2000);
  assert.deepEqual(ds.map((d) => d.power), [0, 1], "the second channel alone");
  assert.equal(dev(h, SWITCH + "/2").live, "on", "and the panel heard it, from its endpoint");
  // the first channel's key on the module
  h.bridge.zigbee.switchKey(SWITCH, 1);
  h.run(1500);
  assert.deepEqual([dev(h, SWITCH).live, dev(h, SWITCH + "/2").live], ["on", "on"], "its key reports from its endpoint, and the second stays as it was");
  assert.deepEqual(h.log.filter((l) => /BRY: Exception|failed on/.test(l)), [], "nothing raised on either side");
});

test("the two-channel switch made a window: joined by the panel, its motor run by the bridge's driver one channel at a time, and given back", async () => {
  const h = await inHouse();
  probed(h);
  assert.equal(h.panel.vm.run(CHANNEL_PROBES, "channels"), 0, h.panel.vm.error());
  toPlan(h);
  h.tap(40, 160, 800);
  h.tap(425, 39);
  h.tapRow("Zigbee device");
  // a house with a bridge: a new device or one the bridge has, and the one bridge the new one is paired on
  h.tapRow("Pair new device");
  h.run(1000);
  const ds = h.bridge.zigbee.joinSwitch({ ieee: SWITCH, channels: 2 });
  for (let t = 0; t < 15000 && !dev(h, SWITCH + "/2").device; t += 250) h.run(250);
  assert.ok(dev(h, SWITCH + "/2").device, "two channels");
  const trace = () => h.log.filter((l) => /BRY|DRIVERS|TWOKEY|COVER/.test(l) && !/dropped/.test(l)).slice(-12).join("\n");
  // the panel joins them, a window, and assigns the bridge's driver
  h.panel.vm.call("_act", JSON.stringify(["driver", "join", SWITCH, "window"]));
  h.run(3000);
  assert.deepEqual(JSON.parse(h.bridge.vm.call("_kept"))[SWITCH], "twokey", `the bridge's driver has it: ${trace()}`);
  const d = dev(h, SWITCH);
  assert.deepEqual([d.device.slice(2, 6), dev(h, SWITCH + "/2").device], [["cover", 64, 0, 1], null], "one device, a blind that is a window");
  assert.deepEqual(ds.map((x) => x.startUpOnOff), [0, 0], "both channels come back off after a power cut");
  // open: its first channel runs for the travel, 20 s by default, and the other never with it
  h.panel.vm.call("_run", JSON.stringify([["cover", [SWITCH], "open"]]));
  h.run(2000);
  assert.deepEqual(ds.map((x) => x.power), [1, 0], `the open channel on, the close one off: ${trace()}`);
  assert.equal(JSON.parse(h.panel.vm.call("_cover", SWITCH)).mov, "up", "the panel sees it going up");
  h.run(22000);
  assert.deepEqual(ds.map((x) => x.power), [0, 0], "off at the end of its travel");
  assert.deepEqual(JSON.parse(h.panel.vm.call("_cover", SWITCH)), { pos: 100, mov: "stop" }, "open, as the panel sees it");
  // given back: a switch of two channels again
  h.panel.vm.call("_act", JSON.stringify(["driver", "release", SWITCH]));
  h.run(2000);
  assert.equal(JSON.parse(h.bridge.vm.call("_kept"))[SWITCH], undefined, "the bridge's driver let it go");
  assert.deepEqual([dev(h, SWITCH).device.slice(2, 4), dev(h, SWITCH + "/2").zone], [["switch", 1], "hall"], "two switches again, both in the Hall");
  assert.deepEqual(h.log.filter((l) => /BRY: Exception|failed on/.test(l)), [], "nothing raised on either side");
});

test("the bridge restarts: it still knows whose the thermostat is, and back in the house it tells the panel everything again", async () => {
  const h = await inHouse({ thermostats: [{ ieee: THERMO, profile: "tuya" }] });
  probed(h);
  untilKnown(h, 40000);
  h.bridge.zigbee.thermostat(THERMO, { set: 195 });
  h.run(1500);
  assert.equal(seen(h).state.set, 195);
  // the panel's own copy is made wrong, to see it set right
  h.panel.vm.call("_wrong", THERMO);
  assert.equal(seen(h).state.set, 999);
  await h.bridge.restartNow();
  // its boot: the relay starts a moment after the VM
  h.run(3000);
  probed(h);
  assert.deepEqual(JSON.parse(h.bridge.vm.call("_kept")), { [THERMO]: "thermostat" }, "the claim came back from the flash");
  for (let t = 0; t < 60000 && seen(h).state?.set !== 195; t += 500) h.run(500);
  assert.equal(seen(h).state?.set, 195, "back in the house and in step: everything said again, the field the panel had wrong included");
  assert.deepEqual(h.log.filter((l) => /BRY: Exception|failed on/.test(l)), [], "nothing raised on either side");
});

test("the panel restarts: the thermostat is still its own, from the file, and the link that comes up tells it the state again, though the bridge has said it before", async () => {
  const h = await inHouse({ thermostats: [{ ieee: THERMO, profile: "tuya" }] });
  probed(h);
  untilKnown(h, 40000);
  h.bridge.zigbee.thermostat(THERMO, { set: 195, on: true });
  h.run(1500);
  assert.deepEqual([seen(h).state.set, seen(h).live], [195, "on"]);
  await h.panel.restartNow();
  h.run(3000);
  probed(h);
  assert.deepEqual(seen(h).device.slice(0, 4), [THERMO, "Thermostat 1", "thermostat", 48], "the panel's file has it: it was saved when its description came");
  for (let t = 0; t < 60000 && seen(h).state?.set !== 195; t += 500) h.run(500);
  assert.deepEqual([seen(h).state?.set, seen(h).state?.mode, seen(h).live], [195, "heat", "on"], "told again by the link that came up: the bridge cleared what it had said");
  assert.deepEqual(h.log.filter((l) => /BRY: Exception|failed on/.test(l)), [], "nothing raised on either side");
});

test("a claim only a restart can show: a ZCL thermostat claimed by its own report is the bridge's driver's after the bridge restarts, and answers to the panel", async () => {
  const ZCL = "0x00124B0000B00002";
  const h = await inHouse({ thermostats: [{ ieee: ZCL, profile: "zcl" }] });
  probed(h);
  h.run(3000);
  assert.deepEqual(JSON.parse(h.bridge.vm.call("_kept")), {}, "a ZCL thermostat has nothing the bridge can claim it by, until it says what it is");
  h.bridge.zigbee.thermostat(ZCL, { cur: 205 });
  const s0 = untilKnown(h, 20000, ZCL);
  assert.deepEqual(s0.device?.slice(0, 4), [ZCL, "Thermostat 1", "thermostat", 48], "its report claimed it, and the driver described it");
  assert.deepEqual(JSON.parse(h.bridge.vm.call("_kept")), { [ZCL]: "thermostat" });
  // the claim is written to the flash a few seconds after it is made, once it stops changing
  h.run(6000);
  // the panel's own copy is made wrong, to see it set right by what the bridge says again after its boot
  h.panel.vm.call("_wrong", ZCL);
  await h.bridge.restartNow();
  h.run(3000);
  probed(h);
  assert.deepEqual(JSON.parse(h.bridge.vm.call("_kept")), { [ZCL]: "thermostat" }, "kept in the flash: nothing else could claim it again");
  for (let t = 0; t < 60000 && seen(h, ZCL).state?.set !== 210; t += 500) h.run(500);
  assert.equal(seen(h, ZCL).state?.set, 210, "the bridge back in the house, and the driver read the device: its target is told again");
  // a command goes once the panel's gate has the bridge in step again, two heartbeats after its restart (panel_gate.be)
  assert.ok(untilLinked(h, 30000), "the bridge in step again");
  h.panel.vm.call("_act", JSON.stringify(["toggleDevice", ZCL]));
  h.run(3000);
  assert.equal(h.bridge.zigbee.devices.find((d) => d.ieee === ZCL).thermo.mode, 4, "and the bridge's driver takes its commands");
  assert.equal(seen(h, ZCL).live, "on");
});

test("a ZHT-SR that takes a write and does not echo it: the driver waits, then asks for everything, and the panel hears the new state", async () => {
  const h = await inHouse({ thermostats: [{ ieee: THERMO, profile: "tuya", echo: false }] });
  probed(h);
  untilKnown(h, 40000);
  const dev = h.bridge.zigbee.devices.find((d) => d.ieee === THERMO);
  h.panel.vm.call("_act", JSON.stringify(["toggleDevice", THERMO]));
  h.run(600);
  assert.equal(dev.thermo.dps.get(1).value, 1, "written");
  assert.deepEqual([seen(h).live, seen(h).unconfirmed], ["off", true], "and not said: the panel waits");
  h.run(3000);
  const s = seen(h);
  assert.deepEqual([s.live, s.state.mode, s.state.dem, s.unconfirmed, s.doubt], ["on", "heat", 100, false, false], "the driver asked for all the datapoints a moment after, and the panel has the state, in time");
});

test("a Moes ZHT-SR's settings, on the glass: opening them asks the driver, whose schema comes in frames over ESP-NOW; a flag, a choice, a range and a number are written to the datapoints, and the screen shows what the device says", async () => {
  const h = await inHouse({ thermostats: [{ ieee: THERMO, profile: "tuya" }] });
  probed(h);
  untilKnown(h, 40000);
  h.panel.vm.call("_editing");
  const dev = h.bridge.zigbee.devices.find((d) => d.ieee === THERMO);
  const dp = (n) => dev.thermo.dps.get(n).value;
  const trace = () => h.log.filter((l) => /DRIVERS|THERMOSTAT|RELAY|BRY/.test(l) && !/dropped/.test(l)).slice(-8).join("\n");
  // the settings of its options, as the glass's row opens them
  h.panel.vm.call("_act", JSON.stringify(["thermostat", "open", THERMO]));
  const ok = h.until("Child lock", 8000);
  assert.ok(ok, `the schema came in its frames, and the screen has its rows: ${h.texts().filter(Boolean)}\n${h.panel.vm.call("_settings", THERMO)}\n${trace()}`);
  assert.ok(h.shows("Preset") && h.shows("Calibration"), `the first page: ${h.texts().filter(Boolean)}`);
  assert.ok(h.shows("Manual") && h.shows("Off"), `the values the device said, a flag and a choice: the lock off, the preset the one the device has: ${h.texts().filter(Boolean)}`);
  const first = h.texts().filter(Boolean);
  // a flag: a touch asks for the opposite, and the screen shows it once the device says it did
  h.tapRow("Child lock");
  h.run(1500);
  assert.equal(dp(39), 1, `the lock written to its datapoint: ${trace()}`);
  assert.ok(h.shows("On"), `and the screen says so: ${h.texts().filter(Boolean)}`);
  // a choice: its list, the dot on the preset the device has, a touch takes another and goes back
  h.tapRow("Preset");
  assert.ok(h.until("Program", 3000), `the list of the presets: ${h.texts().filter(Boolean)}`);
  for (let i = 0; i < 2 && !h.shows("Eco"); i++) drag(h, [200, 290], [200, 110]);
  h.tapRow("Eco");
  h.run(1500);
  assert.equal(dp(2), 3, `the preset written: ${trace()}`);
  assert.ok(h.until("Calibration", 3000) && h.shows("Eco"), `back on the settings, the preset the device has now: ${h.texts().filter(Boolean)}`);
  // a range below zero: its list of whole numbers, and a touch on one of them
  h.tapRow("Calibration");
  assert.ok(h.until("0°", 3000), `the list of the range: ${h.texts().filter(Boolean)}`);
  for (let i = 0; i < 6 && !h.shows("-2°"); i++) drag(h, [200, 110], [200, 290]);
  assert.ok(h.shows("-2°"), `the list pages to -2: ${h.texts().filter(Boolean)}`);
  h.tapRow("-2°");
  h.run(1500);
  assert.equal(dp(101), 254, `-2 is stored past 256: ${trace()}`);
  assert.ok(h.until("Calibration", 3000) && h.shows("-2°"), `and the screen shows it: ${h.texts().filter(Boolean)}`);
  // a number, on the keyboard: the max limit
  drag(h, [200, 290], [200, 110]);
  assert.ok(h.shows("Max limit"), `the next page: ${h.texts().filter(Boolean)}`);
  h.tapRow("Max limit");
  assert.equal(h.glass.page.name, "editboard", "the keyboard");
  // the keypad opens on the 35 the device has: it is erased, and 40 typed
  h.keys("DEL", "DEL", "4", "0", "OK");
  h.run(1500);
  assert.equal(dp(34), 400, `the limit in tenths of a degree: ${trace()}`);
  assert.ok(h.until("40°", 3000), `and the screen shows it: ${h.texts().filter(Boolean)}`);
  assert.deepEqual(h.log.filter((l) => /BRY: Exception|failed on/.test(l)), [], "nothing raised on either side");
  assert.deepEqual(h.glassNotes, []);
  assert.ok(first.length > 0);
});

const DOOR = "0x00124B00AAAA0001";

test("a door sensor on the bridge's network: the panel takes it from the bridge's devices as a sensor, and its state follows the door over the mesh, open on and closed off", async () => {
  const PIR = "0x00124B00AAAA0002";
  const h = await inHouse({ sensors: [{ ieee: DOOR, kind: "contact" }, { ieee: PIR, kind: "motion" }] });
  probed(h);
  const seen = () => JSON.parse(h.panel.vm.call("_sensor", DOOR));
  // the Hall's Existing device: the bridge's page of its devices, and the sensor taken
  takeExisting(h, DOOR);
  takeExisting(h, PIR);
  let s = seen();
  for (let t = 0; t < 20000 && s.live == null; t += 500) {
    h.run(500);
    s = seen();
  }
  assert.ok(s.device, `the panel took the sensor: ${h.log.filter((l) => l.includes("ZIGBEE")).slice(-5).join("\n")}`);
  assert.deepEqual([s.device[1], s.device[2], s.device[3]], ["Sensor 1", "sensor", 0], "as a sensor, with no caps, named by its kind");
  assert.deepEqual([s.live, s.doubt], ["off", false], "closed at rest, as the bridge read it once it was marked, and not in doubt");
  h.bridge.zigbee.trip(DOOR, true);
  h.run(1000);
  assert.equal(seen().live, "on", "the door open is on, over the link");
  h.bridge.zigbee.trip(DOOR, false, { batteryLow: true });
  h.run(1000);
  s = seen();
  assert.deepEqual([s.live, s.doubt], ["off", false], "closed is off, and the low battery flag in the same report changes nothing else");
  // a motion sensor, by the occupancy cluster, through the same path
  h.run(3000);
  const pir = () => JSON.parse(h.panel.vm.call("_sensor", PIR));
  assert.deepEqual([pir().device?.[2], pir().live], ["sensor", "off"], "a motion sensor, at rest");
  h.bridge.zigbee.trip(PIR, true);
  h.run(1000);
  assert.equal(pir().live, "on", "motion seen is on");
});

test("the alarm on the bridge, with a door on its network: armed away, the door opens, the alarm triggers and says so over the mesh in frames that fit, the panel still sees the door, and a disarm ends it", async () => {
  const h = await inHouse({ sensors: [{ ieee: DOOR, kind: "contact" }] });
  probed(h);
  const seen = () => JSON.parse(h.panel.vm.call("_sensor", DOOR));
  takeExisting(h, DOOR);
  let s = seen();
  assert.ok(s.device, "the panel took the door sensor from the bridge's devices");
  assert.equal(h.bridge.vm.call("_alarm_start", ""), "ok");
  const view = () => JSON.parse(h.bridge.vm.call("_alarm_view", ""));
  const act = (m) => JSON.parse(h.bridge.vm.call("_alarm_do", JSON.stringify(m)));
  // the door is the perimeter's, and the one one comes in by; no time to leave, none to come in
  assert.equal(act({ do: "sensor", id: DOOR, role: "perimeter", entry: true, notify: "house" }), true);
  assert.equal(act({ do: "times", exit: 0, entry: 0, siren: 5 }), true);
  assert.equal(act({ do: "arm", mode: "away", by: "panel" }), true);
  assert.deepEqual([view().st, view().mode], ["armed_away", "away"]);
  h.bridge.zigbee.trip(DOOR, true);
  h.run(1500);
  let v = view();
  assert.deepEqual([v.st, v.cause], ["triggered", [DOOR.toUpperCase().replace("0X", "0x"), "open"]], "the door opened on an armed alarm: triggered, by the door");
  assert.equal(seen().live, "on", "and the panel's own path still sees the door open");
  const types = v.said.filter((m) => m.ZbAlarm.ev).map((m) => m.ZbAlarm.ev[2]);
  assert.deepEqual(types.slice(-3), ["arm", "open", "trigger"], "the events said to the panel: the arm, the door, the trigger");
  assert.ok(v.said.some((m) => m.ZbAlarm.st === "triggered"), "and the state");
  for (const m of v.said) assert.ok(JSON.stringify(m).length <= 233, "each message fits a frame of the link: " + JSON.stringify(m));
  // the siren time is 5 s: the siren quiet, and, the bridge in a house, its replica keeps the state triggered until a disarm
  h.run(6000);
  v = view();
  assert.deepEqual([v.st, v.said.some((m) => m.ZbAlarm.ev?.[2] === "siren_off")], ["triggered", true], "the siren time ends: quiet, and triggered until a disarm");
  h.bridge.zigbee.trip(DOOR, false);
  h.run(500);
  assert.equal(act({ do: "disarm", by: "panel" }), true);
  v = view();
  assert.deepEqual([v.st, v.mode], ["disarmed", null], "disarmed");
  assert.equal(seen().live, "off", "the door closed, on the panel");
});

test("the alarm on the glass: the panel keeps the bridge's state, an event of the alarm's grade takes the screen until a touch, the Alarm screen says it, and a frenzy of touches is the panic", async () => {
  const h = await inHouse({ sensors: [{ ieee: DOOR, kind: "contact" }] });
  probed(h);
  const seen = () => JSON.parse(h.panel.vm.call("_sensor", DOOR));
  takeExisting(h, DOOR);
  let s = seen();
  assert.ok(s.device, "the panel took the door sensor from the bridge's devices");
  assert.equal(h.bridge.vm.call("_alarm_start", ""), "ok");
  const alarm = () => JSON.parse(h.panel.vm.call("_alarm", ""));
  const act = (m) => JSON.parse(h.bridge.vm.call("_alarm_do", JSON.stringify(m)));
  const bridgeView = () => JSON.parse(h.bridge.vm.call("_alarm_view", ""));
  assert.equal(act({ do: "sensor", id: DOOR, role: "perimeter", entry: false, notify: "house" }), true);
  assert.equal(act({ do: "times", exit: 0, entry: 0, siren: 3 }), true);
  // the panel arms it from the glass: the word goes over the link, and the state comes back
  h.panel.vm.call("_act", JSON.stringify(["alarm", "arm", "away"]));
  h.run(1500);
  assert.deepEqual([bridgeView().st, alarm().st, alarm().mode], ["armed_away", "armed_away", "away"], "armed from the glass, and the panel says what the bridge says");
  // the Alarm screen, from its row: the plan's page, with the state in words
  h.panel.vm.call("_act", JSON.stringify(["alarm", "open", "alarm"]));
  h.run(1500);
  assert.equal(alarm().canvas, "alarm", "the Alarm screen is the plan's canvas");
  assert.ok(JSON.parse(h.panel.vm.call("_canvas", "")).includes("Armed away"), "and says Armed away");
  // the door opens on an armed alarm: the trigger takes the glass, over the Alarm screen
  h.bridge.zigbee.trip(DOOR, true);
  h.run(2000);
  let a = alarm();
  assert.deepEqual([a.st, a.notice, a.canvas], ["triggered", "event", "notice"], "triggered: the notice has the glass");
  const words = JSON.parse(h.panel.vm.call("_canvas", ""));
  assert.equal(words[0], "ALARM", "its title");
  assert.ok(words.includes("Tap to dismiss"), "and how to leave it");
  // a touch leaves it, and the Alarm screen is back under it, saying triggered
  h.tap(240, 160);
  a = alarm();
  assert.deepEqual([a.notice, a.canvas], [null, "alarm"], "a touch leaves the notice and the Alarm screen is back");
  assert.ok(JSON.parse(h.panel.vm.call("_canvas", "")).includes("TRIGGERED"), "saying so");
  // the siren time ends and the door closes: the bridge in a house, its replica keeps the state triggered until a disarm, from the bridge
  h.run(4000);
  h.bridge.zigbee.trip(DOOR, false);
  h.run(500);
  assert.equal(alarm().st, "triggered", "the siren time ended: triggered until a disarm");
  assert.equal(act({ do: "disarm", by: "panel" }), true);
  h.run(1500);
  assert.equal(alarm().st, "disarmed", "disarmed, as the panel says");
  // the screensaver comes up: the trigger and the door are not seen, so the alarm's sign is red and the house's yellow
  for (let t = 0; t < 90000 && h.glass.page.name !== "screensaver"; t += 500) h.run(500);
  assert.equal(h.glass.page.name, "screensaver", "the glass rests");
  const sign = (name) => h.glass.components().find((c) => c.def.objname === name);
  assert.equal(sign("tIcon2").attrs.pco, 63488, "the alarm's sign is red");
  assert.equal(sign("tIcon3").attrs.pco, 65504, "the house's is yellow");
  // acknowledged, on the glass that is resting: both go out, to the page's own background
  h.panel.vm.call("_act", JSON.stringify(["alarm", "ack", null]));
  h.run(800);
  assert.deepEqual([sign("tIcon2").attrs.pco, sign("tIcon3").attrs.pco], [0, 0], "acknowledged: both signs are the background again");
});

test("a frenzy of touches on the glass is the panic: its own screen for a moment, the word to the bridge, and the screen back", async () => {
  const h = await inHouse();
  // the pairing leaves the Zigbee's view on the glass, whose rows reach the bottom edge: the plan's, where no card is
  toPlan(h);
  probed(h);
  assert.equal(h.bridge.vm.call("_alarm_start", ""), "ok");
  const alarm = () => JSON.parse(h.panel.vm.call("_alarm", ""));
  const bridgeView = () => JSON.parse(h.bridge.vm.call("_alarm_view", ""));
  h.run(2000);
  assert.equal(alarm().notice, null, "nothing on the glass");
  // eight touches of the page's bottom edge, 100 ms apart, where no card is
  for (let i = 0; i < 8; i++) {
    h.glass.press(240, 314);
    h.run(40);
    h.glass.release();
    h.run(60);
  }
  h.run(300);
  assert.equal(alarm().notice, "brief", "the eighth: the panic's own screen");
  assert.ok(JSON.parse(h.panel.vm.call("_canvas", "")).includes("Panic activated"), "which says so");
  h.run(1500);
  const events = bridgeView().said.filter((m) => m.ZbAlarm.ev).map((m) => m.ZbAlarm.ev[2]);
  assert.ok(events.includes("panic"), "the word reached the bridge, which made an event of it: " + events);
  assert.equal(alarm().notice, "brief", "and the bridge's word of it did not make another screen");
  h.run(5200);
  assert.deepEqual([alarm().notice, alarm().canvas], [null, null], "after five seconds the screen is the plan again");
});

test("a Moes ZHT-SR's temperatures on the summed-up card of its zone: the room's and the floor's, in whole degrees, painted by the glass and painted again when a degree changes", async () => {
  const h = await inHouse({ thermostats: [{ ieee: THERMO, profile: "tuya" }] });
  probed(h);
  untilKnown(h, 40000);
  // the lamps' states in, each device asked of its bridge: the plan quiet before the glass is looked at
  const map = mapWhole(h);
  assert.equal(map.mapped, map.count, "the panel's map of its devices, whole");
  h.run(3000);
  const zid = h.panel.vm.call("_bedroom", THERMO);
  h.run(3000);
  assert.equal(h.glass.page.name, "home", "the plan is on the glass");
  const frame = h.glass.frame;
  const lines = () => JSON.parse(h.panel.vm.call("_card", zid)).filter((op) => op[0] === "xstr" && String(op[11]).includes("°"));
  /** the pixels of an instruction's box, and how many of them are the colour its text is painted in */
  const box = (op) => {
    const px = [];
    for (let y = op[2]; y < op[2] + op[4]; y++) for (let x = op[1]; x < op[1] + op[3]; x++) px.push(frame.pixels[y * frame.width + x]);
    return px;
  };
  const ink = (op) => box(op).filter((p) => p === op[6]).length;
  const [room, floor] = lines();
  assert.deepEqual([room[11], floor[11]], ["20°", "27°"], "what the emulated device said, in whole degrees: the room's, and the floor probe's");
  assert.notEqual(room[6], floor[6], "the floor's number is in another colour");
  assert.ok(ink(room) > 15 && ink(floor) > 15, `the glass painted both numbers, in the colours they were sent in: ${ink(room)} and ${ink(floor)} pixels`);
  const before = box(room);
  // a degree more in the room, 21.6 and so 22: the card is painted again
  h.bridge.zigbee.thermostat(THERMO, { cur: 216 });
  h.run(2000);
  const [room2, floor2] = lines();
  assert.deepEqual([room2[11], floor2[11]], ["22°", "27°"], "the room's number follows the device, and the floor's stays");
  assert.ok(ink(room2) > 15, "and the glass shows it");
  assert.notDeepEqual(box(room2), before, "the room's box on the glass is not what it was");
  // a tenth that rounds to the same degree is nothing: the card is not painted again
  const version = frame.version;
  h.bridge.zigbee.thermostat(THERMO, { cur: 217 });
  h.run(1500);
  assert.equal(JSON.parse(h.panel.vm.call("_thermostat", THERMO)).state.cur, 217, "the panel has the tenth");
  assert.equal(frame.version, version, "and paints nothing for it");
  // the floor's probe, and a room below zero
  h.bridge.zigbee.thermostat(THERMO, { floor: 281, cur: -35 });
  h.run(2000);
  const [room3, floor3] = lines();
  assert.deepEqual([room3[11], floor3[11]], ["-3°", "28°"], "the floor's number and a room below zero, which rounds as the weather's does");
  assert.deepEqual(h.log.filter((l) => /BRY: Exception|failed on/.test(l)), [], "nothing raised on either side");
  assert.deepEqual(h.glassNotes, []);
});

test("a Moes ZHT-SR that heats, on the glass: its icon on the plan card is warm while it heats, the lit tone while it rests, and the unlit one when it is off", async () => {
  const h = await inHouse({ thermostats: [{ ieee: THERMO, profile: "tuya" }] });
  probed(h);
  untilKnown(h, 40000);
  const zid = h.panel.vm.call("_bedroom", THERMO);
  h.run(3000);
  const colors = JSON.parse(h.panel.vm.call("_style"));
  assert.ok(colors.heating !== undefined && new Set([colors.heating, colors.iconOn, colors.iconOff]).size === 3, "the style has a warm tone of its own");
  const frame = h.glass.frame;
  const CORE = "\uFAAE";
  /** the thermostat's icon on its card: the instruction, and how many pixels of its box the glass painted in the colour it was sent in */
  const icon = () => {
    const op = JSON.parse(h.panel.vm.call("_card", zid)).find((o) => o[0] === "xstr" && String(o[11]) === CORE);
    assert.ok(op, "the card has the heating coil's icon");
    let ink = 0;
    for (let y = op[2]; y < op[2] + op[4]; y++) for (let x = op[1]; x < op[1] + op[3]; x++) if (frame.pixels[y * frame.width + x] === op[6]) ink++;
    return { color: op[6], ink };
  };
  const off = icon();
  assert.equal(off.color, colors.iconOff, "off: the unlit tone");
  assert.ok(off.ink > 30, `and the glass painted it: ${off.ink} pixels`);
  // a tap on its row turns it on, and the room is below the target: it heats
  h.panel.vm.call("_act", JSON.stringify(["toggleDevice", THERMO]));
  h.run(2500);
  const heating = icon();
  assert.equal(heating.color, colors.heating, "on and heating: the warm tone");
  assert.ok(heating.ink > 30, `painted by the glass: ${heating.ink} pixels`);
  // the dial turned below the room: it rests, and it is on
  h.bridge.zigbee.thermostat(THERMO, { set: 150 });
  h.run(2000);
  assert.equal(icon().color, colors.iconOn, "on and resting: the lit tone");
  // and above it again
  h.bridge.zigbee.thermostat(THERMO, { set: 250 });
  h.run(2000);
  assert.equal(icon().color, colors.heating, "heating again: the warm tone");
  // off
  h.panel.vm.call("_act", JSON.stringify(["toggleDevice", THERMO]));
  h.run(2500);
  assert.equal(icon().color, colors.iconOff, "off: the unlit tone again");
  assert.deepEqual(h.log.filter((l) => /BRY: Exception|failed on/.test(l)), [], "nothing raised on either side");
  assert.deepEqual(h.glassNotes, []);
});

test("a Moes ZHT-SR alone in a zone, on the glass: the card's tap switches it, a hold on its icon opens its page, the + shows a target at once and writes the last touch's a moment after, a mode is written and lit, the dial is followed, and the zone's counter opens the joint page", async () => {
  const h = await inHouse({ thermostats: [{ ieee: THERMO, profile: "tuya" }] });
  probed(h);
  untilKnown(h, 40000);
  const zid = h.panel.vm.call("_bedroom", THERMO);
  h.run(3000);
  const dev = h.bridge.zigbee.devices.find((d) => d.ieee === THERMO);
  const trace = () => h.log.filter((l) => /DRIVERS|THERMOSTAT|RELAY|BRY|BRAIN/.test(l) && !/dropped/.test(l)).slice(-10).join("\n");
  const words = () => h.texts().filter(Boolean);
  // the writes the device takes, as Z2T hands them to it
  const writes = [];
  const zigbee = h.bridge.zigbee;
  const take = zigbee.writeThermostat;
  zigbee.writeThermostat = function (d, t, w, delay) {
    writes.push(w);
    return take.call(this, d, t, w, delay);
  };
  const parts = () => h.glass.components();
  const center = (c) => [c.def.x + c.def.w / 2, c.def.y + c.def.h / 2];
  // the Bedroom has the thermostat alone: a tap on its card turns it on, and another off
  const mark = JSON.parse(h.panel.vm.call("_card", zid)).find((o) => o[0] === "xstr");
  h.tap(mark[1] + mark[3] / 2, mark[2] + mark[4] / 2);
  h.run(2500);
  assert.deepEqual([dev.thermo.dps.get(1).value, writes], [1, [{ "EF00/0101": 1 }]], `the card's tap turned it on: ${trace()}`);
  writes.length = 0;
  h.tap(mark[1] + mark[3] / 2, mark[2] + mark[4] / 2);
  h.run(2500);
  assert.deepEqual([dev.thermo.dps.get(1).value, writes], [0, [{ "EF00/0101": 0 }]], "and the next off");
  writes.length = 0;
  // the Bedroom's card held: its screen
  h.tap(mark[1] + mark[3] / 2, mark[2] + mark[4] / 2, 800);
  // a zone of one device: the hold opens its page, and the card's name under its title the zone's screen
  assert.equal(h.glass.page.name, "thermostat", `the Bedroom's one thermostat's page: ${words()}`);
  const card = parts().find((k) => k.def.type === "Button" && /^bRow/.test(k.def.objname) && textOf(String(k.attrs.txt)) === "Bedroom");
  assert.ok(card, `the card's name under the title: ${words()}`);
  h.tap(...center(card));
  assert.equal(h.glass.page.name, "zone", `the Bedroom's screen: ${words()}`);
  // a hold on the icon of the thermostat's row: its page
  const row = parts().find((k) => k.def.type === "Text" && textOf(String(k.attrs.txt)) === "Thermostat 1");
  assert.ok(row, `the thermostat's row: ${words()}`);
  const iconSpot = parts().find((k) => k.def.type === "Hotspot" && /^mIcon/.test(k.def.objname) && k.def.y === row.def.y);
  h.tap(...center(iconSpot), 800);
  assert.equal(h.glass.page.name, "thermostat", `the thermostat's page: ${words()}\n${trace()}`);
  // every button of the page is a face, a Button with its words or its glyph on it
  const face = (label) => parts().find((k) => k.def.type === "Button" && textOf(String(k.attrs.txt)) === label);
  const tapFace = (label) => {
    const f = face(label);
    assert.ok(f, `the face "${label}": ${words()}`);
    h.tap(...center(f));
  };
  assert.ok(h.shows("Thermostat 1") && h.shows("21.0°C") && h.shows("Room 20.0°  Floor 27.0°") && face("Off") && face("Heat"),
    `its name, its target, the room's and the floor's temperatures, and its two modes: ${words()}`);
  assert.ok(!h.shows("Off"), `and no line says what it does: the lit mode says it: ${words()}`);
  // the modes: the one it is in lit, its face filled and its words in another colour
  const lit = [face("Off").attrs.bco, face("Off").attrs.pco];
  const unlit = [face("Heat").attrs.bco, face("Heat").attrs.pco];
  assert.ok(lit[0] !== unlit[0] && lit[1] !== unlit[1], "off, it is in Off");
  // the - and the +: faces too, with their glyphs, and the glass paints the press over the face itself
  // under the row of the page's icons, whose faces are counters too
  const [minus, plus] = parts().filter((k) => k.def.type === "Button" && /^bCount/.test(k.def.objname) && k.def.y >= 126).sort((a, b) => a.def.x - b.def.x);
  assert.ok(minus && plus && minus.def.w === 78 && plus.def.w === 78, "the - and the +, 12 mm faces");
  const frame = h.glass.frame;
  const corner = (c) => frame.pixels[(c.def.y + 4) * frame.width + c.def.x + 4];
  const still = corner(minus);
  assert.equal(still, Number(minus.attrs.bco), "the -'s face, painted by the glass");
  h.glass.press(...center(minus));
  h.run(60);
  assert.equal(corner(minus), Number(minus.attrs.bco2), "pressed, the glass paints the press");
  h.glass.release();
  h.run(400);
  assert.equal(corner(minus), still, "and its face again as the finger leaves");
  // the - took the target down a step: its write goes, and the + brings it back
  h.run(2500);
  assert.deepEqual(writes, [{ "EF00/0232": 205 }], `the - wrote a step down: ${trace()}`);
  writes.length = 0;
  h.tap(...center(plus));
  h.run(2500);
  assert.deepEqual(writes, [{ "EF00/0232": 210 }], "and the + one up");
  writes.length = 0;
  // the + once: the next target at once, and written a moment after
  h.tap(...center(plus));
  assert.ok(h.shows("21.5°C"), `the + shows the next target at once: ${words()}`);
  assert.deepEqual(writes, [], "and writes nothing yet");
  h.run(2500);
  assert.deepEqual(writes, [{ "EF00/0232": 215 }], `a moment after, the target written to its datapoint: ${trace()}`);
  assert.ok(h.shows("21.5°C"), `and the page shows what the device says now: ${words()}`);
  // three quick touches: the page follows each, and one write goes, the last one's
  const quick = (spot) => {
    h.glass.press(...center(spot));
    h.run(60);
    h.glass.release();
    h.run(150);
  };
  writes.length = 0;
  quick(plus);
  quick(plus);
  quick(plus);
  assert.ok(h.shows("23.0°C"), `three touches, and the page shows where they got to: ${words()}`);
  h.run(2500);
  assert.deepEqual(writes, [{ "EF00/0232": 230 }], `one write, the last touch's: ${trace()}`);
  assert.equal(dev.thermo.dps.get(50).value, 230);
  // the -: a step down
  writes.length = 0;
  h.tap(...center(minus));
  h.run(2500);
  assert.deepEqual(writes, [{ "EF00/0232": 225 }], "the - goes a step down");
  assert.ok(h.shows("22.5°C"), `${words()}`);
  // Heat: written, lit, and the device heats, the room being below the target, which no word on the page says
  writes.length = 0;
  tapFace("Heat");
  h.run(2500);
  assert.deepEqual(writes, [{ "EF00/0101": 1 }], `the mode written to datapoint 1: ${trace()}`);
  assert.deepEqual([dev.thermo.dps.get(47).value, h.shows("Heating")], [0, false], `it heats, and the page has no word for it: ${words()}`);
  assert.deepEqual([[face("Off").attrs.bco, face("Off").attrs.pco], [face("Heat").attrs.bco, face("Heat").attrs.pco]], [unlit, lit], "and Heat is lit");
  // the dial turned below the room: the page follows it, and Heat stays lit while the heating rests
  h.bridge.zigbee.thermostat(THERMO, { set: 180 });
  assert.ok(h.until("18.0°C", 3000), `the dial is followed: ${words()}`);
  assert.deepEqual([face("Heat").attrs.bco, face("Heat").attrs.pco], lit, "and Heat is still lit");
  // Off
  writes.length = 0;
  tapFace("Off");
  h.run(2500);
  assert.deepEqual(writes, [{ "EF00/0101": 0 }], "off written");
  assert.deepEqual([[face("Off").attrs.bco, face("Off").attrs.pco], [face("Heat").attrs.bco, face("Heat").attrs.pco]], [lit, unlit], "and Off is lit again");
  // back to the zone, and its thermostats' counter held: their joint page, of the one here
  h.tap(100, 40);
  assert.equal(h.glass.page.name, "zone", `the title goes back: ${words()}`);
  const count = parts().find((k) => /^tCount/.test(k.def.objname) && String(k.attrs.txt) !== "");
  assert.ok(count, `the zone's counter of its thermostats: ${words()}`);
  const countSpot = parts().find((k) => k.def.type === "Hotspot" && /^mCount/.test(k.def.objname) && k.def.x === count.def.x && k.def.y === count.def.y);
  h.tap(...center(countSpot), 800);
  assert.equal(h.glass.page.name, "thermostat", `the joint page: ${words()}\n${trace()}`);
  assert.ok(h.shows("Bedroom · 1 thermostat") && h.shows("18.0°C") && face("Off"), `the zone's name and how many, their target, and their modes: ${words()}`);
  assert.deepEqual([face("Off").attrs.bco, face("Off").attrs.pco], lit, "Off lit: they are off");
  writes.length = 0;
  h.tap(...center(plus));
  h.run(2500);
  assert.deepEqual(writes, [{ "EF00/0232": 185 }], `its + writes to each of them: ${trace()}`);
  assert.deepEqual(h.log.filter((l) => /BRY: Exception|failed on/.test(l)), [], "nothing raised on either side");
  assert.deepEqual(h.glassNotes, []);
});

test("the simulator in the browser reloaded with a Moes ZHT-SR in a zone: the house boots from the flash of both, the network from the panel's configuration, and the thermostat is one again, its temperatures on its zone's card", async () => {
  const h = await inHouse({ thermostats: [{ ieee: THERMO, profile: "tuya" }] });
  probed(h);
  untilKnown(h, 40000);
  const zid = h.panel.vm.call("_bedroom", THERMO);
  // saved, as a zone made on the glass is
  h.panel.vm.call("_run", JSON.stringify([["save"]]));
  h.run(3000);
  // what the browser keeps of each device (sim/src/rig.ts), and the house a reload boots from it
  const r = await house({ restored: { panel: h.panel.kept(), bridge: h.bridge.kept() } });
  probed(r);
  const dev = r.bridge.zigbee.devices.find((d) => d.ieee === THERMO);
  assert.equal(dev?.thermo?.profile, "tuya", "the network has it as the thermostat it is, and not as a lamp");
  const s = untilKnown(r, 60000);
  assert.deepEqual([s.device?.[2], s.zone, s.state?.cur, s.state?.floor], ["thermostat", zid, 200, 270], `the driver tells the panel its state again: ${JSON.stringify(s)}`);
  r.run(2000);
  const temps = JSON.parse(r.panel.vm.call("_card", zid)).filter((op) => op[0] === "xstr" && String(op[11]).includes("°")).map((op) => op[11]);
  assert.deepEqual(temps, ["20°", "27°"], "and its zone's card shows the room's and the floor's");
  assert.deepEqual(r.log.filter((l) => /BRY: Exception|failed on/.test(l)), [], "nothing raised on either side");
  assert.deepEqual(r.glassNotes, []);
});

// --- the blind: the bridge's driver, the link, the cycle, a position and a key on the wall ----------------------------

const BLIND = "0x00124B0000C10002";

const BLIND_PROBES = `
import json
import global
def _cover(id)
    var ui = global.panel_ui
    var c = ui.network.cover
    return json.dump({"device": ui.store.find_device(id), "state": c.state.find(id), "live": ui.live.find(id), "look": ui.device_look(id)})
end
`;

test("the blind, end to end: a Moes Star Ring the bridge's network has, described to the panel, its tap's cycle up, stop, down, a position sent, a key pressed on the wall, and its colour as it goes", async () => {
  const h = await inHouse({ covers: [{ ieee: BLIND, profile: "tuya", pos: 40, travelMs: 10000 }] });
  probed(h);
  assert.equal(h.panel.vm.run(BLIND_PROBES, "blind probes"), 0, h.panel.vm.error());
  const blind = h.bridge.zigbee.devices.find((d) => d.ieee === BLIND).cover;
  const seenBlind = () => JSON.parse(h.panel.vm.call("_cover", BLIND));
  const trace = () => h.log.filter((l) => /DRIVERS|COVER|BRY|RELAY|ZBBRIDGE/.test(l) && !/dropped/.test(l)).slice(-12).join("\n");
  let s0 = seenBlind();
  for (let t = 0; t < 40000 && !(s0.state && s0.state.pos !== undefined); t += 250) {
    h.run(250);
    s0 = seenBlind();
  }
  assert.deepEqual(s0.device, [BLIND, "Cover 1", "cover", 64, 0, 0, "TS0601", 1, 0, 0], `registered from its description: ${trace()}`);
  assert.equal(s0.state.pos, 40, `where it is, asked of it by the driver: ${trace()}`);
  assert.deepEqual(s0.look, ["on", "coverOn", "icon-off"], "part of the way open: the open glyph, unlit");

  // a tap: up, as nothing says which way it went last; the accent while it goes, and the top in green
  h.panel.vm.call("_act", JSON.stringify(["toggleDevice", BLIND]));
  h.run(1500);
  assert.equal(blind.dir, 1, `the driver wrote the control: ${trace()}`);
  assert.deepEqual([seenBlind().state.mov, seenBlind().look[2]], ["up", "accent-blue"], "it goes up, in the accent");
  h.run(8000);
  const s1 = seenBlind();
  assert.deepEqual([blind.pos, s1.state.pos, s1.state.mov, s1.look[2]], [100, 100, "stop", "icon-open"], `at the top it stopped, and is green: ${trace()}`);

  // the cycle: at the top a tap goes down, and the next one stops it midway
  h.panel.vm.call("_act", JSON.stringify(["toggleDevice", BLIND]));
  h.run(3500);
  assert.equal(seenBlind().state.mov, "down", "down from the top");
  h.panel.vm.call("_act", JSON.stringify(["toggleDevice", BLIND]));
  h.run(2500);
  const s2 = seenBlind();
  assert.ok(blind.dir === 0 && blind.pos > 0 && blind.pos < 100, `stopped midway, at ${blind.pos}`);
  assert.deepEqual([s2.state.mov, s2.state.pos], ["stop", Math.round(blind.pos)], "the panel knows where it stopped, the position read back");
  h.panel.vm.call("_act", JSON.stringify(["toggleDevice", BLIND]));
  h.run(1500);
  assert.equal(blind.dir, 1, "standing after going down: up, the cycle's next (up, stop, down, stop, up)");
  h.panel.vm.call("_act", JSON.stringify(["toggleDevice", BLIND]));
  h.run(1500);

  // a position, as the page's slider sends it
  h.panel.vm.call("_run", JSON.stringify([["cover", [BLIND], "goto", 25]]));
  h.run(12000);
  const s3 = seenBlind();
  assert.deepEqual([blind.pos, s3.state.pos, s3.state.mov], [25, 25, "stop"], `there, and it stopped: ${trace()}`);

  // a key on the wall: the panel hears it go, and its next tap stops it
  h.bridge.zigbee.coverKey(BLIND, "up");
  h.run(1500);
  assert.equal(seenBlind().state.mov, "up", `the key pressed on the wall is heard: ${trace()}`);
  h.panel.vm.call("_act", JSON.stringify(["toggleDevice", BLIND]));
  h.run(2500);
  assert.equal(blind.dir, 0, "and the tap stops it");
  assert.deepEqual(h.log.filter((l) => /BRY: Exception|failed on/.test(l)), [], "nothing raised on either side");
  assert.deepEqual(h.glassNotes, []);
});

// --- a lamp's settings: the panel reads and writes them itself, through the bridge ---------------------------

const LAMP_PROBES = `
import json
import global
def _lamp(id)
    var ui = global.panel_ui
    var m = ui.network.lamp
    return json.dump({"top": ui.top() != nil ? ui.top()["view"] : nil, "values": m.values.find(id), "record": ui.store.find_device(id)[8]})
end
def _lampSettings(id)
    var ui = global.panel_ui
    ui.prefs["editing"] = true
    ui.network.run(ui.open(["detail", "d", id]))
    ui.network.run(ui.page_icon(1))
    return "ok"
end
def _lampChoose(arg)
    var ui = global.panel_ui
    var a = json.load(arg)
    ui.network.run(ui.act(["thermostat", "pick", a[0], a[1]]))
    ui.network.run(ui.act(["thermostat", "choose", a[0], a[1], a[2]]))
    return "ok"
end
`;

test("a lamp's settings, end to end: its page's Settings reads the lamp through the bridge, a choice is written and taken, and the record keeps the power-on state", async () => {
  const h = await inHouse();
  probed(h);
  assert.equal(h.panel.vm.run(LAMP_PROBES, "lamp probes"), 0, h.panel.vm.error());
  const lamp = h.bridge.zigbee.devices.find((d) => d.joined && !d.thermo && !d.cover && d.inClusters.includes(0x0008));
  assert.ok(lamp, "a lamp with levels on the bridge's network");
  const seen = () => JSON.parse(h.panel.vm.call("_lamp", lamp.ieee));
  // the panel knows the lamp's short address once the bridge's map is read, a few seconds after the link
  h.run(8000);
  lamp.startUpOnOff = 0;
  lamp.onOffTransitionTime = 10;
  h.panel.vm.call("_lampSettings", lamp.ieee);
  h.run(3000);
  assert.deepEqual([seen().top, seen().values], [["thermostatSettings", lamp.ieee], { power: 0, fade: 2 }], "its screen, with what the lamp said: Off, and 1 s");
  h.panel.vm.call("_lampChoose", JSON.stringify([lamp.ieee, "power", 2]));
  h.run(3000);
  assert.deepEqual([lamp.startUpOnOff, seen().values.power, seen().record], [255, 2, 4], "Previous, written, taken, and kept in the record");
  h.panel.vm.call("_lampChoose", JSON.stringify([lamp.ieee, "fade", 0]));
  h.run(3000);
  assert.deepEqual([lamp.onOffTransitionTime, seen().values.fade], [0, 0], "and Instant");
  assert.deepEqual(h.log.filter((l) => /BRY: Exception|failed on/.test(l)), [], "nothing raised on either side");
});

test("the driver chosen on the glass: the search draws the switch's two channels, and its row opens the driver's screen", async () => {
  const h = await inHouse();
  probed(h);
  assert.equal(h.panel.vm.run(CHANNEL_PROBES, "channels"), 0, h.panel.vm.error());
  toPlan(h);
  h.tap(40, 160, 800);
  h.tap(425, 39);
  h.tapRow("Zigbee device");
  // a house with a bridge: a new device or one the bridge has, and the one bridge the new one is paired on
  h.tapRow("Pair new device");
  h.run(1000);
  h.bridge.zigbee.joinSwitch({ ieee: SWITCH, channels: 2 });
  for (let t = 0; t < 15000 && !dev(h, SWITCH + "/2").device; t += 250) h.run(250);
  h.run(1500);
  // the second channel takes the search past one page: drawn again there
  const shown = () => JSON.stringify(h.texts().filter(Boolean));
  assert.ok(h.shows("Switch 1") && h.shows("Switch 2"), `both channels, by their names: ${shown()}`);
  h.tapRow("Switch 1");
  assert.ok(h.shows("Type") && h.shows("Driver"), `the switch's screen, its Type and its Driver: ${shown()}`);
  h.tapRow("Driver");
  h.tapRow("Window");
  assert.ok(h.shows("Join channels?"), `its second channel is in the Hall: asked first: ${shown()}`);
  h.tapDialog("Join");
  h.run(3000);
  assert.ok(h.shows("Window") && h.shows("Mode") && h.shows("Sensor"), `the driver's screen, joined: ${shown()}`);
  assert.deepEqual([dev(h, SWITCH).device.slice(2, 6), dev(h, SWITCH + "/2").device], [["cover", 64, 0, 1], null], "one device, a blind that is a window");
  assert.deepEqual(JSON.parse(h.bridge.vm.call("_kept"))[SWITCH], "twokey", "the bridge's driver has it");
  // the application changed afterwards: the gate reaches the bridge, which says it back
  h.tapRow("Driver");
  assert.ok(h.shows("Window"), `the applications, the window chosen: ${shown()}`);
  h.panel.vm.call("_act", JSON.stringify(["driver", "app", SWITCH, "gate"]));
  h.run(3000);
  assert.equal(JSON.parse(h.bridge.vm.call("_assigned"))[SWITCH].app, "gate", "the bridge keeps the gate");
  assert.deepEqual([dev(h, SWITCH).device[5], JSON.parse(h.panel.vm.call("_owed"))], [2, {}], "a gate on the panel, nothing owed once the bridge said it back");
  assert.deepEqual(h.log.filter((l) => /BRY: Exception|failed on/.test(l)), [], "nothing raised on either side");
});

// --- the radio as the hardware has it -----------------------------------------------------
//
// What the tests above leave out on purpose (IDEAL_RADIO): the air takes its time, the receive queue of the direct is four
// frames deep, the loop that drains it comes round every 50 ms and each frame it takes keeps it busy, and Z2T emits its
// ZbInfo all at once. These are CHARACTERIZATION tests: each says what the panel and the bridge do on that radio today,
// a defect of real use that the foundation lets the suite see. Each is marked `known issue, flip when fixed`, and the fix
// turns the expectation, not the test.
// The numbers of the air and of the loop are estimates, and the bench is where they are measured: a test here is no
// proof of the hardware, only the simulator not hiding it.

/** the panel's map of the bridge's network, as it is now: how many devices it has, and how many the bridge said there are */
/** the panel's map: how many of its own Zigbee devices it has the short address of, of how many (it asks each of its bridge) */
function mapOf(h) {
  assert.equal(h.panel.vm.run(`import global
import json
global.map_probe = def (a)
    var n = global.panel_ui.network
    var all = {}
    for id: n.zigbee_ids() all[PanelStore.ieee_part(id)] = true end
    return json.dump([size(all) - size(n.lacking()), size(all)])
end`, "map"), 0, h.panel.vm.error());
  const [mapped, count] = JSON.parse(h.panel.vm.call("map_probe", ""));
  return { mapped, count };
}

/**
 * runs until the panel's map has every device the panel has, for at most `ms` (the link's criterion is 15 s): the map
 * then, and the time it took
 */
function mapWhole(h, ms = 30000) {
  let t = 0;
  let m = mapOf(h);
  for (; t < ms && !(m.count > 0 && m.mapped >= m.count); t += 250) {
    h.run(250);
    m = mapOf(h);
  }
  return { ...m, ms: t };
}

test("the Living room's 30 lamps, each asked of its bridge over the mesh, on the radio this simulator had: whether Z2T answers at once, a millisecond apart, or ten, the map is whole within 15 s of the session", async () => {
  const got = {};
  for (const gap of [0, 1, 2, 10]) {
    const h = await inHouse({ infoGapMs: gap });
    got[gap] = mapWhole(h);
  }
  assert.equal(got[0].count, 30, "the panel has the Living room's 30 lamps");
  // the review's numbers for the seed of the whole network, over the link of the pair: 0 ms: 4 of 30; 1 ms: 25; 2 ms or more: 30
  assert.deepEqual(Object.values(got).map((m) => m.mapped), [30, 30, 30, 30], `mapped of 30, with ZbInfo 0, 1, 2 and 10 ms apart: ${JSON.stringify(got)}`);
  assert.ok(Object.values(got).every((m) => m.ms <= 15000), `each within 15 s of the link: ${JSON.stringify(got)}`);
});

test("the Living room's 30 lamps on the hardware's radio: the panel asks each of its bridge over the mesh until the map is whole, within 15 s of the session, and it stays so", async () => {
  const h = await inHouse({ radio: "real" });
  const seeded = mapWhole(h);
  assert.equal(seeded.count, 30, "the panel has 30 devices");
  assert.equal(seeded.mapped, 30, `the map after the seed and its rounds, of 30: ${seeded.mapped}, in ${seeded.ms} ms`);
  assert.ok(seeded.ms <= 15000, `within 15 s of the session: ${seeded.ms} ms`);
  h.run(60000);
  assert.equal(mapOf(h).mapped, 30, "a minute later it is whole still");
  assert.deepEqual(h.log.filter((l) => /BRY: Exception|failed on/.test(l)), [], "nothing raised on either side");
});

// The link of the pair handed the radio lines in the same instant, which no one paced, to a queue of four on the bridge's side:
// the panel paces its own (panel_plan_commands.be: the first three lines of a run at once, then one every 80 ms), and
// they go over the mesh. What a plan or a zone being deleted sends reaches the bridge whole.

/**
 * A plan of `n` lines the panel itself makes (the tap on a card whose `n` lamps no group reaches), and how many of its lines, a lamp's Power,
 * reached Z2T on the bridge over the mesh (and not the reads of a state the house asks for meanwhile): it starts `phase` ms after a multiple of
 * the bridge's loop of 50 ms.
 */
function planBurst(h, n, phase) {
  assert.equal(h.panel.vm.run(`import global
import json
global.plan_probe = def (a) global.plan.execute({"zids": [], "unicast": json.load(a), "relays": [], "skipped": []}, "on") return "ok" end`, "plan"), 0, h.panel.vm.error());
  const lamps = h.bridge.zigbee.devices.slice(0, n).map((d) => d.ieee);
  assert.equal(lamps.length, n, "lamps enough on the bridge's network");
  const loop = h.bridge.loop.loopMs;
  h.run(2000 + ((phase - (h.home.now % loop)) + loop) % loop);
  const told = [];
  const run = h.bridge.zigbee.command.bind(h.bridge.zigbee);
  h.bridge.zigbee.command = (name, data) => {
    if (name === "ZbSend" && /"Power":1/.test(data) && lamps.some((ieee) => data.toUpperCase().includes(ieee.slice(2).toUpperCase()))) told.push(data);
    return run(name, data);
  };
  try {
    h.panel.vm.call("plan_probe", JSON.stringify(lamps));
    h.run(3000);
  } finally {
    h.bridge.zigbee.command = run;
  }
  return { took: told.length };
}

test("a plan of 3, 5, 8, 12 or 24 lines of the panel to the bridge over the mesh, on the hardware's radio, delivers every one, wherever it falls in the bridge's loop", async () => {
  const h = await inHouse({ radio: "real" });
  h.run(15000);
  const got = {};
  for (const n of [3, 5, 8, 12, 24]) got[n] = Array.from({ length: 10 }, (_, k) => planBurst(h, n, 5 * k));
  for (const n of [3, 5, 8, 12, 24]) assert.deepEqual(got[n].map((t) => t.took), Array(10).fill(n), `${n} lines: all of them, at every phase`);
  assert.deepEqual(h.log.filter((l) => /BRY: Exception|failed on/.test(l)), [], "nothing raised on either side");
});

test("on the radio this simulator had, a plan of 5 lines of the panel delivers 5 and so do 24 of them", async () => {
  const h = await inHouse();
  h.run(10000);
  const got = Object.fromEntries([3, 5, 24].map((n) => [n, planBurst(h, n, 0).took]));
  assert.deepEqual(got, { 3: 3, 5: 5, 24: 24 }, "the lines of a plan: all of them");
});

test("Delete zone on the Middle, twelve lamps, over the mesh on the hardware's radio: the panel's twenty-four lines (ZbLeave and ZbForget each) reach the bridge, which has the eighteen lamps that stay left, and the panel has them too", async () => {
  const h = await inHouse({ radio: "real" });
  h.run(15000);
  const middle = h.bridge.zigbee.devices.filter((d) => d.groups.includes(3)).map((d) => d.ieee);
  assert.equal(middle.length, 12, "the Middle's twelve lamps, on the bridge's network");
  assert.equal(h.bridge.zigbee.devices.length, 30);
  assert.equal(h.panel.vm.run(`import global
import json
global.delete_probe = def (a) var ui = global.panel_ui ui.network.run(ui.act(["do", "deleteZone", "middle"])) return "ok" end
global.have_probe = def (a) return json.dump([global.panel_ui.store.find_zone("middle") != nil, size(global.panel_ui.store.doc["devices"])]) end`, "delete"), 0, h.panel.vm.error());
  const before = JSON.parse(h.panel.vm.call("have_probe", ""));
  assert.equal(before[0], true);
  // what Z2T was told, as the bridge ran it
  const told = [];
  const run = h.bridge.zigbee.command.bind(h.bridge.zigbee);
  h.bridge.zigbee.command = (name, data) => {
    told.push(`${name} ${data}`);
    return run(name, data);
  };
  h.panel.vm.call("delete_probe", "");
  h.run(5000);
  const leaves = told.filter((c) => c.startsWith("ZbLeave ")).map((c) => c.slice(8));
  const forgets = told.filter((c) => c.startsWith("ZbForget ")).map((c) => c.slice(9));
  assert.deepEqual([leaves.length, forgets.length], [12, 12], `the twelve ZbLeave and the twelve ZbForget reached Z2T: ${told.length} commands in all`);
  assert.deepEqual([...leaves].sort(), [...middle].sort(), "each of the Middle's lamps, once");
  // ZbLeave took them off the network and ZbForget, which finds a device that left, out of Z2T's list: the list is the eighteen that stay
  const listed = h.bridge.zigbee.devices.map((d) => d.ieee);
  assert.deepEqual(middle.filter((ieee) => listed.includes(ieee)), [], "the twelve lamps are out of Z2T's list");
  assert.equal(listed.length, 18, "and the other eighteen are in it");
  assert.ok(h.bridge.zigbee.devices.every((d) => d.joined), "all of them on the network");
  const after = JSON.parse(h.panel.vm.call("have_probe", ""));
  assert.deepEqual([after[0], after[1]], [false, before[1] - 12], "the zone and its twelve devices are out of the panel's configuration");
  // a minute on, the next seed does not bring any of them back as "Light N"
  h.run(60000);
  assert.deepEqual(JSON.parse(h.panel.vm.call("have_probe", ""))[1], before[1] - 12, "none came back");
  assert.deepEqual(h.log.filter((l) => /BRY: Exception|failed on/.test(l)), [], "nothing raised on either side");
});

/** the drawing instructions (xstr) the panel sends the glass while `fn` runs: what its card redraws cost on the serial line */
function glassDraws(h, fn) {
  let draws = 0;
  let bytes = 0;
  const receive = h.glass.receive.bind(h.glass);
  h.glass.receive = (b) => {
    bytes += b.length;
    draws += (Buffer.from(b).toString("latin1").match(/xstr /g) ?? []).length;
    return receive(b);
  };
  try {
    fn();
  } finally {
    h.glass.receive = receive;
  }
  return { draws, bytes };
}

test("a tap on the Middle, twelve lamps answering one after the other: the card is drawn a few times and not once per report, and ends with every lamp on and nothing pending", async () => {
  const h = await inHouse();
  toPlan(h);
  // the lamps' state, which the panel seeds over the mesh as the session comes up, drawn on the cards until it is all in
  for (let i = 0; i < 20 && glassDraws(h, () => h.run(1000)).draws > 0; i++);
  assert.equal(glassDraws(h, () => h.run(3000)).draws, 0, "the plan quiet before the tap");
  const lamps = h.bridge.zigbee.devices.filter((d) => d.groups.includes(3));
  assert.equal(lamps.length, 12);
  const cost = glassDraws(h, () => {
    h.tap(240, 180);
    h.run(3000);
  });
  assert.ok(lamps.every((d) => d.power === 1), "the lamps are on");
  assert.equal(h.glass.page.name, "home");
  // the card's twelve icons are an xstr each: the tap paints the pending tone, and the reports, which come over the mesh as the lamps answer,
  // 100 to 200 ms apart, are drawn together when they come within 150 ms of each other (panel_zigbee.be, refresh_later); when its time is up with
  // everyone answered nothing is left to paint. Twelve reports were twelve whole cards before. Over the link of the pair, which paced its frames
  // 80 ms apart two at a time, it was five of them
  assert.ok(cost.draws < 12 * 12, `the card's icons, drawn ${cost.draws} times in all: fewer times than the lamps reported`);
  assert.deepEqual(h.panel.vm.run(`import global
import json
global.pend_probe = def (a) return json.dump([global.plan.pending_refs(), size(global.plan.unconfirmed), size(global.plan.doubt)]) end`, "pend"), 0);
  assert.deepEqual(JSON.parse(h.panel.vm.call("pend_probe", "")), [[], 0, 0], "nothing pending, nothing unconfirmed, no \"?\"");
  assert.deepEqual(h.glassNotes, []);
});

// --- the transport's defects, fixed ----------------------------------------------------------------------------

test("the Living room's 30 lamps on the hardware's radio: each asked of the bridge over the mesh, 120 ms apart, and its answers paced, two frames at once and one every 80 ms: the map is whole by the seed alone, before the panel looks at it", async () => {
  const h = await inHouse({ radio: "real" });
  // the panel asks 2 s after the session, one device every 120 ms, about 3.6 s, and looks at its map 5 s after the last
  h.run(9000);
  assert.deepEqual(mapOf(h), { mapped: 30, count: 30 }, "the whole map, with no round asked for yet");
  assert.deepEqual(h.log.filter((l) => /BRY: Exception|failed on/.test(l)), [], "nothing raised on either side");
});

/** the panel's Berry, with its transport's send, and the bridge's alarm as it keeps it */
function wireProbes(h) {
  assert.equal(h.panel.vm.run(`import global
global.zb_send = def (line) return global.zb_bridge.send(line) ? "sent" : "refused" end`, "wire"), 0, h.panel.vm.error());
  assert.equal(h.bridge.vm.run(`import global
import json
global.zb_panic = def (a) return json.dump(global.zbbridge_relay.alarm.cfg["panic"]["devices"]) end
global.zb_sensors = def (a) return json.dump(global.zbbridge_relay.alarm.cfg["sensors"]) end`, "wire"), 0, h.bridge.vm.error());
}

test("in direct each device's action on the panic is a word of its own, and the alarm keeps seven of them, where the whole list in one frame was over the 233 bytes the link carries and was dropped", async () => {
  const h = await inHouse({ sensors: [{ ieee: DOOR, kind: "contact" }] });
  probed(h);
  wireProbes(h);
  const acts = ["on", "off", "open", "close", "on", "off", "open"];
  const ids = acts.map((_, i) => "0x00124B0000AA" + (0x10 + i).toString(16).toUpperCase().padStart(4, "0"));
  const whole = 'ZbRelayAlarm {"do":"panic_cfg","devices":' + JSON.stringify(ids.map((id, i) => [id, acts[i]])) + "}";
  assert.ok(whole.length > 233, `the whole list is ${whole.length} bytes, over a frame`);
  assert.equal(h.panel.vm.call("zb_send", whole), "refused", "and the transport says so: it never went");
  const words = ids.map((id, i) => 'ZbRelayAlarm {"do":"panic_act","id":"' + id + '","act":"' + acts[i] + '"}');
  for (const w of words) assert.ok(w.length < 233, `a word a device fits a frame: ${w.length}`);
  for (const w of words) {
    assert.equal(h.panel.vm.call("zb_send", w), "sent");
    h.run(100);
  }
  h.run(500);
  const kept = JSON.parse(h.bridge.vm.call("zb_panic", ""));
  assert.deepEqual(kept.map((p) => p[1]), acts, "the seven acts, in order, kept by the alarm");
  assert.deepEqual(kept.map((p) => p[0]), ids, "for the seven devices");
  assert.equal(h.panel.vm.call("zb_send", 'ZbRelayAlarm {"do":"panic_act","id":"' + ids[2] + '","act":"none"}'), "sent");
  h.run(300);
  assert.equal(JSON.parse(h.bridge.vm.call("zb_panic", "")).length, 6, "and a device's none takes its pair out");
  assert.deepEqual(h.log.filter((l) => /BRY: Exception|failed on/.test(l)), [], "nothing raised on either side");
});

test("in direct the bridge says the alarm's settings whole, in frames that fit: fourteen devices the panic runs, nine sirens and eight devices out of the burst reach the panel, none cut at six", async () => {
  const h = await inHouse({ radio: "real", sensors: [{ ieee: DOOR, kind: "contact" }] });
  probed(h);
  wireProbes(h);
  assert.equal(h.bridge.vm.call("_alarm_start", ""), "ok");
  // the panel asks for the state, the log and the settings in the seconds after its link: they are past when the lists are made
  h.run(5000);
  const addr = (base, i) => "0x00124B0000" + base + (0x10 + i).toString(16).toUpperCase().padStart(4, "0");
  const acts = ["on", "off", "open", "close"];
  const pd = [];
  const send = (m) => {
    assert.equal(h.panel.vm.call("zb_send", "ZbRelayAlarm " + JSON.stringify(m)), "sent", JSON.stringify(m));
    h.run(100);
  };
  for (let i = 0; i < 14; i++) {
    send({ do: "panic_act", id: addr("CC", i), act: acts[i % 4] });
    pd.push([addr("CC", i), acts[i % 4]]);
  }
  const np = [];
  const sirens = [];
  for (let i = 0; i < 8; i++) {
    send({ do: "burst", id: addr("DD", i), on: false });
    np.push(addr("DD", i));
    send({ do: "siren", id: addr("EE", i), on: true });
    sirens.push(addr("EE", i));
  }
  sirens.push(addr("EE", 8));
  send({ do: "siren", id: addr("EE", 8), on: true });
  assert.deepEqual(JSON.parse(h.bridge.vm.call("zb_panic", "")), pd, "the bridge keeps the fourteen");
  // the panel's copy is what it was before it asked: empty
  const before = JSON.parse(h.panel.vm.call("_alarm_cfg", ""));
  assert.deepEqual([before.pd, before.np, before.s], [[], [], []], "and the panel has none of them yet");
  const first = JSON.parse(h.bridge.vm.call("_alarm_view", "")).said.length;
  send({ do: "config" });
  h.run(3000);
  const cfg = JSON.parse(h.panel.vm.call("_alarm_cfg", ""));
  assert.deepEqual(cfg.pd, pd, "the panel has the fourteen, in order");
  assert.deepEqual(cfg.np, np, "the eight out of the burst");
  assert.deepEqual(cfg.s, sirens, "the nine sirens");
  const said = JSON.parse(h.bridge.vm.call("_alarm_view", "")).said.slice(first);
  assert.equal(said.length, 8, `eight messages: the times with six sirens, three more sirens, two of the burst's list, three of the panic's and the list of what is lost (empty, said so that the panel empties its own): ${said.length}`);
  for (const m of said) assert.ok(JSON.stringify(m).length <= 233, "each message fits a frame of the link: " + JSON.stringify(m));
  assert.equal(h.panel.radio.state().dropped, 0, "and the queue of the panel's driver dropped none of them");
  assert.deepEqual(h.log.filter((l) => /BRY: Exception|failed on/.test(l)), [], "nothing raised on either side");
});

test("another node's Wireless settings on the glass: the bridge's network forgotten, asked first here; its search, from where it is; the password typed here; and the bridge back on the Wi-Fi", async () => {
  const h = await inHouse();
  const bridge = h.bridge;
  // a change on another node needs Editing on
  assert.equal(h.panel.vm.run(`import global
global.panel_ui.prefs["editing"] = true`, "edit"), 0, h.panel.vm.error());
  toMesh(h);
  h.tapRow("zbbridge-living");
  h.tapRow("Wireless settings");
  assert.ok(h.until("Channel", 8000) && h.shows("Cottage"), `the bridge's Wireless settings, as it draws them: its Wi-Fi and its channel: ${h.texts().filter(Boolean)}`);
  h.tapRow("Wi-Fi");
  assert.ok(h.until("Connected", 8000), `its Wi-Fi: ${h.texts().filter(Boolean)}`);
  drag(h, [200, 290], [200, 110]);
  drag(h, [200, 290], [200, 110]);
  h.tapRow("Forget network");
  assert.ok(h.until("Forget the network?", 5000), `asked first, on this panel: ${h.texts().filter(Boolean)}`);
  h.tapDialog("Forget");
  for (let t = 0; t < 8000 && bridge.wifi.up; t += 250) h.run(250);
  assert.equal(bridge.wifi.up, false, "the bridge forgot its network");
  assert.ok(h.until("None", 8000), `and its Wi-Fi says so: ${h.texts().filter(Boolean)}`);
  h.tapRow("Connect");
  assert.ok(h.until("Search networks", 5000), `its ways in: ${h.texts().filter(Boolean)}`);
  h.tapRow("Search networks");
  assert.ok(h.until("Cottage", 12000), `the networks the bridge found, from where it is, over the mesh: ${h.texts().filter(Boolean)}\n${h.log.filter((l) => /HOUSE|WIFI|STA/.test(l)).slice(-12).join("\n")}`);
  h.tapRow("Cottage");
  h.type("cottagepass");
  for (let t = 0; t < 30000 && !bridge.wifi.up; t += 250) h.run(250);
  assert.equal(bridge.wifi.up, true, `the bridge joined Cottage with the password typed on the panel: ${h.log.filter((l) => /bridge .*(STA|WIFI|HOUSE)/.test(l)).slice(-12).join("\n")}`);
  assert.ok(h.until("Connected", 10000), `and the join's screen says so: ${h.texts().filter(Boolean)}`);
  assert.deepEqual(h.glassNotes, []);
});
