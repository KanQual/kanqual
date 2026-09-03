import type { Dispatch, FormEvent, SetStateAction } from "react";
import {
  EditableAttributesMatrix,
  type EditableAttributeMatrixValues,
} from "./EditableAttributesMatrix";
import {
  PostgresObjectGraphicPreviewCard,
  PostgresObjectShapePicker,
} from "./PostgresGraphicsControls";
import { SettingsModal } from "./SettingsModal";
import type { SharedAttributeDraft } from "./AttributeValuesModal";
import {
  TIMELINE_FIELD_OPTIONS,
  type TimelineFieldRole,
  type TypeAttributeDraft,
} from "../views/Postgres_Project_Home_Timeline_Fields";
import {
  normalizeOptionalPostgresObjectTypeColor,
  normalizePostgresObjectFillTransparency,
  normalizePostgresObjectOutlineWidth,
  normalizePostgresObjectTypeColor,
  type PostgresObjectFill,
  type PostgresObjectTypeShape,
} from "../lib/postgresGraphics";
import { useI18n } from "../i18n/provider";

export type PostgresObjectGraphicMode = "select" | "upload";
type PostgresObjectTypeModalTab = "details" | "graphics" | "attributes" | "timeline";

function formatObjectTypeModalTab(tab: PostgresObjectTypeModalTab, t: ReturnType<typeof useI18n>["t"]): string {
  if (tab === "details") return t("sharedModals.tabs.details");
  if (tab === "graphics") return t("sharedModals.tabs.graphics");
  if (tab === "attributes") return t("sharedModals.tabs.attributes");
  return t("sharedModals.tabs.timeline");
}

function PostgresObjectTypeUploadGraphicControls(props: {
  effectiveOutlineColor: string;
  outlineColor: string;
  outlineWidth: number;
  onOutlineColorChange: Dispatch<SetStateAction<string>>;
  onOutlineWidthChange: Dispatch<SetStateAction<number>>;
}) {
  const { t } = useI18n();
  const effectiveOutlineWidth = normalizePostgresObjectOutlineWidth(props.outlineWidth);
  return (
    <>
      <label className="form-label">
        {t("sharedModals.graphics.outline")}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
          <input
            className="form-input form-input--color"
            type="color"
            value={props.effectiveOutlineColor}
            onChange={(event) => props.onOutlineColorChange(event.target.value)}
            style={{ width: 92, minWidth: 92, height: 56 }}
          />
          <input
            className="form-input"
            value={props.outlineColor || props.effectiveOutlineColor}
            onChange={(event) => props.onOutlineColorChange(event.target.value)}
            style={{ flex: "0 0 132px", fontFamily: "monospace" }}
          />
        </div>
      </label>
      <label className="form-label timeline-group-opacity-control">
        {t("sharedModals.graphics.outlineWidth")}
        <div className="timeline-group-slider-row">
          <input
            className="form-range"
            type="range"
            min="1"
            max="10"
            step="1"
            value={effectiveOutlineWidth}
            onChange={(event) => props.onOutlineWidthChange(Number(event.target.value))}
          />
          <span className="timeline-group-slider-value">{effectiveOutlineWidth}px</span>
        </div>
      </label>
    </>
  );
}

