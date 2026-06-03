# Brush Occlusion Mask — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-stage brush tool to paint the WebGL occlusion mask (foreground objects that should stay in front of the inserted ad), for both custom uploads and presets, with precise zoom/pan, soft-hard edges, live preview, and undo/redo.

**Architecture:** The mask is an opaque, black-background offscreen `<canvas>` in background-image space; the existing shader reads its red channel (`alpha *= 1 - mask.r`). A pure brush engine paints white (lighten) / erases (darken) radial-gradient tips into it; the renderer patches the GPU texture incrementally with `texSubImage2D`; a brush-tool hook owns interaction (zoom/pan/undo) and drives live re-render; thin React components host the toolbar and the on-canvas brush layer.

**Tech Stack:** React + Vite + TypeScript, raw WebGL1, Canvas 2D for the mask, framer-motion (existing). No test runner — pure geometry is verified with `npx tsx`; rendering/React is verified with `npm run build` (tsc) + the headless Chrome harness.

**Spec:** `docs/superpowers/specs/2026-06-03-brush-occlusion-mask-design.md`

**Testing note:** This repo has no test runner (per `CLAUDE.md`). Per-task gates are: (a) `npx tsx` assertion scripts for DOM-free pure logic (Task 1), and (b) `npm run build` for type/compile safety on every other task. Behavioral verification is a dedicated headless-browser task at the end (Task 12). Canvas/WebGL/React tasks cannot be unit-tested headlessly here, so they rely on the build gate plus Task 12.

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `src/lib/maskMath.ts` | create | Pure geometry: screen→mask mapping, stroke interpolation, brush gradient stops, dirty-rect math, zoom-toward-cursor, clamps. DOM-free, tsx-testable. |
| `src/lib/maskMath.test.ts` | create | `npx tsx` assertions for `maskMath.ts`. |
| `src/lib/maskCanvas.ts` | create | Canvas 2D ops: create mask canvas, stamp/stroke (lighten/darken), clear, invert, draw base image, crop ImageData. Imports `maskMath`. |
| `src/lib/webgl/renderer.ts` | modify | Add `updateMaskRegion(source,x,y)` (incremental `texSubImage2D`). |
| `src/hooks/useEditor.ts` | modify | `EditorSource.maskCanvas`; `maskMode`/`maskTouched` state; `setMaskMode` (mutually exclusive with `editable`); `ensureMask()`; preset PNG base; export wiring. |
| `src/hooks/useMaskTool.ts` | create | Interaction state + pointer/wheel/keyboard handlers, undo/redo, zoom/pan, overlay repaint, imperative live re-render. |
| `src/components/Editor/MaskBrushLayer.tsx` | create | In-stage pointer-capture overlay + ring cursor. |
| `src/components/Editor/MaskToolbar.tsx` | create | Floating toolbar UI. |
| `src/components/Editor/EditorStage.tsx` | modify | Mount mask layer/toolbar in mask mode; zoom container + overlay canvas; hide handles/compare; raise backing resolution; wire `useMaskTool`. |
| `src/components/Editor/Editor.tsx` | modify | Top-bar "Mask" toggle (preset + custom); export passes `maskCanvas`. |
| `src/i18n/index.tsx` | modify | `mask.*` strings (EN/ZH). |
| `src/styles/ui.css` | modify | Toolbar + ring cursor primitives. |
| `src/styles/app.css` | modify | Zoom container, overlay canvas, mask-mode stage tweaks. |

---

## Task 1: Pure brush math — `maskMath.ts`

**Files:**
- Create: `src/lib/maskMath.ts`
- Test: `src/lib/maskMath.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/maskMath.test.ts`:

```ts
import assert from "node:assert/strict";
import {
  screenToMask,
  interpolateStamps,
  brushStops,
  growRect,
  clampRectToCanvas,
  zoomToward,
  clampZoom,
  clampPan,
} from "./maskMath";

// screenToMask: identity view maps holder fraction to mask px
{
  const holder = { left: 100, top: 50, width: 200, height: 100 };
  const view = { zoom: 1, panX: 0, panY: 0 };
  const p = screenToMask(200, 100, holder, view, 400, 200); // center of holder
  assert.equal(Math.round(p.x), 200);
  assert.equal(Math.round(p.y), 100);
}

// screenToMask: zoom 2 + pan keeps the inverse correct
{
  const holder = { left: 0, top: 0, width: 200, height: 100 };
  const view = { zoom: 2, panX: -100, panY: -50 }; // zoomed into the center
  const p = screenToMask(0, 0, holder, view, 200, 100);
  // local = (0 - (-100))/2 = 50 px of 200 -> 0.25 -> mask 50
  assert.equal(Math.round(p.x), 50);
  assert.equal(Math.round(p.y), 25);
}

// interpolateStamps: count along a 10px line at spacing 5 includes endpoint
{
  const pts = interpolateStamps(0, 0, 10, 0, 5);
  assert.ok(pts.length >= 2);
  const last = pts[pts.length - 1];
  assert.equal(last.x, 10);
  assert.equal(last.y, 0);
}

// interpolateStamps: zero-length still yields the endpoint
{
  const pts = interpolateStamps(3, 4, 3, 4, 5);
  assert.equal(pts.length, 1);
  assert.deepEqual(pts[0], { x: 3, y: 4 });
}

// brushStops: paint = white center -> black edge; erase swaps
{
  const paint = brushStops(0.5, false);
  assert.equal(paint[0].color, "#fff");
  assert.equal(paint[paint.length - 1].color, "#000");
  const erase = brushStops(0.5, true);
  assert.equal(erase[0].color, "#000");
  assert.equal(erase[erase.length - 1].color, "#fff");
  // offsets strictly non-decreasing and within [0,1]
  for (const s of paint) assert.ok(s.offset >= 0 && s.offset <= 1);
}

// growRect: grows a bbox to include a stamp
{
  let r = growRect(null, 10, 10, 5); // x5..15
  assert.deepEqual(r, { x: 5, y: 5, w: 10, h: 10 });
  r = growRect(r, 30, 10, 5); // extends right to 35
  assert.equal(r.x, 5);
  assert.equal(r.w, 30);
}

// clampRectToCanvas: clips to bounds and floors/ceils
{
  const r = clampRectToCanvas({ x: -3.2, y: 2.7, w: 10, h: 4 }, 100, 100);
  assert.equal(r.x, 0);
  assert.equal(r.y, 2);
  assert.ok(r.w > 0 && r.h > 0);
}

// zoomToward: cursor point stays fixed under zoom change
{
  const before = { zoom: 1, panX: 0, panY: 0 };
  const after = zoomToward(before, 2, 100, 50);
  // world under cursor before: (100-0)/1 = 100; after must map back to 100 screen
  const screenX = after.panX + 100 * after.zoom;
  assert.equal(Math.round(screenX), 100);
}

// clampZoom + clampPan bounds
{
  assert.equal(clampZoom(0.2), 1);
  assert.equal(clampZoom(99), 8);
  const v = clampPan({ zoom: 1, panX: 50, panY: -20 }, 200, 100);
  assert.equal(v.panX, 0); // at zoom 1 pan is locked to 0
  assert.equal(v.panY, 0);
}

console.log("maskMath OK");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx src/lib/maskMath.test.ts`
Expected: FAIL — `Cannot find module './maskMath'` (file not created yet).

