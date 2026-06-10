# Saved Scenes (用户模板) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users save a tuned scene (background image + four corners + painted occlusion mask) into IndexedDB and reopen it later from a "My Templates" gallery section.

**Architecture:** A hand-rolled promise wrapper over IndexedDB (`src/lib/savedScenes.ts`) stores `SavedScene` records holding the *original* background bytes as a Blob, the mask canvas serialized to PNG, a small JPEG thumbnail, and the normalized corners. `useEditor` gains `openSaved`/`saveScene`; the Editor sidebar gains a save-as-template control; the Gallery gains a hidden-when-empty "My Templates" section backed by a `useSavedScenes` hook.

**Tech Stack:** React 18 + TypeScript + Vite (existing). Raw `indexedDB` API — **no new dependencies**. Verification: `npm run build` (tsc) per task + a headless puppeteer-core driver at the end (project convention; there is no test runner — see CLAUDE.md).

**Spec:** `docs/superpowers/specs/2026-06-10-saved-scenes-design.md`

**Why no unit tests for the storage layer:** the wrapper is thin glue over `indexedDB` (a browser API; `fake-indexeddb` was evaluated and rejected — extra dep, uncertain Blob cloning under Node). It is exercised against the real IndexedDB + real Blobs by the Task 6 driver, which asserts records at the IDB level *and* through the UI round-trip.

**Conventions that must hold (from CLAUDE.md):**
- Corners stay `[TL, TR, BR, BL]`, normalized 0..1 — this plan only ever copies them around, never reorders.
- All UI strings go through `t(key)` / `STRINGS` in `src/i18n/index.tsx`.
- `EditorSource.name` may be `LocalizedString | string` — always resolve via `loc()`.

---

### Task 1: Storage layer + blob image helpers

**Files:**
- Create: `src/lib/savedScenes.ts`
- Modify: `src/lib/loadImage.ts`

- [ ] **Step 1: Create `src/lib/savedScenes.ts`** with exactly:

```ts
// User-saved scene templates, persisted in IndexedDB so tuned scenes
// (uploaded photo or tweaked preset + corners + painted occlusion mask)
// survive reloads. Records hold the ORIGINAL background bytes — no canvas
// re-encode, no quality loss.

import type { Corners } from "../data/presets";

export interface SavedScene {
  id: string;
  /** user-typed, plain string (not localized) */
  name: string;
  /** original upload / fetched preset bytes — decode with blobToImage */
  bgBlob: Blob;
  /** PNG of the mask canvas (white = occluding foreground); null if never painted */
  maskBlob: Blob | null;
  /** ~480px JPEG for the gallery card */
  thumbBlob: Blob;
  corners: Corners;
  createdAt: number;
  updatedAt: number;
}

const DB_NAME = "billboard-replacer";
const DB_VERSION = 1;
const STORE = "scenes";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("indexedDB unavailable"));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    });
    // a failed open (private mode, storage blocked) must not poison retries
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("indexedDB transaction aborted"));
  });
}

/** All saved scenes, most recently updated first. */
export async function listScenes(): Promise<SavedScene[]> {
  const db = await openDB();
  const tx = db.transaction(STORE, "readonly");
  const req = tx.objectStore(STORE).getAll();
  await txDone(tx);
  return (req.result as SavedScene[]).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Insert, or overwrite the record with the same id (in-place update). */
export async function putScene(scene: SavedScene): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(scene);
  await txDone(tx);
}

export async function deleteScene(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(id);
  await txDone(tx);
}
```

- [ ] **Step 2: Add three helpers to `src/lib/loadImage.ts`.** Replace the body of `fileToImage` with a delegation to the new `blobToImage` (a `File` *is* a `Blob`; identical logic, do not duplicate it):

```ts
/** Decode any image Blob (stored template bytes, fetched preset bytes). */
export async function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    return await loadImage(url);
  } finally {
    // The decoded HTMLImageElement keeps its own copy; safe to revoke.
    URL.revokeObjectURL(url);
  }
}

export function fileToImage(file: File): Promise<HTMLImageElement> {
  return blobToImage(file);
}
```

(The old `fileToImage` implementation — the `async function` with its own `URL.createObjectURL` — is deleted; `blobToImage` carries the comment.)

Then append at the end of the file:

