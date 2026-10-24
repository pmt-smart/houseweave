// What a refusal looks like.
//
// The content of this project is JSON that a person or a model writes, so a
// refusal is an interface, not a log line. Every issue says WHERE in the
// document, WHAT rule, and — the part that matters most when a generation fails
// — WHOSE rule it is: the Nextion Editor's, measured, with the scenario that
// measured it; or ours, a policy we chose and can revisit.
//
// The pattern comes from export/src/attrRanges.ts, which already tags its
// measured ranges with `ours`.

/** Whose rule was broken. */
export type IssueSource =
  /** the Nextion Editor imposes it; `measuredIn` names the scenario that proved it */
  | "editor"
  /** the panel's hardware or the compiled format imposes it (RAM, flash, screen) */
  | "hardware"
  /** we chose to be stricter than the Editor */
  | "ours";

export interface Issue {
  /** JSON Pointer-ish path into the document: `pages/2/slots/0/font` */
  path: string;
  /** stable identifier, kebab-case, so a caller can react without parsing prose */
  rule: string;
  /** one sentence, in English like the rest of the code */
  message: string;
  source: IssueSource;
  /** for `editor` and `hardware`: the scenario or section that measured it */
  measuredIn?: string;
  /** what was found, when showing it helps */
  got?: unknown;
  /** what was expected, when it can be stated shortly */
  want?: string;
}

export class ValidationError extends Error {
  readonly issues: readonly Issue[];
  constructor(what: string, issues: readonly Issue[]) {
    super(`${what}: ${issues.length} problem${issues.length === 1 ? "" : "s"}\n${issues.map(formatIssue).join("\n")}`);
    this.name = "ValidationError";
    this.issues = issues;
  }
}

export function formatIssue(i: Issue): string {
  const who = i.source === "editor" ? "Editor" : i.source === "hardware" ? "hardware" : "our rule";
  const where = i.measuredIn ? `, measured in ${i.measuredIn}` : "";
  const got = i.got === undefined ? "" : ` (got ${JSON.stringify(i.got)}${i.want ? `, want ${i.want}` : ""})`;
  return `  ${i.path}: ${i.message}${got} [${i.rule}; ${who}${where}]`;
}

/** Collects issues so a document is reported whole instead of one error at a time. */
export class IssueList {
  private readonly items: Issue[] = [];
  private readonly prefix: string;

  constructor(prefix = "") {
    this.prefix = prefix;
  }

  /** A view that prefixes every path, for descending into a sub-document. */
  at(segment: string | number): IssueList {
    const child = new IssueList(this.prefix ? `${this.prefix}/${segment}` : String(segment));
    // share the same array so the parent sees everything the child adds
    (child as unknown as { items: Issue[] }).items = this.items;
    return child;
  }

  add(issue: Omit<Issue, "path"> & { path?: string }): void {
    const tail = issue.path ?? "";
    const path = [this.prefix, tail].filter(Boolean).join("/") || "(root)";
    this.items.push({ ...issue, path });
  }

  get length(): number {
    return this.items.length;
  }

  all(): readonly Issue[] {
    return this.items;
  }

  /** Throws if anything was collected; otherwise returns the value untouched. */
  check<T>(what: string, value: T): T {
    if (this.items.length) throw new ValidationError(what, this.items);
    return value;
  }
}
