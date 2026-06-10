import { AnimatePresence, motion } from "framer-motion";
import "./styles/app.css";
import { useEditor } from "./hooks/useEditor";
import { useI18n } from "./i18n";
import { Gallery } from "./components/Gallery";
import { Editor } from "./components/Editor/Editor";

export default function App() {
  const api = useEditor();
  const { t } = useI18n();
  const { state, openPreset, openCustom, openSaved } = api;
  const inEditor = state.view === "editor" && !!state.source;

  return (
    <>
      <AnimatePresence mode="wait">
        {inEditor ? (
          <motion.div
            key="editor"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
          >
            <Editor api={api} />
          </motion.div>
        ) : (
          <motion.div
            key="gallery"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.35 }}
          >
            <Gallery onOpenPreset={openPreset} onOpenCustom={openCustom} onOpenSaved={openSaved} />
          </motion.div>
        )}
      </AnimatePresence>

      {state.loading && (
        <div className="veil">
          <span className="label">{t("app.loading")}</span>
        </div>
      )}
    </>
  );
}
