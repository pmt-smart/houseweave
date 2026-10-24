// Tests of the stage that makes the application ready, the queues of the main loop and the tickets of the sends. Included by host_test.cpp.

// ---- a world with a peer: node 2, a core of its own on the same cipher, talking to the driver's node 3
static uint8_t g_peer_mac[6] = {2, 0, 0, 0, 0, 2};
static EspNowMesh::Node g_peer;
static EspNowMesh::Crypto g_peer_crypto;
static uint8_t g_peer_secret[32];
static uint8_t g_peer_pub[32];
static uint8_t g_group_key[32];
static uint8_t g_drv_pub[32];
static uint32_t g_now_ms = 5000;
static uint8_t peer_node_of(void*, const uint8_t mac[6]) { return memcmp(mac, g_own_mac, 6) ? 0 : 3; }
static uint32_t peer_rand(void*) { return esp_random(); }
static std::vector<EspNowMesh::Delivery> g_peer_got;
static bool g_peer_deaf = false;            // the peer hears nothing of what the driver sends

static void drain_peer(void) { EspNowMesh::Delivery d; while (g_peer.PopDelivery(&d)) { g_peer_got.push_back(d); } }

// What the driver's radio sent since the last call goes to the peer; what the peer has to send goes to the driver's core
static void apply_ready(void) {
  if (EspNowMeshDriver.node->DeliverEnabled() != EspNowMeshDriver.app_ready) { EspNowMeshDriver.node->SetDeliverEnabled(EspNowMeshDriver.app_ready); }
}
static int air(uint32_t now) {
  int moved = 0;
  g_millis = now;
  apply_ready();
  for (size_t i = 0; i < g_sent.size(); i++) {
    if (!g_peer_deaf) { g_peer.OnReceive(g_sent[i].second.data(), g_sent[i].second.size(), g_own_mac, -50, now, false); }
    moved++;
  }
  g_sent.clear();
  uint8_t frame[EspNowMesh::kMaxFrame], to[6];
  size_t len = 0;
  while (g_peer.NextTx(now, frame, &len, to)) {
    EspNowMeshDriver.node->OnReceive(frame, len, g_peer_mac, -50, now, false);
    g_peer.TxDone(true, now);
    moved++;
  }
  drain_peer();
  return moved;
}

// One turn of the task, as it goes: the commands, the core, the radio, what the core has for the main loop
static void turn(uint32_t now) {
  g_millis = now;
  EspNowMeshCmd_t cmd;
  while (pdTRUE == xQueueReceive(EspNowMeshDriver.cmd, &cmd, 0)) { EspNowMeshDoCommand(EspNowMeshDriver.node, &cmd); }
  apply_ready();
  EspNowMeshDriver.node->Tick(now);
  EspNowMeshPump(EspNowMeshDriver.node);
  EspNowMeshDrain(EspNowMeshDriver.node);
}

