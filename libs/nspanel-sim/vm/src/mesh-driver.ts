// The ESP-NOW mesh driver of the firmware (tasmota_xdrv_driver/xdrv_98_1_espnow_mesh.ino) for a simulated device, over the mesh core compiled
// to WebAssembly (mesh.ts) and the air its nodes share (MeshAir).
//
// The firmware's driver is a task that runs the core, a record in the NVS, the commands around it, and the functions and the rule events it
// gives Berry. This is the same, in the same words wherever it can be: a device that has the driver (the `mesh` option of a device) owns one
// node of the house's air, driven by the simulator's virtual time (house.ts: MeshNet.advanceTo, every 5 ms turn), and its Berry has
//
//   espnow_mesh_send(dest, type, ack, data)  espnow_mesh_max_payload(dest)  espnow_mesh_ready([bool])  espnow_mesh_info(data)
//   espnow_mesh_health()  espnow_mesh_clock()  espnow_mesh_stamp()  espnow_mesh_age(stamp)  espnow_mesh_neighbors()
//
// with the argument checks, the return shapes and the `false` of a task that is not running, and the rules get what the firmware's rules get
// ({"EspNowMesh":{...}}: the frame, Outcome, Notice, Timeline, Synced), through the same queues: the core's inbox of 8 and the driver's of 8 for
// the frames, 16 for what the main loop is told besides, 4 for what it asks of the task, a ticket for each send whose outcome is told, and the main
// loop's FUNC_LOOP that empties them. The commands, EspNowMeshEnable to EspNowMeshClock, answer as the firmware's do.
//
// What is not the firmware's:
//   - the task runs in the same thread, at the next step of the air (100 us): a Berry call that queues a command is taken by the task then, so a burst of
//     more than 4 in one instant finds the queue full (the firmware's task drains it on the other core as the commands come, which the bench measures);
//   - the main loop reads the core's clock as it stands, where the firmware's reads the copy the task published (refreshed at once on every change and at
//     least every 500 ms, so the same value): the case of a clock that is not current, when the event of a timeline is held, never arises;
//   - the radio is MeshAir's, apart from the house's Air that the `direct` link uses: no shared channel, lock or table of 20 peers (Peers is 1 and the
//     neighbours, and PeerFull, PeerEvicted, SendFailed, NotAcked, WaitExpired, LateWord and Dropped stay 0), and no queue of 8 between the radio's callback
//     and the task: what the air carries reaches the core;
//   - the identity and the keys of the cipher are the core's own for the node's number, whatever the record holds (the record's secret is the same
//     function of the number, so EspNowMeshPublic gives the key the core uses), and the list of nodes does not gate anything: every node of the air is a
//     neighbour, and two devices with other keys of the network still hear each other. A device with no number (from its box, or after EspNowMeshLeave)
//     has no identity of the core's to match, and draws one of its own, as the firmware draws it at random: from its MAC and the house's time, so that
//     two such devices, or one that left and drew again, never share one, and a test runs the same every time. It keeps it when it is given a number;
//   - not modelled: the restart of the Berry machine (BrRestart: the natives vanish and the application is not ready again), the WiFi stack stopping under
//     ESP-NOW, EspNowMeshChannel (kept in the record, applied to nothing), a flash that refuses a write, the retry of a start after 10 s (a start does not
//     fail here), the records of versions 1 and 2, and the stack the task has free (a constant). Nor the station of xdrv_98_3, which keeps to the mesh's
//     channel, nor the search of xdrv_98_4 on the other channels: the air has one channel for the mesh. EspNowMeshStation answers as the firmware's, with
//     the channel of the access point the device's radio is on (Ap) and the station at rest;
//   - the crystal's pace (MeshAir.setPpm) is the mesh node's counter, the one the core and this driver read as millis(): the Berry of the same device keeps
//     the house's time for its timers, and a restart does not start that counter over at 0 (the mesh clock starts at 0 at every start, whatever the counter).
import { ClockEventKind, LIVENESS, MESH, MeshAir, NoticeKind, type AirOptions, type MeshAirApp, type MeshAirNode, type MeshHealth, type MeshNeighbor } from "./mesh.js";
import { fromHex, sha256, toHex } from "./sha256.js";
import type { SimDevice } from "./device.js";
import type { SimHouse } from "./house.js";

// --- the record the driver keeps in the NVS (ESPNOW_MESH_SETTINGS_VERSION 4, 2188 bytes) ---------------------------------------------

const NODES = 48;
const RECORD_KEY = "espnowmesh/settings";
const RECORD_VERSION = 4;
const RECORD_V3_SIZE = 2152;
const RECORD_SIZE = 2188;
/** the hours a device that holds the previous key of the network runs before it lets it go: 30 days (ESPNOW_MESH_KEY_HOLD_HOURS) */
const KEY_HOLD_HOURS = 720;
const ENTRY_SIZE = 43;
const NET_UDP = 1;
const NET_NO_RADIO = 2;
const NET_RELAY = 4;

/** a node of the list the device was given: its number, its radio address, its public key and the address on the network */
export interface MeshRecordNode {
  id: number;
  mac: number[];
  pub: number[];
  ip: number[];
}

/**
 * The device's record, byte for byte as the firmware saves it as one blob in its own namespace of the NVS ("espnowmesh/settings" of the
 * device's `nvm`): the number, whether the mesh is on, the epoch that rises with every start, the identity, the key of the network, the nodes
 * and the station address of the chip the record was made on.
 */
export class MeshRecord {
  version = RECORD_VERSION;
  enabled = 0;
  id = 0;
  channel = 0;
  network = 0;
  epoch = 0;
  hasSecret = 0;
  hasGroup = 0;
  groupVersion = 0;
  /** the key the network had before its last change is kept until the change closes (since version 4) */
  hasPrev = 0;
  prevVersion = 0;
  /** the hours the device has run holding it */
  prevHours = 0;
  prevKey: Uint8Array = new Uint8Array(32);
  secret: Uint8Array = new Uint8Array(32);
  groupKey: Uint8Array = new Uint8Array(32);
  node: MeshRecordNode[] = Array.from({ length: NODES }, () => ({ id: 0, mac: Array(6).fill(0), pub: Array(32).fill(0), ip: Array(4).fill(0) }));
  mac: Uint8Array = new Uint8Array(6);

  encode(): Uint8Array {
    const b = new Uint8Array(RECORD_SIZE);
    const dv = new DataView(b.buffer);
    dv.setUint32(0, this.version, true);
    b[4] = this.enabled;
    b[5] = this.id;
    b[6] = this.channel;
    b[7] = this.network;
    dv.setUint32(8, this.epoch, true);
    b[12] = this.hasSecret;
    b[13] = this.hasGroup;
    b[14] = this.groupVersion;
    b.set(this.secret, 16);
    b.set(this.groupKey, 48);
    this.node.forEach((n, i) => {
      const o = 80 + i * ENTRY_SIZE;
      b[o] = n.id;
      b.set(n.mac, o + 1);
      b.set(n.pub, o + 7);
      b.set(n.ip, o + 39);
    });
    b.set(this.mac, 2144);
    b[2152] = this.hasPrev;
    b[2153] = this.prevVersion;
    dv.setUint16(2154, this.prevHours, true);
    b.set(this.prevKey, 2156);
    return b;
  }

  /** the record a blob is, or null when it is none that this firmware knows (a size that does not go with a version it has had) */
  static decode(b: Uint8Array): MeshRecord | null {
    if (b.length !== RECORD_SIZE && b.length !== RECORD_V3_SIZE) return null;
    const dv = new DataView(b.buffer, b.byteOffset, b.length);
    const version = dv.getUint32(0, true);
    // a record of version 3 is the front of this one, with no previous key
    if (!((version === RECORD_VERSION && b.length === RECORD_SIZE) || (version === 3 && b.length === RECORD_V3_SIZE))) return null;
    const r = new MeshRecord();
    r.enabled = b[4];
    r.id = b[5];
    r.channel = b[6];
    r.network = b[7];
    r.epoch = dv.getUint32(8, true);
    r.hasSecret = b[12];
    r.hasGroup = b[13];
    r.groupVersion = b[14];
    r.secret = b.slice(16, 48);
    r.groupKey = b.slice(48, 80);
    r.node = Array.from({ length: NODES }, (_, i) => {
      const o = 80 + i * ENTRY_SIZE;
      return { id: b[o], mac: Array.from(b.slice(o + 1, o + 7)), pub: Array.from(b.slice(o + 7, o + 39)), ip: Array.from(b.slice(o + 39, o + 43)) };
    });
    r.mac = b.slice(2144, 2150);
    if (b.length === RECORD_SIZE && r.hasGroup) {
      r.hasPrev = b[2152];
      r.prevVersion = b[2153];
      r.prevHours = dv.getUint16(2154, true);
      r.prevKey = b.slice(2156, 2188);
    }
    return r;
  }
}

// --- what the driver is given and what it holds ---------------------------------------------------------------------------------------

/** a node of the list a device is provisioned with: its number alone, or with the address the device has (the station's MAC and its IP) */
export type MeshNodeSpec = number | { id: number; mac?: string; ip?: string };

/**
 * The firmware image of a device carries the mesh driver: this is what a device with it is set up with, as the bench's `setup` does it with
 * EspNowMeshId, EspNowMeshGroupKey, EspNowMeshNode and EspNowMeshEnable 1. It applies to a flash that has no record: one that has, keeps what it
 * holds, and the commands change that.
 */
