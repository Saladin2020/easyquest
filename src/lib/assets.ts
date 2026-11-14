import path from "node:path";
import { GlobalFonts } from "@napi-rs/canvas";
import { pkgRoot } from "./workspace.js";

export const FONT_DIR = path.join(pkgRoot, "assets", "fonts");
export const FONT_REGULAR = path.join(FONT_DIR, "Kanit-Regular.ttf");
export const FONT_MEDIUM = path.join(FONT_DIR, "Kanit-Medium.ttf");

let registered = false;
/** Register Kanit with Skia (HarfBuzz shaping → Thai vowels and tone marks stack correctly). */
export function registerFonts(): void {
  if (registered) return;
  GlobalFonts.registerFromPath(FONT_REGULAR, "Kanit");
  GlobalFonts.registerFromPath(FONT_MEDIUM, "Kanit Medium");
  registered = true;
}
