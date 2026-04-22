import { useState, useEffect, useCallback, useRef, useId } from "react";
import { useStore } from "../context/StoreContext";
import { useAuth } from "../context/AuthContext";
import { MemoEditorView } from "./Analysis_Memos_View";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

// ─── Types ────────────────────────────────────────────────────────────────────

interface DocRow {
  id: string;
  name: string;
  notes: string;
  content: string;
  filePath: string;
  cases: { id: string; name: string }[];   // associated cases (used by detail view)
  memoCount: number;
  createdByName: string;
  createdAt: string;
}

type AttributeDataType = "text" | "number" | "datetime";

interface AttributeDefinition {
  id: string;
  name: string;
  dataType: AttributeDataType;
  sortOrder: number;
}

interface AttributeValue {
  id: string;
  documentId: string;
  attributeId: string;
  value: string;
}

interface AttributeDraft {
  id?: string;
  name: string;
  dataType: AttributeDataType;
}

type SortCol = "name" | "cases" | "memos" | "createdByName" | "createdAt";
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

function inputTypeForDataType(dataType: AttributeDataType) {
  if (dataType === "number") return "number";
  if (dataType === "datetime") return "datetime-local";
  return "text";
}

// ─── Column definitions ───────────────────────────────────────────────────────

const COLS: { key: SortCol; label: string; width: string }[] = [
  { key: "name",          label: "Name",       width: "28%" },
  { key: "cases",         label: "Cases",      width: "12%" },
  { key: "memos",         label: "Memos",      width: "11%" },
  { key: "createdByName", label: "Created By", width: "25%" },
  { key: "createdAt",     label: "Created",    width: "24%" },
];

// ─── Rich text editor ─────────────────────────────────────────────────────────

const RTE_TOOLS: { cmd: string; label: string; title: string }[] = [
  { cmd: "bold",                label: "B",  title: "Bold" },
  { cmd: "italic",              label: "I",  title: "Italic" },
  { cmd: "underline",           label: "U",  title: "Underline" },
  { cmd: "insertUnorderedList", label: "•—", title: "Bullet list" },
  { cmd: "insertOrderedList",   label: "1.", title: "Numbered list" },
];

