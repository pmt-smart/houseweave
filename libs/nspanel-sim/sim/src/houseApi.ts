import { useCallback, useEffect, useState } from "react";

// HouseWeave's server, as the app asks it: the server's identity and its house (/api/status), the fleet of the
// house's nodes (/api/fleet) and the releases it serves (ota/index.json), at relative addresses. On this machine the dev server hands them to the
// app's port of the server running here (vite.config.ts); in Home Assistant the server serves this app on that port itself, through the ingress.

export interface Status {
  key: string;
  address: { host: string; port: number } | null;
  house: House | null;
}
export interface House {
  node: number;
  house: string;
  panel: number;
  panelHost: string;
  nodes: [number, number, string, string][];
  paired: string;
}
export interface Release {
  path: string;
  build: string;
  size: number;
  date: string;
  /** a release written under an image's former name: the image it is (scripts/ota-release.mjs, FORMER_IMAGES) */
  of?: string;
}
export interface Index {
  images?: Record<string, Release>;
  safeboot?: Release;
}
/** a node as the server knows it (ha/houseweave/server/house-fleet.mjs, GET /api/fleet) */
export interface FleetNode {
  node: number;
  role: string;
  name: string;
  ip: string;
  mac: string;
  seen: number | null;
  kind: string | null;
  state: { role?: string; image?: string; build?: string; date?: string; backup?: { at: number | null; dirty: boolean } | null } | null;
  did: { verb: string; at: number; answer: Record<string, unknown> & { error?: string }; via?: number } | null;
  backup: { at: number | null; size: number; versions: number } | null;
  /** a hardware swap the node is in: the radio address of the backup it was given */
  swap: { from: string; at: number } | null;
}
/** a backup the server keeps, by its radio address */
export interface KeptBackup {
  mac: string;
  kind: string;
  project: string | null;
  at: number | null;
  node: number | null;
  replaced: { by: number; at: number } | null;
}
export interface Fleet {
  round: string;
  lastRound: number | null;
  running: { verb: string; done: number; total: number } | null;
  nodes: FleetNode[];
  backups?: KeptBackup[];
}

export const when = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString() : "—");

export async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return (await r.json()) as T;
}

/** a request to the server with a JSON body: its answer's JSON */
export async function sendJson<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return (await r.json()) as T;
}

/** What the server says of itself, of the house and of the releases, asked again every 5 s while a view that shows it is open */
export function useHouse() {
  const [status, setStatus] = useState<Status | null>(null);
  const [index, setIndex] = useState<Index | null>(null);
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setStatus(await getJson<Status>("api/status"));
      setProblem(null);
    } catch (e) {
      setProblem(`HouseWeave's server does not answer at /api (${(e as Error).message}): start it, node ha/houseweave/server/release-server.mjs <folder> 8080 8099.`);
    }
    try {
      setIndex(await getJson<Index>("ota/index.json"));
    } catch {
      setIndex(null);
    }
    try {
      setFleet(await getJson<Fleet>("api/fleet"));
    } catch {
      setFleet(null);
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);
  return { status, index, fleet, problem, load };
}
