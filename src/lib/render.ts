import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createCanvas, loadImage, type Canvas, type Image } from "@napi-rs/canvas";
import { boxFrame, plateFrame, wellFrame, type Pixels } from "../shared/frames.js";
import { itemIcon, stateIcon } from "../shared/icons.js";
import type { QuestState } from "../shared/manager.js";
import { buildLogView, drawQuestLog, VIEW, type Ctx } from "../shared/questlog.js";
import type { BoxStyle, QuestDoc } from "../shared/types.js";
import { registerFonts } from "./assets.js";
import { backgroundFile, portraitFile } from "./workspace.js";

/** PNG of the quest log (Skia + Kanit) at an integer pixel scale; pixel art nearest-neighbour, text at full resolution. */

export interface QuestLogRenderOptions {
  state: QuestState;
  selected?: string;
  scale?: number;
  style?: BoxStyle;
  background?: string | null;
  showLocked?: boolean;
  caption?: string;
}

export function pixelsCanvas(p: Pixels): Canvas {
  const c = createCanvas(p.width, p.height);
  const g = c.getContext("2d");
  const id = g.createImageData(p.width, p.height);
  id.data.set(p.data);
  g.putImageData(id, 0, 0);
  return c;
}

const imgCache = new Map<string, Promise<Image | null>>();
function loadCached(file: string | null): Promise<Image | null> {
  if (!file) return Promise.resolve(null);
  let p = imgCache.get(file);
  if (!p) {
    p = existsSync(file) ? readFile(file).then((b) => loadImage(b)).catch(() => null) : Promise.resolve(null);
    imgCache.set(file, p);
  }
  return p;
}

export async function renderQuestLog(root: string, doc: QuestDoc, opts: QuestLogRenderOptions): Promise<Buffer> {
  registerFonts();
  const S = Math.max(1, Math.min(6, Math.round(opts.scale ?? 3)));
  const style = opts.style ?? "teak";
  const canvas = createCanvas(VIEW.width * S, VIEW.height * S);
  const g = canvas.getContext("2d");
  const view = buildLogView(doc, opts.state, { selected: opts.selected, showLocked: opts.showLocked });
  const portraits = new Map<string, Image | null>();
  for (const q of view.quests) if (q.giver?.portrait) portraits.set(q.giver.portrait, await loadCached(portraitFile(root, q.giver.portrait)));
  const bg = opts.background === null ? null : await loadCached(backgroundFile(root, opts.background ?? "thai_village_topdown"));
  const icons = new Map<string, Canvas>();
  const iconOf = (key: string, make: () => Pixels) => {
    let c = icons.get(key);
    if (!c) {
      c = pixelsCanvas(make());
      icons.set(key, c);
    }
    return c;
  };
  drawQuestLog(
    g as unknown as Ctx,
    {
      background: bg,
      box: pixelsCanvas(boxFrame(style)),
      plate: pixelsCanvas(plateFrame(style)),
      well: pixelsCanvas(wellFrame(style)),
      icon: (n) => iconOf(`i:${n}`, () => itemIcon(n)),
      state: (n) => iconOf(`s:${n}`, () => stateIcon(n)),
      portrait: (p) => (p ? (portraits.get(p) ?? null) : null),
    },
    view,
    { scale: S, style, caption: opts.caption },
  );
  return canvas.toBuffer("image/png");
}
