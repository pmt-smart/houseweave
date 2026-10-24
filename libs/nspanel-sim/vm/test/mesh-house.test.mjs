// The ESP-NOW mesh driver on simulated devices (src/mesh-driver.ts): a house of three bridges and two panels, each with the repo's own Berry brain booted,
// each running a node of the house's mesh over the mesh core compiled to WebAssembly (mesh.ts), as the firmware's driver (xdrv_98_1_espnow_mesh.ino) runs
// it. A small Berry script, loaded on each device the way the other tests load theirs (vm.run), calls the functions the driver gives Berry and takes the
// events it gives the rules, and what these tests hold is what that Berry sees.
//
//   A  before the task runs, and the argument checks: every function is false, the sizes of a payload, the errors of a call that is not one
//   B  the ready gate: a node that is not ready delivers nothing and answers nothing, and the sender is told, with its ticket
//   C  a command with the stamp, checked at the owner by K and the window exactly as the Berry does it, with the age it really has
//   D  the clock, the neighbours and the health, as Berry reads them, and the bytes of the heartbeat that are the application's
//   E  a device that restarts: a new timeline, the Timeline and Synced events, no stamp until synced, the record in the flash that gives it its epoch
//   F  the mesh alone restarts: a new timeline and no event
//   G  the house cut in two, the crystals drifting: the two clocks come apart as the crystals say, and the join steps them together
//   H  the same with a group that restarted: the join moves it by the difference of the ages
//   I  the record in the NVS across a power cycle, and the clone that loses its number
//   J  a node out of the radio's reach: Silent, and Back
//   K  the queue to the task, the tickets, EspNowMeshSend, and the devices that have no driver
//   L  rooms in a row, out of each other's reach but for the next two: a command crosses the house by the relays
//   M  the network (UDP) as a second way: no radio at all between the nodes, and they find each other and talk
//      and the same when the router goes: the network is down for the nodes, and they are silent to each other until it is back
//   N  the end of the frame counter: the mesh stops and starts again under the next epoch, a new timeline
//   O  the queues to the main loop: a burst that fills them, and nothing answered is lost
//   P  the firmware's own cipher in place of the stand-in: the identity in the record is the one the nodes use among themselves
//   Q  the lists the commands answer in pages (EspNowMeshNeighbors, EspNowMeshHealth, EspNowMeshClock): as many entries as fit under the margin of a message,
//      the index of the next page when some remain, and JSON in every case, with 48 neighbours of 32 bytes of info each
//   R  a node taken out of the driver's list is forgotten by the core: no neighbour, no verdict that it is silent
import { test } from "node:test";
import assert from "node:assert/strict";
import { SimHouse, SimBridge, MeshRecord, placesLinks, routerOff, routerOn, meshPartition, meshHeal, meshIsolate, meshDrift, meshRestart, pageList, MESSZ, PAGE_MAX } from "../dist/index.js";
import { bridgeFiles } from "../dist/files-node.js";
import { KEY, EPOCH, RECORD, SCRIPT, meshHouse, tlHex, record } from "./mesh-world.mjs";

// =====================================================================================================================================
// A. before the task runs
// =====================================================================================================================================

test("before the task runs every function that reads the mesh is false, a send is not taken, and the argument checks are the driver's", async () => {
  const h = await meshHouse();
  assert.equal(h.home.now, 0, "the house's first instant: Tasmota's first second has not come, and the mesh has not started");
  assert.equal(h.status(1).Running, 0);
  assert.equal(h.status(1).Ready, 0, "with Berry running, the application is not ready until it says so");
  for (const f of ["espnow_mesh_clock()", "espnow_mesh_stamp()", "espnow_mesh_health()", "espnow_mesh_neighbors()", "espnow_mesh_age(bytes('000102030405'))"]) {
    assert.deepEqual(h.berry(1, f), { v: false }, `${f}: false while the task is not running`);
  }
  assert.deepEqual(h.berry(1, "espnow_mesh_send(2, 0, true, bytes('00'))"), { v: false }, "a send is not taken");
  // the sizes: the seal of a frame for one node takes 8 bytes of the 228 off, and one for everyone has none
  assert.deepEqual(h.berry(1, "espnow_mesh_max_payload(2)"), { v: 220 });
  assert.deepEqual(h.berry(1, "espnow_mesh_max_payload(255)"), { v: 228 });
  // the errors of a call that is not one: the type of the arguments
  for (const f of ["espnow_mesh_send(1, 2)", "espnow_mesh_send('1', 2, true, bytes())", "espnow_mesh_send(1, '2', true, bytes())", "espnow_mesh_max_payload(256)", "espnow_mesh_max_payload(-1)",
    "espnow_mesh_max_payload('x')", "espnow_mesh_max_payload()", "espnow_mesh_age(5)", "espnow_mesh_age()", "espnow_mesh_info()"]) {
    assert.deepEqual(h.berry(1, f), { raise: "type_error" }, `${f}: a type error`);
  }
  // what is not bytes or a string is not data: false, and not an error
  assert.deepEqual(h.berry(1, "espnow_mesh_send(2, 0, true, 5)"), { v: false });
  assert.equal(h.status(1).Ready, 0, "none of that said the application is ready");
  // espnow_mesh_info says it, even with the task not running to take the bytes; bytes beyond 32 do not
  assert.deepEqual(h.berry(1, "espnow_mesh_info(bytes().fromstring('x'*33))"), { v: false });
  assert.equal(h.status(1).Ready, 0, "33 bytes are no heartbeat's, and say nothing");
  assert.deepEqual(h.berry(1, "espnow_mesh_info(bytes('00'))"), { v: false }, "the task is not there to take it");
  assert.equal(h.status(1).Ready, 1, "but the script that tells the heartbeat what it carries has its rules in place: ready");
  assert.deepEqual(h.berry(2, "espnow_mesh_ready()"), { v: true });
  assert.equal(h.status(2).Ready, 1);
  assert.deepEqual(h.berry(2, "espnow_mesh_ready(false)"), { v: true });
  assert.equal(h.status(2).Ready, 0, "and ready(false) says it is not");
  // the commands answer as the firmware's do
  assert.deepEqual(h.cmd(1, "EspNowMeshSend 2,0,1,hello"), { EspNowMeshSend: "not running" });
  assert.deepEqual(h.cmd(1, "EspNowMeshClock"), { EspNowMeshClock: "not running" });
  assert.deepEqual(h.cmd(1, "EspNowMeshNeighbors"), { EspNowMeshNeighbors: "not running" });
  assert.deepEqual(h.cmd(1, "EspNowMeshHealth"), { EspNowMeshHealth: "not running" });
  assert.deepEqual(h.cmd(1, "EspNowMeshInfo 0102"), { EspNowMeshInfo: "not running" });
  const rec = record(h.dev(1));
  assert.deepEqual([rec.id, rec.enabled, rec.hasGroup, rec.hasSecret, rec.epoch], [1, 1, 1, 1, 0], "the record of the bench's setup: the number, the mesh on, the key, an identity, and no start yet");
  // the first second: the mesh starts, on every device, under an epoch of its own
  h.run(1100);
  assert.equal(h.status(1).Running, 1);
  assert.ok(h.logs.some((l) => l.who === "b1" && /^EMH: Started as node 1, epoch \d+, \d+ bytes of heap free$/.test(l.line)));
  assert.ok(h.ids.every((id) => h.dev(id).mesh.running));
  assert.equal(h.status(1).Epoch, record(h.dev(1)).epoch, "the epoch that the node numbers its frames under is the one saved in the flash first");
});

// =====================================================================================================================================
// B. the ready gate
// =====================================================================================================================================

test("a node that is not ready (a panel: a bridge says it is, with the heartbeat's bytes of its alarm replica) delivers nothing and answers nothing: the sender sends three times and is told it was not answered, with its ticket; when it is ready the next one is delivered and answered", async (t) => {
  const h = await meshHouse();
  h.run(40_000);
  assert.equal(h.net.timelines().size, 1, "the house is in one timeline");
  // the panel has the house layer, which says it is ready with its first heartbeat: it says it is not, as a node whose rules are not registered yet
  h.berry(5, "espnow_mesh_ready(false)");
  h.run(60);
  const before = h.status(5);
  const ticket = h.berry(1, "espnow_mesh_send(5, 0, true, bytes('01'))").v;
  assert.ok(Number.isInteger(ticket) && ticket >= 1, `the ticket: ${ticket}`);
  h.run(1000);
  const a = h.read(1).outcomes;
  assert.equal(a.length, 1);
  assert.deepEqual([a[0].Counter, a[0].Dest, a[0].Ok, a[0].Attempts], [ticket, 5, 0, 3], "not answered after 3 attempts, and the Counter is the ticket the send gave");
  assert.ok(a[0].Frame >= 1, "and the number the frame had on the air");
  assert.deepEqual(h.read(5).frames, [], "the application of the node that is not ready was given nothing");
  const after = h.status(5);
  assert.ok(after.InboxFull - before.InboxFull >= 3, `its core refused each copy of each attempt as a full inbox does: ${after.InboxFull - before.InboxFull} of them (the attempts, and the copies the other nodes repeat)`);
  assert.equal(after.Delivered, before.Delivered, "none delivered");
  assert.equal(after.AcksSent, before.AcksSent, "none answered");
  // a state for everyone is repeated and not delivered here
  h.berry(1, "espnow_mesh_send(255, 2, false, bytes('02'))");
  h.run(500);
  assert.deepEqual(h.read(5).frames, [], "a frame for everyone is not delivered to it either");
  // ready: the next one comes through
  assert.deepEqual(h.berry(5, "espnow_mesh_ready()"), { v: true });
  h.run(60);
  assert.equal(h.status(5).Ready, 1);
  assert.ok(h.logs.some((l) => l.who === "p5" && l.line === "EMH: The application is ready: the frames for it are taken"));
  const t2 = h.berry(1, "espnow_mesh_send(5, 0, true, bytes('03'))").v;
  assert.equal(t2, ticket + 2, "the ticket is the next one: the broadcast above took one");
  h.run(1000);
  const frames = h.read(5).frames;
  assert.equal(frames.length, 1);
  assert.deepEqual([frames[0].From, frames[0].Type, frames[0].Dest, frames[0].Data, frames[0].Flags, frames[0].Behind, frames[0].Part, frames[0].Joins, frames[0].Rssi], [1, 0, 5, "03", 1, 0, 0, 0, -55],
    "delivered to the rules as the driver's JSON has it: the sender, the type, the destination, the data in hex, the flags (1: an answer is asked), nothing behind, the signal");
  const o = h.read(1).outcomes.at(-1);
  assert.deepEqual([o.Counter, o.Dest, o.Ok, o.Attempts], [t2, 5, 1, 1], "and answered at the first attempt");
  assert.equal(o.Frame, frames[0].Counter, "the Frame of the outcome is the Counter the receiver was told");
  // not ready again: the gate shuts
  h.berry(5, "espnow_mesh_ready(false)");
  h.run(60);
  const t3 = h.berry(1, "espnow_mesh_send(5, 0, true, bytes('04'))").v;
  h.run(1000);
  assert.equal(h.read(5).frames.length, 1, "nothing more delivered");
  assert.deepEqual([h.read(1).outcomes.at(-1).Counter, h.read(1).outcomes.at(-1).Ok], [t3, 0]);
  // and the command says the same as the function
  assert.deepEqual(h.cmd(5, "EspNowMeshReady 1"), { EspNowMeshReady: { Ready: 1 } });
  assert.deepEqual(h.cmd(5, "EspNowMeshReady"), { EspNowMeshReady: { Ready: 1 } });
  t.diagnostic(`a send to a node that is not ready: Outcome Ok 0, 3 attempts, 3 InboxFull at the receiver, nothing delivered, no answer; after ready: delivered and answered at the first attempt`);
});

