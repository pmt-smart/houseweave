/*
  user_config_override.h — HouseWeave

  Tasmota's official override mechanism, on Tasmota's own ESP32 base
  (tasmota32_base), with the panel's own feature set: what the panel needs is
  turned on here, and what Tasmota compiles by default and the panel does not use
  is turned off. The env extends tasmota32_base rather than an official image
  such as tasmota32-zbbrdgpro, whose FIRMWARE_ZBBRDGPRO block would override this file.
*/

#ifndef _USER_CONFIG_OVERRIDE_H_
#define _USER_CONFIG_OVERRIDE_H_

// The public keys whose signature an image needs, in the app (the safeboot image it installs) and in our safeboot (the
// app's image it takes): the house's, made by `node scripts/ota-release.mjs key`, whose secret half is outside the
// repository (scripts/ota-release.mjs says where) and signs every release. A new key comes as a second one here, in a release the
// old key signs, before the old one goes
#define ESPNOW_OTA_PUBLIC_KEYS "\x9a\x96\x8a\x15\x60\xa9\xce\x06\x58\x81\xe9\x4b\x80\xec\x58\x93\xa0\x21\x28\xff\xfc\xe8\x4e\xae\xda\xdb\x2d\x10\x40\x58\xfd\x5f"

// --- Our safeboot ---
// The bootloader runs the safeboot to write the app. Ours is Tasmota's own safeboot (FIRMWARE_SAFEBOOT, its env in
// platformio_tasmota_env32.ini), built by tasmota32-houseweave-safeboot with HOUSEWEAVE_SAFEBOOT: this file reaches every env
// (USE_CONFIG_OVERRIDE), and none of the app's features below may go into it. What it adds is its own, here.
#ifdef HOUSEWEAVE_SAFEBOOT

#define SAFEBOOT_WITHOUT_ETHERNET                   // no device of ours has Ethernet
#define SAFEBOOT_WITHOUT_TLS                        // the house's server is plain HTTP on the LAN, and every image is signed

#define USE_ESPNOW_OTA_RECEIVER                     // takes the app's image from a neighbour over ESP-NOW (xdrv_98_5)
#define USE_ESPNOW_OTA_DISPLAY                      // and shows it on the panel's page "safeboot" (xdrv_98_6), on a device
                                                    // whose template is the NSPanel's

#else  // HOUSEWEAVE_SAFEBOOT, the app's features from here to the end

#undef  FRIENDLY_NAME
#define FRIENDLY_NAME        "NSPanel"             // [FriendlyName] renamed per room after the flash (Configuration > Configure Other)

// --- A factory image that boots as a panel ---
// A serial flash of the factory image starts Tasmota's configuration over, and
// the NSPanel's template is what powers the screen (GPIO4): without it the glass
// stayed dark until someone applied the template by hand. The template is the
// same on the EU and the US, so it goes in the firmware of the
// panels' envs (HOUSEWEAVE_PANEL_IMAGE, set in their build flags), as Tasmota's own
// USER_TEMPLATE: taken on a fresh configuration only, with its commands (the
// thermistor's ADCParam1, Sleep 0 and BuzzerPWM 1), and never over what a panel
// already has. The base env keeps Tasmota's default module; the bridge, another
// board, has an env and a template of its own (HOUSEWEAVE_BRIDGE_IMAGE, below).
#ifdef HOUSEWEAVE_PANEL_IMAGE
#undef  USER_TEMPLATE
#define USER_TEMPLATE "{\"NAME\":\"NSPanel\",\"GPIO\":[0,0,0,0,3872,0,0,0,0,0,32,0,0,0,0,225,0,480,224,1,0,0,0,33,0,0,0,0,0,0,0,0,0,0,4736,0],\"FLAG\":0,\"BASE\":1,\"CMND\":\"ADCParam1 2,11200,10000,3950 | Sleep 0 | BuzzerPWM 1\"}"
#undef  MODULE
#define MODULE               USER_MODULE           // [Module] the template above
#endif  // HOUSEWEAVE_PANEL_IMAGE

