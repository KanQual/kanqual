import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useStore } from "../context/StoreContext";
import { useAuth } from "../context/AuthContext";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile, writeFile } from "@tauri-apps/plugin-fs";
import { Document as DocxDocument, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from "docx";
import { jsPDF } from "jspdf";
import ExcelJS from "exceljs";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import { FilterIcon } from "../components/FilterIcon";
import helpIcon from "../assets/ic_help_outline_24px.svg";

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
interface AttributeItem { id: string; name: string; dataType: string; }
interface AttributeValueItem { id: string; ownerId: string; attributeId: string; value: string; }
interface SummaryItem { id: string; name: string; color?: string; }
interface AttributeFilterConfig {
  min?: string;
  max?: string;
  selectedValues?: string[];
}

interface ReportSnapshot {
  reportType?: "annotations";
  filteredAnns: AnnItem[];
  caseItems: CaseItem[];
  userItems: UserItem[];
  caseAttributeItems?: AttributeItem[];
  documentAttributeItems?: AttributeItem[];
  caseDocLinks?: CaseDocumentLink[];
  summaryCounts: { cases: number; docs: number; codes: number; users: number };
  description?: string;
  selectedUserIds?: string[];
  selectedCaseAttributeIds?: string[];
  selectedDocumentAttributeIds?: string[];
  caseAttributeFilters?: Record<string, AttributeFilterConfig>;
  documentAttributeFilters?: Record<string, AttributeFilterConfig>;
  showDescription?: boolean;
  showStatistics?: boolean;
  showContext?: boolean;
  contextChars?: number;
  annotationGroupBy?: AnnotationGroupBy;
  annotationSortBy?: AnnotationSortBy;
}

function hasDescriptionContent(html: string | undefined): boolean {
  if (!html) return false;
  return html.replace(/<[^>]*>/g, "").trim().length > 0;
}

interface ReportSettings {
  caseIds: string[];
  documentIds: string[];
  codeIds: string[];
  userIds?: string[];
  caseAttributeIds?: string[];
  documentAttributeIds?: string[];
  caseAttributeFilters?: Record<string, AttributeFilterConfig>;
  documentAttributeFilters?: Record<string, AttributeFilterConfig>;
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
type AnnotationGroupBy = "none" | "code" | "document" | "coder";
type AnnotationSortBy = "document" | "code" | "coder" | "quoteLength" | "quote";

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

function relationPreview(ids: string[]): string[] {
  return ids.slice(0, 100);
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

function quantile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const index = (sortedValues.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function parseNumericValue(value: string | undefined): number | null {
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDateValue(value: string | undefined): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDateInputValue(timestamp: number | null): string {
  if (timestamp === null || !Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getPocketBaseErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") {
    return error instanceof Error ? error.message : "Failed to save report.";
  }

  const maybe = error as {
    message?: string;
    response?: { message?: string; data?: Record<string, { message?: string; code?: string }> };
  };
  const details = maybe.response?.data
    ? Object.entries(maybe.response.data)
        .map(([field, detail]) => `${field}: ${detail.message || detail.code || "invalid value"}`)
        .join("; ")
    : "";
  return details || maybe.response?.message || maybe.message || "Failed to save report.";
}

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// ─── Column definitions ───────────────────────────────────────────────────────

const COLS: { key: SortCol; label: string; width: string }[] = [
  { key: "name",          label: "Name",       width: "40%" },
  { key: "createdByName", label: "Created By", width: "28%" },
  { key: "createdAt",     label: "Created",    width: "32%" },
];

// ─── SVG → PNG helper ────────────────────────────────────────────────────────

function svgToPngDataUrl(svgString: string): Promise<string> {
  const wMatch = svgString.match(/width="(\d+)"/);
  const hMatch = svgString.match(/height="(\d+)"/);
  const w = wMatch ? parseInt(wMatch[1], 10) : 760;
  const h = hMatch ? parseInt(hMatch[1], 10) : 260;
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) { reject(new Error("no canvas context")); return; }
    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("SVG render failed")); };
    img.src = url;
  });
}

// ─── Export Modal ─────────────────────────────────────────────────────────────

