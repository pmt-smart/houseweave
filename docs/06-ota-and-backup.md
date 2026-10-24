# 06 — OTA and backup

Every node of the house (a panel or a bridge) takes its firmware from the **house's server** and keeps its backup there. The server is the
HouseWeave add-on in Home Assistant, or the same program on a PC ([07](07-home-assistant.md)). It is optional in the strict sense: a house runs
without it, and it only adds updates and backups. A node that cannot reach the server over the network is reached **through another node,
over the mesh**, for both.

## 1. The pieces

- **Signed releases**, made by `scripts/ota-release.mjs` on the PC that builds ([11 §7](11-build-and-flash.md)), with the house's Ed25519
  key, kept outside the repository. The public half is compiled into the app and the safeboot, which check every image before writing it or
  switching to it.
- **The house's safeboot** ([11 §6](11-build-and-flash.md)), in every factory image: it takes an app image over HTTP from the server or over
  ESP-NOW from a neighbour, and on a panel shows its progress on the screen.
- **The OTA driver of the app** (`USE_ESPNOW_OTA`, in the fork): it hears the neighbours that are in their safeboot, sends an image to one,
  installs the house's safeboot, and puts its own device into the safeboot.
- **The OTA row** of every node's Wireless settings, on any panel of the house (`berry/node_ota.be`), and the **House tab** of the server's app.
- **The server** (`ha/houseweave/server/`): the releases, the backups, the nightly round, and the relay to the nodes it cannot reach.

## 2. A release

