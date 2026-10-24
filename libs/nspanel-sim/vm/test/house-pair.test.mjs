// A node comes into the house (berry/house_mesh.be: welcome and accept; berry/house_key.be: the key a panel keeps for the nodes it brings in), end to end on
// the firmware's own cipher: three bridges and two panels that start with no number in a house, no key and no nodes (the factory's), and the house made as it will be made: a panel founds it and
// draws the key, and writes each node into the list and gives it the number, the key and the list, in the pieces the pairing will carry.
//
//   J1  the house made by pairing: five nodes in one mesh, one list, one key, and what one says the others hear
//   J2  the pieces of a welcome: each fits a frame of the pairing, they may come in any order and twice, and what is not a whole welcome that was made as it is, is not taken
//   J3  who may give a welcome: a panel of the house that has the key, for a node that is in the list and was not struck off; and who may take one: a node that is in no house
//   J4  a node brought in after the key changed is given the key in use, and one brought in by another panel has all the list, the entries of the panels included
import { test } from "node:test";
import assert from "node:assert/strict";
import { house, paired, bring, founded, who, digest, ids, nameOf } from "./house-world.mjs";

const version = (h, id) => h.status(id).GroupVersion;
const events = (h, id) => h.dev(id).mesh.told.map((l) => JSON.parse(l).EspNowMesh).filter((e) => e.Type === 3 && e.Data !== undefined).map((e) => Buffer.from(e.Data, "hex").toString());
const say = (h, from, text) => h.berry(from, `espnow_mesh_send(255, 3, false, bytes().fromstring('${text}'))`);

test("the house made by pairing: a panel founds it, and each node is written into the list and given the number, the key and the list; they end in one mesh", async () => {
  const h = await paired({ air: { cipher: "real" } });
  for (const id of h.ids) {
    assert.deepEqual(ids(h, id), [1, 2, 3, 4, 5], `node ${id} has the five nodes`);
    assert.equal(digest(h, id), digest(h, 4), `and the digest of the founder`);
    assert.equal(version(h, id), 1, `and the key of version 1`);
    assert.equal(h.status(id).Running, 1, `and its mesh runs`);
  }
  assert.equal(h.berry(2, "hm.list.name()").v, "Cottage");
  assert.equal(h.berry(1, "hm.list.node(5)['name']").v, "Den panel 5");
  assert.deepEqual([1, 2, 3].map((n) => h.berry(5, `hm.list.node(${n})['slot']`).v), [2, 3, 4].map((x) => x - 1), "the alarm numbers in the order the bridges were brought in: 1, 2, 3");
  // one mesh: a frame of a bridge is heard by a panel and by another bridge, and the key was never in a log
  say(h, 2, "juntos");
  h.run(3000);
  for (const id of [1, 3, 4, 5]) assert.ok(events(h, id).includes("juntos"), `node ${id} hears the bridge 2`);
  assert.ok(!h.logs.some((l) => /[0-9A-F]{64}/i.test(l.line)), "the key of the network is in no log line");
  // the key is the founder's draw, and every panel that was brought in keeps it for the nodes it will bring in
  assert.equal(h.berry(4, "hm.key.cur()[0]").v, 1);
  assert.equal(h.berry(5, "hm.key.cur()[0]").v, 1, "a panel brought in keeps the key");
  assert.equal(h.berry(1, "hm.key.cur()").v, null, "a bridge keeps none");
});

test("the pieces of a welcome fit a frame of the pairing and may come in any order and twice; what is not a whole welcome that was made as it is, is not taken", async () => {
  const h = await house({ virgin: [1, 2, 3, 4, 5], air: { cipher: "real" } });
  assert.equal(h.berry(4, "hm.found('Cottage')").v, true);
  h.run(3000);
  const w = who(h, 5);
  assert.equal(h.berry(4, `hm.add_node(2, bytes('${w.key}'), bytes('${w.mac}'), nil, 'Den panel 5', 5)`).v, 5);
  const pieces = h.berry(4, "mt_welcome(5)").v;
  assert.ok(pieces.length >= 1);
  for (const p of pieces) assert.ok(p.length / 2 <= 183, `a piece of ${p.length / 2} bytes`);
  const take = (list) => h.berry(5, `mt_accept(json.load('${JSON.stringify(list)}'))`).v;
  // a piece missing, a piece changed, one that is not of this welcome
  if (pieces.length > 1) assert.equal(take(pieces.slice(1)), false, "a piece missing");
  const bad = pieces.map((p, i) => (i === pieces.length - 1 ? p.slice(0, -2) + (p.endsWith("00") ? "01" : "00") : p));
  assert.equal(take(bad), false, "a piece changed: the sum does not say it is what was made");
  assert.equal(take([pieces[0].slice(0, 2) + "ff" + pieces[0].slice(4)]), false, "a piece that says another count");
  assert.equal(take([]), false, "nothing");
  assert.equal(version(h, 5), 0, "nothing of it was taken: the node has no key");
  // all of them, in the opposite order and one of them twice
  const shuffled = [...pieces].reverse();
  shuffled.push(pieces[0]);
  assert.equal(take(shuffled), true, "the whole welcome, in any order, one twice");
  assert.equal(version(h, 5), 1);
  // a node that is in a house takes no other
  assert.equal(take(pieces), false, "a node that is in a house is given no other");
});

