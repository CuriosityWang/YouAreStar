import { useEffect, useRef, useState } from "react";
import { Renderer, type BlendParams, type GradeParams, type RenderState } from "../../lib/webgl/renderer";
import type { Stats } from "../../lib/color";
import type { Corners } from "../../data/presets";
import type { EditorSource } from "../../hooks/useEditor";
import { loc, useI18n } from "../../i18n";
import { CornerHandles } from "./CornerHandles";
import { useMaskTool } from "../../hooks/useMaskTool";
import { MaskBrushLayer } from "./MaskBrushLayer";
import { MaskToolbar } from "./MaskToolbar";
import type { EditorApi } from "../../hooks/useEditor";

const FRAME_CHROME = 30; // frame padding (14*2) + border (2)
const PLACARD = 64;

function fit(availW: number, availH: number, bgW: number, bgH: number) {
  const maxW = Math.max(40, availW - FRAME_CHROME);
  const maxH = Math.max(40, availH - FRAME_CHROME - PLACARD);
  const ar = bgW / bgH;
  let w = maxW;
  let h = w / ar;
  if (h > maxH) {
    h = maxH;
    w = h * ar;
  }
  return { w: Math.round(w), h: Math.round(h) };
}

export function EditorStage({
  source,
  userImage,
  srcStats,
  tgtStats,
  grade,
  blend,
  seed,
  editable,
  api,
  maskMode,
  maskTouched,
  onCorners,
  onUserFile,
}: {
  source: EditorSource;
  userImage: HTMLImageElement | null;
  srcStats: Stats;
  tgtStats: Stats;
  grade: GradeParams;
  blend: BlendParams;
  seed: number;
  editable: boolean;
  api: EditorApi;
  maskMode: boolean;
  maskTouched: boolean;
  onCorners: (c: Corners) => void;
  onUserFile: (f: File) => void;
}) {
  const { t, lang } = useI18n();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const holderRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);
  const [compare, setCompare] = useState(false); // hold to preview the bare scene

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

  // create / destroy renderer
  useEffect(() => {
    if (!canvasRef.current) return;
    try {
      rendererRef.current = new Renderer(canvasRef.current);
    } catch (e) {
      console.error(e);
    }
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  // background texture
  useEffect(() => {
    rendererRef.current?.setBackground(source.bgImage, source.bgWidth, source.bgHeight);
  }, [source.bgImage, source.bgWidth, source.bgHeight]);

  // user texture
  useEffect(() => {
    rendererRef.current?.setUser(userImage);
  }, [userImage]);

  // mask texture (live painting bypasses this via useMaskTool; this handles
  // initial load, preset base, undo, view switches, and source changes)
  useEffect(() => {
    const canvas = maskTouched ? source.maskCanvas?.canvas ?? null : null;
    rendererRef.current?.setMask(canvas);
  }, [source.maskCanvas, maskTouched]);

  // responsive sizing
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize(fit(r.width, r.height, source.bgWidth, source.bgHeight));
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [source.bgWidth, source.bgHeight]);

  // draw
  useEffect(() => {
    const r = rendererRef.current;
    if (!r || size.w === 0) return;
    const baseDpr = Math.min(window.devicePixelRatio || 1, 2);
    // In mask mode, supersample so the CSS-zoomed preview stays reasonably sharp.
    const superscale = maskMode ? Math.min(Math.max(tool.zoom, 1), 3) : 1;
    const dpr = Math.min(baseDpr * superscale, 4);
    r.resize(Math.round(size.w * dpr), Math.round(size.h * dpr));
    const state: RenderState = {
      corners: source.corners,
      hasUser: !!userImage && !compare,
      srcStats,
      tgtStats,
      grade,
      blend,
      seed,
    };
    r.render(state);
  }, [size, source.corners, userImage, srcStats, tgtStats, grade, blend, seed, compare, maskMode, tool.zoom]);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith("image/")) onUserFile(f);
  }

  return (
    <div
      className="stage-wrap"
      ref={wrapRef}
      data-drag={dragging}
      data-empty={!userImage}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="stage-frame">
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
        <div className="stage-placard">
          <span className="pl-name">{loc(source.name, lang)}</span>
          <span className="pl-dim">
            {source.bgWidth}×{source.bgHeight}
          </span>
        </div>
      </div>
    </div>
  );
}
