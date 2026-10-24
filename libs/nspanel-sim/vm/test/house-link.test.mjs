// A node comes into the house over the link of the pairing (berry/house_link.be), end to end: the panel and the bridge pair as they do from the glass, on the firmware's own
// radio drivers (the pairing's, over ESP-NOW, and the mesh's, with its cipher), and the welcome goes over the link the pairing made. Nothing is handed over by the test but the
// button's window and the taps of the glass: the panel's pairing is driven by the same calls the views make (zigbee_pairing.be's run).
//
//   K1  Add to this house: a panel that founded the house pairs a bridge that has no house, as a guest, and the bridge is in it: the number, the key, the list,
//       and one mesh (every pairing is entering the house)
//   K3  what does not come in: a bridge that is in a house already
//   K4  the welcome is lost on the way: a piece is sent again, and the node is not given a welcome that is not whole
//   K5 to K7  leaving the house
//   K8  from the box, with the bench image (the browser's choice of image): the panel founds its own house at its first second, named
//       by its address, and Add to this house brings the bridge in with the next number
//   K9  the bridge of the house takes the room's commands over the mesh, and the map of the panel's devices is asked of it
//   K10 the bridge's events reach the panel that hears it over the mesh: a ping's answer lifts the lamp's doubt
//   K11 the room's session over the mesh: the bridge cut off from the mesh is unreached, and back in step the session rises
//   K12 to K14  a panel admitted by a panel of the house, at its own window: one with no house, one that leaves its own, and a window nobody picks
//   K15 Join another house, said to a bridge by a panel: the bridge goes, struck off as it says so, its window opens by itself, and a panel
//       of another house adds it
// A panel added by a panel of the house is part of the pairing's tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { meshHouse } from "./mesh-world.mjs";
import { meshIsolate, meshHeal } from "../dist/index.js";

const BRIDGES = [1, 3];
const PANELS = [4, 2];

/** the Berry of the house layer of a node, as an expression */
const hm = (id) => (BRIDGES.includes(id) ? "global.zbbridge_relay.house" : "global.house");
const pairing = "global.zb_pairing";

/** two bridges (1 and 3) and two panels (4 and 2), none in a house: the mesh numbers are the ones the list will give, in the order the tests bring them in (1, 2, 3 after the panel 4) */
async function world(opt = {}) {
  const h = await meshHouse({ bridges: BRIDGES, panels: PANELS, virgin: [...BRIDGES, ...PANELS], air: { cipher: "real" }, ...opt });
  // the relay of a bridge has its HouseMesh a few seconds after boot, and a panel its boot's house layer
  for (let i = 0; i < 40; i++) {
    const ready = h.ids.every((id) => h.berry(id, `${hm(id)} != nil`).v === true && h.berry(id, "espnow_mesh_ready()").v !== undefined);
    if (ready) break;
    h.run(1000);
  }
  h.run(5000);
  return h;
}

/** a Berry expression's value on a device, throwing what it raised */
function value(h, id, expr) {
  const r = h.berry(id, expr);
  assert.ok(!("raise" in r), `${expr} on ${id}: ${JSON.stringify(r)}`);
  return r.v;
}

/** the clock runs until the expression is true on the device, or `ms` pass */
function until(h, id, expr, ms) {
  for (let t = 0; t < ms; t += 250) {
    if (value(h, id, expr) === true) return true;
    h.run(250);
  }
  return value(h, id, expr) === true;
}

/** the panel founds the house (the first of its list) */
function founded(h, panel, name = "Cottage") {
  assert.equal(value(h, panel, `${hm(panel)}.found('${name}', nil)`), true, "the panel founds the house");
  h.run(3000);
}

