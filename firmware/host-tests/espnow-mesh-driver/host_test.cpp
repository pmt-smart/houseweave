// Host test of xdrv_98_1_espnow_mesh.ino, with the station of xdrv_98_3 and the search of xdrv_98_4: the driver compiled on a host over stand-ins (host_stubs.h), its functions called one at a time.
// Run it with run.mjs (see README.md): it compiles this file with the emscripten SDK and runs the result with node.
#include "host_stubs.h"
#define PROGMEM
#include "xdrv_98_1_espnow_mesh.ino"
#include "xdrv_98_3_espnow_mesh_station.ino"
#include "xdrv_98_4_espnow_mesh_search.ino"

static int g_failures = 0;
static int g_checks = 0;
#define CHECK(cond, what) do { g_checks++; if (!(cond)) { g_failures++; printf("FAIL %s  (line %d)\n", what, __LINE__); } } while (0)
static bool logged(const char* part) { for (auto& l : g_log) { if (l.find(part) != std::string::npos) { return true; } } return false; }
static void reset_world(void) {
  g_log.clear(); g_response.clear(); g_rules.clear();
  g_nvs.clear(); g_nvs_fail_set = g_nvs_fail_commit = g_nvs_lose_write = g_nvs_corrupt = false; g_nvs_writes = 0;
  g_now_up = false; g_peers.clear(); g_sent.clear(); g_send_error = ESP_OK; g_send_status = ESP_NOW_SEND_SUCCESS; g_send_silent = false; g_send_cb = nullptr;
  g_wifi_mode = WIFI_MODE_STA; g_wifi_status = WL_CONNECTED; g_task_created = false;
  g_millis = 100000;
  if (!EspNowMeshDriver.radio_lock) { Xdrv100(FUNC_PRE_INIT); }          // the mutex of the radio, made at the start of the firmware
  EspNowMeshDriver.radio_lock->count = 1;
  memset(&EspNowMeshDriver.running, 0, 1);
  EspNowMeshDriver.running = false;
  EspNowMeshDriver.epoch_ahead = 0;
  EspNowMeshDriver.retry_wait = false;
  EspNowMeshDriver.radio = false;
  EspNowMeshDriver.own_radio = false;
  EspNowMeshDriver.direct_radio = false;
  EspNowMeshDriver.radio_lost = false;
  EspNowMeshDriver.accepting = false;
  EspNowMeshDriver.stop = false;
  EspNowMeshDriver.exited = false;
  EspNowMeshDriver.task = nullptr;
  memcpy(g_own_mac, "\x24\x6f\x28\x00\x00\x01", 6);
}
static void free_node(void) { if (EspNowMeshDriver.node) { EspNowMeshFree(); } }
static std::string hex(const uint8_t* p, size_t n) { char b[200]; ToHex_P(p, n, b, sizeof(b)); return b; }
static void say(const char* command, const char* data) {
  static char buffer[400];
  snprintf(buffer, sizeof(buffer), "%s", data);
  XdrvMailbox.data = buffer;
  XdrvMailbox.data_len = (uint32_t)strlen(buffer);
  XdrvMailbox.command = command;
}

