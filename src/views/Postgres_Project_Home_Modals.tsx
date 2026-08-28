import { type ReactNode, useState } from "react";
import { SettingsModal } from "../components/SettingsModal";
import type { SharedAttributeDraft } from "../components/AttributeValuesModal";

export type TypeScopedAttributeDraft = SharedAttributeDraft & { typeIds: string[] };

function normalizeAttributeModalOptions(options: string[]): string[] {
  return options.map((option) => option.trim()).filter(Boolean);
}

type TimelineFieldRole = Exclude<NonNullable<SharedAttributeDraft["timelineRole"]>, "">;

const TIMELINE_FIELD_OPTIONS: Array<{
  role: TimelineFieldRole;
  dataTypes: SharedAttributeDraft["dataType"][];
}> = [
  { role: "timeline_start", dataTypes: ["datetime"] },
  { role: "timeline_end", dataTypes: ["datetime"] },
  { role: "timeline_label", dataTypes: ["text", "categorical"] },
  { role: "timeline_item_type", dataTypes: ["categorical"] },
];

function timelineRoleFitsDataType(role: SharedAttributeDraft["timelineRole"], dataType: SharedAttributeDraft["dataType"]): boolean {
  if (!role) return true;
  const option = TIMELINE_FIELD_OPTIONS.find((entry) => entry.role === role);
  return option ? option.dataTypes.includes(dataType) : false;
}

export function TypeScopedAttributeModal({
  draft,
  typeOptions,
  title,
  typeLabel,
  saving,
  error,
  onCancel,
  onSave,
}: {
  draft: TypeScopedAttributeDraft;
  typeOptions: Array<{ id: string; label: string; count: number }>;
  title: string;
  typeLabel: string;
  saving: boolean;
  error?: string;
  onCancel: () => void;
  onSave: (draft: TypeScopedAttributeDraft) => void;
}) {
  const [name, setName] = useState(draft.name);
  const [dataType, setDataType] = useState<SharedAttributeDraft["dataType"]>(draft.dataType);
  const [description, setDescription] = useState(draft.description);
  const [options, setOptions] = useState<string[]>(draft.options.length > 0 ? draft.options : ["", ""]);
  const [typeIds, setTypeIds] = useState<string[]>(draft.typeIds);
  const normalizedOptions = normalizeAttributeModalOptions(options);
  const dataTypeOptions: Array<{ value: SharedAttributeDraft["dataType"]; label: string }> = [
    { value: "text", label: "Text" },
    { value: "number", label: "Number" },
    { value: "datetime", label: "Date/time" },
    { value: "categorical", label: "Categorical" },
  ];
  const effectiveTimelineRole = timelineRoleFitsDataType(draft.timelineRole, dataType) ? draft.timelineRole ?? "" : "";

  return (
    <SettingsModal title={title} onClose={onCancel} closeDisabled={saving} modalClassName="modal--wide">
      <div className="app-settings-modal-body">
        <div className="attribute-values-details">
          <label className="form-group">
            <span className="form-label">Attribute name</span>
            <input className="form-input" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <div className="form-group attribute-details-span">
            <span className="form-label">Data type</span>
            <div className="attribute-type-picker">
              {dataTypeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`attribute-type-btn${dataType === option.value ? " attribute-type-btn--active" : ""}`}
                  onClick={() => setDataType(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <label className="form-group attribute-details-span">
            <span className="form-label">Description</span>
            <textarea
              className="form-input attribute-description-input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
            />
          </label>
          {dataType === "categorical" ? (
            <div className="form-group attribute-details-span">
              <span className="form-label">Categories</span>
              <div className="attribute-category-list">
                {options.map((option, index) => (
                  <input
                    key={index}
                    className="form-input"
                    value={option}
                    onChange={(event) => setOptions((current) => current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))}
                    placeholder={`Category ${index + 1}`}
                  />
                ))}
              </div>
              <button type="button" className="btn btn--small" onClick={() => setOptions((current) => [...current, ""])}>
                Add more
              </button>
            </div>
          ) : null}
        </div>
        <div className="attribute-values-list">
          {typeOptions.length === 0 ? (
            <p className="case-card-empty">No {typeLabel.toLowerCase()} types yet.</p>
          ) : (
            typeOptions.map((option) => (
              <label key={option.id} className="attribute-value-row">
                <span>{option.label}</span>
                <input
                  type="checkbox"
                  checked={typeIds.includes(option.id)}
                  onChange={(event) => {
                    setTypeIds((current) => event.target.checked
                      ? [...current, option.id]
                      : current.filter((id) => id !== option.id));
                  }}
                />
              </label>
            ))
          )}
        </div>
        {error ? <div className="form-error" style={{ marginTop: 16 }}>{error}</div> : null}
      </div>
      <div className="app-settings-modal-footer">
        <button className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
        <button
          className="btn btn--primary"
          onClick={() => onSave({
            ...draft,
            name: name.trim(),
            dataType,
            description: description.trim(),
            options: normalizedOptions,
            timelineRole: effectiveTimelineRole,
            typeIds,
          })}
          disabled={saving || !name.trim() || typeIds.length === 0 || (dataType === "categorical" && normalizedOptions.length < 2)}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </SettingsModal>
  );
}

export function GraphConfirmModal({
  title,
  children,
  warning,
  busy,
  confirmLabel,
  busyLabel,
  danger = true,
  confirmDisabled = false,
  onClose,
  onConfirm,
}: {
  title: string;
  children?: ReactNode;
  warning?: ReactNode;
  busy: boolean;
  confirmLabel: string;
  busyLabel?: string;
  danger?: boolean;
  confirmDisabled?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <SettingsModal title={title} onClose={onClose} closeDisabled={busy} modalClassName="modal--wide">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) onConfirm();
        }}
      >
        <div className="app-settings-modal-body">
          {children}
          {warning ? <p className="modal-warning-text">{warning}</p> : null}
        </div>
        <div className="app-settings-modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            autoFocus
            className={danger ? "btn btn--danger" : "btn btn--primary"}
            disabled={busy || confirmDisabled}
          >
            {busy && busyLabel ? busyLabel : confirmLabel}
          </button>
        </div>
      </form>
    </SettingsModal>
  );
}
