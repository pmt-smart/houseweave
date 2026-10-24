// The ESP-NOW driver and the WiFi station driver of the firmware, compiled from
// the fork's own source (native/radio_core.cpp), on devices that share an air
// (src/radio.ts): the link's protocol 2 and the pairing over ESP-NOW, two or
// three devices at a time, with nothing of either driver imitated.
//
// The radio under them is the simulator's: a channel, an access point that a
// station associates with, a WiFi stack that stops when Tasmota's WiFi goes off,
// and frames that reach the devices on the same channel. What these tests hold is
// the drivers' behaviour on that radio; what the hardware's radio does besides
// is the bench's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Air, BROADCAST, FUNC, IDEAL_TIMING, REAL_TIMING } from "../dist/index.js";

const BRIDGE = "B0B0B0000001";
const PANEL = "A0A0A0000001";
const PANEL2 = "A0A0A0000002";
const text = (mac) => mac.match(/../g).join(":");

/** a device on the network "Cottage", its access point on `channel` */
function onNetwork(dev, channel) {
  dev.set("ap", channel);
  dev.set("ssid1", "Cottage");
  dev.set("wifi", 1);
}

/** a device with no network, its radio in station mode on `channel`, as StaHold leaves it */
function offNetwork(dev, channel) {
  dev.set("mode", 1);
  dev.set("channel", channel);
}

const last = (list, key) => [...list].reverse().find((e) => key in e);

/** how many of a device's events of the key given pass the check given */
const count = (dev, key, fn) => dev.eventsOf(key).filter(fn).length;

/**
 * Runs a pairing through, from the window to both records, as the button and the
 * glass would: each step waits for an event that comes after the step, not for one
 * an earlier pairing left.
 */
function pair(air, bridge, panel, { id = 1, window = "EspNowPairOpen 120,15", scan = true } = {}) {
  const scans = count(panel, "EspNowPair", (e) => e.Scan === "Done");
  const blinks = count(panel, "EspNowPair", (e) => e.Blinking);
  const pairs = count(panel, "EspNowPair", (e) => e.Paired);
  const ups = [bridge, panel].map((d) => count(d, "EspNowDirect", (e) => e.PeerUp));
  if (window) assert.equal(bridge.cmd(window).EspNowPairOpen, "Open");
  if (scan) {
    assert.equal(panel.cmd("EspNowPairScan").EspNowPairScan, "Started");
    assert.ok(air.until(() => count(panel, "EspNowPair", (e) => e.Scan === "Done") > scans, 12000), "the scan ends");
  }
  assert.equal(panel.cmd(`EspNowPairBlink ${id}`).EspNowPairBlink, "Started");
  assert.ok(air.until(() => count(panel, "EspNowPair", (e) => e.Blinking) > blinks, 6000), "the bridge identifies itself");
  assert.equal(panel.cmd(`EspNowPairWith ${id}`).EspNowPairWith, "Started");
  assert.ok(air.until(() => count(panel, "EspNowPair", (e) => e.Paired) > pairs, 10000), "the panel saves the pairing");
  assert.ok(air.until(() => [bridge, panel].every((d, i) => count(d, "EspNowDirect", (e) => e.PeerUp) > ups[i]), 5000),
    "the link comes up on the new key");
}

test("X25519 is RFC 7748's, with its test vectors, and a point of small order gives no key", async () => {
  const air = new Air();
  const dev = await air.device(PANEL, 1);
  const x = (k, u) => dev.module.ccall("bh_radio_x25519", "string", ["string", "string"], [k, u]);
  const base = "09".padEnd(64, "0");
  const alice = "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a";
  const bob = "5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb";
  const alicePublic = "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a";
  const bobPublic = "de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f";
  const shared = "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742";
  assert.equal(x(alice, base).toLowerCase(), alicePublic);
  assert.equal(x(bob, base).toLowerCase(), bobPublic);
  assert.equal(x(alice, bobPublic).toLowerCase(), shared);
  assert.equal(x(bob, alicePublic).toLowerCase(), shared);
  assert.equal(x(alice, "00".repeat(32)), "", "u = 0 is of small order");
  assert.equal(x(alice, "01".padEnd(64, "0")), "", "u = 1 is of small order");
});

test("HMAC-SHA256 is RFC 4231's", async () => {
  const air = new Air();
  const dev = await air.device(PANEL, 1);
  const hmac = (k, d) => dev.module.ccall("bh_radio_hmac", "string", ["string", "string"], [k, d]).toLowerCase();
  assert.equal(hmac("4a656665", Buffer.from("what do ya want for nothing?").toString("hex")),
    "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  assert.equal(hmac("0b".repeat(20), Buffer.from("Hi There").toString("hex")),
    "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7");
});

/** two devices set up by hand with the same key, on channel 6 with no network */
async function linked(key = "a secret of the bench") {
  const air = new Air();
  const a = await air.device(PANEL, 11);
  const b = await air.device(BRIDGE, 22);
  offNetwork(a, 6);
  offNetwork(b, 6);
  for (const [dev, peer] of [[a, BRIDGE], [b, PANEL]]) {
    dev.cmd(`EspNowPeerMac ${text(peer)}`);
    dev.cmd(`EspNowSecret2 ${key}`);
    dev.cmd("EspNowEnable 1");
  }
  return { air, a, b, key };
}

test("protocol 2: the link comes up in three HELLOs, encrypted, and carries events", async () => {
  const { air, a, b } = await linked();
  assert.ok(air.until(() => a.cmd("EspNowStatus").EspNowStatus.PeerKnown === 1 && b.cmd("EspNowStatus").EspNowStatus.PeerKnown === 1, 3000));
  assert.equal(a.eventsOf("EspNowDirect").filter((e) => e.PeerUp).length, 1, "PeerUp once");
  assert.equal(b.eventsOf("EspNowDirect").filter((e) => e.PeerUp).length, 1);
  const hellos = air.frames.filter((f) => f.hex.startsWith("12"));
  assert.ok(hellos.length <= 6, `the handshake took ${hellos.length} HELLOs`);
  assert.ok(air.frames.every((f) => f.encrypt), "every frame to the peer is encrypted");
  assert.equal(a.state().peers[0].encrypt, 1);
  const st = a.cmd("EspNowStatus").EspNowStatus;
  assert.equal(st.Version, 2);
  assert.equal(st.PeerVersion, 2);
  assert.equal(st.PeerSession, b.cmd("EspNowStatus").EspNowStatus.Session);

  assert.equal(b.cmd('EspNowEvent {"ZbReceived":{"0x1234":{"Power":1}}}').EspNowEvent, "sent");
  air.run(100);
  assert.deepEqual(last(a.events, "ZbReceived"), { ZbReceived: { "0x1234": { Power: 1 } } });
});

test("protocol 2: what a side sends as its link comes up reaches the peer, which its session answer reached first", async () => {
  const { air, a, b } = await linked();
  assert.ok(air.until(() => a.cmd("EspNowStatus").EspNowStatus.PeerKnown === 1 && b.cmd("EspNowStatus").EspNowStatus.PeerKnown === 1, 3000));
  // each side says a word the moment its PeerUp reaches the rules, as the relay
  // does with a result it kept for the link, and the panel with the mode
  for (const [dev, name] of [[a, "panel"], [b, "bridge"]]) {
    const pass = dev.module.coreRules;
    dev.module.coreRules = (subtopic, json) => {
      pass(subtopic, json);
      if (json.includes('"PeerUp"')) dev.cmd(`EspNowEvent {"Word":"${name}"}`);
    };
  }
  // the bridge starts its link again, as a join of a network does: it greets
  // first, so it takes the panel's session a HELLO before the panel takes its own
  b.cmd("EspNowEnable 0");
  air.run(100);
  b.cmd("EspNowEnable 1");
  assert.ok(air.until(() => a.eventsOf("Word").length > 0 && b.eventsOf("Word").length > 0, 3000),
    `each heard the other's first word: the panel ${JSON.stringify(a.eventsOf("Word"))}, the bridge ${JSON.stringify(b.eventsOf("Word"))}`);
  assert.deepEqual([a.eventsOf("Word"), b.eventsOf("Word")], [["bridge"], ["panel"]]);
  assert.ok(![...a.logs, ...b.logs].some((l) => l.includes("is not the established one")), "and no frame was rejected on the way");
});

