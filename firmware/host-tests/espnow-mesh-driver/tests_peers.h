// Tests of the peer the radio's table gives up when it is full: what the heartbeats of the neighbours say of each, and what the driver makes of it.
// Included by host_test.cpp after tests_radio.h (mac_of, unicast).

// A node of the list at the address mac_of(id), whose frames the core takes: the driver's own (3) is not one of them
static void add_neighbor(int id, int slot) {
  EspNowMeshTable[slot].id = (uint8_t)id;
  mac_of(id, EspNowMeshTable[slot].mac);
  EspNowMeshDriver.node->SetSynced((uint8_t)id, 5, 0);
}

// The heartbeat of node `origin` that lists the nodes `hears` (each at -60), sealed for everyone as the network's key does, in `out`; `info` are the
// application's bytes it carries
static size_t beat_frame(int origin, uint32_t counter, const std::vector<int>& hears, uint8_t* out, const std::vector<uint8_t>& info = {}) {
  uint8_t payload[160];
  size_t at = 0;
  payload[at++] = EspNowMesh::kSubBeat;
  payload[at++] = 0;
  payload[at++] = (uint8_t)info.size();
  for (uint8_t b : info) { payload[at++] = b; }
  payload[at++] = (uint8_t)hears.size();
  for (int h : hears) { payload[at++] = (uint8_t)h; payload[at++] = (uint8_t)-60; }
  EspNowMesh::Frame f;
  f.kind = EspNowMesh::PackKind(EspNowMesh::kBeat, false, 0, 0);
  f.origin = (uint8_t)origin;
  f.dest = EspNowMesh::kToAll;
  f.next = 0;
  f.hops = 0;
  f.epoch = 5;
  f.counter = counter;
  uint8_t aad[EspNowMesh::kHeaderLen] = {EspNowMesh::kVersion, (uint8_t)(f.kind & ~3), f.origin, f.dest, 0, 0};
  EspNowMesh::Put32(aad + 6, f.epoch);
  EspNowMesh::Put32(aad + 10, f.counter);
  uint8_t sealed[160];
  size_t sn = EspNowMesh::Crypto::Seal(EspNowMeshDriver.crypto, 0, aad, payload, at, sealed);
  f.payload = sealed;
  f.len = sn;
  size_t n = EspNowMesh::Encode(f, out);
  EspNowMesh::Seal(EspNowMesh::Crypto::Tag, EspNowMeshDriver.crypto, out, n);
  return n;
}

static uint32_t g_beat_counter = 0;
static void hear_beat(int origin, const std::vector<int>& hears, uint32_t at, const std::vector<uint8_t>& info = {}) {
  uint8_t frame[EspNowMesh::kMaxFrame];
  size_t n = beat_frame(origin, ++g_beat_counter, hears, frame, info);
  uint8_t mac[6];
  mac_of(origin, mac);
  EspNowMeshDriver.node->OnReceive(frame, n, mac, -60, at, false);
}

static void put_peer(int slot, int id, uint32_t used_at) {
  mac_of(id, EspNowMeshPeers[slot].mac);
  EspNowMeshPeers[slot].used_at = used_at;
  EspNowMeshPeers[slot].used = true;
}
static int peer_id_at(int slot) { return EspNowMeshPeers[slot].used ? EspNowMeshPeers[slot].mac[5] : -1; }

