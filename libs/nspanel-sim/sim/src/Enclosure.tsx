import { useRef, type ReactNode } from "react";
import type { DeviceId, DevicePreset } from "@nspanel-sim/ui";

export type HousingColor = "white" | "graphite";

// The housing's real physical dimensions — MEASURED on both physical units,
// not taken from either spec sheet. EU: 84x84 mm (the spec sheet says 86x86,
// about 2 mm optimistic). US: 72x117 mm (the spec sheet says 74x120). In both
// cases the real measurement is smaller than the declared one, and on the US
// unit the cause is seen: the housing thickens from front to back
// (the spec sheet probably measures a point further back, or the
// mounting base, rather than the visible front face), and for a visual
// render it is the front face that governs, not the "official" figure.
// Plausibly the same reason in the EU case, but not confirmed for that
// device specifically. The US model is installed vertically (the
// American light-switch plate standard, taller than wide once mounted),
// which reconciles with the portrait screen already confirmed by opening
// the physical unit. Converted here to width/height AS INSTALLED on the
// wall, not as the manufacturer lists them.
const HOUSING_MM: Record<DeviceId, { width: number; height: number }> = {
  "eu-landscape": { width: 84, height: 84 },
  "us-portrait": { width: 72, height: 117 },
};

// Glass: MEASURED on both physical units — it differs
// between EU and US, which is why it is per device rather than a single
// value like the rest. The US was also confirmed to have NO width crop
// (the screen shows the entire Nextion grid, without the hidden strip
// the EU has — already reflected in devices.ts:visibleWidthPx).
const GLASS_OVERHANG_MM: Record<DeviceId, number> = {
  "eu-landscape": 6,
  "us-portrait": 10,
};

// Measured on the physical EU unit and identical on the US one (same thickness, same
// outer-rounding-only scheme) — an estimate in neither case.
const MOLDING_THICKNESS_MM = 1.2; // the frame surrounding glass+buttons together, and the whole outer edge
const INNER_GAP_MM = 0.5; // button<->frame and button<->button clearance

// Button height is NOT an independent measurement — it is what is left
// after subtracting the frame (top and bottom), the glass block and the
// divider from the housing's total height (computed further below). That
// guarantees by construction that the frame always closes at ~1.2 mm on
// all four sides, instead of having to reconcile a guessed number every
// time (on the US unit the frame is 1.2 on every side). Checked against the EU's real measurement (~18 mm of
// button): the formula gives a ~19.2 mm row (18 mm of button + 2x0.5 mm
// of gap), a 0.17 mm difference — within the rounding margin of the
// other measurements.

// `held` is a button pushed in, and `relayOff` the simulator's relay mark
// with the relay open (see the buttons, below).
const HOUSING_COLORS: Record<HousingColor, { body: string; molding: string; glass: string; gap: string; button: string; held: string; relayOff: string }> = {
  white: { body: "#e8e8e4", molding: "#e8e8e4", glass: "#0c0c0c", gap: "#050505", button: "#f2f2ef", held: "#d9d9d4", relayOff: "#cdcdc8" },
  graphite: { body: "#2b2c2e", molding: "#2b2c2e", glass: "#050505", gap: "#000000", button: "#38393b", held: "#2a2b2d", relayOff: "#242527" },
};

const RELAY_ON = "#5fd17a";
const RELAY_MARK_MM = 1.6;

/** The panel's two buttons, when the housing is a panel's and not a picture of one. */
export interface HousingButtons {
  /** held down now, as the panel's button driver scans them */
  pressed: readonly boolean[];
  /** the relay under each button, closed or open */
  relays: readonly boolean[];
  /** button n (1 or 2) pushed in, or let go */
  onPress: (n: number, down: boolean) => void;
}

export interface EnclosureProps {
  device: DevicePreset;
  deviceId: DeviceId;
  /** CSS px per mm of monitor glass — calibrated, see useMonitorCalibration. */
  monitorPxPerMm: number;
  color: HousingColor;
  children: ReactNode; // the screen, already at the calibrated physical size
  /** the buttons are the panel's: held while the mouse is down, and marked with their relays */
  buttons?: HousingButtons;
}

