// REFERENCE IMPLEMENTATION OF THE ALARM-STATE ORDER RULE.
//
// The alarm state is replicated in up to 15 bridges over the ESP-NOW mesh. When the mesh splits, bridges restart and then join
// again, copies of the state meet and one must win, in every bridge, whatever the order the copies meet in. The rule has three
// layers, in this order, and a replica keeps the SET OF HEADS:
//
//   1. CAUSALITY FIRST. A copy that descends from another replaces it. "Descends" is read from the VERSION VECTOR the copy carries
//      (15 counters, one per bridge: the highest action of that bridge the copy has in its past): y descends x when
//      y.vv[node of x] >= counter of x. It is exact (the 8 points of history the first design had were a window: finding F1), and a
//      node's own later actions descend its earlier ones. No clock is read. This closes the power cut that brings back an old
//      "disarmed" (S1) and the whole house that restarts together (S8).
//   2. A RELATIVE CLOCK. Between copies that did not see each other, the most recent wins, by a clock that is only relative: each
//      node counts the time it has been up; a node that meets one that has been up LONGER adopts that node's timeline and
//      TRANSLATES what it did on its own into it (the difference of the two times, measured at the meeting). Marks are compared ONLY
//      inside the same timeline. The wall clock (the date, NTP) is never read.
//   3. WHAT CANNOT BE PLACED FALLS TO THE SAFE SIDE, THE DISARMED. Two copies that did not see each other and whose marks are in
//      different timelines (a node that restarted again, alone, before meeting anybody: S12) cannot be ordered: the disarmed one
//      wins (a disarm is made by a person in front of a panel).
//
//   THE SET OF HEADS. A replica does not throw a copy away because another one beat it by the clock or by the safe side: the three
//   layers are not one order (B beats C, A beats B, C beats A: finding F2), so a copy discarded on a step that depends on who was
//   met first cannot be recovered. A replica keeps every copy that nothing it has seen descends from (the HEADS: usually one, a few
//   while a conflict is open, never more than 15, one per bridge); ONLY CAUSALITY DISCARDS. The state it shows, and acts on, is a
//   function of the set of heads: the pairwise rule (the three layers) folded over the heads in the order of their dots. Two
//   replicas that hold the same heads show the same state, in whatever order the copies reached them.
//
// What this file is: plain JavaScript that does NOT run on the device. It is the specification the Berry implementation (the alarm
// front) must reproduce, case by case, from berry/test/vectors/alarm_merge.json. It reads no clock of its own: every operation
// takes `up`, the node's own monotonic uptime in milliseconds (what the firmware gets from esp_timer), so the model is the same a
// device would run. The wall clock is NOT a parameter anywhere. The first design (8 points of history, one record) is kept only as
// a labelled control in alarm-merge-legacy.mjs, so the tests still show where it fails.
//
// ---------------------------------------------------------------------------------------------------------------------------
// THE SIZES (bytes on the wire and in the flash).
//
//   dot            3 B   node 4 bits (1..15) + counter 20 bits (1..1 048 575), packed as node<<20 | counter. A dot names ONE action,
//                        forever. The counter is per node and must be persisted BEFORE the action is used (write-ahead), or two lives
//                        of a node can reuse a dot: a dot that comes twice is ONE action to everybody.
//   version vector 38 B  15 counters of 20 bits, big-endian, bit-packed (300 bits, 4 bits of padding): counter i is node i+1's.
//                        It includes the record's own dot (vv[node of dot] >= counter of dot).
//   timeline id    5 B   the node that started the timeline (1 B) + the mesh epoch of that node's life (4 B, the counter the mesh
//                        already persists at every boot). It names one LIFE of one node, so it is unique if the epoch was written to
//                        the flash before being used (see the trust bit).
//   mark           4 B   the time of the action inside the timeline, in ticks of 100 ms, a uint32 that wraps. Two marks are compared
//                        by the signed 32-bit difference, which is right while they are less than 6.8 years apart. (A Berry int has
//                        32 bits: it cannot hold a time in ms; the tick keeps it inside one int.)
//   trust bit      1 bit "the timeline id of this record is certainly unique": 0 when the writer could not write its epoch to the flash
//                        before using it and took a random one (unique with probability 1 - 2^-32, not for certain). Such a record is
//                        never ordered by its mark.
//   state          2 bits disarmed, armed_home, armed_away, triggered.
//   lost           1 B   the number of devices the alarm could not protect when this ARM was made ("Armed, 2 without
//                        protection"); 0 in every other action.
//
//   RECORD (stored, and sent on request)                          52 B, always
//       byte 0       flags: bits 0-1 state, bit 2 trust, bits 3-7 zero
//       bytes 1-3    dot (big-endian)         bytes 4-8    timeline id (node, then the 4-byte epoch, big-endian)
//       bytes 9-12   mark (big-endian)        byte 13      lost
//       bytes 14-51  the version vector: counters 0..14 as 20-bit fields, MSB first (two counters make 5 bytes; the 15th is 2.5)
//   THE HEADS (flash and RAM)                                     at most 15 x 52 = 780 B, usually one record (52 B); sent as the
//                        answer to a difference of digests, 4 records per frame (228 B of payload)
//   FLASH               the heads, the dot counter (4 B) and the epoch (4 B): at most 788 B, usually 60
//   HEARTBEAT PART      19 B of the 32 the application has in the heartbeat (the first design said "about 6 bytes" for the time)
//       bytes 0-4    timeline id            bytes 5-10   mesh time: milliseconds in 48 bits (8 900 years, it never wraps)
//       bytes 11-14  digest of the heads    bytes 15-17  the applied dot (the last state this bridge applied in all its devices)
//       byte 18      flags: bit 0 synced, bits 1-4 the number of heads
//       The digest is the FNV-1a (32 bits) of, for each head in the order of its dot, its dot (3 B), timeline id (5 B) and mark (4 B).
//       A neighbour whose digest differs asks for the heads: the digest covers the timeline and the mark so that two replicas that
//       hold the same action written in two timelines (one translated it, the other not yet) still exchange it.
//   COMMAND STAMP (the freshness window)   6 B: 4 B issue time (ticks of 10 ms of the issuer's mesh time, wraps in 497 days)
//       + 2 B tag of the issuer's timeline id.
//
// THE ORDER OF THE OPERATIONS (what the port does, in this order; whatever comes before "persist" is lost in a power cut):
//   boot        read the persisted heads, the dot counter and the epoch; epoch += 1 and WRITE it before use (if the write fails take a
//               random 32-bit epoch for this life, leave the saved counter alone, and clear the trust bit for this whole life); timeline = [id, epoch], off = 0, not adopted; the version
//               vector of the node = the join of the heads' vectors, with its own counter at least the persisted one; synced only
//               after LISTEN_MS (or on adopting); the bridge forgets what its devices confirmed and applies nothing.
//   heartbeat   (every 5 s, from every neighbour) hear(): the TIMELINE rule, THEN, if the sender's digest is not mine, ask for its heads.
//   copies      take(): the union of my heads and theirs; the same action in two forms keeps the larger mark; every head that another
//               one descends from goes; persist the heads if they changed (before applying anything or answering); join the vectors.
//   an action   a person arms or disarms, a sensor trips: counter += 1 and persist it, THEN build the record (dot, vector = the node's
//               vector with its own counter, timeline, mark, trust, lost), persist it as the only head (it descends from every head
//               the node held), publish it. Never build first.
//   the state   resolve(): the pairwise rule folded over the heads in the order of their dots; reconcile and the glass use it.
//   reconcile   every RECONCILE_MS, only when synced: the desired state is the resolved record; command the devices that are not
//               confirmed, repeat until they confirm, publish the applied dot (in the heartbeat) once all of them did.
//   a command   admitCommand(): synced, same timeline, not older than FRESH_WINDOW_MS, not from the future.
//
// WHAT THE BERRY PORT MUST KNOW. A Berry int is 32 bits: the 48-bit mesh time, the 36-bit timeline id,
// the epoch comparison and the digest belong to the C side of the mesh (it already owns the clock and the heartbeat); the alarm layer
// gets, from it, the current mark (a uint32 in 100 ms ticks), the timeline id as 5 bytes, and an event "adopted a new timeline,
// translate by N ticks". Everything the alarm does with them is an equality or a signed 32-bit difference, so it fits. The dot is one
// int (node<<20 | counter) and a counter of the vector is one int of 20 bits: "descends" is one comparison of two ints. The digest is
// only compared for equality between replicas, so the hash is the reference's choice, fixed once made.
//
// WHAT THE CORRECTION DOES NOT CLOSE (alarm-merge.test.mjs says where each is tested):
//   - the relative clock is as good as the drift since the two sides last heard each other: up to 7 s per day apart at 80 ppm between
//     two crystals, so two concurrent actions seconds apart after days of isolation can be put in the wrong order, and the same action
//     translated by two nodes carries marks that differ by that much;
//   - a pair that nothing places (two timelines that are over) is still decided by the safe side, and between two armed ones by the
//     more severe mode: the state shown can be a ghost's arm_away over a later arm_home (the class, armed, is right);
//   - a record truly concurrent with the rest (S12: a disarm made in a timeline that is over) still wins, by design;
//   - the heads stay two or more until an action or a descendant arrives; the state is a function of the set, not of the last copy;
//   - two lives with the same timeline id (a random epoch that repeats: 2^-32 per boot whose flash write failed): nothing tells them
//     apart, and the nodes that adopt the younger one carry a clock that is days off (finding F3, only reachable by forcing it);
//   - the trigger counts as an arm: one made on a side that never saw the disarm, and later by the clock, wins over it;
//   - a dot counter that is not saved first, or 1 048 575 actions of one bridge (the counter is 20 bits).