static void make_world(bool ready) {
  reset_world();
  g_peer_deaf = false;
  memset(g_peer_secret, 0x42, 32);
  memset(g_group_key, 0x5A, 32);
  static const uint8_t base[32] = {9};
  EspNowMesh::Crypto::X25519(g_peer_pub, g_peer_secret, base);
  EspNowMeshSettingsLoad();
  EspNowMeshSettings.id = 3;
  EspNowMeshSettings.has_group = 1;
  EspNowMeshSettings.group_version = 1;
  memcpy(EspNowMeshSettings.group_key, g_group_key, 32);
  EspNowMeshSettings.node[0].id = 2;
  memcpy(EspNowMeshSettings.node[0].mac, g_peer_mac, 6);
  memcpy(EspNowMeshSettings.node[0].pub, g_peer_pub, 32);
  EspNowMeshDriver.app_ready = ready;
  g_task_fail = false;
  if (!EspNowMeshStartAttempt()) { printf("the world did not start\n"); exit(2); }
  EspNowMesh::Crypto::X25519(g_drv_pub, EspNowMeshSettings.secret, base);
  EspNowMeshApplyShared(EspNowMeshDriver.node, EspNowMeshDriver.shared);
  EspNowMeshDriver.node->SetDeliverEnabled(ready);
  // the peer
  g_peer_crypto.Begin(g_peer_secret);
  g_peer_crypto.SetGroupKey(g_group_key, 1);
  g_peer_crypto.SetPeer(3, g_drv_pub);
  EspNowMesh::Config c;
  memset(&c, 0, sizeof(c));
  c.id = 2; c.epoch = 77; c.random = peer_rand; c.noStartSync = true;
  c.tag = EspNowMesh::Crypto::Tag; c.tagContext = &g_peer_crypto;
  c.proof = EspNowMesh::Crypto::Proof; c.proofContext = &g_peer_crypto;
  c.seal = EspNowMesh::Crypto::Seal; c.open = EspNowMesh::Crypto::Open; c.cipherContext = &g_peer_crypto;
  c.nodeOf = peer_node_of;
  g_peer.Begin(c);
  g_peer_got.clear();
  EspNowMeshDriver.node->SetSynced(2, 77, 0);
  g_peer.SetSynced(3, EspNowMeshSettings.epoch, 0);
  g_now_ms = 5000;
  g_sent.clear();
}
static void end_world(void) { free_node(); EspNowMeshDriver.running = false; }
static EspNowMeshCmd_t send_cmd(uint8_t dest, bool ack, const char* text) {
  EspNowMeshCmd_t cmd;
  memset(&cmd, 0, sizeof(cmd));
  cmd.op = ESPNOW_MESH_CMD_SEND;
  cmd.dest = dest;
  cmd.type = 0;
  cmd.flags = ack ? 1 : 0;
  cmd.len = (uint8_t)strlen(text);
  memcpy(cmd.data, text, cmd.len);
  return cmd;
}

static void test_ready(void) {
  printf("-- ready\n");
  make_world(false);
  // the peer sends a command with an answer asked: the application is not ready, so it is refused and not answered
  uint32_t counter = g_peer.Send(EspNowMesh::kCommand, 3, (const uint8_t*)"on", 2, true, g_now_ms);
  CHECK(counter != 0, "the peer queued a command");
  air(g_now_ms);
  turn(g_now_ms);
  CHECK(EspNowMeshDriver.node->stats().delivered == 0, "nothing was delivered");
  CHECK(EspNowMeshDriver.node->stats().inboxFull == 1, "it was refused");
  CHECK(EspNowMeshDriver.node->stats().acksSent == 0, "and not answered");
  CHECK(g_sent.empty(), "nothing went out");
  // the peer sends again, as it does after 100 ms: still refused
  g_now_ms += 100; g_peer.Tick(g_now_ms); air(g_now_ms); turn(g_now_ms);
  CHECK(EspNowMeshDriver.node->stats().inboxFull == 2 && EspNowMeshDriver.node->stats().acksSent == 0, "again");
  // the application says it is ready: the next attempt is taken
  EspNowMeshSetReady(true);
  CHECK(logged("The application is ready"), "the log says so");
  g_now_ms += 100; g_peer.Tick(g_now_ms); air(g_now_ms); turn(g_now_ms);
  CHECK(EspNowMeshDriver.node->stats().delivered == 1 && EspNowMeshDriver.node->stats().acksSent == 1, "the third attempt is delivered and answered");
  g_now_ms += 10; turn(g_now_ms); air(g_now_ms);
  EspNowMesh::Outcome o;
  CHECK(g_peer.PopOutcome(&o) && o.ok && o.counter == counter, "the peer was answered");
  g_rules.clear();
  EspNowMeshDrainEvents();
  CHECK(g_rules.size() == 1 && g_rules[0].find("\"From\":2,\"Type\":0,\"Dest\":3") != std::string::npos && g_rules[0].find("\"Data\":\"6F6E\"") != std::string::npos, "the rules had it");
  // the command
  say("EspNowMeshReady", "");
  CmndEspNowMeshReady();
  CHECK(g_response == "{\"EspNowMeshReady\":{\"Ready\":1}}", "EspNowMeshReady says so");
  say("EspNowMeshReady", "0");
  CmndEspNowMeshReady();
  CHECK(g_response == "{\"EspNowMeshReady\":{\"Ready\":0}}" && !EspNowMeshDriver.app_ready, "and takes it back");
  end_world();
}

