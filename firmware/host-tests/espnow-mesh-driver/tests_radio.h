// Tests of the stage that shares the radio: the peer table, the late word, the failures counted, the hooks of the direct link.

static void mac_of(int i, uint8_t* out) { out[0] = 2; out[1] = 0; out[2] = 0; out[3] = 0; out[4] = (uint8_t)(i >> 8); out[5] = (uint8_t)i; }
static bool unicast(int i) {
  uint8_t mac[6];
  mac_of(i, mac);
  uint8_t frame[30] = {0x41};
  return EspNowMeshRadioSend(mac, frame, sizeof(frame));
}
static bool broadcast_frame(void) {
  uint8_t frame[30] = {0x41};
  return EspNowMeshRadioSend(EspNowMeshBroadcast, frame, sizeof(frame));
}
static bool has_peer(int i) { uint8_t mac[6]; mac_of(i, mac); return esp_now_is_peer_exist(mac); }

static void test_peers(void) {
  printf("-- peers\n");
  make_world(true);
  CHECK(esp_now_is_peer_exist(EspNowMeshBroadcast), "the broadcast address is a peer from the start");
  CHECK(g_peers.size() == 1, "and the only one");
  // 19 neighbours fill the table of 20, each sent to after the last was left alone for a while
  for (int i = 1; i <= 19; i++) { g_millis += 4000; CHECK(unicast(i), "a frame to a new neighbour goes"); }
  CHECK(g_peers.size() == 20, "the table is full");
  CHECK(EspNowMeshCount.peer_evicted == 0, "with none given up");
  // peer 1 is sent to again: peer 2 is now the one that has gone unused longest
  g_millis += 4000;
  CHECK(unicast(1), "the first neighbour is sent to again");
  g_millis += 4000;
  CHECK(unicast(20), "a 20th neighbour goes");
  CHECK(!has_peer(2), "and the one that was unused the longest left");
  CHECK(has_peer(1) && has_peer(3) && has_peer(20), "the others did not");
  CHECK(EspNowMeshCount.peer_evicted == 1, "one given up, counted");
  CHECK(esp_now_is_peer_exist(EspNowMeshBroadcast), "never the broadcast address");
  CHECK(g_peers.size() == 20, "the table is full again");
  // the neighbour that left is sent to again: it takes the place of the next one
  g_millis += 4000;
  CHECK(unicast(2), "a neighbour that was given up comes back");
  CHECK(!has_peer(3) && has_peer(2), "and takes the place of the next");

  // a neighbour used in the last few seconds is never the one that goes: fill with fresh ones
  for (int i = 100; i < 140; i++) { g_millis += 100; unicast(i); }
  size_t before = g_sent.size();
  uint32_t full = EspNowMeshCount.peer_full;
  bool went = unicast(500);
  CHECK(!went, "with every peer used within 3 s a new one is not added");
  CHECK(EspNowMeshCount.peer_full == full + 1 && g_sent.size() == before, "counted, and nothing was sent");
  g_millis += 4000;
  CHECK(unicast(500), "3 s later one is old enough to go");

  // the direct link's peer, which the mesh did not add, is never given up
  end_world();
  make_world(true);
  esp_now_peer_info_t direct = {};
  uint8_t dmac[6] = {0x10, 0x20, 0x30, 0x40, 0x50, 0x60};
  memcpy(direct.peer_addr, dmac, 6);
  direct.encrypt = true;
  CHECK(ESP_OK == esp_now_add_peer(&direct), "the direct link's peer is registered");
  for (int i = 1; i <= 60; i++) { g_millis += 4000; unicast(i); }
  CHECK(esp_now_is_peer_exist(dmac), "after 60 neighbours it is still there");
  CHECK(EspNowMeshCount.peer_evicted > 30, "many others went");
  // a frame to the direct link's peer uses it, and is no peer of the mesh's
  uint8_t frame[30] = {0x41};
  size_t sent = g_sent.size();
  CHECK(EspNowMeshRadioSend(dmac, frame, sizeof(frame)), "a frame to a neighbour that is the direct link's peer goes");
  CHECK(g_sent.size() == sent + 1 && EspNowMeshPeerFind(dmac) < 0, "over the peer that is there, which stays the direct link's");
  end_world();
}