export interface DeviceMeshOptions {
  /** the node's number, 1 to 254 (EspNowMeshId) */
  id: number;
  /** the key of the network, 32 bytes as 64 hex digits (EspNowMeshGroupKey). None for a device that is not in a house yet (the factory's): it has the number it is to be given, no key, no nodes
   * and the mesh off, and it is brought into the house by what the house layer hands it (berry/house_mesh.be, welcome and accept) */
  groupKey?: string | Uint8Array;
  groupVersion?: number;
  /** the nodes it talks to (EspNowMeshNode); every one of the house's that was set up before it, and it with them, when not said */
  nodes?: MeshNodeSpec[];
  /** the mesh is on at boot, EspNowMeshEnable 1: it is when not said */
  enabled?: boolean;
  /** EspNowMeshNetwork: 1 also by the network, 2 no radio in use, 4 repeats on the network for the nodes with none */
  network?: number;
  /** where the node stands, metres, for the air's links when the house's are made from the places (MeshNetOptions.links) */
  at?: [number, number];
  /** how far its crystal runs from the house's time, in parts per million: 0 when not said (meshDrift sets it later) */
  ppm?: number;
}

/** how the nodes of a house hear each other: the signal, in dBm, of `a` at `b`, or undefined for out of range */
export type MeshLinks = (a: { id: number; x: number; y: number }, b: { id: number; x: number; y: number }) => number | undefined;

export interface MeshNetOptions {
  /** the air's own options over the driver's (the firmware's: heartbeats every 5 s, the start asks, the choice of relays, the clock, a cipher with the shape of the real one) */
  air?: AirOptions;
  /** "room": every pair hears each other at `rssi`; or a function of the two places (placesLinks) */
  links?: "room" | MeshLinks;
  /** the signal of every pair in a room, dBm: -55 when not said */
  rssi?: number;
}

/** what the firmware's task is configured with (ESPNOW_MESH_BEAT_MS, ESPNOW_MESH_CHOOSE_RELAYS, ESPNOW_MESH_CLOCK, the core's start asks, its cipher) */
const FIRMWARE_AIR: AirOptions = { beatMs: 5000, startSync: true, chooseRelays: true, clock: true, keys: true, cipher: true, weakDbm: -70, suppressAt: 2, declineEpoch: true, routeUnicast: true };

/** the log-distance model of the signal from the places, as MeshAir.geometry has it, less what `walls(a, b)` takes off */
export function placesLinks(exponent = 2.2, walls: (a: { id: number }, b: { id: number }) => number = () => 0): MeshLinks {
  return (a, b) => {
    const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    return Math.round(-40 - 10 * exponent * Math.log10(d) - walls(a, b));
  };
}

/** the Berry the firmware registers at FUNC_INIT: its natives, here over the one native of this VM, `_host(op, arg)`, answered by the driver (MeshDriver.host) */
export const MESH_BERRY = `# espnow_mesh.be -- the Berry functions of the ESP-NOW mesh driver (xdrv_98_1_espnow_mesh.ino, EspNowMeshBerryRegister), over _host.
import json
def _mesh_hex(data)
    if isinstance(data, bytes) return data.tohex() end
    if type(data) == "string" return bytes().fromstring(data).tohex() end
    return nil
end
def espnow_mesh_send(*a)
    if size(a) < 4 || type(a[0]) != "int" || type(a[1]) != "int" raise "type_error" end
    var hex = _mesh_hex(a[3])
    if hex == nil return false end
    var ticket = int(_host("mesh_send", json.dump([a[0], a[1], a[2] ? true : false, hex, size(a) >= 5 && a[4] ? true : false])))
    return ticket > 0 ? ticket : false
end
def espnow_mesh_max_payload(*a)
    if size(a) < 1 || type(a[0]) != "int" || a[0] < 0 || a[0] > 255 raise "type_error" end
    return int(_host("mesh_max_payload", str(a[0])))
end
def espnow_mesh_ready(*a)
    _host("mesh_ready", (size(a) < 1 || a[0]) ? "1" : "0")
    return true
end
def espnow_mesh_info(*a)
    if size(a) < 1 raise "type_error" end
    var hex = _mesh_hex(a[0])
    if hex == nil return false end
    return _host("mesh_info", hex) == "1"
end
def espnow_mesh_health()
    var r = _host("mesh_health")
    return r != nil ? json.load(r) : false
end
def espnow_mesh_clock()
    var r = _host("mesh_clock")
    return r != nil ? json.load(r) : false
end
def espnow_mesh_stamp()
    var r = _host("mesh_stamp")
    return r != nil ? bytes(r) : false
end
def espnow_mesh_age(*a)
    if size(a) < 1 || !isinstance(a[0], bytes) raise "type_error" end
    var r = _host("mesh_age", a[0].tohex())
    return r != nil ? json.load(r) : false
end
def espnow_mesh_neighbors()
    var r = _host("mesh_neighbors")
    return r != nil ? json.load(r) : false
end
def espnow_mesh_route(*a)
    if size(a) < 1 || type(a[0]) != "int" raise "type_error" end
    var r = _host("mesh_route", str(a[0]))
    return r != nil ? json.load(r) : false
end
def espnow_mesh_pair_key(*a)
    if size(a) < 1 || !isinstance(a[0], bytes) raise "type_error" end
    var r = _host("mesh_pair_key", a[0].tohex())
    return r != nil ? bytes(r) : false
end
def espnow_mesh_group_seal(*a)
    if size(a) < 2 || type(a[0]) != "string" || !isinstance(a[1], bytes) raise "type_error" end
    var r = _host("mesh_group_seal", json.dump([a[0], a[1].tohex()]))
    if r == nil return false end
    var m = json.load(r)
    return [m[0], bytes(m[1])]
end
def espnow_mesh_group_open(*a)
    if size(a) < 3 || type(a[0]) != "string" || type(a[1]) != "int" || !isinstance(a[2], bytes) raise "type_error" end
    var r = _host("mesh_group_open", json.dump([a[0], a[1], a[2].tohex()]))
    return r != nil ? bytes(r) : false
end
`;

const wrap32 = (x: number): number => Number(BigInt.asIntN(32, BigInt(Math.trunc(x))));
const hexBytes = (b: ArrayLike<number>): string => toHex(Uint8Array.from(b));
const macText = (b: ArrayLike<number>): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(":").toUpperCase();

/** the 16 bits that name a timeline in a stamp (TimelineTag): its node, its epoch's two halves, folded */
const timelineTag = (t: ArrayLike<number>): number => ((t[0] << 8) ^ ((t[1] << 8) | t[2]) ^ ((t[3] << 8) | t[4])) & 0xffff;

/** what the main loop asks of the task (EspNowMeshCmd_t) */
interface Cmd {
  op: "send" | "info";
  type: number;
  dest: number;
  ack: boolean;
  /** the tag is made with the key the network had before its last change */
  previous?: boolean;
  data: Uint8Array;
  ticket: number;
  /** when the main loop handed it over, on the air's clock in µs (micros()) */
  queuedUs?: number;
}

/** what the task tells the main loop besides the frames (EspNowMeshNote_t) */
type Note =
  | { kind: "outcome"; ticket: number; frame: number; dest: number; ok: boolean; attempts: number; queueUs: number; rttUs: number }
  | { kind: "notice"; node: number; noticeKind: number; by: number; value: number }
  | { kind: "timeline"; from: Uint8Array; to: Uint8Array; ticks: number; delta: number; synced: boolean }
  | { kind: "synced"; to: Uint8Array; synced: boolean };

/** a frame for the application, on its way to the main loop (EspNowMeshEvent_t) */
interface FrameEvent {
  origin: number;
  type: number;
  flags: number;
  part: number;
  attempt: number;
  behind: number;
  dest: number;
  rssi: number;
  counter: number;
  epoch: number;
  joins: number;
  data: Uint8Array;
}

/** a neighbour as the task last saw it (EspNowMeshNeighbor_t) */
interface SnapNeighbor {
  id: number;
  state: number;
  listsMe: number;
  noRadio: number;
  rssi: number;
  theirRssi: number;
  ageS: number;
  beatS: number;
  heardAt: number;
  beatAt: number;
  hears: number;
  info: Uint8Array;
  clockSkew: number;
  clockSeen: number;
  keyVersion: number;
  keyBits: number;
  fwd: number;
}

/** what the task publishes for the status commands and the functions of Berry that read it (EspNowMeshSnapshot_t), up to 500 ms old */
interface Snapshot {
  at: number;
  stats: Record<string, number>;
  queued: number;
  waiting: number;
  noisy: number;
  loss: number;
  netUp: boolean;
  silent: number[];
  stackFree: number;
  health: MeshHealth;
  neighbors: SnapNeighbor[];
  /** the nodes of the table but this one, each with the neighbour a frame for it goes to next and how (Node::NextHop; [0, 0]: no way known) */
  routes: Map<number, [number, number]>;
  /** this device hears frames whose tag it cannot check, and none that it can */
  needsKey: number;
}

/** what a message takes, in characters (MESSZ), the margin a page of a list keeps from it, and what the end of a page that stops early takes (],"Next":255}}): the
 * lists the commands answer in pages are held to them, as the firmware's driver holds them (ESPNOW_MESH_PAGE_MAX, ESPNOW_MESH_PAGE_END) */
export const MESSZ = 1040;
export const PAGE_MAX = MESSZ - 40;
const PAGE_END = 16;

/** a page of a list: `head` ends where the entries begin; as many entries from `first` are added as still fit with the end of the answer, at least one, and the
 * list is closed with the index the next page starts at, "Next", when some remain; `tail` is what closes the answer */
export function pageList(head: string, entries: string[], first: number, tail: string): string {
  let s = head;
  let i = first;
  for (; i < entries.length; i++) {
    const piece = (i === first ? "" : ",") + entries[i];
    if (i > first && s.length + piece.length + PAGE_END > PAGE_MAX) break;
    s += piece;
  }
  s += "]";
  if (i < entries.length) s += `,"Next":${i}`;
  return s + tail;
}

