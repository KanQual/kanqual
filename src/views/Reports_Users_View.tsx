import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useStore } from "../context/StoreContext";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import type { Annotation, Code, Document as ProjectDocument, ProjectLogEntry } from "../types";
import { HelpIcon } from "../components/AppIcons";

type CoderReportKind = "activity" | "comparison" | "agreement";
type CoderReportSortCol = "name" | "kind" | "createdByName" | "createdAt";
type SortDir = "asc" | "desc";

interface CoderItem {
  id: string;
  name: string;
}

interface CaseItem {
  id: string;
  name: string;
}

interface AttributeItem {
  id: string;
  name: string;
  dataType: string;
}

interface CaseDocumentLink {
  caseId: string;
  documentId: string;
}

interface AttributeValueItem {
  id: string;
  ownerId: string;
  attributeId: string;
  value: string;
}

interface AttributeFilterConfig {
  min?: string;
  max?: string;
  selectedValues?: string[];
}

interface CoderReportSettings {
  kind: CoderReportKind;
  caseIds: string[];
  coderIds: string[];
  documentIds: string[];
  codeIds: string[];
  caseAttributeIds?: string[];
  caseAttributeFilters?: Record<string, AttributeFilterConfig>;
}

interface CoderSummaryRow {
  coderId: string;
  coderName: string;
  annotations: number;
  documents: number;
  codes: number;
  lastCodedAt: string;
}

interface ComparisonSummaryStats {
  selectedCoders: number;
  sharedDocuments: number;
  totalAnnotations: number;
  uniqueCodes: number;
  codesUsedByAll: number;
  codesUsedByOne: number;
}

interface ComparisonMatrixColumn {
  id: string;
  label: string;
}

interface ComparisonMatrixRow {
  id: string;
  label: string;
  values: number[];
}

interface CoderReportSnapshot {
  reportType: "coder-report";
  kind: CoderReportKind;
  settings: CoderReportSettings;
  caseItems: CaseItem[];
  coderItems: CoderItem[];
  caseAttributeItems: AttributeItem[];
  caseDocumentLinks: CaseDocumentLink[];
  caseAttributeValues: AttributeValueItem[];
  documents: ProjectDocument[];
  codes: Code[];
  frozenSummaryRows: CoderSummaryRow[];
  frozenProjectLogRows?: ProjectLogEntry[];
  frozenComparisonSummary?: ComparisonSummaryStats;
  frozenCodeUsageRows?: ComparisonMatrixRow[];
  frozenCodeUsageColumns?: ComparisonMatrixColumn[];
  frozenDocumentRows?: ComparisonMatrixRow[];
  frozenDocumentColumns?: ComparisonMatrixColumn[];
}

interface CoderReportRow {
  id: string;
  name: string;
  createdByName: string;
  createdAt: string;
  snapshot: CoderReportSnapshot;
}

const REPORT_LABELS: Record<CoderReportKind, string> = {
  activity: "User Activity",
  comparison: "User Comparison",
  agreement: "Interuser Agreement",
};

const REPORT_COLS: { key: CoderReportSortCol; label: string; width: string }[] = [
  { key: "name", label: "Name", width: "34%" },
  { key: "kind", label: "Type", width: "22%" },
  { key: "createdByName", label: "Created By", width: "22%" },
  { key: "createdAt", label: "Created", width: "22%" },
];

const ACTION_LABELS: Record<string, string> = {
  "project.create": "Project created",
  "project.open": "Project opened",
  "project.close": "Project left",
  "project.update": "Project updated",
  "project.export": "Project exported",
  "project.encrypted_backup.export": "Encrypted project backup exported",
  "project.log.export": "Project log exported",
  "project.import": "Project imported",
  "project.encrypted_backup.import": "Encrypted project backup imported",
  "project.restore_backup": "Project restored from backup",
  "project.backup.create": "Project backup created",
  "project.backup.settings": "Project backup settings updated",
  "project.backup.delete": "Project backup deleted",
  "project.network_mode.update": "Network mode updated",
  "project.ai_assist.update": "Project AI Assist updated",
  "project.ai_chat.message": "AI chat message sent",
  "project.ai_chat.response": "AI chat response received",
  "project.ai_assist.embeddings.delete": "Project AI Assist embeddings deleted",
  "codebook.export": "Codebook exported",
  "codebook.import": "Codebook imported",
  "ai_assist.index": "AI Assist embeddings built",
  "ai_assist.reindex": "AI Assist embeddings rebuilt",
  "document.create": "Document added",
  "document.update": "Document updated",
  "document.delete": "Document deleted",
  "document.restore": "Document restored",
  "document.associations": "Document associations updated",
  "code.create": "Code added",
  "code.update": "Code updated",
  "code.delete": "Code deleted",
  "code.restore": "Code restored",
  "annotation.create": "Annotation added",
  "annotation.update": "Annotation updated",
  "annotation.delete": "Annotation deleted",
  "annotation.restore": "Annotation restored",
  "case.create": "Case created",
  "case.update": "Case updated",
  "case.delete": "Case deleted",
  "case.restore": "Case restored",
  "case.associations": "Case associations updated",
  "case_attribute.create": "Case attribute added",
  "case_attribute.update": "Case attribute updated",
  "case_attribute.delete": "Case attribute deleted",
  "document_attribute.create": "Document attribute added",
  "document_attribute.update": "Document attribute updated",
  "document_attribute.delete": "Document attribute deleted",
  "memo.create": "Memo created",
  "memo.update": "Memo updated",
  "memo.delete": "Memo deleted",
  "memo.restore": "Memo restored",
  "code_report.create": "Code report created",
  "code_report.update": "Code report updated",
  "code_report.delete": "Code report deleted",
  "code_report.restore": "Code report restored",
  "coder_report.create": "Coder report created",
  "coder_report.update": "Coder report updated",
  "coder_report.delete": "Coder report deleted",
  "coder_report.restore": "Coder report restored",
  "member.add": "Member added",
  "member.update": "Member updated",
  "member.remove": "Member removed",
  "member.reassociate": "Imported member reassociated",
  "member.remove_unresolved": "Imported member removed",
};

function fmtDate(iso?: string): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "-";
  }
}

