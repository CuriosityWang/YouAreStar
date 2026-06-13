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
// Preset data lives in ./billboards.json so the dev-only "Publish official
// template" flow (vite-plugin-publish-template.ts) can write entries — including
// occlusion `mask` paths — without rewriting this TypeScript. To add a scene,
// run `npm run dev`, open the editor, set corners, paint/import a mask, and use
// "Publish as template". See CLAUDE.md → "Adding a preset scene".

import type { LocalizedString } from "../i18n";
import billboards from "./billboards.json";

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

// Photos are royalty-free (Unsplash License). See public/billboards/CREDITS.md.
export const PRESETS = billboards as unknown as Preset[];