static void test_failures(void) {
  printf("-- failures\n");
  make_world(true);
  g_send_error = ESP_ERR_ESPNOW_NO_MEM;
  CHECK(!unicast(1), "a unicast the radio refuses fails");
  CHECK(EspNowMeshCount.send_failed == 1 && EspNowMeshCount.bcast_failed == 0, "counted as a unicast");
  CHECK(!broadcast_frame(), "a broadcast the radio refuses fails");
  CHECK(EspNowMeshCount.bcast_failed == 1, "counted as a broadcast");
  CHECK(!EspNowMeshDriver.awaiting, "and no word is waited for");
  g_send_error = ESP_OK;
  g_add_error = ESP_ERR_ESPNOW_NO_MEM;
  CHECK(!unicast(2), "a neighbour the radio will not register fails");
  CHECK(EspNowMeshCount.peer_failed == 1, "counted");
  esp_now_del_peer(EspNowMeshBroadcast);
  EspNowMeshPeers[0].used = false;
  CHECK(!broadcast_frame(), "a broadcast address the radio will not register fails");
  CHECK(EspNowMeshCount.bcast_failed == 2, "counted as a broadcast");
  g_add_error = ESP_OK;
  CHECK(broadcast_frame() && esp_now_is_peer_exist(EspNowMeshBroadcast), "and when it will, the address is put back");
  // the neighbour does not acknowledge
  g_send_status = ESP_NOW_SEND_FAIL;
  CHECK(!unicast(3), "a unicast the neighbour did not acknowledge fails");
  CHECK(EspNowMeshCount.not_acked == 1, "counted");
  broadcast_frame();
  CHECK(EspNowMeshCount.not_acked == 1, "a broadcast that the radio says failed is not counted as unacknowledged");
  g_send_status = ESP_NOW_SEND_SUCCESS;
  CHECK(broadcast_frame(), "and one it takes is sent");
  // the radio is not there
  EspNowMeshDriver.radio_lost = true;
  size_t sent = g_sent.size();
  CHECK(!unicast(3) && !broadcast_frame() && g_sent.size() == sent, "with the WiFi stack stopped nothing is sent");
  EspNowMeshDriver.radio_lost = false;
  CHECK(unicast(3), "and when it is back it is");
  end_world();
}

static void test_late_word(void) {
  printf("-- late word\n");
  make_world(true);
  g_send_silent = true;
  CHECK(!unicast(7), "no word from the radio: not acknowledged");
  CHECK(EspNowMeshCount.wait_expired == 1 && EspNowMeshDriver.late_pending, "the wait ran out, and a late word is expected");
  CHECK(!EspNowMeshDriver.awaiting, "the task does not wait");
  uint8_t mac7[6], mac8[6], direct[6] = {0x10, 0x20, 0x30, 0x40, 0x50, 0x60};
  mac_of(7, mac7);
  mac_of(8, mac8);
  // the direct link's frame to its own peer is no late word of ours
  CHECK(!EspNowMeshSendResult(direct, true), "the word of a direct link's frame is not the mesh's");
  CHECK(EspNowMeshCount.late_word == 0 && EspNowMeshDriver.late_pending, "and counts for nothing");
  // the late word comes: counted, and the direct link is told it is not its own
  g_millis += 300;
  CHECK(EspNowMeshSendResult(mac7, true), "the late word is the mesh's");
  CHECK(EspNowMeshCount.late_word == 1 && !EspNowMeshDriver.late_pending, "counted once");
  CHECK(EspNowMeshCount.late_ok == 1, "and as a frame that was acknowledged after all");
  CHECK(!EspNowMeshSendResult(mac7, true), "a second word is nobody's of the mesh's");
  // while the next send waits, the word of another frame is not its word
  g_send_silent = false;
  EspNowMeshDriver.awaiting = true;
  memcpy(EspNowMeshDriver.send_to, mac8, 6);
  CHECK(!EspNowMeshSendResult(direct, true) && EspNowMeshDriver.awaiting, "the word of a direct link's frame is not taken for the send that waits");
  CHECK(EspNowMeshSendResult(mac8, true) && !EspNowMeshDriver.awaiting && EspNowMeshDriver.send_ok, "the word for the frame that waits is");
  // a late word that comes too late is nothing of ours
  g_send_silent = true;
  EspNowMeshDriver.awaiting = false;
  CHECK(!unicast(9), "another send gives up");
  g_millis += 5000;
  uint8_t mac9[6];
  mac_of(9, mac9);
  uint32_t late = EspNowMeshCount.late_word;
  CHECK(!EspNowMeshSendResult(mac9, true) && EspNowMeshCount.late_word == late, "a word that comes 5 s late is not counted as a late word, nor taken");
  CHECK(!EspNowMeshDriver.late_pending, "and nothing is waited for any more");
  end_world();
}

