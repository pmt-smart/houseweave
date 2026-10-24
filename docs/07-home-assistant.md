# 07 — Home Assistant

**Home Assistant is an optional observer, never a dependency.** A panel works fully without it: the panels and the bridges run the house on
their own, over the mesh. Home Assistant, when there is one, sees the house and can command it over MQTT, shows the panels' schedules as
calendars, and hosts the **HouseWeave add-on**, the house's server for releases and backups ([06](06-ota-and-backup.md)).

## 1. The add-on

`ha/houseweave/` is a Home Assistant add-on (its `config.yaml`, `build.yaml` and `Dockerfile`) with three parts:

- **the server** (`ha/houseweave/server/`): the releases, the backups, the nightly round, the relay to the nodes it cannot reach, and the
  pairing with a house;
- **the app** (the Studio, the House and the Settings), served on the app's port and shown in Home Assistant's sidebar through the ingress;
- **the integration** (`ha/houseweave/custom_components/houseweave`), which the add-on copies into Home Assistant's configuration when the
  version Home Assistant has is another.

**Two ports**:

- **the nodes' port, 8080**, on the house's network: the releases and the routes the nodes sign (the hello, the backup, an answer another node
  carried). The owner's API does not answer here;
- **the app's port, 8099**: the owner's API (the fleet, the requests to a node, the round, the hardware swap, the pairing) and the releases,
  read-only. It has no login of its own: it listens on `APP_HOST` (the machine itself unless told otherwise) and, with `APP_FROM`, answers only
  those addresses. In the add-on, only Home Assistant's ingress (`172.30.32.2`), which passes only who logged into Home Assistant.

**Folders**: the house's folder is `/share/houseweave`, with the releases in `ota/`. The server's identity (an X25519 pair,
`server-x25519.pem`), the house it is paired with (`house.json`) and the nodes' backups (`backups/<radio address>.json`, with the nine before as
`.1` to `.9`) live in the data folder, which it never serves: `DATA_DIR`, `/data` in the add-on.

**The version** is the one in `config.yaml`, for the server, the integration and the app together. `node scripts/ha-addon.mjs` builds the app
into `ha/houseweave/app/`, takes the package's fingerprint (the SHA-256 of every file Home Assistant builds the image from) and keeps it in
`ha/houseweave/version-lock.json`, in the same commit. A version is released with the tag `v<version>` (`node scripts/ha-addon.mjs --release`,
then `git push origin v<version>`): once tagged, a changed package in the same version is refused, and a new version needs its line in
`ha/houseweave/CHANGELOG.md`, which Home Assistant shows. Installed from the add-on repository, the image builds the app from that tag's code,
which takes a few minutes; a folder with the app already built goes as it is. The image's `npm ci` runs on Alpine and needs the native binaries
of the bundler and the CSS minifier for it, which `node scripts/ha-addon.mjs --lock` adds to the lockfile when they are missing.

How to install it (as a local add-on, a container next to Home Assistant, or a plain process on a PC) is in `ha/houseweave/README.md`.

## 2. The app

The app is the simulator's own React app ([10](10-simulator-and-tft.md)), built with relative addresses so that it works under the ingress
path, in three sections:

- **Studio**: the simulator, with a panel always running, and the themes;
- **House** (`libs/nspanel-sim/sim/src/HouseTab.tsx`): the house's nodes, each with its build, when it was seen, the backup the server keeps,
  "Not saved" when it has a change with no backup, and its last request with the answer ("through node 4" when another node carried it); Backup,
  Upgrade, State and Restore for a node, and Backup and Upgrade for all (asked first); the backups the server keeps, with **Give to...** for a
  hardware swap; and the releases of the index;
- **Settings** (`libs/nspanel-sim/sim/src/ServerSettings.tsx`): the server's identity and address, **Pair with a house**, and the hour of the
  nightly round, with **Run now**.

It talks to the server through `libs/nspanel-sim/sim/src/houseApi.ts`, at relative addresses (`/api`, `/ota`), which the server answers itself
when it serves the app, and which the simulator's development server passes to a bench server on a PC (`RELEASE_SERVER`, or
`http://localhost:8098`).

