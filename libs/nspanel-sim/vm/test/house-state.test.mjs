// The state of a device of one room shown in another (berry/house_state.be, berry/panel_route.be; 7.3 and 11.2), end to end: a
// house of three bridges and two panels on one mesh and on the firmware's own cipher, each with the repo's Berry brain booted. A lamp is on the Zigbee network of the bridge 2; the
// panel 4 has it in its configuration as the bridge 2's, and the panel 5 does not show it.
//
//   Z1  the panel marks the device: the bridge keeps the mark, reads the lamp, and the panel has its state
//   Z2  a command from the panel goes over the mesh to the bridge that owns the lamp, which runs it, and the report comes back to the panel and to it alone
//   Z3  the panel is cut off while the lamp changes: when it hears again it knows by the heartbeat, asks, and has the state
//   Z4  the bridge restarts: the marks come back from its flash, and the state goes on
//   Z5  the panel stops showing the device: the bridge is told, and says nothing of the lamp any more
//   Z6  a lamp nobody marks is not said to the house
//   Z7  a panel with no bridge of its own, which shows the bridge's lamp and commands it, hears what the bridge says of it: a ping's answer lifts the doubt
//   Z8  a zone with lamps of two bridges: its group is made on both, in the panel's own range of numbers, and one group command switches them all
//   Z9  a device removed from the house by one panel leaves its bridge's network and every panel that shows it: at once by the flood, and, for a panel cut off,
//       when it hears the bridge again
//   Z10 a bridge that leaves the house by itself says so first: a panel strikes it off, once, and its devices leave every panel; and a panel that leaves takes the
//       house's devices with it, and keeps the ones of no bridge numbered
//   Z11 a new device paired from a panel on a bridge of the house it chose: that bridge's network opens over the mesh, the interview comes back to the
//       panel, and the device is that bridge's, with its state
//   Z12 a bridge's web password, set and removed, and its factory reset, from a panel of the house over the mesh: the reset is the bridge leaving the house
//   Z13 the house's MQTT, saved on one panel, taken by every node, bridges and panels, over the mesh
//   Z14 the alarm's configuration is the house's: a sensor set on one panel is taken by the bridge that owns it, the times by every bridge, the other panel's screens
//       show it, a word to a bridge's own alarm that sets it is refused, and a device removed leaves it
import { test } from "node:test";
import assert from "node:assert/strict";
import { meshIsolate, meshHeal } from "../dist/index.js";
import { whole } from "./house-world.mjs";

const LAMP = "0x00124B0000F10001";
const DOOR = "0x00124B0000F10009";
const OTHER = "0x00124B0000F10002";
const REAL = { air: { cipher: "real" } };

const spec = (ieee) => ({ ieee, model: "TS0505B", caps: 3, ct: [0, 0], endpoint: 1, relay: 0 });

// what the panel 4 is given: a store with the lamp as the bridge 2's, the route a command takes, and what the house says of the lamps it shows
const PANEL = `
import json
import global
global._store = PanelStore(nil)
global._store.register_device(["${LAMP}", "Far lamp", "light", 3, 0, 0, "", 1, 0, 0])
global._store.set_owner("${LAMP}", 2)
global._mc = MeshCmd(nil)
global._route = PanelRoute(global._store, global._mc)
global._got = []
global.house.state.wanted = / -> global._store.remote_by_owner()
global.house.state.deliver = / r -> global._got.push(r)
def mt_got() var r = global._got global._got = [] return json.dump(r) end
def mt_send(l) return global._route.send(l) end
def mt_unshow() global._store.set_owner("${LAMP}", 0) return "ok" end
`;

async function house() {
  const h = await whole(REAL);
  h.dev(2).zigbee.add(spec(LAMP));
  h.dev(2).zigbee.add(spec(OTHER));
  assert.equal(h.dev(4).vm.run(PANEL, "panel-probes"), 0, h.dev(4).vm.error());
  const H = {
    ...h,
    got: () => JSON.parse(h.dev(4).vm.call("mt_got", "")),
    send: (line) => h.berry(4, `mt_send('${line.replaceAll("'", "\\'")}')`).v,
    lamp: () => h.dev(2).zigbee.find(LAMP),
    marks: (id = 2) => h.berry(id, "json.dump(global.zbbridge_relay.house.state.marks.keys())").v,
  };
  return H;
}

