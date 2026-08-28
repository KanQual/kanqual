import type { Dispatch, FormEvent, SetStateAction } from "react";
import { SettingsModal } from "./SettingsModal";
import {
  PostgresObjectGraphicPreviewCard,
  PostgresObjectShapePicker,
} from "./PostgresGraphicsControls";
import {
  isVisibleItemTimelineAttribute,
  itemTimelineAttributeDefaultValue,
  itemTimelineAttributeLabel,
} from "../lib/timelineAttributeUi";
import type {
  PostgresObjectAttributeDefinition,
  PostgresObjectType,
} from "../lib/postgres";
import {
  getPostgresSourceObjectVisualKey,
  normalizePostgresObjectFillTransparency,
  normalizePostgresObjectOutlineWidth,
  normalizePostgresObjectTypeColor,
  resolvePostgresObjectColor,
  resolvePostgresObjectFill,
  resolvePostgresObjectOutlineColor,
  resolvePostgresObjectShape,
} from "../lib/postgresGraphics";

export type PostgresObjectInstanceGraphicMode = "inherit" | "select" | "upload";

export type PostgresObjectGraphicModeConfig = {
  setMode: Dispatch<SetStateAction<PostgresObjectInstanceGraphicMode>>;
  setShapeOverride: Dispatch<SetStateAction<string>>;
  setColorOverride: Dispatch<SetStateAction<string>>;
  setOutlineColorOverride: Dispatch<SetStateAction<string>>;
  setFillOverride: Dispatch<SetStateAction<string>>;
  setFillTransparencyOverride: Dispatch<SetStateAction<number | null>>;
  setOutlineWidthOverride: Dispatch<SetStateAction<number | null>>;
  setImageStoragePath: Dispatch<SetStateAction<string>>;
  onClearPendingImage?: () => void;
  objectId?: string | null;
};

