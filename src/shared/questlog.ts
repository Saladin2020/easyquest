import { wrapText } from "./dialogueRunner.js";
import { PALETTES, type Pixels } from "./frames.js";
import { interpolate, type QuestState } from "./manager.js";
import { triggerToString } from "./parser.js";
import type { BoxStyle, Effect, QuestDoc, QuestStatus, Value } from "./types.js";

/**
 * The quest-log panel, drawn on any 2D canvas context: the CLI / MCP PNGs (@napi-rs/canvas, Skia +
 * HarfBuzz for Thai) and the web editor (browser canvas) share this code, and the Godot / Pixi quest
 * logs follow the same layout. 480×270 game pixels × an integer scale.
 */

export interface Drawable {
  width: number;
  height: number;
}

export interface Ctx {
  imageSmoothingEnabled: boolean;
  font: string;
  fillStyle: unknown;
  globalAlpha: number;
  textAlign: string;
  textBaseline: string;
  drawImage(img: never, sx: number, sy: number, sw?: number, sh?: number, dx?: number, dy?: number, dw?: number, dh?: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(t: string, x: number, y: number): void;
  measureText(t: string): { width: number };
}

export interface LogAssets {
  background?: Drawable | null;
  box: Drawable;
  plate: Drawable;
  well: Drawable;
  icon: (name: string) => Drawable;
  state: (name: string) => Drawable;
  portrait: (portraitSet: string | undefined) => Drawable | null;
}

export const VIEW = { width: 480, height: 270 };
export const LOG_STATUS_TH: Record<QuestStatus, string> = { locked: "ยังไม่ปลดล็อก", available: "รับเควสต์ได้", active: "กำลังทำ", completed: "สำเร็จ", failed: "ล้มเหลว" };

export interface LogStep {
  id: string;
  title: string;
  optional: boolean;
  state: "done" | "current" | "todo" | "failed";
  hint?: string;
  trigger: string;
}

export interface LogQuest {
  id: string;
  title: string;
  status: QuestStatus;
  giver?: { id: string; name: string; portrait?: string; color?: string };
  summary?: string;
  steps: LogStep[];
  progress: string;
  rewards: Array<{ icon: string; label: string }>;
  requires?: string;
}

export interface LogView {
  title: string;
  quests: LogQuest[];
  selected: string | null;
  items: Array<{ id: string; name: string; icon: string; count: number }>;
  flags: Array<{ name: string; label: string; icon: string; value: string }>;
}

function rewardsOf(doc: QuestDoc, fx: Effect[]): LogQuest["rewards"] {
  const out: LogQuest["rewards"] = [];
  for (const e of fx) {
    if ("give" in e) {
      const it = doc.items[e.give];
      out.push({ icon: it?.icon ?? e.give, label: `${it?.name ?? e.give}${e.n > 1 ? ` ×${e.n}` : ""}` });
    } else if ("set" in e && e.op === "+=" && e.value.k === "num") {
      const f = doc.flags[e.set];
      out.push({ icon: f?.icon ?? "scroll", label: `${f?.label ?? e.set} +${e.value.v}` });
    }
  }
  return out;
}

/** View model for the log: what a game UI needs to show (also used by the editor's step graph). */
export function buildLogView(doc: QuestDoc, state: QuestState, opts: { selected?: string; showLocked?: boolean } = {}): LogView {
  const vars = state.vars as Record<string, Value>;
  const cast: Record<string, { name: string; portrait?: string; color?: string }> = {};
  for (const d of doc.dialogues) Object.assign(cast, d.cast);
  const quests: LogQuest[] = [];
  for (const q of doc.quests) {
    const st = state.quests[q.id] ?? { status: "locked" as QuestStatus, steps: [] };
    if (st.status === "locked" && !opts.showLocked) continue;
    const done = new Set(st.steps);
    let currentMarked = false;
    const steps: LogStep[] = q.steps.map((s) => {
      let s2: LogStep["state"] = done.has(s.id) ? "done" : "todo";
      if (s2 === "todo" && st.status === "failed") s2 = "failed";
      else if (s2 === "todo" && st.status === "active" && !s.optional && !currentMarked) {
        s2 = "current";
        currentMarked = true;
      }
      return { id: s.id, title: interpolate(s.title, vars), optional: s.optional, state: s2, hint: s.hint, trigger: s.done.map(triggerToString).join(" | ") };
    });
    const req = q.steps.filter((s) => !s.optional);
    const g = q.giver ? cast[q.giver] : undefined;
    quests.push({
      id: q.id,
      title: interpolate(q.title, vars),
      status: st.status,
      giver: q.giver ? { id: q.giver, name: g?.name ?? q.giver, portrait: g?.portrait, color: g?.color } : undefined,
      summary: q.summary ? interpolate(q.summary, vars) : undefined,
      steps,
      progress: `${req.filter((s) => done.has(s.id)).length}/${req.length}`,
      rewards: rewardsOf(doc, q.reward),
      requires: q.requiresSrc,
    });
  }
  const order: Record<QuestStatus, number> = { active: 0, available: 1, completed: 2, failed: 3, locked: 4 };
  quests.sort((a, b) => order[a.status] - order[b.status]);
  const selected = opts.selected && quests.some((q) => q.id === opts.selected) ? opts.selected : (quests.find((q) => q.status === "active") ?? quests[0])?.id ?? null;
  const items = Object.entries(state.items)
    .filter(([, n]) => n > 0)
    .map(([id, count]) => ({ id, name: doc.items[id]?.name ?? id, icon: doc.items[id]?.icon ?? id, count }));
  const flags = Object.values(doc.flags)
    .filter((f) => f.label)
    .map((f) => ({ name: f.name, label: f.label!, icon: f.icon ?? "scroll", value: String(vars[f.name] ?? f.value) }));
  return { title: doc.title, quests, selected, items, flags };
}

const di = (g: Ctx, img: Drawable, ...a: number[]) => (g.drawImage as (...args: unknown[]) => void)(img, ...a);

function drawNine(g: Ctx, src: Drawable, m: number, x: number, y: number, w: number, h: number, S: number) {
  const sw = src.width;
  const sh = src.height;
  const M = m * S;
  const cols = [
    [0, m, x, M],
    [m, sw - 2 * m, x + M, w - 2 * M],
    [sw - m, m, x + w - M, M],
  ] as const;
  const rows = [
    [0, m, y, M],
    [m, sh - 2 * m, y + M, h - 2 * M],
    [sh - m, m, y + h - M, M],
  ] as const;
  for (const [sx, sW, dx, dW] of cols) for (const [sy, sH, dy, dH] of rows) if (dW > 0 && dH > 0) di(g, src, sx, sy, sW, sH, dx, dy, dW, dH);
}

const rgb = (c: readonly number[], a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export const LOG_COLORS: Record<BoxStyle, { text: string; dim: string; title: string; accent: string; good: string; bad: string; select: string }> = {
  teak: { text: "#f3e7d3", dim: "#b49a7c", title: "#ffd27a", accent: "#f4ae3d", good: "#8fd16a", bad: "#e5806c", select: "rgba(244,174,61,0.16)" },
  lantern: { text: "#fff3e0", dim: "#e0a890", title: "#ffd27a", accent: "#ffd27a", good: "#a8e07a", bad: "#ffb0a0", select: "rgba(255,210,122,0.16)" },
  paper: { text: "#3a2819", dim: "#8a6a44", title: "#8a3a22", accent: "#b9411f", good: "#3f7d32", bad: "#b9411f", select: "rgba(185,65,31,0.12)" },
  night: { text: "#e8f0ff", dim: "#8fa3c8", title: "#ffd27a", accent: "#8fc7e8", good: "#9be29b", bad: "#ff9a8a", select: "rgba(143,199,232,0.16)" },
};

export interface LogDrawOptions {
  scale: number;
  style?: BoxStyle;
  /** Fonts registered as "Kanit" / "Kanit Medium". */
  font?: string;
  caption?: string;
}

/** Hit areas of the quest list (game pixels) so the editor can select quests by clicking. */
export interface LogHit {
  quests: Array<{ id: string; x: number; y: number; w: number; h: number }>;
}

export function drawQuestLog(g: Ctx, A: LogAssets, view: LogView, opts: LogDrawOptions): LogHit {
  const S = opts.scale;
  const style = opts.style ?? "teak";
  const C = LOG_COLORS[style];
  const P = PALETTES[style];
  const W = VIEW.width * S;
  const H = VIEW.height * S;
  const fam = opts.font ?? "Kanit";
  const font = (px: number, medium = false) => `${Math.round(px * S)}px "${medium ? `${fam} Medium` : fam}"`;
  const hit: LogHit = { quests: [] };
  g.imageSmoothingEnabled = false;
  g.globalAlpha = 1;
  g.textBaseline = "alphabetic";
  g.textAlign = "left";

  // background
  if (A.background) {
    di(g, A.background, 0, 0, A.background.width, A.background.height, 0, 0, W, H);
    g.fillStyle = "rgba(10,7,5,0.45)";
    g.fillRect(0, 0, W, H);
  } else {
    g.fillStyle = "#1a1410";
    g.fillRect(0, 0, W, H);
  }

  const px = 12;
  const py = 10;
  const pw = VIEW.width - 24;
  const ph = VIEW.height - 20;
  g.fillStyle = rgb(P.inner, style === "paper" ? 0.85 : 0.72);
  g.fillRect((px + 4) * S, (py + 4) * S, (pw - 8) * S, (ph - 8) * S);
  drawNine(g, A.box, 8, px * S, py * S, pw * S, ph * S, S);
  const text = (t: string, x: number, y: number, size: number, color: string, medium = false, align = "left") => {
    g.font = font(size, medium);
    g.fillStyle = color;
    g.textAlign = align;
    g.fillText(t, x * S, y * S);
    g.textAlign = "left";
  };
  const measure = (t: string, size: number, medium = false) => {
    g.font = font(size, medium);
    return g.measureText(t).width / S;
  };
  const ellipsis = (t: string, w: number, size: number, medium = false) => {
    if (measure(t, size, medium) <= w) return t;
    let s = t;
    while (s.length > 1 && measure(`${s}…`, size, medium) > w) s = s.slice(0, -1);
    return `${s}…`;
  };
  const icon = (img: Drawable, x: number, y: number, size = img.width) => di(g, img, 0, 0, img.width, img.height, x * S, y * S, size * S, size * S);

  // header: plate with the log title, flags on the right
  const head = "สมุดภารกิจ";
  const plateW = Math.ceil(measure(head, 9, true)) + 16;
  drawNine(g, A.plate, 5, (px + 10) * S, (py - 4) * S, plateW * S, 16 * S, S);
  text(head, px + 10 + plateW / 2, py + 8, 9, rgb(P.outline), true, "center");
  text(ellipsis(view.title, 180, 8), px + 16 + plateW, py + 9, 8, C.dim);
  let fx = px + pw - 12;
  for (const f of [...view.flags].reverse()) {
    const label = `${f.label} ${f.value}`;
    const w = measure(label, 8, true);
    fx -= w;
    text(label, fx, py + 9, 8, C.text, true);
    fx -= 14;
    icon(A.icon(f.icon), fx, py - 1, 12);
    fx -= 8;
  }

  const top = py + 18;
  g.fillStyle = rgb(P.shadow);
  g.fillRect((px + 8) * S, top * S, (pw - 16) * S, S);

  // quest list
  const lx = px + 8;
  const lw = 144;
  let ly = top + 5;
  if (!view.quests.length) text("ยังไม่มีภารกิจ", lx + 6, ly + 14, 8, C.dim);
  for (const q of view.quests) {
    const sel = q.id === view.selected;
    if (sel) {
      g.fillStyle = C.select;
      g.fillRect(lx * S, ly * S, lw * S, 28 * S);
      g.fillStyle = C.accent;
      g.fillRect(lx * S, ly * S, 2 * S, 28 * S);
    }
    icon(A.state(q.status), lx + 5, ly + 4);
    text(ellipsis(q.title, lw - 22, 8.5, true), lx + 18, ly + 12, 8.5, q.status === "completed" || q.status === "failed" ? C.dim : C.text, true);
    const sub = `${LOG_STATUS_TH[q.status]} · ${q.progress}`;
    text(sub, lx + 18, ly + 23, 7, q.status === "failed" ? C.bad : q.status === "completed" ? C.good : q.status === "available" ? C.accent : C.dim);
    hit.quests.push({ id: q.id, x: lx, y: ly, w: lw, h: 28 });
    ly += 31;
    if (ly > py + ph - 50) break;
  }

  g.fillStyle = rgb(P.shadow);
  g.fillRect((lx + lw + 5) * S, (top + 5) * S, S, (ph - 56) * S);

  // detail
  const q = view.quests.find((x) => x.id === view.selected);
  const dx = lx + lw + 13;
  const dw = px + pw - 10 - dx;
  if (q) {
    let y = top + 5;
    drawNine(g, A.well, 4, dx * S, y * S, 36 * S, 36 * S, S);
    const portrait = A.portrait(q.giver?.portrait);
    if (portrait) di(g, portrait, 0, 0, portrait.width, portrait.height, (dx + 2) * S, (y + 2) * S, 32 * S, 32 * S);
    else icon(A.icon("scroll"), dx + 10, y + 10);
    const tx = dx + 43;
    text(ellipsis(q.title, dw - 43, 10.5, true), tx, y + 12, 10.5, C.title, true);
    if (q.giver) text(`ผู้ให้ภารกิจ: ${q.giver.name}`, tx, y + 23, 7.5, q.giver.color ?? C.dim);
    const badge = LOG_STATUS_TH[q.status];
    text(badge, px + pw - 12, y + 23, 7.5, q.status === "failed" ? C.bad : q.status === "completed" ? C.good : C.accent, true, "right");
    if (q.summary) {
      g.font = font(7.5);
      const lines = wrapText(q.summary, (dw - 43) * S, (s: string) => g.measureText(s).width).slice(0, 2);
      lines.forEach((l, i) => text(l, tx, y + 33 + i * 9, 7.5, C.text));
    }
    y += 48;
    for (const s of q.steps) {
      const iconName = s.state === "done" ? "completed" : s.state === "current" ? "current" : s.state === "failed" ? "failed" : s.optional ? "bonus" : "todo";
      icon(A.state(iconName), dx + 2, y + 2);
      const color = s.state === "done" ? C.dim : s.state === "current" ? C.text : s.state === "failed" ? C.bad : C.dim;
      const label = s.optional ? `โบนัส · ${s.title}` : s.title;
      text(ellipsis(label, dw - 18, 8, s.state === "current"), dx + 16, y + 10, 8, color, s.state === "current");
      if (s.state === "done") {
        g.fillStyle = C.dim;
        g.fillRect((dx + 16) * S, (y + 6.5) * S, Math.min(measure(label, 8), dw - 18) * S, Math.max(1, Math.round(S * 0.6)));
      }
      y += 13;
      if (s.state === "current" && s.hint) {
        text(ellipsis(`› ${s.hint}`, dw - 22, 7), dx + 20, y + 6, 7, C.accent);
        y += 10;
      }
      if (y > py + ph - 62) break;
    }
    if (q.rewards.length) {
      const ry = py + ph - 48;
      text("รางวัล", dx, ry + 9, 7.5, C.dim, true);
      let rx = dx + 30;
      for (const r of q.rewards) {
        icon(A.icon(r.icon), rx, ry - 1, 12);
        text(r.label, rx + 14, ry + 9, 7.5, C.text);
        rx += 20 + measure(r.label, 7.5);
      }
    }
  }

  // inventory bar
  const by = py + ph - 32;
  g.fillStyle = rgb(P.shadow);
  g.fillRect((px + 8) * S, by * S, (pw - 16) * S, S);
  text("ย่าม", px + 12, by + 17, 8, C.dim, true);
  let ix = px + 40;
  if (!view.items.length) text("ว่างเปล่า", ix, by + 17, 7.5, C.dim);
  for (const it of view.items) {
    icon(A.icon(it.icon), ix, by + 5);
    const label = `${it.name}${it.count > 1 ? ` ×${it.count}` : ""}`;
    text(label, ix + 18, by + 17, 7.5, C.text);
    ix += 26 + measure(label, 7.5);
    if (ix > px + pw - 40) break;
  }
  if (opts.caption) text(opts.caption, VIEW.width - 6, VIEW.height - 3, 6, "rgba(255,255,255,0.55)", false, "right");
  return hit;
}

/** RGBA Pixels → anything the caller can draw (canvas). */
export type PixelsToDrawable = (p: Pixels) => Drawable;
