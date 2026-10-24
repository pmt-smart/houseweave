/*
 * The WiFi station driver and the ESP-NOW driver of the firmware, compiled from
 * their own source, over one device's radio (radio_core.h).
 *
 * What the radio does here is what the drivers can tell of it on the device:
 *   - a mode, off or station, and a channel, which a station associated with its
 *     access point takes from it, and which nothing may move then;
 *   - a soft access point beside the station (WiFi.softAP), on the station's
 *     channel when it is associated, as the ESP32 keeps the two on one, and the
 *     phones the page has join it (bh_radio_phone), with its password;
 *   - the access points in range, as the page lists them (bh_radio_ap): a scan
 *     finds them after RADIO_SCAN_MS, and a join (WiFiHelper::begin) associates
 *     with the strongest of the name, when its password is the network's, after
 *     RADIO_JOIN_MS, or fails twice, the attempt and the stack's one retry, with
 *     the reason the stack gives. With none listed, the one access point of the
 *     pairing's tests (`ap`, a channel) takes any network;
 *   - Tasmota's WiFi, which associates within a second when it is on, has a
 *     network saved and the access point is in range, and whose (re)connecting
 *     stops the WiFi stack first, as WifiBegin() does. A saved network that is
 *     not there, or whose password is not its own, is reported by the stack's
 *     disconnect event every few seconds, as its retries do; the WiFi Manager
 *     (Wifi.config_type) keeps the station off its network;
 *   - the WiFi stack's events, handed to what registered for them;
 *   - ESP-NOW: a peer table, and frames handed to the page (Module.radioSend),
 *     which carries them to the devices on the same channel and hands them back
 *     through bh_radio_receive. A frame to an encrypted peer reaches only a
 *     device that holds the sender as a peer with the same local master key, as
 *     CCMP does. The page may say no to a frame, as the radio does when its queue
 *     is full (esp_now_send gives ESP_ERR_ESPNOW_NO_MEM), and the air takes its
 *     time to carry what it accepts (radio.ts);
 *   - the main loop's time: the receive queue is drained by the main loop, one
 *     frame after another, and a command line or an event it brings keeps the loop
 *     busy for a while (Tasmota's command dispatch measured 8 to 15 ms).
 *     The queue stays the driver's own, four deep, dropping the
 *     oldest; what is the stand-in's is that the drain finds no item while the one
 *     before is still being run (bh_radio_set cost_cmd and cost_event, in ms; none
 *     by default, as a device alone has no loop to keep busy);
 *   - randomness from a generator seeded per device, so a run can be repeated;
 *   - HMAC-SHA256 and X25519 from the firmware's BearSSL (lib_ssl), compiled in
 *     beside this file.
 * One module instance is one device: a second device is a second instance.
 */
#include <emscripten.h>
#include "radio_core.h"
#include <t_bearssl.h>

TasmotaSettings SettingsData = {};
TasmotaSettings *Settings = &SettingsData;
TasmotaWifi Wifi = {};
WiFiClass WiFi;
TasmotaBerry berry = { nullptr };
const char kTypeError[] = "type_error";

/* An access point in range: what a scan lists, and what a join is checked against */
struct RadioAp {
  char ssid[33];
  uint8_t bssid[6];
  uint8_t channel;
  uint8_t auth;                            // wifi_auth_mode_t: 0 open
  int8_t rssi;
  char password[65];
};
#define RADIO_AP_MAX        16
#define RADIO_LEGACY_AP     RADIO_AP_MAX   // the one access point of `ap`, which takes any network
#define RADIO_SCAN_MS       2500           // a scan of all channels, as the bench sees one
#define RADIO_JOIN_MS       3000           // a join, to its address
#define RADIO_RETRY_MS      100            // the stack's one retry of a failed join
#define RADIO_TASMOTA_RETRY_MS 5000        // Tasmota's own attempts at a saved network that does not come up

static struct {
  uint8_t mac[6];
  wifi_mode_t mode;
  uint8_t channel;                         // the radio's
  uint8_t ap_channel;                      // the legacy access point's, 0 when none is in range
  RadioAp aps[RADIO_AP_MAX];               // the access points the page listed
  int ap_count;
  bool station_legacy;                     // associated with the legacy access point
  uint8_t station_bssid[6];                // or with the one of this BSSID
  bool scanning;
  uint32_t scan_done;
  int16_t scan_count;                      // what scanComplete() says when no scan runs
  bool joining;                            // WiFiHelper::begin, until it associates or fails
  uint32_t join_due;
  int join_ap;                             // where it associates, -1 when it fails
  uint8_t join_reason;                     // and then why
  uint8_t join_failures;
  uint32_t tasmota_retry;
  char ip[16];
  bool associated;
  uint32_t random;                         // xorshift32
  bool espnow;                             // esp_now_init() and no deinit since
  esp_now_recv_cb_t recv_cb;
  esp_now_send_cb_t send_cb;
  esp_now_peer_info_t peers[ESP_NOW_MAX_TOTAL_PEER_NUM];
  int peer_count;
  WiFiEventSysCb events[4];
  int event_count;
  std::string texts[SET_TEXT_COUNT];
  uint32_t sent;                           // ESP-NOW frames handed to the air
  uint32_t commands;                       // command lines run for the peer (ExecuteCommand)
  uint32_t cost_cmd_ms;                    // what the main loop spends on a frame's command line, then on its event
  uint32_t cost_event_ms;
  uint32_t taken_cmd;                      // the frames of each kind the main loop's drain took from the receive queue
  uint32_t taken_event;
  uint32_t dropped;                        // the frames the full receive queue made room for, the oldest each time
  uint32_t busy_until;                     // the main loop is in the item it took last until then
  bool in_rx;                              // the receive callback runs, the WiFi task's, which no cost holds back
  bool drain_waiting;                      // the drain left the queue for the item before to end: it goes on when it does
  bool softap;                             // the soft access point is up
  char softap_ssid[33];
  char softap_password[65];
  uint8_t softap_clients;                  // the phones on it
  uint8_t softap_max;
} Radio = {};

