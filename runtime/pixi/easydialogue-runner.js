// Vendored from Easy Dialogue (runtime/pixi/easydialogue-runner.js) so Easy Quest can play linked dialogues.
// Easy Dialogue runner — plays a compiled `easydialogue/1` document.
// Plain ES module with no dependencies: used by the web editor, the CLI, tests and PixiJS exports.
// MIT License. https://github.com/Saladin2020/easydialogue

const MAX_STEPS = 10000;

/** Thai combining marks (above/below vowels, tone marks, thanthakhat…) — never reveal them alone. */
const THAI_COMBINING = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/;

/** Grapheme clusters (Intl.Segmenter when present, else a Thai-aware fallback). */
export function graphemes(text) {
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    return Array.from(new Intl.Segmenter("th", { granularity: "grapheme" }).segment(text), (s) => s.segment);
  }
  const out = [];
  for (const ch of text) {
    if (out.length && THAI_COMBINING.test(ch)) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

/** Word-ish segments for line wrapping (Thai has no spaces between words). */
export function wordSegments(text, lang = "th") {
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    return Array.from(new Intl.Segmenter(lang, { granularity: "word" }).segment(text), (s) => s.segment);
  }
  return text.split(/(\s+)/).filter(Boolean);
}

/**
 * Greedy wrap by measured width. `measure(str) → px`. Breaks only between word segments, so Thai
 * syllables and their tone marks never split; a single over-long word falls back to graphemes.
 */
export function wrapText(text, maxWidth, measure, lang = "th") {
  const lines = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const seg of wordSegments(para, lang)) {
      const tryLine = line + seg;
      if (!line || measure(tryLine) <= maxWidth) {
        if (!line && measure(seg) > maxWidth) {
          for (const g of graphemes(seg)) {
            if (line && measure(line + g) > maxWidth) {
              lines.push(line);
              line = g;
            } else line += g;
          }
        } else line = tryLine;
        continue;
      }
      lines.push(line.replace(/\s+$/, ""));
      line = seg.replace(/^\s+/, "");
    }
    lines.push(line.replace(/\s+$/, ""));
  }
  return lines;
}

export function formatValue(v) {
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
  return String(v);
}

function truthy(v) {
  return !(v === false || v === 0 || v === "" || v === null || v === undefined);
}

export function evaluate(e, vars) {
  switch (e.k) {
    case "num":
    case "str":
    case "bool":
      return e.v;
    case "var":
      return e.n in vars ? vars[e.n] : 0;
    case "un": {
      const a = evaluate(e.a, vars);
      return e.op === "not" ? !truthy(a) : -Number(a);
    }
    case "bin": {
      if (e.op === "and") return truthy(evaluate(e.a, vars)) ? truthy(evaluate(e.b, vars)) : false;
      if (e.op === "or") return truthy(evaluate(e.a, vars)) ? true : truthy(evaluate(e.b, vars));
      const a = evaluate(e.a, vars);
      const b = evaluate(e.b, vars);
      switch (e.op) {
        case "+":
          return typeof a === "string" || typeof b === "string" ? formatValue(a) + formatValue(b) : Number(a) + Number(b);
        case "-":
          return Number(a) - Number(b);
        case "*":
          return Number(a) * Number(b);
        case "/":
          return Number(b) === 0 ? 0 : Number(a) / Number(b);
        case "%":
          return Number(b) === 0 ? 0 : Number(a) % Number(b);
        case "==":
          return typeof a === typeof b ? a === b : formatValue(a) === formatValue(b);
        case "!=":
          return typeof a === typeof b ? a !== b : formatValue(a) !== formatValue(b);
        case "<":
          return Number(a) < Number(b);
        case "<=":
          return Number(a) <= Number(b);
        case ">":
          return Number(a) > Number(b);
        case ">=":
          return Number(a) >= Number(b);
      }
    }
  }
  throw new Error(`Unknown expression ${JSON.stringify(e)}`);
}

export function interpolate(text, vars) {
  return String(text)
    .replace(/(?<!\\)\{\s*\$?([^}\s]+)\s*\}/gu, (_m, name) => formatValue(name in vars ? vars[name] : 0))
    .replace(/\\([{}])/g, "$1");
}

export class DialogueRunner {
  /**
   * @param {object} doc compiled easydialogue/1 JSON
   * @param {{ variables?: Record<string, unknown>, onEvent?: (name: string, args: string[], runner: DialogueRunner) => void }} [opts]
   */
  constructor(doc, opts = {}) {
    if (!doc || doc.format !== "easydialogue/1") throw new Error("Not an easydialogue/1 document");
    this.doc = doc;
    this.vars = { ...doc.variables, ...(opts.variables ?? {}) };
    this.disabledChoices = opts.disabledChoices ?? doc.disabledChoices ?? "hide";
    this.onEvent = opts.onEvent ?? null;
    this.stack = [];
    this.pending = null;
    this.node = null;
    this.ended = true;
    this.visited = {};
  }

