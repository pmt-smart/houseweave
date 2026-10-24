// A house, simulated: its devices on one clock, the air between their radios,
// the WiFi networks in range, and the house's network between the devices whose
// WiFi is up.
//
// The devices are the panel and the bridge (panel.ts, bridge.ts), each with its
// own VM and its own radio drivers. advance() runs them in the 5 ms turns of
// Tasmota's loop, one after the other in the same turn, and after each the air
// delivers what its ESP-NOW sent. The house's network carries UDP, a broadcast
// to every device listening on the port and a packet to the one of the address,
// and TCP: a connection to a device that listens on the port comes up a moment
// later, carries what each end writes, and ends when either closes it, when
// either device's WiFi goes down, or, unseen by the other end until it writes,
// when a device restarts. And a service of the house, a server that is no
// device of it, answers HTTP at its address: the release server, whose own
// request handler a test gives it (ha/houseweave/server/release-server.mjs). And the
// house may have a mesh (enableMesh): the air of the ESP-NOW mesh that the devices
// whose image has the driver share (mesh-driver.ts), run by the same clock.
import { Air, REAL_LOOP, REAL_TIMING, type LoopTiming, type RadioTiming, type SimNetwork } from "./radio.js";
import { SIM_AIR, type SimDevice } from "./device.js";
import { MeshNet, type MeshNetOptions } from "./mesh-driver.js";

/** One end of a TCP connection, as the device that holds it sees it. */
export interface TcpEnd {
  state: "connecting" | "up" | "closed";
  /** what the other end wrote, not read yet */
  inbox: string;
  /** the other end's address and port, and this end's port */
  remote: string;
  remotePort: number;
  localPort: number;
  /** the other end, once the connection is up */
  peer?: { device: SimDevice; n: number };
  /** when a connection being made comes up or is refused */
  due?: number;
  /** the server it is being made to */
  server?: TcpServer;
  /** the house's service it is to, which answers what the device writes */
  service?: HttpService;
  /** what the device wrote to the service, not answered yet, as bytes */
  request?: Uint8Array;
}

/** An HTTP request, as a service of the house takes it, and its answer (ha/houseweave/server/release-server.mjs's createHandler). */
export interface HttpRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Uint8Array;
  length: number;
  /** the house's clock, for what the service times */
  now: number;
  /** the address of the device that asked */
  from?: string;
}
export interface HttpAnswer {
  status: number;
  headers?: Record<string, string>;
  body?: Uint8Array | string;
}

interface HttpService {
  ip: string;
  port: number;
  handle: (req: HttpRequest) => HttpAnswer;
  /** every request it answered, in order */
  log: { method: string; path: string; status: number }[];
}

interface TcpServer {
  device: SimDevice;
  n: number;
  port: number;
  /** the ends that came up and wait for acceptasync(), by their number on the server's device */
  pending: number[];
}

/** a text's length in UTF-8 bytes: a name with an accent is longer than its characters */
function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** whether an MQTT topic matches a subscription's pattern: `+` a level, `#` the rest */
export function topicMatches(pattern: string, topic: string): boolean {
  const p = pattern.split("/");
  const t = topic.split("/");
  for (let i = 0; i < p.length; i++) {
    if (p[i] === "#") return true;
    if (i >= t.length || (p[i] !== "+" && p[i] !== t[i])) return false;
  }
  return p.length === t.length;
}

/** where a request's head ends: the blank line, or -1 */
function indexOfCrlfCrlf(b: Uint8Array): number {
  for (let i = 0; i + 3 < b.length; i++) if (b[i] === 13 && b[i + 1] === 10 && b[i + 2] === 13 && b[i + 3] === 10) return i;
  return -1;
}

const STATUS_TEXT: Record<number, string> = { 200: "OK", 204: "No Content", 400: "Bad Request", 404: "Not Found", 405: "Method Not Allowed", 413: "Payload Too Large" };

/** a connection comes up, or is refused, this long after connect() */
const TCP_CONNECT_MS = 20;
/** a packet's way across the house's network */
const UDP_MS = 2;

export class SimHouse {
  readonly clock = { now: 0 };
  readonly air = new Air();
  /** what the main loop of each device of the house spends on the frames its drain takes (radio.ts): the hardware's unless the house is made with another */
  readonly loop: LoopTiming;
  readonly devices: SimDevice[] = [];
  /** the air of the house's ESP-NOW mesh, once enableMesh has made it: a device whose `mesh` option is set has a node on it */
  mesh?: MeshNet;
  readonly networks: readonly SimNetwork[];
  /** the house's MQTT broker, when it has one: its address, port and the one account it takes */
  readonly mqttBroker?: { host: string; port: number; user: string; password: string };
  /** what the broker keeps, a retained message a topic */
  readonly retained = new Map<string, string>();
  /** every message published on the broker, by a device (its MAC) or by a test (`from` "test"), in order */
  readonly mqttLog: { from: string; topic: string; payload: string; retain: boolean }[] = [];
  /** the broker's other clients, which are no device: what they subscribed to, and what they do with it */
  private readonly mqttServices: { pattern: string; onMessage: (topic: string, payload: string) => void }[] = [];
  private readonly servers: TcpServer[] = [];
  private readonly services: HttpService[] = [];
  private next = 1;

