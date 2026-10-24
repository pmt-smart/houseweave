import { useEffect, useState, type CSSProperties } from "react";
import { Section, Field, Mono, Badge, Hint } from "./chrome";
import { chrome } from "./chromeTokens";
import { sendJson, useHouse, type House } from "./houseApi";

// The server's part of Settings: HouseWeave's server itself (its identity and the address the nodes reach it at), its pairing with a
// house (the panel's address and the code its Add server shows), and the time of the night's round, which House runs.

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

export function ServerSettings() {
  const { status, fleet, problem, load } = useHouse();
  const [panel, setPanel] = useState("");
  const [code, setCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [round, setRound] = useState("");
  useEffect(() => {
    if (fleet) setRound((r) => (r === "" ? fleet.round : r));
  }, [fleet]);

  const pair = async () => {
    setPairing(true);
    setSaid(null);
    try {
      const a = await sendJson<House & { error?: string }>("POST", "api/pair", { panel, code });
      setSaid(a.error ? a.error : `In ${a.house}, as node ${a.node}.`);
      if (!a.error) setCode("");
      await load();
    } catch (e) {
      setSaid((e as Error).message);
    } finally {
      setPairing(false);
    }
  };

  const saveRound = async () => {
    const a = await sendJson<{ round?: string; error?: string }>("PUT", "api/round", { time: round });
    setSaid(a.error ?? null);
    await load();
  };

  const house = status?.house ?? null;
  return (
    <div style={{ maxWidth: 820 }}>
      {problem && <Hint>{problem}</Hint>}
      <Section title="Server" description="HouseWeave's server, which keeps the nodes' backups and serves their releases. It is a member of the house, paired on a panel.">
        <Field label="Identity" hint="Its X25519 public key: its credential in the house's list.">
          <Mono>{status ? status.key : "…"}</Mono>
        </Field>
        <Field label="Address" hint="Where the nodes reach it: SERVER_HOST, Home Assistant's, or this machine's on the panel's network when it pairs.">
          <Mono>{status?.address ? `${status.address.host}:${status.address.port}` : "chosen when it pairs"}</Mono>
        </Field>
        <Field label="House">{house ? <Badge tone="ok">{house.house}</Badge> : <Badge>Not paired</Badge>}</Field>
      </Section>

      <Section
        title="Pair with a house"
        description="On a panel of the house: the mesh's +, then Add server. Type its address and the code it shows; the code proves the panel and never goes on the network."
      >
        <Field label="Panel's address">
          <input style={input} value={panel} placeholder="192.168.2.113" onChange={(e) => setPanel(e.target.value.trim())} />
        </Field>
        <Field label="Code">
          <input style={input} value={code} placeholder="6 digits" inputMode="numeric" maxLength={7} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
        </Field>
        <Field label="">
          <button style={button} disabled={pairing || code.length !== 6 || panel === ""} onClick={() => void pair()}>
            {pairing ? "Pairing…" : "Pair"}
          </button>
          {said && <span style={{ marginLeft: chrome.space.md }}>{said}</span>}
        </Field>
      </Section>

      {house && (
        <Section title="The night's round" description="Once a night, at this time of the house, the server asks each node for its state, and a node whose configuration changed since its last backup backs up. Nothing else runs by itself.">
          <Field label="Time">
            <input style={{ ...input, width: 80 }} value={round} placeholder="02:00" onChange={(e) => setRound(e.target.value.trim())} />
            <button style={{ ...button, marginLeft: chrome.space.xs }} disabled={!/^([01]\d|2[0-3]):[0-5]\d$/.test(round) || round === fleet?.round} onClick={() => void saveRound()}>
              Save
            </button>
          </Field>
        </Section>
      )}
    </div>
  );
}
