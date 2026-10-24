// Devices whose WiFi station driver and ESP-NOW driver are the firmware's own,
// compiled from the fork's source (native/radio_core.cpp), and the air between
// them.
//
// A Radio is the two drivers of one module instance: one device's state, as on
// the hardware. The simulated panel and bridge (device.ts) have one in the module
// their Berry runs in; a RadioDevice is a module with the drivers and nothing
// else, for the tests of the drivers themselves.
//
// The air carries what a device's ESP-NOW sends to every other device listening
// on the same channel: a broadcast to all of them, a unicast to the one it names,
// and an encrypted frame only to a device that holds the sender as an encrypted
// peer with the same key (the C side checks that). It also has the WiFi networks
// in range, which every radio on it scans and joins. Time is the air's for its
// RadioDevices: `run(ms)` calls their main loop the way Tasmota's scheduler does,
// and delivers what was sent at each step; a simulated house (house.ts) runs its
// own devices and asks the air to deliver.
//
// The air takes time. A frame holds the sender's radio for its length on the air
// (RadioTiming: about 1.4 ms for 90 bytes, 2.9 ms for 233, at 1 Mbps), the sender's
// frames go out one after another, and a frame reaches the others when its time is
// over: not in the instant it was sent, which hid from every test of this
// simulator what a burst does to a 4-frame receive queue.
import createBerryModule, { type BerryModule } from "../wasm/berry.mjs";

/** Tasmota's calls, with this file's numbers for them (native/tasmota_core.h) */
export const FUNC = { LOOP: 3, EVERY_100_MSECOND: 4, EVERY_250_MSECOND: 5, EVERY_SECOND: 6 };

export const BROADCAST = "FFFFFFFFFFFF";

/**
 * What the air does with a frame: how long it takes, and how many a device's radio takes ahead of it. The defaults
 * are the hardware's as far as it is known (REAL_TIMING); IDEAL_TIMING is the air this simulator had before, in
 * which a frame arrives in the instant it is sent, for a test that is not about the radio.
 */
export interface RadioTiming {
  /** a frame's time on the air, in ms, is this fixed part (preamble, headers, the acknowledgement) ... */
  airFixedMs: number;
  /** ... and this much a byte: ESP-NOW's 1 Mbps is 8 us a byte, and the radio's own framing a little more */
  airPerByteMs: number;
  /** the frames a device's radio takes ahead of the air before esp_now_send says it has no memory (ESP_ERR_ESPNOW_NO_MEM); 0 for no end to it, the hardware's end being the bench's to measure */
  txQueue: number;
}

/** 1.4 ms for a frame of 90 bytes and 2.9 ms for one of 233; the transmit queue's depth is not measured yet */
export const REAL_TIMING: RadioTiming = { airFixedMs: 0.45, airPerByteMs: 0.0105, txQueue: 0 };
/** a frame arrives in the instant it is sent, and the radio takes any number of them */
export const IDEAL_TIMING: RadioTiming = { airFixedMs: 0, airPerByteMs: 0, txQueue: 0 };

/**
 * What a device's main loop spends on what the ESP-NOW driver hands it: it drains the receive queue one frame at a time,
 * and a frame's command line costs the loop Tasmota's command dispatch (8 to 15 ms measured on the bridge),
 * an event the rule engine and what its rules run (not measured: the bench's).
 * The loop itself comes round every Sleep (50 ms by default): the drain waits for it.
 */
export interface LoopTiming {
  /** how often FUNC_LOOP is called, in ms */
  loopMs: number;
  /** a frame's command line, in ms */
  cmdMs: number;
  /** a frame's event, in ms */
  eventMs: number;
}

/** the loop at Tasmota's default Sleep of 50 ms, a command costing 10 ms (the middle of 8 to 15) and an event 3 */
export const REAL_LOOP: LoopTiming = { loopMs: 50, cmdMs: 10, eventMs: 3 };
/** the loop as this simulator had it: every turn of 5 ms, and a frame costing no time */
export const IDEAL_LOOP: LoopTiming = { loopMs: 5, cmdMs: 0, eventMs: 0 };

/** A frame on the air: addresses as 12 hex digits, the bytes as hex */
export interface AirFrame {
  /** when it was sent */
  at: number;
  /** when its time on the air is over, and the others hear it: the instant it was sent when the air has no time */
  due?: number;
  from: string;
  to: string;
  hex: string;
  encrypt: boolean;
  lmk: string;
  channel: number;
}

