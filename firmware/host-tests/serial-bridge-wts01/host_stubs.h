// Host stand-ins for what xdrv_08_serial_bridge.ino takes from Tasmota and from its serial port: enough to compile the driver on a host
// (emscripten, node) with the Sonoff WTS01 decoding in, and to call its functions one at a time, on one thread. Not part of the firmware.
#pragma once
#include <cstdint>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdarg>
#include <cctype>
#include <string>
#include <deque>
#include <vector>

#define USE_SERIAL_BRIDGE
#define USE_WEBSERVER
#define ESP32
#define PSTR(s) s
#define PROGMEM

typedef std::string String;

// ---- time
static uint32_t g_millis = 100000;
static uint32_t millis(void) { return g_millis; }
static void yield(void) {}
static int32_t TimePassedSince(uint32_t timestamp) { return (int32_t)(millis() - timestamp); }

// ---- the sizes and the serial configurations of tasmota.h
const uint16_t INPUT_BUFFER_SIZE = 800;
const uint16_t MIN_INPUT_BUFFER_SIZE = 256;
const uint32_t SERIAL_POLLING = 100;
enum TasmotaSerialConfig {
  TS_SERIAL_5N1, TS_SERIAL_6N1, TS_SERIAL_7N1, TS_SERIAL_8N1,
  TS_SERIAL_5N2, TS_SERIAL_6N2, TS_SERIAL_7N2, TS_SERIAL_8N2,
  TS_SERIAL_5E1, TS_SERIAL_6E1, TS_SERIAL_7E1, TS_SERIAL_8E1,
  TS_SERIAL_5E2, TS_SERIAL_6E2, TS_SERIAL_7E2, TS_SERIAL_8E2,
  TS_SERIAL_5O1, TS_SERIAL_6O1, TS_SERIAL_7O1, TS_SERIAL_8O1,
  TS_SERIAL_5O2, TS_SERIAL_6O2, TS_SERIAL_7O2, TS_SERIAL_8O2 };

// ---- the words of the language file
#define D_CMND_SSERIALSEND "SSerialSend"
#define D_CMND_SBAUDRATE "SBaudrate"
#define D_CMND_SSERIALBUFFER "SSerialBuffer"
#define D_CMND_SSERIALCONFIG "SSerialConfig"
#define D_CMND_SSERIALMODE "SSerialMode"
#define D_JSON_TEMPERATURE "Temperature"
#define D_JSON_SSERIALRECEIVED "SSerialReceived"
#define D_LOG_COMMAND "CMD: "

// ---- settings and globals
enum { P_SERIAL_SKIP = 0, P_MAX = 8 };
struct HostSettings {
  uint16_t sbaudrate;
  uint8_t sserial_config;
  uint8_t sserial_mode;
  char serial_delimiter;
  uint8_t param[P_MAX];
  struct { uint32_t temperature_resolution : 2; } flag2;
  struct { uint32_t sb_receive_invert : 1; } flag3;
  struct { uint32_t mqtt_disable_publish : 1; } flag6;
};
static HostSettings g_settings;
static HostSettings* Settings = &g_settings;

static char g_serial_in_buffer[INPUT_BUFFER_SIZE];
struct HostGlobal {
  uint32_t serial_skip;
  uint32_t seriallog_level;
  uint32_t tele_period;
  char* serial_in_buffer;
};
static HostGlobal TasmotaGlobal = {0, 0, 1, g_serial_in_buffer};

struct HostMailbox {
  uint32_t index;
  uint32_t data_len;
  int32_t payload;
  char* data;
  const char* command;
};
static HostMailbox XdrvMailbox;

// ---- the driver's functions as Tasmota calls them
enum { FUNC_PRE_INIT, FUNC_LOOP, FUNC_SLEEP_LOOP, FUNC_JSON_APPEND, FUNC_WEB_SENSOR, FUNC_COMMAND, FUNC_ACTIVE };

// ---- pins
enum { GPIO_SBR_TX = 1, GPIO_SBR_RX = 2 };
static bool PinUsed(uint32_t gpio) { return GPIO_SBR_RX == gpio; }
static int Pin(uint32_t gpio) { return GPIO_SBR_RX == gpio ? 25 : -1; }
static void ClaimSerial(void) {}