test("protocol 2: a HELLO recorded from an earlier session is never adopted", async () => {
  const { air, a, b } = await linked();
  assert.ok(air.until(() => a.cmd("EspNowStatus").EspNowStatus.PeerKnown === 1 && b.cmd("EspNowStatus").EspNowStatus.PeerKnown === 1, 3000));
  const recorded = air.frames.filter((f) => f.from === BRIDGE && f.hex.startsWith("12"));
  assert.ok(recorded.length >= 1);

  // the bridge starts again, with a session of its own that the panel adopts
  b.cmd("EspNowEnable 0");
  b.cmd("EspNowEnable 1");
  const session = b.cmd("EspNowStatus").EspNowStatus.Session;
  assert.ok(air.until(() => a.cmd("EspNowStatus").EspNowStatus.PeerSession === session, 4000), "the panel adopts the new session");

  // everything the bridge greeted with before, again, and the new session stays
  for (const f of recorded) air.inject(f);
  air.run(1500);
  assert.equal(a.cmd("EspNowStatus").EspNowStatus.PeerSession, session, "a replayed HELLO does not take the session back");
  assert.equal(b.cmd('EspNowEvent {"Still":1}').EspNowEvent, "sent");
  air.run(100);
  assert.ok(last(a.events, "Still"), "the bridge's frames still arrive");
});

/** a link frame from `from`, signed with `key`, as the driver builds one */
function linkFrame(key, type, session, counter, payload) {
  const head = Buffer.alloc(9);
  head[0] = type;
  head.writeUInt32LE(session, 1);
  head.writeUInt32LE(counter, 5);
  const body = Buffer.concat([head, payload]);
  const tag = createHmac("sha256", key).update(body).digest().subarray(0, 8);
  return Buffer.concat([body, tag]).toString("hex").toUpperCase();
}

test("protocol 2: a peer of another version is reported once, and never gets a session", async () => {
  const air = new Air();
  const a = await air.device(PANEL, 11);
  offNetwork(a, 6);
  const key = "a secret of the bench";
  a.cmd(`EspNowPeerMac ${text(BRIDGE)}`);
  a.cmd(`EspNowSecret2 ${key}`);
  a.cmd("EspNowEnable 1");
  air.run(200);
  const challenge = a.cmd("EspNowStatus").EspNowStatus.Session;   // any value: only its fresh echo would count
  const v3 = Buffer.alloc(10);
  v3[0] = 3;
  for (let i = 0; i < 3; i++) {
    air.inject({ from: BRIDGE, to: PANEL, hex: linkFrame(key, 0x12, 0x51515151, i, v3), encrypt: false, lmk: "", channel: 6 });
    air.run(100);
  }
  assert.deepEqual(a.eventsOf("EspNowDirect").filter((e) => "PeerVersion" in e), [{ PeerVersion: 3 }], "said once");
  // protocol 1 greeted with an empty HELLO
  air.inject({ from: BRIDGE, to: PANEL, hex: linkFrame(key, 0x12, 0x61616161, 0, Buffer.alloc(0)), encrypt: false, lmk: "", channel: 6 });
  air.run(100);
  assert.deepEqual(a.eventsOf("EspNowDirect").filter((e) => "PeerVersion" in e), [{ PeerVersion: 3 }, { PeerVersion: 1 }]);
  const st = a.cmd("EspNowStatus").EspNowStatus;
  assert.equal(st.PeerKnown, 0);
  assert.equal(st.PeerVersion, 1);
  assert.ok(challenge);
});

test("a peer record of version 1 is dropped at start, with its fallback channel kept", async () => {
  const air = new Air();
  const v1 = Buffer.alloc(44);
  v1.writeUInt32LE(1, 0);
  Buffer.from(BRIDGE, "hex").copy(v1, 4);
  v1[10] = 5;                                      // the fallback channel
  v1[11] = 4;
  Buffer.from("abcd").copy(v1, 12);
  const a = await air.device(PANEL, 11, { "espnowdir/settings": v1.toString("hex").toUpperCase() });
  assert.ok(a.logs.some((l) => /record of version 1 dropped/.test(l)), a.logs.join("\n"));
  const st = a.cmd("EspNowStatus").EspNowStatus;
  assert.equal(st.Peer, "00:00:00:00:00:00");
  assert.equal(st.SecretSet, 0);
  assert.equal(st.Channel, 5);
  const saved = Buffer.from(a.nvs.get("espnowdir/settings"), "hex");
  assert.equal(saved.readUInt32LE(0), 2, "saved again as version 2, so it is said once");
});

test("pairing on the bridge's channel: the scan hears it at once, and both save the same key", async () => {
  const air = new Air();
  const bridge = await air.device(BRIDGE, 101);
  const panel = await air.device(PANEL, 202);
  bridge.set("friendlyname", "ZBBridge");
  onNetwork(bridge, 6);
  onNetwork(panel, 6);
  air.run(1500);
  assert.equal(panel.state().associated, 1);

  assert.equal(bridge.cmd("EspNowPairOpen 120,15").EspNowPairOpen, "Open");
  assert.equal(panel.cmd("EspNowPairScan").EspNowPairScan, "Started");
  assert.ok(air.until(() => panel.eventsOf("EspNowPair").some((e) => e.Scan === "Done"), 5000));
  const scan = panel.eventsOf("EspNowPair");
  assert.ok(!scan.some((e) => e.Scan === "Sweeping"), "heard on its own channel: no sweep");
  assert.deepEqual(scan.find((e) => typeof e.Heard === "object").Heard,
    { Id: 1, Mac: text(BRIDGE), Rssi: -40, Channel: 6, Version: 2, Name: "ZBBridge", Zigbee: 15, Network: 1, Busy: 0, Guest: 1, Display: 0 });
  assert.deepEqual(panel.cmd("EspNowPairHeard").EspNowPairHeard.map((h) => h.Mac), [text(BRIDGE)]);
  assert.equal(panel.state().paused, 0, "the WiFi never paused");

  assert.equal(panel.cmd("EspNowPairBlink 1").EspNowPairBlink, "Started");
  assert.ok(air.until(() => panel.eventsOf("EspNowPair").some((e) => e.Blinking), 3000));
  assert.deepEqual(bridge.eventsOf("EspNowPair").find((e) => e.Blink), { Blink: text(PANEL) }, "the bridge is asked to blink");
  assert.equal(panel.cmd("EspNowPairWith 1").EspNowPairWith, "Started");
  assert.ok(air.until(() => panel.eventsOf("EspNowPair").some((e) => e.Paired), 5000));
  assert.deepEqual(bridge.eventsOf("EspNowPair").find((e) => e.Paired), { Paired: text(PANEL), Epoch: 1 });
  assert.deepEqual(panel.eventsOf("EspNowPair").find((e) => e.Paired), { Paired: text(BRIDGE), Epoch: 1 });

  // the link on the new key: both sides derived the same one, or nothing would arrive
  assert.ok(air.until(() => panel.eventsOf("EspNowDirect").some((e) => e.PeerUp) && bridge.eventsOf("EspNowDirect").some((e) => e.PeerUp), 3000));
  assert.equal(bridge.cmd('EspNowEvent {"Hello":"panel"}').EspNowEvent, "sent");
  air.run(100);
  assert.ok(last(panel.events, "Hello"));
  for (const [dev, peer] of [[bridge, PANEL], [panel, BRIDGE]]) {
    const st = dev.cmd("EspNowStatus").EspNowStatus;
    assert.equal(st.Peer, text(peer));
    assert.equal(st.Epoch, 1);
    assert.equal(st.Mode, 0);
  }
  assert.equal(panel.cmd("EspNowStatus").EspNowStatus.Pairing, "Paired");
  // nothing secret crossed: the key the two saved appears in no frame
  const pkey = Buffer.from(panel.nvs.get("espnowdir/settings"), "hex").subarray(12, 44).toString("hex").toUpperCase();
  assert.equal(pkey, Buffer.from(bridge.nvs.get("espnowdir/settings"), "hex").subarray(12, 44).toString("hex").toUpperCase());
  assert.ok(!air.frames.some((f) => f.hex.includes(pkey)), "the key never went on the air");

  // the end: the radio back to whoever had it, and a link only where it is enabled
  assert.equal(panel.cmd("EspNowPairStop").EspNowPairStop, "Stopped");
  assert.equal(bridge.cmd("EspNowPairStop").EspNowPairStop, "Stopped");
  assert.equal(panel.state().claimed, 0);
  assert.equal(panel.cmd("StaState").StaState.Owner, "");
  assert.equal(panel.cmd("EspNowStatus").EspNowStatus.Active, 0, "not enabled: the link was the pairing's");
});

