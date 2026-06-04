import { Fragment, useMemo, useState } from "react";
import { useStore } from "../context/StoreContext";
import { HelpIcon } from "../components/AppIcons";
import type { ProjectLogEntry } from "../types";

export const PROJECT_LOG_ACTION_LABELS: Record<string, string> = {
  "project.create":      "Project created",
  "project.open":        "Project opened",
  "project.close":       "Project left",
  "project.update":      "Project updated",
  "project.export":      "Project exported",
  "project.encrypted_backup.export": "Encrypted project backup exported",
  "project.log.export":  "Project log exported",
  "project.import":      "Project imported",
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
  "project.ai_processed_document.export": "Processed document exported",
  "project_uploaded_file.create": "Retained source file created",
  "project_uploaded_file.status": "Retained source file updated",
  "codebook.export":     "Codebook exported",
  "codebook.import":     "Codebook imported",
  "ai_assist.index":     "AI Assist embeddings built",
  "ai_assist.reindex":   "AI Assist embeddings rebuilt",
  "document.create":     "Document added",
  "document.update":     "Document updated",
  "document.delete":     "Document deleted",
  "document.restore":    "Document restored",
  "document.associations": "Document associations updated",
  "code.create":         "Code added",
  "code.update":         "Code updated",
  "code.delete":         "Code deleted",
  "code.restore":        "Code restored",
  "annotation.create":   "Annotation added",
  "annotation.update":   "Annotation updated",
  "annotation.delete":   "Annotation deleted",
  "annotation.restore":  "Annotation restored",
  "case.create":         "Case created",
  "case.update":         "Case updated",
  "case.delete":         "Case deleted",
  "case.restore":        "Case restored",
  "case.associations":   "Case associations updated",
  "case_attribute.create": "Case attribute added",
  "case_attribute.update": "Case attribute updated",
  "case_attribute.delete": "Case attribute deleted",
  "document_attribute.create": "Document attribute added",
  "document_attribute.update": "Document attribute updated",
  "document_attribute.delete": "Document attribute deleted",
  "memo.create":         "Memo created",
  "memo.update":         "Memo updated",
  "memo.delete":         "Memo deleted",
  "memo.restore":        "Memo restored",
  "code_report.create":  "Report created",
  "code_report.update":  "Report updated",
  "code_report.delete":  "Report deleted",
  "code_report.restore": "Report restored",
  "coder_report.create": "Coder report created",
  "coder_report.update": "Coder report updated",
  "coder_report.delete": "Coder report deleted",
  "coder_report.restore": "Coder report restored",
  "ai_analysis.create": "AI analysis created",
  "ai_analysis.update": "AI analysis updated",
  "ai_analysis.delete": "AI analysis deleted",
  "ai_attribute_suggestion_run.create": "Saved suggestions created",
  "ai_attribute_suggestion_run.update": "Saved suggestions updated",
  "ai_attribute_suggestion_run.delete": "Saved suggestions deleted",
  "member.add":          "Member added",
  "member.update":       "Member updated",
  "member.remove":       "Member removed",
  "member.reassociate":  "Imported member reassociated",
  "member.remove_unresolved": "Imported member removed",
};

type ProjectLogDetails = Record<string, unknown>;

