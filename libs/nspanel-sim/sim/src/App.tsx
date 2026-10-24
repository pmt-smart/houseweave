import { useState } from "react";
import { type DeviceId, DEVICES, cssPxPerMmFromPpi } from "@nspanel-sim/ui";
import { type HousingColor } from "./Enclosure";
import { useMonitorCalibration } from "./useMonitorCalibration";
import { useDevicePixelRatio } from "./useDevicePixelRatio";
import { PanelTab } from "./PanelTab";
import { ThemesTab } from "./ThemesTab";
import { SettingsTab } from "./SettingsTab";
import { HouseTab } from "./HouseTab";
import { ServerSettings } from "./ServerSettings";
import { SegmentedControl, Tabs, type TabItem } from "./chrome";
import { chrome } from "./chromeTokens";
import { contentProblems, themes, projects } from "./content";

// HouseWeave's app, in three sections, one that makes and one that runs:
//
//   Studio    what goes to the devices: the simulator (the panel whole, its Berry on Tasmota's VM and its compiled pages on the emulated glass, PanelTab.tsx)
//             and the themes (the design system, its components and looks); the projects and the build come here next.
//   House     the house running: its nodes, their updates, their backups, the hardware swap (HouseTab.tsx).
//   Settings  HouseWeave's server (its identity, its pairing with a house, the round's time) and the tool (calibration, housing). Mind the name:
//             the Settings that runs inside the NSPanel is a page of the panel, in the simulator -- a different thing with the same name.
type Section = "studio" | "house" | "settings";
type StudioPart = "simulator" | "themes";

const SECTIONS: readonly TabItem<Section>[] = [
  { id: "studio", label: "Studio" },
  { id: "house", label: "House" },
  { id: "settings", label: "Settings" },
];
const STUDIO: readonly TabItem<StudioPart>[] = [
  { id: "simulator", label: "Simulator" },
  { id: "themes", label: "Themes" },
];

// The shell owns the choices, so switching sections resets nothing: the panel keeps running while the house or the settings are on show.
export default function App() {
  const [section, setSection] = useState<Section>("studio");
  const [part, setPart] = useState<StudioPart>("simulator");
  const [themeId, setThemeId] = useState(themes[0]?.id ?? "");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const theme = themes.find((d) => d.id === themeId) ?? themes[0];
  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  // a project holds a layout per panel model, and the model is the reader's choice
  const [deviceId, setDeviceId] = useState<DeviceId>("eu-landscape");
  const [housingColor, setHousingColor] = useState<HousingColor>("graphite");
  const { calibration, calibrate, reanchor } = useMonitorCalibration();
  // Live dpr is for MEASURING during calibration only; sizing uses the dpr the
  // measurement was anchored to (useMonitorCalibration.ts)
  const dpr = useDevicePixelRatio();
  const monitorPxPerMm = cssPxPerMmFromPpi(calibration.ppi, calibration.referenceDpr);
  const deviceSupported = deviceId in DEVICES;
  const brand = (
    <span style={{ font: `${chrome.font.weight.medium} ${chrome.font.size.md}px ${chrome.font.family}`, color: chrome.color.textMuted }}>
      HouseWeave
    </span>
  );

  return (
    <div style={{ minHeight: "100vh", background: chrome.color.bg, color: chrome.color.text, fontFamily: chrome.font.family }}>
      <Tabs items={SECTIONS} value={section} onChange={setSection} right={brand} />

      {contentProblems.length > 0 ? (
        <div
          style={{
            background: "rgba(221,113,96,0.12)",
            borderBottom: `1px solid ${chrome.color.danger}`,
            color: chrome.color.text,
            font: `${chrome.font.weight.regular} ${chrome.font.size.sm}px ${chrome.font.mono}`,
            padding: `${chrome.space.sm}px ${chrome.space.xl}px`,
            whiteSpace: "pre-wrap",
          }}
        >
          {contentProblems.map((p) => `${p.file}\n${p.lines.join("\n")}`).join("\n")}
        </div>
      ) : null}

      <main style={{ padding: chrome.space.xl }}>
        <div hidden={section !== "studio"}>
          <div style={{ marginBottom: chrome.space.lg }}>
            <SegmentedControl options={STUDIO} value={part} onChange={setPart} />
          </div>
          {/* the panel stays mounted on the other sections and parts, and running: it is a panel on a wall, not a picture of one */}
          <div hidden={part !== "simulator"}>
            {deviceSupported && (
              <PanelTab
                project={project}
                projects={projects}
                onSelectProject={setProjectId}
                deviceId={deviceId}
                onSetDeviceId={setDeviceId}
                monitorPxPerMm={monitorPxPerMm}
                housingColor={housingColor}
              />
            )}
          </div>
          {part === "themes" &&
            (theme ? (
              <ThemesTab deviceId={deviceId} theme={theme} themes={themes} onSelectTheme={setThemeId} />
            ) : (
              <p style={{ color: chrome.color.textMuted }}>No theme loaded — see the problems reported above.</p>
            ))}
        </div>

        {section === "house" && <HouseTab />}

        {section === "settings" && (
          <>
            <ServerSettings />
            <SettingsTab
              deviceId={deviceId}
              housingColor={housingColor}
              onSetHousingColor={setHousingColor}
              monitorPpi={calibration.ppi}
              monitorPxPerMm={monitorPxPerMm}
              devicePixelRatio={dpr}
              onCalibrate={calibrate}
              referenceDpr={calibration.referenceDpr}
              onReanchor={() => reanchor(dpr)}
            />
          </>
        )}
      </main>
    </div>
  );
}