test("pairing a bridge on another channel: the scan pauses the WiFi, sweeps, and gives it back", async () => {
  const air = new Air();
  const bridge = await air.device(BRIDGE, 103);
  const panel = await air.device(PANEL, 204);
  offNetwork(bridge, 11);
  onNetwork(panel, 6);
  air.run(1500);
  bridge.cmd("EspNowPairOpen 120");
  panel.cmd("EspNowPairScan");
  assert.ok(air.until(() => panel.eventsOf("EspNowPair").some((e) => e.Scan === "Sweeping"), 4000), "nothing on 6: the sweep");
  assert.equal(panel.state().paused, 1);
  assert.equal(panel.state().associated, 0);
  assert.equal(panel.cmd("StaScan").StaScan, "Busy", "a scan of networks waits for the pairing");
  assert.equal(panel.cmd("StaState").StaState.Owner, "Pairing");
  assert.ok(air.until(() => panel.eventsOf("EspNowPair").some((e) => e.Scan === "Done"), 6000));
  assert.deepEqual(panel.eventsOf("EspNowPair").filter((e) => typeof e.Heard === "object").map((e) => [e.Heard.Channel, e.Heard.Network]), [[11, 0]]);
  assert.ok(air.until(() => panel.state().associated === 1, 3000), "the WiFi back after the sweep");

  // the tap: the panel goes to the bridge's channel, with the WiFi paused again, and stays
  pair(air, bridge, panel, { window: null, scan: false });
  assert.equal(panel.state().channel, 11);
  assert.equal(panel.state().associated, 0);
  panel.cmd("EspNowEnable 1");
  panel.cmd("EspNowPairStop");
  assert.ok(air.until(() => panel.state().associated === 1, 3000), "the WiFi back at the end");
  assert.ok(air.until(() => panel.cmd("EspNowStatus").EspNowStatus.OnChannel === 6, 3000), "and the link follows the station again");
});

test("a window takes one session at a time: a second panel hears Busy", async () => {
  const air = new Air();
  const bridge = await air.device(BRIDGE, 105);
  const p1 = await air.device(PANEL, 206);
  const p2 = await air.device(PANEL2, 307);
  for (const d of [bridge, p1, p2]) offNetwork(d, 6);
  bridge.cmd("EspNowPairOpen 120");
  p1.cmd("EspNowPairScan");
  p2.cmd("EspNowPairScan");
  assert.ok(air.until(() => [p1, p2].every((p) => p.eventsOf("EspNowPair").some((e) => e.Scan === "Done")), 5000));
  p1.cmd("EspNowPairBlink 1");
  assert.ok(air.until(() => p1.eventsOf("EspNowPair").some((e) => e.Blinking), 3000));
  p2.cmd("EspNowPairBlink 1");
  assert.ok(air.until(() => p2.eventsOf("EspNowPair").some((e) => e.Failed), 3000));
  assert.deepEqual(p2.eventsOf("EspNowPair").find((e) => e.Failed), { Failed: "Busy" });
  assert.equal(bridge.eventsOf("EspNowPair").filter((e) => e.Blink).length, 1, "only the first panel's session");
  // a new scan says the bridge is busy
  p2.cmd("EspNowPairScan");
  assert.ok(air.until(() => p2.eventsOf("EspNowPair").filter((e) => e.Scan === "Done").length === 2, 5000));
  assert.equal(p2.eventsOf("EspNowPair").filter((e) => typeof e.Heard === "object").at(-1).Heard.Busy, 1);
});

test("a confirmation that never arrives: Not confirmed, and pairing again replaces the record", async () => {
  const air = new Air();
  const bridge = await air.device(BRIDGE, 107);
  const panel = await air.device(PANEL, 208);
  offNetwork(bridge, 6);
  offNetwork(panel, 6);
  air.drop = (f) => f.hex.startsWith("16");        // every RECORDED
  bridge.cmd("EspNowPairOpen 300");
  panel.cmd("EspNowPairScan");
  assert.ok(air.until(() => panel.eventsOf("EspNowPair").some((e) => e.Scan === "Done"), 5000));
  panel.cmd("EspNowPairBlink 1");
  assert.ok(air.until(() => panel.eventsOf("EspNowPair").some((e) => e.Blinking), 3000));
  panel.cmd("EspNowPairWith 1");
  assert.ok(air.until(() => bridge.eventsOf("EspNowPair").some((e) => e.Paired), 5000), "the bridge saves on the panel's proof");
  assert.ok(air.until(() => panel.eventsOf("EspNowPair").some((e) => e.Failed), 35000));
  assert.deepEqual(panel.eventsOf("EspNowPair").find((e) => e.Failed), { Failed: "NotConfirmed" });
  assert.ok(!panel.eventsOf("EspNowPair").some((e) => e.Paired), "the panel saved nothing");
  assert.ok(air.frames.filter((f) => f.from === BRIDGE && f.hex.startsWith("16")).length >= 20, "the bridge confirmed again, for 30 s");

  // the same panel pairs again while the window is open, with no new gesture
  air.drop = () => false;
  panel.cmd("EspNowPairBlink 1");
  assert.ok(air.until(() => panel.eventsOf("EspNowPair").filter((e) => e.Blinking).length === 2, 3000));
  panel.cmd("EspNowPairWith 1");
  assert.ok(air.until(() => panel.eventsOf("EspNowPair").some((e) => e.Paired), 5000));
  assert.deepEqual(bridge.eventsOf("EspNowPair").filter((e) => e.Paired).map((e) => e.Epoch), [1, 2]);
  assert.deepEqual(panel.eventsOf("EspNowPair").find((e) => e.Paired), { Paired: text(BRIDGE), Epoch: 1 });
  assert.ok(air.until(() => panel.eventsOf("EspNowDirect").some((e) => e.PeerUp), 3000), "the link comes up on the second key");
});

test("an answer to the exchange that proves nothing fails the pairing, and nothing is saved", async () => {
  const air = new Air();
  const bridge = await air.device(BRIDGE, 109);
  const panel = await air.device(PANEL, 210);
  offNetwork(bridge, 6);
  offNetwork(panel, 6);
  bridge.cmd("EspNowPairOpen 120");
  panel.cmd("EspNowPairScan");
  assert.ok(air.until(() => panel.eventsOf("EspNowPair").some((e) => e.Scan === "Done"), 5000));
  panel.cmd("EspNowPairBlink 1");
  assert.ok(air.until(() => panel.eventsOf("EspNowPair").some((e) => e.Blinking), 3000));
  panel.cmd("EspNowPairWith 1");
  // the bridge says nothing, and someone answers in its name, with a nonce and a proof of their own
  air.run(20, [panel]);
  const fake = Buffer.concat([Buffer.from([0x11, 2]), Buffer.from(PANEL, "hex"), Buffer.alloc(32, 0x5a)]);
  air.inject({ from: BRIDGE, to: BROADCAST, hex: fake.toString("hex").toUpperCase(), encrypt: false, lmk: "", channel: 6 });
  air.run(100, [panel]);
  assert.deepEqual(panel.eventsOf("EspNowPair").find((e) => e.Failed), { Failed: "Proof" });
  assert.equal(panel.cmd("EspNowStatus").EspNowStatus.SecretSet, 0);
  assert.equal(panel.cmd("EspNowStatus").EspNowStatus.Pairing, "Heard", "back to the list");
});

