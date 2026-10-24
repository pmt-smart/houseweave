# 03 — Architecture

Two images, one way of working: **every node runs Tasmota**, built from our fork, with **a brain in Berry compiled into the firmware**
([12 §1](12-berry-notes.md)). A **panel** (a Sonoff NSPanel) draws our pages on its Nextion screen and runs its room; a **bridge** (a Sonoff
ZBBridge Pro) is the Zigbee coordinator of its room's network. They talk over the ESP-NOW mesh ([04](04-the-mesh.md)), and together they are the
house ([05](05-the-house.md)). Nothing runs on a computer in a room, and nothing needs Home Assistant ([07](07-home-assistant.md)).

## 1. The constraints

- **The firmware is Tasmota.** No ESPHome, no firmware of our own: our C goes into the fork as drivers behind switches.
- **A panel works fully without Home Assistant**, and the house without its Wi-Fi.
- **One Zigbee coordinator per area, in that area's bridge.** No device moves between networks; what crosses rooms are messages between our nodes.
- **No computer in a room.**
- **Home Assistant is an optional observer**, never a dependency.

## 2. The panel's brain

`autoexec.be`, the only file of the brain that is still a file, says which generated project the panel runs (`PANEL_PROJECT`) and calls
`PanelBoot.start` (`berry/panel_boot.be`), which builds every piece in the order one needs another, each in its own `try`, checks the heap at the
boot's peaks, and gives up our pages below a floor of 60 KB, leaving the rest to the Wi-Fi, the web and the OTA.

**The screen.** `berry/nextion_driver.be` is the serial transport to the Nextion screen: framing, and flashing a `.tft` (which the file system keeps
compressed, `berry/tft_pack.be`). Our pages are a **generated project** ([10](10-simulator-and-tft.md)): a compiled `.tft` and, beside it, a file of
data, `<project>.jsonl`, that says which component on which page carries each binding, what each touch means, the theme's colours, glyphs and font
advances. `berry/panel_runtime.be` reads it, the same code for every project: the first line at boot, a page's line when the page comes up, a
table's line when a page asks for it, so the heap holds the project's tables and one page's, however many pages there are. The indexes are checked
at boot, and a file changed after it was generated is refused whole. The brain writes bindings to the page and reads touches back as
`ev,<page>,<objname>,<gesture>` frames. A panel whose screen does not match its tables flashes the image's own `.tft` by itself (three tries).
With no generated project, the brain still speaks joBr99's screen vocabulary (`berry/brain.be`, `berry/home.be`, `berry/light.be`), read from
its source ([reference/joBr99/ORIGIN.md](../reference/joBr99/ORIGIN.md)).

**The centre**, `berry/brain.be`, takes every touch to the views and does what they ask, counts the screensaver's time, draws a web password on
the first boot, and runs the house's schedule every second.

**The configuration and the views:**

| file | what it is |
|---|---|
| `berry/panel_store.be` | the panel's configuration: plans, zones, devices and their names, and every operation on them |
| `berry/panel_plan_view.be`, `berry/panel_draw.be`, `berry/panel_plan.be` | the plan of zone cards on the glass: drawn as Nextion drawing instructions, and its touches |
| `berry/panel_ui.be` | the screens beyond the plan: a zone's screen, the generic list and its views (settings, options, confirmations), the detail pages, Help, the pattern lock, the keyboard |
| providers of views | screens that plug into `PanelUi`: the clock (`panel_clock.be`), the schedule (`panel_schedule_view.be`, `panel_calendar_draw.be`), the alarm (`panel_alarm_view.be`, `panel_alarm_draw.be`, `panel_alarm_canvas.be`), the house (`panel_house_view.be`), a remote node's screens (`node_wireless.be`), the +'s (`panel_add_view.be`, `panel_remote_view.be`), a zone's Tap (`panel_tap_view.be`), a two-channel switch's driver (`panel_driver_view.be`) |
| device kinds | thermostats (`panel_thermostat.be`, `panel_thermostat_view.be`, `panel_thermostat_settings.be`), blinds (`panel_cover.be`, `panel_cover_view.be`), a lamp's settings (`panel_lamp_settings.be`), a page's row of buttons (`panel_page_buttons.be`) |
| `berry/panel_text.be` | what the keyboard types, read as places and sizes |
| `berry/panel_web.be` | the "Panel rooms" page of Tasmota's Web UI: rename zones and devices and change types in bulk |

**Commands.** A tap becomes a **command plan** (`berry/panel_plan_commands.be`): a Zigbee group command where the zone has a group, and the rest
device by device, paced so a burst does not swamp the bridge. Each line goes through `berry/panel_route.be` to the bridge that owns the device, over
the mesh ([05 §4](05-the-house.md)). `berry/panel_zigbee.be` is the Zigbee network as our pages see it: the reports, the interview of a pairing, the
devices the network has and the panel does not, and the drivers' normalised state. A device that did not show what a command asked within 2 s gets a
"?" and a ping. The panel's two **relays** and two **buttons** are its own: the buttons belong to the fork's button driver from the first boot, and a
button can be a relay's or the panel's (for zones).