/* the station driver's hotspot is up (xdrv_96_wifi_station.ino), which a reconnection keeps */
bool StaCtrlHotspotUp(void);

/* 1 the frame is acknowledged (a unicast to a device on the channel, or a broadcast), 0 it is not, -1 the radio has no room for it */
EM_JS(int, js_radio_send, (const char *from, const char *to, const char *hex, int encrypt, const char *lmk, int channel), {
  var r = Module.radioSend(UTF8ToString(from), UTF8ToString(to), UTF8ToString(hex), encrypt, UTF8ToString(lmk), channel);
  return r === -1 ? -1 : (r ? 1 : 0);
});
EM_JS(void, js_radio_command, (const char *line), { Module.radioCommand(UTF8ToString(line)); });

static const char HEXDIGITS[] = "0123456789ABCDEF";

static void to_hex(const uint8_t *in, size_t len, char *out) {
  for (size_t i = 0; i < len; i++) {
    out[2 * i] = HEXDIGITS[in[i] >> 4];
    out[2 * i + 1] = HEXDIGITS[in[i] & 0x0F];
  }
  out[2 * len] = 0;
}

static int nibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  return -1;
}

static size_t from_hex(const char *hex, uint8_t *out, size_t max) {
  size_t n = 0;
  while (hex[0] && hex[1] && n < max) {
    int hi = nibble(hex[0]), lo = nibble(hex[1]);
    if (hi < 0 || lo < 0) break;
    out[n++] = (uint8_t)((hi << 4) | lo);
    hex += 2;
  }
  return n;
}

/* --- the WiFi stack's events --------------------------------------------------------------- */

static void radio_event(arduino_event_id_t id, uint8_t reason = 0) {
  arduino_event_t event = {};
  event.event_id = id;
  event.event_info.wifi_sta_disconnected.reason = reason;
  for (int i = 0; i < Radio.event_count; i++) Radio.events[i](&event);
}

void WiFiClass::onEvent(WiFiEventSysCb cb) {
  if (Radio.event_count < 4) Radio.events[Radio.event_count++] = cb;
}

static void radio_leave(uint8_t reason) {
  if (!Radio.associated) return;
  Radio.associated = false;
  radio_event(ARDUINO_EVENT_WIFI_STA_DISCONNECTED, reason);
}

/* The stack stops: what ESP-NOW held goes with it, as esp_wifi_stop() takes it, and a
 * scan or a join in flight ends there. */
static void radio_stop(void) {
  radio_leave(WIFI_REASON_ASSOC_LEAVE);
  Radio.scanning = false;
  Radio.joining = false;
  Radio.mode = WIFI_OFF;
  Radio.softap = false;
  Radio.softap_clients = 0;
  Radio.espnow = false;
  Radio.recv_cb = nullptr;
  Radio.send_cb = nullptr;
  Radio.peer_count = 0;
  radio_event(ARDUINO_EVENT_WIFI_STA_STOP);
  radio_event(ARDUINO_EVENT_WIFI_OFF);
}

/* the channel of an access point listed, or of the legacy one */
static uint8_t radio_ap_channel(int ap) {
  if (ap == RADIO_LEGACY_AP) return Radio.ap_channel;
  return (ap >= 0 && ap < Radio.ap_count) ? Radio.aps[ap].channel : 0;
}

/* the access point the station is associated with: an index, RADIO_LEGACY_AP, or -1
 * for none, or for one that is no longer in range */
static int radio_station(void) {
  if (!Radio.associated) return -1;
  if (Radio.station_legacy) return RADIO_LEGACY_AP;
  for (int i = 0; i < Radio.ap_count; i++) {
    if (!memcmp(Radio.aps[i].bssid, Radio.station_bssid, 6)) return i;
  }
  return -1;
}

/* The station associates, on the access point's channel, and has its address. */
static void radio_associate(int ap) {
  Radio.mode = WIFI_STA;
  Radio.station_legacy = (ap == RADIO_LEGACY_AP);
  if (ap >= 0 && ap < Radio.ap_count) memcpy(Radio.station_bssid, Radio.aps[ap].bssid, 6);
  Radio.channel = radio_ap_channel(ap);
  Radio.associated = true;
  radio_event(ARDUINO_EVENT_WIFI_STA_CONNECTED);
  radio_event(ARDUINO_EVENT_WIFI_STA_GOT_IP);
}

/* --- Arduino's WiFi ------------------------------------------------------------------------- */

/* the station's part, and the soft access point beside it */
wifi_mode_t WiFiClass::getMode() {
  return (wifi_mode_t)((Radio.mode == WIFI_STA ? WIFI_MODE_STA : 0) | (Radio.softap ? WIFI_MODE_AP : 0));
}

bool WiFiClass::disconnect(bool wifioff, bool eraseap) {
  (void)eraseap;
  Radio.joining = false;
  radio_leave(WIFI_REASON_ASSOC_LEAVE);
  if (wifioff && Radio.mode != WIFI_OFF) radio_stop();
  return true;
}

/*
 * A scan lists every access point in range once RADIO_SCAN_MS have passed. A
 * station that is not associated is left on the last channel scanned, as the
 * WiFi stack leaves it; an associated one goes back to its access point's.
 */
