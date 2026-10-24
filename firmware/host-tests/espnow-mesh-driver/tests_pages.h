// Tests of the lists the commands answer in pages (EspNowMeshNeighbors, EspNowMeshHealth, EspNowMeshClock): a message takes 1040 characters, and with 32 bytes of
// the application's own in each neighbour's heartbeat (a bridge's) an entry of EspNowMeshNeighbors is some 190 of them. A page holds as many entries as fit under
// a margin of the limit, at least one, and says where the next starts (Next) when some remain. Included by host_test.cpp after tests_clock.h (hear_beat,
// add_neighbor, clock_info, json_ok).

struct Page {
  size_t bytes;
  uint32_t from;
  bool hasNext;
  uint32_t next;
  uint32_t count;
  std::vector<int> ids;        // the entries, by the Id each has
};

static uint32_t number_after(const std::string& text, const char* key, size_t from = 0) {
  size_t at = text.find(key, from);
  return at == std::string::npos ? 0xFFFFFFFFu : (uint32_t)strtoul(text.c_str() + at + strlen(key), nullptr, 10);
}

// What a page says: the entries in it by their Ids (the ones after "List":[ , which for the commands that carry other Ids before it are not counted)
static Page read_page(void) {
  Page p;
  p.bytes = g_response.size();
  size_t list = g_response.find("\"List\":[");
  p.from = number_after(g_response, "\"From\":");
  p.count = number_after(g_response, "\"Count\":");
  size_t nextAt = g_response.find("\"Next\":", list);
  p.hasNext = nextAt != std::string::npos;
  p.next = p.hasNext ? number_after(g_response, "\"Next\":", list) : 0;
  size_t end = g_response.find(']', list);
  for (size_t at = g_response.find("{\"Id\":", list); at != std::string::npos && at < end; at = g_response.find("{\"Id\":", at + 1)) {
    p.ids.push_back((int)strtol(g_response.c_str() + at + 6, nullptr, 10));
  }
  return p;
}

// Every page of a command, from the first on: each is JSON that fits a message, has an entry, begins where the one before said it would, and the entries of
// all of them are the `ids` in order, once each; the last says no Next. Returns the largest page
static size_t walk_pages(const char* command, void (*cmnd)(void), const std::vector<int>& ids, int* pages) {
  size_t largest = 0;
  uint32_t from = 0;
  std::vector<int> got;
  int n = 0;
  for (;;) {
    char arg[16];
    snprintf(arg, sizeof(arg), "%u", from);
    say(command, from ? arg : "");
    cmnd();
    Page p = read_page();
    n++;
    CHECK(json_ok(g_response) && g_response.size() < 1040, "a page is JSON and fits the message");
    CHECK(p.from == from && p.count == ids.size(), "it says where it starts and how many there are");
    CHECK(!p.ids.empty(), "it has an entry");
    largest = std::max(largest, p.bytes);
    for (int id : p.ids) { got.push_back(id); }
    if (!p.hasNext) { break; }
    CHECK(p.next == from + p.ids.size() && p.next < ids.size(), "Next is where the entries it carried end, and some remain");
    from = p.next;
    if (n > 60) { CHECK(false, "the pages do not end"); break; }
  }
  CHECK(got == ids, "the entries of the pages are every neighbour, in order, once each");
  *pages = n;
  return largest;
}

