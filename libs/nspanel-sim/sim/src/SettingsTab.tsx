import { DEVICES, physicalScreenSizeMm, type DeviceId } from "@nspanel-sim/ui";
import type { HousingColor } from "./Enclosure";
import { CalibrationCard } from "./CalibrationCard";
import { Section, Field, SegmentedControl, Mono, Badge, type TabItem } from "./chrome";
import { chrome } from "./chromeTokens";

// Settings tab — parameterisation of the TOOL, not of the panel. The
// settings that run inside the NSPanel (liveSliderUpdate and so on) are
// a different thing: they appear in the "Settings" screen of the Panel
// tab, because they are product features and have to be seen at the
// real size and in the real palette to be judged.

const HOUSING_OPTIONS: readonly TabItem<HousingColor>[] = [
  { id: "white", label: "White" },
  { id: "graphite", label: "Graphite" },
];

export interface SettingsTabProps {
  deviceId: DeviceId;
  housingColor: HousingColor;
  onSetHousingColor: (c: HousingColor) => void;
  monitorPpi: number;
  monitorPxPerMm: number;
  devicePixelRatio: number;
  onCalibrate: (ppi: number, dpr: number) => void;
  /** The dpr the drawing is anchored to — see useMonitorCalibration. */
  referenceDpr: number;
  onReanchor: () => void;
}

export function SettingsTab({
  deviceId,
  housingColor,
  onSetHousingColor,
  monitorPpi,
  monitorPxPerMm,
  devicePixelRatio,
  onCalibrate,
  referenceDpr,
  onReanchor,
}: SettingsTabProps) {
  const device = DEVICES[deviceId];
  const mm = physicalScreenSizeMm(device);

  return (
    <div style={{ maxWidth: 720 }}>
      <Section
        title="Monitor calibration"
        description="The simulator draws the panel at its real physical size, and no browser API reports how big your monitor is — so this is measured once against a reference object."
      >
        <CalibrationCard
          monitorPpi={monitorPpi}
          monitorPxPerMm={monitorPxPerMm}
          devicePixelRatio={devicePixelRatio}
          onCalibrate={onCalibrate}
        />
        <ZoomAnchor
          referenceDpr={referenceDpr}
          devicePixelRatio={devicePixelRatio}
          onReanchor={onReanchor}
        />
        <Field
          label="Verify"
          hint="If the ruler disagrees, the calibration is off — not the layout. Adjust above until it matches."
        >
          <div style={{ font: `${chrome.font.size.md}px ${chrome.font.family}`, color: chrome.color.text }}>
            Hold a ruler to the panel screen in the Panel tab: it should read{" "}
            <Mono>
              {mm.widthMm.toFixed(1)} &times; {mm.heightMm.toFixed(1)} mm
            </Mono>
            .
          </div>
        </Field>
      </Section>

      <Section
        title="Enclosure"
        description="Housing colour is cosmetic — it does not affect the screen. The housing geometry itself is approximate; only the screen is held to measured accuracy."
      >
        <Field label="Housing colour">
          <SegmentedControl
            options={HOUSING_OPTIONS}
            value={housingColor}
            onChange={onSetHousingColor}
          />
        </Field>
      </Section>
    </div>
  );
}

// The zoom the drawing is anchored to, and a way out when it is wrong.
//
// devicePixelRatio is OS scaling times browser zoom, and nothing tells
// them apart. The panel is drawn against the ratio in force when the
// page loaded, so it comes out at true physical size as long as that
// moment was at 100% zoom — and it drifts if the page loaded zoomed, or
// if the window has since moved to a monitor with different scaling.
//
// That is a real limitation, so it is shown rather than hidden: when
// the two numbers disagree the panel is off by exactly their ratio, and
// one click fixes it without redoing the card measurement.
function ZoomAnchor({
  referenceDpr,
  devicePixelRatio,
  onReanchor,
}: {
  referenceDpr: number;
  devicePixelRatio: number;
  onReanchor: () => void;
}) {
  const drifted = Math.abs(referenceDpr - devicePixelRatio) > 0.001;
  return (
    <div style={{ marginTop: chrome.space.lg }}>
      <Field
        label="Zoom anchor"
        hint={
          drifted
            ? "The page is not at the zoom the panel was anchored to, so it is drawn off by that ratio. Set the anchor here, or reload at 100% zoom."
            : "Anchored to the current zoom, so the panel is at true physical size. Zooming from here scales it like the rest of the page."
        }
      >
        <div style={{ display: "flex", alignItems: "center", gap: chrome.space.md, flexWrap: "wrap" }}>
          <span style={{ font: `${chrome.font.size.sm}px ${chrome.font.family}` }}>
            anchored <Mono>{referenceDpr.toFixed(3)}</Mono> &middot; now{" "}
            <Mono>{devicePixelRatio.toFixed(3)}</Mono>
          </span>
          {drifted ? (
            <button
              onClick={onReanchor}
              style={{
                appearance: "none",
                border: `1px solid ${chrome.color.borderStrong}`,
                borderRadius: chrome.radius.sm,
                background: "transparent",
                color: chrome.color.text,
                font: `${chrome.font.size.xs}px ${chrome.font.family}`,
                padding: `${chrome.space.xs}px ${chrome.space.md}px`,
                cursor: "pointer",
              }}
            >
              Anchor to current zoom
            </button>
          ) : (
            <Badge tone="ok">matched</Badge>
          )}
        </div>
      </Field>
    </div>
  );
}