const CMD_DEPTH = 4;
const EVENT_DEPTH = 8;
const NOTE_DEPTH = 16;
const SENT_DEPTH = 16;
const SNAPSHOT_MS = 500;
const MAX_INFO = 32;
const STACK_FREE = 2800;

/** the counters the status commands name, in the core's words */
const STATUS_STATS = ["prevKeyHeard", "prevKeyDropped", "heard", "bad", "repeated", "replayed", "stale", "unsynced", "covered", "delivered", "inboxFull", "sentOwn", "sentRelay", "suppressed", "queueFull", "noRoute", "noKey", "acksSent", "acksHeard", "resent", "gaveUp", "hopFailed", "syncDone", "syncShed", "beatsHeard", "rescued", "cipherBad", "udpSent", "udpHeard"] as const;

/** the commands of the driver (kEspNowMeshCommands), by their name in lower case */
const COMMANDS: Record<string, string> = Object.fromEntries(["EspNowMeshEnable", "EspNowMeshId", "EspNowMeshChannel", "EspNowMeshGroupKey", "EspNowMeshNode", "EspNowMeshPublic", "EspNowMeshNetwork", "EspNowMeshInfo", "EspNowMeshSend", "EspNowMeshStatus", "EspNowMeshNeighbors", "EspNowMeshReady", "EspNowMeshStats", "EspNowMeshHealth", "EspNowMeshClock", "EspNowMeshKeyClose", "EspNowMeshLeave", "EspNowMeshStation"].map((c) => [c.toLowerCase(), c]));

/** every counter of the core the snapshot keeps, for the status commands and Berry */
const SNAPSHOT_STATS = ["syncAsked", "syncBad", "startAsks", "beatsSent", "pings", "probes", "verdictsSent", "verdictsHeard", "noiseSent", "keptAsOnlyWay", "relayHeld", "counterOut", "partsSent", "piecesSent", "piecesNew", "piecesRepeated", "naksSent", "bulkDone", "bulkLost", "clockSteps", "timelinesTaken", "clockEventsLost", ...STATUS_STATS] as const;

const NOTICE_NAMES: Record<number, string> = { [NoticeKind.Silent]: "Silent", [NoticeKind.Back]: "Back", [NoticeKind.Noisy]: "Noisy", [NoticeKind.Calm]: "Calm", [NoticeKind.BulkDone]: "BulkDone", [NoticeKind.BulkLost]: "BulkLost" };

// --- the house's mesh ----------------------------------------------------------------------------------------------------------------

/**
 * The air of a house's mesh: one MeshAir that every device with the driver has a node on, run by the house's clock. A node starts when its device's
 * driver does (an epoch above the last one the device had, a clock that begins at 0, a timeline of its own), stops when it does or when the device
 * leaves the house, and keeps its place and the pace of its crystal through both.
 */
export class MeshNet {
  readonly air: MeshAir;
  readonly house: SimHouse;
  /** the driver that has each node number now */
  readonly drivers = new Map<number, MeshDriver>();
  private links: "room" | MeshLinks;
  private readonly rssi: number;

  private constructor(house: SimHouse, air: MeshAir, opt: MeshNetOptions) {
    this.house = house;
    this.air = air;
    this.links = opt.links ?? "room";
    this.rssi = opt.rssi ?? -55;
    air.t = house.now * 1000;
  }

  static async create(house: SimHouse, opt: MeshNetOptions = {}): Promise<MeshNet> {
    return new MeshNet(house, await MeshAir.create({ ...FIRMWARE_AIR, ...opt.air }), opt);
  }

  /** runs the air up to the house's time, ms: the nodes' tasks, the frames in the air, the clocks */
  advanceTo(ms: number) {
    const dt = ms * 1000 - this.air.t;
    if (dt > 0) this.air.run(dt / 1000);
  }

  /** how the nodes hear each other, from now on and for the ones that come */
  setLinks(links: "room" | MeshLinks) {
    this.links = links;
    this.relink();
  }

  /** every pair's signal, from the places or the room */
  relink() {
    const nodes = this.air.nodes;
    for (const a of nodes) {
      for (const b of nodes) {
        if (a.id >= b.id) continue;
        const rssi = this.links === "room" ? this.rssi : this.links(a, b);
        if (rssi === undefined) this.air.unlink(a.id, b.id);
        else this.air.link(a.id, b.id, rssi);
      }
    }
  }

  /** a driver starts its node: a new run, under the epoch it was given */
  startNode(driver: MeshDriver, epoch: number, at: [number, number] | undefined, ppm: number | undefined): MeshAirNode {
    const id = driver.record.id;
    const holder = this.drivers.get(id);
    if (holder && holder !== driver && holder.running) throw new Error(`mesh node ${id} is already run by another device of the house`);
    const network = driver.record.network;
    const start = { udpOnly: (network & NET_NO_RADIO) !== 0, udpRelay: (network & NET_RELAY) !== 0, net: false };
    let node: MeshAirNode;
    if (this.air.has(id)) {
      this.air.restart(id, { epoch, ...start });
      node = this.air.node(id);
      if (at) { node.x = at[0]; node.y = at[1]; }
    } else {
      node = this.air.add(id, at?.[0] ?? 0, at?.[1] ?? 0, epoch, { ...start, ppm: ppm ?? 0 });
    }
    node.app = driver;
    this.drivers.set(id, driver);
    this.relink();
    return node;
  }

  /** a driver stops its node: nothing is heard or sent, and the application is no more told anything */
  stopNode(driver: MeshDriver) {
    const id = driver.record.id;
    if (!this.air.has(id)) return;
    const node = this.air.node(id);
    if (node.app !== driver) return;
    node.on = false;
    node.app = undefined;
    node.backoff = null;
  }

  /** the clock of a node now */
  clock(id: number) {
    return this.air.clock(id);
  }

  /** the timelines the nodes that run are on, each as 10 hex digits */
  timelines(): Set<string> {
    return new Set(this.air.nodes.filter((n) => n.on).map((n) => hexBytes(this.air.clock(n.id).timeline)));
  }

  /** a node introduced to the others, as the bench's setup does: each gets the other's number, address and public key */
  introduce(driver: MeshDriver) {
    for (const other of this.drivers.values()) {
      if (other === driver) continue;
      driver.setNode(other.record.id, other.device.mac, other.publicKey(), other.device.ip);
      other.setNode(driver.record.id, driver.device.mac, driver.publicKey(), driver.device.ip);
    }
  }
}

// --- the driver of a device ------------------------------------------------------------------------------------------------------------

export class MeshDriver implements MeshAirApp {
  readonly device: SimDevice;
  readonly net: MeshNet;
  /** the record, as the flash holds it */
  record: MeshRecord;
  /** the identities this driver drew for a device with no number: what makes two draws at the same instant differ */
  private draws = 0;
  /** the task runs */
  running = false;
  /** the application has said it is ready for the frames for it: with Berry it says so itself (espnow_mesh_ready, espnow_mesh_info), and the device starts not ready */
  appReady = false;
  /** what the task has counted of its own, beside the core's (EspNowMeshCount) */
  readonly count = { cmdBusy: 0, evtFull: 0, noteLost: 0, refused: 0, sendFailed: 0, bcastFailed: 0, peerFailed: 0, peerFull: 0, peerEvicted: 0, waitExpired: 0, lateWord: 0, notAcked: 0, dropped: 0 };
  /** every line the main loop gave the rules, in order, as the firmware's Response_P built it */
  readonly told: string[] = [];
  private readonly opts: DeviceMeshOptions | undefined;
  private ticket = 0;
  private cmd: Cmd[] = [];
  private events: FrameEvent[] = [];
  private notes: Note[] = [];
  private sent: { frame: number; ticket: number; dest: number; sentUs: number; queueUs: number }[] = Array.from({ length: SENT_DEPTH }, () => ({ frame: 0, ticket: 0, dest: 0, sentUs: 0, queueUs: 0 }));
  private sentNext = 0;
  private snapshot: Snapshot | null = null;
  private snapshotAt: number | null = null;
  private clockValid = false;
  /** the readiness the core has been given */
  private deliverApplied = false;
  private epochAhead = 0;
  private node: MeshAirNode | null = null;

  constructor(device: SimDevice, net: MeshNet, opts: DeviceMeshOptions | undefined) {
    this.device = device;
    this.net = net;
    this.opts = opts;
    const fresh = this.device.nvm[RECORD_KEY] === undefined;
    this.record = this.load();
    if (this.record.id) this.net.drivers.set(this.record.id, this);
    if (opts && fresh) this.provision(opts);
  }

  // --- the record --------------------------------------------------------------------------------------------------------------------

  private stationMac(): Uint8Array {
    return Uint8Array.from(this.device.mac.replace(/[^0-9A-Fa-f]/g, "").match(/../g)!.map((x) => parseInt(x, 16)));
  }

  /** EspNowMeshSettingsLoad: the record the flash holds, and the changes of a record made on another chip (a copy of the flash): no number, no identity, the mesh off */
  private load(): MeshRecord {
    const hex = this.device.nvm[RECORD_KEY];
    let r = new MeshRecord();
    if (hex !== undefined) {
      const decoded = MeshRecord.decode(fromHex(hex));
      if (decoded) r = decoded;
      else this.log(1, `EMH: The saved record of ${hex.length / 2} bytes has a size that does not go with its version (error 0): the device starts over, with an identity of its own`);
    }
    const own = this.stationMac();
    const none = r.mac.every((x) => x === 0);
    if (!none && !r.mac.every((x, i) => x === own[i])) {
      const text = macText(r.mac);
      if (r.hasSecret) {
        this.log(2, `EMH: The record was made on the chip ${text}, and this is another: the identity and the epoch are made again, and the new public key is to be given to the other nodes`);
        r.secret = new Uint8Array(32);
        r.hasSecret = 0;
        r.epoch = 0;
      }
      if (r.id || r.enabled) {
        this.log(2, `EMH: The record was made on the chip ${text}: its node number ${r.id} was cleared and the mesh is off, as on a new device; give this one a number with EspNowMeshId, then EspNowMeshEnable 1`);
        r.id = 0;
        r.enabled = 0;
      }
    }
    r.mac = own;
    r.version = RECORD_VERSION;
    return r;
  }

