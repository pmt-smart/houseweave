// The devices of another room's bridge, for the + of a zone (berry/house_devices.be, berry/panel_store.be add_remote_device), end to end: a house of
// three bridges and two panels on one mesh and on the firmware's own cipher, each with the repo's Berry brain booted. The bridge 2 has seven lamps on its Zigbee network, which the
// panel 4 picks from a page at a time, and one of which it takes into a zone: the bridge then marks it, says its state, and runs what the panel sends.
//
//   Y1  a panel asks a bridge for its devices: the bridge, which had said nothing of them, asks Z2T for the map and answers; the pages, the end of the list and the order
//   Y2  a device taken from the page is the zone's, the bridge's, marked: its state comes and a command goes
//   Y3  a bridge that restarts in the middle of it answers again, from what Z2T says
import { test } from "node:test";
import assert from "node:assert/strict";
import { whole } from "./house-world.mjs";

const REAL = { air: { cipher: "real" } };
const ieee = (n) => `0x00124B0000F2000${n}`;
const spec = (n) => ({ ieee: ieee(n), model: "TS0505B", caps: 3, ct: [0, 0], endpoint: 1, relay: 0 });

// what the panel 4 is given: a store with a zone, the route a command takes, the page asked and what the house says of the lamps it shows
const PANEL = `
import json
import global
global._store = PanelStore(nil)
global._zone = global._store.create_zone("home", "Room", [0, 0], [3, 3])["value"]
global._mc = MeshCmd(nil)
global._route = PanelRoute(global._store, global._mc)
global._got = []
global.house.state.wanted = / -> global._store.remote_by_owner()
global.house.state.deliver = / r -> global._got.push(r)
def mt_page() var c = global.house.devices.current() return json.dump(c) end
def mt_ask(owner, first) global.house.devices.ask(owner, first) return "ok" end
def mt_take(owner, index)
  var c = global.house.devices.current()
  var r = global._store.add_remote_device(global._zone, owner, c[0][index])
  return json.dump(r)
end
def mt_got() var r = global._got global._got = [] return json.dump(r) end
def mt_send(l) return global._route.send(l) end
`;

async function house(lamps = 7) {
  const h = await whole(REAL);
  for (let n = 1; n <= lamps; n++) h.dev(2).zigbee.add(spec(n));
  assert.equal(h.dev(4).vm.run(PANEL, "panel-probes"), 0, h.dev(4).vm.error());
  return {
    ...h,
    page: () => JSON.parse(h.dev(4).vm.call("mt_page", "")),
    take: (owner, index) => JSON.parse(h.berry(4, `mt_take(${owner}, ${index})`).v),
    got: () => JSON.parse(h.dev(4).vm.call("mt_got", "")),
    send: (line) => h.berry(4, `mt_send('${line}')`).v,
  };
}

test("a panel asks a bridge for its devices: it asks Z2T for the map, and answers the pages in order, to the end", async () => {
  const h = await house();
  assert.equal(h.page(), null, "nothing asked, no page");
  h.berry(4, "mt_ask(2, 0)");
  h.run(10_000);
  let [items, first, total] = h.page();
  assert.deepEqual([first, total, items.length], [0, 7, 5], "the first page: five of the seven");
  assert.deepEqual(items.map((i) => i[0]), [1, 2, 3, 4, 5].map(ieee), "in order of the IEEE");
  assert.deepEqual(items[0].slice(1, 3), ["TS0505B", ["L01.1"]], "the model, and the Config as Z2T says it (an on/off dimmable light)");
  h.berry(4, "mt_ask(2, 5)");
  h.run(3000);
  [items, first, total] = h.page();
  assert.deepEqual([first, total, items.map((i) => i[0])], [5, 7, [6, 7].map(ieee)], "the second page: the two that are left, from the map the bridge has now");
  h.berry(4, "mt_ask(2, 7)");
  h.run(3000);
  [items, first, total] = h.page();
  assert.deepEqual([first, total, items.length], [7, 7, 0], "one past the end: no device, and how many there are");
  assert.equal(h.berry(2, "size(global.zbbridge_relay.house.devices.cache)").v, 7);
});

test("a device taken from the page is the zone's and the bridge's, marked: its state comes and a command goes", async () => {
  const h = await house();
  h.berry(4, "mt_ask(2, 0)");
  h.run(10_000);
  const r = h.take(2, 2);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.value, ieee(3));
  assert.equal(h.berry(4, `global._store.owner_of('${ieee(3)}')`).v, 2, "the bridge 2's");
  assert.equal(h.berry(4, `global._store.zone_of('${ieee(3)}')['id']`).v, h.berry(4, "global._zone").v, "in the zone");
  h.run(15_000);
  assert.equal(h.berry(2, `global.zbbridge_relay.house.state.marks[4]['s'].contains('${ieee(3)}')`).v, true, "the bridge has the mark of the panel");
  h.got();
  assert.equal(h.send(`ZbSend {"Device":"${ieee(3)}","Send":{"Power":1}}`), true);
  h.run(3000);
  assert.equal(h.dev(2).zigbee.find(ieee(3)).power, 1, "the lamp of the other room is on");
  const states = h.got().flatMap((x) => Object.entries(x)).filter(([k]) => k === ieee(3)).map(([, v]) => v.Power);
  assert.equal(states.at(-1), 1, "and the panel has its state");
  assert.equal(h.take(2, 2).ok, false, "the same device again is refused: the panel has it");
});

test("a bridge that restarts is asked again, and says what Z2T says", async () => {
  const h = await house(3);
  h.berry(4, "mt_ask(2, 0)");
  h.run(10_000);
  assert.equal(h.page()[2], 3);
  await h.power(2, 3000);
  h.load(2);
  for (let n = 1; n <= 4; n++) h.dev(2).zigbee.add(spec(n));
  h.run(20_000);
  assert.equal(h.berry(2, "size(global.zbbridge_relay.house.devices.cache)").v, 0, "the bridge starts with nothing of the map");
  h.berry(4, "mt_ask(2, 0)");
  h.run(10_000);
  assert.equal(h.page()[2], 4, "and has, after the ask, the four it has now");
});
