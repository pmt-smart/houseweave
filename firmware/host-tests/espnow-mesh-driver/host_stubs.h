// Host stand-ins for what xdrv_98_1_espnow_mesh.ino takes from Tasmota, the ESP-IDF, FreeRTOS and Berry: enough to compile the
// driver on a host (emscripten, node) and to call its functions one at a time, on one thread. Not part of the firmware.
#pragma once
#include <cstdint>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdarg>
#include <cctype>
#include <string>
#include <vector>
#include <deque>
#include <map>
#include <new>

#define USE_ESPNOW_MESH
#define USE_BERRY
#define PSTR(s) s

// ---- ESP-IDF basics
typedef int esp_err_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_NO_MEM 0x101
#define ESP_ERR_INVALID_SIZE 0x104
#define ESP_ERR_INVALID_CRC 0x109
#define ESP_ERR_NVS_NOT_FOUND 0x1102
#define ESP_ERR_NVS_INVALID_LENGTH 0x110c
#define ESP_ERR_ESPNOW_NOT_INIT 0x3065
#define ESP_ERR_ESPNOW_NO_MEM 0x3067
#define ESP_ERR_ESPNOW_FULL 0x3068
#define ESP_ERR_ESPNOW_NOT_FOUND 0x3069
#define ESP_ERR_ESPNOW_EXIST 0x306b
#define ESP_NOW_MAX_TOTAL_PEER_NUM 20

// ---- time, random
static uint32_t g_millis = 100000;
static uint32_t millis(void) { return g_millis; }
static uint32_t micros(void) { return g_millis * 1000; }
static uint32_t g_random_state = 12345;
static uint32_t esp_random(void) { g_random_state = g_random_state * 1664525u + 1013904223u; return g_random_state; }
static void esp_fill_random(void* buf, size_t len) { for (size_t i = 0; i < len; i++) { ((uint8_t*)buf)[i] = (uint8_t)(esp_random() >> 24); } }
static uint8_t g_own_mac[6] = {0x24, 0x6f, 0x28, 0x00, 0x00, 0x01};
typedef int esp_mac_type_t;
#define ESP_MAC_WIFI_STA 0
static esp_err_t esp_read_mac(uint8_t* mac, esp_mac_type_t) { memcpy(mac, g_own_mac, 6); return ESP_OK; }
static uint32_t g_free_heap = 100000;
static uint32_t ESP_getFreeHeap(void) { return g_free_heap; }

