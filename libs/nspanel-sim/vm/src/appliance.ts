// An appliance: a node of the house that is itself one device of it (berry/appliance_node.be), with no Zigbee network and no screen. Its image carries
// the house's part of a node with no screen, as the bridge's does, with neither the Zigbee side nor the alarm, and its own device.
//
// The one simulated is the Sonoff TH Elite THR320D on a water heater (the env tasmota32-houseweave-thr320d): the ESP32 with Tasmota and the node's
// Berry on it (device.ts), and what its template and its commands give it (firmware/overrides/user_config_override.h):
//   - one Power, a latching relay. Tasmota pulses a coil and never reads the contact, so the contact is kept here apart from what Tasmota
//     believes: it is where the last pulse left it, through a restart and a power cut. SetOption0 0 keeps no state for a restart, PowerOnState 0
//     opens it at a power up, and the rule of the image opens it at every boot (System#Init);
//   - the WTS01 probe, on the serial bridge: Tasmota's sensors have its temperature while its datagrams come, and nothing of it with the probe
//     unplugged; TempOffset is added to it;
//   - the button, detached from the relay (SetOption73 1): a press reaches the rules as {"Button1":{"State":10}} and toggles nothing, the 5 s
//     hold as {"Button1":{"State":3}}; its pin reads 0 while it is pressed;
//   - two LEDs of its own, both inverted, 1 off: the red, LED1 on GPIO16, which follows the relay, and the green, LED2 on GPIO13, the node's.
import type { Berry } from "./berry.js";
import { SimDevice, type DeviceOptions } from "./device.js";

/**
 * The appliance's Berry, in the order its files have to load: a file comes after the ones it names. The same files are the build's: the env
 * tasmota32-houseweave-thr320d compiles them in (firmware/overrides/platformio_override.ini), its autoexec.be loads a fix of any of them
 * (berry/appliance_autoexec.be), and test/brain.test.mjs holds the three lists to each other.
 */
export const APPLIANCE_FILES = ["panel_build.be", "pair_sign.be", "clock_link.be", "node_host.be", "node_pairing.be", "mesh_beat.be", "mesh_events.be", "mesh_cmd.be", "house_list.be", "house_key.be", "house_state.be", "house_devices.be", "house_link.be", "house_channel.be", "house_mesh.be", "house_commands.be", "house_mqtt.be", "panel_wifi.be", "panel_http.be", "node_ota.be", "node_wireless.be", "server_link.be", "mesh_http.be", "node_settings.be", "node_backup.be", "keys_backup.be", "boiler_history.be", "boiler_thermostat.be", "appliance_node.be"] as const;

/** GPIO_LED1, the function gpio.pin() looks up, and the pins the template gives its first two: the red and the green */
const LED1 = 288;
const LED_PINS = [16, 13];
/** GPIO_KEY1, the button's function, and the pin the template gives it (Button1, GPIO0) */
const KEY1 = 32;
const BUTTON_PIN = 0;
/** how long after the boot the image's rule runs: System#Init comes with the first turn of the rules, 50 ms in */
const INIT_RULE_MS = 50;

export interface ApplianceOptions extends DeviceOptions {
  /** its name, which the pairing announces and a panel shows: "thr320d-boiler" when not said */
  hostname?: string;
  /** the water at the probe, in degrees, or null for a probe unplugged: 50 when not said */
  water?: number | null;
  /** the relay's contact as the boot finds it, where the last pulse left it: open when not said */
  contact?: boolean;
  /** Tasmota's temperature offset, which the flash keeps: 0 when not said */
  tempOffset?: number;
}

export class SimAppliance extends SimDevice {
  readonly hostname: string;
  protected readonly brainFiles = APPLIANCE_FILES;
  /** the water at the probe, in degrees: null is the probe unplugged, and Tasmota has no reading of it */
  water: number | null;
  /** the relay's contact, which feeds the heater: where the last pulse of a coil left it, whatever Tasmota believes */
  contact: boolean;
  /** every pulse of a coil, with when and to where: the first of a boot is the image's own */
  readonly pulses: { at: number; on: boolean }[] = [];
  /** Tasmota's temperature offset (TempOffset), in degrees, added to the probe's reading */
  tempOffset: number;
  /** the LEDs' pins, as they are written: 1 off, 0 on; the first is the red, the second the green */
  readonly leds = [1, 1];
  /** every level written to the green LED, with when: a blink is a run of them */
  readonly ledLog: { at: number; level: number }[] = [];
  /** the button's pin: 1 up, 0 pressed */
  button = 1;

