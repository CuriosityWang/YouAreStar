# Admin Publish Official Templates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the admin a dev-only in-app pipeline to author and publish official preset scenes — set corners, paint or import an occlusion mask, enter bilingual name/caption, click Publish — which writes the bg + mask PNG into `public/billboards/` and upserts a JSON manifest that ships via git.

**Architecture:** Preset data moves from a hand-edited array in `presets.ts` into a machine-owned `src/data/billboards.json`. A Vite dev middleware (`apply: 'serve'`) at `POST /__publish-template` writes assets and upserts the manifest; HMR makes the card appear. A dependency-free `presetManifest.ts` holds the pure logic shared by the Node plugin and the browser client. All publish UI is gated behind `import.meta.env.DEV` so production tree-shakes it.

**Tech Stack:** React 18 + Vite 5 + TypeScript (strict), raw WebGL, framer-motion. No test runner — pure logic tested via `node:assert` + `npx tsx`; flows verified headlessly via puppeteer-core drivers.

**Spec:** `docs/superpowers/specs/2026-06-13-admin-publish-official-templates-design.md`

---

## File structure

**New**
- `src/data/billboards.json` — the 5 presets as plain data; the only file the plugin rewrites.
- `src/lib/presetManifest.ts` — dependency-free shared core (types, `slug`, `mimeToExt`, validators, `upsertPreset`).
- `src/lib/presetManifest.test.ts` — unit tests (node:assert).
- `src/lib/publishTemplate.ts` — browser client (`buildPayload`, `publishTemplate`, `downloadFallback`).
- `src/lib/admin.ts` — `IS_ADMIN` flag.
- `vite-plugin-publish-template.ts` — dev middleware.
- `src/components/Editor/PublishModal.tsx` — the modal form.
- `.claude/skills/run-billboard-replacer/publish-driver.mjs` — endpoint integration driver.

**Modified**
- `src/data/presets.ts` — import the JSON, keep types + doc comment.
- `vite.config.ts` — register the plugin.
- `src/hooks/useEditor.ts` — add `importMask(file)` to the api.
- `src/components/Editor/Editor.tsx` — dev-gated Publish button + modal mount.
- `src/i18n/index.tsx` — `publish.*` strings (bilingual).
- `src/styles/app.css` — modal styling.
- `package.json` / `tsconfig.json` — `@types/node` (the plugin needs Node types).
- `CLAUDE.md` — replace the manual "Adding a preset scene" section.

---

## Task 1: Migrate presets to a JSON manifest

**Files:**
- Create: `src/data/billboards.json`
- Modify: `src/data/presets.ts`

- [ ] **Step 1: Create `src/data/billboards.json`** — the 5 current presets, verbatim:

```json
[
  {
    "id": "times-square-night",
    "name": { "en": "Times Square — Night Marquee", "zh": "时代广场 · 夜色巨幕" },
    "caption": { "en": "A rain-slick night; the big screen rides above the corner.", "zh": "雨夜街角——巨幕高悬于餐厅之上。" },
    "src": "/billboards/times-square-night.jpg",
    "corners": [[0.0737, 0.3427], [0.5857, 0.1391], [0.5865, 0.3853], [0.0691, 0.4618]]
  },
  {
    "id": "times-square-corner",
    "name": { "en": "Times Square — The Corner", "zh": "时代广场 · 转角斜切" },
    "caption": { "en": "Neon crossing at night — a tall panel raking hard to the right.", "zh": "霓虹夜路口——高大灯箱强烈向右斜切。" },
    "src": "/billboards/times-square-corner.jpg",
    "corners": [[0.076, 0.2097], [0.1669, 0.3498], [0.1615, 0.4881], [0.0638, 0.4089]]
  },
  {
    "id": "gallery-wall",
    "name": { "en": "The Gallery Wall", "zh": "画廊墙面" },
    "caption": { "en": "Cool museum light — a large canvas at three-quarter view.", "zh": "冷调展厅光——三分之四视角的大幅画作。" },
    "src": "/billboards/gallery-wall.jpg",
    "corners": [[0.2521, 0.2119], [0.5953, 0.2117], [0.596, 0.8718], [0.2549, 0.6936]]
  },
  {
    "id": "street-kiosk",
    "name": { "en": "The Street Kiosk", "zh": "街头立柱" },
    "caption": { "en": "Open air — a vertical poster panel at the bus stop.", "zh": "户外——公交站旁的竖式海报灯箱。" },
    "src": "/billboards/street-kiosk.jpg",
    "corners": [[0.3001, 0.1962], [0.6085, 0.2129], [0.6119, 0.7318], [0.3003, 0.7448]]
  },
  {
    "id": "subway-platform",
    "name": { "en": "The Subway Platform", "zh": "地铁站台" },
    "caption": { "en": "Underground — a long panel raking down the concourse.", "zh": "地下长廊——沿墙斜展的灯箱广告。" },
    "src": "/billboards/subway-platform.jpg",
    "corners": [[0.0016, 0.3985], [0.4519, 0.5052], [0.4536, 0.5784], [0.0006, 0.721]]
  }
]
```

