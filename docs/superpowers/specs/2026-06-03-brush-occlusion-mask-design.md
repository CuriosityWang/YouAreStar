# Brush Occlusion Mask — Design Spec

**Date:** 2026-06-03
**Branch:** `mask-brush`
**Status:** Approved design, pending implementation plan

## Problem

When a scene photo has a foreground object in front of the billboard surface (a
lamppost, a tree branch, a passer-by, a railing), warping the inserted ad onto
the quad paints *over* that object — the ad covers something that should occlude
it, which reads as fake.

The rendering pipeline already supports occlusion: the fragment shader does
`alpha *= 1.0 - texture2D(u_mask, v_uv).r` (`src/lib/webgl/shaders.ts:133`),
sampling a mask in **background-image space**, reading the **red channel**. But
the only way to supply a mask today is a preset PNG declared in `presets.ts`
(`mask?`), loaded in `openPreset`. Custom uploads always set `mask: null`, and
there is **no authoring UI** for either path. The GPU side is fully plumbed; the
authoring entry point is missing.

This spec adds an in-app **brush tool** to paint that occlusion mask, available
for both custom uploads and presets, with a precise, pleasant brush feel.

## Goals

- Paint/erase an occlusion mask directly on the stage, with the ad composite
  updating live as you paint.
- Precise brushwork: adjustable size, soft/hard edge, zoom & pan to pixel level,
  no gaps on fast strokes, undo/redo.
- One mask path end to end: the same painted mask drives live preview and export
  (so what you see equals what you download).

## Non-goals (YAGNI)

- Straight-line (Shift) strokes — explicitly dropped.
- Pressure sensitivity — dropped.
- Auto/AI foreground segmentation — out of scope.
- Re-rendering the WebGL viewport for a pixel-sharp zoom — out of scope; we use
  CSS-transform zoom (see Zoom & Pan).

## Core concept (must stay aligned with the shader)

The mask is an **opaque, black-background** offscreen canvas in
background-image space. The shader reads the **red** channel:

- `r = 0` (black) → no occlusion, ad shows normally.
- `r = 1` (white) → full occlusion, ad alpha zeroed (foreground stays in front).
- intermediate gray → partial/feathered occlusion.

You paint **white over the foreground objects that should cover the ad**.

**Why red-channel-on-opaque-black, not an alpha-painted mask:** the shader reads
`.r`, not `.a`. A straight RGBA texture upload (`premultipliedAlpha:false`)
preserves `.r` regardless of `.a`, so a "white with alpha 0.5" feather edge would
still read `r = 1` and break soft edges. Encoding strength in the red channel of
an opaque canvas keeps soft edges correct.

## Brush engine — `src/lib/maskCanvas.ts` (new)

Pure, focused module. No React. Encapsulates the brush math so it can be
sanity-checked with `npx tsx` and reasoned about in isolation.

Exports:

- `createMaskCanvas(bgW, bgH, maxDim=2048) → { canvas, ctx, scale }`
  Mask canvas matches the background aspect ratio, long side capped at `maxDim`.
  (Export renders bg capped at 2400; the mask can be smaller — uv sampling is
  resolution-independent.) Initialized to **opaque black**.
- `stampBrush(ctx, x, y, radius, hardness, mode)` — paints one brush tip.
- `strokeSegment(ctx, x0, y0, x1, y1, radius, hardness, spacing, mode)` —
  interpolates tips along the segment (see Stroke interpolation).
- `clearMask(ctx)` — fill opaque black.
- `invertMask(ctx)` — invert the mask. Since the brush paints an equal-RGB
  gray/white on black, the canvas is grayscale, so a full-canvas white fill with
  `globalCompositeOperation = 'difference'` cleanly inverts it (`255 - r`).
- `drawBaseImage(ctx, img)` — draw a preset's mask PNG scaled to fill (base
  layer when entering mask mode on a preset that ships a PNG).

### Brush tip

A radial gradient from white (center) to black (edge). **Hardness** controls the
gradient stops:

- `hardness = 1` → white out to ~95%, then a sharp drop to black (hard edge).
- `hardness = 0` → white at center linearly falling to black at the rim (soft).
- Concretely: stops at `[0 → white]`, `[hardness → white]`, `[1 → black]`.

### Compositing (the key choice)

- **Paint:** `globalCompositeOperation = 'lighten'` (per-channel max). Overlapping
  tips within a stroke take the union — soft edges preserved, **no buildup
  darkening**. Idempotent and stable: re-painting the same area does not drift.
- **Erase:** `globalCompositeOperation = 'darken'` (per-channel min) with a
  black-center → white-edge tip. Cleanly removes red with the same soft falloff.

This max/min model gives a predictable, precise mask, which suits an occlusion
mask better than alpha accumulation.

### Stroke interpolation

When consecutive pointer samples are farther apart than `radius * 0.25`, stamp
intermediate tips along the line so fast strokes are continuous (no dotted
gaps).

## Live rendering & performance

Painting must **not** round-trip through `useReducer` per `pointermove` — that
would re-render React and drop frames. Instead:

- The brush writes directly to the stable `maskCanvas` ref.
- On each `requestAnimationFrame` tick during a stroke: upload only the frame's
  **dirty rect** via `texSubImage2D`, then re-render the single full-screen pass
  once. This keeps painting at 60fps even for large masks.
- React state updates only at **stroke boundaries** (pointerdown/up): set the
  `MASK_TOUCHED` flag (enables export-honors-mask and undo/redo availability).

### Renderer change — `src/lib/webgl/renderer.ts`

- `setMask` already accepts a canvas (`TexImage = TexImageSource` includes
  `HTMLCanvasElement`) — no type change needed.
