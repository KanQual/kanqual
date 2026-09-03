import { useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import type { PostgresRelationshipAttributeDefinition, PostgresRelationshipType } from "../lib/postgres";
import {
  isVisibleItemTimelineAttribute,
  itemTimelineAttributeDefaultValue,
  itemTimelineAttributeLabel,
} from "../lib/timelineAttributeUi";
import { ArrowLeftRightIcon } from "./AppIcons";
import { SettingsModal } from "./SettingsModal";
import { useI18n } from "../i18n/provider";

export type PostgresRelationshipEndpointOption = {
  key: string;
  entityType: "object" | "source";
  entityId: string;
  name: string;
  type: string;
};

export type PostgresRelationshipModalTab = "details" | "graphics" | "attributes" | "timeline";
type RelationshipGraphicMode = "inherit" | "select";

const DEFAULT_RELATIONSHIP_COLOR = "#355070";
const RELATIONSHIP_PICKER_PREVIEW_COLOR = "#64748b";
const RELATIONSHIP_LINE_WEIGHT_MIN = 1;
const RELATIONSHIP_LINE_WEIGHT_MAX = 16;
const LINE_SHAPE_OPTIONS = [
  { value: "solid" },
  { value: "dashed" },
  { value: "long_dashed" },
  { value: "short_dashed" },
  { value: "dotted" },
  { value: "loose_dotted" },
  { value: "dash_dot" },
  { value: "dash_dot_dot" },
] as const;
const ARROWHEAD_OPTIONS = [
  { value: "one_sided" },
  { value: "double_sided" },
  { value: "none" },
] as const;

function formatRelationshipModalTab(tab: PostgresRelationshipModalTab, t: ReturnType<typeof useI18n>["t"]): string {
  if (tab === "details") return t("sharedModals.tabs.details");
  if (tab === "graphics") return t("sharedModals.tabs.graphics");
  if (tab === "attributes") return t("sharedModals.tabs.attributes");
  return t("sharedModals.tabs.timeline");
}

function formatLineShapeOption(value: string, t: ReturnType<typeof useI18n>["t"]): string {
  if (value === "solid") return t("sharedModals.graphics.lineShapes.solid");
  if (value === "dashed") return t("sharedModals.graphics.lineShapes.dashed");
  if (value === "long_dashed") return t("sharedModals.graphics.lineShapes.longDashed");
  if (value === "short_dashed") return t("sharedModals.graphics.lineShapes.shortDashed");
  if (value === "dotted") return t("sharedModals.graphics.lineShapes.dotted");
  if (value === "loose_dotted") return t("sharedModals.graphics.lineShapes.looseDotted");
  if (value === "dash_dot") return t("sharedModals.graphics.lineShapes.dashDot");
  return t("sharedModals.graphics.lineShapes.dashDotDot");
}

function formatArrowheadOption(value: string, t: ReturnType<typeof useI18n>["t"]): string {
  if (value === "one_sided") return t("sharedModals.graphics.arrowheadOptions.oneSided");
  if (value === "double_sided") return t("sharedModals.graphics.arrowheadOptions.doubleSided");
  return t("sharedModals.graphics.arrowheadOptions.none");
}

function normalizeColor(value: string): string {
  const trimmed = value.trim();
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : DEFAULT_RELATIONSHIP_COLOR;
}

function strokeDasharray(shape: string): string | undefined {
  if (shape === "dashed") return "8 6";
  if (shape === "long_dashed") return "14 7";
  if (shape === "short_dashed") return "5 5";
  if (shape === "dotted") return "2 6";
  if (shape === "loose_dotted") return "2 10";
  if (shape === "dash_dot") return "10 5 2 5";
  if (shape === "dash_dot_dot") return "10 5 2 5 2 5";
  return undefined;
}

function relationshipStrokeWidth(lineWeight: number): number {
  if (!Number.isFinite(lineWeight)) return 2;
  return Math.max(RELATIONSHIP_LINE_WEIGHT_MIN, Math.min(RELATIONSHIP_LINE_WEIGHT_MAX, Math.round(lineWeight)));
}

function RelationshipGraphicPreviewCard(props: {
  lineShape: string;
  lineWeight: number;
  arrowhead: string;
  color: string;
}) {
  const { t } = useI18n();
  const strokeWidth = relationshipStrokeWidth(props.lineWeight);
  const lineStartX = props.arrowhead === "double_sided" ? 24 : 16;
  const lineEndX = props.arrowhead === "none" ? 184 : 176;
  return (
    <div className="source-graphics-preview-card" aria-label={t("sharedModals.graphics.relationshipPreview")}>
      <span className="form-label">{t("common.preview")}</span>
      <div className="source-graphics-preview-stage">
        <svg aria-hidden="true" viewBox="0 0 200 80" width="200" height="80" className="relationship-graphics-preview-svg">
          <line
            x1={lineStartX}
            y1="40"
            x2={lineEndX}
            y2="40"
            stroke={props.color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={strokeDasharray(props.lineShape)}
          />
          {props.arrowhead === "double_sided" ? <path d="M14 40 L28 32 L28 48 Z" fill={props.color} /> : null}
          {props.arrowhead !== "none" ? <path d="M186 40 L172 32 L172 48 Z" fill={props.color} /> : null}
        </svg>
      </div>
    </div>
  );
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
      <div className="users-table-wrap" style={{ maxHeight: 188, overflowY: "auto", marginTop: 6 }}>
        <table className="users-table">
          <thead>
            <tr>
              <th className="users-th" style={{ width: "62%" }} aria-sort={sortKey === "name" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>
                <button type="button" className="users-th-sort" onClick={() => handleSort("name")}>
                  {t("common.name")}<span className="users-sort-icon">{sortIcon("name")}</span>
                </button>
              </th>
              <th className="users-th" style={{ width: "38%" }} aria-sort={sortKey === "type" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>
                <button type="button" className="users-th-sort" onClick={() => handleSort("type")}>
                  {t("sharedModals.relationshipModal.type")}<span className="users-sort-icon">{sortIcon("type")}</span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedOptions.length === 0 ? (
              <tr><td className="users-td-msg" colSpan={2}>{t("sharedModals.relationshipModal.noMatchingEndpoints")}</td></tr>
            ) : sortedOptions.map((option) => (
              <tr
                key={option.key}
                ref={value === option.key ? selectedRowRef : undefined}
                className="users-row"
                style={{ background: value === option.key ? "rgba(53, 80, 112, 0.10)" : undefined, cursor: "pointer" }}
                onClick={() => onChange(option.key)}
              >
                <td className="users-td users-td--name">{option.name}</td>
                <td className="users-td users-td--muted">{option.type}</td>
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
  const inheritedColor = normalizeColor(selectedType?.color || "");
  const effectiveColor = colorOverride.trim() ? normalizeColor(colorOverride) : inheritedColor;
  const inheritedLineShape = selectedType?.lineShape || "solid";
  const effectiveLineShape = lineShapeOverride.trim() || inheritedLineShape;
  const inheritedLineWeight = selectedType?.lineWeight || 2;
  const effectiveLineWeight = lineWeightOverride ?? inheritedLineWeight;
  const inheritedArrowhead = selectedType?.arrowhead || "one_sided";
  const effectiveArrowhead = arrowheadOverride.trim() || inheritedArrowhead;
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
      <form onSubmit={handleSubmit} className={`form ${tab === "graphics" ? "source-editor-form--graphics" : ""}`}>
        <div className={`app-settings-modal-body ${tab === "graphics" ? "source-editor-modal-body--graphics" : ""}`}>
          <div className="segmented-control modal-segmented-control" role="tablist" aria-label={ariaLabel}>
            {(["details", "graphics", "attributes", "timeline"] as const).map((nextTab) => (
              <button
                key={nextTab}
                type="button"
                className={`segmented-control-option ${tab === nextTab ? "segmented-control-option--active" : ""}`}
                onClick={() => setTab(nextTab)}
              >
                {formatRelationshipModalTab(nextTab, t)}
              </button>
            ))}
          </div>
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
              <div className="source-graphics-layout">
                <div className="source-graphics-controls">
              <div style={{ display: "flex", justifyContent: "center" }}>
                <div className="segmented-control modal-segmented-control modal-secondary-segmented-control modal-secondary-segmented-control--two" role="tablist" aria-label={t("sharedModals.graphics.relationshipGraphicSource")}>
                  {(["inherit", "select"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      role="tab"
                      aria-selected={graphicMode === mode}
                      className={`segmented-control-option ${graphicMode === mode ? "segmented-control-option--active" : ""}`}
                      onClick={() => handleGraphicModeChange(mode)}
                      disabled={submitting}
                    >
                      {mode === "inherit" ? t("common.inherit") : t("common.select")}
                    </button>
                  ))}
                </div>
              </div>
              {graphicMode === "inherit" ? (
                <p className="auth-hint" style={{ margin: "4px 0 0", textAlign: "center" }}>
                  {t("sharedModals.graphics.inheritRelationshipHelp")}
                </p>
              ) : (
                <>
                  <label className="form-label">
                    <OverrideHeader label={t("common.color")} inherited={!colorOverride.trim()} onReset={() => setColorOverride("")} />
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <input className="form-input form-input--color" type="color" value={effectiveColor} onChange={(event) => setColorOverride(event.target.value)} />
                      <input className="form-input" value={!colorOverride.trim() ? inheritedColor : colorOverride} onChange={(event) => setColorOverride(event.target.value)} style={{ flex: "0 0 148px", fontFamily: "monospace" }} />
                    </div>
                  </label>
                  <label className="form-label">
                    <OverrideHeader label={t("sharedModals.graphics.lineShape")} inherited={!lineShapeOverride.trim()} onReset={() => setLineShapeOverride("")} />
                    <div className="shape-picker-grid shape-picker-grid--compact-shapes" role="radiogroup" aria-label={t("sharedModals.graphics.lineShapeSelection")}>
                      {LINE_SHAPE_OPTIONS.map((option) => (
                        <button key={option.value} type="button" className={`shape-picker-option${effectiveLineShape === option.value ? " shape-picker-option--selected" : ""}`} onClick={() => setLineShapeOverride(option.value === inheritedLineShape ? "" : option.value)}>
                          <div className="shape-picker-preview shape-picker-preview--line" aria-hidden="true">
                            <svg width="46" height="18" viewBox="0 0 46 18"><line x1="4" y1="9" x2="42" y2="9" stroke={RELATIONSHIP_PICKER_PREVIEW_COLOR} strokeWidth="3" strokeDasharray={strokeDasharray(option.value)} /></svg>
                          </div>
                          <span className="shape-picker-label">{formatLineShapeOption(option.value, t)}</span>
                        </button>
                      ))}
                    </div>
                  </label>
                  <label className="form-label">
                    <OverrideHeader label={t("sharedModals.graphics.arrowheads")} inherited={!arrowheadOverride.trim()} onReset={() => setArrowheadOverride("")} />
                    <div className="shape-picker-grid shape-picker-grid--compact-shapes" role="radiogroup" aria-label={t("sharedModals.graphics.arrowheadSelection")}>
                      {ARROWHEAD_OPTIONS.map((option) => (
                        <button key={option.value} type="button" className={`shape-picker-option${effectiveArrowhead === option.value ? " shape-picker-option--selected" : ""}`} onClick={() => setArrowheadOverride(option.value === inheritedArrowhead ? "" : option.value)}>
                          <div className="shape-picker-preview shape-picker-preview--line" aria-hidden="true">
                            <svg width="46" height="18" viewBox="0 0 46 18"><line x1="4" y1="9" x2="42" y2="9" stroke={RELATIONSHIP_PICKER_PREVIEW_COLOR} strokeWidth="2" markerEnd={option.value !== "none" ? "url(#arrow-shared)" : undefined} markerStart={option.value === "double_sided" ? "url(#arrow-shared)" : undefined} /><defs><marker id="arrow-shared" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={RELATIONSHIP_PICKER_PREVIEW_COLOR} /></marker></defs></svg>
                          </div>
                          <span className="shape-picker-label">{formatArrowheadOption(option.value, t)}</span>
                        </button>
                      ))}
                    </div>
                  </label>
                  <label className="form-label timeline-group-opacity-control">
                    <OverrideHeader label={t("sharedModals.graphics.lineWeight")} inherited={lineWeightOverride == null} onReset={() => setLineWeightOverride(null)} />
                    <div className="timeline-group-slider-row">
                      <input
                        className="form-range"
                        type="range"
                        min={RELATIONSHIP_LINE_WEIGHT_MIN}
                        max={RELATIONSHIP_LINE_WEIGHT_MAX}
                        step="1"
                        value={effectiveLineWeight}
                        onChange={(event) => {
                          const nextWeight = relationshipStrokeWidth(Number(event.target.value));
                          setLineWeightOverride(nextWeight === inheritedLineWeight ? null : nextWeight);
                        }}
                      />
                      <span className="timeline-group-slider-value">{relationshipStrokeWidth(effectiveLineWeight)}px</span>
                    </div>
                  </label>
                </>
              )}
                </div>
                <RelationshipGraphicPreviewCard
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