function parseNumericValue(value: string | undefined): number | null {
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDateValue(value: string | undefined): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDateInputValue(timestamp: number | null): string {
  if (timestamp === null || !Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function buildDefaultAttributeFilter(
  attr: AttributeItem,
  stats: Map<string, { textValues: string[]; minNumber: number | null; maxNumber: number | null; minDate: number | null; maxDate: number | null }>,
): AttributeFilterConfig {
  const stat = stats.get(attr.id);
  if (attr.dataType === "number") {
    return {
      min: stat?.minNumber != null ? String(stat.minNumber) : "",
      max: stat?.maxNumber != null ? String(stat.maxNumber) : "",
    };
  }
  if (attr.dataType === "datetime") {
    return {
      min: formatDateInputValue(stat?.minDate ?? null),
      max: formatDateInputValue(stat?.maxDate ?? null),
    };
  }
  return {
    selectedValues: stat?.textValues ?? [],
  };
}

function relationPreview(ids: string[]): string[] {
  return ids.slice(0, 100);
}

function getPocketBaseErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") {
    return error instanceof Error ? error.message : "Failed to save report.";
  }

  const maybe = error as {
    message?: string;
    response?: { message?: string; data?: Record<string, { message?: string; code?: string }> };
  };
  const details = maybe.response?.data
    ? Object.entries(maybe.response.data)
        .map(([field, detail]) => `${field}: ${detail.message || detail.code || "invalid value"}`)
        .join("; ")
    : "";
  return details || maybe.response?.message || maybe.message || "Failed to save report.";
}

function toggleSet(
  set: Set<string>,
  setter: React.Dispatch<React.SetStateAction<Set<string>>>,
  id: string,
) {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  setter(next);
}

function toggleAll<T extends { id: string }>(
  items: T[],
  selected: Set<string>,
  setter: React.Dispatch<React.SetStateAction<Set<string>>>,
) {
  if (items.length > 0 && selected.size === items.length) {
    setter(new Set());
  } else {
    setter(new Set(items.map((item) => item.id)));
  }
}

function NewCoderReportModal({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (kind: CoderReportKind) => void;
}) {
  const options: Array<{ kind: CoderReportKind; text: string }> = [
    { kind: "activity", text: "Activity, coverage, and coding volume by user." },
  ];

  return (
    <div className="modal-overlay" onClick={onClose} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "var(--color-bg)", padding: 24, borderRadius: 8, minWidth: 320, maxWidth: 960, width: "min(960px, calc(100vw - 32px))" }}>
        <h2 style={{ marginTop: 0, marginBottom: 16 }}>New User Report</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 12,
            alignItems: "stretch",
          }}
        >
          {options.map((option) => (
            <button
              key={option.kind}
              className="btn export-option-card"
              type="button"
              onClick={() => onSelect(option.kind)}
              style={{
                minHeight: 220,
                gridColumn: "2 / 3",
                padding: 18,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "space-between",
                textAlign: "center",
                whiteSpace: "normal",
                color: "var(--color-text)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>{REPORT_LABELS[option.kind]}</div>
                <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--color-text-muted)" }}>{option.text}</div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {REPORT_LABELS[option.kind]}
              </div>
            </button>
          ))}
        </div>
        <div style={{ marginTop: 16, textAlign: "right" }}>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function SelectionPanel({
  title,
  count,
  collapsed,
  onToggleCollapsed,
  children,
  selectAll,
  disabled = false,
  headerExtra,
}: {
  title: string;
  count: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  children: React.ReactNode;
  selectAll?: { checked: boolean; disabled?: boolean; onToggle: () => void };
  disabled?: boolean;
  headerExtra?: React.ReactNode;
}) {
  return (
    <div className="annotate-card" style={{ flexShrink: 0 }}>
      <button
        className="annotate-card-header"
        style={{ width: "100%", cursor: "pointer", background: "none", border: "none" }}
        onClick={onToggleCollapsed}
      >
        <span style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
          <span className="annotate-card-title">{title}{count > 0 ? ` (${count})` : ""}</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {headerExtra}
          <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-muted)" }}>{collapsed ? "▶" : "▼"}</span>
        </span>
      </button>
      {!collapsed && selectAll && !disabled && !selectAll.disabled && (
        <div style={{ padding: "2px 14px 4px", display: "flex", gap: 8 }}>
          <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={(e) => { e.stopPropagation(); if (!selectAll.checked) selectAll.onToggle(); }}>All</button>
          <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={(e) => { e.stopPropagation(); if (selectAll.checked) selectAll.onToggle(); }}>Clear</button>
        </div>
      )}
      {!collapsed && children}
    </div>
  );
}

