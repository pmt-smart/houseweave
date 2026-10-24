// Tests of the change of the network's key in the driver: the command, the record in the flash, the previous key and what the node lets through under it, the
// hours it is held for, and what the heartbeat and the neighbour list say of it. The core's own rules, in many nodes over a simulated air, are tested in
// libs/nspanel-sim/vm/test/mesh-key.test.mjs. Included by host_test.cpp after tests_clock.h.

static uint8_t g_key2[32];
static uint8_t g_key3[32];

static std::string key_hex(const uint8_t* key) { return hex(key, 32); }

// The command, as the main loop gets it: the key, and the version, and whether a node was struck off
static void key_command(const uint8_t* key, int version, bool revoke = false) {
  std::string text = key_hex(key) + "," + std::to_string(version) + (revoke ? ",1" : "");
  say("EspNowMeshGroupKey", text.c_str());
  CmndEspNowMeshGroupKey();
}

// The task takes what the main loop pushed: the keys, and the word that a change was just made
static void key_apply(void) { EspNowMeshApplyShared(EspNowMeshDriver.node, EspNowMeshDriver.shared); }

// The peer again, with heartbeats and the clock, holding the key `cur` (and `prev`, the one before it, when there is one)
static void peer_again(const uint8_t* cur, uint8_t cur_version, const uint8_t* prev, uint8_t prev_version, uint32_t now) {
  g_peer_crypto.Begin(g_peer_secret);
  g_peer_crypto.SetGroupKey(prev != nullptr ? prev : cur, prev != nullptr ? prev_version : cur_version);
  if (prev != nullptr) { g_peer_crypto.ChangeGroupKey(cur, cur_version); }
  g_peer_crypto.SetPeer(3, g_drv_pub);
  EspNowMesh::Config c;
  memset(&c, 0, sizeof(c));
  c.id = 2; c.epoch = 77; c.random = peer_rand; c.noStartSync = true;
  c.tag = EspNowMesh::Crypto::Tag; c.tagContext = &g_peer_crypto;
  c.tagPrevious = EspNowMesh::Crypto::TagPrevious;
  c.proof = EspNowMesh::Crypto::Proof; c.proofContext = &g_peer_crypto;
  c.seal = EspNowMesh::Crypto::Seal; c.open = EspNowMesh::Crypto::Open; c.cipherContext = &g_peer_crypto;
  c.nodeOf = peer_node_of;
  c.beatEveryMs = 5000;
  c.clock = true;
  g_peer.Begin(c);
  g_peer.SetKeyState(cur_version, prev != nullptr, false, now);
  g_peer.SetSynced(3, EspNowMeshSettings.epoch, 0);
  EspNowMeshDriver.node->SetSynced(2, 77, 0);
}

// The application's bytes of the heartbeats in the frames that went, opened with the network's key as `crypto` holds it; the frames are left where they are
static std::vector<std::vector<uint8_t>> beat_infos_with(EspNowMesh::Crypto* crypto) {
  std::vector<std::vector<uint8_t>> out;
  for (auto& s : g_sent) {
    EspNowMesh::Frame f;
    if (!EspNowMesh::Decode(s.second.data(), s.second.size(), &f) || (f.type() != EspNowMesh::kBeat) || (f.dest != EspNowMesh::kToAll)) { continue; }
    uint8_t aad[EspNowMesh::kHeaderLen] = {EspNowMesh::kVersion, (uint8_t)(f.kind & ~3), f.origin, f.dest, 0, 0};
    EspNowMesh::Put32(aad + 6, f.epoch);
    EspNowMesh::Put32(aad + 10, f.counter);
    uint8_t plain[EspNowMesh::kMaxPayload];
    int n = EspNowMesh::Crypto::Open(crypto, 0, aad, f.payload, f.len, plain);
    if ((n < 4) || (plain[0] != EspNowMesh::kSubBeat)) { continue; }
    out.emplace_back(plain + 3, plain + 3 + plain[2]);
  }
  return out;
}

// The world goes on for `ms`, a step of 100 ms at a time, the peer and the driver each ticking and the air between them. The heartbeats the driver sends are
// opened with `opener` and kept in `beats`, when there are such
static void key_run(uint32_t* now, uint32_t ms, EspNowMesh::Crypto* opener = nullptr, std::vector<std::vector<uint8_t>>* beats = nullptr) {
  uint32_t end = *now + ms;
  while (*now < end) {
    *now += 100;
    g_peer.Tick(*now);
    air(*now);
    turn(*now);
    if (opener != nullptr && beats != nullptr) {
      for (auto& b : beat_infos_with(opener)) { beats->push_back(b); }
    }
    air(*now);
  }
}

