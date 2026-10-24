// Tests of the mesh clock in the driver: what the heartbeat carries, the events the rules get, the clock the main loop reads and the stamps it makes and checks.
// The clock itself, in the core, is tested in many nodes over a simulated air in libs/nspanel-sim/vm/test/mesh-clock.test.mjs. Included by host_test.cpp after
// tests_peers.h (add_neighbor, hear_beat).

// The 20 bytes of the application's part of a heartbeat that has a clock: the layout, the timeline, the mesh time, the application's bytes and the flags
static std::vector<uint8_t> clock_info(const uint8_t timeline[5], uint64_t mesh, uint8_t flags = 0, size_t len = 20, uint8_t fill = 0) {
  std::vector<uint8_t> info(len, fill);
  info[0] = EspNowMesh::kInfoLayout;
  for (int i = 0; i < 5; i++) { info[1 + i] = timeline[i]; }
  for (int i = 0; i < 6; i++) { info[6 + i] = (uint8_t)(mesh >> (8 * (5 - i))); }
  info[EspNowMesh::kInfoFlagsAt] = flags;
  return info;
}

static void own_timeline(uint8_t out[5]) {
  out[0] = EspNowMeshSettings.id;
  for (int i = 0; i < 4; i++) { out[1 + i] = (uint8_t)(EspNowMeshSettings.epoch >> (8 * (3 - i))); }
}

// The heartbeats the driver sent since the last call, opened with the network's key as a neighbour does: the application's bytes of each
static std::vector<std::vector<uint8_t>> sent_beat_infos(void) {
  std::vector<std::vector<uint8_t>> out;
  for (auto& s : g_sent) {
    EspNowMesh::Frame f;
    if (!EspNowMesh::Decode(s.second.data(), s.second.size(), &f) || (f.type() != EspNowMesh::kBeat) || (f.dest != EspNowMesh::kToAll)) { continue; }
    uint8_t aad[EspNowMesh::kHeaderLen] = {EspNowMesh::kVersion, (uint8_t)(f.kind & ~3), f.origin, f.dest, 0, 0};
    EspNowMesh::Put32(aad + 6, f.epoch);
    EspNowMesh::Put32(aad + 10, f.counter);
    uint8_t plain[EspNowMesh::kMaxPayload];
    int n = EspNowMesh::Crypto::Open(&g_peer_crypto, 0, aad, f.payload, f.len, plain);
    if ((n < 4) || (plain[0] != EspNowMesh::kSubBeat)) { continue; }
    out.emplace_back(plain + 3, plain + 3 + plain[2]);
  }
  g_sent.clear();
  return out;
}

static uint64_t info_mesh(const std::vector<uint8_t>& info) {
  uint64_t m = 0;
  for (int i = 0; i < 6; i++) { m = (m << 8) | info[6 + i]; }
  return m;
}

static std::string rules_with(const char* part) {
  for (auto& r : g_rules) { if (r.find(part) != std::string::npos) { return r; } }
  return "";
}