export const TICK_MS = 100;               // a mark is in ticks of 100 ms
export const LISTEN_MS = 10_000;          // a node concludes it is alone after listening to the heartbeats this long (two periods)
export const ADOPT_EPS_MS = 20;           // two timelines whose ages differ by less than this (a hop of latency) are the same age: the smaller id wins, the same way on both sides
export const RESYNC_MAX_MS = 3_600_000;   // inside one timeline a node follows a larger mesh time only up to this much (a drift of days of isolation, not a different life)
export const STAMP_TICK_MS = 10;          // the command stamp is in ticks of 10 ms
export const FRESH_WINDOW_MS = 3_000;     // the owner refuses a command with more than this age
export const FUTURE_TOLERANCE_MS = 250;   // a stamp this far ahead is the error between two nodes' relative clocks; more is refused
export const RECONCILE_MS = 3_000;        // a bridge repeats what it has not seen confirmed every few seconds
export const SIREN_MS = 300_000;          // a siren has its own time (the alarm's configured siren time; 5 min by default)
export const MAX_NODE = 15;
export const MAX_HEADS = 15;              // one per bridge: a node's later action descends its earlier ones
export const MAX_COUNTER = 0xfffff;
export const VV_BYTES = 38;
export const RECORD_BYTES = 14 + VV_BYTES;                 // 52
export const HEADS_MAX_BYTES = MAX_HEADS * RECORD_BYTES;   // 780
export const HEARTBEAT_BYTES = 19;
export const STAMP_BYTES = 6;

