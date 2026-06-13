import { useMemo, useState } from "react";
import type { EditorSource } from "../../hooks/useEditor";
import { useI18n } from "../../i18n";
import { Button } from "../ui/controls";
import { slug } from "../../lib/presetManifest";
import {
  buildPayload,
  publishTemplate,
  downloadFallback,
  type PublishResult,
} from "../../lib/publishTemplate";

export type PublishToastKey = "publish.done" | "publish.fallback";

export function PublishModal({
  source,
  maskTouched,
  knownPresetIds,
  onImportMask,
  onClose,
  onPublished,
}: {
  source: EditorSource;
  maskTouched: boolean;
  knownPresetIds: string[];
  onImportMask: (file: File) => void;
  onClose: () => void;
  onPublished: (result: PublishResult, key: PublishToastKey) => void;
}) {
  const { t } = useI18n();
  const initialNameEn = typeof source.name === "string" ? source.name : source.name.en;
  const initialNameZh = typeof source.name === "string" ? source.name : source.name.zh;
  const initialCapEn = typeof source.caption === "string" ? source.caption : source.caption?.en ?? "";
  const initialCapZh = typeof source.caption === "string" ? source.caption : source.caption?.zh ?? "";

  const [nameEn, setNameEn] = useState(initialNameEn);
  const [nameZh, setNameZh] = useState(initialNameZh);
  const [capEn, setCapEn] = useState(initialCapEn);
  const [capZh, setCapZh] = useState(initialCapZh);
  const [id, setId] = useState(source.presetId ?? slug(initialNameEn));
  const [idEdited, setIdEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const collision = useMemo(
    () => id !== source.presetId && knownPresetIds.includes(id),
    [id, knownPresetIds, source.presetId],
  );

  const hasMask = maskTouched && !!source.maskCanvas;
  const canSubmit =
    !!nameEn.trim() && !!nameZh.trim() && !!capEn.trim() && !!capZh.trim() && !!id.trim() && !busy;

  function onNameEn(v: string) {
    setNameEn(v);
    if (!idEdited && !source.presetId) setId(slug(v));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    // A preset edited under its own id keeps its on-disk bg; anything else
    // (custom upload, or a preset saved under a new id) ships fresh bytes.
    const includeBg = source.kind !== "preset" || id !== source.presetId;
    try {
      const payload = await buildPayload({
        id,
        name: { en: nameEn.trim(), zh: nameZh.trim() },
        caption: { en: capEn.trim(), zh: capZh.trim() },
        corners: source.corners,
        source,
        includeBg,
        includeMask: hasMask,
      });
      try {
        const result = await publishTemplate(payload);
        onPublished(result, "publish.done");
      } catch {
        await downloadFallback(payload);
        onPublished({ ok: true, src: `/billboards/${id}`, mask: null, updated: false }, "publish.fallback");
      }
    } catch (e) {
      console.error(e);
      setError(t("publish.error"));
      setBusy(false);
    }
  }

  return (
    <div className="publish-scrim" onClick={onClose}>
      <div className="publish-modal scroll-thin" onClick={(e) => e.stopPropagation()}>
        <h3 className="publish-h">{t("publish.title")}</h3>

        <label className="publish-field">
          <span>{t("publish.nameEn")}</span>
          <input value={nameEn} onChange={(e) => onNameEn(e.target.value)} autoFocus />
        </label>
        <label className="publish-field">
          <span>{t("publish.nameZh")}</span>
          <input value={nameZh} onChange={(e) => setNameZh(e.target.value)} />
        </label>
        <label className="publish-field">
          <span>{t("publish.captionEn")}</span>
          <input value={capEn} onChange={(e) => setCapEn(e.target.value)} />
        </label>
        <label className="publish-field">
          <span>{t("publish.captionZh")}</span>
          <input value={capZh} onChange={(e) => setCapZh(e.target.value)} />
        </label>
        <label className="publish-field">
          <span>{t("publish.id")}</span>
          <input
            value={id}
            onChange={(e) => {
              setIdEdited(true);
              setId(e.target.value);
            }}
          />
        </label>
        <p className="publish-note">{collision ? t("publish.idCollision") : t("publish.idHint")}</p>

        <div className="publish-mask">
          <span className="publish-mask-status">
            {t("publish.mask")}: {hasMask ? t("publish.maskPainted") : t("publish.maskNone")}
          </span>
          <label className="publish-import">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onImportMask(f);
                e.currentTarget.value = "";
              }}
            />
            {t("publish.maskImport")}
          </label>
        </div>
        <p className="publish-note">{t("publish.maskHint")}</p>

        {error && <p className="publish-error">{error}</p>}

        <div className="publish-actions">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("publish.cancel")}
          </Button>
          <Button variant="accent" onClick={submit} disabled={!canSubmit}>
            {busy ? t("publish.publishing") : t("publish.submit")}
          </Button>
        </div>
      </div>
    </div>
  );
}