static void test_settings(void) {
  printf("-- settings\n");
  reset_world();
  EspNowMeshSettingsLoad();
  CHECK(EspNowMeshSettings.version == 4, "a fresh device has a record of version 4");
  CHECK(!memcmp(EspNowMeshSettings.mac, g_own_mac, 6), "and its chip's address in it");
  CHECK(!EspNowMeshSettings.has_secret && EspNowMeshSettings.epoch == 0, "and no identity, no epoch");
  CHECK(g_log.empty(), "a device never set up says nothing");

  // the first start: the identity and the epoch go to the flash, read back, before the task
  EspNowMeshSettings.id = 3;
  EspNowMeshSettings.has_group = 1;
  CHECK(EspNowMeshStartAttempt(), "the first start works");
  CHECK(g_task_created && EspNowMeshDriver.running, "with a task");
  CHECK(g_nvs.count("espnowmesh/settings") == 1 && g_nvs["espnowmesh/settings"].size() == 2188, "the record is in the flash, 2188 bytes");
  uint32_t epoch1 = EspNowMeshSettings.epoch;
  CHECK(epoch1 != 0, "with an epoch");
  CHECK(logged("NVS 270 of 504"), "the NVS entries are in the log");
  CHECK(logged("Started as node 3, epoch"), "and the start");
  std::vector<uint8_t> blob = g_nvs["espnowmesh/settings"];
  uint32_t flash_epoch;
  memcpy(&flash_epoch, &blob[8], 4);
  CHECK(flash_epoch == epoch1, "the epoch the flash holds is the one the node runs under");
  CHECK(EspNowMeshDriver.epoch_ahead == 0, "and none is held back");
  free_node();
  EspNowMeshDriver.running = false;

  // the second start: the epoch rises by one
  EspNowMeshSettingsLoad();
  CHECK(EspNowMeshSettings.epoch == epoch1 && EspNowMeshSettings.has_secret, "read back, the record has the identity and the epoch");
  CHECK(EspNowMeshStartAttempt(), "a second start works");
  CHECK(EspNowMeshSettings.epoch == epoch1 + 1, "under the next epoch");
  free_node();
  EspNowMeshDriver.running = false;

  // the flash refuses: the node does not start, and the epoch in memory is the old one
  uint32_t before = EspNowMeshSettings.epoch;
  g_nvs_fail_set = true;
  g_log.clear();
  g_task_created = false;
  CHECK(!EspNowMeshStartAttempt(), "a flash that refuses the write: no start");
  CHECK(!g_task_created && EspNowMeshDriver.node == nullptr && !EspNowMeshDriver.running, "no task, nothing allocated");
  CHECK(EspNowMeshSettings.epoch == before, "the epoch in memory stays");
  CHECK(logged("did not take the epoch"), "and the log says why");
  g_nvs_fail_set = false;

  // the flash says ok and keeps the old one: the read-back finds it
  g_nvs_lose_write = true;
  g_log.clear();
  CHECK(!EspNowMeshStartAttempt(), "a write that was lost: no start");
  CHECK(logged("did not take the epoch (error 0x109)"), "found by the read back");
  g_nvs_lose_write = false;

  // a read that differs from what was written
  g_nvs_corrupt = true;
  CHECK(!EspNowMeshStartAttempt(), "a record that reads back different: no start");
  g_nvs_corrupt = false;

  // a commit that fails
  g_nvs_fail_commit = true;
  CHECK(!EspNowMeshStartAttempt(), "a commit that fails: no start");
  g_nvs_fail_commit = false;

  // and then it goes, under the epoch after the one saved
  CHECK(EspNowMeshStartAttempt(), "the flash back, it starts");
  CHECK(EspNowMeshSettings.epoch == before + 1, "under the next epoch, none skipped");
  free_node();
  EspNowMeshDriver.running = false;

  // a start that fails after the epoch was saved does not write the flash again, and takes the same epoch
  int writes = g_nvs_writes;
  g_task_fail = true;
  CHECK(!EspNowMeshStartAttempt(), "a start whose task does not start fails");
  CHECK(g_nvs_writes == writes + 1, "after one write of the epoch");
  uint32_t kept = EspNowMeshSettings.epoch;
  CHECK(EspNowMeshDriver.epoch_ahead == kept, "which is held for the next attempt");
  CHECK(!EspNowMeshStartAttempt(), "again");
  CHECK(g_nvs_writes == writes + 1, "no new write");
  g_task_fail = false;
  CHECK(EspNowMeshStartAttempt(), "and then it goes");
  CHECK(g_nvs_writes == writes + 1 && EspNowMeshSettings.epoch == kept, "under the epoch that was saved, with no write more");
  CHECK(EspNowMeshDriver.epoch_ahead == 0, "now in use");
  free_node();
  EspNowMeshDriver.running = false;
  CHECK(EspNowMeshStartAttempt() && EspNowMeshSettings.epoch == kept + 1 && g_nvs_writes == writes + 2, "the next start rises by one and writes once");
  free_node();
  EspNowMeshDriver.running = false;
}