- [ ] **Step 2: Rewrite `src/data/presets.ts`** — keep types + the corner-ordering doc comment, import the JSON. Replace the whole file body below the comment:

```ts
import type { LocalizedString } from "../i18n";
import billboards from "./billboards.json";

export type Corner = [number, number];
export type Corners = [Corner, Corner, Corner, Corner];

export interface Preset {
  id: string;
  name: LocalizedString;
  /** short editorial caption shown under the gallery card */
  caption: LocalizedString;
  /** path under /public */
  src: string;
  corners: Corners;
  /** optional occlusion mask PNG (white = foreground that stays in front) */
  mask?: string;
}

// Preset data lives in ./billboards.json so the dev-only "Publish official
// template" flow can write entries (and mask paths) without rewriting TS.
// See CLAUDE.md → "Adding a preset scene".
export const PRESETS = billboards as unknown as Preset[];
```

Keep the existing top-of-file `//` doc block (the `[TL, TR, BR, BL]` diagram). Update its "To add a real photo" paragraph to point at the publish flow + `billboards.json`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 4: Headless gallery check** (dev server must be up)

Run:
```bash
npm run dev & until curl -sf http://localhost:5173 >/dev/null; do sleep 1; done
node .claude/skills/run-billboard-replacer/driver.mjs
```
Expected: `PASS gallery renders preset cards — 5 cards`. Stop with `pkill -f vite`.

- [ ] **Step 5: Commit**

```bash
git add src/data/billboards.json src/data/presets.ts
git commit -m "refactor(presets): move preset data into billboards.json manifest"
```

---

## Task 2: Dependency-free shared core `presetManifest.ts` (TDD)

**Files:**
- Create: `src/lib/presetManifest.ts`
- Test: `src/lib/presetManifest.test.ts`

- [ ] **Step 1: Write the failing test** `src/lib/presetManifest.test.ts`:

```ts
import assert from "node:assert/strict";
import {
  slug,
  isSafeId,
  mimeToExt,
  isAllowedExt,
  isValidCorners,
  isLocalizedText,
  upsertPreset,
  type PresetEntry,
} from "./presetManifest";

// slug
assert.equal(slug("Times Square — Night!"), "times-square-night");
assert.equal(slug("   "), "scene");
assert.equal(slug("已经"), "scene"); // non-latin collapses to fallback

// isSafeId
assert.equal(isSafeId("times-square-night"), true);
assert.equal(isSafeId("../etc/passwd"), false);
assert.equal(isSafeId("-leading"), false);
assert.equal(isSafeId("UPPER"), false);
assert.equal(isSafeId(""), false);

// mimeToExt / isAllowedExt
assert.equal(mimeToExt("image/jpeg"), "jpg");
assert.equal(mimeToExt("image/svg+xml"), "svg");
assert.equal(mimeToExt("image/gif"), null);
assert.equal(isAllowedExt("PNG"), true);
assert.equal(isAllowedExt("gif"), false);

// isValidCorners
assert.equal(isValidCorners([[0, 0], [1, 0], [1, 1], [0, 1]]), true);
assert.equal(isValidCorners([[0, 0], [1, 0], [1, 1]]), false); // too few
assert.equal(isValidCorners([[0, 0], [1, 0], [1, 1], [0, 1.2]]), false); // out of range

// isLocalizedText
assert.equal(isLocalizedText({ en: "a", zh: "啊" }), true);
assert.equal(isLocalizedText({ en: "a", zh: "" }), false);
assert.equal(isLocalizedText({ en: "a" }), false);

// upsertPreset: append when id is new
const base: PresetEntry[] = [
  { id: "a", name: { en: "A", zh: "A" }, caption: { en: "", zh: "" }, src: "/billboards/a.jpg", corners: [[0,0],[1,0],[1,1],[0,1]] },
];
const appended = upsertPreset(base, {
  id: "b", name: { en: "B", zh: "B" }, caption: { en: "", zh: "" }, src: "/billboards/b.jpg", corners: [[0,0],[1,0],[1,1],[0,1]],
});
assert.equal(appended.length, 2);
assert.equal(appended[1].id, "b");
assert.equal(base.length, 1); // input not mutated

// upsertPreset: replace in place (position preserved), add mask
const two: PresetEntry[] = [
  { id: "a", name: { en: "A", zh: "A" }, caption: { en: "", zh: "" }, src: "/billboards/a.jpg", corners: [[0,0],[1,0],[1,1],[0,1]] },
  { id: "b", name: { en: "B", zh: "B" }, caption: { en: "", zh: "" }, src: "/billboards/b.jpg", corners: [[0,0],[1,0],[1,1],[0,1]] },
];
const replaced = upsertPreset(two, {
  id: "a", name: { en: "A2", zh: "A2" }, caption: { en: "", zh: "" }, src: "/billboards/a.jpg", corners: [[0,0],[1,0],[1,1],[0,1]], mask: "/billboards/a-mask.png",
});
assert.equal(replaced.length, 2);
assert.equal(replaced[0].name.en, "A2");
assert.equal(replaced[0].mask, "/billboards/a-mask.png");
assert.equal(replaced[1].id, "b"); // order preserved

console.log("presetManifest.test.ts: all assertions passed");
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx tsx src/lib/presetManifest.test.ts`
Expected: FAIL — `Cannot find module './presetManifest'`.

