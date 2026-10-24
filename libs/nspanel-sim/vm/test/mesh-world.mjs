// The world of the mesh tests (mesh-house.test.mjs): a house of bridges and panels that carry the ESP-NOW mesh driver of the firmware (src/mesh-driver.ts), each
// with the repo's Berry brain booted, and the Berry script the tests load on each device. A test that is about what the brain does with the mesh (the alarm's
// replica, the house layer) takes its house from here, loads its own script after this one, and reads what the rules were told as JSON.
//
//   const h = await meshHouse();                       // bridges 1 to 3 and panels 4 and 5, the mesh on, the application not ready
//   const h = await meshHouse({ virgin: [1, 2, 3, 4, 5] }); // the same devices, none in a house yet: no key, no nodes, the mesh off
//   const h = await meshHouse({ factory: [1, 4] });   // the bridge 1 and the panel 4 from their box: the driver in the image and no number either (the browser's bench image)
//   for (const id of h.ids) h.berry(id, "espnow_mesh_ready()");
//   h.run(40_000);                                     // the house's clock, ms: the nodes need some 10 to 30 s to know each other
//   h.berry(1, 'send_cmd(3, bytes().fromstring("on"))')  // a Berry expression on a device: {"v": value} or {"raise": error}
//   h.read(3)                                          // what the rules of the device 3 were told and what it ran (the script's `mt`)
//   await h.power(2, 3000)                             // the device 2 loses its power for 3 s and boots again; its script is loaded again
//   h.devices.get(id).vm.run(source, name)             // more Berry on a device, as the other tests of this package load theirs
import assert from "node:assert/strict";
import { SimHouse, SimBridge, SimPanel, MeshRecord, powerFailure } from "../dist/index.js";
import { bridgeFiles, repoFiles, livingRoomConfig } from "../dist/files-node.js";

export const KEY = "00112233445566778899AABBCCDDEEFF00112233445566778899AABBCCDDEEFF";
export const PROJECT = "p1-living-room-eu-landscape";
export const EPOCH = Date.UTC(2026, 9, 12, 12, 0, 0) / 1000;
export const RECORD = "espnowmesh/settings";

// The Berry the tests load on a device. The functions that the clock.md of the clock work gives (send_cmd and the rule that runs a command at its owner, with K = 16
// and the window of 3 s, or 1 s for a sensitive one) are copied as they are there; the rest keeps what the rules were told, for the test to read as JSON.
export const SCRIPT = `
import global
import json
var mt = {"frames": [], "outcomes": [], "timelines": [], "synced": [], "notices": [], "ran": [], "refused": []}
var is_sensitive = false
def mt_try(f)
  try
    var r = f()
    if isinstance(r, bytes) r = r.tohex() end
    return json.dump({"v": r})
  except .. as e, m
    return json.dump({"raise": e})
  end
end
def send_cmd(dest, body)
  var st = espnow_mesh_stamp()
  if !st return false end
  return espnow_mesh_send(dest, 0, true, st + body)
end
def mt_send_stamped(dest, st, body)
  return espnow_mesh_send(dest, 0, true, st + body)
end
def mt_stamp_shift(ticks)
  var s = espnow_mesh_stamp()
  s.set(2, s.get(2, -4) + ticks, -4)
  return s
end
def mt_sensitive(on) is_sensitive = on return true end
def mt_stamp_tag()
  var s = espnow_mesh_stamp()
  s[0] = s[0] ^ 1
  return s
end
var mt_kept = nil
tasmota.add_rule("EspNowMesh", def (f)
  if !f.contains('Data') || f['Type'] != 0 return end
  mt["frames"].push(f)
  if (f['Flags'] & 2) != 0 return end          # a resend: executed once
  if f['Behind'] > 16 mt["refused"].push("behind") return end
  var d = bytes(f['Data'])
  if size(d) < 6 return end
  var a = espnow_mesh_age(d[0..5])             # read NOW
  if a == false || !a['synced'] || !a['tag'] mt["refused"].push("tag") return end
  var window = is_sensitive ? 1000 : 3000
  if a['age'] > window || a['age'] < -250 mt["refused"].push("age") return end
  mt["ran"].push({"from": f['From'], "body": d[6..].asstring(), "age": a['age']})
end)
tasmota.add_rule("EspNowMesh#Outcome", def (v) mt["outcomes"].push(v) end)
tasmota.add_rule("EspNowMesh#Timeline", def (v) mt["timelines"].push(v) end)
tasmota.add_rule("EspNowMesh#Synced", def (v) mt["synced"].push(v) end)
tasmota.add_rule("EspNowMesh#Notice", def (v) mt["notices"].push(v) end)
def mt_dump() return json.dump(mt) end
def mt_keep() mt_kept = espnow_mesh_stamp() return true end
def mt_send_kept(dest, body) return espnow_mesh_send(dest, 0, true, mt_kept + body) end
`;