/** A network's access point in the air: what a scan finds, and what a join is checked against. */
export interface SimNetwork {
  ssid: string;
  rssi: number;
  /** ESP-IDF's wifi_auth_mode_t: 0 open, 3 WPA2, 5 WPA2 Enterprise, 7 WPA2/WPA3 */
  auth: number;
  channel: number;
  bssid: string;
  password: string;
}

export interface RadioState {
  /** the station's part, 1, and the soft access point's, 2 */
  mode: number;
  /** the soft access point up, and the phones on it */
  softap: number;
  apClients: number;
  channel: number;
  ap: number;
  associated: number;
  /** Tasmota's WiFi, Settings->flag4.network_wifi */
  wifi: number;
  wifiDown: number;
  espnow: number;
  sent: number;
  commands: number;
  claimed: number;
  paused: number;
  /** the WiFi Manager up (Wifi.config_type) */
  manager: number;
  scanning: number;
  joining: number;
  /** the frames of each kind the main loop's drain took from the receive queue, and the ones the full queue dropped (the oldest each time) */
  takenCmd: number;
  takenEvent: number;
  dropped: number;
  /** the network the station is associated with, its access point, its signal and the station's address */
  station: string;
  bssid: string;
  rssi: number;
  ip: string;
  peers: { mac: string; channel: number; encrypt: number }[];
}

/** What is on the air: a device's ESP-NOW, as the air delivers to it. */
export interface AirNode {
  /** 12 hex digits */
  readonly mac: string;
  /** the channel ESP-NOW listens on, 0 when it does not listen */
  listening(): number;
  receive(f: AirFrame, rssi: number): boolean;
}

/** A MAC as Tasmota writes it, "A0:B7:65:00:00:01", as 12 hex digits */
export const macHex = (mac: string) => mac.replace(/:/g, "").toUpperCase();

/** The two radio drivers of a module: its commands, its settings, its state, its turns. */
export class Radio implements AirNode {
  readonly mac: string;
  readonly module: BerryModule;

  constructor(module: BerryModule, mac: string) {
    this.module = module;
    this.mac = macHex(mac);
  }

  /** FUNC_PRE_INIT and FUNC_INIT of both drivers, as at boot, with the device's address and seed of randomness */
  init(seed: number) {
    this.module.ccall("bh_radio_init", null, ["string", "number"], [this.mac, seed]);
  }

  /** A command, split as Tasmota splits one: the drivers' response as JSON text, or null when neither has it. */
  command(name: string, index: number, usridx: boolean, payload: number, data: string): string | null {
    const ptr = this.module.ccall("bh_radio_command", "number", ["string", "number", "number", "number", "string"],
      [name, index, usridx ? 1 : 0, payload, data]);
    return ptr ? this.module.UTF8ToString(ptr) : null;
  }

  /** A command as the console takes it: the response, parsed, or null when neither driver has it. */
  cmd(line: string): any {
    const space = line.indexOf(" ");
    const topic = space < 0 ? line : line.slice(0, space);
    const data = space < 0 ? "" : line.slice(space + 1).trim();
    const [, name, digits] = /^(.*?)(\d*)$/.exec(topic)!;
    const index = digits ? Number(digits) : 1;
    const number = /^-?\d+/.exec(data);
    const payload = number ? Number(number[0]) : -99;
    const text = this.command(name, index, digits !== "", payload, data);
    if (text === null) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  /** What the device is set to: `wifi`, `ap`, `mode`, `channel`, `manager`, `ip`, `hostname`, `ssid1`, `password1`, `ssid2`, `password2`, `friendlyname` */
  set(key: string, value: string | number) {
    this.module.ccall("bh_radio_set", null, ["string", "string"], [key, String(value)]);
  }

  /** A text of the settings: `ssid1`, `password1`, `ssid2`, `password2`, `friendlyname` */
  text(key: string): string {
    return this.module.ccall("bh_radio_text", "string", ["string"], [key]);
  }

  /** The networks in range, as the device's radio meets them */
  networks(list: readonly SimNetwork[]) {
    this.module.ccall("bh_radio_ap_clear", null, [], []);
    for (const n of list) {
      this.module.ccall("bh_radio_ap", null, ["string", "string", "number", "number", "number", "string"],
        [n.ssid, macHex(n.bssid), n.channel, n.auth, n.rssi, n.password]);
    }
  }

  state(): RadioState {
    return JSON.parse(this.module.ccall("bh_radio_state", "string", [], []));
  }

  /** A phone joins the device's soft access point with the password it gives: true when it did */
  phoneJoins(ssid: string, password: string): boolean {
    return this.module.ccall("bh_radio_phone", "number", ["string", "string", "number"], [ssid, password, 1]) === 1;
  }

  /** a phone on the soft access point leaves it */
  phoneLeaves(): boolean {
    return this.module.ccall("bh_radio_phone", "number", ["string", "string", "number"], ["", "", 0]) === 1;
  }

  listening(): number {
    return this.module.ccall("bh_radio_listening", "number", [], []);
  }

  tick(func: number) {
    this.module.ccall("bh_radio_tick", null, ["number"], [func]);
  }

  /** The main loop's time for a frame's command line and for its event, in ms: what the drain is kept busy by (radio_core.cpp). */
  loop(cmdMs: number, eventMs: number) {
    this.set("cost_cmd", cmdMs);
    this.set("cost_event", eventMs);
  }

  /** The drain left frames in the receive queue for the one it took before to end: the main loop is to come round again. */
  draining(): boolean {
    return this.module.ccall("bh_radio_draining", "number", [], []) === 1;
  }

  receive(f: AirFrame, rssi: number): boolean {
    return this.module.ccall("bh_radio_receive", "number", ["string", "string", "string", "number", "number", "string"],
      [f.from, f.to, f.hex, rssi, f.encrypt ? 1 : 0, f.lmk]) === 1;
  }
}

/** A module with the two drivers and nothing else of a device: for the tests of the drivers. */
export class RadioDevice extends Radio {
  /** what went to the rule engine, parsed */
  readonly events: any[] = [];
  readonly logs: string[] = [];
  /** command lines the driver ran for the peer */
  readonly commands: string[] = [];
  /** what its Berry printed, when it has a VM */
  readonly prints: string[] = [];
  readonly nvs = new Map<string, string>();
  readonly air: Air;