static void test_peer_roles(void) {
  printf("-- peer roles\n");
  make_world(true);
  g_beat_counter = 0;
  // three neighbours: 10 lists {3, 20}, 11 lists {3, 20, 21}, 12 lists only this device
  add_neighbor(10, 1);
  add_neighbor(11, 2);
  add_neighbor(12, 3);
  uint32_t now = 100000;
  g_millis = now;
  hear_beat(10, {3, 20}, now);
  hear_beat(11, {3, 20, 21}, now);
  hear_beat(12, {3}, now);
  uint8_t mac[6];
  auto role = [&](int id) { mac_of(id, mac); return EspNowMeshDriver.node->PeerRoleOf(mac, now); };
  CHECK(role(11) == EspNowMesh::kPeerOnlyWay, "a neighbour that is the only one to list a node at two hops is the only way to it");
  CHECK(role(10) == EspNowMesh::kPeerRedundant, "one whose nodes at two hops another lists too is redundant");
  CHECK(role(12) == EspNowMesh::kPeerRedundant, "and one that lists nothing past this device");
  CHECK(role(99) == EspNowMesh::kPeerGone, "an address that is no neighbour is gone");
  // the cost: a peer sent to within 3 s is never given up, the only way never, the others by the role and then the time unused
  EspNowMeshPeer_t p;
  memset(&p, 0, sizeof(p));
  mac_of(11, p.mac); p.used = true; p.used_at = now - 90000;
  CHECK(EspNowMeshPeerCost(p, now) == 0, "the only way to some node costs nothing to keep however long it has gone unused");
  mac_of(10, p.mac); p.used_at = now - 90000;
  uint32_t redundant_old = EspNowMeshPeerCost(p, now);
  CHECK(redundant_old > 90000, "a redundant one is given up, the longer unused the sooner");
  p.used_at = now - 2000;
  CHECK(EspNowMeshPeerCost(p, now) == 0, "but not one sent to within 3 s");
  mac_of(77, p.mac); p.used_at = now - 4000;
  CHECK(EspNowMeshPeerCost(p, now) > redundant_old, "one that is no neighbour goes before a redundant one that has gone unused much longer");
  // from another thread the roles are not read: the cost is the time unused
  g_current_task = (TaskHandle_t)0x2;
  mac_of(11, p.mac); p.used_at = now - 90000;
  CHECK(EspNowMeshPeerCost(p, now) != 0, "off the task that owns the core, nothing of the neighbours is looked at");
  g_current_task = (TaskHandle_t)0x1;
  end_world();

  // the table: the oldest of the redundant goes, and the only way, the oldest of all, stays
  make_world(true);
  g_beat_counter = 0;
  now = 200000;
  g_millis = now;
  for (int k = 0; k < 19; k++) {
    int id = 10 + k;
    add_neighbor(id, k + 1);
    if (11 == id) { hear_beat(id, {3, 100, 101}, now); } else { hear_beat(id, {3, 100}, now); }
  }
  for (int k = 0; k < 19; k++) { put_peer(k, 10 + k, now - 100000 + 1000 * (uint32_t)k); }   // 11 is the second oldest, 10 the oldest
  int victim = EspNowMeshPeerVictim(now);
  CHECK(victim >= 0 && peer_id_at(victim) == 10, "the oldest of the redundant goes");
  EspNowMeshPeers[victim].used = false;
  victim = EspNowMeshPeerVictim(now);
  CHECK(victim >= 0 && peer_id_at(victim) == 12, "then the next of them, not the only way to 101 that is older");
  // a neighbour that delivers few of its heartbeats goes before a redundant one that has been unused longer
  for (int k = 0; k < 19; k++) { EspNowMeshPeers[k].used = false; }
  put_peer(0, 12, now - 90000);                  // redundant, long unused
  put_peer(1, 13, now - 50000);                  // heard, and its heartbeats come one in three
  g_millis = now = 300000;
  for (int k = 0; k < 16; k++) {
    g_millis = now = 300000 + 5250 * (uint32_t)k;
    hear_beat(12, {3, 100}, now);
    hear_beat(14, {3, 100}, now);
    hear_beat(10, {3, 100}, now);
    hear_beat(11, {3, 100, 101}, now);
    if (k % 3 == 0) { hear_beat(13, {3, 100}, now); }      // one of the three intervals
  }
  mac_of(13, mac);
  CHECK(EspNowMeshDriver.node->PeerRoleOf(mac, now) == EspNowMesh::kPeerWeak, "a neighbour that is heard and delivers one heartbeat in three is weak");
  victim = EspNowMeshPeerVictim(now);
  CHECK(victim == 1, "and goes before the redundant one that has gone unused longer");
  // every neighbour the only way to some node of its own: none is given up, the new one is not added and nothing is sent
  end_world();
  make_world(true);
  g_beat_counter = 0;
  now = 400000;
  g_millis = now;
  for (int k = 0; k < 19; k++) {
    int id = 10 + k;
    add_neighbor(id, k + 1);
    hear_beat(id, {3, 100 + k}, now);
    put_peer(k, id, now - 60000 + 1000 * (uint32_t)k);
  }
  CHECK(EspNowMeshPeerVictim(now) < 0, "when each one is the only way to a node of its own, none is given up");
  for (int k = 0; k < 19; k++) { uint8_t m[6]; mac_of(10 + k, m); esp_now_peer_info_t info = {}; memcpy(info.peer_addr, m, 6); esp_now_add_peer(&info); }
  esp_now_peer_info_t extra = {};
  mac_of(500, extra.peer_addr);
  uint32_t full = EspNowMeshCount.peer_full;
  CHECK(g_peers.size() >= 19, "the radio's table has them");
  while (g_peers.size() < ESP_NOW_MAX_TOTAL_PEER_NUM) { esp_now_peer_info_t f = {}; mac_of(600 + (int)g_peers.size(), f.peer_addr); esp_now_add_peer(&f); }
  CHECK(!EspNowMeshAddPeer(extra.peer_addr, now) && EspNowMeshCount.peer_full == full + 1, "a new neighbour finds no room, and it is counted");
  // one of them goes quiet: it is no longer a neighbour, and its place is given to the new one
  g_millis = now = now + 40000;
  for (int k = 0; k < 19; k++) { if (k != 4) { hear_beat(10 + k, {3, 100 + k}, now); } }
  EspNowMesh::Notice nt;
  EspNowMeshDriver.node->Tick(now);
  while (EspNowMeshDriver.node->PopNotice(&nt)) {}
  mac_of(14, mac);
  CHECK(EspNowMeshDriver.node->PeerRoleOf(mac, now) == EspNowMesh::kPeerGone, "a neighbour not heard for 40 s is gone");
  for (int k = 0; k < 19; k++) { put_peer(k, 10 + k, now - 60000 + 1000 * (uint32_t)k); }
  victim = EspNowMeshPeerVictim(now);
  CHECK(victim >= 0 && peer_id_at(victim) == 14, "and is the one given up, though the others are older");
  end_world();
}

