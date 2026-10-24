// The ESP-NOW mesh core of the firmware (espnow_mesh_core.h), compiled from its own source
// (native/mesh_sim.cpp), and the air between the nodes that run it.
//
// A MeshCore is the module: every node is one slot of it, with the frames, the replay
// windows, the copies it has heard and the queue of what it will send, as in the firmware's
// radio task. A MeshAir is the house: nodes with the signal each hears of each other, one
// transmission at a time from a node, a frame in the air for as long as its length takes, a
// receiver that is itself sending hearing nothing, two frames that overlap at a receiver
// lost to it unless one is much the stronger, and a fraction of receptions lost at random.
// Time is the air's: `run(ms)` steps it, a hundred microseconds at a time, and asks each
// node what it has ready, as the radio task does.
import createMeshModule, { type MeshModule } from "../wasm/mesh.mjs";

export const MESH = { VERSION: 0x41, HEADER: 14, TAG: 8, MAX_FRAME: 250, MAX_PAYLOAD: 228, TO_ALL: 255, MAX_HOPS: 5, MAX_ORIGINS: 48, MAX_NEIGHBORS: 48 } as const;

/** The types of frame, as the core numbers them */
export const MeshType = { Command: 0, Ack: 1, State: 2, Event: 3, Beat: 4, Bulk: 5, Membership: 6, Sync: 7 } as const;

