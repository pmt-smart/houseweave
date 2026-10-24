// Stand-ins for what xdrv_98_5_espnow_ota_receiver.ino and xdrv_98_6_espnow_ota_display.ino take from the ESP-IDF, the chip's ROM, FreeRTOS,
// Arduino and Tasmota, so that they compile and run on a host. Each one keeps what the tests look at: the frames sent, the NVS, the app
// partition, the boot partition set, what was written to the display and what the display says back.
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <deque>
#include <map>
#include <string>
#include <vector>
#include <emscripten.h>
#include <t_bearssl.h>

#define ESP32
#define USE_ESPNOW_OTA_RECEIVER
#define USE_ESPNOW_OTA_DISPLAY
#define PSTR(s) s
#define snprintf_P snprintf
#define strcmp_P strcmp

typedef int esp_err_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_NVS_NOT_FOUND 0x1102
#define ESP_ERR_INVALID_ARG 0x102

// --- Tasmota -------------------------------------------------------------------------------------------------------------------------------
#define LOG_LEVEL_ERROR 1
#define LOG_LEVEL_INFO 2
#define LOG_LEVEL_DEBUG 3
static std::vector<std::string> g_log;
static void AddLog(uint32_t, const char* fmt, ...) {
  char line[300];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(line, sizeof(line), fmt, ap);
  va_end(ap);
  g_log.push_back(line);
}
struct { uint32_t uptime; uint8_t restart_flag; char hostname[33]; } TasmotaGlobal;
static uint32_t g_millis = 100000;
static uint32_t millis(void) { return g_millis; }
enum { SET_FRIENDLYNAME1, SET_TEMPLATE_NAME, SET_DEVICENAME, SET_MAX };
static std::string g_settings_text[SET_MAX];
static const char* SettingsText(int i) { return g_settings_text[i].c_str(); }
enum WifiConfigOptions { WIFI_RESTART, EX_WIFI_SMARTCONFIG, WIFI_MANAGER };
static struct { uint8_t config_type; } Wifi;
static void WifiConfig(uint8_t type) { Wifi.config_type = type; }
#define FUNC_PRE_INIT 1
#define FUNC_INIT 2
#define FUNC_COMMAND 5
#define FUNC_LOOP 3
#define FUNC_EVERY_SECOND 4
#define FUNC_ACTIVE 6
#define FUNC_BUTTON_PRESSED 7
#define FUNC_BUTTON_MULTI_PRESSED 8
static int g_yields = 0;
static void yield(void) { g_yields++; }
static void delay(uint32_t ms) { g_yields++; g_millis += ms; }  // the time it waits goes by
static int g_restarts = 0;                                     // EspRestart, which returns here
static void EspRestart(void) { g_restarts++; }
#define RTC_NOINIT_ATTR

// --- FreeRTOS ------------------------------------------------------------------------------------------------------------------------------
typedef int BaseType_t;
#define pdTRUE 1
struct HostQueue { size_t item; size_t depth; std::deque<std::vector<uint8_t>> items; };
typedef HostQueue* QueueHandle_t;
static QueueHandle_t xQueueCreate(size_t depth, size_t item) { return new HostQueue{item, depth, {}}; }
static BaseType_t xQueueSend(QueueHandle_t q, const void* item, uint32_t) {
  if (q->items.size() >= q->depth) { return 0; }
  q->items.emplace_back((const uint8_t*)item, (const uint8_t*)item + q->item);
  return 1;
}
static BaseType_t xQueueReceive(QueueHandle_t q, void* item, uint32_t) {
  if (q->items.empty()) { return 0; }
  memcpy(item, q->items.front().data(), q->item);
  q->items.pop_front();
  return 1;
}

