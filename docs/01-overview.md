# 01 — Overview

**HouseWeave** is a smart house mesh, built on ESP32. A **panel** on the wall of each room (a Sonoff NSPanel) is the house's control, and a
**bridge** in each area (a Sonoff ZBBridge Pro) is the coordinator of that area's Zigbee network. Every one of them runs Tasmota, built from our
fork, with a **brain in Berry** compiled into the firmware; together they form an **ESP-NOW mesh**, which is the house. The house runs on its
own: no computer in a room, no cloud, and no Home Assistant needed, which, when there is one, observes and helps.

## 1. What it does

- **Each room has its panel**, which draws our own pages on its screen: the room's zones of lamps and devices on a plan of cards, the device
  pages, the schedule, the alarm, the clock and the settings ([08](08-screens.md)).
- **Each area has its bridge**, whose Zigbee network holds that area's devices: lamps, switches, blinds, thermostats, sensors
  ([02](02-hardware.md)). Devices are added, renamed, grouped, driven and removed **from any panel**, whichever bridge owns them.
- **The house is a mesh of equal nodes** ([04](04-the-mesh.md), [05](05-the-house.md)): any panel adds a node (a panel or a bridge), a panel's
  zone gathers devices of any bridge, and the house's settings (its channel, its MQTT, its alarm's configuration) are written once and reach
  every node. The mesh is the only bond between rooms, and it does not need the Wi-Fi.
- **The alarm** lives on the bridges, with its state kept by all of them, and the panels show it and arm and disarm it with a pattern drawn on
  the glass ([05 §5](05-the-house.md)).
- **Upgrades and backups** go over the mesh and the network: a node takes its release from a neighbour or from the house's server, and every
  node is backed up by the server, sealed with the house's key ([06](06-ota-and-backup.md)).
- **Home Assistant**, when there is one, sees and commands the house over MQTT, shows the schedule as calendars, and hosts the house's server
  as an add-on ([07](07-home-assistant.md)).

## 2. The constraints

These hold for every change, and the rest of the design follows from them:

- **The firmware is Tasmota.** No ESPHome and no firmware of our own: Tasmota brings Zigbee2Tasmota, Berry, the web UI, MQTT and the OTA, and
  our C goes into the fork as drivers behind a switch each, in Tasmota's own style ([11](11-build-and-flash.md)).
- **A panel works fully without Home Assistant.** If the machine that runs Home Assistant dies, the house goes on: the panels, the bridges,
  the schedule, the alarm.
- **One Zigbee coordinator per area, in that area's bridge.** No central coordinator: a bridge that fails takes only its own area with it.
- **No computer in a room.** No Raspberry Pi or mini PC beside a panel.
- **Home Assistant is an optional observer**, never a dependency.

## 3. What working well means

1. **A command feels instant**: a tap on the glass reaches the lamp as if the coordinator were inside the panel.
2. **No command is lost in silence.** A device that does not show what a command asked for within 2 s gets a "?" on the glass and is pinged,
   so a loss is always seen.
3. **It degrades well.** A link that drops takes only what depends on it: the rest of the panel, its screen and its other devices go on, and
   a room's own devices are never held by the state of the rest of the house.

## 4. The layers

```
[ Nextion screen ]        our pages: a generated project (the .tft and its tables)
      |  serial
[ panel: ESP32, Tasmota ] the brain in Berry: the pages, the zones, the schedule, the house's layer
      |  ESP-NOW mesh (frames from radio to radio, on the house's Wi-Fi channel)
[ bridge: ESP32, Tasmota ] Zigbee2Tasmota, the relay, the drivers, the alarm, the house's layer
      |  serial
[ CC2652P ]               the area's Zigbee coordinator
      |  Zigbee, 2.4 GHz
[ Zigbee devices ]
```

Beside them, optional: **MQTT** to Home Assistant from every node, and the **house's server** (the HouseWeave add-on), reached over the house's
network. The full picture of each image is in [03](03-architecture.md).

## 5. The approach

**Our own pages, generated as data.** A theme and a project, both JSON, become the screen's pages through the generator in
`libs/nspanel-sim/` ([10](10-simulator-and-tft.md)): the `.tft` that the screen runs and, beside it, the tables that tell the brain what each
component is. What a room's configuration changes (the cards of a zone plan, the lists, the keyboard's text) the brain draws at run time, on
pages that stay the same. The rules of drawing for this screen are in [09](09-drawing-for-the-glass.md).

**One brain, tested off the device.** The brain is Berry, compiled into each image, and the same code runs in the simulator, in Tasmota's Berry
VM built to WebAssembly, against an emulated screen and emulated Zigbee devices: a change of behaviour is made once ([10](10-simulator-and-tft.md),
[13](13-testing.md)).

**It started from joBr99's NSPanel Lovelace UI**, whose screen protocol the brain first spoke, read from its source
([reference/joBr99/ORIGIN.md](../reference/joBr99/ORIGIN.md)); that stack stays as the one of a panel with no generated project. The trade-off
is accepted: we maintain the pages and the brain.

## 6. The repository

| path | what it holds |
|---|---|
| `autoexec.be` | the only file of a panel's brain that stays a file: which project it runs, and the call to the boot |
| `berry/` | the brain: the panel's, the bridge's (`berry/zbbridge_*.be`, `berry/zbdriver_*.be`) and the house's layer they share; its tests in `berry/test/` ([12](12-berry-notes.md)) |
| `firmware/` | the fork of Tasmota as a submodule (`firmware/tasmota/`), and our build configuration (`firmware/overrides/`) ([11](11-build-and-flash.md)) |
| `libs/nspanel-sim/` | the simulator, the generator of the pages and the themes ([10](10-simulator-and-tft.md)) |
| `ha/houseweave/` | the Home Assistant add-on: the house's server, the app, the integration ([07](07-home-assistant.md)) |
| `ha/weather/` | the Home Assistant automation that gives the panels the weather |
| `scripts/` | the firmware's build, the releases, the bench tools, the verify gate and the documentation's checkers ([13](13-testing.md)) |
| `reference/joBr99/` | a vendored copy of joBr99's source, with its licence, read for its screen protocol and its icon map; not our code, not edited |
| `docs/` | this documentation, indexed in the [README](../README.md) |

HouseWeave is licensed under the GPL-3.0, as Tasmota and joBr99's project are ([LICENSE](../LICENSE)).