- Add `updateMaskRegion(source, x, y, w, h)`: bind `texMask`, `texSubImage2D`
  the sub-rect into the existing texture (no delete/recreate churn). Used for
  live incremental uploads. Falls back to a full `setMask` when the texture
  identity/size changes (e.g. first paint, source switch).

## Zoom & pan

Apply a **CSS transform (scale + translate)** to a container wrapping the WebGL
canvas + brush overlay, only in mask mode.

- Wheel zooms toward the cursor; hold **Space + drag** to pan; a **Fit** button
  resets and a zoom-% indicator is shown.
- Pointer → mask-pixel mapping inverts the zoom/pan transform first, so brush
  precision targets **mask-canvas pixels** and is independent of screen zoom —
  zoom in to trace a thin pole at pixel accuracy.
- To keep the zoomed preview reasonably sharp, mask mode raises the WebGL
  backing-store resolution to `min(bg native, cap)`. This is a CSS-zoom approach
  (no WebGL viewport rewrite); at extreme zoom the preview softens but brush
  precision is unaffected. Acceptable tradeoff; viewport re-render is a possible
  future upgrade.

## Undo / redo (dirty-rect diff)

- On `pointerdown`, capture one full-canvas `ImageData` into a transient buffer
  and start tracking the stroke's dirty bbox.
- On `pointerup`, crop **before** (from the transient buffer) and **after** (from
  the current canvas) to the dirty bbox; push `{ x, y, before, after }` onto the
  undo stack. Memory is proportional to painted area, not canvas size.
- Undo restores `before` into the bbox; redo restores `after`. Both re-upload the
  affected region and redraw.
- Stack depth capped at ~30 (drop oldest). Shortcuts: ⌘/Ctrl+Z, ⇧⌘/Ctrl+Z.
- Leaving mask mode clears the history; the painted result persists on the
  source.

## Visualization

- Default: composite result **plus** the painted mask as a translucent vermilion
  (accent-color) overlay, so even paint outside the quad is visible.
- 👁 view toggle cycles: vermilion overlay ↔ pure result (true effect) ↔
  mask-only (gray-on-black, to check coverage).

## Toolbar (floating, inside the stage)

Brush size (slider + `[` / `]`), hardness (soft↔hard), paint/erase toggle (hold
**Alt** = temporary erase), undo / redo, view toggle, clear, invert, zoom + Fit.
A brush **ring cursor** follows the pointer at the exact brush radius (with a
center dot); it changes appearance in erase mode.

## State & flow — `src/hooks/useEditor.ts`

- `EditorSource` gains `maskCanvas: HTMLCanvasElement | null`.
- New `maskMode: boolean` in `EditorState` + `setMaskMode`, **mutually exclusive
  with `editable`** (turning one on turns the other off).
- `openPreset`: if `preset.mask`, load the PNG and `drawBaseImage` it into a
  fresh `maskCanvas`; else `maskCanvas = null`.
- `openCustom`: `maskCanvas = null`.
- On first paint, lazily `createMaskCanvas` if null.
- A `MASK_TOUCHED` boolean (set on the first paint, or `true` on entry when a
  preset PNG base was drawn) gates feeding the mask to the renderer — an
  all-black mask is a no-op, so the texture is only fed once `MASK_TOUCHED`.

### Component layout (designed for isolation)

| File | Change | Responsibility |
| --- | --- | --- |
| `src/lib/maskCanvas.ts` | new | Pure brush engine: tip, lighten/darken, interpolation, clear/invert/base |
| `src/hooks/useMaskTool.ts` | new | Mask-mode interaction state: zoom/pan, size, hardness, paint/erase, view, undo/redo stacks, pointer handlers; writes to `source.maskCanvas` ref, calls a refresh callback |
| `src/components/Editor/MaskBrushLayer.tsx` | new | In-stage overlay: pointer capture, ring cursor, zoom/pan transform container, vermilion overlay canvas |
| `src/components/Editor/MaskToolbar.tsx` | new | Floating toolbar UI |
| `src/components/Editor/EditorStage.tsx` | modify | Mount the above in mask mode; apply transform; imperative mask refresh; hide corner handles + compare button; raise backing resolution |
| `src/hooks/useEditor.ts` | modify | `maskCanvas`, `maskMode` + `setMaskMode` (excl. `editable`), preset PNG base, `MASK_TOUCHED` |
| `src/lib/webgl/renderer.ts` | modify | `updateMaskRegion` (texSubImage2D incremental upload) |
| `src/components/Editor/Editor.tsx` | modify | Top-bar "Mask" toggle (preset + custom); export passes `s.maskCanvas` |
| `src/i18n/index.tsx` | modify | New `mask.*` strings (EN/ZH) |
| `src/styles/{ui,app}.css` | modify | Toolbar, ring cursor, vermilion overlay, zoom container — via existing design tokens |

## Edge cases

- Empty mask (all black) = no-op; not fed to the renderer until first paint;
  preset PNG base feeds it on entry.
- `adjust` (corner handles) and `mask` mode are mutually exclusive.
- Switching scenes / back to gallery discards `maskCanvas` with the source.
- Export uses the same mask path → WYSIWYG.
- `premultipliedAlpha:false` + opaque black background keep red-channel semantics
  clean.
- Window resize: zoom is a scale factor relative to fit; pan stored so it
  survives resize; recompute holder size on `ResizeObserver` tick.

## Verification

No test runner (per CLAUDE.md). Plan:

- `maskCanvas.ts` pure logic spot-checked with `npx tsx` where DOM-free.
- Real behavior driven headlessly via the browser harness
  (`memory/browser-testing-harness.md`, needs swiftshader flags): enter mask
  mode on a custom upload, paint over an occluder, confirm the ad is occluded
  live; test erase, undo/redo, zoom/pan precision, soft edge; export the PNG and
  confirm it honors the mask.
