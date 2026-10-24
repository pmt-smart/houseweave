// Icons, from the theme's own icon font.
//
// A theme ships a subsetted `.zi` of its icons, and `textRaster.ts` draws a glyph
// from it with geometry measured on the Editor's debugger. So the simulator draws the ACTUAL glyph the panel
// will draw, and two themes can disagree about what a lit bulb looks
// like -- which is most of what makes them different themes.
//
// Roles, never icon names. A screen asks for "the drawing that means the light
// is on"; which drawing that is belongs to the theme, and the three in
// this repository answer differently: the joBr99 one uses one filled bulb for
// both states and changes only the colour (which is what the firmware does), the
// shadcn one uses two different stroked drawings, the Tailwind one two filled.
//
// Without a provider this falls back to the Material icons, so `ui/` on its own
// still renders and nothing that does not know about themes breaks.
import { createContext, useContext, type ReactNode } from "react";
import type { ZiFont } from "@nspanel-sim/export";
import MuiLightbulb from "@mui/icons-material/Lightbulb";
import ArrowBackIosNewIcon from "@mui/icons-material/ArrowBackIosNew";
import ArrowForwardIosIcon from "@mui/icons-material/ArrowForwardIos";
import PaletteIcon from "@mui/icons-material/Palette";
import Brightness6Icon from "@mui/icons-material/Brightness6";
import DeviceThermostatIcon from "@mui/icons-material/DeviceThermostat";
import PowerSettingsNewIcon from "@mui/icons-material/PowerSettingsNew";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import RefreshIcon from "@mui/icons-material/Refresh";
import CircleIcon from "@mui/icons-material/Circle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import WifiTetheringIcon from "@mui/icons-material/WifiTethering";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import PriorityHighIcon from "@mui/icons-material/PriorityHigh";
import SettingsIcon from "@mui/icons-material/Settings";
import ScheduleIcon from "@mui/icons-material/Schedule";
import SecurityIcon from "@mui/icons-material/Security";
import NotificationsIcon from "@mui/icons-material/Notifications";
import StopIcon from "@mui/icons-material/Stop";
import { ZiGlyphView } from "./compiled/ziText";

/** The roles the screens ask for. Mirrors core's REQUIRED_ICON_ROLES. */
export type IconRole =
  | "navPrev" | "navNext"
  | "lightOn" | "lightOff"
  | "colorMode" | "brightness" | "colorTemp" | "power"
  | "lightNoAnswer" | "lightNoPower" | "add" | "confirm"
  | "more" | "refresh" | "dotOff" | "dotOn"
  | "plugOn" | "plugOff" | "switchOn" | "switchOff" | "fanOn" | "fanOff" | "coverOn" | "coverOff"
  | "sensor" | "remote" | "hotspot" | "cancel" | "alarmSignal" | "noticeSignal"
  | "plugNoAnswer" | "plugNoPower" | "switchNoAnswer" | "switchNoPower"
  | "fanNoAnswer" | "fanNoPower" | "coverNoAnswer" | "coverNoPower"
  | "windowOn" | "windowOff" | "windowNoAnswer" | "windowNoPower" | "gateOn" | "gateOff" | "gateNoAnswer" | "gateNoPower"
  | "thermostatOn" | "thermostatOff" | "thermostatNoAnswer" | "thermostatNoPower" | "minus"
  | "coverUp" | "coverStop" | "coverDown"
  | "identify" | "settings" | "schedule";

export interface PanelIconSet {
  /**
   * The theme's icon fonts, once loaded, at whatever heights it carries.
   *
   * More than one because **icon size is a font choice, not a scale**. A Nextion
   * Text names a font id and draws its glyphs at that font's height; there is no
   * scale attribute. Blowing a 32-pixel glyph up to 73 in the simulator would
   * draw a picture of something the panel
   * cannot do, and it would look exactly as ragged as it is.
   */
  fonts: ZiFont[];
  /** role -> codepoint; the same at every size */
  codes: Partial<Record<IconRole, number>>;
  /** role -> Material Design Icons name, for tooltips and for saying what is missing */
  names: Partial<Record<IconRole, string>>;
  /**
   * role -> the icon's SVG path: the same drawing the `.zi` carries as a glyph.
   *
   * Generated next to the fonts rather than pulled from a package at runtime.
   * The whole Material Design Icons set is some seven thousand paths, and a name
   * resolved at runtime cannot be shaken out of a bundle, so only the icons a
   * theme actually names are carried.
   */
  paths: Partial<Record<IconRole, string>>;
}

