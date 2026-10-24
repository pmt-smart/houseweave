/*
 * The ESP-NOW mesh core of the firmware (espnow_mesh_core.h), compiled from its own
 * source, for a host that runs many nodes over a simulated air.
 *
 * Every node is one slot of this module, so a house of fourteen is one instance and
 * the page, or a test, carries the frames between them. The core keeps no clock: each
 * call says what time it is. The tag the nodes put on their frames and the proof a sync
 * answer carries are keyed hashes of no cryptographic worth, which is enough to tell a
 * frame from a stranger's here; what the firmware computes is a matter of the radio task
 * that calls the core. A node's address here is its number in the last of six bytes.
 */
#include <emscripten.h>
#include <stdint.h>
#include <string.h>
#include "espnow_mesh_core.h"
#include "espnow_mesh_crypto.h"

using namespace EspNowMesh;

#define SIM_NODES 64

struct SimNode {
  Node node;
  Crypto crypto;
  uint32_t rng;
  uint8_t self;
  bool real;
  bool declineEpoch;                           // the application says no when the node asks for the next epoch
  bool wantsEpoch;                             // and the node has asked
};

static SimNode nodes[SIM_NODES];

// The network's key every node with the real cipher starts with: a host that gives them another sets it (mesh_key_set)
static void sim_group_key(int seed, uint8_t key[32]) {
  for (int i = 0; i < 32; i++) key[i] = (uint8_t)(0xa0 + i * 3 + seed * 7);
}

static uint32_t sim_random(void *context) {
  uint32_t *s = (uint32_t *)context;
  uint32_t x = *s;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  *s = x;
  return x;
}

static const uint8_t kHouseKey[4] = {0x5a, 0xc3, 0x96, 0x1f};

static uint64_t fnv(uint64_t h, const uint8_t *data, size_t len) {
  for (size_t i = 0; i < len; i++) { h ^= data[i]; h *= 0x100000001b3ULL; }
  return h;
}

// FNV-1a over the key and the bytes, 64 bits
static void sim_tag(const uint8_t *data, size_t len, uint8_t tag[kTagLen], void *context) {
  (void)context;
  uint64_t h = fnv(0xcbf29ce484222325ULL, kHouseKey, sizeof(kHouseKey));
  h = fnv(h, data, len);
  for (int i = 0; i < 8; i++) tag[i] = (uint8_t)(h >> (8 * i));
}

// the proof is of the pair, whichever of the two computes it
static void sim_proof(void *context, uint8_t peer, uint32_t nonce, uint32_t epoch, uint32_t counter, uint8_t proof[8]) {
  uint8_t self = *(uint8_t *)context;
  uint8_t pair[2] = {self < peer ? self : peer, self < peer ? peer : self};
  uint8_t words[12];
  Put32(words, nonce);
  Put32(words + 4, epoch);
  Put32(words + 8, counter);
  uint64_t h = fnv(0xcbf29ce484222325ULL, kHouseKey, sizeof(kHouseKey));
  h = fnv(h, pair, 2);
  h = fnv(h, words, sizeof(words));
  for (int i = 0; i < 8; i++) proof[i] = (uint8_t)(h >> (8 * i));
}

// The cipher of the nodes here has the shape of the firmware's and none of its strength: a stream of FNV-1a over a key, the nonce
// (origin, epoch, counter) and the position, and, for a frame for one node, a tag of FNV-1a over the key, the header and the
// ciphertext. The key of a pair is the network's secret and the two numbers, so only the two have it; a number above 100 has no key
static const uint8_t kGroupKey[4] = {0x71, 0x2b, 0xd4, 0x08};

static void sim_key(uint8_t self, uint8_t peer, uint8_t key[8]) {
  if (peer == 0) {
    memcpy(key, kGroupKey, 4);
    memset(key + 4, 0, 4);
    return;
  }
  memcpy(key, kHouseKey, 4);
  key[4] = self < peer ? self : peer;
  key[5] = self < peer ? peer : self;
  key[6] = 0x5a;
  key[7] = 0xa5;
}

