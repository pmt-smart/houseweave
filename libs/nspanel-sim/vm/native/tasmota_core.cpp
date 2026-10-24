/*
 * The button driver of the panel's firmware, compiled from its own source, over
 * the few calls of Tasmota's core it makes (tasmota_core.h).
 *
 * Each call does here what it does in Tasmota, as far as the driver can tell:
 * a response is a JSON string, a rules process hands that string to the rules,
 * ExecuteCommandPower switches a relay. The effects go to the page through
 * Module.core*, which is where the relays and the rules of the simulator are.
 */
#include <stdlib.h>
#include <emscripten.h>
#include "tasmota_core.h"

XDRVMAILBOX XdrvMailbox;
TASMOTA_GLOBAL TasmotaGlobal = { 2, { 0 }, "panel" };

static char response[1024];
static char command_name[64];

EM_JS(uint32_t, js_millis, (void), { return Module.coreMillis() >>> 0; });
EM_JS(void, js_power, (uint32_t device, uint32_t state, uint32_t source), { Module.corePower(device, state, source); });
EM_JS(void, js_beep, (uint32_t count), { Module.coreBeep(count); });
EM_JS(void, js_log, (uint32_t level, const char *msg), { Module.coreLog(level, UTF8ToString(msg)); });
EM_JS(void, js_rules, (const char *subtopic, const char *json), { Module.coreRules(UTF8ToString(subtopic), UTF8ToString(json)); });
EM_JS(char *, js_nvm_load, (const char *ns, const char *key), {
  const r = Module.coreNvmLoad(UTF8ToString(ns), UTF8ToString(key));
  return r === null || r === undefined ? 0 : stringToNewUTF8(String(r));
});
EM_JS(void, js_nvm_save, (const char *ns, const char *key, const char *hex), {
  Module.coreNvmSave(UTF8ToString(ns), UTF8ToString(key), UTF8ToString(hex));
});

uint32_t millis(void) { return js_millis(); }

void ExecuteCommandPower(uint32_t device, uint32_t state, uint32_t source) { js_power(device, state, source); }

void BuzzerBeep(uint32_t count) { js_beep(count); }

void AddLog(uint32_t loglevel, const char *formatP, ...) {
  char line[512];
  va_list ap;
  va_start(ap, formatP);
  vsnprintf(line, sizeof(line), formatP, ap);
  va_end(ap);
  js_log(loglevel, line);
}

int Response_P(const char *format, ...) {
  va_list ap;
  va_start(ap, format);
  int n = vsnprintf(response, sizeof(response), format, ap);
  va_end(ap);
  return n;
}

int ResponseAppend_P(const char *format, ...) {
  size_t used = strlen(response);
  va_list ap;
  va_start(ap, format);
  int n = vsnprintf(response + used, sizeof(response) - used, format, ap);
  va_end(ap);
  return n;
}

/* tasmota_support/support_command.ino, with Tasmota's default state texts */
void ResponseCmndIdxNumber(int value) { Response_P("{\"%s%d\":%d}", XdrvMailbox.command, XdrvMailbox.index, value); }
void ResponseCmndStateText(uint32_t value) { Response_P("{\"%s\":\"%s\"}", XdrvMailbox.command, value ? "ON" : "OFF"); }
void ResponseCmndError(void) { ResponseCmndChar("Error"); }
void ResponseCmndDone(void) { ResponseCmndChar("Done"); }
void ResponseCmndChar(const char *value) { Response_P("{\"%s\":\"%s\"}", XdrvMailbox.command, value); }
void ResponseCmndNumber(int value) { Response_P("{\"%s\":%d}", XdrvMailbox.command, value); }
int ResponseLength(void) { return strlen(response); }
const char *CoreResponse(void) { return response; }

/* tasmota_support/support_command.ino: the response goes to the rules, and not to MQTT */
bool XdrvRulesProcess(bool teleperiod) {
  (void)teleperiod;
  js_rules("", response);
  return true;
}

void MqttPublishPrefixTopicRulesProcess_P(uint32_t prefix, const char *subtopic) {
  (void)prefix;
  js_rules(subtopic, response);
}

static const char HEX[] = "0123456789ABCDEF";

/*
 * tasmota_support/support_esp32.ino, over nvs_get_blob: a blob shorter than the
 * buffer fills its start and leaves the rest, and one longer loads nothing.
 * Nothing stored answers false, as a namespace never written does on the device.
 */