  start(node) {
    const id = node ?? this.doc.start;
    this.jump(id);
    return this;
  }

  jump(id) {
    if (id === "END") {
      this.stack = [];
      this.ended = true;
      return;
    }
    const n = this.doc.nodes[id];
    if (!n) throw new Error(`Unknown node ${id}`);
    this.node = id;
    this.visited[id] = (this.visited[id] ?? 0) + 1;
    this.stack = [{ body: n.body, i: 0 }];
    this.pending = null;
    this.ended = false;
  }

  /** Advance to the next line / choice set / end. Events fire through onEvent on the way. */
  next() {
    if (this.pending) return this.pending;
    for (let steps = 0; steps < MAX_STEPS; steps++) {
      const top = this.stack[this.stack.length - 1];
      if (!top) {
        this.ended = true;
        return { type: "end" };
      }
      if (top.i >= top.body.length) {
        this.stack.pop();
        continue;
      }
      const s = top.body[top.i++];
      switch (s.t) {
        case "line":
          return this.lineEvent(s);
        case "choice": {
          const options = [];
          s.options.forEach((o, index) => {
            const ok = !o.cond || truthy(evaluate(o.cond, this.vars));
            const mode = o.disabled ?? this.disabledChoices;
            if (ok) options.push({ index, id: o.id, text: interpolate(o.text, this.vars), disabled: false });
            else if (mode === "grey") options.push({ index, id: o.id, text: interpolate(o.text, this.vars), disabled: true });
          });
          if (!options.length) continue;
          this.pending = { type: "choices", options, src: s.src, _stmt: s };
          return this.pending;
        }
        case "if": {
          const br = s.branches.find((b) => !b.cond || truthy(evaluate(b.cond, this.vars)));
          if (br && br.body.length) this.stack.push({ body: br.body, i: 0 });
          continue;
        }
        case "set": {
          const cur = this.vars[s.var] ?? 0;
          const v = evaluate(s.value, this.vars);
          if (s.op === "=") this.vars[s.var] = v;
          else if (s.op === "+=") this.vars[s.var] = typeof cur === "string" || typeof v === "string" ? formatValue(cur) + formatValue(v) : Number(cur) + Number(v);
          else if (s.op === "-=") this.vars[s.var] = Number(cur) - Number(v);
          else if (s.op === "*=") this.vars[s.var] = Number(cur) * Number(v);
          else if (s.op === "/=") this.vars[s.var] = Number(v) === 0 ? 0 : Number(cur) / Number(v);
          continue;
        }
        case "jump":
          this.jump(s.target);
          continue;
        case "end":
          this.stack = [];
          this.ended = true;
          return { type: "end" };
        case "event":
          if (this.onEvent) this.onEvent(s.name, s.args, this);
          continue;
        default:
          continue;
      }
    }
    throw new Error("Dialogue loop without any line (check jumps)");
  }

  /** Pick a choice by its `index` from the options list (the original option index). */
  choose(index) {
    const p = this.pending;
    if (!p) throw new Error("No choice is waiting");
    const opt = p._stmt.options[index];
    const shown = p.options.find((o) => o.index === index);
    if (!opt || !shown) throw new Error(`Choice ${index} is not available`);
    if (shown.disabled) throw new Error(`Choice ${index} is disabled`);
    this.pending = null;
    if (opt.body.length) this.stack.push({ body: opt.body, i: 0 });
    return opt;
  }

  lineEvent(s) {
    const c = s.speaker ? this.doc.characters[s.speaker] : undefined;
    return {
      type: "line",
      id: s.id,
      speaker: s.speaker ?? null,
      name: c ? c.name : s.speaker ?? "",
      emotion: s.emotion ?? "neutral",
      portrait: c?.portrait ?? null,
      color: c?.color ?? null,
      side: c?.side ?? "left",
      voice: c?.voice ?? null,
      text: interpolate(s.text, this.vars),
      tags: s.tags ?? [],
      src: s.src,
      node: this.node,
    };
  }
}

/**
 * Play through with scripted picks (choice positions within the visible list, 0-based). Handy for tests and CI.
 * @returns {{ transcript: string[], vars: Record<string, unknown>, events: string[] }}
 */
export function autoplay(doc, picks = [], opts = {}) {
  const events = [];
  const r = new DialogueRunner(doc, { ...opts, onEvent: (n, a) => events.push([n, ...a].join(" ")) }).start(opts.node);
  const transcript = [];
  let pick = 0;
  for (let guard = 0; guard < 5000; guard++) {
    const ev = r.next();
    if (ev.type === "end") break;
    if (ev.type === "line") {
      transcript.push(`${ev.name ? `${ev.name}: ` : ""}${ev.text}`);
      continue;
    }
    const want = picks[pick++] ?? 0;
    const opt = ev.options[Math.min(want, ev.options.length - 1)];
    transcript.push(`> ${opt.text}`);
    r.choose(opt.index);
  }
  return { transcript, vars: r.vars, events };
}
