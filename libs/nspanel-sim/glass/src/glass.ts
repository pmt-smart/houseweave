// The Nextion, emulated: the display of the panel running the compiled
// project, with the ESP32 on the other end of its UART.
//
// It runs what the .tft runs -- the pages and components as compiled
// (hmi.ts), their event code (script.ts) -- and what comes over the UART,
// which is the same instruction language. Nothing of the panel's logic is
// here: a touch runs the component's own code, which prints the frames the
// generator wrote into it, and the ESP32's Berry answers with instructions.
//
// The behaviour follows what was measured on the Editor's debugger and on the
// glass:
//
//   - the touch goes to the component on top, the one with the highest id,
//     even one with no event (a Text swallows it); a Touchcap sees every
//     touch of its page before any component does;
//   - tch0/tch1 follow the finger while it is down and are 0 once it is up;
//     tch2/tch3 keep where it went down;
//   - a page load resets the page's own components to their compiled values,
//     runs the page's load event, draws the page and runs loadend; a global
//     component (vscope 1) keeps its values, and is the only one another page
//     reaches (page.obj.attr);
//   - a Timer ticks only on its own page, and only while `en` is 1;
//   - an instruction the glass refuses answers with its error code (0x1A
//     invalid variable, 0x02 invalid component, ...) while bkcmd asks for
//     failures, which is the default.
import type { ZiFont } from "@nspanel-sim/export";
import { qrEncode, qrPlacement } from "@nspanel-sim/layout";
import { byteString, textOf, type AttrValue, type ComponentDef, type HmiDef, type PageDef } from "./hmi.js";
import { Frame, type Box } from "./raster.js";
import { compare, evaluate, parseScript, parseSimple, ScriptError, splitArgs, type Cond, type Statement, type Value } from "./script.js";

export interface Picture {
  width: number;
  height: number;
  pixels: Uint16Array;
}

export interface GlassOptions {
  width: number;
  height: number;
  fonts: (ZiFont | undefined)[];
  pictures: (Picture | undefined)[];
  /** bytes the glass sends the ESP32 */
  send: (bytes: Uint8Array) => void;
  /** something the glass refused or had to cut: what a panel would silently do */
  onDiagnostic?: (message: string) => void;
}

interface Live {
  def: ComponentDef;
  attrs: Record<string, AttrValue>;
  vis: boolean;
  touch: boolean;
  pressed: boolean;
  /** a Timer's milliseconds since its last tick */
  elapsed: number;
  /**
   * Where a finger left a Slider's pointer: the Nextion draws it there, centred
   * on the finger, and not at its value, until the value is written. Measured in
   * the Editor's debugger: a detail slider dragged to x 309 kept its
   * 4-pixel pointer at 307..310, and the page rail's at the finger too, which is
   * none of the three places its values have.
   */
  finger?: [number, number];
}

/** raised by `page`: the event that jumped ends there, as its components are gone */
class PageJump {}

const ERR = { instruction: 0x00, component: 0x02, page: 0x03, variable: 0x1a, operation: 0x1b, assign: 0x1c, params: 0x1e } as const;

/** What leaves Protocol Reparse: the Nextion's reserved string, the one joBr99's flasher sends too. */
export const REPARSE_EXIT = "DRAKJHSUYDGBNCJHGJKSHBDN";

export class Glass {
  readonly frame: Frame;
  page!: PageDef;
  /** the components of the page on show, by id order */
  private live: Live[] = [];
  /** the global components of every page, which outlive a page change */
  private globals = new Map<string, Live>();
  private sys = [0, 0, 0];
  private tch = [0, 0, 0, 0];
  private crc = 0xffff;
  private system: Record<string, number> = { bkcmd: 2, dim: 100, dims: 100, sleep: 0, thup: 0, thsp: 0, ussp: 0, recmod: 0, baud: 115200 };
  private rx: number[] = [];
  /** what arrived in Protocol Reparse, where it is data and not instructions */
  private reparsed: number[] = [];
  private target: Live | null = null;
  private pageTouched = false;
  private scripts = new WeakMap<readonly string[], Statement[]>();
  /** while event code runs: the components whose attributes it changed, drawn when it ends (`refresh`) */
  private dirty: Set<Live> | null = null;
  /** the virtual clock, for the Timers */
  now = 0;