- [ ] **Step 3: Implement `src/lib/presetManifest.ts`**:

```ts
// Plain, dependency-free preset-manifest helpers shared by the browser client
// (src/lib/publishTemplate.ts) and the Vite dev plugin
// (vite-plugin-publish-template.ts). MUST NOT import DOM or Node APIs — it is
// imported into both a browser bundle and a Node process.

export interface LocalizedText {
  en: string;
  zh: string;
}
export type CornerTuple = [number, number];
export type CornersTuple = [CornerTuple, CornerTuple, CornerTuple, CornerTuple];

export interface PresetEntry {
  id: string;
  name: LocalizedText;
  caption: LocalizedText;
  src: string;
  corners: CornersTuple;
  mask?: string;
}

export const EXT_ALLOWLIST = ["jpg", "jpeg", "png", "webp", "svg"] as const;
export type AllowedExt = (typeof EXT_ALLOWLIST)[number];

/** kebab-case slug; mirrors the id/filename rule the editor already uses. */
export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "scene";
}

/** Preset ids / filenames must be a safe slug — guards path traversal. */
export function isSafeId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(id);
}

const MIME_EXT: Record<string, AllowedExt> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

/** Map an image MIME type to an allowed extension, or null if unsupported. */
export function mimeToExt(mime: string): AllowedExt | null {
  return MIME_EXT[mime.toLowerCase()] ?? null;
}

export function isAllowedExt(ext: string): ext is AllowedExt {
  return (EXT_ALLOWLIST as readonly string[]).includes(ext.toLowerCase());
}

/** 4 corner pairs, each finite and within [0,1]. */
export function isValidCorners(c: unknown): c is CornersTuple {
  return (
    Array.isArray(c) &&
    c.length === 4 &&
    c.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1),
    )
  );
}

export function isLocalizedText(v: unknown): v is LocalizedText {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.en === "string" && o.en.trim() !== "" &&
    typeof o.zh === "string" && o.zh.trim() !== ""
  );
}

/** Replace the entry sharing `entry.id` (position preserved) or append it.
 *  Pure — returns a new array, never mutates the input. */
export function upsertPreset(list: PresetEntry[], entry: PresetEntry): PresetEntry[] {
  const i = list.findIndex((p) => p.id === entry.id);
  if (i === -1) return [...list, entry];
  const next = list.slice();
  next[i] = entry;
  return next;
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npx tsx src/lib/presetManifest.test.ts`
Expected: `presetManifest.test.ts: all assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/presetManifest.ts src/lib/presetManifest.test.ts
git commit -m "feat(presets): pure preset-manifest core (upsert, slug, validators)"
```

---

## Task 3: Vite dev plugin

**Files:**
- Create: `vite-plugin-publish-template.ts`
- Modify: `vite.config.ts`, `package.json` (add `@types/node`), `tsconfig.json` (no change if include already covers root via the config import)

- [ ] **Step 1: Add Node types** (the plugin uses `node:fs`, `Buffer`, `IncomingMessage`)

Run: `npm install -D @types/node@^22`
Expected: installs; `package.json` devDependencies gains `@types/node`.

- [ ] **Step 2: Create `vite-plugin-publish-template.ts`**:

