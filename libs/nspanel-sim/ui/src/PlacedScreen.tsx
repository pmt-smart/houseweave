// A screen as the project describes it: components in boxes.
//
// This replaces the hand-written screens (`screens/`) and the donor layout that
// borrowed joBr99's compiled boxes. Both had the same fault from two directions:
// geometry that lives inside a React component cannot be emitted, and a screen
// that is one component cannot mix themes. A Nextion page IS a list of
// placed components, so this renders exactly that, from exactly that.
//
// The part that makes mixing real is small and easy to miss: EACH PLACEMENT gets
// its own providers. A shadcn header inside a Tailwind project keeps shadcn's
// palette, style and icons -- otherwise "mixing" would mean borrowing a shape
// and repainting it in someone else's colours, which is not what a theme
// is. The page around them belongs to the project's primary one.
import type { ReactNode } from "react";
import { Screen } from "./components/Screen";
import { DeviceProvider } from "./deviceContext";
import { PanelThemeProvider, resolveComponent } from "./registry";
import { PanelIconsProvider, type PanelIconSet } from "./panelIcons";
import { PanelPaletteProvider, type PanelPalette } from "./palette";
import { PanelStyleProvider, type PanelStyle } from "./panelStyle";
import { PanelFontsProvider, type PanelFontSet } from "./panelFonts";
import { PlacementProvider } from "./PanelNodes";
import type { ComponentId } from "./contracts";
import type { DeviceId } from "./devices";

export interface PlacementSpec {
  component: string;
  theme: string;
  componentId: string;
  /** which of the theme's styles of that component; `default` when unsaid */
  variant?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  bind: Record<string, string | number | boolean>;
  /** how the placement takes input (project schema 7): `live` for a slider */
  input?: { live: "auto" | boolean };
}

/** Everything one theme needs to draw: its colours, its shapes, its glyphs. */
export interface ThemeRuntime {
  palette?: Partial<PanelPalette>;
  style?: Partial<PanelStyle>;
  icons?: PanelIconSet;
  /** which `.zi` each font role resolves to, so a layout asking for "title" gets this theme's cut */
  fonts?: PanelFontSet;
}

export interface PlacedScreenProps {
  device: DeviceId;
  placements: readonly PlacementSpec[];
  /** the theme the PAGE belongs to: background, font, and the fallback */
  primaryTheme: string;
  runtimes: Record<string, ThemeRuntime>;
  /**
   * Turns a `"$path"` into a value. Anything not starting with `$` is a literal
   * and never reaches here. Returning `undefined` is fine and means the
   * component gets no such prop -- a missing binding should look like a missing
   * value, not like a crash.
   */
  resolve: (ref: string) => unknown;
  /** draw each box's edge, to see the geometry the project declares */
  outlines?: boolean;
  /** the page's own colour, already resolved to CSS by the caller */
  background?: string;
  /** a tap anywhere on the screen (`screen.tap`, schema 7); undefined = the screen has other exits */
  onTap?: () => void;
  /**
   * The panel's "live slider update" setting, which a slider left on
   * `input.live: "auto"` follows: on, its bound setter fires on every step of
   * the drag; off, only when the finger lets go. The same rule the glass runs,
   * where the Touch Move handler reads a global Variable the switch writes.
   */
  liveSliderUpdate?: boolean;
  /**
   * What the runtime draws on this screen, over the placements: the plan of a
   * screen that declares one (schema 11), whose cards are drawn and not placed.
   */
  overlay?: ReactNode;
}

function bindProps(bind: PlacementSpec["bind"], resolve: (ref: string) => unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(bind)) out[k] = typeof v === "string" && v.startsWith("$") ? resolve(v) : v;
  return out;
}

export function PlacedScreen({
  device, placements, primaryTheme, runtimes, resolve, outlines = false, background, onTap, liveSliderUpdate = false, overlay,
}: PlacedScreenProps) {
  const page = runtimes[primaryTheme] ?? {};
  return (
    <PanelThemeProvider id={primaryTheme}>
      <PanelPaletteProvider palette={page.palette}>
        <PanelStyleProvider style={page.style}>
          <PanelIconsProvider icons={page.icons}>
            <PanelFontsProvider fonts={page.fonts}>
            <DeviceProvider device={device}>
            <Screen device={device} background={background} onTap={onTap}>
              {placements.map((p, i) => (
                <Placed key={i} placement={p} runtimes={runtimes} resolve={resolve} outlines={outlines} liveSliderUpdate={liveSliderUpdate} />
              ))}
              {overlay}
            </Screen>
            </DeviceProvider>
            </PanelFontsProvider>
          </PanelIconsProvider>
        </PanelStyleProvider>
      </PanelPaletteProvider>
    </PanelThemeProvider>
  );
}