// A frame the radio hands the task while it sends is taken before the next send of the same turn, and not at the turn's end
static void test_rx_between_sends(void) {
  puts("-- a frame heard while the task sends");
  make_world(true);
  g_millis = g_now_ms;
  EspNowMeshCmd_t a = send_cmd(2, false, "a");
  EspNowMeshDoCommand(EspNowMeshDriver.node, &a);
  EspNowMeshCmd_t b = send_cmd(2, false, "b");
  EspNowMeshDoCommand(EspNowMeshDriver.node, &b);
  uint32_t counter = g_peer.Send(EspNowMesh::kCommand, 3, (const uint8_t*)"on", 2, false, g_now_ms);
  uint8_t frame[EspNowMesh::kMaxFrame], to[6];
  size_t len = 0;
  bool has = counter != 0 && g_peer.NextTx(g_now_ms, frame, &len, to);
  CHECK(has, "the peer has a frame on the air");
  g_peer.TxDone(true, g_now_ms);
  EspNowMeshEnqueue(g_peer_mac, -50, frame, (int)len);
  CHECK(uxQueueSpacesAvailable(EspNowMeshDriver.rx) == ESPNOW_MESH_RX_DEPTH - 1, "the radio put it in the task's queue");
  uint32_t heard = EspNowMeshDriver.node->stats().heard;
  g_now_ms += 50;
  g_millis = g_now_ms;
  EspNowMeshDriver.node->Tick(g_now_ms);
  EspNowMeshPump(EspNowMeshDriver.node);
  CHECK(!g_sent.empty(), "the task sent its frames");
  CHECK(EspNowMeshDriver.node->stats().heard == heard + 1, "and took the one heard meanwhile in the same turn");
  CHECK(uxQueueSpacesAvailable(EspNowMeshDriver.rx) == ESPNOW_MESH_RX_DEPTH, "the queue is empty again");
  CHECK(uxQueueSpacesAvailable(EspNowMeshDriver.event) == ESPNOW_MESH_EVENT_DEPTH - 1, "and what it held for the application went on to the main loop in the same turn");
  end_world();
}

// Frames for the application piled up in the radio's queue while the task sent: each is handed on as it is taken, and the core's inbox of 8
// refuses none of twelve
static void test_rx_pile(void) {
  puts("-- a pile of frames for the application");
  make_world(true);
  g_millis = g_now_ms;
  uint8_t frame[EspNowMesh::kMaxFrame], to[6];
  size_t len = 0;
  for (int i = 0; i < 12; i++) {
    g_peer.Send(EspNowMesh::kCommand, 3, (const uint8_t*)"x", 1, false, g_now_ms);
    if (g_peer.NextTx(g_now_ms, frame, &len, to)) {
      g_peer.TxDone(true, g_now_ms);
      EspNowMeshEnqueue(g_peer_mac, -50, frame, (int)len);
    }
  }
  CHECK(uxQueueSpacesAvailable(EspNowMeshDriver.rx) == ESPNOW_MESH_RX_DEPTH - 12, "twelve frames wait in the radio's queue");
  EspNowMeshTakeFrames(EspNowMeshDriver.node);
  CHECK(EspNowMeshDriver.node->stats().inboxFull == 0, "the core's inbox refused none");
  CHECK(uxQueueSpacesAvailable(EspNowMeshDriver.event) == ESPNOW_MESH_EVENT_DEPTH - 12, "and the twelve are on their way to the main loop");
  end_world();
}

