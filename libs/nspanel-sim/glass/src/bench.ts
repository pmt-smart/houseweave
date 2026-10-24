// The checks every compiled project is put through, on this emulator and in the
// Nextion Editor's debugger alike (export/scripts/panel-bench.mjs).
//
// A check is what a finger or the ESP32 does to the glass -- instruction lines,
// taps, holds, drags -- and what the glass does back: the bytes it sends and
// what it shows. Every check here is derived from the project itself, from the
// pages it compiled and the touch events its runtime manifest declares
// (export/scripts/build-project-hmi.mjs writes both). A page or a gesture added
// to a project is checked without anyone writing a check for it.
//
// The emulator is what the debugger is compared with. The same steps, with the
// same timing, run on both, and the two must send the same bytes and draw the
// same pixels. Where they disagree one of them is wrong about the Nextion, and
// the debugger is the vendor's own model of it.
import type { ZiFont } from "@nspanel-sim/export";
import { Glass, type Picture } from "./glass.js";
import type { ComponentDef, HmiDef, PageDef } from "./hmi.js";

/** How long a finger does each thing, the same on the emulator and in the debugger. */
export const BENCH_TIMING = {
  /** the cursor is put on the point this long before the button goes down */
  preMs: 120,
  /** a tap: down, this long, up */
  tapMs: 90,
  /** a hold, well past the 500 ms the pages' hold Timers wait (layout/src/wire.ts HOLD_MS) */
  holdMs: 900,
  /** a drag: the pause after down and before up */
  dragEdgeMs: 60,
  /** a drag: each step between two points */
  dragStepMs: 40,
  /** what the glass is given after every step before anything is read */
  settleMs: 500,
  /** between the keys of a sequence: short, or multi-tap could not cycle inside its window */
  keySettleMs: 150,
} as const;

export type BenchPoint = readonly [number, number];

export type BenchStep =
  /** instruction lines, as the ESP32 sends them (the debugger runs them from its input box) */
  | { lines: readonly string[] }
  | { tap: BenchPoint; settle?: number }
  | { hold: BenchPoint; settle?: number }
  /** down at the first point, through the others, up at the last */
  | { drag: readonly BenchPoint[]; settle?: number }
  | { wait: number };

export interface BenchCheck {
  /** "zone/mRow6.tap" */
  id: string;
  what: string;
  steps: readonly BenchStep[];
  /** the frames this check must send, by the start of their text: "ev,zone,mRow6,tap" */
  declares: readonly string[];
  /**
   * "exact": the debugger must send as many bytes as the emulator does. "some":
   * at least one frame, where the count depends on how the finger's speed falls
   * against a Timer's ticks (a slider reporting while it moves).
   */
  count: "exact" | "some";
  /** compare what the display shows after the check */
  shot: boolean;
  /** the component the finger is meant to land on, for the emulator to confirm */
  target?: string;
  /**
   * Boxes the pixel comparison leaves out: where the emulator draws a thing its
   * own way because nobody has measured the Nextion's. A Qrcode's:
   * the Nextion encodes and draws the symbol, and which version, mask and module
   * size it picks is not known.
   */
  unmeasured?: readonly { x: number; y: number; w: number; h: number }[];
}

export interface BenchSession {
  /** the page's name */
  id: string;
  page: string;
  what: string;
  checks: BenchCheck[];
}

/** A touch event as the runtime manifest declares it (build-project-hmi.mjs). */
export interface BenchEvent {
  page: string;
  objname: string;
  event: string;
  gesture: string;
  value?: boolean;
  text?: boolean;
}

/** A binding as the runtime manifest declares it: where the runtime writes a value, and how. */
export interface BenchBinding {
  page: string;
  objname: string;
  attribute: string;
  path: string;
  kind?: string;
}

export interface BenchProject {
  name: string;
  width: number;
  height: number;
  hmi: HmiDef;
  events: readonly BenchEvent[];
  bindings: readonly BenchBinding[];
}

/** The text a keyboard is seeded with before its OK is pressed. */
export const BENCH_TYPED = "Living room";

