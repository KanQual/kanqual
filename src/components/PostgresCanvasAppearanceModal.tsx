import { SettingsModal } from "./SettingsModal";
import { useI18n } from "../i18n/provider";

export type PostgresHomeCanvasAppearanceDraft = {
  backgroundColor: string;
  gridColor: string;
  gridEnabled: boolean;
  gridDensity: number;
};

export function isPostgresHomeCanvasHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
}

export function PostgresCanvasAppearanceModal(props: {
  draft: PostgresHomeCanvasAppearanceDraft;
  saving: boolean;
  error: string;
  defaultBackgroundColor: string;
  defaultGridColor: string;
  onDraftChange: (patch: Partial<PostgresHomeCanvasAppearanceDraft>) => void;
  onReset: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const {
    draft,
    saving,
    error,
    defaultBackgroundColor,
    defaultGridColor,
    onDraftChange,
    onReset,
    onDone,
  } = props;

  return (
    <SettingsModal
      title={t("sharedModals.canvas.editTitle")}
      onClose={onDone}
      closeDisabled={saving}
    >
      <div className="form app-settings-modal-body">
        <div className="timeline-appearance-grid">
          <label className="form-label">
            {t("sharedModals.canvas.background")}
            <div className="timeline-group-color-control">
              <input
                className="form-input form-input--color"
                type="color"
                value={isPostgresHomeCanvasHexColor(draft.backgroundColor) ? draft.backgroundColor : defaultBackgroundColor}
                onChange={(event) => onDraftChange({ backgroundColor: event.target.value })}
                disabled={saving}
              />
              <input
                className="form-input timeline-group-color-text"
                value={draft.backgroundColor}
                onChange={(event) => onDraftChange({ backgroundColor: event.target.value })}
                disabled={saving}
              />
            </div>
          </label>
          <label className="form-label">
            {t("sharedModals.canvas.gridlines")}
            <div className="timeline-group-color-control">
              <input
                className="form-input form-input--color"
                type="color"
                value={isPostgresHomeCanvasHexColor(draft.gridColor) ? draft.gridColor : defaultGridColor}
                onChange={(event) => onDraftChange({ gridColor: event.target.value })}
                disabled={saving}
              />
              <input
                className="form-input timeline-group-color-text"
                value={draft.gridColor}
                onChange={(event) => onDraftChange({ gridColor: event.target.value })}
                disabled={saving}
              />
            </div>
          </label>
        </div>
        <div className="timeline-group-setting-row">
          <div>
            <span className="form-label">{t("sharedModals.canvas.gridlines")}</span>
            <div className="settings-row-desc">{t("sharedModals.canvas.gridlinesDescription")}</div>
          </div>
          <div className="segmented-control timeline-group-setting-control" role="tablist" aria-label={t("sharedModals.canvas.gridlinesAria")}>
            <button
              type="button"
              role="tab"
              aria-selected={draft.gridEnabled}
              className={`segmented-control-option${draft.gridEnabled ? " segmented-control-option--active" : ""}`}
              onClick={() => onDraftChange({ gridEnabled: true })}
              disabled={saving}
            >
              {t("sharedModals.canvas.show")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!draft.gridEnabled}
              className={`segmented-control-option${!draft.gridEnabled ? " segmented-control-option--active" : ""}`}
              onClick={() => onDraftChange({ gridEnabled: false })}
              disabled={saving}
            >
              {t("sharedModals.canvas.hide")}
            </button>
          </div>
        </div>
        <fieldset disabled={!draft.gridEnabled || saving} style={{ border: 0, margin: 0, padding: 0 }}>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">{t("sharedModals.canvas.gridlineDensity")}</div>
              <div className="settings-row-desc">{t("sharedModals.canvas.gridlineDensityDescription")}</div>
            </div>
            <div className="slider-control">
              <input
                type="range"
                className="slider-input"
                min={8}
                max={48}
                value={draft.gridDensity}
                onChange={(event) => onDraftChange({ gridDensity: Number(event.target.value) })}
              />
              <span className="slider-value">{draft.gridDensity}px</span>
            </div>
          </div>
        </fieldset>
        {error ? <div className="form-error">{error}</div> : null}
      </div>
      <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
        <button
          type="button"
          className="btn"
          onClick={onReset}
          disabled={saving}
        >
          {t("common.reset")}
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={onDone}
          disabled={saving}
        >
          {saving ? t("common.saving") : t("common.done")}
        </button>
      </div>
    </SettingsModal>
  );
}
