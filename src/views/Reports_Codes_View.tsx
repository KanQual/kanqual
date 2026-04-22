import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useStore } from "../context/StoreContext";

interface CodeReportItem {
  id: string;
  name: string;
  color: string;
  description: string;
  annotationCount: number;
}

interface CodeReportSnapshot {
  reportType?: "codes";
  codes: CodeReportItem[];
  summaryCounts: { codes: number; annotations: number };
}

interface ReportRow {
  id: string;
  name: string;
  createdByName: string;
  createdAt: string;
  snapshot?: CodeReportSnapshot;
}

type SortCol = "name" | "createdByName" | "createdAt";
type SortDir = "asc" | "desc";

const COLS: { key: SortCol; label: string; width: string }[] = [
  { key: "name",          label: "Name",       width: "40%" },
  { key: "createdByName", label: "Created By", width: "28%" },
  { key: "createdAt",     label: "Created",    width: "32%" },
];

function fmtDate(iso: string): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "-";
  }
}

function isCodesSnapshot(value: unknown): value is CodeReportSnapshot {
  if (!value || typeof value !== "object") return false;
  const maybe = value as Partial<CodeReportSnapshot>;
  return maybe.reportType === "codes";
}

function CodeReportPage({
  row,
  isNew,
  onSaved,
  onBack,
}: {
  row?: ReportRow;
  isNew?: boolean;
  onSaved: (id?: string) => void;
  onBack: () => void;
}) {
  const { pb, activeProject, codes, documents, createCodeReport } = useStore();
  const { user: currentUser } = useAuth();

  const [name, setName] = useState(row?.name ?? "");
  const [items, setItems] = useState<CodeReportItem[]>(row?.snapshot?.codes ?? []);
  const [loading, setLoading] = useState(isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isNew || !pb) return;
    let cancelled = false;

    async function loadPreview() {
      setLoading(true);
      setError(null);
      try {
        const counts = new Map<string, number>();
        if (documents.length > 0) {
          const filter = `(${documents.map((doc) => `document="${doc.id}"`).join(" || ")})&&deleted_at=""`;
          const annotations = await pb.collection("annotations").getFullList({ filter, fields: "code" });
          for (const ann of annotations) {
            counts.set(ann.code, (counts.get(ann.code) ?? 0) + 1);
          }
        }

        if (!cancelled) {
          setItems(codes.map((code) => ({
            id: code.id,
            name: code.label,
            color: code.color,
            description: code.description || "-",
            annotationCount: counts.get(code.id) ?? 0,
          })));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load code report preview.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPreview();
    return () => { cancelled = true; };
  }, [isNew, pb, codes, documents]);

  const annotationTotal = useMemo(
    () => items.reduce((sum, item) => sum + item.annotationCount, 0),
    [items],
  );

  async function handleSave() {
    if (!activeProject || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const snapshot: CodeReportSnapshot = {
        reportType: "codes",
        codes: items,
        summaryCounts: {
          codes: items.length,
          annotations: annotationTotal,
        },
      };
      const record = await createCodeReport({
        name: name.trim(),
        caseIds: [],
        documentIds: [],
        codeIds: items.map((item) => item.id),
        createdBy: currentUser?.id,
        snapshot: JSON.stringify(snapshot),
      });
      onSaved(record?.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save report.");
      setSaving(false);
    }
  }

  return (
    <div className="view users-view">
      <header className="view-header">
        <h1>{isNew ? "New Code Report" : row?.name}</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={onBack}>Back</button>
          {isNew && (
            <button className="btn btn--primary" onClick={handleSave} disabled={!name.trim() || saving || loading}>
              {saving ? "Saving..." : "Save Report"}
            </button>
          )}
        </div>
      </header>

      {error && <p className="users-error">{error}</p>}

      {isNew && (
        <div className="annotate-card" style={{ marginBottom: 16 }}>
          <div className="annotate-card-header">
            <span className="annotate-card-title">Report Details</span>
          </div>
          <div style={{ padding: "12px 14px" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
              Report name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Codebook summary"
                style={{ padding: "8px 10px", border: "var(--border-width) solid var(--color-border)", borderRadius: "calc(var(--radius) * 0.5px)", background: "var(--color-bg)", color: "var(--color-text)" }}
              />
            </label>
          </div>
        </div>
      )}

      <div className="report-summary-cards" style={{ marginBottom: 16 }}>
        <div className="stat-card">
          <span className="stat-number">{items.length}</span>
          <span className="stat-label">Codes</span>
        </div>
        <div className="stat-card">
          <span className="stat-number">{annotationTotal}</span>
          <span className="stat-label">Annotations</span>
        </div>
      </div>

      <div className="users-table-wrap" style={{ maxHeight: 34 + (Math.max(loading || items.length === 0 ? 1 : items.length, 1) + 2) * 36 }}>
        <table className="users-table">
          <thead>
            <tr>
              <th className="users-th" style={{ width: "42%" }}>Code</th>
              <th className="users-th" style={{ width: "38%" }}>Description</th>
              <th className="users-th" style={{ width: "20%" }}>Annotations</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={3} className="users-td-msg">Loading...</td></tr>}
            {!loading && items.length === 0 && <tr><td colSpan={3} className="users-td-msg">No codes captured in this report.</td></tr>}
            {!loading && items.map((item) => (
              <tr key={item.id} className="users-row">
                <td className="users-td users-td--name">
                  <span className="code-swatch" style={{ background: item.color, marginRight: 8 }} />
                  {item.name}
                </td>
                <td className="users-td users-td--muted">{item.description}</td>
                <td className="users-td users-td--muted">{item.annotationCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CodesView() {
  const { activeProject, pb, canEdit, deleteCodeReport } = useStore();

  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sortCol, setSortCol] = useState<SortCol>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; row: ReportRow } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const [confirmDelete, setConfirmDelete] = useState<ReportRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [openRow, setOpenRow] = useState<ReportRow | null>(null);
  const [showNew, setShowNew] = useState(false);

  const loadReports = useCallback(async () => {
    if (!activeProject || !pb) return [];
    setLoading(true);
    setError(null);
    try {
      const records = await pb.collection("code_reports").getFullList({
        filter: `project="${activeProject.id}"&&deleted_at=""`,
        expand: "created_by",
        sort: "-created",
      });
      const mappedRows = records
        .map((r) => {
          let snapshot: CodeReportSnapshot | undefined;
          if (r.snapshot) {
            try {
              const parsed = JSON.parse(r.snapshot);
              if (isCodesSnapshot(parsed)) snapshot = parsed;
            } catch {
              // Malformed snapshots are skipped for this report type.
            }
          }
          if (!snapshot) return null;
          const cb = r.expand?.created_by;
          return {
            id: r.id,
            name: r.name,
            createdByName: cb?.name || cb?.email || "-",
            createdAt: r.created,
            snapshot,
          };
        })
        .filter(Boolean) as ReportRow[];
      setRows(mappedRows);
      return mappedRows;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load reports.");
      return [];
    } finally {
      setLoading(false);
    }
  }, [activeProject, pb]);

  useEffect(() => { loadReports(); }, [loadReports]);

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

  const sorted = [...rows].sort((a, b) => {
    const cmp = String(a[sortCol]).localeCompare(String(b[sortCol]), undefined, { sensitivity: "base" });
    return sortDir === "asc" ? cmp : -cmp;
  });

  function handleSort(col: SortCol) {
    if (col === sortCol) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleteLoading(true);
    try {
      await deleteCodeReport(confirmDelete.id, confirmDelete.name);
      setRows((prev) => prev.filter((r) => r.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete report.");
      setConfirmDelete(null);
    } finally {
      setDeleteLoading(false);
    }
  }

  if (showNew) {
    return (
      <CodeReportPage
        isNew
        onSaved={async (id) => {
          setShowNew(false);
          const newRows = await loadReports();
          if (id) {
            const newRow = newRows.find((r) => r.id === id);
            if (newRow) setOpenRow(newRow);
          }
        }}
        onBack={() => setShowNew(false)}
      />
    );
  }

  if (openRow) {
    return (
      <CodeReportPage
        row={openRow}
        onSaved={() => { setOpenRow(null); loadReports(); }}
        onBack={() => setOpenRow(null)}
      />
    );
  }

  return (
    <div className="view users-view">
      <header className="view-header">
        <h1>Code Reports</h1>
        {canEdit && (
          <button className="btn btn--primary" onClick={() => setShowNew(true)}>+ New Report</button>
        )}
      </header>

      {error && <p className="users-error">{error}</p>}

      <div className="users-table-wrap" style={{ maxHeight: 34 + (Math.max(loading || sorted.length === 0 ? 1 : sorted.length, 1) + 2) * 36 }}>
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
                  <span className="users-sort-icon">{sortCol === col.key ? (sortDir === "asc" ? " ^" : " v") : " -"}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={3} className="users-td-msg">Loading...</td></tr>}
            {!loading && sorted.length === 0 && <tr><td colSpan={3} className="users-td-msg">No reports yet.</td></tr>}
            {!loading && sorted.map((row) => (
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {contextMenu && (
        <div ref={contextMenuRef} className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
          <button className="context-menu-item" onClick={() => { setOpenRow(contextMenu.row); setContextMenu(null); }}>Open Report</button>
          {canEdit && (
            <button className="context-menu-item context-menu-item--danger" onClick={() => { setConfirmDelete(contextMenu.row); setContextMenu(null); }}>Delete Report</button>
          )}
        </div>
      )}

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => !deleteLoading && setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Delete Report</h2>
            <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
              Are you sure you want to permanently delete <strong>{confirmDelete.name}</strong>?
            </p>
            <p className="modal-warning-text">This report will be permanently deleted and cannot be recovered.</p>
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button className="btn" onClick={() => setConfirmDelete(null)} disabled={deleteLoading}>Cancel</button>
              <button className="btn btn--danger" onClick={handleDelete} disabled={deleteLoading}>
                {deleteLoading ? "Deleting..." : "Delete Report"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
