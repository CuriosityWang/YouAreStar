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
