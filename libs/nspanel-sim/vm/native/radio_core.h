/*
 * The part of the ESP-IDF, of the Arduino core and of Tasmota that the WiFi
 * station driver and the ESP-NOW driver call, and nothing more.
 *
 * The drivers are not copied: radio_core.cpp includes the firmware's own files
 * (firmware/tasmota/tasmota/tasmota_xdrv_driver/xdrv_96_wifi_station.ino and
 * xdrv_98_espnow_direct.ino), and this header gives them the names they expect.
 * The names, constants and signatures are the ESP-IDF's, Arduino's and
 * Tasmota's; what they DO is radio_core.cpp's: one device's radio, whose frames
 * the page carries to the other devices (the air, in src/radio.ts).
 */
#pragma once
#include "tasmota_core.h"
#include <stdlib.h>
#include <string>
#include <utility>

#define USE_WIFI_STATION_CONTROL 1
/* the ESP-NOW driver's natives go into the module's Berry VM, when it has one */
#define USE_BERRY 1
/* as the bridge's image has it: the peer's commands go to the rules, for the application to take */
#define USE_ESPNOW_DIRECT_COMMANDS_TO_RULES 1
#define USE_ESPNOW_DIRECT 1
/* RADIO_WITHOUT_PAIRING builds a driver from before the pairing, to check it compiles */
#ifndef RADIO_WITHOUT_PAIRING
#define USE_ESPNOW_DIRECT_PAIRING 1
#endif

/* esp_err.h, esp_now.h */
typedef int esp_err_t;
#define ESP_OK                      0
#define ESP_FAIL                    -1
#define ESP_ERR_ESPNOW_BASE         0x3066
#define ESP_ERR_ESPNOW_NOT_INIT     (ESP_ERR_ESPNOW_BASE + 1)
#define ESP_ERR_ESPNOW_ARG          (ESP_ERR_ESPNOW_BASE + 2)
#define ESP_ERR_ESPNOW_NO_MEM       (ESP_ERR_ESPNOW_BASE + 3)
#define ESP_ERR_ESPNOW_FULL         (ESP_ERR_ESPNOW_BASE + 4)
#define ESP_ERR_ESPNOW_NOT_FOUND    (ESP_ERR_ESPNOW_BASE + 5)
#define ESP_ERR_ESPNOW_EXIST        (ESP_ERR_ESPNOW_BASE + 7)
#define ESP_ERR_ESPNOW_CHAN         (ESP_ERR_ESPNOW_BASE + 9)

/* esp_wifi_types.h */
typedef enum { WIFI_IF_STA = 0, WIFI_IF_AP } wifi_interface_t;
typedef enum { WIFI_SECOND_CHAN_NONE = 0, WIFI_SECOND_CHAN_ABOVE, WIFI_SECOND_CHAN_BELOW } wifi_second_chan_t;
typedef struct {
  uint8_t bssid[6];
  uint8_t ssid[33];
  uint8_t primary;
  int8_t rssi;
} wifi_ap_record_t;
typedef struct {
  int rssi;
  unsigned channel;
} wifi_pkt_rx_ctrl_t;
enum {
  WIFI_REASON_UNSPECIFIED = 1, WIFI_REASON_ASSOC_LEAVE = 8, WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT = 15,
  WIFI_REASON_802_1X_AUTH_FAILED = 23, WIFI_REASON_NO_AP_FOUND = 201, WIFI_REASON_AUTH_FAIL = 202,
  WIFI_REASON_HANDSHAKE_TIMEOUT = 204, WIFI_REASON_NO_AP_FOUND_W_COMPATIBLE_SECURITY = 210,
  WIFI_REASON_NO_AP_FOUND_IN_AUTHMODE_THRESHOLD = 211, WIFI_REASON_NO_AP_FOUND_IN_RSSI_THRESHOLD = 212,
};

/* esp_wifi.h */
esp_err_t esp_wifi_sta_get_ap_info(wifi_ap_record_t *ap_info);
esp_err_t esp_wifi_get_channel(uint8_t *primary, wifi_second_chan_t *second);
esp_err_t esp_wifi_set_channel(uint8_t primary, wifi_second_chan_t second);
esp_err_t esp_wifi_get_mac(wifi_interface_t ifx, uint8_t mac[6]);