test("a bridge paired with another panel tells it, over their link, before the key changes", async () => {
  const air = new Air();
  const bridge = await air.device(BRIDGE, 111);
  const p1 = await air.device(PANEL, 212);
  const p2 = await air.device(PANEL2, 313);
  for (const d of [bridge, p1, p2]) offNetwork(d, 6);
  pair(air, bridge, p1);
  bridge.cmd("EspNowEnable 1");
  p1.cmd("EspNowEnable 1");
  bridge.cmd("EspNowPairStop");
  p1.cmd("EspNowPairStop");
  assert.ok(air.until(() => p1.cmd("EspNowStatus").EspNowStatus.PeerKnown === 1 && bridge.cmd("EspNowStatus").EspNowStatus.PeerKnown === 1, 3000));

  pair(air, bridge, p2);
  assert.deepEqual(p1.eventsOf("EspNowDirect").filter((e) => e.Taken), [{ Taken: 1 }], "the panel of before learns it");
  assert.equal(bridge.cmd("EspNowStatus").EspNowStatus.Peer, text(PANEL2));
  assert.equal(bridge.cmd("EspNowStatus").EspNowStatus.Epoch, 2);
});

test("a window closes on time, and gives the radio back", async () => {
  const air = new Air();
  const bridge = await air.device(BRIDGE, 113);
  offNetwork(bridge, 6);
  assert.equal(bridge.cmd("EspNowPairOpen 2").EspNowPairOpen, "Open");
  assert.equal(bridge.state().claimed, 1);
  assert.equal(bridge.cmd("EspNowPairOpen").EspNowPairOpen, "Open");
  air.run(2500);
  assert.deepEqual(bridge.eventsOf("EspNowPair").at(-1), { Window: "Closed" });
  assert.equal(bridge.state().claimed, 0);
  assert.equal(bridge.state().espnow, 0, "ESP-NOW goes down with the pairing, with no link enabled");
  assert.equal(bridge.cmd("EspNowPairOpen").EspNowPairOpen, "Closed");
  const announced = air.frames.filter((f) => f.hex.startsWith("13")).length;
  assert.ok(announced >= 18 && announced <= 21, `about ten announcements a second, ${announced} in 2 s`);
  assert.ok(air.frames.every((f) => f.to === BROADCAST && !f.encrypt), "a window only broadcasts");
});

test("a pairing waits for a scan of networks, and says who has the radio", async () => {
  const air = new Air();
  const panel = await air.device(PANEL, 215);
  onNetwork(panel, 6);
  air.run(1500);
  assert.equal(panel.cmd("StaScan").StaScan, "Started");
  const busy = panel.cmd("EspNowPairScan");
  assert.deepEqual(busy, { EspNowPairScan: "Busy", Owner: "Scan" });
  air.run(2800);                                   // a scan of every channel takes 2.5 s
  assert.equal(panel.cmd("EspNowPairScan").EspNowPairScan, "Started");
  panel.cmd("EspNowPairStop");
});

test("an announcement heard from the channel next door lists the bridge's own channel", async () => {
  const air = new Air();
  air.leak = 1;
  const bridge = await air.device(BRIDGE, 117);
  const panel = await air.device(PANEL, 218);
  offNetwork(bridge, 6);
  offNetwork(panel, 5);
  bridge.set("friendlyname", 'Living room "B" \\ x');
  bridge.cmd("EspNowPairOpen 120");
  panel.cmd("EspNowPairScan");
  assert.ok(air.until(() => panel.eventsOf("EspNowPair").some((e) => e.Scan === "Done"), 5000));
  const heard = panel.eventsOf("EspNowPair").find((e) => typeof e.Heard === "object").Heard;
  assert.equal(heard.Channel, 6);
  assert.ok(heard.Rssi < -40, "weaker next door");
  assert.equal(heard.Name, "Living room ?B? ? x", "the name keeps no character JSON escapes");
  panel.cmd("EspNowPairBlink 1");
  air.run(200);
  assert.equal(panel.state().channel, 6, "the panel goes to the bridge's channel");
});

test("a copy of an announcement from another address changes nothing in the list", async () => {
  const air = new Air();
  const bridge = await air.device(BRIDGE, 119);
  const panel = await air.device(PANEL, 220);
  offNetwork(bridge, 6);
  offNetwork(panel, 6);
  bridge.cmd("EspNowPairOpen 120");
  panel.cmd("EspNowPairScan");
  air.run(500);
  const real = air.frames.find((f) => f.from === BRIDGE && f.hex.startsWith("13"));
  air.inject({ ...real, from: "C0C0C0000001" });
  assert.ok(air.until(() => panel.eventsOf("EspNowPair").some((e) => e.Scan === "Done"), 5000));
  assert.deepEqual(panel.cmd("EspNowPairHeard").EspNowPairHeard.map((h) => h.Mac), [text(BRIDGE)]);
});

test("with more bridges announcing than the list holds, the scan keeps the strongest, and its ids stay put once it is over", async () => {
  const air = new Air();
  const panel = await air.device(PANEL, 230);
  offNetwork(panel, 6);
  const macs = [1, 2, 3, 4, 5, 6, 7].map((n) => `B0B0B00000${String(n).padStart(2, "0")}`);
  const rssi = { [macs[0]]: -70, [macs[1]]: -60, [macs[2]]: -65, [macs[3]]: -50, [macs[4]]: -80, [macs[5]]: -55, [macs[6]]: -45 };
  air.rssi = (from) => rssi[from] ?? -40;
  const bridges = [];
  for (const [i, mac] of macs.entries()) {
    const b = await air.device(mac, 240 + i);
    offNetwork(b, 6);
    bridges.push(b);
  }
  const heard = () => panel.eventsOf("EspNowPair").filter((e) => typeof e.Heard === "object").map((e) => e.Heard);
  for (const b of bridges.slice(0, 6)) assert.equal(b.cmd("EspNowPairOpen 120").EspNowPairOpen, "Open");
  assert.equal(panel.cmd("EspNowPairScan").EspNowPairScan, "Started");
  // the windows announce on the same tick here, and the driver's queue holds four:
  // three bridges at a time beside the panel, as bridges out of step on the air
  air.run(300, [panel, ...bridges.slice(0, 3)]);
  air.run(300, [panel, ...bridges.slice(3, 6)]);
  assert.equal(heard().length, 6, "six heard, and the list full");
  // the nearest opens its window last, while the scan still listens
  assert.equal(bridges[6].cmd("EspNowPairOpen 120").EspNowPairOpen, "Open");
  air.run(300, [panel, bridges[6]]);
  assert.ok(air.until(() => panel.eventsOf("EspNowPair").some((e) => e.Scan === "Done"), 6000, [panel]), "the scan ends");
  const weakest = heard().find((h) => h.Mac === text(macs[4]));
  const nearest = heard().find((h) => h.Mac === text(macs[6]));
  assert.ok(nearest, "the nearest, heard last, is heard");
  assert.equal(nearest.Id, weakest.Id, "in the weakest's place, with its id");
  const list = panel.cmd("EspNowPairHeard").EspNowPairHeard.map((h) => h.Mac);
  assert.deepEqual(list, [6, 3, 5, 1, 2, 0].map((i) => text(macs[i])), "the six strongest, strongest first");
  // once the scan is over, the user picks by the ids: the one out, nearer now, takes no place
  rssi[macs[4]] = -30;
  air.run(1500, [panel, bridges[4]]);
  assert.deepEqual(panel.cmd("EspNowPairHeard").EspNowPairHeard.map((h) => h.Mac), list, "the list stays as the scan left it");
  panel.cmd("EspNowPairStop");
});

test("a script gets a key of the pair's, never the pair's own, and none with no pair", async () => {
  const air = new Air();
  const dev = await air.device(PANEL, 31, {}, { berry: true });
  assert.deepEqual(dev.berry('print(espnow_key("zbpair udp key v1"))'), ["nil"]);
  dev.cmd(`EspNowPeerMac ${text(BRIDGE)}`);
  dev.cmd("EspNowSecret2 a secret of the bench");
  const [hex] = dev.berry('print(espnow_key("zbpair udp key v1").tohex())');
  const want = createHmac("sha256", "a secret of the bench").update("ESP-NOW direct app zbpair udp key v1").digest("hex").toUpperCase();
  assert.equal(hex, want);
  assert.notEqual(dev.berry('print(espnow_key("another").tohex())')[0], want, "one key a label");
});

