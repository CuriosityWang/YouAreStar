import { useEffect, useRef, useState } from "react";
import type { Corners } from "../../data/presets";
import { useI18n } from "../../i18n";

const TAGS = ["TL", "TR", "BR", "BL"];
const INITIAL_GUIDE_MS = 1200;
const GUIDE_FADE_DELAY_MS = 300;

const clamp = (v: number) => Math.min(1, Math.max(0, v));

export function CornerHandles({
  corners,
  onChange,
}: {
  corners: Corners;
  onChange: (c: Corners) => void;
}) {
  const { t } = useI18n();
  const layerRef = useRef<HTMLDivElement>(null);
  const guideTimer = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [guidesVisible, setGuidesVisible] = useState(true);
  const [previewing, setPreviewing] = useState(false);

  function clearGuideTimer() {
    if (guideTimer.current !== null) {
      window.clearTimeout(guideTimer.current);
      guideTimer.current = null;
    }
  }

  function showGuides() {
    clearGuideTimer();
    setGuidesVisible(true);
  }

  function fadeGuides(delay = GUIDE_FADE_DELAY_MS) {
    clearGuideTimer();
    guideTimer.current = window.setTimeout(() => {
      setGuidesVisible(false);
      guideTimer.current = null;
    }, delay);
  }

  useEffect(() => {
    fadeGuides(INITIAL_GUIDE_MS);
    return clearGuideTimer;
  }, []);

  function startDrag(i: number, e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const layer = layerRef.current;
    if (!layer) return;
    setActiveIndex(i);
    showGuides();

    const move = (ev: PointerEvent) => {
      const rect = layer.getBoundingClientRect();
      const x = clamp((ev.clientX - rect.left) / rect.width);
      const y = clamp((ev.clientY - rect.top) / rect.height);
      const next = corners.map((c, idx) => (idx === i ? [x, y] : c)) as Corners;
      onChange(next);
    };
    const up = () => {
      setActiveIndex(null);
      fadeGuides();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function startCleanPreview(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    clearGuideTimer();
    setPreviewing(true);
    const finish = () => {
      setPreviewing(false);
      fadeGuides();
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
    };
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finish);
  }

  const poly = corners.map(([x, y]) => `${x * 100},${y * 100}`).join(" ");
  const adjacent =
    activeIndex === null
      ? null
      : {
          current: corners[activeIndex],
          previous: corners[(activeIndex + corners.length - 1) % corners.length],
          next: corners[(activeIndex + 1) % corners.length],
        };

  return (
    <div
      className="corner-layer"
      ref={layerRef}
      data-guides={guidesVisible || activeIndex !== null ? "visible" : "hidden"}
      data-previewing={previewing || undefined}
    >
      <svg className="corner-svg corner-controls" viewBox="0 0 100 100" preserveAspectRatio="none">
        {adjacent ? (
          <>
            <line
              className="corner-guide"
              x1={adjacent.previous[0] * 100}
              y1={adjacent.previous[1] * 100}
              x2={adjacent.current[0] * 100}
              y2={adjacent.current[1] * 100}
              vectorEffect="non-scaling-stroke"
            />
            <line
              className="corner-guide"
              x1={adjacent.current[0] * 100}
              y1={adjacent.current[1] * 100}
              x2={adjacent.next[0] * 100}
              y2={adjacent.next[1] * 100}
              vectorEffect="non-scaling-stroke"
            />
          </>
        ) : (
          <polygon className="corner-guide" points={poly} vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {corners.map(([x, y], i) => (
        <div
          key={i}
          className="handle corner-controls"
          style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
          onPointerDown={(e) => startDrag(i, e)}
          onPointerEnter={showGuides}
          onPointerLeave={() => {
            if (activeIndex === null) fadeGuides();
          }}
        >
          <span className="handle-tag">{TAGS[i]}</span>
        </div>
      ))}
      <button
        type="button"
        className="corner-preview corner-controls"
        onPointerDown={startCleanPreview}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            clearGuideTimer();
            setPreviewing(true);
          }
        }}
        onKeyUp={() => {
          setPreviewing(false);
          fadeGuides();
        }}
        onBlur={() => {
          setPreviewing(false);
          fadeGuides();
        }}
      >
        {t("corner.preview")}
      </button>
    </div>
  );
}
