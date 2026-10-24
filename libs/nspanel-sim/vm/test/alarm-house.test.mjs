// The alarm's state replicated across bridges, end to end: a house of three bridges and two
// panels on one mesh air (src/mesh-driver.ts), each device with the repo's own Berry brain booted, the bridges' alarm taking its state from the replica
// (berry/zbbridge_alarm.be, berry/zbbridge_alarm_mesh.be, berry/zbbridge_alarm_merge.be) and the mesh core under it compiled to WebAssembly. Nothing of the alarm's
// rule or its transport is imitated: a person arms on one bridge's alarm (the verb the panel's link sends, ZbRelayAlarm) and the other bridges' alarms learn it
// from the frames, the heartbeats' digests and the Timeline events the core hands their Berry. The panels' side is the repo's PanelAlarm, fed what each bridge says
// to the panel it is paired to (the link between them is the relay's, not this file's).
//
//   AH1   the replicas come up as the bridges' numbers, on the mesh's own timeline; the heartbeat carries their digest; a quiet house sends no records
//   AH2   an arm on one bridge reaches the others and the panels' views at once, and every exit time ends at the same instant, counted from the record's mark
//   AH3   a disarm that saw the arm ends it; a disarm and an arm that did not see each other: the later wins, whichever bridge it is
//   AH4   the twelve situations, as scripts on the house (the reference's own, alarm-merge-world.mjs), and the reference's end state
//   AH5   a house cut in two for five minutes, the crystals at +250 and -250 ppm: the later action wins, in both orders
//   AH6   a bridge that restarts while cut off comes back with what its flash held, shows it quietly, and takes the house's later word
//   AH7   the whole house restarts: the timelines re-merge, the state stays, and an action made before they did is the house's
//   AH8   a lone bridge restarted twice while the house moved on: its record is in timelines nothing places, and the safe side decides
//   AH9   an alarm that is cut off still triggers, locally; the others sound when they hear of it, for what is left of the siren's time
//   AH9b  a sensor that trips after the siren's time sounds the alarm again; one that trips while it sounds is the same alarm
//   AH10  a bridge with no alarm number is the one alarm it was; ZbAlarmSlot gives it one and it joins
//   AH11  a bridge that was off while the house armed and disarmed catches up from the digest in its neighbours' heartbeats
//   AH12  the mesh of a bridge stopped: the alarm works on, and the mesh coming back is a new life that takes the house's state
//   AH13  what the replica costs in heap, with 3 and with 15 heads
//   AH14  a bridge that did not hear the flood of an arm has it from the digests in the next heartbeats
//   AH15  random stories from a seed (arms, disarms, cuts, heals, power failures): after the last heal the replicas agree
import { test } from "node:test";
import assert from "node:assert/strict";
import { meshPartition, meshHeal, meshDrift } from "../dist/index.js";
import { meshHouse, tlHex } from "./mesh-world.mjs";
import { SITUATIONS, runScenario, mulberry32 } from "./alarm-merge-world.mjs";

const DOOR = "0x00124B0000AA0001";
const PIR = "0x00124B0000AA0002";
const SIREN = "0x00124B0000AA0009";
const STATES = ["disarmed", "armed_home", "armed_away", "triggered"];

/** the Berry a bridge is given: the alarm's verbs, its view, and what it says to its panel */
const BRIDGE_PROBES = `
import json
import global
def _al() return global.zbbridge_relay.alarm end
def al_do(arg) return json.dump(_al().cmd(json.load(arg))) end
def al_report(arg)
  var m = json.load(arg)
  _al().report(m["id"], m["attrs"])
  return "ok"
end
def al_view()
  var a = _al()
  var heads = []
  var dig = nil
  var tl = nil
  var ctr = nil
  if a.mesh != nil
    for r: a.mesh.rep.heads heads.push(r.tohex()) end
    dig = a.mesh.rep.digest()
    tl = a.mesh.rep.tl.tohex()
    ctr = a.mesh.rep.ctr
  end
  var ev = []
  for e: a.events ev.push([e["y"], e["d"]]) end
  return json.dump({"st": a.st, "mode": a.mode, "cause": a.cause, "klass": a.mesh != nil ? a.klass() : nil, "slot": a.mesh != nil ? a.mesh.rep.id : nil,
                    "heads": heads, "digest": dig, "tl": tl, "ctr": ctr, "sounding": a.sounding, "want": a.want != nil, "events": ev, "up": a.mesh != nil, "no": a.nomesh})
end
def al_tap()
  global._said = []
  _al().tap = def (w) global._said.push(w) end
  return "ok"
end
def al_said()
  var s = global._said
  global._said = []
  return json.dump(s)
end
def al_heap(arg)
  import gc
  var n = int(arg)
  var a = _al()
  gc.collect()
  var before = gc.allocated()
  var recs = []
  for node: 1 .. n
    var v = ZbAlarmMerge.zeros()
    v[node - 1] = 1
    recs.push(ZbAlarmMerge.make(1 + node % 3, ZbAlarmMerge.dot(node, 1), v, a.mesh.rep.tl, 1000 + node, true, 0))
  end
  a.mesh.rep.hear(recs)
  recs = nil
  gc.collect()
  return json.dump({"heads": size(a.mesh.rep.heads), "kept": gc.allocated() - before})
end
def al_baseline()
  import gc
  gc.collect()
  return gc.allocated()
end
`;

/** and a panel: what the bridge it is paired to says, taken as its link would hand it, and what its alarm view shows */
const PANEL_PROBES = `
import json
import global
def pa_feed(arg) return json.dump(global.panel_ui.alarm.alarm.on_message(json.load(arg))) end
def pa_view()
  var al = global.panel_ui.alarm.alarm
  return json.dump({"st": al.st, "mode": al.mode, "cause": al.cause, "events": size(al.events)})
end
`;