  constructor(air: Air, mac: string, module: BerryModule) {
    super(module, mac);
    this.air = air;
  }

  /** A chunk of Berry, on a device made with a VM: what it printed. */
  berry(source: string): string[] {
    const from = this.prints.length;
    const r = this.module.ccall("bh_run", "number", ["string", "string"], [source, "test"]);
    if (r !== 0) throw new Error(this.module.ccall("bh_error", "string", [], []));
    return this.prints.slice(from);
  }

  /** the rule events of a key, e.g. "EspNowPair", in order */
  eventsOf(key: string): any[] {
    return this.events.filter((e) => e && typeof e === "object" && key in e).map((e) => e[key]);
  }
}

export class Air {
  /** the time, in ms: a device that booted a while ago, as the drivers meet it on the hardware */
  now = 1_000_000;
  /** the devices this air runs (run, until) */
  readonly devices: RadioDevice[] = [];
  /** everything on the air, the devices included */
  readonly nodes: AirNode[] = [];
  /** everything sent, in order */
  readonly frames: AirFrame[] = [];
  /** what the air does with a frame, REAL_TIMING: a test that is not about the radio says IDEAL_TIMING */
  timing: RadioTiming = REAL_TIMING;
  /** a frame this returns true for never arrives anywhere */
  drop: (f: AirFrame) => boolean = () => false;
  /** the signal between two devices */
  rssi: (from: string, to: string) => number = () => -40;
  /** channels next to the sender's that also hear it, as close radios do: 0 for none */
  leak = 0;
  /** the WiFi networks in range, the same for every radio on this air; none: the one access point a device's `ap` sets */
  networks: readonly SimNetwork[] = [];
  /** the frames on the air, by the instant their time is over */
  private queue: AirFrame[] = [];
  /** when a device's radio is done with the frames it took, by address: the next one goes out then */
  private readonly txFree = new Map<string, number>();

  /**
   * A device with the address given, as 12 hex digits, its seed of randomness,
   * what its NVS holds when it boots, by "namespace/key", and whether it runs a
   * Berry VM, where the ESP-NOW driver registers its natives.
   */
  async device(mac: string, seed: number, nvs: Record<string, string> = {}, options: { berry?: boolean } = {}): Promise<RadioDevice> {
    let dev: RadioDevice;
    const module = await createBerryModule({ print: (l: string) => dev?.prints.push(l), printErr: (l: string) => dev?.prints.push(l) });
    dev = new RadioDevice(this, mac, module);
    if (options.berry) module.ccall("bh_init", "number", [], []);
    for (const [key, hex] of Object.entries(nvs)) dev.nvs.set(key, hex);
    module.coreMillis = () => this.now;
    module.coreLog = (_level, message) => dev.logs.push(message);
    module.coreRules = (_subtopic, json) => {
      try {
        dev.events.push(JSON.parse(json));
      } catch {
        dev.events.push(json);
      }
    };
    module.coreNvmLoad = (ns, key) => dev.nvs.get(`${ns}/${key}`) ?? null;
    module.coreNvmSave = (ns, key, hex) => void dev.nvs.set(`${ns}/${key}`, hex);
    this.wire(module);
    module.radioCommand = (line) => dev.commands.push(line);
    dev.init(seed);
    if (this.networks.length) dev.networks(this.networks);
    this.devices.push(dev);
    this.nodes.push(dev);
    return dev;
  }

