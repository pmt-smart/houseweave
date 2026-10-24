// A Tasmota on 127.0.0.1, for the bench scripts' tests: no test talks to a real device.
//
// It answers like the console over HTTP does (/cm?cmnd=), keeps the Referer rule (a request without the
// device's own address in it gets no answer, as in HttpCheckPriviledgedAccess), can ask for a password, and
// models just enough of what the scripts look at:
//   - Status 0, 4 and 11, with a boot count and an uptime that restart when the device is powered again;
//   - a Zigbee coordinator: ZbSend {"Device":...,"Send":{"Power":n}} with a latency and a loss rule, ZbStatus3;
//   - a panel: `Br global.zb_bridge.send(...)`, `Br global.plan.on_tap(n)` and the view of its devices
//     (live and doubt, the "?"), with the pending time of the real plan (2 s);
//   - the ESP-NOW mesh: EspNowMeshSend and the counters of EspNowMeshStatus, to a peer mock;
//   - an outlet: Power<n> ON/OFF, which takes the devices it powers off the air, and back after a boot time;
//   - the persist file and the saves a script makes in it (`bench_n`), which a power cut can corrupt;
//   - the file manager and the pages, including the hole of an upload that only the
//     Referer guards).
import http from "node:http";
import dgram from "node:dgram";

const MIME = { json: "application/json", html: "text/html" };

function ieeeOf(command) {
  return /"device"\s*:\s*"(0x[0-9a-f]+)"/i.exec(command)?.[1] ?? null;
}

function lowerKeys(value) {
  if (Array.isArray(value)) return value.map(lowerKeys);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k.toLowerCase(), lowerKeys(v)]));
  return value;
}

// a timer that does not keep the process alive: a mock that is closed leaves nothing behind
const later = (fn, ms) => {
  const t = setTimeout(fn, ms);
  t.unref();
  return t;
};