```ts
/** Promise wrapper over canvas.toBlob. */
export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = "image/png",
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob failed"))),
      type,
      quality,
    );
  });
}

/**
 * ~`max`px JPEG thumbnail of a decoded image, for saved-template gallery
 * cards. Painted white first: JPEG has no alpha, and a transparent SVG
 * background would otherwise encode as black.
 */
export function makeThumbBlob(img: HTMLImageElement, max = 480): Promise<Blob> {
  const [w, h] = imageDims(img);
  const scale = Math.min(1, max / Math.max(w, h, 1));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("2d context unavailable"));
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, tw, th);
  ctx.drawImage(img, 0, 0, tw, th);
  return canvasToBlob(canvas, "image/jpeg", 0.85);
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: completes with no TypeScript errors (vite build output ends with `✓ built in …`).

- [ ] **Step 4: Commit**

```bash
git add src/lib/savedScenes.ts src/lib/loadImage.ts
git commit -m "feat(storage): IndexedDB saved-scenes store + blob image helpers"
```

---

### Task 2: i18n strings

**Files:**
- Modify: `src/i18n/index.tsx`

- [ ] **Step 1: Add the new entries to `STRINGS`.** Insert this block right after the `"mask.fit"` line (the last entry, before `} satisfies …`):

```ts
  "saved.title": { en: "My Templates", zh: "我的模板" },
  "saved.delete": { en: "Delete template", zh: "删除模板" },
  "saved.confirmDelete": { en: "Delete?", zh: "确认删除?" },
  "tag.saved": { en: "Saved template", zh: "已存模板" },

  "save.as": { en: "Save as template", zh: "存为模板" },
  "save.update": { en: "Update template", zh: "更新模板" },
  "save.placeholder": { en: "Template name", zh: "模板名称" },
  "save.confirm": { en: "Save", zh: "保存" },
  "save.cancel": { en: "Cancel", zh: "取消" },
  "save.saving": { en: "Saving…", zh: "保存中…" },
  "toast.sceneSaved": { en: "Template saved", zh: "模板已保存" },

  "error.save": {
    en: "Couldn't save the template. Browser storage may be full or blocked.",
    zh: "模板保存失败，浏览器存储可能已满或被禁用。",
  },
```

`TKey` is derived (`keyof typeof STRINGS`), so no other change is needed. `"error.save"` must be in `STRINGS` because the reducer's `ERROR` action carries a `TKey`.

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/i18n/index.tsx
git commit -m "feat(i18n): strings for saved templates"
```

---

### Task 3: useEditor — openSaved / saveScene / MARK_SAVED

**Files:**
- Modify: `src/hooks/useEditor.ts`

- [ ] **Step 1: Extend imports.** Replace the existing `fileToImage` import line:

```ts
import { fileToImage, imageDims, loadImage, makeThumbDataURL } from "../lib/loadImage";
```

with:

```ts
import {
  blobToImage,
  canvasToBlob,
  fileToImage,
  imageDims,
  loadImage,
  makeThumbBlob,
  makeThumbDataURL,
} from "../lib/loadImage";
import { putScene, type SavedScene } from "../lib/savedScenes";
```

- [ ] **Step 2: Extend `EditorSource`.** Add four optional fields at the end of the interface (after `maskCanvas`):

```ts
  /** original background bytes (upload or stored template); presets resolve via bgSrc at save time */
  bgBlob?: Blob;
  /** public URL of a preset background, fetched on save */
  bgSrc?: string;
  /** id of the SavedScene this session was saved to — presence means update-in-place */
  savedId?: string;
  /** createdAt carried from the stored record so re-saves preserve it */
  savedCreatedAt?: number;
```

- [ ] **Step 3: Add the `MARK_SAVED` action.** Extend the `Action` union (after `SET_MASK_CANVAS`):

```ts
  | { type: "MARK_SAVED"; id: string; name: string; bgBlob: Blob; createdAt: number }
```

and the reducer case (before `case "BACK"`):

```ts
    case "MARK_SAVED":
      return state.source
        ? {
            ...state,
            source: {
              ...state.source,
              savedId: action.id,
              savedCreatedAt: action.createdAt,
              name: action.name,
              bgBlob: action.bgBlob,
            },
          }
        : state;
```

- [ ] **Step 4: Stash the bytes/src when opening.**
In `openPreset`, add `bgSrc: preset.src,` to the `source` object (after `maskCanvas,`).
In `openCustom`, add `bgBlob: file,` to the `source` object (after `maskCanvas: null,`).

- [ ] **Step 5: Add a `maskTouched` ref** next to the existing `sourceRef` (saveScene is a stable callback and must read the latest value):

```ts
  const maskTouchedRef = useRef(state.maskTouched);
  maskTouchedRef.current = state.maskTouched;
```

- [ ] **Step 6: Add `openSaved`** (after `openCustom`). Mirrors `openPreset`'s mask-restore path; opens editable like a custom scene:

```ts
  const openSaved = useCallback(async (scene: SavedScene) => {
    dispatch({ type: "LOADING", value: true });
    try {
      const bgImage = await blobToImage(scene.bgBlob);
      const [bgWidth, bgHeight] = imageDims(bgImage);
      let maskCanvas: MaskCanvas | null = null;
      if (scene.maskBlob) {
        const maskImg = await blobToImage(scene.maskBlob);
        maskCanvas = createMaskCanvas(bgWidth, bgHeight);
        drawBaseImage(maskCanvas, maskImg);
      }
      dispatch({
        type: "OPEN",
        editable: true,
        source: {
          kind: "custom",
          name: scene.name,
          bgImage,
          bgWidth,
          bgHeight,
          corners: scene.corners,
          maskCanvas,
          bgBlob: scene.bgBlob,
          savedId: scene.id,
          savedCreatedAt: scene.createdAt,
        },
      });
      if (maskCanvas) dispatch({ type: "SET_MASK_CANVAS", mask: maskCanvas });
    } catch (e) {
      console.error(e);
      dispatch({ type: "ERROR", message: "error.load" });
    }
  }, []);
```

