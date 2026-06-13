import type { MaskTool } from "../../hooks/useMaskTool";

/**
 * Full-holder overlay that captures brush pointer/wheel events and draws the
 * brush ring cursor. Sits ON TOP of the (transformed) zoom container, but is
 * itself untransformed so the cursor stays crisp and circular at any zoom.
 */
export function MaskBrushLayer({ tool }: { tool: MaskTool }) {
  // While a slider is dragged the pointer is off the canvas, so park the ring
  // at the canvas center to preview the new size/edge against the image.
  const atCenter = tool.previewing && !tool.cursor.visible;
  const visible = (tool.cursor.visible || tool.previewing) && !tool.spaceHeld;
  const cursorStyle: React.CSSProperties = {
    left: atCenter ? "50%" : tool.cursor.x,
    top: atCenter ? "50%" : tool.cursor.y,
    width: Math.max(6, tool.displayRadius * 2),
    height: Math.max(6, tool.displayRadius * 2),
    ["--hardness" as string]: tool.hardness,
    display: visible ? "block" : "none",
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