- [ ] **Step 3: Write the implementation**

Create `src/lib/maskMath.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx src/lib/maskMath.test.ts`
Expected: prints `maskMath OK`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/maskMath.ts src/lib/maskMath.test.ts
git commit -m "feat(mask): pure brush geometry helpers + tsx tests"
```

---

## Task 2: Canvas brush engine — `maskCanvas.ts`

**Files:**
- Create: `src/lib/maskCanvas.ts`

No headless unit test (Canvas 2D needs a browser). Gate: `npm run build`. Behavior verified in Task 12.

- [ ] **Step 1: Write the implementation**

Create `src/lib/maskCanvas.ts`:

```ts
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
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS (no type errors). The module is unused for now; that is fine.

- [ ] **Step 3: Commit**

```bash
git add src/lib/maskCanvas.ts
git commit -m "feat(mask): canvas brush engine (lighten/darken tips, clear/invert/crop)"
```

---

## Task 3: Renderer incremental mask upload

**Files:**
- Modify: `src/lib/webgl/renderer.ts`

- [ ] **Step 1: Add `updateMaskRegion` after `setMask`**

In `src/lib/webgl/renderer.ts`, locate the `setMask` method (ends around line 188) and add this method immediately after it:

```ts
  /**
   * Incrementally upload `source` (its full pixels) into the existing mask
   * texture at (x, y), in mask-canvas pixels. WebGL1 texSubImage2D has no
   * source-rect arg, so callers pass a small scratch canvas already cropped to
   * the dirty region. Requires a prior setMask(canvas) so texMask is full-size.
   */
  updateMaskRegion(source: TexImageSource, x: number, y: number) {
    if (!this.hasMask) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texMask);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS. Method is additive and unused so far.

- [ ] **Step 3: Commit**

```bash
git add src/lib/webgl/renderer.ts
git commit -m "feat(mask): renderer.updateMaskRegion for incremental texSubImage2D"
```

---

## Task 4: Editor state — `maskCanvas`, `maskMode`, `ensureMask`, export wiring

**Files:**
- Modify: `src/hooks/useEditor.ts`
- Modify: `src/components/Editor/EditorStage.tsx` (mask effect only)
- Modify: `src/components/Editor/Editor.tsx` (export call only)

This task replaces the unused `EditorSource.mask: HTMLImageElement | null` with a paintable `maskCanvas`, adds mask-mode state, and keeps everything compiling. No UI to enter mask mode yet.

- [ ] **Step 1: Update imports and the `EditorSource` / `EditorState` types**

In `src/hooks/useEditor.ts`, add the maskCanvas import near the other lib imports (after line 12):

```ts
import { createMaskCanvas, drawBaseImage, type MaskCanvas } from "../lib/maskCanvas";
```

Change `EditorSource.mask` (line 23) from:

```ts
  mask: HTMLImageElement | null;
```

to:

```ts
  maskCanvas: MaskCanvas | null;
```

In `EditorState` (after `editable: boolean;`, line 36) add:

```ts
  maskMode: boolean; // brush mask tool active
  maskTouched: boolean; // mask has content worth feeding to the GPU
```

- [ ] **Step 2: Update `initialState` and the reducer**

In `initialState` (after `editable: false,`) add:

```ts
  maskMode: false,
  maskTouched: false,
```

Add two action variants to the `Action` union (after the `SET_EDITABLE` line):

```ts
  | { type: "SET_MASK_MODE"; value: boolean }
  | { type: "SET_MASK_CANVAS"; mask: MaskCanvas }
```

In the reducer, update `OPEN` to reset the new fields — add these inside the `OPEN` returned object (alongside the other resets like `grade: DEFAULT_GRADE`):

```ts
        maskMode: false,
        maskTouched: false,
```

Update `SET_EDITABLE` to be mutually exclusive with mask mode:

```ts
    case "SET_EDITABLE":
      return { ...state, editable: action.value, maskMode: action.value ? false : state.maskMode };
```

Add the two new cases (after `SET_EDITABLE`):

```ts
    case "SET_MASK_MODE":
      return { ...state, maskMode: action.value, editable: action.value ? false : state.editable };
    case "SET_MASK_CANVAS":
      return state.source
        ? { ...state, source: { ...state.source, maskCanvas: action.mask }, maskTouched: true }
        : state;
```

Update `BACK` — it already spreads `initialState`, so `maskMode`/`maskTouched` reset automatically; no change needed.

- [ ] **Step 3: Update `openPreset` and `openCustom` to use `maskCanvas`**

In `openPreset`, replace the mask line:

```ts
      const mask = preset.mask ? await loadImage(preset.mask) : null;
```

with:

```ts
      let maskCanvas: MaskCanvas | null = null;
      if (preset.mask) {
        const maskImg = await loadImage(preset.mask);
        maskCanvas = createMaskCanvas(bgWidth, bgHeight);
        drawBaseImage(maskCanvas, maskImg);
      }
```

And in the dispatched `source` object replace `mask,` with `maskCanvas,`. Also, because a preset PNG base should count as touched, change that `OPEN` dispatch to set the flag by dispatching a follow-up. Simplest: after the `dispatch({ type: "OPEN", ... })` call in `openPreset`, add:

```ts
      if (maskCanvas) dispatch({ type: "SET_MASK_CANVAS", mask: maskCanvas });
```

Wait — `SET_MASK_CANVAS` reads `state.source`, which is set by `OPEN` in the same batch. React batches these and `state.source` will already be the opened source by the time the second action reduces, because reducers apply sequentially to the accumulated state. This is safe.

In `openCustom`, replace `mask: null,` in the dispatched source with `maskCanvas: null,`.

- [ ] **Step 4: Add `setMaskMode` and `ensureMask` callbacks**

In `useEditor`, after the `setEditable` callback, add:

```ts
  const setMaskMode = useCallback(
    (value: boolean) => dispatch({ type: "SET_MASK_MODE", value }),
    [],
  );
