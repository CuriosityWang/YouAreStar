# Admin: Publish Official Templates — Design

- **Date:** 2026-06-13
- **Status:** Approved (brainstorming) → ready for implementation plan
- **Author:** Wang Xin (admin) + Claude

## Problem

The admin wants to author and ship new **official** preset scenes from inside the
app: find an image, mark the ad surface, process the foreground (occlusion mask),
and publish it so it appears in the gallery for all users.

Two concrete gaps in the current app:

1. **No authoring path for official presets.** Presets are code in
   `src/data/presets.ts` (bilingual `name`/`caption`, `src`, `corners`, optional
   `mask`). Today the only way to add one is by hand: drop an image in
   `public/billboards/`, use custom mode, drag handles, "Copy corners", and paste
   an entry. There is no way to enter the bilingual name/caption, no way to export
   a painted mask as a PNG asset, and no way to emit a complete entry.

2. **Presets have no place to save the mask.** The `Preset.mask?` field exists and
   the shader honors it (`alpha *= 1 - mask.r`), but **no preset uses it** and there
   is no tooling to produce/store the PNG. A painted mask can only be saved into a
   personal *SavedScene* (IndexedDB via "My Templates"), never back into the
   official preset.

These are the same pipeline: an admin-only "publish official template" flow that
produces the background asset, the occlusion mask PNG, and the preset data entry.

## Decisions (from brainstorming)

- **Publish path:** Dev-server auto-write. During `npm run dev`, one click writes
  the assets into `public/billboards/` and upserts the preset entry, which appears
  instantly via HMR. The admin then `git commit` + deploys. A download/clipboard
  fallback covers the rare case the endpoint is unavailable.
- **Gating:** Dev-only (`import.meta.env.DEV`). All publish UI and the client code
  are tree-shaken out of the production build; deployed end-users never see it.
- **Foreground processing:** Manual brush (already built) **plus** import an
  external mask file (PNG / alpha matte prepared elsewhere). No bundled ML model —
  keep the app dependency-light.
- **Preset storage:** Migrate preset data out of `presets.ts` into a machine-owned
  JSON manifest (`src/data/billboards.json`). Approved.
- **Publish UI:** A dedicated **modal** panel (not inline in the sidebar).

## Architecture

### 1. Preset data → JSON manifest

The Vite plugin must *write* preset entries. Rewriting TypeScript is fragile,
especially for in-place updates. So we split data from code.

- **New `src/data/billboards.json`** — an array of plain objects:
  ```json
  [
    {
      "id": "times-square-night",
      "name": { "en": "Times Square — Night Marquee", "zh": "时代广场 · 夜色巨幕" },
      "caption": { "en": "…", "zh": "…" },
      "src": "/billboards/times-square-night.jpg",
      "corners": [[0.0737,0.3427],[0.5857,0.1391],[0.5865,0.3853],[0.0691,0.4618]],
      "mask": "/billboards/times-square-night-mask.png"
    }
  ]
  ```
  `mask` is omitted when absent. The plugin reads this file, upserts by `id`, and
  writes it back with `JSON.stringify(list, null, 2)`. No TS parsing.

- **`src/data/presets.ts`** keeps the `Corner` / `Corners` / `Preset` types and the
  corner-ordering doc comment, and becomes:
  ```ts
  import billboards from "./billboards.json";
  export const PRESETS = billboards as unknown as Preset[];
  ```
  Requires `resolveJsonModule: true` in tsconfig (verify; add if missing).

- **Migration:** Move the current 5 presets verbatim into `billboards.json`. They
  must render identically (same ids, names, captions, corners, order). No mask
  fields added (no mask assets exist yet).

### 2. Vite dev plugin — `vite-plugin-publish-template.ts`

A plugin wired into `vite.config.ts`, `apply: 'serve'` so it exists only on the dev
server and is absent from `vite build` output.

- **Route:** `POST /__publish-template`, JSON body:
  ```ts
  {
    id: string,                       // safe slug
    name: { en: string, zh: string },
    caption: { en: string, zh: string },
    corners: [[number,number],[number,number],[number,number],[number,number]],
    bg:   { base64: string, ext: string } | null,  // null = keep existing src (editing)
    maskPng: string | null,           // base64 PNG; null = leave existing mask untouched
  }
  ```