function CoderSelectionPanel({
  coders,
  selectedIds,
  onChange,
  disabled = false,
}: {
  coders: CoderItem[];
  selectedIds: Set<string>;
  onChange: (ids: Set<string>) => void;
  disabled?: boolean;
}) {
  return (
    <div className="annotate-card annotate-card--featured" style={{ flexShrink: 0 }}>
      <div className="annotate-card-header">
        <span className="annotate-card-title">Users{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}</span>
      </div>
      {!disabled && coders.length > 0 && (
        <div style={{ padding: "2px 14px 4px", display: "flex", gap: 8 }}>
          <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => onChange(new Set(coders.map((item) => item.id)))}>All</button>
          <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => onChange(new Set())}>Clear</button>
        </div>
      )}
      <ul className="code-list">
        {coders.length === 0 ? (
          <li className="code-list-empty">No coders.</li>
        ) : coders.map((item) => (
          <li
            key={item.id}
            className="code-item"
            style={{ cursor: disabled ? "default" : "pointer" }}
            onClick={() => {
              if (disabled) return;
              const next = new Set(selectedIds);
              if (next.has(item.id)) next.delete(item.id);
              else next.add(item.id);
              onChange(next);
            }}
          >
            <input
              type="checkbox"
              className="memo-sel-checkbox"
              checked={selectedIds.has(item.id)}
              disabled={disabled}
              onChange={(e) => {
                e.stopPropagation();
                if (disabled) return;
                const next = new Set(selectedIds);
                if (next.has(item.id)) next.delete(item.id);
                else next.add(item.id);
                onChange(next);
              }}
              onClick={(e) => e.stopPropagation()}
            />
            <span className="code-label">{item.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const LOG_CATEGORY_ORDER = ["all", "project", "case", "document", "code", "annotation", "memo", "report", "other"] as const;
type LogCategory = typeof LOG_CATEGORY_ORDER[number];
const LOG_CATEGORY_LABELS: Record<LogCategory, string> = {
  all: "All",
  project: "Project",
  case: "Case",
  document: "Document",
  code: "Code",
  annotation: "Annotation",
  memo: "Memo",
  report: "Report",
  other: "Other",
};

function getLogCategory(action: string): LogCategory {
  if (action.startsWith("project.") || action.startsWith("member.") || action.startsWith("ai_assist.")) return "project";
  if (action.startsWith("case.") || action.startsWith("case_attribute.")) return "case";
  if (action.startsWith("document.") || action.startsWith("document_attribute.")) return "document";
  if (action.startsWith("code.") || action.startsWith("codebook.")) return "code";
  if (action.startsWith("annotation.")) return "annotation";
  if (action.startsWith("memo.")) return "memo";
  if (action.includes("_report.") || action.endsWith("_report")) return "report";
  return "other";
}

function startOfWeek(date: Date): Date {
  const next = new Date(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  next.setHours(0, 0, 0, 0);
  return next;
}

function formatPeriodKey(date: Date, granularity: "day" | "week" | "month"): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  if (granularity === "day") return `${year}-${month}-${day}`;
  if (granularity === "month") return `${year}-${month}`;
  const weekStart = startOfWeek(date);
  const weekMonth = String(weekStart.getMonth() + 1).padStart(2, "0");
  const weekDay = String(weekStart.getDate()).padStart(2, "0");
  return `${weekStart.getFullYear()}-${weekMonth}-${weekDay}`;
}

function formatPeriodLabel(periodKey: string, granularity: "day" | "week" | "month"): string {
  if (granularity === "day") {
    return new Date(`${periodKey}T00:00:00`).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  if (granularity === "month") {
    const [year, month] = periodKey.split("-");
    return new Date(`${year}-${month}-01T00:00:00`).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
    });
  }
  const start = new Date(`${periodKey}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} - ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}

function CoderActivityOverTimeCard({ rows }: { rows: ProjectLogEntry[] }) {
  const plotHeight = 180;
  const sorted = useMemo(
    () => [...rows].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()),
    [rows],
  );
  const categoryCounts = useMemo(() => {
    const counts = new Map<LogCategory, number>();
    for (const entry of sorted) {
      const category = getLogCategory(entry.action);
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return counts;
  }, [sorted]);
  const availableTabs = useMemo(
    () => LOG_CATEGORY_ORDER.filter((category) => category === "all" || (categoryCounts.get(category) ?? 0) > 0),
    [categoryCounts],
  );
  const [activeTab, setActiveTab] = useState<LogCategory>("all");
  const [granularity, setGranularity] = useState<"day" | "week" | "month">("week");

  useEffect(() => {
    if (!availableTabs.includes(activeTab)) {
      setActiveTab("all");
    }
  }, [activeTab, availableTabs]);

  const visibleRows = useMemo(
    () => activeTab === "all" ? sorted : sorted.filter((entry) => getLogCategory(entry.action) === activeTab),
    [activeTab, sorted],
  );
  const coderColumns = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of visibleRows) {
      if (!entry.userId) continue;
      if (!map.has(entry.userId)) map.set(entry.userId, entry.userName || "-");
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [visibleRows]);
  const periodRows = useMemo(() => {
    const periods = new Map<string, Map<string, number>>();
    for (const entry of visibleRows) {
      const date = new Date(entry.occurredAt);
      if (Number.isNaN(date.getTime()) || !entry.userId) continue;
      const periodKey = formatPeriodKey(date, granularity);
      if (!periods.has(periodKey)) periods.set(periodKey, new Map());
      const counts = periods.get(periodKey)!;
      counts.set(entry.userId, (counts.get(entry.userId) ?? 0) + 1);
    }
    return [...periods.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([periodKey, counts]) => ({
        periodKey,
        label: formatPeriodLabel(periodKey, granularity),
        counts,
      }));
  }, [granularity, visibleRows]);
  const maxCount = useMemo(
    () => Math.max(0, ...periodRows.flatMap((row) => coderColumns.map((coder) => row.counts.get(coder.id) ?? 0))),
    [coderColumns, periodRows],
  );

  function coderColor(index: number): string {
    const hue = (index * 67) % 360;
    return `hsl(${hue} 55% 45%)`;
  }

  return (
    <div className="annotate-card" style={{ flexShrink: 0 }}>
      <div className="annotate-card-header">
        <span className="annotate-card-title">Activity Over Time</span>
        <span className="users-filter-count">{visibleRows.length}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "0 14px 10px", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {availableTabs.map((tab) => {
            const count = tab === "all" ? sorted.length : (categoryCounts.get(tab) ?? 0);
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                className={`btn${isActive ? " btn--primary" : ""}`}
                style={{ fontSize: 11, padding: "2px 10px" }}
                onClick={() => setActiveTab(tab)}
              >
                {LOG_CATEGORY_LABELS[tab]} ({count})
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {(["day", "week", "month"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={`btn${granularity === option ? " btn--primary" : ""}`}
              style={{ fontSize: 11, padding: "2px 10px", textTransform: "capitalize" }}
              onClick={() => setGranularity(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      <div style={{ padding: "0 14px 14px" }}>
        {periodRows.length === 0 || coderColumns.length === 0 ? (
          <div className="users-td-msg" style={{ padding: "24px 12px" }}>No log activity is available for this view.</div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 180px", gap: 18, alignItems: "center" }}>
              <div style={{ overflowX: "auto", paddingBottom: 4 }}>
                <div style={{ display: "grid", gridTemplateColumns: "40px minmax(0, 1fr)", gap: 10, minWidth: "max-content" }}>
                  <div
                    style={{
                      height: plotHeight,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      alignItems: "flex-end",
                      fontSize: 11,
                      color: "var(--color-text-muted)",
                    }}
                  >
                    {[maxCount, Math.round(maxCount / 2), 0].map((tick, index) => (
                      <span key={`${tick}-${index}`}>{tick}</span>
                    ))}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: "max-content" }}>
                    <div style={{ borderLeft: "1px solid var(--color-border-strong, var(--color-border))", borderBottom: "1px solid var(--color-border-strong, var(--color-border))", padding: "8px 8px 0 12px" }}>
                      <div style={{ display: "flex", alignItems: "flex-end", gap: 18, minHeight: plotHeight, minWidth: "max-content" }}>
                        {periodRows.map((row) => (
                          <div key={row.periodKey} style={{ display: "flex", justifyContent: "center", minWidth: 92 }}>
                            <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: plotHeight }}>
                              {coderColumns.map((coder, index) => {
                                const value = row.counts.get(coder.id) ?? 0;
                                const barHeight = maxCount > 0 ? Math.max((value / maxCount) * plotHeight, value > 0 ? 6 : 0) : 0;
                                return (
                                  <div key={`${row.periodKey}-${coder.id}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", width: 18 }}>
                                    <div
                                      className="coder-activity-bar"
                                      style={{
                                        width: "100%",
                                        height: barHeight,
                                        borderRadius: "8px 8px 0 0",
                                        background: coderColor(index),
                                      }}
                                      title={`${row.label} - ${coder.name}: ${value}`}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 18, minWidth: "max-content", paddingLeft: 12, paddingRight: 8 }}>
                      {periodRows.map((row) => (
                        <div key={`${row.periodKey}-label`} style={{ minWidth: 92, fontSize: 12, fontWeight: 600, color: "var(--color-text)", textAlign: "center", lineHeight: 1.3 }}>
                          {row.label}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 10, minHeight: plotHeight }}>
                {coderColumns.map((coder, index) => (
                  <div key={coder.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--color-text-muted)" }}>
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: coderColor(index), flexShrink: 0 }} />
                    <span>{coder.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CoderProjectLogCard({ rows }: { rows: ProjectLogEntry[] }) {
  const sorted = [...rows].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
  const categoryCounts = useMemo(() => {
    const counts = new Map<LogCategory, number>();
    for (const entry of sorted) {
      const category = getLogCategory(entry.action);
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return counts;
  }, [sorted]);
  const availableTabs = useMemo(
    () => LOG_CATEGORY_ORDER.filter((category) => category === "all" || (categoryCounts.get(category) ?? 0) > 0),
    [categoryCounts],
  );
  const [activeTab, setActiveTab] = useState<LogCategory>("all");

  useEffect(() => {
    if (!availableTabs.includes(activeTab)) {
      setActiveTab("all");
    }
  }, [activeTab, availableTabs]);

  const visibleRows = useMemo(
    () => activeTab === "all" ? sorted : sorted.filter((entry) => getLogCategory(entry.action) === activeTab),
    [activeTab, sorted],
  );

  function accessModeLabel(mode?: "local" | "remote"): string {
    if (mode === "local") return "Local";
    if (mode === "remote") return "Remote";
    return "-";
  }

  return (
    <div className="annotate-card" style={{ flexShrink: 0 }}>
      <div className="annotate-card-header">
        <span className="annotate-card-title">Project Log</span>
        <span className="users-filter-count">{sorted.length}</span>
      </div>
      {availableTabs.length > 1 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "0 14px 10px" }}>
          {availableTabs.map((tab) => {
            const count = tab === "all" ? sorted.length : (categoryCounts.get(tab) ?? 0);
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                className={`btn${isActive ? " btn--primary" : ""}`}
                style={{ fontSize: 11, padding: "2px 10px" }}
                onClick={() => setActiveTab(tab)}
              >
                {LOG_CATEGORY_LABELS[tab]} ({count})
              </button>
            );
          })}
        </div>
      )}
      <div className="users-table-wrap" style={{ margin: 0, maxWidth: "none", borderRadius: 0, maxHeight: 320 }}>
        <table className="users-table">
          <thead>
            <tr>
              <th className="users-th" style={{ minWidth: 140 }}>Time</th>
              <th className="users-th" style={{ minWidth: 130 }}>Coder</th>
              <th className="users-th" style={{ minWidth: 90 }}>Access</th>
              <th className="users-th" style={{ minWidth: 140 }}>Action</th>
              <th className="users-th" style={{ minWidth: 220 }}>Description</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr><td colSpan={5} className="users-td-msg">No project log entries for the selected coder.</td></tr>
            ) : visibleRows.map((entry) => (
              <tr key={entry.id} className="users-row">
                <td className="users-td users-td--muted">{fmtDate(entry.occurredAt)}</td>
                <td className="users-td users-td--name">{entry.userName || "-"}</td>
                <td className="users-td users-td--muted">{accessModeLabel(entry.accessMode)}</td>
                <td className="users-td users-td--muted">{ACTION_LABELS[entry.action] ?? entry.action}</td>
                <td className="users-td">{entry.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function heatmapColor(value: number, max: number): string {
  if (value <= 0 || max <= 0) return "var(--color-surface-alt)";
  const t = Math.min(1, value / max);
  return `color-mix(in srgb, var(--color-heatmap-high) ${Math.round(t * 100)}%, var(--color-heatmap-low))`;
}

function ComparisonSummaryCard({ stats }: { stats: ComparisonSummaryStats }) {
  const items = [
    { label: "Selected Coders", value: stats.selectedCoders },
    { label: "Shared Documents", value: stats.sharedDocuments },
    { label: "Total Annotations", value: stats.totalAnnotations },
    { label: "Unique Codes", value: stats.uniqueCodes },
    { label: "Codes Used By All", value: stats.codesUsedByAll },
    { label: "Codes Used By One", value: stats.codesUsedByOne },
  ];

  return (
    <div className="annotate-card" style={{ flexShrink: 0 }}>
      <div className="annotate-card-header">
        <span className="annotate-card-title">Comparison Summary</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, padding: 14 }}>
        {items.map((item) => (
          <div key={item.label} style={{ border: "1px solid var(--color-border)", borderRadius: 6, padding: "10px 12px" }}>
            <div className="summary-card-value" style={{ textAlign: "left" }}>{item.value}</div>
            <div className="summary-card-label" style={{ textAlign: "left" }}>{item.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ComparisonMatrixCard({
  title,
  rows,
  columns,
}: {
  title: string;
  rows: ComparisonMatrixRow[];
  columns: ComparisonMatrixColumn[];
}) {
  const maxValue = Math.max(0, ...rows.flatMap((row) => row.values));

  return (
    <div className="annotate-card" style={{ flexShrink: 0 }}>
      <div className="annotate-card-header">
        <span className="annotate-card-title">{title}</span>
      </div>
      <div className="users-table-wrap" style={{ margin: 0, maxWidth: "none", borderRadius: 0, maxHeight: 340 }}>
        <table className="users-table">
          <thead>
            <tr>
              <th className="users-th" style={{ minWidth: 170 }}>{title}</th>
              {columns.map((column) => (
                <th key={column.id} className="users-th" style={{ minWidth: 110 }}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 || columns.length === 0 ? (
              <tr><td colSpan={columns.length + 1} className="users-td-msg">Select coders to build the comparison.</td></tr>
            ) : rows.map((row) => (
              <tr key={row.id} className="users-row">
                <td className="users-td users-td--name">{row.label}</td>
                {row.values.map((value, index) => (
                  <td
                    key={`${row.id}-${columns[index]?.id ?? index}`}
                    className="users-td"
                    style={{
                      background: heatmapColor(value, maxValue),
                      color: value > 0 ? "var(--color-text)" : "var(--color-text-muted)",
                      textAlign: "center",
                    }}
                  >
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CoderReportCreationPage({
  kind,
  row,
  initialSettings,
  onBack,
  onSaved,
  onUseSettings,
}: {
  kind: CoderReportKind;
  row?: CoderReportRow;
  initialSettings?: CoderReportSettings;
  onBack: () => void;
  onSaved?: (row: CoderReportRow) => void;
  onUseSettings?: (settings: CoderReportSettings) => void;
}) {
  const { user: currentUser } = useAuth();
  const { pb, activeProject, documents: storeDocuments, codes: storeCodes, logEntries, createCoderReport, canCurrentUser } = useStore();
  const frozenSnapshot = row?.snapshot;
  const isFrozen = !!row;
  const canCreateReports = canCurrentUser("createReports");
  const canEditReportConfiguration = canCurrentUser("editReportConfiguration");
  const canStartReports = canCreateReports && canEditReportConfiguration;
  const reportKind = frozenSnapshot?.kind ?? kind;
  const settings = initialSettings ?? frozenSnapshot?.settings;
  const caseItems = frozenSnapshot?.caseItems ?? [];
  const documents = frozenSnapshot?.documents ?? storeDocuments;
  const caseAttributeItemsFromSnapshot = frozenSnapshot?.caseAttributeItems ?? [];
  const caseDocumentLinksFromSnapshot = frozenSnapshot?.caseDocumentLinks ?? [];
  const caseAttributeValuesFromSnapshot = frozenSnapshot?.caseAttributeValues ?? [];
  const codes = frozenSnapshot?.codes ?? storeCodes;

  const [name, setName] = useState(row?.name ?? `${REPORT_LABELS[reportKind]} Report`);
  const [allCaseItems, setAllCaseItems] = useState<CaseItem[]>(caseItems);
  const [coderItems, setCoderItems] = useState<CoderItem[]>(frozenSnapshot?.coderItems ?? []);
  const [caseAttributeItems, setCaseAttributeItems] = useState<AttributeItem[]>(caseAttributeItemsFromSnapshot);
  const [caseDocumentLinks, setCaseDocumentLinks] = useState<CaseDocumentLink[]>(caseDocumentLinksFromSnapshot);
  const [caseAttributeValues, setCaseAttributeValues] = useState<AttributeValueItem[]>(caseAttributeValuesFromSnapshot);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selCaseIds] = useState<Set<string>>(new Set(settings?.caseIds ?? []));
  const [selCoderIds, setSelCoderIds] = useState<Set<string>>(new Set(settings?.coderIds ?? []));
  const [selDocIds, setSelDocIds] = useState<Set<string>>(new Set(settings?.documentIds ?? []));
  const [selCodeIds, setSelCodeIds] = useState<Set<string>>(new Set(settings?.codeIds ?? []));
  const [selCaseAttrIds, setSelCaseAttrIds] = useState<Set<string>>(new Set(settings?.caseAttributeIds ?? []));
  const [caseAttributeFilters, setCaseAttributeFilters] = useState<Record<string, AttributeFilterConfig>>(() => settings?.caseAttributeFilters ?? {});
  const [showCaseAttributeFilters, setShowCaseAttributeFilters] = useState(false);
  const [loadingFilters, setLoadingFilters] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeProject || !pb || isFrozen) return;
    let cancelled = false;

    async function loadFilterData() {
      setLoadingFilters(true);
      setError(null);
      try {
        const [caseRecs, memberRecs, caseAttrRecs, annotationRecs] = await Promise.all([
          pb.collection("cases").getFullList({
            filter: `project="${activeProject!.id}"&&deleted_at=""`,
            sort: "name",
          }),
          pb.collection("project_members").getFullList({
            filter: `project="${activeProject!.id}"`,
            expand: "user",
          }),
          pb.collection("case_attribute_definitions").getFullList({
            filter: `project="${activeProject!.id}"&&deleted_at=""`,
            sort: "sort_order,name",
          }),
          storeDocuments.length > 0
            ? pb.collection("annotations").getFullList({
                filter: `(${storeDocuments.map((doc) => `document="${doc.id}"`).join(" || ")})&&deleted_at=""`,
                sort: "created",
                expand: "created_by",
              })
            : Promise.resolve([]),
        ]);
        const [caseDocRecs, caseAttrValueRecs] = await Promise.all([
          caseRecs.length > 0
            ? pb.collection("case_documents").getFullList({
                filter: caseRecs.map((caseItem) => `case="${caseItem.id}"`).join(" || "),
              })
            : Promise.resolve([]),
          caseRecs.length > 0
            ? pb.collection("case_attribute_values").getFullList({
                filter: `(${caseRecs.map((caseItem) => `case="${caseItem.id}"`).join(" || ")})&&deleted_at=""`,
              })
            : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setAllCaseItems(caseRecs.map((record) => ({ id: record.id, name: record.name })));
        setCoderItems(
          memberRecs
            .map((record) => {
              const user = record.expand?.user;
              return user ? { id: user.id, name: user.name || user.email || "Unknown" } : null;
            })
            .filter(Boolean) as CoderItem[],
        );
        setCaseAttributeItems(caseAttrRecs.map((record) => ({
          id: record.id,
          name: record.name ?? "Untitled attribute",
          dataType: record.data_type ?? "text",
        })));
        setCaseDocumentLinks(caseDocRecs.map((record) => ({
          caseId: record.case,
          documentId: record.document,
        })));
        setCaseAttributeValues(caseAttrValueRecs.map((record) => ({
          id: record.id,
          ownerId: record.case,
          attributeId: record.attribute,
          value: record.value ?? "",
        })));
        setAnnotations(annotationRecs.map((record) => ({
          id: record.id,
          documentId: record.document,
          codeId: record.code,
          startOffset: record.start_offset ?? 0,
          endOffset: record.end_offset ?? 0,
          quote: record.quote ?? "",
          note: record.note ?? "",
          createdAt: record.created,
          createdBy: record.expand?.created_by?.name || record.expand?.created_by?.email || "",
          createdById: record.created_by ?? "",
        })));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load report filters.");
      } finally {
        if (!cancelled) setLoadingFilters(false);
      }
    }

    loadFilterData();
    return () => { cancelled = true; };
  }, [activeProject, isFrozen, pb, storeDocuments]);

  const caseDocumentMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const link of caseDocumentLinks) {
      if (!map.has(link.caseId)) map.set(link.caseId, new Set());
      map.get(link.caseId)!.add(link.documentId);
    }
    return map;
  }, [caseDocumentLinks]);

  const caseAttributeMap = useMemo(() => {
    const map = new Map<string, Map<string, string>>();
    for (const value of caseAttributeValues) {
      if (!map.has(value.ownerId)) map.set(value.ownerId, new Map());
      map.get(value.ownerId)!.set(value.attributeId, value.value ?? "");
    }
    return map;
  }, [caseAttributeValues]);

  const caseAttributeValueStats = useMemo(() => {
    const map = new Map<string, {
      textValues: string[];
      minNumber: number | null;
      maxNumber: number | null;
      minDate: number | null;
      maxDate: number | null;
    }>();
    for (const attr of caseAttributeItems) {
      const rawValues = caseAttributeValues
        .filter((item) => item.attributeId === attr.id)
        .map((item) => item.value ?? "");
      const textValues = [...new Set(rawValues.map((value) => value.trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
      const numericValues = rawValues.map(parseNumericValue).filter((value): value is number => value !== null);
      const dateValues = rawValues.map(parseDateValue).filter((value): value is number => value !== null).sort((a, b) => a - b);
      map.set(attr.id, {
        textValues,
        minNumber: numericValues.length > 0 ? Math.min(...numericValues) : null,
        maxNumber: numericValues.length > 0 ? Math.max(...numericValues) : null,
        minDate: dateValues[0] ?? null,
        maxDate: dateValues[dateValues.length - 1] ?? null,
      });
    }
    return map;
  }, [caseAttributeItems, caseAttributeValues]);

  const caseIdsMatchingSelectedAttributes = useMemo(() => {
    if (selCaseAttrIds.size === 0) return null;
    const matching = new Set<string>();
    for (const item of allCaseItems) {
      const values = caseAttributeMap.get(item.id);
      const hasAllSelectedValues = [...selCaseAttrIds].every((attrId) => {
        const attr = caseAttributeItems.find((candidate) => candidate.id === attrId);
        const value = values?.get(attrId) ?? "";
        if (!attr) return false;
        if (attr.dataType === "number") {
          const numericValue = parseNumericValue(value);
          if (numericValue === null) return false;
          const config = caseAttributeFilters[attrId];
          const min = parseNumericValue(config?.min);
          const max = parseNumericValue(config?.max);
          if (min !== null && numericValue < min) return false;
          if (max !== null && numericValue > max) return false;
          return true;
        }
        if (attr.dataType === "datetime") {
          const dateValue = parseDateValue(value);
          if (dateValue === null) return false;
          const config = caseAttributeFilters[attrId];
          const min = parseDateValue(config?.min);
          const max = parseDateValue(config?.max);
          if (min !== null && dateValue < min) return false;
          if (max !== null && dateValue > max) return false;
          return true;
        }
        const normalized = value.trim();
        const selectedValues = caseAttributeFilters[attrId]?.selectedValues ?? caseAttributeValueStats.get(attrId)?.textValues ?? [];
        return normalized.length > 0 && selectedValues.includes(normalized);
      });
      if (hasAllSelectedValues) matching.add(item.id);
    }
    return matching;
  }, [allCaseItems, caseAttributeFilters, caseAttributeItems, caseAttributeMap, caseAttributeValueStats, selCaseAttrIds]);

  const effectiveCaseIds = useMemo(() => {
    if (caseIdsMatchingSelectedAttributes) {
      if (selCaseIds.size > 0) {
        return new Set([...selCaseIds].filter((caseId) => caseIdsMatchingSelectedAttributes.has(caseId)));
      }
      return caseIdsMatchingSelectedAttributes;
    }
    return selCaseIds.size > 0 ? new Set(selCaseIds) : null;
  }, [caseIdsMatchingSelectedAttributes, selCaseIds]);

  const docIdsAllowedByCases = useMemo(() => {
    if (!effectiveCaseIds) return null;
    const allowed = new Set<string>();
    for (const caseId of effectiveCaseIds) {
      for (const docId of caseDocumentMap.get(caseId) ?? []) {
        allowed.add(docId);
      }
    }
    return allowed;
  }, [caseDocumentMap, effectiveCaseIds]);

  const selectedAnnotations = useMemo(() => {
    if (isFrozen) return [];
    return annotations.filter((ann) => {
      if (selCoderIds.size > 0 && !selCoderIds.has(ann.createdById)) return false;
      if (docIdsAllowedByCases && !docIdsAllowedByCases.has(ann.documentId)) return false;
      if (selDocIds.size > 0 && !selDocIds.has(ann.documentId)) return false;
      if (selCodeIds.size > 0 && !selCodeIds.has(ann.codeId)) return false;
      return true;
    });
  }, [annotations, docIdsAllowedByCases, isFrozen, selCodeIds, selCoderIds, selDocIds]);

  const summaryRows = useMemo(() => {
    if (frozenSnapshot?.frozenSummaryRows) return frozenSnapshot.frozenSummaryRows;
    return coderItems
      .filter((coder) => selCoderIds.has(coder.id))
      .map((coder) => {
        const coderAnnotations = selectedAnnotations.filter((ann) => ann.createdById === coder.id);
        const docIds = new Set(coderAnnotations.map((ann) => ann.documentId));
        const codeIds = new Set(coderAnnotations.map((ann) => ann.codeId));
        const codedDates = coderAnnotations
          .map((ann) => ann.createdAt)
          .sort();
        const lastCodedAt = codedDates[codedDates.length - 1] ?? "";
        return {
          coderId: coder.id,
          coderName: coder.name,
          annotations: coderAnnotations.length,
          documents: docIds.size,
          codes: codeIds.size,
          lastCodedAt,
        };
      });
  }, [coderItems, frozenSnapshot, selCoderIds, selectedAnnotations]);

  const projectLogRows = useMemo(() => {
    if (frozenSnapshot?.frozenProjectLogRows) return frozenSnapshot.frozenProjectLogRows;
    if (reportKind !== "activity" || selCoderIds.size === 0) return [];
    return logEntries.filter((entry) => selCoderIds.has(entry.userId));
  }, [frozenSnapshot, logEntries, reportKind, selCoderIds]);

  const comparisonColumns = useMemo(() => {
    if (frozenSnapshot?.frozenCodeUsageColumns) return frozenSnapshot.frozenCodeUsageColumns;
    return coderItems
      .filter((item) => selCoderIds.has(item.id))
      .map((item) => ({ id: item.id, label: item.name }));
  }, [coderItems, frozenSnapshot, selCoderIds]);

  const comparisonSummary = useMemo(() => {
    if (frozenSnapshot?.frozenComparisonSummary) return frozenSnapshot.frozenComparisonSummary;
    const selectedCoders = coderItems.filter((item) => selCoderIds.has(item.id));
    const docSets = selectedCoders.map((coder) => new Set(
      selectedAnnotations
        .filter((ann) => ann.createdById === coder.id)
        .map((ann) => ann.documentId),
    ));
    const sharedDocuments = docSets.length === 0
      ? 0
      : [...docSets[0]].filter((docId) => docSets.every((set) => set.has(docId))).length;
    const codeUsage = new Map<string, number>();
    for (const coder of selectedCoders) {
      const coderCodes = new Set(
        selectedAnnotations
          .filter((ann) => ann.createdById === coder.id)
          .map((ann) => ann.codeId),
      );
      for (const codeId of coderCodes) codeUsage.set(codeId, (codeUsage.get(codeId) ?? 0) + 1);
    }
    const selectedCodersCount = selectedCoders.length;
    return {
      selectedCoders: selectedCodersCount,
      sharedDocuments,
      totalAnnotations: selectedAnnotations.length,
      uniqueCodes: codeUsage.size,
      codesUsedByAll: selectedCodersCount === 0 ? 0 : [...codeUsage.values()].filter((count) => count === selectedCodersCount).length,
      codesUsedByOne: [...codeUsage.values()].filter((count) => count === 1).length,
    };
  }, [coderItems, frozenSnapshot, selCoderIds, selectedAnnotations]);

  const codeUsageRows = useMemo(() => {
    if (frozenSnapshot?.frozenCodeUsageRows) return frozenSnapshot.frozenCodeUsageRows;
    return codes
      .filter((code) => selCodeIds.size === 0 || selCodeIds.has(code.id))
      .map((code) => ({
        id: code.id,
        label: code.label,
        values: comparisonColumns.map((column) => selectedAnnotations.filter((ann) => ann.createdById === column.id && ann.codeId === code.id).length),
      }))
      .filter((row) => row.values.some((value) => value > 0) || comparisonColumns.length > 0);
  }, [codes, comparisonColumns, frozenSnapshot, selCodeIds, selectedAnnotations]);

  const documentComparisonRows = useMemo(() => {
    if (frozenSnapshot?.frozenDocumentRows) return frozenSnapshot.frozenDocumentRows;
    return documents
      .filter((doc) => selDocIds.size === 0 || selDocIds.has(doc.id))
      .map((doc) => ({
        id: doc.id,
        label: doc.name,
        values: comparisonColumns.map((column) => selectedAnnotations.filter((ann) => ann.createdById === column.id && ann.documentId === doc.id).length),
      }))
      .filter((row) => row.values.some((value) => value > 0) || comparisonColumns.length > 0);
  }, [comparisonColumns, documents, frozenSnapshot, selDocIds, selectedAnnotations]);

  const documentComparisonColumns = useMemo(() => {
    if (frozenSnapshot?.frozenDocumentColumns) return frozenSnapshot.frozenDocumentColumns;
    return comparisonColumns;
  }, [comparisonColumns, frozenSnapshot]);

  function toggleCaseAttributeSelection(attr: AttributeItem) {
    const next = new Set(selCaseAttrIds);
    if (next.has(attr.id)) next.delete(attr.id);
    else next.add(attr.id);
    setSelCaseAttrIds(next);
    if (next.has(attr.id)) {
      setCaseAttributeFilters((prev) => prev[attr.id] ? prev : {
        ...prev,
        [attr.id]: buildDefaultAttributeFilter(attr, caseAttributeValueStats),
      });
    }
  }

  function selectAllCaseAttributes() {
    setSelCaseAttrIds(new Set(caseAttributeItems.map((item) => item.id)));
    setCaseAttributeFilters((prev) => {
      const next = { ...prev };
      for (const item of caseAttributeItems) {
        if (!next[item.id]) next[item.id] = buildDefaultAttributeFilter(item, caseAttributeValueStats);
      }
      return next;
    });
  }

  function clearCaseAttributeSelections() {
    setSelCaseAttrIds(new Set());
  }

  function updateCaseAttributeFilter(attrId: string, updates: AttributeFilterConfig) {
    setCaseAttributeFilters((prev) => ({
      ...prev,
      [attrId]: {
        ...prev[attrId],
        ...updates,
      },
    }));
  }

  function renderAttributeFilterEditors(
    items: AttributeItem[],
    selectedIds: Set<string>,
    filters: Record<string, AttributeFilterConfig>,
    stats: Map<string, { textValues: string[]; minNumber: number | null; maxNumber: number | null; minDate: number | null; maxDate: number | null }>,
    onUpdate: (attrId: string, updates: AttributeFilterConfig) => void,
  ) {
    const selectedItems = items.filter((item) => selectedIds.has(item.id));
    if (selectedItems.length === 0) return null;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "0 14px 14px" }}>
        {selectedItems.map((item) => {
          const stat = stats.get(item.id);
          const filter = filters[item.id] ?? {};
          if (item.dataType === "number") {
            return (
              <div key={item.id} style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: 12, background: "var(--color-surface-alt)" }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{item.name}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <label className="form-label" style={{ margin: 0 }}>
                    Min
                    <input className="form-input" type="number" value={filter.min ?? ""} disabled={isFrozen} min={stat?.minNumber ?? undefined} max={stat?.maxNumber ?? undefined} onChange={(e) => onUpdate(item.id, { min: e.target.value })} />
                  </label>
                  <label className="form-label" style={{ margin: 0 }}>
                    Max
                    <input className="form-input" type="number" value={filter.max ?? ""} disabled={isFrozen} min={stat?.minNumber ?? undefined} max={stat?.maxNumber ?? undefined} onChange={(e) => onUpdate(item.id, { max: e.target.value })} />
                  </label>
                </div>
              </div>
            );
          }
          if (item.dataType === "datetime") {
            return (
              <div key={item.id} style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: 12, background: "var(--color-surface-alt)" }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{item.name}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <label className="form-label" style={{ margin: 0 }}>
                    After
                    <input className="form-input" type="datetime-local" value={filter.min ?? ""} disabled={isFrozen} onChange={(e) => onUpdate(item.id, { min: e.target.value })} />
                  </label>
                  <label className="form-label" style={{ margin: 0 }}>
                    Before
                    <input className="form-input" type="datetime-local" value={filter.max ?? ""} disabled={isFrozen} onChange={(e) => onUpdate(item.id, { max: e.target.value })} />
                  </label>
                </div>
              </div>
            );
          }
          const selectedValues = filter.selectedValues ?? stat?.textValues ?? [];
          return (
            <div key={item.id} style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: 12, background: "var(--color-surface-alt)" }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{item.name}</div>
              {!stat || stat.textValues.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>No values are available for this attribute yet.</div>
              ) : (
                <div style={{ display: "grid", gap: 6 }}>
                  {stat.textValues.map((value) => (
                    <label key={`${item.id}-${value}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={selectedValues.includes(value)}
                        disabled={isFrozen}
                        onChange={(e) => {
                          const nextValues = new Set(selectedValues);
                          if (e.target.checked) nextValues.add(value);
                          else nextValues.delete(value);
                          onUpdate(item.id, { selectedValues: [...nextValues] });
                        }}
                      />
                      <span>{value}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  const selectedCoderLabels = coderItems.filter((item) => selCoderIds.has(item.id)).map((item) => item.name).join(", ") || "No coders selected";
  const caseFilterDetails = allCaseItems
    .filter((item) => (effectiveCaseIds ?? new Set<string>()).has(item.id))
    .map((item) => item.name);
  const reportLabel = REPORT_LABELS[reportKind];
  const createdBy = row?.createdByName || currentUser?.name || currentUser?.email || "-";

  function currentSettings(): CoderReportSettings {
    return {
      kind: reportKind,
      caseIds: [...selCaseIds],
      coderIds: [...selCoderIds],
      documentIds: [...selDocIds],
      codeIds: [...selCodeIds],
      caseAttributeIds: [...selCaseAttrIds],
      caseAttributeFilters,
    };
  }

  function buildSnapshot(): CoderReportSnapshot {
    return {
      reportType: "coder-report",
      kind: reportKind,
      settings: currentSettings(),
      caseItems: allCaseItems,
      coderItems,
      caseAttributeItems,
      caseDocumentLinks,
      caseAttributeValues,
      documents: documents
        .filter((doc) => selDocIds.has(doc.id))
        .map((doc) => ({ ...doc, content: "", filePath: "" })),
      codes: codes.map((code) => ({ ...code, description: "" })),
      frozenSummaryRows: summaryRows,
      frozenProjectLogRows: reportKind === "activity" ? projectLogRows : undefined,
      frozenComparisonSummary: reportKind === "comparison" ? comparisonSummary : undefined,
      frozenCodeUsageRows: reportKind === "comparison" ? codeUsageRows : undefined,
      frozenCodeUsageColumns: reportKind === "comparison" ? comparisonColumns : undefined,
      frozenDocumentRows: reportKind === "comparison" ? documentComparisonRows : undefined,
      frozenDocumentColumns: reportKind === "comparison" ? documentComparisonColumns : undefined,
    };
  }

  async function handleSave() {
    if (!canStartReports) return;
    if (!activeProject || isFrozen) return;
    setSaving(true);
    setError(null);
    try {
      const reportName = name.trim() || `${reportLabel} Report`;
      const snapshot = buildSnapshot();
      const record = await createCoderReport({
        name: reportName,
        coderIds: relationPreview(snapshot.settings.coderIds),
        caseIds: relationPreview(snapshot.settings.caseIds),
        documentIds: relationPreview(snapshot.settings.documentIds),
        codeIds: relationPreview(snapshot.settings.codeIds),
        createdBy: currentUser?.id,
        snapshot: JSON.stringify(snapshot),
      });
      if (!record) throw new Error("Failed to save report.");
      onSaved?.({
        id: record.id,
        name: record.name || reportName,
        createdByName: currentUser?.name || currentUser?.email || "-",
        createdAt: record.created,
        snapshot,
      });
    } catch (e) {
      console.error(e);
      setError(getPocketBaseErrorMessage(e));
      setSaving(false);
    }
  }

  return (
    <div className="annotate-view">
      <div className="annotate-back-bar" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 10 }}>
        <button className="btn" onClick={onBack}>Back to Reports</button>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {error && <span style={{ fontSize: 12, color: "var(--color-danger)" }}>{error}</span>}
          {isFrozen ? (
            canStartReports ? (
            <button className="btn btn--primary" onClick={() => onUseSettings?.(frozenSnapshot!.settings)}>
              New Report From Settings
            </button>
            ) : null
          ) : (
            <button className="btn btn--primary" onClick={handleSave} disabled={saving || !canStartReports}>
              {saving ? "Saving..." : "Save"}
            </button>
          )}
        </div>
      </div>

      <div className={`annotate-layout${reportKind === "activity" ? " ann-report-annotate-layout" : ""}`}>
        <div
          className="annotate-left"
          style={reportKind === "activity" ? { display: "flex", flexDirection: "column", justifyContent: "center" } : undefined}
        >
          <CoderSelectionPanel
            coders={loadingFilters ? [] : coderItems}
            selectedIds={selCoderIds}
            onChange={setSelCoderIds}
            disabled={isFrozen}
          />
          {loadingFilters && (
            <div className="annotate-card" style={{ flexShrink: 0 }}>
              <div style={{ padding: 14, fontSize: 13, color: "var(--color-text-muted)" }}>Loading...</div>
            </div>
          )}
        </div>

        <div
          className={reportKind === "activity" ? "annotate-main" : "annotate-center"}
          style={reportKind === "activity" ? { gap: 10, paddingTop: 2, paddingBottom: 2, overflowY: "auto" } : undefined}
        >
          <div className="annotate-card" style={{ flexShrink: 0 }}>
            <div className="annotate-card-header">
              <span className="annotate-card-title">Report Title</span>
            </div>
            <div style={{ padding: 14 }}>
              <input
                className="input"
                value={name}
                disabled={isFrozen}
                onChange={(e) => setName(e.target.value)}
                style={{ width: "100%" }}
              />
            </div>
          </div>

          <div className="annotate-card" style={{ flexShrink: 0 }}>
            <div className="annotate-card-header">
              <span className="annotate-card-title">Details</span>
            </div>
            <div style={{ padding: 14, display: "grid", gap: 8, fontSize: 13 }}>
              <div><strong>Type:</strong> {reportLabel}</div>
              <div><strong>Created by:</strong> {createdBy}</div>
              <div><strong>Created:</strong> {row ? fmtDate(row.createdAt) : fmtDate(new Date().toISOString())}</div>
              <div><strong>Cases:</strong> {caseFilterDetails.length > 0 ? caseFilterDetails.join(", ") : "All cases"}</div>
              <div><strong>Coders:</strong> {selectedCoderLabels}</div>
            </div>
          </div>

          {(reportKind === "activity" || reportKind === "comparison") && (
            <div className="annotate-card" style={{ flexShrink: 0 }}>
              <div className="annotate-card-header">
                <span className="annotate-card-title">{reportKind === "comparison" ? "Coder Metrics" : reportLabel}</span>
              </div>
              <div className="users-table-wrap" style={{ margin: 0, maxWidth: "none", borderRadius: 0, maxHeight: 320 }}>
                <table className="users-table">
                  {reportKind === "activity" ? (
                    <>
                      <thead>
                        <tr>
                          <th className="users-th">Metric</th>
                          {summaryRows.map((summary) => (
                            <th key={summary.coderId} className="users-th">{summary.coderName}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {summaryRows.length === 0 ? (
                          <tr><td colSpan={2} className="users-td-msg">Select coders to build the report.</td></tr>
                        ) : (
                          <>
                            <tr className="users-row">
                              <td className="users-td users-td--name">Annotations</td>
                              {summaryRows.map((summary) => (
                                <td key={`${summary.coderId}-annotations`} className="users-td">{summary.annotations}</td>
                              ))}
                            </tr>
                            <tr className="users-row">
                              <td className="users-td users-td--name">Documents</td>
                              {summaryRows.map((summary) => (
                                <td key={`${summary.coderId}-documents`} className="users-td">{summary.documents}</td>
                              ))}
                            </tr>
                            <tr className="users-row">
                              <td className="users-td users-td--name">Codes</td>
                              {summaryRows.map((summary) => (
                                <td key={`${summary.coderId}-codes`} className="users-td">{summary.codes}</td>
                              ))}
                            </tr>
                            <tr className="users-row">
                              <td className="users-td users-td--name">Last Coded</td>
                              {summaryRows.map((summary) => (
                                <td key={`${summary.coderId}-last-coded`} className="users-td users-td--muted">{fmtDate(summary.lastCodedAt)}</td>
                              ))}
                            </tr>
                          </>
                        )}
                      </tbody>
                    </>
                  ) : (
                    <>
                      <thead>
                        <tr>
                          <th className="users-th">Coder</th>
                          <th className="users-th">Annotations</th>
                          <th className="users-th">Documents</th>
                          <th className="users-th">Codes</th>
                          <th className="users-th">Last Coded</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summaryRows.length === 0 ? (
                          <tr><td colSpan={5} className="users-td-msg">Select coders to build the report.</td></tr>
                        ) : summaryRows.map((summary) => (
                          <tr key={summary.coderId} className="users-row">
                            <td className="users-td users-td--name">{summary.coderName}</td>
                            <td className="users-td">{summary.annotations}</td>
                            <td className="users-td">{summary.documents}</td>
                            <td className="users-td">{summary.codes}</td>
                            <td className="users-td users-td--muted">{fmtDate(summary.lastCodedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </>
                  )}
                </table>
              </div>
            </div>
          )}

          {reportKind === "activity" && (
            <>
              <CoderActivityOverTimeCard rows={projectLogRows} />
              <CoderProjectLogCard rows={projectLogRows} />
            </>
          )}

          {reportKind === "comparison" && (
            <>
              <ComparisonSummaryCard stats={comparisonSummary} />
              <ComparisonMatrixCard
                title="Code Usage Matrix"
                rows={codeUsageRows}
                columns={comparisonColumns}
              />
              <ComparisonMatrixCard
                title="Document Comparison Matrix"
                rows={documentComparisonRows}
                columns={documentComparisonColumns}
              />
            </>
          )}
        </div>

        {reportKind !== "activity" && (
        <div className="annotate-right">
          <SelectionPanel
            title="Documents"
            count={selDocIds.size}
            collapsed={false}
            onToggleCollapsed={() => {}}
            selectAll={{
              checked: documents.length > 0 && selDocIds.size === documents.length,
              disabled: isFrozen || documents.length === 0,
              onToggle: () => !isFrozen && toggleAll(documents, selDocIds, setSelDocIds),
            }}
            disabled={isFrozen}
          >
            <ul className="code-list">
              {documents.length === 0 ? (
                <li className="code-list-empty">No documents.</li>
              ) : documents.map((doc) => (
                <li key={doc.id} className="code-item" style={{ cursor: isFrozen ? "default" : "pointer" }} onClick={() => !isFrozen && toggleSet(selDocIds, setSelDocIds, doc.id)}>
                  <input
                    type="checkbox"
                    className="memo-sel-checkbox"
                    checked={selDocIds.has(doc.id)}
                    disabled={isFrozen}
                    onChange={(e) => { e.stopPropagation(); if (!isFrozen) toggleSet(selDocIds, setSelDocIds, doc.id); }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="code-label">{doc.name}</span>
                </li>
              ))}
            </ul>
          </SelectionPanel>

          <SelectionPanel
            title="Codes"
            count={selCodeIds.size}
            collapsed={false}
            onToggleCollapsed={() => {}}
            selectAll={{
              checked: codes.length > 0 && selCodeIds.size === codes.length,
              disabled: isFrozen || codes.length === 0,
              onToggle: () => !isFrozen && toggleAll(codes, selCodeIds, setSelCodeIds),
            }}
            disabled={isFrozen}
          >
            <ul className="code-list">
              {codes.length === 0 ? (
                <li className="code-list-empty">No codes.</li>
              ) : codes.map((code) => (
                <li key={code.id} className="code-item" style={{ cursor: isFrozen ? "default" : "pointer" }} onClick={() => !isFrozen && toggleSet(selCodeIds, setSelCodeIds, code.id)}>
                  <input
                    type="checkbox"
                    className="memo-sel-checkbox"
                    checked={selCodeIds.has(code.id)}
                    disabled={isFrozen}
                    onChange={(e) => { e.stopPropagation(); if (!isFrozen) toggleSet(selCodeIds, setSelCodeIds, code.id); }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="code-swatch" style={{ background: code.color }} />
                  <span className="code-label">{code.label}</span>
                </li>
              ))}
            </ul>
          </SelectionPanel>
        </div>
        )}
      </div>

      {showCaseAttributeFilters && (
        <div className="modal-overlay" onClick={() => setShowCaseAttributeFilters(false)} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "var(--color-bg)", padding: 24, borderRadius: 8, minWidth: 320, maxWidth: 820, width: "min(820px, calc(100vw - 32px))", maxHeight: "calc(100vh - 48px)", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
              <h2 style={{ margin: 0 }}>Filter Cases by Attributes</h2>
              <button className="btn" onClick={() => setShowCaseAttributeFilters(false)}>Close</button>
            </div>
            {!isFrozen && !loadingFilters && caseAttributeItems.length > 0 && (
              <div style={{ paddingBottom: 8, display: "flex", gap: 8 }}>
                <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={selectAllCaseAttributes}>All</button>
                <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={clearCaseAttributeSelections}>Clear</button>
              </div>
            )}
            <ul className="code-list">
              {loadingFilters ? (
                <li className="code-list-empty">Loading...</li>
              ) : caseAttributeItems.length === 0 ? (
                <li className="code-list-empty">No case attributes.</li>
              ) : caseAttributeItems.map((item) => (
                <li
                  key={item.id}
                  className="code-item"
                  style={{ cursor: isFrozen ? "default" : "pointer" }}
                  onClick={isFrozen ? undefined : () => toggleCaseAttributeSelection(item)}
                >
                  <input
                    type="checkbox"
                    className="memo-sel-checkbox"
                    checked={selCaseAttrIds.has(item.id)}
                    disabled={isFrozen}
                    onChange={isFrozen ? undefined : (e) => {
                      e.stopPropagation();
                      toggleCaseAttributeSelection(item);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="code-label">{item.name}</span>
                  <span className="users-filter-count">{item.dataType === "datetime" ? "Date/time" : item.dataType}</span>
                </li>
              ))}
            </ul>
            {renderAttributeFilterEditors(
              caseAttributeItems,
              selCaseAttrIds,
              caseAttributeFilters,
              caseAttributeValueStats,
              updateCaseAttributeFilter,
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ReportsUsersView() {
  const { activeProject, pb, canCurrentUser, deleteCoderReport } = useStore();
  const canCreateReports = canCurrentUser("createReports") && canCurrentUser("editReportConfiguration");
  const canDeleteReports = canCurrentUser("deleteReports");

  const [showNewModal, setShowNewModal] = useState(false);
  const [newReportKind, setNewReportKind] = useState<CoderReportKind | null>(null);
  const [openSavedRow, setOpenSavedRow] = useState<CoderReportRow | null>(null);
  const [newFromSettings, setNewFromSettings] = useState<CoderReportSettings | null>(null);
  const [rows, setRows] = useState<CoderReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<CoderReportSortCol>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; row: CoderReportRow } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CoderReportRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuStyle = useViewportContextMenuStyle(contextMenu, contextMenuRef);

  const loadReports = useCallback(async () => {
    if (!activeProject || !pb) return [];
    setLoading(true);
    setError(null);
    try {
      const records = await pb.collection("coder_reports").getFullList({
        filter: `project="${activeProject.id}"&&deleted_at=""`,
        expand: "created_by",
        sort: "-created",
      });
      const mappedRows = records
        .map((record) => {
          let snapshot: CoderReportSnapshot | null = null;
          if (record.snapshot) {
            try {
              const parsed = JSON.parse(record.snapshot);
              if (parsed?.reportType === "coder-report") snapshot = parsed as CoderReportSnapshot;
            } catch {
              snapshot = null;
            }
          }
          if (!snapshot) return null;
          const createdBy = record.expand?.created_by;
          return {
            id: record.id,
            name: record.name,
            createdByName: createdBy?.name || createdBy?.email || "-",
            createdAt: record.created,
            snapshot,
          };
        })
        .filter(Boolean) as CoderReportRow[];
      setRows(mappedRows);
      return mappedRows;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load coder reports.");
      return [];
    } finally {
      setLoading(false);
    }
  }, [activeProject, pb]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const sorted = [...rows].sort((a, b) => {
    const aValue = sortCol === "kind" ? REPORT_LABELS[a.snapshot.kind] : String(a[sortCol]);
    const bValue = sortCol === "kind" ? REPORT_LABELS[b.snapshot.kind] : String(b[sortCol]);
    const cmp = aValue.localeCompare(bValue, undefined, { sensitivity: "base" });
    return sortDir === "asc" ? cmp : -cmp;
  });

  function handleSort(col: CoderReportSortCol) {
    if (col === sortCol) setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleteLoading(true);
    try {
      await deleteCoderReport(confirmDelete.id, confirmDelete.name);
      setRows((prev) => prev.filter((row) => row.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete report.");
    } finally {
      setDeleteLoading(false);
    }
  }

  if (newReportKind || newFromSettings) {
    return (
      <CoderReportCreationPage
        kind={newFromSettings?.kind ?? newReportKind ?? "activity"}
        initialSettings={newFromSettings ?? undefined}
        onBack={() => { setNewReportKind(null); setNewFromSettings(null); }}
        onSaved={(row) => {
          setNewReportKind(null);
          setNewFromSettings(null);
          setRows((prev) => [row, ...prev.filter((item) => item.id !== row.id)]);
          setOpenSavedRow(row);
        }}
      />
    );
  }

  if (openSavedRow) {
    return (
      <CoderReportCreationPage
        kind={openSavedRow.snapshot.kind}
        row={openSavedRow}
        onBack={() => setOpenSavedRow(null)}
        onUseSettings={(settings) => {
          setOpenSavedRow(null);
          setNewFromSettings(settings);
        }}
      />
    );
  }

  return (
    <div className="view users-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>User Reports</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            aria-label="Show user reports help"
            title="Show Help"
            onClick={() => setHelpOpen(true)}
          >
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
        <button
          className="btn btn--primary"
          onClick={() => setShowNewModal(true)}
          disabled={!canCreateReports}
          title={!canCreateReports ? "You do not have permission to create user reports" : undefined}
        >
          + New Report
        </button>
      </header>

      {error && <div className="settings-error">{error}</div>}

      <div className="users-content">
        <section className="users-layout-main">
          <div className="users-table-wrap">
            <table className="users-table">
              <thead>
                <tr>
                  {REPORT_COLS.map((col) => (
                    <th
                      key={col.key}
                      style={{ width: col.width }}
                      className="users-th users-th--sortable"
                      onClick={() => handleSort(col.key)}
                    >
                      {col.label}
                      <span className="users-sort-icon">{sortCol === col.key ? (sortDir === "asc" ? " ↑" : " ↓") : " ↕"}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={4} className="users-td-msg">Loading...</td></tr>}
                {!loading && sorted.length === 0 && <tr><td colSpan={4} className="users-td-msg">No reports yet.</td></tr>}
                {!loading && sorted.map((row) => (
                  <tr
                    key={row.id}
                    className="users-row"
                    onClick={() => setOpenSavedRow(row)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, row });
                    }}
                  >
                    <td className="users-td users-td--name">{row.name}</td>
                    <td className="users-td users-td--muted">{REPORT_LABELS[row.snapshot.kind]}</td>
                    <td className="users-td users-td--muted">{row.createdByName}</td>
                    <td className="users-td users-td--muted">{fmtDate(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal modal--help" onClick={(e) => e.stopPropagation()}>
            <h2>User Reports Help</h2>
            <p className="users-guide-copy">
              Create or open a user report, compare coding by user, review report sections, and delete a report when permitted.
            </p>
            <p className="users-guide-copy">
              Use user reports to compare how different collaborators are coding across the project. Open a report or create a new one, then inspect the comparative output.
            </p>
            <p className="users-guide-copy">
              Report creation and deletion depend on your role. Reports summarize existing project activity rather than changing it.
            </p>
            <div className="form-actions">
              <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <div ref={contextMenuRef} className="context-menu" style={contextMenuStyle}>
          <button className="context-menu-item" onClick={() => { setOpenSavedRow(contextMenu.row); setContextMenu(null); }}>Open Report</button>
          {canDeleteReports ? (
            <button className="context-menu-item context-menu-item--danger" onClick={() => { setConfirmDelete(contextMenu.row); setContextMenu(null); }}>Delete Report</button>
          ) : (
            <div className="context-menu-item context-menu-item--disabled" title="You do not have permission to delete reports">Delete Report</div>
          )}
        </div>
      )}

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Delete Report</h2>
            <p>Delete "{confirmDelete.name}"?</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setConfirmDelete(null)} disabled={deleteLoading}>Cancel</button>
              <button className="btn btn--danger" onClick={handleDelete} disabled={deleteLoading}>
                {deleteLoading ? "Deleting..." : "Delete Report"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showNewModal && (
        <NewCoderReportModal
          onClose={() => setShowNewModal(false)}
          onSelect={(selectedKind) => {
            setShowNewModal(false);
            setNewReportKind(selectedKind);
          }}
        />
      )}
    </div>
  );
}