test("a command from the peer goes to the rules, for the application to take or not", async () => {
  const { air, a, b } = await linked();
  assert.ok(air.until(() => a.cmd("EspNowStatus").EspNowStatus.PeerKnown === 1 && b.cmd("EspNowStatus").EspNowStatus.PeerKnown === 1, 3000));
  assert.equal(a.cmd('EspNowSend ZbSend {"Device":"0x1234","Send":{"Power":1}}').EspNowSend, "sent");
  air.run(100);
  assert.deepEqual(b.eventsOf("EspNowDirect").filter((e) => "Command" in e), [{ Command: 'ZbSend {"Device":"0x1234","Send":{"Power":1}}' }]);
  assert.equal(b.state().commands, 0, "and nothing runs it here");
});

test("the status says how long the peer has been quiet, and its signal", async () => {
  const { air, a, b } = await linked();
  air.rssi = () => -63;
  assert.ok(air.until(() => a.cmd("EspNowStatus").EspNowStatus.PeerKnown === 1, 3000));
  air.run(4500, [a]);                              // the bridge says nothing
  const st = a.cmd("EspNowStatus").EspNowStatus;
  assert.ok(st.Quiet >= 4 && st.Quiet <= 5, `quiet ${st.Quiet} s`);
  assert.equal(st.Rssi, -63);
  b.cmd("EspNowEnable 0");
  assert.equal(b.cmd("EspNowStatus").EspNowStatus.Quiet, -1, "no link, nothing to say");
});

test("the saved network goes to the peer over the link, and the password reaches no rule, log or open frame", async () => {
  const { air, a, b } = await linked();
  assert.ok(air.until(() => a.cmd("EspNowStatus").EspNowStatus.PeerKnown === 1 && b.cmd("EspNowStatus").EspNowStatus.PeerKnown === 1, 3000));
  assert.equal(a.cmd("EspNowGiveWifi").EspNowGiveWifi, "no network");
  a.set("ssid1", "Cottage-2G");
  a.set("password1", "a password of the house");
  assert.equal(a.cmd("EspNowGiveWifi").EspNowGiveWifi, "sent");
  air.run(100);
  assert.deepEqual(b.eventsOf("EspNowDirect").filter((e) => "WifiOffered" in e), [{ WifiOffered: "Cottage-2G" }]);
  const secret = Buffer.from("a password of the house").toString("hex").toUpperCase();
  const frame = air.frames.find((f) => f.from === PANEL && f.hex.startsWith("23"));
  assert.ok(frame && frame.encrypt, "it went encrypted");
  assert.ok(![...b.logs, ...b.events.map((e) => JSON.stringify(e))].some((l) => l.includes("a password of the house")));
  assert.ok(frame.hex.includes(secret), "in the frame, which CCMP encrypts on the air");

  // taken: the station driver's join, which saves the network only once it works
  assert.equal(b.cmd("EspNowTakeWifi").EspNowTakeWifi, "Joining");
  assert.equal(b.cmd("StaState").StaState.State, "Joining");
  assert.equal(b.cmd("EspNowTakeWifi").EspNowTakeWifi, "no offer", "used once");

  // one not taken is dropped two minutes later
  a.cmd("EspNowGiveWifi");
  air.run(100);
  assert.equal(b.eventsOf("EspNowDirect").filter((e) => "WifiOffered" in e).length, 2);
  air.run(121000);
  assert.equal(b.cmd("EspNowTakeWifi").EspNowTakeWifi, "no offer");
});

test("a network named in the command goes instead of the saved one, and one WPA does not allow goes nowhere", async () => {
  const { air, a, b } = await linked();
  assert.ok(air.until(() => a.cmd("EspNowStatus").EspNowStatus.PeerKnown === 1 && b.cmd("EspNowStatus").EspNowStatus.PeerKnown === 1, 3000));
  a.set("ssid1", "Cottage");
  a.set("password1", "the saved password");
  const hex = (t) => Buffer.from(t).toString("hex").toUpperCase();
  assert.equal(a.cmd('EspNowGiveWifi {"SSId":"Cottage-5","Password":"a new password"}').EspNowGiveWifi, "sent");
  air.run(100);
  assert.deepEqual(b.eventsOf("EspNowDirect").filter((e) => "WifiOffered" in e), [{ WifiOffered: "Cottage-5" }], "the named one, by name");
  const frame = air.frames.filter((f) => f.from === PANEL && f.hex.startsWith("23")).at(-1);
  assert.ok(frame && frame.encrypt && frame.hex.includes(hex("a new password")), "its password, in the encrypted frame");
  assert.ok(!frame.hex.includes(hex("the saved password")), "and not the saved one's");
  assert.ok(![...a.logs, ...b.logs].some((l) => l.includes("a new password")), "no log of either side says it");
  const sent = air.frames.length;
  assert.equal(a.cmd('EspNowGiveWifi {"SSId":"Cottage-5","Password":"short"}').EspNowGiveWifi, "Error", "a password WPA does not allow");
  assert.equal(a.cmd('EspNowGiveWifi {"SSId":"","Password":"a new password"}').EspNowGiveWifi, "no network", "no name");
  assert.equal(a.cmd("EspNowGiveWifi not json").EspNowGiveWifi, "Error");
  air.run(100);
  assert.equal(air.frames.filter((f) => f.from === PANEL && f.hex.startsWith("23")).length,
    air.frames.slice(0, sent).filter((f) => f.from === PANEL && f.hex.startsWith("23")).length, "and none of them went");
  assert.equal(b.cmd("EspNowTakeWifi").EspNowTakeWifi, "Joining", "the named one is what the peer joins");
});

const HOTSPOT = 'StaHotspot {"SSId":"nspanel-living","Password":"k7m3q9t2"}';

test("the hotspot: WPA2 beside the station, on its channel, a phone with its password on it, and a reconnection that keeps both", async () => {
  const air = new Air();
  const panel = await air.device(PANEL, 1);
  onNetwork(panel, 6);
  assert.ok(air.until(() => panel.state().associated === 1, 3000), "the station on Cottage");
  assert.deepEqual(panel.cmd(HOTSPOT).StaHotspot, { State: "Up", SSId: "nspanel-living", Channel: 6, IP: "192.168.4.1", Clients: 0 },
    "up on the station's channel, with no password in what it says");
  assert.deepEqual([panel.state().mode, panel.state().associated], [3, 1], "the access point and the station, which stays on its network");
  assert.equal(panel.cmd("StaState").StaState.Owner, "Hotspot", "it holds its phones' channel");
  assert.deepEqual(last(panel.eventsOf("StaHotspot"), "State"), { State: "Up", SSId: "nspanel-living", Channel: 6, IP: "192.168.4.1", Clients: 0 },
    "said to the rules");
  assert.ok(!panel.phoneJoins("nspanel-living", "a wrong one"), "a wrong password is not taken");
  assert.ok(panel.phoneJoins("nspanel-living", "k7m3q9t2"), "the password it was given is");
  air.run(300);
  assert.equal(last(panel.eventsOf("StaHotspot"), "Clients").Clients, 1, "a phone on it, said again");
  assert.ok(![...panel.logs, ...panel.events.map((e) => JSON.stringify(e))].some((l) => l.includes("k7m3q9t2")), "the password in no log or rule");
  // the station loses its access point and comes back: Tasmota's WifiBegin leaves the hotspot up
  panel.set("ap", 0);
  air.run(1500);
  assert.equal(panel.state().associated, 0, "the station off its network");
  panel.set("ap", 6);
  assert.ok(air.until(() => panel.state().associated === 1, 5000), "and back on it");
  assert.deepEqual([panel.state().softap, panel.state().apClients], [1, 1], "the hotspot kept through the reconnection, and the phone on it");
  const off = panel.cmd("StaHotspot 0").StaHotspot;
  assert.equal(off.State, "Off");
  assert.deepEqual([panel.state().softap, panel.state().associated, panel.state().mode], [0, 1, 1], "closed, and the station as it was");
  assert.equal(last(panel.eventsOf("StaHotspot"), "Reason").Reason, "Stop");
  assert.equal(panel.cmd("StaState").StaState.Owner, "", "and the radio free");
});