  constructor(options: {
    networks?: SimNetwork[];
    broker?: { host: string; port?: number; user?: string; password?: string };
    /** what the air does with a frame (radio.ts RadioTiming): REAL_TIMING, a frame's time on the air, when not said; IDEAL_TIMING for a test that is not about the radio */
    air?: Partial<RadioTiming>;
    /** what the devices' main loops do with the frames they drain (radio.ts LoopTiming): REAL_LOOP when not said, IDEAL_LOOP for a test that is not about the radio */
    loop?: Partial<LoopTiming>;
  } = {}) {
    this.networks = options.networks ?? SIM_AIR;
    this.air.timing = { ...REAL_TIMING, ...options.air };
    this.loop = { ...REAL_LOOP, ...options.loop };
    if (options.broker) this.mqttBroker = { port: 1883, user: "", password: "", ...options.broker };
    this.air.networks = this.networks;
    this.air.now = this.clock.now;
  }

  get now(): number {
    return this.clock.now;
  }

  /**
   * The house has a mesh: one air for the nodes of every device that has the driver, run by the house's clock from now on, with the firmware's own
   * options for the core (heartbeats every 5 s, the start asks, the choice of relays, the mesh clock). Made before the devices that have the driver
   * (SimDevice options `mesh`).
   */
  async enableMesh(options: MeshNetOptions = {}): Promise<MeshNet> {
    if (this.mesh) throw new Error("the house has a mesh already");
    this.mesh = await MeshNet.create(this, options);
    return this.mesh;
  }

  /** whether a client with these settings is on the house's broker */
  broker(settings: { host: string; port: number; user: string; password: string }): boolean {
    const b = this.mqttBroker;
    return !!b && settings.host === b.host && settings.port === b.port && settings.user === b.user && settings.password === b.password;
  }

  /** a message the broker keeps for the topic, or drops, as an empty retained one clears it */
  retain(topic: string, payload: string, retain: boolean) {
    if (!retain) return;
    if (payload === "") this.retained.delete(topic);
    else this.retained.set(topic, payload);
  }

  /**
   * A message on the house's broker, from a device or from a test standing for
   * another client (Home Assistant): kept when retained, and delivered to every
   * device on the broker subscribed to a pattern it matches, the one that sent it
   * too, as a broker does.
   */
  mqttPublish(topic: string, payload: string, retain = false, from = "test") {
    if (!this.mqttBroker) return;
    this.mqttLog.push({ from, topic, payload, retain });
    this.retain(topic, payload, retain);
    for (const d of this.devices) {
      if (!d.mqttConnected) continue;
      if ([...d.mqttTopics].some((p) => topicMatches(p, topic))) d.mqttInbox.push([topic, payload]);
      // Tasmota's own subscription, cmnd/<topic>/#: a command, run in its loop
      const own = `cmnd/${d.mqttTopic}/`;
      if (topic.startsWith(own) && topic.length > own.length && !topic.slice(own.length).includes("/")) d.mqttCommands.push([topic.slice(own.length), payload]);
    }
    for (const s of this.mqttServices) if (topicMatches(s.pattern, topic)) s.onMessage(topic, payload);
  }

  /**
   * A client of the broker that is no device, a server of the house: what is
   * published on a topic its pattern matches goes to `onMessage`, which
   * publishes back with mqttPublish. The release server's keys are one
   * (ha/houseweave/server/release-server.mjs).
   */
  mqttService(pattern: string, onMessage: (topic: string, payload: string) => void) {
    this.mqttServices.push({ pattern, onMessage });
  }

  /** a device subscribed: what the broker keeps for the pattern goes to it, if it is on the broker */
  mqttSubscribed(device: SimDevice, pattern: string) {
    if (!device.mqttConnected) return;
    for (const [topic, payload] of this.retained) if (topicMatches(pattern, topic)) device.mqttInbox.push([topic, payload]);
  }