export const ST = Object.freeze({ disarmed: 0, armed_home: 1, armed_away: 2, triggered: 3 });
export const ST_NAME = Object.freeze(["disarmed", "armed_home", "armed_away", "triggered"]);
export const isArmed = (st) => st !== ST.disarmed;

// --- dots: one action, named by its node and that node's counter ------------------------------------------------

export const mkDot = (node, counter) => {
  if (!(node >= 1 && node <= MAX_NODE)) throw new RangeError(`dot node ${node} is not in 1..${MAX_NODE}`);
  if (!(counter >= 1 && counter <= MAX_COUNTER)) throw new RangeError(`dot counter ${counter} is not in 1..${MAX_COUNTER}`);
  return (node << 20) | counter;
};
export const dotNode = (d) => d >>> 20;
export const dotCounter = (d) => d & MAX_COUNTER;
export const dotText = (d) => `${dotNode(d)}:${dotCounter(d)}`;
export const parseDot = (s) => { const [n, c] = s.split(":").map(Number); return mkDot(n, c); };

// --- timelines and marks --------------------------------------------------------------------------------------------

export const tlEq = (a, b) => a.n === b.n && a.e === b.e;
// a total order on timeline ids, used ONLY to break a tie nobody can break by age (two timelines of the same age)
export const tlCmp = (a, b) => (a.n - b.n) || (a.e - b.e);
export const tlText = (tl) => `${tl.n}.${tl.e}`;
export const tlTag = (tl) => ((tl.n << 8) ^ (tl.e >>> 16) ^ (tl.e & 0xffff)) & 0xffff;
export const markOf = (meshMs) => Math.floor(meshMs / TICK_MS) >>> 0;
export const markCmp = (a, b) => (a - b) | 0;            // sign of a - b, right while they are less than 2^31 ticks apart
export const markAdd = (m, ticks) => (m + ticks) >>> 0;

// --- the version vector ---------------------------------------------------------------------------------------------------

// a vector is an array of 15 counters; the sparse form {node: counter} is how the vectors of the tests write it
export const vvFrom = (sparse = {}) => { const v = new Array(MAX_NODE).fill(0); for (const [n, c] of Object.entries(sparse)) v[Number(n) - 1] = c; return v; };
export const vvSparse = (vv) => Object.fromEntries(vv.map((c, i) => [i + 1, c]).filter(([, c]) => c > 0));
export const vvJoin = (a, b) => a.map((c, i) => Math.max(c, b[i]));

// --- the record --------------------------------------------------------------------------------------------------------

