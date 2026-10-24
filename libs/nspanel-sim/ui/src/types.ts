// Data contracts for the three migrated screens — the same fields
// berry/brain.be, berry/home.be and berry/light.be already use today
// here, translated to TS. Not invented: every field has a
// direct origin in the real code, cited in a comment.

/** brain.be: one weatherUpdate item (a forecast or the current condition). */
export interface WeatherItem {
  label: string; // weekday, or empty for the current condition
  tempC: number | null;
  /** null = empty slot ("~delete~~~~~" in the original protocol) */
}

/** brain.be: render_screensaver() + update_clock() */
export interface ScreensaverData {
  time: string; // "HH:MM"
  date: string; // "DD/MM/YYYY"
  weather: WeatherItem[]; // 5 slots (brain.be always sends 5)
  statusIcons: [StatusIcon | null, StatusIcon | null]; // statusUpdate~icon1~color1~icon2~color2
}

export interface StatusIcon {
  glyph: string; // icon-font codepoint (e.g. lightbulb, U+E334)
  colorHex: string;
}

/** light.be: self.devices[id] — the exact shape kept in memory/persist. */
export interface LightDevice {
  id: string;
  name: string;
  power: 0 | 1;
  bri: number; // 0-254 (Dimmer ZCL)
  hue: number; // 0-254
  sat: number; // 0-254
  ct: number; // mireds, within the device's [ctMin, ctMax]
}

/** home.be: render()/send_content() — the cardGrid page */
export interface HomeScreenData {
  title: string; // Home.TITLE = "Home"
  lights: LightDevice[]; // home.be iterates light.devices.keys()
}

/** light.be: send_detail() — the bulb's settings page */
export interface LightDetailData {
  device: LightDevice;
  ctMin: number; // light.be CT_MIN (empirical, per bulb model)
  ctMax: number; // light.be CT_MAX
  briMinPct: number; // light.be BRI_MIN_PCT (5) — the bar never lets it go fully dark
  briMaxPct: number; // light.be BRI_MAX_PCT (95)
  /**
   * WITHOUT a real contract in light.be: the "auto" mode exists only in the UI
   * definition, not in the backend. undefined/false = manual.
   */
  briAuto?: boolean;
  ctAuto?: boolean;
  /**
   * Likewise — colour and colour temperature are mutually exclusive in
   * the UI: "color" means the colour bar was
   * adjusted last (temperature is dimmed); "ct"/undefined means
   * temperature is active by default (the colour bar starts dimmed).
   * No real contract in light.be, the same as briAuto/ctAuto.
   */
  colorMode?: "ct" | "color";
}

/**
 * Panel-wide settings — device level, not per light. The Nextion's Touch Move
 * Event does not send a Component ID by default (1024 B serial buffer —
 * see registry.ts:GradientSlider), so "update in real time while
 * dragging" may not even be viable without extra engineering on the real
 * hardware. "Only on release" tends to be the more realistic mode on the
 * physical panel.
 */
export interface SettingsData {
  /** false (the default) = the light only changes when the finger releases
   * the slider (Slider.onChangeCommitted). true = it changes on every step of
   * the drag in the LightDetail sliders, opt-in. */
  liveSliderUpdate: boolean;
  /**
   * Which keyboard a rename opens on: `"t9"` for the twelve-key pad,
   * `"qwerty"` for the full one, and `undefined` for "whatever the layout
   * ships". Undefined is the honest default — this side has no opinion until
   * somebody flips the switch, and the layout's own `editor` is the answer
   * until then (`brain.be:keyboard_page_for`).
   */
  keyboardKind?: "qwerty" | "t9";
}
