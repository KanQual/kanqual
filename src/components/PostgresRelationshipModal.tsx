import { useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import type { PostgresRelationshipAttributeDefinition, PostgresRelationshipType } from "../lib/postgres";

export type PostgresRelationshipEndpointOption = {
  key: string;
  entityType: "object" | "source";
  entityId: string;
  name: string;
  type: string;
};

type RelationshipTab = "details" | "graphics" | "attributes";

const DEFAULT_RELATIONSHIP_COLOR = "#355070";
const LINE_SHAPE_OPTIONS = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
] as const;
const LINE_WEIGHT_OPTIONS = [
  { value: 1, label: "Light" },
  { value: 2, label: "Regular" },
  { value: 3, label: "Bold" },
  { value: 4, label: "Heavy" },
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
  if (shape === "dotted") return "2 6";
  return undefined;
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = normalizeColor(hex).replace("#", "");
  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function pickerOptionStyle(selected: boolean, color: string) {
  return {
    borderColor: selected ? color : hexToRgba(color, 0.22),
    background: `linear-gradient(180deg, ${hexToRgba(color, selected ? 0.14 : 0.06)}, rgba(255, 255, 255, 0.96))`,
    boxShadow: selected ? `0 0 0 1px ${hexToRgba(color, 0.35)}` : undefined,
  };
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
  return (
    <label className="form-label">
      {label}
      <div className="users-table-wrap" style={{ maxHeight: 188, overflowY: "auto", marginTop: 6 }}>
        <table className="users-table">
          <thead>
            <tr>
              <th className="users-th" style={{ width: "62%" }}>Name</th>
              <th className="users-th" style={{ width: "38%" }}>Type</th>
            </tr>
          </thead>
          <tbody>
            {options.length === 0 ? (
              <tr><td className="users-td-msg" colSpan={2}>No matching endpoints.</td></tr>
            ) : options.map((option) => (
              <tr
                key={option.key}
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
  tab: RelationshipTab;
  setTab: Dispatch<SetStateAction<RelationshipTab>>;
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

  return (
    <div className="modal-overlay" onClick={() => !submitting && onClose()}>
      <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
        <div className="modal-title-bar">
          <div>
            <h2>{title}</h2>
          </div>
          <button
            type="button"
            className="modal-icon-close"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            title="Close"
          >
            x
          </button>
        </div>
        <form onSubmit={handleSubmit} className="form">
          <div className="segmented-control modal-segmented-control" role="tablist" aria-label={ariaLabel}>
            {(["details", "graphics", "attributes"] as const).map((nextTab) => (
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
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
                <RelationshipEndpointSingleSelect label="From" options={availableFromEndpoints} value={fromEndpointKey} onChange={(value) => {
                  setValidationWarning("");
                  setFromEndpointKey(value);
                }} />
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
              <label className="form-label">
                <OverrideHeader label="Color" inherited={!colorOverride.trim()} onReset={() => setColorOverride("")} />
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <input className="form-input form-input--color" type="color" value={effectiveColor} onChange={(event) => setColorOverride(event.target.value)} />
                  <input className="form-input" value={!colorOverride.trim() ? inheritedColor : colorOverride} onChange={(event) => setColorOverride(event.target.value)} style={{ flex: "0 0 148px", fontFamily: "monospace" }} />
                </div>
              </label>
              <label className="form-label">
                <OverrideHeader label="Line shape" inherited={!lineShapeOverride.trim()} onReset={() => setLineShapeOverride("")} />
                <div className="shape-picker-grid shape-picker-grid--lines" role="radiogroup" aria-label="Line shape selection">
                  {LINE_SHAPE_OPTIONS.map((option) => (
                    <button key={option.value} type="button" className={`shape-picker-option${effectiveLineShape === option.value ? " shape-picker-option--selected" : ""}`} onClick={() => setLineShapeOverride(option.value === inheritedLineShape ? "" : option.value)} style={pickerOptionStyle(effectiveLineShape === option.value, effectiveColor)}>
                      <div className="shape-picker-preview shape-picker-preview--line" aria-hidden="true">
                        <svg width="92" height="18" viewBox="0 0 92 18"><line x1="4" y1="9" x2="88" y2="9" stroke={effectiveColor} strokeWidth="3" strokeDasharray={strokeDasharray(option.value)} /></svg>
                      </div>
                      <span className="shape-picker-label">{option.label}</span>
                    </button>
                  ))}
                </div>
              </label>
              <label className="form-label">
                <OverrideHeader label="Line weight" inherited={lineWeightOverride == null} onReset={() => setLineWeightOverride(null)} />
                <div className="shape-picker-grid shape-picker-grid--lines" role="radiogroup" aria-label="Line weight selection">
                  {LINE_WEIGHT_OPTIONS.map((option) => (
                    <button key={option.value} type="button" className={`shape-picker-option${effectiveLineWeight === option.value ? " shape-picker-option--selected" : ""}`} onClick={() => setLineWeightOverride(option.value === inheritedLineWeight ? null : option.value)} style={pickerOptionStyle(effectiveLineWeight === option.value, effectiveColor)}>
                      <div className="shape-picker-preview shape-picker-preview--line" aria-hidden="true">
                        <svg width="108" height="24" viewBox="0 0 108 24"><line x1="10" y1="12" x2="98" y2="12" stroke={effectiveColor} strokeWidth={option.value} strokeLinecap="round" /></svg>
                      </div>
                      <span className="shape-picker-label">{option.label}</span>
                    </button>
                  ))}
                </div>
              </label>
              <label className="form-label">
                <OverrideHeader label="Arrowheads" inherited={!arrowheadOverride.trim()} onReset={() => setArrowheadOverride("")} />
                <div className="shape-picker-grid shape-picker-grid--lines" role="radiogroup" aria-label="Arrowhead selection">
                  {ARROWHEAD_OPTIONS.map((option) => (
                    <button key={option.value} type="button" className={`shape-picker-option${effectiveArrowhead === option.value ? " shape-picker-option--selected" : ""}`} onClick={() => setArrowheadOverride(option.value === inheritedArrowhead ? "" : option.value)} style={pickerOptionStyle(effectiveArrowhead === option.value, effectiveColor)}>
                      <div className="shape-picker-preview shape-picker-preview--line" aria-hidden="true">
                        <svg width="92" height="18" viewBox="0 0 92 18"><line x1="4" y1="9" x2="88" y2="9" stroke={effectiveColor} strokeWidth="2" markerEnd={option.value !== "none" ? "url(#arrow-shared)" : undefined} markerStart={option.value === "double_sided" ? "url(#arrow-shared)" : undefined} /><defs><marker id="arrow-shared" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={effectiveColor} /></marker></defs></svg>
                      </div>
                      <span className="shape-picker-label">{option.label}</span>
                    </button>
                  ))}
                </div>
              </label>
            </>
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
          <div className="modal-actions">
            <button type="submit" className="btn btn--primary" disabled={submitting || submitDisabled}>
              {submitting ? "Saving..." : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