static const EspNowMesh::Neighbor* driver_neighbor(uint8_t id) { return EspNowMeshDriver.node->NeighborOf(id); }

static void test_key_command(void) {
  printf("-- key change: the command\n");
  make_world(true);
  memset(g_key2, 0x6B, 32);
  memset(g_key3, 0x7C, 32);
  uint8_t key_change = EspNowMeshDriver.key_change;

  // the same key, with another version: renamed, no change
  key_command(g_group_key, 9);
  CHECK(EspNowMeshSettings.group_version == 9 && !EspNowMeshSettings.has_prev && EspNowMeshDriver.key_change == key_change, "the same key with another version is only renamed");
  CHECK(g_response == "{\"EspNowMeshGroupKey\":{\"Set\":1,\"Version\":9,\"Previous\":0}}", "and the answer says no previous key");

  // another key with the same version: refused
  key_command(g_key2, 9);
  CHECK(g_response == "{\"EspNowMeshGroupKey\":\"the version must change with the key\"}", "another key with the same version is refused");
  CHECK(!memcmp(EspNowMeshSettings.group_key, g_group_key, 32) && !EspNowMeshSettings.has_prev, "and nothing changed");

  // another key: a change. The one the device had is the previous key, in RAM and in the flash
  key_command(g_key2, 2);
  CHECK(g_response == "{\"EspNowMeshGroupKey\":{\"Set\":1,\"Version\":2,\"Previous\":9}}", "a change says which version it keeps");
  CHECK(EspNowMeshSettings.has_prev && EspNowMeshSettings.prev_version == 9 && !memcmp(EspNowMeshSettings.prev_key, g_group_key, 32) && !memcmp(EspNowMeshSettings.group_key, g_key2, 32), "the key it had is the previous key");
  CHECK(EspNowMeshDriver.key_change == (uint8_t)(key_change + 1) && EspNowMeshSettings.prev_hours == 0, "and the change is counted, from no hours");
  const std::vector<uint8_t>& blob = g_nvs["espnowmesh/settings"];
  CHECK(blob.size() == 2188 && !memcmp(&blob[offsetof(decltype(EspNowMeshSettings), prev_key)], g_group_key, 32) && blob[offsetof(decltype(EspNowMeshSettings), has_prev)] == 1, "the flash has it");
  CHECK(XdrvMailbox.data[0] == '*', "nor left in the command's own buffer");

  // the task takes it: it checks with the previous key as well, and the change has 120 s to reach the others
  key_apply();
  CHECK(EspNowMeshDriver.crypto->GroupVersion() == 2 && EspNowMeshDriver.crypto->PreviousGroupVersion() == 9, "the task has both keys");
  CHECK(EspNowMeshDriver.node->HoldsPreviousKey() && EspNowMeshDriver.node->KeyVersion() == 2, "and says which");
  CHECK(EspNowMeshDriver.node->Converging(g_millis) && EspNowMeshDriver.node->Converging(g_millis + 119000) && !EspNowMeshDriver.node->Converging(g_millis + 121000), "the change has 120 s");

  // a second change while the first is open: refused, unless a node was struck off with it
  key_command(g_key3, 3);
  CHECK(g_response == "{\"EspNowMeshGroupKey\":\"the last change is not closed\"}", "a second change is refused while the first is open");
  CHECK(!memcmp(EspNowMeshSettings.group_key, g_key2, 32) && EspNowMeshSettings.prev_version == 9, "and nothing changed");
  key_command(g_key3, 3, true);
  CHECK(g_response == "{\"EspNowMeshGroupKey\":{\"Set\":1,\"Version\":3,\"Previous\":2}}", "unless a node was struck off: the key it had is the previous, and the one before it is let go");
  CHECK(!memcmp(EspNowMeshSettings.prev_key, g_key2, 32) && EspNowMeshSettings.prev_version == 2, "so the previous key is the second");

  // closed: the previous key is let go, in RAM and in the flash
  say("EspNowMeshKeyClose", "");
  CmndEspNowMeshKeyClose();
  CHECK(g_response == "{\"EspNowMeshKeyClose\":{\"Closed\":1}}" && !EspNowMeshSettings.has_prev && EspNowMeshSettings.prev_version == 0, "the change is closed");
  bool zero = true;
  for (int i = 0; i < 32; i++) { if (EspNowMeshSettings.prev_key[i] != 0) { zero = false; } }
  const std::vector<uint8_t>& after = g_nvs["espnowmesh/settings"];
  for (int i = 0; i < 32; i++) { if (after[offsetof(decltype(EspNowMeshSettings), prev_key) + i] != 0) { zero = false; } }
  CHECK(zero && after[offsetof(decltype(EspNowMeshSettings), has_prev)] == 0, "the key is wiped, in RAM and in the flash");
  key_apply();
  CHECK(!EspNowMeshDriver.crypto->HasPreviousGroupKey() && !EspNowMeshDriver.node->HoldsPreviousKey() && !EspNowMeshDriver.node->Converging(g_millis), "and the task lets it go");
  say("EspNowMeshKeyClose", "");
  CmndEspNowMeshKeyClose();
  CHECK(g_response == "{\"EspNowMeshKeyClose\":{\"Closed\":0}}", "closing again closes nothing");

  // a change the flash does not take is not made
  g_nvs_fail_set = true;
  uint8_t before = EspNowMeshDriver.key_change;
  key_command(g_key2, 4);
  CHECK(g_response == "{\"EspNowMeshGroupKey\":\"flash write failed\"}", "a change the flash does not take says so");
  CHECK(!memcmp(EspNowMeshSettings.group_key, g_key3, 32) && !EspNowMeshSettings.has_prev && EspNowMeshSettings.group_version == 3 && EspNowMeshDriver.key_change == before, "and the record, the previous key and the count are as they were");
  g_nvs_fail_set = false;

  // what the status says
  key_command(g_key2, 4);
  say("EspNowMeshStatus", "");
  CmndEspNowMeshStatus();
  CHECK(g_response.find("\"GroupVersion\":4,\"PrevVersion\":3,\"PrevHours\":0") != std::string::npos, "the status says the versions and the hours");
  end_world();
}