```ts
import type { Plugin } from "vite";
import type { IncomingMessage } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  isSafeId,
  isAllowedExt,
  isValidCorners,
  isLocalizedText,
  upsertPreset,
  type PresetEntry,
} from "./src/lib/presetManifest";

const ROUTE = "/__publish-template";

interface PublishBody {
  id: string;
  name: { en: string; zh: string };
  caption: { en: string; zh: string };
  corners: PresetEntry["corners"];
  bg: { base64: string; ext: string } | null;
  maskPng: string | null;
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

/** Dev-only endpoint that publishes an official template: writes the bg + mask
 *  PNG into public/billboards/ and upserts src/data/billboards.json. */
export function publishTemplatePlugin(): Plugin {
  return {
    name: "publish-template",
    apply: "serve",
    configureServer(server) {
      const root = server.config.root;
      const billboardsDir = path.resolve(root, "public/billboards");
      const manifestPath = path.resolve(root, "src/data/billboards.json");
      const within = (p: string) =>
        p === billboardsDir || p.startsWith(billboardsDir + path.sep);

      server.middlewares.use(ROUTE, async (req, res) => {
        const send = (code: number, obj: unknown) => {
          res.statusCode = code;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(obj));
        };
        if (req.method !== "POST") return send(405, { ok: false, error: "POST only" });
        try {
          const body = (await readJson(req)) as PublishBody;
          if (!body || !isSafeId(body.id)) return send(400, { ok: false, error: "invalid id" });
          if (!isLocalizedText(body.name)) return send(400, { ok: false, error: "name needs en+zh" });
          if (!isLocalizedText(body.caption)) return send(400, { ok: false, error: "caption needs en+zh" });
          if (!isValidCorners(body.corners)) return send(400, { ok: false, error: "invalid corners" });

          let list: PresetEntry[] = [];
          try {
            list = JSON.parse(await fs.readFile(manifestPath, "utf8")) as PresetEntry[];
          } catch {
            list = [];
          }
          const existing = list.find((p) => p.id === body.id);

          await fs.mkdir(billboardsDir, { recursive: true });

          let src: string;
          if (body.bg) {
            const ext = body.bg.ext.toLowerCase();
            if (!isAllowedExt(ext)) return send(400, { ok: false, error: `ext not allowed: ${ext}` });
            const file = path.resolve(billboardsDir, `${body.id}.${ext}`);
            if (!within(file)) return send(400, { ok: false, error: "path escape" });
            await fs.writeFile(file, Buffer.from(body.bg.base64, "base64"));
            src = `/billboards/${body.id}.${ext}`;
          } else if (existing) {
            src = existing.src;
          } else {
            return send(400, { ok: false, error: "new template needs a background image" });
          }

          let mask = existing?.mask;
          if (body.maskPng) {
            const file = path.resolve(billboardsDir, `${body.id}-mask.png`);
            if (!within(file)) return send(400, { ok: false, error: "path escape" });
            await fs.writeFile(file, Buffer.from(body.maskPng, "base64"));
            mask = `/billboards/${body.id}-mask.png`;
          }

          const entry: PresetEntry = {
            id: body.id,
            name: body.name,
            caption: body.caption,
            src,
            corners: body.corners,
            ...(mask ? { mask } : {}),
          };
          const next = upsertPreset(list, entry);
          await fs.writeFile(manifestPath, JSON.stringify(next, null, 2) + "\n", "utf8");

          return send(200, { ok: true, src, mask: mask ?? null, updated: !!existing });
        } catch (e) {
          server.config.logger.error(`[publish-template] ${String(e)}`);
          return send(500, { ok: false, error: String((e as Error)?.message ?? e) });
        }
      });
    },
  };
}
```

- [ ] **Step 3: Register it in `vite.config.ts`**:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { publishTemplatePlugin } from "./vite-plugin-publish-template";

export default defineConfig({
  plugins: [react(), publishTemplatePlugin()],
  server: { port: 5173, open: true },
});
```

- [ ] **Step 4: Typecheck + smoke the endpoint**

Run: `npx tsc -b`
Expected: no errors.

Then (dev up):
```bash
npm run dev & until curl -sf http://localhost:5173 >/dev/null; do sleep 1; done
curl -s -X POST http://localhost:5173/__publish-template -H 'content-type: application/json' -d '{"id":"bad id"}'
```
Expected: `{"ok":false,"error":"invalid id"}`. Stop with `pkill -f vite`.

- [ ] **Step 5: Commit**

```bash
git add vite-plugin-publish-template.ts vite.config.ts package.json package-lock.json tsconfig.json
git commit -m "feat(dev): vite middleware to publish official templates"
```

---

## Task 4: Browser client + admin flag

**Files:**
- Create: `src/lib/publishTemplate.ts`, `src/lib/admin.ts`

- [ ] **Step 1: Create `src/lib/admin.ts`**:

```ts
/** Admin-only tooling (publish official templates) is dev-only and tree-shaken
 *  out of production builds via this flag. */
export const IS_ADMIN = import.meta.env.DEV;
```

(If `npx tsc -b` complains that `import.meta.env` is untyped, confirm `src/vite-env.d.ts` exists with `/// <reference types="vite/client" />`; create it if missing.)

- [ ] **Step 2: Create `src/lib/publishTemplate.ts`**:

```ts
// Browser-side publish client. POSTs to the dev middleware; on failure, falls
// back to downloading the assets + copying the manifest entry to the clipboard.
// Pure helpers come from ./presetManifest (shared with the Node plugin).

import { canvasToBlob } from "./loadImage";
import type { EditorSource } from "../hooks/useEditor";
import { mimeToExt, type PresetEntry } from "./presetManifest";

export interface PublishPayload {
  id: string;
  name: { en: string; zh: string };
  caption: { en: string; zh: string };
  corners: PresetEntry["corners"];
  bg: { base64: string; ext: string } | null;
  maskPng: string | null;
}
export interface PublishResult {
  ok: true;
  src: string;
  mask: string | null;
  updated: boolean;
}

const ROUTE = "/__publish-template";

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBlob(b64: string, type = ""): Blob {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Blob([bytes], type ? { type } : undefined);
}

export async function buildPayload(opts: {
  id: string;
  name: { en: string; zh: string };
  caption: { en: string; zh: string };
  corners: PresetEntry["corners"];
  source: EditorSource;
  includeBg: boolean;
  includeMask: boolean;
}): Promise<PublishPayload> {
  const { source } = opts;
  let bg: PublishPayload["bg"] = null;
  if (opts.includeBg) {
    let blob = source.bgBlob;
    if (!blob) {
      if (!source.bgSrc) throw new Error("no background bytes to publish");
      const res = await fetch(source.bgSrc);
      if (!res.ok) throw new Error(`fetch ${source.bgSrc}: ${res.status}`);
      blob = await res.blob();
    }
    const ext = mimeToExt(blob.type) ?? "png";
    bg = { base64: await blobToBase64(blob), ext };
  }
  let maskPng: string | null = null;
  if (opts.includeMask && source.maskCanvas) {
    maskPng = await blobToBase64(await canvasToBlob(source.maskCanvas.canvas, "image/png"));
  }
  return { id: opts.id, name: opts.name, caption: opts.caption, corners: opts.corners, bg, maskPng };
}

export async function publishTemplate(payload: PublishPayload): Promise<PublishResult> {
  const res = await fetch(ROUTE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => null)) as (PublishResult & { error?: string }) | null;
  if (!res.ok || !data?.ok) throw new Error(data?.error ?? `publish failed: ${res.status}`);
  return data;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Fallback when the dev endpoint is unavailable: download assets + copy the
 *  manifest entry snippet for manual paste/commit. */
export async function downloadFallback(payload: PublishPayload): Promise<void> {
  const ext = payload.bg?.ext ?? "png";
  if (payload.bg) triggerDownload(base64ToBlob(payload.bg.base64), `${payload.id}.${ext}`);
  if (payload.maskPng) triggerDownload(base64ToBlob(payload.maskPng, "image/png"), `${payload.id}-mask.png`);
  const entry: PresetEntry = {
    id: payload.id,
    name: payload.name,
    caption: payload.caption,
    src: `/billboards/${payload.id}.${ext}`,
    corners: payload.corners,
    ...(payload.maskPng ? { mask: `/billboards/${payload.id}-mask.png` } : {}),
  };
  try {
    await navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
  } catch {
    /* clipboard blocked; files still downloaded */
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/publishTemplate.ts src/lib/admin.ts src/vite-env.d.ts
git commit -m "feat(publish): browser publish client + admin flag"
```

---

## Task 5: `importMask` editor helper

**Files:**
- Modify: `src/hooks/useEditor.ts`

- [ ] **Step 1:** In `useEditor`, add an `importMask` callback after `ensureMask` (it already imports `createMaskCanvas`, `drawBaseImage`, `fileToImage`):

```ts
const importMask = useCallback(async (file: File) => {
  const src = sourceRef.current;
  if (!src) return;
  try {
    const img = await fileToImage(file);
    // Fresh canvas → new reference so EditorStage re-uploads; replaces any
    // current paint (import = replace, as expected for "load a mask file").
    const mask = createMaskCanvas(src.bgWidth, src.bgHeight);
    drawBaseImage(mask, img);
    dispatch({ type: "SET_MASK_CANVAS", mask });
  } catch (e) {
    console.error(e);
    dispatch({ type: "ERROR", message: "error.load" });
  }
}, []);
```

- [ ] **Step 2:** Add `importMask` to the returned api object (alongside `ensureMask`).

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useEditor.ts
git commit -m "feat(editor-state): importMask helper (load a mask file into the canvas)"
```

---

## Task 6: i18n strings

**Files:**
- Modify: `src/i18n/index.tsx`

- [ ] **Step 1:** Add these entries to `STRINGS` (anywhere inside the object; group them together). All bilingual:

```ts
  "publish.open": { en: "Publish as template", zh: "发布为官方模板" },
  "publish.title": { en: "Publish official template", zh: "发布官方模板" },
  "publish.nameEn": { en: "Name (EN)", zh: "名称（英文）" },
  "publish.nameZh": { en: "Name (中文)", zh: "名称（中文）" },
  "publish.captionEn": { en: "Caption (EN)", zh: "说明（英文）" },
  "publish.captionZh": { en: "Caption (中文)", zh: "说明（中文）" },
  "publish.id": { en: "ID (slug)", zh: "ID（标识）" },
  "publish.idHint": { en: "Lowercase letters, numbers, hyphens.", zh: "仅限小写字母、数字、连字符。" },
  "publish.idCollision": { en: "Updates the existing preset with this ID.", zh: "将覆盖同 ID 的现有模板。" },
  "publish.mask": { en: "Occlusion mask", zh: "遮挡蒙版" },
  "publish.maskImport": { en: "Import mask…", zh: "导入蒙版……" },
  "publish.maskPainted": { en: "mask ready", zh: "蒙版已就绪" },
  "publish.maskNone": { en: "no mask", zh: "无蒙版" },
  "publish.maskHint": { en: "White = foreground that stays in front of the ad.", zh: "白色＝保留在广告前方的前景。" },
  "publish.submit": { en: "Publish", zh: "发布" },
  "publish.publishing": { en: "Publishing…", zh: "发布中……" },
  "publish.cancel": { en: "Cancel", zh: "取消" },
  "publish.done": { en: "Published — commit to ship.", zh: "已发布——提交后即可上线。" },
  "publish.fallback": { en: "Endpoint unavailable — downloaded files + copied the entry.", zh: "接口不可用——已下载文件并复制条目。" },
  "publish.error": { en: "Publish failed.", zh: "发布失败。" },