// The physical housing around the screen — decorative context only, not
// part of what reaches the panel (which is why it renders at the
// monitor's full resolution, without the density emulation the screen
// uses).
//
// Structure, outside in (measured on the physical EU and US units):
//   1. Housing body (housingWidthPx/HeightPx, the box's real size) —
//      rounded corners. The margin in to the frame is not measured: a visual
//      estimate.
//   2. Frame, ~1.2 mm — it surrounds glass AND buttons as one block.
//      Square INNER corner, rounded OUTER corner (two nested divs: the
//      outer one has border-radius, the inner one does not). Confirmed
//      identical in thickness and scheme on both models.
//   3. Inside the frame: black glass at the top (the margin around the
//      screen differs per device — EU 6 mm, US 10 mm — square corners,
//      one piece; neither screen nor glass has any rounding. The US also
//      has no width crop, unlike the EU: it shows the entire Nextion
//      grid) and, below it, the buttons.
//   4. The frame also forms a horizontal DIVIDER between glass and
//      buttons, at the same thickness (~1.2 mm) — not merely a gap, but
//      the same piece and colour as the outer frame crossing there.
//   5. Buttons: square (no rounding), with ~0.5 mm of clearance from the
//      frame (on all four sides, including the divider above) AND from
//      each other (no vertical frame between them) — it reads as a
//      darkened outline, not as a separate piece.
export function Enclosure({ device, deviceId, monitorPxPerMm, color, children, buttons }: EnclosureProps) {
  // the button the mouse holds down, so a release lets go of that one only
  const holding = useRef(0);
  const housingMm = HOUSING_MM[deviceId];
  const housingWidthPx = housingMm.width * monitorPxPerMm;
  const housingHeightPx = housingMm.height * monitorPxPerMm;
  const palette = HOUSING_COLORS[color];

  const glassOverhangPx = GLASS_OVERHANG_MM[deviceId] * monitorPxPerMm;
  const moldingThicknessPx = MOLDING_THICKNESS_MM * monitorPxPerMm;
  const gapPx = INNER_GAP_MM * monitorPxPerMm;

  // Content width = the truly VISIBLE width (device.visibleWidthPx, see
  // devices.ts) plus the glass margin on both sides — not the full
  // logical grid. The bezel crop (the EU showing only 450 of 480 px, for
  // instance) is the screen's to make: the views crop to it.
  const screenWidthPx = (device.visibleWidthPx / device.pxPerMm) * monitorPxPerMm;
  const contentWidthPx = screenWidthPx + glassOverhangPx * 2;

  // Button row height = what is left of the housing height after the
  // frame (top and bottom), the glass block and the divider — see the
  // BUTTON_HEIGHT_MM comment above for why this is derived rather than a
  // measurement of its own.
  const glassBlockHeightMm = device.heightPx / device.pxPerMm + GLASS_OVERHANG_MM[deviceId] * 2;
  const buttonAreaHeightMm =
    housingMm.height - MOLDING_THICKNESS_MM * 2 - glassBlockHeightMm - MOLDING_THICKNESS_MM;
  const buttonAreaHeightPx = buttonAreaHeightMm * monitorPxPerMm;

  // Margin between the housing body and the frame: the frame's 1.2 mm ALREADY
  // is the entire outer
  // edge, with no extra body margin outside it — the arithmetic closes
  // exactly against the measured 84x84 mm housing. Zero.
  const outerMarginPx = 0;

  return (
    <div
      style={{
        width: housingWidthPx,
        height: housingHeightPx,
        background: palette.body,
        // Subtle rounding, far less curved than a default — not measured, a
        // conservative guess.
        borderRadius: Math.max(2, housingWidthPx * 0.012),
        boxShadow: "0 10px 24px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: outerMarginPx,
        boxSizing: "border-box",
      }}
    >
      {/* Frame: rounded on the outside (this div), square on the inside
          (the inner one has no border-radius at all). */}
      <div
        style={{
          background: palette.molding,
          // Subtle, same reason as the body above — not measured.
          borderRadius: Math.max(2, moldingThicknessPx * 0.6),
          padding: moldingThicknessPx,
          lineHeight: 0,
        }}
      >
        <div
          style={{
            width: contentWidthPx,
            background: palette.gap,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          {/* Glass: square corners, no extra padding against the frame
              (it sits flush) — the screen itself has no rounding. */}
          <div style={{ background: palette.glass, padding: glassOverhangPx, lineHeight: 0 }}>
            {children}
          </div>

          {/* Divider: the same frame (same colour and thickness) crossing
              between glass and buttons — not an empty gap, but the piece
              itself. */}
          <div style={{ width: "100%", height: moldingThicknessPx, background: palette.molding, flexShrink: 0 }} />

          {/* Buttons: square, 0.5 mm of clearance from the frame on all
              four sides (including the divider above) and from each
              other — with no vertical frame between them.

              With `buttons`, they are the panel's: pushed in while the
              mouse holds them, and each with a mark of the relay it
              switches. The mark is the simulator's -- the housing has no
              light there -- and says what the relay does, which on the wall
              is the lamp it feeds. */}
          <div
            style={{
              display: "flex",
              gap: gapPx,
              width: "100%",
              height: buttonAreaHeightPx,
              padding: gapPx,
              boxSizing: "border-box",
            }}
          >
            {[1, 2].map((n) => {
              if (!buttons) return <div key={n} style={{ flex: 1, background: palette.button }} />;
              const held = buttons.pressed[n - 1] ?? false;
              const on = buttons.relays[n - 1] ?? false;
              const letGo = () => {
                if (holding.current !== n) return;
                holding.current = 0;
                buttons.onPress(n, false);
              };
              return (
                <div
                  key={n}
                  role="button"
                  aria-pressed={held}
                  title={`Button ${n} · relay ${n} ${on ? "on" : "off"}`}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    holding.current = n;
                    buttons.onPress(n, true);
                  }}
                  onPointerUp={letGo}
                  onPointerCancel={letGo}
                  onLostPointerCapture={letGo}
                  onContextMenu={(e) => e.preventDefault()}
                  style={{
                    flex: 1,
                    background: held ? palette.held : palette.button,
                    boxShadow: held ? "inset 0 2px 5px rgba(0,0,0,0.35)" : undefined,
                    cursor: "pointer",
                    touchAction: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span
                    style={{
                      width: RELAY_MARK_MM * monitorPxPerMm,
                      height: RELAY_MARK_MM * monitorPxPerMm,
                      borderRadius: "50%",
                      background: on ? RELAY_ON : palette.relayOff,
                      boxShadow: on ? `0 0 ${RELAY_MARK_MM * monitorPxPerMm}px ${RELAY_ON}` : undefined,
                      pointerEvents: "none",
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