static void test_key_hours(void) {
  printf("-- key change: the hours\n");
  make_world(true);
  memset(g_key2, 0x6B, 32);
  key_command(g_key2, 2);
  CHECK(EspNowMeshSettings.has_prev, "a change is open");
  uint32_t writes = g_nvs_writes;
  for (int i = 0; i < 3599; i++) { EspNowMeshEverySecond(); }
  CHECK(EspNowMeshSettings.prev_hours == 0 && g_nvs_writes == writes, "in the first 3599 s no hour is counted, and nothing is written");
  EspNowMeshEverySecond();
  CHECK(EspNowMeshSettings.prev_hours == 1 && g_nvs_writes > writes, "at 3600 s one hour is counted, and kept");
  CHECK(((const uint16_t*)&g_nvs["espnowmesh/settings"][offsetof(decltype(EspNowMeshSettings), prev_hours)])[0] == 1, "in the flash");

  // 30 days of running: let go
  EspNowMeshSettings.prev_hours = ESPNOW_MESH_KEY_HOLD_HOURS - 1;
  EspNowMeshDriver.prev_seconds = 3599;
  EspNowMeshEverySecond();
  CHECK(!EspNowMeshSettings.has_prev && EspNowMeshSettings.prev_version == 0 && EspNowMeshSettings.prev_hours == 0, "after 720 hours the previous key is let go");
  CHECK(logged("held for 720 hours"), "and the log says so");
  uint32_t quiet = g_nvs_writes;
  for (int i = 0; i < 7200; i++) { EspNowMeshEverySecond(); }
  CHECK(g_nvs_writes == quiet, "and no hours are counted, or written, with none held");
  end_world();
}

static void test_key_restart(void) {
  printf("-- key change: a restart\n");
  make_world(true);
  memset(g_key2, 0x6B, 32);
  key_command(g_key2, 2);
  key_apply();
  CHECK(EspNowMeshDriver.node->Converging(g_millis), "just changed");
  // the device starts again, from the flash
  free_node();
  EspNowMeshDriver.running = false;
  EspNowMeshSettingsLoad();
  CHECK(EspNowMeshSettings.has_prev && EspNowMeshSettings.prev_version == 1 && EspNowMeshSettings.group_version == 2, "the flash gives the previous key back");
  CHECK(EspNowMeshStartAttempt(), "it starts");
  key_apply();
  CHECK(EspNowMeshDriver.crypto->HasPreviousGroupKey() && EspNowMeshDriver.crypto->PreviousGroupVersion() == 1, "with both keys");
  CHECK(EspNowMeshDriver.node->HoldsPreviousKey() && !EspNowMeshDriver.node->Converging(g_millis), "and no new time for the change: a start is no change");
  end_world();
}

