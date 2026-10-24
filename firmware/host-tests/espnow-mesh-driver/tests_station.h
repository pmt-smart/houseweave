// Tests of the station that keeps to the mesh's channel (xdrv_98_3_espnow_mesh_station.ino) and of the search for the nodes on the other
// channels (xdrv_98_4_espnow_mesh_search.ino). Included by host_test.cpp, after tests_queues.h, whose world (the driver, node 3, and its
// peer, node 2) they run in.

static const uint8_t kApNear[6] = {0xB1, 0, 0, 0, 0, 0x11};     // an access point of the house's network on the mesh's channel
static const uint8_t kApOff[6] = {0xB2, 0, 0, 0, 0, 0x06};      // and one on another channel

static void station_reset(void) {
  EspNowMeshStation.state = ESPNOW_MESH_STATION_WATCH;
  EspNowMeshStation.step = 0;
  EspNowMeshStation.off_channel = 0;
  memset(EspNowMeshStation.off_bssid, 0, 6);
  EspNowMeshStation.down_since = 0;
  EspNowMeshStation.next_try = 0;
  EspNowMeshStation.try_since = 0;
  EspNowMeshStation.wide_at = 0;
  EspNowMeshStation.probes = EspNowMeshStation.seen = EspNowMeshStation.wides = EspNowMeshStation.found = 0;
  EspNowMeshStation.parks = EspNowMeshStation.offs = 0;
  EspNowMeshStation.fails = 0;
  EspNowMeshStation.reason = 0;
  EspNowMeshStation.not_found = false;
}

static void search_reset(void) {
  EspNowMeshSearch.listening = false;
  EspNowMeshSearch.channel = 0;
  EspNowMeshSearch.best = 0;
  EspNowMeshSearch.best_count = 0;
  EspNowMeshSearch.best_rssi = -128;
  EspNowMeshSearch.dwell_since = 0;
  EspNowMeshSearch.watch_since = 0;
  EspNowMeshSearch.again_at = 0;
  EspNowMeshSearch.forced = false;
  EspNowMeshSearch.searches = EspNowMeshSearch.moves = 0;
  EspNowMeshSearch.found = 0;
}

static void add_ap(const char* ssid, int rssi, uint8_t channel, const uint8_t bssid[6]) {
  HostAp ap;
  ap.ssid = ssid;
  ap.rssi = rssi;
  ap.channel = channel;
  memcpy(ap.bssid, bssid, 6);
  g_aps.push_back(ap);
}

// The driver's world, its mesh on channel 11 and node 2 in its table, with the network "Cottage" saved and the station on it, on channel 11
static void station_world(void) {
  make_world(true);
  g_millis = 200000;
  EspNowMeshSettings.channel = 11;
  g_settings.flag4.network_wifi = 1;
  g_settings.sta_active = 0;
  Wifi.config_type = 0;
  Wifi.scan_state = 0;
  Wifi.retry_init = 4;
  Wifi.retry = 4;
  for (auto& t : g_settings_text) { t.clear(); }
  g_settings_text[SET_STASSID1] = "Cottage";
  g_settings_text[SET_STAPWD1] = "secret";
  g_aps.clear();
  g_scan_found.clear();
  g_scan_running = false;
  g_scan_refused = false;
  g_scan_channel = -1;
  g_scans = 0;
  g_auto_reconnect = true;
  g_disconnects = 0;
  g_begins = 0;
  g_begin_channel = -1;
  g_channel = 11;
  g_channel_sets = 0;
  g_ap_associated = true;
  g_wifi_status = WL_CONNECTED;
  memcpy(g_ap_bssid, kApNear, 6);
  station_reset();
  search_reset();
}

// The station loses its access point
static void station_down(void) {
  g_ap_associated = false;
  g_wifi_status = WL_DISCONNECTED;
}

static void station_event(uint8_t reason) {
  arduino_event_t e;
  e.event_id = ARDUINO_EVENT_WIFI_STA_DISCONNECTED;
  e.event_info.wifi_sta_disconnected.reason = reason;
  EspNowMeshStationEvent(&e);
}

