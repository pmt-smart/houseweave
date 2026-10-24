// A device of the house, simulated: an ESP32 with Tasmota, and Berry on it.
//
// The Berry is the device's own (the classes its firmware carries, berry/*.be,
// and autoexec.be on its file system), on the Berry VM of Tasmota (berry.ts),
// over Tasmota's own Berry library and the natives of tasmota/sim_tasmota.be.
// The WiFi station driver and the ESP-NOW driver are the firmware's, compiled
// into the same module (radio.ts), over a radio the air carries to the other
// devices of the house (house.ts). What is left to this file is what Tasmota's C
// core does around them:
//
//   the loop     FUNC_LOOP's fast loop and deferred functions every 5 ms, the
//                every_50ms / 100ms / 250ms / second events (xdrv_52_9_berry.ino),
//                and the radio drivers' calls in the same turns, after Berry's;
//                but their FUNC_LOOP, where the ESP-NOW driver drains its receive
//                queue, only as often as Tasmota's loop comes round (Sleep, 50 ms
//                by default) and while the drain goes on, item after item, each
//                keeping the loop busy for what it runs (radio.ts, LoopTiming)
//   the boot     the compiler set as Tasmota sets it (globals by name, strict),
//                the init script, the classes the firmware carries, the drivers'
//                FUNC_PRE_INIT and FUNC_INIT, autoexec.be at the first loop
//   the WiFi     Tasmota's commands for it (Wifi, SSId, Password, WifiConfig),
//                its events (Wifi#Connected), and tasmota.wifi(), all over the
//                radio's: the station driver joins, Tasmota's WiFi check connects
//   commands     the device's own (the panel's relays, buttons and buzzer),
//                Tasmota's WiFi, the radio drivers', Z2T's (zigbee.ts), then the
//                ones Berry registered
//   the network  UDP and TCP between the devices of a house, while their WiFi is up
//   the mesh     the ESP-NOW mesh driver of the firmware (xdrv_98_1_espnow_mesh.ino), for a device whose image has it (the `mesh` option, a house with a
//                mesh): mesh-driver.ts. Its Berry functions, its rule events and its commands are the driver's, its loop and its every-second are the
//                main loop's here, and it leaves with the device
//
// The clock is virtual: advance() runs the loop through the milliseconds it is
// given, as fast as the machine allows. A device of a house shares the house's
// clock, and advancing it runs the whole house.
import { Berry } from "./berry.js";
import { sha256, toHex, fromHex } from "./sha256.js";
import { ZigbeeWorld, type ZigbeeWorldOptions } from "./zigbee.js";
import { Air, FUNC, Radio, REAL_LOOP, type LoopTiming, type SimNetwork } from "./radio.js";
import { MESH_BERRY, MeshDriver, type DeviceMeshOptions } from "./mesh-driver.js";
import type { SimHouse, TcpEnd } from "./house.js";

/** Tasmota's own Berry library (berry_tasmota/src/embedded), in the order it is loaded. */
export const TASMOTA_LIBRARY = ["driver_class.be", "tasmota_class.be", "trigger_class.be", "rule_matcher.be"] as const;
/** the modules the devices import that are native in Tasmota: this package's stand-ins, and Tasmota's persist */
export const MODULE_FILES = ["path.be", "crypto.be", "webserver.be", "gpio.be", "mqtt.be", "persist.be"] as const;

export interface DeviceFiles {
  /** Tasmota's library: TASMOTA_LIBRARY and persist.be, by name */
  tasmota: Record<string, string>;
  /** this package's layer: sim_tasmota.be and the module stand-ins, by name */
  sim: Record<string, string>;
  /** the classes the device's firmware carries, by name */
  brain: Record<string, string>;
  /** the device's file system: autoexec.be and its tables, by name */
  flash: Record<string, string>;
}

/**
 * What a house has in range: two access points of the house's network, an
 * Enterprise network no device joins, an open one and a neighbour's.
 */
export const SIM_AIR: SimNetwork[] = [
  { ssid: "Cottage", rssi: -52, auth: 3, channel: 6, bssid: "A0:B7:65:10:00:01", password: "cottagepass" },
  { ssid: "Cottage", rssi: -71, auth: 3, channel: 11, bssid: "A0:B7:65:10:00:02", password: "cottagepass" },
  { ssid: "Office", rssi: -66, auth: 5, channel: 1, bssid: "A0:B7:65:20:00:01", password: "" },
  { ssid: "Cafe", rssi: -74, auth: 0, channel: 1, bssid: "A0:B7:65:30:00:01", password: "" },
  { ssid: "Neighbour", rssi: -83, auth: 7, channel: 11, bssid: "A0:B7:65:40:00:01", password: "neighbour99" },
];

export interface DeviceWifiOptions {
  /** the two networks Tasmota keeps, a device on "Cottage" when not said */
  ssid1?: string;
  ssid2?: string;
  /** their passwords, the air's own for the names when not said */
  passwords?: [string, string];
  /** whether the firmware has the station driver: it has when not said */
  station?: boolean;
  /** the networks in range, when the device is in no house: SIM_AIR when not said */
  around?: SimNetwork[];
  /** WifiConfig, 4 (Retry) when not said */
  config?: number;
}

