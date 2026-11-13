# 00 — Journal

What was done, what went wrong and how it was solved, in date order. Entries are only added: one per session or subject, with its date in the
title and a line in the index below. A mistake found later does not erase the entry; a **dated correction** goes right under it, saying what
was wrong and what holds.

## Index

- [2026-10-23 — HouseWeave starts](#2026-10-23--houseweave-starts)
- [2026-10-23 — The names in English, with a transition](#2026-10-23--the-names-in-english-with-a-transition)
- [2026-10-24 — The former names out, and the safeboot that counted its installs](#2026-10-24--the-former-names-out-and-the-safeboot-that-counted-its-installs)
- [2026-11-12 — Appliances as nodes: the fork's first step](#2026-11-12--appliances-as-nodes-the-forks-first-step)
- [2026-11-12 — The house's part of a node, out of the bridge's relay](#2026-11-12--the-houses-part-of-a-node-out-of-the-bridges-relay)
- [2026-11-12 — The house's list and mesh know an appliance](#2026-11-12--the-houses-list-and-mesh-know-an-appliance)
- [2026-11-12 — A panel takes an appliance: its device, its page, its pairing](#2026-11-12--a-panel-takes-an-appliance-its-device-its-page-its-pairing)
- [2026-11-13 — An appliance's own side: its node, the water heater's thermostat and its history](#2026-11-13--an-appliances-own-side-its-node-the-water-heaters-thermostat-and-its-history)
- [2026-11-13 — The THR320D's image: an appliance in a firmware of its own](#2026-11-13--the-thr320ds-image-an-appliance-in-a-firmware-of-its-own)
- [2026-11-13 — A thermostat's range is its own two limits](#2026-11-13--a-thermostats-range-is-its-own-two-limits)
- [2026-11-13 — The simulated appliance, and a relay opened at every boot](#2026-11-13--the-simulated-appliance-and-a-relay-opened-at-every-boot)
- [2026-11-13 — A latching relay checked by the water, and a device's warning to every panel](#2026-11-13--a-latching-relay-checked-by-the-water-and-a-devices-warning-to-every-panel)

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

## 2026-10-24 — A safeboot over the mesh, reviewed, and the pinned safeboot's record kept

**A safeboot over the mesh, reviewed.** A node with no Wi-Fi has no way to a new safeboot. The idea was to fetch one through a neighbour (the
mesh's HTTP, `berry/mesh_http.be`) and write it from the app. An adversarial review held it against the code. It stands with no change to the
server, which serves one span of a file with `Range`, and it needs five things:

- an answer in bytes: MeshHttp gives the node that asked its answer as a string, which stops at the first zero byte;
- pieces of 4 to 8 KB, not 32, for a panel's heap;
- time: at about 2 to 3 KB/s, the 749 408 bytes take 5 to 10 minutes;
- the partition erased a block at a time as the write goes, not all at once, so that the radio is not deaf for seconds;
- the first sector written last, once the SHA-256 checks.

The last is because the build's boot loader does not check an image's hash when it boots (`CONFIG_BOOTLOADER_SKIP_VALIDATE_ALWAYS=y` in the
framework's sdkconfig). An image whose headers are all there and whose bytes are wrong boots and fails again and again, and only the serial
line brings the device back. While its first sector is still erased, the boot loader takes the app instead. A write cut in the middle is not
that case, since the next segment's header is still erased and the boot loader refuses the image. The same order would make the install over
HTTP safer too. The safeboot over the mesh waits until it is needed: a new house key, or a fix of the receiver that must reach the nodes with
no Wi-Fi.

**What the review found on the way.** A device flashed with a factory image that never has the Wi-Fi keeps no record of its safeboot: only an
install over HTTP keeps one. `EspNowOtaArm` knows a safeboot by its record or by the one the build pins. So the first app such a device takes
over the mesh that pins another safeboot would refuse it, and the device would take no image again. The build now gives the app the signed
record and signature of the safeboot it pins, and the app keeps them when it finds its partition holding that safeboot (`8dd1e94` in the
fork, `167d085`; the OTA host test checks it). This covers the devices flashed with a factory image of this build or a later one.

The bench's node 7, out of the Wi-Fi's reach for now, is not that case: it kept the record of its safeboot when it was upgraded over HTTP on
2026-10-22, and it takes its images over the mesh with that record.

**The images, measured** on the build of this change (`167d085/8dd1e94`), each 240 bytes larger than on `443140d/ea07370f`:

| image | app partition | used | free |
|---|---|---|---|
| panel (US) | 2 176 KB | 2 057 872 bytes | 166.4 KB |
| bridge | 1 856 KB | 1 736 896 bytes | 159.8 KB |

## 2026-10-24 — The house's safeboot through a neighbour, and the first sector last

**What was built.** A node with no Wi-Fi now takes the house's safeboot through a neighbour (`ee4e24f`, fork `6f27fc1`, [06 §4](06-ota-and-backup.md)).
Before it asks for its release, `NodeOta` fetches the server's index through the neighbour's way to the server, then the safeboot's signed
record, then the image 4 KB at a time. The fork's writer (`espnow_ota_safeboot_begin`, `_write`, `_finish`) writes each piece as it comes:
the partition is erased a block at a time as the write goes, and the first sector waits in RAM and is written last, once the whole image
checks against the record. `EspNowOtaSafeboot` over HTTP uses the same writer.

**What the work found on the way.**

- **Berry joins two strings only up to the first zero byte of each** (`be_strcat` copies with `strcpy`, and keeps the summed length), and the
  device's Berry does not even keep a zero byte in a string literal. A binary body must therefore stay bytes from end to end:
  - `PanelHttp` now reads the answer as bytes, and gives bytes to a request that asks for them;
  - `MeshHttp` carries an answer's bytes as they came.

  Every Wi-Fi node that may carry a no-Wi-Fi node's requests needs this firmware, so the whole bench took it.
- **A bytes object in the test's Berry stops at 32 768 bytes and drops the rest unsaid.** So an answer is now too large past 32 000 bytes of a
  body and 512 of a head.

**On the bench.**

- **The five Wi-Fi nodes took the release over HTTP**, one at a time.
  - Node 1, whose Wi-Fi is weak, gave up its own download in its safeboot. A neighbour (`.112`) noticed it had stalled and sent the release
    over the mesh in about 2 min 16 s.
  - Each of the five kept its safeboot, which was already the server's. The HTTP write with the first sector last was therefore not exercised
    on a device; the host test covers it.
- **Node 7 had dropped off its Wi-Fi again** (its signal is weak), with its safeboot from before (`9870b560`).
  1. It took the app over the mesh, sent mostly by node 1, in about 12.5 min.
  2. Asked to upgrade again, it fetched the index and the signed record through node 1, then the 749 408 bytes in 183 pieces, all through
     node 1, in 686 s (about 1.1 KB/s, slower than the estimate: node 1's own Wi-Fi is weak, and each piece waits for its fetch). It then asked
     a neighbour for its release.
  3. A third upgrade fetched the index and the record and no piece: the partition holds the server's safeboot (`77e6933/ea07370f`), checked
     by its SHA-256 against the signed record.
- **A rule left on node 7.** Rule3 is still on, put there to take it off its Wi-Fi, which turned out not to be needed. It sets the same SSID
  back 45 minutes after a boot and turns itself off, which costs one restart. Clear it with `Rule3 ""` when the node is on the Wi-Fi.

**The images, measured** on the build of this change (`ee4e24f/6f27fc18`):

| image | app partition | used | free |
|---|---|---|---|
| panel (US) | 2 176 KB | 2 064 400 bytes | 160.0 KB |
| bridge | 1 856 KB | 1 743 568 bytes | 153.3 KB |

The panel image is 6 528 bytes larger than on `167d085/8dd1e94`, and the bridge image 6 672 bytes larger.

## 2026-10-24 — The safeboot through a neighbour, made to hold

An adversarial review of the safeboot through a neighbour found five ways to leave a node with no safeboot image, which EspNowOtaArm refuses,
so the node takes no app over the mesh until a later write succeeds. All five are closed (`215630b`, fork `a411f31`,
[06 §4](06-ota-and-backup.md)).

1. **A busy way.** The node has one request at a time through a neighbour. A hello whose answer is lost holds the way for a minute, and a
   neighbour answers 503 when it is busy or short of memory. Both spent the write's tries, and the write ended in about 10 s, possibly after
   the erase. Both are now waited for, with no try spent, up to 3 minutes with nothing had.
2. **The neighbour's heap.** The neighbour kept each 4 KB answer for 20 s, in case the node lacked a piece. With a piece about every 3.7 s,
   that is some 20 KB of a panel's heap, and past its 40 KB floor the neighbour answers "Low memory". It now lets a node's answers go when the
   node asks again: a node asks again only once it had its answer, or gave it up.
3. **A neighbour on an older firmware** ends a binary file at its first zero byte. That was found only by the final check, after the erase,
   and each later try erased again. The writer now checks the first piece before anything is erased: the header's `0xE9`, and the app
   description's magic word at offset 32 (the image's first zero byte is at offset 9). Such a piece is refused, the image the partition holds
   stays, and the release is asked for all the same.
4. **The Wi-Fi back.** A write that did not end waited for the next upgrade once the node's Wi-Fi was back. It is now written over that Wi-Fi
   (`EspNowOtaSafeboot`, at the address the index gives).
5. **The tries.** A write that did not end was tried every 10 minutes, erasing each time. It is now tried 10 minutes later, then twice as long
   after each try that fails, up to 2 hours.

**Checked and found sound:**

- The release server's answer heads are 178 to 236 bytes, under the 512 that `PanelHttp` now looks in.
- NVS does not write a value it already holds, so the record kept at each "Kept" costs no flash.
- Old and new firmware still carry each other's text answers.
- With the partition empty, the boot loader starts the app.

**On the bench**, every node took the release (`215630b/a411f314`). Nodes 3, 4, 5 and 6 each took about a minute. Node 1 took about 7 minutes,
its request answered "no answer" though it arrived. Node 7, back on its Wi-Fi, took it over HTTP in 93 s. Its install fetched only the safeboot's signed record and kept the partition: by the HTTP path's own check too, the safeboot written over the mesh earlier in the day is the server's.

The verify's `scripts` step failed once on two bench-tool tests (`bench-logs`, `bench-power`), which have nothing to do with this change.
Both passed when run again, and so did the step: they are timing-sensitive under load.

**The images, measured** on the build of this change (`215630b/a411f314`), each about 2.2 KB larger than on `ee4e24f/6f27fc18`:

| image | app partition | used | free |
|---|---|---|---|
| panel (US) | 2 176 KB | 2 066 640 bytes | 157.8 KB |
| bridge | 1 856 KB | 1 745 824 bytes | 151.1 KB |

## 2026-11-12 — Appliances as nodes: the fork's first step

The house is to take a node that is itself a device: a Sonoff TH Elite (THR320D, an ESP32 with a 20 A latching relay and a TM1621 display) on
a water heater, with the WTS01 waterproof probe in the tank's well. It will be a fourth role of the house's list, which the panels see as an
owner of devices, as a bridge with no Zigbee: the heater is a thermostat on the page they already have. Its logic runs on the node, so it keeps
to its targets and its hours with no panel on and the mesh down. The first step is two changes in the fork, each on its own branch.

**The WTS01's reading** (`fix/wts01-reading-withdrawn`, `6c07df7`). The serial bridge decoded the probe's datagrams into a temperature that
started at 0 °C and was kept forever: a node just booted read cold water until the probe's first datagram, and a probe unplugged left its last
value. The temperature is now reported only from the first valid datagram on, and no longer once none came for 5 s. A new host test,
`firmware/host-tests/serial-bridge-wts01/`, compiles the driver as it is and reads it where every reader of a sensor does: 23 checks, of which
10 fail against the driver before the fix. No image carries the serial bridge yet, so the test is what compiles that driver; it is in the
gate ([13](13-testing.md)).

**The appliance's window** (`feature/pairing-announce-appliance`, `592f706`, stacked on the first). A panel's search told a wall panel from
a device without a screen, but not a bridge from an appliance, and called both a bridge. The pairing's announcement takes the next free flag,
0x10, for an appliance with no Zigbee coordinator and no screen; `EspNowPairOpen`'s third argument is now a kind, 0 and 1 as before and 2 for
an appliance; and the search's `Heard` reports say `Appliance`. Nothing in the Berry reads it yet: the panel will, with the role, and the
simulator's stand-in of the pairing will say it then.

**Open, for the bench:**
- the WTS01 datagram's ninth byte is the sum of the first eight in the one example the driver's notes give; the driver does not check it, and
  the bench says whether it should;
- which coil of the latching relay switches it on: with the official template, Tasmota pulses GPIO22 for on and GPIO19 for off, and the
  ESPHome page of the device says the opposite. A lamp in the heater's place answers it before the heater is wired.

**The images, measured** on the build of this change (`479358b/592f7062`), each 64 bytes larger than on `215630b/a411f314`: the pairing's
new flag. The fix of the WTS01 weighs nothing in either, since neither carries the serial bridge:

| image | app partition | used | free |
|---|---|---|---|
| panel (US) | 2 176 KB | 2 066 704 bytes | 157.7 KB |
| bridge | 1 856 KB | 1 745 888 bytes | 151.0 KB |

## 2026-11-12 — The house's part of a node, out of the bridge's relay

The second step towards an appliance as a node of the house. A bridge is two things: the coordinator of a Zigbee network, and a node with no
screen, which the panels of the house reach over the mesh. The second is what an appliance is too, and it was written inside the bridge's relay.
It is now a file of its own, `berry/node_host.be`, and the relay hands over to it ([03 §3](03-architecture.md)).

**What went to `NodeHost`**: the house's layer and the mesh's commands started at boot; the panels that hear the node, and the events sent to
them; the words every node takes from a panel (the one that keeps it as the node of the house's words, the factory reset, the web password); its
Wi-Fi, its OTA, the house's server and its backup; the house's MQTT; its Main settings, with the node's own rows, and its Wireless settings on a
panel; and its way out of the house. **What stayed in the relay**: the Zigbee network and what it says, the closed list of commands a panel
sends a bridge, the coordinator's firmware, the window of entering the house with the button and the LED, and the clock.

**Static functions over the node, not a class the relay extends.** The node's own object keeps the fields (`house`, `wifi`, `ota`, `link`,
`backup`, the panels heard from) and is asked for what is its own: its rows of the Main settings, its part of the house's MQTT, its wipe. The
firmware's build runs the files in the order of their names, with each of our classes declared empty until its own file has run, so a class could
only extend one whose file's name came first; a class of static functions has no such order ([12 §1](12-berry-notes.md)). And with the fields
where they were, the tests and the simulator, which read and set them, did not change.

**A bridge does what it did**: the same log lines and the same names of timers and rules, which the node tells `NodeHost` (`TAG`, `ID`). The
relay's tests pass as they were, but for three constants named by their new owner, and the house's end-to-end tests on the simulated bridge
pass. A new test runs `NodeHost` over a node that is no bridge, the appliance's stand-in: 70 checks.

**Open:** the window of entering the house, the button, the pairing's link and the clock are a bridge's still. An appliance needs them too, and
they move when its class is written, as their second user.

**The image, measured** on the build of this change (`367639c/592f7062`): the bridge's, 1 472 bytes larger than on `479358b/592f7062`. The
panel's image carries none of the files that changed, and was not built:

| image | app partition | used | free |
|---|---|---|---|
| bridge | 1 856 KB | 1 747 360 bytes | 149.6 KB |

## 2026-11-12 — The house's list and mesh know an appliance

The third step towards an appliance as a node. The house's list has a role for it, `HouseList.ROLE_DEVICE`, the number 4, and the list and the
mesh's layer say what a node of that role is ([05 §1](05-the-house.md)).

**A node of the mesh that owns a device.** It is among the list's nodes (`ids`, `meshed`), so every part that goes through them takes it with no
change of its own: the mesh driver's table, a new key, the house's channel, the server's relayed requests. It owns a device, as a bridge owns
those of its network (`owns`, `is_owner`): the question the panels' side will ask where it asks today whether a node is a bridge. Unnamed, it is
"Device" and the end of its radio address.

**As a bridge in what a node with no screen is, and not in what is Zigbee's.** It says its presence at a bridge's period, has the panels' marks
of its device back from the flash when it starts, and writes nothing into the list. It has no alarm number and is no panel's favourite bridge.
The last panel that leaves a house took its bridges along, since a house always has a panel; it now takes every node that has no screen.

**No format changes.** A build kept an identity of a role it did not know as it came, up to role 15, so a node that learns this one finds the
appliance in the fields it already holds, with its vector kept. What an older build does not do is speak to it: it gives the mesh's driver no
node of that role and sends it no new key. So **a house takes an appliance once every node of it runs a build that knows the role**; nothing in
the code holds a panel to that yet.

**The bench's console** writes one with `HouseAdd device,...`, and `HouseStatus` says `Device`.

**Open:** the panels' side. A panel's screens still take any node that is not a bridge for a panel, and its state, its devices' page and its
events are a bridge's alone. The simulator's House tab and the house's server name the roles 1 to 3.

**The images, measured** on the build of this change (`d8491f0/592f7062`), each 992 bytes larger: the panel's than on `479358b/592f7062`, the
bridge's than on `367639c/592f7062`:

| image | app partition | used | free |
|---|---|---|---|
| panel (US) | 2 176 KB | 2 067 696 bytes | 156.8 KB |
| bridge | 1 856 KB | 1 748 352 bytes | 148.6 KB |

## 2026-11-12 — A panel takes an appliance: its device, its page, its pairing

The fourth step towards an appliance as a node: the panels' side. Where a panel asked whether a node is a bridge and meant whether it owns
devices, it asks the second (`HouseList.owns`); where it meant Zigbee, it asks the first still ([05 §4](05-the-house.md)).

**Its device in a zone.** The zone's + has a row of its own, **Mesh device**, in a house with an appliance, with or without a bridge
([08 §5](08-screens.md)). "Existing device" is under "Zigbee device", and the device an appliance is, is not one. The page is the same, asked
of the appliance as of a bridge. An appliance has no Z2T to give a Config, so its item carries what the device is: `"d"`, the description a
driver gives of a device, which `PanelStore.item_profile` reads as a pairing reads one.

**Its state and its words.** A frame of state and an item of a page are taken from an owner, a bridge or an appliance, and from no other
(`HouseState.take_state`, `HouseDevices.take_item`). What a node says over the mesh that a panel takes is a function of its own now, with its
test (`PanelBoot.takes`): an appliance is heard as a bridge that is not the house's. The sync gate looks at it by the same heartbeat, and the
reason on its device's page calls it the device: "Device not heard".

**The pairing and the mesh's page.** The search reads the window's `Appliance` flag: the node is listed as "Device" and the end of its radio
address, with the hint "device", and is never the "nearest" bridge. It is written into the list with its role, and offered the Wi-Fi as a
bridge is, in words that call it the device. Its page has no Favorite row; Remove from house sends it the word of its factory reset, as to a
bridge; and the last panel's question counts every node with no screen, "Leave with 3 nodes" with an appliance among them, where it counted
the bridges alone while leaving took them all.

**The thermostat's page.** A description may name what the thermostat measures (`"measure"`), and the line says it in the room's place:
"Water 58.0°". A state may carry a few words (`"note"`), which follow the temperature while they hold: "Water 58.0°  No clock"
([08 §4](08-screens.md)).

**The device's options.** The device an appliance is has no Replace, and leaves this panel only: out of the house it goes with its node.

**A fix on the way.** A device taken from a house of one bridge left the screens one past the zone, on the plan: the +'s screens were counted
as two, the page and the list of bridges, and a house of one has no list. They are removed as many as there are.

**The vectors did not change**: what a house with no appliance draws and does is what it was. The new checks are in the suites of the sync
gate (40 checks), the mesh (482), the mesh's page (223), the + (77), the thermostat (202), the pairing (77) and the boot (30), on both VMs.

**What `verify` caught.** `berry/panel_gate.be` named `HouseList` outright, and a panel loads the list's file after it. The Berry suites put
the files of a test in an order of their own and passed; the simulator, which loads them as a panel does, booted no panel, and its step
failed. The file reads the list by its global name, as the files that come before the list's do, and the second run passed whole.

**Open:** the appliance's own side, which answers all of this, is the next step. The schedule takes a thermostat's target between 5 and 45
degrees, a room's: an event with a water heater's target is refused. The simulator's House tab and the house's server name the roles 1 to 3.
Nothing holds a panel from adding an appliance to a house where a node runs a build that does not know the role.

**The images, measured** on the build of this change (`7d99467/592f7062`), against `d8491f0/592f7062`: the panel's is 3 440 bytes larger,
and the bridge's, which shares the house's layer, 48:

| image | app partition | used | free |
|---|---|---|---|
| panel (US) | 2 176 KB | 2 071 136 bytes | 153.4 KB |
| bridge | 1 856 KB | 1 748 400 bytes | 148.6 KB |

## 2026-11-13 — An appliance's own side: its node, the water heater's thermostat and its history

The fifth step towards an appliance as a node: its own side, in Berry, with its tests off the device ([03 §3](03-architecture.md)). No image
carries it yet.

**What every node with no screen shares grew.** The window of entering the house, its button and its LED, the boot with no network saved, the
clock, and the way what a node says is cut to the frames of the mesh went from the bridge's relay to `NodeHost`, and the pairing's link from the
bridge's own class to `NodePairing` (`berry/node_pairing.be`). The relay hands them over and does what it did, under the same log tag and the
same names of timers and rules; what is a bridge's in each is asked of the node: what its window announces after its seconds (the Zigbee channel),
what it does when the window closes (the room's channel a panel chose), and what is its own in a guest's first word. The drivers' host cuts its
messages with the same two functions. `NodeHost` and `NodePairing` follow `ClockLink` in the bridge's lists, since the drivers' host names the
first.

**The time of a node with no screen.** The time went only between a panel and the bridge of the house. A bridge or an appliance with no clock at
all asks the house for it: its own word, which says it has none, to the bridges and the appliances of the house, one a minute, each in its turn,
until it has a clock ([05 §4](05-the-house.md)). `ZbRelayTime` over the mesh is every node's word, taken by `NodeHost.run` with the number of
the one that said it: a node with no screen that asks is answered alone, and a panel's word is answered to the panels that hear the node, as
it was. A node hears the answer as an event of the house, from an owner that is not struck off.

**The appliance's node** (`berry/appliance_node.be`). It runs what a panel says of a device: a driver's command, a ping, an Identify, which
blinks its LED, and the name the house gave the device; any other word is refused and said at level 1. It says the device's state as a
bridge's drivers do, the fields the panels were not told, one frame at a time, and a command's answer whole. **The description goes only to the
panels that show the device**, each alone, with the whole state, when one marks it and after a boot: a panel registers a device a description
names. **The page of its devices** is the one device, answered at once (`HouseDevices.own`), and the item carries only what classifies it (the
kind, the caps, the endpoint, the range): the whole description with a name is 231 bytes, and an item has 216. Its window blinks the board's
second LED, which follows no relay, and announces a device of the house with no Zigbee channel. The button's short press is taken by a rule
that does nothing, since with none Tasmota toggles the relay. Before Tasmota restarts, for a command, an OTA or a reset, the device is stopped
first, and the node adds the device to Tasmota's telemetry.

**The water heater's thermostat** (`berry/boiler_thermostat.be`). The heater comes on with the water at or below the target less the hysteresis,
and goes off at the target. Two windows of the day have each its hours and its target, past midnight when the second hour comes first and none
when the two are the same; outside both the heater is off. It is off in the mode off, with no reading of the probe, at the ceiling, and once
the node is about to restart. **The target a panel sees and sets is a window's**: the one in force, or the next to begin. A relay switched by
another hand is seen at the next second and taken as the mode asked for. **With no clock** it holds the first window's target, and says so in
the state's note, in a first row of its settings that is only read, by the node's LED, a second lit and a second dark, and in the telemetry;
a panel that has the settings on show hears them again when the mode comes or goes. Out of its box it is off, with the windows 17 to 21 at 60
degrees and 5 to 7 at 50, a hysteresis of 3 and a ceiling of 75: the hours are a first guess, for the bench. The probe's calibration is
Tasmota's temperature offset, so the display and the MQTT say the water the logic reads. The water is said to the panels when it moved three
tenths from what they have, or a minute after it was last said.

**Its history** (`berry/boiler_history.be`): a slot every five minutes for a week, with the water in half degrees and the heater's minutes, and
a day's lowest and highest water and its minutes for a year, 5 504 bytes in all, written to the file system on the hour and before a restart,
beside the file and then over it. The slots filled with no clock are kept in order, a day of them at most, and take the places just before the
moment the clock comes, marked.

**The tests.** New suites for the node (69 checks), the thermostat (81) and the history (29); `NodeHost`'s has the window, the clock and the
cutting over a node that is no bridge (105); the mesh's has the appliance's page (488); the relay's pass with the constants read from
`NodeHost` (226). The appliance's files have a list of their own in the simulator's VM, and `brain.test.mjs` holds them to the build's
rules as it holds the brain's and the relay's: one class a file, strict with globals by name, nothing at the top.

**What the gate caught.** One test of the simulator matched the words of a log line the bridge says through `NodeHost` now, "this node leaves
the house".

**No check for an older build.** A house takes an appliance once every node of it runs a build that knows the role ([05 §1](05-the-house.md)).
The rule is kept by the order of the updates, with no check in a panel: a check would cost bytes in every image for a change that happens
once, and a node that is only off would hold the adding.

**Open:** the image (its env, its template, its `autoexec.be`), the simulated appliance, and the house's server, which names the roles 1 to
3: until the appliance has a part to back up, it keeps no backup and says nothing to the server. For the bench: whether a rule on the short
press keeps Tasmota from the relay, whether Tasmota leaves the second LED alone, which coil of the relay is the one that turns on, and the
windows' hours. The schedule takes a thermostat's target between 5 and 45 degrees, a room's.

**The images, measured** on the build of this change (`12f844a/592f7062`), against `7d99467/592f7062`: the panel's is 176 bytes larger, for the
page of an appliance's devices, and the bridge's 4 496 bytes larger, for what `NodeHost` gained: the time asked of the house and answered, and
the window and the pairing that ask the node what is its own.

| image | app partition | used | free |
|---|---|---|---|
| panel (US) | 2 176 KB | 2 071 312 bytes | 153.2 KB |
| bridge | 1 856 KB | 1 752 896 bytes | 144.2 KB |

## 2026-11-13 — The THR320D's image: an appliance in a firmware of its own

The sixth step towards an appliance as a node: the image of the first one, the Sonoff TH Elite THR320D with its WTS01 probe on a water heater
([02 §5](02-hardware.md), [11 §2](11-build-and-flash.md)). No device was flashed.

**The env** is `tasmota32-houseweave-thr320d`, named by the board, with a switch of its own in the override, `HOUSEWEAVE_THR320D_IMAGE`, as the
bridge has. The image leaves Zigbee2Tasmota out and takes two parts of Tasmota the others leave out: the serial bridge, which decodes the
probe, and the driver of the board's display, which shows the probe's temperature by itself. It keeps the bridge's partition table. Its Berry is
the list the simulator's VM already had for an appliance, compiled in the same way as the relay's, and its file system is one file,
`autoexec.be` (`berry/appliance_autoexec.be`, staged by `firmware/overrides/appliance_files.py`), which loads a file of the node left on the
file system over the firmware's class, says so by name, and starts the node.

**The template** is Tasmota's for the board, which the display's driver lists, with two pins changed, each code read against the fork's own
table of GPIO functions. GPIO25, the probe's data line, is the serial bridge's receive pin, 1824. GPIO4, the dry contact, has no function: as
the third relay it was a second Power, which the Web UI and the MQTT could switch and nothing uses.

**Its commands** are the bridge's five and three more. `SSerialMode 3` decodes the probe. `PowerOnState 0` opens the relay at a power up: the
relay is a latching one, which a power cut leaves where it was. **`SetOption73 1` detaches the button from the relay.** The node took the short
press with a rule that does nothing, which keeps Tasmota from toggling the relay only while Berry runs; with the option, Tasmota's own button
code never reaches the relay, with Berry running or not, and the 5 s hold still comes to the rules as it did. The rule stays, for a
configuration without the option.

**What the image leaves out besides Zigbee.** The panel's button driver (`USE_BUTTON_DECOUPLE`), whose hold toggles the relay under the button:
on this board that is the heater's; a build with it and one without are 1 632 bytes apart. And an appliance runs no command heard on the
pairing's link, as a bridge runs none: its driver hands each to the rules, where no rule of the node takes one, since what a panel asks of it
comes over the mesh.

**The tests.** `brain.test.mjs` holds the env's list, the simulator's and the `autoexec.be`'s to each other, as it holds the bridge's, and
checks that each image's env sets the switch under which the override has a template: a name that differs would leave an image with the base
env's features and no template, with nothing said by the build. The `autoexec.be` has its suite (6 checks), and the build script's dry run
names the new env among the ones it builds by itself.

**For the bench.** The flash is reported as 4 MB, which the backup of the factory flash confirms. Which coil closes the relay, with a lamp in
the heater's place. Whether Tasmota leaves the second LED alone. **The display keeps the last temperature for up to five minutes after the
probe goes**: it shows Tasmota's global temperature, which lives 300 s, while the sensor, the node and the panels have no reading 5 s after the
last datagram.

**The images, measured** on the build of this change (`863582a/592f7062`), against `12f844a/592f7062`: the panel's is the same size, and the
bridge's the same size. The THR320D's is the first of its kind, 277 824 bytes under the bridge's:

| image | app partition | used | free |
|---|---|---|---|
| panel (US) | 2 176 KB | 2 071 312 bytes | 153.2 KB |
| bridge | 1 856 KB | 1 752 896 bytes | 144.2 KB |
| THR320D | 1 856 KB | 1 475 072 bytes | 415.5 KB |

## 2026-11-13 — A thermostat's range is its own two limits

**What started it.** The schedule took a thermostat's target between 5 and 45 degrees, a room's, whatever the device: a water heater's event
at 60 was refused. A first answer added the device's range beside the room's, two rules, one of them a kind of device's numbers inside the
panel. It was not committed: the rule was asked for as one, from the devices themselves.

**The rule.** Every thermostat has, among its settings, the lowest and the highest its target is set to, under the same keys (`lmin`, `lmax`)
and the same words ("Operating min", "Operating max") whatever it is. What they are is the range the device is described with, and a limit that
changes describes the device again. A panel already kept the range of a description and brought it up to a new one
(`PanelUi.described_known`): its record, the − and the + of the page and the schedule follow with nothing of a kind of device in them
([08 §4](08-screens.md)).

**The Zigbee thermostat** (`berry/zbdriver_thermostat.be`). The Moes ZHT-SR had the two settings, its datapoints 18 and 34, as "Min limit" and
"Max limit", and a range that was its profile's whatever they said: a limit raised to 40 on the device left the page stopping at 35. The
driver keeps the limits each device says and its range is those, its profile's for an end the device has not said. A limit that moves the
range is kept in the flash, so a bridge that restarts describes the device with the range it had, and the host describes the device again.
A ZCL thermostat keeps its profile's range: it has no settings here, and the house has none to check its limit attributes against.

**The water heater's** (`berry/boiler_thermostat.be`). Its range was a constant, 30 to 70 degrees. It has the two settings now, 30 and 70 out
of its box, the lowest between 20 and 45 and the highest between 50 and 75. A window's target is taken within them, on the page and in the
settings; a limit that moves takes a target left outside to that limit, at once and at a boot; a panel with the settings on show hears their
schema again, for the targets' new ends; and the node tells each panel that shows the device what it is again (`ApplianceNode.described`).

**The schedule** (`berry/panel_schedule.be`). A thermostat's target is one a device of the event takes: within that device's range. A zone's
event takes what one of its thermostats does, and each is given the nearest it takes, as before; a device that said no range takes any. The
ends no target goes past, 5 and 100 degrees, are only what keeps a document sound. **What changes for an event that was taken before**: one
between 5 and 45 degrees but outside its device's range was taken and fitted when it ran; it is refused when it is made now, with the same
sentence. An event already saved still runs, fitted. A new event of a thermostat that has said no target yet starts at the nearest to 21
degrees the device takes.

**The tests.** The water heater's suite has the limits (92 checks), the Zigbee driver's the range that follows what the device says, the
flash and the description again (88), the node's the panels told again (72), the schedule's the one rule over a room's thermostat, a water
heater, a zone of both and a device with no range (138), its screens a water heater's event (127). In the simulator, the house test sets
"Operating max" to 40 on the glass of a panel: the thermostat takes it, the bridge describes it again over the mesh, and the panel's record
of its range goes from 5–35 to 5–40.

**The images, measured** on the build of this change (`3ee439c/592f7062`), against `863582a/592f7062`: the panel's is 624 bytes larger, the
bridge's 880 bytes larger, and the THR320D's 1 264 bytes larger:

| image | app partition | used | free |
|---|---|---|---|
| panel (US) | 2 176 KB | 2 071 936 bytes | 152.6 KB |
| bridge | 1 856 KB | 1 753 776 bytes | 143.3 KB |
| THR320D | 1 856 KB | 1 476 336 bytes | 414.3 KB |

## 2026-11-13 — The simulated appliance, and a relay opened at every boot

The seventh step towards an appliance as a node: the THR320D in the simulator, in the VM's house tests and in the app
([10 §6 and §7](10-simulator-and-tft.md)). No device was flashed.

**The VM's module, rebuilt.** `libs/nspanel-sim/vm/wasm/berry.mjs` compiles the fork's pairing driver, and it had been built before the
driver learned to announce an appliance: a simulated node would have been heard as a bridge. It is rebuilt from the fork as it is
(`592f7062`, 504 069 bytes), as [10 §8](10-simulator-and-tft.md) says to when a compiled driver changes. Two of the radio's tests were of
the driver before: one took a window of the third kind for an error, and one compared the whole announcement a scan hears, which has a field
more. Both follow the driver, and a third hears an appliance's window.

**The board** (`libs/nspanel-sim/vm/src/appliance.ts`) is the THR320D around the node's Berry of the repository: one Power on a latching
relay, the WTS01's temperature among Tasmota's sensors while the probe is plugged, `TempOffset`, the button detached from the relay and the
two LEDs. **The relay's contact is kept apart from what Tasmota believes**: it goes where the last pulse of a coil left it, through a
restart and a power cut. Three things of the simulator changed for it. A device says whether its relays are the room's circuits, which feed
the lamps of the house's networks: a panel's are, and an appliance's relay, which was taken for the panel's first, is not. Tasmota's sensors
are a host operation, empty on a device with none. And a restart tells the Berry drivers a moment before it happens, on every simulated
device, as Tasmota does when it saves its settings.

**The house test.** With the node's button held, the panel adds the appliance to its house from the glass, over the fork's own pairing; the
Hall's + has its row, Mesh device, and takes the one device the appliance is, with the range of its two limits; Heat and a target go to it
over the mesh, its relay follows the water, and the panel hears each; the probe unplugged opens the relay and says "No probe"; a limit set
from the panel moves the range the panel keeps. The device's buttons are not there until the panel has heard its node in step twice in a row,
the gate a bridge's devices have, and its page says "Device syncing" or "Device starting" meanwhile: the test waits for it, as the bridge's
does for its link.

**What reading Tasmota's restart found: the relay after a boot.** The thermostat opened the relay before a restart, and took what Tasmota
said of it at the boot. Tasmota copies the relay's state for the next boot before it tells its drivers of the restart (`SettingsSaveAll`), so
with the heater on when a restart was asked, an OTA's for one, the relay was opened and then closed again by Tasmota at the boot, before any
thermostat ran, and for good on a boot that comes up without Berry. Keeping no state for a restart ends that, and leaves another case: after
a crash Tasmota then takes the relay for open and pulses nothing, and a thermostat that takes its word has nothing to turn off while the
contact may be closed. The relay is opened at every
boot now, in three places ([02 §5](02-hardware.md)): the image keeps no relay state for a restart (`SetOption0 0`); a rule of Tasmota's own,
`ON System#Init DO Power1 0 ENDON`, pulses the off coil at every boot whatever its cause, with no Berry running; and the thermostat opens the
relay as it starts, whatever Tasmota believes. The simulated board has the first two as the image has them, and the test boots one with its
contact closed and Tasmota taking it for open.

**The app.** The simulator's house has the appliance beside the panel and the bridge, from its box, with its flash kept in the browser as
theirs is: its box has its button, held or pressed, its LED, whether its heater has power, the water at its probe and the probe unplugged;
the console and the log have it; and the House tab names the role of a node that is a device.

**For the bench.** That the relay clicks open at every boot of the board, a restart's and a power up's; that a restart asked with the heater
on does not close it at the boot; and the three earlier ones: which coil closes the relay, the second LED, and the display with the probe
unplugged.

**The image, measured** on the build of this change (`449b370/592f7062`), against `3ee439c/592f7062`: the THR320D's is 32 bytes larger.
The panel's and the bridge's were not built: nothing they compile changed.

| image | app partition | used | free |
|---|---|---|---|
| THR320D | 1 856 KB | 1 476 368 bytes | 414.2 KB |

## 2026-11-13 — A latching relay checked by the water, and a device's warning to every panel

**The question.** Does the THR320D measure the heater's power? It does not: its template has no pin of an energy chip, where the POW Elite's
has one and no probe socket. A meter would have said whether the relay is closed, which nothing else on the board does: the relay is a
latching one and Tasmota never reads its contact. What is left to tell it by is the water ([02 §5](02-hardware.md), [03 §3](03-architecture.md)).

**The off pulse, repeated.** While the logic has the relay open, the thermostat opens it again every minute. A pulse that did not take would
leave the heater on with nothing to say so; pulsing an open latching relay moves nothing.

**A contact stuck closed.** By day the water rises with the sun, and a rise says nothing. In the small hours there is no sun, and with the
heater off the water can only fall. The check is set in the thermostat's settings: its hours, midnight to five out of the box, and how far
the water has to fall in them, a degree. With the logic having kept the heater off the whole time, a warning is raised at the hours' end when
the water fell less than that, and at once when it rose a degree above the lowest it was in them, which only the heater does. Hours the logic
heated in, or with no reading of the probe, are not judged; hours judged fine end the warning; and the two hours made the same are no check.

**A heater that does not heat.** The first rule thought of, the heater on for a while and the water not up, would have fired at every shower:
hot water drawn takes more heat than the heater gives, and the water falls with the heater on. The rule is no rise at all, a degree above the
lowest the water was since the heater came on, for the minutes a setting says, two hours out of the box and 0 for no warning. A rise ends the
warning and starts the count again; a warning that holds when the heater goes off stays until the heater heats.

**The warning, to the house.** A warning is in the state's note, on the page's line ("Relay stuck?", "Not heating"), and in the node's
telemetry. And the node tells every panel of the house, each alone, whether the panel shows the device or not ([05 §4](05-the-house.md)): the
kind, whether it holds, the device's name. A panel keeps it as a notification of its own, the way it keeps the word of a node that left the
house, so it lights the house page's sign and is in the Notifications: "Boiler may be stuck on", "Boiler is not heating". One notification
while it holds, however often it is said; seen when the node says it holds no more; and the next time it holds is another. The panels' lists
are in RAM, so the node says all its warnings again, held or not, after its boot and every half hour: a panel that restarted has lost its
list, and one that was off when a warning ended still has it open.

**What none of it does** is open a contact that is stuck. The heater's own thermostat is what is left then, and it stays in place.

**The numbers are first guesses**, to set against what the thermostat's history shows of a night: how far this heater's water falls with
nobody using it. The rise that counts, a degree, is not a setting.

**The tests.** The thermostat's suite has the three checks (125 checks), the node's the warning to every panel and its saying again (80), the
panel alarm's the notification kept, not repeated, ended and raised again (264), and the panel thermostat's the message that brings it (205).
In the simulator's house, the heater on with the water still for the minute its setting was given is a notification on the panel by the
name the panel gave the device, and seen once the water rises.

**The images, measured** on the build of this change (`25f78c2/592f7062`): the panel's is 928 bytes larger than `3ee439c`'s, and the
THR320D's 4 016 bytes larger than `449b370`'s. The bridge's was not built: nothing it compiles changed.

| image | app partition | used | free |
|---|---|---|---|
| panel (US) | 2 176 KB | 2 072 864 bytes | 151.7 KB |
| THR320D | 1 856 KB | 1 480 384 bytes | 410.3 KB |
