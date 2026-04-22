import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useStore } from "../context/StoreContext";
import { useAuth } from "../context/AuthContext";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile, writeFile } from "@tauri-apps/plugin-fs";
import { Document as DocxDocument, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { jsPDF } from "jspdf";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnnItem {
  id: string;
  quote: string;
  note: string;
  documentId: string;
  documentName: string;
  codeId: string;
  codeName: string;
  codeColor: string;
  startOffset: number;
  endOffset: number;
  createdById: string;
}

interface CaseItem { id: string; name: string; }
interface UserItem { id: string; name: string; }
interface CaseDocumentLink { caseId: string; documentId: string; }
interface SummaryItem { id: string; name: string; color?: string; }

interface ReportSnapshot {
  reportType?: "annotations";
  filteredAnns: AnnItem[];
  caseItems: CaseItem[];
  userItems: UserItem[];
  caseDocLinks?: CaseDocumentLink[];
  summaryCounts: { cases: number; docs: number; codes: number; users: number };
  description?: string;
}

function hasDescriptionContent(html: string | undefined): boolean {
  if (!html) return false;
  return html.replace(/<[^>]*>/g, "").trim().length > 0;
}

interface ReportSettings {
  caseIds: string[];
  documentIds: string[];
  codeIds: string[];
}

interface ReportRow {
  id: string;
  name: string;
  createdByName: string;
  createdAt: string;
  caseIds: string[];
  documentIds: string[];
  codeIds: string[];
  snapshot?: ReportSnapshot;
}

type SortCol = "name" | "createdByName" | "createdAt";
type SortDir = "asc" | "desc";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
}

function toArr<T>(v: T | T[] | undefined | null): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function htmlToPlainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent?.replace(/\s+\n/g, "\n").trim() ?? "";
}

// ─── Column definitions ───────────────────────────────────────────────────────

const COLS: { key: SortCol; label: string; width: string }[] = [
  { key: "name",          label: "Name",       width: "40%" },
  { key: "createdByName", label: "Created By", width: "28%" },
  { key: "createdAt",     label: "Created",    width: "32%" },
];

// ─── Export Modal ─────────────────────────────────────────────────────────────

function ExportModal({
  onClose,
  onExportHTML,
  onExportPDF,
  onExportDOCX,
  onExportCSV,
  exportingFormat,
}: {
  onClose: () => void;
  onExportHTML: () => void;
  onExportPDF: () => void;
  onExportDOCX: () => void;
  onExportCSV: () => void;
  exportingFormat: string | null;
}) {
  return (
    <div className="modal-overlay" onClick={onClose} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "var(--color-bg)", padding: 24, borderRadius: 8, minWidth: 320 }}>
        <h2 style={{ marginTop: 0, marginBottom: 16 }}>Export Report</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button className="btn btn--primary" onClick={onExportHTML} disabled={!!exportingFormat}>
            {exportingFormat === "html" ? "Exporting..." : "Export as HTML"}
          </button>
          <button className="btn btn--primary" onClick={onExportPDF} disabled={!!exportingFormat}>
            {exportingFormat === "pdf" ? "Exporting..." : "Export as PDF"}
          </button>
          <button className="btn btn--primary" onClick={onExportDOCX} disabled={!!exportingFormat}>
            {exportingFormat === "docx" ? "Exporting..." : "Export as DOCX"}
          </button>
          <button className="btn btn--primary" onClick={onExportCSV} disabled={!!exportingFormat}>
            {exportingFormat === "csv" ? "Exporting..." : "Export as CSV"}
          </button>
        </div>
        <div style={{ marginTop: 16, textAlign: "right" }}>
          <button className="btn" onClick={onClose} disabled={!!exportingFormat}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Report page ──────────────────────────────────────────────────────────────