static void test_hooks(void) {
  printf("-- hooks\n");
  make_world(true);
  for (int i = 1; i <= 3; i++) { g_millis += 1000; unicast(i); }
  CHECK(EspNowMeshPeerFind(g_peers[1].data()) >= 0, "three neighbours are peers");
  // the direct link takes ESP-NOW apart: the mesh lets go of it first
  EspNowMeshDriver.own_radio = true;                 // the mesh had started it
  EspNowMeshDirectRadio(false);
  CHECK(!EspNowMeshDriver.radio && !EspNowMeshDriver.own_radio && !EspNowMeshDriver.direct_radio, "the radio is not the mesh's");
  size_t sent = g_sent.size();
  CHECK(!unicast(1) && !broadcast_frame() && g_sent.size() == sent, "nothing is sent while the direct link has it apart");
  bool tracked = false;
  for (int i = 0; i < ESP_NOW_MAX_TOTAL_PEER_NUM; i++) { if (EspNowMeshPeers[i].used) { tracked = true; } }
  CHECK(!tracked, "and what the mesh knew of its peers is forgotten");
  // the direct link has deinitialised and initialised it again: the table is empty, and the broadcast address is put back
  esp_now_deinit();
  esp_now_init();
  EspNowMeshDirectRadio(true);
  CHECK(EspNowMeshDriver.radio && EspNowMeshDriver.direct_radio && !EspNowMeshDriver.own_radio, "the mesh rides on the direct link's radio");
  CHECK(esp_now_is_peer_exist(EspNowMeshBroadcast), "the broadcast address is a peer again");
  CHECK(unicast(1) && has_peer(1), "a neighbour is added again when a frame goes to it");
  // an init that fails: the mesh is told, and starts its own radio at the next second
  EspNowMeshDirectRadio(false);
  CHECK(!EspNowMeshDriver.radio && !EspNowMeshDriver.direct_radio, "told that the radio is gone");
  g_log.clear();
  EspNowMeshSettings.enabled = 1;
  EspNowMeshEverySecond();
  CHECK(EspNowMeshDriver.radio && EspNowMeshDriver.own_radio, "the mesh starts its own at the next second");
  // the channels
  EspNowMeshSettings.channel = 11;
  g_ap_associated = false;
  g_channel = 6;
  EspNowMeshDriver.direct_radio = true;
  EspNowMeshApplyChannel();
  CHECK(g_channel == 6, "with the direct link's radio up, EspNowMeshChannel does not move the radio");
  EspNowMeshDriver.direct_radio = false;
  EspNowMeshApplyChannel();
  CHECK(g_channel == 11, "without it, it does");
  g_ap_associated = true;
  EspNowMeshSettings.channel = 0;
  end_world();
}

// the answers have to be JSON, and the status has to fit the message of the firmware (MESSZ 1040)
static bool json_ok(const std::string& s) {
  int depth = 0;
  bool in = false;
  for (size_t i = 0; i < s.size(); i++) {
    char c = s[i];
    if (c == '"' && (i == 0 || s[i - 1] != '\\')) { in = !in; }
    if (in) { continue; }
    if (c == '{' || c == '[') { depth++; }
    if (c == '}' || c == ']') { depth--; if (depth < 0) { return false; } }
  }
  return !in && depth == 0;
}

