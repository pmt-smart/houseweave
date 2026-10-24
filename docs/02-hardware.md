# 02 — Hardware

Two boards, both an ESP32 with 4 MB of flash and no PSRAM, both running Tasmota from our fork ([03](03-architecture.md)): the **Sonoff
NSPanel**, a panel on the wall of each room, and the **Sonoff ZBBridge Pro**, the Zigbee coordinator of a room's network. Their partitions and
how they are flashed are in [11 §4](11-build-and-flash.md); the heap and the flash budgets in [03 §6](03-architecture.md).

## 1. The panel: Sonoff NSPanel

- **The screen** is a Nextion, driven by the ESP32 over a serial line: the ESP32 does not draw it, it sends the screen commands and reads its
  touches ([03 §2](03-architecture.md)). So HASPmota, openHASP and LVGL, which need a screen the ESP32 draws, do not apply.
- **Two variants, one board.** The EU panel is landscape (480×320), the US panel portrait (320×480), both with the two buttons below the
  screen. What differs is the screen's project (each variant has its own `.tft`, [10](10-simulator-and-tft.md)), the housing and the mains
  wiring; the board, its pins and the Tasmota template are the same. The US portrait is the production panel; the EU landscape is the
  prototype, and everything tested on it holds for the US except the layout, whose proportions turn over.
- **The template is compiled in** (`HOUSEWEAVE_PANEL_IMAGE` in `firmware/overrides/user_config_override.h`), as Tasmota's `USER_TEMPLATE`, taken on
  a fresh configuration only: the screen's power (GPIO4, without which the glass stays dark), the two buttons, the two relays, the buzzer and
  the thermistor, with `ADCParam1` for the thermistor, `Sleep 0` and `BuzzerPWM 1`.
- **The buttons.** S1 and S2, the two front buttons, are on GPIO14 and GPIO27 (Button1 and Button2 of the template); the fork's button driver
  owns them from the first boot and decouples them from the relays ([03 §5](03-architecture.md)). **S3** is the reset, reached with a clip
  through the hole in the case: it is the chip's EN, so the firmware never reads it as a button and only sees the boot it causes, and it resets
  the ESP32 even with the firmware stuck. The relays release on it, as on any reset of the chip (their pins go loose until the boot drives them
  again), unlike a software restart (`Restart`, a watchdog panic, the safeboot of an OTA), which keeps them. Three short boots in a row are the
  boot rescue ([11 §8](11-build-and-flash.md)).
- **No Zigbee chip.** A panel reaches Zigbee through the house's bridges, over the mesh ([05 §4](05-the-house.md)).

## 2. The bridge: Sonoff ZBBridge Pro

- **The coordinator is a CC2652P**, which Zigbee2Tasmota drives as a ZNP (Z-Stack 3.x) and can flash itself: the bridge flashes the chip's
  firmware when the chip reports another version ([03 §3](03-architecture.md)). The radio handles well over a hundred devices, so a room's
  lamps are no load for it.
- **The template is compiled in** (`HOUSEWEAVE_BRIDGE_IMAGE`), Tasmota's official one for the board:

  ```
  {"NAME":"Sonoff Zigbee Pro","GPIO":[0,0,576,0,480,0,0,0,0,1,1,5792,0,0,0,3552,0,320,5793,3584,0,640,608,32,0,0,0,0,0,1,0,0,0,0,0,0],"FLAG":0,"BASE":1}
  ```

  with five commands: `SetOption1 1`, `SetOption32 50` and `ButtonTopic 0` give the button to the pairing (a 5 s hold goes to the rules, and
  neither the reset nor the Wi-Fi manager sits on its presses); `SetOption127 1` keeps the Wi-Fi radio awake, and `Sleep 0` the main loop, for
  the mesh ([04 §1](04-the-mesh.md)). Without the template the LEDs, the button and the Zigbee chip's reset pin are not mapped, and
  Zigbee2Tasmota does not find the CC2652P. **Never on an NSPanel.**