- [ ] **Step 7: Add `saveScene`** (after `openSaved`). Returns `true` on success so the UI can close the prompt / show the toast:

```ts
  const saveScene = useCallback(async (name: string): Promise<boolean> => {
    const src = sourceRef.current;
    if (!src) return false;
    try {
      let bgBlob = src.bgBlob;
      if (!bgBlob) {
        if (!src.bgSrc) throw new Error("no background bytes to save");
        const res = await fetch(src.bgSrc);
        if (!res.ok) throw new Error(`fetch ${src.bgSrc}: ${res.status}`);
        bgBlob = await res.blob();
      }
      const maskBlob =
        maskTouchedRef.current && src.maskCanvas
          ? await canvasToBlob(src.maskCanvas.canvas, "image/png")
          : null;
      const thumbBlob = await makeThumbBlob(src.bgImage);
      const id = src.savedId ?? crypto.randomUUID();
      const now = Date.now();
      const createdAt = src.savedCreatedAt ?? now;
      await putScene({
        id,
        name,
        bgBlob,
        maskBlob,
        thumbBlob,
        corners: src.corners,
        createdAt,
        updatedAt: now,
      });
      dispatch({ type: "MARK_SAVED", id, name, bgBlob, createdAt });
      return true;
    } catch (e) {
      console.error(e);
      dispatch({ type: "ERROR", message: "error.save" });
      return false;
    }
  }, []);
```

- [ ] **Step 8: Export both** from the hook's return object (after `openCustom,`):

```ts
    openSaved,
    saveScene,
```

- [ ] **Step 9: Typecheck**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/hooks/useEditor.ts
git commit -m "feat(editor-state): openSaved/saveScene with in-place template updates"
```

---

### Task 4: Editor sidebar — save-as-template UI

**Files:**
- Modify: `src/components/Editor/Editor.tsx`
- Modify: `src/styles/app.css`

- [ ] **Step 1: Destructure `saveScene`** from the api in `Editor` (add to the existing destructuring list after `resetAdjust,`):

```ts
    saveScene,
```

- [ ] **Step 2: Add local state** below the existing `const [toast, setToast] = useState<string | null>(null);`:

```ts
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
```

- [ ] **Step 3: Add handlers** after `handleCopyCorners`:

```ts
  function openSavePrompt() {
    setSaveName(loc(s.name, lang));
    setSaveOpen(true);
  }

  async function handleSaveScene() {
    const name = saveName.trim() || loc(s.name, lang);
    setSaving(true);
    const ok = await saveScene(name);
    setSaving(false);
    if (ok) {
      setSaveOpen(false);
      flash(t("toast.sceneSaved"));
    }
    // on failure the reducer surfaces the error bar; keep the prompt open
  }
```

- [ ] **Step 4: Show the saved tag.** Replace the tag line in the editor bar:

```tsx
            <div className="tag">{s.kind === "preset" ? t("tag.preset") : t("tag.custom")}</div>
```

with:

```tsx
            <div className="tag">
              {s.savedId ? t("tag.saved") : s.kind === "preset" ? t("tag.preset") : t("tag.custom")}
            </div>
```

- [ ] **Step 5: Add the save control to the export-bar.** Insert between the existing `<div className="row">…</div>` (Reset/Copy) and `{toast && …}`:

```tsx
            {saveOpen ? (
              <div className="save-row">
                <input
                  className="save-name"
                  value={saveName}
                  autoFocus
                  placeholder={t("save.placeholder")}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveScene();
                    if (e.key === "Escape") setSaveOpen(false);
                  }}
                />
                <Button variant="accent" disabled={saving} onClick={handleSaveScene}>
                  {saving ? t("save.saving") : t("save.confirm")}
                </Button>
                <Button variant="ghost" disabled={saving} onClick={() => setSaveOpen(false)}>
                  {t("save.cancel")}
                </Button>
              </div>
            ) : (
              <div className="row">
                <Button variant="ghost" onClick={openSavePrompt}>
                  {s.savedId ? t("save.update") : t("save.as")}
                </Button>
              </div>
            )}