export async function startMock(options = {}) {
  const m = {
    name: options.name ?? "mock",
    alive: true,
    password: options.password === true,
    ufsuOpen: options.ufsuOpen === true, // the upload loop checks the Referer and not the password
    bootCount: 1,
    bootAt: Date.now(),
    heapKb: options.heapKb ?? 176,
    heapDropPerStatus: options.heapDropPerStatus ?? 0,
    version: options.version ?? "15.0.1.1",
    mode: options.mode ?? "tcp",
    lamps: {},
    sendLog: [],
    zbSends: 0,
    dropEvery: options.dropEvery ?? 0,
    latencyMs: options.latencyMs ?? 25,
    bridge: options.bridge ?? null, // a panel's bridge: another mock
    subscribers: [], // the panels that listen to this coordinator's reports
    linkDelayMs: options.linkDelayMs ?? 15,
    reportDelayMs: options.reportDelayMs ?? 15,
    pendingMs: options.pendingMs ?? 2000,
    taps: options.taps ?? {}, // glass point -> ieee
    view: { live: {}, doubt: {} },
    pendingTimers: new Set(),
    mesh: { peer: null, id: options.meshId ?? 1, sent: 0, Delivered: 0, AcksHeard: 0, GaveUp: 0, lossEvery: options.meshLossEvery ?? 0, delayMs: options.meshDelayMs ?? 20 },
    outlet: { powers: [], states: {}, bootDelayMs: options.bootDelayMs ?? 120 },
    persist: { bench_n: 0, keep: 1 },
    files: { "/_persist.json": JSON.stringify({ zb_bridge_mode: "tcp", panel_config: { v: 1 } }) },
    persistCorruptOnCut: options.persistCorruptOnCut ?? false,
    savingUntil: 0,
    uploads: [],
    requests: [],
    errorsOnBr: options.errorsOnBr === true,
    onCommand: null,
    rejectCommand: null, // (text) => true: answer this command with an error
  };
  for (const [ieee, power] of Object.entries(options.lamps ?? {})) m.lamps[ieee] = { power, latencyMs: m.latencyMs };
  m.persist = JSON.parse(m.files["/_persist.json"]);
  m.persist.bench_n = undefined;

  const diskPersist = () => {
    try {
      return JSON.parse(m.files["/_persist.json"]);
    } catch {
      return null;
    }
  };

  function setPower(ieee, power) {
    const lamp = m.lamps[ieee];
    if (!lamp) return;
    lamp.power = power;
  }

  /** What a ZbSend does at a coordinator: the lamp changes after its latency, unless the command is lost. */
  function zbSend(command, onApplied) {
    m.zbSends++;
    m.sendLog.push(command);
    if (m.dropEvery > 0 && m.zbSends % m.dropEvery === 0) return "dropped";
    const json = lowerKeys(JSON.parse(command.replace(/^ZbSend\s+/i, "")));
    const ieee = (json.device ?? "").toLowerCase();
    const key = Object.keys(m.lamps).find((k) => k.toLowerCase() === ieee);
    if (!key) return "unknown-device";
    const power = json.send?.power;
    if (power === undefined) return "no-power";
    later(() => {
      if (!m.alive) return;
      setPower(key, Number(power));
      onApplied?.(key, Number(power));
      // the lamp's report goes to every panel that listens, whoever asked
      for (const panel of m.subscribers) {
        later(() => {
          if (!panel.alive) return;
          panel.view.live[key] = Number(power) ? "on" : "off";
          delete panel.view.doubt[key];
        }, panel.reportDelayMs);
      }
    }, m.lamps[key].latencyMs);
    return "sent";
  }

  /** A panel forwards a command to its bridge; the lamp's report comes back and updates the view. */
  function panelSend(command) {
    const ieee = ieeeOf(command);
    const intent = /"power"\s*:\s*(\d)/i.exec(command)?.[1] === "1" ? "on" : "off";
    if (!m.bridge) return;
    later(() => {
      if (!m.alive || !m.bridge.alive) return;
      m.bridge.zbSend(command);
    }, m.linkDelayMs);
    if (ieee) {
      const timer = later(() => {
        m.pendingTimers.delete(timer);
        if (m.view.live[ieee] !== intent) m.view.doubt[ieee] = true;
      }, m.pendingMs);
      m.pendingTimers.add(timer);
    }
  }

  function brAnswer(expression) {
    if (m.errorsOnBr) return "[attribute_error] 'nil' object has no attribute 'zb_bridge'";
    if (expression === "tasmota.memory()") return `{'heap_free': ${m.heapKb}, 'frag': 34, 'iram_free': 57}`;
    if (expression.startsWith("(def () var l=global.plan.live var d=global.plan.")) {
      // the panel's view of some lamps: [live, flag, live, flag, ...]
      const ieees = [...expression.matchAll(/l\.find\("(0x[0-9A-Fa-f]{16})"\)/g)].map((x) => x[1]);
      const field = /var d=global\.plan\.([a-z_]+)/.exec(expression)[1];
      const flags = field === "doubt" ? m.view.doubt : m.view[field] ?? {};
      return `[${ieees.flatMap((i) => [m.view.live[i] ? `'${m.view.live[i]}'` : "nil", flags[i] ? "true" : "nil"]).join(", ")}]`;
    }
    const sends = [...expression.matchAll(/send\('((?:[^'\\]|\\.)*)'\)/g)].map((x) => x[1]);
    if (sends.length > 0 && /global\.zb_bridge/.test(expression)) {
      for (const s of sends) panelSend(s);
      return "nil";
    }
    const tap = /global\.plan\.on_tap\((\d+)\)/.exec(expression);
    if (tap) {
      const ieee = m.taps[tap[1]];
      if (!ieee) return "nil";
      const now = m.view.live[ieee] ?? (m.bridge?.lamps[ieee]?.power ? "on" : "off");
      const power = now === "on" ? 0 : 1;
      panelSend(`ZbSend {"Device":"${ieee}","Send":{"Power":${power}}}`);
      return power ? "'on'" : "'off'";
    }
    if (/persist\.save\(\)/.test(expression) && /bench_n/.test(expression)) {
      if (/persist\.remove\("bench_n"\)/.test(expression)) {
        const disk = diskPersist() ?? {};
        delete disk.bench_n;
        m.files["/_persist.json"] = JSON.stringify(disk);
        m.persist.bench_n = undefined;
        return "nil";
      }
      m.persist.bench_n = (m.persist.bench_n ?? 0) + 1;
      m.savingUntil = Date.now() + 15;
      const disk = diskPersist() ?? {};
      disk.bench_n = m.persist.bench_n;
      m.files["/_persist.json"] = JSON.stringify(disk);
      return String(m.persist.bench_n);
    }
    if (/persist\.find\("bench_n", -1\)/.test(expression)) return String(m.persist.bench_n ?? -1);
    return "nil";
  }

  function statusSts() {
    m.heapKb -= m.heapDropPerStatus;
    return { Time: new Date().toISOString().slice(0, 19), Uptime: "0T00:00:10", UptimeSec: Math.floor((Date.now() - m.bootAt) / 1000), Heap: m.heapKb, SleepMode: "Dynamic", Sleep: 50, LoadAvg: 19, MqttCount: 0, Wifi: { AP: 1, SSId: "bench", Channel: 6, RSSI: 62, Signal: -69, LinkCount: 1 } };
  }

  function command(text) {
    m.onCommand?.(text);
    if (m.rejectCommand?.(text)) return { Command: "Error" };
    const [word, ...rest] = text.trim().split(/\s+/);
    const arg = rest.join(" ");
    const w = word.toLowerCase();
    if (w === "status") {
      if (arg === "11") return { StatusSTS: statusSts() };
      if (arg === "4") return { StatusMEM: { ProgramSize: 1500, Free: 700, Heap: m.heapKb, ProgramFlashSize: 2176, FlashSize: 4096 } };
      const prm = { Baudrate: 115200, OtaUrl: "", RestartReason: "Power On", Uptime: "0T00:00:10", StartupUTC: "2026-10-12T10:00:00", Sleep: 50, BootCount: m.bootCount, SaveCount: 12 };
      if (arg === "1") return { StatusPRM: prm };
      if (arg === "12") return { StatusSTK: { Reason: "Power On", Exception: 0 } };
      if (arg === "0") return { Status: { Module: 0, Topic: m.name }, StatusPRM: prm, StatusFWR: { Version: m.version, BuildDateTime: "2026-10-12T09:00:00" }, StatusLOG: { SysLog: 2, LogHost: "", LogPort: 514 }, StatusMEM: { Heap: m.heapKb }, StatusSTS: statusSts() };
      return { Status: { Module: 0, Topic: m.name, FriendlyName: [m.name] } };
    }
    if (w === "zbbridgemode") return { ZbBridgeMode: m.mode };
    if (w === "zbsend") {
      const result = zbSend(text);
      return { ZbSend: result === "sent" || result === "dropped" ? "Done" : "Error" };
    }
    if (w === "zbstatus3") {
      const ieee = arg.toLowerCase();
      const key = Object.keys(m.lamps).find((k) => k.toLowerCase() === ieee);
      if (!key) return { ZbStatus3: [] };
      return { ZbStatus3: [{ Device: "0x1A2B", IEEEAddr: key, Name: "lamp", Power: m.lamps[key].power, Reachable: true, LastSeen: 1 }] };
    }
    if (w === "espnowmeshstatus") return { EspNowMeshStatus: { Running: 1, Id: m.mesh.id, Epoch: 5, Heap: m.heapKb * 1024, Neighbors: 1, Delivered: m.mesh.Delivered, AcksHeard: m.mesh.AcksHeard, GaveUp: m.mesh.GaveUp, SentOwn: m.mesh.sent } };
    if (w === "espnowmeshclock") {
      const peer = m.mesh.peer;
      return { EspNowMeshClock: { Clock: 1, Synced: 1, Adopted: 1, Timeline: "AB12", Tag: 1, Mesh: 5000, Ticks10: 3, Taken: 0, Steps: 0, EventsLost: 0, Count: peer ? 1 : 0, From: 0, List: peer ? [{ Id: peer.mesh.id, Seen: 2, Sync: 1, Skew: -1, Timeline: "AB12" }] : [] } };
    }
    if (w === "housestatus") return { HouseStatus: { Me: m.mesh.id, Up: 1, Name: "Cottage", Key: 1, Pending: 0, Nodes: [] } };
    if (w === "espnowmeshsend") {
      const [dest, type, ack, ...body] = arg.split(",");
      m.mesh.sent++;
      const lost = m.mesh.lossEvery > 0 && m.mesh.sent % m.mesh.lossEvery === 0;
      const peer = m.mesh.peer;
      if (peer && peer.alive && !lost && Number(dest) === peer.mesh.id) {
        later(() => {
          if (!peer.alive) return;
          peer.mesh.Delivered++;
          if (ack === "1") m.mesh.AcksHeard++;
        }, m.mesh.delayMs);
      } else if (ack === "1") {
        later(() => (m.mesh.GaveUp++), m.mesh.delayMs * 3);
      }
      void type;
      void body;
      return { EspNowMeshSend: "queued" };
    }
    if (/^power\d?$/.test(w)) {
      const channel = w.length > 5 ? w.slice(5) : "1";
      const key = `POWER${channel}`;
      if (arg) {
        const on = /^(on|1)$/i.test(arg);
        const was = m.outlet.states[channel] ?? "ON";
        m.outlet.states[channel] = on ? "ON" : "OFF";
        if (was !== m.outlet.states[channel]) {
          for (const target of m.outlet.powers) {
            if (on) later(() => target.setAlive(true), m.outlet.bootDelayMs);
            else target.setAlive(false);
          }
        }
      }
      return { [key]: m.outlet.states[channel] ?? "ON" };
    }
    if (w === "br") return { Br: brAnswer(arg) };
    return { Command: "Unknown" };
  }

  function page(res, status, body, type = MIME.html, headers = {}) {
    res.writeHead(status, { "Content-Type": type, "Content-Length": Buffer.byteLength(body), ...headers });
    res.end(body);
  }

  function handle(req, res) {
    const url = new URL(req.url, "http://x");
    const entry = { method: req.method, path: url.pathname, query: url.search, cmnd: url.searchParams.get("cmnd"), referer: req.headers.referer ?? null, authorization: req.headers.authorization ?? null, at: performance.now() };
    m.requests.push(entry);
    if (!m.alive) {
      req.socket.destroy();
      return;
    }
    if (!req.headers.referer || !req.headers.referer.startsWith(`http://${m.host}`)) {
      req.socket.destroy();
      return;
    }
    if (req.method === "POST" && url.pathname === "/ufsu") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const name = /filename="([^"]+)"/.exec(body)?.[1];
        const content = body.split(/\r\n\r\n/)[1]?.split(/\r\n--/)[0] ?? "";
        if (!m.password || m.ufsuOpen) {
          if (name) {
            m.files[`/${name}`] = content;
            m.uploads.push(name);
          }
        }
        if (m.password) page(res, 401, "Unauthorized", MIME.html, { "WWW-Authenticate": 'Basic realm="Tasmota"' });
        else page(res, 200, "<div>Upload <font color='#00'>Successful</font></div>");
      });
      return;
    }
    if (m.password) {
      if (url.pathname === "/cm") return page(res, 401, JSON.stringify({ WARNING: "Need user and password" }), MIME.json);
      return page(res, 401, "Unauthorized", MIME.html, { "WWW-Authenticate": 'Basic realm="Tasmota"' });
    }
    if (url.pathname === "/cm") {
      const text = url.searchParams.get("cmnd") ?? "";
      if (!text) return page(res, 200, JSON.stringify({ Command: "Enter command" }), MIME.json);
      return page(res, 200, JSON.stringify(command(text)), MIME.json);
    }
    if (url.pathname === "/ufsd") {
      const del = url.searchParams.get("delete");
      if (del) delete m.files[del];
      const dl = url.searchParams.get("download");
      if (dl) {
        if (dl in m.files) return page(res, 200, m.files[dl], "application/octet-stream", { "Content-Disposition": `attachment; filename="${dl.slice(1)}"` });
        return page(res, 200, "");
      }
      return page(res, 200, "<html>files</html>");
    }
    if (url.pathname === "/dl") return page(res, 200, "X".repeat(4096), "application/octet-stream", { "Content-Disposition": 'attachment; filename="Config_bench.dmp"' });
    if (["/", "/mn", "/cn", "/md", "/lg", "/tp", "/co", "/in", "/mq", "/cs", "/rs", "/up", "/ufse", "/ufsu"].includes(url.pathname)) return page(res, 200, `<html>${url.pathname}</html>`);
    return page(res, 404, "Not found");
  }

  const server = http.createServer(handle);
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  m.port = server.address().port;
  m.host = `127.0.0.1:${m.port}`;
  m.zbSend = zbSend;
  // a panel that marks its bridge's lamps as unavailable (the "no communication" look) after the bridge has been gone
  // this long, and clears them once it is back: the behaviour asked of a panel
  if (options.unavailableAfterMs && m.bridge) {
    let downSince = null;
    m.watchTimer = setInterval(() => {
      if (!m.alive) return;
      if (!m.bridge.alive) {
        downSince ??= Date.now();
        if (Date.now() - downSince >= options.unavailableAfterMs) for (const ieee of Object.keys(m.bridge.lamps)) m.view.doubt[ieee] = true;
      } else if (downSince !== null) {
        downSince = null;
        later(() => {
          for (const ieee of Object.keys(m.bridge.lamps)) delete m.view.doubt[ieee];
        }, options.clearAfterMs ?? 100);
      }
    }, 40);
  }
  m.bridge?.subscribers.push(m);

  m.setAlive = (alive) => {
    if (alive === m.alive) return;
    if (!alive) {
      // a power cut: a save in flight leaves an empty file (the bug a torn save would be), when the mock is told so
      if (m.persistCorruptOnCut === "always" || (m.persistCorruptOnCut === true && Date.now() < m.savingUntil)) m.files["/_persist.json"] = "{}";
      m.alive = false;
      for (const t of m.pendingTimers) clearTimeout(t);
      m.pendingTimers.clear();
      return;
    }
    m.alive = true;
    m.bootCount++;
    m.bootAt = Date.now();
    const disk = diskPersist();
    m.persist = disk ?? {};
    m.view = { live: {}, doubt: {} };
  };
  m.powers = (...targets) => {
    m.outlet.powers.push(...targets);
  };
  m.close = () => new Promise((done) => {
    clearInterval(m.watchTimer);
    for (const t of m.pendingTimers) clearTimeout(t);
    server.closeAllConnections?.();
    server.close(done);
  });
  return m;
}

/** A syslog datagram as Tasmota sends it (support.ino, SyslogAsync): RFC 5424 with the device's own time. */
export function sendSyslog(port, { hostname = "bench-dev", text, level = 2, ts = "1970-01-01T00:00:02.096000+01:00" }) {
  return new Promise((resolveSend, rejectSend) => {
    const socket = dgram.createSocket("udp4");
    const pri = 128 + Math.min(level * 3, 7);
    const buf = Buffer.from(`<${pri}>1 ${ts} ${hostname} tasmota - - - ${text}`);
    socket.send(buf, port, "127.0.0.1", (err) => {
      socket.close();
      if (err) rejectSend(err);
      else resolveSend();
    });
  });
}
