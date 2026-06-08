# Billboard Replacer · 广告牌置换

> Drop your artwork onto a billboard's ad surface so it looks **integrated, not pasted** —
> perspective-warped to the surface geometry and color-matched to the scene's light.

A browser tool that composites any image into a billboard's ad surface using a
**homography (perspective) warp** plus **Reinhard color transfer**, all in a single
real-time WebGL pass. The preview you see is exactly what you download — the export
re-runs the *same* shader at full resolution.

The look is "Editorial Gallery": warm paper, Fraunces display type, a vermilion accent.
The UI is fully bilingual — **English / 中文**.

---

## Features

- **Two ways in**
  - **Preset scenes** — pick a photo whose ad surface is already annotated and drop your image in.
  - **Use your own billboard** — upload any photo and drag four handles to mark the surface.
- **Perspective warp** — a 4-point homography maps your image onto the marked quad, so it
  follows the surface in 3D space.
- **Auto color match** — Reinhard color transfer (computed in the decorrelated *lαβ* space)
  samples the lighting *inside* the billboard region and remaps your image's statistics onto
  it, so the insert sits in the same light as the scene.
- **Manual grade & blend** — fine-tune exposure/tint, edge feather, blend mode, and grain.
- **Occlusion masks** — a white mask keeps foreground objects in front of the inserted image.
- **WYSIWYG export** — one WebGL shader drives both the live preview and the PNG export.

## How it works

A single full-screen WebGL pass does everything per fragment:

1. **Perspective warp** — sample the user image through the *inverse* homography.
2. **Reinhard transfer** — match the image's color statistics to the billboard region's.
3. **Manual grade** — exposure / tint adjustments.
4. **Edge feather → blend mode → occlusion mask → grain.**

The CPU side (`src/lib/color.ts`, `src/lib/imageStats.ts`) computes the per-channel
*lαβ* mean/std for both the source image and the sampled target region; the shader
re-implements the color math so the two stay in sync. Geometry lives in
`src/lib/homography.ts` (4-point DLT), the GLSL in `src/lib/webgl/shaders.ts`, and the
renderer in `src/lib/webgl/renderer.ts`.

## Tech stack

React + Vite + TypeScript · raw WebGL (no Three.js) · framer-motion · plain CSS.
No backend — everything runs in the browser.

## Getting started

```bash
npm install
npm run dev        # Vite dev server on http://localhost:5173
npm run build      # type-check + production build → dist/
npm run preview    # serve the production build locally
```

> Requires Node 18+ (Node 20 LTS recommended).

## Preset scenes

| Scene | File |
|---|---|
| Times Square — Night Marquee | `times-square-night.jpg` |
| Times Square — The Corner | `times-square-corner.jpg` |
| The Gallery Wall | `gallery-wall.jpg` |
| The Street Kiosk | `street-kiosk.jpg` |
| The Subway Platform | `subway-platform.jpg` |

**Adding your own:** drop an image in `public/billboards/`, then add an entry to `PRESETS`
in `src/data/presets.ts` with normalized corners in `[TL, TR, BR, BL]` order. The fastest
way to get correct corners is to load the image in the app's **custom mode**, drag the four
handles, and click **Copy corners**.

## Deployment

It's a static single-page app, so any static host works (Nginx, Caddy, Netlify, Vercel,
GitHub Pages, …). Build, then serve the `dist/` folder:

```bash
npm run build
# point your web server's document root at ./dist
```

Minimal Nginx example:

```nginx
server {
    listen 80;
    server_name _;
    root /var/www/youarestar/dist;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
}
```

## Project layout

```
src/
  lib/
    homography.ts        4-point DLT, matrix helpers
    color.ts             Reinhard lαβ statistics (CPU)
    imageStats.ts        target-region stats sampling
    webgl/
      shaders.ts         GLSL ES 1.00 (vertex + fragment)
      renderer.ts        Renderer class, renderToBlob()
  hooks/useEditor.ts     useReducer — single source of truth
  components/            Gallery, Editor, control panels
  i18n/                  EN / 中文 dictionary
  data/presets.ts        preset scenes + corner annotations
public/billboards/       preset photos (+ CREDITS.md)
```

## Credits & license

Preset background photos are from [Unsplash](https://unsplash.com) (Unsplash License) —
see [`public/billboards/CREDITS.md`](public/billboards/CREDITS.md) for per-photo sources.

Licensed under the [MIT License](LICENSE).