static void second(void) {
  g_millis += 1000;
  Xdrv100(FUNC_EVERY_SECOND);
  Xdrv102(FUNC_EVERY_SECOND);
  Xdrv103(FUNC_EVERY_SECOND);
}

static void test_station_keeps_to_channel(void) {
  printf("-- the station keeps to the mesh's channel\n");
  // on an access point on the mesh's channel: nothing to do
  station_world();
  second();
  CHECK(EspNowMeshStation.state == ESPNOW_MESH_STATION_WATCH && g_disconnects == 0, "a station on the mesh's channel stays on its access point");

  // on an access point of another channel: it leaves it and parks, and the radio goes to the mesh's channel
  station_world();
  g_channel = 6;
  memcpy(g_ap_bssid, kApOff, 6);
  second();
  CHECK(g_disconnects == 1 && !g_auto_reconnect, "a station on another channel leaves its access point, with the stack's retries off");
  CHECK(EspNowMeshStation.state == ESPNOW_MESH_STATION_PARKED && EspNowMeshStationQuiet(), "and parks, Tasmota's retries held");
  CHECK(g_channel == 11, "the radio goes to the mesh's channel");
  CHECK(EspNowMeshStation.off_channel == 6 && !memcmp(EspNowMeshStation.off_bssid, kApOff, 6) && EspNowMeshStation.offs == 1, "the access point off the channel is kept");
  CHECK(logged("EMS: The access point B2:00:00:00:00:06 is on channel 6, not the mesh's 11: the station leaves it"), "and said in the log");
  say("EspNowMeshStation", "");
  CmndEspNowMeshStation();
  CHECK(g_response.find("\"State\":\"Parked\"") != std::string::npos && g_response.find("\"Channel\":11,\"Ap\":0") != std::string::npos, "the command says it parked, on no access point");
  CHECK(g_response.find("\"OffChannel\":6,\"OffBssid\":\"B2:00:00:00:00:06\",\"Offs\":1") != std::string::npos, "and the access point off the channel");

  // a node alone, with no node in its table, stays on its network on any channel: there is no mesh to keep to
  station_world();
  EspNowMeshSettings.node[0].id = 0;
  g_channel = 6;
  second();
  CHECK(g_disconnects == 0 && EspNowMeshStation.state == ESPNOW_MESH_STATION_WATCH, "a node alone stays on an access point of another channel");
  say("EspNowMeshStation", "");
  CmndEspNowMeshStation();
  CHECK(g_response.find("\"Ap\":6") != std::string::npos, "the command says the access point's channel");

  // while a join of someone else has the radio the station is not touched: here, a scan under way
  station_world();
  g_channel = 6;
  g_scan_running = true;
  second();
  CHECK(g_disconnects == 0, "a station on another channel is left alone while someone has the radio");
  g_scan_running = false;
  second();
  CHECK(g_disconnects == 1, "and leaves the access point once the radio is free");
  end_world();
}