static void test_pages(void) {
  printf("-- pages\n");
  make_world(true);
  g_beat_counter = 0;
  uint32_t now = 100000;
  g_millis = now;
  turn(now);                                   // the first turn starts the clock EspNowMeshClock reads
  // the most neighbours a node keeps, 48, the peer of the world among them, each with 32 bytes of its own in its heartbeat: the layout of a mesh clock
  // and the rest of the bytes full, so that the entry of each is as long as it goes
  uint8_t other[5] = {0x0A, 0x00, 0x00, 0x00, 0x07};
  std::vector<int> ids;
  std::vector<int> health_ids;
  EspNowMeshDriver.node->SetSynced(2, 5, 0);   // the peer of the world is a neighbour here, in the epoch the others' heartbeats carry
  hear_beat(2, {3}, now, clock_info(other, 5000, 1, 32, 0xAB));
  ids.push_back(2);
  for (int k = 0; k < 47; k++) {
    add_neighbor(100 + k, 1 + k);
    hear_beat(100 + k, {3, 200 + (k % 40)}, now + 1, clock_info(other, 5000 + k, 1, 32, 0xAB));
    ids.push_back(100 + k);
  }
  // the report is made of the neighbours heard lately: the snapshot just after the heartbeats has all of them
  g_millis = now + 10;
  EspNowMeshSnapshotMake(EspNowMeshDriver.node);
  CHECK(EspNowMeshDriver.snapshot->neighbors == 48, "the table holds 48 neighbours");
  for (uint32_t i = 0; i < EspNowMeshDriver.snapshot->health_links; i++) { health_ids.push_back(EspNowMeshDriver.snapshot->link[i].id); }
  CHECK(health_ids.size() == 48, "and the report lists the 48 heard on the radio");
  int pages = 0;
  size_t largest = walk_pages("EspNowMeshHealth", CmndEspNowMeshHealth, health_ids, &pages);
  printf("   EspNowMeshHealth: %zu neighbours, %d pages, the largest %zu bytes\n", health_ids.size(), pages, largest);
  CHECK(largest <= ESPNOW_MESH_PAGE_MAX, "no page of the health report goes over the margin either");

  // long after, when the ages are five digits and the entries as long as they go
  g_millis = now + 60000000;
  EspNowMeshSnapshotMake(EspNowMeshDriver.node);
  pages = 0;
  largest = walk_pages("EspNowMeshNeighbors", CmndEspNowMeshNeighbors, ids, &pages);
  printf("   EspNowMeshNeighbors: 48 neighbours with 32 bytes of info, %d pages, the largest %zu bytes\n", pages, largest);
  CHECK(pages >= 9 && pages <= 14, "a page holds a few of them: about nine to twelve pages");
  CHECK(largest <= ESPNOW_MESH_PAGE_MAX, "no page goes over the margin it keeps from the limit");

  // the entry that is the longest of the table does fit the buffer it is made in
  say("EspNowMeshNeighbors", "0");
  CmndEspNowMeshNeighbors();
  size_t first = g_response.find("{\"Id\":");
  size_t second = g_response.find(",{\"Id\":", first);
  CHECK(second != std::string::npos && second - first < ESPNOW_MESH_ENTRY_MAX, "an entry is shorter than the buffer it is made in");

  pages = 0;
  largest = walk_pages("EspNowMeshClock", CmndEspNowMeshClock, ids, &pages);
  printf("   EspNowMeshClock: 48 neighbours, %d pages, the largest %zu bytes\n", pages, largest);
  CHECK(largest <= ESPNOW_MESH_PAGE_MAX, "no page of the clock goes over the margin either");

  // the ends of the list: from the last neighbour, from the count, from beyond it, and a number that is not one
  say("EspNowMeshNeighbors", "47");
  CmndEspNowMeshNeighbors();
  Page last = read_page();
  CHECK(json_ok(g_response) && last.ids.size() == 1 && last.ids[0] == 146 && !last.hasNext, "from the last neighbour: that one, and no Next");
  for (const char* from : {"48", "200", "4000000000"}) {
    say("EspNowMeshNeighbors", from);
    CmndEspNowMeshNeighbors();
    Page none = read_page();
    CHECK(json_ok(g_response) && none.ids.empty() && !none.hasNext && g_response.find("\"List\":[]") != std::string::npos, "from the count or beyond: an empty list, and no Next");
  }
  say("EspNowMeshNeighbors", "x");
  CmndEspNowMeshNeighbors();
  Page zero = read_page();
  CHECK(json_ok(g_response) && zero.from == 0 && !zero.ids.empty(), "what is not a number is the first page");
  // the commands answer the same when no one asks, with no neighbour and with one
  end_world();
  make_world(true);
  EspNowMeshSnapshotMake(EspNowMeshDriver.node);
  say("EspNowMeshNeighbors", "");
  CmndEspNowMeshNeighbors();
  CHECK(json_ok(g_response) && g_response.find("\"Count\":0") != std::string::npos && g_response.find("\"List\":[]") != std::string::npos && g_response.find("Next") == std::string::npos, "with no neighbour the list is empty and ends");
  end_world();
}
