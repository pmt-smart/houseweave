# 13 — Testing

There is no CI. **`node scripts/verify.mjs` is the gate**: every commit that touches code, and anything written to a device, passes it first.
What a machine can prove runs there, on two Berry VMs, the simulator's devices and the drivers compiled on the PC; what only a device can
answer (the radio, the screen's handshake, physical timing, the real heap) is the bench's.

## 1. The gate

```bash
node scripts/verify.mjs
```

| step | what it runs | in `--quick` |
|---|---|---|
| berry (native VM) | `node berry/test/run.mjs` | yes |
| berry (wasm VM) | `node berry/test/run.mjs --vm=wasm` | |
| scripts | Node's test runner on `scripts/test/` and the scripts' own tests | yes |
| simulator workspaces | `npm test` in `libs/nspanel-sim/` | |
| mesh driver host test | `node firmware/host-tests/espnow-mesh-driver/run.mjs` | |
| OTA receiver host test | `node firmware/host-tests/espnow-ota-receiver/run.mjs` | |
| docs: links | `node scripts/check-doc-links.mjs` | yes |
| docs: paths | `node scripts/check-doc-paths.mjs` | yes |

`--quick` takes a few minutes; `--list` says what it would run; words keep the steps whose name has one of them (`node scripts/verify.mjs berry
mesh`). A step's output is shown only when it fails, and the exit code is 0 only when every step passed. Nothing in it touches a device.

## 2. The Berry suite

`berry/test/` has a test for every file of the brain, the bridge's and the house's layer included (`berry/test/test_*.be`), over stubs of the
native pieces each one uses (`berry/test/stub_*.be`); how a test is put together is in [12 §7](12-berry-notes.md).

- **Two VMs.** The runner uses the Berry interpreter built in the submodule, and `--vm=wasm` the same Berry compiled to WebAssembly, the VM the
  simulator runs the devices in. Both run in strict mode, as the device compiles, and their outputs must match line by line.
- **Names on the command line** run only the tests whose file has one of them: `node berry/test/run.mjs zbdriver_thermostat`.
- **The vectors** (`berry/test/vectors/`) are the suite's: the steps and inputs are written by hand; what the drawing and the views must give
  (`berry/test/vectors/draw.json`, `berry/test/vectors/ui.json`) is recorded by `node berry/test/run.mjs --update-vectors` when a change is on
  purpose, and the diff of the file is its review. The store's (`berry/test/vectors/store.json`) are written by hand, answers included.
- **The fixtures** (`berry/test/fixtures/`) are a living room of 34 lamps in five zones (30 on Zigbee, 4 on the panel's relay), the same on
  the EU and the US panel.

## 3. The simulator's tests

`npm test` in `libs/nspanel-sim/` type-checks and tests every package; `npm run typecheck` checks the app as well.

- **`layout`**: the contract of a component's nodes. **`core`**: themes and projects, the validation and its refusals.
- **`export`**: the screen's formats against a corpus of public `.tft` and `.HMI` files (`npm run fetch-fixtures --workspace=export` fetches them,
  each checked against its SHA-256 in `libs/nspanel-sim/export/fixtures/manifest.json`; the files are not ours and are not committed), the fonts,
  the picture codec, the preflight, the generator's guards, the compression the panel inflates.
- **`glass`**: the emulated screen, and, on the six generated projects, that every touch a manifest declares is reachable and sends the declared
  frame.
- **`vm`**, the devices running the repository's Berry (`libs/nspanel-sim/vm/test/`):
  - `berry-suite.test.mjs`: the Berry suite on both VMs, the outputs compared;
  - `compiler.test.mjs`: the mark of Berry's bug with more than 256 constants in a function, in the bytecode of every class
    ([12 §3](12-berry-notes.md));
  - `brain.test.mjs`: the brain and the bridge's files as the firmware compiles them (one class per file, its `#@ solidify:` line, nothing else at
    the top), and the simulator's lists equal to the firmware build's, in the same order;
  - `panel.test.mjs`: the panel end to end, the Berry on one side and the compiled pages on the other, joined by the UART; after each test, the
    classes' `static` members are checked unchanged;
  - `house*.test.mjs`: the house end to end: entering and leaving, the list and the key, devices of another room, their state and the sync gate,
    the server and the backups, MQTT and Home Assistant's discovery;
  - `mesh*.test.mjs`: the mesh's core over an air of bare nodes (scale, health, relaying, hops, routes, keys, the clock, the frame counter), and
    `mesh-house.test.mjs` with the Berry on top;
  - `alarm*.test.mjs`: the alarm's replica, against a reference model, at a distance and in a house;
  - `release-server.test.mjs`, `house-fleet.test.mjs`, `house-pairing.test.mjs`: the house's server;
  - `budget.test.mjs`: the brain's live heap with the largest zone on the screen below 83 KB on the EU and the US, and a backup below the
    32 000 bytes the panel reads back.