// ---- Tasmota: log, response, mailbox, commands
#define LOG_LEVEL_ERROR 1
#define LOG_LEVEL_INFO 2
#define LOG_LEVEL_DEBUG 3
static std::vector<std::string> g_log;
static void AddLog(uint32_t level, const char* fmt, ...) {
  char text[512];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(text, sizeof(text), fmt, ap);
  va_end(ap);
  g_log.push_back(std::string(level == 1 ? "E " : level == 2 ? "I " : "D ") + text);
}
static std::string g_response;
#define MESSZ 1040                                              // what a message takes, as the firmware's
static uint32_t ResponseLength(void) { return (uint32_t)g_response.size(); }
#define snprintf_P snprintf
static std::vector<std::string> g_rules;
static int Response_P(const char* fmt, ...) {
  char text[4096];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(text, sizeof(text), fmt, ap);
  va_end(ap);
  g_response = text;
  return (int)g_response.size();
}
static int ResponseAppend_P(const char* fmt, ...) {
  char text[4096];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(text, sizeof(text), fmt, ap);
  va_end(ap);
  g_response += text;
  return (int)g_response.size();
}
struct { char* data; uint32_t data_len; const char* command; uint32_t index; int32_t payload; } XdrvMailbox;
static void ResponseCmndChar_P(const char* text) { g_response = std::string("{\"") + XdrvMailbox.command + "\":\"" + text + "\"}"; }
static void ResponseCmndNumber(int n) { g_response = std::string("{\"") + XdrvMailbox.command + "\":" + std::to_string(n) + "}"; }
static void ResponseCmndDone(void) { g_response = std::string("{\"") + XdrvMailbox.command + "\":\"Done\"}"; }
static void ResponseCmndError(void) { g_response = std::string("{\"") + XdrvMailbox.command + "\":\"Error\"}"; }
static bool XdrvRulesProcess(uint32_t) { g_rules.push_back(g_response); return false; }
static char* ToHex_P(const unsigned char* in, size_t insz, char* out, size_t outsz, char inbetween = 0) {
  static const char hex[] = "0123456789ABCDEF";
  size_t at = 0;
  for (size_t i = 0; i < insz && at + 3 <= outsz; i++) {
    if (inbetween && i) { out[at++] = inbetween; }
    out[at++] = hex[in[i] >> 4];
    out[at++] = hex[in[i] & 15];
  }
  if (at < outsz) { out[at] = 0; } else if (outsz) { out[outsz - 1] = 0; }
  return out;
}
static int32_t HexToBytes(const char* hex, uint8_t* out, size_t out_len) {
  size_t n = strlen(hex);
  if (n & 1) { return -1; }
  size_t bytes = n / 2;
  if (bytes > out_len) { return -1; }
  for (size_t i = 0; i < bytes; i++) {
    unsigned v;
    if (1 != sscanf(hex + 2 * i, "%2x", &v)) { return -1; }
    out[i] = (uint8_t)v;
  }
  return (int32_t)bytes;
}
#define FUNC_PRE_INIT 1
#define FUNC_INIT 2
#define FUNC_LOOP 3
#define FUNC_EVERY_SECOND 4
#define FUNC_COMMAND 5
static bool DecodeCommand(const char*, void (* const*)(void)) { return false; }
struct { struct { uint32_t network_wifi; } flag4; uint8_t sta_active; } g_settings;
static auto* Settings = &g_settings;
#define SET_STASSID1 1
#define SET_STASSID2 2
#define SET_STAPWD1 3
#define SET_STAPWD2 4
static std::string g_settings_text[8];                    // the networks saved and their passwords, by their index
static const char* SettingsText(int i) { return (i >= 0 && i < 8) ? g_settings_text[i].c_str() : ""; }
// Tasmota's WiFi state, the part the drivers read
static struct { uint8_t config_type; uint8_t retry; uint8_t retry_init; uint8_t scan_state; } Wifi;
static bool TimeReached(uint32_t timer) { return (int32_t)(millis() - timer) >= 0; }

