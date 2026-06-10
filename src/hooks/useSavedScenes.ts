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
