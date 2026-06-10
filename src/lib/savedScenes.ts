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
