import type { Pixels } from "./frames.js";

/**
 * CC0 procedural 16×16 item / flag icons and 9×9 quest-state icons, drawn from character grids with an
 * automatic dark outline. Shared by the PNG quest log, the web editor and the Godot / Pixi exports.
 */

type RGBA = [number, number, number, number];
const hx = (h: string): RGBA => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];

const PAL: Record<string, RGBA> = {
  w: hx("#fbf6e9"), W: hx("#d9d0bd"), y: hx("#f6c445"), Y: hx("#ffe58a"), o: hx("#e8892f"), O: hx("#b85d1f"),
  g: hx("#5fb04a"), G: hx("#2f7a36"), l: hx("#a3dc6a"), b: hx("#9a6a3e"), B: hx("#5e3b22"), t: hx("#d7b07a"),
  r: hx("#d94436"), R: hx("#8f2321"), p: hx("#f29bb7"), P: hx("#c45584"), c: hx("#bfe8f2"), C: hx("#5aa7c8"),
  s: hx("#c9ccd4"), S: hx("#8a8f9c"), n: hx("#3f8f6e"), m: hx("#e9e2f5"),
};
const OUTLINE: RGBA = hx("#140e0a");

const ICON_ART: Record<string, string[]> = {
  sticky_rice: [
    "................",
    "........gG......",
    ".......gGGl.....",
    "......wwwgyyy...",
    "....wwwwwWyyyo..",
    "...wwwWwwwyYyyo.",
    "...wwwwwWwyyyyo.",
    "..ssssssssssssss",
    "..sWWWWWWWWWWWWs",
    "...sSSSSSSSSSSs.",
    ".....SSSSSSSS...",
  ],
  morning_glory: [
    "...g.......g....",
    "..gGg.....gGg...",
    ".gGlGg...gGlGg..",
    "..gGGgg.ggGGg...",
    "...ggGgGgGgg....",
    ".....gGgGg......",
    "......gGg.......",
    ".....rRrRr......",
    "......gGg.......",
    "......gGg.......",
    ".....gG.Gg......",
    "....gG...Gg.....",
  ],
  balm: [
    "....yyyyyyyy....",
    "...yYYYYYYYYy...",
    "...yyyyyyyyyy...",
    "...oooooooooo...",
    "...nnnnnnnnnn...",
    "...nyyrrrryyn...",
    "...nyrYYYYryn...",
    "...nyyrrrryyn...",
    "...nnnnnnnnnn...",
    "....GGGGGGGG....",
  ],
  mango: [
    ".........gG.....",
    "........gGl.....",
    "........B.......",
    "......yyyyy.....",
    ".....yYYyyyo....",
    "....yYYyyyyyo...",
    "....yYyyyyyyo...",
    "....yyyyyyyoo...",
    ".....yyyyyooO...",
    "......ooooOO....",
    "........OO......",
  ],
  kanom_chan: [
    "....pppppppp....",
    "...pPPPPPPPPp...",
    "...wwwwwwwwww...",
    "...llllllllll...",
    "...pppppppppp...",
    "...wwwwwwwwww...",
    "...gggggggggg...",
    "...PPPPPPPPPP...",
    "..gGGGGGGGGGGg..",
    ".gGgggggggggGGg.",
  ],
  nam_pan: [
    "..........r.....",
    ".........r......",
    "....ccccrccc....",
    "....cmmmrmmc....",
    "....cppppppPc...",
    "....cpppppppc...",
    ".....cPpppPc....",
    ".....cpppppc....",
    ".....cPpppPc....",
    "......cpppc.....",
    "......ccccc.....",
  ],
  coin: [
    ".....yyyyy......",
    "...yyYYYYYyy....",
    "..yYYyyyyyYYy...",
    "..yYyyOyOyyYo...",
    ".yYyyOOOOOyyyo..",
    ".yYyyyOyOyyyyo..",
    ".yYyyOOOOOyyyo..",
    ".yyyyyOyOyyyyo..",
    "..yyyyyyyyyyo...",
    "..oyyyyyyyyoo...",
    "...ooyyyyoo.....",
    ".....ooooo......",
  ],
  heart: [
    "..rrr...rrr.....",
    ".rpprr.rrrrr....",
    ".rpprrrrrrrR....",
    ".rrrrrrrrrrR....",
    "..rrrrrrrrR.....",
    "...rrrrrrR......",
    "....rrrrR.......",
    ".....rrR........",
    "......R.........",
  ],
  bag: [
    "......BB........",
    ".....btbB.......",
    "......BB........",
    ".....tttt.......",
    "...tttttttb.....",
    "..ttwttttttb....",
    "..tttttttttb....",
    "..tttttttttb....",
    "...ttttttbb.....",
    "....bbbbbb......",
  ],
  scroll: [
    "..ttttttttttt...",
    ".tWwwwwwwwwwWt..",
    "..twwwwwwwwwt...",
    "..twBBBBBBwwt...",
    "..twwwwwwwwwt...",
    "..twBBBBBwwwt...",
    "..twwwwwwwwwt...",
    ".tWwwwwwwwwwWt..",
    "..ttttttttttt...",
  ],
};