  /** A module's ESP-NOW handed to this air: what it sends goes out on it. */
  wire(module: BerryModule) {
    module.radioSend = (from, to, hex, encrypt, lmk, channel) => this.send({ at: this.now, from, to, hex, encrypt: !!encrypt, lmk, channel });
  }

  /** the frames of `mac` on the air still, which its radio took and has not sent */
  inFlight(mac: string): number {
    return this.queue.filter((f) => f.from === mac && (f.due ?? 0) > this.now).length;
  }

  /** when the air has no frame in it: the instant the last one's time is over */
  quietAt(): number {
    return this.queue.reduce((t, f) => Math.max(t, f.due ?? 0), this.now);
  }

  /** A node of a device this air does not run (a simulated panel or bridge): it hears what is sent. */
  attach(node: AirNode) {
    if (!this.nodes.includes(node)) this.nodes.push(node);
  }

  detach(node: AirNode) {
    const i = this.nodes.indexOf(node);
    if (i >= 0) this.nodes.splice(i, 1);
  }

  /**
   * A frame sent. The radio takes it, or has no room (-1, esp_now_send's ESP_ERR_ESPNOW_NO_MEM, when `timing.txQueue`
   * frames of the sender are ahead of it); it goes out when the sender's frames before it have, and its time on the
   * air is over a frame's length later. What it answers is whether a unicast is acknowledged by a device of that
   * address on the channel: 1, or 0 (a broadcast is always 1).
   */
  private send(f: AirFrame): number {
    const t = this.timing;
    if (t.txQueue > 0 && this.inFlight(f.from) >= t.txQueue) return -1;
    const start = Math.max(this.now, this.txFree.get(f.from) ?? 0);
    const due = start + t.airFixedMs + (f.hex.length / 2) * t.airPerByteMs;
    this.txFree.set(f.from, due);
    this.put({ ...f, due });
    return f.to === BROADCAST || this.nodes.some((d) => d.mac === f.to && d.listening() === f.channel) ? 1 : 0;
  }

  /** a frame on the air, among the others by the instant it ends: one that ends when another does goes after it */
  private put(frame: AirFrame) {
    this.frames.push(frame);
    let i = this.queue.length;
    while (i > 0 && (this.queue[i - 1].due ?? 0) > (frame.due ?? 0)) i--;
    this.queue.splice(i, 0, frame);
  }

  /** Puts a frame on the air as if a device had sent it, from any address: it is heard at once. */
  inject(f: Omit<AirFrame, "at">) {
    this.put({ ...f, at: this.now, due: this.now });
    this.deliver();
  }

  /** What was sent and whose time on the air is over, to every node that hears it. */
  deliver() {
    while (this.queue.length && (this.queue[0].due ?? 0) <= this.now) {
      const f = this.queue.shift()!;
      if (this.drop(f)) continue;
      for (const d of this.nodes) {
        if (d.mac === f.from) continue;
        const on = d.listening();
        if (!on || Math.abs(on - f.channel) > this.leak) continue;
        if (f.to !== BROADCAST && f.to !== d.mac) continue;
        d.receive(f, this.rssi(f.from, d.mac) - 10 * Math.abs(on - f.channel));
      }
    }
  }

  /** Runs every device for `ms`, in steps of 10 ms: the main loop every step, and the timed calls on time. */
  run(ms: number, only?: RadioDevice[]) {
    const end = this.now + ms;
    while (this.now < end) {
      this.now += 10;
      for (const d of only ?? this.devices) {
        d.tick(FUNC.LOOP);
        if (this.now % 100 === 0) d.tick(FUNC.EVERY_100_MSECOND);
        if (this.now % 250 === 0) d.tick(FUNC.EVERY_250_MSECOND);
        if (this.now % 1000 === 0) d.tick(FUNC.EVERY_SECOND);
        this.deliver();
      }
    }
  }

  /** Runs until `done` holds, checked every step, for at most `ms`: false when it never did. */
  until(done: () => boolean, ms: number, only?: RadioDevice[]): boolean {
    const end = this.now + ms;
    while (this.now < end) {
      if (done()) return true;
      this.run(10, only);
    }
    return done();
  }
}
