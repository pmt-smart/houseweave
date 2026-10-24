import { useEffect, useState, type ReactNode } from "react";
import { DEVICES, physicalScreenSizeMm, type DeviceId } from "@nspanel-sim/ui";
import type { Project } from "@nspanel-sim/core";
import type { HousingColor } from "./Enclosure";
import { Badge, Picker, SegmentedControl, SelectorBar, ToggleButton, type TabItem } from "./chrome";
import { chrome } from "./chromeTokens";
import { GlassView } from "./GlassView";
import { BridgeControls, ConsoleControls, LogControls, NetworkControls } from "./PanelControls";
import { ReactPanelView } from "./ReactPanelView";
import { hasProject, projectName } from "./panelFiles";
import { Rig } from "./rig";

// The panel, simulated whole: the panel's own Berry on Tasmota's
// Berry VM, and the project's compiled pages on the emulated Nextion, joined by
// the UART, in a house with the room's bridge and its lamps (rig.ts). Nothing on
// this tab imitates the panel: the glass runs what the .tft runs, and the ESP32
// runs what the panel's flash holds.
//
// It is shown twice, side by side, as it was before the panel ran here:
//
//   Real   what the hardware shows: the emulated Nextion, drawing the
//          compiled pages in RGB565 with the .zi's own glyphs.
//   React  the project's React components, the design as written.
//
// Both are the ONE panel. The React screens show what the glass holds, read
// back off it (mirror.ts), and a touch on either is pressed on the glass
// (panelSurface.tsx), so the two cannot disagree about which page is up or
// whether a light is on -- the comparison is of the drawing, and only of it.
// The housing's buttons are the panel's on both.

const DEVICE_OPTIONS: readonly TabItem<DeviceId>[] = (Object.keys(DEVICES) as DeviceId[]).map((id) => ({ id, label: DEVICES[id].label }));

export interface PanelTabProps {
  project: Project | undefined;
  projects: readonly Project[];
  onSelectProject: (id: string) => void;
  deviceId: DeviceId;
  onSetDeviceId: (id: DeviceId) => void;
  monitorPxPerMm: number;
  housingColor: HousingColor;
}

