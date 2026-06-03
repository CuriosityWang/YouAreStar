import { motion } from "framer-motion";
import { PRESETS, type Preset } from "../data/presets";
import { loc, useI18n } from "../i18n";
import { LangToggle } from "./ui/LangToggle";

export function Gallery({
  onOpenPreset,
  onOpenCustom,
}: {
  onOpenPreset: (p: Preset) => void;
  onOpenCustom: (file: File) => void;
}) {
  const { t, lang } = useI18n();

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
              <span className="masthead-meta">{t("meta.tech")}</span>
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
      </div>
    </div>
  );
}