// --- A factory image that boots as a bridge ---
// The ZBBridge Pro's env (HOUSEWEAVE_BRIDGE_IMAGE): its template, as the panels' is
// theirs, so a serial flash or a reset of the configuration never leaves the
// bridge without the Zigbee chip's pins. Its commands give the
// button to the pairing: SetOption1 1 takes the reset and the
// Wi-Fi Manager off its multi-press and its 40 s hold; SetOption32 50 makes a
// hold 5 s; ButtonTopic 0 sends the hold to the rules, {"Button1":{"State":3}},
// with no relay to toggle (support_button_v4.ino, SendKey). SetOption127 1 keeps
// the Wi-Fi radio out of modem sleep: a radio asleep between the beacons misses
// ESP-NOW frames, the broadcasts that nobody sends again first, and a device on
// mains loses nothing by staying awake. Sleep 0 keeps the main loop from
// sleeping up to 50 ms a turn: the mesh's events reach Berry and the rules from
// the loop, which nothing wakes early, as on the panels.
// The way back to a phone is the rescue below, three short boots.
#ifdef HOUSEWEAVE_BRIDGE_IMAGE
#undef  FRIENDLY_NAME
#define FRIENDLY_NAME        "ZBBridge"            // [FriendlyName]
#undef  USER_TEMPLATE
#define USER_TEMPLATE "{\"NAME\":\"Sonoff Zigbee Pro\",\"GPIO\":[0,0,576,0,480,0,0,0,0,1,1,5792,0,0,0,3552,0,320,5793,3584,0,640,608,32,0,0,0,0,0,1,0,0,0,0,0,0],\"FLAG\":0,\"BASE\":1,\"CMND\":\"SetOption1 1 | SetOption32 50 | ButtonTopic 0 | SetOption127 1 | Sleep 0\"}"
#undef  MODULE
#define MODULE               USER_MODULE           // [Module] the template above
#endif  // HOUSEWEAVE_BRIDGE_IMAGE

// Brasília's time, UTC-3 with no summer time since 2019: Tasmota's default is +1
#undef  APP_TIMEZONE
#define APP_TIMEZONE         -3                    // [Timezone]

// No access point scan every 44 minutes: it sweeps the 13 channels and leaves
// ESP-NOW deaf for a second or two, and a panel or a bridge does not move about
// the house. Taken on a fresh configuration; a configured device takes
// SetOption57 0 by its console
#undef  WIFI_SCAN_REGULARLY
#define WIFI_SCAN_REGULARLY  false                 // [SetOption57]

// --- Our own feature set, on Tasmota's ESP32 base ---
// The env extends tasmota32_base rather than the official tasmota32-zbbrdgpro
// image, whose FIRMWARE_ZBBRDGPRO block in
// tasmota/include/tasmota_configurations_ESP32.h comes after this file and
// redefined what an #undef here could not reach. What that block gave the panel
// is set here instead: the image name, Zigbee (ZNP is the default protocol), and
// the defaults it turned off. MODULE stays WEMOS, the ESP32 default, and Tasmota
// Discovery for Home Assistant is on by default.
#define CODE_IMAGE_STR "houseweave"
// Zigbee2Tasmota only where a coordinator is: the bridge's image. A panel's
// Zigbee is its bridge's, reached over ESP-NOW, and no panel has a chip of its
// own: the panels' images leave Z2T and the zigbee
// module of Berry out, a cut of its own.
#ifndef HOUSEWEAVE_PANEL_IMAGE
#define USE_ZIGBEE
#endif
#undef USE_DOMOTICZ
#undef USE_ENERGY_SENSOR
#undef USE_SHUTTER
#undef USE_IR_REMOTE
#undef USE_ARILUX_RF                               // it would turn USE_LIGHT back on
// What leaves with the block: I2C, since a panel has no I2C device and on ESP32
// Zigbee keeps its data in the file system, and the Wi-Fi scan page with BSSIDs.
// Ethernet, InfluxDB and the serial-to-TCP bridge are off by default on this
// base. Without Ethernet in the build, the firmware turns the Wi-Fi on at every
// boot (the submodule's fix/wifi-at-boot-without-ethernet).
#undef USE_I2C
#undef USE_ENHANCED_GUI_WIFI_SCAN

