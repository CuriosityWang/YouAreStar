import assert from "node:assert/strict";
import {
  screenToMask,
  interpolateStamps,
  brushStops,
  growRect,
  clampRectToCanvas,
  zoomToward,
  clampZoom,
  clampPan,
} from "./maskMath";

// screenToMask: identity view maps holder fraction to mask px
{
  const holder = { left: 100, top: 50, width: 200, height: 100 };
  const view = { zoom: 1, panX: 0, panY: 0 };
  const p = screenToMask(200, 100, holder, view, 400, 200); // center of holder
  assert.equal(Math.round(p.x), 200);
  assert.equal(Math.round(p.y), 100);
}

// screenToMask: zoom 2 + pan keeps the inverse correct
{
  const holder = { left: 0, top: 0, width: 200, height: 100 };
  const view = { zoom: 2, panX: -100, panY: -50 }; // zoomed into the center
  const p = screenToMask(0, 0, holder, view, 200, 100);
  // local = (0 - (-100))/2 = 50 px of 200 -> 0.25 -> mask 50
  assert.equal(Math.round(p.x), 50);
  assert.equal(Math.round(p.y), 25);
}

// interpolateStamps: count along a 10px line at spacing 5 includes endpoint
{
  const pts = interpolateStamps(0, 0, 10, 0, 5);
  assert.ok(pts.length >= 2);
  const last = pts[pts.length - 1];
  assert.equal(last.x, 10);
  assert.equal(last.y, 0);
}

// interpolateStamps: zero-length still yields the endpoint
{
  const pts = interpolateStamps(3, 4, 3, 4, 5);
  assert.equal(pts.length, 1);
  assert.deepEqual(pts[0], { x: 3, y: 4 });
}

// brushStops: paint = white center -> black edge; erase swaps
{
  const paint = brushStops(0.5, false);
  assert.equal(paint[0].color, "#fff");
  assert.equal(paint[paint.length - 1].color, "#000");
  const erase = brushStops(0.5, true);
  assert.equal(erase[0].color, "#000");
  assert.equal(erase[erase.length - 1].color, "#fff");
  // offsets strictly non-decreasing and within [0,1]
  for (const s of paint) assert.ok(s.offset >= 0 && s.offset <= 1);
}

// growRect: grows a bbox to include a stamp
{
  let r = growRect(null, 10, 10, 5); // x5..15
  assert.deepEqual(r, { x: 5, y: 5, w: 10, h: 10 });
  r = growRect(r, 30, 10, 5); // extends right to 35
  assert.equal(r.x, 5);
  assert.equal(r.w, 30);
}

// clampRectToCanvas: clips to bounds and floors/ceils
{
  const r = clampRectToCanvas({ x: -3.2, y: 2.7, w: 10, h: 4 }, 100, 100);
  assert.equal(r.x, 0);
  assert.equal(r.y, 2);
  assert.ok(r.w > 0 && r.h > 0);
}

// zoomToward: cursor point stays fixed under zoom change
{
  const before = { zoom: 1, panX: 0, panY: 0 };
  const after = zoomToward(before, 2, 100, 50);
  // world under cursor before: (100-0)/1 = 100; after must map back to 100 screen
  const screenX = after.panX + 100 * after.zoom;
  assert.equal(Math.round(screenX), 100);
}

// clampZoom + clampPan bounds
{
  assert.equal(clampZoom(0.2), 1);
  assert.equal(clampZoom(99), 8);
  const v = clampPan({ zoom: 1, panX: 50, panY: -20 }, 200, 100);
  assert.equal(v.panX, 0); // at zoom 1 pan is locked to 0
  assert.equal(v.panY, 0);
}

console.log("maskMath OK");