const EMPTY: PanelIconSet = { fonts: [], codes: {}, names: {}, paths: {} };
const IconsContext = createContext<PanelIconSet>(EMPTY);

export function PanelIconsProvider({ icons, children }: { icons?: PanelIconSet; children: ReactNode }) {
  return <IconsContext.Provider value={icons ?? EMPTY}>{children}</IconsContext.Provider>;
}

export function usePanelIcons(): PanelIconSet {
  return useContext(IconsContext);
}

/** What each role falls back to when no theme has supplied a glyph. */
const FALLBACK: Record<IconRole, typeof MuiLightbulb> = {
  navPrev: ArrowBackIosNewIcon,
  navNext: ArrowForwardIosIcon,
  lightOn: MuiLightbulb,
  lightOff: MuiLightbulb,
  colorMode: PaletteIcon,
  brightness: Brightness6Icon,
  colorTemp: DeviceThermostatIcon,
  power: PowerSettingsNewIcon,
  lightNoAnswer: MuiLightbulb,
  lightNoPower: MuiLightbulb,
  add: AddIcon,
  confirm: CheckIcon,
  more: MoreHorizIcon,
  refresh: RefreshIcon,
  dotOff: RadioButtonUncheckedIcon,
  dotOn: CircleIcon,
  // the kinds that are not lights: the power glyph is the fallback, and the
  // theme's own font draws the real one
  plugOn: PowerSettingsNewIcon,
  plugOff: PowerSettingsNewIcon,
  switchOn: PowerSettingsNewIcon,
  switchOff: PowerSettingsNewIcon,
  fanOn: PowerSettingsNewIcon,
  fanOff: PowerSettingsNewIcon,
  coverOn: PowerSettingsNewIcon,
  coverOff: PowerSettingsNewIcon,
  sensor: PowerSettingsNewIcon,
  remote: PowerSettingsNewIcon,
  hotspot: WifiTetheringIcon,
  cancel: CloseIcon,
  // drawn by the font generator from the plain ones: the theme's
  // font is their only drawing, and the fallback is the power glyph's
  plugNoAnswer: PowerSettingsNewIcon,
  plugNoPower: PowerSettingsNewIcon,
  switchNoAnswer: PowerSettingsNewIcon,
  switchNoPower: PowerSettingsNewIcon,
  fanNoAnswer: PowerSettingsNewIcon,
  fanNoPower: PowerSettingsNewIcon,
  coverNoAnswer: PowerSettingsNewIcon,
  coverNoPower: PowerSettingsNewIcon,
  // a window and a gate: the theme's font draws them, and the power glyph is the fallback
  windowOn: PowerSettingsNewIcon,
  windowOff: PowerSettingsNewIcon,
  windowNoAnswer: PowerSettingsNewIcon,
  windowNoPower: PowerSettingsNewIcon,
  gateOn: PowerSettingsNewIcon,
  gateOff: PowerSettingsNewIcon,
  gateNoAnswer: PowerSettingsNewIcon,
  gateNoPower: PowerSettingsNewIcon,
  // the thermostat's four appearances are one glyph, the heating coil, which the theme's font draws
  thermostatOn: DeviceThermostatIcon,
  thermostatOff: DeviceThermostatIcon,
  thermostatNoAnswer: DeviceThermostatIcon,
  thermostatNoPower: DeviceThermostatIcon,
  minus: RemoveIcon,
  // a blind's page: its switch's three keys
  coverUp: ArrowUpwardIcon,
  coverStop: StopIcon,
  coverDown: ArrowDownwardIcon,
  // the row under a page's title: Identify an exclamation, Settings, and the schedule's
  identify: PriorityHighIcon,
  settings: SettingsIcon,
  schedule: ScheduleIcon,
  // the screensaver's two signs: the alarm's, a shield, and the house's notifications, a bell
  alarmSignal: SecurityIcon,
  noticeSignal: NotificationsIcon,
};