const states = (list) => list.flatMap((r) => Object.entries(r).map(([k, v]) => [k, v.Power])).filter(([k]) => k === LAMP);

test("the panel marks the device: the bridge keeps the mark, reads the lamp, and the panel has its state", async () => {
  const h = await house();
  h.run(20_000);
  assert.equal(h.berry(2, "global.zbbridge_relay.house.state.marks.contains(4)").v, true, "the bridge 2 has the panel 4's mark");
  assert.equal(h.berry(2, "global.zbbridge_relay.house.state.marks[4]['s'].contains('" + LAMP + "')").v, true, "of the lamp");
  assert.equal(h.berry(2, "size(global.zbbridge_relay.house.state.marks)").v, 1, "and of no other panel: the panel 5 shows nothing of it");
  const got = h.got();
  assert.ok(states(got).length >= 1, `the bridge read the lamp and the panel was told: ${JSON.stringify(got)}`);
  assert.deepEqual(states(got).at(-1), [LAMP, 0], "off, as the lamp is");
  assert.equal(h.berry(2, "global.zbbridge_relay.house.state.cache.contains('" + LAMP + "')").v, true, "the bridge keeps what it said, for the ones that ask");
  assert.equal(h.berry(2, "global.zbbridge_relay.house.state.cache.contains('" + OTHER + "')").v, false, "and of no lamp nobody marks");
  assert.equal(h.berry(5, "global.house.state.heard").v, 0, "the panel 5 heard nothing it shows");
});

test("a command from the panel goes over the mesh to the bridge that owns the lamp, which runs it, and the report comes back to the panel", async () => {
  const h = await house();
  h.run(20_000);
  h.got();
  assert.equal(h.send(`ZbSend {"Device":"${LAMP}","Send":{"Power":1}}`), true, "the route sent it");
  h.run(2000);
  assert.equal(h.lamp().power, 1, "the lamp of the other room is on");
  assert.deepEqual(states(h.got()).at(-1), [LAMP, 1], "and the panel was told, by the house's state");
  assert.equal(h.send(`ZbSend {"Device":"${OTHER}","Send":{"Power":1}}`), false, "a device of no bridge numbered, with no bridge of the house, goes nowhere");
  assert.equal(h.berry(4, "global._route.refused.find('no bridge of the house', 0)").v, 1, "and the reason is counted");
  assert.equal(h.dev(2).zigbee.find(OTHER).power, 0, "and the bridge 2 did not hear of it");
  assert.equal(h.berry(4, "global._route.sent").v, 1);
  // and off again, by the same way
  h.send(`ZbSend {"Device":"${LAMP}","Send":{"Power":0}}`);
  h.run(2000);
  assert.deepEqual(states(h.got()).at(-1), [LAMP, 0]);
});

test("a panel cut off while the lamp changes asks when it hears again, and has the state", async () => {
  const h = await house();
  h.run(20_000);
  h.got();
  meshIsolate(h.home, 4);
  h.run(1000);
  h.dev(2).zigbee.command("ZbSend", `{"Device":"${LAMP}","Send":{"Power":1}}`);
  h.run(3000);
  assert.deepEqual(h.got(), [], "the panel 4 heard nothing while it was cut off");
  meshHeal(h.home);
  h.run(40_000);
  assert.deepEqual(states(h.got()).at(-1), [LAMP, 1], "it asked, and the bridge said what the lamp is now");
  assert.ok(h.berry(4, "global.house.state.asked.contains(2)").v, "by an ask");
});

test("the bridge restarts: the marks come back from its flash, and the state goes on", async () => {
  const h = await house();
  h.run(20_000);
  h.got();
  await h.power(2, 3000);
  h.load(2);
  h.run(5000);
  assert.equal(h.berry(2, "global.zbbridge_relay.house.state.marks.contains(4)").v, true, "the bridge has the panel 4's mark from its flash");
  h.dev(2).zigbee.add(spec(LAMP));
  h.run(20_000);
  assert.equal(h.send(`ZbSend {"Device":"${LAMP}","Send":{"Power":1}}`), true);
  h.run(3000);
  assert.deepEqual(states(h.got()).at(-1), [LAMP, 1], "the state of the lamp goes on to the panel");
});

