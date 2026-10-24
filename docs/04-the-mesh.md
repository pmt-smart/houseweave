# 04 — The mesh

The house's nodes (every panel and every bridge) talk to each other over an **ESP-NOW mesh**: frames from radio to radio, with no router in the
middle, on one fixed Wi-Fi channel. The mesh is the house's only bond between rooms, and it works with the Wi-Fi down. The mesh's core is C++
in the fork (`tasmota/include/espnow_mesh_core.h`, `espnow_mesh_crypto.h`), driven by a Tasmota driver (`xdrv_98_1_espnow_mesh.ino`, behind
`USE_ESPNOW_MESH`, in every image); the house's layer over it is Berry ([05](05-the-house.md)), and Berry's view of the driver is in
[12 §6](12-berry-notes.md).

The mesh is designed for **32 nodes** (about 15 panels and 15 bridges in one network, with no border bridge between zones, which would be one
more single point of failure); its tables hold 48.

## 1. The radio and the channel

- **One channel for the whole house.** ESP-NOW nodes hear each other only on the same channel. The **house's channel** is a field of the house's
  list (`berry/house_channel.be`), which every node writes to the driver (`EspNowMeshChannel`); a change of channel takes effect at one instant of
  the mesh's clock, for all nodes together. The Wi-Fi access points of the house's device network sit on that channel, fixed, at 20 MHz, 2.4 GHz
  only, with client isolation off. The channel is chosen with the Zigbee plan: 1 or 11, never 6, so the rooms' Zigbee channels keep their
  distance.
- **The station keeps to the house's channel.** A node whose station is associated with an access point on another channel would leave the
  mesh, so a node that has other nodes in its table only stays on an access point of the house's channel, and leaves (and shows on the mesh
  page) one that is not. Tasmota's own reconnection sweeps all 13 channels at every try, and restarts the device after a hundred rounds; the
  fork's station driver (`xdrv_98_3_espnow_mesh_station.ino`) keeps Tasmota's loop out through a hook in `WifiCheckIp`, **parks** the station on
  the house's channel the moment it loses its access point, probes only that channel with a growing interval (10 s, 30 s, 60 s), and every
  10 minutes, at its own instant, does one wide search that only joins on the house's channel. No restart for lack of network.
- **A node that hears none of its own for 60 s looks for the house on the other channels** (`xdrv_98_4_espnow_mesh_search.ino`): one that was off
  during a channel change finds the house by itself.
- **No radio sleep.** A radio that sleeps between beacons loses ESP-NOW frames, and the broadcast ones nobody repeats. Panels run `Sleep 0`;
  bridges get `SetOption127 1` (Wi-Fi without sleep) and `Sleep 0` (the loop without its 50 ms sleep, which delayed the mesh's events) from their
  template. No image scans for another access point every 44 minutes (`WIFI_SCAN_REGULARLY false`): that scan sweeps all channels and takes the
  radio off the mesh for 1 to 2 s.
- **ESP-NOW peers.** ESP-NOW takes 20 peers a device. A node registers as peers the neighbours it sends unicast to, and the broadcast address,
  unencrypted, on channel 0 (the radio's current channel). When the table is full, the least useful peer leaves: first the ones it no longer
  hears or counts on, then the redundant ones, the least recently used in each group; **a neighbour that is someone's only way never leaves**, nor
  one used in the last 3 s. The rate is the default 1 Mbps: a full frame takes about 2.8 ms of air, a 60-byte one about 1.3 ms.

## 2. The frame

Every mesh frame is binary, inside ESP-NOW's 250 bytes. A 14-byte header (`version`, `kind`, `origin`, `dest` (255 for all), `next` (the next
hop of a routed frame, 0 in a flood), `hops` (the repeats left), `epoch` (4) and `counter` (4)), then the payload, and at the end the
**envelope tag**, 8 bytes: an HMAC-SHA256 with the house's group key over the header and the payload, which every node checks before repeating, so
that nobody outside can make the mesh repeat garbage. `next` and `hops` change at every hop and are zeroed in what the tags cover: the origin's tag
holds end to end.

- A frame **for one node** has its payload encrypted and authenticated with the **pair key** of origin and destination (AES-128-CCM, 8 more bytes
  of tag, which only the destination checks). A frame **for all** has its payload encrypted with the group key (AES-128-CTR), and the envelope's
  tag authenticates it. The AES is BearSSL's constant-time one. **228 bytes of payload for all, 220 for one node**; what does not fit goes in two
  parts, each with its own counter.