  readonly hmi: HmiDef;
  private readonly opts: GlassOptions;

  constructor(hmi: HmiDef, opts: GlassOptions) {
    this.hmi = hmi;
    this.opts = opts;
    this.frame = new Frame(opts.width, opts.height);
    for (const p of hmi.pages) for (const c of p.components) if (c.global) this.globals.set(`${p.name}.${c.objname}`, this.fresh(c));
  }

  private fresh(def: ComponentDef): Live {
    return { def, attrs: { ...def.attrs }, vis: true, touch: true, pressed: false, elapsed: 0 };
  }

  /** Power on: the Nextion's startup and ready messages, then page 0. */
  start() {
    this.send([0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x88, 0xff, 0xff, 0xff]);
    this.load(this.hmi.pages[0]);
  }

  private send(bytes: number[] | Uint8Array) {
    this.opts.send(Uint8Array.from(bytes));
  }

  private diagnose(message: string) {
    this.opts.onDiagnostic?.(message);
  }

  /** a failure, answered as the glass answers one (bkcmd 2 and 3: failures) */
  private fail(code: number, message: string) {
    this.diagnose(`0x${code.toString(16).padStart(2, "0")}: ${message}`);
    if (this.system.bkcmd >= 2) this.send([code, 0xff, 0xff, 0xff]);
  }

  // --- the UART, from the ESP32 --------------------------------------------------------------

  /**
   * Bytes from the ESP32: every instruction ends with FF FF FF.
   *
   * Except in Protocol Reparse (`recmod=1`), where nothing that arrives is an
   * instruction: it is data for the page's own code, which a page that wants
   * it reads with `u[]` and `ucopy`. The one way out is the string the Nextion
   * reserves for it. Measured in the Editor's debugger: after
   * `recmod=1`, `page home` left the page where it was, and after the string
   * and `recmod=0` it ran again.
   */
  receive(bytes: Uint8Array) {
    for (const b of bytes) {
      if (this.system.recmod === 1) {
        this.reparsed.push(b);
        if (this.reparsed.length > 1024) this.reparsed.splice(0, this.reparsed.length - 1024);
        if (String.fromCharCode(...this.reparsed.slice(-REPARSE_EXIT.length)) === REPARSE_EXIT) {
          this.system.recmod = 0;
          this.reparsed = [];
          this.rx = [];
        }
        continue;
      }
      this.rx.push(b);
      const n = this.rx.length;
      if (n >= 3 && this.rx[n - 1] === 0xff && this.rx[n - 2] === 0xff && this.rx[n - 3] === 0xff) {
        const line = String.fromCharCode(...this.rx.slice(0, n - 3));
        this.rx = [];
        if (line.trim() !== "") this.instruction(line);
      }
    }
  }

  /** one instruction from the UART: a statement, as event code would run it */
  instruction(line: string) {
    try {
      this.exec([parseSimple(line.trim())]);
    } catch (e) {
      if (e instanceof PageJump) return;
      if (e instanceof ScriptError) this.fail(e.code, `${e.message} (${line})`);
      else throw e;
    }
  }

  // --- pages -------------------------------------------------------------------------------

  private findPage(ref: string): PageDef | undefined {
    const n = Number(ref);
    return /^\d+$/.test(ref) ? this.hmi.pages[n] : this.hmi.pages.find((p) => p.name === ref);
  }

  /** A page load: its own components as compiled, load, drawn, loadend. */
  load(page: PageDef) {
    if (this.page) this.runEvent(this.page.events.unload);
    this.page = page;
    this.target = null;
    this.live = page.components.map((c) => (c.global ? this.globals.get(`${page.name}.${c.objname}`)! : this.fresh(c)));
    for (const l of this.live) {
      l.pressed = false;
      l.elapsed = 0;
      l.finger = undefined;
    }
    this.runEvent(page.events.load);
    if (this.page !== page) return;
    this.draw();
    this.runEvent(page.events.loadend);
  }