test("the hotspot with no network, on the channel the radio holds for ESP-NOW, closes after 15 min with nobody on it, and a phone keeps it", async () => {
  const air = new Air();
  const panel = await air.device(PANEL, 1);
  panel.cmd("StaHold 1");
  panel.set("channel", 11);
  assert.equal(panel.cmd(HOTSPOT).StaHotspot.Channel, 11, "on the bridge's channel, where the radio is held");
  air.run(14 * 60000);
  assert.equal(panel.state().softap, 1, "14 min with nobody on it: still up");
  air.run(61000);
  assert.equal(panel.state().softap, 0, "15: closed");
  assert.equal(last(panel.eventsOf("StaHotspot"), "Reason").Reason, "Idle");
  assert.equal(panel.state().mode, 1, "the radio held in station mode, as before");
  panel.cmd(HOTSPOT);
  panel.phoneJoins("nspanel-living", "k7m3q9t2");
  air.run(20 * 60000);
  assert.equal(panel.state().softap, 1, "a phone on it keeps it up");
  panel.phoneLeaves();
  air.run(15 * 60000 + 500);
  assert.equal(panel.state().softap, 0, "and 15 min after it left, it closes");
});

test("the hotspot with no network stays up, its phone on it, through a hold, a scan, the end of the radio lent for it, and a join", async () => {
  const air = new Air();
  const panel = await air.device(PANEL, 1);
  panel.set("ap", 6);
  assert.equal(panel.cmd(HOTSPOT).StaHotspot.State, "Up");
  assert.ok(panel.phoneJoins("nspanel-living", "k7m3q9t2"), "a phone on it");
  air.run(300);
  panel.cmd("StaHold 1");
  panel.cmd("StaHold 0");
  assert.equal(panel.state().softap, 1, "a hold, and its end, leave it up");
  // a scan borrows the radio from a Tasmota with no network
  assert.equal(panel.cmd("StaScan").StaScan, "Started");
  assert.equal(panel.state().softap, 1, "up while the scan runs");
  air.run(3000);
  assert.equal(panel.eventsOf("StaScan").length, 1, "the scan reported");
  // the radio stays lent for the join that usually follows; at its time, the hotspot keeps it
  air.run(61000);
  assert.deepEqual([panel.state().softap, panel.state().apClients], [1, 1], "the loan over, and the hotspot and its phone still there");
  // a join: the station beside it, and the hotspot on the network's channel after
  assert.equal(panel.cmd('StaJoin {"SSId":"Cottage","Password":"cottagepass1"}').StaJoin, "Joining");
  assert.equal(panel.state().softap, 1, "up while the join runs");
  assert.ok(air.until(() => panel.state().associated === 1, 6000), "joined");
  assert.deepEqual([panel.state().softap, panel.state().channel], [1, 6], "and up after it, on the network's channel");
  assert.deepEqual(panel.eventsOf("StaHotspot").filter((e) => e.Reason), [], "never closed");
});

test("the hotspot beside a station on its network stays up when a join takes the station to another, through Tasmota's WiFi going off", async () => {
  const air = new Air();
  const panel = await air.device(PANEL, 1);
  onNetwork(panel, 6);
  assert.ok(air.until(() => panel.state().associated === 1, 3000), "the station on Cottage");
  panel.cmd(HOTSPOT);
  assert.ok(panel.phoneJoins("nspanel-living", "k7m3q9t2"), "a phone on it");
  assert.equal(panel.cmd('StaJoin {"SSId":"Cottage-2","Password":"otherpass"}').StaJoin, "Joining", "Tasmota's WiFi goes off for it");
  assert.deepEqual([panel.state().softap, panel.state().apClients], [1, 1], "and the hotspot and its phone stay");
  assert.ok(air.until(() => panel.state().associated === 1, 6000), "the station on the other network");
  assert.equal(panel.state().softap, 1, "the hotspot still up");
  assert.deepEqual(panel.eventsOf("StaHotspot").filter((e) => e.Reason), [], "never closed");
});

test("the hotspot keeps the radio from a pairing, gives way to the WiFi Manager, and refuses a password WPA does not allow", async () => {
  const air = new Air();
  const panel = await air.device(PANEL, 1);
  onNetwork(panel, 6);
  assert.ok(air.until(() => panel.state().associated === 1, 3000));
  assert.equal(panel.cmd('StaHotspot {"SSId":"nspanel-living","Password":"short"}').StaHotspot, "Error", "a password of 1 to 7 characters");
  assert.equal(panel.cmd('StaHotspot {"SSId":"","Password":"k7m3q9t2"}').StaHotspot, "Error", "no name");
  assert.equal(panel.state().softap, 0);
  panel.cmd(HOTSPOT);
  const scan = panel.cmd("EspNowPairScan");
  assert.deepEqual([scan.EspNowPairScan, scan.Owner], ["Busy", "Hotspot"], "a pairing, which sweeps the channels, waits for it");
  panel.set("manager", 1);
  air.run(300);
  assert.equal(last(panel.eventsOf("StaHotspot"), "Reason").Reason, "WifiManager", "the WiFi Manager's own takes its place");
  assert.equal(panel.cmd(HOTSPOT).StaHotspot, "Busy", "and none opens while it is up");
});

// --- the air takes time, and the receive queue is four deep -----------------------------
//
// A frame does not arrive in the instant it was sent, and esp_now_send is a call that can fail. A frame holds the
// sender's radio for its length on the air (REAL_TIMING: 1.4 ms for 90 bytes, 2.9 ms for 233), the frames
// of one sender go out one after another, and the radio may have no room for another (txQueue). On the receiving side,
// the queue the driver drains from its main loop holds four frames and drops the oldest, and what a frame runs keeps the
// loop busy (radio_core.cpp: cost_cmd and cost_event, the sim's Berry-free stand-in for Tasmota's command dispatch).
// These tests drive the drain themselves where they mean to: a frame is HEARD by a device when the main loop takes it
// from the queue, so a test that wants the moment a frame reached the radio looks at the air (`air.frames`, `due`).

/** the payload of each event of a burst a device took from its queue, in the order it took them */
const heard = (dev) => dev.eventsOf("Burst").map((e) => e.n);

/** a pair on one link, the air on the timing given, and the line of an event of a burst of the length of a plan's line */
async function onAir(timing) {
  const { air, a, b } = await linked();
  assert.ok(air.until(() => a.cmd("EspNowStatus").EspNowStatus.PeerKnown === 1 && b.cmd("EspNowStatus").EspNowStatus.PeerKnown === 1, 3000));
  air.run(200);
  air.timing = timing;
  return { air, a, b };
}
const burstLine = (i) => `EspNowEvent {"Burst":{"n":${i},"pad":"01234567890123456789012345678901234567890123456789"}}`;

test("a frame takes its time on the air: the frames of a burst end one after another, 1.4 ms apart, and a device's radio has heard each only when its time is over", async () => {
  const { air, a, b } = await onAir(REAL_TIMING);
  const start = air.frames.length;
  for (let i = 0; i < 12; i++) assert.equal(a.cmd(burstLine(i)).EspNowEvent, "sent");
  const sent = air.frames.slice(start);
  assert.equal(sent.length, 12);
  const len = sent[0].hex.length / 2;
  assert.ok(len >= 80 && len <= 100, `a frame of about 90 bytes: ${len}`);
  const each = REAL_TIMING.airFixedMs + len * REAL_TIMING.airPerByteMs;
  assert.ok(each > 1.2 && each < 1.7, `takes about 1.4 ms on the air: ${each}`);
  sent.forEach((f, i) => assert.ok(Math.abs(f.due - (air.now + (i + 1) * each)) < 0.05, `frame ${i} ends ${(i + 1) * each} ms after the burst began: ${f.due - air.now}`));
  // the loop of b comes round after every half millisecond: each frame is taken from the queue when it has been heard
  air.deliver();
  b.tick(FUNC.LOOP);
  assert.deepEqual(heard(b), [], "in the instant of the burst nothing has reached the radio of b");
  const at = air.now;
  const seen = [];
  for (let t = 0; t <= 20; t += 0.5) {
    air.now = at + t;
    air.deliver();
    b.tick(FUNC.LOOP);
    seen.push(heard(b).length);
  }
  assert.deepEqual(heard(b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], "heard in the order they were sent, none lost: they came a frame at a time");
  assert.deepEqual(seen, seen.map((_, i) => sent.filter((f) => f.due <= at + i * 0.5).length), `each when its time was over, and not before: ${seen}`);
});

