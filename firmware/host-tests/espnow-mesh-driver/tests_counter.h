// Tests of the end of the core's frame counter, as the driver meets it: the core asks for the next epoch, which is the next start's to take, and goes on
// until there are no numbers left. Included by host_test.cpp after tests_queues.h (make_world, send_cmd, turn).

static void queue_send(uint8_t dest, bool ack, const char* text) {
  EspNowMeshCmd_t cmd = send_cmd(dest, ack, text);
  EspNowMeshQueueCommand(&cmd);
  turn(g_millis);
}

static void test_counter_end(void) {
  printf("-- counter end\n");
  make_world(true);
  EspNowMeshSettings.enabled = 1;
  uint32_t epoch = EspNowMeshSettings.epoch;
  CHECK(!EspNowMeshDriver.epoch_renew, "no epoch is wanted at the start");
  // the counter is 1 short of the point where the core wants the next epoch: the number at the point itself is given, with nothing asked
  EspNowMeshDriver.node->AdvanceCounter(EspNowMesh::kCounterRenew - 1);
  queue_send(255, false, "a");
  CHECK(EspNowMeshDriver.node->counter() == EspNowMesh::kCounterRenew && !EspNowMeshDriver.epoch_renew, "a number up to 0xFFFF0000 is given with nothing asked");
  // the next is given too, and the core asks for the next epoch: the task says no, and says it wants one
  queue_send(255, false, "b");
  CHECK(EspNowMeshDriver.node->counter() == EspNowMesh::kCounterRenew + 1, "the next number is given as well");
  CHECK(EspNowMeshDriver.epoch_renew, "and the core asked for the next epoch, which the task left to the main loop");
  CHECK(EspNowMeshDriver.node->epoch() == epoch, "the epoch the core numbers under is the same");
  // the main loop's second: the mesh stops and starts again, under the epoch above, saved before the task is made
  g_on_delay = []() { if (EspNowMeshDriver.stop) { EspNowMeshDriver.exited = true; } };      // the task sees the stop and ends
  g_task_created = false;
  g_log.clear();
  EspNowMeshEverySecond();
  CHECK(logged("The frame counter is near its end"), "the log says why");
  CHECK(EspNowMeshDriver.running && g_task_created, "the mesh is running again, with a task of its own");
  CHECK(EspNowMeshSettings.epoch == epoch + 1 && EspNowMeshDriver.node->epoch() == epoch + 1, "under the next epoch");
  CHECK(EspNowMeshDriver.node->counter() == 0, "numbering from the start");
  std::vector<uint8_t> blob = g_nvs["espnowmesh/settings"];
  uint32_t flash_epoch;
  memcpy(&flash_epoch, &blob[8], 4);
  CHECK(flash_epoch == epoch + 1, "and the flash holds it");
  CHECK(!EspNowMeshDriver.epoch_renew, "nothing is wanted now");
  queue_send(255, false, "c");
  CHECK(EspNowMeshDriver.node->counter() == 1, "the first frame of the new run is number 1");

  // no number left: a frame that is refused is told so, as one the core refuses is, and it is counted. The sends are to everyone: a frame for a
  // neighbour this world has no key for is refused for that, after it has taken a number
  EspNowMeshDriver.node->AdvanceCounter(0xFFFFFFFDu);          // 0xFFFFFFFD is the last that was used
  uint32_t refused = EspNowMeshCount.refused;
  queue_send(255, false, "d");
  CHECK(EspNowMeshDriver.node->counter() == EspNowMesh::kCounterLast, "the last number, 0xFFFFFFFE, is given");
  queue_send(255, true, "e");
  queue_send(255, false, "f");
  CHECK(EspNowMeshDriver.node->counter() == EspNowMesh::kCounterLast, "and no other: the counter does not move");
  CHECK(EspNowMeshCount.refused == refused + 2, "the two that had none are refused, and counted");
  CHECK(EspNowMeshDriver.node->stats().counterOut == 2, "the core counts them");
  g_rules.clear();
  EspNowMeshDrainEvents();
  bool outcome = false;
  for (auto& r : g_rules) { if (r.find("\"Frame\":0,\"Dest\":255,\"Ok\":0,\"Attempts\":0") != std::string::npos) { outcome = true; } }
  CHECK(outcome, "the one that asked for an answer has an outcome that says it was not sent");
  EspNowMeshSnapshotMake(EspNowMeshDriver.node);
  say("EspNowMeshStats", "1");
  CmndEspNowMeshStats();
  CHECK(json_ok(g_response) && g_response.find("\"CounterOut\":2") != std::string::npos, "the status has the count");
  // the main loop starts the mesh again, and it sends
  EspNowMeshDriver.epoch_renew = true;
  EspNowMeshEverySecond();
  CHECK(EspNowMeshDriver.running && EspNowMeshSettings.epoch == epoch + 2 && EspNowMeshDriver.node->counter() == 0, "a second start: the epoch above again, numbering from the start");
  g_on_delay = nullptr;
  end_world();
}