// ---- FreeRTOS
typedef void* TaskHandle_t;
typedef int BaseType_t;
typedef uint32_t StackType_t;
#define pdTRUE 1
#define pdFALSE 0
#define pdPASS 1
#define portMAX_DELAY 0xFFFFFFFFu
#define pdMS_TO_TICKS(ms) (ms)
struct HostQueue { size_t item; size_t depth; std::deque<std::vector<uint8_t>> items; };
typedef HostQueue* QueueHandle_t;
struct HostSem { int count; };
typedef HostSem* SemaphoreHandle_t;
static QueueHandle_t xQueueCreate(size_t depth, size_t item) { return new HostQueue{item, depth, {}}; }
static void vQueueDelete(QueueHandle_t q) { delete q; }
static BaseType_t xQueueSend(QueueHandle_t q, const void* item, uint32_t) {
  if (q->items.size() >= q->depth) { return pdFALSE; }
  q->items.emplace_back((const uint8_t*)item, (const uint8_t*)item + q->item);
  return pdTRUE;
}
static BaseType_t xQueueReceive(QueueHandle_t q, void* item, uint32_t) {
  if (q->items.empty()) { return pdFALSE; }
  memcpy(item, q->items.front().data(), q->item);
  q->items.pop_front();
  return pdTRUE;
}
static size_t uxQueueSpacesAvailable(QueueHandle_t q) { return q->depth - q->items.size(); }
static SemaphoreHandle_t xSemaphoreCreateBinary(void) { return new HostSem{0}; }
static SemaphoreHandle_t xSemaphoreCreateMutex(void) { return new HostSem{1}; }
static void vSemaphoreDelete(SemaphoreHandle_t s) { delete s; }
static BaseType_t xSemaphoreTake(SemaphoreHandle_t s, uint32_t) { if (s->count > 0) { s->count--; return pdTRUE; } return pdFALSE; }
static BaseType_t xSemaphoreGive(SemaphoreHandle_t s) { s->count = 1; return pdTRUE; }
static bool g_task_created = false;
static bool g_task_fail = false;
static BaseType_t xTaskCreatePinnedToCore(void (*)(void*), const char*, uint32_t, void*, int, TaskHandle_t* handle, int) { if (g_task_fail) { return 0; } g_task_created = true; *handle = (TaskHandle_t)0x1; return pdPASS; }
static uint32_t g_notified = 0;
static void xTaskNotifyGive(TaskHandle_t) { g_notified++; }
static uint32_t ulTaskNotifyTake(BaseType_t, uint32_t) { return 0; }
static void (*g_on_delay)(void) = nullptr;                // what happens while the code waits: a test lets the task it stopped end
static void vTaskDelay(uint32_t) { if (g_on_delay) { g_on_delay(); } }
static void vTaskDelete(TaskHandle_t) {}
static uint32_t uxTaskGetStackHighWaterMark(TaskHandle_t) { return 3000; }
static TaskHandle_t g_current_task = (TaskHandle_t)0x1;       // the task the code runs in: the one the driver started, unless a test says otherwise
static TaskHandle_t xTaskGetCurrentTaskHandle(void) { return g_current_task; }

// ---- NVS: a store in memory with failure injection
typedef uint32_t nvs_handle_t;
typedef enum { NVS_READONLY, NVS_READWRITE } nvs_open_mode_t;
typedef struct { size_t used_entries, free_entries, total_entries, namespace_count; } nvs_stats_t;
static std::map<std::string, std::vector<uint8_t>> g_nvs;
static bool g_nvs_fail_set = false;          // nvs_set_blob answers an error
static bool g_nvs_fail_commit = false;
static bool g_nvs_lose_write = false;        // set and commit say ESP_OK and the flash keeps the old blob
static bool g_nvs_corrupt = false;           // what is read back differs
static int g_nvs_writes = 0;
static std::string g_nvs_ns;
static esp_err_t nvs_open(const char* ns, nvs_open_mode_t mode, nvs_handle_t* h) {
  g_nvs_ns = ns;
  bool any = false;
  for (auto& kv : g_nvs) { if (kv.first.rfind(std::string(ns) + "/", 0) == 0) { any = true; } }
  if (mode == NVS_READONLY && !any) { return ESP_ERR_NVS_NOT_FOUND; }
  *h = 1;
  return ESP_OK;
}
static void nvs_close(nvs_handle_t) {}
static esp_err_t nvs_set_blob(nvs_handle_t, const char* key, const void* v, size_t len) {
  if (g_nvs_fail_set) { return ESP_FAIL; }
  g_nvs_writes++;
  if (!g_nvs_lose_write) { g_nvs[g_nvs_ns + "/" + key] = std::vector<uint8_t>((const uint8_t*)v, (const uint8_t*)v + len); }
  return ESP_OK;
}
static esp_err_t nvs_commit(nvs_handle_t) { return g_nvs_fail_commit ? ESP_FAIL : ESP_OK; }
static esp_err_t nvs_get_blob(nvs_handle_t, const char* key, void* out, size_t* len) {
  auto it = g_nvs.find(g_nvs_ns + "/" + key);
  if (it == g_nvs.end()) { return ESP_ERR_NVS_NOT_FOUND; }
  if (!out) { *len = it->second.size(); return ESP_OK; }
  if (*len < it->second.size()) { *len = it->second.size(); return ESP_ERR_NVS_INVALID_LENGTH; }
  memcpy(out, it->second.data(), it->second.size());
  if (g_nvs_corrupt) { ((uint8_t*)out)[it->second.size() - 1] ^= 1; }
  *len = it->second.size();
  return ESP_OK;
}
static esp_err_t nvs_get_stats(const char*, nvs_stats_t* s) { s->used_entries = 270; s->free_entries = 234; s->total_entries = 504; s->namespace_count = 6; return ESP_OK; }