A release is a folder the server serves under `/ota`: each app image cut into 64 KB blocks, each block compressed on its own as a raw deflate
stream (the ESP32's ROM inflates it, and a power cut costs at most one block), with a manifest; the safeboot image, signed; and `index.json`, which
says for each image (the env of the build, which every device knows as `PanelBuild.IMAGE`) its build, date, size, folder and SHA-256.

The signed record is 39 bytes: the image's size, its number of blocks, the block size and its SHA-256. The offer that goes over the mesh is the
record and its 64-byte signature, 103 bytes. A file that goes whole over HTTP (a panel's `.tft` or `.jsonl`) has its own signed record with zero
blocks. A file whose signature does not check is worth nothing, whichever way it came. A new key comes as a second public key in a release the old
key signs, before the old one goes.

## 3. The safeboot

The house's safeboot is Tasmota's own safeboot, built by our env (`tasmota32-houseweave-safeboot`) without Ethernet and without TLS, with two
drivers of the fork:

- **The receiver** (`USE_ESPNOW_OTA_RECEIVER`). It checks the offer's signature before the first block, writes the blocks as they come, asks again
  for a piece that did not arrive, keeps the last block written in the NVS (a power cut resumes from the next one, and another neighbour can take
  over), and at the end reads the whole image back from flash and checks its SHA-256 before the device boots it. Every frame carries an 8-byte tag
  (an HMAC under a key derived from the house's network key), and the node announces itself to all, every 2 s: its state, the image and the block.
  225 bytes of image fit in a 250-byte frame, so a panel's image is about 5 300 frames.
- **The HTTP path**: armed with a release's address, the safeboot downloads the manifest, takes it as a neighbour's offer, and downloads the blocks
  in 8 KB pieces with a `Range`, resuming from the block kept after a restart. A release that does not come in 10 tries, or a Wi-Fi that does not
  come up in 30 s, leaves the image to the mesh.
- **The Wi-Fi on the house's channel.** A node with no reachable access point would search for one all the time, and every try sweeps all the
  channels, off the mesh's. The receiver parks the station on the house's channel (the one in the mesh's record) when the app armed it for the
  mesh, when a transfer is half done, or when the Wi-Fi did not connect in 30 s; a station connected on the house's channel stays as it is.
- **The way out.** Three starts in a row that do not reach 30 s send the device back to its app, when the app's partition holds a whole image.
  A node armed for the mesh that nobody offers an image to goes back to its app after 10 minutes (`ESPNOW_OTA_WAIT_S`); once it took an offer, the
  app is being overwritten, and it waits for the image. The buttons of a device of a house do nothing in the safeboot.
- **The panel's page** (`USE_ESPNOW_OTA_DISPLAY`, only on a device whose template is the NSPanel's): the safeboot draws the `.tft`'s `safeboot`
  page over the screen's serial line, in three states. **Updating**: locked, the node's name, the percentage, a bar, the block ("Block 15 of 31"),
  who sends ("From B-Kitchen, over the mesh"), and "Keep the power on". **Waiting**: "Waiting for its firmware", with **Open hotspot** and
  **Restart**. **Hotspot open**: the network's name, `192.168.4.1` and a QR code, with **Close hotspot** and **Restart**. Restart boots the app
  when its partition holds a whole image, and the safeboot otherwise. The page's components have fixed names (`t0` to `t11`, `qCode9`, `bRow12`,
  `bRow13`), the same in every theme and layout, since the safeboot has no Berry and no manifest; `libs/nspanel-sim/export/test/safebootPage.test.mjs`
  holds them.

The receiver and the sender have a host test, `firmware/host-tests/espnow-ota-receiver` (the signature against RFC 8032's first vector, the
announce, the parked station, the offers refused, pieces out of order, a power cut in a block and the resume by another neighbour, a block that
does not inflate, an image that is not the signed one, the HTTP path, the app's way into the safeboot, and an end-to-end run of the release tool,
a C sender, a simulated radio and the C receiver).

## 4. Upgrading a node

**The Upgrade** comes from the node's OTA row (asked first) or from the House tab (a node, or all of them, asked first). The OTA row shows the
server, the firmware that runs, and what the server has for this image: "Up to date", "None for it", or Upgrade to the newer build. It reads the
index when it opens, if what it saw is older than 5 minutes, and again at a touch.

1. **A node that reaches the server** runs `EspNowOtaUpgrade <release> <safeboot>`: it checks the release's signature and that it fits the
   partition, installs the house's safeboot when the partition does not hold the signed one (`EspNowOtaSafeboot`: download, check the signature,
   compute the SHA-256 in a first pass **before erasing anything**, write, read back, compare, and let the bootloader verify the image; the app
   keeps running in any case), leaves the release's address in the NVS, and restarts into the safeboot, which downloads it over HTTP.
2. **A node the server cannot reach directly** (behind another router) gets the request through another node (§6), and then reaches the
   server itself for the release.
3. **A node with no Wi-Fi at all** asks a neighbour it hears on the radio and that sits on an access point (the best signal first) for its
   release (`MSG_OTA_ASK`, with its image and build). The neighbour looks at the index: with a newer build it says it will send (`MSG_OTA_GO`)
   and keeps the node for 9 minutes; with no release, the same build, or no server, it says why (`MSG_OTA_NO`), and the node asks the next one
   (or one that does not answer in 15 s). With the GO, the node arms itself (`EspNowOtaArm`) and restarts into the safeboot; the neighbour sends
   (`EspNowOtaSend`) when it hears the node waiting there, again 30 s after a send that ended with the node still there, and forgets it when it
   leaves. The neighbour fetches the blocks from the server 2 KB at a time (a panel's heap cannot hold a 64 KB block); a piece with no answer in
   250 ms goes again, and 24 in a row with no answer end the send.

**`EspNowOtaArm` only restarts into a known safeboot**: the one the build pinned, or one an install checked and recorded in the NVS, read back
whole. Tasmota's official safeboot has no receiver, and a node with no Wi-Fi armed into it would be out of reach.

**A node left waiting in its safeboot is rescued by a neighbour.** The safeboot gives up a release after 10 failed downloads and waits for the
mesh. Every node keeps, for each node it hears in the safeboot, its state, block, image (a prefix of its SHA-256), signal and the time of its last
change. A neighbour with Wi-Fi that sees such a node stalled for 90 s, plus 1 s for every dB of its signal to it (a neighbour hearing it at
-59 dBm waits 90 + 59 s, so the best-placed one starts first), looks for that image's release in the index and sends it; a neighbour that sees the
block move again does not start. A node is looked for again
after 5 minutes, and an index that could not be read is tried again in 30 s.

**A panel's order** is the program first: the new app boots with the old screen files (a field missing from the `.jsonl` is `nil`, tested at
every version); then the `.jsonl` and the `.tft`, each checked by its SHA-256; then a restart, in which the brain flashes the new screen. An app
that does not arrive leaves the panel with the old program and the old files, which match.

## 5. The whole house sees a node in its safeboot

A node in its safeboot has no mesh, and only its announce reaches its neighbours. Whoever hears it says so in its own **presence** (`MSG_HERE`,
the flood every node sends every 10 s on a bridge and 30 s on a panel): up to 8 nodes heard in the safeboot, each with its number, state and the
percentage written, 3 bytes. A node that enters or leaves the safeboot makes whoever hears it send its presence at once. Every node keeps what the
presences say for 2.5 periods of whoever said it, so the mesh page of a panel far from the node shows the same thing: "Safeboot 47%" while it
receives, "Safeboot" while it waits, "Safeboot, failed" when the image failed. The node's own presence, back, takes it out of that at once.

## 6. The server in the house

**Pairing.** On a panel, the mesh page's + has **Add server**: the panel shows a 6-digit code and its address for 2 minutes. On the server's
Settings, **Pair with a house** takes the panel's address and the code. The server posts its key, address, port, name and a nonce to the panel's
`/houseweave/pair`, with their HMAC-SHA256 under the code; the panel checks it, writes the server into the house's list, and answers with the server's
number, the house's name and the mesh's nodes, under an HMAC with the code too. The code never travels; three wrong codes close the window, and so
does the right one. The server becomes a member of the list (`ROLE_SERVER`, `berry/house_list.be`): it has a number and an identity, but no
radio, so it is not a node of the mesh, and striking it off does not change the house's key, which it never had.

**Signed requests, both ways.** Each node and the server share a **pair key**, derived by the mesh driver (`espnow_mesh_pair_key`: HKDF-SHA256,
salt "houseweave-server", info "http", over the X25519 of the node's secret and the server's public key from the list). Every request of a node
to the server carries `X-HouseWeave-Node`, `X-HouseWeave-Time` and `X-HouseWeave-Mac`, the HMAC of "method|path|time|SHA-256 of the body";
every request of the server to a node (`POST /houseweave/do`) is checked by the HMAC of "houseweave-do|verb|time|node|nonce", within 10
minutes, each nonce once. The verbs are `backup`, `upgrade`, `restore`, `state`, `round` and `relay`. A node signs nothing before its clock has
the network's time.

**The hello.** A node introduces itself (`POST /api/hello`) when it boots, after a backup and after an upgrade; a panel adds the house's nodes,
with their keys and radio addresses, again when the list changes. That is how the server learns a node's address. A hello the server refuses is
said again 10 minutes later; one that does not reach it is said again after 30 s, doubling up to 10 minutes. A hello carried over the mesh gives
the server no address (it came from a neighbour), so a node with Wi-Fi whose boot hello went over the mesh says it again over the Wi-Fi once that
is up. Nothing goes to the server before the Wi-Fi is up.

**The relay.** A node the server cannot reach at its address gets the request through another node, the one the server reached last (two at
most): the server sends that node the verb `relay`, with `to` (the node) and `req` (the request for the node, signed for it, with the same
nonce). The node in the middle sends `req` over the mesh (`MSG_DO`) and says "Sent"; the destination answers as if the request had come to its own
`/houseweave/do`, and sends the answer back in pieces (`MSG_DONE`), signed with its own pair key, so the node in the middle can neither forge nor change
it; the node in the middle posts it to the server (`POST /api/relayed`). A request is the same, with one nonce, at the node's address and through
each neighbour; the server waits for the answer from any of them, and passes on to the next neighbour when one stays silent. A node keeps the
nonces of its last 16 requests, runs each once and answers "again" to a repeat (done, the answer lost), after which the server asks for its state;
it writes them to `persist` before a `restore` or an `upgrade`, the two verbs that restart it.

**A node with no Wi-Fi** reaches the server through a neighbour that sits on an access point (`berry/mesh_http.be`): its signed request goes whole
over the mesh, in pieces (`MSG_HTTP_REQ`), to the neighbour with the best signal, which makes it to the server as it came, with its own number in
`X-HouseWeave-Via`, and brings the answer back the same way (`MSG_HTTP_ANS`). Missing pieces are asked for again (`MSG_HTTP_MISS`); a neighbour carries
one request at a time and answers 503 with the reason when it is busy, has no server or no heap; a request with no answer in 60 s ends in "No
answer".

## 7. Backups

**What goes**, one path for every node (`berry/node_backup.be`):

- **a panel**: its configuration (plans, zones, devices, names), its texts and its preferences, without the pattern lock (`berry/panel_backup.be`);
- **a bridge**: its devices' names, the alarm, the drivers and the discovery (`berry/bridge_backup.be`);
- **and every node's Tasmota settings** (the whole `/.settings` block, 4 096 bytes: the Wi-Fi and its password, MQTT, the time zone, the template,
  the SetOptions), **sealed with a key derived from the house's key** (`berry/node_settings.be`; AES-128-CCM in the mesh driver,
  `espnow_mesh_group_seal`/`espnow_mesh_group_open`, HKDF-SHA256 from the house's key, a random 12-byte nonce, the label as associated data, a
  16-byte tag). Any node of the house could open it, the server and Home Assistant cannot, and the server hands each node only its own backup;