test("on the air of the old simulator a burst is heard in the same instant, and the queue keeps the last four; on the real one a sender's frames queue behind each other and the other sender's do not wait for them", async () => {
  const { air, a, b } = await onAir(IDEAL_TIMING);
  const start = air.frames.length;
  for (let i = 0; i < 6; i++) a.cmd(burstLine(i));
  assert.ok(air.frames.slice(start).every((f) => f.due === air.now), "no time on the air: every frame ends in the instant it was sent");
  air.deliver();
  b.tick(FUNC.LOOP);
  assert.deepEqual(heard(b), [2, 3, 4, 5], "all six reach the radio of b in one instant, the queue holds four, and the oldest two are gone");
  assert.equal(b.state().dropped, 2);
  air.timing = REAL_TIMING;
  const from = air.frames.length;
  for (let i = 0; i < 4; i++) a.cmd(burstLine(10 + i));
  b.cmd('EspNowEvent {"Other":1}');
  const mine = air.frames.slice(from).filter((f) => f.from === a.mac);
  const other = air.frames.slice(from).find((f) => f.from === b.mac);
  assert.ok(other.due - air.now < mine[0].due - air.now, "the other sender's frame ends before the first of this one's: its own radio is free, and a shorter frame is over sooner");
  assert.ok(mine[3].due - mine[0].due > 3, "and this one's last ends three frames after its first");
});

test("the radio has no room for another frame when its queue is full: esp_now_send gives no memory, the command says it failed, nothing is counted as sent, and the room comes back as the air carries the others", async () => {
  const { air, a, b } = await onAir({ ...REAL_TIMING, txQueue: 6 });
  const start = air.frames.length;
  const sentBefore = a.state().sent;
  const said = Array.from({ length: 10 }, (_, i) => a.cmd(burstLine(i)).EspNowEvent);
  assert.deepEqual(said, [...Array(6).fill("sent"), ...Array(4).fill("failed")], "the first 6 are taken, and the next 4 find no room");
  assert.equal(air.frames.length - start, 6, "and only the 6 are on the air");
  assert.equal(air.inFlight(a.mac), 6);
  assert.equal(a.state().sent - sentBefore, 6, "what the radio did not take is not counted as sent");
  air.run(30);
  assert.equal(air.inFlight(a.mac), 0, "30 ms later they have all been on the air");
  assert.equal(a.cmd(burstLine(99)).EspNowEvent, "sent", "and there is room again");
  air.run(30);
  assert.equal(air.frames.length - start, 7);
  assert.deepEqual(heard(b), [2, 3, 4, 5, 99], "what b heard is the last four of the six that went (its queue holds four), and the one after");
});

test("the receive queue holds four frames and drops the oldest: a burst heard in the same instant leaves the last four, and a drain that takes a frame at a time, each busy 10 ms, takes more of a burst that comes over 34 ms", async () => {
  const run = async (timing, cost) => {
    const { air, a, b } = await onAir(timing);
    b.loop(0, cost);
    const before = b.state();
    for (let i = 0; i < 24; i++) a.cmd(burstLine(i));
    air.run(1000);
    const after = b.state();
    return { took: after.takenEvent - before.takenEvent, dropped: after.dropped - before.dropped, heard: heard(b) };
  };
  const instant = await run(IDEAL_TIMING, 0);
  assert.deepEqual(instant.heard, [20, 21, 22, 23], "all 24 in the same instant: the queue keeps the last four, and its callback dropped the other 20");
  assert.deepEqual([instant.took, instant.dropped], [4, 20]);
  const busy = await run(REAL_TIMING, 10);
  assert.equal(busy.took + busy.dropped, 24, "every frame was taken or dropped");
  assert.ok(busy.took > 4 && busy.took <= 10, `the drain took more than the queue holds, because the frames came over 34 ms and not at once: ${busy.took}`);
  assert.deepEqual(busy.heard, [...busy.heard].sort((x, y) => x - y), "in the order they were sent");
  assert.equal(busy.heard[busy.heard.length - 1], 23, "the last of the burst is never the one that is lost");
  assert.ok(busy.heard[0] > 0, "and the first of it is");
});

// --- a pairing as a guest: a device that has a pair pairs with a window and keeps it ------------------------------------------------------------

const BRIDGE2 = "B0B0B0000002";
const PANEL3 = "A0A0A0000003";
const settingsOf = (dev) => dev.nvs.get("espnowdir/settings");
const ups = (dev) => count(dev, "EspNowDirect", (e) => e.PeerUp);
const status = (dev) => dev.cmd("EspNowStatus").EspNowStatus;
/** the sizes of the requests of a pairing (frame type 0x10) that went on the air */
const requests = (air) => air.frames.filter((f) => f.hex.toLowerCase().startsWith("10")).map((f) => f.hex.length / 2);

/** a bridge and a panel paired on the network "Cottage", the link enabled on both and up, and the pairing over */
async function pairedAndLinked(air, seeds) {
  const bridge = await air.device(BRIDGE, seeds[0]);
  const panel = await air.device(PANEL, seeds[1]);
  onNetwork(bridge, 6);
  onNetwork(panel, 6);
  air.run(1500);
  pair(air, bridge, panel);
  for (const d of [bridge, panel]) {
    d.cmd("EspNowEnable 1");
    d.cmd("EspNowPairStop");
  }
  assert.ok(air.until(() => status(bridge).PeerKnown === 1 && status(panel).PeerKnown === 1, 5000), "the pair's link is up, and enabled");
  return { bridge, panel };
}

/** a window, found by the scan of the scanner, picked and asked to blink, and the pairing asked for with the line given: what the command answered */
function pairAsGuest(air, window, scanner, withLine = "EspNowPairWith 1,guest") {
  const scans = count(scanner, "EspNowPair", (e) => e.Scan === "Done");
  const blinks = count(scanner, "EspNowPair", (e) => e.Blinking);
  assert.equal(window.cmd("EspNowPairOpen 300,15").EspNowPairOpen, "Open");
  assert.equal(scanner.cmd("EspNowPairScan").EspNowPairScan, "Started");
  assert.ok(air.until(() => count(scanner, "EspNowPair", (e) => e.Scan === "Done") > scans, 8000), "the scan ends");
  assert.equal(scanner.cmd("EspNowPairBlink 1").EspNowPairBlink, "Started");
  assert.ok(air.until(() => count(scanner, "EspNowPair", (e) => e.Blinking) > blinks, 4000), "the window identifies itself");
  return scanner.cmd(withLine).EspNowPairWith;
}

test("a window on a device with a display says so: the scan hears it as a panel's, and a display that is not 0 or 1 is refused", async () => {
  const air = new Air();
  const window = await air.device(PANEL, 311);
  const scanner = await air.device(BRIDGE, 312);
  for (const d of [window, scanner]) onNetwork(d, 6);
  air.run(1500);
  assert.equal(window.cmd("EspNowPairOpen 120,0,2").EspNowPairOpen, "Error", "a display of 2 is an error");
  assert.equal(window.cmd("EspNowPairOpen 120,0,1").EspNowPairOpen, "Open");
  assert.equal(scanner.cmd("EspNowPairScan").EspNowPairScan, "Started");
  assert.ok(air.until(() => scanner.eventsOf("EspNowPair").some((e) => e.Scan === "Done"), 5000));
  const heard = scanner.eventsOf("EspNowPair").find((e) => typeof e.Heard === "object").Heard;
  assert.deepEqual([heard.Mac, heard.Zigbee, heard.Guest, heard.Display], [text(PANEL), 0, 1, 1], "the window of a panel: no Zigbee channel, a guest's, with a display");
  assert.deepEqual(scanner.cmd("EspNowPairHeard").EspNowPairHeard.map((h) => h.Display), [1], "and the list of the heard says it too");
});

