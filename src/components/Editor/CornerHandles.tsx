import { useRef } from "react";
import type { Corners } from "../../data/presets";

const TAGS = ["TL", "TR", "BR", "BL"];

const clamp = (v: number) => Math.min(1, Math.max(0, v));

export function CornerHandles({
  corners,
  onChange,
}: {
  corners: Corners;
  onChange: (c: Corners) => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);

  function startDrag(i: number, e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const layer = layerRef.current;
    if (!layer) return;

    const move = (ev: PointerEvent) => {
      const rect = layer.getBoundingClientRect();
      const x = clamp((ev.clientX - rect.left) / rect.width);
      const y = clamp((ev.clientY - rect.top) / rect.height);
      const next = corners.map((c, idx) => (idx === i ? [x, y] : c)) as Corners;
      onChange(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const poly = corners.map(([x, y]) => `${x * 100},${y * 100}`).join(" ");

  return (
    <div className="corner-layer" ref={layerRef}>
      <svg className="corner-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polygon className="corner-quad" points={poly} vectorEffect="non-scaling-stroke" />
      </svg>
      {corners.map(([x, y], i) => (
        <div
          key={i}
          className="handle"
          style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
          onPointerDown={(e) => startDrag(i, e)}
        >
          <span className="handle-tag">{TAGS[i]}</span>
        </div>
      ))}
    </div>
  );
}