/**
 * A house of bridges (and panels) with the alarm probes on each. `links` pairs a panel with the bridge it hears: what the bridge says to its panel goes to
 * that panel's alarm view as the relay's link would hand it. `run` pumps those links every 50 ms.
 */
async function alarmHouse({ bridges = [1, 2, 3], panels = [4, 5], links = [], network } = {}) {
  const h = await meshHouse({ bridges, panels, network });
  const install = (id) => {
    const dev = h.dev(id);
    assert.equal(dev.vm.run(bridges.includes(id) ? BRIDGE_PROBES : PANEL_PROBES, "alarm-probes"), 0, dev.vm.error());
    if (bridges.includes(id)) dev.vm.call("al_tap", "");
  };
  // the relay and its alarm exist after the first turn of each device's loop
  h.run(300);
  for (const id of h.ids) install(id);
  const pump = () => {
    for (const [b, p] of links) {
      const said = JSON.parse(h.dev(b).vm.call("al_said", ""));
      for (const m of said) h.dev(p).vm.call("pa_feed", JSON.stringify(m.ZbAlarm));
    }
  };
  const A = {
    ...h,
    bridges,
    panels,
    install,
    pump,
    /** the house's time moves on, the links carrying what the bridges say */
    run(ms) {
      for (let t = 0; t < ms; t += 50) {
        h.run(Math.min(50, ms - t));
        if (links.length > 0) pump();
      }
    },
    view: (id) => JSON.parse(h.dev(id).vm.call("al_view", "")),
    panel: (id) => JSON.parse(h.dev(id).vm.call("pa_view", "")),
    /** a person's word to a bridge's alarm, as the panel's link says it (ZbRelayAlarm): "arm_away", "arm_home", "disarm" */
    act(id, word, by = "panel") {
      const m = word === "disarm" ? { do: "disarm", by } : { do: "arm", mode: word === "arm_home" ? "home" : "away", by };
      return JSON.parse(h.dev(id).vm.call("al_do", JSON.stringify(m)));
    },
    /** the alarm's sensors and its siren on a bridge: the door one comes in by, a motion sensor inside, and a siren */
    setup(id) {
      for (const m of [{ do: "sensor", id: DOOR, role: "perimeter", entry: true, notify: "house" }, { do: "sensor", id: PIR, role: "interior" }, { do: "siren", id: SIREN },
        { do: "times", exit: 30, entry: 30, siren: 300 }]) h.dev(id).vm.call("al_do", JSON.stringify(m));
    },
    /** a sensor's report to a bridge's alarm */
    report(id, ieee, attrs) {
      h.dev(id).vm.call("al_report", JSON.stringify({ id: ieee, attrs }));
    },
    /** a device loses its power for `ms` and boots again: its probes loaded again */
    async power(id, ms = 0) {
      await h.power(id, ms);
      h.run(300);
      install(id);
      return h.dev(id);
    },
    /** the state every bridge shows, by the replica's class */
    states: () => bridges.map((id) => (A.view(id).klass === null ? "none" : STATES[A.view(id).klass])),
    /** whether every bridge holds the same heads, and that they say `want` */
    agree(want) {
      const views = bridges.map((id) => A.view(id));
      const digests = new Set(views.map((v) => v.digest));
      assert.equal(digests.size, 1, `every replica holds the same heads: ${JSON.stringify(views.map((v) => [v.slot, v.digest, v.heads.length]))}`);
      assert.deepEqual(views.map((v) => STATES[v.klass]), bridges.map(() => want), `every bridge shows ${want}`);
      assert.ok(views.every((v) => !v.want), "nothing wanted and not recorded");
      if (want !== "triggered") assert.ok(views.every((v) => !v.sounding), "no siren");
    },
  };
  return A;
}

/** the record frames a device was told of by the mesh: [type, message, count] of each */
function recordFrames(dev) {
  const out = [];
  for (const line of dev.mesh.told) {
    const m = /"Type":(\d+),"Dest":\d+,"Counter":\d+,"Epoch":\d+,"Rssi":-?\d+,"Flags":\d+,"Part":\d+,"Joins":\d+,"Behind":\d+,"Data":"(10[0-9A-F]*)"/.exec(line);
    if (m) out.push([Number(m[1]), m[2].slice(0, 2), parseInt(m[2].slice(4, 6), 16)]);
  }
  return out;
}

/** every bridge holds the same state in the house at the start: the replicas are up and know each other, and `state` is what they hold */
async function baseline(h, state) {
  h.run(20_000);
  if (state === "armed_away") {
    h.act(1, "arm_away");
    h.run(40_000);
  } else if (state === "armed_home") {
    h.act(1, "arm_home");
    h.run(40_000);
  } else if (state === "disarmed-record") {
    h.act(1, "arm_away");
    h.run(2000);
    h.act(1, "disarm");
    h.run(10_000);
  } else {
    h.run(2000);
  }
  h.agree(state === "disarmed-record" ? "disarmed" : state);
}

// =====================================================================================================================================
// AH1. the replicas come up
// =====================================================================================================================================