static void test_drain(void) {
  printf("-- drain\n");
  make_world(true);
  // commands with an answer asked, in bursts, with the main loop not looking: the core has 8 places, the queue 8
  int sent = 0;
  std::map<uint32_t, int> index_of;
  std::vector<int> answered;
  auto collect = [&]() {
    EspNowMesh::Outcome o;
    while (g_peer.PopOutcome(&o)) { if (o.ok && index_of.count(o.counter)) { answered.push_back(index_of[o.counter]); } }
  };
  for (int round = 0; round < 8; round++) {
    for (int i = 0; i < 4; i++) {
      uint8_t p[2] = {'p', (uint8_t)sent};
      uint32_t c = g_peer.Send(EspNowMesh::kCommand, 3, p, 2, true, g_now_ms);
      if (c) { index_of[c] = sent; sent++; }
    }
    air(g_now_ms);
    turn(g_now_ms);
    g_now_ms += 100;
    g_peer.Tick(g_now_ms);
    collect();
  }
  CHECK(sent >= 16, "at least 16 sends went");
  CHECK(uxQueueSpacesAvailable(EspNowMeshDriver.event) == 0, "the queue to the main loop is full");
  CHECK(EspNowMeshCount.evt_full > 0, "and the driver counted it");
  CHECK(EspNowMeshDriver.node->stats().inboxFull > 0, "the core refused some for want of room");
  // the main loop runs now: what was answered comes, once, with nothing dropped
  std::vector<int> seen;
  for (int round = 0; round < 12; round++) {
    g_rules.clear();
    EspNowMeshDrainEvents();
    for (auto& r : g_rules) {
      size_t at = r.find("\"Data\":\"70");
      size_t fa = r.find("\"Flags\":");
      bool repeat = fa != std::string::npos && (atoi(r.c_str() + fa + 8) & 2);       // a resend of what the application has had: it is told so
      if (at != std::string::npos && !repeat) { seen.push_back(std::stoi(r.substr(at + 10, 2), nullptr, 16)); }
    }
    turn(g_now_ms);
    air(g_now_ms);
    g_now_ms += 100;
    g_peer.Tick(g_now_ms);
    air(g_now_ms);
    collect();
  }
  CHECK(answered.size() >= 8, "at least 8 were answered, as the peer saw");
  std::vector<bool> got(256, false);
  bool once = true;
  for (size_t i = 0; i < seen.size(); i++) { if (got[seen[i]]) { once = false; } got[seen[i]] = true; }
  CHECK(once, "none reached the rules twice as new");
  bool all = true;
  for (size_t i = 0; i < answered.size(); i++) { if (!got[answered[i]]) { all = false; printf("   answered %d never reached the rules\n", answered[i]); } }
  CHECK(all, "everything that was answered reached the rules");
  printf("   sent %d, answered %zu, reached the rules %zu, refused by the core %u, turns found full %u\n", sent, answered.size(), seen.size(), EspNowMeshDriver.node->stats().inboxFull, EspNowMeshCount.evt_full);
  end_world();
}

static void test_notes(void) {
  printf("-- notes\n");
  make_world(true);
  // the queue of frames and the inbox full of frames the main loop has not taken
  for (int i = 0; i < 24; i++) {
    uint8_t p[2] = {'p', (uint8_t)i};
    g_peer.Send(EspNowMesh::kEvent, 3, p, 2, false, g_now_ms);
    air(g_now_ms);
    turn(g_now_ms);
  }
  CHECK(uxQueueSpacesAvailable(EspNowMeshDriver.event) == 0, "the queue of frames is full");
  // the driver sends a command nobody answers: its outcome has to reach the main loop all the same
  EspNowMeshCmd_t cmd = send_cmd(2, true, "x");
  int32_t queued = EspNowMeshQueueCommand(&cmd);
  CHECK(queued == ESPNOW_MESH_QUEUED && cmd.ticket != 0, "queued with a ticket");
  uint32_t ticket = cmd.ticket;
  g_peer_deaf = true;
  for (int i = 0; i < 6; i++) {
    g_now_ms += 100;
    turn(g_now_ms);
    air(g_now_ms);
  }
  CHECK(uxQueueSpacesAvailable(EspNowMeshDriver.note) < ESPNOW_MESH_NOTE_DEPTH, "an outcome is waiting in the queue of notes");
  g_rules.clear();
  EspNowMeshDrainEvents();
  bool outcome = false;
  for (auto& r : g_rules) {
    char want[80];
    snprintf(want, sizeof(want), "\"Outcome\":{\"Counter\":%u,", ticket);
    if (r.find(want) != std::string::npos && r.find("\"Ok\":0,\"Attempts\":3") != std::string::npos) { outcome = true; }
  }
  CHECK(outcome, "the outcome came with the ticket, not answered after 3 attempts");
  CHECK(g_rules.size() >= 2, "and the frames came too");
  end_world();
}