// =====================================================================================================================================
// C. the stamp, K and the window
// =====================================================================================================================================

test("a command with the stamp is executed once at its owner, with the age it really has; a resend, a stale stamp, one from the future and one of another timeline are not", async (t) => {
  const h = await meshHouse();
  for (const id of h.ids) h.berry(id, "espnow_mesh_ready()");
  h.run(40_000);
  assert.equal(h.net.timelines().size, 1);
  const ages = [];
  // twenty commands, from the bridge 1 to the bridge 3 and the panel 5: each is run once, at an age that is the time it took
  for (let i = 0; i < 20; i++) {
    const to = i % 2 === 0 ? 3 : 5;
    const t0 = h.home.now;
    const ticket = h.berry(1, `send_cmd(${to}, bytes().fromstring("c${i}"))`).v;
    assert.ok(ticket >= 1, "the sender is synced and has a stamp");
    h.run(250 + ((i * 37) % 50));                // the sends fall at every phase of the main loop of the owner, which comes round every 50 ms
    const ran = h.read(to).ran.at(-1);
    assert.equal(ran.body, `c${i}`);
    assert.equal(ran.from, 1);
    ages.push(ran.age);
    assert.ok(ran.age >= 0 && ran.age <= 70, `the age ${ran.age} ms at the owner, ${h.home.now - t0} ms after the send: the air (10 ms) and the main loop's wait for its next turn (up to 50), and nothing else`);
  }
  for (const id of [3, 5]) assert.deepEqual(h.read(id).refused, [], "none was refused by K, the tag or the window");
  assert.equal(h.read(3).ran.length + h.read(5).ran.length, 20);
  assert.ok(h.read(1).outcomes.length === 20 && h.read(1).outcomes.every((o) => o.Ok === 1 && o.Attempts === 1), "and each was answered, the answer's Counter being the ticket");
  // the times the task takes, in µs: how long the send waited for it, and its round trip from the hand-over to the core to the answer, within the one attempt
  assert.ok(h.read(1).outcomes.every((o) => o.QueueUs >= 0 && o.RttUs > 0 && o.RttUs < 100_000), `the times of each: ${JSON.stringify(h.read(1).outcomes.map((o) => [o.QueueUs, o.RttUs]))}`);
  const sorted = [...ages].sort((a, b) => a - b);

  // a resend: the acknowledgement is lost on its way back, the sender sends it again, and the owner is handed the number again with the flag that says it is a repeat.
  // Every way back is lost: an answer whose hop fails goes on by the flood, and with the link to 1 alone lost it comes through the others
  const others = h.ids.filter((id) => id !== 3);
  for (const id of others) h.air.setLinkLoss(3, id, 1);
  const lost = h.berry(1, "send_cmd(3, bytes().fromstring('once'))").v;
  h.run(1500);
  for (const id of others) h.air.setLinkLoss(3, id, undefined);
  const frames = h.read(3).frames.filter((f) => f.Data.endsWith("6F6E6365"));
  assert.deepEqual(frames.map((f) => f.Flags), [1, 3, 3], "three attempts reached the owner: the first, and two that are repeats (flag 2)");
  assert.equal(new Set(frames.map((f) => f.Counter)).size, 1, "of the same number");
  assert.equal(h.read(3).ran.filter((r) => r.body === "once").length, 1, "and the command is executed once");
  const o = h.read(1).outcomes.at(-1);
  assert.deepEqual([o.Counter, o.Ok, o.Attempts], [lost, 0, 3], "the sender never heard: not answered after 3 attempts");

  // a stamp that is too old: made when it was, sent 4 s later, it is refused by the window of 3 s
  h.berry(1, "mt_keep()");
  const refusedBefore = h.read(3).refused.length;
  h.run(4000);
  h.berry(1, "mt_send_kept(3, bytes().fromstring('late'))");
  h.run(300);
  assert.deepEqual(h.read(3).refused.slice(refusedBefore), ["age"], "refused: older than 3 s");
  assert.ok(!h.read(3).ran.some((r) => r.body === "late"));
  // the window of a sensitive command is 1 s: 1.5 s old is refused there and not at a node whose window is 3 s
  h.berry(1, "mt_keep()");
  h.berry(3, "mt_sensitive(true)");
  h.run(1500);
  h.berry(1, "mt_send_kept(3, bytes().fromstring('slow3'))");
  h.berry(1, "mt_send_kept(5, bytes().fromstring('slow5'))");
  h.run(300);
  assert.deepEqual(h.read(3).refused.slice(refusedBefore), ["age", "age"], "refused at the node whose window is 1 s");
  assert.ok(h.read(5).ran.some((r) => r.body === "slow5" && r.age > 1400 && r.age < 1700), "and run at the one whose window is 3 s, at the age it had");
  h.berry(3, "mt_sensitive(false)");
  // a stamp from the future, 1 s ahead: beyond the 250 ms the clocks' error is given
  h.berry(1, "mt_send_stamped(3, mt_stamp_shift(100), bytes().fromstring('early'))");
  h.run(300);
  assert.equal(h.read(3).refused.at(-1), "age");
  assert.ok(!h.read(3).ran.some((r) => r.body === "early"));
  // a stamp of another timeline is not a time here
  h.berry(1, "mt_send_stamped(3, mt_stamp_tag(), bytes().fromstring('other'))");
  h.run(300);
  assert.equal(h.read(3).refused.at(-1), "tag");
  assert.ok(!h.read(3).ran.some((r) => r.body === "other"));
  // a stamp a little ahead, within the 250 ms, is accepted: the clocks of two nodes are never exact
  h.berry(1, "mt_send_stamped(3, mt_stamp_shift(10), bytes().fromstring('near'))");
  h.run(300);
  assert.ok(h.read(3).ran.some((r) => r.body === "near" && r.age < 0 && r.age >= -100), "10 ms ahead is run");
  t.diagnostic(`20 commands across the house, run at ${sorted[0]} to ${sorted.at(-1)} ms old (median ${sorted[10]} ms); a resend, a stamp 4 s old, one 1.5 s old at a sensitive node, one 1 s ahead and one of another timeline were each refused as the Berry has it`);
});

// =====================================================================================================================================
// D. the clock, the neighbours, the health
// =====================================================================================================================================