static void test_station_park(void) {
  printf("-- a node of a mesh does not leave a lost access point to the stack: it parks at once and looks on the mesh's channel\n");
  station_world();
  second();
  CHECK(EspNowMeshStation.state == ESPNOW_MESH_STATION_WATCH && !g_auto_reconnect, "while associated, the stack's retries, which scan every channel, are off");
  station_down();
  station_event(WIFI_REASON_BEACON_TIMEOUT);
  second();
  CHECK(EspNowMeshStation.state == ESPNOW_MESH_STATION_PARKED && EspNowMeshStation.parks == 1 && EspNowMeshStationQuiet(), "the access point lost: parked at once, Tasmota's retries held");
  CHECK(logged("EMS: WiFi lost, the radio stays on the mesh's channel 11"), "and says why");
  CHECK(g_channel == 11 && !g_auto_reconnect && g_begins == 0, "the radio on the mesh's channel, and nothing joined");
  second();
  CHECK(g_scans == 1 && g_scan_channel == 11 && EspNowMeshStation.state == ESPNOW_MESH_STATION_PROBING, "and the network is looked for on the mesh's channel at once");

  // the stack said it did not find the network: parked, and the next scan later, for one has just been made
  station_world();
  station_down();
  station_event(WIFI_REASON_NO_AP_FOUND);
  second();
  CHECK(EspNowMeshStation.state == ESPNOW_MESH_STATION_PARKED && EspNowMeshStation.parks == 1, "not found: parked");
  CHECK(logged("EMS: WiFi not found, the radio stays on the mesh's channel 11"), "and says why");
  CHECK(!EspNowMeshStation.not_found, "the word is taken");
  second();
  CHECK(g_scans == 0, "with no scan at once");

  // a node alone keeps the stack's retries, and the grace
  station_world();
  EspNowMeshSettings.node[0].id = 0;
  second();
  CHECK(g_auto_reconnect, "a node alone keeps the stack's retries");
  station_down();
  second();
  CHECK(EspNowMeshStation.state == ESPNOW_MESH_STATION_WATCH && EspNowMeshStation.down_since, "a node alone just down is Tasmota's");
  station_event(WIFI_REASON_NO_AP_FOUND);
  second();
  CHECK(EspNowMeshStation.state == ESPNOW_MESH_STATION_PARKED && EspNowMeshStation.parks == 1, "the stack did not find the network: it parks, before the grace");

  // any other failure waits for the grace of 10 s
  station_world();
  EspNowMeshSettings.node[0].id = 0;
  station_down();
  second();
  station_event(15);
  for (int i = 0; i < 9; i++) { second(); }
  CHECK(EspNowMeshStation.state == ESPNOW_MESH_STATION_WATCH, "another failure: still Tasmota's after 9 s");
  second();
  CHECK(EspNowMeshStation.state == ESPNOW_MESH_STATION_PARKED, "and parked after 10 s");
  CHECK(logged("EMS: WiFi out of reach, the radio stays on the mesh's channel 11"), "out of reach");
  // the station's own leaving (a park) is no failure
  station_world();
  EspNowMeshSettings.node[0].id = 0;
  station_down();
  second();
  station_event(WIFI_REASON_ASSOC_LEAVE);
  second();
  CHECK(EspNowMeshStation.state == ESPNOW_MESH_STATION_WATCH && EspNowMeshStation.fails == 0, "a leave of this side's is not counted");
  end_world();
}

static void test_station_probe(void) {
  printf("-- the station looks for its network on the mesh's channel\n");
  station_world();
  add_ap("Cottage", -60, 11, kApNear);
  add_ap("Cottage", -40, 6, kApOff);
  station_down();
  second();
  CHECK(EspNowMeshStation.state == ESPNOW_MESH_STATION_PARKED, "parked");
  second();
  CHECK(g_scans == 1 && g_scan_channel == 11 && EspNowMeshStation.state == ESPNOW_MESH_STATION_PROBING, "a scan of the mesh's channel, at once");
  CHECK(g_channel == 11, "which does not take the radio off it");
  scan_finish();
  second();
  CHECK(g_begins == 1 && g_begin_ssid == "Cottage" && g_begin_channel == 11 && !memcmp(g_begin_bssid, kApNear, 6), "the access point on the mesh's channel is joined");
  CHECK(EspNowMeshStation.state == ESPNOW_MESH_STATION_JOINING && g_auto_reconnect, "with the stack's retries back for the join");
  CHECK(EspNowMeshStation.off_channel == 0, "a scan of one channel sees nothing off it");
  // it connects: Tasmota's again
  g_ap_associated = true;
  g_wifi_status = WL_CONNECTED;
  memcpy(g_ap_bssid, kApNear, 6);
  second();
  CHECK(EspNowMeshStation.state == ESPNOW_MESH_STATION_WATCH && EspNowMeshStation.found == 1 && !EspNowMeshStation.down_since, "connected, the station is Tasmota's");
  CHECK(!g_auto_reconnect, "with the stack's retries off again");

  // the network not seen at once: the next scans come 10 s and the node's own (the last byte of its MAC, 1, by 6: 1 s) after
  station_world();
  station_down();
  second();
  second();
  scan_finish();
  second();
  uint32_t parked_at = g_millis;
  CHECK(EspNowMeshStation.state == ESPNOW_MESH_STATION_PARKED && g_scans == 1 && g_begins == 0, "not seen: parked again");
  while ((int32_t)(g_millis - parked_at) < 10000) { second(); }
  CHECK(g_scans == 1, "no scan before its time");
  second();
  CHECK(g_scans == 2 && g_scan_channel == 11 && EspNowMeshStation.state == ESPNOW_MESH_STATION_PROBING, "the next scan of the mesh's channel");

  // a scan the stack refuses: parked again, for the next one
  station_world();
  station_down();
  second();
  g_scan_refused = true;
  second();
  CHECK(EspNowMeshStation.state == ESPNOW_MESH_STATION_PARKED && g_scans == 0, "a refused scan leaves it parked");
  end_world();
}