static void test_tickets(void) {
  printf("-- tickets\n");
  make_world(true);
  EspNowMeshCmd_t cmd = send_cmd(2, true, "hello");
  CHECK(ESPNOW_MESH_QUEUED == EspNowMeshQueueCommand(&cmd), "a send is queued");
  uint32_t t1 = cmd.ticket;
  EspNowMeshCmd_t cmd2 = send_cmd(2, true, "again");
  CHECK(ESPNOW_MESH_QUEUED == EspNowMeshQueueCommand(&cmd2) && cmd2.ticket == t1 + 1, "the next has the next ticket");
  EspNowMeshCmd_t refused = send_cmd(9, true, "nobody");     // no key for node 9
  CHECK(ESPNOW_MESH_QUEUED == EspNowMeshQueueCommand(&refused), "one for a node with no key is queued too");
  uint32_t t3 = refused.ticket;
  turn(g_now_ms);
  // the core refused the third: its outcome is there, with the ticket, no attempts
  g_rules.clear();
  EspNowMeshDrainEvents();
  char want[160];
  snprintf(want, sizeof(want), "{\"EspNowMesh\":{\"Outcome\":{\"Counter\":%u,\"Frame\":0,\"Dest\":9,\"Ok\":0,\"Attempts\":0,\"QueueUs\":0,\"RttUs\":0}}}", t3);
  CHECK(g_rules.size() == 1 && g_rules[0] == want, "the refusal has an outcome of its own");
  CHECK(EspNowMeshCount.refused == 1, "counted");
  // the first two went to the radio and to the peer, which answers them; the outcomes carry the tickets
  for (int i = 0; i < 4; i++) { air(g_now_ms); g_now_ms += 5; turn(g_now_ms); air(g_now_ms); }
  turn(g_now_ms);
  g_rules.clear();
  EspNowMeshDrainEvents();
  std::vector<uint32_t> tickets;
  for (auto& r : g_rules) {
    size_t at = r.find("\"Outcome\":{\"Counter\":");
    if (at != std::string::npos && r.find("\"Ok\":1") != std::string::npos) { tickets.push_back((uint32_t)atoi(r.c_str() + at + 21)); }
  }
  CHECK(tickets.size() == 2 && tickets[0] == t1 && tickets[1] == t1 + 1, "the two that went were answered, as the tickets said");
  // a send to everyone with the answer asked has no outcome
  EspNowMeshCmd_t all = send_cmd(255, true, "all");
  EspNowMeshQueueCommand(&all);
  turn(g_now_ms);
  air(g_now_ms);
  g_now_ms += 500;
  turn(g_now_ms);
  g_rules.clear();
  EspNowMeshDrainEvents();
  bool any = false;
  for (auto& r : g_rules) { if (r.find("Outcome") != std::string::npos) { any = true; } }
  CHECK(!any, "a frame for everyone has no outcome");
  end_world();
}

