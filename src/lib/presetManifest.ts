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
