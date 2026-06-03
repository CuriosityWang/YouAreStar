import { useEffect, useRef, useState } from "react";
import { Renderer, type BlendParams, type GradeParams, type RenderState } from "../../lib/webgl/renderer";
import type { Stats } from "../../lib/color";
import type { Corners } from "../../data/presets";
import type { EditorSource } from "../../hooks/useEditor";
import { loc, useI18n } from "../../i18n";
import { CornerHandles } from "./CornerHandles";

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
  onCorners: (c: Corners) => void;
  onUserFile: (f: File) => void;
}) {
  const { t, lang } = useI18n();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);
  const [compare, setCompare] = useState(false); // hold to preview the bare scene

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

  // mask texture
  useEffect(() => {
    rendererRef.current?.setMask(source.mask);
  }, [source.mask]);

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
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
  }, [size, source.corners, userImage, srcStats, tgtStats, grade, blend, seed, compare]);

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