By hand, outside the gate: the mesh core's fuzzer, built with the sanitizers (`libs/nspanel-sim/vm/scripts/fuzz-mesh.mjs`), and the matrices
that explore the mesh's parameters on simulated houses (`libs/nspanel-sim/vm/scripts/mesh-clock-matrix.mjs`, `mesh-hops-matrix.mjs`,
`mesh-relay-matrix.mjs`).

## 4. The firmware on the PC

- **`firmware/host-tests/espnow-mesh-driver/`** compiles the mesh driver (`xdrv_98_1_espnow_mesh.ino`), as it is, over stand-ins of what it asks
  of the ESP-IDF (ESP-NOW, NVS, Wi-Fi), FreeRTOS, Tasmota and Berry, with the real core and cipher, and calls its functions one by one: the
  station, the search, the peers, the queues, the pages of the lists, the clock, the key, the counter. It needs emscripten, and its last line says
  how many checks passed.
- **`firmware/host-tests/espnow-ota-receiver/`** does the same for the safeboot's receiver and the app's sender of the house's OTA.
- **The build's scripts**, in the gate's scripts step: `scripts/build-firmware.test.mjs`, `scripts/build-stamp.test.mjs`, and
  `scripts/fork-berry-class.test.mjs`, which checks that every method of the fork's Tasmota class written in Berry is also in the C list that
  exposes it on the device (the simulator loads the class whole and cannot see a missing entry).

## 5. The bench

The bench is real devices on the LAN, read and driven over Tasmota's HTTP API ([12 §8](12-berry-notes.md)). It answers what no machine here
can: the radio's loss and signal between real devices, bursts, the timing of the heartbeat, the resend and the verdict, the heap and the stack
the mesh really costs, the mesh and the Wi-Fi sharing one radio, power cuts, an image actually written by a neighbour, and a mesh of nodes
spread around a house, with one that never has a network.

**The rules.** A bench tool says its plan and sends nothing without `--yes`; reading is the default, and `scripts/lib/bench.mjs` refuses any
command that is not on its read-only list where a tool only reads. Measuring is the owner's call: a measurement is not repeated or extended
without asking. And nothing is done to a device reachable only over the network that could leave it unreachable ([11 §8](11-build-and-flash.md)).

| tool | what it does |
|---|---|
| `scripts/mesh-bench.mjs` | sets up and reads the mesh on devices: `setup`, `status`, `neighbors`, `send`, `off`, `health` (the graph and its single points of failure), `clock` (one timeline, the skews) |
| `scripts/bench-logs.mjs` | receives the devices' syslog and polls them, read-only, for their status, the mesh's, the memory and the house's; every line carries the device and the PC's clock |
| `scripts/bench-load.mjs` | a repeatable load of commands (the same seed gives the same plan) through every path that exists (the panel, a tap, the bridge, the mesh), each checked against the device's real state afterwards |
| `scripts/bench-power.mjs` | cuts and restores the devices' power through outlets that a Tasmota controls, and checks what came back; cuts in a row, and a blackout in a given order |
| `scripts/bench-surface.mjs` | what answers without a credential on each device named one by one (never a range or a subnet) |

The tools read the bench's devices from a topology file (`scripts/bench-topology.example.json`). The bench images
(`tasmota32-probe-living-room-us`, `tasmota32-probe-bridge`) add the channel probe (`USE_ESPNOW_MESH_PROBE`), and the house's console commands
(`berry/house_commands.be`: `HouseFound`, `HouseAdd`, `HouseStatus`, `HouseLeave`, ...) build and read a house with no screen, one line each.

**The budgets** are measured on each build: `node scripts/app-anatomy.mjs <env>` says where an app image's flash goes, by the part of the
firmware it belongs to, and `node scripts/brain-flash.mjs` what the brain costs, file by file and function by function. The heap is read on the
device (`Br tasmota.memory()`) and, for the brain's data, in the simulator's budget test.
