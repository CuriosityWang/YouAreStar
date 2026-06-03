import { Slider } from "../ui/controls";
import { useI18n } from "../../i18n";
import type { GradeParams } from "../../lib/webgl/renderer";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const signed = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}`;

export function ColorMatchPanel({
  grade,
  onChange,
}: {
  grade: GradeParams;
  onChange: (p: Partial<GradeParams>) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>{t("panel.color")}</h3>
        <span className="panel-num">{t("num.reinhard")}</span>
      </div>
      <div className="panel-stack">
        <Slider
          label={t("slider.auto")}
          value={grade.autoStrength}
          min={0}
          max={1}
          onChange={(v) => onChange({ autoStrength: v })}
          format={pct}
        />
        <Slider
          label={t("slider.brightness")}
          value={grade.brightness}
          min={-1}
          max={1}
          onChange={(v) => onChange({ brightness: v })}
          format={signed}
        />
        <Slider
          label={t("slider.contrast")}
          value={grade.contrast}
          min={-1}
          max={1}
          onChange={(v) => onChange({ contrast: v })}
          format={signed}
        />
        <Slider
          label={t("slider.saturation")}
          value={grade.saturation}
          min={-1}
          max={1}
          onChange={(v) => onChange({ saturation: v })}
          format={signed}
        />
        <Slider
          label={t("slider.temperature")}
          value={grade.temperature}
          min={-1}
          max={1}
          onChange={(v) => onChange({ temperature: v })}
          format={signed}
        />
      </div>
      <p className="panel-note">{t("color.note")}</p>
    </div>
  );
}