int16_t WiFiClass::scanNetworks(bool async) {
  (void)async;
  if (Radio.mode == WIFI_OFF) return WIFI_SCAN_FAILED;
  Radio.scanning = true;
  Radio.scan_done = millis() + RADIO_SCAN_MS;
  return WIFI_SCAN_RUNNING;
}
int16_t WiFiClass::scanComplete() {
  if (Radio.scanning) {
    if (!TimeReached(Radio.scan_done)) return WIFI_SCAN_RUNNING;
    Radio.scanning = false;
    Radio.scan_count = Radio.ap_count;
    if (!Radio.associated && Radio.mode != WIFI_OFF) Radio.channel = 13;
  }
  return Radio.scan_count;
}
void WiFiClass::scanDelete() { Radio.scan_count = WIFI_SCAN_FAILED; }
static const RadioAp *radio_scanned(uint8_t i) { return (i < Radio.ap_count) ? &Radio.aps[i] : nullptr; }
int32_t WiFiClass::RSSI(uint8_t i) { return radio_scanned(i) ? radio_scanned(i)->rssi : 0; }
String WiFiClass::SSID(uint8_t i) { return String(radio_scanned(i) ? radio_scanned(i)->ssid : ""); }
uint8_t WiFiClass::encryptionType(uint8_t i) { return radio_scanned(i) ? radio_scanned(i)->auth : 0; }
int32_t WiFiClass::channel(uint8_t i) { return radio_scanned(i) ? radio_scanned(i)->channel : 0; }
int32_t WiFiClass::channel() { return Radio.channel; }

/*
 * The soft access point: WPA2 with the passphrase given, on the channel given,
 * unless the station is associated, whose channel the ESP32 keeps it on. It
 * takes the phones the page has join it, up to max_connection.
 */
bool WiFiClass::softAP(const char *ssid, const char *passphrase, int channel, int ssid_hidden, int max_connection) {
  (void)ssid_hidden;
  if (!ssid || !*ssid) return false;
  if (!Radio.associated && channel >= 1 && channel <= 13) Radio.channel = channel;
  snprintf(Radio.softap_ssid, sizeof(Radio.softap_ssid), "%s", ssid);
  snprintf(Radio.softap_password, sizeof(Radio.softap_password), "%s", passphrase ? passphrase : "");
  Radio.softap = true;
  Radio.softap_clients = 0;
  Radio.softap_max = max_connection;
  return true;
}
bool WiFiClass::softAPdisconnect(bool wifioff) {
  Radio.softap = false;
  Radio.softap_clients = 0;
  if (wifioff && Radio.mode == WIFI_OFF) radio_stop();
  return true;
}
IPAddress WiFiClass::softAPIP() { return IPAddress(true); }
uint8_t WiFiClass::softAPgetStationNum() { return Radio.softap ? Radio.softap_clients : 0; }
String WiFiClass::BSSIDstr(uint8_t i) {
  char text[18] = "00:00:00:00:00:00";
  if (radio_scanned(i)) ToHex_P(radio_scanned(i)->bssid, 6, text, sizeof(text), ':');
  return String(text);
}
void WiFiClass::persistent(bool on) { (void)on; }
bool WiFiClass::enableIPv6(bool on) { (void)on; return true; }
bool WiFiClass::config(uint32_t ip, uint32_t gateway, uint32_t mask, uint32_t dns1, uint32_t dns2) {
  (void)ip; (void)gateway; (void)mask; (void)dns1; (void)dns2;
  return true;
}
bool WiFiClass::hostname(const char *name) { (void)name; return true; }
bool WiFiClass::setAutoReconnect(bool on) { (void)on; return true; }
int WiFiClass::status() { return Radio.associated ? WL_CONNECTED : 0; }
IPAddress WiFiClass::localIP() { return IPAddress(); }
const char *RadioStationIp(void) { return Radio.ip[0] ? Radio.ip : "192.168.2.50"; }

void WiFiHelper::setPhyMode(WiFiPhyMode_t mode) { (void)mode; }

/*
 * A join: the strongest access point of the name, and of the BSSID when one is
 * given, whose password is the one given (or that is open). The outcome is due
 * RADIO_JOIN_MS later (radio_join_step). With no access point listed, the legacy
 * one takes any network while it is in range.
 */
void WiFiHelper::begin(const char *ssid, const char *password, int32_t channel, const uint8_t *bssid) {
  (void)channel;
  if (Radio.mode == WIFI_OFF) return;
  radio_leave(WIFI_REASON_ASSOC_LEAVE);
  Radio.joining = true;
  Radio.join_due = millis() + RADIO_JOIN_MS;
  Radio.join_failures = 0;
  Radio.join_ap = -1;
  Radio.join_reason = WIFI_REASON_NO_AP_FOUND;
  if (!Radio.ap_count) {
    if (Radio.ap_channel) Radio.join_ap = RADIO_LEGACY_AP;
    return;
  }
  const char *name = ssid ? ssid : "";
  const char *secret = password ? password : "";
  for (int i = 0; i < Radio.ap_count; i++) {
    const RadioAp &ap = Radio.aps[i];
    if (strcmp(ap.ssid, name)) continue;
    if (bssid && memcmp(ap.bssid, bssid, 6)) continue;
    if (ap.auth && strcmp(ap.password, secret)) {
      Radio.join_reason = WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT;
      continue;
    }
    if (Radio.join_ap < 0 || ap.rssi > Radio.aps[Radio.join_ap].rssi) Radio.join_ap = i;
  }
}

/* A join in flight, at each call of the main loop: associated, or a failure, twice. */
static void radio_join_step(void) {
  if (!Radio.joining || !TimeReached(Radio.join_due)) return;
  if (Radio.mode == WIFI_OFF) {
    Radio.joining = false;
    return;
  }
  if (Radio.join_ap >= 0 && radio_ap_channel(Radio.join_ap)) {
    Radio.joining = false;
    radio_associate(Radio.join_ap);
    return;
  }
  radio_event(ARDUINO_EVENT_WIFI_STA_DISCONNECTED, Radio.join_reason);
  if (++Radio.join_failures >= 2) {
    Radio.joining = false;
    return;
  }
  Radio.join_due = millis() + RADIO_RETRY_MS;
}