export const ICON_NAMES = Object.keys(ICON_ART);

function stamp(art: string[], size: number): Pixels {
  const data = new Uint8ClampedArray(size * size * 4);
  const w = Math.max(...art.map((r) => r.replace(/\.+$/, "").length));
  const h = art.length;
  let minX = size;
  for (const r of art) {
    const i = r.search(/[^. ]/);
    if (i >= 0) minX = Math.min(minX, i);
  }
  const ox = Math.floor((size - (w - minX)) / 2) - minX;
  const oy = Math.floor((size - h) / 2);
  const set = (x: number, y: number, c: RGBA) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    data.set(c, (y * size + x) * 4);
  };
  const filled = (x: number, y: number) => {
    const ch = art[y - oy]?.[x - ox];
    return Boolean(ch && ch !== "." && ch !== " ");
  };
  // outline first
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (filled(x, y)) continue;
      if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) set(x, y, OUTLINE);
    }
  art.forEach((row, y) => [...row].forEach((ch, x) => ch !== "." && ch !== " " && PAL[ch] && set(x + ox, y + oy, PAL[ch]!)));
  return { width: size, height: size, data };
}

const cache = new Map<string, Pixels>();
/** 16×16 icon by name; unknown names fall back to the bag. */
export function itemIcon(name: string | undefined): Pixels {
  const key = name && ICON_ART[name] ? name : "bag";
  let p = cache.get(key);
  if (!p) {
    p = stamp(ICON_ART[key]!, 16);
    cache.set(key, p);
  }
  return p;
}

export function hasIcon(name: string | undefined): boolean {
  return Boolean(name && ICON_ART[name]);
}

const STATE_ART: Record<string, string[]> = {
  available: ["...yy...", "...yy...", "...yy...", "...yy...", "...yy...", "........", "...yy...", "...yy..."],
  active: ["yyyyyy..", "yYYYYy..", "yy..yy..", "yYYYYy..", "yy..yy..", "yYYYYy..", "yyyyyy..", "........"],
  completed: [".......g", "......gg", ".....gg.", "g...gg..", "gg.gg...", ".ggg....", "..g.....", "........"],
  failed: ["r.....r.", "rr...rr.", ".rr.rr..", "..rrr...", ".rr.rr..", "rr...rr.", "r.....r.", "........"],
  locked: ["..SSSS..", ".S....S.", ".S....S.", "ssssssss", "sSSSSSSs", "sSSssSSs", "sSSSSSSs", "ssssssss"],
  current: ["y.......", "yy......", "yYy.....", "yYYy....", "yYy.....", "yy......", "y.......", "........"],
  todo: ["WWWWWWW.", "W.....W.", "W.....W.", "W.....W.", "W.....W.", "W.....W.", "WWWWWWW.", "........"],
  bonus: ["...y....", "...y....", "yyyYyyy.", ".yYYYy..", "..yYy...", ".yy.yy..", "y.....y.", "........"],
};

/** 10×10 state / checkbox icon: available active completed failed locked current todo bonus. */
export function stateIcon(name: string): Pixels {
  const key = `state:${name}`;
  let p = cache.get(key);
  if (!p) {
    p = stamp(STATE_ART[name] ?? STATE_ART.todo!, 10);
    cache.set(key, p);
  }
  return p;
}

export const STATE_ICONS = Object.keys(STATE_ART);