function PostgresObjectTypeSelectGraphicControls(props: {
  shape: PostgresObjectTypeShape;
  color: string;
  outlineColor: string;
  fill: PostgresObjectFill;
  fillTransparency: number;
  outlineWidth: number;
  onShapeChange: Dispatch<SetStateAction<PostgresObjectTypeShape>>;
  onColorChange: Dispatch<SetStateAction<string>>;
  onOutlineColorChange: Dispatch<SetStateAction<string>>;
  onFillChange: Dispatch<SetStateAction<PostgresObjectFill>>;
  onFillTransparencyChange: Dispatch<SetStateAction<number>>;
  onOutlineWidthChange: Dispatch<SetStateAction<number>>;
}) {
  const { t } = useI18n();
  const effectiveColor = normalizePostgresObjectTypeColor(props.color);
  const effectiveFillTransparency = normalizePostgresObjectFillTransparency(props.fillTransparency);
  const effectiveOutlineWidth = normalizePostgresObjectOutlineWidth(props.outlineWidth);
  return (
    <>
      <label className="form-label">
        {t("sharedModals.graphics.shape")}
        <PostgresObjectShapePicker
          value={props.shape}
          onChange={(value) => props.onShapeChange((value || "rounded") as PostgresObjectTypeShape)}
          previewColor={effectiveColor}
          previewOutlineColor={props.outlineColor}
          previewFill={props.fill}
          previewFillTransparency={effectiveFillTransparency}
          previewOutlineWidth={effectiveOutlineWidth}
        />
      </label>
      <div className="source-graphics-setting-row">
        <span className="form-label">{t("sharedModals.graphics.fillStyle")}</span>
        <div className="segmented-control source-graphics-fill-control" role="tablist" aria-label={t("sharedModals.graphics.objectTypeFillStyle")}>
          {(["outline", "filled"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={`segmented-control-option ${props.fill === option ? "segmented-control-option--active" : ""}`}
              onClick={() => props.onFillChange(option)}
              aria-pressed={props.fill === option}
            >
              {option === "outline" ? t("sharedModals.graphics.outline") : t("sharedModals.graphics.filled")}
            </button>
          ))}
        </div>
      </div>
      {props.fill === "filled" ? (
        <>
          <label className="form-label">
            {t("sharedModals.graphics.fill")}
            <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
              <input
                className="form-input form-input--color"
                type="color"
                value={effectiveColor}
                onChange={(event) => props.onColorChange(event.target.value)}
                style={{ width: 92, minWidth: 92, height: 56 }}
              />
              <input
                className="form-input"
                value={props.color}
                onChange={(event) => props.onColorChange(event.target.value)}
                style={{ flex: "1 1 132px", minWidth: 0, fontFamily: "monospace" }}
              />
            </div>
          </label>
          <label className="form-label timeline-group-opacity-control">
            {t("sharedModals.graphics.fillTransparency")}
            <div className="timeline-group-slider-row">
              <input
                className="form-range"
                type="range"
                min="0"
                max="100"
                step="1"
                value={effectiveFillTransparency}
                onChange={(event) => props.onFillTransparencyChange(Number(event.target.value))}
              />
              <span className="timeline-group-slider-value">{effectiveFillTransparency}%</span>
            </div>
          </label>
        </>
      ) : null}
      <label className="form-label">
        {t("sharedModals.graphics.outline")}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
          <input
            className="form-input form-input--color"
            type="color"
            value={props.outlineColor}
            onChange={(event) => props.onOutlineColorChange(event.target.value)}
            style={{ width: 92, minWidth: 92, height: 56 }}
          />
          <input
            className="form-input"
            value={props.outlineColor}
            onChange={(event) => props.onOutlineColorChange(event.target.value)}
            style={{ flex: "1 1 132px", minWidth: 0, fontFamily: "monospace" }}
          />
        </div>
      </label>
      <label className="form-label timeline-group-opacity-control">
        {t("sharedModals.graphics.outlineWidth")}
        <div className="timeline-group-slider-row">
          <input
            className="form-range"
            type="range"
            min="1"
            max="10"
            step="1"
            value={effectiveOutlineWidth}
            onChange={(event) => props.onOutlineWidthChange(Number(event.target.value))}
          />
          <span className="timeline-group-slider-value">{effectiveOutlineWidth}px</span>
        </div>
      </label>
    </>
  );
}