  // --- drawing -------------------------------------------------------------------------------

  private pageBackground(box: Box) {
    const a = this.page.attrs;
    const pic = this.opts.pictures[Number(a.pic)];
    if (Number(a.sta) === 2 && pic) this.frame.picture(pic, box, true);
    else this.frame.fill(box, Number(a.bco));
  }

  /** the whole page, as a page load or `ref 0` draws it */
  draw() {
    this.dirty?.clear();
    this.pageBackground({ x: 0, y: 0, w: this.frame.width, h: this.frame.height });
    for (const l of this.live) if (l.vis) this.render(l);
  }

  /**
   * What event code changed, drawn now, in the page's order. The Nextion does not
   * draw an attribute's change while the code that made it runs: it draws it
   * when the code ends, or at `doevents`, which is there to force it. Measured in
   * the Editor's debugger: the lock's timer lights a dot (its pco)
   * and then draws the line into it, and the dot came out over the line.
   */
  private refresh() {
    const dirty = this.dirty;
    if (!dirty || dirty.size === 0) return;
    this.dirty = new Set();
    for (const l of this.live) if (dirty.has(l) && l.vis && l.def.geometric) this.render(l);
  }

  /** a region drawn again: the page's background, then what is visible over it */
  private redraw(box: Box) {
    this.pageBackground(box);
    for (const l of this.live) {
      const d = l.def;
      if (!l.vis || !d.geometric) continue;
      if (d.x < box.x + box.w && box.x < d.x + d.w && d.y < box.y + box.h && box.y < d.y + d.h) this.render(l);
    }
  }

  private background(l: Live, sta: number, color: number, pic: number, crop: number) {
    const d = l.def;
    const box = { x: d.x, y: d.y, w: d.w, h: d.h };
    if (sta === 0) {
      const p = this.opts.pictures[crop];
      if (p) this.frame.picture(p, box, true);
      else this.pageBackground(box);
    } else if (sta === 2 || sta === 3) {
      const p = this.opts.pictures[pic];
      if (p) this.frame.picture(p, box);
    } else {
      this.frame.fill(box, color);
    }
  }

