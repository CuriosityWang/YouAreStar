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

// Vermilion overlay tint — keep in sync with --vermilion (#d23c25) in src/styles/global.css.
const ACCENT = { r: 0xd2, g: 0x3c, b: 0x25 };
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
  /** when true, show the brush ring centered on the canvas (e.g. while a size/
   *  edge slider is being dragged and the pointer is off the canvas). */
  previewing: boolean;
  setPreviewing: (b: boolean) => void;
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
  const [previewing, setPreviewing] = useState(false);
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
  // multi-touch: every live pointer (used to detect a 2-finger gesture) and the
  // pinch state while two touches are zooming/panning the stage.
  const activePointers = useRef<Map<number, { x: number; y: number; type: string }>>(new Map());
  const pinch = useRef<
    | null
    | { id1: number; id2: number; startDist: number; startMidX: number; startMidY: number; startView: ViewTransform }
  >(null);

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

  // Roll back an in-progress single-finger stroke when a 2nd finger lands (pinch):
  // restore the pre-stroke pixels, cancel the queued GPU flush, and drop the stroke
  // state so no stray dab is committed to history.
  const abortStroke = useCallback(() => {
    if (rafId.current != null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    pendingDirty.current = null;
    const mask = activeMask.current;
    const before = beforeFull.current;
    painting.current = false;
    panning.current = null;
    last.current = null;
    strokeDirty.current = null;
    beforeFull.current = null;
    if (mask && before) {
      mask.ctx.putImageData(before, 0, 0);
      uploadedRef.current = false;
      flushFull();
    }
  }, [flushFull]);

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
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
      // already pinching: ignore any further fingers so they can't start a stray stroke
      if (pinch.current) return;
      // a 2nd touch turns an in-progress paint into a pinch-zoom / two-finger pan
      let touchCount = 0;
      activePointers.current.forEach((p) => {
        if (p.type === "touch") touchCount++;
      });
      if (e.pointerType === "touch" && touchCount === 2) {
        abortStroke(); // discard the first finger's dab — this gesture is a pinch, not a stroke
        const pts: { id: number; x: number; y: number }[] = [];
        activePointers.current.forEach((p, id) => {
          if (p.type === "touch") pts.push({ id, x: p.x, y: p.y });
        });
        const [a, b] = pts;
        if (!a || !b) return;
        // Capture BOTH fingers to the layer (finger 1 already is, from the paint
        // path; capture finger 2 too). This guarantees every up/cancel is delivered
        // here even if a finger lifts off-element — otherwise a lost up would leave a
        // stale pointer in the map that makes the next single-finger touch read as a
        // pinch, wedging painting until mask mode is toggled.
        try {
          (e.target as Element).setPointerCapture?.(e.pointerId);
        } catch {
          /* ignore */
        }
        const rect = holderRef.current?.getBoundingClientRect();
        pinch.current = {
          id1: a.id,
          id2: b.id,
          startDist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
          startMidX: (a.x + b.x) / 2 - (rect?.left ?? 0),
          startMidY: (a.y + b.y) / 2 - (rect?.top ?? 0),
          startView: { ...viewRef.current },
        };
        setCursor((c) => ({ ...c, visible: false }));
        return;
      }
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
    [active, spaceHeld, api, mapPointer, scheduleFlush, abortStroke, holderRef],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!active) return;
      const tracked = activePointers.current.get(e.pointerId);
      if (tracked) {
        tracked.x = e.clientX;
        tracked.y = e.clientY;
      }
      // two-finger pinch: zoom toward the gesture midpoint, pan with its drift.
      // Reuses the exact wheel-zoom primitives so feel + clamping match.
      if (pinch.current) {
        const a = activePointers.current.get(pinch.current.id1);
        const b = activePointers.current.get(pinch.current.id2);
        const ph = holderRef.current;
        if (!a || !b || !ph) return;
        const r = ph.getBoundingClientRect();
        const liveDist = Math.hypot(b.x - a.x, b.y - a.y);
        const nextZoom = clampZoom(pinch.current.startView.zoom * (liveDist / pinch.current.startDist));
        const cx = (a.x + b.x) / 2 - r.left;
        const cy = (a.y + b.y) / 2 - r.top;
        // Anchor the zoom at the START midpoint, then add the live midpoint drift
        // below. Anchoring at the LIVE midpoint instead would double-count the pan
        // during a simultaneous zoom+move, sliding the image out from under the
        // fingers by drift*(zoomRatio-1).
        const zoomed = zoomToward(pinch.current.startView, nextZoom, pinch.current.startMidX, pinch.current.startMidY);
        const next = clampPan(
          {
            zoom: zoomed.zoom,
            panX: zoomed.panX + (cx - pinch.current.startMidX),
            panY: zoomed.panY + (cy - pinch.current.startMidY),
          },
          displaySize.w,
          displaySize.h,
        );
        setView(next);
        return;
      }
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

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    activePointers.current.delete(e.pointerId);
    // a pinch ends when either of its two fingers lifts; the stroke was already
    // aborted, so just clear pinch state without resuming paint.
    if (pinch.current && (e.pointerId === pinch.current.id1 || e.pointerId === pinch.current.id2)) {
      pinch.current = null;
      panning.current = null;
      return;
    }
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
    setPreviewing(false);
    activePointers.current.clear();
    pinch.current = null;
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
    previewing,
    setPreviewing,
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
