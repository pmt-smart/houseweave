// Everything the simulated panel and its bridge are made of, as the browser gets
// it: the same files the two carry, read from the repo by the dev server.
//
//   the ESP32  Tasmota's own Berry library (the firmware submodule), the
//              simulator's natives for it (vm/tasmota), the brain the firmware
//              carries (berry/*.be), and the panel's file system: autoexec.be
//              and the project's generated tables; the bridge's, its relay
//              and its autoexec.be
//   the glass  the scenario the .tft is compiled from, its fonts and pictures
//   the React  the manifest of what the runtime writes where (mirror.ts)
//
// Nothing here is rewritten for the simulator; an edit to any of these files
// is on the simulated panel at the next load (vite.config.ts watches them).
import { BRAIN_FILES, BRIDGE_FILES, MODULE_FILES, TASMOTA_LIBRARY, type DeviceFiles, type PanelFiles } from "@nspanel-sim/vm";
import { fontOf, pictureOf, readScenario, type HmiDef, type Picture } from "@nspanel-sim/glass";
import type { ZiFont } from "@nspanel-sim/export";
import type { RuntimeManifest } from "./mirror";

const embedded = import.meta.glob("../../../../firmware/tasmota/lib/libesp32/berry_tasmota/src/embedded/*.be", {
  eager: true, query: "?raw", import: "default",
}) as Record<string, string>;
const layer = import.meta.glob("../../vm/tasmota/*.be", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const berry = import.meta.glob("../../../../berry/*.be", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const autoexec = import.meta.glob("../../../../autoexec.be", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const bridgeAutoexec = import.meta.glob("../../../../berry/zbbridge_autoexec.be", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const runtimes = import.meta.glob("../../export/hmi-scenarios/p1-*.jsonl", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;
const scenarios = import.meta.glob(["../../export/hmi-scenarios/p1-*-landscape.json", "../../export/hmi-scenarios/p1-*-portrait.json"], {
  import: "default",
}) as Record<string, () => Promise<unknown>>;
const manifests = import.meta.glob("../../export/hmi-scenarios/p1-*.runtime.json", { import: "default" }) as Record<string, () => Promise<unknown>>;
const fontUrls = import.meta.glob("../../themes/*/fonts/*.zi", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

const byName = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([k, v]) => [k.slice(k.lastIndexOf("/") + 1), v]));

/** the generated project a Living room layout compiles to */
export const projectName = (projectId: string, deviceId: string) => `p1-${projectId}-${deviceId}`;

export function hasProject(name: string): boolean {
  return `../../export/hmi-scenarios/${name}.json` in scenarios;
}

/** the ESP32's files for a generated project */
export async function panelFiles(name: string): Promise<PanelFiles> {
  const lib = byName(embedded);
  const sim = byName(layer);
  const sources = byName(berry);
  const brain = Object.fromEntries(BRAIN_FILES.map((n) => [n, sources[n]]));
  const flash: Record<string, string> = { "autoexec.be": Object.values(autoexec)[0] };
  const runtime = runtimes[`../../export/hmi-scenarios/${name}.jsonl`];
  if (runtime) flash[`${name}.jsonl`] = await runtime();
  return {
    tasmota: Object.fromEntries([...TASMOTA_LIBRARY, "persist.be"].map((n) => [n, lib[n]])),
    sim: Object.fromEntries(["sim_tasmota.be", ...MODULE_FILES.filter((n) => n !== "persist.be")].map((n) => [n, sim[n]])),
    brain,
    flash,
  };
}

/** the bridge's files: the relay its image compiles, and its autoexec.be, which is berry/zbbridge_autoexec.be (files-node.ts) */
export function bridgeFiles(): DeviceFiles {
  const lib = byName(embedded);
  const sim = byName(layer);
  const sources = byName(berry);
  return {
    tasmota: Object.fromEntries([...TASMOTA_LIBRARY, "persist.be"].map((n) => [n, lib[n]])),
    sim: Object.fromEntries(["sim_tasmota.be", ...MODULE_FILES.filter((n) => n !== "persist.be")].map((n) => [n, sim[n]])),
    brain: Object.fromEntries(BRIDGE_FILES.map((n) => [n, sources[n]])),
    flash: { "autoexec.be": Object.values(bridgeAutoexec)[0] },
  };
}

export interface GlassAssets {
  hmi: HmiDef;
  fonts: (ZiFont | undefined)[];
  pictures: Picture[];
}

/** the glass's side: the compiled pages, their fonts and their pictures */
export async function glassAssets(name: string): Promise<GlassAssets> {
  const load = scenarios[`../../export/hmi-scenarios/${name}.json`];
  if (!load) throw new Error(`no scenario ${name}: run export/scripts/build-project-hmi.mjs`);
  const hmi = readScenario(await load());
  const fonts = await Promise.all(hmi.fonts.map(async (file) => {
    const url = fontUrls[file];
    if (!url) return undefined;
    return fontOf(new Uint8Array(await (await fetch(url)).arrayBuffer()));
  }));
  return { hmi, fonts, pictures: hmi.pictures.map(pictureOf) };
}

/** where the generated runtime writes each value, for the React screens to read it back */
export async function runtimeManifest(name: string): Promise<RuntimeManifest> {
  const load = manifests[`../../export/hmi-scenarios/${name}.runtime.json`];
  if (!load) throw new Error(`no manifest ${name}: run export/scripts/build-project-hmi.mjs`);
  return (await load()) as RuntimeManifest;
}
