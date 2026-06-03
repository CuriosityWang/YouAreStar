# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser tool that composites a user's image into a billboard's ad surface via a **homography (perspective) warp** plus **Reinhard color matching**, so the result looks integrated rather than pasted. Two modes: **preset** scenes (corners pre-annotated) and **custom** (upload a photo, drag four handles to mark the surface). React + Vite + TypeScript, raw WebGL, framer-motion. UI is bilingual (EN / 中文). Aesthetic direction is "Editorial Gallery" (warm paper, Fraunces display, vermilion accent).

## Commands

```bash
npm run dev        # Vite dev server on :5173 (auto-opens)
npm run build      # tsc -b && vite build  → dist/
npm run preview    # serve the production build
```

There is **no test runner**. The pure math (`src/lib/homography.ts`, `src/lib/color.ts`) is easy to sanity-check ad hoc with `npx tsx`. WebGL/rendering and the React flow are best verified by eye in the browser, or headlessly by driving Chrome over the DevTools Protocol.

## Architecture (the parts that span multiple files)

### The rendering pipeline is the core of the app
A **single WebGL full-screen pass** does everything: perspective warp, Reinhard transfer, manual grade, edge feather, blend mode, occlusion mask, grain. The exact same shader drives the live preview **and** the export — `renderToBlob()` spins up a throwaway `Renderer` at full background resolution so what you see equals what you download.

- `src/lib/webgl/shaders.ts` — `VERT_SRC` / `FRAG_SRC` (GLSL ES 1.00 / WebGL1).
- `src/lib/webgl/renderer.ts` — `Renderer` class, `RenderState`, `GradeParams`, `BlendParams`, `renderToBlob()`.
- `src/lib/homography.ts` — `solve4Point` (4-point DLT), `invert3x3`, `destToSourceUV`, `toGLMat3`.

**Coordinate convention (do not break this):** billboard corners are **normalized 0..1 to the background image**, always in order **`[TL, TR, BR, BL]`**, matching `UNIT_QUAD = [[0,0],[1,0],[1,1],[0,1]]`. The shader samples the user image via the **inverse** homography (`destToSourceUV`): for each fragment in image-uv space it computes the source UV to read. Textures and the full-screen triangle use a **top-left-origin uv** so corners, textures, and output stay aligned.

### CPU and GPU color code must stay in sync
Reinhard color transfer runs in the decorrelated **lαβ** space. The CPU side (`src/lib/color.ts` `rgbToLab` + `StatsAccumulator`, and `src/lib/imageStats.ts`) computes per-channel mean/std for the **user image (source)** and the **billboard region (target)**, passed to the shader as uniforms. The shader re-implements `rgb2lab` / `lab2rgb`. **The LMS→RGB inverse matrix in `lab2rgb` is the exact computed inverse, not the textbook 4-decimal values** — keeping it precise gives a machine-epsilon round-trip; do not "simplify" it back to the rounded constants.

`sampleRegionStats` is what makes auto-match work: it samples the background pixels *inside* the billboard quad to learn the local lighting, then the shader remaps the user image's statistics onto it.

### State flow
`src/hooks/useEditor.ts` is a `useReducer` and the single source of truth (`EditorState`, `EditorSource`, `EditorApi`). `App.tsx` switches between `Gallery` and `Editor` on `state.view`.

`EditorStage.tsx` owns the WebGL `Renderer` in a ref and re-renders via effects. **Effect ordering matters:** the texture-upload effects (`setBackground` / `setUser` / `setMask`) are declared **before** the draw effect so the GPU has the right textures when it draws. A `ResizeObserver` fits the canvas to the background's aspect ratio; target-region stats are **debounced** on corner changes so dragging stays at 60fps.

### WebGL context lifecycle gotcha
`Renderer.dispose(loseContext)` — pass `true` **only** for the throwaway export renderer. Never lose the context on the live canvas: a canvas caches its WebGL context, so React StrictMode's mount→unmount→remount would hand the remounted renderer a dead context (symptom: blank stage). This already bit us once.

### i18n
`src/i18n/index.tsx` holds `STRINGS` (the EN/ZH dictionary, typed — `TKey`), `I18nProvider`, and `useI18n()` (`{ lang, setLang, t }`). All UI text goes through `t(key)`. Preset names/captions are `LocalizedString` ({en, zh}) resolved with `loc(value, lang)`; `EditorSource.name` may be a plain string (custom uploads) or `LocalizedString` (presets), so always resolve it through `loc()`. Language is persisted to `localStorage` and defaults from `navigator.language`. Adding a string = add one typed entry to `STRINGS`.

## Adding a preset scene
1. Put the image (SVG or photo) in `public/billboards/`.
2. Add an entry to `PRESETS` in `src/data/presets.ts` with normalized `corners` in `[TL, TR, BR, BL]` order. The fastest way to get correct corners is to load the image via the app's **custom mode**, drag the four handles, and click **Copy corners** — it copies a ready-to-paste snippet.
3. Optional occlusion: supply a `mask` PNG (white = foreground that must stay in front of the inserted image). The shader already honors it (`alpha *= 1 - mask`); only the mask asset is missing for existing scenes.

The bundled `public/billboards/*.svg` are dependency-free placeholder scenes; the panel polygon coordinates in each SVG are kept identical to the normalized `corners` in `presets.ts`.

## Styling
Three plain CSS files (no CSS framework), loaded in order: `src/styles/global.css` (design tokens / type / paper grain), `src/styles/ui.css` (control primitives, language toggle, buttons), `src/styles/app.css` (gallery + editor layout). All colors and metrics are CSS custom properties defined in `global.css`.