// vv: an array of 15 counters, or the sparse form. The record's own dot must be a dot (node 1..15, counter 1 or more) and be in its vector.
export function mkRecord({ st, dot, vv, tl, m, trusted = true, lost = 0 }) {
  if (!(st >= 0 && st <= 3)) throw new RangeError(`state ${st}`);
  // a dot of node 0 or counter 0 names no action: a vector index of -1 is undefined, and `undefined < counter` is false, so the check of the own dot below would let it through
  if (!(dotNode(dot) >= 1 && dotNode(dot) <= MAX_NODE && dotCounter(dot) >= 1)) throw new RangeError(`dot ${dotText(dot)} is not a dot: node 1..${MAX_NODE}, counter 1..${MAX_COUNTER}`);
  const v = Array.isArray(vv) ? vv.slice() : vvFrom(vv);
  if (v.length !== MAX_NODE || v.some((c) => !(c >= 0 && c <= MAX_COUNTER))) throw new RangeError("the version vector is 15 counters of 20 bits");
  if (v[dotNode(dot) - 1] < dotCounter(dot)) throw new RangeError("the version vector does not hold the record's own dot");
  if (!(lost >= 0 && lost <= 255)) throw new RangeError(`lost ${lost}`);
  return Object.freeze({ st, dot, vv: Object.freeze(v), tl: Object.freeze({ n: tl.n, e: tl.e }), m: m >>> 0, trusted: !!trusted, lost });
}

const put24 = (out, at, v) => { out[at] = (v >>> 16) & 255; out[at + 1] = (v >>> 8) & 255; out[at + 2] = v & 255; };
const put32 = (out, at, v) => { out[at] = (v >>> 24) & 255; out[at + 1] = (v >>> 16) & 255; out[at + 2] = (v >>> 8) & 255; out[at + 3] = v & 255; };
const get24 = (b, at) => (b[at] << 16) | (b[at + 1] << 8) | b[at + 2];
const get32 = (b, at) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;

// 15 counters of 20 bits in 38 bytes: two counters make 5 bytes, the 15th makes 2.5 (the last 4 bits are zero)
function putVv(out, at, vv) {
  for (let i = 0; i < 7; i++) {
    const a = vv[2 * i], b = vv[2 * i + 1], o = at + 5 * i;
    out[o] = a >>> 12; out[o + 1] = (a >>> 4) & 255; out[o + 2] = ((a & 15) << 4) | (b >>> 16); out[o + 3] = (b >>> 8) & 255; out[o + 4] = b & 255;
  }
  const c = vv[14], o = at + 35;
  out[o] = c >>> 12; out[o + 1] = (c >>> 4) & 255; out[o + 2] = (c & 15) << 4;
}
function getVv(b, at) {
  const vv = new Array(MAX_NODE);
  for (let i = 0; i < 7; i++) {
    const o = at + 5 * i;
    vv[2 * i] = (b[o] << 12) | (b[o + 1] << 4) | (b[o + 2] >>> 4);
    vv[2 * i + 1] = ((b[o + 2] & 15) << 16) | (b[o + 3] << 8) | b[o + 4];
  }
  const o = at + 35;
  vv[14] = (b[o] << 12) | (b[o + 1] << 4) | (b[o + 2] >>> 4);
  return vv;
}

export function encodeRecord(r) {
  const out = new Uint8Array(RECORD_BYTES);
  out[0] = (r.st & 3) | (r.trusted ? 4 : 0);
  put24(out, 1, r.dot);
  out[4] = r.tl.n;
  put32(out, 5, r.tl.e);
  put32(out, 9, r.m);
  out[13] = r.lost;
  putVv(out, 14, r.vv);
  return out;
}

export function decodeRecord(b) {
  if (b.length !== RECORD_BYTES || (b[0] & 0xf8) || (b[51] & 15)) return null;
  try {
    return mkRecord({ st: b[0] & 3, dot: get24(b, 1), vv: getVv(b, 14), tl: { n: b[4], e: get32(b, 5) }, m: get32(b, 9), trusted: !!(b[0] & 4), lost: b[13] });
  } catch { return null; }
}

// The heartbeat part (19 B): what a node says of itself every period. `h` is Replica.hello(up); `applied` is the bridge's.
export function encodeHello(h, applied = 0) {
  const out = new Uint8Array(HEARTBEAT_BYTES);
  out[0] = h.tl.n;
  put32(out, 1, h.tl.e);
  const hi = Math.floor(h.mesh / 2 ** 32);
  out[5] = (hi >>> 8) & 255; out[6] = hi & 255;
  put32(out, 7, h.mesh >>> 0);                  // the low 32 bits of the 48-bit mesh time
  put32(out, 11, h.digest);
  put24(out, 15, applied);
  out[18] = (h.synced ? 1 : 0) | ((h.count & 15) << 1);
  return out;
}
export function decodeHello(b) {
  if (b.length !== HEARTBEAT_BYTES) return null;
  return { tl: { n: b[0], e: get32(b, 1) }, mesh: ((b[5] << 8) | b[6]) * 2 ** 32 + get32(b, 7), digest: get32(b, 11), applied: get24(b, 15), synced: !!(b[18] & 1), count: (b[18] >>> 1) & 15 };
}

