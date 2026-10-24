// THE FIRST DESIGN OF THE RULE, kept ONLY AS A LABELLED CONTROL. It is not the rule: the rule is the
// version vector and the set of heads of alarm-merge-ref.mjs. This file keeps the mechanism it replaced, so that alarm-merge.test.mjs
// can still show where it fails and that the decided rule does not:
//   - the history of the last 8 points is a window (finding F1: a bridge that sat out 9 actions comes back with an old copy that
//     nothing places, and the safe side lets it win: the house ends disarmed with no one having disarmed it);
//   - one record, and the winner of each pair discarding the loser, is not one order (finding F2: B beats C, A beats B, C beats A, so
//     the state after a join depends on who meets whom first, and a later arm can be lost).
// It also serves as the replica the controls of the tests run (R1 and R2) with another pairwise rule.
import {
  ST, ST_NAME, TimelineNode, mkDot, dotText, tlEq, tlText, markOf, markAdd, markCmp, safeSide, sameActionPick, BASE_UP_MS, HOUSE_TIMELINE,
  MAX_COUNTER, TICK_MS,
} from "./alarm-merge-ref.mjs";

export const LEGACY_HIST = 8;

export function mkLegacyRecord({ st, dot, hist = [], tl, m, trusted = true, lost = 0 }, cap = LEGACY_HIST) {
  if (hist.length > cap) throw new RangeError(`history of ${hist.length} points (the cap is ${cap})`);
  return Object.freeze({ st, dot, hist: Object.freeze([...hist]), tl: Object.freeze({ n: tl.n, e: tl.e }), m: m >>> 0, trusted: !!trusted, lost });
}

// the pairwise rule of the first design: one record wins, the other is discarded
export function legacyMerge(a, b) {
  if (a.dot === b.dot) return { win: sameActionPick(a, b), layer: "same" };
  if (b.hist.includes(a.dot)) return { win: b, layer: "descent" };
  if (a.hist.includes(b.dot)) return { win: a, layer: "descent" };
  if (tlEq(a.tl, b.tl) && a.trusted && b.trusted) {
    const c = markCmp(a.m, b.m);
    if (c !== 0) return { win: c > 0 ? a : b, layer: "clock" };
    return { win: safeSide(a, b), layer: "tie" };
  }
  return { win: safeSide(a, b), layer: "safe" };
}

const dedupe = (list) => { const seen = new Set(); return list.filter((d) => (seen.has(d) ? false : (seen.add(d), true))); };

export class LegacyReplica extends TimelineNode {
  // histCap: 8 is the first design; Infinity is "the first design with the whole history", which the tests use to show that
  // the window (F1) is not the only thing that was wrong (F2 remains)
  constructor(id, persisted, rule = legacyMerge, { histCap = LEGACY_HIST } = {}) {
    super(id, persisted);
    this.cap = histCap;
    this.rule = rule;
    this.rec = persisted.rec;
    this.startLife({ epochOk: true, keepEpoch: true, tl: persisted.tl, off: persisted.off });
  }

  // the history is rebuilt from the persisted record alone
  _rebuild() { this.seen = [this.rec.dot, ...this.rec.hist].slice(0, this.cap); }
  _translate(old, d) {
    if (tlEq(this.rec.tl, old)) this.rec = mkLegacyRecord({ ...this.rec, tl: this.tl, m: markAdd(this.rec.m, Math.round(d / TICK_MS)) }, this.cap);
  }

  hello(up) { return { tl: { ...this.tl }, mesh: this.mesh(up), digest: this.rec.dot, count: 1, synced: this.isSynced(up) }; }
  offer() { return [this.rec]; }
  sig() { return `${this.rec.dot}|${this.rec.tl.n}.${this.rec.tl.e}|${this.rec.m}`; }
  get state() { return ST_NAME[this.rec.st]; }

  take(list) {
    let res = null;
    for (const r of Array.isArray(list) ? list : [list]) res = this._takeOne(r);
    return res;
  }
  _takeOne(r) {
    const mine = this.rec;
    const { win, layer } = this.rule(mine, r);
    const lose = win === mine ? r : mine;
    // the history keeps the WINNER's lineage first and only then the loser's
    this.seen = dedupe([win.dot, ...win.hist, lose.dot, ...lose.hist, ...this.seen]).slice(0, this.cap);
    this.rec = win;
    return { changed: win.dot !== mine.dot || win.tl.n !== mine.tl.n || win.tl.e !== mine.tl.e || win.m !== mine.m, layer, win };
  }

  act(kind, up, opts = {}) {
    const st = ST[kind];
    if (this.ctr >= MAX_COUNTER) throw new RangeError("the dot counter is exhausted");
    this.ctr += 1;
    const dot = mkDot(this.id, this.ctr);
    const hist = this.seen.slice(0, this.cap);
    this.rec = mkLegacyRecord({ st, dot, hist, tl: this.tl, m: markOf(this.mesh(up)), trusted: this.trusted, lost: opts.lost ?? 0 }, this.cap);
    this.seen = [dot, ...hist].slice(0, this.cap);
    return this.rec;
  }

  describe() {
    const r = this.rec;
    return { state: ST_NAME[r.st], dot: dotText(r.dot), timeline: tlText(r.tl), mark: r.m, trusted: r.trusted, lost: r.lost, history: r.hist.map(dotText) };
  }
}

export function baseLegacyRecord(st) {
  return mkLegacyRecord({ st: ST[st], dot: mkDot(1, 1), hist: [], tl: HOUSE_TIMELINE, m: markOf(BASE_UP_MS + 80_000) });
}
export function steadyLegacy(id, st, rule = legacyMerge, opts = {}, Cls = LegacyReplica) {
  return new Cls(id, { rec: baseLegacyRecord(st), ctr: id === 1 ? 1 : 0, epoch: 1, tl: HOUSE_TIMELINE, off: 0 }, rule, opts);
}