function Placed({
  placement, runtimes, resolve, outlines, liveSliderUpdate,
}: {
  placement: PlacementSpec;
  runtimes: Record<string, ThemeRuntime>;
  resolve: (ref: string) => unknown;
  outlines: boolean;
  liveSliderUpdate: boolean;
}): ReactNode {
  // A placement the runtime may hide (`"visible": "$light.hueVisible"`): a
  // detail shows only the sliders its target can use. Hidden,
  // it draws nothing, as `vis 0` does on the glass.
  const shown = placement.bind.visible;
  if (typeof shown === "string" && shown.startsWith("$")) {
    const v = resolve(shown);
    if (v === 0 || v === false) return null;
  }
  const { component } = resolveComponent(placement.theme, placement.componentId as ComponentId);
  const runtime = runtimes[placement.theme] ?? {};
  const props = bindProps(placement.bind, resolve);
  // A slider reports while dragging or on release (`input.live`, schema 7),
  // and "auto" follows the panel's setting -- the one rule the glass runs too.
  // The bound setter is `onChange`; here it is moved to the release callback
  // when the slider is not live, so the simulator changes the light exactly
  // when the panel would.
  // The keyboard's line, and why it is NOT in the project's `bind` block: the
  // panel has no per-keystroke event and must never have one -- the glass types
  // by itself and only OK reports. But the Panel tab draws the same
  // screen twice, side by side, so the two instances need one line between them.
  // That is a simulator concern, so it is wired here and not written into the
  // document that compiles to a `.tft`.
  if (placement.componentId === "keyboard") {
    const change = resolve("$keyboard.change");
    if (typeof change === "function") props.onChange = change;
    // The layout keys name the OTHER keyboard screens, as screen ids, the same
    // way `screen.tap` does -- the glass compiles each to a `page` jump and the
    // simulator turns it into a re-render.
    const goto = resolve("$keyboard.goto");
    const targets: Record<string, unknown> = {
      letters: placement.bind?.onLetters, keypad: placement.bind?.onKeypad, symbols: placement.bind?.onSymbols,
    };
    if (typeof goto === "function") {
      props.onSwitchTo = (to: string) => {
        const screen = targets[to];
        if (typeof screen === "string") goto(screen);
      };
    }
    props.ways = Object.keys(targets).filter((k) => typeof targets[k] === "string");
    const capsChange = resolve("$keyboard.capsChange");
    if (typeof capsChange === "function") {
      props.caps = resolve("$keyboard.caps") === true;
      props.onCapsChange = capsChange;
    }
  }
  if (placement.componentId === "gradient-slider" && typeof props.onChange === "function") {
    const live = placement.input?.live ?? "auto";
    const effective = live === "auto" ? liveSliderUpdate : live;
    const setter = props.onChange as (pct: number) => void;
    props.onChangeCommitted = setter;
    if (!effective) props.onChange = () => {};
  }

  const box = (
    <div
      style={{
        position: "absolute",
        left: placement.x,
        top: placement.y,
        width: placement.w,
        height: placement.h,
        boxSizing: "border-box",
        overflow: "hidden",
        outline: outlines ? "1px dashed rgba(255,255,255,0.35)" : undefined,
        // The component FILLS the box rather than being centred inside a box of
        // its own choosing: the project's box is the contract with the compiler,
        // and a drawing that sized itself would make the declared geometry a
        // suggestion. Vertically centred, because a component shorter than its
        // box should sit in the middle of it and not at the top.
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
      title={`${placement.component} — ${placement.x},${placement.y} ${placement.w}x${placement.h}`}
    >
      {component ? (
        <div style={{ width: "100%" }}>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {(() => { const C = component as any; return <C {...props} />; })()}
        </div>
      ) : (
        <MissingComponent placement={placement} />
      )}
    </div>
  );

  return (
    <PanelThemeProvider id={placement.theme}>
      <PanelPaletteProvider palette={runtime.palette}>
        <PanelStyleProvider style={runtime.style}>
          <PanelIconsProvider icons={runtime.icons}>
            <PanelFontsProvider fonts={runtime.fonts}>
              <PlacementProvider size={{ w: placement.w, h: placement.h }} variant={placement.variant}>{box}</PlacementProvider>
            </PanelFontsProvider>
          </PanelIconsProvider>
        </PanelStyleProvider>
      </PanelPaletteProvider>
    </PanelThemeProvider>
  );
}

/** A placement whose component nobody implements: said on the glass, not hidden. */
function MissingComponent({ placement }: { placement: PlacementSpec }) {
  return (
    <span style={{ font: "10px monospace", color: "#e06c75", textAlign: "center", padding: 2 }}>
      {placement.component}
      <br />
      not implemented
    </span>
  );
}