test("the replicas come up as the bridges' numbers, on the mesh's own timeline; the heartbeats carry their digest; a quiet house sends no records", async () => {
  const h = await alarmHouse();
  assert.equal(h.view(1).up, false, "the mesh is not running in the first moments, and the replica is not built");
  h.run(40_000);
  for (const id of h.bridges) {
    const v = h.view(id);
    assert.deepEqual([v.up, v.slot, v.heads, v.st, v.mode], [true, id, [], "disarmed", null], `bridge ${id}: the replica is up as alarm ${id}, with no heads`);
    assert.equal(v.tl, tlHex(h.net.air.clock(id).timeline), `bridge ${id}: its timeline is the mesh's: the mesh's number and its epoch`);
  }
  // the heartbeats: a bridge's 32 bytes, the layout, the timeline, the digest of no heads (FNV-1a's offset) and the flags: synced and no head
  const n = h.berry(1, "espnow_mesh_neighbors()").v;
  const two = n.find((x) => x.id === 2);
  const four = n.find((x) => x.id === 4);
  assert.equal(two.info.length, 64, "a bridge's heartbeat carries 32 bytes");
  assert.equal(two.info.slice(0, 2), "01", "the layout");
  assert.equal(two.info.slice(24, 32), "811C9DC5", "the digest of no heads");
  assert.equal(two.info.slice(38, 40), "01", "synced, no heads");
  assert.equal(two.info.slice(40), "00".repeat(12), "and the house layer's bytes are zeros");
  assert.equal(four.info.length, 64, "a panel has no replica, and has the house layer: the 32 bytes");
  assert.equal(four.info.slice(24, 38), "00".repeat(7), "no replica: no digest and no heads");
  assert.equal(four.info.slice(40), "00".repeat(12), "and the house layer says nothing yet: no house is founded");
  // a quiet house says nothing: no digest differs, so no record is sent
  for (const id of h.bridges) assert.deepEqual(recordFrames(h.dev(id)), [], `bridge ${id}: no record frame in a house with no heads`);
  h.run(60_000);
  for (const id of h.bridges) assert.deepEqual(recordFrames(h.dev(id)), [], `bridge ${id}: and none a minute later`);
});

// =====================================================================================================================================
// AH2. an arm reaches the others
// =====================================================================================================================================

test("an arm on one bridge reaches the others and the panels' views at once, as one frame; every exit time ends at the same instant, counted from the record's mark", async (t) => {
  const h = await alarmHouse({ links: [[1, 4], [2, 5]] });
  h.run(40_000);
  assert.deepEqual([h.panel(4).st, h.panel(5).st], ["disarmed", "disarmed"], "the panels' alarm views start disarmed");
  const t0 = h.home.now;
  assert.equal(h.act(3, "arm_away"), true, "the person arms on the bridge 3, which has no panel of its own");
  const seen = {};
  for (let ms = 0; ms < 2000 && Object.keys(seen).length < 5; ms += 10) {
    h.run(10);
    for (const id of h.bridges) if (!(id in seen) && h.view(id).st === "arming") seen[id] = h.home.now - t0;
    for (const id of h.panels) if (!(id in seen) && h.panel(id).st === "arming") seen[id] = h.home.now - t0;
  }
  assert.deepEqual(Object.keys(seen).sort(), ["1", "2", "3", "4", "5"], "the three bridges and the two panels show the arm");
  assert.ok(Math.max(...Object.values(seen)) <= 300, `all of them within ${Math.max(...Object.values(seen))} ms: ${JSON.stringify(seen)}`);
  const v = h.bridges.map((id) => h.view(id));
  assert.deepEqual(v.map((x) => x.heads.length), [1, 1, 1], "one record on each");
  assert.equal(new Set(v.map((x) => x.heads[0])).size, 1, "the same record, byte for byte");
  assert.deepEqual(v.map((x) => x.events.map((e) => e[0])), [["arm"], ["arm"], ["arm"]], "an arm event each, and no other");
  assert.deepEqual(v.map((x) => x.events[0][1]), ["bridge 3", "bridge 3", "panel"], "told as bridge 3's where it came from the mesh, and as the panel's where the person asked");
  assert.deepEqual([h.panel(4).mode, h.panel(5).mode, h.panel(4).events, h.panel(5).events], ["away", "away", 1, 1], "the panels' views: armed away, and the arm in their lists");
  // the frame: one record, to everyone, as an event (type 3), and nothing else for the arm
  for (const id of [1, 2]) assert.deepEqual(recordFrames(h.dev(id)), [[3, "10", 1]], `bridge ${id} was told by one frame of type 3 with one record`);
  // the exit time: 30 s from the mark, on every bridge, ending together
  const ends = {};
  for (let ms = 0; ms < 31_000 && Object.keys(ends).length < 3; ms += 10) {
    h.run(10);
    for (const id of h.bridges) if (!(id in ends) && h.view(id).st === "armed_away") ends[id] = h.home.now - t0;
  }
  const times = Object.values(ends);
  assert.equal(times.length, 3, "the exit time ended on every bridge");
  assert.ok(Math.max(...times) - Math.min(...times) <= 80, `within ${Math.max(...times) - Math.min(...times)} ms of each other: ${JSON.stringify(ends)}`);
  assert.ok(Math.min(...times) >= 29_950 && Math.max(...times) <= 30_300, `30 s after the arm, as counted from the record's mark: ${JSON.stringify(ends)}`);
  assert.deepEqual([h.panel(4).st, h.panel(5).st], ["armed_away", "armed_away"], "and the panels' views follow");
  h.agree("armed_away");
  h.run(60_000);
  for (const id of [1, 2]) assert.equal(recordFrames(h.dev(id)).length, 1, `bridge ${id}: no record frame after the first: the digests agree`);
  t.diagnostic(`an arm on the bridge 3 was on the others in ${JSON.stringify(seen)} ms, and the exit time ended at ${JSON.stringify(ends)} ms`);
});

// =====================================================================================================================================
// AH3. which word wins
// =====================================================================================================================================