  /** the seconds of the hour a device that holds the previous key is running */
  private prevSeconds = 0;

  /** the previous key is let go: the change of the key has reached every node, or the time for it has run out */
  private closeKey() {
    const r = this.record;
    if (!r.hasPrev) return;
    r.prevKey = new Uint8Array(32);
    r.prevVersion = 0;
    r.prevHours = 0;
    r.hasPrev = 0;
    this.prevSeconds = 0;
    this.commit();
    this.applyKeys(false);
  }

  /** what the task does with the keys the main loop pushed (EspNowMeshApplyShared): the core is given them, and a change has its time to reach the others */
  private applyKeys(changed: boolean, starting = false) {
    if ((!this.running && !starting) || !this.node || !this.net.air.realCipher) return;
    const r = this.record;
    const air = this.net.air;
    if (changed && r.hasPrev) air.keyChange(this.node.id, r.groupKey, r.groupVersion);
    else air.keySet(this.node.id, r.groupKey, r.groupVersion, r.hasPrev ? r.prevKey : 0, r.hasPrev ? r.prevVersion : 0);
  }

  /** the record saved: always taken here (the firmware's answers "flash write failed" when the flash is not) */
  private commit(): boolean {
    const hex = toHex(this.record.encode());
    this.device.nvmWrite(RECORD_KEY, hex);
    return true;
  }

  /** the commands of a bench's setup, given as an option: the number, the identity, the key of the network, the nodes, and the mesh on */
  private provision(o: DeviceMeshOptions) {
    const r = this.record;
    r.id = o.id;
    r.channel = 0;
    r.network = (o.network ?? 0) & 7;
    // a device that is not in a house yet: its number, its identity, and nothing of the house's. It is not among the nodes the others are introduced to
    if (o.groupKey === undefined) {
      r.enabled = o.enabled === true ? 1 : 0;
      this.makeIdentity();
      this.commit();
      return;
    }
    r.enabled = o.enabled === false ? 0 : 1;
    const key = typeof o.groupKey === "string" ? fromHex(o.groupKey) : o.groupKey;
    if (key.length !== 32) throw new Error("the key of the network is 32 bytes");
    r.groupKey = Uint8Array.from(key);
    r.hasGroup = 1;
    r.groupVersion = o.groupVersion ?? 1;
    this.makeIdentity();
    this.commit();
    this.net.drivers.set(r.id, this);
    if (o.nodes === undefined) {
      this.net.introduce(this);
    } else {
      for (const spec of o.nodes) {
        const id = typeof spec === "number" ? spec : spec.id;
        const other = this.net.drivers.get(id);
        const mac = typeof spec === "object" && spec.mac ? spec.mac : other?.device.mac ?? "00:00:00:00:00:" + id.toString(16).padStart(2, "0");
        const ip = typeof spec === "object" && spec.ip ? spec.ip : other?.device.ip ?? "0.0.0.0";
        this.setNode(id, mac, other?.publicKey() ?? new Uint8Array(32), ip);
      }
    }
  }

  /** the identity, an X25519 pair, as the core's real cipher makes it for the node's number: the public key is the one the air's nodes use among themselves */
  private makeIdentity() {
    const r = this.record;
    if (r.id === 0) r.secret = sha256(new TextEncoder().encode(`identity|${this.device.mac}|${this.device.house?.now ?? 0}|${this.draws++}`));
    else for (let i = 0; i < 32; i++) r.secret[i] = (r.id * 37 + i * 11 + 5) & 255;
    r.hasSecret = 1;
  }

  /** this device's public key, as EspNowMeshPublic gives it */
  publicKey(): Uint8Array {
    if (!this.record.hasSecret) this.makeIdentity();
    const base = new Uint8Array(32);
    base[0] = 9;
    return this.net.air.core.x25519(this.record.secret, base) ?? new Uint8Array(32);
  }

  /** a node in the list (EspNowMeshNode <id>,<mac>,<public key>,<ip>), in the slot it has or the first that is free; false when there is none */
  setNode(id: number, mac: string, pub: Uint8Array, ip: string): boolean {
    if (id === this.record.id) return true;
    let at = this.record.node.findIndex((n) => n.id === id);
    if (at < 0) at = this.record.node.findIndex((n) => n.id === 0);
    if (at < 0) return false;
    this.record.node[at] = { id, mac: mac.split(":").map((x) => parseInt(x, 16)), pub: Array.from(pub), ip: ip.split(".").map(Number) };
    this.commit();
    return true;
  }

  // --- logs and the radio ------------------------------------------------------------------------------------------------------------

  private log(level: number, line: string) {
    this.device.logLine(level, line);
  }

  /** WiFi.getMode() & WIFI_MODE_STA: the station's part of the radio is there, joined or not */
  private radioReady(): boolean {
    return (this.device.radio.state().mode & 1) !== 0;
  }

  /** what keeps the mesh from starting, or null (EspNowMeshWhyNot) */
  whyNot(): string | null {
    if (!this.record.id) return "needs EspNowMeshId";
    if (!this.record.hasGroup) return "needs EspNowMeshGroupKey";
    if (!this.radioReady()) return "WiFi is not up";
    return null;
  }

  // --- start and stop -----------------------------------------------------------------------------------------------------------------

  /** EspNowMeshStartAttempt: the epoch is saved before the task that sends under it starts; the node begins a new run, a new timeline whose clock starts at 0 */
  private startAttempt(): boolean {
    const r = this.record;
    if (!r.id) return false;
    if (!r.hasSecret) {
      this.makeIdentity();
      this.log(2, "EMH: This device has an identity now: EspNowMeshPublic gives its public key");
    }
    let epoch = this.epochAhead;
    if (!epoch) {
      // the epoch of a device that has none is drawn, from this device's own address here, and rises with every start after that
      epoch = r.epoch ? r.epoch + 1 : (this.seedEpoch() >>> 2) | 1;
      if (!epoch) epoch = 1;
      r.epoch = epoch >>> 0;
      this.commit();
      this.epochAhead = epoch;
    }
    this.cmd = [];
    this.events = [];
    this.notes = [];
    this.sent.forEach((s) => { s.frame = 0; });
    this.sentNext = 0;
    this.snapshot = this.emptySnapshot();
    this.snapshotAt = null;
    this.clockValid = false;
    this.count.cmdBusy = this.count.evtFull = this.count.noteLost = this.count.refused = this.count.sendFailed = this.count.bcastFailed = 0;
    this.count.peerFailed = this.count.peerFull = this.count.peerEvicted = this.count.waitExpired = this.count.lateWord = this.count.notAcked = this.count.dropped = 0;
    this.node = this.net.startNode(this, epoch, this.opts?.at, this.opts?.ppm);
    // the task starts with the keys the flash holds, as the firmware's does (the node is not running yet: this is its start)
    this.applyKeys(false, true);
    // the task begins by saying whether the application is ready
    this.net.air.core.setDeliver(this.node.slot, this.appReady);
    this.deliverApplied = this.appReady;
    this.epochAhead = 0;
    this.running = true;
    this.log(2, `EMH: Started as node ${r.id}, epoch ${epoch}, ${this.device.heapFreeKb * 1024} bytes of heap free`);
    if (!this.appReady) this.log(2, "EMH: The frames for the application wait until it says it is ready: espnow_mesh_ready() in a script, or EspNowMeshReady 1");
    return true;
  }

  private seedEpoch(): number {
    let h = 2166136261;
    for (const b of this.stationMac()) h = Math.imul(h ^ b, 16777619) >>> 0;
    return h || 1;
  }

  /** EspNowMeshStart */
  start(): boolean {
    if (this.running) return true;
    if (this.whyNot()) return false;
    return this.startAttempt();
  }

  /** EspNowMeshStop: the task ends, its queues go with it, and what it held of the clock */
  stop() {
    if (!this.running) return;
    this.net.stopNode(this);
    this.running = false;
    this.clockValid = false;
    this.cmd = [];
    this.events = [];
    this.notes = [];
    this.snapshot = null;
    this.node = null;
    this.log(2, "EMH: Stopped");
  }

  /** the device leaves the house, as unplugged or restarted: the node is gone from the air with no word */
  detach() {
    if (this.running) this.net.stopNode(this);
    this.running = false;
    this.node = null;
  }

  /**
   * Tasmota's every-second call (EspNowMeshEverySecond): a node whose frame counter is near its end has asked for the next epoch, which only a start saves: the
   * mesh stops and starts again under it, a new timeline, and a device that has the mesh on starts it once its WiFi is there
   */
  everySecond() {
    // the previous key is held for the hours the device runs, and let go at the end of them
    if (this.record.hasPrev && ++this.prevSeconds >= 3600) {
      this.prevSeconds = 0;
      if (this.record.prevHours < 0xffff) this.record.prevHours++;
      if (this.record.prevHours >= KEY_HOLD_HOURS) {
        this.log(2, `EMH: The previous key of the network has been held for ${this.record.prevHours} hours: it is let go`);
        this.closeKey();
      } else {
        this.commit();
      }
    }
    if (this.running && this.node && this.net.air.core.epochWanted(this.node.slot)) {
      this.log(2, "EMH: The frame counter is near its end: the mesh stops and starts again under the next epoch");
      this.stop();
    }
    if (!this.record.enabled) return;
    if (!this.running) this.start();
  }

