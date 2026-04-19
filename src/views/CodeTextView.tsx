import { useState, useEffect, useCallback, useMemo } from "react";
import { useStore } from "../context/StoreContext";
import { AnnotateView } from "./AnnotateView";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DocCodeRow {
  id: string;
  name: string;
  cases: string[];
  annotationsCount: number;
  codesCount: number;   // unique codes used
  coverage: number;     // 0–100
  contentLength: number;
}

type SortCol = "name" | "cases" | "annotationsCount" | "codesCount" | "coverage";
type SortDir = "asc" | "desc";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Merge overlapping [start, end) intervals and return total covered characters. */
function coveredChars(intervals: { start: number; end: number }[]): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let total = 0, curStart = sorted[0].start, curEnd = sorted[0].end;
  for (let i = 1; i < sorted.length; i++) {
    const { start, end } = sorted[i];
    if (start <= curEnd) {
      curEnd = Math.max(curEnd, end);
    } else {
      total += curEnd - curStart;
      curStart = start; curEnd = end;
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

// ─── Column definitions ───────────────────────────────────────────────────────

const COLS: { key: SortCol; label: string; width: string }[] = [
  { key: "name",             label: "Name",          width: "26%" },
  { key: "cases",            label: "Cases",         width: "20%" },
  { key: "annotationsCount", label: "Annotations",   width: "15%" },
  { key: "codesCount",       label: "Codes",         width: "15%" },
  { key: "coverage",         label: "Code Coverage", width: "24%" },
];

// ─── Landing table ────────────────────────────────────────────────────────────

function CodeDocumentsLanding() {
  const { activeProject, pb, documents, setActiveDocument } = useStore();

  const [rows,    setRows]    = useState<DocCodeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<SortCol>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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
          filter: filterExpr,
          fields: "id,document,code,start_offset,end_offset",
        }),
        pb.collection("case_documents").getFullList({
          filter: filterExpr,
          expand: "case",
          fields: "document,case,expand",
        }),
      ]);

      // Group annotations by document
      const annByDoc: Record<string, typeof allAnnotations> = {};
      for (const ann of allAnnotations) {
        (annByDoc[ann.document] ??= []).push(ann);
      }

      // Group case names by document
      const casesByDoc: Record<string, string[]> = {};
      for (const cd of caseDocs) {
        (casesByDoc[cd.document] ??= []).push(cd.expand?.case?.name ?? "—");
      }

      setRows(
        documents.map((doc) => {
          const anns = annByDoc[doc.id] ?? [];
          const uniqueCodes = new Set(anns.map((a) => a.code)).size;
          const coverage = calcCoverage(
            anns.map((a) => ({ start: a.start_offset, end: a.end_offset })),
            doc.content?.length ?? 0,
          );
          return {
            id:               doc.id,
            name:             doc.name,
            cases:            casesByDoc[doc.id] ?? [],
            annotationsCount: anns.length,
            codesCount:       uniqueCodes,
            coverage,
            contentLength:    doc.content?.length ?? 0,
          };
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [activeProject, pb, documents]);

  useEffect(() => { load(); }, [load]);

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
    else { setSortCol(col); setSortDir("asc"); }
  }

  function handleRowClick(row: DocCodeRow) {
    const doc = documents.find((d) => d.id === row.id);
    if (doc) setActiveDocument(doc);
  }

  return (
    <div className="view users-view">
      <header className="view-header">
        <h1>Code Documents</h1>
      </header>

      {error && <p className="users-error">{error}</p>}

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
              {COLS.map((col) => (
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
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="users-td-msg">Loading…</td></tr>
            )}
            {!loading && sorted.length === 0 && (
              <tr>
                <td colSpan={5} className="users-td-msg">
                  No documents yet. Add documents from the Documents page first.
                </td>
              </tr>
            )}
            {!loading && sorted.map((row) => (
              <tr
                key={row.id}
                className="users-row"
                onClick={() => handleRowClick(row)}
              >
                <td className="users-td users-td--name">{row.name}</td>
                <td className="users-td users-td--muted cases-td-docs">
                  {row.cases.length > 0
                    ? row.cases.map((c, i) => (
                        <span key={i} className="cases-doc-name">{c}</span>
                      ))
                    : <span className="cases-no-docs">—</span>}
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function CodeTextView() {
  const { activeDocument, setActiveDocument } = useStore();

  if (activeDocument) {
    return <AnnotateView onBack={() => setActiveDocument(null)} />;
  }

  return <CodeDocumentsLanding />;
}