static void test_station_wide(void) {
  printf("-- the scan of every channel, spread by the MAC\n");
  station_world();
  // the first one comes at a time of the node's own, between 60 s and 600 s after the park
  memcpy(g_own_mac, "\x24\x6f\x28\x00\x12\x34", 6);
  uint32_t a = EspNowMeshStationWideFirst();
  memcpy(g_own_mac, "\x24\x6f\x28\x00\x00\x01", 6);
  uint32_t b = EspNowMeshStationWideFirst();
  CHECK(a == 60 + 0x1234 % 541 && b == 61, "the first scan of every channel is the node's own");
  CHECK(a >= 60 && a <= 600 && b >= 60 && b <= 600, "between 60 and 600 s");
  station_down();
  second();
  CHECK((int32_t)(EspNowMeshStation.wide_at - (g_millis + 61000)) == 0, "the park sets it");

  // the network seen only on another channel: not joined, and kept as the one off the channel
  add_ap("Cottage", -40, 6, kApOff);
  add_ap("Neighbour", -30, 11, kApNear);
  EspNowMeshStation.next_try = g_millis;
  EspNowMeshStation.wide_at = g_millis;
  second();
  CHECK(g_scans == 1 && g_scan_channel == 0 && EspNowMeshStation.state == ESPNOW_MESH_STATION_WIDE && EspNowMeshStation.wides == 1, "a scan of every channel");
  CHECK((int32_t)(EspNowMeshStation.wide_at - (g_millis + 600000)) == 0, "the next one 600 s later");
  scan_finish();
  second();
  CHECK(g_begins == 0 && EspNowMeshStation.state == ESPNOW_MESH_STATION_PARKED, "the network off the mesh's channel is not joined");
  CHECK(EspNowMeshStation.off_channel == 6 && !memcmp(EspNowMeshStation.off_bssid, kApOff, 6), "it is kept as the one off the channel");
  CHECK(logged("EMS: Cottage seen on channel 6, off the mesh's 11"), "and said");
  CHECK(g_channel == 11, "the radio back on the mesh's channel");

  // a scan of every channel that sees it no more forgets it
  g_aps.clear();
  EspNowMeshStation.next_try = g_millis;
  EspNowMeshStation.wide_at = g_millis;
  second();
  scan_finish();
  second();
  CHECK(EspNowMeshStation.off_channel == 0, "an access point off the channel no longer seen is forgotten");

  // seen on both: the one on the mesh's channel is joined, the other kept
  add_ap("Cottage", -40, 6, kApOff);
  add_ap("Cottage", -70, 11, kApNear);
  EspNowMeshStation.next_try = g_millis;
  EspNowMeshStation.wide_at = g_millis;
  second();
  scan_finish();
  second();
  CHECK(g_begins == 1 && g_begin_channel == 11 && !memcmp(g_begin_bssid, kApNear, 6), "the access point on the mesh's channel is joined, though weaker");
  CHECK(EspNowMeshStation.off_channel == 6, "and the other is kept");
  // connected: the one off the channel is forgotten
  g_ap_associated = true;
  g_wifi_status = WL_CONNECTED;
  g_channel = 11;
  second();
  CHECK(EspNowMeshStation.off_channel == 0 && EspNowMeshStation.state == ESPNOW_MESH_STATION_WATCH, "a station that connects forgets it");

  // a node alone joins its network on any channel
  station_world();
  EspNowMeshSettings.node[0].id = 0;
  add_ap("Cottage", -40, 6, kApOff);
  station_down();
  second();
  station_event(WIFI_REASON_NO_AP_FOUND);
  second();
  EspNowMeshStation.next_try = g_millis;
  EspNowMeshStation.wide_at = g_millis;
  second();
  scan_finish();
  second();
  CHECK(g_begins == 1 && g_begin_channel == 6, "a node alone joins its network on another channel");
  end_world();
}