test("a guest: a panel that has a bridge pairs with another bridge's window and keeps its own, on the flash and in the link, and both are back when it ends", async () => {
  const air = new Air();
  const { bridge: home, panel } = await pairedAndLinked(air, [301, 302]);
  const window = await air.device(BRIDGE2, 303);
  onNetwork(window, 6);
  air.run(1500);
  const record = settingsOf(panel);
  const windowRecord = settingsOf(window);
  const homeEpoch = status(panel).Epoch;
  const upsBefore = [ups(panel), ups(window)];

  assert.equal(pairAsGuest(air, window, panel), "Started");
  const heard = last(panel.eventsOf("EspNowPair"), "Heard").Heard;
  assert.equal(heard.Guest, 1, "the window says it takes a guest");
  assert.ok(air.until(() => [panel, window].every((d) => d.eventsOf("EspNowPair").some((e) => e.Paired && e.Guest === 1)), 8000), "both say they are paired, as guests");
  assert.deepEqual(last(panel.eventsOf("EspNowPair"), "Paired"), { Paired: text(BRIDGE2), Epoch: homeEpoch, Guest: 1 }, "the epoch is the pair's own");
  assert.deepEqual(last(window.eventsOf("EspNowPair"), "Paired"), { Paired: text(PANEL), Epoch: 0, Guest: 1 });
  assert.ok(requests(air).length >= 1 && requests(air).filter((n) => n === 8 + 81).length >= 1, "the request of a guest carries the byte that says so: " + requests(air));
  // nothing was written: the record each had is the one in the flash
  assert.equal(settingsOf(panel), record, "the panel's record is as it was");
  assert.equal(settingsOf(window), windowRecord, "and the window's: it had none");
  // the link runs on the key of the exchange
  assert.ok(air.until(() => ups(panel) > upsBefore[0] && ups(window) > upsBefore[1], 6000), "the link of the guest comes up");
  for (const [d, peer] of [[panel, BRIDGE2], [window, PANEL]]) {
    const st = status(d);
    assert.deepEqual([st.Peer, st.Guest, st.Mode, st.Config], [text(peer), 1, 0, 0], "the guest holds the link");
  }
  assert.equal(window.cmd('EspNowEvent {"GuestHello":"window"}').EspNowEvent, "sent");
  assert.equal(panel.cmd('EspNowEvent {"GuestHello":"panel"}').EspNowEvent, "sent");
  air.run(150);
  assert.equal(last(panel.events, "GuestHello").GuestHello, "window");
  assert.equal(last(window.events, "GuestHello").GuestHello, "panel");
  // what sets the record is not taken meanwhile
  assert.equal(panel.cmd("EspNowPeerMac AA:BB:CC:DD:EE:FF").EspNowPeerMac, "Guest");
  assert.equal(panel.cmd("EspNowPeerMode 3").EspNowPeerMode, "Guest");
  assert.equal(panel.cmd("EspNowPeerConfig 9").EspNowPeerConfig, "Guest");
  assert.equal(panel.cmd("EspNowChannel 4").EspNowChannel, "Guest");
  assert.equal(panel.cmd("EspNowSecret x").EspNowSecret, "Guest");
  assert.equal(settingsOf(panel), record, "and nothing was written by them");
  const homeKey = Buffer.from(record, "hex").subarray(12, 44).toString("hex").toUpperCase();
  assert.ok(!air.frames.some((f) => f.hex.toUpperCase().includes(homeKey)), "the pair's key never went on the air");

  // the end: the panel is back on its bridge, which hears it again, and the window on none
  const homeUps = ups(home);
  const panelUps = ups(panel);
  assert.equal(panel.cmd("EspNowPairStop").EspNowPairStop, "Stopped");
  assert.equal(window.cmd("EspNowPairStop").EspNowPairStop, "Stopped");
  for (const d of [panel, window]) assert.ok(d.eventsOf("EspNowPair").some((e) => e.Guest === "Ended"), "the end is said");
  const back = status(panel);
  assert.deepEqual([back.Peer, back.Guest, back.Epoch], [text(BRIDGE), 0, homeEpoch], "the panel's record is the link's again");
  assert.equal(status(window).Guest, 0);
  assert.equal(settingsOf(window), windowRecord);
  assert.ok(air.until(() => ups(panel) > panelUps && ups(home) > homeUps, 8000), "the panel and its bridge greet each other again");
  assert.equal(home.cmd('EspNowEvent {"Back":1}').EspNowEvent, "sent");
  air.run(150);
  assert.equal(last(panel.events, "Back").Back, 1, "the pair's link carries what the bridge says");
  assert.equal(settingsOf(panel), record, "the flash never changed");
});

test("a guest that is not ended gives the link back by itself: the scan after the guest's time, and the window too, which goes on announcing", async () => {
  const air = new Air();
  const { panel } = await pairedAndLinked(air, [311, 312]);
  const window = await air.device(BRIDGE2, 313);
  onNetwork(window, 6);
  air.run(1500);
  assert.equal(pairAsGuest(air, window, panel), "Started");
  assert.ok(air.until(() => [panel, window].every((d) => status(d).Guest === 1), 8000), "both hold the link as guests");
  air.run(40_000);
  assert.equal(status(panel).Guest, 1, "still, before the time is out");
  assert.ok(air.until(() => status(panel).Guest === 0 && status(window).Guest === 0, 12_000), "both give it back at the time");
  assert.ok(panel.eventsOf("EspNowPair").some((e) => e.Ended === "Timeout"), "the scan says it ended");
  assert.equal(status(panel).Peer, text(BRIDGE), "the panel is on its own bridge");
  assert.equal(window.cmd("EspNowPairOpen").EspNowPairOpen, "Open", "the window is still open: a guest ends no window");
});

test("a guest with a window that has a pair of its own: that pair is not told it was taken, and is the window's again afterwards", async () => {
  const air = new Air();
  const { bridge: window, panel: owner } = await pairedAndLinked(air, [321, 322]);
  const scanner = await air.device(PANEL3, 323);
  onNetwork(scanner, 6);
  air.run(1500);
  const windowRecord = settingsOf(window);
  const ownerUps = ups(owner);
  assert.equal(pairAsGuest(air, window, scanner), "Started");
  assert.ok(air.until(() => status(window).Guest === 1 && status(scanner).Guest === 1, 8000), "the guest is in");
  assert.equal(status(window).Peer, text(PANEL3), "the window's link is the guest's meanwhile");
  assert.equal(settingsOf(window), windowRecord, "its record is the owner's, written over by nobody");
  air.run(500);
  assert.ok(!owner.eventsOf("EspNowDirect").some((e) => e.Taken), "the panel the window had is told nothing: a guest replaces no one");
  scanner.cmd("EspNowPairStop");
  window.cmd("EspNowPairStop");
  assert.equal(status(window).Peer, text(PANEL), "the window is on its own panel again");
  assert.ok(air.until(() => ups(owner) > ownerUps, 10_000), "which greets it again");
  assert.equal(status(owner).Epoch, 1, "no pairing was recorded on it");
});

test("a word that is not guest is not taken, and a plain pairing is what it was: the request of 80 bytes, and the pair replaced", async () => {
  const air = new Air();
  const { panel } = await pairedAndLinked(air, [331, 332]);
  const window = await air.device(BRIDGE2, 333);
  onNetwork(window, 6);
  air.run(1500);
  assert.equal(pairAsGuest(air, window, panel, "EspNowPairWith 1,visitor"), "Error", "a word that is not guest");
  assert.equal(panel.cmd("EspNowPairWith 2,guest").EspNowPairWith, "Blink first", "a device that was not picked is not asked");
  const pairs = count(panel, "EspNowPair", (e) => e.Paired);
  assert.equal(panel.cmd("EspNowPairWith 1").EspNowPairWith, "Started");
  assert.ok(air.until(() => count(panel, "EspNowPair", (e) => e.Paired) > pairs, 8000), "paired");
  const sent = requests(air).filter((n) => n > 8);
  assert.ok(sent.length >= 1 && sent.every((n) => n === 8 + 80), "a plain pairing sends the request of 80 bytes it always did: " + sent);
  assert.deepEqual([status(panel).Guest, status(panel).Peer], [0, text(BRIDGE2)], "and it replaced the pair, as a plain pairing does");
});
