import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useStore } from "../context/StoreContext";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import { AIAssistedCodingAnnotateView } from "./AIAssist_Code_Annotate_View";
import { HelpIcon } from "../components/AppIcons";
import { useI18n } from "../i18n/provider";

interface DocCodeRow {
  id: string;
  name: string;
  cases: string[];
  annotationsCount: number;
  codesCount: number;
  coverage: number;
  contentLength: number;
}

type SortCol = "name" | "cases" | "annotationsCount" | "codesCount" | "coverage";
type SortDir = "asc" | "desc";

type DocumentLockSummary = {
  id: string;
  documentId: string;
  documentName: string;
  userId: string;
  userName: string;
  expiresAtMs: number;
};

function coveredChars(intervals: { start: number; end: number }[]): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart = sorted[0].start;
  let curEnd = sorted[0].end;

  for (let i = 1; i < sorted.length; i++) {
    const { start, end } = sorted[i];
    if (start <= curEnd) {
      curEnd = Math.max(curEnd, end);
    } else {
      total += curEnd - curStart;
      curStart = start;
      curEnd = end;
    }
  }

  total += curEnd - curStart;
  return total;
}

function calcCoverage(
  intervals: { start: number; end: number }[],
  contentLength: number,
): number {
  if (contentLength === 0 || intervals.length === 0) return 0;
  return Math.min(100, (coveredChars(intervals) / contentLength) * 100);
}

function fmtCoverage(pct: number): string {
  if (pct === 0) return "0%";
  if (pct >= 100) return "100%";
  return `${pct.toFixed(1)}%`;
}

