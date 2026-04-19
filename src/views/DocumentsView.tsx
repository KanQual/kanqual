import { useState, useEffect, useCallback, useRef, useId } from "react";
import { useStore } from "../context/StoreContext";
import { useAuth } from "../context/AuthContext";
import { MemoEditorView } from "./MemosView";
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
  const { setView, setPendingCaseId, setPendingMemoId, activeProject } = useStore();
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
      .getFullList({ filter: `document ~ "${row.id}"`, fields: "id,title", sort: "-created" })
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
      await pb.collection("documents").update(row.id, { name, notes, content });
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
              You've edited the document contents stored in Quallect.
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
          filter: `project="${projectId}"`,
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
        ...toAdd.map((caseId) =>
          pb.collection("case_documents").create({ case: caseId, document: docRow.id }),
        ),
        ...toRemove.map((caseId) => {
          const recId = casedocRecordId.current[`${docRow.id}:${caseId}`];
          return recId ? pb.collection("case_documents").delete(recId) : Promise.resolve();
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
  projectId,
  pb,
  currentUserId,
  onDone,
  onClose,
}: {
  projectId: string;
  pb: NonNullable<ReturnType<typeof useStore>["pb"]>;
  currentUserId: string;
  onDone: () => void;
  onClose: () => void;
}) {
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
      const payload: Record<string, unknown> = {
        project:   projectId,
        name:      name.trim(),
        content,
        file_path,
      };
      if (currentUserId) payload.created_by = currentUserId;
      await pb.collection("documents").create(payload);
      onDone();
    } catch (err) {
      console.error("Document create error:", err);
      // err.data === full response body { code, message, data: { field: { code, message } } }
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

export function DocumentsView() {
  const { activeProject, pb, canEdit, pendingDocId, setPendingDocId } = useStore();
  const { user: currentUser } = useAuth();

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

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadDocuments = useCallback(async () => {
    if (!activeProject || !pb) return;
    setLoading(true);
    setError(null);
    try {
      const pid = activeProject.id;

      // Fetch documents and memos in parallel
      const [docRecords, memoRecords] = await Promise.all([
        pb.collection("documents").getFullList({
          filter: `project="${pid}"`,
          expand: "created_by",
          sort:   "-created",
        }),
        pb.collection("memos").getFullList({
          filter: `project="${pid}"`,
          fields: "id,document",
        }),
      ]);

      // Load case associations (needs doc IDs from above)
      const docIds = docRecords.map((d) => d.id);
      const caseDocs = docIds.length > 0
        ? await pb.collection("case_documents").getFullList({
            filter: docIds.map((id) => `document="${id}"`).join(" || "),
            expand: "case",
          })
        : [];

      // Build map docId → cases {id, name}
      const casesByDoc: Record<string, { id: string; name: string }[]> = {};
      for (const cd of caseDocs) {
        const caseName: string = cd.expand?.case?.name || "—";
        (casesByDoc[cd.document] ??= []).push({ id: cd.case as string, name: caseName });
      }

      // Build map docId → memo count
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

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!confirmDelete || !pb) return;
    setDeleteLoading(true);
    try {
      // Remove case_document links first
      const links = await pb.collection("case_documents").getFullList({
        filter: `document="${confirmDelete.id}"`,
        fields: "id",
      });
      await Promise.all(links.map((l) => pb.collection("case_documents").delete(l.id)));
      await pb.collection("documents").delete(confirmDelete.id);
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
          <button className="btn btn--primary" onClick={() => setNewDocOpen(true)}>
            + New Document
          </button>
        )}
      </header>

      {error && <p className="users-error">{error}</p>}

      {/* Table */}
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
      {newDocOpen && pb && activeProject && (
        <NewDocumentModal
          projectId={activeProject.id}
          pb={pb}
          currentUserId={currentUser?.id ?? ""}
          onDone={() => { setNewDocOpen(false); loadDocuments(); }}
          onClose={() => setNewDocOpen(false)}
        />
      )}
    </div>
  );
}