test("the panel stops showing the device: the bridge is told, and says nothing of the lamp any more", async () => {
  const h = await house();
  h.run(20_000);
  h.got();
  h.dev(4).vm.call("mt_unshow", "");
  h.run(10_000);
  assert.equal(h.berry(2, "global.zbbridge_relay.house.state.marks.contains(4)").v, false, "the bridge has no mark of the panel 4");
  assert.equal(h.berry(2, "global.zbbridge_relay.house.state.cache.contains('" + LAMP + "')").v, false, "and keeps nothing of the lamp");
  const flooded = h.berry(2, "global.zbbridge_relay.house.state.flooded").v;
  h.dev(2).zigbee.command("ZbSend", `{"Device":"${LAMP}","Send":{"Power":1}}`);
  h.run(3000);
  assert.equal(h.berry(2, "global.zbbridge_relay.house.state.flooded").v, flooded, "a lamp nobody marks is not said to the house");
  assert.deepEqual(h.got(), []);
});

test("a lamp nobody marks is not said to the house, and the mesh's air stays quiet", async () => {
  const h = await house();
  h.run(20_000);
  const frames = (id) => h.berry(id, "global.zbbridge_relay.house.state.flooded").v;
  const before = frames(2);
  h.dev(2).zigbee.command("ZbSend", `{"Device":"${OTHER}","Send":{"Power":1}}`);
  h.run(3000);
  assert.equal(frames(2), before, "the report of OTHER, which no panel marks, is not flooded");
  h.dev(2).zigbee.command("ZbSend", `{"Device":"${LAMP}","Send":{"Power":1}}`);
  h.run(3000);
  assert.equal(frames(2), before + 1, "and the one of LAMP, which the panel 4 marks, is: one frame");
});

test("a panel hears what a bridge that is not the bridge of its house says of the lamp it commands: the answer to a ping lifts its doubt", async () => {
  const h = await whole(REAL);
  h.dev(2).zigbee.add(spec(LAMP));
  // the panel's own configuration, the boot's: the lamp as the bridge 2's
  assert.equal(h.dev(4).vm.run(`import global
global.panel_ui.store.register_device(["${LAMP}", "Far lamp", "light", 3, 0, 0, "", 1, 0, 0])
global.panel_ui.store.set_owner("${LAMP}", 2)`, "z7"), 0);
  assert.equal(h.berry(4, "global.zb_bridge.peer() == nil || global.zb_bridge.peer()['id'] != 2").v, true, "the lamp's bridge is not the bridge of the panel's house");
  h.run(30_000);
  assert.equal(h.berry(4, `global.house.state.sent.contains(2)`).v, true, "it marked the lamp at the bridge 2");
  assert.equal(h.dev(4).vm.run(`import global\nglobal.plan.doubt["${LAMP}"] = true`, "z7-doubt"), 0);
  // with nothing on the panel to take the bridges' events from the mesh, no answer comes by another way
  assert.equal(h.dev(4).vm.run("import global\nglobal._ev = global.house.events\nglobal.house.events = nil", "z7-off"), 0);
  assert.equal(h.berry(4, `global.panel_ui.network.send('ZbPing ${LAMP}')`).v, true);
  h.run(5000);
  assert.equal(h.berry(4, `global.plan.doubt.contains("${LAMP}")`).v, true, "no answer by another way");
  assert.equal(h.dev(4).vm.run("import global\nglobal.house.events = global._ev", "z7-on"), 0);
  assert.equal(h.berry(4, `global.panel_ui.network.send('ZbPing ${LAMP}')`).v, true, "the ping goes to the bridge 2 over the mesh");
  let lifted = false;
  for (let t = 0; t < 5000 && !lifted; t += 250) {
    h.run(250);
    lifted = h.berry(4, `global.plan.doubt.contains("${LAMP}")`).v === false;
  }
  assert.ok(lifted, "the bridge's answer came to it over the mesh, and the doubt is lifted");
  assert.equal(h.berry(2, "global.zbbridge_relay.heard_from.contains(4)").v, true, "the bridge hears the panel that commanded it");
});