/** the pairing's window on the bridge (its button, held), the search on the panel, the bridge picked and asked to blink, and Yes: what the glass does, by the calls the views make */
function pair(h, panel, bridge) {
  value(h, panel, `${pairing}.run('endPair', [])`);
  value(h, bridge, "global.zbbridge_relay.open_window(120000, true)");
  h.run(500);
  value(h, panel, `${pairing}.run('discover', [])`);
  assert.ok(until(h, panel, `size(${pairing}.found) >= 1`, 20000), `the bridge is heard: ${JSON.stringify(h.berry(panel, `${pairing}.state()['found']`))}`);
  assert.ok(until(h, panel, `!${pairing}.searching`, 20000), "the search is over");
  const id = value(h, panel, `${pairing}.found[0]['id']`);
  value(h, panel, `${pairing}.run('blink', [${id}])`);
  assert.ok(until(h, panel, `${pairing}.asking == 'blinking'`, 8000), "the bridge says it blinks");
  value(h, panel, `${pairing}.run('pair', [])`);
}

const asking = (h, panel) => value(h, panel, `${pairing}.asking`);
const result = (h, panel) => value(h, panel, `${pairing}.result`);
const house = (h, panel) => value(h, panel, `${pairing}.house_result`);
const ids = (h, id) => value(h, id, `${hm(id)}.list.ids(false)`);
const version = (h, id) => h.status(id).GroupVersion;

test("Add to this house: a panel of the house pairs a bridge that has no house, as a guest, and the welcome goes over the link of the pairing: the bridge is in the house, in one mesh", async () => {
  const h = await world();
  founded(h, 4);
  pair(h, 4, 1);
  assert.ok(until(h, 4, `${pairing}.result == 'paired'`, 60000), `paired: ${asking(h, 4)} ${JSON.stringify(h.logs.slice(-6))}`);
  assert.equal(house(h, 4), "in", "and the bridge is in the house");
  assert.deepEqual(ids(h, 4), [1, 4], "the panel's list has the bridge");
  assert.equal(value(h, 4, `${hm(4)}.list.node(1)['name']`), "zbbridge-1", "by the name its hello said");
  assert.equal(value(h, 4, `${hm(4)}.list.node(1)['role']`), 1, "as a bridge");
  assert.equal(String(value(h, 4, `${hm(4)}.list.node(1)['ip']`)).toLowerCase(), "c0a8003d", "and the address its hello said, 192.168.0.61");
  assert.equal(value(h, 4, `${hm(4)}.list.node(1)['slot']`), 1, "with the first alarm number");
  assert.equal(value(h, 1, `${hm(1)}.list.me`), 1, "the bridge has its number");
  assert.equal(version(h, 1), 1, "the key of version 1");
  assert.equal(h.status(1).Running, 1, "its mesh runs");
  assert.deepEqual(ids(h, 1), [1, 4], "and it holds the list of the panel");
  assert.equal(value(h, 1, `${hm(1)}.list.name()`), "Cottage");
  h.run(20_000);
  assert.equal(value(h, 1, `${hm(1)}.list.digest()`), value(h, 4, `${hm(4)}.list.digest()`), "the same list in the two");
  assert.ok(!h.logs.some((l) => /[0-9A-F]{64}/i.test(l.line)), "the key of the network is in no log line");
});

/** a house of the panel 4 and the bridge 1, as K1 makes it */
async function withBridge(opt) {
  const h = await world(opt);
  founded(h, 4);
  pair(h, 4, 1);
  assert.ok(until(h, 4, `${pairing}.result == 'paired'`, 60000), "the bridge is paired");
  assert.equal(house(h, 4), "in");
  h.run(20_000);
  return h;
}

const macOf = (id) => `A0B765${BRIDGES.includes(id) ? "77" : "00"}00${id.toString(16).padStart(2, "0")}`;

test("what does not come in: a bridge that is in a house is not given another", async () => {
  // a bridge that is in a house, and a panel of it, pair again: nothing is given, and nothing is written
  const g = await withBridge();
  const before = value(g, 4, `${hm(4)}.list.digest()`);
  pair(g, 4, 1);
  assert.ok(until(g, 4, `${pairing}.result == 'paired'`, 60000), "paired again");
  assert.equal(house(g, 4), "already", "a bridge that is in a house is given no other, and the panel says why");
  assert.deepEqual(ids(g, 4), [1, 4], "the list is as it was");
  assert.equal(value(g, 4, `${hm(4)}.list.digest()`), before);
});

