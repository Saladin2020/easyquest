import type { QuestDoc, QuestStatus } from "../../../src/shared/types";
import type { QuestState } from "../../../src/shared/manager";

interface Props {
  doc: QuestDoc | null;
  deps: { from: string; to: string }[];
  state: QuestState | null;
  selected?: string;
  onSelect: (quest: string) => void;
  onPick: (line: number) => void;
}

const ROW = 74;
const QW = 150;
const SW = 118;
const SH = 40;
const GAP = 22;
const LEFT = 40;

const STATUS_LABEL: Record<QuestStatus, string> = { locked: "locked", available: "available", active: "active", completed: "done", failed: "failed" };

/** One lane per quest: quest card → its steps in order; requires edges curve down the left side. */
export function QuestGraph({ doc, deps, state, selected, onSelect, onPick }: Props) {
  if (!doc) return <div className="graph-wrap"><p className="hint">No quests yet.</p></div>;
  const quests = doc.quests;
  const rowOf = new Map(quests.map((q, i) => [q.id, i]));
  const maxSteps = Math.max(1, ...quests.map((q) => q.steps.length));
  const width = LEFT + QW + GAP + maxSteps * (SW + GAP) + 10;
  const height = quests.length * ROW + 16;
  const y = (i: number) => 10 + i * ROW;
  return (
    <div className="graph-wrap qgraph-wrap">
      <svg className="graph qgraph" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Quest graph">
        <defs>
          <marker id="qarrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="rgba(244,174,61,.8)" />
          </marker>
        </defs>
        {deps.map(({ from, to }) => {
          const a = rowOf.get(from);
          const b = rowOf.get(to);
          if (a === undefined || b === undefined) return null;
          const y1 = y(a) + SH / 2 + 6;
          const y2 = y(b) + SH / 2 + 6;
          const bend = LEFT - 14 - Math.abs(b - a) * 6;
          return (
            <g key={`${from}-${to}`} className="edge edge-req">
              <path d={`M${LEFT},${y1} C${bend},${y1} ${bend},${y2} ${LEFT - 2},${y2}`} markerEnd="url(#qarrow)" />
            </g>
          );
        })}
        {quests.map((q, i) => {
          const qs = state?.quests[q.id];
          const st: QuestStatus = qs?.status ?? (q.requires ? "locked" : "available");
          const done = new Set(qs?.steps ?? []);
          const firstOpen = q.steps.find((s) => !s.optional && !done.has(s.id))?.id;
          const top = y(i);
          return (
            <g key={q.id}>
              <g className={`node qnode qs-${st}${selected === q.id ? " node-current" : ""}`} transform={`translate(${LEFT},${top})`} onClick={() => { onSelect(q.id); onPick(q.line); }}>
                <rect width={QW} height={SH + 12} rx={3} />
                <text className="node-title" x={10} y={20}>{q.title.length > 16 ? `${q.title.slice(0, 15)}…` : q.title}</text>
                <text className="node-meta" x={10} y={38}>{q.id} · {STATUS_LABEL[st]}</text>
              </g>
              {q.steps.map((s, j) => {
                const x = LEFT + QW + GAP + j * (SW + GAP);
                const cls = done.has(s.id) ? "step-done" : st === "active" && s.id === firstOpen ? "step-current" : st === "failed" ? "step-failed" : "";
                return (
                  <g key={s.id}>
                    <line className="qlink" x1={x - GAP} y1={top + (SH + 12) / 2} x2={x} y2={top + (SH + 12) / 2} />
                    <g className={`node qstep ${cls}${s.optional ? " step-bonus" : ""}`} transform={`translate(${x},${top + 6})`} onClick={() => onPick(s.line)}>
                      <rect width={SW} height={SH} rx={3} />
                      <text className="node-title" x={8} y={17}>{done.has(s.id) ? "✓ " : s.optional ? "★ " : ""}{s.title.length > 13 ? `${s.title.slice(0, 12)}…` : s.title}</text>
                      <text className="node-meta" x={8} y={32}>{s.id}</text>
                    </g>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
