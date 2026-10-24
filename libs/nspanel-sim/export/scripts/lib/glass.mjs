// A tiny interpreter for the Nextion instructions this project emits, so the
// pages can be RUN and not only inspected.
//
// WHY. Every check this repo has reads the artifact: `verify-hmi-scenario.mjs`
// finds each component and attribute in the compiled `.tft`,
// `verify-event-frames.mjs` finds each declared frame. None of them presses
// anything. The keyboard is the first thing here whose whole meaning is a
// SEQUENCE -- press, press, wait, press -- and a sequence is exactly what a
// static check cannot have an opinion about. The Editor's debugger can run one,
// but it needs a live desktop (it goes deaf the moment the host workstation locks) and
// it is never going to run in CI.
//
// So this runs the same instruction lines the `.tft` carries, read out of the
// scenario document, on a model of the few things they touch. It is NOT a
// Nextion: it knows the dozen instructions the generator emits and refuses
// anything else, loudly, rather than guessing. That refusal is the point -- the
// day the generator emits an instruction this does not know, a test says so
// instead of quietly passing.
//
// The vocabulary comes from reading the vendor's own `keybdA` page and the
// joBr99 sources, never from assumption. What it does not
// model is anything the scenarios do not ask about: colour, visibility,
// drawing, and the byte framing around a payload.

/** The operand forms the generator writes. */
const NUM = /^-?\d+$/;
const STR = /^"(.*)"$/;
const REF = /^[A-Za-z_]\w*(\.[A-Za-z_]\w*){1,2}$/;

export class Glass {
  /**
   * @param {object} scenario the built scenario document (`hmi-scenarios/p1-*.json`)
   * @param {string} startPage the page to open first
   */
  constructor(scenario, startPage) {
    this.scenario = scenario;
    /** page name -> { name, components: Map, events } */
    this.pages = new Map();
    this.sys = { sys0: 0, sys1: 0, sys2: 0 };
    /** where the finger is now, and where it went down; 0,0 means no touch */
    this.touch = { x: 0, y: 0 };
    this.down = { x: 0, y: 0 };
    /** everything the glass has put on the wire, in order */
    this.wire = "";
    /** virtual milliseconds; only `advance()` moves it */
    this.now = 0;
    /** armed timers: objname -> { page, deadline } */
    this.timers = new Map();
    this.page = null;

    // Page 0 lives in `edits["0.pa"]` and the scenario renames it by writing an
    // `objname`; that new name is what every cross-page reference uses. The
    // globals (`vscope: 1`) are on it, which is how both keyboards reach `kbIn`.
    const zero = scenario.edits?.["0.pa"];
    this.zeroName = Object.values(zero?.changes ?? {})[0]?.attributes?.objname ?? "page0";
    this.addPage(this.zeroName, zero?.add ?? [], zero?.events);
    for (const p of scenario.addPages ?? []) this.addPage(p.name, p.add, p.events);
    this.open(startPage);
  }

  addPage(name, add, events) {
    const components = new Map();
    for (const c of add ?? []) components.set(c.objname, { ...c, attributes: { ...(c.attributes ?? {}) } });
    this.pages.set(name, { name, components, events: events ?? [] });
  }

  /** Opens a page and runs its `load` event, which is what `page <name>` does. */
  open(name) {
    const page = this.pages.get(name);
    if (!page) throw new Error(`no page "${name}" in this scenario`);
    // A page's own components are re-initialised when it loads: the compiled
    // attributes come back. A global is not -- it lives on page 0 and page 0 is
    // not being re-entered. That difference is the whole reason `kbIn` is a
    // global and `kbShow` is not.
    if (this.page && this.page.name !== name) {
      const src = this.scenario.addPages?.find((p) => p.name === name);
      if (src) {
        for (const c of src.add) {
          const live = page.components.get(c.objname);
          if (live && Number(c.attributes?.vscope ?? 0) !== 1) live.attributes = { ...(c.attributes ?? {}) };
        }
      }
    }
    this.page = page;
    // a timer belongs to its page and stops when the page goes
    for (const [n, t] of [...this.timers]) if (t.page !== name) this.timers.delete(n);
    this.runEvent(page.events, "load", `page ${name}`);
  }