test("the clock, the neighbours and the health as Berry reads them: the shapes, the 32-bit ticks, the clocks of five nodes within a few ms, and the application's bytes of a heartbeat", async (t) => {
  const h = await meshHouse();
  for (const id of h.ids) h.berry(id, "espnow_mesh_ready()");
  h.run(40_000);
  const ids = h.ids;
  assert.equal(h.net.timelines().size, 1, "one timeline");
  // the clock: the map, with its nine keys, in the types the driver gives
  const c = h.berry(2, "espnow_mesh_clock()").v;
  assert.deepEqual(Object.keys(c).sort(), ["adopted", "hi", "lo", "synced", "taken", "tag", "ticks10", "ticks100", "timeline"].sort());
  assert.equal(c.synced, true);
  assert.equal(typeof c.adopted, "boolean");
  assert.equal(c.hi, 0);
  assert.equal(c.ticks10, Math.floor(c.lo / 10), "ticks of 10 ms");
  assert.equal(c.ticks100, Math.floor(c.lo / 100), "and of 100 ms");
  assert.match(c.timeline, /^[0-9A-F]{10}$/, "the timeline as 10 hex digits, in capitals, as the driver's ToHex_P writes them");
  const tl = Buffer.from(c.timeline, "hex");
  assert.equal(c.tag, ((tl[0] << 8) ^ ((tl[1] << 8) | tl[2]) ^ ((tl[3] << 8) | tl[4])) & 0xffff, "the tag is the node's, the epoch's halves and the timeline's node");
  assert.equal(c.taken, c.adopted ? 1 : 0, "the timelines taken since the start");
  // the same clock from the air, read the same instant
  assert.ok(Math.abs(c.lo - h.mesh(2)) <= 1, `Berry's ${c.lo} ms and the air's ${h.mesh(2)}`);
  // the five clocks, read at one instant, are within a few ms of each other
  const los = ids.map((id) => h.berry(id, "espnow_mesh_clock()").v.lo);
  const spread = Math.max(...los) - Math.min(...los);
  assert.ok(spread <= 15, `the clocks of the five nodes within ${spread} ms`);
  // a stamp: the tag and the time in ticks of 10 ms, 6 bytes, and its age at the same node an instant later
  const stamp = h.berry(2, "espnow_mesh_stamp()").v;
  assert.match(stamp, /^[0-9A-F]{12}$/);
  assert.equal(parseInt(stamp.slice(0, 4), 16), c.tag);
  assert.ok(Math.abs(parseInt(stamp.slice(4), 16) - Math.floor(h.mesh(2) / 10)) <= 1);
  assert.deepEqual(h.berry(2, `espnow_mesh_age(bytes('${stamp}'))`).v, { age: 0, tag: true, synced: true });
  h.run(1234);
  const age = h.berry(2, `espnow_mesh_age(bytes('${stamp}'))`).v;
  assert.ok(age.age >= 1225 && age.age <= 1240 && age.tag === true, `1.2 s later it is ${age.age} ms old, in ticks of 10 ms`);
  assert.equal(h.berry(2, "espnow_mesh_age(bytes('0102'))").v, false, "bytes that are not a stamp are false");
  assert.equal(h.berry(2, `espnow_mesh_age(bytes('${(parseInt(stamp.slice(0, 2), 16) ^ 1).toString(16).padStart(2, "0")}${stamp.slice(2)}'))`).v.tag, false, "a stamp of another timeline says it is");

  // the neighbours: a list with a map for each of the other four, its keys, and what its last heartbeat carried
  const list = h.berry(1, "espnow_mesh_neighbors()").v;
  assert.equal(list.length, 4);
  assert.deepEqual(list.map((n) => n.id).sort(), [2, 3, 4, 5]);
  for (const n of list) {
    assert.deepEqual(Object.keys(n).sort(), ["age", "beat", "hears", "id", "info", "key", "keybits", "rssi", "seen", "skew", "state"].sort());
    assert.equal(n.state, 0, "alive");
    assert.equal(n.seen, 2, "in the same timeline");
    assert.equal(n.hears, 4, "and it hears the other four, as its heartbeat says");
    assert.equal(n.rssi, -55);
    // a bridge's heartbeat carries the 32 bytes of its alarm's replica (berry/zbbridge_alarm_mesh.be, which hands them to espnow_mesh_info once the mesh runs: the number of a
    // bridge here is its alarm number), a panel's the same 32, with no replica in them: it has the house layer, which writes its own bytes
    assert.match(n.info, /^[0-9A-F]{64}$/, n.id <= 3 ? "the 32 bytes of a bridge's heartbeat, as hex" : "the 32 bytes of a panel's heartbeat, as hex");
    assert.equal(n.info.slice(0, 2), "01", "the layout");
    assert.equal(n.info.slice(2, 12), c.timeline, "the timeline the clock carries");
    assert.equal(n.info.slice(38, 40), "01", "and it says it is synced");
    assert.ok(n.age >= 0 && n.age <= 6000 && n.beat >= 0 && n.beat <= 6000, `heard ${n.age} ms ago, its last heartbeat ${n.beat} ms ago: heartbeats come every 5 s`);
    assert.ok(Math.abs(n.skew) <= 10, `its time at its last heartbeat less this node's: ${n.skew} ms`);
  }
  // the health: two hops deep, all five hear each other, and nothing is a cut
  const health = h.berry(1, "espnow_mesh_health()").v;
  assert.deepEqual(Object.keys(health).sort(), ["alone", "branches", "cut", "neighbors", "relays", "soleways", "twohop", "weak"].sort());
  assert.deepEqual([health.neighbors, health.weak, health.twohop, health.cut, health.alone, health.soleways], [4, 0, 0, 0, 0, 0]);
  // the commands answer what the functions do
  const nc = h.cmd(1, "EspNowMeshNeighbors").EspNowMeshNeighbors;
  assert.deepEqual([nc.Count, nc.From, nc.List.length], [4, 0, 4]);
  assert.deepEqual(Object.keys(nc.List[0]).sort(), ["Age", "Beat", "Hears", "Id", "Info", "Key", "KeyBits", "Lists", "NoRadio", "Rssi", "State", "TheirRssi", "Fwd"].sort());
  const hc = h.cmd(1, "EspNowMeshHealth").EspNowMeshHealth;
  assert.deepEqual([hc.Neighbors, hc.Cut, hc.Alone, hc.Count, hc.List.length], [4, 0, 0, 4, 4]);
  const cc = h.cmd(2, "EspNowMeshClock").EspNowMeshClock;
  assert.deepEqual([cc.Clock, cc.Synced, cc.Timeline, cc.Tag, cc.Count, cc.EventsLost], [1, 1, c.timeline, c.tag, 4, 0]);
  assert.ok(cc.List.every((n) => n.Seen === 2 && n.Sync === 1 && n.Timeline === c.timeline), "each neighbour is in the same timeline and says it is synced");

  // the application's bytes: 32 of them replace the heartbeat's, whole; the ones that are the node's (bytes 0 to 11 and the synced bit) are put over them as it sends
  const mine = Array.from({ length: 32 }, (_, i) => 0xa0 + i);
  assert.deepEqual(h.berry(2, `espnow_mesh_info(bytes('${mine.map((x) => x.toString(16).padStart(2, "0")).join("")}'))`).v, true);
  h.run(6000);
  const seen = h.berry(1, "espnow_mesh_neighbors()").v.find((n) => n.id === 2);
  assert.equal(seen.info.length, 64, "32 bytes of them");
  assert.equal(seen.info.slice(0, 2), "01", "byte 0, the layout, is the core's");
  assert.equal(seen.info.slice(2, 12), c.timeline, "bytes 1 to 5 the timeline");
  assert.equal(seen.info.slice(24, 38), mine.slice(12, 19).map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase(), "bytes 12 to 18 are the application's");
  assert.equal(parseInt(seen.info.slice(38, 40), 16), (mine[19] & ~1) | 1, "byte 19: the application's other bits, and the synced bit the core's");
  assert.equal(seen.info.slice(40), mine.slice(20).map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase(), "bytes 20 to 31 are the application's");
  // fewer than 20 bytes are filled with zeros up to 20
  assert.deepEqual(h.berry(2, "espnow_mesh_info(bytes('070809'))").v, true);
  h.run(6000);
  const short = h.berry(1, "espnow_mesh_neighbors()").v.find((n) => n.id === 2);
  assert.equal(short.info.length, 40);
  assert.equal(short.info.slice(24), "000000000000" + "00" + "01", "the application's bytes are gone, and the flags are the core's");
  assert.equal(h.berry(2, "espnow_mesh_info(bytes().fromstring('x'*33))").v, false, "33 bytes are refused");
  t.diagnostic(`five clocks read at one instant ${spread} ms apart; a stamp 1.2 s old reads ${age.age} ms; the heartbeats carry 20 to 32 bytes`);
});

// =====================================================================================================================================
// E. a device that restarts
// =====================================================================================================================================

test("a device that loses its power starts its node again under the next epoch, in a timeline of its own whose clock begins at 0: it has no stamp until it takes the house's, then Berry is told the Timeline and Synced once, and the others are told nothing", async (t) => {
  const h = await meshHouse();
  for (const id of h.ids) h.berry(id, "espnow_mesh_ready()");
  h.run(70_000);
  const house = [...h.net.timelines()];
  assert.equal(house.length, 1);
  const baseline = Object.fromEntries(h.ids.map((id) => [id, [h.read(id).timelines.length, h.read(id).synced.length]]));
  const epochBefore = record(h.dev(2)).epoch;
  const houseAge = h.mesh(1);
  await h.power(2, 3000);
  const bootAt = h.home.now;
  assert.ok(!h.net.air.node(2).on, "while the device boots the node is not in the air");
  assert.deepEqual(h.berry(2, "espnow_mesh_clock()"), { v: false }, "the new device's driver has not started");
  // the first second: the driver starts, under the next epoch, which the record in the flash holds
  let started = null;
  for (let ms = 0; ms < 1500 && started === null; ms += 5) {
    h.run(5);
    if (h.dev(2).mesh.running) started = h.home.now;
  }
  assert.ok(started !== null, "the node starts within a second of the boot");
  assert.deepEqual(h.berry(2, "espnow_mesh_clock()"), { v: false }, "the instant it starts the task has not made its clock yet");
  h.run(5);
  assert.equal(record(h.dev(2)).epoch, epochBefore + 1, "under the epoch after the one it had: it rose by one, and the flash holds it");
  assert.equal(h.status(2).Epoch, epochBefore + 1);
  const own = h.berry(2, "espnow_mesh_clock()").v;
  assert.ok(own, "the clock is read once the task has made it");
  assert.equal(own.synced, false, "not synced: it has heard no one yet");
  assert.equal(own.adopted, false);
  assert.equal(own.taken, 0);
  const ownTl = Buffer.alloc(5);
  ownTl[0] = 2;
  ownTl.writeUInt32BE(epochBefore + 1, 1);
  assert.equal(own.timeline, tlHex(ownTl), "in the timeline of its own: its number and its epoch");
  assert.ok(own.lo < 50, `a clock that begins at 0: ${own.lo} ms`);
  assert.deepEqual(h.berry(2, "espnow_mesh_stamp()"), { v: false }, "no stamp while it is not synced: the sender has nothing to send");
  assert.deepEqual(h.berry(2, "send_cmd(1, bytes('00'))"), { v: false });
  assert.deepEqual([h.read(2).timelines, h.read(2).synced], [[], []], "and the restart itself is told to no one: a timeline begun is no event");
  // it hears the house and takes its timeline: by the difference of the ages
  let at = null;
  for (let ms = 0; ms < 20_000 && at === null; ms += 5) {
    h.run(5);
    if (h.read(2).timelines.length > 0) at = h.home.now;
  }
  assert.ok(at !== null, "it takes the house's timeline");
  const mine = h.read(2);
  assert.equal(mine.timelines.length, 1);
  const e = mine.timelines[0];
  assert.deepEqual([e.Old, e.New, e.Synced], [tlHex(ownTl), house[0], 1], "the one it left, the one it took, and it is synced");
  assert.equal(Number(e.Delta) % 1, 0);
  const ownAge = at - started;
  const expected = h.mesh(1) - ownAge;
  assert.ok(Math.abs(Number(e.Delta) - expected) <= 60, `it moved by ${e.Delta} ms: the house's age ${h.mesh(1)} ms less its own ${ownAge} ms, ${Math.round(expected)}`);
  assert.equal(e.Ticks, Math.floor(Number(e.Delta) / 100 + 0.5), "the ticks of 100 ms are the move, rounded");
  assert.ok(Number(e.Delta) > 60_000, "and the move is the age of the house: more than a minute");
  assert.equal(mine.synced.length, 1, "told once that it is synced");
  assert.deepEqual([mine.synced[0].Value, mine.synced[0].Timeline], [1, house[0]]);
  const clock = h.berry(2, "espnow_mesh_clock()").v;
  assert.deepEqual([clock.synced, clock.adopted, clock.taken, clock.timeline], [true, true, 1, house[0]]);
  assert.ok(Math.abs(clock.lo - h.mesh(1)) <= 15, "its clock is the house's");
  assert.ok(h.berry(2, "espnow_mesh_stamp()").v, "it stamps now");
  for (const id of [1, 3, 4, 5]) assert.deepEqual([h.read(id).timelines.length, h.read(id).synced.length], baseline[id], `node ${id}: told nothing by the restart of the node 2`);
  // the two orders the rules are told in: the timeline, and then the synced bit
  const order = h.dev(2).mesh.told.filter((j) => /Timeline|Synced/.test(j));
  assert.ok(order[0].includes('"Timeline":{') && order[1].includes('"Synced":{'), "the timeline taken is told before the synced bit");
  // the others heard it: the node came back, and its record in the flash is the same but for the epoch
  const rec = record(h.dev(2));
  assert.deepEqual([rec.id, rec.enabled, rec.hasGroup, tlHex(rec.groupKey)], [2, 1, 1, KEY]);
  t.diagnostic(`the node 2 restarted and started ${started - bootAt} ms after its boot: it took the house's timeline ${at - started} ms after, by ${e.Delta} ms (the house was ${Math.round(houseAge)} ms old when the power went, ${h.mesh(1)} when it was taken)`);
});

