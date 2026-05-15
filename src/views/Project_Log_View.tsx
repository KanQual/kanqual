import { useState } from "react";
import { useStore } from "../context/StoreContext";
import helpIcon from "../assets/ic_help_outline_24px.svg";
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
  "member.add":          "Member added",
  "member.update":       "Member updated",
  "member.remove":       "Member removed",
  "member.reassociate":  "Imported member reassociated",
  "member.remove_unresolved": "Imported member removed",
};

export function formatProjectLogDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString([], {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

export function projectLogActionCategory(action: string): string {
  if (action.startsWith("project.") || action.startsWith("member.") || action.startsWith("ai_assist.")) return "project";
  if (action.startsWith("case.") || action.startsWith("case_attribute.")) return "case";
  if (action.startsWith("document.") || action.startsWith("document_attribute.")) return "document";
  if (action.startsWith("code.") || action.startsWith("codebook.")) return "code";
  if (action.startsWith("annotation.")) return "annotation";
  if (action.startsWith("memo.")) return "memo";
  if (action.includes("_report.")) return "report";
  return "other";
}

export function projectLogAccessModeLabel(mode?: "local" | "remote"): string {
  if (mode === "local") return "Local";
  if (mode === "remote") return "Remote";
  return "-";
}

export function ProjectLogTable() {
  const { logEntries } = useStore();

  const sorted = [...logEntries].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
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
          </tr>
        </thead>
        <tbody>
          {sorted.map((entry: ProjectLogEntry) => {
            return (
              <tr key={entry.id} className={`log-row log-row--${projectLogActionCategory(entry.action)}`}>
                <td className="log-cell log-cell--time">{formatProjectLogDateTime(entry.occurredAt)}</td>
                <td className="log-cell log-cell--user">{entry.userName || "-"}</td>
                <td className="log-cell log-cell--user">{projectLogAccessModeLabel(entry.accessMode)}</td>
                <td className="log-cell log-cell--action">
                  <span className={`log-badge log-badge--${projectLogActionCategory(entry.action)}`}>
                    {PROJECT_LOG_ACTION_LABELS[entry.action] ?? entry.action}
                  </span>
                </td>
                <td className="log-cell log-cell--label">{entry.label}</td>
              </tr>
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
              <img src={helpIcon} alt="" className="users-help-icon" />
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
                  <li>The project-log export feature, access-mode recording, and shared project activity logging all affect what you see here.</li>
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
