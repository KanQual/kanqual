import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile, readTextFile } from "@tauri-apps/plugin-fs";
import { useStore } from "../context/StoreContext";
import { useAuth } from "../context/AuthContext";
import { importProjectBackupIntoProject, importRefiQdaIntoProject, parseProjectBackupJson, parseRefiQdaProject } from "../lib/projectExport";
import type { Project } from "../types";

const LOCAL_PB_URL = "http://127.0.0.1:8090";
type NewProjectMode = "choice" | "create" | "import" | "import-refi" | null;

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

export function ProjectsView() {
  const { pb, projects, projectsLoading, createProject, openProject, activeProject } = useStore();
  const { serverUrl } = useAuth();
  const isLocal = serverUrl === LOCAL_PB_URL;
  const [mode, setMode] = useState<NewProjectMode>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function closeModal() {
    if (submitting || importing) return;
    setMode(null);
    setError(null);
  }

  function goToMode(nextMode: NewProjectMode) {
    setError(null);
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
      await importProjectBackupIntoProject(pb, data, project.id);
      setMode(null);
      openProject(project, activeProject);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import project");
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
      setMode(null);
      openProject(project, activeProject);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import REFI-QDA project");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="view projects-view">
      <header className="view-header">
        <h1>Projects</h1>
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
            <div className="new-project-options">
              <button className="mode-option" onClick={() => goToMode("create")}>
                <span className="mode-option-title">Create Empty Project</span>
                <span className="mode-option-desc">Start from scratch with a blank Kanqual project.</span>
              </button>
              <button className="mode-option" onClick={() => goToMode("import")}>
                <span className="mode-option-title">Import Project</span>
                <span className="mode-option-desc">Upload a Kanqual JSON backup exported from Project Settings.</span>
              </button>
              <button className="mode-option" onClick={() => goToMode("import-refi")}>
                <span className="mode-option-title">Import REFI-QDA Project</span>
                <span className="mode-option-desc">Upload a standard .qdpx file from Kanqual, QualCoder, or another QDA tool.</span>
              </button>
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

      {projectsLoading ? (
        <div className="empty-state">
          <p>Loading projects...</p>
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
      )}
    </div>
  );
}
