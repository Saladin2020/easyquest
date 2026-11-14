import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { serveStatic } from "@hono/node-server/serve-static";
import { DEV_UI_ORIGINS, checkRequest } from "../shared/requestGuard.js";
import { questDeps } from "../shared/parser.js";
import type { BoxStyle, Value } from "../shared/types.js";
import { exportQuests, type ExportPreset } from "../lib/export.js";
import { renderQuestLog } from "../lib/render.js";
import { parseInputs, runSimulation } from "../lib/sim.js";
import { FONT_REGULAR, FONT_MEDIUM } from "../lib/assets.js";
import { assertSafeId, backgroundFile, compileSource, dirs, listQuests, portraitFile, readQuest, saveQuest, workspaceSummary } from "../lib/workspace.js";

export interface CreateAppOptions {
  workspaceRoot: string;
  webRoot?: string;
  dev?: boolean;
  host?: string;
  token?: string;
}

const TOKEN_COOKIE = "easyquest_token";
const fail = (e: unknown) => (e instanceof Error ? e.message : String(e));

function tokenPage(): string {
  return `<!doctype html><meta charset="utf-8"><title>Easy Quest</title>
<body style="font-family:system-ui;background:#1a1410;color:#f3e7d3;padding:2rem">
<h1>Easy Quest token required</h1>
<p>Paste the token printed in the terminal that started Easy Quest.</p>
<form method="get"><input name="token" autocomplete="off" style="width:22rem"> <button>Open</button></form>
</body>`;
}

const png = (buf: Buffer) => new Uint8Array(buf);