/* --- Tasmota's WiFi, support_wifi.ino ------------------------------------------------------ */

void WifiSetMode(WiFiMode_t mode) {
  if (WiFi.getMode() == mode) return;
  if (mode == WIFI_OFF) {
    radio_stop();
    return;
  }
  // a mode with no access point takes it down; one with it leaves it to softAP()
  if (!(mode & WIFI_MODE_AP)) {
    Radio.softap = false;
    Radio.softap_clients = 0;
  }
  Radio.mode = (mode & WIFI_MODE_STA) ? WIFI_STA : WIFI_OFF;
}

/* the station off its network, and the radio off with it, unless the station
 * driver's hotspot is up, which the fork's WifiDisable() keeps */
void WifiDisable(void) {
  if (!TasmotaGlobal.global_state.wifi_down) {
    if (StaCtrlHotspotUp()) {
      radio_leave(WIFI_REASON_ASSOC_LEAVE);
      WifiSetMode(WIFI_AP);
    } else {
      WifiSetMode(WIFI_OFF);
    }
  }
  TasmotaGlobal.global_state.wifi_down = 1;
}

void WifiConnect(void) {
  if (!Settings->flag4.network_wifi) return;
  TasmotaGlobal.global_state.wifi_down = 0;
}

void WiFiSetSleepMode(void) {}
void WifiSetOutputPower(void) {}

/*
 * The access point Tasmota's WiFi goes to: of the first network saved, then of
 * the second, the strongest whose password is the one saved. -1 when none, with
 * why the first network saved does not come up.
 */
static int radio_saved_ap(uint8_t *reason) {
  *reason = 0;
  if (!Radio.ap_count) {
    if (Radio.texts[SET_STASSID1].empty() || !Radio.ap_channel) return -1;
    return RADIO_LEGACY_AP;
  }
  for (int n = 0; n < 2; n++) {
    const std::string &ssid = Radio.texts[n ? SET_STASSID2 : SET_STASSID1];
    const std::string &password = Radio.texts[n ? SET_STAPWD2 : SET_STAPWD1];
    if (ssid.empty()) continue;
    int best = -1;
    bool named = false;
    for (int i = 0; i < Radio.ap_count; i++) {
      const RadioAp &ap = Radio.aps[i];
      if (ssid != ap.ssid) continue;
      named = true;
      if (ap.auth && password != ap.password) continue;
      if (best < 0 || ap.rssi > Radio.aps[best].rssi) best = i;
    }
    if (best >= 0) return best;
    if (!*reason) *reason = named ? WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT : WIFI_REASON_NO_AP_FOUND;
  }
  return -1;
}

/*
 * Tasmota's WifiCheck, once a second: with its WiFi on and a network saved, the
 * station associates when the access point is in range. Coming from no
 * association, it goes through WifiBegin(), which switches station mode off
 * first: the WiFi stack stops, and ESP-NOW with it, unless the station driver's
 * hotspot is up, which the fork's WifiBegin() keeps. A network saved that does
 * not come up keeps the stack in station mode, trying, and says why every few
 * seconds. The WiFi Manager's access point keeps the station off its network.
 */
static void radio_tasmota_wifi(void) {
  if (!Settings->flag4.network_wifi || TasmotaGlobal.global_state.wifi_down) return;
  if (Wifi.config_type) {
    radio_leave(WIFI_REASON_ASSOC_LEAVE);
    return;
  }
  if (Radio.associated) {
    if (!radio_ap_channel(radio_station())) radio_leave(WIFI_REASON_NO_AP_FOUND);
    return;
  }
  if (Radio.joining) return;
  uint8_t reason;
  int ap = radio_saved_ap(&reason);
  if (ap < 0) {
    if (reason && TimeReached(Radio.tasmota_retry)) {
      if (Radio.mode == WIFI_OFF) Radio.mode = WIFI_STA;
      radio_event(ARDUINO_EVENT_WIFI_STA_DISCONNECTED, reason);
      Radio.tasmota_retry = millis() + RADIO_TASMOTA_RETRY_MS;
    }
    return;
  }
  if (Radio.mode != WIFI_OFF && !StaCtrlHotspotUp()) radio_stop();
  radio_associate(ap);
}

/* --- the settings ----------------------------------------------------------------------- */

const char *SettingsText(uint32_t index) { return index < SET_TEXT_COUNT ? Radio.texts[index].c_str() : ""; }
bool SettingsUpdateText(uint32_t index, const char *value) {
  if (index >= SET_TEXT_COUNT) return false;
  Radio.texts[index] = value ? value : "";
  return true;
}
void SettingsSave(uint8_t rotate) { (void)rotate; }

/* --- support.ino ------------------------------------------------------------------------ */

bool TimeReached(uint32_t timer) { return (int32_t)(millis() - timer) >= 0; }
int32_t TimeDifference(uint32_t prev, uint32_t next) { return (int32_t)(next - prev); }
int32_t TimePassedSince(uint32_t timestamp) { return TimeDifference(timestamp, millis()); }

char *ToHex_P(const unsigned char *in, size_t insz, char *out, size_t outsz, char inbetween) {
  size_t used = 0;
  for (size_t i = 0; i < insz && used + 3 <= outsz; i++) {
    if (i && inbetween) out[used++] = inbetween;
    out[used++] = HEXDIGITS[in[i] >> 4];
    out[used++] = HEXDIGITS[in[i] & 0x0F];
  }
  if (outsz) out[used < outsz ? used : outsz - 1] = 0;
  return out;
}

