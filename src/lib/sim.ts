import { DialogueRunner } from "../shared/dialogueRunner.js";
import { simulate, type SimInput } from "../shared/manager.js";
import type { QuestDoc, Value } from "../shared/types.js";
import { loadCompiledDialogue } from "./workspace.js";

/**
 * Simulator inputs as text, one per line or separated by `;`:
 *   camera temple            @camera temple        (an event, as Easy Dialogue prints it)
 *   ~ coins = 10             vars {"coins":15}     (set flags)
 *   give mango 2             take balm
 *   play village_delivery 0,0                      (play a linked dialogue with picks through the bridge)
 * Other lines (Easy Dialogue transcript lines such as "ป้าแดง: …" or "> choice") are ignored.
 */
export type TextInput = SimInput | { play: string; picks: number[] };

export function parseInputs(text: string): { inputs: TextInput[]; ignored: number } {
  const inputs: TextInput[] = [];
  let ignored = 0;
  const parts = text.split(/\r?\n/).flatMap((l) => (l.trim().startsWith("vars ") ? [l] : l.split(";")));
  for (const raw of parts) {
    const s = raw.trim();
    if (!s || s.startsWith("//")) continue;
    let m: RegExpExecArray | null;
    if ((m = /^vars\s+(\{.*\})\s*$/.exec(s))) inputs.push({ set: JSON.parse(m[1]!) as Record<string, Value> });
    else if ((m = /^~\s*([\p{L}_][\p{L}\p{N}_]*)\s*=\s*(.+)$/u.exec(s))) {
      const v = m[2]!.trim();
      inputs.push({ set: { [m[1]!]: v === "true" ? true : v === "false" ? false : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v.replace(/^"(.*)"$/, "$1") } });
    } else if ((m = /^(give|take)\s+([A-Za-z0-9_-]+)(?:\s+(\d+))?$/.exec(s))) {
      const n = m[3] ? Number(m[3]) : 1;
      inputs.push(m[1] === "give" ? { give: m[2]!, n } : { take: m[2]!, n });
    } else if ((m = /^play\s+([a-z0-9_-]+)(?:\s+([\d,\s]+))?$/.exec(s))) {
      inputs.push({ play: m[1]!, picks: (m[2] ?? "").split(/[,\s]+/).filter(Boolean).map(Number) });
    } else if ((m = /^@?([A-Za-z_][\w-]*)((?:\s+[^\s]+)*)\s*$/.exec(s)) && !/[:>]/.test(s.split(/\s/)[0]!)) {
      inputs.push({ event: `${m[1]}${m[2] ?? ""}` });
    } else ignored++;
  }
  return { inputs, ignored };
}

export interface SimResult {
  log: string[];
  state: ReturnType<typeof simulate>["state"];
  transcript: string[];
  warnings: string[];
}

/** Resolve `play` inputs to compiled dialogues in the workspace and run the simulator. */
export async function runSimulation(root: string, doc: QuestDoc, inputs: TextInput[], opts: { vars?: Record<string, Value> } = {}): Promise<SimResult> {
  const warnings: string[] = [];
  const resolved: SimInput[] = [];
  for (const inp of inputs) {
    if ("play" in inp) {
      const d = await loadCompiledDialogue(root, inp.play);
      if (d.warning) warnings.push(d.warning);
      resolved.push({ dialogue: d.doc, picks: inp.picks, id: inp.play });
    } else resolved.push(inp);
  }
  const lastEventIdx = resolved.map((x) => "event" in x).lastIndexOf(true);
  const setsAfter = resolved.slice(lastEventIdx + 1).some((x) => "set" in x);
  const setsBefore = resolved.slice(0, lastEventIdx).some((x) => "set" in x);
  if (lastEventIdx >= 0 && setsAfter && !setsBefore && resolved.filter((x) => "event" in x).length > 1) {
    warnings.push("Variables only arrive after all events (Easy Dialogue `play --vars` output) — steps waiting on flags between events may be missed; use `play <dialogue> <picks>` for exact ordering");
  }
  const r = simulate(doc, resolved, { vars: opts.vars, Runner: DialogueRunner as never });
  return { log: r.log, state: r.state, transcript: r.transcript, warnings };
}