function CodeDocumentsLanding() {
  const { t } = useI18n();
  const { activeProject, pb, documents, setActiveDocument, canCurrentUser, kickDocumentLock } = useStore();
  const canKickDocumentLock = canCurrentUser("bypassReadOnlyProtections");

  const [rows, setRows] = useState<DocCodeRow[]>([]);
  const [lockMap, setLockMap] = useState<Record<string, DocumentLockSummary>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<SortCol>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; row: DocCodeRow } | null>(null);
  const [kickTarget, setKickTarget] = useState<DocumentLockSummary | null>(null);
  const [kickBusy, setKickBusy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const contextMenuStyle = useViewportContextMenuStyle(contextMenu, contextMenuRef);
  const cols: { key: SortCol; label: string; width: string }[] = [
    { key: "cases", label: t("aiAssist.code.table.cases"), width: "17%" },
    { key: "annotationsCount", label: t("aiAssist.code.table.annotations"), width: "12%" },
    { key: "codesCount", label: t("aiAssist.code.table.codes"), width: "11%" },
    { key: "coverage", label: t("aiAssist.code.table.codeCoverage"), width: "17%" },
  ];

  const currentUserId = pb.authStore.record?.id ?? "";

  const load = useCallback(async () => {
    if (!activeProject || !pb || documents.length === 0) {
      setRows([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const docIds = documents.map((d) => d.id);
      const filterExpr = docIds.map((id) => `document="${id}"`).join(" || ");

      const [allAnnotations, caseDocs] = await Promise.all([
        pb.collection("annotations").getFullList({
          filter: `(${filterExpr})&&deleted_at=""`,
          fields: "id,document,code,start_offset,end_offset",
        }),
        pb.collection("case_documents").getFullList({
          filter: filterExpr,
          expand: "case",
          fields: "document,case,expand",
        }),
      ]);

      const annByDoc: Record<string, typeof allAnnotations> = {};
      for (const ann of allAnnotations) {
        (annByDoc[ann.document] ??= []).push(ann);
      }

      const casesByDoc: Record<string, string[]> = {};
      for (const cd of caseDocs) {
        (casesByDoc[cd.document] ??= []).push(cd.expand?.case?.name ?? "-");
      }

      setRows(
        documents.map((doc) => {
          const anns = annByDoc[doc.id] ?? [];
          return {
            id: doc.id,
            name: doc.name,
            cases: casesByDoc[doc.id] ?? [],
            annotationsCount: anns.length,
            codesCount: new Set(anns.map((a) => a.code)).size,
            coverage: calcCoverage(
              anns.map((a) => ({ start: a.start_offset, end: a.end_offset })),
              doc.content?.length ?? 0,
            ),
            contentLength: doc.content?.length ?? 0,
          };
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("aiAssist.code.errors.failedToLoad"));
    } finally {
      setLoading(false);
    }
  }, [activeProject, pb, documents, t]);

  const loadLocks = useCallback(async () => {
    if (!pb || documents.length === 0) {
      setLockMap({});
      return;
    }

    const docIds = documents.map((d) => d.id);
    const filterExpr = docIds.map((id) => `document="${id}"`).join(" || ");

    try {
      const records = await pb.collection("document_locks").getFullList({
        filter: `(${filterExpr})`,
        expand: "document",
        fields: "id,document,user,user_name,expires_at_ms,expand.document.name",
      });

      const now = Date.now();
      const next: Record<string, DocumentLockSummary> = {};

      for (const record of records) {
        const expiresAtMs = Number(record.expires_at_ms ?? 0);
        if (expiresAtMs <= now) {
          void pb.collection("document_locks").delete(record.id).catch(() => {});
          continue;
        }

        const existing = next[record.document];
        if (!existing || expiresAtMs > existing.expiresAtMs) {
          next[record.document] = {
            id: record.id,
            documentId: record.document,
            documentName: String(record.expand?.document?.name ?? t("aiAssist.code.labels.document")),
            userId: String(record.user ?? ""),
            userName: String(record.user_name ?? t("aiAssist.code.labels.anotherUser")),
            expiresAtMs,
          };
        }
      }

      setLockMap(next);
    } catch (e) {
      setError((prev) => prev ?? (e instanceof Error ? e.message : t("aiAssist.code.errors.failedToLoadDocumentLocks")));
    }
  }, [pb, documents, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadLocks();
  }, [loadLocks]);

  useEffect(() => {
    if (!pb || documents.length === 0) return;

    const docIdSet = new Set(documents.map((d) => d.id));
    const intervalId = setInterval(() => {
      void loadLocks();
    }, 10000);
    const unsubLocks = pb.collection("document_locks").subscribe("*", (e) => {
      if (!docIdSet.has(String(e.record.document ?? ""))) return;
      void loadLocks();
    });

    return () => {
      clearInterval(intervalId);
      unsubLocks.then((fn) => fn()).catch(() => {});
    };
  }, [pb, documents, loadLocks]);

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

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      let cmp: number;
      if (sortCol === "name") {
        cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      } else if (sortCol === "cases") {
        cmp = a.cases.length - b.cases.length;
      } else {
        cmp = a[sortCol] - b[sortCol];
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortCol, sortDir]);

  function handleSort(col: SortCol) {
    if (col === sortCol) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  function handleRowClick(row: DocCodeRow) {
    const lock = lockMap[row.id];
    if (lock && lock.userId !== currentUserId) return;
    const doc = documents.find((d) => d.id === row.id);
    if (doc) setActiveDocument(doc);
  }

  async function handleKickLock() {
    if (!kickTarget) return;
    setKickBusy(true);
    try {
      await kickDocumentLock(kickTarget);
      setKickTarget(null);
      await loadLocks();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("aiAssist.code.errors.failedToKickUser"));
      setKickTarget(null);
    } finally {
      setKickBusy(false);
    }
  }

  return (
    <div className="view users-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>{t("aiAssist.code.pageTitle")}</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            onClick={() => setHelpOpen(true)}
            title={t("aiAssist.code.openHelp")}
            aria-label={t("aiAssist.code.openHelp")}
          >
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
      </header>

      {error && <p className="users-error">{error}</p>}

      <div className="users-content">
        <div
          className="users-table-wrap"
          style={{
            maxHeight:
              34 + (Math.max(loading || sorted.length === 0 ? 1 : sorted.length, 1) + 2) * 36,
          }}
        >
          <table className="users-table">
              <thead>
                <tr>
                  <th
                    style={{ width: "20%" }}
                    className={`users-th${sortCol === "name" ? " users-th--sorted" : ""}`}
                    onClick={() => handleSort("name")}
                  >
                    {t("aiAssist.code.table.name")}<span className="users-sort-icon">{sortCol === "name" ? (sortDir === "asc" ? " ↑" : " ↓") : " ↕"}</span>
                  </th>
                  {cols.map((col) => (
                    <th
                      key={col.key}
                      style={{ width: col.width }}
                      className={`users-th${sortCol === col.key ? " users-th--sorted" : ""}`}
                      onClick={() => handleSort(col.key)}
                    >
                      {col.label}
                      <span className="users-sort-icon">
                        {sortCol === col.key ? (sortDir === "asc" ? " ↑" : " ↓") : " ↕"}
                      </span>
                    </th>
                  ))}
                  <th style={{ width: "14%" }} className="users-th">{t("aiAssist.code.table.lock")}</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={6} className="users-td-msg">{t("aiAssist.code.statuses.loading")}</td></tr>
                )}
                {!loading && sorted.length === 0 && (
                  <tr>
                    <td colSpan={6} className="users-td-msg">
                      {t("aiAssist.code.empty.noDocumentsYet")}
                    </td>
                  </tr>
                )}
                {!loading && sorted.map((row) => {
                  const lock = lockMap[row.id];
                  const isLockedByOther = !!lock && lock.userId !== currentUserId;
                  const lockLabel = !lock
                    ? t("aiAssist.code.lock.available")
                    : isLockedByOther
                      ? t("aiAssist.code.lock.locked")
                      : t("aiAssist.code.lock.lockedByYou");
                  const lockTitle = !lock
                    ? t("aiAssist.code.lock.noOneAnnotating")
                    : isLockedByOther
                      ? t("aiAssist.code.lock.userAnnotating", { user: lock.userName })
                      : t("aiAssist.code.lock.youHolding");

                  return (
                    <tr
                      key={row.id}
                      className={`users-row${isLockedByOther ? " users-row--disabled" : ""}`}
                      onClick={() => handleRowClick(row)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({ x: e.clientX, y: e.clientY, row });
                      }}
                      title={lockTitle}
                    >
                      <td className="users-td users-td--name">{row.name}</td>
                      <td className="users-td users-td--muted cases-td-docs">
                        {row.cases.length > 0
                          ? row.cases.map((c, i) => (
                              <span key={i} className="cases-doc-name">{c}</span>
                            ))
                          : <span className="cases-no-docs">-</span>}
                      </td>
                      <td className="users-td users-td--muted">{row.annotationsCount}</td>
                      <td className="users-td users-td--muted">{row.codesCount}</td>
                      <td className="users-td users-td--muted">
                        <span className="code-coverage-cell">
                          <span className="code-coverage-label">{fmtCoverage(row.coverage)}</span>
                          <span className="code-coverage-track">
                            <span
                              className="code-coverage-fill"
                              style={{ width: `${Math.min(row.coverage, 100)}%` }}
                            />
                          </span>
                        </span>
                      </td>
                      <td className="users-td users-td--muted">
                        <span className="code-doc-lock-cell">
                          <span
                            className={`code-doc-lock-pill${lock ? " code-doc-lock-pill--locked" : " code-doc-lock-pill--available"}`}
                          >
                            {lockLabel}
                          </span>
                          {lock && (
                            <span className="code-doc-lock-owner">
                              {isLockedByOther ? lock.userName : t("aiAssist.code.labels.you")}
                            </span>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
          </table>
        </div>
      </div>

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal modal--help" onClick={(e) => e.stopPropagation()}>
            <h2>{t("aiAssist.code.help.title")}</h2>
            <p className="users-guide-copy">
              {t("aiAssist.code.help.line1")}
            </p>
            <p className="users-guide-copy">
              {t("aiAssist.code.help.line2")}
            </p>
            <p className="users-guide-copy">
              {t("aiAssist.code.help.line3")}
            </p>
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button type="button" className="btn" onClick={() => setHelpOpen(false)}>
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={contextMenuStyle}
        >
          {(() => {
            const lock = lockMap[contextMenu.row.id];
            const canKick = !!lock && lock.userId !== currentUserId && canKickDocumentLock;
            if (!canKick) {
              return (
                <div className="context-menu-item context-menu-item--disabled">
                  {t("aiAssist.code.context.noActionsAvailable")}
                </div>
              );
            }
            return (
              <button
                className="context-menu-item context-menu-item--danger"
                onClick={() => {
                  setKickTarget(lock);
                  setContextMenu(null);
                }}
              >
                {t("aiAssist.code.actions.kickUserFromCodeText")}
              </button>
            );
          })()}
        </div>
      )}

      {kickTarget && (
        <div className="modal-overlay" onClick={() => !kickBusy && setKickTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t("aiAssist.code.modals.kickUser.title")}</h2>
            <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
              {t("aiAssist.code.modals.kickUser.bodyPrefix")} <strong>{kickTarget.userName}</strong> {t("aiAssist.code.modals.kickUser.bodyMiddle")}{" "}
              <strong>{kickTarget.documentName}</strong>?
            </p>
            <p className="modal-warning-text">
              {t("aiAssist.code.modals.kickUser.warning")}
            </p>
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button className="btn" onClick={() => setKickTarget(null)} disabled={kickBusy}>
                {t("common.cancel")}
              </button>
              <button className="btn btn--danger" onClick={handleKickLock} disabled={kickBusy}>
                {kickBusy ? t("aiAssist.code.statuses.removing") : t("aiAssist.code.actions.kickUser")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function AIAssistedCodingView() {
  const { t } = useI18n();
  const { activeDocument, setActiveDocument, canCurrentUser, activeProject, projectAiAssistSettings } = useStore();
  const canUseAiCodingTools = canCurrentUser("useAiCodingTools");
  const aiAssistEnabledForProject = activeProject ? projectAiAssistSettings.enabled : false;

  if (!canUseAiCodingTools) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>{t("aiAssist.code.pageTitle")}</h1>
        </header>
        <div className="empty-state">
          <p>{t("aiAssist.code.empty.noPermission")}</p>
        </div>
      </div>
    );
  }

  if (!aiAssistEnabledForProject) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>{t("aiAssist.code.pageTitle")}</h1>
        </header>
        <div className="empty-state">
          <p>{t("aiAssist.code.empty.enableInProjectSettings")}</p>
        </div>
      </div>
    );
  }

  if (activeDocument) {
    return <AIAssistedCodingAnnotateView onBack={() => setActiveDocument(null)} />;
  }

  return <CodeDocumentsLanding />;
}