// The outcome says, from the task's own clock, how long the send waited for the task and how long from the core's hand-over to the answer
static void test_outcome_times(void) {
  printf("-- outcome times\n");
  make_world(true);
  g_millis = g_now_ms;
  EspNowMeshCmd_t cmd = send_cmd(2, true, "timed");
  CHECK(ESPNOW_MESH_QUEUED == EspNowMeshQueueCommand(&cmd), "a send is queued");
  g_now_ms += 7;
  turn(g_now_ms);                  // the task takes it 7 ms later, hands it to the core, and the radio has it
  g_now_ms += 5;
  air(g_now_ms);                   // the peer has it and answers, and the answer reaches the core
  turn(g_now_ms);                  // the outcome is taken out of the core 5 ms after the hand-over
  g_rules.clear();
  EspNowMeshDrainEvents();
  bool timed = false;
  for (auto& r : g_rules) {
    if (r.find("\"Ok\":1,\"Attempts\":1,\"QueueUs\":7000,\"RttUs\":5000}") != std::string::npos) { timed = true; }
  }
  CHECK(timed, "the outcome says the 7 ms the send waited for the task and the 5 ms of its round trip");
  bool logged = false;
  for (auto& l : g_log) { if (l.find("was answered after 1 attempts, in 5.0 ms") != std::string::npos) { logged = true; } }
  CHECK(logged, "and the log line says the round trip in ms");
  end_world();
}

static void test_queue_busy(void) {
  printf("-- busy\n");
  make_world(true);
  EspNowMeshCmd_t cmd = send_cmd(2, false, "a");
  int queued = 0;
  for (int i = 0; i < 6; i++) { if (ESPNOW_MESH_QUEUED == EspNowMeshQueueCommand(&cmd)) { queued++; } }
  CHECK(queued == ESPNOW_MESH_CMD_DEPTH, "the queue takes 4");
  CHECK(ESPNOW_MESH_BUSY == EspNowMeshQueueCommand(&cmd), "then says busy");
  CHECK(EspNowMeshCount.cmd_busy >= 2, "and counts it");
  CHECK(g_notified >= 4, "the task is woken for each command");
  say("EspNowMeshSend", "2,0,0,hello");
  CmndEspNowMeshSend();
  CHECK(g_response == "{\"EspNowMeshSend\":\"busy\"}", "the command says busy, not 'not running'");
  say("EspNowMeshInfo", "AABB");
  CmndEspNowMeshInfo();
  CHECK(g_response == "{\"EspNowMeshInfo\":\"busy\"}", "and so does Info");
  turn(g_now_ms);
  say("EspNowMeshSend", "2,0,1,hello");
  CmndEspNowMeshSend();
  CHECK(g_response.find("{\"EspNowMeshSend\":{\"Queued\":1,\"Counter\":") == 0, "with room the command answers with the ticket");
  // too long for a node alone: 221 bytes
  std::string big(221, 'x');
  say("EspNowMeshSend", ("2,0,1," + big).c_str());
  CmndEspNowMeshSend();
  CHECK(g_response == "{\"EspNowMeshSend\":\"too long\",\"Max\":220}", "221 bytes to a node do not go: the most is 220");
  std::string ok(220, 'x');
  turn(g_now_ms);
  say("EspNowMeshSend", ("2,0,0," + ok).c_str());
  CmndEspNowMeshSend();
  CHECK(g_response.find("Queued") != std::string::npos, "220 do");
  turn(g_now_ms);
  say("EspNowMeshSend", ("255,2,0," + std::string(228, 'y')).c_str());
  CmndEspNowMeshSend();
  CHECK(g_response.find("Queued") != std::string::npos, "and 228 to everyone");
  end_world();
  say("EspNowMeshSend", "2,0,1,hello");
  CmndEspNowMeshSend();
  CHECK(g_response == "{\"EspNowMeshSend\":\"not running\"}", "with the task not running it says so");
}

