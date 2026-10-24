// Stand-in for Arduino.h: what the fork's JsonParser and the OTA sender take of it, on a host.
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>
#include <string>

class __FlashStringHelper;
#ifndef F
#define F(s) ((const __FlashStringHelper *)(s))
#endif
#ifndef PROGMEM
#define PROGMEM
#endif
#ifndef PSTR
#define PSTR(s) s
#endif
#define pgm_read_byte(p) (*(const uint8_t *)(p))
#ifndef strcmp_P
#define strcmp_P strcmp
#endif
#define strcasecmp_P strcasecmp
#define strncmp_P strncmp

class String : public std::string {
 public:
  String() {}
  String(const char *s) : std::string(s ? s : "") {}
  String(const __FlashStringHelper *s) : std::string(s ? (const char *)s : "") {}
  String(const std::string &s) : std::string(s) {}
  void toLowerCase(void) { for (auto &c : *this) { c = (char)tolower((unsigned char)c); } }
  bool startsWith(const String &p) const { return compare(0, p.size(), p) == 0; }
};