  /** Finds a component by `name` or `page.name`, on this page or on page 0. */
  ref(path) {
    const parts = path.split(".");
    if (parts.length === 3) {
      const page = this.pages.get(parts[0]);
      if (!page) throw new Error(`unknown page in "${path}"`);
      const c = page.components.get(parts[1]);
      if (!c) throw new Error(`no component "${parts[1]}" on page "${parts[0]}"`);
      return { c, attr: parts[2] };
    }
    if (parts.length !== 2) throw new Error(`cannot read "${path}"`);
    const c = this.page.components.get(parts[0]) ?? this.pages.get(this.zeroName).components.get(parts[0]);
    if (!c) throw new Error(`no component "${parts[0]}" on page "${this.page.name}" or on page 0`);
    return { c, attr: parts[1] };
  }

  /**
   * What the panel has SENT, one entry per frame.
   *
   * A tap's frame is a single `printh` with the envelope baked in; the OK key
   * writes its header, length, payload and CRC as four separate instructions.
   * Splitting the wire on `55 BB` -- this project's own header --
   * makes the two look the same to a scenario, which is the point. Our payloads
   * are text, so the header can never appear inside one.
   */
  get frames() {
    return this.wire.split(String.fromCharCode(0x55, 0xbb)).slice(1);
  }

  get(path) { const { c, attr } = this.ref(path); return c.attributes[attr]; }
  set(path, v) { const { c, attr } = this.ref(path); c.attributes[attr] = v; }

