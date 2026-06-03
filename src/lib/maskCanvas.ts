// Canvas-2D brush engine for the occlusion mask. The mask is an opaque,
// black-background canvas in background-image space; the shader reads its RED
// channel (alpha *= 1 - mask.r). White = full occlusion, black = none, gray =
// feathered. Paint composites with 'lighten' (max) so overlapping tips union
// without buildup; erase uses 'darken' (min).

import { brushStops, interpolateStamps } from "./maskMath";

export interface MaskCanvas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** mask px per background px (mask long side is capped, so usually <= 1) */
  scale: number;
}

/** Create an opaque-black mask canvas matching the bg aspect, long side <= maxDim. */
export function createMaskCanvas(bgW: number, bgH: number, maxDim = 2048): MaskCanvas {
  const scale = Math.min(1, maxDim / Math.max(bgW, bgH));
  const w = Math.max(1, Math.round(bgW * scale));
  const h = Math.max(1, Math.round(bgH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  return { canvas, ctx, scale };
}

export function clearMask(mask: MaskCanvas): void {
  const { ctx, canvas } = mask;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

/** Invert: the canvas is grayscale-on-black, so 'difference' with white => 255-r. */
export function invertMask(mask: MaskCanvas): void {
  const { ctx, canvas } = mask;
  ctx.save();
  ctx.globalCompositeOperation = "difference";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

/** Draw a preset's mask PNG as the starting layer, scaled to fill. */
export function drawBaseImage(mask: MaskCanvas, img: CanvasImageSource): void {
  const { ctx, canvas } = mask;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function stamp(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  hardness: number,
  erase: boolean,
): void {
  const r = Math.max(0.5, radius);
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  for (const s of brushStops(hardness, erase)) g.addColorStop(s.offset, s.color);
  ctx.save();
  ctx.globalCompositeOperation = erase ? "darken" : "lighten";
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** One brush tip in mask px. */
export function stampBrush(
  mask: MaskCanvas,
  x: number,
  y: number,
  radius: number,
  hardness: number,
  erase: boolean,
): void {
  stamp(mask.ctx, x, y, radius, hardness, erase);
}

/** A continuous stroke segment (interpolated tips) in mask px. */
export function strokeSegment(
  mask: MaskCanvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  hardness: number,
  erase: boolean,
): void {
  const spacing = Math.max(0.5, radius * 0.25);
  for (const p of interpolateStamps(x0, y0, x1, y1, spacing)) {
    stamp(mask.ctx, p.x, p.y, radius, hardness, erase);
  }
}

/** Copy a sub-rectangle out of an ImageData (for undo "before" snapshots). */
export function cropImageData(
  src: ImageData,
  x: number,
  y: number,
  w: number,
  h: number,
): ImageData {
  const out = new ImageData(w, h);
  for (let row = 0; row < h; row++) {
    const sStart = ((y + row) * src.width + x) * 4;
    const dStart = row * w * 4;
    out.data.set(src.data.subarray(sStart, sStart + w * 4), dStart);
  }
  return out;
}
