/** easyquest/1 — compiled quest document shared by the CLI, editor, simulator and runtimes. */

export const FORMAT = "easyquest/1";

export type Value = number | string | boolean;

export type BinOp = "+" | "-" | "*" | "/" | "%" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "and" | "or";

export type Expr =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "var"; n: string }
  | { k: "un"; op: "not" | "-"; a: Expr }
  | { k: "bin"; op: BinOp; a: Expr; b: Expr }
  /** has(item[, n]) count(item) done(q) active(q) failed(q) available(q) step(q, s) seen(name, arg…) */
  | { k: "call"; f: QuestFn; args: Expr[] };

export const QUEST_FNS = ["has", "count", "done", "active", "failed", "available", "step", "seen"] as const;
export type QuestFn = (typeof QUEST_FNS)[number];

/** `on camera temple` (event name + args, `*` matches any) or `when delivered >= 2`. */
export type Trigger = { on: string; args: string[]; line: number } | { when: Expr; src: string; line: number };

export type Effect =
  | { set: string; op: "=" | "+=" | "-="; value: Expr; line: number }
  | { give: string; n: number; line: number }
  | { take: string; n: number; line: number }
  | { event: string; args: string[]; line: number };

export interface Step {
  id: string;
  title: string;
  optional: boolean;
  hint?: string;
  /** Any trigger completes the step (an empty list never completes). */
  done: Trigger[];
  effects: Effect[];
  line: number;
}

export interface Quest {
  id: string;
  title: string;
  giver?: string;
  summary?: string;
  /** Locked until this is true (prerequisites). */
  requires: Expr | null;
  requiresSrc?: string;
  /** Available → active. Empty = starts as soon as it is available. */
  start: Trigger[];
  fail: Trigger[];
  onStart: Effect[];
  onFail: Effect[];
  reward: Effect[];
  steps: Step[];
  line: number;
}

export interface ItemDef {
  id: string;
  name: string;
  icon: string;
  desc?: string;
  line: number;
}

/** `@achievement id "Title" [icon=…] [desc="…"] [hidden] when <expr>` — unlocks once, the first time <expr> is true. */
export interface AchievementDef {
  id: string;
  title: string;
  when: Expr;
  whenSrc: string;
  icon: string;
  desc?: string;
  hidden?: boolean;
  line: number;
}

export interface FlagDef {
  name: string;
  value: Value;
  /** Shown in the quest-log bar when set. */
  label?: string;
  icon?: string;
  /** Declared by a linked .ezd (@var) rather than @flag. */
  fromDialogue?: string;
  line: number;
}

export interface DialogueLink {
  id: string;
  /** Character id → display name / portrait set (from the .ezd @char lines). */
  cast: Record<string, { name: string; portrait?: string; color?: string }>;
  /** Events the dialogue fires (`camera temple`), with source lines in the .ezd. */
  events: Array<{ name: string; args: string[]; line: number }>;
  vars: Record<string, Value>;
  found: boolean;
}

export interface QuestDoc {
  format: typeof FORMAT;
  id: string;
  title: string;
  dialogues: DialogueLink[];
  flags: Record<string, FlagDef>;
  items: Record<string, ItemDef>;
  /** Game-side event names declared with @event (talk, enter, pickup…). */
  events: string[];
  quests: Quest[];
  /** Present when the file declares @achievement lines. */
  achievements?: AchievementDef[];
}

export type QuestStatus = "locked" | "available" | "active" | "completed" | "failed";

export interface Diagnostic {
  severity: "error" | "warning";
  message: string;
  line: number;
  col?: number;
  file?: string;
}

export interface CompileResult {
  doc: QuestDoc | null;
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

/** Events Easy Quest itself understands without an @event declaration. */
export const BUILTIN_EVENTS = ["end", "talk", "enter", "pickup", "use", "defeat"] as const;

/** Quest-log frame styles (the Easy Dialogue box palettes). */
export type BoxStyle = "teak" | "lantern" | "paper" | "night";
export const BOX_STYLES: BoxStyle[] = ["teak", "lantern", "paper", "night"];
