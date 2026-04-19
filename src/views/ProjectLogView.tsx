import { useStore } from "../context/StoreContext";
import type { ProjectLogEntry } from "../types";

const ACTION_LABELS: Record<string, string> = {
  "project.create":      "Project created",
  "project.open":        "Project opened",
  "project.close":       "Project left",
  "document.create":     "Document added",
  "document.update":     "Document updated",
  "document.delete":     "Document deleted",
  "code.create":         "Code added",
  "code.update":         "Code updated",
  "code.delete":         "Code deleted",
  "annotation.create":   "Annotation added",
  "annotation.update":   "Annotation updated",
  "annotation.delete":   "Annotation deleted",
  "case.create":         "Case created",
  "case.update":         "Case updated",
  "case.delete":         "Case deleted",
  "memo.create":         "Memo created",
  "memo.update":         "Memo updated",
  "memo.delete":         "Memo deleted",
  "code_report.create":  "Report created",
  "code_report.update":  "Report updated",
  "code_report.delete":  "Report deleted",
  "member.add":          "Member added",
  "member.remove":       "Member removed",
};

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
  const { logEntries, activeProject } = useStore();

  // Entries arrive pre-sorted -occurred_at from the store load; keep that order
  const sorted = [...logEntries].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );

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
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry: ProjectLogEntry) => (
                <tr key={entry.id} className={`log-row log-row--${actionCategory(entry.action)}`}>
                  <td className="log-cell log-cell--time">{fmtDateTime(entry.occurredAt)}</td>
                  <td className="log-cell log-cell--user">{entry.userName || "—"}</td>
                  <td className="log-cell log-cell--action">
                    <span className={`log-badge log-badge--${actionCategory(entry.action)}`}>
                      {ACTION_LABELS[entry.action] ?? entry.action}
                    </span>
                  </td>
                  <td className="log-cell log-cell--label">{entry.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