export function PostgresObjectModal(config: {
  title: string;
  ariaLabel: string;
  tab: "details" | "graphics" | "attributes" | "timeline";
  setTab: Dispatch<SetStateAction<"details" | "graphics" | "attributes" | "timeline">>;
  submitLabel: string;
  objectTypes: PostgresObjectType[];
  projectStoragePath: string;
  submitting: boolean;
  imageUploadSubmitting: boolean;
  activeObjectId?: string | null;
  objectTypeId: string;
  titleValue: string;
  descriptionValue: string;
  colorOverride: string;
  outlineColorOverride: string;
  shapeOverride: string;
  fillOverride: string;
  fillTransparencyOverride: number | null;
  outlineWidthOverride: number | null;
  imageStoragePath: string;
  imagePreviewUrl?: string;
  graphicMode: PostgresObjectInstanceGraphicMode;
  selectedType: PostgresObjectType | null;
  attributeDefinitions: PostgresObjectAttributeDefinition[];
  attributeValues: Record<string, string>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  setObjectTypeId: Dispatch<SetStateAction<string>>;
  setTitleValue: Dispatch<SetStateAction<string>>;
  setDescriptionValue: Dispatch<SetStateAction<string>>;
  setColorOverride: Dispatch<SetStateAction<string>>;
  setOutlineColorOverride: Dispatch<SetStateAction<string>>;
  setShapeOverride: Dispatch<SetStateAction<string>>;
  setFillOverride: Dispatch<SetStateAction<string>>;
  setFillTransparencyOverride: Dispatch<SetStateAction<number | null>>;
  setOutlineWidthOverride: Dispatch<SetStateAction<number | null>>;
  setImageStoragePath: Dispatch<SetStateAction<string>>;
  setGraphicMode: Dispatch<SetStateAction<PostgresObjectInstanceGraphicMode>>;
  setAttributeValues: Dispatch<SetStateAction<Record<string, string>>>;
  onSetGraphicMode: (mode: PostgresObjectInstanceGraphicMode, config: PostgresObjectGraphicModeConfig) => void;
  onImportImage?: () => void;
  onRemoveImage?: () => void;
  onClearPendingImage?: () => void;
  onNewObjectType?: () => void;
  hideEmptyUploadPreview?: boolean;
}) {
  const inheritedColor = normalizePostgresObjectTypeColor(config.selectedType?.color || "");
  const inheritedOutlineColor = resolvePostgresObjectOutlineColor(
    { colorOverride: "", outlineColorOverride: "" },
    config.selectedType,
  );
  const effectiveColor = resolvePostgresObjectColor({ colorOverride: config.colorOverride }, config.selectedType);
  const effectiveOutlineColor = resolvePostgresObjectOutlineColor(
    { colorOverride: config.colorOverride, outlineColorOverride: config.outlineColorOverride },
    config.selectedType,
  );
  const colorInherited = !config.colorOverride.trim();
  const outlineColorInherited = !config.outlineColorOverride.trim();
  const inheritedShape = resolvePostgresObjectShape({ shapeOverride: "" }, config.selectedType);
  const effectiveShape = resolvePostgresObjectShape({ shapeOverride: config.shapeOverride }, config.selectedType);
  const inheritedFill = resolvePostgresObjectFill({ fillOverride: "" }, config.selectedType);
  const effectiveFill = resolvePostgresObjectFill({ fillOverride: config.fillOverride }, config.selectedType);
  const inheritedFillTransparency = normalizePostgresObjectFillTransparency(config.selectedType?.fillTransparency);
  const effectiveFillTransparency = normalizePostgresObjectFillTransparency(config.fillTransparencyOverride ?? config.selectedType?.fillTransparency);
  const inheritedOutlineWidth = normalizePostgresObjectOutlineWidth(config.selectedType?.outlineWidth);
  const effectiveOutlineWidth = normalizePostgresObjectOutlineWidth(config.outlineWidthOverride ?? config.selectedType?.outlineWidth);
  const effectiveImageStoragePath = config.imageStoragePath || config.selectedType?.imageStoragePath || "";
  const hasUploadedObjectImage = Boolean(config.imageStoragePath || config.imagePreviewUrl);
  const showObjectUploadDetails = config.graphicMode !== "upload" || hasUploadedObjectImage || !config.hideEmptyUploadPreview;
  const timelineAttributeDefinitions = config.attributeDefinitions.filter(isVisibleItemTimelineAttribute);
  const disabled = config.submitting || config.imageUploadSubmitting;
  const setGraphicMode = (mode: PostgresObjectInstanceGraphicMode, clearPendingImage = true) => {
    config.onSetGraphicMode(mode, {
      setMode: config.setGraphicMode,
      setShapeOverride: config.setShapeOverride,
      setColorOverride: config.setColorOverride,
      setOutlineColorOverride: config.setOutlineColorOverride,
      setFillOverride: config.setFillOverride,
      setFillTransparencyOverride: config.setFillTransparencyOverride,
      setOutlineWidthOverride: config.setOutlineWidthOverride,
      setImageStoragePath: config.setImageStoragePath,
      onClearPendingImage: clearPendingImage ? config.onClearPendingImage : undefined,
      objectId: config.activeObjectId,
    });
  };

  return (
    <SettingsModal
      title={config.title}
      onClose={config.onClose}
      closeDisabled={config.submitting}
      modalClassName="modal--wide"
    >
      <form onSubmit={config.onSubmit} className="form app-settings-modal-body">
        <div className="segmented-control modal-segmented-control" role="tablist" aria-label={config.ariaLabel}>
          <button
            type="button"
            className={`segmented-control-option ${config.tab === "details" ? "segmented-control-option--active" : ""}`}
            onClick={() => config.setTab("details")}
          >
            Details
          </button>
          <button
            type="button"
            className={`segmented-control-option ${config.tab === "graphics" ? "segmented-control-option--active" : ""}`}
            onClick={() => config.setTab("graphics")}
          >
            Graphics
          </button>
          <button
            type="button"
            className={`segmented-control-option ${config.tab === "attributes" ? "segmented-control-option--active" : ""}`}
            onClick={() => config.setTab("attributes")}
          >
            Attributes
          </button>
          <button
            type="button"
            className={`segmented-control-option ${config.tab === "timeline" ? "segmented-control-option--active" : ""}`}
            onClick={() => config.setTab("timeline")}
          >
            Timeline
          </button>
        </div>
        {config.tab === "details" ? (
          <>
            <label className="form-label">
              Object type
              <select
                className="form-input"
                value={config.objectTypeId}
                onChange={(event) => {
                  if (event.target.value === "__new_object_type__") {
                    config.onNewObjectType?.();
                    return;
                  }
                  config.setObjectTypeId(event.target.value);
                }}
                autoFocus
              >
                <option value="" disabled>Select an object type</option>
                {config.objectTypes.map((objectType) => (
                  <option key={objectType.id} value={objectType.id}>{objectType.name}</option>
                ))}
                {config.onNewObjectType ? (
                  <option value="__new_object_type__">Add new object type...</option>
                ) : null}
              </select>
            </label>
            <label className="form-label">
              Title
              <input className="form-input" value={config.titleValue} onChange={(event) => config.setTitleValue(event.target.value)} />
            </label>
            <label className="form-label">
              Description
              <textarea className="form-input form-textarea" rows={3} value={config.descriptionValue} onChange={(event) => config.setDescriptionValue(event.target.value)} />
            </label>
          </>
        ) : config.tab === "graphics" ? (
          <div className="source-graphics-layout">
            <div className="source-graphics-controls">
              <div style={{ display: "flex", justifyContent: "center" }}>
                <div className="segmented-control modal-segmented-control modal-secondary-segmented-control modal-secondary-segmented-control--three" role="tablist" aria-label="Object graphic source">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={config.graphicMode === "inherit"}
                    className={`segmented-control-option ${config.graphicMode === "inherit" ? "segmented-control-option--active" : ""}`}
                    onClick={() => setGraphicMode("inherit")}
                    disabled={disabled}
                  >
                    Inherit
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={config.graphicMode === "select"}
                    className={`segmented-control-option ${config.graphicMode === "select" ? "segmented-control-option--active" : ""}`}
                    onClick={() => setGraphicMode("select")}
                    disabled={disabled}
                  >
                    Select
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={config.graphicMode === "upload"}
                    className={`segmented-control-option ${config.graphicMode === "upload" ? "segmented-control-option--active" : ""}`}
                    onClick={() => setGraphicMode("upload", false)}
                    disabled={disabled}
                  >
                    Upload
                  </button>
                </div>
              </div>
              {config.graphicMode === "inherit" ? (
                <p className="auth-hint" style={{ margin: "4px 0 0", textAlign: "center" }}>
                  This object will inherit its graphical elements from its object type.
                </p>
              ) : config.graphicMode === "upload" ? (
                <>
                  <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={config.onImportImage}
                      disabled={disabled || !config.onImportImage}
                    >
                      {hasUploadedObjectImage ? "Replace image" : "Upload Image"}
                    </button>
                    {hasUploadedObjectImage ? (
                      <button
                        type="button"
                        className="btn btn--ghost-danger btn--small"
                        onClick={config.onRemoveImage}
                        disabled={disabled || !config.onRemoveImage}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  {showObjectUploadDetails ? (
                    <label className="form-label">
                      Outline
                      <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
                        <input
                          className="form-input form-input--color"
                          type="color"
                          value={effectiveOutlineColor}
                          onChange={(event) => config.setOutlineColorOverride(event.target.value)}
                          style={{ width: 92, minWidth: 92, height: 56 }}
                        />
                        <input
                          className="form-input"
                          value={outlineColorInherited ? inheritedOutlineColor : config.outlineColorOverride}
                          onChange={(event) => config.setOutlineColorOverride(event.target.value)}
                          style={{ flex: "0 0 148px", fontFamily: "monospace" }}
                        />
                      </div>
                    </label>
                  ) : null}
                </>
              ) : (
                <>
                  <label className="form-label">
                    Shape
                    <PostgresObjectShapePicker
                      value={effectiveShape}
                      onChange={(value) => config.setShapeOverride(value === inheritedShape ? "" : value)}
                      previewColor={effectiveColor}
                      previewOutlineColor={effectiveOutlineColor}
                      previewFill={effectiveFill}
                      previewFillTransparency={effectiveFillTransparency}
                      previewOutlineWidth={effectiveOutlineWidth}
                    />
                  </label>
                  <div className="source-graphics-setting-row">
                    <span className="form-label">Fill Style</span>
                    <div className="segmented-control source-graphics-fill-control" role="tablist" aria-label="Object fill style">
                      {(["outline", "filled"] as const).map((option) => (
                        <button
                          key={option}
                          type="button"
                          className={`segmented-control-option ${effectiveFill === option ? "segmented-control-option--active" : ""}`}
                          onClick={() => config.setFillOverride(option === inheritedFill ? "" : option)}
                          aria-pressed={effectiveFill === option}
                        >
                          {option === "outline" ? "Outline" : "Filled"}
                        </button>
                      ))}
                    </div>
                  </div>
                  {effectiveFill === "filled" ? (
                    <>
                      <label className="form-label">
                        Fill
                        <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
                          <input
                            className="form-input form-input--color"
                            type="color"
                            value={effectiveColor}
                            onChange={(event) => config.setColorOverride(event.target.value)}
                            style={{ width: 92, minWidth: 92, height: 56 }}
                          />
                          <input
                            className="form-input"
                            value={colorInherited ? inheritedColor : config.colorOverride}
                            onChange={(event) => config.setColorOverride(event.target.value)}
                            style={{ flex: "1 1 132px", minWidth: 0, fontFamily: "monospace" }}
                          />
                        </div>
                      </label>
                      <label className="form-label timeline-group-opacity-control">
                        Fill Transparency
                        <div className="timeline-group-slider-row">
                          <input
                            className="form-range"
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            value={effectiveFillTransparency}
                            onChange={(event) => {
                              const nextValue = Number(event.target.value);
                              config.setFillTransparencyOverride(nextValue === inheritedFillTransparency ? null : nextValue);
                            }}
                          />
                          <span className="timeline-group-slider-value">{effectiveFillTransparency}%</span>
                        </div>
                      </label>
                    </>
                  ) : null}
                  <label className="form-label">
                    Outline
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
                      <input
                        className="form-input form-input--color"
                        type="color"
                        value={effectiveOutlineColor}
                        onChange={(event) => config.setOutlineColorOverride(event.target.value)}
                        style={{ width: 92, minWidth: 92, height: 56 }}
                      />
                      <input
                        className="form-input"
                        value={outlineColorInherited ? inheritedOutlineColor : config.outlineColorOverride}
                        onChange={(event) => config.setOutlineColorOverride(event.target.value)}
                        style={{ flex: "1 1 132px", minWidth: 0, fontFamily: "monospace" }}
                      />
                    </div>
                  </label>
                  <label className="form-label timeline-group-opacity-control">
                    Outline Width
                    <div className="timeline-group-slider-row">
                      <input
                        className="form-range"
                        type="range"
                        min="1"
                        max="10"
                        step="1"
                        value={effectiveOutlineWidth}
                        onChange={(event) => {
                          const nextValue = Number(event.target.value);
                          config.setOutlineWidthOverride(nextValue === inheritedOutlineWidth ? null : nextValue);
                        }}
                      />
                      <span className="timeline-group-slider-value">{effectiveOutlineWidth}px</span>
                    </div>
                  </label>
                </>
              )}
            </div>
            <PostgresObjectGraphicPreviewCard
              label="Object graphic preview"
              projectStoragePath={config.projectStoragePath}
              imageStoragePath={effectiveImageStoragePath}
              previewUrl={config.imagePreviewUrl ?? ""}
              shape={effectiveShape}
              fill={effectiveFill}
              color={effectiveColor}
              outlineColor={effectiveOutlineColor}
              fillTransparency={effectiveFillTransparency}
              outlineWidth={effectiveOutlineWidth}
              sourceVisualKey={config.graphicMode === "select" ? null : getPostgresSourceObjectVisualKey(config.selectedType?.systemKey)}
              empty={!showObjectUploadDetails}
            />
          </div>
        ) : config.tab === "timeline" ? (
          timelineAttributeDefinitions.length > 0 ? (
            <div className="case-detail-attributes-table-wrap">
              <table className="case-detail-attributes-table">
                <tbody>
                  {timelineAttributeDefinitions.map((definition) => {
                    const defaultValue = itemTimelineAttributeDefaultValue(definition, config.titleValue);
                    return (
                      <tr key={definition.id}>
                        <th className="case-detail-attributes-label" scope="row">{itemTimelineAttributeLabel(definition)}</th>
                        <td className="case-detail-attributes-value">
                          {definition.dataType === "categorical" ? (
                            <select
                              className="form-input"
                              value={config.attributeValues[definition.id] ?? ""}
                              onChange={(event) =>
                                config.setAttributeValues((current) => ({ ...current, [definition.id]: event.target.value }))
                              }
                            >
                              <option value="">{defaultValue || "-"}</option>
                              {definition.options.map((option) => (
                                <option key={option} value={option}>{option}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              className="form-input"
                              type={definition.dataType === "number" ? "number" : definition.dataType === "datetime" ? "datetime-local" : "text"}
                              step={definition.dataType === "number" ? "any" : undefined}
                              placeholder={defaultValue}
                              value={config.attributeValues[definition.id] ?? ""}
                              onChange={(event) =>
                                config.setAttributeValues((current) => ({ ...current, [definition.id]: event.target.value }))
                              }
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="auth-hint" style={{ marginTop: 0 }}>
              No timeline fields have been configured for this object type yet.
            </p>
          )
        ) : config.attributeDefinitions.length > 0 ? (
          <div className="case-detail-attributes-table-wrap">
            <table className="case-detail-attributes-table">
              <tbody>
                {config.attributeDefinitions.map((definition) => (
                  <tr key={definition.id}>
                    <th className="case-detail-attributes-label" scope="row">{definition.name}</th>
                    <td className="case-detail-attributes-value">
                      {definition.dataType === "categorical" ? (
                        <select
                          className="form-input"
                          value={config.attributeValues[definition.id] ?? ""}
                          onChange={(event) =>
                            config.setAttributeValues((current) => ({ ...current, [definition.id]: event.target.value }))
                          }
                        >
                          <option value="">-</option>
                          {definition.options.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="form-input"
                          type={definition.dataType === "number" ? "number" : definition.dataType === "datetime" ? "datetime-local" : "text"}
                          step={definition.dataType === "number" ? "any" : undefined}
                          value={config.attributeValues[definition.id] ?? ""}
                          onChange={(event) =>
                            config.setAttributeValues((current) => ({ ...current, [definition.id]: event.target.value }))
                          }
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="auth-hint" style={{ marginTop: 0 }}>
            No shared attributes for this relationship type yet.
          </p>
        )}
        <div className="app-settings-modal-footer">
          <button type="button" className="btn" onClick={config.onClose} disabled={config.submitting}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={config.submitting}>
            {config.submitting ? "Saving..." : config.submitLabel}
          </button>
        </div>
      </form>
    </SettingsModal>
  );
}
