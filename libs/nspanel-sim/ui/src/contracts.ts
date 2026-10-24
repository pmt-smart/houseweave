// The contract each component id honours, whoever implements it.
//
// This is what makes a project able to mix components from different design
// systems: `light-card` means the same thing in all of them -- same props, same
// events, same hardware obligations -- and only the drawing differs. A design
// system that wanted different PROPS would be declaring a different component,
// with its own id, and the projects using it would know.
//
// The split is the one Radix and shadcn use, and it is not cosmetic here:
//
//   behaviour  lives in `headless/`, shared by every theme, because it
//              encodes what the PANEL does. The light card's short-tap /
//              long-press pair is Touch Press plus Touch Release on the Nextion
//              component, and a theme that reimplemented it
//              and forgot the second event would ship a card whose detail screen
//              is unreachable on the glass. That is not a look, and it is not
//              theirs to vary.
//   presentation  lives in `themes/<id>/`, and is entirely theirs.
//
// Geometry is a third thing again and belongs to neither: a project places a
// component in a box, and the component draws inside it.
import type { RampId } from "@nspanel-sim/layout";
import type { LightDevice, WeatherItem } from "./types";

// The ids themselves moved to `@nspanel-sim/layout`: the compile step keys off
// them too and cannot import React. What stays here is what only a React caller
// needs -- props with handlers in them.
export { COMPONENT_IDS, type ComponentId } from "@nspanel-sim/layout";

/** A QR code: the text a phone's camera reads, which the glass encodes and draws. */
export interface QrCodeProps {
  code?: string;
  /** the most bytes the page writes into it, its `txt_maxl` */
  capacity?: number;
}

export interface LabelProps {
  text: string;
  /** what the words are FOR, which is what a theme styles */
  tone?: "title" | "body" | "muted";
  align?: "left" | "center" | "right";
}

export interface ClockProps {
  time: string;
  date: string;
}

export interface WeatherRowProps {
  items: WeatherItem[];
}

export interface StatusIconViewProps {
  /**
   * Which drawing. Compile time, because the glyph is baked into the
   * component's `txt` -- the panel's `statusUpdate` sends an icon NAME too and
   * `txt` is writable, so this can become a binding once somebody decides how an
   * icon name crosses the wire.
   */
  role?: "lightOn" | "lightOff" | "power" | "brightness" | "colorTemp" | "alarmSignal" | "noticeSignal";
  /**
   * The colour, as a THEME TOKEN and not a hex.
   *
   * The panel sends one (`statusUpdate~icon1~color1~icon2~color2`) and the
   * firmware sends `ICON_OFF_COLOR` or `ICON_LOW_SAT_COLOR` -- which are tokens,
   * not arbitrary colours. Keeping it a token is what lets the same binding feed
   * a `pco` on the glass and the palette in the browser; a hex would have
   * resolved in neither.
   */
  color?: string;
  /**
   * Which of the panel's two fixed slots this is. It decides what the compiled
   * page binds to, not where it sits -- that is the placement's.
   */
  side: "left" | "right";
}

export interface NavHeaderProps {
  title: string;
  /** an X that leaves this screen, back to wherever the finger came from */
  onClose?: () => void;
  /** undefined means there is no previous card — home.be:NO_NAV */
  onPrev?: () => void;
  onNext?: () => void;
  /**
   * A long press on the title, which is how a screen gets renamed.
   *
   * Absent means the title is not editable, and then it is not a target at all
   * -- no hotspot on the glass, no gesture in the browser.
   */
  onEditTitle?: () => void;
  /**
   * The view's own action, at the far right: the + on a plan,
   * the check on a dashed card. Absent means the header has no action slot.
   */
  onAction?: () => void;
  /** which icon the action shows, by role; one the theme has not got draws nothing */
  actionIcon?: string;
  /** the action's colour, a theme colour the runtime picks; absent, the text's */
  actionIconColor?: string;
  /** a long press on the action; absent, it has the tap only */
  onActionHold?: () => void;
  /** the view's options, the ⋯; absent means the header has none */
  onMore?: () => void;
  /**
   * The header's sign, by role, left of the action: the Home's hotspot while the
   * panel is open to a phone. Present -- even as "" -- when the
   * placement binds it, and then its column is taken whether it shows or not.
   */
  statusIcon?: string;
}

export interface PageRailProps {
  /** the page of the list that is showing, 0-based */
  page: number;
  /** how many pages the list has. One draws nothing at all. */
  pageCount: number;
  /** the finger let go on page `page` (0-based) */
  onChange?: (page: number) => void;
}