static void test_load(void) {
  printf("-- load\n");
  // a record of version 2 (2144 bytes) is taken as it is, and gets this chip's address
  reset_world();
  {
    EspNowMeshSettingsLoad();
    EspNowMeshSettings.id = 7;
    EspNowMeshSettings.has_secret = 1;
    for (int i = 0; i < 32; i++) { EspNowMeshSettings.secret[i] = (uint8_t)(i + 1); }
    EspNowMeshSettings.epoch = 41;
    EspNowMeshSettings.node[47].id = 9;
    EspNowMeshSettings.version = 2;
    uint8_t* p = (uint8_t*)&EspNowMeshSettings;
    g_nvs["espnowmesh/settings"] = std::vector<uint8_t>(p, p + 2144);
    EspNowMeshSettingsLoad();
    CHECK(EspNowMeshSettings.version == 4 && EspNowMeshSettings.id == 7 && EspNowMeshSettings.epoch == 41 && !EspNowMeshSettings.has_prev, "a record of version 2 is taken");
    CHECK(EspNowMeshSettings.has_secret && EspNowMeshSettings.secret[5] == 6, "with its identity");
    CHECK(EspNowMeshSettings.node[47].id == 9, "and its 48th node");
    CHECK(!memcmp(EspNowMeshSettings.mac, g_own_mac, 6), "and this chip's address");
    CHECK(g_log.empty(), "with nothing said");
  }
  // version 3: 2152 bytes, with no previous key
  reset_world();
  {
    EspNowMeshSettingsLoad();
    EspNowMeshSettings.id = 8;
    EspNowMeshSettings.has_secret = 1;
    EspNowMeshSettings.has_group = 1;
    EspNowMeshSettings.group_version = 5;
    EspNowMeshSettings.epoch = 70;
    EspNowMeshSettings.version = 3;
    EspNowMeshSettings.has_prev = 1;                     // what a record of version 3 does not have, even if the bytes were there: they are cut off
    uint8_t* p = (uint8_t*)&EspNowMeshSettings;
    g_nvs["espnowmesh/settings"] = std::vector<uint8_t>(p, p + 2152);
    EspNowMeshSettingsLoad();
    CHECK(EspNowMeshSettings.version == 4 && EspNowMeshSettings.id == 8 && EspNowMeshSettings.group_version == 5 && EspNowMeshSettings.epoch == 70, "a record of version 3 is taken");
    CHECK(!EspNowMeshSettings.has_prev && !EspNowMeshSettings.prev_version && !EspNowMeshSettings.prev_hours, "with no previous key");
    CHECK(g_log.empty(), "with nothing said");
  }
  // version 1: 768 bytes
  reset_world();
  {
    EspNowMeshSettingsLoad();
    EspNowMeshSettings.id = 5;
    EspNowMeshSettings.has_secret = 1;
    EspNowMeshSettings.secret[0] = 0xAA;
    EspNowMeshSettings.epoch = 12;
    EspNowMeshSettings.node[15].id = 4;
    EspNowMeshSettings.version = 1;
    uint8_t* p = (uint8_t*)&EspNowMeshSettings;
    g_nvs["espnowmesh/settings"] = std::vector<uint8_t>(p, p + 768);
    EspNowMeshSettingsLoad();
    CHECK(EspNowMeshSettings.version == 4 && EspNowMeshSettings.id == 5 && EspNowMeshSettings.epoch == 12 && EspNowMeshSettings.secret[0] == 0xAA, "a record of version 1 is taken");
    CHECK(EspNowMeshSettings.node[15].id == 4 && EspNowMeshSettings.node[16].id == 0, "its 16 nodes, and no more");
    CHECK(g_log.empty(), "with nothing said");
  }
  // a size no version had: said, and started over
  reset_world();
  {
    EspNowMeshSettingsLoad();
    EspNowMeshSettings.id = 5;
    EspNowMeshSettings.has_secret = 1;
    uint8_t* p = (uint8_t*)&EspNowMeshSettings;
    g_nvs["espnowmesh/settings"] = std::vector<uint8_t>(p, p + 1000);
    EspNowMeshSettingsLoad();
    CHECK(EspNowMeshSettings.id == 0 && !EspNowMeshSettings.has_secret && EspNowMeshSettings.version == 4, "a record of 1000 bytes is not taken");
    CHECK(logged("E EMH: The saved record of 1000 bytes has a size that does not go with its version"), "and the log says so");
  }
  // a record longer than any
  reset_world();
  {
    g_nvs["espnowmesh/settings"] = std::vector<uint8_t>(3000, 3);
    EspNowMeshSettingsLoad();
    CHECK(EspNowMeshSettings.id == 0 && !EspNowMeshSettings.has_secret, "a record of 3000 bytes is not taken");
    CHECK(logged("is longer than any this firmware knows"), "and the log says so");
  }
  // version 3 with the size of version 2 (a mismatch)
  reset_world();
  {
    EspNowMeshSettingsLoad();
    EspNowMeshSettings.id = 5;
    EspNowMeshSettings.version = 3;
    uint8_t* p = (uint8_t*)&EspNowMeshSettings;
    g_nvs["espnowmesh/settings"] = std::vector<uint8_t>(p, p + 2144);
    EspNowMeshSettingsLoad();
    CHECK(EspNowMeshSettings.id == 0, "a version that does not go with its size is not taken");
  }
  // version 4 with the size of version 3 (a mismatch)
  reset_world();
  {
    EspNowMeshSettingsLoad();
    EspNowMeshSettings.id = 5;
    EspNowMeshSettings.version = 4;
    uint8_t* p = (uint8_t*)&EspNowMeshSettings;
    g_nvs["espnowmesh/settings"] = std::vector<uint8_t>(p, p + 2152);
    EspNowMeshSettingsLoad();
    CHECK(EspNowMeshSettings.id == 0, "a record of version 4 that is the size of version 3 is not taken");
  }
  // a record made on another chip
  reset_world();
  {
    EspNowMeshSettingsLoad();
    EspNowMeshSettings.id = 6;
    EspNowMeshSettings.enabled = 1;
    EspNowMeshSettings.channel = 6;
    EspNowMeshSettings.has_secret = 1;
    EspNowMeshSettings.has_group = 1;
    EspNowMeshSettings.group_version = 4;
    EspNowMeshSettings.epoch = 99;
    for (int i = 0; i < 32; i++) { EspNowMeshSettings.secret[i] = 0x77; }
    EspNowMeshSettings.node[2].id = 8;
    CHECK(ESP_OK == EspNowMeshSave(), "saved on the first chip");
    memcpy(g_own_mac, "\x24\x6f\x28\xaa\xbb\xcc", 6);                   // the flash is copied to another chip
    EspNowMeshSettingsLoad();
    CHECK(!EspNowMeshSettings.has_secret && EspNowMeshSettings.secret[0] == 0 && EspNowMeshSettings.epoch == 0, "the identity and the epoch are gone");
    CHECK(EspNowMeshSettings.id == 0 && EspNowMeshSettings.enabled == 0, "and the node number, and the mesh is off, as on a new device");
    CHECK(EspNowMeshSettings.has_group && EspNowMeshSettings.group_version == 4 && EspNowMeshSettings.node[2].id == 8 && EspNowMeshSettings.channel == 6, "the key of the network, the nodes and the rest of what is configured stay");
    CHECK(!memcmp(EspNowMeshSettings.mac, g_own_mac, 6), "and the address is this chip's");
    CHECK(logged("The record was made on the chip 24:6F:28:00:00:01"), "the log names the chip it came from");
    CHECK(logged("its node number 6 was cleared and the mesh is off") && logged("EspNowMeshId"), "and says the number was cleared and what to do");
    // it does not start, and sends nothing, whatever asks
    g_task_created = false;
    CHECK(0 != EspNowMeshWhyNot() && !strcmp(EspNowMeshWhyNot(), "needs EspNowMeshId"), "it says it needs a number");
    CHECK(!EspNowMeshStart() && !EspNowMeshStartAttempt(), "a start with no number does not go, by the way it is asked or by the work of it");
    CHECK(!g_task_created && !EspNowMeshDriver.running && EspNowMeshDriver.node == nullptr, "no task, nothing made");
    EspNowMeshEverySecond();
    CHECK(!EspNowMeshDriver.running && !g_task_created, "and the second that comes does not start it: the mesh is off");
    say("EspNowMeshStatus", "");
    CmndEspNowMeshStatus();
    CHECK(g_response.find("\"Running\":0,\"Id\":0,") != std::string::npos && g_response.find("\"Why\":\"needs EspNowMeshId\"") != std::string::npos, "the status shows it plainly: no number, and why it is not running");
    // it is numbered, with a number that a row of the list has: the row goes, the others stay
    say("EspNowMeshId", "8");
    CmndEspNowMeshId();
    CHECK(EspNowMeshSettings.id == 8 && g_response == "{\"EspNowMeshId\":8}", "a number given");
    CHECK(EspNowMeshSettings.node[2].id == 0 && EspNowMeshSettings.has_group && EspNowMeshSettings.node[2].pub[0] == 0, "drops the row of the list that has that number: a device is not one of its own nodes");
    EspNowMeshSettings.node[5].id = 9;
    say("EspNowMeshId", "10");
    CmndEspNowMeshId();
    CHECK(EspNowMeshSettings.node[5].id == 9, "and one that has another number stays");
    CHECK(nullptr == EspNowMeshWhyNot(), "with a number and the key nothing stops a start but the owner enabling the mesh");
    // read again, the record is this chip's own: it is no clone any more, and keeps the number
    EspNowMeshSettingsLoad();
    CHECK(EspNowMeshSettings.id == 10 && !logged("its node number 10 was cleared"), "read again, the number stays: the record is this chip's");
    // enabling it is the owner's: the mesh starts
    say("EspNowMeshEnable", "1");
    CmndEspNowMeshEnable();
    CHECK(EspNowMeshSettings.enabled == 1 && EspNowMeshDriver.running && g_task_created, "and with the mesh enabled it starts");
    free_node();
    EspNowMeshDriver.running = false;
  }
  // a record of another chip that never made an identity, and had a number: the number goes as well
  reset_world();
  {
    EspNowMeshSettingsLoad();
    EspNowMeshSettings.id = 12;
    EspNowMeshSettings.enabled = 1;
    EspNowMeshSettings.has_group = 1;
    CHECK(ESP_OK == EspNowMeshSave(), "saved on the first chip, with no identity made");
    memcpy(g_own_mac, "\x24\x6f\x28\xaa\xbb\xcc", 6);
    EspNowMeshSettingsLoad();
    CHECK(EspNowMeshSettings.id == 0 && EspNowMeshSettings.enabled == 0 && EspNowMeshSettings.has_group, "a copy of a record with no identity loses the number too, and keeps the key");
  }
  // a record of another chip with no number and the mesh off says nothing of a number
  reset_world();
  {
    EspNowMeshSettingsLoad();
    EspNowMeshSettings.has_group = 1;
    CHECK(ESP_OK == EspNowMeshSave(), "saved on the first chip, not numbered");
    memcpy(g_own_mac, "\x24\x6f\x28\xaa\xbb\xcc", 6);
    g_log.clear();
    EspNowMeshSettingsLoad();
    CHECK(!logged("was cleared") && EspNowMeshSettings.id == 0, "a copy that had no number has nothing to clear, and says so by saying nothing");
  }
  // a record whose address is that of this chip
  reset_world();
  {
    EspNowMeshSettingsLoad();
    EspNowMeshSettings.has_secret = 1;
    EspNowMeshSettings.secret[0] = 1;
    EspNowMeshSettings.epoch = 5;
    EspNowMeshSave();
    EspNowMeshSettingsLoad();
    CHECK(EspNowMeshSettings.has_secret && EspNowMeshSettings.epoch == 5, "on its own chip a record keeps its identity");
  }
}

