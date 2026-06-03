// Pure geometry/helpers for the mask brush. No DOM/canvas references — these are
// the bits that are unit-testable with `npx tsx`.

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ViewTransform {
  zoom: number; // scale factor (1 = fit-to-stage)
  panX: number; // translation in display px (outer holder space)
  panY: number;
}

export interface GradientStop {
  offset: number;
  color: string;
}

/**
 * Map a screen pointer to mask-canvas pixel coordinates.
 *
 * The outer stage holder (untransformed, fitted box) has on-screen bounding rect
 * `holder`. In mask mode its inner content is transformed by
 * `translate(panX,panY) scale(zoom)` about a top-left origin, so a screen point
 * `s` relates to a local (unscaled-holder) point `u` by `s = pan + zoom*u`. The
 * mask canvas (maskW x maskH) maps 1:1 normalized onto the unscaled holder.
 */
export function screenToMask(
  clientX: number,
  clientY: number,
  holder: { left: number; top: number; width: number; height: number },
  view: ViewTransform,
  maskW: number,
  maskH: number,
): Pt {
  const sx = clientX - holder.left;
  const sy = clientY - holder.top;
  const ux = (sx - view.panX) / view.zoom;
  const uy = (sy - view.panY) / view.zoom;
  return {
    x: (ux / holder.width) * maskW,
    y: (uy / holder.height) * maskH,
  };
}

/** Stamp positions along a segment so a fast stroke leaves no gaps. */
export function interpolateStamps(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  spacing: number,
): Pt[] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  const step = Math.max(spacing, 0.5);
  const pts: Pt[] = [];
  if (dist > 0) {
    const n = Math.floor(dist / step);
    for (let i = 1; i <= n; i++) {
      const t = (i * step) / dist;
      pts.push({ x: x0 + dx * t, y: y0 + dy * t });
    }
  }
  pts.push({ x: x1, y: y1 });
  return pts;
}

/**
 * Radial-gradient stops for a brush tip (center -> edge). Paint = white center
 * on black edge (composited with 'lighten'); erase = black center on white edge
 * (composited with 'darken'). `hardness` 1 = crisp, 0 = fully soft.
 */
export function brushStops(hardness: number, erase: boolean): GradientStop[] {
  const h = Math.min(1, Math.max(0, hardness));
  const inner = erase ? "#000" : "#fff";
  const outer = erase ? "#fff" : "#000";
  return [
    { offset: 0, color: inner },
    { offset: h * 0.999, color: inner },
    { offset: 1, color: outer },
  ];
}

/** Grow a dirty bbox to include a stamp of `radius` centered at (x,y). */
export function growRect(r: Rect | null, x: number, y: number, radius: number): Rect {
  const minX = x - radius;
  const minY = y - radius;
  const maxX = x + radius;
  const maxY = y + radius;
  if (!r) return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  const nx = Math.min(r.x, minX);
  const ny = Math.min(r.y, minY);
  const right = Math.max(r.x + r.w, maxX);
  const bottom = Math.max(r.y + r.h, maxY);
  return { x: nx, y: ny, w: right - nx, h: bottom - ny };
}

/** Clip a (possibly fractional, possibly out-of-bounds) rect to integer canvas px. */
export function clampRectToCanvas(r: Rect, w: number, h: number): Rect {
  const x = Math.max(0, Math.floor(r.x));
  const y = Math.max(0, Math.floor(r.y));
  const right = Math.min(w, Math.ceil(r.x + r.w));
  const bottom = Math.min(h, Math.ceil(r.y + r.h));
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

/** New view so the point under the cursor stays fixed when the zoom changes.
 *  cx,cy are cursor coords within the outer holder box. */
export function zoomToward(
  view: ViewTransform,
  nextZoom: number,
  cx: number,
  cy: number,
): ViewTransform {
  const wx = (cx - view.panX) / view.zoom;
  const wy = (cy - view.panY) / view.zoom;
  return { zoom: nextZoom, panX: cx - wx * nextZoom, panY: cy - wy * nextZoom };
}

export function clampZoom(z: number, min = 1, max = 8): number {
  return Math.min(max, Math.max(min, z));
}

/** Keep the scaled content covering the holder (no empty gutters). */
export function clampPan(view: ViewTransform, holderW: number, holderH: number): ViewTransform {
  const minX = holderW - holderW * view.zoom;
  const minY = holderH - holderH * view.zoom;
  return {
    ...view,
    panX: Math.min(0, Math.max(minX, view.panX)),
    panY: Math.min(0, Math.max(minY, view.panY)),
  };
}