// The peer, node 2, says something the driver's radio hears, when the radio is on the peer's channel. The peer hears nothing of the
// driver's: its heartbeats would go to a core with none of its own
static uint32_t g_peer_said_at = 0;
static void peer_heard(uint8_t peer_channel) {
  if (g_channel != peer_channel) { return; }
  g_peer_deaf = true;
  g_peer.Send(EspNowMesh::kState, 3, (const uint8_t*)"x", 1, false, g_millis);
  air(g_millis);
  turn(g_millis);
  g_peer_said_at = g_millis;
}

// Seconds go by, the peer saying something every 5 s on its channel, and the task's snapshot made every second
static void search_seconds(int n, uint8_t peer_channel) {
  for (int i = 0; i < n; i++) {
    if ((g_millis / 1000) % 5 == 0) { peer_heard(peer_channel); }
    EspNowMeshSnapshotMake(EspNowMeshDriver.node);
    second();
  }
}

// The driver's world with no network saved: its station has nothing to look for, and the search may take the radio
static void search_world(void) {
  station_world();
  g_settings_text[SET_STASSID1].clear();
  g_settings_text[SET_STAPWD1].clear();
  station_down();
}

static void test_search(void) {
  printf("-- the search for the nodes on the other channels\n");
  search_world();
  search_seconds(20, 11);
  CHECK(!EspNowMeshSearch.listening && g_peer_said_at, "a node that hears its nodes does not search");
  // the peer moves to channel 6: after 60 s with none heard, the node listens on the other channels
  uint32_t said = g_peer_said_at;
  while (!EspNowMeshSearch.listening && (int32_t)(g_millis - said) < 80000) { search_seconds(1, 6); }
  CHECK(EspNowMeshSearch.listening && (int32_t)(g_millis - said) >= 60000 && (int32_t)(g_millis - said) <= 61000, "after 60 s with none heard it searches");
  CHECK(EspNowMeshSearch.channel == 1 && g_channel == 1, "on channel 1 first");
  CHECK(EspNowMeshSearchHolds(), "and holds the channel");
  EspNowMeshApplyChannel();
  CHECK(g_channel == 1, "which the mesh's own does not take back");
  CHECK(logged("EMH: None of the nodes heard on channel 11 for"), "said in the log");
  // every channel but 11, 6.5 s each, then 11 last
  uint32_t start = g_millis;
  while (EspNowMeshSearch.listening && (int32_t)(g_millis - start) < 200000) { search_seconds(1, 6); }
  CHECK(!EspNowMeshSearch.listening, "the search ends");
  CHECK(EspNowMeshSettings.channel == 6 && EspNowMeshSearch.moves == 1 && EspNowMeshSearch.found == 6, "the mesh's channel is the one the node was heard on");
  CHECK(g_channel == 6, "and the radio is there");
  CHECK(g_nvs.count("espnowmesh/settings") && g_nvs["espnowmesh/settings"][6] == 6, "saved in the flash");
  CHECK(logged("EMH: 1 nodes heard on channel 6 and none on 11: the mesh's channel is 6 now"), "said in the log");
  CHECK((int32_t)(g_millis - start) >= 12 * 6500 && (int32_t)(g_millis - start) < 13 * 6500 + 13000, "it took the 12 channels and the mesh's");
  search_seconds(70, 6);
  CHECK(!EspNowMeshSearch.listening && EspNowMeshSearch.searches == 1, "and the node hears its nodes again");

  // a node heard on the mesh's channel in the end: nothing changes, whatever was heard elsewhere (the next channels' echo of a node close by)
  search_world();
  search_seconds(70, 3);
  CHECK(EspNowMeshSearch.listening, "searching");
  start = g_millis;
  while (EspNowMeshSearch.listening && (int32_t)(g_millis - start) < 200000) {
    // the peer heard on 10 and 12 (an echo), and on 11 again, its own
    uint8_t c = g_channel;
    search_seconds(1, (c == 10 || c == 12 || c == 11) ? c : 3);
  }
  CHECK(EspNowMeshSettings.channel == 11 && EspNowMeshSearch.moves == 0, "a node heard on the mesh's channel in the end keeps it");
  CHECK(logged("EMH: 1 nodes heard on the mesh's channel 11: it stays"), "said in the log");

  // none heard anywhere: the radio back, and the next search 600 s later
  search_world();
  search_seconds(70, 0);
  start = g_millis;
  while (EspNowMeshSearch.listening && (int32_t)(g_millis - start) < 200000) { search_seconds(1, 0); }
  CHECK(EspNowMeshSettings.channel == 11 && g_channel == 11, "none heard: the channel stays, and the radio goes back to it");
  CHECK(logged("EMH: None of the nodes heard on any channel: the radio goes back to 11"), "said in the log");
  search_seconds(300, 0);
  CHECK(!EspNowMeshSearch.listening && EspNowMeshSearch.searches == 1, "no search again before 600 s");
  search_seconds(320, 0);
  CHECK(EspNowMeshSearch.listening && EspNowMeshSearch.searches == 2, "and one after");

  // the command starts one now
  search_world();
  search_seconds(3, 11);
  say("EspNowMeshSearch", "1");
  XdrvMailbox.payload = 1;
  CmndEspNowMeshSearch();
  search_seconds(1, 11);
  CHECK(EspNowMeshSearch.listening, "EspNowMeshSearch 1 starts one");
  say("EspNowMeshSearch", "");
  XdrvMailbox.payload = -99;
  CmndEspNowMeshSearch();
  CHECK(g_response.find("\"State\":\"Listening\",") != std::string::npos && g_response.find("\"Searches\":1") != std::string::npos, "the command says so");
  end_world();
}

