# nspanel-sim

The generator of the panel's pages and the simulator of the panel and the house, an npm workspace of [HouseWeave](../../README.md). This README
is operational (environment, commands); what it is and how it is built is in [docs/10](../../docs/10-simulator-and-tft.md), and its tests in
[docs/13](../../docs/13-testing.md).

## Packages

```
layout/   what a component is: nodes in the panel's pixels, with no React and no file format
core/     the domain model: themes and projects as JSON, validated
ui/       the React rendering of the components
sim/      the app (Vite and React): the Studio, the House, the Settings
export/   the screen's formats, the .zi fonts, the picture codec, the preflight, and the generator
vm/       Tasmota's Berry VM in WebAssembly and the Tasmota around it: the panel, the bridge and the house
glass/    the emulated Nextion: the compiled pages, the event code, the drawing
```

Content lives outside the code, and adding one is adding a file:

```
themes/<id>/theme.json       palette, fonts, components, icons, screen templates, constraints
projects/<id>/project.json   target device, themes, screens
```

## Environment

**It needs the official Node.js for Windows (LTS), not MSYS2's.** If `node -p "process.execPath"` points into `C:\msys64\...`, the build breaks:
that Node reports a GNU ABI, and Rolldown, the bundler Vite uses, publishes only the `win32-x64-msvc` native binary. The symptom is a
`Cannot find native binding` that looks like a corrupted `node_modules` and is not.

```
winget install --id OpenJS.NodeJS.LTS --exact
```

The installer puts `C:\Program Files\nodejs\` on the machine's PATH, ahead of the user's, so new shells take the official Node.

## Running

The install is at the workspace's root, `libs/nspanel-sim/`, not inside `sim/`; the commands below run from there.

```
npm install        # at the workspace's root
npm run dev        # the app at http://localhost:5173
```

```
npm run typecheck                                  # every package and the app
npm test                                           # layout, core, export, vm and glass
npm run build --workspace=sim                      # the app's production build
npm run lint --workspace=sim                       # oxlint
npm run build --workspace=@nspanel-sim/layout      # the .mjs scripts read layout/dist/, as they read export/dist/
npm run fetch-fixtures --workspace=export          # the public .tft and .HMI files the export tests read, each checked by its SHA-256
npm run build-fonts --workspace=export             # every theme's .zi fonts (--check: verify, write nothing)
node ../../berry/test/run.mjs                      # the Berry suite on the submodule's interpreter (--vm=wasm: on the simulator's VM)
node export/scripts/build-project-hmi.mjs living-room us-portrait --build   # a project's scenario, tables (.jsonl) and manifest in
                                                   # export/hmi-scenarios/; --build stamps a copy and writes the screen's project in out/
node export/scripts/build-settings-screens.mjs living-room lovelace-jobr99  # the list, the zone, Help and the lock from a theme's templates
node export/scripts/preflight-tft.mjs --all --record   # the preflight of every p1-*.tft in export/hmi-scenarios/out/, its verdict recorded
node export/scripts/verify-event-frames.mjs p1-living-room-us-portrait  # every declared event's frame is inside the compiled .tft
node export/scripts/tft-pack-vectors.mjs           # the vectors berry/tft_pack.be is tested against (--write: write them)
node export/scripts/export-hmi-templates.mjs       # the component templates, from the Editor-made .HMI fixtures
node export/scripts/diff-components.mjs a.tft b.tft    # the component tables of two .tft, diffed
node ../../scripts/serve-tft.mjs <file.tft>        # one file over HTTP, with Range, for FlashNextion
```

The fixtures go in `export/fixtures/cache/` (ignored by git); the manifest with each one's URL, size and SHA-256 is committed in
`export/fixtures/manifest.json`.

### The simulator

On top, **Project** and EU or US choose the panel that runs: the project as `build-project-hmi.mjs` generated it for that panel, and the page
says the command when it is missing. **Touch areas** draws the glass's touch areas over it. **Restart** powers the room off and on, and the panel
and the bridge keep their flash; **Reset flash** wipes both: the panel boots as it is flashed, with an empty Home, and the bridge as it leaves
its box.

### The real size

The app draws the screen at the panel's **physical** size, and no browser API says a monitor's physical size. It is calibrated once per
monitor: in **Settings**, hold an ID-1 card (a bank card or an ID card, 85.60 × 53.98 mm) against the monitor and drag the outline's edge until
they match. What is kept is the monitor's physical PPI, which neither the browser's zoom nor the system's scale changes. To check it, the page
says how large the device's screen should measure (EU: 69.2 × 49.2 mm; US: 49.2 × 73.8 mm): a ruler does the rest.

### The VM

`vm/wasm/berry.mjs` is committed. Rebuilding it needs emscripten: `node vm/scripts/build-wasm.mjs` (`EMSDK` says where it is), and the mesh's
core `node vm/scripts/build-mesh-wasm.mjs` ([docs/10 §8](../../docs/10-simulator-and-tft.md)).
