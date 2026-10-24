// The panel end to end, with no hardware and no browser: the Berry of this
// repo on Tasmota's VM (the ESP32 side), and the compiled pages of the Living room on
// the emulated Nextion (the glass side), joined by the UART as on the wall.
//
// A touch here is a touch on the glass: it runs the component's compiled code,
// whose frames the Berry answers with instructions. Nothing of either side is
// imitated, so what these tests hold is what the panel would do.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SimHouse, SimPanel, SimBridge, networkOf, BRAIN_FILES, IDEAL_TIMING, IDEAL_LOOP } from "../dist/index.js";
import { repoFiles, bridgeFiles, livingRoomConfig, houseFlash, REPO } from "../dist/files-node.js";
import { Glass, readScenario, fontOf, pictureOf, textOf } from "@nspanel-sim/glass";
import { globalsOf, pageNameOf, readGlass, resolverOf } from "../../sim/src/mirror.ts";
import { classesOf, staticsScript } from "./statics.mjs";

const SCENARIOS = join(REPO, "libs/nspanel-sim/export/hmi-scenarios");

/**
 * What the React screen on show reads off the glass, through the browser's own
 * mirror (sim/src/mirror.ts): a `$path` -> its value. The read-back tables are
 * empty, because a switch and a text need none.
 */
function reactRead(glass, device = "eu-landscape") {
  const manifest = JSON.parse(readFileSync(join(SCENARIOS, `p1-living-room-${device}.runtime.json`), "utf8"));
  const project = JSON.parse(readFileSync(join(REPO, "libs/nspanel-sim/projects/living-room/project.json"), "utf8"));
  const mirror = readGlass(glass, manifest, { roles: new Map(), tokens: new Map() }, globalsOf(glass.hmi));
  const screen = project.layouts[device].screens.find((s) => pageNameOf(s.id) === mirror.page);
  assert.ok(screen, `a React screen for the page ${mirror.page}`);
  return resolverOf(mirror, screen);
}

// The firmware keeps the statics of the brain's classes in its flash, where a
// write does not raise but hangs or crashes the panel, and no try catches it.
// Here the classes are files, and a write would work: so after
// each test, every static reads as it did when the panel came up (statics.mjs).
const STATICS = staticsScript(classesOf(BRAIN_FILES));
const rigs = [];
afterEach(() => {
  for (const { panel, frozen } of rigs.splice(0)) assert.equal(panel.vm.call("_statics"), frozen, "a static of the brain was written");
});

/**
 * A Living room on its wall: the panel, the glass, both relays closed, on the network
 * "Cottage" -- or on the Wi-Fi `extra.wifi` says --, and the bridge of its
 * house, with the lamps on its network: the panel's Zigbee is the house's bridge's,
 * and its image has no Z2T. The two boot from the flash of a
 * house made once (houseFlash), with its mesh, in a house whose radio takes no time,
 * and the rig waits for the panel's map of its devices. `extra.alone` is a panel with
 * no bridge, Zigbee off, for what is the Wi-Fi's or the clock's alone.
 */
async function rig(device = "eu-landscape", extra = {}) {
  const project = `p1-living-room-${device}`;
  const hmi = readScenario(JSON.parse(readFileSync(join(SCENARIOS, `${project}.json`), "utf8")));
  const log = [];
  const glassNotes = [];
  let panel;
  const early = [];
  const glass = new Glass(hmi, {
    width: device === "eu-landscape" ? 480 : 320,
    height: device === "eu-landscape" ? 320 : 480,
    fonts: hmi.fonts.map((f) => fontOf(readFileSync(join(SCENARIOS, f)))),
    pictures: hmi.pictures.map(pictureOf),
    send: (b) => (panel ? panel.uartReceive(b) : early.push(b)),
    onDiagnostic: (m) => glassNotes.push(m),
  });
  const flash = extra.alone ? { panel: { persist: {} } } : await houseFlash();
  // the Living room as the house's flash has it: its groups in the numbers its place in the house gives them, as on the bridge's network
  const doc = extra.alone ? livingRoomConfig() : JSON.parse(JSON.stringify(flash.panel.persist.panel_config));
  const home = new SimHouse({ air: IDEAL_TIMING, loop: IDEAL_LOOP });
  if (!extra.alone) await home.enableMesh();
  // 2026-09-25 20:44:58, UTC as the panel's local time, and the bridge's, which the link gives the panel
  const epoch = Date.UTC(2026, 8, 25, 20, 44, 58) / 1000;
  const bridge = extra.alone ? undefined : await SimBridge.create({ ...flash.bridge, house: home, files: bridgeFiles(), epoch, timezone: 0, zigbee: { infoGapMs: 10 } });
  panel = await SimPanel.create({
    ...flash.panel,
    house: home,
    files: repoFiles(project),
    project,
    persist: { ...flash.panel.persist, panel_config: extra.config ?? doc },
    relays: [true, true],
    wifi: extra.wifi ?? flash.panel.wifi,
    epoch,
    timezone: 0,
    onLog: (level, line) => log.push(`[L${level}] ${line}`),
    onUart: (b) => glass.receive(b),
  });
  if (bridge) for (const { spec, groups } of networkOf(doc)) bridge.zigbee.add(spec, groups);
  for (const b of early) panel.uartReceive(b);
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
  const text = (objname) => textOf(String(glass.components().find((c) => c.def.objname === objname)?.attrs.txt ?? ""));
  // a text on the glass, whole or as part of a line the runtime broke
  const texts = () => glass.components().filter((c) => c.def.type === "Text").map((c) => textOf(String(c.attrs.txt)));
  const shows = (label) => texts().includes(label);
  const showsPart = (part) => texts().some((t) => t.includes(part));
  // a restart as the browser's rig makes it (libs/nspanel-sim/sim/src/rig.ts):
  // the panel boots again from what it kept, and the glass with it
  const reboot = async () => {
    panel = await panel.reboot({ files: repoFiles(project), project, onLog: (level, line) => log.push(`[L${level}] ${line}`), onUart: (b) => glass.receive(b) });
    glass.start();
    return panel;
  };
  run(2000);
  // the bridge in step, and the map of the panel's devices whole: what the panel's Zigbee says of its lamps comes from it
  if (bridge) {
    assert.equal(panel.vm.run(`import global
def _mapped() var z = global.panel_ui != nil ? global.panel_ui.network : nil return z != nil && size(z.lacking()) == 0 ? "1" : "0" end`, "mapped"), 0, panel.vm.error());
    for (let t = 0; t < 20000 && panel.vm.call("_mapped") !== "1"; t += 100) run(100);
    assert.equal(panel.vm.call("_mapped"), "1", "the panel's map of its devices, whole");
  }
  assert.equal(panel.vm.run(STATICS, "statics"), 0, panel.vm.error());
  rigs.push({ panel, frozen: panel.vm.call("_statics") });
  // a zone's group number, as the house gives this panel its range of them (PanelStore.zid_space)
  const zidOf = (zone) => doc.zones.find((z) => z.id === zone).zid;
  return { panel, bridge, home, glass, run, tap, text, shows, showsPart, log, glassNotes, reboot, zidOf };
}

