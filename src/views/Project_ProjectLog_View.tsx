import { useState } from "react";
import { useStore } from "../context/StoreContext";
import type { ProjectLogEntry } from "../types";

const ACTION_LABELS: Record<string, string> = {
  "project.create":      "Project created",
  "project.open":        "Project opened",
  "project.close":       "Project left",
  "project.update":      "Project updated",
  "project.export":      "Project exported",
  "project.import":      "Project imported",
  "codebook.export":     "Codebook exported",
  "codebook.import":     "Codebook imported",
  "document.create":     "Document added",
  "document.update":     "Document updated",
  "document.delete":     "Document deleted",
  "document.restore":    "Document restored",
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
  "case_attribute.create": "Case attribute added",
  "case_attribute.update": "Case attribute updated",
  "case_attribute.delete": "Case attribute deleted",
  "memo.create":         "Memo created",
  "memo.update":         "Memo updated",
  "memo.delete":         "Memo deleted",
  "memo.restore":        "Memo restored",
  "code_report.create":  "Report created",
  "code_report.update":  "Report updated",
  "code_report.delete":  "Report deleted",
  "code_report.restore": "Report restored",
  "document_attribute.create": "Document attribute added",
  "document_attribute.update": "Document attribute updated",
  "document_attribute.delete": "Document attribute deleted",
  "member.add":          "Member added",
  "member.remove":       "Member removed",
};

const RESTORABLE = new Set([
  "document.delete",
  "code.delete",
  "annotation.delete",
  "case.delete",
  "memo.delete",
  "code_report.delete",
]);

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString([], {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function actionCategory(action: string): string {
  return action.split(".")[0];
}

export function ProjectLogView() {
  const { logEntries, activeProject, restoreRecord } = useStore();
  const [restoring, setRestoring] = useState<Set<string>>(new Set());
  const [errors,    setErrors]    = useState<Record<string, string>>({});

  const sorted = [...logEntries].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );

  async function handleRestore(entry: ProjectLogEntry) {
    if (!entry.recordId) return;
    setRestoring((s) => new Set(s).add(entry.id));
    setErrors((e) => { const n = { ...e }; delete n[entry.id]; return n; });
    try {
      await restoreRecord(entry.action, entry.recordId, entry.id);
    } catch {
      setErrors((e) => ({ ...e, [entry.id]: "Restore failed" }));
    } finally {
      setRestoring((s) => { const n = new Set(s); n.delete(entry.id); return n; });
    }
  }

  return (
    <div className="view project-log-view">
      <header className="view-header">
        <h1>Project Log</h1>
        {activeProject && (
          <span className="view-header-sub">{activeProject.name}</span>
        )}
      </header>

      {sorted.length === 0 ? (
        <div className="empty-state">
          <p>No activity recorded yet.</p>
        </div>
      ) : (
        <div className="project-log-table-wrap">
          <table className="project-log-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Category</th>
                <th>Description</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry: ProjectLogEntry) => {
                const canRestore = RESTORABLE.has(entry.action) && !!entry.recordId;
                const isRestoring = restoring.has(entry.id);
                const restoredAt = entry.restoredAt;
                const errMsg      = errors[entry.id];
                return (
                  <tr key={entry.id} className={`log-row log-row--${actionCategory(entry.action)}`}>
                    <td className="log-cell log-cell--time">{fmtDateTime(entry.occurredAt)}</td>
                    <td className="log-cell log-cell--user">{entry.userName || "—"}</td>
                    <td className="log-cell log-cell--action">
                      <span className={`log-badge log-badge--${actionCategory(entry.action)}`}>
                        {ACTION_LABELS[entry.action] ?? entry.action}
                      </span>
                    </td>
                    <td className="log-cell log-cell--label">{entry.label}</td>
                    <td className="log-cell log-cell--restore">
                      {canRestore && !restoredAt && (
                        <button
                          className="btn btn--xs"
                          onClick={() => handleRestore(entry)}
                          disabled={isRestoring}
                          title="Restore this item"
                        >
                          {isRestoring ? "Restoring…" : "Restore"}
                        </button>
                      )}
                      {restoredAt && (
                        <span className="log-restored-badge">Restored {fmtDateTime(restoredAt)}</span>
                      )}
                      {errMsg && (
                        <span className="log-restore-error">{errMsg}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
