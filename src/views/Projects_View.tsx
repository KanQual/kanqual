import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile, readTextFile } from "@tauri-apps/plugin-fs";
import { useStore } from "../context/StoreContext";
import { useAuth } from "../context/AuthContext";
import { importProjectBackupIntoProject, importRefiQdaIntoProject, parseProjectBackupJson, parseRefiQdaProject } from "../lib/projectExport";
import { htmlToPlainText } from "../lib/htmlText";
import type { PendingImportedUser, Project } from "../types";
import { HelpIcon } from "../components/AppIcons";

const LOCAL_PB_URL = "http://127.0.0.1:8090";
type NewProjectMode = "choice" | "create" | "import" | "import-encrypted" | "import-refi" | null;

interface EncryptedBackupPreview {
  projectName: string;
  createdAt?: string | null;
  version?: number | null;
}

function importedProjectName(baseName: string, existingProjects: Project[]): string {
  const trimmed = baseName.trim() || "Imported Project";
  const hasCollision = existingProjects.some((project) => project.name.trim().toLowerCase() === trimmed.toLowerCase());
  if (!hasCollision) return trimmed;

  const stamp = new Date()
    .toLocaleString([], {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    .replace(/[^\d]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${trimmed} Imported ${stamp}`;
}

function userImportNotice(summary: {
  importedUsers: Array<{ email: string; temporaryPassword?: string; created: boolean }>;
}): string | null {
  const createdUsers = summary.importedUsers.filter((user) => user.created);
  if (createdUsers.length === 0) return null;
  return [
    "Imported user accounts created:",
    ...createdUsers.map((user) => `${user.email} - password: ${user.temporaryPassword ?? "(set in backup)"}`),
  ].join("\n");
}
void userImportNotice;

function mismatchNotes(summary: {
  identityChecks: { backendMatched: boolean; usersTableMatched: boolean; allUsersPresent: boolean };
}): string[] {
  const notes: string[] = [];
  if (!summary.identityChecks.backendMatched) {
    notes.push("It appears to be a new instance of Kanqual.");
  } else if (!summary.identityChecks.usersTableMatched) {
    notes.push("The users table identifier does not match this instance. It appears the users table was recreated from scratch.");
  } else if (!summary.identityChecks.allUsersPresent) {
    notes.push("One or more users from the imported project do not exist in the current users table.");
  }
  notes.push("In the next screen, you will need to configure what to do with the associated user accounts.");
  return notes;
}

export function ProjectsView() {
  const {
    pb,
    projects,
    projectsLoading,
    createProject,
    deleteProject,
    logAction,
    openProject,
    openProjectToView,
    activeProject,
    setPendingImportedUserResolution,
  } = useStore();
  const { serverUrl } = useAuth();
  const isLocal = serverUrl === LOCAL_PB_URL;
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [ownedProjectIds, setOwnedProjectIds] = useState<Set<string>>(new Set());
  const [menuProjectId, setMenuProjectId] = useState<string | null>(null);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState<Project | null>(null);
  const [deleteConfirmationName, setDeleteConfirmationName] = useState("");
  const [mode, setMode] = useState<NewProjectMode>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [encryptedImportPassword, setEncryptedImportPassword] = useState("");
  const [encryptedImportSource, setEncryptedImportSource] = useState<string | null>(null);
  const [encryptedImportPreview, setEncryptedImportPreview] = useState<EncryptedBackupPreview | null>(null);
  const [importCompleteProject, setImportCompleteProject] = useState<Project | null>(null);
  const [importSuccessMessage, setImportSuccessMessage] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [resolutionIntro, setResolutionIntro] = useState<{
    project: Project;
    users: PendingImportedUser[];
    notes: string[];
  } | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canConfirmDelete = !!confirmDeleteProject
    && deleteConfirmationName.trim() === confirmDeleteProject.name.trim();

  useEffect(() => {
    let cancelled = false;

    async function loadOwnedProjectIds() {
      const uid = pb.authStore.record?.id;
      if (!uid || projects.length === 0) {
        if (!cancelled) setOwnedProjectIds(new Set());
        return;
      }

      const filter = projects.map((project) => `project="${project.id}"`).join("||");
      const memberships = await pb.collection("project_members").getFullList({
        filter: `user="${uid}" && role="owner" && (${filter})`,
      });
      if (!cancelled) {
        setOwnedProjectIds(new Set(memberships.map((membership) => membership.project as string)));
      }
    }

    loadOwnedProjectIds().catch(() => {
      if (!cancelled) setOwnedProjectIds(new Set());
    });

    return () => {
      cancelled = true;
    };
  }, [pb, projects]);

  useEffect(() => {
    if (!menuProjectId) return;

    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current) return;
      if (menuRef.current.contains(event.target as Node)) return;
      setMenuProjectId(null);
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [menuProjectId]);

  function closeModal() {
    if (submitting || importing) return;
    setMode(null);
    setError(null);
    setEncryptedImportPassword("");
    setEncryptedImportSource(null);
    setEncryptedImportPreview(null);
  }

  function closeDeleteModal() {
    if (deletingProjectId) return;
    setConfirmDeleteProject(null);
    setDeleteConfirmationName("");
  }

  function goToMode(nextMode: NewProjectMode) {
    setError(null);
    if (nextMode !== "import-encrypted") {
      setEncryptedImportPassword("");
      setEncryptedImportSource(null);
      setEncryptedImportPreview(null);
    }
    setMode(nextMode);
  }

  async function handleCreate(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const project = await createProject(name.trim(), description.trim());
      setName("");
      setDescription("");
      setMode(null);
      openProject(project, activeProject);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleImportProject() {
    setImporting(true);
    setError(null);
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Kanqual JSON Backup", extensions: ["json"] }],
      });
      if (!selected || Array.isArray(selected)) return;

      const raw = await readTextFile(selected);
      const data = parseProjectBackupJson(raw);
      const backupName = typeof data.project.name === "string" && data.project.name.trim()
        ? data.project.name.trim()
        : "Imported Project";
      const importedName = importedProjectName(backupName, projects);
      const importedDescription = typeof data.project.description === "string"
        ? data.project.description
        : "";

      const project = await createProject(importedName, importedDescription);
      const summary = await importProjectBackupIntoProject(pb, data, project.id);
      await logAction(project.id, "project.import", "Imported project from Kanqual JSON backup");
      setMode(null);
      if (summary.requiresUserResolution) {
        setResolutionIntro({
          project,
          users: summary.importedUsers,
          notes: mismatchNotes(summary),
        });
      } else {
        setImportCompleteProject(project);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import project");
    } finally {
      setImporting(false);
    }
  }

  async function handleImportEncryptedProject() {
    if (!encryptedImportPassword) {
      setError("Enter the encrypted backup password first.");
      return;
    }

    setImporting(true);
    setError(null);
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Kanqual Encrypted Backup", extensions: ["kqbe"] }],
      });
      if (!selected || Array.isArray(selected)) return;

      const raw = await readTextFile(selected);
      const preview = await invoke<EncryptedBackupPreview>("decrypt_project_backup_preview", {
        request: {
          encryptedBackup: raw,
          password: encryptedImportPassword,
        },
      });
      setEncryptedImportSource(raw);
      setEncryptedImportPreview(preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read encrypted project backup");
    } finally {
      setImporting(false);
    }
  }

  async function handleConfirmEncryptedProjectImport() {
    if (!encryptedImportPassword || !encryptedImportSource) {
      setError("Choose an encrypted backup and preview it before importing.");
      return;
    }

    setImporting(true);
    setError(null);
    try {
      const decryptedJson = await invoke<string>("decrypt_project_backup_payload", {
        request: {
          encryptedBackup: encryptedImportSource,
          password: encryptedImportPassword,
        },
      });
      const data = parseProjectBackupJson(decryptedJson);
      const backupName = typeof data.project.name === "string" && data.project.name.trim()
        ? data.project.name.trim()
        : "Imported Project";
      const importedName = importedProjectName(backupName, projects);
      const importedDescription = typeof data.project.description === "string"
        ? data.project.description
        : "";

      const project = await createProject(importedName, importedDescription);
      const summary = await importProjectBackupIntoProject(pb, data, project.id);
      await logAction(project.id, "project.encrypted_backup.import", "Imported project from encrypted Kanqual backup");
      setEncryptedImportPassword("");
      setEncryptedImportSource(null);
      setEncryptedImportPreview(null);
      setMode(null);
      if (summary.requiresUserResolution) {
        setResolutionIntro({
          project,
          users: summary.importedUsers,
          notes: mismatchNotes(summary),
        });
      } else {
        setImportSuccessMessage("Encrypted backup imported successfully. All users should have access with their existing credentials.");
        setImportCompleteProject(project);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import encrypted project backup");
    } finally {
      setImporting(false);
    }
  }

  async function handleImportRefiProject() {
    setImporting(true);
    setError(null);
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "REFI-QDA Project", extensions: ["qdpx"] }],
      });
      if (!selected || Array.isArray(selected)) return;

      const bytes = await readFile(selected);
      const data = await parseRefiQdaProject(bytes);
      const importedName = importedProjectName(data.name, projects);
      const project = await createProject(importedName, data.description);
      await importRefiQdaIntoProject(pb, data, project.id);
      await logAction(project.id, "project.import", "Imported project from REFI-QDA project");
      setMode(null);
      openProject(project, activeProject);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import REFI-QDA project");
    } finally {
      setImporting(false);
    }
  }

  async function handleDeleteProject(e?: React.SyntheticEvent<HTMLFormElement | HTMLButtonElement>) {
    e?.preventDefault();
    if (!confirmDeleteProject || deletingProjectId) return;
    if (deleteConfirmationName.trim() !== confirmDeleteProject.name.trim()) return;

    setDeletingProjectId(confirmDeleteProject.id);
    setError(null);
    try {
      await deleteProject(confirmDeleteProject);
      setConfirmDeleteProject(null);
      setDeleteConfirmationName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete project");
    } finally {
      setDeletingProjectId(null);
    }
  }

  return (
    <div className="view projects-view">
      <header className="view-header">
        <div className="view-title-with-help">
          <h1>Projects</h1>
          <button type="button" className="users-help-icon-btn" onClick={() => setHelpOpen(true)} aria-label="Open projects help">
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
        {isLocal && (
          <button className="btn btn--primary" onClick={() => goToMode("choice")}>
            + New Project
          </button>
        )}
      </header>

      {mode === "choice" && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>New Project</h2>
            <p className="import-project-copy">
              Start a blank project or bring an existing project into this workspace.
            </p>
            <div className="mode-options-shell">
              <button className="mode-option mode-option--primary" onClick={() => goToMode("create")}>
                <span className="mode-option-title">Create Empty Project</span>
                <span className="mode-option-desc">Start from scratch with a blank Kanqual project.</span>
              </button>
              <div className="mode-options-group">
                <div className="mode-options-group-label">Import Existing</div>
                <div className="mode-options">
                  <button className="mode-option" onClick={() => goToMode("import")}>
                    <span className="mode-option-title">Import Project</span>
                    <span className="mode-option-desc">Upload a Kanqual JSON backup exported from Project Settings.</span>
                  </button>
                  <button className="mode-option" onClick={() => goToMode("import-encrypted")}>
                    <span className="mode-option-title">Import Encrypted Backup</span>
                    <span className="mode-option-desc">Upload a password-protected Kanqual encrypted backup for safe off-site storage.</span>
                  </button>
                  <button className="mode-option" onClick={() => goToMode("import-refi")}>
                    <span className="mode-option-title">Import REFI-QDA Project</span>
                    <span className="mode-option-desc">Upload a standard .qdpx file from Kanqual, QualCoder, or another QDA tool.</span>
                  </button>
                </div>
              </div>
            </div>
            <div className="form-actions">
              <button type="button" className="btn" onClick={closeModal}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {mode === "create" && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create Empty Project</h2>
            <form onSubmit={handleCreate} className="form">
              <label className="form-label">
                Project name
                <input
                  className="form-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Interview Study 2024"
                  autoFocus
                />
              </label>
              <label className="form-label">
                Description (optional)
                <textarea
                  className="form-input form-textarea"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this project about?"
                  rows={3}
                />
              </label>
              {error && <p className="auth-error">{error}</p>}
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => goToMode("choice")} disabled={submitting}>
                  Back
                </button>
                <button type="submit" className="btn btn--primary" disabled={!name.trim() || submitting}>
                  {submitting ? "Creating..." : "Create & Open"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {mode === "import" && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Import Project</h2>
            <div className="form">
              <p className="import-project-copy">
                Select a Kanqual JSON backup exported from a project's Project Settings page.
              </p>
              {error && <p className="auth-error">{error}</p>}
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => goToMode("choice")} disabled={importing}>
                  Back
                </button>
                <button type="button" className="btn btn--primary" onClick={handleImportProject} disabled={importing}>
                  {importing ? "Importing..." : "Upload Exported Project"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {mode === "import-encrypted" && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal modal--help" onClick={(e) => e.stopPropagation()}>
            <h2>Import Encrypted Backup</h2>
            <div className="form">
              {!encryptedImportPreview ? (
                <>
                  <p className="import-project-copy">
                    Select a Kanqual encrypted backup file and enter the password used when it was exported.
                  </p>
                  <label className="form-label">
                    Backup password
                    <input
                      className="form-input"
                      type="password"
                      value={encryptedImportPassword}
                      onChange={(e) => {
                        setEncryptedImportPassword(e.target.value);
                        if (error) setError(null);
                      }}
                      placeholder="Enter the encrypted backup password"
                      autoComplete="current-password"
                      autoFocus
                    />
                  </label>
                </>
              ) : (
                <div className="encrypted-backup-preview">
                  <p className="import-project-copy">
                    Review the encrypted backup metadata below, then confirm the import.
                  </p>
                  <div className="encrypted-backup-preview__grid">
                    <div>
                      <strong>Project</strong>
                      <span>{encryptedImportPreview.projectName || "Imported Project"}</span>
                    </div>
                    <div>
                      <strong>Created</strong>
                      <span>{encryptedImportPreview.createdAt ? new Date(encryptedImportPreview.createdAt).toLocaleString() : "-"}</span>
                    </div>
                    <div>
                      <strong>Backup version</strong>
                      <span>{encryptedImportPreview.version ?? "-"}</span>
                    </div>
                    <div>
                      <strong>Source</strong>
                      <span>Encrypted KanQual backup (.kqbe)</span>
                    </div>
                  </div>
                </div>
              )}
              {error && <p className="auth-error">{error}</p>}
              <div className="form-actions">
                {!encryptedImportPreview ? (
                  <>
                    <button type="button" className="btn" onClick={() => goToMode("choice")} disabled={importing}>
                      Back
                    </button>
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={handleImportEncryptedProject}
                      disabled={importing || !encryptedImportPassword}
                    >
                      {importing ? "Reading..." : "Select and Preview Backup"}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setEncryptedImportSource(null);
                        setEncryptedImportPreview(null);
                        setError(null);
                      }}
                      disabled={importing}
                    >
                      Choose Different Backup
                    </button>
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={handleConfirmEncryptedProjectImport}
                      disabled={importing}
                    >
                      {importing ? "Importing..." : "Confirm Import"}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {mode === "import-refi" && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Import REFI-QDA Project</h2>
            <div className="form">
              <p className="import-project-copy">
                Select a REFI-QDA .qdpx file. Kanqual will import text sources, codes,
                coded selections, cases, source links, variables, and notes where available.
              </p>
              {error && <p className="auth-error">{error}</p>}
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => goToMode("choice")} disabled={importing}>
                  Back
                </button>
                <button type="button" className="btn btn--primary" onClick={handleImportRefiProject} disabled={importing}>
                  {importing ? "Importing..." : "Upload QDPX Project"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteProject && (
        <div className="modal-overlay" onClick={closeDeleteModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Delete Project</h2>
            <form className="form" onSubmit={handleDeleteProject}>
              <p className="import-project-copy">
                This permanently deletes the project and all of its documents, cases, codes, annotations, and reports.
              </p>
              <p className="import-project-copy">
                Type <strong>{confirmDeleteProject.name}</strong> to confirm.
              </p>
              <label className="form-label">
                Project name
                <input
                  className="form-input"
                  value={deleteConfirmationName}
                  onChange={(e) => {
                    setDeleteConfirmationName(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder={confirmDeleteProject.name}
                  autoFocus
                />
              </label>
              {error && <p className="auth-error">{error}</p>}
              <div className="form-actions">
                <button type="button" className="btn" onClick={closeDeleteModal} disabled={deletingProjectId !== null}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn--danger"
                  disabled={!canConfirmDelete || deletingProjectId !== null}
                >
                  {deletingProjectId === confirmDeleteProject.id ? "Deleting..." : "Delete Project"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {importCompleteProject && (
        <div className="modal-overlay">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="project-import-complete-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="project-import-complete-title">Project Import Complete</h2>
            <p className="import-project-copy">
              {importSuccessMessage ?? "All users should have access to the project with their existing credentials."}
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  const project = importCompleteProject;
                  setImportCompleteProject(null);
                  setImportSuccessMessage(null);
                  openProject(project, activeProject);
                }}
              >
                Go to Project Home
              </button>
            </div>
          </div>
        </div>
      )}

      {resolutionIntro && (
        <div className="modal-overlay">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="project-import-resolution-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="project-import-resolution-title">User Accounts Need Review</h2>
            <div className="form">
              {resolutionIntro.notes.map((note) => (
                <p key={note} className="import-project-copy">{note}</p>
              ))}
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  setPendingImportedUserResolution({
                    projectId: resolutionIntro.project.id,
                    projectName: resolutionIntro.project.name,
                    source: "import",
                    mismatchNotes: resolutionIntro.notes,
                    users: resolutionIntro.users,
                  });
                  const project = resolutionIntro.project;
                  setResolutionIntro(null);
                  void openProjectToView(project, "users", activeProject);
                }}
              >
                Configure Users
              </button>
            </div>
          </div>
        </div>
      )}

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Projects Help</h2>
            <div className="app-settings-modal-body">
              <p className="settings-section-desc">
                The Projects page is where you open, create, import, and manage projects available in the current workspace.
              </p>
              <ul className="settings-help-list">
                <li>On a local workspace, use New Project to create an empty project or import an existing one.</li>
                <li>KanQual can import plain JSON backups, encrypted backups, and REFI-QDA .qdpx projects.</li>
                <li>Project deletion is limited to project owners and requires typing the project name to confirm.</li>
                <li>When imports include users that do not match this workspace, KanQual will pause and ask you to resolve those accounts.</li>
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

      {projectsLoading ? (
        <div className="empty-state">
          <p>Loading projects...</p>
        </div>
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <p>No projects yet. Create one to get started.</p>
        </div>
      ) : (
        <>
          {error && <p className="auth-error">{error}</p>}
          <ul className="project-list">
            {projects.map((p: Project) => (
              <li key={p.id} className="project-card" onClick={() => openProject(p, activeProject)}>
                <div
                  className="project-card-header"
                  ref={menuProjectId === p.id ? menuRef : null}
                >
                  <div className="project-card-name">{p.name}</div>
                  <div className="project-card-topbar">
                    <button
                      type="button"
                      className="btn home-menu-btn project-card-menu-button"
                      aria-label={`Project actions for ${p.name}`}
                      aria-expanded={menuProjectId === p.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuProjectId((current) => current === p.id ? null : p.id);
                      }}
                    >
                      <span aria-hidden="true" />
                      <span aria-hidden="true" />
                      <span aria-hidden="true" />
                    </button>
                    {menuProjectId === p.id && (
                      <div
                        className="project-card-menu"
                        role="menu"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="project-card-menu-item"
                          role="menuitem"
                          onClick={() => {
                            setMenuProjectId(null);
                            openProject(p, activeProject);
                          }}
                        >
                          Open Project
                        </button>
                        {ownedProjectIds.has(p.id) && (
                          <button
                            type="button"
                            className="project-card-menu-item project-card-menu-item--danger"
                            role="menuitem"
                            onClick={() => {
                              setMenuProjectId(null);
                              setError(null);
                              setConfirmDeleteProject(p);
                              setDeleteConfirmationName("");
                            }}
                          >
                            Delete Project
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {htmlToPlainText(p.description) && (
                  <div className="project-card-desc">{htmlToPlainText(p.description)}</div>
                )}
                <div className="project-card-meta">
                  {p.createdBy && (
                    <div className="project-card-meta-row">
                      <span className="project-card-meta-label">Created by</span>
                      <span>{p.createdBy}</span>
                    </div>
                  )}
                  <div className="project-card-meta-row">
                    <span className="project-card-meta-label">Created</span>
                    <span>{new Date(p.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div className="project-card-meta-row">
                    <span className="project-card-meta-label">Last updated</span>
                    <span>{new Date(p.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
