// The room, in the browser: the panel on its wall and its bridge, in one house
// (@nspanel-sim/vm), as the house tests of the VM run them.
//
//   the panel   the ESP32 (the panel's Berry on Tasmota's VM) and the Nextion
//               (the compiled pages on the emulated glass, @nspanel-sim/glass),
//               joined by the UART. It has no Zigbee chip of its own: its
//               Zigbee is the house's bridges'
//   the bridge  the ZBBridge Pro with the relay's Berry, fed by the panel's
//               relays. It comes from its box with no network saved and no
//               device on its Zigbee network, and opens its pairing window as it
//               powers up, so the first boot is the first use: Add to this house
//               on the glass, then the zones and the devices
//   the house   the air between their radios, the networks in range, the
//               house's network and its MQTT broker. Its server, which keeps
//               the backups, is the release server on this PC, paired on a
//               real panel: the page has none, and a panel here says None
//
// The two devices run the images the real ones run, with the ESP-NOW mesh driver
// in both: here the one the vm's tests run (the core the firmware compiles,
// vm/src/mesh-driver.ts), and with it the house's screens.
//
// A restart Tasmota is asked for boots that device again from what it kept, as
// the device does: the flash, the relays, Tasmota's Wi-Fi settings, and the
// lamps as they are. The glass is powered through the panel, and starts again
// with it.
//
// The page drives the clock: every tick runs the house and the glass through
// the milliseconds that passed, in the 5 ms turns of Tasmota's loop. What each
// device keeps in its flash (_persist.json, the NVS, the Wi-Fi saved) is kept in
// the browser too, so an edit made on the glass, or a pairing, is there after a
// reload, as it is after a reboot.
import { IDEAL_LOOP, IDEAL_TIMING, SimBridge, SimHouse, SimPanel, coversOf, networkOf, switchesOf, thermostatsOf, type DeviceOptions, type PanelOptions, type SimDevice } from "@nspanel-sim/vm";
import { Glass } from "@nspanel-sim/glass";
import { bridgeFiles, glassAssets, panelFiles, runtimeManifest } from "./panelFiles";
import type { RuntimeManifest } from "./mirror";

export interface LogLine {
  at: number;
  level: number;
  text: string;
  /** the device whose log it is: the panel's when not said */
  from?: "bridge";
}

export interface WireLine {
  at: number;
  /** "tx" the ESP32 wrote to the glass, "rx" the glass sent back */
  dir: "tx" | "rx";
  text: string;
}

/** The house's broker, and the account the two devices are given for it. */
export const HOUSE_BROKER = { host: "192.168.0.10", port: 1883, user: "home", password: "example1" } as const;

const STORE = (name: string) => `nspanel-sim.flash.${name}`;

// The image on a flash with no record of the mesh, as a device from its box: no number, no key, the mesh off. The panel founds its own house at
// its first second, and Add to this house brings the bridge in. A flash that has the record keeps it, as an OTA does.
const FACTORY_MESH = { id: 0 } as const;
// The configuration a kept flash was first written from: none, a panel as it is flashed, with an empty Home. A flash kept
// from another seed boots as a wiped one would.
const SEED = "empty";
// The house a kept flash is of: a flash of another kept house boots as a wiped one would.
const HOUSE = 1;
const LOG_MAX = 400;

/** what the browser keeps of one device: what a restart keeps of its flash and its settings */
interface Kept {
  persist?: Record<string, unknown>;
  nvm?: Record<string, string>;
  wifi?: DeviceOptions["wifi"];
}

interface Saved {
  seed?: string;
  house?: number;
  panel?: Kept;
  bridge?: Kept;
}

/** bytes as the console shows them: text, with FF FF FF and the 55 BB frames spelled out */
function describe(bytes: Uint8Array, dir: "tx" | "rx"): string[] {
  const out: string[] = [];
  if (dir === "tx") {
    let cur: number[] = [];
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0xff && bytes[i + 1] === 0xff && bytes[i + 2] === 0xff) {
        out.push(new TextDecoder().decode(Uint8Array.from(cur)));
        cur = [];
        i += 2;
      } else cur.push(bytes[i]);
    }
    if (cur.length) out.push(Array.from(cur, (b) => b.toString(16).padStart(2, "0")).join(" "));
    return out;
  }
  if (bytes[0] === 0x55 && bytes[1] === 0xbb) {
    const len = bytes[2] | (bytes[3] << 8);
    return [new TextDecoder().decode(bytes.slice(4, 4 + len))];
  }
  return [Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ")];
}

