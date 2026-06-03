import { useState, useEffect, useCallback, useRef, useId } from "react";
import { useStore } from "../context/StoreContext";
import { useAuth } from "../context/AuthContext";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import { MemoEditorView } from "./Analysis_Memos_View";
import { HelpIcon } from "../components/AppIcons";
import {
  AttributeValuesModal as SharedAttributeValuesModal,
  type SharedAttributeDataType as AttributeDataType,
  type SharedAttributeDraft as AttributeDraft,
} from "../components/AttributeValuesModal";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CaseRow {
  id: string;
  name: string;
  notes: string;       // HTML content
  documents: { id: string; name: string }[];
  memoCount: number;
  createdByName: string;
  createdAt: string;
}

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
  caseId: string;
  attributeId: string;
  value: string;
}

type SortCol = "name" | "documents" | "memos" | "createdByName" | "createdAt";
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

const AI_ASSIST_ADD_ATTRIBUTE_TARGET_KEY = "kq_ai_assist_add_attribute_target";

// ─── Column definitions ───────────────────────────────────────────────────────

const COLS: { key: SortCol; label: string; width: string }[] = [
  { key: "name",          label: "Name",       width: "28%" },
  { key: "documents",     label: "Documents",  width: "13%" },
  { key: "memos",         label: "Memos",      width: "11%" },
  { key: "createdByName", label: "Created By", width: "24%" },
  { key: "createdAt",     label: "Created",    width: "24%" },
];

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
}: {
  initialHtml: string;
  editorRef: React.RefObject<HTMLDivElement | null>;
}) {
  const id = useId();

  // Seed content once on mount
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

// ─── Case Detail sub-view ─────────────────────────────────────────────────────

function CaseEditorModal({
  title,
  initialName,
  initialNotes,
  attributeDefs,
  initialValues,
  saving,
  error,
  onCancel,
  onSave,
}: {
  title: string;
  initialName: string;
  initialNotes: string;
  attributeDefs: AttributeDefinition[];
  initialValues: Record<string, string>;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (payload: {
    name: string;
    notes: string;
    valuesByAttribute: Record<string, string>;
  }) => void;
}) {
  const [name, setName] = useState(initialName);
  const [valuesByAttribute, setValuesByAttribute] = useState<Record<string, string>>(initialValues);
  const notesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setName(initialName);
    setValuesByAttribute(initialValues);
  }, [initialName, initialValues]);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal--wide assoc-doc-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <div className="form">
          <label className="form-label">
            Name
            <input
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </label>
          <label className="form-label">
            <span className="form-label">Description</span>
            <RichTextEditor initialHtml={initialNotes} editorRef={notesRef} />
          </label>
          {attributeDefs.length > 0 && (
            <div>
              <h3 className="case-card-title" style={{ marginBottom: 10 }}>Attributes</h3>
              <div className="case-detail-attributes-table-wrap">
                <table className="case-detail-attributes-table">
                  <tbody>
                    {attributeDefs.map((attr) => (
                      <tr key={attr.id}>
                        <th className="case-detail-attributes-label" scope="row">{attr.name}</th>
                        <td className="case-detail-attributes-value">
                          {attr.dataType === "categorical" ? (
                            <select
                              className="form-input"
                              value={valuesByAttribute[attr.id] ?? ""}
                              onChange={(e) => setValuesByAttribute((prev) => ({ ...prev, [attr.id]: e.target.value }))}
                            >
                              <option value="">—</option>
                              {attr.options.map((option) => (
                                <option key={option} value={option}>{option}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              className="form-input"
                              type={inputTypeForDataType(attr.dataType)}
                              step={attr.dataType === "number" ? "any" : undefined}
                              value={valuesByAttribute[attr.id] ?? ""}
                              onChange={(e) => setValuesByAttribute((prev) => ({ ...prev, [attr.id]: e.target.value }))}
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        {error && <p className="auth-error">{error}</p>}
        <div className="form-actions">
          <button className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
          <button
            className="btn btn--primary"
            onClick={() => onSave({
              name: name.trim(),
              notes: notesRef.current?.innerHTML ?? initialNotes,
              valuesByAttribute,
            })}
            disabled={saving || !name.trim()}
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CaseDetail({
  row: initialRow,
  pb,
  startEditing,
  canEdit,
  canDelete,
  canAssociateDocuments,
  canMemoAbout,
  attributeDefs,
  attributeValues,
  onBack,
  onMemoAbout,
  onRequestDelete,
}: {
  row: CaseRow;
  pb: NonNullable<ReturnType<typeof useStore>["pb"]>;
  startEditing: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canAssociateDocuments: boolean;
  canMemoAbout: boolean;
  attributeDefs: AttributeDefinition[];
  attributeValues: Record<string, AttributeValue>;
  onBack: () => void;
  onMemoAbout: () => void;
  onRequestDelete: (row: CaseRow) => void;
}) {
  const { setView, setPendingDocId, setPendingMemoId, activeProject, updateCase, logAction } = useStore();
  const [row,          setRow]          = useState(initialRow);
  const [showEditModal, setShowEditModal] = useState(startEditing);
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [caseMemos,    setCaseMemos]    = useState<{ id: string; title: string }[]>([]);
  const [showAssocDocs, setShowAssocDocs] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [caseAttributeValues, setCaseAttributeValues] = useState<Record<string, AttributeValue>>(() => {
    const initial: Record<string, AttributeValue> = {};
    for (const attr of attributeDefs) {
      const value = attributeValues[`${initialRow.id}:${attr.id}`];
      if (value) initial[attr.id] = value;
    }
    return initial;
  });
  const editing = false;
  function handleToggleEdit(_on: boolean) {}
  function handleSave() {}

  useEffect(() => {
    pb.collection("memos")
      .getFullList({ filter: `cases ~ "${row.id}"`, fields: "id,title", sort: "-created" })
      .then((records) => setCaseMemos(records.map((r) => ({ id: r.id, title: r.title as string }))))
      .catch(console.error);
  }, [pb, row.id]);

  const refreshDocuments = useCallback(async () => {
    const caseDocs = await pb.collection("case_documents").getFullList({
      filter: `case="${row.id}"`,
      expand: "document",
    });
    const docs = caseDocs.map((cd) => ({
      id:   cd.document as string,
      name: (cd.expand?.document as { name?: string } | undefined)?.name ?? "—",
    }));
    setRow((prev) => ({ ...prev, documents: docs }));
  }, [pb, row.id]);

  useEffect(() => {
    setRow(initialRow);
    setShowEditModal(startEditing);
    setError(null);
    setCaseAttributeValues(() => {
      const initial: Record<string, AttributeValue> = {};
      for (const attr of attributeDefs) {
        const value = attributeValues[`${initialRow.id}:${attr.id}`];
        if (value) initial[attr.id] = value;
      }
      return initial;
    });
  }, [initialRow, startEditing, attributeDefs, attributeValues]);

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

  async function handleSaveCase(payload: {
    name: string;
    notes: string;
    valuesByAttribute: Record<string, string>;
  }) {
    setSaving(true);
    setError(null);
    try {
      await updateCase(row.id, { name: payload.name, notes: payload.notes });

      const nextAttributeValues = { ...caseAttributeValues };
      await Promise.all(attributeDefs.map(async (attr) => {
        const nextValue = payload.valuesByAttribute[attr.id] ?? "";
        const existing = nextAttributeValues[attr.id];
        if (existing?.id) {
          await pb.collection("case_attribute_values").update(existing.id, {
            value: nextValue,
            deleted_at: nextValue.trim() ? "" : new Date().toISOString(),
          });
          if (nextValue.trim()) nextAttributeValues[attr.id] = { ...existing, value: nextValue };
          else delete nextAttributeValues[attr.id];
        } else if (nextValue.trim()) {
          const record = await pb.collection("case_attribute_values").create({
            case: row.id,
            attribute: attr.id,
            value: nextValue,
            deleted_at: "",
          });
          nextAttributeValues[attr.id] = {
            id: record.id,
            caseId: row.id,
            attributeId: attr.id,
            value: nextValue,
          };
        }
      }));

      setRow((prev) => ({ ...prev, name: payload.name, notes: payload.notes }));
      setCaseAttributeValues(nextAttributeValues);
      setShowEditModal(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="view case-detail-view">
      <div className="workspace-back-row workspace-back-row--split">
        <button className="btn" onClick={onBack}>Back to Cases</button>
        <div className="workspace-back-actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setShowEditModal(true)}
            disabled={!canEdit}
            title={!canEdit ? "You do not have permission to edit cases" : undefined}
          >
            Edit Case
          </button>
          <div className="user-detail-menu-wrap" ref={menuRef}>
            <button
              type="button"
              className="btn"
              aria-label="Case actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              Actions
            </button>
            {menuOpen && (
              <div className="context-menu user-detail-menu" role="menu">
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
                    Delete Case
                  </button>
                ) : (
                  <div className="context-menu-item context-menu-item--disabled" title="You do not have permission to delete cases">
                    Delete Case
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Centered body */}
      <div className="case-detail-body">

        {/* Name card */}
        <div className="case-card">
          <h3 className="case-card-title">Case</h3>
          <p className="case-card-value">{row.name}</p>
        </div>

        {/* Description card (formerly Notes) */}
        <div className="case-card">
          <h3 className="case-card-title">Description</h3>
          {row.notes ? (
            <div
              className="case-notes-body"
              dangerouslySetInnerHTML={{ __html: row.notes }}
            />
          ) : (
            <p className="case-card-empty">No description yet.</p>
          )}
        </div>

        {/* Meta */}
        <dl className="user-detail-meta case-detail-meta">
          <dt>Created By</dt><dd>{row.createdByName}</dd>
          <dt>Created</dt>   <dd>{fmtDate(row.createdAt)}</dd>
        </dl>

        {/* Documents card */}
        <div className="case-card">
          <div className="case-card-header">
              <h3 className="case-card-title">Documents</h3>
            <button
              className="btn btn--sm"
              onClick={() => setShowAssocDocs(true)}
              disabled={!canAssociateDocuments}
              title={!canAssociateDocuments ? "You do not have permission to link documents to this case" : undefined}
            >
              Associate Documents
            </button>
          </div>
          {row.documents.length > 0 ? (
            <ul className="case-detail-doc-list">
              {row.documents.map((d) => (
                <li key={d.id} className="case-detail-doc-item">
                  <button
                    className="detail-link-btn"
                    onClick={() => { setPendingDocId(d.id); setView("documents"); }}
                  >
                    {d.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="case-card-empty">No documents associated yet.</p>
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
              title={!canMemoAbout ? "You do not have permission to create a memo about this case" : undefined}
            >
              Memo About
            </button>
          </div>
          {caseMemos.length > 0 ? (
            <ul className="case-detail-doc-list">
              {caseMemos.map((m) => (
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

        {/* Save / cancel (edit mode only) */}
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

      {/* Associate Documents modal (opened from within detail) */}
      {showAssocDocs && activeProject && canAssociateDocuments && (
        <AssociateDocumentsModal
          caseRow={row}
          pb={pb}
          projectId={activeProject.id}
          onLog={(action, label, recordId) => logAction(activeProject.id, action, label, recordId)}
          onDone={() => { setShowAssocDocs(false); refreshDocuments(); }}
          onClose={() => setShowAssocDocs(false)}
        />
      )}
      {showEditModal && (
        <CaseEditorModal
          title="Edit Case"
          initialName={row.name}
          initialNotes={row.notes}
          attributeDefs={attributeDefs}
          initialValues={Object.fromEntries(attributeDefs.map((attr) => [attr.id, caseAttributeValues[attr.id]?.value ?? ""]))}
          saving={saving}
          error={error}
          onCancel={() => {
            if (saving) return;
            setShowEditModal(false);
            setError(null);
          }}
          onSave={handleSaveCase}
        />
      )}
    </div>
  );
}

// ─── Associate Documents modal ───────────────────────────────────────────────

type DocSortCol = "name" | "cases" | "createdAt";

interface DocItem {
  id: string;
  name: string;
  caseNames: string[];  // display names of all associated cases
  createdAt: string;
}

function AssociateDocumentsModal({
  caseRow,
  pb,
  projectId,
  onLog,
  onDone,
  onClose,
}: {
  caseRow: CaseRow;
  pb: NonNullable<ReturnType<typeof useStore>["pb"]>;
  projectId: string;
  onLog: (action: string, label: string, recordId?: string) => Promise<void> | void;
  onDone: () => void;
  onClose: () => void;
}) {
  const { addCaseDocument, removeCaseDocument } = useStore();
  const [docs,        setDocs]        = useState<DocItem[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [selected,    setSelected]    = useState<Set<string>>(new Set());
  const [sortCol,     setSortCol]     = useState<DocSortCol>("name");
  const [sortDir,     setSortDir]     = useState<SortDir>("asc");

  // Map `${docId}:${caseId}` → case_documents record id (for deletions)
  const casedocRecordId = useRef<Record<string, string>>({});
  // Which doc IDs were associated with this case on load (for diffing)
  const initialSelected = useRef<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const docRecords = await pb.collection("documents").getFullList({
          filter: `project="${projectId}"&&deleted_at=""`,
          sort: "name",
        });

        if (docRecords.length === 0) {
          setDocs([]);
          setLoading(false);
          return;
        }

        const allCaseDocs = await pb.collection("case_documents").getFullList({
          filter: docRecords.map((d) => `document="${d.id}"`).join(" || "),
          expand: "case",
        });

        // Build lookup structures
        const caseNamesByDoc: Record<string, string[]> = {};
        const recordMap: Record<string, string> = {};

        for (const cd of allCaseDocs) {
          const docId  = cd.document as string;
          const caseId = cd.case    as string;
          const name   = (cd.expand?.case as { name?: string } | undefined)?.name ?? "—";
          (caseNamesByDoc[docId] ??= []).push(name);
          recordMap[`${docId}:${caseId}`] = cd.id as string;
        }

        casedocRecordId.current = recordMap;

        const preSelected = new Set(
          allCaseDocs
            .filter((cd) => cd.case === caseRow.id)
            .map((cd) => cd.document as string),
        );
        initialSelected.current = preSelected;
        setSelected(new Set(preSelected));

        setDocs(docRecords.map((r) => ({
          id:        r.id,
          name:      r.name as string,
          caseNames: caseNamesByDoc[r.id] ?? [],
          createdAt: r.created as string,
        })));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load documents.");
      } finally {
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleDoc(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === docs.length) setSelected(new Set());
    else setSelected(new Set(docs.map((d) => d.id)));
  }

  function handleSort(col: DocSortCol) {
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
        ...toAdd.map((docId) => addCaseDocument(caseRow.id, docId)),
        ...toRemove.map((docId) => {
          const recId = casedocRecordId.current[`${docId}:${caseRow.id}`];
          return recId ? removeCaseDocument(recId) : Promise.resolve();
        }),
      ]);
      if (toAdd.length > 0 || toRemove.length > 0) {
        await onLog(
          "case.associations",
          `Updated document associations for case "${caseRow.name}" (+${toAdd.length} / -${toRemove.length})`,
          caseRow.id,
        );
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save associations.");
      setSaving(false);
    }
  }

  const sortedDocs = [...docs].sort((a, b) => {
    let av: string, bv: string;
    if (sortCol === "cases") { av = a.caseNames[0] ?? ""; bv = b.caseNames[0] ?? ""; }
    else { av = sortCol === "name" ? a.name : a.createdAt; bv = sortCol === "name" ? b.name : b.createdAt; }
    const cmp = av.localeCompare(bv, undefined, { sensitivity: "base" });
    return sortDir === "asc" ? cmp : -cmp;
  });

  const allChecked = docs.length > 0 && selected.size === docs.length;
  const someChecked = selected.size > 0 && selected.size < docs.length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <h2>Associate Documents — {caseRow.name}</h2>

        {loading ? (
          <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>Loading documents…</p>
        ) : docs.length === 0 ? (
          <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
            No documents in this project yet.
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
                  {(["name", "cases", "createdAt"] as DocSortCol[]).map((col) => (
                    <th
                      key={col}
                      className={`users-th${sortCol === col ? " users-th--sorted" : ""}`}
                      onClick={() => handleSort(col)}
                      style={{ cursor: "pointer" }}
                    >
                      {col === "name" ? "Name" : col === "cases" ? "Cases" : "Created"}
                      <span className="users-sort-icon">
                        {sortCol === col ? (sortDir === "asc" ? " ↑" : " ↓") : " ↕"}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedDocs.map((doc) => (
                  <tr
                    key={doc.id}
                    className={`users-row${selected.has(doc.id) ? " assoc-doc-row--selected" : ""}`}
                    onClick={() => toggleDoc(doc.id)}
                  >
                    <td className="users-td assoc-doc-check-col" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(doc.id)}
                        onChange={() => toggleDoc(doc.id)}
                      />
                    </td>
                    <td className="users-td users-td--name">{doc.name}</td>
                    <td className="users-td users-td--muted cases-td-docs">
                      {doc.caseNames.length > 0
                        ? doc.caseNames.map((c, i) => <span key={i} className="cases-doc-name">{c}</span>)
                        : <span className="cases-no-docs">—</span>}
                    </td>
                    <td className="users-td users-td--muted">{fmtDate(doc.createdAt)}</td>
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

// ─── Main view ────────────────────────────────────────────────────────────────


export function CasesView() {
  const {
    activeProject,
    pb,
    canCurrentUser,
    ensureProjectSafetyBackup,
    pendingCaseId,
    setPendingCaseId,
    createCase,
    deleteCase,
    logAction,
  } = useStore();
  const { user: currentUser } = useAuth();
  const canCreateCases = canCurrentUser("createCase");
  const canEditCases = canCurrentUser("editCase");
  const canDeleteCases = canCurrentUser("deleteCase");
  const canAssociateDocuments = canCurrentUser("linkCaseDocuments") || canCurrentUser("unlinkCaseDocuments");
  const canCreateMemos = canCurrentUser("createMemo");
  const canAssociateMemoObjects = canCurrentUser("associateMemoObjects");
  const canMemoAboutCases = canCreateMemos && canAssociateMemoObjects;
  const canCreateCaseAttributes = canCurrentUser("createCaseAttributes");
  const canEditCaseAttributes = canCurrentUser("editCaseAttributes");
  const canDeleteCaseAttributes = canCurrentUser("deleteCaseAttributes");
  const canManageCaseAttributes =
    canCreateCaseAttributes
    || canEditCaseAttributes
    || canDeleteCaseAttributes;

  const [rows,    setRows]    = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const [sortCol, setSortCol] = useState<SortCol>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; row: CaseRow;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuStyle = useViewportContextMenuStyle(contextMenu, contextMenuRef);

  const [confirmDelete,  setConfirmDelete]  = useState<CaseRow | null>(null);
  const [deleteLoading,  setDeleteLoading]  = useState(false);
  const [selectedRow,    setSelectedRow]    = useState<CaseRow | null>(null);
  const [editStartRow,   setEditStartRow]   = useState<CaseRow | null>(null);
  const [assocDocCase,   setAssocDocCase]   = useState<CaseRow | null>(null);
  const [memoForCase,    setMemoForCase]    = useState<CaseRow | null>(null);
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
    if (!activeProject || !canManageCaseAttributes) return;
    try {
      if (window.localStorage.getItem(AI_ASSIST_ADD_ATTRIBUTE_TARGET_KEY) !== "case") return;
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
  }, [activeProject, canManageCaseAttributes]);

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadCases = useCallback(async () => {
    if (!activeProject || !pb) return;
    setLoading(true);
    setError(null);
    try {
      const pid = activeProject.id;

      // Fetch cases, memos, and project-level attribute definitions in parallel
      const [caseRecords, memoRecords, attrDefRecords] = await Promise.all([
        pb.collection("cases").getFullList({
          filter: `project="${pid}"&&deleted_at=""`,
          expand: "created_by",
          sort: "-created",
        }),
        pb.collection("memos").getFullList({
          filter: `project="${pid}"&&deleted_at=""`,
          fields: "id,cases",
        }),
        pb.collection("case_attribute_definitions").getFullList({
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

      // Load document associations and attributes (needs case IDs from above)
      const caseIds = caseRecords.map((c) => c.id);
      const [caseDocs, attrRecords] = caseIds.length > 0
        ? await Promise.all([
            pb.collection("case_documents").getFullList({
              filter: caseIds.map((id) => `case="${id}"`).join(" || "),
              expand: "document",
            }),
            pb.collection("case_attribute_values").getFullList({
              filter: `(${caseIds.map((id) => `case="${id}"`).join(" || ")})&&deleted_at=""`,
              sort: "created",
            }),
          ])
        : [[], []];

      // caseId → documents {id, name}
      const docsByCase: Record<string, { id: string; name: string }[]> = {};
      for (const cd of caseDocs) {
        const docName: string = cd.expand?.document?.name || "—";
        (docsByCase[cd.case] ??= []).push({ id: cd.document as string, name: docName });
      }

      // caseId → memo count
      const nextAttributeValues: Record<string, AttributeValue> = {};
      for (const attr of attrRecords) {
        const caseId = attr.case as string;
        const attributeId = attr.attribute as string;
        nextAttributeValues[`${caseId}:${attributeId}`] = {
          id: attr.id,
          caseId,
          attributeId,
          value: (attr.value as string | undefined) ?? "",
        };
      }
      setAttributeValues(nextAttributeValues);

      const memosByCaseId: Record<string, number> = {};
      for (const memo of memoRecords) {
        const ids: string[] = Array.isArray(memo.cases)
          ? memo.cases
          : memo.cases ? [memo.cases as string] : [];
        for (const cid of ids) {
          memosByCaseId[cid] = (memosByCaseId[cid] ?? 0) + 1;
        }
      }

      setRows(
        caseRecords.map((r) => {
          const cb = r.expand?.created_by;
          return {
            id:            r.id,
            name:          r.name,
            notes:         r.notes ?? "",
            documents:     docsByCase[r.id] ?? [],
            memoCount:     memosByCaseId[r.id] ?? 0,
            createdByName: cb?.name || cb?.email || "—",
            createdAt:     r.created,
          };
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load cases.");
    } finally {
      setLoading(false);
    }
  }, [activeProject, pb]);

  useEffect(() => { loadCases(); }, [loadCases]);

  // Consume a pending case ID (navigated here from another view)
  useEffect(() => {
    if (!pendingCaseId || rows.length === 0) return;
    const match = rows.find((r) => r.id === pendingCaseId);
    if (match) {
      setSelectedRow(match);
      setPendingCaseId(null);
    }
  }, [rows, pendingCaseId, setPendingCaseId]);

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
    if (sortCol === "documents") {
      cmp = a.documents.length - b.documents.length;
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

  function valueKey(caseId: string, attributeId: string) {
    return `${caseId}:${attributeId}`;
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

  async function handleSaveAttribute(draft: AttributeDraft, valuesByCase: Record<string, string>) {
    if (!activeProject || !pb || !draft.name.trim()) return;
    if (draft.id ? !canEditCaseAttributes : !canCreateCaseAttributes) return;
    setAttributeSaving(true);
    setError(null);
    try {
      const record = draft.id
        ? await pb.collection("case_attribute_definitions").update(draft.id, {
            name: draft.name.trim(),
            data_type: draft.dataType,
            description: draft.description,
            options_json: JSON.stringify(draft.options),
            deleted_at: "",
          })
        : await pb.collection("case_attribute_definitions").create({
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
        const value = valuesByCase[row.id] ?? "";
        if (existing?.id) {
          await pb.collection("case_attribute_values").update(existing.id, {
            value,
            deleted_at: value.trim() ? "" : new Date().toISOString(),
          });
          if (value.trim()) nextValues[key] = { ...existing, value };
          else delete nextValues[key];
        } else if (value.trim()) {
          const valueRecord = await pb.collection("case_attribute_values").create({
            case: row.id,
            attribute: attrId,
            value,
            deleted_at: "",
          });
          nextValues[key] = { id: valueRecord.id, caseId: row.id, attributeId: attrId, value };
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
        draft.id ? "case_attribute.update" : "case_attribute.create",
        `${draft.id ? "Updated" : "Added"} case attribute "${nextDef.name}"`,
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
    if (!canDeleteCaseAttributes) return;
    setAttributeSaving(true);
    setError(null);
    try {
      await ensureProjectSafetyBackup(
        "case_attribute.delete",
        `Deleted case attribute "${attr.name}"`,
      );
      const deletedAt = new Date().toISOString();
      await pb.collection("case_attribute_definitions").update(attr.id, { deleted_at: deletedAt });
      const valuesForAttribute = Object.values(attributeValues).filter((value) => value.attributeId === attr.id && value.id);
      await Promise.all(valuesForAttribute.map((value) =>
        pb.collection("case_attribute_values").update(value.id, { deleted_at: deletedAt })
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
        await logAction(activeProject.id, "case_attribute.delete", `Deleted case attribute "${attr.name}"`, attr.id);
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
      await deleteCase(confirmDelete.id);
      setRows((prev) => prev.filter((r) => r.id !== confirmDelete.id));
      setSelectedRow((prev) => prev?.id === confirmDelete.id ? null : prev);
      setEditStartRow((prev) => prev?.id === confirmDelete.id ? null : prev);
      setConfirmDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete case.");
      setConfirmDelete(null);
    } finally {
      setDeleteLoading(false);
    }
  }

  // ── New case ──────────────────────────────────────────────────────────────

  async function handleNewCase() {
    if (!activeProject) return;
    try {
      const record = await createCase("New Case", currentUser?.id);
      if (!record) return;
      const newRow: CaseRow = {
        id:            record.id,
        name:          record.name as string,
        notes:         "",
        documents:     [],
        memoCount:     0,
        createdByName: currentUser?.name || currentUser?.email || "—",
        createdAt:     record.created as string,
      };
      setEditStartRow(newRow);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create case.");
    }
  }

  // ── Detail / edit ─────────────────────────────────────────────────────────

  if (memoForCase) {
    return (
      <MemoEditorView
        preselectedCaseIds={[memoForCase.id]}
        backLabel="Back to Cases"
        onSaved={() => setMemoForCase(null)}
        onBack={() => setMemoForCase(null)}
      />
    );
  }

  const detailRow   = selectedRow ?? editStartRow;
  const startEdit   = editStartRow !== null;

  if (detailRow && pb) {
    return (
      <>
        <CaseDetail
          row={detailRow}
          pb={pb}
          startEditing={startEdit}
          canEdit={canEditCases}
          canDelete={canDeleteCases}
          canAssociateDocuments={canAssociateDocuments}
          canMemoAbout={canMemoAboutCases}
          onBack={() => { setSelectedRow(null); setEditStartRow(null); loadCases(); }}
          attributeDefs={attributeDefs}
          attributeValues={attributeValues}
          onMemoAbout={() => setMemoForCase(detailRow)}
          onRequestDelete={(row) => setConfirmDelete(row)}
        />
        {confirmDelete && (
          <div
            className="modal-overlay"
            onClick={() => !deleteLoading && setConfirmDelete(null)}
          >
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h2>Delete Case</h2>
              <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                Are you sure you want to permanently delete{" "}
                <strong>{confirmDelete.name}</strong>?
              </p>
              <p className="modal-warning-text">
                All data associated with this case - including document associations
                and any linked memos - will be permanently lost and cannot be recovered.
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
                  {deleteLoading ? "Deleting…" : "Delete Case"}
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
          <h1>Cases</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            onClick={() => setHelpOpen(true)}
            title="Show Help"
            aria-label="Show Help"
          >
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
        <div className="view-header-actions">
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
                : handleNewCase
            }
            disabled={showAttributesTable ? !canCreateCaseAttributes : !canCreateCases}
            title={
              showAttributesTable
                ? !canCreateCaseAttributes
                  ? "You do not have permission to create case attributes"
                  : undefined
                : !canCreateCases
                  ? "You do not have permission to create cases"
                  : undefined
            }
          >
            {showAttributesTable ? "+ Add Attribute" : "+ New Case"}
          </button>
        </div>
      </header>

      {error && <p className="users-error">{error}</p>}

      <div className="users-content">
          <div className="ai-assist-home-tabbar" style={{ marginBottom: 16 }}>
            <div className="segmented-control" role="tablist" aria-label="Case workspace views">
              <button
                type="button"
                className={showAttributesTable ? "segmented-control-option" : "segmented-control-option segmented-control-option--active"}
                role="tab"
                aria-selected={!showAttributesTable}
                onClick={() => setShowAttributesTable(false)}
              >
                Details
              </button>
              <button
                type="button"
                className={showAttributesTable ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                role="tab"
                aria-selected={showAttributesTable}
                onClick={() => setShowAttributesTable(true)}
              >
                Attributes
              </button>
            </div>
          </div>

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
                      Case
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
                          if (!canManageCaseAttributes) return;
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
                  {!loading && sortedAttributeRows.length === 0 && <tr><td colSpan={Math.max(attributeDefs.length + 1, 1)} className="users-td-msg">No cases yet.</td></tr>}
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
                              if (!canManageCaseAttributes) return;
                              e.preventDefault();
                              setAttributeContextMenu({
                                x: e.clientX,
                                y: e.clientY,
                                attr,
                              });
                            }}
                          >
                            {cell?.value ? formatAttributeDisplay(cell.value, attr.dataType) : <span className="cases-no-docs">-</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

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
                  <tr><td colSpan={5} className="users-td-msg">Loading...</td></tr>
                )}
                {!loading && sorted.length === 0 && (
                  <tr><td colSpan={5} className="users-td-msg">No cases yet.</td></tr>
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
                    <td className="users-td users-td--muted users-td--count">
                      {row.documents.length > 0 ? row.documents.length : <span className="cases-no-docs">-</span>}
                    </td>
                    <td className="users-td users-td--muted users-td--count">
                      {row.memoCount > 0 ? row.memoCount : <span className="cases-no-docs">-</span>}
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
          <div className="modal modal--help" onClick={(e) => e.stopPropagation()}>
            <h2>{showAttributesTable ? "Case Attributes Help" : "Cases Help"}</h2>
            {showAttributesTable ? (
              <>
                <p className="users-guide-copy">
                  Review case attributes across cases, create a new attribute, edit attribute definitions, edit values, delete attributes when permitted, and switch back to the details tab.
                </p>
                <p className="users-guide-copy">
                  Use the attribute table when you need a cross-case structured view instead of individual case cards. Create an attribute once, then fill or compare its values across cases.
                </p>
                <p className="users-guide-copy">
                  Attribute definitions are shared across the project. Editing rights depend on project permissions.
                </p>
              </>
            ) : (
              <>
                <p className="users-guide-copy">
                  Create, open, edit, or delete cases, associate documents to cases, switch between the details and attributes tabs, create or edit case attributes, and review structured case values.
                </p>
                <p className="users-guide-copy">
                  Use Cases to manage the units of analysis in the project. Open a case for details, connect supporting documents, and switch to attribute view when you need structured case comparisons.
                </p>
                <p className="users-guide-copy">
                  Case editing and deletion depend on role. Attribute editing uses shared project data, and associated documents can affect downstream analysis and reporting.
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
          {canManageCaseAttributes && (
            <>
              {canEditCaseAttributes && (
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
              {canDeleteCaseAttributes && (
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
          {canAssociateDocuments ? (
            <button
              className="context-menu-item"
              onClick={() => { setAssocDocCase(contextMenu.row); setContextMenu(null); }}
            >
              Associate Documents with Case
            </button>
          ) : (
            <div className="context-menu-item context-menu-item--disabled" title="You do not have permission to link documents to cases">
              Associate Documents with Case
            </div>
          )}
          {canMemoAboutCases ? (
            <button
              className="context-menu-item"
              onClick={() => { setMemoForCase(contextMenu.row); setContextMenu(null); }}
            >
              Memo About Case
            </button>
          ) : (
            <div className="context-menu-item context-menu-item--disabled" title="You do not have permission to create a memo about this case">
              Memo About Case
            </div>
          )}
          {canEditCases ? (
            <button
              className="context-menu-item"
              onClick={() => { setEditStartRow(contextMenu.row); setContextMenu(null); }}
            >
              Edit Case
            </button>
          ) : (
            <div className="context-menu-item context-menu-item--disabled" title="You do not have permission to edit cases">
              Edit Case
            </div>
          )}
          {canDeleteCases ? (
            <button
              className="context-menu-item context-menu-item--danger"
              onClick={() => { setConfirmDelete(contextMenu.row); setContextMenu(null); }}
            >
              Delete Case
            </button>
          ) : (
            <div className="context-menu-item context-menu-item--disabled" title="You do not have permission to delete cases">
              Delete Case
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
            <h2>Delete Case</h2>
            <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
              Are you sure you want to permanently delete{" "}
              <strong>{confirmDelete.name}</strong>?
            </p>
            <p className="modal-warning-text">
              All data associated with this case — including document associations
              and any linked memos — will be permanently lost and cannot be recovered.
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
                {deleteLoading ? "Deleting…" : "Delete Case"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Associate Documents modal */}
      {assocDocCase && pb && activeProject && (
        <AssociateDocumentsModal
          caseRow={assocDocCase}
          pb={pb}
          projectId={activeProject.id}
          onLog={(action, label, recordId) => logAction(activeProject.id, action, label, recordId)}
          onDone={() => { setAssocDocCase(null); loadCases(); }}
          onClose={() => setAssocDocCase(null)}
        />
      )}

      {attributeValueDraft && (
        <SharedAttributeValuesModal
          draft={attributeValueDraft}
          rows={sorted.map((row) => ({ id: row.id, name: row.name }))}
          initialValuesByOwner={Object.fromEntries(
            sorted.map((row) => [
              row.id,
              attributeValueDraft.id ? attributeValues[`${row.id}:${attributeValueDraft.id}`]?.value ?? "" : "",
            ]),
          )}
          saving={attributeSaving}
          onCancel={() => !attributeSaving && setAttributeValueDraft(null)}
          onSave={handleSaveAttribute}
          emptyStateLabel="No cases yet."
        />
      )}
    </div>
  );
}


