import { useEffect, useRef, useState } from "react";
import type { Corners } from "../../data/presets";
import {
  MAX_CROP_ZOOM,
  MIN_CROP_ZOOM,
  clampCrop,
  coverSpan,
  cropWindow,
  zoomAtSurface,
  type CropParams,
  type CropWindow,
} from "../../lib/crop";
import { applyMat3, destToSourceUV, type Quad } from "../../lib/homography";
import type { ViewTransform } from "../../lib/maskMath";
import { useI18n } from "../../i18n";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface CropDrag {
  pointerId: number;
  startU: number;
  startV: number;
  centerX: number;
  centerY: number;
  spanX: number;
  spanY: number;
}

interface CropPinch {
  id1: number;
  id2: number;
  startDist: number;
  startZoom: number;
  startFlipH: boolean;
  startU: number; // start centroid in surface UV
  startV: number;
  window: CropWindow;
}

export function CropOverlay({
  corners,
  crop,
  bgWidth,
  bgHeight,
  userWidth,
  userHeight,
  view,
  onChange,
  onReset,
}: {
  corners: Corners;
  crop: CropParams;
  bgWidth: number;
  bgHeight: number;
  userWidth: number;
  userHeight: number;
  /** workspace pan/zoom of the stage (applied so the dashed outline tracks the
   *  CSS-zoomed canvas); identity = no workspace zoom. */
  view: ViewTransform;
  onChange: (patch: Partial<CropParams>) => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);
  const surfaceRef = useRef<SVGPolygonElement>(null);
  const dragRef = useRef<CropDrag | null>(null);
  const pinchRef = useRef<CropPinch | null>(null);
  const pointers = useRef<Map<number, { x: number; y: number; type: string }>>(new Map());
  const [hinted, setHinted] = useState(false);
  const poly = corners.map(([x, y]) => `${x * 100},${y * 100}`).join(" ");

  // screen px -> surface UV (0..1 across the ad quad). getBoundingClientRect
  // already reflects the workspace CSS transform, so this stays correct when the
  // stage is zoomed.
  function surfacePoint(clientX: number, clientY: number): [number, number] | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const bgUV: [number, number] = [
      (clientX - rect.left) / rect.width,
      (clientY - rect.top) / rect.height,
    ];
    try {
      return applyMat3(destToSourceUV(corners as unknown as Quad), bgUV);
    } catch {
      return null;
    }
  }

  function win(): CropWindow {
    return cropWindow(crop, corners, bgWidth, bgHeight, userWidth, userHeight);
  }

  // zoom toward a surface anchor (cursor / pinch centroid); 0.5,0.5 = centered.
  function applyZoom(nextZoom: number, su = 0.5, sv = 0.5) {
    onChange(
      zoomAtSurface(
        crop,
        corners,
        bgWidth,
        bgHeight,
        userWidth,
        userHeight,
        clamp(nextZoom, MIN_CROP_ZOOM, MAX_CROP_ZOOM),
        su,
        sv,
      ),
    );
  }

  // Wheel zoom needs a NON-passive listener so preventDefault actually stops the
  // page from scrolling (React's synthetic onWheel is passive — preventDefault
  // there both no-ops and logs a console error). A ref holds the latest closure
  // so the listener binds once but always sees current crop/corners.
  const wheelFn = useRef<(e: WheelEvent) => void>(() => {});
  wheelFn.current = (e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    const s = surfacePoint(e.clientX, e.clientY);
    applyZoom(crop.zoom * factor, s?.[0] ?? 0.5, s?.[1] ?? 0.5);
  };
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => wheelFn.current(e);
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  function nudge(dx: number, dy: number) {
    onChange(
      clampCrop(
        { ...crop, centerX: crop.centerX + dx, centerY: crop.centerY + dy },
        corners,
        bgWidth,
        bgHeight,
        userWidth,
        userHeight,
      ),
    );
  }

  function onPointerDown(e: React.PointerEvent<SVGPolygonElement>) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    if (pinchRef.current) return;

    // a 2nd touch turns the gesture into a pinch-zoom (crop.zoom) + two-finger pan
    let touches = 0;
    pointers.current.forEach((p) => {
      if (p.type === "touch") touches++;
    });
    if (e.pointerType === "touch" && touches === 2) {
      const pts: { id: number; x: number; y: number }[] = [];
      pointers.current.forEach((p, id) => {
        if (p.type === "touch") pts.push({ id, x: p.x, y: p.y });
      });
      const [a, b] = pts;
      if (!a || !b) return;
      const mid = surfacePoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      if (!mid) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      dragRef.current = null; // discard the first finger's pan — this is a pinch
      pinchRef.current = {
        id1: a.id,
        id2: b.id,
        startDist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
        startZoom: crop.zoom,
        startFlipH: crop.flipH,
        startU: mid[0],
        startV: mid[1],
        window: win(),
      };
      setHinted(true);
      return;
    }

    const point = surfacePoint(e.clientX, e.clientY);
    if (!point) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const w = win();
    dragRef.current = {
      pointerId: e.pointerId,
      startU: point[0],
      startV: point[1],
      centerX: w.centerX,
      centerY: w.centerY,
      spanX: w.spanX,
      spanY: w.spanY,
    };
    setHinted(true);
  }

  function onPointerMove(e: React.PointerEvent<SVGPolygonElement>) {
    const tracked = pointers.current.get(e.pointerId);
    if (tracked) {
      tracked.x = e.clientX;
      tracked.y = e.clientY;
    }

    const pinch = pinchRef.current;
    if (pinch) {
      const a = pointers.current.get(pinch.id1);
      const b = pointers.current.get(pinch.id2);
      if (!a || !b) return;
      e.preventDefault();
      const liveDist = Math.hypot(b.x - a.x, b.y - a.y);
      const nextZoom = clamp(
        pinch.startZoom * (liveDist / pinch.startDist),
        MIN_CROP_ZOOM,
        MAX_CROP_ZOOM,
      );
      // Everything derives from the pinch-START snapshot (no compounding):
      // anchored zoom at the start centroid, then add the live centroid drift.
      const [nx, ny] = coverSpan(corners, bgWidth, bgHeight, userWidth, userHeight, nextZoom);
      const fx = pinch.startFlipH ? -1 : 1;
      let cx = pinch.window.centerX + (pinch.startU - 0.5) * (pinch.window.spanX - nx) * fx;
      let cy = pinch.window.centerY + (pinch.startV - 0.5) * (pinch.window.spanY - ny);
      const liveMid = surfacePoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      if (liveMid) {
        cx -= (liveMid[0] - pinch.startU) * nx * fx;
        cy -= (liveMid[1] - pinch.startV) * ny;
      }
      onChange(
        clampCrop(
          { zoom: nextZoom, centerX: cx, centerY: cy, flipH: pinch.startFlipH },
          corners,
          bgWidth,
          bgHeight,
          userWidth,
          userHeight,
        ),
      );
      return;
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const point = surfacePoint(e.clientX, e.clientY);
    if (!point) return;
    e.preventDefault();
    const fx = crop.flipH ? -1 : 1;
    const next = clampCrop(
      {
        ...crop,
        centerX: drag.centerX - (point[0] - drag.startU) * drag.spanX * fx,
        centerY: drag.centerY - (point[1] - drag.startV) * drag.spanY,
      },
      corners,
      bgWidth,
      bgHeight,
      userWidth,
      userHeight,
    );
    onChange({ centerX: next.centerX, centerY: next.centerY });
  }

  function endPointer(e: React.PointerEvent<SVGPolygonElement>) {
    pointers.current.delete(e.pointerId);
    const pinch = pinchRef.current;
    if (pinch && (e.pointerId === pinch.id1 || e.pointerId === pinch.id2)) {
      pinchRef.current = null;
      dragRef.current = null;
      return;
    }
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  }

  function onKeyDown(e: React.KeyboardEvent<SVGPolygonElement>) {
    const w = win();
    const step = e.shiftKey ? 0.22 : 0.06;
    switch (e.key) {
      case "ArrowLeft":
        nudge(-w.spanX * step, 0);
        break;
      case "ArrowRight":
        nudge(w.spanX * step, 0);
        break;
      case "ArrowUp":
        nudge(0, -w.spanY * step);
        break;
      case "ArrowDown":
        nudge(0, w.spanY * step);
        break;
      case "+":
      case "=":
        applyZoom(crop.zoom * (e.shiftKey ? 1.3 : 1.12));
        break;
      case "-":
      case "_":
        applyZoom(crop.zoom / (e.shiftKey ? 1.3 : 1.12));
        break;
      case "0":
        onReset();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  const svgTransform =
    view.zoom !== 1 || view.panX !== 0 || view.panY !== 0
      ? { transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`, transformOrigin: "0 0" as const }
      : undefined;

  return (
    <div className="crop-layer">
      <svg
        ref={svgRef}
        className="crop-svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={svgTransform}
        aria-hidden="true"
      >
        <polygon
          ref={surfaceRef}
          className="crop-surface"
          points={poly}
          vectorEffect="non-scaling-stroke"
          tabIndex={0}
          role="application"
          aria-label={t("crop.aria")}
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight + -"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onLostPointerCapture={endPointer}
          onKeyDown={onKeyDown}
        />
      </svg>
      {!hinted && <div className="crop-hint">{t("crop.drag")}</div>}
      <div className="crop-toolbar">
        <div className="crop-zoom">
          <button
            type="button"
            className="crop-step"
            aria-label={t("crop.zoomOut")}
            onClick={() => applyZoom(crop.zoom / 1.15)}
          >
            −
          </button>
          <input
            type="range"
            aria-label={t("crop.zoom")}
            min={MIN_CROP_ZOOM}
            max={MAX_CROP_ZOOM}
            step={0.01}
            value={crop.zoom}
            onChange={(e) => applyZoom(Number(e.target.value))}
          />
          <button
            type="button"
            className="crop-step"
            aria-label={t("crop.zoomIn")}
            onClick={() => applyZoom(crop.zoom * 1.15)}
          >
            +
          </button>
          <span className="crop-pct">{Math.round(crop.zoom * 100)}%</span>
        </div>
        <button
          type="button"
          className="crop-flip"
          aria-pressed={crop.flipH}
          aria-label={t("crop.flip")}
          title={t("crop.flip")}
          onClick={() => onChange({ flipH: !crop.flipH })}
        >
          ⇆
        </button>
        <button type="button" onClick={onReset}>
          {t("crop.reset")}
        </button>
      </div>
    </div>
  );
}