/* lib/default/jsmn-shadinger-1.0/src/JsonGenerator.cpp: the same characters escaped, the same way */
String EscapeJSONString(const char *text) {
  std::string out;
  for (const char *c = text ? text : ""; *c; c++) {
    char e = (*c == '"' || *c == '\\') ? *c : *c == '\n' ? 'n' : *c == '\t' ? 't' : *c == '\r' ? 'r' :
             *c == '\f' ? 'f' : *c == '\b' ? 'b' : 0;
    if (e) { out += '\\'; out += e; } else { out += *c; }
  }
  return String(out.c_str());
}

/* support_command.ino: `"` and `0` clear a text, as the drivers' commands read it */
uint32_t Shortcut(void) {
  if (XdrvMailbox.data_len == 1 && (XdrvMailbox.data[0] == '"' || XdrvMailbox.data[0] == '0')) return SC_CLEAR;
  return SC_NONE;
}

void ExecuteCommand(const char *cmnd, uint32_t source) {
  (void)source;
  Radio.commands++;
  js_radio_command(cmnd);
}

/* --- randomness ----------------------------------------------------------------------- */

uint32_t esp_random(void) {
  uint32_t x = Radio.random ? Radio.random : 0x9E3779B9;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  Radio.random = x;
  return x;
}

void esp_fill_random(void *buf, size_t len) {
  uint8_t *p = (uint8_t *)buf;
  while (len) {
    uint32_t r = esp_random();
    for (int i = 0; i < 4 && len; i++, len--) { *p++ = (uint8_t)r; r >>= 8; }
  }
}

/* --- mbedTLS's HMAC, over BearSSL's --------------------------------------------------------- */

struct mbedtls_md_info_t { int type; };
static const mbedtls_md_info_t sha256_info = { MBEDTLS_MD_SHA256 };

const mbedtls_md_info_t *mbedtls_md_info_from_type(mbedtls_md_type_t md_type) {
  return md_type == MBEDTLS_MD_SHA256 ? &sha256_info : nullptr;
}

int mbedtls_md_hmac(const mbedtls_md_info_t *md_info, const unsigned char *key, size_t keylen,
                    const unsigned char *input, size_t ilen, unsigned char *output) {
  if (md_info != &sha256_info) return -1;
  br_hmac_key_context kc;
  br_hmac_context ctx;
  br_hmac_key_init(&kc, &br_sha256_vtable, key, keylen);
  br_hmac_init(&ctx, &kc, 0);
  br_hmac_update(&ctx, input, ilen);
  br_hmac_out(&ctx, output);
  return 0;
}

/* --- FreeRTOS's queue ---------------------------------------------------------------------- */

struct RadioQueue {
  uint32_t depth, size, head, count;
  uint8_t *items;
};

QueueHandle_t xQueueCreate(uint32_t depth, uint32_t item_size) {
  RadioQueue *q = (RadioQueue *)calloc(1, sizeof(RadioQueue));
  q->depth = depth;
  q->size = item_size;
  q->items = (uint8_t *)calloc(depth, item_size);
  return q;
}

int xQueueSend(QueueHandle_t q, const void *item, uint32_t wait) {
  (void)wait;
  if (q->count == q->depth) return pdFALSE;
  memcpy(q->items + ((q->head + q->count) % q->depth) * q->size, item, q->size);
  q->count++;
  return pdTRUE;
}

/* what kind of frame an item is, 1 a command line and 2 an event, for what it costs the main loop (the driver names the types: defined after it) */
static int radio_item_kind(uint8_t type);

/*
 * The receive callback takes the oldest out to make room (it runs on the WiFi task, which the main loop's busy time
 * does not hold back); the main loop's drain takes what it finds once the item it took before is over. An item with
 * a cost keeps it busy that long, from the instant the one before ended when the drain was waiting for it (the real
 * loop went on at once), or from now: the next call before then finds nothing, and the stand-in says so to the page
 * (bh_radio_draining), which calls the loop again.
 */
int xQueueReceive(QueueHandle_t q, void *item, uint32_t wait) {
  (void)wait;
  if (!q->count) {
    Radio.drain_waiting = false;
    return pdFALSE;
  }
  bool costs = !Radio.in_rx && (Radio.cost_cmd_ms || Radio.cost_event_ms);
  if (costs && !TimeReached(Radio.busy_until)) {
    Radio.drain_waiting = true;
    return pdFALSE;
  }
  memcpy(item, q->items + q->head * q->size, q->size);
  q->head = (q->head + 1) % q->depth;
  q->count--;
  if (Radio.in_rx) {
    Radio.dropped++;
    return pdTRUE;
  }
  int kind = radio_item_kind(((const uint8_t *)item)[0]);
  if (kind == 1) Radio.taken_cmd++;
  if (kind == 2) Radio.taken_event++;
  if (costs) {
    uint32_t ms = kind == 1 ? Radio.cost_cmd_ms : kind == 2 ? Radio.cost_event_ms : 0;
    if (ms) Radio.busy_until = (Radio.drain_waiting ? Radio.busy_until : millis()) + ms;
    Radio.drain_waiting = false;
  }
  return pdTRUE;
}

/* --- esp_wifi.h ---------------------------------------------------------------------------- */

esp_err_t esp_wifi_sta_get_ap_info(wifi_ap_record_t *ap_info) {
  if (!Radio.associated) return ESP_FAIL;
  memset(ap_info, 0, sizeof(*ap_info));
  int station = radio_station();
  ap_info->primary = radio_ap_channel(station);
  if (station >= 0 && station < Radio.ap_count) {
    const RadioAp &ap = Radio.aps[station];
    memcpy(ap_info->bssid, ap.bssid, 6);
    strncpy((char *)ap_info->ssid, ap.ssid, sizeof(ap_info->ssid) - 1);
    ap_info->rssi = ap.rssi;
  }
  return ESP_OK;
}

