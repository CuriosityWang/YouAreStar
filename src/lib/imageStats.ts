// CPU-side computation of Reinhard lαβ statistics for the user image (source)
// and for the billboard region of the background (target). Results feed the
// shader as uniforms; recomputed only when the image or corners change.

import { StatsAccumulator, type Stats } from "./color";
import type { Corners } from "../data/presets";

export type ImageSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

function dimsOf(img: ImageSource): [number, number] {
  if (img instanceof HTMLImageElement) return [img.naturalWidth, img.naturalHeight];
  return [img.width, img.height];
}

function draw(img: ImageSource, w: number, h: number): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** Mean/std of the whole image, downsampled for speed. */
export function imageStats(img: ImageSource, maxDim = 96): Stats {
  const [iw, ih] = dimsOf(img);
  const scale = Math.min(1, maxDim / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * scale));
  const h = Math.max(1, Math.round(ih * scale));
  const { data } = draw(img, w, h);

  const acc = new StatsAccumulator();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) continue; // skip transparent
    acc.addRGB(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
  }
  return acc.result();
}

/** Ray-casting point-in-polygon test. `quad` points are in pixel space. */
function inPolygon(px: number, py: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Mean/std of the background pixels that fall inside the billboard quad.
 * `corners` are normalized (0..1); we sample a grid within the quad bbox.
 */
export function sampleRegionStats(
  img: ImageSource,
  corners: Corners,
  maxDim = 480,
): Stats {
  const [iw, ih] = dimsOf(img);
  const scale = Math.min(1, maxDim / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * scale));
  const h = Math.max(1, Math.round(ih * scale));
  const { data } = draw(img, w, h);

  const poly: [number, number][] = corners.map(([x, y]) => [x * w, y * h]);
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const minX = Math.max(0, Math.floor(Math.min(...xs)));
  const maxX = Math.min(w - 1, Math.ceil(Math.max(...xs)));
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(h - 1, Math.ceil(Math.max(...ys)));

  // step keeps the sample count bounded (~target 4k samples)
  const area = (maxX - minX + 1) * (maxY - minY + 1);
  const step = Math.max(1, Math.round(Math.sqrt(area / 4000)));

  const acc = new StatsAccumulator();
  for (let y = minY; y <= maxY; y += step) {
    for (let x = minX; x <= maxX; x += step) {
      if (!inPolygon(x + 0.5, y + 0.5, poly)) continue;
      const idx = (y * w + x) * 4;
      if (data[idx + 3] < 8) continue;
      acc.addRGB(data[idx] / 255, data[idx + 1] / 255, data[idx + 2] / 255);
    }
  }

  // fall back to whole-image stats if the quad caught too few pixels
  if (acc.count < 16) return imageStats(img);
  return acc.result();
}
