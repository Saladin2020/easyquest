import type { CompileResult, Value } from "../../src/shared/types";
import type { QuestState } from "../../src/shared/manager";

export interface WorkspaceSummary {
  root: string;
  config: { name: string; style: string };
  quests: { id: string; title: string; quests: number; steps: number; dialogues: string[]; errors: number; warnings: number }[];
  dialogues: { id: string; ezd: boolean; json: boolean; events: string[]; vars: string[] }[];
  backgrounds: string[];
}

export type Compiled = CompileResult & { deps: { from: string; to: string }[] };
export interface SimResult {
  log: string[];
  state: QuestState;
  transcript: string[];
  warnings: string[];
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; errors?: { line: number; message: string }[] };
  if (!res.ok) throw new Error(body.error ?? (body.errors?.length ? `line ${body.errors[0]!.line}: ${body.errors[0]!.message}` : `HTTP ${res.status}`));
  return body;
}

const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const fetchWorkspace = () => fetch("/api/workspace").then((r) => json<WorkspaceSummary>(r));
export const fetchQuest = (id: string) => fetch(`/api/quests/${id}`).then((r) => json<Compiled & { id: string; source: string }>(r));
export const saveQuest = (id: string, source: string, force = false) => post(`/api/quests/${id}`, { source, force }).then((r) => json<{ saved: boolean }>(r));
export const compile = (id: string, source: string) => post("/api/compile", { id, source }).then((r) => json<Compiled>(r));
export const simulate = (id: string, source: string, inputs: string, vars?: Record<string, Value>) => post("/api/simulate", { id, source, inputs, vars }).then((r) => json<SimResult>(r));
export async function renderLog(body: { id: string; source: string; inputs: string; selected?: string; style?: string; background?: string | null; scale?: number }): Promise<string> {
  const r = await post("/api/render", body);
  if (!r.ok) await json(r);
  return URL.createObjectURL(await r.blob());
}
export const exportQuests = (id: string, preset: string, style?: string, picks?: number[]) =>
  post("/api/export", { id, preset, style, picks }).then((r) => json<{ ok: boolean; dirs: string[]; files: number; warnings: string[] }>(r));
export const portraitUrl = (set: string) => `/api/portraits/${encodeURIComponent(set)}`;