// ---- WiFi and ESP-NOW
typedef enum { WIFI_MODE_NULL = 0, WIFI_MODE_STA = 1 } wifi_mode_t;
typedef enum { WIFI_IF_STA = 0 } wifi_interface_t;
typedef enum { WIFI_SECOND_CHAN_NONE = 0 } wifi_second_chan_t;
typedef struct { uint8_t bssid[6]; uint8_t primary; } wifi_ap_record_t;
#define WL_CONNECTED 3
#define WL_DISCONNECTED 6
#define WIFI_SCAN_RUNNING -1
#define WIFI_REASON_ASSOC_LEAVE 8
#define WIFI_REASON_NO_AP_FOUND 201
#define WIFI_REASON_BEACON_TIMEOUT 200
static int g_wifi_mode = WIFI_MODE_STA;
static int g_wifi_status = WL_CONNECTED;
static uint8_t g_channel = 6;
static bool g_ap_associated = true;
static uint8_t g_ap_bssid[6] = {0xAA, 0, 0, 0, 0, 1};     // the access point the station is associated with, on g_channel
static int g_channel_sets = 0;                            // the times the radio was moved
static esp_err_t esp_wifi_sta_get_ap_info(wifi_ap_record_t* ap) {
  if (!g_ap_associated) { return ESP_FAIL; }
  memcpy(ap->bssid, g_ap_bssid, 6);
  ap->primary = g_channel;
  return ESP_OK;
}
static esp_err_t esp_wifi_get_channel(uint8_t* c, wifi_second_chan_t* s) { *c = g_channel; *s = WIFI_SECOND_CHAN_NONE; return ESP_OK; }
static esp_err_t esp_wifi_set_channel(uint8_t c, wifi_second_chan_t) { g_channel = c; g_channel_sets++; return ESP_OK; }
static esp_err_t esp_wifi_get_mac(wifi_interface_t, uint8_t* mac) { memcpy(mac, g_own_mac, 6); return ESP_OK; }
// Arduino's String, as much of it as the drivers take
struct String {
  std::string s;
  String(const char* c = "") : s(c) {}
  bool equals(const char* o) const { return s == o; }
  const char* c_str() const { return s.c_str(); }
};
// The access points around (the air a scan sees), the scan under way and what it found
struct HostAp { std::string ssid; int rssi; uint8_t channel; uint8_t bssid[6]; };
static std::vector<HostAp> g_aps;
static std::vector<HostAp> g_scan_found;
static bool g_scan_running = false;
static bool g_scan_refused = false;                      // the stack refuses a scan
static int g_scan_channel = -1;                           // the channel the last scan was asked for, 0 every one
static int g_scans = 0;
static bool g_auto_reconnect = true;
static int g_disconnects = 0;
// The last join: the network, the channel and the access point asked for (0 and none for the stack's own search)
static int g_begins = 0;
static std::string g_begin_ssid;
static int g_begin_channel = -1;
static uint8_t g_begin_bssid[6];
struct WiFiHelper {
  static void begin(const char* ssid, const char*, int32_t channel = 0, const uint8_t* bssid = nullptr) {
    g_begins++;
    g_begin_ssid = ssid;
    g_begin_channel = channel;
    if (bssid) { memcpy(g_begin_bssid, bssid, 6); } else { memset(g_begin_bssid, 0, 6); }
  }
};
// The scan under way ends: it found the access points around on the channel asked for
static void scan_finish(void) {
  g_scan_found.clear();
  for (auto& ap : g_aps) { if (!g_scan_channel || (ap.channel == g_scan_channel)) { g_scan_found.push_back(ap); } }
  g_scan_running = false;
}
struct IPAddress {
  uint8_t b[4];
  IPAddress() { memset(b, 0, 4); }
  IPAddress(uint8_t a, uint8_t c, uint8_t d, uint8_t e) { b[0] = a; b[1] = c; b[2] = d; b[3] = e; }
  bool operator==(const IPAddress& o) const { return !memcmp(b, o.b, 4); }
  uint8_t operator[](int i) const { return b[i]; }
  bool fromString(const char* s) { unsigned a, c, d, e; if (4 != sscanf(s, "%u.%u.%u.%u", &a, &c, &d, &e)) { return false; } b[0] = a; b[1] = c; b[2] = d; b[3] = e; return true; }
};
typedef struct { int event_id; struct { struct { uint8_t reason; } wifi_sta_disconnected; } event_info; } arduino_event_t;
#define ARDUINO_EVENT_WIFI_STA_STOP 1
#define ARDUINO_EVENT_WIFI_OFF 2
#define ARDUINO_EVENT_WIFI_STA_DISCONNECTED 3
static struct {
  int getMode() { return g_wifi_mode; }
  int status() { return g_wifi_status; }
  IPAddress localIP() { return IPAddress(192, 168, 2, 111); }
  IPAddress broadcastIP() { return IPAddress(192, 168, 2, 255); }
  int scanComplete() { return g_scan_running ? WIFI_SCAN_RUNNING : (int)g_scan_found.size(); }
  void onEvent(void (*)(arduino_event_t*)) {}
  int16_t scanNetworks(bool, bool, bool, uint32_t, uint8_t channel) {
    if (g_scan_refused) { return -2; }
    g_scans++;
    g_scan_channel = channel;
    g_scan_running = true;
    return WIFI_SCAN_RUNNING;
  }
  String SSID(int i) { return String(g_scan_found[i].ssid.c_str()); }
  int32_t RSSI(int i) { return g_scan_found[i].rssi; }
  uint8_t channel(int i) { return g_scan_found[i].channel; }
  uint8_t* BSSID(int i) { return g_scan_found[i].bssid; }
  void scanDelete() { g_scan_found.clear(); }
  void setAutoReconnect(bool on) { g_auto_reconnect = on; }
  bool disconnect() { g_disconnects++; g_ap_associated = false; g_wifi_status = WL_DISCONNECTED; return true; }
} WiFi;
struct WiFiUDP {
  bool begin(uint16_t) { return true; }
  void stop() {}
  int parsePacket() { return 0; }
  int read(uint8_t*, size_t) { return 0; }
  IPAddress remoteIP() { return IPAddress(); }
  void flush() {}
  bool beginPacket(IPAddress, uint16_t) { return true; }
  size_t write(const uint8_t*, size_t n) { return n; }
  bool endPacket() { return true; }
};