```

- [ ] **Step 2: Typecheck** (confirms `TKey` picked up the new keys)

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/i18n/index.tsx
git commit -m "feat(i18n): strings for publish-official-template flow"
```

---

## Task 7: PublishModal component + Editor wiring + CSS

**Files:**
- Create: `src/components/Editor/PublishModal.tsx`
- Modify: `src/components/Editor/Editor.tsx`, `src/styles/app.css`

- [ ] **Step 1: Create `src/components/Editor/PublishModal.tsx`**:

```tsx
import { useMemo, useState } from "react";
import type { EditorSource } from "../../hooks/useEditor";
import { loc, useI18n } from "../../i18n";
import { Button } from "../ui/controls";
import { slug } from "../../lib/presetManifest";
import {
  buildPayload,
  publishTemplate,
  downloadFallback,
  type PublishResult,
} from "../../lib/publishTemplate";

export function PublishModal({
  source,
  maskTouched,
  knownPresetIds,
  onImportMask,
  onClose,
  onPublished,
}: {
  source: EditorSource;
  maskTouched: boolean;
  knownPresetIds: string[];
  onImportMask: (file: File) => void;
  onClose: () => void;
  onPublished: (result: PublishResult, key: "publish.done" | "publish.fallback") => void;
}) {
  const { t, lang } = useI18n();
  const seedName = loc(source.name, lang);
  const seedCaption = source.caption ? loc(source.caption, lang) : "";

  const [nameEn, setNameEn] = useState(typeof source.name === "string" ? source.name : source.name.en);
  const [nameZh, setNameZh] = useState(typeof source.name === "string" ? source.name : source.name.zh);
  const [capEn, setCapEn] = useState(
    typeof source.caption === "string" ? source.caption : source.caption?.en ?? "",
  );
  const [capZh, setCapZh] = useState(
    typeof source.caption === "string" ? source.caption : source.caption?.zh ?? "",
  );
  const [id, setId] = useState(source.presetId ?? slug(nameEn || seedName));
  const [idEdited, setIdEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const collision = useMemo(
    () => id !== source.presetId && knownPresetIds.includes(id),
    [id, knownPresetIds, source.presetId],
  );

  const hasMask = maskTouched && !!source.maskCanvas;
  const canSubmit = !!nameEn.trim() && !!nameZh.trim() && !!capEn.trim() && !!capZh.trim() && !!id.trim() && !busy;

  function onNameEn(v: string) {
    setNameEn(v);
    if (!idEdited && !source.presetId) setId(slug(v));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const includeBg = source.kind !== "preset" || id !== source.presetId;
    try {
      const payload = await buildPayload({
        id,
        name: { en: nameEn.trim(), zh: nameZh.trim() },
        caption: { en: capEn.trim(), zh: capZh.trim() },
        corners: source.corners,
        source,
        includeBg,
        includeMask: hasMask,
      });
      try {
        const result = await publishTemplate(payload);
        onPublished(result, "publish.done");
      } catch {
        await downloadFallback(payload);
        onPublished({ ok: true, src: `/billboards/${id}`, mask: null, updated: false }, "publish.fallback");
      }
    } catch (e) {
      console.error(e);
      setError(t("publish.error"));
      setBusy(false);
    }
  }

  return (
    <div className="publish-scrim" onClick={onClose}>
      <div className="publish-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="publish-h">{t("publish.title")}</h3>

        <label className="publish-field">
          <span>{t("publish.nameEn")}</span>
          <input value={nameEn} onChange={(e) => onNameEn(e.target.value)} autoFocus />
        </label>
        <label className="publish-field">
          <span>{t("publish.nameZh")}</span>
          <input value={nameZh} onChange={(e) => setNameZh(e.target.value)} />
        </label>
        <label className="publish-field">
          <span>{t("publish.captionEn")}</span>
          <input value={capEn} onChange={(e) => setCapEn(e.target.value)} />
        </label>
        <label className="publish-field">
          <span>{t("publish.captionZh")}</span>
          <input value={capZh} onChange={(e) => setCapZh(e.target.value)} />
        </label>
        <label className="publish-field">
          <span>{t("publish.id")}</span>
          <input
            value={id}
            onChange={(e) => {
              setIdEdited(true);
              setId(e.target.value);
            }}
          />
        </label>
        <p className="publish-note">{collision ? t("publish.idCollision") : t("publish.idHint")}</p>

        <div className="publish-mask">
          <span className="publish-mask-status">{hasMask ? t("publish.maskPainted") : t("publish.maskNone")}</span>
          <label className="publish-import">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onImportMask(f);
                e.currentTarget.value = "";
              }}
            />
            {t("publish.maskImport")}
          </label>
        </div>
        <p className="publish-note">{t("publish.maskHint")}</p>

        {error && <p className="publish-error">{error}</p>}

        <div className="publish-actions">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("publish.cancel")}
          </Button>
          <Button variant="accent" onClick={submit} disabled={!canSubmit}>
            {busy ? t("publish.publishing") : t("publish.submit")}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

Note: `seedName`/`seedCaption` are used as fallbacks for the id seed; if lint flags `seedCaption` unused, drop it.

- [ ] **Step 2: Wire into `src/components/Editor/Editor.tsx`**
  - Add imports:
    ```ts
    import { IS_ADMIN } from "../../lib/admin";
    import { PublishModal } from "./PublishModal";
    import { PRESETS } from "../../data/presets";
    import type { PublishResult } from "../../lib/publishTemplate";
    ```
  - Destructure `importMask` and `backToGallery` from `api` (backToGallery already destructured).
  - Add state: `const [publishOpen, setPublishOpen] = useState(false);`
  - In the export-bar `<div className="row">` that holds the save button, add (gated):
    ```tsx
    {IS_ADMIN && (
      <Button variant="ghost" onClick={() => setPublishOpen(true)}>
        {t("publish.open")}
      </Button>
    )}
    ```
  - Add a handler:
    ```ts
    function handlePublished(_r: PublishResult, key: "publish.done" | "publish.fallback") {
      setPublishOpen(false);
      flash(t(key));
      backToGallery();
    }
    ```
  - Mount the modal near the end of the editor JSX (inside the outer `.editor` div):
    ```tsx
    {IS_ADMIN && publishOpen && (
      <PublishModal
        source={s}
        maskTouched={state.maskTouched}
        knownPresetIds={PRESETS.map((p) => p.id)}
        onImportMask={importMask}
        onClose={() => setPublishOpen(false)}
        onPublished={handlePublished}
      />
    )}
    ```

- [ ] **Step 3: Add modal CSS to `src/styles/app.css`** (reuse existing tokens; match the editorial look):

```css
/* --- Publish official template modal (admin, dev-only) --- */
.publish-scrim {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  background: rgba(20, 16, 12, 0.45);
  backdrop-filter: blur(2px);
  padding: 24px;
}
.publish-modal {
  width: min(440px, 100%);
  max-height: 90vh;
  overflow: auto;
  background: var(--paper, #f4efe6);
  border: 1px solid var(--line, rgba(0, 0, 0, 0.16));
  border-radius: 10px;
  padding: 22px 22px 18px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.28);
}
.publish-h {
  margin: 0 0 14px;
  font-family: var(--font-display, "Fraunces", serif);
  font-size: 20px;
}
.publish-field {
  display: grid;
  gap: 4px;
  margin-bottom: 10px;
  font-size: 12px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  opacity: 0.85;
}
.publish-field input {
  font: inherit;
  font-size: 14px;
  text-transform: none;
  letter-spacing: normal;
  padding: 8px 10px;
  border: 1px solid var(--line, rgba(0, 0, 0, 0.18));
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.5);
}
.publish-note {
  margin: -2px 0 12px;
  font-size: 12px;
  opacity: 0.7;
}
.publish-mask {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 6px;
}
.publish-mask-status {
  font-size: 13px;
}
.publish-import {
  position: relative;
  overflow: hidden;
  cursor: pointer;
  font-size: 13px;
  color: var(--vermilion, #d23c25);
}
.publish-import input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.publish-error {
  color: var(--vermilion, #d23c25);
  font-size: 13px;
  margin: 6px 0 0;
}
.publish-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}
```

- [ ] **Step 4: Typecheck + production build (proves the admin code tree-shakes cleanly)**

Run: `npm run build`
Expected: `tsc -b` clean, `vite build` succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/Editor/PublishModal.tsx src/components/Editor/Editor.tsx src/styles/app.css
git commit -m "feat(editor): dev-only Publish official template modal"
```

---

## Task 8: Headless endpoint driver + docs

**Files:**
- Create: `.claude/skills/run-billboard-replacer/publish-driver.mjs`
- Modify: `.claude/skills/run-billboard-replacer/SKILL.md`, `CLAUDE.md`

- [ ] **Step 1: Create `publish-driver.mjs`** — a self-cleaning endpoint test (plain Node, no puppeteer; node 22 has `fetch`):

```js
// Drives POST /__publish-template end-to-end against a running dev server:
// publishes a synthetic template, asserts the bg + mask files were written and
// billboards.json upserted, then restores the manifest and deletes the test
// assets so the repo is left clean. Run with the dev server up:
//   npm run dev & until curl -sf http://localhost:5173 >/dev/null; do sleep 1; done
//   node .claude/skills/run-billboard-replacer/publish-driver.mjs
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ORIGIN = process.argv[2] ?? "http://localhost:5173";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const manifestPath = path.join(repo, "src/data/billboards.json");
const billboardsDir = path.join(repo, "public/billboards");
const TEST_ID = "zz-publish-driver-test";

// 1x1 transparent PNG (base64) reused for bg + mask.
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let pass = 0,
  fail = 0;
const check = (cond, msg) => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${msg}`);
  cond ? pass++ : fail++;
};