export function createApp(options: CreateAppOptions): Hono {
  const app = new Hono();
  const { workspaceRoot: root, webRoot, dev, host = "127.0.0.1", token } = options;
  const guard = { bindHost: host, token, extraOrigins: dev ? DEV_UI_ORIGINS : [] };

  app.use("*", async (c, next) => {
    const queryToken = c.req.query("token");
    const provided = c.req.header("x-easyquest-token") ?? queryToken ?? getCookie(c, TOKEN_COOKIE);
    const denied = checkRequest(guard, { method: c.req.method, host: c.req.header("host"), origin: c.req.header("origin"), token: provided });
    if (denied) {
      if (denied.status === 401 && c.req.method === "GET" && !c.req.path.startsWith("/api/")) return c.html(tokenPage(), 401);
      return c.json({ error: denied.error }, denied.status);
    }
    if (token && queryToken) setCookie(c, TOKEN_COOKIE, queryToken, { httpOnly: true, sameSite: "Strict", path: "/", maxAge: 60 * 60 * 24 * 365 });
    await next();
  });

  app.get("/api/health", (c) => c.json({ ok: true, workspaceRoot: root }));
  app.get("/api/workspace", async (c) => c.json(await workspaceSummary(root)));
  app.get("/api/quests", async (c) => c.json({ quests: await listQuests(root) }));

  app.get("/api/quests/:id", async (c) => {
    try {
      const s = await readQuest(root, c.req.param("id"));
      return c.json({ id: s.id, source: s.source, ...s.result, deps: s.result.doc ? questDeps(s.result.doc) : [] });
    } catch (e) {
      return c.json({ error: fail(e) }, 404);
    }
  });

  app.post("/api/quests/:id", async (c) => {
    try {
      const body = (await c.req.json()) as { source: string; force?: boolean };
      const res = await saveQuest(root, assertSafeId(c.req.param("id")), String(body.source ?? ""), { force: body.force });
      return c.json({ saved: res.saved, ...res.result }, res.saved ? 200 : 400);
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });

  app.post("/api/compile", async (c) => {
    const body = (await c.req.json()) as { source: string; id?: string };
    const res = compileSource(root, String(body.source ?? ""), body.id && /^[a-z0-9_-]+$/.test(body.id) ? body.id : "draft");
    return c.json({ ...res, deps: res.doc ? questDeps(res.doc) : [] });
  });

  /** Simulate: { source | id, inputs: "camera market; play village_delivery 0,0" } → log + state. */
  app.post("/api/simulate", async (c) => {
    try {
      const body = (await c.req.json()) as { source?: string; id?: string; inputs?: string; vars?: Record<string, Value> };
      const res = body.source !== undefined ? compileSource(root, body.source, body.id ?? "draft") : (await readQuest(root, assertSafeId(body.id))).result;
      if (!res.doc) return c.json({ errors: res.errors }, 400);
      const sim = await runSimulation(root, res.doc, parseInputs(body.inputs ?? "").inputs, { vars: body.vars });
      return c.json(sim);
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });

  app.post("/api/render", async (c) => {
    try {
      const body = (await c.req.json()) as { source?: string; id?: string; inputs?: string; selected?: string; scale?: number; style?: BoxStyle; background?: string | null; showLocked?: boolean };
      const res = body.source !== undefined ? compileSource(root, body.source, body.id ?? "draft") : (await readQuest(root, assertSafeId(body.id))).result;
      if (!res.doc) return c.json({ errors: res.errors }, 400);
      const sim = await runSimulation(root, res.doc, parseInputs(body.inputs ?? "").inputs);
      const buf = await renderQuestLog(root, res.doc, { state: sim.state, selected: body.selected, scale: body.scale ?? 2, style: body.style, background: body.background, showLocked: body.showLocked });
      return c.body(png(buf), 200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });

  app.get("/api/portraits/:set", async (c) => {
    const f = portraitFile(root, c.req.param("set").replace(/[^a-z0-9_-]/gi, ""));
    if (!f) return c.json({ error: "no portrait" }, 404);
    return c.body(png(await readFile(f)), 200, { "Content-Type": "image/png" });
  });

  app.get("/api/backgrounds/:id", async (c) => {
    try {
      const f = backgroundFile(root, c.req.param("id").replace(/\.png$/, ""));
      if (!f) return c.json({ error: "no background" }, 404);
      return c.body(png(await readFile(f)), 200, { "Content-Type": "image/png" });
    } catch (e) {
      return c.json({ error: fail(e) }, 404);
    }
  });

  app.get("/api/fonts/:file", async (c) => {
    const f = c.req.param("file") === "Kanit-Medium.ttf" ? FONT_MEDIUM : FONT_REGULAR;
    return c.body(new Uint8Array(await readFile(f)), 200, { "Content-Type": "font/ttf", "Cache-Control": "max-age=86400" });
  });

  app.post("/api/export", async (c) => {
    try {
      const body = (await c.req.json()) as { id: string; preset?: ExportPreset; style?: BoxStyle; out?: string; picks?: number[] };
      const res = await exportQuests(root, { id: assertSafeId(body.id), preset: body.preset, style: body.style, out: body.out, picks: body.picks });
      return c.json({ ok: true, ...res, files: res.files.length });
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });

  if (!dev && webRoot) {
    app.use("/*", serveStatic({ root: webRoot }));
    app.get("*", async (c) => {
      try {
        return c.html((await readFile(path.join(webRoot, "index.html"))).toString("utf8"));
      } catch {
        return c.text("Web UI not built yet. Run npm run build:web or start with --dev.", 503);
      }
    });
  } else if (dev) {
    app.get("/", (c) =>
      c.html(`<!doctype html><meta charset="utf-8"><title>Easy Quest (dev)</title>
<body style="font-family:system-ui;background:#1a1410;color:#f3e7d3;padding:2rem">
<h1>Easy Quest API is running</h1><p>Workspace: <code>${root}</code></p>
<p>Open the Vite UI at <a href="http://127.0.0.1:5177" style="color:#f0c36a">http://127.0.0.1:5177</a></p></body>`),
    );
  }
  return app;
}

export function defaultWebRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, "../web/dist"), path.resolve(here, "../../web/dist")];
  return candidates.find((p) => existsSync(path.join(p, "index.html"))) ?? candidates[1]!;
}

export { dirs };