static void test_key_previous_heard(void) {
  printf("-- key change: a node that has not taken it\n");
  make_world(true);
  memset(g_key2, 0x6B, 32);
  // the driver takes the change; the peer is still on the key it had
  uint32_t now = g_now_ms;
  g_millis = now;
  key_command(g_key2, 2);
  key_apply();
  peer_again(g_group_key, 1, nullptr, 0, now);

  // in the first 120 s a frame under the previous key is one under the key in use, whatever it is
  g_peer.Send(EspNowMesh::kCommand, 3, (const uint8_t*)"on", 2, false, now);
  key_run(&now, 300);
  EspNowMesh::Stats s = EspNowMeshDriver.node->stats();
  CHECK(s.delivered == 1 && s.prevKeyHeard >= 1 && s.prevKeyDropped == 0, "a command under the previous key is taken in the first 120 s");
  g_rules.clear();
  EspNowMeshDrainEvents();
  CHECK(rules_with("\"Type\":0,\"Dest\":3") != "" && rules_with("\"Flags\":4") != "", "and the rules are told it came under the previous key (flag 4)");

  // its heartbeats are taken whole: the clock and the bytes of the application, and which key it holds
  key_run(&now, 6000);
  const EspNowMesh::Neighbor* n = driver_neighbor(2);
  CHECK(n != nullptr && n->infoLen >= 23 && n->keyVersion == 1 && (n->keyBits & EspNowMesh::kKeyUnderPrevious) && !(n->keyBits & EspNowMesh::kKeyHoldsPrevious), "its heartbeat in the first 120 s is taken whole, and says it holds version 1");

  // after 120 s only what brings it up to date
  key_run(&now, 125000);
  CHECK(!EspNowMeshDriver.node->Converging(now), "the 120 s are over");
  uint32_t delivered = EspNowMeshDriver.node->stats().delivered;
  uint32_t dropped = EspNowMeshDriver.node->stats().prevKeyDropped;
  g_peer.Send(EspNowMesh::kCommand, 3, (const uint8_t*)"on", 2, false, now);
  g_peer.Send(EspNowMesh::kEvent, EspNowMesh::kToAll, (const uint8_t*)"hello", 5, false, now);
  g_peer.Send(EspNowMesh::kState, 3, (const uint8_t*)"x", 1, false, now);
  key_run(&now, 300);
  CHECK(EspNowMeshDriver.node->stats().delivered == delivered && EspNowMeshDriver.node->stats().prevKeyDropped >= dropped + 3, "a command, an event and a state under the previous key are dropped, and counted");
  g_peer.Send(EspNowMesh::kMembership, EspNowMesh::kToAll, (const uint8_t*)"m", 1, false, now);
  key_run(&now, 300);
  CHECK(EspNowMeshDriver.node->stats().delivered == delivered, "a membership frame for everyone is dropped too");
  g_peer.Send(EspNowMesh::kMembership, 3, (const uint8_t*)"mine", 4, false, now);
  key_run(&now, 300);
  CHECK(EspNowMeshDriver.node->stats().delivered == delivered + 1, "and one for this node alone is taken");
  g_rules.clear();
  EspNowMeshDrainEvents();
  CHECK(rules_with("\"Type\":6,\"Dest\":3") != "" && rules_with("\"Flags\":4") != "", "with the flag that it came under the previous key");

  // its heartbeat now: it is there, which key it holds, and nothing else
  n = driver_neighbor(2);
  CHECK(n != nullptr && n->infoLen == 0 && n->clockSeen == 0 && n->keyVersion == 1 && n->keyBits == (EspNowMesh::kKeyUnderPrevious | EspNowMesh::kKeyNeeds), "its heartbeat is taken for its presence and its key, and its bytes of the application are not: it says it holds version 1 and needs the key, for it hears nothing it can check");
  CHECK(n != nullptr && n->beatAt != 0 && (int32_t)(now - n->beatAt) < 6000, "and its last heartbeat is the last that came");
  CHECK(n != nullptr && n->state == EspNowMesh::kAlive, "it is alive");
  EspNowMeshSnapshotMake(EspNowMeshDriver.node);
  say("EspNowMeshNeighbors", "");
  CmndEspNowMeshNeighbors();
  CHECK(g_response.find("\"Key\":1,\"KeyBits\":6,\"Fwd\":255,\"Info\":\"\"") != std::string::npos, "the command lists it with the key and no bytes");

  // the key reaches it: the driver sends the frame under the previous key's tag, and the peer, which has only that key, takes it; without, it does not
  EspNowMeshCmd_t cmd = send_cmd(2, false, "key");
  cmd.type = EspNowMesh::kMembership;
  cmd.flags = 2;
  g_sent.clear();
  xQueueSend(EspNowMeshDriver.cmd, &cmd, 0);
  now += 100;
  turn(now);
  uint32_t peer_heard = g_peer.stats().delivered;
  air(now);
  CHECK(g_peer.stats().delivered == peer_heard + 1, "a frame sent with flag 2 is taken by a node that holds only the previous key");
  cmd.flags = 0;
  g_sent.clear();
  xQueueSend(EspNowMeshDriver.cmd, &cmd, 0);
  now += 100;
  uint32_t peer_bad = g_peer.stats().bad;
  peer_heard = g_peer.stats().delivered;
  turn(now);
  air(now);
  CHECK(g_peer.stats().bad > peer_bad && g_peer.stats().delivered == peer_heard, "and one sent without is not");
  end_world();
}

