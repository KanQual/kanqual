import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { formatCurrentDateTime } from "../i18n/formatters";
import {
  createPostgresProject,
  deletePostgresProject,
  getPostgresInstallationSettings,
  getPostgresUserProjectState,
  listPostgresProjects,
  POSTGRES_PROJECT_CHANGED_EVENT,
  rememberPostgresProjectOpened,
  removePostgresProjectFromState,
  type PostgresProject,
  type PostgresProjectChangeEvent,
  type PostgresRecentProject,
  updatePostgresProject,
} from "../lib/postgres";

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export type PostgresProjectsViewProps = {
  renderProjectHome: (
    project: PostgresProject,
    helpers: {
      onBack: () => void;
      onProjectUpdated: (project: PostgresProject) => void;
      onProjectDeleted: (projectId: string) => void;
    },
  ) => ReactNode;
};

export function PostgresProjectsView({
  renderProjectHome,
}: PostgresProjectsViewProps) {
  const [projects, setProjects] = useState<PostgresProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [openedProjectId, setOpenedProjectId] = useState<string | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState("");
  const [editingProjectDescription, setEditingProjectDescription] = useState("");
  const [removingProjectId, setRemovingProjectId] = useState<string | null>(null);
  const [deleteConfirmationName, setDeleteConfirmationName] = useState("");
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [menuProjectId, setMenuProjectId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const recordProjectOpened = useCallback(async (project: PostgresProject) => {
    const recentProject: PostgresRecentProject = {
      id: project.id,
      name: project.name,
      description: project.description,
      openedAt: new Date().toISOString(),
    };
    try {
      await rememberPostgresProjectOpened(recentProject);
    } catch (rememberError) {
      console.warn("Could not persist PostgreSQL recent project state:", describeUnknownError(rememberError));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadProjects() {
      setLoading(true);
      setError("");
      try {
        const [nextProjects, installationSettings, projectState] = await Promise.all([
          listPostgresProjects(),
          getPostgresInstallationSettings(),
          getPostgresUserProjectState(),
        ]);
        if (!cancelled) {
          setProjects(nextProjects);
          const reopenProjectId = installationSettings.startupReopenLastProject
            ? projectState.lastOpenedProjectId
            : null;
          const reopenProject = reopenProjectId
            ? nextProjects.find((project) => project.id === reopenProjectId) ?? null
            : null;
          setSelectedProjectId((current) => current ?? reopenProject?.id ?? nextProjects[0]?.id ?? null);
          setOpenedProjectId((current) => current ?? reopenProject?.id ?? null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setProjects([]);
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadProjects();
    return () => {
      cancelled = true;
    };
  }, []);

  const openedProject = projects.find((project) => project.id === openedProjectId) ?? null;
  const projectPendingDelete = projects.find((project) => project.id === removingProjectId) ?? null;
  const canConfirmDelete = !!projectPendingDelete
    && deleteConfirmationName.trim() === projectPendingDelete.name.trim();

  const refreshProjects = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const nextProjects = await listPostgresProjects();
      setProjects(nextProjects);
      setSelectedProjectId((current) => {
        if (current && nextProjects.some((project) => project.id === current)) return current;
        return nextProjects[0]?.id ?? null;
      });
    } catch (refreshError) {
      setProjects([]);
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setLoading(false);
    }
  }, []);

  async function handleCreateProject(event: React.FormEvent<HTMLFormElement>): Promise<boolean> {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!name.trim()) {
      setError("Enter a project name for the PostgreSQL.");
      return false;
    }

    setSubmitting(true);
    try {
      const created = await createPostgresProject({
        name: name.trim(),
        description: description.trim(),
      });
      await recordProjectOpened(created);
      setProjects((current) => [created, ...current.filter((project) => project.id !== created.id)]);
      setSelectedProjectId(created.id);
      setOpenedProjectId(created.id);
      setName("");
      setDescription("");
      setNotice(`Created PostgreSQL project "${created.name}".`);
      return true;
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveProject() {
    if (!editingProjectId || !editingProjectName.trim()) {
      setError("Enter a project name for the PostgreSQL.");
      return;
    }

    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const updated = await updatePostgresProject({
        projectId: editingProjectId,
        name: editingProjectName.trim(),
        description: editingProjectDescription.trim(),
      });
      setProjects((current) => current.map((project) => (project.id === updated.id ? updated : project)));
      setSelectedProjectId(updated.id);
      setEditingProjectId(null);
      setNotice(`Updated PostgreSQL project "${updated.name}".`);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteProject(projectId: string) {
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      await deletePostgresProject(projectId);
      await removePostgresProjectFromState(projectId);
      setProjects((current) => current.filter((project) => project.id !== projectId));
      setSelectedProjectId((current) => (current === projectId ? null : current));
      setOpenedProjectId((current) => (current === projectId ? null : current));
      setRemovingProjectId(null);
      setDeleteConfirmationName("");
      setNotice("Deleted PostgreSQL project.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    async function subscribeToProjectChanges() {
      unlisten = await listen<PostgresProjectChangeEvent>(POSTGRES_PROJECT_CHANGED_EVENT, (event) => {
        if (disposed) return;
        if (event.payload.entityType !== "project") return;
        void refreshProjects();
      });
    }

    void subscribeToProjectChanges();
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [refreshProjects]);

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

  if (openedProject) {
    return renderProjectHome(openedProject, {
      onBack: () => setOpenedProjectId(null),
      onProjectUpdated: (updatedProject) => {
        setProjects((current) => current.map((project) => (project.id === updatedProject.id ? updatedProject : project)));
        setSelectedProjectId(updatedProject.id);
      },
      onProjectDeleted: (projectId) => {
        setProjects((current) => current.filter((project) => project.id !== projectId));
        setSelectedProjectId((current) => (current === projectId ? null : current));
        setOpenedProjectId((current) => (current === projectId ? null : current));
      },
    });
  }

  return (
    <div className="app-shell">
      <main className="app-main">
        <div className="view projects-view">
          <header className="view-header">
            <div className="view-title-with-help">
              <h1>Projects</h1>
            </div>
            <div className="view-header-actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  setError("");
                  setNotice("");
                  setName("");
                  setDescription("");
                  setCreateProjectOpen(true);
                }}
              >
                New Project
              </button>
            </div>
          </header>

          {notice ? <p className="settings-success">{notice}</p> : null}
          {error ? <p className="auth-error">{error}</p> : null}

          {loading ? (
            <div className="empty-state">
              <p>Loading PostgreSQL projects...</p>
            </div>
          ) : projects.length === 0 ? (
            <div className="empty-state">
              <p>No PostgreSQL projects yet.</p>
              <div className="form-actions" style={{ justifyContent: "center", marginTop: 16 }}>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => {
                    setError("");
                    setNotice("");
                    setName("");
                    setDescription("");
                    setCreateProjectOpen(true);
                  }}
                >
                  Create your first project
                </button>
              </div>
            </div>
          ) : (
            <ul className="project-list">
              {projects.map((project) => (
                <li
                  key={project.id}
                  className="project-card"
                  onClick={() => {
                    setSelectedProjectId(project.id);
                    setOpenedProjectId(project.id);
                    void recordProjectOpened(project);
                  }}
                  style={{
                    cursor: "pointer",
                    outline: selectedProjectId === project.id ? "2px solid var(--color-primary)" : undefined,
                  }}
                >
                  <div
                    className="project-card-header"
                    ref={menuProjectId === project.id ? menuRef : null}
                  >
                    <div className="project-card-name">{project.name}</div>
                    <div className="project-card-topbar">
                      <button
                        type="button"
                        className="btn project-card-menu-button"
                        aria-label={`Actions for ${project.name}`}
                        aria-expanded={menuProjectId === project.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          setMenuProjectId((current) => (current === project.id ? null : project.id));
                        }}
                      >
                        Actions
                      </button>
                      {menuProjectId === project.id ? (
                        <div
                          className="project-card-menu"
                          role="menu"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="project-card-menu-item"
                            role="menuitem"
                            onClick={() => {
                              setMenuProjectId(null);
                              setSelectedProjectId(project.id);
                              setOpenedProjectId(project.id);
                              void recordProjectOpened(project);
                            }}
                          >
                            Open project
                          </button>
                          <button
                            type="button"
                            className="project-card-menu-item"
                            role="menuitem"
                            onClick={() => {
                              setMenuProjectId(null);
                              setEditingProjectId(project.id);
                              setEditingProjectName(project.name);
                              setEditingProjectDescription(project.description);
                            }}
                            disabled={submitting}
                          >
                            Edit project
                          </button>
                          <button
                            type="button"
                            className="project-card-menu-item project-card-menu-item--danger"
                            role="menuitem"
                            onClick={() => {
                              setMenuProjectId(null);
                              setDeleteConfirmationName("");
                              setRemovingProjectId(project.id);
                            }}
                            disabled={submitting}
                          >
                            Delete project
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="project-card-desc">{project.description || "No description yet."}</div>
                  <div className="project-card-meta">
                    <div className="project-card-meta-row">
                      <span className="project-card-meta-label">Created</span>
                      <span>{formatCurrentDateTime(project.createdAt)}</span>
                    </div>
                    <div className="project-card-meta-row">
                      <span className="project-card-meta-label">Updated</span>
                      <span>{formatCurrentDateTime(project.updatedAt)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {createProjectOpen ? (
            <div className="modal-overlay" onClick={() => !submitting && setCreateProjectOpen(false)}>
              <div className="modal" onClick={(event) => event.stopPropagation()}>
                <h2>New Project</h2>
                <form
                  onSubmit={async (event) => {
                    const created = await handleCreateProject(event);
                    if (created) {
                      setCreateProjectOpen(false);
                    }
                  }}
                  className="form"
                >
                  <label className="form-label">
                    Project name
                    <input
                      className="form-input"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="e.g. Dynamic Objects Pilot"
                      autoFocus
                    />
                  </label>
                  <label className="form-label">
                    Description
                    <textarea
                      className="form-input form-textarea"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="Short note about this project"
                      rows={3}
                    />
                  </label>
                  <div className="form-actions">
                    <button type="button" className="btn" onClick={() => setCreateProjectOpen(false)} disabled={submitting}>
                      Cancel
                    </button>
                    <button type="submit" className="btn btn--primary" disabled={submitting || !name.trim()}>
                      {submitting ? "Creating..." : "Create project"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}

          {editingProjectId ? (
            <div className="modal-overlay" onClick={() => !submitting && setEditingProjectId(null)}>
              <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
                <h2>Edit project</h2>
                <div className="form">
                  <label className="form-label">
                    Project name
                    <input
                      className="form-input"
                      value={editingProjectName}
                      onChange={(event) => setEditingProjectName(event.target.value)}
                      autoFocus
                    />
                  </label>
                  <label className="form-label">
                    Description
                    <textarea
                      className="form-input form-textarea"
                      rows={3}
                      value={editingProjectDescription}
                      onChange={(event) => setEditingProjectDescription(event.target.value)}
                    />
                  </label>
                  <div className="form-actions">
                    <button type="button" className="btn" onClick={() => setEditingProjectId(null)} disabled={submitting}>
                      Cancel
                    </button>
                    <button type="button" className="btn btn--primary" onClick={() => void handleSaveProject()} disabled={submitting || !editingProjectName.trim()}>
                      {submitting ? "Saving..." : "Save project"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {projectPendingDelete ? (
            <div className="modal-overlay" onClick={() => {
              if (submitting) return;
              setRemovingProjectId(null);
              setDeleteConfirmationName("");
            }}>
              <div className="modal" onClick={(event) => event.stopPropagation()}>
                <h2>Delete project</h2>
                <div className="form">
                  <p className="import-project-copy">
                    This permanently deletes the PostgreSQL project and its local database, files, objects, relationships, and memberships.
                  </p>
                  <p className="import-project-copy">
                    Type <strong>{projectPendingDelete.name}</strong> to confirm.
                  </p>
                  <label className="form-label">
                    Project name
                    <input
                      className="form-input"
                      value={deleteConfirmationName}
                      onChange={(event) => {
                        setDeleteConfirmationName(event.target.value);
                        if (error) setError("");
                      }}
                      placeholder={projectPendingDelete.name}
                      autoFocus
                    />
                  </label>
                  <p className="modal-warning-text">
                    This removes the project record, drops the project database, and deletes the linked project storage directory.
                  </p>
                  <div className="form-actions">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setRemovingProjectId(null);
                        setDeleteConfirmationName("");
                      }}
                      disabled={submitting}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn--danger"
                      onClick={() => void handleDeleteProject(projectPendingDelete.id)}
                      disabled={submitting || !canConfirmDelete}
                    >
                      {submitting ? "Deleting..." : "Delete project"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