```

The button renders for **every** source kind (spec: presets are saveable too) and needs no user image.

- [ ] **Step 6: Style the prompt.** In `src/styles/app.css`, find the `.export-bar` rules (search for `.export-bar`) and add after that block:

```css
.save-row { display: flex; gap: 8px; margin-top: 10px; }
.save-name {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  font: inherit;
  font-size: 13px;
  color: var(--ink);
  background: var(--paper-2);
  border: var(--rule) solid var(--hairline-2);
  border-radius: var(--radius);
}
.save-name:focus { outline: none; border-color: var(--vermilion); }
```

- [ ] **Step 7: Typecheck**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 8: Eyeball (optional but cheap).** `npm run dev`, open a preset, click 存为模板 — input appears pre-filled, Enter saves, toast 模板已保存 shows, button now reads 更新模板. (Full automated verification comes in Task 6.)

- [ ] **Step 9: Commit**

```bash
git add src/components/Editor/Editor.tsx src/styles/app.css
git commit -m "feat(editor): save-as-template control in the sidebar"
```

---

### Task 5: Gallery — My Templates section

**Files:**
- Create: `src/hooks/useSavedScenes.ts`
- Modify: `src/components/Gallery.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles/app.css`

- [ ] **Step 1: Create `src/hooks/useSavedScenes.ts`** with exactly:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { deleteScene, listScenes, type SavedScene } from "../lib/savedScenes";

export interface SavedSceneItem {
  scene: SavedScene;
  thumbUrl: string;
}

/**
 * Gallery-side list of saved templates. Owns the thumbnail object URLs
 * (created from each record's thumbBlob, revoked on unmount/removal).
 * If IndexedDB is unavailable the list just stays empty — the section hides.
 */
export function useSavedScenes() {
  const [items, setItems] = useState<SavedSceneItem[]>([]);
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    let alive = true;
    listScenes()
      .then((scenes) => {
        if (!alive) return;
        const next = scenes.map((scene) => ({
          scene,
          thumbUrl: URL.createObjectURL(scene.thumbBlob),
        }));
        urlsRef.current = next.map((i) => i.thumbUrl);
        setItems(next);
      })
      .catch(() => {
        /* indexedDB unavailable — section stays hidden */
      });
    return () => {
      alive = false;
      for (const u of urlsRef.current) URL.revokeObjectURL(u);
      urlsRef.current = [];
    };
  }, []);

  const remove = useCallback(async (id: string) => {
    try {
      await deleteScene(id);
    } catch {
      /* drop it from the UI regardless; worst case it reappears on reload */
    }
    setItems((prev) => {
      const gone = prev.find((i) => i.scene.id === id);
      if (gone) {
        URL.revokeObjectURL(gone.thumbUrl);
        urlsRef.current = urlsRef.current.filter((u) => u !== gone.thumbUrl);
      }
      return prev.filter((i) => i.scene.id !== id);
    });
  }, []);

  return { items, remove };
}
```

(`Gallery` remounts whenever the app returns from the editor — `App.tsx` switches keyed `AnimatePresence` views — so the mount-time `listScenes()` always reflects fresh saves; no manual refresh is needed.)

- [ ] **Step 2: Rewrite `src/components/Gallery.tsx`.** Full new content (adds the `onOpenSaved` prop, the saved section, and the `SavedCard` component with two-click delete):

```tsx
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { motion } from "framer-motion";
import { PRESETS, type Preset } from "../data/presets";
import { loc, useI18n } from "../i18n";
import { LangToggle } from "./ui/LangToggle";
import { useSavedScenes, type SavedSceneItem } from "../hooks/useSavedScenes";
import type { SavedScene } from "../lib/savedScenes";

export function Gallery({
  onOpenPreset,
  onOpenCustom,
  onOpenSaved,
}: {
  onOpenPreset: (p: Preset) => void;
  onOpenCustom: (file: File) => void;
  onOpenSaved: (s: SavedScene) => void;
}) {
  const { t, lang } = useI18n();
  const { items, remove } = useSavedScenes();

  return (
    <div className="app">
      <div className="shell">
        <motion.header
          className="masthead"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="masthead-top">
            <span className="masthead-mark">Billboard&nbsp;/&nbsp;Replacer</span>
            <div className="masthead-right">
              <LangToggle />
            </div>
          </div>
          <h1 className="masthead-title">
            {t("title.lead")} <em>{t("title.accent")}</em>
            {t("title.tail")}
          </h1>
          <p className="masthead-lede">
            {t("lede.1")}
            <b>{t("lede.warp")}</b>
            {t("lede.2")}
            <b>{t("lede.match")}</b>
            {t("lede.3")}
          </p>
        </motion.header>

        <section className="collection">
          <div className="collection-head">
            <span className="label">{t("collection.title")}</span>
            <span className="rule" />
            <span className="label">
              {String(PRESETS.length).padStart(2, "0")} {t("collection.scenes")}
            </span>
          </div>

          <div className="gallery-grid">
            {PRESETS.map((p, i) => (
              <motion.button
                key={p.id}
                type="button"
                className="preset-card"
                onClick={() => onOpenPreset(p)}
                initial={{ opacity: 0, y: 26 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.6,
                  delay: 0.15 + i * 0.07,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <div className="preset-media">
                  <span className="preset-index">N°{String(i + 1).padStart(2, "0")}</span>
                  <img src={p.src} alt={loc(p.name, lang)} loading="lazy" />
                </div>
                <div className="preset-body">
                  <div className="preset-name">{loc(p.name, lang)}</div>
                  <div className="preset-caption">{loc(p.caption, lang)}</div>
                  <span className="preset-cta">
                    {t("card.cta")} <span className="arrow">→</span>
                  </span>
                </div>
              </motion.button>
            ))}

            <motion.label
              className="byo-card"
              initial={{ opacity: 0, y: 26 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.6,
                delay: 0.15 + PRESETS.length * 0.07,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onOpenCustom(f);
                  e.currentTarget.value = "";
                }}
              />
              <span className="byo-plus">+</span>
              <span className="byo-title">{t("byo.title")}</span>
              <span className="byo-sub">{t("byo.sub")}</span>
            </motion.label>
          </div>
        </section>

        {items.length > 0 && (
          <section className="collection saved-collection">
            <div className="collection-head">
              <span className="label">{t("saved.title")}</span>
              <span className="rule" />
              <span className="label">
                {String(items.length).padStart(2, "0")} {t("collection.scenes")}
              </span>
            </div>

            <div className="gallery-grid">
              {items.map((item, i) => (
                <SavedCard
                  key={item.scene.id}
                  item={item}
                  index={i}
                  onOpen={() => onOpenSaved(item.scene)}
                  onDelete={() => remove(item.scene.id)}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function SavedCard({
  item,
  index,
  onOpen,
  onDelete,
}: {
  item: SavedSceneItem;
  index: number;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { t, lang } = useI18n();
  // two-click delete: first click arms, auto-disarms after 3s, second deletes
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  function handleDelete(e: ReactMouseEvent) {
    e.stopPropagation();
    if (!armed) {
      setArmed(true);
      timer.current = window.setTimeout(() => setArmed(false), 3000);
      return;
    }
    if (timer.current) window.clearTimeout(timer.current);
    onDelete();
  }

  return (
    <motion.div
      className="preset-card saved-card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      initial={{ opacity: 0, y: 26 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.1 + index * 0.07, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="preset-media">
        <span className="preset-index">N°{String(index + 1).padStart(2, "0")}</span>
        <img src={item.thumbUrl} alt={item.scene.name} loading="lazy" />
        <button
          type="button"
          className="saved-delete"
          data-armed={armed || undefined}
          aria-label={t("saved.delete")}
          onClick={handleDelete}
        >
          {armed ? t("saved.confirmDelete") : "×"}
        </button>
      </div>
      <div className="preset-body">
        <div className="preset-name">{item.scene.name}</div>
        <div className="preset-caption">
          {new Date(item.scene.updatedAt).toLocaleDateString(
            lang === "zh" ? "zh-CN" : "en-US",
          )}
        </div>
        <span className="preset-cta">
          {t("card.cta")} <span className="arrow">→</span>
        </span>
      </div>
    </motion.div>
  );
}
```

