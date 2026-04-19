import { useState } from "react";
import { useStore } from "../context/StoreContext";
import { useAuth } from "../context/AuthContext";
import type { Project } from "../types";

const LOCAL_PB_URL = "http://127.0.0.1:8090";

export function ProjectsView() {
  const { projects, projectsLoading, createProject, openProject, activeProject } = useStore();
  const { serverUrl } = useAuth();
  const isLocal = serverUrl === LOCAL_PB_URL;
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const project = await createProject(name.trim(), description.trim());
      setName("");
      setDescription("");
      setShowForm(false);
      openProject(project, activeProject);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="view projects-view">
      <header className="view-header">
        <h1>Projects</h1>
        {isLocal && (
          <button className="btn btn--primary" onClick={() => setShowForm(true)}>
            + New Project
          </button>
        )}
      </header>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>New Project</h2>
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
                <button type="button" className="btn" onClick={() => setShowForm(false)} disabled={submitting}>
                  Cancel
                </button>
                <button type="submit" className="btn btn--primary" disabled={!name.trim() || submitting}>
                  {submitting ? "Creating…" : "Create & Open"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {projectsLoading ? (
        <div className="empty-state">
          <p>Loading projects…</p>
        </div>
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <p>No projects yet. Create one to get started.</p>
        </div>
      ) : (
        <ul className="project-list">
          {projects.map((p: Project) => (
            <li key={p.id} className="project-card" onClick={() => openProject(p, activeProject)}>
              <div className="project-card-name">{p.name}</div>
              {p.description && (
                <div className="project-card-desc">{p.description}</div>
              )}
              <div className="project-card-meta">
                Created {new Date(p.createdAt).toLocaleDateString()}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