  // --- the task's side: what the air calls (MeshAirApp) -------------------------------------------------------------------------------

  /** the start of a turn of the task: the application's readiness, then the commands the main loop queued */
  commands(n: MeshAirNode, _ms: number): void {
    const core = this.net.air.core;
    if (this.deliverApplied !== this.appReady) {
      this.deliverApplied = this.appReady;
      core.setDeliver(n.slot, this.appReady);
    }
    while (this.cmd.length > 0) this.doCommand(n, this.cmd.shift()!);
  }

  /** EspNowMeshDoCommand */
  private doCommand(n: MeshAirNode, c: Cmd) {
    const air = this.net.air;
    if (c.op === "info") {
      air.core.setInfo(n.slot, c.data);
      return;
    }
    const sentUs = air.t;
    const frame = air.handOver(n.id, c.type, c.dest, c.data, c.ack, c.previous === true);
    if (frame === 0) {
      // no room (8 frames waiting for an answer, 16 to send), no key for the destination, or the frame is too long: the caller is told as it is told of
      // a frame that went and was not answered: an outcome that is not ok, with no attempts
      this.count.refused++;
      this.log(2, `EMH: A frame of ${c.data.length} bytes for ${c.dest} was refused: no room, no key or too long`);
      this.putNote({ kind: "outcome", ticket: c.ticket, frame: 0, dest: c.dest, ok: false, attempts: 0, queueUs: 0, rttUs: 0 });
    } else if (c.ack && c.dest !== MESH.TO_ALL) {
      const s = this.sent[this.sentNext];
      s.frame = frame;
      s.ticket = c.ticket;
      s.dest = c.dest;
      s.sentUs = sentUs;
      s.queueUs = Math.max(0, Math.round(sentUs - (c.queuedUs ?? sentUs)));
      this.sentNext = (this.sentNext + 1) % SENT_DEPTH;
    }
  }

  private putNote(note: Note): boolean {
    if (this.notes.length >= NOTE_DEPTH) {
      this.count.noteLost++;
      return false;
    }
    this.notes.push(note);
    return true;
  }

  /** the ticket a frame sent with an answer asked was given, and the times of the send (EspNowMeshTicketOf): how long it waited for the task, and how long from
   * the core's hand-over to now; the entry is free again. A ticket of 0 for a frame that is not one of these */
  private ticketOf(frame: number, dest: number): { ticket: number; queueUs: number; rttUs: number } {
    for (const s of this.sent) {
      if (s.frame && s.frame === frame && s.dest === dest) {
        s.frame = 0;
        return { ticket: s.ticket, queueUs: s.queueUs, rttUs: Math.max(0, Math.round(this.net.air.t - s.sentUs)) };
      }
    }
    return { ticket: 0, queueUs: 0, rttUs: 0 };
  }

  /** EspNowMeshDrain: each is taken out of the core only while the queue that carries it has room, and what the queue has no room for stays in the core */
  drain(n: MeshAirNode, _ms: number): void {
    const air = this.net.air;
    const core = air.core;
    for (let o = this.notes.length < NOTE_DEPTH ? core.popOutcome(n.slot) : null; o; o = this.notes.length < NOTE_DEPTH ? core.popOutcome(n.slot) : null) {
      air.recordOutcome(n, o);
      const t = this.ticketOf(o.counter, o.dest);
      this.putNote({ kind: "outcome", ticket: t.ticket, frame: o.counter, dest: o.dest, ok: o.ok, attempts: o.attempts, queueUs: t.queueUs, rttUs: t.rttUs });
    }
    for (let x = this.notes.length < NOTE_DEPTH ? core.popNotice(n.slot) : null; x; x = this.notes.length < NOTE_DEPTH ? core.popNotice(n.slot) : null) {
      air.recordNotice(n, x);
      this.putNote({ kind: "notice", node: x.node, noticeKind: x.kind, by: x.by, value: x.value });
    }
    // what the clock has to tell, once the clock the main loop reads is the one the core has: here it always is
    this.clockValid = true;
    for (let e = this.notes.length < NOTE_DEPTH ? core.popClockEvent(n.slot) : null; e; e = this.notes.length < NOTE_DEPTH ? core.popClockEvent(n.slot) : null) {
      air.recordClockEvent(n, e);
      this.putNote(e.kind === ClockEventKind.Timeline
        ? { kind: "timeline", from: e.from, to: e.to, ticks: e.ticks, delta: e.delta, synced: e.synced }
        : { kind: "synced", to: e.to, synced: e.synced });
    }
    for (let d = this.events.length < EVENT_DEPTH ? core.pop(n.slot) : null; d; d = this.events.length < EVENT_DEPTH ? core.pop(n.slot) : null) {
      air.recordDelivery(n, d);
      this.events.push({ origin: d.origin, type: d.type, flags: (d.ackRequested ? 1 : 0) | (d.retry ? 2 : 0) | (d.previousKey ? 4 : 0), part: d.part, attempt: d.attempt, behind: d.behind, dest: d.dest,
        rssi: d.rssi, counter: d.counter, epoch: d.epoch, joins: d.joins, data: d.payload });
    }
    if (this.events.length >= EVENT_DEPTH) this.count.evtFull++;
  }

  /** every ms of the node's counter: the snapshot, every 500 ms, and the network up or down for the core */
  tick(n: MeshAirNode, ms: number): void {
    if (this.snapshotAt !== null && ((ms - this.snapshotAt) >>> 0) < SNAPSHOT_MS) return;
    this.snapshotAt = ms;
    const up = this.device.wifi.up;
    const udp = up && ((this.record.network & NET_UDP) !== 0 || n.udpOnly);
    if (n.net !== udp) {
      n.net = udp;
      this.net.air.core.setUdp(n.slot, udp);
    }
    this.snapshot = this.makeSnapshot(n, ms, up);
  }

  private emptySnapshot(): Snapshot {
    return { at: 0, stats: Object.fromEntries(SNAPSHOT_STATS.map((name) => [name, 0])), queued: 0, waiting: 0, noisy: 0, loss: 0, netUp: false, silent: [], stackFree: 0, health: { neighbors: 0, weak: 0, twoHop: 0, branches: 0, relays: 0, soleWays: 0, links: [] }, neighbors: [], routes: new Map(), needsKey: 0 };
  }

  /** EspNowMeshSnapshotMake */
  private makeSnapshot(n: MeshAirNode, now: number, netUp: boolean): Snapshot {
    const core = this.net.air.core;
    const stats: Record<string, number> = {};
    for (const name of SNAPSHOT_STATS) stats[name] = core.stat(n.slot, name);
    const neighbors = core.neighbors(n.slot, now).map((x: MeshNeighbor): SnapNeighbor => ({
      id: x.id, state: LIVENESS.indexOf(x.state), listsMe: x.listsMe, noRadio: x.noRadio ? 1 : 0, rssi: x.rssi, theirRssi: x.theirRssi,
      ageS: Math.floor(((now - x.lastHeard) >>> 0) / 1000) & 0xffff, beatS: x.beatAt ? Math.floor(((now - x.beatAt) >>> 0) / 1000) & 0xffff : 0xffff,
      heardAt: x.lastHeard, beatAt: x.beatAt, hears: x.hears.length, info: x.info, clockSkew: x.clockSkew, clockSeen: x.clockSeen, keyVersion: x.keyVersion, keyBits: x.keyBits, fwd: x.sendQuality,
    }));
    return {
      at: now, stats, queued: core.queued(n.slot), waiting: core.waiting(n.slot), noisy: core.noisy(n.slot) ? 1 : 0, loss: core.lossPercent(n.slot), netUp,
      silent: this.record.node.filter((e) => e.id && core.isSilent(n.slot, e.id)).map((e) => e.id), stackFree: STACK_FREE, health: core.health(n.slot, now), neighbors,
      routes: new Map(this.record.node.filter((e) => e.id && e.id !== this.record.id).map((e) => [e.id, core.nextHop(n.slot, e.id, now)])),
      needsKey: core.keyState(n.slot, now).needsKey ? 1 : 0,
    };
  }

  // --- the main loop's side ------------------------------------------------------------------------------------------------------------

  /** the node's counter now, as millis() reads it in the main loop */
  private millis(): number {
    return this.node ? this.net.air.localMs(this.node) : 0;
  }

  /** the application is ready for the frames for it, or it is not (EspNowMeshSetReady) */
  setReady(ready: boolean) {
    if (ready === this.appReady) return;
    this.appReady = ready;
    this.log(2, ready ? "EMH: The application is ready: the frames for it are taken" : "EMH: The application is not ready: the frames for it are not taken");
    if (this.node) this.net.air.wake(this.node.id);
  }

  /**
   * EspNowMeshQueueCommand: 1 the task has it, 0 it is not running, -1 its queue is full. A send is given its ticket here, the one the caller gets back and the
   * outcome of the frame carries
   */
  private queueCommand(c: Omit<Cmd, "ticket">): { result: number; ticket: number } {
    if (!this.running || !this.node) return { result: 0, ticket: 0 };
    let ticket = (this.ticket + 1) >>> 0;
    if (!ticket) ticket = 1;
    const cmd: Cmd = { ...c, ticket: c.op === "send" ? ticket : 0, queuedUs: this.net.air.t };
    if (this.cmd.length >= CMD_DEPTH) {
      this.count.cmdBusy++;
      return { result: -1, ticket: 0 };
    }
    this.cmd.push(cmd);
    if (c.op === "send") this.ticket = ticket;
    this.net.air.wake(this.node.id);
    return { result: 1, ticket: cmd.ticket };
  }

