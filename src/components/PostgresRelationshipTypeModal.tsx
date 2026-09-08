import type { Dispatch, FormEvent, SetStateAction } from "react";
import {
  EditableAttributesMatrix,
  type EditableAttributeMatrixValues,
} from "./EditableAttributesMatrix";
import { ModalTabSelector } from "./ModalTabSelector";
import {
  PostgresColorControl,
  PostgresRangeControl,
  PostgresRelationshipArrowheadPicker,
  PostgresRelationshipEndpointRestrictionColumn,
  PostgresRelationshipGraphicPreviewCard,
  PostgresRelationshipLineShapePicker,
} from "./PostgresGraphicsControls";
import { SettingsModal } from "./SettingsModal";
import {
  TIMELINE_FIELD_OPTIONS,
  type TimelineFieldRole,
  type TypeAttributeDraft,
} from "../views/Project_Home_Timeline_Fields";
import {
  POSTGRES_RELATIONSHIP_LINE_WEIGHT_MAX,
  POSTGRES_RELATIONSHIP_LINE_WEIGHT_MIN,
  normalizePostgresRelationshipLineWeight,
  type PostgresObjectFill,
  type PostgresObjectTypeShape,
  type PostgresRelationshipArrowhead,
  type PostgresRelationshipLineShape,
  type PostgresSourceObjectVisualKey,
} from "../lib/postgresGraphics";
import { useI18n } from "../i18n/provider";

export type PostgresRelationshipTypeModalTab =
  | "details"
  | "graphics"
  | "object1"
  | "object2"
  | "attributes"
  | "timeline";

export type PostgresRelationshipEndpointRestrictionItem = {
  id: string;
  label: string;
  color?: string;
  outlineColor?: string;
  shape?: PostgresObjectTypeShape;
  fill?: PostgresObjectFill;
  sourceVisualKey?: PostgresSourceObjectVisualKey | null;
  imageStoragePath?: string;
};

function formatRelationshipTypeModalTab(tab: PostgresRelationshipTypeModalTab, t: ReturnType<typeof useI18n>["t"]): string {
  if (tab === "details") return t("sharedModals.tabs.details");
  if (tab === "graphics") return t("sharedModals.tabs.graphics");
  if (tab === "object1") return t("sharedModals.tabs.object1");
  if (tab === "object2") return t("sharedModals.tabs.object2");
  if (tab === "attributes") return t("sharedModals.tabs.attributes");
  return t("sharedModals.tabs.timeline");
}

function PostgresRelationshipTypeTimelineFields(props: {
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

function PostgresRelationshipTypeEndpointRestrictions(props: {
  objectItems: PostgresRelationshipEndpointRestrictionItem[];
  sourceItems: PostgresRelationshipEndpointRestrictionItem[];
  objectValue: string[];
  sourceValue: string[];
  onObjectChange: Dispatch<SetStateAction<string[]>>;
  onSourceChange: Dispatch<SetStateAction<string[]>>;
  projectStoragePath: string;
}) {
  const { t } = useI18n();
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
        gap: 16,
      }}
    >
      <PostgresRelationshipEndpointRestrictionColumn
        title={t("sharedModals.graphics.objects")}
        items={props.objectItems}
        value={props.objectValue}
        onChange={props.onObjectChange}
        projectStoragePath={props.projectStoragePath}
      />
      <PostgresRelationshipEndpointRestrictionColumn
        title={t("sharedModals.graphics.sources")}
        items={props.sourceItems}
        value={props.sourceValue}
        onChange={props.onSourceChange}
        projectStoragePath={props.projectStoragePath}
      />
    </div>
  );
}

