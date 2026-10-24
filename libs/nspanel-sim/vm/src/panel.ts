// The panel, simulated: the ESP32 with Tasmota and the panel's Berry on it
// (device.ts), with what the panel has besides: the Nextion's UART, the two
// relays and their buttons, scanned every 50 ms and given to the panel's button
// driver compiled from the firmware's own source (native/tasmota_core.cpp), and
// the buzzer.
//
// The Berry is the panel's own (the brain, berry/*.be; autoexec.be and the
// generated tables of the project on its file system). Alone, the panel is on
// the house's network by itself, with nobody else on it; in a house (house.ts)
// it meets the bridge over the air and over the network. Its image has no
// Zigbee2Tasmota: its Zigbee is the bridge's.
import type { Berry } from "./berry.js";
import { fromHex, toHex } from "./sha256.js";
import { SimDevice, type DeviceFiles, type DeviceOptions } from "./device.js";

/**
 * The brain: the files of berry/ the panel runs, which the firmware build
 * compiles into the flash, each declaring one class. The
 * simulator loads them as files, where the firmware has them compiled in, before
 * anything else of the panel runs: in the order a file comes after the ones it
 * names, the boot last.
 */
export const BRAIN_FILES = [
  "panel_build.be", "tft_pack.be", "nextion_driver.be", "pair_sign.be", "panel_rules.be", "zigbee_bridge.be", "zigbee_pairing.be", "light.be", "home.be", "brain.be", "panel_runtime.be",
  "panel_text.be", "panel_plan.be", "panel_store.be", "panel_draw.be", "panel_plan_view.be", "panel_plan_commands.be",
  "clock_link.be", "panel_clock.be", "panel_thermostat_settings.be", "panel_thermostat_view.be", "panel_cover_view.be", "panel_page_buttons.be", "node_ota.be", "node_wireless.be", "panel_ui.be", "panel_tap_view.be", "panel_add_view.be", "panel_driver_view.be", "panel_schedule.be", "panel_calendar_draw.be", "panel_schedule_view.be", "panel_zigbee.be", "panel_thermostat.be", "panel_cover.be", "panel_lamp_settings.be", "panel_alarm.be", "panel_alarm_draw.be", "panel_alarm_canvas.be", "panel_alarm_view.be", "panel_names.be", "panel_wifi.be", "panel_mqtt.be", "panel_http.be", "server_link.be", "mesh_http.be", "node_settings.be", "node_backup.be", "panel_backup.be", "panel_schedule_mqtt.be", "panel_web.be", "panel_route.be", "mesh_events.be", "mesh_cmd.be", "panel_gate.be", "mesh_beat.be", "house_list.be", "house_key.be", "house_state.be", "house_devices.be", "house_link.be", "house_channel.be", "house_mesh.be", "house_commands.be", "house_mqtt.be", "house_alarm.be", "house_server.be", "panel_remote_view.be", "panel_house_view.be",
  "panel_boot.be",
] as const;

export type PanelFiles = DeviceFiles;

export interface PanelOptions extends DeviceOptions {
  /** the generated project autoexec.be names (PANEL_PROJECT), e.g. "p1-living-room-eu-landscape" */
  project?: string;
  /** bytes the panel wrote to the Nextion */
  onUart?: (bytes: Uint8Array) => void;
  onBeep?: (count: number) => void;
}

export class SimPanel extends SimDevice {
  readonly hostname = "nspanel-sim";
  protected readonly brainFiles = BRAIN_FILES;
  buttons = [false, false];
  private rx: number[] = [];
  private pressed: boolean[] = [];
  private readonly panelOpts: PanelOptions;

  private constructor(vm: Berry, panelOpts: PanelOptions) {
    super(vm, panelOpts, { mac: "A0:B7:65:00:00:01", ip: "192.168.0.60", relays: 2 });
    this.panelOpts = panelOpts;
  }

  static async create(opts: PanelOptions): Promise<SimPanel> {
    return SimDevice.boot(opts, (vm) => new SimPanel(vm, opts));
  }

  /** the one line the owner edits on the device: which project this panel runs */
  protected flashFile(name: string, src: string): string {
    const project = this.panelOpts.project;
    return name === "autoexec.be" && project ? src.replace(/^var PANEL_PROJECT = nil\b/m, `var PANEL_PROJECT = "${project}"`) : src;
  }

  /** the drivers' FUNC_PRE_INIT: the button driver reads its NVS back */
  protected init() {
    this.vm.buttonsInit(this.relays.length);
  }

  // --- buttons ------------------------------------------------------------------------------------

  /** A physical button, pressed or let go: the driver sees it at its next scan. */
  pressButton(n: number, down: boolean) {
    this.buttons[n - 1] = down;
  }

  /** the scan of support_button.ino: the panel's driver takes the button, or Tasmota's generic handling does */
  protected every50() {
    this.buttons.forEach((down, i) => {
      if (this.vm.buttonScan(i, down)) return;
      // the generic handling, as SetOption13 1 has it: the relay toggles as the button goes down
      const was = this.pressed[i] ?? false;
      this.pressed[i] = down;
      if (down && !was) this.power(i + 1, 2);
    });
  }

  protected beep(count: number) {
    this.panelOpts.onBeep?.(count);
  }

  protected ownCommand(lower: string, _index: number, _usridx: boolean, payload: number): string | null {
    if (lower === "buzzer") {
      this.beep(payload > 0 ? payload : 1);
      return JSON.stringify({ Buzzer: "Done" });
    }
    return null;
  }

  protected driverCommand(name: string, index: number, usridx: boolean, payload: number, data: string): string | null {
    return this.vm.buttonCommand(name, index, usridx, payload, data);
  }

  // --- the Nextion's UART ------------------------------------------------------------------------

  /** bytes the glass sent: the panel reads them at its driver's next poll */
  uartReceive(bytes: Uint8Array) {
    for (const b of bytes) this.rx.push(b);
  }

  protected ownHost(op: string, arg: string | null): string | null | undefined {
    switch (op) {
      case "uart_open": return null;
      case "uart_write": this.panelOpts.onUart?.(fromHex(arg!)); return null;
      case "uart_available": return String(this.rx.length);
      case "uart_read": {
        if (this.rx.length === 0) return null;
        const bytes = Uint8Array.from(this.rx);
        this.rx = [];
        return toHex(bytes);
      }
    }
    return undefined;
  }

  /** The panel's image has no Zigbee2Tasmota: its Zigbee is the bridge's. */
  protected z2t(): boolean {
    return false;
  }

  /** A restart as Tasmota makes it: a new panel from what this one kept. */
  async reboot(opts: PanelOptions): Promise<SimPanel> {
    this.leave();
    return SimPanel.create({ ...opts, ...this.kept() });
  }
}