  private render(l: Live) {
    const d = l.def;
    const a = l.attrs;
    const n = (k: string) => Number(a[k] ?? 0);
    const box = { x: d.x, y: d.y, w: d.w, h: d.h };
    switch (d.type) {
      case "Text":
      case "Button":
      case "ButtonT":
      case "Number": {
        const pressed = l.pressed && (d.type === "Button" || d.type === "ButtonT");
        this.background(l, n("sta"), pressed ? n("bco2") : n("bco"), pressed ? n("pic2") : n("pic"), pressed ? n("picc2") : n("picc"));
        const font = this.opts.fonts[n("font")];
        const text = d.type === "Number" ? String(n("val")) : n("pw") ? "*".repeat(textOf(String(a.txt ?? "")).length) : textOf(String(a.txt ?? ""));
        if (font) this.frame.text(font, text, box, pressed ? n("pco2") : n("pco"), n("xcen"), n("ycen"), n("spax"));
        break;
      }
      case "Slider": {
        this.background(l, n("sta"), n("bco"), n("pic"), n("picc"));
        // the pointer: flat in pco with psta 0, a picture with 1 (none without pic2)
        const min = n("minval"), max = n("maxval");
        const t = max > min ? (Math.min(max, Math.max(min, n("val"))) - min) / (max - min) : 0;
        const wid = Math.min(n("wid"), d.w), hig = Math.min(n("hig"), d.h);
        const vertical = n("mode") === 1;
        // vertical: the minimum at the bottom; a pointer narrower than the box is
        // centred. Where a finger left it, it is on the finger: counted up the
        // value's axis, from the left or from the bottom, it starts half its
        // size before the finger, inside the box
        const f = l.finger;
        const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
        const px = vertical ? d.x + Math.floor((d.w - wid) / 2)
          : f ? clamp(f[0] - Math.floor(wid / 2), d.x, d.x + d.w - wid) : d.x + Math.round((d.w - wid) * t);
        const py = !vertical ? d.y + Math.floor((d.h - hig) / 2)
          : f ? clamp(f[1] + Math.floor(hig / 2), d.y + hig - 1, d.y + d.h - 1) - hig + 1 : d.y + Math.round((d.h - hig) * (1 - t));
        const pointer = { x: px, y: py, w: wid, h: hig };
        if (n("psta") === 0) this.frame.fill(pointer, n("pco"));
        else {
          const p = this.opts.pictures[n("pic2")];
          if (p) this.frame.picture(p, pointer);
        }
        break;
      }
      case "Qrcode": {
        // The ground in bco, and the symbol of the text in pco. The standard's
        // smallest version at level L, the level the Nextion's own capacities
        // are, and the biggest whole module that leaves a quiet zone: what the
        // Nextion itself draws -- its version, mask and module -- has not been
        // measured, and the bench leaves this box out.
        this.frame.fill(box, n("bco"));
        const symbol = qrEncode(textOf(String(a.txt ?? "")));
        if (!symbol || textOf(String(a.txt ?? "")) === "") break;
        const at = qrPlacement(symbol.size, box);
        for (let y = 0; y < symbol.size; y++) {
          for (let x = 0; x < symbol.size; x++) {
            if (symbol.modules[y][x]) this.frame.fill({ x: d.x + at.x + x * at.scale, y: d.y + at.y + y * at.scale, w: at.scale, h: at.scale }, n("pco"));
          }
        }
        break;
      }
      default:
        // Hotspot, Timer, Vari, Touchcap: nothing to see
        break;
    }
  }

  // --- names ---------------------------------------------------------------------------------

  private component(ref: string): Live | undefined {
    if (/^\d+$/.test(ref)) return this.live.find((l) => l.def.id === Number(ref));
    const dot = ref.indexOf(".");
    if (dot > 0) {
      const page = ref.slice(0, dot);
      const obj = ref.slice(dot + 1);
      if (page === this.page.name) return this.component(obj);
      return this.globals.get(`${page}.${obj}`);
    }
    return this.live.find((l) => l.def.objname === ref);
  }

  /** where a name reads and writes: a system variable, or a component's attribute */
  private resolve(name: string): { system: string } | { live: Live; attr: string } {
    const parts = name.split(".");
    if (parts.length === 1) {
      if (/^sys[0-2]$/.test(name) || /^tch[0-3]$/.test(name) || name === "dp" || name === "crcval" || name === "rand" || name in this.system) return { system: name };
      throw new ScriptError(`no variable ${name}`, ERR.variable);
    }
    const attr = parts[parts.length - 1];
    const objRef = parts.slice(0, -1).join(".");
    const live = this.component(objRef);
    if (!live) {
      // another page's local component: the glass refuses it (`m10-cross-p0-to-p1`)
      throw new ScriptError(parts.length === 3 && parts[0] !== this.page.name ? `${objRef} is not global` : `no component ${objRef} on ${this.page.name}`, ERR.variable);
    }
    if (!(attr in live.attrs)) throw new ScriptError(`${objRef} has no ${attr}`, ERR.variable);
    return { live, attr };
  }

  read(name: string): Value {
    const r = this.resolve(name);
    if ("system" in r) {
      const s = r.system;
      if (s.startsWith("sys")) return this.sys[Number(s[3])];
      if (s.startsWith("tch")) return this.tch[Number(s[3])];
      if (s === "dp") return this.page.id;
      if (s === "crcval") return this.crc;
      if (s === "rand") return Math.floor(Math.random() * 0x7fffffff);
      return this.system[s];
    }
    return r.live.attrs[r.attr];
  }

