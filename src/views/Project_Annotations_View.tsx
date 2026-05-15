import { useState, useEffect, useCallback } from "react";
import { useStore } from "../context/StoreContext";
import helpIcon from "../assets/ic_help_outline_24px.svg";

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
}

type SortCol = "documentName" | "codeLabel" | "memoCount" | "hasNote";
type SortDir = "asc" | "desc";

const COLS: { key: SortCol; label: string; width: string }[] = [
  { key: "documentName", label: "Document", width: "24%" },
  { key: "codeLabel", label: "Code", width: "22%" },
  { key: "memoCount", label: "Memos", width: "10%" },
  { key: "hasNote", label: "Note", width: "10%" },
];

const QUOTE_WIDTH = "34%";
const QUOTE_MAX_CHARS = 80;

function truncateQuote(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= QUOTE_MAX_CHARS) return trimmed || "-";
  return `${trimmed.slice(0, QUOTE_MAX_CHARS - 1).trimEnd()}...`;
}

export function AnnotationsView() {
  const {
    activeProject,
    pb,
    documents,
    setActiveDocument,
    setPendingAnnId,
    setView,
  } = useStore();

  const [rows, setRows] = useState<AnnRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [sortCol, setSortCol] = useState<SortCol>("documentName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const load = useCallback(async () => {
    if (!activeProject || !pb) return;
    setLoading(true);
    setError(null);
    try {
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
      setError(e instanceof Error ? e.message : "Failed to load annotations.");
    } finally {
      setLoading(false);
    }
  }, [activeProject, pb]);

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
    const document = documents.find((item) => item.id === row.documentId);
    if (!document) return;
    setActiveDocument(document);
    setPendingAnnId(row.id);
    setView("code-text");
  }

  const sorted = [...rows].sort((a, b) => {
    let cmp = 0;
    if (sortCol === "documentName") cmp = a.documentName.localeCompare(b.documentName);
    else if (sortCol === "codeLabel") cmp = a.codeLabel.localeCompare(b.codeLabel);
    else if (sortCol === "memoCount") cmp = a.memoCount - b.memoCount;
    else if (sortCol === "hasNote") cmp = Number(a.hasNote) - Number(b.hasNote);
    return sortDir === "asc" ? cmp : -cmp;
  });

  const rowCount = loading || sorted.length === 0 ? 1 : sorted.length;

  return (
    <div className="view users-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>Annotations</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            onClick={() => setHelpOpen(true)}
            title="Show Help"
            aria-label="Show Help"
          >
            <img src={helpIcon} alt="" className="users-help-icon" />
          </button>
        </div>
      </header>

      {error && <p className="users-error">{error}</p>}

      <div className="users-content">
          <div
            className="users-table-wrap"
            style={{ maxHeight: 34 + (Math.max(rowCount, 1) + 2) * 36 }}
          >
            <table className="users-table">
              <thead>
                <tr>
                  <th style={{ width: QUOTE_WIDTH }} className="users-th">Annotated Text</th>
                  {COLS.map((col) => (
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
                  <tr><td colSpan={5} className="users-td-msg">Loading...</td></tr>
                )}
                {!loading && sorted.length === 0 && (
                  <tr><td colSpan={5} className="users-td-msg">No annotations yet.</td></tr>
                )}
                {!loading && sorted.map((row) => (
                  <tr key={row.id} className="users-row annotations-list-row" onClick={() => jumpToAnnotation(row)}>
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
                      {row.memoCount > 0 ? row.memoCount : "-"}
                    </td>
                    <td className="users-td users-td--muted">
                      {row.hasNote ? "Yes" : "-"}
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
            <h2>Annotations Help</h2>
            <p className="users-guide-copy">
              Browse all annotations, inspect code, document, note, and memo state, select a row to jump to the source location, and review annotation status across the project.
            </p>
            <p className="users-guide-copy">
              Use this page as a project-wide annotation index. Pick an annotation from the list to navigate directly back to its source context.
            </p>
            <p className="users-guide-copy">
              This page is mainly for navigation and review; actual annotation edits usually happen in coding views.
            </p>
            <p className="users-guide-copy">
              Project permissions for annotation editing in coding views, plus current code and document availability, affect what you can do after you jump out of this page.
            </p>
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button type="button" className="btn" onClick={() => setHelpOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
