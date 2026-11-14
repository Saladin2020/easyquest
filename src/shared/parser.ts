import { ExprError, argName, exprCalls, exprVars, parseExpr } from "./expr.js";
import { eventSignatures, parseValue, type ScannedDialogue } from "./ezd.js";
import {
  BUILTIN_EVENTS,
  FORMAT,
  type CompileResult,
  type Diagnostic,
  type DialogueLink,
  type Effect,
  type Expr,
  type FlagDef,
  type ItemDef,
  type Quest,
  type QuestDoc,
  type Step,
  type Trigger,
} from "./types.js";

/**
 * `.ezq` → `easyquest/1`. Line-based like Easy Dialogue's `.ezd`:
 *
 *   @dialogue village_delivery
 *   @item balm "ยาหม่อง"
 *   === village_delivery "ต้นส่งของรอบหมู่บ้าน"
 *   giver vendor
 *   start on camera market
 *   step temple "ถวายข้าวเหนียวมะม่วง"
 *       done on camera temple
 *       take sticky_rice
 *   reward:
 *       ~ reputation += 1
 */

export const SAFE_ID = /^[a-z0-9_-]+$/;
const NAME = /^[\p{L}_][\p{L}\p{N}_]*$/u;
const ID = /^[A-Za-z0-9_-]+$/;

export const QUEST_KEYWORDS = ["giver", "summary", "requires", "start", "fail", "on", "reward:", "step", "bonus"] as const;
export const STEP_KEYWORDS = ["done", "hint", "~", "give", "take", "@"] as const;
const HEADERS = ["title", "id", "dialogue", "flag", "item", "event"] as const;

export function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}

export function suggest(word: string, options: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  for (const o of options) {
    const dist = levenshtein(word.toLowerCase(), o.toLowerCase());
    if (dist < bestD) {
      bestD = dist;
      best = o;
    }
  }
  return best !== undefined && bestD <= Math.max(2, Math.floor(word.length / 3)) && best !== word ? best : undefined;
}
const dym = (word: string, options: Iterable<string>) => {
  const s = suggest(word, options);
  return s ? ` (did you mean "${s}"?)` : "";
};

function attrs(rest: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of rest.matchAll(/([a-z_]+)=("([^"]*)"|\S+)/g)) out[m[1]!] = m[3] ?? m[2]!;
  return out;
}

/** `id "Title with spaces"` or `id Title` */
function idAndTitle(rest: string): { id: string; title: string; tail: string } | null {
  const m = /^([A-Za-z0-9_-]+)\s*(?:"([^"]*)"|([^"].*?))?\s*$/.exec(rest.trim());
  if (!m) return null;
  return { id: m[1]!, title: (m[2] ?? m[3] ?? "").trim() || m[1]!, tail: "" };
}

export interface CompileOptions {
  id?: string;
  file?: string;
  /** Resolve `@dialogue <id> [path]` to a scanned dialogue (or null when it cannot be found). */
  dialogue?: (id: string, path?: string) => ScannedDialogue | null;
}

interface Pending {
  kind: "effects" | "step";
  target: Effect[];
  step?: Step;
  label: string;
}