// =====================================================================================================================================
// F. the mesh alone restarts
// =====================================================================================================================================

test("the mesh of a device restarts by itself (EspNowMeshEnable 0 and 1): the functions are false while it is stopped, and it comes back in a new timeline, its clock at 0, and no event for it", async () => {
  const h = await meshHouse();
  for (const id of h.ids) h.berry(id, "espnow_mesh_ready()");
  h.run(40_000);
  const house = [...h.net.timelines()][0];
  const epoch = record(h.dev(4)).epoch;
  const baseline = [h.read(4).timelines.length, h.read(4).synced.length];
  h.berry(4, "espnow_mesh_info(bytes('000000000000000000000000') + bytes().fromstring('mine'))");
  h.run(6000);
  assert.ok(h.berry(1, "espnow_mesh_neighbors()").v.find((n) => n.id === 4).info.includes("6D696E65"), "its application's bytes are in its heartbeat");
  assert.deepEqual(h.cmd(4, "EspNowMeshEnable 0"), { EspNowMeshEnable: { Enabled: 0, Running: 0 } });
  for (const f of ["espnow_mesh_clock()", "espnow_mesh_stamp()", "espnow_mesh_health()", "espnow_mesh_neighbors()", "send_cmd(1, bytes('00'))"]) assert.deepEqual(h.berry(4, f), { v: false }, `${f} while stopped`);
  assert.deepEqual(h.cmd(4, "EspNowMeshClock"), { EspNowMeshClock: "not running" });
  assert.ok(!h.net.air.node(4).on, "the node is out of the air");
  assert.equal(h.status(4).Ready, 1, "the application's readiness is the driver's, not the task's: it stays");
  assert.equal(record(h.dev(4)).enabled, 0, "the flash holds that it is off");
  h.run(2000);
  assert.deepEqual(h.cmd(4, "EspNowMeshEnable 1"), { EspNowMeshEnable: { Enabled: 1, Running: 1 } });
  assert.equal(record(h.dev(4)).epoch, epoch + 1, "a start is a new epoch");
  h.run(20);
  const c = h.berry(4, "espnow_mesh_clock()").v;
  assert.deepEqual([c.synced, c.adopted, c.taken], [false, false, 0]);
  assert.ok(c.lo < 100, "a clock at 0 again");
  assert.notEqual(c.timeline, house, "in a timeline of its own: a start is a new timeline");
  assert.deepEqual([h.read(4).timelines.length, h.read(4).synced.length], baseline, "no event for the restart: Berry compares the timeline each time it reads the clock");
  // the application's bytes went with the old node: the heartbeat carries none of them until Berry says them again
  h.run(8000);
  assert.ok(!h.berry(1, "espnow_mesh_neighbors()").v.find((n) => n.id === 4).info.includes("6D696E65"));
  // it joins: the house's timeline, one event, by the age
  h.run(10_000);
  assert.equal(h.read(4).timelines.length, baseline[0] + 1, "and one when it joins");
  assert.equal(h.read(4).timelines.at(-1).New, house);
  assert.deepEqual(h.net.timelines().size, 1);
  assert.equal(meshRestart(h.dev(4)) !== null, true, "meshRestart is the same two commands");
  assert.equal(h.status(4).Epoch, epoch + 2);
});

// =====================================================================================================================================
// G and H. the house cut in two, the crystals drifting
// =====================================================================================================================================

/** the mesh times of the nodes of a group, ms, read from the air at one instant */
const times = (h, ids) => ids.map((id) => h.mesh(id));
const within = (xs) => Math.max(...xs) - Math.min(...xs);

test("the house cut in two for five minutes, the crystals at +250 and -250 ppm: each group keeps one clock, the groups come apart by the difference of their paces, and the join steps the slow group forward to within a few ms, with no timeline taken (mesh-clock C9)", async (t) => {
  const h = await meshHouse();
  for (const id of h.ids) h.berry(id, "espnow_mesh_ready()");
  h.run(60_000);
  assert.equal(h.net.timelines().size, 1);
  const A = [1, 2, 4], B = [3, 5];
  const baseline = Object.fromEntries(h.ids.map((id) => [id, h.read(id).timelines.length]));
  assert.ok(baseline[2] === 1 && baseline[1] === 0, "the nodes of the higher numbers took node 1's timeline when the house came up: that is the baseline");
  for (const id of A) meshDrift(h.home, id, 250);
  for (const id of B) meshDrift(h.home, id, -250);
  meshPartition(h.home, A, B);
  let worst = 0;
  const cut = h.home.now;
  for (let s = 0; s < 300; s += 5) {
    h.run(5000);
    worst = Math.max(worst, within(times(h, A)), within(times(h, B)));
  }
  assert.ok(worst < 10, `inside each group the clocks were never more than ${worst} ms apart while the groups were cut off (mesh-clock C8: under 10 ms)`);
  const apart = Math.max(...times(h, A)) - Math.max(...times(h, B));
  const expected = (250 - -250) * 1e-6 * (h.home.now - cut);
  assert.ok(Math.abs(apart - expected) < 25, `the groups read ${apart} ms apart, by the drift of 300 s at the paces of their crystals: ${expected} ms (C9 has the same formula, over 17 days)`);
  // Berry reads the same two clocks
  const berryA = h.berry(1, "espnow_mesh_clock()").v.lo, berryB = h.berry(3, "espnow_mesh_clock()").v.lo;
  assert.ok(Math.abs(berryA - berryB - apart) <= 15, `Berry on the two sides: ${berryA - berryB} ms apart`);
  assert.ok(h.ids.every((id) => h.berry(id, "espnow_mesh_clock()").v.synced), "every node is synced on its own side: it has its timeline");
  // the cut shows in the neighbours: a node of one group does not hear the other, and each is told the others are silent
  assert.deepEqual(h.berry(1, "espnow_mesh_neighbors()").v.map((n) => n.id).sort(), [2, 3, 4, 5], "the neighbours are listed until they are given up");
  assert.ok(h.read(1).notices.some((n) => n.Kind === "Silent" && n.Node === 3) && h.read(1).notices.some((n) => n.Kind === "Silent" && n.Node === 5), "Berry was told the other group is silent");
  assert.ok(h.read(3).notices.some((n) => n.Kind === "Silent" && n.Node === 1), "and the other way");
  const stepsBefore = Object.fromEntries(h.ids.map((id) => [id, h.cmd(id, "EspNowMeshClock").EspNowMeshClock.Steps]));
  // they hear each other again
  meshHeal(h.home);
  h.run(30_000);
  const all = h.ids.map((id) => h.mesh(id));
  assert.ok(within(all) < 15, `after the join the five clocks are within ${within(all)} ms of each other`);
  assert.equal(h.net.timelines().size, 1, "one timeline all along");
  for (const id of h.ids) {
    assert.equal(h.read(id).timelines.length, baseline[id], `node ${id}: no timeline taken since, so Berry is told nothing and the marks it made stay as they are`);
    assert.equal(h.berry(id, "espnow_mesh_clock()").v.taken, baseline[id]);
  }
  const stepsAfter = Object.fromEntries(h.ids.map((id) => [id, h.cmd(id, "EspNowMeshClock").EspNowMeshClock.Steps]));
  assert.ok(B.every((id) => stepsAfter[id] > stepsBefore[id]), `the slow group stepped forward to the fast one: ${JSON.stringify(stepsBefore)} then ${JSON.stringify(stepsAfter)}`);
  assert.ok(h.read(1).notices.some((n) => n.Kind === "Back" && n.Node === 3), "and the nodes that were silent are back");
  t.diagnostic(`cut for 300 s at +250 and -250 ppm: the groups ${apart} ms apart (the crystals say ${expected} ms), inside a group never more than ${worst} ms; after the join the five clocks within ${within(all)} ms, the slow group stepped ${B.map((id) => stepsAfter[id] - stepsBefore[id]).join(" and ")} times, no timeline taken`);
});

