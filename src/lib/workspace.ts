import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanCompiled, scanEzd, type ScannedDialogue } from "../shared/ezd.js";
import { SAFE_ID, compileQuests } from "../shared/parser.js";
import type { CompileResult, QuestDoc } from "../shared/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Package root, whether running from src/lib (tsx), dist/ (built) or a test. */
export const pkgRoot = [path.resolve(here, "../.."), path.resolve(here, "..")].find((p) => existsSync(path.join(p, "samples", "quests"))) ?? path.resolve(here, "../..");
export const RUNTIME_DIR = path.join(pkgRoot, "runtime");
export const SAMPLES_DIR = path.join(pkgRoot, "samples");
export const QUEST_EXT = ".ezq";
export const CONFIG_NAME = "easyquest.config.json";

export interface EasyQuestConfig {
  name: string;
  quests: string;
  dialogues: string;
  portraits: string;
  backgrounds: string;
  exports: string;
}

export const DEFAULT_CONFIG: EasyQuestConfig = { name: "Easy Quest workspace", quests: "quests", dialogues: "dialogues", portraits: "portraits", backgrounds: "backgrounds", exports: "exports" };

export function assertSafeId(id: unknown, label = "quest file id"): string {
  if (typeof id !== "string" || !SAFE_ID.test(id)) throw new Error(`Invalid ${label} "${String(id)}" (use a-z, 0-9, _ and -)`);
  return id;
}

export function resolveWorkspace(dir = process.env.EASYQUEST_WORKSPACE || process.cwd()): string {
  return path.resolve(dir);
}