Notes for the implementer:
- `SavedCard` is a `div role="button"` (not `<button>`) because the delete button nests inside it and nested `<button>` elements are invalid HTML.
- `.preset-card` already sets `text-align: left` and `.preset-media` is `position: relative`, so the absolute `.saved-delete` anchors correctly.

- [ ] **Step 3: Wire `App.tsx`.** Change the destructuring line and the `<Gallery>` call:

```tsx
  const { state, openPreset, openCustom, openSaved } = api;
```

```tsx
          <Gallery onOpenPreset={openPreset} onOpenCustom={openCustom} onOpenSaved={openSaved} />
```

- [ ] **Step 4: Gallery CSS.** In `src/styles/app.css`, add after the `.byo-card input` rule (end of the gallery card block):

```css
/* ---- saved templates ---- */
.saved-collection { margin-top: clamp(36px, 6vw, 72px); }
.saved-card { cursor: pointer; }
.saved-delete {
  position: absolute;
  top: 10px;
  right: 12px;
  z-index: 2;
  min-width: 26px;
  height: 26px;
  padding: 0 8px;
  border: none;
  border-radius: 13px;
  background: rgba(27, 23, 20, 0.55);
  color: var(--paper-2);
  font-family: var(--mono);
  font-size: 13px;
  line-height: 26px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease;
}
.saved-card:hover .saved-delete,
.saved-delete:focus-visible,
.saved-delete[data-armed] { opacity: 1; }
.saved-delete[data-armed] { background: var(--vermilion); font-size: 11px; }
```

(Check the existing `.collection` rule for its own margin — if `.collection + .collection` spacing already looks right in the browser, drop the `.saved-collection` margin rule.)

- [ ] **Step 5: Typecheck**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useSavedScenes.ts src/components/Gallery.tsx src/App.tsx src/styles/app.css
git commit -m "feat(gallery): My Templates section with two-click delete"
```

---

### Task 6: Headless verification driver

**Files:**
- Create: `.claude/skills/run-billboard-replacer/saved-driver.mjs`
- Modify: `.claude/skills/run-billboard-replacer/SKILL.md`

This is the test for the whole feature, following the committed `mask-driver.mjs` convention (puppeteer-core + system Chrome + swiftshader flags). It verifies: save from custom upload (with dragged corner + painted mask), IDB record shape, mask PNG round-trip at the pixel level, reload persistence, reopen from the gallery, update-in-place, save-from-preset, and two-click delete.

- [ ] **Step 1: Create `.claude/skills/run-billboard-replacer/saved-driver.mjs`** with exactly:

```js
// Saved-scenes (user templates) driver for the billboard-replacer web app.
//
// Drives an ALREADY-RUNNING Vite dev server through the full template
// lifecycle:
//   wipe IDB -> upload a custom background -> drag the TL corner -> paint a
//   mask -> Save as template (named) -> assert the IndexedDB record (corners,
//   mask PNG pixels, thumb) -> reload -> "My Templates" card appears -> open
//   it -> canvas draws + tag reads "Saved template" -> Update template keeps
//   ONE record -> save a preset copy (2 records) -> two-click delete empties
//   the section -> reload stays empty.
//
// Usage:  node .claude/skills/run-billboard-replacer/saved-driver.mjs [url]
// Env:    CHROME_PATH, OUT  (same as driver.mjs)

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { mkdirSync, writeFileSync } from "fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, "/"));
const puppeteer = require("puppeteer-core");