- **The room's Zigbee channel** is chosen when the bridge enters the house: the panel picks, among 25, 15, 20 and 26, the one farthest in MHz
  from its Wi-Fi, from the networks around stronger than -75 dBm and from the other bridges' Zigbee channels (`berry/zigbee_pairing.be`). The
  bridge takes it only while its network has no device: moving a formed network orphans its devices. The network's identity (PAN, extended PAN,
  key) is drawn on each bridge, so only the channel needs a plan.
- **A bridge that goes silent.** The ZBBridge Pro sometimes stops answering on every route, with no LED and no network, and comes back only
  with a physical power cycle (sometimes two). Before assuming a dead board or a software fault, power it off and on; and power it from a
  supply that delivers, not a computer's USB port, which has been the cause. A Tasmota restart does not reset the CC2652P: only a power cycle
  does. A weak Wi-Fi signal (around -90 dBm) has its own symptoms, dropped connections and a restart soon after boot, and is told apart by
  watching the board for a while where the signal is good.

## 3. The devices

The bridges speak standard Zigbee (ZCL): lamps with level, colour temperature and colour, mains switches and plugs, and the sensors
Zigbee2Tasmota decodes. Devices that carry Tuya's datapoints instead of ZCL attributes are handled by **drivers in the bridge**, in Berry, that
read and write the datapoints by their raw keys (`EF00/<type><dp>`) with no `.zb` plugin, and hand the panels a normalised state
([03 §3](03-architecture.md)):

- **thermostats** (`berry/zbdriver_thermostat.be`): a ZCL thermostat, and the Moes ZHT-SR, a mains-powered electric heating thermostat with a
  dial, a floor probe and its own settings;
- **blinds** (`berry/zbdriver_cover.be`);
- **switches of two channels** that open and close something, such as a gate (`berry/zbdriver_twokey.be`).

A new kind of device is a new driver in the bridge, which reaches it by the house's OTA ([06](06-ota-and-backup.md)).

## 4. The network the house needs

The house works with no Wi-Fi at all; its network is for the server, Home Assistant, the OTA and the web pages. Because the mesh runs on the
Wi-Fi channel ([04 §1](04-the-mesh.md)), the access points of the devices' network are set up for it:

- **one channel, fixed, on every access point** of that network, the house's channel; never Auto, which moves the access point by itself and
  leaves the nodes on the old channel, without network, until it is fixed again;
- **20 MHz, 2.4 GHz only** under that network's name, with no band steering (Smart Connect off): the ESP32 has no 5 GHz;
- **client isolation off**, and broadcasts between clients neither filtered nor limited;
- **beacon interval 100 ms, DTIM 1, WMM on**; **airtime fairness off** (it takes air from slow clients, and an ESP32 at 1 Mbit/s is one);
  **group key update period 0** (a periodic rekey drops an ESP32 for a moment); transmit power high;
- **no reboot schedule, no Wi-Fi schedule and no automatic firmware update** on the access points;
- **DHCP is fine**: the house's server learns each node's address from its hello ([06](06-ota-and-backup.md)).

Several access points of one network are wired to the main router as access points (one subnet, no double NAT), each with the house's channel
set by hand, or through a mesh system whose satellites are checked to stay on that channel. A node knows the channel it is on and shows an access
point off the house's channel on its mesh page, with no help from the router.

**The 2.4 GHz band is shared**: the Wi-Fi, every room's Zigbee network (channels 11 to 26) and any 2.4 GHz camera. Cameras that can use 5 GHz
should, and the rest stay on a fixed channel. **A microwave oven deafens the node next to it** while it runs: it emits around 2.45 GHz, and a
bridge beside one loses a large part of its frames for minutes at a time while the others nearby lose nothing. The mesh routes around a deaf node
by itself, but a node should not sit beside the oven; a low house channel (1, at 2 412 MHz) suffers less than a middle one.