test("a zone with lamps of two bridges has its group on both, in the panel's own range, and one group command switches them all", async () => {
  const h = await whole(REAL);
  const lamps = ["0x00124B0000F20001", "0x00124B0000F20002", "0x00124B0000F20003", "0x00124B0000F20004"];
  h.dev(2).zigbee.add(spec(lamps[0]));
  h.dev(2).zigbee.add(spec(lamps[1]));
  h.dev(3).zigbee.add(spec(lamps[2]));
  h.dev(3).zigbee.add(spec(lamps[3]));
  // the panel 4's own configuration, the boot's: a zone of the four, two of each bridge
  const setup = ["import global", "var s = global.panel_ui.store", "s.doc = PanelStore(nil).doc", "global._z = s.create_zone(\"home\", \"Room\", [0, 0], [3, 3])[\"value\"]"];
  lamps.forEach((id, i) => {
    setup.push(`s.register_device(["${id}", "Lamp ${i}", "light", 3, 0, 0, "", 1, 0, 0])`);
    setup.push(`s.set_owner("${id}", ${i < 2 ? 2 : 3})`);
    setup.push(`s.add_to_zone(global._z, "${id}")`);
  });
  assert.equal(h.dev(4).vm.run(setup.join("\n"), "z8"), 0, h.dev(4).vm.error());
  const zone = () => JSON.parse(h.berry(4, "import json json.dump(global.panel_ui.store.find_zone(global._z))").v ?? "null");
  // the upkeep moves the group to the panel's range, and the group work makes it on each bridge, each answer coming back over the mesh
  let z = null;
  for (let t = 0; t < 90_000; t += 1000) {
    h.run(1000);
    z = h.berry(4, "global.panel_ui.store.find_zone(global._z)['zid']").v;
    const joined = lamps.every((id) => h.berry(4, `global.panel_ui.store.find_zone(global._z)['zstate'].find("${id}")`).v === "in");
    if (joined) break;
  }
  const states = lamps.map((id) => h.berry(4, `global.panel_ui.store.find_zone(global._z)['zstate'].find("${id}")`).v);
  assert.deepEqual(states, ["in", "in", "in", "in"], "every lamp joined the group, on its own bridge");
  assert.equal(z, h.berry(4, "PanelStore.node_zid_base(global.house.list.me)").v, "in the panel's own range of numbers");
  assert.deepEqual(h.berry(4, `global.panel_ui.store.group_bridges(${z})`).v, [2, 3], "held by the bridges 2 and 3");
  // one group command, to both bridges
  assert.equal(h.berry(4, `global.panel_ui.network.send('ZbSend {"Group":${z},"Send":{"Power":1}}')`).v, true);
  h.run(3000);
  assert.deepEqual([h.dev(2).zigbee.find(lamps[0]).power, h.dev(2).zigbee.find(lamps[1]).power, h.dev(3).zigbee.find(lamps[2]).power, h.dev(3).zigbee.find(lamps[3]).power], [1, 1, 1, 1],
    "the four lamps, on the two bridges, are on");
});

test("a device removed from the house leaves its bridge's network and every panel that shows it, at once or when a panel cut off hears again", async () => {
  const h = await whole(REAL);
  const L1 = "0x00124B0000F30101";
  const L2 = "0x00124B0000F30102";
  h.dev(2).zigbee.add(spec(L1));
  h.dev(2).zigbee.add(spec(L2));
  for (const p of [4, 5]) {
    const lines = ["import global"];
    for (const id of [L1, L2]) {
      lines.push(`global.panel_ui.store.register_device(["${id}", "Lamp", "light", 3, 0, 0, "", 1, 0, 0])`);
      lines.push(`global.panel_ui.store.set_owner("${id}", 2)`);
    }
    assert.equal(h.dev(p).vm.run(lines.join("\n"), "z9"), 0, h.dev(p).vm.error());
  }
  h.run(30_000);
  const has = (p, id) => h.berry(p, `global.panel_ui.store.find_device("${id}") != nil`).v;
  const marks = (id) => h.berry(2, `global.zbbridge_relay.house.state.marks.contains(4) && global.zbbridge_relay.house.state.marks.contains(5) && global.zbbridge_relay.house.state.marks[5]['s'].contains("${id}")`).v;
  assert.equal(marks(L1), true, "both panels mark the lamps at the bridge 2");
  // the panel 4 removes the first from the house, as its Remove from the house does: the bridge has it leave and forgets it, and the panel lets it go
  const remove = (id) => {
    assert.equal(h.berry(4, `global.panel_ui.network.send('ZbLeave ${id}')`).v, true);
    assert.equal(h.berry(4, `global.panel_ui.network.send('ZbForget ${id}')`).v, true);
    assert.equal(h.dev(4).vm.run(`import global\nglobal.panel_ui.store.remove_device("${id}")`, "z9-remove"), 0);
  };
  remove(L1);
  h.run(3000);
  assert.equal(h.dev(2).zigbee.find(L1), undefined, "the lamp left the bridge 2's network");
  assert.equal(h.berry(2, `global.zbbridge_relay.house.state.gone.contains("${L1}")`).v, true, "and the bridge keeps it as removed");
  assert.equal(has(5, L1), false, "the panel 5, which showed it, let it go by the flood");
  // the second, with the panel 5 cut off: it lets it go when it hears the bridge again
  meshIsolate(h.home, 5);
  h.run(5000);
  remove(L2);
  h.run(3000);
  assert.equal(has(5, L2), true, "cut off, the panel 5 still has it");
  meshHeal(h.home);
  let gone = false;
  for (let t = 0; t < 60_000 && !gone; t += 1000) {
    h.run(1000);
    gone = has(5, L2) === false;
  }
  assert.ok(gone, "back, it hears that the bridge removed it, and lets it go");
});

