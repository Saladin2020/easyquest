#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { serve } from "@hono/node-server";
import { Command } from "commander";
import open from "open";
import { createApp, defaultWebRoot } from "./server/app.js";
import { resolveToken } from "./shared/requestGuard.js";
import { eventSignatures, scanCompiled, scanEzd } from "./shared/ezd.js";
import { questDeps, triggerToString } from "./shared/parser.js";
import { buildLogView, LOG_STATUS_TH } from "./shared/questlog.js";
import { BOX_STYLES, type BoxStyle, type CompileResult, type Diagnostic, type QuestDoc } from "./shared/types.js";
import { EXPORT_PRESETS, exportQuests, type ExportPreset } from "./lib/export.js";
import { renderQuestLog } from "./lib/render.js";
import { parseInputs, runSimulation, type SimResult } from "./lib/sim.js";
import { compileSource, dirs, initWorkspace, listQuests, QUEST_EXT, questPath, resolveWorkspace, scanDialogue, workspaceSummary } from "./lib/workspace.js";

const program = new Command();

function workspaceOf(cli?: string): string {
  const v = cli?.trim() || process.env.EASYQUEST_HOME?.trim() || process.env.EASYQUEST_WORKSPACE?.trim() || process.cwd();
  return resolveWorkspace(v);
}

/** A quest argument is either a path to a .ezq file or a quest-file id in the workspace. */
async function loadSource(arg: string, root: string): Promise<{ id: string; file: string; source: string }> {
  if (arg.endsWith(QUEST_EXT) || arg.includes("/") || arg.includes("\\")) {
    const abs = path.resolve(arg);
    if (!existsSync(abs)) throw new Error(`No such file ${arg}`);
    const id = path.basename(abs, QUEST_EXT).toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    return { id, file: abs, source: await readFile(abs, "utf8") };
  }
  const file = questPath(root, arg);
  if (!existsSync(file)) throw new Error(`Quest file "${arg}" not found in ${dirs(root).quests} (try: easyquest list)`);
  return { id: arg, file, source: await readFile(file, "utf8") };
}

function printDiagnostics(file: string, res: CompileResult) {
  const show = (d: Diagnostic) => console.error(`${file}:${d.line}${d.col ? `:${d.col}` : ""} ${d.severity}: ${d.message}`);
  res.errors.forEach(show);
  res.warnings.forEach(show);
}

async function compileArg(arg: string, root: string): Promise<{ id: string; file: string; doc: QuestDoc; res: CompileResult }> {
  const { id, file, source } = await loadSource(arg, root);
  const res = compileSource(root, source, id, path.relative(process.cwd(), file));
  if (!res.doc) {
    printDiagnostics(path.relative(process.cwd(), file), res);
    process.exit(1);
  }
  return { id, file, doc: res.doc, res };
}

const fail = (e: unknown) => {
  console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
};

async function inputsFrom(o: { events?: string; file?: string; stdin?: boolean; picks?: string; dialogue?: string }, doc: QuestDoc): Promise<string> {
  const parts: string[] = [];
  if (o.file) parts.push(await readFile(o.file, "utf8"));
  if (o.stdin) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    parts.push(Buffer.concat(chunks).toString("utf8"));
  }
  if (o.events) parts.push(o.events);
  if (o.picks !== undefined || (!parts.length && doc.dialogues.length)) {
    const d = o.dialogue ?? doc.dialogues[0]?.id;
    if (!d) throw new Error("--picks needs a linked dialogue (@dialogue) or --dialogue <id>");
    parts.unshift(`play ${d} ${o.picks ?? "0"}`);
  }
  return parts.join("\n");
}

function printSim(doc: QuestDoc, sim: SimResult, o: { transcript?: boolean }) {
  for (const w of sim.warnings) console.error(`warning: ${w}`);
  if (o.transcript) sim.transcript.forEach((l) => console.log(`  │ ${l}`));
  for (const l of sim.log) console.log(l);
  console.log("");
  const view = buildLogView(doc, sim.state, { showLocked: true });
  for (const q of doc.quests) {
    const v = view.quests.find((x) => x.id === q.id)!;
    console.log(`${v.status.padEnd(9)} ${q.id} · ${v.title} (${v.progress}) — ${LOG_STATUS_TH[v.status]}`);
    for (const s of v.steps) console.log(`    ${s.state === "done" ? "[x]" : s.state === "current" ? "[>]" : s.state === "failed" ? "[!]" : "[ ]"} ${s.optional ? "(bonus) " : ""}${s.id} · ${s.title}`);
  }
  console.log(`vars ${JSON.stringify(sim.state.vars)}`);
  console.log(`items ${JSON.stringify(sim.state.items)}`);
}