test("the welcome on a radio that loses a frame in three: pieces and answers are sent again, and the bridge ends in the house all the same", async () => {
  const h = await world();
  founded(h, 4);
  pair(h, 4, 1);
  assert.ok(until(h, 4, `${pairing}.asking == 'hello' || ${pairing}.asking == 'house'`, 30000), "the link is up");
  // a frame in three lost, at random (a seeded generator: the same run every time), of what the panel and the bridge send
  let seed = 20261015;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let dropped = 0;
  h.home.air.drop = (f) => (f.from === macOf(4) || f.from === macOf(1)) && random() < 1 / 3 && ++dropped > 0;
  assert.ok(until(h, 4, `${pairing}.result == 'paired'`, 120000), `paired: ${asking(h, 4)}`);
  h.home.air.drop = () => false;
  assert.ok(dropped > 3, `the radio lost frames: ${dropped}`);
  assert.equal(house(h, 4), "in", "and the welcome got through");
  assert.equal(version(h, 1), 1);
  assert.deepEqual(ids(h, 1), [1, 4], "whole: the list of the panel");
});

test("a welcome that never gets through is not taken half: the bridge is as it was, the panel says so, and the same bridge pairs again into the same number", async () => {
  const h = await world();
  founded(h, 4);
  pair(h, 4, 1);
  assert.ok(until(h, 4, `size(${hm(4)}.list.ids(false)) >= 2`, 30000), "the bridge says who it is, and the panel writes it into the list");
  h.home.air.drop = (f) => f.from === macOf(4);
  assert.ok(until(h, 4, `${pairing}.result == 'paired'`, 120000), `paired: ${asking(h, 4)}`);
  h.home.air.drop = () => false;
  assert.equal(house(h, 4), "silent", "the pairing is done, the house is not");
  assert.deepEqual([version(h, 1), value(h, 1, `${hm(1)}.list.me`), ids(h, 1)], [0, 1, []], "the bridge has no key and no list (its number is the driver's)");
  assert.ok(ids(h, 4).includes(1), "the panel wrote it into the list: the number waits");
  // again: the same identity is the same number
  pair(h, 4, 1);
  assert.ok(until(h, 4, `${pairing}.result == 'paired' && ${pairing}.asking == nil`, 90000), `paired again: ${asking(h, 4)}`);
  assert.equal(house(h, 4), "in", "and now it is in");
  assert.deepEqual(ids(h, 4), [1, 4], "no second entry for it");
  assert.equal(version(h, 1), 1);
  assert.deepEqual(ids(h, 1), [1, 4]);
});

// Leaving the house: the driver forgets the number, the keys and the identity (EspNowMeshLeave), the house layer its list, and the node is a new one
test("Remove from house: the panel tells the bridge to leave and strikes it off; the bridge leaves (no number, no key, its mesh stopped, no list), and the same bridge pairs into the house again, with a new identity", async () => {
  const h = await withBridge();
  assert.equal(value(h, 4, `${hm(4)}.remove(1)`), true, "the panel removes the bridge");
  assert.ok(until(h, 1, `!${hm(1)}.up`, 20000), `the bridge leaves the house: ${JSON.stringify(h.logs.filter((l) => /HOUSE/.test(l.line)).slice(-4))}`);
  const st = h.status(1);
  assert.deepEqual([st.Id, st.GroupVersion, st.Running], [0, 0, 0], "the driver forgot its number and its key, and its mesh stopped");
  assert.deepEqual(ids(h, 1), [], "its list is empty");
  assert.ok(until(h, 4, `${hm(4)}.list.revoked(1)`, 5000), "the panel struck it off");
  pair(h, 4, 1);
  assert.ok(until(h, 4, `${pairing}.result == 'paired' && ${pairing}.asking == nil`, 120000), `paired again: ${asking(h, 4)}`);
  assert.equal(house(h, 4), "in", "the same bridge is in the house again: its new identity is not the one struck off");
  const me = value(h, 1, `${hm(1)}.list.me`);
  assert.ok(me >= 1 && me !== 1, `with another number: ${me}`);
  assert.equal(h.status(1).Running, 1, "and its mesh runs");
  assert.ok(!h.logs.some((l) => /[0-9A-F]{64}/i.test(l.line)), "the key of the network is in no log line");
});

