// What an engineer in the room would see: the bridge with its button and its
// LED, the Zigbee network with its lamps, each device's Tasmota console and the
// log of both, and the UART. The panel's two physical buttons are on the housing
// itself (Enclosure.tsx), as on the wall.
//
// Every control acts where the hardware would: the bridge's button held is the
// rules' Button1 as Tasmota gives it, a lamp, a thermostat or a blind that joins
// announces itself the way Z2T reports one, a thermostat's dial turned or a blind's
// wall key pressed reports as the device would, a console line is a Tasmota
// command. None of them reaches into either device's Berry.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Rig } from "./rig";
import { Badge, SegmentedControl } from "./chrome";
import { chrome } from "./chromeTokens";
import { useRigTick } from "./panelHooks";

const box = {
  background: chrome.color.surface,
  border: `1px solid ${chrome.color.border}`,
  borderRadius: chrome.radius.md,
  padding: chrome.space.md,
} as const;

const title = { font: `${chrome.font.weight.bold} ${chrome.font.size.sm}px ${chrome.font.family}`, color: chrome.color.textMuted, marginBottom: chrome.space.sm } as const;

const button = {
  appearance: "none" as const,
  background: chrome.color.surfaceRaised,
  color: chrome.color.text,
  border: `1px solid ${chrome.color.borderStrong}`,
  borderRadius: chrome.radius.sm,
  padding: `${chrome.space.xs}px ${chrome.space.md}px`,
  font: `${chrome.font.weight.medium} ${chrome.font.size.sm}px ${chrome.font.family}`,
  cursor: "pointer",
  userSelect: "none" as const,
};

