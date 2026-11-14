import { QUEST_FNS, type BinOp, type Expr, type QuestFn } from "./types.js";

/**
 * Easy Dialogue's expression language plus quest functions:
 *   delivered >= 3 and not mango      has(balm)      done(village_delivery)      step(q, temple)
 * Identifiers may start with `$` (Yarn style); the `$` is dropped. Function arguments that are bare
 * names (items, quests, steps, event words) are passed as names, not variable values.
 */

export class ExprError extends Error {
  constructor(message: string, public col: number) {
    super(message);
  }
}

type Tok =
  | { t: "num"; v: number; col: number }
  | { t: "str"; v: string; col: number }
  | { t: "id"; v: string; col: number }
  | { t: "op"; v: string; col: number }
  | { t: "eof"; col: number };

const ID_START = /[\p{L}_$]/u;
const ID_PART = /[\p{L}\p{M}\p{N}_]/u;
const OPS = ["==", "!=", "<=", ">=", "&&", "||", "<", ">", "+", "-", "*", "/", "%", "!", "(", ")", ","];

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^[0-9]*\.?[0-9]+/.exec(src.slice(i))!;
      out.push({ t: "num", v: Number(m[0]), col: i });
      i += m[0].length;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== ch) {
        if (src[j] === "\\" && j + 1 < src.length) j++;
        s += src[j];
        j++;
      }
      if (j >= src.length) throw new ExprError("Unterminated string", i);
      out.push({ t: "str", v: s, col: i });
      i = j + 1;
      continue;
    }
    if (ID_START.test(ch)) {
      let j = i + 1;
      while (j < src.length && ID_PART.test(src[j]!)) j++;
      let name = src.slice(i, j);
      if (name.startsWith("$")) name = name.slice(1);
      if (!name) throw new ExprError("Expected a variable name after $", i);
      out.push({ t: "id", v: name, col: i });
      i = j;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      out.push({ t: "op", v: op, col: i });
      i += op.length;
      continue;
    }
    if (ch === "=") throw new ExprError("Use == to compare (a single = is only for ~ set)", i);
    throw new ExprError(`Unexpected character "${ch}"`, i);
  }
  out.push({ t: "eof", col: src.length });
  return out;
}

const PREC: Record<string, number> = {
  or: 1,
  and: 2,
  "==": 3,
  "!=": 3,
  "<": 4,
  "<=": 4,
  ">": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
};

function binOpOf(tok: Tok): BinOp | null {
  if (tok.t === "op") {
    if (tok.v === "&&") return "and";
    if (tok.v === "||") return "or";
    if (tok.v in PREC) return tok.v as BinOp;
  }
  if (tok.t === "id" && (tok.v === "and" || tok.v === "or")) return tok.v;
  return null;
}

export function parseExpr(src: string): Expr {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p]!;
  const next = () => toks[p++]!;

  function primary(): Expr {
    const tok = next();
    if (tok.t === "num") return { k: "num", v: tok.v };
    if (tok.t === "str") return { k: "str", v: tok.v };
    if (tok.t === "id") {
      if (tok.v === "true" || tok.v === "false") return { k: "bool", v: tok.v === "true" };
      if (tok.v === "not") return { k: "un", op: "not", a: unary() };
      if (tok.v === "and" || tok.v === "or") throw new ExprError(`Unexpected "${tok.v}"`, tok.col);
      const open = peek();
      if (open.t === "op" && open.v === "(") {
        if (!(QUEST_FNS as readonly string[]).includes(tok.v)) {
          throw new ExprError(`Unknown function "${tok.v}" — use ${QUEST_FNS.join(", ")}`, tok.col);
        }
        next();
        const args: Expr[] = [];
        const close = peek();
        if (close.t === "op" && close.v === ")") next();
        else {
          for (;;) {
            args.push(binary(0));
            const sep = next();
            if (sep.t === "op" && sep.v === ")") break;
            if (sep.t !== "op" || sep.v !== ",") throw new ExprError(`Expected , or ) in ${tok.v}(…)`, sep.col);
          }
        }
        return { k: "call", f: tok.v as QuestFn, args };
      }
      return { k: "var", n: tok.v };
    }
    if (tok.t === "op" && tok.v === "(") {
      const e = binary(0);
      const close = next();
      if (close.t !== "op" || close.v !== ")") throw new ExprError("Missing )", close.col);
      return e;
    }
    if (tok.t === "eof") throw new ExprError("Expression is incomplete", tok.col);
    throw new ExprError(`Unexpected "${"v" in tok ? tok.v : "?"}"`, tok.col);
  }

  function unary(): Expr {
    const tok = peek();
    if (tok.t === "op" && (tok.v === "!" || tok.v === "-")) {
      next();
      return { k: "un", op: tok.v === "!" ? "not" : "-", a: unary() };
    }
    return primary();
  }

  function binary(minPrec: number): Expr {
    let left = unary();
    for (;;) {
      const op = binOpOf(peek());
      if (!op || PREC[op]! < minPrec) break;
      next();
      const right = binary(PREC[op]! + 1);
      left = { k: "bin", op, a: left, b: right };
    }
    return left;
  }

  const e = binary(0);
  const rest = peek();
  if (rest.t !== "eof") throw new ExprError(`Unexpected "${"v" in rest ? rest.v : ""}"`, rest.col);
  return e;
}

/** Variable (flag) names an expression reads. Names inside quest functions are not variables. */
export function exprVars(e: Expr, out = new Set<string>()): Set<string> {
  if (e.k === "var") out.add(e.n);
  else if (e.k === "un") exprVars(e.a, out);
  else if (e.k === "bin") {
    exprVars(e.a, out);
    exprVars(e.b, out);
  } else if (e.k === "call") {
    e.args.forEach((a, i) => {
      if (a.k !== "var" || (e.f === "has" && i === 1)) exprVars(a, out);
    });
  }
  return out;
}

/** Every quest-function call in an expression (for validation of item / quest / step names). */
export function exprCalls(e: Expr, out: Array<Extract<Expr, { k: "call" }>> = []): Array<Extract<Expr, { k: "call" }>> {
  if (e.k === "call") {
    out.push(e);
    e.args.forEach((a) => exprCalls(a, out));
  } else if (e.k === "un") exprCalls(e.a, out);
  else if (e.k === "bin") {
    exprCalls(e.a, out);
    exprCalls(e.b, out);
  }
  return out;
}

/** The name an argument stands for: bare identifiers and strings. */
export function argName(e: Expr | undefined): string | null {
  if (!e) return null;
  if (e.k === "var") return e.n;
  if (e.k === "str") return e.v;
  if (e.k === "num") return String(e.v);
  return null;
}

export function exprToString(e: Expr): string {
  switch (e.k) {
    case "num":
      return String(e.v);
    case "str":
      return JSON.stringify(e.v);
    case "bool":
      return String(e.v);
    case "var":
      return e.n;
    case "un":
      return e.op === "not" ? `not ${exprToString(e.a)}` : `-${exprToString(e.a)}`;
    case "bin":
      return `(${exprToString(e.a)} ${e.op} ${exprToString(e.b)})`;
    case "call":
      return `${e.f}(${e.args.map(exprToString).join(", ")})`;
  }
}
