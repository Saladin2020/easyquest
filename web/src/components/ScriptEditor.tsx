import { useEffect, useMemo, useRef } from "react";
import type { Diagnostic } from "../../../src/shared/types";
import { highlight } from "../highlight";

interface Props {
  value: string;
  onChange: (v: string) => void;
  diagnostics: Diagnostic[];
  /** Bump `nonce` to move the caret to `line`. */
  jump?: { line: number; nonce: number };
  onCursorLine?: (line: number) => void;
}

const LINE_H = 22;

export function ScriptEditor({ value, onChange, diagnostics, jump, onCursorLine }: Props) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const pre = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const html = useMemo(() => highlight(value) + "\n", [value]);
  const lines = value.split("\n").length;
  const marks = useMemo(() => {
    const m = new Map<number, Diagnostic>();
    for (const d of diagnostics) if (!m.has(d.line) || d.severity === "error") m.set(d.line, d);
    return m;
  }, [diagnostics]);

  const sync = () => {
    if (!ta.current) return;
    const { scrollTop, scrollLeft } = ta.current;
    if (pre.current) {
      pre.current.scrollTop = scrollTop;
      pre.current.scrollLeft = scrollLeft;
    }
    if (gutter.current) gutter.current.scrollTop = scrollTop;
  };

  useEffect(() => {
    if (!jump || !ta.current) return;
    const el = ta.current;
    const src = el.value.split("\n");
    let pos = 0;
    for (let i = 0; i < Math.min(jump.line - 1, src.length); i++) pos += src[i]!.length + 1;
    el.focus();
    el.setSelectionRange(pos, pos + (src[jump.line - 1]?.length ?? 0));
    el.scrollTop = Math.max(0, (jump.line - 6) * LINE_H);
    sync();
  }, [jump]);

  const caretLine = () => {
    const el = ta.current;
    if (!el || !onCursorLine) return;
    onCursorLine(el.value.slice(0, el.selectionStart).split("\n").length);
  };

  return (
    <div className="code" style={{ ["--lh" as string]: `${LINE_H}px` }}>
      <div className="gutter" ref={gutter} aria-hidden>
        {Array.from({ length: lines }, (_, i) => {
          const d = marks.get(i + 1);
          return (
            <div key={i} className={d ? `ln ln-${d.severity}` : "ln"} title={d?.message}>
              {i + 1}
            </div>
          );
        })}
        <div className="ln" />
      </div>
      <div className="code-area">
        <pre ref={pre} className="code-hl" aria-hidden dangerouslySetInnerHTML={{ __html: html }} />
        <textarea
          ref={ta}
          className="code-input"
          value={value}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          wrap="off"
          aria-label="Quest script"
          onChange={(e) => onChange(e.target.value)}
          onScroll={sync}
          onKeyUp={caretLine}
          onClick={caretLine}
          onKeyDown={(e) => {
            if (e.key === "Tab") {
              e.preventDefault();
              const el = e.currentTarget;
              const { selectionStart: s, selectionEnd: t } = el;
              const next = `${el.value.slice(0, s)}    ${el.value.slice(t)}`;
              onChange(next);
              requestAnimationFrame(() => el.setSelectionRange(s + 4, s + 4));
            }
          }}
        />
      </div>
    </div>
  );
}
