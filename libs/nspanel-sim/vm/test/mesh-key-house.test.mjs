// The change of the network's key at a device that carries the mesh driver (src/mesh-driver.ts, the firmware's xdrv_98_1_espnow_mesh.ino as it answers): the command,
// the record in the flash, the previous key and the hours it is held for, and, on the firmware's own cipher, a house in which the key goes from one device to the others
// by the frame that is tagged with the key they still have. The rules of the core, in many nodes, are in mesh-key.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MeshRecord } from "../dist/index.js";
import { meshHouse, KEY, record } from "./mesh-world.mjs";

const KEY2 = "FFEEDDCCBBAA99887766554433221100FFEEDDCCBBAA99887766554433221100";
const KEY3 = "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF";
const key = (hex, version, revoke) => `EspNowMeshGroupKey ${hex},${version}${revoke ? ",1" : ""}`;

test("the command: the same key with another version renames it, another key is a change that keeps the one the device had as the previous key, and the answer and the flash say so", async () => {
  const h = await meshHouse({ bridges: [1, 2], panels: [] });
  let r = record(h.dev(1));
  assert.equal(r.groupVersion, 1);
  assert.equal(r.hasPrev, 0, "a device set up holds no previous key");
  assert.deepEqual(h.cmd(1, key(KEY, 7)), { EspNowMeshGroupKey: { Set: 1, Version: 7, Previous: 0 } }, "the same key, another version: renamed");
  assert.equal(record(h.dev(1)).hasPrev, 0);
  assert.deepEqual(h.cmd(1, key(KEY2, 7)), { EspNowMeshGroupKey: "the version must change with the key" }, "another key with the same version is refused");
  assert.equal(Buffer.from(record(h.dev(1)).groupKey).toString("hex").toUpperCase(), KEY, "and nothing changed");
  assert.deepEqual(h.cmd(1, key(KEY2, 8)), { EspNowMeshGroupKey: { Set: 1, Version: 8, Previous: 7 } }, "a change says which version it keeps");
  r = record(h.dev(1));
  assert.equal(r.hasPrev, 1);
  assert.equal(r.prevVersion, 7);
  assert.equal(r.prevHours, 0);
  assert.equal(Buffer.from(r.prevKey).toString("hex").toUpperCase(), KEY, "the key it had");
  assert.equal(Buffer.from(r.groupKey).toString("hex").toUpperCase(), KEY2);
  assert.deepEqual(h.cmd(1, key(KEY3, 9)), { EspNowMeshGroupKey: "the last change is not closed" }, "a second change is refused while the first is open");
  assert.deepEqual(h.cmd(1, key(KEY3, 9, true)), { EspNowMeshGroupKey: { Set: 1, Version: 9, Previous: 8 } }, "unless a node was struck off with it");
  assert.equal(Buffer.from(record(h.dev(1)).prevKey).toString("hex").toUpperCase(), KEY2, "and the previous key is the second");
  const st = h.status(1);
  assert.equal(st.GroupVersion, 9);
  assert.equal(st.PrevVersion, 8, "the status says it");
  assert.deepEqual(h.cmd(1, "EspNowMeshKeyClose"), { EspNowMeshKeyClose: { Closed: 1 } });
  r = record(h.dev(1));
  assert.equal(r.hasPrev, 0);
  assert.equal(r.prevVersion, 0);
  assert.ok(r.prevKey.every((b) => b === 0), "the key is wiped from the flash");
  assert.deepEqual(h.cmd(1, "EspNowMeshKeyClose"), { EspNowMeshKeyClose: { Closed: 0 } }, "closing again closes nothing");
  assert.equal(h.status(1).PrevVersion, 0);
});

test("a record of version 3, as an earlier firmware saved it, is taken with no previous key; a record of version 4 keeps it", () => {
  const r = new MeshRecord();
  r.enabled = 1;
  r.id = 5;
  r.hasGroup = 1;
  r.groupVersion = 3;
  r.groupKey = Uint8Array.from(Buffer.from(KEY, "hex"));
  r.hasPrev = 1;
  r.prevVersion = 2;
  r.prevHours = 11;
  r.prevKey = Uint8Array.from(Buffer.from(KEY2, "hex"));
  const blob = r.encode();
  assert.equal(blob.length, 2188);
  const back = MeshRecord.decode(blob);
  assert.deepEqual([back.hasPrev, back.prevVersion, back.prevHours, Buffer.from(back.prevKey).toString("hex").toUpperCase()], [1, 2, 11, KEY2], "a record of version 4");
  const old = blob.slice(0, 2152);
  new DataView(old.buffer, old.byteOffset, 4).setUint32(0, 3, true);
  const v3 = MeshRecord.decode(old);
  assert.ok(v3 !== null, "a record of version 3 is taken");
  assert.equal(v3.id, 5);
  assert.equal(v3.groupVersion, 3);
  assert.equal(v3.hasPrev, 0, "with no previous key");
  assert.equal(MeshRecord.decode(blob.slice(0, 2152)), null, "a record of version 4 that is the size of version 3 is not");
});

