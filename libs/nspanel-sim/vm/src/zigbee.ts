// The Zigbee network the simulated panel talks to: lamps, and the coordinator's
// side of Zigbee2Tasmota as far as the panel can tell.
//
// This is the WORLD, not the panel. Nothing here decides anything the panel's
// Berry decides; it is what a room full of lamps would answer. The messages are
// Z2T's, as its own source writes them (firmware/tasmota/tasmota/
// tasmota_xdrv_driver/xdrv_23_zigbee_8_parsers.ino, _6_0_commands.ino,
// _A_impl.ino): the announce (ZbState Status 30), an endpoint's descriptor
// (Status 33), attribute reports (ZbReceived), the answer to a write
// (ZbResponse), what Z2T knows of a device (ZbInfo), a ping nobody answered
// (Reachable false, 2 s on).
//
// And the thermostats: a ZCL one, whose cluster 0x0201 Z2T reads and writes by
// attribute name (the temperatures in degrees, the SystemMode raw, nothing reported for a write
// and nothing read back), and the Moes ZHT-SR, a Tuya TS0601 whose datapoints Z2T reads and writes
// by raw key, "EF00/<type><dp>", with no plugin (xdrv_23_zigbee_A_impl.ino's ZbTuyaWrite): it
// answers a TuyaQuery with all of them, and echoes one it is written.
//
// And the blinds: a Tuya TS130F on the Window Covering cluster, which Z2T commands by name (ShutterOpen, ShutterClose,
// ShutterStop, ShutterLift) and which reports its lift, 100 for open, and its motion, as it travels; and the Moes Star Ring, a
// TS0601 whose control and position datapoints Z2T writes by raw key, which echoes a control and says its position when it
// stops. Both move in time, a step a second, and stop midway.

/** The capabilities of a device as the panel's configuration has them. */
const CAP = { onoff: 1, level: 2, ct: 4, color: 8 } as const;

export interface ZigbeeDevice {
  ieee: string;
  short: number;
  endpoint: number;
  model: string;
  manufacturer: string;
  profile: number;
  deviceId: number;
  inClusters: number[];
  outClusters: number[];
  /** Z2T's Config for it, "L01.5": a light on endpoint 1, colour and white */
  config: string[];
  /** the relay that feeds it, 1 or 2, or 0 when it has its own supply */
  relay: number;
  ct: [min: number, max: number];
  // what it is doing
  power: 0 | 1;
  dimmer: number;
  colorTemp: number;
  hue: number;
  sat: number;
  /** ZCL StartUpOnOff: 0 off, 1 on, 2 toggle, 255 as it was */
  startUpOnOff: number;
  /** ZCL OnOffTransitionTime of a lamp with levels, in tenths of a second: 0 when never written */
  onOffTransitionTime?: number;
  groups: number[];
  /** on the network (joined and not left) */
  joined: boolean;
  /** it has power: its relay is closed, or it has none */
  powered: boolean;
  /** the millis() it identifies until, blinking */
  identifyUntil: number;
  /**
   * Commands still to be lost on their way to it, as a group's broadcast is,
   * which nobody acknowledges: it does nothing and reports
   * nothing for them. A test sets it.
   */
  misses?: number;
  /**
   * Reports still to be lost on their way out of it: the command was done, and nobody hears of it. A test
   * sets it.
   */
  lostReports?: number;
  /** what a thermostat holds, for the devices that are one */
  thermo?: Thermostat;
  /** what a blind holds, for the devices that are one */
  cover?: Cover;
  /** what a sensor holds, for the devices that are one */
  zone?: Zone;
}

/** The kinds of sensor the simulator plays, by the IAS zone type Z2T reads of them; a motion sensor speaks occupancy. */
export type SensorKind = "contact" | "motion" | "water" | "smoke" | "co";

export interface SensorSpec {
  ieee: string;
  kind: SensorKind;
  endpoint?: number;
  manufacturer?: string;
  model?: string;
}

/** What a sensor holds: its IAS zone type, and the zone status as Z2T keeps it, alarm bits 1 and 2, tamper 4, low battery 8. */
export interface Zone {
  kind: SensorKind;
  type: number;
  status: number;
}

/** the IAS zone type of each kind, and the name Z2T gives its first alarm (Z_Data_Alarm::convertZoneStatus) */
const ZONE_OF: Record<SensorKind, { type: number; name: string }> = {
  contact: { type: 0x0015, name: "Contact" },
  motion: { type: 0x000d, name: "Occupancy" },
  water: { type: 0x002a, name: "Water" },
  smoke: { type: 0x0028, name: "Fire" },
  co: { type: 0x002b, name: "CO" },
};

export interface ZigbeeWorldHooks {
  /** a payload for the panel's rules, `delay` ms from now */
  emit(json: string, delay: number): void;
  /** a payload published inside the command that runs, as Z2T's MqttPublish of a ZbInfo: the rules get it before the
   * command's answer, in the command's context */
  publish?(json: string): void;
  now(): number;
  /** whether a relay is closed */
  relay(n: number): boolean;
  /** Tasmota asked to restart, by the command given */
  restart?(why: string): void;
  /** something the world does by itself, `delay` ms from now: a blind's step */
  tick?(fn: () => void, delay: number): void;
}

const hex4 = (n: number) => "0x" + n.toString(16).toUpperCase().padStart(4, "0");
const hex2 = (n: number) => "0x" + n.toString(16).toUpperCase().padStart(2, "0");

/** A lamp of the panel's configuration, as the network has it. */
export interface LampSpec {
  ieee: string;
  model: string;
  caps: number;
  ct: [number, number];
  endpoint: number;
  relay: number;
}

/**
 * A switch of several channels: a Tuya TS0002-like module, an on/off endpoint a channel. The world keeps a
 * record a channel, with the device's address and the channel's endpoint: `addSwitch` and `joinSwitch` make them.
 */
export interface SwitchSpec {
  ieee: string;
  /** how many channels, on endpoints 1 to n */
  channels: number;
  model?: string;
  relay?: number;
}

/** A thermostat for the network: `addThermostat` and `joinThermostat` make it. */
export interface ThermostatSpec {
  ieee: string;
  /** "zcl": the cluster 0x0201 by attribute name; "tuya": the Moes ZHT-SR, a TS0601 that speaks in datapoints */
  profile: "zcl" | "tuya";
  endpoint?: number;
  manufacturer?: string;
  model?: string;
  /** a Tuya device that echoes a datapoint it is written, as the MCU does; false for one that takes it and says nothing */
  echo?: boolean;
}

/** What a thermostat holds, in tenths of a degree. A Tuya one keeps its datapoints, and the rest follow them. */
export interface Thermostat {
  profile: "zcl" | "tuya";
  /** the room's temperature, the target and the floor probe's */
  cur: number;
  set: number;
  floor: number;
  /** a ZCL SystemMode: 0 off, 4 heat (a thermostat for heating has no other); a Tuya device's on/off is its datapoint 1 */
  mode: number;
  /** Tuya's datapoints: the number, its type byte and its value */
  dps: Map<number, { type: number; value: number }>;
  /** whether a Tuya device echoes what it is written */
  echo: boolean;
}

