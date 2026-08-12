import { Fragment, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { HelpIcon } from "../components/AppIcons";
import {
  POSTGRES_PROJECT_CHANGED_EVENT,
  listPostgresProjectLog,
  type PostgresProjectChangeEvent,
  type PostgresProjectLogEntry,
} from "../lib/postgres";
import { useI18n } from "../i18n/provider";
import {
  formatProjectLogDateTime,
  parseProjectLogDetails,
  projectLogAccessModeLabel,
  projectLogActionCategory,
  projectLogActionLabel,
  projectLogDescriptionLabel,
  ProjectLogDetailsPanel,
  summarizeProjectLogDetails,
} from "./Project_Log_View";

export function PostgresProjectLogView({
  projectId,
}: {
  projectId: string;
}) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<PostgresProjectLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setEntries(await listPostgresProjectLog(projectId));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load the PostgreSQL project log.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    async function subscribe() {
      unlisten = await listen<PostgresProjectChangeEvent>(POSTGRES_PROJECT_CHANGED_EVENT, (event) => {
        if (disposed) return;
        if (event.payload.projectId !== projectId) return;
        void load();
      });
    }

    void subscribe();
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [projectId]);

  const sorted = useMemo(
    () => [...entries].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()),
    [entries],
  );

  return (
    <div className="view project-log-view">
      <header className="view-header">
        <div>
          <div className="view-title-with-help">
            <h1>{t("projectLog.title")}</h1>
            <button type="button" className="users-help-icon-btn" onClick={() => setHelpOpen(true)} aria-label={t("projectLog.openHelp")}>
              <HelpIcon className="users-help-icon" />
            </button>
          </div>
          <p className="view-subtitle">PostgreSQL project activity is now recorded directly in the project database.</p>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      {loading ? (
        <div className="empty-state">
          <p>Loading project log...</p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="empty-state">
          <p>{t("projectLog.empty.noActivity")}</p>
        </div>
      ) : (
        <div className="project-log-table-wrap">
          <table className="project-log-table">
            <thead>
              <tr>
                <th>{t("projectLog.columns.time")}</th>
                <th>{t("projectLog.columns.user")}</th>
                <th>{t("projectLog.columns.access")}</th>
                <th>{t("projectLog.columns.category")}</th>
                <th>{t("projectLog.columns.description")}</th>
                <th>{t("projectLog.columns.details")}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry) => {
                const details = parseProjectLogDetails(entry.detailsJson);
                const isExpanded = Boolean(expandedIds[entry.id]);
                const summary = details ? summarizeProjectLogDetails(entry.action, details, t) : "";
                return (
                  <Fragment key={entry.id}>
                    <tr className={`log-row log-row--${projectLogActionCategory(entry.action)}`}>
                      <td className="log-cell log-cell--time">{formatProjectLogDateTime(entry.occurredAt)}</td>
                      <td className="log-cell log-cell--user">{entry.userName || "-"}</td>
                      <td className="log-cell log-cell--user">{projectLogAccessModeLabel(entry.accessMode, t)}</td>
                      <td className="log-cell log-cell--action">
                        <span className={`log-badge log-badge--${projectLogActionCategory(entry.action)}`}>
                          {projectLogActionLabel(entry.action, t)}
                        </span>
                      </td>
                      <td className="log-cell log-cell--label">
                        <div>{projectLogDescriptionLabel(entry, details, t)}</div>
                        {summary ? <div className="log-inline-summary">{summary}</div> : null}
                      </td>
                      <td className="log-cell log-cell--details-toggle">
                        {details ? (
                          <button
                            type="button"
                            className="btn btn--xs log-details-toggle"
                            onClick={() => setExpandedIds((current) => ({ ...current, [entry.id]: !current[entry.id] }))}
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? t("projectLog.actions.hideDetails") : t("projectLog.actions.viewDetails")}
                          </button>
                        ) : (
                          <span className="log-details-none">-</span>
                        )}
                      </td>
                    </tr>
                    {details && isExpanded ? (
                      <tr className="log-details-row">
                        <td className="log-cell log-cell--details" colSpan={6}>
                          <ProjectLogDetailsPanel details={details} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {helpOpen ? (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal modal--help" onClick={(event) => event.stopPropagation()}>
            <h2>{t("projectLog.help.title")}</h2>
            <div className="app-settings-modal-body">
              <p className="settings-section-desc">{t("projectLog.help.intro")}</p>
              <ul className="settings-help-list">
                <li>{t("projectLog.help.line1")}</li>
                <li>{t("projectLog.help.line2")}</li>
                <li>PostgreSQL entries currently focus on the new qualitative workflow and project membership changes.</li>
              </ul>
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setHelpOpen(false)}>
                  {t("common.close")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
