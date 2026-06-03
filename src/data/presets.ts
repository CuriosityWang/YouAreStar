// Preset billboard scenes.
//
// `corners` are the four vertices of the ad surface, NORMALIZED to the image
// (x in 0..1 of width, y in 0..1 of height), in the fixed order:
//
//        TL ──────── TR
//         │           │
//        BL ──────── BR        →  [TL, TR, BR, BL]
//
// This order matches the source-image UV quad [[0,0],[1,0],[1,1],[0,1]] used by
// the homography solver, so an uploaded image lands upright in the surface.
//
// To add a real photo: drop it in /public/billboards, then use the app's
// "Use your own billboard" mode to drag the handles, hit "Copy corners", and
// paste a new entry here.

import type { LocalizedString } from "../i18n";

export type Corner = [number, number];
export type Corners = [Corner, Corner, Corner, Corner];

export interface Preset {
  id: string;
  name: LocalizedString;
  /** short editorial caption shown under the gallery card */
  caption: LocalizedString;
  /** path under /public */
  src: string;
  corners: Corners;
  /** optional occlusion mask PNG (white = foreground that stays in front) */
  mask?: string;
}

export const PRESETS: Preset[] = [
  {
    id: "times-square-night",
    name: { en: "Times Square — Center Cut", zh: "时代广场 · 正中大屏" },
    caption: {
      en: "Night, a neon canyon — the big screen dead ahead.",
      zh: "夜晚，霓虹峡谷——正前方的巨幕。",
    },
    src: "/billboards/times-square-night.svg",
    corners: [
      [0.3375, 0.17],
      [0.6625, 0.12],
      [0.6625, 0.6],
      [0.3375, 0.54],
    ],
  },
  {
    id: "times-square-corner",
    name: { en: "Times Square — The Corner", zh: "时代广场 · 转角竖屏" },
    caption: {
      en: "A tower-corner wrap, raking hard to the right.",
      zh: "塔楼转角包柱，强烈向右斜切。",
    },
    src: "/billboards/times-square-corner.svg",
    corners: [
      [0.225, 0.16],
      [0.45, 0.25],
      [0.45, 0.86],
      [0.225, 0.74],
    ],
  },
  {
    id: "gallery-wall",
    name: { en: "The Gallery Wall", zh: "画廊墙面" },
    caption: {
      en: "Interior, warm light — a framed surface at three-quarter view.",
      zh: "室内暖光——三分之四视角的画框。",
    },
    src: "/billboards/gallery-wall.svg",
    corners: [
      [0.29375, 0.29],
      [0.675, 0.345],
      [0.675, 0.71],
      [0.29375, 0.69],
    ],
  },
  {
    id: "street-kiosk",
    name: { en: "The Street Kiosk", zh: "街头立柱" },
    caption: {
      en: "Open air — a vertical poster column on the avenue.",
      zh: "户外——大道旁的竖式海报柱。",
    },
    src: "/billboards/street-kiosk.svg",
    corners: [
      [0.359375, 0.215],
      [0.590625, 0.25],
      [0.6, 0.84],
      [0.35, 0.81],
    ],
  },
  {
    id: "subway-platform",
    name: { en: "The Subway Platform", zh: "地铁站台" },
    caption: {
      en: "Underground — a wide panel raking down the platform.",
      zh: "地下——沿站台斜展的宽幅广告。",
    },
    src: "/billboards/subway-platform.svg",
    corners: [
      [0.2125, 0.3],
      [0.75625, 0.4],
      [0.75625, 0.66],
      [0.2125, 0.64],
    ],
  },
];
