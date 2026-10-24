# host-tests/espnow-mesh-driver

A test on the PC (no device) of the fork's ESP-NOW mesh driver,
`firmware/tasmota/tasmota/tasmota_xdrv_driver/xdrv_98_1_espnow_mesh.ino`, with its station (`xdrv_98_3_espnow_mesh_station.ino`) and its search
for the house (`xdrv_98_4_espnow_mesh_search.ino`). The `.ino` files are included as they are in `host_test.cpp`, over the stand-ins of
`host_stubs.h` for what they ask of the ESP-IDF (ESP-NOW, NVS, Wi-Fi), FreeRTOS, Tasmota and Berry, and their functions are called one by one,
on one thread. The mesh's core (`espnow_mesh_core.h`) and cipher (`espnow_mesh_crypto.h`) are the firmware's, with no stand-in. The C++ here is
only what is under test and its tests; what compiles and runs it is a Node script.

What the mesh is: [docs/04](../../../docs/04-the-mesh.md). The tests of the suites: [docs/13](../../../docs/13-testing.md).

## Command

From the repository's root:

```
node firmware/host-tests/espnow-mesh-driver/run.mjs
```

It compiles `host_test.cpp` with emscripten, runs the result with Node, and exits with 0 when every check passes (the last line says
`all <N> checks passed`). On a failure it shows each failed check and exits with 1. The first run also compiles the BearSSL units the cipher uses,
into `.build/` (ignored by git); the next ones only recompile the test, in a few seconds. `node scripts/verify.mjs mesh` runs it.

## What to install

- The official **Node.js** (the same as the simulator's: [`libs/nspanel-sim`](../../../libs/nspanel-sim/README.md)).
- The **emscripten SDK** (<https://emscripten.org>), found as the simulator's build finds it: the folder `EMSDK` names, or the `tools/emsdk`
  folder beside the repository. It needs `upstream/emscripten/emcc` and `em++`; the SDK's own Python and Node are used when they are in it
  (`EMSDK_PYTHON` changes the Python).
- The **submodule** `firmware/tasmota` checked out (`git submodule update --init firmware/tasmota`). The paths to the driver, the core and
  BearSSL are relative to the repository's root; nothing here points outside it.

## What is here

```
run.mjs           compiles and runs; the only command
host_stubs.h      the stand-ins: ESP-NOW, NVS, FreeRTOS, Wi-Fi, Berry, the log and the clock
host_test.cpp     includes the driver, keeps the count of the checks, and the main
tests_queues.h    the test world (the driver and a peer with its own core), the application ready, the queues to the loop, the sends'
                  tickets, Berry
tests_radio.h     the table of peers, the radio's late word, the failures, the pairing's hooks, the status and the statistics, the radio's
                  lock, the stop
tests_peers.h     the peer that leaves when the table is full (a neighbour that is someone's only way never leaves), EspNowMeshHealth and
                  espnow_mesh_health()
tests_counter.h   the end of the frame counter: the core asks for the next epoch, the loop restarts the mesh
tests_clock.h     the mesh's clock: what the heartbeat carries, the events to the rules, the clock the main loop reads, the stamp and the age,
                  EspNowMeshClock, espnow_mesh_neighbors() and the order between the event and the clock
tests_key.h       the change of the network key: the command (the same key renames, another is a change, a second is refused), the record of
                  version 4 and the previous key in flash, the hours and the close, the restart, what the node lets through under the previous
                  key (within 120 s and after), the node that missed the change, and Berry's fifth argument
tests_pages.h     the lists the commands answer in pages (EspNowMeshNeighbors, EspNowMeshHealth, EspNowMeshClock): 48 neighbours with
                  32 bytes of information each, every page JSON within the 1 040 characters of a message, and `Next` from one to the next
tests_station.h   the station that keeps to the mesh's channel (the access point off the channel left, the node alone, the parking on a
                  network not found, the search of the mesh's channel and of every channel, spread by the radio address) and the search
                  for the house on the other channels (the silent node that searches, the mesh's channel heard last, nothing found, and who
                  has the radio before it)
inc/              empty headers that only let `#include <esp_now.h>` and the others resolve
```

`host_test.cpp` also covers the record saved in NVS (versions 1 to 4, the chip's address, the clone that loses its node number), the epoch
that goes to flash and is checked before the task starts, and the size of the answers against the 1 040 bytes of a Tasmota message.

## Adding a test

A function `static void test_<subject>(void)` in one of the `tests_*.h` (or a new one, included in `host_test.cpp`), with
`CHECK(condition, "what it asserts")`, and its call in `host_test.cpp`'s `main`. `make_world(true)` brings the driver up (node 3, with a peer
of its own core, node 2); `turn()` is one turn of the task and `air()` carries the frames from one to the other. A test ends with `end_world()`.

## What this does not prove

The real radio, FreeRTOS's scheduling, the time the flash takes, the device's stack and heap: those are the bench's. A test that passes here
says the driver's logic does what the code says, with the stand-ins it was given.