  private maxPayload(dest: number): number {
    if (this.node) return this.net.air.core.maxPayload(this.node.slot, dest);
    return MESH.MAX_PAYLOAD - (dest !== MESH.TO_ALL ? 8 : 0);
  }

  /** FUNC_LOOP: what the task told the main loop reaches the rules, the notes first and then the frames, each as the firmware's Response_P builds it */
  loop() {
    if (this.notes.length === 0 && this.events.length === 0) return;
    for (const note of this.notes.splice(0)) {
      let json: string;
      if (note.kind === "outcome") {
        this.log(2, `EMH: Send ${note.ticket} (frame ${note.frame}) for ${note.dest} ${note.ok ? "was answered" : "was not answered"} after ${note.attempts} attempts, in ${Math.floor(note.rttUs / 1000)}.${Math.floor((note.rttUs % 1000) / 100)} ms`);
        json = `{"EspNowMesh":{"Outcome":{"Counter":${note.ticket},"Frame":${note.frame},"Dest":${note.dest},"Ok":${note.ok ? 1 : 0},"Attempts":${note.attempts},"QueueUs":${note.queueUs},"RttUs":${note.rttUs}}}}`;
      } else if (note.kind === "timeline") {
        const from = hexBytes(note.from);
        const to = hexBytes(note.to);
        this.log(2, `EMH: The clock took the timeline ${to} from ${from}: ${note.delta} ms, ${note.ticks} ticks of 100 ms`);
        json = `{"EspNowMesh":{"Timeline":{"Old":"${from}","New":"${to}","Ticks":${note.ticks},"Delta":"${note.delta}","Synced":${note.synced ? 1 : 0}}}}`;
      } else if (note.kind === "synced") {
        const to = hexBytes(note.to);
        this.log(2, `EMH: The clock is ${note.synced ? "synced" : "not synced"}, in the timeline ${to}`);
        json = `{"EspNowMesh":{"Synced":{"Value":${note.synced ? 1 : 0},"Timeline":"${to}","Tag":${timelineTag(note.to)}}}}`;
      } else {
        const name = NOTICE_NAMES[note.noticeKind] ?? "?";
        this.log(2, `EMH: ${name}, node ${note.node}, said by ${note.by}`);
        json = `{"EspNowMesh":{"Notice":{"Kind":"${name}","Node":${note.node},"By":${note.by},"Value":${note.value}}}}`;
      }
      this.tell(json);
    }
    for (const e of this.events.splice(0)) {
      this.log(2, `EMH: From ${e.origin} type ${e.type} dest ${e.dest} counter ${e.counter} rssi ${e.rssi}${e.flags & 2 ? " repeat" : ""}: ${e.data.length} bytes`);
      const json = `{"EspNowMesh":{"From":${e.origin},"Type":${e.type},"Dest":${e.dest},"Counter":${e.counter},"Epoch":${e.epoch},"Rssi":${e.rssi},"Flags":${e.flags},"Part":${e.part},"Joins":${e.joins},"Behind":${e.behind},"Data":"${toHex(e.data)}"}}`;
      this.tell(json);
    }
  }

  /** a line to the rules, and kept for a test to read (the last 5000) */
  private tell(json: string) {
    this.told.push(json);
    if (this.told.length > 6000) this.told.splice(0, 1000);
    this.device.rule(json);
  }

  // --- Berry: the natives behind _host (MESH_BERRY) -------------------------------------------------------------------------------------------

  /** the answer to `_host(op, arg)` for the functions of the driver: a string, or null for nil (what the Berry of MESH_BERRY turns into false) */
  host(op: string, arg: string | null): string | null {
    const air = this.net.air;
    switch (op) {
      case "mesh_send": {
        // EspNowMeshBerrySend: the ticket, or 0 when it was not taken (the task is not running, its queue is full, the destination or the type is out of range, or the data is too long)
        const [dest, type, ack, hex, previous] = JSON.parse(arg!) as [number, number, boolean, string, boolean?];
        const data = fromHex(hex);
        if (dest < 0 || dest > 255 || type < 0 || type > 7 || type === 4 || data.length > this.maxPayload(dest)) return "0";
        const q = this.queueCommand({ op: "send", type, dest, ack, data, previous: previous === true });
        return String(q.result === 1 ? q.ticket : 0);
      }
      case "mesh_max_payload": return String(this.maxPayload(Number(arg)));
      case "mesh_ready":
        this.setReady(arg === "1");
        return "1";
      case "mesh_info": {
        // EspNowMeshBerryInfo: true when the task took the bytes (up to 32); a script that tells the heartbeat what it carries has the rest of its rules in place, so it is ready
        const data = fromHex(arg!);
        if (data.length > MAX_INFO) return "0";
        const q = this.queueCommand({ op: "info", type: 0, dest: 0, ack: false, data });
        this.setReady(true);
        return q.result === 1 ? "1" : "0";
      }
      case "mesh_health": {
        if (!this.running || !this.snapshot) return null;
        const h = this.snapshot.health;
        return JSON.stringify({ neighbors: h.neighbors, weak: h.weak, twohop: h.twoHop, branches: h.branches, cut: h.branches > 1 ? 1 : 0, soleways: h.soleWays, alone: h.neighbors === 1 ? 1 : 0, relays: h.relays });
      }
      case "mesh_clock": {
        if (!this.running || !this.node || !this.clockValid) return null;
        const c = air.core.clock(this.node.slot, this.millis());
        return JSON.stringify({
          synced: c.synced, adopted: c.adopted, ticks10: wrap32(Math.floor(c.mesh / 10)), ticks100: wrap32(Math.floor(c.mesh / 100)), tag: c.tag,
          timeline: hexBytes(c.timeline), taken: air.core.stat(this.node.slot, "timelinesTaken"), lo: wrap32(c.mesh), hi: wrap32(Math.floor(c.mesh / 2 ** 32)),
        });
      }
      case "mesh_stamp": {
        if (!this.running || !this.node || !this.clockValid) return null;
        const s = air.core.stamp(this.node.slot, this.millis());
        return s ? hexBytes(s) : null;
      }
      case "mesh_age": {
        if (!this.running || !this.node || !this.clockValid) return null;
        const now = this.millis();
        const a = air.core.age(this.node.slot, fromHex(arg!), now);
        if (!a) return null;
        return JSON.stringify({ age: a.ageMs, tag: a.sameTimeline, synced: air.core.clock(this.node.slot, now).synced });
      }
      case "mesh_route": {
        if (!this.running || !this.snapshot) return null;
        return JSON.stringify(this.snapshot.routes.get(Number(arg)) ?? [0, 0]);
      }
      case "mesh_pair_key": {
        // the key this node shares with a service of the network that is no node of the mesh (the house's server), as
        // EspNowMeshBerryPairKey derives it: HKDF-SHA256 of the X25519 of the two identities, salt "houseweave-server", info "http"
        const pub = fromHex(arg ?? "");
        if (!this.record.hasSecret || pub.length !== 32) return null;
        const shared = air.core.x25519(this.record.secret, pub);
        if (!shared) return null;
        const enc = new TextEncoder();
        return hexBytes(air.core.hkdf(enc.encode("houseweave-server"), shared, enc.encode("http"), 32));
      }
      case "mesh_group_seal": {
        // data only the network's members read back (EspNowMeshBerryGroupSeal): AES-128-CCM under the key HKDF-SHA256 gives for the group key
        // (salt "mesh group data", info the label), a random nonce of 12 bytes, the label as associated data, a tag of 16
        const [label, dataHex] = JSON.parse(arg ?? "[]") as [string, string];
        const data = fromHex(dataHex ?? "");
        if (!this.record.hasGroup || data.length > 8192) return null;
        const enc = new TextEncoder();
        const key = air.core.hkdf(enc.encode("mesh group data"), this.record.groupKey, enc.encode(label), 16);
        const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
        const sealed = air.core.ccmSeal(key, nonce, enc.encode(label), data, 16);
        if (!sealed) return null;
        return JSON.stringify([this.record.groupVersion, hexBytes([...nonce, ...sealed.data, ...sealed.tag])]);
      }
      case "mesh_group_open": {
        // the group key of that version, the one in use or the previous one while the record holds it (EspNowMeshBerryGroupOpen)
        const [label, version, sealedHex] = JSON.parse(arg ?? "[]") as [string, number, string];
        const sealed = fromHex(sealedHex ?? "");
        const r = this.record;
        const group = r.hasGroup && version === r.groupVersion ? r.groupKey : r.hasPrev && version === r.prevVersion ? r.prevKey : null;
        if (!group || sealed.length < 28 || sealed.length > 12 + 8192 + 16) return null;
        const enc = new TextEncoder();
        const key = air.core.hkdf(enc.encode("mesh group data"), group, enc.encode(label), 16);
        const plain = air.core.ccmOpen(key, sealed.subarray(0, 12), enc.encode(label), sealed.subarray(12, sealed.length - 16), sealed.subarray(sealed.length - 16));
        return plain ? hexBytes(plain) : null;
      }
      case "mesh_neighbors": {
        if (!this.running || !this.snapshot) return null;
        const now = this.millis();
        return JSON.stringify(this.snapshot.neighbors.map((x) => ({
          id: x.id, state: x.state, rssi: x.rssi, age: wrap32(now - x.heardAt), beat: x.beatAt ? wrap32(now - x.beatAt) : -1, info: toHex(x.info), seen: x.clockSeen, skew: x.clockSkew,
          key: x.keyVersion, keybits: x.keyBits, hears: x.hears,
        })));
      }
    }
    return null;
  }

