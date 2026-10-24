#!/usr/bin/env node
// Runs the standalone Berry tests in this folder against the real
// driver files in berry/, using the interpreter already vendored in
// the firmware submodule (firmware/tasmota/lib/libesp32/berry/berry.exe
// on Windows, .../berry elsewhere) — no separate Berry install needed,
// but it does need `git submodule update --init firmware/tasmota` done
// at least once.
//
// Why concatenation instead of load(): standalone Berry has neither
// load() nor the `global` table — both are native additions Tasmota's
// firmware registers into the VM, confirmed by running the vendored
// interpreter alone (see stub_tasmota.be's header comment). The driver
// files execute top-level statements in the caller's scope (e.g.
// `var nextion = Nextion()`), which is what on-device autoexec.be's
// load() gives them — concatenating into one script before invoking
// the interpreter reproduces that scoping without needing load().
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

// Two VMs run these tests: the vendored interpreter, and with --vm=wasm the
// same Berry sources built into WebAssembly for the simulator
// (libs/nspanel-sim/vm, scripts/run-berry.mjs). Both must pass: the simulator's
// backend is that second one.
const wasm = process.argv.includes("--vm=wasm");
// The vectors are the Berry suite's own (berry/test/vectors): with
// --update-vectors, the suites that carry them record what they got where it
// was expected, and this writes it into the file, keeping its order. The diff
// of the file is then the review of the change.
const update = process.argv.includes("--update-vectors");
// Names on the command line, with no leading --, run only the tests whose file name has one of them:
// `node berry/test/run.mjs zbdriver_thermostat`
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const wasmRunner = path.join(repoRoot, "libs/nspanel-sim/vm/scripts/run-berry.mjs");
const berryCandidates = [
  path.join(repoRoot, "firmware/tasmota/lib/libesp32/berry/berry.exe"),
  path.join(repoRoot, "firmware/tasmota/lib/libesp32/berry/berry"),
];
const berryExe = berryCandidates.find(existsSync);
if (!wasm && !berryExe) {
  console.error(
    "Vendored berry interpreter not found. Run `git submodule update --init firmware/tasmota` first.",
  );
  process.exit(1);
}
// The wasm VM runs from the simulator's compiled vm (libs/nspanel-sim/vm/dist), which a fresh clone does not have and an edit of vm/src
// leaves stale: it is compiled first, as the vm's own build does (a few seconds)
if (wasm) {
  const tsc = path.join(repoRoot, "libs/nspanel-sim/node_modules/typescript/bin/tsc");
  if (!existsSync(tsc)) {
    console.error("The simulator's packages are not installed: run `npm ci` in libs/nspanel-sim first.");
    process.exit(1);
  }
  const built = spawnSync(process.execPath, [tsc, "-p", path.join(repoRoot, "libs/nspanel-sim/vm/tsconfig.json")], { encoding: "utf8" });
  if (built.status !== 0) {
    console.error(`The simulator's vm did not compile:\n${built.stdout}${built.stderr}`);
    process.exit(1);
  }
}

// The store and the two files of static functions it names, in the order a
// file has to come after the ones it names
const STORE = ["../panel_text.be", "../panel_plan.be", "../panel_store.be"];
const ALARM = ["../panel_alarm.be", "../panel_alarm_draw.be", "../panel_alarm_canvas.be", "../panel_alarm_view.be"];