function Panel({ label, children, right }: { label: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div style={box}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={title}>{label}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

/**
 * The bridge: its LED, which blinks while its pairing window is open, the
 * network it is on, and its button, held 5 s to open the window again.
 */
export function BridgeControls({ rig }: { rig: Rig }) {
  useRigTick(rig, 4);
  const b = rig.bridge;
  const ssid = b.wifi.ssid[0];
  const led = b.blinking() ? "blinking" : b.led === 0 ? "on" : "off";
  return (
    <Panel label={`Bridge: ${b.hostname}`} right={<Badge tone={led === "blinking" ? "ok" : "neutral"}>{`LED ${led}`}</Badge>}>
      <div style={{ display: "flex", gap: chrome.space.sm, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" style={button} title="As its button held 5 s: the pairing window opens for 2 min" onClick={() => b.holdButton()}>
          Hold the button 5 s
        </button>
        <span style={{ font: `${chrome.font.size.xs}px ${chrome.font.mono}`, color: chrome.color.textMuted }}>
          {ssid ? `Wi-Fi ${ssid}` : "no network saved"}
        </span>
      </div>
    </Panel>
  );
}

/** a small key beside a device of the list, for what is done to it from outside */
const key = { ...button, padding: `0 ${chrome.space.xs}px`, font: `${chrome.font.size.xs}px ${chrome.font.mono}` };

/** tenths of a degree, as the device's own display shows them */
const degrees = (tenths: number) => `${(tenths / 10).toFixed(1)}°`;

/**
 * The devices of the bridge's network, as Z2T would list them, and a new one to pair while the panel searches: a lamp,
 * the Moes ZHT-SR thermostat or the Moes Star Ring blind. A thermostat's row has what is done to it
 * in the room: its dial turned, the room warmer or cooler, and its own power key; a blind's, the three keys of its wall
 * switch. The device reports each, as the real one would.
 */
export function NetworkControls({ rig }: { rig: Rig }) {
  useRigTick(rig, 3);
  const z = rig.bridge.zigbee;
  const searching = z.permitUntil > rig.house.now;
  return (
    <Panel
      label={`Zigbee: ${z.devices.filter((d) => d.joined).length} devices`}
      right={searching ? <Badge tone="ok">pairing open</Badge> : undefined}
    >
      <div style={{ display: "flex", gap: chrome.space.sm, marginBottom: chrome.space.sm }}>
        <button
          type="button"
          style={{ ...button, opacity: searching ? 1 : 0.5 }}
          disabled={!searching}
          onClick={() => z.join({ ieee: z.freshIeee(), model: "TS0505B", caps: 15, ct: [153, 500], endpoint: 1, relay: 0 })}
        >
          A new lamp joins
        </button>
        <button
          type="button"
          style={{ ...button, opacity: searching ? 1 : 0.5 }}
          disabled={!searching}
          title="A Moes ZHT-SR, a Tuya thermostat, factory fresh"
          onClick={() => z.joinThermostat({ ieee: z.freshIeee(), profile: "tuya" })}
        >
          A thermostat joins
        </button>
        <button
          type="button"
          style={{ ...button, opacity: searching ? 1 : 0.5 }}
          disabled={!searching}
          title="A Moes Star Ring, a Tuya blind switch, factory fresh, on a blind half open"
          onClick={() => z.joinCover({ ieee: z.freshIeee(), profile: "tuya", pos: 50 })}
        >
          A blind joins
        </button>
        <button
          type="button"
          style={{ ...button, opacity: searching ? 1 : 0.5 }}
          disabled={!searching}
          title="A Tuya two-channel relay module, a TS0002, factory fresh: two channels, each a device on the panel"
          onClick={() => z.joinSwitch({ ieee: z.freshIeee(), channels: 2 })}
        >
          A switch joins
        </button>
      </div>
      <div style={{ maxHeight: 220, overflowY: "auto", font: `${chrome.font.size.xs}px ${chrome.font.mono}` }}>
        {z.devices.map((d) => {
          const t = d.thermo;
          const c = d.cover;
          const lit = (t ? t.mode === 4 : c ? c.dir !== 0 : d.power) && d.powered;
          return (
            <div key={d.ieee + "/" + d.endpoint} style={{ display: "flex", gap: chrome.space.sm, alignItems: "center", color: !d.joined ? chrome.color.textFaint : d.powered ? chrome.color.text : chrome.color.warn }}>
              <span style={{ color: lit ? (t && t.cur < t.set ? "#ff6b2c" : "#ffd54a") : chrome.color.textFaint }}>{lit ? "●" : "○"}</span>
              <span>{d.ieee.slice(-6)}</span>
              {c ? (
                <>
                  <span>{d.powered ? `blind ${Math.round(c.pos)}% open, ${c.dir > 0 ? "going up" : c.dir < 0 ? "going down" : "standing"}` : "no power"}</span>
                  {d.joined && d.powered && (
                    <span style={{ display: "inline-flex", gap: 2 }}>
                      <button type="button" style={key} title="Its wall switch's open key" onClick={() => z.coverKey(d.ieee, "up")}>▲</button>
                      <button type="button" style={key} title="Its wall switch's stop key" onClick={() => z.coverKey(d.ieee, "stop")}>■</button>
                      <button type="button" style={key} title="Its wall switch's close key" onClick={() => z.coverKey(d.ieee, "down")}>▼</button>
                    </span>
                  )}
                </>
              ) : t ? (
                <>
                  <span>{d.powered ? `${degrees(t.cur)} → ${degrees(t.set)}, floor ${degrees(t.floor)}, ${t.mode !== 4 ? "off" : t.cur < t.set ? "heating" : "resting"}` : "no power"}</span>
                  {d.joined && d.powered && (
                    <span style={{ display: "inline-flex", gap: 2 }}>
                      <button type="button" style={key} title="Its dial turned down half a degree" onClick={() => z.thermostat(d.ieee, { set: Math.max(50, t.set - 5) })}>dial−</button>
                      <button type="button" style={key} title="Its dial turned up half a degree" onClick={() => z.thermostat(d.ieee, { set: Math.min(350, t.set + 5) })}>dial+</button>
                      <button type="button" style={key} title="The room half a degree cooler" onClick={() => z.thermostat(d.ieee, { cur: t.cur - 5 })}>room−</button>
                      <button type="button" style={key} title="The room half a degree warmer" onClick={() => z.thermostat(d.ieee, { cur: t.cur + 5 })}>room+</button>
                      <button type="button" style={key} title="Its own power key" onClick={() => z.thermostat(d.ieee, { on: t.mode !== 4 })}>⏻</button>
                    </span>
                  )}
                </>
              ) : d.config[0]?.startsWith("O") ? (
                <>
                  <span>{d.powered ? `channel ${d.endpoint}, ${d.power ? "on" : "off"}` : "no power"}</span>
                  {d.joined && d.powered && (
                    <button type="button" style={key} title="Its key on the module" onClick={() => z.switchKey(d.ieee, d.endpoint)}>⏻</button>
                  )}
                  <span style={{ color: chrome.color.textFaint }}>{d.groups.length ? `g${d.groups.join(",g")}` : ""}</span>
                </>
              ) : (
                <>
                  <span>{d.relay ? `relay ${d.relay}` : "mains"}</span>
                  <span>{d.powered ? `${Math.round((d.dimmer / 254) * 100)}%` : "no power"}</span>
                  <span style={{ color: chrome.color.textFaint }}>{d.groups.length ? `g${d.groups.join(",g")}` : ""}</span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

type ConsoleOf = "panel" | "bridge";

/** Tasmota's console, of the panel or of the bridge: a command line, and what came back. */
export function ConsoleControls({ rig }: { rig: Rig }) {
  const [line, setLine] = useState("");
  const [of, setOf] = useState<ConsoleOf>("panel");
  const [history, setHistory] = useState<string[]>([]);
  const run = () => {
    const cmd = line.trim();
    if (!cmd) return;
    const answer = (of === "bridge" ? rig.bridge : rig.panel).console(cmd);
    setHistory((h) => [...h.slice(-30), `${of === "bridge" ? "bridge" : ""}> ${cmd}`, answer ?? "(no answer)"]);
    setLine("");
  };
  return (
    <Panel
      label="Console"
      right={<SegmentedControl options={[{ id: "panel", label: "Panel" }, { id: "bridge", label: "Bridge" }]} value={of} onChange={setOf} />}
    >
      <div style={{ maxHeight: 120, overflowY: "auto", font: `${chrome.font.size.xs}px ${chrome.font.mono}`, color: chrome.color.textMuted, marginBottom: chrome.space.sm }}>
        {history.map((h, i) => <div key={i}>{h}</div>)}
      </div>
      <input
        value={line}
        onChange={(e) => setLine(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && run()}
        placeholder="a Tasmota command: Power1 toggle, ButtonDecouple, ZbInfo, Nextion page settings"
        style={{ width: "100%", boxSizing: "border-box", background: chrome.color.surfaceSunken, color: chrome.color.text, border: `1px solid ${chrome.color.border}`, borderRadius: chrome.radius.sm, padding: chrome.space.sm, font: `${chrome.font.size.sm}px ${chrome.font.mono}` }}
      />
    </Panel>
  );
}

type LogView = "log" | "wire" | "glass";

/** The log of Tasmota on the panel and on the bridge, the UART both ways, and what the glass refused. */
export function LogControls({ rig }: { rig: Rig }) {
  useRigTick(rig, 4);
  const [view, setView] = useState<LogView>("log");
  const [debug, setDebug] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const lines = view === "log"
    ? rig.log.filter((l) => debug || l.level <= 2).map((l) => ({ at: l.at, from: l.from, text: l.text, tone: l.level <= 1 ? chrome.color.danger : chrome.color.textMuted }))
    : view === "wire"
      ? rig.wire.map((w) => ({ at: w.at, text: `${w.dir === "tx" ? "→" : "←"} ${w.text}`, tone: w.dir === "tx" ? chrome.color.textMuted : chrome.color.accent }))
      : rig.glassNotes.map((g) => ({ at: g.at, text: g.text, tone: chrome.color.warn }));
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [lines.length]);
  return (
    <Panel
      label="Log"
      right={
        <div style={{ display: "flex", gap: chrome.space.sm, alignItems: "center" }}>
          {view === "log" && (
            <label style={{ font: `${chrome.font.size.xs}px ${chrome.font.family}`, color: chrome.color.textMuted }}>
              <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} /> debug
            </label>
          )}
          <SegmentedControl
            options={[{ id: "log", label: "Tasmota" }, { id: "wire", label: "UART" }, { id: "glass", label: `Glass${rig.glassNotes.length ? ` (${rig.glassNotes.length})` : ""}` }]}
            value={view}
            onChange={setView}
          />
        </div>
      }
    >
      <div style={{ height: 260, overflowY: "auto", font: `${chrome.font.size.xs}px ${chrome.font.mono}`, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
        {lines.map((l, i) => (
          <div key={i} style={{ color: l.tone }}>
            <span style={{ color: chrome.color.textFaint }}>{(l.at / 1000).toFixed(2).padStart(8, " ")} </span>
            {"from" in l && l.from && <span style={{ color: chrome.color.accent }}>{`${l.from} `}</span>}
            {l.text}
          </div>
        ))}
        <div ref={end} />
      </div>
    </Panel>
  );
}