/** what a device keeps, for the browser: the flash and the Wi-Fi saved, without the networks around */
function keep(device: SimDevice): Kept {
  const k = device.kept();
  const { around: _around, ...wifi } = k.wifi ?? {};
  return { persist: k.persist, nvm: k.nvm, wifi };
}

/** when a device's _persist.json was last written, 0 before it ever was */
function flashTime(device: SimDevice): number {
  return device.vm.exists("/_persist.json") ? device.vm.module.FS.stat("/_persist.json").mtime.getTime() : 0;
}

export class Rig {
  log: LogLine[] = [];
  wire: WireLine[] = [];
  glassNotes: LogLine[] = [];
  beeps = 0;
  /** counts every change a view shows, so React knows when to look again */
  version = 0;
  private timer = 0;
  private last = 0;
  /** the milliseconds not yet run: Tasmota's loop turns in whole 5 ms */
  private owed = 0;
  private listeners = new Set<() => void>();
  /** a restart is under way: the old device is gone and the new one not up yet */
  private rebooting = false;

  readonly name: string;
  readonly house: SimHouse;
  /** the ESP32 on its wall: a new one after every restart */
  panel: SimPanel;
  /** the bridge of the room: a new one after every restart */
  bridge: SimBridge;
  readonly glass: Glass;
  /** where the runtime writes each value: what the React screens read back */
  readonly manifest: RuntimeManifest;
  private constructor(name: string, house: SimHouse, panel: SimPanel, bridge: SimBridge, glass: Glass, manifest: RuntimeManifest) {
    this.name = name;
    this.house = house;
    this.panel = panel;
    this.bridge = bridge;
    this.glass = glass;
    this.manifest = manifest;
  }

