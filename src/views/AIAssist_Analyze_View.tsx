import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../context/StoreContext";
import { AIAnalyzeView as AIAnalyzeWorkspaceView, parseAiAnalysisRowRecord, type AiAnalysisRow } from "./AIAssist_Code_Annotate_View";
import helpIcon from "../assets/ic_help_outline_24px.svg";
import { useViewportContextMenuStyle } from "../lib/contextMenu";

const ANALYSIS_COLS: Array<{ key: "name" | "createdByName" | "createdAt" | "actions"; label: string; width: string }> = [
  { key: "name", label: "Name", width: "42%" },
  { key: "createdByName", label: "Created By", width: "22%" },
  { key: "createdAt", label: "Created", width: "22%" },
  { key: "actions", label: "", width: "14%" },
];

function fmtDate(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function AIAnalyzeView() {
  const { activeProject, pb, canCurrentUser, projectAiAssistSettings, deleteAiAnalysis } = useStore();
  const [openRow, setOpenRow] = useState<AiAnalysisRow | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [rows, setRows] = useState<AiAnalysisRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AiAnalysisRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; row: AiAnalysisRow } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuStyle = useViewportContextMenuStyle(contextMenu, contextMenuRef);

  const canUseAiAnalyzeTools = canCurrentUser("useAiAnalyzeTools");
  const aiAssistEnabledForProject = activeProject ? projectAiAssistSettings.enabled : false;
  const canStartAnalysis = !!activeProject && canUseAiAnalyzeTools && aiAssistEnabledForProject;
  const canDeleteSavedAnalyses = canCurrentUser("deleteReports");

  const loadAnalyses = useCallback(async () => {
    if (!activeProject) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const records = await pb.collection("ai_analyses").getFullList({
        filter: `project="${activeProject.id}"&&deleted_at=""`,
        expand: "created_by",
        sort: "-created",
      });
      const mappedRows = records
        .map((record) => parseAiAnalysisRowRecord(record))
        .filter(Boolean) as AiAnalysisRow[];
      setRows(mappedRows);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load analyses.");
    } finally {
      setLoading(false);
    }
  }, [activeProject, pb]);

  useEffect(() => {
    void loadAnalyses();
  }, [loadAnalyses]);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setContextMenu(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleteBusy(true);
    try {
      await deleteAiAnalysis(confirmDelete.id, confirmDelete.name);
      setRows((prev) => prev.filter((row) => row.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete analysis.");
      setConfirmDelete(null);
    } finally {
      setDeleteBusy(false);
    }
  }

  if (creatingNew || openRow) {
    return (
      <AIAnalyzeWorkspaceView
        onBack={() => { setOpenRow(null); setCreatingNew(false); }}
        initialRow={openRow}
        onStartNew={() => { setOpenRow(null); setCreatingNew(true); }}
        onSaved={(row) => {
          setCreatingNew(false);
          setOpenRow(row);
          setRows((prev) => [row, ...prev.filter((item) => item.id !== row.id)]);
        }}
      />
    );
  }

  return (
    <div className="view users-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>Analyze Codes</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            aria-label="Show analyze help"
            title="Show Help"
            onClick={() => setHelpOpen(true)}
          >
            <img src={helpIcon} alt="" className="users-help-icon" />
          </button>
        </div>
        <button
          className="btn btn--primary"
          onClick={() => { setOpenRow(null); setCreatingNew(true); }}
          disabled={!canStartAnalysis}
          title={
            !activeProject
              ? "Open a project first"
              : !canUseAiAnalyzeTools
                ? "You do not have permission to use AI Assist analyze tools for this project"
                : !aiAssistEnabledForProject
                  ? "Enable AI Assist in Project Settings before using AI analysis tools"
                  : undefined
          }
        >
          + New Analysis
        </button>
      </header>

      {error && <p className="users-error">{error}</p>}

      <div className="users-content">
        <section className="users-layout-main">
          <div className="users-table-wrap" style={{ maxHeight: 34 + (Math.max(loading || rows.length === 0 ? 1 : rows.length, 1) + 2) * 36 }}>
            <table className="users-table">
              <thead>
                <tr>
                  {ANALYSIS_COLS.map((col) => (
                    <th key={col.key} style={{ width: col.width }} className="users-th">
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={ANALYSIS_COLS.length} className="users-td-msg">Loading...</td>
                  </tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={ANALYSIS_COLS.length} className="users-td-msg">No saved analyses yet.</td>
                  </tr>
                )}
                {!loading && rows.map((row) => (
                  <tr
                    key={row.id}
                    className="users-row"
                    onClick={() => setOpenRow(row)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, row });
                    }}
                  >
                    <td className="users-td users-td--name">{row.name}</td>
                    <td className="users-td users-td--muted">{row.createdByName}</td>
                    <td className="users-td users-td--muted">{fmtDate(row.createdAt)}</td>
                    <td className="users-td users-td--muted">Right-click</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal modal--help" onClick={(e) => e.stopPropagation()}>
            <h2>Analyze Help</h2>
            <p className="users-guide-copy">
              Start a new AI analysis from here or reopen a saved analysis from the table.
            </p>
            <p className="users-guide-copy">
              Saved analyses are stored in the project database and keep the selected code plus the generated analysis results.
            </p>
            <p className="users-guide-copy">
              Access depends on your role and whether AI Assist is enabled for the active project.
            </p>
            <div className="form-actions">
              <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <div ref={contextMenuRef} className="context-menu" style={contextMenuStyle}>
          <button
            className="context-menu-item"
            onClick={() => {
              setOpenRow(contextMenu.row);
              setContextMenu(null);
            }}
          >
            Open Analysis
          </button>
          {canDeleteSavedAnalyses ? (
            <button
              className="context-menu-item context-menu-item--danger"
              onClick={() => {
                setConfirmDelete(contextMenu.row);
                setContextMenu(null);
              }}
            >
              Delete Analysis
            </button>
          ) : (
            <div className="context-menu-item context-menu-item--disabled" title="Only editors and owners can delete saved analyses">
              Delete Analysis
            </div>
          )}
        </div>
      )}

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => !deleteBusy && setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Delete Analysis</h2>
            <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
              Are you sure you want to permanently delete <strong>{confirmDelete.name}</strong>?
            </p>
            <p className="modal-warning-text">This saved analysis will be removed from the project list and cannot be recovered.</p>
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button className="btn" onClick={() => setConfirmDelete(null)} disabled={deleteBusy}>Cancel</button>
              <button className="btn btn--danger" onClick={() => void handleDelete()} disabled={deleteBusy}>
                {deleteBusy ? "Deleting..." : "Delete Analysis"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