// --- No TLS ---
// The whole BearSSL client (USE_TLS) comes in with USE_WEBCLIENT_HTTPS, on by
// default on the ESP32 in my_user_config.h: https in Berry's webclient,
// UrlFetch, WebQuery and WebGetConfig, and the app downloading its own safeboot
// (`Upgrade 2`). USE_AUTOCONF turns it and MQTT's TLS back on at the end of
// my_user_config.h, after this file, because it fetches its templates over
// https, so it goes too; a panel must never run an autoconf anyway.
// USE_ZBBRIDGE_TLS, on by default in the Zigbee block, becomes MQTT's TLS
// only inside FIRMWARE_ZBBRIDGE in tasmota/include/tasmota_configurations.h, the
// Sonoff ZBBridge's own image and its MQTT to AWS IoT: here it changes nothing,
// and its #undef stays as a guard. The panel speaks plain MQTT on its LAN, http keeps working everywhere,
// and what an `Upgrade 1` installs is downloaded by the safeboot, which has TLS
// of its own. The SHA-256 of Berry's crypto module is BearSSL's
// hash and stays. No heap while no TLS session runs.
#undef USE_ZBBRIDGE_TLS
#undef USE_WEBCLIENT_HTTPS
#undef USE_AUTOCONF

// --- What a panel never uses ---
// Drivers and tools for hardware or services a panel does not have. None is
// referenced by the brain (berry/), by our drivers or by the Zigbee stack; a
// preprocessor listing of the build shows these macros, and only these, go.
// Kept on purpose: USE_ADC (the panel's own thermistor, GPIO38 in its
// template), USE_BUZZER (the pages ring it) and USE_ESP32_SENSORS (the chip
// temperature).
//
// The ESP32's own light stack: PWM and LED drivers, addressable strips and the
// dimmers built on them. The relays are Power, not light, and Zigbee's colour
// conversions live in xdrv_04_light_utils.ino, which compiles without USE_LIGHT.
#undef USE_LIGHT
#undef USE_WS2812
#undef USE_MY92X1
#undef USE_SM16716
#undef USE_SM2135
#undef USE_SM2335
#undef USE_BP1658CJ
#undef USE_BP5758D
#undef USE_ELECTRIQ_MOODL
#undef USE_LIGHT_PALETTE
#undef USE_LIGHT_VIRTUAL_CT
#undef USE_DGR_LIGHT_SEQUENCE
#undef USE_NETWORK_LIGHT_SCHEMES
#undef USE_PWM_DIMMER
#undef USE_PWM_DIMMER_REMOTE
#undef USE_AC_ZERO_CROSS_DIMMER
// Sensors the panel does not have, and pulse counters
#undef USE_DS18x20
#undef USE_DHT
#undef USE_COUNTER
// Other devices' serial protocols, and deep sleep
#undef USE_TUYA_MCU
#undef USE_SERIAL_BRIDGE
#undef USE_DEEPSLEEP
// Device Groups (the brain's old `wifi` transport, retired) and Alexa emulation
#undef USE_DEVICE_GROUPS
#undef USE_DEVICE_GROUPS_SEND
#undef USE_EMULATION
#undef USE_EMULATION_HUE
#undef USE_EMULATION_WEMO
// Web UI tools and serial provisioning
#undef USE_GPIO_VIEWER
#undef USE_IMPROV
// No SD card: neither a panel nor a bridge has a slot. USE_SDCARD is one of the mandatory
// defines of tasmota/include/tasmota_configurations.h, after this file, which an #undef here does not reach: the
// fork's feature/no-use-sdcard lets NO_USE_SDCARD keep it off. The SD and SD_MMC libraries and the SDMMC and SDSPI
// drivers leave with it
#define NO_USE_SDCARD
// No FAT fallback for the flash file system: it is tried only when LittleFS does not mount,
// which formats its partition when it has to, and none of our partition tables has a FAT partition to fall back to.
// The fork's feature/no-use-ffat lets NO_USE_FFAT leave FatFs and wear levelling out
#define NO_USE_FFAT
// Tasmota's own Berry apps (the extension store is https, gone with TLS) and the
// crypto classes the brain does not use: it uses crypto.SHA256 only, and the
// ESP-NOW driver's HMAC is mbedtls's
#undef USE_EXTENSION_MANAGER
#undef USE_BERRY_PYTHON_COMPAT
#undef USE_BERRY_CRYPTO_AES_GCM
#undef USE_BERRY_CRYPTO_HMAC_SHA256
// No Berry TCP server: nothing listens on a socket since the tcp transport went,
// and the server's code does not build without IPv6,
// which the env leaves out
#undef USE_BERRY_TCPSERVER