static void test_clock(void) {
  printf("-- clock\n");
  make_world(true);
  g_beat_counter = 0;
  uint8_t own[5];
  own_timeline(own);
  uint32_t t0 = 100000;
  turn(t0);                                    // the first turn starts the clock: its time is 0 here
  CHECK(EspNowMeshDriver.clock_valid, "the task made the clock the main loop reads");

  // what the heartbeat carries: the layout, the timeline, the time at which it was made and the synced bit, in 20 bytes when the application gave none
  std::vector<std::pair<uint32_t, std::vector<uint8_t>>> beats;
  for (uint32_t k = 1; k <= 190; k++) {
    uint32_t now = t0 + 100 * k;
    turn(now);
    for (auto& i : sent_beat_infos()) { beats.emplace_back(now, i); }
  }
  CHECK(beats.size() >= 3, "heartbeats went out");
  if (beats.size() >= 3) {
    const std::vector<uint8_t>& a = beats.front().second;
    const std::vector<uint8_t>& b = beats.back().second;
    CHECK(a.size() == 23 && b.size() == 23, "of 23 bytes, up to the version of the key");
    CHECK(a[22] == EspNowMeshSettings.group_version && b[22] == EspNowMeshSettings.group_version, "which the device says in byte 22");
    CHECK(a[0] == 1 && !memcmp(&a[1], own, 5), "the layout and the device own timeline: its number and its epoch");
    CHECK((a[19] & 0x60) == 0, "and it holds no previous key and needs none");
    CHECK(info_mesh(a) == beats.front().first - t0, "the time the first one was made at, which is the time since the clock started");
    CHECK((a[19] & 1) == 0, "and the device is not synced yet");
    CHECK(info_mesh(b) > info_mesh(a) && info_mesh(b) == beats.back().first - t0, "the later one has a later time");
    CHECK((b[19] & 1) == 1, "and, 10 s after the device could first be heard, it is synced");
  }
  g_rules.clear();
  EspNowMeshDrainEvents();
  std::string synced = rules_with("\"Synced\":{");
  char want[160];
  char own_hex[11];
  ToHex_P(own, 5, own_hex, sizeof(own_hex));
  snprintf(want, sizeof(want), "{\"EspNowMesh\":{\"Synced\":{\"Value\":1,\"Timeline\":\"%s\",\"Tag\":%u}}}", own_hex, (unsigned)EspNowMesh::TimelineTag(own));
  CHECK(synced == want, "the rules were told it became synced, with its own timeline");
  size_t count = 0;
  for (auto& r : g_rules) { if (r.find("\"Synced\":{") != std::string::npos) { count++; } }
  CHECK(count == 1, "once");
  CHECK(rules_with("\"Timeline\":{").empty(), "and no timeline was taken");

  // the application's bytes: its own are kept, and the clock's go in as the frame is made
  {
    EspNowMeshCmd_t cmd;
    memset(&cmd, 0, sizeof(cmd));
    cmd.op = ESPNOW_MESH_CMD_INFO;
    cmd.len = 32;
    memset(cmd.data, 0xAA, 32);
    CHECK(ESPNOW_MESH_QUEUED == EspNowMeshQueueCommand(&cmd), "32 bytes of the application's are queued");
    sent_beat_infos();
    std::vector<uint8_t> got;
    for (uint32_t k = 161; k <= 360 && got.empty(); k++) {
      turn(t0 + 100 * k);
      auto infos = sent_beat_infos();
      if (!infos.empty()) { got = infos[0]; }
    }
    CHECK(got.size() == 32, "the heartbeat carries 32 bytes of them, and no more");
    if (got.size() == 32) {
      bool kept = true;
      for (int i = 12; i < 32; i++) { if ((i != 19) && (i != 22) && (got[i] != 0xAA)) { kept = false; } }
      CHECK(kept, "bytes 12 to 18, 20, 21 and 23 to 31 are the application's, as it gave them");
      CHECK(got[0] == 1 && !memcmp(&got[1], own, 5) && got[19] == 0x8B && got[22] == EspNowMeshSettings.group_version, "the layout, the timeline, the synced bit, bits 5 and 6 of the flags and the key's version are the device's, and the other bits of the flags the application's");
    }
    cmd.len = 3;
    cmd.data[0] = 7; cmd.data[1] = 8; cmd.data[2] = 9;
    CHECK(ESPNOW_MESH_QUEUED == EspNowMeshQueueCommand(&cmd), "3 bytes are queued");
    got.clear();
    for (uint32_t k = 361; k <= 560 && got.empty(); k++) {
      turn(t0 + 100 * k);
      auto infos = sent_beat_infos();
      if (!infos.empty()) { got = infos[0]; }
    }
    CHECK(got.size() == 23 && got[0] == 1 && !memcmp(&got[1], own, 5) && got[12] == 0 && got[19] == 1 && got[22] == EspNowMeshSettings.group_version, "3 bytes are filled to 23, the clock's over the first 12 of them");
  }
  end_world();

  // a neighbour in another timeline that has been up longer: the device takes it, and the rules and the main loop hear of it
  make_world(true);
  g_beat_counter = 0;
  own_timeline(own);
  ToHex_P(own, 5, own_hex, sizeof(own_hex));
  turn(t0);
  uint8_t other[5] = {10, 0, 0, 0, 7};
  add_neighbor(10, 1);
  bvm vm;
  berry.vm = &vm;
  g_berry_functions.clear();
  EspNowMeshBerryRegister();
  auto call = [&](const char* name, std::vector<HostValue> args) {
    vm.stack = args;
    vm.raised = false;
    return g_berry_functions[name](&vm);
  };
  CHECK(g_berry_functions.count("espnow_mesh_clock") && g_berry_functions.count("espnow_mesh_stamp") && g_berry_functions.count("espnow_mesh_age"), "the three clock functions are registered");
  call("espnow_mesh_clock", {});
  CHECK(vm.stack.back().kind == 5 && vm.stack.back().m["synced"] == 0 && vm.stack.back().m["adopted"] == 0 && vm.stack.back().ms["timeline"] == own_hex, "2 s after the start: not synced, in its own timeline");
  CHECK(vm.stack.back().m["tag"] == EspNowMesh::TimelineTag(own) && vm.stack.back().m["taken"] == 0, "with its tag");
  call("espnow_mesh_stamp", {});
  CHECK(vm.stack.back().kind == 2 && vm.stack.back().i == 0, "a device that is not synced has no stamp to give");
  turn(t0 + 2000);
  uint64_t ours = 2000;
  hear_beat(10, {3}, t0 + 2000 + 3, clock_info(other, ours + 3 + 5000));
  turn(t0 + 2000 + 3);
  g_rules.clear();
  EspNowMeshDrainEvents();
  CHECK(g_rules.size() >= 2, "two things reached the rules");
  size_t at_timeline = 99, at_synced = 99;
  for (size_t i = 0; i < g_rules.size(); i++) {
    if (g_rules[i].find("\"Timeline\":{") != std::string::npos) { at_timeline = i; }
    if (g_rules[i].find("\"Synced\":{") != std::string::npos) { at_synced = i; }
  }
  CHECK(at_timeline < at_synced, "the timeline taken, and then the synced bit");
  snprintf(want, sizeof(want), "{\"EspNowMesh\":{\"Timeline\":{\"Old\":\"%s\",\"New\":\"0A00000007\",\"Ticks\":50,\"Delta\":\"5000\",\"Synced\":1}}}", own_hex);
  CHECK(at_timeline < g_rules.size() && g_rules[at_timeline] == want, "the one left, the one taken, the ticks of 100 ms and the ms");
  CHECK(logged("took the timeline 0A00000007 from"), "the log says it");
  uint32_t now = t0 + 2003;
  call("espnow_mesh_clock", {});
  const HostValue& m = vm.stack.back();
  CHECK(m.kind == 5 && m.m.at("synced") == 1 && m.m.at("adopted") == 1 && m.ms.at("timeline") == "0A00000007" && m.m.at("taken") == 1, "the main loop reads the clock in the new timeline");
  CHECK(m.m.at("tag") == EspNowMesh::TimelineTag(other), "with its tag");
  CHECK(m.m.at("lo") == (int64_t)(7003 + (g_millis - now)) && m.m.at("hi") == 0, "and the time, ms, 5 s ahead of what it was");
  CHECK(m.m.at("ticks10") == 700 && m.m.at("ticks100") == 70, "in ticks of 10 and of 100 ms");

  // a stamp, and how old it is later
  call("espnow_mesh_stamp", {});
  CHECK(vm.stack.back().kind == 4 && vm.stack.back().s.size() == 6, "a synced device stamps with 6 bytes");
  std::string stamp = vm.stack.back().s;
  CHECK((uint8_t)stamp[0] == (EspNowMesh::TimelineTag(other) >> 8) && (uint8_t)stamp[1] == (EspNowMesh::TimelineTag(other) & 255), "the tag of the timeline first");
  uint32_t ticks = ((uint32_t)(uint8_t)stamp[2] << 24) | ((uint32_t)(uint8_t)stamp[3] << 16) | ((uint32_t)(uint8_t)stamp[4] << 8) | (uint8_t)stamp[5];
  CHECK(ticks == 700, "and the time in ticks of 10 ms");
  g_millis = now + 1234;
  call("espnow_mesh_age", {{4, 0, stamp}});
  CHECK(vm.stack.back().kind == 5 && vm.stack.back().m["tag"] == 1 && vm.stack.back().m["synced"] == 1 && vm.stack.back().m["age"] >= 1230 && vm.stack.back().m["age"] <= 1240, "1.2 s later it is 1230 ms old, in ticks of 10");
  g_millis = now;
  std::string future = stamp;
  future[5] = (char)(future[5] + 30);
  call("espnow_mesh_age", {{4, 0, future}});
  CHECK(vm.stack.back().m["age"] == -300 && vm.stack.back().m["tag"] == 1, "a stamp 30 ticks ahead is 300 ms from the future");
  std::string foreign = stamp;
  foreign[1] = (char)(foreign[1] ^ 1);
  call("espnow_mesh_age", {{4, 0, foreign}});
  CHECK(vm.stack.back().m["tag"] == 0, "the stamp of another timeline says it is");
  call("espnow_mesh_age", {{4, 0, stamp.substr(0, 5)}});
  CHECK(vm.stack.back().kind == 2 && vm.stack.back().i == 0, "bytes that are not a stamp are false");
  call("espnow_mesh_age", {{1, 5, ""}});
  CHECK(vm.raised, "and what is not bytes an error");

  // the neighbour is heard again, in the timeline the device is in now and 4 ms ahead: followed, a step
  hear_beat(10, {3}, now + 5, clock_info(other, 7012));
  // the command: the clock, and the neighbours with the skew their last heartbeat had
  EspNowMeshSnapshotMake(EspNowMeshDriver.node);
  say("EspNowMeshClock", "");
  CmndEspNowMeshClock();
  CHECK(json_ok(g_response) && g_response.size() < 1040, "EspNowMeshClock answers JSON that fits the message");
  CHECK(g_response.find("\"Clock\":1,\"Synced\":1,\"Adopted\":1,\"Timeline\":\"0A00000007\"") != std::string::npos && g_response.find("\"Taken\":1") != std::string::npos, "in the timeline taken");
  CHECK(g_response.find("{\"Id\":10,\"Seen\":2,\"Sync\":0,\"Skew\":4,") != std::string::npos && g_response.find("\"Timeline\":\"0A00000007\"}") != std::string::npos, "the neighbour that was followed, its timeline");
  CHECK(g_response.find("\"Steps\":1") != std::string::npos, "and the steps");
  printf("   the clock command is %zu bytes with one neighbour\n", g_response.size());
  for (int k = 0; k < 20; k++) { add_neighbor(30 + k, 2 + k); }
  for (int j = 0; j < 20; j++) { hear_beat(30 + j, {3}, now + 10, clock_info(other, 7010 + j, 1)); }
  EspNowMeshSnapshotMake(EspNowMeshDriver.node);
  say("EspNowMeshClock", "0");
  CmndEspNowMeshClock();
  CHECK(json_ok(g_response) && g_response.size() < 1040, "with twenty one neighbours a page fits");
  printf("   a page is %zu bytes\n", g_response.size());
  say("EspNowMeshClock", "18");
  CmndEspNowMeshClock();
  CHECK(json_ok(g_response) && g_response.find("\"From\":18") != std::string::npos && g_response.find("\"Sync\":1") != std::string::npos, "paged, and a neighbour's synced bit is there");

  // the neighbours, for Berry: what each one's last heartbeat carried, and how long ago
  CHECK(g_berry_functions.count("espnow_mesh_neighbors") == 1, "the neighbours function is registered");
  g_millis = now + 500;
  call("espnow_mesh_neighbors", {});
  const HostValue& list = vm.stack.back();
  CHECK(list.kind == 6 && list.items.size() == 21, "a list with a map for each of the 21 neighbours");
  const HostValue* ten = nullptr;
  const HostValue* thirty = nullptr;
  for (const HostValue& item : list.items) {
    if (item.m.count("id") && item.m.at("id") == 10) { ten = &item; }
    if (item.m.count("id") && item.m.at("id") == 30) { thirty = &item; }
  }
  CHECK(ten && ten->m.at("state") == 0 && ten->m.at("seen") == 2 && ten->m.at("skew") == 4 && ten->m.at("rssi") == -60, "the one that was followed: alive, in the same timeline, 4 ms ahead when its heartbeat came");
  CHECK(ten && ten->ms.at("info").size() == 40 && ten->ms.at("info").rfind("010A00000007", 0) == 0, "with the 20 bytes of its heartbeat as hex, the layout and its timeline first");
  CHECK(ten && ten->m.at("beat") == 495 && ten->m.at("age") == 495, "and the ms since it was heard, read now: the heartbeat came at +5 and it is +500");
  CHECK(thirty && thirty->ms.at("info").substr(38, 2) == "01", "a neighbour that said it is synced has the bit in the flags");
  int64_t ten_hears = -1;
  for (uint32_t i = 0; i < EspNowMeshDriver.snapshot->neighbors; i++) {
    if (EspNowMeshDriver.snapshot->neighbor[i].id == 10) { ten_hears = EspNowMeshDriver.snapshot->neighbor[i].hears; }
  }
  CHECK(ten && ten->m.count("hears") && ten->m.at("hears") == ten_hears, "and how many nodes its heartbeat says it hears, as the task saw it");
  berry.vm = nullptr;
  end_world();

  // the clock the main loop reads is the one of the timeline the rules were told of: with the lock held the clock cannot be made and the event waits
  make_world(true);
  g_beat_counter = 0;
  turn(t0);
  add_neighbor(10, 1);
  turn(t0 + 1000);
  EspNowMeshDriver.lock->count = 0;            // the main loop is reading
  hear_beat(10, {3}, t0 + 1003, clock_info(other, 1003 + 7000));
  turn(t0 + 1003);
  CHECK(uxQueueSpacesAvailable(EspNowMeshDriver.note) == ESPNOW_MESH_NOTE_DEPTH, "with the clock not made, what it tells is not moved to the main loop's queue");
  CHECK(EspNowMeshDriver.clock_point.adopted == false, "the clock the main loop would read is still the one of the old timeline");
  EspNowMeshDriver.lock->count = 1;
  turn(t0 + 1010);
  CHECK(uxQueueSpacesAvailable(EspNowMeshDriver.note) < ESPNOW_MESH_NOTE_DEPTH, "when it is, it is");
  CHECK(EspNowMeshDriver.clock_point.adopted && !memcmp(EspNowMeshDriver.clock_point.timeline, other, 5), "and the clock is already of the new timeline");
  g_rules.clear();
  EspNowMeshDrainEvents();
  CHECK(!rules_with("\"Timeline\":{").empty(), "the rules have it");
  end_world();

  // a timeline that has a lower identity and is behind this device's by more than the band (30 ms: the frames take a while in each direction, and the two sides see the
  // difference of two timelines of about the same age on either side of the band) is taken when the third heartbeat of the same neighbour in a row shows it, and the time of
  // the device does not go back, so the rules are told of no move; one that has a higher identity is not taken at all
  make_world(true);
  g_beat_counter = 0;
  own_timeline(own);
  ToHex_P(own, 5, own_hex, sizeof(own_hex));
  turn(t0);
  uint8_t lower[5] = {2, 0, 0, 0, 1};
  uint8_t higher[5] = {5, 0, 0, 0, 1};
  add_neighbor(2, 1);
  add_neighbor(5, 1);
  g_rules.clear();
  EspNowMeshDrainEvents();
  for (uint32_t k = 0; k < 3; k++) {
    uint32_t at = t0 + 3000 + 5000 * k;
    turn(at);
    hear_beat(5, {3}, at + 3, clock_info(higher, (at + 3 - t0) - 30));
    turn(at + 3);
    hear_beat(2, {3}, at + 4, clock_info(lower, (at + 4 - t0) - 30));
    turn(at + 4);
    g_rules.clear();
    EspNowMeshDrainEvents();
    if (k < 2) {
      CHECK(rules_with("\"Timeline\":{").empty() && !EspNowMeshDriver.clock_point.adopted, "one or two heartbeats of the lower timeline 30 ms behind do not take it, and the higher one is never taken");
    } else {
      snprintf(want, sizeof(want), "{\"EspNowMesh\":{\"Timeline\":{\"Old\":\"%s\",\"New\":\"0200000001\",\"Ticks\":0,\"Delta\":\"0\",\"Synced\":1}}}", own_hex);
      CHECK(rules_with("\"Timeline\":{") == want, "the third takes it, with no move of the time: 0 ticks and 0 ms");
      CHECK(EspNowMeshDriver.clock_point.adopted && !memcmp(EspNowMeshDriver.clock_point.timeline, lower, 5), "the clock the main loop reads is of that timeline");
      CHECK(EspNowMesh::ClockAt(EspNowMeshDriver.clock_point, at + 4) == (uint64_t)(at + 4 - t0), "and its time is where it was: it did not go back");
    }
  }
  end_world();

  // not running: nothing to read
  bvm vm3;
  berry.vm = &vm3;
  EspNowMeshDriver.running = false;
  for (const char* name : {"espnow_mesh_clock", "espnow_mesh_stamp"}) {
    vm3.stack.clear();
    g_berry_functions[name](&vm3);
    CHECK(vm3.stack.back().kind == 2 && vm3.stack.back().i == 0, "with the task not running the clock function gives false");
  }
  vm3.stack = {{4, 0, std::string(6, 'x')}};
  g_berry_functions["espnow_mesh_age"](&vm3);
  CHECK(vm3.stack.back().kind == 2 && vm3.stack.back().i == 0, "and so does the age");
  vm3.stack.clear();
  g_berry_functions["espnow_mesh_neighbors"](&vm3);
  CHECK(vm3.stack.back().kind == 2 && vm3.stack.back().i == 0, "and the neighbours");
  berry.vm = nullptr;
  say("EspNowMeshClock", "");
  CmndEspNowMeshClock();
  CHECK(g_response == "{\"EspNowMeshClock\":\"not running\"}", "and the command says so");
}