export function formatProjectLogDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString([], {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

export function projectLogActionCategory(action: string): string {
  if (
    action.startsWith("project.")
    || action.startsWith("member.")
    || action.startsWith("ai_assist.")
    || action.startsWith("project_uploaded_file.")
  ) return "project";
  if (action.startsWith("case.") || action.startsWith("case_attribute.")) return "case";
  if (action.startsWith("document.") || action.startsWith("document_attribute.")) return "document";
  if (action.startsWith("code.") || action.startsWith("codebook.")) return "code";
  if (action.startsWith("annotation.")) return "annotation";
  if (action.startsWith("memo.")) return "memo";
  if (
    action.includes("_report.")
    || action.startsWith("ai_analysis.")
    || action.startsWith("ai_attribute_suggestion_run.")
  ) return "report";
  return "other";
}

export function projectLogAccessModeLabel(mode?: "local" | "remote"): string {
  if (mode === "local") return "Local";
  if (mode === "remote") return "Remote";
  return "-";
}

function parseProjectLogDetails(detailsJson?: string): ProjectLogDetails | null {
  if (!detailsJson?.trim()) return null;
  try {
    const parsed = JSON.parse(detailsJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as ProjectLogDetails;
  } catch {
    return null;
  }
}

function formatDetailKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (char) => char.toUpperCase());
}

function formatDetailValue(value: unknown): { text: string; multiline: boolean } {
  if (value == null) return { text: "-", multiline: false };
  if (typeof value === "string") return { text: value || "-", multiline: value.includes("\n") };
  if (typeof value === "number" || typeof value === "boolean") return { text: String(value), multiline: false };
  if (Array.isArray(value)) {
    if (value.length === 0) return { text: "[]", multiline: false };
    const hasComplexValue = value.some((item) => item && typeof item === "object");
    if (hasComplexValue) {
      return { text: JSON.stringify(value, null, 2), multiline: true };
    }
    return { text: value.map((item) => String(item)).join(", "), multiline: value.length > 4 };
  }
  return { text: JSON.stringify(value, null, 2), multiline: true };
}

function summarizeProjectLogDetails(action: string, details: ProjectLogDetails): string {
  const pieces: string[] = [];
  const push = (text?: string | null) => {
    if (text && text.trim()) pieces.push(text.trim());
  };

  if (typeof details.previousRole === "string" && typeof details.nextRole === "string") {
    push(`Role changed from ${details.previousRole} to ${details.nextRole}.`);
  }

  if (typeof details.backupKind === "string") {
    push(`${details.backupKind[0].toUpperCase()}${details.backupKind.slice(1)} backup.`);
  }

  if (typeof details.targetKind === "string") {
    push(`Target: ${details.targetKind}.`);
  }

  if (typeof details.attributeName === "string" && details.attributeName) {
    push(`Attribute: ${details.attributeName}.`);
  }

  if (typeof details.codeId === "string" && details.codeId) {
    push(`Code ID: ${details.codeId}.`);
  }

  if (Array.isArray(details.changedFields) && details.changedFields.length > 0) {
    push(`Changed: ${details.changedFields.join(", ")}.`);
  }

  if (typeof details.changedValueCount === "number") {
    push(`${details.changedValueCount} value${details.changedValueCount === 1 ? "" : "s"} updated.`);
  }

  if (typeof details.caseCount === "number") {
    push(`${details.caseCount} case${details.caseCount === 1 ? "" : "s"}.`);
  }
  if (typeof details.documentCount === "number") {
    push(`${details.documentCount} document${details.documentCount === 1 ? "" : "s"}.`);
  }
  if (typeof details.codeCount === "number") {
    push(`${details.codeCount} code${details.codeCount === 1 ? "" : "s"}.`);
  }
  if (typeof details.coderCount === "number") {
    push(`${details.coderCount} coder${details.coderCount === 1 ? "" : "s"}.`);
  }

  if (typeof details.backupCount === "number" && action === "project.backup.settings") {
    push(`${details.backupCount} backup${details.backupCount === 1 ? "" : "s"} currently retained.`);
  }

  if (typeof details.importedUsersCount === "number") {
    push(`${details.importedUsersCount} imported user${details.importedUsersCount === 1 ? "" : "s"}.`);
  }

  if (typeof details.requiresUserResolution === "boolean") {
    push(details.requiresUserResolution ? "User resolution required." : "No user resolution required.");
  }

  if (typeof details.sizeBytes === "number" && details.sizeBytes > 0) {
    const sizeKb = details.sizeBytes / 1024;
    push(sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB.` : `${sizeKb.toFixed(1)} KB.`);
  }

  if (typeof details.model === "string" && details.model) {
    push(`Model: ${details.model}.`);
  }

  if (typeof details.usedContextItemCount === "number") {
    push(`${details.usedContextItemCount} context item${details.usedContextItemCount === 1 ? "" : "s"}.`);
  }

  if (typeof details.responseCharCount === "number") {
    push(`${details.responseCharCount} response characters.`);
  }

  if (typeof details.messageCharCount === "number") {
    push(`${details.messageCharCount} prompt characters.`);
  }

  if (pieces.length > 0) {
    return pieces.join(" ");
  }

  if (typeof details.entityType === "string") {
    return `Structured details recorded for ${details.entityType.replace(/_/g, " ")}.`;
  }

  return "Structured details available.";
}

function ProjectLogDetailsPanel({ details }: { details: ProjectLogDetails }) {
  const entries = Object.entries(details);

  if (entries.length === 0) {
    return <p className="log-details-empty">No structured details recorded.</p>;
  }

  return (
    <div className="log-details-panel">
      <div className="log-details-grid">
        {entries.map(([key, value]) => {
          const formatted = formatDetailValue(value);
          return (
            <div key={key} className="log-details-item">
              <div className="log-details-key">{formatDetailKey(key)}</div>
              {formatted.multiline ? (
                <pre className="log-details-value log-details-value--multiline">{formatted.text}</pre>
              ) : (
                <div className="log-details-value">{formatted.text}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ProjectLogTable() {
  const { logEntries } = useStore();
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const sorted = useMemo(
    () => [...logEntries].sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    ),
    [logEntries],
  );

  if (sorted.length === 0) {
    return (
      <div className="empty-state">
        <p>No activity recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="project-log-table-wrap">
      <table className="project-log-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>User</th>
            <th>Access</th>
            <th>Category</th>
            <th>Description</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((entry: ProjectLogEntry) => {
            const details = parseProjectLogDetails(entry.detailsJson);
            const isExpanded = Boolean(expandedIds[entry.id]);
            const summary = details ? summarizeProjectLogDetails(entry.action, details) : "";
            return (
              <Fragment key={entry.id}>
                <tr className={`log-row log-row--${projectLogActionCategory(entry.action)}`}>
                  <td className="log-cell log-cell--time">{formatProjectLogDateTime(entry.occurredAt)}</td>
                  <td className="log-cell log-cell--user">{entry.userName || "-"}</td>
                  <td className="log-cell log-cell--user">{projectLogAccessModeLabel(entry.accessMode)}</td>
                  <td className="log-cell log-cell--action">
                    <span className={`log-badge log-badge--${projectLogActionCategory(entry.action)}`}>
                      {PROJECT_LOG_ACTION_LABELS[entry.action] ?? entry.action}
                    </span>
                  </td>
                  <td className="log-cell log-cell--label">
                    <div>{entry.label}</div>
                    {summary && <div className="log-inline-summary">{summary}</div>}
                  </td>
                  <td className="log-cell log-cell--details-toggle">
                    {details ? (
                      <button
                        type="button"
                        className="btn btn--xs log-details-toggle"
                        onClick={() =>
                          setExpandedIds((prev) => ({
                            ...prev,
                            [entry.id]: !prev[entry.id],
                          }))
                        }
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? "Hide" : "View"}
                      </button>
                    ) : (
                      <span className="log-details-none">-</span>
                    )}
                  </td>
                </tr>
                {details && isExpanded && (
                  <tr className="log-details-row">
                    <td className="log-cell log-cell--details" colSpan={6}>
                      <ProjectLogDetailsPanel details={details} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ProjectLogView() {
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <div className="view project-log-view">
      <header className="view-header">
        <div>
          <div className="view-title-with-help">
            <h1>Project Log</h1>
            <button type="button" className="users-help-icon-btn" onClick={() => setHelpOpen(true)} aria-label="Open project log help">
              <HelpIcon className="users-help-icon" />
            </button>
          </div>
        </div>
      </header>

      <ProjectLogTable />

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal modal--help" onClick={(e) => e.stopPropagation()}>
            <h2>Project Log Help</h2>
            <div className="app-settings-modal-body">
              <p className="settings-section-desc">
                Review activity history, inspect who acted, when, and from local or remote access, read descriptive labels, and export the log from Project Settings if needed.
              </p>
              <ul className="settings-help-list">
                <li>Use the Project Log to audit important project events by time, user, access mode, and action category.</li>
                <li>The log records many project, backup, import, restore, AI, and management events, but not every UI click.</li>
                <li>Use the details buttons to inspect structured metadata such as affected record ids, changed fields, backup context, and AI job context.</li>
              </ul>
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setHelpOpen(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