  /**
   * A device that came on the broker: its LWT Online, as Tasmota publishes it,
   * and what the broker keeps for its subscriptions. One that left it: the LWT
   * Offline, its will, as the broker publishes it.
   */
  private mqttConnecting() {
    if (!this.mqttBroker) return;
    for (const d of this.devices) {
      const up = d.mqttConnected;
      if (up && !d.mqttWasUp) {
        this.mqttPublish(`tele/${d.mqttTopic}/LWT`, "Online", true, d.mac);
        for (const p of d.mqttTopics) this.mqttSubscribed(d, p);
      }
      if (!up && d.mqttWasUp) this.mqttPublish(`tele/${d.mqttTopic}/LWT`, "Offline", true, "broker");
      d.mqttWasUp = up;
    }
  }

  /** a device booted in the house (SimDevice.boot) */
  add(device: SimDevice) {
    if (!this.devices.includes(device)) this.devices.push(device);
  }

  /** A device gone, as a restart takes it: its servers close, and its connections die with no word to the other end. */
  remove(device: SimDevice) {
    const i = this.devices.indexOf(device);
    if (i >= 0) this.devices.splice(i, 1);
    // gone from the broker too: its will
    if (device.mqttWasUp) {
      device.mqttWasUp = false;
      this.mqttPublish(`tele/${device.mqttTopic}/LWT`, "Offline", true, "broker");
    }
    for (let k = this.servers.length - 1; k >= 0; k--) if (this.servers[k].device === device) this.servers.splice(k, 1);
    device.tcp.clear();
  }

  /** Every device whose restart came due, booted again from what it kept, in its place: the new ones. */
  async settle(): Promise<SimDevice[]> {
    const booted: SimDevice[] = [];
    for (const d of [...this.devices]) {
      if (d.restartDue) booted.push(await d.restartNow());
    }
    return booted;
  }

  /** Runs every device through `ms`, in the 5 ms turns of Tasmota's loop. */
  advance(ms: number) {
    const end = this.clock.now + ms;
    while (this.clock.now < end) {
      const before = this.clock.now;
      this.clock.now = Math.min(end, before + 5);
      this.air.now = this.clock.now;
      // the mesh's air runs up to the new time first: what a device's Berry asked of the driver in the last turn is taken at the instant it was asked
      this.mesh?.advanceTo(this.clock.now);
      this.connecting();
      this.mqttConnecting();
      for (const d of [...this.devices]) {
        d.step(before);
        this.air.deliver();
      }
    }
  }

  // --- the room's circuits -------------------------------------------------------------------

  /**
   * A relay of the room: the panel's, which feeds its lamps whichever network
   * they joined, the bridge's too.
   */
  relay(n: number): boolean {
    return this.devices.find((d) => d.relays.length > 0)?.relays[n - 1] ?? false;
  }

  /** a relay of the panel moved: the lamps it feeds on another device's network lose their power, or get it back */
  relayChanged(from: SimDevice, n: number, on: boolean) {
    for (const d of this.devices) if (d !== from && d.relays.length === 0) d.zigbee.relayChanged(n, on);
  }

  // --- UDP ------------------------------------------------------------------------------------

  /** A packet from a device whose WiFi is up: to every device of the address, or all for a broadcast, listening on the port. */
  udp(from: SimDevice, ip: string, port: number, text: string): boolean {
    for (const d of this.devices) {
      if (d === from || !d.wifi.up || !d.udpPorts.has(port)) continue;
      if (ip !== "255.255.255.255" && ip !== d.ip) continue;
      d.udpInbox.push({ at: this.clock.now + UDP_MS, packet: JSON.stringify([text, from.ip, port]) });
    }
    return true;
  }

  // --- TCP ------------------------------------------------------------------------------------

  tcpListen(device: SimDevice, port: number): number {
    const n = this.next++;
    this.servers.push({ device, n, port, pending: [] });
    return n;
  }

  tcpUnlisten(device: SimDevice, n: number) {
    const i = this.servers.findIndex((s) => s.device === device && s.n === n);
    if (i >= 0) this.servers.splice(i, 1);
  }

  tcpPending(device: SimDevice, n: number): boolean {
    return (this.servers.find((s) => s.device === device && s.n === n)?.pending.length ?? 0) > 0;
  }

  tcpAccept(device: SimDevice, n: number): number {
    return this.servers.find((s) => s.device === device && s.n === n)?.pending.shift() ?? 0;
  }

  /** A connection from a device whose WiFi is up: connecting, and up or refused a moment later. */
  tcpConnect(device: SimDevice, ip: string, port: number): number {
    const n = this.next++;
    const server = this.servers.find((s) => s.device.ip === ip && s.port === port && this.devices.includes(s.device));
    const service = server ? undefined : this.services.find((s) => s.ip === ip && s.port === port);
    device.tcp.set(n, { state: "connecting", inbox: "", remote: ip, remotePort: port, localPort: 49152 + (n % 16000),
                        due: this.clock.now + TCP_CONNECT_MS, server, service });
    return n;
  }