program.name("easyquest").description("Write game quests as text, check them against Easy Dialogue scripts, simulate, render and export for Godot / PixiJS").version("0.1.0");

program
  .command("init")
  .description("Create quests/ dialogues/ portraits/ backgrounds/ exports/ with the village_delivery demo")
  .option("--force", "Overwrite samples")
  .option("--workspace <path>", "Workspace directory")
  .action(async (o: { force?: boolean; workspace?: string }) => {
    const root = await initWorkspace(workspaceOf(o.workspace), { force: o.force });
    console.log(`Initialized Easy Quest workspace at ${root}`);
    console.log("  quests/       .ezq quest files (village_delivery.ezq, ramadan_raya.ezq demos)");
    console.log("  dialogues/    linked Easy Dialogue scripts (.ezd + compiled .dialogue.json)");
    console.log("  portraits/    quest-giver portraits (Easy Dialogue portrait sets)");
    console.log("  backgrounds/  quest-log backgrounds (Easy Tilemap thai_village_topdown)");
    console.log("  exports/      Godot / PixiJS / JSON exports");
  });

program
  .command("info")
  .description("Workspace summary")
  .option("--json")
  .option("--workspace <path>")
  .action(async (o: { json?: boolean; workspace?: string }) => {
    const s = await workspaceSummary(workspaceOf(o.workspace));
    if (o.json) return console.log(JSON.stringify(s, null, 2));
    console.log(`Easy Quest workspace ${s.root}`);
    console.log(`  quests     ${s.quests.map((q) => q.id).join(", ") || "(none)"}`);
    console.log(`  dialogues  ${s.dialogues.map((d) => `${d.id}${d.json ? "" : " (no compiled json)"}`).join(", ") || "(none)"}`);
    console.log(`  backgrounds ${s.backgrounds.join(", ") || "(none)"}`);
  });

program
  .command("list")
  .description("List quest files")
  .option("--json")
  .option("--workspace <path>")
  .action(async (o: { json?: boolean; workspace?: string }) => {
    const qs = await listQuests(workspaceOf(o.workspace));
    if (o.json) return console.log(JSON.stringify(qs, null, 2));
    for (const q of qs) console.log(`${q.id.padEnd(24)} ${q.quests} quests · ${q.steps} steps · ${q.errors ? `${q.errors} errors` : "ok"}${q.warnings ? ` · ${q.warnings} warnings` : ""}  ${q.title}`);
  });