- **Behavior:**
  1. Validate `id` matches `^[a-z0-9][a-z0-9-]*$` (reject path traversal / empty).
  2. Validate `corners` is 4 pairs of finite numbers in `[0,1]`; `name`/`caption`
     have non-empty `en`/`zh`.
  3. If `bg` present: write `public/billboards/<id>.<safeExt>` (ext from an allowlist:
     jpg/jpeg/png/webp/svg). Resulting `src` = `/billboards/<id>.<safeExt>`. If `bg`
     is null, reuse the existing entry's `src` (must already exist → else 400).
  4. If `maskPng` present: write `public/billboards/<id>-mask.png`; entry `mask` =
     `/billboards/<id>-mask.png`. If null, preserve the existing entry's `mask`.
  5. Read `src/data/billboards.json`, call the **pure** `upsertPreset(list, entry)`,
     write it back (2-space indent, trailing newline).
  6. Respond `{ ok: true, src, mask, updated: boolean }`.
- **Errors:** 400 on validation failure (with a message), 500 on write failure. All
  filesystem writes confined to `public/billboards/` and the one JSON file. Resolve
  paths and assert they stay within the repo (defense-in-depth on top of slug
  validation).
- **Pure core:** `upsertPreset(list, entry)` lives in a **dependency-free** module
  `src/lib/presetManifest.ts` (no browser or Node APIs) so both the Vite plugin
  (Node context) and the client can import it without dragging in DOM-only code. It
  replaces by `id` (preserving array position) or appends. This module also holds the
  other pure helpers shared across the boundary: `slug`, `mimeToExt`,
  `EXT_ALLOWLIST`, and the payload validators. This is the logic worth unit-testing
  in isolation.

### 3. Publish client — `src/lib/publishTemplate.ts` (browser-side)

Holds only the functions that touch the DOM / network; imports pure helpers from
`presetManifest.ts`.

- `buildPayload(...)` — assembles the POST body: bg bytes from
  `source.bgBlob` (uploads / edited saved scenes) or fetched from `source.bgSrc`
  (presets), encoded base64 with ext derived from the blob's MIME (`mimeToExt`); mask
  PNG from `canvasToBlob(maskCanvas.canvas, "image/png")` → base64. When editing a
  preset whose bg is unchanged, `bg` is `null`.
- `publishTemplate(payload): Promise<PublishResult>` — POSTs to
  `/__publish-template`; throws a typed error on non-OK / network failure.
- `downloadFallback(payload)` — on failure: trigger downloads of the bg (if any) and
  the mask PNG, and copy the JSON entry snippet to the clipboard (mirrors the
  existing "Copy corners" pattern). Minimal, no zip dependency. Rare path since the
  feature is dev-only.

Pure helpers (`upsertPreset`, `slug`, `mimeToExt`, `EXT_ALLOWLIST`, validators) live
in `src/lib/presetManifest.ts` and are shared with the plugin.

### 4. Admin gate

`export const IS_ADMIN = import.meta.env.DEV;` (small `src/lib/admin.ts`, or inline).
Every publish-related branch in the UI is guarded by it so production tree-shakes it.

### 5. UI — modal publish panel

- In `Editor.tsx`, when `IS_ADMIN`, render a **"Publish as official template"**
  button in the export bar, beside "Save as template".
- Clicking opens a **modal** (`PublishModal`, new component under
  `src/components/Editor/`) with:
  - EN name, ZH name, EN caption, ZH caption inputs.
  - `id` input, auto-slugged from EN name, editable. Live warning "updates existing
    preset «id»" when it matches a known preset id.
  - Mask status row: "mask: painted / imported / none", an **Import mask** file
    input (loads an image into the mask canvas), and a hint that white = foreground.
    The brush itself stays where it is (the existing mask toggle / `MaskBrushLayer`).
  - **Publish** and **Cancel**. Publish builds the payload, calls
    `publishTemplate`, and on success flashes a toast ("Published — commit to ship")
    and returns to the gallery so the new/updated card is visible. On failure it
    runs `downloadFallback` and surfaces a message.
  - Prefill when editing an existing preset: name/caption/id from the preset, mask
    status reflects the loaded mask, bg unchanged unless a new bg is involved.
- Styling in `app.css` (modal scrim + panel; reuse existing control primitives and
  CSS custom properties — "Editorial Gallery" look).

### 6. Mask import

