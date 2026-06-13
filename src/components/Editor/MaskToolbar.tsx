import { useLayoutEffect, useRef, useState } from "react";
import type { MaskTool, MaskViewMode } from "../../hooks/useMaskTool";
import { useI18n } from "../../i18n";

const VIEW_MODES: MaskViewMode[] = ["overlay", "result", "mask"];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function MaskToolbar({ tool }: { tool: MaskTool }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  // The panel floats over the stage and can be dragged anywhere within it.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const viewKey = (m: MaskViewMode) =>
    m === "overlay" ? "mask.view.overlay" : m === "result" ? "mask.view.result" : "mask.view.mask";

  // Default landing spot: the largest blank margin around the framed image —
  // the right margin for tall scenes, below the frame for wide ones, else the
  // bottom-right corner. The user can then drag it wherever they like.
  useLayoutEffect(() => {
    const el = ref.current;
    const wrap = el?.offsetParent as HTMLElement | null;
    if (!el || !wrap) return;
    const frame = wrap.querySelector(".stage-frame") as HTMLElement | null;
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    const pw = el.offsetWidth;
    const ph = el.offsetHeight;
    const side = (W - (frame?.offsetWidth ?? W)) / 2;
    const below = (H - (frame?.offsetHeight ?? H)) / 2;
    let x: number;
    let y: number;
    if (side >= pw + 16) {
      x = W - side / 2 - pw / 2;
      y = (H - ph) / 2;
    } else if (below >= ph + 12) {
      x = (W - pw) / 2;
      y = H - below / 2 - ph / 2;
    } else {
      x = W - pw - 16;
      y = H - ph - 16;
    }
    setPos({ x: clamp(x, 8, W - pw - 8), y: clamp(y, 8, H - ph - 8) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startDrag(e: React.PointerEvent) {
    const el = ref.current;
    const wrap = el?.offsetParent as HTMLElement | null;
    if (!el || !wrap) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const grabX = e.clientX - r.left;
    const grabY = e.clientY - r.top;
    const onMove = (ev: PointerEvent) => {
      const wr = wrap.getBoundingClientRect();
      const pw = el.offsetWidth;
      const ph = el.offsetHeight;
      setPos({
        x: clamp(ev.clientX - wr.left - grabX, 8, wr.width - pw - 8),
        y: clamp(ev.clientY - wr.top - grabY, 8, wr.height - ph - 8),
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // Live brush swatch: diameter tracks size (relative within the box) and the
  // radial gradient's solid core tracks edge hardness — the same falloff the
  // brush paints (solid to `hardness`, feather to the rim).
  const sizePct = (tool.radius - tool.radiusRange.min) / (tool.radiusRange.max - tool.radiusRange.min);
  const hardPct = Math.round(tool.hardness * 100);
  const dotStyle: React.CSSProperties = {
    width: 6 + sizePct * 24,
    height: 6 + sizePct * 24,
    background: `radial-gradient(circle, var(--vermilion) 0%, var(--vermilion) ${hardPct}%, color-mix(in srgb, var(--vermilion) 0%, transparent) 100%)`,
  };
  // Park the on-canvas ring at center while a slider is dragged.
  const preview = {
    onPointerDown: () => tool.setPreviewing(true),
    onPointerUp: () => tool.setPreviewing(false),
    onPointerCancel: () => tool.setPreviewing(false),
    onBlur: () => tool.setPreviewing(false),
  };

  return (
    <div
      className="mask-toolbar"
      ref={ref}
      style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, visibility: pos ? "visible" : "hidden" }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mt-grip" onPointerDown={startDrag} title={t("mask.move")} aria-label={t("mask.move")}>
        ⠿⠿⠿
      </div>

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

      <div className="mt-brush">
        <span className="mt-brush-preview" aria-hidden="true">
          <span className="mt-brush-dot" style={dotStyle} />
        </span>
        <div className="mt-sliders">
          <label className="mt-slider">
            <span>{t("mask.size")}</span>
            <input
              type="range"
              min={tool.radiusRange.min}
              max={tool.radiusRange.max}
              value={tool.radius}
              onChange={(e) => tool.setRadius(Number(e.target.value))}
              {...preview}
            />
            <span className="mt-val">{tool.radius}</span>
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
              {...preview}
            />
            <span className="mt-val">{hardPct}%</span>
          </label>
        </div>
      </div>

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
        <label className="mt-btn mt-import" title={t("mask.importHint")}>
          <input
            type="file"
            accept="image/*"
            aria-label={`${t("mask.import")} — ${t("mask.importHint")}`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void tool.importMask(f);
              e.currentTarget.value = "";
            }}
          />
          {t("mask.import")}
        </label>
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