test("a disarm that saw the arm ends it, on every bridge and panel; a disarm and an arm that did not see each other: the later wins, whichever bridge it is", async () => {
  // the arm on A, then the disarm on C, 40 s later: the disarm descends from the arm
  const h = await alarmHouse({ links: [[1, 4], [2, 5]] });
  h.run(40_000);
  h.act(1, "arm_away");
  h.run(40_000);
  h.agree("armed_away");
  assert.equal(h.act(3, "disarm"), true);
  h.run(500);
  h.agree("disarmed");
  assert.deepEqual([h.panel(4).st, h.panel(5).st], ["disarmed", "disarmed"], "the panels' views are disarmed");
  assert.deepEqual(h.bridges.map((id) => h.view(id).heads.length), [1, 1, 1], "one head: the disarm, which descends the arm");
  // the arm and the disarm in the same instant, on two bridges that hear each other: whichever the mesh orders, every bridge ends in the same state
  const g = await alarmHouse();
  g.run(40_000);
  g.act(1, "arm_away");
  g.act(3, "arm_home");
  g.run(60_000);
  const s = g.states();
  assert.equal(new Set(s).size, 1, `two arms at once: every bridge shows the same state, ${s[0]}`);
  assert.equal(new Set(g.bridges.map((id) => g.view(id).digest)).size, 1, "and holds the same heads");
  // concurrent: the house is armed at home; the bridge 1 is cut off; it arms away at +10 s, the bridge 3 disarms at +25 s (after it): the disarm is the later
  for (const order of [["a", "c"], ["c", "a"]]) {
    const w = await alarmHouse();
    await baseline(w, "armed_home");
    meshPartition(w.home, [1], [2, 3], [4, 5]);
    w.run(10_000);
    const first = order[0] === "a" ? () => w.act(1, "arm_away") : () => w.act(3, "disarm");
    const second = order[0] === "a" ? () => w.act(3, "disarm") : () => w.act(1, "arm_away");
    assert.equal(first(), true);
    w.run(15_000);
    assert.equal(second(), true);
    w.run(10_000);
    assert.notDeepEqual(w.states().slice(0, 1), w.states().slice(2, 3), "cut off, the two sides show what each did");
    meshHeal(w.home);
    w.run(60_000);
    w.agree(order[1] === "c" ? "disarmed" : "armed_away");
  }
});

// =====================================================================================================================================
// AH4. the twelve situations
// =====================================================================================================================================

/**
 * A situation played on the house: the reference's own script (alarm-merge-world.mjs SITUATIONS), its nodes the bridges 1 to n in the order it names them,
 * the house in the state it starts from, and nobody hearing anybody unless a step says so: a "boot" is a power cut and a boot of that bridge's device, an "act" is a
 * person arming or disarming at its alarm, "hear" and "meet" put the two bridges in one group for a while, and "meetAll" heals the cut. The steps go in the order of
 * their times (the reference takes each at the time it names), scaled by half so that a 400 s story takes 160 s of the house's time.
 */
async function situation(sc) {
  const ids = sc.nodes.map((_, i) => i + 1);
  const id = (name) => ids[sc.nodes.indexOf(name)];
  const h = await alarmHouse({ bridges: ids, panels: [] });
  await baseline(h, sc.base === "disarmed" ? "disarmed-record" : "armed_away");
  const alone = () => meshPartition(h.home, ...ids.map((i) => [i]));
  alone();
  const t0 = h.home.now;
  const at = (t) => t0 + (t - 80) * 500;
  const timeOf = (s) => (s[0] === "boot" ? s[2] : s[0] === "act" ? s[3] : s[0] === "hear" || s[0] === "meet" ? s[3] : s[1]);
  const steps = sc.steps.map((s, k) => ({ s, k })).sort((a, b) => timeOf(a.s) - timeOf(b.s) || a.k - b.k);
  const log = [];
  for (const { s } of steps) {
    const when = at(timeOf(s));
    if (when > h.home.now) h.run(when - h.home.now);
    switch (s[0]) {
      case "boot":
        await h.power(id(s[1]), 1000);
        log.push(`boot ${s[1]}`);
        break;
      case "act": {
        const word = s[2] === "disarmed" ? "disarm" : "arm_away";
        const r = h.act(id(s[1]), word);
        log.push(`${s[1]} ${word} ${r}`);
        assert.equal(r, true, `${s[1]}'s ${word} was taken: it showed a state to change (${JSON.stringify(h.view(id(s[1])))})`);
        break;
      }
      case "hear":
      case "meet": {
        const a = id(s[1]), b = id(s[2]);
        meshPartition(h.home, ...ids.map((i) => (i === a || i === b ? [a, b] : [i])).filter((g, k, all) => all.findIndex((x) => x.join() === g.join()) === k));
        h.run(15_000);
        alone();
        log.push(`${s[0]} ${s[1]} ${s[2]}`);
        break;
      }
      case "meetAll":
        meshHeal(h.home);
        log.push("meetAll");
        break;
    }
  }
  h.run(120_000);
  return { h, log };
}

for (const sc of SITUATIONS) {
  test(`${sc.id} ${sc.title}: the house ends in ${sc.want}, as the reference does`, async (t) => {
    const reference = runScenario(sc);
    assert.equal(reference.agreedState(), sc.want, "the reference's own end state");
    const { h, log } = await situation(sc);
    h.agree(sc.want);
    assert.deepEqual(h.bridges.map((id) => h.view(id).heads.length), reference.nodes.map((n) => n.r.offer().length), "and every bridge holds as many heads as the reference's replica of the same node");
    for (const id of h.bridges) assert.equal(h.view(id).events.some((e) => e[0] === "trigger"), false, "no trigger in these stories");
    t.diagnostic(`${sc.id}: ${log.join("; ")}: ${h.bridges.map((id) => h.view(id).heads.length).join("+")} heads, every bridge ${sc.want}`);
  });
}

// =====================================================================================================================================
// AH5. cut off for five minutes, the crystals apart
// =====================================================================================================================================

