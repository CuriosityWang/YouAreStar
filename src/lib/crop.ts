import type { Corners } from "../data/presets";

export interface CropParams {
  zoom: number;
  centerX: number;
  centerY: number;
  /** mirror the source image horizontally (negate the X sample offset) */
  flipH: boolean;
}

export interface CropWindow {
  spanX: number;
  spanY: number;
  centerX: number;
  centerY: number;
}

export const DEFAULT_CROP: CropParams = {
  zoom: 1,
  centerX: 0.5,
  centerY: 0.5,
  flipH: false,
};

export const MIN_CROP_ZOOM = 1;
export const MAX_CROP_ZOOM = 4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function distance(a: [number, number], b: [number, number], width: number, height: number) {
  return Math.hypot((b[0] - a[0]) * width, (b[1] - a[1]) * height);
}

/**
 * Estimate the physical aspect ratio of the marked ad surface in background
 * pixels. Averaging opposite edges is stable for ordinary perspective quads.
 */
export function quadAspect(
  corners: Corners,
  bgWidth: number,
  bgHeight: number,
): number {
  const top = distance(corners[0], corners[1], bgWidth, bgHeight);
  const right = distance(corners[1], corners[2], bgWidth, bgHeight);
  const bottom = distance(corners[3], corners[2], bgWidth, bgHeight);
  const left = distance(corners[0], corners[3], bgWidth, bgHeight);
  const width = (top + bottom) / 2;
  const height = (left + right) / 2;
  return width > 0 && height > 0 ? width / height : 1;
}

/** UV span of the source image that fills the destination without distortion. */
export function coverSpan(
  corners: Corners,
  bgWidth: number,
  bgHeight: number,
  userWidth: number,
  userHeight: number,
  zoom: number,
): [number, number] {
  const destAspect = quadAspect(corners, bgWidth, bgHeight);
  const sourceAspect =
    userWidth > 0 && userHeight > 0 ? userWidth / userHeight : destAspect;
  const ratio = destAspect / sourceAspect;
  const safeZoom = clamp(zoom, MIN_CROP_ZOOM, MAX_CROP_ZOOM);
  const baseX = ratio < 1 ? ratio : 1;
  const baseY = ratio < 1 ? 1 : 1 / ratio;
  return [baseX / safeZoom, baseY / safeZoom];
}

/** Clamp the crop center so the sampled window never leaves the source image. */
export function cropWindow(
  crop: CropParams,
  corners: Corners,
  bgWidth: number,
  bgHeight: number,
  userWidth: number,
  userHeight: number,
): CropWindow {
  const [spanX, spanY] = coverSpan(
    corners,
    bgWidth,
    bgHeight,
    userWidth,
    userHeight,
    crop.zoom,
  );
  return {
    spanX,
    spanY,
    centerX: clamp(crop.centerX, spanX / 2, 1 - spanX / 2),
    centerY: clamp(crop.centerY, spanY / 2, 1 - spanY / 2),
  };
}

export function clampCrop(
  crop: CropParams,
  corners: Corners,
  bgWidth: number,
  bgHeight: number,
  userWidth: number,
  userHeight: number,
): CropParams {
  const window = cropWindow(crop, corners, bgWidth, bgHeight, userWidth, userHeight);
  return {
    zoom: clamp(crop.zoom, MIN_CROP_ZOOM, MAX_CROP_ZOOM),
    centerX: window.centerX,
    centerY: window.centerY,
    flipH: crop.flipH,
  };
}

/**
 * New crop after changing zoom while keeping the source point under a fixed
 * surface coordinate (sx, sy in 0..1 across the ad quad) anchored — so a
 * wheel/pinch zoom magnifies toward the cursor instead of the center.
 * sx = sy = 0.5 anchors at the center (slider / keyboard zoom).
 */
export function zoomAtSurface(
  crop: CropParams,
  corners: Corners,
  bgWidth: number,
  bgHeight: number,
  userWidth: number,
  userHeight: number,
  nextZoom: number,
  sx: number,
  sy: number,
): CropParams {
  const cur = cropWindow(crop, corners, bgWidth, bgHeight, userWidth, userHeight);
  const [nextX, nextY] = coverSpan(
    corners,
    bgWidth,
    bgHeight,
    userWidth,
    userHeight,
    nextZoom,
  );
  const flipX = crop.flipH ? -1 : 1;
  return clampCrop(
    {
      ...crop,
      zoom: nextZoom,
      centerX: cur.centerX + (sx - 0.5) * (cur.spanX - nextX) * flipX,
      centerY: cur.centerY + (sy - 0.5) * (cur.spanY - nextY),
    },
    corners,
    bgWidth,
    bgHeight,
    userWidth,
    userHeight,
  );
}
