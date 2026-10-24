// A very small declarative validator.
//
// Not a general-purpose schema library: just enough to read the project's own
// JSON and report every problem at once, with the provenance every refusal in
// this system carries (issues.ts). Written by hand rather than pulled from npm
// for the same reason `export/` has no dependencies — the rules in this repo are
// measured facts about a panel, and the error text is part of the contract with
// whoever (or whatever) writes the JSON.
import type { IssueList, IssueSource } from "./issues.js";

export interface FieldOptions {
  /** whose rule this is, when the field is constrained by something real */
  source?: IssueSource;
  measuredIn?: string;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function requireObject(issues: IssueList, value: unknown, path = ""): Record<string, unknown> {
  if (isObject(value)) return value;
  issues.add({ path, rule: "expected-object", message: "expected a JSON object", source: "ours", got: value });
  return {};
}

export function requireString(
  issues: IssueList,
  obj: Record<string, unknown>,
  key: string,
  opts: FieldOptions & { pattern?: RegExp; maxLength?: number; oneOf?: readonly string[] } = {},
): string {
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) {
    issues.add({ path: key, rule: "missing-string", message: "a non-empty string is required", source: "ours", got: v });
    return "";
  }
  if (opts.pattern && !opts.pattern.test(v))
    issues.add({
      path: key, rule: "bad-format", message: `does not match ${opts.pattern}`,
      source: opts.source ?? "ours", measuredIn: opts.measuredIn, got: v,
    });
  if (opts.maxLength !== undefined && v.length > opts.maxLength)
    issues.add({
      path: key, rule: "too-long", message: `at most ${opts.maxLength} characters`,
      source: opts.source ?? "ours", measuredIn: opts.measuredIn, got: v.length,
    });
  if (opts.oneOf && !opts.oneOf.includes(v))
    issues.add({
      path: key, rule: "not-allowed", message: `must be one of ${opts.oneOf.join(", ")}`,
      source: opts.source ?? "ours", measuredIn: opts.measuredIn, got: v,
    });
  return v;
}

export function requireInt(
  issues: IssueList,
  obj: Record<string, unknown>,
  key: string,
  opts: FieldOptions & { min?: number; max?: number; default?: number } = {},
): number {
  const v = obj[key];
  if (v === undefined && opts.default !== undefined) return opts.default;
  if (typeof v !== "number" || !Number.isInteger(v)) {
    issues.add({ path: key, rule: "missing-integer", message: "an integer is required", source: "ours", got: v });
    return opts.default ?? 0;
  }
  if (opts.min !== undefined && v < opts.min)
    issues.add({
      path: key, rule: "below-minimum", message: `must be at least ${opts.min}`,
      source: opts.source ?? "ours", measuredIn: opts.measuredIn, got: v,
    });
  if (opts.max !== undefined && v > opts.max)
    issues.add({
      path: key, rule: "above-maximum", message: `must be at most ${opts.max}`,
      source: opts.source ?? "ours", measuredIn: opts.measuredIn, got: v,
    });
  return v;
}

/**
 * A fractional number, for the few tokens that are ratios rather than pixels
 * (an icon's share of its box). Separate from `requireInt` because rounding a
 * ratio to an integer turns 0.75 into 1 and silently fills the box.
 */
export function requireNumber(
  issues: IssueList,
  obj: Record<string, unknown>,
  key: string,
  opts: FieldOptions & { min?: number; max?: number } = {},
): number {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    issues.add({ path: key, rule: "missing-number", message: "a number is required", source: "ours", got: v });
    return 0;
  }
  if (opts.min !== undefined && v < opts.min)
    issues.add({ path: key, rule: "below-minimum", message: `must be at least ${opts.min}`, source: opts.source ?? "ours", got: v });
  if (opts.max !== undefined && v > opts.max)
    issues.add({ path: key, rule: "above-maximum", message: `must be at most ${opts.max}`, source: opts.source ?? "ours", got: v });
  return v;
}

