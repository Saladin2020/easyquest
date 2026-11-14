import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BOX_STYLES, type BoxStyle, type QuestDoc } from "../../src/shared/types";
import { compile, exportQuests, fetchQuest, fetchWorkspace, portraitUrl, renderLog, saveQuest, simulate, type Compiled, type SimResult, type WorkspaceSummary } from "./api";
import { QuestGraph } from "./components/QuestGraph";
import { ScriptEditor } from "./components/ScriptEditor";

const LS_FILE = "easyquest.file";
const LS_INPUTS = "easyquest.inputs";
const PRESETS = [
  { id: "godot", label: "Godot 4.3+", hint: "QuestManager autoload + QuestLog" },
  { id: "pixi", label: "PixiJS v8", hint: "manager + log view + demo" },
  { id: "json", label: "JSON", hint: "easyquest/1" },
  { id: "all", label: "All", hint: "everything above" },
] as const;
const STYLE_TH: Record<BoxStyle, string> = { teak: "ไม้สัก (teak)", lantern: "โคมไฟ (lantern)", paper: "กระดาษสา (paper)", night: "กลางคืน (night)" };
const STATUS_TH: Record<string, string> = { locked: "ยังไม่ปลดล็อก", available: "รับได้", active: "กำลังทำ", completed: "สำเร็จ", failed: "ล้มเหลว" };

const TEMPLATE = (id: string) => `// ${id}
@title ${id}
@dialogue village_delivery
@item mango "มะม่วงสุก" icon=mango

=== ${id} "เควสต์ใหม่"
giver vendor
summary เล่าว่าต้องทำอะไร
start on talk vendor
step talk "คุยกับป้าแดง"
  done on end village_delivery
reward:
  give mango
`;

