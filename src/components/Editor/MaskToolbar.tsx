import type { MaskTool, MaskViewMode } from "../../hooks/useMaskTool";
import { useI18n } from "../../i18n";

const VIEW_MODES: MaskViewMode[] = ["overlay", "result", "mask"];

export function MaskToolbar({ tool }: { tool: MaskTool }) {
  const { t } = useI18n();
  const viewKey = (m: MaskViewMode) =>
    m === "overlay" ? "mask.view.overlay" : m === "result" ? "mask.view.result" : "mask.view.mask";

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