// The command stamp (6 B): the tag of the issuer's timeline (2 B) and its mesh time in ticks of 10 ms (4 B).
export function encodeStamp(cmd) {
  const out = new Uint8Array(STAMP_BYTES);
  out[0] = (cmd.tag >>> 8) & 255; out[1] = cmd.tag & 255;
  put32(out, 2, cmd.issued);
  return out;
}
export function decodeStamp(b) { return b.length === STAMP_BYTES ? { tag: (b[0] << 8) | b[1], issued: get32(b, 2) } : null; }

export const hex = (bytes) => Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");
export const unhex = (s) => Uint8Array.from(s.match(/../g) ?? [], (x) => parseInt(x, 16));

// The digest of a set of heads (in the order of their dots): FNV-1a, 32 bits, over dot (3 B), timeline id (5 B) and mark (4 B) of each.
export function headsDigest(heads) {
  let h = 0x811c9dc5;
  const feed = (byte) => { h ^= byte; h = Math.imul(h, 0x01000193) >>> 0; };
  for (const r of heads) {
    const b = new Uint8Array(12);
    put24(b, 0, r.dot); b[3] = r.tl.n; put32(b, 4, r.tl.e); put32(b, 8, r.m);
    for (const byte of b) feed(byte);
  }
  return h >>> 0;
}

// --- the order rule: which of two copies wins --------------------------------------------------------------------

const severity = (st) => st; // triggered (3) > armed_away (2) > armed_home (1) > disarmed (0), the numbers of ST

// The SAFE SIDE. Used where the pair cannot be placed in time. A disarmed copy beats an armed one; between two copies of
// the same class it does not matter for safety, only for determinism: the more severe, then the larger dot.
export function safeSide(a, b) {
  const da = a.st === ST.disarmed, db = b.st === ST.disarmed;
  if (da !== db) return da ? a : b;
  if (severity(a.st) !== severity(b.st)) return severity(a.st) > severity(b.st) ? a : b;
  return a.dot >= b.dot ? a : b;
}

// The SAME action seen in two representations (a node translated it into an older timeline, another has not yet, or two
// nodes translated it with an error of a few ms): keep the one in the OLDER timeline. For one instant, a timeline that
// has been up longer has a LARGER mark, and a translation only ever adds time, so the larger mark is the older timeline.
export function sameActionPick(a, b) {
  const c = markCmp(a.m, b.m);
  if (c !== 0) return c > 0 ? a : b;
  return tlCmp(a.tl, b.tl) <= 0 ? a : b;
}

// y descends from x: x is in y's past (a different action, a counter of x's node that y's vector has reached)
export const descends = (y, x) => y.dot !== x.dot && y.vv[dotNode(x.dot) - 1] >= dotCounter(x.dot);

// merge(a, b) -> { win, layer }: the pairwise rule. layer is which of the three layers decided:
//   "same"    the two are the same action (same dot)
//   "descent" layer 1: one descends from the other, so it replaces it
//   "clock"   layer 2: same timeline, both marks firm, the later mark wins
//   "tie"     layer 2 with equal marks: nobody can say which is later, the safe side decides
//   "safe"    layer 3: the pair cannot be placed (different timelines, or a mark that is not firm), the safe side decides
// It is symmetric (merge(a, b).win is merge(b, a).win) and idempotent, and it is NOT associative: the three layers are not one
// order. That is why a replica does not use it to discard (only layer 1 discards) but to fold the set of heads on read.
export function merge(a, b) {
  if (a.dot === b.dot) return { win: sameActionPick(a, b), layer: "same" };
  if (descends(b, a)) return { win: b, layer: "descent" };
  if (descends(a, b)) return { win: a, layer: "descent" };
  if (tlEq(a.tl, b.tl) && a.trusted && b.trusted) {
    const c = markCmp(a.m, b.m);
    if (c !== 0) return { win: c > 0 ? a : b, layer: "clock" };
    return { win: safeSide(a, b), layer: "tie" };
  }
  return { win: safeSide(a, b), layer: "safe" };
}

