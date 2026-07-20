import { useState, useEffect, useCallback } from "react";
import { useOptionalStore } from "../context/StoreContext";
import { HelpIcon } from "../components/AppIcons";
import { useI18n } from "../i18n/provider";
import { loadPostgresProjectWorkspaceSnapshot } from "../lib/postgresProjectWorkspace";

interface AnnRow {
  id: string;
  displayId: number | null;
  documentId: string;
  documentName: string;
  codeId: string;
  codeLabel: string;
  codeColor: string;
  quote: string;
  note: string;
  createdByName: string;
  lockLabel?: string;
  lockTitle?: string;
  createdAt?: string;
}

type SortCol = "documentName" | "codeLabel" | "lockLabel" | "createdAt" | "createdByName";
type SortDir = "asc" | "desc";

const COLS: { key: SortCol; label: string; width: string }[] = [
  { key: "documentName", label: "Document", width: "20%" },
  { key: "codeLabel", label: "Code", width: "18%" },
  { key: "lockLabel", label: "Lock", width: "12%" },
  { key: "createdAt", label: "Created", width: "16%" },
  { key: "createdByName", label: "Created By", width: "14%" },
];

const ANNOTATION_ID_WIDTH = "12%";

export interface AnnotationsViewProps {
  postgresProjectId?: string;
  postgresCurrentUserId?: string;
  onOpenPostgresSourceAnnotation?: (target: { sourceId: string; annotationId: string }) => void;
}

function describeSourceLock(
  userId: string | undefined,
  userName: string | undefined,
  currentUserId: string | undefined,
): { label: string; title: string } {
  if (!userId) {
    return {
      label: "Available",
      title: "This source is currently available for coding.",
    };
  }
  if (currentUserId && userId === currentUserId) {
    return {
      label: "You",
      title: "You are currently holding this source lock.",
    };
  }
  return {
    label: "Locked",
    title: `${userName || "Another user"} is currently holding this source lock.`,
  };
}

function fmtDate(value?: string): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function formatAnnotationDisplayId(value: number | null): string {
  return value == null ? "-" : `A${value}`;
}

