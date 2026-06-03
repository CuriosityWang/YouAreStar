import { useI18n } from "../../i18n";

export function LangToggle() {
  const { lang, setLang } = useI18n();
  return (
    <div className="lang-toggle" role="group" aria-label="language">
      <button type="button" data-active={lang === "en"} onClick={() => setLang("en")}>
        EN
      </button>
      <button type="button" data-active={lang === "zh"} onClick={() => setLang("zh")}>
        中文
      </button>
    </div>
  );
}