test("the same cut with the whole of one group restarted: the group is in a younger timeline of its own, and the join moves it into the older by the difference of the ages, which the Berry of each node is told (mesh-clock C8)", async (t) => {
  const h = await meshHouse();
  for (const id of h.ids) h.berry(id, "espnow_mesh_ready()");
  h.run(60_000);
  const house = [...h.net.timelines()][0];
  const A = [1, 2, 4], B = [3, 5];
  const baseline = Object.fromEntries(A.map((id) => [id, h.read(id).timelines.length]));
  for (const id of A) meshDrift(h.home, id, 250);
  for (const id of B) meshDrift(h.home, id, -250);
  meshPartition(h.home, A, B);
  h.run(60_000);
  // the power goes in the group B, both devices, and comes back 2 s later
  const old = [h.dev(3), h.dev(5)];
  for (const d of old) d.unplug();
  h.run(2000);
  const restartedAt = h.home.now;
  const born = [];
  for (const [i, id] of [3, 5].entries()) {
    const d = await old[i].powerCycle();
    h.devices.set(id, d);
    assert.equal(d.vm.run(SCRIPT, "mesh-test"), 0, d.vm.error());
    born.push(d);
  }
  for (const id of B) h.berry(id, "espnow_mesh_ready()");
  h.run(120_000);
  const youngTl = [...new Set(B.map((id) => tlHex(h.net.air.clock(id).timeline)))];
  assert.equal(youngTl.length, 1, "the group B is in one timeline");
  assert.notEqual(youngTl[0], house, "and it is a new one, younger than the house's");
  assert.deepEqual(B.map((id) => h.berry(id, "espnow_mesh_clock()").v.synced), [true, true], "synced on their side: they have listened");
  assert.equal(h.net.air.clock(5).timeline[0], 3, "the node of the higher number took the lower's: both restarted together");
  // what the restart cost the younger group, in time: the ages differ by what the group B lived through before its restart, less the drift of the rest
  const A0 = Math.max(...times(h, A)), B0 = Math.max(...times(h, B));
  const healed = h.home.now;
  meshHeal(h.home);
  h.run(40_000);
  assert.equal(h.net.timelines().size, 1, "one timeline after the join");
  assert.equal([...h.net.timelines()][0], house, "the older: the group A's, the house's");
  const moved = B.map((id) => ({ id, events: h.read(id).timelines }));
  for (const m of moved) {
    const e = m.events.at(-1);
    assert.equal(e.New, house, `node ${m.id} took the house's timeline`);
    assert.equal(e.Old, youngTl[0], "from the younger group's");
    assert.equal(e.Ticks, Math.floor(Number(e.Delta) / 100 + 0.5), "the move in ticks of 100 ms is the move rounded");
    // the move is the older group's time at the meeting less the younger's: what they were when the groups heard each other, and the drift of the seconds that took
    const analytic = A0 - B0;
    assert.ok(Math.abs(Number(e.Delta) - analytic) < 60, `node ${m.id} moved by ${e.Delta} ms: the groups' clocks stood ${Math.round(analytic)} ms apart when they met`);
  }
  assert.deepEqual(A.map((id) => h.read(id).timelines.length), A.map((id) => baseline[id]), "the nodes of the house's timeline took none since");
  // the same number from the first principles: the older group's age at the meeting, the younger's age since it restarted (both at the pace of their crystals)
  const ageA = h.mesh(1);
  const startB = h.logs.filter((l) => l.who === "b3" && l.line.startsWith("EMH: Started as node 3")).at(-1).at;
  assert.ok(startB >= restartedAt, "the younger group began its timeline when it restarted");
  const clocksAfter = h.ids.map((id) => h.mesh(id));
  assert.ok(within(clocksAfter) < 15, `after the join the five clocks are within ${within(clocksAfter)} ms`);
  assert.ok(Number(moved[0].events.at(-1).Delta) > 100_000, "the move is the age of the house's timeline less the group's: more than the 100 s the group had lived");
  void ageA;
  t.diagnostic(`group B restarted at ${restartedAt} ms and met the house at ${healed} ms: moved by ${moved.map((m) => `node ${m.id} ${m.events.at(-1).Delta} ms`).join(" and ")} (the clocks stood ${Math.round(A0 - B0)} ms apart); after the join within ${within(clocksAfter)} ms`);
});

// =====================================================================================================================================
// I. the record in the NVS
// =====================================================================================================================================

test("the record the driver keeps in the NVS survives a power cycle byte for byte but for the epoch; a mesh turned off stays off; the record of another chip, a clone, loses its number and its identity and waits to be numbered", async () => {
  const h = await meshHouse({ bridges: [1, 2], panels: [] });
  h.run(20_000);
  const first = h.dev(2).nvm[RECORD];
  assert.equal(first.length, 2 * 2188, "the record as one blob of 2188 bytes, as the firmware saves it");
  const r1 = MeshRecord.decode(Uint8Array.from(Buffer.from(first, "hex")));
  assert.deepEqual([r1.id, r1.enabled, r1.network, r1.channel, r1.hasGroup, r1.groupVersion, r1.hasSecret], [2, 1, 0, 0, 1, 1, 1]);
  assert.equal(tlHex(r1.groupKey), KEY);
  assert.deepEqual(r1.node.filter((n) => n.id).map((n) => n.id), [1], "the node it was given: the other one, as the bench's setup gives it");
  assert.equal(r1.node[0].ip.join("."), "192.168.0.61");
  assert.equal(r1.node[0].mac.map((x) => x.toString(16).padStart(2, "0")).join(":").toUpperCase(), "A0:B7:65:77:00:01");
  assert.equal(tlHex(r1.mac), "A0B765770002", "the station address of the chip it was made on");
  assert.equal(h.cmd(1, "EspNowMeshNode").EspNowMeshNode.length, 1, "the other has it too");
  // a power cycle: the same record under the next epoch, and the mesh back by itself, as the image's driver is
  const d = await h.power(2, 1000);
  const r2 = record(d);
  assert.deepEqual([r2.id, r2.enabled, r2.hasGroup, tlHex(r2.groupKey), r2.node[0].id, tlHex(r2.secret)], [2, 1, 1, KEY, 1, tlHex(r1.secret)], "the number, the key, the nodes and the identity");
  assert.equal(r2.epoch, r1.epoch, "(the epoch rises at the start, not at the boot)");
  h.run(1500);
  assert.equal(record(h.dev(2)).epoch, r1.epoch + 1, "the epoch rose with the start");
  assert.ok(h.dev(2).mesh.running);
  // a mesh that was turned off stays off across a power cycle
  h.cmd(2, "EspNowMeshEnable 0");
  const off = await h.power(2, 500);
  h.run(3000);
  assert.equal(h.status(2).Running, 0, "off");
  assert.equal(record(off).enabled, 0);
  assert.ok(!h.status(2).Why, "nothing is missing: it was told to stop");
  assert.deepEqual(h.cmd(2, "EspNowMeshEnable 1"), { EspNowMeshEnable: { Enabled: 1, Running: 1 } });
  assert.equal(record(h.dev(2)).epoch, r1.epoch + 2);
  // the commands change the record, and the record is saved each time
  assert.deepEqual(h.cmd(2, "EspNowMeshId 9"), { EspNowMeshId: 9 });
  assert.equal(record(h.dev(2)).id, 9, "(the number takes effect at the next start)");
  assert.deepEqual(h.cmd(2, "EspNowMeshId 0"), { EspNowMeshId: "Error" });
  assert.deepEqual(h.cmd(2, "EspNowMeshId 255"), { EspNowMeshId: "Error" });
  h.cmd(2, "EspNowMeshId 2");
  assert.deepEqual(h.cmd(2, "EspNowMeshNetwork 5"), { EspNowMeshNetwork: 5 });
  assert.deepEqual(h.cmd(2, "EspNowMeshChannel 14"), { EspNowMeshChannel: "Error" });
  assert.deepEqual(h.cmd(2, "EspNowMeshChannel 6"), { EspNowMeshChannel: 6 });
  assert.deepEqual(h.cmd(2, "EspNowMeshGroupKey 12"), { EspNowMeshGroupKey: "Error" });
  assert.deepEqual(h.cmd(2, `EspNowMeshGroupKey ${KEY},3`), { EspNowMeshGroupKey: { Set: 1, Version: 3, Previous: 0 } });
  assert.deepEqual([record(h.dev(2)).network, record(h.dev(2)).channel, record(h.dev(2)).groupVersion], [5, 6, 3]);
  assert.deepEqual(h.cmd(2, "EspNowMeshNode 7,A0:B7:65:00:00:07," + "ab".repeat(32) + ",192.168.0.77"), { EspNowMeshNode: "Done" });
  assert.deepEqual(h.cmd(2, "EspNowMeshNode").EspNowMeshNode.map((n) => n.Id), [1, 7]);
  assert.deepEqual(h.cmd(2, "EspNowMeshNode 7,0"), { EspNowMeshNode: "Done" });
  assert.deepEqual(h.cmd(2, "EspNowMeshNode").EspNowMeshNode.map((n) => n.Id), [1], "forgotten");
  assert.deepEqual(h.cmd(2, "EspNowMeshNode 7,xx,yy"), { EspNowMeshNode: "Error" });

  // the flash of the device 2 put in a device with another address: a clone
  const kept = h.dev(2).kept();
  const logs = [];
  const clone = await SimBridge.create({ house: h.home, files: bridgeFiles(), mac: "A0:B7:65:77:00:AA", ip: "192.168.0.99", hostname: "zbbridge-clone", epoch: EPOCH,
    nvm: kept.nvm, mesh: { id: 2, groupKey: KEY }, onLog: (level, line) => logs.push(line) });
  h.devices.set(99, clone);
  h.run(3000);
  assert.ok(logs.some((l) => l.includes("The record was made on the chip A0:B7:65:77:00:02, and this is another")), "the log says it was made on another chip");
  assert.ok(logs.some((l) => l.includes("its node number 2 was cleared and the mesh is off")));
  const st = JSON.parse(clone.console("EspNowMeshStatus")).EspNowMeshStatus;
  assert.deepEqual([st.Running, st.Id, st.Why], [0, 0, "needs EspNowMeshId"], "no number, the mesh off, and what is missing");
  const cr = clone.mesh.record;
  assert.deepEqual([cr.id, cr.enabled, cr.hasSecret, cr.epoch, tlHex(cr.mac), tlHex(cr.groupKey)], [0, 0, 0, 0, "A0B7657700AA", KEY], "no identity, no epoch, the address of this chip; the key and the nodes are the copy's");
  assert.equal(record(clone).id, 2, "(the flash is written at the first command that changes the record, as the firmware's is)");
  assert.equal(JSON.parse(clone.console("EspNowMeshId 12")).EspNowMeshId, 12);
  assert.equal(JSON.parse(clone.console("EspNowMeshEnable 1")).EspNowMeshEnable.Running, 1, "numbered and started");
  assert.notEqual(tlHex(record(clone).secret), tlHex(r1.secret), "with an identity of its own");
  assert.equal(JSON.parse(clone.console("EspNowMeshPublic")).EspNowMeshPublic.Mac, "A0:B7:65:77:00:AA");
});

