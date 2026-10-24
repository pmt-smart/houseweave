// The world of the tests of the house layer (house-mesh.test.mjs, house-key.test.mjs): a house of bridges 1 to 3 and panels 4 and 5 on one mesh air (mesh-world.mjs), each device with the
// repo's Berry brain booted and a HouseMesh (berry/house_mesh.be) made in it, as the pairing of a node that comes into the house will make one.
//
//   const h = await house();              // the mesh on, the list of every node empty
//   await founded(h);                     // panel 4 founds the house, writes panel 5 into it, and every other node is given that state, as the pairing gives it
//   bridges(h);                           // panel 4 writes the three bridges (the others take them by the digests)
//   h.berry(4, "hm.list.digest()")        // a Berry expression on a device, as mesh-world.mjs has it: {"v"} or {"raise"}
import assert from "node:assert/strict";
import { meshHouse } from "./mesh-world.mjs";

export const BRIDGE = 1;
export const PANEL = 2;

// what a test hands over between two nodes, as the pairing will: the pieces of a welcome as hex, and the pieces given to the node that comes into the house
const HELPERS = `
def mt_welcome(id)
  var l = hm.welcome(id)
  if l == nil return nil end
  var out = []
  for p: l out.push(p.tohex()) end
  return out
end
def mt_accept(l)
  var ps = []
  for h: l ps.push(bytes(h)) end
  return hm.accept(ps)
end
`;

/** a house of bridges 1 to 3 and panels 4 and 5, each with its HouseMesh (`hm`) made in the Berry of the device; `load(id)` makes it again (after a device lost its power) */
export async function house(opt = {}) {
  const h = await meshHouse(opt);
  h.load = (id) => {
    const dev = h.dev(id);
    const role = h.ids.indexOf(id) < 3 ? BRIDGE : PANEL;
    // a bridge that has just started has its relay a few seconds later, and a panel its boot's house layer
    const there = role === BRIDGE ? "global.contains('zbbridge_relay') && global.zbbridge_relay != nil" : "global.contains('house') && global.house != nil";
    for (let i = 0; i < 30 && h.berry(id, there).v !== true; i++) h.run(1000);
    // a bridge has its HouseMesh since its relay started, and a panel since its boot (global.house)
    const code = `import json\nimport global\nvar hm = ${role === BRIDGE ? "global.zbbridge_relay.house" : "global.house"}\n${HELPERS}`;
    assert.equal(dev.vm.run(code, "house"), 0, dev.vm.error());
    h.berry(id, "espnow_mesh_ready()");
  };
  h.run(5000);                                   // the relay of a bridge is started: it holds the house's layer
  for (const id of h.ids) h.load(id);
  h.run(45_000);
  return h;
}

export const hex = (s) => s.replace(/:/g, "");

/** the identity of a device as the driver says it: its key and its radio address, as hex */
export const who = (h, id) => {
  const p = h.cmd(id, "EspNowMeshPublic").EspNowMeshPublic;
  return { key: p.Public, mac: hex(p.Mac) };
};
export const digest = (h, id) => h.berry(id, "hm.list.digest()").v;
export const ids = (h, id) => h.berry(id, "hm.list.ids(false)").v;
export const nameOf = (h, id, n) => h.berry(id, `hm.list.node(${n}) == nil ? nil : hm.list.node(${n})['name']`).v;

/** panel 4 founds the house and writes panel 5 into it, and the other nodes are given what it holds, as the pairing gives it; the bridges are written afterwards */
export async function founded(h) {
  assert.equal(h.berry(4, "hm.found('Cottage')").v, true, "the first panel founds the house");
  // half a second on, the panel on a network gives the house its channel (berry/house_channel.be), and the first state has it
  h.run(1000);
  const p5 = who(h, 5);
  assert.equal(h.berry(4, `hm.add_node(2, bytes('${p5.key}'), bytes('${p5.mac}'), nil, 'Den panel 5', 5)`).v, 5);
  const state = h.berry(4, "json.dump(hm.list.to_map())").v;
  for (const id of [1, 2, 3, 5]) assert.equal(h.berry(id, `hm.adopt(json.load('${state}'))`).v, true, `node ${id} is given the state`);
  h.run(3000);
}

/** panel 4 writes the three bridges, with their addresses */
export function bridges(h) {
  for (const id of [1, 2, 3]) {
    const w = who(h, id);
    assert.equal(h.berry(4, `hm.add_node(1, bytes('${w.key}'), bytes('${w.mac}'), bytes('c0a800${60 + id}'), 'Bridge ${id}', ${id})`).v, id);
  }
}

/** the house with its five nodes in every list, settled */
export async function whole(opt = {}) {
  const h = await house(opt);
  await founded(h);
  bridges(h);
  h.run(30_000);
  return h;
}

/** the house made as it will be made: no node is in it, panel 4 founds it, and each of the others is written into the list by it and given what it needs (the number, the key and the list: the pairing's), in the order of `order` */
export async function paired(opt = {}, order = [5, 1, 2, 3]) {
  const h = await house({ virgin: [1, 2, 3, 4, 5], ...opt });
  assert.equal(h.berry(4, "hm.found('Cottage')").v, true, "the first panel founds the house, and draws its key");
  h.run(3000);
  for (const id of order) await bring(h, id, 4);
  h.run(40_000);
  return h;
}

/** panel `by` writes node `id` into the list and gives it the welcome: the node is in the house */
export async function bring(h, id, by) {
  const w = who(h, id);
  const role = h.ids.indexOf(id) < 3 ? BRIDGE : PANEL;
  const ip = "c0a800" + ((role === BRIDGE ? 60 : 70) + id).toString(16).padStart(2, "0");
  assert.equal(h.berry(by, `hm.add_node(${role}, bytes('${w.key}'), bytes('${w.mac}'), bytes('${ip}'), '${role === BRIDGE ? "Bridge" : "Den panel"} ${id}', ${id})`).v, id);
  const pieces = h.berry(by, `mt_welcome(${id})`).v;
  assert.ok(Array.isArray(pieces) && pieces.length >= 1, `panel ${by} has a welcome for ${id}`);
  assert.equal(h.berry(id, `mt_accept(json.load('${JSON.stringify(pieces)}'))`).v, true, `node ${id} takes it`);
  h.run(3000);
}