static void test_status(void) {
  printf("-- status\n");
  make_world(true);
  turn(g_now_ms);
  EspNowMeshSnapshotMake(EspNowMeshDriver.node);
  say("EspNowMeshStatus", "");
  CmndEspNowMeshStatus();
  printf("   status is %zu bytes\n", g_response.size());
  CHECK(json_ok(g_response), "the status is JSON");
  CHECK(g_response.size() < 1040, "and fits the message");
  const char* names[] = {"\"Ready\":1", "\"Peers\":", "\"InboxFull\":", "\"QueueFull\":", "\"NoRoute\":", "\"Stale\":", "\"Replayed\":", "\"Unsynced\":", "\"NoKey\":", "\"Covered\":", "\"SyncShed\":", "\"Stack\":"};
  for (auto n : names) { CHECK(g_response.find(n) != std::string::npos, n); }
  say("EspNowMeshStats", "");
  CmndEspNowMeshStats();
  printf("   stats page 0 is %zu bytes\n", g_response.size());
  CHECK(json_ok(g_response) && g_response.size() < 1040, "stats page 0 is JSON and fits");
  const char* names0[] = {"\"Page\":0", "\"CmdBusy\":", "\"EvtFull\":", "\"NoteLost\":", "\"Refused\":", "\"SendFailed\":", "\"BcastFailed\":", "\"WaitExpired\":", "\"LateWord\":", "\"LateOk\":", "\"PeerFull\":", "\"PeerEvicted\":", "\"NvsUsed\":270"};
  for (auto n : names0) { CHECK(g_response.find(n) != std::string::npos, n); }
  say("EspNowMeshStats", "1");
  CmndEspNowMeshStats();
  printf("   stats page 1 is %zu bytes\n", g_response.size());
  CHECK(json_ok(g_response) && g_response.size() < 1040, "stats page 1 is JSON and fits");
  CHECK(g_response.find("\"Routed\":") != std::string::npos && g_response.find("\"RouteFlooded\":") != std::string::npos, "and says the frames sent along a way, and the ones that went on flooded");
  CHECK(g_response.find("\"StartAsks\":") != std::string::npos && g_response.find("\"PiecesSent\":") != std::string::npos, "with the rest of the core's");
  say("EspNowMeshStats", "2");
  CmndEspNowMeshStats();
  CHECK(g_response == "{\"EspNowMeshStats\":\"page 0 or 1\"}", "there is no page 2");
  end_world();
  say("EspNowMeshStats", "");
  CmndEspNowMeshStats();
  CHECK(json_ok(g_response) && g_response.find("\"Running\":0") != std::string::npos && g_response.find("\"CmdBusy\":") != std::string::npos, "not running, the driver's counters are there");
  say("EspNowMeshStatus", "");
  CmndEspNowMeshStatus();
  CHECK(json_ok(g_response), "and so is the status");
  CHECK(g_peer_num_faults == 0, "with no peer count asked of an ESP-NOW that is down");

  // the direct link takes ESP-NOW down under a running mesh (EspNowEnable 0), and a status is asked before the mesh puts up its own: the
  // status of the house's Berry would read the peer count of a stack that is not there, and the bridge would restart
  make_world(true);
  EspNowMeshDirectRadio(true);
  EspNowMeshDirectRadio(false);
  esp_now_deinit();
  say("EspNowMeshStatus", "");
  CmndEspNowMeshStatus();
  CHECK(g_peer_num_faults == 0, "the direct link took ESP-NOW down: the status does not ask its peer count");
  CHECK(json_ok(g_response) && g_response.find("\"Peers\":0") != std::string::npos && g_response.find("\"Radio\":0") != std::string::npos, "and says 0 peers and no radio");
  end_world();
}