static void test_commit(void) {
  printf("-- commit\n");
  reset_world();
  EspNowMeshSettingsLoad();
  say("EspNowMeshId", "4");
  CmndEspNowMeshId();
  CHECK(EspNowMeshSettings.id == 4 && g_response == "{\"EspNowMeshId\":4}", "a command that the flash takes");
  g_nvs_fail_set = true;
  say("EspNowMeshId", "9");
  CmndEspNowMeshId();
  CHECK(EspNowMeshSettings.id == 4, "one that it does not leaves the record as it was");
  CHECK(g_response == "{\"EspNowMeshId\":\"flash write failed\"}", "and says so");
  g_nvs_fail_set = false;
  // the identity made by EspNowMeshPublic that the flash did not take is not kept
  g_nvs_fail_set = true;
  say("EspNowMeshPublic", "");
  CmndEspNowMeshPublic();
  CHECK(!EspNowMeshSettings.has_secret, "no identity that the flash did not keep");
  CHECK(g_response == "{\"EspNowMeshPublic\":\"flash write failed\"}", "and the command says so");
  g_nvs_fail_set = false;
  CmndEspNowMeshPublic();
  CHECK(EspNowMeshSettings.has_secret && g_response.find("\"Public\":\"") != std::string::npos, "with the flash back the identity is made");
}