const URL_ = process.argv[2] || "http://localhost:5173";
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = process.env.OUT || join(HERE, "screenshots");
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const ok = (name, pass, detail = "") => {
  checks.push({ name, pass });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// Read all SavedScene records (summarized, blob -> size) out of IndexedDB.
const readRecords = () =>
  new Promise((resolve, reject) => {
    const open = indexedDB.open("billboard-replacer");
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("scenes")) {
        db.close();
        resolve([]);
        return;
      }
      const tx = db.transaction("scenes", "readonly");
      const all = tx.objectStore("scenes").getAll();
      all.onsuccess = () => {
        db.close();
        resolve(
          all.result.map((r) => ({
            id: r.id,
            name: r.name,
            corners: r.corners,
            bgSize: r.bgBlob ? r.bgBlob.size : 0,
            maskSize: r.maskBlob ? r.maskBlob.size : null,
            thumbSize: r.thumbBlob ? r.thumbBlob.size : 0,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          })),
        );
      };
      all.onerror = () => {
        db.close();
        reject(all.error);
      };
    };
    open.onerror = () => reject(open.error);
  });

// Decode the FIRST record's maskBlob and return the white-pixel ratio inside
// the given normalized box — proves the painted mask survived the round-trip.
const maskWhiteRatio = (box) =>
  new Promise((resolve, reject) => {
    const open = indexedDB.open("billboard-replacer");
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("scenes", "readonly");
      const all = tx.objectStore("scenes").getAll();
      all.onsuccess = async () => {
        db.close();
        const rec = all.result[0];
        if (!rec || !rec.maskBlob) {
          resolve(-1);
          return;
        }
        const bmp = await createImageBitmap(rec.maskBlob);
        const c = document.createElement("canvas");
        c.width = bmp.width;
        c.height = bmp.height;
        const x = c.getContext("2d");
        x.drawImage(bmp, 0, 0);
        const d = x.getImageData(
          Math.round(box.x0 * bmp.width),
          Math.round(box.y0 * bmp.height),
          Math.max(1, Math.round((box.x1 - box.x0) * bmp.width)),
          Math.max(1, Math.round((box.y1 - box.y0) * bmp.height)),
        ).data;
        let white = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 200) white++;
        resolve(white / (d.length / 4));
      };
      all.onerror = () => {
        db.close();
        reject(all.error);
      };
    };
    open.onerror = () => reject(open.error);
  });

// Canvas drew something non-blank (>1 distinct color on a sample grid).
const canvasColors = () => {
  const c = document.querySelector("canvas");
  if (!c) return 0;
  const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
  const px = new Uint8Array(4);
  const seen = new Set();
  const n = 10;
  for (let i = 0; i < n * n; i++) {
    const x = (((i % n) / n) * c.width) | 0;
    const y = ((((i / n) | 0) / n) * c.height) | 0;
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    seen.add(`${px[0]},${px[1]},${px[2]}`);
  }
  return seen.size;
};

const clickByText = (selector, re) => {
  const rx = new RegExp(re);
  const b = [...document.querySelectorAll(selector)].find((x) =>
    rx.test((x.textContent || "").trim()),
  );
  if (b) b.click();
  return !!b;
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--no-sandbox",
    "--window-size=1440,900",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--enable-unsafe-swiftshader",
  ],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
});

const page = await browser.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + e.message));