test("a welcome is given by a panel of the house that has the key, for a node in the list that was not struck off", async () => {
  const h = await paired({ air: { cipher: "real" } }, [5, 1, 2]);
  assert.ok(Array.isArray(h.berry(4, "mt_welcome(1)").v), "a panel that has the key gives a welcome to a node in the list");
  assert.equal(h.berry(4, "mt_welcome(3)").v, null, "to a number that is not in the list: none");
  assert.equal(h.berry(1, "mt_welcome(2)").v, null, "a bridge gives none");
  assert.equal(h.berry(4, "hm.revoke(2)").v, true);
  h.run(40_000);
  assert.equal(h.berry(4, "mt_welcome(2)").v, null, "a node that was struck off is given none");
  // a house made the other way (every node given the key by the setup of the bench) has panels that do not know the key: no welcome
  const w = await house({ air: { cipher: "real" } });
  await founded(w);
  assert.equal(w.berry(4, "mt_welcome(5)").v, null, "a panel that does not know the key has none to give");
});

test("the house is built by the console, node to node: HouseFound, HouseAdd, HouseWelcome and HouseAccept, and ends in one mesh", async () => {
  const h = await house({ virgin: [1, 2, 3, 4, 5], air: { cipher: "real" } });
  assert.deepEqual(h.cmd(4, "HouseFound Cottage"), { HouseFound: "Done" });
  assert.equal(h.cmd(4, "HouseStatus").HouseStatus.Key, 1, "the founder has drawn the key");
  h.run(3000);
  // the pieces carry the key: the window of the bench is shut until a person opens it, on the panel that gives and on every node that takes
  assert.deepEqual(h.cmd(4, "HouseWelcome 5"), { HouseWelcome: "Failed" }, "the window is shut: the welcome is not given");
  assert.deepEqual(h.cmd(4, "HouseBench 1"), { HouseBench: "Open" });
  for (const id of [1, 2, 3, 5]) assert.deepEqual(h.cmd(id, "HouseBench 1"), { HouseBench: "Open" });
  for (const id of [5, 1, 2, 3]) {
    const w = who(h, id);
    const role = h.ids.indexOf(id) < 3 ? "bridge" : "panel";
    assert.deepEqual(h.cmd(4, `HouseAdd ${role},${id},${w.key},${w.mac},Node ${id}`), { HouseAdd: { Id: id } });
    const first = h.cmd(4, `HouseWelcome ${id}`).HouseWelcome;
    assert.ok(first.Of >= 1);
    let last;
    for (let i = first.Of - 1; i >= 0; i--) {
      const piece = h.cmd(4, `HouseWelcome ${id},${i}`).HouseWelcome.Piece;
      last = h.cmd(id, `HouseAccept ${piece}`);
    }
    assert.deepEqual(last, { HouseAccept: "Done" }, `node ${id} took the welcome`);
    h.run(3000);
  }
  h.run(40_000);
  for (const id of h.ids) {
    assert.deepEqual(ids(h, id), [1, 2, 3, 4, 5], `node ${id} has the five nodes`);
    assert.equal(version(h, id), 1, `node ${id} has the key`);
    assert.equal(h.status(id).Running, 1);
  }
  const st = h.cmd(2, "HouseStatus").HouseStatus;
  assert.deepEqual([st.Me, st.Name, st.Nodes.length], [2, "Cottage", 5]);
  say(h, 3, "console");
  h.run(3000);
  for (const id of [1, 2, 4, 5]) assert.ok(events(h, id).includes("console"), `node ${id} hears the node 3`);
});

test("a node brought in after the key changed is given the key in use, and a node brought in by another panel has the whole list, with the entries of the panels", async () => {
  const h = await paired({ air: { cipher: "real" } }, [5, 1, 2]);
  assert.equal(h.berry(5, "hm.rename(1, 'Study')").v, true, "panel 5 writes");
  h.run(20_000);
  assert.equal(h.berry(4, "hm.revoke(2)").v, true, "panel 4 strikes the bridge 2 off: the key changes");
  h.run(40_000);
  assert.equal(version(h, 4), 2);
  assert.equal(h.berry(4, "hm.key.cur()[0]").v, 2, "the panel keeps the key it drew");
  // the node 3 is brought in now, by the panel 5 (which took the key in the change): it is given the second key, and the list with what the panel 4 wrote and what the panel 5 wrote
  await bring(h, 3, 5);
  h.run(40_000);
  assert.equal(version(h, 3), 2, "the node has the key in use, which is the second");
  assert.equal(nameOf(h, 3, 1), "Study", "and the name the panel 5 gave the bridge 1");
  assert.equal(h.berry(3, "hm.list.revoked(2)").v, true, "and knows the bridge 2 was struck off");
  assert.equal(digest(h, 3), digest(h, 4));
  say(h, 3, "novo");
  h.run(3000);
  for (const id of [1, 4, 5]) assert.ok(events(h, id).includes("novo"), `node ${id} hears the new node`);
  assert.ok(!events(h, 2).includes("novo"), "and the node that was struck off does not: it has the first key");
});
