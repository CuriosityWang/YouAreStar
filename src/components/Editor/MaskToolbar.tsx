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