test("a panel leaves the house with its bridge: the bridge is told and leaves, the panel leaves a moment later, and both are new to a house", async () => {
  const h = await withBridge();
  assert.equal(value(h, 4, `${hm(4)}.leave_house(1)`), true, "the panel leaves with its bridge");
  assert.ok(until(h, 1, `!${hm(1)}.up`, 20000), "the bridge leaves");
  assert.ok(until(h, 4, `!${hm(4)}.up`, 20000), "and the panel");
  for (const id of [1, 4]) {
    const st = h.status(id);
    assert.deepEqual([st.Id, st.GroupVersion, st.Running], [0, 0, 0], `node ${id}: no number, no key, no mesh`);
    assert.deepEqual(ids(h, id), [], `node ${id}: no list`);
  }
  // the panel founds a house again, and the bridge comes in by the pairing
  assert.equal(value(h, 4, `${hm(4)}.found('Cottage', 1)`), true, "the panel founds a house again");
  h.run(3000);
  pair(h, 4, 1);
  assert.ok(until(h, 4, `${pairing}.result == 'paired' && ${pairing}.asking == nil`, 120000), `paired: ${asking(h, 4)}`);
  assert.equal(house(h, 4), "in", "and the bridge is in the new house");
});

test("the bridge's button: let go after the hold, the window opens and the bridge stays in the house; held on to 20 s, it leaves the house and its LED says so", async () => {
  const h = await withBridge();
  const bridge = h.dev(1);
  bridge.holdButton();
  h.run(20_000);
  assert.equal(value(h, 1, `${hm(1)}.up`), true, "let go a moment after the hold: still in the house");
  assert.equal(h.status(1).Id, 1, "with its number");
  h.run(130_000);
  bridge.holdButton(15_500);
  assert.ok(until(h, 1, `!${hm(1)}.up`, 20_000), "held on to 20 s: the bridge leaves the house");
  assert.deepEqual([h.status(1).Id, h.status(1).GroupVersion], [0, 0], "no number, no key");
  assert.ok(bridge.blinking(3000) || bridge.ledLog.length > 0, "and its LED blinked");
  assert.ok(h.logs.some((l) => /the button held 20 s: this bridge leaves the house/.test(l.line)), "the log says why");
});

test("from the box, with the bench image: the bridge has no number, the panel founds its own house at its first second, named by its address, and Add bridge brings the bridge in with the next number", async () => {
  const h = await world({ factory: [1, 4] });
  h.run(3000);
  assert.equal(h.status(1).Id, 0, "the bridge has no number: a flash with no record of the mesh, and a bridge founds nothing");
  const pub = (id) => h.cmd(id, "EspNowMeshPublic").EspNowMeshPublic.Public;
  assert.notEqual(pub(1), pub(4), "each drew an identity of its own: with one, the panel would find its own key and give the bridge its own number");
  const view = "global.panel_ui.provider_of('house', nil)";
  const name = value(h, 4, `${hm(4)}.list.name()`);
  assert.match(name, /^House-[0-9a-hjkmnp-tv-z]{6}$/, "the house is named House- and six letters of Crockford's base 32, from the panel's radio address");
  assert.deepEqual([h.status(4).Id, value(h, 4, `${hm(4)}.list.me`), value(h, 4, `${view}.title()`)], [1, 1, name],
    "the panel is the node 1 of the house it founded, and the house's page says its name");
  value(h, 4, "global.panel_ui.prefs.setitem('editing', true)");
  pair(h, 4, 1);
  assert.ok(until(h, 4, `${pairing}.result == 'paired'`, 60000), `paired: ${asking(h, 4)}`);
  assert.equal(house(h, 4), "in", "and the bridge is in the house");
  assert.deepEqual([value(h, 1, `${hm(1)}.list.me`), h.status(1).Id, h.status(1).Running, version(h, 1)], [2, 2, 1, 1], "the bridge was given the number 2, the key, and its mesh runs");
  h.run(20_000);
  assert.equal(value(h, 1, `${hm(1)}.list.digest()`), value(h, 4, `${hm(4)}.list.digest()`), "the same list in the two");
});