/** Tasmota's MQTT settings: its host, port, user and password (xdrv_02_9_mqtt.ino) */
export interface DeviceMqttOptions {
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface DeviceOptions {
  files: DeviceFiles;
  /** Tasmota's MQTT settings, none when not said */
  mqtt?: DeviceMqttOptions;
  /** _persist.json as the device boots with it */
  persist?: Record<string, unknown>;
  /** the NVS, as it was saved: "ns/key" -> hex */
  nvm?: Record<string, string>;
  /** the wall clock at boot, epoch seconds, and the timezone in minutes */
  epoch?: number;
  timezone?: number;
  /** a boot after a restart, whose clock the fork's RtcRetain kept (USE_RTC_RETAIN); a first boot is a power-on */
  retained?: boolean;
  onLog?: (level: number, line: string) => void;
  /** the NVS changed: "ns/key" -> hex */
  onNvm?: (key: string, hex: string) => void;
  wifi?: DeviceWifiOptions;
  /** what its Zigbee network does around its answers: the ZbInfo's spacing (zigbee.ts), none as Z2T emits them */
  zigbee?: ZigbeeWorldOptions;
  /** what its main loop spends on the frames the ESP-NOW driver hands it (radio.ts): its house's, or REAL_LOOP when it is in none */
  loop?: Partial<LoopTiming>;
  /** something asked Tasmota to restart: which command */
  onRestart?: (why: string) => void;
  /** the relays at boot, as PowerOnState leaves them: the device's own when not said */
  relays?: boolean[];
  /** the house the device is in: its clock, its air, its network. None: a device alone */
  house?: SimHouse;
  /**
   * The firmware image has the ESP-NOW mesh driver (xdrv_98_1_espnow_mesh.ino): this sets the device up as the bench's `setup` does, when its flash has no record of the
   * mesh, and its Berry has the functions of the driver (espnow_mesh_*). The house needs a mesh (await house.enableMesh()). A restart keeps it: it is the image's.
   */
  mesh?: DeviceMeshOptions;
  /** the station's MAC, which ESP-NOW uses too, and its address on the house's network */
  mac?: string;
  ip?: string;
  /** the device's seed of randomness, for its radio drivers */
  seed?: number;
  /**
   * Tasmota's count of boots, as the flash keeps it (Settings->bootcount): 0 on a
   * configuration that is new, a factory image or a Reset, and 1, a configured
   * device, when not said. Tasmota counts a boot 10 s into it.
   */
  bootcount?: number;
}

/** how far into a boot Tasmota counts it (BOOT_LOOP_TIME) */
const BOOT_COUNT_MS = 10000;

/**
 * Tasmota's WiFi as the device's radio has it: the networks saved, Tasmota's
 * WiFi on or off (`Wifi`), the WiFi Manager `WifiConfig 2` opens, and the tool
 * for a lost network (`WifiConfig`), which only Tasmota's core reads.
 */
export class SimWifi {
  config: number;
  readonly station: boolean;
  private readonly radio: Radio;

