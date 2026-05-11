import { useState, useEffect, useCallback, useRef, useId } from "react";
import ExcelJS from "exceljs";
import { useStore } from "../context/StoreContext";
import { useAuth } from "../context/AuthContext";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import { MemoEditorView } from "./Analysis_Memos_View";
import { readAppSettings } from "../lib/appSettings";
import helpIcon from "../assets/ic_help_outline_24px.svg";
import {
  ProcessedTranscriptView,
  getProcessedTranscriptQuestionOutline,
  parseProcessedTranscriptSegments,
} from "../components/ProcessedTranscriptView";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

// ─── Types ────────────────────────────────────────────────────────────────────

interface DocRow {
  id: string;
  name: string;
  type: string;
  notes: string;
  content: string;
  structuredContentJson: string;
  filePath: string;
  cases: { id: string; name: string }[];   // associated cases (used by detail view)
  memoCount: number;
  createdByName: string;
  createdAt: string;
}

type AttributeDataType = "text" | "number" | "datetime" | "categorical";

interface AttributeDefinition {
  id: string;
  name: string;
  dataType: AttributeDataType;
  description: string;
  options: string[];
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
  description: string;
  options: string[];
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

function maskedFileLabel(filePath: string): string {
  if (!filePath) return "—";
  return readAppSettings().privacy.maskFilePaths ? "Hidden by app settings" : filePath;
}

function inputTypeForDataType(dataType: AttributeDataType) {
  if (dataType === "number") return "number";
  if (dataType === "datetime") return "datetime-local";
  return "text";
}

function normalizeAttributeOptions(options: string[]): string[] {
  return options.map((option) => option.trim()).filter(Boolean);
}

function parseAttributeOptions(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? normalizeAttributeOptions(parsed.filter((item): item is string => typeof item === "string")) : [];
  } catch {
    return [];
  }
}

const ATTRIBUTE_TYPE_OPTIONS: { value: AttributeDataType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Numbers" },
  { value: "datetime", label: "Date/time" },
  { value: "categorical", label: "Categorical" },
];

const AI_ASSIST_ADD_ATTRIBUTE_TARGET_KEY = "kq_ai_assist_add_attribute_target";

// ─── Column definitions ───────────────────────────────────────────────────────

const COLS: { key: SortCol; label: string; width: string }[] = [
  { key: "cases",         label: "Cases",      width: "11%" },
  { key: "memos",         label: "Memos",      width: "10%" },
  { key: "createdByName", label: "Created By", width: "22%" },
  { key: "createdAt",     label: "Created",    width: "20%" },
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
  onChange,
  minRows,
}: {
  initialHtml: string;
  editorRef: React.RefObject<HTMLDivElement | null>;
  onChange?: () => void;
  minRows?: number;
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

  const contentStyle = minRows
    ? { height: `${minRows * 1.5}em`, overflowY: "auto" as const }
    : undefined;

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
        onInput={onChange}
        style={contentStyle}
      />
    </div>
  );
}

// ─── EditMetadataModal ───────────────────────────────────────────────────────