const center = (c: ComponentDef): BenchPoint => [c.x + Math.floor(c.w / 2), c.y + Math.floor(c.h / 2)];

/**
 * Where a finger lands on `target` and nothing else takes it: the centre of its
 * box, unless a component later on the page covers it there (the top one takes
 * a touch, even a Text with no event), and then the uncovered point nearest the
 * centre. Invisible components are not known here, so the page is taken as
 * compiled, which is what every check starts from.
 */
function landing(page: PageDef, target: ComponentDef): BenchPoint | null {
  const above = page.components.filter((c) => c.id > target.id && c.geometric);
  const covered = (x: number, y: number) => above.some((c) => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h);
  const [cx, cy] = center(target);
  if (!covered(cx, cy)) return [cx, cy];
  let best: BenchPoint | null = null;
  let bestD = Infinity;
  for (let y = target.y + 2; y < target.y + target.h - 2; y += 3) {
    for (let x = target.x + 2; x < target.x + target.w - 2; x += 3) {
      if (covered(x, y)) continue;
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < bestD) { bestD = d; best = [x, y]; }
    }
  }
  return best;
}

/** A straight drag from `a` to `b`, in steps a Timer polling the finger can sample. */
function path(a: BenchPoint, b: BenchPoint, steps: number): BenchPoint[] {
  const out: BenchPoint[] = [];
  for (let i = 0; i <= steps; i++) out.push([Math.round(a[0] + ((b[0] - a[0]) * i) / steps), Math.round(a[1] + ((b[1] - a[1]) * i) / steps)]);
  return out;
}

/** A drag through several points, each leg in steps. */
function through(points: readonly BenchPoint[], stepsPerLeg: number): BenchPoint[] {
  const out: BenchPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) out.push(...path(points[i - 1], points[i], stepsPerLeg).slice(1));
  return out;
}

/** The area below the header a plan's cards are drawn in: every check on it lands in there. */
const PLAN_TOP = 86;

/**
 * Every page as it loads, and every touch its runtime manifest declares, plus
 * the gestures a page carries out on the glass alone (a page change a swipe or
 * a tap makes without the ESP32). The checks of a page come in the order they
 * run, and a check that leaves the page is the last of its session.
 */