static void test_search_not_when(void) {
  printf("-- when the search does not run\n");
  // no node in the table: nobody to look for
  search_world();
  EspNowMeshSettings.node[0].id = 0;
  search_seconds(80, 0);
  CHECK(!EspNowMeshSearch.listening, "a node with no nodes in its table does not search");
  // on an access point: the radio is the access point's
  search_world();
  g_ap_associated = true;
  g_wifi_status = WL_CONNECTED;
  search_seconds(80, 0);
  CHECK(!EspNowMeshSearch.listening, "a node on an access point does not search");
  // the station of a network saved, while it is Tasmota's: not before it parks
  search_world();
  g_settings_text[SET_STASSID1] = "Cottage";
  g_wifi_mode = WIFI_MODE_STA;
  EspNowMeshStation.state = ESPNOW_MESH_STATION_JOINING;
  EspNowMeshStation.try_since = g_millis;
  EspNowMeshSnapshotMake(EspNowMeshDriver.node);
  Xdrv103(FUNC_EVERY_SECOND);
  g_millis += 70000;
  EspNowMeshSnapshotMake(EspNowMeshDriver.node);
  Xdrv103(FUNC_EVERY_SECOND);
  CHECK(!EspNowMeshSearch.listening, "a station joining keeps the radio from the search");
  // a parked station lets it, and does not scan while it listens
  EspNowMeshStation.state = ESPNOW_MESH_STATION_PARKED;
  Xdrv103(FUNC_EVERY_SECOND);
  g_millis += 61000;
  EspNowMeshStation.next_try = g_millis + 1000;
  EspNowMeshStation.wide_at = g_millis + 600000;
  EspNowMeshSnapshotMake(EspNowMeshDriver.node);
  Xdrv103(FUNC_EVERY_SECOND);
  CHECK(EspNowMeshSearch.listening, "a parked station lets the search have the radio");
  int scans = g_scans;
  uint8_t on = g_channel;
  g_millis += 2000;
  Xdrv102(FUNC_EVERY_SECOND);
  CHECK(g_scans == scans && g_channel == on, "and neither scans nor moves the radio while it listens");
  // the direct link takes the radio: the search stops
  EspNowMeshDriver.direct_radio = true;
  Xdrv103(FUNC_EVERY_SECOND);
  CHECK(!EspNowMeshSearch.listening && !EspNowMeshSearchHolds(), "the direct link's radio stops it");
  EspNowMeshDriver.direct_radio = false;
  end_world();
}
