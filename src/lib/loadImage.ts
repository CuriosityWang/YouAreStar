// Image loading helpers that resolve only once the bitmap is fully decoded, so
// callers can read naturalWidth/Height and upload to WebGL immediately.

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = async () => {
      try {
        if (img.decode) await img.decode();
      } catch {
        /* decode() can reject for some SVGs; onload already fired, proceed */
      }
      resolve(img);
    };
    img.onerror = () => reject(new Error(`failed to load image: ${src}`));
    img.src = src;
  });
}

export async function fileToImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await loadImage(url);
  } finally {
    // The decoded HTMLImageElement keeps its own copy; safe to revoke.
    URL.revokeObjectURL(url);
  }
}

export function imageDims(img: HTMLImageElement): [number, number] {
  return [img.naturalWidth || img.width, img.naturalHeight || img.height];
}

/**
 * Bake a small data-URL thumbnail from a decoded image. `fileToImage` revokes
 * the source object URL once decoded, so `img.src` can't be reused as a fresh
 * `<img>` source — this captures the pixels into a self-contained data URL that
 * stays valid for the lifetime of the editor state.
 */
export function makeThumbDataURL(img: HTMLImageElement, max = 160): string {
  const [w, h] = imageDims(img);
  const scale = Math.min(1, max / Math.max(w, h, 1));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  try {
    ctx.drawImage(img, 0, 0, tw, th);
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}