```

`ensureMask` must return the canvas synchronously (the brush paints immediately) while also storing it in state. It reads the latest source via a ref to avoid stale closures. Add a ref near the top of `useEditor` (after `const statsTimer = ...`):

```ts
  const sourceRef = useRef(state.source);
  sourceRef.current = state.source;
```

Then add the callback (after `setMaskMode`):

```ts
  const ensureMask = useCallback((): MaskCanvas | null => {
    const src = sourceRef.current;
    if (!src) return null;
    if (src.maskCanvas) return src.maskCanvas;
    const mask = createMaskCanvas(src.bgWidth, src.bgHeight);
    dispatch({ type: "SET_MASK_CANVAS", mask });
    return mask;
  }, []);
```

Add `setMaskMode` and `ensureMask` to the returned object at the end of `useEditor` (alongside `setEditable`).

- [ ] **Step 5: Fix the EditorStage mask effect**

In `src/components/Editor/EditorStage.tsx`, the component receives `source` but not the touched flag. For now keep the existing effect compiling by reading the canvas. Replace the mask-texture effect (lines 80–83):

```ts
  // mask texture
  useEffect(() => {
    rendererRef.current?.setMask(source.mask);
  }, [source.mask]);
```

with:

```ts
  // mask texture (live painting bypasses this via useMaskTool; this handles
  // initial load, preset base, undo, and source switches)
  useEffect(() => {
    rendererRef.current?.setMask(source.maskCanvas?.canvas ?? null);
  }, [source.maskCanvas]);
```

- [ ] **Step 6: Fix the export call**

In `src/components/Editor/Editor.tsx`, in `handleExport`, replace:

```ts
        mask: s.mask,
```

with:

```ts
        mask: s.maskCanvas?.canvas ?? null,
```

- [ ] **Step 7: Verify build**

Run: `npm run build`
Expected: PASS. No references to `.mask` remain (confirm with: `grep -rn "\.mask\b" src` returns only `maskCanvas`/`setMask` matches, none reading the removed `source.mask`).

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useEditor.ts src/components/Editor/EditorStage.tsx src/components/Editor/Editor.tsx
git commit -m "feat(mask): editor state for paintable maskCanvas + maskMode"
```

---

## Task 5: i18n strings

**Files:**
- Modify: `src/i18n/index.tsx`

- [ ] **Step 1: Add `mask.*` keys to `STRINGS`**

Open `src/i18n/index.tsx`. Find the `STRINGS` object. Add the following entries (place them near the other editor keys; each entry is `key: { en, zh }`). Match the existing formatting exactly:

```ts
  "mask.toggle": { en: "Mask", zh: "蒙版" },
  "mask.exit": { en: "Done", zh: "完成" },
  "mask.hint": {
    en: "Paint over anything that should stay in front of your ad.",
    zh: "把应当遮在广告前面的东西涂出来。",
  },
  "mask.paint": { en: "Paint", zh: "涂抹" },
  "mask.erase": { en: "Erase", zh: "擦除" },
  "mask.size": { en: "Size", zh: "大小" },
  "mask.hardness": { en: "Edge", zh: "软硬" },
  "mask.undo": { en: "Undo", zh: "撤销" },
  "mask.redo": { en: "Redo", zh: "重做" },
  "mask.clear": { en: "Clear", zh: "清空" },
  "mask.invert": { en: "Invert", zh: "反相" },
  "mask.view.overlay": { en: "Overlay", zh: "叠层" },
  "mask.view.result": { en: "Result", zh: "结果" },
  "mask.view.mask": { en: "Mask", zh: "蒙版" },
  "mask.fit": { en: "Fit", zh: "适应" },
```

(The `TKey` type is derived from `STRINGS` keys, so these become valid `t()` keys automatically.)

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/i18n/index.tsx
git commit -m "feat(mask): i18n strings for the mask tool"
```

---

## Task 6: Interaction hook — `useMaskTool.ts`

**Files:**
- Create: `src/hooks/useMaskTool.ts`

This hook owns all mask-mode interaction. It is called by `EditorStage` (Task 9) but is self-contained here. Gate: `npm run build`.

- [ ] **Step 1: Write the hook**

Create `src/hooks/useMaskTool.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { RenderState, Renderer } from "../lib/webgl/renderer";
import type { EditorApi } from "./useEditor";
import { cropImageData, strokeSegment, stampBrush, clearMask, invertMask, type MaskCanvas } from "../lib/maskCanvas";
import {
  clampPan,
  clampRectToCanvas,
  clampZoom,
  growRect,
  screenToMask,
  zoomToward,
  type Rect,
  type ViewTransform,
} from "../lib/maskMath";

export type MaskViewMode = "overlay" | "result" | "mask";

// Vermilion overlay tint — keep in sync with --accent in src/styles/global.css.
const ACCENT = { r: 214, g: 69, b: 47 };
const OVERLAY_ALPHA = 0.5; // peak overlay opacity for the tint view
const UNDO_LIMIT = 30;

interface UndoEntry {
  rect: Rect;
  before: ImageData;
  after: ImageData;
}

export interface UseMaskToolArgs {
  active: boolean;
  api: EditorApi;
  rendererRef: React.RefObject<Renderer | null>;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  holderRef: React.RefObject<HTMLElement | null>;
  displaySize: { w: number; h: number };
  getRenderState: () => RenderState;
}

export interface MaskTool {
  radius: number;
  setRadius: (n: number) => void;
  radiusRange: { min: number; max: number };
  hardness: number;
  setHardness: (n: number) => void;
  erase: boolean;
  setErase: (b: boolean) => void;
  effectiveErase: boolean;
  viewMode: MaskViewMode;
  setViewMode: (m: MaskViewMode) => void;
  view: ViewTransform;
  zoom: number;
  fitView: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  clear: () => void;
  invert: () => void;
  cursor: { x: number; y: number; visible: boolean };
  displayRadius: number;
  spaceHeld: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerLeave: () => void;
  onWheel: (e: React.WheelEvent) => void;
}

