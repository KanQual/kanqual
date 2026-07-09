import { useState, useEffect, useCallback } from "react";
import { useOptionalStore } from "../context/StoreContext";
import { HelpIcon } from "../components/AppIcons";
import { useI18n } from "../i18n/provider";
import { listPostgresExperimentMemos } from "../lib/postgresExperiment";
import { loadPostgresProjectWorkspaceSnapshot } from "../lib/postgresProjectWorkspace";

interface AnnRow {
  id: string;
  documentId: string;
  documentName: string;
  codeId: string;
  codeLabel: string;
  codeColor: string;
  quote: string;
  memoCount: number;
  hasNote: boolean;
  lockLabel?: string;
  lockTitle?: string;
  createdAt?: string;
}

type SortCol = "documentName" | "codeLabel" | "lockLabel" | "memoCount" | "hasNote";
type SortDir = "asc" | "desc";

const COLS: { key: SortCol; label: string; width: string }[] = [
  { key: "documentName", label: "Document", width: "20%" },
  { key: "codeLabel", label: "Code", width: "18%" },
  { key: "lockLabel", label: "Lock", width: "12%" },
  { key: "memoCount", label: "Memos", width: "10%" },
  { key: "hasNote", label: "Note", width: "10%" },
];

const QUOTE_WIDTH = "30%";
const QUOTE_MAX_CHARS = 80;

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

function truncateQuote(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= QUOTE_MAX_CHARS) return trimmed || "-";
  return `${trimmed.slice(0, QUOTE_MAX_CHARS - 1).trimEnd()}...`;
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
    { ...COLS[2], label: t("projectAnnotations.table.memos") },
    { ...COLS[3], label: t("projectAnnotations.table.note") },
  ];

  const [rows, setRows] = useState<AnnRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [sortCol, setSortCol] = useState<SortCol>("documentName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const postgresMode = !!postgresProjectId;

  const load = useCallback(async () => {
    if (!activeProject && !postgresProjectId) return;
    setLoading(true);
    setError(null);
    try {
      if (postgresProjectId) {
        const [snapshot, memoRows] = await Promise.all([
          loadPostgresProjectWorkspaceSnapshot(postgresProjectId),
          listPostgresExperimentMemos(postgresProjectId),
        ]);
        const sourceNameById = Object.fromEntries(snapshot.sources.map((source) => [source.id, source.title]));
        const primaryCodeById = Object.fromEntries(snapshot.codes.map((code) => [code.id, code]));
        const sourceLockById = Object.fromEntries(
          snapshot.sourceLocks.map((lock) => [lock.sourceId, lock]),
        );
        const memoCountByAnnotationId = new Map<string, number>();
        for (const memo of memoRows) {
          for (const annotationId of memo.annotationIds) {
            memoCountByAnnotationId.set(annotationId, (memoCountByAnnotationId.get(annotationId) ?? 0) + 1);
          }
        }
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
            documentId: annotation.sourceId,
            documentName: sourceNameById[annotation.sourceId] ?? "-",
            codeId: annotation.primaryCodeId,
            codeLabel: annotation.primaryCodeLabel || primaryCode?.label || "-",
            codeColor: primaryCode?.color ?? "#888888",
            quote: annotation.quote ?? "",
            memoCount: memoCountByAnnotationId.get(annotation.id) ?? 0,
            hasNote: !!annotation.note,
            lockLabel: lockStatus.label,
            lockTitle: lockStatus.title,
            createdAt: annotation.createdAt,
          };
        }));
        return;
      }

      if (!activeProject || !pb) return;

      const [annRecs, memoRecs] = await Promise.all([
        pb.collection("annotations").getFullList({
          filter: `document.project="${activeProject.id}"&&deleted_at=""`,
          expand: "code,document",
          sort: "document,start_offset",
        }),
        pb.collection("memos").getFullList({
          filter: `project="${activeProject.id}"&&deleted_at=""`,
          fields: "id,annotation",
        }),
      ]);

      const memoCountMap = new Map<string, number>();
      for (const memo of memoRecs) {
        const ids: string[] = Array.isArray(memo.annotation)
          ? memo.annotation
          : memo.annotation ? [memo.annotation] : [];
        for (const id of ids) memoCountMap.set(id, (memoCountMap.get(id) ?? 0) + 1);
      }

      setRows(annRecs.map((record) => ({
        id: record.id,
        documentId: record.document,
        documentName: record.expand?.document?.name ?? "-",
        codeId: record.code,
        codeLabel: record.expand?.code?.label ?? "-",
        codeColor: record.expand?.code?.color ?? "#888888",
        quote: record.quote ?? "",
        memoCount: memoCountMap.get(record.id) ?? 0,
        hasNote: !!record.note,
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

  function jumpToAnnotation(row: AnnRow) {
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
    else if (sortCol === "memoCount") cmp = a.memoCount - b.memoCount;
    else if (sortCol === "hasNote") cmp = Number(a.hasNote) - Number(b.hasNote);
    return sortDir === "asc" ? cmp : -cmp;
  });

  const rowCount = loading || sorted.length === 0 ? 1 : sorted.length;

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
          PostgreSQL annotations are loaded directly from the project workspace. Selecting an annotation opens its source detail and respects the current source lock.
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
                  <th style={{ width: QUOTE_WIDTH }} className="users-th">
                    {t("projectAnnotations.table.annotatedText")}
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
                    onClick={() => jumpToAnnotation(row)}
                    title={row.lockTitle}
                  >
                    <td className="users-td users-td--muted" title={row.quote}>
                      {truncateQuote(row.quote)}
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
                      {row.memoCount > 0 ? row.memoCount : "-"}
                    </td>
                    <td className="users-td users-td--muted">
                      {row.hasNote ? t("projectAnnotations.values.yes") : "-"}
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
