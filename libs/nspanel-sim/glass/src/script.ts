// The Nextion instruction language, as far as the generator writes it and the
// panel's Berry sends it: event code (a component's Touch Press, a Timer's
// tick, a page's load) and the instructions that come over the UART are the
// same language, and both run here.
//
// What it is, as measured and documented:
//
//   - one statement per line; `if(cond)` with its block in braces on lines of
//     their own, and `}else` / `}else if(cond)` after it;
//   - an expression is evaluated strictly left to right, without precedence:
//     `2+3*4` is 20 on the glass. Every expression the generator writes means
//     the same both ways, and this is the glass's way;
//   - numbers are 32-bit signed; a string is BYTES (the page's encoding is
//     UTF-8, so `btlen` counts bytes and `-=1` takes one off): here a string
//     is a JS string of one char per byte, a "byte string";
//   - there is no `return`, no loop, no parenthesised sub-expression in what
//     the generator writes, and none is accepted here.

export type Value = number | string;

export type Cond =
  | { kind: "cmp"; left: string; op: "==" | "!=" | "<" | "<=" | ">" | ">="; right: string }
  | { kind: "and" | "or"; left: Cond; right: Cond };

export type Statement =
  | { kind: "if"; cond: Cond; then: Statement[]; else?: Statement[] }
  | { kind: "assign"; target: string; op: string; expr: string }
  | { kind: "cmd"; name: string; args: string[]; line: string };

export class ScriptError extends Error {
  readonly code: number;

  constructor(message: string, code = 0x00) {
    super(message);
    this.code = code;
  }
}

/** The arguments of an instruction: split at commas outside quotes. */
export function splitArgs(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\" && quoted && i + 1 < text.length) {
      cur += c + text[++i];
      continue;
    }
    if (c === '"') quoted = !quoted;
    if (c === "," && !quoted) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim() !== "" || out.length > 0) out.push(cur.trim());
  return out;
}

const COMPARE = /^(.*?)(==|!=|<=|>=|<|>)(.*)$/;

function parseCond(text: string): Cond {
  // && and || are not in what the generator writes; read left to right if they come
  const or = splitTop(text, "||");
  if (or.length > 1) return or.map(parseCond).reduce((l, r) => ({ kind: "or", left: l, right: r }));
  const and = splitTop(text, "&&");
  if (and.length > 1) return and.map(parseCond).reduce((l, r) => ({ kind: "and", left: l, right: r }));
  const m = COMPARE.exec(text.trim());
  if (!m) throw new ScriptError(`not a condition: ${text}`);
  return { kind: "cmp", left: m[1].trim(), op: m[2] as "==", right: m[3].trim() };
}