test("the house cut in two for five minutes, the crystals at +250 and -250 ppm: the later action wins, whichever side made it, and the clocks come together", async (t) => {
  const within = (xs) => Math.max(...xs) - Math.min(...xs);
  const notes = [];
  // the house is armed away; the side that acts early does it at +10 s, the other a minute and a half later (the drift between the two is some ms)
  for (const [early, word, late, lateWord, want] of [["a", "disarm", "c", "arm_home", "armed_home"], ["c", "arm_home", "a", "disarm", "disarmed"]]) {
    const h = await alarmHouse();
    await baseline(h, "armed_away");
    const A = [1, 2, 4], C = [3, 5];
    for (const id of A) meshDrift(h.home, id, 250);
    for (const id of C) meshDrift(h.home, id, -250);
    meshPartition(h.home, A, C);
    h.run(10_000);
    const by = (side) => (side === "a" ? 1 : 3);
    assert.equal(h.act(by(early), word), true);
    h.run(90_000);
    assert.equal(h.act(by(late), lateWord), true);
    h.run(200_000);
    const [sa, sc] = [h.states()[0], h.states()[2]];
    assert.notEqual(sa, sc, `cut off, each side shows what its own did: ${sa} and ${sc}`);
    const apart = Math.abs(h.mesh(1) - h.mesh(3));
    assert.ok(apart > 100, `the clocks of the two sides came apart by the drift: ${apart} ms`);
    meshHeal(h.home);
    h.run(90_000);
    h.agree(want);
    const clocks = h.ids.map((id) => h.mesh(id));
    assert.ok(within(clocks) < 25, `after the join the five clocks are within ${within(clocks)} ms`);
    notes.push(`${early} ${word} then ${late} ${lateWord}: every bridge ${want}, the clocks ${Math.round(apart)} ms apart when cut and ${Math.round(within(clocks))} ms after`);
  }
  t.diagnostic(notes.join("; "));
});

// =====================================================================================================================================
// AH6. a bridge restarts while cut off
// =====================================================================================================================================

test("a bridge that restarts while cut off comes back with what its flash held, shows it quietly, and takes the house's later word by causality", async () => {
  const h = await alarmHouse();
  for (const id of h.bridges) h.setup(id);
  await baseline(h, "armed_away");
  meshPartition(h.home, [1, 2, 4, 5], [3]);
  h.run(10_000);
  const before = h.view(3);
  await h.power(3, 2000);
  h.run(20_000);
  const v = h.view(3);
  assert.deepEqual([v.up, v.slot, v.st, v.mode, v.sounding, v.events], [true, 3, "armed_away", "away", false, []], "back armed as it was, with no exit time, no event and no siren: what the heads remember is not happening now");
  assert.deepEqual(v.heads, before.heads, "with the heads its flash held");
  assert.notEqual(v.tl, before.tl, "in a timeline of its own: the mesh restarted");
  assert.equal(v.ctr, before.ctr, "and its counter is the flash's");
  // the house disarms and arms home while it is away; the bridge 3 is cut off until the end
  h.act(1, "disarm");
  h.run(30_000);
  h.act(1, "arm_home");
  h.run(60_000);
  assert.equal(h.view(3).st, "armed_away", "cut off, it shows what it had");
  meshHeal(h.home);
  h.run(60_000);
  h.agree("armed_home");
  assert.equal(h.view(3).events.filter((e) => e[0] === "arm").length, 1, "the bridge 3 was told once, of the last arm: it is armed home");
});

// =====================================================================================================================================
// AH7. the whole house restarts
// =====================================================================================================================================

/** every bridge's device loses its power and they are powered again, `gaps` ms apart in the order given: new devices, the probes loaded again */
async function restartAll(h, order, gaps) {
  const old = order.map((id) => h.dev(id));
  for (const d of old) d.unplug();
  h.run(3000);
  for (const [i, id] of order.entries()) {
    if (i > 0) h.run(gaps[i - 1]);
    h.devices.set(id, await old[i].powerCycle());
  }
  h.run(300);
  for (const id of order) h.install(id);
}

test("the whole house loses its power and boots again, a little apart: the timelines re-merge into one, the armed state stays with nothing started again, and an action made before the merge is the house's", async (t) => {
  const notes = [];
  for (const early of [false, true]) {
    const h = await alarmHouse();
    for (const id of h.bridges) h.setup(id);
    await baseline(h, "armed_away");
    const old = h.bridges.map((id) => h.view(id));
    await restartAll(h, [1, 2, 3], [150, 150]);
    h.run(early ? 4000 : 60_000);
    if (!early) {
      assert.equal(h.net.timelines().size, 1, "the house is in one timeline again");
    }
    for (const id of h.bridges) {
      const v = h.view(id);
      assert.equal(v.up, true, `bridge ${id}: its replica is up`);
      assert.deepEqual([v.st, v.mode, v.sounding, v.events], ["armed_away", "away", false, []], `bridge ${id}: armed as it was, nothing started again`);
      assert.deepEqual(v.heads, old[id - 1].heads, `bridge ${id}: the heads its flash held`);
    }
    // a person disarms on the bridge 3: before the timelines are one, or after; the record is the house's either way
    assert.equal(h.act(3, "disarm"), true);
    h.run(90_000);
    assert.equal(h.net.timelines().size, 1, "one timeline");
    h.agree("disarmed");
    assert.deepEqual(h.bridges.map((id) => h.view(id).heads.length), [1, 1, 1], "one head: the disarm, which descends the arms the flashes held");
    notes.push(`${early ? "at 4 s, before the timelines are one" : "after the timelines are one"}: disarmed on the three`);
  }
  t.diagnostic(notes.join("; "));
});

// =====================================================================================================================================
// AH8. a lone bridge with stale records
// =====================================================================================================================================

