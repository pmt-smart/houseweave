// The house's server in a simulated house: ha/houseweave/server/house-fleet.mjs over a store in memory, with its identity and its
// house in a folder of the test's (house-pairing.mjs), served on the house's network, paired on a panel as the owner pairs it -- the Add server
// window's code, and the server's request to the panel's /houseweave/pair -- and calling the nodes at their /houseweave/do, as release-server.mjs does.
import assert from "node:assert/strict";
import { createPublicKey, diffieHellman, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFleet } from "../../../../ha/houseweave/server/house-fleet.mjs";
import { house as kept, identity, pair } from "../../../../ha/houseweave/server/house-pairing.mjs";

/** a Berry expression on a device, as JSON */
function probe(dev, expr) {
  assert.equal(dev.vm.run(`import global
import json
def _probe() return json.dump(${expr}) end`, "probe"), 0, dev.vm.error());
  return JSON.parse(dev.vm.call("_probe"));
}

/** a device's answer to a post: its JSON, as release-server.mjs reads it */
const answerOf = (r) => JSON.parse(r.body ?? "null");

/**
 * The server at ip:port in `home`, paired on `panel`: {fleet, files, log, dir, node(device)}. `run(ms)` runs the house, for the pause between two nodes
 * in a round and while a request relayed over the mesh waits for its answer. The server's clock is the panel's: the house's time. The server calls no
 * device whose address is in `unreachable` (a node behind another router, or with no Wi-Fi).
 */
export async function houseServer(home, panel, { ip = "192.168.0.10", port = 8080, run, unreachable = new Set() } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "house-server-"));
  const me = identity(dir);
  const files = new Map();
  // the panel's clock, as the house's: its Unix time less the house's run
  const epochMs = probe(panel, "tasmota.rtc()['utc']") * 1000 - Math.floor(home.now / 1000) * 1000;
  const fleet = createFleet({
    shared: (pub) => {
      try {
        const spki = Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), Buffer.from(pub)]);
        return new Uint8Array(diffieHellman({ privateKey: me.key, publicKey: createPublicKey({ key: spki, format: "der", type: "spki" }) }));
      } catch {
        return null;
      }
    },
    random: (n) => new Uint8Array(randomBytes(n)),
    store: { get: (rel) => files.get(rel), put: (rel, bytes) => files.set(rel, new Uint8Array(bytes)),
             list: (prefix) => [...files.keys()].filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/")) },
    house: () => kept(dir),
    post: async (url, body) => {
      const d = home.devices.find((x) => x.ip === new URL(url).hostname);
      if (!d || unreachable.has(d.ip)) throw new Error(`nothing at ${url}`);
      return answerOf(d.web(new URL(url).pathname, [["plain", JSON.stringify(body)]], "POST"));
    },
    now: () => epochMs + home.now,
    minutes: (ms) => {
      const d = new Date(ms);
      return d.getUTCHours() * 60 + d.getUTCMinutes();
    },
    wait: async (ms) => run?.(ms),
  });
  const log = home.serve(ip, port, (req) => fleet.handleNode(req) ?? { status: 404, body: "not found\n" });
  // the window on the panel, as Add server opens it, and the code it shows
  const view = "global.panel_ui.provider_of('house', nil).server";
  probe(panel, `${view}.open()`);
  const code = probe(panel, `${view}.code`);
  const house = await pair({
    panel: panel.ip, code, dir, address: { host: ip, port },
    post: async (url, body) => answerOf(panel.web(new URL(url).pathname, [["plain", JSON.stringify(body)]], "POST")),
  });
  assert.ok(!house.error, `the server paired on the panel: ${house.error}`);
  return {
    fleet, files, log, dir, house,
    /** a device's number in the house, as the server knows it */
    node: (dev) => probe(dev, "global.contains('house') && global.house != nil ? global.house.list.me : (global.contains('zbbridge_relay') ? global.zbbridge_relay.house.list.me : 0)"),
    /** the server's copy of a device's backup, by its radio address, or undefined */
    backupOf: (dev) => {
      const b = files.get(`backups/${dev.mac.replaceAll(":", "").toLowerCase()}.json`);
      return b === undefined ? undefined : JSON.parse(new TextDecoder().decode(b));
    },
  };
}
