import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../context/StoreContext";
import { AIAnalyzeView as AIAnalyzeWorkspaceView, parseAiAnalysisRowRecord, type AiAnalysisRow } from "./AIAssist_Code_Annotate_View";
import { HelpIcon } from "../components/AppIcons";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import { formatCurrentDateTime } from "../i18n/formatters";
import { useI18n } from "../i18n/provider";

function fmtDate(iso: string): string {
  if (!iso) return "";
  try {
    return formatCurrentDateTime(iso, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function AIAnalyzeView() {
  const { t } = useI18n();
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
  const analysisCols: Array<{ key: "name" | "createdByName" | "createdAt" | "actions"; label: string; width: string }> = [
    { key: "name", label: t("aiAssist.analyze.table.name"), width: "42%" },
    { key: "createdByName", label: t("aiAssist.analyze.table.createdBy"), width: "22%" },
    { key: "createdAt", label: t("aiAssist.analyze.table.created"), width: "22%" },
    { key: "actions", label: "", width: "14%" },
  ];

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
      setError(loadError instanceof Error ? loadError.message : t("aiAssist.analyze.errors.failedToLoadAnalyses"));
    } finally {
      setLoading(false);
    }
  }, [activeProject, pb, t]);

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
      setError(deleteError instanceof Error ? deleteError.message : t("aiAssist.analyze.errors.failedToDeleteAnalysis"));
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
          <h1>{t("aiAssist.analyze.pageTitle")}</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            aria-label={t("aiAssist.analyze.openHelp")}
            title={t("aiAssist.analyze.openHelp")}
            onClick={() => setHelpOpen(true)}
          >
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
        <button
          className="btn btn--primary"
          onClick={() => { setOpenRow(null); setCreatingNew(true); }}
          disabled={!canStartAnalysis}
          title={
            !activeProject
              ? t("aiAssist.analyze.empty.openProjectFirst")
              : !canUseAiAnalyzeTools
                ? t("aiAssist.analyze.empty.noPermission")
                : !aiAssistEnabledForProject
                  ? t("aiAssist.analyze.empty.enableInProjectSettings")
                  : undefined
          }
        >
          {t("aiAssist.analyze.actions.newAnalysis")}
        </button>
      </header>

      {error && <p className="users-error">{error}</p>}

      <div className="users-content">
        <section className="users-layout-main">
          <div className="users-table-wrap" style={{ maxHeight: 34 + (Math.max(loading || rows.length === 0 ? 1 : rows.length, 1) + 2) * 36 }}>
            <table className="users-table">
              <thead>
                <tr>
                  {analysisCols.map((col) => (
                    <th key={col.key} style={{ width: col.width }} className="users-th">
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={analysisCols.length} className="users-td-msg">{t("aiAssist.analyze.statuses.loading")}</td>
                  </tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={analysisCols.length} className="users-td-msg">{t("aiAssist.analyze.empty.noSavedAnalyses")}</td>
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
                    <td className="users-td users-td--muted">{t("aiAssist.analyze.labels.rightClick")}</td>
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
            <h2>{t("aiAssist.analyze.help.title")}</h2>
            <p className="users-guide-copy">
              {t("aiAssist.analyze.help.line1")}
            </p>
            <p className="users-guide-copy">
              {t("aiAssist.analyze.help.line2")}
            </p>
            <p className="users-guide-copy">
              {t("aiAssist.analyze.help.line3")}
            </p>
            <div className="form-actions">
              <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>
                {t("common.close")}
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
            {t("aiAssist.analyze.actions.openAnalysis")}
          </button>
          {canDeleteSavedAnalyses ? (
            <button
              className="context-menu-item context-menu-item--danger"
              onClick={() => {
                setConfirmDelete(contextMenu.row);
                setContextMenu(null);
              }}
            >
              {t("aiAssist.analyze.actions.deleteAnalysis")}
            </button>
          ) : (
            <div className="context-menu-item context-menu-item--disabled" title={t("aiAssist.analyze.labels.onlyEditorsOwnersDelete")}>
              {t("aiAssist.analyze.actions.deleteAnalysis")}
            </div>
          )}
        </div>
      )}

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => !deleteBusy && setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t("aiAssist.analyze.modals.deleteAnalysis.title")}</h2>
            <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
              {t("aiAssist.analyze.modals.deleteAnalysis.body")} <strong>{confirmDelete.name}</strong>?
            </p>
            <p className="modal-warning-text">{t("aiAssist.analyze.modals.deleteAnalysis.warning")}</p>
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button className="btn" onClick={() => setConfirmDelete(null)} disabled={deleteBusy}>{t("common.cancel")}</button>
              <button className="btn btn--danger" onClick={() => void handleDelete()} disabled={deleteBusy}>
                {deleteBusy ? t("aiAssist.analyze.statuses.deleting") : t("aiAssist.analyze.actions.deleteAnalysis")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