// --- The lamp's felt latency ---
// Tasmota holds the Zigbee attributes it receives for this long before it
// publishes the `ZbReceived`, to put several in one message, and every new
// report RESTARTS the timer.
//
// Measured live: the test lamp answers a command in ~105 ms and sends a
// second report 171 ms later; with 350 ms the `ZbReceived` only came out
// ~650 ms after the command. The slowness put on the lamp (~890 ms) was
// mostly THIS timer, not the lamp.
//
// 100 ms still joins attributes that arrive in the same burst (a colour change
// sends Hue/Sat/X/Y/CT together), and publishes the state almost at once. The
// cost is that the lamp's duplicate reports become two messages instead of
// one: harmless, `light.be` ignores a repeated value.
#undef USE_ZIGBEE_COALESCE_ATTR_TIMER
#define USE_ZIGBEE_COALESCE_ATTR_TIMER 100

// --- The `direct` ESP-NOW link ---
// A self-contained driver in tasmota_xdrv_driver/xdrv_98_espnow_direct.ino,
// with no edit to a shared file of the submodule. Commenting this line out
// turns the whole feature off with nothing else to revert.
//
// Even compiled in, ESP-NOW **is born off** and only comes up with
// `EspNowEnable 1` on the console: a driver that cannot be turned off once
// took a whole transport down with it.
#define USE_ESPNOW_DIRECT

// The ESP-NOW mesh between the rooms, in every image: the house's list, its key,
// the state of its devices and the room's own traffic. Born off, like the direct link: EspNowMeshEnable 1
// starts it, which a panel's founding of its house or a welcome gives.
#define USE_ESPNOW_MESH
// The house's OTA over the mesh: the neighbours in their safeboot image heard, an image sent to one, and the
// way into this device's own safeboot image to take one (xdrv_98_7)
#define USE_ESPNOW_OTA

// The panel takes events from its bridge and runs no command that arrives over
// ESP-NOW: a command frame, however well
// signed, is dropped and logged. The base env runs the commands its peer sends.
#ifdef HOUSEWEAVE_PANEL_IMAGE
#define USE_ESPNOW_DIRECT_EVENTS_ONLY
#endif
// The bridge runs no command that arrives over ESP-NOW either: its driver hands
// each to the rules, and the relay runs the ones the panel sends, with the closed
// list of the tcp connection (berry/zbbridge_relay.be).
#ifdef HOUSEWEAVE_BRIDGE_IMAGE
#define USE_ESPNOW_DIRECT_COMMANDS_TO_RULES
// The bridge is sent whole zones in a burst, a line per device, and the driver's queue of 4 frames dropped the
// oldest of a burst of 5: 16 items of 243 bytes are 3.9 KB of the bridge's heap, which has no screen to feed. The panel keeps the
// default of 4, and its heap is the tightest there is.
#define ESPNOW_DIRECT_RX_QUEUE_DEPTH 16
#endif

// The pairing over ESP-NOW itself: the bridge opens
// a window with its button and announces itself, the panel scans and pairs with
// an X25519 exchange, and each side saves the key it derived, with no secret on
// the air. Both images take part, and the WiFi station driver below pauses the
// WiFi for it. BearSSL's X25519 (lib_ssl) comes in with it, the one the Berry
// crypto class EC_C25519 uses.
#define USE_ESPNOW_DIRECT_PAIRING

