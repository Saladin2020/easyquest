import type { BoxStyle } from "./types.js";

/**
 * CC0 procedural 9-slice pixel frames (shared with Easy Dialogue, same palettes). Pure functions returning RGBA arrays so the web editor
 * (canvas → data URL), the CLI previews and the exports all share identical pixels.
 */

export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type RGBA = [number, number, number, number];

function hx(h: string, a = 255): RGBA {
  const s = h.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16), a];
}

export interface Palette {
  outline: RGBA;
  hi: RGBA;
  base: RGBA;
  base2: RGBA;
  shadow: RGBA;
  inner: RGBA;
  fill: RGBA;
  fill2: RGBA;
  ornament: RGBA;
  ornamentHi: RGBA;
  plate: RGBA;
  plateHi: RGBA;
  plateLo: RGBA;
}

export const PALETTES: Record<BoxStyle, Palette> = {
  teak: {
    outline: hx("#0d0906"), hi: hx("#c08a52"), base: hx("#7a5230"), base2: hx("#6a4528"), shadow: hx("#3a2819"), inner: hx("#140e0a"),
    fill: hx("#21160e", 238), fill2: hx("#261a11", 238), ornament: hx("#f4ae3d"), ornamentHi: hx("#ffe2a0"),
    plate: hx("#f4ae3d"), plateHi: hx("#ffd27a"), plateLo: hx("#b9741f"),
  },
  lantern: {
    outline: hx("#1a0705"), hi: hx("#ff8a6a"), base: hx("#b8322a"), base2: hx("#9e2820"), shadow: hx("#5e1510"), inner: hx("#f4ae3d"),
    fill: hx("#2a100c", 236), fill2: hx("#321410", 236), ornament: hx("#ffd27a"), ornamentHi: hx("#fff3c4"),
    plate: hx("#ffd27a"), plateHi: hx("#fff3c4"), plateLo: hx("#c48a2a"),
  },
  paper: {
    outline: hx("#3a2819"), hi: hx("#fff6dc"), base: hx("#e8d2a6"), base2: hx("#dcc496"), shadow: hx("#b8976a"), inner: hx("#8a6a44"),
    fill: hx("#f7ebd3", 246), fill2: hx("#f1e2c4", 246), ornament: hx("#b9411f"), ornamentHi: hx("#e5806c"),
    plate: hx("#8a3a22"), plateHi: hx("#b9573a"), plateLo: hx("#5e2414"),
  },
  night: {
    outline: hx("#05070f"), hi: hx("#8fc7e8"), base: hx("#2e3f78"), base2: hx("#283869"), shadow: hx("#151d3d"), inner: hx("#0a0e1f"),
    fill: hx("#0e1426", 232), fill2: hx("#111830", 232), ornament: hx("#ffd27a"), ornamentHi: hx("#ffffff"),
    plate: hx("#8fc7e8"), plateHi: hx("#c8ecff"), plateLo: hx("#4f86b0"),
  },
};

function make(w: number, h: number): Pixels {
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
}
function put(p: Pixels, x: number, y: number, c: RGBA) {
  if (x < 0 || y < 0 || x >= p.width || y >= p.height) return;
  p.data.set(c, (y * p.width + x) * 4);
}

/** Main box / choice panel frame: 24×24, slice margin 8. */
export function boxFrame(style: BoxStyle): Pixels {
  const P = PALETTES[style];
  const S = 24;
  const p = make(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = Math.min(x, S - 1 - x);
      const dy = Math.min(y, S - 1 - y);
      const d = Math.min(dx, dy);
      if (dx + dy < 2) continue; // rounded outer corner
      let c: RGBA;
      if (d === 0) c = P.outline;
      else if (d === 1) c = y < S / 2 && dy === 1 ? P.hi : x < S / 2 && dx === 1 ? P.hi : P.base;
      else if (d === 2) c = P.base;
      else if (d === 3) c = dy === 3 && y > S / 2 ? P.outline : dx === 3 && x > S / 2 ? P.outline : P.shadow;
      else if (d === 4) c = P.inner;
      else c = P.fill;
      if (dx + dy === 2) c = P.outline;
      put(p, x, y, c);
    }
  }
  // corner ornaments (rivets / gold studs / stars)
  for (const [cx, cy] of [[2, 2], [S - 4, 2], [2, S - 4], [S - 4, S - 4]] as const) {
    put(p, cx, cy, P.ornament);
    put(p, cx + 1, cy, P.ornament);
    put(p, cx, cy + 1, P.ornament);
    put(p, cx + 1, cy + 1, P.outline);
    put(p, cx, cy, P.ornamentHi);
  }
  return p;
}

/** Name plate: 16×16, slice margin 5. */
export function plateFrame(style: BoxStyle): Pixels {
  const P = PALETTES[style];
  const S = 16;
  const p = make(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = Math.min(x, S - 1 - x);
      const dy = Math.min(y, S - 1 - y);
      const d = Math.min(dx, dy);
      if (dx + dy < 1) continue;
      let c: RGBA;
      if (d === 0 || dx + dy === 1) c = P.outline;
      else if (d === 1) c = y < S / 2 && dy === 1 ? P.plateHi : x < S / 2 && dx === 1 ? P.plateHi : P.plateLo;
      else c = P.plate;
      put(p, x, y, c);
    }
  }
  return p;
}

/** Portrait well: 12×12, slice margin 4 (dark inset). */
export function wellFrame(style: BoxStyle): Pixels {
  const P = PALETTES[style];
  const S = 12;
  const p = make(S, S);
  const dark: RGBA = style === "paper" ? hx("#d8c49e") : [Math.round(P.inner[0] * 0.6), Math.round(P.inner[1] * 0.6), Math.round(P.inner[2] * 0.6), 255];
  const deep: RGBA = style === "paper" ? hx("#cdb68a") : hx("#0a0705");
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = Math.min(x, S - 1 - x);
      const dy = Math.min(y, S - 1 - y);
      const d = Math.min(dx, dy);
      let c: RGBA;
      if (d === 0) c = y === S - 1 || x === S - 1 ? P.hi : P.outline;
      else if (d === 1) c = y === 1 || x === 1 ? deep : dark;
      else c = dark;
      put(p, x, y, c);
    }
  }
  return p;
}

/** "Next" arrow 7×5 and choice cursor 6×7. */
export function nextArrow(style: BoxStyle): Pixels {
  const P = PALETTES[style];
  const rows = ["kkkkkkk", "kaaaaak", ".kaaak.", "..kak..", "...k..."];
  const p = make(7, 5);
  rows.forEach((r, y) => [...r].forEach((ch, x) => ch !== "." && put(p, x, y, ch === "k" ? P.outline : P.ornament)));
  return p;
}

export function cursorArrow(style: BoxStyle): Pixels {
  const P = PALETTES[style];
  const rows = ["kk....", "kak...", "kaak..", "kaaak.", "kaak..", "kak...", "kk...."];
  const p = make(6, 7);
  rows.forEach((r, y) => [...r].forEach((ch, x) => ch !== "." && put(p, x, y, ch === "k" ? P.outline : P.ornament)));
  return p;
}

export const FRAME_FILES = {
  box: { make: boxFrame, margin: 8 },
  plate: { make: plateFrame, margin: 5 },
  well: { make: wellFrame, margin: 4 },
  next: { make: nextArrow, margin: 0 },
  cursor: { make: cursorArrow, margin: 0 },
} as const;