/* esp_now.h, as in ESP-IDF 5.5 */
#define ESP_NOW_ETH_ALEN            6
#define ESP_NOW_KEY_LEN             16
#define ESP_NOW_MAX_TOTAL_PEER_NUM  20
typedef struct {
  uint8_t peer_addr[ESP_NOW_ETH_ALEN];
  uint8_t lmk[ESP_NOW_KEY_LEN];
  uint8_t channel;
  wifi_interface_t ifidx;
  bool encrypt;
  void *priv;
} esp_now_peer_info_t;
typedef struct {
  uint8_t *src_addr;
  uint8_t *des_addr;
  wifi_pkt_rx_ctrl_t *rx_ctrl;
} esp_now_recv_info_t;
typedef struct {
  const uint8_t *src_addr;
  const uint8_t *des_addr;
} esp_now_send_info_t;
typedef enum { ESP_NOW_SEND_SUCCESS = 0, ESP_NOW_SEND_FAIL } esp_now_send_status_t;
typedef void (*esp_now_recv_cb_t)(const esp_now_recv_info_t *info, const uint8_t *data, int len);
typedef void (*esp_now_send_cb_t)(const esp_now_send_info_t *info, esp_now_send_status_t status);
esp_err_t esp_now_init(void);
esp_err_t esp_now_deinit(void);
esp_err_t esp_now_register_recv_cb(esp_now_recv_cb_t cb);
esp_err_t esp_now_unregister_recv_cb(void);
esp_err_t esp_now_register_send_cb(esp_now_send_cb_t cb);
esp_err_t esp_now_unregister_send_cb(void);
esp_err_t esp_now_add_peer(const esp_now_peer_info_t *peer);
esp_err_t esp_now_del_peer(const uint8_t *peer_addr);
bool esp_now_is_peer_exist(const uint8_t *peer_addr);
esp_err_t esp_now_send(const uint8_t *peer_addr, const uint8_t *data, size_t len);

/* esp_random.h */
uint32_t esp_random(void);
void esp_fill_random(void *buf, size_t len);

/* mbedtls/md.h: HMAC-SHA256 only, over BearSSL's (radio_core.cpp) */
typedef enum { MBEDTLS_MD_NONE = 0, MBEDTLS_MD_SHA256 = 9 } mbedtls_md_type_t;
typedef struct mbedtls_md_info_t mbedtls_md_info_t;
const mbedtls_md_info_t *mbedtls_md_info_from_type(mbedtls_md_type_t md_type);
int mbedtls_md_hmac(const mbedtls_md_info_t *md_info, const unsigned char *key, size_t keylen,
                    const unsigned char *input, size_t ilen, unsigned char *output);

/* FreeRTOS's queue, for one task and a callback that never runs beside it */
typedef struct RadioQueue *QueueHandle_t;
#define pdTRUE  1
#define pdFALSE 0
QueueHandle_t xQueueCreate(uint32_t depth, uint32_t item_size);
int xQueueSend(QueueHandle_t queue, const void *item, uint32_t wait);
int xQueueReceive(QueueHandle_t queue, void *item, uint32_t wait);

/* Arduino: WString.h, IPAddress.h, WiFi.h */
class String {
  std::string s;
 public:
  String() {}
  String(const char *text) : s(text ? text : "") {}
  const char *c_str() const { return s.c_str(); }
  size_t length() const { return s.size(); }
  bool operator==(const String &other) const { return s == other.s; }
};

/* the station's address, as the page set it (radio_core.cpp) */
const char *RadioStationIp(void);

class IPAddress {
  bool soft_ap = false;
 public:
  IPAddress(bool ap = false) : soft_ap(ap) {}
  /* the station's, or the soft access point's, which the ESP32 gives 192.168.4.1 */
  String toString() const { return String(soft_ap ? "192.168.4.1" : RadioStationIp()); }
};

typedef enum { WIFI_MODE_NULL = 0, WIFI_MODE_STA = 1, WIFI_MODE_AP = 2, WIFI_MODE_APSTA = 3 } wifi_mode_t;
typedef wifi_mode_t WiFiMode_t;
#define WIFI_OFF   WIFI_MODE_NULL
#define WIFI_STA   WIFI_MODE_STA
#define WIFI_AP    WIFI_MODE_AP
#define WIFI_AP_STA WIFI_MODE_APSTA
#define WIFI_SCAN_RUNNING  (-1)
#define WIFI_SCAN_FAILED   (-2)
#define WL_CONNECTED       3

typedef enum {
  ARDUINO_EVENT_WIFI_OFF = 1, ARDUINO_EVENT_WIFI_STA_STOP, ARDUINO_EVENT_WIFI_STA_CONNECTED,
  ARDUINO_EVENT_WIFI_STA_DISCONNECTED, ARDUINO_EVENT_WIFI_STA_GOT_IP,
} arduino_event_id_t;
typedef struct {
  arduino_event_id_t event_id;
  union {
    struct { uint8_t reason; } wifi_sta_disconnected;
  } event_info;
} arduino_event_t;
typedef void (*WiFiEventSysCb)(arduino_event_t *event);

class WiFiClass {
 public:
  wifi_mode_t getMode();
  bool disconnect(bool wifioff = false, bool eraseap = false);
  int16_t scanNetworks(bool async = false);
  int16_t scanComplete();
  void scanDelete();
  int32_t RSSI(uint8_t i);
  String SSID(uint8_t i);
  uint8_t encryptionType(uint8_t i);
  int32_t channel(uint8_t i);
  int32_t channel();                       // the radio's, now
  bool softAP(const char *ssid, const char *passphrase = nullptr, int channel = 1, int ssid_hidden = 0, int max_connection = 4);
  bool softAPdisconnect(bool wifioff = false);
  IPAddress softAPIP();
  uint8_t softAPgetStationNum();
  String BSSIDstr(uint8_t i);
  void persistent(bool on);
  bool enableIPv6(bool on);
  bool config(uint32_t ip, uint32_t gateway, uint32_t mask, uint32_t dns1, uint32_t dns2);
  bool hostname(const char *name);
  bool setAutoReconnect(bool on);
  int status();
  IPAddress localIP();
  void onEvent(WiFiEventSysCb cb);
};
extern WiFiClass WiFi;

