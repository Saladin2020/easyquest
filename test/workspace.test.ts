import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportQuests } from "../src/lib/export.js";
import { renderQuestLog } from "../src/lib/render.js";
import { parseInputs, runSimulation } from "../src/lib/sim.js";
import { compileById, listQuests, resolveInside, saveQuest } from "../src/lib/workspace.js";
import { tempWorkspace } from "./helpers.js";

let root: string;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ root, cleanup } = await tempWorkspace());
});
afterAll(() => cleanup());

const pngSize = (b: Buffer) => [b.readUInt32BE(16), b.readUInt32BE(20)];

describe("workspace", () => {
  it("init copies the sample quests and dialogue", async () => {
    const q = await listQuests(root);
    expect(q.find((x) => x.id === "village_delivery")).toMatchObject({ quests: 3, errors: 0, dialogues: ["village_delivery"] });
  });

  it("refuses to save a file with errors unless forced, and stays inside the workspace", async () => {
    const bad = await saveQuest(root, "broken", `=== q "Q"\nstep a "A"\n  done when nope(1)\n`);
    expect(bad.saved).toBe(false);
    expect(bad.result.errors[0]!.line).toBe(3);
    expect(() => resolveInside(root, "../../etc/passwd")).toThrow();
  });

  it("renders the quest log PNG at 480×270 × scale", async () => {
    const doc = await compileById(root, "village_delivery");
    const sim = await runSimulation(root, doc, parseInputs("play village_delivery 0,0").inputs);
    const buf = await renderQuestLog(root, doc, { state: sim.state, scale: 2, selected: "village_delivery" });
    expect(buf.subarray(1, 4).toString()).toBe("PNG");
    expect(pngSize(buf)).toEqual([960, 540]);
    const plain = await renderQuestLog(root, doc, { state: sim.state, scale: 1, background: null, style: "night" });
    expect(pngSize(plain)).toEqual([480, 270]);
  });

  it("exports json, godot and pixi", async () => {
    const res = await exportQuests(root, { id: "village_delivery", preset: "all" });
    const files = res.files.map((f) => f.replace(/\\/g, "/"));
    for (const want of [
      "village_delivery-godot/project.godot",
      "village_delivery-godot/addons/easyquest/quest_manager.gd",
      "village_delivery-godot/addons/easyquest/quest_log.gd",
      "village_delivery-godot/addons/easydialogue/dialogue_runner.gd",
      "village_delivery-godot/test_quests.gd",
      "village_delivery-pixi/index.html",
      "village_delivery-pixi/easyquest-manager.js",
      "village_delivery-pixi/easyquest-log.js",
      "village_delivery-pixi/village_delivery.dialogue.json",
    ])
      expect(files.some((f) => f.endsWith(want))).toBe(true);
    const project = await readFile(res.dirs.find((d) => d.endsWith("-godot"))! + "/project.godot", "utf8");
    expect(project).toMatch(/QuestManager="\*res:\/\/addons\/easyquest\/quest_manager\.gd"/);
    for (const d of res.dirs) await access(d);
    await expect(exportQuests(root, { id: "village_delivery", preset: "json", out: "../../outside" })).rejects.toThrow();
  });

  it("the bundled runtime/pixi/easyquest-log.js is up to date", () => {
    const r = spawnSync(process.execPath, [path.resolve(import.meta.dirname, "../scripts/build-runtime.mjs"), "--check"], { encoding: "utf8" });
    expect(r.status, r.stderr + r.stdout).toBe(0);
  });
});