function readLs(k: string) {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
}
function writeLs(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function App() {
  const [ws, setWs] = useState<WorkspaceSummary | null>(null);
  const [id, setId] = useState("");
  const [source, setSource] = useState("");
  const [saved, setSaved] = useState("");
  const [loadErr, setLoadErr] = useState("");
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "err" | ""; text: string }>({ kind: "", text: "" });
  const [jump, setJump] = useState<{ line: number; nonce: number }>();
  const [compiled, setCompiled] = useState<Compiled | null>(null);
  const [inputs, setInputs] = useState(readLs(LS_INPUTS) || "play village_delivery 0,0");
  const [sim, setSim] = useState<SimResult | null>(null);
  const [simErr, setSimErr] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [style, setStyle] = useState<BoxStyle>("teak");
  const [logUrl, setLogUrl] = useState("");
  const [exportRes, setExportRes] = useState<{ dirs: string[]; files: number; warnings: string[] } | null>(null);
  const [newId, setNewId] = useState("");
  const lastGood = useRef<QuestDoc | null>(null);

  const dSource = useDebounced(source, 250);
  const dInputs = useDebounced(inputs, 250);
  const doc = compiled?.doc ?? lastGood.current;
  if (compiled?.doc) lastGood.current = compiled.doc;
  const diagnostics = useMemo(() => (compiled ? [...compiled.errors, ...compiled.warnings].sort((a, b) => a.line - b.line) : []), [compiled]);
  const dirty = source !== saved;

  const refreshWs = useCallback(async () => {
    const w = await fetchWorkspace();
    setWs(w);
    return w;
  }, []);

  const open = useCallback(async (qid: string) => {
    try {
      const s = await fetchQuest(qid);
      setId(qid);
      setSource(s.source);
      setSaved(s.source);
      setSelected("");
      setExportRes(null);
      writeLs(LS_FILE, qid);
      setLoadErr("");
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refreshWs()
      .then((w) => {
        const want = readLs(LS_FILE);
        const pick = w.quests.find((s) => s.id === want)?.id ?? w.quests.find((s) => s.id === "village_delivery")?.id ?? w.quests[0]?.id;
        if (pick) void open(pick);
      })
      .catch((e) => setLoadErr(e instanceof Error ? e.message : String(e)));
  }, [refreshWs, open]);

  // compile → simulate → render, all server-side (it can read the linked .ezd files)
  useEffect(() => {
    if (!id) return;
    let live = true;
    void compile(id, dSource).then((c) => live && setCompiled(c)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id, dSource]);

  useEffect(() => {
    if (!id || !compiled?.doc) return;
    writeLs(LS_INPUTS, dInputs);
    let live = true;
    void simulate(id, dSource, dInputs)
      .then((r) => {
        if (!live) return;
        setSim(r);
        setSimErr("");
      })
      .catch((e) => live && setSimErr(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [id, dSource, dInputs, compiled]);

  useEffect(() => {
    if (!id || !compiled?.doc) return;
    let live = true;
    let url = "";
    void renderLog({ id, source: dSource, inputs: dInputs, selected: selected || undefined, style, scale: 2 })
      .then((u) => {
        url = u;
        if (live) setLogUrl(u);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (url) setTimeout(() => URL.revokeObjectURL(url), 2000);
    };
  }, [id, dSource, dInputs, selected, style, compiled]);

  const onSave = useCallback(async () => {
    if (!id) return;
    setBusy("save");
    try {
      const errs = compiled?.errors.length ?? 0;
      await saveQuest(id, source, errs > 0);
      setSaved(source);
      setStatus({ kind: errs ? "err" : "ok", text: errs ? `Saved with ${errs} error(s) — exports need a clean file` : `Saved ${id}.ezq` });
      void refreshWs();
    } catch (e) {
      setStatus({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy("");
    }
  }, [id, source, compiled, refreshWs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void onSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSave]);

  const onExport = async (preset: string) => {
    if (!id) return;
    if (compiled?.errors.length) return setStatus({ kind: "err", text: "Fix the errors before exporting" });
    setBusy(`export-${preset}`);
    try {
      if (dirty) {
        await saveQuest(id, source);
        setSaved(source);
      }
      const picks = /play\s+[\w-]+\s+([\d,\s]+)/.exec(inputs)?.[1]?.split(/[,\s]+/).filter(Boolean).map(Number);
      const r = await exportQuests(id, preset, style, picks);
      setExportRes(r);
      setStatus({ kind: "ok", text: `Exported ${preset} · ${r.files} files` });
    } catch (e) {
      setStatus({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy("");
    }
  };

  const onNew = async () => {
    const nid = newId.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
    if (!nid) return;
    if (ws?.quests.some((s) => s.id === nid)) return void open(nid);
    await saveQuest(nid, TEMPLATE(nid), true);
    setNewId("");
    await refreshWs();
    await open(nid);
  };

  const dialogue = doc?.dialogues[0];



  if (loadErr && !ws) {
    return (
      <div className="app">
        <div className="panel">
          <h2>Easy Quest</h2>
          <p className="hint err">{loadErr}</p>
          <p className="hint">Start the API with <code>npx easyquest serve</code> (or <code>npm run dev</code>).</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark brand-scroll" aria-hidden />
          <div>
            <h1 className="brand">
              Easy <span>Quest</span>
            </h1>
            <p className="brand-th">ภารกิจเกม · ขั้นตอน · ธง · ไอเท็ม · ต่อกับ Easy Dialogue</p>
            <div className="sub">
              <span className="tag tag-sky">.ezq quests</span>
              <span className="tag">{dialogue ? `↔ ${dialogue.id}.ezd` : "no dialogue linked"}</span>
              <span className="tag">Kanit · Thai quest log</span>
              <span className="tag tag-leaf">Godot · PixiJS</span>
            </div>
          </div>
        </div>
        <div className="toolbar">
          <div className="tool-group">
            <label className="field-label" htmlFor="quest-pick">Quest file</label>
            <div className="row nowrap">
              <select id="quest-pick" value={id} onChange={(e) => void open(e.target.value)}>
                {ws?.quests.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} ({s.id})
                  </option>
                ))}
              </select>
              <button type="button" className={`save-btn${dirty ? " is-dirty" : ""}`} disabled={busy === "save" || !id} title="Save (Ctrl/⌘+S)" onClick={() => void onSave()}>
                <span className="dot" aria-hidden />
                {busy === "save" ? "Saving…" : dirty ? "Save" : "Saved"}
              </button>
            </div>
          </div>
          <form
            className="tool-group"
            onSubmit={(e) => {
              e.preventDefault();
              void onNew();
            }}
          >
            <label className="field-label" htmlFor="new-id">New quest file</label>
            <div className="row nowrap">
              <input id="new-id" value={newId} placeholder="market_errands" onChange={(e) => setNewId(e.target.value)} />
              <button type="submit">+ New</button>
            </div>
          </form>
        </div>
      </header>

      <main className="layout-dlg">
        <section className="panel panel-script">
          <h2>
            <span className="step">1</span> Quests <small>{id}.ezq</small>
            {dirty && <span className="badge-dirty">unsaved</span>}
          </h2>
          <ScriptEditor value={source} onChange={setSource} diagnostics={diagnostics} jump={jump} />
          <div className={`diag ${compiled?.errors.length ? "diag-err" : "diag-ok"}`}>
            {!compiled?.errors.length ? (
              <p className="hint ok">
                ✓ {doc ? `${doc.quests.length} quests · ${doc.quests.reduce((n, q) => n + q.steps.length, 0)} steps · ${Object.keys(doc.items).length} items · ${Object.keys(doc.flags).length} flags` : ""}
                {compiled?.warnings.length ? ` · ${compiled.warnings.length} warning(s)` : " · no warnings"}
              </p>
            ) : (
              <p className="hint err">✗ {compiled.errors.length} error(s) — graph shows the last good version</p>
            )}
            <ul className="diag-list">
              {diagnostics.map((d, i) => (
                <li key={i} className={`diag-${d.severity}`}>
                  <button type="button" className="diag-line" onClick={() => setJump({ line: d.line, nonce: Date.now() })}>
                    L{d.line}
                  </button>
                  <span>{d.message}</span>
                </li>
              ))}
            </ul>
          </div>
          <details className="cheat">
            <summary>Syntax cheat sheet</summary>
            <pre>{`@dialogue village_delivery     @flag coins label="ค่าขนม" icon=coin
@item mango "มะม่วงสุก" icon=mango      @event talk
=== quest_id "ชื่อเควสต์"
giver vendor
summary ส่งแล้ว {delivered}/3
requires done(other) and reputation >= 1
start on camera market    (or: start when coins >= 5)
fail on end village_delivery
on start:
  give sticky_rice
step temple "ส่งข้าวเหนียวที่วัด"     (bonus = optional)
  done on camera temple
  hint ...
  take sticky_rice
reward:
  ~ reputation += 1
  give kanom_chan`}</pre>
          </details>
        </section>

        <div className="col-right">
          <section className="panel panel-play">
            <h2>
              <span className="step">2</span> Quest log <small>{selected || "auto-selected"}</small>
            </h2>
            <div className="qlog-frame">{logUrl ? <img className="qlog" src={logUrl} alt="Quest log preview" width={960} height={540} /> : <div className="qlog qlog-empty">…</div>}</div>
            <div className="row play-opts">
              <label className="tool-group grow">
                <span className="field-label">Simulate (one input per line or “;”) — play &lt;dialogue&gt; picks · camera temple · talk vendor · ~ coins = 5 · give mango</span>
                <textarea className="sim-input mono" rows={2} value={inputs} spellCheck={false} onChange={(e) => setInputs(e.target.value)} />
              </label>
              <label className="tool-group">
                <span className="field-label">Log style</span>
                <select value={style} onChange={(e) => setStyle(e.target.value as BoxStyle)}>
                  {BOX_STYLES.map((s) => (
                    <option key={s} value={s}>
                      {STYLE_TH[s]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="row quick">
              {["play village_delivery 0,0", "play village_delivery 1,1", "play village_delivery 2", "play village_delivery 0,0; talk vendor; enter market"].map((q) => (
                <button key={q} type="button" className={inputs === q ? "primary" : ""} onClick={() => setInputs(q)}>
                  {q}
                </button>
              ))}
            </div>
            {simErr && <p className="hint err">{simErr}</p>}
          </section>

            <section className="panel panel-graph">
              <h2>
                <span className="step step-leaf">3</span> Quest graph <small>click to jump · arrows = requires</small>
              </h2>
              <QuestGraph doc={doc} deps={compiled?.deps ?? []} state={sim?.state ?? null} selected={selected} onSelect={setSelected} onPick={(line) => setJump({ line, nonce: Date.now() })} />
              <div className="qstatus">
                {doc?.quests.map((q) => {
                  const st = sim?.state.quests[q.id]?.status ?? "locked";
                  const giver = q.giver ? dialogue && doc ? doc.dialogues[0]?.cast[q.giver] : undefined : undefined;
                  return (
                    <button key={q.id} type="button" className={`qchip qs-${st}${selected === q.id ? " is-sel" : ""}`} onClick={() => setSelected(q.id)}>
                      {giver?.portrait && <img src={portraitUrl(giver.portrait)} alt="" width={24} height={24} />}
                      <span>{q.title}</span>
                      <small>{STATUS_TH[st]}</small>
                    </button>
                  );
                })}
              </div>
            </section>
          <div className="row-2">
            <section className="panel panel-state">
              <h2>
                <span className="step step-leaf">◆</span> State
              </h2>
              <table className="vars">
                <tbody>
                  {Object.entries(sim?.state.vars ?? {}).map(([k, v]) => (
                    <tr key={k}>
                      <th className="mono">{doc?.flags[k]?.label ? `${k} · ${doc.flags[k].label}` : k}</th>
                      <td className="mono">{String(v)}</td>
                    </tr>
                  ))}
                  {Object.entries(sim?.state.items ?? {})
                    .filter(([, n]) => n > 0)
                    .map(([k, n]) => (
                      <tr key={`i-${k}`} className="row-item">
                        <th className="mono">🎒 {doc?.items[k]?.name ?? k}</th>
                        <td className="mono">×{n}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <ol className="log">
                {sim?.log.map((l, i) => (
                  <li key={i} className={/^@|event/.test(l) ? "log-event" : /complete|start/.test(l) ? "log-choice" : ""}>
                    {l}
                  </li>
                ))}
              </ol>
              {sim?.warnings.map((w) => (
                <p key={w} className="hint err">
                  {w}
                </p>
              ))}
            </section>
          </div>

          <div className="row-2">
            <section className="panel panel-export">
              <h2>
                <span className="step">4</span> Export
              </h2>
              <div className="export-grid">
                {PRESETS.map((p) => (
                  <button key={p.id} type="button" className={p.id === "all" ? "primary" : ""} disabled={!!busy || !id} onClick={() => void onExport(p.id)}>
                    <span>{busy === `export-${p.id}` ? "Exporting…" : p.label}</span>
                    <small>{p.hint}</small>
                  </button>
                ))}
              </div>
              {exportRes && (
                <ul className="export-list">
                  {exportRes.dirs.map((d) => (
                    <li key={d} className="mono">
                      {d}
                    </li>
                  ))}
                  {exportRes.warnings.map((w) => (
                    <li key={w} className="hint err">
                      {w}
                    </li>
                  ))}
                </ul>
              )}
              <p className="hint">The demo auto-plays the picks from your first “play” input.</p>
            </section>
            <section className="panel panel-portraits">
              <h2>
                <span className="step">↔</span> Easy Dialogue contract
              </h2>
              {dialogue ? (
                <div className="contract">
                  <p className="hint">
                    <b>{dialogue.id}.ezd</b> {dialogue.found ? "" : "— not found in dialogues/"}
                  </p>
                  <p className="field-label">Events it fires (step triggers)</p>
                  <div className="chips">{[...new Set(dialogue.events.map((e) => [e.name, ...e.args].join(" ")))].map((e) => <code key={e}>@{e}</code>)}<code>end {dialogue.id}</code></div>
                  <p className="field-label">Vars it writes (shared with quest flags)</p>
                  <div className="chips">{Object.keys(dialogue.vars).map((v) => <code key={v}>{v}</code>)}</div>
                </div>
              ) : (
                <p className="hint">Add <code>@dialogue id</code> to link an .ezd script from dialogues/.</p>
              )}
            </section>
          </div>
        </div>
      </main>
      <footer className={`statusbar ${status.kind}`}>{status.text || `Workspace ${ws?.root ?? ""}`}</footer>
    </div>
  );
}