// --- WiFi and ESP-NOW ----------------------------------------------------------------------------------------------------------------------
typedef enum { WIFI_MODE_NULL = 0, WIFI_MODE_STA = 1 } wifi_mode_t;
typedef enum { WIFI_IF_STA = 0 } wifi_interface_t;
typedef enum { WIFI_SECOND_CHAN_NONE = 0 } wifi_second_chan_t;
#define WL_CONNECTED 3
#define WL_DISCONNECTED 6
static int g_wifi_mode = WIFI_MODE_STA;
static bool g_wifi_connected = false;                         // the station, on an access point
static bool g_auto_reconnect = true;                           // the stack's own retries
static int g_disconnects = 0;
static uint8_t g_channel = 1;                                  // the radio's: the access point's while connected
static struct {
  int getMode(void) { return g_wifi_mode; }
  int status(void) { return g_wifi_connected ? WL_CONNECTED : WL_DISCONNECTED; }
  uint8_t channel(void) { return g_channel; }
  bool setAutoReconnect(bool on) { g_auto_reconnect = on; return true; }
  bool disconnect(void) { g_disconnects++; g_wifi_connected = false; return true; }
} WiFi;
static esp_err_t esp_wifi_set_channel(uint8_t channel, wifi_second_chan_t) { if (g_wifi_connected) { return ESP_FAIL; } g_channel = channel; return ESP_OK; }
static esp_err_t esp_wifi_get_channel(uint8_t* channel, wifi_second_chan_t* second) { *channel = g_channel; *second = WIFI_SECOND_CHAN_NONE; return ESP_OK; }

typedef struct { uint8_t* src_addr; uint8_t* des_addr; void* rx_ctrl; } esp_now_recv_info_t;
typedef struct { uint8_t peer_addr[6]; uint8_t lmk[16]; uint8_t channel; wifi_interface_t ifidx; bool encrypt; void* priv; } esp_now_peer_info_t;
typedef void (*esp_now_recv_cb_t)(const esp_now_recv_info_t*, const uint8_t*, int);
struct Sent { uint8_t mac[6]; uint8_t from[6]; std::vector<uint8_t> data; };
static uint8_t g_who[6] = { 0x24, 0x6f, 0x28, 0x00, 0x00, 0x07 };   // the device whose code runs, which a frame sent is from
static std::vector<Sent> g_sent;
static std::vector<std::string> g_peers;                       // the unicast and broadcast peers registered, as hex
static esp_now_recv_cb_t g_recv_cb = nullptr;
static bool g_now_up = false;
static bool g_now_fail = false;
static std::string mac_hex(const uint8_t* m) { char b[13]; snprintf(b, sizeof(b), "%02x%02x%02x%02x%02x%02x", m[0], m[1], m[2], m[3], m[4], m[5]); return b; }
static esp_err_t esp_now_init(void) { if (g_now_fail) { return ESP_FAIL; } g_now_up = true; return ESP_OK; }
static esp_err_t esp_now_register_recv_cb(esp_now_recv_cb_t cb) { g_recv_cb = cb; return ESP_OK; }
static esp_err_t esp_now_add_peer(const esp_now_peer_info_t* p) { g_peers.push_back(mac_hex(p->peer_addr)); return ESP_OK; }
static esp_err_t esp_now_del_peer(const uint8_t* mac) {
  for (size_t i = 0; i < g_peers.size(); i++) { if (g_peers[i] == mac_hex(mac)) { g_peers.erase(g_peers.begin() + i); return ESP_OK; } }
  return ESP_FAIL;
}
static esp_err_t esp_now_send(const uint8_t* mac, const uint8_t* data, size_t len) {
  Sent s;
  memcpy(s.mac, mac, 6);
  memcpy(s.from, g_who, 6);
  s.data.assign(data, data + len);
  g_sent.push_back(s);
  return ESP_OK;
}