// =====================================================================================================================================
// J. a node out of the radio's reach
// =====================================================================================================================================

test("a node out of the radio's reach is declared silent by the others, whose Berry is told with the Notice, and is back when it is heard again", async (t) => {
  const h = await meshHouse();
  for (const id of h.ids) h.berry(id, "espnow_mesh_ready()");
  h.run(60_000);
  meshIsolate(h.home, 4);
  const t0 = h.home.now;
  let silentAt = null;
  for (let s = 0; s < 80 && silentAt === null; s++) {
    h.run(1000);
    if ([1, 2, 3, 5].every((id) => h.read(id).notices.some((n) => n.Kind === "Silent" && n.Node === 4))) silentAt = h.home.now - t0;
  }
  assert.ok(silentAt !== null, "every node but the one out of reach is told it is silent");
  assert.ok(silentAt >= 15_000 && silentAt <= 45_000, `${silentAt} ms after: 15 s without a heartbeat, a probe, and the verdict (some 22 to 27 s)`);
  const n = h.read(1).notices.find((x) => x.Kind === "Silent" && x.Node === 4);
  assert.deepEqual(Object.keys(n).sort(), ["By", "Kind", "Node", "Value"].sort());
  assert.ok([1, 2, 3, 5].includes(n.By) && n.Value === 0);
  // and the node out of reach sees the others silent too
  assert.ok(h.read(4).notices.some((x) => x.Kind === "Silent"), "the isolated node declares the others silent");
  meshHeal(h.home);
  let backAt = null;
  const t1 = h.home.now;
  for (let s = 0; s < 60 && backAt === null; s++) {
    h.run(1000);
    if ([1, 2, 3, 5].every((id) => h.read(id).notices.some((x) => x.Kind === "Back" && x.Node === 4))) backAt = h.home.now - t1;
  }
  assert.ok(backAt !== null && backAt <= 30_000, `back ${backAt} ms after it is heard again`);
  t.diagnostic(`isolated at ${t0} ms: Silent in every other node's Berry after ${silentAt} ms, Back ${backAt} ms after it was heard again`);
});

// =====================================================================================================================================
// K. the queue to the task, EspNowMeshSend, and the devices with no driver
// =====================================================================================================================================

test("the main loop's queue to the task holds 4: the fifth send in one instant is not taken, the tickets count the ones that were, and EspNowMeshSend answers as the firmware's does", async () => {
  const h = await meshHouse({ bridges: [1, 2, 3], panels: [] });
  for (const id of h.ids) h.berry(id, "espnow_mesh_ready()");
  h.run(40_000);
  const tickets = [];
  for (let i = 0; i < 6; i++) tickets.push(h.berry(1, "espnow_mesh_send(2, 0, true, bytes('0a'))").v);
  assert.deepEqual(tickets, [1, 2, 3, 4, false, false], "the queue to the task has 4 places, and the task is given a turn at the next step of the air");
  h.run(1);
  assert.equal(JSON.parse(h.dev(1).console("EspNowMeshStats")).EspNowMeshStats.CmdBusy, 2, "and the driver counted what it refused");
  h.run(2000);
  assert.deepEqual(h.read(1).outcomes.map((o) => [o.Counter, o.Ok]).sort((a, b) => a[0] - b[0]), [[1, 1], [2, 1], [3, 1], [4, 1]], "each of the four answered, under its ticket");
  assert.equal(h.read(2).ran.length, 0);
  assert.equal(h.read(2).frames.length, 4);
  // the next send is a ticket on
  assert.equal(h.berry(1, "espnow_mesh_send(2, 0, true, bytes('0b'))").v, 5);
  // the command: the ticket as the function's, the refusals as the firmware words them
  h.run(10);
  assert.deepEqual(h.cmd(1, "EspNowMeshSend 2,0,1,hello"), { EspNowMeshSend: { Queued: 1, Counter: 6 } });
  assert.deepEqual(h.cmd(1, "EspNowMeshSend 255,2,0,0x0102"), { EspNowMeshSend: { Queued: 1, Counter: 7 } });
  assert.deepEqual(h.cmd(1, "EspNowMeshSend 2,4,1,hello"), { EspNowMeshSend: "the heartbeat is the mesh's" });
  assert.deepEqual(h.cmd(1, "EspNowMeshSend 2,0,1"), { EspNowMeshSend: "dest,type,flags,payload" });
  assert.deepEqual(h.cmd(1, "EspNowMeshSend 256,0,1,x"), { EspNowMeshSend: "dest 0..255, type 0..7, flags 0..3" });
  assert.deepEqual(h.cmd(1, `EspNowMeshSend 2,0,1,0x${"aa".repeat(221)}`), { EspNowMeshSend: "too long", Max: 220 });
  assert.deepEqual(h.cmd(1, `EspNowMeshSend 255,2,0,0x${"aa".repeat(228)}`), { EspNowMeshSend: { Queued: 1, Counter: 8 } }, "a state for everyone may be 228");
  assert.deepEqual(h.cmd(1, "EspNowMeshSend 2,0,1,0xZZ"), { EspNowMeshSend: "Error" });
  h.run(1000);
  assert.deepEqual(h.read(1).outcomes.map((o) => o.Counter).slice(4), [5, 6], "an outcome for each of the sends that asked for one and had one destination, and none for the ones for everyone");
  // the status and the counters
  const st = h.status(1);
  assert.deepEqual([st.Running, st.Id, st.Group, st.Ready, st.Neighbors], [1, 1, 1, 1, 2]);
  assert.ok(st.SentOwn > 0 && st.AcksHeard >= 6 && st.Beats > 0 && st.Heard > 0);
  const s0 = JSON.parse(h.dev(1).console("EspNowMeshStats 0")).EspNowMeshStats, s1 = JSON.parse(h.dev(1).console("EspNowMeshStats 1")).EspNowMeshStats;
  assert.deepEqual([s0.Page, s0.Running, s0.CmdBusy, s0.Refused, s1.Page], [0, 1, 2, 0, 1]);
  assert.ok(s1.BeatsSent > 0 && s1.BeatsHeard > 0 && s1.CounterOut === 0);
  assert.deepEqual(JSON.parse(h.dev(1).console("EspNowMeshStats 2")), { EspNowMeshStats: "page 0 or 1" });
  // a payload the core cannot take is an outcome that is not ok, with no attempts, as the driver tells it: no key for a node that is not one
  const t9 = h.berry(1, "espnow_mesh_send(200, 0, true, bytes('01'))").v;
  h.run(2000);
  const refused = h.read(1).outcomes.at(-1);
  assert.equal(refused.Counter, t9, "the ticket of the send");
  assert.ok(refused.Ok === 0 && refused.Dest === 200, `${JSON.stringify(refused)}: not answered`);
  assert.deepEqual([refused.QueueUs, refused.RttUs], [0, 0], "and no times: it never went");
});

test("a device whose image has no mesh driver in a house that has a mesh: no functions, no commands, no node on the air, and its boot is the same", async () => {
  const home = new SimHouse();
  await home.enableMesh();
  const plain = await SimBridge.create({ house: home, files: bridgeFiles(), mac: "A0:B7:65:77:00:09", ip: "192.168.0.69", hostname: "zbbridge-9", epoch: EPOCH });
  const meshed = await SimBridge.create({ house: home, files: bridgeFiles(), mac: "A0:B7:65:77:00:01", ip: "192.168.0.61", hostname: "zbbridge-1", epoch: EPOCH, mesh: { id: 1, groupKey: KEY } });
  home.advance(30_000);
  assert.equal(plain.mesh, undefined);
  assert.deepEqual(JSON.parse(plain.console("EspNowMeshStatus")), { Command: "Unknown" });
  assert.notEqual(plain.vm.run("espnow_mesh_clock()", "x"), 0, "the function is not there: the firmware without the driver has none");
  assert.notEqual(plain.vm.run("espnow_mesh_send(1, 0, true, bytes())", "x"), 0);
  assert.equal(meshed.vm.run("var mesh_ok = espnow_mesh_clock()", "x"), 0);
  assert.deepEqual(home.mesh.air.nodes.map((n) => n.id), [1], "one node on the air: the other device has none");
  assert.equal(plain.wifi.up, true);
  // a house with no mesh refuses a device that wants one, and says why
  const bare = new SimHouse();
  await assert.rejects(() => SimBridge.create({ house: bare, files: bridgeFiles(), mesh: { id: 1, groupKey: KEY } }), /needs a house that has a mesh/);
});

// =====================================================================================================================================
// L. rooms in a row
// =====================================================================================================================================

test("rooms five metres apart in a row, ten dB a wall: each node hears the next two and no more, and a command from one end to the other crosses the house by the relays, stamped, and run at its owner", async (t) => {
  const room = (id) => id - 1;
  const h = await meshHouse({ at: (id) => [5 * room(id), 0], links: placesLinks(2.2, (a, b) => 10 * Math.abs(room(a.id) - room(b.id))) });
  for (const id of h.ids) h.berry(id, "espnow_mesh_ready()");
  h.run(1100);
  assert.equal(h.net.air.heard(1, 2) < -60 && h.net.air.heard(1, 2) > -70, true, `the next room: ${h.net.air.heard(1, 2)} dBm`);
  assert.ok(h.net.air.heard(1, 3) <= -78 && h.net.air.heard(1, 3) >= -86, `two rooms away: ${h.net.air.heard(1, 3)} dBm`);
  assert.equal(h.net.air.heard(1, 4), undefined, "three rooms away: out of reach");
  assert.equal(h.net.air.heard(1, 5), undefined, "and four");
  h.run(90_000);
  assert.equal(h.net.timelines().size, 1, "one timeline across the house: the clock crossed the rooms by the heartbeats of the middle ones");
  assert.deepEqual(h.berry(1, "espnow_mesh_neighbors()").v.map((n) => n.id).sort(), [2, 3], "the first room hears the next two");
  assert.deepEqual(h.berry(3, "espnow_mesh_neighbors()").v.map((n) => n.id).sort(), [1, 2, 4, 5], "the middle one hears them all");
  assert.equal(h.berry(1, "espnow_mesh_health()").v.alone, 0);
  const ages = [];
  for (let i = 0; i < 10; i++) {
    const t0 = h.home.now;
    const ticket = h.berry(1, `send_cmd(5, bytes().fromstring("far${i}"))`).v;
    assert.ok(ticket >= 1);
    h.run(400 + ((i * 29) % 50));
    const ran = h.read(5).ran.at(-1);
    assert.equal(ran.body, `far${i}`, `the command ${i} crossed the house in ${h.home.now - t0} ms`);
    ages.push(ran.age);
  }
  assert.deepEqual(h.read(5).refused, []);
  const o = h.read(1).outcomes;
  assert.ok(o.length === 10 && o.every((x) => x.Ok === 1 && x.Dest === 5), "each answered, along the way back");
  assert.ok(h.read(5).frames.every((f) => f.Behind === 0 && f.From === 1 && f.Flags === 1));
  assert.ok([2, 3, 4].some((id) => h.status(id).SentRelay > 0), "and the middle rooms repeated it: that is how it crossed");
  t.diagnostic(`10 commands over two hops: run ${Math.min(...ages)} to ${Math.max(...ages)} ms old; one timeline across the five rooms`);
});