static void test_lock(void) {
  printf("-- lock\n");
  make_world(true);
  CHECK(EspNowMeshDriver.radio_lock != nullptr, "the radio has a lock");
  CHECK(unicast(1), "a send with the lock free goes");
  CHECK(EspNowMeshDriver.radio_lock->count == 1, "and gives it back");
  // the main loop has it, taking the radio apart: the task's send waits for it and gives up, and sends nothing
  xSemaphoreTake(EspNowMeshDriver.radio_lock, 0);
  size_t sent = g_sent.size();
  CHECK(!unicast(1) && !broadcast_frame() && g_sent.size() == sent, "with the lock held nothing is sent");
  CHECK(!EspNowMeshDriver.awaiting, "and nothing is waited for");
  xSemaphoreGive(EspNowMeshDriver.radio_lock);
  CHECK(unicast(1), "with the lock back it goes again");
  // each way out of a send gives the lock back
  g_send_error = ESP_ERR_ESPNOW_NO_MEM;
  unicast(1);
  g_send_error = ESP_OK;
  g_send_silent = true;
  unicast(1);
  g_send_silent = false;
  g_add_error = ESP_ERR_ESPNOW_NO_MEM;
  unicast(77);
  g_add_error = ESP_OK;
  EspNowMeshDriver.radio = false;
  unicast(1);
  EspNowMeshDriver.radio = true;
  CHECK(EspNowMeshDriver.radio_lock->count == 1, "a send that fails, one that gets no word and one that finds no radio give the lock back");
  // the radio lost between the first look and the lock: the task looks again
  EspNowMeshDirectRadio(false);
  CHECK(EspNowMeshDriver.radio_lock->count == 1, "the hook gives it back");
  end_world();
}

// the mesh stops while it rides on the direct link's radio: what it put in the table goes, what is the direct link's stays
static void test_ride_stop(void) {
  printf("-- ride and stop\n");
  make_world(true);
  EspNowMeshDirectRadio(false);                      // the direct link is about to take ESP-NOW apart
  esp_now_deinit();
  esp_now_init();
  EspNowMeshDirectRadio(true);                       // and has started it: the mesh rides on it
  esp_now_peer_info_t direct = {};
  uint8_t dmac[6] = {0x10, 0x20, 0x30, 0x40, 0x50, 0x60};
  memcpy(direct.peer_addr, dmac, 6);
  CHECK(ESP_OK == esp_now_add_peer(&direct), "the direct link's peer");
  for (int i = 1; i <= 3; i++) { g_millis += 1000; CHECK(unicast(i), "a frame to a neighbour"); }
  CHECK(g_peers.size() == 5 && EspNowMeshDriver.direct_radio && !EspNowMeshDriver.own_radio, "the table has the broadcast address, the direct link's peer and 3 neighbours");
  EspNowMeshRadioStop();
  CHECK(!has_peer(1) && !has_peer(2) && !has_peer(3), "the neighbours the mesh put in the table went with it");
  CHECK(esp_now_is_peer_exist(dmac) && esp_now_is_peer_exist(EspNowMeshBroadcast), "the direct link's peer and the broadcast address stay");
  CHECK(g_now_up, "and ESP-NOW is as the direct link has it");
  bool tracked = false;
  for (int i = 0; i < ESP_NOW_MAX_TOTAL_PEER_NUM; i++) { if (EspNowMeshPeers[i].used) { tracked = true; } }
  CHECK(!tracked, "and the mesh keeps no record of peers");
  EspNowMeshDriver.radio = true;
  end_world();
  // with its own radio, a stop deinitialises it, and the record goes with the table
  make_world(true);
  for (int i = 1; i <= 3; i++) { g_millis += 1000; unicast(i); }
  EspNowMeshRadioStop();
  CHECK(!g_now_up && g_peers.empty(), "with its own radio, the stop takes ESP-NOW apart");
  end_world();
  // a start that starts ESP-NOW forgets what it knew of an earlier table
  make_world(true);
  g_millis += 1000;
  unicast(1);
  EspNowMeshDriver.radio = false;
  EspNowMeshDriver.own_radio = false;
  EspNowMeshDriver.radio_lost = true;
  esp_now_deinit();                                  // the WiFi stack went, and the table with it
  EspNowMeshRadioStart();
  bool any = false;
  for (int i = 0; i < ESP_NOW_MAX_TOTAL_PEER_NUM; i++) { if (EspNowMeshPeers[i].used) { any = true; } }
  CHECK(!any && esp_now_is_peer_exist(EspNowMeshBroadcast), "a new start of the radio has a table with the broadcast address and no record of the old");
  end_world();
}

static void test_start_hint(void) {
  printf("-- hint\n");
  make_world(false);
  CHECK(logged("The frames for the application wait until it says it is ready"), "a start with the application not ready says how to say it");
  end_world();
  make_world(true);
  CHECK(!logged("wait until it says it is ready"), "a start with it ready does not");
  end_world();
}
