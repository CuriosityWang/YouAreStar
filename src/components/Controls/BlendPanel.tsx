import { Segmented, Slider } from "../ui/controls";
import { useI18n, type TKey } from "../../i18n";
import { BLEND_MODES, type BlendMode, type BlendParams } from "../../lib/webgl/renderer";

const pct = (v: number) => `${Math.round(v * 100)}%`;

const MODE_KEY: Record<BlendMode, TKey> = {
  normal: "mode.normal",
  multiply: "mode.multiply",
  "soft-light": "mode.soft",
  screen: "mode.screen",
};

export function BlendPanel({
  blend,
  onChange,
}: {
  blend: BlendParams;
  onChange: (p: Partial<BlendParams>) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>{t("panel.blend")}</h3>
        <span className="panel-num">{t("num.composite")}</span>
      </div>
      <div className="panel-stack">
        <Segmented
          label={t("blend.mode")}
          value={blend.mode}
          options={BLEND_MODES.map((m) => ({ value: m, label: t(MODE_KEY[m]) }))}
          onChange={(m) => onChange({ mode: m })}
        />
        <Slider
          label={t("slider.opacity")}
          value={blend.opacity}
          min={0}
          max={1}
          onChange={(v) => onChange({ opacity: v })}
          format={pct}
        />
        <Slider
          label={t("slider.feather")}
          value={blend.feather}
          min={0}
          max={1}
          onChange={(v) => onChange({ feather: v })}
          format={pct}
        />
        <Slider
          label={t("slider.grain")}
          value={blend.grain}
          min={0}
          max={1}
          onChange={(v) => onChange({ grain: v })}
          format={pct}
        />
      </div>
    </div>
  );
}