typedef struct { uint8_t peer_addr[6]; uint8_t lmk[16]; uint8_t channel; wifi_interface_t ifidx; bool encrypt; void* priv; } esp_now_peer_info_t;
typedef struct { uint8_t* src_addr; uint8_t* des_addr; struct { int rssi; }* rx_ctrl; } esp_now_recv_info_t;
typedef struct { uint8_t* des_addr; } esp_now_send_info_t;
typedef enum { ESP_NOW_SEND_SUCCESS = 0, ESP_NOW_SEND_FAIL } esp_now_send_status_t;
typedef void (*esp_now_recv_cb_t)(const esp_now_recv_info_t*, const uint8_t*, int);
typedef void (*esp_now_send_cb_t)(const esp_now_send_info_t*, esp_now_send_status_t);
static bool g_now_up = false;
static std::vector<std::vector<uint8_t>> g_peers;        // addresses, in the order added
static std::vector<std::pair<std::vector<uint8_t>, std::vector<uint8_t>>> g_sent;     // (to, frame) of every send that went
static esp_err_t g_add_error = ESP_OK;                    // esp_now_add_peer answers this when not ESP_OK
static esp_err_t g_send_error = ESP_OK;                   // esp_now_send answers this when not ESP_OK
static int g_send_status = ESP_NOW_SEND_SUCCESS;          // what the radio says of a send
static bool g_send_silent = false;                        // the radio gives no word at all
static esp_now_send_cb_t g_send_cb = nullptr;
static int g_deinits = 0, g_inits = 0;
static esp_err_t esp_now_init(void) { g_now_up = true; g_inits++; return ESP_OK; }
static esp_err_t esp_now_deinit(void) { g_now_up = false; g_peers.clear(); g_deinits++; return ESP_OK; }
static void esp_now_register_recv_cb(esp_now_recv_cb_t) {}
static void esp_now_register_send_cb(esp_now_send_cb_t cb) { g_send_cb = cb; }
static void esp_now_unregister_recv_cb(void) {}
static void esp_now_unregister_send_cb(void) { g_send_cb = nullptr; }
static bool esp_now_is_peer_exist(const uint8_t* mac) { for (auto& p : g_peers) { if (!memcmp(p.data(), mac, 6)) { return true; } } return false; }
static esp_err_t esp_now_add_peer(const esp_now_peer_info_t* peer) {
  if (!g_now_up) { return ESP_ERR_ESPNOW_NOT_INIT; }
  if (g_add_error != ESP_OK) { return g_add_error; }
  if (esp_now_is_peer_exist(peer->peer_addr)) { return ESP_ERR_ESPNOW_EXIST; }
  if (g_peers.size() >= ESP_NOW_MAX_TOTAL_PEER_NUM) { return ESP_ERR_ESPNOW_FULL; }
  g_peers.emplace_back(peer->peer_addr, peer->peer_addr + 6);
  return ESP_OK;
}
static esp_err_t esp_now_del_peer(const uint8_t* mac) {
  for (size_t i = 0; i < g_peers.size(); i++) { if (!memcmp(g_peers[i].data(), mac, 6)) { g_peers.erase(g_peers.begin() + i); return ESP_OK; } }
  return ESP_ERR_ESPNOW_NOT_FOUND;
}
typedef struct { int total_num; int encrypt_num; } esp_now_peer_num_t;
// The IDF's reads ESP-NOW's state, which is not there before esp_now_init nor after esp_now_deinit: on the device a call then is a load
// from a null pointer (LoadProhibited at 0x4c). Here it is counted, and every test looks at the count
static int g_peer_num_faults = 0;
static esp_err_t esp_now_get_peer_num(esp_now_peer_num_t* n) {
  if (!g_now_up) { g_peer_num_faults++; return ESP_ERR_ESPNOW_NOT_INIT; }
  n->total_num = (int)g_peers.size(); n->encrypt_num = 0; return ESP_OK;
}
static esp_err_t esp_now_send(const uint8_t* to, const uint8_t* data, size_t len) {
  if (!g_now_up) { return ESP_ERR_ESPNOW_NOT_INIT; }
  if (g_send_error != ESP_OK) { return g_send_error; }
  bool broadcast = true;
  for (int i = 0; i < 6; i++) { if (to[i] != 0xFF) { broadcast = false; } }
  if (!broadcast && !esp_now_is_peer_exist(to)) { return ESP_ERR_ESPNOW_NOT_FOUND; }
  g_sent.emplace_back(std::vector<uint8_t>(to, to + 6), std::vector<uint8_t>(data, data + len));
  if (!g_send_silent && g_send_cb) {
    uint8_t des[6];
    memcpy(des, to, 6);
    esp_now_send_info_t info{des};
    g_send_cb(&info, (esp_now_send_status_t)g_send_status);
  }
  return ESP_OK;
}