- `origin`, `epoch` and `counter` are **the message's number**: what discards a repeated copy, what stops a replay, and what a resend reuses, with
  the attempt beside it. It is also the cipher's nonce, so it is never used twice (§4).
- What the group key does not give: in a frame for all, the origin is vouched for only by holding the key, so a node of the house could forge a
  state in another's name. Commands between nodes are frames for one node, under a pair key nobody else has.

## 3. Identity and keys

- **Each node makes its own X25519 key pair on its first boot**, kept in the NVS, never in a file: the public key is its identity. It is **tied to
  the chip**: the NVS records the radio address it was born with, and a flash copied to another chip remakes its identity and epoch, **clears its
  node number** and comes up with the mesh off, like a factory device, until whoever replicates gives `EspNowMeshId <n>`, `EspNowMeshEnable 1` and
  `EspNowMeshReady 1`. Two nodes with the same number can no longer be born of a clone.
- **The pair key** between two nodes is the X25519 agreement of their identities, through HKDF with both identities as salt, made once per pair
  and kept in RAM (a table of 48 entries).
- **The group key** of the whole house, with a version number, authenticates every envelope and encrypts the frames for all. It changes when a
  node is struck off the house ([05](05-the-house.md)). The driver keeps **two slots**, the current key and the previous one: for 120 s after a change
  a frame under the previous key counts as one under the current (convergence); after that, until the change closes, only the heartbeat (taken as
  a sign of life, without its application bytes or clock), the sync exchange, and the members frame that delivers the new key to that node are
  taken under the previous key; the rest is dropped and counted. A change closes when every node not struck off has said the new version, by hand,
  or after 30 days of uptime of whoever keeps the previous; a second change waits for the first, unless a node is struck off. The heartbeat carries
  the key version a node uses, and a "I need the key" bit.

## 4. Against replay

Every node keeps an **epoch** in the NVS, drawn on its first boot and **raised at every boot** (one write a boot), and numbers its frames within it.
A receiver keeps, per origin identity, the highest epoch and number accepted, and **a window of 32 numbers** behind the highest with a bit for each
one seen: a frame that arrives out of order by another path is not taken for a repeat. A lower epoch is refused; a higher epoch the node did not
see begin puts the origin back to "not synced".

**After a boot, a node knows nobody**, so every origin starts unsynced: the node asks everyone with a drawn nonce, each origin answers under the pair
key with its current epoch and number, authenticated with the nonce, and only then are its frames taken. When **the whole house powers up at once**
the asks grow towards N², so each node waits before asking **300 ms times its number (32 slots), plus a draw of up to 250 ms**, and answers go out
at **8 a second** at most; what got no answer is asked again with a backoff from 1 s, doubling up to 16 times. In the simulator a 32-node house knows
99% of its pairs in about 17 s and all of them in about 28 s, under 56% of air at the peak.

**The counter never wraps.** Past `0xFFFF0000` the node takes the next epoch: the driver restarts the mesh within a second under it (the new epoch
written and read back before any frame goes), and numbering starts again at 1. `0xFFFFFFFF` and the wrap to 0 are never used. At 5 frames a second
that end is 27 years away; it exists so that the nonce rule holds.

## 5. How a frame travels

### 5.1 Flooding

