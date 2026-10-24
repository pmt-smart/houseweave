import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ThemeProvider } from "@mui/material/styles";
import {
  DEVICES,
  TARGET_SIZE_MM,
  BRIGHTNESS_GRADIENT,
  CT_GRADIENT,
  HUE_GRADIENT,
  Clock,
  GradientSlider,
  Label,
  LightCard,
  NavHeader,
  StatusIconView,
  ToggleSwitch,
  WeatherRow,
  mmToPx,
  rgb565ToHex,
  DEFAULT_PALETTE,
  DeviceProvider,
  PanelThemeProvider,
  componentProvenance,
  makePanelMuiTheme,
  PanelIconsProvider,
  PanelFontsProvider,
  PlacementProvider,
  PanelPaletteProvider,
  PanelStyleProvider,
  panelPaletteFromTokens,
  type IconRole,
  type PanelIconSet,
  type PanelFontSet,
  type DeviceId,
  type LightDevice,
} from "@nspanel-sim/ui";
import type { ColorProvenance, Theme } from "@nspanel-sim/core";
import { layoutStyle } from "@nspanel-sim/layout";
import { Badge, Hint, Mono, Picker, Section, SelectorBar, UseTags, type BadgeTone } from "./chrome";
import { iconFontUrls, iconRolesOf } from "./fonts";
import { useZiFonts } from "./themeRuntime";
import { TypeSection } from "./TypeSection";
import { IconsSection } from "./IconsSection";
import { chrome } from "./chromeTokens";

// Themes tab — where the PANEL's theme is defined and prototyped. It is
// not the theme of this web interface: that one is chromeTokens.ts, and
// the two are separate on purpose (see there).
//
// A CATALOGUE, and the word matters. Every element the theme offers -- a
// colour, a size of type, an icon drawing, a component -- appears exactly
// ONCE, carrying the tags that say what it is for. It does not appear again
// because a second thing uses it: one colour paints both a title and a
// button's caption, and that is two tags on one swatch, not two swatches. Each
// component and each icon is listed once: listed per size, a reader would count
// sixteen icons where there are eight.
//
// What this tab shows is the panel's system seen up close on the
// monitor, without the housing and without the RGB565 the glass
// draws in. That is intentional: COLOUR and FORM are
// decided here. Whether a colour survives RGB565, and whether a touch
// target is big enough, are questions for the Panel tab, where the pixel
// is its real size.

// The panel palette has two origins with very different reliability
// (see ui/src/theme.ts), and that difference is the most important fact
// about it — showing the colours without the distinction would hide
// exactly what matters when changing them.
// The palette has two origins with very different reliability, and that
// difference is the most important fact about it — showing the colours without
// the distinction would hide exactly what matters when changing them. The
// document says which is which (theme.json, "provenance"), so this tab
// only has to group them.
const PROVENANCE_GROUPS: { provenance: ColorProvenance; title: string; description: string; tone: BadgeTone; badge: string }[] = [
  {
    provenance: "exact",
    title: "Exact hardware values",
    description:
      "Real RGB565 numbers already running on the panel today. Changing one of these means changing the firmware too.",
    tone: "ok",
    badge: "RGB565 exact",
  },
  {
    provenance: "approximate",
    title: "Visual approximations",
    description:
      "Eyeballed from the reference screenshots. No known real value exists — the original .HMI is closed. Safe to refine; nothing in the firmware depends on them.",
    tone: "warn",
    badge: "approximate",
  },
];

const GRADIENTS = [
  { name: "BRIGHTNESS_GRADIENT", value: BRIGHTNESS_GRADIENT },
  { name: "CT_GRADIENT", value: CT_GRADIENT },
  { name: "HUE_GRADIENT", value: HUE_GRADIENT },
];

export interface ThemesTabProps {
  deviceId: DeviceId;
  /** the document the picker selected; the tab describes THIS one */
  theme: Theme;
  /** the ones to choose from -- the picker is in this tab, because it is this
   *  tab's content that it changes */
  themes: readonly Theme[];
  onSelectTheme: (id: string) => void;
}