// ---- Berry: a stack of values
struct HostValue { int kind; int64_t i; std::string s; std::map<std::string, int64_t> m; std::map<std::string, std::string> ms; std::vector<HostValue> items; };    // 0 nil, 1 int, 2 bool, 3 string, 4 bytes, 5 map (of ints and bools in m, of strings in ms), 6 list (of items)
struct bvm { std::vector<HostValue> stack; std::map<std::string, bool> globals; bool raised = false; };
typedef int (*bntvfunc)(bvm*);
static std::map<std::string, bntvfunc> g_berry_functions;
static bntvfunc g_pending_function = nullptr;
static struct { bvm* vm; } berry;
static int be_top(bvm* vm) { return (int)vm->stack.size(); }
static bool be_isint(bvm* vm, int i) { return vm->stack[i - 1].kind == 1; }
static int be_toint(bvm* vm, int i) { return (int)vm->stack[i - 1].i; }
static bool be_tobool(bvm* vm, int i) { return vm->stack[i - 1].i != 0; }
static bool be_isbytes(bvm* vm, int i) { return vm->stack[i - 1].kind == 4; }
static const void* be_tobytes(bvm* vm, int i, size_t* n) { *n = vm->stack[i - 1].s.size(); return vm->stack[i - 1].s.data(); }
static bool be_isstring(bvm* vm, int i) { return vm->stack[i - 1].kind == 3; }
static const char* be_tostring(bvm* vm, int i) { return vm->stack[i - 1].s.c_str(); }
static void be_pushbool(bvm* vm, bool b) { vm->stack.push_back({2, b ? 1 : 0, ""}); }
typedef int bint;
static void be_pushint(bvm* vm, bint n) { vm->stack.push_back({1, n, ""}); }
static void be_pushnil(bvm* vm) { vm->stack.push_back({0, 0, ""}); }
static void be_pushbytes(bvm* vm, const void* data, size_t len) { vm->stack.push_back({4, 0, std::string((const char*)data, len)}); }
static void be_newobject(bvm* vm, const char* name) { vm->stack.push_back({strcmp(name, "list") ? 5 : 6, 0, ""}); vm->stack.push_back({0, 0, ""}); }   // the instance and the slot of its constructor, which a function pops
static void be_map_insert_int(bvm* vm, const char* key, int64_t value) { for (size_t i = vm->stack.size(); i-- > 0;) { if (vm->stack[i].kind == 5) { vm->stack[i].m[key] = value; return; } } }
static void be_map_insert_bool(bvm* vm, const char* key, bool value) { be_map_insert_int(vm, key, value ? 1 : 0); }
static void be_map_insert_str(bvm* vm, const char* key, const char* value) { for (size_t i = vm->stack.size(); i-- > 0;) { if (vm->stack[i].kind == 5) { vm->stack[i].ms[key] = value; return; } } }
// the value on top goes into the list the index names: the nearest list below it, as the real call's index (the list's own data) comes to
static void be_data_push(bvm* vm, int) { HostValue top = vm->stack.back(); for (size_t i = vm->stack.size() - 1; i-- > 0;) { if (vm->stack[i].kind == 6) { vm->stack[i].items.push_back(top); return; } } }
static void be_pushntvfunction(bvm*, bntvfunc f) { g_pending_function = f; }
static void be_setglobal(bvm* vm, const char* name) { g_berry_functions[name] = g_pending_function; vm->globals[name] = true; }
static bool be_getglobal(bvm* vm, const char* name) { bool found = vm->globals.count(name) > 0; vm->stack.push_back({0, 0, ""}); return found; }
static bool be_isnil(bvm* vm, int i) { return vm->stack[vm->stack.size() + i].kind == 0; }
static void be_pop(bvm* vm, int n) { while (n-- > 0 && !vm->stack.empty()) { vm->stack.pop_back(); } }
#define be_return(vm) return 1
#define be_return_nil(vm) return 1
enum { kTypeError = 1 };
#define be_raise(vm, type, msg) do { (vm)->raised = true; return 0; } while (0)
struct bvm;