try {
  // ---- clean slate: wipe the DB, then load fresh ----
  await page.goto(URL_, { waitUntil: "networkidle2", timeout: 30000 });
  await page.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.deleteDatabase("billboard-replacer");
        r.onsuccess = r.onerror = r.onblocked = () => res(null);
      }),
  );
  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForSelector("button.preset-card", { timeout: 15000 });
  const noSaved = await page.evaluate(() => !document.querySelector(".saved-card"));
  ok("clean start: no My Templates section", noSaved);

  // ---- upload a custom background via the BYO card ----
  const bgUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 800;
    const x = c.getContext("2d");
    x.fillStyle = "#28425c";
    x.fillRect(0, 0, 1200, 800);
    x.fillStyle = "#d9c9a3";
    x.fillRect(300, 200, 600, 360); // a flat "billboard" slab
    return c.toDataURL("image/png");
  });
  const bgFile = join(OUT, "_saved_bg.png");
  writeFileSync(bgFile, Buffer.from(bgUrl.split(",")[1], "base64"));
  await (await page.$('.byo-card input[type="file"]')).uploadFile(bgFile);
  await page.waitForSelector("canvas", { timeout: 15000 });
  await sleep(1200);

  // ---- drag the TL corner handle (index 0) to ~(0.20, 0.22) of the layer ----
  const layer = await page.evaluate(() => {
    const r = document.querySelector(".corner-layer").getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  const handle = await page.evaluate(() => {
    const h = document.querySelectorAll(".corner-layer .handle")[0].getBoundingClientRect();
    return { x: h.left + h.width / 2, y: h.top + h.height / 2 };
  });
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(layer.left + 0.2 * layer.width, layer.top + 0.22 * layer.height, {
    steps: 8,
  });
  await page.mouse.up();
  await sleep(400);

  // ---- paint a mask stroke across the middle of the stage ----
  await page.evaluate(clickByText, ".editor-bar-right button", "^(蒙版|Mask)$");
  await page.waitForSelector(".mask-toolbar", { timeout: 5000 });
  await page.evaluate(() => {
    const r = document.querySelector(".mask-toolbar input[type=range]");
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(r, r.max);
    r.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const holder = await page.evaluate(() => {
    const r = document.querySelector(".stage-canvas-holder").getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  const sx = (nx) => holder.left + nx * holder.width;
  const sy = (ny) => holder.top + ny * holder.height;
  await page.mouse.move(sx(0.3), sy(0.5));
  await page.mouse.down();
  await page.mouse.move(sx(0.7), sy(0.5), { steps: 12 });
  await page.mouse.up();
  await sleep(500);
  await page.evaluate(clickByText, ".editor-bar-right button", "^(完成|Done)$");
  await sleep(300);

  // ---- save as template, named ----
  const saveBtn = await page.evaluate(clickByText, ".export-bar button", "存为模板|Save as template");
  ok("Save-as-template button present", saveBtn);
  await page.waitForSelector(".save-name", { timeout: 5000 });
  await page.evaluate(() => {
    const i = document.querySelector(".save-name");
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(i, "CDP Template");
    i.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.evaluate(clickByText, ".save-row button", "^(保存|Save)$");
  const savedToast = await page
    .waitForFunction(
      () => /模板已保存|Template saved/.test(document.body.textContent || ""),
      { timeout: 15000 },
    )
    .then(() => true)
    .catch(() => false);
  ok("save shows the saved toast", savedToast);
  await page.screenshot({ path: join(OUT, "s1-saved.png") });

  // ---- IDB record assertions ----
  let recs = await page.evaluate(readRecords);
  ok("exactly one record after first save", recs.length === 1, `${recs.length} records`);
  const r0 = recs[0] || {};
  ok("record name persisted", r0.name === "CDP Template", r0.name);
  ok(
    "dragged TL corner persisted",
    !!r0.corners && Math.abs(r0.corners[0][0] - 0.2) < 0.05 && Math.abs(r0.corners[0][1] - 0.22) < 0.05,
    JSON.stringify(r0.corners && r0.corners[0]),
  );
  ok("bg + thumb blobs non-empty", r0.bgSize > 1000 && r0.thumbSize > 500,
     `bg ${r0.bgSize}B thumb ${r0.thumbSize}B`);
  ok("mask blob stored", r0.maskSize !== null && r0.maskSize > 100, `${r0.maskSize}B`);
  const ratio = await page.evaluate(maskWhiteRatio, { x0: 0.35, y0: 0.45, x1: 0.65, y1: 0.55 });
  ok("mask PNG has white paint where stroked", ratio > 0.3, `white ratio ${ratio.toFixed(2)}`);
  const updatedAt1 = r0.updatedAt;

  // ---- button flips to Update; update-in-place keeps ONE record ----
  await sleep(1100); // ensure updatedAt strictly increases
  const updBtn = await page.evaluate(clickByText, ".export-bar button", "更新模板|Update template");
  ok("button reads Update template after save", updBtn);
  await page.waitForSelector(".save-name", { timeout: 5000 });
  await page.evaluate(clickByText, ".save-row button", "^(保存|Save)$");
  await sleep(1500);
  recs = await page.evaluate(readRecords);
  ok(
    "re-save updates in place (1 record, newer updatedAt)",
    recs.length === 1 && recs[0].updatedAt > updatedAt1,
    `${recs.length} records`,
  );

  // ---- reload: My Templates card appears; open it ----
  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForSelector(".saved-card", { timeout: 15000 });
  const cardName = await page.evaluate(
    () => document.querySelector(".saved-card .preset-name")?.textContent,
  );
  ok("saved card survives reload with its name", cardName === "CDP Template", cardName || "none");
  await page.screenshot({ path: join(OUT, "s2-gallery.png") });
  await page.click(".saved-card");
  await page.waitForSelector("canvas", { timeout: 15000 });
  await sleep(1500);
  const colors = await page.evaluate(canvasColors);
  ok("reopened template renders a non-blank scene", colors > 1, `${colors} distinct colors`);
  const tag = await page.evaluate(() => document.querySelector(".editor-source .tag")?.textContent);
  ok("tag reads Saved template", /已存模板|Saved template/.test(tag || ""), tag || "none");
  await page.screenshot({ path: join(OUT, "s3-reopened.png") });

  // ---- back to gallery; save a PRESET as a second template ----
  await page.click(".editor-back");
  await page.waitForSelector("button.preset-card", { timeout: 15000 });
  await page.click("button.preset-card");
  await page.waitForSelector("canvas", { timeout: 15000 });
  await sleep(1200);
  await page.evaluate(clickByText, ".export-bar button", "存为模板|Save as template");
  await page.waitForSelector(".save-name", { timeout: 5000 });
  await page.evaluate(clickByText, ".save-row button", "^(保存|Save)$");
  await page
    .waitForFunction(
      () => /模板已保存|Template saved/.test(document.body.textContent || ""),
      { timeout: 20000 },
    )
    .catch(() => {});
  recs = await page.evaluate(readRecords);
  const presetRec = recs.find((r) => r.name !== "CDP Template");
  ok("preset saved as a second template", recs.length === 2, `${recs.length} records`);
  ok(
    "preset record holds fetched background bytes",
    !!presetRec && presetRec.bgSize > 10000,
    presetRec ? `${presetRec.bgSize}B` : "missing",
  );

  // ---- two-click delete both cards; section disappears and stays gone ----
  await page.click(".editor-back");
  await page.waitForSelector(".saved-card", { timeout: 15000 });
  for (let guard = 0; guard < 4; guard++) {
    const left = await page.evaluate(() => document.querySelectorAll(".saved-card").length);
    if (!left) break;
    await page.evaluate(() => document.querySelector(".saved-card .saved-delete").click());
    await sleep(150);
    const armed = await page.evaluate(
      () => !!document.querySelector(".saved-card .saved-delete[data-armed]"),
    );
    if (guard === 0) ok("first delete click arms (does not delete)", armed);
    await page.evaluate(() => document.querySelector(".saved-card .saved-delete").click());
    await sleep(300);
  }
  const sectionGone = await page.evaluate(() => !document.querySelector(".saved-collection"));
  ok("deleting all cards hides the section", sectionGone);
  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForSelector("button.preset-card", { timeout: 15000 });
  const stillGone = await page.evaluate(() => !document.querySelector(".saved-collection"));
  recs = await page.evaluate(readRecords);
  ok("deletion persists across reload", stillGone && recs.length === 0, `${recs.length} records`);

  ok(
    "no console errors during the saved-scenes flow",
    consoleErrors.length === 0,
    consoleErrors.length ? consoleErrors.slice(0, 3).join(" | ") : "",
  );
} finally {
  await Promise.race([browser.close().catch(() => {}), sleep(6000)]);
}

const failed = checks.filter((c) => !c.pass).length;
console.log(
  `\n${failed ? "FAIL" : "PASS"} — ${checks.length - failed}/${checks.length} checks, screenshots in ${OUT}`,
);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run it (it should FAIL before Tasks 1–5 are merged, PASS after).**

```bash
npm run dev &
until curl -sf http://localhost:5173 >/dev/null; do sleep 1; done
node .claude/skills/run-billboard-replacer/saved-driver.mjs
```

Expected on the finished feature: `PASS — 20/20 checks` (count may differ slightly if checks are adjusted; all must PASS) and screenshots `s1-saved.png`, `s2-gallery.png`, `s3-reopened.png` in `.claude/skills/run-billboard-replacer/screenshots/`. **Open the screenshots and look at them** — s3 must show the reopened scene with the background image, per SKILL.md's "a blank frame is a failure even if checks pass".

If a check fails, debug the app (or a stale selector in the driver), fix, and re-run until all pass. Also re-run the existing drivers to catch regressions:

```bash
node .claude/skills/run-billboard-replacer/driver.mjs
node .claude/skills/run-billboard-replacer/mask-driver.mjs
pkill -f 'vite'
```

Expected: both still all-PASS (6/6 and 8/8 respectively).

- [ ] **Step 3: Document the driver.** In `.claude/skills/run-billboard-replacer/SKILL.md`, after the paragraph introducing `driver.mjs` (ends with "drops screenshots in `screenshots/`."), add:

```markdown
Two feature drivers extend it: [`mask-driver.mjs`](mask-driver.mjs) (brush
occlusion mask) and [`saved-driver.mjs`](saved-driver.mjs) (saved templates:
save → IndexedDB record + mask round-trip → reload → reopen → update-in-place
→ delete). Run them the same way; both expect the dev server to be up.
```

(If a sentence about `mask-driver.mjs` already exists there, merge rather than duplicate.)

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/run-billboard-replacer/saved-driver.mjs .claude/skills/run-billboard-replacer/SKILL.md
git commit -m "test(saved): headless saved-scenes verification driver"
```

---

## Final acceptance checklist

- [ ] `npm run build` clean.
- [ ] `saved-driver.mjs` all checks PASS; screenshots eyeballed.
- [ ] `driver.mjs` and `mask-driver.mjs` still PASS (no regression).
- [ ] Manual spot-check in the dev browser (optional): save a template in 中文 UI, switch to EN, names/toasts read correctly.