static void test_health_command(void) {
  printf("-- health\n");
  make_world(true);
  g_beat_counter = 0;
  uint32_t now = 100000;
  g_millis = now;
  // 10 and 11 hear each other's node 20 and nothing else in common; 12 hears only this device
  add_neighbor(10, 1);
  add_neighbor(11, 2);
  add_neighbor(12, 3);
  for (int k = 0; k < 3; k++) {
    g_millis = now = 100000 + 5250 * (uint32_t)k;
    hear_beat(10, {3, 20}, now);
    hear_beat(11, {3, 21}, now);
    hear_beat(12, {3}, now);
  }
  EspNowMeshSnapshotMake(EspNowMeshDriver.node);
  say("EspNowMeshHealth", "");
  CmndEspNowMeshHealth();
  CHECK(json_ok(g_response) && g_response.size() < 1040, "the health answer is JSON and fits the message");
  CHECK(g_response.find("\"Neighbors\":3") != std::string::npos && g_response.find("\"TwoHop\":2") != std::string::npos, "three neighbours, two nodes at two hops");
  CHECK(g_response.find("\"Branches\":3") != std::string::npos && g_response.find("\"Cut\":1") != std::string::npos, "that do not meet within two hops: three groups, so this device may be a point of failure");
  CHECK(g_response.find("\"SoleWays\":2") != std::string::npos, "and two of them are its only way to a node");
  CHECK(g_response.find("{\"Id\":10,\"Quality\":-1,\"Usable\":1,\"Reach\":1,\"Only\":1,\"Branch\":1,\"Chosen\":0}") != std::string::npos, "each neighbour is told, the delivery not yet judged");
  printf("   health is %u bytes\n", (unsigned)g_response.size());
  // paging
  say("EspNowMeshHealth", "2");
  CmndEspNowMeshHealth();
  CHECK(json_ok(g_response) && g_response.find("\"From\":2") != std::string::npos && g_response.find("\"Id\":12") != std::string::npos && g_response.find("\"Id\":10") == std::string::npos, "the list starts from where it is asked");
  // 48 neighbours fit the page size
  for (int k = 0; k < 20; k++) { add_neighbor(30 + k, 4 + k); }
  for (int k = 0; k < 6; k++) {
    g_millis = now = 200000 + 5250 * (uint32_t)k;
    for (int j = 0; j < 20; j++) { hear_beat(30 + j, {3, 150 + j}, now); }
  }
  EspNowMeshSnapshotMake(EspNowMeshDriver.node);
  say("EspNowMeshHealth", "0");
  CmndEspNowMeshHealth();
  CHECK(json_ok(g_response) && g_response.size() < 1040, "with twenty neighbours a page still fits");
  printf("   a page is %u bytes\n", (unsigned)g_response.size());
  // Berry
  {
    bvm vm;
    berry.vm = &vm;
    EspNowMeshBerryRegister();
    CHECK(g_berry_functions.count("espnow_mesh_health") == 1, "the Berry function is registered");
    int r = g_berry_functions["espnow_mesh_health"](&vm);
    CHECK(r == 1 && !vm.stack.empty() && vm.stack.back().kind == 5 && vm.stack.back().m["branches"] >= 1 && vm.stack.back().m["neighbors"] >= 3, "it returns a map of the same numbers");
    CHECK(vm.stack.back().m.count("soleways") == 1 && vm.stack.back().m["soleways"] >= 2 && vm.stack.back().m.count("solewas") == 0, "the key of the neighbours that are the only way is soleways, like twohop");
    berry.vm = nullptr;
  }
  end_world();
  // not running: false
  bvm vm2;
  berry.vm = &vm2;
  EspNowMeshDriver.running = false;
  int r2 = g_berry_functions["espnow_mesh_health"](&vm2);
  CHECK(r2 == 1 && vm2.stack.back().kind == 2 && vm2.stack.back().i == 0, "with the task not running it returns false");
  berry.vm = nullptr;
  say("EspNowMeshHealth", "");
  CmndEspNowMeshHealth();
  CHECK(g_response == "{\"EspNowMeshHealth\":\"not running\"}", "and the command says so");
}

