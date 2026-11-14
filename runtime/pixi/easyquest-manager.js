// Easy Quest manager — runs a compiled `easyquest/1` document: quest states, steps, flags, items, rewards.
// Plain ES module with no dependencies: used by the CLI simulator, the web editor, tests and PixiJS exports.
// runtime/godot/quest_manager.gd mirrors it line for line (a test compares their logs).
// MIT License. https://github.com/Saladin2020/easyquest

const MAX_PASSES = 64;

export function formatValue(v) {
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
  return String(v);
}

function truthy(v) {
  return !(v === false || v === 0 || v === "" || v === null || v === undefined);
}

function argName(e) {
  if (!e) return "";
  if (e.k === "var") return e.n;
  if (e.k === "str") return e.v;
  if (e.k === "num") return formatValue(e.v);
  return "";
}

/** `{flag}` in titles and summaries. */
export function interpolate(text, vars) {
  return String(text ?? "")
    .replace(/(?<!\\)\{\s*\$?([^}\s]+)\s*\}/gu, (_m, name) => formatValue(name in vars ? vars[name] : 0))
    .replace(/\\([{}])/g, "$1");
}

export class QuestManager {
  /**
   * @param {object} doc compiled easyquest/1 JSON
   * @param {{ vars?: Record<string, unknown>, items?: Record<string, number>, onSignal?: (name: string, ...args: unknown[]) => void }} [opts]
   */
  constructor(doc, opts = {}) {
    if (!doc || doc.format !== "easyquest/1") throw new Error("Not an easyquest/1 document");
    this.doc = doc;
    this.vars = {};
    for (const f of Object.values(doc.flags)) this.vars[f.name] = f.value;
    Object.assign(this.vars, opts.vars ?? {});
    this.items = { ...(opts.items ?? {}) };
    this.quests = {};
    for (const q of doc.quests) this.quests[q.id] = { status: "locked", steps: {} };
    this.seen = {};
    this.log = [];
    this.listeners = [];
    if (opts.onSignal) this.listeners.push(opts.onSignal);
    this.update(null);
  }

  /** Subscribe to signals: quest_available, quest_started, step_completed, quest_completed, quest_failed, item_changed, flag_changed, quest_event, changed. */
  on(fn) {
    this.listeners.push(fn);
    return () => (this.listeners = this.listeners.filter((l) => l !== fn));
  }

  _signal(name, ...args) {
    for (const l of this.listeners) l(name, ...args);
  }

  _log(line) {
    this.log.push(line);
  }

  // ------------------------------------------------------------------ queries

  status(id) {
    return this.quests[id]?.status ?? "locked";
  }

  stepDone(q, s) {
    return Boolean(this.quests[q]?.steps[s]);
  }

  count(item) {
    return this.items[item] ?? 0;
  }

  /** First required step that is not done (the one the quest log points at). */
  currentStep(id) {
    const q = this.doc.quests.find((x) => x.id === id);
    if (!q) return null;
    return q.steps.find((s) => !s.optional && !this.stepDone(id, s.id)) ?? null;
  }