  write(name: string, value: Value) {
    const r = this.resolve(name);
    if ("system" in r) {
      const s = r.system;
      if (s.startsWith("sys")) this.sys[Number(s[3])] = Number(value) | 0;
      else if (s in this.system) this.system[s] = Number(value) | 0;
      else throw new ScriptError(`${s} is read only`, ERR.assign);
      return;
    }
    const { live, attr } = r;
    const old = live.attrs[attr];
    if (typeof old === "string") {
      let v = typeof value === "string" ? value : String(value);
      const maxl = Number(live.attrs.txt_maxl ?? Infinity);
      if (attr === "txt" && v.length > maxl) {
        this.diagnose(`${this.page.name}.${live.def.objname}.txt cut at txt_maxl ${maxl}: ${JSON.stringify(textOf(v))}`);
        v = v.slice(0, maxl);
      }
      live.attrs[attr] = v;
    } else {
      if (typeof value === "string") throw new ScriptError(`${live.def.objname}.${attr} is a number`, ERR.assign);
      let v = value | 0;
      if (live.def.type === "Slider" && attr === "val") {
        v = Math.min(Number(live.attrs.maxval), Math.max(Number(live.attrs.minval), v));
        live.finger = undefined;
      }
      live.attrs[attr] = v;
      if (live.def.type === "Timer" && (attr === "en" || attr === "tim")) live.elapsed = 0;
    }
    if (!live.vis || !this.live.includes(live) || !live.def.geometric) return;
    if (this.dirty) this.dirty.add(live);
    else this.render(live);
  }

  // --- running code ----------------------------------------------------------------------------

  private runEvent(lines: readonly string[] | undefined) {
    if (!lines || lines.length === 0) return;
    let script = this.scripts.get(lines);
    if (!script) {
      script = parseScript(lines);
      this.scripts.set(lines, script);
    }
    // an event another event's code runs (click) draws with it, when the first ends
    const outer = this.dirty === null;
    if (outer) this.dirty = new Set();
    try {
      this.exec(script);
    } catch (e) {
      if (e instanceof PageJump) return;
      if (e instanceof ScriptError) this.fail(e.code, e.message);
      else throw e;
    } finally {
      if (outer) {
        this.refresh();
        this.dirty = null;
      }
    }
  }

  private test(c: Cond): boolean {
    if (c.kind === "and") return this.test(c.left) && this.test(c.right);
    if (c.kind === "or") return this.test(c.left) || this.test(c.right);
    const cmp = c as Extract<Cond, { kind: "cmp" }>;
    return compare(this.value(cmp.left), cmp.op, this.value(cmp.right));
  }

  private value(expr: string): Value {
    return evaluate(expr, (name) => this.read(name));
  }

  private exec(statements: Statement[]) {
    for (const s of statements) {
      if (s.kind === "if") {
        if (this.test(s.cond)) this.exec(s.then);
        else if (s.else) this.exec(s.else);
      } else if (s.kind === "assign") {
        this.assign(s.target, s.op, s.expr);
      } else {
        this.command(s.name, s.args, s.line);
      }
    }
  }

  private assign(target: string, op: string, expr: string) {
    const v = this.value(expr);
    if (op === "=") return this.write(target, v);
    const old = this.read(target);
    if (typeof old === "string") {
      if (op === "+=") return this.write(target, old + String(v));
      // txt-=n: the last n bytes go
      if (op === "-=") return this.write(target, old.slice(0, Math.max(0, old.length - (Number(v) | 0))));
      throw new ScriptError(`${op} on text`, ERR.operation);
    }
    const n = Number(v) | 0;
    const ops: Record<string, (a: number) => number> = {
      "+=": (a) => (a + n) | 0, "-=": (a) => (a - n) | 0, "*=": (a) => Math.imul(a, n),
      "/=": (a) => (n ? (a / n) | 0 : 0), "%=": (a) => (n ? a % n : 0),
    };
    return this.write(target, ops[op](old));
  }

  private num(expr: string): number {
    return Number(this.value(expr)) | 0;
  }

  private needs(args: string[], n: number, name: string) {
    if (args.length < n) throw new ScriptError(`${name} takes ${n} arguments`, ERR.params);
  }