  /** One operand: a number, a quoted string, `sysN`, or `a.b` / `page.a.b`. */
  value(tok) {
    const t = tok.trim();
    if (NUM.test(t)) return Number(t);
    const q = STR.exec(t);
    // a string literal's bytes, as the Nextion reads it: \" \\ \r \n (glass/src/script.ts does the same)
    if (q) return q[1].replace(/\\(["\\rn])/g, (_, c) => (c === "r" ? "\r" : c === "n" ? "\n" : c));
    if (t in this.sys) return this.sys[t];
    // The touch system variables: `tch0`/`tch1` are where the finger is NOW and
    // read 0 when there is none (that is the `if(tch0!=0)` the gesture timer
    // guards itself with), `tch2`/`tch3` are where the press began.
    if (t === "tch0") return this.touch.x;
    if (t === "tch1") return this.touch.y;
    if (t === "tch2") return this.down.x;
    if (t === "tch3") return this.down.y;
    if (REF.test(t)) return this.get(t);
    throw new Error(`glass: cannot evaluate "${tok}"`);
  }

  /** The right-hand side of an assignment: operands joined by + or -. */
  expr(src) {
    const parts = [];
    let buf = "", quote = false;
    for (const ch of src) {
      if (ch === '"') quote = !quote;
      if (!quote && (ch === "+" || ch === "-") && buf.trim() !== "") { parts.push(buf, ch); buf = ""; continue; }
      buf += ch;
    }
    parts.push(buf);
    let acc = this.value(parts[0]);
    for (let i = 1; i < parts.length; i += 2) {
      const rhs = this.value(parts[i + 1]);
      acc = parts[i] === "+"
        ? (typeof acc === "string" || typeof rhs === "string" ? String(acc) + String(rhs) : acc + rhs)
        : acc - rhs;
    }
    return acc;
  }

  /** The six comparisons the generator writes. */
  test(cond) {
    const m = /^(.*?)(==|!=|<=|>=|<|>)(.*)$/.exec(cond);
    if (!m) throw new Error(`glass: cannot read the condition "${cond}"`);
    const a = this.expr(m[1]), b = this.expr(m[3]);
    switch (m[2]) {
      case "==": return a === b;
      case "!=": return a !== b;
      case "<": return a < b;
      case ">": return a > b;
      case "<=": return a <= b;
      default: return a >= b;
    }
  }

  /** Runs a block of lines, honouring `if(){ }else{ }` and its nesting. */
  exec(lines) {
    /** From the index of a `{`, the body it encloses and the index of its close. */
    const block = (from) => {
      let depth = 0;
      const body = [];
      for (let j = from; j < lines.length; j++) {
        const t = lines[j].trim();
        if (t === "{") { depth++; if (depth === 1) continue; }
        if (t === "}" || t === "}else") { depth--; if (depth === 0) return [body, j]; }
        body.push(lines[j]);
      }
      throw new Error("glass: an if block never closes");
    };
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      const iff = /^if\((.*)\)$/.exec(line);
      if (!iff) { i++; if (line !== "" && line !== "{" && line !== "}") this.step(line); continue; }
      const [body, close] = block(i + 1);
      const taken = this.test(iff[1]);
      if (taken) this.exec(body);
      if (lines[close].trim() === "}else") {
        const [otherwise, otherClose] = block(close + 1);
        if (!taken) this.exec(otherwise);
        i = otherClose + 1;
      } else i = close + 1;
    }
  }

  /** One instruction. Anything not listed here is an error, on purpose. */
  step(line) {
    let m;
    if ((m = /^btlen\s+(.+?),\s*(sys[012])$/.exec(line))) {
      // BYTES, not characters. Our alphabet is ASCII so the two agree, and this
      // is the line that would have to change on the day it does not.
      this.sys[m[2]] = Buffer.byteLength(String(this.expr(m[1])), "utf8");
      return;
    }
    // `substr <src>,<dest>,<start>,<count>` -- the measured form, the one the
    // Editor compiles. The editing field uses it to show the
    // TAIL of a line longer than the window it can display.
    if ((m = /^substr\s+([\w.]+),\s*([\w.]+),\s*([\w.]+),\s*([\w.]+)$/.exec(line))) {
      const src = String(this.value(m[1]));
      const start = Number(this.value(m[3]));
      const count = Number(this.value(m[4]));
      this.set(m[2], src.slice(start, start + count));
      return;
    }
    if ((m = /^click\s+(\w+),\s*([01])$/.exec(line))) {
      const target = this.page.components.get(m[1]);
      if (!target) throw new Error(`glass: click on "${m[1]}", which is not on page "${this.page.name}"`);
      this.runEvent(target.events, m[2] === "1" ? "down" : "up", `click ${m[1]}`);
      return;
    }
    if ((m = /^page\s+(\w+)$/.exec(line))) { this.open(m[1]); return; }
    if ((m = /^printh\s+([0-9A-Fa-f ]+)$/.exec(line))) {
      this.wire += m[1].trim().split(/\s+/).map((b) => String.fromCharCode(parseInt(b, 16))).join("");
      return;
    }
    // `prints X,0` writes the whole string: that is the payload. `prints X,2`
    // writes two bytes of a number -- the length prefix and the CRC -- and that
    // is envelope, which `verify-event-frames.mjs` owns against the compiled
    // .tft. Only the payload goes on the wire here, so a scenario can say what
    // went out without restating the framing around it.
    if ((m = /^prints\s+(.+?),\s*0$/.exec(line))) { this.wire += String(this.expr(m[1])); return; }
    if (/^prints\s+/.test(line)) return;
    if (/^(crcrest|crcputh|crcputs)\b/.test(line)) return;
    if ((m = /^([\w.]+)\s*\+=\s*(.+)$/.exec(line))) { this.set(m[1], String(this.get(m[1])) + String(this.expr(m[2]))); return; }
    if ((m = /^([\w.]+)\s*-=\s*1$/.exec(line))) { this.set(m[1], String(this.get(m[1])).slice(0, -1)); return; }
    // A system variable is assignable too: the sliding window computes its
    // start offset into `sys0` because `substr` takes a plain number there.
    if ((m = /^(sys[012])\s*=\s*(.+)$/.exec(line))) { this.sys[m[1]] = this.expr(m[2]); return; }
    if ((m = /^([\w.]+)\s*=\s*(.+)$/.exec(line))) {
      const v = this.expr(m[2]);
      this.set(m[1], v);
      // Arming a Timer is an assignment, and its deadline is its own `tim`.
      const name = m[1].split(".");
      if (name.length === 2 && name[1] === "en") {
        const c = this.page.components.get(name[0]);
        if (c?.type === "Timer") {
          if (v === 1) this.timers.set(name[0], { page: this.page.name, deadline: this.now + Number(c.attributes.tim) });
          else this.timers.delete(name[0]);
        }
      }
      return;
    }
    throw new Error(`glass: no rule for the instruction "${line}"`);
  }

  runEvent(events, kind, why) {
    const e = (events ?? []).find((x) => x.event === kind);
    if (!e) return false;
    try { this.exec(e.lines); } catch (err) { throw new Error(`${why}: ${err.message}`); }
    return true;
  }

  /**
   * A press at a point on the glass: the page's TouchCap records where the
   * finger is -- that is what `vaLx`/`vaLy` are for, and every key's code is
   * guarded by them -- and then ONE component gets the release. Which one is
   * the topmost, and topmost is the LAST declared: measured in the Editor's
   * debugger, where a Text with no event at all
   * swallowed the press meant for the Button under it.
   */
  press(x, y) {
    const gest = this.page.components.get("tcGest");
    this.touch = { x, y };
    this.down = { x, y };
    this.setTouch(x, y);
    if (gest) { this.runEvent(gest.events, "down", "touch down"); this.setTouch(x, y); }
    let hit = null;
    for (const c of this.page.components.values()) {
      if (c.x === undefined || ["Vari", "Timer", "Touchcap"].includes(c.type)) continue;
      if (x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h) hit = c;
    }
    // the finger is off the glass before the release event runs
    this.touch = { x: 0, y: 0 };
    if (gest) this.runEvent(gest.events, "up", "touch up");
    if (hit) this.runEvent(hit.events, "up", `press on ${hit.objname}`);
    return hit?.objname ?? null;
  }

  setTouch(x, y) {
    for (const n of ["vaLx", "vaGx"]) if (this.page.components.has(n)) this.set(`${n}.val`, x);
    for (const n of ["vaLy", "vaGy"]) if (this.page.components.has(n)) this.set(`${n}.val`, y);
  }

  /** Moves the clock, firing every timer whose deadline it passes, in order. */
  advance(ms) {
    const end = this.now + ms;
    for (;;) {
      let next = null;
      for (const [n, t] of this.timers) {
        if (t.deadline <= end && (next === null || t.deadline < next[1].deadline)) next = [n, t];
      }
      if (!next) break;
      this.now = next[1].deadline;
      this.timers.delete(next[0]);
      const c = this.pages.get(next[1].page).components.get(next[0]);
      this.runEvent(c.events, "timer", `timer ${next[0]}`);
      // A Nextion Timer is CYCLIC while `en` is 1: it fires again every `tim`
      // until something turns it off. `kbBlink` relies on that and never
      // re-arms itself; `kbTap` relies on the opposite and sets `en=0` in its
      // own handler, which is what makes `en == 1` mean "the multi-tap window
      // is open". Modelling the timer as one-shot made the
      // caret blink once and stop.
      if (Number(c.attributes.en) === 1 && !this.timers.has(next[0])) {
        this.timers.set(next[0], { page: next[1].page, deadline: this.now + Number(c.attributes.tim) });
      }
    }
    this.now = end;
  }
}
