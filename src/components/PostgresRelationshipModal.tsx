import { useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import type { PostgresRelationshipAttributeDefinition, PostgresRelationshipType } from "../lib/postgres";
import {
  isVisibleItemTimelineAttribute,
  itemTimelineAttributeDefaultValue,
  itemTimelineAttributeLabel,
} from "../lib/timelineAttributeUi";
import { ArrowLeftRightIcon } from "./AppIcons";
import { ModalTabSelector } from "./ModalTabSelector";
import {
  PostgresColorControl,
  PostgresGraphicModeTabs,
  PostgresRangeControl,
  PostgresRelationshipArrowheadPicker,
  PostgresRelationshipGraphicPreviewCard,
  PostgresRelationshipLineShapePicker,
} from "./PostgresGraphicsControls";
import { SettingsModal } from "./SettingsModal";
import { useI18n } from "../i18n/provider";
import {
  POSTGRES_RELATIONSHIP_LINE_WEIGHT_MAX,
  POSTGRES_RELATIONSHIP_LINE_WEIGHT_MIN,
  normalizePostgresRelationshipArrowhead,
  normalizePostgresRelationshipColor,
  normalizePostgresRelationshipLineShape,
  normalizePostgresRelationshipLineWeight,
} from "../lib/postgresGraphics";

export type PostgresRelationshipEndpointOption = {
  key: string;
  entityType: "object" | "source";
  entityId: string;
  name: string;
  type: string;
};

export type PostgresRelationshipModalTab = "details" | "graphics" | "attributes" | "timeline";
type RelationshipGraphicMode = "inherit" | "select";

function formatRelationshipModalTab(tab: PostgresRelationshipModalTab, t: ReturnType<typeof useI18n>["t"]): string {
  if (tab === "details") return t("sharedModals.tabs.details");
  if (tab === "graphics") return t("sharedModals.tabs.graphics");
  if (tab === "attributes") return t("sharedModals.tabs.attributes");
  return t("sharedModals.tabs.timeline");
}

function RelationshipEndpointSingleSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: PostgresRelationshipEndpointOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const [sortKey, setSortKey] = useState<"name" | "type">("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const selectedRowRef = useRef<HTMLTableRowElement | null>(null);
  const sortedOptions = useMemo(() => {
    return [...options].sort((left, right) => {
      const primary = left[sortKey].localeCompare(right[sortKey], undefined, { sensitivity: "base", numeric: true });
      const fallback = left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true });
      const comparison = primary || fallback;
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [options, sortDirection, sortKey]);

  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: "center" });
  }, [sortedOptions, value]);

  function handleSort(nextSortKey: "name" | "type") {
    if (sortKey === nextSortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection("asc");
  }

  function sortIcon(column: "name" | "type") {
    if (sortKey !== column) return " ↕";
    return sortDirection === "asc" ? " ↑" : " ↓";
  }

  return (
    <label className="form-label">
      {label}
      <div className="data-table-wrap" style={{ maxHeight: 188, overflowY: "auto", marginTop: 6 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th className="data-table-header" style={{ width: "62%" }} aria-sort={sortKey === "name" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>
                <button type="button" className="data-table-sort-button" onClick={() => handleSort("name")}>
                  {t("common.name")}<span className="data-table-sort-icon">{sortIcon("name")}</span>
                </button>
              </th>
              <th className="data-table-header" style={{ width: "38%" }} aria-sort={sortKey === "type" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>
                <button type="button" className="data-table-sort-button" onClick={() => handleSort("type")}>
                  {t("sharedModals.relationshipModal.type")}<span className="data-table-sort-icon">{sortIcon("type")}</span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedOptions.length === 0 ? (
              <tr><td className="data-table-message" colSpan={2}>{t("sharedModals.relationshipModal.noMatchingEndpoints")}</td></tr>
            ) : sortedOptions.map((option) => (
              <tr
                key={option.key}
                ref={value === option.key ? selectedRowRef : undefined}
                className="data-table-row"
                style={{ background: value === option.key ? "rgba(53, 80, 112, 0.10)" : undefined, cursor: "pointer" }}
                onClick={() => onChange(option.key)}
              >
                <td className="data-table-cell data-table-cell--name">{option.name}</td>
                <td className="data-table-cell data-table-cell--muted">{option.type}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </label>
  );
}

function OverrideHeader({ label, inherited, onReset }: { label: string; inherited: boolean; onReset: () => void }) {
  const { t } = useI18n();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span>{label}</span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "3px 8px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: inherited ? "#52606d" : "#355070",
            background: inherited ? "rgba(82, 96, 109, 0.12)" : "rgba(53, 80, 112, 0.12)",
          }}
        >
          {inherited ? t("sharedModals.graphics.inherited") : t("sharedModals.graphics.custom")}
        </span>
        {inherited ? <span className="auth-hint" style={{ margin: 0 }}>{t("sharedModals.graphics.fromRelationshipType")}</span> : null}
      </div>
      {!inherited ? <button type="button" className="btn btn--ghost" onClick={onReset}>{t("sharedModals.graphics.resetToInherited")}</button> : null}
    </div>
  );
}

export function PostgresRelationshipModal({
  title,
  ariaLabel,
  tab,
  setTab,
  submitLabel,
  relationshipTypes,
  relationshipTypeId,
  setRelationshipTypeId,
  selectedType,
  fromEndpointKey,
  setFromEndpointKey,
  toEndpointKey,
  setToEndpointKey,
  availableFromEndpoints,
  availableToEndpoints,
  description,
  setDescription,
  lineShapeOverride,
  setLineShapeOverride,
  lineWeightOverride,
  setLineWeightOverride,
  arrowheadOverride,
  setArrowheadOverride,
  colorOverride,
  setColorOverride,
  attributeDefinitions,
  attributeValues,
  setAttributeValues,
  submitting,
  error,
  submitDisabled,
  onClose,
  onSubmit,
  onNewRelationshipType,
}: {
  title: string;
  ariaLabel: string;
  tab: PostgresRelationshipModalTab;
  setTab: Dispatch<SetStateAction<PostgresRelationshipModalTab>>;
  submitLabel: string;
  relationshipTypes: PostgresRelationshipType[];
  relationshipTypeId: string;
  setRelationshipTypeId: Dispatch<SetStateAction<string>>;
  selectedType: PostgresRelationshipType | null;
  fromEndpointKey: string;
  setFromEndpointKey: Dispatch<SetStateAction<string>>;
  toEndpointKey: string;
  setToEndpointKey: Dispatch<SetStateAction<string>>;
  availableFromEndpoints: PostgresRelationshipEndpointOption[];
  availableToEndpoints: PostgresRelationshipEndpointOption[];
  description: string;
  setDescription: Dispatch<SetStateAction<string>>;
  lineShapeOverride: string;
  setLineShapeOverride: Dispatch<SetStateAction<string>>;
  lineWeightOverride: number | null;
  setLineWeightOverride: Dispatch<SetStateAction<number | null>>;
  arrowheadOverride: string;
  setArrowheadOverride: Dispatch<SetStateAction<string>>;
  colorOverride: string;
  setColorOverride: Dispatch<SetStateAction<string>>;
  attributeDefinitions: PostgresRelationshipAttributeDefinition[];
  attributeValues: Record<string, string>;
  setAttributeValues: Dispatch<SetStateAction<Record<string, string>>>;
  submitting: boolean;
  error?: string | null;
  submitDisabled?: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onNewRelationshipType?: () => void;
}) {
  const { t } = useI18n();
  const inheritedColor = normalizePostgresRelationshipColor(selectedType?.color || "");
  const effectiveColor = colorOverride.trim() ? normalizePostgresRelationshipColor(colorOverride) : inheritedColor;
  const inheritedLineShape = normalizePostgresRelationshipLineShape(selectedType?.lineShape || "");
  const effectiveLineShape = normalizePostgresRelationshipLineShape(lineShapeOverride || inheritedLineShape);
  const inheritedLineWeight = normalizePostgresRelationshipLineWeight(selectedType?.lineWeight);
  const effectiveLineWeight = normalizePostgresRelationshipLineWeight(lineWeightOverride ?? inheritedLineWeight);
  const inheritedArrowhead = normalizePostgresRelationshipArrowhead(selectedType?.arrowhead || "");
  const effectiveArrowhead = normalizePostgresRelationshipArrowhead(arrowheadOverride || inheritedArrowhead);
  const [validationWarning, setValidationWarning] = useState("");
  const [graphicMode, setGraphicMode] = useState<RelationshipGraphicMode>(
    colorOverride.trim() || lineShapeOverride.trim() || lineWeightOverride != null || arrowheadOverride.trim()
      ? "select"
      : "inherit",
  );
  const timelineAttributeDefinitions = attributeDefinitions.filter(isVisibleItemTimelineAttribute);
  const timelineLabelDefault = selectedType?.name ?? "";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const fromIsValid = availableFromEndpoints.some((option) => option.key === fromEndpointKey);
    const toIsValid = availableToEndpoints.some((option) => option.key === toEndpointKey);
    if (!relationshipTypeId || !fromIsValid || !toIsValid) {
      event.preventDefault();
      setValidationWarning(t("sharedModals.relationshipModal.invalidEndpoints"));
      setTab("details");
      return;
    }
    setValidationWarning("");
    void onSubmit(event);
  }

  function handleSwapEndpoints() {
    setValidationWarning("");
    const nextFromEndpointKey = toEndpointKey;
    const nextToEndpointKey = fromEndpointKey;
    setFromEndpointKey(nextFromEndpointKey);
    setToEndpointKey(nextToEndpointKey);
  }

  function handleGraphicModeChange(nextMode: RelationshipGraphicMode) {
    setGraphicMode(nextMode);
    if (nextMode === "inherit") {
      setColorOverride("");
      setLineShapeOverride("");
      setLineWeightOverride(null);
      setArrowheadOverride("");
    }
  }

  return (
    <SettingsModal title={title} onClose={onClose} closeDisabled={submitting} modalClassName="modal--wide">
      <form onSubmit={handleSubmit} className={`form ${tab === "graphics" ? "modal-form--graphics" : ""}`}>
        <div className={`app-settings-modal-body ${tab === "graphics" ? "modal-body--graphics" : ""}`}>
          <ModalTabSelector
            value={tab}
            options={(["details", "graphics", "attributes", "timeline"] as const).map((nextTab) => ({
              value: nextTab,
              label: formatRelationshipModalTab(nextTab, t),
            }))}
            ariaLabel={ariaLabel}
            onChange={setTab}
          />
          {tab === "details" ? (
            <>
              <label className="form-label">
                {t("sharedModals.relationshipModal.relationshipType")}
                <select
                  className="form-input"
                  value={relationshipTypeId}
                  onChange={(event) => {
                    setValidationWarning("");
                    if (event.target.value === "__new_relationship_type__") {
                      onNewRelationshipType?.();
                      return;
                    }
                    setRelationshipTypeId(event.target.value);
                  }}
                  autoFocus
                >
                  <option value="">{t("sharedModals.relationshipModal.selectRelationshipType")}</option>
                  {relationshipTypes.map((relationshipType) => (
                    <option key={relationshipType.id} value={relationshipType.id}>{relationshipType.name}</option>
                  ))}
                  <option value="__new_relationship_type__">{t("sharedModals.relationshipModal.addRelationshipType")}</option>
                </select>
              </label>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
                  gap: 12,
                  alignItems: "start",
                }}
              >
                <RelationshipEndpointSingleSelect label={t("sharedModals.relationshipModal.from")} options={availableFromEndpoints} value={fromEndpointKey} onChange={(value) => {
                  setValidationWarning("");
                  setFromEndpointKey(value);
                }} />
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: 188,
                    marginTop: 28,
                  }}
                >
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={handleSwapEndpoints}
                    disabled={submitting || !fromEndpointKey || !toEndpointKey}
                    aria-label={t("sharedModals.relationshipModal.switchEndpoints")}
                    title={t("sharedModals.relationshipModal.switchEndpoints")}
                    style={{
                      width: 24,
                      height: 24,
                      padding: 0,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <ArrowLeftRightIcon />
                  </button>
                </div>
                <RelationshipEndpointSingleSelect label={t("sharedModals.relationshipModal.to")} options={availableToEndpoints} value={toEndpointKey} onChange={(value) => {
                  setValidationWarning("");
                  setToEndpointKey(value);
                }} />
              </div>
              <label className="form-label">
                {t("common.description")}
                <textarea className="form-input form-textarea" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
              </label>
            </>
          ) : tab === "graphics" ? (
            <>
              <div className="graphics-editor-layout">
                <div className="graphics-editor-controls">
              <PostgresGraphicModeTabs
                value={graphicMode}
                options={[
                  { value: "inherit", label: t("common.inherit") },
                  { value: "select", label: t("common.select") },
                ]}
                ariaLabel={t("sharedModals.graphics.relationshipGraphicSource")}
                onChange={handleGraphicModeChange}
                disabled={submitting}
              />
              {graphicMode === "inherit" ? (
                <p className="auth-hint" style={{ margin: "4px 0 0", textAlign: "center" }}>
                  {t("sharedModals.graphics.inheritRelationshipHelp")}
                </p>
              ) : (
                <>
                  <PostgresColorControl
                    label={<OverrideHeader label={t("common.color")} inherited={!colorOverride.trim()} onReset={() => setColorOverride("")} />}
                    swatchValue={effectiveColor}
                    textValue={!colorOverride.trim() ? inheritedColor : colorOverride}
                    onChange={setColorOverride}
                    textWidth={148}
                    alignItems="center"
                  />
                  <label className="form-label">
                    <OverrideHeader label={t("sharedModals.graphics.lineShape")} inherited={!lineShapeOverride.trim()} onReset={() => setLineShapeOverride("")} />
                    <PostgresRelationshipLineShapePicker
                      value={effectiveLineShape}
                      onChange={(value) => {
                        const nextValue = normalizePostgresRelationshipLineShape(value);
                        setLineShapeOverride(nextValue === inheritedLineShape ? "" : nextValue);
                      }}
                      previewColor={effectiveColor}
                    />
                  </label>
                  <label className="form-label">
                    <OverrideHeader label={t("sharedModals.graphics.arrowheads")} inherited={!arrowheadOverride.trim()} onReset={() => setArrowheadOverride("")} />
                    <PostgresRelationshipArrowheadPicker
                      value={effectiveArrowhead}
                      onChange={(value) => {
                        const nextValue = normalizePostgresRelationshipArrowhead(value);
                        setArrowheadOverride(nextValue === inheritedArrowhead ? "" : nextValue);
                      }}
                      previewColor={effectiveColor}
                    />
                  </label>
                  <PostgresRangeControl
                    label={<OverrideHeader label={t("sharedModals.graphics.lineWeight")} inherited={lineWeightOverride == null} onReset={() => setLineWeightOverride(null)} />}
                    value={effectiveLineWeight}
                    min={POSTGRES_RELATIONSHIP_LINE_WEIGHT_MIN}
                    max={POSTGRES_RELATIONSHIP_LINE_WEIGHT_MAX}
                    suffix="px"
                    onChange={(value) => {
                      const nextWeight = normalizePostgresRelationshipLineWeight(value);
                      setLineWeightOverride(nextWeight === inheritedLineWeight ? null : nextWeight);
                    }}
                  />
                </>
              )}
                </div>
                <PostgresRelationshipGraphicPreviewCard
                  label={t("sharedModals.graphics.relationshipPreview")}
                  lineShape={effectiveLineShape}
                  lineWeight={effectiveLineWeight}
                  arrowhead={effectiveArrowhead}
                  color={effectiveColor}
                />
              </div>
            </>
          ) : tab === "timeline" ? (
            timelineAttributeDefinitions.length > 0 ? (
              <div className="case-detail-attributes-table-wrap">
                <table className="case-detail-attributes-table">
                  <tbody>
                    {timelineAttributeDefinitions.map((definition) => {
                      const defaultValue = itemTimelineAttributeDefaultValue(definition, timelineLabelDefault);
                      return (
                      <tr key={definition.id}>
                        <th className="case-detail-attributes-label" scope="row">{itemTimelineAttributeLabel(definition)}</th>
                        <td className="case-detail-attributes-value">
                          {definition.dataType === "categorical" ? (
                            <select className="form-input" value={attributeValues[definition.id] ?? ""} onChange={(event) => setAttributeValues((current) => ({ ...current, [definition.id]: event.target.value }))}>
                              <option value="">{defaultValue || "-"}</option>
                              {definition.options.map((option) => <option key={option} value={option}>{option}</option>)}
                            </select>
                          ) : (
                            <input className="form-input" type={definition.dataType === "number" ? "number" : definition.dataType === "datetime" ? "datetime-local" : "text"} step={definition.dataType === "number" ? "any" : undefined} placeholder={defaultValue} value={attributeValues[definition.id] ?? ""} onChange={(event) => setAttributeValues((current) => ({ ...current, [definition.id]: event.target.value }))} />
                          )}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="auth-hint" style={{ marginTop: 0 }}>{t("sharedModals.relationshipModal.noTimelineFields")}</p>
            )
          ) : attributeDefinitions.length > 0 ? (
            <div className="case-detail-attributes-table-wrap">
              <table className="case-detail-attributes-table">
                <tbody>
                  {attributeDefinitions.map((definition) => (
                    <tr key={definition.id}>
                      <th className="case-detail-attributes-label" scope="row">{definition.name}</th>
                      <td className="case-detail-attributes-value">
                        {definition.dataType === "categorical" ? (
                          <select className="form-input" value={attributeValues[definition.id] ?? ""} onChange={(event) => setAttributeValues((current) => ({ ...current, [definition.id]: event.target.value }))}>
                            <option value="">-</option>
                            {definition.options.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        ) : (
                          <input className="form-input" type={definition.dataType === "number" ? "number" : definition.dataType === "datetime" ? "datetime-local" : "text"} step={definition.dataType === "number" ? "any" : undefined} value={attributeValues[definition.id] ?? ""} onChange={(event) => setAttributeValues((current) => ({ ...current, [definition.id]: event.target.value }))} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="auth-hint" style={{ marginTop: 0 }}>{t("sharedModals.relationshipModal.noSharedAttributes")}</p>
          )}
          {validationWarning ? <p className="auth-error">{validationWarning}</p> : error ? <p className="auth-error">{error}</p> : null}
        </div>
        <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button type="submit" className="btn btn--primary" disabled={submitting || submitDisabled}>
              {submitting ? t("common.saving") : submitLabel}
            </button>
        </div>
      </form>
    </SettingsModal>
  );
}
