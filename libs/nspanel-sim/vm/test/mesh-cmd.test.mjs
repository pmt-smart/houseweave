// The commands of the house over the mesh (berry/mesh_cmd.be, MeshCmd), end to end: two bridges on one mesh air
// (src/mesh-driver.ts), each with the repo's own Berry brain booted, the relay of each holding a MeshCmd. One bridge sends a line of the bridge's vocabulary to the node that
// owns the device, with the stamp of the mesh's clock; the owner admits it (the stamp, the age at the moment of executing, K, the order) and runs it as the link's.
//
//   MC1  a command from one bridge is run at the other, as its own, and the sender is told it was confirmed
//   MC2  a node that is not synced has no stamp: it sends nothing, and says so; when it syncs it sends
//   MC3  an old stamp is refused by the owner by the age: 3 s for a command, 1 s for the alarm's words, a stamp from the future past the clocks' error too
//   MC4  a stamp of another timeline is refused
//   MC5  the alarm's word over the mesh arms the owner's alarm, and the house's replica takes it to the others
//   MC6  a command to a node that is cut off is not confirmed: the sender is told false, and nothing was run
import { test } from "node:test";
import assert from "node:assert/strict";
import { meshIsolate, meshHeal } from "../dist/index.js";
import { meshHouse } from "./mesh-world.mjs";

const LAMP = `ZbSend {"Device":"0x00124B0000AA000A","Send":{"Power":1}}`;

/** the Berry a bridge is given: what its MeshCmd ran (instead of the Zigbee side), the sends, the answers, the refusals, the alarm's state */
const PROBES = `
import json
import global
def mc() return global.zbbridge_relay.meshcmd end
def mc_start()
  global._ran = []
  global._ans = []
  mc().run_fn = def (l) global._ran.push(l) end
  return "ok"
end
def mc_unhook() mc().run_fn = nil return "ok" end
def mc_ran() var r = global._ran global._ran = [] return json.dump(r) end
def mc_answers() var r = global._ans global._ans = [] return json.dump(r) end
def mc_send(arg)
  var m = json.load(arg)
  var t = mc().send(m["dest"], m["line"], def (ok) global._ans.push(ok) end)
  return json.dump({"t": t, "why": mc().why})
end
def mc_state() return json.dump({"refused": mc().refused, "executed": mc().executed, "up": mc().up}) end
def al_st() return global.zbbridge_relay.alarm.st end
`;

async function house() {
  const h = await meshHouse({ bridges: [1, 2], panels: [] });
  for (const id of h.ids) h.berry(id, "espnow_mesh_ready()");
  const install = (id) => assert.equal(h.dev(id).vm.run(PROBES, "mc-probes"), 0, h.dev(id).vm.error());
  h.run(300);
  for (const id of h.ids) {
    install(id);
    h.dev(id).vm.call("mc_start", "");
  }
  const H = {
    ...h,
    state: (id) => JSON.parse(h.dev(id).vm.call("mc_state", "")),
    ran: (id) => JSON.parse(h.dev(id).vm.call("mc_ran", "")),
    answers: (id) => JSON.parse(h.dev(id).vm.call("mc_answers", "")),
    send: (id, dest, line) => JSON.parse(h.dev(id).vm.call("mc_send", JSON.stringify({ dest, line }))),
    alarm: (id) => h.dev(id).vm.call("al_st", ""),
    /** a device loses its power and boots again: its probes loaded again */
    async power(id, ms = 0) {
      await h.power(id, ms);
      h.run(300);
      install(id);
      h.dev(id).vm.call("mc_start", "");
      return h.dev(id);
    },
  };
  return H;
}

test("a command from one bridge is run at the other, as its own, and the sender is told it was confirmed", async () => {
  const h = await house();
  h.run(40_000);
  assert.deepEqual([h.state(1).up, h.state(2).up], [true, true], "both MeshCmd started with the mesh");
  const r = h.send(2, 1, LAMP);
  assert.ok(r.t, `sent: ${JSON.stringify(r)}`);
  h.run(500);
  assert.deepEqual(h.ran(1), [LAMP], "the owner ran the line");
  assert.deepEqual(h.answers(2), [true], "and the sender was told the mesh confirmed it");
  assert.equal(h.state(1).executed, 1);
  // the other way, and a second
  h.send(1, 2, `ZbSend {"Device":"0x00124B0000BB0001","Send":{"Power":0}}`);
  h.run(500);
  assert.deepEqual(h.ran(2), [`ZbSend {"Device":"0x00124B0000BB0001","Send":{"Power":0}}`], "the other way too");
  assert.deepEqual(Object.values(h.state(1).refused), [0, 0, 0, 0, 0, 0], "nothing was refused at the owner");
});