test("the panel boots on Tasmota's VM, and the glass shows the time it writes", async () => {
  const { glass, text, log } = await rig();
  assert.equal(glass.page.name, "screensaver");
  assert.equal(text("tTime0"), "20:45", "drawn when the display came up, and again as the minute turned");
  assert.equal(text("tDate0"), "25/09/2026");
  assert.ok(log.some((l) => l.includes("PANEL: running generated project p1-living-room-eu-landscape")));
  assert.ok(!log.some((l) => /failed to load|Exception/.test(l)), log.filter((l) => /failed|Exception/.test(l)).join("\n"));
});

test("the screensaver's tap opens the plan, and a card's hold its zone", async () => {
  const { glass, tap, text } = await rig();
  tap(240, 160);
  assert.equal(glass.page.name, "home");
  assert.equal(text("tTitle0"), "Home");
  tap(40, 160, 800);
  assert.equal(glass.page.name, "zone");
  assert.equal(text("tTitle1"), "Hall");
  assert.deepEqual([text("tLabel6"), text("tLabel7")], ["Hall 1", "Hall 2"]);
  assert.equal(text("tCount3"), "4");
});

test("the US boots with the Living room as the EU has it: the room keeps its shape, not turned a quarter", async () => {
  // the Hall, two cells wide and five tall at the plan's left edge;
  // turned, the Hall would lie across the top, and this point be another zone's
  const { glass, tap, text } = await rig("us-portrait");
  tap(160, 240);
  assert.equal(glass.page.name, "home");
  tap(60, 250, 800);
  assert.equal(glass.page.name, "zone");
  assert.equal(text("tTitle1"), "Hall");
});

test("a relay device's icon switches the relay, and the zone's screen follows it (refresh_relay)", async () => {
  const { panel, glass, tap } = await rig();
  tap(240, 160);
  tap(40, 160, 800);
  const colour = () => glass.components().find((c) => c.def.objname === "tLabel6").attrs.pco;
  const lit = colour();
  // the device icon, at the row's end against the rail, under the first counter
  tap(363, 204);
  assert.deepEqual(panel.relays, [false, true], "relay 1 opened");
  assert.notEqual(colour(), lit, "the row's name went out with it");
});

test("the minute turns on the plan, and nothing is written where the glass refuses it", async () => {
  const { glass, tap, run, glassNotes } = await rig();
  tap(240, 160);
  assert.equal(glass.page.name, "home");
  run(61000);
  assert.deepEqual(glassNotes, [], "no write to another page's own components");
});

test("a card's tap sends its zone's group, the lamps report, and the plan says so", async () => {
  const { panel, glass, tap, run, bridge, zidOf } = await rig();
  tap(240, 160);
  const middle = bridge.zigbee.devices.filter((d) => d.groups.includes(zidOf("middle")));
  assert.ok(middle.length > 0 && middle.every((d) => d.power === 0));
  tap(240, 180);
  run(500);
  assert.ok(middle.every((d) => d.power === 1), "every lamp of the Middle is on");
  assert.equal(glass.page.name, "home");
});