/** A blind for the network: `addCover` and `joinCover` make it. */
export interface CoverSpec {
  ieee: string;
  /** "zcl": a Tuya TS130F on the Window Covering cluster, its lift 100 for open; "tuya": the Moes Star Ring, a TS0601 of datapoints */
  profile: "zcl" | "tuya";
  endpoint?: number;
  manufacturer?: string;
  model?: string;
  /** the time from the bottom to the top, in ms: 20 s */
  travelMs?: number;
  /** where it starts, 0 closed to 100 open: 0 */
  pos?: number;
}

/** What a blind holds. A Tuya one keeps its datapoints too, its position among them. */
export interface Cover {
  profile: "zcl" | "tuya";
  /** where it is, 0 closed to 100 open */
  pos: number;
  /** 1 going up, -1 going down, 0 standing */
  dir: number;
  /** where it stops, while it goes */
  target: number;
  /** counts the moves, so the step of one that was stopped or replaced does nothing */
  move: number;
  travelMs: number;
  /** the Star Ring's datapoints: 1 the control (0 open, 1 stop, 2 close), 2 the position, 3 the calibration, 8 the motor's way */
  dps: Map<number, { type: number; value: number }>;
  /** a TS130F's settings, by their Z2T names */
  attrs: Record<string, number>;
}

/** a blind's step, and the percent it covers of its travel */
const COVER_STEP_MS = 1000;

/**
 * The Moes ZHT-SR's datapoints as it powers up, [dp, type, value], in the table of Zigbee2MQTT for
 * _TZE204_lpedvtvr (zigbee-herdsman-converters). The types are that table's, and the world's
 * own truth here: what the bench will tell is whether the device agrees. dp 47 is the running state, 0
 * for heating and 1 for resting.
 */
const ZHTSR_DPS: [number, number, number][] = [
  [1, 1, 0], [2, 4, 0], [16, 2, 200], [18, 2, 50], [32, 4, 0], [34, 2, 350], [39, 1, 0], [47, 4, 1], [48, 2, 80],
  [50, 2, 210], [101, 2, 0], [109, 2, 270], [110, 2, 10], [111, 2, 700], [112, 2, 50], [113, 2, 200], [114, 4, 2], [115, 1, 1],
];

/** Z2T's key for a Tuya datapoint with no plugin: "EF00/", the type byte and the number, two hex digits each */
const tuyaKey = (type: number, dp: number) => "EF00/" + type.toString(16).toUpperCase().padStart(2, "0") + dp.toString(16).toUpperCase().padStart(2, "0");

/**
 * The Zigbee lamps of a panel's configuration, each with the
 * groups it is already in: a member confirmed in a zone's group, or one still
 * to leave it, is in it on the lamp too; one still joining is not yet. A
 * thermostat is no lamp: thermostatsOf has it.
 */
export function networkOf(doc: { devices: unknown[][]; zones?: { zid: number; zstate?: Record<string, string> }[]; buttonGroups?: { zid: number; zstate?: Record<string, string> }[] }) {
  const groups = new Map<string, number[]>();
  for (const owner of [...(doc.zones ?? []), ...(doc.buttonGroups ?? [])]) {
    for (const [id, standing] of Object.entries(owner.zstate ?? {})) {
      if (standing !== "in" && standing !== "leaving") continue;
      groups.set(id, [...(groups.get(id) ?? []), owner.zid]);
    }
  }
  // a switch of several is switchesOf's: its channels, and the first by its IEEE alone
  const several = new Set(doc.devices.filter((d) => String(d[0]).includes("/")).map((d) => String(d[0]).split("/")[0]));
  return doc.devices
    .filter((d) => !String(d[0]).startsWith("relay:") && d[2] !== "thermostat" && d[2] !== "cover" && d[2] !== "sensor" && !String(d[0]).includes("/") && !several.has(String(d[0])))
    .map((d) => ({
      spec: { ieee: String(d[0]), model: String(d[6]), caps: Number(d[3]), ct: [Number(d[4]), Number(d[5])] as [number, number], endpoint: Number(d[7]), relay: Number(d[9]) },
      groups: groups.get(String(d[0])) ?? [],
    }));
}

/** The sensors of a panel's configuration: a motion sensor by its model, a TS0202, and a door otherwise (the record keeps no zone type). */
export function sensorsOf(doc: { devices: unknown[][] }): SensorSpec[] {
  return doc.devices
    .filter((d) => d[2] === "sensor" && !String(d[0]).startsWith("relay:"))
    .map((d) => ({ ieee: String(d[0]), kind: String(d[6]) === "TS0202" ? "motion" as const : "contact" as const, model: String(d[6]), endpoint: Number(d[7]) || 1 }));
}

/** The switches of several channels of a panel's configuration: a device whose channels have ids of their own. */
export function switchesOf(doc: { devices: unknown[][] }): SwitchSpec[] {
  const count = new Map<string, number>();
  const model = new Map<string, string>();
  for (const d of doc.devices) {
    const id = String(d[0]);
    if (!id.includes("/")) continue;
    const ieee = id.split("/")[0];
    count.set(ieee, Math.max(count.get(ieee) ?? 1, Number(d[7])));
    model.set(ieee, String(d[6]));
  }
  return [...count].map(([ieee, channels]) => ({ ieee, channels, model: model.get(ieee) || "TS0002" }));
}

/**
 * The thermostats of a panel's configuration, as the network has them when the panel boots with it: a TS0601 is
 * the Moes ZHT-SR, which speaks in Tuya datapoints, and any other model a ZCL one. They power up as a new one does, since
 * what they were set to is the device's and not in the panel's configuration.
 */
export function thermostatsOf(doc: { devices: unknown[][] }): ThermostatSpec[] {
  return doc.devices
    .filter((d) => d[2] === "thermostat")
    .map((d) => {
      const profile: ThermostatSpec["profile"] = String(d[6]) === "TS0601" ? "tuya" : "zcl";
      return { ieee: String(d[0]), profile, model: String(d[6]), endpoint: Number(d[7]) };
    });
}

/**
 * The blinds of a panel's configuration, as the network has them when the panel boots with it: a TS0601 is the Moes
 * Star Ring, and any other model a ZCL TS130F. They start closed, since where they were is the device's and not the panel's.
 */
export function coversOf(doc: { devices: unknown[][] }): CoverSpec[] {
  return doc.devices
    .filter((d) => d[2] === "cover")
    .map((d) => {
      const profile: CoverSpec["profile"] = String(d[6]) === "TS0601" ? "tuya" : "zcl";
      return { ieee: String(d[0]), profile, model: String(d[6]), endpoint: Number(d[7]) };
    });
}

/** The first ZbInfo of a command after it, when a test spaces them (`infoGapMs` above 0): Z2T's own come inside it. */
export const INFO_FIRST_MS = 30;

/**
 * What the world does around its answers. `infoGapMs`: the time between the ZbInfo of one device and the next. Z2T's own
 * is none: CmndZbInfo publishes every device's inside the command (xdrv_23_zigbee_A_impl.ino), so the bridge's rule hears
 * them all in the same instant, before the command's own answer, and what it forwards leaves in a burst; with 0, the
 * default, the simulator publishes them so (the hook `publish`), and a command run inside a rule publishes them into a
 * rule engine that runs no rule (callBerryRule, xdrv_52_9_berry.ino). Spacing them 10 ms apart, after the command, would let a
 * 4-frame receive queue keep up with 30 lamps, which no Z2T does: a test that wants that spacing says so. `keyDerived`: a network whose key is made of the chip's address, as a new
 * one's is at the first start (the same 64 bits in both halves of it); the default is a random one, so that a test that
 * says nothing of it is not a bridge that takes a new key at its first minute. With it, the PAN IDs are the derived ones too, as
 * ZigbeeInit makes them at a first boot with the radio held (the MAC read as zero: 0x0001 and 0xCCCCCCCC00000000).
 * `panDerived`: only the PAN IDs derived, with a random key (a bridge whose key was drawn before the relay drew
 * the PAN IDs too).
 */
