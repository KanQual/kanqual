import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { useStore } from "../context/StoreContext";
import {
  fetchProjectExportData,
  importRefiQdaCodebookIntoProject,
  makeProjectBackupJson,
  makeProjectBackupXlsx,
  makeRefiQdaCodebook,
  makeRefiQdaProject,
  parseRefiQdaCodebook,
} from "../lib/projectExport";

function safeExportName(name: string): string {
  return name.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "Kanqual_Project";
}

export function ProjectSettingsView() {
  const { pb, activeProject, userRole, setView, logAction, updateProject } = useStore();
  const [exporting, setExporting] = useState<"json" | "xlsx" | "qdpx" | null>(null);
  const [codebookBusy, setCodebookBusy] = useState<"export" | "import" | null>(null);
  const [exportError, setExportError] = useState("");
  const [codebookError, setCodebookError] = useState("");
  const [codebookImportResult, setCodebookImportResult] = useState<{ importedCount: number } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsName, setDetailsName] = useState("");
  const [detailsDescription, setDetailsDescription] = useState("");
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [detailsError, setDetailsError] = useState("");

  function openDetailsModal() {
    if (!activeProject) return;
    setDetailsName(activeProject.name);
    setDetailsDescription(activeProject.description);
    setDetailsError("");
    setDetailsOpen(true);
  }

  async function handleDetailsSave(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeProject || !detailsName.trim()) return;
    setDetailsSaving(true);
    setDetailsError("");
    try {
      await updateProject(activeProject.id, {
        name: detailsName.trim(),
        description: detailsDescription.trim(),
      });
      setDetailsOpen(false);
    } catch (error) {
      console.error("Project details update failed:", error);
      setDetailsError(error instanceof Error ? error.message : "Project details update failed. Please try again.");
    } finally {
      setDetailsSaving(false);
    }
  }

  async function handleExport(format: "json" | "xlsx" | "qdpx") {
    if (!activeProject || userRole !== "owner") return;
    setExporting(format);
    setExportError("");
    try {
      const extension = format === "json" ? "json" : format === "xlsx" ? "xlsx" : "qdpx";
      const path = await save({
        defaultPath: `${safeExportName(activeProject.name)}_export.${extension}`,
        filters: [
          format === "json"
            ? { name: "Kanqual JSON Backup", extensions: ["json"] }
            : format === "xlsx"
              ? { name: "Excel Workbook", extensions: ["xlsx"] }
              : { name: "REFI-QDA Project", extensions: ["qdpx"] },
        ],
      });
      if (!path) return;

      const data = await fetchProjectExportData(pb, activeProject);
      if (format === "json") {
        await writeTextFile(path, makeProjectBackupJson(data));
      } else if (format === "xlsx") {
        await writeFile(path, makeProjectBackupXlsx(data));
      } else {
        await writeFile(path, makeRefiQdaProject(data));
      }
      await logAction(activeProject.id, "project.export", `Exported project as ${format.toUpperCase()}`);
    } catch (error) {
      console.error("Project export failed:", error);
      setExportError("Project export failed. Please try again.");
    } finally {
      setExporting(null);
    }
  }

  async function handleCodebookExport() {
    if (!activeProject || userRole !== "owner") return;
    setCodebookBusy("export");
    setCodebookError("");
    try {
      const path = await save({
        defaultPath: `${safeExportName(activeProject.name)}_codebook.qdc`,
        filters: [{ name: "REFI-QDA Codebook", extensions: ["qdc", "xml"] }],
      });
      if (!path) return;

      const data = await fetchProjectExportData(pb, activeProject);
      await writeTextFile(path, makeRefiQdaCodebook(data));
      await logAction(activeProject.id, "codebook.export", "Exported REFI-QDA codebook");
    } catch (error) {
      console.error("Codebook export failed:", error);
      setCodebookError("Codebook export failed. Please try again.");
    } finally {
      setCodebookBusy(null);
    }
  }

  async function handleCodebookImport() {
    if (!activeProject || userRole !== "owner") return;
    setCodebookBusy("import");
    setCodebookError("");
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "REFI-QDA Codebook", extensions: ["qdc", "xml"] }],
      });
      if (!selected || Array.isArray(selected)) return;

      const raw = await readTextFile(selected);
      const codes = parseRefiQdaCodebook(raw);
      const summary = await importRefiQdaCodebookIntoProject(pb, codes, activeProject.id);
      const importedCount = summary.tableCounts.codes ?? 0;
      await logAction(activeProject.id, "codebook.import", `Imported REFI-QDA codebook (${importedCount} codes)`);
      setCodebookImportResult({ importedCount });
    } catch (error) {
      console.error("Codebook import failed:", error);
      setCodebookError(error instanceof Error ? error.message : "Codebook import failed. Please try again.");
    } finally {
      setCodebookBusy(null);
    }
  }

  if (!activeProject) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>Project Settings</h1>
        </header>
        <div className="empty-state">
          <p>Open a project first.</p>
        </div>
      </div>
    );
  }

  if (userRole !== "owner") {
    return (
      <div className="view">
        <header className="view-header">
          <h1>Project Settings</h1>
          <button className="btn" onClick={() => setView("home")}>Back to Home</button>
        </header>
        <div className="empty-state">
          <p>Project settings are only available to project owners.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="view project-settings-view">
      <header className="view-header">
        <div>
          <h1>Project Settings</h1>
          <span className="view-header-sub">{activeProject.name}</span>
        </div>
        <button className="btn" onClick={() => setView("home")}>Back to Home</button>
      </header>

      <section className="settings-section settings-section--wide">
        <div className="settings-section-header">
          <div>
            <h2 className="settings-section-title">Project Details</h2>
            <p className="settings-section-desc">
              Update the project name and read-only description shown on Project Home.
            </p>
          </div>
        </div>

        <div className="project-details-card">
          <div>
            <div className="project-details-name">{activeProject.name}</div>
            <p className={activeProject.description ? "project-details-description" : "project-details-description project-details-description--empty"}>
              {activeProject.description || "No project description has been added yet."}
            </p>
          </div>
          <button className="btn btn--primary" onClick={openDetailsModal}>
            Edit Project Details
          </button>
        </div>
      </section>

      <section className="settings-section settings-section--wide">
        <div className="settings-section-header">
          <div>
            <h2 className="settings-section-title">Project Export</h2>
            <p className="settings-section-desc">
              Create a complete project backup or a spreadsheet workbook for review and migration.
            </p>
          </div>
        </div>

        {exportError && <div className="form-error project-settings-error">{exportError}</div>}

        <div className="project-export-actions">
          <button className="btn" onClick={() => handleExport("json")} disabled={!!exporting}>
            {exporting === "json" ? "Exporting..." : "Export JSON Backup"}
          </button>
          <button className="btn btn--primary" onClick={() => handleExport("xlsx")} disabled={!!exporting}>
            {exporting === "xlsx" ? "Exporting..." : "Export Excel Workbook"}
          </button>
          <button className="btn btn--primary" onClick={() => handleExport("qdpx")} disabled={!!exporting}>
            {exporting === "qdpx" ? "Exporting..." : "Export REFI-QDA Project"}
          </button>
        </div>
      </section>

      <section className="settings-section settings-section--wide">
        <div className="settings-section-header">
          <div>
            <h2 className="settings-section-title">Codebook Exchange</h2>
            <p className="settings-section-desc">
              Export or import only the project code hierarchy using the REFI-QDA Codebook .qdc standard.
            </p>
          </div>
        </div>

        {codebookError && <div className="form-error project-settings-error">{codebookError}</div>}

        <div className="project-export-actions">
          <button className="btn" onClick={handleCodebookImport} disabled={!!codebookBusy}>
            {codebookBusy === "import" ? "Importing..." : "Import REFI-QDA Codebook"}
          </button>
          <button className="btn btn--primary" onClick={handleCodebookExport} disabled={!!codebookBusy}>
            {codebookBusy === "export" ? "Exporting..." : "Export REFI-QDA Codebook"}
          </button>
        </div>
      </section>

      {codebookImportResult && (
        <div className="modal-overlay">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="codebook-import-title">
            <h2 id="codebook-import-title">Codebook Imported</h2>
            <p className="import-project-copy">
              Imported {codebookImportResult.importedCount} code{codebookImportResult.importedCount === 1 ? "" : "s"} into this project.
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  setCodebookImportResult(null);
                  setView("codebook");
                }}
                autoFocus
              >
                View Codebook
              </button>
            </div>
          </div>
        </div>
      )}

      {detailsOpen && (
        <div className="modal-overlay" onClick={() => !detailsSaving && setDetailsOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Edit Project Details</h2>
            <form className="form" onSubmit={handleDetailsSave}>
              <label className="form-label">
                Project name
                <input
                  className="form-input"
                  value={detailsName}
                  onChange={(e) => setDetailsName(e.target.value)}
                  disabled={detailsSaving}
                  autoFocus
                />
              </label>
              <label className="form-label">
                Description
                <textarea
                  className="form-input form-textarea"
                  value={detailsDescription}
                  onChange={(e) => setDetailsDescription(e.target.value)}
                  disabled={detailsSaving}
                  rows={5}
                  placeholder="Describe the project for collaborators."
                />
              </label>
              {detailsError && <p className="auth-error">{detailsError}</p>}
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setDetailsOpen(false)} disabled={detailsSaving}>
                  Cancel
                </button>
                <button type="submit" className="btn btn--primary" disabled={!detailsName.trim() || detailsSaving}>
                  {detailsSaving ? "Saving..." : "Save Details"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