export function useMaskTool(args: UseMaskToolArgs): MaskTool {
  const { active, api, rendererRef, overlayRef, holderRef, displaySize, getRenderState } = args;

  const [radius, setRadius] = useState(24);
  const [hardness, setHardness] = useState(0.7);
  const [erase, setErase] = useState(false);
  const [viewMode, setViewModeState] = useState<MaskViewMode>("overlay");
  const [view, setView] = useState<ViewTransform>({ zoom: 1, panX: 0, panY: 0 });
  const [cursor, setCursor] = useState({ x: 0, y: 0, visible: false });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [altHeld, setAltHeld] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // refs that the imperative paint loop reads without re-rendering
  const viewRef = useRef(view);
  viewRef.current = view;
  const radiusRef = useRef(radius);
  radiusRef.current = radius;
  const hardnessRef = useRef(hardness);
  hardnessRef.current = hardness;
  const eraseRef = useRef(erase);
  eraseRef.current = erase;
  const altRef = useRef(altHeld);
  altRef.current = altHeld;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;

  const activeMask = useRef<MaskCanvas | null>(null); // the mask being painted — set synchronously, never stale
  const painting = useRef(false);
  const panning = useRef<null | { sx: number; sy: number; px: number; py: number }>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const beforeFull = useRef<ImageData | null>(null);
  const strokeDirty = useRef<Rect | null>(null);
  const pendingDirty = useRef<Rect | null>(null);
  const rafId = useRef<number | null>(null);
  const uploadedRef = useRef(false);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const undoStack = useRef<UndoEntry[]>([]);
  const redoStack = useRef<UndoEntry[]>([]);

  function getScratch(): HTMLCanvasElement {
    if (!scratchRef.current) scratchRef.current = document.createElement("canvas");
    return scratchRef.current;
  }

  const radiusRange = { min: 2, max: 300 };
  const displayScale = displaySize.w > 0 ? displaySize.w / Math.max(1, getMaskW()) : 1;
  const displayRadius = radius * displayScale * view.zoom;
  const effectiveErase = erase !== altHeld; // Alt toggles erase transiently

  function getMaskW(): number {
    return activeMask.current?.canvas.width ?? displaySize.w;
  }
  function getMaskH(): number {
    return activeMask.current?.canvas.height ?? displaySize.h;
  }

  const refreshUndoFlags = useCallback(() => {
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(redoStack.current.length > 0);
  }, []);

  // Repaint the vermilion/grayscale overlay from the mask, over a region.
  const repaintOverlay = useCallback(
    (mask: HTMLCanvasElement, x: number, y: number, w: number, h: number) => {
      const overlay = overlayRef.current;
      if (!overlay || w <= 0 || h <= 0) return;
      if (overlay.width !== mask.width || overlay.height !== mask.height) {
        overlay.width = mask.width;
        overlay.height = mask.height;
      }
      const octx = overlay.getContext("2d", { willReadFrequently: true })!;
      const mctx = mask.getContext("2d", { willReadFrequently: true })!;
      const md = mctx.getImageData(x, y, w, h);
      const od = octx.createImageData(w, h);
      const showMaskOnly = viewModeRef.current === "mask";
      for (let i = 0; i < w * h; i++) {
        const lum = md.data[i * 4]; // red channel
        const o = i * 4;
        if (showMaskOnly) {
          od.data[o] = lum;
          od.data[o + 1] = lum;
          od.data[o + 2] = lum;
          od.data[o + 3] = 255;
        } else {
          od.data[o] = ACCENT.r;
          od.data[o + 1] = ACCENT.g;
          od.data[o + 2] = ACCENT.b;
          od.data[o + 3] = Math.round(lum * OVERLAY_ALPHA);
        }
      }
      octx.putImageData(od, x, y);
    },
    [overlayRef],
  );

  const ensureUploaded = useCallback(
    (mask: HTMLCanvasElement) => {
      if (uploadedRef.current) return;
      rendererRef.current?.setMask(mask);
      uploadedRef.current = true;
    },
    [rendererRef],
  );

  const renderLive = useCallback(() => {
    rendererRef.current?.render(getRenderState());
  }, [rendererRef, getRenderState]);

  // Push the pending dirty region to the GPU + overlay, then redraw.
  const flushPending = useCallback(() => {
    rafId.current = null;
    const src = activeMask.current;
    const r = pendingDirty.current;
    pendingDirty.current = null;
    if (!src || !r) return;
    const c = clampRectToCanvas(r, src.canvas.width, src.canvas.height);
    if (c.w <= 0 || c.h <= 0) return;
    // crop the dirty region into the scratch canvas for texSubImage2D
    const scratch = getScratch();
    scratch.width = c.w;
    scratch.height = c.h;
    const sctx = scratch.getContext("2d")!;
    sctx.clearRect(0, 0, c.w, c.h);
    sctx.drawImage(src.canvas, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
    ensureUploaded(src.canvas);
    rendererRef.current?.updateMaskRegion(scratch, c.x, c.y);
    repaintOverlay(src.canvas, c.x, c.y, c.w, c.h);
    renderLive();
  }, [api.state.source, ensureUploaded, rendererRef, repaintOverlay, renderLive]);

  const scheduleFlush = useCallback(
    (dirty: Rect) => {
      pendingDirty.current = unionRect(pendingDirty.current, dirty);
      if (rafId.current == null) rafId.current = requestAnimationFrame(flushPending);
    },
    [flushPending],
  );

  // Full re-upload + full overlay repaint + redraw (undo/redo/clear/invert/view).
  const flushFull = useCallback(() => {
    const src = activeMask.current;
    if (!src) return;
    uploadedRef.current = false;
    ensureUploaded(src.canvas);
    repaintOverlay(src.canvas, 0, 0, src.canvas.width, src.canvas.height);
    renderLive();
  }, [api.state.source, ensureUploaded, repaintOverlay, renderLive]);

  const mapPointer = useCallback(
    (e: React.PointerEvent | PointerEvent) => {
      const holder = holderRef.current;
      if (!holder) return null;
      const rect = holder.getBoundingClientRect();
      return screenToMask(e.clientX, e.clientY, rect, viewRef.current, getMaskW(), getMaskH());
    },
    [holderRef], // getMaskW/H read fresh each call
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!active) return;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      // pan with Space or middle mouse
      if (spaceHeld || e.button === 1) {
        panning.current = { sx: e.clientX, sy: e.clientY, px: viewRef.current.panX, py: viewRef.current.panY };
        return;
      }
      const mask = api.ensureMask();
      if (!mask) return;
      activeMask.current = mask;
      uploadedRef.current = false; // re-upload full on stroke start (texture may be stale)
      const p = mapPointer(e);
      if (!p) return;
      // snapshot before-pixels for undo
      beforeFull.current = mask.ctx.getImageData(0, 0, mask.canvas.width, mask.canvas.height);
      strokeDirty.current = null;
      painting.current = true;
      last.current = p;
      const rad = radiusRef.current;
      stampBrush(mask, p.x, p.y, rad, hardnessRef.current, eraseRef.current !== altRef.current);
      strokeDirty.current = growRect(strokeDirty.current, p.x, p.y, rad);
      scheduleFlush({ x: p.x - rad, y: p.y - rad, w: rad * 2, h: rad * 2 });
    },
    [active, spaceHeld, api, mapPointer, scheduleFlush],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!active) return;
      const holder = holderRef.current;
      if (holder) {
        const rect = holder.getBoundingClientRect();
        setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top, visible: true });
      }
      if (panning.current) {
        const d = panning.current;
        const next = clampPan(
          { zoom: viewRef.current.zoom, panX: d.px + (e.clientX - d.sx), panY: d.py + (e.clientY - d.sy) },
          displaySize.w,
          displaySize.h,
        );
        setView(next);
        return;
      }
      if (!painting.current) return;
      const mask = activeMask.current;
      if (!mask || !last.current) return;
      const p = mapPointer(e);
      if (!p) return;
      const rad = radiusRef.current;
      strokeSegment(mask, last.current.x, last.current.y, p.x, p.y, rad, hardnessRef.current, eraseRef.current !== altRef.current);
      const segRect: Rect = {
        x: Math.min(last.current.x, p.x) - rad,
        y: Math.min(last.current.y, p.y) - rad,
        w: Math.abs(p.x - last.current.x) + rad * 2,
        h: Math.abs(p.y - last.current.y) + rad * 2,
      };
      strokeDirty.current = unionRect(strokeDirty.current, segRect);
      last.current = p;
      scheduleFlush(segRect);
    },
    [active, holderRef, displaySize.w, displaySize.h, api.state.source, mapPointer, scheduleFlush],
  );

  const onPointerUp = useCallback(() => {
    panning.current = null;
    if (!painting.current) return;
    painting.current = false;
    const mask = activeMask.current;
    const before = beforeFull.current;
    beforeFull.current = null;
    if (!mask || !before || !strokeDirty.current) return;
    const c = clampRectToCanvas(strokeDirty.current, mask.canvas.width, mask.canvas.height);
    strokeDirty.current = null;
    if (c.w <= 0 || c.h <= 0) return;
    const beforeCrop = cropImageData(before, c.x, c.y, c.w, c.h);
    const afterCrop = mask.ctx.getImageData(c.x, c.y, c.w, c.h);
    undoStack.current.push({ rect: c, before: beforeCrop, after: afterCrop });
    if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
    redoStack.current = [];
    refreshUndoFlags();
  }, [api.state.source, refreshUndoFlags]);

  const onPointerLeave = useCallback(() => {
    setCursor((c) => ({ ...c, visible: false }));
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!active) return;
      const holder = holderRef.current;
      if (!holder) return;
      const rect = holder.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const nextZoom = clampZoom(viewRef.current.zoom * (1 - e.deltaY * 0.0015));
      const next = clampPan(zoomToward(viewRef.current, nextZoom, cx, cy), displaySize.w, displaySize.h);
      setView(next);
    },
    [active, holderRef, displaySize.w, displaySize.h],
  );

  const fitView = useCallback(() => setView({ zoom: 1, panX: 0, panY: 0 }), []);

  const restore = useCallback(
    (from: UndoEntry[], to: UndoEntry[], usingBefore: boolean) => {
      const mask = activeMask.current;
      const entry = from.pop();
      if (!mask || !entry) return;
      const img = usingBefore ? entry.before : entry.after;
      mask.ctx.putImageData(img, entry.rect.x, entry.rect.y);
      to.push(entry);
      refreshUndoFlags();
      flushFull();
    },
    [api.state.source, refreshUndoFlags, flushFull],
  );

  const undo = useCallback(() => restore(undoStack.current, redoStack.current, true), [restore]);
  const redo = useCallback(() => restore(redoStack.current, undoStack.current, false), [restore]);

  const pushWholeCanvasUndo = useCallback(
    (mutate: (mask: MaskCanvas) => void) => {
      const mask = api.ensureMask();
      if (!mask) return;
      activeMask.current = mask;
      const before = mask.ctx.getImageData(0, 0, mask.canvas.width, mask.canvas.height);
      mutate(mask);
      const after = mask.ctx.getImageData(0, 0, mask.canvas.width, mask.canvas.height);
      undoStack.current.push({
        rect: { x: 0, y: 0, w: mask.canvas.width, h: mask.canvas.height },
        before,
        after,
      });
      if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
      redoStack.current = [];
      refreshUndoFlags();
      flushFull();
    },
    [api, refreshUndoFlags, flushFull],
  );

  const clear = useCallback(() => {
    pushWholeCanvasUndo((m) => clearMask(m));
  }, [pushWholeCanvasUndo]);

  const invert = useCallback(() => {
    pushWholeCanvasUndo((m) => invertMask(m));
  }, [pushWholeCanvasUndo]);

  const setViewMode = useCallback(
    (m: MaskViewMode) => {
      setViewModeState(m);
      viewModeRef.current = m;
      // repaint overlay in the new style
      const mask = activeMask.current;
      if (mask) repaintOverlay(mask.canvas, 0, 0, mask.canvas.width, mask.canvas.height);
    },
    [api.state.source, repaintOverlay],
  );

  // keyboard: space (pan), [ ] (size), alt (erase), cmd/ctrl+z, shift+cmd/ctrl+z
  useEffect(() => {
    if (!active) return;
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setSpaceHeld(true);
        e.preventDefault();
      } else if (e.key === "Alt") {
        setAltHeld(true);
      } else if (e.key === "[") {
        setRadius((r) => Math.max(2, Math.round(r * 0.8)));
      } else if (e.key === "]") {
        setRadius((r) => Math.min(300, Math.round(r * 1.25) + 1));
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
      if (e.key === "Alt") setAltHeld(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [active, undo, redo]);

  // reset transient state + history when leaving mask mode
  useEffect(() => {
    if (active) return;
    undoStack.current = [];
    redoStack.current = [];
    uploadedRef.current = false;
    painting.current = false;
    panning.current = null;
    setView({ zoom: 1, panX: 0, panY: 0 });
    setCanUndo(false);
    setCanRedo(false);
  }, [active]);

  // keep the active-mask ref in sync with the source's mask canvas (covers
  // source switches and the lazy first-create path)
  useEffect(() => {
    activeMask.current = api.state.source?.maskCanvas ?? null;
  }, [api.state.source?.maskCanvas]);

  return {
    radius,
    setRadius,
    radiusRange,
    hardness,
    setHardness,
    erase,
    setErase,
    effectiveErase,
    viewMode,
    setViewMode,
    view,
    zoom: view.zoom,
    fitView,
    canUndo,
    canRedo,
    undo,
    redo,
    clear,
    invert,
    cursor,
    displayRadius,
    spaceHeld,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    onWheel,
  };
}

// Local helper (kept here to avoid widening the maskMath surface): precise union.
function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.w, b.x + b.w);
  const bottom = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: right - x, h: bottom - y };
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS. The hook is unused so far. If tsc complains that `EditorApi` lacks `ensureMask`/`setMaskMode`, re-check Task 4 Step 4.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useMaskTool.ts
git commit -m "feat(mask): useMaskTool interaction hook (paint/erase/zoom/pan/undo)"
```

---

## Task 7: Brush layer component — `MaskBrushLayer.tsx`

**Files:**
- Create: `src/components/Editor/MaskBrushLayer.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/Editor/MaskBrushLayer.tsx`:

```tsx
import type { MaskTool } from "../../hooks/useMaskTool";

