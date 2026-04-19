import { useState, useEffect, useCallback, useRef, useId, useMemo } from "react";
import { useStore } from "../context/StoreContext";
import { useAuth } from "../context/AuthContext";
import type { Code } from "../types";

// ─── Rich text editor ─────────────────────────────────────────────────────────

const RTE_TOOLS: { cmd: string; label: string; title: string }[] = [
  { cmd: "bold",                label: "B",   title: "Bold" },
  { cmd: "italic",              label: "I",   title: "Italic" },
  { cmd: "underline",           label: "U",   title: "Underline" },
  { cmd: "insertUnorderedList", label: "•—",  title: "Bullet list" },
  { cmd: "insertOrderedList",   label: "1.",  title: "Numbered list" },
];

function RichTextEditor({
  initialHtml,
  editorRef,
  grow,
}: {
  initialHtml: string;
  editorRef: React.RefObject<HTMLDivElement | null>;
  grow?: boolean;
}) {
  const id = useId();

  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = initialHtml;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function execCmd(cmd: string) {
    document.getElementById(id)?.focus();
    document.execCommand(cmd, false);
  }

  return (
    <div className={`rte${grow ? " rte--grow" : ""}`}>
      <div className="rte-toolbar">
        {RTE_TOOLS.map((t) => (
          <button
            key={t.cmd}
            type="button"
            className="rte-btn"
            title={t.title}
            onMouseDown={(e) => { e.preventDefault(); execCmd(t.cmd); }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        id={id}
        ref={editorRef}
        className="rte-content"
        contentEditable
        suppressContentEditableWarning
      />
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnnItem {
  id: string;
  quote: string;
  docId: string;
  codeId: string;
  codeName: string;
  codeColor: string;
  docName: string;
}

interface MemoRow {
  id: string;
  title: string;
  body: string;
  createdByName: string;
  createdAt: string;
  // Display names for table
  cases: string[];
  documents: string[];
  codes: string[];
  // IDs for editor pre-fill
  caseIds: string[];
  documentIds: string[];
  codeIds: string[];
  annotationIds: string[];
}

type SortCol = "title" | "createdByName" | "createdAt" | "cases" | "documents" | "codes";
type SortDir = "asc" | "desc";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

// ─── Column definitions ───────────────────────────────────────────────────────

const COLS: { key: SortCol; label: string; width: string }[] = [
  { key: "title",         label: "Name",       width: "22%" },
  { key: "createdByName", label: "Created By", width: "16%" },
  { key: "createdAt",     label: "Created",    width: "18%" },
  { key: "cases",         label: "Cases",      width: "15%" },
  { key: "documents",     label: "Documents",  width: "15%" },
  { key: "codes",         label: "Codes",      width: "14%" },
];

// ─── Code tree helper ─────────────────────────────────────────────────────────

function buildCodeTree(
  allCodes: Code[],
  visibleIds: Set<string>,
): { code: Code; depth: number }[] {
  const childrenOf: Record<string, Code[]> = {};
  const roots: Code[] = [];
  for (const c of allCodes) {
    if (c.parentId) (childrenOf[c.parentId] ??= []).push(c);
    else roots.push(c);
  }
  const allCodeMap = new Map(allCodes.map((c) => [c.id, c]));

  function effectiveDepth(code: Code): number {
    if (!code.parentId) return 0;
    const parent = allCodeMap.get(code.parentId);
    if (!parent || !visibleIds.has(parent.id)) return 0;
    return 1 + effectiveDepth(parent);
  }

  const result: { code: Code; depth: number }[] = [];
  function traverse(nodes: Code[]) {
    for (const node of nodes) {
      if (visibleIds.has(node.id))
        result.push({ code: node, depth: effectiveDepth(node) });
      traverse(childrenOf[node.id] ?? []);
    }
  }
  traverse(roots);
  const seen = new Set(result.map((r) => r.code.id));
  for (const c of allCodes)
    if (visibleIds.has(c.id) && !seen.has(c.id))
      result.push({ code: c, depth: 0 });
  return result;
}

// ─── Memo editor sub-view ─────────────────────────────────────────────────────

export function MemoEditorView({
  editRow,
  preselectedCaseIds,
  preselectedDocumentIds,
  preselectedCodeIds,
  backLabel,
  onSaved,
  onBack,
}: {
  editRow?: MemoRow;
  preselectedCaseIds?: string[];
  preselectedDocumentIds?: string[];
  preselectedCodeIds?: string[];
  backLabel?: string;
  onSaved: () => void;
  onBack: () => void;
}) {
  const { pb, activeProject, documents: storeDocs, codes: storeCodes, addMemo, updateMemo } = useStore();
  const { user: currentUser } = useAuth();

  // ── Raw loaded data ────────────────────────────────────────────────────────
  const [caseItems,   setCaseItems]   = useState<{ id: string; name: string }[]>([]);
  const [annItems,    setAnnItems]    = useState<AnnItem[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  // ── Selections (pre-filled from editRow when editing) ─────────────────────
  const [selCaseIds, setSelCaseIds] = useState<Set<string>>(
    () => new Set([...(editRow?.caseIds ?? []), ...(preselectedCaseIds ?? [])]),
  );
  const [selDocIds,  setSelDocIds]  = useState<Set<string>>(
    () => new Set([...(editRow?.documentIds ?? []), ...(preselectedDocumentIds ?? [])]),
  );
  const [selCodeIds, setSelCodeIds] = useState<Set<string>>(
    () => new Set([...(editRow?.codeIds ?? []), ...(preselectedCodeIds ?? [])]),
  );
  const [selAnnIds,  setSelAnnIds]  = useState<Set<string>>(
    () => new Set(editRow?.annotationIds ?? []),
  );

  // ── UI state ──────────────────────────────────────────────────────────────
  const [title,     setTitle]     = useState(editRow?.title ?? "");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  // ── Load cases and annotations ─────────────────────────────────────────────
  useEffect(() => {
    if (!pb || !activeProject) return;
    setDataLoading(true);
    (async () => {
      try {
        const caseRecs = await pb.collection("cases").getFullList({
          filter: `project="${activeProject.id}"`,
          sort: "name",
        });
        setCaseItems(caseRecs.map((r) => ({ id: r.id, name: r.name })));

        if (storeDocs.length > 0) {
          const annRecs = await pb.collection("annotations").getFullList({
            filter: storeDocs.map((d) => `document="${d.id}"`).join(" || "),
            expand: "code,document",
            fields: "id,quote,document,code,expand",
          });
          setAnnItems(annRecs.map((r) => ({
            id:        r.id,
            quote:     r.quote,
            docId:     r.document,
            codeId:    r.code,
            codeName:  r.expand?.code?.label  ?? "—",
            codeColor: r.expand?.code?.color  ?? "#888888",
            docName:   r.expand?.document?.name ?? "—",
          })));
        }
      } catch (e) {
        console.error(e);
      } finally {
        setDataLoading(false);
      }
    })();
  }, [pb, activeProject, storeDocs]);

  const codeTree = useMemo(
    () => buildCodeTree(storeCodes, new Set(storeCodes.map((c) => c.id))),
    [storeCodes],
  );

  // ── Toggle helpers ────────────────────────────────────────────────────────
  function toggle(
    set: Set<string>,
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string,
  ) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  }

  function toggleSection(name: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!activeProject || !title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const data = {
        title:         title.trim(),
        body:          editorRef.current?.innerHTML ?? "",
        documentIds:   [...selDocIds],
        annotationIds: [...selAnnIds],
        caseIds:       [...selCaseIds],
        codeIds:       [...selCodeIds],
      };
      if (editRow) {
        await updateMemo(editRow.id, data);
      } else {
        await addMemo({ ...data, createdBy: currentUser?.id });
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save memo.");
      setSaving(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const isEdit = Boolean(editRow);

  return (
    <div className="view doc-detail-view">
      <div className="case-detail-topbar">
        <button className="btn" onClick={onBack}>
          {backLabel ?? (isEdit ? "← Back to Memo" : "← Back to Memos")}
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {error && <span style={{ fontSize: 12, color: "var(--color-danger)" }}>{error}</span>}
          <button
            className="btn btn--primary"
            onClick={handleSave}
            disabled={saving || !title.trim()}
          >
            {saving ? "Saving…" : isEdit ? "Save Changes" : "Save Memo"}
          </button>
        </div>
      </div>

      <div className="doc-detail-layout">

        {/* ── Left: title + associations ── */}
        <div className="doc-detail-left">

          <div className="case-card">
            <h3 className="case-card-title">{isEdit ? "Edit Memo" : "New Memo"}</h3>
            <input
              className="form-input"
              placeholder="Memo title…"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>

          <p className="memo-assoc-label">Associate Memo with…</p>

          {/* Cases */}
          <div className="case-card">
            <div className="memo-card-header" onClick={() => toggleSection("cases")}>
              <h3 className="case-card-title" style={{ margin: 0 }}>
                Cases{selCaseIds.size > 0 ? ` (${selCaseIds.size})` : ""}
              </h3>
              <span className="codebook-collapse-icon">{collapsed.has("cases") ? "▶" : "▼"}</span>
            </div>
            {!collapsed.has("cases") && (
              <ul className="memo-sel-list">
                {dataLoading
                  ? <li className="memo-sel-empty">Loading…</li>
                  : caseItems.length === 0
                    ? <li className="memo-sel-empty">No cases.</li>
                    : caseItems.map((item) => (
                        <li
                          key={item.id}
                          className={`memo-sel-item${selCaseIds.has(item.id) ? " memo-sel-item--checked" : ""}`}
                          onClick={() => toggle(selCaseIds, setSelCaseIds, item.id)}
                        >
                          <input
                            type="checkbox"
                            className="memo-sel-checkbox"
                            checked={selCaseIds.has(item.id)}
                            onChange={() => toggle(selCaseIds, setSelCaseIds, item.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className="memo-sel-item-label">{item.name}</span>
                        </li>
                      ))
                }
              </ul>
            )}
          </div>

          {/* Documents */}
          <div className="case-card">
            <div className="memo-card-header" onClick={() => toggleSection("documents")}>
              <h3 className="case-card-title" style={{ margin: 0 }}>
                Documents{selDocIds.size > 0 ? ` (${selDocIds.size})` : ""}
              </h3>
              <span className="codebook-collapse-icon">{collapsed.has("documents") ? "▶" : "▼"}</span>
            </div>
            {!collapsed.has("documents") && (
              <ul className="memo-sel-list">
                {storeDocs.length === 0
                  ? <li className="memo-sel-empty">No documents.</li>
                  : storeDocs.map((doc) => (
                      <li
                        key={doc.id}
                        className={`memo-sel-item${selDocIds.has(doc.id) ? " memo-sel-item--checked" : ""}`}
                        onClick={() => toggle(selDocIds, setSelDocIds, doc.id)}
                      >
                        <input
                          type="checkbox"
                          className="memo-sel-checkbox"
                          checked={selDocIds.has(doc.id)}
                          onChange={() => toggle(selDocIds, setSelDocIds, doc.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="memo-sel-item-label">{doc.name}</span>
                      </li>
                    ))
                }
              </ul>
            )}
          </div>

          {/* Codes */}
          <div className="case-card">
            <div className="memo-card-header" onClick={() => toggleSection("codes")}>
              <h3 className="case-card-title" style={{ margin: 0 }}>
                Codes{selCodeIds.size > 0 ? ` (${selCodeIds.size})` : ""}
              </h3>
              <span className="codebook-collapse-icon">{collapsed.has("codes") ? "▶" : "▼"}</span>
            </div>
            {!collapsed.has("codes") && (
              <ul className="memo-sel-list">
                {codeTree.length === 0
                  ? <li className="memo-sel-empty">No codes.</li>
                  : codeTree.map(({ code, depth }) => (
                      <li
                        key={code.id}
                        className={`memo-sel-item${selCodeIds.has(code.id) ? " memo-sel-item--checked" : ""}`}
                        style={{ paddingLeft: 14 + depth * 16 }}
                        onClick={() => toggle(selCodeIds, setSelCodeIds, code.id)}
                      >
                        <input
                          type="checkbox"
                          className="memo-sel-checkbox"
                          checked={selCodeIds.has(code.id)}
                          onChange={() => toggle(selCodeIds, setSelCodeIds, code.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span
                          className="code-swatch"
                          style={{ background: code.color, flexShrink: 0, marginTop: 1 }}
                        />
                        <span className="memo-sel-item-label">{code.label}</span>
                      </li>
                    ))
                }
              </ul>
            )}
          </div>

          {/* Annotations */}
          <div className="case-card">
            <div className="memo-card-header" onClick={() => toggleSection("annotations")}>
              <h3 className="case-card-title" style={{ margin: 0 }}>
                Annotations{selAnnIds.size > 0 ? ` (${selAnnIds.size})` : ""}
              </h3>
              <span className="codebook-collapse-icon">{collapsed.has("annotations") ? "▶" : "▼"}</span>
            </div>
            {!collapsed.has("annotations") && (
              <ul className="memo-sel-list">
                {annItems.length === 0
                  ? <li className="memo-sel-empty">No annotations.</li>
                  : annItems.map((ann) => (
                      <li
                        key={ann.id}
                        className={`memo-sel-item${selAnnIds.has(ann.id) ? " memo-sel-item--checked" : ""}`}
                        style={{ borderRight: `3px solid ${ann.codeColor}`, paddingRight: 11 }}
                        onClick={() => toggle(selAnnIds, setSelAnnIds, ann.id)}
                      >
                        <input
                          type="checkbox"
                          className="memo-sel-checkbox"
                          checked={selAnnIds.has(ann.id)}
                          onChange={() => toggle(selAnnIds, setSelAnnIds, ann.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div className="memo-sel-item-text">
                          <span
                            className="annotation-code-badge"
                            style={{ background: ann.codeColor, marginBottom: 3, display: "inline-block", alignSelf: "flex-start" }}
                          >
                            {ann.codeName}
                          </span>
                          <span className="memo-sel-item-label">{ann.quote}</span>
                          <span className="memo-sel-item-sub">{ann.docName}</span>
                        </div>
                      </li>
                    ))
                }
              </ul>
            )}
          </div>

        </div>

        {/* ── Right: body editor ── */}
        <div className="doc-detail-right">
          <div className="case-card doc-content-card">
            <h3 className="case-card-title">Body</h3>
            <RichTextEditor initialHtml={editRow?.body ?? ""} editorRef={editorRef} grow />
          </div>
        </div>

      </div>
    </div>
  );
}

// ─── Memo Detail sub-view ──────────────────────────────────────────────────────

function MemoDetail({
  row,
  canEdit,
  onBack,
  onEdit,
}: {
  row: MemoRow;
  canEdit: boolean;
  onBack: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="view doc-detail-view">
      <div className="case-detail-topbar">
        <button className="btn" onClick={onBack}>← Back to Memos</button>
        {canEdit && (
          <label className="toggle-switch" title="Edit memo">
            <input
              type="checkbox"
              checked={false}
              onChange={(e) => { if (e.target.checked) onEdit(); }}
            />
            <span className="toggle-track"><span className="toggle-thumb" /></span>
            <span className="toggle-label">Edit</span>
          </label>
        )}
      </div>

      <div className="doc-detail-layout">

        <div className="doc-detail-left">

          <div className="case-card">
            <h3 className="case-card-title">Memo</h3>
            <p className="case-card-value">{row.title}</p>
          </div>

          <dl className="user-detail-meta case-detail-meta">
            <dt>Created By</dt><dd>{row.createdByName}</dd>
            <dt>Created</dt>   <dd>{fmtDate(row.createdAt)}</dd>
          </dl>

          <div className="case-card">
            <h3 className="case-card-title">Cases</h3>
            {row.cases.length > 0
              ? <ul className="case-detail-doc-list">{row.cases.map((c) => <li key={c} className="case-detail-doc-item">{c}</li>)}</ul>
              : <p className="case-card-empty">No cases associated.</p>}
          </div>

          <div className="case-card">
            <h3 className="case-card-title">Documents</h3>
            {row.documents.length > 0
              ? <ul className="case-detail-doc-list">{row.documents.map((d) => <li key={d} className="case-detail-doc-item">{d}</li>)}</ul>
              : <p className="case-card-empty">No documents associated.</p>}
          </div>

          <div className="case-card">
            <h3 className="case-card-title">Codes</h3>
            {row.codes.length > 0
              ? <ul className="case-detail-doc-list">{row.codes.map((c) => <li key={c} className="case-detail-doc-item">{c}</li>)}</ul>
              : <p className="case-card-empty">No codes associated.</p>}
          </div>

        </div>

        <div className="doc-detail-right">
          <div className="case-card doc-content-card">
            <h3 className="case-card-title">Body</h3>
            {row.body
              ? <div className="case-notes-body" dangerouslySetInnerHTML={{ __html: row.body }} />
              : <p className="case-card-empty">No body text.</p>}
          </div>
        </div>

      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function MemosView() {
  const { activeProject, pb, canEdit, pendingMemoId, setPendingMemoId, deleteMemo } = useStore();

  const [rows,    setRows]    = useState<MemoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const [sortCol, setSortCol] = useState<SortCol>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [contextMenu,   setContextMenu]   = useState<{ x: number; y: number; row: MemoRow } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const [confirmDelete, setConfirmDelete] = useState<MemoRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Navigation: store IDs so detail/editor auto-refresh when rows reload
  const [showNewEditor,  setShowNewEditor]  = useState(false);
  const [selectedRowId,  setSelectedRowId]  = useState<string | null>(null);
  const [editorRowId,    setEditorRowId]    = useState<string | null>(null);

  const selectedRow = selectedRowId ? (rows.find((r) => r.id === selectedRowId) ?? null) : null;
  const editorRow   = editorRowId   ? (rows.find((r) => r.id === editorRowId)   ?? null) : null;

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadMemos = useCallback(async () => {
    if (!activeProject || !pb) return;
    setLoading(true);
    setError(null);
    try {
      const memoRecords = await pb.collection("memos").getFullList({
        filter: `project="${activeProject.id}"`,
        expand: "created_by,document,annotation.code,cases,codes",
        sort: "-created",
      });

      setRows(
        memoRecords.map((r) => {
          const cb = r.expand?.created_by;

          // PocketBase relation fields may be single or array
          function toArr<T>(v: T | T[] | undefined | null): T[] {
            if (!v) return [];
            return Array.isArray(v) ? v : [v];
          }

          const docExpands  = toArr(r.expand?.document);
          const caseExpands = toArr(r.expand?.cases);
          const codeExpands = toArr(r.expand?.codes);

          const docIds  = toArr<string>(r.document);
          const annIds  = toArr<string>(r.annotation);
          const caseIds = toArr<string>(r.cases);
          const codeIds = toArr<string>(r.codes);

          return {
            id:            r.id,
            title:         r.title,
            body:          r.body ?? "",
            createdByName: cb?.name || cb?.email || "—",
            createdAt:     r.created,
            cases:         caseExpands.map((c: { name?: string }) => c.name ?? "—"),
            documents:     docExpands.map((d: { name?: string }) => d.name ?? "—"),
            codes:         codeExpands.map((c: { label?: string }) => c.label ?? "—"),
            caseIds,
            documentIds:   docIds,
            codeIds,
            annotationIds: annIds,
          };
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load memos.");
    } finally {
      setLoading(false);
    }
  }, [activeProject, pb]);

  useEffect(() => { loadMemos(); }, [loadMemos]);

  // Consume a pending memo ID (navigated here from another view)
  useEffect(() => {
    if (!pendingMemoId || rows.length === 0) return;
    const exists = rows.some((r) => r.id === pendingMemoId);
    if (exists) {
      setSelectedRowId(pendingMemoId);
      setPendingMemoId(null);
    }
  }, [rows, pendingMemoId, setPendingMemoId]);

  // ── Close context menu ────────────────────────────────────────────────────

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node))
        setContextMenu(null);
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

  // ── Sort ──────────────────────────────────────────────────────────────────

  const sorted = [...rows].sort((a, b) => {
    let cmp: number;
    if      (sortCol === "cases")     { cmp = a.cases.length     - b.cases.length; }
    else if (sortCol === "documents") { cmp = a.documents.length - b.documents.length; }
    else if (sortCol === "codes")     { cmp = a.codes.length     - b.codes.length; }
    else {
      const aVal = String(a[sortCol]);
      const bVal = String(b[sortCol]);
      cmp = aVal.localeCompare(bVal, undefined, { sensitivity: "base" });
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  function handleSort(col: SortCol) {
    if (col === sortCol) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleteLoading(true);
    try {
      await deleteMemo(confirmDelete.id);
      setRows((prev) => prev.filter((r) => r.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete memo.");
      setConfirmDelete(null);
    } finally {
      setDeleteLoading(false);
    }
  }

  // ── Sub-views ─────────────────────────────────────────────────────────────

  if (showNewEditor) {
    return (
      <MemoEditorView
        onSaved={() => { setShowNewEditor(false); loadMemos(); }}
        onBack={() => setShowNewEditor(false)}
      />
    );
  }

  if (editorRowId && editorRow) {
    return (
      <MemoEditorView
        editRow={editorRow}
        onSaved={() => { setEditorRowId(null); loadMemos(); }}
        onBack={() => setEditorRowId(null)}
      />
    );
  }

  if (selectedRowId && selectedRow) {
    return (
      <MemoDetail
        row={selectedRow}
        canEdit={canEdit}
        onBack={() => { setSelectedRowId(null); loadMemos(); }}
        onEdit={() => setEditorRowId(selectedRowId)}
      />
    );
  }

  // ── Table ─────────────────────────────────────────────────────────────────

  return (
    <div className="view users-view">
      <header className="view-header">
        <h1>Memos</h1>
        {canEdit && (
          <button className="btn btn--primary" onClick={() => setShowNewEditor(true)}>
            + New Memo
          </button>
        )}
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
              <tr><td colSpan={6} className="users-td-msg">Loading…</td></tr>
            )}
            {!loading && sorted.length === 0 && (
              <tr><td colSpan={6} className="users-td-msg">No memos yet.</td></tr>
            )}
            {!loading && sorted.map((row) => (
              <tr
                key={row.id}
                className="users-row"
                onClick={() => setSelectedRowId(row.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, row });
                }}
              >
                <td className="users-td users-td--name">{row.title}</td>
                <td className="users-td users-td--muted">{row.createdByName}</td>
                <td className="users-td users-td--muted">{fmtDate(row.createdAt)}</td>
                <td className="users-td users-td--count">
                  {row.cases.length > 0 ? row.cases.length : <span className="users-td--muted">—</span>}
                </td>
                <td className="users-td users-td--count">
                  {row.documents.length > 0 ? row.documents.length : <span className="users-td--muted">—</span>}
                </td>
                <td className="users-td users-td--count">
                  {row.codes.length > 0 ? row.codes.length : <span className="users-td--muted">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            className="context-menu-item"
            onClick={() => { setEditorRowId(contextMenu.row.id); setContextMenu(null); }}
          >
            Edit Memo
          </button>
          {canEdit && (
            <button
              className="context-menu-item context-menu-item--danger"
              onClick={() => { setConfirmDelete(contextMenu.row); setContextMenu(null); }}
            >
              Delete Memo
            </button>
          )}
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div
          className="modal-overlay"
          onClick={() => !deleteLoading && setConfirmDelete(null)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Delete Memo</h2>
            <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
              Are you sure you want to permanently delete{" "}
              <strong>{confirmDelete.title}</strong>?
            </p>
            <p className="modal-warning-text">
              This memo will be permanently deleted and cannot be recovered.
            </p>
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button className="btn" onClick={() => setConfirmDelete(null)} disabled={deleteLoading}>
                Cancel
              </button>
              <button className="btn btn--danger" onClick={handleDelete} disabled={deleteLoading}>
                {deleteLoading ? "Deleting…" : "Delete Memo"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