// =====================================================================================================================================
// M. the network as a second way
// =====================================================================================================================================

test("with no radio between the nodes at all and the network bit on, the nodes find each other and talk over the house's network, and a node with the network bit off is out of it", async () => {
  const h = await meshHouse({ bridges: [1, 2, 3], panels: [], links: () => undefined, network: 1 });
  for (const id of h.ids) h.berry(id, "espnow_mesh_ready()");
  h.run(60_000);
  assert.equal(h.net.timelines().size, 1, "one timeline: the heartbeats came by the network");
  assert.deepEqual(h.berry(1, "espnow_mesh_neighbors()").v.map((n) => n.id).sort(), [2, 3]);
  const s = h.status(1);
  assert.ok(s.UdpSent > 0 && s.UdpHeard > 0 && s.NetUp === 1, `by the network: ${s.UdpSent} sent, ${s.UdpHeard} heard`);
  const ticket = h.berry(1, "send_cmd(3, bytes().fromstring('net'))").v;
  h.run(500);
  assert.equal(h.read(3).ran.at(-1).body, "net");
  assert.equal(h.read(1).outcomes.at(-1).Counter, ticket);
  // the same nodes with the network bit off hear no one
  h.cmd(2, "EspNowMeshNetwork 0");
  h.cmd(2, "EspNowMeshEnable 0");
  h.cmd(2, "EspNowMeshEnable 1");
  h.run(40_000);
  assert.deepEqual(h.berry(2, "espnow_mesh_neighbors()").v, [], "no radio and no network: alone");
});

test("the router goes away: with no radio between them the nodes lose the network, each declares the others silent and its Berry is told, and when the router is back they are heard again", async (t) => {
  const h = await meshHouse({ bridges: [1, 2, 3], panels: [], links: () => undefined, network: 1 });
  for (const id of h.ids) h.berry(id, "espnow_mesh_ready()");
  h.run(60_000);
  assert.equal(h.status(1).NetUp, 1);
  routerOff(h.home);
  h.run(20_000);
  assert.equal(h.status(1).NetUp, 0, "the network is down for the core: its WiFi lost the station's network");
  const before = h.status(1).UdpSent;
  h.run(5000);
  assert.equal(h.status(1).UdpSent, before, "and nothing is sent by it");
  let silentAt = null;
  const t0 = h.home.now;
  for (let s = 0; s < 60 && silentAt === null; s++) {
    h.run(1000);
    if ([2, 3].every((n) => h.read(1).notices.some((x) => x.Kind === "Silent" && x.Node === n))) silentAt = h.home.now - t0;
  }
  assert.ok(silentAt !== null, "the node 1 declares the other two silent, and its Berry is told");
  routerOn(h.home);
  let back = null;
  const t1 = h.home.now;
  for (let s = 0; s < 90 && back === null; s++) {
    h.run(1000);
    if ([2, 3].every((n) => h.read(1).notices.some((x) => x.Kind === "Back" && x.Node === n))) back = h.home.now - t1;
  }
  assert.ok(back !== null, "and they are back once the router is");
  assert.equal(h.status(1).NetUp, 1);
  t.diagnostic(`the router gone: the others silent in the Berry of node 1 ${silentAt + 25_000} ms after it went, back ${back} ms after it returned`);
});

// =====================================================================================================================================
// N. the end of the frame counter
// =====================================================================================================================================

test("the node whose frame counter is near its end asks for the next epoch, which the driver cannot give it but by a start: the mesh stops and starts again under the epoch after, a new timeline, with no number used twice", async () => {
  const h = await meshHouse({ bridges: [1, 2, 3], panels: [] });
  for (const id of h.ids) h.berry(id, "espnow_mesh_ready()");
  h.run(40_000);
  const house = [...h.net.timelines()][0];
  const epoch = record(h.dev(1)).epoch;
  assert.equal(JSON.parse(h.dev(1).console("EspNowMeshStats 1")).EspNowMeshStats.CounterOut, 0);
  // the counter, 32 numbers before the point at which the core asks (0xFFFF0000), and events across it, 60 ms apart
  h.net.air.core.advanceCounter(h.net.air.node(1).slot, 0xfffeffe0);
  for (let i = 0; i < 40; i++) {
    h.berry(1, `espnow_mesh_send(255, 3, false, bytes('0${(i % 10).toString()}'))`);
    h.run(60);
  }
  h.run(1100);                                 // the main loop's next second: the core asked for the next epoch, and the driver stops the mesh and starts it again
  assert.ok(h.logs.some((l) => l.who === "b1" && l.line === "EMH: The frame counter is near its end: the mesh stops and starts again under the next epoch"));
  assert.ok(h.logs.some((l) => l.who === "b1" && l.line === "EMH: Stopped"));
  assert.equal(record(h.dev(1)).epoch, epoch + 1, "the epoch is saved by the start");
  assert.equal(h.status(1).Epoch, epoch + 1);
  assert.equal(h.status(1).Running, 1);
  assert.equal(h.net.air.core.counter(h.net.air.node(1).slot) < 100, true, "numbered from 1 again under it");
  const c = h.berry(1, "espnow_mesh_clock()").v;
  assert.deepEqual([c.synced, c.adopted, c.taken], [false, false, 0], "a new run: its clock at 0 in a timeline of its own, as any start");
  assert.notEqual(c.timeline, house);
  assert.equal(JSON.parse(h.dev(1).console("EspNowMeshStats 1")).EspNowMeshStats.CounterOut, 0, "and it never had no number to give");
  h.run(30_000);
  assert.equal(h.net.timelines().size, 1, "it joined the house again");
  assert.equal(h.berry(1, "espnow_mesh_clock()").v.timeline, house, "in the house's timeline, which is the one its old epoch began");
  const ticket = h.berry(1, "send_cmd(2, bytes().fromstring('after'))").v;
  h.run(500);
  assert.equal(h.read(2).ran.at(-1).body, "after", "and what it sends goes through, sealed under the new epoch");
  assert.equal(h.read(1).outcomes.at(-1).Counter, ticket);
  // no number was used for two different messages: the frames that share one carry the same bytes (a repeat, or a resend)
  const own = h.net.air.log.filter((l) => l.from === 1 && l.origin === 1);
  const seen = new Map();
  for (const l of own) {
    const f = h.net.air.core.decode(l.bytes);
    const key = f.epoch + ":" + f.counter;
    const body = Buffer.from(l.bytes.slice(14, l.bytes.length - 8)).toString("hex");
    if (seen.has(key)) assert.equal(seen.get(key), body, "the number " + key + " carried two different messages");
    else seen.set(key, body);
  }
  assert.deepEqual([...new Set(own.map((l) => h.net.air.core.decode(l.bytes).epoch))].sort(), [epoch, epoch + 1], "its frames carry the two epochs, and no number is repeated within one");
});

// =====================================================================================================================================
// O. the queues to the main loop
// =====================================================================================================================================

test("a burst of commands that ask for an answer, from four nodes at one: the queue of frames to the main loop (8) and the core's inbox (8) fill, the frames that find no room are refused and sent again, and every one that was answered reaches the rules once", async (t) => {
  const h = await meshHouse();
  for (const id of h.ids) h.berry(id, "espnow_mesh_ready()");
  h.run(40_000);
  const before = JSON.parse(h.dev(1).console("EspNowMeshStats 0")).EspNowMeshStats;
  const sent = [];
  // 8 from each of four nodes, in two turns of the main loop of each: the queue to the task takes 4 at a time
  for (let turn = 0; turn < 2; turn++) {
    for (const from of [2, 3, 4, 5]) {
      for (let i = 0; i < 4; i++) {
        const tag = from * 10 + turn * 4 + i;
        const ticket = h.berry(from, `espnow_mesh_send(1, 0, true, bytes('${tag.toString(16).padStart(2, "0")}'))`).v;
        assert.ok(ticket >= 1, `node ${from} send ${turn * 4 + i} is taken`);
        sent.push({ from, tag, ticket });
      }
    }
    h.run(5);
  }
  h.run(6000);
  const after = JSON.parse(h.dev(1).console("EspNowMeshStats 0")).EspNowMeshStats;
  assert.ok(after.InboxFull > before.InboxFull || after.EvtFull > before.EvtFull, `the receiver had no room for all at once: InboxFull ${before.InboxFull} to ${after.InboxFull}, EvtFull ${before.EvtFull} to ${after.EvtFull}`);
  const frames = h.read(1).frames;
  const first = frames.filter((f) => (f.Flags & 2) === 0);
  assert.equal(first.length, 32, "each of the 32 reached the rules as new, once");
  assert.equal(new Set(first.map((f) => `${f.From}:${f.Counter}`)).size, 32);
  assert.deepEqual(first.map((f) => parseInt(f.Data, 16)).sort((a, b) => a - b), sent.map((x) => x.tag).sort((a, b) => a - b), "and they are the ones that were sent");
  for (const from of [2, 3, 4, 5]) {
    const o = h.read(from).outcomes;
    assert.equal(o.length, 8, `node ${from}: an outcome for each`);
    assert.ok(o.every((x) => x.Ok === 1), `node ${from}: each answered, the ones the first attempts did not get through by the sending again`);
    assert.deepEqual(o.map((x) => x.Counter).sort((a, b) => a - b), sent.filter((x) => x.from === from).map((x) => x.ticket).sort((a, b) => a - b), "under the tickets the sends gave");
  }
  t.diagnostic(`32 commands at once to one node: its core refused ${after.InboxFull - before.InboxFull} for want of room, its queue to the main loop was found full ${after.EvtFull - before.EvtFull} times; all 32 delivered once and answered, ${frames.length - first.length} repeats`);
});

