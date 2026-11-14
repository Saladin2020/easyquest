/** Line-based syntax highlighting for .ezq quest files → HTML (escaped). */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const span = (cls: string, s: string) => `<span class="hl-${cls}">${esc(s)}</span>`;

function inline(text: string): string {
  let out = "";
  const re = /(\{[^}]*\})|("[^"]*")|(\b(?:has|count|done|active|failed|available|step|seen)\()/gu;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out += esc(text.slice(last, m.index));
    if (m[1]) out += span("interp", m[1]);
    else if (m[2]) out += span("tag", m[2]);
    else if (m[3]) out += span("kw", m[3]);
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

export function highlightLine(raw: string): string {
  const ci = raw.search(/(?<!:)\/\//);
  const code = ci >= 0 ? raw.slice(0, ci) : raw;
  const comment = ci >= 0 ? span("comment", raw.slice(ci)) : "";
  const indent = /^\s*/.exec(code)![0];
  const t = code.slice(indent.length);
  let body: string;
  let m: RegExpExecArray | null;
  if (!t) body = "";
  else if (/^===/.test(t)) body = span("node", t);
  else if ((m = /^(@\w+)(.*)$/.exec(t))) body = span(indent ? "event" : "header", m[1]!) + inline(m[2] ?? "");
  else if ((m = /^(step|bonus)(\s+[\w-]+)(.*)$/.exec(t))) body = span("choice", m[1]!) + span("speaker", m[2]!) + inline(m[3] ?? "");
  else if ((m = /^(start|fail|done|requires)(\s+(?:on|when))?(.*)$/.exec(t))) body = span("kw", m[1]!) + (m[2] ? span("jump", m[2]) : "") + span("cond", m[3] ?? "");
  else if (/^(on start|on fail|reward)\s*:$/.test(t)) body = span("kw", t);
  else if ((m = /^(giver|summary|hint)(.*)$/.exec(t))) body = span("emotion", m[1]!) + inline(m[2] ?? "");
  else if (/^~/.test(t)) body = span("set", t);
  else if ((m = /^(give|take)(.*)$/.exec(t))) body = span("set", m[1]!) + inline(m[2] ?? "");
  else body = inline(t);
  return esc(indent) + body + comment;
}

export const highlight = (source: string) => source.split("\n").map(highlightLine).join("\n");