What is for all (the state, the events, the house's frames) goes **by flooding**: the origin broadcasts, and every node that hears a frame not for
it, with `hops` above 0 and a number it has not seen, repeats it once, with one hop less. Three rules against the storm:

- **A delay before repeating, set by the signal it was heard with**: who heard it weakly (farther away) repeats first, in 0 to 3 ms; who heard it
  strongly waits 3 to 8 ms, and usually hears a repeat in that time and gives up.
- **Do not repeat what was already heard twice** before the delay ended, **unless this node is someone's only way**: a neighbour of it that neither
  sender heard reaches, by the two-hop neighbourhood of the heartbeats (§6).
- **5 repeats** (`kMaxHops`), six radio hops. The diameter of a house of rooms of 14 to 40 nodes is 3 to 4 hops; a long corridor needs a repeater
  (an ESP32 with our image in a socket).

**Who repeats, in the manner of OLSR.** At every heartbeat, a node with 10 or more neighbours it counts on chooses **who repeats for it**: the
smallest set of neighbours that together list every node two hops away (the multipoint relays of RFC 3626), first the ones that are the only one
to list some two-hop node, then the ones that cover the most of the rest, keeping last time's choice on a tie so it does not oscillate. The choice
travels as an optional annex of the heartbeat, outside its 32 application bytes; a node that does not know the annex ignores it. A flood heard from a
neighbour that **chose this node** is repeated as above; one heard from a neighbour that chose others waits **30 ms more** (plus a draw of 0 to 7
ms) so the chosen go first, and gives up only at the third copy, or repeats anyway if it is someone's only way. In the simulator, delivery was never
worse than plain flooding, and the frames a flood costs fall by about a third at 30 and 40 nodes; with 14 nodes nothing changes, since no node has
10 neighbours. `-DESPNOW_MESH_CHOOSE_RELAYS=0` turns it off.

### 5.2 Routed unicast

A frame for one node, and its confirmation, goes **in unicast to the best next hop**: the destination itself when it is a neighbour counted on; the
neighbour that lists it and delivers best; or the way back (the neighbour each node remembers hearing the first copy of a frame from). Each hop has
the radio's own confirmation and resend; with no way, or a hop that fails three times, the frame goes flooded, and a resend for lack of an answer
goes flooded too. **The choice learns from the frames**: a neighbour that fewer than half of this node's last unicasts reached is no way for a
minute, and a two-hop route scores the worse of its two deliveries. In the simulator, routed unicast takes half to a quarter of the frames of
flooding, and the 95th percentile from command to answer went from 11 to 6.7 ms.

**Lists** (a bridge's devices, a large answer) go **in pieces** along the way back: a piece carries the list's number, its place and the total, up to
200 bytes, a list up to 32 pieces. The destination remembers which pieces it has, asks for what is missing with a mask after 300 ms without a new
piece (three times), and says when it has them all.

### 5.3 The task

ESP-NOW's receive callback runs in the Wi-Fi task, where nothing may take long, and Tasmota's main loop moves at the pace of its sleep. So the mesh
has **its own FreeRTOS task**, with a receive queue, that checks the envelope, discards copies, repeats what is for others and hands the loop only
what is for this node. It **serialises the sends**, one `esp_now_send` at a time waiting for the previous result (in a burst the IDF returns
`ESP_ERR_ESPNOW_NO_MEM` and the frame is dropped silently), and every send passes through it, Berry's too, since the counter has one writer. The task
reads its receive queue between its sends, so a burst out does not starve what comes in. A hop costs the air (about 3 ms) plus the delay by signal.

### 5.4 Confirmation and resend

A command to another node asks for a confirmation, and **the owner answers "received" as soon as the frame arrives**, before running it. With no
answer in 100 ms, the sender sends the same frame, same number, one attempt more, up to twice more (300 ms in all); the destination runs a number
**once** and answers every attempt. A command with no "received" after three tries becomes "?" on the glass and a log line on both nodes, never a
silent error. The application learns each send's fate from the `Outcome` event, by the token `espnow_mesh_send` returned.

## 6. Supervision

**The heartbeat.** Every node broadcasts a heartbeat **every 5 s** (plus a draw of 0 to 0.5 s; the first at a drawn instant in the first 5 s, so a
house that powers up together does not speak together), not repeated, under the group key, with **32 application bytes** and **the neighbours it
heard in the last 15 s, with the signal of each** (2 bytes a neighbour; with 31 neighbours the frame is about 120 bytes). So every node knows its
two-hop neighbourhood, and a node notices an **asymmetric link** (a neighbour that hears it but that it does not hear back), which then does not
count as a way.

The 32 application bytes have owners ([12 §6](12-berry-notes.md)): the core writes byte 0 (the layout), the timeline (1 to 5) and the mesh time
(6 to 11), and the "synced" bit; the alarm's replica writes its part (up to byte 19); the house writes its digest of the list, its node's key prefix
and the state sequence; the core writes the key version and bits. The core cuts at 32 what it receives, so the format grows by annex without
breaking older nodes.

**Silent nodes.** A neighbour not heard for 15 s (plus a draw of 0 to 2 s) is **suspect**: the node tests it with a unicast (its radio confirms
without its software); if the radio does not confirm, it asks two neighbours that hear it, and hear it back, to test it; with no answer from any in
10 s it declares it **silent** to all, and whoever was still testing adopts the verdict. A silent node that comes back is said back. Only then do its
devices show "?" on the panels, and the alarm records it. It is SWIM's idea: a bad link between two does not condemn the third.

**Link quality is measured by delivery**, not by the signal: each node counts how many of each neighbour's heartbeats arrive, a bit per interval
over a **window of 16 intervals** (about 84 s), and a neighbour is **usable** when it was heard recently, hears this node back, and delivers at least
**50%** (or is not judged yet). Only what arrived by radio counts. Usable neighbours are what relay choice and peer eviction use.

**Noise is an event.** Every node counts, per minute, the heartbeats of strong neighbours that did not arrive, the unicasts the radio did not
confirm and the answers that did not come back; above 35% for two minutes in a row the channel is busy, said to all; below 17% it is calm again.

**The health report** (`EspNowMeshHealth`, and `espnow_mesh_health()` in Berry) is computed from what the neighbours' heartbeats already carry and
sends nothing: the usable neighbours, the weak ones, the two-hop nodes, the **branches** the neighbours fall into (grouped when they list each other
or a common two-hop node), and the neighbours that are **the only way** to some node. More than one branch means that if this node disappeared those
neighbours would lose each other, unless by a longer way it cannot see: a node that really cuts the network always shows more than one branch, but a
ring of 5 or more shows two branches at every node with no single point of failure. The exact answer for the whole house comes from joining every
node's report into a graph and finding its articulation points (`healthGraph` and `articulationPoints` in `libs/nspanel-sim/vm/src/mesh.ts`). A node
that is a single point of failure gets a repeater.

## 7. The mesh's clock

The mesh has **a relative timeline, not a wall clock**. Each node counts its own time since its mesh started (Tasmota's millisecond counter,
accumulated in 64 bits), and **a node that meets a node whose timeline is older adopts it**, adding the difference, and becomes synced; on a tie
within 20 ms, the node with the larger identifier adopts the smaller. A node's time **never goes back**: adopting moves the clock by
`max(difference, 0)`, and a timeline that is up to 100 ms behind and has a smaller identifier is taken at the third heartbeat in a row from the same
neighbour, so two nodes that came up almost together do not oscillate. Every mesh start (also `EspNowMeshEnable 0` then `1`) is a new timeline
with the clock at 0. The error between two nodes is the crystals' drift (10 to 40 ppm: under 150 ms an hour apart) plus a few ms a hop.

A node is **synced** when it has adopted a timeline, or has listened for 10 s from its first ask without finding one older (the house's oldest).
The bit goes in its heartbeat. The timeline serves the alarm's replica, the age of a command, and the sync gate: **no device is acted on from the
network by a bridge that is not synced** ([05](05-the-house.md)). The wall clock (NTP, or what a person types) is for the screen, the schedule and
the sunrise, and nothing of the mesh depends on it.

A command carries a **stamp** of 6 bytes, the sender's timeline tag and its mesh time in 10 ms ticks, and the owner refuses it when its age at the
moment of running is past the window (3 s, 1 s for the alarm's words) or more than 250 ms in the future ([12 §6](12-berry-notes.md), `MeshCmd`).

## 8. A second path over the network

The core can also carry the same frames over UDP on the house's network, to the address a node's heartbeat says, as a reserve for nodes the radio
cannot reach. Nothing in the product turns it on (`EspNowMeshNetwork` stays 0): it is there for islands with Wi-Fi, and the bench has to explain its
behaviour before anyone counts on it.

## 9. Commands and numbers

| | |
|---|---|
| nodes designed for / table size | 32 / 48 |
| payload | 228 bytes to all, 220 to one node |
| hops | 5 repeats |
| heartbeat | every 5 s, 32 application bytes, neighbours listed if heard in the last 15 s |
| suspect / silent | 15 s (+0–2 s) / 10 s after |
| link quality window | 16 heartbeat intervals, usable at ≥ 50% |
| cold start | 300 ms a node number, +0–250 ms, answers at ≤ 8/s |
| command resend | 100 ms, up to 3 tries |

The console has the driver's commands for the bench: `EspNowMeshStatus`, `EspNowMeshStats`, `EspNowMeshNeighbors`, `EspNowMeshHealth`,
`EspNowMeshClock` (lists in pages that fit one Tasmota answer, with a `Next` when more remain), and the configuration ones (`EspNowMeshId`,
`EspNowMeshEnable`, `EspNowMeshReady`, `EspNowMeshChannel`, `EspNowMeshGroupKey`, `EspNowMeshKeyClose`, `EspNowMeshNode`, `EspNowMeshLeave 1`).

The driver has its own host test (`firmware/host-tests/espnow-mesh-driver`), and the simulator runs the core and the driver in simulated devices
and houses (`libs/nspanel-sim/vm/test/mesh*.test.mjs`): the scale study, the cold start, relay choice, the counter's end, the key change, the
health report, the clock. What only real radios say is the bench's ([13](13-testing.md)).