// --- NVS -----------------------------------------------------------------------------------------------------------------------------------
typedef uint32_t nvs_handle_t;
typedef enum { NVS_READONLY, NVS_READWRITE } nvs_open_mode_t;
static std::map<std::string, std::vector<uint8_t>> g_nvs;     // "namespace/key"
static std::vector<std::string> g_namespaces;                  // the handles, by their number
static esp_err_t nvs_open(const char* ns, nvs_open_mode_t mode, nvs_handle_t* h) {
  if (mode == NVS_READONLY) {
    bool any = false;
    for (auto& kv : g_nvs) { if (kv.first.rfind(std::string(ns) + "/", 0) == 0) { any = true; } }
    if (!any) { return ESP_ERR_NVS_NOT_FOUND; }
  }
  g_namespaces.push_back(ns);
  *h = (nvs_handle_t)g_namespaces.size() - 1;
  return ESP_OK;
}
static std::string nvs_key(nvs_handle_t h, const char* key) { return g_namespaces[h] + "/" + key; }
static void nvs_close(nvs_handle_t) {}
static esp_err_t nvs_commit(nvs_handle_t) { return ESP_OK; }
static esp_err_t nvs_set_blob(nvs_handle_t h, const char* key, const void* v, size_t len) {
  g_nvs[nvs_key(h, key)].assign((const uint8_t*)v, (const uint8_t*)v + len);
  return ESP_OK;
}
static esp_err_t nvs_get_blob(nvs_handle_t h, const char* key, void* out, size_t* len) {
  auto it = g_nvs.find(nvs_key(h, key));
  if (it == g_nvs.end()) { return ESP_ERR_NVS_NOT_FOUND; }
  if (out) {
    if (*len < it->second.size()) { return ESP_FAIL; }
    memcpy(out, it->second.data(), it->second.size());
  }
  *len = it->second.size();
  return ESP_OK;
}
static esp_err_t nvs_set_u16(nvs_handle_t h, const char* key, uint16_t v) { return nvs_set_blob(h, key, &v, 2); }
static esp_err_t nvs_get_u16(nvs_handle_t h, const char* key, uint16_t* v) { size_t n = 2; return nvs_get_blob(h, key, v, &n); }
static esp_err_t nvs_get_u8(nvs_handle_t h, const char* key, uint8_t* v) { size_t n = 1; return nvs_get_blob(h, key, v, &n); }
static esp_err_t nvs_set_str(nvs_handle_t h, const char* key, const char* v) { return nvs_set_blob(h, key, v, strlen(v) + 1); }
static esp_err_t nvs_get_str(nvs_handle_t h, const char* key, char* out, size_t* len) { return nvs_get_blob(h, key, out, len); }
static esp_err_t nvs_erase_all(nvs_handle_t h) {
  std::string prefix = g_namespaces[h] + "/";
  for (auto it = g_nvs.begin(); it != g_nvs.end();) { if (it->first.rfind(prefix, 0) == 0) { it = g_nvs.erase(it); } else { ++it; } }
  return ESP_OK;
}