test("a lone bridge restarted twice while the house moved on: what it holds is in timelines nothing places, the house's later arm descends it, and the bridge is told of the end state and nothing between", async () => {
  const h = await alarmHouse();
  await baseline(h, "armed_away");
  meshPartition(h.home, [1, 2, 4, 5], [3]);
  h.run(10_000);
  await h.power(3, 1000);
  h.run(15_000);
  await h.power(3, 1000);
  h.run(15_000);
  const lone = h.view(3);
  assert.deepEqual([lone.st, lone.events], ["armed_away", []], "the lone bridge shows its flash's arm, quietly, in the third timeline of the story");
  // the house disarms, and arms again: the last is the house's
  h.act(1, "disarm");
  h.run(30_000);
  h.act(2, "arm_away");
  h.run(60_000);
  meshHeal(h.home);
  h.run(60_000);
  h.agree("armed_away");
  const v = h.view(3);
  assert.deepEqual(v.events, [], "the bridge 3 was never told of the disarm in between: its stale arm is what the house's arm descends from, and the class did not change");
  assert.equal(v.heads.length, 1, "one head");
  // the bridge restarted and alone disarms; restarts again; and the house arms: the story of S12, with its own check that the disarm is placed nowhere
  const g = await alarmHouse();
  await baseline(g, "armed_away");
  meshPartition(g.home, [1, 2, 4, 5], [3]);
  g.run(10_000);
  g.act(1, "disarm");
  g.run(20_000);
  await g.power(3, 1000);
  g.run(15_000);
  assert.equal(g.act(3, "disarm"), true);
  g.run(5000);
  const disarm = g.view(3).heads[0];
  await g.power(3, 1000);
  g.run(15_000);
  assert.equal(g.view(3).heads[0], disarm, "the lone disarm is still its head");
  assert.notEqual(disarm.slice(8, 18), g.view(3).tl, "and its timeline is not the one the bridge is in");
  g.act(1, "arm_away");
  g.run(30_000);
  meshHeal(g.home);
  g.run(60_000);
  g.agree("disarmed");
});

// =====================================================================================================================================
// AH9. an alarm that is cut off still triggers
// =====================================================================================================================================

test("an alarm that is cut off still triggers, and sounds; the others sound when they hear of it, for what is left of the siren's time counted from the mark, and a disarm ends it everywhere", async (t) => {
  const h = await alarmHouse({ links: [[1, 4], [2, 5]] });
  for (const id of h.bridges) h.setup(id);
  await baseline(h, "armed_away");
  meshPartition(h.home, [1, 2, 4, 5], [3]);
  h.run(10_000);
  const t0 = h.home.now;
  h.report(3, PIR, { Occupancy: 1 });
  const v = h.view(3);
  assert.deepEqual([v.st, v.sounding, v.cause, v.klass], ["triggered", true, [PIR, "motion"], 3], "cut off from the house, the bridge triggers and sounds at once");
  assert.equal(h.view(3).events.at(-1)[0], "trigger");
  h.run(20_000);
  assert.deepEqual([h.view(1).st, h.view(2).st, h.view(1).sounding], ["armed_away", "armed_away", false], "the others know nothing of it");
  meshHeal(h.home);
  const healed = h.home.now;
  let heardAt = null;
  for (let ms = 0; ms < 30_000 && heardAt === null; ms += 100) {
    h.run(100);
    if (h.view(1).st === "triggered" && h.view(2).st === "triggered") heardAt = h.home.now - healed;
  }
  assert.ok(heardAt !== null, "the others hear of it once the cut is healed");
  for (const id of [1, 2]) {
    const w = h.view(id);
    assert.deepEqual([w.st, w.mode, w.sounding, w.cause, w.events.at(-1)], ["triggered", "away", true, ["bridge 3", "alarm"], ["trigger", "bridge 3"]], `bridge ${id}: triggered by the bridge 3, its siren sounding`);
  }
  h.run(300);
  assert.deepEqual([h.panel(4).st, h.panel(5).st], ["triggered", "triggered"], "and the panels' views");
  // the siren's time is 300 s from the trigger's mark, on every bridge: they stop within a second of each other
  h.run(t0 + 289_000 - h.home.now);
  assert.deepEqual(h.bridges.map((id) => h.view(id).sounding), [true, true, true], "289 s after the trigger every siren still sounds");
  h.run(t0 + 301_500 - h.home.now);
  assert.deepEqual(h.bridges.map((id) => h.view(id).sounding), [false, false, false], "300 s after it every one has stopped, whenever it heard of it");
  assert.deepEqual(h.bridges.map((id) => h.view(id).st), ["triggered", "triggered", "triggered"], "and the state stays triggered until a disarm");
  assert.equal(h.view(1).events.at(-1)[0], "siren_off");
  h.act(2, "disarm");
  h.run(2000);
  h.agree("disarmed");
  t.diagnostic(`the trigger on the cut-off bridge 3 was on the others ${heardAt} ms after the cut healed; every siren stopped 300 s after the trigger`);
});

test("AH9b a sensor that trips after the siren's time sounds the alarm again, and one that trips while it sounds is the same alarm", async () => {
  const h = await alarmHouse();
  for (const id of h.bridges) h.setup(id);
  await baseline(h, "armed_away");
  h.report(1, PIR, { Occupancy: 1 });
  h.run(2000);
  h.agree("triggered");
  const first = h.view(2).heads[0];
  h.report(1, PIR, { Occupancy: 0 });
  h.report(1, PIR, { Occupancy: 1 });
  h.run(2000);
  assert.deepEqual(h.view(1).heads, [first], "a trip while the siren sounds is the same alarm: no new record");
  h.run(300_000);
  assert.deepEqual(h.bridges.map((id) => h.view(id).sounding), [false, false, false]);
  h.report(1, PIR, { Occupancy: 0 });
  h.report(1, PIR, { Occupancy: 1 });
  h.run(2000);
  h.agree("triggered");
  assert.notEqual(h.view(2).heads[0], first, "a trip after the siren's time is a new trigger, and the others have it");
  assert.deepEqual(h.bridges.map((id) => h.view(id).sounding), [true, true, true], "and every siren sounds again");
});

// =====================================================================================================================================
// AH10. a bridge with no alarm number
// =====================================================================================================================================