// A node the application takes out of the list (EspNowMeshNode <id>,0) is forgotten by the core when the task takes the list: no neighbour, no
// verdict that it is silent, and its place among the radio's peers given back. The other node of the list stays as it was
static void test_forget_node(void) {
  printf("-- forget a node\n");
  make_world(true);
  g_beat_counter = 0;
  uint32_t now = 100000;
  g_millis = now;
  // node 10 in the list, as the main loop gives it and the task takes it; heard, and with a peer of the radio
  EspNowMeshSettings.node[1].id = 10;
  mac_of(10, EspNowMeshSettings.node[1].mac);
  memcpy(EspNowMeshSettings.node[1].pub, g_peer_pub, 32);
  EspNowMeshPushShared();
  EspNowMeshApplyShared(EspNowMeshDriver.node, EspNowMeshDriver.shared);
  EspNowMeshDriver.node->SetSynced(10, 5, 0);
  hear_beat(10, {3}, now);
  CHECK(EspNowMeshDriver.node->NeighborOf(10) != nullptr && EspNowMeshDriver.crypto->HasPeer(10), "a node of the list that is heard is a neighbour, with its key");
  // then quiet: suspected, and declared silent here
  g_millis = now = now + 40000;
  EspNowMeshDriver.node->Tick(now);
  g_millis = now = now + 11000;
  EspNowMeshDriver.node->Tick(now);
  EspNowMesh::Notice nt;
  while (EspNowMeshDriver.node->PopNotice(&nt)) {}
  CHECK(EspNowMeshDriver.node->IsSilent(10), "not heard, it is declared silent");
  uint8_t mac[6];
  mac_of(10, mac);
  esp_now_peer_info_t info = {};
  memcpy(info.peer_addr, mac, 6);
  esp_now_add_peer(&info);
  put_peer(0, 10, now);
  // the application takes it out, and the task takes the list
  say("EspNowMeshNode", "10,0");
  CmndEspNowMeshNode();
  CHECK(g_response == "{\"EspNowMeshNode\":\"Done\"}", "the command takes it out of the list");
  EspNowMeshApplyShared(EspNowMeshDriver.node, EspNowMeshDriver.shared);
  CHECK(EspNowMeshDriver.node->NeighborOf(10) == nullptr && !EspNowMeshDriver.node->IsSilent(10), "the core forgets it: no neighbour, no verdict that it is silent");
  CHECK(!EspNowMeshPeers[0].used && !esp_now_is_peer_exist(mac), "and its peer of the radio is given back");
  bool two = false;
  for (int i = 0; i < ESPNOW_MESH_NODES; i++) { two = two || (EspNowMeshTable[i].id == 2); }
  CHECK(two && EspNowMeshDriver.crypto->HasPeer(2) && !EspNowMeshDriver.crypto->HasPeer(10), "the other node stays, with its key, and the forgotten one has none");
  end_world();
}

