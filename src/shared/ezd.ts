import type { DialogueLink, Value } from "./types.js";

/**
 * The Easy Dialogue contract, read without Easy Dialogue: a light scanner for `.ezd` source and a reader
 * for compiled `easydialogue/1` JSON. Easy Quest only needs the cast, the variables (they are quest flags)
 * and the `@events` a dialogue fires (they advance quest steps).
 */

export interface ScannedDialogue extends DialogueLink {
  title?: string;
  nodes: Array<{ id: string; line: number }>;
  /** Variables written with `~ name …` (line of first write). */
  writes: Record<string, number>;
  varLines: Record<string, number>;
}

const HEADER_KEYS = new Set(["title", "id", "start", "box", "var", "char", "choices", "lang", "portraits", "background"]);

export function parseValue(raw: string): Value {
  const s = raw.trim();
  if (s === "true" || s === "false") return s === "true";
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = /^"(.*)"$|^'(.*)'$/.exec(s);
  if (m) return m[1] ?? m[2] ?? "";
  return s;
}

function attrs(rest: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of rest.matchAll(/([a-z_]+)=("([^"]*)"|\S+)/g)) out[m[1]!] = m[3] ?? m[2]!;
  return out;
}

/** Scan `.ezd` source (no compile): cast, @var defaults, ~ writes, nodes and @events with line numbers. */
export function scanEzd(source: string, fallbackId = "dialogue"): ScannedDialogue {
  const out: ScannedDialogue = { id: fallbackId, cast: {}, events: [], vars: {}, nodes: [], writes: {}, varLines: {}, found: true };
  let inNode = false;
  source.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const text = raw.replace(/^\s+/, "");
    if (!text || text.startsWith("//") || text.startsWith("#")) return;
    const node = /^===\s*([A-Za-z0-9_\-.]+)/.exec(text);
    if (node) {
      inNode = true;
      out.nodes.push({ id: node[1]!, line });
      return;
    }
    const at = /^@([A-Za-z_][\w-]*)\s*(.*)$/.exec(text);
    if (at) {
      const [, key, rest] = at as unknown as [string, string, string];
      if (!inNode && HEADER_KEYS.has(key)) {
        if (key === "title") out.title = rest.trim();
        else if (key === "id") out.id = rest.trim() || out.id;
        else if (key === "var") {
          const m = /^([\p{L}_][\p{L}\p{N}_]*)\s*=\s*(.+)$/u.exec(rest.trim());
          if (m) {
            out.vars[m[1]!] = parseValue(m[2]!);
            out.varLines[m[1]!] = line;
          }
        } else if (key === "char") {
          const m = /^([\w-]+)\s+"([^"]*)"\s*(.*)$/.exec(rest.trim());
          if (m) {
            const a = attrs(m[3]!);
            out.cast[m[1]!] = { name: m[2]!, portrait: a.portrait, color: a.color };
          }
        }
        return;
      }
      if (inNode) out.events.push({ name: key, args: rest.trim() ? rest.trim().split(/\s+/) : [], line });
      return;
    }
    const set = /^~\s*\$?([\p{L}_][\p{L}\p{N}_]*)/u.exec(text);
    if (set && !(set[1]! in out.writes)) out.writes[set[1]!] = line;
  });
  return out;
}

interface CompiledStmt {
  t: string;
  name?: string;
  args?: string[];
  src?: number;
  var?: string;
  body?: CompiledStmt[];
  options?: Array<{ body?: CompiledStmt[] }>;
  branches?: Array<{ body?: CompiledStmt[] }>;
  else?: CompiledStmt[];
}

/** Read a compiled `easydialogue/1` document (from `easydialogue compile` / the json export). */
export function scanCompiled(doc: {
  id?: string;
  title?: string;
  variables?: Record<string, Value>;
  characters?: Record<string, { name: string; portrait?: string; color?: string }>;
  nodes?: Record<string, { id: string; body: CompiledStmt[] }>;
}): ScannedDialogue {
  const out: ScannedDialogue = { id: doc.id ?? "dialogue", title: doc.title, cast: {}, events: [], vars: { ...(doc.variables ?? {}) }, nodes: [], writes: {}, varLines: {}, found: true };
  for (const [id, c] of Object.entries(doc.characters ?? {})) out.cast[id] = { name: c.name, portrait: c.portrait, color: c.color };
  const walk = (body: CompiledStmt[] | undefined) => {
    for (const s of body ?? []) {
      if (s.t === "event" && s.name) out.events.push({ name: s.name, args: s.args ?? [], line: s.src ?? 0 });
      if (s.t === "set" && s.var && !(s.var in out.writes)) out.writes[s.var] = s.src ?? 0;
      walk(s.body);
      s.options?.forEach((o) => walk(o.body));
      s.branches?.forEach((b) => walk(b.body));
      walk(s.else);
    }
  };
  for (const n of Object.values(doc.nodes ?? {})) {
    out.nodes.push({ id: n.id, line: 0 });
    walk(n.body);
  }
  return out;
}

/** Distinct `name args` event signatures a dialogue fires. */
export function eventSignatures(d: Pick<DialogueLink, "events">): string[] {
  return [...new Set(d.events.map((e) => [e.name, ...e.args].join(" ")))];
}