/** the house with the bridge of the room in it, its network formed again on the channel the panel chose (zbbridge_relay.be, apply_channel), and the panel's session with it up */
async function settled(opt) {
  const h = await withBridge(opt);
  assert.ok(until(h, 1, "global.zbbridge_relay != nil && global.zbbridge_relay.next_channel == nil && ZbBridgeRelay.fresh_identity(ZbBridgeRelay.zb_config()) == \"\"", 120000), "the bridge's network is formed again, its identity drawn");
  assert.ok(until(h, 4, "global.zb_bridge.link_state()", 60000), "and the bridge of the house in step, the session up");
  h.run(5000);
  return h;
}

test("the bridge of the house takes the room's commands over the mesh, and the panel's map of its devices is asked of it the same way", async () => {
  const h = await settled();
  const LAMP = "0x00124B0000F40001";
  h.dev(1).zigbee.add({ ieee: LAMP, model: "TS0505B", caps: 3, ct: [0, 0], endpoint: 1, relay: 0 });
  value(h, 4, `global.panel_ui.store.register_device(['${LAMP}', 'Lamp', 'light', 3, 0, 0, '', 1, 0, 0])`);
  // what the panel's views send goes through the boot's route (panel_boot.be: PanelZigbee's send)
  const send = (line) => value(h, 4, `global.panel_ui.network.send('${line}')`);
  const power = (p) => `ZbSend {"Device":"${LAMP}","Send":{"Power":${p}}}`;
  const executed = () => value(h, 1, "global.zbbridge_relay.meshcmd.executed");
  const lamp = () => h.dev(1).zigbee.find(LAMP).power;
  assert.equal(value(h, 4, "global.zb_bridge.peer()['id']"), 1, "the bridge of the house is the bridge 1");
  let was = executed();
  assert.equal(send(power(1)), true);
  h.run(2000);
  assert.deepEqual([lamp(), executed() > was], [1, true], "the mesh carried it, to the bridge's MeshCmd");
  was = executed();
  assert.equal(send(power(0)), true);
  h.run(2000);
  assert.deepEqual([lamp(), executed() > was], [0, true], "and the next");
  // the map: each device the panel has, asked of its bridge over the mesh, its answer back by it
  assert.equal(h.dev(4).vm.run("import global\nglobal.panel_ui.network.ieee_of = {}", "k9-map"), 0);
  assert.equal(send(`ZbInfo ${LAMP}`), true, "the device asked over the mesh");
  assert.ok(until(h, 4, `global.panel_ui.network.short_of('${LAMP}') != nil`, 5000), "and the lamp is in the map again, from the bridge's answer over the mesh");
});

test("the bridge's events reach the panel that hears it over the mesh: a ping's answer lifts the lamp's doubt", async () => {
  const h = await settled();
  const LAMP = "0x00124B0000F40003";
  h.dev(1).zigbee.add({ ieee: LAMP, model: "TS0505B", caps: 3, ct: [0, 0], endpoint: 1, relay: 0 });
  value(h, 4, `global.panel_ui.store.register_device(['${LAMP}', 'Lamp', 'light', 3, 0, 0, '', 1, 0, 0])`);
  h.run(5000);
  assert.equal(value(h, 1, "global.zbbridge_relay.listeners().find(4) != nil"), true, "the bridge has the panel among those that hear it");
  // a lamp in doubt, and its ping: the answer is an event of the bridge, which the mesh brings
  const doubt = `global.plan.doubt.contains('${LAMP}')`;
  const ping = () => value(h, 4, `global.panel_ui.network.send('ZbPing ${LAMP}')`);
  value(h, 4, `global.plan.doubt.setitem('${LAMP}', true)`);
  assert.equal(value(h, 4, doubt), true);
  // with nothing on the panel to take its bridge's events from the mesh, the answer does not come
  assert.equal(h.dev(4).vm.run("import global\nglobal._ev = global.house.events\nglobal.house.events = nil", "k10-off"), 0);
  assert.equal(ping(), true, "the ping leaves over the mesh");
  h.run(5000);
  assert.equal(value(h, 4, doubt), true, "and no answer came by another way");
  assert.equal(h.dev(4).vm.run("import global\nglobal.house.events = global._ev", "k10-on"), 0);
  assert.equal(ping(), true);
  assert.ok(until(h, 4, `!${doubt}`, 5000), "its answer comes back over the mesh, and the doubt is lifted");
});