// espnow_mesh_route(dest): the next hop of every node of the list, as the task's last look saw it: a neighbour itself, a node two hops away by the
// neighbour that lists it, none for a node no one lists or one out of the list, and false with the task stopped
static void test_route_for_scripts(void) {
  puts("-- the next hop, for a script");
  make_world(true);
  g_beat_counter = 0;
  uint32_t now = 100000;
  g_millis = now;
  EspNowMeshSettings.node[1].id = 10;
  mac_of(10, EspNowMeshSettings.node[1].mac);
  memcpy(EspNowMeshSettings.node[1].pub, g_peer_pub, 32);
  EspNowMeshSettings.node[2].id = 20;
  mac_of(20, EspNowMeshSettings.node[2].mac);
  memcpy(EspNowMeshSettings.node[2].pub, g_peer_pub, 32);
  EspNowMeshPushShared();
  EspNowMeshApplyShared(EspNowMeshDriver.node, EspNowMeshDriver.shared);
  bvm vm;
  berry.vm = &vm;
  g_berry_functions.clear();
  EspNowMeshBerryRegister();
  CHECK(g_berry_functions.count("espnow_mesh_route") == 1, "the entry point is registered");
  auto route = [&](int dest) {
    vm.stack = {{1, dest, ""}};
    vm.raised = false;
    g_berry_functions["espnow_mesh_route"](&vm);
    return vm.stack.back();
  };
  auto is = [&](const HostValue& v, int next, int how) { return v.kind == 6 && v.items.size() == 2 && v.items[0].i == next && v.items[1].i == how; };
  EspNowMeshSnapshotMake(EspNowMeshDriver.node);
  CHECK(is(route(10), 0, 0) && is(route(20), 0, 0), "before any heartbeat, no way to either");
  EspNowMeshDriver.node->SetSynced(10, 5, 0);
  hear_beat(10, {3, 20}, now);
  EspNowMeshSnapshotMake(EspNowMeshDriver.node);
  CHECK(is(route(10), 10, 1), "a neighbour heard: itself, as a neighbour");
  CHECK(is(route(20), 10, 2), "a node it lists, not heard here: by it, as listed");
  CHECK(is(route(9), 0, 0), "a node out of the list: none");
  vm.stack = {{3, 0, "x"}};
  vm.raised = false;
  g_berry_functions["espnow_mesh_route"](&vm);
  CHECK(vm.raised, "a destination that is not a number is an error");
  EspNowMeshDriver.running = false;
  CHECK(route(10).kind == 2 && route(10).i == 0, "the task stopped: false");
  EspNowMeshDriver.running = true;
  berry.vm = nullptr;
  end_world();
}