export function benchSessions(p: BenchProject): BenchSession[] {
  const zero = p.hmi.pages[0];
  const zeroVar = (name: string) => zero.components.some((c) => c.objname === name && c.type === "Vari");
  const sessions: BenchSession[] = [];

  for (const page of p.hmi.pages) {
    const events = p.events.filter((e) => e.page === page.name);
    const byName = new Map(page.components.map((c) => [c.objname, c]));
    const checks: BenchCheck[] = [];
    const keyboard = byName.has("kbShow");
    const shows = events.filter((e) => e.objname === "page" && (e.gesture === "show" || e.gesture === "version")).map((e) => `ev,${page.name},page,${e.gesture}`);

    // --- the page as it loads, from a known state of the globals --------------------------------
    const globals: string[] = [];
    if (zeroVar("vaLive")) globals.push(`${zero.name}.vaLive.val=0`);
    if (keyboard && zeroVar("kbIn")) globals.push(`${zero.name}.kbIn.txt="${BENCH_TYPED}"`, `${zero.name}.kbMax.val=20`, `${zero.name}.kbCaps.val=0`);
    checks.push({
      id: `${page.name}/load`, what: `${page.name} loads`, steps: [{ lines: [...globals, `page ${page.name}`] }],
      declares: shows, count: "exact", shot: true,
    });

    // --- what the runtime hides until a view needs it, shown -----------------------------------
    // The header's action exists only when the view has one, a list's rail
    // only when it has pages to turn, and a detail's slider only when the light
    // has the dimension (the manifest's `present`, `paged`, `pages` and `vis`
    // bindings). The debugger has no ESP32 to show them, so the check
    // does what the runtime would.
    const reveal: string[] = [];
    // and what the runtime may hide on this page, which a touch may find over what it touches (below)
    const hideable = new Set(p.bindings.filter((b) => b.page === page.name && (b.kind === "present" || b.kind === "vis")).map((b) => b.objname));
    for (const b of p.bindings) {
      if (b.page !== page.name || !byName.has(b.objname)) continue;
      if (b.kind === "present" || b.kind === "paged" || b.kind === "vis") reveal.push(`vis ${b.objname},1`);
      if (b.kind === "pages") reveal.push(`${b.objname}.maxval=2`, `${b.objname}.val=2`, `vis ${b.objname},1`);
    }
    if (reveal.length) checks.push({
      id: `${page.name}/reveal`, what: "what a view shows at run time, shown", steps: [{ lines: [...new Set(reveal)] }],
      declares: [], count: "exact", shot: true,
    });

    // --- every touch the manifest declares ----------------------------------------------------
    const last: BenchCheck[] = [];
    let touch: BenchCheck | undefined;
    const planPoint: BenchPoint = [Math.floor(p.width / 2), Math.floor((PLAN_TOP + p.height) / 2)];
    for (const e of events) {
      if (e.gesture === "show" || e.gesture === "version") continue;
      const declares = [`ev,${page.name},${e.objname},${e.gesture}`];
      const id = `${page.name}/${e.objname}.${e.gesture}`;
      // Every touch on the page says so as it lands, from its TouchCap, whatever
      // it turns out to be: a tap in the middle is one, and what
      // else it sends is the component's under it. Last of all, on the page
      // loaded again, because that tap may leave it: the screensaver's does.
      if (e.gesture === "touch") {
        touch = {
          id, what: "a touch says so as it lands",
          steps: [{ lines: [`page ${page.name}`] }, { tap: [Math.floor(p.width / 2), Math.floor(p.height / 2)] }],
          declares, count: "some", shot: false,
        };
        continue;
      }
      const target = byName.get(e.objname);

      if (e.objname === "plan") {
        checks.push({
          id, what: `a ${e.gesture} on the plan`, steps: [e.gesture === "hold" ? { hold: planPoint } : { tap: planPoint }],
          declares, count: "exact", shot: false,
        });
        continue;
      }
      if (e.objname === "page" && (e.gesture === "up" || e.gesture === "down")) {
        const x = Math.round(p.width * 0.4);
        const [t, b] = [Math.round(p.height * 0.35), Math.round(p.height * 0.85)];
        const from: BenchPoint = e.gesture === "up" ? [x, b] : [x, t];
        const to: BenchPoint = e.gesture === "up" ? [x, t] : [x, b];
        checks.push({ id, what: `a swipe ${e.gesture} on the list`, steps: [{ drag: path(from, to, 10) }], declares, count: "exact", shot: false });
        continue;
      }
      if (e.objname === "page" && (e.gesture === "left" || e.gesture === "right")) {
        const [l, r] = [Math.round(p.width * 0.25), Math.round(p.width * 0.75)];
        const from: BenchPoint = e.gesture === "left" ? [r, planPoint[1]] : [l, planPoint[1]];
        const to: BenchPoint = e.gesture === "left" ? [l, planPoint[1]] : [r, planPoint[1]];
        checks.push({ id, what: `a swipe ${e.gesture}`, steps: [{ drag: path(from, to, 10) }], declares, count: "exact", shot: false });
        continue;
      }
      if (e.objname === "pad1") {
        // the lock's nine dots: an L through the top row and down the right
        const dot = (n: number) => byName.get(`tDot${n}`);
        const dots = [1, 2, 3, 6, 9].map(dot).filter((c): c is ComponentDef => !!c);
        if (dots.length !== 5) continue;
        checks.push({
          id, what: "a pattern drawn across the dots", steps: [{ drag: through(dots.map(center), 6) }],
          declares, count: "exact", shot: true,
        });
        continue;
      }
      if (!target) continue;

      if (target.type === "Slider") {
        const vertical = Number(target.attrs.mode) === 1;
        const [cx, cy] = center(target);
        const a: BenchPoint = vertical ? [cx, target.y + Math.round(target.h * 0.2)] : [target.x + Math.round(target.w * 0.3), cy];
        const b: BenchPoint = vertical ? [cx, target.y + Math.round(target.h * 0.8)] : [target.x + Math.round(target.w * 0.7), cy];
        // A slider whose move event does not read the live flag reports while it
        // moves whatever the panel says (the placement asked for it), so how many
        // frames a drag sends depends on the finger against its 100 ms Timer.
        const gated = (target.events.slide ?? []).some((l) => l.includes("vaLive"));
        if (e.gesture === "change") {
          checks.push({ id, what: `${e.objname} dragged and let go`, steps: [{ drag: path(a, b, 8) }], declares, count: gated ? "exact" : "some", shot: true, target: e.objname });
        } else if (e.gesture === "slide" && zeroVar("vaLive")) {
          // reporting while it moves is the panel's live setting, a global the page reads
          checks.push({
            id, what: `${e.objname} reporting while it moves`,
            steps: [{ lines: [`${zero.name}.vaLive.val=1`] }, { drag: path(b, a, 16) }, { lines: [`${zero.name}.vaLive.val=0`] }],
            declares, count: "some", shot: false, target: e.objname,
          });
        }
        continue;
      }

      let at = landing(page, target);
      // A target covered whole by what the runtime hides, the placements that take turns with its own in one place (`alternate`, project
      // schema 14: the house's icons and the mesh's buttons), is touched as the runtime has it: those hidden, and shown again after
      let hidden: string[] = [];
      if (!at) {
        const over = page.components.filter((c) => c.id > target.id && c.geometric &&
          c.x < target.x + target.w && target.x < c.x + c.w && c.y < target.y + target.h && target.y < c.y + c.h);
        if (over.length > 0 && over.every((c) => hideable.has(c.objname))) {
          hidden = over.map((c) => c.objname);
          at = center(target);
        }
      }
      if (!at) continue;
      const hide: BenchStep[] = hidden.length > 0 ? [{ lines: hidden.map((o) => `vis ${o},0`) }] : [];
      const show: BenchStep[] = hidden.length > 0 ? [{ lines: hidden.map((o) => `vis ${o},1`) }] : [];
      if (e.gesture === "hold") checks.push({ id, what: `a hold on ${e.objname}`, steps: [...hide, { hold: at }, ...show], declares, count: "exact", shot: false, target: e.objname });
      else if (e.gesture === "tap" || e.gesture === "text") {
        checks.push({
          id, what: e.gesture === "text" ? `${e.objname} sends the typed line` : `a tap on ${e.objname}`, steps: [...hide, { tap: at }, ...show],
          declares, count: "exact", shot: false, target: e.objname,
        });
      }
    }

    // --- what a page does on the glass alone ----------------------------------------------------
    const tail = byName.get("hPageEnd0");
    const rail = byName.get("hPage0");
    if (tail && rail) {
      const at = landing(page, tail);
      if (at) checks.push({
        id: `${page.name}/hPageEnd0.tap`, what: "the rail's tail turns to the last page",
        steps: [{ lines: [`hPage0.val=2`] }, { tap: at }], declares: [`ev,${page.name},hPage0,change`], count: "exact", shot: true, target: "hPageEnd0",
      });
    }
    if (page.id === 0 && zero.components.some((c) => c.objname === "tcGest")) {
      // a tap on the screensaver brings the plan up, with no ESP32 in the path
      last.push({
        id: `${page.name}/tap`, what: "a tap wakes the panel to its Home", steps: [{ tap: [Math.floor(p.width / 2), Math.floor(p.height / 2)] }],
        declares: [`ev,home,page,show`], count: "exact", shot: true,
      });
    }
    checks.push(...last);
    if (touch) checks.push(touch);
    // a page's Qrcodes are drawn by the Nextion's own encoder, which is not measured
    const unmeasured = page.components.filter((c) => c.type === "Qrcode" && c.geometric).map((c) => ({ x: c.x, y: c.y, w: c.w, h: c.h }));
    if (unmeasured.length) for (const c of checks) c.unmeasured = unmeasured;
    sessions.push({ id: page.name, page: page.name, what: `${page.name}: ${checks.length} checks`, checks });
  }
  return sessions;
}