export interface ZigbeeWorldOptions {
  infoGapMs?: number;
  keyDerived?: boolean;
  panDerived?: boolean;
}

export class ZigbeeWorld {
  devices: ZigbeeDevice[] = [];
  /** the time between one device's ZbInfo and the next's, see ZigbeeWorldOptions */
  infoGapMs: number;
  /** millis() the pairing window closes at, or 0 */
  permitUntil = 0;
  /** the channel the network is on, which ZbConfig says */
  channel = 11;
  /** the network's key as ZbConfig says it, KeyL and KeyH: equal halves are the ones made of the chip's address */
  keyL = "0x0F0D0B0907050301";
  keyH = "0x0D0C0A0806040200";
  /** the PAN ID and the extended PAN ID as ZbConfig says them: 0x0001 and 0xCCCCCCCC... are the derived ones */
  panId = "0x1A63";
  extPanId = "0x5A1C0F3377E2D901";
  private nextShort = 0x5a00;
  private seq = 0;

  private readonly hooks: ZigbeeWorldHooks;

  constructor(hooks: ZigbeeWorldHooks, options: ZigbeeWorldOptions = {}) {
    this.hooks = hooks;
    this.infoGapMs = options.infoGapMs ?? 0;
    if (options.keyDerived) this.keyL = this.keyH = "0x6F0000AA01020304";
    if (options.keyDerived || options.panDerived) {
      this.panId = "0x0001";
      this.extPanId = "0xCCCCCCCC00000000";
    }
  }

  /** The network across a restart of the panel: the lamps stay as they were, joined, lit or not. */
  carry(from: ZigbeeWorld) {
    this.channel = from.channel;
    this.keyL = from.keyL;
    this.keyH = from.keyH;
    this.panId = from.panId;
    this.extPanId = from.extPanId;
    this.devices = from.devices;
    this.nextShort = from.nextShort;
    this.infoGapMs = from.infoGapMs;
  }

  /** A lamp on the network, already joined, with the groups it already has. */
  add(spec: LampSpec, groups: number[] = [], joined = true): ZigbeeDevice {
    const colour = (spec.caps & CAP.color) !== 0;
    const ct = (spec.caps & CAP.ct) !== 0;
    const level = (spec.caps & CAP.level) !== 0;
    const d: ZigbeeDevice = {
      ieee: spec.ieee,
      short: this.nextShort++,
      endpoint: spec.endpoint || 1,
      model: spec.model,
      manufacturer: spec.model.startsWith("CK-") ? "eWeLink" : "_TZ3000_sim",
      profile: 0x0104,
      // the HA device types: extended colour, colour temperature, dimmable, on/off light
      deviceId: colour ? 0x010d : ct ? 0x010c : level ? 0x0101 : 0x0100,
      inClusters: [0x0000, 0x0003, 0x0004, 0x0005, 0x0006, ...(level ? [0x0008] : []), ...(ct || colour ? [0x0300] : []), 0x1000],
      outClusters: [0x0019],
      config: [`L${String(spec.endpoint || 1).padStart(2, "0")}.${colour && ct ? 5 : colour ? 3 : ct ? 2 : level ? 1 : 0}`],
      relay: spec.relay,
      ct: spec.ct[0] < spec.ct[1] ? spec.ct : [153, 500],
      power: 0,
      dimmer: 254,
      colorTemp: 300,
      hue: 0,
      sat: 0,
      startUpOnOff: 0,
      groups: [...groups],
      joined,
      powered: spec.relay ? this.hooks.relay(spec.relay) : true,
      identifyUntil: 0,
    };
    this.devices.push(d);
    return d;
  }

  /** a device on the network by IEEE, by short address or by its hex, as Z2T parses a device name */
  find(name: string): ZigbeeDevice | undefined {
    return this.listed(name, true);
  }

  /**
   * A device of Z2T's list by name, on the network or not: one that left (ZbLeave) stays in the list until ZbForget takes it out,
   * so a ZbForget after a ZbLeave finds it.
   */
  private listed(name: string, joinedOnly: boolean): ZigbeeDevice | undefined {
    // either address, in any case: Tasmota writes "0x5A01", and a name taken to
    // upper case is "0X5A01", which the short address written by hex4 never was
    const n = name.trim().toUpperCase();
    return this.devices.find((d) => (!joinedOnly || d.joined) && (d.ieee.toUpperCase() === n || hex4(d.short).toUpperCase() === n));
  }

  /** a device's record at an endpoint, for a switch of several; with no endpoint, its first */
  private atEndpoint(name: string, ep?: number): ZigbeeDevice[] {
    const d = this.find(name);
    if (!d) return [];
    if (ep === undefined) return [d];
    return this.devices.filter((x) => x.joined && x.ieee === d.ieee && x.endpoint === ep);
  }

  /** answers the Zb commands; null for a command that is not Z2T's */
  command(name: string, data: string): string | null {
    const cmd = name.toLowerCase();
    if (cmd === "zbsend") return this.send(data);
    if (cmd === "zbpermitjoin") return this.permit(data.trim());
    if (cmd === "zbping") return this.ping(data.trim());
    if (cmd === "zbinfo") return this.info(data.trim());
    if (cmd === "zbleave" || cmd === "zbforget") {
      // ZbLeave asks a device on the network to leave it; ZbForget takes a device out of the list, whether it left or not
      const d = this.listed(data, cmd === "zbleave");
      if (!d) return JSON.stringify({ [name]: "Unknown device" });
      // the device, with all its channels
      if (cmd === "zbleave") for (const x of this.devices.filter((y) => y.ieee === d.ieee)) x.joined = false;
      else this.devices = this.devices.filter((x) => x.ieee !== d.ieee);
      return JSON.stringify({ [name]: "Done" });
    }
    if (cmd === "zbconfig") return this.config(data.trim());
    if (cmd === "setoption116" || cmd === "zbname") return JSON.stringify({ [name]: "Done" });
    return null;
  }

  // --- ZbSend ----------------------------------------------------------------------------------