#include "tests_queues.h"
#include "tests_radio.h"
#include "tests_peers.h"
#include "tests_counter.h"
#include "tests_clock.h"
#include "tests_key.h"
#include "tests_pages.h"
#include "tests_station.h"

int main(int argc, char** argv) {
  (void)argc; (void)argv;
  test_settings();
  test_load();
  test_commit();
  test_ready();
  test_rx_between_sends();
  test_rx_pile();
  test_drain();
  test_notes();
  test_tickets();
  test_outcome_times();
  test_queue_busy();
  test_berry();
  test_peers();
  test_failures();
  test_late_word();
  test_hooks();
  test_peer_roles();
  test_health_command();
  test_forget_node();
  test_route_for_scripts();
  test_counter_end();
  test_clock();
  test_key_command();
  test_key_hours();
  test_key_restart();
  test_key_previous_heard();
  test_key_stale();
  test_key_berry();
  test_pair_key();
  test_group_seal();
  test_leave();
  test_pages();
  test_status();
  test_lock();
  test_ride_stop();
  test_start_hint();
  test_station_keeps_to_channel();
  test_station_park();
  test_station_probe();
  test_station_wide();
  test_search();
  test_search_not_when();
  printf(g_failures ? "\nFAILED %d of %d checks\n" : "\nall %d checks passed\n", g_failures ? g_failures : g_checks, g_checks);
  return g_failures ? 1 : 0;
}