  evaluate(e) {
    switch (e.k) {
      case "num":
      case "str":
      case "bool":
        return e.v;
      case "var":
        return e.n in this.vars ? this.vars[e.n] : 0;
      case "call": {
        const a0 = argName(e.args[0]);
        switch (e.f) {
          case "has":
            return this.count(a0) >= (e.args[1] ? Number(this.evaluate(e.args[1])) : 1);
          case "count":
            return this.count(a0);
          case "done":
            return this.status(a0) === "completed";
          case "active":
            return this.status(a0) === "active";
          case "failed":
            return this.status(a0) === "failed";
          case "available":
            return this.status(a0) === "available";
          case "step":
            return this.stepDone(a0, argName(e.args[1]));
          case "seen":
            return this.seen[e.args.map(argName).join(" ")] ?? 0;
        }
        throw new Error(`Unknown function ${e.f}`);
      }
      case "un": {
        const a = this.evaluate(e.a);
        return e.op === "not" ? !truthy(a) : -Number(a);
      }
      case "bin": {
        if (e.op === "and") return truthy(this.evaluate(e.a)) ? truthy(this.evaluate(e.b)) : false;
        if (e.op === "or") return truthy(this.evaluate(e.a)) ? true : truthy(this.evaluate(e.b));
        const a = this.evaluate(e.a);
        const b = this.evaluate(e.b);
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

  // ------------------------------------------------------------------ input

  /**
   * Feed a game or dialogue event (`camera temple`, `talk vendor`, `end village_delivery`).
   * `vars` (e.g. the Easy Dialogue runner's variables at that moment) are adopted first, so dialogue
   * variables and quest flags stay one namespace.
   */
  emit(name, args = [], vars = null) {
    if (vars) this.syncVars(vars);
    const ev = { name: String(name), args: (args ?? []).map(String) };
    const key = [ev.name, ...ev.args];
    for (let i = 1; i <= key.length; i++) {
      const k = key.slice(0, i).join(" ");
      this.seen[k] = (this.seen[k] ?? 0) + 1;
    }
    this._log(`event ${key.join(" ")}`);
    this.update(ev);
    return this;
  }

  /** Adopt variables from a dialogue runner (no signals for unchanged values). */
  syncVars(vars) {
    for (const [k, v] of Object.entries(vars)) {
      if (this.vars[k] !== v) {
        this.vars[k] = v;
        this._signal("flag_changed", k, v);
      }
    }
  }

  setFlag(name, value) {
    this.vars[name] = value;
    this._signal("flag_changed", name, value);
    this.update(null);
  }

  give(item, n = 1) {
    this._give(item, n);
    this.update(null);
  }

  take(item, n = 1) {
    this._take(item, n);
    this.update(null);
  }

  _give(item, n) {
    this.items[item] = this.count(item) + n;
    this._log(`give ${item} ${n}`);
    this._signal("item_changed", item, this.items[item]);
  }

  _take(item, n) {
    if (this.count(item) === 0) return;
    const left = Math.max(0, this.count(item) - n);
    if (left === 0) delete this.items[item];
    else this.items[item] = left;
    this._log(`take ${item} ${n}`);
    this._signal("item_changed", item, left);
  }

  _run(effects) {
    for (const fx of effects) {
      if ("set" in fx) {
        const v = this.evaluate(fx.value);
        const cur = this.vars[fx.set] ?? 0;
        let next = v;
        if (fx.op === "+=") next = typeof cur === "string" || typeof v === "string" ? formatValue(cur) + formatValue(v) : Number(cur) + Number(v);
        else if (fx.op === "-=") next = Number(cur) - Number(v);
        this.vars[fx.set] = next;
        this._log(`set ${fx.set} ${formatValue(next)}`);
        this._signal("flag_changed", fx.set, next);
      } else if ("give" in fx) this._give(fx.give, fx.n);
      else if ("take" in fx) this._take(fx.take, fx.n);
      else if ("event" in fx) {
        this._log(`fire ${[fx.event, ...fx.args].join(" ")}`);
        this._signal("quest_event", fx.event, fx.args);
      }
    }
  }

  /** Does any trigger fire? `ctx.consumed` stops one event from completing two event steps of a quest. */
  _fires(triggers, ev, ctx, consume) {
    for (const t of triggers) {
      if ("when" in t) {
        if (truthy(this.evaluate(t.when))) return true;
      } else if (ev && !ctx.consumed && t.on === ev.name && t.args.every((a, i) => a === "*" || a === ev.args[i])) {
        if (consume) ctx.consumed = true;
        return true;
      }
    }
    return false;
  }

  /** Re-evaluate every quest until nothing changes (prerequisites, starts, steps, completion, failure). */
  update(ev) {
    const ctx = {};
    for (const q of this.doc.quests) ctx[q.id] = { consumed: false };
    let changed = true;
    let any = false;
    for (let pass = 0; changed && pass < MAX_PASSES; pass++) {
      changed = false;
      for (const q of this.doc.quests) {
        const st = this.quests[q.id];
        const c = ctx[q.id];
        if (st.status === "locked" && (!q.requires || truthy(this.evaluate(q.requires)))) {
          st.status = "available";
          this._log(`available ${q.id}`);
          this._signal("quest_available", q.id);
          changed = true;
        }
        if (st.status === "available" && (q.start.length === 0 || this._fires(q.start, ev, c, true))) {
          st.status = "active";
          this._log(`start ${q.id}`);
          this._signal("quest_started", q.id);
          this._run(q.onStart);
          changed = true;
        }
        if (st.status !== "active") continue;
        if (this._fires(q.fail, ev, c, false)) {
          st.status = "failed";
          this._log(`fail ${q.id}`);
          this._signal("quest_failed", q.id);
          this._run(q.onFail);
          changed = true;
          continue;
        }
        for (const s of q.steps) {
          if (!s.optional || st.steps[s.id]) continue;
          if (this._fires(s.done, ev, { consumed: c.consumed }, false)) {
            st.steps[s.id] = true;
            this._log(`bonus ${q.id}.${s.id}`);
            this._signal("step_completed", q.id, s.id);
            this._run(s.effects);
            changed = true;
          }
        }
        const cur = this.currentStep(q.id);
        if (cur && this._fires(cur.done, ev, c, true)) {
          st.steps[cur.id] = true;
          this._log(`step ${q.id}.${cur.id}`);
          this._signal("step_completed", q.id, cur.id);
          this._run(cur.effects);
          changed = true;
        }
        if (!this.currentStep(q.id)) {
          st.status = "completed";
          this._log(`complete ${q.id}`);
          this._signal("quest_completed", q.id);
          this._run(q.reward);
          changed = true;
        }
      }
      if (changed) any = true;
    }
    if (any) this._signal("changed");
  }

  // ------------------------------------------------------------------ save / load

  /** Plain JSON snapshot: quest statuses + steps, flags, items, seen-event counts. */
  state() {
    const quests = {};
    for (const q of this.doc.quests) {
      const st = this.quests[q.id];
      quests[q.id] = { status: st.status, steps: q.steps.filter((s) => st.steps[s.id]).map((s) => s.id) };
    }
    return { quests, vars: { ...this.vars }, items: { ...this.items }, seen: { ...this.seen } };
  }

  load(state) {
    this.vars = { ...this.vars, ...(state.vars ?? {}) };
    this.items = { ...(state.items ?? {}) };
    this.seen = { ...(state.seen ?? {}) };
    for (const q of this.doc.quests) {
      const s = state.quests?.[q.id];
      this.quests[q.id] = { status: s?.status ?? "locked", steps: Object.fromEntries((s?.steps ?? []).map((id) => [id, true])) };
    }
    this._signal("changed");
    return this;
  }
}

// ------------------------------------------------------------------ Easy Dialogue bridge

/**
 * Connect an Easy Dialogue `DialogueRunner` (easydialogue-runner.js) to a quest manager:
 * the runner starts with the manager's flags, every `@event` is forwarded with the runner's variables
 * at that moment, quest rewards write back into the runner, and the end of the dialogue fires
 * `end <dialogueId>`. Returns the wrapped `next()` — call it instead of `runner.next()`.
 */
export function bridgeDialogue(manager, runner, dialogueId) {
  Object.assign(runner.vars, manager.vars);
  const prev = runner.onEvent;
  runner.onEvent = (name, args, r) => {
    manager.emit(name, args, r.vars);
    Object.assign(r.vars, manager.vars);
    if (prev) prev(name, args, r);
  };
  let ended = false;
  return () => {
    const ev = runner.next();
    if (ev.type === "end" && !ended) {
      ended = true;
      manager.emit("end", [dialogueId ?? runner.doc.id], runner.vars);
    }
    return ev;
  };
}

/**
 * Play a compiled dialogue with scripted picks (positions in the visible options) through the bridge.
 * `Runner` is easydialogue-runner.js's DialogueRunner class.
 */
export function playDialogue(manager, Runner, dialogueDoc, picks = [], opts = {}) {
  const runner = new Runner(dialogueDoc, { variables: {} });
  const next = bridgeDialogue(manager, runner, opts.id ?? dialogueDoc.id);
  runner.start(opts.node);
  const transcript = [];
  let pi = 0;
  for (let guard = 0; guard < 10000; guard++) {
    const ev = next();
    if (ev.type === "end") break;
    if (ev.type === "line") transcript.push(ev.name ? `${ev.name}: ${ev.text}` : ev.text);
    else if (ev.type === "choices") {
      const live = ev.options.filter((o) => !o.disabled);
      const pick = live[Math.min(picks[pi++] ?? 0, live.length - 1)];
      transcript.push(`> ${pick.text}`);
      runner.choose(pick.index);
    }
  }
  return { transcript, vars: { ...runner.vars } };
}

/**
 * Run a script of inputs: `{ event: "camera temple" }`, `{ set: { coins: 10 } }`, `{ give: "mango" }`,
 * `{ dialogue: doc, picks: [0, 0] }` (needs `opts.Runner`). Returns the log and final state.
 */
export function simulate(doc, inputs, opts = {}) {
  const m = new QuestManager(doc, { vars: opts.vars });
  const transcripts = [];
  for (const inp of inputs) {
    if (inp.event) {
      const [name, ...args] = String(inp.event).trim().split(/\s+/);
      m.emit(name, args, inp.vars ?? null);
    } else if (inp.set) {
      m.syncVars(inp.set);
      m._log(`vars ${JSON.stringify(inp.set)}`);
      m.update(null);
    } else if (inp.give) m.give(inp.give, inp.n ?? 1);
    else if (inp.take) m.take(inp.take, inp.n ?? 1);
    else if (inp.dialogue) {
      if (!opts.Runner) throw new Error("simulate: dialogue inputs need opts.Runner (easydialogue-runner.js)");
      transcripts.push(...playDialogue(m, opts.Runner, inp.dialogue, inp.picks ?? [], { id: inp.id, node: inp.node }).transcript);
    }
  }
  return { log: m.log, state: m.state(), transcript: transcripts, manager: m };
}
