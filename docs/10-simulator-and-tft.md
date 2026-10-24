# 10 — The simulator and the screen's project

`libs/nspanel-sim/` is an npm workspace with two jobs: it **generates the screen's project** (our pages, from themes and projects written as
JSON), and it **runs the panel and the house** in a browser or in Node, with the repository's own Berry on Tasmota's Berry VM and the generated
pages on an emulated Nextion. A change of behaviour is made once, in the Berry, and the simulator runs it. How to install and run it (it needs the
official Node.js for Windows, not MSYS2's) is in `libs/nspanel-sim/README.md`; its tests are in [13](13-testing.md).

## 1. The packages

| package | what it is | imports |
|---|---|---|
| `layout/` | what a component **is**: nodes in the panel's pixels, with no React and no file format | nothing |
| `core/` | the domain model: themes and projects as JSON, validated, with **our** rules | `layout` |
| `export/` | the hardware's truth: reading and writing the screen's formats, the `.zi` fonts, the picture codec, the preflight, and the generator (`export/scripts/`) | `src` imports nothing; the scripts import `core` |
| `ui/` | the React rendering of the components | `layout`, `export` |
| `glass/` | the emulated Nextion: the compiled pages, the event code, the drawing | `layout`, `export` |
| `vm/` | Tasmota's Berry VM in WebAssembly and the Tasmota around it: the panel, the bridge and the house between them | nothing (its tests use `glass`) |
| `sim/` | the app: the simulator, the themes, the House and the Settings ([07 §2](07-home-assistant.md)) | all of them |

Dependencies go one way. `layout/` imports nothing, so that both renderers, the React one and the compiled one, read the same description of a
component. `export/src` describes the screen and its formats and stands on its own, and it imports nothing from `node:`, so the measured rules run
in the browser as they run in the generator: the validation is the same code in every layer.

## 2. Themes and projects

Content lives outside the code, and adding one is adding a file:

```
libs/nspanel-sim/themes/<id>/theme.json        palette, fonts by role, components, icons, screen templates, constraints
libs/nspanel-sim/projects/<id>/project.json    target device, the themes it draws from, its screens
```

There are three themes (`lovelace-jobr99`, `shadcn-dark`, `tailwind-slate`) and a project for each (`living-room`, `living-room-shadcn`,
`living-room-tailwind`), each generated for the EU landscape and the US portrait screens: six generated projects. The rules of drawing for this
screen, measured, are in [09](09-drawing-for-the-glass.md).

**A screen is a list of placements**: a component, in a box, with its props and its bindings (`"bind": {"value": "$light.brightness"}`). A
placement can also say how its generated pixels are drawn (`render`, the dither of a ramp), how it takes the finger (`input`, a slider that
reports while dragging or on release), and a screen can say where a tap anywhere leads (`tap`), and that everything below its header is a
**plan** of cards the brain draws at run time. Every screen declares its **role** (`rest`, `plan`, `zone`, `thermostat`, `cover`, `detail`,
`list`, `house`, `mesh`, `dialog`, `qr`, `help`, `lock`, `keyboard`, `safeboot`), which is how the generator and the brain find each page; the list, a zone's screen, Help
and the lock are generated from the theme's own screen templates (`export/scripts/build-settings-screens.mjs`).

**Baked and configured.** What a Nextion command cannot change at run time goes into the `.tft`: the pages, their geometry, the fonts, the
pictures, which components exist. What it can change (a text, a colour, the picture shown, the visibility) is configuration, written by the
brain. A field declared as a room's variable that maps to no attribute writable at run time is refused.

## 3. The validation funnel

Three layers, one direction, and **an error rather than a silent fix** in each:

| layer | refuses |
|---|---|
| the theme | a primitive not admitted, a colour outside the palette, a touch target below the minimum, a forbidden event |
| the project | a placement against the union of the themes it uses; the target device; the RAM budget; names; slot ceilings; a box smaller than the component's touch target, two placements over the same pixels, a prop the component requires left unbound |
| the generation | the screen's measured rules: attribute ranges, project ceilings, naming rules, the budget |

Every refusal says the path in the JSON, the rule and its **provenance**: `editor`, a limit of the screen's tooling, measured, or `ours`, a
choice of this project that can be revisited. Every file carries a `schemaVersion`, and a reader refuses a version it does not know
(`schema-too-new`) rather than guess. The simulator validates at the door: what does not pass goes to a red strip with the path, the rule and the
provenance, and the rest keeps working.

## 4. The generator

```bash
node export/scripts/build-project-hmi.mjs living-room us-portrait --build
```

run from `libs/nspanel-sim/`, turns a project into, in `libs/nspanel-sim/export/hmi-scenarios/`:

- **the scenario** (`p1-<project>-<screen>.json`), every page and component of the screen's project;
- **the tables** (`p1-<project>-<screen>.jsonl`) the brain reads ([03 §2](03-architecture.md)): which component on which page carries each
  binding, what each touch means, the theme's colours, glyphs and font advances;
- **the manifest** (`p1-<project>-<screen>.runtime.json`): for every path the brain writes, the component and attribute it lands on and how
  the value was rendered there, which the simulator reads back;
- with `--build`, a copy stamped with the repository's commit and the time, and the screen's project written in `hmi-scenarios/out/`.

**Ids are stable across generations**: a component whose id changed would make the brain write into the wrong one, with no error. The screen
says its stamp at boot, and the tables carry the hash that binds them to it, so the brain refuses tables of another generation. The pictures go in
the screen's own lossless codec, and the fonts are `.zi` files subset from a reference set (`export/scripts/build-theme-fonts.mjs`).

**The `.tft`.** HouseWeave's generator writes the screen's project and its tables, but does not yet write a whole `.tft`: a `.tft` compiled
from the project is placed beside it in `hmi-scenarios/out/`, named after the scenario. `export/scripts/verify-event-frames.mjs` checks that
every event the project declares sends its frame from inside the compiled file, and the firmware build takes the `.tft` compressed into the
panel's image ([11 §3](11-build-and-flash.md)).

## 5. The preflight

A `.tft` that the screen accepts and that is wrong inside can leave the screen refusing every later upload over the serial line, recoverable
only through the test points of the display's own board with a USB-serial adapter. So no `.tft` goes to a screen without the **preflight**:

```bash
node export/scripts/preflight-tft.mjs --all --record
```

`export/src/preflight.ts` mirrors the screen's own gates and adds what they do not cover: the size, the vendor, the version of the tooling that
compiled it, the resolution and the orientation, the model's seed, the size field against the real size, the header's CRC and the checksums of
the regions and the tail, a second header that decrypts into plausible tables, the component table inside the file, every component's geometry
inside the screen, and every baud rate in the code at 115 200 (with the tooling's default of 9 600 the screen boots deaf to the ESP32). Three
checks only warn: the text encoding byte, the 64 KB alignment of the resources, and one `Page` per page. `--record` writes the verdict beside the
file (`<scenario>.preflight.json`), and the firmware build refuses a `.tft` with no passing record.

**On the panel**, `berry/nextion_driver.be` flashes the screen: it takes the screen out of its Protocol Reparse mode, sends `connect` and reads
the `comok` answer (the touch type, the firmware, the model, the flash size), reads the `.tft`'s header from the HTTP stream and checks it again
(vendor, size, and for the known model its seed), and only then sends `whmi-wris <size>,921600,res0`; a failed check aborts **before the screen
is told of any file**. The screen acknowledges every 4 096-byte block, or answers with an offset to skip resources it already has (the driver
reopens the HTTP request with a `Range`), validates the whole file at the end and restarts; a validation that fails shows an error and holds the
screen until a power cycle. `nextion.strict_preflight = false` turns the abort into a log line, for a file outside the norm on purpose.
`scripts/serve-tft.mjs` serves one file with `Range` for Tasmota's `FlashNextion <url>`.

**Flashing a new `.tft` to a panel is the hardware owner's decision**: everything is prepared up to the preflight, and stops there.

## 6. The simulator

```bash
npm run dev
```

in `libs/nspanel-sim/` serves the app at `http://localhost:5173`. Its **Studio** has the simulator and the themes:

- **The simulator** is the whole panel, in a house with its bridge: the panel's Berry on Tasmota's VM and the project's compiled pages on the
  emulated glass, joined by the UART. The panel shows twice, side by side: **Real**, the emulated glass in true RGB565, text drawn glyph by glyph
  from the `.zi` with the screen's measured positions; and **React**, the project's screens as designed, every value read back from the glass.
  They are one panel: a touch on either is a touch on the glass, and the two physical buttons are the frame's. On top: the project and EU or US,
  the touch areas drawn over the glass, **Restart** (the room's power off and on: both devices keep their flash) and **Reset flash** (the panel
  boots as it is flashed, with an empty Home, and the bridge as it leaves its box). Below: the bridge, its Zigbee network, each device's console and the log. The bridge opens its pairing window as it
  powers up, so the first use is **Add to this house** on the glass, then the zones and the devices.
- **The themes** are a catalogue: every component, colour, font role and icon of a theme, each once.
- **The physical size.** The screen is drawn at its real size, calibrated once per monitor in Settings by holding an ID-1 card (85.60 × 53.98 mm)
  against the screen; the EU screen measures 69.2 × 49.2 mm and the US 49.2 × 73.8 mm.

## 7. The devices in the VM

| piece | in the simulator | from |
|---|---|---|
| the Berry VM | `libs/nspanel-sim/vm/wasm/berry.mjs` | the submodule's Berry, compiled with emscripten |
| Tasmota's Berry library | rules, timers, drivers, `load()`, `persist` | the submodule's own `.be` files |
| the native functions | `millis`, power, `cmd`, serial, TCP and UDP over the house's network, `path`, `crypto`, `webserver`, `gpio`, `mqtt` | emulated |
| Tasmota's core | the loop, the periodic events, the relays, the buttons' scan, `Power`, `SetOption`, `Buzzer`, the Wi-Fi commands and the Wi-Fi manager, `Restart` | emulated (`libs/nspanel-sim/vm/src/device.ts`) |
| the fork's drivers | the buttons' driver, the Wi-Fi station and the pairing's ESP-NOW exchange | the fork's own `.ino`, compiled (`libs/nspanel-sim/vm/native/`) |
| the mesh | the core the firmware compiles (`espnow_mesh_core.h`) in `libs/nspanel-sim/vm/wasm/mesh.mjs`, and the driver **rewritten in TypeScript** (`libs/nspanel-sim/vm/src/mesh-driver.ts`), which mirrors the `.ino`: a change to the `.ino` asks for the same change there, by hand | |
| Zigbee | Zigbee2Tasmota and the devices, in Zigbee2Tasmota's own messages | emulated (`libs/nspanel-sim/vm/src/zigbee.ts`) |
| the screen | the Nextion | emulated (`libs/nspanel-sim/glass/`) |
| the house | the devices on one clock, the air between their radios, the networks in range, the house's network and its MQTT broker | `libs/nspanel-sim/vm/src/house.ts` |

**A device boots in Tasmota's order**: the compiler as Tasmota sets it (strict mode, globals by name), Tasmota's Berry library, the brain's
classes in the order of the firmware's build (`BRAIN_FILES` in `libs/nspanel-sim/vm/src/panel.ts`, `BRIDGE_FILES` in
`libs/nspanel-sim/vm/src/bridge.ts`, the same lists as `firmware/overrides/platformio_override.ini`), the drivers' init, and the first loop,
which loads `autoexec.be`. A turn of the loop is 5 ms of virtual time: every 50 ms the core's events, the buttons' scan and `every_50ms`, then
`every_100ms`, `every_250ms` and `every_second`; the radio drivers after the Berry, as in the firmware; the mesh driver's loop every 50 ms, so an
event of the mesh reaches the Berry up to 50 ms after the air. The clock is virtual: the app runs in real time, and a test jumps minutes in one
call. An exception in an event is printed and the loop goes on.

**The emulated glass** reads the generator's scenario, each component the screen's template for its type with the scenario's attributes over it.
Event code and UART instructions go through one interpreter (left to right, no precedence); a touch goes to the topmost component; loading a page
resets its components to their compiled values; a Timer runs only on its page; text is drawn with the measured geometry and the theme's `.zi`, and
circles with the screen's own algorithm. An instruction the screen refuses comes back with its error code, and a text longer than its maximum is
cut: both show in the glass's log, which is where the simulator shows what the panel would do in silence.

**The emulated Zigbee** answers as Zigbee2Tasmota does: announcements and endpoint descriptors as `ZbState`, reports as `ZbReceived`, writes
answered by `ZbResponse`, `ZbInfo` published inside the command, an unanswered ping as `Reachable:false` 2 s later, and a new `ZbConfig` channel
saved with a restart. A lamp powered by a relay loses power with it and comes back by its `StartUpOnOff`. Thermostats come in two profiles: a ZCL
one that does not report its mode, and the Moes ZHT-SR's datapoints by raw key, which can echo a write or not.

**What is not the firmware**: the mesh's task runs on the same thread (a burst of more than four sends at one instant finds the queue full,
where the device's task empties it on the other core); the mesh's radio has no channel and no shared table of peers; two nodes with different
network keys still hear each other; and a crystal's drift moves the mesh's counter, not the Berry's timers. The bench answers those.

**Scenarios** (`libs/nspanel-sim/vm/src/scenario.ts`) cut and heal the house's air, isolate a node, make a clock drift and restart a mesh.

## 8. Rebuilding the VMs

`libs/nspanel-sim/vm/wasm/berry.mjs` is kept in the repository, and using the simulator needs no emscripten. Rebuild it when the submodule's Berry,
one of the compiled drivers, the BearSSL they use or a file of `libs/nspanel-sim/vm/native/` changes:

```bash
node libs/nspanel-sim/vm/scripts/build-wasm.mjs
```

It copies the Berry sources out of the submodule, generates Berry's constant tables with its own tool, and compiles; nothing is written into the
submodule. `EMSDK` says where emscripten is. `libs/nspanel-sim/vm/wasm/build.json` keeps the submodule commit the module came from, the emscripten
version and the size. The mesh's core is another module, rebuilt by `node libs/nspanel-sim/vm/scripts/build-mesh-wasm.mjs` when its header or
`libs/nspanel-sim/vm/native/mesh_sim.cpp` change (`libs/nspanel-sim/vm/wasm/mesh.build.json`).