// the state of a set of heads: the rule folded in the order of the dots
export function resolve(heads) {
  let acc = heads[0];
  for (let i = 1; i < heads.length; i++) acc = merge(acc, heads[i]).win;
  return acc;
}

// the heads of a set of copies: the same action in two forms keeps the larger mark, and whatever another copy descends from goes
export function headsOf(records) {
  const byDot = new Map();
  for (const r of records) { const prev = byDot.get(r.dot); byDot.set(r.dot, prev ? sameActionPick(prev, r) : r); }
  const all = [...byDot.values()];
  const heads = all.filter((h) => !all.some((g) => g !== h && descends(g, h)));
  if (heads.length === 0 || heads.length > MAX_HEADS) throw new RangeError(`${heads.length} heads: a dot was reused (the counter must be saved before use)`);
  return heads.sort((a, b) => a.dot - b.dot);
}

// --- a node's alarm replica ---------------------------------------------------------------------------------------------

// What every replica has, in the new rule and in the control of the first design: the node's own timeline and its relation to the
// others (the TIMELINE rule), which has nothing to do with the records.
export class TimelineNode {
  constructor(id, persisted) {
    this.id = id;
    this.ctr = persisted.ctr ?? 0;
    this.epoch = persisted.epoch ?? 0;
  }

  // A (re)start. The timeline is the node's own and starts at zero. `epochOk` false means the new epoch could not be written to the
  // flash before use: the node then takes `epoch`, a random 32-bit number (esp_random), for this life only: the saved counter is not
  // touched, so the next boot counts from it. A random id is unique with probability 1 - 2^-32, not for certain, so the trust bit is
  // cleared. (Reusing the old epoch instead would give the new life the id of the old one, and of a timeline the others may still be
  // in: they would adopt a clock that is days off, finding F3.)
  startLife({ epochOk = true, keepEpoch = false, epoch, tl, off } = {}) {
    let live = this.epoch;
    if (!keepEpoch) {
      if (epochOk) { this.epoch += 1; live = this.epoch; }
      else if (epoch === undefined) throw new RangeError("a boot that could not save its epoch needs a random one");
      else live = epoch >>> 0;
    }
    this.tl = tl ?? { n: this.id, e: live };
    this.off = off ?? 0;
    this.adopted = !!tl;
    this.trusted = epochOk;
    this._rebuild();
  }
  reboot(opts = {}) { this.startLife(opts); }
  _rebuild() {}
  _translate() {}

  mesh(up) { return up + this.off; }
  isSynced(up) { return this.adopted || up >= LISTEN_MS; }

  // A heartbeat arrives: the TIMELINE rule. Of two different timelines the one that has been up longer (the larger mesh
  // time now) is the timeline of both; the younger node adopts it and translates its own records into it. Inside the
  // same timeline the node only follows a slightly larger time (like the 802.11 TSF), so drift never accumulates.
  hear(h, up) {
    const d = h.mesh - this.mesh(up);
    if (tlEq(h.tl, this.tl)) {
      if (d > 0 && d <= RESYNC_MAX_MS) this.off += d;
      return { adopted: false, delta: 0 };
    }
    if (d > ADOPT_EPS_MS || (d >= -ADOPT_EPS_MS && tlCmp(h.tl, this.tl) < 0)) {
      const old = this.tl;
      this.off += d;
      this.tl = { ...h.tl };
      this.adopted = true;
      this._translate(old, d);
      return { adopted: true, delta: d };
    }
    return { adopted: false, delta: 0 };
  }
}

export class Replica extends TimelineNode {
  // persisted: { heads (or rec: one), ctr, epoch }. These survive a restart: the heads, the node's own dot counter, the mesh epoch.
  // Everything else is volatile and rebuilt by startLife(). A replica that is already part of a timeline (the steady state of a house
  // that has been up) also gets { tl, off } and starts adopted.
  constructor(id, persisted) {
    super(id, persisted);
    this._set(persisted.heads ?? [persisted.rec]);
    this.startLife({ epochOk: true, keepEpoch: true, tl: persisted.tl, off: persisted.off });
  }

  _set(heads) { this.heads = heads.slice().sort((a, b) => a.dot - b.dot); this._rec = null; }
  get rec() { return (this._rec ??= resolve(this.heads)); }
  get state() { return ST_NAME[this.rec.st]; }

  // the version vector of the node: what the heads have in their past, and the node's own counter
  _rebuild() {
    this.vv = this.heads.reduce((v, h) => vvJoin(v, h.vv), new Array(MAX_NODE).fill(0));
    this.vv[this.id - 1] = Math.max(this.vv[this.id - 1], this.ctr);
  }