test("the room's session over the mesh: the bridge of the house cut off is unreached, and back in step the session rises and the map is asked again", async () => {
  const h = await settled();
  const LAMP = "0x00124B0000F40004";
  h.dev(1).zigbee.add({ ieee: LAMP, model: "TS0505B", caps: 3, ct: [0, 0], endpoint: 1, relay: 0 });
  value(h, 4, `global.panel_ui.store.register_device(['${LAMP}', 'Lamp', 'light', 3, 0, 0, '', 1, 0, 0])`);
  assert.equal(value(h, 4, "global.zb_bridge.mesh_up"), true, "the bridge of the house is in step on the mesh");
  meshIsolate(h.home, 1);
  assert.ok(until(h, 4, "!global.zb_bridge.link_state()", 60000), "cut off from the mesh: not reached");
  assert.equal(value(h, 4, `global.panel_ui.network.send('ZbSend {"Device":"${LAMP}","Send":{"Power":1}}')`), false, "and nothing is sent to it");
  // the map forgotten while it is away: the session's rise asks for it again
  assert.equal(h.dev(4).vm.run("import global\nglobal.panel_ui.network.ieee_of = {}", "k11-map"), 0);
  meshHeal(h.home);
  assert.ok(until(h, 4, "global.zb_bridge.link_state()", 60000), "back in step on the mesh: reached again");
  assert.ok(until(h, 4, `global.panel_ui.network.short_of('${LAMP}') != nil`, 15000), "and the session's rise asked for the map over the mesh");
});

/** this panel's own window (zigbee_pairing.be): its state, as the views read it */
const windowOf = (h, panel) => value(h, panel, `${pairing}.window == nil ? nil : ${pairing}.window['state']`);

/** the search of a panel of the house, the panel picked by its radio address and asked to identify itself, and Yes, as the glass does */
function addPanel(h, by, panel) {
  value(h, by, `${pairing}.run('endPair', [])`);
  value(h, by, `${pairing}.run('discover', [])`);
  assert.ok(until(h, by, `!${pairing}.searching && size(${pairing}.found) >= 1`, 30000), "the search is over");
  const found = value(h, by, `json.dump(${pairing}.found)`);
  const entry = JSON.parse(found).find((f) => f.mac.replace(/:/g, "") === macOf(panel));
  assert.ok(entry, `the panel ${panel} is heard: ${found}`);
  assert.equal(entry.display, true, "and its window says it has a display: the glass says panel");
  value(h, by, `${pairing}.run('blink', [${entry.id}])`);
  assert.ok(until(h, panel, `${pairing}.window != nil && ${pairing}.window['state'] == 'asked'`, 10000), "the picked panel's screen says it is the one");
  assert.ok(until(h, by, `${pairing}.asking == 'blinking'`, 10000), "and the panel that adds it hears so");
  value(h, by, `${pairing}.run('pair', [])`);
}