// =====================================================================================================================================
// P. the real cipher
// =====================================================================================================================================

test("with the firmware's own cipher (X25519, AES-CCM) on the air in place of the stand-in, the house works the same, and the public key the driver gives is the one the core uses", async () => {
  const h = await meshHouse({ bridges: [1, 2, 3], panels: [], air: { cipher: "real" } });
  for (const id of h.ids) h.berry(id, "espnow_mesh_ready()");
  h.run(40_000);
  assert.equal(h.net.timelines().size, 1);
  const ticket = h.berry(1, "send_cmd(3, bytes().fromstring('sealed'))").v;
  h.run(500);
  assert.equal(h.read(3).ran.at(-1).body, "sealed");
  assert.equal(h.read(1).outcomes.at(-1).Counter, ticket);
  assert.equal(h.status(3).CipherBad, 0);
  const pub = h.cmd(2, "EspNowMeshPublic").EspNowMeshPublic.Public;
  assert.equal(pub, Buffer.from(h.net.air.core.identity(h.net.air.node(2).slot)).toString("hex").toUpperCase(), "the public key in the record's identity is the node's of the core");
  assert.equal(record(h.dev(1)).node.find((n) => n.id === 2).pub.map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase(), pub, "and it is the one the other node was given for it");
});

test("data sealed under the group key (espnow_mesh_group_seal and _open): another node of the house reads it back, under the same label and the key's version only, and the bytes are the firmware's", async () => {
  const h = await meshHouse({ bridges: [1, 2], panels: [] });
  h.run(5000);
  const sealed = h.berry(1, "[espnow_mesh_group_seal('settings', bytes().fromstring('the settings'))[0], espnow_mesh_group_seal('settings', bytes().fromstring('the settings'))[1].tohex()]").v;
  assert.equal(typeof sealed[0], "number", "the group key's version");
  assert.equal(sealed[1].length, 2 * (12 + 12 + 16), "the nonce, the ciphertext and the tag");
  const open = (id, label, v) => h.berry(id, `espnow_mesh_group_open('${label}', ${v}, bytes('${sealed[1]}'))`).v;
  assert.equal(h.berry(2, `espnow_mesh_group_open('settings', ${sealed[0]}, bytes('${sealed[1]}')).asstring()`).v, "the settings", "another member reads it back");
  assert.equal(open(2, "other", sealed[0]), false, "under another label: false");
  assert.equal(open(2, "settings", sealed[0] + 1), false, "for a version not held: false");
  // the firmware's bytes for a nonce of 0..11 over "abc" (firmware/host-tests/espnow-mesh-driver pins the same, and OpenSSL's AES-CCM gives them too)
  const core = h.net.air.core;
  const enc = new TextEncoder();
  const key = core.hkdf(enc.encode("mesh group data"), new Uint8Array(32).fill(0x11), enc.encode("settings"), 16);
  const nonce = Uint8Array.from({ length: 12 }, (_, i) => i);
  const out = core.ccmSeal(key, nonce, enc.encode("settings"), enc.encode("abc"), 16);
  assert.equal(Buffer.concat([nonce, out.data, out.tag]).toString("hex"), "000102030405060708090a0b970a7a0dcc77c9ae6230937fdd202db367eb6c");
});

// =====================================================================================================================================
// Q. the lists the commands answer in pages
// =====================================================================================================================================

test("pageList: as many entries as fit under the margin of a message, one at least, the index of the next page when some remain, and JSON in every case", () => {
  const entry = (k, n) => JSON.stringify({ Id: k, Info: "A".repeat(n) });
  const head = '{"Cmd":{"Count":20,"From":0,"List":[';
  const small = Array.from({ length: 20 }, (_, k) => entry(k, 10));
  const all = pageList(head, small, 0, "}}");
  assert.equal(JSON.parse(all).Cmd.List.length, 20, "twenty small ones go in one page");
  assert.equal(JSON.parse(all).Cmd.Next, undefined, "and a list that ends says no Next");
  const big = Array.from({ length: 20 }, (_, k) => entry(k, 150));
  let from = 0;
  const seen = [];
  for (let n = 0; n < 40; n++) {
    const page = pageList(`{"Cmd":{"Count":20,"From":${from},"List":[`, big, from, "}}");
    assert.ok(page.length <= PAGE_MAX && page.length < MESSZ, `a page of ${page.length} characters`);
    const body = JSON.parse(page).Cmd;
    assert.ok(body.List.length >= 1, "one at least");
    seen.push(...body.List.map((x) => x.Id));
    if (body.Next === undefined) break;
    assert.equal(body.Next, from + body.List.length, "the next page begins where this one ended");
    from = body.Next;
  }
  assert.deepEqual(seen, Array.from({ length: 20 }, (_, k) => k), "every entry once, in order");
  // an entry that alone is more than a page takes a page of its own, and the list goes on after it
  const huge = pageList(head, [entry(0, 1500), entry(1, 10)], 0, "}}");
  assert.equal(JSON.parse(huge).Cmd.List.length, 1);
  assert.equal(JSON.parse(huge).Cmd.Next, 1);
  // from the count or beyond: an empty list
  for (const first of [20, 21, 4000000000]) assert.deepEqual(JSON.parse(pageList(head, small, first, "}}")).Cmd.List, []);
});

test("with 48 neighbours of 32 bytes of info each, the three commands that list them answer in pages that are JSON, under the limit of a message, and cover every neighbour once", async (t) => {
  const h = await meshHouse();
  for (const id of h.ids) h.berry(id, "espnow_mesh_ready()");
  h.run(30_000);
  const driver = h.net.drivers.get(1);
  const base = driver.snapshot;
  const neighbors = Array.from({ length: 48 }, (_, k) => ({
    id: 100 + k, state: k % 3, listsMe: 1, noRadio: 0, rssi: -60 - (k % 30), theirRssi: -61, ageS: 60000 + k, beatS: 60000 + k, heardAt: 0, beatAt: 0, hears: 20 + (k % 20),
    info: Uint8Array.from({ length: 32 }, (_, i) => (i === 0 ? 1 : 0xab ^ k ^ i) & 255), clockSkew: -(k * 37), clockSeen: 1 + (k % 2), keyVersion: k % 5 === 0 ? 0 : 200 + (k % 50), keyBits: k % 8, fwd: k % 3 === 0 ? 255 : 100 - k,
  }));
  const links = neighbors.map((n, k) => ({ id: n.id, quality: k % 5 === 0 ? 255 : 100 - k, usable: k % 4 !== 0, reach: 40, only: k % 7, branch: 1 + (k % 3), chosen: k % 2 === 0 }));
  driver.snapshot = { ...base, neighbors, health: { ...base.health, neighbors: 48, links } };
  const ids = neighbors.map((n) => n.id);
  const sizes = {};
  for (const command of ["EspNowMeshNeighbors", "EspNowMeshHealth", "EspNowMeshClock"]) {
    let from = 0;
    const got = [];
    let largest = 0, pages = 0;
    for (;;) {
      const raw = h.devices.get(1).console(from === 0 ? command : `${command} ${from}`);
      const body = JSON.parse(raw)[command];
      pages++;
      largest = Math.max(largest, raw.length);
      assert.ok(raw.length < MESSZ && raw.length <= PAGE_MAX, `${command} from ${from}: ${raw.length} characters`);
      assert.deepEqual([body.Count, body.From], [48, from], `${command}: where it starts and how many there are`);
      assert.ok(body.List.length >= 1, "an entry at least");
      got.push(...body.List.map((x) => x.Id));
      if (body.Next === undefined) break;
      assert.equal(body.Next, from + body.List.length);
      from = body.Next;
      assert.ok(pages < 60, "the pages end");
    }
    assert.deepEqual(got, ids, `${command}: every neighbour once, in order`);
    sizes[command] = `${pages} pages, the largest ${largest} characters`;
  }
  assert.ok(Number(sizes.EspNowMeshNeighbors.split(" ")[0]) >= 9, "a neighbour with 32 bytes of info is some 190 characters: a page of five or fewer");
  // the end of the list, and what is not a number
  const last = JSON.parse(h.devices.get(1).console("EspNowMeshNeighbors 47")).EspNowMeshNeighbors;
  assert.deepEqual([last.List.length, last.List[0].Id, last.Next], [1, 147, undefined]);
  for (const from of ["48", "200"]) assert.deepEqual(JSON.parse(h.devices.get(1).console(`EspNowMeshNeighbors ${from}`)).EspNowMeshNeighbors.List, []);
  assert.equal(JSON.parse(h.devices.get(1).console("EspNowMeshNeighbors x")).EspNowMeshNeighbors.From, 0);
  driver.snapshot = base;
  t.diagnostic(JSON.stringify(sizes));
});

// =====================================================================================================================================
// R. a node taken out of the list
// =====================================================================================================================================

test("a node the driver is told to forget (EspNowMeshNode <n>,0) is no neighbour of the core any more, as the firmware's task does it", async () => {
  const h = await meshHouse({ bridges: [1, 2, 3], panels: [] });
  h.run(20_000);
  const ids = (id) => (h.berry(id, "espnow_mesh_neighbors()").v || []).map((n) => n.id).sort();
  assert.deepEqual(ids(2), [1, 3], "the node 2 hears the two others");
  // the node 1 goes away for good: the others declare it silent, and keep it as a neighbour that is
  h.dev(1).unplug();
  h.run(40_000);
  assert.deepEqual([ids(2), ids(3)], [[1, 3], [1, 2]], "silent, the node 1 is still a neighbour of each");
  assert.deepEqual(h.cmd(2, "EspNowMeshNode 1,0"), { EspNowMeshNode: "Done" });
  h.run(600);
  assert.deepEqual(ids(2), [3], "taken out of the list of the node 2, it is no neighbour of it any more");
  assert.deepEqual(ids(3), [1, 2], "and the node 3, which was not told, still keeps it");
});
