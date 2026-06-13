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
  "title.lead": { en: "Put your work on", zh: "让你的作品，登上" },
  "title.accent": { en: "Times Square", zh: "时代广场" },
  "title.tail": { en: ".", zh: "。" },

  "lede.1": {
    en: "Choose a scene, drop in an image, and watch it settle into the advertising surface.",
    zh: "选择一个场景，拖入一张图片，看它自然嵌入广告位。",
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
  "mask.move": { en: "Drag to move panel", zh: "拖动移动面板" },

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
  "publish.maskHint": {
    en: "White = foreground that stays in front of the ad.",
    zh: "白色＝保留在广告前方的前景。",
  },
  "publish.submit": { en: "Publish", zh: "发布" },
  "publish.publishing": { en: "Publishing…", zh: "发布中……" },
  "publish.cancel": { en: "Cancel", zh: "取消" },
  "publish.done": { en: "Published — commit to ship.", zh: "已发布——提交后即可上线。" },
  "publish.fallback": {
    en: "Endpoint unavailable — downloaded files + copied the entry.",
    zh: "接口不可用——已下载文件并复制条目。",
  },
  "publish.error": { en: "Publish failed.", zh: "发布失败。" },

  "error.save": {
    en: "Couldn't save the template. Browser storage may be full or blocked.",
    zh: "模板保存失败，浏览器存储可能已满或被禁用。",
  },
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
  return "zh"; // default to Chinese; an explicit choice is remembered above
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
