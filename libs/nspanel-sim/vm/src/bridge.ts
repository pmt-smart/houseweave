// The ZBBridge Pro, simulated: the ESP32 with Tasmota and the relay's Berry on
// it (device.ts). Its image carries the relay's seven classes,
// which its autoexec.be starts (berry/zbbridge_autoexec.be), and it has the
// Zigbee coordinator, whose lamps the relay reports to the panel it paired with.
//
// Its button, held 5 s, reaches the rules as Tasmota's button handling has it
// with SetOption32 50 and ButtonTopic 0: {"Button1":{"State":3}}, and its pin reads
// 0 while it is pressed (Button1, with a pull-up). Its LED is LED1, on GPIO17 and
// inverted, as its template has it: 1 is off.
import type { Berry } from "./berry.js";
import { SimDevice, type DeviceOptions } from "./device.js";

/** The relay, as the bridge's env compiles it (firmware/overrides/platformio_override.ini), in the order zbbridge_autoexec.be names them. */
export const BRIDGE_FILES = ["panel_build.be", "pair_sign.be", "clock_link.be", "zbbridge_relay_pairing.be", "zbbridge_discovery.be", "zbbridge_drivers.be", "zbdriver_thermostat.be", "zbdriver_cover.be", "zbdriver_twokey.be", "mesh_beat.be", "mesh_events.be", "zbbridge_alarm_merge.be", "zbbridge_alarm_mesh.be", "zbbridge_alarm.be", "mesh_cmd.be", "house_list.be", "house_key.be", "house_state.be", "house_devices.be", "house_link.be", "house_channel.be", "house_mesh.be", "house_commands.be", "house_mqtt.be", "house_alarm.be", "panel_wifi.be", "panel_http.be", "node_ota.be", "node_wireless.be", "server_link.be", "mesh_http.be", "node_settings.be", "node_backup.be", "bridge_backup.be", "zbbridge_relay.be"] as const;

/** GPIO_LED1, the function gpio.pin() looks up, and the pin the bridge's template gives it */
const LED1 = 288;
const LED_PIN = 17;
/** GPIO_KEY1, the button's function, and the pin the bridge's template gives it (Button1, the 24th of its GPIO list: GPIO25) */
const KEY1 = 32;
const BUTTON_PIN = 25;

export interface BridgeOptions extends DeviceOptions {
  /** its name, which the pairing announces and the panel shows: "zbbridge-living" when not said */
  hostname?: string;
}

export class SimBridge extends SimDevice {
  readonly hostname: string;
  protected readonly brainFiles = BRIDGE_FILES;
  /** the LED's pin, as the relay writes it: 1 off, 0 on */
  led = 1;
  /** every level written to the LED, with when: a blink is a run of them */
  readonly ledLog: { at: number; level: number }[] = [];
  /** the button's pin: 1 up, 0 pressed */
  button = 1;

  private constructor(vm: Berry, opts: BridgeOptions) {
    super(vm, opts, { mac: "A0:B7:65:77:00:01", ip: "192.168.0.61", relays: 0 });
    this.hostname = opts.hostname ?? "zbbridge-living";
  }

  static async create(opts: BridgeOptions): Promise<SimBridge> {
    return SimDevice.boot(opts, (vm) => new SimBridge(vm, opts));
  }

  /**
   * The button held 5 s, as the rules get it once the hold time passed: pressed until then, and let go `heldOn` ms after the hold, a moment
   * by default, as a hand lets go when the LED blinks. Held on to 20 s in all (heldOn 15 000 or more), the bridge leaves the house
   */
  holdButton(heldOn = 300) {
    this.button = 0;
    this.rule(JSON.stringify({ Button1: { State: 3 } }));
    this.later("", heldOn, () => { this.button = 1; });
  }

  /** the LED blinked within the last `ms`: two levels written or more */
  blinking(ms = 1000): boolean {
    return this.ledLog.filter((l) => l.at > this.now - ms).length >= 2;
  }

  protected ownHost(op: string, arg: string | null): string | null | undefined {
    switch (op) {
      case "gpio_pin": {
        const [kind, index] = arg!.split(",").map(Number);
        if (index !== 0) return "-1";
        return String(kind === LED1 ? LED_PIN : kind === KEY1 ? BUTTON_PIN : -1);
      }
      case "gpio_read": return String(Number(arg) === LED_PIN ? this.led : Number(arg) === BUTTON_PIN ? this.button : 0);
      case "gpio_write": {
        const [pin, level] = arg!.split(",").map(Number);
        if (pin === LED_PIN) {
          this.led = level ? 1 : 0;
          this.ledLog.push({ at: this.now, level: this.led });
        }
        return null;
      }
    }
    return undefined;
  }

  /** A restart as Tasmota makes it: a new bridge from what this one kept, with its lamps on its network as they are. */
  async reboot(opts: BridgeOptions): Promise<SimBridge> {
    this.leave();
    const bridge = await SimBridge.create({ hostname: this.hostname, ...opts, ...this.kept() });
    bridge.zigbee.carry(this.zigbee);
    return bridge;
  }
}
