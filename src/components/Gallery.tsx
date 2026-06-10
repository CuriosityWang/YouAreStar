import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { motion } from "framer-motion";
import { PRESETS, type Preset } from "../data/presets";
import { loc, useI18n } from "../i18n";
import { LangToggle } from "./ui/LangToggle";
import { useSavedScenes, type SavedSceneItem } from "../hooks/useSavedScenes";
import type { SavedScene } from "../lib/savedScenes";

export function Gallery({
  onOpenPreset,
  onOpenCustom,
  onOpenSaved,
}: {
  onOpenPreset: (p: Preset) => void;
  onOpenCustom: (file: File) => void;
  onOpenSaved: (s: SavedScene) => void;
}) {
  const { t, lang } = useI18n();
  const { items, remove } = useSavedScenes();

  return (
    <div className="app">
      <div className="shell">
        <motion.header
          className="masthead"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="masthead-top">
            <span className="masthead-mark">Billboard&nbsp;/&nbsp;Replacer</span>
            <div className="masthead-right">
              <LangToggle />
            </div>
          </div>
          <h1 className="masthead-title">
            {t("title.lead")} <em>{t("title.accent")}</em>
            {t("title.tail")}
          </h1>
          <p className="masthead-lede">
            {t("lede.1")}
            <b>{t("lede.warp")}</b>
            {t("lede.2")}
            <b>{t("lede.match")}</b>
            {t("lede.3")}
          </p>
        </motion.header>

        <section className="collection">
          <div className="collection-head">
            <span className="label">{t("collection.title")}</span>
            <span className="rule" />
            <span className="label">
              {String(PRESETS.length).padStart(2, "0")} {t("collection.scenes")}
            </span>
          </div>

          <div className="gallery-grid">
            {PRESETS.map((p, i) => (
              <motion.button
                key={p.id}
                type="button"
                className="preset-card"
                onClick={() => onOpenPreset(p)}
                initial={{ opacity: 0, y: 26 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.6,
                  delay: 0.15 + i * 0.07,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <div className="preset-media">
                  <span className="preset-index">N°{String(i + 1).padStart(2, "0")}</span>
                  <img src={p.src} alt={loc(p.name, lang)} loading="lazy" />
                </div>
                <div className="preset-body">
                  <div className="preset-name">{loc(p.name, lang)}</div>
                  <div className="preset-caption">{loc(p.caption, lang)}</div>
                  <span className="preset-cta">
                    {t("card.cta")} <span className="arrow">→</span>
                  </span>
                </div>
              </motion.button>
            ))}

            <motion.label
              className="byo-card"
              initial={{ opacity: 0, y: 26 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.6,
                delay: 0.15 + PRESETS.length * 0.07,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onOpenCustom(f);
                  e.currentTarget.value = "";
                }}
              />
              <span className="byo-plus">+</span>
              <span className="byo-title">{t("byo.title")}</span>
              <span className="byo-sub">{t("byo.sub")}</span>
            </motion.label>
          </div>
        </section>

        {items.length > 0 && (
          <section className="collection saved-collection">
            <div className="collection-head">
              <span className="label">{t("saved.title")}</span>
              <span className="rule" />
              <span className="label">
                {String(items.length).padStart(2, "0")} {t("collection.scenes")}
              </span>
            </div>

            <div className="gallery-grid">
              {items.map((item, i) => (
                <SavedCard
                  key={item.scene.id}
                  item={item}
                  index={i}
                  onOpen={() => onOpenSaved(item.scene)}
                  onDelete={() => remove(item.scene.id)}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function SavedCard({
  item,
  index,
  onOpen,
  onDelete,
}: {
  item: SavedSceneItem;
  index: number;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { t, lang } = useI18n();
  // two-click delete: first click arms, auto-disarms after 3s, second deletes
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  function handleDelete(e: ReactMouseEvent) {
    e.stopPropagation();
    if (!armed) {
      setArmed(true);
      timer.current = window.setTimeout(() => setArmed(false), 3000);
      return;
    }
    if (timer.current) window.clearTimeout(timer.current);
    onDelete();
  }

  return (
    <motion.div
      className="preset-card saved-card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      initial={{ opacity: 0, y: 26 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.1 + index * 0.07, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="preset-media">
        <span className="preset-index">N°{String(index + 1).padStart(2, "0")}</span>
        <img src={item.thumbUrl} alt={item.scene.name} loading="lazy" />
        <button
          type="button"
          className="saved-delete"
          data-armed={armed || undefined}
          aria-label={t("saved.delete")}
          onClick={handleDelete}
        >
          {armed ? t("saved.confirmDelete") : "×"}
        </button>
      </div>
      <div className="preset-body">
        <div className="preset-name">{item.scene.name}</div>
        <div className="preset-caption">
          {new Date(item.scene.updatedAt).toLocaleDateString(
            lang === "zh" ? "zh-CN" : "en-US",
          )}
        </div>
        <span className="preset-cta">
          {t("card.cta")} <span className="arrow">→</span>
        </span>
      </div>
    </motion.div>
  );
}