esp_err_t esp_wifi_get_channel(uint8_t *primary, wifi_second_chan_t *second) {
  if (Radio.mode == WIFI_OFF) return ESP_FAIL;
  *primary = Radio.channel;
  if (second) *second = WIFI_SECOND_CHAN_NONE;
  return ESP_OK;
}

/* Refused with the station associated: moving the radio from under it is what the
 * drivers must never do, and a test that sees the refusal found a driver doing it. */
esp_err_t esp_wifi_set_channel(uint8_t primary, wifi_second_chan_t second) {
  (void)second;
  if (Radio.mode == WIFI_OFF || Radio.associated || primary < 1 || primary > 14) return ESP_FAIL;
  Radio.channel = primary;
  return ESP_OK;
}

esp_err_t esp_wifi_get_mac(wifi_interface_t ifx, uint8_t mac[6]) {
  (void)ifx;
  memcpy(mac, Radio.mac, 6);
  return ESP_OK;
}

/* --- esp_now.h ----------------------------------------------------------------------------- */

static esp_now_peer_info_t *radio_peer(const uint8_t *mac) {
  for (int i = 0; i < Radio.peer_count; i++) {
    if (!memcmp(Radio.peers[i].peer_addr, mac, 6)) return &Radio.peers[i];
  }
  return nullptr;
}

esp_err_t esp_now_init(void) {
  if (!(Radio.mode & WIFI_MODE_STA)) return ESP_FAIL;
  Radio.espnow = true;
  Radio.peer_count = 0;
  return ESP_OK;
}

esp_err_t esp_now_deinit(void) {
  Radio.espnow = false;
  Radio.recv_cb = nullptr;
  Radio.send_cb = nullptr;
  Radio.peer_count = 0;
  return ESP_OK;
}

esp_err_t esp_now_register_recv_cb(esp_now_recv_cb_t cb) {
  if (!Radio.espnow) return ESP_ERR_ESPNOW_NOT_INIT;
  Radio.recv_cb = cb;
  return ESP_OK;
}
esp_err_t esp_now_unregister_recv_cb(void) { Radio.recv_cb = nullptr; return ESP_OK; }
esp_err_t esp_now_register_send_cb(esp_now_send_cb_t cb) {
  if (!Radio.espnow) return ESP_ERR_ESPNOW_NOT_INIT;
  Radio.send_cb = cb;
  return ESP_OK;
}
esp_err_t esp_now_unregister_send_cb(void) { Radio.send_cb = nullptr; return ESP_OK; }

esp_err_t esp_now_add_peer(const esp_now_peer_info_t *peer) {
  if (!Radio.espnow) return ESP_ERR_ESPNOW_NOT_INIT;
  if (radio_peer(peer->peer_addr)) return ESP_ERR_ESPNOW_EXIST;
  if (Radio.peer_count >= ESP_NOW_MAX_TOTAL_PEER_NUM) return ESP_ERR_ESPNOW_FULL;
  Radio.peers[Radio.peer_count++] = *peer;
  return ESP_OK;
}

esp_err_t esp_now_del_peer(const uint8_t *peer_addr) {
  esp_now_peer_info_t *p = radio_peer(peer_addr);
  if (!Radio.espnow || !p) return ESP_ERR_ESPNOW_NOT_FOUND;
  *p = Radio.peers[--Radio.peer_count];
  return ESP_OK;
}

bool esp_now_is_peer_exist(const uint8_t *peer_addr) { return Radio.espnow && radio_peer(peer_addr); }

esp_err_t esp_now_send(const uint8_t *peer_addr, const uint8_t *data, size_t len) {
  if (!Radio.espnow) return ESP_ERR_ESPNOW_NOT_INIT;
  esp_now_peer_info_t *p = radio_peer(peer_addr);
  if (!p) return ESP_ERR_ESPNOW_NOT_FOUND;
  if (len > 250) return ESP_ERR_ESPNOW_ARG;
  if (p->channel && p->channel != Radio.channel) return ESP_ERR_ESPNOW_CHAN;
  char from[13], to[13], lmk[33], hex[501];
  to_hex(Radio.mac, 6, from);
  to_hex(peer_addr, 6, to);
  to_hex(p->lmk, ESP_NOW_KEY_LEN, lmk);
  to_hex(data, len, hex);
  int acked = js_radio_send(from, to, hex, p->encrypt ? 1 : 0, lmk, Radio.channel);
  if (acked < 0) return ESP_ERR_ESPNOW_NO_MEM;
  Radio.sent++;
  if (Radio.send_cb) {
    esp_now_send_info_t info = { Radio.mac, peer_addr };
    Radio.send_cb(&info, acked ? ESP_NOW_SEND_SUCCESS : ESP_NOW_SEND_FAIL);
  }
  return ESP_OK;
}

/* --- the drivers ----------------------------------------------------------------------------- */

#include "xdrv_96_wifi_station.ino"
#include "xdrv_98_espnow_direct.ino"

static int radio_item_kind(uint8_t type) {
  if (type == ESPNOW_DIRECT_TYPE_CMD) return 1;
  if (type == ESPNOW_DIRECT_TYPE_EVENT) return 2;
  return 0;
}

/* --- what the page calls -------------------------------------------------------------------- */