// --- The app partition, the boot partition -------------------------------------------------------------------------------------------------
#define SPI_FLASH_SEC_SIZE 4096
typedef struct { uint32_t address; uint32_t size; } esp_partition_t;
static esp_partition_t g_app = { 0x220000, 2176 * 1024 };
static esp_partition_t g_factory = { 0x10000, 0xD0000 };       // the safeboot's
static std::vector<uint8_t> g_flash;                           // the app partition
static std::vector<uint8_t> g_factory_flash;                   // and the safeboot's
static bool g_flash_bad_write = false;                         // a write that went on bits not erased, which the flash cannot do
static int g_erases = 0;
static int g_factory_erases = 0;
static const esp_partition_t* g_boot = nullptr;                // the partition set to boot
static bool g_has_app = true;
static void flash_reset(void) {
  g_flash.assign(g_app.size, 0x00); g_factory_flash.assign(g_factory.size, 0x00);
  g_flash_bad_write = false; g_erases = 0; g_factory_erases = 0; g_boot = nullptr;
}
static std::vector<uint8_t>& flash_of(const esp_partition_t* p) { return p == &g_factory ? g_factory_flash : g_flash; }
#define ESP_PARTITION_TYPE_APP 0
#define ESP_PARTITION_SUBTYPE_APP_FACTORY 0
static const esp_partition_t* esp_partition_find_first(int type, int subtype, const char*) { return (type == 0 && subtype == 0) ? &g_factory : nullptr; }
typedef struct { uint32_t offset; uint32_t size; } esp_partition_pos_t;
typedef struct { uint32_t image_len; } esp_image_metadata_t;
#define ESP_IMAGE_VERIFY 0
static bool g_image_verify_fails = false;                      // the boot loader's check of an image
static esp_err_t esp_image_verify(int, const esp_partition_pos_t* pos, esp_image_metadata_t*) {
  const std::vector<uint8_t>& f = (pos->offset == g_factory.address) ? g_factory_flash : g_flash;
  return (!g_image_verify_fails && f[0] == 0xE9) ? ESP_OK : ESP_FAIL;
}
static const esp_partition_t* esp_ota_get_next_update_partition(const esp_partition_t*) { return g_has_app ? &g_app : nullptr; }
static const esp_partition_t* esp_ota_get_running_partition(void) { return &g_app; }    // the app, which the sender runs in
static bool g_boot_refuses = false;                            // the boot loader finds the image not whole
static esp_err_t esp_ota_set_boot_partition(const esp_partition_t* p) { if (g_boot_refuses) { return ESP_FAIL; } g_boot = p; return ESP_OK; }
static esp_err_t esp_partition_erase_range(const esp_partition_t* p, size_t at, size_t n) {
  if ((at % SPI_FLASH_SEC_SIZE) || (n % SPI_FLASH_SEC_SIZE) || (at + n > p->size)) { return ESP_ERR_INVALID_ARG; }
  memset(flash_of(p).data() + at, 0xFF, n);
  if (p == &g_factory) { g_factory_erases++; } else { g_erases++; }
  return ESP_OK;
}
static esp_err_t esp_partition_write(const esp_partition_t* p, size_t at, const void* v, size_t n) {
  if (at + n > p->size) { return ESP_ERR_INVALID_ARG; }
  for (size_t i = 0; i < n; i++) {
    uint8_t b = ((const uint8_t*)v)[i];
    std::vector<uint8_t>& f = flash_of(p);
    if ((f[at + i] & b) != b) { g_flash_bad_write = true; }
    f[at + i] &= b;                                            // a write only clears bits
  }
  return ESP_OK;
}
static esp_err_t esp_partition_read(const esp_partition_t* p, size_t at, void* v, size_t n) {
  if (at + n > p->size) { return ESP_ERR_INVALID_ARG; }
  memcpy(v, flash_of(p).data() + at, n);
  return ESP_OK;
}

// --- The inflater in the ROM (miniz's tinfl), by Node's zlib, which inflates the same raw deflate --------------------------------------------
typedef enum {
  TINFL_STATUS_BAD_PARAM = -3, TINFL_STATUS_ADLER32_MISMATCH = -2, TINFL_STATUS_FAILED = -1, TINFL_STATUS_DONE = 0,
  TINFL_STATUS_NEEDS_MORE_INPUT = 1, TINFL_STATUS_HAS_MORE_OUTPUT = 2
} tinfl_status;
enum { TINFL_FLAG_PARSE_ZLIB_HEADER = 1, TINFL_FLAG_HAS_MORE_INPUT = 2, TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF = 4, TINFL_FLAG_COMPUTE_ADLER32 = 8 };
typedef struct { uint32_t m_state; uint8_t rest[10996]; } tinfl_decompressor;   // the ROM's is about 11 KB, which the receiver takes from the heap
#define tinfl_init(r) do { (r)->m_state = 0; } while (0)
EM_JS(int, host_inflate_raw, (const uint8_t* src, size_t src_len, uint8_t* dst, size_t dst_cap), {
  try {
    const r = require("zlib").inflateRawSync(HEAPU8.subarray(src, src + src_len));
    if (r.length > dst_cap) return -2;
    HEAPU8.set(r, dst);
    return r.length;
  } catch (e) {
    return -1;
  }
});
static int g_inflates = 0;
static tinfl_status tinfl_decompress(tinfl_decompressor* r, const uint8_t* in, size_t* in_len, uint8_t* out_start, uint8_t* out_next, size_t* out_len, uint32_t flags) {
  g_inflates++;
  if (r->m_state != 0 || out_start != out_next || !(flags & TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF) || (flags & TINFL_FLAG_HAS_MORE_INPUT)) { return TINFL_STATUS_BAD_PARAM; }
  int n = host_inflate_raw(in, *in_len, out_next, *out_len);
  if (n == -2) { return TINFL_STATUS_HAS_MORE_OUTPUT; }
  if (n < 0) { *out_len = 0; return TINFL_STATUS_FAILED; }
  *out_len = (size_t)n;
  return TINFL_STATUS_DONE;
}

