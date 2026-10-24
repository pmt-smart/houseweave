import { useState, type CSSProperties } from "react";
import { Section, Field, Mono, Badge, Hint } from "./chrome";
import { chrome } from "./chromeTokens";
import { sendJson, useHouse, when, type FleetNode, type KeptBackup } from "./houseApi";

// House, running the house: its nodes as HouseWeave's server knows them (each one's state, the backup the server keeps of it, and
// Backup, Upgrade and State for a node or for all, and Restore for one), the night's round as it runs (its time is a setting, SettingsTab), the backups
// the server keeps with the hardware swap (an old node's backup given to a new one), and the releases it serves to the nodes.

const VERBS = ["backup", "upgrade", "state"] as const;
const ROLES: Record<number, string> = { 1: "Bridge", 2: "Panel", 3: "Server" };

/** what a node said to the last thing asked of it, in a few words: the round's answer is its backup's, and the node it came through when the server
 * did not reach it */
const answered = (d: FleetNode["did"]) => {
  if (!d) return "";
  const { v: _v, node: _n, verb: _verb, state: _s, ...rest } = d.answer;
  const words = Object.entries(rest).map(([k, x]) => (k === d.verb ? String(x) : `${k} ${String(x)}`));
  const via = d.via !== undefined ? ` (through node ${d.via})` : "";
  return `${d.verb}: ${words.length > 0 ? words.join(", ") : "ok"}${via}, ${new Date(d.at).toLocaleTimeString()}`;
};

const input: CSSProperties = {
  font: `${chrome.font.size.md}px ${chrome.font.family}`,
  color: chrome.color.text,
  background: chrome.color.bg,
  border: `1px solid ${chrome.color.border}`,
  borderRadius: 6,
  padding: `${chrome.space.xs}px ${chrome.space.sm}px`,
  width: 200,
};
const button: CSSProperties = { ...input, width: "auto", cursor: "pointer" };
const cell: CSSProperties = { padding: `${chrome.space.xs}px ${chrome.space.md}px ${chrome.space.xs}px 0`, textAlign: "left" };