static void test_key_stale(void) {
  printf("-- key change: the node that has not taken it\n");
  make_world(true);
  memset(g_key2, 0x6B, 32);
  // this device is the one that missed the change: the peer is on the new key and holds the old one as the previous
  uint32_t now = g_now_ms;
  g_millis = now;
  peer_again(g_key2, 2, g_group_key, 1, now);
  g_peer.SetKeyState(2, true, true, now);
  // what this device sends is under the key it has, which the test opens as it does
  EspNowMesh::Crypto stale;
  stale.Begin(g_peer_secret);
  stale.SetGroupKey(g_group_key, 1);
  std::vector<std::vector<uint8_t>> beats;
  key_run(&now, 6000, &stale, &beats);
  CHECK(!EspNowMeshDriver.node->NeedsKey(now), "it has heard nothing it cannot check for long enough: it does not need the key yet");
  key_run(&now, 20000, &stale, &beats);
  CHECK(EspNowMeshDriver.node->stats().bad >= 3 && EspNowMeshDriver.node->stats().delivered == 0, "it hears the peer, and cannot check what it says");
  CHECK(EspNowMeshDriver.node->NeedsKey(now), "after 15 s of that it needs the key");
  CHECK(beats.size() >= 4, "its heartbeats went on");
  if (beats.size() >= 4) {
    const std::vector<uint8_t>& first = beats.front();
    const std::vector<uint8_t>& last = beats.back();
    CHECK(first.size() >= 23 && first[22] == 1 && (first[19] & 0x60) == 0, "its first heartbeat says it has the key of version 1, and that it holds no previous one and needs none");
    CHECK(last.size() >= 23 && last[22] == 1 && (last[19] & 0x40) && !(last[19] & 0x20), "and a later one says it needs the key");
  }

  // the frame that brings the key is tagged with the key the node still has, and is taken
  uint32_t delivered = EspNowMeshDriver.node->stats().delivered;
  g_peer.Send(EspNowMesh::kMembership, 3, (const uint8_t*)"the key", 7, false, now, true);
  key_run(&now, 300);
  CHECK(EspNowMeshDriver.node->stats().delivered == delivered + 1, "the frame that carries the key, tagged with the previous key, is taken");
  g_rules.clear();
  EspNowMeshDrainEvents();
  CHECK(rules_with("\"Type\":6,\"Dest\":3") != "" && rules_with("\"Flags\":4") == "", "and it is not one under the previous key for this node: it is under the key it has");

  // the same frame under the new key is not one this node can check
  uint32_t bad = EspNowMeshDriver.node->stats().bad;
  g_peer.Send(EspNowMesh::kMembership, 3, (const uint8_t*)"again", 5, false, now);
  key_run(&now, 300);
  CHECK(EspNowMeshDriver.node->stats().bad > bad, "the same frame under the new key is not");

  // it takes the key: it needs it no more
  key_command(g_key2, 2);
  key_apply();
  CHECK(EspNowMeshDriver.node->HoldsPreviousKey() && EspNowMeshDriver.node->KeyVersion() == 2, "it takes the key and keeps the old one");
  g_peer.Send(EspNowMesh::kEvent, EspNowMesh::kToAll, (const uint8_t*)"e", 1, false, now);
  key_run(&now, 300);
  CHECK(!EspNowMeshDriver.node->NeedsKey(now), "once it has the key it hears what it could not, and does not need it");
  CHECK(EspNowMeshDriver.node->stats().delivered > delivered + 1, "and it is delivered what the peer sends");
  end_world();
}