// ---- the serial port: what the test puts in, the driver reads
static std::deque<uint8_t> g_rx;
static uint32_t g_baud = 0;
class TasmotaSerial {
 public:
  TasmotaSerial(int rx, int tx, int fallback, int edge, int buffer, bool invert) { (void)rx; (void)tx; (void)fallback; (void)edge; (void)buffer; (void)invert; }
  bool begin(uint32_t baud, uint32_t config) { g_baud = baud; (void)config; return true; }
  bool hardwareSerial(void) { return true; }
  int getUart(void) { return 2; }
  int available(void) { return (int)g_rx.size(); }
  int read(void) { if (g_rx.empty()) { return -1; } uint8_t b = g_rx.front(); g_rx.pop_front(); return b; }
  size_t write(const char* data, size_t len) { (void)data; return len; }
  size_t write(const char* text) { return strlen(text); }
  size_t write(uint8_t b) { (void)b; return 1; }
  void flush(void) {}
  void setRxBufferSize(size_t size) { (void)size; }
  size_t getRxBufferSize(void) { return MIN_INPUT_BUFFER_SIZE; }
};
static uint32_t ConvertSerialConfig(uint8_t config) { return config; }
static int8_t ParseSerialConfig(const char* text) { (void)text; return TS_SERIAL_8N1; }
static String GetSerialConfig(uint8_t config) { (void)config; return "8N1"; }
static void CmndSerialBuffer(void) {}

// ---- log: the formats are kept as they are, since Tasmota's own conversions (%*_H) are none of printf's
#define LOG_LEVEL_INFO 2
#define LOG_LEVEL_DEBUG 3
#define LOG_LEVEL_DEBUG_MORE 4
static std::vector<std::string> g_log;
static void AddLog(uint32_t level, const char* fmt, ...) { (void)level; g_log.push_back(fmt); }
static void SetMinimumSeriallog(void) {}
static bool GetLog(uint32_t level, uint32_t* index, char** line, size_t* len) { (void)level; (void)index; (void)line; (void)len; return false; }

// ---- the response: %s, %d, %u and Tasmota's %*_f, a float given by its address with the decimals before it
static std::string g_response;
static void ResponseFormat(const char* fmt, va_list ap) {
  char part[64];
  for (const char* f = fmt; *f; f++) {
    if ('%' != *f) { g_response += *f; continue; }
    f++;
    if (!strncmp(f, "*_f", 3)) {
      int decimals = va_arg(ap, int);
      float* value = va_arg(ap, float*);
      snprintf(part, sizeof(part), "%.*f", decimals, *value);
      g_response += part;
      f += 2;
    } else if ('s' == *f) {
      g_response += va_arg(ap, const char*);
    } else if ('d' == *f) {
      snprintf(part, sizeof(part), "%d", va_arg(ap, int));
      g_response += part;
    } else if ('u' == *f) {
      snprintf(part, sizeof(part), "%u", va_arg(ap, unsigned));
      g_response += part;
    } else {
      g_response += '%';
      g_response += *f;
    }
  }
}
static void Response_P(const char* fmt, ...) { g_response.clear(); va_list ap; va_start(ap, fmt); ResponseFormat(fmt, ap); va_end(ap); }
static void ResponseAppend_P(const char* fmt, ...) { va_list ap; va_start(ap, fmt); ResponseFormat(fmt, ap); va_end(ap); }
static void ResponseJsonEnd(void) { g_response += "}"; }
static void ResponseCmndNumber(int value) { g_response = std::to_string(value); }
static void ResponseCmndDone(void) { g_response = "Done"; }
static void ResponseCmndChar(const char* text) { g_response = text; }
static String EscapeJSONString(const char* text) { return text; }
static std::vector<std::string> g_web;
static void WSContentSend_Temp(const char* name, float value) { char t[64]; snprintf(t, sizeof(t), "%s %.2f", name, value); g_web.push_back(t); }
static float ConvertTemp(float celsius) { return celsius; }

// ---- what a received message goes to, in the modes the WTS01 is not
#define RESULT_OR_TELE 0
#define SRC_SSERIAL 0
static void MqttPublishPrefixTopicRulesProcess_P(uint32_t prefix, const char* subtopic) { (void)prefix; (void)subtopic; }
static void XdrvRulesProcess(bool teleperiod) { (void)teleperiod; }
static void ExecuteCommand(const char* cmnd, uint32_t source) { (void)cmnd; (void)source; }
static char* Unescape(char* buffer, uint32_t* size) { (void)size; return buffer; }
static char* RemoveSpace(char* p) { return p; }
static bool DecodeCommand(const char* haystack, void (* const MyCommand[])(void)) { (void)haystack; (void)MyCommand; return false; }