test("a bridge that leaves by itself is struck off and its devices leave every panel; a panel that leaves takes the house's devices", async () => {
  const h = await whole(REAL);
  const L1 = "0x00124B0000F30201";
  const L3 = "0x00124B0000F30203";
  const MINE = "0x00124B0000F30209";
  h.dev(2).zigbee.add(spec(L1));
  h.dev(3).zigbee.add(spec(L3));
  for (const p of [4, 5]) {
    const lines = ["import global"];
    lines.push(`global.panel_ui.store.register_device(["${L1}", "Lamp", "light", 3, 0, 0, "", 1, 0, 0])`);
    lines.push(`global.panel_ui.store.set_owner("${L1}", 2)`);
    assert.equal(h.dev(p).vm.run(lines.join("\n"), "z10"), 0, h.dev(p).vm.error());
  }
  const five = ["import global",
    `global.panel_ui.store.register_device(["${L3}", "Lamp 3", "light", 3, 0, 0, "", 1, 0, 0])`,
    `global.panel_ui.store.set_owner("${L3}", 3)`,
    `global.panel_ui.store.register_device(["${MINE}", "Lamp of no bridge", "light", 3, 0, 0, "", 1, 0, 0])`];
  assert.equal(h.dev(5).vm.run(five.join("\n"), "z10-five"), 0, h.dev(5).vm.error());
  h.run(30_000);
  const has = (p, id) => h.berry(p, `global.panel_ui.store.find_device("${id}") != nil`).v;
  const struck = (p) => h.berry(p, "global.house.list.revoked(2)").v;
  const version = (id) => h.berry(id, id <= 3 ? "global.zbbridge_relay.house.key.version" : "global.house.key.version").v;
  assert.equal(has(4, L1) && has(5, L1), true, "both panels show the bridge 2's lamp");
  const before = version(4);
  // the bridge 2 leaves the house by itself, as its button held does: the panels are told first
  assert.equal(h.dev(2).vm.run("import global\nglobal.zbbridge_relay.leave_house()", "z10-go"), 0, h.dev(2).vm.error());
  h.run(1000);
  assert.equal(h.berry(2, "global.zbbridge_relay.house.up").v, false, "the bridge 2 left the house");
  assert.equal(struck(4), true, "the panel 4, the first of the house, struck it off at once");
  h.run(20_000);
  assert.equal(struck(5), true, "and the panel 5 has it struck off by the list");
  assert.equal(version(4), before + 1, "with one change of the key, and not two");
  for (const id of [1, 3, 5]) assert.equal(version(id), before + 1, `the node ${id} has the new key`);
  assert.equal(has(4, L1), false, "the bridge 2's lamp left the panel 4");
  assert.equal(has(5, L1), false, "and the panel 5");
  assert.equal(has(5, L3), true, "the bridge 3's stays");
  const word = (p) => {
    const e = JSON.parse(h.berry(p, "json.dump(global.panel_ui.alarm.alarm.events[-1])").v);
    return [e[2], e[4], e[5], e[0] < 0];
  };
  for (const p of [4, 5]) assert.deepEqual(word(p), ["left", "local", 1, true], `the panel ${p}'s Notifications say the bridge left, with its device`);
  // the panel 5 leaves the house: the bridge 3's lamp goes with the house, and the one of no bridge numbered stays
  assert.equal(h.berry(5, "global.house.leave_house(0)").v, true, "the panel 5 leaves");
  h.run(20_000);
  assert.equal(h.berry(5, "global.house.list.me").v === 5, false, "the panel 5 is out of the house");
  assert.equal(has(5, L3), false, "the bridge 3's lamp left it");
  assert.equal(has(5, MINE), true, "the lamp of no bridge numbered stays");
});