test("a node that is not synced has no stamp: it sends nothing, and says so; when it syncs it sends", async () => {
  const h = await house();
  h.run(40_000);
  await h.power(1, 0);
  h.run(1500);
  const r = h.send(1, 2, LAMP);
  assert.deepEqual([r.t, r.why], [false, "not synced"], "a node that just restarted knows no time: no stamp, nothing sent");
  assert.deepEqual(h.ran(2), [], "and nothing arrived");
  h.run(30_000);
  const again = h.send(1, 2, LAMP);
  assert.ok(again.t, `synced, it sends: ${JSON.stringify(again)}`);
  h.run(500);
  assert.deepEqual(h.ran(2), [LAMP]);
});

test("an old stamp is refused by the owner by the age: 3 s, 1 s for the alarm's words, and a stamp from the future past the error", async () => {
  const h = await house();
  h.run(40_000);
  const body = (line) => `bytes().fromstring(${JSON.stringify(line)})`;
  const old = (ticks, line) => h.berry(2, `mt_send_stamped(1, mt_stamp_shift(${ticks}), ${body(line)})`);
  assert.ok(old(-250, LAMP).v, "a stamp 2.5 s old is sent");
  h.run(400);
  assert.deepEqual(h.ran(1), [LAMP], "and run: inside the window of 3 s");
  old(-450, LAMP);
  h.run(400);
  assert.deepEqual(h.ran(1), [], "4.5 s old: refused");
  assert.equal(h.state(1).refused.stale, 1);
  old(-150, 'ZbRelayAlarm {"do":"disarm"}');
  h.run(400);
  assert.deepEqual(h.ran(1), [], "1.5 s old and the alarm's word: past its window of a second");
  assert.equal(h.state(1).refused.stale, 2);
  old(-80, 'ZbRelayAlarm {"do":"disarm"}');
  h.run(400);
  assert.deepEqual(h.ran(1), ['ZbRelayAlarm {"do":"disarm"}'], "0.8 s old: inside it");
  old(50, LAMP);
  h.run(400);
  assert.deepEqual(h.ran(1), [], "half a second in the future: past the 250 ms of the clocks' error");
  assert.equal(h.state(1).refused.stale, 3);
});

test("a stamp of another timeline is refused", async () => {
  const h = await house();
  h.run(40_000);
  h.berry(2, `mt_send_stamped(1, mt_stamp_tag(), bytes().fromstring(${JSON.stringify(LAMP)}))`);
  h.run(400);
  assert.deepEqual(h.ran(1), [], "the tag of the stamp is not this node's timeline: nothing run");
  assert.equal(h.state(1).refused.sync, 1);
});

test("the alarm's word over the mesh arms the owner's alarm, and the house's replica takes it to the others", async () => {
  const h = await house();
  h.run(40_000);
  h.dev(1).vm.call("mc_unhook", "");
  assert.equal(h.alarm(1), "disarmed");
  h.send(2, 1, 'ZbRelayAlarm {"do": "arm", "mode": "away", "by": "panel"}');
  h.run(3000);
  assert.ok(["arming", "armed_away"].includes(h.alarm(1)), `the owner's alarm armed: ${h.alarm(1)}`);
  h.run(8000);
  assert.ok(["arming", "armed_away"].includes(h.alarm(2)), `and the replica took it to the other bridge: ${h.alarm(2)}`);
});

test("a command to a node that is cut off is not confirmed: the sender is told false, and nothing was run", async () => {
  const h = await house();
  h.run(40_000);
  meshIsolate(h.home, 1);
  const r = h.send(2, 1, LAMP);
  assert.ok(r.t, "the mesh takes the send");
  h.run(2000);
  assert.deepEqual(h.answers(2), [false], "the mesh gave it up: the sender is told");
  assert.deepEqual(h.ran(1), [], "and nothing was run at the node that was cut off");
  meshHeal(h.home);
});