  hello(up) { return { tl: { ...this.tl }, mesh: this.mesh(up), digest: headsDigest(this.heads), count: this.heads.length, synced: this.isSynced(up) }; }

  // What this node did while it was on the old timeline moves with it: its heads that are in the timeline just left are rewritten into
  // the new one, with the difference of the two times added to their marks.
  _translate(old, d) {
    this._set(this.heads.map((h) => (tlEq(h.tl, old) ? mkRecord({ ...h, tl: this.tl, m: markAdd(h.m, Math.round(d / TICK_MS)) }) : h)));
  }

  // What this node sends a neighbour whose digest differs from its own.
  offer() { return this.heads.slice(); }
  // what two replicas must have equal to hold the same copies: the actions, and the timeline and mark each is written in
  sig() { return this.heads.map((h) => `${h.dot}|${h.tl.n}.${h.tl.e}|${h.m}`).join(";"); }

  // Copies of a neighbour arrive (the answer to a difference of digests). Returns what happened.
  take(list) {
    const before = this.sig();
    const incoming = Array.isArray(list) ? list : [list];
    this._set(headsOf([...this.heads, ...incoming]));
    for (const r of incoming) this.vv = vvJoin(this.vv, r.vv);
    return { changed: this.sig() !== before, layer: this.heads.length > 1 ? "heads" : "descent", win: this.rec };
  }

  // A person (or a sensor, for a trigger) acts here. `up` is this node's uptime. Write-ahead: the counter is saved before the record
  // exists. The new record descends from every head the node holds (its vector is the node's), so it is the only head. opts.lost is the count of who was left out.
  act(kind, up, opts = {}) {
    const st = ST[kind];
    if (st === undefined) throw new RangeError(`unknown action ${kind}`);
    if (this.ctr >= MAX_COUNTER) throw new RangeError("the dot counter is exhausted");
    this.ctr += 1;
    const dot = mkDot(this.id, this.ctr);
    this.vv[this.id - 1] = this.ctr;
    const rec = mkRecord({ st, dot, vv: this.vv, tl: this.tl, m: markOf(this.mesh(up)), trusted: this.trusted, lost: opts.lost ?? 0 });
    this._set([rec]);
    return rec;
  }

  // what the vectors of the tests record of a node
  describe() {
    const r = this.rec;
    return { state: ST_NAME[r.st], dot: dotText(r.dot), timeline: tlText(r.tl), mark: r.m, trusted: r.trusted, lost: r.lost, vv: vvSparse(r.vv), heads: this.heads.map((h) => dotText(h.dot)), wire: hex(encodeRecord(r)) };
  }
}

// A replica in the steady state of a house that has been up together (the starting point of the 12 situations and of
// the random runs): one timeline (node 1, epoch 1) that all share, the same initial record in it.
export const HOUSE_TIMELINE = Object.freeze({ n: 1, e: 1 });
export const BASE_UP_MS = 10_000_000;     // the house has been up 10 000 s when the story starts (true time 0)
export function baseRecord(st) {
  return mkRecord({ st: ST[st], dot: mkDot(1, 1), vv: { 1: 1 }, tl: HOUSE_TIMELINE, m: markOf(BASE_UP_MS + 80_000) });
}
export function steadyReplica(id, st) {
  return new Replica(id, { rec: baseRecord(st), ctr: id === 1 ? 1 : 0, epoch: 1, tl: HOUSE_TIMELINE, off: 0 });
}

// --- the freshness window of a command ------------------------------------------------------------------------
// A command that comes through the mesh carries the issuer's mesh time (and a tag of its timeline). The OWNER of the device,
// when it is synced, refuses what is older than FRESH_WINDOW_MS: what sat in a TCP buffer, what a broker retained, a frame
// someone recorded off the air. This is not a defence against a replay INSIDE the window: the mesh's counter window does that.

export function stampCommand(origin, up, body) {
  if (!origin.isSynced(up)) return null;                                 // an origin that is not synced issues no stamp
  return { origin: origin.id, tag: tlTag(origin.tl), issued: Math.floor(origin.mesh(up) / STAMP_TICK_MS) >>> 0, body };
}

export function admitCommand(owner, cmd, up) {
  if (!owner.isSynced(up)) return { ok: false, reason: "owner-not-synced" };                  // an owner that is not synced refuses everything
  if (cmd.tag !== tlTag(owner.tl)) return { ok: false, reason: "other-timeline" };            // the stamp means nothing in another timeline
  const now = Math.floor(owner.mesh(up) / STAMP_TICK_MS) >>> 0;
  const ageMs = ((now - cmd.issued) | 0) * STAMP_TICK_MS;
  if (ageMs > FRESH_WINDOW_MS) return { ok: false, reason: "stale", ageMs };
  if (ageMs < -FUTURE_TOLERANCE_MS) return { ok: false, reason: "from-the-future", ageMs };
  return { ok: true, reason: "ok", ageMs };
}