test("a new device paired from the panel 4 on the bridge 3 it chose is the bridge 3's, with its state", async () => {
  const h = await whole(REAL);
  const NEW = "0x00124B0000F30311";
  h.run(20_000);
  // the Hall of the panel's configuration, which has places free
  const zone = "hall";
  assert.ok(h.berry(4, `size(PanelStore.free_slots(global.panel_ui.store.find_zone("${zone}")))`).v > 0, "a zone with a place free");
  // the search the + of the Hall starts on the bridge 3, without its screens: the glass of this world is on its screensaver, whose coming back ends a search
  // (the screens are the Berry suite's, berry/test/test_panel_remote_view.be)
  const start = [
    "import global",
    `global.panel_ui.pairing = {"zone": "${zone}", "until": nil, "found": [], "relay": 0, "off": false, "bridge": 3}`,
    `global.panel_ui.network.run(global.panel_ui.start_pairing("${zone}"))`,
  ];
  assert.equal(h.dev(4).vm.run(start.join("\n"), "z11-pair"), 0, h.dev(4).vm.error());
  h.run(2000);
  assert.ok(h.dev(3).zigbee.permitUntil > 0, "the bridge 3's network is open, by the mesh");
  for (const b of [1, 2]) assert.equal(h.dev(b).zigbee.permitUntil, 0, `and not the bridge ${b}'s`);
  assert.ok(h.dev(3).zigbee.join(spec(NEW)), "the lamp joins the bridge 3");
  let has = false;
  for (let t = 0; t < 20_000 && !has; t += 1000) {
    h.run(1000);
    has = h.berry(4, `global.panel_ui.store.find_device("${NEW}") != nil`).v === true;
  }
  assert.ok(has, "the interview came back to the panel 4, which has the lamp");
  assert.equal(h.berry(4, `global.panel_ui.store.owner_of("${NEW}")`).v, 3, "as the bridge 3's");
  assert.equal(h.berry(4, `global.panel_ui.store.zone_of("${NEW}")["name"]`).v, "Hall", "in the zone it was paired into");
  h.run(15_000);
  assert.equal(h.berry(3, `global.zbbridge_relay.house.state.marks.contains(4) && global.zbbridge_relay.house.state.marks[4]['s'].contains("${NEW}")`).v, true,
    "and the panel 4 marks it at the bridge 3, for its state");
});

test("a bridge's web password and its factory reset, from a panel of the house over the mesh", async () => {
  const h = await whole(REAL);
  h.run(20_000);
  // the touch on the bridge's page, as the house's screen makes it: the word over the mesh, by the brain's effects
  const ask = (id, what) => {
    const code = ["import global", 'var hv = global.panel_ui.provider_of("house", nil)', `global.panel_ui.network.run(hv.admin(global.panel_ui, global.house, ${id}, "${what}"))`];
    assert.equal(h.dev(4).vm.run(code.join("\n"), "z12"), 0, h.dev(4).vm.error());
  };
  const kept = (id) => h.berry(4, `PanelHouseView.password_of(${id})`).v;
  ask(2, "lock");
  h.run(3000);
  const pw = kept(2);
  assert.equal(typeof pw, "string", "the bridge answered, and the panel keeps the password it drew");
  assert.equal(pw.length, 10);
  assert.equal(h.dev(2).webPassword, pw, "the bridge 2 has it");
  ask(2, "unlock");
  h.run(3000);
  assert.equal(kept(2) ?? null, null, "removed: the panel forgets it");
  assert.equal(h.dev(2).webPassword, "", "and so does the bridge");
  // the reset of the bridge 3: it leaves the house, and the panels strike it off
  ask(3, "factory");
  let gone = false;
  for (let t = 0; t < 20_000 && !gone; t += 1000) {
    h.run(1000);
    gone = h.berry(4, "global.house.list.revoked(3)").v === true;
  }
  assert.ok(gone, "the bridge 3 left the house by itself, and was struck off");
  let five = false;
  for (let t = 0; t < 20_000 && !five; t += 1000) {
    h.run(1000);
    five = h.berry(5, "global.house.list.revoked(3)").v === true;
  }
  assert.ok(five, "on the panel 5 too, by the list");
});