// A test names the file(s) it runs against, and a generated file it reads
// (`needs`). The generated project is a build artifact and not part of berry/:
// it is written beside its scenario by
// libs/nspanel-sim/export/scripts/build-project-hmi.mjs, and exercising it here
// is what keeps "the page and the Berry come out of one manifest" a property
// rather than a claim.
const tests = [
  // the .tft as the file system keeps it, packed, against the packer's vectors (berry/test/vectors/tft_pack.json)
  { driver: "../tft_pack.be", test: "test_tft_pack.be", modules: { crypto: "stub_crypto.be" } },
  { driver: "../nextion_driver.be", before: ["../tft_pack.be"], test: "test_nextion_preflight.be" },
  // the whole .tft flash, against a scripted display, server and clock
  { driver: "../nextion_driver.be", before: ["../tft_pack.be"], test: "test_nextion_flash.be" },
  // what the display sends, as a stream: frames split between reads
  { driver: "../nextion_driver.be", before: ["../tft_pack.be"], test: "test_nextion_frames.be" },
  // autoexec.be starts the boot the firmware carries, which a stub stands in for
  { driver: "../../autoexec.be", test: "test_autoexec_parses.be", stub: "stub_autoexec.be" },
  // the boot, over stand-ins of the pieces it builds and wires
  { driver: "../panel_boot.be", before: ["../panel_build.be"], test: "test_panel_boot.be", stub: "stub_boot.be" },
  // brain.be's side of OUR pages, with fakes for the driver, the light model
  // and the generated runtime: every event the manifest can carry lands somewhere
  { driver: "../brain.be", before: [...STORE, "../panel_draw.be", "../clock_link.be", "../panel_clock.be", "../panel_thermostat_settings.be", "../panel_thermostat_view.be", "../panel_cover_view.be", "../panel_page_buttons.be", "../pair_sign.be", "../node_ota.be", "../node_wireless.be", "../panel_ui.be", ...ALARM], test: "test_brain_panel.be", modules: { path: "stub_path.be", crypto: "stub_crypto.be", mqtt: "stub_mqtt.be" } },
  // the configuration store, against its vectors (berry/test/vectors/store.json)
  // a fresh panel's first group draws its base
  { driver: "../panel_store.be", before: STORE.slice(0, -1), test: "test_panel_store.be", modules: { crypto: "stub_crypto.be" } },
  // what a plan draws, instruction by instruction (berry/test/vectors/draw.json)
  { driver: "../panel_draw.be", before: STORE, test: "test_panel_draw.be", vectors: "vectors/draw.json" },
  // the plan on the glass: blocks at the line's pace, the tap, pending, the carousel
  {
    driver: "../panel_plan_view.be",
    before: [...STORE, "../panel_draw.be", "../panel_plan_commands.be"],
    test: "test_panel_plan_view.be",
  },
  { driver: "../panel_zigbee.be", before: [...STORE, "../panel_thermostat_settings.be", "../panel_thermostat_view.be", "../panel_cover_view.be", "../panel_page_buttons.be", "../node_ota.be", "../node_wireless.be", "../panel_ui.be", "../panel_add_view.be"], test: "test_panel_zigbee.be" },
  // the thermostats' state, as the bridge's drivers say it: what the plan and the views are told of it
  { driver: "../panel_cover.be", before: [...STORE, "../panel_thermostat_settings.be", "../panel_thermostat_view.be", "../panel_cover_view.be", "../panel_page_buttons.be", "../node_ota.be", "../node_wireless.be", "../panel_ui.be", "../panel_add_view.be", "../panel_zigbee.be"], test: "test_panel_cover.be" },
  // what a tap on a zone's card turns on: the zone's Tap, its plan, the button, the glass and the screens
  { driver: "../panel_tap_view.be", before: [...STORE, "../panel_draw.be", "../panel_plan_view.be", "../panel_plan_commands.be", "../panel_thermostat_settings.be", "../panel_thermostat_view.be", "../panel_cover_view.be", "../panel_page_buttons.be", "../node_ota.be", "../node_wireless.be", "../panel_ui.be"], test: "test_panel_tap_view.be" },
  // a switch of several channels, each a device: ids, commands, reports, the interview, the network, Remove
  { driver: "../panel_zigbee.be", before: [...STORE, "../panel_plan_commands.be", "../panel_thermostat_settings.be", "../panel_thermostat_view.be", "../panel_cover_view.be", "../panel_page_buttons.be", "../node_ota.be", "../node_wireless.be", "../panel_ui.be", "../panel_add_view.be"], test: "test_panel_channels.be" },
  // the driver of a switch of two channels, as the panel chooses it
  { driver: "../panel_zigbee.be", before: [...STORE, "../panel_plan_commands.be", "../panel_draw.be", "../panel_thermostat_settings.be", "../panel_thermostat_view.be", "../panel_cover_view.be", "../panel_page_buttons.be", "../node_ota.be", "../node_wireless.be", "../panel_ui.be", "../panel_add_view.be", "../panel_driver_view.be"], test: "test_panel_driver_view.be" },
  // the + of a zone in a house of more than one bridge: Pair new device or Existing device, the pages of another bridge's devices, and the device taken
  { driver: "../panel_remote_view.be", before: [...STORE, "../house_list.be", "../house_devices.be", "../panel_plan_commands.be", "../panel_draw.be", "../panel_thermostat_settings.be", "../panel_thermostat_view.be", "../panel_cover_view.be", "../panel_page_buttons.be", "../node_ota.be", "../node_wireless.be", "../panel_ui.be", "../panel_add_view.be"], test: "test_panel_remote_view.be", modules: { crypto: "stub_crypto.be" } },
  // the house as the glass shows it: its row of the Wireless settings, its nodes, the strike off and the change of the key not closed
  { driver: "../panel_house_view.be", before: [...STORE, "../house_list.be", "../mesh_beat.be", "../house_channel.be", "../house_devices.be", "../panel_plan_commands.be", "../panel_draw.be", "../panel_thermostat_settings.be", "../panel_thermostat_view.be", "../panel_cover_view.be", "../panel_page_buttons.be", "../node_ota.be", "../node_wireless.be", "../panel_ui.be", "../panel_remote_view.be", "../server_link.be", "../house_server.be"], test: "test_panel_house_view.be", modules: { crypto: "stub_crypto.be" } },
  // the alarm as the panel keeps and shows it: the state and events the bridge says, the notice, the beeps,
  // the panic touch, the screens' words and touches, the settings' rows and what a device's options get
  { driver: "../panel_alarm_view.be", before: [...STORE, "../panel_draw.be", "../clock_link.be", "../panel_clock.be", "../panel_thermostat_settings.be", "../panel_thermostat_view.be", "../panel_cover_view.be", "../panel_page_buttons.be", "../node_ota.be", "../node_wireless.be", "../panel_ui.be", "../panel_zigbee.be", "../panel_alarm.be", "../panel_alarm_draw.be", "../panel_alarm_canvas.be"], test: "test_panel_alarm.be" },
  { driver: "../panel_lamp_settings.be", before: [...STORE, "../panel_thermostat_settings.be", "../panel_thermostat_view.be", "../panel_cover_view.be", "../panel_page_buttons.be", "../node_ota.be", "../node_wireless.be", "../panel_ui.be", "../panel_zigbee.be"], test: "test_panel_lamp_settings.be" },
  { driver: "../panel_thermostat.be", before: [...STORE, "../panel_thermostat_settings.be", "../panel_thermostat_view.be", "../panel_cover_view.be", "../panel_page_buttons.be", "../node_ota.be", "../node_wireless.be", "../panel_ui.be", "../panel_add_view.be", "../panel_zigbee.be"], test: "test_panel_thermostat.be" },
  // the Wi-Fi of Wireless settings: the boot, each operation, and what the views draw
  { driver: "../node_wireless.be", before: ["../node_ota.be"], test: "test_node_wireless.be" },
  { driver: "../node_wireless.be", before: ["../panel_build.be", "../node_ota.be"], test: "test_node_ota.be" },
  { driver: "../server_link.be", test: "test_server_link.be", modules: { crypto: "stub_crypto.be", webserver: "stub_webserver.be" } },
  { driver: "../mesh_http.be", test: "test_mesh_http.be" },
  { driver: "../panel_wifi.be", before: STORE, test: "test_panel_wifi.be", modules: { crypto: "stub_crypto.be" } },
  // the MQTT of Wireless settings: what it reads, the save, the bridge's copy, the discovery at boot
  { driver: "../panel_mqtt.be", before: STORE, test: "test_panel_mqtt.be", modules: { mqtt: "stub_mqtt.be" } },
  // the devices' names, told to the bridge for Home Assistant: what changed, a moment apart
  { driver: "../panel_names.be", before: STORE, test: "test_panel_names.be" },
  // the joBr99 stack's Light (the model of a panel with no project of ours): a report is taken and the screen told, and a save that falls over raises nothing
  { driver: "../light.be", test: "test_light.be" },
  // the stubs the tests above stand on, held to what they stand in for: the timers that stack as Tasmota's do, and the
  // persist that fails as the firmware's does (against the real persist.be, run over a file system that fails)
  { test: "test_stub_timers.be" },
  { test: "test_stub_persist.be", modules: { path: "stub_path.be" } },
  // the HTTP of the backup, over a TCP client that says what a test gives it
  { driver: "../panel_http.be", test: "test_panel_http.be", stub: "stub_http.be" },
  // the backup: what goes, when, whose the server's is, and the restore with its checks
  { driver: "../panel_backup.be", before: [...STORE, "../panel_thermostat_settings.be", "../panel_thermostat_view.be", "../panel_cover_view.be", "../panel_page_buttons.be", "../node_ota.be", "../node_wireless.be", "../panel_ui.be", "../panel_http.be", "../server_link.be", "../node_settings.be", "../node_backup.be"], test: "test_panel_backup.be", stub: "stub_http.be", modules: { mqtt: "stub_mqtt.be", crypto: "stub_crypto.be" } },
  { driver: "../bridge_backup.be", before: ["../panel_http.be", "../server_link.be", "../node_settings.be", "../node_backup.be"], test: "test_bridge_backup.be", stub: "stub_http.be", modules: { crypto: "stub_crypto.be" } },
  // the panel's side of the transports: when each mode's link is up, and where a command went
  { driver: "../zigbee_bridge.be", before: ["../pair_sign.be"], test: "test_zigbee_bridge.be", stub: "stub_zbbridge.be", modules: { crypto: "stub_crypto.be" } },
  // the signatures of what a panel and its bridge say once paired, on a real SHA-256
  { driver: "../pair_sign.be", test: "test_pair_sign.be", modules: { crypto: "stub_crypto.be" } },
  // pairing a bridge from the glass: the search, what is kept, the bridge moving
  { driver: "../zigbee_pairing.be", before: [...STORE, "../pair_sign.be"], test: "test_zigbee_pairing.be", stub: "stub_pairing.be", modules: { crypto: "stub_crypto.be" } },
  // the same deadlines across the day 24.8 of uptime, where millis() turns negative
  { driver: "../zigbee_pairing.be", before: [...STORE, "../pair_sign.be"], test: "test_zigbee_pairing_wrap.be", stub: "stub_pairing.be", modules: { crypto: "stub_crypto.be" } },
  // the ZBBridge Pro's relay, as its classes: a burst merged and split, its TCP link, its pairing and its button
  { driver: "../zbbridge_relay.be", before: ["../pair_sign.be", "../clock_link.be", "../zbbridge_relay_pairing.be", "../panel_wifi.be", "../node_ota.be", "../node_wireless.be"], test: "test_zbbridge_relay.be", stub: "stub_relay.be", modules: { crypto: "stub_crypto.be", gpio: "stub_gpio.be", mqtt: "stub_mqtt.be", path: "stub_path.be", sonoff_zb_pro_flasher: "stub_zb_flasher.be" } },
  { driver: "../zbbridge_relay.be", before: ["../pair_sign.be", "../clock_link.be", "../zbbridge_relay_pairing.be"], test: "test_zbbridge_relay_wrap.be", stub: "stub_relay.be", modules: { crypto: "stub_crypto.be", gpio: "stub_gpio.be", mqtt: "stub_mqtt.be" } },
  // the bridge's autoexec.be: the files left on its file system run over the firmware's classes, and are said by name
  { driver: "../zbbridge_autoexec.be", test: "test_zbbridge_autoexec.be", stub: "stub_bridge_autoexec.be", modules: { path: "stub_path.be" } },
  // the host of the bridge's drivers: who has a device, what reaches a driver and what it says back,
  // the frames, the panel's commands, a link that comes up, a device that leaves -- with the relay that hands it all
  { driver: "../zbbridge_drivers.be", before: ["../pair_sign.be", "../clock_link.be", "../zbbridge_relay_pairing.be", "../zbbridge_relay.be"], test: "test_zbbridge_drivers.be", stub: "stub_relay.be", modules: { crypto: "stub_crypto.be", gpio: "stub_gpio.be", mqtt: "stub_mqtt.be" } },
  // the thermostats' driver, on the host and the relay it runs in: what it claims, what it describes, the state
  // it normalizes from a ZCL thermostat's and a Moes ZHT-SR's reports, the commands it writes, the read-back, the settings
  // the switch of two channels that opens and closes, which the panel assigns
  { driver: "../zbdriver_twokey.be", before: ["../pair_sign.be", "../clock_link.be", "../zbbridge_relay_pairing.be", "../zbbridge_drivers.be", "../zbbridge_relay.be"], test: "test_zbdriver_twokey.be", stub: "stub_relay.be", modules: { crypto: "stub_crypto.be", gpio: "stub_gpio.be", mqtt: "stub_mqtt.be" } },
  { driver: "../zbdriver_cover.be", before: ["../pair_sign.be", "../clock_link.be", "../zbbridge_relay_pairing.be", "../zbbridge_drivers.be", "../zbbridge_relay.be"], test: "test_zbdriver_cover.be", stub: "stub_relay.be", modules: { crypto: "stub_crypto.be", gpio: "stub_gpio.be", mqtt: "stub_mqtt.be" } },
  { driver: "../zbdriver_thermostat.be", before: ["../pair_sign.be", "../clock_link.be", "../zbbridge_relay_pairing.be", "../zbbridge_drivers.be", "../zbbridge_relay.be"], test: "test_zbdriver_thermostat.be", stub: "stub_relay.be", modules: { crypto: "stub_crypto.be", gpio: "stub_gpio.be", mqtt: "stub_mqtt.be" } },
  // the house alarm of a bridge, and the relay that hands it the reports and the panel's commands: the
  // sensors' roles, the states, the notifications by grade, the panic, the events and the supervision
  { driver: "../zbbridge_alarm.be", before: ["../mesh_events.be", "../pair_sign.be", "../clock_link.be", "../zbbridge_relay_pairing.be", "../zbbridge_drivers.be", "../mesh_beat.be", "../house_list.be", "../zbbridge_alarm_merge.be", "../zbbridge_alarm_mesh.be", "../zbbridge_relay.be"], test: "test_zbbridge_alarm.be", stub: "stub_relay.be", modules: { crypto: "stub_crypto.be", gpio: "stub_gpio.be", mqtt: "stub_mqtt.be" } },
  // the list of the house as the panels write it: the entries and the rules that make two fields one, the vector and its digest, the snapshot, the flash
  { driver: "../house_list.be", test: "test_house_list.be", modules: { crypto: "stub_crypto.be" } },
  // where a line about a device goes, the link or the mesh
  { driver: "../panel_route.be", test: "test_panel_route.be" },
  // the buttons of another room's devices are not there while its bridge is not ready
  { driver: "../panel_gate.be", before: [...STORE], test: "test_panel_gate.be" },
  // the house's list and key on the mesh, over a fake mesh: the heartbeat's bytes, what is answered, what is taken, the outbox, the driver's table
  { driver: "../house_mesh.be", before: ["../mesh_events.be", "../house_list.be", "../mesh_beat.be", "../house_key.be", "../house_state.be", "../house_devices.be", "../house_link.be", "../house_channel.be", "../house_commands.be", "../house_mqtt.be", "../house_alarm.be"], test: "test_house_mesh.be", stub: "stub_relay.be", modules: { crypto: "stub_crypto.be", gpio: "stub_gpio.be", mqtt: "stub_mqtt.be" } },
  { driver: "../house_server.be", before: ["../mesh_events.be", "../house_list.be", "../mesh_beat.be", "../house_key.be", "../house_state.be", "../house_devices.be", "../house_link.be", "../house_channel.be", "../house_commands.be", "../house_mqtt.be", "../house_alarm.be", "../house_mesh.be", "../server_link.be"], test: "test_house_server.be", modules: { crypto: "stub_crypto.be", gpio: "stub_gpio.be", mqtt: "stub_mqtt.be", webserver: "stub_webserver.be" } },
  // a command over the mesh to the bridge that owns the device: the sender, and the owner's admission with the stamp, K and the order
  // the mesh driver's events by one rule, to the parts that take each kind
  { driver: "../mesh_events.be", test: "test_mesh_events.be", stub: "stub_relay.be" },
  { driver: "../panel_rules.be", test: "test_panel_rules.be", stub: "stub_relay.be" },
  { driver: "../mesh_cmd.be", before: ["../mesh_events.be"], test: "test_mesh_cmd.be", stub: "stub_relay.be", modules: { crypto: "stub_crypto.be", gpio: "stub_gpio.be", mqtt: "stub_mqtt.be" } },
  // the alarm's replica on a bridge: the order rule over the set of heads, the persisted
  // form, the 52-byte record and the heartbeat's part, against the reference's vectors (berry/test/vectors/alarm_merge.json)
  { driver: "../zbbridge_alarm_merge.be", test: "test_zbbridge_alarm_merge.be", modules: { crypto: "stub_crypto.be" } },
  // the replica on the mesh (zbbridge_alarm_mesh.be) and the state the bridge's alarm takes from it: the heartbeat's bytes, the frames, the timeline
  // events, the poll of the neighbours, a restart of the mesh, the exit and siren times counted from the record's mark; the mesh's natives are a fake
  { driver: "../zbbridge_alarm.be", before: ["../mesh_events.be", "../pair_sign.be", "../clock_link.be", "../zbbridge_relay_pairing.be", "../zbbridge_drivers.be", "../mesh_beat.be", "../house_list.be", "../zbbridge_alarm_merge.be", "../zbbridge_alarm_mesh.be", "../zbbridge_relay.be"], test: "test_zbbridge_alarm_mesh.be", stub: "stub_relay.be", modules: { crypto: "stub_crypto.be", gpio: "stub_gpio.be", mqtt: "stub_mqtt.be" } },
  // the bridge's Zigbee devices in Home Assistant: each kind announced, its state, the commands, the names
  { driver: "../zbbridge_discovery.be", before: ["../pair_sign.be"], test: "test_zbbridge_discovery.be", modules: { crypto: "stub_crypto.be", mqtt: "stub_mqtt.be" } },
  // the rooms in the Web UI, with Tasmota's webserver module stubbed as a module
  { driver: "../panel_web.be", before: STORE, test: "test_panel_web.be", modules: { webserver: "stub_webserver.be" } },
  // the zone screen and the list's views, against their vectors (berry/test/vectors/ui.json)
  // the views, and the +'s screens, whose provider comes after PanelUi
  { driver: "../panel_add_view.be", before: [...STORE, "../panel_thermostat_settings.be", "../panel_thermostat_view.be", "../panel_cover_view.be", "../panel_page_buttons.be", "../node_ota.be", "../node_wireless.be", "../panel_ui.be"], test: "test_panel_ui.be", vectors: "vectors/ui.json" },
  // the panel's own clock and the house's place, and PanelUi handing them their rows, views, verb and keyboard
  { driver: "../panel_schedule_mqtt.be", before: [...STORE, "../clock_link.be", "../panel_clock.be", "../panel_thermostat_settings.be", "../panel_thermostat_view.be", "../panel_cover_view.be", "../panel_page_buttons.be", "../node_ota.be", "../node_wireless.be", "../panel_ui.be", "../panel_schedule.be", "../panel_draw.be", "../panel_calendar_draw.be", "../panel_schedule_view.be", "../panel_http.be", "../server_link.be", "../node_settings.be", "../node_backup.be", "../panel_backup.be"], test: "test_panel_schedule_mqtt.be", stub: "stub_http.be", modules: { mqtt: "stub_mqtt.be", crypto: "stub_crypto.be" } },
  { driver: "../panel_schedule_view.be", before: [...STORE, "../clock_link.be", "../panel_clock.be", "../panel_thermostat_settings.be", "../panel_thermostat_view.be", "../panel_cover_view.be", "../panel_page_buttons.be", "../node_ota.be", "../node_wireless.be", "../panel_ui.be", "../panel_schedule.be", "../panel_draw.be", "../panel_calendar_draw.be"], test: "test_panel_schedule_view.be" },
  { driver: "../panel_schedule.be", before: [...STORE, "../clock_link.be", "../panel_clock.be", "../panel_thermostat_settings.be", "../panel_thermostat_view.be", "../panel_cover_view.be", "../panel_page_buttons.be", "../node_ota.be", "../node_wireless.be", "../panel_ui.be"], test: "test_panel_schedule.be" },
  { driver: "../panel_clock.be", before: [...STORE, "../panel_thermostat_settings.be", "../panel_thermostat_view.be", "../panel_cover_view.be", "../panel_page_buttons.be", "../node_ota.be", "../node_wireless.be", "../panel_ui.be", "../clock_link.be"], test: "test_panel_clock.be" },
  // the generated project, read by the runtime every project shares
  {
    driver: "../panel_runtime.be",
    test: "test_panel_runtime.be",
    needs: "../../libs/nspanel-sim/export/hmi-scenarios/p1-living-room-eu-landscape.jsonl",
  },
];

