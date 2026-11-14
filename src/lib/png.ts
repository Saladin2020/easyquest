import { createCanvas } from "@napi-rs/canvas";
import type { Pixels } from "../shared/frames.js";

export function pixelsPng(p: Pixels): Buffer {
  const c = createCanvas(p.width, p.height);
  const g = c.getContext("2d");
  const id = g.createImageData(p.width, p.height);
  id.data.set(p.data);
  g.putImageData(id, 0, 0);
  return c.toBuffer("image/png");
}