static void test_key_berry(void) {
  printf("-- key change: Berry\n");
  make_world(false);
  bvm vm;
  berry.vm = &vm;
  g_berry_functions.clear();
  EspNowMeshBerryRegister();
  auto call = [&](const char* name, std::vector<HostValue> args) {
    vm.stack = args;
    vm.raised = false;
    return g_berry_functions[name](&vm);
  };
  call("espnow_mesh_send", {{1, 2, ""}, {1, 6, ""}, {2, 0, ""}, {3, 0, "k"}, {2, 1, ""}});
  CHECK(vm.stack.back().kind == 1, "a send with the previous key asked for gives its ticket");
  EspNowMeshCmd_t cmd;
  CHECK(pdTRUE == xQueueReceive(EspNowMeshDriver.cmd, &cmd, 0) && cmd.flags == 2 && cmd.type == 6, "and goes to the task with flag 2");
  call("espnow_mesh_send", {{1, 2, ""}, {1, 6, ""}, {2, 1, ""}, {3, 0, "k"}, {2, 1, ""}});
  CHECK(pdTRUE == xQueueReceive(EspNowMeshDriver.cmd, &cmd, 0) && cmd.flags == 3, "with an answer too, flags 3");
  call("espnow_mesh_send", {{1, 2, ""}, {1, 6, ""}, {2, 0, ""}, {3, 0, "k"}});
  CHECK(pdTRUE == xQueueReceive(EspNowMeshDriver.cmd, &cmd, 0) && cmd.flags == 0, "and with four arguments, as before, none");
  berry.vm = nullptr;
  end_world();
}

// A service the network pairs with (a server, no node of the mesh): the key the node shares with it, from the two identities, which the
// service derives the same from its own secret and the node's public key
static void test_pair_key(void) {
  printf("-- the key of a pair with a service\n");
  make_world(false);
  bvm vm;
  berry.vm = &vm;
  g_berry_functions.clear();
  EspNowMeshBerryRegister();
  auto call = [&](std::vector<HostValue> args) {
    vm.stack = args;
    vm.raised = false;
    return g_berry_functions["espnow_mesh_pair_key"](&vm);
  };
  static const uint8_t base[32] = { 9 };
  memset(EspNowMeshSettings.secret, 0x3C, 32);
  EspNowMeshSettings.has_secret = 1;
  uint8_t server_secret[32];
  memset(server_secret, 0x5A, sizeof(server_secret));
  uint8_t server_pub[32], node_pub[32], shared[32], want[32];
  EspNowMesh::Crypto::X25519(server_pub, server_secret, base);
  EspNowMesh::Crypto::X25519(node_pub, EspNowMeshSettings.secret, base);
  EspNowMesh::Crypto::X25519(shared, server_secret, node_pub);
  EspNowMesh::Crypto::Hkdf((const uint8_t*)"houseweave-server", 17, shared, 32, (const uint8_t*)"http", 4, want, 32);
  call({{4, 0, std::string((const char*)server_pub, 32)}});
  CHECK(vm.stack.back().kind == 4 && vm.stack.back().s == std::string((const char*)want, 32),
        "the node's key with the service is the one the service derives from its own secret and the node's public key");
  // and the value the server's Node derives for the same two secrets (ha/houseweave/server/house-fleet.mjs, whose test pins it too)
  uint8_t pinned[32];
  for (int i = 0; i < 32; i++) { sscanf("463c97311c85ec6df2640aeefc4be01b89b330283b2fb200af9ff9bc1e7dd238" + 2 * i, "%2hhx", &pinned[i]); }
  CHECK(!memcmp(want, pinned, 32), "and it is the value the server's Node derives for the same two secrets");
  call({{4, 0, std::string(31, 'x')}});
  CHECK(vm.stack.back().kind == 2 && !vm.stack.back().i, "a key not of 32 bytes: false");
  call({{4, 0, std::string(32, '\0')}});
  CHECK(vm.stack.back().kind == 2 && !vm.stack.back().i, "a key of small order: false");
  EspNowMeshSettings.has_secret = 0;
  call({{4, 0, std::string((const char*)server_pub, 32)}});
  CHECK(vm.stack.back().kind == 2 && !vm.stack.back().i, "no identity: false");
  berry.vm = nullptr;
  end_world();
}

// Data sealed under the network's group key (espnow_mesh_group_seal and _open): read back by a member that holds the key of that version, the one in use
// or the previous one, and by nobody else; and the same bytes the simulator's driver makes (libs/nspanel-sim/vm/test/mesh-house.test.mjs pins them)
static std::string hex_of(const std::string& b) {
  std::string out;
  char h[3];
  for (unsigned char c : b) { snprintf(h, sizeof(h), "%02x", c); out += h; }
  return out;
}

