import { useState } from "react";

export type SharedAttributeDataType = "text" | "number" | "datetime" | "categorical";

export type SharedAttributeDraft = {
  id?: string;
  name: string;
  dataType: SharedAttributeDataType;
  description: string;
  options: string[];
};

export type SharedAttributeModalRow = {
  id: string;
  name: string;
};

export const SHARED_ATTRIBUTE_TYPE_OPTIONS: Array<{ value: SharedAttributeDataType; label: string }> = [
  { value: "text", label: "Text" },
  { value: "number", label: "Numbers" },
  { value: "datetime", label: "Date/time" },
  { value: "categorical", label: "Categorical" },
];

function inputTypeForDataType(dataType: SharedAttributeDataType) {
  if (dataType === "number") return "number";
  if (dataType === "datetime") return "datetime-local";
  return "text";
}

function normalizeAttributeOptions(options: string[]): string[] {
  return options.map((option) => option.trim()).filter(Boolean);
}

export function AttributeValuesModal({
  draft,
  rows,
  initialValuesByOwner,
  saving,
  error,
  onBack,
  onCancel,
  onSave,
  emptyStateLabel,
}: {
  draft: SharedAttributeDraft;
  rows: SharedAttributeModalRow[];
  initialValuesByOwner: Record<string, string>;
  saving: boolean;
  error?: string;
  onBack?: () => void;
  onCancel: () => void;
  onSave: (draft: SharedAttributeDraft, valuesByOwner: Record<string, string>) => void;
  emptyStateLabel: string;
}) {
  const [name, setName] = useState(draft.name);
  const [dataType, setDataType] = useState<SharedAttributeDataType>(draft.dataType);
  const [description, setDescription] = useState(draft.description);
  const [options, setOptions] = useState<string[]>(draft.options.length > 0 ? draft.options : ["", ""]);
  const [valuesByOwner, setValuesByOwner] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const row of rows) {
      initial[row.id] = initialValuesByOwner[row.id] ?? "";
    }
    return initial;
  });

  const inputType = inputTypeForDataType(dataType);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
        <h2>{draft.id ? "Edit Attribute" : "Attribute Values"}</h2>

        <div className="attribute-values-details">
          <label className="form-group">
            <span className="form-label">Attribute name</span>
            <input
              className="form-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="form-group attribute-details-span">
            <span className="form-label">Data type</span>
            <div className="attribute-type-picker">
              {SHARED_ATTRIBUTE_TYPE_OPTIONS.map((option) => (
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
          {dataType === "categorical" && (
            <div className="form-group attribute-details-span">
              <span className="form-label">Categories</span>
              <div className="attribute-category-list">
                {options.map((option, index) => (
                  <input
                    key={index}
                    className="form-input"
                    value={option}
                    onChange={(event) =>
                      setOptions((current) =>
                        current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)),
                      )
                    }
                    placeholder={`Category ${index + 1}`}
                  />
                ))}
              </div>
              <button
                type="button"
                className="btn btn--small"
                onClick={() => setOptions((current) => [...current, ""])}
              >
                Add More
              </button>
            </div>
          )}
        </div>

        <div className="attribute-values-list">
          {rows.length === 0 ? (
            <p className="case-card-empty">{emptyStateLabel}</p>
          ) : (
            rows.map((row) => (
              <label key={row.id} className="attribute-value-row">
                <span>{row.name}</span>
                {dataType === "categorical" ? (
                  <select
                    className="form-input"
                    value={valuesByOwner[row.id] ?? ""}
                    onChange={(event) =>
                      setValuesByOwner((current) => ({ ...current, [row.id]: event.target.value }))
                    }
                  >
                    <option value="">-</option>
                    {normalizeAttributeOptions(options).map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                    {(valuesByOwner[row.id] ?? "").trim()
                      && !normalizeAttributeOptions(options).includes(valuesByOwner[row.id] ?? "") && (
                        <option value={valuesByOwner[row.id]}>{valuesByOwner[row.id]}</option>
                      )}
                  </select>
                ) : (
                  <input
                    className="form-input"
                    type={inputType}
                    step={dataType === "number" ? "any" : undefined}
                    value={valuesByOwner[row.id] ?? ""}
                    onChange={(event) =>
                      setValuesByOwner((current) => ({ ...current, [row.id]: event.target.value }))
                    }
                  />
                )}
              </label>
            ))
          )}
        </div>
        {error ? <div className="form-error" style={{ marginTop: 16 }}>{error}</div> : null}

        <div className="form-actions" style={{ marginTop: 20 }}>
          {onBack && <button className="btn" onClick={onBack} disabled={saving}>Back</button>}
          <button className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
          <button
            className="btn btn--primary"
            onClick={() =>
              onSave(
                {
                  ...draft,
                  name: name.trim(),
                  dataType,
                  description: description.trim(),
                  options: normalizeAttributeOptions(options),
                },
                valuesByOwner,
              )
            }
            disabled={saving || !name.trim() || (dataType === "categorical" && normalizeAttributeOptions(options).length < 2)}
          >
            {saving ? "Saving..." : "Save Attribute"}
          </button>
        </div>
      </div>
    </div>
  );
}