test("the house's MQTT, saved on the panel 4, is taken by every node of the house over the mesh", async () => {
  const h = await whole(REAL);
  h.run(20_000);
  const save = '{"host": "192.168.2.50", "port": 1884, "user": "ha", "password": "secret123", "discovery": true, "expire": 24}';
  assert.equal(h.dev(4).vm.run(`import global\nimport json\nglobal.panel_ui.mqtt.run("save", [json.load('${save}')])`, "z13"), 0, h.dev(4).vm.error());
  const on = (id) => h.dev(id).mqtt.host === "192.168.2.50";
  let all = false;
  for (let t = 0; t < 60_000 && !all; t += 1000) {
    h.run(1000);
    all = [1, 2, 3, 4, 5].every(on);
  }
  assert.ok(all, "every node is on the house's broker: " + JSON.stringify([1, 2, 3, 4, 5].map((id) => h.dev(id).mqtt.host)));
  for (const id of [1, 2, 3, 4, 5]) {
    const m = h.dev(id).mqtt;
    assert.deepEqual([m.port, m.user, m.password], [1884, "ha", "secret123"], `the node ${id} has the port, the user and the password`);
  }
});

test("the alarm's configuration, set on the panel 4, is the house's: the bridge that owns the sensor takes it, every bridge the times, the panel 5 shows it", async () => {
  const h = await whole(REAL);
  h.dev(2).zigbee.add(spec(DOOR));
  h.run(20_000);
  // the door is a device of the bridge 2's network, which the panel 4 shows; the panel's screens say the sensor's role and the exit time
  const set = `import global
var s = global.panel_ui.store
s.register_device(["${DOOR}", "Front door", "sensor", 0, 0, 0, "", 1, 0, 0])
s.set_owner("${DOOR}", 2)
global.panel_ui.network.emit([["alarm", {"do": "sensor", "id": "${DOOR}", "role": "perimeter", "notify": "house"}], ["alarm", {"do": "times", "exit": 45}]])`;
  assert.equal(h.dev(4).vm.run(set, "z14"), 0, h.dev(4).vm.error());
  const cfg = (id) => JSON.parse(h.berry(id, "json.dump(global.zbbridge_relay.alarm.cfg)").v);
  const screens = (id) => JSON.parse(h.berry(id, "json.dump(global.panel_ui.network.alarm.cfg)").v);
  let done = false;
  for (let t = 0; t < 60_000 && !done; t += 1000) {
    h.run(1000);
    done = [1, 2, 3].every((id) => cfg(id).times[0] === 45) && cfg(2).sensors[DOOR] !== undefined && screens(5).sensors[DOOR] !== undefined;
  }
  assert.ok(done, "every bridge has the exit time, the bridge 2 the sensor, the panel 5 shows it: " + JSON.stringify([1, 2, 3].map((id) => cfg(id).times)));
  assert.deepEqual(cfg(2).sensors[DOOR], { role: "perimeter", notify: "house" }, "the bridge 2's alarm has the door as the house says it");
  assert.deepEqual([cfg(1).sensors[DOOR], cfg(3).sensors[DOOR]], [undefined, undefined], "and the other bridges do not");
  assert.equal(screens(5).sensors[DOOR][0], "perimeter", "the panel 5's screens show the door's role");
  assert.ok(h.berry(2, "json.dump(global.zbbridge_relay.alarm.events)").v.includes('"config"'), "the bridge 2 says how the house is guarded changed");
  // a word to the bridge 2's own alarm that sets it would last until the house's next change: refused
  h.berry(2, `global.zbbridge_relay.alarm_cmd('{"do": "sensor", "id": "${DOOR}", "role": "off"}')`);
  assert.equal(cfg(2).sensors[DOOR].role, "perimeter", "the bridge keeps the house's");
  // the door removed from the house by the panel 4: it leaves the alarm of the bridge 2 too
  assert.equal(h.dev(4).vm.run(`import global\nglobal.panel_ui.network.emit([["leaveAt", "${DOOR}", 2]])`, "z14b"), 0, h.dev(4).vm.error());
  let gone = false;
  for (let t = 0; t < 30_000 && !gone; t += 1000) {
    h.run(1000);
    gone = cfg(2).sensors[DOOR] === undefined && screens(5).sensors[DOOR] === undefined;
  }
  assert.ok(gone, "the door is out of the bridge 2's alarm and the panel 5's screens");
});