const before = await fs.readFile(manifestPath, "utf8");
try {
  const res = await fetch(`${ORIGIN}/__publish-template`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: TEST_ID,
      name: { en: "Driver Test", zh: "驱动测试" },
      caption: { en: "synthetic", zh: "合成" },
      corners: [[0, 0], [1, 0], [1, 1], [0, 1]],
      bg: { base64: PNG_1x1, ext: "png" },
      maskPng: PNG_1x1,
    }),
  });
  const data = await res.json();
  check(res.ok && data.ok, `endpoint returned ok (${res.status})`);
  check(data.src === `/billboards/${TEST_ID}.png`, `src is ${data.src}`);
  check(data.mask === `/billboards/${TEST_ID}-mask.png`, `mask is ${data.mask}`);

  const bgStat = await fs.stat(path.join(billboardsDir, `${TEST_ID}.png`)).then(() => true).catch(() => false);
  const maskStat = await fs.stat(path.join(billboardsDir, `${TEST_ID}-mask.png`)).then(() => true).catch(() => false);
  check(bgStat, "background PNG written to public/billboards/");
  check(maskStat, "mask PNG written to public/billboards/");

  const list = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const entry = list.find((p) => p.id === TEST_ID);
  check(!!entry, "manifest upserted with the new entry");
  check(entry?.mask === `/billboards/${TEST_ID}-mask.png`, "entry carries the mask path");

  // reject path: bad id
  const badRes = await fetch(`${ORIGIN}/__publish-template`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "../escape" }),
  });
  check(badRes.status === 400, "rejects unsafe id with 400");
} finally {
  // restore manifest + delete test assets
  await fs.writeFile(manifestPath, before, "utf8");
  await fs.rm(path.join(billboardsDir, `${TEST_ID}.png`), { force: true });
  await fs.rm(path.join(billboardsDir, `${TEST_ID}-mask.png`), { force: true });
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass}/${pass + fail} checks`);
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it** (dev up)

Run:
```bash
npm run dev & until curl -sf http://localhost:5173 >/dev/null; do sleep 1; done
node .claude/skills/run-billboard-replacer/publish-driver.mjs
pkill -f vite
```
Expected: `PASS — 8/8 checks`, and `git status` shows `billboards.json` unchanged + no leftover `zz-publish-driver-test*` files.

- [ ] **Step 3: Update `SKILL.md`** — add a line under the feature-drivers paragraph noting `publish-driver.mjs` (publishes a synthetic official template against the dev endpoint, asserts files written + manifest upserted, self-cleans).

- [ ] **Step 4: Update `CLAUDE.md`** — replace the "Adding a preset scene" section with the new flow:
  - Preset data lives in `src/data/billboards.json` (machine-owned); `presets.ts` imports it.
  - To add an official scene: run `npm run dev`, open the editor (custom upload or an existing preset), set corners, paint or **Import mask**, click **Publish as template** (dev-only — `import.meta.env.DEV`), fill EN/ZH name + caption, Publish. The Vite middleware writes `public/billboards/<id>.<ext>` + `<id>-mask.png` and upserts the manifest; HMR shows the card. Then `git add public/billboards src/data/billboards.json && git commit`.
  - Note the occlusion `mask` field is now populated this way (the second gap closed).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/run-billboard-replacer/publish-driver.mjs .claude/skills/run-billboard-replacer/SKILL.md CLAUDE.md
git commit -m "test(publish): headless endpoint driver + docs for the publish flow"
```

