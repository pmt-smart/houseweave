/*
 * The part of Tasmota's core that the button driver calls, and nothing more.
 *
 * The driver itself is not copied: xdrv_97.cpp includes the firmware's own
 * file (firmware/tasmota/tasmota/tasmota_xdrv_driver/xdrv_97_button_decouple.ino)
 * and this header gives it the names it expects. The constants and signatures
 * are Tasmota's, from the files named beside each; what they DO is the
 * simulator's (tasmota_core.cpp), which hands every effect to the page: the
 * relay, the beep, the log, the rules.
 */
#pragma once
#include <stdint.h>
#include <stdio.h>
#include <stdarg.h>
#include <string.h>
#include <strings.h>

#define ESP32 1
#define USE_BUTTON_DECOUPLE 1
#define USE_BUZZER 1

/* the Arduino and ESP8266 idioms the driver is written in */
#define PROGMEM
#define PSTR(s) (s)
#define snprintf_P snprintf
#define bitRead(value, bit) (((value) >> (bit)) & 0x01)
#define bitSet(value, bit) ((value) |= (1UL << (bit)))
#define bitClear(value, bit) ((value) &= ~(1UL << (bit)))
#define bitWrite(value, bit, bitvalue) ((bitvalue) ? bitSet(value, bit) : bitClear(value, bit))

/* tasmota/include/tasmota.h */
enum LoggingLevels { LOG_LEVEL_NONE, LOG_LEVEL_ERROR, LOG_LEVEL_INFO, LOG_LEVEL_DEBUG, LOG_LEVEL_DEBUG_MORE };
enum TopicOptions { CMND, STAT, TELE, nu1, RESULT_OR_CMND, RESULT_OR_STAT, RESULT_OR_TELE };
enum ButtonStates { PRESSED, NOT_PRESSED };
enum ExecuteCommandPowerOptions { POWER_OFF, POWER_ON, POWER_TOGGLE, POWER_BLINK, POWER_BLINK_STOP, POWER_OFF_FORCE };
enum CommandSource { SRC_IGNORE, SRC_MQTT, SRC_RESTART, SRC_BUTTON, SRC_RULE };
/* the calls the drivers answer; the numbers are this file's own */
enum XdrvFunctions { FUNC_PRE_INIT = 1, FUNC_INIT, FUNC_LOOP, FUNC_EVERY_100_MSECOND, FUNC_EVERY_250_MSECOND,
                     FUNC_EVERY_SECOND, FUNC_BUTTON_PRESSED, FUNC_COMMAND };

/* tasmota/include/i18n.h */
#define D_JSON_BUTTON "Button"
static const char S_JSON_SVALUE_ACTION_SVALUE[] = "{\"%s\":{\"Action\":\"%s\"}}";

/* tasmota/tasmota.ino */
struct XDRVMAILBOX {
  bool          grpflg;
  bool          usridx;
  uint16_t      command_code;
  uint32_t      index;
  uint32_t      data_len;
  int32_t       payload;
  char         *topic;
  char         *data;
  char         *command;
};
extern XDRVMAILBOX XdrvMailbox;

struct TASMOTA_GLOBAL {
  uint32_t      devices_present;
  struct { uint32_t wifi_down : 1; } global_state;
  char          hostname[33];
};
extern TASMOTA_GLOBAL TasmotaGlobal;

/* tasmota_support/*.ino, tasmota_xdrv_driver/xdrv_02_9_mqtt.ino, xdrv_24_buzzer.ino */
uint32_t millis(void);
void ExecuteCommandPower(uint32_t device, uint32_t state, uint32_t source);
void BuzzerBeep(uint32_t count);
void AddLog(uint32_t loglevel, const char *formatP, ...);
int Response_P(const char *format, ...);
int ResponseAppend_P(const char *format, ...);
void ResponseCmndError(void);
void ResponseCmndDone(void);
void ResponseCmndChar(const char *value);
#define ResponseCmndChar_P ResponseCmndChar
void ResponseCmndNumber(int value);
int ResponseLength(void);
/* the response being built, for what hands it on: the rules, the page */
const char *CoreResponse(void);
bool XdrvRulesProcess(bool teleperiod);
void ResponseCmndIdxNumber(int value);
void ResponseCmndStateText(uint32_t value);
void MqttPublishPrefixTopicRulesProcess_P(uint32_t prefix, const char *subtopic);
bool NvmLoad(const char *sNvsName, const char *sName, void *pSettings, unsigned nSettingsLen);
void NvmSave(const char *sNvsName, const char *sName, const void *pSettings, unsigned nSettingsLen);
bool DecodeCommand(const char *haystack, void (* const MyCommand[])(void), const uint8_t *synonyms = nullptr);