  private command(name: string, args: string[], line: string) {
    switch (name) {
      case "page": {
        this.needs(args, 1, name);
        const p = this.findPage(args[0]);
        if (!p) throw new ScriptError(`no page ${args[0]}`, ERR.page);
        this.load(p);
        throw new PageJump();
      }
      case "vis":
      case "tsw": {
        this.needs(args, 2, name);
        const on = this.num(args[1]) !== 0;
        const targets = args[0] === "255" ? this.live : [this.component(args[0])];
        if (targets.some((l) => !l)) throw new ScriptError(`no component ${args[0]}`, ERR.component);
        for (const l of targets as Live[]) {
          if (name === "tsw") { l.touch = on; continue; }
          if (l.vis === on) continue;
          l.vis = on;
          if (!l.def.geometric) continue;
          if (on) this.render(l);
          else this.redraw({ x: l.def.x, y: l.def.y, w: l.def.w, h: l.def.h });
        }
        return;
      }
      case "ref": {
        if (args[0] === "0") return this.draw();
        const l = this.component(args[0]);
        if (!l) throw new ScriptError(`no component ${args[0]}`, ERR.component);
        this.dirty?.delete(l);
        if (l.vis) this.render(l);
        return;
      }
      case "click": {
        this.needs(args, 2, name);
        const l = this.component(args[0]);
        if (!l) throw new ScriptError(`no component ${args[0]}`, ERR.component);
        this.runEvent(l.def.events[this.num(args[1]) ? "down" : "up"]);
        return;
      }
      case "printh":
        this.send(args.join(" ").split(/\s+/).filter(Boolean).map((h) => parseInt(h, 16)));
        return;
      case "prints": {
        this.needs(args, 2, name);
        const v = this.value(args[0]);
        const len = this.num(args[1]);
        if (typeof v === "string") {
          const bytes = Array.from(len > 0 ? v.slice(0, len) : v, (c) => c.charCodeAt(0) & 0xff);
          this.send(bytes);
        } else {
          const n = len > 0 ? len : 4;
          this.send(Array.from({ length: n }, (_, i) => (v >>> (8 * i)) & 0xff));
        }
        return;
      }
      case "btlen":
      case "strlen": {
        this.needs(args, 2, name);
        const v = this.value(args[0]);
        this.write(args[1], String(v).length);
        return;
      }
      case "covx": {
        this.needs(args, 4, name);
        const v = this.value(args[0]);
        const len = this.num(args[2]);
        if (typeof v === "number") {
          let s = this.num(args[3]) === 2 ? (v >>> 0).toString(16).toUpperCase() : String(v);
          if (len > 0) s = s.length > len ? s.slice(-len) : s.padStart(len, "0");
          this.write(args[1], byteString(s));
        } else {
          const n = parseInt(v, this.num(args[3]) === 2 ? 16 : 10);
          this.write(args[1], Number.isFinite(n) ? n | 0 : 0);
        }
        return;
      }
      case "substr": {
        this.needs(args, 4, name);
        const v = String(this.value(args[0]));
        this.write(args[1], v.substr(this.num(args[2]), this.num(args[3])));
        return;
      }
      case "crcrest":
        this.needs(args, 2, name);
        this.crc = this.num(args[1]) & 0xffff;
        return;
      case "crcputh":
        for (const h of args.join(" ").split(/\s+/).filter(Boolean)) this.crcByte(parseInt(h, 16));
        return;
      case "crcputs":
      case "crcputu": {
        this.needs(args, 2, name);
        const v = this.value(args[0]);
        const len = this.num(args[1]);
        if (typeof v === "string") for (const c of len > 0 ? v.slice(0, len) : v) this.crcByte(c.charCodeAt(0) & 0xff);
        else for (let i = 0; i < (len > 0 ? len : 4); i++) this.crcByte((v >>> (8 * i)) & 0xff);
        return;
      }
      case "fill":
        this.needs(args, 5, name);
        this.frame.fill({ x: this.num(args[0]), y: this.num(args[1]), w: this.num(args[2]), h: this.num(args[3]) }, this.num(args[4]));
        return;
      case "cirs":
      case "cir":
        this.needs(args, 4, name);
        if (name === "cirs") this.frame.disc(this.num(args[0]), this.num(args[1]), this.num(args[2]), this.num(args[3]));
        else this.frame.ring(this.num(args[0]), this.num(args[1]), this.num(args[2]), this.num(args[3]));
        return;
      case "line":
      case "draw":
        this.needs(args, 5, name);
        if (name === "line") this.frame.line(this.num(args[0]), this.num(args[1]), this.num(args[2]), this.num(args[3]), this.num(args[4]));
        else {
          const x0 = this.num(args[0]), y0 = this.num(args[1]), x1 = this.num(args[2]), y1 = this.num(args[3]), c = this.num(args[4]);
          this.frame.line(x0, y0, x1, y0, c); this.frame.line(x1, y0, x1, y1, c);
          this.frame.line(x1, y1, x0, y1, c); this.frame.line(x0, y1, x0, y0, c);
        }
        return;
      case "xstr": {
        this.needs(args, 11, name);
        const [x, y, w, h, font, pco, bco, xcen, ycen, sta] = args.slice(0, 10).map((a) => this.num(a));
        const box = { x, y, w, h };
        if (sta === 1) this.frame.fill(box, bco);
        else if (sta === 0 || sta === 2) {
          const p = this.opts.pictures[bco];
          if (p) this.frame.picture(p, box, sta === 0);
        }
        const f = this.opts.fonts[font];
        if (!f) throw new ScriptError(`no font ${font}`, ERR.variable);
        this.frame.text(f, textOf(String(this.value(args[10]))), box, pco, xcen, ycen);
        return;
      }
      case "pic": {
        this.needs(args, 3, name);
        const p = this.opts.pictures[this.num(args[2])];
        if (p) this.frame.picture(p, { x: this.num(args[0]), y: this.num(args[1]), w: p.width, h: p.height });
        return;
      }
      case "sendme":
        this.send([0x66, this.page.id, 0xff, 0xff, 0xff]);
        return;
      case "get": {
        const v = this.value(args.join(","));
        if (typeof v === "string") this.send([0x70, ...Array.from(v, (c) => c.charCodeAt(0) & 0xff), 0xff, 0xff, 0xff]);
        else this.send([0x71, v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff, 0xff, 0xff, 0xff]);
        return;
      }
      case "rest":
        this.start();
        return;
      case "doevents":
        // the screen drawn now, with what the code has changed so far
        this.refresh();
        return;
      case "delay":
        return;
      case "connect":
        // the ESP32's handshake before a flash: the panel identifies itself
        this.send([...Array.from("comok 2,37671-0,NX4832F035_011C,99,61489,E46720857602B29,16777216", (c) => c.charCodeAt(0)), 0xff, 0xff, 0xff]);
        return;
      default:
        // A bare word the Nextion does not know is read as a variable: outside
        // Protocol Reparse, the Editor's debugger answers the reserved string
        // with 0x1A, "Invalid Variables"
        if (args.length === 0) throw new ScriptError(`no variable ${name}`, ERR.variable);
        throw new ScriptError(`no instruction ${name}: ${line}`, ERR.instruction);
    }
  }