static void sim_stream(const uint8_t key[8], const uint8_t header[kHeaderLen], const uint8_t *in, size_t len, uint8_t *out) {
  uint8_t nonce[9];
  nonce[0] = header[2];
  memcpy(nonce + 1, header + 6, 8);
  uint64_t h = 0;
  for (size_t i = 0; i < len; i++) {
    if (i % 8 == 0) {
      uint8_t pos = (uint8_t)(i / 8);
      h = fnv(fnv(fnv(0xcbf29ce484222325ULL, key, 8), nonce, sizeof(nonce)), &pos, 1);
    }
    out[i] = in[i] ^ (uint8_t)(h >> (8 * (i % 8)));
  }
}

static void sim_pair_tag(const uint8_t key[8], const uint8_t header[kHeaderLen], const uint8_t *ct, size_t len, uint8_t tag[kPairTagLen]) {
  uint64_t h = fnv(fnv(0xcbf29ce484222325ULL, key, 8), header, kHeaderLen);
  h = fnv(h, ct, len);
  for (int i = 0; i < 8; i++) tag[i] = (uint8_t)(h >> (8 * i));
}

static size_t sim_seal(void *context, uint8_t peer, const uint8_t header[kHeaderLen], const uint8_t *in, size_t len, uint8_t *out) {
  if (peer > 100) return 0;
  uint8_t key[8];
  sim_key(*(uint8_t *)context, peer, key);
  sim_stream(key, header, in, len, out);
  if (peer == 0) return len;
  sim_pair_tag(key, header, out, len, out + len);
  return len + kPairTagLen;
}

static int sim_open(void *context, uint8_t peer, const uint8_t header[kHeaderLen], const uint8_t *in, size_t len, uint8_t *out) {
  if (peer > 100) return -1;
  uint8_t key[8];
  sim_key(*(uint8_t *)context, peer, key);
  if (peer == 0) {
    sim_stream(key, header, in, len, out);
    return (int)len;
  }
  if (len < kPairTagLen) return -1;
  size_t n = len - kPairTagLen;
  uint8_t tag[kPairTagLen];
  sim_pair_tag(key, header, in, n, tag);
  uint8_t diff = 0;
  for (size_t i = 0; i < kPairTagLen; i++) diff |= tag[i] ^ in[n + i];
  if (diff != 0) return -1;
  sim_stream(key, header, in, n, out);
  return (int)n;
}

// the application of the node is asked for the next epoch: it keeps it (nothing to keep here) and says yes, or it is made to say no
static bool sim_renew_epoch(void *context, uint32_t epoch) {
  (void)epoch;
  SimNode *s = (SimNode *)context;
  s->wantsEpoch = true;
  return !s->declineEpoch;
}

static uint8_t sim_node_of(void *context, const uint8_t mac[6]) {
  (void)context;
  return mac[5];
}