  static async create(name: string, deviceId: string, size: { width: number; height: number }): Promise<Rig> {
    const [files, assets, manifest] = await Promise.all([panelFiles(name), glassAssets(name), runtimeManifest(name)]);
    let saved: Saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORE(name)) ?? "{}");
    } catch {
      saved = {};
    }
    // a flash seeded with another configuration, or of the panel alone, boots as a wiped one would
    if ((saved.seed ?? (deviceId === "us-portrait" ? "living-room-us.json" : "living-room.json")) !== SEED || saved.house !== HOUSE) saved = {};
    let rig: Rig | undefined;
    // The radio of this simulator is the idealised one it always had: a frame takes no time on the air, a loop drains the receive
    // queue every turn at no cost, and Z2T says each device 10 ms after the last. The vm's own defaults are the hardware's
    // (vm/src/radio.ts, zigbee.ts), under which a panel of the Living room maps a handful of its 30 lamps from the seed and asks for the rest:
    // that is for the tests to hold, and this screen is for drawing the UI.
    const house = new SimHouse({ broker: HOUSE_BROKER, air: IDEAL_TIMING, loop: IDEAL_LOOP });
    // the mesh's air is the firmware's own (heartbeats every 5 s, its cipher): the images' driver, as the vm's tests run it
    await house.enableMesh();
    const mesh = { mesh: FACTORY_MESH };
    const zigbee = { infoGapMs: 10 };
    const early: Uint8Array[] = [];
    const glass = new Glass(assets.hmi, {
      width: size.width,
      height: size.height,
      fonts: assets.fonts,
      pictures: assets.pictures,
      // to the panel of the house, a new one after a restart: what the glass
      // says while the ESP32 boots is lost, as on the wall
      send: (bytes) => {
        if (!rig) return void early.push(bytes);
        for (const t of describe(bytes, "rx")) rig.push(rig.wire, { at: house.now, dir: "rx", text: t });
        rig.panel.uartReceive(bytes);
      },
      onDiagnostic: (m) => rig?.push(rig.glassNotes, { at: house.now, level: 1, text: m }),
    });
    const mqtt = { host: HOUSE_BROKER.host, port: HOUSE_BROKER.port, user: HOUSE_BROKER.user, password: HOUSE_BROKER.password };
    const bridge = await SimBridge.create({
      house,
      files: bridgeFiles(),
      zigbee,
      mqtt,
      persist: saved.bridge?.persist,
      nvm: saved.bridge?.nvm,
      // from its box: no network saved, and its window opens as it powers up
      wifi: saved.bridge?.wifi ?? { ssid1: "" },
      onLog: (level, text) => rig?.push(rig.log, { at: house.now, level, text, from: "bridge" }),
      onNvm: () => rig?.save(),
      ...mesh,
    });
    const boot: PanelOptions = {
      house,
      zigbee,
      files,
      project: name,
      mqtt,
      // a panel as it is flashed: the empty Home its store makes with no configuration (PanelStore.empty)
      persist: saved.panel?.persist ?? {},
      nvm: saved.panel?.nvm,
      wifi: saved.panel?.wifi,
      relays: [true, true],
      onLog: (level, text) => rig?.push(rig.log, { at: house.now, level, text }),
      onUart: (bytes) => {
        if (rig) for (const t of describe(bytes, "tx")) rig.push(rig.wire, { at: house.now, dir: "tx", text: t });
        glass.receive(bytes);
      },
      onBeep: (n) => {
        if (rig) rig.beeps += n;
      },
      onNvm: () => rig?.save(),
      ...mesh,
    };
    const panel = await SimPanel.create(boot);
    // the lamps and the thermostats of the configuration the panel kept, back on the bridge's network as they were: the simulated network is
    // not in the bridge's flash. A panel as it is flashed has none
    const doc = saved.panel?.persist?.panel_config;
    if (doc) {
      for (const { spec, groups } of networkOf(doc as never)) bridge.zigbee.add(spec, groups);
      for (const t of thermostatsOf(doc as never)) bridge.zigbee.addThermostat(t);
      for (const c of coversOf(doc as never)) bridge.zigbee.addCover(c);
      for (const w of switchesOf(doc as never)) bridge.zigbee.addSwitch(w);
    }
    rig = new Rig(name, house, panel, bridge, glass, manifest);
    for (const b of early) panel.uartReceive(b);
    glass.start();
    return rig;
  }

  private push<T>(list: T[], line: T) {
    list.push(line);
    if (list.length > LOG_MAX) list.splice(0, list.length - LOG_MAX);
  }

  /**
   * Runs the house and the glass through the time that passed, as long as it is
   * started. An interval and not an animation frame: a panel on a wall keeps
   * running when nobody looks at it, and a hidden tab gets no frames at all. The
   * browser slows a background tab's interval to once a second, and a second of
   * the house is what it runs then.
   */
  start() {
    this.last = performance.now();
    this.timer = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(1000, now - this.last);
      this.last = now;
      this.advance(dt);
    }, 16);
  }

  stop() {
    window.clearInterval(this.timer);
  }

  advance(ms: number) {
    if (this.rebooting) return;
    const flash = flashTime(this.panel) + flashTime(this.bridge);
    this.owed += ms;
    while (this.owed >= 5) {
      this.owed -= 5;
      this.house.advance(5);
      this.glass.advance(5);
      if (this.house.devices.some((d) => d.restartDue)) {
        this.owed = 0;
        void this.restart();
        return;
      }
    }
    if (flashTime(this.panel) + flashTime(this.bridge) !== flash) this.save();
    this.version++;
    for (const f of this.listeners) f();
  }

  /** Tasmota restarted on a device: it boots again from what it kept, and the glass with the panel. */
  private async restart() {
    this.rebooting = true;
    this.save();
    try {
      for (const d of await this.house.settle()) {
        if (d instanceof SimPanel) {
          this.panel = d;
          this.push(this.log, { at: this.house.now, level: 2, text: "APP: Restarted" });
          this.glass.start();
        } else if (d instanceof SimBridge) {
          this.bridge = d;
          this.push(this.log, { at: this.house.now, level: 2, text: "APP: Restarted", from: "bridge" });
        }
      }
    } catch (e) {
      this.push(this.log, { at: this.house.now, level: 1, text: `the restart failed: ${String(e)}` });
      // halted, as a device whose restart fails would be: the log says why
      return;
    }
    this.rebooting = false;
    this.version++;
    for (const f of this.listeners) f();
  }

  /** what each device's flash holds, kept in the browser */
  save() {
    try {
      const saved: Saved = { seed: SEED, house: HOUSE, panel: keep(this.panel), bridge: keep(this.bridge) };
      localStorage.setItem(STORE(this.name), JSON.stringify(saved));
    } catch {
      // a private window, or a full storage: the house runs on, and forgets at reload
    }
  }

  /** the flash of both wiped: the panel boots as it is flashed at the next load, and the bridge from its box */
  static forget(name: string) {
    try {
      localStorage.removeItem(STORE(name));
    } catch {
      // nothing kept, nothing to forget
    }
  }

  subscribe(f: () => void) {
    this.listeners.add(f);
    return () => void this.listeners.delete(f);
  }
}
