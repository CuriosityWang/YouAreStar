import { useRef, useState } from "react";
import { motion } from "framer-motion";
import type { EditorApi } from "../../hooks/useEditor";
import { renderToBlob, type RenderState } from "../../lib/webgl/renderer";
import { loc, useI18n } from "../../i18n";
import { Button } from "../ui/controls";
import { LangToggle } from "../ui/LangToggle";
import { ColorMatchPanel } from "../Controls/ColorMatchPanel";
import { BlendPanel } from "../Controls/BlendPanel";
import { EditorStage } from "./EditorStage";
import { PublishModal, type PublishToastKey } from "./PublishModal";
import { IS_ADMIN } from "../../lib/admin";
import { PRESETS } from "../../data/presets";
import type { PublishResult } from "../../lib/publishTemplate";

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "scene";
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function Editor({ api }: { api: EditorApi }) {
  const {
    state,
    setCorners,
    setUserFile,
    clearUser,
    clearError,
    setGrade,
    setBlend,
    resetAdjust,
    saveScene,
    setEditable,
    setMaskMode,
    importMask,
    backToGallery,
  } = api;
  const { t, lang } = useI18n();

  const s = state.source!;
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const toastTimer = useRef<number | null>(null);
  const baseName = typeof s.name === "string" ? s.name : s.name.en;

  function flash(msg: string) {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }

  async function handleExport() {
    if (!state.userImage) return;
    setExporting(true);
    try {
      const renderState: RenderState = {
        corners: s.corners,
        hasUser: true,
        srcStats: state.srcStats,
        tgtStats: state.tgtStats,
        grade: state.grade,
        blend: state.blend,
        seed: state.seed,
      };
      const blob = await renderToBlob({
        bg: s.bgImage,
        bgWidth: s.bgWidth,
        bgHeight: s.bgHeight,
        user: state.userImage,
        mask: s.maskCanvas?.canvas ?? null,
        state: renderState,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slug(baseName)}-billboard.png`;
      a.click();
      URL.revokeObjectURL(url);
      flash(t("toast.saved"));
    } catch (e) {
      console.error(e);
      flash(t("toast.exportFail"));
    } finally {
      setExporting(false);
    }
  }

  async function handleCopyCorners() {
    const corners = s.corners.map(([x, y]) => [r4(x), r4(y)]);
    let snippet: string;
    if (s.kind === "preset") {
      // Tightening an existing scene: stamp its id so the value maps back to
      // the right entry in src/data/presets.ts (paste this line over its `corners`).
      snippet = `// preset "${s.presetId}"\n  corners: ${JSON.stringify(corners)},`;
    } else {
      const nm = typeof s.name === "string" ? { en: s.name, zh: s.name } : s.name;
      snippet = `{
  id: "${slug(baseName)}",
  name: { en: "${nm.en}", zh: "${nm.zh}" },
  caption: { en: "", zh: "" },
  src: "/billboards/your-file.ext",
  corners: ${JSON.stringify(corners)},
}`;
    }
    try {
      await navigator.clipboard.writeText(snippet);
      flash(t("toast.copied"));
    } catch {
      flash(t("toast.clipboard"));
    }
  }

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

  function handlePublished(_result: PublishResult, key: PublishToastKey) {
    setPublishOpen(false);
    flash(t(key));
    backToGallery();
  }

  const canAdjust = s.kind === "preset";

  return (
    <div className="editor">
      <div className="editor-top">
      <div className="editor-bar">
        <div className="editor-bar-left">
          <button className="editor-back" onClick={backToGallery}>
            ← <span className="editor-back-label">{t("editor.back")}</span>
          </button>
          <div className="editor-source">
            <div className="nm">{loc(s.name, lang)}</div>
            <div className="tag">
              {s.savedId ? t("tag.saved") : s.kind === "preset" ? t("tag.preset") : t("tag.custom")}
            </div>
          </div>
        </div>
        <div className="editor-bar-right">
          {canAdjust && (
            <Button variant="ghost" onClick={() => setEditable(!state.editable)}>
              {state.editable ? t("editor.lock") : t("editor.adjust")}
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => setMaskMode(!state.maskMode)}
          >
            {state.maskMode ? t("mask.exit") : t("mask.toggle")}
          </Button>
          <LangToggle />
        </div>
      </div>

      {state.error && (
        <div className="error-bar" role="alert">
          <span>{t(state.error)}</span>
          <button
            type="button"
            className="error-dismiss"
            onClick={clearError}
            aria-label={t("error.dismiss")}
          >
            ×
          </button>
        </div>
      )}
      </div>

      <div className="editor-main">
        <EditorStage
          source={s}
          userImage={state.userImage}
          srcStats={state.srcStats}
          tgtStats={state.tgtStats}
          grade={state.grade}
          blend={state.blend}
          seed={state.seed}
          editable={state.editable}
          api={api}
          maskMode={state.maskMode}
          maskTouched={state.maskTouched}
          onCorners={setCorners}
          onUserFile={setUserFile}
        />

        <motion.aside
          className="sidebar scroll-thin"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="panel">
            <div className="panel-head">
              <h3>{t("panel.image")}</h3>
              <span className="panel-num">{t("num.source")}</span>
            </div>
            <label className="dropzone">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setUserFile(f);
                  e.currentTarget.value = "";
                }}
              />
              {state.userThumb ? (
                <img className="dropzone-thumb" src={state.userThumb} alt="" />
              ) : (
                <div className="dropzone-thumb" />
              )}
              <div className="dropzone-txt">
                <div className="t">{state.userImage ? t("drop.replace") : t("drop.add")}</div>
                <div className="s">{state.userName ?? t("drop.hint")}</div>
              </div>
            </label>
            {state.userImage && (
              <div className="row" style={{ marginTop: 14 }}>
                <Button variant="ghost" onClick={clearUser}>
                  {t("image.remove")}
                </Button>
              </div>
            )}
            {state.editable && <p className="panel-note">{t("corner.note")}</p>}
            {state.maskMode && <p className="panel-note">{t("mask.hint")}</p>}
          </div>

          <ColorMatchPanel grade={state.grade} onChange={setGrade} />
          <BlendPanel blend={state.blend} onChange={setBlend} />

          <div className="export-bar">
            <Button variant="accent" disabled={!state.userImage || exporting} onClick={handleExport}>
              {exporting ? t("export.rendering") : t("export.png")}
            </Button>
            <div className="row">
              <Button variant="ghost" onClick={resetAdjust}>
                {t("export.reset")}
              </Button>
              {state.editable && (
                <Button variant="ghost" onClick={handleCopyCorners}>
                  {t("export.copy")}
                </Button>
              )}
            </div>
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
                {IS_ADMIN && (
                  <Button variant="ghost" onClick={() => setPublishOpen(true)}>
                    {t("publish.open")}
                  </Button>
                )}
              </div>
            )}
            {toast && <div className="toast">{toast}</div>}
          </div>
        </motion.aside>
      </div>

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
    </div>
  );
}