export function ThemesTab({ deviceId, theme, themes, onSelectTheme }: ThemesTabProps) {
  const device = DEVICES[deviceId];
  // The previews are of THIS theme, so they get its palette, its style
  // and its icons -- the same providers the Panel tab mounts; with the
  // module-level defaults all three themes would show identical components.
  const previewPalette = useMemo(
    () => panelPaletteFromTokens(theme.colors.map((c) => ({ id: c.id, hex: rgb565ToHex(c.rgb565) }))).palette,
    [theme],
  );
  const previewMui = useMemo(
    () => makePanelMuiTheme({ ...DEFAULT_PALETTE, ...previewPalette }),
    [previewPalette],
  );
  // which `.zi` each font role resolves to -- the same answer the Panel tab
  // gives, read off the theme document rather than chosen here
  const previewFonts: PanelFontSet = useMemo(
    () => Object.fromEntries(theme.fonts.map((f) => [f.role, { height: f.height, weight: f.weight }])) as PanelFontSet,
    [theme],
  );
  // every icon font the theme carries: a component picks by size
  const previewIconUrls = useMemo(() => iconFontUrls(theme), [theme]);
  const previewIconFonts = useZiFonts(previewIconUrls);
  const previewIcons: PanelIconSet = useMemo(() => {
    const codes: PanelIconSet["codes"] = {};
    const names: PanelIconSet["names"] = {};
    const paths: PanelIconSet["paths"] = {};
    for (const [role, entry] of Object.entries(iconRolesOf(theme))) {
      codes[role as IconRole] = entry.code;
      names[role as IconRole] = entry.name;
      paths[role as IconRole] = entry.path;
    }
    return { fonts: Object.values(previewIconFonts), codes, names, paths };
  }, [theme, previewIconFonts]);
  // Which components this theme draws ITSELF, and which it inherits. The
  // distinction is the honest answer to "why do the three look the same": until
  // a theme has its own drawing for a component, it is showing the base
  // one, and saying so is better than letting a reader assume otherwise.
  // the shortest icon font this theme carries: what a component asking
  // for a small icon will really get, because size is a font choice
  const previewIconHeight = Math.min(
    ...(previewIcons.fonts.length > 0 ? previewIcons.fonts.map((f) => f.height) : [28]),
  );
  const provenance = useMemo(() => componentProvenance(theme.id), [theme]);
  const ownCount = provenance.filter((p) => !p.inherited).length;
  const paletteOf = (id: string) => rgb565ToHex(theme.colors.find((c) => c.id === id)?.rgb565 ?? 0);
  const groups = PROVENANCE_GROUPS.map((g) => ({
    ...g,
    entries: theme.colors
      .filter((c) => c.provenance === g.provenance)
      .map((c) => ({ name: c.id, value: rgb565ToHex(c.rgb565), rgb565: c.rgb565, origin: c.origin, use: c.use })),
  })).filter((g) => g.entries.length > 0);

  // Prototyping state only — deliberately separate from the Panel tab's
  // state: moving a slider here is experimenting with the component, not
  // changing the light being simulated over there.
  const [on, setOn] = useState(true);
  const [bri, setBri] = useState(60);
  const [ct, setCt] = useState(35);
  const [hue, setHue] = useState(70);

  const previewProps: PreviewProps = {
    light: { id: "P1", name: "Living Room", power: on ? 1 : 0, bri: 200, hue: 40, sat: 200, ct: 300 },
    on, setOn, bri, setBri, ct, setCt, hue, setHue,
    accent: paletteOf("accent-blue"),
    lowSat: paletteOf("icon-low-sat"),
    iconHeight: previewIconHeight,
  };

  return (
    <div style={{ maxWidth: 860 }}>
      <SelectorBar note={`${theme.components.length} components · ${theme.colors.length} colours · ${theme.fonts.length} fonts`}>
        <Picker
          label="Theme"
          value={theme.id}
          options={themes.map((d) => ({ id: d.id, label: d.name, hint: `${d.components.length} components` }))}
          onChange={onSelectTheme}
        />
      </SelectorBar>

      {/* First, above the palette, because it is what someone about to pick a
          colour or a size needs to have read. The theme document carries these
          lines itself (theme schema 7) and `parseTheme` refuses a theme whose
          copy drifted, so what is on screen is what that theme really ships —
          not a constant this tab happens to import. */}
      <Section
        title="Drawing for the glass"
        description="What the panel cannot do, carried by every theme document. Each line is a measurement, not a preference — the full reasoning is docs/09-drawing-for-the-glass.md."
      >
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            font: `${chrome.font.size.xs}px ${chrome.font.mono}`,
            color: chrome.color.textFaint,
          }}
        >
          {theme.drawing.slice(1).map((line) => {
            const [topic, ...rest] = line.split(/\s{2,}/);
            return (
              <li key={topic} style={{ display: "flex", gap: chrome.space.md, padding: `${chrome.space.xs}px 0` }}>
                <span style={{ color: chrome.color.text, minWidth: 68 }}>{topic}</span>
                <span>{rest.join(" ")}</span>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section
        title="Palette"
        description="The panel palette, split by how much each colour is actually known. That split is the point: half of it is firmware truth, half is a guess from screenshots."
      >
        {groups.map((g) => (
          <div key={g.title} style={{ marginBottom: chrome.space.xl }}>
            <div style={{ display: "flex", alignItems: "center", gap: chrome.space.sm }}>
              <span
                style={{
                  font: `${chrome.font.weight.medium} ${chrome.font.size.md}px ${chrome.font.family}`,
                  color: chrome.color.text,
                }}
              >
                {g.title}
              </span>
              <Badge tone={g.tone}>{g.badge}</Badge>
            </div>
            <div style={{ marginTop: chrome.space.xs, marginBottom: chrome.space.md }}>
              <Hint>{g.provenance}</Hint>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: chrome.space.md }}>
              {g.entries.map((e) => (
                // ONE swatch per colour, however many things paint with it: the
                // tags say where it may be used, and a second entry for the
                // second use would be the same colour twice
                <div key={e.name} style={{ width: 196 }}>
                  <div
                    style={{
                      height: 44,
                      background: e.value,
                      border: `1px solid ${chrome.color.border}`,
                      borderRadius: chrome.radius.sm,
                    }}
                  />
                  <div
                    style={{
                      marginTop: chrome.space.xs,
                      font: `${chrome.font.weight.medium} ${chrome.font.size.sm}px ${chrome.font.family}`,
                      color: chrome.color.text,
                    }}
                  >
                    {e.name}
                  </div>
                  <div style={{ marginTop: chrome.space.xs }}>
                    <UseTags use={e.use} />
                  </div>
                  <div style={{ marginTop: chrome.space.xs }}>
                    <Mono>
                      {e.value} · {e.rgb565}
                    </Mono>
                  </div>
                  <div style={{ marginTop: chrome.space.xs }}>
                    <Hint>{e.origin}</Hint>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div
          style={{
            font: `${chrome.font.weight.medium} ${chrome.font.size.md}px ${chrome.font.family}`,
            color: chrome.color.text,
            marginBottom: chrome.space.md,
          }}
        >
          Slider tracks
        </div>
        {GRADIENTS.map((g) => (
          <div key={g.name} style={{ marginBottom: chrome.space.md }}>
            <div
              style={{
                height: 20,
                background: g.value,
                borderRadius: chrome.radius.sm,
                border: `1px solid ${chrome.color.border}`,
              }}
            />
            <div style={{ marginTop: chrome.space.xs }}>
              <Mono>{g.name}</Mono>
            </div>
          </div>
        ))}
      </Section>

      <Section
        title="Touch targets"
        description="Minimum sizes (ISO/TS 9241-411 bare finger, IEC 61131 / ISA 101 industrial), converted to panel pixels. A component under this size works fine with a mouse in the browser and fails with a finger on the wall."
      >
        <div style={{ display: "flex", gap: chrome.space.xl, flexWrap: "wrap" }}>
          {(
            [
              ["Bare finger", TARGET_SIZE_MM.bareFinger],
              ["Industrial", TARGET_SIZE_MM.industrial],
            ] as const
          ).map(([label, mm]) => (
            <div key={label}>
              <div
                style={{
                  width: mmToPx(mm, device),
                  height: mmToPx(mm, device),
                  border: `1px dashed ${chrome.color.accent}`,
                  background: chrome.color.accentSoft,
                  borderRadius: chrome.radius.sm,
                }}
              />
              <div
                style={{
                  marginTop: chrome.space.xs,
                  font: `${chrome.font.size.xs}px ${chrome.font.family}`,
                  color: chrome.color.textMuted,
                }}
              >
                {label}
              </div>
              <Mono>
                {mm} mm = {mmToPx(mm, device)} px
              </Mono>
            </div>
          ))}
        </div>
        <div style={{ marginTop: chrome.space.md }}>
          <Hint>
            Drawn at 1&times; browser pixels, so on your monitor these squares are not physically 12
            and 15 mm &mdash; only the Panel tab draws at true physical size.
          </Hint>
        </div>
      </Section>

      <Section
        title="Components"
        description="One card per component, and everything known about it in that one place: what it draws, whether it has been seen working on real hardware, what it compiles into, what a placement has to bind, and the smallest touch target it accepts. It used to be two sections — a drawing here, a status list further down — which is the same component twice. A theme draws the components it has its own version of and inherits the rest from the one the panel runs today; the badge says which, because two themes showing the same drawing should be a fact you can read, not one you have to notice."
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: chrome.space.xs, marginBottom: chrome.space.lg }}>
          <Badge tone={ownCount > 0 ? "ok" : "warn"}>
            {ownCount} of {provenance.length} drawn by this theme
          </Badge>
        </div>
        <DeviceProvider device={deviceId}>
        <PanelThemeProvider id={theme.id}>
        <PanelPaletteProvider palette={previewPalette}>
        <PanelStyleProvider style={layoutStyle(theme.style, theme.fonts)}>
        <PanelIconsProvider icons={previewIcons}>
        <PanelFontsProvider fonts={previewFonts}>
        <ThemeProvider theme={previewMui}>
          <div style={{ display: "grid", gap: chrome.space.md }}>
            {theme.components.map((c) => {
              const from = provenance.find((p) => p.id === c.id);
              return (
                <div
                  key={c.id}
                  style={{
                    background: chrome.color.surfaceRaised,
                    border: `1px solid ${chrome.color.border}`,
                    borderRadius: chrome.radius.sm,
                    padding: chrome.space.md,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: chrome.space.sm, flexWrap: "wrap" }}>
                    <span style={{ font: `${chrome.font.weight.medium} ${chrome.font.size.md}px ${chrome.font.family}`, color: chrome.color.text }}>
                      {c.id}
                    </span>
                    <Badge tone={c.hardwareValidated ? "ok" : "warn"}>
                      {c.hardwareValidated ? "hardware-validated" : "simulator-only"}
                    </Badge>
                    {from?.inherited && <Badge>inherited from {from.from}</Badge>}
                    <Badge>{c.primitives.join(" + ")}</Badge>
                    {c.minTouchMm && (
                      <Badge>
                        min {c.minTouchMm.w}&times;{c.minTouchMm.h} mm = {mmToPx(c.minTouchMm.w, device)}&times;
                        {mmToPx(c.minTouchMm.h, device)} px
                      </Badge>
                    )}
                    {c.requires.length > 0 && <UseTags use={c.requires.map((r) => `binds ${r}`)} />}
                  </div>
                  <div style={{ marginTop: chrome.space.xs }}>
                    <Hint>{c.notes}</Hint>
                  </div>
                  {/* the drawing, on the panel's own ground and at native panel
                      pixels -- no RGB565 quantisation, which is the Panel tab's
                      question, not this one's */}
                  <div
                    style={{
                      marginTop: chrome.space.sm,
                      background: paletteOf("background"),
                      color: paletteOf("text-primary"),
                      fontFamily: theme.style.fontFamily,
                      borderRadius: chrome.radius.sm,
                      padding: chrome.space.md,
                      width: device.visibleWidthPx,
                      maxWidth: "100%",
                      boxSizing: "border-box",
                      overflowX: "auto",
                    }}
                  >
                    {/* The room a preview gets. A converted component lays itself
                        out in panel pixels and has to be told how many it has;
                        outside a project there is no placement, so the tool says. */}
                    <PlacementProvider size={{ w: device.visibleWidthPx - 2 * chrome.space.md, h: PREVIEW_HEIGHT[c.id] ?? 56 }}>
                      {PREVIEWS[c.id]?.(previewProps) ?? <Hint>No preview for this component yet.</Hint>}
                    </PlacementProvider>
                  </div>
                </div>
              );
            })}
          </div>
        </ThemeProvider>
        </PanelFontsProvider>
        </PanelIconsProvider>
        </PanelStyleProvider>
        </PanelPaletteProvider>
        </PanelThemeProvider>
        </DeviceProvider>
      </Section>

      <TypeSection theme={theme} />

      <IconsSection theme={theme} />

    </div>
  );
}

/**
 * Sample data for the previews. A tool concern, not the theme's: a component
 * needs SOMETHING to draw, and what it draws is the theme's answer.
 */
interface PreviewProps {
  light: LightDevice;
  on: boolean;
  setOn: (v: boolean) => void;
  bri: number;
  setBri: (v: number) => void;
  ct: number;
  setCt: (v: number) => void;
  hue: number;
  setHue: (v: number) => void;
  accent: string;
  lowSat: string;
  /** the shortest icon font the theme carries: what a small icon really gets */
  iconHeight: number;
}

/**
 * How to draw each component id, keyed by the id the THEME declares.
 *
 * Driven by the theme's component list rather than written out as fixed JSX in
 * the order someone typed it: a theme that declares a component this map does
 * not know says so on screen instead of quietly not appearing, and a component
 * declared twice cannot be drawn twice.
 */
/**
 * How much room a preview gets, in panel pixels. A component that lays itself
 * out needs a box, and outside a project there is no placement to give it one --
 * so these are the tool's numbers, chosen to be roughly what the projects place.
 */
const PREVIEW_HEIGHT: Record<string, number> = {
  label: 40,
};

const PREVIEWS: Record<string, (p: PreviewProps) => ReactNode> = {
  label: () => <Label text="Living Room" tone="title" align="center" />,
  clock: () => <Clock time="21:51" date="04/09/2026" />,
  "weather-row": () => (
    <WeatherRow
      items={[
        { label: "", tempC: 18.1 },
        { label: "Fri", tempC: 21.4 },
        { label: "Sat", tempC: 19.8 },
        { label: "Sun", tempC: null },
        { label: "Mon", tempC: null },
      ]}
    />
  ),
  "status-icon": (p) => (
    // Side by side and NOT positioned: `side` says which of the panel's two
    // fixed slots this is (statusUpdate~icon1~color1~icon2~color2), and where
    // the icon sits is the project's placement, not the component's opinion.
    // Stacking them in a `position: relative` box would draw one on top of the
    // other and look like a bug in the component.
    //
    // The row is as tall as the icon font the theme will really use --
    // `StatusIconView` asks for a 20px budget and the smallest font on offer is
    // 32, so the glyph is 32 tall. That mismatch is the theme's to answer, not
    // the preview's to hide.
    <div style={{ display: "flex", gap: 24, alignItems: "center", minHeight: p.iconHeight }}>
      <StatusIconView side="left" role="power" color="icon-low-sat" />
      <StatusIconView side="right" role="lightOff" color="icon-off" />
    </div>
  ),
  "nav-header": () => <NavHeader title="Living Room" onPrev={() => {}} onNext={() => {}} />,
  "light-card": (p) => (
    // the box a project's placement gives it (104x110 px), because the card
    // fills its box and would otherwise stretch the whole panel
    <div style={{ width: 104, height: 110 }}>
      <LightCard light={p.light} onToggle={() => p.setOn(!p.on)} onOpenDetail={() => {}} />
    </div>
  ),
  "toggle-switch": (p) => <ToggleSwitch on={p.on} onChange={p.setOn} />,
  "gradient-slider": (p) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <GradientSlider pct={p.bri} ramp="brightness" onChange={p.setBri} />
      <GradientSlider pct={p.ct} ramp="color-temp" onChange={p.setCt} />
      <GradientSlider pct={p.hue} ramp="hue" onChange={p.setHue} />
      {/* dimmed: the state used when the opposite mode is active — colour and
          temperature are mutually exclusive (types.ts:LightDetailData.colorMode) */}
      <GradientSlider pct={p.hue} ramp="hue" onChange={p.setHue} dimmed />
    </div>
  ),
};