extern "C" {

EMSCRIPTEN_KEEPALIVE void mesh_begin(int slot, int id, uint32_t epoch, uint32_t seed, int tagged, int weak_dbm, int suppress_at, uint32_t beat_ms, int noise_limit, int cipher, int udp_only, int udp_relay,
                                     int start_sync, int start_slot_ms, int start_jitter_ms, int answers_per_second, int choose_relays, int relay_backup_ms, int relay_drop_at, int relay_min_neighbors, int decline_epoch, int clock, int keys, int route_unicast) {
  SimNode &s = nodes[slot];
  s.declineEpoch = decline_epoch != 0;
  s.wantsEpoch = false;
  s.rng = seed != 0 ? seed : 2463534242u;
  s.self = (uint8_t)id;
  Config c;
  memset(&c, 0, sizeof(c));
  c.id = (uint8_t)id;
  c.epoch = epoch;
  c.random = sim_random;
  c.context = &s.rng;
  c.tag = tagged ? sim_tag : nullptr;
  c.proof = tagged ? sim_proof : nullptr;
  c.proofContext = &s.self;
  c.nodeOf = sim_node_of;
  c.weakDbm = (int8_t)weak_dbm;
  c.suppressAt = (uint8_t)suppress_at;
  c.beatEveryMs = beat_ms;
  c.udpOnly = udp_only != 0;
  c.udpRelay = udp_relay != 0;
  c.seal = cipher == 1 ? sim_seal : nullptr;
  c.open = cipher == 1 ? sim_open : nullptr;
  c.cipherContext = &s.self;
  c.noiseLimit = (uint8_t)noise_limit;
  c.noStartSync = start_sync == 0;
  c.startSlotMs = (uint16_t)start_slot_ms;
  c.startJitterMs = (uint16_t)start_jitter_ms;
  c.answersPerSecond = (uint8_t)answers_per_second;
  c.chooseRelays = choose_relays != 0;
  c.routeUnicast = route_unicast != 0;
  c.relayBackupMs = (uint16_t)relay_backup_ms;
  c.relayDropAt = (uint8_t)relay_drop_at;
  c.relayMinNeighbors = (uint8_t)relay_min_neighbors;
  c.renewEpoch = sim_renew_epoch;
  c.renewContext = &s;
  c.clock = clock != 0;
  s.real = cipher == 2;
  if (cipher == 2) {
    // the real keys and cipher: the identity is the node's number and no more, so that a restart keeps it, and the
    // network's key is one for all the nodes here
    uint8_t secret[32];
    for (int i = 0; i < 32; i++) secret[i] = (uint8_t)(id * 37 + i * 11 + 5);
    s.crypto.Begin(secret);
    uint8_t group[32];
    sim_group_key(0, group);
    s.crypto.SetGroupKey(group, 1);
    c.tag = Crypto::Tag;
    c.tagContext = &s.crypto;
    c.tagPrevious = Crypto::TagPrevious;
    c.proof = Crypto::Proof;
    c.proofContext = &s.crypto;
    c.seal = Crypto::Seal;
    c.open = Crypto::Open;
    c.cipherContext = &s.crypto;
  }
  s.node.Begin(c);
  // a node that says which key it holds (the version of the first is 1)
  if (cipher == 2 && keys != 0) s.node.SetKeyState(1, false, false, 0);
}

// The keys of a node with the real cipher, as a flash that held them at a start would give them: the key in use, 32 bytes and a version, and the previous
// key, when there is one (a version of 0 for none). No time is given for the change to reach the others: it is a start, not a change
EMSCRIPTEN_KEEPALIVE void mesh_key_set(int slot, const uint8_t *key, int version, const uint8_t *previous_key, int previous_version) {
  SimNode &s = nodes[slot];
  s.crypto.SetGroupKey(key, (uint8_t)version);
  if (previous_version != 0) s.crypto.SetPreviousGroupKey(previous_key, (uint8_t)previous_version);
  else s.crypto.ForgetPreviousGroupKey();
  s.node.SetKeyState((uint8_t)version, previous_version != 0, false, 0);
}

// The network's key changes at the node: the one it had is the previous, and the change has its time to reach the others from `now`
EMSCRIPTEN_KEEPALIVE void mesh_key_change(int slot, const uint8_t *key, int version, uint32_t now) {
  SimNode &s = nodes[slot];
  s.crypto.ChangeGroupKey(key, (uint8_t)version);
  s.node.SetKeyState((uint8_t)version, true, true, now);
}

// The change is closed at the node: the previous key is let go
EMSCRIPTEN_KEEPALIVE void mesh_key_close(int slot, uint32_t now) {
  SimNode &s = nodes[slot];
  s.crypto.ForgetPreviousGroupKey();
  s.node.SetKeyState(s.node.KeyVersion(), false, false, now);
}

// What the node holds and says of the keys at `now`: the version in use, whether it holds a previous key, whether the change is still in its time, whether it
// needs the key, the version of the previous key (0: none), the version the crypto holds in use
EMSCRIPTEN_KEEPALIVE int mesh_key_state(int slot, uint32_t now, uint8_t *out) {
  SimNode &s = nodes[slot];
  out[0] = s.node.KeyVersion();
  out[1] = s.node.HoldsPreviousKey() ? 1 : 0;
  out[2] = s.node.Converging(now) ? 1 : 0;
  out[3] = s.node.NeedsKey(now) ? 1 : 0;
  out[4] = s.crypto.PreviousGroupVersion();
  out[5] = s.crypto.GroupVersion();
  return 6;
}

EMSCRIPTEN_KEEPALIVE uint32_t mesh_send(int slot, int type, int dest, const uint8_t *payload, int len, int ack, uint32_t now, int previous) {
  return nodes[slot].node.Send((Type)type, (uint8_t)dest, payload, (size_t)len, ack != 0, now, previous != 0);
}

EMSCRIPTEN_KEEPALIVE uint32_t mesh_send_routed(int slot, int type, int dest, const uint8_t *payload, int len, uint32_t now) {
  return nodes[slot].node.SendRouted((Type)type, (uint8_t)dest, payload, (size_t)len, now);
}

EMSCRIPTEN_KEEPALIVE int mesh_receive(int slot, const uint8_t *data, int n, const uint8_t *src, int rssi, uint32_t now, int udp) {
  return (int)nodes[slot].node.OnReceive(data, (size_t)n, src, (int8_t)rssi, now, udp != 0);
}

// the next frame to send, and to whom (six bytes at `to`), the ways to take and the node the network sends it to (two bytes at `meta`); returns the length, or 0
EMSCRIPTEN_KEEPALIVE int mesh_next_tx(int slot, uint32_t now, uint8_t *out, uint8_t *to, uint8_t *meta) {
  size_t len = 0;
  uint8_t paths = 0, target = 0;
  bool got = nodes[slot].node.NextTx(now, out, &len, to, &paths, &target);
  meta[0] = paths;
  meta[1] = target;
  return got ? (int)len : 0;
}

// the network is up for the node, or it is not
EMSCRIPTEN_KEEPALIVE void mesh_set_udp(int slot, int up) { nodes[slot].node.SetUdpUp(up != 0); }

EMSCRIPTEN_KEEPALIVE void mesh_tx_done(int slot, int ok, uint32_t now) { nodes[slot].node.TxDone(ok != 0, now); }

EMSCRIPTEN_KEEPALIVE void mesh_tick(int slot, uint32_t now) { nodes[slot].node.Tick(now); }

// when something will be ready to send, or -1
EMSCRIPTEN_KEEPALIVE double mesh_next_due(int slot) {
  uint32_t due = 0;
  return nodes[slot].node.NextDue(&due) ? (double)due : -1.0;
}

// A delivery as bytes: origin, type, flags (1 ack, 2 retry, 4 under the previous key), part, attempt, dest, len, rssi, epoch(4), counter(4), from(6), joins(4), behind, payload.
// Returns the length, or 0 when the inbox is empty
EMSCRIPTEN_KEEPALIVE int mesh_pop(int slot, uint8_t *out) {
  Delivery d;
  if (!nodes[slot].node.PopDelivery(&d)) return 0;
  out[0] = d.origin;
  out[1] = (uint8_t)d.type;
  out[2] = (d.ackRequested ? 1 : 0) | (d.retry ? 2 : 0) | (d.previousKey ? 4 : 0);
  out[3] = d.part;
  out[4] = d.attempt;
  out[5] = d.dest;
  out[6] = d.len;
  out[7] = (uint8_t)d.rssi;
  Put32(out + 8, d.epoch);
  Put32(out + 12, d.counter);
  memcpy(out + 16, d.from, 6);
  Put32(out + 22, d.joins);
  out[26] = d.behind;
  memcpy(out + 27, d.payload, d.len);
  return 27 + d.len;
}

// An outcome as bytes: counter(4), dest, ok, attempts. 0 when there is none
EMSCRIPTEN_KEEPALIVE int mesh_pop_outcome(int slot, uint8_t *out) {
  Outcome o;
  if (!nodes[slot].node.PopOutcome(&o)) return 0;
  Put32(out, o.counter);
  out[4] = o.dest;
  out[5] = o.ok ? 1 : 0;
  out[6] = o.attempts;
  return 7;
}

EMSCRIPTEN_KEEPALIVE void mesh_synced(int slot, int origin, uint32_t epoch, uint32_t counter) {
  nodes[slot].node.SetSynced((uint8_t)origin, epoch, counter);
}

EMSCRIPTEN_KEEPALIVE int mesh_request_sync(int slot, int target, uint32_t now) {
  return nodes[slot].node.RequestSync((uint8_t)target, now) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE int mesh_wants_sync(int slot) { return nodes[slot].node.WantsSync(); }

EMSCRIPTEN_KEEPALIVE int mesh_knows(int slot, int origin) { return nodes[slot].node.Knows((uint8_t)origin) ? 1 : 0; }

// the counters, in the order of Stats
EMSCRIPTEN_KEEPALIVE uint32_t mesh_stat(int slot, int which) {
  const Stats &s = nodes[slot].node.stats();
  const uint32_t all[] = {s.heard, s.bad, s.repeated, s.replayed, s.stale, s.unsynced, s.delivered, s.inboxFull,
                          s.sentOwn, s.sentRelay, s.suppressed, s.queueFull,
                          s.acksSent, s.acksHeard, s.resent, s.gaveUp, s.noRoute, s.hopFailed, s.syncAsked, s.syncDone, s.syncBad,
                          s.beatsSent, s.beatsHeard, s.pings, s.probes, s.rescued, s.verdictsSent, s.verdictsHeard, s.noiseSent, s.keptAsOnlyWay,
                          s.partsSent, s.piecesSent, s.piecesNew, s.piecesRepeated, s.naksSent, s.bulkDone, s.bulkLost,
                          s.noKey, s.cipherBad, s.udpSent, s.udpHeard, s.covered, s.syncShed, s.startAsks,
                          s.relayHeld, s.counterOut, s.epochRenewed,
                          s.clockSteps, s.timelinesTaken, s.clockEventsLost,
                          s.prevKeyHeard, s.prevKeyDropped, s.routed, s.routeFlooded};
  return which >= 0 && which < (int)(sizeof(all) / sizeof(all[0])) ? all[which] : 0;
}

EMSCRIPTEN_KEEPALIVE int mesh_busy(int slot) { return nodes[slot].node.Busy() ? 1 : 0; }

EMSCRIPTEN_KEEPALIVE int mesh_queued(int slot) { return (int)nodes[slot].node.queued(); }

EMSCRIPTEN_KEEPALIVE int mesh_waiting(int slot) { return (int)nodes[slot].node.waiting(); }

// the neighbour a frame for `origin` is sent to; 1 and the six bytes, or 0
EMSCRIPTEN_KEEPALIVE int mesh_route_to(int slot, int origin, uint8_t *via) {
  return nodes[slot].node.RouteTo((uint8_t)origin, via) ? 1 : 0;
}

// the neighbour a frame of this node's for `dest` goes to next (Node::NextHop), and how in the bits 8 to 15: 1 dest itself, 2 a neighbour that lists it,
// 3 the way back; 0 when none
EMSCRIPTEN_KEEPALIVE int mesh_next_hop(int slot, int dest, uint32_t now) {
  uint8_t how = 0;
  uint8_t next = nodes[slot].node.NextHop((uint8_t)dest, now, &how);
  return next | (how << 8);
}

// a message in two parts; 1 and the two counters (8 bytes at `counters`) when it went, 0 when it did not
EMSCRIPTEN_KEEPALIVE int mesh_send_parts(int slot, int type, int dest, const uint8_t *payload, int len, int ack, uint32_t now, uint8_t *counters) {
  uint32_t c[2] = {0, 0};
  bool ok = nodes[slot].node.SendParts((Type)type, (uint8_t)dest, payload, (size_t)len, ack != 0, now, c);
  Put32(counters, c[0]);
  Put32(counters + 4, c[1]);
  return ok ? 1 : 0;
}

// a piece of a bulk transfer; the counter, or 0
EMSCRIPTEN_KEEPALIVE uint32_t mesh_send_bulk_piece(int slot, int dest, int id, int index, int total, const uint8_t *data, int len, uint32_t now) {
  return nodes[slot].node.SendBulkPiece((uint8_t)dest, (uint16_t)id, (uint8_t)index, (uint8_t)total, data, (size_t)len, now);
}

// the bytes every heartbeat of the node carries for the application
EMSCRIPTEN_KEEPALIVE void mesh_set_info(int slot, const uint8_t *info, int len) { nodes[slot].node.SetBeatInfo(info, (size_t)len); }

// whether the frames for the application are taken (the driver's ready gate): a node that is not ready refuses the ones for it alone as a full inbox does
EMSCRIPTEN_KEEPALIVE void mesh_set_deliver(int slot, int on) { nodes[slot].node.SetDeliverEnabled(on != 0); }

EMSCRIPTEN_KEEPALIVE int mesh_deliver_enabled(int slot) { return nodes[slot].node.DeliverEnabled() ? 1 : 0; }

// A neighbour as bytes: id, state, listsMe, rssi, theirRssi, mac(6), lastHeard(4), beatAt(4), hearsCount, hears..., infoLen, info..., then
// the delivery of its heartbeats in percent (255 not judged), whether it has chosen this node to repeat for it (0 not known, 1, 2), usable (0, 1), the skew of its clock
// (2), whether it has a clock, whether it has no radio, the version of the key its heartbeat says it sends with and the key bits.
// Returns the length, or 0 when the slot holds none
EMSCRIPTEN_KEEPALIVE int mesh_neighbor(int slot, int i, uint8_t *out, uint32_t now) {
  const Neighbor *n = nodes[slot].node.NeighborAt((unsigned)i);
  if (n == nullptr) return 0;
  int at = 0;
  out[at++] = n->id;
  out[at++] = n->state;
  out[at++] = n->listsMe;
  out[at++] = (uint8_t)n->rssi;
  out[at++] = (uint8_t)n->theirRssi;
  memcpy(out + at, n->mac, 6);
  at += 6;
  Put32(out + at, n->lastHeard);
  at += 4;
  Put32(out + at, n->beatAt);
  at += 4;
  out[at++] = n->hearsCount;
  memcpy(out + at, n->hears, n->hearsCount);
  at += n->hearsCount;
  out[at++] = n->infoLen;
  memcpy(out + at, n->info, n->infoLen);
  at += n->infoLen;
  out[at++] = nodes[slot].node.LinkQuality(*n, now);
  out[at++] = n->selectsMe;
  out[at++] = nodes[slot].node.Usable(*n, now) ? 1 : 0;
  out[at++] = (uint8_t)n->clockSkew;
  out[at++] = (uint8_t)((uint16_t)n->clockSkew >> 8);
  out[at++] = n->clockSeen;
  out[at++] = n->noRadio ? 1 : 0;
  out[at++] = n->keyVersion;
  out[at++] = n->keyBits;
  out[at++] = nodes[slot].node.SendQuality(*n, now);
  return at;
}

// The clock of the node at `now`: synced, adopted, the timeline (5), the mesh time in ms (low 32 bits, then the high), the version of the clock (4) and the tag
// of the timeline (2, low byte first). Returns the length
EMSCRIPTEN_KEEPALIVE int mesh_clock(int slot, uint32_t now, uint8_t *out) {
  ClockPoint p;
  nodes[slot].node.ClockNow(now, &p);
  out[0] = p.synced ? 1 : 0;
  out[1] = p.adopted ? 1 : 0;
  memcpy(out + 2, p.timeline, 5);
  Put32(out + 7, (uint32_t)p.mesh);
  Put32(out + 11, (uint32_t)(p.mesh >> 32));
  Put32(out + 15, nodes[slot].node.ClockVersion());
  uint16_t tag = TimelineTag(p.timeline);
  out[19] = (uint8_t)tag;
  out[20] = (uint8_t)(tag >> 8);
  return 21;
}

// A stamp for a message at `now`: 6 bytes, or 0 when the node is not synced
EMSCRIPTEN_KEEPALIVE int mesh_clock_stamp(int slot, uint32_t now, uint8_t *out) {
  ClockPoint p;
  nodes[slot].node.ClockNow(now, &p);
  return ClockStamp(p, now, out) ? (int)kStampLen : 0;
}

// How old a stamp is at `now`, from a point of the clock taken at `at` (a stamp checked later than the point is, as another task does): the age in ms (4 bytes,
// low byte first) and whether the tag is the timeline's (1). Returns 5, or 0 when the bytes are not a stamp
EMSCRIPTEN_KEEPALIVE int mesh_clock_age(int slot, uint32_t at, uint32_t now, const uint8_t *stamp, int len, uint8_t *out) {
  ClockPoint p;
  nodes[slot].node.ClockNow(at, &p);
  int32_t age = 0;
  bool same = false;
  if (!ClockAge(p, now, stamp, (size_t)len, &age, &same)) return 0;
  Put32(out, (uint32_t)age);
  out[4] = same ? 1 : 0;
  return 5;
}

// What the clock has told the application: kind, synced, the timeline left (5), the timeline now (5), the ticks of 100 ms (4) and the milliseconds (8). 0 when
// there is nothing
EMSCRIPTEN_KEEPALIVE int mesh_pop_clock_event(int slot, uint8_t *out) {
  ClockEvent e;
  if (!nodes[slot].node.PopClockEvent(&e)) return 0;
  out[0] = e.kind;
  out[1] = e.synced;
  memcpy(out + 2, e.from, 5);
  memcpy(out + 7, e.to, 5);
  Put32(out + 12, (uint32_t)e.ticks);
  Put32(out + 16, (uint32_t)e.delta);
  Put32(out + 20, (uint32_t)((uint64_t)e.delta >> 32));
  return 24;
}

// What the node can say of its surroundings: neighbours, weak, twoHop, branches, relays, soleWays, count, then for each neighbour heard on the radio
// id, quality, usable, reach, only, branch, chosen. Returns the length
EMSCRIPTEN_KEEPALIVE int mesh_health(int slot, uint32_t now, uint8_t *out) {
  Health h;
  HealthLink links[kMaxNeighbors];
  unsigned n = nodes[slot].node.HealthReport(&h, links, kMaxNeighbors, now);
  int at = 0;
  out[at++] = h.neighbors;
  out[at++] = h.weak;
  out[at++] = h.twoHop;
  out[at++] = h.branches;
  out[at++] = h.relays;
  out[at++] = h.soleWays;
  out[at++] = (uint8_t)n;
  for (unsigned i = 0; i < n; i++) {
    out[at++] = links[i].id;
    out[at++] = links[i].quality;
    out[at++] = links[i].usable;
    out[at++] = links[i].reach;
    out[at++] = links[i].only;
    out[at++] = links[i].branch;
    out[at++] = links[i].chosen;
  }
  return at;
}

// what a neighbour with the address whose last byte is `node` is worth to the node as a peer of a full radio table (PeerRole)
EMSCRIPTEN_KEEPALIVE int mesh_peer_role(int slot, int node, uint32_t now) {
  const uint8_t mac[6] = {0x24, 0x0a, 0xc4, 0, 0, (uint8_t)node};
  return nodes[slot].node.PeerRoleOf(mac, now);
}

// A notice as bytes: node, kind, by, value(4). 0 when there is none
EMSCRIPTEN_KEEPALIVE int mesh_pop_notice(int slot, uint8_t *out) {
  Notice n;
  if (!nodes[slot].node.PopNotice(&n)) return 0;
  out[0] = n.node;
  out[1] = n.kind;
  out[2] = n.by;
  Put32(out + 3, n.value);
  return 7;
}

EMSCRIPTEN_KEEPALIVE int mesh_is_silent(int slot, int node) { return nodes[slot].node.IsSilent((uint8_t)node) ? 1 : 0; }

EMSCRIPTEN_KEEPALIVE int mesh_noisy(int slot) { return nodes[slot].node.Noisy() ? 1 : 0; }

EMSCRIPTEN_KEEPALIVE int mesh_loss_percent(int slot) { return nodes[slot].node.LossPercent(); }

// the tag of a frame, stamped as the node would: what one that has the network's key can make
EMSCRIPTEN_KEEPALIVE void mesh_tag_as(int slot, uint8_t *frame, int n) {
  if (nodes[slot].real) Seal(Crypto::Tag, &nodes[slot].crypto, frame, (size_t)n);
  else Seal(sim_tag, nullptr, frame, (size_t)n);
}

// the public key of a node with the real cipher (32 bytes), and a node it can talk to
EMSCRIPTEN_KEEPALIVE void mesh_identity(int slot, uint8_t *out) { memcpy(out, nodes[slot].crypto.PublicKey(), 32); }

EMSCRIPTEN_KEEPALIVE int mesh_set_peer(int slot, int node, const uint8_t *pub) { return nodes[slot].crypto.SetPeer((uint8_t)node, pub) ? 1 : 0; }

// a node taken out of the driver's list, as the firmware's task tells the core: nothing of it is kept as a neighbour
EMSCRIPTEN_KEEPALIVE void mesh_forget(int slot, int node) { nodes[slot].node.Forget((uint8_t)node); }

// the primitives, for the vectors of their standards
EMSCRIPTEN_KEEPALIVE int mesh_x25519(uint8_t *out, const uint8_t *secret, const uint8_t *point) { return Crypto::X25519(out, secret, point) ? 1 : 0; }

EMSCRIPTEN_KEEPALIVE void mesh_hmac(const uint8_t *key, int klen, const uint8_t *data, int len, uint8_t *out) { Crypto::Hmac(key, (size_t)klen, data, (size_t)len, out); }

EMSCRIPTEN_KEEPALIVE void mesh_hkdf(const uint8_t *salt, int slen, const uint8_t *ikm, int ilen, const uint8_t *info, int nlen, uint8_t *out, int olen) {
  Crypto::Hkdf(salt, (size_t)slen, ikm, (size_t)ilen, info, (size_t)nlen, out, (size_t)olen);
}

// AES-128-CCM in place: `seal` 1 encrypts and writes the tag, 0 decrypts and checks it; returns 1 when it went
EMSCRIPTEN_KEEPALIVE int mesh_ccm(int seal, const uint8_t *key, const uint8_t *nonce, int nlen, const uint8_t *aad, int alen, uint8_t *data, int len, uint8_t *tag, int tlen) {
  if (seal) return Crypto::CcmSeal(key, nonce, (size_t)nlen, aad, (size_t)alen, data, (size_t)len, tag, (size_t)tlen) ? 1 : 0;
  return Crypto::CcmOpen(key, nonce, (size_t)nlen, aad, (size_t)alen, data, (size_t)len, tag, (size_t)tlen) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE void mesh_ctr(const uint8_t *key, const uint8_t *nonce, uint8_t *data, int len) { Crypto::Ctr(key, nonce, data, (size_t)len); }

// the epoch and the counter of the node, to carry the counter near its end, and whether the node has asked its application for the next epoch
EMSCRIPTEN_KEEPALIVE uint32_t mesh_epoch(int slot) { return nodes[slot].node.epoch(); }

EMSCRIPTEN_KEEPALIVE uint32_t mesh_counter(int slot) { return nodes[slot].node.counter(); }

EMSCRIPTEN_KEEPALIVE void mesh_advance_counter(int slot, uint32_t counter) { nodes[slot].node.AdvanceCounter(counter); }

EMSCRIPTEN_KEEPALIVE int mesh_epoch_wanted(int slot) { return nodes[slot].wantsEpoch ? 1 : 0; }

// the most a payload can be in a frame for `dest`
EMSCRIPTEN_KEEPALIVE int mesh_max_payload(int slot, int dest) { return (int)nodes[slot].node.MaxPayloadFor((uint8_t)dest); }

// how much memory a node of the core takes, and the keys of its pairs
EMSCRIPTEN_KEEPALIVE int mesh_sizeof() { return (int)sizeof(Node); }

EMSCRIPTEN_KEEPALIVE int mesh_crypto_sizeof() { return (int)sizeof(Crypto); }

// the codec, for tests: the frame as bytes (tag stamped when `sealed`), and back
EMSCRIPTEN_KEEPALIVE int mesh_encode(int kind, int origin, int dest, int next, int hops, uint32_t epoch, uint32_t counter,
                                     const uint8_t *payload, int len, int sealed, uint8_t *out) {
  Frame f;
  f.kind = (uint8_t)kind;
  f.origin = (uint8_t)origin;
  f.dest = (uint8_t)dest;
  f.next = (uint8_t)next;
  f.hops = (uint8_t)hops;
  f.epoch = epoch;
  f.counter = counter;
  f.payload = payload;
  f.len = (size_t)len;
  size_t n = Encode(f, out);
  if (n > 0 && sealed) Seal(sim_tag, nullptr, out, n);
  return (int)n;
}

// kind, origin, dest, next, hops, then epoch and counter (4 each) and the payload length; -1 if it is not a frame
EMSCRIPTEN_KEEPALIVE int mesh_decode(const uint8_t *in, int n, uint8_t *out) {
  Frame f;
  if (!Decode(in, (size_t)n, &f)) return -1;
  out[0] = f.kind;
  out[1] = f.origin;
  out[2] = f.dest;
  out[3] = f.next;
  out[4] = f.hops;
  Put32(out + 5, f.epoch);
  Put32(out + 9, f.counter);
  out[13] = (uint8_t)f.len;
  return 14;
}

EMSCRIPTEN_KEEPALIVE int mesh_tag_matches(const uint8_t *frame, int n) { return TagMatches(sim_tag, nullptr, frame, (size_t)n) ? 1 : 0; }

}
