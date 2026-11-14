#!/usr/bin/env node
/**
 * Easy Quest MCP server (stdio by default; optional Streamable HTTP).
 *
 *   npx tsx src/mcp/server.ts
 *   npx tsx src/mcp/server.ts --http --port 8819
 *
 * Env: EASYQUEST_WORKSPACE  absolute path to the workspace (default: cwd)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { z } from "zod";
import { checkRequest, resolveToken } from "../shared/requestGuard.js";
import { questDeps, signaturesOf, triggerToString } from "../shared/parser.js";
import { BOX_STYLES, BUILTIN_EVENTS } from "../shared/types.js";
import { EXPORT_PRESETS, exportQuests } from "../lib/export.js";
import { renderQuestLog } from "../lib/render.js";
import { parseInputs, runSimulation } from "../lib/sim.js";
import { compileSource, dirs, listQuests, readQuest, resolveWorkspace, saveQuest, workspaceSummary } from "../lib/workspace.js";

export const MCP_TOOL_NAMES = [
  "workspace_info",
  "list_quests",
  "get_quest",
  "write_quest",
  "simulate_quest",
  "render_quest_log",
  "export_quests",
] as const;

const IdSchema = z.string().regex(/^[a-z0-9_-]+$/, "Use a-z, 0-9, _ or -");

function text(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function err(message: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const SYNTAX_CHEATSHEET = `@title …  @dialogue village_delivery   @flag coins label="ค่าขนม" icon=coin   @item mango "มะม่วง" icon=mango   @event talk
=== quest_id "ชื่อเควสต์"
giver vendor            (cast id from the linked .ezd)
summary ข้อความ {var}
requires done(other_quest) and reputation >= 1
start on camera market        | start when coins >= 5     (no start line = starts once available)
fail on end village_delivery
on start:   give sticky_rice  |  ~ flag = 1  |  @sfx ding        (indented effects)
step id "ชื่อขั้น"          (bonus id "…" = optional)
  done on camera temple   | done when delivered >= 2
  hint ข้อความ
  take sticky_rice
reward:
  ~ reputation += 1
  give kanom_chan
Triggers: "on <event> [args]" = a dialogue @event or a game event (${BUILTIN_EVENTS.join(", ")}; end <dialogue> fires when it finishes).
Conditions: flags/dialogue vars, has(item) count(item) done(q) active(q) failed(q) available(q) step(q, s) seen(event).`;

const SimInputDoc = "Inputs, one per line or ';': 'play village_delivery 0,0' (runs the linked .ezd with picks), 'camera temple' or '@camera temple' (event), 'talk vendor', '~ coins = 5', 'vars {\"coins\":5}', 'give mango', 'take mango 2'.";

function parseArgs(argv: string[]) {
  const out = { http: false, port: 8819, host: "127.0.0.1", workspace: process.env.EASYQUEST_WORKSPACE ?? process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--http") out.http = true;
    else if (a === "--port") out.port = Number(argv[++i] ?? out.port);
    else if (a === "--host") out.host = argv[++i] ?? out.host;
    else if (a === "--workspace") out.workspace = argv[++i] ?? out.workspace;
  }
  return out;
}

export function createEasyQuestMcp(workspaceRoot: string): McpServer {
  const root = resolveWorkspace(workspaceRoot);
  const server = new McpServer({ name: "easyquest", version: "0.1.0" });

  server.registerTool(
    "workspace_info",
    {
      title: "Workspace info",
      description: "Summarize the Easy Quest workspace (quest files, linked Easy Dialogue scripts with their events/vars, backgrounds, export presets) and the .ezq syntax. Call this first.",
      inputSchema: {},
    },
    async () => {
      const s = await workspaceSummary(root);
      return text({ name: "easyquest", ...s, boxStyles: BOX_STYLES, builtinEvents: BUILTIN_EVENTS, exportPresets: EXPORT_PRESETS, syntax: SYNTAX_CHEATSHEET });
    },
  );

  server.registerTool(
    "list_quests",
    { title: "List quest files", description: "List .ezq files with quest/step counts, linked dialogues and error/warning counts.", inputSchema: {} },
    async () => text({ quests: await listQuests(root) }),
  );

  server.registerTool(
    "get_quest",
    {
      title: "Get quest file",
      description: "Read a .ezq file: source, line-numbered errors/warnings, quests with steps/triggers, prerequisite edges, flags, items and the Easy Dialogue contract (events the dialogue fires, vars it writes).",
      inputSchema: { id: IdSchema, includeSource: z.boolean().optional().describe("Default true") },
    },
    async ({ id, includeSource }) => {
      try {
        const s = await readQuest(root, id);
        const doc = s.result.doc;
        return text({
          id,
          ...(includeSource === false ? {} : { source: s.source }),
          errors: s.result.errors,
          warnings: s.result.warnings,
          ...(doc
            ? {
                title: doc.title,
                flags: doc.flags,
                items: doc.items,
                dialogues: doc.dialogues,
                triggers: signaturesOf(doc),
                requires: questDeps(doc),
                quests: doc.quests.map((q) => ({
                  id: q.id,
                  title: q.title,
                  giver: q.giver,
                  requires: q.requiresSrc,
                  start: q.start.map(triggerToString),
                  fail: q.fail.map(triggerToString),
                  steps: q.steps.map((st) => ({ id: st.id, title: st.title, optional: st.optional, done: st.done.map(triggerToString), line: st.line })),
                  line: q.line,
                })),
              }
            : {}),
        });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "write_quest",
    {
      title: "Write quest file",
      description: `Validate and save a .ezq file (quests/<id>.ezq). Refuses to save with errors unless force; dryRun only validates. Syntax:\n${SYNTAX_CHEATSHEET}`,
      inputSchema: { id: IdSchema, source: z.string().min(1).describe("Full .ezq text (UTF-8, Thai welcome)"), dryRun: z.boolean().optional(), force: z.boolean().optional() },
    },
    async ({ id, source, dryRun, force }) => {
      try {
        const res = await saveQuest(root, id, source, { dryRun, force });
        return text({ saved: res.saved, file: res.file, errors: res.result.errors, warnings: res.result.warnings, quests: res.result.doc?.quests.map((q) => q.id) ?? [] });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "simulate_quest",
    {
      title: "Simulate quests",
      description: `Play a quest file against inputs and return the event log, final quest states, vars, items and the dialogue transcript. ${SimInputDoc}`,
      inputSchema: {
        id: IdSchema,
        inputs: z.string().describe("e.g. 'play village_delivery 0,0'"),
        source: z.string().optional().describe("Unsaved .ezq text to simulate instead of the saved file"),
      },
    },
    async ({ id, inputs, source }) => {
      try {
        const res = source !== undefined ? compileSource(root, source, id) : (await readQuest(root, id)).result;
        if (!res.doc) return err(`Quest file has errors:\n${res.errors.map((e) => `line ${e.line}: ${e.message}`).join("\n")}`);
        const parsed = parseInputs(inputs);
        const sim = await runSimulation(root, res.doc, parsed.inputs);
        return text({ log: sim.log, quests: sim.state.quests, vars: sim.state.vars, items: sim.state.items, transcript: sim.transcript, warnings: sim.warnings, ignoredInputs: parsed.ignored });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "render_quest_log",
    {
      title: "Render quest log",
      description: "Render the in-game quest log (Thai, Kanit, 480×270 × scale) after simulating inputs, save it under exports/previews/ and return it as an image.",
      inputSchema: {
        id: IdSchema,
        inputs: z.string().optional().describe(SimInputDoc),
        selected: z.string().optional().describe("Quest id to show in the detail pane"),
        style: z.enum(BOX_STYLES).optional(),
        background: z.string().optional().describe("Background id from backgrounds/, or 'none'"),
        scale: z.number().int().min(1).max(4).optional().describe("Default 2"),
        showLocked: z.boolean().optional(),
      },
    },
    async ({ id, inputs, selected, style, background, scale, showLocked }) => {
      try {
        const res = (await readQuest(root, id)).result;
        if (!res.doc) return err(`Quest file has errors:\n${res.errors.map((e) => `line ${e.line}: ${e.message}`).join("\n")}`);
        const sim = await runSimulation(root, res.doc, parseInputs(inputs ?? "").inputs);
        const buf = await renderQuestLog(root, res.doc, { state: sim.state, selected, style, scale: scale ?? 2, background: background === "none" ? null : background, showLocked });
        const out = path.join(dirs(root).exports, "previews", `${id}-log${selected ? `-${selected}` : ""}.png`);
        await mkdir(path.dirname(out), { recursive: true });
        await writeFile(out, buf);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ file: out, quests: Object.fromEntries(Object.entries(sim.state.quests).map(([k, v]) => [k, v.status])) }, null, 2) },
            { type: "image" as const, data: buf.toString("base64"), mimeType: "image/png" },
          ],
        };
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "export_quests",
    {
      title: "Export quests",
      description: "Export to json (compiled easyquest/1), godot (Godot 4.3+ project: QuestManager autoload + QuestLog control + Easy Dialogue runner + demo), pixi (PixiJS v8 QuestManager + quest-log view + demo) or all.",
      inputSchema: {
        id: IdSchema,
        preset: z.enum(EXPORT_PRESETS).optional().describe("Default all"),
        style: z.enum(BOX_STYLES).optional(),
        picks: z.array(z.number().int().min(0)).optional().describe("Choices the demo auto-plays (default 0,0)"),
        out: z.string().optional().describe("Workspace-relative output folder"),
      },
    },
    async ({ id, preset, style, picks, out }) => {
      try {
        const res = await exportQuests(root, { id, preset, style, picks, out });
        return text({ dirs: res.dirs, files: res.files.length, warnings: res.warnings });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  return server;
}

async function startMcp(opts: ReturnType<typeof parseArgs>) {
  const workspace = resolveWorkspace(opts.workspace);
  if (opts.http) return startHttp(workspace, opts.host, opts.port);
  await createEasyQuestMcp(workspace).connect(new StdioServerTransport());
}

async function startHttp(workspace: string, host: string, port: number) {
  const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const sessions = new Map<string, InstanceType<typeof StreamableHTTPServerTransport>>();
  const token = resolveToken(host);
  if (token) console.error(`Non-loopback host: send "Authorization: Bearer <token>" — token printed once: ${token}`);
  const httpServer = createServer(async (req, res) => {
    const auth = req.headers.authorization;
    const denied = checkRequest(
      { bindHost: host, token },
      { method: req.method ?? "GET", host: req.headers.host, origin: req.headers.origin, token: auth?.startsWith("Bearer ") ? auth.slice(7) : (req.headers["x-easyquest-token"] as string | undefined) },
    );
    if (denied) {
      res.writeHead(denied.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: denied.error }));
      return;
    }
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    if (url.pathname !== "/mcp") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ name: "easyquest", transport: "streamable-http", endpoint: `http://${host}:${port}/mcp`, workspace }));
      return;
    }
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    try {
      if (req.method === "POST") {
        let transport = sessionId ? sessions.get(sessionId) : undefined;
        if (!transport) {
          const mcp = createEasyQuestMcp(workspace);
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            onsessioninitialized: (id: string) => {
              sessions.set(id, transport!);
            },
          });
          transport.onclose = () => {
            const id = transport!.sessionId;
            if (id) sessions.delete(id);
          };
          await mcp.connect(transport);
        }
        await transport.handleRequest(req, res);
        return;
      }
      if (req.method === "GET" || req.method === "DELETE") {
        const transport = sessionId ? sessions.get(sessionId) : undefined;
        if (!transport) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid or missing mcp-session-id" }));
          return;
        }
        await transport.handleRequest(req, res);
        return;
      }
      res.writeHead(405).end();
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: msg(e) }));
      }
    }
  });
  httpServer.listen(port, host, () => {
    console.error(`Easy Quest MCP (HTTP) http://${host}:${port}/mcp`);
    console.error(`Workspace ${workspace}`);
  });
}

function entryIndex(): number {
  return process.argv.findIndex((arg) => /(?:^|[/\\])mcp[/\\]server\.(?:ts|js|mjs)$/i.test(arg));
}

if (entryIndex() >= 0) {
  await startMcp(parseArgs(process.argv.slice(entryIndex() + 1)));
}