  /** CRC-16/MODBUS, one byte at a time (crcrest 1,0xffff) */
  private crcByte(b: number) {
    this.crc ^= b & 0xff;
    for (let i = 0; i < 8; i++) this.crc = this.crc & 1 ? (this.crc >>> 1) ^ 0xa001 : this.crc >>> 1;
  }

  // --- the finger ------------------------------------------------------------------------------

  /** what takes a touch at (x, y): the top one, visible and touchable, with a box there */
  hit(x: number, y: number): Live | null {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const l = this.live[i];
      const d = l.def;
      if (!d.geometric || !l.vis || !l.touch) continue;
      if (x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h) return l;
    }
    return null;
  }

  private touchcaps(event: "down" | "up") {
    for (const l of this.live) if (l.def.type === "Touchcap" && l.def.events[event]) {
      const page = this.page;
      this.runEvent(l.def.events[event]);
      if (this.page !== page) return false;
    }
    return true;
  }

  private slide(l: Live, x: number, y: number) {
    const d = l.def;
    const a = l.attrs;
    const min = Number(a.minval), max = Number(a.maxval);
    const vertical = Number(a.mode) === 1;
    const t = vertical ? 1 - (y - d.y) / Math.max(1, d.h - 1) : (x - d.x) / Math.max(1, d.w - 1);
    const v = Math.round(min + Math.min(1, Math.max(0, t)) * (max - min));
    // the pointer follows the finger, whether or not the value changes
    const moved = !l.finger || l.finger[0] !== x || l.finger[1] !== y;
    l.finger = [x, y];
    const changed = v !== a.val;
    if (changed) a.val = v;
    if (changed || moved) this.render(l);
    return changed;
  }

  press(x: number, y: number) {
    x = Math.round(x);
    y = Math.round(y);
    this.tch = [x, y, x, y];
    const page = this.page;
    // a Touchcap hears the touch before any component does
    if (!this.touchcaps("down") || this.page !== page) return;
    const l = this.hit(x, y);
    this.target = l;
    this.pageTouched = !l;
    if (!l) return this.runEvent(this.page.events.down);
    if (l.def.type === "Button" || l.def.type === "ButtonT") {
      l.pressed = true;
      this.render(l);
    }
    if (l.def.type === "Slider") this.slide(l, x, y);
    if (Number(l.attrs.sendkey) === 1) this.send([0x65, this.page.id, l.def.id, 0x01, 0xff, 0xff, 0xff]);
    this.runEvent(l.def.events.down);
  }

  move(x: number, y: number) {
    x = Math.round(x);
    y = Math.round(y);
    if (this.tch[0] === 0 && this.tch[1] === 0 && !this.target && !this.pageTouched) return;
    this.tch[0] = x;
    this.tch[1] = y;
    const l = this.target;
    if (l && l.def.type === "Slider" && this.live.includes(l) && this.slide(l, x, y)) this.runEvent(l.def.events.slide);
  }

  release() {
    const l = this.target;
    const page = this.page;
    this.tch[0] = 0;
    this.tch[1] = 0;
    this.target = null;
    if (!this.touchcaps("up") || this.page !== page) return;
    if (!l) {
      if (this.pageTouched) this.runEvent(this.page.events.up);
      this.pageTouched = false;
      return;
    }
    if (!this.live.includes(l)) return;
    if (l.pressed) {
      l.pressed = false;
      if (l.vis) this.render(l);
    }
    if (Number(l.attrs.sendkey) === 1) this.send([0x65, this.page.id, l.def.id, 0x00, 0xff, 0xff, 0xff]);
    this.runEvent(l.def.events.up);
  }

  // --- time -------------------------------------------------------------------------------------

  /** The Timers of the page on show, through `ms` of virtual time. */
  advance(ms: number) {
    this.now += ms;
    const page = this.page;
    for (const l of this.live) {
      if (l.def.type !== "Timer" || Number(l.attrs.en) !== 1) continue;
      const tim = Math.max(50, Number(l.attrs.tim));
      l.elapsed += ms;
      while (l.elapsed >= tim && Number(l.attrs.en) === 1 && this.page === page) {
        l.elapsed -= tim;
        this.runEvent(l.def.events.timer);
      }
      if (this.page !== page) return;
    }
  }

  // --- what a view reads -------------------------------------------------------------------------

  /** the page's components with what they show now, for a view that lays its own drawing over */
  components() {
    return this.live.map((l) => ({ def: l.def, attrs: l.attrs, vis: l.vis }));
  }

  get sleeping() {
    return this.system.sleep === 1;
  }

  get brightness() {
    return this.system.dim;
  }
}

export { splitArgs };
