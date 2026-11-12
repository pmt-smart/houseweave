// Host test of the Sonoff WTS01 decoding of xdrv_08_serial_bridge.ino: the driver compiled on a host over stand-ins (host_stubs.h), its
// functions called as Tasmota calls them, and its temperature read where every reader of a sensor reads it, the JSON and the web page.
// Run it with run.mjs (see README.md): it compiles this file with the emscripten SDK and runs the result with node.
#include "host_stubs.h"
// the prototypes the Arduino build writes for a .ino, of the functions the driver names before it defines them
void CmndSSerialSend(void);
void CmndSBaudrate(void);
void CmndSSerialBuffer(void);
void CmndSSerialConfig(void);
void CmndSSerialMode(void);
bool SerialBridgeGetLog(void);
#include "xdrv_08_serial_bridge.ino"

static int g_failures = 0;
static int g_checks = 0;
#define CHECK(cond, what) do { g_checks++; if (!(cond)) { g_failures++; printf("FAIL %s  (line %d)\n", what, __LINE__); } } while (0)

// The datagram the driver's own notes show, 22.18 °C, and one below zero, -1.06 °C. Their last byte is the sum of the first eight; the
// driver does not read it
static const uint8_t WARM[9] = {0x55, 0x01, 0x01, 0x04, 0x01, 0x11, 0x16, 0x12, 0x95};
static const uint8_t COLD[9] = {0x55, 0x01, 0x01, 0x04, 0x01, 0x11, 0x81, 0x06, 0xF4};
static const uint8_t ALIEN[9] = {0x56, 0x01, 0x01, 0x04, 0x01, 0x11, 0x16, 0x12, 0x96};

// what a datagram's bytes do: read in one turn of the loop, and taken as a message once the polling window is over
static void feed(const uint8_t* bytes, size_t n) {
  for (size_t i = 0; i < n; i++) { g_rx.push_back(bytes[i]); }
  Xdrv08(FUNC_LOOP);
  g_millis += SERIAL_POLLING + 1;
  Xdrv08(FUNC_LOOP);
}

// the sensor's part of the JSON a teleperiod, a rule or Berry's read_sensors() gets
static std::string json(void) {
  g_response.clear();
  Xdrv08(FUNC_JSON_APPEND);
  return g_response;
}

// the sensor's line of the web page
static std::string web(void) {
  g_web.clear();
  Xdrv08(FUNC_WEB_SENSOR);
  return g_web.empty() ? "" : g_web[0];
}

// SSerialMode, as the console runs it
static void mode(int32_t value) {
  XdrvMailbox.payload = value;
  XdrvMailbox.data_len = 1;
  CmndSSerialMode();
}

static void test_boot(void) {
  printf("-- a device that boots with the WTS01's mode saved\n");
  memset(&g_settings, 0, sizeof(g_settings));
  g_settings.sserial_mode = SB_WTS01;
  g_settings.sbaudrate = 9600 / 300;
  g_settings.sserial_config = TS_SERIAL_8N1;
  g_settings.flag2.temperature_resolution = 1;
  g_millis = 100000;
  Xdrv08(FUNC_PRE_INIT);
  CHECK(serial_bridge_buffer != nullptr, "the bridge has its port");
  CHECK(9600 == g_baud, "at 9600 bps");
  CHECK(json().empty(), "no temperature before the first datagram: not 0 °C");
  CHECK(web().empty(), "and none on the web page");
  g_millis += 30000;
  Xdrv08(FUNC_LOOP);
  CHECK(json().empty(), "nor 30 s later with the sensor silent");
}

static void test_reading(void) {
  printf("-- a datagram, and the silence after it\n");
  feed(WARM, sizeof(WARM));
  CHECK(json() == ",\"WTS01\":{\"Temperature\":22.2}", "a datagram is a temperature, to TempRes decimals");
  CHECK(web() == "WTS01 22.18", "and the web page's");
  g_millis += SERIAL_BRIDGE_WTS01_TIMEOUT * 1000 - 1;
  CHECK(!json().empty(), "it holds until the timeout");
  g_millis += 1;
  CHECK(json().empty(), "and goes once none came for the timeout: an unplugged sensor is no reading");
  CHECK(web().empty(), "from the web page too");
  feed(COLD, sizeof(COLD));
  CHECK(json() == ",\"WTS01\":{\"Temperature\":-1.1}", "the next datagram brings it back, below zero as well");
}

static void test_not_a_datagram(void) {
  printf("-- what is not a WTS01 datagram\n");
  g_millis += SERIAL_BRIDGE_WTS01_TIMEOUT * 1000;
  CHECK(json().empty(), "the reading went");
  feed(ALIEN, sizeof(ALIEN));
  CHECK(json().empty(), "nine bytes with another header are no reading");
  feed(WARM, 8);
  CHECK(json().empty(), "nor eight bytes of one");
  feed(WARM, sizeof(WARM));
  CHECK(json() == ",\"WTS01\":{\"Temperature\":22.2}", "and a whole one after them is");
}

static void test_mode_set(void) {
  printf("-- the mode set again\n");
  mode(SB_WTS01);
  CHECK(32 == g_settings.sbaudrate, "SSerialMode 3 sets 9600 bps");
  CHECK(json().empty(), "and forgets the temperature it had: it belongs to no sensor yet");
  feed(WARM, sizeof(WARM));
  CHECK(!json().empty(), "until a datagram comes");
  mode(SB_NONE);
  CHECK(json().empty(), "another mode reports no WTS01");
  mode(SB_WTS01);
}

static void test_millis_wrap(void) {
  printf("-- millis() going round\n");
  g_millis = 0xFFFFFFFFu - 50;
  feed(WARM, sizeof(WARM));
  CHECK(g_millis < 1000, "the datagram is taken past the wrap");
  CHECK(!json().empty(), "and read");
  g_millis += 4000;
  CHECK(!json().empty(), "it holds across the wrap");
  g_millis += 1100;
  CHECK(json().empty(), "and goes on time");
}

int main(void) {
  test_boot();
  test_reading();
  test_not_a_datagram();
  test_mode_set();
  test_millis_wrap();
  printf(g_failures ? "\nFAILED %d of %d checks\n" : "\nall %d checks passed\n", g_failures ? g_failures : g_checks, g_checks);
  return g_failures ? 1 : 0;
}