extern "C" {

/* The device: its address and its random seed, then FUNC_PRE_INIT and FUNC_INIT, as at boot. */
EMSCRIPTEN_KEEPALIVE void bh_radio_init(const char *mac_hex, uint32_t seed) {
  from_hex(mac_hex, Radio.mac, 6);
  Radio.random = seed ? seed : 1;
  Radio.scan_count = WIFI_SCAN_FAILED;
  if (!Radio.channel) Radio.channel = 1;     /* where the WiFi stack starts, with no network */
  berry.vm = bh_vm();                      /* NULL in a module with no VM started */
  Xdrv96(FUNC_PRE_INIT);
  Xdrv98(FUNC_PRE_INIT);
  Xdrv96(FUNC_INIT);
  Xdrv98(FUNC_INIT);
}

/*
 * What the page sets of the device: the WiFi (`wifi` 0|1, Tasmota's WiFi; `ap`
 * <channel>, the legacy access point in range, 0 for none; `mode` 0|1, the radio
 * off or in station mode; `channel`, the radio's; `manager` 0|1, the WiFi
 * Manager up, as WifiConfig 2 leaves Wifi.config_type; `ip`, the station's
 * address; `hostname`), and its texts (`ssid1`, `password1`, `ssid2`,
 * `password2`, `friendlyname`).
 */
EMSCRIPTEN_KEEPALIVE void bh_radio_set(const char *key, const char *value) {
  int n = atoi(value);
  if (!strcmp(key, "wifi")) {
    Settings->flag4.network_wifi = n ? 1 : 0;
    TasmotaGlobal.global_state.wifi_down = n ? 0 : 1;
    if (!n) WifiSetMode(WIFI_OFF);
  } else if (!strcmp(key, "ap")) {
    Radio.ap_channel = n;
  } else if (!strcmp(key, "mode")) {
    WifiSetMode(n ? WIFI_STA : WIFI_OFF);
  } else if (!strcmp(key, "channel")) {
    if (!Radio.associated) Radio.channel = n;
  } else if (!strcmp(key, "manager")) {
    Wifi.config_type = n ? 2 : 0;
  } else if (!strcmp(key, "ip")) {
    snprintf(Radio.ip, sizeof(Radio.ip), "%s", value);
  } else if (!strcmp(key, "hostname")) {
    snprintf(TasmotaGlobal.hostname, sizeof(TasmotaGlobal.hostname), "%s", value);
  } else if (!strcmp(key, "ssid1")) {
    Radio.texts[SET_STASSID1] = value;
  } else if (!strcmp(key, "password1")) {
    Radio.texts[SET_STAPWD1] = value;
  } else if (!strcmp(key, "ssid2")) {
    Radio.texts[SET_STASSID2] = value;
  } else if (!strcmp(key, "password2")) {
    Radio.texts[SET_STAPWD2] = value;
  } else if (!strcmp(key, "friendlyname")) {
    Radio.texts[SET_FRIENDLYNAME1] = value;
  } else if (!strcmp(key, "cost_cmd")) {
    Radio.cost_cmd_ms = n > 0 ? n : 0;
  } else if (!strcmp(key, "cost_event")) {
    Radio.cost_event_ms = n > 0 ? n : 0;
  }
}

/* A text of the settings, for the page: `ssid1`, `password1`, `ssid2`, `password2`, `friendlyname`. */
EMSCRIPTEN_KEEPALIVE const char *bh_radio_text(const char *key) {
  if (!strcmp(key, "ssid1")) return Radio.texts[SET_STASSID1].c_str();
  if (!strcmp(key, "password1")) return Radio.texts[SET_STAPWD1].c_str();
  if (!strcmp(key, "ssid2")) return Radio.texts[SET_STASSID2].c_str();
  if (!strcmp(key, "password2")) return Radio.texts[SET_STAPWD2].c_str();
  if (!strcmp(key, "friendlyname")) return Radio.texts[SET_FRIENDLYNAME1].c_str();
  return "";
}

/* The access points in range: cleared, then listed one by one (the BSSID as 12 hex digits). */
EMSCRIPTEN_KEEPALIVE void bh_radio_ap_clear(void) { Radio.ap_count = 0; }
EMSCRIPTEN_KEEPALIVE void bh_radio_ap(const char *ssid, const char *bssid_hex, int channel, int auth, int rssi, const char *password) {
  if (Radio.ap_count >= RADIO_AP_MAX) return;
  RadioAp &ap = Radio.aps[Radio.ap_count++];
  memset(&ap, 0, sizeof(ap));
  snprintf(ap.ssid, sizeof(ap.ssid), "%s", ssid);
  from_hex(bssid_hex, ap.bssid, 6);
  ap.channel = (uint8_t)channel;
  ap.auth = (uint8_t)auth;
  ap.rssi = (int8_t)rssi;
  snprintf(ap.password, sizeof(ap.password), "%s", password);
}

/* One of the main loop's calls: a join in flight goes on, and FUNC_EVERY_SECOND runs
 * Tasmota's own WiFi check first. */
EMSCRIPTEN_KEEPALIVE void bh_radio_tick(uint32_t function) {
  radio_join_step();
  if (function == FUNC_EVERY_SECOND) radio_tasmota_wifi();
  Xdrv96(function);
  Xdrv98(function);
}

/* A command, split as Tasmota splits one: the response, or NULL when neither driver has it. */
EMSCRIPTEN_KEEPALIVE const char *bh_radio_command(const char *name, uint32_t index, int usridx, int32_t payload, const char *data) {
  static char topic[64];
  static char text[256];
  snprintf(topic, sizeof(topic), "%s", name);
  snprintf(text, sizeof(text), "%s", data);
  XdrvMailbox.topic = topic;
  XdrvMailbox.data = text;
  XdrvMailbox.data_len = strlen(text);
  XdrvMailbox.index = index;
  XdrvMailbox.usridx = usridx != 0;
  XdrvMailbox.payload = payload;
  Response_P("");
  if (Xdrv96(FUNC_COMMAND) || Xdrv98(FUNC_COMMAND)) return CoreResponse();
  return NULL;
}

/*
 * A frame the air brings: dropped unless ESP-NOW is up, and, when it was
 * encrypted, unless this device holds the sender as an encrypted peer with the
 * same local master key. What is left goes to the receive callback, as the WiFi
 * task hands it on the device.
 */
EMSCRIPTEN_KEEPALIVE int bh_radio_receive(const char *from_text, const char *to_text, const char *data_text,
                                          int rssi, int encrypted, const char *lmk_text) {
  if (!Radio.espnow || !Radio.recv_cb || Radio.mode == WIFI_OFF) return 0;
  uint8_t from[6], to[6], lmk[ESP_NOW_KEY_LEN], data[250];
  from_hex(from_text, from, 6);
  from_hex(to_text, to, 6);
  size_t len = from_hex(data_text, data, sizeof(data));
  if (encrypted) {
    esp_now_peer_info_t *p = radio_peer(from);
    from_hex(lmk_text, lmk, sizeof(lmk));
    if (!p || !p->encrypt || memcmp(p->lmk, lmk, sizeof(lmk))) return 0;
  }
  wifi_pkt_rx_ctrl_t rx = { rssi, Radio.channel };
  esp_now_recv_info_t info = { from, to, &rx };
  Radio.in_rx = true;
  Radio.recv_cb(&info, data, (int)len);
  Radio.in_rx = false;
  return 1;
}

/* Whether the drain left items in the queue for the one before to end: the main loop is to be called again to go on. */
EMSCRIPTEN_KEEPALIVE int bh_radio_draining(void) { return Radio.drain_waiting ? 1 : 0; }

/*
 * The driver's X25519 on a secret and a point, as hex, for the RFC's test
 * vectors: "" when it gives no key, and always in a driver with no pairing.
 */
EMSCRIPTEN_KEEPALIVE const char *bh_radio_x25519(const char *secret_hex, const char *point_hex) {
  static char out[65];
  out[0] = 0;
#ifdef USE_ESPNOW_DIRECT_PAIRING
  uint8_t secret[32] = {}, point[32] = {}, result[32];
  from_hex(secret_hex, secret, 32);
  from_hex(point_hex, point, 32);
  if (EspNowDirectX25519(result, secret, point)) to_hex(result, 32, out);
#else
  (void)secret_hex;
  (void)point_hex;
#endif
  return out;
}

/* HMAC-SHA256 as the drivers get it, for the RFC's test vectors */
EMSCRIPTEN_KEEPALIVE const char *bh_radio_hmac(const char *key_hex, const char *data_hex) {
  static char out[65];
  static uint8_t key[256], data[512];
  uint8_t digest[32];
  size_t key_len = from_hex(key_hex, key, sizeof(key));
  size_t len = from_hex(data_hex, data, sizeof(data));
  out[0] = 0;
  if (!mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), key, key_len, data, len, digest)) to_hex(digest, 32, out);
  return out;
}

