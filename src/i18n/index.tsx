import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

export type Lang = "en" | "zh";

export interface LocalizedString {
  en: string;
  zh: string;
}

/** Resolve a localized value (or pass-through plain string) for a language. */
export function loc(v: LocalizedString | string, lang: Lang): string {
  return typeof v === "string" ? v : v[lang];
}

const STRINGS = {
  "meta.tech": { en: "WEBGL · HOMOGRAPHY · REINHARD", zh: "WEBGL · 单应变换 · REINHARD" },

  "title.lead": { en: "Put your work on the", zh: "让你的作品，登上" },
  "title.accent": { en: "wall", zh: "广告牌" },
  "title.tail": { en: ".", zh: "。" },

  "lede.1": {
    en: "Choose a scene, drop in an image, and watch it settle into the advertising surface — ",
    zh: "选择一个场景，拖入一张图片，看它自然嵌入广告位——",
  },
  "lede.warp": { en: "perspective-warped", zh: "透视变形" },
  "lede.2": { en: " to the geometry and ", zh: "贴合几何，" },
  "lede.match": { en: "color-matched", zh: "色彩匹配" },
  "lede.3": {
    en: " to the light, so it reads as if it were always there.",
    zh: "贴合光线，仿佛它本就在那里。",
  },

  "collection.title": { en: "The Collection", zh: "场景库" },
  "collection.scenes": { en: "scenes", zh: "场景" },
  "card.cta": { en: "Open in editor", zh: "进入编辑" },

  "byo.title": { en: "Use your own billboard", zh: "使用你自己的广告牌" },
  "byo.sub": {
    en: "Upload a photo, then drag four points to mark the ad surface.",
    zh: "上传一张照片，然后拖动四个点标出广告面。",
  },

  "editor.back": { en: "Collection", zh: "返回场景库" },
  "tag.preset": { en: "Preset scene", zh: "预置场景" },
  "tag.custom": { en: "Custom upload", zh: "自定义上传" },
  "editor.adjust": { en: "Adjust corners", zh: "调整角点" },
  "editor.lock": { en: "Lock corners", zh: "锁定角点" },

  "panel.image": { en: "Your image", zh: "你的图片" },
  "num.source": { en: "01 · Source", zh: "01 · 来源" },
  "drop.add": { en: "Add your image", zh: "添加图片" },
  "drop.replace": { en: "Replace image", zh: "替换图片" },
  "drop.hint": { en: "PNG · JPG · or drag onto the stage", zh: "PNG · JPG · 或拖到画面上" },
  "drop.place": { en: "Drop image to place", zh: "拖入图片以放置" },
  "drop.empty": { en: "Drop your image onto the billboard", zh: "把图片拖到广告牌上" },
  "stage.compare": { en: "Hold to see original", zh: "按住看原图" },
  "image.remove": { en: "Remove image", zh: "移除图片" },
  "corner.note": {
    en: "Drag the four corner points on the stage to align them with the ad surface.",
    zh: "在画面上拖动四个角点，使其对齐广告面。",
  },

  "panel.color": { en: "Color match", zh: "色彩匹配" },
  "num.reinhard": { en: "02 · Reinhard lαβ", zh: "02 · Reinhard lαβ" },
  "slider.auto": { en: "Auto match", zh: "自动匹配" },
  "color.note": {
    en: "Auto match adapts your image to the scene's light. Lower it to keep more of your original colour.",
    zh: "自动匹配让图片贴合场景光线。调低可保留更多原图颜色。",
  },
  "slider.brightness": { en: "Brightness", zh: "亮度" },
  "slider.contrast": { en: "Contrast", zh: "对比度" },
  "slider.saturation": { en: "Saturation", zh: "饱和度" },
  "slider.temperature": { en: "Temperature", zh: "色温" },

  "panel.blend": { en: "Blend & finish", zh: "混合与收尾" },
  "num.composite": { en: "03 · Composite", zh: "03 · 合成" },
  "blend.mode": { en: "Blend mode", zh: "混合模式" },
  "mode.normal": { en: "Normal", zh: "正常" },
  "mode.multiply": { en: "Multiply", zh: "正片叠底" },
  "mode.soft": { en: "Soft", zh: "柔光" },
  "mode.screen": { en: "Screen", zh: "滤色" },
  "slider.opacity": { en: "Opacity", zh: "不透明度" },
  "slider.feather": { en: "Edge feather", zh: "边缘羽化" },
  "slider.grain": { en: "Grain", zh: "噪点" },

  "export.png": { en: "Export PNG", zh: "导出 PNG" },
  "export.rendering": { en: "Rendering…", zh: "渲染中…" },
  "export.reset": { en: "Reset look", zh: "重置效果" },
  "export.copy": { en: "Copy corners", zh: "复制角点" },

  "toast.saved": { en: "Saved to downloads", zh: "已保存到下载" },
  "toast.exportFail": { en: "Export failed", zh: "导出失败" },
  "toast.copied": { en: "Preset snippet copied", zh: "已复制预置片段" },
  "toast.clipboard": { en: "Clipboard blocked", zh: "剪贴板被拦截" },

  "app.loading": { en: "Loading…", zh: "加载中…" },

  "error.load": {
    en: "Couldn't load that image. Try a different PNG or JPG file.",
    zh: "无法载入该图片，请换一个 PNG 或 JPG 文件试试。",
  },
  "error.dismiss": { en: "Dismiss", zh: "关闭" },

  "mask.toggle": { en: "Mask", zh: "蒙版" },
  "mask.exit": { en: "Done", zh: "完成" },
  "mask.hint": {
    en: "Paint over anything that should stay in front of your ad.",
    zh: "把应当遮在广告前面的东西涂出来。",
  },
  "mask.paint": { en: "Paint", zh: "涂抹" },
  "mask.erase": { en: "Erase", zh: "擦除" },
  "mask.size": { en: "Size", zh: "大小" },
  "mask.hardness": { en: "Edge", zh: "软硬" },
  "mask.undo": { en: "Undo", zh: "撤销" },
  "mask.redo": { en: "Redo", zh: "重做" },
  "mask.clear": { en: "Clear", zh: "清空" },
  "mask.invert": { en: "Invert", zh: "反相" },
  "mask.view.overlay": { en: "Overlay", zh: "叠层" },
  "mask.view.result": { en: "Result", zh: "结果" },
  "mask.view.mask": { en: "Mask", zh: "蒙版" },
  "mask.fit": { en: "Fit", zh: "适应" },
} satisfies Record<string, LocalizedString>;

export type TKey = keyof typeof STRINGS;

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: TKey) => string;
}

const I18nContext = createContext<I18nCtx | null>(null);
const STORAGE_KEY = "bbr-lang";

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "zh") return saved;
  } catch {
    /* ignore */
  }
  return navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = l === "zh" ? "zh-CN" : "en";
  }, []);
  const t = useCallback((k: TKey) => STRINGS[k][lang], [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within <I18nProvider>");
  return ctx;
}