  // --- the commands (Tasmota's console and MQTT, the web) ---------------------------------------------------------------------------------

  /** a command of the driver, as the firmware answers it: its response, or null when it is none of its commands */
  command(name: string, data: string): string | null {
    const cmd = COMMANDS[name.toLowerCase()];
    if (!cmd) return null;
    const text = (s: string) => `{"${cmd}":${JSON.stringify(s)}}`;
    const number = (n: number) => `{"${cmd}":${n}}`;
    const r = this.record;
    const atoi = (s: string) => parseInt(s, 10) || 0;
    switch (cmd) {
      case "EspNowMeshEnable": {
        if (data !== "") {
          r.enabled = atoi(data) !== 0 ? 1 : 0;
          this.commit();
          if (r.enabled) {
            if (!this.start()) return text(this.whyNot() ?? "did not start");
          } else {
            this.stop();
          }
        }
        return `{"${cmd}":{"Enabled":${r.enabled},"Running":${this.running ? 1 : 0}}}`;
      }
      case "EspNowMeshId": {
        if (data !== "") {
          const id = atoi(data);
          if (id < 1 || id > 254) return text("Error");
          r.id = id;
          // a device is not one of its own nodes: a row of the list that has the number it now has is not another device's
          r.node.forEach((n, i) => { if (n.id === id) r.node[i] = { id: 0, mac: Array(6).fill(0), pub: Array(32).fill(0), ip: Array(4).fill(0) }; });
          this.commit();
          if (this.net.drivers.get(id) !== this) this.net.drivers.set(id, this);
        }
        return number(r.id);
      }
      case "EspNowMeshStation": {
        // the station of xdrv_98_3 at rest: the mesh's channel, and the access point's the radio is on
        const s = this.device.radio.state();
        const ap = s.associated ? s.channel : 0;
        return `{"${cmd}":{"State":"Watch","Down":0,"Next":0,"Channel":${r.channel},"Ap":${ap},"Probes":0,"Seen":0,"Wides":0,"Found":0,"Parks":0,"Reason":0,"OffChannel":0,"OffBssid":"","Offs":0}}`;
      }
      case "EspNowMeshChannel": {
        if (data !== "") {
          const channel = atoi(data);
          if (channel > 13 || channel < 0) return text("Error");
          r.channel = channel;
          this.commit();
        }
        return number(r.channel);
      }
      case "EspNowMeshGroupKey": {
        if (data !== "") {
          const parts = data.split(",");
          const key = parts[0];
          const version = parts.length > 1 ? atoi(parts[1]) : 1;
          const revoke = parts.length > 2 && atoi(parts[2]) === 1;
          if (version < 1 || version > 255 || !/^[0-9a-fA-F]{64}$/.test(key)) return text("Error");
          const bytes = fromHex(key);
          // a key that is not the one the device has is a change of the network's key: the one it has becomes the previous key. The same key, with another version, only renames it
          const change = r.hasGroup === 1 && !bytes.every((b, i) => b === r.groupKey[i]);
          if (change && version === r.groupVersion) return text("the version must change with the key");
          if (change && r.hasPrev && !revoke) return text("the last change is not closed");
          if (change) {
            r.prevKey = Uint8Array.from(r.groupKey);
            r.prevVersion = r.groupVersion;
            r.prevHours = 0;
            r.hasPrev = 1;
            this.prevSeconds = 0;
          }
          r.groupKey = bytes;
          r.groupVersion = version;
          r.hasGroup = 1;
          this.commit();
          this.applyKeys(change);
        }
        return `{"${cmd}":{"Set":${r.hasGroup},"Version":${r.groupVersion},"Previous":${r.hasPrev ? r.prevVersion : 0}}}`;
      }
      case "EspNowMeshKeyClose": {
        const was = r.hasPrev !== 0;
        this.closeKey();
        return `{"${cmd}":{"Closed":${was ? 1 : 0}}}`;
      }
      case "EspNowMeshLeave": {
        // the device leaves the network it was in, as the firmware's does: the number, both keys, the nodes, the identity and the epoch go and
        // the mesh stops, as on a new device
        if (atoi(data) !== 1) return text("1 to leave");
        this.stop();
        if (r.id && this.net.drivers.get(r.id) === this) this.net.drivers.delete(r.id);
        r.enabled = 0;
        r.id = 0;
        r.groupKey = new Uint8Array(32);
        r.hasGroup = 0;
        r.groupVersion = 0;
        r.prevKey = new Uint8Array(32);
        r.hasPrev = 0;
        r.prevVersion = 0;
        r.prevHours = 0;
        this.prevSeconds = 0;
        r.node = r.node.map(() => ({ id: 0, mac: Array(6).fill(0), pub: Array(32).fill(0), ip: Array(4).fill(0) }));
        r.secret = new Uint8Array(32);
        r.hasSecret = 0;
        r.epoch = 0;
        this.commit();
        return text("Done");
      }
      case "EspNowMeshNode": {
        if (data === "") {
          const list = r.node.filter((n) => n.id).map((n) => `{"Id":${n.id},"Mac":"${macText(n.mac)}","Ip":"${n.ip.join(".")}"}`);
          return `{"${cmd}":[${list.join(",")}]}`;
        }
        const f = data.split(",");
        const fields = f.length > 4 ? [f[0], f[1], f[2], f.slice(3).join(",")] : f;
        const id = atoi(fields[0]);
        if (id < 1 || id > 254) return text("Error");
        let slot = r.node.findIndex((n) => n.id === id);
        const free = r.node.findIndex((n) => n.id === 0);
        if (fields.length === 2 && fields[1] === "0") {
          if (slot >= 0) {
            r.node[slot] = { id: 0, mac: Array(6).fill(0), pub: Array(32).fill(0), ip: Array(4).fill(0) };
            // the task takes the list, and the core forgets the node (EspNowMeshApplyShared)
            if (this.running && this.node) this.net.air.forget(this.node.id, id);
          }
        } else {
          if (fields.length < 3) return text("Error");
          if (slot < 0) slot = free;
          if (slot < 0) return text("no room");
          const mac = /^([0-9a-fA-F]{1,2}:){5}[0-9a-fA-F]{1,2}$/.test(fields[1]) ? fields[1].split(":").map((x) => parseInt(x, 16)) : null;
          if (!mac || !/^[0-9a-fA-F]{64}$/.test(fields[2])) return text("Error");
          let ip = [0, 0, 0, 0];
          if (fields.length === 4 && fields[3] !== "") {
            const parts = fields[3].split(".").map(Number);
            if (parts.length !== 4 || parts.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return text("Error");
            ip = parts;
          }
          r.node[slot] = { id, mac, pub: Array.from(fromHex(fields[2])), ip };
        }
        this.commit();
        return text("Done");
      }
      case "EspNowMeshPublic": {
        if (!r.hasSecret) {
          // the identity is made here the first time it is asked for, and the hardware's random numbers are strong only with the radio on
          if (!this.radioReady()) return text("WiFi is not up");
          this.makeIdentity();
          this.commit();
        }
        return `{"${cmd}":{"Id":${r.id},"Mac":"${macText(this.stationMac())}","Public":"${toHex(this.publicKey())}"}}`;
      }
      case "EspNowMeshNetwork": {
        if (data !== "") {
          r.network = atoi(data) & 7;
          this.commit();
        }
        return number(r.network);
      }
      case "EspNowMeshInfo": {
        let bytes = new Uint8Array(0);
        if (data !== "") {
          if (!/^([0-9a-fA-F]{2})*$/.test(data) || data.length / 2 > MAX_INFO) return text("Error");
          bytes = fromHex(data);
        }
        return text(this.queuedText(this.queueCommand({ op: "info", type: 0, dest: 0, ack: false, data: bytes }).result));
      }
      case "EspNowMeshSend": return this.sendCommand(cmd, data);
      case "EspNowMeshReady": {
        if (data !== "") this.setReady(atoi(data) !== 0);
        return `{"${cmd}":{"Ready":${this.appReady ? 1 : 0}}}`;
      }
      case "EspNowMeshStatus": return this.statusCommand(cmd);
      case "EspNowMeshStats": return this.statsCommand(cmd, data);
      case "EspNowMeshNeighbors": return this.neighborsCommand(cmd, data);
      case "EspNowMeshHealth": return this.healthCommand(cmd, data);
      case "EspNowMeshClock": return this.clockCommand(cmd, data);
    }
    return null;
  }

  private queuedText(result: number): string {
    return result === 1 ? "queued" : result === -1 ? "busy" : "not running";
  }

  /** CmndEspNowMeshSend: <dest>,<type>,<flags>,<text or 0xHEX>; flags 1 asks for an answer, 2 makes the tag with the previous key */
  private sendCommand(cmd: string, data: string): string {
    const text = (s: string) => `{"${cmd}":${JSON.stringify(s)}}`;
    const f: string[] = [];
    let rest = data;
    for (let i = 0; i < 3; i++) {
      const c = rest.indexOf(",");
      if (c < 0) break;
      f.push(rest.slice(0, c));
      rest = rest.slice(c + 1);
    }
    if (f.length !== 3) return text("dest,type,flags,payload");
    f.push(rest);
    const [dest, type, ack] = f.slice(0, 3).map((x) => parseInt(x, 10) || 0);
    if (dest < 0 || dest > 255 || type < 0 || type > 7 || ack < 0 || ack > 3) return text("dest 0..255, type 0..7, flags 0..3");
    if (type === 4) return text("the heartbeat is the mesh's");
    let bytes: Uint8Array;
    if (/^0[xX]/.test(f[3])) {
      const hex = f[3].slice(2);
      if (!/^([0-9a-fA-F]{2})*$/.test(hex) || hex.length / 2 > MESH.MAX_PAYLOAD) return text("Error");
      bytes = fromHex(hex);
    } else {
      bytes = new TextEncoder().encode(f[3]);
      if (bytes.length > MESH.MAX_PAYLOAD) return `{"${cmd}":"too long","Max":${this.maxPayload(dest)}}`;
    }
    if (bytes.length > this.maxPayload(dest)) return `{"${cmd}":"too long","Max":${this.maxPayload(dest)}}`;
    const q = this.queueCommand({ op: "send", type, dest, ack: (ack & 1) === 1, previous: (ack & 2) === 2, data: bytes });
    return q.result === 1 ? `{"${cmd}":{"Queued":1,"Counter":${q.ticket}}}` : text(this.queuedText(q.result));
  }

  private snapshotRead(): Snapshot | null {
    return this.running ? this.snapshot : null;
  }

  private statusCommand(cmd: string): string {
    const r = this.record;
    const snap = this.snapshotRead();
    const state = this.device.radio.state();
    const peers = Math.min(20, 1 + (snap?.neighbors.length ?? 0));
    let s = `{"${cmd}":{"Running":${this.running ? 1 : 0},"Id":${r.id},"Epoch":${r.epoch},"Mac":"${macText(this.stationMac())}","Channel":${state.channel},"Group":${r.hasGroup},"GroupVersion":${r.groupVersion},"PrevVersion":${r.hasPrev ? r.prevVersion : 0},"PrevHours":${r.prevHours},"Network":${r.network},"Radio":${this.running ? 1 : 0},"Ready":${this.appReady ? 1 : 0},"Dropped":${this.count.dropped},"Peers":${peers},"Heap":${this.device.heapFreeKb * 1024}`;
    if (!this.running) {
      const why = this.whyNot();
      if (why) s += `,"Why":"${why}"`;
    }
    if (snap) {
      const c = snap.stats;
      s += `,"NeedsKey":${snap.needsKey},"PrevKeyHeard":${c.prevKeyHeard},"PrevKeyDropped":${c.prevKeyDropped}`;
      s += `,"Neighbors":${snap.neighbors.length},"Queued":${snap.queued},"Waiting":${snap.waiting},"Noisy":${snap.noisy},"Loss":${snap.loss},"NetUp":${snap.netUp ? 1 : 0},"Stack":${snap.stackFree},"Silent":${snap.silent.length},`
        + `"Heard":${c.heard},"Bad":${c.bad},"Repeated":${c.repeated},"Replayed":${c.replayed},"Stale":${c.stale},"Unsynced":${c.unsynced},"Covered":${c.covered},"Delivered":${c.delivered},"InboxFull":${c.inboxFull},`
        + `"SentOwn":${c.sentOwn},"SentRelay":${c.sentRelay},"Suppressed":${c.suppressed},"QueueFull":${c.queueFull},"NoRoute":${c.noRoute},"NoKey":${c.noKey},`
        + `"AcksSent":${c.acksSent},"AcksHeard":${c.acksHeard},"Resent":${c.resent},"GaveUp":${c.gaveUp},"HopFailed":${c.hopFailed},"SyncDone":${c.syncDone},"SyncShed":${c.syncShed},"Beats":${c.beatsHeard},"Rescued":${c.rescued},"CipherBad":${c.cipherBad},"UdpSent":${c.udpSent},"UdpHeard":${c.udpHeard}`;
    }
    return s + "}}";
  }

  private statsCommand(cmd: string, data: string): string {
    const page = data !== "" ? parseInt(data, 10) || 0 : 0;
    if (page > 1) return `{"${cmd}":"page 0 or 1"}`;
    const snap = this.snapshotRead();
    let s = `{"${cmd}":{"Page":${page},"Running":${this.running ? 1 : 0}`;
    if (snap) {
      const c = snap.stats;
      if (page === 0) {
        s += `,"Heard":${c.heard},"Bad":${c.bad},"Repeated":${c.repeated},"Replayed":${c.replayed},"Stale":${c.stale},"Unsynced":${c.unsynced},"Covered":${c.covered},"Delivered":${c.delivered},"InboxFull":${c.inboxFull},`
          + `"SentOwn":${c.sentOwn},"SentRelay":${c.sentRelay},"Suppressed":${c.suppressed},"QueueFull":${c.queueFull},"NoRoute":${c.noRoute},"NoKey":${c.noKey},"CipherBad":${c.cipherBad},`
          + `"AcksSent":${c.acksSent},"AcksHeard":${c.acksHeard},"Resent":${c.resent},"GaveUp":${c.gaveUp},"HopFailed":${c.hopFailed}`;
      } else {
        s += `,"SyncAsked":${c.syncAsked},"SyncDone":${c.syncDone},"SyncBad":${c.syncBad},"SyncShed":${c.syncShed},"StartAsks":${c.startAsks},`
          + `"BeatsSent":${c.beatsSent},"BeatsHeard":${c.beatsHeard},"Pings":${c.pings},"Probes":${c.probes},"Rescued":${c.rescued},"VerdictsSent":${c.verdictsSent},"VerdictsHeard":${c.verdictsHeard},"NoiseSent":${c.noiseSent},"KeptAsOnlyWay":${c.keptAsOnlyWay},"RelayHeld":${c.relayHeld},"CounterOut":${c.counterOut},`
          + `"PartsSent":${c.partsSent},"PiecesSent":${c.piecesSent},"PiecesNew":${c.piecesNew},"PiecesRepeated":${c.piecesRepeated},"NaksSent":${c.naksSent},"BulkDone":${c.bulkDone},"BulkLost":${c.bulkLost},`
          + `"UdpSent":${c.udpSent},"UdpHeard":${c.udpHeard}`;
      }
    }
    if (page === 0) {
      const n = this.count;
      s += `,"Dropped":${n.dropped},"CmdBusy":${n.cmdBusy},"EvtFull":${n.evtFull},"NoteLost":${n.noteLost},"Refused":${n.refused},`
        + `"SendFailed":${n.sendFailed},"BcastFailed":${n.bcastFailed},"NotAcked":${n.notAcked},"WaitExpired":${n.waitExpired},"LateWord":${n.lateWord},`
        + `"PeerFailed":${n.peerFailed},"PeerFull":${n.peerFull},"PeerEvicted":${n.peerEvicted}`;
    }
    return s + "}}";
  }

  private neighborsCommand(cmd: string, data: string): string {
    const snap = this.snapshotRead();
    if (!snap) return `{"${cmd}":"not running"}`;
    const first = (data !== "" ? parseInt(data, 10) || 0 : 0) >>> 0;
    const names = ["alive", "suspect", "silent"];
    const entries = snap.neighbors.map((n) =>
      `{"Id":${n.id},"State":"${names[n.state] ?? "silent"}","Rssi":${n.rssi},"TheirRssi":${n.theirRssi},"Lists":${n.listsMe},"NoRadio":${n.noRadio},"Age":${n.ageS},"Beat":${n.beatS === 0xffff ? -1 : n.beatS},"Hears":${n.hears},"Key":${n.keyVersion},"KeyBits":${n.keyBits},"Fwd":${n.fwd},"Info":"${toHex(n.info)}"}`);
    return pageList(`{"${cmd}":{"Count":${snap.neighbors.length},"From":${first},"List":[`, entries, first, "}}");
  }

  private healthCommand(cmd: string, data: string): string {
    const snap = this.snapshotRead();
    if (!snap) return `{"${cmd}":"not running"}`;
    const h = snap.health;
    const first = (data !== "" ? parseInt(data, 10) || 0 : 0) >>> 0;
    const entries = h.links.map((l) =>
      `{"Id":${l.id},"Quality":${l.quality === 255 ? -1 : l.quality},"Usable":${l.usable ? 1 : 0},"Reach":${l.reach},"Only":${l.only},"Branch":${l.branch},"Chosen":${l.chosen ? 1 : 0}}`);
    return pageList(`{"${cmd}":{"Neighbors":${h.neighbors},"Weak":${h.weak},"TwoHop":${h.twoHop},"Branches":${h.branches},"Cut":${h.branches > 1 ? 1 : 0},"SoleWays":${h.soleWays},"Alone":${h.neighbors === 1 ? 1 : 0},"Relays":${h.relays},"Count":${h.links.length},"From":${first},"List":[`, entries, first, "}}");
  }

  private clockCommand(cmd: string, data: string): string {
    if (!this.running || !this.node || !this.clockValid) return `{"${cmd}":"not running"}`;
    const air = this.net.air;
    const c = air.core.clock(this.node.slot, this.millis());
    let s = `{"${cmd}":{"Clock":1,"Synced":${c.synced ? 1 : 0},"Adopted":${c.adopted ? 1 : 0},"Timeline":"${hexBytes(c.timeline)}","Tag":${c.tag},"Mesh":${c.mesh},"Ticks10":${Math.floor(c.mesh / 10) >>> 0},"Taken":${air.core.stat(this.node.slot, "timelinesTaken")}`;
    const snap = this.snapshot;
    if (snap) {
      const first = (data !== "" ? parseInt(data, 10) || 0 : 0) >>> 0;
      const entries = snap.neighbors.map((n) => {
        const carries = n.info.length >= 20 && n.info[0] === 1;
        return `{"Id":${n.id},"Seen":${n.clockSeen},"Sync":${carries ? n.info[19] & 1 : 0},"Skew":${n.clockSkew},"Timeline":"${carries ? hexBytes(n.info.slice(1, 6)) : ""}"}`;
      });
      return pageList(`${s},"Steps":${snap.stats.clockSteps},"EventsLost":${snap.stats.clockEventsLost},"Count":${snap.neighbors.length},"From":${first},"List":[`, entries, first, "}}");
    }
    return s + "}}";
  }
}