// Button driver: takes over every button that has a relay of
// the same number. The tap toggles the relay by default and can be decoupled
// per button (`ButtonDecouple<x> 1`: the tap becomes an event for Berry); a
// 4 s hold always toggles the relay, with a 15 s guard between two toggles.
// No multi-press switching another relay, no reset and no WiFi manager from
// the button. Self-contained in tasmota_xdrv_driver/xdrv_97_button_decouple.ino.
//
// Like the ESP-NOW driver it starts disabled: it takes the buttons only after
// `ButtonDecoupleEnable 1` (the brain sends it at boot with a generated
// project), and stays enabled across restarts, because the hold has to work
// with Berry down.
#define USE_BUTTON_DECOUPLE

// WiFi station driver: the glass scans, joins and forgets a network
// without a restart, while Tasmota's own WiFi is off, and holds the radio in
// station mode with no network for ESP-NOW. Self-contained in
// tasmota_xdrv_driver/xdrv_96_wifi_station.ino, and idle until a command asks.
#define USE_WIFI_STATION_CONTROL

// The rescue by the reset button: three short boots in a row, each
// ending within 10 s, open Tasmota's WiFi Manager for its 3 minutes, for a panel
// with no network, a forgotten pattern or a dead screen. The panel's button
// driver takes the buttons, and SetOption65 turns Tasmota's power cycle erase
// off, so this is the way back. Self-contained in
// tasmota_xdrv_driver/xdrv_95_boot_rescue.ino. The bridge's image has it too:
// its button is the pairing's (SetOption1 1, above), and a
// bridge with no network saved opens no access point, so three
// short boots are its way to a phone as well.
#if defined(HOUSEWEAVE_PANEL_IMAGE) || defined(HOUSEWEAVE_BRIDGE_IMAGE)
#define USE_BOOT_RESCUE
#endif

// The clock's time kept across a restart that is not a power cycle:
// an OTA, Restart 1, a crash or a watchdog does not lose a
// time set by hand on a device with no network. The RTC slow memory and the RTC
// counter survive those resets; a power cycle still loses the time. On both
// images, as the bridge gives its time to the panel over the link.
// Self-contained in tasmota_xdrv_driver/xdrv_99_rtc_retain.ino.
#if defined(HOUSEWEAVE_PANEL_IMAGE) || defined(HOUSEWEAVE_BRIDGE_IMAGE)
#define USE_RTC_RETAIN
#endif

// The WiFi Manager's Reset configuration asks for the web password on a device
// that has one. Tasmota serves it
// open in the WiFi Manager, which the rescue opens: three restarts of a bridge
// and a phone in range were enough to erase its configuration, and with it the
// Zigbee channel its coordinator is formatted back to. The WiFi
// page stays open. A patch in tasmota_xdrv_driver/xdrv_01_9_webserver.ino.
#define USE_WIFI_MANAGER_RESET_AUTH

// SetOption65 1: without it, 7 quick power cycles wipe the whole Tasmota
// configuration (tasmota_support/settings.ino); someone at the breaker is
// enough. This covers a fresh configuration; on a configured panel the brain
// sends `SetOption65 1` at boot.
#undef APP_DISABLE_POWERCYCLE
#define APP_DISABLE_POWERCYCLE true

// --- A panel updated over the air only ---
// Once the Zigbee chip is soldered onto the serial pins, the network is the only
// way into a panel, and these two keep it open.
//
// The loop watchdog: without it, a loop() that never returns (a Berry hang at
// boot) is never turned into a restart, and the panel sits with no web server
// and no OTA for good. With it, the hang restarts the panel, and the fourth
// quick restart comes up without Berry (Tasmota's boot-loop steps), reachable.
// Anything that runs longer than its 5 s must feed it: delay() and yield() do,
// and PanelBoot (berry/panel_boot.be) yields between the pieces it starts.
#define USE_ESP32_WDT
//
// No upgrade URL: the inherited one is the official zbbrdgpro image, which an
// Upgrade by URL would install over this one, dropping the button and ESP-NOW
// drivers. Empty does not make `Upgrade 1` harmless: the app still restarts
// into its safeboot, which finds nothing to download and waits there for a file
// upload. A panel is updated by uploading its own .bin.
#undef OTA_URL
#define OTA_URL ""

// What each feature still compiled in costs, and how it would go, is measured
// on the ELF; each cut is decided one at a time, and measured by a build.

#endif  // HOUSEWEAVE_SAFEBOOT

#endif  // _USER_CONFIG_OVERRIDE_H_
