/**
 * Optional Godot parity check: GODOT=/path/to/godot npx vitest run test/godot.test.ts
 * Exports the demo, imports it headless and compares the GDScript QuestManager log + state with the JS one.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportQuests } from "../src/lib/export.js";
import { parseInputs, runSimulation } from "../src/lib/sim.js";
import { compileById } from "../src/lib/workspace.js";
import { tempWorkspace } from "./helpers.js";

const GODOT = process.env.GODOT;
let root: string;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  if (GODOT) ({ root, cleanup } = await tempWorkspace());
});
afterAll(() => cleanup?.());

describe.skipIf(!GODOT)("Godot export parity", () => {
  it.each([[[0, 0]], [[1, 1]], [[2]]])("picks %j: GDScript QuestManager matches the JS manager", async (picks) => {
    const out = path.join(root, "exports", `godot-${picks.join("-")}`);
    await exportQuests(root, { id: "village_delivery", preset: "godot", out });
    // Godot 4.3 has no --import flag; one editor pass imports the assets.
    spawnSync(GODOT!, ["--headless", "--editor", "--quit", "--path", out], { encoding: "utf8", timeout: 180_000 });
    const run = spawnSync(GODOT!, ["--headless", "--path", out, "--script", "res://test_quests.gd", "--", `picks=${picks.join(",")}`], { encoding: "utf8", timeout: 120_000 });
    expect(run.stdout).toMatch(/^OK$/m);
    const gd = run.stdout.split("\n").filter((l) => l.startsWith("LOG| ")).map((l) => l.slice(5));
    const doc = await compileById(root, "village_delivery");
    const js = await runSimulation(root, doc, parseInputs(`play village_delivery ${picks.join(",")}`).inputs);
    expect(gd).toEqual(js.log);
    const state = JSON.parse(run.stdout.match(/^STATE\| (.*)$/m)![1]!) as { quests: Record<string, { status: string }>; vars: Record<string, unknown> };
    expect(Object.fromEntries(Object.entries(state.quests).map(([k, v]) => [k, v.status]))).toEqual(Object.fromEntries(Object.entries(js.state.quests).map(([k, v]) => [k, v.status])));
    expect(state.vars).toEqual(js.state.vars);
  }, 400_000);
});
