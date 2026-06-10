import { useCallback, useEffect, useReducer, useRef } from "react";
import type { Corners, Preset } from "../data/presets";
import type { LocalizedString, TKey } from "../i18n";
import {
  DEFAULT_BLEND,
  DEFAULT_GRADE,
  type BlendParams,
  type GradeParams,
} from "../lib/webgl/renderer";
import { NEUTRAL_STATS, type Stats } from "../lib/color";
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
import { imageStats, sampleRegionStats } from "../lib/imageStats";
import { createMaskCanvas, drawBaseImage, type MaskCanvas } from "../lib/maskCanvas";

export interface EditorSource {
  kind: "preset" | "custom";
  presetId?: string;
  name: LocalizedString | string;
  caption?: LocalizedString | string;
  bgImage: HTMLImageElement;
  bgWidth: number;
  bgHeight: number;
  corners: Corners;
  maskCanvas: MaskCanvas | null;
  /** original background bytes (upload or stored template); presets resolve via bgSrc at save time */
  bgBlob?: Blob;
  /** public URL of a preset background, fetched on save */
  bgSrc?: string;
  /** id of the SavedScene this session was saved to — presence means update-in-place */
  savedId?: string;
  /** createdAt carried from the stored record so re-saves preserve it */
  savedCreatedAt?: number;
}

export interface EditorState {
  view: "gallery" | "editor";
  source: EditorSource | null;
  userImage: HTMLImageElement | null;
  userThumb: string | null; // data-URL thumbnail for the sidebar preview
  userName: string | null;
  srcStats: Stats;
  tgtStats: Stats;
  grade: GradeParams;
  blend: BlendParams;
  editable: boolean; // corner handles draggable
  maskMode: boolean; // brush mask tool active
  maskTouched: boolean; // mask has content worth feeding to the GPU
  seed: number;
  loading: boolean;
  error: TKey | null;
}

const CENTERED_QUAD: Corners = [
  [0.32, 0.3],
  [0.68, 0.3],
  [0.68, 0.7],
  [0.32, 0.7],
];

const initialState: EditorState = {
  view: "gallery",
  source: null,
  userImage: null,
  userThumb: null,
  userName: null,
  srcStats: NEUTRAL_STATS,
  tgtStats: NEUTRAL_STATS,
  grade: DEFAULT_GRADE,
  blend: DEFAULT_BLEND,
  editable: false,
  maskMode: false,
  maskTouched: false,
  seed: Math.random() * 100,
  loading: false,
  error: null,
};

type Action =
  | { type: "LOADING"; value: boolean }
  | { type: "ERROR"; message: TKey | null }
  | { type: "OPEN"; source: EditorSource; editable: boolean }
  | { type: "SET_USER"; image: HTMLImageElement; thumb: string; name: string; stats: Stats }
  | { type: "CLEAR_USER" }
  | { type: "SET_CORNERS"; corners: Corners }
  | { type: "SET_TGT_STATS"; stats: Stats }
  | { type: "SET_GRADE"; patch: Partial<GradeParams> }
  | { type: "SET_BLEND"; patch: Partial<BlendParams> }
  | { type: "RESET_ADJUST" }
  | { type: "SET_EDITABLE"; value: boolean }
  | { type: "SET_MASK_MODE"; value: boolean }
  | { type: "SET_MASK_CANVAS"; mask: MaskCanvas }
  | { type: "MARK_SAVED"; id: string; name: string; bgBlob: Blob; createdAt: number }
  | { type: "BACK" };

function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case "LOADING":
      // Clear any stale error when a new load starts.
      return { ...state, loading: action.value, error: action.value ? null : state.error };
    case "ERROR":
      return { ...state, error: action.message, loading: false };
    case "OPEN":
      return {
        ...state,
        view: "editor",
        source: action.source,
        editable: action.editable,
        maskMode: false,
        maskTouched: false,
        userImage: null,
        userThumb: null,
        userName: null,
        srcStats: NEUTRAL_STATS,
        tgtStats: NEUTRAL_STATS,
        grade: DEFAULT_GRADE,
        blend: DEFAULT_BLEND,
        loading: false,
        error: null,
      };
    case "SET_USER":
      return {
        ...state,
        userImage: action.image,
        userThumb: action.thumb,
        userName: action.name,
        srcStats: action.stats,
        loading: false,
        error: null,
      };
    case "CLEAR_USER":
      return { ...state, userImage: null, userThumb: null, userName: null, srcStats: NEUTRAL_STATS };
    case "SET_CORNERS":
      return state.source
        ? { ...state, source: { ...state.source, corners: action.corners } }
        : state;
    case "SET_TGT_STATS":
      return { ...state, tgtStats: action.stats };
    case "SET_GRADE":
      return { ...state, grade: { ...state.grade, ...action.patch } };
    case "SET_BLEND":
      return { ...state, blend: { ...state.blend, ...action.patch } };
    case "RESET_ADJUST":
      return { ...state, grade: DEFAULT_GRADE, blend: DEFAULT_BLEND };
    case "SET_EDITABLE":
      return { ...state, editable: action.value, maskMode: action.value ? false : state.maskMode };
    case "SET_MASK_MODE":
      return { ...state, maskMode: action.value, editable: action.value ? false : state.editable };
    case "SET_MASK_CANVAS":
      return state.source
        ? { ...state, source: { ...state.source, maskCanvas: action.mask }, maskTouched: true }
        : state;
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
    case "BACK":
      return { ...initialState, seed: state.seed, view: "gallery" };
    default:
      return state;
  }
}

