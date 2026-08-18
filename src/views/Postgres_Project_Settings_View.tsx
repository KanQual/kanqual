import { Fragment, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { SettingsModal } from "../components/SettingsModal";
import {
  deletePostgresProject,
  listPostgresProjectLog,
  listPostgresSources,
  updatePostgresProject,
  type PostgresProject,
  type PostgresProjectLogEntry,
  type PostgresSource,
} from "../lib/postgres";
import {
  deletePostgresProjectBackup,
  createPostgresProjectBackup,
  formatPostgresBackupSize,
  importPostgresProjectBackupAsProject,
  loadPostgresProjectBackupManifest,
  type PostgresProjectBackupEntry,
  type PostgresProjectBackupManifest,
} from "../lib/postgresProjectBackups";
import {
  fetchPostgresProjectExportData,
  importPostgresRefiQdaCodebook,
} from "../lib/postgresProjectExport";
import {
  makeProjectBackupJson,
  makeProjectBackupXlsx,
  makeRefiQdaCodebook,
  makeRefiQdaProject,
  parseRefiQdaCodebook,
} from "../lib/projectExport";
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
import { useI18n } from "../i18n/provider";

export type PostgresProjectSettingsViewProps = {
  project: PostgresProject;
  canManageProject: boolean;
  memberCount: number;
  ownerCount: number;
  objectCount: number;
  relationshipCount: number;
  onProjectUpdated: (project: PostgresProject) => void;
  onProjectDeleted: (projectId: string) => void;
  onProjectOpened?: (project: PostgresProject) => void | Promise<void>;
  embedded?: boolean;
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

function safeExportName(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "kanqual_project";
}

function backupReasonLabel(entry: PostgresProjectBackupEntry): string {
  if (entry.reason === "automatic") return "Automatic snapshot";
  if (entry.reason === "session") return "Session snapshot";
  return "Manual snapshot";
}

function projectCreationSourceLabel(source: string): string {
  switch (source) {
    case "snapshot": return "Snapshot";
    case "kanqual_export": return "KanQual export";
    case "refi_qda": return "REFI-QDA";
    case "manual": return "Manual";
    default: return source ? source.replace(/_/g, " ") : "Manual";
  }
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function PostgresProjectSettingsView({
  project,
  canManageProject,
  memberCount,
  ownerCount,
  onProjectUpdated,
  onProjectDeleted,
  onProjectOpened,
  embedded = false,
}: PostgresProjectSettingsViewProps) {
  const { t } = useI18n();
  const [activeModal, setActiveModal] = useState<"details" | "storage" | "uploaded-files" | "backups" | "log" | "export" | "codebook" | "danger" | null>(null);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [deleteConfirmationName, setDeleteConfirmationName] = useState("");
  const [submitting, setSubmitting] = useState<"details" | "delete" | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [sources, setSources] = useState<PostgresSource[]>([]);
  const [projectLogEntries, setProjectLogEntries] = useState<PostgresProjectLogEntry[]>([]);
  const [expandedLogIds, setExpandedLogIds] = useState<Record<string, boolean>>({});
  const [backupManifest, setBackupManifest] = useState<PostgresProjectBackupManifest | null>(null);
  const [backupBusy, setBackupBusy] = useState<"manual" | "delete" | "import" | null>(null);
  const [backupError, setBackupError] = useState("");
  const [backupNotice, setBackupNotice] = useState("");
  const [deleteBackup, setDeleteBackup] = useState<PostgresProjectBackupEntry | null>(null);
  const [importBackup, setImportBackup] = useState<PostgresProjectBackupEntry | null>(null);
  const [importBackupProjectName, setImportBackupProjectName] = useState("");
  const [importedBackupProject, setImportedBackupProject] = useState<PostgresProject | null>(null);
  const [exporting, setExporting] = useState<"json" | "xlsx" | "qdpx" | "encrypted" | null>(null);
  const [exportError, setExportError] = useState("");
  const [encryptedBackupPassword, setEncryptedBackupPassword] = useState("");
  const [encryptedBackupPasswordConfirm, setEncryptedBackupPasswordConfirm] = useState("");
  const [codebookBusy, setCodebookBusy] = useState<"export" | "import" | null>(null);
  const [codebookError, setCodebookError] = useState("");
  const [codebookImportResult, setCodebookImportResult] = useState<{ importedCount: number } | null>(null);
  const [projectLogExporting, setProjectLogExporting] = useState(false);

  useEffect(() => {
    setName(project.name);
    setDescription(project.description);
  }, [project.description, project.name]);

  async function loadSources() {
    try {
      setSources(await listPostgresSources(project.id));
    } catch (loadError) {
      setError(describeUnknownError(loadError));
    }
  }

  async function loadProjectLog() {
    try {
      setProjectLogEntries(await listPostgresProjectLog(project.id));
    } catch (loadError) {
      setError(describeUnknownError(loadError));
    }
  }

  async function loadBackups() {
    try {
      setBackupManifest(await loadPostgresProjectBackupManifest(project));
    } catch (loadError) {
      setBackupError(describeUnknownError(loadError));
    }
  }

  const retainedSources = useMemo(
    () => sources.filter((source) => source.storagePath || source.originalFileName),
    [sources],
  );

  const sortedProjectLogEntries = useMemo(
    () => [...projectLogEntries].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()),
    [projectLogEntries],
  );

  async function handleExport(format: "json" | "xlsx" | "qdpx") {
    setExportError("");
    setExporting(format);
    try {
      const extension = format === "json" ? "json" : format === "xlsx" ? "xlsx" : "qdpx";
      const path = await save({
        defaultPath: `${safeExportName(project.name)}_export.${extension}`,
        filters: [{ name: `${extension.toUpperCase()} file`, extensions: [extension] }],
      });
      if (!path) return;
      const data = await fetchPostgresProjectExportData(project);
      if (format === "json") {
        await writeTextFile(path, makeProjectBackupJson(data));
      } else if (format === "xlsx") {
        await writeFile(path, makeProjectBackupXlsx(data));
      } else {
        await writeFile(path, makeRefiQdaProject(data));
      }
      setNotice(`Exported ${format.toUpperCase()} project data.`);
    } catch (exportFailure) {
      setExportError(describeUnknownError(exportFailure));
    } finally {
      setExporting(null);
    }
  }

  async function handleEncryptedBackupExport() {
    setExportError("");
    if (!encryptedBackupPassword || encryptedBackupPassword !== encryptedBackupPasswordConfirm) {
      setExportError("Enter matching backup passwords.");
      return;
    }
    setExporting("encrypted");
    try {
      const path = await save({
        defaultPath: `${safeExportName(project.name)}_encrypted_backup.kqbe`,
        filters: [{ name: "KanQual encrypted backup", extensions: ["kqbe"] }],
      });
      if (!path) return;
      const data = await fetchPostgresProjectExportData(project);
      const encryptedBackup = await invoke<string>("encrypt_project_backup", {
        request: {
          backupJson: makeProjectBackupJson(data),
          password: encryptedBackupPassword,
        },
      });
      await writeTextFile(path, encryptedBackup);
      setEncryptedBackupPassword("");
      setEncryptedBackupPasswordConfirm("");
      setNotice("Exported encrypted project backup.");
    } catch (exportFailure) {
      setExportError(describeUnknownError(exportFailure));
    } finally {
      setExporting(null);
    }
  }

  async function handleProjectLogExport() {
    setExportError("");
    setProjectLogExporting(true);
    try {
      const path = await save({
        defaultPath: `${safeExportName(project.name)}_project_log.csv`,
        filters: [{ name: "CSV file", extensions: ["csv"] }],
      });
      if (!path) return;
      const entries = projectLogEntries.length ? projectLogEntries : await listPostgresProjectLog(project.id);
      const csv = [
        ["Time", "User", "Access", "Category", "Action", "Description"].map(csvEscape).join(","),
        ...entries.map((entry) => [
          csvEscape(formatProjectLogDateTime(entry.occurredAt)),
          csvEscape(entry.userName || "-"),
          csvEscape(projectLogAccessModeLabel(entry.accessMode, t)),
          csvEscape(projectLogActionCategory(entry.action)),
          csvEscape(projectLogActionLabel(entry.action, t)),
          csvEscape(entry.label || ""),
        ].join(",")),
      ].join("\n");
      await writeTextFile(path, csv);
      setNotice("Exported project log.");
    } catch (exportFailure) {
      setExportError(describeUnknownError(exportFailure));
    } finally {
      setProjectLogExporting(false);
    }
  }

  async function handleManualBackup() {
    setBackupError("");
    setBackupNotice("");
    if (!canManageProject) {
      setBackupError("Only project owners or administrators can create project snapshots.");
      return;
    }
    setBackupBusy("manual");
    try {
      const { manifest } = await createPostgresProjectBackup(project, "manual");
      setBackupManifest(manifest);
      setBackupNotice("Snapshot created.");
    } catch (backupFailure) {
      setBackupError(describeUnknownError(backupFailure));
    } finally {
      setBackupBusy(null);
    }
  }

  async function handleDeleteBackup() {
    if (!deleteBackup) return;
    setBackupError("");
    if (!canManageProject) {
      setBackupError("Only project owners or administrators can delete project snapshots.");
      setDeleteBackup(null);
      return;
    }
    if (!deleteBackup.manual) {
      setBackupError("Automatic and session snapshots are managed by retention settings.");
      setDeleteBackup(null);
      return;
    }
    setBackupBusy("delete");
    try {
      setBackupManifest(await deletePostgresProjectBackup(project, deleteBackup));
      setDeleteBackup(null);
      setBackupNotice("Snapshot deleted.");
    } catch (deleteFailure) {
      setBackupError(describeUnknownError(deleteFailure));
    } finally {
      setBackupBusy(null);
    }
  }

  async function handleImportBackup() {
    if (!importBackup) return;
    setBackupError("");
    setBackupNotice("");
    if (!importBackupProjectName.trim()) {
      setBackupError("Enter a name for the new project.");
      return;
    }
    if (!canManageProject) {
      setBackupError("Only project owners or administrators can import project snapshots.");
      setImportBackup(null);
      return;
    }
    setBackupBusy("import");
    try {
      const imported = await importPostgresProjectBackupAsProject(project, importBackup, {
        name: importBackupProjectName.trim(),
      });
      setImportedBackupProject(imported);
      setImportBackup(null);
      setImportBackupProjectName("");
      setBackupNotice(`Imported snapshot as "${imported.name}".`);
    } catch (importFailure) {
      setBackupError(describeUnknownError(importFailure));
    } finally {
      setBackupBusy(null);
    }
  }

  async function handleCodebookExport() {
    setCodebookError("");
    setCodebookBusy("export");
    try {
      const path = await save({
        defaultPath: `${safeExportName(project.name)}_codebook.qdc`,
        filters: [{ name: "REFI-QDA Codebook", extensions: ["qdc"] }],
      });
      if (!path) return;
      const data = await fetchPostgresProjectExportData(project);
      await writeTextFile(path, makeRefiQdaCodebook(data));
      setNotice("Exported codebook.");
    } catch (exportFailure) {
      setCodebookError(describeUnknownError(exportFailure));
    } finally {
      setCodebookBusy(null);
    }
  }

  async function handleCodebookImport() {
    setCodebookError("");
    setCodebookBusy("import");
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "REFI-QDA Codebook", extensions: ["qdc", "xml"] }],
      });
      if (!path || Array.isArray(path)) return;
      const codes = parseRefiQdaCodebook(await readTextFile(path));
      const importedCount = await importPostgresRefiQdaCodebook(project.id, codes);
      setCodebookImportResult({ importedCount });
    } catch (importFailure) {
      setCodebookError(describeUnknownError(importFailure));
    } finally {
      setCodebookBusy(null);
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
    <div className={embedded ? "project-settings-view project-settings-view--embedded" : "view project-settings-view"}>
      {!embedded ? (
        <header className="view-header">
          <div className="view-title-with-help">
            <h1>Project Settings</h1>
          </div>
        </header>
      ) : null}

      {notice ? <p className="settings-success">{notice}</p> : null}
      {error ? <p className="auth-error">{error}</p> : null}

      <div className="app-settings-overview-shell project-settings-overview-shell">
        <div className="app-settings-overview-stack">
          <div className="app-settings-overview-sections">
            <section className="app-settings-overview-section">
              {!embedded ? (
                <div className="app-settings-overview-section-header">
                  <p className="app-settings-overview-section-heading">Project</p>
                </div>
              ) : null}
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
              </div>
            </section>

            <section className="app-settings-overview-section">
              {!embedded ? (
                <div className="app-settings-overview-section-header">
                  <p className="app-settings-overview-section-heading">Project Data</p>
                </div>
              ) : null}
              <div className="app-settings-overview-grid">
                <button
                  type="button"
                  className="app-settings-overview-card app-settings-overview-card--default"
                  onClick={() => {
                    setError("");
                    setActiveModal("uploaded-files");
                    void loadSources();
                  }}
                >
                  <h3>Uploaded Files</h3>
                  <p>Review retained source file metadata for this project.</p>
                </button>
                <button
                  type="button"
                  className="app-settings-overview-card app-settings-overview-card--default"
                  onClick={() => {
                    setBackupError("");
                    setBackupNotice("");
                    setActiveModal("backups");
                    void loadBackups();
                  }}
                >
                  <h3>Snapshots</h3>
                  <p>Create and review project-level snapshots.</p>
                </button>
                <button
                  type="button"
                  className="app-settings-overview-card app-settings-overview-card--default"
                  onClick={() => {
                    setError("");
                    setActiveModal("log");
                    void loadProjectLog();
                  }}
                >
                  <h3>Log</h3>
                  <p>Review and export this project's activity log.</p>
                </button>
              </div>
            </section>

            <section className="app-settings-overview-section">
              {!embedded ? (
                <div className="app-settings-overview-section-header">
                  <p className="app-settings-overview-section-heading">Exchange</p>
                </div>
              ) : null}
              <div className="app-settings-overview-grid">
                <button
                  type="button"
                  className="app-settings-overview-card app-settings-overview-card--default"
                  onClick={() => {
                    setExportError("");
                    setActiveModal("export");
                  }}
                >
                  <h3>Export</h3>
                  <p>Export project data as JSON, Excel, REFI-QDA, or encrypted backup.</p>
                </button>
                <button
                  type="button"
                  className="app-settings-overview-card app-settings-overview-card--default"
                  onClick={() => {
                    setCodebookError("");
                    setActiveModal("codebook");
                  }}
                >
                  <h3>Codebook</h3>
                  <p>Import or export a REFI-QDA codebook file.</p>
                </button>
                <button
                  type="button"
                  className="app-settings-overview-card app-settings-overview-card--default"
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
        <SettingsModal title="Project Details" onClose={() => setActiveModal(null)} closeDisabled={submitting === "details"}>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Metadata</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="home-restricted-list" style={{ marginBottom: 16 }}>
                      <div className="home-restricted-item">
                        <span className="home-restricted-label">Created from</span>
                        <span className="home-restricted-value">{projectCreationSourceLabel(project.creationSource)}</span>
                      </div>
                    </div>
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
        </SettingsModal>
      ) : null}

      {activeModal === "storage" ? (
        <SettingsModal title="Project Storage" onClose={() => setActiveModal(null)}>
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
        </SettingsModal>
      ) : null}

      {activeModal === "uploaded-files" ? (
        <SettingsModal title="Uploaded Files" onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Retained Source Files</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="backup-list">
                      {retainedSources.length > 0 ? retainedSources.map((source) => (
                        <div key={source.id} className="backup-list-item">
                          <div>
                            <div className="backup-list-title">
                              {source.originalFileName || source.title || "Untitled source"}
                              <span className="backup-badge backup-badge--scheduled">{source.sourceKind}</span>
                            </div>
                            <div className="backup-list-meta">
                              {source.title}
                              {source.storagePath ? ` | ${source.storagePath}` : ""}
                            </div>
                            <div className="backup-list-meta">
                              Imported {formatPostgresDateTime(source.createdAt)}
                            </div>
                          </div>
                        </div>
                      )) : (
                        <div className="empty-state backup-empty-state">
                          <p>No retained source files were found for this project.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button>
            </div>
        </SettingsModal>
      ) : null}

      {activeModal === "backups" ? (
        <SettingsModal title="Snapshots" onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                {backupError ? <div className="form-error project-settings-error">{backupError}</div> : null}
                {backupNotice ? <div className="settings-success project-settings-success">{backupNotice}</div> : null}
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Snapshot Controls</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="backup-header-actions">
                      <button
                        className="btn btn--primary"
                        onClick={() => void handleManualBackup()}
                        disabled={backupBusy === "manual" || !canManageProject}
                        title={!canManageProject ? "Only project owners or administrators can create project snapshots." : undefined}
                      >
                        {backupBusy === "manual" ? "Creating..." : "Create Snapshot Now"}
                      </button>
                    </div>
                    <p className="auth-hint" style={{ marginBottom: 0 }}>
                      Snapshots are stored in the paired project snapshot database and include compressed source-file payloads.
                    </p>
                    {!canManageProject ? (
                      <p className="auth-hint" style={{ marginBottom: 0 }}>
                        Only project owners or administrators can create, delete, or import project snapshots.
                      </p>
                    ) : null}
                  </div>
                </section>
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Available Snapshots</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="backup-list">
                      {backupManifest?.backups.length ? backupManifest.backups.map((backup) => (
                        <div key={backup.file} className="backup-list-item">
                          <div>
                            <div className="backup-list-title">
                              {formatPostgresDateTime(backup.createdAt)}
                              <span className="backup-badge">{backup.manual ? "Retained indefinitely" : "Retention managed"}</span>
                            </div>
                            <div className="backup-list-meta">
                              {backupReasonLabel(backup)}{backup.sizeBytes ? ` | ${formatPostgresBackupSize(backup.sizeBytes)}` : ""}
                              {` | ${backup.storageFileCount} file${backup.storageFileCount === 1 ? "" : "s"}`}
                            </div>
                            {backup.sourceLogLabel ? (
                              <div className="backup-list-meta">
                                Triggered by {backup.sourceLogLabel}
                              </div>
                            ) : null}
                            <div className="backup-list-meta">
                              Database {formatPostgresBackupSize(backup.databaseBytes) || "0 B"} | Files {formatPostgresBackupSize(backup.storageBytes) || "0 B"}
                            </div>
                          </div>
                          <div className="backup-header-actions">
                            <button
                              className="btn"
                              onClick={() => {
                                setBackupError("");
                                setBackupNotice("");
                                setImportBackup(backup);
                                setImportBackupProjectName(`${project.name} Snapshot Copy`);
                              }}
                              disabled={!!backupBusy || !canManageProject}
                              title={!canManageProject ? "Only project owners or administrators can import project snapshots." : undefined}
                            >
                              Import
                            </button>
                            <button
                              className="btn btn--danger"
                              onClick={() => setDeleteBackup(backup)}
                              disabled={!!backupBusy || !canManageProject || !backup.manual}
                              title={
                                !canManageProject
                                  ? "Only project owners or administrators can delete project snapshots."
                                  : !backup.manual
                                    ? "Automatic and session snapshots are managed by retention settings."
                                    : undefined
                              }
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      )) : (
                        <div className="empty-state backup-empty-state">
                          <p>No snapshots yet.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button>
            </div>
        </SettingsModal>
      ) : null}

      {activeModal === "log" ? (
        <SettingsModal title="Project Log" onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
              {exportError ? <p className="auth-error">{exportError}</p> : null}
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Project Activity</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="settings-row">
                      <div className="settings-row-info">
                        <div className="settings-row-label">Export Log</div>
                      </div>
                      <button className="btn" type="button" onClick={() => void handleProjectLogExport()} disabled={projectLogExporting}>
                        {projectLogExporting ? "Exporting..." : "Export CSV"}
                      </button>
                    </div>
                    {sortedProjectLogEntries.length === 0 ? (
                      <div className="empty-state backup-empty-state">
                        <p>No project activity yet.</p>
                      </div>
                    ) : (
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
                            {sortedProjectLogEntries.map((entry) => {
                              const details = parseProjectLogDetails(entry.detailsJson);
                              const isExpanded = Boolean(expandedLogIds[entry.id]);
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
                                          onClick={() => setExpandedLogIds((current) => ({ ...current, [entry.id]: !current[entry.id] }))}
                                          aria-expanded={isExpanded}
                                        >
                                          {isExpanded ? "Hide" : "View"}
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
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button>
            </div>
        </SettingsModal>
      ) : null}

      {activeModal === "export" ? (
        <SettingsModal title="Export" onClose={() => setActiveModal(null)} closeDisabled={!!exporting}>
            <div className="app-settings-modal-body">
              {exportError ? <p className="auth-error">{exportError}</p> : null}
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--warning">
                    <h3>Encrypted Backup</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="form">
                      <label className="form-label">
                        Backup Password
                        <input className="form-input" type="password" value={encryptedBackupPassword} onChange={(event) => setEncryptedBackupPassword(event.target.value)} autoComplete="new-password" />
                      </label>
                      <label className="form-label">
                        Confirm Password
                        <input className="form-input" type="password" value={encryptedBackupPasswordConfirm} onChange={(event) => setEncryptedBackupPasswordConfirm(event.target.value)} autoComplete="new-password" />
                      </label>
                      <div className="project-export-actions project-export-actions--modal">
                        <button className="btn btn--primary" onClick={() => void handleEncryptedBackupExport()} disabled={!!exporting || !encryptedBackupPassword || !encryptedBackupPasswordConfirm}>
                          {exporting === "encrypted" ? "Exporting..." : "Export Encrypted Backup"}
                        </button>
                      </div>
                    </div>
                  </div>
                </section>
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--danger">
                    <h3>Whole Project Exports</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="project-export-actions project-export-actions--modal">
                      <button className="btn" onClick={() => void handleExport("json")} disabled={!!exporting}>
                        {exporting === "json" ? "Exporting..." : "Export JSON Backup"}
                      </button>
                      <button className="btn" onClick={() => void handleExport("qdpx")} disabled={!!exporting}>
                        {exporting === "qdpx" ? "Exporting..." : "Export REFI-QDA Project"}
                      </button>
                    </div>
                  </div>
                </section>
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Review Export</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="project-export-actions project-export-actions--modal">
                      <button className="btn btn--primary" onClick={() => void handleExport("xlsx")} disabled={!!exporting}>
                        {exporting === "xlsx" ? "Exporting..." : "Export Excel Workbook"}
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)} disabled={!!exporting}>Done</button>
            </div>
        </SettingsModal>
      ) : null}

      {activeModal === "codebook" ? (
        <SettingsModal title="Codebook" onClose={() => setActiveModal(null)} closeDisabled={!!codebookBusy}>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                {codebookError ? <p className="auth-error">{codebookError}</p> : null}
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Codebook Exchange</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="project-export-actions project-export-actions--modal">
                      <button className="btn" onClick={() => void handleCodebookImport()} disabled={!!codebookBusy}>
                        {codebookBusy === "import" ? "Importing..." : "Import REFI-QDA Codebook"}
                      </button>
                      <button className="btn btn--primary" onClick={() => void handleCodebookExport()} disabled={!!codebookBusy}>
                        {codebookBusy === "export" ? "Exporting..." : "Export REFI-QDA Codebook"}
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)} disabled={!!codebookBusy}>Done</button>
            </div>
        </SettingsModal>
      ) : null}

      {activeModal === "danger" ? (
        <SettingsModal title="Delete Project" onClose={() => setActiveModal(null)} closeDisabled={submitting === "delete"}>
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
        </SettingsModal>
      ) : null}

      {deleteBackup ? (
        <SettingsModal title="Delete Snapshot" onClose={() => setDeleteBackup(null)} closeDisabled={backupBusy === "delete"}>
            <div className="app-settings-modal-body">
              <p className="import-project-copy">
                Delete the snapshot from {formatPostgresDateTime(deleteBackup.createdAt)}?
              </p>
            </div>
            <div className="app-settings-modal-footer">
              <button type="button" className="btn" onClick={() => setDeleteBackup(null)} disabled={backupBusy === "delete"}>Cancel</button>
              <button type="button" className="btn btn--danger" onClick={() => void handleDeleteBackup()} disabled={backupBusy === "delete" || !canManageProject}>
                {backupBusy === "delete" ? "Deleting..." : "Delete Snapshot"}
              </button>
            </div>
        </SettingsModal>
      ) : null}

      {importBackup ? (
        <SettingsModal
          title="Import Snapshot"
          onClose={() => {
            setImportBackup(null);
            setImportBackupProjectName("");
          }}
          closeDisabled={backupBusy === "import"}
        >
            <div className="app-settings-modal-body">
              <p className="import-project-copy">
                Import the snapshot from {formatPostgresDateTime(importBackup.createdAt)} as a new project.
              </p>
              <label className="form-field">
                <span>New project name</span>
                <input
                  className="form-input"
                  value={importBackupProjectName}
                  onChange={(event) => setImportBackupProjectName(event.target.value)}
                  disabled={backupBusy === "import"}
                  autoFocus
                />
              </label>
              <div className="home-restricted-list">
                <div className="home-restricted-item"><span className="home-restricted-label">Database</span><span className="home-restricted-value">{formatPostgresBackupSize(importBackup.databaseBytes) || "0 B"}</span></div>
                <div className="home-restricted-item"><span className="home-restricted-label">Files</span><span className="home-restricted-value">{formatPostgresBackupSize(importBackup.storageBytes) || "0 B"}</span></div>
                <div className="home-restricted-item"><span className="home-restricted-label">Stored files</span><span className="home-restricted-value">{importBackup.storageFileCount}</span></div>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <button type="button" className="btn" onClick={() => {
                setImportBackup(null);
                setImportBackupProjectName("");
              }} disabled={backupBusy === "import"}>Cancel</button>
              <button type="button" className="btn btn--primary" onClick={() => void handleImportBackup()} disabled={backupBusy === "import" || !canManageProject || !importBackupProjectName.trim()}>
                {backupBusy === "import" ? "Importing..." : "Import"}
              </button>
            </div>
        </SettingsModal>
      ) : null}

      {importedBackupProject ? (
        <SettingsModal title="Snapshot Imported" onClose={() => setImportedBackupProject(null)}>
            <div className="app-settings-modal-body">
              <p className="import-project-copy">
                Created "{importedBackupProject.name}" as a new project.
              </p>
            </div>
            <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
              {onProjectOpened ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const projectToOpen = importedBackupProject;
                    setImportedBackupProject(null);
                    void onProjectOpened(projectToOpen);
                  }}
                >
                  Open Project
                </button>
              ) : null}
              <button type="button" className="btn btn--primary" onClick={() => setImportedBackupProject(null)}>Done</button>
            </div>
        </SettingsModal>
      ) : null}

      {codebookImportResult ? (
        <SettingsModal title="Codebook Imported" onClose={() => setCodebookImportResult(null)}>
            <div className="app-settings-modal-body">
              <p className="import-project-copy">
                Imported {codebookImportResult.importedCount} codes.
              </p>
            </div>
            <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
              <button type="button" className="btn btn--primary" onClick={() => setCodebookImportResult(null)}>Done</button>
            </div>
        </SettingsModal>
      ) : null}
    </div>
  );
}
