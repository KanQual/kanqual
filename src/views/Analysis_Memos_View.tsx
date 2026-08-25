import { useState, useEffect, useCallback, useRef, useId, useMemo } from "react";
import { useStore } from "../context/StoreContext";
import { useAuth } from "../context/AuthContext";
import type { Code } from "../types";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  Document as DocxDocument,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import { HelpIcon } from "../components/AppIcons";
import { SettingsModal } from "../components/SettingsModal";
import { formatCurrentDateTime } from "../i18n/formatters";
import { useI18n } from "../i18n/provider";

let jsPdfPromise: Promise<typeof import("jspdf")> | null = null;

async function loadJsPdf() {
  if (!jsPdfPromise) {
    jsPdfPromise = import("jspdf");
  }
  return jsPdfPromise;
}

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
  caseAttributeDefIds: string[];
  documentAttributeDefIds: string[];
  // Display names for attribute defs
  caseAttributeDefNames: string[];
  documentAttributeDefNames: string[];
  // Full annotation details for display
  annotationDetails: AnnItem[];
}

type SortCol = "title" | "createdByName" | "createdAt" | "cases" | "documents" | "codes";
type SortDir = "asc" | "desc";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  if (!iso) return "—";
  try {
    return formatCurrentDateTime(iso, {
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
  preselectedAnnotationIds,
  preselectedCaseAttributeDefIds,
  preselectedDocumentAttributeDefIds,
  backLabel,
  onSaved,
  onBack,
}: {
  editRow?: MemoRow;
  preselectedCaseIds?: string[];
  preselectedDocumentIds?: string[];
  preselectedCodeIds?: string[];
  preselectedAnnotationIds?: string[];
  preselectedCaseAttributeDefIds?: string[];
  preselectedDocumentAttributeDefIds?: string[];
  backLabel?: string;
  onSaved: () => void;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const {
    pb,
    activeProject,
    documents: storeDocs,
    codes: storeCodes,
    addMemo,
    updateMemo,
    canCurrentUser,
  } = useStore();
  const { user: currentUser } = useAuth();
  const canCreateMemos = canCurrentUser("createMemo");
  const canEditMemos = canCurrentUser("editMemo");
  const canAssociateMemoObjects = canCurrentUser("associateMemoObjects");

  // ── Raw loaded data ────────────────────────────────────────────────────────
  const [caseItems,    setCaseItems]    = useState<{ id: string; name: string }[]>([]);
  const [annItems,     setAnnItems]     = useState<AnnItem[]>([]);
  const [caseAttrDefs, setCaseAttrDefs] = useState<{ id: string; name: string }[]>([]);
  const [docAttrDefs,  setDocAttrDefs]  = useState<{ id: string; name: string }[]>([]);
  const [dataLoading,  setDataLoading]  = useState(true);

  // ── Selections (pre-filled from editRow when editing) ─────────────────────
  const [selCaseIds,        setSelCaseIds]        = useState<Set<string>>(
    () => new Set([...(editRow?.caseIds ?? []), ...(preselectedCaseIds ?? [])]),
  );
  const [selDocIds,         setSelDocIds]         = useState<Set<string>>(
    () => new Set([...(editRow?.documentIds ?? []), ...(preselectedDocumentIds ?? [])]),
  );
  const [selCodeIds,        setSelCodeIds]        = useState<Set<string>>(
    () => new Set([...(editRow?.codeIds ?? []), ...(preselectedCodeIds ?? [])]),
  );
  const [selAnnIds,         setSelAnnIds]         = useState<Set<string>>(
    () => new Set([...(editRow?.annotationIds ?? []), ...(preselectedAnnotationIds ?? [])]),
  );
  const [selCaseAttrDefIds, setSelCaseAttrDefIds] = useState<Set<string>>(
    () => new Set([...(editRow?.caseAttributeDefIds ?? []), ...(preselectedCaseAttributeDefIds ?? [])]),
  );
  const [selDocAttrDefIds,  setSelDocAttrDefIds]  = useState<Set<string>>(
    () => new Set([...(editRow?.documentAttributeDefIds ?? []), ...(preselectedDocumentAttributeDefIds ?? [])]),
  );

  // ── UI state ──────────────────────────────────────────────────────────────
  const [title,                setTitle]                = useState(editRow?.title ?? "");
  const [collapsed,            setCollapsed]            = useState<Set<string>>(() => {
    // All panels start collapsed; expand only those with pre-selected items
    const all = new Set(["cases", "documents", "codes", "annotations", "case_attr_defs", "doc_attr_defs"]);
    if ((editRow?.caseIds?.length          ?? 0) > 0 || (preselectedCaseIds?.length                  ?? 0) > 0) all.delete("cases");
    if ((editRow?.documentIds?.length      ?? 0) > 0 || (preselectedDocumentIds?.length              ?? 0) > 0) all.delete("documents");
    if ((editRow?.codeIds?.length          ?? 0) > 0 || (preselectedCodeIds?.length                  ?? 0) > 0) all.delete("codes");
    if ((editRow?.annotationIds?.length    ?? 0) > 0 || (preselectedAnnotationIds?.length            ?? 0) > 0) all.delete("annotations");
    if ((editRow?.caseAttributeDefIds?.length    ?? 0) > 0 || (preselectedCaseAttributeDefIds?.length    ?? 0) > 0) all.delete("case_attr_defs");
    if ((editRow?.documentAttributeDefIds?.length ?? 0) > 0 || (preselectedDocumentAttributeDefIds?.length ?? 0) > 0) all.delete("doc_attr_defs");
    return all;
  });
  const [expandedSummaryCards, setExpandedSummaryCards] = useState<Set<string>>(new Set());
  const [annCardCollapsed,     setAnnCardCollapsed]     = useState(true);
  const [saving,               setSaving]               = useState(false);
  const [error,                setError]                = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  // ── Load cases and annotations ─────────────────────────────────────────────
  useEffect(() => {
    if (!pb || !activeProject) return;
    setDataLoading(true);
    (async () => {
      try {
        const caseRecs = await pb.collection("cases").getFullList({
          filter: `project="${activeProject.id}"&&deleted_at=""`,
          sort: "name",
        });
        setCaseItems(caseRecs.map((r) => ({ id: r.id, name: r.name })));

        if (storeDocs.length > 0) {
          const annRecs = await pb.collection("annotations").getFullList({
            filter: `(${storeDocs.map((d) => `document="${d.id}"`).join(" || ")})&&deleted_at=""`,
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

        const [caseAttrDefRecs, docAttrDefRecs] = await Promise.all([
          pb.collection("case_attribute_definitions").getFullList({
            filter: `project="${activeProject.id}"&&deleted_at=""`, sort: "sort_order,created",
          }),
          pb.collection("document_attribute_definitions").getFullList({
            filter: `project="${activeProject.id}"&&deleted_at=""`, sort: "sort_order,created",
          }),
        ]);
        setCaseAttrDefs(caseAttrDefRecs.map((r) => ({ id: r.id, name: r.name })));
        setDocAttrDefs(docAttrDefRecs.map((r) => ({ id: r.id, name: r.name })));
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

  function toggleSummaryCard(key: string) {
    setExpandedSummaryCards((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
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
    if ((editRow && !canEditMemos) || (!editRow && !canCreateMemos)) return;
    setSaving(true);
    setError(null);
    try {
      const preservedCaseIds = editRow?.caseIds ?? preselectedCaseIds ?? [];
      const preservedDocumentIds = editRow?.documentIds ?? preselectedDocumentIds ?? [];
      const preservedCodeIds = editRow?.codeIds ?? preselectedCodeIds ?? [];
      const preservedAnnotationIds = editRow?.annotationIds ?? [];
      const preservedCaseAttributeDefIds = editRow?.caseAttributeDefIds ?? preselectedCaseAttributeDefIds ?? [];
      const preservedDocumentAttributeDefIds = editRow?.documentAttributeDefIds ?? preselectedDocumentAttributeDefIds ?? [];
      const data = {
        title:                   title.trim(),
        body:                    editorRef.current?.innerHTML ?? "",
        documentIds:             canAssociateMemoObjects ? [...selDocIds] : preservedDocumentIds,
        annotationIds:           canAssociateMemoObjects ? [...selAnnIds] : preservedAnnotationIds,
        caseIds:                 canAssociateMemoObjects ? [...selCaseIds] : preservedCaseIds,
        codeIds:                 canAssociateMemoObjects ? [...selCodeIds] : preservedCodeIds,
        caseAttributeDefIds:     canAssociateMemoObjects ? [...selCaseAttrDefIds] : preservedCaseAttributeDefIds,
        documentAttributeDefIds: canAssociateMemoObjects ? [...selDocAttrDefIds] : preservedDocumentAttributeDefIds,
      };
      if (editRow) {
        await updateMemo(editRow.id, data);
      } else {
        await addMemo({ ...data, createdBy: currentUser?.id });
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("analysisMemos.errors.saveFailed"));
      setSaving(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const isEdit = Boolean(editRow);

  return (
    <div className="view doc-detail-view">
      <div className="workspace-back-row">
        <button className="btn" onClick={onBack}>
          {backLabel ?? t("analysisMemos.actions.backToMemos")}
        </button>
      </div>
      <div className="case-detail-topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {error && <span style={{ fontSize: 12, color: "var(--color-danger)" }}>{error}</span>}
          <button
            className="btn btn--primary"
            onClick={handleSave}
            disabled={saving || !title.trim()}
          >
            {saving ? t("analysisMemos.statuses.saving") : isEdit ? t("analysisMemos.actions.saveChanges") : t("analysisMemos.actions.saveMemo")}
          </button>
        </div>
      </div>

      <div className="doc-detail-layout">

        {/* ── Left: associations ── */}
        <div className="doc-detail-left">
          {canAssociateMemoObjects ? (
            <>
          <p className="memo-assoc-label">{t("analysisMemos.editor.associateWith")}</p>

          {/* Cases */}
          <div className="case-card">
            <div className="memo-card-header" onClick={() => toggleSection("cases")}>
              <h3 className="case-card-title" style={{ margin: 0 }}>
                {t("analysisMemos.table.cases")}{selCaseIds.size > 0 ? ` (${selCaseIds.size})` : ""}
              </h3>
              <span className="codebook-collapse-icon">{collapsed.has("cases") ? "▶" : "▼"}</span>
            </div>
            {!collapsed.has("cases") && (
              <>
                {!dataLoading && caseItems.length > 0 && (
                  <div style={{ padding: "2px 14px 4px", display: "flex", gap: 8 }}>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => setSelCaseIds(new Set(caseItems.map(c => c.id)))}>{t("analysisMemos.actions.all")}</button>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => setSelCaseIds(new Set())}>{t("analysisMemos.actions.clear")}</button>
                  </div>
                )}
                <ul className="memo-sel-list">
                {dataLoading
                  ? <li className="memo-sel-empty">{t("analysisMemos.statuses.loading")}</li>
                  : caseItems.length === 0
                    ? <li className="memo-sel-empty">{t("analysisMemos.empty.noCases")}</li>
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
              </>
            )}
          </div>

          {/* Case Attributes */}
          <div className="case-card">
            <div className="memo-card-header" onClick={() => toggleSection("case_attr_defs")}>
              <h3 className="case-card-title" style={{ margin: 0 }}>
                {t("analysisMemos.editor.caseAttributes")}{selCaseAttrDefIds.size > 0 ? ` (${selCaseAttrDefIds.size})` : ""}
              </h3>
              <span className="codebook-collapse-icon">{collapsed.has("case_attr_defs") ? "▶" : "▼"}</span>
            </div>
            {!collapsed.has("case_attr_defs") && (
              <>
                {!dataLoading && caseAttrDefs.length > 0 && (
                  <div style={{ padding: "2px 14px 4px", display: "flex", gap: 8 }}>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => setSelCaseAttrDefIds(new Set(caseAttrDefs.map(d => d.id)))}>{t("analysisMemos.actions.all")}</button>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => setSelCaseAttrDefIds(new Set())}>{t("analysisMemos.actions.clear")}</button>
                  </div>
                )}
                <ul className="memo-sel-list">
                  {dataLoading
                    ? <li className="memo-sel-empty">{t("analysisMemos.statuses.loading")}</li>
                    : caseAttrDefs.length === 0
                      ? <li className="memo-sel-empty">{t("analysisMemos.empty.noCaseAttributes")}</li>
                      : caseAttrDefs.map((def) => (
                          <li
                            key={def.id}
                            className={`memo-sel-item${selCaseAttrDefIds.has(def.id) ? " memo-sel-item--checked" : ""}`}
                            onClick={() => toggle(selCaseAttrDefIds, setSelCaseAttrDefIds, def.id)}
                          >
                            <input
                              type="checkbox"
                              className="memo-sel-checkbox"
                              checked={selCaseAttrDefIds.has(def.id)}
                              onChange={() => toggle(selCaseAttrDefIds, setSelCaseAttrDefIds, def.id)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <span className="memo-sel-item-label">{def.name}</span>
                          </li>
                        ))
                  }
                </ul>
              </>
            )}
          </div>

          {/* Documents */}
          <div className="case-card">
            <div className="memo-card-header" onClick={() => toggleSection("documents")}>
              <h3 className="case-card-title" style={{ margin: 0 }}>
                {t("analysisMemos.table.documents")}{selDocIds.size > 0 ? ` (${selDocIds.size})` : ""}
              </h3>
              <span className="codebook-collapse-icon">{collapsed.has("documents") ? "▶" : "▼"}</span>
            </div>
            {!collapsed.has("documents") && (
              <>
                {storeDocs.length > 0 && (
                  <div style={{ padding: "2px 14px 4px", display: "flex", gap: 8 }}>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => setSelDocIds(new Set(storeDocs.map(d => d.id)))}>{t("analysisMemos.actions.all")}</button>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => setSelDocIds(new Set())}>{t("analysisMemos.actions.clear")}</button>
                  </div>
                )}
                <ul className="memo-sel-list">
                  {storeDocs.length === 0
                    ? <li className="memo-sel-empty">{t("analysisMemos.empty.noDocuments")}</li>
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
              </>
            )}
          </div>

          {/* Document Attributes */}
          <div className="case-card">
            <div className="memo-card-header" onClick={() => toggleSection("doc_attr_defs")}>
              <h3 className="case-card-title" style={{ margin: 0 }}>
                {t("analysisMemos.editor.documentAttributes")}{selDocAttrDefIds.size > 0 ? ` (${selDocAttrDefIds.size})` : ""}
              </h3>
              <span className="codebook-collapse-icon">{collapsed.has("doc_attr_defs") ? "▶" : "▼"}</span>
            </div>
            {!collapsed.has("doc_attr_defs") && (
              <>
                {!dataLoading && docAttrDefs.length > 0 && (
                  <div style={{ padding: "2px 14px 4px", display: "flex", gap: 8 }}>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => setSelDocAttrDefIds(new Set(docAttrDefs.map(d => d.id)))}>{t("analysisMemos.actions.all")}</button>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => setSelDocAttrDefIds(new Set())}>{t("analysisMemos.actions.clear")}</button>
                  </div>
                )}
                <ul className="memo-sel-list">
                  {dataLoading
                    ? <li className="memo-sel-empty">{t("analysisMemos.statuses.loading")}</li>
                    : docAttrDefs.length === 0
                      ? <li className="memo-sel-empty">{t("analysisMemos.empty.noDocumentAttributes")}</li>
                      : docAttrDefs.map((def) => (
                          <li
                            key={def.id}
                            className={`memo-sel-item${selDocAttrDefIds.has(def.id) ? " memo-sel-item--checked" : ""}`}
                            onClick={() => toggle(selDocAttrDefIds, setSelDocAttrDefIds, def.id)}
                          >
                            <input
                              type="checkbox"
                              className="memo-sel-checkbox"
                              checked={selDocAttrDefIds.has(def.id)}
                              onChange={() => toggle(selDocAttrDefIds, setSelDocAttrDefIds, def.id)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <span className="memo-sel-item-label">{def.name}</span>
                          </li>
                        ))
                  }
                </ul>
              </>
            )}
          </div>

          {/* Codes */}
          <div className="case-card">
            <div className="memo-card-header" onClick={() => toggleSection("codes")}>
              <h3 className="case-card-title" style={{ margin: 0 }}>
                {t("analysisMemos.table.codes")}{selCodeIds.size > 0 ? ` (${selCodeIds.size})` : ""}
              </h3>
              <span className="codebook-collapse-icon">{collapsed.has("codes") ? "▶" : "▼"}</span>
            </div>
            {!collapsed.has("codes") && (
              <>
                {codeTree.length > 0 && (
                  <div style={{ padding: "2px 14px 4px", display: "flex", gap: 8 }}>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => setSelCodeIds(new Set(codeTree.map(({ code }) => code.id)))}>{t("analysisMemos.actions.all")}</button>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => setSelCodeIds(new Set())}>{t("analysisMemos.actions.clear")}</button>
                  </div>
                )}
                <ul className="memo-sel-list">
                  {codeTree.length === 0
                    ? <li className="memo-sel-empty">{t("analysisMemos.empty.noCodes")}</li>
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
              </>
            )}
          </div>

          {/* Annotations */}
          <div className="case-card">
            <div className="memo-card-header" onClick={() => toggleSection("annotations")}>
              <h3 className="case-card-title" style={{ margin: 0 }}>
                {t("analysisMemos.detail.annotations")}{selAnnIds.size > 0 ? ` (${selAnnIds.size})` : ""}
              </h3>
              <span className="codebook-collapse-icon">{collapsed.has("annotations") ? "▶" : "▼"}</span>
            </div>
            {!collapsed.has("annotations") && (
              <>
                {annItems.length > 0 && (
                  <div style={{ padding: "2px 14px 4px", display: "flex", gap: 8 }}>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => setSelAnnIds(new Set(annItems.map(a => a.id)))}>{t("analysisMemos.actions.all")}</button>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => setSelAnnIds(new Set())}>{t("analysisMemos.actions.clear")}</button>
                  </div>
                )}
                <ul className="memo-sel-list">
                  {annItems.length === 0
                    ? <li className="memo-sel-empty">{t("analysisMemos.empty.noAnnotations")}</li>
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
              </>
            )}
          </div>
            </>
          ) : (
            <div className="case-card">
              <h3 className="case-card-title">{t("analysisMemos.editor.associations")}</h3>
              <p className="case-card-empty">
                {t("analysisMemos.editor.associationsReadOnly")}
              </p>
            </div>
          )}
        </div>

        {/* ── Right: title + body editor ── */}
        <div className="doc-detail-right">
          <div className="case-card" style={{ maxWidth: "none" }}>
            <h3 className="case-card-title">{isEdit ? t("analysisMemos.editor.editMemo") : t("analysisMemos.actions.newMemo")}</h3>
            <input
              className="form-input"
              placeholder={t("analysisMemos.editor.memoTitlePlaceholder")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div className="case-card" style={{ maxWidth: "none" }}>
            <h3 className="case-card-title">{t("analysisMemos.editor.memoDetails")}</h3>
            <dl className="user-detail-meta case-detail-meta">
              <dt>{t("analysisMemos.table.createdBy")}</dt>
              <dd>{isEdit ? editRow?.createdByName : (currentUser?.name || currentUser?.email || "—")}</dd>
              <dt>{t("analysisMemos.table.created")}</dt>
              <dd>{isEdit ? fmtDate(editRow?.createdAt ?? "") : t("analysisMemos.editor.notYetSaved")}</dd>
            </dl>
          </div>
          {(() => {
            const includedCases      = caseItems.filter((c) => selCaseIds.has(c.id));
            const includedCaseAttrs  = caseAttrDefs.filter((d) => selCaseAttrDefIds.has(d.id));
            const includedDocs       = storeDocs.filter((d) => selDocIds.has(d.id));
            const includedDocAttrs   = docAttrDefs.filter((d) => selDocAttrDefIds.has(d.id));
            const includedCodes      = codeTree
              .filter(({ code }) => selCodeIds.has(code.id))
              .map(({ code }) => ({ id: code.id, name: code.label, color: code.color }));

            const cards: { key: string; label: string; value: number; items: { id: string; name: string; color?: string }[]; expandable?: boolean }[] = [
              { key: "cases",      label: t("analysisMemos.table.cases"),               value: includedCases.length,     items: includedCases },
              { key: "case_attrs", label: t("analysisMemos.editor.caseAttributesShort"), value: includedCaseAttrs.length,  items: includedCaseAttrs },
              { key: "documents",  label: t("analysisMemos.table.documents"),           value: includedDocs.length,       items: includedDocs.map((d) => ({ id: d.id, name: d.name })) },
              { key: "doc_attrs",  label: t("analysisMemos.editor.documentAttributesShort"), value: includedDocAttrs.length,   items: includedDocAttrs },
              { key: "codes",      label: t("analysisMemos.table.codes"),               value: includedCodes.length,      items: includedCodes },
            ];

            return (
              <div style={{ display: "flex", gap: 10 }}>
                {cards.map(({ key, label, value, items, expandable = true }) => (
                  <button
                    key={key}
                    className="annotate-card"
                    onClick={expandable ? () => toggleSummaryCard(key) : undefined}
                    aria-expanded={expandable ? expandedSummaryCards.has(key) : undefined}
                    tabIndex={expandable ? undefined : -1}
                    style={{
                      flex: 1,
                      padding: "14px 10px",
                      textAlign: "center",
                      border: "var(--border-width) solid var(--color-border)",
                      background: "var(--color-surface)",
                      color: "var(--color-text)",
                      cursor: expandable ? "pointer" : "default",
                    }}
                  >
                    <div className="summary-card-value">{value}</div>
                    <div className="summary-card-label">
                      {label}
                      {expandable && (
                        <span style={{ marginLeft: 6, fontSize: 10, color: "var(--color-text-muted)" }}>
                          {expandedSummaryCards.has(key) ? "▾" : "▸"}
                        </span>
                      )}
                    </div>
                    {expandable && expandedSummaryCards.has(key) && (
                      <div style={{ marginTop: 10, paddingTop: 8, borderTop: "var(--border-width) solid var(--color-border)", maxHeight: 130, overflowY: "auto", textAlign: "left" }}>
                        {items.length === 0 ? (
                          <div style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center" }}>None.</div>
                        ) : (
                          items.map((item) => (
                            <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, lineHeight: 1.4, padding: "2px 0" }}>
                              {item.color && <span className="code-swatch" style={{ background: item.color, width: 9, height: 9, flexShrink: 0 }} />}
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            );
          })()}
          {(() => {
            const includedAnns = annItems.filter((a) => selAnnIds.has(a.id));
            return (
              <div className="case-card" style={{ maxWidth: "none" }}>
                <div
                  className="memo-card-header"
                  style={{ cursor: "pointer" }}
                  onClick={() => setAnnCardCollapsed((v) => !v)}
                >
                  <h3 className="case-card-title" style={{ margin: 0 }}>
                    {t("analysisMemos.detail.annotations")}{includedAnns.length > 0 ? ` (${includedAnns.length})` : ""}
                  </h3>
                  <span className="codebook-collapse-icon">{annCardCollapsed ? "▶" : "▼"}</span>
                </div>
                {!annCardCollapsed && (
                  includedAnns.length === 0
                    ? <p className="case-card-empty">{t("analysisMemos.detail.noAnnotationsAssociated")}</p>
                    : <ul className="memo-sel-list" style={{ marginTop: 4 }}>
                        {includedAnns.map((ann) => (
                          <li key={ann.id} className="memo-sel-item" style={{ borderRight: `3px solid ${ann.codeColor}`, paddingRight: 11, cursor: "default" }}>
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
                        ))}
                      </ul>
                )}
              </div>
            );
          })()}
          <div className="case-card doc-content-card">
            <h3 className="case-card-title">{t("analysisMemos.detail.body")}</h3>
            <RichTextEditor initialHtml={editRow?.body ?? ""} editorRef={editorRef} grow />
          </div>
        </div>

      </div>
    </div>
  );
}

// ─── Memo Detail sub-view ──────────────────────────────────────────────────────

function htmlToText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.innerText || div.textContent || "";
}

function escHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function ExportMemoModal({
  onClose,
  onExportHTML,
  onExportPDF,
  onExportDOCX,
  exportingFormat,
}: {
  onClose: () => void;
  onExportHTML: () => void;
  onExportPDF: () => void;
  onExportDOCX: () => void;
  exportingFormat: string | null;
}) {
  const { t } = useI18n();
  const options = [
    {
      key: "html",
      label: t("analysisMemos.export.htmlLabel"),
      description: t("analysisMemos.export.htmlDescription"),
      onClick: onExportHTML,
    },
    {
      key: "pdf",
      label: t("analysisMemos.export.pdfLabel"),
      description: t("analysisMemos.export.pdfDescription"),
      onClick: onExportPDF,
    },
    {
      key: "docx",
      label: t("analysisMemos.export.docxLabel"),
      description: t("analysisMemos.export.docxDescription"),
      onClick: onExportDOCX,
    },
  ] as const;

  return (
    <SettingsModal
      title={t("analysisMemos.export.title")}
      onClose={onClose}
      closeDisabled={!!exportingFormat}
      modalClassName="modal--wide"
    >
      <div className="app-settings-modal-body">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 12,
            alignItems: "stretch",
          }}
        >
          {options.map((option) => (
            <button
              key={option.key}
              className={`btn export-option-card${exportingFormat === option.key ? " export-option-card--active" : ""}`}
              onClick={option.onClick}
              disabled={!!exportingFormat}
              style={{
                minHeight: 220,
                padding: 18,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "space-between",
                textAlign: "center",
                whiteSpace: "normal",
                color: exportingFormat === option.key ? "#fff" : "var(--color-text)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>{option.label}</div>
                <div style={{ fontSize: 13, lineHeight: 1.5, color: exportingFormat === option.key ? "rgba(255,255,255,0.9)" : "var(--color-text-muted)" }}>
                  {option.description}
                </div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {exportingFormat === option.key ? "Exporting..." : `Export as ${option.label}`}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
        <button className="btn" onClick={onClose} disabled={!!exportingFormat}>{t("common.cancel")}</button>
      </div>
    </SettingsModal>
  );
}

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
  const { t } = useI18n();
  const { pb } = useStore();
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<string | null>(null);
  const [expandedSummaryCards, setExpandedSummaryCards] = useState<Set<string>>(new Set());
  const [annCardCollapsed,     setAnnCardCollapsed]     = useState(true);

  function toggleSummaryCard(key: string) {
    setExpandedSummaryCards((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const summaryCards = [
    { key: "cases",       label: t("analysisMemos.table.cases"), count: row.caseIds.length,                 names: row.cases,                    expandable: true },
    { key: "case_attrs",  label: t("analysisMemos.editor.caseAttributesShort"), count: row.caseAttributeDefIds.length,     names: row.caseAttributeDefNames,    expandable: true },
    { key: "documents",   label: t("analysisMemos.table.documents"), count: row.documentIds.length,             names: row.documents,                expandable: true },
    { key: "doc_attrs",   label: t("analysisMemos.editor.documentAttributesShort"), count: row.documentAttributeDefIds.length, names: row.documentAttributeDefNames, expandable: true },
    { key: "codes",       label: t("analysisMemos.table.codes"), count: row.codeIds.length,                 names: row.codes,                    expandable: true },
  ];

  async function handleExportHTML() {
    try {
      setExportingFormat("html");
      const path = await save({ defaultPath: `${row.title || t("analysisMemos.export.defaultFileStem")}.html`, filters: [{ name: "HTML", extensions: ["html"] }] });
      if (!path) return;

      // Fetch annotation details (quote, code name, document name)
      type AnnDetail = { id: string; quote: string; codeName: string; docName: string };

      const annRecords = row.annotationIds.length > 0
        ? await pb.collection("annotations").getFullList({
            filter: row.annotationIds.map((id) => `id="${id}"`).join("||"),
            expand: "code,document",
            fields: "id,quote,expand",
          })
        : [];

      const annDetails: AnnDetail[] = (annRecords as { id: string; quote?: string; expand?: { code?: { label?: string }; document?: { name?: string } } }[]).map((a) => ({
        id: a.id,
        quote: a.quote ?? "",
        codeName: a.expand?.code?.label ?? "—",
        docName:  a.expand?.document?.name ?? "—",
      }));

      function section(title: string, items: string[]): string {
        if (items.length === 0) return "";
        return `<section><h2>${escHtml(title)}</h2><ul>${items.map((s) => `<li>${escHtml(s)}</li>`).join("")}</ul></section>`;
      }

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escHtml(row.title)}</title>
<style>
  body { font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #222; }
  h1 { margin-bottom: 4px; }
  h2 { font-size: 1em; text-transform: uppercase; letter-spacing: .05em; color: #555; margin: 28px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  .meta { color: #666; font-size: .9em; margin-bottom: 20px; }
  ul { margin: 0; padding-left: 20px; }
  li { margin: 3px 0; line-height: 1.5; }
  .body { line-height: 1.7; margin-top: 28px; }
  .ann-quote { font-style: italic; color: #333; }
  .ann-meta { font-size: .85em; color: #666; }
  section { margin-bottom: 8px; }
</style>
</head>
<body>
<h1>${escHtml(row.title)}</h1>
<p class="meta">${escHtml(t("analysisMemos.export.createdBy", { name: row.createdByName }))} &middot; ${escHtml(t("analysisMemos.export.createdAt", { value: fmtDate(row.createdAt) }))}</p>
${section(t("analysisMemos.table.cases"), row.cases)}
${section(t("analysisMemos.export.caseAttributes"), row.caseAttributeDefNames)}
${section(t("analysisMemos.table.documents"), row.documents)}
${section(t("analysisMemos.export.documentAttributes"), row.documentAttributeDefNames)}
${section(t("analysisMemos.table.codes"), row.codes)}
${annDetails.length > 0 ? `<section><h2>${escHtml(t("analysisMemos.detail.annotations"))}</h2><ul>${annDetails.map((a) => `<li><span class="ann-quote">"${escHtml(a.quote)}"</span><br><span class="ann-meta">${escHtml(a.codeName)} &mdash; ${escHtml(a.docName)}</span></li>`).join("")}</ul></section>` : ""}
<div class="body">${row.body || ""}</div>
</body>
</html>`;
      await writeTextFile(path, html);
    } catch {
      /* ignore */
    } finally {
      setExportingFormat(null);
      setShowExportModal(false);
    }
  }

  async function handleExportPDF() {
    try {
      setExportingFormat("pdf");
      const path = await save({ defaultPath: `${row.title || t("analysisMemos.export.defaultFileStem")}.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (!path) return;

      const annRecords = row.annotationIds.length > 0
        ? await pb.collection("annotations").getFullList({
            filter: row.annotationIds.map((id) => `id="${id}"`).join("||"),
            expand: "code,document",
            fields: "id,quote,code,document,expand",
          })
        : [];
      type AnnDetail = { id: string; quote: string; codeName: string; docName: string };
      const annDetails: AnnDetail[] = (annRecords as { id: string; quote?: string; expand?: { code?: { label?: string }; document?: { name?: string } } }[]).map((a) => ({
        id: a.id,
        quote: a.quote ?? "",
        codeName: a.expand?.code?.label ?? "—",
        docName:  a.expand?.document?.name ?? "—",
      }));

      const { jsPDF } = await loadJsPdf();
      const pdf = new jsPDF({ unit: "pt", format: "letter" });
      const margin = 54;
      const pageH = pdf.internal.pageSize.getHeight();
      const contentWidth = pdf.internal.pageSize.getWidth() - margin * 2;
      let y = margin;
      const ensureSpace = (h: number) => { if (y + h > pageH - margin) { pdf.addPage(); y = margin; } };
      const addText = (text: string, size = 10, style: "normal" | "bold" | "italic" = "normal", gap = 8) => {
        pdf.setFont("helvetica", style);
        pdf.setFontSize(size);
        const lines = pdf.splitTextToSize(text || "", contentWidth) as string[];
        const lh = size * 1.35;
        ensureSpace(lines.length * lh + gap);
        pdf.text(lines, margin, y);
        y += lines.length * lh + gap;
      };
      const addSection = (title: string, items: string[]) => {
        if (items.length === 0) return;
        addText(title, 9, "bold", 4);
        for (const item of items) addText(`• ${item}`, 10, "normal", 3);
        y += 10;
      };

      addText(row.title || t("analysisMemos.export.untitledMemo"), 20, "bold", 6);
      addText(t("analysisMemos.export.createdBy", { name: row.createdByName }), 10, "normal", 2);
      addText(t("analysisMemos.export.createdAt", { value: fmtDate(row.createdAt) }), 10, "normal", 20);

      addSection(t("analysisMemos.table.cases"), row.cases);
      addSection(t("analysisMemos.export.caseAttributes"), row.caseAttributeDefNames);
      addSection(t("analysisMemos.table.documents"), row.documents);
      addSection(t("analysisMemos.export.documentAttributes"), row.documentAttributeDefNames);
      addSection(t("analysisMemos.table.codes"), row.codes);

      if (annDetails.length > 0) {
        addText(t("analysisMemos.detail.annotations"), 9, "bold", 4);
        for (const ann of annDetails) {
          addText(`"${ann.quote}"`, 10, "italic", 2);
          addText(`${ann.codeName} — ${ann.docName}`, 9, "normal", 6);
        }
        y += 10;
      }

      const bodyText = htmlToText(row.body || "");
      if (bodyText.trim()) {
        addText(t("analysisMemos.detail.body"), 9, "bold", 4);
        addText(bodyText, 11, "normal", 8);
      }

      const pdfBytes = pdf.output("arraybuffer");
      await writeFile(path, new Uint8Array(pdfBytes));
    } catch {
      /* ignore */
    } finally {
      setExportingFormat(null);
      setShowExportModal(false);
    }
  }

  async function handleExportDOCX() {
    try {
      setExportingFormat("docx");
      const path = await save({ defaultPath: `${row.title || t("analysisMemos.export.defaultFileStem")}.docx`, filters: [{ name: t("analysisMemos.export.wordDocument"), extensions: ["docx"] }] });
      if (!path) return;

      const annRecords = row.annotationIds.length > 0
        ? await pb.collection("annotations").getFullList({
            filter: row.annotationIds.map((id) => `id="${id}"`).join("||"),
            expand: "code,document",
            fields: "id,quote,code,document,expand",
          })
        : [];
      type AnnDetail = { id: string; quote: string; codeName: string; docName: string };
      const annDetails: AnnDetail[] = (annRecords as { id: string; quote?: string; expand?: { code?: { label?: string }; document?: { name?: string } } }[]).map((a) => ({
        id: a.id,
        quote: a.quote ?? "",
        codeName: a.expand?.code?.label ?? "—",
        docName:  a.expand?.document?.name ?? "—",
      }));

      function sectionParagraphs(title: string, items: string[]): Paragraph[] {
        if (items.length === 0) return [];
        return [
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: title })] }),
          ...items.map((item) => new Paragraph({ children: [new TextRun({ text: `• ${item}` })] })),
          new Paragraph({ children: [] }),
        ];
      }

      const bodyText = htmlToText(row.body || "");
      const bodyParagraphs = bodyText.split("\n").filter((l) => l.trim());

      const doc = new DocxDocument({
        sections: [{
          children: [
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: row.title || t("analysisMemos.export.untitledMemo") })] }),
            new Paragraph({ children: [new TextRun({ text: t("analysisMemos.export.createdBy", { name: row.createdByName }), color: "666666" })] }),
            new Paragraph({ children: [new TextRun({ text: t("analysisMemos.export.createdAt", { value: fmtDate(row.createdAt) }), color: "666666" })] }),
            new Paragraph({ children: [] }),
            ...sectionParagraphs(t("analysisMemos.table.cases"), row.cases),
            ...sectionParagraphs(t("analysisMemos.export.caseAttributes"), row.caseAttributeDefNames),
            ...sectionParagraphs(t("analysisMemos.table.documents"), row.documents),
            ...sectionParagraphs(t("analysisMemos.export.documentAttributes"), row.documentAttributeDefNames),
            ...sectionParagraphs(t("analysisMemos.table.codes"), row.codes),
            ...(annDetails.length > 0 ? [
              new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: t("analysisMemos.detail.annotations") })] }),
              ...annDetails.flatMap((ann) => [
                new Paragraph({ children: [new TextRun({ text: `"${ann.quote}"`, italics: true })] }),
                new Paragraph({ children: [new TextRun({ text: `${ann.codeName} — ${ann.docName}`, color: "666666" })] }),
                new Paragraph({ children: [] }),
              ]),
            ] : []),
            ...(bodyText.trim() ? [
              new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: t("analysisMemos.detail.body") })] }),
              ...bodyParagraphs.map((text) => new Paragraph({ children: [new TextRun({ text })] })),
            ] : []),
          ],
        }],
      });
      const buffer = await Packer.toBuffer(doc);
      await writeFile(path, new Uint8Array(buffer));
    } catch {
      /* ignore */
    } finally {
      setExportingFormat(null);
      setShowExportModal(false);
    }
  }

  return (
    <div className="view doc-detail-view">
      <div className="workspace-back-row">
        <button className="btn" onClick={onBack}>{t("analysisMemos.actions.backToMemos")}</button>
      </div>
      <div className="case-detail-topbar">
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => setShowExportModal(true)}>Export</button>
          <button
            className="btn btn--primary"
            onClick={onEdit}
            disabled={!canEdit}
            title={!canEdit ? "You do not have permission to edit this memo" : undefined}
          >
            Edit
          </button>
        </div>
      </div>

      {showExportModal && (
        <ExportMemoModal
          onClose={() => setShowExportModal(false)}
          onExportHTML={handleExportHTML}
          onExportPDF={handleExportPDF}
          onExportDOCX={handleExportDOCX}
          exportingFormat={exportingFormat}
        />
      )}

      <div className="doc-detail-layout">

        <div className="doc-detail-left" />

        <div className="doc-detail-right">

          <div className="case-card" style={{ maxWidth: "none" }}>
            <h3 className="case-card-title">{t("analysisMemos.detail.memo")}</h3>
            <p className="case-card-value">{row.title}</p>
          </div>

          <div className="case-card" style={{ maxWidth: "none" }}>
            <h3 className="case-card-title">{t("analysisMemos.editor.memoDetails")}</h3>
            <dl className="user-detail-meta case-detail-meta">
              <dt>{t("analysisMemos.table.createdBy")}</dt><dd>{row.createdByName}</dd>
              <dt>{t("analysisMemos.table.created")}</dt>  <dd>{fmtDate(row.createdAt)}</dd>
            </dl>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            {summaryCards.map(({ key, label, count, names, expandable }) => (
              <button
                key={key}
                className="annotate-card"
                onClick={expandable ? () => toggleSummaryCard(key) : undefined}
                aria-expanded={expandable ? expandedSummaryCards.has(key) : undefined}
                tabIndex={expandable ? undefined : -1}
                style={{
                  flex: 1,
                  padding: "14px 10px",
                  textAlign: "center",
                  border: "var(--border-width) solid var(--color-border)",
                  background: "var(--color-surface)",
                  color: "var(--color-text)",
                  cursor: expandable ? "pointer" : "default",
                }}
              >
                <div className="summary-card-value">{count}</div>
                <div className="summary-card-label">
                  {label}
                  {expandable && (
                    <span style={{ marginLeft: 6, fontSize: 10, color: "var(--color-text-muted)" }}>
                      {expandedSummaryCards.has(key) ? "▾" : "▸"}
                    </span>
                  )}
                </div>
                {expandable && expandedSummaryCards.has(key) && (
                  <div style={{ marginTop: 10, paddingTop: 8, borderTop: "var(--border-width) solid var(--color-border)", maxHeight: 130, overflowY: "auto", textAlign: "left" }}>
                    {names.length === 0 ? (
                      <div style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center" }}>None.</div>
                    ) : (
                      names.map((name, i) => (
                        <div key={i} style={{ fontSize: 12, lineHeight: 1.4, padding: "2px 0" }}>{name}</div>
                      ))
                    )}
                  </div>
                )}
              </button>
            ))}
          </div>

          <div className="case-card" style={{ maxWidth: "none" }}>
            <div
              className="memo-card-header"
              style={{ cursor: "pointer" }}
              onClick={() => setAnnCardCollapsed((v) => !v)}
            >
              <h3 className="case-card-title" style={{ margin: 0 }}>
                {t("analysisMemos.detail.annotations")}{row.annotationDetails.length > 0 ? ` (${row.annotationDetails.length})` : ""}
              </h3>
              <span className="codebook-collapse-icon">{annCardCollapsed ? "▶" : "▼"}</span>
            </div>
            {!annCardCollapsed && (
              row.annotationDetails.length === 0
                ? <p className="case-card-empty">{t("analysisMemos.detail.noAnnotationsAssociated")}</p>
                : <ul className="memo-sel-list" style={{ marginTop: 4 }}>
                    {row.annotationDetails.map((ann) => (
                      <li key={ann.id} className="memo-sel-item" style={{ borderRight: `3px solid ${ann.codeColor}`, paddingRight: 11, cursor: "default" }}>
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
                    ))}
                  </ul>
            )}
          </div>

          <div className="case-card doc-content-card">
            <h3 className="case-card-title">{t("analysisMemos.detail.body")}</h3>
            {row.body
              ? <div className="case-notes-body" dangerouslySetInnerHTML={{ __html: row.body }} />
              : <p className="case-card-empty">{t("analysisMemos.detail.noBodyText")}</p>}
          </div>

        </div>

      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function MemosView() {
  const { t } = useI18n();
  const {
    activeProject,
    pb,
    canCurrentUser,
    pendingMemoId,
    setPendingMemoId,
    pendingNewMemoContext,
    setPendingNewMemoContext,
    deleteMemo,
  } = useStore();
  const canCreateMemos = canCurrentUser("createMemo");
  const canEditMemos = canCurrentUser("editMemo");
  const canDeleteMemos = canCurrentUser("deleteMemo");

  const [rows,    setRows]    = useState<MemoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const [sortCol, setSortCol] = useState<SortCol>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [contextMenu,   setContextMenu]   = useState<{ x: number; y: number; row: MemoRow } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuStyle = useViewportContextMenuStyle(contextMenu, contextMenuRef);
  const [helpOpen, setHelpOpen] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<MemoRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const localizedCols = [
    { ...COLS[0], label: t("analysisMemos.table.name") },
    { ...COLS[1], label: t("analysisMemos.table.createdBy") },
    { ...COLS[2], label: t("analysisMemos.table.created") },
    { ...COLS[3], label: t("analysisMemos.table.cases") },
    { ...COLS[4], label: t("analysisMemos.table.documents") },
    { ...COLS[5], label: t("analysisMemos.table.codes") },
  ];

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
        filter: `project="${activeProject.id}"&&deleted_at=""`,
        expand: "created_by,document,annotation.code,annotation.document,cases,codes,case_attribute_defs,document_attribute_defs",
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

          const docExpands      = toArr(r.expand?.document);
          const caseExpands     = toArr(r.expand?.cases);
          const codeExpands     = toArr(r.expand?.codes);
          const caseAttrExpands = toArr(r.expand?.case_attribute_defs);
          const docAttrExpands  = toArr(r.expand?.document_attribute_defs);
          const annExpands      = toArr(r.expand?.annotation);

          const docIds         = toArr<string>(r.document);
          const annIds         = toArr<string>(r.annotation);
          const caseIds        = toArr<string>(r.cases);
          const codeIds        = toArr<string>(r.codes);
          const caseAttrDefIds = toArr<string>(r.case_attribute_defs);
          const docAttrDefIds  = toArr<string>(r.document_attribute_defs);

          return {
            id:                         r.id,
            title:                      r.title,
            body:                       r.body ?? "",
            createdByName:              cb?.name || cb?.email || "—",
            createdAt:                  r.created,
            cases:                      caseExpands.map((c: { name?: string }) => c.name ?? "—"),
            documents:                  docExpands.map((d: { name?: string }) => d.name ?? "—"),
            codes:                      codeExpands.map((c: { label?: string }) => c.label ?? "—"),
            caseIds,
            documentIds:                docIds,
            codeIds,
            annotationIds:              annIds,
            caseAttributeDefIds:        caseAttrDefIds,
            documentAttributeDefIds:    docAttrDefIds,
            caseAttributeDefNames:      caseAttrExpands.map((d: { name?: string }) => d.name ?? "—"),
            documentAttributeDefNames:  docAttrExpands.map((d: { name?: string }) => d.name ?? "—"),
            annotationDetails:          annExpands.map((a: { id?: string; quote?: string; expand?: { code?: { label?: string; color?: string }; document?: { name?: string } } }) => ({
              id:        a.id ?? "",
              quote:     a.quote ?? "",
              docId:     "",
              codeId:    "",
              codeName:  a.expand?.code?.label    ?? "—",
              codeColor: a.expand?.code?.color    ?? "#888888",
              docName:   a.expand?.document?.name ?? "—",
            })),
          };
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("analysisMemos.errors.loadFailed"));
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

  useEffect(() => {
    if (!pendingNewMemoContext) return;
    setSelectedRowId(null);
    setEditorRowId(null);
    setShowNewEditor(true);
  }, [pendingNewMemoContext]);

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
      setError(e instanceof Error ? e.message : t("analysisMemos.errors.deleteFailed"));
      setConfirmDelete(null);
    } finally {
      setDeleteLoading(false);
    }
  }

  // ── Sub-views ─────────────────────────────────────────────────────────────

  if (showNewEditor) {
    return (
      <MemoEditorView
        preselectedAnnotationIds={pendingNewMemoContext?.annotationIds}
        onSaved={() => {
          setShowNewEditor(false);
          setPendingNewMemoContext(null);
          loadMemos();
        }}
        onBack={() => {
          setShowNewEditor(false);
          setPendingNewMemoContext(null);
        }}
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
        canEdit={canEditMemos}
        onBack={() => { setSelectedRowId(null); loadMemos(); }}
        onEdit={() => setEditorRowId(selectedRowId)}
      />
    );
  }

  // ── Table ─────────────────────────────────────────────────────────────────

  return (
    <div className="view users-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>{t("analysisMemos.pageTitle")}</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            aria-label={t("analysisMemos.showHelp")}
            title={t("analysisMemos.showHelp")}
            onClick={() => setHelpOpen(true)}
          >
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
        <button
          className="btn btn--primary"
          onClick={() => setShowNewEditor(true)}
          disabled={!canCreateMemos}
          title={!canCreateMemos ? t("analysisMemos.permissions.cannotCreateMemos") : undefined}
        >
          {t("analysisMemos.actions.newMemo")}
        </button>
      </header>

      {error && <p className="users-error">{error}</p>}

      <div className="users-content">
        <section className="users-layout-main">
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
                  {localizedCols.map((col) => (
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
                  <tr><td colSpan={6} className="users-td-msg">{t("analysisMemos.statuses.loading")}</td></tr>
                )}
                {!loading && sorted.length === 0 && (
                  <tr><td colSpan={6} className="users-td-msg">{t("analysisMemos.empty.noMemos")}</td></tr>
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
        </section>
      </div>

      {helpOpen && (
        <SettingsModal title={t("analysisMemos.help.title")} onClose={() => setHelpOpen(false)} modalClassName="modal--help">
          <div className="app-settings-modal-body">
            <p className="users-guide-copy">
              {t("analysisMemos.help.line1")}
            </p>
            <p className="users-guide-copy">
              {t("analysisMemos.help.line2")}
            </p>
            <p className="users-guide-copy">
              {t("analysisMemos.help.line3")}
            </p>
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>
              {t("common.close")}
            </button>
          </div>
        </SettingsModal>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={contextMenuStyle}
        >
          {canEditMemos && (
            <button
              className="context-menu-item"
              onClick={() => { setEditorRowId(contextMenu.row.id); setContextMenu(null); }}
            >
              {t("analysisMemos.actions.editMemo")}
            </button>
          )}
          {canDeleteMemos && (
            <button
              className="context-menu-item context-menu-item--danger"
              onClick={() => { setConfirmDelete(contextMenu.row); setContextMenu(null); }}
            >
              {t("analysisMemos.actions.deleteMemo")}
            </button>
          )}
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <SettingsModal
          title={t("analysisMemos.deleteModal.title")}
          onClose={() => setConfirmDelete(null)}
          closeDisabled={deleteLoading}
        >
          <div className="app-settings-modal-body">
            <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
              {t("analysisMemos.deleteModal.body", { title: confirmDelete.title })}
            </p>
            <p className="modal-warning-text">
              {t("analysisMemos.deleteModal.warning")}
            </p>
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button className="btn" onClick={() => setConfirmDelete(null)} disabled={deleteLoading}>
              {t("common.cancel")}
            </button>
            <button className="btn btn--danger" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading ? t("analysisMemos.statuses.deleting") : t("analysisMemos.actions.deleteMemo")}
            </button>
          </div>
        </SettingsModal>
      )}
    </div>
  );
}
