# HouseWeave

*A smart house mesh, built on ESP32.*

A **Sonoff NSPanel** on the wall of each room is the house's control, and a **Sonoff ZBBridge Pro** in each area is the coordinator of that
area's Zigbee network. Every one of them runs Tasmota, built from our fork, with a **brain in Berry** compiled into the firmware, and together
they form an **ESP-NOW mesh**: the house. It needs no computer in a room, no cloud and no Home Assistant; Home Assistant, when there is one,
observes and helps, and hosts the house's server as an add-on. The panels draw our own pages, generated from themes and projects written as
JSON. The whole picture is in [docs/01-overview.md](docs/01-overview.md).

## Documentation

Everything lives in [`docs/`](docs/):

| chapter | what it covers |
|---|---|
| [00 — Journal](docs/00-journal.md) | what was done, what went wrong and how it was solved, in date order |
| [01 — Overview](docs/01-overview.md) | what HouseWeave is, its constraints, its layers, the repository |
| [02 — Hardware](docs/02-hardware.md) | the NSPanel and the ZBBridge Pro, their templates, the devices, the network the house needs |
| [03 — Architecture](docs/03-architecture.md) | the panel's brain, the bridge's, what both images carry, the fork's C, memory |
| [04 — The mesh](docs/04-the-mesh.md) | ESP-NOW between the nodes: the channel, the frame, the keys, flooding and routing, supervision, the clock |
| [05 — The house](docs/05-the-house.md) | the list, coming in and going out, the shared settings, devices of another room, the alarm, the server |
| [06 — OTA and backup](docs/06-ota-and-backup.md) | releases, the house's safeboot, upgrading a node through a neighbour or the server, the backups |
| [07 — Home Assistant](docs/07-home-assistant.md) | the add-on, its app, the integration, MQTT, and what stays out of Home Assistant |
| [08 — The screens](docs/08-screens.md) | what a panel shows and what each touch does |
| [09 — Drawing for the glass](docs/09-drawing-for-the-glass.md) | the rules of drawing for this screen, measured: colour, text, shape, pictures, touch, budget |
| [10 — The simulator and the screen's project](docs/10-simulator-and-tft.md) | the generator, the validation, the preflight of a `.tft`, the panel and the house in a browser |
| [11 — Build and flash](docs/11-build-and-flash.md) | building the images, partitions, flashing, the safeboot, releases, staying reachable |
| [12 — Berry notes](docs/12-berry-notes.md) | the brain compiled into the firmware, Berry's and Tasmota's traps, the mesh from Berry, testing off the device |
| [13 — Testing](docs/13-testing.md) | the verify gate, the suites, the firmware's host tests, the bench |

## Getting started

```bash
git submodule update --init --recursive
```

```bash
node scripts/verify.mjs --quick
```

The simulator, from `libs/nspanel-sim/` (it needs the official Node.js; see its README):

```bash
npm install
```

```bash
npm run dev
```

Building the firmware is in [docs/11-build-and-flash.md](docs/11-build-and-flash.md).

## Repository

| path | what it holds |
|---|---|
| `autoexec.be`, `berry/` | the brain: the panel's, the bridge's and the house's layer, and their tests |
| `firmware/` | the fork of Tasmota (a submodule) and our build configuration |
| `libs/nspanel-sim/` | the simulator, the generator of the pages and the themes |
| `ha/` | the Home Assistant add-on (`ha/houseweave/`) and the weather automation (`ha/weather/`) |
| `scripts/` | the firmware's build, the releases, the bench tools, the verify gate and the documentation's checkers |
| `reference/joBr99/` | a vendored copy of joBr99's NSPanel Lovelace UI, with its licence, not edited |
| `docs/` | the documentation |

## Conventions

- **Code and documentation are in English.** The words a panel shows are content, and follow the screens.
- **A comment says how the code is and why**, never its history: no dates, no "used to", no "until then". What changed, and when, goes in the
  journal.
- **Documentation lives in `docs/`**, one chapter per subject (`NN-slug.md`), indexed above. A package has at most an operational README
  (environment, commands), which points to its chapter.
- **A chapter says how things are now.** When something changes, the chapter is rewritten rather than annotated; what is an assumption is
  marked as one.
- **The journal only grows**: one dated entry per session or subject, and a dated correction under an entry found wrong later.
- **Links are relative**, and code is cited by its path from the root, in backticks. Before committing documentation,
  `node scripts/check-doc-links.mjs` and `node scripts/check-doc-paths.mjs` (every path cited must exist).
- **Patches to the fork** (`firmware/tasmota/`) stand on their own for someone who knows only Tasmota: standard terms, behind a `USE_...`
  switch, and no reference to this repository's documentation.

## Licence

HouseWeave is licensed under the [GNU General Public License v3.0](LICENSE), as Tasmota and joBr99's NSPanel Lovelace UI are.