  private constructor(vm: Berry, opts: ApplianceOptions) {
    // Tasmota takes the relay for open at every boot: it keeps no state for a restart (SetOption0 0)
    super(vm, { ...opts, relays: [false] }, { mac: "A0:B7:65:88:00:01", ip: "192.168.0.71", relays: 1 });
    this.hostname = opts.hostname ?? "thr320d-boiler";
    this.water = opts.water === undefined ? 50 : opts.water;
    this.contact = opts.contact ?? false;
    this.tempOffset = opts.tempOffset ?? 0;
  }

  static async create(opts: ApplianceOptions): Promise<SimAppliance> {
    return SimDevice.boot(opts, (vm) => new SimAppliance(vm, opts));
  }

  /** the image's rule, ON System#Init DO Power1 0 ENDON: the off coil pulsed at every boot, with Berry running or not */
  protected init() {
    this.later("", INIT_RULE_MS, () => this.power(1, 0));
  }

  /** an appliance's relay switches its own load: it is no circuit of the room, and feeds no lamp */
  get feedsRoom(): boolean {
    return false;
  }

  /** the heater has power: the contact is closed */
  get heating(): boolean {
    return this.contact;
  }

  /** A Power command pulses a coil, a change of what Tasmota believes or not: the contact goes where the pulse puts it. */
  power(device: number, state: number) {
    super.power(device, state);
    if (device !== 1) return;
    this.contact = this.relays[0];
    this.pulses.push({ at: this.now, on: this.contact });
    // the red LED is Tasmota's, and follows the relay
    this.leds[0] = this.relays[0] ? 0 : 1;
  }

  /**
   * The button held 5 s, as the rules get it once the hold time passed: pressed until then, and let go `heldOn` ms after the hold, a moment
   * by default, as a hand lets go when the LED blinks. Held on to 20 s in all (heldOn 15 000 or more), the node leaves the house
   */
  holdButton(heldOn = 300) {
    this.button = 0;
    this.rule(JSON.stringify({ Button1: { State: 3 } }));
    this.later("", heldOn, () => { this.button = 1; });
  }

  /** a short press: with the button detached from the relay it reaches the rules as a single press, and Tasmota toggles nothing */
  pressButton() {
    this.rule(JSON.stringify({ Button1: { State: 10 } }));
  }

  /** the green LED blinked within the last `ms`: two levels written or more */
  blinking(ms = 1000): boolean {
    return this.ledLog.filter((l) => l.at > this.now - ms).length >= 2;
  }

  /** its image has no Zigbee2Tasmota */
  protected z2t(): boolean {
    return false;
  }

  /** TempOffset, Tasmota's own: the degrees added to every temperature it reads */
  protected ownCommand(lower: string, _index: number, _usridx: boolean, _payload: number, data: string): string | null {
    if (lower !== "tempoffset") return null;
    const n = Number(data);
    if (data !== "" && Number.isFinite(n) && n >= -12.6 && n <= 12.6) this.tempOffset = n;
    return JSON.stringify({ TempOffset: this.tempOffset });
  }

  protected ownHost(op: string, arg: string | null): string | null | undefined {
    switch (op) {
      case "gpio_pin": {
        const [kind, index] = arg!.split(",").map(Number);
        if (kind === LED1) return String(LED_PINS[index] ?? -1);
        return String(kind === KEY1 && index === 0 ? BUTTON_PIN : -1);
      }
      case "gpio_read": {
        const led = LED_PINS.indexOf(Number(arg));
        return String(led >= 0 ? this.leds[led] : Number(arg) === BUTTON_PIN ? this.button : 0);
      }
      case "gpio_write": {
        const [pin, level] = arg!.split(",").map(Number);
        const led = LED_PINS.indexOf(pin);
        if (led >= 0) this.leds[led] = level ? 1 : 0;
        if (led === 1) this.ledLog.push({ at: this.now, level: this.leds[1] });
        return null;
      }
      // Tasmota's sensors: the probe's temperature, to a tenth, while it is plugged
      case "sensors":
        return JSON.stringify(this.water === null ? {} : { WTS01: { Temperature: Math.round((this.water + this.tempOffset) * 10) / 10 }, TempUnit: "C" });
    }
    return undefined;
  }

  /** what a boot of this appliance finds, beside what every device keeps: the contact where it is, the water, the offset */
  private carried(): Pick<ApplianceOptions, "hostname" | "water" | "contact" | "tempOffset"> {
    return { hostname: this.hostname, water: this.water, contact: this.contact, tempOffset: this.tempOffset };
  }

  /** A restart as Tasmota makes it: a new appliance from what this one kept, its relay's contact where it was. */
  async reboot(opts: ApplianceOptions): Promise<SimAppliance> {
    this.leave();
    return SimAppliance.create({ ...opts, ...this.kept(), ...this.carried() });
  }
}