test("a panel with no house opens its own window, a panel of the house finds it as a panel, its screen says it is the one, and the welcome brings it in", async () => {
  const h = await world();
  founded(h, 4);
  value(h, 2, `${pairing}.run('window', [])`);
  assert.ok(until(h, 2, `${pairing}.window != nil && ${pairing}.window['state'] == 'open'`, 5000), `the window of the panel with no house is open: ${windowOf(h, 2)}`);
  addPanel(h, 4, 2);
  assert.ok(until(h, 4, `${pairing}.result == 'paired' && ${pairing}.asking == nil`, 90000), `added: ${asking(h, 4)}`);
  assert.equal(house(h, 4), "in", "and the panel is in the house");
  assert.ok(until(h, 2, `${pairing}.window['state'] == 'in'`, 10000), `its window says so: ${windowOf(h, 2)}`);
  const me = value(h, 2, `${hm(2)}.list.me`);
  assert.ok(me >= 1, "it has its number");
  assert.equal(value(h, 4, `${hm(4)}.list.node(${me})['role']`), 2, "as a panel in the list of the panel that added it");
  assert.equal(version(h, 2), 1, "with the key of the house");
  assert.equal(value(h, 2, `${hm(2)}.writes()`), true, "and it writes the list, as every panel of the house");
  h.run(20_000);
  assert.equal(value(h, 2, `${hm(2)}.list.digest()`), value(h, 4, `${hm(4)}.list.digest()`), "the same list in the two");
  assert.ok(!h.logs.some((l) => /[0-9A-F]{64}/i.test(l.line)), "the key of the network is in no log line");
});

test("Join another house: a panel in a house of its own leaves it, its window opens once it is out, and a panel of the other house adds it", async () => {
  const h = await world();
  founded(h, 4);
  founded(h, 2, "Living room 2");
  assert.equal(value(h, 2, `${hm(2)}.list.name()`), "Living room 2", "the panel 2 in a house of its own");
  value(h, 2, `${hm(2)}.leave_house(0)`);
  value(h, 2, `${pairing}.run('window', [])`);
  assert.ok(until(h, 2, `${pairing}.window['state'] == 'open'`, 20000), `out of its house, its window opens: ${windowOf(h, 2)}`);
  addPanel(h, 4, 2);
  assert.ok(until(h, 4, `${pairing}.result == 'paired' && ${pairing}.asking == nil`, 90000), `added: ${asking(h, 4)}`);
  assert.equal(house(h, 4), "in");
  assert.ok(until(h, 2, `${pairing}.window['state'] == 'in'`, 10000));
  assert.equal(value(h, 2, `${hm(2)}.list.name()`), "Cottage", "it is in the other house now");
  // the window closed by its Done: nothing of it is left
  value(h, 2, `${pairing}.run('closeWindow', [])`);
  assert.equal(windowOf(h, 2), null);
});

test("Join another house said to a bridge: it goes, the panel strikes it off as it says so, its window opens by itself, and a panel of another house adds it", async () => {
  const h = await withBridge();
  founded(h, 2, "Living room 2");
  assert.equal(value(h, 4, `${hm(4)}.move(1)`), true, "the panel tells its bridge to join another house");
  assert.ok(until(h, 1, `!${hm(1)}.up`, 20000), `the bridge leaves the house: ${JSON.stringify(h.logs.filter((l) => /HOUSE/.test(l.line)).slice(-4))}`);
  assert.ok(until(h, 4, `${hm(4)}.list.revoked(1)`, 20000), "the panel struck it off, as the bridge said it goes");
  assert.ok(until(h, 1, "global.zbbridge_relay.window_until != nil", 5000), "and its window opened by itself, for a panel of the other house");
  pair(h, 2, 1);
  assert.ok(until(h, 2, `${pairing}.result == 'paired' && ${pairing}.asking == nil`, 120000), `added: ${asking(h, 2)}`);
  assert.equal(house(h, 2), "in", "the bridge is in the other house");
  assert.equal(value(h, 1, `${hm(1)}.list.name()`), "Living room 2");
});

test("a panel's window picked by nobody closes by itself at its time, and the screen says so", async () => {
  const h = await world();
  value(h, 2, `${pairing}.run('window', [])`);
  assert.ok(until(h, 2, `${pairing}.window['state'] == 'open'`, 5000));
  h.run(310_000);
  assert.equal(windowOf(h, 2), "closed", "its time was up");
});
