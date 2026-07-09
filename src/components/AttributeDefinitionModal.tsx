import { useState } from "react";
import { useI18n } from "../i18n/provider";
import type { SharedAttributeDataType, SharedAttributeDraft } from "./AttributeValuesModal";

function normalizeAttributeOptions(options: string[]): string[] {
  return options.map((option) => option.trim()).filter(Boolean);
}

export function AttributeDefinitionModal({
  draft,
  saving,
  error,
  title,
  onCancel,
  onSave,
}: {
  draft: SharedAttributeDraft;
  saving: boolean;
  error?: string;
  title: string;
  onCancel: () => void;
  onSave: (draft: SharedAttributeDraft) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(draft.name);
  const [dataType, setDataType] = useState<SharedAttributeDataType>(draft.dataType);
  const [description, setDescription] = useState(draft.description);
  const [options, setOptions] = useState<string[]>(draft.options.length > 0 ? draft.options : ["", ""]);

  const typeOptions: Array<{ value: SharedAttributeDataType; label: string }> = [
    { value: "text", label: t("attributeModal.types.text") },
    { value: "number", label: t("attributeModal.types.number") },
    { value: "datetime", label: t("attributeModal.types.datetime") },
    { value: "categorical", label: t("attributeModal.types.categorical") },
  ];

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        <div className="attribute-values-details">
          <label className="form-group">
            <span className="form-label">{t("attributeModal.attributeName")}</span>
            <input
              className="form-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </label>
          <div className="form-group attribute-details-span">
            <span className="form-label">{t("attributeModal.dataType")}</span>
            <div className="attribute-type-picker">
              {typeOptions.map((option) => (
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
            <span className="form-label">{t("attributeModal.description")}</span>
            <textarea
              className="form-input attribute-description-input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
            />
          </label>
          {dataType === "categorical" ? (
            <div className="form-group attribute-details-span">
              <span className="form-label">{t("attributeModal.categories")}</span>
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
                    placeholder={t("attributeModal.categoryPlaceholder", { index: index + 1 })}
                  />
                ))}
              </div>
              <button
                type="button"
                className="btn btn--small"
                onClick={() => setOptions((current) => [...current, ""])}
              >
                {t("attributeModal.addMore") }
              </button>
            </div>
          ) : null}
        </div>
        {error ? <div className="form-error" style={{ marginTop: 16 }}>{error}</div> : null}
        <div className="form-actions" style={{ marginTop: 20 }}>
          <button className="btn" onClick={onCancel} disabled={saving}>{t("common.cancel")}</button>
          <button
            className="btn btn--primary"
            onClick={() =>
              onSave({
                ...draft,
                name: name.trim(),
                dataType,
                description: description.trim(),
                options: normalizeAttributeOptions(options),
              })
            }
            disabled={saving || !name.trim() || (dataType === "categorical" && normalizeAttributeOptions(options).length < 2)}
          >
            {saving ? t("attributeModal.saving") : t("attributeModal.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
