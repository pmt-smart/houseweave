// The devices' files read from this repo, for node (tests, scripts): Tasmota's
// Berry library from the firmware submodule, this package's layer, the classes
// each firmware carries (berry/), and each file system as its image has it: the
// panel's autoexec.be and the generated tables of a project
// (firmware/overrides/panel_files.py), and the bridge's autoexec.be, which is
// berry/zbbridge_autoexec.be (firmware/overrides/bridge_files.py).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODULE_FILES, TASMOTA_LIBRARY, type DeviceFiles, type SimDevice } from "./device.js";
import { BRAIN_FILES, SimPanel, type PanelFiles } from "./panel.js";
import { BRIDGE_FILES, SimBridge } from "./bridge.js";
import { SimHouse } from "./house.js";
import { IDEAL_LOOP, IDEAL_TIMING } from "./radio.js";
import { networkOf } from "./zigbee.js";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = join(here, "../../../..");
const EMBEDDED = join(REPO, "firmware/tasmota/lib/libesp32/berry_tasmota/src/embedded");
const LAYER = join(here, "../tasmota");
const SCENARIOS = join(REPO, "libs/nspanel-sim/export/hmi-scenarios");

const read = (dir: string, names: readonly string[]) => Object.fromEntries(names.map((n) => [n, readFileSync(join(dir, n), "utf8")]));

/** every file a panel needs; `project` names the generated tables ("p1-living-room-eu-landscape") */
export function repoFiles(project?: string): PanelFiles {
  const brain = read(join(REPO, "berry"), BRAIN_FILES);
  const flash: Record<string, string> = { "autoexec.be": readFileSync(join(REPO, "autoexec.be"), "utf8") };
  if (project) flash[`${project}.jsonl`] = readFileSync(join(SCENARIOS, `${project}.jsonl`), "utf8");
  return {
    tasmota: read(EMBEDDED, [...TASMOTA_LIBRARY, "persist.be"]),
    sim: read(LAYER, ["sim_tasmota.be", ...MODULE_FILES.filter((n) => n !== "persist.be")]),
    brain,
    flash,
  };
}

/** every file the bridge needs: its relay, and its autoexec.be */
export function bridgeFiles(): DeviceFiles {
  return {
    tasmota: read(EMBEDDED, [...TASMOTA_LIBRARY, "persist.be"]),
    sim: read(LAYER, ["sim_tasmota.be", ...MODULE_FILES.filter((n) => n !== "persist.be")]),
    brain: read(join(REPO, "berry"), BRIDGE_FILES),
    flash: { "autoexec.be": readFileSync(join(REPO, "berry/zbbridge_autoexec.be"), "utf8") },
  };
}

/**
 * The Living room's configuration, as the tests of berry/ have it: the same on both
 * panels. The store fits it to the panel's matrix at boot (fit_matrix), and the
 * Living room, 8 × 5, fits the EU's 11 × 5 and the US's 8 × 8 as it is, keeping the
 * room's shape. fixtures/living-room-us.json is the Living room turned by hand, which only the
 * store's tests of the turn read.
 */
export function livingRoomConfig() {
  return JSON.parse(readFileSync(join(REPO, "berry/test/fixtures/living-room.json"), "utf8"));
}

/** a device's flash and settings, as kept() gives them, to boot another from */
export type Flash = ReturnType<SimDevice["kept"]>;

/**
 * The Living room's panel and its bridge in a house of their own: both from their box with the mesh driver in their image, the panel
 * founds its house (house_mesh.be, found_own) and adds the bridge to it as the glass does (zigbee_pairing.be, "Add to this house"): the flash
 * of each, to boot a house from, which has a mesh (await house.enableMesh()) before its devices. The panel's Zigbee is the house's bridge's,
 * and its image has no Z2T: a test of the panel alone stands on a bridge. The adding takes the house some seconds; it is made
 * once a process, through the panel's own Berry, and a house booted from it has the bridge in step in a few seconds.
 */
export function houseFlash(): Promise<{ panel: Flash; bridge: Flash }> {
  return (housed ??= houseOnce());
}
let housed: Promise<{ panel: Flash; bridge: Flash }> | undefined;

async function houseOnce(): Promise<{ panel: Flash; bridge: Flash }> {
  const project = "p1-living-room-eu-landscape";
  const home = new SimHouse({ air: IDEAL_TIMING, loop: IDEAL_LOOP });
  await home.enableMesh();
  const bridge = await SimBridge.create({ house: home, files: bridgeFiles(), mesh: { id: 0 } });
  const panel = await SimPanel.create({ house: home, files: repoFiles(project), project, persist: { panel_config: livingRoomConfig() }, relays: [true, true], mesh: { id: 0 }, onUart: () => {} });
  // the Living room's lamps on the bridge's network, in their groups, as the houses booted from this flash have them: the panel's upkeep of the groups,
  // which starts with its session, finds them as they are
  for (const { spec, groups } of networkOf(livingRoomConfig())) bridge.zigbee.add(spec, groups);
  const berry = `import global
import json
# the groups' upkeep over: no old address to leave, and every member in its group
def _settled()
    var d = global.panel_ui.store.doc
    if size(d["stale"]) > 0 return false end
    for o: d["zones"] + d["buttonGroups"]
        var st = o.find("zstate", {})
        for k: st.keys() if st[k] != "in" return false end end
    end
    return true
end
def _pair_state()
    var s = global.zb_pairing.state()
    var h = global.house
    return json.dump({"found": s["found"], "asking": s["asking"], "result": s["result"], "house": s["house"], "link": s["link"],
                      "founded": h != nil && h.up && h.writes(), "bridges": h != nil && h.up ? size(h.bridges()) : 0, "settled": _settled()})
end
def _pair_run(a) var m = json.load(a) global.zb_pairing.run(m[0], m[1]) return "ok" end`;
  if (panel.vm.run(berry, "pair") !== 0) throw new Error(`the adding's probe: ${panel.vm.error()}`);
  const state = () => JSON.parse(panel.vm.call("_pair_state") ?? "{}");
  const ask = (op: string, args: unknown[] = []) => panel.vm.call("_pair_run", JSON.stringify([op, args]));
  const until = (what: string, ok: () => boolean, ms: number) => {
    for (let t = 0; t < ms && !ok(); t += 100) home.advance(100);
    if (!ok()) throw new Error(`adding the Living room's bridge: ${what} did not come, ${JSON.stringify(state())}`);
  };
  until("the panel's house", () => state().founded === true, 30000);
  bridge.holdButton();
  home.advance(1500);
  ask("discover");
  until("the bridge heard", () => (state().found ?? []).some((f: { name: string }) => f.name === bridge.hostname), 15000);
  const id = state().found.find((f: { name: string }) => f.name === bridge.hostname).id;
  ask("blink", [id]);
  until("its blinking", () => state().asking === "blinking", 10000);
  ask("pair");
  until("the bridge in the house", () => state().asking === "offer" || (state().result === "paired" && state().asking === null), 30000);
  // both on Cottage, nothing is offered; one that is offered is let go
  if (state().asking === "offer") ask("offer", ["no"]);
  until("the bridge in step on the mesh", () => state().bridges === 1 && state().link === true, 60000);
  ask("endPair");
  // the panel's groups moved to the numbers its place in the house gives them, and the lamps in them: what a house booted from this flash
  // has, with nothing left of the move to do
  until("the groups' upkeep over", () => state().settled === true, 600000);
  home.advance(2000);
  return { panel: panel.kept(), bridge: bridge.kept() };
}
