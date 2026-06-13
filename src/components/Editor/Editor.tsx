import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useDragControls, useMotionValue, animate, type MotionProps, type PanInfo } from "framer-motion";
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
import { useMediaQuery } from "../../hooks/useMediaQuery";

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

  // ---- mobile bottom-sheet ----
  // Below the breakpoint the controls live in a draggable bottom sheet with two
  // snap states (peek / full). Desktop renders the plain right-column sidebar.
  const isMobile = useMediaQuery("(max-width: 900px)");
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetOpenRef = useRef(sheetOpen); // latest value for imperative handlers
  sheetOpenRef.current = sheetOpen;
  const editorRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [peekY, setPeekY] = useState(0);
  const peekYRef = useRef(0);
  const sheetY = useMotionValue(0);
  const dragControls = useDragControls();
  const draggingRef = useRef(false);
  const didDragRef = useRef(false);
  const animatingRef = useRef(false);
  const animRef = useRef<ReturnType<typeof animate> | null>(null);

  // Measure the peek offset (sheet height − header height) and expose the header
  // height as --peek-h so the stage reserves room above the sheet. Re-runs on viewport
  // AND header/sheet size changes (ResizeObserver) — e.g. the primary button switching
  // Export ⇄ Done. Re-parks the sheet only while it rests closed (never mid-drag or
  // mid-snap), so a snap spring is never cancelled by a teleport.
  useLayoutEffect(() => {
    if (!isMobile) return;
    const measure = () => {
      const sh = sheetRef.current?.offsetHeight ?? 0;
      const hh = headerRef.current?.offsetHeight ?? 0;
      const py = Math.max(0, sh - hh);
      peekYRef.current = py;
      setPeekY(py);
      editorRef.current?.style.setProperty("--peek-h", `${hh}px`);
      if (!sheetOpenRef.current && !draggingRef.current && !animatingRef.current) sheetY.set(py);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (headerRef.current) ro.observe(headerRef.current);
    if (sheetRef.current) ro.observe(sheetRef.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [isMobile, sheetY]);

  // Keep the off-screen (peeked) sheet body out of the tab order + a11y tree.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.inert = isMobile && !sheetOpen;
  }, [isMobile, sheetOpen]);

  function snapSheet(open: boolean) {
    setSheetOpen(open);
    animRef.current?.stop();
    animatingRef.current = true;
    animRef.current = animate(sheetY, open ? 0 : peekYRef.current, {
      type: "spring",
      stiffness: 420,
      damping: 42,
      onComplete: () => {
        animatingRef.current = false;
      },
    });
  }
  function onSheetDragStart() {
    draggingRef.current = true;
    animRef.current?.stop();
  }
  function onSheetDragEnd(_e: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) {
    draggingRef.current = false;
    const moved = Math.abs(info.offset.y) > 6 || Math.abs(info.velocity.y) > 60;
    if (!moved) return; // a tap slipped through the drag session — let the click toggle
    didDragRef.current = true; // suppress the synthetic click that trails a real drag
    const open = sheetOpenRef.current;
    const down = info.offset.y > 80 || info.velocity.y > 500;
    const up = info.offset.y < -80 || info.velocity.y < -500;
    snapSheet(open ? !down : up);
  }
  function onGrabClick() {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    snapSheet(!sheetOpenRef.current);
  }

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
  const inAdjust = canAdjust && state.editable;

  const exportButton = (
    <Button variant="accent" disabled={!state.userImage || exporting} onClick={handleExport}>
      {exporting ? t("export.rendering") : t("export.png")}
    </Button>
  );

  // The peek header's primary button is context-aware: exit the active mode if
  // adjusting/masking (so the way out is always one tap away), else export.
  const primaryAction = state.maskMode ? (
    <Button variant="accent" onClick={() => setMaskMode(false)}>
      {t("mask.exit")}
    </Button>
  ) : inAdjust ? (
    <Button variant="accent" onClick={() => setEditable(false)}>
      {t("editor.lock")}
    </Button>
  ) : (
    exportButton
  );

  const sheetMotion: MotionProps = isMobile
    ? {
        style: { y: sheetY },
        drag: "y",
        dragControls,
        dragListener: false,
        dragConstraints: { top: 0, bottom: peekY },
        dragElastic: 0.06,
        onDragStart: onSheetDragStart,
        onDragEnd: onSheetDragEnd,
      }
    : {
        initial: { opacity: 0, x: 24 },
        animate: { opacity: 1, x: 0 },
        transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
      };

  const mode = state.maskMode ? "mask" : inAdjust ? "adjust" : undefined;

  return (
    <div className="editor" ref={editorRef} data-mode={mode}>
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
            {/* On mobile, Adjust/Mask move into the sheet's Advanced section. */}
            {!isMobile && canAdjust && (
              <Button variant="ghost" onClick={() => setEditable(!state.editable)}>
                {state.editable ? t("editor.lock") : t("editor.adjust")}
              </Button>
            )}
            {!isMobile && (
              <Button variant="ghost" onClick={() => setMaskMode(!state.maskMode)}>
                {state.maskMode ? t("mask.exit") : t("mask.toggle")}
              </Button>
            )}
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

        <motion.aside className="sidebar scroll-thin" ref={sheetRef} {...sheetMotion}>
          {isMobile && (
            <div className="sheet-header" ref={headerRef}>
              <button
                type="button"
                className="sheet-grab"
                aria-label={t("sheet.toggle")}
                aria-expanded={sheetOpen}
                onPointerDown={(e) => {
                  didDragRef.current = false;
                  dragControls.start(e);
                }}
                onClick={onGrabClick}
              />
              <div className="sheet-header-row">
                {primaryAction}
                <span className="sheet-controls-label">{t("sheet.controls")}</span>
              </div>
            </div>
          )}

          <div className="sheet-body scroll-thin" ref={bodyRef}>
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

            {isMobile && (
              <div className="panel adv-panel">
                <div className="panel-head">
                  <h3>{t("adv.title")}</h3>
                  <span className="panel-num">{t("adv.hint")}</span>
                </div>
                <div className="row">
                  {canAdjust && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const entering = !state.editable;
                        setEditable(entering);
                        if (entering) snapSheet(false); // drop the sheet so the stage is free to work on
                      }}
                    >
                      {state.editable ? t("editor.lock") : t("editor.adjust")}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const entering = !state.maskMode;
                      setMaskMode(entering);
                      if (entering) snapSheet(false);
                    }}
                  >
                    {state.maskMode ? t("mask.exit") : t("mask.toggle")}
                  </Button>
                </div>
              </div>
            )}

            <div className="export-bar">
              {!isMobile && exportButton}
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