static void test_group_seal(void) {
  printf("-- data sealed under the group key\n");
  make_world(false);
  bvm vm;
  berry.vm = &vm;
  g_berry_functions.clear();
  EspNowMeshBerryRegister();
  auto call = [&](const char* name, std::vector<HostValue> args) {
    vm.stack = args;
    vm.raised = false;
    return g_berry_functions[name](&vm);
  };
  memset(EspNowMeshSettings.group_key, 0x11, 32);
  EspNowMeshSettings.group_version = 5;
  EspNowMeshSettings.has_group = 1;
  EspNowMeshSettings.has_prev = 0;
  const std::string data = std::string("the settings") + std::string(4084, '\x5A');
  call("espnow_mesh_group_seal", {{3, 0, "settings"}, {4, 0, data}});
  HostValue r = vm.stack.back();
  CHECK(r.kind == 6 && r.items.size() == 2 && r.items[0].i == 5 && r.items[1].s.size() == 12 + data.size() + 16,
        "sealed: the group key's version, and the nonce, the ciphertext and the tag");
  const std::string sealed = r.items.size() == 2 ? r.items[1].s : std::string();
  CHECK(sealed.find("the settings") == std::string::npos, "the data is not there in the clear");
  call("espnow_mesh_group_open", {{3, 0, "settings"}, {1, 5, ""}, {4, 0, sealed}});
  CHECK(vm.stack.back().kind == 4 && vm.stack.back().s == data, "opened by the key of its version: the data back");
  call("espnow_mesh_group_open", {{3, 0, "other"}, {1, 5, ""}, {4, 0, sealed}});
  CHECK(vm.stack.back().kind == 2 && !vm.stack.back().i, "under another label: false");
  call("espnow_mesh_group_open", {{3, 0, "settings"}, {1, 6, ""}, {4, 0, sealed}});
  CHECK(vm.stack.back().kind == 2 && !vm.stack.back().i, "for a version the device does not hold: false");
  std::string bent = sealed;
  bent[20] ^= 1;
  call("espnow_mesh_group_open", {{3, 0, "settings"}, {1, 5, ""}, {4, 0, bent}});
  CHECK(vm.stack.back().kind == 2 && !vm.stack.back().i, "a byte changed: false");
  call("espnow_mesh_group_open", {{3, 0, "settings"}, {1, 5, ""}, {4, 0, sealed.substr(0, 27)}});
  CHECK(vm.stack.back().kind == 2 && !vm.stack.back().i, "shorter than a nonce and a tag: false");
  // the key changed: the old one is the previous key while the device holds it
  memcpy(EspNowMeshSettings.prev_key, EspNowMeshSettings.group_key, 32);
  EspNowMeshSettings.prev_version = 5;
  EspNowMeshSettings.has_prev = 1;
  memset(EspNowMeshSettings.group_key, 0x22, 32);
  EspNowMeshSettings.group_version = 6;
  call("espnow_mesh_group_open", {{3, 0, "settings"}, {1, 5, ""}, {4, 0, sealed}});
  CHECK(vm.stack.back().kind == 4 && vm.stack.back().s == data, "after a change of the key, by the previous key the device still holds");
  EspNowMeshSettings.has_prev = 0;
  call("espnow_mesh_group_open", {{3, 0, "settings"}, {1, 5, ""}, {4, 0, sealed}});
  CHECK(vm.stack.back().kind == 2 && !vm.stack.back().i, "and no more once the change closed");
  call("espnow_mesh_group_seal", {{3, 0, "settings"}, {4, 0, std::string(8193, 'x')}});
  CHECK(vm.stack.back().kind == 2 && !vm.stack.back().i, "more than 8 KB: false");
  EspNowMeshSettings.has_group = 0;
  call("espnow_mesh_group_seal", {{3, 0, "settings"}, {4, 0, data}});
  CHECK(vm.stack.back().kind == 2 && !vm.stack.back().i, "no group key: false");
  // the bytes for a nonce of 0..11, pinned with the simulator's driver: the key HKDF gives, then AES-128-CCM with the label as associated data
  uint8_t group[32], key[16], nonce[12], tag[16];
  memset(group, 0x11, 32);
  for (int i = 0; i < 12; i++) nonce[i] = (uint8_t)i;
  EspNowMeshDataKey(group, "settings", key);
  uint8_t text[3] = { 'a', 'b', 'c' };
  EspNowMesh::Crypto::CcmSeal(key, nonce, 12, (const uint8_t*)"settings", 8, text, 3, tag, 16);
  const std::string pinned = hex_of(std::string((const char*)nonce, 12) + std::string((const char*)text, 3) + std::string((const char*)tag, 16));
  printf("   pinned: %s\n", pinned.c_str());
  CHECK(pinned == "000102030405060708090a0b970a7a0dcc77c9ae6230937fdd202db367eb6c", "a nonce of 0..11 over \"abc\" gives the bytes the simulator pins");
  berry.vm = nullptr;
  end_world();
}