function ReportPage({
  row,
  isNew,
  initialSettings,
  onSaved,
  onBack,
  onUseSettings,
}: {
  row?: ReportRow;
  isNew?: boolean;
  initialSettings?: ReportSettings;
  onSaved: (id?: string) => void;
  onBack: () => void;
  onUseSettings?: (settings: ReportSettings) => void;
}) {
  const { pb, activeProject, documents: storeDocs, codes: storeCodes, createCodeReport } = useStore();
  const { user: currentUser } = useAuth();

  const isFrozen = !!row;

  const [name,   setName]   = useState(row?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  const [showExportModal, setShowExportModal] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<string | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  // Filter selections — for new reports these are interactive; for frozen just display
  const [selCaseIds,  setSelCaseIds]  = useState<Set<string>>(() => new Set(row?.caseIds  ?? initialSettings?.caseIds  ?? []));
  const [selDocIds,   setSelDocIds]   = useState<Set<string>>(() => new Set(row?.documentIds ?? initialSettings?.documentIds ?? []));
  const [selCodeIds,  setSelCodeIds]  = useState<Set<string>>(() => new Set(row?.codeIds  ?? initialSettings?.codeIds  ?? []));
  const [selUserIds,  setSelUserIds]  = useState<Set<string>>(new Set());
  const [collapsed,   setCollapsed]   = useState<Set<string>>(new Set());
  const [expandedSummaryCards, setExpandedSummaryCards] = useState<Set<string>>(new Set());

  // Report display options (functional even on frozen reports)
  const [showContext,     setShowContext]     = useState(false);
  const [contextChars,    setContextChars]    = useState(100);
  const [showCoverage,    setShowCoverage]    = useState(false);
  const frozenDescription = row?.snapshot?.description;
  const [showDescription, setShowDescription] = useState(() =>
    isFrozen ? hasDescriptionContent(frozenDescription) : false
  );

  const editor = useEditor({
    extensions: [StarterKit],
    editorProps: { attributes: { class: "report-description-editor" } },
    editable: !isFrozen,
  });

  // Load frozen description into the editor once it's ready
  useEffect(() => {
    if (isFrozen && editor && frozenDescription && !editor.isDestroyed) {
      editor.commands.setContent(frozenDescription);
    }
  }, [isFrozen, editor, frozenDescription]);

  // Live data (only used for new reports)
  const [caseItems,     setCaseItems]     = useState<CaseItem[]>([]);
  const [userItems,     setUserItems]     = useState<UserItem[]>([]);
  const [caseDocLinks,  setCaseDocLinks]  = useState<CaseDocumentLink[]>([]);
  const [allAnns,       setAllAnns]       = useState<AnnItem[]>([]);
  const [docContentMap, setDocContentMap] = useState<Map<string, string>>(new Map());
  const [dataLoading,   setDataLoading]   = useState(!isFrozen);

  // For frozen reports, pull data from the snapshot
  const frozenAnns      = row?.snapshot?.filteredAnns  ?? [];
  const frozenCaseItems = row?.snapshot?.caseItems     ?? [];
  const frozenUserItems = row?.snapshot?.userItems     ?? [];
  const frozenCaseDocLinks = row?.snapshot?.caseDocLinks ?? [];
  const frozenCounts    = row?.snapshot?.summaryCounts;

  useEffect(() => {
    if (!isFrozen) return;
    setUserItems(frozenUserItems);
    setCaseItems(frozenCaseItems);
    setCaseDocLinks(frozenCaseDocLinks);
  }, [isFrozen, row?.id]);

  useEffect(() => {
    if (!isFrozen || !pb || frozenCaseDocLinks.length > 0 || !row?.caseIds.length) return;
    let cancelled = false;
    (async () => {
      try {
        const links = await pb.collection("case_documents").getFullList({
          filter: row.caseIds.map((caseId) => `case="${caseId}"`).join(" || "),
        });
        if (!cancelled) {
          setCaseDocLinks(links.map((r) => ({ caseId: r.case, documentId: r.document })));
        }
      } catch {
        if (!cancelled) setCaseDocLinks([]);
      }
    })();
    return () => { cancelled = true; };
  }, [isFrozen, pb, row?.id, frozenCaseDocLinks.length]);

  useEffect(() => {
    if (isFrozen || !pb || !activeProject) return;
    setDataLoading(true);
    (async () => {
      try {
        const caseRecs = await pb.collection("cases").getFullList({ filter: `project="${activeProject.id}"&&deleted_at=""`, sort: "name" });
        setCaseItems(caseRecs.map((r) => ({ id: r.id, name: r.name })));

        const memberRecs = await pb.collection("project_members").getFullList({
          filter: `project="${activeProject.id}"`, expand: "user",
        });
        setUserItems(
          memberRecs
            .map((r) => { const u = r.expand?.user; return u ? { id: u.id, name: u.name || u.email || "Unknown" } : null; })
            .filter(Boolean) as UserItem[],
        );

        if (caseRecs.length > 0) {
          const cdRecs = await pb.collection("case_documents").getFullList({
            filter: caseRecs.map((c) => `case="${c.id}"`).join(" || "),
          });
          setCaseDocLinks(cdRecs.map((r) => ({ caseId: r.case, documentId: r.document })));
        }

        if (storeDocs.length > 0) {
          const annRecs = await pb.collection("annotations").getFullList({
            filter: `(${storeDocs.map((d) => `document="${d.id}"`).join(" || ")})&&deleted_at=""`,
            expand: "code,document,created_by",
          });
          const contentMap = new Map<string, string>();
          for (const r of annRecs) {
            const doc = r.expand?.document;
            if (doc && typeof doc.content === "string" && !contentMap.has(doc.id))
              contentMap.set(doc.id, doc.content);
          }
          setDocContentMap(contentMap);
          setAllAnns(annRecs.map((r) => ({
            id:           r.id,
            quote:        r.quote,
            note:         r.note ?? "",
            documentId:   r.document,
            documentName: r.expand?.document?.name ?? "—",
            codeId:       r.code,
            codeName:     r.expand?.code?.label ?? "—",
            codeColor:    r.expand?.code?.color ?? "#888888",
            startOffset:  r.start_offset ?? 0,
            endOffset:    r.end_offset   ?? 0,
            createdById:  r.created_by   ?? "",
          })));
        }
      } catch (e) {
        console.error(e);
      } finally {
        setDataLoading(false);
      }
    })();
  }, [pb, activeProject, storeDocs, isFrozen]);

  const caseDocMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const { caseId, documentId } of caseDocLinks) {
      if (!map.has(caseId)) map.set(caseId, new Set());
      map.get(caseId)!.add(documentId);
    }
    return map;
  }, [caseDocLinks]);

  const caseFilterDocIds = useMemo(() => {
    if (selCaseIds.size === 0) return null;
    const ids = new Set<string>();
    for (const cId of selCaseIds)
      for (const dId of (caseDocMap.get(cId) ?? [])) ids.add(dId);
    return ids;
  }, [selCaseIds, caseDocMap]);

  const filteredAnns = useMemo(() => {
    if (isFrozen) return frozenAnns;
    return allAnns.filter((ann) => {
      if (caseFilterDocIds !== null && !caseFilterDocIds.has(ann.documentId)) return false;
      if (selDocIds.size  > 0 && !selDocIds.has(ann.documentId))  return false;
      if (selCodeIds.size > 0 && !selCodeIds.has(ann.codeId))     return false;
      if (selUserIds.size > 0 && !selUserIds.has(ann.createdById)) return false;
      return true;
    });
  }, [isFrozen, frozenAnns, allAnns, caseFilterDocIds, selDocIds, selCodeIds, selUserIds]);

  const coverageStats = useMemo(() => {
    const empty = { rows: [] as { codeName: string; codeColor: string; chars: number; pct: number }[], totalChars: 0 };
    if (!showCoverage || isFrozen) return empty;
    const activeDocs = selDocIds.size > 0 ? storeDocs.filter((d) => selDocIds.has(d.id)) : storeDocs;
    const totalChars = activeDocs.reduce((sum, d) => sum + (docContentMap.get(d.id)?.length ?? 0), 0);
    if (totalChars === 0) return empty;
    const visibleCodes = selCodeIds.size > 0 ? storeCodes.filter((c) => selCodeIds.has(c.id)) : storeCodes;
    const byCode = new Map<string, { codeName: string; codeColor: string; chars: number }>();
    for (const c of visibleCodes) byCode.set(c.id, { codeName: c.label, codeColor: c.color, chars: 0 });
    for (const ann of filteredAnns) {
      const entry = byCode.get(ann.codeId);
      if (entry) entry.chars += Math.max(0, ann.endOffset - ann.startOffset);
    }
    const rows = Array.from(byCode.values())
      .map(({ codeName, codeColor, chars }) => ({ codeName, codeColor, chars, pct: (chars / totalChars) * 100 }))
      .filter((r) => r.pct > 0)
      .sort((a, b) => b.pct - a.pct);
    return { rows, totalChars };
  }, [showCoverage, isFrozen, filteredAnns, selDocIds, selCodeIds, storeDocs, storeCodes, docContentMap]);

  function togglePanel(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleSummaryCard(key: string) {
    setExpandedSummaryCards((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggle(set: Set<string>, setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  }

  async function handleSave() {
    if (!activeProject || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const descHtml = editor?.getHTML();
      const snapshot: ReportSnapshot = {
        reportType: "annotations",
        filteredAnns,
        caseItems,
        userItems,
        caseDocLinks,
        description: hasDescriptionContent(descHtml) ? descHtml : undefined,
        summaryCounts: {
          cases: selCaseIds.size > 0 ? selCaseIds.size : caseItems.length,
          docs:  selDocIds.size  > 0 ? selDocIds.size  : storeDocs.length,
          codes: selCodeIds.size > 0 ? selCodeIds.size : storeCodes.length,
          users: selUserIds.size > 0 ? selUserIds.size : userItems.length,
        },
      };
      const record = await createCodeReport({
        name:        name.trim(),
        caseIds:     [...selCaseIds],
        documentIds: [...selDocIds],
        codeIds:     [...selCodeIds],
        createdBy:   currentUser?.id,
        snapshot:    JSON.stringify(snapshot),
      });
      onSaved(record?.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save report.");
      setSaving(false);
    }
  }

  // Summary counts — from snapshot for frozen, derived for live
  const caseCount = frozenCounts?.cases ?? (selCaseIds.size > 0 ? selCaseIds.size : (isFrozen ? frozenCaseItems.length : caseItems.length));
  const docCount  = frozenCounts?.docs  ?? (selDocIds.size  > 0 ? selDocIds.size  : storeDocs.length);
  const codeCount = frozenCounts?.codes ?? (selCodeIds.size > 0 ? selCodeIds.size : storeCodes.length);
  const userCount = frozenCounts?.users ?? (selUserIds.size > 0 ? selUserIds.size : (isFrozen ? frozenUserItems.length : userItems.length));

  const displayCaseItems = isFrozen ? frozenCaseItems : caseItems;
  const displayUserItems = isFrozen ? frozenUserItems : userItems;

  const uniqueByName = (items: { id: string; name: string }[]) => {
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = `${item.id}:${item.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const includedCaseItems = selCaseIds.size > 0
    ? displayCaseItems.filter((item) => selCaseIds.has(item.id))
    : displayCaseItems;

  const includedDocumentItems = (() => {
    const selected = selDocIds.size > 0
      ? storeDocs.filter((doc) => selDocIds.has(doc.id))
      : storeDocs;
    if (selected.length > 0 || !isFrozen) {
      return selected.map((doc) => ({ id: doc.id, name: doc.name }));
    }
    return uniqueByName(filteredAnns.map((ann) => ({ id: ann.documentId, name: ann.documentName })));
  })();

  const includedCodeItems = (() => {
    const selected = selCodeIds.size > 0
      ? storeCodes.filter((code) => selCodeIds.has(code.id))
      : storeCodes;
    if (selected.length > 0 || !isFrozen) {
      return selected.map((code) => ({ id: code.id, name: code.label, color: code.color }));
    }
    const seen = new Set<string>();
    return filteredAnns
      .filter((ann) => {
        if (seen.has(ann.codeId)) return false;
        seen.add(ann.codeId);
        return true;
      })
      .map((ann) => ({ id: ann.codeId, name: getCodeName(ann), color: ann.codeColor }));
  })();

  const includedUserItems = selUserIds.size > 0
    ? displayUserItems.filter((item) => selUserIds.has(item.id))
    : displayUserItems;

  const summaryCards: { key: string; label: string; value: number; items: SummaryItem[] }[] = [
    { key: "cases", label: "Cases", value: caseCount, items: includedCaseItems },
    { key: "documents", label: "Documents", value: docCount, items: includedDocumentItems },
    { key: "codes", label: "Codes", value: codeCount, items: includedCodeItems },
    { key: "users", label: "Users", value: userCount, items: includedUserItems },
  ];

  function getCoderName(userId: string): string {
    return displayUserItems.find((u) => u.id === userId)?.name || "Unknown";
  }

  function getCodeName(ann: AnnItem): string {
    return ann.codeName || storeCodes.find((code) => code.id === ann.codeId)?.label || "Unknown";
  }

  function getCaseNameForAnn(ann: AnnItem): string {
    for (const [caseId, documentIds] of caseDocMap.entries()) {
      if (documentIds.has(ann.documentId)) {
        return displayCaseItems.find((c) => c.id === caseId)?.name ?? "Unassigned";
      }
    }
    if (selCaseIds.size === 1) {
      const [caseId] = [...selCaseIds];
      return displayCaseItems.find((c) => c.id === caseId)?.name ?? "Unassigned";
    }
    return "Unassigned";
  }

  function getExportDescriptionHtml(): string {
    if (isFrozen) return frozenDescription ?? "";
    const html = editor?.getHTML() ?? "";
    return hasDescriptionContent(html) ? html : "";
  }

  function getCleanReportHtml(): string {
    const title = name || "Untitled Report";
    const createdBy = row ? row.createdByName : (currentUser?.name || currentUser?.email || "Unknown");
    const createdAt = row ? fmtDate(row.createdAt) : fmtDate(new Date().toISOString());
    const descriptionHtml = getExportDescriptionHtml();
    const annotationHtml = filteredAnns.length === 0
      ? `<p class="muted">No annotations were captured in this report.</p>`
      : filteredAnns.map((ann) => `
          <section class="annotation">
            <div class="annotation-meta">
              <span class="code" style="background-color:${escapeHtml(ann.codeColor)}">${escapeHtml(ann.codeName)}</span>
              <span>${escapeHtml(ann.documentName)}</span>
              <span>${escapeHtml(getCoderName(ann.createdById))}</span>
              <span>${escapeHtml(getCaseNameForAnn(ann))}</span>
            </div>
            <blockquote>${escapeHtml(ann.quote)}</blockquote>
            ${ann.note ? `<p class="note"><strong>Note:</strong> ${escapeHtml(ann.note)}</p>` : ""}
          </section>
        `).join("");

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: Aptos, Calibri, Arial, sans-serif; color: #1f2933; line-height: 1.45; }
      h1 { font-size: 26px; margin: 0 0 8px; }
      h2 { font-size: 18px; margin: 24px 0 8px; border-bottom: 1px solid #d5dbe3; padding-bottom: 4px; }
      .muted { color: #687385; }
      .details, .summary { width: 100%; border-collapse: collapse; margin: 12px 0 18px; }
      .details td, .summary td, .summary th { border: 1px solid #d5dbe3; padding: 7px 9px; vertical-align: top; }
      .summary th { background: #eef2f6; text-align: left; }
      .description { margin: 10px 0 18px; }
      .annotation { border-top: 1px solid #d5dbe3; padding: 13px 0; page-break-inside: avoid; }
      .annotation-meta { color: #687385; font-size: 12px; margin-bottom: 7px; }
      .annotation-meta span { margin-right: 10px; }
      .code { color: #fff; border-radius: 4px; padding: 2px 6px; font-weight: 700; }
      blockquote { margin: 7px 0; padding-left: 12px; border-left: 3px solid #b7c1ce; }
      .note { margin: 7px 0 0; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    <table class="details">
      <tr><td><strong>Created by</strong></td><td>${escapeHtml(createdBy)}</td></tr>
      <tr><td><strong>Created</strong></td><td>${escapeHtml(createdAt)}</td></tr>
    </table>
    ${descriptionHtml ? `<h2>Description</h2><div class="description">${descriptionHtml}</div>` : ""}
    <h2>Summary</h2>
    <table class="summary">
      <tr><th>Cases</th><th>Documents</th><th>Codes</th><th>Users</th><th>Annotations</th></tr>
      <tr><td>${caseCount}</td><td>${docCount}</td><td>${codeCount}</td><td>${userCount}</td><td>${filteredAnns.length}</td></tr>
    </table>
    <h2>Annotations</h2>
    ${annotationHtml}
  </body>
</html>`;
  }

  async function handleExportCSV() {
    try {
      setExportingFormat("csv");
      const path = await save({ defaultPath: `${name || "Report"}.csv`, filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (!path) return;
      
      const header = ["Case", "Document", "Coder", "Code", "Quote", "Note"];
      const rows = filteredAnns.map((ann) => {
        let caseName = "—";
        for (const [cId, dIds] of caseDocMap.entries()) {
          if (dIds.has(ann.documentId)) {
            const cItem = displayCaseItems.find(c => c.id === cId);
            if (cItem) { caseName = cItem.name; break; }
          }
        }
        const coderName = userItems.find(u => u.id === ann.createdById)?.name || "—";
        return [
          caseName,
          ann.documentName,
          coderName,
          getCodeName(ann),
          ann.quote,
          ann.note
        ].map(col => `"${col.replace(/"/g, '""')}"`).join(",");
      });
      const csv = [header.join(","), ...rows].join("\n");
      await writeTextFile(path, csv);
    } catch (e) {
      setError("CSV export failed.");
    } finally {
      setExportingFormat(null);
      setShowExportModal(false);
    }
  }

  function getHtmlContent() {
    return getCleanReportHtml();
  }

  async function handleExportHTML() {
    try {
      setExportingFormat("html");
      const path = await save({ defaultPath: `${name || "Report"}.html`, filters: [{ name: "HTML", extensions: ["html"] }] });
      if (!path) return;
      await writeTextFile(path, getHtmlContent());
    } catch (e) {
      setError("HTML export failed.");
    } finally {
      setExportingFormat(null);
      setShowExportModal(false);
    }
  }

  async function handleExportPDF() {
    try {
      setExportingFormat("pdf");
      const path = await save({ defaultPath: `${name || "Report"}.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (!path) return;
      
      const pdf = new jsPDF({ unit: "pt", format: "letter" });
      const margin = 54;
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const contentWidth = pageWidth - margin * 2;
      let y = margin;

      const ensureSpace = (height: number) => {
        if (y + height > pageHeight - margin) {
          pdf.addPage();
          y = margin;
        }
      };

      const addText = (text: string, size = 10, style: "normal" | "bold" | "italic" = "normal", gap = 8) => {
        pdf.setFont("helvetica", style);
        pdf.setFontSize(size);
        const lines = pdf.splitTextToSize(text || "", contentWidth) as string[];
        const lineHeight = size * 1.35;
        ensureSpace(lines.length * lineHeight + gap);
        pdf.text(lines, margin, y);
        y += lines.length * lineHeight + gap;
      };

      addText(name || "Untitled Report", 20, "bold", 14);
      addText(`Created by: ${row ? row.createdByName : (currentUser?.name || currentUser?.email || "Unknown")}`, 10);
      addText(`Created: ${row ? fmtDate(row.createdAt) : fmtDate(new Date().toISOString())}`, 10, "normal", 14);

      const description = htmlToPlainText(getExportDescriptionHtml());
      if (description) {
        addText("Description", 14, "bold", 8);
        addText(description, 10, "normal", 14);
      }

      addText("Summary", 14, "bold", 8);
      addText(`Cases: ${caseCount}   Documents: ${docCount}   Codes: ${codeCount}   Users: ${userCount}   Annotations: ${filteredAnns.length}`, 10, "normal", 14);
      addText("Annotations", 14, "bold", 8);

      if (filteredAnns.length === 0) {
        addText("No annotations were captured in this report.", 10, "italic");
      } else {
        for (const ann of filteredAnns) {
          ensureSpace(76);
          pdf.setDrawColor(210);
          pdf.line(margin, y, pageWidth - margin, y);
          y += 14;
          addText(`${ann.codeName} | ${ann.documentName} | ${getCoderName(ann.createdById)} | ${getCaseNameForAnn(ann)}`, 9, "bold", 6);
          addText(`"${ann.quote}"`, 10, "italic", 6);
          if (ann.note) addText(`Note: ${ann.note}`, 9, "normal", 10);
        }
      }

      await writeFile(path, new Uint8Array(pdf.output("arraybuffer")));
    } catch (e) {
      console.error(e);
      setError("PDF export failed.");
    } finally {
      setExportingFormat(null);
      setShowExportModal(false);
    }
  }

  async function handleExportDOCX() {
    try {
      setExportingFormat("docx");
      const path = await save({ defaultPath: `${name || "Report"}.docx`, filters: [{ name: "Word Document", extensions: ["docx"] }] });
      if (!path) return;

      const children: Paragraph[] = [
        new Paragraph({ text: name || "Untitled Report", heading: HeadingLevel.TITLE }),
        new Paragraph(`Created by: ${row ? row.createdByName : (currentUser?.name || currentUser?.email || "Unknown")}`),
        new Paragraph(`Created: ${row ? fmtDate(row.createdAt) : fmtDate(new Date().toISOString())}`),
        new Paragraph({ text: "Summary", heading: HeadingLevel.HEADING_1 }),
        new Paragraph(`Cases: ${caseCount}   Documents: ${docCount}   Codes: ${codeCount}   Users: ${userCount}   Annotations: ${filteredAnns.length}`),
      ];

      const description = htmlToPlainText(getExportDescriptionHtml());
      if (description) {
        children.push(new Paragraph({ text: "Description", heading: HeadingLevel.HEADING_1 }));
        for (const line of description.split(/\n+/).filter(Boolean)) {
          children.push(new Paragraph(line));
        }
      }

      children.push(new Paragraph({ text: "Annotations", heading: HeadingLevel.HEADING_1 }));
      if (filteredAnns.length === 0) {
        children.push(new Paragraph({ children: [new TextRun({ text: "No annotations were captured in this report.", italics: true })] }));
      } else {
        for (const ann of filteredAnns) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: ann.codeName, bold: true }),
                new TextRun(` | ${ann.documentName} | ${getCoderName(ann.createdById)} | ${getCaseNameForAnn(ann)}`),
              ],
              spacing: { before: 240 },
            }),
            new Paragraph({ children: [new TextRun({ text: `"${ann.quote}"`, italics: true })] }),
          );
          if (ann.note) {
            children.push(new Paragraph({ children: [new TextRun({ text: "Note: ", bold: true }), new TextRun(ann.note)] }));
          }
        }
      }

      const doc = new DocxDocument({
        creator: currentUser?.name || currentUser?.email || "Kanqual",
        title: name || "Report",
        sections: [{ children }],
      });
      const buffer = await (await Packer.toBlob(doc)).arrayBuffer();
      await writeFile(path, new Uint8Array(buffer));
    } catch (e) {
      console.error(e);
      setError("DOCX export failed.");
    } finally {
      setExportingFormat(null);
      setShowExportModal(false);
    }
  }

  return (
    <div className="annotate-view">

      {/* ── Top bar ── */}
      <div className="annotate-back-bar" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 10 }}>
        <button className="btn" onClick={onBack}>← Back to Reports</button>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {error && <span style={{ fontSize: 12, color: "var(--color-danger)" }}>{error}</span>}
          <button
            className="btn btn--secondary"
            title={!isFrozen ? "Reports must be saved before they can be exported" : "Export Report"}
            disabled={!isFrozen}
            onClick={() => setShowExportModal(true)}
          >
            Export
          </button>
          {isFrozen && onUseSettings && (
            <button
              className="btn btn--primary"
              onClick={() => onUseSettings({ caseIds: row!.caseIds, documentIds: row!.documentIds, codeIds: row!.codeIds })}
            >
              Use Settings for New Report
            </button>
          )}
          {!isFrozen && (
            <button className="btn btn--primary" onClick={handleSave} disabled={saving || !name.trim()}>
              {saving ? "Saving…" : "Save Report"}
            </button>
          )}
        </div>
      </div>

      {/* ── 3-column layout ── */}
      <div className="annotate-layout">

        {/* Left: filter panels */}
        <div className="annotate-left">

          {/* Cases */}
          <div className="annotate-card">
            <button className="annotate-card-header" style={{ width: "100%", cursor: "pointer", background: "none", border: "none" }} onClick={() => togglePanel("cases")}>
              <span className="annotate-card-title">Cases{selCaseIds.size > 0 ? ` (${selCaseIds.size})` : ""}</span>
              <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>{collapsed.has("cases") ? "▸" : "▾"}</span>
            </button>
            {!collapsed.has("cases") && (
              <ul className="code-list">
                {dataLoading
                  ? <li className="code-list-empty">Loading…</li>
                  : displayCaseItems.length === 0
                    ? <li className="code-list-empty">No cases.</li>
                    : displayCaseItems.map((c) => (
                        <li key={c.id} className="code-item"
                          style={{ cursor: isFrozen ? "default" : "pointer" }}
                          onClick={isFrozen ? undefined : () => toggle(selCaseIds, setSelCaseIds, c.id)}
                        >
                          <input type="checkbox" className="memo-sel-checkbox"
                            checked={selCaseIds.has(c.id)} disabled={isFrozen}
                            onChange={isFrozen ? undefined : (e) => { e.stopPropagation(); toggle(selCaseIds, setSelCaseIds, c.id); }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className="code-label">{c.name}</span>
                        </li>
                      ))
                }
              </ul>
            )}
          </div>

          {/* Documents */}
          <div className="annotate-card">
            <button className="annotate-card-header" style={{ width: "100%", cursor: "pointer", background: "none", border: "none" }} onClick={() => togglePanel("documents")}>
              <span className="annotate-card-title">Documents{selDocIds.size > 0 ? ` (${selDocIds.size})` : ""}</span>
              <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>{collapsed.has("documents") ? "▸" : "▾"}</span>
            </button>
            {!collapsed.has("documents") && (
              <ul className="code-list">
                {storeDocs.length === 0
                  ? <li className="code-list-empty">No documents.</li>
                  : storeDocs.map((d) => (
                      <li key={d.id} className="code-item"
                        style={{ cursor: isFrozen ? "default" : "pointer" }}
                        onClick={isFrozen ? undefined : () => toggle(selDocIds, setSelDocIds, d.id)}
                      >
                        <input type="checkbox" className="memo-sel-checkbox"
                          checked={selDocIds.has(d.id)} disabled={isFrozen}
                          onChange={isFrozen ? undefined : (e) => { e.stopPropagation(); toggle(selDocIds, setSelDocIds, d.id); }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="code-label">{d.name}</span>
                      </li>
                    ))
                }
              </ul>
            )}
          </div>

          {/* Codes */}
          <div className="annotate-card">
            <button className="annotate-card-header" style={{ width: "100%", cursor: "pointer", background: "none", border: "none" }} onClick={() => togglePanel("codes")}>
              <span className="annotate-card-title">Codes{selCodeIds.size > 0 ? ` (${selCodeIds.size})` : ""}</span>
              <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>{collapsed.has("codes") ? "▸" : "▾"}</span>
            </button>
            {!collapsed.has("codes") && (
              <ul className="code-list" style={{ overflowY: "auto", flex: 1 }}>
                {storeCodes.length === 0
                  ? <li className="code-list-empty">No codes.</li>
                  : storeCodes.map((c) => (
                      <li key={c.id} className="code-item"
                        style={{ cursor: isFrozen ? "default" : "pointer" }}
                        onClick={isFrozen ? undefined : () => toggle(selCodeIds, setSelCodeIds, c.id)}
                      >
                        <input type="checkbox" className="memo-sel-checkbox"
                          checked={selCodeIds.has(c.id)} disabled={isFrozen}
                          onChange={isFrozen ? undefined : (e) => { e.stopPropagation(); toggle(selCodeIds, setSelCodeIds, c.id); }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="code-swatch" style={{ background: c.color }} />
                        <span className="code-label">{c.label}</span>
                      </li>
                    ))
                }
              </ul>
            )}
          </div>

          {/* Users */}
          <div className="annotate-card annotate-card--grow">
            <button className="annotate-card-header" style={{ width: "100%", cursor: "pointer", background: "none", border: "none" }} onClick={() => togglePanel("users")}>
              <span className="annotate-card-title">Users{selUserIds.size > 0 ? ` (${selUserIds.size})` : ""}</span>
              <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>{collapsed.has("users") ? "▸" : "▾"}</span>
            </button>
            {!collapsed.has("users") && (
              <ul className="code-list" style={{ overflowY: "auto", flex: 1 }}>
                {dataLoading
                  ? <li className="code-list-empty">Loading…</li>
                  : displayUserItems.length === 0
                    ? <li className="code-list-empty">No users.</li>
                    : displayUserItems.map((u) => (
                        <li key={u.id} className="code-item"
                          style={{ cursor: isFrozen ? "default" : "pointer" }}
                          onClick={isFrozen ? undefined : () => toggle(selUserIds, setSelUserIds, u.id)}
                        >
                          <input type="checkbox" className="memo-sel-checkbox"
                            checked={selUserIds.has(u.id)} disabled={isFrozen}
                            onChange={isFrozen ? undefined : (e) => { e.stopPropagation(); toggle(selUserIds, setSelUserIds, u.id); }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className="code-label">{u.name}</span>
                        </li>
                      ))
                }
              </ul>
            )}
          </div>

        </div>

        {/* Middle: report content */}
        <div ref={mainRef} className="annotate-main" style={{ overflowY: "auto", gap: 10, flexDirection: "column", display: "flex", padding: "2px 0" }}>

          {/* Title */}
          <div className="annotate-card" style={{ flexShrink: 0 }}>
            <div className="annotate-card-header"><span className="annotate-card-title">Report Title</span></div>
            <div style={{ padding: "10px 14px" }}>
              {!isFrozen ? (
                <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Report name…" autoFocus={isNew} />
              ) : (
                <p className="case-card-value">{name || "Untitled Report"}</p>
              )}
            </div>
          </div>

          {/* Details */}
          <div className="annotate-card" style={{ flexShrink: 0 }}>
            <div className="annotate-card-header"><span className="annotate-card-title">Details</span></div>
            <div style={{ display: "flex", gap: 24, padding: "10px 14px", fontSize: 13 }}>
              <span>
                <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>Created By </span>
                <span>{row ? row.createdByName : (currentUser?.name || currentUser?.email || "—")}</span>
              </span>
              <span>
                <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>Created </span>
                <span>{row ? fmtDate(row.createdAt) : "—"}</span>
              </span>
              {isFrozen && (
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 600, background: "var(--color-surface-alt)",
                    border: "1px solid var(--color-border)", borderRadius: 4,
                    padding: "1px 6px", color: "var(--color-text-muted)",
                    textTransform: "uppercase", letterSpacing: "0.05em",
                  }}>
                    Frozen
                  </span>
                </span>
              )}
            </div>
          </div>

          {/* Description */}
          {showDescription && (
            <div className="annotate-card" style={{ flexShrink: 0 }}>
              <div className="annotate-card-header">
                <span className="annotate-card-title">Description</span>
                {!isFrozen && editor && (
                  <div className="report-description-toolbar">
                    <button className={`rte-btn${editor.isActive("bold")        ? " rte-btn--active" : ""}`} onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }} title="Bold">B</button>
                    <button className={`rte-btn${editor.isActive("italic")      ? " rte-btn--active" : ""}`} onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }} title="Italic"><em>I</em></button>
                    <button className={`rte-btn${editor.isActive("strike")      ? " rte-btn--active" : ""}`} onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleStrike().run(); }} title="Strikethrough"><s>S</s></button>
                    <span className="rte-divider" />
                    <button className={`rte-btn${editor.isActive("bulletList")  ? " rte-btn--active" : ""}`} onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBulletList().run(); }} title="Bullet list">≡</button>
                    <button className={`rte-btn${editor.isActive("orderedList") ? " rte-btn--active" : ""}`} onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleOrderedList().run(); }} title="Numbered list">1.</button>
                    <span className="rte-divider" />
                    <button className={`rte-btn${editor.isActive("blockquote")  ? " rte-btn--active" : ""}`} onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBlockquote().run(); }} title="Blockquote">"</button>
                  </div>
                )}
              </div>
              <EditorContent editor={editor} />
            </div>
          )}

          {/* Summary counts */}
          <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
            {summaryCards.map(({ key, label, value, items }) => (
              <button
                key={key}
                className="annotate-card"
                onClick={() => toggleSummaryCard(key)}
                aria-expanded={expandedSummaryCards.has(key)}
                style={{
                  flex: 1,
                  padding: "14px 10px",
                  textAlign: "center",
                  flexShrink: 0,
                  border: "var(--border-width) solid var(--color-border)",
                  background: "var(--color-surface)",
                  color: "var(--color-text)",
                  cursor: "pointer",
                }}
              >
                <div className="summary-card-value">{value}</div>
                <div className="summary-card-label">
                  {label}
                  <span style={{ marginLeft: 6, fontSize: 10, color: "var(--color-text-muted)" }}>
                    {expandedSummaryCards.has(key) ? "▾" : "▸"}
                  </span>
                </div>
                {expandedSummaryCards.has(key) && (
                  <div
                    style={{
                      marginTop: 10,
                      paddingTop: 8,
                      borderTop: "var(--border-width) solid var(--color-border)",
                      maxHeight: 130,
                      overflowY: "auto",
                      textAlign: "left",
                    }}
                  >
                    {items.length === 0 ? (
                      <div style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center" }}>
                        None included.
                      </div>
                    ) : (
                      items.map((item) => (
                        <div
                          key={`${key}-${item.id}`}
                          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, lineHeight: 1.4, padding: "2px 0" }}
                        >
                          {item.color && (
                            <span className="code-swatch" style={{ background: item.color, width: 9, height: 9 }} />
                          )}
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Coverage statistics (live reports only) */}
          {showCoverage && !isFrozen && (
            <div className="annotate-card" style={{ flexShrink: 0 }}>
              <div className="annotate-card-header"><span className="annotate-card-title">Statistics</span></div>
              <div style={{ padding: "12px 14px" }}>
                {dataLoading ? (
                  <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Loading…</p>
                ) : coverageStats.rows.length === 0 ? (
                  <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>No coverage data for the current filters.</p>
                ) : (() => {
                  const maxPct = coverageStats.rows[0].pct;
                  const scale  = maxPct + 5;
                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>Code Coverage</div>
                        <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                          % of {coverageStats.totalChars.toLocaleString()} characters
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {coverageStats.rows.map((row) => (
                          <div key={row.codeName} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 12, width: 110, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.codeName}</span>
                            <div style={{ flex: 1, height: 12, position: "relative" }}>
                              <div style={{ width: `${(row.pct / scale) * 100}%`, height: "100%", background: row.codeColor, borderRadius: 6, transition: "width 0.3s ease" }} />
                            </div>
                            <span style={{ fontSize: 12, width: 42, flexShrink: 0, textAlign: "right", color: "var(--color-text-muted)" }}>
                              {row.pct < 0.1 ? "<0.1" : row.pct.toFixed(1)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Annotations */}
          <div className="annotate-card" style={{ flexShrink: 0 }}>
            <div className="annotate-card-header">
              <span className="annotate-card-title">Annotations{filteredAnns.length > 0 ? ` (${filteredAnns.length})` : ""}</span>
            </div>
            {dataLoading ? (
              <div style={{ padding: "12px 14px", fontSize: 12, color: "var(--color-text-muted)" }}>Loading…</div>
            ) : filteredAnns.length === 0 ? (
              <div style={{ padding: "12px 14px", fontSize: 12, color: "var(--color-text-muted)" }}>
                {isFrozen ? "No annotations were captured in this report." : (allAnns.length === 0 ? "No annotations in this project yet." : "No annotations match the current filters.")}
              </div>
            ) : (
              <ul className="annotation-list">
                {filteredAnns.map((ann) => {
                  const docContent = docContentMap.get(ann.documentId) ?? "";
                  const ctxBefore = !isFrozen && showContext && docContent ? docContent.slice(Math.max(0, ann.startOffset - contextChars), ann.startOffset) : null;
                  const ctxAfter  = !isFrozen && showContext && docContent ? docContent.slice(ann.endOffset, ann.endOffset + contextChars) : null;
                  return (
                    <li key={ann.id} className="annotation-item">
                      <div className="annotation-item-header">
                        <span className="annotation-code-badge" style={{ background: ann.codeColor }}>{ann.codeName}</span>
                        <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{ann.documentName}</span>
                      </div>
                      <p className="annotation-quote">
                        {ctxBefore != null && (
                          <span className="annotation-context annotation-context--before">
                            {ann.startOffset > contextChars ? "…" : ""}{ctxBefore}
                          </span>
                        )}
                        <span className="annotation-quote-text">"{ann.quote}"</span>
                        {ctxAfter != null && (
                          <span className="annotation-context annotation-context--after">
                            {ctxAfter}{ann.endOffset + contextChars < docContent.length ? "…" : ""}
                          </span>
                        )}
                      </p>
                      {ann.note && <p className="annotation-note">{ann.note}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

        </div>

        {/* Right: report options */}
        <div className="annotate-right">
          <div className="annotate-card annotate-card--grow">
            <div className="annotate-card-header"><span className="annotate-card-title">Report Options</span></div>
            <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
              {!isFrozen && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <label className="toggle-switch" style={{ marginBottom: 0 }}>
                    <input type="checkbox" checked={showContext} onChange={(e) => setShowContext(e.target.checked)} />
                    <span className="toggle-track"><span className="toggle-thumb" /></span>
                    <span style={{ fontSize: 13 }}>Additional context</span>
                  </label>
                  <input
                    type="number" min={0} max={9999} value={contextChars}
                    onChange={(e) => setContextChars(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    style={{ width: 60, padding: "3px 6px", fontSize: 13, border: "var(--border-width) solid var(--color-border)", borderRadius: "calc(var(--radius) * 0.5px)", background: "var(--color-bg)", color: "var(--color-text)", textAlign: "right" }}
                  />
                  <span style={{ fontSize: 13, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>characters</span>
                </div>
              )}

              {!isFrozen && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <label className="toggle-switch" style={{ marginBottom: 0 }}>
                    <input type="checkbox" checked={showCoverage} onChange={(e) => setShowCoverage(e.target.checked)} />
                    <span className="toggle-track"><span className="toggle-thumb" /></span>
                    <span style={{ fontSize: 13 }}>Code coverage statistics</span>
                  </label>
                </div>
              )}

              {!isFrozen && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <label className="toggle-switch" style={{ marginBottom: 0 }}>
                    <input type="checkbox" checked={showDescription} onChange={(e) => setShowDescription(e.target.checked)} />
                    <span className="toggle-track"><span className="toggle-thumb" /></span>
                    <span style={{ fontSize: 13 }}>Write a description</span>
                  </label>
                </div>
              )}

              {isFrozen && (
                <p style={{ fontSize: 11, color: "var(--color-text-muted)", lineHeight: 1.5, marginTop: 4 }}>
                  This report is frozen. Its annotations reflect the data at the time it was saved.
                </p>
              )}
            </div>
          </div>
        </div>

      </div>

      {showExportModal && (
        <ExportModal
          onClose={() => setShowExportModal(false)}
          onExportHTML={handleExportHTML}
          onExportPDF={handleExportPDF}
          onExportDOCX={handleExportDOCX}
          onExportCSV={handleExportCSV}
          exportingFormat={exportingFormat}
        />
      )}
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function CodeReportsView() {
  const { activeProject, pb, canEdit, deleteCodeReport } = useStore();

  const [rows,    setRows]    = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const [sortCol, setSortCol] = useState<SortCol>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [contextMenu,   setContextMenu]   = useState<{ x: number; y: number; row: ReportRow } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const [confirmDelete, setConfirmDelete] = useState<ReportRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [openRow,        setOpenRow]        = useState<ReportRow | null>(null);
  const [showNew,        setShowNew]        = useState(false);
  const [newFromSettings, setNewFromSettings] = useState<ReportSettings | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────

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
      const mappedRows = records.map((r) => {
        const cb = r.expand?.created_by;
        let snapshot: ReportSnapshot | undefined;
        if (r.snapshot) {
          try { snapshot = JSON.parse(r.snapshot); } catch { /* malformed snapshot — treat as legacy */ }
        }
        return {
          id:            r.id,
          name:          r.name,
          createdByName: cb?.name || cb?.email || "—",
          createdAt:     r.created,
          caseIds:       toArr<string>(r.cases),
          documentIds:   toArr<string>(r.documents),
          codeIds:       toArr<string>(r.codes),
          snapshot,
        };
      });
      const annotationRows = mappedRows.filter((row) => !row.snapshot?.reportType || row.snapshot.reportType === "annotations");
      setRows(annotationRows);
      return annotationRows;
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
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node))
        setContextMenu(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setContextMenu(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown",     onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown",     onKeyDown);
    };
  }, []);

  const sorted = [...rows].sort((a, b) => {
    const cmp = String(a[sortCol]).localeCompare(String(b[sortCol]), undefined, { sensitivity: "base" });
    return sortDir === "asc" ? cmp : -cmp;
  });

  function handleSort(col: SortCol) {
    if (col === sortCol) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleteLoading(true);
    try {
      await deleteCodeReport(confirmDelete.id);
      setRows((prev) => prev.filter((r) => r.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete report.");
      setConfirmDelete(null);
    } finally {
      setDeleteLoading(false);
    }
  }

  // ── Sub-views ─────────────────────────────────────────────────────────────

  if (showNew || newFromSettings) {
    return (
      <ReportPage
        isNew
        initialSettings={newFromSettings ?? undefined}
        onSaved={async (id) => { 
          setShowNew(false); 
          setNewFromSettings(null); 
          const newRows = await loadReports();
          if (id) {
            const newRow = newRows.find((r) => r.id === id);
            if (newRow) setOpenRow(newRow);
          }
        }}
        onBack={() => { setShowNew(false); setNewFromSettings(null); }}
      />
    );
  }

  if (openRow) {
    return (
      <ReportPage
        row={openRow}
        onSaved={() => { setOpenRow(null); loadReports(); }}
        onBack={() => setOpenRow(null)}
        onUseSettings={(settings) => { setOpenRow(null); setNewFromSettings(settings); }}
      />
    );
  }

  // ── Table ─────────────────────────────────────────────────────────────────

  return (
    <div className="view users-view">
      <header className="view-header">
        <h1>Annotation Reports</h1>
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
                <th key={col.key} style={{ width: col.width }}
                  className={`users-th${sortCol === col.key ? " users-th--sorted" : ""}`}
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}
                  <span className="users-sort-icon">{sortCol === col.key ? (sortDir === "asc" ? " ↑" : " ↓") : " ↕"}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={3} className="users-td-msg">Loading…</td></tr>}
            {!loading && sorted.length === 0 && <tr><td colSpan={3} className="users-td-msg">No reports yet.</td></tr>}
            {!loading && sorted.map((row) => (
              <tr key={row.id} className="users-row"
                onClick={() => setOpenRow(row)}
                onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, row }); }}
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
                {deleteLoading ? "Deleting…" : "Delete Report"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