test("a bridge with no alarm number is the one alarm it was, whatever the mesh does; ZbAlarmSlot gives it one and it joins, as that alarm", async () => {
  const h = await alarmHouse({ bridges: [1, 2, 20], panels: [] });
  h.run(40_000);
  assert.deepEqual([h.view(1).up, h.view(2).up, h.view(20).up, h.view(20).no], [true, true, false, true], "the bridge numbered 20 in the mesh has no alarm number: no replica");
  h.act(1, "arm_away");
  h.run(40_000);
  assert.deepEqual([h.view(1).st, h.view(2).st, h.view(20).st], ["armed_away", "armed_away", "disarmed"], "the house's arm does not reach it");
  h.act(20, "arm_home");
  h.run(5000);
  assert.deepEqual([h.view(20).st, h.view(1).st], ["arming", "armed_away"], "and what it does stays with it: a single bridge's alarm");
  assert.equal(h.view(20).heads.length, 0);
  h.act(20, "disarm");
  h.run(1000);
  const r = JSON.parse(h.dev(20).console("ZbAlarmSlot 4"));
  assert.deepEqual(r.ZbAlarmSlot, { Slot: 4, Up: 0 }, "the number is kept; the replica is built the next second");
  h.run(30_000);
  const v = h.view(20);
  assert.deepEqual([v.up, v.slot, v.st, v.klass], [true, 4, "armed_away", 2], "it is alarm 4, in a house whose alarms are 1, 2 and 4: it shows the house's arm");
  assert.deepEqual(h.view(20).events.filter((e) => e[0] === "arm").map((e) => e[1]), ["panel", "bridge 1"], "its own arm of before, and the house's, told as made by bridge 1");
  assert.equal(new Set([1, 2, 20].map((id) => h.view(id).digest)).size, 1, "and holds the same heads");
  assert.equal(h.act(20, "disarm"), true);
  h.run(3000);
  assert.deepEqual([1, 2, 20].map((id) => h.view(id).st), ["disarmed", "disarmed", "disarmed"]);
  assert.equal(h.view(1).heads[0].slice(2, 8), "400001", "its record is the dot of alarm 4, counter 1");
  // the console: with no argument, the number now
  assert.deepEqual(JSON.parse(h.dev(20).console("ZbAlarmSlot")).ZbAlarmSlot, { Slot: 4, Up: 4 });
});

// =====================================================================================================================================
// AH11. a late bridge catches up
// =====================================================================================================================================

test("a bridge that was off while the house armed, disarmed and armed again catches up from the digests in its neighbours' heartbeats, and shows the state quietly counted from the mark", async (t) => {
  const h = await alarmHouse();
  for (const id of h.bridges) h.setup(id);
  h.run(40_000);
  h.act(1, "arm_away");
  h.run(40_000);
  const old = h.dev(3);
  old.unplug();
  h.run(5000);
  h.act(1, "disarm");
  h.run(10_000);
  h.act(2, "arm_home");
  h.run(60_000);
  h.devices.set(3, await old.powerCycle());
  h.run(300);
  h.install(3);
  const t0 = h.home.now;
  let at = null;
  for (let ms = 0; ms < 40_000 && at === null; ms += 100) {
    h.run(100);
    const v = h.view(3);
    if (v.up && v.st === "armed_home") at = h.home.now - t0;
  }
  assert.ok(at !== null, "the bridge 3 shows the house's state");
  h.run(5000);
  const v = h.view(3);
  assert.deepEqual([v.st, v.mode, v.sounding], ["armed_home", "home", false], "armed home, with no exit time to run: the arm is a minute old, and its mark says so");
  h.agree("armed_home");
  assert.equal(v.events.some((e) => e[0] === "arm" && e[1] === "bridge 2"), true, "told as bridge 2's arm");
  t.diagnostic(`the bridge 3 showed the house's state ${at} ms after its power came back (the mesh and the replica start in the first seconds, and the digests come in the heartbeats)`);
});

// =====================================================================================================================================
// AH12. the mesh of a bridge stopped
// =====================================================================================================================================

test("the mesh of a bridge stopped: its alarm works on, in the life it had, and when the mesh comes back (a new timeline) the replica starts a new life and the house takes what was done", async () => {
  const h = await alarmHouse();
  for (const id of h.bridges) h.setup(id);
  await baseline(h, "disarmed");
  const before = h.view(2);
  assert.deepEqual(h.cmd(2, "EspNowMeshEnable 0"), { EspNowMeshEnable: { Enabled: 0, Running: 0 } });
  h.run(3000);
  assert.equal(h.act(2, "arm_away"), true, "with the task stopped the alarm still arms");
  const v = h.view(2);
  assert.deepEqual([v.st, v.heads.length, v.tl], ["arming", 1, before.tl], "through the replica, in the timeline of the life it had");
  h.run(30_000);
  assert.deepEqual([h.view(1).st, h.view(3).st], ["disarmed", "disarmed"], "the others know nothing of it");
  assert.deepEqual([h.view(2).st, h.view(2).no], ["armed_away", false], "and the exit time ran out on the bridge's own counter");
  assert.deepEqual(h.cmd(2, "EspNowMeshEnable 1"), { EspNowMeshEnable: { Enabled: 1, Running: 1 } });
  h.run(60_000);
  const w = h.view(2);
  assert.equal(w.tl, tlHex(h.net.air.clock(2).timeline), "a new life: its timeline is the mesh's, which began as a new one and took the house's again");
  assert.ok(h.read(2).timelines.length >= 1, "by a Timeline event");
  h.agree("armed_away");
  assert.equal(h.view(1).heads[0], v.heads[0], "the house has the record the stopped bridge made, as it was");
});

// =====================================================================================================================================
// AH13. what the replica costs in heap
// =====================================================================================================================================