// The device leaves its network (EspNowMeshLeave 1): the number, both keys, the nodes, the identity and the epoch go, in RAM and in the flash, and
// the mesh stops, as on a new device: a network that struck it off keeps its old identity out, and it comes back with a new one
static void test_leave(void) {
  printf("-- leave\n");
  make_world(true);
  memset(g_key2, 0x6B, 32);
  key_command(g_key2, 2);
  bool had_node = false;
  for (auto& n : EspNowMeshSettings.node) { if (n.id) { had_node = true; } }
  CHECK(EspNowMeshDriver.running && EspNowMeshSettings.id != 0 && EspNowMeshSettings.has_prev && had_node, "a running node, with nodes and a change of the key open");
  uint8_t secret[32];
  memcpy(secret, EspNowMeshSettings.secret, 32);
  uint32_t epoch = EspNowMeshSettings.epoch;

  say("EspNowMeshLeave", "");
  XdrvMailbox.payload = -99;
  CmndEspNowMeshLeave();
  CHECK(g_response == "{\"EspNowMeshLeave\":\"1 to leave\"}", "bare, it says how to leave");
  CHECK(EspNowMeshDriver.running && EspNowMeshSettings.id != 0 && EspNowMeshSettings.has_group, "and nothing changed");

  say("EspNowMeshLeave", "1");
  XdrvMailbox.payload = 1;
  g_on_delay = []() { if (EspNowMeshDriver.stop) { EspNowMeshDriver.exited = true; } };      // the task sees the stop and ends
  CmndEspNowMeshLeave();
  g_on_delay = nullptr;
  CHECK(g_response == "{\"EspNowMeshLeave\":\"Done\"}", "with 1, done");
  CHECK(!EspNowMeshDriver.running && !EspNowMeshSettings.enabled, "the mesh stopped, and stays so at the next start");
  CHECK(EspNowMeshSettings.id == 0 && !EspNowMeshSettings.has_group && EspNowMeshSettings.group_version == 0 && !EspNowMeshSettings.has_prev && EspNowMeshSettings.prev_version == 0, "no number, no key");
  bool wiped = true;
  for (auto b : EspNowMeshSettings.group_key) { if (b) { wiped = false; } }
  for (auto b : EspNowMeshSettings.prev_key) { if (b) { wiped = false; } }
  CHECK(wiped, "both keys wiped");
  bool any_node = false;
  for (auto& n : EspNowMeshSettings.node) { if (n.id) { any_node = true; } }
  CHECK(!any_node, "and no node");
  bool no_secret = true;
  for (auto b : EspNowMeshSettings.secret) { if (b) { no_secret = false; } }
  CHECK(!EspNowMeshSettings.has_secret && no_secret && EspNowMeshSettings.epoch == 0 && epoch != 0, "the identity and the epoch go, as on a new device");
  const std::vector<uint8_t>& blob = g_nvs["espnowmesh/settings"];
  CHECK(blob.size() == 2188 && blob[offsetof(decltype(EspNowMeshSettings), id)] == 0 && blob[offsetof(decltype(EspNowMeshSettings), has_group)] == 0 &&
        blob[offsetof(decltype(EspNowMeshSettings), has_prev)] == 0 && blob[offsetof(decltype(EspNowMeshSettings), enabled)] == 0, "the flash has it");
  say("EspNowMeshStatus", "");
  CmndEspNowMeshStatus();
  CHECK(g_response.find("\"Running\":0") != std::string::npos && g_response.find("\"Why\":\"needs EspNowMeshId\"") != std::string::npos, "the status says what it needs, as a new device's does");
  CHECK(g_peer_num_faults == 0, "and asked no peer count of a radio that is down");

  // a new device to a network: it takes a number and a key, the key as a first one, with nothing kept as previous
  say("EspNowMeshId", "5");
  CmndEspNowMeshId();
  key_command(g_group_key, 1);
  CHECK(EspNowMeshSettings.id == 5 && g_response == "{\"EspNowMeshGroupKey\":{\"Set\":1,\"Version\":1,\"Previous\":0}}", "and takes a number and a key again, the key as a first one");
  say("EspNowMeshPublic", "");
  CmndEspNowMeshPublic();
  CHECK(EspNowMeshSettings.has_secret && memcmp(EspNowMeshSettings.secret, secret, 32) != 0, "with a new identity, made when it is first asked for");
  end_world();
}