/**
 * A house of bridges and panels with a mesh: each device boots with the driver in its image, a node number and the network's key, the mesh on, the
 * application not ready (as with Berry running), and the test's script loaded. `run(ms)` is the house's clock; `power` is a device that loses its power.
 */
export async function meshHouse({ bridges = [1, 2, 3], panels = [4, 5], air, links, at, network, virgin = [], factory = [] } = {}) {
  const home = new SimHouse();
  const net = await home.enableMesh({ air, links });
  const logs = [];
  const devices = new Map();
  const label = (id) => (bridges.includes(id) ? "b" : "p") + id;
  const onLog = (id) => (level, line) => {
    if (line.startsWith("EMH:") || level === 1 || process.env.MESH_DEBUG) logs.push({ at: home.now, who: label(id), line });
  };
  const mac = (id) => `A0:B7:65:${bridges.includes(id) ? "77" : "00"}:00:${id.toString(16).padStart(2, "0")}`;
  const ip = (id) => `192.168.0.${(bridges.includes(id) ? 60 : 70) + id}`;
  // the mesh option of a device: in the house with the key, or (the ids in `virgin`) not in a house yet: its number and nothing else, or (the ids in `factory`)
  // from its box: no number either, as a flash with no record of the mesh; the test's id is then only its name here, and the house gives it its number
  const mesh = (id) => (factory.includes(id) ? { id: 0, at: at?.(id), network } : virgin.includes(id) ? { id, at: at?.(id), network } : { id, groupKey: KEY, at: at?.(id), network });
  const makeBridge = (id, extra = {}) => SimBridge.create({ house: home, files: bridgeFiles(), mac: mac(id), ip: ip(id), hostname: `zbbridge-${id}`, epoch: EPOCH, mesh: mesh(id), onLog: onLog(id), ...extra });
  const makePanel = (id, extra = {}) => SimPanel.create({
    house: home, files: repoFiles(PROJECT), project: PROJECT, mac: mac(id), ip: ip(id), persist: { panel_config: livingRoomConfig() },
    relays: [true, true], epoch: EPOCH, timezone: 0, mesh: mesh(id), onLog: onLog(id), onUart: () => {}, ...extra,
  });
  const inject = (dev) => assert.equal(dev.vm.run(SCRIPT, "mesh-test"), 0, dev.vm.error());
  const h = {
    home, net, air: net.air, logs, devices,
    dev: (id) => devices.get(id),
    run: (ms) => home.advance(ms),
    /** a Berry expression's value on a device, as JSON: {v} or {raise} */
    berry(id, expr) {
      const dev = devices.get(id);
      assert.equal(dev.vm.run(`def mt_p() return mt_try(/ -> ${expr}) end`, "probe"), 0, dev.vm.error());
      return JSON.parse(dev.vm.call("mt_p"));
    },
    /** what the rules of a device were told, and what it ran */
    read: (id) => JSON.parse(devices.get(id).vm.call("mt_dump")),
    cmd: (id, line) => JSON.parse(devices.get(id).console(line)),
    status: (id) => JSON.parse(devices.get(id).console("EspNowMeshStatus")).EspNowMeshStatus,
    /** the mesh time of a node in ms, from the air: the same clock Berry reads */
    mesh: (id) => net.air.clock(id).mesh,
    ids: [...bridges, ...panels],
    /** a device loses its power for `ms` and boots again from its flash; its script is loaded again */
    async power(id, ms = 0) {
      const dev = await powerFailure(home, devices.get(id), ms);
      devices.set(id, dev);
      inject(dev);
      return dev;
    },
  };
  for (const id of bridges) devices.set(id, await makeBridge(id));
  for (const id of panels) devices.set(id, await makePanel(id));
  for (const dev of devices.values()) inject(dev);
  return h;
}

export const tlHex = (b) => Buffer.from(b).toString("hex").toUpperCase();
export const record = (dev) => MeshRecord.decode(Uint8Array.from(Buffer.from(dev.nvm[RECORD], "hex")));

