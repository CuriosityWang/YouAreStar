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