**The panel's other parts**: the Wi-Fi of Wireless settings (`berry/panel_wifi.be`, over the fork's station driver: search and join, the hotspot,
the web setup), MQTT (`berry/panel_mqtt.be`), the schedule on MQTT for Home Assistant's calendars (`berry/panel_schedule_mqtt.be`), the names told
to the bridge for Home Assistant (`berry/panel_names.be`), the backup and the OTA (`berry/panel_backup.be`, `berry/node_backup.be`,
`berry/node_ota.be`, `berry/server_link.be`, `berry/panel_http.be`: one HTTP request at a time over Tasmota's non-blocking client), the build it
is (`berry/panel_build.be`), and one Tasmota rule for all its parts (`berry/panel_rules.be`).

## 3. The bridge's brain

`berry/zbbridge_autoexec.be` (named `autoexec.be` on the bridge) calls `ZbBridgeRelay.start()`:

- **The relay** (`berry/zbbridge_relay.be`): Zigbee2Tasmota is the coordinator of its network. The relay hands every Zigbee event the panels' pages
  read (`ZbReceived`, `ZbState`, `ZbResponse`, `ZbInfo`, `ZbPing`), filtered to the keys the panels use and merged to fit a mesh frame, and runs only
  its **closed list** of commands from the panels (a `ZbSend`, the alarm's words, the drivers' commands, ...). It also flashes the coordinator's own
  firmware when the chip reports another version.
- **The drivers' host** (`berry/zbbridge_drivers.be`): every report of a device goes to its driver, which returns a normalised state the panels show
  (one event, `ZbDriver`); a panel's command to a device goes to its driver. Drivers are classes of their own: thermostats
  (`berry/zbdriver_thermostat.be`: a ZCL thermostat and the Moes ZHT-SR, with its settings), blinds (`berry/zbdriver_cover.be`) and switches of two
  channels that open and close (`berry/zbdriver_twokey.be`).
- **Home Assistant's discovery** of the bridge's devices (`berry/zbbridge_discovery.be`, [07 §4](07-home-assistant.md)).
- **The alarm** (`berry/zbbridge_alarm.be`, with its replica, [05 §5](05-the-house.md)).
- **Entering the house**: the bridge's pairing window, opened by its button, and its LED (`berry/zbbridge_relay_pairing.be`).
- **The bridge's backup** (`berry/bridge_backup.be`), its clock link (`berry/clock_link.be`).

## 4. Both images

Both images carry the house's layer: the list, the key, the channel, the MQTT, the alarm's configuration, the state of devices across rooms, the
devices' pages, the commands (`berry/house_*.be`, `berry/mesh_cmd.be`, `berry/mesh_events.be`, `berry/mesh_beat.be`, `berry/mesh_http.be`), the
backup and the OTA (`berry/node_backup.be`, `berry/node_settings.be`, `berry/node_ota.be`, `berry/server_link.be`), and the house's console commands
for the bench (`berry/house_commands.be`). `berry/pair_sign.be` loads first in both: a password drawn to be typed, and the `persist` save that never
raises.

**The panel's Zigbee** is the house's bridges (`berry/zigbee_bridge.be`): the rest of the brain posts a command with `bridge.post(cmd)`, and the mode
is `mesh` (the house has a bridge) or `off` (a panel that works on its relays alone). A panel has no coordinator of its own.

## 5. The fork's C

Our drivers in the fork, each behind a switch the override sets:

| driver | switch | what it does |
|---|---|---|
| `xdrv_98_1_espnow_mesh.ino` and the core (`espnow_mesh_core.h`, `espnow_mesh_crypto.h`) | `USE_ESPNOW_MESH` | the mesh |
| `xdrv_98_3_espnow_mesh_station.ino` | (with the mesh) | the station that keeps to the house's channel |
| `xdrv_98_4_espnow_mesh_search.ino` | (with the mesh) | looking for the house on the other channels |
| `xdrv_98_2_espnow_mesh_probe.ino` | `USE_ESPNOW_MESH_PROBE` | the bench's probe of the channel (bench images only) |
| `xdrv_98_7_espnow_ota_sender.ino` | `USE_ESPNOW_OTA` | the app's OTA: hear the nodes in their safeboot, send an image, install the safeboot, arm |
| `xdrv_98_5_espnow_ota_receiver.ino`, `xdrv_98_6_espnow_ota_display.ino` | `USE_ESPNOW_OTA_RECEIVER`, `USE_ESPNOW_OTA_DISPLAY` | the safeboot's receiver and its page on the panel's screen |
| `xdrv_98_espnow_direct.ino` | `USE_ESPNOW_DIRECT`, `USE_ESPNOW_DIRECT_PAIRING` | the pairing's guest exchange (X25519, a signed transcript) that carries a node into the house |
| `xdrv_97_button_decouple.ino` | `USE_BUTTON_DECOUPLE` | the panel's buttons, decoupled from its relays |
| `xdrv_96_wifi_station.ino` | `USE_WIFI_STATION_CONTROL` | search and join a network from the glass, the hotspot |
| `xdrv_95_boot_rescue.ino` | `USE_BOOT_RESCUE` | three short boots open the way to a phone |
| `xdrv_99_rtc_retain.ino` | `USE_RTC_RETAIN` | the time kept across a restart that is not a power cycle |

Besides those, fixes in Tasmota's own code (the Berry `persist` saved atomically, the Berry rules matched by their first key, the Wi-Fi at boot
without Ethernet, ...), and the cuts that keep out what no node uses (TLS, IPv6, the SD card, the file system's FAT fallback, Zigbee2Tasmota on the
panels, and the rest of the generic feature set).

## 6. Memory

**The panel's heap is the scarcest resource**: about 176 KB free with no script of ours, and no PSRAM. The code lives in flash; the heap holds the
data: about 43 KB of the brain's after boot, about 48 KB with the largest zone on the screen, against a limit of about 99 KB that leaves the Wi-Fi,
lwIP, the web and the OTA their share. Every new screen, table or view counts its bytes against that.

**The app's flash** is the other budget: the panel's app partition is 2 176 KB and the bridge's 1 856 KB, and the Berry brain is the largest part of
the panel's app that grows. The file system is not tight. Each build's free bytes are measured and recorded.