/**
 * Full-holder overlay that captures brush pointer/wheel events and draws the
 * brush ring cursor. Sits ON TOP of the (transformed) zoom container, but is
 * itself untransformed so the cursor stays crisp and circular at any zoom.
 */
export function MaskBrushLayer({ tool }: { tool: MaskTool }) {
  const cursorStyle: React.CSSProperties = {
    left: tool.cursor.x,
    top: tool.cursor.y,
    width: Math.max(6, tool.displayRadius * 2),
    height: Math.max(6, tool.displayRadius * 2),
    display: tool.cursor.visible && !tool.spaceHeld ? "block" : "none",
  };

  return (
    <div
      className="mask-layer"
      data-erase={tool.effectiveErase}
      data-pan={tool.spaceHeld}
      onPointerDown={tool.onPointerDown}
      onPointerMove={tool.onPointerMove}
      onPointerUp={tool.onPointerUp}
      onPointerCancel={tool.onPointerUp}
      onPointerLeave={tool.onPointerLeave}
      onWheel={tool.onWheel}
    >
      <span className="mask-cursor" style={cursorStyle} />
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/Editor/MaskBrushLayer.tsx
git commit -m "feat(mask): MaskBrushLayer pointer-capture overlay + ring cursor"
```

---

## Task 8: Toolbar component — `MaskToolbar.tsx`

**Files:**
- Create: `src/components/Editor/MaskToolbar.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/Editor/MaskToolbar.tsx`:

```tsx
import type { MaskTool, MaskViewMode } from "../../hooks/useMaskTool";
import { useI18n } from "../../i18n";

const VIEW_MODES: MaskViewMode[] = ["overlay", "result", "mask"];

export function MaskToolbar({ tool }: { tool: MaskTool }) {
  const { t } = useI18n();
  const viewKey = (m: MaskViewMode) =>
    m === "overlay" ? "mask.view.overlay" : m === "result" ? "mask.view.result" : "mask.view.mask";

  return (
    <div className="mask-toolbar" onPointerDown={(e) => e.stopPropagation()}>
      <div className="mt-group">
        <button
          type="button"
          className={`mt-btn ${!tool.erase ? "is-active" : ""}`}
          onClick={() => tool.setErase(false)}
        >
          {t("mask.paint")}
        </button>
        <button
          type="button"
          className={`mt-btn ${tool.erase ? "is-active" : ""}`}
          onClick={() => tool.setErase(true)}
        >
          {t("mask.erase")}
        </button>
      </div>

      <label className="mt-slider">
        <span>{t("mask.size")}</span>
        <input
          type="range"
          min={tool.radiusRange.min}
          max={tool.radiusRange.max}
          value={tool.radius}
          onChange={(e) => tool.setRadius(Number(e.target.value))}
        />
      </label>

      <label className="mt-slider">
        <span>{t("mask.hardness")}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={tool.hardness}
          onChange={(e) => tool.setHardness(Number(e.target.value))}
        />
      </label>

      <div className="mt-group">
        <button type="button" className="mt-btn" disabled={!tool.canUndo} onClick={tool.undo}>
          ↺ {t("mask.undo")}
        </button>
        <button type="button" className="mt-btn" disabled={!tool.canRedo} onClick={tool.redo}>
          ↻ {t("mask.redo")}
        </button>
      </div>

      <div className="mt-group">
        <button type="button" className="mt-btn" onClick={tool.clear}>
          {t("mask.clear")}
        </button>
        <button type="button" className="mt-btn" onClick={tool.invert}>
          {t("mask.invert")}
        </button>
      </div>

      <div className="mt-group">
        {VIEW_MODES.map((m) => (
          <button
            key={m}
            type="button"
            className={`mt-btn ${tool.viewMode === m ? "is-active" : ""}`}
            onClick={() => tool.setViewMode(m)}
          >
            {t(viewKey(m))}
          </button>
        ))}
      </div>

      <div className="mt-group">
        <span className="mt-zoom">{Math.round(tool.zoom * 100)}%</span>
        <button type="button" className="mt-btn" onClick={tool.fitView}>
          {t("mask.fit")}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/Editor/MaskToolbar.tsx
git commit -m "feat(mask): MaskToolbar UI"
```

---

## Task 9: Wire the mask tool into `EditorStage`

**Files:**
- Modify: `src/components/Editor/EditorStage.tsx`

- [ ] **Step 1: Add imports**

At the top of `src/components/Editor/EditorStage.tsx`, add:

```ts
import { useMaskTool } from "../../hooks/useMaskTool";
import { MaskBrushLayer } from "./MaskBrushLayer";
import { MaskToolbar } from "./MaskToolbar";
import type { EditorApi } from "../../hooks/useEditor";
```

- [ ] **Step 2: Add props for mask mode**

`EditorStage` currently takes individual props. Add `api`, `maskMode`, and `maskTouched` to the prop list (so the stage can call `useMaskTool` and gate the mask texture). Update the destructured params and the type:

Add to the props type (after `editable: boolean;`):

```ts
  api: EditorApi;
  maskMode: boolean;
  maskTouched: boolean;
```

Add `api, maskMode, maskTouched,` to the destructuring in the function signature.

- [ ] **Step 3: Add refs and the overlay/holder wiring**

After `const canvasRef = useRef<HTMLCanvasElement>(null);` add:

```ts
  const holderRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
```

- [ ] **Step 4: Provide a stable getRenderState and call useMaskTool**

After the existing refs/state declarations (e.g. after the `compare` state), add a render-state getter and the hook call:

```ts
  const getRenderState = (): RenderState => ({
    corners: source.corners,
    hasUser: !!userImage,
    srcStats,
    tgtStats,
    grade,
    blend,
    seed,
  });

  const tool = useMaskTool({
    active: maskMode && size.w > 0,
    api,
    rendererRef,
    overlayRef,
    holderRef,
    displaySize: { w: size.w, h: size.h },
    getRenderState,
  });
```

- [ ] **Step 5: Gate the mask texture on maskTouched**

Replace the mask-texture effect from Task 4 Step 5 with one that respects the touched flag (so an empty mask is never fed):

```ts
  // mask texture (live painting bypasses this via useMaskTool; this handles
  // initial load, preset base, undo, view switches, and source changes)
  useEffect(() => {
    const canvas = maskTouched ? source.maskCanvas?.canvas ?? null : null;
    rendererRef.current?.setMask(canvas);
  }, [source.maskCanvas, maskTouched]);
```

- [ ] **Step 6: Raise backing resolution in mask mode + include in draw deps**

Replace the draw effect's `dpr`/`resize` lines. Find:

```ts
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    r.resize(Math.round(size.w * dpr), Math.round(size.h * dpr));
```

Replace with:

```ts
    const baseDpr = Math.min(window.devicePixelRatio || 1, 2);
    // In mask mode, supersample so the CSS-zoomed preview stays reasonably sharp.
    const superscale = maskMode ? Math.min(Math.max(tool.zoom, 1), 3) : 1;
    const dpr = Math.min(baseDpr * superscale, 4);
    r.resize(Math.round(size.w * dpr), Math.round(size.h * dpr));
```

Add `maskMode` and `tool.zoom` to that effect's dependency array (append to the existing deps list).

- [ ] **Step 7: Update the JSX — zoom container, overlay, layer, toolbar, gated handles/compare**

Replace the `stage-canvas-holder` block. The current block is:

```tsx
        <div
          className="stage-canvas-holder"
          style={{ width: size.w || undefined, height: size.h || undefined }}
        >
          <canvas ref={canvasRef} style={{ width: size.w, height: size.h }} />
          {editable && size.w > 0 && (
            <CornerHandles corners={source.corners} onChange={onCorners} />
          )}
          {userImage && size.w > 0 && (
            <button
              type="button"
              className="stage-compare"
              onPointerDown={() => setCompare(true)}
              onPointerUp={() => setCompare(false)}
              onPointerLeave={() => setCompare(false)}
              onPointerCancel={() => setCompare(false)}
              aria-pressed={compare}
            >
              {t("stage.compare")}
            </button>
          )}
          <div className="stage-drop">
            <span className="label">{userImage ? t("drop.place") : t("drop.empty")}</span>
          </div>
        </div>
```

Replace it with:

```tsx
        <div
          className="stage-canvas-holder"
          ref={holderRef}
          data-mask={maskMode}
          style={{ width: size.w || undefined, height: size.h || undefined }}
        >
          <div
            className="stage-zoom"
            style={
              maskMode
                ? {
                    transform: `translate(${tool.view.panX}px, ${tool.view.panY}px) scale(${tool.view.zoom})`,
                    transformOrigin: "0 0",
                  }
                : undefined
            }
          >
            <canvas ref={canvasRef} style={{ width: size.w, height: size.h }} />
            <canvas
              ref={overlayRef}
              className="mask-overlay"
              style={{
                width: size.w,
                height: size.h,
                display: maskMode && tool.viewMode !== "result" ? "block" : "none",
              }}
            />
          </div>
          {editable && !maskMode && size.w > 0 && (
            <CornerHandles corners={source.corners} onChange={onCorners} />
          )}
          {userImage && !maskMode && size.w > 0 && (
            <button
              type="button"
              className="stage-compare"
              onPointerDown={() => setCompare(true)}
              onPointerUp={() => setCompare(false)}
              onPointerLeave={() => setCompare(false)}
              onPointerCancel={() => setCompare(false)}
              aria-pressed={compare}
            >
              {t("stage.compare")}
            </button>
          )}
          {maskMode && size.w > 0 && <MaskBrushLayer tool={tool} />}
          {!maskMode && (
            <div className="stage-drop">
              <span className="label">{userImage ? t("drop.place") : t("drop.empty")}</span>
            </div>
          )}
        </div>
        {maskMode && size.w > 0 && <MaskToolbar tool={tool} />}
```

(The `MaskToolbar` is placed inside `.stage-frame`, after the holder, so it floats over the stage; CSS in Task 11 positions it.)

- [ ] **Step 8: Verify build**

Run: `npm run build`
Expected: PASS. `EditorStage` now requires `api`, `maskMode`, `maskTouched` — the `Editor` call site is updated in Task 10, so a temporary tsc error there is expected until Task 10. To keep this task green, also do Task 10 Step 1 now if running tasks strictly sequentially; otherwise verify build after Task 10. (Recommended: run Task 10 Step 1 before building.)

- [ ] **Step 9: Commit**

```bash
git add src/components/Editor/EditorStage.tsx
git commit -m "feat(mask): mount mask tool/overlay/zoom in EditorStage"
```

---

## Task 10: Top-bar toggle + pass-through in `Editor`

**Files:**
- Modify: `src/components/Editor/Editor.tsx`

- [ ] **Step 1: Pass the new props to EditorStage**

In `src/components/Editor/Editor.tsx`, pull `setMaskMode` from the api destructuring at the top (add to the existing list):

```ts
    setMaskMode,
```

Update the `<EditorStage ... />` usage to pass the new props (add these three lines among its props):

```tsx
          api={api}
          maskMode={state.maskMode}
          maskTouched={state.maskTouched}
```

- [ ] **Step 2: Add the "Mask" toggle to the top bar**

In the `editor-bar-right` block, the current content is:

```tsx
          {canAdjust && (
            <Button variant="ghost" onClick={() => setEditable(!state.editable)}>
              {state.editable ? t("editor.lock") : t("editor.adjust")}
            </Button>
          )}
          <LangToggle />
```

Replace it with (the mask toggle is available for BOTH preset and custom — no `canAdjust` gate):

```tsx
          {canAdjust && (
            <Button variant="ghost" onClick={() => setEditable(!state.editable)}>
              {state.editable ? t("editor.lock") : t("editor.adjust")}
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => setMaskMode(!state.maskMode)}
          >
            {state.maskMode ? t("mask.exit") : t("mask.toggle")}
          </Button>
          <LangToggle />
```

- [ ] **Step 3: Show the mask hint when in mask mode**

In the sidebar image panel, there is a line `{state.editable && <p className="panel-note">{t("corner.note")}</p>}`. Add a sibling for mask mode right after it:

```tsx
            {state.maskMode && <p className="panel-note">{t("mask.hint")}</p>}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: PASS (this resolves the EditorStage prop requirements from Task 9).

- [ ] **Step 5: Commit**

```bash
git add src/components/Editor/Editor.tsx
git commit -m "feat(mask): top-bar Mask toggle for presets + custom"
```

---

## Task 11: Styles

**Files:**
- Modify: `src/styles/app.css`
- Modify: `src/styles/ui.css`

- [ ] **Step 1: Add stage/overlay/cursor styles to `app.css`**

Append to `src/styles/app.css`:

```css
/* ---- Mask tool: zoom container, overlay, cursor ---- */
.stage-zoom {
  position: absolute;
  inset: 0;
  will-change: transform;
}
.stage-zoom > canvas {
  position: absolute;
  top: 0;
  left: 0;
}
.mask-overlay {
  pointer-events: none;
  image-rendering: auto;
}
.stage-canvas-holder[data-mask="true"] {
  cursor: none;
  overflow: hidden;
}
.mask-layer {
  position: absolute;
  inset: 0;
  z-index: 5;
  touch-action: none;
}
.mask-layer[data-pan="true"] {
  cursor: grab;
}
.mask-cursor {
  position: absolute;
  transform: translate(-50%, -50%);
  border: 1.5px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55);
  border-radius: 50%;
  pointer-events: none;
}
.mask-layer[data-erase="true"] .mask-cursor {
  border-color: var(--accent);
  border-style: dashed;
}
```

- [ ] **Step 2: Add toolbar styles to `ui.css`**

Append to `src/styles/ui.css`:

```css
/* ---- Mask toolbar ---- */
.mask-toolbar {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  z-index: 6;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
  padding: 8px 12px;
  max-width: calc(100% - 28px);
  background: color-mix(in srgb, var(--paper) 86%, transparent);
  backdrop-filter: blur(8px);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.14);
}
.mask-toolbar .mt-group {
  display: inline-flex;
  gap: 4px;
}
.mask-toolbar .mt-btn {
  font: inherit;
  font-size: 12px;
  padding: 5px 9px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: transparent;
  color: var(--ink);
  cursor: pointer;
}
.mask-toolbar .mt-btn:hover {
  border-color: var(--ink-soft, var(--ink));
}
.mask-toolbar .mt-btn.is-active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.mask-toolbar .mt-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.mask-toolbar .mt-slider {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ink);
}
.mask-toolbar .mt-slider input[type="range"] {
  width: 92px;
}
.mask-toolbar .mt-zoom {
  font-size: 12px;
  color: var(--ink);
  min-width: 38px;
  text-align: right;
}
```

> If `--paper`, `--line`, `--ink`, or `--accent` are named differently in `src/styles/global.css`, substitute the actual token names. Check with `grep -nE -- '--(paper|line|ink|accent)' src/styles/global.css` before writing, and adjust.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/styles/app.css src/styles/ui.css
git commit -m "feat(mask): styles for mask toolbar, overlay, and ring cursor"
```

---

## Task 12: Headless browser verification

**Files:** none (verification only)

Follow `memory/browser-testing-harness.md` for launching headless Chrome with the swiftshader flags this repo needs.

- [ ] **Step 1: Build and serve**

Run:
```bash
npm run build && npm run preview
```
Expected: preview server starts (note the URL/port).

- [ ] **Step 2: Drive the app over the DevTools Protocol**

Per the harness, automate this sequence and capture screenshots at each step:

1. Open the app, enter **custom** mode, upload a test photo that has an obvious foreground object crossing the ad region (e.g. a pole). Set the four corners so the quad overlaps the object.
2. Upload a user image so the ad composites onto the surface (confirm the ad currently paints OVER the pole — the bug we're fixing).
3. Click **Mask** in the top bar. Confirm: corner handles + compare button disappear; the toolbar appears; the ring cursor follows the pointer.
4. Paint over the pole. Confirm: the ad is occluded there live (the pole shows through), and a vermilion overlay marks the painted area.
5. Toggle the view button through **Result** (overlay hidden, pure composite) and **Mask** (grayscale coverage), then back to **Overlay**.
6. Test **Erase** (and holding Alt while painting), **Undo**/**Redo** (and ⌘/Ctrl+Z), **Clear**, **Invert**.
7. Scroll to **zoom** in toward the cursor; hold **Space** and drag to **pan**; trace the pole edge at high zoom; click **Fit** to reset.
8. Adjust **Size** and **Edge** sliders; confirm soft edge produces a feathered occlusion boundary.
9. Click **Export PNG**. Open the downloaded file and confirm the occlusion is baked in at full resolution (pole in front of the ad).
10. Repeat the core flow once in a **preset** scene to confirm the toggle works there too.

- [ ] **Step 3: Record results**

Expected outcomes — note any deviation:
- Painting updates the composite at ~60fps with no gaps on fast strokes.
- Soft edges yield feathered occlusion; hard edges yield crisp.
- Undo/redo restore exactly; clear/invert work; history clears on exiting mask mode.
- Zoom/pan keep brush precision (cursor maps to the same mask pixel regardless of zoom).
- Exported PNG matches the on-screen result (WYSIWYG).

- [ ] **Step 4: Commit any fixes**

If issues are found, fix them in the relevant module and re-run Step 2. Commit fixes with descriptive messages. When all checks pass, the feature is complete.

---

## Notes for the implementer

- **Coordinate origin is load-bearing:** `.stage-zoom` MUST use `transform-origin: 0 0` — the `screenToMask` inverse assumes a top-left origin. A centered origin will misplace every brush stroke.
- **Texture orientation:** the mask is uploaded with no Y-flip (matching the background and user textures), so the canvas's top-left origin aligns with the shader's top-left `v_uv`. Do not add `UNPACK_FLIP_Y_WEBGL = true`.
- **Don't lose the live context:** never call `renderer.dispose(true)` on the live canvas (existing gotcha in `CLAUDE.md`).
- **Performance:** live strokes upload only the dirty rect via `texSubImage2D`; undo/redo/clear/invert/view-change do a full re-upload + overlay repaint (rare, acceptable).
- **Accent color:** `ACCENT` in `useMaskTool.ts` duplicates the vermilion `--accent`; if the token changes, update both.
```