static void test_berry(void) {
  printf("-- berry\n");
  make_world(false);
  bvm vm;
  berry.vm = &vm;
  g_berry_functions.clear();
  EspNowMeshBerryRegister();
  CHECK(g_berry_functions.count("espnow_mesh_send") && g_berry_functions.count("espnow_mesh_info") && g_berry_functions.count("espnow_mesh_ready") && g_berry_functions.count("espnow_mesh_max_payload"), "the four entry points are registered");
  auto call = [&](const char* name, std::vector<HostValue> args) {
    vm.stack = args;
    vm.raised = false;
    return g_berry_functions[name](&vm);
  };
  call("espnow_mesh_max_payload", {{1, 2, ""}});
  CHECK(!vm.stack.empty() && vm.stack.back().i == 220, "220 bytes to a node");
  call("espnow_mesh_max_payload", {{1, 255, ""}});
  CHECK(vm.stack.back().i == 228, "and 228 to everyone");
  call("espnow_mesh_max_payload", {{3, 0, "x"}});
  CHECK(vm.raised, "a destination that is not a number is an error");
  call("espnow_mesh_send", {{1, 2, ""}, {1, 0, ""}, {2, 1, ""}, {3, 0, "hi"}});
  CHECK(vm.stack.back().kind == 1 && vm.stack.back().i >= 1, "a send gives its ticket");
  int64_t t = vm.stack.back().i;
  call("espnow_mesh_send", {{1, 2, ""}, {1, 0, ""}, {2, 0, ""}, {3, 0, "hi"}});
  CHECK(vm.stack.back().kind == 1 && vm.stack.back().i == t + 1, "and the next gives the next");
  call("espnow_mesh_send", {{1, 2, ""}, {1, 0, ""}, {2, 0, ""}, {3, 0, std::string(221, 'z')}});
  CHECK(vm.stack.back().kind == 2 && vm.stack.back().i == 0, "221 bytes to a node: false");
  call("espnow_mesh_send", {{1, 255, ""}, {1, 2, ""}, {2, 0, ""}, {3, 0, std::string(228, 'z')}});
  CHECK(vm.stack.back().kind == 1, "228 to everyone: a ticket");
  call("espnow_mesh_send", {{1, 300, ""}, {1, 0, ""}, {2, 0, ""}, {3, 0, "a"}});
  CHECK(vm.stack.back().kind == 2 && vm.stack.back().i == 0, "a destination of 300: false");
  call("espnow_mesh_send", {{1, 2, ""}, {1, 4, ""}, {2, 0, ""}, {3, 0, "a"}});
  CHECK(vm.stack.back().kind == 2 && vm.stack.back().i == 0, "the heartbeat type: false");
  call("espnow_mesh_send", {{1, 2, ""}, {1, 0, ""}, {2, 0, ""}, {3, 0, "a"}});
  CHECK(vm.stack.back().kind == 1, "the fourth fills the queue");
  call("espnow_mesh_send", {{1, 2, ""}, {1, 0, ""}, {2, 0, ""}, {3, 0, "a"}});
  CHECK(vm.stack.back().kind == 2 && vm.stack.back().i == 0, "with the queue full: false");
  // ready
  CHECK(!EspNowMeshDriver.app_ready, "the application is not ready");
  call("espnow_mesh_info", {{3, 0, "ab"}});
  CHECK(EspNowMeshDriver.app_ready, "the first info says it is");
  call("espnow_mesh_ready", {{2, 0, ""}});
  CHECK(!EspNowMeshDriver.app_ready, "ready(false) takes it back");
  call("espnow_mesh_ready", {});
  CHECK(EspNowMeshDriver.app_ready && vm.stack.back().i == 1, "ready() says it");
  // BrRestart: a new machine has none of it
  vm.globals.clear();
  EspNowMeshBerryCheck();
  CHECK(vm.globals.count("espnow_mesh_send") == 1 && !EspNowMeshDriver.app_ready, "a new machine gets the entry points again, and the application is not ready");
  g_log.clear();
  EspNowMeshBerryCheck();
  CHECK(g_log.empty(), "a machine that has them is let alone");
  // without Berry running there is nothing to wait for
  berry.vm = nullptr;
  EspNowMeshDriver.app_ready = false;
  Xdrv100(FUNC_INIT);
  CHECK(EspNowMeshDriver.app_ready, "with no Berry machine the rules are all there is, and are there");
  berry.vm = &vm;
  Xdrv100(FUNC_INIT);
  CHECK(!EspNowMeshDriver.app_ready, "with one, the frames wait for it");
  berry.vm = nullptr;
  end_world();
}