// ---------------------------------------------------------------------------------------------

/** What a frame or a reply the glass sent reads as. */
export interface BenchMessage {
  /** "frame": the pages' 55 BB frames; "reply": a Nextion answer ending FF FF FF */
  kind: "frame" | "reply";
  bytes: number;
  /** a frame's text, or a reply's first byte in hex */
  text: string;
}

/**
 * The bytes the glass sent, split the way they were written: the pages'
 * frames (55 BB, a little-endian length, the text, a two-byte CRC) and the
 * Nextion's own replies, each ending FF FF FF.
 */
export function benchMessages(bytes: Uint8Array): BenchMessage[] {
  const out: BenchMessage[] = [];
  let i = 0;
  while (i < bytes.length) {
    if (bytes[i] === 0x55 && bytes[i + 1] === 0xbb && i + 4 <= bytes.length) {
      const len = bytes[i + 2] | (bytes[i + 3] << 8);
      const text = new TextDecoder().decode(bytes.subarray(i + 4, i + 4 + len));
      out.push({ kind: "frame", bytes: 6 + len, text });
      i += 6 + len;
      continue;
    }
    let j = i;
    while (j < bytes.length && !(bytes[j] === 0xff && bytes[j + 1] === 0xff && bytes[j + 2] === 0xff)) j++;
    const end = Math.min(bytes.length, j + 3);
    out.push({ kind: "reply", bytes: end - i, text: bytes[i].toString(16).padStart(2, "0") });
    i = end;
  }
  return out;
}