- **never the house's key** itself, which every node has and a new node receives when it joins.

**When.** Nothing periodic during the day: one **round a night**, at the house's hour (02:00 by default, changed on the server's Settings). The
server calls each node, 5 s apart, and the node backs up **only if something changed** since the last backup: a panel marks a change "Not saved";
a bridge compares the SHA-256 of what it keeps with its last backup's. The fingerprint of the Tasmota settings leaves out what Tasmota changes by
itself (the save and boot counters, the checksums, the relays' state, the save time) and includes the house key's version, so a key change backs
everyone up again. A node that did not answer is called once more a minute after the last. **Back up now** on a node, and Backup on the House tab
(a node or all), do it at once.

**Where.** In the server's data folder, which it does not serve (`backups/<radio address>.json`); they are read only through its API.

**Restore** brings a node's own backup back, from the node's screen or the House tab; it is never sent to all nodes at once. The Tasmota settings
are opened, checked (size and header) and written last, and the node restarts with `Restart 99`, which does not write the settings in memory over
them. Settings sealed with a key the node no longer has stay as they are, and the rest comes back. A panel takes only its room's backup, by the
project it runs; a panel flashed with the firmware before HouseWeave's keeps that firmware's project name through an OTA (`p1-casa-sala-*` for
`p1-living-room-*`), so either name is the same room (`PanelBackup.FORMER`).

**A hardware swap**: the new device joins the house as any node; on the House tab, the backup of the one that left has **Give to...**, with a node
of the same kind (a panel's to a panel, a bridge's to a bridge) and a confirmation. The server sends the new node `restore`, and gives it the old
backup with `"for"` and the new node's name (a node refuses another's backup otherwise); the new node restarts with the old one's configuration and
settings, "Not saved" until its first backup ends the swap. The new node's own backup stays, and its **Restore** undoes a mistaken swap.