export function AnnotationsView(props: AnnotationsViewProps) {
  const { postgresProjectId, postgresCurrentUserId, onOpenPostgresSourceAnnotation } = props;
  const { t } = useI18n();
  const store = useOptionalStore();
  const activeProject = store?.activeProject ?? null;
  const pb = store?.pb ?? null;
  const documents = store?.documents ?? [];
  const localizedCols = [
    { ...COLS[0], label: t("projectAnnotations.table.document") },
    { ...COLS[1], label: t("projectAnnotations.table.code") },
    { ...COLS[2], label: t("projectAnnotations.table.lock") },
    { ...COLS[3], label: t("projectAnnotations.table.created") },
    { ...COLS[4], label: t("projectAnnotations.table.createdBy") },
  ];

  const [rows, setRows] = useState<AnnRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [sortCol, setSortCol] = useState<SortCol>("documentName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedRow, setSelectedRow] = useState<AnnRow | null>(null);
  const postgresMode = !!postgresProjectId;

  const load = useCallback(async () => {
    if (!activeProject && !postgresProjectId) return;
    setLoading(true);
    setError(null);
    try {
      if (postgresProjectId) {
        const snapshot = await loadPostgresProjectWorkspaceSnapshot(postgresProjectId);
        const sourceNameById = Object.fromEntries(snapshot.sources.map((source) => [source.id, source.title]));
        const primaryCodeById = Object.fromEntries(snapshot.codes.map((code) => [code.id, code]));
        const sourceLockById = Object.fromEntries(
          snapshot.sourceLocks.map((lock) => [lock.sourceId, lock]),
        );
        setRows(snapshot.annotations.map((annotation) => {
          const primaryCode = primaryCodeById[annotation.primaryCodeId];
          const sourceLock = sourceLockById[annotation.sourceId];
          const lockStatus = describeSourceLock(
            sourceLock?.userId,
            sourceLock?.userName,
            postgresCurrentUserId,
          );
          return {
            id: annotation.id,
            displayId: annotation.displayId,
            documentId: annotation.sourceId,
            documentName: sourceNameById[annotation.sourceId] ?? "-",
            codeId: annotation.primaryCodeId,
            codeLabel: annotation.primaryCodeLabel || primaryCode?.label || "-",
            codeColor: primaryCode?.color ?? "#888888",
            quote: annotation.quote ?? "",
            note: annotation.note ?? "",
            createdByName: annotation.createdByName || "-",
            lockLabel: lockStatus.label,
            lockTitle: lockStatus.title,
            createdAt: annotation.createdAt,
          };
        }));
        return;
      }

      if (!activeProject || !pb) return;

      const annRecs = await pb.collection("annotations").getFullList({
        filter: `document.project="${activeProject.id}"&&deleted_at=""`,
        expand: "code,document,created_by",
        sort: "document,start_offset",
      });

      setRows(annRecs.map((record) => ({
        id: record.id,
        displayId: null,
        documentId: record.document,
        documentName: record.expand?.document?.name ?? "-",
        codeId: record.code,
        codeLabel: record.expand?.code?.label ?? "-",
        codeColor: record.expand?.code?.color ?? "#888888",
        quote: record.quote ?? "",
        note: record.note ?? "",
        createdByName: record.expand?.created_by?.name ?? "-",
        createdAt: record.created,
      })));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("projectAnnotations.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [activeProject, pb, postgresCurrentUserId, postgresProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleSort(col: SortCol) {
    if (col === sortCol) setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  function openAnnotation(row: AnnRow) {
    setSelectedRow(row);
  }

  function jumpToSourceAnnotation(row: AnnRow) {
    if (postgresProjectId) {
      onOpenPostgresSourceAnnotation?.({
        sourceId: row.documentId,
        annotationId: row.id,
      });
      return;
    }
    if (!pb) return;
    const document = documents.find((item) => item.id === row.documentId);
    if (!document) return;
    store?.setActiveDocument(document);
    store?.setPendingAnnId(row.id);
    store?.setView("code-text");
  }

  const sorted = [...rows].sort((a, b) => {
    let cmp = 0;
    if (sortCol === "documentName") cmp = a.documentName.localeCompare(b.documentName);
    else if (sortCol === "codeLabel") cmp = a.codeLabel.localeCompare(b.codeLabel);
    else if (sortCol === "lockLabel") cmp = (a.lockLabel ?? "").localeCompare(b.lockLabel ?? "");
    else if (sortCol === "createdAt") cmp = (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
    else if (sortCol === "createdByName") cmp = a.createdByName.localeCompare(b.createdByName);
    return sortDir === "asc" ? cmp : -cmp;
  });

  const rowCount = loading || sorted.length === 0 ? 1 : sorted.length;

  if (selectedRow) {
    return (
      <div className="view doc-detail-view">
        <div className="workspace-back-row workspace-back-row--split">
          <button className="btn" onClick={() => setSelectedRow(null)}>
            Back to Annotations
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn"
              onClick={() => jumpToSourceAnnotation(selectedRow)}
            >
              Open in Source
            </button>
          </div>
        </div>

        <div className="doc-detail-layout">
          <div className="doc-detail-left">
            <div className="case-card">
              <h3 className="case-card-title">Annotation</h3>
              <p className="case-card-value">{formatAnnotationDisplayId(selectedRow.displayId)}</p>
              <p className="users-guide-copy" style={{ marginTop: 8, marginBottom: 0 }} title={selectedRow.lockTitle}>
                Lock: {selectedRow.lockLabel ?? "-"}
              </p>
            </div>

            <dl className="user-detail-meta case-detail-meta">
              <dt>ID</dt> <dd>{formatAnnotationDisplayId(selectedRow.displayId)}</dd>
              <dt>{t("projectAnnotations.table.document")}</dt> <dd>{selectedRow.documentName}</dd>
              <dt>{t("projectAnnotations.table.code")}</dt>
              <dd style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span className="code-swatch" style={{ background: selectedRow.codeColor }} />
                {selectedRow.codeLabel}
              </dd>
              <dt>{t("projectAnnotations.table.createdBy")}</dt> <dd>{selectedRow.createdByName}</dd>
              <dt>{t("projectDocuments.columns.created")}</dt> <dd>{fmtDate(selectedRow.createdAt)}</dd>
            </dl>

            {selectedRow.note ? (
              <div className="case-card">
                <h3 className="case-card-title">Note</h3>
                <p className="users-guide-copy" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                  {selectedRow.note}
                </p>
              </div>
            ) : null}
          </div>

          <div className="doc-detail-right">
            <div className="case-card doc-content-card">
              <div className="case-card-header">
                <div className="doc-content-header-title">
                  <h3 className="case-card-title">Annotated Text</h3>
                </div>
              </div>
              <div className="doc-content-scroll-shell">
                <pre
                  className="doc-content-body"
                  style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                >
                  {selectedRow.quote || "No annotation text is available for this annotation."}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="view users-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>{t("projectAnnotations.pageTitle")}</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            onClick={() => setHelpOpen(true)}
            title={t("projectAnnotations.showHelp")}
            aria-label={t("projectAnnotations.showHelp")}
          >
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
      </header>

      {error && <p className="users-error">{error}</p>}
      {postgresMode && (
        <p className="users-guide-copy" style={{ marginBottom: 16 }}>
          PostgreSQL annotations are loaded directly from the project workspace. Selecting an annotation opens its detail view, and you can still jump from there into the source coding workflow when needed.
        </p>
      )}

      <div className="users-content">
          <div
            className="users-table-wrap"
            style={{ maxHeight: 34 + (Math.max(rowCount, 1) + 2) * 36 }}
          >
            <table className="users-table">
              <thead>
                <tr>
                  <th style={{ width: ANNOTATION_ID_WIDTH }} className="users-th">
                    ID
                  </th>
                  {localizedCols.map((col) => (
                    <th
                      key={col.key}
                      style={{ width: col.width }}
                      className={`users-th${sortCol === col.key ? " users-th--sorted" : ""}`}
                      onClick={() => handleSort(col.key)}
                    >
                      {col.label}
                      <span className="users-sort-icon">
                        {sortCol === col.key
                          ? sortDir === "asc"
                            ? " ↑"
                            : " ↓"
                          : " ↕"}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={6} className="users-td-msg">{t("projectAnnotations.loading")}</td></tr>
                )}
                {!loading && sorted.length === 0 && (
                  <tr><td colSpan={6} className="users-td-msg">{t("projectAnnotations.empty")}</td></tr>
                )}
                {!loading && sorted.map((row) => (
                  <tr
                    key={row.id}
                    className="users-row annotations-list-row"
                    onClick={() => openAnnotation(row)}
                    title={row.lockTitle}
                  >
                    <td className="users-td users-td--muted">
                      {formatAnnotationDisplayId(row.displayId)}
                    </td>
                    <td className="users-td users-td--name">{row.documentName}</td>
                    <td className="users-td">
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span className="code-swatch" style={{ background: row.codeColor }} />
                        {row.codeLabel}
                      </span>
                    </td>
                    <td className="users-td users-td--muted">
                      {row.lockLabel ?? "-"}
                    </td>
                    <td className="users-td users-td--muted">
                      {fmtDate(row.createdAt)}
                    </td>
                    <td className="users-td users-td--muted">
                      {row.createdByName}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      </div>

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal modal--help" onClick={(e) => e.stopPropagation()}>
            <h2>{t("projectAnnotations.help.title")}</h2>
            <p className="users-guide-copy">
              {t("projectAnnotations.help.line1")}
            </p>
            <p className="users-guide-copy">
              {t("projectAnnotations.help.line2")}
            </p>
            <p className="users-guide-copy">
              {t("projectAnnotations.help.line3")}
            </p>
            <p className="users-guide-copy">
              {t("projectAnnotations.help.line4")}
            </p>
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button type="button" className="btn" onClick={() => setHelpOpen(false)}>
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