function EditMetadataModal({
  row,
  onSave,
  onClose,
}: {
  row: DocRow;
  onSave: (name: string, notes: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name,   setName]   = useState(row.name);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);
  const notesRef = useRef<HTMLDivElement | null>(null);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(name.trim(), notesRef.current?.innerHTML ?? row.notes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div
        className="modal doc-upload-modal doc-upload-modal--text-entry"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Edit Metadata</h2>
        <div className="form">
          <label className="form-label">
            Document Title
            <input
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </label>
          <label className="form-label">Description</label>
          <RichTextEditor
            initialHtml={ensureHtml(row.notes)}
            editorRef={notesRef}
            minRows={10}
          />
          {error && <p className="auth-error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void handleSave()}
              disabled={saving || !name.trim()}
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Document Detail sub-view ─────────────────────────────────────────────────

function DocumentDetail({
  row: initialRow,
  pb,
  startEditing,
  canEditMetadata,
  canEditContent,
  canDelete,
  canAssociateCases,
  canMemoAbout,
  canCreateEditableCopy,
  onBack,
  onMemoAbout,
  onRequestDelete,
}: {
  row: DocRow;
  pb: NonNullable<ReturnType<typeof useStore>["pb"]>;
  startEditing: boolean;
  canEditMetadata: boolean;
  canEditContent: boolean;
  canDelete: boolean;
  canAssociateCases: boolean;
  canMemoAbout: boolean;
  canCreateEditableCopy: boolean;
  onBack: () => void;
  onMemoAbout: () => void;
  onRequestDelete: (row: DocRow) => void;
}) {
  const { setView, setPendingCaseId, setPendingMemoId, activeProject, updateDocument, logAction } = useStore();
  const [row,            setRow]            = useState(initialRow);
  const [showEditMetadataModal, setShowEditMetadataModal] = useState(startEditing && canEditMetadata);
  const [showEditWarning, setShowEditWarning] = useState(false);
  const [docMemos,       setDocMemos]       = useState<{ id: string; title: string }[]>([]);
  const [showAssocCases, setShowAssocCases] = useState(false);
  const [showEditableCopyModal, setShowEditableCopyModal] = useState(false);
  const [showRawEditModal, setShowRawEditModal] = useState(startEditing && !canEditMetadata && canEditContent);
  const [annotationCount, setAnnotationCount] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [selectedOutlineSortOrder, setSelectedOutlineSortOrder] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const transcriptViewerRef = useRef<HTMLDivElement | null>(null);


  useEffect(() => {
    pb.collection("memos")
      .getFullList({ filter: `document ~ "${row.id}"&&deleted_at=""`, fields: "id,title", sort: "-created" })
      .then((records) => setDocMemos(records.map((r) => ({ id: r.id, title: r.title as string }))))
      .catch(console.error);
  }, [pb, row.id]);

  useEffect(() => {
    pb.collection("annotations")
      .getFullList({ filter: `document="${row.id}"&&deleted_at=""`, fields: "id" })
      .then((records) => setAnnotationCount(records.length))
      .catch(() => setAnnotationCount(0));
  }, [pb, row.id]);

  useEffect(() => {
    setRow(initialRow);
  }, [initialRow]);

  useEffect(() => {
    if (!menuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

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
  const hasAnnotations = (annotationCount ?? 0) > 0;
  const processedTranscriptSegments =
    row.type === "Processed Transcript"
      ? parseProcessedTranscriptSegments(row.structuredContentJson)
      : [];
  const questionOutline = getProcessedTranscriptQuestionOutline(processedTranscriptSegments);

  useEffect(() => {
    if (selectedOutlineSortOrder == null || !transcriptViewerRef.current) return;
    const target = transcriptViewerRef.current.querySelector<HTMLElement>(
      `[data-transcript-sort-order="${selectedOutlineSortOrder}"]`,
    );
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [selectedOutlineSortOrder]);

  async function handleEditableCopyCreated(newDocumentId: string) {
    const [caseDocs, attributeValues] = await Promise.all([
      pb.collection("case_documents").getFullList({
        filter: `document="${row.id}"`,
        fields: "id,case,document",
      }),
      pb.collection("document_attribute_values").getFullList({
        filter: `document="${row.id}"&&deleted_at=""`,
        fields: "id,attribute,value",
      }),
    ]);

    await Promise.all([
      ...caseDocs.map((record) =>
        pb.collection("case_documents").create({
          case: record.case,
          document: newDocumentId,
        })
      ),
      ...attributeValues.map((record) =>
        pb.collection("document_attribute_values").create({
          document: newDocumentId,
          attribute: record.attribute,
          value: record.value ?? "",
          deleted_at: "",
        })
      ),
    ]);

    if (row.notes) {
      await pb.collection("documents").update(newDocumentId, { notes: row.notes });
    }

    if (activeProject) {
      await logAction(
        activeProject.id,
        "document.create",
        `Created editable copy of "${row.name}"`,
        newDocumentId,
      );
    }
  }

  async function handleSaveMetadata(newName: string, newNotes: string) {
    await updateDocument(row.id, { name: newName, notes: newNotes });
    setRow({ ...row, name: newName, notes: newNotes });
    setShowEditMetadataModal(false);
  }

  function handleRequestEditableCopy() {
    if (!canCreateEditableCopy && !canEditContent) return;
    if (hasAnnotations) {
      if (!canCreateEditableCopy) return;
      setShowEditWarning(true);
      return;
    }
    if (canEditContent) {
      setShowRawEditModal(true);
      return;
    }
    if (canCreateEditableCopy) {
      setShowEditableCopyModal(true);
    }
  }

  return (
    <div className="view doc-detail-view">
      {/* Top bar */}
      <div className="case-detail-topbar">
        <button className="btn" onClick={onBack}>← Back to Documents</button>
        <div className="user-detail-menu-wrap" ref={menuRef}>
          <button
            type="button"
            className="home-menu-btn user-detail-menu-btn"
            aria-label="Document actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span />
            <span />
            <span />
          </button>
          {menuOpen && (
            <div className="context-menu user-detail-menu" role="menu">
              {canEditMetadata ? (
                <button
                  type="button"
                  className="context-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setShowEditMetadataModal(true);
                  }}
                >
                  Edit Metadata
                </button>
              ) : (
                <div className="context-menu-item context-menu-item--disabled" title="You do not have permission to edit document metadata">
                  Edit Metadata
                </div>
              )}
              {canDelete ? (
                <button
                  type="button"
                  className="context-menu-item context-menu-item--danger"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onRequestDelete(row);
                  }}
                >
                  Delete Document
                </button>
              ) : (
                <div className="context-menu-item context-menu-item--disabled" title="You do not have permission to delete documents">
                  Delete Document
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="doc-detail-layout">

        {/* Left column — metadata & cards (1/3) */}
        <div className="doc-detail-left">

          {/* Name card */}
          <div className="case-card">
            <h3 className="case-card-title">Document</h3>
            <p className="case-card-value">{row.name}</p>
          </div>

          {/* Meta */}
          <dl className="user-detail-meta case-detail-meta">
            <dt>Created By</dt> <dd>{row.createdByName}</dd>
            <dt>Created</dt>    <dd>{fmtDate(row.createdAt)}</dd>
            <dt>File Name</dt>  <dd>{maskedFileLabel(row.filePath)}</dd>
            <dt>Extension</dt>  <dd>{fileExt ? `.${fileExt}` : "—"}</dd>
          </dl>

          {/* Description card — above cases */}
          <div className="case-card">
            <h3 className="case-card-title">Description</h3>
            {row.notes ? (
              <div className="case-notes-body" dangerouslySetInnerHTML={{ __html: row.notes }} />
            ) : (
              <p className="case-card-empty">No description yet.</p>
            )}
          </div>

          {/* Cases card */}
          <div className="case-card">
            <div className="case-card-header">
              <h3 className="case-card-title">Cases</h3>
              <button
                className="btn btn--sm"
                onClick={() => setShowAssocCases(true)}
                disabled={!canAssociateCases}
                title={!canAssociateCases ? "You do not have permission to associate documents with cases" : undefined}
              >
                Associate Cases
              </button>
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
              <button
                className="btn btn--sm"
                onClick={onMemoAbout}
                disabled={!canMemoAbout}
                title={!canMemoAbout ? "You do not have permission to create a memo about this document" : undefined}
              >
                Memo About
              </button>
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

        </div>

        {/* Right column — document content (2/3) */}
        <div className="doc-detail-right">
          <div className="case-card doc-content-card">
            <div className="case-card-header">
              <div className="doc-content-header-title">
                <div className="processed-transcript-title-row">
                  <h3 className="case-card-title">Contents</h3>
                  {questionOutline.length > 0 && (
                    <div className="processed-transcript-outline-wrap">
                      <button
                        type="button"
                        className="processed-transcript-outline-btn"
                        aria-label="Show transcript outline"
                        aria-expanded={outlineOpen}
                        onClick={() => setOutlineOpen((open) => !open)}
                      >
                        ≡
                      </button>
                      {outlineOpen && (
                        <div className="processed-transcript-outline-menu">
                          {questionOutline.map((item, index) => (
                            <button
                              key={`${item.sortOrder}-${index}`}
                              type="button"
                              className="processed-transcript-outline-item"
                              onClick={() => {
                                setSelectedOutlineSortOrder(item.sortOrder);
                                setOutlineOpen(false);
                              }}
                              title={item.label}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="doc-toolbar-actions">
                {((hasAnnotations && canCreateEditableCopy) || (!hasAnnotations && (canEditContent || canCreateEditableCopy))) && (
                  <button className="btn btn--sm btn--primary" onClick={handleRequestEditableCopy}>
                    {hasAnnotations || !canEditContent ? "Create Editable Copy" : "Edit"}
                  </button>
                )}
              </div>
            </div>
            {row.content ? (
              row.type === "Processed Transcript" && processedTranscriptSegments.length > 0 ? (
                <div
                  ref={transcriptViewerRef}
                  className="doc-content-body doc-content-body--structured"
                >
                  <ProcessedTranscriptView
                    segments={processedTranscriptSegments}
                    renderSegmentText={(segment) => segment.text}
                    selectedSortOrder={selectedOutlineSortOrder}
                  />
                </div>
              ) : (
                <pre className="doc-content-body">{row.content}</pre>
              )
            ) : (
              <p className="case-card-empty">No content extracted.</p>
            )}
          </div>
        </div>

      </div>

      {showEditMetadataModal && canEditMetadata && (
        <EditMetadataModal
          row={row}
          onSave={handleSaveMetadata}
          onClose={() => setShowEditMetadataModal(false)}
        />
      )}

      {showRawEditModal && canEditContent && (
        <EditDocumentContentModal
          documentName={row.name}
          initialContent={row.content}
          onClose={() => setShowRawEditModal(false)}
          onSave={async (content) => {
            await updateDocument(row.id, { content });
            setRow((prev) => ({ ...prev, content }));
            setShowRawEditModal(false);
          }}
        />
      )}

            {/* Edit warning modal */}
      {showEditWarning && (
        <div className="modal-overlay" onClick={() => setShowEditWarning(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create Editable Copy</h2>
            <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
              The editable copy will not keep this document's annotations.
            </p>
            <p className="modal-warning-text">
              {annotationCount && annotationCount > 0
                ? `This document currently has ${annotationCount} annotation${annotationCount === 1 ? "" : "s"}. If you create an editable copy, those annotations will not be carried over to the new document.`
                : "The current document will remain unchanged. Cases, document attributes, and notes will be copied to the new editable document."}
            </p>
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button className="btn" onClick={() => setShowEditWarning(false)}>
                Cancel
              </button>
              <button
                className="btn btn--primary"
                onClick={() => {
                  setShowEditWarning(false);
                  setShowEditableCopyModal(true);
                }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Associate Cases modal (opened from within detail) */}
      {showAssocCases && activeProject && canAssociateCases && (
        <AssociateCasesModal
          docRow={row}
          pb={pb}
          projectId={activeProject.id}
          onLog={(action, label, recordId) => logAction(activeProject.id, action, label, recordId)}
          onDone={() => { setShowAssocCases(false); refreshCases(); }}
          onClose={() => setShowAssocCases(false)}
        />
      )}

      {showEditableCopyModal && canCreateEditableCopy && (
        <NewDocumentModal
          initialName={`${row.name} (Editable Copy)`}
          initialMode="paste"
          initialPasted={row.content}
          allowedModes={["paste"]}
          onCreated={handleEditableCopyCreated}
          onDone={() => {
            setShowEditableCopyModal(false);
            onBack();
          }}
          onClose={() => setShowEditableCopyModal(false)}
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
  onLog,
  onDone,
  onClose,
}: {
  docRow: DocRow;
  pb: NonNullable<ReturnType<typeof useStore>["pb"]>;
  projectId: string;
  onLog: (action: string, label: string, recordId?: string) => Promise<void> | void;
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
      if (toAdd.length > 0 || toRemove.length > 0) {
        await onLog(
          "document.associations",
          `Updated case associations for document "${docRow.name}" (+${toAdd.length} / -${toRemove.length})`,
          docRow.id,
        );
      }
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

type InputMode = "upload" | "paste" | "batch" | "csv";
type CsvColumnRole = "ignore" | "name" | "description" | "content" | "attribute";

interface CsvColumnMapping {
  header: string;
  role: CsvColumnRole;
  attributeName: string;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }

    value += ch;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  return rows
    .map((cells) => cells.map((cell) => cell.trim()))
    .filter((cells) => cells.some((cell) => cell.length > 0));
}

function suggestCsvRole(header: string): CsvColumnRole {
  const normalized = header.trim().toLowerCase();
  if (/(^|[_\s-])(name|title)([_\s-]|$)/.test(normalized)) return "name";
  if (/(description|notes|summary)/.test(normalized)) return "description";
  if (/(content|text|body|transcript)/.test(normalized)) return "content";
  return "attribute";
}

async function parseSpreadsheetFile(file: File): Promise<string[][]> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "csv") {
    return parseCsv(await file.text());
  }
  if (ext !== "xlsx") {
    throw new Error(`Unsupported spreadsheet type ".${ext}".`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("Spreadsheet does not contain any worksheets.");
  }

  const rows: string[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const cells = row.values;
    const normalized = Array.isArray(cells)
      ? cells.slice(1).map((cell) => (cell == null ? "" : String(cell).trim()))
      : [];
    if (normalized.some((cell) => cell.length > 0)) {
      rows.push(normalized);
    }
  });

  return rows;
}

// If text already contains structural HTML tags, use it as-is;
// otherwise escape entities and convert newlines to <br> so the
// RichTextEditor displays plain-text content correctly.
function ensureHtml(text: string): string {
  if (/<(p|div|br|ul|ol|li|strong|em|b|i|h[1-6])[^>]*>/i.test(text)) return text;
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

function EditDocumentContentModal({
  documentName,
  initialContent,
  onSave,
  onClose,
}: {
  documentName: string;
  initialContent: string;
  onSave: (content: string) => Promise<void>;
  onClose: () => void;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave(editorRef.current?.innerHTML ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save document.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="modal doc-upload-modal doc-upload-modal--text-entry" onClick={(e) => e.stopPropagation()}>
        <h2>Edit Document</h2>
        <p className="settings-section-desc" style={{ marginBottom: 16 }}>{documentName}</p>
        <form className="form" onSubmit={handleSubmit}>
          <RichTextEditor
            initialHtml={ensureHtml(initialContent)}
            editorRef={editorRef}
            minRows={16}
          />

          {error && <p className="auth-error">{error}</p>}

          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function NewDocumentModal({
  initialName = "",
  initialMode,
  initialPasted = "",
  allowedModes = ["upload", "paste", "batch", "csv"],
  attributeDefs = [],
  onCreated,
  onDone,
  onClose,
}: {
  initialName?: string;
  initialMode?: InputMode;
  initialPasted?: string;
  allowedModes?: InputMode[];
  attributeDefs?: AttributeDefinition[];
  onCreated?: (documentId: string) => Promise<void> | void;
  onDone: () => void;
  onClose: () => void;
}) {
  const { addDocument, pb, activeProject } = useStore();
  const { user: currentUser } = useAuth();
  const importSettings = readAppSettings().documentImport;
  const [name,      setName]      = useState(initialName);
  const [mode,      setMode]      = useState<InputMode>(
    initialMode && allowedModes.includes(initialMode)
      ? initialMode
      : allowedModes[0] ?? "upload",
  );
  const [file,      setFile]      = useState<File | null>(null);
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvMappings, setCsvMappings] = useState<CsvColumnMapping[]>([]);
  const [csvPreviewRows, setCsvPreviewRows] = useState<string[][]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [extracted, setExtracted] = useState("");
  const [extracting,setExtracting]= useState(false);
  const [extractErr,setExtractErr]= useState<string | null>(null);
  const [pasteHasContent, setPasteHasContent] = useState(initialPasted.length > 0);
  const pastedRef = useRef<HTMLDivElement | null>(null);
  const [dragging,  setDragging]  = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const batchInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!allowedModes.includes(mode)) {
      setMode(allowedModes[0] ?? "upload");
      resetUploadState();
    }
  }, [allowedModes, mode]);

  function resetUploadState() {
    setFile(null);
    setBatchFiles([]);
    setCsvFile(null);
    setCsvMappings([]);
    setCsvPreviewRows([]);
    setCsvRows([]);
    setExtracted("");
    setExtractErr(null);
    setExtracting(false);
  }

  function setModeAndReset(nextMode: InputMode) {
    setMode(nextMode);
    resetUploadState();
    if (nextMode !== "upload" && nextMode !== "paste") {
      setName(initialName);
    }
  }

  async function processFile(f: File) {
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ACCEPTED_EXTS.has(ext)) {
      setExtractErr(`Unsupported file type ".${ext}".`);
      return;
    }
    setFile(f);
    if (importSettings.autoNameFromFile && !name.trim()) {
      setName(f.name.replace(/\.[^/.]+$/, ""));
    }
    setExtracting(true);
    setExtractErr(null);
    try {
      const nextExtracted = await extractTextFromFile(f);
      setExtracted(importSettings.trimImportedText ? nextExtracted.trim() : nextExtracted);
    } catch {
      setExtractErr("Could not read file contents.");
      setExtracted("");
    } finally {
      setExtracting(false);
    }
  }

  async function processBatchFiles(nextFiles: File[]) {
    const uniqueFiles = nextFiles.filter((candidate, index) =>
      nextFiles.findIndex((item) => item.name === candidate.name && item.size === candidate.size) === index,
    );
    const invalidFiles = uniqueFiles.filter((candidate) => {
      const ext = candidate.name.split(".").pop()?.toLowerCase() ?? "";
      return !ACCEPTED_EXTS.has(ext);
    });
    if (invalidFiles.length > 0) {
      setExtractErr(`Unsupported file types: ${invalidFiles.map((candidate) => candidate.name).join(", ")}`);
      return;
    }
    setBatchFiles(uniqueFiles);
    setExtractErr(null);
  }

  async function processSpreadsheetFile(nextFile: File) {
    setCsvFile(nextFile);
    setExtractErr(null);
    try {
      const parsed = await parseSpreadsheetFile(nextFile);
      if (parsed.length < 2) {
        throw new Error("Spreadsheet must include a header row and at least one data row.");
      }
      const headers = parsed[0];
      const bodyRows = parsed.slice(1).map((cells) =>
        Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])),
      );
      setCsvRows(bodyRows);
      setCsvPreviewRows(parsed.slice(0, 4));
      setCsvMappings(headers.map((header) => ({
        header,
        role: suggestCsvRole(header),
        attributeName: header,
      })));
    } catch (err) {
      setCsvRows([]);
      setCsvPreviewRows([]);
      setCsvMappings([]);
      setExtractErr(err instanceof Error ? err.message : "Could not parse spreadsheet file.");
    }
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) void processFile(f);
    e.target.value = "";
  }

  function onBatchInput(e: React.ChangeEvent<HTMLInputElement>) {
    const nextFiles = Array.from(e.target.files ?? []);
    if (nextFiles.length > 0) void processBatchFiles(nextFiles);
    e.target.value = "";
  }

  function onCsvInput(e: React.ChangeEvent<HTMLInputElement>) {
    const nextFile = e.target.files?.[0];
    if (nextFile) void processSpreadsheetFile(nextFile);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void processFile(f);
  }

  function onBatchDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const nextFiles = Array.from(e.dataTransfer.files ?? []);
    if (nextFiles.length > 0) void processBatchFiles(nextFiles);
  }

  function onCsvDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const nextFile = e.dataTransfer.files?.[0];
    if (nextFile) void processSpreadsheetFile(nextFile);
  }

  function updateCsvMapping(index: number, patch: Partial<CsvColumnMapping>) {
    setCsvMappings((prev) => {
      const next = prev.map((mapping, mappingIndex) =>
        mappingIndex === index ? { ...mapping, ...patch } : mapping,
      );
      const role = patch.role;
      if (role === "name" || role === "description" || role === "content") {
        return next.map((mapping, mappingIndex) =>
          mappingIndex !== index && mapping.role === role
            ? { ...mapping, role: "ignore" }
            : mapping,
        );
      }
      return next;
    });
  }

  async function ensureCsvAttributeDefinitions() {
    if (!activeProject) return new Map<string, string>();

    const definitionsByName = new Map(
      attributeDefs.map((definition) => [definition.name.trim().toLowerCase(), definition.id]),
    );
    const attributeMappings = csvMappings.filter((mapping) =>
      mapping.role === "attribute" && mapping.attributeName.trim(),
    );

    for (const mapping of attributeMappings) {
      const normalized = mapping.attributeName.trim().toLowerCase();
      if (definitionsByName.has(normalized)) continue;
      const created = await pb.collection("document_attribute_definitions").create({
        project: activeProject.id,
        name: mapping.attributeName.trim(),
        data_type: "text",
        description: "",
        options_json: JSON.stringify([]),
        sort_order: attributeDefs.length + definitionsByName.size,
        deleted_at: "",
      });
      definitionsByName.set(normalized, created.id);
    }

    return definitionsByName;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if ((mode === "upload" || mode === "paste") && !name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      if (mode === "upload" || mode === "paste") {
        const rawContent = mode === "upload" ? extracted : (pastedRef.current?.innerHTML ?? "");
        const content = importSettings.trimImportedText ? rawContent.trim() : rawContent;
        const file_path = importSettings.storeOriginalFileName && file ? file.name : "";
        if (
          mode === "upload" &&
          importSettings.warnBeforeEmptyImport &&
          !content.trim() &&
          !window.confirm("No text was extracted from this file. Create the document anyway?")
        ) {
          setLoading(false);
          return;
        }
        const document = await addDocument(name.trim(), file_path, content, currentUser?.id);
        if (document?.id && onCreated) {
          await onCreated(document.id);
        }
        onDone();
        return;
      }

      if (mode === "batch") {
        const failures: string[] = [];
        let createdCount = 0;
        for (const currentFile of batchFiles) {
          try {
            const rawContent = await extractTextFromFile(currentFile);
            const content = importSettings.trimImportedText ? rawContent.trim() : rawContent;
            if (
              importSettings.warnBeforeEmptyImport &&
              !content.trim() &&
              !window.confirm(`No text was extracted from ${currentFile.name}. Create the document anyway?`)
            ) {
              failures.push(`${currentFile.name}: skipped because no text was extracted`);
              continue;
            }
            await addDocument(
              currentFile.name.replace(/\.[^/.]+$/, ""),
              importSettings.storeOriginalFileName ? currentFile.name : "",
              content,
              currentUser?.id,
              { notes: "", setActive: false },
            );
            createdCount += 1;
          } catch (err) {
            failures.push(`${currentFile.name}: ${err instanceof Error ? err.message : "failed"}`);
          }
        }

        if (createdCount === 0) {
          throw new Error(failures[0] ?? "No documents were created.");
        }
        if (failures.length > 0) {
          window.alert(`Created ${createdCount} documents.\n\nSome files were skipped:\n${failures.join("\n")}`);
        }
        onDone();
        return;
      }

      const contentMapping = csvMappings.find((mapping) => mapping.role === "content");
      if (!contentMapping) {
        throw new Error('Choose one CSV column for "Text Contents".');
      }
      const nameHeader = csvMappings.find((mapping) => mapping.role === "name")?.header;
      const descriptionHeader = csvMappings.find((mapping) => mapping.role === "description")?.header;
      const definitionsByName = await ensureCsvAttributeDefinitions();

      let createdCount = 0;
      for (let index = 0; index < csvRows.length; index += 1) {
        const row = csvRows[index];
        const document = await addDocument(
          (nameHeader ? row[nameHeader] : "").trim() || `Document ${index + 1}`,
          importSettings.storeOriginalFileName && csvFile ? csvFile.name : "",
          importSettings.trimImportedText ? (row[contentMapping.header] ?? "").trim() : (row[contentMapping.header] ?? ""),
          currentUser?.id,
          {
            notes: (descriptionHeader ? row[descriptionHeader] : "").trim(),
            setActive: false,
          },
        );
        if (!document?.id) continue;
        createdCount += 1;

        for (const mapping of csvMappings) {
          if (mapping.role !== "attribute" || !mapping.attributeName.trim()) continue;
          const value = row[mapping.header] ?? "";
          if (!value.trim()) continue;
          const attributeId = definitionsByName.get(mapping.attributeName.trim().toLowerCase());
          if (!attributeId) continue;
          await pb.collection("document_attribute_values").create({
            document: document.id,
            attribute: attributeId,
            value,
            deleted_at: "",
          });
        }
      }

      if (createdCount === 0) {
        throw new Error("No documents were created from the CSV file.");
      }
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

  const canSubmit =
    mode === "paste"
      ? name.trim().length > 0 && pasteHasContent
      : mode === "upload"
        ? name.trim().length > 0 && !!file
        : mode === "batch"
          ? batchFiles.length > 0
          : !!csvFile && csvRows.length > 0 && csvMappings.some((mapping) => mapping.role === "content");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal doc-upload-modal${mode === "paste" ? " doc-upload-modal--text-entry" : mode === "csv" ? " modal--wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="doc-upload-modal-title-row">
          <h2>New Document</h2>
          {!initialMode && (
            <div className="doc-mode-toggle">
              {allowedModes.includes("upload") && (
                <button
                  type="button"
                  className={`doc-mode-toggle-btn${mode === "upload" ? " doc-mode-toggle-btn--active" : ""}`}
                  onClick={() => setModeAndReset("upload")}
                >
                  Upload
                </button>
              )}
              {allowedModes.includes("paste") && (
                <button
                  type="button"
                  className={`doc-mode-toggle-btn${mode === "paste" ? " doc-mode-toggle-btn--active" : ""}`}
                  onClick={() => setModeAndReset("paste")}
                >
                  Text Entry
                </button>
              )}
              {allowedModes.includes("batch") && (
                <button
                  type="button"
                  className={`doc-mode-toggle-btn${mode === "batch" ? " doc-mode-toggle-btn--active" : ""}`}
                  onClick={() => setModeAndReset("batch")}
                >
                  Batch Upload
                </button>
              )}
              {allowedModes.includes("csv") && (
                <button
                  type="button"
                  className={`doc-mode-toggle-btn${mode === "csv" ? " doc-mode-toggle-btn--active" : ""}`}
                  onClick={() => setModeAndReset("csv")}
                >
                  Spreadsheet
                </button>
              )}
            </div>
          )}
        </div>
        <form className="form" onSubmit={handleSubmit}>

          {(mode === "upload" || mode === "paste") && (
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
          )}

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
          ) : mode === "paste" ? (
            <RichTextEditor
              initialHtml={initialPasted ? ensureHtml(initialPasted) : ""}
              editorRef={pastedRef}
              minRows={14}
              onChange={() => setPasteHasContent(!!(pastedRef.current?.textContent?.trim()))}
            />
          ) : mode === "batch" ? (
            <>
              <input
                ref={batchInputRef}
                type="file"
                accept={ACCEPTED_TYPES}
                multiple
                style={{ display: "none" }}
                onChange={onBatchInput}
              />
              <div
                className={`doc-dropzone${dragging ? " doc-dropzone--drag" : ""}${batchFiles.length > 0 ? " doc-dropzone--filled" : ""}`}
                onClick={() => batchInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onBatchDrop}
              >
                {batchFiles.length === 0 ? (
                  <>
                    <span className="doc-dropzone-icon">↑</span>
                    <span className="doc-dropzone-primary">Click to browse or drag &amp; drop multiple files</span>
                    <span className="doc-dropzone-hint">Each file becomes a new document named from its filename.</span>
                  </>
                ) : (
                  <>
                    <span className="doc-dropzone-primary">{batchFiles.length} files selected</span>
                    <span className="doc-dropzone-hint">
                      {batchFiles.slice(0, 5).map((currentFile) => currentFile.name).join(", ")}
                      {batchFiles.length > 5 ? ` and ${batchFiles.length - 5} more` : ""}
                    </span>
                    <button
                      type="button"
                      className="doc-dropzone-change"
                      onClick={(e) => {
                        e.stopPropagation();
                        setBatchFiles([]);
                        batchInputRef.current?.click();
                      }}
                    >
                      Change files
                    </button>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                style={{ display: "none" }}
                onChange={onCsvInput}
              />
              <div
                className={`doc-dropzone${dragging ? " doc-dropzone--drag" : ""}${csvFile ? " doc-dropzone--filled" : ""}`}
                onClick={() => csvInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onCsvDrop}
              >
                {!csvFile ? (
                  <>
                    <span className="doc-dropzone-icon">↑</span>
                    <span className="doc-dropzone-primary">Upload a spreadsheet</span>
                    <span className="doc-dropzone-hint">CSV or XLSX supported. For XLSX files, sheet 1 is used.</span>
                  </>
                ) : (
                  <>
                    <span className="doc-dropzone-filename">{csvFile.name}</span>
                    <span className="doc-dropzone-hint">{csvRows.length.toLocaleString()} rows ready for mapping</span>
                    <button
                      type="button"
                      className="doc-dropzone-change"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCsvFile(null);
                        setCsvRows([]);
                        setCsvMappings([]);
                        setCsvPreviewRows([]);
                        csvInputRef.current?.click();
                      }}
                    >
                      Change file
                    </button>
                  </>
                )}
              </div>
              {csvMappings.length > 0 && (
                <div className="attribute-values-details" style={{ marginTop: 16 }}>
                  <h3 className="case-card-title">Column Mapping</h3>
                  {csvMappings.map((mapping, index) => (
                    <div key={mapping.header} className="attribute-value-row" style={{ alignItems: "center" }}>
                      <span>{mapping.header}</span>
                      <select
                        className="form-input"
                        value={mapping.role}
                        onChange={(e) => updateCsvMapping(index, { role: e.target.value as CsvColumnRole })}
                      >
                        <option value="ignore">Ignore</option>
                        <option value="name">Document Name</option>
                        <option value="description">Document Description</option>
                        <option value="content">Text Contents</option>
                        <option value="attribute">Document Attribute</option>
                      </select>
                      {mapping.role === "attribute" && (
                        <input
                          className="form-input"
                          value={mapping.attributeName}
                          onChange={(e) => updateCsvMapping(index, { attributeName: e.target.value })}
                          placeholder="Attribute name"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
              {csvPreviewRows.length > 0 && (
                <div className="assoc-doc-table-wrap" style={{ marginTop: 16 }}>
                  <table className="users-table">
                    <thead>
                      <tr>
                        {csvPreviewRows[0].map((cell, index) => (
                          <th key={`${cell}-${index}`} className="users-th">{cell || `Column ${index + 1}`}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {csvPreviewRows.slice(1).map((previewRow, rowIndex) => (
                        <tr key={rowIndex} className="users-row">
                          {csvPreviewRows[0].map((_, cellIndex) => (
                            <td key={cellIndex} className="users-td users-td--muted">{previewRow[cellIndex] ?? ""}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {error && <p className="auth-error">{error}</p>}

          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={loading || !canSubmit}>
              {loading ? "Creating…" : "Create Document"}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

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
  const [description, setDescription] = useState(draft.description);
  const [options, setOptions] = useState<string[]>(draft.options.length > 0 ? draft.options : ["", ""]);
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
              {ATTRIBUTE_TYPE_OPTIONS.map((option) => (
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
          <label className="form-group attribute-details-span">
            <span className="form-label">Description</span>
            <textarea
              className="form-input attribute-description-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
          </label>
          {dataType === "categorical" && (
            <div className="form-group attribute-details-span">
              <span className="form-label">Categories</span>
              <div className="attribute-category-list">
                {options.map((option, index) => (
                  <input
                    key={index}
                    className="form-input"
                    value={option}
                    onChange={(e) => setOptions((prev) => prev.map((item, itemIndex) => itemIndex === index ? e.target.value : item))}
                    placeholder={`Category ${index + 1}`}
                  />
                ))}
              </div>
              <button
                type="button"
                className="btn btn--small"
                onClick={() => setOptions((prev) => [...prev, ""])}
              >
                Add More
              </button>
            </div>
          )}
        </div>

        <div className="attribute-values-list">
          {rows.length === 0 ? (
            <p className="case-card-empty">No documents yet.</p>
          ) : (
            rows.map((row) => (
              <label key={row.id} className="attribute-value-row">
                <span>{row.name}</span>
                {dataType === "categorical" ? (
                  <select
                    className="form-input"
                    value={valuesByDocument[row.id] ?? ""}
                    onChange={(e) => setValuesByDocument((prev) => ({ ...prev, [row.id]: e.target.value }))}
                  >
                    <option value="">—</option>
                    {normalizeAttributeOptions(options).map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                    {(valuesByDocument[row.id] ?? "").trim() && !normalizeAttributeOptions(options).includes(valuesByDocument[row.id] ?? "") && (
                      <option value={valuesByDocument[row.id]}>{valuesByDocument[row.id]}</option>
                    )}
                  </select>
                ) : (
                  <input
                    className="form-input"
                    type={inputTypeForDataType(dataType)}
                    step={dataType === "number" ? "any" : undefined}
                    value={valuesByDocument[row.id] ?? ""}
                    onChange={(e) => setValuesByDocument((prev) => ({ ...prev, [row.id]: e.target.value }))}
                  />
                )}
              </label>
            ))
          )}
        </div>

        <div className="form-actions" style={{ marginTop: 20 }}>
          {onBack && <button className="btn" onClick={onBack} disabled={saving}>Back</button>}
          <button className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
          <button
            className="btn btn--primary"
            onClick={() => onSave({ ...draft, name: name.trim(), dataType, description: description.trim(), options: normalizeAttributeOptions(options) }, valuesByDocument)}
            disabled={saving || !name.trim() || (dataType === "categorical" && normalizeAttributeOptions(options).length < 2)}
          >
            {saving ? "Saving..." : "Save Attribute"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DocumentsView() {
  const {
    activeProject,
    pb,
    canCurrentUser,
    ensureProjectSafetyBackup,
    documents,
    activeDocument,
    setActiveDocument,
    documentLockConflict,
    clearDocumentLockConflict,
    pendingDocId,
    setPendingDocId,
    deleteDocument,
    logAction,
  } = useStore();
  const canCreateTypedDocuments = canCurrentUser("createDocument");
  const canUploadDocuments = canCurrentUser("uploadDocument");
  const canBatchUploadDocuments = canCurrentUser("batchUploadDocuments");
  const canImportSpreadsheetDocuments = canCurrentUser("importSpreadsheetDocuments");
  const canOpenDocumentCreateModal =
    canCreateTypedDocuments
    || canUploadDocuments
    || canBatchUploadDocuments
    || canImportSpreadsheetDocuments;
  const canEditDocumentMetadata = canCurrentUser("editDocumentMetadata");
  const canEditDocumentContent = canCurrentUser("editDocumentContent");
  const canDeleteDocuments = canCurrentUser("deleteDocument");
  const canAssociateCaseDocuments = canCurrentUser("associateDocumentsWithCases");
  const canCreateMemos = canCurrentUser("createMemo");
  const canAssociateMemoObjects = canCurrentUser("associateMemoObjects");
  const canMemoAboutDocuments = canCreateMemos && canAssociateMemoObjects;
  const canCreateDocumentAttributes = canCurrentUser("createDocumentAttributes");
  const canEditDocumentAttributes = canCurrentUser("editDocumentAttributes");
  const canDeleteDocumentAttributes = canCurrentUser("deleteDocumentAttributes");
  const canManageDocumentAttributes =
    canCreateDocumentAttributes
    || canEditDocumentAttributes
    || canDeleteDocumentAttributes;
  const allowedDocumentCreateModes: InputMode[] = [
    canUploadDocuments ? "upload" : null,
    canCreateTypedDocuments ? "paste" : null,
    canBatchUploadDocuments ? "batch" : null,
    canImportSpreadsheetDocuments ? "csv" : null,
  ].filter((mode): mode is InputMode => mode !== null);

  const [rows,    setRows]    = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const [sortCol, setSortCol] = useState<SortCol>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; row: DocRow;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuStyle = useViewportContextMenuStyle(contextMenu, contextMenuRef);

  const [confirmDelete, setConfirmDelete] = useState<DocRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [newDocOpen,    setNewDocOpen]    = useState(false);
  const [selectedRow,   setSelectedRow]   = useState<DocRow | null>(null);
  const [editStartRow,  setEditStartRow]  = useState<DocRow | null>(null);
  const [assocCaseDoc,  setAssocCaseDoc]  = useState<DocRow | null>(null);
  const [memoForDoc,    setMemoForDoc]    = useState<DocRow | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [showAttributesTable, setShowAttributesTable] = useState(false);
  const [attributeDefs, setAttributeDefs] = useState<AttributeDefinition[]>([]);
  const [attributeValues, setAttributeValues] = useState<Record<string, AttributeValue>>({});
  const [attributeSortCol, setAttributeSortCol] = useState<string>("name");
  const [attributeSortDir, setAttributeSortDir] = useState<SortDir>("asc");
  const [hoveredAttributeColumn, setHoveredAttributeColumn] = useState<string | null>(null);
  const [hoveredAttributeRow, setHoveredAttributeRow] = useState<string | null>(null);
  const [attributeValueDraft, setAttributeValueDraft] = useState<AttributeDraft | null>(null);
  const [attributeSaving, setAttributeSaving] = useState(false);
  const [attributeContextMenu, setAttributeContextMenu] = useState<{ x: number; y: number; attr: AttributeDefinition } | null>(null);
  const attributeContextMenuRef = useRef<HTMLDivElement>(null);
  const attributeContextMenuStyle = useViewportContextMenuStyle(attributeContextMenu, attributeContextMenuRef);

  useEffect(() => {
    if (!activeProject || !canManageDocumentAttributes) return;
    try {
      if (window.localStorage.getItem(AI_ASSIST_ADD_ATTRIBUTE_TARGET_KEY) !== "document") return;
      window.localStorage.removeItem(AI_ASSIST_ADD_ATTRIBUTE_TARGET_KEY);
      setShowAttributesTable(true);
      setAttributeValueDraft({
        name: "",
        dataType: "text",
        description: "",
        options: [],
      });
    } catch {
      // Best-effort handoff only.
    }
  }, [activeProject, canManageDocumentAttributes]);

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
        description: (r.description as string | undefined) ?? "",
        options: parseAttributeOptions(r.options_json),
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
            type:          (r.type as string | undefined) ?? "Text",
            notes:         r.notes ?? "",
            content:          r.content ?? "",
            structuredContentJson: r.structured_content_json ?? "",
            filePath:         r.file_path ?? "",
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

  const detailRow = selectedRow ?? editStartRow;
  const startEdit = editStartRow !== null;

  useEffect(() => {
    if (!detailRow || memoForDoc) {
      if (activeDocument) setActiveDocument(null);
      return;
    }
    const nextActiveDocument = documents.find((document) => document.id === detailRow.id) ?? null;
    if (nextActiveDocument && activeDocument?.id !== nextActiveDocument.id) {
      setActiveDocument(nextActiveDocument);
    }
  }, [detailRow, memoForDoc, documents, activeDocument, setActiveDocument]);

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

  const sortedAttributeRows = [...rows].sort((a, b) => {
    let cmp: number;

    if (attributeSortCol === "name") {
      cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    } else {
      const attr = attributeDefs.find((definition) => definition.id === attributeSortCol);
      const aValue = attributeValues[valueKey(a.id, attributeSortCol)]?.value ?? "";
      const bValue = attributeValues[valueKey(b.id, attributeSortCol)]?.value ?? "";

      if (attr?.dataType === "number") {
        const aNum = Number(aValue);
        const bNum = Number(bValue);
        const aMissing = aValue.trim() === "" || Number.isNaN(aNum);
        const bMissing = bValue.trim() === "" || Number.isNaN(bNum);
        if (aMissing && bMissing) cmp = 0;
        else if (aMissing) cmp = -1;
        else if (bMissing) cmp = 1;
        else cmp = aNum - bNum;
      } else if (attr?.dataType === "datetime") {
        const aTime = aValue ? new Date(aValue).getTime() : Number.NEGATIVE_INFINITY;
        const bTime = bValue ? new Date(bValue).getTime() : Number.NEGATIVE_INFINITY;
        cmp = aTime - bTime;
      } else {
        cmp = aValue.localeCompare(bValue, undefined, { sensitivity: "base" });
      }
    }

    return attributeSortDir === "asc" ? cmp : -cmp;
  });

  function handleAttributeSort(col: string) {
    if (col === attributeSortCol) setAttributeSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setAttributeSortCol(col);
      setAttributeSortDir("asc");
    }
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

  async function handleSaveAttribute(draft: AttributeDraft, valuesByDocument: Record<string, string>) {
    if (!activeProject || !pb || !draft.name.trim()) return;
    if (draft.id ? !canEditDocumentAttributes : !canCreateDocumentAttributes) return;
    setAttributeSaving(true);
    setError(null);
    try {
      const record = draft.id
        ? await pb.collection("document_attribute_definitions").update(draft.id, {
            name: draft.name.trim(),
            data_type: draft.dataType,
            description: draft.description,
            options_json: JSON.stringify(draft.options),
            deleted_at: "",
          })
        : await pb.collection("document_attribute_definitions").create({
            project: activeProject.id,
            name: draft.name.trim(),
            data_type: draft.dataType,
            description: draft.description,
            options_json: JSON.stringify(draft.options),
            sort_order: attributeDefs.length,
            deleted_at: "",
          });

      const attrId = record.id;
      const nextDef: AttributeDefinition = {
        id: attrId,
        name: record.name as string,
        dataType: record.data_type as AttributeDataType,
        description: (record.description as string | undefined) ?? "",
        options: parseAttributeOptions(record.options_json),
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
    if (!canDeleteDocumentAttributes) return;
    setAttributeSaving(true);
    setError(null);
    try {
      await ensureProjectSafetyBackup(
        "document_attribute.delete",
        `Deleted document attribute "${attr.name}"`,
      );
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

  if (detailRow && pb) {
    return (
      <>
      <DocumentDetail
        row={detailRow}
        pb={pb}
        startEditing={startEdit}
        canEditMetadata={canEditDocumentMetadata}
        canEditContent={canEditDocumentContent}
        canDelete={canDeleteDocuments}
        canAssociateCases={canAssociateCaseDocuments}
        canMemoAbout={canMemoAboutDocuments}
        canCreateEditableCopy={canCreateTypedDocuments}
        onBack={() => { setSelectedRow(null); setEditStartRow(null); loadDocuments(); }}
        onMemoAbout={() => setMemoForDoc(detailRow)}
        onRequestDelete={(row) => setConfirmDelete(row)}
      />
        {documentLockConflict && (
          <div className="modal-overlay" onClick={() => {}}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h2>{documentLockConflict.reason === "kicked" ? "Removed From Document" : "Document Locked"}</h2>
              {documentLockConflict.reason === "kicked" ? (
                <>
                  <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                    <strong>{documentLockConflict.userName || "A project owner"}</strong> removed you from this document.
                  </p>
                  <p className="modal-warning-text">
                    Kanqual is using a strict document lock across document detail and coding workspaces, so you will need to return to the documents list before reopening it.
                  </p>
                </>
              ) : (
                <>
                  <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                    <strong>{documentLockConflict.userName || "Another user"}</strong> is currently viewing or annotating this document.
                  </p>
                  <p className="modal-warning-text">
                    Kanqual is using a strict document lock across document detail and coding workspaces, so only one user can open a document at a time.
                  </p>
                </>
              )}
              <div className="form-actions" style={{ marginTop: 24 }}>
                <button
                  className="btn btn--primary"
                  onClick={() => {
                    clearDocumentLockConflict();
                    setSelectedRow(null);
                    setEditStartRow(null);
                  }}
                >
                  Back to Documents
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="view users-view">
      {/* Header */}
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>Documents</h1>
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
        <div className="view-header-actions">
          <button
            type="button"
            className="btn"
            onClick={() => setShowAttributesTable((show) => !show)}
          >
            {showAttributesTable ? "Show Documents" : "Show Attributes"}
          </button>
          <button
            className="btn btn--primary"
            onClick={
              showAttributesTable
                ? () =>
                    setAttributeValueDraft({
                      name: "",
                      dataType: "text",
                      description: "",
                      options: [],
                    })
                : () => setNewDocOpen(true)
            }
            disabled={showAttributesTable ? !canCreateDocumentAttributes : !canOpenDocumentCreateModal}
            title={
              showAttributesTable
                ? !canCreateDocumentAttributes
                  ? "You do not have permission to create document attributes"
                  : undefined
                : !canOpenDocumentCreateModal
                  ? "You do not have permission to create or import documents"
                  : undefined
            }
          >
            {showAttributesTable ? "+ Add Attribute" : "+ New Document"}
          </button>
        </div>
      </header>

      {error && <p className="users-error">{error}</p>}
      {!error && (
        <p className="users-permission-note">
          {showAttributesTable
            ? canCreateDocumentAttributes
              ? "Document attributes can be viewed and managed here."
              : "Document attributes are view-only with your current role."
            : canOpenDocumentCreateModal
              ? "Create, upload, or import documents using the button above."
              : "Documents are view-only with your current role."}
        </p>
      )}

      <div className="users-content">
      {showAttributesTable && (
        <div className="users-table-wrap case-attributes-table-wrap">
          <table
            className="users-table case-attributes-table"
            onMouseLeave={() => {
              setHoveredAttributeColumn(null);
              setHoveredAttributeRow(null);
            }}
          >
            <thead>
              <tr>
                <th
                  className={`users-th case-attributes-case-col${attributeSortCol === "name" ? " users-th--sorted" : ""}${hoveredAttributeColumn === "name" ? " case-attributes-cell--hover" : ""}`}
                  onClick={() => handleAttributeSort("name")}
                  onMouseEnter={() => {
                    setHoveredAttributeColumn("name");
                    setHoveredAttributeRow(null);
                  }}
                >
                  Document
                  <span className="users-sort-icon">
                    {attributeSortCol === "name" ? (attributeSortDir === "asc" ? " ↑" : " ↓") : " ↕"}
                  </span>
                </th>
                {attributeDefs.map((attr) => (
                  <th
                    key={attr.id}
                    className={`users-th case-attributes-value-col${attributeSortCol === attr.id ? " users-th--sorted" : ""}${hoveredAttributeColumn === attr.id ? " case-attributes-cell--hover" : ""}`}
                    onClick={() => handleAttributeSort(attr.id)}
                    onMouseEnter={() => {
                      setHoveredAttributeColumn(attr.id);
                      setHoveredAttributeRow(null);
                    }}
                    onContextMenu={(e) => {
                      if (!canManageDocumentAttributes) return;
                      e.preventDefault();
                      setAttributeContextMenu({ x: e.clientX, y: e.clientY, attr });
                    }}
                  >
                    {attr.name}
                    <span className="users-sort-icon">
                      {attributeSortCol === attr.id ? (attributeSortDir === "asc" ? " ↑" : " ↓") : " ↕"}
                    </span>
                    <span className="case-attribute-type-label">{attr.dataType === "datetime" ? "Date/time" : attr.dataType}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={Math.max(attributeDefs.length + 1, 1)} className="users-td-msg">Loading...</td></tr>}
              {!loading && sortedAttributeRows.length === 0 && <tr><td colSpan={Math.max(attributeDefs.length + 1, 1)} className="users-td-msg">No documents yet.</td></tr>}
              {!loading && sortedAttributeRows.map((row) => (
                <tr key={row.id} className={`users-row${hoveredAttributeRow === row.id ? " case-attributes-row--hover" : ""}`}>
                  <td
                    className={`users-td users-td--name case-attributes-case-cell${hoveredAttributeColumn === "name" ? " case-attributes-cell--hover" : ""}`}
                    onMouseEnter={() => {
                      setHoveredAttributeColumn("name");
                      setHoveredAttributeRow(row.id);
                    }}
                  >
                    {row.name}
                  </td>
                  {attributeDefs.map((attr) => {
                    const key = valueKey(row.id, attr.id);
                    const cell = attributeValues[key];
                    return (
                      <td
                        key={attr.id}
                        className={`users-td case-attributes-value-cell${hoveredAttributeColumn === attr.id ? " case-attributes-cell--hover" : ""}`}
                        onMouseEnter={() => {
                          setHoveredAttributeColumn(attr.id);
                          setHoveredAttributeRow(row.id);
                        }}
                        onContextMenu={(e) => {
                          if (!canManageDocumentAttributes) return;
                          e.preventDefault();
                          setAttributeContextMenu({ x: e.clientX, y: e.clientY, attr });
                        }}
                      >
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
              <th
                style={{ width: "23%" }}
                className={`users-th${sortCol === "name" ? " users-th--sorted" : ""}`}
                onClick={() => handleSort("name")}
              >
                Name
                <span className="users-sort-icon">{sortCol === "name" ? (sortDir === "asc" ? " ↑" : " ↓") : " ↕"}</span>
              </th>
              <th style={{ width: "14%" }} className="users-th">
                Type
              </th>
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
              <tr><td colSpan={6} className="users-td-msg">No documents yet.</td></tr>
            )}
            {!loading && sorted.map((row) => (
              <tr
                key={row.id}
                className="users-row case-list-row"
                onClick={() => setSelectedRow(row)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, row });
                }}
              >
                <td className="users-td users-td--name">{row.name}</td>
                <td className="users-td users-td--muted">{row.type || "Text"}</td>
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
      </div>

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{showAttributesTable ? "Document Attributes Help" : "Documents Help"}</h2>
            {showAttributesTable ? (
              <>
                <p className="users-guide-copy">
                  Document attributes are intended to represent qualities of each document.
                </p>
                <p className="users-guide-copy">
                  Use attributes to capture structured details like source type, date, format, or other document-level properties you want to compare across the project.
                </p>
                <p className="users-guide-copy">
                  If your role does not allow editing, this table remains available in a view-only mode.
                </p>
              </>
            ) : (
              <>
                <p className="users-guide-copy">
                  Documents are the main units of observation in a project. They can be associated with cases, linked to memos, and enriched with structured attributes.
                </p>
                <p className="users-guide-copy">
                  Select a row to open details, or right-click for quick actions. Use <strong>Show Attributes</strong> to switch to a cross-document attribute view.
                </p>
                <p className="users-guide-copy">
                  Creation, upload, and import options depend on your project role.
                </p>
              </>
            )}
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button type="button" className="btn" onClick={() => setHelpOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {attributeContextMenu && (
        <div
          ref={attributeContextMenuRef}
          className="context-menu"
          style={attributeContextMenuStyle}
        >
          {canManageDocumentAttributes && (
            <>
              {canEditDocumentAttributes && (
                <button
                  className="context-menu-item"
                  onClick={() => {
                    setAttributeValueDraft({
                      id: attributeContextMenu.attr.id,
                      name: attributeContextMenu.attr.name,
                      dataType: attributeContextMenu.attr.dataType,
                      description: attributeContextMenu.attr.description,
                      options: attributeContextMenu.attr.options,
                    });
                    setAttributeContextMenu(null);
                  }}
                >
                  Edit Attribute
                </button>
              )}
              {canDeleteDocumentAttributes && (
                <button
                  className="context-menu-item context-menu-item--danger"
                  onClick={() => handleDeleteAttribute(attributeContextMenu.attr)}
                >
                  Delete Attribute
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={contextMenuStyle}
        >
          {canAssociateCaseDocuments ? (
            <button
              className="context-menu-item"
              onClick={() => { setAssocCaseDoc(contextMenu.row); setContextMenu(null); }}
            >
              Associate Cases with Document
            </button>
          ) : (
            <div className="context-menu-item context-menu-item--disabled" title="You do not have permission to associate documents with cases">
              Associate Cases with Document
            </div>
          )}
          {canMemoAboutDocuments ? (
            <button
              className="context-menu-item"
              onClick={() => { setMemoForDoc(contextMenu.row); setContextMenu(null); }}
            >
              Memo About Document
            </button>
          ) : (
            <div className="context-menu-item context-menu-item--disabled" title="You do not have permission to create a memo about this document">
              Memo About Document
            </div>
          )}
          {canEditDocumentMetadata || canEditDocumentContent ? (
            <button
              className="context-menu-item"
              onClick={() => { setEditStartRow(contextMenu.row); setContextMenu(null); }}
            >
              {canEditDocumentMetadata ? "Edit Document" : "Open Edit View"}
            </button>
          ) : (
            <div className="context-menu-item context-menu-item--disabled" title="You do not have permission to edit this document">
              Edit Document
            </div>
          )}
          {canDeleteDocuments ? (
            <button
              className="context-menu-item context-menu-item--danger"
              onClick={() => { setConfirmDelete(contextMenu.row); setContextMenu(null); }}
            >
              Delete Document
            </button>
          ) : (
            <div className="context-menu-item context-menu-item--disabled" title="You do not have permission to delete documents">
              Delete Document
            </div>
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
          onLog={(action, label, recordId) => logAction(activeProject.id, action, label, recordId)}
          onDone={() => { setAssocCaseDoc(null); loadDocuments(); }}
          onClose={() => setAssocCaseDoc(null)}
        />
      )}

      {/* New Document modal */}
      {newDocOpen && (
        <NewDocumentModal
          allowedModes={allowedDocumentCreateModes}
          attributeDefs={attributeDefs}
          onDone={() => { setNewDocOpen(false); loadDocuments(); }}
          onClose={() => setNewDocOpen(false)}
        />
      )}

      {attributeValueDraft && (
        <AttributeValuesModal
          draft={attributeValueDraft}
          rows={sorted}
          attributeValues={attributeValues}
          saving={attributeSaving}
          onCancel={() => !attributeSaving && setAttributeValueDraft(null)}
          onSave={handleSaveAttribute}
        />
      )}
    </div>
  );
}