---

## Task 9: Full regression + final verification

- [ ] **Step 1: Production build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 2: Unit tests**

Run: `npx tsx src/lib/presetManifest.test.ts && npx tsx src/lib/maskMath.test.ts`
Expected: both print their pass lines.

- [ ] **Step 3: Headless smoke + feature drivers** (dev up)

Run:
```bash
npm run dev & until curl -sf http://localhost:5173 >/dev/null; do sleep 1; done
node .claude/skills/run-billboard-replacer/driver.mjs
node .claude/skills/run-billboard-replacer/saved-driver.mjs
node .claude/skills/run-billboard-replacer/publish-driver.mjs
pkill -f vite
```
Expected: all PASS; 5 gallery cards; saved-scenes round-trip intact; publish endpoint writes + cleans up.

- [ ] **Step 4: Manual eyeball** — `npm run dev`, upload a photo, drag corners, Import a mask PNG, Publish; confirm the new card appears in the gallery and occludes correctly. Open an existing preset, paint a mask, Publish; confirm `billboards.json` gains a `mask` path and the preset occludes.

- [ ] **Step 5:** Review `git log` / `git diff main...HEAD`; ensure no stray `zz-publish-driver-test*` assets or manifest churn remain.

---

## Self-review notes
- **Spec coverage:** manifest migration (T1), pure core + masks-for-presets (T2), dev plugin (T3), client + fallback + admin gate (T4), import mask (T5), i18n (T6), modal UI (T7), tests + docs (T8), regression (T9). All spec sections map to a task.
- **Type consistency:** `PresetEntry` / `CornersTuple` defined in T2 are reused in T3/T4/T7. `PublishResult` defined in T4 is consumed in T7. `IS_ADMIN` (T4) gates T7.
- **Node types:** T3 adds `@types/node`; the plugin is reachable from `tsconfig` via the `vite.config.ts` import, so `tsc -b` checks it.
- **Mask re-upload:** `importMask` dispatches a *new* `MaskCanvas` reference so `EditorStage`'s mask effect re-uploads (documented in T5).
