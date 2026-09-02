import { useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import type { PostgresRelationshipAttributeDefinition, PostgresRelationshipType } from "../lib/postgres";
import {
  isVisibleItemTimelineAttribute,
  itemTimelineAttributeDefaultValue,
  itemTimelineAttributeLabel,
} from "../lib/timelineAttributeUi";
import { ArrowLeftRightIcon } from "./AppIcons";
import { SettingsModal } from "./SettingsModal";

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
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "long_dashed", label: "Long dash" },
  { value: "short_dashed", label: "Short dash" },
  { value: "dotted", label: "Dotted" },
  { value: "loose_dotted", label: "Loose dots" },
  { value: "dash_dot", label: "Dash-dot" },
  { value: "dash_dot_dot", label: "Dash-dot-dot" },
] as const;
const ARROWHEAD_OPTIONS = [
  { value: "one_sided", label: "One-sided" },
  { value: "double_sided", label: "Double-sided" },
  { value: "none", label: "No arrows" },
] as const;

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
  const strokeWidth = relationshipStrokeWidth(props.lineWeight);
  const lineStartX = props.arrowhead === "double_sided" ? 24 : 16;
  const lineEndX = props.arrowhead === "none" ? 184 : 176;
  return (
    <div className="source-graphics-preview-card" aria-label="Relationship graphic preview">
      <span className="form-label">Preview</span>
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
                  Name<span className="users-sort-icon">{sortIcon("name")}</span>
                </button>
              </th>
              <th className="users-th" style={{ width: "38%" }} aria-sort={sortKey === "type" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>
                <button type="button" className="users-th-sort" onClick={() => handleSort("type")}>
                  Type<span className="users-sort-icon">{sortIcon("type")}</span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedOptions.length === 0 ? (
              <tr><td className="users-td-msg" colSpan={2}>No matching endpoints.</td></tr>
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
          {inherited ? "Inherited" : "Custom"}
        </span>
        {inherited ? <span className="auth-hint" style={{ margin: 0 }}>From relationship type</span> : null}
      </div>
      {!inherited ? <button type="button" className="btn btn--ghost" onClick={onReset}>Reset to inherited</button> : null}
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
      setValidationWarning("The selected endpoints do not work with this relationship type. Choose valid From and To endpoints before saving.");
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
                {nextTab.slice(0, 1).toUpperCase() + nextTab.slice(1)}
              </button>
            ))}
          </div>
          {tab === "details" ? (
            <>
              <label className="form-label">
                Relationship type
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
                  <option value="">Select relationship type</option>
                  {relationshipTypes.map((relationshipType) => (
                    <option key={relationshipType.id} value={relationshipType.id}>{relationshipType.name}</option>
                  ))}
                  <option value="__new_relationship_type__">Add new relationship type...</option>
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
                <RelationshipEndpointSingleSelect label="From" options={availableFromEndpoints} value={fromEndpointKey} onChange={(value) => {
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
                    aria-label="Switch from and to endpoints"
                    title="Switch from and to endpoints"
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
                <RelationshipEndpointSingleSelect label="To" options={availableToEndpoints} value={toEndpointKey} onChange={(value) => {
                  setValidationWarning("");
                  setToEndpointKey(value);
                }} />
              </div>
              <label className="form-label">
                Description
                <textarea className="form-input form-textarea" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
              </label>
            </>
          ) : tab === "graphics" ? (
            <>
              <div className="source-graphics-layout">
                <div className="source-graphics-controls">
              <div style={{ display: "flex", justifyContent: "center" }}>
                <div className="segmented-control modal-segmented-control modal-secondary-segmented-control modal-secondary-segmented-control--two" role="tablist" aria-label="Relationship graphic source">
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
                      {mode.slice(0, 1).toUpperCase() + mode.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              {graphicMode === "inherit" ? (
                <p className="auth-hint" style={{ margin: "4px 0 0", textAlign: "center" }}>
                  This relationship will inherit its graphical elements from its relationship type.
                </p>
              ) : (
                <>
                  <label className="form-label">
                    <OverrideHeader label="Color" inherited={!colorOverride.trim()} onReset={() => setColorOverride("")} />
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <input className="form-input form-input--color" type="color" value={effectiveColor} onChange={(event) => setColorOverride(event.target.value)} />
                      <input className="form-input" value={!colorOverride.trim() ? inheritedColor : colorOverride} onChange={(event) => setColorOverride(event.target.value)} style={{ flex: "0 0 148px", fontFamily: "monospace" }} />
                    </div>
                  </label>
                  <label className="form-label">
                    <OverrideHeader label="Line shape" inherited={!lineShapeOverride.trim()} onReset={() => setLineShapeOverride("")} />
                    <div className="shape-picker-grid shape-picker-grid--compact-shapes" role="radiogroup" aria-label="Line shape selection">
                      {LINE_SHAPE_OPTIONS.map((option) => (
                        <button key={option.value} type="button" className={`shape-picker-option${effectiveLineShape === option.value ? " shape-picker-option--selected" : ""}`} onClick={() => setLineShapeOverride(option.value === inheritedLineShape ? "" : option.value)}>
                          <div className="shape-picker-preview shape-picker-preview--line" aria-hidden="true">
                            <svg width="46" height="18" viewBox="0 0 46 18"><line x1="4" y1="9" x2="42" y2="9" stroke={RELATIONSHIP_PICKER_PREVIEW_COLOR} strokeWidth="3" strokeDasharray={strokeDasharray(option.value)} /></svg>
                          </div>
                          <span className="shape-picker-label">{option.label}</span>
                        </button>
                      ))}
                    </div>
                  </label>
                  <label className="form-label">
                    <OverrideHeader label="Arrowheads" inherited={!arrowheadOverride.trim()} onReset={() => setArrowheadOverride("")} />
                    <div className="shape-picker-grid shape-picker-grid--compact-shapes" role="radiogroup" aria-label="Arrowhead selection">
                      {ARROWHEAD_OPTIONS.map((option) => (
                        <button key={option.value} type="button" className={`shape-picker-option${effectiveArrowhead === option.value ? " shape-picker-option--selected" : ""}`} onClick={() => setArrowheadOverride(option.value === inheritedArrowhead ? "" : option.value)}>
                          <div className="shape-picker-preview shape-picker-preview--line" aria-hidden="true">
                            <svg width="46" height="18" viewBox="0 0 46 18"><line x1="4" y1="9" x2="42" y2="9" stroke={RELATIONSHIP_PICKER_PREVIEW_COLOR} strokeWidth="2" markerEnd={option.value !== "none" ? "url(#arrow-shared)" : undefined} markerStart={option.value === "double_sided" ? "url(#arrow-shared)" : undefined} /><defs><marker id="arrow-shared" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={RELATIONSHIP_PICKER_PREVIEW_COLOR} /></marker></defs></svg>
                          </div>
                          <span className="shape-picker-label">{option.label}</span>
                        </button>
                      ))}
                    </div>
                  </label>
                  <label className="form-label timeline-group-opacity-control">
                    <OverrideHeader label="Line weight" inherited={lineWeightOverride == null} onReset={() => setLineWeightOverride(null)} />
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
              <p className="auth-hint" style={{ marginTop: 0 }}>No timeline fields have been configured for this relationship type yet.</p>
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
            <p className="auth-hint" style={{ marginTop: 0 }}>No shared attributes for this relationship type yet.</p>
          )}
          {validationWarning ? <p className="auth-error">{validationWarning}</p> : error ? <p className="auth-error">{error}</p> : null}
        </div>
        <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button type="submit" className="btn btn--primary" disabled={submitting || submitDisabled}>
              {submitting ? "Saving..." : submitLabel}
            </button>
        </div>
      </form>
    </SettingsModal>
  );
}