export function PanelTab({ project, projects, onSelectProject, deviceId, onSetDeviceId, monitorPxPerMm, housingColor }: PanelTabProps) {
  const device = DEVICES[deviceId];
  const mm = physicalScreenSizeMm(device);
  const name = project ? projectName(project.id, deviceId) : "";
  const known = project !== undefined && hasProject(name);
  const [boots, setBoots] = useState(0);
  // the panel of this project, panel model and boot: another key is another panel
  const key = `${name}#${boots}`;
  const [made, setMade] = useState<{ key: string; rig: Rig } | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const rig = made?.key === key ? made.rig : null;
  const problem = failed?.key === key ? failed.message : null;
  const [outlines, setOutlines] = useState(false);
  const [page, setPage] = useState("");
  const [beeps, setBeeps] = useState(0);

  // one panel per project and panel model: switching either is another panel on the wall
  useEffect(() => {
    if (!known) return;
    let alive = true;
    let started: Rig | null = null;
    Rig.create(name, deviceId, { width: device.widthPx, height: device.heightPx })
      .then((r) => {
        if (!alive) return;
        started = r;
        r.start();
        setMade({ key, rig: r });
        // a handle for the browser's console, to look at the panel while it runs
        (window as unknown as { nspanel?: Rig }).nspanel = r;
      })
      .catch((e: unknown) => {
        if (alive) setFailed({ key, message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      alive = false;
      started?.stop();
    };
  }, [key, name, known, deviceId, device.widthPx, device.heightPx]);

  // the page on show and the buzzer, for the bar
  useEffect(() => {
    if (!rig) return;
    const id = window.setInterval(() => {
      setPage(rig.glass.page?.name ?? "");
      setBeeps(rig.beeps);
    }, 250);
    return () => window.clearInterval(id);
  }, [rig]);

  const view = { device, deviceId, monitorPxPerMm, housingColor, outlines };

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto" }}>
      <SelectorBar note={known ? `${name} · ${mm.widthMm.toFixed(1)} × ${mm.heightMm.toFixed(1)} mm` : "no generated project"}>
        <Picker
          label="Project"
          value={project?.id ?? ""}
          options={projects.map((p) => ({ id: p.id, label: p.name }))}
          onChange={onSelectProject}
        />
        <SegmentedControl options={DEVICE_OPTIONS} value={deviceId} onChange={onSetDeviceId} />
        <ToggleButton pressed={outlines} onChange={setOutlines}>Touch areas</ToggleButton>
        <button
          type="button"
          title="Power the room off and on: the panel and the bridge keep their flash"
          onClick={() => setBoots((n) => n + 1)}
          style={{ appearance: "none", background: chrome.color.surfaceRaised, color: chrome.color.text, border: `1px solid ${chrome.color.borderStrong}`, borderRadius: chrome.radius.sm, padding: `${chrome.space.xs}px ${chrome.space.md}px`, cursor: "pointer" }}
        >
          Restart
        </button>
        <button
          type="button"
          title="Wipe the flash of both: the panel boots as it is flashed, with an empty Home, and the bridge from its box"
          onClick={() => {
            Rig.forget(name);
            setBoots((n) => n + 1);
          }}
          style={{ appearance: "none", background: "transparent", color: chrome.color.danger, border: `1px solid ${chrome.color.danger}`, borderRadius: chrome.radius.sm, padding: `${chrome.space.xs}px ${chrome.space.md}px`, cursor: "pointer" }}
        >
          Reset flash
        </button>
        {page && <Badge tone="neutral">{`page ${page}`}</Badge>}
        {beeps > 0 && <Badge tone="warn">{`${beeps} beep${beeps === 1 ? "" : "s"}`}</Badge>}
      </SelectorBar>

      {!known && project && (
        <div style={{ ...notice, borderColor: chrome.color.warn }}>
          {project.name} has no generated project for {deviceId}: run{" "}
          <code>node export/scripts/build-project-hmi.mjs {project.id} {deviceId}</code> in libs/nspanel-sim.
        </div>
      )}
      {problem && <div style={{ ...notice, borderColor: chrome.color.danger }}>{problem}</div>}

      {rig && project && (
        <>
          {/* Side by side while the window has the room, one over the other
              when it does not. The titles are one line each, so the two
              panels start level whatever the notes under them say. */}
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: `${chrome.space.xl}px ${chrome.space.xxl * 2}px` }}>
            <Column title="Real" note="The compiled pages on the emulated Nextion: what the .tft draws, in RGB565.">
              <GlassView {...view} rig={rig} />
            </Column>
            <Column title="React" note="The project's React components, showing what the glass holds.">
              <ReactPanelView {...view} rig={rig} project={project} />
            </Column>
          </div>

          <div style={{ margin: `${chrome.space.lg}px 0 ${chrome.space.xl}px`, font: `${chrome.font.size.xs}px ${chrome.font.family}`, color: chrome.color.textFaint, textAlign: "center", lineHeight: 1.5 }}>
            {device.label} &middot; {device.visibleWidthPx} &times; {device.heightPx} px visible of {device.widthPx} &times; {device.heightPx} &middot;{" "}
            {mm.widthMm.toFixed(1)} &times; {mm.heightMm.toFixed(1)} mm
            <br />
            The buttons under the glass are the panel&apos;s: held while the mouse is down, and the dot is the relay each one
            switches. A decoupled button toggles its relay after 4 s held (the panel&apos;s button driver).
          </div>

          {/* What an engineer in the room would have: the log and the UART,
              each device's console, the bridge, and its network with the lamps. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: chrome.space.md, alignItems: "flex-start" }}>
            <div style={{ flex: "3 1 420px", minWidth: 0 }}>
              <LogControls rig={rig} />
            </div>
            <div style={{ flex: "2 1 300px", minWidth: 0, display: "grid", gap: chrome.space.md }}>
              <ConsoleControls rig={rig} />
              <BridgeControls rig={rig} />
              <NetworkControls rig={rig} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** one view of the panel: its name over it, and what it is under it */
function Column({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    // as wide as its panel: the note wraps under it rather than widening the column
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "min-content" }}>
      <div style={{ marginBottom: chrome.space.sm, font: `${chrome.font.weight.medium} ${chrome.font.size.md}px ${chrome.font.family}`, color: chrome.color.text }}>
        {title}
      </div>
      {children}
      <div style={{ marginTop: chrome.space.md, font: `${chrome.font.size.xs}px ${chrome.font.family}`, color: chrome.color.textFaint, textAlign: "center" }}>
        {note}
      </div>
    </div>
  );
}

const notice = {
  background: chrome.color.surface,
  border: "1px solid",
  borderRadius: chrome.radius.sm,
  padding: chrome.space.md,
  marginBottom: chrome.space.xl,
  font: `${chrome.font.size.sm}px ${chrome.font.mono}`,
} as const;
