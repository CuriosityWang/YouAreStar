# Mobile slider touch guard — design

**Date:** 2026-06-22
**Status:** Approved approach, pending spec review

## Problem

On phones, the editor's controls live in a draggable bottom sheet. When it is
expanded, the parameter list (`.sheet-body`) scrolls vertically (`overflow-y:
auto`). Each parameter is a native `<input type="range" class="slider">` with an
18px-tall touch area that occupies most of the panel's vertical space.

Two distinct touch behaviors break scrolling:

1. **Scroll hijack** — a vertical swipe that *starts on a slider* is captured by
   the range input and changes the value instead of scrolling the sheet. Because
   sliders cover most of the panel, almost every scroll swipe lands on one.
2. **Tap-jump** — merely tapping / landing a finger on the slider track jumps the
   value to the touch position. This is native `<input type="range">` behavior on
   **Chrome / Android**; **iOS Safari does not tap-jump** (it requires dragging
   the thumb).

Goal: scrolling the parameter list must never alter a value. A value changes
**only** on a deliberate horizontal drag. Keyboard and desktop mouse editing are
unaffected.

## Approach

Two complementary fixes, both scoped to the `Slider` component
(`src/components/ui/controls.tsx`) and its `.slider` CSS:

### Part 1 — `touch-action: pan-y` (fixes scroll hijack)

Add `touch-action: pan-y;` to `.slider` in `src/styles/ui.css`.

This tells the browser to handle **vertical** pans itself (scroll the
`.sheet-body` container) while still delivering **horizontal** gestures to the
slider. Result: a vertical swipe starting on a slider scrolls; a horizontal drag
still edits. The browser locks to the dominant axis at gesture start, so diagonal
swipes resolve cleanly. Harmless on desktop (mouse ignores `touch-action`).

### Part 2 — tap-jump guard (fixes tap-jump)

`pan-y` does not stop a *tap* (a tap is not a pan). Guard the `Slider` component
so a touch interaction commits a value change **only after** the pointer has
moved horizontally past a small threshold — i.e. only when the user is genuinely
dragging.

Mechanics (native `<input type="range">` kept for accessibility / keyboard):

- Hold a ref to the `<input>` plus interaction state: `pointerType`, `startX`,
  `armed`.
- **`onPointerDown`**: record `pointerType` and `startX`. For `touch`, set
  `armed = false` (must earn the right to edit by dragging). For `mouse`/`pen`,
  set `armed = true` (preserve desktop click-on-track, which is expected and not
  a problem).
- **`onPointerMove`**: if `pointerType === 'touch'` and
  `Math.abs(clientX - startX) > THRESHOLD` (≈4px), set `armed = true` and commit
  the input's current value.
- **`onChange`** (React's input event): commit the value **unless**
  `pointerType === 'touch' && !armed`. When suppressing, resync the DOM input
  back to the controlled `value` (`inputRef.current.value = String(value)`) so
  the thumb does not visually drift from the prop. Keyboard editing fires
  `onChange` with no active pointer (`pointerType` null) → always commits.
- **`onPointerUp` / `onPointerCancel`**: reset interaction state.

Because suppression happens before the value is committed (and the DOM value is
resynced in the same event), there is **no jump-then-revert flicker**.

`THRESHOLD` ≈ 4px. A drag has at most a ~4px dead zone at the very start, which
is imperceptible.

## Out of scope

- The mask-toolbar brush sliders (`.mt-slider input`) live in a floating palette
  with a different gesture model (on phone it is a horizontally-scrolling strip),
  not the scrolling sheet. Not changed here. Note: if the same complaint surfaces
  there later, the same `Slider`-level fix pattern applies.
- The bottom-sheet open/close drag is already bound only to the grab handle
  (`dragControls` + `dragListener: false`); it is not part of this problem.

## Files touched

- `src/styles/ui.css` — add `touch-action: pan-y` to `.slider`.
- `src/components/ui/controls.tsx` — add the tap-jump guard to `Slider`.

## Testing (manual, both platforms required)

No test runner exists; verify by hand on real devices.

**iOS Safari**
- Vertical swipe starting on a slider scrolls the sheet, value unchanged.
- Tap on a slider track does not change the value (confirm no regression).
- Horizontal drag edits the value smoothly.

**Android Chrome**
- Vertical swipe starting on a slider scrolls the sheet, value unchanged.
- Tap on a slider track does **not** jump the value (the guard's main job).
- Horizontal drag edits the value smoothly.

**Desktop (mouse + keyboard)**
- Click-on-track still sets the value (no regression).
- Drag edits; arrow keys edit.