export function HouseTab() {
  const { status, index, fleet, problem, load } = useHouse();
  const [asking, setAsking] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [giveTo, setGiveTo] = useState<Record<string, string>>({});

  /** a verb for one node, or for all (n null): the server calls the node, which answers at once */
  const ask = async (verb: string, n: number | null) => {
    if (n === null && verb === "upgrade" && !window.confirm("Upgrade every node whose build is not the server's? Each restarts into its safeboot and takes its image.")) return;
    setAsking(`${verb} ${n ?? "all"}`);
    try {
      await fetch(n === null ? `api/all/${verb}` : `api/node/${n}/${verb}`, { method: "POST" });
      await load();
    } finally {
      setAsking(null);
    }
  };

  /** a node's own last backup, back on it: it restarts with it */
  const restore = async (f: FleetNode) => {
    if (!window.confirm(`Node ${f.node} (${f.name}) restarts with its last backup on the server, the Tasmota settings included. What changed since it is lost.`)) return;
    await ask("restore", f.node);
  };

  /** the hardware swap: a backup given to a node of its kind, which restores it */
  const give = async (b: KeptBackup) => {
    const to = Number(giveTo[b.mac]);
    const n = fleet?.nodes.find((x) => x.node === to);
    if (!n) return;
    if (!window.confirm(`Node ${n.node} (${n.name}) restarts with the configuration and the Tasmota settings of ${b.mac}. Its own backup is kept, and its Restore brings it back.`)) return;
    setAsking(`replace ${b.mac}`);
    try {
      const a = await sendJson<{ error?: string }>("POST", "api/replace", { from: b.mac, to });
      setSaid(a.error ?? null);
      await load();
    } finally {
      setAsking(null);
    }
  };

  const house = status?.house ?? null;
  const images = Object.entries(index?.images ?? {});
  return (
    <div style={{ maxWidth: 820 }}>
      {problem && <Hint>{problem}</Hint>}
      {status && !house && <Hint>The server is in no house yet: pair it on a panel, in Settings.</Hint>}

      {house && (
        <Section
          title={`House: ${house.house}`}
          description={`Paired on ${house.panelHost} (node ${house.panel}) on ${new Date(house.paired).toLocaleString()}; this server is node ${house.node}. Each node's backup is kept here, by its radio address, with the nine before it.`}
        >
          <table style={{ borderCollapse: "collapse", font: `${chrome.font.size.md}px ${chrome.font.family}` }}>
            <thead>
              <tr>
                {["", "Node", "Build", "Seen", "Backup on the server", "Last asked", ""].map((h, i) => (
                  <th key={i} style={{ ...cell, color: chrome.color.textMuted, fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(fleet?.nodes ?? house.nodes.map(([n, role, name, ip]) => ({ node: n, role: (ROLES[role] ?? "").toLowerCase(), name, ip } as FleetNode))).map((f) => (
                <tr key={f.node}>
                  <td style={cell}>
                    <Mono>{f.node}</Mono>
                  </td>
                  <td style={cell}>
                    {f.name} <span style={{ color: chrome.color.textMuted }}>{f.role}</span>
                    <div>
                      <Mono>{f.ip}</Mono>
                    </div>
                  </td>
                  <td style={cell}>
                    <Mono>{f.state?.build ?? "—"}</Mono>
                  </td>
                  <td style={cell}>{f.seen ? `${when(f.seen)}${f.kind ? ` (${f.kind})` : ""}` : "—"}</td>
                  <td style={cell}>
                    {f.backup ? `${when(f.backup.at ? f.backup.at * 1000 : null)}, ${(f.backup.size / 1024).toFixed(1)} KB, ${f.backup.versions} kept` : "none"}
                    {f.state?.backup?.dirty && (
                      <div>
                        <Badge tone="warn">Not saved</Badge>
                      </div>
                    )}
                  </td>
                  <td style={cell}>{answered(f.did ?? null)}</td>
                  <td style={{ ...cell, whiteSpace: "nowrap" }}>
                    {VERBS.map((v) => (
                      <button key={v} style={{ ...button, marginRight: chrome.space.xs }} disabled={asking !== null || !!fleet?.running} onClick={() => void ask(v, f.node)}>
                        {v === "backup" ? "Backup" : v === "upgrade" ? "Upgrade" : "State"}
                      </button>
                    ))}
                    <button style={button} disabled={asking !== null || !!fleet?.running || !f.backup} onClick={() => void restore(f)}>
                      Restore
                    </button>
                    {f.swap && <div style={{ color: chrome.color.textMuted }}>{`taking the backup of ${f.swap.from}`}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Field label="All the nodes" hint="One after the other, a few seconds apart. Backup goes only for a node whose configuration changed since its last backup; Upgrade only for one whose build is not the server's.">
            {VERBS.map((v) => (
              <button key={v} style={{ ...button, marginRight: chrome.space.xs }} disabled={asking !== null || !!fleet?.running} onClick={() => void ask(v, null)}>
                {v === "backup" ? "Backup all" : v === "upgrade" ? "Upgrade all" : "State of all"}
              </button>
            ))}
            {fleet?.running && <span style={{ marginLeft: chrome.space.md }}>{`${fleet.running.verb}: ${fleet.running.done} of ${fleet.running.total}`}</span>}
          </Field>
          <Field label="The night's round" hint="Once a night, at the house's time (set in Settings), the server asks each node for its state, and a node whose configuration changed since its last backup backs up.">
            <span>{`At ${fleet?.round ?? "…"}. Last: ${when(fleet?.lastRound)}`}</span>
            <button style={{ ...button, marginLeft: chrome.space.md }} disabled={!!fleet?.running} onClick={() => void fetch("api/round/now", { method: "POST" }).then(load)}>
              Run now
            </button>
          </Field>
          {said && <Hint>{said}</Hint>}
        </Section>
      )}

      {house && (fleet?.backups?.length ?? 0) > 0 && (
        <Section
          title="Backups"
          description="Every backup the server keeps, by the radio address of its node, with the nine before it. A node that replaces another (a new panel or bridge in the house) is given the old one's backup here, and restarts with its configuration and its Tasmota settings; a bridge keeps its own Zigbee network."
        >
          <table style={{ borderCollapse: "collapse", font: `${chrome.font.size.md}px ${chrome.font.family}` }}>
            <thead>
              <tr>
                {["Radio address", "Kind", "Saved", "Node", "Give to"].map((h, i) => (
                  <th key={i} style={{ ...cell, color: chrome.color.textMuted, fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(fleet?.backups ?? []).map((b) => {
                const takers = (fleet?.nodes ?? []).filter((n) => n.role === b.kind && n.mac !== b.mac);
                return (
                  <tr key={b.mac}>
                    <td style={cell}>
                      <Mono>{b.mac}</Mono>
                    </td>
                    <td style={cell}>
                      {b.kind}
                      {b.project && <div style={{ color: chrome.color.textMuted }}>{b.project}</div>}
                    </td>
                    <td style={cell}>{when(b.at ? b.at * 1000 : null)}</td>
                    <td style={cell}>
                      {b.node !== null ? `node ${b.node}` : <Badge tone="warn">No node</Badge>}
                      {b.replaced && <div style={{ color: chrome.color.textMuted }}>{`given to node ${b.replaced.by}, ${when(b.replaced.at)}`}</div>}
                    </td>
                    <td style={{ ...cell, whiteSpace: "nowrap" }}>
                      <select style={{ ...input, width: 160 }} value={giveTo[b.mac] ?? ""} onChange={(e) => setGiveTo({ ...giveTo, [b.mac]: e.target.value })}>
                        <option value="">a node of its kind…</option>
                        {takers.map((n) => (
                          <option key={n.node} value={n.node}>{`${n.node} ${n.name}`}</option>
                        ))}
                      </select>
                      <button style={{ ...button, marginLeft: chrome.space.xs }} disabled={!giveTo[b.mac] || asking !== null || !!fleet?.running} onClick={() => void give(b)}>
                        Give
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      )}

      <Section
        title="Releases"
        description="What the nodes upgrade to, from their Wireless settings or from here: published with node scripts/ota-release.mjs publish <image.bin>... --to <folder>/ota, signed with the house's key."
      >
        {images.length === 0 && <Hint>No release published.</Hint>}
        {images.length > 0 && (
          <table style={{ borderCollapse: "collapse", font: `${chrome.font.size.md}px ${chrome.font.family}` }}>
            <tbody>
              {images.map(([image, r]) => (
                <tr key={image}>
                  <td style={cell}>{image.replace("tasmota32-houseweave-", "")}</td>
                  <td style={cell}>
                    <Mono>{r.build}</Mono>
                  </td>
                  <td style={cell}>{r.date.replace("T", " ")}</td>
                  <td style={cell}>{(r.size / 1024).toFixed(0)} KB</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Field label="Safeboot image" hint="The one that takes a release, over HTTP or from a neighbour over the mesh: written by the node's app before an upgrade.">
          <Mono>{index?.safeboot ? `${index.safeboot.build}, ${(index.safeboot.size / 1024).toFixed(0)} KB` : "none published"}</Mono>
        </Field>
      </Section>
    </div>
  );
}