function config(root: string): EasyQuestConfig {
  const f = path.join(root, CONFIG_NAME);
  if (!existsSync(f)) return DEFAULT_CONFIG;
  try {
    return { ...DEFAULT_CONFIG, ...(JSON.parse(readFileSync(f, "utf8")) as Partial<EasyQuestConfig>) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export const dirs = (root: string) => {
  const c = config(root);
  return {
    quests: path.join(root, c.quests),
    dialogues: path.join(root, c.dialogues),
    portraits: path.join(root, c.portraits),
    backgrounds: path.join(root, c.backgrounds),
    exports: path.join(root, c.exports),
  };
};

/** Workspace plus EASYQUEST_ALLOWED_DIRS (path-delimited). */
export function allowedRoots(root: string): string[] {
  const extra = (process.env.EASYQUEST_ALLOWED_DIRS ?? "").split(path.delimiter).map((s) => s.trim()).filter(Boolean);
  return [path.resolve(root), ...extra.map((p) => path.resolve(p))];
}

export function resolveInside(root: string, p: string): string {
  const abs = path.resolve(root, p);
  for (const r of allowedRoots(root)) {
    const rel = path.relative(r, abs);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) return abs;
  }
  throw new Error(`Path "${p}" is outside the workspace (add it to EASYQUEST_ALLOWED_DIRS)`);
}

async function copyTree(from: string, to: string, force: boolean): Promise<void> {
  await mkdir(to, { recursive: true });
  for (const e of await readdir(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) await copyTree(a, b, force);
    else if (force || !existsSync(b)) await copyFile(a, b);
  }
}

/** Create quests/, dialogues/, portraits/, exports/ with the village_delivery demo (quest + linked dialogue + giver portraits). */
export async function initWorkspace(dir = process.cwd(), opts: { force?: boolean } = {}): Promise<string> {
  const root = path.resolve(dir);
  await mkdir(root, { recursive: true });
  const cfg = path.join(root, CONFIG_NAME);
  if (!existsSync(cfg)) await writeFile(cfg, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
  const d = dirs(root);
  await copyTree(path.join(SAMPLES_DIR, "quests"), d.quests, Boolean(opts.force));
  await copyTree(path.join(SAMPLES_DIR, "dialogues"), d.dialogues, Boolean(opts.force));
  await copyTree(path.join(SAMPLES_DIR, "portraits"), d.portraits, Boolean(opts.force));
  await copyTree(path.join(SAMPLES_DIR, "backgrounds"), d.backgrounds, Boolean(opts.force));
  await mkdir(d.exports, { recursive: true });
  return root;
}

export function questPath(root: string, id: string): string {
  return path.join(dirs(root).quests, `${assertSafeId(id)}${QUEST_EXT}`);
}

// ------------------------------------------------------------------ dialogues (Easy Dialogue contract)

export interface DialogueFiles {
  ezd?: string;
  json?: string;
}

export function dialogueFiles(root: string, id: string, hint?: string): DialogueFiles {
  const out: DialogueFiles = {};
  if (hint) {
    const p = resolveInside(root, hint);
    if (p.endsWith(".json")) out.json = p;
    else out.ezd = p;
    const twin = p.endsWith(".json") ? p.replace(/\.dialogue\.json$|\.json$/, ".ezd") : p.replace(/\.ezd$/, ".dialogue.json");
    if (existsSync(twin)) out[p.endsWith(".json") ? "ezd" : "json"] = twin;
  } else {
    const base = path.join(dirs(root).dialogues, id);
    if (existsSync(`${base}.ezd`)) out.ezd = `${base}.ezd`;
    if (existsSync(`${base}.dialogue.json`)) out.json = `${base}.dialogue.json`;
  }
  if (out.ezd && !existsSync(out.ezd)) delete out.ezd;
  if (out.json && !existsSync(out.json)) delete out.json;
  return out;
}

/** Scan a linked dialogue: the .ezd source (with line numbers) when present, else its compiled JSON. */
export function scanDialogue(root: string, id: string, hint?: string): ScannedDialogue | null {
  const f = dialogueFiles(root, id, hint);
  try {
    if (f.ezd) return { ...scanEzd(readFileSync(f.ezd, "utf8"), id), id };
    if (f.json) return { ...scanCompiled(JSON.parse(readFileSync(f.json, "utf8"))), id };
  } catch {
    return null;
  }
  return null;
}

/**
 * Compiled `easydialogue/1` JSON for playing a dialogue: `<id>.dialogue.json` when it is at least as new as
 * the .ezd, else compiled on the fly with the Easy Dialogue CLI (EASYQUEST_EASYDIALOGUE_CLI = path to
 * easydialogue's dist/cli.js or a wrapper .mjs).
 */
export async function loadCompiledDialogue(root: string, id: string, hint?: string): Promise<{ doc: unknown; source: string; warning?: string }> {
  const f = dialogueFiles(root, id, hint);
  const fresh = f.json && (!f.ezd || statSync(f.json).mtimeMs >= statSync(f.ezd).mtimeMs - 1000);
  const cli = process.env.EASYQUEST_EASYDIALOGUE_CLI?.trim();
  if (f.ezd && !fresh && cli && existsSync(cli)) {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "easyquest-ezd-"));
    const out = path.join(tmp, `${id}.dialogue.json`);
    try {
      execFileSync(process.execPath, [cli, "compile", f.ezd, "--out", out], { stdio: ["ignore", "ignore", "pipe"] });
      return { doc: JSON.parse(await readFile(out, "utf8")), source: `${path.basename(f.ezd)} (compiled with Easy Dialogue)` };
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }
  if (f.json) {
    const doc = JSON.parse(await readFile(f.json, "utf8"));
    return { doc, source: path.basename(f.json), ...(fresh ? {} : { warning: `${path.basename(f.json)} is older than ${path.basename(f.ezd!)} — re-run "easydialogue compile" or set EASYQUEST_EASYDIALOGUE_CLI` }) };
  }
  throw new Error(
    f.ezd
      ? `Dialogue "${id}" has no compiled JSON: run "easydialogue compile ${id} --out dialogues/${id}.dialogue.json" or set EASYQUEST_EASYDIALOGUE_CLI`
      : `Dialogue "${id}" not found in ${dirs(root).dialogues}`,
  );
}

export async function listDialogues(root: string): Promise<Array<{ id: string; ezd: boolean; json: boolean; events: string[]; vars: string[] }>> {
  const d = dirs(root).dialogues;
  if (!existsSync(d)) return [];
  const ids = new Set<string>();
  for (const f of await readdir(d)) {
    const m = /^([a-z0-9_-]+)(\.ezd|\.dialogue\.json)$/.exec(f);
    if (m) ids.add(m[1]!);
  }
  return [...ids].sort().map((id) => {
    const f = dialogueFiles(root, id);
    const s = scanDialogue(root, id);
    return { id, ezd: Boolean(f.ezd), json: Boolean(f.json), events: [...new Set((s?.events ?? []).map((e) => [e.name, ...e.args].join(" ")))], vars: Object.keys(s?.vars ?? {}) };
  });
}

// ------------------------------------------------------------------ quests

export function compileSource(root: string, source: string, id: string, file?: string): CompileResult {
  return compileQuests(source, { id, file, dialogue: (did, hint) => scanDialogue(root, did, hint) });
}

export async function readQuest(root: string, id: string): Promise<{ id: string; file: string; source: string; result: CompileResult }> {
  const file = questPath(root, id);
  if (!existsSync(file)) throw new Error(`Quest file "${id}" not found (list them with: easyquest list)`);
  const source = await readFile(file, "utf8");
  return { id, file, source, result: compileSource(root, source, id, path.relative(root, file)) };
}

export async function compileById(root: string, id: string): Promise<QuestDoc> {
  const { result } = await readQuest(root, id);
  if (!result.doc) {
    const first = result.errors.slice(0, 5).map((e) => `  line ${e.line}: ${e.message}`).join("\n");
    throw new Error(`Quest file "${id}" has ${result.errors.length} error(s):\n${first}`);
  }
  return result.doc;
}

/** Validate then save. Refuses to save a file with errors unless `force`; `dryRun` only validates. */
export async function saveQuest(root: string, id: string, source: string, opts: { force?: boolean; dryRun?: boolean } = {}): Promise<{ file: string; saved: boolean; result: CompileResult }> {
  const file = questPath(root, id);
  const result = compileSource(root, source, id, path.relative(root, file));
  if (opts.dryRun || (result.errors.length && !opts.force)) return { file, saved: false, result };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, source.endsWith("\n") ? source : `${source}\n`);
  return { file, saved: true, result };
}

export interface QuestFileSummary {
  id: string;
  title: string;
  quests: number;
  steps: number;
  dialogues: string[];
  errors: number;
  warnings: number;
}

export async function listQuests(root: string): Promise<QuestFileSummary[]> {
  const d = dirs(root).quests;
  if (!existsSync(d)) return [];
  const out: QuestFileSummary[] = [];
  for (const f of (await readdir(d)).filter((x) => x.endsWith(QUEST_EXT)).sort()) {
    const id = f.slice(0, -QUEST_EXT.length);
    if (!SAFE_ID.test(id)) continue;
    const { result, source } = await readQuest(root, id);
    const doc = result.doc;
    const title = doc?.title ?? /^@title\s+(.+)$/m.exec(source)?.[1] ?? id;
    out.push({
      id,
      title,
      quests: doc?.quests.length ?? (source.match(/^===/gm) ?? []).length,
      steps: doc?.quests.reduce((n, q) => n + q.steps.length, 0) ?? 0,
      dialogues: doc?.dialogues.map((x) => x.id) ?? [],
      errors: result.errors.length,
      warnings: result.warnings.length,
    });
  }
  return out;
}

export function portraitFile(root: string, portrait: string | undefined, emotion = "neutral"): string | null {
  if (!portrait) return null;
  for (const e of [emotion, "neutral"]) {
    const f = path.join(dirs(root).portraits, portrait, `${e}.png`);
    if (existsSync(f)) return f;
  }
  return null;
}

export async function listBackgrounds(root: string): Promise<string[]> {
  const d = dirs(root).backgrounds;
  if (!existsSync(d)) return [];
  return (await readdir(d)).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4)).sort();
}

export function backgroundFile(root: string, id: string | null | undefined): string | null {
  if (!id) return null;
  const f = path.join(dirs(root).backgrounds, `${assertSafeId(id, "background id")}.png`);
  return existsSync(f) ? f : null;
}

export async function workspaceSummary(root: string) {
  return { root, config: config(root), quests: await listQuests(root), dialogues: await listDialogues(root), backgrounds: await listBackgrounds(root) };
}
