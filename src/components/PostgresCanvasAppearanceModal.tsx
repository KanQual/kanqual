import { SettingsModal } from "./SettingsModal";

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
      title="Edit canvas"
      onClose={onDone}
      closeDisabled={saving}
    >
      <div className="form app-settings-modal-body">
        <div className="timeline-appearance-grid">
          <label className="form-label">
            Background
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
            Gridlines
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
            <span className="form-label">Gridlines</span>
            <div className="settings-row-desc">Show or hide gridlines behind graph canvases</div>
          </div>
          <div className="segmented-control timeline-group-setting-control" role="tablist" aria-label="Canvas gridlines">
            <button
              type="button"
              role="tab"
              aria-selected={draft.gridEnabled}
              className={`segmented-control-option${draft.gridEnabled ? " segmented-control-option--active" : ""}`}
              onClick={() => onDraftChange({ gridEnabled: true })}
              disabled={saving}
            >
              Show
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!draft.gridEnabled}
              className={`segmented-control-option${!draft.gridEnabled ? " segmented-control-option--active" : ""}`}
              onClick={() => onDraftChange({ gridEnabled: false })}
              disabled={saving}
            >
              Hide
            </button>
          </div>
        </div>
        <fieldset disabled={!draft.gridEnabled || saving} style={{ border: 0, margin: 0, padding: 0 }}>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">Gridline Density</div>
              <div className="settings-row-desc">Distance between canvas gridlines</div>
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
          Reset
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={onDone}
          disabled={saving}
        >
          {saving ? "Saving..." : "Done"}
        </button>
      </div>
    </SettingsModal>
  );
}