test("what the replica costs in heap: its object, its rules and its closures, and 3 and 15 heads", async (t) => {
  const kept = {};
  const glue = await (async () => {
    const h = await alarmHouse({ bridges: [1, 2, 20], panels: [] });
    h.run(40_000);
    const a = Number(h.dev(1).vm.call("al_baseline", ""));
    const b = Number(h.dev(20).vm.call("al_baseline", ""));
    assert.equal(h.view(1).up && !h.view(20).up, true);
    return a - b;
  })();
  for (const n of [3, 15]) {
    const h = await alarmHouse({ bridges: [1, 2, 3], panels: [] });
    h.run(40_000);
    const r = JSON.parse(h.dev(1).vm.call("al_heap", String(n)));
    assert.equal(r.heads, n, `${n} heads held`);
    kept[n] = r.kept;
  }
  assert.ok(glue < 8192, `the replica and its transport, with no heads, hold ${glue} bytes on the bridge's heap`);
  assert.ok(kept[15] < 8192, `15 heads hold ${kept[15]} bytes`);
  assert.ok(kept[3] < kept[15]);
  t.diagnostic(`heap on the bridge, WebAssembly VM: the replica with its transport and no heads ${glue} bytes more than a bridge with none; 3 heads ${kept[3]} bytes, 15 heads ${kept[15]} bytes, the persisted hex of the heads included`);
});

// =====================================================================================================================================
// AH14. a flood a bridge did not hear
// =====================================================================================================================================

test("a bridge that did not hear the flood of an arm (everything sent to it is lost for four seconds) has it from the digests in the next heartbeats: no timer of the alarm's, the repetition is the heartbeat's", async (t) => {
  const h = await alarmHouse();
  h.run(40_000);
  for (const from of [1, 2, 4, 5]) h.air.setLinkLoss(from, 3, 1);
  h.act(1, "arm_away");
  h.run(4000);
  assert.deepEqual([h.view(1).st, h.view(2).st, h.view(3).st], ["arming", "arming", "disarmed"], "the flood reached the bridge 2 and not the bridge 3");
  assert.deepEqual(recordFrames(h.dev(3)), [], "and nothing of the alarm reached it");
  for (const from of [1, 2, 4, 5]) h.air.setLinkLoss(from, 3, undefined);
  const t0 = h.home.now;
  let at = null;
  for (let ms = 0; ms < 20_000 && at === null; ms += 100) {
    h.run(100);
    if (h.view(3).st !== "disarmed") at = h.home.now - t0;
  }
  assert.ok(at !== null && at <= 13_000, `the bridge 3 has the arm ${at} ms after it can hear again: a heartbeat (5 s) and the poll (2 s), and the exchange`);
  h.run(35_000);
  h.agree("armed_away");
  assert.deepEqual(recordFrames(h.dev(3)).map((f) => f[0]), recordFrames(h.dev(3)).map(() => 2), "what it was told came as state frames, to it alone");
  const told = recordFrames(h.dev(3)).length;
  assert.ok(told >= 1 && told <= 4, `${told} record frames to the bridge 3, offered by the neighbours that read its heartbeat`);
  h.run(60_000);
  assert.equal(recordFrames(h.dev(3)).length, told, "and none after the digests agree");
  t.diagnostic(`the bridge 3 had the arm it had not heard ${at} ms after it could hear again, in ${told} record frame(s) to it`);
});

// =====================================================================================================================================
// AH15. random stories
// =====================================================================================================================================

test("random stories on four bridges (arms and disarms, cuts and heals, power failures, from a seed): after the last heal every bridge holds the same heads and shows the same state, and nothing is left wanted", async (t) => {
  const NODES = [1, 2, 3, 4];
  const notes = [];
  for (const seed of [1, 6, 9, 20, 29]) {
    const rng = mulberry32(seed * 7919);
    const h = await alarmHouse({ bridges: NODES, panels: [] });
    h.run(25_000);
    const story = [];
    for (let step = 0; step < 14; step++) {
      const r = rng();
      const id = NODES[Math.floor(rng() * NODES.length)];
      if (r < 0.45) {
        const word = ["arm_home", "arm_away", "disarm"][Math.floor(rng() * 3)];
        story.push(`${Math.round(h.home.now / 1000)} s: ${id} ${word} ${h.act(id, word)}`);
      } else if (r < 0.7) {
        const cut = NODES.filter(() => rng() < 0.5);
        if (cut.length > 0 && cut.length < NODES.length) {
          meshPartition(h.home, cut, NODES.filter((x) => !cut.includes(x)));
          story.push(`${Math.round(h.home.now / 1000)} s: cut ${JSON.stringify(cut)}`);
        } else {
          meshHeal(h.home);
          story.push(`${Math.round(h.home.now / 1000)} s: heal`);
        }
      } else if (r < 0.82) {
        meshHeal(h.home);
        story.push(`${Math.round(h.home.now / 1000)} s: heal`);
      } else {
        await h.power(id, 500 + Math.floor(rng() * 2000));
        story.push(`${Math.round(h.home.now / 1000)} s: power ${id}`);
      }
      h.run(3000 + Math.floor(rng() * 40_000));
    }
    meshHeal(h.home);
    h.run(150_000);
    const views = NODES.map((id) => h.view(id));
    assert.deepEqual(views.map((v) => v.up), [true, true, true, true], `seed ${seed}: every replica is up`);
    assert.equal(new Set(views.map((v) => v.digest)).size, 1, `seed ${seed}: every bridge holds the same heads: ${JSON.stringify(views.map((v) => v.heads.length))}\n${story.join("\n")}`);
    assert.equal(new Set(views.map((v) => v.klass)).size, 1, `seed ${seed}: every bridge shows the same state: ${JSON.stringify(views.map((v) => v.klass))}\n${story.join("\n")}`);
    assert.ok(views.every((v) => !v.want), `seed ${seed}: nothing is left wanted`);
    notes.push(`seed ${seed}: ${STATES[views[0].klass]}, ${views[0].heads.length} head(s)`);
  }
  t.diagnostic(notes.join("; "));
});