export function requireArray(issues: IssueList, obj: Record<string, unknown>, key: string, opts: { min?: number } = {}): unknown[] {
  const v = obj[key];
  if (!Array.isArray(v)) {
    issues.add({ path: key, rule: "missing-array", message: "an array is required", source: "ours", got: v });
    return [];
  }
  if (opts.min !== undefined && v.length < opts.min)
    issues.add({ path: key, rule: "too-few", message: `at least ${opts.min} entr${opts.min === 1 ? "y" : "ies"}`, source: "ours", got: v.length });
  return v;
}

export function optionalString(obj: Record<string, unknown>, key: string, fallback = ""): string {
  const v = obj[key];
  return typeof v === "string" ? v : fallback;
}

export function optionalBoolean(obj: Record<string, unknown>, key: string, fallback = false): boolean {
  const v = obj[key];
  return typeof v === "boolean" ? v : fallback;
}

/**
 * Every document carries `schemaVersion`, and a reader refuses one it does not
 * know rather than guessing. A format nobody can version is a format nobody can
 * change.
 */
export function requireSchemaVersion(issues: IssueList, obj: Record<string, unknown>, supported: number): number {
  const v = obj.schemaVersion;
  if (typeof v !== "number" || !Number.isInteger(v)) {
    issues.add({ path: "schemaVersion", rule: "missing-schema-version", message: `an integer is required (this reader understands ${supported})`, source: "ours", got: v });
    return supported;
  }
  if (v > supported)
    issues.add({
      path: "schemaVersion", rule: "schema-too-new",
      message: `written for version ${v}, this reader understands ${supported}`, source: "ours", got: v,
    });
  // ...and too OLD is refused just as plainly.
  //
  // Only the "too new" half existed, so an older document fell through to the
  // field checks and came back as a list of missing fields -- a reader whose
  // document predated a version bump was told six things were wrong with it
  // rather than the one thing that was. Worse, a document that CLAIMED an old
  // version while happening to satisfy the current shape was accepted, which
  // makes the version field decorative: it would be read back, written back, and
  // never mean anything. Migration is a real answer, but silence is not one.
  if (v < supported)
    issues.add({
      path: "schemaVersion", rule: "schema-too-old",
      message: `written for version ${v}, this reader understands ${supported} — the document needs migrating, not patching field by field`,
      source: "ours", got: v,
    });
  return v;
}

/** Ids appear in generated names and in URLs, so they are deliberately dull. */
export const ID_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

export function uniqueBy<T>(
  issues: IssueList,
  items: readonly T[],
  key: (item: T) => string,
  what: string,
): void {
  const seen = new Map<string, number>();
  items.forEach((item, index) => {
    const k = key(item);
    const first = seen.get(k);
    if (first !== undefined)
      issues.add({ path: String(index), rule: "duplicate-id", message: `${what} "${k}" is already used at index ${first}`, source: "ours", got: k });
    else seen.set(k, index);
  });
}

/**
 * A list of short, non-empty strings — the shape every "what is this for" field
 * takes.
 *
 * A list and not a sentence because these are meant to be read as tags next to
 * the thing they describe ("title", "button label"), and because the same
 * element serving two purposes is the normal case: one colour is both the
 * screen's ground and a card's fill, one size of type is both a title and a
 * button's caption. A sentence forces the reader to parse prose to learn that,
 * and a catalogue that repeats the element once per purpose is worse still.
 */
export function requireStringArray(
  issues: IssueList,
  obj: Record<string, unknown>,
  key: string,
  opts: { min?: number; maxLength?: number } = {},
): string[] {
  const v = obj[key];
  if (!Array.isArray(v)) {
    issues.add({ path: key, rule: "missing-array", message: "an array of strings is required", source: "ours", got: v });
    return [];
  }
  const out: string[] = [];
  v.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      issues.add({ path: `${key}/${index}`, rule: "missing-string", message: "a non-empty string is required", source: "ours", got: entry });
      return;
    }
    if (opts.maxLength !== undefined && entry.length > opts.maxLength)
      issues.add({
        path: `${key}/${index}`, rule: "too-long", source: "ours",
        message: `at most ${opts.maxLength} characters — these are read as tags, not prose`,
        got: entry.length,
      });
    out.push(entry);
  });
  if (opts.min !== undefined && out.length < opts.min)
    issues.add({ path: key, rule: "too-few", message: `at least ${opts.min} entr${opts.min === 1 ? "y" : "ies"}`, source: "ours", got: out.length });
  return out;
}
