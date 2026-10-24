# 00 — Journal

What was done, what went wrong and how it was solved, in date order. Entries are only added: one per session or subject, with its date in the
title and a line in the index below. A mistake found later does not erase the entry; a **dated correction** goes right under it, saying what
was wrong and what holds.

## Index

- [2026-10-23 — HouseWeave starts](#2026-10-23--houseweave-starts)
- [2026-10-23 — The names in English, with a transition](#2026-10-23--the-names-in-english-with-a-transition)
- [2026-10-24 — The former names out, and the safeboot that counted its installs](#2026-10-24--the-former-names-out-and-the-safeboot-that-counted-its-installs)

---

## 2026-10-23 — HouseWeave starts

HouseWeave begins as a snapshot of a system that already runs: panels and bridges in one house, on the ESP-NOW mesh, with the brain in Berry
compiled into Tasmota from our fork. The chapters of `docs/` describe it as it is today ([01](01-overview.md) to [13](13-testing.md)).

**What runs on devices.** A US portrait panel (production) and the EU landscape prototype, and ZBBridge Pro bridges, on a bench of six nodes on
one LAN: the house's layer, the mesh, the alarm's replica, the house's OTA through neighbours and the server, and the backups.

**The images, measured** on the build of the day:

| image | app partition | used | free |
|---|---|---|---|
| panel (US) | 2 176 KB | 2 056 527 bytes | 167.7 KB |
| bridge | 1 856 KB | 1 736 051 bytes | 160.6 KB |

The last two cuts of the generic feature set were the SD card and the file system's FAT fallback, both through switches of the fork
(`NO_USE_SDCARD`, `NO_USE_FFAT`), since Tasmota's ESP32 configuration defines them past where a build's override can undefine them: 49.3 KB on
the panel's app and 48.3 KB on the bridge's, together. A panel still on the older partition table, with an app partition of 1 856 KB, takes
today's panel app only by a serial flash: it is 152.3 KB larger than that table's app.

**Open:**

- the generator writes the screen's project and its tables, but not yet a whole `.tft` ([10 §4](10-simulator-and-tft.md));
- the bench's mesh around a whole house, with nodes spread through the rooms and one that never has a network;
- the bridge's partition table, which keeps the official one: an app of 2 368 KB with a file system of 832 KB would give the bridge 512 KB
  more, for a serial flash of each bridge;
- the screens, about 270 KB of the panel's app, as data rather than code (tables that one generic drawer reads, kept in the app's flash,
  since an OTA writes only the app), for when the panel's flash runs short.

## 2026-10-23 — The names in English, with a transition

Every name the code and its devices use is English now, and HouseWeave's where it names the project. What only the code uses changed outright: the
brain's class (`Brain`), the build's switches (`HOUSEWEAVE_PANEL_IMAGE`, `HOUSEWEAVE_BRIDGE_IMAGE`, `HOUSEWEAVE_SAFEBOOT`), the release key's
variable (`HOUSEWEAVE_RELEASE_KEY`), and the tests' data (the model room is the Living room, `berry/test/fixtures/living-room.json`). The words a
panel shows on joBr99's pages are English too (`Home`, `Test light`, and the light's detail).

**What the devices speak.** The firmware before these names said `casa` and `casainteligente` in what nodes, the server and Home Assistant say to
each other. The new firmware speaks only the new names, and the other side takes both until every node runs it:

| what | the name | the former one | who takes both |
|---|---|---|---|
| the pair key's salt, the headers, routes and signed labels | `houseweave-server`, `X-HouseWeave-*`, `/houseweave/do` and `/pair`, `houseweave-do`... | `casa-server`, `X-Casa-*`, `/casa/do` and `/pair`, `casa-do`... | the server (`FORMER` in `house-fleet.mjs`) |
| the images | `tasmota32-houseweave-living-room-eu`, `-us`, `-bridge` | `tasmota32-casainteligente-sala-eu`, `-us`, `-bridge` | the release index (`FORMER_IMAGES`) |
| the safeboot's file | `houseweave-safeboot.bin` | `casa-safeboot.bin` | nothing: a node reads it from the index |
| the screen projects | `living-room`, `p1-living-room-*` | `casa-sala`, `p1-casa-sala-*` | the backup's room check (`PanelBackup.FORMER`) |
| the MQTT topics | `houseweave/schedule`, `houseweave/weather` | `casainteligente/schedule`, `/weather` | the integration, and the weather automation |
| the integration's domain, the add-on's slug | `houseweave`, `houseweave_release_server` | `casainteligente`, `casainteligente_release_server` | the add-on takes its former copy out |

A server knows which names a node speaks from its requests, calls a node it knew before the change in the former names until it is heard, and
tries the other names when a node has no route of those. A panel flashed with the former firmware keeps its project's name through an OTA, since
the name lives in its file system. **Seen on the bench**: the server on this code, its six nodes all on the former firmware, asked node 5 (a
bridge) for its state in the former names, and the node answered.

**The fork.** The pair key's salt changed in the fork, with its copyright lines and the device group's comments in English. Its fifteen first
commits, authored by a placeholder identity and with their messages in Portuguese, were rewritten with the owner's identity and English
messages, the same trees, and force-pushed: the fork's `fix/houseweave-names` is `3e2b5c2d6`.

**The screens** were compiled again under the projects' new names, the six of them checked against their scenarios and through the pre-flight,
so the factory image of a panel carries its screen.

**The images, measured** on the build of the day:

| image | app partition | used | free |
|---|---|---|---|
| panel (US) | 2 176 KB | 2 057 632 bytes | 166.6 KB |
| bridge | 1 856 KB | 1 736 656 bytes | 160.0 KB |

**Open:** the former names taken out, in a release after every node of the house runs the current firmware.

## 2026-10-24 — The former names out, and the safeboot that counted its installs

**Every node on the names.** On the bench the six nodes were upgraded one at a time to the release of the names (`400558c/3e2b5c2d`), the
panel in the bedroom included, through the server's Upgrade of each node: each looked its image up by its former name, found the release, and
came back speaking the names. Then the transition came out (add-on and integration 1.6.0): the server takes and calls a node only in
HouseWeave's names, the pairing posts only to `/houseweave/pair`, a release's index has each image once, and the integration and the weather
automation use only the `houseweave/` topics. `PanelBackup.FORMER` stays: a panel flashed before keeps its project's former name in its file
system, which an OTA does not write, until it is flashed again by the serial line. The bench's server runs from this repository now, with its
identity, its house and the nodes' backups.

**The safeboot's count of quick starts.** The first upgrade of node 5 came back on its old build seven seconds after it was asked, with no
block fetched. The safeboot's receiver gives the device back to its app after three starts in a row that each end before 30 s, a count kept in
RTC memory and cleared only by a start that lasts 30 s or by a power cut; an install over HTTP takes less than that, so the node's two quick
installs earlier in the day had made the third start the third in a row. The second request went through, since giving the device back clears
the count. The receiver now ends the count when it installs its image (`ea07370` in the fork, with a host test that fails without it). The
safeboot carrying it (`77e6933/ea07370f`, 749 408 bytes, 32 more) is signed and pinned, and the apps that pin it were published: each node's
upgrade wrote the new safeboot first and then took its app. Five nodes answer `EspNowOtaSafeboot` with the new one (`Kept`, SHA-256
`a3336a89...`). Node 7 has no Wi-Fi and takes its images over the mesh, which installs no safeboot: it keeps the one before, and an install over
the mesh lasts minutes, past the 30 s that end the count.

**The images, measured** on the build of the day (`443140d/ea07370f`):

| image | app partition | used | free |
|---|---|---|---|
| panel (US) | 2 176 KB | 2 057 632 bytes | 166.6 KB |
| bridge | 1 856 KB | 1 736 656 bytes | 160.0 KB |

**Open:** a node with no Wi-Fi has no way to a new safeboot: one over the mesh would be the receiver's to take.