## 3. The integration: a calendar for each scheduled device

The panels keep the house's **schedule** and run it, with or without Home Assistant. The integration makes each device the schedule turns on and
off a calendar in Home Assistant (`calendar.thermostat_1`), from what the panels say on the house's MQTT, which Home Assistant already has. A
calendar is seen and edited in Home Assistant's calendar; the panel checks every change and refuses one with the sentence the glass would say,
which Home Assistant shows. Adding it takes nothing to type: after the add-on's copy and a restart of Home Assistant, **Settings → Devices &
services → Add integration**, HouseWeave, whose technical name is `houseweave`. The firmware before HouseWeave's names said the schedule under
`casainteligente/schedule` and the integration's domain was `casainteligente`: the integration takes a panel's schedule from that topic until the
panel says it under `houseweave/schedule`, and then clears what the former topic kept of it; and the add-on takes the integration it copied under
the former domain out, whose entry is deleted in Devices & services before HouseWeave is added.

## 4. MQTT

**The house's MQTT is one setting for every node** (`berry/house_mqtt.be`): the broker Home Assistant listens on, its port, user and password,
whether the nodes announce themselves to Home Assistant (the discovery), and the hours after which Home Assistant marks a battery sensor
unavailable. A panel writes it once into the house's list (from Wireless settings, MQTT), and the mesh carries it to every node, bridges and
panels, in frames to one node sealed with the key of the two; each node gives it to its own Tasmota, which restarts on it. Home Assistant then
talks to each node over MQTT on the house's network, not through the mesh. The password is in the list, so in the flash of every node, as
Tasmota keeps it in each anyway.

**The bridges' Zigbee devices** appear in Home Assistant through the bridge's own MQTT discovery (`berry/zbbridge_discovery.be`), since
Zigbee2Tasmota has none: a light with the level, white and colour its type has, a mains on/off device as a switch, the sensors Zigbee2Tasmota
decodes (temperature, humidity, pressure, battery) and its alarms (occupancy, door, water, smoke, CO), a cover, and a button's or a remote's
actions as triggers. One retained announcement a part, at `homeassistant/<component>/<IEEE>/<part>/config`, with the device's topics under
`zigbee/<IEEE>`: `state` (retained, at every report), `set` (Home Assistant's commands, sent as `ZbSend`), `availability`, and `action`; and the
bridge's LWT beside the availability, so a bridge that goes takes its devices with it. The names are the panels'. Turning the house's discovery
off takes the announcements away, and Home Assistant's commands are no longer obeyed; nothing the bridge does for the panels changes.

**The alarm** is one `alarm_control_panel` in Home Assistant, which arms away and home and disarms with no code (the pattern lock is the
glass's), with an event entity for what it notices. Every bridge of the house keeps the alarm's state, and Home Assistant talks to it through one
door: the bridge that answers for it ([05](05-the-house.md)). A Home Assistant command is not taken in the first moments after the broker
connects, when the broker hands back retained ones.

**The weather** on the panels' screensaver comes from a Home Assistant automation (`ha/weather/forecast.yaml`): it says, retained, on
`houseweave/weather`, `{"at": <UTC seconds>, "cells": [[label, °C], ...]}`, the weather now and the next four days, every 30 minutes and
whenever the weather entity changes, and on `casainteligente/weather` too for a panel on the firmware before HouseWeave's names, until every panel
runs the current one. Every panel listens; none asks. A forecast older than 6 hours shows "--", and so does a house without Home Assistant, with
nothing else on the panel changing.

## 5. What stays out of Home Assistant

Everything a panel does works with Home Assistant down: the house's commands, its schedule, its alarm, its OTA row and its backups' state on the
glass. The pattern lock never leaves the panel. The house's key is never sent to the server or to Home Assistant, and the nodes' backups are
sealed with a key derived from it ([06 §7](06-ota-and-backup.md)), so Home Assistant cannot read a node's Wi-Fi password from a backup.