function PostgresObjectTypeTimelineFields(props: {
  drafts: TypeAttributeDraft[];
  onChange: (role: TimelineFieldRole, value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="postgres-attribute-modal-section">
      <div className="postgres-attribute-modal-title">{t("sharedModals.tabs.timelineFields")}</div>
      <div className="case-detail-attributes-table-wrap">
        <table className="case-detail-attributes-table">
          <tbody>
            {TIMELINE_FIELD_OPTIONS.map((field) => {
              const selectedDraft = props.drafts.find((draft) => draft.timelineRole === field.role);
              const eligibleDrafts = props.drafts
                .filter((draft) => field.dataTypes.includes(draft.dataType))
                .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
              return (
                <tr key={field.role}>
                  <th className="case-detail-attributes-label" scope="row">{field.label}</th>
                  <td className="case-detail-attributes-value">
                    <select
                      className="form-input"
                      value={selectedDraft?.localId ?? ""}
                      onChange={(event) => props.onChange(field.role, event.target.value)}
                    >
                      <option value="">{t("sharedModals.attributes.none")}</option>
                      {eligibleDrafts.map((draft) => (
                        <option key={draft.localId} value={draft.localId}>{draft.name || t("sharedModals.attributes.untitledAttribute")}</option>
                      ))}
                      <option value="__create__">{t("sharedModals.attributes.createNewAttribute")}</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PostgresObjectTypeModal(props: {
  title: string;
  subtitle?: string;
  ariaLabel: string;
  tab: PostgresObjectTypeModalTab;
  setTab: Dispatch<SetStateAction<PostgresObjectTypeModalTab>>;
  submitLabel: string;
  projectStoragePath: string;
  submitting: boolean;
  imageUploadSubmitting: boolean;
  name: string;
  description: string;
  shape: PostgresObjectTypeShape;
  color: string;
  outlineColor: string;
  fill: PostgresObjectFill;
  fillTransparency: number;
  outlineWidth: number;
  imageStoragePath: string;
  imagePreviewUrl?: string;
  graphicMode: PostgresObjectGraphicMode;
  attributeDrafts: TypeAttributeDraft[];
  attributeRows: Array<{ id: string; name: string }>;
  attributeValues: EditableAttributeMatrixValues;
  emptyRowsLabel: string;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  setName: Dispatch<SetStateAction<string>>;
  setDescription: Dispatch<SetStateAction<string>>;
  setShape: Dispatch<SetStateAction<PostgresObjectTypeShape>>;
  setColor: Dispatch<SetStateAction<string>>;
  setOutlineColor: Dispatch<SetStateAction<string>>;
  setFill: Dispatch<SetStateAction<PostgresObjectFill>>;
  setFillTransparency: Dispatch<SetStateAction<number>>;
  setOutlineWidth: Dispatch<SetStateAction<number>>;
  onGraphicModeChange: (mode: PostgresObjectGraphicMode) => void;
  onImportImage: () => void;
  onRemoveImage: () => void;
  onTimelineFieldChange: (role: TimelineFieldRole, value: string) => void;
  onAddAttribute: () => void;
  onEditAttribute: (localId: string) => void;
  onDeleteAttribute: (localId: string) => void;
  onChangeValue: (attributeLocalId: string, rowId: string, value: string) => void;
}) {
  const { t } = useI18n();
  const effectiveOutlineColor =
    normalizeOptionalPostgresObjectTypeColor(props.outlineColor)
    || normalizePostgresObjectTypeColor(props.color);
  const hasImage = Boolean(props.imageStoragePath || props.imagePreviewUrl);
  const effectiveColor = normalizePostgresObjectTypeColor(props.color);
  const effectiveFillTransparency = normalizePostgresObjectFillTransparency(props.fillTransparency);
  const effectiveOutlineWidth = normalizePostgresObjectOutlineWidth(props.outlineWidth);
  const disabled = props.submitting || props.imageUploadSubmitting;

  return (
    <SettingsModal
      title={props.title}
      subtitle={props.subtitle}
      onClose={props.onClose}
      closeDisabled={props.submitting}
      modalClassName="modal--wide"
    >
      <form onSubmit={props.onSubmit} className={`form app-settings-modal-body ${props.tab === "graphics" ? "source-editor-modal-body--graphics source-editor-form--graphics" : ""}`}>
        <div className="segmented-control modal-segmented-control" role="tablist" aria-label={props.ariaLabel}>
          {(["details", "graphics", "attributes", "timeline"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`segmented-control-option ${props.tab === tab ? "segmented-control-option--active" : ""}`}
              onClick={() => props.setTab(tab)}
            >
              {formatObjectTypeModalTab(tab, t)}
            </button>
          ))}
        </div>
        {props.tab === "details" ? (
          <>
            <label className="form-label">
              {t("sharedModals.objectModal.objectTypeName")}
              <input
                className="form-input"
                value={props.name}
                onChange={(event) => props.setName(event.target.value)}
                autoFocus
              />
            </label>
            <label className="form-label">
              {t("common.description")}
              <textarea
                className="form-input form-textarea"
                rows={3}
                value={props.description}
                onChange={(event) => props.setDescription(event.target.value)}
              />
            </label>
          </>
        ) : props.tab === "graphics" ? (
          <div className="source-graphics-layout">
            <div className="source-graphics-controls">
              <label className="form-label">
                {t("sharedModals.graphics.image")}
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <div className="segmented-control modal-segmented-control modal-secondary-segmented-control modal-secondary-segmented-control--two" role="tablist" aria-label={t("sharedModals.graphics.objectTypeGraphicSource")}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={props.graphicMode === "select"}
                      className={`segmented-control-option ${props.graphicMode === "select" ? "segmented-control-option--active" : ""}`}
                      onClick={() => props.onGraphicModeChange("select")}
                      disabled={disabled}
                    >
                      {t("common.select")}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={props.graphicMode === "upload"}
                      className={`segmented-control-option ${props.graphicMode === "upload" ? "segmented-control-option--active" : ""}`}
                      onClick={() => props.onGraphicModeChange("upload")}
                      disabled={disabled}
                    >
                      {t("common.upload")}
                    </button>
                  </div>
                </div>
              </label>
              {props.graphicMode === "upload" ? (
                <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={props.onImportImage}
                    disabled={disabled}
                  >
                    {hasImage ? t("sharedModals.graphics.replaceImage") : t("sharedModals.graphics.uploadImage")}
                  </button>
                  {hasImage ? (
                    <button
                      type="button"
                      className="btn btn--ghost-danger btn--small"
                      onClick={props.onRemoveImage}
                      disabled={disabled}
                    >
                      {t("common.remove")}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {props.graphicMode === "upload" && hasImage ? (
                <PostgresObjectTypeUploadGraphicControls
                  effectiveOutlineColor={effectiveOutlineColor}
                  outlineColor={props.outlineColor}
                  outlineWidth={props.outlineWidth}
                  onOutlineColorChange={props.setOutlineColor}
                  onOutlineWidthChange={props.setOutlineWidth}
                />
              ) : null}
              {props.graphicMode === "select" ? (
                <PostgresObjectTypeSelectGraphicControls
                  shape={props.shape}
                  color={props.color}
                  outlineColor={effectiveOutlineColor}
                  fill={props.fill}
                  fillTransparency={props.fillTransparency}
                  outlineWidth={props.outlineWidth}
                  onShapeChange={props.setShape}
                  onColorChange={props.setColor}
                  onOutlineColorChange={props.setOutlineColor}
                  onFillChange={props.setFill}
                  onFillTransparencyChange={props.setFillTransparency}
                  onOutlineWidthChange={props.setOutlineWidth}
                />
              ) : null}
            </div>
            <PostgresObjectGraphicPreviewCard
              label={t("sharedModals.graphics.objectTypePreview")}
              projectStoragePath={props.projectStoragePath}
              imageStoragePath={props.imageStoragePath}
              previewUrl={props.imagePreviewUrl ?? ""}
              shape={props.shape}
              fill={props.fill}
              color={effectiveColor}
              outlineColor={effectiveOutlineColor}
              fillTransparency={effectiveFillTransparency}
              outlineWidth={effectiveOutlineWidth}
              empty={props.graphicMode === "upload" && !hasImage}
            />
          </div>
        ) : props.tab === "timeline" ? (
          <PostgresObjectTypeTimelineFields
            drafts={props.attributeDrafts}
            onChange={props.onTimelineFieldChange}
          />
        ) : (
          <EditableAttributesMatrix
            definitions={props.attributeDrafts.map((draft) => ({
              id: draft.localId,
              name: draft.name || "Untitled attribute",
              dataType: draft.dataType,
              description: draft.description,
              options: draft.options,
            } satisfies SharedAttributeDraft))}
            rows={props.attributeRows}
            values={props.attributeValues}
            disabled={props.submitting}
            emptyDefinitionsLabel={t("sharedModals.objectModal.noTypeAttributes")}
            emptyRowsLabel={props.emptyRowsLabel}
            onAddAttribute={props.onAddAttribute}
            onEditAttribute={props.onEditAttribute}
            onDeleteAttribute={props.onDeleteAttribute}
            onChangeValue={props.onChangeValue}
          />
        )}
        <div className="app-settings-modal-footer">
          <button type="button" className="btn" onClick={props.onClose} disabled={props.submitting}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn btn--primary" disabled={props.submitting}>
            {props.submitting ? t("common.saving") : props.submitLabel}
          </button>
        </div>
      </form>
    </SettingsModal>
  );
}