function ExportModal({
  onClose,
  onExportHTML,
  onExportPDF,
  onExportDOCX,
  onExportXLSX,
  exportingFormat,
}: {
  onClose: () => void;
  onExportHTML: () => void;
  onExportPDF: () => void;
  onExportDOCX: () => void;
  onExportXLSX: () => void;
  exportingFormat: string | null;
}) {
  const options = [
    {
      key: "html",
      label: "HTML",
      description: "Can be opened in a web browser and is closest to what you see in the app.",
      onClick: onExportHTML,
    },
    {
      key: "pdf",
      label: "PDF",
      description: "Uses a simpler layout and is the best for sharing.",
      onClick: onExportPDF,
    },
    {
      key: "docx",
      label: "DOCX",
      description: "Uses a simpler layout and is the best for further editing.",
      onClick: onExportDOCX,
    },
    {
      key: "xlsx",
      label: "XLSX",
      description: "Exports metadata, statistics charts, and all annotations into a structured Excel workbook.",
      onClick: onExportXLSX,
    },
  ] as const;

  return (
    <div className="modal-overlay" onClick={onClose} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "var(--color-bg)", padding: 24, borderRadius: 8, minWidth: 320, maxWidth: 960, width: "min(960px, calc(100vw - 32px))" }}>
        <h2 style={{ marginTop: 0, marginBottom: 16 }}>Export Report</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
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
  const { pb, activeProject, documents: storeDocs, codes: storeCodes, createCodeReport, canCurrentUser } = useStore();
  const { user: currentUser } = useAuth();

  const isFrozen = !!row;
  const canCreateReports = canCurrentUser("createReports");
  const canEditReportConfiguration = canCurrentUser("editReportConfiguration");
  const canStartReports = canCreateReports && canEditReportConfiguration;
  const canExportReports = canCurrentUser("exportReports");

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
  const [selUserIds,  setSelUserIds]  = useState<Set<string>>(() => new Set(row?.snapshot?.selectedUserIds ?? initialSettings?.userIds ?? []));
  const [selCaseAttrIds, setSelCaseAttrIds] = useState<Set<string>>(() => new Set(row?.snapshot?.selectedCaseAttributeIds ?? initialSettings?.caseAttributeIds ?? []));
  const [selDocAttrIds,  setSelDocAttrIds]  = useState<Set<string>>(() => new Set(row?.snapshot?.selectedDocumentAttributeIds ?? initialSettings?.documentAttributeIds ?? []));
  const [caseAttributeFilters, setCaseAttributeFilters] = useState<Record<string, AttributeFilterConfig>>(() => row?.snapshot?.caseAttributeFilters ?? initialSettings?.caseAttributeFilters ?? {});
  const [documentAttributeFilters, setDocumentAttributeFilters] = useState<Record<string, AttributeFilterConfig>>(() => row?.snapshot?.documentAttributeFilters ?? initialSettings?.documentAttributeFilters ?? {});
  const [collapsed,   setCollapsed]   = useState<Set<string>>(() => new Set(["cases", "documents", "codes", "users"]));
  const [expandedSummaryCards, setExpandedSummaryCards] = useState<Set<string>>(new Set());

  // Report display options (functional even on frozen reports)
  const [showContext,     setShowContext]     = useState(() => row?.snapshot?.showContext ?? false);
  const [contextChars,    setContextChars]    = useState(() => row?.snapshot?.contextChars ?? 100);
  const [showCoverage,    setShowCoverage]    = useState(() => row?.snapshot?.showStatistics ?? false);
  const [showCaseAttributeFilters, setShowCaseAttributeFilters] = useState(false);
  const [showDocumentAttributeFilters, setShowDocumentAttributeFilters] = useState(false);
  const [annotationGroupBy, setAnnotationGroupBy] = useState<AnnotationGroupBy>(() => row?.snapshot?.annotationGroupBy ?? "none");
  const [annotationSortBy, setAnnotationSortBy] = useState<AnnotationSortBy>(() => row?.snapshot?.annotationSortBy ?? "document");
  const frozenDescription = row?.snapshot?.description;
  const [showDescription, setShowDescription] = useState(() =>
    isFrozen
      ? (row?.snapshot?.showDescription ?? hasDescriptionContent(frozenDescription))
      : false
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

  useEffect(() => {
    if (isFrozen || !initialSettings) return;
    setSelCaseIds(new Set(initialSettings.caseIds ?? []));
    setSelDocIds(new Set(initialSettings.documentIds ?? []));
    setSelCodeIds(new Set(initialSettings.codeIds ?? []));
    setSelUserIds(new Set(initialSettings.userIds ?? []));
    setSelCaseAttrIds(new Set(initialSettings.caseAttributeIds ?? []));
    setSelDocAttrIds(new Set(initialSettings.documentAttributeIds ?? []));
    setCaseAttributeFilters(initialSettings.caseAttributeFilters ?? {});
    setDocumentAttributeFilters(initialSettings.documentAttributeFilters ?? {});
  }, [initialSettings, isFrozen]);

  // Live data (only used for new reports)
  const [caseItems,     setCaseItems]     = useState<CaseItem[]>([]);
  const [userItems,     setUserItems]     = useState<UserItem[]>([]);
  const [caseAttributeItems, setCaseAttributeItems] = useState<AttributeItem[]>(row?.snapshot?.caseAttributeItems ?? []);
  const [documentAttributeItems, setDocumentAttributeItems] = useState<AttributeItem[]>(row?.snapshot?.documentAttributeItems ?? []);
  const [caseDocLinks,  setCaseDocLinks]  = useState<CaseDocumentLink[]>([]);
  const [caseAttributeValues, setCaseAttributeValues] = useState<AttributeValueItem[]>([]);
  const [documentAttributeValues, setDocumentAttributeValues] = useState<AttributeValueItem[]>([]);
  const [allAnns,       setAllAnns]       = useState<AnnItem[]>([]);
  const [docContentMap, setDocContentMap] = useState<Map<string, string>>(new Map());
  const [dataLoading,   setDataLoading]   = useState(!isFrozen);

  // For frozen reports, pull data from the snapshot
  const frozenAnns      = row?.snapshot?.filteredAnns  ?? [];
  const frozenCaseItems = row?.snapshot?.caseItems     ?? [];
  const frozenUserItems = row?.snapshot?.userItems     ?? [];
  const frozenCaseAttributeItems = row?.snapshot?.caseAttributeItems ?? [];
  const frozenDocumentAttributeItems = row?.snapshot?.documentAttributeItems ?? [];
  const frozenCaseDocLinks = row?.snapshot?.caseDocLinks ?? [];
  const frozenCounts    = row?.snapshot?.summaryCounts;

  const effectiveDocContentMap = useMemo(() => {
    const merged = new Map(docContentMap);
    for (const doc of storeDocs) {
      if (typeof doc.content === "string" && doc.content.length > 0 && !merged.has(doc.id)) {
        merged.set(doc.id, doc.content);
      }
    }
    return merged;
  }, [docContentMap, storeDocs]);

  useEffect(() => {
    if (!isFrozen) return;
    setUserItems(frozenUserItems);
    setCaseItems(frozenCaseItems);
    setCaseAttributeItems(frozenCaseAttributeItems);
    setDocumentAttributeItems(frozenDocumentAttributeItems);
    setCaseDocLinks(frozenCaseDocLinks);
    setSelUserIds(new Set(row?.snapshot?.selectedUserIds ?? []));
    setSelCaseAttrIds(new Set(row?.snapshot?.selectedCaseAttributeIds ?? []));
    setSelDocAttrIds(new Set(row?.snapshot?.selectedDocumentAttributeIds ?? []));
    setCaseAttributeFilters(row?.snapshot?.caseAttributeFilters ?? {});
    setDocumentAttributeFilters(row?.snapshot?.documentAttributeFilters ?? {});
    setShowDescription(row?.snapshot?.showDescription ?? hasDescriptionContent(frozenDescription));
    setShowCoverage(row?.snapshot?.showStatistics ?? false);
    setShowContext(row?.snapshot?.showContext ?? false);
    setContextChars(row?.snapshot?.contextChars ?? 100);
    setAnnotationGroupBy(row?.snapshot?.annotationGroupBy ?? "none");
    setAnnotationSortBy(row?.snapshot?.annotationSortBy ?? "document");
  }, [isFrozen, row?.id, row?.snapshot, frozenCaseAttributeItems, frozenDocumentAttributeItems, frozenDescription]);

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
        const [caseRecs, caseAttrRecs, docAttrRecs] = await Promise.all([
          pb.collection("cases").getFullList({ filter: `project="${activeProject.id}"&&deleted_at=""`, sort: "name" }),
          pb.collection("case_attribute_definitions").getFullList({
            filter: `project="${activeProject.id}"&&deleted_at=""`,
            sort: "sort_order,name",
          }),
          pb.collection("document_attribute_definitions").getFullList({
            filter: `project="${activeProject.id}"&&deleted_at=""`,
            sort: "sort_order,name",
          }),
        ]);
        setCaseItems(caseRecs.map((r) => ({ id: r.id, name: r.name })));
        setCaseAttributeItems(caseAttrRecs.map((r) => ({
          id: r.id,
          name: r.name ?? "Untitled attribute",
          dataType: r.data_type ?? "text",
        })));
        setDocumentAttributeItems(docAttrRecs.map((r) => ({
          id: r.id,
          name: r.name ?? "Untitled attribute",
          dataType: r.data_type ?? "text",
        })));

        const memberRecs = await pb.collection("project_members").getFullList({
          filter: `project="${activeProject.id}"`, expand: "user",
        });
        setUserItems(
          memberRecs
            .map((r) => { const u = r.expand?.user; return u ? { id: u.id, name: u.name || u.email || "Unknown" } : null; })
            .filter(Boolean) as UserItem[],
        );

        if (caseRecs.length > 0) {
          const [cdRecs, caseAttrValueRecs] = await Promise.all([
            pb.collection("case_documents").getFullList({
              filter: caseRecs.map((c) => `case="${c.id}"`).join(" || "),
            }),
            pb.collection("case_attribute_values").getFullList({
              filter: `(${caseRecs.map((c) => `case="${c.id}"`).join(" || ")})&&deleted_at=""`,
            }),
          ]);
          setCaseDocLinks(cdRecs.map((r) => ({ caseId: r.case, documentId: r.document })));
          setCaseAttributeValues(caseAttrValueRecs.map((r) => ({
            id: r.id,
            ownerId: r.case,
            attributeId: r.attribute,
            value: r.value ?? "",
          })));
        } else {
          setCaseDocLinks([]);
          setCaseAttributeValues([]);
        }

        if (storeDocs.length > 0) {
          const [annRecs, docAttrValueRecs] = await Promise.all([
            pb.collection("annotations").getFullList({
              filter: `(${storeDocs.map((d) => `document="${d.id}"`).join(" || ")})&&deleted_at=""`,
              expand: "code,document,created_by",
            }),
            pb.collection("document_attribute_values").getFullList({
              filter: `(${storeDocs.map((d) => `document="${d.id}"`).join(" || ")})&&deleted_at=""`,
            }),
          ]);
          const contentMap = new Map<string, string>();
          for (const r of annRecs) {
            const doc = r.expand?.document;
            if (doc && typeof doc.content === "string" && !contentMap.has(doc.id))
              contentMap.set(doc.id, doc.content);
          }
          setDocContentMap(contentMap);
          setDocumentAttributeValues(docAttrValueRecs.map((r) => ({
            id: r.id,
            ownerId: r.document,
            attributeId: r.attribute,
            value: r.value ?? "",
          })));
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
        } else {
          setDocumentAttributeValues([]);
          setAllAnns([]);
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

  const docCaseMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const { caseId, documentId } of caseDocLinks) {
      if (!map.has(documentId)) map.set(documentId, new Set());
      map.get(documentId)!.add(caseId);
    }
    return map;
  }, [caseDocLinks]);

  const caseAttributeMap = useMemo(() => {
    const map = new Map<string, Map<string, string>>();
    for (const value of caseAttributeValues) {
      if (!map.has(value.ownerId)) map.set(value.ownerId, new Map());
      map.get(value.ownerId)!.set(value.attributeId, value.value ?? "");
    }
    return map;
  }, [caseAttributeValues]);

  const documentAttributeMap = useMemo(() => {
    const map = new Map<string, Map<string, string>>();
    for (const value of documentAttributeValues) {
      if (!map.has(value.ownerId)) map.set(value.ownerId, new Map());
      map.get(value.ownerId)!.set(value.attributeId, value.value ?? "");
    }
    return map;
  }, [documentAttributeValues]);

  const caseAttributeValueStats = useMemo(() => {
    const map = new Map<string, {
      textValues: string[];
      minNumber: number | null;
      maxNumber: number | null;
      minDate: number | null;
      maxDate: number | null;
    }>();
    for (const attr of caseAttributeItems) {
      const rawValues = caseAttributeValues
        .filter((item) => item.attributeId === attr.id)
        .map((item) => item.value ?? "");
      const textValues = [...new Set(rawValues.map((value) => value.trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
      const numericValues = rawValues.map(parseNumericValue).filter((value): value is number => value !== null);
      const dateValues = rawValues.map(parseDateValue).filter((value): value is number => value !== null).sort((a, b) => a - b);
      map.set(attr.id, {
        textValues,
        minNumber: numericValues.length > 0 ? Math.min(...numericValues) : null,
        maxNumber: numericValues.length > 0 ? Math.max(...numericValues) : null,
        minDate: dateValues[0] ?? null,
        maxDate: dateValues[dateValues.length - 1] ?? null,
      });
    }
    return map;
  }, [caseAttributeItems, caseAttributeValues]);

  const documentAttributeValueStats = useMemo(() => {
    const map = new Map<string, {
      textValues: string[];
      minNumber: number | null;
      maxNumber: number | null;
      minDate: number | null;
      maxDate: number | null;
    }>();
    for (const attr of documentAttributeItems) {
      const rawValues = documentAttributeValues
        .filter((item) => item.attributeId === attr.id)
        .map((item) => item.value ?? "");
      const textValues = [...new Set(rawValues.map((value) => value.trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
      const numericValues = rawValues.map(parseNumericValue).filter((value): value is number => value !== null);
      const dateValues = rawValues.map(parseDateValue).filter((value): value is number => value !== null).sort((a, b) => a - b);
      map.set(attr.id, {
        textValues,
        minNumber: numericValues.length > 0 ? Math.min(...numericValues) : null,
        maxNumber: numericValues.length > 0 ? Math.max(...numericValues) : null,
        minDate: dateValues[0] ?? null,
        maxDate: dateValues[dateValues.length - 1] ?? null,
      });
    }
    return map;
  }, [documentAttributeItems, documentAttributeValues]);

  const caseIdsMatchingSelectedAttributes = useMemo(() => {
    if (selCaseAttrIds.size === 0) return null;
    const matching = new Set<string>();
    for (const item of caseItems) {
      const values = caseAttributeMap.get(item.id);
      const hasAllSelectedValues = [...selCaseAttrIds].every((attrId) => {
        const attr = caseAttributeItems.find((candidate) => candidate.id === attrId);
        const value = values?.get(attrId) ?? "";
        if (!attr) return false;
        if (attr.dataType === "number") {
          const numericValue = parseNumericValue(value);
          if (numericValue === null) return false;
          const config = caseAttributeFilters[attrId];
          const min = parseNumericValue(config?.min);
          const max = parseNumericValue(config?.max);
          if (min !== null && numericValue < min) return false;
          if (max !== null && numericValue > max) return false;
          return true;
        }
        if (attr.dataType === "datetime") {
          const dateValue = parseDateValue(value);
          if (dateValue === null) return false;
          const config = caseAttributeFilters[attrId];
          const min = parseDateValue(config?.min);
          const max = parseDateValue(config?.max);
          if (min !== null && dateValue < min) return false;
          if (max !== null && dateValue > max) return false;
          return true;
        }
        const normalized = value.trim();
        const selectedValues = caseAttributeFilters[attrId]?.selectedValues ?? caseAttributeValueStats.get(attrId)?.textValues ?? [];
        return normalized.length > 0 && selectedValues.includes(normalized);
      });
      if (hasAllSelectedValues) matching.add(item.id);
    }
    return matching;
  }, [selCaseAttrIds, caseItems, caseAttributeMap, caseAttributeItems, caseAttributeFilters, caseAttributeValueStats]);

  const docIdsMatchingSelectedAttributes = useMemo(() => {
    if (selDocAttrIds.size === 0) return null;
    const matching = new Set<string>();
    for (const doc of storeDocs) {
      const values = documentAttributeMap.get(doc.id);
      const hasAllSelectedValues = [...selDocAttrIds].every((attrId) => {
        const attr = documentAttributeItems.find((candidate) => candidate.id === attrId);
        const value = values?.get(attrId) ?? "";
        if (!attr) return false;
        if (attr.dataType === "number") {
          const numericValue = parseNumericValue(value);
          if (numericValue === null) return false;
          const config = documentAttributeFilters[attrId];
          const min = parseNumericValue(config?.min);
          const max = parseNumericValue(config?.max);
          if (min !== null && numericValue < min) return false;
          if (max !== null && numericValue > max) return false;
          return true;
        }
        if (attr.dataType === "datetime") {
          const dateValue = parseDateValue(value);
          if (dateValue === null) return false;
          const config = documentAttributeFilters[attrId];
          const min = parseDateValue(config?.min);
          const max = parseDateValue(config?.max);
          if (min !== null && dateValue < min) return false;
          if (max !== null && dateValue > max) return false;
          return true;
        }
        const normalized = value.trim();
        const selectedValues = documentAttributeFilters[attrId]?.selectedValues ?? documentAttributeValueStats.get(attrId)?.textValues ?? [];
        return normalized.length > 0 && selectedValues.includes(normalized);
      });
      if (hasAllSelectedValues) matching.add(doc.id);
    }
    return matching;
  }, [selDocAttrIds, storeDocs, documentAttributeMap, documentAttributeItems, documentAttributeFilters, documentAttributeValueStats]);

  const caseFilterDocIds = useMemo(() => {
    if (selCaseIds.size === 0) return new Set<string>();
    const ids = new Set<string>();
    for (const cId of selCaseIds) {
      if (caseIdsMatchingSelectedAttributes && !caseIdsMatchingSelectedAttributes.has(cId)) continue;
      for (const dId of (caseDocMap.get(cId) ?? [])) {
        if (docIdsMatchingSelectedAttributes && !docIdsMatchingSelectedAttributes.has(dId)) continue;
        ids.add(dId);
      }
    }
    return ids;
  }, [selCaseIds, caseDocMap, caseIdsMatchingSelectedAttributes, docIdsMatchingSelectedAttributes]);

  const filteredAnns = useMemo(() => {
    if (isFrozen) return frozenAnns;
    return allAnns.filter((ann) => {
      if (!caseFilterDocIds.has(ann.documentId)) return false;
      if (!selDocIds.has(ann.documentId)) return false;
      if (docIdsMatchingSelectedAttributes && !docIdsMatchingSelectedAttributes.has(ann.documentId)) return false;
      if (!selCodeIds.has(ann.codeId)) return false;
      if (!selUserIds.has(ann.createdById)) return false;
      return true;
    });
  }, [isFrozen, frozenAnns, allAnns, caseFilterDocIds, selDocIds, docIdsMatchingSelectedAttributes, selCodeIds, selUserIds]);

  const coverageStats = useMemo(() => {
    const empty = { rows: [] as { codeName: string; codeColor: string; chars: number; pct: number }[], totalChars: 0 };
    if (!showCoverage) return empty;
    const activeDocs = storeDocs.filter((d) => selDocIds.has(d.id));
    const totalChars = activeDocs.reduce((sum, d) => sum + (effectiveDocContentMap.get(d.id)?.length ?? 0), 0);
    if (totalChars === 0) return empty;
    const visibleCodes = storeCodes.filter((c) => selCodeIds.has(c.id));
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
  }, [showCoverage, filteredAnns, selDocIds, selCodeIds, storeDocs, storeCodes, effectiveDocContentMap]);

  const annotationFrequencyStats = useMemo(() => {
    const empty = [] as { codeId: string; codeName: string; codeColor: string; count: number }[];
    if (!showCoverage) return empty;
    const visibleCodes = storeCodes.filter((c) => selCodeIds.has(c.id));
    const byCode = new Map<string, { codeId: string; codeName: string; codeColor: string; count: number }>();
    for (const c of visibleCodes) {
      byCode.set(c.id, { codeId: c.id, codeName: c.label, codeColor: c.color, count: 0 });
    }
    for (const ann of filteredAnns) {
      const entry = byCode.get(ann.codeId);
      if (entry) entry.count += 1;
    }
    return Array.from(byCode.values())
      .filter((row) => row.count > 0)
      .sort((a, b) => b.count - a.count || a.codeName.localeCompare(b.codeName, undefined, { sensitivity: "base" }));
  }, [showCoverage, filteredAnns, selCodeIds, storeCodes]);

  const annotationDocumentStats = useMemo(() => {
    const empty = [] as { documentId: string; documentName: string; count: number }[];
    if (!showCoverage) return empty;
    const visibleDocs = storeDocs.filter((d) => selDocIds.has(d.id));
    const byDocument = new Map<string, { documentId: string; documentName: string; count: number }>();
    for (const doc of visibleDocs) {
      byDocument.set(doc.id, { documentId: doc.id, documentName: doc.name, count: 0 });
    }
    for (const ann of filteredAnns) {
      const entry = byDocument.get(ann.documentId);
      if (entry) entry.count += 1;
    }
    return Array.from(byDocument.values())
      .filter((row) => row.count > 0)
      .sort((a, b) => b.count - a.count || a.documentName.localeCompare(b.documentName, undefined, { sensitivity: "base" }));
  }, [showCoverage, filteredAnns, selDocIds, storeDocs]);

  const annotationLengthStats = useMemo(() => {
    const empty = {
      rows: [] as {
        codeId: string;
        codeName: string;
        codeColor: string;
        count: number;
        min: number;
        q1: number;
        median: number;
        q3: number;
        max: number;
        mean: number;
      }[],
      maxValue: 0,
    };
    if (!showCoverage || filteredAnns.length === 0) return empty;
    const visibleCodes = storeCodes.filter((c) => selCodeIds.has(c.id));
    const byCode = new Map<string, { codeId: string; codeName: string; codeColor: string; lengths: number[] }>();
    for (const c of visibleCodes) {
      byCode.set(c.id, { codeId: c.id, codeName: c.label, codeColor: c.color, lengths: [] });
    }
    for (const ann of filteredAnns) {
      const entry = byCode.get(ann.codeId);
      if (entry) entry.lengths.push(Math.max(ann.quote?.length ?? 0, ann.endOffset - ann.startOffset, 0));
    }
    const rows = Array.from(byCode.values())
      .filter((entry) => entry.lengths.length > 0)
      .map((entry) => {
        const lengths = [...entry.lengths].sort((a, b) => a - b);
        const total = lengths.reduce((sum, value) => sum + value, 0);
        return {
          codeId: entry.codeId,
          codeName: entry.codeName,
          codeColor: entry.codeColor,
          count: lengths.length,
          min: lengths[0] ?? 0,
          q1: quantile(lengths, 0.25),
          median: quantile(lengths, 0.5),
          q3: quantile(lengths, 0.75),
          max: lengths[lengths.length - 1] ?? 0,
          mean: total / lengths.length,
        };
      })
      .sort((a, b) => b.count - a.count || a.codeName.localeCompare(b.codeName, undefined, { sensitivity: "base" }));
    const maxValue = rows.reduce((max, row) => Math.max(max, row.max), 0);
    return { rows, maxValue };
  }, [showCoverage, filteredAnns, selCodeIds, storeCodes]);

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

  function buildDefaultAttributeFilter(attr: AttributeItem, stats: Map<string, {
    textValues: string[];
    minNumber: number | null;
    maxNumber: number | null;
    minDate: number | null;
    maxDate: number | null;
  }>): AttributeFilterConfig {
    const current = stats.get(attr.id);
    if (attr.dataType === "number") {
      return {
        min: current?.minNumber != null ? String(current.minNumber) : "",
        max: current?.maxNumber != null ? String(current.maxNumber) : "",
      };
    }
    if (attr.dataType === "datetime") {
      return {
        min: formatDateInputValue(current?.minDate ?? null),
        max: formatDateInputValue(current?.maxDate ?? null),
      };
    }
    return {
      selectedValues: current?.textValues ?? [],
    };
  }

  function toggle(set: Set<string>, id: string) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }

  function applySelectionSets(nextCaseIds: Set<string>, nextDocIds: Set<string>, nextCodeIds: Set<string>, nextUserIds: Set<string>) {
    setSelCaseIds(new Set(nextCaseIds));
    setSelDocIds(new Set(nextDocIds));
    setSelCodeIds(new Set(nextCodeIds));
    setSelUserIds(new Set(nextUserIds));
  }

  function clearPrimarySelections() {
    applySelectionSets(new Set(), new Set(), new Set(), new Set());
  }

  function toggleCaseAttributeSelection(attr: AttributeItem) {
    const next = toggle(selCaseAttrIds, attr.id);
    setSelCaseAttrIds(next);
    if (next.has(attr.id)) {
      setCaseAttributeFilters((prev) => prev[attr.id] ? prev : {
        ...prev,
        [attr.id]: buildDefaultAttributeFilter(attr, caseAttributeValueStats),
      });
    }
  }

  function toggleDocumentAttributeSelection(attr: AttributeItem) {
    const next = toggle(selDocAttrIds, attr.id);
    setSelDocAttrIds(next);
    if (next.has(attr.id)) {
      setDocumentAttributeFilters((prev) => prev[attr.id] ? prev : {
        ...prev,
        [attr.id]: buildDefaultAttributeFilter(attr, documentAttributeValueStats),
      });
    }
  }

  function selectAllCaseAttributes() {
    setSelCaseAttrIds(new Set(displayCaseAttributeItems.map((item) => item.id)));
    setCaseAttributeFilters((prev) => {
      const next = { ...prev };
      for (const item of displayCaseAttributeItems) {
        if (!next[item.id]) next[item.id] = buildDefaultAttributeFilter(item, caseAttributeValueStats);
      }
      return next;
    });
  }

  function selectAllDocumentAttributes() {
    setSelDocAttrIds(new Set(displayDocumentAttributeItems.map((item) => item.id)));
    setDocumentAttributeFilters((prev) => {
      const next = { ...prev };
      for (const item of displayDocumentAttributeItems) {
        if (!next[item.id]) next[item.id] = buildDefaultAttributeFilter(item, documentAttributeValueStats);
      }
      return next;
    });
  }

  function clearCaseAttributeSelections() {
    setSelCaseAttrIds(new Set());
  }

  function clearDocumentAttributeSelections() {
    setSelDocAttrIds(new Set());
  }

  function updateCaseAttributeFilter(attrId: string, updates: AttributeFilterConfig) {
    setCaseAttributeFilters((prev) => ({
      ...prev,
      [attrId]: {
        ...prev[attrId],
        ...updates,
      },
    }));
  }

  function updateDocumentAttributeFilter(attrId: string, updates: AttributeFilterConfig) {
    setDocumentAttributeFilters((prev) => ({
      ...prev,
      [attrId]: {
        ...prev[attrId],
        ...updates,
      },
    }));
  }

  function applySelectionFromCases(nextCaseIds: Set<string>) {
    if (nextCaseIds.size === 0) {
      clearPrimarySelections();
      return;
    }
    const nextDocIds = new Set<string>();
    const nextCodeIds = new Set<string>();
    const nextUserIds = new Set<string>();
    for (const caseId of nextCaseIds) {
      for (const docId of caseDocMap.get(caseId) ?? []) {
        nextDocIds.add(docId);
      }
    }
    for (const ann of allAnns) {
      if (!nextDocIds.has(ann.documentId)) continue;
      nextCodeIds.add(ann.codeId);
      if (ann.createdById) nextUserIds.add(ann.createdById);
    }
    applySelectionSets(nextCaseIds, nextDocIds, nextCodeIds, nextUserIds);
  }

  function applySelectionFromDocuments(nextDocIds: Set<string>) {
    if (nextDocIds.size === 0) {
      clearPrimarySelections();
      return;
    }
    const nextCaseIds = new Set<string>();
    const nextCodeIds = new Set<string>();
    const nextUserIds = new Set<string>();
    for (const docId of nextDocIds) {
      for (const caseId of docCaseMap.get(docId) ?? []) {
        nextCaseIds.add(caseId);
      }
    }
    for (const ann of allAnns) {
      if (!nextDocIds.has(ann.documentId)) continue;
      nextCodeIds.add(ann.codeId);
      if (ann.createdById) nextUserIds.add(ann.createdById);
    }
    applySelectionSets(nextCaseIds, nextDocIds, nextCodeIds, nextUserIds);
  }

  function applySelectionFromCodes(nextCodeIds: Set<string>) {
    if (nextCodeIds.size === 0) {
      clearPrimarySelections();
      return;
    }
    const nextDocIds = new Set<string>();
    const nextCaseIds = new Set<string>();
    const nextUserIds = new Set<string>();
    for (const ann of allAnns) {
      if (!nextCodeIds.has(ann.codeId)) continue;
      nextDocIds.add(ann.documentId);
      if (ann.createdById) nextUserIds.add(ann.createdById);
    }
    for (const docId of nextDocIds) {
      for (const caseId of docCaseMap.get(docId) ?? []) {
        nextCaseIds.add(caseId);
      }
    }
    applySelectionSets(nextCaseIds, nextDocIds, nextCodeIds, nextUserIds);
  }

  function applySelectionFromUsers(nextUserIds: Set<string>) {
    if (nextUserIds.size === 0) {
      clearPrimarySelections();
      return;
    }
    const nextDocIds = new Set<string>();
    const nextCaseIds = new Set<string>();
    const nextCodeIds = new Set<string>();
    for (const ann of allAnns) {
      if (!nextUserIds.has(ann.createdById)) continue;
      nextDocIds.add(ann.documentId);
      nextCodeIds.add(ann.codeId);
    }
    for (const docId of nextDocIds) {
      for (const caseId of docCaseMap.get(docId) ?? []) {
        nextCaseIds.add(caseId);
      }
    }
    applySelectionSets(nextCaseIds, nextDocIds, nextCodeIds, nextUserIds);
  }

  async function handleSave() {
    if (!canStartReports) return;
    if (!activeProject || !name.trim()) return;
    if (selCaseIds.size === 0 || selDocIds.size === 0 || selCodeIds.size === 0 || selUserIds.size === 0) {
      setError("Select at least one case, document, code, and user before saving the report.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const descHtml = editor?.getHTML();
      const snapshot: ReportSnapshot = {
        reportType: "annotations",
        filteredAnns,
        caseItems,
        userItems,
        caseAttributeItems,
        documentAttributeItems,
        caseDocLinks,
        selectedUserIds: [...selUserIds],
        selectedCaseAttributeIds: [...selCaseAttrIds],
        selectedDocumentAttributeIds: [...selDocAttrIds],
        caseAttributeFilters,
        documentAttributeFilters,
        description: hasDescriptionContent(descHtml) ? descHtml : undefined,
        showDescription,
        showStatistics: showCoverage,
        showContext,
        contextChars,
        annotationGroupBy,
        annotationSortBy,
        summaryCounts: {
          cases: selCaseIds.size,
          docs:  selDocIds.size,
          codes: selCodeIds.size,
          users: selUserIds.size,
        },
      };
      const record = await createCodeReport({
        name:        name.trim(),
        caseIds:     relationPreview([...selCaseIds]),
        documentIds: relationPreview([...selDocIds]),
        codeIds:     relationPreview([...selCodeIds]),
        createdBy:   currentUser?.id,
        snapshot:    JSON.stringify(snapshot),
      });
      if (!record) throw new Error("Failed to save report.");
      onSaved(record?.id);
    } catch (e) {
      console.error(e);
      setError(getPocketBaseErrorMessage(e));
      setSaving(false);
    }
  }

  // Summary counts — from snapshot for frozen, derived for live
  const caseCount = frozenCounts?.cases ?? selCaseIds.size;
  const docCount  = frozenCounts?.docs  ?? selDocIds.size;
  const codeCount = frozenCounts?.codes ?? selCodeIds.size;
  const userCount = frozenCounts?.users ?? selUserIds.size;

  const displayCaseItems = isFrozen ? frozenCaseItems : caseItems;
  const displayUserItems = isFrozen ? frozenUserItems : userItems;
  const displayCaseAttributeItems = isFrozen ? frozenCaseAttributeItems : caseAttributeItems;
  const displayDocumentAttributeItems = isFrozen ? frozenDocumentAttributeItems : documentAttributeItems;

  const uniqueByName = (items: { id: string; name: string }[]) => {
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = `${item.id}:${item.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const includedCaseItems = displayCaseItems.filter((item) => selCaseIds.has(item.id));

  const includedDocumentItems = (() => {
    const selected = storeDocs.filter((doc) => selDocIds.has(doc.id));
    if (selected.length > 0 || !isFrozen) {
      return selected.map((doc) => ({ id: doc.id, name: doc.name }));
    }
    return uniqueByName(filteredAnns.map((ann) => ({ id: ann.documentId, name: ann.documentName })));
  })();

  const includedCodeItems = (() => {
    const selected = storeCodes.filter((code) => selCodeIds.has(code.id));
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

  const includedUserItems = displayUserItems.filter((item) => selUserIds.has(item.id));

  const summaryCards: { key: string; label: string; value: number; items: SummaryItem[]; expandable?: boolean }[] = [
    { key: "cases",       label: "Cases",       value: caseCount,           items: includedCaseItems },
    { key: "documents",   label: "Documents",   value: docCount,            items: includedDocumentItems },
    { key: "codes",       label: "Codes",       value: codeCount,           items: includedCodeItems },
    { key: "users",       label: "Users",       value: userCount,           items: includedUserItems },
    { key: "annotations", label: "Annotations", value: filteredAnns.length, items: [], expandable: false },
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

  function renderAttributeFilterEditors(
    items: AttributeItem[],
    selectedIds: Set<string>,
    filters: Record<string, AttributeFilterConfig>,
    stats: Map<string, { textValues: string[]; minNumber: number | null; maxNumber: number | null; minDate: number | null; maxDate: number | null }>,
    onUpdate: (attrId: string, updates: AttributeFilterConfig) => void,
  ) {
    const selectedItems = items.filter((item) => selectedIds.has(item.id));
    if (selectedItems.length === 0) return null;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "0 14px 14px" }}>
        {selectedItems.map((item) => {
          const stat = stats.get(item.id);
          const filter = filters[item.id] ?? {};
          if (item.dataType === "number") {
            const minBound = stat?.minNumber ?? 0;
            const maxBound = stat?.maxNumber ?? 0;
            const minValue = parseNumericValue(filter.min) ?? minBound;
            const maxValue = parseNumericValue(filter.max) ?? maxBound;
            return (
              <div key={item.id} style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: 12, background: "var(--color-surface-alt)" }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{item.name}</div>
                {stat?.minNumber == null || stat.maxNumber == null ? (
                  <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>No numeric values are available for this attribute yet.</div>
                ) : (
                  <>
                    <div style={{ position: "relative", height: 34, marginBottom: 10 }}>
                      <div style={{ position: "absolute", left: 0, right: 0, top: 15, height: 4, borderRadius: 999, background: "var(--color-border)", zIndex: 0 }} />
                      <div
                        style={{
                          position: "absolute",
                          top: 15,
                          height: 4,
                          borderRadius: 999,
                          background: "var(--color-primary)",
                          left: `${((minValue - minBound) / Math.max(maxBound - minBound, 1)) * 100}%`,
                          right: `${100 - ((maxValue - minBound) / Math.max(maxBound - minBound, 1)) * 100}%`,
                          zIndex: 1,
                        }}
                      />
                      <input
                        type="range"
                        min={minBound}
                        max={maxBound}
                        step="any"
                        className="report-range-thumb report-range-thumb--min"
                        value={Math.min(minValue, maxValue)}
                        disabled={isFrozen}
                        onChange={(e) => {
                          const nextMin = Math.min(Number(e.target.value), parseNumericValue(filters[item.id]?.max) ?? maxBound);
                          onUpdate(item.id, { min: String(nextMin) });
                        }}
                        style={{ position: "absolute", inset: 0, width: "100%", background: "transparent", zIndex: 3 }}
                      />
                      <input
                        type="range"
                        min={minBound}
                        max={maxBound}
                        step="any"
                        className="report-range-thumb report-range-thumb--max"
                        value={Math.max(maxValue, minValue)}
                        disabled={isFrozen}
                        onChange={(e) => {
                          const nextMax = Math.max(Number(e.target.value), parseNumericValue(filters[item.id]?.min) ?? minBound);
                          onUpdate(item.id, { max: String(nextMax) });
                        }}
                        style={{ position: "absolute", inset: 0, width: "100%", background: "transparent", zIndex: 4 }}
                      />
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                      <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, fontSize: 12 }}>
                        <span style={{ color: "var(--color-text-muted)" }}>Minimum</span>
                        <input
                          className="form-input"
                          type="number"
                          value={filter.min ?? ""}
                          min={minBound}
                          max={maxValue}
                          step="any"
                          disabled={isFrozen}
                          onChange={(e) => onUpdate(item.id, { min: e.target.value })}
                        />
                      </label>
                      <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, fontSize: 12 }}>
                        <span style={{ color: "var(--color-text-muted)" }}>Maximum</span>
                        <input
                          className="form-input"
                          type="number"
                          value={filter.max ?? ""}
                          min={minValue}
                          max={maxBound}
                          step="any"
                          disabled={isFrozen}
                          onChange={(e) => onUpdate(item.id, { max: e.target.value })}
                        />
                      </label>
                    </div>
                  </>
                )}
              </div>
            );
          }
          if (item.dataType === "datetime") {
            return (
              <div key={item.id} style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: 12, background: "var(--color-surface-alt)" }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{item.name}</div>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, fontSize: 12 }}>
                    <span style={{ color: "var(--color-text-muted)" }}>From</span>
                    <input
                      className="form-input"
                      type="datetime-local"
                      value={filter.min ?? ""}
                      min={formatDateInputValue(stat?.minDate ?? null)}
                      max={filter.max || formatDateInputValue(stat?.maxDate ?? null)}
                      disabled={isFrozen}
                      onChange={(e) => onUpdate(item.id, { min: e.target.value })}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, fontSize: 12 }}>
                    <span style={{ color: "var(--color-text-muted)" }}>To</span>
                    <input
                      className="form-input"
                      type="datetime-local"
                      value={filter.max ?? ""}
                      min={filter.min || formatDateInputValue(stat?.minDate ?? null)}
                      max={formatDateInputValue(stat?.maxDate ?? null)}
                      disabled={isFrozen}
                      onChange={(e) => onUpdate(item.id, { max: e.target.value })}
                    />
                  </label>
                </div>
              </div>
            );
          }
          const selectedValues = new Set(filter.selectedValues ?? stat?.textValues ?? []);
          return (
            <div key={item.id} style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: 12, background: "var(--color-surface-alt)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{item.name}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} disabled={isFrozen} onClick={() => onUpdate(item.id, { selectedValues: stat?.textValues ?? [] })}>All</button>
                  <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} disabled={isFrozen} onClick={() => onUpdate(item.id, { selectedValues: [] })}>Clear</button>
                </div>
              </div>
              <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid var(--color-border)", borderRadius: 8, background: "var(--color-surface)" }}>
                {(stat?.textValues ?? []).length === 0 ? (
                  <div style={{ padding: 10, fontSize: 12, color: "var(--color-text-muted)" }}>No text values are available for this attribute yet.</div>
                ) : (
                  <ul className="code-list">
                    {(stat?.textValues ?? []).map((value) => (
                      <li
                        key={`${item.id}-${value}`}
                        className="code-item"
                        style={{ cursor: isFrozen ? "default" : "pointer" }}
                        onClick={isFrozen ? undefined : () => {
                          const next = new Set(selectedValues);
                          if (next.has(value)) next.delete(value); else next.add(value);
                          onUpdate(item.id, { selectedValues: [...next] });
                        }}
                      >
                        <input
                          type="checkbox"
                          className="memo-sel-checkbox"
                          checked={selectedValues.has(value)}
                          disabled={isFrozen}
                          onChange={(e) => {
                            e.stopPropagation();
                            const next = new Set(selectedValues);
                            if (next.has(value)) next.delete(value); else next.add(value);
                            onUpdate(item.id, { selectedValues: [...next] });
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="code-label">{value}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function describeAttributeFilters(
    items: AttributeItem[],
    selectedIds: Set<string>,
    filters: Record<string, AttributeFilterConfig>,
    stats: Map<string, { textValues: string[]; minNumber: number | null; maxNumber: number | null; minDate: number | null; maxDate: number | null }>,
  ): string[] {
    return items
      .filter((item) => selectedIds.has(item.id))
      .map((item) => {
        const filter = filters[item.id] ?? {};
        if (item.dataType === "number") {
          const min = filter.min?.trim();
          const max = filter.max?.trim();
          if (min && max) return `${item.name}: ${min} to ${max}`;
          if (min) return `${item.name}: at least ${min}`;
          if (max) return `${item.name}: at most ${max}`;
          return `${item.name}: any numeric value`;
        }
        if (item.dataType === "datetime") {
          const min = filter.min?.trim();
          const max = filter.max?.trim();
          if (min && max) return `${item.name}: ${fmtDate(min)} to ${fmtDate(max)}`;
          if (min) return `${item.name}: from ${fmtDate(min)}`;
          if (max) return `${item.name}: until ${fmtDate(max)}`;
          return `${item.name}: any date/time`;
        }
        const selectedValues = filter.selectedValues ?? stats.get(item.id)?.textValues ?? [];
        if (selectedValues.length === 0) return `${item.name}: no values selected`;
        if (selectedValues.length <= 3) return `${item.name}: ${selectedValues.join(", ")}`;
        return `${item.name}: ${selectedValues.slice(0, 3).join(", ")} +${selectedValues.length - 3} more`;
      });
  }

  function compareAnnotations(a: AnnItem, b: AnnItem): number {
    switch (annotationSortBy) {
      case "code":
        return (
          getCodeName(a).localeCompare(getCodeName(b), undefined, { sensitivity: "base" }) ||
          a.documentName.localeCompare(b.documentName, undefined, { sensitivity: "base" }) ||
          a.quote.localeCompare(b.quote, undefined, { sensitivity: "base" })
        );
      case "coder":
        return (
          getCoderName(a.createdById).localeCompare(getCoderName(b.createdById), undefined, { sensitivity: "base" }) ||
          a.documentName.localeCompare(b.documentName, undefined, { sensitivity: "base" }) ||
          a.quote.localeCompare(b.quote, undefined, { sensitivity: "base" })
        );
      case "quoteLength":
        return (
          (b.quote?.length ?? 0) - (a.quote?.length ?? 0) ||
          a.documentName.localeCompare(b.documentName, undefined, { sensitivity: "base" }) ||
          getCodeName(a).localeCompare(getCodeName(b), undefined, { sensitivity: "base" })
        );
      case "quote":
        return (
          a.quote.localeCompare(b.quote, undefined, { sensitivity: "base" }) ||
          a.documentName.localeCompare(b.documentName, undefined, { sensitivity: "base" })
        );
      case "document":
      default:
        return (
          a.documentName.localeCompare(b.documentName, undefined, { sensitivity: "base" }) ||
          getCodeName(a).localeCompare(getCodeName(b), undefined, { sensitivity: "base" }) ||
          a.quote.localeCompare(b.quote, undefined, { sensitivity: "base" })
        );
    }
  }

  const sortedAnns = useMemo(() => {
    return [...filteredAnns].sort(compareAnnotations);
  }, [filteredAnns, annotationSortBy, displayUserItems, displayCaseItems, storeCodes, selCaseIds, caseDocMap]);

  const groupedAnns = useMemo(() => {
    const getGroupMeta = (ann: AnnItem): { key: string; label: string } => {
      switch (annotationGroupBy) {
        case "code": {
          const label = getCodeName(ann);
          return { key: `code:${ann.codeId || label}`, label };
        }
        case "document":
          return { key: `document:${ann.documentId}`, label: ann.documentName };
        case "coder": {
          const label = getCoderName(ann.createdById);
          return { key: `coder:${ann.createdById || label}`, label };
        }
        case "none":
        default:
          return { key: "all", label: "Annotations" };
      }
    };

    const groups = new Map<string, { key: string; label: string; items: AnnItem[] }>();
    for (const ann of sortedAnns) {
      const meta = getGroupMeta(ann);
      if (!groups.has(meta.key)) groups.set(meta.key, { ...meta, items: [] });
      groups.get(meta.key)!.items.push(ann);
    }
    return Array.from(groups.values());
  }, [sortedAnns, annotationGroupBy, displayUserItems, storeCodes]);

  const caseFilterDetails = useMemo(
    () => describeAttributeFilters(displayCaseAttributeItems, selCaseAttrIds, caseAttributeFilters, caseAttributeValueStats),
    [displayCaseAttributeItems, selCaseAttrIds, caseAttributeFilters, caseAttributeValueStats],
  );

  const documentFilterDetails = useMemo(
    () => describeAttributeFilters(displayDocumentAttributeItems, selDocAttrIds, documentAttributeFilters, documentAttributeValueStats),
    [displayDocumentAttributeItems, selDocAttrIds, documentAttributeFilters, documentAttributeValueStats],
  );

  async function buildExportContentMap(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!showContext || !pb) return map;
    const docIds = [...new Set(filteredAnns.map((a) => a.documentId))];
    if (docIds.length === 0) return map;
    try {
      const docs = await pb.collection("documents").getFullList({
        filter: docIds.map((id) => `id="${id}"`).join("||"),
        fields: "id,content",
      });
      for (const d of docs) map.set(d.id, d.content ?? "");
    } catch { /* context not critical — skip silently */ }
    return map;
  }

  function annContext(ann: AnnItem, contentMap: Map<string, string>) {
    if (!showContext) return { before: "", after: "", ellipsisBefore: false, ellipsisAfter: false };
    const content = contentMap.get(ann.documentId) ?? "";
    if (!content) return { before: "", after: "", ellipsisBefore: false, ellipsisAfter: false };
    return {
      before:         content.slice(Math.max(0, ann.startOffset - contextChars), ann.startOffset),
      after:          content.slice(ann.endOffset, ann.endOffset + contextChars),
      ellipsisBefore: ann.startOffset > contextChars,
      ellipsisAfter:  ann.endOffset + contextChars < content.length,
    };
  }

  function getCoverageChartSvg(forExport = false): string | null {
    if ((!showCoverage && !forExport) || coverageStats.rows.length === 0) return null;
    const width = 760;
    const rowHeight = 30;
    const height = 56 + coverageStats.rows.length * rowHeight;
    const labelWidth = 170;
    const valueWidth = 58;
    const chartLeft = labelWidth;
    const chartRight = width - valueWidth - 18;
    const chartWidth = chartRight - chartLeft;
    const maxPct = coverageStats.rows[0]?.pct ?? 0;
    const scale = maxPct > 0 ? maxPct + 5 : 1;
    const rows = coverageStats.rows.map((row, index) => {
      const y = 34 + index * rowHeight;
      const barWidth = Math.max((row.pct / scale) * chartWidth, 1);
      return `
        <text x="${labelWidth - 10}" y="${y + 5}" text-anchor="end" font-size="12" fill="#687385">${escapeHtml(row.codeName)}</text>
        <rect x="${chartLeft}" y="${y - 8}" width="${chartWidth}" height="14" rx="7" fill="#eef2f6" />
        <rect x="${chartLeft}" y="${y - 8}" width="${barWidth}" height="14" rx="7" fill="${escapeHtml(row.codeColor)}" />
        <text x="${width - 14}" y="${y + 5}" text-anchor="end" font-size="12" fill="#687385">${row.pct < 0.1 ? "&lt;0.1" : row.pct.toFixed(1)}%</text>
      `;
    }).join("");
    return `
      <svg xmlns="http://www.w3.org/2000/svg" font-family="Aptos, Calibri, Arial, sans-serif" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
        <rect width="100%" height="100%" fill="#ffffff" />
        ${rows}
      </svg>
    `;
  }

  function getAnnotationFrequencyChartSvg(forExport = false): string | null {
    if ((!showCoverage && !forExport) || annotationFrequencyStats.length === 0) return null;
    const width = 760;
    const rowHeight = 30;
    const height = 56 + annotationFrequencyStats.length * rowHeight;
    const labelWidth = 170;
    const valueWidth = 58;
    const chartLeft = labelWidth;
    const chartRight = width - valueWidth - 18;
    const chartWidth = chartRight - chartLeft;
    const maxCount = annotationFrequencyStats[0]?.count ?? 0;
    const scale = maxCount > 0 ? maxCount : 1;
    const rows = annotationFrequencyStats.map((row, index) => {
      const y = 34 + index * rowHeight;
      const barWidth = Math.max((row.count / scale) * chartWidth, 1);
      return `
        <text x="${labelWidth - 10}" y="${y + 5}" text-anchor="end" font-size="12" fill="#687385">${escapeHtml(row.codeName)}</text>
        <rect x="${chartLeft}" y="${y - 8}" width="${chartWidth}" height="14" rx="7" fill="#eef2f6" />
        <rect x="${chartLeft}" y="${y - 8}" width="${barWidth}" height="14" rx="7" fill="${escapeHtml(row.codeColor)}" />
        <text x="${width - 14}" y="${y + 5}" text-anchor="end" font-size="12" fill="#687385">${row.count}</text>
      `;
    }).join("");
    return `
      <svg xmlns="http://www.w3.org/2000/svg" font-family="Aptos, Calibri, Arial, sans-serif" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
        <rect width="100%" height="100%" fill="#ffffff" />
        ${rows}
      </svg>
    `;
  }

  function getAnnotationDocumentChartSvg(forExport = false): string | null {
    if ((!showCoverage && !forExport) || annotationDocumentStats.length === 0) return null;
    const width = 760;
    const rowHeight = 30;
    const height = 56 + annotationDocumentStats.length * rowHeight;
    const labelWidth = 170;
    const valueWidth = 58;
    const chartLeft = labelWidth;
    const chartRight = width - valueWidth - 18;
    const chartWidth = chartRight - chartLeft;
    const maxCount = annotationDocumentStats[0]?.count ?? 0;
    const scale = maxCount > 0 ? maxCount : 1;
    const rows = annotationDocumentStats.map((row, index) => {
      const y = 34 + index * rowHeight;
      const barWidth = Math.max((row.count / scale) * chartWidth, 1);
      return `
        <text x="${labelWidth - 10}" y="${y + 5}" text-anchor="end" font-size="12" fill="#687385">${escapeHtml(row.documentName)}</text>
        <rect x="${chartLeft}" y="${y - 8}" width="${chartWidth}" height="14" rx="7" fill="#eef2f6" />
        <rect x="${chartLeft}" y="${y - 8}" width="${barWidth}" height="14" rx="7" fill="#687385" />
        <text x="${width - 14}" y="${y + 5}" text-anchor="end" font-size="12" fill="#687385">${row.count}</text>
      `;
    }).join("");
    return `
      <svg xmlns="http://www.w3.org/2000/svg" font-family="Aptos, Calibri, Arial, sans-serif" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
        <rect width="100%" height="100%" fill="#ffffff" />
        ${rows}
      </svg>
    `;
  }

  function getAnnotationLengthChartSvg(forExport = false): string | null {
    if ((!showCoverage && !forExport) || annotationLengthStats.rows.length === 0) return null;
    const width = 760;
    const height = Math.max(88 + annotationLengthStats.rows.length * 42, 140);
    const labelWidth = 190;
    const valueWidth = 24;
    const lineStart = labelWidth + 12;
    const lineEnd = width - valueWidth - 18;
    const lengthScale = annotationLengthStats.maxValue > 0 ? annotationLengthStats.maxValue : 1;
    const valueToX = (value: number) => lineStart + (value / lengthScale) * (lineEnd - lineStart);
    const rows = annotationLengthStats.rows.map((row, index) => {
      const rowY = 44 + index * 42;
      const rowBoxTop = rowY - 12;
      const rowBoxBottom = rowY + 12;
      return `
        <text x="${labelWidth}" y="${rowY + 4}" text-anchor="end" font-size="10" fill="#687385">${escapeHtml(row.codeName)}</text>
        <line x1="${lineStart}" y1="${rowY}" x2="${lineEnd}" y2="${rowY}" stroke="#d5dbe3" stroke-width="1" />
        <line x1="${valueToX(row.min)}" y1="${rowBoxTop + 4}" x2="${valueToX(row.min)}" y2="${rowBoxBottom - 4}" stroke="#687385" stroke-width="2" />
        <line x1="${valueToX(row.max)}" y1="${rowBoxTop + 4}" x2="${valueToX(row.max)}" y2="${rowBoxBottom - 4}" stroke="#687385" stroke-width="2" />
        <line x1="${valueToX(row.min)}" y1="${rowY}" x2="${valueToX(row.q1)}" y2="${rowY}" stroke="#687385" stroke-width="2" />
        <line x1="${valueToX(row.q3)}" y1="${rowY}" x2="${valueToX(row.max)}" y2="${rowY}" stroke="#687385" stroke-width="2" />
        <rect
          x="${valueToX(row.q1)}"
          y="${rowBoxTop}"
          width="${Math.max(valueToX(row.q3) - valueToX(row.q1), 2)}"
          height="${rowBoxBottom - rowBoxTop}"
          fill="${escapeHtml(row.codeColor)}"
          fill-opacity="0.18"
          stroke="${escapeHtml(row.codeColor)}"
          stroke-width="2"
          rx="6"
        />
        <line x1="${valueToX(row.median)}" y1="${rowBoxTop}" x2="${valueToX(row.median)}" y2="${rowBoxBottom}" stroke="${escapeHtml(row.codeColor)}" stroke-width="2" />
        <text x="${lineEnd + 6}" y="${rowY + 4}" font-size="10" fill="#687385">${row.count} anns</text>
      `;
    }).join("");
    return `
      <svg xmlns="http://www.w3.org/2000/svg" font-family="Aptos, Calibri, Arial, sans-serif" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
        <rect width="100%" height="100%" fill="#ffffff" />
        <text x="${lineStart}" y="20" text-anchor="middle" font-size="10" fill="#687385">0</text>
        <text x="${lineEnd}" y="20" text-anchor="middle" font-size="10" fill="#687385">${Math.round(annotationLengthStats.maxValue)}</text>
        ${rows}
      </svg>
    `;
  }

  function getCleanReportHtml(contentMap: Map<string, string> = new Map()): string {
    const title = name || "Untitled Report";
    const createdBy = row ? row.createdByName : (currentUser?.name || currentUser?.email || "Unknown");
    const createdAt = row ? fmtDate(row.createdAt) : fmtDate(new Date().toISOString());
    const descriptionHtml = getExportDescriptionHtml();
    const groupLabels: Record<string, string> = { none: "None", code: "Code", document: "Document", coder: "Coder" };
    const sortLabels: Record<string, string> = { document: "Document", code: "Code", coder: "Coder", quoteLength: "Quote Length", quote: "Quote (A–Z)" };

    const filterRows: string[] = [];
    if (selCaseIds.size > 0) {
      const names = displayCaseItems.filter((c) => selCaseIds.has(c.id)).map((c) => c.name).join(", ");
      filterRows.push(`<tr><td><strong>Cases</strong></td><td>${escapeHtml(names)}</td></tr>`);
    }
    if (selDocIds.size > 0) {
      const names = storeDocs.filter((d) => selDocIds.has(d.id)).map((d) => d.name).join(", ");
      filterRows.push(`<tr><td><strong>Documents</strong></td><td>${escapeHtml(names)}</td></tr>`);
    }
    if (selCodeIds.size > 0) {
      const names = storeCodes.filter((c) => selCodeIds.has(c.id)).map((c) => c.label).join(", ");
      filterRows.push(`<tr><td><strong>Codes</strong></td><td>${escapeHtml(names)}</td></tr>`);
    }
    if (selUserIds.size > 0) {
      const names = displayUserItems.filter((u) => selUserIds.has(u.id)).map((u) => u.name).join(", ");
      filterRows.push(`<tr><td><strong>Users</strong></td><td>${escapeHtml(names)}</td></tr>`);
    }
    if (caseFilterDetails.length > 0)
      filterRows.push(`<tr><td><strong>Case Attributes</strong></td><td>${escapeHtml(caseFilterDetails.join("; "))}</td></tr>`);
    if (documentFilterDetails.length > 0)
      filterRows.push(`<tr><td><strong>Document Attributes</strong></td><td>${escapeHtml(documentFilterDetails.join("; "))}</td></tr>`);
    const filtersHtml = filterRows.length > 0
      ? `<h2>Applied Filters</h2><table class="details">${filterRows.join("")}</table>`
      : "";

    const statisticsHtml = [
      { title: "Code Coverage", subtitle: `% of ${coverageStats.totalChars.toLocaleString()} characters`, image: getCoverageChartSvg(true) },
      { title: "Annotations Per Code", subtitle: "Count of annotations by code", image: getAnnotationFrequencyChartSvg(true) },
      { title: "Annotations Per Document", subtitle: "Count of annotations by document", image: getAnnotationDocumentChartSvg(true) },
      { title: "Annotation Length", subtitle: "Box-and-whisker summary in characters", image: getAnnotationLengthChartSvg(true) },
    ]
      .filter((item) => item.image)
      .map((item) => `
        <section class="chart-card">
          <h3>${escapeHtml(item.title)}</h3>
          <p class="chart-subtitle">${escapeHtml(item.subtitle)}</p>
          <img class="chart-image" src="${svgToDataUrl(item.image!)}" alt="${escapeHtml(item.title)}" />
        </section>
      `)
      .join("");

    const annGroupHtml = (items: AnnItem[]) => items.map((ann) => {
      const ctx = annContext(ann, contentMap);
      const quotePart = ctx.before || ctx.after
        ? [
            ctx.before ? `<span class="ctx">${escapeHtml((ctx.ellipsisBefore ? "…" : "") + ctx.before)}</span>` : "",
            escapeHtml(ann.quote),
            ctx.after ? `<span class="ctx">${escapeHtml(ctx.after + (ctx.ellipsisAfter ? "…" : ""))}</span>` : "",
          ].join("")
        : escapeHtml(ann.quote);
      return `
        <section class="annotation">
          <div class="annotation-meta">
            <span class="code" style="background-color:${escapeHtml(ann.codeColor)}">${escapeHtml(ann.codeName)}</span>
            <span>${escapeHtml(ann.documentName)}</span>
            <span>${escapeHtml(getCoderName(ann.createdById))}</span>
            <span>${escapeHtml(getCaseNameForAnn(ann))}</span>
          </div>
          <blockquote>${quotePart}</blockquote>
          ${ann.note ? `<p class="note"><strong>Note:</strong> ${escapeHtml(ann.note)}</p>` : ""}
        </section>
      `;
    }).join("");

    const annotationHtml = sortedAnns.length === 0
      ? `<p class="muted">No annotations were captured in this report.</p>`
      : annotationGroupBy === "none"
        ? annGroupHtml(sortedAnns)
        : groupedAnns.map((group) => `
            <h3 class="group-header">${escapeHtml(group.label)} <span class="group-count">(${group.items.length})</span></h3>
            ${annGroupHtml(group.items)}
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
      .chart-card { border: 1px solid #d5dbe3; border-radius: 10px; padding: 14px; margin: 0 0 16px; page-break-inside: avoid; }
      .chart-card h3 { font-size: 15px; margin: 0 0 4px; }
      .chart-subtitle { margin: 0 0 10px; color: #687385; font-size: 12px; }
      .chart-image { width: 100%; height: auto; display: block; }
      .annotation { border-top: 1px solid #d5dbe3; padding: 13px 0; page-break-inside: avoid; }
      .annotation-meta { color: #687385; font-size: 12px; margin-bottom: 7px; }
      .annotation-meta span { margin-right: 10px; }
      .code { color: #fff; border-radius: 4px; padding: 2px 6px; font-weight: 700; }
      blockquote { margin: 7px 0; padding-left: 12px; border-left: 3px solid #b7c1ce; }
      .ctx { color: #9aa5b4; }
      .note { margin: 7px 0 0; }
      .group-header { font-size: 14px; margin: 20px 0 4px; color: #687385; border-bottom: 1px solid #d5dbe3; padding-bottom: 4px; }
      .group-count { font-weight: 400; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    <table class="details">
      <tr><td><strong>Created by</strong></td><td>${escapeHtml(createdBy)}</td></tr>
      <tr><td><strong>Created</strong></td><td>${escapeHtml(createdAt)}</td></tr>
      <tr><td><strong>Group by</strong></td><td>${escapeHtml(groupLabels[annotationGroupBy] ?? annotationGroupBy)}</td></tr>
      <tr><td><strong>Sort by</strong></td><td>${escapeHtml(sortLabels[annotationSortBy] ?? annotationSortBy)}</td></tr>
    </table>
    ${descriptionHtml ? `<h2>Description</h2><div class="description">${descriptionHtml}</div>` : ""}
    <h2>Summary</h2>
    <table class="summary">
      <tr><th>Cases</th><th>Documents</th><th>Codes</th><th>Users</th><th>Annotations</th></tr>
      <tr><td>${caseCount}</td><td>${docCount}</td><td>${codeCount}</td><td>${userCount}</td><td>${filteredAnns.length}</td></tr>
    </table>
    ${filtersHtml}
    ${statisticsHtml ? `<h2>Statistics</h2>${statisticsHtml}` : ""}
    <h2>Annotations</h2>
    ${annotationHtml}
  </body>
</html>`;
  }

  async function handleExportXLSX() {
    if (!canExportReports) return;
    try {
      setExportingFormat("xlsx");
      const path = await save({ defaultPath: `${name || "Report"}.xlsx`, filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }] });
      if (!path) return;

      const workbook = new ExcelJS.Workbook();
      workbook.creator = currentUser?.name || currentUser?.email || "Kanqual";
      workbook.created = new Date();

      const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE1E4EA" } };
      function styleHeaderCell(cell: ExcelJS.Cell) { cell.font = { bold: true }; cell.fill = HEADER_FILL; }

      const createdBy = row ? row.createdByName : (currentUser?.name || currentUser?.email || "Unknown");
      const createdAt = row ? fmtDate(row.createdAt) : fmtDate(new Date().toISOString());
      const groupLabels: Record<string, string> = { none: "None", code: "Code", document: "Document", coder: "Coder" };
      const sortLabels: Record<string, string> = { document: "Document", code: "Code", coder: "Coder", quoteLength: "Quote Length", quote: "Quote (A–Z)" };

      // ── Sheet 1: Report metadata ─────────────────────────────────────────
      const meta = workbook.addWorksheet("Report");
      meta.columns = [{ width: 22 }, { width: 62 }];

      meta.mergeCells("A1:B1");
      const titleCell = meta.getCell("A1");
      titleCell.value = name || "Untitled Report";
      titleCell.font = { bold: true, size: 16 };

      meta.addRow([]);
      meta.addRow(["Created by", createdBy]);
      meta.addRow(["Created", createdAt]);
      meta.addRow(["Group by", groupLabels[annotationGroupBy] ?? annotationGroupBy]);
      meta.addRow(["Sort by", sortLabels[annotationSortBy] ?? annotationSortBy]);

      const description = htmlToPlainText(getExportDescriptionHtml());
      if (description) {
        meta.addRow([]);
        const dh = meta.addRow(["Description"]); dh.getCell(1).font = { bold: true };
        for (const line of description.split(/\n+/).filter(Boolean)) meta.addRow([line]);
      }

      meta.addRow([]);
      const sh = meta.addRow(["Summary"]); sh.getCell(1).font = { bold: true };
      meta.addRow(["Cases",       caseCount]);
      meta.addRow(["Documents",   docCount]);
      meta.addRow(["Codes",       codeCount]);
      meta.addRow(["Users",       userCount]);
      meta.addRow(["Annotations", filteredAnns.length]);

      const filterLines: Array<[string, string]> = [];
      if (selCaseIds.size  > 0) filterLines.push(["Cases",       displayCaseItems.filter(c => selCaseIds.has(c.id)).map(c => c.name).join(", ")]);
      if (selDocIds.size   > 0) filterLines.push(["Documents",   storeDocs.filter(d => selDocIds.has(d.id)).map(d => d.name).join(", ")]);
      if (selCodeIds.size  > 0) filterLines.push(["Codes",       storeCodes.filter(c => selCodeIds.has(c.id)).map(c => c.label).join(", ")]);
      if (selUserIds.size  > 0) filterLines.push(["Users",       displayUserItems.filter(u => selUserIds.has(u.id)).map(u => u.name).join(", ")]);
      if (caseFilterDetails.length     > 0) filterLines.push(["Case Attributes",     caseFilterDetails.join("; ")]);
      if (documentFilterDetails.length > 0) filterLines.push(["Document Attributes", documentFilterDetails.join("; ")]);
      if (filterLines.length > 0) {
        meta.addRow([]);
        const fh = meta.addRow(["Applied Filters"]); fh.getCell(1).font = { bold: true };
        for (const [label, value] of filterLines) meta.addRow([label, value]);
      }

      // ── Sheet 2: Statistics charts ───────────────────────────────────────
      const statsSheet = workbook.addWorksheet("Statistics");
      statsSheet.columns = [{ width: 10 }];
      let sr = 1;

      const charts = [
        { title: "Code Coverage",            subtitle: `% of ${coverageStats.totalChars.toLocaleString()} characters`, svg: getCoverageChartSvg(true) },
        { title: "Annotations Per Code",     subtitle: "Count of annotations by code",               svg: getAnnotationFrequencyChartSvg(true) },
        { title: "Annotations Per Document", subtitle: "Count of annotations by document",            svg: getAnnotationDocumentChartSvg(true) },
        { title: "Annotation Length",        subtitle: "Box-and-whisker summary in characters",       svg: getAnnotationLengthChartSvg(true) },
      ].filter((c): c is { title: string; subtitle: string; svg: string } => c.svg !== null);

      for (const chart of charts) {
        statsSheet.getCell(sr, 1).value = chart.title;
        statsSheet.getCell(sr, 1).font = { bold: true, size: 13 };
        sr++;
        statsSheet.getCell(sr, 1).value = chart.subtitle;
        statsSheet.getCell(sr, 1).font = { italic: true, color: { argb: "FF687385" } };
        sr++;
        try {
          const png = await svgToPngDataUrl(chart.svg);
          const wMatch = chart.svg.match(/width="(\d+)"/);
          const hMatch = chart.svg.match(/height="(\d+)"/);
          const nativeW = wMatch ? parseInt(wMatch[1], 10) : 760;
          const nativeH = hMatch ? parseInt(hMatch[1], 10) : 260;
          const displayW = 500;
          const displayH = Math.round((nativeH / nativeW) * displayW);
          const imgId = workbook.addImage({ base64: png.split(",")[1], extension: "png" });
          statsSheet.addImage(imgId, { tl: { col: 0, row: sr - 1 }, ext: { width: displayW, height: displayH } });
          sr += Math.ceil(displayH / 19) + 2;
        } catch {
          sr += 2;
        }
      }

      // ── Sheet 3: Annotations data ────────────────────────────────────────
      const annSheet = workbook.addWorksheet("Annotations");
      const withGroup = annotationGroupBy !== "none";
      const contentMap = await buildExportContentMap();
      const withContext = showContext && contentMap.size > 0;

      annSheet.columns = [
        ...(withGroup ? [{ width: 20 }] : []),
        { width: 20 }, { width: 26 }, { width: 18 }, { width: 20 }, { width: 52 },
        ...(withContext ? [{ width: 42 }, { width: 42 }] : []),
        { width: 32 },
      ];

      const headers = [
        ...(withGroup ? ["Group"] : []),
        "Case", "Document", "Coder", "Code", "Quote",
        ...(withContext ? ["Context Before", "Context After"] : []),
        "Note",
      ];
      const hdrRow = annSheet.addRow(headers);
      hdrRow.eachCell((cell) => styleHeaderCell(cell));
      annSheet.views = [{ state: "frozen", ySplit: 1 }];

      const annToGroup = new Map<string, string>();
      if (withGroup) {
        for (const group of groupedAnns) {
          for (const ann of group.items) annToGroup.set(ann.id, group.label);
        }
      }

      for (const ann of sortedAnns) {
        const ctx = withContext ? annContext(ann, contentMap) : null;
        annSheet.addRow([
          ...(withGroup ? [annToGroup.get(ann.id) ?? groupLabels[annotationGroupBy]] : []),
          getCaseNameForAnn(ann),
          ann.documentName,
          displayUserItems.find(u => u.id === ann.createdById)?.name || "—",
          getCodeName(ann),
          ann.quote,
          ...(withContext ? [
            ctx ? (ctx.ellipsisBefore ? "…" : "") + ctx.before : "",
            ctx ? ctx.after + (ctx.ellipsisAfter ? "…" : "") : "",
          ] : []),
          ann.note,
        ]);
      }

      const buffer = await workbook.xlsx.writeBuffer();
      await writeFile(path, new Uint8Array(buffer as ArrayBuffer));
    } catch (e) {
      console.error("XLSX export failed:", e);
      setError("XLSX export failed.");
    } finally {
      setExportingFormat(null);
      setShowExportModal(false);
    }
  }

  async function handleExportHTML() {
    if (!canExportReports) return;
    try {
      setExportingFormat("html");
      const path = await save({ defaultPath: `${name || "Report"}.html`, filters: [{ name: "HTML", extensions: ["html"] }] });
      if (!path) return;
      const contentMap = await buildExportContentMap();
      await writeTextFile(path, getCleanReportHtml(contentMap));
    } catch (e) {
      setError("HTML export failed.");
    } finally {
      setExportingFormat(null);
      setShowExportModal(false);
    }
  }

  async function handleExportPDF() {
    if (!canExportReports) return;
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

      const pdfGroupLabels: Record<string, string> = { none: "None", code: "Code", document: "Document", coder: "Coder" };
      const pdfSortLabels: Record<string, string> = { document: "Document", code: "Code", coder: "Coder", quoteLength: "Quote Length", quote: "Quote (A–Z)" };

      addText(name || "Untitled Report", 20, "bold", 14);
      addText(`Created by: ${row ? row.createdByName : (currentUser?.name || currentUser?.email || "Unknown")}`, 10);
      addText(`Created: ${row ? fmtDate(row.createdAt) : fmtDate(new Date().toISOString())}`, 10);
      addText(`Group by: ${pdfGroupLabels[annotationGroupBy] ?? annotationGroupBy}   Sort by: ${pdfSortLabels[annotationSortBy] ?? annotationSortBy}`, 10, "normal", 14);

      const description = htmlToPlainText(getExportDescriptionHtml());
      if (description) {
        addText("Description", 14, "bold", 8);
        addText(description, 10, "normal", 14);
      }

      addText("Summary", 14, "bold", 8);
      addText(`Cases: ${caseCount}   Documents: ${docCount}   Codes: ${codeCount}   Users: ${userCount}   Annotations: ${filteredAnns.length}`, 10, "normal", 8);

      const pdfFilterLines: string[] = [];
      if (selCaseIds.size > 0) pdfFilterLines.push(`Cases: ${displayCaseItems.filter((c) => selCaseIds.has(c.id)).map((c) => c.name).join(", ")}`);
      if (selDocIds.size > 0)  pdfFilterLines.push(`Documents: ${storeDocs.filter((d) => selDocIds.has(d.id)).map((d) => d.name).join(", ")}`);
      if (selCodeIds.size > 0) pdfFilterLines.push(`Codes: ${storeCodes.filter((c) => selCodeIds.has(c.id)).map((c) => c.label).join(", ")}`);
      if (selUserIds.size > 0) pdfFilterLines.push(`Users: ${displayUserItems.filter((u) => selUserIds.has(u.id)).map((u) => u.name).join(", ")}`);
      if (caseFilterDetails.length > 0) pdfFilterLines.push(`Case Attributes: ${caseFilterDetails.join("; ")}`);
      if (documentFilterDetails.length > 0) pdfFilterLines.push(`Document Attributes: ${documentFilterDetails.join("; ")}`);
      if (pdfFilterLines.length > 0) {
        addText("Applied Filters", 14, "bold", 8);
        for (const line of pdfFilterLines) addText(line, 9, "normal", 4);
        y += 10;
      }

      const pdfCharts = [
        { title: "Code Coverage", svg: getCoverageChartSvg(true) },
        { title: "Annotations Per Code", svg: getAnnotationFrequencyChartSvg(true) },
        { title: "Annotations Per Document", svg: getAnnotationDocumentChartSvg(true) },
        { title: "Annotation Length", svg: getAnnotationLengthChartSvg(true) },
      ].filter((c): c is { title: string; svg: string } => c.svg !== null);

      if (pdfCharts.length > 0) {
        addText("Statistics", 14, "bold", 8);
        for (const chart of pdfCharts) {
          addText(chart.title, 11, "bold", 4);
          try {
            const pngDataUrl = await svgToPngDataUrl(chart.svg);
            const wMatch = chart.svg.match(/width="(\d+)"/);
            const hMatch = chart.svg.match(/height="(\d+)"/);
            const nativeW = wMatch ? parseInt(wMatch[1], 10) : 760;
            const nativeH = hMatch ? parseInt(hMatch[1], 10) : 260;
            const displayW = contentWidth;
            const displayH = (nativeH / nativeW) * displayW;
            ensureSpace(displayH + 16);
            pdf.addImage(pngDataUrl, "PNG", margin, y, displayW, displayH);
            y += displayH + 12;
          } catch (e) {
            console.error("PDF chart render failed:", e);
          }
        }
      }

      const pdfContentMap = await buildExportContentMap();

      addText("Annotations", 14, "bold", 8);

      const addAnnBlock = (ann: AnnItem) => {
        ensureSpace(76);
        pdf.setDrawColor(210);
        pdf.line(margin, y, pageWidth - margin, y);
        y += 14;
        addText(`${ann.codeName} | ${ann.documentName} | ${getCoderName(ann.createdById)} | ${getCaseNameForAnn(ann)}`, 9, "bold", 6);
        const ctx = annContext(ann, pdfContentMap);
        if (ctx.before) addText(`${ctx.ellipsisBefore ? "…" : ""}${ctx.before}`, 9, "italic", 2);
        addText(`"${ann.quote}"`, 10, "italic", ctx.after ? 2 : 6);
        if (ctx.after) addText(`${ctx.after}${ctx.ellipsisAfter ? "…" : ""}`, 9, "italic", 6);
        if (ann.note) addText(`Note: ${ann.note}`, 9, "normal", 10);
      };

      if (sortedAnns.length === 0) {
        addText("No annotations were captured in this report.", 10, "italic");
      } else if (annotationGroupBy === "none") {
        for (const ann of sortedAnns) addAnnBlock(ann);
      } else {
        for (const group of groupedAnns) {
          ensureSpace(30);
          addText(`${group.label} (${group.items.length})`, 11, "bold", 6);
          for (const ann of group.items) addAnnBlock(ann);
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
    if (!canExportReports) return;
    try {
      setExportingFormat("docx");
      const path = await save({ defaultPath: `${name || "Report"}.docx`, filters: [{ name: "Word Document", extensions: ["docx"] }] });
      if (!path) return;

      const docxGroupLabels: Record<string, string> = { none: "None", code: "Code", document: "Document", coder: "Coder" };
      const docxSortLabels: Record<string, string> = { document: "Document", code: "Code", coder: "Coder", quoteLength: "Quote Length", quote: "Quote (A–Z)" };

      const children: Paragraph[] = [
        new Paragraph({ text: name || "Untitled Report", heading: HeadingLevel.TITLE }),
        new Paragraph(`Created by: ${row ? row.createdByName : (currentUser?.name || currentUser?.email || "Unknown")}`),
        new Paragraph(`Created: ${row ? fmtDate(row.createdAt) : fmtDate(new Date().toISOString())}`),
        new Paragraph(`Group by: ${docxGroupLabels[annotationGroupBy] ?? annotationGroupBy}   |   Sort by: ${docxSortLabels[annotationSortBy] ?? annotationSortBy}`),
        new Paragraph({ text: "Summary", heading: HeadingLevel.HEADING_1 }),
        new Paragraph(`Cases: ${caseCount}   Documents: ${docCount}   Codes: ${codeCount}   Users: ${userCount}   Annotations: ${filteredAnns.length}`),
      ];

      const docxFilterLines: string[] = [];
      if (selCaseIds.size > 0) docxFilterLines.push(`Cases: ${displayCaseItems.filter((c) => selCaseIds.has(c.id)).map((c) => c.name).join(", ")}`);
      if (selDocIds.size > 0)  docxFilterLines.push(`Documents: ${storeDocs.filter((d) => selDocIds.has(d.id)).map((d) => d.name).join(", ")}`);
      if (selCodeIds.size > 0) docxFilterLines.push(`Codes: ${storeCodes.filter((c) => selCodeIds.has(c.id)).map((c) => c.label).join(", ")}`);
      if (selUserIds.size > 0) docxFilterLines.push(`Users: ${displayUserItems.filter((u) => selUserIds.has(u.id)).map((u) => u.name).join(", ")}`);
      if (caseFilterDetails.length > 0) docxFilterLines.push(`Case Attributes: ${caseFilterDetails.join("; ")}`);
      if (documentFilterDetails.length > 0) docxFilterLines.push(`Document Attributes: ${documentFilterDetails.join("; ")}`);
      if (docxFilterLines.length > 0) {
        children.push(new Paragraph({ text: "Applied Filters", heading: HeadingLevel.HEADING_1 }));
        for (const line of docxFilterLines) children.push(new Paragraph(line));
      }

      const description = htmlToPlainText(getExportDescriptionHtml());
      if (description) {
        children.push(new Paragraph({ text: "Description", heading: HeadingLevel.HEADING_1 }));
        for (const line of description.split(/\n+/).filter(Boolean)) {
          children.push(new Paragraph(line));
        }
      }

      const docxCharts = [
        { title: "Code Coverage", svg: getCoverageChartSvg(true) },
        { title: "Annotations Per Code", svg: getAnnotationFrequencyChartSvg(true) },
        { title: "Annotations Per Document", svg: getAnnotationDocumentChartSvg(true) },
        { title: "Annotation Length", svg: getAnnotationLengthChartSvg(true) },
      ].filter((c): c is { title: string; svg: string } => c.svg !== null);

      if (docxCharts.length > 0) {
        children.push(new Paragraph({ text: "Statistics", heading: HeadingLevel.HEADING_1 }));
        for (const chart of docxCharts) {
          children.push(new Paragraph({ children: [new TextRun({ text: chart.title, bold: true })] }));
          try {
            const pngDataUrl = await svgToPngDataUrl(chart.svg);
            const wMatch = chart.svg.match(/width="(\d+)"/);
            const hMatch = chart.svg.match(/height="(\d+)"/);
            const nativeW = wMatch ? parseInt(wMatch[1], 10) : 760;
            const nativeH = hMatch ? parseInt(hMatch[1], 10) : 260;
            const displayW = 480;
            const displayH = Math.round((nativeH / nativeW) * displayW);
            const base64 = pngDataUrl.split(",")[1];
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            children.push(new Paragraph({
              children: [new ImageRun({ type: "png", data: bytes.buffer, transformation: { width: displayW, height: displayH } })],
            }));
          } catch (e) {
            console.error("DOCX chart render failed:", e);
          }
        }
      }

      const docxContentMap = await buildExportContentMap();

      const addDocxAnn = (ann: AnnItem) => {
        const ctx = annContext(ann, docxContentMap);
        const quoteRuns: TextRun[] = [];
        if (ctx.before) quoteRuns.push(new TextRun({ text: (ctx.ellipsisBefore ? "…" : "") + ctx.before, italics: true, color: "9AA5B4" }));
        quoteRuns.push(new TextRun({ text: `"${ann.quote}"`, italics: true }));
        if (ctx.after) quoteRuns.push(new TextRun({ text: ctx.after + (ctx.ellipsisAfter ? "…" : ""), italics: true, color: "9AA5B4" }));
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: ann.codeName, bold: true }),
              new TextRun(` | ${ann.documentName} | ${getCoderName(ann.createdById)} | ${getCaseNameForAnn(ann)}`),
            ],
            spacing: { before: 240 },
          }),
          new Paragraph({ children: quoteRuns }),
        );
        if (ann.note) {
          children.push(new Paragraph({ children: [new TextRun({ text: "Note: ", bold: true }), new TextRun(ann.note)] }));
        }
      };

      children.push(new Paragraph({ text: "Annotations", heading: HeadingLevel.HEADING_1 }));
      if (sortedAnns.length === 0) {
        children.push(new Paragraph({ children: [new TextRun({ text: "No annotations were captured in this report.", italics: true })] }));
      } else if (annotationGroupBy === "none") {
        for (const ann of sortedAnns) addDocxAnn(ann);
      } else {
        for (const group of groupedAnns) {
          children.push(new Paragraph({ text: `${group.label} (${group.items.length})`, heading: HeadingLevel.HEADING_2 }));
          for (const ann of group.items) addDocxAnn(ann);
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
            title={
              !isFrozen
                ? "Reports must be saved before they can be exported"
                : !canExportReports
                  ? "You do not have permission to export reports"
                  : "Export Report"
            }
            disabled={!isFrozen || !canExportReports}
            onClick={() => setShowExportModal(true)}
          >
            Export
          </button>
          {isFrozen && onUseSettings && canStartReports && (
            <button
              className="btn btn--primary"
              onClick={() => onUseSettings({
                caseIds: row!.caseIds,
                documentIds: row!.documentIds,
                codeIds: row!.codeIds,
                userIds: row!.snapshot?.selectedUserIds ?? [],
                caseAttributeIds: row!.snapshot?.selectedCaseAttributeIds ?? [],
                documentAttributeIds: row!.snapshot?.selectedDocumentAttributeIds ?? [],
                caseAttributeFilters: row!.snapshot?.caseAttributeFilters ?? {},
                documentAttributeFilters: row!.snapshot?.documentAttributeFilters ?? {},
              })}
            >
              Use Settings for New Report
            </button>
          )}
          {!isFrozen && (
            <button className="btn btn--primary" onClick={handleSave} disabled={saving || !name.trim() || !canStartReports}>
              {saving ? "Saving…" : "Save Report"}
            </button>
          )}
        </div>
      </div>

      {/* ── 2-column layout ── */}
      <div className="annotate-layout ann-report-annotate-layout">

        {/* Left: filter panels */}
        <div className="annotate-left">
          <div className="annotate-left-title">Include in Report:</div>

          {/* Cases */}
          <div className="annotate-card">
            <div className="annotate-card-header" style={{ gap: 8 }}>
              <button className="annotate-card-header" style={{ width: "100%", cursor: "pointer", background: "none", border: "none", padding: 0 }} onClick={() => togglePanel("cases")}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="annotate-card-title">Cases ({selCaseIds.size})</span>
                  <button
                    type="button"
                    className="filter-icon-button filter-icon-button--compact"
                    aria-label="Filter cases by attributes"
                    title="Filter cases by attributes"
                    onClick={(e) => { e.stopPropagation(); setShowCaseAttributeFilters(true); }}
                  >
                    <FilterIcon className="filter-icon-svg" />
                  </button>
                </span>
                <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-muted)" }}>{collapsed.has("cases") ? "▶" : "▼"}</span>
              </button>
            </div>
            {!collapsed.has("cases") && (
              <>
                {!isFrozen && !dataLoading && displayCaseItems.length > 0 && (
                  <div style={{ padding: "2px 14px 4px", display: "flex", gap: 8 }}>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => applySelectionFromCases(new Set(displayCaseItems.map(c => c.id)))}>All</button>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => clearPrimarySelections()}>Clear</button>
                  </div>
                )}
                <ul className="code-list">
                {dataLoading
                  ? <li className="code-list-empty">Loading…</li>
                  : displayCaseItems.length === 0
                    ? <li className="code-list-empty">No cases.</li>
                    : displayCaseItems.map((c) => (
                        <li key={c.id} className="code-item"
                          style={{ cursor: isFrozen ? "default" : "pointer" }}
                          onClick={isFrozen ? undefined : () => applySelectionFromCases(toggle(selCaseIds, c.id))}
                        >
                          <input type="checkbox" className="memo-sel-checkbox"
                            checked={selCaseIds.has(c.id)} disabled={isFrozen}
                            onChange={isFrozen ? undefined : (e) => { e.stopPropagation(); applySelectionFromCases(toggle(selCaseIds, c.id)); }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className="code-label">{c.name}</span>
                        </li>
                      ))
                }
                </ul>
              </>
            )}
          </div>

          {/* Documents */}
          <div className="annotate-card">
            <div className="annotate-card-header" style={{ gap: 8 }}>
              <button className="annotate-card-header" style={{ width: "100%", cursor: "pointer", background: "none", border: "none", padding: 0 }} onClick={() => togglePanel("documents")}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="annotate-card-title">Documents ({selDocIds.size})</span>
                  <button
                    type="button"
                    className="filter-icon-button filter-icon-button--compact"
                    aria-label="Filter documents by attributes"
                    title="Filter documents by attributes"
                    onClick={(e) => { e.stopPropagation(); setShowDocumentAttributeFilters(true); }}
                  >
                    <FilterIcon className="filter-icon-svg" />
                  </button>
                </span>
                <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-muted)" }}>{collapsed.has("documents") ? "▶" : "▼"}</span>
              </button>
            </div>
            {!collapsed.has("documents") && (
              <>
                {!isFrozen && storeDocs.length > 0 && (
                  <div style={{ padding: "2px 14px 4px", display: "flex", gap: 8 }}>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => applySelectionFromDocuments(new Set(storeDocs.map(d => d.id)))}>All</button>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => clearPrimarySelections()}>Clear</button>
                  </div>
                )}
                <ul className="code-list">
                  {storeDocs.length === 0
                    ? <li className="code-list-empty">No documents.</li>
                    : storeDocs.map((d) => (
                        <li key={d.id} className="code-item"
                          style={{ cursor: isFrozen ? "default" : "pointer" }}
                          onClick={isFrozen ? undefined : () => applySelectionFromDocuments(toggle(selDocIds, d.id))}
                        >
                          <input type="checkbox" className="memo-sel-checkbox"
                            checked={selDocIds.has(d.id)} disabled={isFrozen}
                            onChange={isFrozen ? undefined : (e) => { e.stopPropagation(); applySelectionFromDocuments(toggle(selDocIds, d.id)); }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className="code-label">{d.name}</span>
                        </li>
                      ))
                  }
                </ul>
              </>
            )}
          </div>

          {/* Codes */}
          <div className="annotate-card">
            <button className="annotate-card-header" style={{ width: "100%", cursor: "pointer", background: "none", border: "none" }} onClick={() => togglePanel("codes")}>
              <span className="annotate-card-title">Codes ({selCodeIds.size})</span>
              <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-muted)" }}>{collapsed.has("codes") ? "▶" : "▼"}</span>
            </button>
            {!collapsed.has("codes") && (
              <>
                {!isFrozen && storeCodes.length > 0 && (
                  <div style={{ padding: "2px 14px 4px", display: "flex", gap: 8 }}>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => applySelectionFromCodes(new Set(storeCodes.map(c => c.id)))}>All</button>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => clearPrimarySelections()}>Clear</button>
                  </div>
                )}
                <ul className="code-list" style={{ overflowY: "auto", flex: 1 }}>
                  {storeCodes.length === 0
                    ? <li className="code-list-empty">No codes.</li>
                    : storeCodes.map((c) => (
                        <li key={c.id} className="code-item"
                          style={{ cursor: isFrozen ? "default" : "pointer" }}
                          onClick={isFrozen ? undefined : () => applySelectionFromCodes(toggle(selCodeIds, c.id))}
                        >
                          <input type="checkbox" className="memo-sel-checkbox"
                            checked={selCodeIds.has(c.id)} disabled={isFrozen}
                            onChange={isFrozen ? undefined : (e) => { e.stopPropagation(); applySelectionFromCodes(toggle(selCodeIds, c.id)); }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className="code-swatch" style={{ background: c.color }} />
                          <span className="code-label">{c.label}</span>
                        </li>
                      ))
                  }
                </ul>
              </>
            )}
          </div>

          {/* Users */}
          <div className="annotate-card">
            <button className="annotate-card-header" style={{ width: "100%", cursor: "pointer", background: "none", border: "none" }} onClick={() => togglePanel("users")}>
              <span className="annotate-card-title">Users ({selUserIds.size})</span>
              <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-muted)" }}>{collapsed.has("users") ? "▶" : "▼"}</span>
            </button>
            {!collapsed.has("users") && (
              <>
                {!isFrozen && !dataLoading && displayUserItems.length > 0 && (
                  <div style={{ padding: "2px 14px 4px", display: "flex", gap: 8 }}>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => applySelectionFromUsers(new Set(displayUserItems.map(u => u.id)))}>All</button>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => clearPrimarySelections()}>Clear</button>
                  </div>
                )}
                <ul className="code-list" style={{ overflowY: "auto", flex: 1 }}>
                  {dataLoading
                    ? <li className="code-list-empty">Loading…</li>
                    : displayUserItems.length === 0
                      ? <li className="code-list-empty">No users.</li>
                      : displayUserItems.map((u) => (
                          <li key={u.id} className="code-item"
                            style={{ cursor: isFrozen ? "default" : "pointer" }}
                            onClick={isFrozen ? undefined : () => applySelectionFromUsers(toggle(selUserIds, u.id))}
                          >
                            <input type="checkbox" className="memo-sel-checkbox"
                              checked={selUserIds.has(u.id)} disabled={isFrozen}
                              onChange={isFrozen ? undefined : (e) => { e.stopPropagation(); applySelectionFromUsers(toggle(selUserIds, u.id)); }}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <span className="code-label">{u.name}</span>
                          </li>
                        ))
                  }
                </ul>
              </>
            )}
          </div>

        </div>

        {/* Middle: report content */}
        <div
          ref={mainRef}
          className="annotate-main"
          style={{ overflowY: "auto", gap: 10, flexDirection: "column", display: "flex", paddingTop: 2, paddingBottom: 2 }}
        >

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
            <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "10px 14px", fontSize: 13 }}>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
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
              {(caseFilterDetails.length > 0 || documentFilterDetails.length > 0) && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--color-border)", paddingTop: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    Applied Filters
                  </div>
                  {caseFilterDetails.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ fontWeight: 500 }}>Cases</div>
                      {caseFilterDetails.map((detail) => (
                        <div key={`case-filter-${detail}`} style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                          {detail}
                        </div>
                      ))}
                    </div>
                  )}
                  {documentFilterDetails.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ fontWeight: 500 }}>Documents</div>
                      {documentFilterDetails.map((detail) => (
                        <div key={`document-filter-${detail}`} style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                          {detail}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Report description */}
          {(!isFrozen || showDescription) && (
            <div className="annotate-card" style={{ flexShrink: 0 }}>
              <div className="annotate-card-header">
                <span className="annotate-card-title">Report Description</span>
                {!isFrozen ? (
                  <label className="toggle-switch" style={{ marginBottom: 0 }}>
                    <input type="checkbox" checked={showDescription} onChange={(e) => setShowDescription(e.target.checked)} />
                    <span className="toggle-track"><span className="toggle-thumb" /></span>
                    <span style={{ fontSize: 13 }}>Add description</span>
                  </label>
                ) : null}
              </div>
              {showDescription && (
                <>
                  {!isFrozen && editor && (
                    <div className="report-description-toolbar" style={{ padding: "0 14px 10px" }}>
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
                  <EditorContent editor={editor} />
                </>
              )}
            </div>
          )}

          {/* Summary counts */}
          <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
            {summaryCards.map(({ key, label, value, items, expandable = true }) => (
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
                  flexShrink: 0,
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

          {/* Statistics */}
          {(!isFrozen || showCoverage) && (
            <div className="annotate-card" style={{ flexShrink: 0 }}>
              <div className="annotate-card-header">
                <span className="annotate-card-title">Statistics</span>
                {!isFrozen ? (
                  <label className="toggle-switch" style={{ marginBottom: 0 }}>
                    <input type="checkbox" checked={showCoverage} onChange={(e) => setShowCoverage(e.target.checked)} />
                    <span className="toggle-track"><span className="toggle-thumb" /></span>
                    <span style={{ fontSize: 13 }}>Show statistics</span>
                  </label>
                ) : null}
              </div>
              {showCoverage && (
                <div style={{ padding: "12px 14px" }}>
                  {dataLoading ? (
                    <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Loading…</p>
                  ) : filteredAnns.length === 0 ? (
                    <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>No statistics data for the current filters.</p>
                  ) : (() => {
                    const maxPct = coverageStats.rows[0]?.pct ?? 0;
                    const coverageScale = maxPct > 0 ? maxPct + 5 : 1;
                    const maxCount = annotationFrequencyStats[0]?.count ?? 0;
                    const countScale = maxCount > 0 ? maxCount : 1;
                    const maxDocumentCount = annotationDocumentStats[0]?.count ?? 0;
                    const documentCountScale = maxDocumentCount > 0 ? maxDocumentCount : 1;
                    const lengthScale = annotationLengthStats.maxValue > 0 ? annotationLengthStats.maxValue : 1;
                    const labelWidth = 108;
                    const lineStart = labelWidth + 12;
                    const lineEnd = 292;
                    const valueToX = (value: number) => lineStart + (value / lengthScale) * (lineEnd - lineStart);
                    return (
                      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>Code Coverage</div>
                            <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                              % of {coverageStats.totalChars.toLocaleString()} characters
                            </div>
                          </div>
                          {coverageStats.rows.length === 0 ? (
                            <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>No coverage data for the current filters.</p>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                              {coverageStats.rows.map((row) => (
                                <div key={row.codeName} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span style={{ fontSize: 12, width: 110, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.codeName}</span>
                                  <div style={{ flex: 1, height: 12, position: "relative" }}>
                                    <div
                                      title={`Code: ${row.codeName}\nCoverage: ${row.pct.toFixed(1)}%\nCharacters: ${row.chars.toLocaleString()}`}
                                      style={{ width: `${(row.pct / coverageScale) * 100}%`, height: "100%", background: row.codeColor, borderRadius: 6, transition: "width 0.3s ease" }}
                                    />
                                  </div>
                                  <span style={{ fontSize: 12, width: 42, flexShrink: 0, textAlign: "right", color: "var(--color-text-muted)" }}>
                                    {row.pct < 0.1 ? "<0.1" : row.pct.toFixed(1)}%
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>Annotations Per Code</div>
                            <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                              Count of visible annotations by code
                            </div>
                          </div>
                          {annotationFrequencyStats.length === 0 ? (
                            <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>No annotation frequency data for the current filters.</p>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                              {annotationFrequencyStats.map((row) => (
                                <div key={row.codeId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span style={{ fontSize: 12, width: 110, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.codeName}</span>
                                  <div style={{ flex: 1, height: 12, position: "relative" }}>
                                    <div
                                      title={`Code: ${row.codeName}\nAnnotations: ${row.count}`}
                                      style={{ width: `${(row.count / countScale) * 100}%`, height: "100%", background: row.codeColor, borderRadius: 6, transition: "width 0.3s ease" }}
                                    />
                                  </div>
                                  <span style={{ fontSize: 12, width: 42, flexShrink: 0, textAlign: "right", color: "var(--color-text-muted)" }}>
                                    {row.count}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>Annotations Per Document</div>
                            <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                              Count of visible annotations by document
                            </div>
                          </div>
                          {annotationDocumentStats.length === 0 ? (
                            <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>No document frequency data for the current filters.</p>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                {annotationDocumentStats.map((row) => (
                                  <div key={row.documentId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{ fontSize: 12, width: 110, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.documentName}</span>
                                    <div style={{ flex: 1, height: 12, position: "relative" }}>
                                      <div
                                        title={`Document: ${row.documentName}\nAnnotations: ${row.count}`}
                                        style={{ width: `${(row.count / documentCountScale) * 100}%`, height: "100%", background: "var(--color-text-muted)", borderRadius: 6, transition: "width 0.3s ease" }}
                                      />
                                    </div>
                                    <span style={{ fontSize: 12, width: 42, flexShrink: 0, textAlign: "right", color: "var(--color-text-muted)" }}>
                                      {row.count}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>Annotation Length</div>
                            <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                              Box-and-whisker summary in characters
                            </div>
                          </div>
                          {annotationLengthStats.rows.length === 0 ? (
                            <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>No annotation length data for the current filters.</p>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                              <svg
                                viewBox={`0 0 320 ${Math.max(56 + annotationLengthStats.rows.length * 42, 96)}`}
                                role="img"
                                aria-label="Annotation length box and whisker plot by code"
                                style={{ width: "100%", height: Math.max(56 + annotationLengthStats.rows.length * 42, 96), overflow: "visible" }}
                              >
                                {annotationLengthStats.rows.map((row, index) => {
                                  const rowY = 28 + index * 42;
                                  const rowBoxTop = rowY - 12;
                                  const rowBoxBottom = rowY + 12;
                                  return (
                                    <g key={row.codeId}>
                                      <title>{`Code: ${row.codeName}\nMin: ${Math.round(row.min)}\nQ1: ${Math.round(row.q1)}\nMedian: ${Math.round(row.median)}\nQ3: ${Math.round(row.q3)}\nMax: ${Math.round(row.max)}\nAnnotations: ${row.count}\nMean: ${row.mean.toFixed(1)}`}</title>
                                      <text
                                        x={labelWidth}
                                        y={rowY + 4}
                                        textAnchor="end"
                                        fontSize="10"
                                        fill="var(--color-text-muted)"
                                      >
                                        {row.codeName}
                                      </text>
                                      <line x1={lineStart} y1={rowY} x2={lineEnd} y2={rowY} stroke="var(--color-border)" strokeWidth="1" />
                                      <line x1={valueToX(row.min)} y1={rowBoxTop + 4} x2={valueToX(row.min)} y2={rowBoxBottom - 4} stroke="var(--color-text-muted)" strokeWidth="2" />
                                      <line x1={valueToX(row.max)} y1={rowBoxTop + 4} x2={valueToX(row.max)} y2={rowBoxBottom - 4} stroke="var(--color-text-muted)" strokeWidth="2" />
                                      <line x1={valueToX(row.min)} y1={rowY} x2={valueToX(row.q1)} y2={rowY} stroke="var(--color-text-muted)" strokeWidth="2" />
                                      <line x1={valueToX(row.q3)} y1={rowY} x2={valueToX(row.max)} y2={rowY} stroke="var(--color-text-muted)" strokeWidth="2" />
                                      <rect
                                        x={valueToX(row.q1)}
                                        y={rowBoxTop}
                                        width={Math.max(valueToX(row.q3) - valueToX(row.q1), 2)}
                                        height={rowBoxBottom - rowBoxTop}
                                        fill={row.codeColor}
                                        fillOpacity="0.18"
                                        stroke={row.codeColor}
                                        strokeWidth="2"
                                        rx="6"
                                      />
                                      <line x1={valueToX(row.median)} y1={rowBoxTop} x2={valueToX(row.median)} y2={rowBoxBottom} stroke={row.codeColor} strokeWidth="2" />
                                      <text x={lineEnd + 6} y={rowY + 4} fontSize="10" fill="var(--color-text-muted)">{row.count} anns</text>
                                    </g>
                                  );
                                })}
                                <text x={lineStart} y={16} textAnchor="middle" fontSize="10" fill="var(--color-text-muted)">0</text>
                                <text x={lineEnd} y={16} textAnchor="middle" fontSize="10" fill="var(--color-text-muted)">{Math.round(annotationLengthStats.maxValue)}</text>
                              </svg>
                              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11, color: "var(--color-text-muted)" }}>
                                <span>Codes = {annotationLengthStats.rows.length}</span>
                                <span>Max length = {Math.round(annotationLengthStats.maxValue)}</span>
                                <span>Total annotations = {annotationLengthStats.rows.reduce((sum, row) => sum + row.count, 0)}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {/* Annotations */}
          <div className="annotate-card" style={{ flexShrink: 0 }}>
            <div className="annotate-card-header">
              <span className="annotate-card-title">Annotations{filteredAnns.length > 0 ? ` (${filteredAnns.length})` : ""}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                  <span style={{ whiteSpace: "nowrap" }}>Group by</span>
                  <select
                    className="form-input"
                    value={annotationGroupBy}
                    onChange={(e) => setAnnotationGroupBy(e.target.value as AnnotationGroupBy)}
                    style={{ padding: "2px 22px 2px 8px", fontSize: 11, minWidth: 96 }}
                  >
                    <option value="none">None</option>
                    <option value="code">Code</option>
                    <option value="document">Document</option>
                    <option value="coder">Coder</option>
                  </select>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                  <span style={{ whiteSpace: "nowrap" }}>Sort by</span>
                  <select
                    className="form-input"
                    value={annotationSortBy}
                    onChange={(e) => setAnnotationSortBy(e.target.value as AnnotationSortBy)}
                    style={{ padding: "2px 22px 2px 8px", fontSize: 11, minWidth: 116 }}
                  >
                    <option value="document">Document</option>
                    <option value="code">Code</option>
                    <option value="coder">Coder</option>
                    <option value="quoteLength">Quote length</option>
                    <option value="quote">Quote A-Z</option>
                  </select>
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {!isFrozen && (
                  <>
                    <label className="toggle-switch" style={{ marginBottom: 0 }}>
                      <input type="checkbox" checked={showContext} onChange={(e) => setShowContext(e.target.checked)} />
                      <span className="toggle-track"><span className="toggle-thumb" /></span>
                      <span style={{ fontSize: 11 }}>Context</span>
                    </label>
                    {showContext && (
                      <>
                        <input
                          type="number" min={0} max={9999} value={contextChars}
                          onChange={(e) => setContextChars(Math.max(0, parseInt(e.target.value, 10) || 0))}
                          style={{ width: 52, padding: "2px 5px", fontSize: 11, border: "var(--border-width) solid var(--color-border)", borderRadius: "calc(var(--radius) * 0.5px)", background: "var(--color-bg)", color: "var(--color-text)", textAlign: "right" }}
                        />
                        <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>chars</span>
                      </>
                    )}
                  </>
                )}
                {isFrozen && showContext && (
                  <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                    Context: {contextChars} chars
                  </span>
                )}
                </div>
              </div>
            </div>
            {dataLoading ? (
              <div style={{ padding: "12px 14px", fontSize: 12, color: "var(--color-text-muted)" }}>Loading…</div>
            ) : filteredAnns.length === 0 ? (
              <div style={{ padding: "12px 14px", fontSize: 12, color: "var(--color-text-muted)" }}>
                {isFrozen ? "No annotations were captured in this report." : (allAnns.length === 0 ? "No annotations in this project yet." : "No annotations match the current filters.")}
              </div>
            ) : (
              <div style={{ padding: "0 14px 14px" }}>
                {groupedAnns.map((group) => (
                      <div key={group.key} style={{ marginTop: group.key === "all" ? 0 : 14 }}>
                    {annotationGroupBy !== "none" && (
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: "var(--color-text-muted)",
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          margin: "0 0 8px",
                        }}
                      >
                        {group.label} ({group.items.length})
                      </div>
                    )}
                    <ul className="annotation-list">
                      {group.items.map((ann) => {
                        const docContent = effectiveDocContentMap.get(ann.documentId) ?? "";
                        const ctxBefore = showContext && docContent ? docContent.slice(Math.max(0, ann.startOffset - contextChars), ann.startOffset) : null;
                        const ctxAfter  = showContext && docContent ? docContent.slice(ann.endOffset, ann.endOffset + contextChars) : null;
                        return (
                          <li key={ann.id} className="annotation-item">
                            <div className="annotation-item-header">
                              <span className="annotation-code-badge" style={{ background: ann.codeColor }}>{ann.codeName}</span>
                              <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{ann.documentName}</span>
                              {ann.createdById && <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{getCoderName(ann.createdById)}</span>}
                            </div>
                            <p className="annotation-quote">
                              {ctxBefore != null && (
                                <span className="annotation-context annotation-context--before">
                                  {ann.startOffset > contextChars ? "..." : ""}{ctxBefore}
                                </span>
                              )}
                              <span className="annotation-quote-text">"{ann.quote}"</span>
                              {ctxAfter != null && (
                                <span className="annotation-context annotation-context--after">
                                  {ctxAfter}{ann.endOffset + contextChars < docContent.length ? "..." : ""}
                                </span>
                              )}
                            </p>
                            {ann.note && <p className="annotation-note">{ann.note}</p>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

      </div>

      {showCaseAttributeFilters && (
        <div className="modal-overlay" onClick={() => setShowCaseAttributeFilters(false)} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "var(--color-bg)", padding: 24, borderRadius: 8, minWidth: 320, maxWidth: 820, width: "min(820px, calc(100vw - 32px))", maxHeight: "calc(100vh - 48px)", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
              <h2 style={{ margin: 0 }}>Filter Cases by Attributes</h2>
              <button className="btn" onClick={() => setShowCaseAttributeFilters(false)}>Close</button>
            </div>
            {!isFrozen && !dataLoading && displayCaseAttributeItems.length > 0 && (
              <div style={{ paddingBottom: 8, display: "flex", gap: 8 }}>
                <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => selectAllCaseAttributes()}>All</button>
                <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => clearCaseAttributeSelections()}>Clear</button>
              </div>
            )}
            <ul className="code-list">
              {dataLoading
                ? <li className="code-list-empty">Loading…</li>
                : displayCaseAttributeItems.length === 0
                  ? <li className="code-list-empty">No case attributes.</li>
                  : displayCaseAttributeItems.map((item) => (
                      <li
                        key={item.id}
                        className="code-item"
                        style={{ cursor: isFrozen ? "default" : "pointer" }}
                        onClick={isFrozen ? undefined : () => toggleCaseAttributeSelection(item)}
                      >
                        <input
                          type="checkbox"
                          className="memo-sel-checkbox"
                          checked={selCaseAttrIds.has(item.id)}
                          disabled={isFrozen}
                          onChange={isFrozen ? undefined : (e) => { e.stopPropagation(); toggleCaseAttributeSelection(item); }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="code-label">{item.name}</span>
                        <span className="users-filter-count">{item.dataType === "datetime" ? "Date/time" : item.dataType}</span>
                      </li>
                    ))
              }
            </ul>
            {renderAttributeFilterEditors(
              displayCaseAttributeItems,
              selCaseAttrIds,
              caseAttributeFilters,
              caseAttributeValueStats,
              updateCaseAttributeFilter,
            )}
          </div>
        </div>
      )}

      {showDocumentAttributeFilters && (
        <div className="modal-overlay" onClick={() => setShowDocumentAttributeFilters(false)} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "var(--color-bg)", padding: 24, borderRadius: 8, minWidth: 320, maxWidth: 820, width: "min(820px, calc(100vw - 32px))", maxHeight: "calc(100vh - 48px)", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
              <h2 style={{ margin: 0 }}>Filter Documents by Attributes</h2>
              <button className="btn" onClick={() => setShowDocumentAttributeFilters(false)}>Close</button>
            </div>
            {!isFrozen && !dataLoading && displayDocumentAttributeItems.length > 0 && (
              <div style={{ paddingBottom: 8, display: "flex", gap: 8 }}>
                <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => selectAllDocumentAttributes()}>All</button>
                <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => clearDocumentAttributeSelections()}>Clear</button>
              </div>
            )}
            <ul className="code-list">
              {dataLoading
                ? <li className="code-list-empty">Loading…</li>
                : displayDocumentAttributeItems.length === 0
                  ? <li className="code-list-empty">No document attributes.</li>
                  : displayDocumentAttributeItems.map((item) => (
                      <li
                        key={item.id}
                        className="code-item"
                        style={{ cursor: isFrozen ? "default" : "pointer" }}
                        onClick={isFrozen ? undefined : () => toggleDocumentAttributeSelection(item)}
                      >
                        <input
                          type="checkbox"
                          className="memo-sel-checkbox"
                          checked={selDocAttrIds.has(item.id)}
                          disabled={isFrozen}
                          onChange={isFrozen ? undefined : (e) => { e.stopPropagation(); toggleDocumentAttributeSelection(item); }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="code-label">{item.name}</span>
                        <span className="users-filter-count">{item.dataType === "datetime" ? "Date/time" : item.dataType}</span>
                      </li>
                    ))
              }
            </ul>
            {renderAttributeFilterEditors(
              displayDocumentAttributeItems,
              selDocAttrIds,
              documentAttributeFilters,
              documentAttributeValueStats,
              updateDocumentAttributeFilter,
            )}
          </div>
        </div>
      )}

      {showExportModal && (
        <ExportModal
          onClose={() => setShowExportModal(false)}
          onExportHTML={handleExportHTML}
          onExportPDF={handleExportPDF}
          onExportDOCX={handleExportDOCX}
          onExportXLSX={handleExportXLSX}
          exportingFormat={exportingFormat}
        />
      )}
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function CodeReportsView() {
  const { activeProject, pb, canCurrentUser, deleteCodeReport } = useStore();
  const canCreateReports = canCurrentUser("createReports") && canCurrentUser("editReportConfiguration");
  const canDeleteReports = canCurrentUser("deleteReports");

  const [rows,    setRows]    = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const [sortCol, setSortCol] = useState<SortCol>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [contextMenu,   setContextMenu]   = useState<{ x: number; y: number; row: ReportRow } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuStyle = useViewportContextMenuStyle(contextMenu, contextMenuRef);

  const [confirmDelete, setConfirmDelete] = useState<ReportRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

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
        key={newFromSettings ? `new-from-settings-${JSON.stringify(newFromSettings)}` : "new-report"}
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
        key={`saved-report-${openRow.id}`}
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
        <div className="users-title-wrap">
          <h1>Annotation Reports</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            aria-label="Show annotation reports help"
            title="Show Help"
            onClick={() => setHelpOpen(true)}
          >
            <img src={helpIcon} alt="" className="users-help-icon" />
          </button>
        </div>
        <button
          className="btn btn--primary"
          onClick={() => setShowNew(true)}
          disabled={!canCreateReports}
          title={!canCreateReports ? "You do not have permission to create annotation reports" : undefined}
        >
          + New Report
        </button>
      </header>

      {error && <p className="users-error">{error}</p>}
      {!error && (
        <p className="users-permission-note">
          {canCreateReports
            ? "Create a new annotation report or open a saved one."
            : "Saved annotation reports are available to view, but creating new reports is restricted with your current role."}
        </p>
      )}

      <div className="users-content">
        <section className="users-layout-main">
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
        </section>
      </div>

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Annotation Reports Help</h2>
            <p className="users-guide-copy">
              Annotation reports let you filter and analyse annotations across cases, documents, codes, and coders.
            </p>
            <p className="users-guide-copy">
              Select a report to open it, or right-click to delete. Create a new report with the button above.
            </p>
            <p className="users-guide-copy">
              Report creation, deletion, and export options depend on your project role.
            </p>
            <div className="form-actions">
              <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <div ref={contextMenuRef} className="context-menu" style={contextMenuStyle}>
          <button className="context-menu-item" onClick={() => { setOpenRow(contextMenu.row); setContextMenu(null); }}>Open Report</button>
          {canDeleteReports ? (
            <button className="context-menu-item context-menu-item--danger" onClick={() => { setConfirmDelete(contextMenu.row); setContextMenu(null); }}>Delete Report</button>
          ) : (
            <div className="context-menu-item context-menu-item--disabled" title="You do not have permission to delete reports">Delete Report</div>
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