// A recorded value over the one in the file: the file's order of keys is kept
// where the keys are the same, since a Berry map has no order of its own and a
// reordered file would be a diff of nothing.
function merge(old, got) {
  if (Array.isArray(old) && Array.isArray(got)) return got.map((g, i) => (i < old.length ? merge(old[i], g) : g));
  if (old && got && typeof old === "object" && typeof got === "object" && !Array.isArray(old) && !Array.isArray(got)) {
    const out = {};
    for (const k of Object.keys(old)) if (k in got) out[k] = merge(old[k], got[k]);
    for (const k of Object.keys(got)) if (!(k in out)) out[k] = got[k];
    return out;
  }
  return got;
}

let failures = 0;
for (const { driver, before, test, needs, stub, modules, vectors } of tests) {
  if (only.length > 0 && !only.some((o) => test.includes(o))) continue;
  // a test of a stub has no driver: the stub is what it runs against
  const driverPath = driver ? path.join(here, driver) : null;
  // files the driver needs loaded ahead of it, as autoexec.be would load them
  const beforeText = (before ?? []).map((f) => readFileSync(path.join(here, f), "utf8") + "\n").join("");
  if (needs && !existsSync(path.join(here, needs))) {
    // a build artifact, so a clean checkout has not got it yet
    console.log(`skip  ${test} (${needs} has not been generated)`);
    continue;
  }
  // `persist` is a NATIVE Tasmota module, so no amount of stubbing in the
  // combined script can satisfy `import persist` -- the statement looks in the
  // module table and in sys.path and nowhere else. A real module file next to
  // the script, with that directory pushed onto the path, is what works.
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "berry-test-"));
  // forward slashes: the path goes into a Berry string literal, where a
  // Windows backslash would start an escape
  // (the WebAssembly VM sees its own paths: the repo at /repo, this folder at /work)
  const tmpDirForPath = wasm ? "/work" : tmpDir.split(path.sep).join("/");
  const rootForPath = wasm ? "/repo" : repoRoot.split(path.sep).join("/");
  const combined =
    `import sys
sys.path().push(${JSON.stringify(tmpDirForPath)})
var TEST_ROOT = ${JSON.stringify(rootForPath)}
var TEST_TMP = ${JSON.stringify(tmpDirForPath)}
var UPDATE_VECTORS = ${update && vectors ? "true" : "false"}
` +
    readFileSync(path.join(here, "stub_tasmota.be"), "utf8") +
    "\n" +
    // an extra stub, for a file that needs more than the Tasmota module
    (stub ? readFileSync(path.join(here, stub), "utf8") + "\n" : "") +
    beforeText +
    (driverPath ? readFileSync(driverPath, "utf8") : "") +
    "\n" +
    readFileSync(path.join(here, test), "utf8");

  // The vendored interpreter takes a file path, not stdin (`berry -`
  // fails with "cannot open file '-'") — write the combined script out.
  const tmpFile = path.join(tmpDir, "combined.be");
  writeFileSync(tmpFile, combined, "utf8");
  writeFileSync(path.join(tmpDir, "persist.be"), readFileSync(path.join(here, "stub_persist.be"), "utf8"), "utf8");
  // other native modules a file imports, the same way: name -> stub file
  for (const [name, file] of Object.entries(modules ?? {}))
    writeFileSync(path.join(tmpDir, `${name}.be`), readFileSync(path.join(here, file), "utf8"), "utf8");
  // Strict, as the device compiles (xdrv_52_9_berry.ino): a redefined builtin or
  // a global never declared is refused here as the panel would refuse it. Not
  // globals by name, the device's other setting: the vendored interpreter is
  // older than the firmware and compiles them wrong, and in the firmware's own
  // Berry a function past 256 constants passes a global's NAME where its value
  // goes as a call argument -- which these combined scripts, thousands of lines
  // at the top level, always are. The panel's files are compiled with both by
  // the simulator's tests (libs/nspanel-sim/vm/test), which boot them as the
  // device does and check that no function of theirs reaches that defect.
  const result = wasm
    ? spawnSync(process.execPath, [wasmRunner, "-s", "--mount", `/repo=${repoRoot}`, "--mount", `/work=${tmpDir}`, "/work/combined.be"], { encoding: "utf8" })
    : spawnSync(berryExe, ["-s", tmpFile], { encoding: "utf8" });
  rmSync(tmpDir, { recursive: true, force: true });

  if (update && vectors && result.status === 0) {
    // "VECTOR <path> <value>": the value goes where the path says, in the file as it is
    const file = path.join(here, vectors);
    const data = JSON.parse(readFileSync(file, "utf8"));
    let n = 0;
    for (const line of (result.stdout ?? "").split(/\r?\n/)) {
      if (!line.startsWith("VECTOR ")) continue;
      const rest = line.slice(7);
      const end = rest.indexOf("] ") + 1;
      const keys = JSON.parse(rest.slice(0, end));
      let at = data;
      for (const k of keys.slice(0, -1)) at = at[k];
      const last = keys[keys.length - 1];
      at[last] = merge(at[last], JSON.parse(rest.slice(end + 1)));
      n++;
    }
    writeFileSync(file, JSON.stringify(data, null, 1) + "\n");
    console.log(`wrote ${n} expectations into berry/test/${vectors}`);
  }
  process.stdout.write((result.stdout ?? "").split(/\r?\n/).filter((l) => !l.startsWith("VECTOR ")).join("\n"));
  if (result.status !== 0) {
    console.error(`FAIL: ${test}`);
    process.stderr.write(result.stderr ?? "");
    failures++;
  } else {
    console.log(`ok    ${test}`);
  }
}

process.exit(failures > 0 ? 1 : 0);