// A command that comes from OUTSIDE the mesh (an MQTT message, the home automation) has no mesh stamp: the bridge that takes it
// would stamp it on arrival, and a stamp made on arrival measures nothing. A retained message is therefore refused here, by its
// retain flag, and not by the window.
export function admitFromOutside(bridge, up, msg) {
  if (msg.retained) return { ok: false, reason: "retained" };
  if (!bridge.isSynced(up)) return { ok: false, reason: "owner-not-synced" };
  return { ok: true, cmd: stampCommand(bridge, up, msg.body) };
}

// --- the desired state, reconciled by each bridge, and the reach -----------------------------------------------
// The alarm does not send "sound the siren" once. The DESIRED state is the replicated record (the state of the heads); every bridge
// reconciles it with the devices it owns, repeating every RECONCILE_MS until each device confirms, and publishes the dot it has fully
// APPLIED. The reach is how many owner bridges have applied the current dot.

export class Bridge {
  // devices: [{ id, kind: "siren" | "sensor" }]. A sensor only needs the bridge's own logic (always confirmed); a siren needs the
  // radio command and its confirmation. The replica only needs `rec` (the desired state) and `isSynced(up)`.
  constructor(replica, devices, { sirenMs = SIREN_MS } = {}) {
    this.replica = replica;
    this.devices = devices.map((d) => ({ ...d, on: null }));   // on: what the bridge last saw CONFIRMED (null: unknown, so the first pass always asserts the target)
    this.sirenMs = sirenMs;
    this.applied = 0;                       // the last dot applied in ALL the devices (0: none yet). Volatile: a restart re-applies.
    this.since = new Map();                 // dot -> this node's uptime when it first applied a triggered record in this life
  }
  restart() { this.applied = 0; this.since.clear(); for (const d of this.devices) d.on = null; }   // the devices keep their state; the bridge no longer knows it

  // One reconcile pass at uptime `up`. drive(device, wantOn) sends the command and returns true only if the device CONFIRMED.
  // Returns { held, sent, pending }. A bridge that is not synced HOLDS: it neither changes nor executes anything from the
  // copy it carries: an armed alarm stays armed, nothing disarms by itself.
  reconcile(up, drive) {
    const r = this.replica;
    if (!r.isSynced(up)) return { held: true, sent: 0, pending: 0 };
    const rec = r.rec;
    if (rec.st === ST.triggered && !this.since.has(rec.dot)) this.since.set(rec.dot, up);
    const expired = rec.st === ST.triggered && up - this.since.get(rec.dot) >= this.sirenMs;   // the siren's own time
    const wantOn = rec.st === ST.triggered && !expired;
    let sent = 0, pending = 0;
    for (const dev of this.devices) {
      if (dev.kind !== "siren" || dev.on === wantOn) continue;
      sent++;
      if (drive(dev, wantOn)) dev.on = wantOn; else pending++;
    }
    if (pending === 0) this.applied = rec.dot;
    return { held: false, sent, pending };
  }
  hasSounding() { return this.devices.some((d) => d.kind === "siren" && d.on); }
}

// The reach of the current dot over the bridges that own devices of the alarm. `appliedBy` is what this viewer knows of the
// others (Map bridge id -> applied dot, only for the ones it hears); a missing one counts as out of reach.
export function reachOf(curDot, owners, appliedBy) {
  const confirmed = owners.filter((id) => appliedBy.get(id) === curDot);
  const missing = owners.filter((id) => appliedBy.get(id) !== curDot);
  return { total: owners.length, confirmed: confirmed.length, missing, complete: missing.length === 0 };
}

const LABEL = ["Disarmed", "Armed home", "Armed away", "Triggered"];
// What the glass says. It never says "Armed" or "Disarmed" in full without every owner confirming.
export function headline(rec, reach) {
  const lost = rec.st !== ST.disarmed && rec.lost > 0 ? `, ${rec.lost} without protection` : "";
  if (reach.complete) return { kind: "complete", text: `${LABEL[rec.st]}, ${reach.confirmed} of ${reach.total}${lost}` };
  const out = reach.missing.length;
  if (rec.st === ST.armed_home || rec.st === ST.armed_away) {
    return { kind: "partial", text: `Armed only here${lost}`, unprotected: reach.missing.slice() };
  }
  return { kind: "partial", text: `${LABEL[rec.st]} here, ${out} part${out === 1 ? "" : "s"} out of reach`, missing: reach.missing.slice() };
}
