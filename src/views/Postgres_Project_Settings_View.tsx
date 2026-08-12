import { useEffect, useState } from "react";
import {
  deletePostgresProject,
  getPostgresProjectAiAssistSettings,
  getPostgresProjectDocumentImportSettings,
  savePostgresProjectAiAssistSettings,
  savePostgresProjectDocumentImportSettings,
  updatePostgresProject,
  type PostgresProject,
  type PostgresProjectAiAssistSettings,
  type PostgresProjectDocumentImportSettings,
} from "../lib/postgres";

export type PostgresProjectSettingsViewProps = {
  project: PostgresProject;
  canManageProject: boolean;
  memberCount: number;
  ownerCount: number;
  objectCount: number;
  relationshipCount: number;
  onProjectUpdated: (project: PostgresProject) => void;
  onProjectDeleted: (projectId: string) => void;
};

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function formatPostgresDateTime(iso: string): string {
  if (!iso) return "-";
  try {
    return new Intl.DateTimeFormat([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "-";
  }
}

export function PostgresProjectSettingsView({
  project,
  canManageProject,
  memberCount,
  ownerCount,
  objectCount,
  relationshipCount,
  onProjectUpdated,
  onProjectDeleted,
}: PostgresProjectSettingsViewProps) {
  const [activeModal, setActiveModal] = useState<"details" | "storage" | "ai-assist" | "document-import" | "danger" | null>(null);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [deleteConfirmationName, setDeleteConfirmationName] = useState("");
  const [submitting, setSubmitting] = useState<"details" | "delete" | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [aiAssistNotice, setAiAssistNotice] = useState("");
  const [documentImportNotice, setDocumentImportNotice] = useState("");
  const [projectAiAssistSettings, setProjectAiAssistSettings] = useState<PostgresProjectAiAssistSettings>({
    enabled: false,
    allowSemanticSearch: true,
    allowQuestionAnswering: true,
    allowSummaries: true,
    allowCodeSuggestions: false,
    allowDraftReports: false,
  });
  const [projectDocumentImportSettings, setProjectDocumentImportSettings] =
    useState<PostgresProjectDocumentImportSettings>({
      storeOriginalFileName: true,
    });

  useEffect(() => {
    setName(project.name);
    setDescription(project.description);
  }, [project.description, project.name]);

  useEffect(() => {
    let cancelled = false;

    async function loadProjectSettings() {
      setSettingsLoading(true);
      try {
        const [aiAssistSettings, documentImportSettings] = await Promise.all([
          getPostgresProjectAiAssistSettings(project.id),
          getPostgresProjectDocumentImportSettings(project.id),
        ]);
        if (cancelled) return;
        setProjectAiAssistSettings(aiAssistSettings);
        setProjectDocumentImportSettings(documentImportSettings);
      } catch (loadError) {
        if (cancelled) return;
        setError(describeUnknownError(loadError));
      } finally {
        if (!cancelled) {
          setSettingsLoading(false);
        }
      }
    }

    void loadProjectSettings();

    return () => {
      cancelled = true;
    };
  }, [project.id]);

  async function handleSaveAiAssistSettings(next: PostgresProjectAiAssistSettings) {
    setError("");
    setNotice("");
    setDocumentImportNotice("");
    setAiAssistNotice("");
    if (!canManageProject) {
      setError("Only project owners or the PostgreSQL administrator can change project settings.");
      return;
    }

    try {
      const saved = await savePostgresProjectAiAssistSettings({
        projectId: project.id,
        settings: next,
      });
      setProjectAiAssistSettings(saved);
      setAiAssistNotice("AI Assist settings saved.");
    } catch (saveError) {
      setError(describeUnknownError(saveError));
    }
  }

  async function handleSaveDocumentImportSettings(next: PostgresProjectDocumentImportSettings) {
    setError("");
    setNotice("");
    setAiAssistNotice("");
    setDocumentImportNotice("");
    if (!canManageProject) {
      setError("Only project owners or the PostgreSQL administrator can change project settings.");
      return;
    }

    try {
      const saved = await savePostgresProjectDocumentImportSettings({
        projectId: project.id,
        settings: next,
      });
      setProjectDocumentImportSettings(saved);
      setDocumentImportNotice("Document import defaults saved.");
    } catch (saveError) {
      setError(describeUnknownError(saveError));
    }
  }

  async function handleSaveDetails(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!canManageProject) {
      setError("Only project owners or the PostgreSQL administrator can change project settings.");
      return;
    }
    if (!name.trim()) {
      setError("Enter a project name.");
      return;
    }

    setSubmitting("details");
    try {
      const updated = await updatePostgresProject({
        projectId: project.id,
        name: name.trim(),
        description: description.trim(),
      });
      onProjectUpdated(updated);
      setActiveModal(null);
      setNotice(`Updated PostgreSQL project "${updated.name}".`);
    } catch (updateError) {
      setError(describeUnknownError(updateError));
    } finally {
      setSubmitting(null);
    }
  }

  async function handleDeleteProject() {
    setError("");
    setNotice("");
    if (!canManageProject) {
      setError("Only project owners or the PostgreSQL administrator can delete this project.");
      return;
    }
    if (deleteConfirmationName.trim() !== project.name.trim()) {
      setError("Enter the exact project name to confirm deletion.");
      return;
    }

    setSubmitting("delete");
    try {
      await deletePostgresProject(project.id);
      onProjectDeleted(project.id);
    } catch (deleteError) {
      setError(describeUnknownError(deleteError));
      setSubmitting(null);
    }
  }

  return (
    <div className="view project-settings-view">
      <header className="view-header">
        <div className="view-title-with-help">
          <h1>Project Settings</h1>
        </div>
      </header>

      {notice ? <p className="settings-success">{notice}</p> : null}
      {error ? <p className="auth-error">{error}</p> : null}

      <div className="app-settings-overview-shell project-settings-overview-shell">
        <div className="app-settings-overview-stack">
          <div className="app-settings-overview-sections">
            <section className="app-settings-overview-section">
              <div className="app-settings-overview-section-header">
                <p className="app-settings-overview-section-heading">Project</p>
              </div>
              <div className="app-settings-overview-grid">
                <button
                  type="button"
                  className="app-settings-overview-card app-settings-overview-card--default"
                  onClick={() => {
                    setError("");
                    setName(project.name);
                    setDescription(project.description);
                    setActiveModal("details");
                  }}
                >
                  <h3>Details</h3>
                  <p>Rename the project and edit its description.</p>
                </button>
                <button
                  type="button"
                  className="app-settings-overview-card app-settings-overview-card--default"
                  onClick={() => {
                    setError("");
                    setActiveModal("storage");
                  }}
                >
                  <h3>Storage</h3>
                  <p>See the per-project database name, file location, and timestamps.</p>
                </button>
                <button
                  type="button"
                  className="app-settings-overview-card app-settings-overview-card--default"
                  onClick={() => {
                    setError("");
                    setNotice("");
                    setDocumentImportNotice("");
                    setAiAssistNotice("");
                    setActiveModal("ai-assist");
                  }}
                  disabled={settingsLoading}
                >
                  <h3>AI Assist</h3>
                  <p>Choose whether this project allows search, summaries, coding help, and draft reports.</p>
                </button>
                <button
                  type="button"
                  className="app-settings-overview-card app-settings-overview-card--default"
                  onClick={() => {
                    setError("");
                    setNotice("");
                    setDocumentImportNotice("");
                    setAiAssistNotice("");
                    setActiveModal("document-import");
                  }}
                  disabled={settingsLoading}
                >
                  <h3>Document Import</h3>
                  <p>Control shared defaults for imported files in this project database.</p>
                </button>
              </div>
            </section>

            <section className="app-settings-overview-section">
              <div className="app-settings-overview-section-header">
                <p className="app-settings-overview-section-heading">Workspace</p>
              </div>
              <div className="app-settings-overview-grid">
                <div className="app-settings-overview-card app-settings-overview-card--default" role="presentation">
                  <h3>Project Summary</h3>
                  <p>
                    {memberCount} users, {objectCount} objects, and {relationshipCount} relationships currently live in
                    this PostgreSQL project database.
                  </p>
                </div>
                <button
                  type="button"
                  className="app-settings-overview-card app-settings-overview-card--danger"
                  onClick={() => {
                    setError("");
                    setDeleteConfirmationName("");
                    setActiveModal("danger");
                  }}
                >
                  <h3>Delete Project</h3>
                  <p>Permanently remove this project and its dedicated PostgreSQL database.</p>
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>

      {activeModal === "details" ? (
        <div className="modal-overlay" onClick={() => submitting !== "details" && setActiveModal(null)}>
          <div className="modal modal--wide app-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">Project Details</h2>
              </div>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Metadata</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <form className="form" onSubmit={handleSaveDetails}>
                      <label className="form-label">
                        Project name
                        <input
                          className="form-input"
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          disabled={submitting === "details" || !canManageProject}
                          autoFocus
                        />
                      </label>
                      <label className="form-label">
                        Description
                        <textarea
                          className="form-input form-textarea"
                          rows={5}
                          value={description}
                          onChange={(event) => setDescription(event.target.value)}
                          disabled={submitting === "details" || !canManageProject}
                        />
                      </label>
                      {!canManageProject ? (
                        <p className="auth-hint" style={{ marginTop: 0 }}>
                          Only project owners or the PostgreSQL administrator can change these settings.
                        </p>
                      ) : null}
                      <div className="form-actions">
                        <button type="button" className="btn" onClick={() => setActiveModal(null)} disabled={submitting === "details"}>
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="btn btn--primary"
                          disabled={submitting === "details" || !canManageProject || !name.trim()}
                        >
                          {submitting === "details" ? "Saving..." : "Save changes"}
                        </button>
                      </div>
                    </form>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === "storage" ? (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal modal--wide app-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">Project Storage</h2>
              </div>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Dedicated Database</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="home-restricted-list">
                      <div className="home-restricted-item"><span className="home-restricted-label">Database name</span><span className="home-restricted-value">{project.databaseName || "-"}</span></div>
                      <div className="home-restricted-item">
                        <span className="home-restricted-label">Storage path</span>
                        <span className="home-restricted-value" style={{ textAlign: "right", overflowWrap: "anywhere" }}>
                          {project.storagePath || "-"}
                        </span>
                      </div>
                      <div className="home-restricted-item"><span className="home-restricted-label">Created</span><span className="home-restricted-value">{formatPostgresDateTime(project.createdAt)}</span></div>
                      <div className="home-restricted-item"><span className="home-restricted-label">Last updated</span><span className="home-restricted-value">{formatPostgresDateTime(project.updatedAt)}</span></div>
                      <div className="home-restricted-item"><span className="home-restricted-label">Owners</span><span className="home-restricted-value">{ownerCount}</span></div>
                      <div className="home-restricted-item"><span className="home-restricted-label">Members</span><span className="home-restricted-value">{memberCount}</span></div>
                    </div>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === "ai-assist" ? (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal modal--wide app-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">AI Assist</h2>
              </div>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Project AI permissions</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    {aiAssistNotice ? <p className="settings-success">{aiAssistNotice}</p> : null}
                    <label className="settings-toggle-row">
                      <span><strong>Enable AI Assist for this project</strong></span>
                      <input
                        type="checkbox"
                        checked={projectAiAssistSettings.enabled}
                        disabled={!canManageProject}
                        onChange={(event) => void handleSaveAiAssistSettings({ ...projectAiAssistSettings, enabled: event.target.checked })}
                      />
                    </label>
                    <label className="settings-toggle-row">
                      <span>Allow semantic search</span>
                      <input
                        type="checkbox"
                        checked={projectAiAssistSettings.allowSemanticSearch}
                        disabled={!canManageProject}
                        onChange={(event) => void handleSaveAiAssistSettings({ ...projectAiAssistSettings, allowSemanticSearch: event.target.checked })}
                      />
                    </label>
                    <label className="settings-toggle-row">
                      <span>Allow question answering</span>
                      <input
                        type="checkbox"
                        checked={projectAiAssistSettings.allowQuestionAnswering}
                        disabled={!canManageProject}
                        onChange={(event) => void handleSaveAiAssistSettings({ ...projectAiAssistSettings, allowQuestionAnswering: event.target.checked })}
                      />
                    </label>
                    <label className="settings-toggle-row">
                      <span>Allow summaries</span>
                      <input
                        type="checkbox"
                        checked={projectAiAssistSettings.allowSummaries}
                        disabled={!canManageProject}
                        onChange={(event) => void handleSaveAiAssistSettings({ ...projectAiAssistSettings, allowSummaries: event.target.checked })}
                      />
                    </label>
                    <label className="settings-toggle-row">
                      <span>Allow code suggestions</span>
                      <input
                        type="checkbox"
                        checked={projectAiAssistSettings.allowCodeSuggestions}
                        disabled={!canManageProject}
                        onChange={(event) => void handleSaveAiAssistSettings({ ...projectAiAssistSettings, allowCodeSuggestions: event.target.checked })}
                      />
                    </label>
                    <label className="settings-toggle-row">
                      <span>Allow draft reports</span>
                      <input
                        type="checkbox"
                        checked={projectAiAssistSettings.allowDraftReports}
                        disabled={!canManageProject}
                        onChange={(event) => void handleSaveAiAssistSettings({ ...projectAiAssistSettings, allowDraftReports: event.target.checked })}
                      />
                    </label>
                    {!canManageProject ? (
                      <p className="auth-hint" style={{ marginTop: 12 }}>
                        Only project owners or the PostgreSQL administrator can change these settings.
                      </p>
                    ) : null}
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === "document-import" ? (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal modal--wide app-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">Document Import</h2>
              </div>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Shared import defaults</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    {documentImportNotice ? <p className="settings-success">{documentImportNotice}</p> : null}
                    <label className="settings-toggle-row">
                      <span><strong>Store original filename</strong></span>
                      <input
                        type="checkbox"
                        checked={projectDocumentImportSettings.storeOriginalFileName}
                        disabled={!canManageProject}
                        onChange={(event) => void handleSaveDocumentImportSettings({ storeOriginalFileName: event.target.checked })}
                      />
                    </label>
                    {!canManageProject ? (
                      <p className="auth-hint" style={{ marginTop: 12 }}>
                        Only project owners or the PostgreSQL administrator can change these settings.
                      </p>
                    ) : null}
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === "danger" ? (
        <div className="modal-overlay" onClick={() => submitting !== "delete" && setActiveModal(null)}>
          <div className="modal app-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">Delete Project</h2>
              </div>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--danger">
                    <h3>Danger Zone</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <p className="import-project-copy">
                      This permanently deletes <strong>{project.name}</strong>, including its dedicated PostgreSQL
                      database, objects, relationships, and project memberships.
                    </p>
                    <label className="form-label">
                      Type the project name to confirm
                      <input
                        className="form-input"
                        value={deleteConfirmationName}
                        onChange={(event) => setDeleteConfirmationName(event.target.value)}
                        disabled={submitting === "delete" || !canManageProject}
                        autoFocus
                      />
                    </label>
                    {!canManageProject ? (
                      <p className="auth-hint" style={{ marginTop: 0 }}>
                        Only project owners or the PostgreSQL administrator can delete this project.
                      </p>
                    ) : null}
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <button type="button" className="btn" onClick={() => setActiveModal(null)} disabled={submitting === "delete"}>Cancel</button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => void handleDeleteProject()}
                disabled={submitting === "delete" || !canManageProject || deleteConfirmationName.trim() !== project.name.trim()}
              >
                {submitting === "delete" ? "Deleting..." : "Delete project"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
