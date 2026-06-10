# Saved Scenes (用户模板) — Design

Date: 2026-06-10
Status: approved

## Problem

Custom scenes (an uploaded background photo with hand-placed corners and an
optional painted occlusion mask) live only in React state. Reloading the page
loses them; the only persistence path today is the developer-facing "Copy
corners" snippet pasted into `src/data/presets.ts`. Users want to save a
finished custom scene and reuse it later from the gallery.

## Decisions (confirmed with user)

1. **What a template contains:** background image + corners + occlusion mask.
   Grade/blend parameters are NOT saved — they are tuned per inserted user
   image, not per scene.
2. **Save entry point:** both custom uploads and built-in presets. Saving a
   preset (e.g. after painting an occlusion mask, which no bundled preset has
   yet) creates an independent user copy in "My templates"; the built-in entry
   itself is untouched. The developer-facing Copy-corners → presets.ts
   workflow stays as is.
3. **Re-save semantics:** saving an opened saved scene updates it in place
   (same id). No duplicate entries, no version history.
4. **Storage:** IndexedDB, hand-rolled promise wrapper, no new dependency.
   (localStorage rejected: ~5MB quota vs multi-MB photos. File export/import
   rejected: manual file management defeats "save and reuse".)

## Data model & storage layer

New file `src/lib/savedScenes.ts`. Database `billboard-replacer`, version 1,
single object store `scenes` keyed by `id`.

```ts
export interface SavedScene {
  id: string;            // crypto.randomUUID()
  name: string;          // user-typed, plain string (not localized)
  bgBlob: Blob;          // original upload bytes — no re-encode, no quality loss
  maskBlob: Blob | null; // PNG serialization of the mask canvas; null if never painted
  thumbBlob: Blob;       // ~480px JPEG for the gallery card
  corners: Corners;      // [TL, TR, BR, BL], normalized 0..1 (existing convention)
  createdAt: number;
  updatedAt: number;
}
```

Public API (all promise-based, lazily open the DB on first call):

- `listScenes(): Promise<SavedScene[]>` — sorted by `updatedAt` descending.
- `putScene(scene: SavedScene): Promise<void>` — insert or overwrite by id.
- `deleteScene(id: string): Promise<void>`.

The wrapper is ~80 lines of plain `indexedDB` calls wrapped in promises,
matching the project's no-framework style.

## State flow (useEditor)

`EditorSource` gains two optional fields:

- `bgBlob?: Blob` — the original background bytes. `openCustom` currently
  decodes the `File` and drops it; it must now stash the `File` (a `Blob`)
  here so saving stores original bytes instead of a canvas re-encode.
  `openSaved` sets it from the stored record. `openPreset` leaves it
  undefined; `saveScene` then fetches the preset's `src` (also stashed on
  `EditorSource` as `bgSrc?: string`) to obtain the bytes at save time.
- `savedId?: string` — identity of an already-saved template; presence means
  "update in place" on the next save.

`kind` stays `"custom"` for saved scenes once they are reopened from "My
templates" — they behave exactly like a fresh custom scene (draggable
corners, paintable mask, saveable) regardless of whether they originated from
an upload or a preset. While still in the preset editor session, saving sets
`savedId` but `kind` remains `"preset"` (the Adjust/lock toggle keeps
working); subsequent saves in that session update the same template.

New `EditorApi` methods:

- `openSaved(scene: SavedScene)` — decode `bgBlob` via a new
  `blobToImage` helper (object URL + existing `loadImage`), restore the mask
  via `createMaskCanvas` + `drawBaseImage` (same path presets with a `mask`
  PNG use), dispatch `OPEN` with `editable: true`, then `SET_MASK_CANVAS` if a
  mask was stored.
- `saveScene(name: string): Promise<void>` — resolve the background bytes
  (`source.bgBlob`, else `fetch(source.bgSrc)` for presets), serialize
  `maskCanvas.canvas.toBlob("image/png")` when the mask has been touched,
  render a ~480px JPEG thumbnail from the background image, then `putScene`
  with `id = source.savedId ?? crypto.randomUUID()`. On first save, write the
  new `savedId` (and the possibly-renamed `name`) back into state via a new
  `MARK_SAVED` action.

Mask serialization note: the stored mask PNG is the mask canvas at its capped
resolution (long side ≤ 2048, see `createMaskCanvas`); restoring draws it
scaled to fill a fresh mask canvas, which is the same tolerance the preset
mask path already accepts.

`maskTouched` gating: only serialize the mask when `state.maskTouched` is
true; an untouched (all-black) canvas stores as `null`.

## UI

**Editor sidebar** (rendered for every source, custom and preset alike):

- A "存为模板 / Save as template" button. Clicking reveals an inline name
  input pre-filled with the current scene name (preset names resolved through
  `loc(name, lang)`); confirming calls `saveScene(name)` and flashes a
  "已保存 / Saved" toast.
- When `source.savedId` exists the button reads "更新模板 / Update template".
- Saving requires no user image — a template is the scene itself.

**Gallery:**

- New "我的模板 / My templates" section between the preset grid and the
  upload (BYO) card. Hidden entirely when there are no saved scenes (and when
  IndexedDB is unavailable).
- A `useSavedScenes` hook loads the list on mount (async), exposes
  `scenes`, `remove(id)`, and a `refresh()`.
- Cards reuse the `preset-card` look; thumbnails come from
  `URL.createObjectURL(thumbBlob)`, revoked on unmount. Each card has a small
  delete button with a two-click confirm: first click flips it to a "确认删除?
  / Delete?" state (auto-reverts after ~3s), second click deletes. No native
  `confirm()` dialogs. Clicking the card itself calls `openSaved`.

**i18n:** ~10 new typed `STRINGS` entries (section title, save/update button,
name placeholder, confirm/cancel, saved toast, delete label, delete confirm,
save-failure message). All text through `t(key)` per existing convention.

## Error handling

- IndexedDB unavailable (e.g. some private-browsing modes): gallery hides the
  "My templates" section; the save button still renders but surfaces a toast
  error on failure. The rest of the app is unaffected.
- `putScene` failure (quota exceeded): caught in `saveScene`, surfaced through
  the existing error/toast mechanism with a dedicated i18n string.
- Preset background `fetch` failure (e.g. offline): same save-failure toast;
  nothing is written to the store.
- Stored-record decode failure on open: surface the existing `error.load`
  path, stay in the gallery.

## Testing

No test runner exists (per CLAUDE.md). Verification:

- Pure logic in `savedScenes.ts` sanity-checked ad hoc (`npx tsx` where it
  doesn't touch DOM APIs).
- End-to-end via headless Chrome over CDP (existing harness approach):
  upload → drag corners → paint mask → save → reload → open from
  "My templates" → assert corners match and mask pixels survived the
  round-trip; delete → section empties. Repeat the save → reload → reopen
  pass starting from a built-in preset (mask painted on the preset).

## Out of scope

- Cross-device sync or file export of templates.
- Version history / duplicates on re-save.
- Persisting grade/blend parameters or the inserted user image.