  /**
   * A service of the house at `ip`:`port`, which answers HTTP: every request
   * a device writes to it, once whole at its Content-Length, goes to `handle`,
   * and its answer back, with its length. The connection stays up after it, as
   * the device's socket sees one the server closed once its answer is read, until
   * the device closes it. The requests it answered are in the list it returns.
   */
  serve(ip: string, port: number, handle: (req: HttpRequest) => HttpAnswer): { method: string; path: string; status: number }[] {
    const service = { ip, port, handle, log: [] };
    this.services.push(service);
    return service.log;
  }

  /** what a device wrote to a service: answered once the request is whole */
  private toService(end: TcpEnd, text: string, from: string) {
    const s = end.service!;
    const more = new TextEncoder().encode(text);
    const buf = new Uint8Array((end.request?.length ?? 0) + more.length);
    if (end.request) buf.set(end.request);
    buf.set(more, end.request?.length ?? 0);
    end.request = buf;
    const blank = indexOfCrlfCrlf(buf);
    if (blank < 0) return;
    const head = new TextDecoder().decode(buf.subarray(0, blank)).split("\r\n");
    const [method, path] = head[0].split(" ");
    const headers: Record<string, string> = {};
    for (const line of head.slice(1)) {
      const i = line.indexOf(":");
      if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    const length = Number(headers["content-length"] ?? 0);
    const body = buf.subarray(blank + 4);
    if (body.length < length) return;
    end.request = new Uint8Array(0);
    const a = s.handle({ method, path, headers, body: body.subarray(0, length), length, now: this.clock.now, from });
    s.log.push({ method, path, status: a.status });
    const payload = typeof a.body === "string" ? new TextEncoder().encode(a.body) : (a.body ?? new Uint8Array(0));
    const lines = [`HTTP/1.1 ${a.status} ${STATUS_TEXT[a.status] ?? "Status"}`];
    for (const [k, v] of Object.entries(a.headers ?? {})) if (k.toLowerCase() !== "content-length") lines.push(`${k}: ${v}`);
    lines.push(`Content-Length: ${payload.length}`, "Connection: close", "", "");
    end.inbox += lines.join("\r\n") + new TextDecoder().decode(payload);
  }

  /** the connections being made, on time: up with an end on the server's device, or refused */
  private connecting() {
    for (const d of this.devices) {
      for (const [n, end] of d.tcp) {
        if (end.state !== "connecting" || end.due === undefined || end.due > this.clock.now) continue;
        if (end.service) {
          end.state = d.wifi.up ? "up" : "closed";
          continue;
        }
        const s = end.server;
        if (!s || !this.servers.includes(s) || !s.device.wifi.up || !d.wifi.up) {
          end.state = "closed";
          continue;
        }
        const m = this.next++;
        s.device.tcp.set(m, { state: "up", inbox: "", remote: d.ip, remotePort: end.localPort, localPort: s.port, peer: { device: d, n } });
        end.state = "up";
        end.peer = { device: s.device, n: m };
        end.server = undefined;
        s.pending.push(m);
      }
    }
  }

  /** What an end writes reaches the other: all of it, or nothing on a connection that is gone, which then closes. */
  tcpWrite(device: SimDevice, n: number, text: string): number {
    const end = device.tcp.get(n);
    if (end?.state === "up" && end.service) {
      this.toService(end, text, device.ip);
      return utf8Length(text);
    }
    if (!end || end.state !== "up" || !end.peer) return 0;
    const other = end.peer.device.tcp.get(end.peer.n);
    if (!other || other.state !== "up" || !this.devices.includes(end.peer.device)) {
      // the other device restarted, and its answer to this write is a reset
      end.state = "closed";
      return 0;
    }
    other.inbox += text;
    // what the socket took, in bytes, as the device's Berry counts its string
    return utf8Length(text);
  }

  /** An end closed: the other end sees it closed too. */
  tcpClose(device: SimDevice, n: number) {
    const end = device.tcp.get(n);
    if (!end) return;
    device.tcp.delete(n);
    if (end.peer) {
      const other = end.peer.device.tcp.get(end.peer.n);
      if (other) other.state = "closed";
    }
  }

  /** A device's WiFi went down: every connection it holds ends, on both sides. */
  dropped(device: SimDevice) {
    for (const [n, end] of [...device.tcp]) {
      if (end.state === "closed") continue;
      end.state = "closed";
      if (end.peer) {
        const other = end.peer.device.tcp.get(end.peer.n);
        if (other) other.state = "closed";
      }
      void n;
    }
  }
}
