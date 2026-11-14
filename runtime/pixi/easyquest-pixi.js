// Easy Quest for PixiJS v8 — a quest-log view (same drawing as the PNG / editor quest log) and a tiny dialogue strip.
//
//   import { QuestManager } from "./easyquest-manager.js";
//   import { QuestLogView } from "./easyquest-pixi.js";
//   const manager = new QuestManager(await (await fetch("./village_delivery.quests.json")).json());
//   const log = await QuestLogView.create(PIXI, { scale: 3, base: "./" });
//   log.attach(manager);              // redraws on every manager signal
//   app.stage.addChild(log.view);
//   manager.emit("talk", ["vendor"]); // game events; Easy Dialogue: bridgeDialogue(manager, runner, id)
//
// MIT License. https://github.com/Saladin2020/easyquest

import { boxFrame, buildLogView, drawQuestLog, itemIcon, plateFrame, stateIcon, wellFrame, VIEW } from "./easyquest-log.js";

function pixelsCanvas(p) {
  const c = document.createElement("canvas");
  c.width = p.width;
  c.height = p.height;
  const g = c.getContext("2d");
  const id = g.createImageData(p.width, p.height);
  id.data.set(p.data);
  g.putImageData(id, 0, 0);
  return c;
}

function loadImage(url) {
  return new Promise((resolve) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => resolve(null);
    i.src = url;
  });
}

export class QuestLogView {
  /** @param {{ scale?: number, style?: string, base?: string, background?: string | null }} [opts] */
  static async create(PIXI, opts = {}) {
    const base = opts.base ?? "./";
    const bg = opts.background === null ? null : await loadImage(opts.background ?? `${base}background.png`);
    return new QuestLogView(PIXI, { ...opts, base }, bg);
  }

  constructor(PIXI, opts, background) {
    this.PIXI = PIXI;
    this.scale = opts.scale ?? 3;
    this.style = opts.style ?? "teak";
    this.base = opts.base ?? "./";
    this.canvas = document.createElement("canvas");
    this.canvas.width = VIEW.width * this.scale;
    this.canvas.height = VIEW.height * this.scale;
    this.ctx = this.canvas.getContext("2d");
    this.texture = PIXI.Texture.from(this.canvas);
    this.texture.source.scaleMode = "nearest";
    this.view = new PIXI.Sprite(this.texture);
    this.selected = null;
    this.manager = null;
    this.portraits = new Map();
    this.iconCache = new Map();
    this.assets = {
      background,
      box: pixelsCanvas(boxFrame(this.style)),
      plate: pixelsCanvas(plateFrame(this.style)),
      well: pixelsCanvas(wellFrame(this.style)),
      icon: (n) => this._icon(`i:${n}`, () => itemIcon(n)),
      state: (n) => this._icon(`s:${n}`, () => stateIcon(n)),
      portrait: (set) => this._portrait(set),
    };
    this._queued = false;
  }

  _icon(key, make) {
    let c = this.iconCache.get(key);
    if (!c) {
      c = pixelsCanvas(make());
      this.iconCache.set(key, c);
    }
    return c;
  }

  _portrait(set) {
    if (!set) return null;
    if (!this.portraits.has(set)) {
      this.portraits.set(set, null);
      loadImage(`${this.base}portraits/${set}/neutral.png`).then((img) => {
        this.portraits.set(set, img);
        if (img) this.redraw();
      });
    }
    return this.portraits.get(set);
  }

  /** Follow a QuestManager: redraw on any of its signals (batched per animation frame). */
  attach(manager) {
    this.detach?.();
    this.manager = manager;
    this.detach = manager.on(() => this.requestRedraw());
    this.redraw();
    return this;
  }

  requestRedraw() {
    if (this._queued) return;
    this._queued = true;
    requestAnimationFrame(() => {
      this._queued = false;
      this.redraw();
    });
  }

  /** Select the next / previous visible quest. */
  cycle(dir = 1) {
    const ids = (this.lastView?.quests ?? []).map((q) => q.id);
    if (!ids.length) return;
    const i = ids.indexOf(this.lastView.selected);
    this.selected = ids[(i + dir + ids.length) % ids.length];
    this.redraw();
  }

  redraw() {
    if (!this.manager) return;
    const view = buildLogView(this.manager.doc, this.manager.state(), { selected: this.selected ?? undefined });
    this.lastView = view;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.hit = drawQuestLog(this.ctx, this.assets, view, { scale: this.scale, style: this.style });
    this.texture.source.update();
  }
}

/** One-line dialogue strip under the log (the full Easy Dialogue box lives in easydialogue-pixi.js). */
export class DialogueStrip {
  constructor(PIXI, opts = {}) {
    const S = opts.scale ?? 3;
    this.view = new PIXI.Container();
    this.view.y = opts.y ?? 0;
    const bg = new PIXI.Graphics().rect(0, 0, VIEW.width * S, opts.height ?? 30 * S).fill({ color: 0x140e0a }).rect(0, 0, VIEW.width * S, S).fill({ color: 0x7a5230 });
    this.text = new PIXI.Text({ text: "", style: { fontFamily: "Kanit", fontSize: 9 * S, fill: "#f3e7d3", wordWrap: true, wordWrapWidth: (VIEW.width - 20) * S, breakWords: true } });
    this.text.x = 10 * S;
    this.text.y = 6 * S;
    this.view.addChild(bg, this.text);
  }

  say(text, color) {
    this.text.text = text;
    this.text.style.fill = color ?? "#f3e7d3";
  }
}
