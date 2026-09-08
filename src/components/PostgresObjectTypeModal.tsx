import type { Dispatch, FormEvent, SetStateAction } from "react";
import {
  EditableAttributesMatrix,
  type EditableAttributeMatrixValues,
} from "./EditableAttributesMatrix";
import { ModalTabSelector } from "./ModalTabSelector";
import {
  PostgresGraphicModeTabs,
  PostgresImageUploadActions,
  PostgresObjectGraphicPreviewCard,
  PostgresObjectSelectGraphicControls,
  PostgresObjectUploadGraphicControls,
} from "./PostgresGraphicsControls";
import { SettingsModal } from "./SettingsModal";
import type { SharedAttributeDraft } from "./AttributeValuesModal";
import {
  TIMELINE_FIELD_OPTIONS,
  type TimelineFieldRole,
  type TypeAttributeDraft,
} from "../views/Project_Home_Timeline_Fields";
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

function PostgresObjectTypeTimelineFields(props: {
  drafts: TypeAttributeDraft[];
  onChange: (role: TimelineFieldRole, value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="attribute-editor-section">
      <div className="attribute-editor-title">{t("sharedModals.tabs.timelineFields")}</div>
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
      <form onSubmit={props.onSubmit} className={`form app-settings-modal-body ${props.tab === "graphics" ? "modal-body--graphics modal-form--graphics" : ""}`}>
        <ModalTabSelector
          value={props.tab}
          options={(["details", "graphics", "attributes", "timeline"] as const).map((tab) => ({
            value: tab,
            label: formatObjectTypeModalTab(tab, t),
          }))}
          ariaLabel={props.ariaLabel}
          onChange={props.setTab}
        />
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
          <div className="graphics-editor-layout">
            <div className="graphics-editor-controls">
              <label className="form-label">
                {t("sharedModals.graphics.image")}
                <PostgresGraphicModeTabs
                  value={props.graphicMode}
                  options={[
                    { value: "select", label: t("common.select") },
                    { value: "upload", label: t("common.upload") },
                  ]}
                  ariaLabel={t("sharedModals.graphics.objectTypeGraphicSource")}
                  onChange={props.onGraphicModeChange}
                  disabled={disabled}
                />
              </label>
              {props.graphicMode === "upload" ? (
                <PostgresImageUploadActions
                  hasImage={hasImage}
                  disabled={disabled}
                  onImport={props.onImportImage}
                  onRemove={props.onRemoveImage}
                />
              ) : null}
              {props.graphicMode === "upload" && hasImage ? (
                <PostgresObjectUploadGraphicControls
                  outlineColor={effectiveOutlineColor}
                  outlineColorText={props.outlineColor || effectiveOutlineColor}
                  outlineWidth={props.outlineWidth}
                  onOutlineColorChange={(value) => props.setOutlineColor(value)}
                  onOutlineWidthChange={(value) => props.setOutlineWidth(value)}
                />
              ) : null}
              {props.graphicMode === "select" ? (
                <PostgresObjectSelectGraphicControls
                  shape={props.shape}
                  color={effectiveColor}
                  colorText={props.color}
                  outlineColor={effectiveOutlineColor}
                  outlineColorText={props.outlineColor}
                  fill={props.fill}
                  fillTransparency={props.fillTransparency}
                  outlineWidth={props.outlineWidth}
                  fillStyleAriaLabel={t("sharedModals.graphics.objectTypeFillStyle")}
                  onShapeChange={(value) => props.setShape(value)}
                  onColorChange={(value) => props.setColor(value)}
                  onOutlineColorChange={(value) => props.setOutlineColor(value)}
                  onFillChange={(value) => props.setFill(value)}
                  onFillTransparencyChange={(value) => props.setFillTransparency(value)}
                  onOutlineWidthChange={(value) => props.setOutlineWidth(value)}
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