export interface ListRowProps {
  /** the icon's role at the left; absent gives the label the room, "" is a blank */
  icon?: string;
  /** the icon's colour, a theme token; absent is the theme's plain icon colour */
  iconColor?: string;
  label: string;
  /** which colour the label draws in: lit or not, and 2 for a row that destroys */
  on?: boolean | 2;
  /** the grey text at the right */
  hint?: string;
  /** the discreet text at the far right, with a touch of its own */
  tail?: string;
  /** the short tap, on the row and on the tail */
  onChange?: () => void;
  /** the long press on the row */
  onHold?: () => void;
  /** the long press on the tail */
  onTailHold?: () => void;
  /** the `device` variant's icon: its short tap */
  onIconTap?: () => void;
  /** the `device` variant's icon: its long press */
  onIconHold?: () => void;
}

export interface ZoneCounterProps {
  /** the number, or "" for a counter the zone has no kind for */
  count: string;
  /** the kind's icon role, or "" */
  icon: string;
  iconColor?: string;
  onTap?: () => void;
  onHold?: () => void;
}

/** The lock's nine dots. */
export interface PatternPadProps {
  /** 1: every dot in the wrong colour, until the page loads again */
  wrong?: number;
  /** the release: the dots the finger joined, one digit each, in order */
  onTry?: (drawn: number) => void;
}

export interface LightCardProps {
  light: LightDevice;
  /** btype "button" in light.be:handle_event */
  onToggle: (id: string) => void;
  /** pageOpenDetail in light.be:handle_event */
  onOpenDetail: (id: string) => void;
}

export interface ToggleSwitchProps {
  on: boolean;
  /** light.be:set_power, btype "OnOff" */
  onChange: (on: boolean) => void;
}

export interface KeyboardProps {
  /** what the slot says now, which is what the keyboard opens on */
  value: string;
  /** how many characters the slot holds -- the `txt_maxl` of its Text */
  max: number;
  /**
   * Every keystroke, when the caller wants to own the line.
   *
   * With it the component is CONTROLLED and `value` is the truth; without it
   * the line is local. The simulator passes it because the same screen is drawn
   * twice side by side, and two copies of a half-typed name is exactly the
   * disagreement those two columns exist to rule out.
   */
  onChange?: (value: string) => void;
  /**
   * CAPS, when the caller owns it. On the panel it is one Variable on the page
   * (`kbCaps`) that every key reads, so it is one piece of state there too --
   * and in the browser the same screen is drawn three times (the rasterised
   * source, the touch overlay over it, and the React column), which is three
   * chances to disagree about which case the keyboard is in.
   */
  caps?: boolean;
  onCapsChange?: (caps: boolean) => void;
  /** OK, with the typed name already trimmed and never blank */
  onCommit?: (value: string) => void;
  /** the X: nothing changes */
  onCancel?: () => void;
  /**
   * A key that goes to another keyboard: the letters, the keypad or the
   * symbols, by which one it names.
   *
   * On the glass it is a `page` jump the panel takes by itself; here it is a
   * callback, because the simulator has no pages to jump to -- it re-renders.
   */
  onSwitchTo?: (to: "letters" | "keypad" | "symbols") => void;
  /**
   * The other keyboards this page has a way to, as the project binds them: the keys that switch are drawn for these, and a
   * layout with no QWERTY (the US portrait) has no ABC on its keypad, but #+=.
   */
  ways?: readonly ("letters" | "keypad" | "symbols")[];
}

export interface GradientSliderProps {
  /** 0..100 */
  pct: number;
  /**
   * Which ramp, by NAME.
   *
   * Not a CSS `linear-gradient(...)` string, which only the browser reads: a
   * gradient reaches the panel as a generated PICTURE, and no compiler can turn a
   * CSS string into one. Named, both sides resolve it -- `cssGradient(RAMPS[ramp])` in the
   * browser, `rampPixels` in the `.HMI`.
   */
  ramp: RampId;
  /** every step of the drag */
  onChange: (pct: number) => void;
  /**
   * The end of the drag. The panel reports a Touch Move without a Component ID
   * by default (1024-byte serial buffer), so on the glass this is
   * the only event that reliably carries a value — which is why it is a separate
   * prop and not an afterthought.
   */
  onChangeCommitted?: (pct: number) => void;
  /** visual only: the colour/temperature mutual exclusion */
  dimmed?: boolean;
  height?: number;
}