program
  .command("check")
  .description("Validate a quest file (and its links to Easy Dialogue); exit 1 on errors")
  .argument("<quests>", "Quest-file id or path to a .ezq")
  .option("--strict", "Warnings fail too")
  .option("--json")
  .option("--workspace <path>")
  .action(async (arg: string, o: { strict?: boolean; json?: boolean; workspace?: string }) => {
    try {
      const root = workspaceOf(o.workspace);
      const { id, file, source } = await loadSource(arg, root);
      const res = compileSource(root, source, id, path.relative(process.cwd(), file));
      if (o.json) console.log(JSON.stringify({ id, errors: res.errors, warnings: res.warnings, quests: res.doc?.quests.map((q) => ({ id: q.id, steps: q.steps.length })) ?? [] }, null, 2));
      else {
        printDiagnostics(path.relative(process.cwd(), file), res);
        if (res.doc) {
          const steps = res.doc.quests.reduce((n, q) => n + q.steps.length, 0);
          console.log(`ok  ${res.doc.quests.length} quests · ${steps} steps · ${Object.keys(res.doc.items).length} items · ${Object.keys(res.doc.flags).length} flags · dialogues: ${res.doc.dialogues.map((d) => d.id + (d.found ? "" : " (missing)")).join(", ") || "none"}${res.warnings.length ? ` · ${res.warnings.length} warnings` : ""}`);
          for (const d of questDeps(res.doc)) console.log(`    requires  ${d.to} ← ${d.from}`);
        }
      }
      if (res.errors.length || (o.strict && res.warnings.length)) process.exit(1);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("play")
  .description("Simulate: play the linked dialogue with --picks, or feed --events / --file / --stdin (camera temple; ~ coins = 10; give mango; play <dialogue> 0,1)")
  .argument("<quests>")
  .option("--picks <list>", "Play the linked dialogue with these choice positions, e.g. 0,0")
  .option("--dialogue <id>", "Which linked dialogue --picks plays")
  .option("--events <list>", 'Inputs separated by ";", e.g. "camera market; ~ coins = 10; camera temple"')
  .option("--file <path>", "Inputs file (one per line)")
  .option("--stdin", "Read inputs from stdin (e.g. easydialogue play … --vars output)")
  .option("--transcript", "Print the dialogue transcript too")
  .option("--json")
  .option("--workspace <path>")
  .action(async (arg: string, o: { picks?: string; dialogue?: string; events?: string; file?: string; stdin?: boolean; transcript?: boolean; json?: boolean; workspace?: string }) => {
    try {
      const root = workspaceOf(o.workspace);
      const { doc } = await compileArg(arg, root);
      const text = await inputsFrom(o, doc);
      const sim = await runSimulation(root, doc, parseInputs(text).inputs);
      if (o.json) console.log(JSON.stringify(sim, null, 2));
      else printSim(doc, sim, o);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("render")
  .description("Quest-log PNG after a simulation (480×270 × --scale)")
  .argument("<quests>")
  .option("--picks <list>")
  .option("--dialogue <id>")
  .option("--events <list>")
  .option("--file <path>")
  .option("--quest <id>", "Selected quest in the log")
  .option("--style <style>", `Frame style: ${BOX_STYLES.join(" | ")}`, "teak")
  .option("--background <id>", "backgrounds/<id>.png, or none", "thai_village_topdown")
  .option("--locked", "Show locked quests too")
  .option("--scale <n>", "Pixel scale", "3")
  .option("--out <file>", "Output PNG", "questlog.png")
  .option("--workspace <path>")
  .action(async (arg: string, o: { picks?: string; dialogue?: string; events?: string; file?: string; quest?: string; style: string; background: string; locked?: boolean; scale: string; out: string; workspace?: string }) => {
    try {
      const root = workspaceOf(o.workspace);
      const { doc } = await compileArg(arg, root);
      if (!BOX_STYLES.includes(o.style as BoxStyle)) throw new Error(`Unknown style "${o.style}" — use ${BOX_STYLES.join(", ")}`);
      const sim = await runSimulation(root, doc, parseInputs(await inputsFrom(o, doc)).inputs);
      sim.warnings.forEach((w) => console.error(`warning: ${w}`));
      const buf = await renderQuestLog(root, doc, { state: sim.state, selected: o.quest, scale: Number(o.scale), style: o.style as BoxStyle, background: o.background === "none" ? null : o.background, showLocked: o.locked });
      await mkdir(path.dirname(path.resolve(o.out)), { recursive: true });
      await writeFile(o.out, buf);
      console.log(`wrote ${o.out} · ${480 * Number(o.scale)}×${270 * Number(o.scale)}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("export")
  .description(`Export: ${EXPORT_PRESETS.join(" | ")}`)
  .argument("<quests>")
  .option("--preset <preset>", EXPORT_PRESETS.join(" | "), "all")
  .option("--out <dir>", "Output folder (default exports/<id>-<preset>)")
  .option("--style <style>", "Quest-log frame style", "teak")
  .option("--picks <list>", "Picks the demo scene auto-plays", "0,0")
  .option("--json")
  .option("--workspace <path>")
  .action(async (arg: string, o: { preset: string; out?: string; style: string; picks: string; json?: boolean; workspace?: string }) => {
    try {
      const root = workspaceOf(o.workspace);
      if (!EXPORT_PRESETS.includes(o.preset as ExportPreset)) throw new Error(`Unknown preset "${o.preset}" — use ${EXPORT_PRESETS.join(", ")}`);
      const { id } = await loadSource(arg, root);
      const res = await exportQuests(root, { id, preset: o.preset as ExportPreset, out: o.out, style: o.style as BoxStyle, picks: o.picks.split(",").map(Number), trustedPaths: true });
      if (o.json) return console.log(JSON.stringify(res, null, 2));
      res.warnings.forEach((w) => console.error(`warning: ${w}`));
      for (const d of res.dirs) console.log(`exported ${path.relative(process.cwd(), d) || d}`);
      console.log(`  ${res.files.length} files`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("compile")
  .description("Compile to easyquest/1 JSON (stdout or --out)")
  .argument("<quests>")
  .option("--out <file>")
  .option("--workspace <path>")
  .action(async (arg: string, o: { out?: string; workspace?: string }) => {
    try {
      const { doc, res, file } = await compileArg(arg, workspaceOf(o.workspace));
      if (res.warnings.length) printDiagnostics(path.relative(process.cwd(), file), { ...res, errors: [] });
      const json = `${JSON.stringify(doc, null, 2)}\n`;
      if (o.out) {
        await mkdir(path.dirname(path.resolve(o.out)), { recursive: true });
        await writeFile(o.out, json);
        console.error(`wrote ${o.out}`);
      } else process.stdout.write(json);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("dialogue")
  .description("Show what Easy Quest reads from an Easy Dialogue script: cast, variables (= quest flags) and @events (= quest triggers)")
  .argument("<dialogue>", "Dialogue id in dialogues/ or a path to .ezd / .dialogue.json")
  .option("--json")
  .option("--workspace <path>")
  .action(async (arg: string, o: { json?: boolean; workspace?: string }) => {
    try {
      const root = workspaceOf(o.workspace);
      let s;
      if (arg.endsWith(".ezd") || arg.endsWith(".json")) {
        const text = await readFile(arg, "utf8");
        s = arg.endsWith(".json") ? scanCompiled(JSON.parse(text)) : scanEzd(text, path.basename(arg, ".ezd"));
      } else s = scanDialogue(root, arg);
      if (!s) throw new Error(`Dialogue "${arg}" not found in ${dirs(root).dialogues}`);
      if (o.json) return console.log(JSON.stringify(s, null, 2));
      console.log(`${s.id}${s.title ? ` · ${s.title}` : ""}`);
      console.log(`  cast    ${Object.entries(s.cast).map(([k, c]) => `${k} (${c.name}${c.portrait ? `, ${c.portrait}` : ""})`).join(", ")}`);
      console.log(`  vars    ${Object.entries(s.vars).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(", ")}`);
      console.log(`  events  ${eventSignatures(s).join(" · ")}`);
      console.log(`  + end ${s.id} when the dialogue finishes (Easy Quest bridge)`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("triggers")
  .description("List every quest / step trigger (what the game or dialogue must send)")
  .argument("<quests>")
  .option("--workspace <path>")
  .action(async (arg: string, o: { workspace?: string }) => {
    try {
      const { doc } = await compileArg(arg, workspaceOf(o.workspace));
      for (const q of doc.quests) {
        console.log(`${q.id}${q.requiresSrc ? `  requires ${q.requiresSrc}` : ""}`);
        console.log(`  start ${q.start.length ? q.start.map(triggerToString).join(" | ") : "(automatic)"}${q.fail.length ? `   fail ${q.fail.map(triggerToString).join(" | ")}` : ""}`);
        for (const s of q.steps) console.log(`  ${s.optional ? "bonus" : "step "} ${s.id.padEnd(14)} ${s.done.map(triggerToString).join(" | ")}`);
      }
    } catch (e) {
      fail(e);
    }
  });

program
  .command("serve")
  .description("Web editor + API (default http://127.0.0.1:8818)")
  .option("--port <port>", "Port", "8818")
  .option("--host <host>", "Interface (non-loopback requires the printed token)", "127.0.0.1")
  .option("--dev", "API only; use the Vite UI on :5177")
  .option("--open", "Open the browser")
  .option("--workspace <path>")
  .action(async (o: { port: string; host: string; dev?: boolean; open?: boolean; workspace?: string }) => {
    const root = workspaceOf(o.workspace);
    if (!existsSync(dirs(root).quests)) await initWorkspace(root);
    const token = resolveToken(o.host);
    const app = createApp({ workspaceRoot: root, webRoot: defaultWebRoot(), dev: o.dev, host: o.host, token });
    const port = Number(o.port);
    serve({ fetch: app.fetch, port, hostname: o.host }, () => {
      const url = `http://${o.host === "0.0.0.0" ? "127.0.0.1" : o.host}:${port}/`;
      console.log(`Easy Quest ${o.dev ? "API (dev)" : "editor"} → ${url}`);
      console.log(`Workspace ${root}`);
      if (token) console.log(`Token (needed off-loopback): ${url}?token=${token}`);
      if (o.dev) console.log("Run the UI with: npx vite --config web/vite.config.ts");
      if (o.open) void open(o.dev ? "http://127.0.0.1:5177" : url);
    });
  });

program.parseAsync(process.argv).catch(fail);