test("the hours the previous key is held for are the hours the device runs: one is counted and kept, and 720 let it go", async () => {
  const h = await meshHouse({ bridges: [1], panels: [] });
  h.cmd(1, key(KEY2, 2));
  const mesh = h.dev(1).mesh;
  for (let i = 0; i < 3599; i++) mesh.everySecond();
  assert.equal(record(h.dev(1)).prevHours, 0, "in the first hour, none is counted");
  mesh.everySecond();
  assert.equal(record(h.dev(1)).prevHours, 1, "after it, one, in the flash");
  assert.equal(h.status(1).PrevHours, 1);
  // the rest of the 720 hours is given at once, as a device that has run for a month would have them
  mesh.record.prevHours = 719;
  for (let i = 0; i < 3600; i++) mesh.everySecond();
  assert.equal(record(h.dev(1)).hasPrev, 0, "at the end of 720 hours the previous key is let go");
  assert.ok(h.logs.some((l) => l.who === "b1" && l.line.includes("held for 720 hours")), "and the log says so");
});

test("on the firmware's own cipher the key goes from one device to the others in the frame tagged with the key they still have, and the house is one again", async () => {
  const h = await meshHouse({ bridges: [1, 2, 3], panels: [], air: { cipher: "real" } });
  for (const id of h.ids) h.berry(id, "espnow_mesh_ready()");
  h.run(40_000);
  assert.equal(h.net.timelines().size, 1);
  // before the change: a command from 1 reaches 3
  h.berry(1, "send_cmd(3, bytes().fromstring('before'))");
  h.run(600);
  assert.equal(h.read(3).ran.at(-1).body, "before");
  // bridge 1 takes the new key: what it sends is under it, and the others cannot read it
  h.cmd(1, key(KEY2, 2));
  h.run(2_000);
  assert.equal(h.status(1).PrevVersion, 1);
  h.berry(1, "send_cmd(3, bytes().fromstring('lost'))");
  h.run(1500);
  assert.notEqual(h.read(3).ran.at(-1).body, "lost", "a command under the new key is not one that 3 can check");
  assert.ok(h.status(3).Bad > 0);
  // the frame that carries the key: a frame of the membership (type 6) with the previous key's tag, from Berry, for each of the others
  for (const id of [2, 3]) {
    const t = h.berry(1, `espnow_mesh_send(${id}, 6, false, bytes().fromstring('key'), true)`).v;
    assert.ok(typeof t === "number" && t > 0, "the send is taken");
  }
  h.run(2_500);
  for (const id of [2, 3]) {
    const frame = h.dev(id).mesh.told.map((l) => JSON.parse(l).EspNowMesh).find((e) => e.Type === 6 && e.From === 1);
    assert.ok(frame !== undefined, `the frame that carries the key reached ${id}`);
    assert.equal(frame.Flags & 4, 0, "and it is not one under the previous key for it: it is under the key it has");
  }
  // each takes the key, as the application does when the frame comes
  for (const id of [2, 3]) h.cmd(id, key(KEY2, 2));
  h.run(15_000);
  h.berry(2, "send_cmd(3, bytes().fromstring('after'))");
  h.berry(3, "send_cmd(1, bytes().fromstring('back'))");
  h.run(1500);
  assert.equal(h.read(3).ran.at(-1).body, "after", "what 2 sends reaches 3");
  assert.equal(h.read(1).ran.at(-1).body, "back", "what 3 sends reaches 1");
  for (const id of [1, 2, 3]) assert.equal(h.status(id).GroupVersion, 2);
  // the neighbours say the version of the key they hold, and that they hold a previous one
  const n = JSON.parse(h.dev(1).console("EspNowMeshNeighbors")).EspNowMeshNeighbors.List;
  assert.ok(n.length >= 2);
  for (const x of n) assert.equal(x.Key, 2, `neighbour ${x.Id} says version 2`);
  assert.equal(h.berry(1, "espnow_mesh_neighbors()[0]['key']").v, 2, "and Berry reads it");
  // the change closes
  for (const id of [1, 2, 3]) h.cmd(id, "EspNowMeshKeyClose");
  for (const id of [1, 2, 3]) assert.equal(h.status(id).PrevVersion, 0);
});

test("EspNowMeshSend takes flags 0 to 3 (2 makes the tag with the previous key) and refuses the rest", async () => {
  const h = await meshHouse({ bridges: [1, 2], panels: [] });
  h.run(5_000);
  const ok = (flags) => h.cmd(1, `EspNowMeshSend 2,3,${flags},hello`).EspNowMeshSend;
  for (const flags of [0, 1, 2, 3]) assert.ok(ok(flags).Queued === 1, `flags ${flags}`);
  assert.equal(ok(4), "dest 0..255, type 0..7, flags 0..3");
  assert.equal(h.cmd(1, "EspNowMeshSend 2,3").EspNowMeshSend, "dest,type,flags,payload");
});