// --- The sender's side, for the tests: raw deflate by Node's zlib, as the release tool does ------------------------------------------------
EM_JS(int, host_deflate_raw, (const uint8_t* src, size_t src_len, uint8_t* dst, size_t dst_cap), {
  const r = require("zlib").deflateRawSync(HEAPU8.subarray(src, src + src_len), { level: 9 });
  if (r.length > dst_cap) return -1;
  HEAPU8.set(r, dst);
  return r.length;
});

// --- The display's serial: what the safeboot writes to it, and what it says back ----------------------------------------------------------
#define SERIAL_8N1 0x800001c
struct HostSerial {
  bool begun = false;
  uint32_t baud = 0;
  int rx_pin = -1;
  int tx_pin = -1;
  std::string out;                                             // every byte written
  std::deque<uint8_t> in;                                      // what the display has said and not been read
  void begin(uint32_t b, uint32_t, int rx, int tx) { begun = true; baud = b; rx_pin = rx; tx_pin = tx; }
  size_t write(const uint8_t* p, size_t n) { out.append((const char*)p, n); return n; }
  int available(void) { return (int)in.size(); }
  int read(void) { if (in.empty()) { return -1; } uint8_t b = in.front(); in.pop_front(); return b; }
};
typedef HostSerial HardwareSerial;
static HostSerial Serial2;

// --- The sender's side (xdrv_98_7): Tasmota's answers and commands, its partition helpers, and an HTTP client over files in memory ------------
#include <Arduino.h>
#define MESSZ 1040
static std::string g_response;
static std::vector<std::string> g_rules;
static int Response_P(const char* fmt, ...) {
  char b[MESSZ];
  va_list ap;
  va_start(ap, fmt);
  int n = vsnprintf(b, sizeof(b), fmt, ap);
  va_end(ap);
  g_response = b;
  return n;
}
static int ResponseAppend_P(const char* fmt, ...) {
  char b[MESSZ];
  va_list ap;
  va_start(ap, fmt);
  int n = vsnprintf(b, sizeof(b), fmt, ap);
  va_end(ap);
  g_response += b;
  return n;
}
struct { char* data; uint32_t data_len; const char* command; } XdrvMailbox;
static void ResponseCmndChar_P(const char* text) { g_response = std::string("{\"") + XdrvMailbox.command + "\":\"" + text + "\"}"; }
static void ResponseCmndDone(void) { ResponseCmndChar_P("Done"); }
static bool XdrvRulesProcess(uint32_t) { g_rules.push_back(g_response); return false; }
static bool DecodeCommand(const char*, void (* const*)(void)) { return false; }
static char* ToHex_P(const unsigned char* in, size_t insz, char* out, size_t outsz, char inbetween = 0) {
  size_t o = 0;
  for (size_t i = 0; i < insz && o + 3 < outsz; i++) {
    if (i && inbetween) { out[o++] = inbetween; }
    o += snprintf(out + o, outsz - o, "%02X", in[i]);
  }
  out[o] = 0;
  return out;
}
static int32_t HexToBytes(const char* hex, uint8_t* out, size_t out_len) {
  size_t n = strlen(hex) / 2;
  if (n > out_len) { return -1; }
  for (size_t i = 0; i < n; i++) { unsigned v; if (sscanf(hex + 2 * i, "%2x", &v) != 1) { return -1; } out[i] = (uint8_t)v; }
  return (int32_t)n;
}
static esp_err_t nvs_set_u8(nvs_handle_t h, const char* key, uint8_t v) { return nvs_set_blob(h, key, &v, 1); }
static bool g_single_ota = true;                               // the safeboot layout: one app partition and the safeboot image
static uint32_t g_running_factory = 0;
static int g_to_safeboot = 0;                                  // the otadata erased, for the next start to be the safeboot image's
static bool EspSingleOtaPartition(void) { return g_single_ota; }
static uint32_t EspRunningFactoryPartition(void) { return g_running_factory; }
static void EspPrepRestartToSafeBoot(void) { g_to_safeboot++; }