export function compileQuests(source: string, opts: CompileOptions = {}): CompileResult {
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  /** Steps whose done line failed to parse (already reported — don't also say "no done line"). */
  const badDone = new Set<Step>();
  const err = (line: number, message: string, col?: number) => errors.push({ severity: "error", message, line, col, file: opts.file });
  const warn = (line: number, message: string, col?: number) => warnings.push({ severity: "warning", message, line, col, file: opts.file });

  const doc: QuestDoc = { format: FORMAT, id: opts.id ?? "quests", title: "", dialogues: [], flags: {}, items: {}, events: [], quests: [] };
  const flagDecl: FlagDef[] = [];
  const dialogueDecl: Array<{ id: string; path?: string; line: number }> = [];
  const exprUses: Array<{ e: Expr; line: number; col: number; where: string }> = [];
  const setUses: Array<{ name: string; line: number }> = [];
  const itemUses: Array<{ item: string; line: number }> = [];
  const triggerUses: Array<{ t: Extract<Trigger, { on: string }>; line: number }> = [];

  let quest: Quest | null = null;
  let block: Pending | null = null;

  const parseX = (src: string, line: number, col: number, where: string): Expr | null => {
    try {
      const e = parseExpr(src);
      exprUses.push({ e, line, col, where });
      return e;
    } catch (e) {
      if (e instanceof ExprError) err(line, `${where}: ${e.message}`, col + e.col + 1);
      else throw e;
      return null;
    }
  };

  const trigger = (rest: string, line: number, col: number, what: string): Trigger | null => {
    const m = /^(on|when)\s+(.+)$/.exec(rest.trim());
    if (!m) {
      err(line, `${what} needs "on <event> [args]" or "when <condition>"`, col + 1);
      return null;
    }
    if (m[1] === "when") {
      const e = parseX(m[2]!, line, col + rest.indexOf(m[2]!), `${what} when`);
      return e ? { when: e, src: m[2]!.trim(), line } : null;
    }
    const [name, ...args] = m[2]!.trim().split(/\s+/);
    if (!ID.test(name!)) {
      err(line, `Bad event name "${name}"`, col + 1);
      return null;
    }
    const t = { on: name!, args, line };
    triggerUses.push({ t, line });
    return t;
  };

  const effect = (text: string, line: number, col: number): Effect | null => {
    if (text.startsWith("~")) {
      const m = /^~\s*\$?([\p{L}_][\p{L}\p{N}_]*)\s*(\+=|-=|=)\s*(.+)$/u.exec(text);
      if (!m) {
        err(line, `Expected "~ flag = value", "~ flag += n" or "~ flag -= n"`, col + 1);
        return null;
      }
      const value = parseX(m[3]!, line, col + text.indexOf(m[3]!), `~ ${m[1]}`);
      setUses.push({ name: m[1]!, line });
      return value ? { set: m[1]!, op: m[2] as "=" | "+=" | "-=", value, line } : null;
    }
    const gt = /^(give|take)\s+([A-Za-z0-9_-]+)(?:\s+(\d+))?\s*$/.exec(text);
    if (gt) {
      itemUses.push({ item: gt[2]!, line });
      const n = gt[3] ? Number(gt[3]) : 1;
      return gt[1] === "give" ? { give: gt[2]!, n, line } : { take: gt[2]!, n, line };
    }
    if (/^(give|take)\b/.test(text)) {
      err(line, `Expected "${text.split(/\s/)[0]} <item> [count]"`, col + 1);
      return null;
    }
    const ev = /^@([A-Za-z_][\w-]*)\s*(.*)$/.exec(text);
    if (ev) return { event: ev[1]!, args: ev[2]!.trim() ? ev[2]!.trim().split(/\s+/) : [], line };
    return null;
  };

  const lines = source.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = i + 1;
    const indentLen = raw.length - raw.replace(/^\s+/, "").length;
    const text = raw.trim();
    if (!text || text.startsWith("//")) return;
    const col = indentLen;

    if (indentLen > 0 && block) {
      if (block.kind === "step" && block.step) {
        const s = block.step;
        const done = /^done\s+(.*)$/.exec(text);
        if (done) {
          const t = trigger(done[1]!, line, col + 5, `step ${s.id} done`);
          if (t) s.done.push(t);
          else badDone.add(s);
          return;
        }
        const hint = /^hint\s+(.+)$/.exec(text);
        if (hint) {
          s.hint = hint[1]!.replace(/^"(.*)"$/, "$1");
          return;
        }
      }
      const fx = effect(text, line, col);
      if (fx) block.target.push(fx);
      else if (!errors.some((e) => e.line === line)) {
        const word = text.split(/\s+/)[0]!;
        err(line, `Unknown line in ${block.label}: "${word}"${dym(word, block.kind === "step" ? ["done", "hint", "give", "take"] : ["give", "take"])} — expected ${block.kind === "step" ? "done on/when, hint, " : ""}~ flag, give, take or @event`, col + 1);
      }
      return;
    }
    if (indentLen > 0 && !block) {
      err(line, `Unexpected indented line (indent only inside step / on start: / on fail: / reward: blocks)`, col + 1);
      return;
    }
    block = null;

    const head = /^===\s*(.*)$/.exec(text);
    if (head) {
      const it = idAndTitle(head[1]!);
      if (!it) {
        err(line, `Expected === quest_id "Title"`, 4);
        quest = null;
        return;
      }
      if (doc.quests.some((q) => q.id === it.id)) err(line, `Duplicate quest "${it.id}"`, 5);
      quest = { id: it.id, title: it.title, requires: null, start: [], fail: [], onStart: [], onFail: [], reward: [], steps: [], line };
      doc.quests.push(quest);
      return;
    }

    if (!quest) {
      const at = /^@([A-Za-z_]+)\s*(.*)$/.exec(text);
      if (!at) {
        err(line, `Expected an @header or "=== quest_id" before quest lines`, 1);
        return;
      }
      const [, key, rest] = at as unknown as [string, string, string];
      switch (key) {
        case "title":
          doc.title = rest.trim();
          return;
        case "id":
          if (!SAFE_ID.test(rest.trim())) err(line, `@id must be lowercase letters, digits, _ or -`, 5);
          else doc.id = rest.trim();
          return;
        case "dialogue": {
          const [id, p] = rest.trim().split(/\s+/);
          if (!id || !SAFE_ID.test(id)) err(line, `@dialogue needs a dialogue id (dialogues/<id>.ezd)`, 11);
          else dialogueDecl.push({ id, path: p, line });
          return;
        }
        case "flag": {
          const m = /^([\p{L}_][\p{L}\p{N}_]*)\s*=\s*("[^"]*"|\S+)\s*(.*)$/u.exec(rest.trim());
          if (!m) {
            err(line, `Expected @flag name = value`, 7);
            return;
          }
          const a = attrs(m[3]!);
          if (flagDecl.some((f) => f.name === m[1])) err(line, `Duplicate flag "${m[1]}"`, 7);
          flagDecl.push({ name: m[1]!, value: parseValue(m[2]!), label: a.label, icon: a.icon, line });
          return;
        }
        case "item": {
          const m = /^([A-Za-z0-9_-]+)\s+"([^"]*)"\s*(.*)$/.exec(rest.trim());
          if (!m) {
            err(line, `Expected @item id "ชื่อ" [icon=…] [desc="…"]`, 7);
            return;
          }
          if (doc.items[m[1]!]) err(line, `Duplicate item "${m[1]}"`, 7);
          const a = attrs(m[3]!);
          const item: ItemDef = { id: m[1]!, name: m[2]!, icon: a.icon ?? m[1]!, line };
          if (a.desc) item.desc = a.desc;
          doc.items[item.id] = item;
          return;
        }
        case "event":
          for (const n of rest.trim().split(/[\s,]+/).filter(Boolean)) if (!doc.events.includes(n)) doc.events.push(n);
          return;
        default:
          err(line, `Unknown header @${key}${dym(key, HEADERS)} — use @${HEADERS.join(", @")}`, 1);
          return;
      }
    }

    const q = quest as Quest;
    const [word, ...restWords] = text.split(/\s+/);
    const rest = restWords.join(" ");
    switch (word) {
      case "giver":
        q.giver = rest.trim();
        return;
      case "summary":
        q.summary = rest.trim().replace(/^"(.*)"$/, "$1");
        return;
      case "requires": {
        if (q.requires) err(line, `Quest "${q.id}" already has a requires line (combine with and / or)`, 1);
        q.requires = parseX(rest, line, text.indexOf(rest), "requires");
        q.requiresSrc = rest.trim();
        return;
      }
      case "start":
      case "fail": {
        const t = trigger(rest, line, word.length + 1, word);
        if (t) (word === "start" ? q.start : q.fail).push(t);
        return;
      }
      case "on": {
        const m = /^(start|fail):?$/.exec(rest.trim());
        if (!m) {
          err(line, `Expected "on start:" or "on fail:"`, 4);
          return;
        }
        block = { kind: "effects", target: m[1] === "start" ? q.onStart : q.onFail, label: `on ${m[1]}` };
        return;
      }
      case "reward:":
      case "reward":
        block = { kind: "effects", target: q.reward, label: "reward" };
        return;
      case "step":
      case "bonus": {
        const it = idAndTitle(rest);
        if (!it) {
          err(line, `Expected ${word} step_id "Title"`, word.length + 2);
          return;
        }
        if (q.steps.some((s) => s.id === it.id)) err(line, `Duplicate step "${it.id}" in quest "${q.id}"`, word.length + 2);
        const s: Step = { id: it.id, title: it.title, optional: word === "bonus", done: [], effects: [], line };
        q.steps.push(s);
        block = { kind: "step", target: s.effects, step: s, label: `step ${s.id}` };
        return;
      }
      default:
        err(line, `Unknown quest line "${word}"${dym(word!, QUEST_KEYWORDS.map((k) => k.replace(":", "")))} — use giver, summary, requires, start, fail, on start:, on fail:, reward:, step, bonus`, 1);
    }
  });

  // ------------------------------------------------------------ link dialogues
  for (const d of dialogueDecl) {
    const scanned = opts.dialogue?.(d.id, d.path) ?? null;
    if (!scanned) {
      warn(d.line, `Dialogue "${d.id}" not found (dialogues/${d.id}.ezd or .dialogue.json) — its events and variables are not checked`);
      doc.dialogues.push({ id: d.id, cast: {}, events: [], vars: {}, found: false });
      continue;
    }
    const link: DialogueLink = { id: d.id, cast: scanned.cast, events: scanned.events, vars: scanned.vars, found: true };
    doc.dialogues.push(link);
    for (const [name, value] of Object.entries(scanned.vars)) {
      if (!doc.flags[name]) doc.flags[name] = { name, value, fromDialogue: d.id, line: d.line };
    }
  }
  for (const f of flagDecl) {
    const fromD = doc.flags[f.name];
    if (fromD?.fromDialogue && fromD.value !== f.value) {
      warn(f.line, `@flag ${f.name} = ${JSON.stringify(f.value)} differs from @var ${f.name} = ${JSON.stringify(fromD.value)} in ${fromD.fromDialogue}.ezd — the quest default wins`);
    }
    doc.flags[f.name] = { ...f, ...(fromD?.fromDialogue ? { fromDialogue: fromD.fromDialogue } : {}) };
  }

  // ------------------------------------------------------------ semantic checks
  const flagNames = Object.keys(doc.flags);
  const questIds = doc.quests.map((q) => q.id);
  const itemIds = Object.keys(doc.items);
  const flagHint = doc.dialogues.length ? "declare it with @flag or @var in the linked dialogue" : "declare it with @flag";

  for (const u of exprUses) {
    for (const v of exprVars(u.e)) {
      if (!doc.flags[v]) err(u.line, `${u.where}: unknown flag "${v}"${dym(v, flagNames)} — ${flagHint}`, u.col + 1);
    }
    for (const c of exprCalls(u.e)) {
      const a0 = argName(c.args[0]);
      if (c.f === "seen") {
        if (!c.args.length) err(u.line, `seen() needs an event name, e.g. seen(talk, monk)`, u.col + 1);
        continue;
      }
      if (!a0) {
        err(u.line, `${c.f}() needs a name as its first argument`, u.col + 1);
        continue;
      }
      if (c.f === "has" || c.f === "count") {
        if (!doc.items[a0]) err(u.line, `${c.f}(${a0}): unknown item${dym(a0, itemIds)} — declare it with @item`, u.col + 1);
      } else if (!questIds.includes(a0)) {
        err(u.line, `${c.f}(${a0}): unknown quest${dym(a0, questIds)}`, u.col + 1);
      } else if (c.f === "step") {
        const s = argName(c.args[1]);
        const q = doc.quests.find((x) => x.id === a0)!;
        if (!s) err(u.line, `step(${a0}, …) needs a step id`, u.col + 1);
        else if (!q.steps.some((x) => x.id === s)) err(u.line, `step(${a0}, ${s}): quest "${a0}" has no step "${s}"${dym(s, q.steps.map((x) => x.id))}`, u.col + 1);
      }
    }
  }
  for (const s of setUses) if (!doc.flags[s.name]) err(s.line, `~ ${s.name}: unknown flag${dym(s.name, flagNames)} — ${flagHint}`);
  for (const it of itemUses) if (!doc.items[it.item]) err(it.line, `Unknown item "${it.item}"${dym(it.item, itemIds)} — declare it with @item`);

  const dialogueEvents = new Map<string, string[]>();
  for (const d of doc.dialogues) for (const e of d.events) dialogueEvents.set(e.name, [...(dialogueEvents.get(e.name) ?? []), [e.name, ...e.args].join(" ")]);
  const knownNames = new Set<string>([...BUILTIN_EVENTS, ...doc.events, ...dialogueEvents.keys()]);
  for (const { t, line } of triggerUses) {
    if (!knownNames.has(t.on)) {
      warn(line, `Event "${t.on}" is not fired by ${doc.dialogues.length ? doc.dialogues.map((d) => `${d.id}.ezd`).join(", ") : "any linked dialogue"} and not declared${dym(t.on, knownNames)} — add "@event ${t.on}" if the game fires it`);
      continue;
    }
    if (t.on === "end") {
      const id = t.args[0];
      if (id && id !== "*" && !doc.dialogues.some((d) => d.id === id)) warn(line, `"on end ${id}": no linked dialogue "${id}"${dym(id, doc.dialogues.map((d) => d.id))}`);
      continue;
    }
    const sigs = dialogueEvents.get(t.on);
    if (sigs && !doc.events.includes(t.on) && t.args.length) {
      const want = [t.on, ...t.args].join(" ");
      const ok = sigs.some((s) => {
        const parts = s.split(" ");
        return t.args.every((a, i) => a === "*" || a === parts[i + 1]);
      });
      if (!ok) warn(line, `No linked dialogue fires "${want}"${dym(want, new Set(sigs))}`);
    }
  }

  const casts = doc.dialogues.filter((d) => d.found);
  for (const q of doc.quests) {
    if (!q.steps.some((s) => !s.optional)) err(q.line, `Quest "${q.id}" has no required step (add a "step id \\"title\\"" line)`);
    for (const s of q.steps) if (!s.done.length && !badDone.has(s)) err(s.line, `Step "${q.id}.${s.id}" has no "done on …" / "done when …" line`);
    if (q.giver && casts.length && !casts.some((d) => d.cast[q.giver!])) {
      const all = casts.flatMap((d) => Object.keys(d.cast));
      warn(q.line, `Giver "${q.giver}" is not in the cast of ${casts.map((d) => `${d.id}.ezd`).join(", ")}${dym(q.giver, all)}`);
    }
  }

  // prerequisite cycles (requires → quests it names)
  const deps = new Map<string, string[]>();
  for (const q of doc.quests) deps.set(q.id, q.requires ? exprCalls(q.requires).filter((c) => c.f !== "has" && c.f !== "count" && c.f !== "seen").map((c) => argName(c.args[0])!).filter((x) => questIds.includes(x)) : []);
  const state = new Map<string, number>();
  const visit = (id: string, pathIds: string[]): void => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      const cyc = [...pathIds.slice(pathIds.indexOf(id)), id];
      const q = doc.quests.find((x) => x.id === id)!;
      if (!errors.some((e) => e.message.startsWith("Prerequisite cycle"))) err(q.line, `Prerequisite cycle: ${cyc.join(" → ")} — none of these can ever unlock`);
      return;
    }
    state.set(id, 1);
    for (const d of deps.get(id) ?? []) visit(d, [...pathIds, id]);
    state.set(id, 2);
  };
  for (const q of doc.quests) visit(q.id, []);

  if (!doc.title) doc.title = doc.quests[0]?.title ?? doc.id;
  if (!doc.quests.length && !errors.length) err(1, `No quests — add "=== quest_id \\"Title\\""`);
  errors.sort((a, b) => a.line - b.line);
  warnings.sort((a, b) => a.line - b.line);
  return { doc: errors.length ? null : doc, errors, warnings };
}

/** Prerequisite edges for graphs: quest → quests its `requires` names. */
export function questDeps(doc: QuestDoc): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  for (const q of doc.quests) {
    if (!q.requires) continue;
    for (const c of exprCalls(q.requires)) {
      const a = argName(c.args[0]);
      if (a && c.f !== "has" && c.f !== "count" && c.f !== "seen" && doc.quests.some((x) => x.id === a)) out.push({ from: a, to: q.id });
    }
  }
  return out;
}

export function triggerToString(t: Trigger): string {
  return "when" in t ? `when ${t.src}` : `on ${[t.on, ...t.args].join(" ")}`;
}

export function signaturesOf(doc: QuestDoc): string[] {
  return [...new Set(doc.dialogues.flatMap((d) => eventSignatures(d)))];
}