/* The channel ESP-NOW listens on, 0 when it does not listen. */
EMSCRIPTEN_KEEPALIVE int bh_radio_listening(void) {
  return (Radio.espnow && Radio.recv_cb && Radio.mode != WIFI_OFF) ? Radio.channel : 0;
}

/* What a test looks at: the radio, the WiFi and the station, and ESP-NOW's peer table. */
/* A phone joins the soft access point (join 1), with the password it gives, or one
 * of those on it leaves (join 0): 1 when it did */
EMSCRIPTEN_KEEPALIVE int bh_radio_phone(const char *ssid, const char *password, int join) {
  if (!join) {
    if (!Radio.softap_clients) return 0;
    Radio.softap_clients--;
    return 1;
  }
  if (!Radio.softap || strcmp(ssid ? ssid : "", Radio.softap_ssid) || strcmp(password ? password : "", Radio.softap_password)) return 0;
  if (Radio.softap_clients >= Radio.softap_max) return 0;
  Radio.softap_clients++;
  return 1;
}

EMSCRIPTEN_KEEPALIVE const char *bh_radio_state(void) {
  static char out[1600];
  int index = radio_station();
  const RadioAp *at = (index >= 0 && index < Radio.ap_count) ? &Radio.aps[index] : nullptr;
  char bssid[18] = "";
  if (at) ToHex_P(at->bssid, 6, bssid, sizeof(bssid), ':');
  const char *station = at ? at->ssid : (Radio.associated ? Radio.texts[SET_STASSID1].c_str() : "");
  int n = snprintf(out, sizeof(out),
    "{\"mode\":%d,\"softap\":%d,\"apClients\":%u,\"channel\":%u,\"ap\":%u,\"associated\":%d,\"wifi\":%d,\"wifiDown\":%d,\"espnow\":%d,"
    "\"sent\":%u,\"commands\":%u,\"claimed\":%d,\"paused\":%d,\"manager\":%d,\"scanning\":%d,\"joining\":%d,"
    "\"takenCmd\":%u,\"takenEvent\":%u,\"dropped\":%u,"
    "\"station\":\"%s\",\"bssid\":\"%s\",\"rssi\":%d,\"ip\":\"%s\",\"peers\":[",
    WiFi.getMode(), Radio.softap, Radio.softap_clients, Radio.channel, Radio.ap_channel, Radio.associated, Settings->flag4.network_wifi,
    TasmotaGlobal.global_state.wifi_down, Radio.espnow, Radio.sent, Radio.commands,
    StaCtrl.claimed, StaCtrl.paused, Wifi.config_type ? 1 : 0, Radio.scanning, Radio.joining,
    Radio.taken_cmd, Radio.taken_event, Radio.dropped,
    EscapeJSONString(station).c_str(), bssid, at ? at->rssi : (Radio.associated ? -50 : 0), RadioStationIp());
  for (int i = 0; i < Radio.peer_count && n < (int)sizeof(out) - 80; i++) {
    char mac[13];
    to_hex(Radio.peers[i].peer_addr, 6, mac);
    n += snprintf(out + n, sizeof(out) - n, "%s{\"mac\":\"%s\",\"channel\":%u,\"encrypt\":%d}",
      i ? "," : "", mac, Radio.peers[i].channel, Radio.peers[i].encrypt);
  }
  snprintf(out + n, sizeof(out) - n, "]}");
  return out;
}

}
