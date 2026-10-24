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