export function useEditor() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const statsTimer = useRef<number | null>(null);
  const sourceRef = useRef(state.source);
  sourceRef.current = state.source;
  const maskTouchedRef = useRef(state.maskTouched);
  maskTouchedRef.current = state.maskTouched;

  const openPreset = useCallback(async (preset: Preset) => {
    dispatch({ type: "LOADING", value: true });
    try {
      const bgImage = await loadImage(preset.src);
      const [bgWidth, bgHeight] = imageDims(bgImage);
      let maskCanvas: MaskCanvas | null = null;
      if (preset.mask) {
        const maskImg = await loadImage(preset.mask);
        maskCanvas = createMaskCanvas(bgWidth, bgHeight);
        drawBaseImage(maskCanvas, maskImg);
      }
      dispatch({
        type: "OPEN",
        editable: false,
        source: {
          kind: "preset",
          presetId: preset.id,
          name: preset.name,
          caption: preset.caption,
          bgImage,
          bgWidth,
          bgHeight,
          corners: preset.corners,
          maskCanvas,
          bgSrc: preset.src,
        },
      });
      if (maskCanvas) dispatch({ type: "SET_MASK_CANVAS", mask: maskCanvas });
    } catch (e) {
      console.error(e);
      dispatch({ type: "ERROR", message: "error.load" });
    }
  }, []);

  const openCustom = useCallback(async (file: File) => {
    dispatch({ type: "LOADING", value: true });
    try {
      const bgImage = await fileToImage(file);
      const [bgWidth, bgHeight] = imageDims(bgImage);
      dispatch({
        type: "OPEN",
        editable: true,
        source: {
          kind: "custom",
          name: file.name.replace(/\.[^.]+$/, "") || "Custom billboard",
          bgImage,
          bgWidth,
          bgHeight,
          corners: CENTERED_QUAD,
          maskCanvas: null,
          bgBlob: file,
        },
      });
    } catch (e) {
      console.error(e);
      dispatch({ type: "ERROR", message: "error.load" });
    }
  }, []);

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

  const setUserFile = useCallback(async (file: File) => {
    dispatch({ type: "LOADING", value: true });
    try {
      const image = await fileToImage(file);
      const stats = imageStats(image);
      const thumb = makeThumbDataURL(image);
      dispatch({
        type: "SET_USER",
        image,
        thumb,
        name: file.name,
        stats,
      });
    } catch (e) {
      console.error(e);
      dispatch({ type: "ERROR", message: "error.load" });
    }
  }, []);

  const clearUser = useCallback(() => dispatch({ type: "CLEAR_USER" }), []);
  const clearError = useCallback(() => dispatch({ type: "ERROR", message: null }), []);
  const setCorners = useCallback(
    (corners: Corners) => dispatch({ type: "SET_CORNERS", corners }),
    [],
  );
  const setGrade = useCallback(
    (patch: Partial<GradeParams>) => dispatch({ type: "SET_GRADE", patch }),
    [],
  );
  const setBlend = useCallback(
    (patch: Partial<BlendParams>) => dispatch({ type: "SET_BLEND", patch }),
    [],
  );
  const resetAdjust = useCallback(() => dispatch({ type: "RESET_ADJUST" }), []);
  const setEditable = useCallback(
    (value: boolean) => dispatch({ type: "SET_EDITABLE", value }),
    [],
  );
  const setMaskMode = useCallback(
    (value: boolean) => dispatch({ type: "SET_MASK_MODE", value }),
    [],
  );
  const ensureMask = useCallback((): MaskCanvas | null => {
    const src = sourceRef.current;
    if (!src) return null;
    if (src.maskCanvas) return src.maskCanvas;
    const mask = createMaskCanvas(src.bgWidth, src.bgHeight);
    dispatch({ type: "SET_MASK_CANVAS", mask });
    return mask;
  }, []);
  const backToGallery = useCallback(() => dispatch({ type: "BACK" }), []);

  // Recompute target (billboard-region) stats when the background or corners
  // change, debounced so dragging stays smooth.
  const bgImage = state.source?.bgImage ?? null;
  const corners = state.source?.corners ?? null;
  useEffect(() => {
    if (!bgImage || !corners || !state.userImage) return;
    if (statsTimer.current) window.clearTimeout(statsTimer.current);
    statsTimer.current = window.setTimeout(() => {
      const stats = sampleRegionStats(bgImage, corners);
      dispatch({ type: "SET_TGT_STATS", stats });
    }, 120);
    return () => {
      if (statsTimer.current) window.clearTimeout(statsTimer.current);
    };
  }, [bgImage, corners, state.userImage]);

  return {
    state,
    openPreset,
    openCustom,
    openSaved,
    saveScene,
    setUserFile,
    clearUser,
    clearError,
    setCorners,
    setGrade,
    setBlend,
    resetAdjust,
    setEditable,
    setMaskMode,
    ensureMask,
    backToGallery,
  };
}

export type EditorApi = ReturnType<typeof useEditor>;