function RichTextEditor({
  initialHtml,
  editorRef,
}: {
  initialHtml: string;
  editorRef: React.RefObject<HTMLDivElement | null>;
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
    <div className="rte">
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

// ─── Document Detail sub-view ─────────────────────────────────────────────────

function DocumentDetail({
  row: initialRow,
  pb,
  startEditing,
  canEdit,
  onBack,
  onMemoAbout,
}: {
  row: DocRow;
  pb: NonNullable<ReturnType<typeof useStore>["pb"]>;
  startEditing: boolean;
  canEdit: boolean;
  onBack: () => void;
  onMemoAbout: () => void;
}) {
  const { setView, setPendingCaseId, setPendingMemoId, activeProject, updateDocument } = useStore();
  const [row,            setRow]            = useState(initialRow);
  const [editing,        setEditing]        = useState(startEditing);
  const [name,           setName]           = useState(initialRow.name);
  const [content,        setContent]        = useState(initialRow.content);
  const [contentEdited,  setContentEdited]  = useState(false);
  const [saving,         setSaving]         = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [showWarning,    setShowWarning]    = useState(false);
  const [docMemos,       setDocMemos]       = useState<{ id: string; title: string }[]>([]);
  const [showAssocCases, setShowAssocCases] = useState(false);
  const notesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    pb.collection("memos")
      .getFullList({ filter: `document ~ "${row.id}"&&deleted_at=""`, fields: "id,title", sort: "-created" })
      .then((records) => setDocMemos(records.map((r) => ({ id: r.id, title: r.title as string }))))
      .catch(console.error);
  }, [pb, row.id]);

  const refreshCases = useCallback(async () => {
    const caseDocs = await pb.collection("case_documents").getFullList({
      filter: `document="${row.id}"`,
      expand: "case",
    });
    const cases = caseDocs.map((cd) => ({
      id:   cd.case as string,
      name: (cd.expand?.case as { name?: string } | undefined)?.name ?? "—",
    }));
    setRow((prev) => ({ ...prev, cases }));
  }, [pb, row.id]);

  // Derive extension from stored file_path (original filename)
  const fileExt = row.filePath
    ? (row.filePath.split(".").pop()?.toLowerCase() ?? "")
    : "";

  function handleToggleEdit(on: boolean) {
    if (!on) {
      setName(row.name);
      setContent(row.content);
      setContentEdited(false);
      setError(null);
    }
    setEditing(on);
  }

  async function doSave() {
    setSaving(true);
    setError(null);
    try {
      const notes = notesRef.current?.innerHTML ?? row.notes;
      await updateDocument(row.id, { name, notes, content });
      setRow({ ...row, name, notes, content });
      setEditing(false);
      setContentEdited(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  function handleSave() {
    if (contentEdited) {
      setShowWarning(true);
    } else {
      doSave();
    }
  }

  return (
    <div className="view doc-detail-view">
      {/* Top bar */}
      <div className="case-detail-topbar">
        <button className="btn" onClick={onBack}>← Back to Documents</button>
        {canEdit && (
          <label className="toggle-switch" title={editing ? "Cancel editing" : "Edit document"}>
            <input
              type="checkbox"
              checked={editing}
              onChange={(e) => handleToggleEdit(e.target.checked)}
            />
            <span className="toggle-track"><span className="toggle-thumb" /></span>
            <span className="toggle-label">{editing ? "Editing" : "Edit"}</span>
          </label>
        )}
      </div>

      {/* Two-column layout */}
      <div className="doc-detail-layout">

        {/* Left column — metadata & cards (1/3) */}
        <div className="doc-detail-left">

          {/* Name card */}
          <div className="case-card">
            <h3 className="case-card-title">Document</h3>
            {editing ? (
              <input
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            ) : (
              <p className="case-card-value">{row.name}</p>
            )}
          </div>

          {/* Meta */}
          <dl className="user-detail-meta case-detail-meta">
            <dt>Created By</dt> <dd>{row.createdByName}</dd>
            <dt>Created</dt>    <dd>{fmtDate(row.createdAt)}</dd>
            <dt>File Name</dt>  <dd>{row.filePath || "—"}</dd>
            <dt>Extension</dt>  <dd>{fileExt ? `.${fileExt}` : "—"}</dd>
          </dl>

          {/* Cases card */}
          <div className="case-card">
            <div className="case-card-header">
              <h3 className="case-card-title">Cases</h3>
              {!editing && (
                <button className="btn btn--sm" onClick={() => setShowAssocCases(true)}>
                  Associate Cases
                </button>
              )}
            </div>
            {row.cases.length > 0 ? (
              <ul className="case-detail-doc-list">
                {row.cases.map((c) => (
                  <li key={c.id} className="case-detail-doc-item">
                    <button
                      className="detail-link-btn"
                      onClick={() => { setPendingCaseId(c.id); setView("cases"); }}
                    >
                      {c.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="case-card-empty">No cases associated yet.</p>
            )}
          </div>

          {/* Memos card */}
          <div className="case-card">
            <div className="case-card-header">
              <h3 className="case-card-title">Memos</h3>
              {!editing && (
                <button className="btn btn--sm" onClick={onMemoAbout}>
                  Memo About
                </button>
              )}
            </div>
            {docMemos.length > 0 ? (
              <ul className="case-detail-doc-list">
                {docMemos.map((m) => (
                  <li key={m.id} className="case-detail-doc-item">
                    <button
                      className="detail-link-btn"
                      onClick={() => { setPendingMemoId(m.id); setView("memos"); }}
                    >
                      {m.title}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="case-card-empty">No memos associated.</p>
            )}
          </div>

          {/* Notes card */}
          <div className="case-card">
            <h3 className="case-card-title">Notes</h3>
            {editing ? (
              <RichTextEditor initialHtml={row.notes} editorRef={notesRef} />
            ) : row.notes ? (
              <div className="case-notes-body" dangerouslySetInnerHTML={{ __html: row.notes }} />
            ) : (
              <p className="case-card-empty">No notes yet.</p>
            )}
          </div>

          {/* Save / cancel */}
          {editing && (
            <div className="case-detail-actions">
              {error && <p className="auth-error">{error}</p>}
              <button className="btn" onClick={() => handleToggleEdit(false)} disabled={saving}>
                Cancel
              </button>
              <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          )}

        </div>

        {/* Right column — document content (2/3) */}
        <div className="doc-detail-right">
          <div className="case-card doc-content-card">
            <h3 className="case-card-title">Contents</h3>
            {editing ? (
              <textarea
                className="doc-content-editor"
                value={content}
                onChange={(e) => { setContent(e.target.value); setContentEdited(true); }}
              />
            ) : content ? (
              <pre className="doc-content-body">{content}</pre>
            ) : (
              <p className="case-card-empty">No content extracted.</p>
            )}
          </div>
        </div>

      </div>

      {/* Content-edit warning modal */}
      {showWarning && (
        <div className="modal-overlay" onClick={() => setShowWarning(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Save Content Changes?</h2>
            <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
              You've edited the document contents stored in Kanqual.
            </p>
            <p className="modal-warning-text">
              This only updates the text stored in this app — the original file
              on your computer will not be modified.
            </p>
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button className="btn" onClick={() => setShowWarning(false)} disabled={saving}>
                Cancel
              </button>
              <button
                className="btn btn--primary"
                onClick={() => { setShowWarning(false); doSave(); }}
                disabled={saving}
              >
                Save Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Associate Cases modal (opened from within detail) */}
      {showAssocCases && activeProject && (
        <AssociateCasesModal
          docRow={row}
          pb={pb}
          projectId={activeProject.id}
          onDone={() => { setShowAssocCases(false); refreshCases(); }}
          onClose={() => setShowAssocCases(false)}
        />
      )}

    </div>
  );
}

// ─── File text extraction ─────────────────────────────────────────────────────

const ACCEPTED_TYPES = ".txt,.rtf,.docx,.pdf,.csv";
const ACCEPTED_EXTS  = new Set(["txt", "rtf", "docx", "pdf", "csv"]);

function stripRtf(rtf: string): string {
  return rtf
    .replace(/\\par\b/gi, "\n")
    .replace(/\\line\b/gi, "\n")
    .replace(/\\tab\b/gi, "\t")
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\[a-z]+\*?-?\d* ?/gi, "")
    .replace(/[{}\\]/g, "")
    .replace(/ {2,}/g, " ")
    .trim();
}

async function findZipEntry(bytes: Uint8Array, target: string): Promise<string | null> {
  let off = 0;
  while (off < bytes.length - 30) {
    if (bytes[off] !== 0x50 || bytes[off+1] !== 0x4b ||
        bytes[off+2] !== 0x03 || bytes[off+3] !== 0x04) break;
    const method      = bytes[off+8]  | (bytes[off+9]  << 8);
    const cSize       = bytes[off+18] | (bytes[off+19] << 8) | (bytes[off+20] << 16) | (bytes[off+21] << 24);
    const fnLen       = bytes[off+26] | (bytes[off+27] << 8);
    const extraLen    = bytes[off+28] | (bytes[off+29] << 8);
    const fname       = new TextDecoder().decode(bytes.slice(off+30, off+30+fnLen));
    const dataOff     = off + 30 + fnLen + extraLen;
    const compressed  = bytes.slice(dataOff, dataOff + cSize);
    if (fname === target) {
      if (method === 0) return new TextDecoder().decode(compressed);
      if (method === 8) {
        const ds = new DecompressionStream("deflate-raw");
        const w  = ds.writable.getWriter();
        w.write(compressed); w.close();
        const r = ds.readable.getReader();
        const chunks: Uint8Array[] = [];
        for (;;) { const { done, value } = await r.read(); if (done) break; chunks.push(value); }
        const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
        let pos = 0; for (const c of chunks) { out.set(c, pos); pos += c.length; }
        return new TextDecoder().decode(out);
      }
      return null;
    }
    off = dataOff + cSize;
  }
  return null;
}

async function extractDocxText(file: File): Promise<string> {
  const buf   = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const xml   = await findZipEntry(bytes, "word/document.xml");
  if (!xml) return "";
  return xml
    .replace(/<w:br[^/]*/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/ {2,}/g, " ")
    .trim();
}

async function extractPdfText(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  const pdf  = await pdfjsLib.getDocument({ data }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    const line    = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    parts.push(line);
  }
  return parts.join("\n").replace(/ {2,}/g, " ").trim();
}

async function extractTextFromFile(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "txt" || ext === "csv") {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload  = (e) => res((e.target?.result as string) ?? "");
      r.onerror = rej;
      r.readAsText(file);
    });
  }
  if (ext === "rtf") {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload  = (e) => res(stripRtf((e.target?.result as string) ?? ""));
      r.onerror = rej;
      r.readAsText(file);
    });
  }
  if (ext === "docx") return extractDocxText(file);
  if (ext === "pdf")  return extractPdfText(file);
  throw new Error(`File type ".${ext}" is not supported.`);
}

// ─── Associate Cases modal ────────────────────────────────────────────────────

type CaseSortCol = "name" | "documents" | "createdAt";

interface CaseItem {
  id: string;
  name: string;
  docNames: string[];   // display names of all associated documents
  createdAt: string;
}

function AssociateCasesModal({
  docRow,
  pb,
  projectId,
  onDone,
  onClose,
}: {
  docRow: DocRow;
  pb: NonNullable<ReturnType<typeof useStore>["pb"]>;
  projectId: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const { addCaseDocument, removeCaseDocument } = useStore();
  const [cases,    setCases]    = useState<CaseItem[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortCol,  setSortCol]  = useState<CaseSortCol>("name");
  const [sortDir,  setSortDir]  = useState<SortDir>("asc");

  // Map `${docId}:${caseId}` → case_documents record id (for deletions)
  const casedocRecordId = useRef<Record<string, string>>({});
  // Which case IDs were associated with this document on load (for diffing)
  const initialSelected = useRef<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const caseRecords = await pb.collection("cases").getFullList({
          filter: `project="${projectId}"&&deleted_at=""`,
          sort: "name",
        });

        if (caseRecords.length === 0) {
          setCases([]);
          setLoading(false);
          return;
        }

        const allCaseDocs = await pb.collection("case_documents").getFullList({
          filter: caseRecords.map((c) => `case="${c.id}"`).join(" || "),
          expand: "document",
        });

        // Build lookup structures
        const docNamesByCase: Record<string, string[]> = {};
        const recordMap: Record<string, string> = {};

        for (const cd of allCaseDocs) {
          const docId  = cd.document as string;
          const caseId = cd.case    as string;
          const name   = (cd.expand?.document as { name?: string } | undefined)?.name ?? "—";
          (docNamesByCase[caseId] ??= []).push(name);
          recordMap[`${docId}:${caseId}`] = cd.id as string;
        }

        casedocRecordId.current = recordMap;

        const preSelected = new Set(
          allCaseDocs
            .filter((cd) => cd.document === docRow.id)
            .map((cd) => cd.case as string),
        );
        initialSelected.current = preSelected;
        setSelected(new Set(preSelected));

        setCases(caseRecords.map((r) => ({
          id:       r.id,
          name:     r.name as string,
          docNames: docNamesByCase[r.id] ?? [],
          createdAt: r.created as string,
        })));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load cases.");
      } finally {
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleCase(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === cases.length) setSelected(new Set());
    else setSelected(new Set(cases.map((c) => c.id)));
  }

  function handleSort(col: CaseSortCol) {
    if (col === sortCol) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const init = initialSelected.current;
      const toAdd    = [...selected].filter((id) => !init.has(id));
      const toRemove = [...init].filter((id) => !selected.has(id));

      await Promise.all([
        ...toAdd.map((caseId) => addCaseDocument(caseId, docRow.id)),
        ...toRemove.map((caseId) => {
          const recId = casedocRecordId.current[`${docRow.id}:${caseId}`];
          return recId ? removeCaseDocument(recId) : Promise.resolve();
        }),
      ]);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save associations.");
      setSaving(false);
    }
  }

  const sortedCases = [...cases].sort((a, b) => {
    let av: string, bv: string;
    if (sortCol === "documents") { av = a.docNames[0] ?? ""; bv = b.docNames[0] ?? ""; }
    else { av = sortCol === "name" ? a.name : a.createdAt; bv = sortCol === "name" ? b.name : b.createdAt; }
    const cmp = av.localeCompare(bv, undefined, { sensitivity: "base" });
    return sortDir === "asc" ? cmp : -cmp;
  });

  const allChecked  = cases.length > 0 && selected.size === cases.length;
  const someChecked = selected.size > 0 && selected.size < cases.length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <h2>Associate Cases — {docRow.name}</h2>

        {loading ? (
          <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>Loading cases…</p>
        ) : cases.length === 0 ? (
          <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
            No cases in this project yet.
          </p>
        ) : (
          <div className="assoc-doc-table-wrap">
            <table className="users-table">
              <thead>
                <tr>
                  <th className="users-th assoc-doc-check-col">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={(el) => { if (el) el.indeterminate = someChecked; }}
                      onChange={toggleAll}
                      title="Select all"
                    />
                  </th>
                  {(["name", "documents", "createdAt"] as CaseSortCol[]).map((col) => (
                    <th
                      key={col}
                      className={`users-th${sortCol === col ? " users-th--sorted" : ""}`}
                      onClick={() => handleSort(col)}
                      style={{ cursor: "pointer" }}
                    >
                      {col === "name" ? "Name" : col === "documents" ? "Documents" : "Created"}
                      <span className="users-sort-icon">
                        {sortCol === col ? (sortDir === "asc" ? " ↑" : " ↓") : " ↕"}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedCases.map((c) => (
                  <tr
                    key={c.id}
                    className={`users-row${selected.has(c.id) ? " assoc-doc-row--selected" : ""}`}
                    onClick={() => toggleCase(c.id)}
                  >
                    <td className="users-td assoc-doc-check-col" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggleCase(c.id)}
                      />
                    </td>
                    <td className="users-td users-td--name">{c.name}</td>
                    <td className="users-td users-td--muted cases-td-docs">
                      {c.docNames.length > 0
                        ? c.docNames.map((d, i) => <span key={i} className="cases-doc-name">{d}</span>)
                        : <span className="cases-no-docs">—</span>}
                    </td>
                    <td className="users-td users-td--muted">{fmtDate(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {error && <p className="auth-error" style={{ marginTop: 12 }}>{error}</p>}

        <div className="form-actions" style={{ marginTop: 20 }}>
          <span style={{ fontSize: 12, color: "var(--color-text-muted)", marginRight: "auto" }}>
            {selected.size} selected
          </span>
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="btn btn--primary"
            onClick={handleSave}
            disabled={saving || loading}
          >
            {saving ? "Saving…" : "Save Associations"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── New Document modal ───────────────────────────────────────────────────────

type InputMode = "upload" | "paste";

function NewDocumentModal({
  onDone,
  onClose,
}: {
  onDone: () => void;
  onClose: () => void;
}) {
  const { addDocument } = useStore();
  const { user: currentUser } = useAuth();
  const [name,      setName]      = useState("");
  const [mode,      setMode]      = useState<InputMode>("upload");
  const [file,      setFile]      = useState<File | null>(null);
  const [extracted, setExtracted] = useState("");
  const [extracting,setExtracting]= useState(false);
  const [extractErr,setExtractErr]= useState<string | null>(null);
  const [pasted,    setPasted]    = useState("");
  const [dragging,  setDragging]  = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function processFile(f: File) {
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ACCEPTED_EXTS.has(ext)) {
      setExtractErr(`Unsupported file type ".${ext}".`);
      return;
    }
    setFile(f);
    if (!name) setName(f.name.replace(/\.[^/.]+$/, ""));
    setExtracting(true);
    setExtractErr(null);
    try {
      setExtracted(await extractTextFromFile(f));
    } catch {
      setExtractErr("Could not read file contents.");
      setExtracted("");
    } finally {
      setExtracting(false);
    }
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) processFile(f);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) processFile(f);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const content   = mode === "upload" ? extracted : pasted;
      const file_path = file ? file.name : "";
      await addDocument(name.trim(), file_path, content, currentUser?.id);
      onDone();
    } catch (err) {
      console.error("Document create error:", err);
      const fieldErrors = (err as { data?: { data?: Record<string, { message?: string }> } })
        .data?.data;
      if (fieldErrors && typeof fieldErrors === "object" && Object.keys(fieldErrors).length > 0) {
        const msg = Object.entries(fieldErrors)
          .map(([f, v]) => `${f}: ${v?.message ?? "invalid"}`)
          .join(" · ");
        setError(msg);
      } else {
        setError(err instanceof Error ? err.message : "Failed to create document.");
      }
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = name.trim().length > 0 && (mode === "paste" ? pasted.trim().length > 0 : !!file);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal doc-upload-modal" onClick={(e) => e.stopPropagation()}>
        <h2>New Document</h2>
        <form className="form" onSubmit={handleSubmit}>

          <label className="form-label">
            Document Name
            <input
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Document name"
              required
              autoFocus={mode === "paste"}
            />
          </label>

          {mode === "upload" ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES}
                style={{ display: "none" }}
                onChange={onFileInput}
              />
              <div
                className={`doc-dropzone${dragging ? " doc-dropzone--drag" : ""}${file ? " doc-dropzone--filled" : ""}`}
                onClick={() => !file && fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                {!file ? (
                  <>
                    <span className="doc-dropzone-icon">↑</span>
                    <span className="doc-dropzone-primary">Click to browse or drag &amp; drop</span>
                    <span className="doc-dropzone-hint">txt · rtf · doc · docx · pdf · csv</span>
                  </>
                ) : extracting ? (
                  <span className="doc-dropzone-primary">Reading file…</span>
                ) : (
                  <>
                    <span className="doc-dropzone-filename">{file.name}</span>
                    {extractErr
                      ? <span className="doc-dropzone-warn">{extractErr}</span>
                      : extracted
                        ? <span className="doc-dropzone-hint">{extracted.length.toLocaleString()} characters extracted</span>
                        : <span className="doc-dropzone-hint">No text extracted — add notes manually after import</span>
                    }
                    <button
                      type="button"
                      className="doc-dropzone-change"
                      onClick={(e) => { e.stopPropagation(); setFile(null); setExtracted(""); setExtractErr(null); fileInputRef.current?.click(); }}
                    >
                      Change file
                    </button>
                  </>
                )}
              </div>
            </>
          ) : (
            <textarea
              className="form-input doc-content-textarea"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="Paste or type document text…"
              rows={8}
              autoFocus
            />
          )}

          {error && <p className="auth-error">{error}</p>}

          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={loading || !canSubmit}>
              {loading ? "Creating…" : "Create Document"}
            </button>
          </div>

          <button
            type="button"
            className="doc-mode-switch"
            onClick={() => setMode(mode === "upload" ? "paste" : "upload")}
          >
            {mode === "upload"
              ? "Or paste text content instead"
              : "Or upload a file instead"}
          </button>

        </form>
      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

function NewAttributeModal({
  onClose,
  onCreate,
  saving,
}: {
  onClose: () => void;
  onCreate: (name: string, dataType: AttributeDataType) => void;
  saving: boolean;
}) {
  const [name, setName] = useState("");
  const [dataType, setDataType] = useState<AttributeDataType>("text");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New Attribute</h2>
        <div className="form-group">
          <label className="form-label">Attribute name</label>
          <input
            className="form-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Publication date"
            autoFocus
          />
        </div>
        <div className="form-group">
          <label className="form-label">Data type</label>
          <div className="attribute-type-picker">
            {([
              { value: "text", label: "Text" },
              { value: "number", label: "Numbers" },
              { value: "datetime", label: "Date/time" },
            ] as { value: AttributeDataType; label: string }[]).map((option) => (
              <button
                key={option.value}
                type="button"
                className={`attribute-type-btn${dataType === option.value ? " attribute-type-btn--active" : ""}`}
                onClick={() => setDataType(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="form-actions" style={{ marginTop: 20 }}>
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="btn btn--primary"
            onClick={() => onCreate(name.trim(), dataType)}
            disabled={saving || !name.trim()}
          >
            {saving ? "Opening..." : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AttributeValuesModal({
  draft,
  rows,
  attributeValues,
  saving,
  onBack,
  onCancel,
  onSave,
}: {
  draft: AttributeDraft;
  rows: DocRow[];
  attributeValues: Record<string, AttributeValue>;
  saving: boolean;
  onBack?: () => void;
  onCancel: () => void;
  onSave: (draft: AttributeDraft, valuesByDocument: Record<string, string>) => void;
}) {
  const [name, setName] = useState(draft.name);
  const [dataType, setDataType] = useState<AttributeDataType>(draft.dataType);
  const [valuesByDocument, setValuesByDocument] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const row of rows) {
      initial[row.id] = draft.id ? attributeValues[`${row.id}:${draft.id}`]?.value ?? "" : "";
    }
    return initial;
  });

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <h2>{draft.id ? "Edit Attribute" : "Attribute Values"}</h2>

        <div className="attribute-values-details">
          <label className="form-group">
            <span className="form-label">Attribute name</span>
            <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="form-group">
            <span className="form-label">Data type</span>
            <div className="attribute-type-picker">
              {([
                { value: "text", label: "Text" },
                { value: "number", label: "Numbers" },
                { value: "datetime", label: "Date/time" },
              ] as { value: AttributeDataType; label: string }[]).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`attribute-type-btn${dataType === option.value ? " attribute-type-btn--active" : ""}`}
                  onClick={() => setDataType(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="attribute-values-list">
          {rows.length === 0 ? (
            <p className="case-card-empty">No documents yet.</p>
          ) : (
            rows.map((row) => (
              <label key={row.id} className="attribute-value-row">
                <span>{row.name}</span>
                <input
                  className="form-input"
                  type={inputTypeForDataType(dataType)}
                  step={dataType === "number" ? "any" : undefined}
                  value={valuesByDocument[row.id] ?? ""}
                  onChange={(e) => setValuesByDocument((prev) => ({ ...prev, [row.id]: e.target.value }))}
                />
              </label>
            ))
          )}
        </div>

        <div className="form-actions" style={{ marginTop: 20 }}>
          {onBack && <button className="btn" onClick={onBack} disabled={saving}>Back</button>}
          <button className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
          <button
            className="btn btn--primary"
            onClick={() => onSave({ ...draft, name: name.trim(), dataType }, valuesByDocument)}
            disabled={saving || !name.trim()}
          >
            {saving ? "Saving..." : "Save Attribute"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DocumentsView() {
  const { activeProject, pb, canEdit, pendingDocId, setPendingDocId, deleteDocument, logAction } = useStore();

  const [rows,    setRows]    = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const [sortCol, setSortCol] = useState<SortCol>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; row: DocRow;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const [confirmDelete, setConfirmDelete] = useState<DocRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [newDocOpen,    setNewDocOpen]    = useState(false);
  const [selectedRow,   setSelectedRow]   = useState<DocRow | null>(null);
  const [editStartRow,  setEditStartRow]  = useState<DocRow | null>(null);
  const [assocCaseDoc,  setAssocCaseDoc]  = useState<DocRow | null>(null);
  const [memoForDoc,    setMemoForDoc]    = useState<DocRow | null>(null);
  const [showAttributesTable, setShowAttributesTable] = useState(false);
  const [attributeDefs, setAttributeDefs] = useState<AttributeDefinition[]>([]);
  const [attributeValues, setAttributeValues] = useState<Record<string, AttributeValue>>({});
  const [showNewAttribute, setShowNewAttribute] = useState(false);
  const [attributeValueDraft, setAttributeValueDraft] = useState<AttributeDraft | null>(null);
  const [attributeSaving, setAttributeSaving] = useState(false);
  const [attributeContextMenu, setAttributeContextMenu] = useState<{ x: number; y: number; attr: AttributeDefinition } | null>(null);
  const attributeContextMenuRef = useRef<HTMLDivElement>(null);

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadDocuments = useCallback(async () => {
    if (!activeProject || !pb) return;
    setLoading(true);
    setError(null);
    try {
      const pid = activeProject.id;

      // Fetch documents, memos, and project-level attribute definitions in parallel
      const [docRecords, memoRecords, attrDefRecords] = await Promise.all([
        pb.collection("documents").getFullList({
          filter: `project="${pid}"&&deleted_at=""`,
          expand: "created_by",
          sort:   "-created",
        }),
        pb.collection("memos").getFullList({
          filter: `project="${pid}"&&deleted_at=""`,
          fields: "id,document",
        }),
        pb.collection("document_attribute_definitions").getFullList({
          filter: `project="${pid}"&&deleted_at=""`,
          sort: "sort_order,created",
        }),
      ]);

      setAttributeDefs(attrDefRecords.map((r) => ({
        id: r.id,
        name: r.name as string,
        dataType: r.data_type as AttributeDataType,
        sortOrder: (r.sort_order as number | undefined) ?? 0,
      })));

      // Load case associations and attributes (needs doc IDs from above)
      const docIds = docRecords.map((d) => d.id);
      const [caseDocs, attrRecords] = docIds.length > 0
        ? await Promise.all([
            pb.collection("case_documents").getFullList({
              filter: docIds.map((id) => `document="${id}"`).join(" || "),
              expand: "case",
            }),
            pb.collection("document_attribute_values").getFullList({
              filter: `(${docIds.map((id) => `document="${id}"`).join(" || ")})&&deleted_at=""`,
              sort: "created",
            }),
          ])
        : [[], []];

      // Build map docId → cases {id, name}
      const casesByDoc: Record<string, { id: string; name: string }[]> = {};
      for (const cd of caseDocs) {
        const caseName: string = cd.expand?.case?.name || "—";
        (casesByDoc[cd.document] ??= []).push({ id: cd.case as string, name: caseName });
      }

      // Build map docId → memo count
      const nextAttributeValues: Record<string, AttributeValue> = {};
      for (const attr of attrRecords) {
        const documentId = attr.document as string;
        const attributeId = attr.attribute as string;
        nextAttributeValues[`${documentId}:${attributeId}`] = {
          id: attr.id,
          documentId,
          attributeId,
          value: (attr.value as string | undefined) ?? "",
        };
      }
      setAttributeValues(nextAttributeValues);

      const memosByDoc: Record<string, number> = {};
      for (const memo of memoRecords) {
        const ids: string[] = Array.isArray(memo.document)
          ? memo.document
          : memo.document ? [memo.document as string] : [];
        for (const did of ids) {
          memosByDoc[did] = (memosByDoc[did] ?? 0) + 1;
        }
      }

      setRows(
        docRecords.map((r) => {
          const cb = r.expand?.created_by;
          return {
            id:            r.id,
            name:          r.name,
            notes:         r.notes ?? "",
            content:       r.content ?? "",
            filePath:      r.file_path ?? "",
            cases:         casesByDoc[r.id] ?? [],
            memoCount:     memosByDoc[r.id] ?? 0,
            createdByName: cb?.name || cb?.email || "—",
            createdAt:     r.created,
          };
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load documents.");
    } finally {
      setLoading(false);
    }
  }, [activeProject, pb]);

  useEffect(() => { loadDocuments(); }, [loadDocuments]);

  // Consume a pending document ID (navigated here from another view)
  useEffect(() => {
    if (!pendingDocId || rows.length === 0) return;
    const match = rows.find((r) => r.id === pendingDocId);
    if (match) {
      setSelectedRow(match);
      setPendingDocId(null);
    }
  }, [rows, pendingDocId, setPendingDocId]);

  // ── Close context menu on outside click / Escape ──────────────────────────

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node))
        setContextMenu(null);
      if (attributeContextMenuRef.current && !attributeContextMenuRef.current.contains(e.target as Node))
        setAttributeContextMenu(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setContextMenu(null);
        setAttributeContextMenu(null);
      }
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
    if (sortCol === "cases") {
      cmp = a.cases.length - b.cases.length;
    } else if (sortCol === "memos") {
      cmp = a.memoCount - b.memoCount;
    } else {
      const aVal = String((a as unknown as Record<string, unknown>)[sortCol] ?? "");
      const bVal = String((b as unknown as Record<string, unknown>)[sortCol] ?? "");
      cmp = aVal.localeCompare(bVal, undefined, { sensitivity: "base" });
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  function handleSort(col: SortCol) {
    if (col === sortCol) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  }

  function valueKey(documentId: string, attributeId: string) {
    return `${documentId}:${attributeId}`;
  }

  function formatAttributeDisplay(value: string, dataType: AttributeDataType) {
    if (!value) return "";
    if (dataType === "datetime") {
      try {
        return new Date(value).toLocaleString(undefined, {
          year: "numeric", month: "short", day: "numeric",
          hour: "2-digit", minute: "2-digit",
        });
      } catch {
        return value;
      }
    }
    return value;
  }

  function handleCreateAttribute(name: string, dataType: AttributeDataType) {
    if (!name.trim()) return;
    setShowNewAttribute(false);
    setAttributeValueDraft({ name: name.trim(), dataType });
  }

  async function handleSaveAttribute(draft: AttributeDraft, valuesByDocument: Record<string, string>) {
    if (!activeProject || !pb || !draft.name.trim()) return;
    setAttributeSaving(true);
    setError(null);
    try {
      const record = draft.id
        ? await pb.collection("document_attribute_definitions").update(draft.id, {
            name: draft.name.trim(),
            data_type: draft.dataType,
            deleted_at: "",
          })
        : await pb.collection("document_attribute_definitions").create({
            project: activeProject.id,
            name: draft.name.trim(),
            data_type: draft.dataType,
            sort_order: attributeDefs.length,
            deleted_at: "",
          });

      const attrId = record.id;
      const nextDef: AttributeDefinition = {
        id: attrId,
        name: record.name as string,
        dataType: record.data_type as AttributeDataType,
        sortOrder: (record.sort_order as number | undefined) ?? attributeDefs.length,
      };

      const nextValues = { ...attributeValues };
      await Promise.all(rows.map(async (row) => {
        const key = valueKey(row.id, attrId);
        const existing = nextValues[key];
        const value = valuesByDocument[row.id] ?? "";
        if (existing?.id) {
          await pb.collection("document_attribute_values").update(existing.id, {
            value,
            deleted_at: value.trim() ? "" : new Date().toISOString(),
          });
          if (value.trim()) nextValues[key] = { ...existing, value };
          else delete nextValues[key];
        } else if (value.trim()) {
          const valueRecord = await pb.collection("document_attribute_values").create({
            document: row.id,
            attribute: attrId,
            value,
            deleted_at: "",
          });
          nextValues[key] = { id: valueRecord.id, documentId: row.id, attributeId: attrId, value };
        }
      }));

      setAttributeDefs((prev) => {
        const exists = prev.some((attr) => attr.id === attrId);
        return exists
          ? prev.map((attr) => attr.id === attrId ? nextDef : attr)
          : [...prev, nextDef];
      });
      setAttributeValues(nextValues);
      await logAction(
        activeProject.id,
        draft.id ? "document_attribute.update" : "document_attribute.create",
        `${draft.id ? "Updated" : "Added"} document attribute "${nextDef.name}"`,
        attrId,
      );
      setAttributeValueDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save attribute.");
    } finally {
      setAttributeSaving(false);
    }
  }

  async function handleDeleteAttribute(attr: AttributeDefinition) {
    if (!pb) return;
    setAttributeSaving(true);
    setError(null);
    try {
      const deletedAt = new Date().toISOString();
      await pb.collection("document_attribute_definitions").update(attr.id, { deleted_at: deletedAt });
      const valuesForAttribute = Object.values(attributeValues).filter((value) => value.attributeId === attr.id && value.id);
      await Promise.all(valuesForAttribute.map((value) =>
        pb.collection("document_attribute_values").update(value.id, { deleted_at: deletedAt })
      ));
      setAttributeDefs((prev) => prev.filter((item) => item.id !== attr.id));
      setAttributeValues((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (next[key].attributeId === attr.id) delete next[key];
        }
        return next;
      });
      if (activeProject) {
        await logAction(activeProject.id, "document_attribute.delete", `Deleted document attribute "${attr.name}"`, attr.id);
      }
      setAttributeContextMenu(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete attribute.");
    } finally {
      setAttributeSaving(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleteLoading(true);
    try {
      await deleteDocument(confirmDelete.id);
      setRows((prev) => prev.filter((r) => r.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete document.");
      setConfirmDelete(null);
    } finally {
      setDeleteLoading(false);
    }
  }

  // ── Detail / edit ─────────────────────────────────────────────────────────

  if (memoForDoc) {
    return (
      <MemoEditorView
        preselectedDocumentIds={[memoForDoc.id]}
        backLabel="← Back to Documents"
        onSaved={() => setMemoForDoc(null)}
        onBack={() => setMemoForDoc(null)}
      />
    );
  }

  const detailRow = selectedRow ?? editStartRow;
  const startEdit = editStartRow !== null;

  if (detailRow && pb) {
    return (
      <DocumentDetail
        row={detailRow}
        pb={pb}
        startEditing={startEdit}
        canEdit={canEdit}
        onBack={() => { setSelectedRow(null); setEditStartRow(null); loadDocuments(); }}
        onMemoAbout={() => setMemoForDoc(detailRow)}
      />
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="view users-view">
      {/* Header */}
      <header className="view-header">
        <h1>Documents</h1>
        {canEdit && (
          <button
            className="btn btn--primary"
            onClick={showAttributesTable ? () => setShowNewAttribute(true) : () => setNewDocOpen(true)}
          >
            {showAttributesTable ? "+ Add Attribute" : "+ New Document"}
          </button>
        )}
      </header>

      {error && <p className="users-error">{error}</p>}

      <div className="case-table-toolbar">
        <div />
        <label className="toggle-switch" title="Show document attributes table">
          <input
            type="checkbox"
            checked={showAttributesTable}
            onChange={(e) => setShowAttributesTable(e.target.checked)}
          />
          <span className="toggle-track"><span className="toggle-thumb" /></span>
          <span className="toggle-label">Attributes</span>
        </label>
      </div>

      {showAttributesTable && (
        <div className="users-table-wrap case-attributes-table-wrap">
          <table className="users-table case-attributes-table">
            <thead>
              <tr>
                <th className="users-th case-attributes-case-col">Document</th>
                {attributeDefs.map((attr) => (
                  <th
                    key={attr.id}
                    className="users-th case-attributes-value-col"
                    onContextMenu={(e) => {
                      if (!canEdit) return;
                      e.preventDefault();
                      setAttributeContextMenu({ x: e.clientX, y: e.clientY, attr });
                    }}
                  >
                    {attr.name}
                    <span className="case-attribute-type-label">{attr.dataType === "datetime" ? "Date/time" : attr.dataType}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={Math.max(attributeDefs.length + 1, 1)} className="users-td-msg">Loading...</td></tr>}
              {!loading && sorted.length === 0 && <tr><td colSpan={Math.max(attributeDefs.length + 1, 1)} className="users-td-msg">No documents yet.</td></tr>}
              {!loading && sorted.map((row) => (
                <tr key={row.id} className="users-row">
                  <td className="users-td users-td--name case-attributes-case-cell">{row.name}</td>
                  {attributeDefs.map((attr) => {
                    const key = valueKey(row.id, attr.id);
                    const cell = attributeValues[key];
                    return (
                      <td key={attr.id} className="users-td case-attributes-value-cell">
                        {cell?.value ? formatAttributeDisplay(cell.value, attr.dataType) : <span className="cases-no-docs">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Table */}
      <div
        className="users-table-wrap"
        hidden={showAttributesTable}
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
              <tr><td colSpan={5} className="users-td-msg">No documents yet.</td></tr>
            )}
            {!loading && sorted.map((row) => (
              <tr
                key={row.id}
                className="users-row"
                onClick={() => setSelectedRow(row)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, row });
                }}
              >
                <td className="users-td users-td--name">{row.name}</td>
                <td className="users-td users-td--muted users-td--count">
                  {row.cases.length > 0 ? row.cases.length : <span className="cases-no-docs">—</span>}
                </td>
                <td className="users-td users-td--muted users-td--count">
                  {row.memoCount > 0 ? row.memoCount : <span className="cases-no-docs">—</span>}
                </td>
                <td className="users-td users-td--muted">{row.createdByName}</td>
                <td className="users-td users-td--muted">{fmtDate(row.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {attributeContextMenu && (
        <div
          ref={attributeContextMenuRef}
          className="context-menu"
          style={{ top: attributeContextMenu.y, left: attributeContextMenu.x }}
        >
          <button
            className="context-menu-item"
            onClick={() => {
              setAttributeValueDraft({
                id: attributeContextMenu.attr.id,
                name: attributeContextMenu.attr.name,
                dataType: attributeContextMenu.attr.dataType,
              });
              setAttributeContextMenu(null);
            }}
          >
            Edit Attribute
          </button>
          <button
            className="context-menu-item context-menu-item--danger"
            onClick={() => handleDeleteAttribute(attributeContextMenu.attr)}
          >
            Delete Attribute
          </button>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            className="context-menu-item"
            onClick={() => { setAssocCaseDoc(contextMenu.row); setContextMenu(null); }}
          >
            Associate Cases with Document
          </button>
          <button
            className="context-menu-item"
            onClick={() => { setMemoForDoc(contextMenu.row); setContextMenu(null); }}
          >
            Memo About Document
          </button>
          <button
            className="context-menu-item"
            onClick={() => { setEditStartRow(contextMenu.row); setContextMenu(null); }}
          >
            Edit Document
          </button>
          {canEdit && (
            <button
              className="context-menu-item context-menu-item--danger"
              onClick={() => { setConfirmDelete(contextMenu.row); setContextMenu(null); }}
            >
              Delete Document
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
            <h2>Delete Document</h2>
            <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
              Are you sure you want to permanently delete{" "}
              <strong>{confirmDelete.name}</strong>?
            </p>
            <p className="modal-warning-text">
              All data associated with this document — including annotations,
              case links, and any linked memos — will be permanently lost and
              cannot be recovered.
            </p>
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button
                className="btn"
                onClick={() => setConfirmDelete(null)}
                disabled={deleteLoading}
              >
                Cancel
              </button>
              <button
                className="btn btn--danger"
                onClick={handleDelete}
                disabled={deleteLoading}
              >
                {deleteLoading ? "Deleting…" : "Delete Document"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Associate Cases modal */}
      {assocCaseDoc && pb && activeProject && (
        <AssociateCasesModal
          docRow={assocCaseDoc}
          pb={pb}
          projectId={activeProject.id}
          onDone={() => { setAssocCaseDoc(null); loadDocuments(); }}
          onClose={() => setAssocCaseDoc(null)}
        />
      )}

      {/* New Document modal */}
      {newDocOpen && (
        <NewDocumentModal
          onDone={() => { setNewDocOpen(false); loadDocuments(); }}
          onClose={() => setNewDocOpen(false)}
        />
      )}

      {showNewAttribute && (
        <NewAttributeModal
          saving={attributeSaving}
          onClose={() => !attributeSaving && setShowNewAttribute(false)}
          onCreate={handleCreateAttribute}
        />
      )}

      {attributeValueDraft && (
        <AttributeValuesModal
          draft={attributeValueDraft}
          rows={sorted}
          attributeValues={attributeValues}
          saving={attributeSaving}
          onBack={attributeValueDraft.id ? undefined : () => { setAttributeValueDraft(null); setShowNewAttribute(true); }}
          onCancel={() => !attributeSaving && setAttributeValueDraft(null)}
          onSave={handleSaveAttribute}
        />
      )}
    </div>
  );
}