/** a finger dragged from one point to another over `ms`, as the glass samples it */
function drag(glass, run, from, to, ms = 300) {
  glass.press(...from);
  const steps = ms / 25;
  for (let i = 1; i <= steps; i++) {
    glass.move(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
    run(25);
  }
  glass.release();
  run(400);
}

// --- Wireless settings ------------------------------------------------------------------

// the rows of a list page, EU: 86 to 164, 164 to 242, 242 to 320
const ROW = [125, 203, 281];
// the QR's page's one row, EU: beside the code, at the bottom (screenTemplates.ts, qrScreen)
const QR_STOP = [330, 281];

test("the swipe up on the plan opens Wireless settings: the Wi-Fi on its network, and no Zigbee, which is the house's bridges", async () => {
  const { glass, tap, run, shows, glassNotes } = await rig();
  tap(240, 160);
  drag(glass, run, [240, 300], [240, 120]);
  run(500);
  // the Wi-Fi, the radio's channel under it and the MQTT, then the Backup, and not Settings, as the down one opens
  assert.ok(shows("Wireless settings"));
  assert.ok(shows("Wi-Fi") && shows("Connected"), "the Wi-Fi, on the network the panel has");
  assert.ok(shows("Channel") && shows("MQTT"), "its channel and the MQTT");
  assert.ok(!shows("Zigbee") && !shows("zbbridge-living"), "and no Zigbee: the house's bridges are on the house's page");
  assert.deepEqual(glassNotes, []);
});

test("on the US portrait, Wireless settings open on its one list, the value under the name, as wide as the row", async () => {
  const { glass, tap, run, text, glassNotes } = await rig("us-portrait");
  tap(160, 240);
  assert.equal(glass.page.name, "home");
  drag(glass, run, [160, 440], [160, 200]);
  run(500);
  assert.equal(glass.page.name, "settings", "the list's page, the only one on this panel");
  // the rail first, then the header: the rows are placements 2 to 6
  assert.equal(text("tLabel2"), "Wi-Fi");
  assert.equal(text("tHint2"), "Connected", "the value, on the line under the name");
  assert.equal(text("tLabel3"), "Channel", "and the radio's channel under it: no Zigbee");
  assert.equal(text("tLabel4"), "MQTT", "then the MQTT");
  const label = glass.components().find((c) => c.def.objname === "tLabel2").def;
  const hint = glass.components().find((c) => c.def.objname === "tHint2").def;
  assert.equal(hint.x, label.x, "under the name");
  assert.equal(hint.w, label.w, "and as wide");
  assert.ok(hint.y >= label.y + label.h, "on its own line");
  // and the Wi-Fi's own view, as every list
  tap(160, 125);
  assert.equal(glass.page.name, "settings");
  assert.equal(text("tTitle1"), "Wi-Fi");
  assert.deepEqual(glassNotes, []);
});

test("with no network saved the panel boots with its radio off, so Tasmota never opens its AP", async () => {
  const { panel, log } = await rig("eu-landscape", { wifi: { ssid1: "" }, alone: true });
  assert.equal(panel.wifi.on, false, "Wifi 0, before Tasmota's first Wi-Fi check");
  assert.ok(log.some((l) => l.includes("WIFI: no network saved, the radio stays off")));
  const other = await rig();
  assert.equal(other.panel.wifi.on, true, "and a panel with its network keeps it");
});

test("with no network and no station driver, Connect has the web setup, which opens Tasmota's Wi-Fi Manager, says where the phone goes, and stops with a restart", async () => {
  const { panel, glass, tap, run, shows, showsPart, glassNotes } = await rig("eu-landscape", { wifi: { ssid1: "", station: false }, alone: true });
  tap(240, 160);
  drag(glass, run, [240, 300], [240, 120]);
  run(500);
  assert.ok(shows("Wi-Fi") && shows("Off"));
  tap(200, ROW[0]);
  assert.ok(shows("Connect"), "nothing saved: Connect");
  tap(200, ROW[0]);
  assert.ok(shows("Web setup"), "the web setup");
  assert.ok(!shows("Search networks"), "and no search in a build without the station driver");
  tap(200, ROW[0]);
  assert.equal(panel.wifi.manager, true, "WifiConfig 2");
  assert.equal(panel.wifi.on, true, "with the radio on, which the Wi-Fi check needs");
  assert.equal(glass.page.name, "qr", "on the QR's page");
  const code = String(glass.components().find((c) => c.def.type === "Qrcode").attrs.txt);
  assert.match(code, /^WIFI:T:nopass;S:nspanel-sim[^;]*;;$/, "a code that joins the Wi-Fi Manager's open network");
  assert.ok(showsPart("nspanel-sim") && showsPart("192.168.4.1"), "and the lines say where the phone goes");
  tap(...QR_STOP);
  assert.deepEqual(panel.restarts, [], "the first moments of the page take no tap");
  run(800);
  tap(...QR_STOP);
  assert.deepEqual(panel.restarts, ["Restart 1"], "Stop web setup restarts the panel, Tasmota's only way out of it");
  assert.deepEqual(glassNotes, []);
});

/** a key of the glass's keyboard, by its name: a..z, SPACE, OK, X */
function key(glass, tap, name) {
  const c = glass.components().find((k) => k.def.objname === `mk${name}0`).def;
  tap(c.x + c.w / 2, c.y + c.h / 2);
}

/** from the plan to the networks the station driver found, with nothing saved */
function toNetworks(glass, tap, run) {
  tap(240, 160);
  drag(glass, run, [240, 300], [240, 120]);
  run(500);
  tap(200, ROW[0]);
  tap(200, ROW[0]);
}

test("with the station driver, Search networks lists what is in range, a password typed on the glass joins, and the Wi-Fi says so", async () => {
  const { panel, glass, tap, run, shows, glassNotes } = await rig("eu-landscape", { wifi: { ssid1: "" }, alone: true });
  toNetworks(glass, tap, run);
  assert.ok(shows("Search networks") && shows("Web setup"), "the driver's search, and the web setup");
  tap(200, ROW[0]);
  assert.ok(shows("Searching"), "the search runs");
  run(3000);
  assert.ok(shows("Cottage") && shows("-52 dBm"), "the house's network once, at its strongest access point, its signal in dBm");
  assert.ok(shows("Office") && shows("Not supported"), "an Enterprise network, said so");
  assert.ok(shows("Cafe") && shows("-74 dBm, open"), "and an open one");
  tap(200, ROW[0]);
  assert.equal(glass.page.name, "editboard", "Cottage's password is asked on the keyboard");
  for (const k of "cottagepass") key(glass, tap, k);
  key(glass, tap, "OK");
  run(200);
  assert.ok(shows("Connecting"));
  assert.equal(panel.wifi.ssid[0], "", "nothing saved before it works");
  run(3500);
  assert.equal(panel.wifi.ssid[0], "Cottage", "saved once it worked");
  assert.equal(panel.wifi.on, true, "and Tasmota's Wi-Fi is on it");
  assert.ok(shows("Cottage") && shows("Connected"), "the way in closed, down to the Wi-Fi, which says so");
  assert.deepEqual(panel.restarts, [], "with no restart");
  assert.deepEqual(glassNotes, []);
});

test("a wrong password says so, Try again brings back what was typed, and nothing is saved", async () => {
  const { panel, glass, tap, run, shows, glassNotes } = await rig("eu-landscape", { wifi: { ssid1: "" }, alone: true });
  toNetworks(glass, tap, run);
  tap(200, ROW[0]);
  run(3000);
  tap(200, ROW[0]);
  for (const k of "wrongpass") key(glass, tap, k);
  key(glass, tap, "OK");
  run(3500);
  assert.ok(shows("Wrong password") && shows("Try again"), "why it failed");
  assert.equal(panel.wifi.ssid[0], "", "and nothing saved");
  tap(200, ROW[1]);
  assert.equal(glass.page.name, "editboard");
  assert.equal(textOf(String(glass.read("screensaver.kbIn.txt"))), "wrongpass", "what was typed, from memory");
  key(glass, tap, "X");
  run(300);
  tap(200, ROW[2]);
  assert.ok(shows("Networks") && shows("Cottage"), "Back is the networks found");
  assert.deepEqual(glassNotes, []);
});

test("while the web setup is up, the Home shows the hotspot in its header, and not before", async () => {
  const { glass, tap, run, glassNotes } = await rig("eu-landscape", { wifi: { ssid1: "", station: false }, alone: true });
  const sign = () => glass.components().find((c) => c.def.objname === "tStatus0");
  tap(240, 160);
  assert.equal(glass.page.name, "home");
  assert.ok(sign(), "the Home's header has the sign's column");
  assert.ok(!sign().vis || textOf(String(sign().attrs.txt)) === "", "and nothing in it while no phone can reach the panel");
  drag(glass, run, [240, 300], [240, 120]);
  run(500);
  tap(200, ROW[0]);
  tap(200, ROW[0]);
  tap(200, ROW[0]);
  assert.equal(glass.page.name, "qr", "the web setup, up");
  // back to the plan, title by title
  for (let i = 0; i < 4 && glass.page.name !== "home"; i++) { tap(100, 40); run(300); }
  assert.equal(glass.page.name, "home");
  assert.equal(sign().vis, true, "the sign shows");
  assert.notEqual(textOf(String(sign().attrs.txt)), "", "the hotspot's glyph");
  assert.deepEqual(glassNotes, []);
});

test("with no station driver, Stop web setup restarts the panel, Tasmota's Wi-Fi Manager's only way out, and it boots again on its network, with its relays and lamps", async () => {
  // with the driver, the web setup is the hotspot, which stops with no restart
  const { panel, glass, tap, run, reboot, bridge } = await rig("eu-landscape", { wifi: { station: false } });
  tap(240, 160);
  drag(glass, run, [240, 300], [240, 120]);
  run(500);
  tap(200, ROW[0]);
  drag(glass, run, [200, 290], [200, 110]);
  run(500);
  tap(200, ROW[0]);
  tap(200, ROW[0]);
  assert.equal(panel.wifi.manager, true, "Connect to another, Web setup: the Wi-Fi Manager is up");
  run(800);
  tap(...QR_STOP);
  assert.deepEqual(panel.restarts, ["Restart 1"]);
  run(1600);
  assert.equal(panel.restartDue, true, "Tasmota restarts a moment after the command");
  const lamps = bridge.zigbee.devices.map((d) => d.power);
  const next = await reboot();
  run(3000);
  assert.notEqual(next, panel, "a new boot");
  assert.equal(next.wifi.manager, false, "the Wi-Fi Manager ended with the restart");
  assert.equal(next.wifi.on, true, "and the panel is back on its network");
  assert.deepEqual(next.relays, [true, true], "the relays held through it");
  assert.deepEqual(bridge.zigbee.devices.map((d) => d.power), lamps, "and the lamps are as they were");
  assert.equal(glass.page.name, "screensaver", "the glass booted with the panel");
});

test("a zone's + asks Zigbee device or Relay device with the network closed, and Zigbee device opens it for a minute", async () => {
  const { panel, glass, tap, shows, glassNotes, bridge } = await rig();
  tap(240, 160);
  tap(40, 160, 800);
  assert.equal(glass.page.name, "zone", "the Hall");
  tap(425, 39);
  assert.ok(shows("Zigbee device") && shows("Relay device"), "the + asks what to add");
  assert.equal(bridge.zigbee.permitUntil, 0, "and asks the network for nothing yet");
  tap(200, ROW[0]);
  // a house with a bridge: a new device or one the bridge has, and the one bridge it is paired on
  assert.ok(shows("Pair new device") && shows("Existing device"), "the house asks: a new device, or one its bridge has");
  tap(200, ROW[0]);
  assert.ok(shows("Searching") && shows("Relay 1"), "Pair new device starts the search, as its screen opens");
  assert.ok(bridge.zigbee.permitUntil > 0, "ZbPermitJoin");
  assert.deepEqual(glassNotes, []);
});

test("connected: Disconnect asks first, turns the radio off and the Wi-Fi says so; Reconnect turns it back on", async () => {
  const { panel, glass, tap, run, shows, glassNotes } = await rig();
  tap(240, 160);
  drag(glass, run, [240, 300], [240, 120]);
  run(500);
  tap(200, ROW[0]);
  assert.equal(glass.page.name, "settings", "eight rows, the Hotspot's among them: the list with the rail");
  assert.ok(shows("Cottage") && shows("Connected") && shows("-52 dBm"));
  drag(glass, run, [200, 290], [200, 110]);
  run(500);
  assert.ok(shows("Hotspot") && shows("Disconnect"), "the second page");
  tap(200, ROW[2]);
  assert.equal(glass.page.name, "confirm", "asked first");
  run(800);
  tap(200, ROW[1]);
  assert.equal(panel.wifi.on, false, "Wifi 0");
  assert.ok(shows("Off") && shows("Reconnect"), "the Wi-Fi drawn after it, from its first page");
  tap(200, ROW[1]);
  assert.equal(panel.wifi.on, true, "Wifi 1");
  run(1500);
  assert.ok(shows("Connected"), "Tasmota's Wi-Fi check is back on its network within the second, and Wifi#Connected draws the Wi-Fi again");
  assert.deepEqual(glassNotes, []);
});

test("on a paged list, the swipe up turns to the next page and the swipe down back, as the rail would", async () => {
  const { glass, tap, run, glassNotes } = await rig();
  const shows = (label) => glass.components().some((c) => c.def.type === "Text" && textOf(String(c.attrs.txt)) === label);
  tap(240, 160);
  drag(glass, run, [240, 120], [240, 300]);
  assert.equal(glass.page.name, "settings");
  assert.ok(shows("Live update"), "the first page");
  drag(glass, run, [200, 290], [200, 110]);
  run(500);
  assert.ok(shows("Button 1"), "up: the second page");
  assert.ok(!shows("Live update"), "and not the first");
  drag(glass, run, [200, 110], [200, 290]);
  run(500);
  assert.ok(shows("Live update"), "down: the first page again");
  drag(glass, run, [200, 110], [200, 290]);
  run(500);
  assert.ok(shows("Live update"), "and down on the first page goes nowhere");
  assert.equal(glass.page.name, "settings");
  assert.deepEqual(glassNotes, []);
});

test("on a list, a swipe that starts and ends on one row, or on the title, turns the page and presses nothing", async () => {
  const { glass, tap, run, glassNotes } = await rig();
  const shows = (label) => glass.components().some((c) => c.def.type === "Text" && textOf(String(c.attrs.txt)) === label);
  tap(240, 160);
  drag(glass, run, [240, 120], [240, 300]);
  assert.ok(shows("Live update"), "the first page");
  // up inside the first row alone, 86 to 163: the next page, and Live update not switched
  drag(glass, run, [200, 158], [200, 92]);
  run(500);
  assert.ok(shows("Button 1"), "the second page");
  assert.equal(Number(glass.read("screensaver.vaLive.val")), 0, "and the row under the finger was not pressed");
  // down from the title into the list: the page before
  drag(glass, run, [200, 30], [200, 200]);
  run(500);
  assert.ok(shows("Live update"), "back on the first page");
  assert.equal(glass.page.name, "settings", "and the title's tap did not close it");
  assert.deepEqual(glassNotes, []);
});

test("Main settings' Info says what runs: the firmware and the screen, dev in the simulator, the screen's said as its first page loads", async () => {
  const { glass, tap, run, glassNotes } = await rig();
  const shows = (label) => glass.components().some((c) => c.def.type === "Text" && textOf(String(c.attrs.txt)) === label);
  tap(240, 160);
  drag(glass, run, [240, 120], [240, 300]);
  for (let i = 0; i < 3; i++) {
    drag(glass, run, [200, 290], [200, 110]);
    run(500);
  }
  assert.ok(shows("Info"), "the fourth page of Main settings, after Date & time and Location");
  tap(200, 281);
  assert.ok(shows("Firmware"), "the firmware's row");
  assert.ok(shows("dev"), "the simulator's build says dev");
  drag(glass, run, [200, 290], [200, 110]);
  run(500);
  assert.ok(shows("Screen"), "the screen's row");
  assert.ok(shows("dev"), "and the screen said dev as its first page loaded");
  assert.deepEqual(glassNotes, []);
});

test("Main settings' Info says when the configuration saved is one this Berry cannot run: a newer version's is kept, the panel runs with none, and the first row says so", async () => {
  // what a rollback of the firmware leaves: a configuration of a version this Berry does not know
  const newer = { ...livingRoomConfig(), v: 99 };
  const { glass, panel, tap, run, glassNotes } = await rig("eu-landscape", { config: newer });
  const texts = () => glass.components().filter((c) => c.def.type === "Text").map((c) => textOf(String(c.attrs.txt)));
  assert.deepEqual(JSON.parse(panel.vm.readFile("/_persist.json")).panel_config, newer, "the file is as it was, and nothing is saved over it");
  tap(240, 160);
  drag(glass, run, [240, 120], [240, 300]);
  for (let i = 0; i < 3; i++) {
    drag(glass, run, [200, 290], [200, 110]);
    run(500);
  }
  tap(200, 281);
  assert.ok(texts().includes("Saved settings") && texts().includes("Kept, not run"), `the first row of the Info: ${texts()}`);
  assert.deepEqual(JSON.parse(panel.vm.readFile("/_persist.json")).panel_config, newer, "and it is still as it was");
  assert.deepEqual(glassNotes, []);
});

test("Main settings' Info: a panel that drew no web password says Generate, and its tap draws one there", async () => {
  const { glass, tap, run, glassNotes } = await rig();
  const texts = () => glass.components().filter((c) => c.def.type === "Text").map((c) => textOf(String(c.attrs.txt)));
  tap(240, 160);
  drag(glass, run, [240, 120], [240, 300]);
  for (let i = 0; i < 3; i++) {
    drag(glass, run, [200, 290], [200, 110]);
    run(500);
  }
  // the third row of the fourth page, after Date & time and Location
  tap(200, 281);
  assert.ok(texts().includes("Firmware"), "the Info");
  // three rows a page: the web password's is on the third, after the screen's
  for (let i = 0; i < 2; i++) {
    drag(glass, run, [200, 290], [200, 110]);
    run(500);
  }
  assert.ok(texts().includes("Web password") && texts().includes("Generate"), "the row says Generate");
  const generate = glass.components().find((c) => c.def.type === "Text" && textOf(String(c.attrs.txt)) === "Generate").def;
  tap(generate.x + generate.w / 2, generate.y + generate.h / 2);
  run(500);
  assert.ok(texts().includes("Web password"), "the Info stays");
  assert.ok(!texts().includes("Generate"), "and the row says it no more");
  assert.ok(texts().some((t) => /^[a-z2-9]{10}$/.test(t)), "but the password drawn, ten of the pairing's letters");
  assert.deepEqual(glassNotes, []);
});

test("Main settings' Date & time sets the panel's own clock: the time typed goes to Tasmota, the screen says it is the user's, and Internet time off is kept", async () => {
  const { panel, glass, tap, run, text, shows, glassNotes } = await rig();
  const key = (name) => {
    const c = glass.components().find((k) => k.def.objname === `mk${name}0`).def;
    tap(c.x + c.w / 2, c.y + c.h / 2);
  };
  const nextPage = () => {
    drag(glass, run, [200, 290], [200, 110]);
    run(500);
  };
  tap(240, 160);
  drag(glass, run, [240, 120], [240, 300]);
  for (let i = 0; i < 3; i++) nextPage();
  assert.ok(shows("Date & time") && shows("Location"), "the clock's rows, after the Screensaver's");
  assert.ok(glass.components().some((c) => c.def.type === "Text" && /^Fri 20:4[45]$/.test(textOf(String(c.attrs.txt)))), "the row says the time, with its weekday");
  tap(200, 125);
  assert.equal(text("tTitle1"), "Date & time");
  assert.ok(shows("Time") && shows("Date") && shows("UTC"), "the time, the date and the time zone the image has");
  assert.ok(shows("25/09/2026"), "the date");
  tap(200, 125);
  assert.equal(glass.page.name, "editboard", "the time opens the keyboard");
  // empty: the time written would fill its five places, and the glass would take no key
  assert.equal(textOf(String(glass.read("screensaver.kbIn.txt"))), "", "the keyboard opens empty");
  for (const k of ["1", "4", "1", "5"]) key(k);
  assert.equal(textOf(String(glass.read("screensaver.kbIn.txt"))), "1415");
  key("OK");
  run(500);
  assert.equal(glass.page.name, "settings", "back on the clock's screen");
  assert.ok(shows("Fri 14:15"), "which says the time typed, with the weekday");
  const kept = panel.kept();
  assert.equal(new Date(kept.epoch * 1000).toISOString().slice(0, 16), "2026-09-25T14:15", "Tasmota's clock was set, on the same day");
  nextPage();
  assert.ok(shows("Time from") && shows("You"), "the clock says it was set by the user");
  assert.ok(shows("Internet time") && shows("On"));
  tap(200, 125);
  assert.ok(shows("Off"), "Internet time off");
  const saved = JSON.parse(panel.vm.readFile("/_persist.json"));
  assert.equal(saved.panel_prefs.clock.ntp, false, "and kept in the preferences, which the backup takes");
  assert.deepEqual(glassNotes, []);
});

test("a restart keeps the time set by hand, and Date & time says it was kept", async () => {
  const { glass, tap, run, shows, reboot } = await rig("eu-landscape", { alone: true });
  const nextPage = () => {
    drag(glass, run, [200, 290], [200, 110]);
    run(500);
  };
  const toClock = () => {
    tap(240, 160);
    drag(glass, run, [240, 120], [240, 300]);
    for (let i = 0; i < 3; i++) nextPage();
    tap(200, 125);
  };
  toClock();
  nextPage();
  assert.ok(shows("Internet"), "a first boot's time is the internet's");
  await reboot();
  run(2500);
  toClock();
  assert.ok(shows("25/09/2026"), "the day went on");
  nextPage();
  assert.ok(shows("Restart"), "and the clock says the restart kept it");
});

test("the swipe down on the plan opens Main settings, and the list is the panel's", async () => {
  const { glass, tap, run, text, glassNotes } = await rig();
  tap(240, 160);
  drag(glass, run, [240, 120], [240, 300]);
  assert.equal(glass.page.name, "settings");
  assert.equal(text("tTitle1"), "Main settings");
  assert.ok(glass.components().some((c) => c.def.type === "Text" && /Live update/.test(textOf(String(c.attrs.txt)))), "its first row");
  assert.deepEqual(glassNotes, []);
});

test("a list page starts as the brain's skipped writes assume, in the six projects: no text in a slot, and a label in the colour of a row that is off", () => {
  // PanelUi.render_list leaves out, on a page that has just loaded, the icon, the label and the hint it would write blank, and the
  // label's colour when the row is off (and the colour of an icon with no glyph, always): the page has to start that way
  let checked = 0;
  for (const project of ["living-room", "living-room-shadcn", "living-room-tailwind"]) {
    for (const device of ["eu-landscape", "us-portrait"]) {
      const name = `p1-${project}-${device}`;
      const scenario = JSON.parse(readFileSync(join(SCENARIOS, `${name}.json`), "utf8"));
      const lines = readFileSync(join(SCENARIOS, `${name}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
      Object.keys(lines[0].pages).forEach((pageName, i) => {
        const page = scenario.addPages.find((p) => p.name === pageName);
        for (const [path, targets] of Object.entries(lines[1 + i].writes)) {
          const m = /^\$list\.rows\.(\d+)\.(icon|label|hint|on)$/.exec(path);
          if (!m) continue;
          for (const t of Array.isArray(targets[0]) ? targets : [targets]) {
            const attrs = page.add.find((c) => c.objname === t[0]).attributes ?? {};
            checked++;
            if (m[2] === "on") assert.equal(attrs.pco, t[4], `${name} ${pageName} ${path}: the label starts in the colour of a row that is off`);
            else assert.equal(attrs.txt ?? "", "", `${name} ${pageName} ${path}: the slot starts with no text`);
          }
        }
      });
    }
  }
  // 192: each layout has one list page, and no short twin nor tall one beside it
  assert.ok(checked > 150, `the check looked at ${checked} targets`);
});

test("with a pattern, the swipe down on the plan goes to the lock and never shows Settings' list first; without one it opens Main settings", async () => {
  for (const pattern of [true, false]) {
    const { panel, glass, tap, run, text, glassNotes, home } = await rig();
    if (pattern) {
      const set = "def _pat() var u = global.panel_ui var h = u.hash_fn u.prefs['pattern'] = ['salt', h('salt', '12369')] return size(u.prefs['pattern']) end";
      assert.equal(panel.vm.run(set, "pat"), 0, panel.vm.error());
      assert.equal(String(panel.vm.call("_pat")), "2");
    }
    tap(240, 160);
    assert.equal(glass.page.name, "home");
    const seen = [];
    let last = glass.page.name;
    glass.press(240, 120);
    for (let i = 1; i <= 12; i++) {
      glass.move(240, 120 + (180 * i) / 12);
      for (let t = 0; t < 25; t += 5) { home.advance(5); glass.advance(5); if (glass.page.name !== last) { last = glass.page.name; seen.push(last); } }
    }
    glass.release();
    for (let t = 0; t < 800; t += 5) { home.advance(5); glass.advance(5); if (glass.page.name !== last) { last = glass.page.name; seen.push(last); } }
    if (pattern) {
      assert.deepEqual(seen, ["lock"], "the pattern is the first page the finger sees");
      assert.equal(text("tTitle0"), "Draw pattern");
    } else {
      assert.deepEqual(seen, ["settings"]);
      assert.equal(text("tTitle1"), "Main settings");
    }
    assert.deepEqual(glassNotes, []);
  }
});

test("the brain reads the display every 50 ms: Main settings' content is on the glass within 50 ms of the swipe's release, whatever the phase", async () => {
  // at every 100 ms, a release at the wrong phase would wait 95 ms for the first write
  for (const phase of [0, 20, 40]) {
    const { glass, tap, run, text } = await rig();
    tap(240, 160);
    run(phase);
    glass.press(240, 120);
    for (let i = 1; i <= 12; i++) {
      glass.move(240, 120 + (180 * i) / 12);
      run(25);
    }
    glass.release();
    let waited = 0;
    while (text("tTitle1") !== "Main settings" && waited < 300) {
      run(5);
      waited += 5;
    }
    assert.equal(text("tTitle1"), "Main settings", "the content came");
    assert.ok(waited <= 50, `phase ${phase}: ${waited} ms from the release to the first write, more than a poll`);
  }
});

test("the React screens read a list row's colour off the glass: unlit as drawn, and a row that destroys in its colour", async () => {
  const { glass, tap, run } = await rig();
  tap(240, 160);
  drag(glass, run, [240, 120], [240, 300]);
  assert.equal(glass.page.name, "settings");
  let read = reactRead(glass);
  assert.equal(read("$list.rows.0.label"), "Live update");
  // A row's `on` is its colour, though it starts with "on": taken for a handler,
  // every label of a React list would draw lit.
  assert.equal(read("$list.rows.0.on"), false, "the label unlit, as the glass draws it");
  assert.equal(typeof read("$list.rows.0.tap"), "function", "while a handler stays one");
  for (let i = 0; i < 4; i++) {
    drag(glass, run, [200, 290], [200, 110]);
    run(500);
  }
  read = reactRead(glass);
  const slot = [0, 1, 2, 3].find((k) => read(`$list.rows.${k}.label`) === "Factory reset");
  assert.notEqual(slot, undefined, "Factory reset, on the last page");
  assert.equal(read(`$list.rows.${slot}.on`), 2, "in the destructive colour");
});

test("the zone's title held opens the keyboard, the keys type, and OK renames the zone", async () => {
  const { panel, glass, tap, run, text, glassNotes } = await rig();
  tap(240, 160);
  tap(40, 160, 800);
  assert.equal(text("tTitle1"), "Hall");
  tap(100, 40, 800);
  assert.equal(glass.page.name, "editboard", "the keyboard");
  assert.equal(textOf(String(glass.read("screensaver.kbIn.txt"))), "Hall", "it opens on the name");
  const key = (name) => {
    const c = glass.components().find((k) => k.def.objname === `mk${name}0`).def;
    tap(c.x + c.w / 2, c.y + c.h / 2);
  };
  key("SPACE");
  key("a");
  key("b");
  assert.equal(textOf(String(glass.read("screensaver.kbIn.txt"))), "Hall ab");
  key("OK");
  run(500);
  assert.equal(glass.page.name, "zone", "back on the zone");
  assert.equal(text("tTitle1"), "Hall ab");
  const saved = JSON.parse(panel.vm.readFile("/_persist.json"));
  assert.equal(saved.panel_config.zones.find((z) => z.id === "hall").name, "Hall ab", "and it is in the flash");
  assert.deepEqual(glassNotes, []);
});

test("the symbols' keyboard types signs into a name, a backslash too, and the name comes back to the glass whole", async () => {
  const { panel, glass, tap, run, text, glassNotes } = await rig();
  tap(240, 160);
  tap(40, 160, 800);
  tap(100, 40, 800);
  assert.equal(glass.page.name, "editboard");
  const key = (name) => {
    const c = glass.components().find((k) => k.def.objname === `mk${name}0`).def;
    tap(c.x + c.w / 2, c.y + c.h / 2);
  };
  key("Sym");
  assert.equal(glass.page.name, "editsymbols", "#+= goes to the symbols, on the glass alone");
  key("At");
  key("Bslash");
  key("Tilde");
  assert.equal(textOf(String(glass.read("screensaver.kbIn.txt"))), "Hall@\\~");
  key("OK");
  run(500);
  assert.equal(glass.page.name, "zone", "OK on the symbols commits as on the letters");
  assert.equal(text("tTitle1"), "Hall@\\~", "the backslash went doubled and arrived single (PanelRuntime.quote)");
  const saved = JSON.parse(panel.vm.readFile("/_persist.json"));
  assert.equal(saved.panel_config.zones.find((z) => z.id === "hall").name, "Hall@\\~", "and it is kept as typed");
  assert.deepEqual(glassNotes, []);
});

test("a device is found by either of its addresses, in any case", async () => {
  const { panel, bridge } = await rig();
  const lamp = bridge.zigbee.devices.find((d) => d.ieee === "0x00124B0000E00001");
  const short = "0x" + lamp.short.toString(16).toUpperCase().padStart(4, "0");
  assert.equal(bridge.zigbee.find(short), lamp, "the short address as Tasmota writes it");
  assert.equal(bridge.zigbee.find(short.toLowerCase()), lamp);
  assert.equal(bridge.zigbee.find(lamp.ieee.toLowerCase()), lamp, "and the long one");
  assert.notEqual(JSON.parse(bridge.zigbee.command("ZbPing", short)).ZbPing, "Unknown device", "and a command by it");
});

test("a lamp's detail: its icon held opens it, and the brightness slider dims that lamp", async () => {
  const { panel, glass, tap, run, glassNotes, bridge } = await rig();
  tap(240, 160);
  // the card of a zone of Zigbee lamps of one group, held: their joint page, whose card is the zone's screen
  tap(240, 180, 800);
  assert.equal(glass.page.name, "lightdetail");
  const card = glass.components().find((c) => c.def.type === "Button" && /^bRow/.test(c.def.objname));
  tap(card.def.x + card.def.w / 2, card.def.y + card.def.h / 2);
  assert.equal(glass.page.name, "zone");
  tap(363, 204, 800);
  assert.equal(glass.page.name, "lightdetail");
  // the brightness slider, under the row of the page's icons
  drag(glass, run, [30, 158], [220, 158]);
  run(500);
  const lamp = bridge.zigbee.devices.find((d) => d.ieee === "0x00124B0000E00001");
  assert.equal(lamp.power, 1, "the Dimmer lights it");
  assert.ok(lamp.dimmer > 50 && lamp.dimmer < 150, `about half: ${lamp.dimmer}`);
  tap(100, 40);
  assert.equal(glass.page.name, "zone", "the title goes back");
  assert.deepEqual(glassNotes, []);
});

test("the physical button 1 toggles its relay through the panel's own button driver", async () => {
  const { panel, run } = await rig();
  panel.pressButton(1, true);
  run(100);
  panel.pressButton(1, false);
  run(100);
  assert.equal(panel.relays[0], false);
});

test("untouched for a minute, the screensaver comes up; five minutes on it, the screen goes off; a touch lights it and goes Home", async () => {
  const { glass, tap, panel, home } = await rig();
  // a second at a time: nothing on these pages keeps a finer clock while untouched
  const idle = (ms) => {
    for (let t = 0; t < ms; t += 1000) {
      home.advance(1000);
      glass.advance(1000);
    }
  };
  tap(240, 160);
  assert.equal(glass.page.name, "home");
  idle(55000);
  assert.equal(glass.page.name, "home", "a minute is not up yet");
  idle(6000);
  assert.equal(glass.page.name, "screensaver", "a minute untouched, Main settings' first time as it starts");
  assert.equal(glass.brightness, 100, "lit");
  idle(295000);
  assert.equal(glass.brightness, 100, "not five minutes on it yet");
  idle(6000);
  assert.equal(glass.brightness, 0, "five minutes on it, the screen off");
  tap(240, 160);
  assert.equal(glass.brightness, 100, "a touch lights it");
  assert.equal(glass.page.name, "home", "and goes Home, as the screensaver's tap does");
});

test("with the station driver, the Hotspot opens on the QR's page with a password drawn, a phone with it joins, the page says so, the Home shows the sign, and Stop closes it with no restart", async () => {
  const { panel, glass, tap, run, shows, showsPart, glassNotes } = await rig("eu-landscape");
  const tapText = (label) => {
    const c = glass.components().find((k) => k.def.type === "Text" && textOf(String(k.attrs.txt)) === label);
    assert.ok(c, `"${label}" on the glass`);
    tap(c.def.x + c.def.w / 2, c.def.y + c.def.h / 2);
  };
  for (let t = 0; t < 5000 && !panel.wifi.up; t += 100) run(100);
  assert.ok(panel.wifi.up, "the panel on Cottage");
  tap(240, 160);
  drag(glass, run, [240, 300], [240, 120]);
  run(500);
  tapText("Wi-Fi");
  drag(glass, run, [200, 290], [200, 110]);
  tapText("Hotspot");
  assert.equal(glass.page.name, "qr", "on the QR's page");
  const code = String(glass.components().find((c) => c.def.type === "Qrcode").attrs.txt);
  const m = /^WIFI:T:WPA;S:([^;]+);P:([a-z2-9]{10});;$/.exec(code);
  assert.ok(m, `a code a phone's camera joins it with: ${code}`);
  const [, ssid, password] = m;
  assert.ok(shows(ssid) && shows("Password " + password) && shows("http://192.168.4.1") && shows("Waiting for a device"),
    "its name, its password, the address, and nobody on it yet");
  assert.deepEqual([panel.radio.state().softap, panel.radio.state().associated], [1, 1], "the access point up, beside the station on Cottage");
  assert.ok(!panel.radio.phoneJoins(ssid, "not the one"), "a wrong password is not taken");
  assert.ok(panel.radio.phoneJoins(ssid, password), "the one on the glass is");
  run(500);
  assert.ok(shows("1 device on it"), "the page says a phone is on it");
  // the Home's sign while it is up
  for (let i = 0; i < 4 && glass.page.name !== "home"; i++) { tap(100, 40); run(300); }
  const sign = glass.components().find((c) => c.def.objname === "tStatus0");
  assert.equal(glass.page.name, "home");
  assert.ok(sign.vis && textOf(String(sign.attrs.txt)) !== "", "the Home shows the hotspot's sign");
  drag(glass, run, [240, 300], [240, 120]);
  run(500);
  tapText("Wi-Fi");
  drag(glass, run, [200, 290], [200, 110]);
  assert.ok(showsPart("Hotspot"), "the Wi-Fi's row says it is on");
  tapText("Hotspot");
  assert.equal(glass.page.name, "qr", "tapped again: its page, the same hotspot");
  run(800);
  tap(...QR_STOP);
  run(300);
  assert.equal(panel.radio.state().softap, 0, "Stop closes it");
  assert.deepEqual(panel.restarts, [], "with no restart");
  assert.equal(panel.radio.state().associated, 1, "and the station stays on Cottage");
  assert.deepEqual(glassNotes, []);
});

test("a new configuration's first boot draws the panel's web password, and the boot after leaves it as it is", async () => {
  const project = "p1-living-room-eu-landscape";
  const log = [];
  const onLog = (level, line) => log.push(`[L${level}] ${line}`);
  // a panel from a factory image: Tasmota's configuration new, its boot count 0
  let panel = await SimPanel.create({
    files: repoFiles(project), project, persist: {}, bootcount: 0, relays: [true, true],
    epoch: Date.UTC(2026, 9, 2, 12, 0, 0) / 1000, timezone: 0, onLog,
  });
  for (let t = 0; t < 12000; t += 5) panel.advance(5);
  const pw = JSON.parse(panel.vm.readFile("/_persist.json")).panel_webpw;
  assert.equal(typeof pw === "string" && pw.length, 10, `a password of its own: ${log.join("\n")}`);
  assert.ok(log.some((l) => l.includes("a web password drawn for the panel")), "and the log says so");
  // 12 s in, Tasmota counted the boot: the one after is not the first
  log.length = 0;
  panel = await panel.reboot({ files: repoFiles(project), project, onLog });
  for (let t = 0; t < 3000; t += 5) panel.advance(5);
  assert.equal(JSON.parse(panel.vm.readFile("/_persist.json")).panel_webpw, pw, "the same password");
  assert.ok(!log.some((l) => l.includes("web password")), `and nothing set again: ${log.filter((l) => l.includes("BRAIN")).join("\n")}`);
});

test("the dashed card's check makes the zone and opens its screen", async () => {
  const { glass, tap, text } = await rig();
  tap(240, 160);
  assert.equal(glass.page.name, "home");
  const action = glass.components().find((c) => c.def.objname === "mAction0");
  assert.ok(action, "the header's + is on the plan");
  const x = action.def.x + action.def.w / 2;
  const y = action.def.y + action.def.h / 2;
  tap(x, y);
  assert.equal(glass.page.name, "home", "the + draws a dashed card on the plan");
  tap(x, y);
  assert.equal(glass.page.name, "zone", "the check opens the new zone's screen");
  assert.match(text("tTitle1"), /^Card \d+$/, "the zone the dashed card named");
});

test("a list's row and a key light while the finger is down, painted by the glass, and go back as it leaves", async () => {
  // the theme's `pressed`, with no word to the ESP32
  const { glass, tap, run, text, glassNotes } = await rig();
  const lovelace = JSON.parse(readFileSync(join(REPO, "libs/nspanel-sim/themes/lovelace-jobr99/theme.json"), "utf8"));
  const color = (id) => lovelace.colors.find((c) => c.id === id).rgb565;
  const bco = (objname) => Number(glass.components().find((c) => c.def.objname === objname).attrs.bco);
  tap(240, 160);
  drag(glass, run, [240, 120], [240, 300]);
  assert.equal(text("tTitle1"), "Main settings");
  // the first row, held a moment and dragged off: lit until the finger leaves
  const row = glass.components().find((c) => c.def.objname === "mRow2").def;
  const parts = ["tLabel2", "tHint2", "tIcon2"];
  glass.press(row.x + 20, row.y + row.h / 2);
  run(100);
  assert.deepEqual(parts.map(bco), parts.map(() => color("pressed")), "the row's texts in the theme's pressed");
  glass.move(row.x + 20, row.y + row.h + 40);
  run(100);
  assert.deepEqual(parts.map(bco), parts.map(() => color("pressed")), "dragged off it, still lit");
  glass.release();
  run(400);
  assert.deepEqual(parts.map(bco), parts.map(() => color("background")), "and back to the page as the finger leaves");
  assert.equal(glass.page.name, "settings", "a release off the row does nothing else");
  // a key of the keyboard: its face, and back. The title closes Main settings
  tap(100, 40);
  assert.equal(glass.page.name, "home");
  tap(40, 160, 800);
  tap(100, 40, 800);
  assert.equal(glass.page.name, "editboard");
  const key = glass.components().find((c) => c.def.objname === "mkq0").def;
  glass.press(key.x + key.w / 2, key.y + key.h / 2);
  run(60);
  assert.equal(bco("kq0"), color("pressed"), "the key's face lit");
  glass.release();
  run(400);
  assert.equal(bco("kq0"), color("plan-card"), "and back to its face");
  assert.equal(textOf(String(glass.read("screensaver.kbIn.txt"))), "Hallq", "the key typed as ever");
  assert.deepEqual(glassNotes, []);
});

// --- what the panel writes when nobody touches it --------------------------------------------------------

/** a zone's member put in the state a join leaves it in, in the panel's VM: no one touched the glass */
function joining(panel, zone, ieee) {
  assert.equal(panel.vm.run(`import global
global.join_probe = def (a) var z = global.panel_ui.store.find_zone("${zone}") z["zstate"]["${ieee}"] = "joining" end
global.state_probe = def (a) return global.panel_ui.store.find_zone("${zone}")["zstate"]["${ieee}"] end`, "join"), 0, panel.vm.error());
  panel.vm.call("join_probe", "");
}

test("a lamp switched off at the wall, a member that never answers its join, makes the panel write nothing for an hour: the join fails and is tried again, in the document and not on the flash", async () => {
  const { panel, run, bridge, home, zidOf } = await rig();
  run(30000);
  const lamp = bridge.zigbee.devices.find((d) => d.groups.includes(zidOf("middle")));
  lamp.powered = false;
  joining(panel, "middle", lamp.ieee);
  const file = () => panel.vm.readFile("/_persist.json");
  const before = file();
  let writes = 0;
  let last = before;
  const states = new Set();
  for (let t = 0; t < 3600; t++) {
    home.advance(1000);
    const now = file();
    if (now !== last) writes++;
    last = now;
    if (t % 5 === 0) states.add(panel.vm.call("state_probe", ""));
  }
  assert.ok(states.has("failed") && states.has("joining"), `the lamp's join was tried, failed and tried again: ${[...states]}`);
  // the review counted 19 writes in the hour, each with its backup
  assert.equal(writes, 0, "and in that hour the panel wrote its configuration not once");
  assert.equal(file(), before, "the file is the one it had");
});

// --- the slider stands where the lamp is ----------------------------------------------------------------

test("a lamp's detail: the brightness slider stands where the lamp says it is, one another hand dimmed, and not at the 50 of a lamp this panel never set", async () => {
  const { panel, glass, tap, run, glassNotes, bridge } = await rig();
  tap(240, 160);
  // dimmed from somewhere else: a wall button, another panel, the phone
  const lamp = bridge.zigbee.devices.find((d) => d.ieee === "0x00124B0000E00001");
  bridge.zigbee.command("ZbSend", JSON.stringify({ Device: lamp.ieee, Send: { Dimmer: 60 } }));
  run(1000);
  // the Middle's joint page, its screen, and the first lamp's detail, as the test of the slider does it
  tap(240, 180, 800);
  assert.equal(glass.page.name, "lightdetail");
  const card = glass.components().find((c) => c.def.type === "Button" && /^bRow/.test(c.def.objname));
  tap(card.def.x + card.def.w / 2, card.def.y + card.def.h / 2);
  assert.equal(glass.page.name, "zone");
  tap(363, 204, 800);
  assert.equal(glass.page.name, "lightdetail");
  const slider = glass.components().find((c) => c.def.type === "Slider");
  // Dimmer 60 of 254, as the slider's scale has it (level_for: 5 to 95 percent of the range): about 21
  const at = Number(slider.attrs.val);
  assert.ok(at >= 19 && at <= 23, `the slider is where the lamp is, about 21: ${at}`);
  assert.deepEqual(glassNotes, []);
});