export interface BenchOutcome {
  /** everything the glass sent during the check */
  sent: Uint8Array;
  messages: BenchMessage[];
  /** what the finger landed on, for each tap or hold (null for none) */
  landed: (string | null)[];
}

/**
 * The emulator, run through checks with the debugger's timing. One instance for
 * a whole run, like the debugger's one session: what a check leaves on the glass
 * is what the next one starts from.
 */
export class BenchOracle {
  readonly glass: Glass;
  private sent: number[] = [];

  constructor(hmi: HmiDef, opts: { width: number; height: number; fonts: (ZiFont | undefined)[]; pictures: (Picture | undefined)[] }) {
    this.glass = new Glass(hmi, { ...opts, send: (b) => { for (const x of b) this.sent.push(x); } });
    this.glass.start();
    this.sent = [];
  }

  private tick(ms: number) {
    // in slices, so a Timer sees the time pass as it does in real time
    for (let t = 0; t < ms; t += 10) this.glass.advance(Math.min(10, ms - t));
  }

  /** Runs one check and returns what the glass sent during it. */
  run(check: BenchCheck): BenchOutcome {
    this.sent = [];
    const landed: (string | null)[] = [];
    const T = BENCH_TIMING;
    for (const s of check.steps) {
      // over the UART, as the debugger's input box sends them: Protocol Reparse applies
      if ("lines" in s) for (const l of s.lines) this.glass.receive(Uint8Array.from([...new TextEncoder().encode(l), 0xff, 0xff, 0xff]));
      else if ("tap" in s || "hold" in s) {
        const [x, y] = "tap" in s ? s.tap : s.hold;
        landed.push(this.glass.hit(x, y)?.def.objname ?? null);
        this.tick(T.preMs);
        this.glass.press(x, y);
        this.tick("tap" in s ? T.tapMs : T.holdMs);
        this.glass.release();
      } else if ("drag" in s) {
        const [first, ...rest] = s.drag;
        this.tick(T.preMs);
        this.glass.press(first[0], first[1]);
        this.tick(T.dragEdgeMs);
        for (const [x, y] of rest) { this.glass.move(x, y); this.tick(T.dragStepMs); }
        this.tick(T.dragEdgeMs);
        this.glass.release();
      } else { this.tick(s.wait); continue; }
      this.tick("settle" in s && s.settle !== undefined ? s.settle : T.settleMs);
    }
    const sent = Uint8Array.from(this.sent);
    return { sent, messages: benchMessages(sent), landed };
  }

  /** The display as it is now, RGB565. */
  pixels(): Uint16Array {
    return Uint16Array.from(this.glass.frame.pixels);
  }
}