export const VERDICTS = ["accepted", "retry", "repeated", "replayed", "stale", "needsSync", "ignored", "bad", "full", "covered"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const STATS = ["heard", "bad", "repeated", "replayed", "stale", "unsynced", "delivered", "inboxFull",
  "sentOwn", "sentRelay", "suppressed", "queueFull",
  "acksSent", "acksHeard", "resent", "gaveUp", "noRoute", "hopFailed", "syncAsked", "syncDone", "syncBad",
  "beatsSent", "beatsHeard", "pings", "probes", "rescued", "verdictsSent", "verdictsHeard", "noiseSent", "keptAsOnlyWay",
  "partsSent", "piecesSent", "piecesNew", "piecesRepeated", "naksSent", "bulkDone", "bulkLost", "noKey", "cipherBad", "udpSent", "udpHeard", "covered", "syncShed", "startAsks",
  "relayHeld", "counterOut", "epochRenewed", "clockSteps", "timelinesTaken", "clockEventsLost", "prevKeyHeard", "prevKeyDropped", "routed", "routeFlooded"] as const;
export type StatName = (typeof STATS)[number];

export interface MeshFields {
  kind: number;
  origin: number;
  dest: number;
  next: number;
  hops: number;
  epoch: number;
  counter: number;
  len: number;
}

/** what became of a frame that asked for an answer */
export interface MeshOutcome {
  counter: number;
  dest: number;
  ok: boolean;
  attempts: number;
}

export interface MeshDelivery {
  origin: number;
  type: number;
  ackRequested: boolean;
  retry: boolean;
  /** the frame came under the tag of the key the network had before its last change: its sender has not taken the change */
  previousKey: boolean;
  part: number;
  attempt: number;
  dest: number;
  /** of a second part, the number of the first */
  joins: number;
  /** how many numbers of its origin the frame was behind the newest heard: 0 for the newest */
  behind: number;
  rssi: number;
  epoch: number;
  counter: number;
  from: number[];
  payload: Uint8Array;
}

/** the supervision's frames are all of the heartbeat type: the first byte of the payload says which */
export const MeshSub = { Beat: 0, Probe: 1, Ping: 2, Alive: 3, Verdict: 4, Noise: 5 } as const;

/** the frames of a bulk transfer: the first byte of the payload of a frame of the bulk type */
export const BulkSub = { Piece: 0, Nak: 1, Done: 2 } as const;

/** the data in a piece of a bulk transfer, and the pieces in one */
export const BULK = { PIECE: 200, MAX_PIECES: 32 } as const;

/** how a neighbour stands */
export const LIVENESS = ["alive", "suspect", "mute"] as const;
export type Liveness = (typeof LIVENESS)[number];

/** a node heard directly, and what its last heartbeat said */
export interface MeshNeighbor {
  id: number;
  state: Liveness;
  /** 0 not known, 1 it lists this node among the ones it hears, 2 it does not */
  listsMe: number;
  rssi: number;
  theirRssi: number;
  mac: number[];
  lastHeard: number;
  beatAt: number;
  hears: number[];
  info: Uint8Array;
  /** the percent of its heartbeats that came on the radio in the last intervals; 255 while too few have been judged */
  quality: number;
  /** 0 not known, 1 its heartbeat names this node among the neighbours it has chosen to repeat for it, 2 it does not */
  selectsMe: number;
  /** the node counts on it as a way */
  usable: boolean;
  /** its mesh time in its last heartbeat less this node's when the heartbeat came, ms, within 16 bits; 0 before the first */
  clockSkew: number;
  /** 0 its heartbeat carried no clock, 1 it did and it is in another timeline than this node's, 2 the same one */
  clockSeen: number;
  /** its heartbeat says it has no radio in use: it hears and says everything by the network */
  noRadio: boolean;
  /** the version of the network's key its heartbeat says it sends with; 0 when it does not say */
  keyVersion: number;
  /** 1 it holds the previous key, 2 it needs the key, 4 its last heartbeat came under the previous key's tag */
  keyBits: number;
  /** the percent of this node's last unicast frames to it that were acknowledged; 255 while too few, or none lately */
  sendQuality: number;
}

/** a key of the network as 32 bytes: the bytes given, or the key a number stands for (0 is the key every node of the real cipher starts with, any other another key) */
export function keyBytes(key: number | ArrayLike<number>): Uint8Array {
  if (typeof key === "number") return Uint8Array.from({ length: 32 }, (_, i) => (0xa0 + i * 3 + key * 7) & 255);
  if (key.length !== 32) throw new Error("the key of the network is 32 bytes");
  return Uint8Array.from(key);
}

/** what a node holds and says of the keys of the network */
export interface MeshKeyState {
  /** the version of the key it sends with, as it says it */
  version: number;
  holdsPrevious: boolean;
  /** a change was taken less than the time for it to reach the others ago */
  converging: boolean;
  needsKey: boolean;
  /** the version of the previous key it holds; 0 for none */
  previousVersion: number;
}

/** the node's clock at a time of its own counter */
export interface MeshClock {
  synced: boolean;
  /** the node has taken a timeline since it started */
  adopted: boolean;
  /** the timeline: the node that started it (1 byte) and its epoch (4 bytes, most significant first) */
  timeline: Uint8Array;
  /** the mesh time, ms: what the node has counted since it started and been moved by */
  mesh: number;
  /** counts every change of the time, of the timeline and of the synced bit */
  version: number;
  /** the 16 bits of a tag of the timeline, which a stamp carries */
  tag: number;
}

/** what the clock tells the application */
export const ClockEventKind = { Timeline: 1, Synced: 2 } as const;
export interface MeshClockEvent {
  kind: number;
  synced: boolean;
  /** of a timeline taken: the one the node was in */
  from: Uint8Array;
  /** and the one it is in now */
  to: Uint8Array;
  /** by how many ticks of 100 ms its time moved, rounded: the low 32 bits of it, as a signed number */
  ticks: number;
  /** and by how many milliseconds */
  delta: number;
}

/** what a node can say of its neighbourhood from its neighbours' heartbeats, two hops deep */
export interface MeshHealthLink {
  id: number;
  quality: number;
  usable: boolean;
  /** the nodes at two hops it lists */
  reach: number;
  /** of them, the ones no other neighbour lists */
  only: number;
  /** the group it falls in, from 1 */
  branch: number;
  /** the node has chosen it to repeat for it */
  chosen: boolean;
}
export interface MeshHealth {
  neighbors: number;
  weak: number;
  twoHop: number;
  branches: number;
  relays: number;
  soleWays: number;
  links: MeshHealthLink[];
}

/** what a neighbour is worth to a node as a peer of a full radio table, as the core numbers it */
export const PeerRole = { Gone: 0, Weak: 1, Redundant: 2, OnlyWay: 3 } as const;

/** what the supervision tells the application */
export const NoticeKind = { Silent: 1, Back: 2, Noisy: 3, Calm: 4, BulkDone: 5, BulkLost: 6 } as const;
export interface MeshNotice {
  node: number;
  kind: number;
  by: number;
  /** of a bulk transfer, its id */
  value: number;
}

/** type(3) | ack(1) | part(2) | attempt(2), the byte `kind` of a frame */
export const packKind = (type: number, ack = false, part = 0, attempt = 0): number =>
  ((type & 7) << 5) | (ack ? 0x10 : 0) | ((part & 3) << 2) | (attempt & 3);

const OPTIONS = { epoch: 1, seed: 0, tagged: true, weakDbm: -70, suppressAt: 2, beatMs: 0, noiseLimit: 0, cipher: false as boolean | "real", udpOnly: false, udpRelay: false, startSync: false, startSlotMs: 0, startJitterMs: 0, answersPerSecond: 0, chooseRelays: false, relayBackupMs: 0, relayDropAt: 0, relayMinNeighbors: 0, declineEpoch: false, clock: false, keys: false, routeUnicast: false };

export class MeshCore {
  private readonly mod: MeshModule;
  private readonly inPtr: number;
  private readonly outPtr: number;
  private readonly srcPtr: number;
  private readonly toPtr: number;
  private readonly metaPtr: number;

  private constructor(mod: MeshModule) {
    this.mod = mod;
    this.inPtr = mod._malloc(512);
    this.outPtr = mod._malloc(512);
    this.srcPtr = mod._malloc(16);
    this.toPtr = mod._malloc(16);
    this.metaPtr = mod._malloc(16);
  }

  /** the core as the module builds it; `create` is the factory of another build of the same source (a variant with another constant: scripts/build-mesh-wasm.mjs, MESH_VARIANT_OUT) */
  static async load(create: () => Promise<MeshModule> = createMeshModule): Promise<MeshCore> {
    return new MeshCore(await create());
  }

  private put(ptr: number, bytes: ArrayLike<number>) {
    this.mod.HEAPU8.set(bytes, ptr);
  }

  private get(ptr: number, n: number): Uint8Array {
    return this.mod.HEAPU8.slice(ptr, ptr + n);
  }

  encode(f: Omit<MeshFields, "len"> & { payload?: ArrayLike<number> }, sealed = false): Uint8Array | null {
    const payload = f.payload ?? [];
    this.put(this.inPtr, payload);
    const n = this.mod._mesh_encode(f.kind, f.origin, f.dest, f.next, f.hops, f.epoch, f.counter, this.inPtr, payload.length, sealed ? 1 : 0, this.outPtr);
    return n > 0 ? this.get(this.outPtr, n) : null;
  }

  decode(bytes: ArrayLike<number>): MeshFields | null {
    this.put(this.inPtr, bytes);
    if (this.mod._mesh_decode(this.inPtr, bytes.length, this.outPtr) < 0) return null;
    const b = this.get(this.outPtr, 14);
    const dv = new DataView(b.buffer, b.byteOffset, 14);
    return { kind: b[0], origin: b[1], dest: b[2], next: b[3], hops: b[4], epoch: dv.getUint32(5, true), counter: dv.getUint32(9, true), len: b[13] };
  }

  tagMatches(bytes: ArrayLike<number>): boolean {
    this.put(this.inPtr, bytes);
    return this.mod._mesh_tag_matches(this.inPtr, bytes.length) === 1;
  }

  begin(slot: number, id: number, o: Partial<typeof OPTIONS> = {}) {
    const x = { ...OPTIONS, ...o };
    this.mod._mesh_begin(slot, id, x.epoch, x.seed, x.tagged ? 1 : 0, x.weakDbm, x.suppressAt, x.beatMs, x.noiseLimit, x.cipher === "real" ? 2 : x.cipher ? 1 : 0, x.udpOnly ? 1 : 0, x.udpRelay ? 1 : 0, x.startSync ? 1 : 0, x.startSlotMs, x.startJitterMs, x.answersPerSecond, x.chooseRelays ? 1 : 0, x.relayBackupMs, x.relayDropAt, x.relayMinNeighbors, x.declineEpoch ? 1 : 0, x.clock ? 1 : 0, x.keys ? 1 : 0, x.routeUnicast ? 1 : 0);
  }

  /** with `previous`, the frame's tag is made with the key the network had before its last change, for the node that has not taken it */
  send(slot: number, type: number, dest: number, payload: ArrayLike<number>, ack: boolean, nowMs: number, previous = false): number {
    this.put(this.inPtr, payload);
    return this.mod._mesh_send(slot, type, dest, this.inPtr, payload.length, ack ? 1 : 0, nowMs, previous ? 1 : 0) >>> 0;
  }

  /** the keys of a node with the real cipher as a start gives them: the key in use and the previous one (a version of 0 for none), each as bytes or as the number a test makes them of */
  keySet(slot: number, key: number | ArrayLike<number>, version: number, previousKey: number | ArrayLike<number> = 0, previousVersion = 0) {
    this.put(this.inPtr, keyBytes(key));
    this.put(this.inPtr + 32, keyBytes(previousKey));
    this.mod._mesh_key_set(slot, this.inPtr, version, this.inPtr + 32, previousVersion);
  }

  /** the network's key changes at the node: the one it had is the previous, and the change has its time to reach the others from `nowMs` */
  keyChange(slot: number, key: number | ArrayLike<number>, version: number, nowMs: number) {
    this.put(this.inPtr, keyBytes(key));
    this.mod._mesh_key_change(slot, this.inPtr, version, nowMs);
  }

  /** the change is closed at the node: the previous key is let go */
  keyClose(slot: number, nowMs: number) {
    this.mod._mesh_key_close(slot, nowMs);
  }

  keyState(slot: number, nowMs: number): MeshKeyState {
    this.mod._mesh_key_state(slot, nowMs, this.outPtr);
    const b = this.get(this.outPtr, 6);
    return { version: b[0], holdsPrevious: b[1] === 1, converging: b[2] === 1, needsKey: b[3] === 1, previousVersion: b[4] };
  }

  /** a message longer than a frame, in two parts: the counters of the two, or null when it did not go */
  sendParts(slot: number, type: number, dest: number, payload: ArrayLike<number>, ack: boolean, nowMs: number): [number, number] | null {
    this.put(this.inPtr, payload);
    const ok = this.mod._mesh_send_parts(slot, type, dest, this.inPtr, payload.length, ack ? 1 : 0, nowMs, this.srcPtr);
    const b = this.get(this.srcPtr, 8);
    const dv = new DataView(b.buffer, b.byteOffset, 8);
    return ok === 1 ? [dv.getUint32(0, true), dv.getUint32(4, true)] : null;
  }

  /** one piece of a bulk transfer, along the way back to `dest` when there is one; the counter, or 0 */
  sendBulkPiece(slot: number, dest: number, id: number, index: number, total: number, data: ArrayLike<number>, nowMs: number): number {
    this.put(this.inPtr, data);
    return this.mod._mesh_send_bulk_piece(slot, dest, id, index, total, this.inPtr, data.length, nowMs) >>> 0;
  }

  /** along the way back to `dest`, or 0 when the node has none */
  sendRouted(slot: number, type: number, dest: number, payload: ArrayLike<number>, nowMs: number): number {
    this.put(this.inPtr, payload);
    return this.mod._mesh_send_routed(slot, type, dest, this.inPtr, payload.length, nowMs) >>> 0;
  }

  /** a frame heard: on the radio, or, with ${BT}udp${BT}, by the network, from the node whose radio address is ${BT}src${BT} */
  receive(slot: number, bytes: ArrayLike<number>, src: ArrayLike<number>, rssi: number, nowMs: number, udp = false): Verdict {
    this.put(this.inPtr, bytes);
    this.put(this.srcPtr, src);
    return VERDICTS[this.mod._mesh_receive(slot, this.inPtr, bytes.length, this.srcPtr, rssi, nowMs, udp ? 1 : 0)];
  }

  /** the network is up for the node, or it is not */
  setUdp(slot: number, up: boolean) {
    this.mod._mesh_set_udp(slot, up ? 1 : 0);
  }

  /** the next frame to send and the address it goes to (all ones for a flooded one) */
  nextTx(slot: number, nowMs: number): { bytes: Uint8Array; to: number[]; paths: number; target: number } | null {
    const n = this.mod._mesh_next_tx(slot, nowMs, this.outPtr, this.toPtr, this.metaPtr);
    if (n <= 0) return null;
    const meta = this.get(this.metaPtr, 2);
    return { bytes: this.get(this.outPtr, n), to: Array.from(this.get(this.toPtr, 6)), paths: meta[0], target: meta[1] };
  }

  /** what became of the frame: a unicast that was not acknowledged is handed over again */
  txDone(slot: number, ok: boolean, nowMs: number) {
    this.mod._mesh_tx_done(slot, ok ? 1 : 0, nowMs);
  }

  tick(slot: number, nowMs: number) {
    this.mod._mesh_tick(slot, nowMs);
  }

  /** when something is ready to send, in ms, or null */
  nextDue(slot: number): number | null {
    const d = this.mod._mesh_next_due(slot);
    return d < 0 ? null : d;
  }

  pop(slot: number): MeshDelivery | null {
    const n = this.mod._mesh_pop(slot, this.outPtr);
    if (n === 0) return null;
    const b = this.get(this.outPtr, n);
    const dv = new DataView(b.buffer, b.byteOffset, n);
    return {
      origin: b[0], type: b[1], ackRequested: (b[2] & 1) !== 0, retry: (b[2] & 2) !== 0, previousKey: (b[2] & 4) !== 0, part: b[3], attempt: b[4], dest: b[5],
      rssi: (b[7] << 24) >> 24, joins: dv.getUint32(22, true), behind: b[26], epoch: dv.getUint32(8, true), counter: dv.getUint32(12, true), from: Array.from(b.slice(16, 22)), payload: b.slice(27, 27 + b[6]),
    };
  }

  popOutcome(slot: number): MeshOutcome | null {
    if (this.mod._mesh_pop_outcome(slot, this.outPtr) === 0) return null;
    const b = this.get(this.outPtr, 7);
    return { counter: new DataView(b.buffer, b.byteOffset, 7).getUint32(0, true), dest: b[4], ok: b[5] === 1, attempts: b[6] };
  }

  requestSync(slot: number, target: number, nowMs: number): boolean {
    return this.mod._mesh_request_sync(slot, target, nowMs) === 1;
  }

  synced(slot: number, origin: number, epoch: number, counter: number) {
    this.mod._mesh_synced(slot, origin, epoch, counter);
  }

  wantsSync(slot: number): number {
    return this.mod._mesh_wants_sync(slot);
  }

  /** whether the node accepts the frames of `origin` */
  knows(slot: number, origin: number): boolean {
    return this.mod._mesh_knows(slot, origin) === 1;
  }

  stat(slot: number, name: StatName): number {
    return this.mod._mesh_stat(slot, STATS.indexOf(name)) >>> 0;
  }

  queued(slot: number): number {
    return this.mod._mesh_queued(slot);
  }

  /** the radio is sending a frame and has not said what became of it */
  busy(slot: number): boolean {
    return this.mod._mesh_busy(slot) === 1;
  }

  /** frames waiting for an answer */
  waiting(slot: number): number {
    return this.mod._mesh_waiting(slot);
  }

  /** the application's bytes every heartbeat of the node carries */
  setInfo(slot: number, info: ArrayLike<number>) {
    this.put(this.inPtr, info);
    this.mod._mesh_set_info(slot, this.inPtr, info.length);
  }

  /** whether the frames for the application are taken (the driver's ready gate): a node that is not ready refuses the ones for it alone as a full inbox does, with no answer, and repeats the ones for everyone without delivering them */
  setDeliver(slot: number, on: boolean) {
    this.mod._mesh_set_deliver(slot, on ? 1 : 0);
  }

  deliverEnabled(slot: number): boolean {
    return this.mod._mesh_deliver_enabled(slot) === 1;
  }

  /** the nodes heard directly, as the node's last heartbeats left them; `nowMs` is the time the delivery is judged at */
  neighbors(slot: number, nowMs = 0): MeshNeighbor[] {
    const out: MeshNeighbor[] = [];
    for (let i = 0; i < MESH.MAX_NEIGHBORS; i++) {
      const n = this.mod._mesh_neighbor(slot, i, this.outPtr, nowMs);
      if (n === 0) continue;
      const b = this.get(this.outPtr, n);
      const dv = new DataView(b.buffer, b.byteOffset, n);
      const hears = b[19];
      out.push({
        id: b[0], state: LIVENESS[b[1]], listsMe: b[2], rssi: (b[3] << 24) >> 24, theirRssi: (b[4] << 24) >> 24, mac: Array.from(b.slice(5, 11)),
        lastHeard: dv.getUint32(11, true), beatAt: dv.getUint32(15, true), hears: Array.from(b.slice(20, 20 + hears)), info: b.slice(21 + hears, 21 + hears + b[20 + hears]),
        quality: b[21 + hears + b[20 + hears]], selectsMe: b[22 + hears + b[20 + hears]], usable: b[23 + hears + b[20 + hears]] === 1,
        clockSkew: (((b[25 + hears + b[20 + hears]] << 8) | b[24 + hears + b[20 + hears]]) << 16) >> 16, clockSeen: b[26 + hears + b[20 + hears]],
        noRadio: b[27 + hears + b[20 + hears]] === 1, keyVersion: b[28 + hears + b[20 + hears]], keyBits: b[29 + hears + b[20 + hears]],
        sendQuality: b[30 + hears + b[20 + hears]],
      });
    }
    return out;
  }

  /** what the node can say of its surroundings at `nowMs`: its neighbours, the nodes at two hops, the groups the neighbours fall in, the ones that are its only way to some node */
  health(slot: number, nowMs: number): MeshHealth {
    const n = this.mod._mesh_health(slot, nowMs, this.outPtr);
    const b = this.get(this.outPtr, n);
    const links: MeshHealthLink[] = [];
    for (let i = 0; i < b[6]; i++) {
      const o = 7 + 7 * i;
      links.push({ id: b[o], quality: b[o + 1], usable: b[o + 2] === 1, reach: b[o + 3], only: b[o + 4], branch: b[o + 5], chosen: b[o + 6] === 1 });
    }
    return { neighbors: b[0], weak: b[1], twoHop: b[2], branches: b[3], relays: b[4], soleWays: b[5], links };
  }

  /** what the neighbour numbered `node` is worth to the node as a peer of a full radio table: a PeerRole */
  peerRole(slot: number, node: number, nowMs: number): number {
    return this.mod._mesh_peer_role(slot, node, nowMs);
  }

  popNotice(slot: number): MeshNotice | null {
    if (this.mod._mesh_pop_notice(slot, this.outPtr) === 0) return null;
    const b = this.get(this.outPtr, 7);
    return { node: b[0], kind: b[1], by: b[2], value: new DataView(b.buffer, b.byteOffset, 7).getUint32(3, true) };
  }

  /** whether the house has been told that `node` is silent */
  isSilent(slot: number, node: number): boolean {
    return this.mod._mesh_is_silent(slot, node) === 1;
  }

  /** whether the node has been calling its own channel noisy */
  noisy(slot: number): boolean {
    return this.mod._mesh_noisy(slot) === 1;
  }

  /** how much of what should have got through did not, in the last minute the node judged, in percent */
  lossPercent(slot: number): number {
    return this.mod._mesh_loss_percent(slot);
  }

  private scratch<T>(sizes: number[], run: (ptrs: number[]) => T): T {
    const ptrs = sizes.map((n) => this.mod._malloc(Math.max(1, n)));
    try {
      return run(ptrs);
    } finally {
      for (const p of ptrs) this.mod._free(p);
    }
  }

  /** the frame with its tag stamped as the node would stamp it: what a node that has the network's key can make */
  tagAs(slot: number, bytes: ArrayLike<number>): Uint8Array {
    this.put(this.inPtr, bytes);
    this.mod._mesh_tag_as(slot, this.inPtr, bytes.length);
    return this.get(this.inPtr, bytes.length);
  }

  /** the public key of a node begun with the real cipher */
  identity(slot: number): Uint8Array {
    this.mod._mesh_identity(slot, this.outPtr);
    return this.get(this.outPtr, 32);
  }

  /** gives a node the public key of another, whose pair keys it derives; false for a key it cannot use */
  setPeer(slot: number, node: number, pub: ArrayLike<number>): boolean {
    this.put(this.inPtr, pub);
    return this.mod._mesh_set_peer(slot, node, this.inPtr) === 1;
  }

  /** the node forgets another, taken out of its driver's list (Node::Forget): no neighbour, no verdict that it is silent */
  forget(slot: number, node: number) {
    this.mod._mesh_forget(slot, node);
  }

  /** X25519 (RFC 7748), as the firmware does it; null for a point of small order */
  x25519(secret: ArrayLike<number>, point: ArrayLike<number>): Uint8Array | null {
    return this.scratch([32, 32, 32], ([o, s, p]) => {
      this.put(s, secret);
      this.put(p, point);
      return this.mod._mesh_x25519(o, s, p) === 1 ? this.get(o, 32) : null;
    });
  }

  /** HMAC-SHA256 */
  hmac(key: ArrayLike<number>, data: ArrayLike<number>): Uint8Array {
    return this.scratch([key.length, data.length, 32], ([k, d, o]) => {
      this.put(k, key);
      this.put(d, data);
      this.mod._mesh_hmac(k, key.length, d, data.length, o);
      return this.get(o, 32);
    });
  }

  /** HKDF-SHA256 (RFC 5869): `length` bytes */
  hkdf(salt: ArrayLike<number>, ikm: ArrayLike<number>, info: ArrayLike<number>, length: number): Uint8Array {
    return this.scratch([salt.length, ikm.length, info.length, length], ([sa, ik, inf, o]) => {
      this.put(sa, salt);
      this.put(ik, ikm);
      this.put(inf, info);
      this.mod._mesh_hkdf(sa, salt.length, ik, ikm.length, inf, info.length, o, length);
      return this.get(o, length);
    });
  }

  /** AES-128-CCM (RFC 3610): the ciphertext and the tag of `tagLen` bytes */
  ccmSeal(key: ArrayLike<number>, nonce: ArrayLike<number>, aad: ArrayLike<number>, data: ArrayLike<number>, tagLen: number): { data: Uint8Array; tag: Uint8Array } | null {
    return this.scratch([16, nonce.length, aad.length, data.length, tagLen], ([k, n, a, d, t]) => {
      this.put(k, key);
      this.put(n, nonce);
      this.put(a, aad);
      this.put(d, data);
      return this.mod._mesh_ccm(1, k, n, nonce.length, a, aad.length, d, data.length, t, tagLen) === 1 ? { data: this.get(d, data.length), tag: this.get(t, tagLen) } : null;
    });
  }

  /** the plaintext, or null when the tag does not match */
  ccmOpen(key: ArrayLike<number>, nonce: ArrayLike<number>, aad: ArrayLike<number>, data: ArrayLike<number>, tag: ArrayLike<number>): Uint8Array | null {
    return this.scratch([16, nonce.length, aad.length, data.length, tag.length], ([k, n, a, d, t]) => {
      this.put(k, key);
      this.put(n, nonce);
      this.put(a, aad);
      this.put(d, data);
      this.put(t, tag);
      return this.mod._mesh_ccm(0, k, n, nonce.length, a, aad.length, d, data.length, t, tag.length) === 1 ? this.get(d, data.length) : null;
    });
  }

  /** AES-128-CTR with a 9-byte nonce, the block counter from 0 */
  ctr(key: ArrayLike<number>, nonce: ArrayLike<number>, data: ArrayLike<number>): Uint8Array {
    return this.scratch([16, 9, data.length], ([k, n, d]) => {
      this.put(k, key);
      this.put(n, nonce);
      this.put(d, data);
      this.mod._mesh_ctr(k, n, d, data.length);
      return this.get(d, data.length);
    });
  }

  /** the most a payload can be in a frame for `dest`, in bytes */
  maxPayload(slot: number, dest: number): number {
    return this.mod._mesh_max_payload(slot, dest);
  }

  /** what a node of the core takes, in bytes */
  sizeOf(): number {
    return this.mod._mesh_sizeof();
  }

  /** what the keys of a node take, in bytes: the identity, the key of the network and the keys of the pairs */
  cryptoSizeOf(): number {
    return this.mod._mesh_crypto_sizeof();
  }

  /** the epoch the node numbers its frames under, which rises when its counter passes the renewal point */
  epoch(slot: number): number {
    return this.mod._mesh_epoch(slot) >>> 0;
  }

  /** the last number the node gave */
  counter(slot: number): number {
    return this.mod._mesh_counter(slot) >>> 0;
  }

  /** numbers the node's frames from `counter` on, to take the counter near its end */
  advanceCounter(slot: number, counter: number) {
    this.mod._mesh_advance_counter(slot, counter >>> 0);
  }

  /** the node has asked its application for the next epoch, which it was made to refuse or not */
  epochWanted(slot: number): boolean {
    return this.mod._mesh_epoch_wanted(slot) === 1;
  }

  /** the node's clock when its own counter reads `nowMs` */
  clock(slot: number, nowMs: number): MeshClock {
    this.mod._mesh_clock(slot, nowMs, this.outPtr);
    const b = this.get(this.outPtr, 21);
    const dv = new DataView(b.buffer, b.byteOffset, 21);
    return { synced: b[0] === 1, adopted: b[1] === 1, timeline: b.slice(2, 7), mesh: dv.getUint32(11, true) * 2 ** 32 + dv.getUint32(7, true), version: dv.getUint32(15, true), tag: dv.getUint16(19, true) };
  }

  /** a stamp for a message: the tag of the timeline and the mesh time in ticks of 10 ms, 6 bytes; null when the node is not synced */
  stamp(slot: number, nowMs: number): Uint8Array | null {
    const n = this.mod._mesh_clock_stamp(slot, nowMs, this.outPtr);
    return n === 6 ? this.get(this.outPtr, 6) : null;
  }

  /** how old a stamp is, ms, and whether its tag is the node's timeline, as the clock stood at `at` and read at `nowMs`; null when the bytes are not a stamp */
  age(slot: number, stamp: ArrayLike<number>, nowMs: number, at = nowMs): { ageMs: number; sameTimeline: boolean } | null {
    this.put(this.inPtr, stamp);
    const n = this.mod._mesh_clock_age(slot, at, nowMs, this.inPtr, stamp.length, this.outPtr);
    if (n !== 5) return null;
    const b = this.get(this.outPtr, 5);
    return { ageMs: new DataView(b.buffer, b.byteOffset, 5).getInt32(0, true), sameTimeline: b[4] === 1 };
  }

  /** the next thing the clock has told the application, or null */
  popClockEvent(slot: number): MeshClockEvent | null {
    if (this.mod._mesh_pop_clock_event(slot, this.outPtr) === 0) return null;
    const b = this.get(this.outPtr, 24);
    const dv = new DataView(b.buffer, b.byteOffset, 24);
    return { kind: b[0], synced: b[1] === 1, from: b.slice(2, 7), to: b.slice(7, 12), ticks: dv.getInt32(12, true), delta: dv.getInt32(20, true) * 2 ** 32 + dv.getUint32(16, true) };
  }

  /** the neighbour a frame of this node's for `dest` goes to next, as it would be sent at `now` (Node::NextHop), and how: 1 dest itself, a neighbour; 2 a
   * neighbour whose heartbeat lists it; 3 the way back. [0, 0] when no way is known */
  nextHop(slot: number, dest: number, now: number): [number, number] {
    const r = this.mod._mesh_next_hop(slot, dest, now >>> 0);
    return [r & 0xff, (r >> 8) & 0xff];
  }

  /** the neighbour a frame for `origin` goes to, or null */
  routeTo(slot: number, origin: number): number[] | null {
    return this.mod._mesh_route_to(slot, origin, this.srcPtr) === 1 ? Array.from(this.get(this.srcPtr, 6)) : null;
  }
}

// --- the air -----------------------------------------------------------------------------------

export interface AirOptions {
  /** the lowest signal a receiver hears, dBm */
  sensitivity?: number;
  /** how much stronger one of two overlapping frames has to be at a receiver to be heard through the other, dB */
  capture?: number;
  /** a fraction of the receptions that are lost at random */
  loss?: number;
  /** the times the radio sends a unicast again before it says it was not acknowledged */
  macTries?: number;
  /** a node does not start sending while it hears another at or above this level, dBm */
  cca?: number;
  seed?: number;
  weakDbm?: number;
  suppressAt?: number;
  tagged?: boolean;
  /** the time between heartbeats; 0: the nodes send none and watch none */
  beatMs?: number;
  /** the count in a minute that makes it a noisy one; 0: the core's own */
  noiseLimit?: number;
  /** the nodes on the network they share, a second medium beside the radio: true for all of them, or their numbers */
  net?: boolean | number[];
  /** the nodes that have no radio in use: they hear and say everything by the network */
  udpOnly?: number[];
  /** the nodes that repeat on the network what they repeat on the radio, for the nodes that have no radio */
  udpRelay?: number[];
  /** each node asks everyone where they are when it starts, after the wait the core sets by its number and a draw (false: the host asks, with `boot`) */
  startSync?: boolean;
  /** the core's parameters of that start, and of the answers; 0 is the core's own default (the limit of answers: 255 is none) */
  startSlotMs?: number;
  startJitterMs?: number;
  answersPerSecond?: number;
  /** each node chooses the neighbours that repeat for it, says whom in its heartbeat and repeats later when a sender did not choose it (false: every node that hears a flooded frame repeats it, as before) */
  chooseRelays?: boolean;
  /** how much longer a node that was not chosen waits, ms (0: the core's own), and the copies heard, the first included, that make it drop its own (0: the core's own) */
  relayBackupMs?: number;
  relayDropAt?: number;
  /** the nodes whose application refuses them the next epoch when their counter nears its end (true: all of them, as the firmware's driver does: it starts the node again instead) */
  declineEpoch?: boolean | number[];
  /** the heartbeat carries the mesh time and the timeline, and takes them from the ones it hears (the application's bytes begin with the layout, and the node fills in the clock's) */
  clock?: boolean;
  /** the neighbours counted on that a node needs to choose repeaters (0: the core's own, 10) */
  relayMinNeighbors?: number;
  /** how long a frame takes on the network, ms */
  udpLatencyMs?: number;
  /** the fraction of the frames the network loses */
  udpLoss?: number;
  /** the nodes encipher what they send and open what they receive: true, a toy cipher with the shape of the firmware's; "real", the firmware's own, on BearSSL */
  cipher?: boolean | "real";
  /** with the real cipher, the nodes say in their heartbeats which key of the network they hold (the version, whether they hold a previous key, whether they need the key) */
  keys?: boolean;
  /** a frame for one node goes in unicast along the best way the sender knows, hop by hop, and falls back to the flood (the firmware's ESPNOW_MESH_ROUTE_UNICAST) */
  routeUnicast?: boolean;
}

interface Tx {
  from: number;
  to: number[];
  start: number;
  end: number;
  bytes: Uint8Array;
}

/**
 * What runs a node's core in a device, as the firmware's radio task does (mesh-driver.ts): a node of the air that has one hands the
 * application what the core has for it through this, instead of the air keeping it in its logs only, and takes the application's
 * commands before it runs the core.
 */
export interface MeshAirApp {
  /** the start of the task's turn: the commands the main loop queued, and whether the application is ready for the frames for it */
  commands(n: MeshAirNode, ms: number): void;
  /** after the core was given the time or a frame: what it has for the application, taken only while the queue that carries it has room */
  drain(n: MeshAirNode, ms: number): void;
  /** every millisecond of the node's own counter, after the core's tick: the task's snapshot, every 500 ms */
  tick(n: MeshAirNode, ms: number): void;
}

export interface MeshAirNode {
  id: number;
  slot: number;
  x: number;
  y: number;
  epoch: number;
  wake: number;
  /** when it may start sending, after the channel was free: the wait the radio draws, in microseconds */
  backoff: number | null;
  /** the number of the last frame of its own */
  last: number;
  /** a node that is off sends nothing and hears nothing */
  on: boolean;
  /** on the network the nodes share */
  net: boolean;
  /** no radio in use: everything by the network */
  udpOnly: boolean;
  /** repeats on the network what it repeats on the radio */
  udpRelay: boolean;
  /** how far the node's crystal runs from the air's time, in parts per million, since `baseT`; `baseLocal` is what its counter read then, microseconds */
  ppm: number;
  baseT: number;
  baseLocal: number;
  /** the last millisecond of its own counter the core was given, and the one of this step */
  lastLocal: number;
  cur: number;
  /** the device's driver, when a simulated device runs the node */
  app?: MeshAirApp;
}

/** how a node starts on the air, beyond the air's own options */
export interface NodeStart {
  udpOnly?: boolean;
  udpRelay?: boolean;
  /** on the network the nodes share, from the start */
  net?: boolean;
  /** the pace of its crystal */
  ppm?: number;
}

/** a node's restart: the epoch it numbers its frames under (the next one when not said), and whether its counter starts over at 0, as the chip's millis() does */
export interface NodeRestart extends NodeStart {
  epoch?: number;
  resetCounter?: boolean;
}

export interface Reception {
  at: number;
  node: number;
  verdict: Verdict;
}

const STEP_US = 100;

/** the bytes the core takes for the address of a node: its number in the last of six */
export const macOf = (id: number): number[] => [0x24, 0x0a, 0xc4, 0, 0, id];

/** how long a frame of `n` bytes takes on the air at 1 Mbps, with the headers and the wait for the channel */
export const airtimeUs = (n: number): number => Math.round(1000 + 7.2 * n);

/** the extra the receiver's acknowledgement takes after a unicast */
const MAC_ACK_US = 300;

export class MeshAir {
  readonly core: MeshCore;
  readonly nodes: MeshAirNode[] = [];
  readonly opt: Required<AirOptions>;
  /** the time, in microseconds */
  t = 0;
  /** the signal each node hears of each other: "from>to" */
  private links = new Map<string, number>();
  /** a fraction of what `from` sends that `to` loses, in place of the general one */
  private linkLoss = new Map<string, number>();
  private active: Tx[] = [];
  private recent: Tx[] = [];
  private dirty = new Set<number>();
  private rng: number;
  /** the first step has been taken: a node that joins after it is not given a millisecond it has not lived */
  private started = false;
  /** the radio's groups: a node hears only the ones of its own group (the ones that are in none are in the group 0) */
  private group = new Map<number, number>();
  /** the microseconds each node spent sending */
  readonly airUs = new Map<number, number>();
  /** every frame that went on the air, when and from whom */
  readonly log: { at: number; from: number; to: number; kind: number; origin: number; dest: number; counter: number; hops: number; len: number; bytes: Uint8Array }[] = [];
  /** every frame that went on the network: when, from whom, to whom (0: all of them) */
  readonly udpLog: { at: number; from: number; to: number; kind: number; origin: number; dest: number; counter: number; len: number; bytes: Uint8Array }[] = [];
  private udpQueue: { at: number; from: number; to: number; bytes: Uint8Array }[] = [];
  /** the deliveries to each node's application, by message ("origin:epoch:counter") */
  readonly delivered = new Map<string, Map<number, { at: number; d: MeshDelivery }>>();
  /** every delivery to an application, in order: the retransmissions too */
  readonly deliveries: { at: number; node: number; d: MeshDelivery }[] = [];
  /** when each own frame was handed over, by message */
  readonly sentAt = new Map<string, number>();
  /** what became of the frames that asked for an answer, by message */
  readonly outcomes = new Map<string, MeshOutcome & { at: number }>();
  /** what the receivers made of each frame, per message */
  readonly verdicts: Reception[] = [];
  /** what the supervision of each node told its application, in order */
  readonly notices: { at: number; node: number; notice: MeshNotice }[] = [];
  /** what the clock of each node told its application, in order */
  readonly clockEvents: { at: number; node: number; event: MeshClockEvent }[] = [];

  private constructor(core: MeshCore, opt: AirOptions) {
    this.core = core;
    this.opt = { sensitivity: -90, capture: 6, loss: 0, macTries: 3, cca: -85, seed: 12345, weakDbm: -70, suppressAt: 2, tagged: true, beatMs: 0, noiseLimit: 0, cipher: false, net: false, udpOnly: [], udpRelay: [], udpLatencyMs: 2, udpLoss: 0, startSync: false, startSlotMs: 0, startJitterMs: 0, answersPerSecond: 0, chooseRelays: false, relayBackupMs: 0, relayDropAt: 0, relayMinNeighbors: 0, declineEpoch: [], clock: false, keys: false, routeUnicast: false, ...opt };
    this.rng = this.opt.seed >>> 0 || 1;
  }

  /** the air with the core of this build; `core` is another one: the nodes of a house can be of builds with other constants if it dispatches by the slot of the node (scripts/mesh-hops-matrix.mjs) */
  static async create(opt: AirOptions = {}, core?: MeshCore): Promise<MeshAir> {
    return new MeshAir(core ?? (await MeshCore.load()), opt);
  }

  /** the options of a node's start, as the core takes them */
  private start() {
    return { startSync: this.opt.startSync, startSlotMs: this.opt.startSlotMs, startJitterMs: this.opt.startJitterMs, answersPerSecond: this.opt.answersPerSecond, chooseRelays: this.opt.chooseRelays, relayBackupMs: this.opt.relayBackupMs, relayDropAt: this.opt.relayDropAt, relayMinNeighbors: this.opt.relayMinNeighbors, declineEpoch: false, clock: this.opt.clock, routeUnicast: this.opt.routeUnicast };
  }

  private random(): number {
    let x = this.rng;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.rng = x;
    return x / 4294967296;
  }

  get ms(): number {
    return Math.floor(this.t / 1000);
  }

  /** the nodes use the firmware's own cipher, whose keys the host can change */
  get realCipher(): boolean {
    return this.opt.cipher === "real";
  }

  /** the core's start of a node: the air's options and the node's own */
  private begin(n: MeshAirNode, seed: number) {
    this.core.begin(n.slot, n.id, { epoch: n.epoch, seed: seed >>> 0, tagged: this.opt.tagged, weakDbm: this.opt.weakDbm, suppressAt: this.opt.suppressAt, beatMs: this.opt.beatMs, noiseLimit: this.opt.noiseLimit, cipher: this.opt.cipher, udpOnly: n.udpOnly, udpRelay: n.udpRelay, ...this.start(), declineEpoch: this.opt.declineEpoch === true || (Array.isArray(this.opt.declineEpoch) && this.opt.declineEpoch.includes(n.id)), keys: this.opt.keys });
    // the keys the node was given are the ones a flash would hold: a start gives them back, and is no change
    const held = this.keys.get(n.id);
    if (held && this.opt.cipher === "real") this.core.keySet(n.slot, held.key, held.version, held.previousKey, held.previousVersion);
  }

  /** a node with this number, at a place (metres, for the geometry helpers) */
  add(id: number, x = 0, y = 0, epoch = 1, start: NodeStart = {}): MeshAirNode {
    const slot = this.nodes.length;
    const udpOnly = start.udpOnly ?? this.opt.udpOnly.includes(id);
    const net = start.net ?? (this.opt.net === true || (Array.isArray(this.opt.net) && this.opt.net.includes(id)) || udpOnly);
    const node: MeshAirNode = { id, slot, x, y, epoch, wake: Infinity, backoff: null, last: 0, on: true, net: net || udpOnly, udpOnly, udpRelay: start.udpRelay ?? this.opt.udpRelay.includes(id),
      ppm: start.ppm ?? 0, baseT: 0, baseLocal: 0, lastLocal: -1, cur: 0 };
    this.begin(node, this.opt.seed + id * 7919);
    this.nodes.push(node);
    this.airUs.set(id, 0);
    this.core.setUdp(slot, node.net);
    this.connect(node);
    // a node that joins a run that has begun was not there for the milliseconds it has seen: its first tick is at the next
    if (this.started) node.lastLocal = this.localMs(node);
    return node;
  }

  node(id: number): MeshAirNode {
    const n = this.nodes.find((x) => x.id === id);
    if (!n) throw new Error(`no node ${id}`);
    return n;
  }

  /** whether there is a node with this number */
  has(id: number): boolean {
    return this.nodes.some((x) => x.id === id);
  }

  /** what the node's own counter reads, in microseconds: the air's time for an exact crystal, and the pace of its own for one that is not */
  private localUs(n: MeshAirNode): number {
    return n.baseLocal + (this.t - n.baseT) * (1 + n.ppm * 1e-6);
  }

  /** the millisecond the core of a node is given: its own counter, 32 bits, as the chip's millis() is */
  localMs(n: MeshAirNode | number): number {
    return Math.floor(this.localUs(typeof n === "number" ? this.node(n) : n) / 1000) >>> 0;
  }

  /** the pace of a node's crystal from now on, in parts per million fast (negative: slow); what its counter has read stays as it is */
  setPpm(id: number, ppm: number) {
    const n = this.node(id);
    n.baseLocal = this.localUs(n);
    n.baseT = this.t;
    n.ppm = ppm;
  }

  /**
   * The radio is cut in groups: a node hears the nodes of its own group and no others, on the radio and on the network. The nodes not named
   * stay in the group they were in, and the groups named are numbered from 1. `heal` takes the cuts away.
   */
  partition(groups: number[][]) {
    groups.forEach((ids, i) => { for (const id of ids) this.group.set(id, i + 1); });
  }

  /** a node that hears no one and is heard by no one, until `heal` */
  isolate(id: number) {
    this.group.set(id, 1000 + id);
  }

  /** every cut taken away: all the nodes in one group again */
  heal() {
    this.group.clear();
  }

  /** the group of a node */
  groupOf(id: number): number {
    return this.group.get(id) ?? 0;
  }

  /** the application of a node asks for a turn of its task: it has queued a command, or its readiness changed */
  wake(id: number) {
    this.dirty.add(this.node(id).slot);
  }

  /** the signal each hears of the other, in dBm, both ways */
  link(a: number, b: number, rssi: number, back = rssi) {
    this.links.set(`${a}>${b}`, rssi);
    this.links.set(`${b}>${a}`, back);
  }

  /** the two nodes do not hear each other any more */
  unlink(a: number, b: number) {
    this.links.delete(`${a}>${b}`);
    this.links.delete(`${b}>${a}`);
  }

  /** what `to` loses of what `from` sends, from now on (undefined: the general loss) */
  setLinkLoss(from: number, to: number, loss: number | undefined) {
    if (loss === undefined) this.linkLoss.delete(`${from}>${to}`); else this.linkLoss.set(`${from}>${to}`, loss);
  }

  /** the signal `to` hears of `from`, or undefined when it is out of range */
  heard(from: number, to: number): number | undefined {
    if (this.group.size > 0 && (this.group.get(from) ?? 0) !== (this.group.get(to) ?? 0)) return undefined;
    const r = this.links.get(`${from}>${to}`);
    return r !== undefined && r >= this.opt.sensitivity ? r : undefined;
  }

  /** every pair's signal from the places: a log-distance path loss, less what `walls(a, b)` takes off */
  geometry(exponent = 2.2, walls: (a: MeshAirNode, b: MeshAirNode) => number = () => 0) {
    for (const a of this.nodes) {
      for (const b of this.nodes) {
        if (a === b) continue;
        const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        this.links.set(`${a.id}>${b.id}`, Math.round(-40 - 10 * exponent * Math.log10(d) - walls(a, b)));
      }
    }
  }

  /** every node knows where every other is: epoch, and the counter 0 (nothing sent yet) */
  syncAll() {
    for (const a of this.nodes) for (const b of this.nodes) if (a !== b) this.core.synced(a.slot, b.id, b.epoch, 0);
  }

  /** the host has a node ask everyone where they are at once, with no wait: for a test that sets the moment. A node of the core that is told to (the option startSync) asks by itself at start, after the wait its number sets */
  boot(id: number) {
    const n = this.node(id);
    this.core.requestSync(n.slot, MESH.TO_ALL, this.localMs(n));
    this.dirty.add(n.slot);
  }

  /** every node that does not know the others asks them, one after another `gapMs` apart (0: all at once) */
  handshake(gapMs = 0) {
    for (const n of this.nodes) {
      this.boot(n.id);
      if (gapMs > 0) this.run(gapMs);
    }
  }

  /** whether `a` accepts the frames of `b`: it has been through the exchange with it */
  knows(a: number, b: number): boolean {
    const slot = this.node(a).slot;
    // a frame of b that a would take is the proof; asked through the nodes' own state
    return this.core.knows(slot, b);
  }

  /** the application's frame handed over: its number, or 0 when the core refused it (no room, no key, too long) */
  handOver(from: number, type: number, dest: number, payload: ArrayLike<number> = [], ack = false, previous = false): number {
    const n = this.node(from);
    const counter = this.core.send(n.slot, type, dest, payload, ack, this.localMs(n), previous);
    if (counter === 0) return 0;
    n.last = counter;
    this.dirty.add(n.slot);
    this.sentAt.set(`${from}:${this.core.epoch(n.slot)}:${counter}`, this.t);
    return counter;
  }

  /** a node hands the application's frame over; returns its message key. `previous`: the tag is made with the key the network had before its last change */
  send(from: number, type: number, dest: number, payload: ArrayLike<number> = [], ack = false, previous = false): string {
    const counter = this.handOver(from, type, dest, payload, ack, previous);
    if (counter === 0) throw new Error(`node ${from} refused the frame`);
    return `${from}:${this.core.epoch(this.node(from).slot)}:${counter}`;
  }

  /** the same, along the way back to `dest`; null when the node has no way there */
  sendRouted(from: number, type: number, dest: number, payload: ArrayLike<number> = []): string | null {
    const n = this.node(from);
    const counter = this.core.sendRouted(n.slot, type, dest, payload, this.localMs(n));
    if (counter === 0) return null;
    n.last = counter;
    this.dirty.add(n.slot);
    const key = `${from}:${this.core.epoch(n.slot)}:${counter}`;
    this.sentAt.set(key, this.t);
    return key;
  }

  /** a message longer than a frame, in two parts; the keys of the two, or null when it did not go */
  sendParts(from: number, type: number, dest: number, payload: ArrayLike<number>, ack = false): [string, string] | null {
    const n = this.node(from);
    const c = this.core.sendParts(n.slot, type, dest, payload, ack, this.localMs(n));
    if (c === null) return null;
    n.last = c[1];
    this.dirty.add(n.slot);
    const keys = c.map((x) => `${from}:${this.core.epoch(n.slot)}:${x}`) as [string, string];
    for (const k of keys) this.sentAt.set(k, this.t);
    return keys;
  }

  /** a piece of a bulk transfer from one node to another; the counter, or 0 */
  sendBulkPiece(from: number, dest: number, id: number, index: number, total: number, data: ArrayLike<number>): number {
    const n = this.node(from);
    const c = this.core.sendBulkPiece(n.slot, dest, id, index, total, data, this.localMs(n));
    if (c !== 0) { n.last = c; this.dirty.add(n.slot); this.sentAt.set(`${from}:${this.core.epoch(n.slot)}:${c}`, this.t); }
    return c;
  }

  /** a node restarts: it forgets everything and its epoch is one higher (or the one it is given), a new timeline of its clock that begins at 0 */
  restart(id: number, o: NodeRestart = {}) {
    const n = this.node(id);
    n.epoch = o.epoch ?? Math.max(n.epoch, this.core.epoch(n.slot)) + 1;
    n.last = 0;
    if (o.udpOnly !== undefined) n.udpOnly = o.udpOnly;
    if (o.udpRelay !== undefined) n.udpRelay = o.udpRelay;
    if (o.net !== undefined) n.net = o.net || n.udpOnly;
    if (o.ppm !== undefined) this.setPpm(id, o.ppm);
    if (o.resetCounter) { n.baseLocal = 0; n.baseT = this.t; }
    this.begin(n, this.opt.seed + id * 7919 + n.epoch * 31);
    this.core.setUdp(n.slot, n.net);
    n.on = true;
    this.connect(n);
    this.dirty.add(n.slot);
  }

  /** the keys a node holds with the real cipher, as its flash would: a start gives them back. The first of a node is 0 (the key every node starts with) at version 1 */
  private readonly keys = new Map<number, { key: Uint8Array; version: number; previousKey: Uint8Array; previousVersion: number }>();

  /** the node is given the keys it holds, with no time for the change to reach the others (the state of a flash at a start); each key as bytes, or as the number a test makes it of */
  keySet(id: number, key: number | ArrayLike<number>, version: number, previousKey: number | ArrayLike<number> = 0, previousVersion = 0) {
    const n = this.node(id);
    this.keys.set(id, { key: keyBytes(key), version, previousKey: keyBytes(previousKey), previousVersion });
    this.core.keySet(n.slot, key, version, previousKey, previousVersion);
    this.dirty.add(n.slot);
  }

  /** the network's key changes at the node: it keeps the one it had as the previous key, sends with the new one, and the change has the time for the others from now */
  keyChange(id: number, key: number | ArrayLike<number>, version: number) {
    const n = this.node(id);
    const held = this.keys.get(id) ?? { key: keyBytes(0), version: 1, previousKey: keyBytes(0), previousVersion: 0 };
    this.keys.set(id, { key: keyBytes(key), version, previousKey: held.key, previousVersion: held.version });
    this.core.keyChange(n.slot, key, version, this.localMs(n));
    this.dirty.add(n.slot);
  }

  /** the node `id` forgets `node`, which its driver took out of its list (EspNowMeshApplyShared) */
  forget(id: number, node: number) {
    this.core.forget(this.node(id).slot, node);
  }

  /** the change is closed at the node: the previous key is let go */
  keyClose(id: number) {
    const n = this.node(id);
    const held = this.keys.get(id);
    if (held) this.keys.set(id, { ...held, previousVersion: 0 });
    this.core.keyClose(n.slot, this.localMs(n));
    this.dirty.add(n.slot);
  }

  /** what the node holds and says of the keys */
  keyState(id: number): MeshKeyState {
    const n = this.node(id);
    return this.core.keyState(n.slot, this.localMs(n));
  }

  /** with the real cipher, the node and the others learn each other's public key, as the list of the network gives them */
  private connect(n: MeshAirNode) {
    if (this.opt.cipher !== "real") return;
    const pub = this.core.identity(n.slot);
    for (const o of this.nodes) {
      if (o === n) continue;
      this.core.setPeer(n.slot, o.id, this.core.identity(o.slot));
      this.core.setPeer(o.slot, n.id, pub);
    }
  }

  /** a node is switched off, or on again with what it had (a restart is `restart`) */
  power(id: number, on: boolean) {
    const n = this.node(id);
    n.on = on;
    n.backoff = null;
    this.dirty.add(n.slot);
  }

  /** the neighbours of a node, as it has them */
  neighbors(id: number): MeshNeighbor[] {
    const n = this.node(id);
    return this.core.neighbors(n.slot, this.localMs(n));
  }

  /** what the node can say of its neighbourhood now */
  health(id: number): MeshHealth {
    const n = this.node(id);
    return this.core.health(n.slot, this.localMs(n));
  }

  /** what `a` has of `b` among its neighbours, or undefined */
  neighbor(a: number, b: number): MeshNeighbor | undefined {
    return this.neighbors(a).find((x) => x.id === b);
  }

  /** the notices of a node's supervision of one kind, about one node (any when omitted) */
  noticesOf(id: number, kind: number, about?: number) {
    return this.notices.filter((x) => x.node === id && x.notice.kind === kind && (about === undefined || x.notice.node === about));
  }

  /** the nodes that got a message delivered to their application, with the time it took */
  reached(key: string): Map<number, number> {
    const at = this.sentAt.get(key) ?? 0;
    const out = new Map<number, number>();
    for (const [node, v] of this.delivered.get(key) ?? []) out.set(node, v.at - at);
    return out;
  }

  /** how many times a message was delivered to a node's application, the retransmissions included */
  deliveriesOf(key: string, node: number): number {
    const [origin, epoch, counter] = key.split(":").map(Number);
    return this.deliveries.filter((x) => x.node === node && x.d.origin === origin && x.d.epoch === epoch && x.d.counter === counter).length;
  }

  /** how many frames went on the air for a message: the origin's own and every repetition */
  copies(key: string): number {
    const [origin, , counter] = key.split(":").map(Number);
    return this.log.filter((l) => l.origin === origin && l.counter === counter).length;
  }

  run(ms: number) {
    const end = this.t + ms * 1000;
    while (this.t < end) {
      this.step();
      this.t += STEP_US;
    }
  }

  /** until nothing is waiting to be sent, in the air or for an answer, or `maxMs` pass */
  settle(maxMs = 2000) {
    const end = this.t + maxMs * 1000;
    while (this.t < end && (this.active.length > 0 || this.udpQueue.length > 0 || this.nodes.some((n) => this.core.queued(n.slot) > 0 || this.core.waiting(n.slot) > 0))) {
      this.step();
      this.t += STEP_US;
    }
  }

  /** whether `n` hears another node sending, at a level that keeps its radio from starting */
  private channelBusy(n: MeshAirNode): boolean {
    for (const tx of this.active) {
      if (tx.from === n.id) continue;
      const r = this.heard(tx.from, n.id);
      if (r !== undefined && r >= this.opt.cca) return true;
    }
    return false;
  }

  /** a frame on the network, to the nodes it is for: it arrives after its latency, and the network may lose it */
  private sendUdp(n: MeshAirNode, out: { bytes: Uint8Array; target: number }) {
    if (!n.net) return;
    const f = this.core.decode(out.bytes)!;
    this.udpLog.push({ at: this.t, from: n.id, to: out.target, kind: f.kind, origin: f.origin, dest: f.dest, counter: f.counter, len: out.bytes.length, bytes: out.bytes });
    // a node whose network is down hears nothing by it, whether the frame names it or goes to every node on the network
    const targets = (out.target !== 0 ? [out.target] : this.nodes.filter((x) => x.id !== n.id).map((x) => x.id)).filter((id) => this.node(id).net && this.groupOf(id) === this.groupOf(n.id));
    for (const id of targets) {
      if (this.random() < this.opt.udpLoss) continue;
      this.udpQueue.push({ at: this.t + this.opt.udpLatencyMs * 1000, from: n.id, to: id, bytes: out.bytes });
    }
  }

  /** a node hears a frame, by the radio or by the network, and what it makes of it reaches its application */
  private hear(r: MeshAirNode, bytes: Uint8Array, from: number, rssi: number, udp: boolean) {
    const verdict = this.core.receive(r.slot, bytes, macOf(from), rssi, this.localMs(r), udp);
    this.verdicts.push({ at: this.t, node: r.id, verdict });
    if (!r.app) for (let d = this.core.pop(r.slot); d; d = this.core.pop(r.slot)) this.recordDelivery(r, d);
    this.collect(r);
    this.dirty.add(r.slot);
  }

  /** a frame handed to the application of a node, in the air's logs */
  recordDelivery(n: MeshAirNode, d: MeshDelivery) {
    const key = `${d.origin}:${d.epoch}:${d.counter}`;
    this.deliveries.push({ at: this.t, node: n.id, d });
    let m = this.delivered.get(key);
    if (!m) this.delivered.set(key, (m = new Map()));
    if (!m.has(n.id) || d.retry === false) m.set(n.id, { at: this.t, d });
  }

  /** what became of a frame of a node's that asked for an answer, in the air's logs */
  recordOutcome(n: MeshAirNode, o: MeshOutcome) {
    this.outcomes.set(`${n.id}:${this.core.epoch(n.slot)}:${o.counter}`, { ...o, at: this.t });
  }

  recordNotice(n: MeshAirNode, x: MeshNotice) {
    this.notices.push({ at: this.t, node: n.id, notice: x });
  }

  recordClockEvent(n: MeshAirNode, e: MeshClockEvent) {
    this.clockEvents.push({ at: this.t, node: n.id, event: e });
  }

  private step() {
    for (const tx of [...this.active]) if (tx.end <= this.t) this.finish(tx);
    if (this.udpQueue.length > 0) {
      const due = this.udpQueue.filter((u) => u.at <= this.t);
      if (due.length > 0) {
        this.udpQueue = this.udpQueue.filter((u) => u.at > this.t);
        for (const u of due) {
          const r = this.node(u.to);
          if (r.on && r.net) this.hear(r, u.bytes, u.from, 0, true);
        }
      }
    }
    this.started = true;
    // each node's core is given the time when its own counter moves to another millisecond: all at once for crystals that are exact
    for (const n of this.nodes) {
      const ms = (n.cur = this.localMs(n));
      if (ms === n.lastLocal) continue;
      n.lastLocal = ms;
      if (!n.on) continue;
      this.core.tick(n.slot, ms);
      this.collect(n);
      n.app?.tick(n, ms);
      this.dirty.add(n.slot);
    }
    // the nodes with a frame ready; a node that has one waits until the channel is free for it and then draws a wait of its
    // own, so that two that heard the same end of a frame do not start together, as the radio's own access does
    const ready: MeshAirNode[] = [];
    for (const n of this.nodes) {
      if (!n.on) continue;
      const ms = n.cur;
      if (!this.dirty.has(n.slot) && ms < n.wake) continue;
      n.app?.commands(n, ms);
      this.dirty.delete(n.slot);
      n.wake = Infinity;
      // a node with no radio in use sends by the network at once, with no channel to wait for
      if (n.udpOnly) {
        const when = this.core.nextDue(n.slot);
        if (when !== null && when > ms) n.wake = when;
        else if (when !== null) {
          for (let o = this.core.nextTx(n.slot, ms); o; o = this.core.nextTx(n.slot, ms)) {
            this.sendUdp(n, o);
            this.core.txDone(n.slot, true, ms);
          }
        }
        continue;
      }
      if (this.core.busy(n.slot)) { n.backoff = null; continue; }
      const due = this.core.nextDue(n.slot);
      if (due === null) { n.backoff = null; continue; }
      if (due > ms) { n.wake = due; n.backoff = null; continue; }
      if (!this.channelBusy(n) && n.backoff === null) n.backoff = this.t + 28 + 9 * Math.floor(this.random() * 16);
      ready.push(n);
    }
    ready.sort((a, b) => (a.backoff ?? Infinity) - (b.backoff ?? Infinity));
    for (const n of ready) {
      if (this.channelBusy(n)) { n.backoff = null; this.dirty.add(n.slot); continue; }
      if (n.backoff === null) n.backoff = this.t + 28 + 9 * Math.floor(this.random() * 16);
      if (this.t < n.backoff) { this.dirty.add(n.slot); continue; }
      const out = this.core.nextTx(n.slot, n.cur);
      n.backoff = null;
      if (!out) continue;
      if (out.paths & 2) this.sendUdp(n, out);
      if (!(out.paths & 1)) {
        // for the network alone: nothing on the radio, and the radio's turn is over at once
        this.core.txDone(n.slot, true, n.cur);
        this.dirty.add(n.slot);
        continue;
      }
      const bytes = out.bytes;
      const tx: Tx = { from: n.id, to: out.to, start: this.t, end: this.t + airtimeUs(bytes.length) + (out.to[5] !== 0xff ? MAC_ACK_US : 0), bytes };
      this.active.push(tx);
      this.airUs.set(n.id, (this.airUs.get(n.id) ?? 0) + (tx.end - tx.start));
      const f = this.core.decode(bytes)!;
      this.log.push({ at: this.t, from: n.id, to: out.to[5], kind: f.kind, origin: f.origin, dest: f.dest, counter: f.counter, hops: f.hops, len: bytes.length, bytes });
    }
  }

  /** the node's outcomes and deliveries, after the core was given the time or a frame */
  private collect(n: MeshAirNode) {
    if (n.app) {
      n.app.drain(n, this.localMs(n));
      return;
    }
    for (let o = this.core.popOutcome(n.slot); o; o = this.core.popOutcome(n.slot)) this.recordOutcome(n, o);
    for (let x = this.core.popNotice(n.slot); x; x = this.core.popNotice(n.slot)) this.recordNotice(n, x);
    for (let e = this.core.popClockEvent(n.slot); e; e = this.core.popClockEvent(n.slot)) this.recordClockEvent(n, e);
  }

  /** the clock of a node now */
  clock(id: number): MeshClock {
    const n = this.node(id);
    return this.core.clock(n.slot, this.localMs(n));
  }

  /** whether a frame from `from`, heard at `rssi`, gets to `r` at the end of `tx`, given everything else on the air */
  private arrives(tx: Tx, r: MeshAirNode, rssi: number): boolean {
    // a receiver that was sending itself while this was in the air heard nothing
    if (this.recent.some((o) => o !== tx && o.from === r.id && o.start < tx.end && o.end > tx.start)) return false;
    for (const o of this.recent) {
      if (o === tx || o.from === tx.from || o.start >= tx.end || o.end <= tx.start) continue;
      const other = this.heard(o.from, r.id);
      if (other === undefined) continue;
      if (other >= rssi - this.opt.capture) return false;
    }
    return true;
  }

  private finish(tx: Tx) {
    this.active = this.active.filter((x) => x !== tx);
    this.recent.push(tx);
    const cutoff = this.t - 30000;
    this.recent = this.recent.filter((x) => x.end > cutoff);
    const sender = this.node(tx.from);
    const unicast = tx.to[5] !== 0xff;
    let acknowledged = false;
    for (const r of this.nodes) {
      if (r.id === tx.from || !r.on || r.udpOnly) continue;
      // a unicast is for the node it names: the radio of the others drops it
      if (unicast && r.id !== tx.to[5]) continue;
      const rssi = this.heard(tx.from, r.id);
      if (rssi === undefined) continue;
      if (!this.arrives(tx, r, rssi)) continue;
      // a unicast is sent again by the radio when it is not acknowledged, up to `macTries` times
      let lost = true;
      for (let i = 0; i < (unicast ? this.opt.macTries : 1); i++) {
        if (this.random() >= (this.linkLoss.get(`${tx.from}>${r.id}`) ?? this.opt.loss)) { lost = false; break; }
      }
      if (lost) continue;
      if (unicast) acknowledged = true;
      this.hear(r, tx.bytes, tx.from, rssi, false);
    }
    this.core.txDone(sender.slot, unicast ? acknowledged : true, this.localMs(sender));
    this.dirty.add(sender.slot);
  }
}

// --- the health of a house, from what its nodes report -------------------------------------------------

/** the graph the nodes' own reports describe, put together: an edge when each of the two counts on the other as a way */
export function healthGraph(air: MeshAir): Map<number, Set<number>> {
  const counts = new Map<number, Set<number>>();
  for (const n of air.nodes) counts.set(n.id, new Set(air.health(n.id).links.filter((l) => l.usable).map((l) => l.id)));
  const graph = new Map<number, Set<number>>();
  for (const n of air.nodes) graph.set(n.id, new Set());
  for (const [a, set] of counts) for (const b of set) if (counts.get(b)?.has(a)) { graph.get(a)!.add(b); graph.get(b)!.add(a); }
  return graph;
}

/** the nodes whose going away would split the graph (Tarjan), ascending: what the reports of all the nodes together can say for certain,
 *  which one node's report, with only two hops in view, cannot */
export function articulationPoints(graph: Map<number, Set<number>>): number[] {
  const disc = new Map<number, number>();
  const low = new Map<number, number>();
  const cut = new Set<number>();
  let time = 0;
  const visit = (u: number, parent: number | null) => {
    disc.set(u, ++time);
    low.set(u, time);
    let children = 0;
    for (const v of graph.get(u) ?? []) {
      if (!disc.has(v)) {
        children++;
        visit(v, u);
        low.set(u, Math.min(low.get(u)!, low.get(v)!));
        if (parent !== null && low.get(v)! >= disc.get(u)!) cut.add(u);
      } else if (v !== parent) {
        low.set(u, Math.min(low.get(u)!, disc.get(v)!));
      }
    }
    if (parent === null && children > 1) cut.add(u);
  };
  for (const u of graph.keys()) if (!disc.has(u)) visit(u, null);
  return [...cut].sort((a, b) => a - b);
}