static std::map<std::string, std::vector<uint8_t>> g_http;     // what the server has, by URL
static int g_http_gets = 0;
static void (*g_http_after)(void) = nullptr;                    // what changes on the server once g_http_after_gets requests have come
static int g_http_after_gets = 0;
static int g_http_stalls = 0;                                  // ranges whose bytes stop halfway, the connection left open
struct HostStream {
  const uint8_t* p = nullptr;
  size_t n = 0;
  size_t stall_at = SIZE_MAX;                                  // the bytes left when nothing more comes
  int available(void) { return (n > stall_at) ? (int)(n - stall_at) : ((stall_at == SIZE_MAX) ? (int)n : 0); }
  int read(uint8_t* buf, size_t len) {
    size_t k = (size_t)available();
    if (k > len) { k = len; }
    memcpy(buf, p, k); p += k; n -= k;
    return (int)k;
  }
  bool connected(void) { return n > 0; }
};
typedef HostStream WiFiClient;
class HTTPClientLight {
  std::string url_, range_;
  std::vector<uint8_t> body_;
  HostStream stream_;
 public:
  bool begin(const String& url) { url_ = url; return true; }
  void setTimeout(uint16_t) {}
  void setConnectTimeout(int32_t) {}
  void addHeader(const String& name, const String& value, bool = false, bool = true) { if (name == "Range") { range_ = value; } }
  int GET(void) {
    g_http_gets++;
    if (g_http_after && g_http_gets > g_http_after_gets) { g_http_after(); g_http_after = nullptr; }
    auto it = g_http.find(url_);
    if (it == g_http.end()) { return 404; }
    body_ = it->second;
    int code = 200;
    if (!range_.empty()) {
      unsigned a = 0, b = 0;
      if ((sscanf(range_.c_str(), "bytes=%u-%u", &a, &b) != 2) || (a >= body_.size())) { body_.clear(); return 416; }
      if (b >= body_.size()) { b = (unsigned)body_.size() - 1; }
      body_ = std::vector<uint8_t>(body_.begin() + a, body_.begin() + b + 1);
      code = 206;
    }
    stream_.p = body_.data();
    stream_.n = body_.size();
    stream_.stall_at = SIZE_MAX;
    if ((206 == code) && (g_http_stalls > 0)) {
      g_http_stalls--;
      stream_.stall_at = body_.size() / 2;
    }
    return code;
  }
  int getSize(void) { return (int)body_.size(); }
  HostStream& getStream(void) { return stream_; }
  HostStream* getStreamPtr(void) { return &stream_; }
  String getString(void) { return String(std::string(body_.begin(), body_.end())); }
  void end(void) {}
};
typedef HTTPClientLight HTTPClient;                             // the core's client, which the safeboot image's receiver takes: the same stand-in
