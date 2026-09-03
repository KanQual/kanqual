import type { SharedAttributeDataType } from "./AttributeValuesModal";
import { DeleteIcon, EditIcon, PlusIcon } from "./AppIcons";
import { useI18n } from "../i18n/provider";

export type EditableAttributeMatrixDefinition = {
  id: string;
  name: string;
  dataType: SharedAttributeDataType;
  description?: string;
  options: string[];
};

export type EditableAttributeMatrixRow = {
  id: string;
  name: string;
};

export type EditableAttributeMatrixValues = Record<string, Record<string, string>>;

function inputTypeForDataType(dataType: SharedAttributeDataType) {
  if (dataType === "number") return "number";
  if (dataType === "datetime") return "datetime-local";
  return "text";
}

export function EditableAttributesMatrix({
  definitions,
  rows,
  values,
  disabled = false,
  emptyDefinitionsLabel,
  emptyRowsLabel,
  onAddAttribute,
  onEditAttribute,
  onDeleteAttribute,
  onChangeValue,
}: {
  definitions: EditableAttributeMatrixDefinition[];
  rows: EditableAttributeMatrixRow[];
  values: EditableAttributeMatrixValues;
  disabled?: boolean;
  emptyDefinitionsLabel: string;
  emptyRowsLabel: string;
  onAddAttribute: () => void;
  onEditAttribute: (definitionId: string) => void;
  onDeleteAttribute: (definitionId: string) => void;
  onChangeValue: (definitionId: string, rowId: string, value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="postgres-attribute-modal-section editable-attributes-matrix-section">
      <div className="editable-attributes-matrix-header">
        <div className="postgres-attribute-modal-title">{t("sharedModals.attributes.title")}</div>
        <button
          type="button"
          className="btn btn--primary project-table-header-icon-button"
          onClick={onAddAttribute}
          disabled={disabled}
          title={t("sharedModals.attributes.add")}
          aria-label={t("sharedModals.attributes.add")}
        >
          <PlusIcon className="project-table-header-icon" />
        </button>
      </div>
      {definitions.length === 0 ? (
        <p className="auth-hint" style={{ margin: 0 }}>{emptyDefinitionsLabel}</p>
      ) : rows.length === 0 ? (
        <div className="editable-attributes-matrix-definition-fallback">
          <p className="auth-hint" style={{ margin: 0 }}>{emptyRowsLabel}</p>
          <div className="editable-attributes-matrix-definition-cards">
            {definitions.map((definition) => (
              <div key={definition.id} className="editable-attributes-matrix-definition-card">
                <div className="editable-attributes-matrix-definition-card-body">
                  <strong>{definition.name}</strong>
                  <span>{definition.dataType}</span>
                  <span>{definition.description || (definition.options.length > 0 ? definition.options.join(", ") : t("sharedModals.attributes.noDescription"))}</span>
                </div>
                <span className="editable-attributes-matrix-column-actions">
                  <button
                    type="button"
                    className="btn editable-attributes-matrix-column-action"
                    onClick={() => onEditAttribute(definition.id)}
                    disabled={disabled}
                    title={t("sharedModals.attributes.edit", { name: definition.name })}
                    aria-label={t("sharedModals.attributes.edit", { name: definition.name })}
                  >
                    <EditIcon className="editable-attributes-matrix-column-action-icon" />
                  </button>
                  <button
                    type="button"
                    className="btn editable-attributes-matrix-column-action editable-attributes-matrix-column-action--danger"
                    onClick={() => onDeleteAttribute(definition.id)}
                    disabled={disabled}
                    title={t("sharedModals.attributes.delete", { name: definition.name })}
                    aria-label={t("sharedModals.attributes.delete", { name: definition.name })}
                  >
                    <DeleteIcon className="editable-attributes-matrix-column-action-icon" />
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="users-table-wrap editable-attributes-matrix-wrap">
          <table className="users-table editable-attributes-matrix-table">
            <thead>
              <tr>
                <th className="users-th editable-attributes-matrix-name-col">{t("sharedModals.attributes.nameColumn")}</th>
                {definitions.map((definition) => (
                  <th key={definition.id} className="users-th editable-attributes-matrix-attribute-col">
                    <div className="editable-attributes-matrix-column-header">
                      <span title={definition.name}>{definition.name}</span>
                      <span className="editable-attributes-matrix-column-actions">
                        <button
                          type="button"
                          className="btn editable-attributes-matrix-column-action"
                          onClick={() => onEditAttribute(definition.id)}
                          disabled={disabled}
                          title={t("sharedModals.attributes.edit", { name: definition.name })}
                          aria-label={t("sharedModals.attributes.edit", { name: definition.name })}
                        >
                          <EditIcon className="editable-attributes-matrix-column-action-icon" />
                        </button>
                        <button
                          type="button"
                          className="btn editable-attributes-matrix-column-action editable-attributes-matrix-column-action--danger"
                          onClick={() => onDeleteAttribute(definition.id)}
                          disabled={disabled}
                          title={t("sharedModals.attributes.delete", { name: definition.name })}
                          aria-label={t("sharedModals.attributes.delete", { name: definition.name })}
                        >
                          <DeleteIcon className="editable-attributes-matrix-column-action-icon" />
                        </button>
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="users-row">
                  <td className="users-td users-td--name editable-attributes-matrix-name-cell">{row.name}</td>
                  {definitions.map((definition) => {
                    const value = values[definition.id]?.[row.id] ?? "";
                    return (
                      <td key={`${row.id}-${definition.id}`} className="users-td editable-attributes-matrix-cell">
                        {definition.dataType === "categorical" ? (
                          <select
                            className="form-input editable-attributes-matrix-input"
                            value={value}
                            onChange={(event) => onChangeValue(definition.id, row.id, event.target.value)}
                            disabled={disabled}
                          >
                            <option value="">-</option>
                            {definition.options.map((option) => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                            {value.trim() && !definition.options.includes(value) ? (
                              <option value={value}>{value}</option>
                            ) : null}
                          </select>
                        ) : (
                          <input
                            className="form-input editable-attributes-matrix-input"
                            type={inputTypeForDataType(definition.dataType)}
                            step={definition.dataType === "number" ? "any" : undefined}
                            value={value}
                            onChange={(event) => onChangeValue(definition.id, row.id, event.target.value)}
                            disabled={disabled}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