export interface PanelIconProps {
  role: IconRole;
  /**
   * How much room the icon has, in panel pixels. A BUDGET, not a size: the
   * largest icon font that fits it is used, at its own height. If none fits, the
   * smallest one is drawn at its height and overflows, because shrinking it
   * would be drawing something the panel cannot draw.
   */
  size?: number;
  color?: string;
}

/** The largest font that fits the budget; the smallest if none does. */
export function pickIconFont(fonts: readonly ZiFont[], budget: number): ZiFont | undefined {
  if (fonts.length === 0) return undefined;
  const sorted = [...fonts].sort((a, b) => a.height - b.height);
  let best = sorted[0];
  for (const f of sorted) if (f.height <= budget) best = f;
  return best;
}

/**
 * The cell the panel will give an icon: the glyph's advance by the font's height.
 *
 * NOT a square, and assuming it was is what made the React tree draw something
 * the panel cannot produce. Measured on the themes' own icon fonts: at
 * 48 pixels tall every icon glyph is 43 wide, and its ink stops well short of
 * the cell on all four sides -- so the artwork is rendered at the font's height
 * and the cell is trimmed around it, never clipped. Drawing 48x48 instead of
 * 43x48 is a tenth of an icon of made-up width each time, and across a row it
 * pushes real content off the edge.
 *
 * Falls back to a square when no font is loaded, which is the only honest answer
 * before the `.zi` has arrived.
 */
export function iconCell(
  font: ZiFont | undefined,
  code: number | undefined,
  fallback: number,
): { w: number; h: number } {
  const glyph = font && code !== undefined ? font.glyphs.find((g) => g.code === code) : undefined;
  if (font === undefined || glyph === undefined) return { w: fallback, h: fallback };
  return { w: glyph.advance, h: font.height };
}

/**
 * One icon, as a vector, everywhere.
 *
 * The drawing is the theme's own choice of Material Design Icon, and the glyph
 * the panel carries is the same icon, cut into the theme's `.zi`: the React
 * screens and the compiled pages draw one icon two ways, not two icons. The
 * same tree is what is read to emit the `.HMI`, and a preview that rendered
 * something else would be previewing something else. The Panel tab's Real
 * column is the emulated glass, drawing the `.zi` glyphs the compiled pages name.
 */
export function PanelIcon({ role, size = 24, color = "currentColor" }: PanelIconProps) {
  const icons = usePanelIcons();
  const path = icons.paths[role];
  // The box the panel will give it, not a square of our choosing -- see
  // `iconCell`. `slice` because the cell is narrower than it is tall and the
  // artwork is scaled by HEIGHT: exactly what the glyph generator did, and the
  // margins Material Design Icons leave mean nothing of the drawing is lost.
  const font = pickIconFont(icons.fonts, size);
  const code = icons.codes[role];
  const cell = iconCell(font, code, size);
  // A DERIVED glyph ("lightbulb-outline:dashed", the lamp with no power) has no
  // vector of its own: the font generator cuts it from the plain one,
  // so the font's glyph is its only drawing. Drawn from the
  // plain path, "no power" would read as "off" here.
  if ((icons.names[role] ?? "").includes(":") && font && code !== undefined && font.glyphs.some((g) => g.code === code))
    return <ZiGlyphView font={font} code={code} color={color} title={icons.names[role]} />;
  if (path)
    return (
      <svg
        viewBox="0 0 24 24"
        width={cell.w}
        height={cell.h}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
        focusable="false"
        style={{ display: "block" }}
      >
        <title>{icons.names[role] ?? role}</title>
        <path d={path} fill={color} />
      </svg>
    );
  // a blank role is a blank icon: a list row with none, a counter with no kind
  const Fallback = FALLBACK[role];
  if (!Fallback) return null;
  return <Fallback sx={{ fontSize: size, color }} />;
}