function splitTop(text: string, sep: string): string[] {
  const out: string[] = [];
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') quoted = !quoted;
    if (!quoted && text.startsWith(sep, i)) {
      out.push(text.slice(start, i));
      start = i + sep.length;
      i += sep.length - 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

const ASSIGN = /^([A-Za-z_][\w.[\]]*)\s*(\+=|-=|\*=|\/=|%=|=)(.*)$/;

/** One line that is not a block's structure: an assignment or an instruction. */
export function parseSimple(line: string): Statement {
  const m = ASSIGN.exec(line);
  // "a==b" is not an assignment; an instruction starts with its name and a space
  if (m && !m[3].startsWith("=")) return { kind: "assign", target: m[1], op: m[2], expr: m[3].trim() };
  const sp = line.search(/\s/);
  const name = sp < 0 ? line : line.slice(0, sp);
  const rest = sp < 0 ? "" : line.slice(sp + 1);
  return { kind: "cmd", name, args: rest.trim() === "" ? [] : splitArgs(rest), line };
}

/** A block of event code, as the generator lays it out. */
export function parseScript(lines: readonly string[]): Statement[] {
  const src = lines.map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("//"));
  let i = 0;
  const block = (): Statement[] => {
    const out: Statement[] = [];
    while (i < src.length) {
      const line = src[i];
      if (line.startsWith("}")) return out;
      i++;
      if (/^if\s*\(/.test(line)) out.push(ifStatement(line));
      else if (line === "{") out.push(...inner());
      else out.push(parseSimple(line));
    }
    return out;
  };
  const inner = (): Statement[] => {
    const body = block();
    if (i >= src.length) throw new ScriptError("a block is not closed");
    // leave a "}else..." line for the caller to read
    if (src[i] === "}") i++;
    return body;
  };
  const condOf = (line: string) => {
    const open = line.indexOf("(");
    const close = line.lastIndexOf(")");
    if (open < 0 || close < open) throw new ScriptError(`not an if: ${line}`);
    return parseCond(line.slice(open + 1, close));
  };
  const ifStatement = (line: string): Statement => {
    const cond = condOf(line);
    if (src[i] !== "{") throw new ScriptError(`if without a block: ${line}`);
    i++;
    const then = block();
    if (i >= src.length) throw new ScriptError("an if is not closed");
    const closing = src[i];
    i++;
    const tail = closing.slice(1).trim();
    let elseLine = tail;
    if (tail === "" && src[i] !== undefined && /^else\b/.test(src[i])) elseLine = src[i++];
    if (elseLine === "") return { kind: "if", cond, then };
    if (/^else\s*if\s*\(/.test(elseLine)) return { kind: "if", cond, then, else: [ifStatement(elseLine.replace(/^else\s*/, ""))] };
    if (elseLine === "else") {
      if (src[i] !== "{") throw new ScriptError("else without a block");
      i++;
      return { kind: "if", cond, then, else: inner() };
    }
    throw new ScriptError(`after a block: ${closing}`);
  };
  const out = block();
  if (i < src.length) throw new ScriptError(`a stray line: ${src[i]}`);
  return out;
}

// --- expressions ------------------------------------------------------------------------------

type Token = { kind: "num"; value: number } | { kind: "str"; value: string } | { kind: "ref"; name: string } | { kind: "op"; op: string };

/** a string literal's bytes: the line's own, with \" \\ \r \n */
function unquote(body: string): string {
  return body.replace(/\\(["\\rn])/g, (_, c: string) => (c === "r" ? "\r" : c === "n" ? "\n" : c));
}

export function tokenize(expr: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (c === '"') {
      let j = i + 1;
      let body = "";
      while (j < expr.length && expr[j] !== '"') {
        if (expr[j] === "\\" && j + 1 < expr.length) { body += expr[j] + expr[j + 1]; j += 2; continue; }
        body += expr[j++];
      }
      if (j >= expr.length) throw new ScriptError(`a string is not closed: ${expr}`, 0x20);
      out.push({ kind: "str", value: unquote(body) });
      i = j + 1;
      continue;
    }
    const num = /^(0x[0-9a-fA-F]+|\d+)/.exec(expr.slice(i));
    // a number, unless it is the start of a name (a leading digit never is one)
    if (num && (out.length === 0 || out[out.length - 1].kind === "op")) {
      out.push({ kind: "num", value: Number(num[1]) | 0 });
      i += num[1].length;
      continue;
    }
    const op = /^(<<|>>|[-+*/%&|^])/.exec(expr.slice(i));
    if (op) {
      out.push({ kind: "op", op: op[1] });
      i += op[1].length;
      continue;
    }
    const ref = /^[A-Za-z_][\w.[\]]*/.exec(expr.slice(i));
    if (ref) {
      out.push({ kind: "ref", name: ref[0] });
      i += ref[0].length;
      continue;
    }
    throw new ScriptError(`cannot read ${expr.slice(i)}`);
  }
  return out;
}

/** Evaluates left to right, as the glass does; `read` resolves a name. */
export function evaluate(expr: string, read: (name: string) => Value): Value {
  const tokens = tokenize(expr);
  if (tokens.length === 0) throw new ScriptError("an empty expression");
  let pos = 0;
  const operand = (): Value => {
    const t = tokens[pos++];
    if (!t) throw new ScriptError(`an expression ends early: ${expr}`);
    if (t.kind === "num" || t.kind === "str") return t.value;
    if (t.kind === "ref") return read(t.name);
    // a leading minus: 0 - operand
    if (t.op === "-") return -(Number(operand()) | 0) | 0;
    throw new ScriptError(`an operator where a value goes: ${expr}`);
  };
  let acc = operand();
  while (pos < tokens.length) {
    const t = tokens[pos++];
    if (t.kind !== "op") throw new ScriptError(`two values in a row: ${expr}`);
    const rhs = operand();
    if (typeof acc === "string" || typeof rhs === "string") {
      if (t.op !== "+") throw new ScriptError(`${t.op} on text: ${expr}`, 0x1b);
      acc = String(acc) + String(rhs);
      continue;
    }
    const a = acc | 0;
    const b = rhs | 0;
    switch (t.op) {
      case "+": acc = (a + b) | 0; break;
      case "-": acc = (a - b) | 0; break;
      case "*": acc = Math.imul(a, b); break;
      case "/": acc = b === 0 ? 0 : (a / b) | 0; break;
      case "%": acc = b === 0 ? 0 : a % b; break;
      case "&": acc = a & b; break;
      case "|": acc = a | b; break;
      case "^": acc = a ^ b; break;
      case "<<": acc = a << b; break;
      case ">>": acc = a >> b; break;
    }
  }
  return acc;
}

export function compare(left: Value, op: string, right: Value): boolean {
  if (typeof left === "string" || typeof right === "string") {
    const l = String(left);
    const r = String(right);
    if (op === "==") return l === r;
    if (op === "!=") return l !== r;
    throw new ScriptError(`${op} on text`, 0x1b);
  }
  switch (op) {
    case "==": return left === right;
    case "!=": return left !== right;
    case "<": return left < right;
    case "<=": return left <= right;
    case ">": return left > right;
    default: return left >= right;
  }
}