Add an "Import mask" file input that does `fileToImage(file)` → `ensureMask()` →
`drawBaseImage(maskCanvas, img)` → mark the mask touched (so it is fed to the GPU and
exported). Reuses existing helpers; convention is white = foreground occluder. A new
`useEditor` helper (`importMask(file)`) keeps the canvas/state wiring in one place.

## Data flow — publish a NEW template

1. Gallery → "Use your own billboard" → upload photo (custom mode).
2. Drag corners (Adjust). Optionally paint or **Import mask**.
3. Open the Publish modal; fill EN/ZH name + caption; confirm `id`.
4. Publish → client builds `{ id, name, caption, corners, bg:{base64,ext}, maskPng }`
   → `POST /__publish-template`.
5. Plugin writes `public/billboards/<id>.<ext>` (+ `<id>-mask.png`), upserts
   `billboards.json`.
6. HMR reloads the JSON → `PRESETS` updates → the new card appears in the gallery.
7. `git add public/billboards src/data/billboards.json && git commit` → deploy.

## Data flow — EDIT an existing preset's mask (second ask)

1. Gallery → open preset → it loads with its current mask (if any).
2. Adjust corners / paint / **Import mask**.
3. Open the Publish modal — prefilled with the preset's id/name/caption; bg unchanged
   (`bg: null`).
4. Publish → plugin writes `<id>-mask.png`, sets the entry's `mask`, leaves `src`.
5. HMR → the preset now occludes correctly. Commit.

## Error handling

- **Plugin:** 400 on invalid id/corners/name; 500 on write failure; both return a
  human-readable message the client shows. All writes confined to
  `public/billboards/` + the manifest.
- **Client:** non-OK / network error → `downloadFallback` + message via the existing
  error bar / toast.
- **ID collision** on a *new* template: the modal warns it will overwrite an existing
  preset; the admin can rename before publishing.

## Security

- Dev-only by construction (`apply: 'serve'`, `import.meta.env.DEV`); never reaches
  production. Dev server binds to localhost by default.
- `id` slug allowlist + resolved-path containment prevent path traversal.
- Extension allowlist for the bg file.

## Testing

- **Unit:** `upsertPreset` (replace-in-place vs append, position preserved); `slug`
  derivation; `mimeToExt`; payload builder shape. (Vitest is not set up; there is a
  `maskMath.test.ts` — match its harness, or run via `npx tsx` ad hoc per the repo's
  "no test runner" convention.)
- **Headless (Chrome DevTools Protocol, per `browser-testing-harness`):** publish a
  synthetic template; assert the files were written and `billboards.json` upserted;
  reload and assert the new card renders and the mask occludes.
- **Migration:** after moving the 5 presets into JSON, assert the gallery renders all
  5 identically (same order, names, corners).

## Files

**New**
- `src/data/billboards.json` — migrated presets, machine-owned.
- `vite-plugin-publish-template.ts` — dev middleware (imports `presetManifest.ts`).
- `src/lib/presetManifest.ts` — dependency-free shared core: `upsertPreset`, `slug`,
  `mimeToExt`, `EXT_ALLOWLIST`, validators.
- `src/lib/publishTemplate.ts` — browser-side client: `buildPayload`,
  `publishTemplate`, `downloadFallback`.
- `src/lib/admin.ts` — `IS_ADMIN` (or inline).
- `src/components/Editor/PublishModal.tsx` — modal UI.

**Edited**
- `src/data/presets.ts` — import JSON, keep types + doc comment.
- `vite.config.ts` — register the plugin.
- `src/components/Editor/Editor.tsx` — dev-gated Publish button + modal mount +
  import-mask wiring.
- `src/hooks/useEditor.ts` — `importMask(file)` helper (and any state needed for
  publish prefill).
- `src/i18n/index.tsx` — bilingual `publish.*` strings.
- `src/styles/app.css` — modal styling.
- `tsconfig*.json` — `resolveJsonModule` (if not already on).
- `CLAUDE.md` — replace the manual "drop file + Copy corners" preset instructions
  with this admin publish flow; note `billboards.json` as the preset source of truth.

## Non-goals / future

- No bundled ML auto-segmentation (import covers external mattes).
- No production write-back (publishing is a dev + git activity by design).
- No multi-user/admin auth (single local admin).
- Possible later: a small "Studio" gallery section listing only admin-published
  presets; mask-clear control; ZIP fallback.