bool NvmLoad(const char *sNvsName, const char *sName, void *pSettings, unsigned nSettingsLen) {
  char *hex = js_nvm_load(sNvsName, sName);
  if (!hex) return false;
  size_t stored = strlen(hex) / 2;
  bool ok = (strlen(hex) % 2 == 0) && stored <= nSettingsLen;
  for (unsigned i = 0; ok && i < stored; i++) {
    const char *hi = strchr(HEX, hex[2 * i]), *lo = strchr(HEX, hex[2 * i + 1]);
    if (!hi || !lo) { ok = false; break; }
    ((uint8_t *)pSettings)[i] = (uint8_t)(((hi - HEX) << 4) | (lo - HEX));
  }
  free(hex);
  return ok;
}

void NvmSave(const char *sNvsName, const char *sName, const void *pSettings, unsigned nSettingsLen) {
  char hex[2 * 128 + 1];
  unsigned n = nSettingsLen > 128 ? 128 : nSettingsLen;
  for (unsigned i = 0; i < n; i++) {
    hex[2 * i] = HEX[((const uint8_t *)pSettings)[i] >> 4];
    hex[2 * i + 1] = HEX[((const uint8_t *)pSettings)[i] & 0x0F];
  }
  hex[2 * n] = 0;
  js_nvm_save(sNvsName, sName, hex);
}

/*
 * tasmota_support/support.ino: a list is its prefix, then "|" and the names. The
 * command whose name the topic is, prefix and case aside, is called with
 * XdrvMailbox.command set to the prefix and the name, as the list spells them.
 */
bool DecodeCommand(const char *haystack, void (* const MyCommand[])(void), const uint8_t *synonyms) {
  (void)synonyms;
  const char *bar = strchr(haystack, '|');
  size_t prefix = bar ? (size_t)(bar - haystack) : 0;
  if (!bar || strncasecmp(haystack, XdrvMailbox.topic, prefix) != 0) return false;
  const char *topic = XdrvMailbox.topic + prefix;
  const char *p = bar + 1;
  for (int code = 0; *p; code++) {
    const char *end = strchr(p, '|');
    size_t len = end ? (size_t)(end - p) : strlen(p);
    if (len == strlen(topic) && strncasecmp(p, topic, len) == 0 && prefix + len < sizeof(command_name)) {
      memcpy(command_name, haystack, prefix);
      memcpy(command_name + prefix, p, len);
      command_name[prefix + len] = 0;
      XdrvMailbox.command = command_name;
      XdrvMailbox.command_code = code;
      MyCommand[code]();
      return true;
    }
    if (!end) break;
    p = end + 1;
  }
  return false;
}

#include "xdrv_97_button_decouple.ino"

/* --- what the page calls ---------------------------------------------------------------- */

extern "C" {

/* FUNC_PRE_INIT: the driver reads its settings back */
EMSCRIPTEN_KEEPALIVE void bh_btn_init(uint32_t devices) {
  TasmotaGlobal.devices_present = devices;
  Xdrv97(FUNC_PRE_INIT);
}

/* One button scan, as support_button.ino makes it: 1 when the driver took the button */
EMSCRIPTEN_KEEPALIVE int bh_btn_scan(uint32_t index, int pressed) {
  XdrvMailbox.index = index;
  XdrvMailbox.payload = pressed ? PRESSED : NOT_PRESSED;
  return Xdrv97(FUNC_BUTTON_PRESSED) ? 1 : 0;
}

/*
 * A command, split as Tasmota's command handler splits one: the name without
 * its index, the index (usridx when one was typed), the payload as a number
 * (-99 for none, as Tasmota does) and as text. The response, or NULL when the
 * command is not the driver's.
 */
EMSCRIPTEN_KEEPALIVE const char *bh_btn_command(const char *name, uint32_t index, int usridx, int32_t payload, const char *data) {
  static char topic[64];
  static char text[128];
  snprintf(topic, sizeof(topic), "%s", name);
  snprintf(text, sizeof(text), "%s", data);
  XdrvMailbox.topic = topic;
  XdrvMailbox.data = text;
  XdrvMailbox.data_len = strlen(text);
  XdrvMailbox.index = index;
  XdrvMailbox.usridx = usridx != 0;
  XdrvMailbox.payload = payload;
  response[0] = 0;
  return Xdrv97(FUNC_COMMAND) ? response : NULL;
}

}
