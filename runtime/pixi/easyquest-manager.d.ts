import type { Expr, QuestDoc, QuestStatus, Step, Value } from "../../src/shared/types.js";

export interface QuestState {
  quests: Record<string, { status: QuestStatus; steps: string[] }>;
  vars: Record<string, Value>;
  items: Record<string, number>;
  seen: Record<string, number>;
  achievements?: string[];
}

export type QuestSignal =
  | "quest_available"
  | "quest_started"
  | "achievement_unlocked"
  | "step_completed"
  | "quest_completed"
  | "quest_failed"
  | "item_changed"
  | "flag_changed"
  | "quest_event"
  | "changed";

export declare function formatValue(v: unknown): string;
export declare function interpolate(text: string, vars: Record<string, Value>): string;

export declare class QuestManager {
  constructor(doc: QuestDoc, opts?: { vars?: Record<string, Value>; items?: Record<string, number>; onSignal?: (name: QuestSignal, ...args: unknown[]) => void });
  doc: QuestDoc;
  vars: Record<string, Value>;
  items: Record<string, number>;
  quests: Record<string, { status: QuestStatus; steps: Record<string, boolean> }>;
  seen: Record<string, number>;
  /** Unlocked achievement ids, in unlock order. */
  achieved: string[];
  log: string[];
  on(fn: (name: QuestSignal, ...args: unknown[]) => void): () => void;
  status(id: string): QuestStatus;
  stepDone(quest: string, step: string): boolean;
  count(item: string): number;
  currentStep(id: string): Step | null;
  evaluate(e: Expr): Value;
  emit(name: string, args?: string[], vars?: Record<string, Value> | null): this;
  syncVars(vars: Record<string, Value>): void;
  setFlag(name: string, value: Value): void;
  give(item: string, n?: number): void;
  take(item: string, n?: number): void;
  update(ev: { name: string; args: string[] } | null): void;
  state(): QuestState;
  /** Achievements in file order with their unlocked state. */
  achievements(): Array<{ id: string; title: string; icon: string; desc: string; hidden: boolean; unlocked: boolean }>;
  load(state: Partial<QuestState>): this;
  _log(line: string): void;
}

export interface DialogueRunnerLike {
  doc: { id: string };
  vars: Record<string, Value>;
  onEvent: ((name: string, args: string[], runner: DialogueRunnerLike) => void) | null;
  next(): { type: string; [k: string]: unknown };
  choose(index: number): unknown;
  start(node?: string): unknown;
}

export declare function bridgeDialogue(manager: QuestManager, runner: DialogueRunnerLike, dialogueId?: string): () => { type: string; [k: string]: unknown };

export declare function playDialogue(
  manager: QuestManager,
  Runner: new (doc: any, opts?: any) => DialogueRunnerLike,
  dialogueDoc: unknown,
  picks?: number[],
  opts?: { id?: string; node?: string },
): { transcript: string[]; vars: Record<string, Value> };

export type SimInput =
  | { event: string; vars?: Record<string, Value> }
  | { set: Record<string, Value> }
  | { give: string; n?: number }
  | { take: string; n?: number }
  | { dialogue: unknown; picks?: number[]; id?: string; node?: string };

export declare function simulate(
  doc: QuestDoc,
  inputs: SimInput[],
  opts?: { vars?: Record<string, Value>; Runner?: new (doc: any, opts?: any) => DialogueRunnerLike },
): { log: string[]; state: QuestState; transcript: string[]; manager: QuestManager };