typedef int WiFiPhyMode_t;
struct WiFiHelper {
  static void setPhyMode(WiFiPhyMode_t mode);
  static void begin(const char *ssid, const char *password, int32_t channel, const uint8_t *bssid);
};

/* tasmota/include/tasmota_types.h, tasmota.h: what the two drivers read of the settings */
struct TasmotaSettings {
  struct { uint32_t network_wifi : 1; } flag4;
  uint8_t sta_active;
  uint8_t wifi_channel;
  uint8_t wifi_bssid[6];
  uint32_t ipv4_address[5];
};
extern TasmotaSettings *Settings;
enum SettingsTextIndex { SET_STASSID1, SET_STASSID2, SET_STAPWD1, SET_STAPWD2, SET_APBSSID1, SET_FRIENDLYNAME1, SET_TEXT_COUNT };
const char *SettingsText(uint32_t index);
bool SettingsUpdateText(uint32_t index, const char *value);
void SettingsSave(uint8_t rotate);

/* tasmota/tasmota_support/support_wifi.ino */
struct TasmotaWifi {
  uint8_t config_type;
  uint8_t scan_state;
  uint8_t phy_mode;
};
extern TasmotaWifi Wifi;
void WifiSetMode(WiFiMode_t mode);
void WifiDisable(void);
void WifiConnect(void);
void WiFiSetSleepMode(void);
void WifiSetOutputPower(void);

/* tasmota/tasmota_support/support.ino, support_command.ino */
bool TimeReached(uint32_t timer);
int32_t TimeDifference(uint32_t prev, uint32_t next);
int32_t TimePassedSince(uint32_t timestamp);
char *ToHex_P(const unsigned char *in, size_t insz, char *out, size_t outsz, char inbetween);
String EscapeJSONString(const char *text);
enum { SC_NONE, SC_CLEAR, SC_DEFAULT, SC_USER };
uint32_t Shortcut(void);
void ExecuteCommand(const char *cmnd, uint32_t source);
static const char S_JSON_COMMAND_ASTERISK[] = "{\"%s\":\"********\"}";

/* tasmota/tasmota_xdrv_driver/xdrv_52_*: the VM a driver registers its natives in */
#include "berry.h"
struct TasmotaBerry { bvm *vm; };
extern TasmotaBerry berry;
extern const char kTypeError[];
extern "C" bvm *bh_vm(void);

/*
 * lib/default/jsmn-shadinger-1.0/src/JsonParser.h, for StaJoin's payload: a flat
 * object of strings and numbers, read as the driver reads it (getStr, getUInt).
 * Keys match in any case, as jsmn-shadinger's do. Anything else is no object.
 */
class JsonParserObject {
  std::string keys[8], values[8];
  int count = -1;                          // -1: not an object
  static void skip(const char *&p) { while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') p++; }
  static bool string(const char *&p, std::string &out) {
    if (*p != '"') return false;
    for (p++; *p && *p != '"'; p++) {
      if (*p != '\\') { out += *p; continue; }
      p++;
      char c = *p == 'n' ? '\n' : *p == 't' ? '\t' : *p == 'r' ? '\r' : *p == 'b' ? '\b' : *p == 'f' ? '\f' : *p;
      if (!c) return false;
      out += c;
    }
    if (*p != '"') return false;
    p++;
    return true;
  }
 public:
  explicit JsonParserObject(const char *json = nullptr) {
    const char *p = json;
    if (!p) return;
    skip(p);
    if (*p++ != '{') return;
    int n = 0;
    skip(p);
    if (*p == '}') { count = 0; return; }
    while (n < 8) {
      std::string key, value;
      skip(p);
      if (!string(p, key)) return;
      skip(p);
      if (*p++ != ':') return;
      skip(p);
      if (*p == '"') {
        if (!string(p, value)) return;
      } else {
        while (*p && *p != ',' && *p != '}' && *p != ' ') value += *p++;
      }
      keys[n] = key;
      values[n++] = value;
      skip(p);
      if (*p == ',') { p++; continue; }
      if (*p == '}') { count = n; return; }
      return;
    }
  }
  bool operator!() const { return count < 0; }
  const char *getStr(const char *key, const char *def) const {
    for (int i = 0; i < count; i++) if (!strcasecmp(keys[i].c_str(), key)) return values[i].c_str();
    return def;
  }
  uint32_t getUInt(const char *key, uint32_t def) const {
    for (int i = 0; i < count; i++) if (!strcasecmp(keys[i].c_str(), key)) return (uint32_t)strtoul(values[i].c_str(), nullptr, 0);
    return def;
  }
};
class JsonParser {
  JsonParserObject root;
 public:
  JsonParser(char *json) : root(json) {}
  JsonParserObject getRootObject() { return root; }
};