**A bridge swap keeps the new bridge's own Zigbee network.** A coordinator's network does not follow to another coordinator (not even with the old
coordinator's IEEE address and frame counter put into the new chip), so the restore of a swap brings the old bridge's settings **less the 28 bytes
of the Zigbee network** (the extended PAN, the key, the PAN, the channel and the radio power): the devices are paired again on the new bridge, and
each comes back with its old name, since names go by the device's IEEE address. A bridge's restore of its own backup brings everything.

## 8. Where it is tested

- the safeboot's receiver and the app's sender: `firmware/host-tests/espnow-ota-receiver`;
- the node's side: `berry/test/test_node_ota.be`, `berry/test/test_server_link.be`, `berry/test/test_mesh_http.be`, `berry/test/test_panel_backup.be`,
  `berry/test/test_bridge_backup.be`, `berry/test/test_house_server.be`, in both VMs;
- the server: `libs/nspanel-sim/vm/test/house-fleet.test.mjs` (SHA-256, HMAC and HKDF against `node:crypto`, the two signatures fixed as the node
  makes them, the requests, the backups, the round, the relay and the swaps) and `libs/nspanel-sim/vm/test/house-pairing.test.mjs`;
- the house end to end in the simulator: `libs/nspanel-sim/vm/test/house.test.mjs` (a server paired on a panel as a person pairs it, the round,
  Back up now, the restore, a bridge with no Wi-Fi that says its hello and makes its backup through a panel).

The mesh's radio, the real timing and heap, and an image actually written by a neighbour are the bench's ([13](13-testing.md)).