  private send(data: string): string {
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(data);
    } catch {
      return JSON.stringify({ ZbSend: "Invalid JSON" });
    }
    const key = (k: string) => Object.keys(j).find((x) => x.toLowerCase() === k);
    const devKey = key("device");
    const groupKey = key("group");
    const send = j[key("send") ?? ""] as Record<string, unknown> | undefined;
    const write = j[key("write") ?? ""] as Record<string, unknown> | undefined;
    const read = j[key("read") ?? ""] as Record<string, unknown> | unknown[] | undefined;
    const epKey = key("endpoint");
    const targets = groupKey !== undefined
      ? this.devices.filter((d) => d.joined && d.groups.includes(Number(j[groupKey])))
      : devKey !== undefined ? this.atEndpoint(String(j[devKey]), epKey !== undefined ? Number(j[epKey]) : undefined) : [];
    if (devKey !== undefined && targets.length === 0) return JSON.stringify({ ZbSend: "Unknown device" });
    let delay = 30;
    for (const d of targets) {
      if (send) this.apply(d, send, (delay += 8));
      if (write) this.write(d, write, (delay += 8));
      if (read) this.read(d, read, (delay += 8));
    }
    return JSON.stringify({ ZbSend: "Done" });
  }

  /** a command to one lamp: it changes if it has power, and reports what changed */
  private apply(d: ZigbeeDevice, send: Record<string, unknown>, delay: number) {
    if (!d.powered) return;
    if (d.misses) {
      d.misses -= 1;
      return;
    }
    const report: Record<string, unknown> = {};
    for (const [k, raw] of Object.entries(send)) {
      const v = Number(raw);
      switch (k.toLowerCase()) {
        case "power":
          d.power = (v === 2 ? (d.power ? 0 : 1) : v ? 1 : 0) as 0 | 1;
          report.Power = d.power;
          break;
        case "dimmer":
          // Move to Level with On/Off
          d.dimmer = Math.max(0, Math.min(254, v));
          d.power = d.dimmer > 0 ? 1 : 0;
          Object.assign(report, { Power: d.power, Dimmer: d.dimmer });
          break;
        case "ct":
          d.colorTemp = Math.max(d.ct[0], Math.min(d.ct[1], v));
          report.CT = d.colorTemp;
          break;
        case "hue":
          d.hue = Math.max(0, Math.min(254, v));
          report.Hue = d.hue;
          break;
        case "sat":
          d.sat = Math.max(0, Math.min(254, v));
          report.Sat = d.sat;
          break;
        case "huesat": {
          // Move to Hue and Saturation, "h,s"
          const [h, s] = String(raw).split(",").map(Number);
          d.hue = Math.max(0, Math.min(254, h));
          d.sat = Math.max(0, Math.min(254, s));
          Object.assign(report, { Hue: d.hue, Sat: d.sat });
          break;
        }
        case "identify":
          d.identifyUntil = this.hooks.now() + v * 1000;
          break;
        case "tuyaquery":
          // all the datapoints, as the MCU sends them: a few to a frame, the frames a moment apart
          if (d.thermo?.profile === "tuya") this.reportDps(d, [...d.thermo.dps.keys()], delay, 6);
          if (d.cover?.profile === "tuya") this.reportCoverDps(d, d.cover, [...d.cover.dps.keys()], delay);
          break;
        case "shutteropen":
          if (d.cover) this.coverMove(d, d.cover, "up", 100, delay);
          break;
        case "shutterclose":
          if (d.cover) this.coverMove(d, d.cover, "down", 0, delay);
          break;
        case "shutterstop":
          if (d.cover) this.coverMove(d, d.cover, "stop", 0, delay);
          break;
        case "shutterlift":
          // a TS130F's lift counts 100 for open, as the position does
          if (d.cover) this.coverTo(d, d.cover, Math.max(0, Math.min(100, v)), delay);
          break;
        case "addgroup":
          if (!d.groups.includes(v)) d.groups.push(v);
          Object.assign(report, { AddGroup: v, AddGroupStatus: 0, AddGroupStatusMsg: "SUCCESS" });
          break;
        case "removegroup": {
          const had = d.groups.includes(v);
          d.groups = d.groups.filter((g) => g !== v);
          Object.assign(report, { RemoveGroup: v, RemoveGroupStatus: had ? 0 : 139, RemoveGroupStatusMsg: had ? "SUCCESS" : "NOT_FOUND" });
          break;
        }
        case "getallgroups":
          Object.assign(report, { GetGroupCapacity: 16, GetGroupCount: d.groups.length, GetGroup: [...d.groups] });
          break;
      }
    }
    if (Object.keys(report).length > 0) this.report(d, report, delay);
  }

  private write(d: ZigbeeDevice, write: Record<string, unknown>, delay: number) {
    if (!d.powered) return;
    if (d.thermo) {
      this.writeThermostat(d, d.thermo, write, delay);
      return;
    }
    if (d.cover) {
      this.writeCover(d, d.cover, write, delay);
      return;
    }
    // a lamp's settings: its power-on state, and its on/off transition time, which only a lamp with
    // levels has, and one without refuses as UNSUPPORTED_ATTRIBUTE
    const answer = (command: string, status: number) => this.hooks.emit(JSON.stringify({
      ZbResponse: { Device: hex4(d.short), Command: command, Status: status, StatusMessage: status === 0 ? "SUCCESS" : "UNSUPPORTED_ATTRIBUTE", Endpoint: d.endpoint, LinkQuality: 120 },
    }), delay);
    for (const [k, v] of Object.entries(write)) {
      if (k.toLowerCase() === "startuponoff") {
        d.startUpOnOff = Number(v);
        answer("0006_04", 0);
      } else if (k.toLowerCase() === "onofftransitiontime") {
        const level = d.inClusters.includes(0x0008);
        if (level) d.onOffTransitionTime = Number(v);
        answer("0008_04", level ? 0 : 134);
      }
    }
  }

  private report(d: ZigbeeDevice, attrs: Record<string, unknown>, delay: number) {
    if (d.lostReports) {
      d.lostReports -= 1;
      return;
    }
    this.hooks.emit(JSON.stringify({
      ZbReceived: { [hex4(d.short)]: { Device: hex4(d.short), ...attrs, Endpoint: d.endpoint, LinkQuality: 120 } },
    }), delay);
  }

  // --- the thermostats ----------------------------------------------------------------------------

  /**
   * A thermostat on the network, already joined. A Tuya one starts with the ZHT-SR's datapoints, a ZCL one
   * at 20 degrees asked 21, off.
   */
  addThermostat(spec: ThermostatSpec, joined = true): ZigbeeDevice {
    const tuya = spec.profile === "tuya";
    const t: Thermostat = { profile: spec.profile, cur: 200, set: 210, floor: 270, mode: 0, dps: new Map(), echo: spec.echo !== false };
    if (tuya) for (const [dp, type, value] of ZHTSR_DPS) t.dps.set(dp, { type, value });
    const d: ZigbeeDevice = {
      ieee: spec.ieee,
      short: this.nextShort++,
      endpoint: spec.endpoint ?? 1,
      model: spec.model ?? (tuya ? "TS0601" : "SIMTHERM"),
      manufacturer: spec.manufacturer ?? (tuya ? "_TZE204_lpedvtvr" : "SimCo"),
      profile: 0x0104,
      deviceId: tuya ? 0x0051 : 0x0301,
      inClusters: tuya ? [0x0000, 0x0004, 0x0005, 0xef00] : [0x0000, 0x0003, 0x0004, 0x0005, 0x0201],
      outClusters: [0x0019],
      config: tuya ? [] : ["T01"],
      relay: 0,
      ct: [0, 0],
      power: 0,
      dimmer: 0,
      colorTemp: 0,
      hue: 0,
      sat: 0,
      startUpOnOff: 255,
      groups: [],
      joined,
      powered: true,
      identifyUntil: 0,
      thermo: t,
    };
    if (tuya) this.settle(t);
    this.devices.push(d);
    return d;
  }

  /** A new thermostat, factory fresh, joining while the pairing window is open: its maker is read first, then the interview. */
  joinThermostat(spec: ThermostatSpec): ZigbeeDevice | null {
    if (this.permitUntil === 0 || this.hooks.now() > this.permitUntil) return null;
    const d = this.addThermostat(spec, true);
    this.announce(d, 50);
    this.report(d, { ModelId: d.model, Manufacturer: d.manufacturer }, 300);
    this.hooks.emit(JSON.stringify({
      ZbState: {
        Status: 33, Device: hex4(d.short), Endpoint: hex2(d.endpoint), ProfileId: hex4(d.profile), DeviceId: hex4(d.deviceId),
        DeviceVersion: 1, InClusters: d.inClusters.map(hex4), OutClusters: d.outClusters.map(hex4),
      },
    }), 600);
    return d;
  }

  /**
   * What a Tuya thermostat's datapoints say of each other, kept in step: the mirrors, and the running state, which
   * is heating while the device is on and the room is below the target. Returns whether the running state moved.
   */
  private settle(t: Thermostat): boolean {
    const dp = (n: number) => t.dps.get(n)!.value;
    t.cur = dp(16);
    t.set = dp(50);
    t.floor = dp(109);
    t.mode = dp(1) ? 4 : 0;
    const run = t.mode === 4 && t.cur < t.set ? 0 : 1;
    const r = t.dps.get(47)!;
    const moved = r.value !== run;
    r.value = run;
    return moved;
  }

  /** a Tuya report of some datapoints, `perFrame` to a message, the messages 30 ms apart */
  private reportDps(d: ZigbeeDevice, dps: number[], delay: number, perFrame = 32) {
    const t = d.thermo!;
    for (let i = 0; i < dps.length; i += perFrame) {
      const frame: Record<string, unknown> = {};
      for (const dp of dps.slice(i, i + perFrame)) {
        const e = t.dps.get(dp);
        if (e) frame[tuyaKey(e.type, dp)] = e.value;
      }
      this.report(d, frame, delay + (i / perFrame) * 30);
    }
  }

  /** a ZCL thermostat's attributes by their Z2T names, in degrees, and the heating's demand */
  private zclAttrs(t: Thermostat): Record<string, number> {
    return {
      LocalTemperature: t.cur / 10,
      OccupiedHeatingSetpoint: t.set / 10,
      SystemMode: t.mode,
      PIHeatingDemand: t.mode === 4 && t.cur < t.set ? 100 : 0,
    };
  }

  /** a write to a thermostat: a Tuya one sets the datapoint and echoes it; a ZCL one answers the write, and reports nothing */
  private writeThermostat(d: ZigbeeDevice, t: Thermostat, write: Record<string, unknown>, delay: number) {
    if (t.profile === "tuya") {
      const changed: number[] = [];
      for (const [k, raw] of Object.entries(write)) {
        const m = /^EF00\/([0-9A-F]{2})([0-9A-F]{2})$/i.exec(k);
        if (!m) continue;
        const dp = parseInt(m[2], 16);
        const e = t.dps.get(dp);
        // the device ignores a datapoint it does not have, and one it only reports
        if (!e || [16, 47, 109, 32].includes(dp)) continue;
        e.value = Math.trunc(Number(raw));
        changed.push(dp);
      }
      if (this.settle(t)) changed.push(47);
      if (changed.length > 0 && t.echo) this.reportDps(d, [...new Set(changed)], delay);
      return;
    }
    for (const [k, raw] of Object.entries(write)) {
      const name = k.toLowerCase();
      if (name === "occupiedheatingsetpoint") t.set = Math.round(Number(raw) * 10);
      else if (name === "systemmode") t.mode = Number(raw);
      else continue;
      this.hooks.emit(JSON.stringify({
        ZbResponse: { Device: hex4(d.short), Command: "0201_" + (name === "systemmode" ? "1C" : "12"), Status: 0, StatusMessage: "SUCCESS", Endpoint: d.endpoint, LinkQuality: 120 },
      }), delay);
    }
  }

  /** a ZCL read: the attributes asked for, by name, come back as a report (Z2T decodes a Read Attributes Response as one) */
  private read(d: ZigbeeDevice, read: Record<string, unknown> | unknown[], delay: number) {
    if (!d.thermo && !d.cover) {
      // a lamp's settings: what it has, by name; a transition time only where it has levels
      // and what it is doing now, which Z2T reads by the attribute's name: the on/off of its cluster, and the level of the other
      const all: Record<string, number> = { StartUpOnOff: d.startUpOnOff, Power: d.power };
      if (d.inClusters.includes(0x0008)) {
        all.OnOffTransitionTime = d.onOffTransitionTime ?? 0;
        all.Dimmer = d.dimmer;
      }
      const out: Record<string, number> = {};
      for (const name of Array.isArray(read) ? read.map(String) : Object.keys(read)) if (name in all) out[name] = all[name];
      if (Object.keys(out).length > 0) this.report(d, out, delay);
      return;
    }
    if (d.cover?.profile === "zcl") {
      const all: Record<string, number> = { CurrentPositionLiftPercentage: Math.round(d.cover.pos), ...d.cover.attrs };
      const out: Record<string, number> = {};
      for (const name of Array.isArray(read) ? read.map(String) : Object.keys(read)) if (name in all) out[name] = all[name];
      if (Object.keys(out).length > 0) this.report(d, out, delay);
      return;
    }
    const t = d.thermo;
    if (!t || t.profile !== "zcl") return;
    const asked = Array.isArray(read) ? read.map(String) : Object.keys(read);
    const all = this.zclAttrs(t);
    const out: Record<string, number> = {};
    for (const name of asked) if (name in all) out[name] = all[name];
    if (Object.keys(out).length > 0) this.report(d, out, delay);
  }

  /**
   * What a thermostat does on its own, from outside: its dial turned, the room warmer, the floor, the mode set on it.
   * It reports what changed, as the device would: a Tuya one every datapoint that moved, a ZCL one its temperature,
   * its target and its demand, and never its mode (Z2T does not configure a report of it).
   */
  thermostat(ieee: string, patch: { cur?: number; set?: number; floor?: number; on?: boolean }, delay = 20) {
    const d = this.find(ieee);
    const t = d?.thermo;
    if (!d || !t || !d.powered) return;
    if (t.profile === "tuya") {
      const changed: number[] = [];
      const put = (dp: number, value: number) => {
        const e = t.dps.get(dp)!;
        if (e.value !== value) changed.push(dp);
        e.value = value;
      };
      if (patch.cur !== undefined) put(16, patch.cur);
      if (patch.set !== undefined) put(50, patch.set);
      if (patch.floor !== undefined) put(109, patch.floor);
      if (patch.on !== undefined) put(1, patch.on ? 1 : 0);
      if (this.settle(t)) changed.push(47);
      if (changed.length > 0) this.reportDps(d, [...new Set(changed)], delay);
      return;
    }
    const before = this.zclAttrs(t);
    if (patch.cur !== undefined) t.cur = patch.cur;
    if (patch.set !== undefined) t.set = patch.set;
    if (patch.on !== undefined) t.mode = patch.on ? 4 : 0;
    const after = this.zclAttrs(t);
    const out: Record<string, number> = {};
    for (const name of ["LocalTemperature", "OccupiedHeatingSetpoint", "PIHeatingDemand"]) if (after[name] !== before[name]) out[name] = after[name];
    if (Object.keys(out).length > 0) this.report(d, out, delay);
  }

  // --- the blinds ----------------------------------------------------------------------------------

  /** A blind on the network, already joined: a TS130F, or a Moes Star Ring, closed unless the spec says where it is. */
  addCover(spec: CoverSpec, joined = true): ZigbeeDevice {
    const tuya = spec.profile === "tuya";
    const pos = spec.pos ?? 0;
    const c: Cover = { profile: spec.profile, pos, dir: 0, target: pos, move: 0, travelMs: spec.travelMs ?? 20000, dps: new Map(),
                       attrs: { TuyaCalibration: 1, TuyaMotorReversal: 0, TuyaCalibrationTime: 200 } };
    if (tuya) for (const [dp, type, value] of [[1, 4, 1], [2, 2, pos], [3, 4, 1], [8, 4, 0]]) c.dps.set(dp, { type, value });
    const d: ZigbeeDevice = {
      ieee: spec.ieee,
      short: this.nextShort++,
      endpoint: spec.endpoint ?? 1,
      model: spec.model ?? (tuya ? "TS0601" : "TS130F"),
      manufacturer: spec.manufacturer ?? (tuya ? "_TZE204_srmahpwl" : "_TZ3000_1dd0d5yi"),
      profile: 0x0104,
      deviceId: tuya ? 0x0051 : 0x0202,
      inClusters: tuya ? [0x0000, 0x0004, 0x0005, 0xef00] : [0x0000, 0x0003, 0x0004, 0x0005, 0x0006, 0x0102],
      outClusters: [0x0019],
      config: [],
      relay: 0,
      ct: [0, 0],
      power: 0,
      dimmer: 0,
      colorTemp: 0,
      hue: 0,
      sat: 0,
      startUpOnOff: 255,
      groups: [],
      joined,
      powered: true,
      identifyUntil: 0,
      cover: c,
    };
    this.devices.push(d);
    return d;
  }

  // --- the sensors ---------------------------------------------------------------------------------

  /**
   * A sensor on the network, already joined, at rest: a door closed, no motion, dry. An IAS zone device, whose Config
   * Z2T writes as "A01" (an alarm), or "I01" for a motion sensor (a PIR), which also serves the occupancy cluster.
   */
  addSensor(spec: SensorSpec, joined = true): ZigbeeDevice {
    const pir = spec.kind === "motion";
    const d: ZigbeeDevice = {
      ieee: spec.ieee,
      short: this.nextShort++,
      endpoint: spec.endpoint ?? 1,
      model: spec.model ?? (pir ? "TS0202" : "TS0203"),
      manufacturer: spec.manufacturer ?? "_TZ3000_sim",
      profile: 0x0104,
      deviceId: 0x0402,
      inClusters: [0x0000, 0x0001, 0x0003, 0x0500, ...(pir ? [0x0406] : [])],
      outClusters: [0x0019],
      config: [`${pir ? "I" : "A"}${String(spec.endpoint ?? 1).padStart(2, "0")}`],
      relay: 0,
      ct: [0, 0],
      power: 0,
      dimmer: 0,
      colorTemp: 0,
      hue: 0,
      sat: 0,
      startUpOnOff: 255,
      groups: [],
      joined,
      powered: true,
      identifyUntil: 0,
      zone: { kind: spec.kind, type: ZONE_OF[spec.kind].type, status: 0 },
    };
    this.devices.push(d);
    return d;
  }

  /** A new sensor, factory fresh, joining while the pairing window is open: its maker is read first, then the interview. */
  joinSensor(spec: SensorSpec): ZigbeeDevice | null {
    if (this.permitUntil === 0 || this.hooks.now() > this.permitUntil) return null;
    const d = this.addSensor(spec, true);
    this.announce(d, 50);
    this.report(d, { ModelId: d.model, Manufacturer: d.manufacturer }, 300);
    this.hooks.emit(JSON.stringify({
      ZbState: {
        Status: 33, Device: hex4(d.short), Endpoint: hex2(d.endpoint), ProfileId: hex4(d.profile), DeviceId: hex4(d.deviceId),
        DeviceVersion: 1, InClusters: d.inClusters.map(hex4), OutClusters: d.outClusters.map(hex4),
      },
    }), 600);
    return d;
  }

  /**
   * A sensor's zone changing: the door opening or closing, motion seen or cleared, water found or gone. It reports as
   * Z2T publishes a zone status notification: the alarm named by its type (Occupancy for a PIR) and the raw status,
   * with the tamper and the low battery flags when set. Nothing for a device that is not a sensor.
   */
  trip(name: string, on: boolean, { tamper = false, batteryLow = false }: { tamper?: boolean; batteryLow?: boolean } = {}): void {
    const d = this.find(name);
    if (!d || !d.zone) return;
    d.zone.status = (on ? 1 : 0) | (tamper ? 4 : 0) | (batteryLow ? 8 : 0);
    const attrs: Record<string, unknown> = { [ZONE_OF[d.zone.kind].name]: on ? 1 : 0, ZoneStatus: d.zone.status };
    if (tamper) attrs.Tamper = 1;
    if (batteryLow) attrs.BatteryLow = 1;
    this.report(d, attrs, 20);
  }

  /** A new blind, factory fresh, joining while the pairing window is open: its maker is read first, then the interview. */
  joinCover(spec: CoverSpec): ZigbeeDevice | null {
    if (this.permitUntil === 0 || this.hooks.now() > this.permitUntil) return null;
    const d = this.addCover(spec, true);
    this.announce(d, 50);
    this.report(d, { ModelId: d.model, Manufacturer: d.manufacturer }, 300);
    this.hooks.emit(JSON.stringify({
      ZbState: {
        Status: 33, Device: hex4(d.short), Endpoint: hex2(d.endpoint), ProfileId: hex4(d.profile), DeviceId: hex4(d.deviceId),
        DeviceVersion: 1, InClusters: d.inClusters.map(hex4), OutClusters: d.outClusters.map(hex4),
      },
    }), 600);
    return d;
  }

  /** a Star Ring's datapoints in one report: the position kept in step with where it is */
  private reportCoverDps(d: ZigbeeDevice, c: Cover, dps: number[], delay: number) {
    c.dps.get(2)!.value = Math.round(c.pos);
    const frame: Record<string, unknown> = {};
    for (const dp of dps) {
      const e = c.dps.get(dp);
      if (e) frame[tuyaKey(e.type, dp)] = e.value;
    }
    this.report(d, frame, delay);
  }

  /** what a blind says of itself: a TS130F its lift and its motion, a Star Ring its position when it stands */
  private coverSays(d: ZigbeeDevice, c: Cover, delay: number, moving: boolean) {
    if (c.profile === "zcl") {
      this.report(d, { CurrentPositionLiftPercentage: Math.round(c.pos), TuyaMovingState: c.dir > 0 ? 0 : c.dir < 0 ? 2 : 1 }, delay);
    } else if (!moving) {
      this.reportCoverDps(d, c, [2], delay);
    }
  }

  /**
   * A blind sent up, down or to stop, by a command or by a key on the wall. It moves a step a second towards `target`,
   * and stands where it got when stopped. A Star Ring echoes the control it was given, or says the key pressed.
   */
  private coverMove(d: ZigbeeDevice, c: Cover, way: "up" | "down" | "stop", target: number, delay: number) {
    c.move += 1;
    if (c.profile === "tuya") {
      c.dps.get(1)!.value = way === "up" ? 0 : way === "down" ? 2 : 1;
      this.reportCoverDps(d, c, [1], delay);
    }
    if (way === "stop" || Math.round(c.pos) === target) {
      c.dir = 0;
      c.target = Math.round(c.pos);
      this.coverSays(d, c, delay + 10, false);
      return;
    }
    c.dir = target > c.pos ? 1 : -1;
    c.target = target;
    if (c.profile === "zcl") this.coverSays(d, c, delay + 10, true);
    const token = c.move;
    const step = () => {
      if (c.move !== token || !d.powered) return;
      c.pos += c.dir * (100 * COVER_STEP_MS) / c.travelMs;
      const there = c.dir > 0 ? c.pos >= c.target : c.pos <= c.target;
      if (there) {
        c.pos = c.target;
        c.dir = 0;
        this.coverSays(d, c, 5, false);
        return;
      }
      this.coverSays(d, c, 5, true);
      this.hooks.tick?.(step, COVER_STEP_MS);
    };
    this.hooks.tick?.(step, COVER_STEP_MS + delay);
  }

  /** a blind sent to a position, 0 closed to 100 open */
  private coverTo(d: ZigbeeDevice, c: Cover, target: number, delay: number) {
    this.coverMove(d, c, target > c.pos ? "up" : target < c.pos ? "down" : "stop", target, delay);
  }

  /** A write to a blind: a Star Ring's control or position datapoint, or a setting, which it echoes; a TS130F's settings by name */
  private writeCover(d: ZigbeeDevice, c: Cover, write: Record<string, unknown>, delay: number) {
    for (const [k, raw] of Object.entries(write)) {
      const v = Math.trunc(Number(raw));
      if (c.profile === "zcl") {
        if (!(k in c.attrs)) continue;
        c.attrs[k] = v;
        this.hooks.emit(JSON.stringify({
          ZbResponse: { Device: hex4(d.short), Command: "0102_04", Status: 0, StatusMessage: "SUCCESS", Endpoint: d.endpoint, LinkQuality: 120 },
        }), delay);
        continue;
      }
      const m = /^EF00\/([0-9A-F]{2})([0-9A-F]{2})$/i.exec(k);
      if (!m) continue;
      const dp = parseInt(m[2], 16);
      if (dp === 1) this.coverMove(d, c, v === 0 ? "up" : v === 2 ? "down" : "stop", v === 0 ? 100 : 0, delay);
      else if (dp === 2) this.coverTo(d, c, Math.max(0, Math.min(100, v)), delay);
      else if (c.dps.has(dp)) {
        c.dps.get(dp)!.value = v;
        this.reportCoverDps(d, c, [dp], delay);
      }
    }
  }

  /** A key pressed on a blind's wall switch: up, stop or down, as the device does it by itself */
  coverKey(ieee: string, way: "up" | "down" | "stop", delay = 20) {
    const d = this.find(ieee);
    if (!d || !d.cover || !d.powered) return;
    this.coverMove(d, d.cover, way, way === "up" ? 100 : 0, delay);
  }

  // --- the rest of Z2T's commands ---------------------------------------------------------------

  /**
   * ZbConfig, as CmndZbConfig answers it: the network's configuration, and a new
   * channel saved and the device restarted, as its restart_flag 2 does. At the
   * boot after it the coordinator forms the network again on the channel, and the
   * lamps of the old one are left out of it.
   */
  private config(text: string): string {
    if (text !== "") {
      let j: Record<string, unknown>;
      try {
        j = JSON.parse(text);
      } catch {
        return JSON.stringify({ ZbConfig: "Invalid JSON" });
      }
      const field = (name: string) => Object.entries(j).find(([k]) => k.toLowerCase() === name)?.[1];
      const raw = field("channel");
      const channel = Math.max(11, Math.min(26, raw === undefined ? this.channel : Number(raw)));
      // CmndZbConfig: a key of zero in both halves is replaced by the chip's random generator's
      const given = (name: string, now: string) => (field(name) === undefined ? now : String(field(name)));
      let keyL = given("keyl", this.keyL);
      let keyH = given("keyh", this.keyH);
      const zero = (v: string) => /^(0x)?0+L?$/i.test(v);
      if (zero(keyL) && zero(keyH)) {
        const random = () => "0x" + Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16).toUpperCase()).join("");
        do { keyL = random(); keyH = random(); } while (keyL === keyH);
      }
      // the PAN IDs as CmndZbConfig takes them (getUInt and getULong of a "0x..." string), kept as ZbConfig says them
      const num = (name: string, now: string, digits: number) => {
        const v = field(name);
        if (v === undefined) return now;
        return "0x" + BigInt(String(v)).toString(16).toUpperCase().padStart(digits, "0");
      };
      const panId = num("panid", this.panId, 4);
      const extPanId = num("extpanid", this.extPanId, 16);
      if (channel !== this.channel || keyL !== this.keyL || keyH !== this.keyH || panId !== this.panId || extPanId !== this.extPanId) {
        this.channel = channel;
        this.keyL = keyL;
        this.keyH = keyH;
        this.panId = panId;
        this.extPanId = extPanId;
        for (const d of this.devices) d.joined = false;
        this.hooks.restart?.("ZbConfig");
      }
    }
    return JSON.stringify({ ZbConfig: { Channel: this.channel, PanID: this.panId, ExtPanID: this.extPanId,
                                        KeyL: this.keyL, KeyH: this.keyH, TxRadio: 20 } });
  }

  private permit(arg: string): string {
    const on = arg !== "0";
    this.permitUntil = on ? this.hooks.now() + 60000 : 0;
    this.hooks.emit(JSON.stringify({ ZbState: { Status: on ? 21 : 20, Message: on ? "Pairing mode enabled" : "Pairing mode disabled" } }), 20);
    return JSON.stringify({ ZbPermitJoin: "Done" });
  }

  private ping(name: string): string {
    const d = this.find(name);
    if (!d) return JSON.stringify({ ZbPing: "Unknown device" });
    if (d.powered) {
      this.hooks.emit(JSON.stringify({ ZbPing: { Device: hex4(d.short), IEEEAddr: d.ieee } }), 40);
    } else {
      // Z_Unreachable: no answer to the IEEE address request in 2 s
      this.report(d, { Reachable: false }, 2000);
    }
    return JSON.stringify({ ZbPing: "Done" });
  }

  private info(name: string): string {
    const list = name ? [this.find(name)].filter((d): d is ZigbeeDevice => !!d) : this.devices.filter((d) => d.joined);
    let delay = INFO_FIRST_MS;
    const seen = new Set<string>();
    for (const d of list) {
      // a switch of several is one device: its channels' endpoints and Config together
      if (seen.has(d.ieee)) continue;
      seen.add(d.ieee);
      const all = this.devices.filter((x) => x.joined && x.ieee === d.ieee);
      const json = JSON.stringify({
        ZbInfo: { [hex4(d.short)]: {
          Device: hex4(d.short), IEEEAddr: d.ieee, ModelId: d.model, Manufacturer: d.manufacturer,
          Endpoints: all.map((x) => x.endpoint), Config: all.flatMap((x) => x.config),
          // a sensor's: the zone's type and its last status, as Z2T keeps them
          ...(d.thermo ? this.thermoInfo(d.thermo) : d.cover ? {} : d.zone ? { ZoneType: d.zone.type, ZoneStatus: d.zone.status }
            : { Power: d.power, Dimmer: d.dimmer }),
          Reachable: d.powered,
        } },
      });
      if (this.infoGapMs === 0 && this.hooks.publish) this.hooks.publish(json);
      else this.hooks.emit(json, delay);
      delay += this.infoGapMs;
    }
    return JSON.stringify({ ZbInfo: "Done" });
  }

  // --- what happens to the lamps from outside -----------------------------------------------

  /** A relay moved: the lamps it feeds lose their power, or get it back and come back up. */
  relayChanged(n: number, on: boolean) {
    for (const d of this.devices.filter((x) => x.relay === n)) {
      if (d.powered === on) continue;
      d.powered = on;
      if (!on) continue;
      // StartUpOnOff decides how it comes back, and it announces itself again
      if (d.startUpOnOff === 0) d.power = 0;
      else if (d.startUpOnOff === 1) d.power = 1;
      else if (d.startUpOnOff === 2) d.power = d.power ? 0 : 1;
      if (d.joined) this.announce(d, 900 + 20 * this.devices.indexOf(d));
    }
  }

  /** A new lamp, factory fresh, joining while the pairing window is open. */
  join(spec: LampSpec): ZigbeeDevice | null {
    if (this.permitUntil === 0 || this.hooks.now() > this.permitUntil) return null;
    const d = this.add(spec, [], true);
    d.startUpOnOff = 255;
    this.announce(d, 50);
    this.hooks.emit(JSON.stringify({
      ZbState: {
        Status: 33, Device: hex4(d.short), Endpoint: hex2(d.endpoint), ProfileId: hex4(d.profile), DeviceId: hex4(d.deviceId),
        DeviceVersion: 1, InClusters: d.inClusters.map(hex4), OutClusters: d.outClusters.map(hex4),
      },
    }), 600);
    this.report(d, { ModelId: d.model, Manufacturer: d.manufacturer }, 900);
    return d;
  }

  private announce(d: ZigbeeDevice, delay: number) {
    this.hooks.emit(JSON.stringify({
      ZbState: { Status: 30, IEEEAddr: d.ieee, ShortAddr: hex4(d.short), PowerSource: true, ReceiveWhenIdle: true, Security: false },
    }), delay);
  }

  /** a fresh IEEE for a lamp that has none yet */
  freshIeee(): string {
    return "0x00158D0000" + (0xa000 + ++this.seq).toString(16).toUpperCase().padStart(6, "0");
  }

  /** what Z2T knows of a thermostat's data: a ZCL one has its temperature and target, a Tuya one none of it */
  private thermoInfo(t: Thermostat): Record<string, unknown> {
    return t.profile === "zcl" ? { Temperature: t.cur / 10, TempTarget: t.set / 10 } : {};
  }

  // --- the switches of several channels ----------------------------------------------

  /** A switch of several on the network: a record a channel, the device's address on each, off, its own supply. */
  addSwitch(spec: SwitchSpec, joined = true): ZigbeeDevice[] {
    const short = this.nextShort++;
    const out: ZigbeeDevice[] = [];
    for (let ep = 1; ep <= spec.channels; ep++) {
      const d: ZigbeeDevice = {
        ieee: spec.ieee,
        short,
        endpoint: ep,
        model: spec.model ?? "TS0002",
        manufacturer: "_TZ3000_sim2ch",
        profile: 0x0104,
        // an on/off light on each endpoint, as a TS0002 says itself, with the Tuya clusters of its inching and power-on state
        deviceId: 0x0100,
        inClusters: [...(ep === 1 ? [0x0000, 0x0003] : []), 0x0004, 0x0005, 0x0006, 0xe000, 0xe001],
        outClusters: ep === 1 ? [0x0019, 0x000a] : [],
        config: [`O${String(ep).padStart(2, "0")}`],
        relay: spec.relay ?? 0,
        ct: [153, 500],
        power: 0,
        dimmer: 0,
        colorTemp: 300,
        hue: 0,
        sat: 0,
        startUpOnOff: 255,
        groups: [],
        joined,
        powered: spec.relay ? this.hooks.relay(spec.relay) : true,
        identifyUntil: 0,
      };
      this.devices.push(d);
      out.push(d);
    }
    return out;
  }

  /** A switch of several, factory fresh, joining while the pairing window is open: one announce, an interview an endpoint. */
  joinSwitch(spec: SwitchSpec): ZigbeeDevice[] | null {
    if (this.permitUntil === 0 || this.hooks.now() > this.permitUntil) return null;
    const ds = this.addSwitch(spec, true);
    this.announce(ds[0], 50);
    ds.forEach((d, i) => this.hooks.emit(JSON.stringify({
      ZbState: {
        Status: 33, Device: hex4(d.short), Endpoint: hex2(d.endpoint), ProfileId: hex4(d.profile), DeviceId: hex4(d.deviceId),
        DeviceVersion: 1, InClusters: d.inClusters.map(hex4), OutClusters: d.outClusters.map(hex4),
      },
    }), 600 + 80 * i));
    this.report(ds[0], { ModelId: ds[0].model, Manufacturer: ds[0].manufacturer }, 900);
    return ds;
  }

  /** a channel's key on the module, pressed: it toggles, and reports from its endpoint */
  switchKey(ieee: string, ep: number, delay = 20) {
    const d = this.devices.find((x) => x.joined && x.ieee === ieee && x.endpoint === ep);
    if (!d || !d.powered) return;
    d.power = d.power ? 0 : 1;
    this.report(d, { Power: d.power }, delay);
  }

  /** what the zigbee module lists (be_zigbee.c): the long address little-endian, as its bytes() */
  moduleDevices() {
    const firsts = this.devices.filter((d, i, all) => d.joined && all.findIndex((x) => x.joined && x.ieee === d.ieee) === i);
    return firsts.map((d) => ({
      longaddr: d.ieee.slice(2).match(/../g)!.reverse().join(""),
      shortaddr: d.short,
      model: d.model,
      manufacturer: d.manufacturer,
      // a lamp is on the mains, and routes
      router: true,
      // what Z2T knows of it, as zb_device.info() dumps it (jsonDumpSingleDevice, level 3)
      info: d.thermo || d.cover ? {
        IEEEAddr: d.ieee, ModelId: d.model, Manufacturer: d.manufacturer, Endpoints: [d.endpoint], Config: d.config,
        ...(d.thermo ? this.thermoInfo(d.thermo) : {}), Reachable: d.powered,
      } : {
        IEEEAddr: d.ieee, ModelId: d.model, Manufacturer: d.manufacturer, Endpoints: [d.endpoint], Config: d.config,
        Power: d.power, Dimmer: d.dimmer, ...(d.config[0]?.endsWith(".2") || d.config[0]?.endsWith(".5") ? { CT: d.colorTemp } : {}),
        ...(d.config[0]?.endsWith(".3") || d.config[0]?.endsWith(".5") ? { Hue: d.hue, Sat: d.sat } : {}),
        Reachable: d.powered,
      },
    }));
  }
}