  constructor(radio: Radio, config: number, station: boolean) {
    this.radio = radio;
    this.config = config;
    this.station = station;
  }
  /** Tasmota's WiFi, as `Wifi 1` leaves it: the station driver switches it off while it borrows the radio */
  get on(): boolean {
    return this.radio.state().wifi === 1;
  }
  get ssid(): [string, string] {
    return [this.radio.text("ssid1"), this.radio.text("ssid2")];
  }
  get password(): [string, string] {
    return [this.radio.text("password1"), this.radio.text("password2")];
  }
  get manager(): boolean {
    return this.radio.state().manager === 1;
  }
  /** on the network, with its address, as Tasmota's WiFi has adopted the station */
  get up(): boolean {
    const s = this.radio.state();
    return s.associated === 1 && s.wifi === 1 && s.manager === 0;
  }
}

/** a restart's delay, as Tasmota's restart flag counts it down */
const RESTART_MS = 1500;

/**
 * A command line split as Tasmota's command handler splits it (support_command.ino).
 * A leading `_` only keeps the answer off MQTT there, and the rules still get it;
 * here no command's answer is published, and the name goes without it.
 */
export function splitCommand(line: string) {
  const text = line.trim();
  const sp = text.search(/[\s=]/);
  const word = sp < 0 ? text : text.slice(0, sp);
  const data = sp < 0 ? "" : text.slice(sp + 1).trim();
  const m = /^(.*?)(\d*)$/.exec(word)!;
  const usridx = m[2] !== "" && m[1] !== "";
  const head = usridx ? m[1] : word;
  const name = head.length > 1 && head[0] === "_" ? head.slice(1) : head;
  const index = usridx ? Number(m[2]) : 1;
  const state = data.toUpperCase();
  const payload = data === "" ? -99 : state === "ON" ? 1 : state === "OFF" ? 0 : state === "TOGGLE" ? 2 : /^-?\d+/.test(data) ? parseInt(data, 10) : -99;
  return { name, index, usridx, payload, data };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** strftime over an epoch taken as it is (Tasmota formats local time the same way) */
export function strftime(format: string, epoch: number): string {
  const t = new Date(epoch * 1000);
  const map: Record<string, string> = {
    H: pad(t.getUTCHours()), M: pad(t.getUTCMinutes()), S: pad(t.getUTCSeconds()),
    d: pad(t.getUTCDate()), m: pad(t.getUTCMonth() + 1), Y: String(t.getUTCFullYear()), y: pad(t.getUTCFullYear() % 100),
    a: DAYS[t.getUTCDay()], b: MONTHS[t.getUTCMonth()], e: String(t.getUTCDate()).padStart(2, " "), "%": "%",
    j: pad(Math.floor((Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000) + 1, 3),
  };
  return format.replace(/%(.)/g, (_, c: string) => map[c] ?? `%${c}`);
}

/** Tasmota's WifiGetRssiAsQuality */
const quality = (rssi: number) => (rssi <= -100 ? 0 : rssi >= -50 ? 100 : 2 * (rssi + 100));

export abstract class SimDevice {
  relays: boolean[] = [];
  options: Record<number, number> = {};
  /** what Tasmota says is free of the heap, in KB: 128 as the panel's boots, lowered by a test of the code that waits for heap */
  heapFreeKb = 128;
  /** Tasmota's web password (WebPassword), "" for none, as the build leaves it */
  webPassword = "";
  /** Tasmota's MQTT settings, kept through a restart as the flash keeps them */
  mqtt: DeviceMqttOptions;
  /** what the device published, in order */
  readonly published: { topic: string; payload: string; retain: boolean }[] = [];
  /** the topics it subscribed to, as its Berry did: a restart loses them, and its Berry subscribes again */
  readonly mqttTopics = new Set<string>();
  /** what the broker delivered, not read by its Berry yet: [topic, payload] */
  readonly mqttInbox: [string, string][] = [];
  /** Tasmota's commands that came on its cmnd topic, not run yet: [command, payload] */
  readonly mqttCommands: [string, string][] = [];
  /** whether it was on the broker at the last turn, for the retained messages a connection gets */
  mqttWasUp = false;
  nvm: Record<string, string>;
  readonly zigbee: ZigbeeWorld;
  readonly radio: Radio;
  readonly wifi: SimWifi;
  readonly mac: string;
  readonly ip: string;
  /** every restart asked of Tasmota, by the command that asked */
  restarts: string[] = [];
  /** what the command that runs published inside it (Z2T's ZbInfo), for Berry's _cmd to hand the rules before its answer */
  private cmdPublished: string[] = [];
  readonly house?: SimHouse;
  readonly vm: Berry;
  /** the mesh driver, when the device's image has it: made at the drivers' FUNC_PRE_INIT */
  mesh: MeshDriver | undefined;
  protected readonly opts: DeviceOptions;
  private readonly clock: { now: number };
  /** the air a device alone sends on, and nobody hears */
  private readonly air: Air;
  private queue: { at: number; seq: number; json: string; act?: () => void }[] = [];
  private seq = 0;
  private installed = false;
  private early: string[] = [];
  private booted = false;
  private wasUp = false;
  /** when a restart asked for happens, in the virtual millis() */
  private restartAt?: number;
  /** the wall clock at the boot, which a `Time` moves, and the time zone in minutes, which a `Timezone` sets */
  private epoch: number;
  private timezone: number;
  /** Tasmota's Latitude and Longitude, as set */
  private place: { latitude: number; longitude: number } = { latitude: 0, longitude: 0 };
  private readonly seed: number;
  /** the boot count the flash had at this boot, and the virtual millis() it booted at */
  private readonly bootcount: number;
  private readonly bootAt: number;
  /** how the main loop comes round, and what the frames the drain takes cost it */
  readonly loop: LoopTiming;
  private lastPower: boolean[] = [];
  /** the UDP ports this device's sockets listen on, and what reached them */
  readonly udpPorts = new Set<number>();
  readonly udpInbox: { at: number; packet: string }[] = [];
  /** the TCP ends this device holds, by the number its Berry knows them by */
  readonly tcp = new Map<number, TcpEnd>();
  /** the TCP servers this device listens with, by number: their port */
  readonly tcpServers = new Map<number, number>();

  /** the device's hostname, which Tasmota and the ESP-NOW pairing say */
  abstract readonly hostname: string;
  /** the classes the device's firmware carries, in the order they load */
  protected abstract readonly brainFiles: readonly string[];

  protected constructor(vm: Berry, opts: DeviceOptions, defaults: { mac: string; ip: string; relays: number }) {
    this.vm = vm;
    this.opts = opts;
    this.relays = opts.relays ? [...opts.relays] : Array(defaults.relays).fill(false);
    this.lastPower = [...this.relays];
    this.house = opts.house;
    this.clock = opts.house ? opts.house.clock : { now: 0 };
    this.nvm = { ...(opts.nvm ?? {}) };
    // the options' epoch is the wall clock when the device boots, UTC seconds; the device keeps it as the wall clock at millis() 0,
    // which is the same for a device alone and for one that boots at the house's time 0, and not for one that boots later in a
    // house, whose millis() does not start over (a restart: the clock that ran, once and not twice)
    this.epoch = (opts.epoch ?? Math.floor(Date.now() / 1000)) - Math.floor(this.clock.now / 1000);
    this.timezone = opts.timezone ?? -180;
    this.mac = opts.mac ?? defaults.mac;
    this.ip = opts.ip ?? defaults.ip;
    this.seed = opts.seed ?? (parseInt(this.mac.replace(/:/g, "").slice(-6), 16) || 1);
    this.bootcount = opts.bootcount ?? 1;
    this.bootAt = this.clock.now;
    this.loop = { ...(opts.house?.loop ?? REAL_LOOP), ...opts.loop };
    this.mqtt ={ host: "", port: 1883, user: "", password: "", ...(opts.mqtt ?? {}) };
    this.radio = new Radio(vm.module, this.mac);
    this.wifi = new SimWifi(this.radio, opts.wifi?.config ?? 4, opts.wifi?.station ?? true);
    this.air = opts.house?.air ?? new Air();
    this.zigbee = new ZigbeeWorld({
      emit: (json, delay) => this.later(json, delay),
      publish: (json) => this.cmdPublished.push(json),
      now: () => this.now,
      relay: (n) => this.relayOn(n),
      restart: (why) => this.restart(why),
      tick: (fn, delay) => this.later("", delay, fn),
    }, opts.zigbee);
  }

  /** The VM, then the device `make` builds on it, then its flash and its drivers, as a boot has them. */
  protected static async boot<T extends SimDevice>(opts: DeviceOptions, make: (vm: Berry) => T): Promise<T> {
    let dev: T | undefined;
    const vm = await Berry.create({
      print: (line) => opts.onLog?.(2, line),
      host: (op, arg) => dev!.host(op, arg),
      core: {
        millis: () => dev!.now,
        power: (device, state) => dev!.power(device, state),
        beep: (count) => dev!.beep(count),
        log: (level, message) => opts.onLog?.(level, message),
        rules: (_subtopic, json) => dev!.rule(json),
        nvmLoad: (ns, key) => dev!.nvm[`${ns}/${key}`] ?? null,
        nvmSave: (ns, key, hex) => {
          dev!.nvm[`${ns}/${key}`] = hex;
          opts.onNvm?.(`${ns}/${key}`, hex);
        },
      },
    });
    // the compiler as Tasmota sets it before anything is loaded (xdrv_52_9_berry.ino):
    // globals by name, and strict, so a file the device would refuse is refused here
    vm.compiler({ namedGlobals: true, strict: true });
    dev = make(vm);
    dev.install();
    dev.house?.add(dev);
    return dev;
  }

  /** the virtual millis(): the house's, for a device in one */
  get now(): number {
    return this.clock.now;
  }
  set now(ms: number) {
    this.clock.now = ms;
  }

  // --- the flash, and the boot up to the first loop -----------------------------------------

  private install() {
    const { files, persist } = this.opts;
    const vm = this.vm;
    for (const name of MODULE_FILES) {
      const src = name === "persist.be" ? files.tasmota[name] : files.sim[name];
      if (src === undefined) throw new Error(`missing ${name}`);
      vm.writeFile("/" + name, src);
    }
    for (const [name, src] of Object.entries(files.flash)) vm.writeFile("/" + name, this.flashFile(name, src));
    if (persist) vm.writeFile("/_persist.json", JSON.stringify(persist));
    // The names Tasmota's library is compiled against, which the firmware has
    // before any of it runs: `global` (its init script imports it first), the
    // tasmota instance, and the natives its code names -- declared, so the
    // compiler takes them, and never called here (SimTasmota.init replaces the
    // one that is)
    if (vm.run("import global\nvar tasmota, log, ctypes_bytes_dyn, ccronexpr, sortedmap, webclient, wire1, wire2", "prelude") !== 0) throw new Error(vm.error());
    // Tasmota's own Berry library, then the natives it lacks here, then the init script
    for (const name of [...TASMOTA_LIBRARY, "sim_tasmota.be"]) {
      const src = name === "sim_tasmota.be" ? files.sim[name] : files.tasmota[name];
      if (src === undefined) throw new Error(`missing ${name}`);
      if (vm.run(src, name) !== 0) throw new Error(`${name}: ${vm.error()}`);
    }
    // the natives of the mesh driver, which the firmware registers before any Berry of the device runs: the classes that name them are compiled with them there
    if (this.opts.mesh && vm.run(MESH_BERRY, "espnow_mesh.be") !== 0) throw new Error(`espnow_mesh.be: ${vm.error()}`);
    // the classes the firmware carries, which it has before anything of the device runs
    for (const name of this.brainFiles) {
      const src = files.brain[name];
      if (src === undefined) throw new Error(`missing ${name}`);
      if (vm.run(src, name) !== 0) throw new Error(`${name}: ${vm.error()}`);
    }
    this.installed = true;
    // the drivers' FUNC_PRE_INIT and FUNC_INIT: the radio's settings, as Tasmota's
    // were saved, and the networks in range; the ESP-NOW driver reads its record
    // back from the NVS and registers its natives in the VM
    const w = this.opts.wifi ?? {};
    const around = this.house?.networks ?? w.around ?? SIM_AIR;
    const ssid: [string, string] = [w.ssid1 ?? "Cottage", w.ssid2 ?? ""];
    const own = (s: string) => around.find((n) => n.ssid === s)?.password ?? "";
    const passwords = w.passwords ?? [own(ssid[0]), own(ssid[1])];
    this.radio.set("ssid1", ssid[0]);
    this.radio.set("password1", passwords[0]);
    this.radio.set("ssid2", ssid[1]);
    this.radio.set("password2", passwords[1]);
    this.radio.set("friendlyname", this.hostname);
    this.radio.set("hostname", this.hostname);
    this.radio.set("ip", this.ip);
    // the fork turns the Wi-Fi on at every boot
    this.radio.set("wifi", 1);
    this.radio.networks(around);
    this.air.wire(this.vm.module);
    this.vm.module.radioCommand = (line) => void this.console(line);
    this.radio.init(this.seed);
    this.radio.loop(this.loop.cmdMs, this.loop.eventMs);
    this.air.attach(this.radio);
    if (this.opts.mesh) {
      if (!this.house?.mesh) throw new Error("a device with the mesh driver needs a house that has a mesh: await house.enableMesh()");
      this.mesh = new MeshDriver(this, this.house.mesh, this.opts.mesh);
    }
    this.init();
    for (const json of this.early.splice(0)) this.rule(json);
  }

  /** the drivers' FUNC_PRE_INIT beyond the radio's: the device's own */
  protected init() {}

  /** a file of the flash as the device has it: the panel names its project in autoexec.be */
  protected flashFile(_name: string, src: string): string {
    return src;
  }

  // --- the loop ------------------------------------------------------------------------------

  /** Runs Tasmota's loop through `ms` of virtual time, in the 5 ms turns of its sleep loop: the whole house's, for a device in one. */
  advance(ms: number) {
    if (this.house) return this.house.advance(ms);
    const end = this.now + ms;
    while (this.now < end) {
      const before = this.now;
      this.now = Math.min(end, before + 5);
      this.step(before);
    }
  }

  /** One turn of the loop, from `before` to now. */
  step(before: number) {
    this.deliver();
    if (this.booted) this.runMqttCommands();
    const crossed = (period: number) => Math.floor(this.now / period) > Math.floor(before / period);
    const due: string[] = [];
    if (crossed(50)) {
      this.systemEvents();
      this.every50();
      due.push("every_50ms");
    }
    if (crossed(100)) due.push("every_100ms");
    if (crossed(250)) due.push("every_250ms");
    if (crossed(1000)) due.push("every_second");
    if (!this.booted) {
      // FUNC_LOOP's first turn: autoexec.be, once every driver is up
      this.booted = true;
      this.vm.call("sim_autoexec");
    }
    this.vm.call("sim_tick", JSON.stringify(due));
    // the radio drivers, after Berry's (xdrv_96, xdrv_98): FUNC_LOOP when Tasmota's loop comes round, and again every
    // turn while the drain waits for the item it took to be run
    const round = this.loop.loopMs <= 5 || Math.floor((this.now - this.bootAt) / this.loop.loopMs) > Math.floor((before - this.bootAt) / this.loop.loopMs);
    if (round || this.radio.draining()) this.radio.tick(FUNC.LOOP);
    if (crossed(100)) this.radio.tick(FUNC.EVERY_100_MSECOND);
    if (crossed(250)) this.radio.tick(FUNC.EVERY_250_MSECOND);
    if (crossed(1000)) this.radio.tick(FUNC.EVERY_SECOND);
    // the mesh driver (xdrv_98_1), after the `direct` link's: FUNC_LOOP when Tasmota's loop comes round, and its every-second
    if (this.mesh) {
      if (round) this.mesh.loop();
      if (crossed(1000)) this.mesh.everySecond();
    }
    this.wifiEvents();
  }

  /** every 50 ms, before Berry's: the device's own (the panel's relays and buttons) */
  protected every50() {}

  /**
   * Tasmota's MqttDataHandler: a command on cmnd/<topic>/<command> runs as the
   * console runs it, and its result goes to stat/<topic>/RESULT.
   */
  private runMqttCommands() {
    while (this.mqttCommands.length > 0) {
      const [command, payload] = this.mqttCommands.shift()!;
      const result = this.console(payload === "" ? command : `${command} ${payload}`);
      if (result !== null && this.mqttConnected) this.house?.mqttPublish(`stat/${this.mqttTopic}/RESULT`, result, false, this.mac);
    }
  }

  /** Tasmota's WiFi events, as the rules get them: Wifi#Connected and Wifi#Disconnected */
  private wifiEvents() {
    const up = this.wifi.up;
    if (up === this.wasUp) return;
    this.wasUp = up;
    if (!up) this.house?.dropped(this);
    this.rule(JSON.stringify({ Wifi: up ? { Connected: 1 } : { Disconnected: 1 } }));
  }

  /** payloads for the rules, when their time comes: the network's answers, after what they report is so */
  protected later(json: string, delay: number, act?: () => void) {
    this.queue.push({ at: this.now + delay, seq: this.seq++, json, act });
    this.queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
  }

  private deliver() {
    // what a command run here, and not through Berry's _cmd (a Backlog's), published: the rules get it now
    for (const json of this.cmdPublished.splice(0)) this.rule(json);
    while (this.queue.length > 0 && this.queue[0].at <= this.now) {
      const item = this.queue.shift()!;
      item.act?.();
      if (item.json !== "") this.rule(item.json);
    }
  }

  /** one NVS entry written, as the drivers' NvmSave does: "ns/key" -> hex */
  nvmWrite(key: string, hex: string) {
    this.nvm[key] = hex;
    this.opts.onNvm?.(key, hex);
  }

  /** AddLog: a line of Tasmota's log */
  logLine(level: number, line: string) {
    this.opts.onLog?.(level, line);
  }

  /** a rules process: the payload goes to Tasmota's rule engine, in Berry */
  rule(json: string) {
    if (!this.installed) {
      this.early.push(json);
      return;
    }
    this.vm.call("sim_rule", json);
  }

  // --- relays -----------------------------------------------------------------------------------

  /** ExecuteCommandPower: device is 1-based, state POWER_OFF 0, POWER_ON 1, POWER_TOGGLE 2 */
  power(device: number, state: number) {
    const i = device - 1;
    if (i < 0 || i >= this.relays.length) return;
    const on = state === 2 ? !this.relays[i] : state === 1;
    if (this.relays[i] === on) return;
    this.relays[i] = on;
    this.opts.onLog?.(2, `SRC: power ${device} ${on ? "ON" : "OFF"}`);
    this.zigbee.relayChanged(device, on);
    this.house?.relayChanged(this, device, on);
  }

  /** the relays' transitions, every 50 ms (xdrv_10_system_events.ino) */
  private systemEvents() {
    this.relays.forEach((on, i) => {
      if (on === this.lastPower[i]) return;
      this.lastPower[i] = on;
      this.rule(JSON.stringify({ [`Power${i + 1}`]: { State: on ? 1 : 0 } }));
    });
  }

  /** a relay that feeds lamps of this device's network: its own, or, on a device with none, the house's panel's */
  private relayOn(n: number): boolean {
    if (this.relays.length > 0) return this.relays[n - 1] ?? false;
    return this.house?.relay(n) ?? false;
  }

  /** the buzzer, on a device that has one */
  protected beep(_count: number) {}

  // --- commands, the console, the Web UI ---------------------------------------------------------

  /** A command of Tasmota's core or of a C driver: its response, or null for Berry's to try. */
  command(line: string): string | null {
    const { name, index, usridx, payload, data } = splitCommand(line);
    const lower = name.toLowerCase();
    if (lower === "power") {
      if (payload >= 0 && payload <= 2) this.power(index, payload);
      return JSON.stringify({ [`POWER${index}`]: this.relays[index - 1] ? "ON" : "OFF" });
    }
    if (lower === "setoption" && usridx) {
      if (payload >= 0) this.options[index] = payload;
      return JSON.stringify({ [`SetOption${index}`]: (this.options[index] ?? 0) ? "ON" : "OFF" });
    }
    if (lower === "webpassword") {
      // as xdrv_01_9_webserver.ino has it: `"` or 0 clears it, 1 sets the build's,
      // which is none, and WebPassword2, or no value, answers with asterisks
      if (data !== "") this.webPassword = data === '"' || data === "0" || data === "1" ? "" : data;
      return JSON.stringify({ WebPassword: data === "" || (usridx && index === 2) ? "****" : this.webPassword });
    }
    const time = this.timeCommand(lower, data);
    if (time !== null) return time;
    const own = this.ownCommand(lower, index, usridx, payload, data);
    if (own !== null) return own;
    const wifi = this.wifiCommand(lower, index, usridx, payload, data);
    if (wifi !== null) return wifi;
    const mqtt = this.mqttCommand(lower, index, payload, data);
    if (mqtt !== null) return mqtt;
    // the mesh driver's commands (xdrv_98_1), when the image has it
    const mesh = this.mesh?.command(name, data) ?? null;
    if (mesh !== null) return mesh;
    // the radio drivers: a firmware with no station driver has no Sta commands
    if (this.wifi.station || !lower.startsWith("sta")) {
      const radio = this.radio.command(name, index, usridx, payload, data);
      if (radio !== null) return radio;
    }
    const after = this.driverCommand(name, index, usridx, payload, data);
    if (after !== null) return after;
    return this.z2t() ? this.zigbee.command(name, data) : null;
  }

  /**
   * Tasmota's clock, as support_command.ino answers it: `Time <epoch>` sets the clock (an epoch from 2016 on) and
   * raises Time#Set, as RtcSync does, with the minutes past local midnight; 1 to 4 choose a format, and 0 gives the
   * clock back to the NTP, which the simulation does not have. `Timezone` takes whole hours, and `Latitude` and
   * `Longitude` a decimal.
   */
  private timeCommand(lower: string, data: string): string | null {
    const utc = () => this.epoch + Math.floor(this.now / 1000);
    if (lower === "time") {
      const n = Number(data);
      if (data !== "" && Number.isInteger(n) && n >= 1451602800) {
        this.epoch = n - Math.floor(this.now / 1000);
        const local = utc() + this.timezone * 60;
        this.later(JSON.stringify({ Time: { Set: Math.floor((local % 86400) / 60) } }), 50);
      }
      return JSON.stringify({ Time: new Date((utc() + this.timezone * 60) * 1000).toISOString().slice(0, 19), Epoch: utc() });
    }
    if (lower === "timezone") {
      const n = Number(data);
      if (data !== "" && Number.isInteger(n) && n >= -13 && n <= 14) this.timezone = n * 60;
      const h = Math.trunc(this.timezone / 60);
      return JSON.stringify({ Timezone: `${h < 0 ? "-" : "+"}${String(Math.abs(h)).padStart(2, "0")}:${String(Math.abs(this.timezone % 60)).padStart(2, "0")}` });
    }
    // the fork's RtcRetain: this boot's time was kept across the restart, which took no time here
    if (lower === "rtcretain") {
      return JSON.stringify({ RtcRetain: { Restored: this.opts.retained && this.epoch >= 1451602800 ? 1 : 0, Gap: 0 } });
    }
    if (lower === "latitude" || lower === "longitude") {
      const key = lower as "latitude" | "longitude";
      const n = Number(data);
      if (data !== "" && Number.isFinite(n)) this.place[key] = n;
      return JSON.stringify({ [key === "latitude" ? "Latitude" : "Longitude"]: this.place[key] });
    }
    return null;
  }

  /** the device's own commands, after Tasmota's relays and options (the panel's Buzzer) */
  protected ownCommand(_lower: string, _index: number, _usridx: boolean, _payload: number, _data: string): string | null {
    return null;
  }

  /** a C driver of the device's, after the radio's (the panel's button driver) */
  protected driverCommand(_name: string, _index: number, _usridx: boolean, _payload: number, _data: string): string | null {
    return null;
  }

  /**
   * Tasmota's WiFi commands, as support_command.ino answers them: `Wifi`,
   * `SSId`, `Password`, `WifiConfig`, `Restart`, and `Backlog` for the lines
   * Berry sends together. A setting that restarts Tasmota there is a restart
   * asked for here (`restarts`), and the device goes on as it was.
   */
  private wifiCommand(lower: string, index: number, usridx: boolean, payload: number, data: string): string | null {
    const w = this.wifi;
    const cleared = data === '"' || data === "0";
    if (lower === "backlog" || lower === "backlog0") {
      for (const part of data.split(";")) if (part.trim() !== "") this.command(part.trim());
      return JSON.stringify({ Backlog: "Appended" });
    }
    if (lower === "wifi") {
      if (payload === 0 || payload === 1) this.radio.set("wifi", payload);
      return JSON.stringify({ Wifi: w.on ? "ON" : "OFF", WifiMode: "HT20" });
    }
    if (lower === "ssid") {
      if (!usridx) return JSON.stringify({ SSId1: w.ssid[0], SSId2: w.ssid[1] });
      if (index < 1 || index > 2) return null;
      if (data !== "") {
        this.radio.set(`ssid${index}`, cleared ? "" : data);
        this.restart(`SSId${index}`);
      }
      return JSON.stringify({ [`SSId${index}`]: w.ssid[index - 1] });
    }
    if (lower === "password") {
      if (!usridx || index < 1 || index > 2) return null;
      if (data.length > 4 || cleared) {
        this.radio.set(`password${index}`, cleared ? "" : data);
        this.restart(`Password${index}`);
      }
      return JSON.stringify({ [`Password${index}`]: "****" });
    }
    if (lower === "wificonfig") {
      if (payload >= 0 && payload < 8) {
        w.config = payload;
        // the Wi-Fi Manager opens at the next Wi-Fi check, which runs with the Wi-Fi on
        if (payload === 2 && w.on) this.radio.set("manager", 1);
      }
      const names = ["Restart", "", "WiFiManager", "", "Retry", "Wait", "Serial", "WiFiManagerResetOnly"];
      return JSON.stringify({ WifiConfig: `${w.config} (${names[w.config] ?? ""})` });
    }
    // Status 11, the device's state, as MqttShowState writes its WiFi part: with
    // Tasmota's WiFi up, the network, its access point and the radio's channel
    if (lower === "status" && payload === 11) {
      const st: Record<string, unknown> = {};
      const r = this.radio.state();
      if (r.wifiDown === 0) {
        st.Wifi = { AP: 1, SSId: w.ssid[0], BSSId: r.bssid, Channel: r.channel, Mode: "HT20", RSSI: quality(r.rssi), Signal: r.rssi,
                    LinkCount: 1, Downtime: "0T00:00:00" };
      }
      return JSON.stringify({ StatusSTS: st });
    }
    if (lower === "restart") {
      if (payload === 1) this.restart("Restart 1");
      // 99 restarts at once, without saving the settings in memory over the file (support_command.ino): a restore that wrote them (node_settings.be)
      if (payload === 99) {
        this.restart("Restart 99");
        this.restartAt = this.now;
      }
      return JSON.stringify({ Restart: payload === 1 || payload === 99 ? "Restarting" : "1 to restart" });
    }
    return null;
  }

  /**
   * Tasmota's MQTT settings, as xdrv_02_9_mqtt.ino answers them: each set asks
   * for a restart, a quote or a 0 clears, and the password is answered in
   * asterisks, or with itself when set by `MqttPassword` alone, as Tasmota does.
   */
  private mqttCommand(lower: string, index: number, payload: number, data: string): string | null {
    const m = this.mqtt;
    const value = data === '"' || data === "0" ? "" : data;
    if (lower === "mqtthost" || lower === "mqttuser") {
      const key = lower === "mqtthost" ? "host" : "user";
      if (data !== "") {
        m[key] = value;
        this.restart(lower === "mqtthost" ? "MqttHost" : "MqttUser");
      }
      return JSON.stringify({ [lower === "mqtthost" ? "MqttHost" : "MqttUser"]: m[key] });
    }
    if (lower === "mqttport") {
      if (payload > 0 && payload < 65536) {
        m.port = payload === 1 ? 1883 : payload;
        this.restart("MqttPort");
      }
      return JSON.stringify({ MqttPort: m.port });
    }
    // its topics, as Tasmota's defaults make them: tasmota_ and the MAC's last six digits
    if (lower === "topic") return JSON.stringify({ Topic: this.mqttTopic });
    if (lower === "fulltopic") return JSON.stringify({ FullTopic: "%prefix%/%topic%/" });
    // Prefix1 to Prefix3, the index split from the name as CommandHandler splits it
    if (lower === "prefix" && index >= 1 && index <= 3) return JSON.stringify({ [`Prefix${index}`]: ["cmnd", "stat", "tele"][index - 1] });
    if (lower === "devicename") return JSON.stringify({ DeviceName: "NSPanel" });
    if (lower === "mqttpassword") {
      if (data !== "") {
        m.password = value;
        this.restart("MqttPassword");
        if (index !== 2) return JSON.stringify({ MqttPassword: m.password });
      }
      return JSON.stringify({ [`MqttPassword${index === 2 ? "2" : ""}`]: "****" });
    }
    return null;
  }

  /** Tasmota's Topic, its default: tasmota_ and the last six hex digits of the MAC */
  get mqttTopic(): string {
    return "tasmota_" + this.mac.replace(/:/g, "").slice(-6).toUpperCase();
  }

  /** on the house's broker: the WiFi up, and the broker's address, port and credentials the ones set */
  get mqttConnected(): boolean {
    return this.wifi.up && this.mqtt.host !== "" && (this.house?.broker?.(this.mqtt) ?? false);
  }

  protected restart(why: string) {
    this.restarts.push(why);
    this.opts.onLog?.(2, `APP: Restarting (${why})`);
    this.opts.onRestart?.(why);
    // Tasmota restarts once its restart flag has counted down, a second or two
    // after the command (support_tasmota.ino): whoever runs the device boots it again then
    this.restartAt ??= this.now + RESTART_MS;
  }

  /** a restart asked for is due: whoever runs the device boots it again (reboot) */
  get restartDue(): boolean {
    return this.restartAt !== undefined && this.now >= this.restartAt;
  }

  /**
   * What a restart keeps: the flash (the persist file and the NVS, where the
   * ESP-NOW driver keeps its record), the relays, which the panel's hold through
   * a reset (as seen on the bench), Tasmota's WiFi settings and the
   * wall clock. The WiFi Manager and the radio held are not kept: they end with the
   * restart.
   */
  kept(): Pick<DeviceOptions, "persist" | "nvm" | "wifi" | "mqtt" | "epoch" | "timezone" | "retained" | "house" | "mac" | "ip" | "seed" | "relays" | "bootcount" | "mesh"> {
    const w = this.wifi;
    const persist = this.vm.exists("/_persist.json") ? JSON.parse(this.vm.readFile("/_persist.json")) : this.opts.persist;
    return {
      persist,
      nvm: { ...this.nvm },
      wifi: { ssid1: w.ssid[0], ssid2: w.ssid[1], passwords: w.password, config: w.config, station: w.station, around: this.opts.wifi?.around },
      mqtt: { ...this.mqtt },
      // the clock runs on through a restart, as the RTC's does (the fork's RtcRetain), and a power cycle loses it: the wall clock now
      epoch: this.powerLost ? 0 : this.epoch + Math.floor(this.now / 1000),
      timezone: this.timezone,
      retained: !this.powerLost,
      house: this.house,
      mac: this.mac,
      ip: this.ip,
      relays: [...this.relays],
      seed: this.seed + 7919,
      bootcount: this.bootCountNow(),
      mesh: this.opts.mesh,
    };
  }

  /** the boot count as Tasmota has it now: one more once this boot has lasted 10 s */
  private bootCountNow(): number {
    return this.now - this.bootAt >= BOOT_COUNT_MS ? this.bootcount + 1 : this.bootcount;
  }

  /** A restart as Tasmota makes it: a new device from what this one kept (panel.ts, bridge.ts). */
  abstract reboot(opts: DeviceOptions): Promise<SimDevice>;

  /** the restart due, with the options the device booted with */
  restartNow(): Promise<SimDevice> {
    return this.reboot(this.opts);
  }

  /** a power cycle: a restart whose wall clock is lost with the power, as the RTC's is; the flash keeps the rest */
  private powerLost = false;
  powerCycle(): Promise<SimDevice> {
    this.powerLost = true;
    return this.reboot(this.opts);
  }

  /** Out of the house, as unplugged: gone from the air and the network. */
  unplug() {
    this.leave();
  }

  /** The device gone, as a restart takes it: its radio off the air, its connections cut. */
  protected leave() {
    this.mesh?.detach();
    this.air.detach(this.radio);
    this.house?.remove(this);
  }

  /** a line typed in the console: every command, Berry's included; the answer as JSON */
  console(line: string): string | null {
    return this.vm.call("sim_cmd", line);
  }

  /** a page of the Web UI a Berry driver added (webserver.on) */
  web(uri: string, args: [string, string][] = [], method: "GET" | "POST" = "GET"): { body?: string; redirect?: string; status?: number } {
    const r = this.vm.call("sim_web", JSON.stringify({ uri, method: method === "GET" ? 1 : 2, args }));
    return r ? JSON.parse(r) : { status: 500 };
  }

  // --- the natives' side: Berry's _host(op, arg) -----------------------------------------------

  /** a host operation of the device's own (the panel's UART, the bridge's LED), or undefined when it has none */
  protected ownHost(_op: string, _arg: string | null): string | null | undefined {
    return undefined;
  }

  /**
   * Whether the device's image has Zigbee2Tasmota (USE_ZIGBEE), and with it the zigbee module and the Zb commands: the
   * bridge's does; the panel's, since its Zigbee is the bridge's, does not.
   */
  protected z2t(): boolean {
    return true;
  }

  private host(op: string, arg: string | null): string | null {
    const own = this.ownHost(op, arg);
    if (own !== undefined) return own;
    if (op.startsWith("mesh_")) return this.mesh?.host(op, arg) ?? null;
    const fs = this.vm.module.FS;
    switch (op) {
      case "millis": return String(this.now | 0);
      case "delay": this.now += Number(arg); return null;
      case "bootcount": return String(this.bootCountNow());
      case "heap": return String(this.heapFreeKb);
      case "rtc": {
        // Tasmota works the zone out only once the clock is set (support_rtc.ino, RtcSecond): 0 before, and local = utc
        const utc = this.epoch + Math.floor(this.now / 1000);
        const zone = utc > 1451606400 ? this.timezone : 0;
        return JSON.stringify({ utc, local: utc + zone * 60, restart: this.epoch, timezone: zone, config_time: this.epoch });
      }
      case "strftime": {
        const [format, t] = JSON.parse(arg!);
        return strftime(format, t);
      }
      case "time_dump": {
        const t = new Date(Number(arg) * 1000);
        return JSON.stringify({ year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate(), hour: t.getUTCHours(),
          min: t.getUTCMinutes(), sec: t.getUTCSeconds(), weekday: t.getUTCDay(), epoch: Number(arg) });
      }
      case "hostname": return this.hostname;
      case "wifi": {
        // on the network once Tasmota's WiFi adopted the station: the WiFi
        // Manager's WiFi.disconnect() takes the station off it
        // Tasmota's AA:BB:CC:DD:EE:FF, from a MAC given with its colons or without
        const mac = this.mac.replace(/[^0-9A-Fa-f]/g, "").toUpperCase().match(/../g)!.join(":");
        if (!this.wifi.up) return JSON.stringify({ mac, up: false });
        const s = this.radio.state();
        return JSON.stringify({ up: true, ip: this.ip, mac, rssi: s.rssi, quality: quality(s.rssi), ssid: s.station });
      }
      case "log": {
        const sp = arg!.indexOf(" ");
        this.opts.onLog?.(Number(arg!.slice(0, sp)), arg!.slice(sp + 1));
        return null;
      }
      case "publish": {
        const [topic, payload] = JSON.parse(arg!);
        this.opts.onLog?.(3, `MQT: ${topic} = ${payload}`);
        return null;
      }
      case "mqtt_connected": return this.mqttConnected ? "1" : "0";
      case "mqtt_publish": {
        const [topic, payload, retain] = JSON.parse(arg!) as [string, string, boolean];
        if (!this.mqttConnected) return "0";
        this.published.push({ topic, payload, retain });
        this.house?.mqttPublish(topic, payload, retain, this.mac);
        return "1";
      }
      case "mqtt_subscribe":
        this.mqttTopics.add(arg!);
        this.house?.mqttSubscribed(this, arg!);
        return null;
      case "mqtt_unsubscribe":
        this.mqttTopics.delete(arg!);
        return null;
      case "mqtt_read": {
        const m = this.mqttInbox.shift();
        return m ? JSON.stringify(m) : null;
      }
      case "cmd": return this.command(arg!);
      case "cmd_published": return this.cmdPublished.length > 0 ? JSON.stringify(this.cmdPublished.splice(0)) : null;
      case "option": return String(this.options[Number(arg)] ?? 0);
      case "power": return JSON.stringify(this.relays);
      case "power_set": {
        const [i, v] = arg!.split(",").map(Number);
        this.power(i + 1, v);
        return null;
      }
      case "udp_begin":
        this.udpPorts.add(Number(arg));
        return "1";
      case "udp_send": {
        const [ip, port, text] = JSON.parse(arg!);
        return this.wifi.up && this.house ? (this.house.udp(this, ip, Number(port), text) ? "1" : "0") : "0";
      }
      case "udp_read": {
        if (this.udpInbox.length === 0 || this.udpInbox[0].at > this.now) return null;
        return this.udpInbox.shift()!.packet;
      }
      case "tcp_listen": return String(this.house ? this.house.tcpListen(this, Number(arg)) : 0);
      case "tcp_hasclient": return this.house?.tcpPending(this, Number(arg)) ? "1" : "0";
      case "tcp_accept": return String(this.house?.tcpAccept(this, Number(arg)) ?? 0);
      case "tcp_unlisten":
        this.house?.tcpUnlisten(this, Number(arg));
        return null;
      case "tcp_connect": {
        const [ip, port] = JSON.parse(arg!);
        return String(this.house && this.wifi.up ? this.house.tcpConnect(this, ip, Number(port)) : 0);
      }
      case "tcp_state": {
        const end = this.tcp.get(Number(arg));
        return end === undefined ? "closed" : end.state;
      }
      case "tcp_available": return String(this.tcp.get(Number(arg))?.inbox.length ?? 0);
      case "tcp_read": {
        const end = this.tcp.get(Number(arg));
        if (end === undefined) return "";
        const text = end.inbox;
        end.inbox = "";
        return text;
      }
      case "tcp_write": {
        const [n, text] = JSON.parse(arg!);
        return String(this.house?.tcpWrite(this, Number(n), text) ?? 0);
      }
      case "tcp_close":
        this.house?.tcpClose(this, Number(arg));
        return null;
      case "tcp_info": {
        const end = this.tcp.get(Number(arg));
        return JSON.stringify(end ? { remote_addr: end.remote, remote_port: end.remotePort, local_port: end.localPort } : {});
      }
      case "sha256": return toHex(sha256(fromHex(arg!)));
      case "random": {
        const b = new Uint8Array(Number(arg));
        globalThis.crypto.getRandomValues(b);
        return toHex(b);
      }
      case "fs_exists": return this.vm.exists(arg!) ? "1" : "0";
      case "fs_isdir": return this.vm.exists(arg!) && fs.isDir(fs.stat(arg!).mode) ? "1" : "0";
      case "fs_remove":
        if (!this.vm.exists(arg!)) return "0";
        this.vm.remove(arg!);
        return "1";
      case "fs_rename": {
        const [from, to] = JSON.parse(arg!);
        if (!this.vm.exists(from)) return "0";
        this.vm.rename(from, to);
        return "1";
      }
      case "fs_mkdir": this.vm.mkdirp(arg!); return "1";
      case "fs_mtime": return this.vm.exists(arg!) ? String(Math.floor(fs.stat(arg!).mtime.getTime() / 1000)) : null;
      case "fs_list": return JSON.stringify(this.vm.list(arg!));
      // a device with no LED of its template's: no pin, and nothing to light
      case "gpio_pin": return "-1";
      case "gpio_read": return "0";
      case "gpio_write": return null;
      case "zb_image": return this.z2t() ? "1" : "0";
      case "zb_started": return "1";
      case "zb_devices": return JSON.stringify(this.zigbee.moduleDevices());
      case "web_send": return null;
      default:
        this.opts.onLog?.(1, `SIM: no host op ${op}`);
        return null;
    }
  }
}

