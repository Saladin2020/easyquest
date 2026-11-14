/**
 * README / demo images: npx tsx scripts/render-docs.mts [outDir=docs/assets]
 * Renders from the shipped samples in a throwaway workspace.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { renderQuestLog } from "../src/lib/render.js";
import { parseInputs, runSimulation } from "../src/lib/sim.js";
import { compileById, initWorkspace } from "../src/lib/workspace.js";
import { BOX_STYLES, type BoxStyle } from "../src/shared/types.js";

const out = path.resolve(process.argv[2] ?? "docs/assets");
await mkdir(out, { recursive: true });
const root = await mkdtemp(path.join(os.tmpdir(), "easyquest-docs-"));
await initWorkspace(root);
const doc = await compileById(root, "village_delivery");
const state = async (inputs: string) => (await runSimulation(root, doc, parseInputs(inputs).inputs)).state;

const save = async (name: string, buf: Buffer) => {
  await writeFile(path.join(out, name), buf);
  console.log("wrote", path.join(out, name));
};

const done = await state("play village_delivery 0,0");
const mid = await state("camera market; ~ coins = 5; ~ delivered = 1; camera temple");
const failed = await state("play village_delivery 2");
await save("questlog-completed.png", await renderQuestLog(root, doc, { state: done, selected: "village_delivery", scale: 3 }));
await save("questlog-active.png", await renderQuestLog(root, doc, { state: mid, selected: "village_delivery", scale: 3, style: "lantern" }));
await save("questlog-failed.png", await renderQuestLog(root, doc, { state: failed, selected: "village_delivery", scale: 3, style: "night" }));

// four frame styles, 2×2 at 2x
{
  const S = 2;
  const W = 480 * S;
  const H = 270 * S;
  const c = createCanvas(W * 2 + 8, H * 2 + 8);
  const g = c.getContext("2d");
  g.fillStyle = "#140e0a";
  g.fillRect(0, 0, c.width, c.height);
  const states = [done, mid, failed, await state("play village_delivery 1,1; talk vendor")];
  for (const [i, style] of (BOX_STYLES as BoxStyle[]).entries()) {
    const img = await loadImage(await renderQuestLog(root, doc, { state: states[i]!, scale: S, style }));
    g.drawImage(img, (i % 2) * (W + 8), Math.floor(i / 2) * (H + 8));
  }
  await save("questlog-styles.png", c.toBuffer("image/png"));
}
// multicultural village: Ramadan iftar sharing → Hari Raya questline
{
  const raya = await compileById(root, "ramadan_raya");
  const st = async (inputs: string) => (await runSimulation(root, raya, parseInputs(inputs).inputs)).state;
  const prep = await st("camera market; camera mosque; ~ gave_kurma = true; iftar; camera tadika; raya prep; ~ ketupat = 2");
  await save("questlog-raya-prep.png", await renderQuestLog(root, raya, { state: prep, selected: "raya_prep", scale: 3, style: "paper" }));
  await save("questlog-raya.png", await renderQuestLog(root, raya, { state: await st("play ramadan_raya 0,0,0,0"), selected: "raya_visit", scale: 3, style: "lantern" }));
}
await rm(root, { recursive: true, force: true });