export function PostgresRelationshipTypeModal(props: {
  title: string;
  subtitle?: string;
  ariaLabel: string;
  tab: PostgresRelationshipTypeModalTab;
  setTab: Dispatch<SetStateAction<PostgresRelationshipTypeModalTab>>;
  submitLabel: string;
  projectStoragePath: string;
  submitting: boolean;
  name: string;
  lineShape: PostgresRelationshipLineShape;
  lineWeight: number;
  arrowhead: PostgresRelationshipArrowhead;
  color: string;
  fromObjectTypeIds: string[];
  toObjectTypeIds: string[];
  fromSourceKinds: string[];
  toSourceKinds: string[];
  objectRestrictionItems: PostgresRelationshipEndpointRestrictionItem[];
  sourceRestrictionItems: PostgresRelationshipEndpointRestrictionItem[];
  attributeDrafts: TypeAttributeDraft[];
  attributeRows: Array<{ id: string; name: string }>;
  attributeValues: EditableAttributeMatrixValues;
  emptyRowsLabel: string;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  setName: Dispatch<SetStateAction<string>>;
  setLineShape: Dispatch<SetStateAction<PostgresRelationshipLineShape>>;
  setLineWeight: Dispatch<SetStateAction<number>>;
  setArrowhead: Dispatch<SetStateAction<PostgresRelationshipArrowhead>>;
  setColor: Dispatch<SetStateAction<string>>;
  setFromObjectTypeIds: Dispatch<SetStateAction<string[]>>;
  setToObjectTypeIds: Dispatch<SetStateAction<string[]>>;
  setFromSourceKinds: Dispatch<SetStateAction<string[]>>;
  setToSourceKinds: Dispatch<SetStateAction<string[]>>;
  onTimelineFieldChange: (role: TimelineFieldRole, value: string) => void;
  onAddAttribute: () => void;
  onEditAttribute: (localId: string) => void;
  onDeleteAttribute: (localId: string) => void;
  onChangeValue: (attributeLocalId: string, rowId: string, value: string) => void;
}) {
  const { t } = useI18n();
  const disabled = props.submitting;
  const lineWeight = normalizePostgresRelationshipLineWeight(props.lineWeight);

  return (
    <SettingsModal
      title={props.title}
      subtitle={props.subtitle}
      onClose={props.onClose}
      closeDisabled={props.submitting}
      modalClassName="modal--wide"
      overlayStyle={{ zIndex: 120 }}
    >
      <form onSubmit={props.onSubmit} className={`form app-settings-modal-body ${props.tab === "graphics" ? "modal-body--graphics modal-form--graphics" : ""}`}>
        <ModalTabSelector
          value={props.tab}
          options={(["details", "graphics", "object1", "object2", "attributes", "timeline"] as const).map((tab) => ({
            value: tab,
            label: formatRelationshipTypeModalTab(tab, t),
          }))}
          ariaLabel={props.ariaLabel}
          onChange={props.setTab}
        />
        {props.tab === "details" ? (
          <label className="form-label">
            {t("sharedModals.relationshipModal.relationshipTypeName")}
            <input
              className="form-input"
              value={props.name}
              onChange={(event) => props.setName(event.target.value)}
              autoFocus
            />
          </label>
        ) : props.tab === "graphics" ? (
          <div className="graphics-editor-layout">
            <div className="graphics-editor-controls">
              <PostgresColorControl
                label={t("common.color")}
                swatchValue={props.color}
                textValue={props.color}
                onChange={props.setColor}
                textWidth="fluid"
                alignItems="center"
              />
              <label className="form-label">
                {t("sharedModals.graphics.lineShape")}
                <PostgresRelationshipLineShapePicker
                  value={props.lineShape}
                  onChange={(value) => props.setLineShape((value || "solid") as PostgresRelationshipLineShape)}
                  previewColor={props.color}
                />
              </label>
              <label className="form-label">
                {t("sharedModals.graphics.arrowheads")}
                <PostgresRelationshipArrowheadPicker
                  value={props.arrowhead}
                  onChange={(value) => props.setArrowhead((value || "one_sided") as PostgresRelationshipArrowhead)}
                  previewColor={props.color}
                />
              </label>
              <PostgresRangeControl
                label={t("sharedModals.graphics.lineWeight")}
                value={lineWeight}
                min={POSTGRES_RELATIONSHIP_LINE_WEIGHT_MIN}
                max={POSTGRES_RELATIONSHIP_LINE_WEIGHT_MAX}
                suffix="px"
                onChange={props.setLineWeight}
              />
            </div>
            <PostgresRelationshipGraphicPreviewCard
              label={t("sharedModals.graphics.relationshipTypePreview")}
              lineShape={props.lineShape}
              lineWeight={lineWeight}
              arrowhead={props.arrowhead}
              color={props.color}
            />
          </div>
        ) : props.tab === "object1" ? (
          <PostgresRelationshipTypeEndpointRestrictions
            objectItems={props.objectRestrictionItems}
            sourceItems={props.sourceRestrictionItems}
            objectValue={props.fromObjectTypeIds}
            sourceValue={props.fromSourceKinds}
            onObjectChange={props.setFromObjectTypeIds}
            onSourceChange={props.setFromSourceKinds}
            projectStoragePath={props.projectStoragePath}
          />
        ) : props.tab === "object2" ? (
          <PostgresRelationshipTypeEndpointRestrictions
            objectItems={props.objectRestrictionItems}
            sourceItems={props.sourceRestrictionItems}
            objectValue={props.toObjectTypeIds}
            sourceValue={props.toSourceKinds}
            onObjectChange={props.setToObjectTypeIds}
            onSourceChange={props.setToSourceKinds}
            projectStoragePath={props.projectStoragePath}
          />
        ) : props.tab === "timeline" ? (
          <PostgresRelationshipTypeTimelineFields
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
            }))}
            rows={props.attributeRows}
            values={props.attributeValues}
            disabled={disabled}
            emptyDefinitionsLabel={t("sharedModals.relationshipModal.noTypeAttributes")}
            emptyRowsLabel={props.emptyRowsLabel}
            onAddAttribute={props.onAddAttribute}
            onEditAttribute={props.onEditAttribute}
            onDeleteAttribute={props.onDeleteAttribute}
            onChangeValue={props.onChangeValue}
          />
        )}
        <div className="app-settings-modal-footer">
          <button type="button" className="btn" onClick={props.onClose} disabled={disabled}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn btn--primary" disabled={disabled}>
            {props.submitting ? t("common.saving") : props.submitLabel}
          </button>
        </div>
      </form>
    </SettingsModal>
  );
}
