import { lazy, Suspense, useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { save } from "@tauri-apps/plugin-dialog";
import { readFile as readTauriFile, writeTextFile, writeFile } from "@tauri-apps/plugin-fs";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { EChartsCoreOption } from "echarts/core";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import { FilterIcon } from "../components/FilterIcon";
import { DownloadIcon, HelpIcon, RestartListIcon, SaveIcon } from "../components/AppIcons";
import { SettingsModal } from "../components/SettingsModal";
import { formatCurrentDateTime, formatCurrentNumber } from "../i18n/formatters";
import { useI18n } from "../i18n/provider";
import { createPostgresReport, deletePostgresReport, listPostgresReports, logPostgresReportExport } from "../lib/postgres";
import { loadPostgresReportBuilderData } from "../lib/postgresReportAdapters";
import type { Code, Document as ProjectDocument } from "../types";

const EChart = lazy(() => import("../components/EChart").then((module) => ({ default: module.EChart })));
const ANNOTATION_LENGTH_SUBTITLE = "Number of characters";

let writeExcelFilePromise: Promise<typeof import("write-excel-file/browser")> | null = null;
let jsPdfPromise: Promise<typeof import("jspdf")> | null = null;
let docxPromise: Promise<typeof import("docx")> | null = null;
let pdfJsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function loadWriteExcelFile() {
  if (!writeExcelFilePromise) {
    writeExcelFilePromise = import("write-excel-file/browser");
  }
  return writeExcelFilePromise;
}

async function loadJsPdf() {
  if (!jsPdfPromise) {
    jsPdfPromise = import("jspdf");
  }
  return jsPdfPromise;
}

async function loadDocx() {
  if (!docxPromise) {
    docxPromise = import("docx");
  }
  return docxPromise;
}

async function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import("pdfjs-dist").then((module) => {
      module.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;
      return module;
    });
  }
  return pdfJsPromise;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnnItem {
  id: string;
  quote: string;
  note: string;
  documentId: string;
  documentName: string;
  sourceKind?: string;
  sourcePath?: string;
  timeStartMs?: number | null;
  timeEndMs?: number | null;
  imageRegion?: {
    x: number;
    y: number;
    width: number;
    height: number;
    imageWidth: number;
    imageHeight: number;
    pageNumber?: number | null;
  } | null;
  codeId: string;
  codeName: string;
  codeColor: string;
  startOffset: number;
  endOffset: number;
  createdById: string;
}

interface CaseItem { id: string; name: string; objectType?: string; }
interface RelationshipItem {
  id: string;
  relationshipType?: string;
  object1Id?: string;
  object1Name?: string;
  object2Id?: string;
  object2Name?: string;
  name?: string;
}
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

interface CodeTreeNode {
  code: Code;
  depth: number;
}

type RelationshipSortKey = "relationshipType" | "object1Name" | "object2Name";
type RelationshipSortDir = "asc" | "desc";

export interface ReportSnapshot {
  reportType?: "annotations";
  filteredAnns: AnnItem[];
  caseItems: CaseItem[];
  relationshipItems?: RelationshipItem[];
  userItems: UserItem[];
  caseAttributeItems?: AttributeItem[];
  documentAttributeItems?: AttributeItem[];
  caseDocLinks?: CaseDocumentLink[];
  summaryCounts: { cases: number; docs: number; codes: number; users: number };
  description?: string;
  selectedUserIds?: string[];
  selectedRelationshipIds?: string[];
  selectedCaseAttributeIds?: string[];
  selectedDocumentAttributeIds?: string[];
  selectedCaseTypes?: string[];
  selectedDocumentTypes?: string[];
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

function formatSourceType(value: string | undefined): string {
  const normalized = (value ?? "").trim().toLowerCase().replace(/_/g, " ");
  if (!normalized) return "-";
  if (normalized === "pdf") return "PDF";
  if (normalized === "processed transcript") return "Transcript";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatObjectType(value: string | undefined): string {
  const normalized = (value ?? "").trim();
  return normalized || "-";
}

function formatMediaMilliseconds(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const milliseconds = Math.max(0, Math.floor(value % 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const base = hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
  return `${base}.${String(Math.floor(milliseconds / 100)).padStart(1, "0")}`;
}

function isAbsoluteStoragePath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("/");
}

function resolveProjectStoragePath(projectStoragePath: string | undefined, sourceStoragePath: string | undefined): string {
  const trimmedSourcePath = (sourceStoragePath ?? "").trim();
  if (!trimmedSourcePath) return "";
  if (isAbsoluteStoragePath(trimmedSourcePath)) return trimmedSourcePath;
  const trimmedProjectPath = (projectStoragePath ?? "").trim().replace(/[\\/]+$/, "");
  if (!trimmedProjectPath) return trimmedSourcePath;
  const normalizedSourcePath = trimmedSourcePath.replace(/^([\\/])+/, "");
  return `${trimmedProjectPath}\\${normalizedSourcePath.replace(/\//g, "\\")}`;
}

function fileExtensionFromPath(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function mediaTypeFromFileExtension(ext: string): string | null {
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  if (ext === "m4a" || ext === "aac") return "audio/mp4";
  if (ext === "ogg") return "audio/ogg";
  if (ext === "flac") return "audio/flac";
  if (ext === "mp4" || ext === "m4v") return "video/mp4";
  if (ext === "webm") return "video/webm";
  if (ext === "ogv") return "video/ogg";
  if (ext === "mov") return "video/quicktime";
  return null;
}

interface ReportSettings {
  caseIds: string[];
  documentIds: string[];
  codeIds: string[];
  userIds?: string[];
  relationshipIds?: string[];
  caseAttributeIds?: string[];
  documentAttributeIds?: string[];
  caseTypes?: string[];
  documentTypes?: string[];
  caseAttributeFilters?: Record<string, AttributeFilterConfig>;
  documentAttributeFilters?: Record<string, AttributeFilterConfig>;
}

export interface ReportRow {
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
    return formatCurrentDateTime(iso, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
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

function getCols(t: ReturnType<typeof useI18n>["t"]): { key: SortCol; label: string; width: string }[] {
  return [
    { key: "name", label: t("reportsAnnotations.labels.name"), width: "40%" },
    { key: "createdByName", label: t("reportsAnnotations.createdBy"), width: "28%" },
    { key: "createdAt", label: t("reportsAnnotations.created"), width: "32%" },
  ];
}

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
  const { t } = useI18n();
  const options = [
    {
      key: "html",
      label: t("reportsAnnotations.fileTypes.html"),
      description: t("reportsAnnotations.exportOptions.htmlDescription"),
      onClick: onExportHTML,
    },
    {
      key: "pdf",
      label: t("reportsAnnotations.fileTypes.pdf"),
      description: t("reportsAnnotations.exportOptions.pdfDescription"),
      onClick: onExportPDF,
    },
    {
      key: "docx",
      label: "DOCX",
      description: t("reportsAnnotations.exportOptions.docxDescription"),
      onClick: onExportDOCX,
    },
    {
      key: "xlsx",
      label: "XLSX",
      description: t("reportsAnnotations.exportWorkbookDescription"),
      onClick: onExportXLSX,
    },
  ] as const;

  return (
    <SettingsModal title={t("reportsAnnotations.exportTitle")} onClose={onClose} closeDisabled={!!exportingFormat} modalClassName="modal--wide">
      <div className="app-settings-modal-body">
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
                {exportingFormat === option.key ? t("reportsAnnotations.exporting") : t("reportsAnnotations.exportAs", { format: option.label })}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
        <button className="btn" onClick={onClose} disabled={!!exportingFormat}>{t("reportsAnnotations.cancel")}</button>
      </div>
    </SettingsModal>
  );
}

// ─── Report page ──────────────────────────────────────────────────────────────

function AnnotationMediaPreview({
  annotation,
  source,
  projectStoragePath,
}: {
  annotation: AnnItem;
  source?: ProjectDocument | null;
  projectStoragePath?: string;
}) {
  const { t } = useI18n();
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const sourceKind = (annotation.sourceKind || source?.type || "").trim().toLowerCase();
  const sourcePath = annotation.sourcePath || source?.filePath;
  const resolvedPath = resolveProjectStoragePath(projectStoragePath, sourcePath);
  const mediaType = mediaTypeFromFileExtension(fileExtensionFromPath(sourcePath ?? ""));
  const region = annotation.imageRegion ?? null;

  useEffect(() => {
    if (!resolvedPath || !["audio", "video", "image", "pdf"].includes(sourceKind)) {
      setMediaUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
      setLoadError(null);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    const cropRegion = region;
    setLoadError(null);

    async function buildPreviewUrl(bytes: Uint8Array): Promise<string> {
      if (sourceKind !== "pdf") {
        return URL.createObjectURL(new Blob([bytes], { type: mediaType ?? undefined }));
      }
      if (!cropRegion) throw new Error(t("analysisMemos.annotationPreview.pdfRegionUnavailable"));
      const pdfjsLib = await loadPdfJs();
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      const safePage = Math.min(Math.max(cropRegion.pageNumber ?? 1, 1), pdf.numPages);
      const page = await pdf.getPage(safePage);
      const viewport = page.getViewport({ scale: 1.6 });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error(t("analysisMemos.annotationPreview.pdfPreviewPrepareFailed"));
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((nextBlob) => {
          if (nextBlob) resolve(nextBlob);
          else reject(new Error(t("analysisMemos.annotationPreview.pdfPreviewRenderFailed")));
        }, "image/png");
      });
      return URL.createObjectURL(blob);
    }

    void readTauriFile(resolvedPath)
      .then(async (bytes) => {
        objectUrl = await buildPreviewUrl(bytes);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setMediaUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return objectUrl;
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setMediaUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return null;
        });
        setLoadError(error instanceof Error ? error.message : t("analysisMemos.annotationPreview.mediaLoadFailed"));
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mediaType, region, resolvedPath, sourceKind, t]);

  if (!["audio", "video", "image", "pdf"].includes(sourceKind)) return null;

  const timeLabel = typeof annotation.timeStartMs === "number" || typeof annotation.timeEndMs === "number"
    ? `${typeof annotation.timeStartMs === "number" ? formatMediaMilliseconds(annotation.timeStartMs) : "-"} - ${typeof annotation.timeEndMs === "number" ? formatMediaMilliseconds(annotation.timeEndMs) : "-"}`
    : null;
  const regionLabel = region
    ? sourceKind === "pdf"
      ? t("reportsAnnotations.pageRegion", {
        page: region.pageNumber ?? 1,
        width: Math.round(region.width),
        height: Math.round(region.height),
      })
      : t("reportsAnnotations.region", {
        width: Math.round(region.width),
        height: Math.round(region.height),
      })
    : null;

  return (
    <div style={{ marginTop: 8 }}>
      {(timeLabel || regionLabel) && (
        <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 6 }}>
          {timeLabel ?? regionLabel}
        </div>
      )}
      {loadError ? (
        <p className="auth-error" style={{ margin: 0 }}>{loadError}</p>
      ) : !mediaUrl ? (
        <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>{t("reportsAnnotations.loadingMedia")}</p>
      ) : sourceKind === "audio" ? (
        <audio controls preload="metadata" src={mediaUrl} style={{ width: "100%" }} />
      ) : sourceKind === "video" ? (
        <video controls preload="metadata" playsInline src={mediaUrl} style={{ width: "100%", maxHeight: 360, borderRadius: 6, background: "#000" }} />
      ) : region ? (
        <div
          style={{
            aspectRatio: `${Math.max(region.width, 1)} / ${Math.max(region.height, 1)}`,
            width: "min(100%, 680px)",
            overflow: "hidden",
            border: "var(--border-width) solid var(--color-border)",
            borderRadius: 6,
            background: "var(--color-surface-alt)",
          }}
        >
          <img
            src={mediaUrl}
            alt={sourceKind === "pdf" ? t("reportsAnnotations.pdfAnnotationRegionAlt") : t("reportsAnnotations.imageAnnotationRegionAlt")}
            style={{
              display: "block",
              width: `${(Math.max(region.imageWidth, region.width, 1) / Math.max(region.width, 1)) * 100}%`,
              height: `${(Math.max(region.imageHeight, region.height, 1) / Math.max(region.height, 1)) * 100}%`,
              transform: `translate(-${(Math.max(region.x, 0) / Math.max(region.imageWidth, region.width, 1)) * 100}%, -${(Math.max(region.y, 0) / Math.max(region.imageHeight, region.height, 1)) * 100}%)`,
              transformOrigin: "top left",
            }}
          />
        </div>
      ) : (
        <img src={mediaUrl} alt={t("reportsAnnotations.annotationMediaAlt")} style={{ display: "block", width: "min(100%, 680px)", borderRadius: 6 }} />
      )}
    </div>
  );
}

function ReportPage({
  row,
  isNew,
  initialSettings,
  postgresProjectId,
  projectStoragePath,
  hideBackButton,
  onSaved,
  onBack,
  onUseSettings,
}: {
  row?: ReportRow;
  isNew?: boolean;
  initialSettings?: ReportSettings;
  postgresProjectId?: string;
  projectStoragePath?: string;
  hideBackButton?: boolean;
  onSaved: (id?: string) => void;
  onBack: () => void;
  onUseSettings?: (settings: ReportSettings) => void;
}) {
  const { t } = useI18n();

  const isFrozen = !!row;
  const canStartReports = true;
  const canExportReports = true;

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
  const [selRelationshipIds, setSelRelationshipIds] = useState<Set<string>>(() => new Set(row?.snapshot?.selectedRelationshipIds ?? initialSettings?.relationshipIds ?? []));
  const [selCaseAttrIds, setSelCaseAttrIds] = useState<Set<string>>(() => new Set(row?.snapshot?.selectedCaseAttributeIds ?? initialSettings?.caseAttributeIds ?? []));
  const [selDocAttrIds,  setSelDocAttrIds]  = useState<Set<string>>(() => new Set(row?.snapshot?.selectedDocumentAttributeIds ?? initialSettings?.documentAttributeIds ?? []));
  const [selCaseTypes, setSelCaseTypes] = useState<Set<string>>(() => new Set(row?.snapshot?.selectedCaseTypes ?? initialSettings?.caseTypes ?? []));
  const [selDocTypes, setSelDocTypes] = useState<Set<string>>(() => new Set(row?.snapshot?.selectedDocumentTypes ?? initialSettings?.documentTypes ?? []));
  const [caseAttributeFilters, setCaseAttributeFilters] = useState<Record<string, AttributeFilterConfig>>(() => row?.snapshot?.caseAttributeFilters ?? initialSettings?.caseAttributeFilters ?? {});
  const [documentAttributeFilters, setDocumentAttributeFilters] = useState<Record<string, AttributeFilterConfig>>(() => row?.snapshot?.documentAttributeFilters ?? initialSettings?.documentAttributeFilters ?? {});
  const [collapsed,   setCollapsed]   = useState<Set<string>>(() => new Set(["cases", "documents", "relationships", "codes", "users"]));
  const [expandedSummaryCards, setExpandedSummaryCards] = useState<Set<string>>(new Set());

  // Report display options (functional even on frozen reports)
  const [showContext,     setShowContext]     = useState(() => row?.snapshot?.showContext ?? false);
  const [contextChars,    setContextChars]    = useState(() => row?.snapshot?.contextChars ?? 100);
  const [showCoverage,    setShowCoverage]    = useState(() => row?.snapshot?.showStatistics ?? false);
  const [showCaseAttributeFilters, setShowCaseAttributeFilters] = useState(false);
  const [showDocumentAttributeFilters, setShowDocumentAttributeFilters] = useState(false);
  const [annotationGroupBy, setAnnotationGroupBy] = useState<AnnotationGroupBy>(() => row?.snapshot?.annotationGroupBy ?? "none");
  const [annotationSortBy, setAnnotationSortBy] = useState<AnnotationSortBy>(() => row?.snapshot?.annotationSortBy ?? "code");
  const [relationshipSortKey, setRelationshipSortKey] = useState<RelationshipSortKey>("relationshipType");
  const [relationshipSortDir, setRelationshipSortDir] = useState<RelationshipSortDir>("asc");
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
    setSelRelationshipIds(new Set(initialSettings.relationshipIds ?? []));
    setSelCaseAttrIds(new Set(initialSettings.caseAttributeIds ?? []));
    setSelDocAttrIds(new Set(initialSettings.documentAttributeIds ?? []));
    setSelCaseTypes(new Set(initialSettings.caseTypes ?? []));
    setSelDocTypes(new Set(initialSettings.documentTypes ?? []));
    setCaseAttributeFilters(initialSettings.caseAttributeFilters ?? {});
    setDocumentAttributeFilters(initialSettings.documentAttributeFilters ?? {});
  }, [initialSettings, isFrozen]);

  // Live data (only used for new reports)
  const [caseItems,     setCaseItems]     = useState<CaseItem[]>([]);
  const [relationshipItems, setRelationshipItems] = useState<RelationshipItem[]>([]);
  const [userItems,     setUserItems]     = useState<UserItem[]>([]);
  const [caseAttributeItems, setCaseAttributeItems] = useState<AttributeItem[]>(row?.snapshot?.caseAttributeItems ?? []);
  const [documentAttributeItems, setDocumentAttributeItems] = useState<AttributeItem[]>(row?.snapshot?.documentAttributeItems ?? []);
  const [caseDocLinks,  setCaseDocLinks]  = useState<CaseDocumentLink[]>([]);
  const [caseAttributeValues, setCaseAttributeValues] = useState<AttributeValueItem[]>([]);
  const [documentAttributeValues, setDocumentAttributeValues] = useState<AttributeValueItem[]>([]);
  const [allAnns,       setAllAnns]       = useState<AnnItem[]>([]);
  const [docContentMap, setDocContentMap] = useState<Map<string, string>>(new Map());
  const [postgresDocs, setPostgresDocs] = useState<ProjectDocument[] | null>(null);
  const [postgresCodes, setPostgresCodes] = useState<Code[] | null>(null);
  const [dataLoading,   setDataLoading]   = useState(!isFrozen);
  const reportDocs = postgresDocs ?? [];
  const reportCodes = postgresCodes ?? [];
  const reportDocById = useMemo(() => new Map(reportDocs.map((doc) => [doc.id, doc])), [reportDocs]);
  const codeTree = useMemo<CodeTreeNode[]>(() => {
    const byParent = new Map<string, Code[]>();
    const codeIds = new Set(reportCodes.map((code) => code.id));
    for (const code of reportCodes) {
      const parentKey = code.parentId && codeIds.has(code.parentId) ? code.parentId : "";
      const siblings = byParent.get(parentKey) ?? [];
      siblings.push(code);
      byParent.set(parentKey, siblings);
    }

    for (const siblings of byParent.values()) {
      siblings.sort((a, b) => a.label.localeCompare(b.label));
    }

    const nodes: CodeTreeNode[] = [];
    const visit = (parentId: string, depth: number) => {
      for (const code of byParent.get(parentId) ?? []) {
        nodes.push({ code, depth });
        visit(code.id, depth + 1);
      }
    };
    visit("", 0);
    return nodes;
  }, [reportCodes]);

  // For frozen reports, pull data from the snapshot
  const frozenAnns      = row?.snapshot?.filteredAnns  ?? [];
  const frozenCaseItems = row?.snapshot?.caseItems     ?? [];
  const frozenRelationshipItems = row?.snapshot?.relationshipItems ?? [];
  const frozenUserItems = row?.snapshot?.userItems     ?? [];
  const frozenCaseAttributeItems = row?.snapshot?.caseAttributeItems ?? [];
  const frozenDocumentAttributeItems = row?.snapshot?.documentAttributeItems ?? [];
  const frozenCaseDocLinks = row?.snapshot?.caseDocLinks ?? [];
  const frozenCounts    = row?.snapshot?.summaryCounts;

  const effectiveDocContentMap = useMemo(() => {
    const merged = new Map(docContentMap);
    for (const doc of reportDocs) {
      if (typeof doc.content === "string" && doc.content.length > 0 && !merged.has(doc.id)) {
        merged.set(doc.id, doc.content);
      }
    }
    return merged;
  }, [docContentMap, reportDocs]);

  useEffect(() => {
    if (!isFrozen) return;
    setUserItems(frozenUserItems);
    setCaseItems(frozenCaseItems);
    setRelationshipItems(frozenRelationshipItems);
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
    setAnnotationSortBy(row?.snapshot?.annotationSortBy ?? "code");
  }, [isFrozen, row?.id, row?.snapshot, frozenCaseAttributeItems, frozenDocumentAttributeItems, frozenDescription, frozenRelationshipItems]);

  useEffect(() => {
    if (!postgresProjectId) return;
    let cancelled = false;
    if (!isFrozen) setDataLoading(true);
    (async () => {
      try {
        const data = await loadPostgresReportBuilderData(postgresProjectId!);
        if (cancelled) return;
        const docById = new Map(data.documents.map((doc) => [doc.id, doc]));
        const codeById = new Map(data.codes.map((code) => [code.id, code]));
        setPostgresDocs(data.documents);
        setPostgresCodes(data.codes);
        setDocContentMap(new Map(data.documents.map((doc) => [doc.id, doc.content ?? ""])));
        if (isFrozen) return;
        setCaseItems(data.cases);
        setRelationshipItems(data.relationships);
        setUserItems(data.users);
        setCaseAttributeItems(data.caseAttributeItems);
        setDocumentAttributeItems(data.documentAttributeItems);
        setCaseDocLinks(data.caseDocumentLinks);
        setCaseAttributeValues(data.caseAttributeValues);
        setDocumentAttributeValues(data.documentAttributeValues);
        setAllAnns(data.annotations.map((annotation) => {
          const doc = docById.get(annotation.documentId);
          const code = codeById.get(annotation.codeId);
          return {
            id: annotation.id,
            quote: annotation.quote,
            note: annotation.note ?? "",
            documentId: annotation.documentId,
            documentName: doc?.name ?? "-",
            sourceKind: annotation.sourceKind || doc?.type,
            sourcePath: doc?.filePath,
            timeStartMs: annotation.timeStartMs,
            timeEndMs: annotation.timeEndMs,
            imageRegion: annotation.imageRegion,
            codeId: annotation.codeId,
            codeName: code?.label ?? "-",
            codeColor: code?.color ?? "#888888",
            startOffset: annotation.startOffset ?? 0,
            endOffset: annotation.endOffset ?? 0,
            createdById: annotation.createdById ?? "",
          };
        }));
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isFrozen, postgresProjectId]);


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

  const caseTypeOptions = useMemo(() => {
    const values = new Set(caseItems.map((item) => formatObjectType(item.objectType)));
    return [...values].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
  }, [caseItems]);

  const documentTypeOptions = useMemo(() => {
    const values = new Set(reportDocs.map((doc) => formatSourceType(doc.type)));
    return [...values].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
  }, [reportDocs]);

  useEffect(() => {
    if (isFrozen || dataLoading || selCaseTypes.size > 0 || caseTypeOptions.length === 0) return;
    setSelCaseTypes(new Set(caseTypeOptions));
  }, [caseTypeOptions, dataLoading, isFrozen, selCaseTypes.size]);

  useEffect(() => {
    if (isFrozen || dataLoading || selDocTypes.size > 0 || documentTypeOptions.length === 0) return;
    setSelDocTypes(new Set(documentTypeOptions));
  }, [dataLoading, documentTypeOptions, isFrozen, selDocTypes.size]);

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
    for (const doc of reportDocs) {
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
  }, [selDocAttrIds, reportDocs, documentAttributeMap, documentAttributeItems, documentAttributeFilters, documentAttributeValueStats]);

  const caseIdsMatchingSelectedTypes = useMemo(() => {
    if (caseTypeOptions.length === 0 || selCaseTypes.size === caseTypeOptions.length) return null;
    return new Set(caseItems.filter((item) => selCaseTypes.has(formatObjectType(item.objectType))).map((item) => item.id));
  }, [caseItems, caseTypeOptions.length, selCaseTypes]);

  const docIdsMatchingSelectedTypes = useMemo(() => {
    if (documentTypeOptions.length === 0 || selDocTypes.size === documentTypeOptions.length) return null;
    return new Set(reportDocs.filter((doc) => selDocTypes.has(formatSourceType(doc.type))).map((doc) => doc.id));
  }, [documentTypeOptions.length, reportDocs, selDocTypes]);

  const caseFilterDocIds = useMemo(() => {
    const standaloneSelectedDocIds = new Set(
      [...selDocIds].filter((docId) => (docCaseMap.get(docId)?.size ?? 0) === 0),
    );
    if (selCaseIds.size === 0) return standaloneSelectedDocIds;
    const ids = new Set<string>();
    for (const cId of selCaseIds) {
      if (caseIdsMatchingSelectedTypes && !caseIdsMatchingSelectedTypes.has(cId)) continue;
      if (caseIdsMatchingSelectedAttributes && !caseIdsMatchingSelectedAttributes.has(cId)) continue;
      for (const dId of (caseDocMap.get(cId) ?? [])) {
        if (docIdsMatchingSelectedTypes && !docIdsMatchingSelectedTypes.has(dId)) continue;
        if (docIdsMatchingSelectedAttributes && !docIdsMatchingSelectedAttributes.has(dId)) continue;
        ids.add(dId);
      }
    }
    for (const docId of standaloneSelectedDocIds) {
      if (docIdsMatchingSelectedTypes && !docIdsMatchingSelectedTypes.has(docId)) continue;
      if (docIdsMatchingSelectedAttributes && !docIdsMatchingSelectedAttributes.has(docId)) continue;
      ids.add(docId);
    }
    return ids;
  }, [selCaseIds, selDocIds, caseDocMap, docCaseMap, caseIdsMatchingSelectedTypes, caseIdsMatchingSelectedAttributes, docIdsMatchingSelectedTypes, docIdsMatchingSelectedAttributes]);

  const filteredAnns = useMemo(() => {
    if (isFrozen) return frozenAnns;
    return allAnns.filter((ann) => {
      if (!caseFilterDocIds.has(ann.documentId)) return false;
      if (!selDocIds.has(ann.documentId)) return false;
      if (docIdsMatchingSelectedTypes && !docIdsMatchingSelectedTypes.has(ann.documentId)) return false;
      if (docIdsMatchingSelectedAttributes && !docIdsMatchingSelectedAttributes.has(ann.documentId)) return false;
      if (!selCodeIds.has(ann.codeId)) return false;
      if (!selUserIds.has(ann.createdById)) return false;
      return true;
    });
  }, [isFrozen, frozenAnns, allAnns, caseFilterDocIds, selDocIds, docIdsMatchingSelectedTypes, docIdsMatchingSelectedAttributes, selCodeIds, selUserIds]);

  const coverageStats = useMemo(() => {
    const empty = { rows: [] as { codeName: string; codeColor: string; chars: number; pct: number }[], totalChars: 0 };
    if (!showCoverage) return empty;
    const activeDocs = reportDocs.filter((d) => selDocIds.has(d.id));
    const totalChars = activeDocs.reduce((sum, d) => sum + (effectiveDocContentMap.get(d.id)?.length ?? 0), 0);
    if (totalChars === 0) return empty;
    const visibleCodes = reportCodes.filter((c) => selCodeIds.has(c.id));
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
  }, [showCoverage, filteredAnns, selDocIds, selCodeIds, reportDocs, reportCodes, effectiveDocContentMap]);

  const annotationFrequencyStats = useMemo(() => {
    const empty = [] as { codeId: string; codeName: string; codeColor: string; count: number }[];
    if (!showCoverage) return empty;
    const visibleCodes = reportCodes.filter((c) => selCodeIds.has(c.id));
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
  }, [showCoverage, filteredAnns, selCodeIds, reportCodes]);

  const annotationDocumentStats = useMemo(() => {
    const empty = [] as { documentId: string; documentName: string; count: number }[];
    if (!showCoverage) return empty;
    const visibleDocs = reportDocs.filter((d) => selDocIds.has(d.id));
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
  }, [showCoverage, filteredAnns, selDocIds, reportDocs]);

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
        lengths: number[];
      }[],
      maxValue: 0,
    };
    if (!showCoverage || filteredAnns.length === 0) return empty;
    const visibleCodes = reportCodes.filter((c) => selCodeIds.has(c.id));
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
          lengths,
        };
      })
      .sort((a, b) => b.count - a.count || a.codeName.localeCompare(b.codeName, undefined, { sensitivity: "base" }));
    const maxValue = rows.reduce((max, row) => Math.max(max, row.max), 0);
    return { rows, maxValue };
  }, [showCoverage, filteredAnns, selCodeIds, reportCodes]);

  const annotationLengthChartOption = useMemo<EChartsCoreOption>(() => {
    const rows = annotationLengthStats.rows;
    if (rows.length === 0) return {};

    const boxData = rows.map((row) => ({
      name: row.codeName,
      value: [row.min, row.q1, row.median, row.q3, row.max],
      itemStyle: {
        color: row.codeColor,
        opacity: 0.5,
        borderColor: row.codeColor,
        borderWidth: 2,
      },
    }));

    return {
      animation: false,
      grid: {
        left: 108,
        right: 48,
        top: 10,
        bottom: 24,
      },
      tooltip: {
        trigger: "item",
      },
      xAxis: {
        type: "value",
        min: 0,
        max: annotationLengthStats.maxValue > 0 ? annotationLengthStats.maxValue : 1,
        axisLabel: {
          color: "#687385",
          fontSize: 10,
        },
        axisLine: {
          lineStyle: { color: "#d5dbe3" },
        },
        axisTick: {
          lineStyle: { color: "#d5dbe3" },
        },
        splitLine: {
          lineStyle: { color: "#eef2f6" },
        },
      },
      yAxis: {
        type: "category",
        data: rows.map((row) => row.codeName),
        inverse: true,
        axisLabel: {
          color: "#687385",
          fontSize: 10,
          overflow: "truncate",
          width: 100,
        },
        axisLine: {
          lineStyle: { color: "#d5dbe3" },
        },
        axisTick: {
          show: false,
        },
      },
      series: [
        {
          type: "boxplot",
          layout: "horizontal",
          data: boxData,
          boxWidth: ["38%", "70%"],
        },
      ],
    };
  }, [annotationLengthStats]);

  const coverageChartOption = useMemo<EChartsCoreOption>(() => {
    const rows = coverageStats.rows;
    if (rows.length === 0) return {};

    return {
      animation: false,
      grid: {
        left: 108,
        right: 48,
        top: 6,
        bottom: 18,
      },
      tooltip: {
        trigger: "item",
        formatter: (params: any) => {
          const data = params?.data ?? {};
          return t("reportsAnnotations.charts.coverageTooltip", {
            code: data.name ?? "",
            coverage: Number(data.value ?? 0).toFixed(1),
            characters: formatCurrentNumber(Number(data.characters ?? 0)),
          });
        },
      },
      xAxis: {
        type: "value",
        min: 0,
        max: Math.max((rows[0]?.pct ?? 0) + 5, 1),
        axisLabel: {
          color: "#687385",
          fontSize: 10,
          formatter: (value: number) => `${value.toFixed(1)}%`,
        },
        axisLine: {
          lineStyle: { color: "#d5dbe3" },
        },
        axisTick: {
          lineStyle: { color: "#d5dbe3" },
        },
        splitLine: {
          lineStyle: { color: "#eef2f6" },
        },
      },
      yAxis: {
        type: "category",
        data: rows.map((row) => row.codeName),
        inverse: true,
        axisLabel: {
          color: "#687385",
          fontSize: 10,
          overflow: "truncate",
          width: 100,
        },
        axisLine: {
          lineStyle: { color: "#d5dbe3" },
        },
        axisTick: {
          show: false,
        },
      },
      series: [
        {
          type: "bar",
          barWidth: 12,
          data: rows.map((row) => ({
            name: row.codeName,
            value: row.pct,
            characters: row.chars,
            itemStyle: {
              color: row.codeColor,
              borderRadius: [0, 6, 6, 0],
            },
          })),
          label: {
            show: true,
            position: "right",
            color: "#687385",
            fontSize: 10,
            formatter: (params: any) => {
              const value = Number(params?.value ?? 0);
              return `${value < 0.1 ? "<0.1" : value.toFixed(1)}%`;
            },
          },
        },
      ],
    };
  }, [coverageStats, formatCurrentNumber, t]);

  const annotationFrequencyChartOption = useMemo<EChartsCoreOption>(() => {
    const rows = annotationFrequencyStats;
    if (rows.length === 0) return {};

    return {
      animation: false,
      grid: {
        left: 108,
        right: 48,
        top: 6,
        bottom: 18,
      },
      tooltip: {
        trigger: "item",
        formatter: (params: any) => t("reportsAnnotations.charts.annotationsTooltip", {
          code: params?.data?.name ?? "",
          count: Number(params?.data?.value ?? 0),
        }),
      },
      xAxis: {
        type: "value",
        min: 0,
        max: Math.max(rows[0]?.count ?? 0, 1),
        axisLabel: {
          color: "#687385",
          fontSize: 10,
        },
        axisLine: {
          lineStyle: { color: "#d5dbe3" },
        },
        axisTick: {
          lineStyle: { color: "#d5dbe3" },
        },
        splitLine: {
          lineStyle: { color: "#eef2f6" },
        },
      },
      yAxis: {
        type: "category",
        data: rows.map((row) => row.codeName),
        inverse: true,
        axisLabel: {
          color: "#687385",
          fontSize: 10,
          overflow: "truncate",
          width: 100,
        },
        axisLine: {
          lineStyle: { color: "#d5dbe3" },
        },
        axisTick: {
          show: false,
        },
      },
      series: [
        {
          type: "bar",
          barWidth: 12,
          data: rows.map((row) => ({
            name: row.codeName,
            value: row.count,
            itemStyle: {
              color: row.codeColor,
              borderRadius: [0, 6, 6, 0],
            },
          })),
          label: {
            show: true,
            position: "right",
            color: "#687385",
            fontSize: 10,
          },
        },
      ],
    };
  }, [annotationFrequencyStats, t]);

  const annotationDocumentChartOption = useMemo<EChartsCoreOption>(() => {
    const rows = annotationDocumentStats;
    if (rows.length === 0) return {};

    return {
      animation: false,
      grid: {
        left: 108,
        right: 48,
        top: 6,
        bottom: 18,
      },
      tooltip: {
        trigger: "item",
        formatter: (params: any) => t("reportsAnnotations.charts.documentAnnotationsTooltip", {
          document: params?.data?.name ?? "",
          count: Number(params?.data?.value ?? 0),
        }),
      },
      xAxis: {
        type: "value",
        min: 0,
        max: Math.max(rows[0]?.count ?? 0, 1),
        axisLabel: {
          color: "#687385",
          fontSize: 10,
        },
        axisLine: {
          lineStyle: { color: "#d5dbe3" },
        },
        axisTick: {
          lineStyle: { color: "#d5dbe3" },
        },
        splitLine: {
          lineStyle: { color: "#eef2f6" },
        },
      },
      yAxis: {
        type: "category",
        data: rows.map((row) => row.documentName),
        inverse: true,
        axisLabel: {
          color: "#687385",
          fontSize: 10,
          overflow: "truncate",
          width: 100,
        },
        axisLine: {
          lineStyle: { color: "#d5dbe3" },
        },
        axisTick: {
          show: false,
        },
      },
      series: [
        {
          type: "bar",
          barWidth: 12,
          data: rows.map((row) => ({
            name: row.documentName,
            value: row.count,
            itemStyle: {
              color: "#687385",
              borderRadius: [0, 6, 6, 0],
            },
          })),
          label: {
            show: true,
            position: "right",
            color: "#687385",
            fontSize: 10,
          },
        },
      ],
    };
  }, [annotationDocumentStats, t]);

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

  function applySelectionSets(
    nextCaseIds: Set<string>,
    nextDocIds: Set<string>,
    nextCodeIds: Set<string>,
    nextUserIds: Set<string>,
    options?: { preserveRelationshipSelection?: boolean },
  ) {
    setSelCaseIds(new Set(nextCaseIds));
    setSelDocIds(new Set(nextDocIds));
    setSelCodeIds(new Set(nextCodeIds));
    setSelUserIds(new Set(nextUserIds));
    if (!options?.preserveRelationshipSelection) setSelRelationshipIds(new Set());
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

  function toggleCaseTypeSelection(typeLabel: string) {
    setSelCaseTypes((current) => toggle(current, typeLabel));
  }

  function toggleDocumentTypeSelection(typeLabel: string) {
    setSelDocTypes((current) => toggle(current, typeLabel));
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

  function applySelectionFromRelationships(nextRelationshipIds: Set<string>) {
    if (nextRelationshipIds.size === 0) {
      clearPrimarySelections();
      return;
    }
    const nextCaseIds = new Set<string>();
    for (const relationship of displayRelationshipItems) {
      if (!nextRelationshipIds.has(relationship.id)) continue;
      if (relationship.object1Id) nextCaseIds.add(relationship.object1Id);
      if (relationship.object2Id) nextCaseIds.add(relationship.object2Id);
    }
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
    setSelRelationshipIds(new Set(nextRelationshipIds));
    applySelectionSets(nextCaseIds, nextDocIds, nextCodeIds, nextUserIds, { preserveRelationshipSelection: true });
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
    const expandedCodeIds = expandCodeSelectionWithDescendants(nextCodeIds);
    if (expandedCodeIds.size === 0) {
      clearPrimarySelections();
      return;
    }
    const nextDocIds = new Set<string>();
    const nextCaseIds = new Set<string>();
    const nextUserIds = new Set<string>();
    for (const ann of allAnns) {
      if (!expandedCodeIds.has(ann.codeId)) continue;
      nextDocIds.add(ann.documentId);
      if (ann.createdById) nextUserIds.add(ann.createdById);
    }
    for (const docId of nextDocIds) {
      for (const caseId of docCaseMap.get(docId) ?? []) {
        nextCaseIds.add(caseId);
      }
    }
    applySelectionSets(nextCaseIds, nextDocIds, expandedCodeIds, nextUserIds);
  }

  function expandCodeSelectionWithDescendants(codeIds: Set<string>) {
    const childrenByParent = new Map<string, Code[]>();
    for (const code of reportCodes) {
      if (!code.parentId) continue;
      const children = childrenByParent.get(code.parentId) ?? [];
      children.push(code);
      childrenByParent.set(code.parentId, children);
    }

    const expandedCodeIds = new Set(codeIds);
    const addDescendants = (codeId: string) => {
      for (const child of childrenByParent.get(codeId) ?? []) {
        if (expandedCodeIds.has(child.id)) continue;
        expandedCodeIds.add(child.id);
        addDescendants(child.id);
      }
    };

    for (const codeId of codeIds) addDescendants(codeId);
    return expandedCodeIds;
  }

  function toggleCodeSelection(codeId: string) {
    const childrenByParent = new Map<string, Code[]>();
    for (const code of reportCodes) {
      if (!code.parentId) continue;
      const children = childrenByParent.get(code.parentId) ?? [];
      children.push(code);
      childrenByParent.set(code.parentId, children);
    }

    const nextCodeIds = new Set(selCodeIds);
    const collectDescendantIds = (parentId: string, ids: Set<string>) => {
      for (const child of childrenByParent.get(parentId) ?? []) {
        ids.add(child.id);
        collectDescendantIds(child.id, ids);
      }
    };

    const branchIds = new Set<string>([codeId]);
    collectDescendantIds(codeId, branchIds);
    if (selCodeIds.has(codeId)) {
      for (const id of branchIds) nextCodeIds.delete(id);
    } else {
      for (const id of branchIds) nextCodeIds.add(id);
    }
    applySelectionFromCodes(nextCodeIds);
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
    if (!postgresProjectId || !name.trim()) return;
    if (filteredAnns.length === 0) {
      setError(t("reportsAnnotations.errors.selectAtLeastOne"));
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
        relationshipItems,
        userItems,
        caseAttributeItems,
        documentAttributeItems,
        caseDocLinks,
        selectedUserIds: [...selUserIds],
        selectedRelationshipIds: [...selRelationshipIds],
        selectedCaseAttributeIds: [...selCaseAttrIds],
        selectedDocumentAttributeIds: [...selDocAttrIds],
        selectedCaseTypes: [...selCaseTypes],
        selectedDocumentTypes: [...selDocTypes],
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
          cases: effectiveCaseIds.size,
          docs:  effectiveDocIds.size,
          codes: effectiveCodeIds.size,
          users: effectiveUserIds.size,
        },
      };
      const record = await createPostgresReport({
        projectId: postgresProjectId,
        title: name.trim(),
        reportType: "annotations",
        settingsJson: JSON.stringify({
          caseIds: [...selCaseIds],
          documentIds: [...selDocIds],
          codeIds: [...selCodeIds],
          userIds: [...selUserIds],
          relationshipIds: [...selRelationshipIds],
          caseAttributeIds: [...selCaseAttrIds],
          documentAttributeIds: [...selDocAttrIds],
          caseTypes: [...selCaseTypes],
          documentTypes: [...selDocTypes],
          caseAttributeFilters,
          documentAttributeFilters,
        }),
        contentJson: JSON.stringify(snapshot),
        contentText: `${filteredAnns.length} annotations`,
      });
      onSaved(record.id);
    } catch (e) {
      console.error(e);
      setError(getPocketBaseErrorMessage(e));
      setSaving(false);
    }
  }

  // Summary counts — from snapshot for frozen, derived for live
  async function recordReportExport(format: string, filePath: string) {
    if (!postgresProjectId || !row?.id) return;
    try {
      await logPostgresReportExport({
        projectId: postgresProjectId,
        reportId: row.id,
        title: name || row.name || t("reportsAnnotations.untitledReport"),
        reportType: "annotations",
        format,
        filePath,
      });
    } catch (e) {
      console.warn("Could not log report export:", e);
    }
  }

  const effectiveCaseIds = useMemo(() => {
    if (isFrozen) return new Set(frozenCaseItems.map((item) => item.id));
    return new Set([...selCaseIds].filter((caseId) => {
      if (caseIdsMatchingSelectedTypes && !caseIdsMatchingSelectedTypes.has(caseId)) return false;
      if (caseIdsMatchingSelectedAttributes && !caseIdsMatchingSelectedAttributes.has(caseId)) return false;
      return true;
    }));
  }, [caseIdsMatchingSelectedAttributes, caseIdsMatchingSelectedTypes, frozenCaseItems, isFrozen, selCaseIds]);

  const effectiveDocIds = useMemo(() => {
    if (isFrozen) return new Set(frozenAnns.map((ann) => ann.documentId));
    return new Set([...selDocIds].filter((docId) => caseFilterDocIds.has(docId)));
  }, [caseFilterDocIds, frozenAnns, isFrozen, selDocIds]);

  const effectiveCodeIds = useMemo(
    () => new Set(filteredAnns.map((ann) => ann.codeId)),
    [filteredAnns],
  );

  const effectiveUserIds = useMemo(
    () => new Set(filteredAnns.map((ann) => ann.createdById)),
    [filteredAnns],
  );

  const caseCount = frozenCounts?.cases ?? effectiveCaseIds.size;
  const docCount  = frozenCounts?.docs  ?? effectiveDocIds.size;
  const codeCount = frozenCounts?.codes ?? effectiveCodeIds.size;
  const userCount = frozenCounts?.users ?? effectiveUserIds.size;

  const displayCaseItems = isFrozen ? frozenCaseItems : caseItems;
  const displayRelationshipItems = isFrozen ? frozenRelationshipItems : relationshipItems;
  const displayUserItems = isFrozen ? frozenUserItems : userItems;
  const displayCaseAttributeItems = isFrozen ? frozenCaseAttributeItems : caseAttributeItems;
  const displayDocumentAttributeItems = isFrozen ? frozenDocumentAttributeItems : documentAttributeItems;
  const relationshipColumnValue = (relationship: RelationshipItem, key: RelationshipSortKey) => {
    if (key === "relationshipType") return relationship.relationshipType || relationship.name || "Relationship";
    if (key === "object1Name") return relationship.object1Name || "Unknown object";
    return relationship.object2Name || "Unknown object";
  };
  const sortedRelationshipItems = useMemo(() => {
    return [...displayRelationshipItems].sort((a, b) => {
      const cmp = relationshipColumnValue(a, relationshipSortKey).localeCompare(
        relationshipColumnValue(b, relationshipSortKey),
        undefined,
        { sensitivity: "base", numeric: true },
      );
      return relationshipSortDir === "asc" ? cmp : -cmp;
    });
  }, [displayRelationshipItems, relationshipSortDir, relationshipSortKey]);
  const toggleRelationshipSort = (key: RelationshipSortKey) => {
    if (relationshipSortKey === key) {
      setRelationshipSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setRelationshipSortKey(key);
    setRelationshipSortDir("asc");
  };

  const uniqueByName = (items: { id: string; name: string }[]) => {
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = `${item.id}:${item.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const includedCaseItems = displayCaseItems.filter((item) => effectiveCaseIds.has(item.id));

  const includedDocumentItems = (() => {
    const selected = reportDocs.filter((doc) => effectiveDocIds.has(doc.id));
    if (selected.length > 0 || !isFrozen) {
      return selected.map((doc) => ({ id: doc.id, name: doc.name }));
    }
    return uniqueByName(filteredAnns.map((ann) => ({ id: ann.documentId, name: ann.documentName })));
  })();

  const includedCodeItems = (() => {
    const selected = reportCodes.filter((code) => effectiveCodeIds.has(code.id));
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

  const includedUserItems = displayUserItems.filter((item) => effectiveUserIds.has(item.id));

  const summaryCards: { key: string; label: string; value: number; items: SummaryItem[]; expandable?: boolean }[] = [
    { key: "cases",       label: t("reportsAnnotations.labels.cases"),       value: caseCount,           items: includedCaseItems },
    { key: "documents",   label: t("reportsAnnotations.labels.documents"),   value: docCount,            items: includedDocumentItems },
    { key: "codes",       label: t("reportsAnnotations.labels.codes"),       value: codeCount,           items: includedCodeItems },
    { key: "users",       label: t("reportsAnnotations.labels.users"),       value: userCount,           items: includedUserItems },
    { key: "annotations", label: t("reportsAnnotations.labels.annotations"), value: filteredAnns.length, items: [], expandable: false },
  ];

  function getCoderName(userId: string): string {
    return displayUserItems.find((u) => u.id === userId)?.name || t("reportsCodes.exportSections.unknown");
  }

  function getCodeName(ann: AnnItem): string {
    return ann.codeName || reportCodes.find((code) => code.id === ann.codeId)?.label || t("reportsCodes.exportSections.unknown");
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
                  <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{t("reportsAnnotations.filterEditors.noNumericValues")}</div>
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
                        <span style={{ color: "var(--color-text-muted)" }}>{t("reportsAnnotations.filterEditors.minimum")}</span>
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
                        <span style={{ color: "var(--color-text-muted)" }}>{t("reportsAnnotations.filterEditors.maximum")}</span>
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
                    <span style={{ color: "var(--color-text-muted)" }}>{t("reportsAnnotations.filterEditors.from")}</span>
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
                    <span style={{ color: "var(--color-text-muted)" }}>{t("reportsAnnotations.filterEditors.to")}</span>
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
                  <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} disabled={isFrozen} onClick={() => onUpdate(item.id, { selectedValues: stat?.textValues ?? [] })}>{t("reportsCodes.actions.all")}</button>
                  <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} disabled={isFrozen} onClick={() => onUpdate(item.id, { selectedValues: [] })}>{t("reportsCodes.actions.clear")}</button>
                </div>
              </div>
              <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid var(--color-border)", borderRadius: 8, background: "var(--color-surface)" }}>
                {(stat?.textValues ?? []).length === 0 ? (
                  <div style={{ padding: 10, fontSize: 12, color: "var(--color-text-muted)" }}>{t("reportsAnnotations.filterEditors.noTextValues")}</div>
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
  }, [filteredAnns, annotationSortBy, displayUserItems, displayCaseItems, reportCodes, selCaseIds, caseDocMap]);

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
          return { key: "all", label: t("reportsAnnotations.labels.annotations") };
      }
    };

    const groups = new Map<string, { key: string; label: string; items: AnnItem[] }>();
    for (const ann of sortedAnns) {
      const meta = getGroupMeta(ann);
      if (!groups.has(meta.key)) groups.set(meta.key, { ...meta, items: [] });
      groups.get(meta.key)!.items.push(ann);
    }
    return Array.from(groups.values());
  }, [sortedAnns, annotationGroupBy, displayUserItems, reportCodes]);

  const caseFilterDetails = useMemo(
    () => describeAttributeFilters(displayCaseAttributeItems, selCaseAttrIds, caseAttributeFilters, caseAttributeValueStats),
    [displayCaseAttributeItems, selCaseAttrIds, caseAttributeFilters, caseAttributeValueStats],
  );

  const documentFilterDetails = useMemo(
    () => describeAttributeFilters(displayDocumentAttributeItems, selDocAttrIds, documentAttributeFilters, documentAttributeValueStats),
    [displayDocumentAttributeItems, selDocAttrIds, documentAttributeFilters, documentAttributeValueStats],
  );

  const caseTypeFilterDetails = useMemo(() => {
    if (caseTypeOptions.length === 0 || selCaseTypes.size === caseTypeOptions.length) return [];
    if (selCaseTypes.size === 0) return ["Object Type: no types selected"];
    const values = [...selCaseTypes].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
    return [`Object Type: ${values.length <= 4 ? values.join(", ") : `${values.slice(0, 4).join(", ")} +${values.length - 4} more`}`];
  }, [caseTypeOptions.length, selCaseTypes]);

  const documentTypeFilterDetails = useMemo(() => {
    if (documentTypeOptions.length === 0 || selDocTypes.size === documentTypeOptions.length) return [];
    if (selDocTypes.size === 0) return ["Source Type: no types selected"];
    const values = [...selDocTypes].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
    return [`Source Type: ${values.length <= 4 ? values.join(", ") : `${values.slice(0, 4).join(", ")} +${values.length - 4} more`}`];
  }, [documentTypeOptions.length, selDocTypes]);

  const activeCaseFilterDetails = [...caseTypeFilterDetails, ...caseFilterDetails];
  const activeDocumentFilterDetails = [...documentTypeFilterDetails, ...documentFilterDetails];
  const hasActiveFilters = activeCaseFilterDetails.length > 0 || activeDocumentFilterDetails.length > 0;

  async function buildExportContentMap(): Promise<Map<string, string>> {
    if (!showContext) return new Map<string, string>();
    return effectiveDocContentMap;
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

  function sourceForAnnotation(ann: AnnItem): ProjectDocument | undefined {
    return reportDocById.get(ann.documentId);
  }

  function sourceKindForAnnotation(ann: AnnItem): string {
    return (ann.sourceKind || sourceForAnnotation(ann)?.type || "").trim().toLowerCase();
  }

  function sourcePathForAnnotation(ann: AnnItem): string {
    return ann.sourcePath || sourceForAnnotation(ann)?.filePath || "";
  }

  function resolvedPathForAnnotation(ann: AnnItem): string {
    return resolveProjectStoragePath(projectStoragePath, sourcePathForAnnotation(ann));
  }

  function mediaSummaryForAnnotation(ann: AnnItem): string {
    const sourceKind = sourceKindForAnnotation(ann);
    if (sourceKind === "audio" || sourceKind === "video") {
      const start = typeof ann.timeStartMs === "number" ? formatMediaMilliseconds(ann.timeStartMs) : "-";
      const end = typeof ann.timeEndMs === "number" ? formatMediaMilliseconds(ann.timeEndMs) : "-";
      return `${formatSourceType(sourceKind)} clip: ${start} - ${end}`;
    }
    if ((sourceKind === "image" || sourceKind === "pdf") && ann.imageRegion) {
      const region = ann.imageRegion;
      const page = sourceKind === "pdf" && region.pageNumber ? `Page ${region.pageNumber}; ` : "";
      return `${formatSourceType(sourceKind)} region: ${page}${Math.round(region.width)} x ${Math.round(region.height)} px`;
    }
    return "";
  }

  function dataUrlToBytes(dataUrl: string): Uint8Array {
    const base64 = dataUrl.split(",")[1] ?? "";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Image failed to load"));
      image.src = src;
    });
  }

  async function buildAnnotationImagePreview(ann: AnnItem): Promise<{ dataUrl: string; width: number; height: number } | null> {
    const sourceKind = sourceKindForAnnotation(ann);
    const region = ann.imageRegion;
    const resolvedPath = resolvedPathForAnnotation(ann);
    if (!region || !resolvedPath || (sourceKind !== "image" && sourceKind !== "pdf")) return null;

    if (sourceKind === "image") {
      let objectUrl = "";
      try {
        const bytes = await readTauriFile(resolvedPath);
        const mediaType = mediaTypeFromFileExtension(fileExtensionFromPath(resolvedPath)) ?? "image/png";
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: mediaType }));
        const image = await loadImage(objectUrl);
        const sourceWidth = Math.max(region.imageWidth, region.width, 1);
        const sourceHeight = Math.max(region.imageHeight, region.height, 1);
        const scaleX = image.naturalWidth / sourceWidth;
        const scaleY = image.naturalHeight / sourceHeight;
        const cropX = Math.max(0, region.x * scaleX);
        const cropY = Math.max(0, region.y * scaleY);
        const cropW = Math.max(1, Math.min(region.width * scaleX, image.naturalWidth - cropX));
        const cropH = Math.max(1, Math.min(region.height * scaleY, image.naturalHeight - cropY));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(cropW);
        canvas.height = Math.round(cropH);
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(image, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);
        return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
      } finally {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      }
    }

    try {
      const bytes = await readTauriFile(resolvedPath);
      const pdfjs = await loadPdfJs();
      const pdf = await pdfjs.getDocument({ data: bytes.slice().buffer }).promise;
      const page = await pdf.getPage(Math.max(1, ann.imageRegion?.pageNumber ?? 1));
      const viewport = page.getViewport({ scale: 1.6 });
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = Math.ceil(viewport.width);
      pageCanvas.height = Math.ceil(viewport.height);
      const pageCtx = pageCanvas.getContext("2d");
      if (!pageCtx) return null;
      await page.render({ canvas: pageCanvas, canvasContext: pageCtx, viewport }).promise;
      const sourceWidth = Math.max(region.imageWidth, region.width, 1);
      const sourceHeight = Math.max(region.imageHeight, region.height, 1);
      const scaleX = pageCanvas.width / sourceWidth;
      const scaleY = pageCanvas.height / sourceHeight;
      const cropX = Math.max(0, region.x * scaleX);
      const cropY = Math.max(0, region.y * scaleY);
      const cropW = Math.max(1, Math.min(region.width * scaleX, pageCanvas.width - cropX));
      const cropH = Math.max(1, Math.min(region.height * scaleY, pageCanvas.height - cropY));
      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = Math.round(cropW);
      cropCanvas.height = Math.round(cropH);
      const cropCtx = cropCanvas.getContext("2d");
      if (!cropCtx) return null;
      cropCtx.drawImage(pageCanvas, cropX, cropY, cropW, cropH, 0, 0, cropCanvas.width, cropCanvas.height);
      return { dataUrl: cropCanvas.toDataURL("image/png"), width: cropCanvas.width, height: cropCanvas.height };
    } catch (e) {
      console.error("Media preview export failed:", e);
      return null;
    }
  }

  async function mediaHtmlForAnnotation(ann: AnnItem): Promise<string> {
    const summary = mediaSummaryForAnnotation(ann);
    const sourcePath = sourcePathForAnnotation(ann);
    const preview = await buildAnnotationImagePreview(ann);
    if (!summary && !sourcePath && !preview) return "";
    return `
      <div class="media-export">
        ${summary ? `<p class="media-export-meta">${escapeHtml(summary)}</p>` : ""}
        ${sourcePath ? `<p class="media-export-meta"><strong>Source file:</strong> ${escapeHtml(sourcePath)}</p>` : ""}
        ${preview ? `<img src="${preview.dataUrl}" alt="Media annotation preview" />` : ""}
      </div>
    `;
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

  async function getCleanReportHtml(contentMap: Map<string, string> = new Map()): Promise<string> {
    const title = name || t("reportsAnnotations.untitledReport");
    const createdBy = row?.createdByName || t("reportsCodes.exportSections.unknown");
    const createdAt = row ? fmtDate(row.createdAt) : fmtDate(new Date().toISOString());
    const descriptionHtml = getExportDescriptionHtml();
    const groupLabels: Record<string, string> = { none: t("reportsAnnotations.exportLabels.none"), code: t("reportsAnnotations.exportLabels.code"), document: t("reportsAnnotations.exportLabels.document"), coder: t("reportsAnnotations.exportLabels.coder") };
    const sortLabels: Record<string, string> = { document: t("reportsAnnotations.exportLabels.document"), code: t("reportsAnnotations.exportLabels.code"), coder: t("reportsAnnotations.exportLabels.coder"), quoteLength: t("reportsAnnotations.exportLabels.quoteLength"), quote: t("reportsAnnotations.exportLabels.quoteAZ") };

    const filterRows: string[] = [];
    if (selCaseIds.size > 0) {
      const names = displayCaseItems.filter((c) => selCaseIds.has(c.id)).map((c) => c.name).join(", ");
      filterRows.push(`<tr><td><strong>Objects</strong></td><td>${escapeHtml(names)}</td></tr>`);
    }
    if (selDocIds.size > 0) {
      const names = reportDocs.filter((d) => selDocIds.has(d.id)).map((d) => d.name).join(", ");
      filterRows.push(`<tr><td><strong>Sources</strong></td><td>${escapeHtml(names)}</td></tr>`);
    }
    if (selCodeIds.size > 0) {
      const names = reportCodes.filter((c) => selCodeIds.has(c.id)).map((c) => c.label).join(", ");
      filterRows.push(`<tr><td><strong>Codes</strong></td><td>${escapeHtml(names)}</td></tr>`);
    }
    if (selUserIds.size > 0) {
      const names = displayUserItems.filter((u) => selUserIds.has(u.id)).map((u) => u.name).join(", ");
      filterRows.push(`<tr><td><strong>Users</strong></td><td>${escapeHtml(names)}</td></tr>`);
    }
    if (caseFilterDetails.length > 0)
      filterRows.push(`<tr><td><strong>${escapeHtml(t("reportsAnnotations.exportLabels.caseAttributes"))}</strong></td><td>${escapeHtml(caseFilterDetails.join("; "))}</td></tr>`);
    if (documentFilterDetails.length > 0)
      filterRows.push(`<tr><td><strong>${escapeHtml(t("reportsAnnotations.exportLabels.documentAttributes"))}</strong></td><td>${escapeHtml(documentFilterDetails.join("; "))}</td></tr>`);
    const filtersHtml = filterRows.length > 0
      ? `<h2>${escapeHtml(t("reportsAnnotations.appliedFilters"))}</h2><table class="details">${filterRows.join("")}</table>`
      : "";

    const statisticsHtml = [
      { title: t("reportsAnnotations.charts.codeCoverage"), subtitle: t("reportsAnnotations.charts.codeCoverageSubtitle", { count: formatCurrentNumber(coverageStats.totalChars) }), image: getCoverageChartSvg(true) },
      { title: t("reportsAnnotations.charts.annotationsPerCode"), subtitle: t("reportsAnnotations.charts.annotationsPerCodeSubtitle"), image: getAnnotationFrequencyChartSvg(true) },
      { title: t("reportsAnnotations.charts.annotationsPerDocument"), subtitle: t("reportsAnnotations.charts.annotationsPerDocumentSubtitle"), image: getAnnotationDocumentChartSvg(true) },
      { title: t("reportsAnnotations.charts.annotationLength"), subtitle: ANNOTATION_LENGTH_SUBTITLE, image: getAnnotationLengthChartSvg(true) },
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

    const annGroupHtml = async (items: AnnItem[]) => (await Promise.all(items.map(async (ann) => {
      const ctx = annContext(ann, contentMap);
      const quotePart = ctx.before || ctx.after
        ? [
            ctx.before ? `<span class="ctx">${escapeHtml((ctx.ellipsisBefore ? "…" : "") + ctx.before)}</span>` : "",
            escapeHtml(ann.quote),
            ctx.after ? `<span class="ctx">${escapeHtml(ctx.after + (ctx.ellipsisAfter ? "…" : ""))}</span>` : "",
          ].join("")
        : escapeHtml(ann.quote);
      const mediaHtml = await mediaHtmlForAnnotation(ann);
      return `
        <section class="annotation">
          <div class="annotation-meta">
            <span class="code" style="background-color:${escapeHtml(ann.codeColor)}">${escapeHtml(ann.codeName)}</span>
            <span>${escapeHtml(ann.documentName)}</span>
            <span>${escapeHtml(getCoderName(ann.createdById))}</span>
            <span>${escapeHtml(getCaseNameForAnn(ann))}</span>
          </div>
          ${ann.quote || ctx.before || ctx.after ? `<blockquote>${quotePart}</blockquote>` : ""}
          ${mediaHtml}
          ${ann.note ? `<p class="note"><strong>Note:</strong> ${escapeHtml(ann.note)}</p>` : ""}
        </section>
      `;
    }))).join("");

    const annotationHtml = sortedAnns.length === 0
      ? `<p class="muted">${escapeHtml(t("reportsAnnotations.empty.noAnnotationsCaptured"))}</p>`
      : annotationGroupBy === "none"
        ? await annGroupHtml(sortedAnns)
        : (await Promise.all(groupedAnns.map(async (group) => `
            <h3 class="group-header">${escapeHtml(group.label)} <span class="group-count">(${group.items.length})</span></h3>
            ${await annGroupHtml(group.items)}
          `))).join("");

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
      .media-export { margin: 8px 0; }
      .media-export img { display: block; max-width: 100%; height: auto; border: 1px solid #d5dbe3; border-radius: 6px; }
      .media-export-meta { margin: 3px 0; color: #687385; font-size: 12px; }
      .note { margin: 7px 0 0; }
      .group-header { font-size: 14px; margin: 20px 0 4px; color: #687385; border-bottom: 1px solid #d5dbe3; padding-bottom: 4px; }
      .group-count { font-weight: 400; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    <table class="details">
      <tr><td><strong>${escapeHtml(t("reportsAnnotations.createdBy"))}</strong></td><td>${escapeHtml(createdBy)}</td></tr>
      <tr><td><strong>${escapeHtml(t("reportsAnnotations.created"))}</strong></td><td>${escapeHtml(createdAt)}</td></tr>
      <tr><td><strong>Group by</strong></td><td>${escapeHtml(groupLabels[annotationGroupBy] ?? annotationGroupBy)}</td></tr>
      <tr><td><strong>Sort by</strong></td><td>${escapeHtml(sortLabels[annotationSortBy] ?? annotationSortBy)}</td></tr>
    </table>
    ${descriptionHtml ? `<h2>Description</h2><div class="description">${descriptionHtml}</div>` : ""}
    <h2>Summary</h2>
    <table class="summary">
      <tr><th>Objects</th><th>Sources</th><th>Codes</th><th>Users</th><th>Annotations</th></tr>
      <tr><td>${caseCount}</td><td>${docCount}</td><td>${codeCount}</td><td>${userCount}</td><td>${filteredAnns.length}</td></tr>
    </table>
    ${filtersHtml}
    ${statisticsHtml ? `<h2>${escapeHtml(t("reportsAnnotations.statistics"))}</h2>${statisticsHtml}` : ""}
    <h2>Annotations</h2>
    ${annotationHtml}
  </body>
</html>`;
  }

  async function handleExportXLSX() {
    if (!canExportReports) return;
    try {
      setExportingFormat("xlsx");
      const path = await save({ defaultPath: `${name || t("reportsAnnotations.untitledReport")}.xlsx`, filters: [{ name: t("reportsAnnotations.fileTypes.excelWorkbook"), extensions: ["xlsx"] }] });
      if (!path) return;

      const { default: writeXlsxFile } = await loadWriteExcelFile();
      const createdBy = row?.createdByName || t("reportsCodes.exportSections.unknown");
      const createdAt = row ? fmtDate(row.createdAt) : fmtDate(new Date().toISOString());
      const groupLabels: Record<string, string> = { none: t("reportsAnnotations.exportLabels.none"), code: t("reportsAnnotations.exportLabels.code"), document: t("reportsAnnotations.exportLabels.document"), coder: t("reportsAnnotations.exportLabels.coder") };
      const sortLabels: Record<string, string> = { document: t("reportsAnnotations.exportLabels.document"), code: t("reportsAnnotations.exportLabels.code"), coder: t("reportsAnnotations.exportLabels.coder"), quoteLength: t("reportsAnnotations.exportLabels.quoteLength"), quote: t("reportsAnnotations.exportLabels.quoteAZ") };

      // ── Sheet 1: Report metadata ─────────────────────────────────────────
      const headerCell = (value: string) => ({
        value,
        fontWeight: "bold" as const,
        backgroundColor: "#E1E4EA",
      });
      const titleCellValue = (value: string, columnSpan = 1) => ({
        value,
        fontWeight: "bold" as const,
        fontSize: 16,
        ...(columnSpan > 1 ? { columnSpan } : {}),
      });
      const sectionCell = (value: string) => ({ value, fontWeight: "bold" as const });
      const subheadingCell = (value: string) => ({
        value,
        fontStyle: "italic" as const,
        textColor: "#687385",
      });
      const wrappedCell = (value: string) => ({
        value,
        wrap: true,
        verticalAlign: "top" as const,
      });

      const metaRows: Array<Array<any>> = [
        [titleCellValue(name || t("reportsAnnotations.untitledReport"), 2), null],
        [],
        [t("reportsAnnotations.createdBy"), createdBy],
        [t("reportsAnnotations.created"), createdAt],
        ["Group by", groupLabels[annotationGroupBy] ?? annotationGroupBy],
        ["Sort by", sortLabels[annotationSortBy] ?? annotationSortBy],
      ];

      const description = htmlToPlainText(getExportDescriptionHtml());
      if (description) {
        metaRows.push([]);
        metaRows.push([sectionCell("Description")]);
        for (const line of description.split(/\n+/).filter(Boolean)) {
          metaRows.push([line]);
        }
      }

      metaRows.push([]);
      metaRows.push([sectionCell("Summary")]);
      metaRows.push(["Objects", caseCount]);
      metaRows.push(["Sources", docCount]);
      metaRows.push(["Codes", codeCount]);
      metaRows.push(["Users", userCount]);
      metaRows.push(["Annotations", filteredAnns.length]);

      const filterLines: Array<[string, string]> = [];
      if (selCaseIds.size  > 0) filterLines.push(["Objects",     displayCaseItems.filter(c => selCaseIds.has(c.id)).map(c => c.name).join(", ")]);
      if (selDocIds.size   > 0) filterLines.push(["Sources",     reportDocs.filter(d => selDocIds.has(d.id)).map(d => d.name).join(", ")]);
      if (selCodeIds.size  > 0) filterLines.push(["Codes",       reportCodes.filter(c => selCodeIds.has(c.id)).map(c => c.label).join(", ")]);
      if (selUserIds.size  > 0) filterLines.push(["Users",       displayUserItems.filter(u => selUserIds.has(u.id)).map(u => u.name).join(", ")]);
      if (caseFilterDetails.length     > 0) filterLines.push([t("reportsAnnotations.exportLabels.caseAttributes"),     caseFilterDetails.join("; ")]);
      if (documentFilterDetails.length > 0) filterLines.push([t("reportsAnnotations.exportLabels.documentAttributes"), documentFilterDetails.join("; ")]);
      if (filterLines.length > 0) {
        metaRows.push([]);
        metaRows.push([sectionCell(t("reportsAnnotations.appliedFilters"))]);
        for (const [label, value] of filterLines) {
          metaRows.push([label, value]);
        }
      }

      // ── Sheet 2: Statistics charts ───────────────────────────────────────
      const statsRows: Array<Array<any>> = [];
      const pushStatsSection = (
        title: string,
        subtitle: string,
        headers: string[],
        rows: Array<Array<string | number>>,
      ) => {
        statsRows.push([{ value: title, fontWeight: "bold", fontSize: 13 }]);
        statsRows.push([subheadingCell(subtitle)]);
        if (rows.length === 0) {
          statsRows.push([{ value: "No data available for this view.", textColor: "#687385", fontStyle: "italic" as const }]);
        } else {
          statsRows.push(headers.map((header) => headerCell(header)));
          for (const row of rows) statsRows.push(row);
        }
        statsRows.push([]);
      };

      pushStatsSection(
        t("reportsAnnotations.charts.codeCoverage"),
        t("reportsAnnotations.charts.codeCoverageSubtitle", { count: formatCurrentNumber(coverageStats.totalChars) }),
        ["Code", "Color", "Characters", "Percent"],
        coverageStats.rows.map((row) => [
          row.codeName,
          row.codeColor,
          row.chars,
          `${row.pct < 0.1 ? "<0.1" : row.pct.toFixed(1)}%`,
        ]),
      );

      pushStatsSection(
        t("reportsAnnotations.charts.annotationsPerCode"),
        t("reportsAnnotations.charts.annotationsPerCodeSubtitle"),
        ["Code", "Color", "Annotations"],
        annotationFrequencyStats.map((row) => [row.codeName, row.codeColor, row.count]),
      );

      pushStatsSection(
        t("reportsAnnotations.charts.annotationsPerDocument"),
        t("reportsAnnotations.charts.annotationsPerDocumentSubtitle"),
        ["Document", "Annotations"],
        annotationDocumentStats.map((row) => [row.documentName, row.count]),
      );

      pushStatsSection(
        t("reportsAnnotations.charts.annotationLength"),
        ANNOTATION_LENGTH_SUBTITLE,
        ["Code", "Color", "Annotations", "Min", "Q1", "Median", "Q3", "Max", "Mean"],
        annotationLengthStats.rows.map((row) => [
          row.codeName,
          row.codeColor,
          row.count,
          row.min,
          Number(row.q1.toFixed(1)),
          Number(row.median.toFixed(1)),
          Number(row.q3.toFixed(1)),
          row.max,
          Number(row.mean.toFixed(1)),
        ]),
      );

      // ── Sheet 3: Annotations data ────────────────────────────────────────
      const withGroup = annotationGroupBy !== "none";
      const contentMap = await buildExportContentMap();
      const withContext = showContext && contentMap.size > 0;

      const headers = [
        ...(withGroup ? ["Group"] : []),
        "Case", "Document", "Source Type", "Media", "Source Path", "Coder", "Code", "Quote",
        ...(withContext ? ["Context Before", "Context After"] : []),
        "Note",
      ];
      const annRows: Array<Array<any>> = [headers.map((header) => headerCell(header))];

      const annToGroup = new Map<string, string>();
      if (withGroup) {
        for (const group of groupedAnns) {
          for (const ann of group.items) annToGroup.set(ann.id, group.label);
        }
      }

      for (const ann of sortedAnns) {
        const ctx = withContext ? annContext(ann, contentMap) : null;
        annRows.push([
          ...(withGroup ? [annToGroup.get(ann.id) ?? groupLabels[annotationGroupBy]] : []),
          getCaseNameForAnn(ann),
          ann.documentName,
          formatSourceType(sourceKindForAnnotation(ann)),
          mediaSummaryForAnnotation(ann),
          sourcePathForAnnotation(ann),
          displayUserItems.find(u => u.id === ann.createdById)?.name || "—",
          getCodeName(ann),
          wrappedCell(ann.quote),
          ...(withContext ? [
            ctx ? (ctx.ellipsisBefore ? "…" : "") + ctx.before : "",
            ctx ? ctx.after + (ctx.ellipsisAfter ? "…" : "") : "",
          ] : []),
          wrappedCell(ann.note),
        ]);
      }

      const file = writeXlsxFile(
        [
          {
            sheet: "Report",
            data: metaRows,
            columns: [{ width: 22 }, { width: 62 }],
          },
          {
            sheet: t("reportsAnnotations.statistics"),
            data: statsRows,
            columns: [{ width: 72 }],
          },
          {
            sheet: "Annotations",
            data: annRows,
            columns: [
              ...(withGroup ? [{ width: 20 }] : []),
              { width: 20 },
              { width: 26 },
              { width: 14 },
              { width: 28 },
              { width: 38 },
              { width: 18 },
              { width: 20 },
              { width: 52 },
              ...(withContext ? [{ width: 42 }, { width: 42 }] : []),
              { width: 32 },
            ],
            stickyRowsCount: 1,
          },
        ],
        {
          fontFamily: "Calibri",
          fontSize: 11,
        },
      );
      const blob = await file.toBlob();
      await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
      await recordReportExport("xlsx", path);
    } catch (e) {
      console.error("XLSX export failed:", e);
      setError(t("reportsAnnotations.errors.xlsxExportFailed"));
    } finally {
      setExportingFormat(null);
      setShowExportModal(false);
    }
  }

  async function handleExportHTML() {
    if (!canExportReports) return;
    try {
      setExportingFormat("html");
      const path = await save({ defaultPath: `${name || t("reportsAnnotations.untitledReport")}.html`, filters: [{ name: t("reportsAnnotations.fileTypes.html"), extensions: ["html"] }] });
      if (!path) return;
      const contentMap = await buildExportContentMap();
      await writeTextFile(path, await getCleanReportHtml(contentMap));
      await recordReportExport("html", path);
    } catch (e) {
      setError(t("reportsAnnotations.errors.htmlExportFailed"));
    } finally {
      setExportingFormat(null);
      setShowExportModal(false);
    }
  }

  async function handleExportPDF() {
    if (!canExportReports) return;
    try {
      setExportingFormat("pdf");
      const path = await save({ defaultPath: `${name || t("reportsAnnotations.untitledReport")}.pdf`, filters: [{ name: t("reportsAnnotations.fileTypes.pdf"), extensions: ["pdf"] }] });
      if (!path) return;
      
      const { jsPDF } = await loadJsPdf();
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

      const addPdfMediaPreview = async (ann: AnnItem) => {
        const summary = mediaSummaryForAnnotation(ann);
        const sourcePath = sourcePathForAnnotation(ann);
        if (summary) addText(summary, 9, "normal", 4);
        if (sourcePath) addText(`Source file: ${sourcePath}`, 8, "normal", 4);
        const preview = await buildAnnotationImagePreview(ann);
        if (!preview) return;
        const displayW = Math.min(contentWidth, preview.width);
        const displayH = (preview.height / Math.max(preview.width, 1)) * displayW;
        ensureSpace(displayH + 12);
        pdf.addImage(preview.dataUrl, "PNG", margin, y, displayW, displayH);
        y += displayH + 10;
      };

      const pdfGroupLabels: Record<string, string> = { none: t("reportsAnnotations.exportLabels.none"), code: t("reportsAnnotations.exportLabels.code"), document: t("reportsAnnotations.exportLabels.document"), coder: t("reportsAnnotations.exportLabels.coder") };
      const pdfSortLabels: Record<string, string> = { document: t("reportsAnnotations.exportLabels.document"), code: t("reportsAnnotations.exportLabels.code"), coder: t("reportsAnnotations.exportLabels.coder"), quoteLength: t("reportsAnnotations.exportLabels.quoteLength"), quote: t("reportsAnnotations.exportLabels.quoteAZ") };

      addText(name || t("reportsAnnotations.untitledReport"), 20, "bold", 14);
      addText(`${t("reportsAnnotations.createdBy")}: ${row?.createdByName || t("reportsCodes.exportSections.unknown")}`, 10);
      addText(`${t("reportsAnnotations.created")}: ${row ? fmtDate(row.createdAt) : fmtDate(new Date().toISOString())}`, 10);
      addText(`Group by: ${pdfGroupLabels[annotationGroupBy] ?? annotationGroupBy}   Sort by: ${pdfSortLabels[annotationSortBy] ?? annotationSortBy}`, 10, "normal", 14);

      const description = htmlToPlainText(getExportDescriptionHtml());
      if (description) {
        addText("Description", 14, "bold", 8);
        addText(description, 10, "normal", 14);
      }

      addText("Summary", 14, "bold", 8);
      addText(`${t("reportsAnnotations.labels.cases")}: ${caseCount}   ${t("reportsAnnotations.labels.documents")}: ${docCount}   ${t("reportsAnnotations.labels.codes")}: ${codeCount}   ${t("reportsAnnotations.labels.users")}: ${userCount}   ${t("reportsAnnotations.labels.annotations")}: ${filteredAnns.length}`, 10, "normal", 8);

      const pdfFilterLines: string[] = [];
      if (selCaseIds.size > 0) pdfFilterLines.push(`${t("reportsAnnotations.labels.cases")}: ${displayCaseItems.filter((c) => selCaseIds.has(c.id)).map((c) => c.name).join(", ")}`);
      if (selDocIds.size > 0)  pdfFilterLines.push(`${t("reportsAnnotations.labels.documents")}: ${reportDocs.filter((d) => selDocIds.has(d.id)).map((d) => d.name).join(", ")}`);
      if (selCodeIds.size > 0) pdfFilterLines.push(`${t("reportsAnnotations.labels.codes")}: ${reportCodes.filter((c) => selCodeIds.has(c.id)).map((c) => c.label).join(", ")}`);
      if (selUserIds.size > 0) pdfFilterLines.push(`${t("reportsAnnotations.labels.users")}: ${displayUserItems.filter((u) => selUserIds.has(u.id)).map((u) => u.name).join(", ")}`);
      if (caseFilterDetails.length > 0) pdfFilterLines.push(`${t("reportsAnnotations.exportLabels.caseAttributes")}: ${caseFilterDetails.join("; ")}`);
      if (documentFilterDetails.length > 0) pdfFilterLines.push(`${t("reportsAnnotations.exportLabels.documentAttributes")}: ${documentFilterDetails.join("; ")}`);
      if (pdfFilterLines.length > 0) {
        addText(t("reportsAnnotations.appliedFilters"), 14, "bold", 8);
        for (const line of pdfFilterLines) addText(line, 9, "normal", 4);
        y += 10;
      }

      const pdfCharts = [
        { title: t("reportsAnnotations.charts.codeCoverage"), svg: getCoverageChartSvg(true) },
        { title: t("reportsAnnotations.charts.annotationsPerCode"), svg: getAnnotationFrequencyChartSvg(true) },
        { title: t("reportsAnnotations.charts.annotationsPerDocument"), svg: getAnnotationDocumentChartSvg(true) },
        { title: t("reportsAnnotations.charts.annotationLength"), svg: getAnnotationLengthChartSvg(true) },
      ].filter((c): c is { title: string; svg: string } => c.svg !== null);

      if (pdfCharts.length > 0) {
        addText(t("reportsAnnotations.statistics"), 14, "bold", 8);
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

      const addAnnBlock = async (ann: AnnItem) => {
        ensureSpace(76);
        pdf.setDrawColor(210);
        pdf.line(margin, y, pageWidth - margin, y);
        y += 14;
        addText(`${ann.codeName} | ${ann.documentName} | ${getCoderName(ann.createdById)} | ${getCaseNameForAnn(ann)}`, 9, "bold", 6);
        const ctx = annContext(ann, pdfContentMap);
        if (ctx.before) addText(`${ctx.ellipsisBefore ? "…" : ""}${ctx.before}`, 9, "italic", 2);
        if (ann.quote) addText(`"${ann.quote}"`, 10, "italic", ctx.after ? 2 : 6);
        if (ctx.after) addText(`${ctx.after}${ctx.ellipsisAfter ? "…" : ""}`, 9, "italic", 6);
        await addPdfMediaPreview(ann);
        if (ann.note) addText(`Note: ${ann.note}`, 9, "normal", 10);
      };

      if (sortedAnns.length === 0) {
        addText(t("reportsAnnotations.empty.noAnnotationsCaptured"), 10, "italic");
      } else if (annotationGroupBy === "none") {
        for (const ann of sortedAnns) await addAnnBlock(ann);
      } else {
        for (const group of groupedAnns) {
          ensureSpace(30);
          addText(`${group.label} (${group.items.length})`, 11, "bold", 6);
          for (const ann of group.items) await addAnnBlock(ann);
        }
      }

      await writeFile(path, new Uint8Array(pdf.output("arraybuffer")));
      await recordReportExport("pdf", path);
    } catch (e) {
      console.error(e);
      setError(t("reportsAnnotations.errors.pdfExportFailed"));
    } finally {
      setExportingFormat(null);
      setShowExportModal(false);
    }
  }

  async function handleExportDOCX() {
    if (!canExportReports) return;
    try {
      setExportingFormat("docx");
      const path = await save({ defaultPath: `${name || t("reportsAnnotations.untitledReport")}.docx`, filters: [{ name: t("reportsAnnotations.fileTypes.wordDocument"), extensions: ["docx"] }] });
      if (!path) return;

      const {
        Document: DocxDocument,
        HeadingLevel,
        ImageRun,
        Packer,
        Paragraph,
        TextRun,
      } = await loadDocx();

      const docxGroupLabels: Record<string, string> = { none: t("reportsAnnotations.exportLabels.none"), code: t("reportsAnnotations.exportLabels.code"), document: t("reportsAnnotations.exportLabels.document"), coder: t("reportsAnnotations.exportLabels.coder") };
      const docxSortLabels: Record<string, string> = { document: t("reportsAnnotations.exportLabels.document"), code: t("reportsAnnotations.exportLabels.code"), coder: t("reportsAnnotations.exportLabels.coder"), quoteLength: t("reportsAnnotations.exportLabels.quoteLength"), quote: t("reportsAnnotations.exportLabels.quoteAZ") };

      const children: any[] = [
        new Paragraph({ text: name || t("reportsAnnotations.untitledReport"), heading: HeadingLevel.TITLE }),
        new Paragraph(`${t("reportsAnnotations.createdBy")}: ${row?.createdByName || t("reportsCodes.exportSections.unknown")}`),
        new Paragraph(`${t("reportsAnnotations.created")}: ${row ? fmtDate(row.createdAt) : fmtDate(new Date().toISOString())}`),
        new Paragraph(`Group by: ${docxGroupLabels[annotationGroupBy] ?? annotationGroupBy}   |   Sort by: ${docxSortLabels[annotationSortBy] ?? annotationSortBy}`),
        new Paragraph({ text: "Summary", heading: HeadingLevel.HEADING_1 }),
        new Paragraph(`${t("reportsAnnotations.labels.cases")}: ${caseCount}   ${t("reportsAnnotations.labels.documents")}: ${docCount}   ${t("reportsAnnotations.labels.codes")}: ${codeCount}   ${t("reportsAnnotations.labels.users")}: ${userCount}   ${t("reportsAnnotations.labels.annotations")}: ${filteredAnns.length}`),
      ];

      const docxFilterLines: string[] = [];
      if (selCaseIds.size > 0) docxFilterLines.push(`${t("reportsAnnotations.labels.cases")}: ${displayCaseItems.filter((c) => selCaseIds.has(c.id)).map((c) => c.name).join(", ")}`);
      if (selDocIds.size > 0)  docxFilterLines.push(`${t("reportsAnnotations.labels.documents")}: ${reportDocs.filter((d) => selDocIds.has(d.id)).map((d) => d.name).join(", ")}`);
      if (selCodeIds.size > 0) docxFilterLines.push(`${t("reportsAnnotations.labels.codes")}: ${reportCodes.filter((c) => selCodeIds.has(c.id)).map((c) => c.label).join(", ")}`);
      if (selUserIds.size > 0) docxFilterLines.push(`${t("reportsAnnotations.labels.users")}: ${displayUserItems.filter((u) => selUserIds.has(u.id)).map((u) => u.name).join(", ")}`);
      if (caseFilterDetails.length > 0) docxFilterLines.push(`${t("reportsAnnotations.exportLabels.caseAttributes")}: ${caseFilterDetails.join("; ")}`);
      if (documentFilterDetails.length > 0) docxFilterLines.push(`${t("reportsAnnotations.exportLabels.documentAttributes")}: ${documentFilterDetails.join("; ")}`);
      if (docxFilterLines.length > 0) {
        children.push(new Paragraph({ text: t("reportsAnnotations.appliedFilters"), heading: HeadingLevel.HEADING_1 }));
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
        { title: t("reportsAnnotations.charts.codeCoverage"), svg: getCoverageChartSvg(true) },
        { title: t("reportsAnnotations.charts.annotationsPerCode"), svg: getAnnotationFrequencyChartSvg(true) },
        { title: t("reportsAnnotations.charts.annotationsPerDocument"), svg: getAnnotationDocumentChartSvg(true) },
        { title: t("reportsAnnotations.charts.annotationLength"), svg: getAnnotationLengthChartSvg(true) },
      ].filter((c): c is { title: string; svg: string } => c.svg !== null);

      if (docxCharts.length > 0) {
        children.push(new Paragraph({ text: t("reportsAnnotations.statistics"), heading: HeadingLevel.HEADING_1 }));
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

      const addDocxMediaPreview = async (ann: AnnItem) => {
        const summary = mediaSummaryForAnnotation(ann);
        const sourcePath = sourcePathForAnnotation(ann);
        if (summary) children.push(new Paragraph({ children: [new TextRun({ text: summary, color: "687385" })] }));
        if (sourcePath) children.push(new Paragraph({ children: [new TextRun({ text: `Source file: ${sourcePath}`, color: "687385" })] }));
        const preview = await buildAnnotationImagePreview(ann);
        if (!preview) return;
        const displayW = Math.min(480, preview.width);
        const displayH = Math.round((preview.height / Math.max(preview.width, 1)) * displayW);
        const bytes = dataUrlToBytes(preview.dataUrl);
        children.push(new Paragraph({
          children: [new ImageRun({ type: "png", data: bytes.buffer, transformation: { width: displayW, height: displayH } })],
        }));
      };

      const addDocxAnn = async (ann: AnnItem) => {
        const ctx = annContext(ann, docxContentMap);
        const quoteRuns: any[] = [];
        if (ctx.before) quoteRuns.push(new TextRun({ text: (ctx.ellipsisBefore ? "…" : "") + ctx.before, italics: true, color: "9AA5B4" }));
        if (ann.quote) quoteRuns.push(new TextRun({ text: `"${ann.quote}"`, italics: true }));
        if (ctx.after) quoteRuns.push(new TextRun({ text: ctx.after + (ctx.ellipsisAfter ? "…" : ""), italics: true, color: "9AA5B4" }));
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: ann.codeName, bold: true }),
              new TextRun(` | ${ann.documentName} | ${getCoderName(ann.createdById)} | ${getCaseNameForAnn(ann)}`),
            ],
            spacing: { before: 240 },
          }),
        );
        if (quoteRuns.length > 0) children.push(new Paragraph({ children: quoteRuns }));
        await addDocxMediaPreview(ann);
        if (ann.note) {
          children.push(new Paragraph({ children: [new TextRun({ text: "Note: ", bold: true }), new TextRun(ann.note)] }));
        }
      };

      children.push(new Paragraph({ text: t("reportsAnnotations.annotationsTitle"), heading: HeadingLevel.HEADING_1 }));
      if (sortedAnns.length === 0) {
        children.push(new Paragraph({ children: [new TextRun({ text: t("reportsAnnotations.empty.noAnnotationsCaptured"), italics: true })] }));
      } else if (annotationGroupBy === "none") {
        for (const ann of sortedAnns) await addDocxAnn(ann);
      } else {
        for (const group of groupedAnns) {
          children.push(new Paragraph({ text: `${group.label} (${group.items.length})`, heading: HeadingLevel.HEADING_2 }));
          for (const ann of group.items) await addDocxAnn(ann);
        }
      }

      const doc = new DocxDocument({
        creator: row?.createdByName || "Kanqual",
        title: name || t("reportsAnnotations.untitledReport"),
        sections: [{ children }],
      });
      const buffer = await (await Packer.toBlob(doc)).arrayBuffer();
      await writeFile(path, new Uint8Array(buffer));
      await recordReportExport("docx", path);
    } catch (e) {
      console.error(e);
      setError(t("reportsAnnotations.errors.docxExportFailed"));
    } finally {
      setExportingFormat(null);
      setShowExportModal(false);
    }
  }

  return (
    <div className="annotate-view">
      

      {/* ── Top bar ── */}
      <div className="workspace-back-row workspace-back-row--annotate workspace-back-row--split">
        {!hideBackButton && <button className="btn" onClick={onBack}>{t("reportsAnnotations.backToReports")}</button>}
        <div className="report-action-group" style={{ gap: 10, marginLeft: "auto" }}>
          {error && <span style={{ fontSize: 12, color: "var(--color-danger)" }}>{error}</span>}
        </div>
      </div>

      {/* ── 2-column layout ── */}
      <div className="annotate-layout ann-report-annotate-layout">

        {/* Left: filter panels */}
        <div className="annotate-left">
          <div className="annotate-left-title">{t("reportsAnnotations.includeInReport")}</div>

          {/* Objects */}
          <div className="annotate-card">
            <div className="annotate-card-header" style={{ gap: 8 }}>
              <button className="annotate-card-header" style={{ width: "100%", cursor: "pointer", background: "none", border: "none", padding: 0 }} onClick={() => togglePanel("cases")}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="annotate-card-title">{t("reportsAnnotations.panels.cases", { count: selCaseIds.size })}</span>
                  <button
                    type="button"
                    className="filter-icon-button filter-icon-button--compact"
                    aria-label={t("reportsAnnotations.filterObjects")}
                    title={t("reportsAnnotations.filterObjects")}
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
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => applySelectionFromCases(new Set(displayCaseItems.map(c => c.id)))}>{t("reportsCodes.actions.all")}</button>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => clearPrimarySelections()}>{t("reportsCodes.actions.clear")}</button>
                  </div>
                )}
                <div className="code-list" style={{ padding: 0 }}>
                  {dataLoading ? (
                    <div className="code-list-empty">{t("reportsAnnotations.loadingEllipsis")}</div>
                  ) : displayCaseItems.length === 0 ? (
                    <div className="code-list-empty">{t("reportsAnnotations.empty.noCases")}</div>
                  ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: "var(--text-xs)" }}>
                      <colgroup>
                        <col style={{ width: 24 }} />
                        <col style={{ width: 72 }} />
                        <col />
                      </colgroup>
                      <thead>
                        <tr style={{ color: "var(--color-text-muted)", textAlign: "left" }}>
                          <th aria-label={t("reportsAnnotations.selectObject")} style={{ padding: "6px 2px 6px 8px", fontWeight: 600 }} />
                          <th style={{ padding: "6px 6px 6px 4px", fontWeight: 600 }}>{t("reportsAnnotations.typeColumn")}</th>
                          <th style={{ padding: "6px 6px", fontWeight: 600 }}>{t("reportsAnnotations.titleColumn")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayCaseItems.map((c) => {
                          const isSelectedObject = selCaseIds.has(c.id);
                          return (
                            <tr
                              key={c.id}
                              onClick={isFrozen ? undefined : () => applySelectionFromCases(toggle(selCaseIds, c.id))}
                              style={{
                                cursor: isFrozen ? "default" : "pointer",
                                background: isSelectedObject ? "var(--color-surface-hover)" : "transparent",
                              }}
                            >
                              <td style={{ padding: "6px 2px 6px 8px", verticalAlign: "top" }}>
                                <input
                                  type="checkbox"
                                  className="memo-sel-checkbox"
                                  checked={isSelectedObject}
                                  disabled={isFrozen}
                                  onChange={isFrozen ? undefined : (e) => { e.stopPropagation(); applySelectionFromCases(toggle(selCaseIds, c.id)); }}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </td>
                              <td className="code-label" style={{ padding: "6px 6px 6px 4px", verticalAlign: "top" }}>
                                {formatObjectType(c.objectType)}
                              </td>
                              <td className="code-label" style={{ padding: "6px 6px", verticalAlign: "top" }}>
                                {c.name}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Sources */}
          <div className="annotate-card">
            <div className="annotate-card-header" style={{ gap: 8 }}>
              <button className="annotate-card-header" style={{ width: "100%", cursor: "pointer", background: "none", border: "none", padding: 0 }} onClick={() => togglePanel("documents")}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="annotate-card-title">{t("reportsAnnotations.panels.documents", { count: selDocIds.size })}</span>
                  <button
                    type="button"
                    className="filter-icon-button filter-icon-button--compact"
                    aria-label={t("reportsAnnotations.filterSources")}
                    title={t("reportsAnnotations.filterSources")}
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
                {!isFrozen && reportDocs.length > 0 && (
                  <div style={{ padding: "2px 14px 4px", display: "flex", gap: 8 }}>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => applySelectionFromDocuments(new Set(reportDocs.map(d => d.id)))}>{t("reportsCodes.actions.all")}</button>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => clearPrimarySelections()}>{t("reportsCodes.actions.clear")}</button>
                  </div>
                )}
                <div className="code-list" style={{ padding: 0 }}>
                  {reportDocs.length === 0 ? (
                    <div className="code-list-empty">{t("reportsAnnotations.empty.noDocuments")}</div>
                  ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: "var(--text-xs)" }}>
                      <colgroup>
                        <col style={{ width: 24 }} />
                        <col style={{ width: 48 }} />
                        <col />
                      </colgroup>
                      <thead>
                        <tr style={{ color: "var(--color-text-muted)", textAlign: "left" }}>
                          <th aria-label={t("reportsAnnotations.selectSource")} style={{ padding: "6px 2px 6px 8px", fontWeight: 600 }} />
                          <th style={{ padding: "6px 6px 6px 4px", fontWeight: 600 }}>{t("reportsAnnotations.typeColumn")}</th>
                          <th style={{ padding: "6px 6px", fontWeight: 600 }}>{t("reportsAnnotations.titleColumn")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportDocs.map((d) => {
                          const isSelectedSource = selDocIds.has(d.id);
                          return (
                            <tr
                              key={d.id}
                              onClick={isFrozen ? undefined : () => applySelectionFromDocuments(toggle(selDocIds, d.id))}
                              style={{
                                cursor: isFrozen ? "default" : "pointer",
                                background: isSelectedSource ? "var(--color-surface-hover)" : "transparent",
                              }}
                            >
                              <td style={{ padding: "6px 2px 6px 8px", verticalAlign: "top" }}>
                                <input
                                  type="checkbox"
                                  className="memo-sel-checkbox"
                                  checked={isSelectedSource}
                                  disabled={isFrozen}
                                  onChange={isFrozen ? undefined : (e) => { e.stopPropagation(); applySelectionFromDocuments(toggle(selDocIds, d.id)); }}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </td>
                              <td className="code-label" style={{ padding: "6px 6px 6px 4px", verticalAlign: "top" }}>
                                {formatSourceType(d.type)}
                              </td>
                              <td className="code-label" style={{ padding: "6px 6px", verticalAlign: "top" }}>
                                {d.name}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Relationships */}
          <div className="annotate-card">
            <button className="annotate-card-header" style={{ width: "100%", cursor: "pointer", background: "none", border: "none" }} onClick={() => togglePanel("relationships")}>
              <span className="annotate-card-title">{t("reportsAnnotations.panels.relationships", { count: selRelationshipIds.size })}</span>
              <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-muted)" }}>{collapsed.has("relationships") ? "▶" : "▼"}</span>
            </button>
            {!collapsed.has("relationships") && (
              <>
                {!isFrozen && !dataLoading && displayRelationshipItems.length > 0 && (
                  <div style={{ padding: "2px 14px 4px", display: "flex", gap: 8 }}>
                    <button
                      className="btn"
                      style={{ fontSize: 11, padding: "1px 8px" }}
                      onClick={() => applySelectionFromRelationships(new Set(displayRelationshipItems.filter((relationship) => relationship.object1Id && relationship.object2Id).map((relationship) => relationship.id)))}
                    >
                      {t("reportsCodes.actions.all")}
                    </button>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => clearPrimarySelections()}>
                      {t("reportsCodes.actions.clear")}
                    </button>
                  </div>
                )}
                <div className="code-list" style={{ padding: 0 }}>
                  {dataLoading ? (
                    <div className="code-list-empty">{t("reportsAnnotations.loadingEllipsis")}</div>
                  ) : displayRelationshipItems.length === 0 ? (
                    <div className="code-list-empty">{t("reportsAnnotations.empty.noRelationships")}</div>
                  ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: "var(--text-xs)" }}>
                    <colgroup>
                      <col style={{ width: 24 }} />
                      <col />
                      <col />
                      <col />
                    </colgroup>
                    <thead>
                      <tr style={{ color: "var(--color-text-muted)", textAlign: "left" }}>
                        <th aria-label={t("reportsAnnotations.selectRelationship")} style={{ padding: "6px 2px 6px 8px", fontWeight: 600 }} />
                        {[
                          ["relationshipType", "Type"],
                          ["object1Name", "Object 1"],
                          ["object2Name", "Object 2"],
                        ].map(([key, label]) => (
                          <th key={key} style={{ padding: 0, fontWeight: 600 }}>
                            <button
                              type="button"
                              onClick={() => toggleRelationshipSort(key as RelationshipSortKey)}
                              style={{
                                width: "100%",
                                padding: key === "relationshipType" ? "6px 6px 6px 4px" : "6px 6px",
                                border: "none",
                                background: "none",
                                color: "inherit",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 6,
                                font: "inherit",
                                fontWeight: 600,
                                textAlign: "left",
                              }}
                            >
                              <span>{label}</span>
                              <span aria-hidden="true">
                                {relationshipSortKey === key ? (relationshipSortDir === "asc" ? "↑" : "↓") : "↕"}
                              </span>
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRelationshipItems.map((relationship) => {
                        const canSelectRelationship = !isFrozen && !!relationship.object1Id && !!relationship.object2Id;
                        const isSelectedRelationship = selRelationshipIds.has(relationship.id);
                        return (
                          <tr
                            key={relationship.id}
                            onClick={canSelectRelationship ? () => applySelectionFromRelationships(toggle(selRelationshipIds, relationship.id)) : undefined}
                            style={{
                              cursor: canSelectRelationship ? "pointer" : "default",
                            background: isSelectedRelationship ? "var(--color-surface-hover)" : "transparent",
                          }}
                        >
                            <td style={{ padding: "6px 2px 6px 8px", verticalAlign: "top" }}>
                              <input
                                type="checkbox"
                                className="memo-sel-checkbox"
                                checked={isSelectedRelationship}
                                disabled={!canSelectRelationship}
                                onChange={canSelectRelationship ? (e) => { e.stopPropagation(); applySelectionFromRelationships(toggle(selRelationshipIds, relationship.id)); } : undefined}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </td>
                            <td className="code-label" style={{ padding: "6px 6px 6px 4px", verticalAlign: "top" }}>
                              {relationshipColumnValue(relationship, "relationshipType")}
                            </td>
                            <td className="code-label" style={{ padding: "6px 6px", verticalAlign: "top" }}>
                              {relationshipColumnValue(relationship, "object1Name")}
                            </td>
                            <td className="code-label" style={{ padding: "6px 6px", verticalAlign: "top" }}>
                              {relationshipColumnValue(relationship, "object2Name")}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Codes */}
          <div className="annotate-card">
            <button className="annotate-card-header" style={{ width: "100%", cursor: "pointer", background: "none", border: "none" }} onClick={() => togglePanel("codes")}>
              <span className="annotate-card-title">{t("reportsAnnotations.panels.codes", { count: selCodeIds.size })}</span>
              <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-muted)" }}>{collapsed.has("codes") ? "▶" : "▼"}</span>
            </button>
            {!collapsed.has("codes") && (
              <>
                {!isFrozen && reportCodes.length > 0 && (
                  <div style={{ padding: "2px 14px 4px", display: "flex", gap: 8 }}>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => applySelectionFromCodes(new Set(reportCodes.map(c => c.id)))}>{t("reportsCodes.actions.all")}</button>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => clearPrimarySelections()}>{t("reportsCodes.actions.clear")}</button>
                  </div>
                )}
                <ul className="code-list" style={{ overflowY: "auto", flex: 1 }}>
                  {reportCodes.length === 0
                    ? <li className="code-list-empty">{t("reportsAnnotations.empty.noCodes")}</li>
                    : codeTree.map(({ code: c, depth }) => (
                        <li key={c.id} className="code-item"
                          style={{ cursor: isFrozen ? "default" : "pointer" }}
                          onClick={isFrozen ? undefined : () => toggleCodeSelection(c.id)}
                        >
                          <input type="checkbox" className="memo-sel-checkbox"
                            checked={selCodeIds.has(c.id)} disabled={isFrozen}
                            onChange={isFrozen ? undefined : (e) => { e.stopPropagation(); toggleCodeSelection(c.id); }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          {depth > 0 && <span aria-hidden="true" style={{ flex: "0 0 auto", width: depth * 16 }} />}
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
              <span className="annotate-card-title">{t("reportsAnnotations.panels.users", { count: selUserIds.size })}</span>
              <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-muted)" }}>{collapsed.has("users") ? "▶" : "▼"}</span>
            </button>
            {!collapsed.has("users") && (
              <>
                {!isFrozen && !dataLoading && displayUserItems.length > 0 && (
                  <div style={{ padding: "2px 14px 4px", display: "flex", gap: 8 }}>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => applySelectionFromUsers(new Set(displayUserItems.map(u => u.id)))}>{t("reportsCodes.actions.all")}</button>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => clearPrimarySelections()}>{t("reportsCodes.actions.clear")}</button>
                  </div>
                )}
                <ul className="code-list" style={{ overflowY: "auto", flex: 1 }}>
                  {dataLoading
                    ? <li className="code-list-empty">{t("reportsAnnotations.loadingEllipsis")}</li>
                    : displayUserItems.length === 0
                      ? <li className="code-list-empty">{t("reportsAnnotations.empty.noUsers")}</li>
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
            <div className="annotate-card-header" style={{ gap: 10 }}>
              <span className="annotate-card-title">{t("reportsAnnotations.reportTitle")}</span>
              <div className="report-action-group" style={{ gap: 8, marginLeft: "auto" }}>
                <button
                  type="button"
                  className="btn btn--secondary project-table-header-icon-button report-title-action-button"
                  title={
                    !isFrozen
                      ? t("reportsAnnotations.exportSavedOnly")
                      : !canExportReports
                        ? "You do not have permission to export reports"
                        : t("reportsAnnotations.exportTitle")
                  }
                  disabled={!isFrozen || !canExportReports}
                  onClick={() => setShowExportModal(true)}
                  aria-label={t("reportsAnnotations.exportButton")}
                >
                  <DownloadIcon className="project-table-header-icon" />
                </button>
                {isFrozen && onUseSettings && canStartReports && (
                  <button
                    type="button"
                    className="btn btn--secondary project-table-header-icon-button report-title-action-button"
                    onClick={() => onUseSettings({
                      caseIds: row!.caseIds,
                      documentIds: row!.documentIds,
                      codeIds: row!.codeIds,
                      userIds: row!.snapshot?.selectedUserIds ?? [],
                      relationshipIds: row!.snapshot?.selectedRelationshipIds ?? [],
                      caseAttributeIds: row!.snapshot?.selectedCaseAttributeIds ?? [],
                      documentAttributeIds: row!.snapshot?.selectedDocumentAttributeIds ?? [],
                      caseAttributeFilters: row!.snapshot?.caseAttributeFilters ?? {},
                      documentAttributeFilters: row!.snapshot?.documentAttributeFilters ?? {},
                    })}
                    title={t("reportsAnnotations.useSettingsForNewReport")}
                    aria-label={t("reportsAnnotations.useSettingsForNewReport")}
                  >
                    <RestartListIcon className="project-table-header-icon" />
                  </button>
                )}
                {!isFrozen && (
                  <button
                    type="button"
                    className="btn btn--primary project-table-header-icon-button report-title-action-button"
                    onClick={handleSave}
                    disabled={saving || !name.trim() || !canStartReports}
                    title={saving ? t("reportsAnnotations.saving") : t("reportsAnnotations.saveReport")}
                    aria-label={saving ? t("reportsAnnotations.saving") : t("reportsAnnotations.saveReport")}
                  >
                    <SaveIcon className="project-table-header-icon" />
                  </button>
                )}
              </div>
            </div>
            <div style={{ padding: "10px 14px" }}>
              {!isFrozen ? (
                <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("reportsAnnotations.reportNamePlaceholder")} autoFocus={isNew} />
              ) : (
                <p className="case-card-value">{name || t("reportsAnnotations.untitledReport")}</p>
              )}
            </div>
          </div>

          {/* Details */}
          <div className="annotate-card" style={{ flexShrink: 0 }}>
            <div className="annotate-card-header"><span className="annotate-card-title">{t("reportsAnnotations.details")}</span></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "10px 14px", fontSize: 13 }}>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <span>
              <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>{t("reportsAnnotations.createdBy")} </span>
                <span>{row?.createdByName || "—"}</span>
              </span>
              <span>
                <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>{t("reportsAnnotations.created")} </span>
                <span>{row ? fmtDate(row.createdAt) : "—"}</span>
              </span>
              {isFrozen && (
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 600, background: "var(--color-surface-alt)",
                    border: "1px solid var(--color-border)", borderRadius: 4,
                    padding: "1px 6px", color: "var(--color-text-muted)",
                    letterSpacing: "0.05em",
                  }}>
                    {t("reportsAnnotations.frozen")}
                  </span>
                </span>
              )}
              </div>
            </div>
          </div>

          {/* Report description */}
          {(!isFrozen || showDescription) && (
            <div className="annotate-card" style={{ flexShrink: 0 }}>
              <div className="annotate-card-header">
                <span className="annotate-card-title">{t("reportsAnnotations.reportDescription")}</span>
                {!isFrozen ? (
                  <label className="toggle-switch" style={{ marginBottom: 0 }}>
                    <input type="checkbox" checked={showDescription} onChange={(e) => setShowDescription(e.target.checked)} />
                    <span className="toggle-track"><span className="toggle-thumb" /></span>
                    <span style={{ fontSize: 13 }}>{t("reportsAnnotations.addDescription")}</span>
                  </label>
                ) : null}
              </div>
              {showDescription && (
                <>
                  {!isFrozen && editor && (
                    <div className="report-description-toolbar" style={{ padding: "0 14px 10px" }}>
                      <button className={`rte-btn${editor.isActive("bold")        ? " rte-btn--active" : ""}`} onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }} title={t("reportsCommon.richText.bold")}>B</button>
                      <button className={`rte-btn${editor.isActive("italic")      ? " rte-btn--active" : ""}`} onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }} title={t("reportsCommon.richText.italic")}><em>I</em></button>
                      <button className={`rte-btn${editor.isActive("strike")      ? " rte-btn--active" : ""}`} onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleStrike().run(); }} title={t("reportsCommon.richText.strikethrough")}><s>S</s></button>
                      <span className="rte-divider" />
                      <button className={`rte-btn${editor.isActive("bulletList")  ? " rte-btn--active" : ""}`} onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBulletList().run(); }} title={t("reportsCommon.richText.bulletList")}>≡</button>
                      <button className={`rte-btn${editor.isActive("orderedList") ? " rte-btn--active" : ""}`} onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleOrderedList().run(); }} title={t("reportsCommon.richText.numberedList")}>1.</button>
                      <span className="rte-divider" />
                      <button className={`rte-btn${editor.isActive("blockquote")  ? " rte-btn--active" : ""}`} onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBlockquote().run(); }} title={t("reportsCommon.richText.blockquote")}>"</button>
                    </div>
                  )}
                  <EditorContent editor={editor} />
                </>
              )}
            </div>
          )}

          <div className="annotate-card" style={{ flexShrink: 0 }}>
            <div className="annotate-card-header">
              <span className="annotate-card-title">{t("reportsAnnotations.filtersTitle")}</span>
            </div>
            <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
              {!hasActiveFilters ? (
                <div style={{ color: "var(--color-text-muted)" }}>{t("reportsAnnotations.allSelectedObjectsAndSources")}</div>
              ) : (
                <>
                  {activeCaseFilterDetails.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ fontWeight: 600 }}>{t("reportsAnnotations.labels.cases")}</div>
                      {activeCaseFilterDetails.map((detail) => (
                        <div key={`case-filter-${detail}`} style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                          {detail}
                        </div>
                      ))}
                    </div>
                  )}
                  {activeDocumentFilterDetails.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ fontWeight: 600 }}>{t("reportsAnnotations.labels.documents")}</div>
                      {activeDocumentFilterDetails.map((detail) => (
                        <div key={`document-filter-${detail}`} style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                          {detail}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

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
                        {t("reportsAnnotations.noneIncluded")}
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
                <span className="annotate-card-title">{t("reportsAnnotations.statistics")}</span>
                {!isFrozen ? (
                  <label className="toggle-switch" style={{ marginBottom: 0 }}>
                    <input type="checkbox" checked={showCoverage} onChange={(e) => setShowCoverage(e.target.checked)} />
                    <span className="toggle-track"><span className="toggle-thumb" /></span>
                    <span style={{ fontSize: 13 }}>{t("reportsAnnotations.controls.showStatistics")}</span>
                  </label>
                ) : null}
              </div>
              {showCoverage && (
                <div style={{ padding: "12px 14px" }}>
                  {dataLoading ? (
                    <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{t("reportsAnnotations.loadingEllipsis")}</p>
                  ) : filteredAnns.length === 0 ? (
                    <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{t("reportsAnnotations.empty.noStatsForFilters")}</p>
                  ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{t("reportsAnnotations.charts.annotationsPerCode")}</div>
                            <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                              {t("reportsAnnotations.charts.annotationsPerCodeSubtitle")}
                            </div>
                          </div>
                          {annotationFrequencyStats.length === 0 ? (
                            <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>{t("reportsAnnotations.empty.noAnnotationFrequencyForFilters")}</p>
                          ) : (
                            <Suspense
                              fallback={
                                <div
                                  style={{
                                    width: "100%",
                                    height: Math.max(76 + annotationFrequencyStats.length * 24, 120),
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 12,
                                    color: "var(--color-text-muted)",
                                  }}
                                >
                                  {t("reportsAnnotations.loadingEllipsis")}
                                </div>
                              }
                            >
                              <EChart
                                option={annotationFrequencyChartOption}
                                style={{ width: "100%", height: Math.max(76 + annotationFrequencyStats.length * 24, 120) }}
                                setOptionOpts={{ notMerge: true }}
                              />
                            </Suspense>
                          )}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{t("reportsAnnotations.charts.annotationsPerDocument")}</div>
                            <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                              {t("reportsAnnotations.charts.annotationsPerDocumentSubtitle")}
                            </div>
                          </div>
                          {annotationDocumentStats.length === 0 ? (
                            <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>{t("reportsAnnotations.empty.noDocumentFrequencyForFilters")}</p>
                          ) : (
                            <Suspense
                              fallback={
                                <div
                                  style={{
                                    width: "100%",
                                    height: Math.max(76 + annotationDocumentStats.length * 24, 120),
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 12,
                                    color: "var(--color-text-muted)",
                                  }}
                                >
                                  {t("reportsAnnotations.loadingEllipsis")}
                                </div>
                              }
                            >
                              <EChart
                                option={annotationDocumentChartOption}
                                style={{ width: "100%", height: Math.max(76 + annotationDocumentStats.length * 24, 120) }}
                                setOptionOpts={{ notMerge: true }}
                              />
                            </Suspense>
                          )}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{t("reportsAnnotations.charts.codeCoverage")}</div>
                            <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                              {t("reportsAnnotations.charts.codeCoverageSubtitle", { count: formatCurrentNumber(coverageStats.totalChars) })}
                            </div>
                          </div>
                          {coverageStats.rows.length === 0 ? (
                            <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>{t("reportsAnnotations.empty.noCoverageForFilters")}</p>
                          ) : (
                            <Suspense
                              fallback={
                                <div
                                  style={{
                                    width: "100%",
                                    height: Math.max(76 + coverageStats.rows.length * 24, 120),
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 12,
                                    color: "var(--color-text-muted)",
                                  }}
                                >
                                  {t("reportsAnnotations.loadingEllipsis")}
                                </div>
                              }
                            >
                              <EChart
                                option={coverageChartOption}
                                style={{ width: "100%", height: Math.max(76 + coverageStats.rows.length * 24, 120) }}
                                setOptionOpts={{ notMerge: true }}
                              />
                            </Suspense>
                          )}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{t("reportsAnnotations.charts.annotationLength")}</div>
                            <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                              {ANNOTATION_LENGTH_SUBTITLE}
                            </div>
                          </div>
                          {annotationLengthStats.rows.length === 0 ? (
                            <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>
                              {t("reportsAnnotations.empty.noAnnotationLengthForFilters")}
                            </p>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                              <Suspense
                                fallback={
                                  <div
                                    style={{
                                      width: "100%",
                                      height: Math.max(96 + annotationLengthStats.rows.length * 34, 140),
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      fontSize: 12,
                                      color: "var(--color-text-muted)",
                                    }}
                                  >
                                    {t("reportsAnnotations.loadingEllipsis")}
                                  </div>
                                }
                              >
                                <EChart
                                  option={annotationLengthChartOption}
                                  style={{ width: "100%", height: Math.max(96 + annotationLengthStats.rows.length * 34, 140) }}
                                  setOptionOpts={{ notMerge: true }}
                                />
                              </Suspense>
                              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11, color: "var(--color-text-muted)" }}>
                                <span>{t("reportsAnnotations.charts.codesCount", { count: annotationLengthStats.rows.length })}</span>
                                <span>{t("reportsAnnotations.charts.maxLengthValue", { value: Math.round(annotationLengthStats.maxValue) })}</span>
                                <span>{t("reportsAnnotations.charts.totalAnnotationsValue", { count: annotationLengthStats.rows.reduce((sum, row) => sum + row.count, 0) })}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Annotations */}
          <div className="annotate-card" style={{ flexShrink: 0 }}>
            <div className="annotate-card-header">
              <span className="annotate-card-title">{t("reportsAnnotations.annotationsTitle")}{filteredAnns.length > 0 ? ` (${filteredAnns.length})` : ""}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                  <span style={{ whiteSpace: "nowrap" }}>{t("reportsAnnotations.controls.groupBy")}</span>
                  <select
                    className="form-input"
                    value={annotationGroupBy}
                    onChange={(e) => setAnnotationGroupBy(e.target.value as AnnotationGroupBy)}
                    style={{ padding: "2px 22px 2px 8px", fontSize: 11, minWidth: 96 }}
                  >
                    <option value="none">{t("reportsAnnotations.none")}</option>
                    <option value="code">{t("reportsAnnotations.controls.code")}</option>
                    <option value="document">{t("reportsAnnotations.controls.document")}</option>
                    <option value="coder">{t("reportsAnnotations.controls.coder")}</option>
                  </select>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                  <span style={{ whiteSpace: "nowrap" }}>{t("reportsAnnotations.controls.sortBy")}</span>
                  <select
                    className="form-input"
                    value={annotationSortBy}
                    onChange={(e) => setAnnotationSortBy(e.target.value as AnnotationSortBy)}
                    style={{ padding: "2px 22px 2px 8px", fontSize: 11, minWidth: 116 }}
                  >
                    <option value="document">{t("reportsAnnotations.controls.document")}</option>
                    <option value="code">{t("reportsAnnotations.controls.code")}</option>
                    <option value="coder">{t("reportsAnnotations.controls.coder")}</option>
                    <option value="quoteLength">{t("reportsAnnotations.controls.quoteLength")}</option>
                    <option value="quote">{t("reportsAnnotations.controls.quoteAZ")}</option>
                  </select>
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {!isFrozen && (
                  <>
                    <label className="toggle-switch" style={{ marginBottom: 0 }}>
                      <input type="checkbox" checked={showContext} onChange={(e) => setShowContext(e.target.checked)} />
                      <span className="toggle-track"><span className="toggle-thumb" /></span>
                      <span style={{ fontSize: 11 }}>{t("reportsAnnotations.context")}</span>
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
                    {t("reportsAnnotations.controls.contextChars", { count: contextChars })}
                  </span>
                )}
                </div>
              </div>
            </div>
            {dataLoading ? (
              <div style={{ padding: "12px 14px", fontSize: 12, color: "var(--color-text-muted)" }}>{t("reportsAnnotations.loadingEllipsis")}</div>
            ) : filteredAnns.length === 0 ? (
              <div style={{ padding: "12px 14px", fontSize: 12, color: "var(--color-text-muted)" }}>
                {isFrozen ? t("reportsAnnotations.empty.noAnnotationsCaptured") : (allAnns.length === 0 ? t("reportsAnnotations.empty.noAnnotationsInProject") : t("reportsAnnotations.empty.noAnnotationsForFilters"))}
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
                          <AnnotationMediaPreview
                            annotation={ann}
                            source={reportDocById.get(ann.documentId)}
                            projectStoragePath={projectStoragePath}
                          />
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
        <SettingsModal title={t("reportsAnnotations.filters.caseTitle")} onClose={() => setShowCaseAttributeFilters(false)} modalClassName="modal--wide">
          <div className="app-settings-modal-body">
            {!isFrozen && !dataLoading && caseTypeOptions.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{t("reportsAnnotations.objectType")}</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => setSelCaseTypes(new Set(caseTypeOptions))}>{t("reportsCodes.actions.all")}</button>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => setSelCaseTypes(new Set())}>{t("reportsCodes.actions.clear")}</button>
                  </div>
                </div>
                <ul className="code-list" style={{ border: "1px solid var(--color-border)", borderRadius: 8, maxHeight: 180, overflowY: "auto" }}>
                  {caseTypeOptions.map((typeLabel) => (
                    <li
                      key={typeLabel}
                      className="code-item"
                      style={{ cursor: "pointer" }}
                      onClick={() => toggleCaseTypeSelection(typeLabel)}
                    >
                      <input
                        type="checkbox"
                        className="memo-sel-checkbox"
                        checked={selCaseTypes.has(typeLabel)}
                        onChange={(e) => { e.stopPropagation(); toggleCaseTypeSelection(typeLabel); }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="code-label">{typeLabel}</span>
                      <span className="users-filter-count">
                        {caseItems.filter((item) => formatObjectType(item.objectType) === typeLabel).length}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!isFrozen && !dataLoading && displayCaseAttributeItems.length > 0 && (
              <div style={{ paddingBottom: 8, display: "flex", gap: 8 }}>
                <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => selectAllCaseAttributes()}>{t("reportsCodes.actions.all")}</button>
                <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => clearCaseAttributeSelections()}>{t("reportsCodes.actions.clear")}</button>
              </div>
            )}
            <ul className="code-list">
              {dataLoading
                ? <li className="code-list-empty">{t("reportsAnnotations.loadingEllipsis")}</li>
                : displayCaseAttributeItems.length === 0
                  ? <li className="code-list-empty">{t("reportsAnnotations.empty.noCaseAttributes")}</li>
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
                        <span className="users-filter-count">{item.dataType === "datetime" ? t("reportsAnnotations.attributeTypes.datetime") : item.dataType}</span>
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
        </SettingsModal>
      )}

      {showDocumentAttributeFilters && (
        <SettingsModal title={t("reportsAnnotations.filters.documentTitle")} onClose={() => setShowDocumentAttributeFilters(false)} modalClassName="modal--wide">
          <div className="app-settings-modal-body">
            {!isFrozen && !dataLoading && documentTypeOptions.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{t("reportsAnnotations.sourceType")}</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => setSelDocTypes(new Set(documentTypeOptions))}>{t("reportsCodes.actions.all")}</button>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => setSelDocTypes(new Set())}>{t("reportsCodes.actions.clear")}</button>
                  </div>
                </div>
                <ul className="code-list" style={{ border: "1px solid var(--color-border)", borderRadius: 8, maxHeight: 180, overflowY: "auto" }}>
                  {documentTypeOptions.map((typeLabel) => (
                    <li
                      key={typeLabel}
                      className="code-item"
                      style={{ cursor: "pointer" }}
                      onClick={() => toggleDocumentTypeSelection(typeLabel)}
                    >
                      <input
                        type="checkbox"
                        className="memo-sel-checkbox"
                        checked={selDocTypes.has(typeLabel)}
                        onChange={(e) => { e.stopPropagation(); toggleDocumentTypeSelection(typeLabel); }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="code-label">{typeLabel}</span>
                      <span className="users-filter-count">
                        {reportDocs.filter((doc) => formatSourceType(doc.type) === typeLabel).length}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!isFrozen && !dataLoading && displayDocumentAttributeItems.length > 0 && (
              <div style={{ paddingBottom: 8, display: "flex", gap: 8 }}>
                <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => selectAllDocumentAttributes()}>{t("reportsCodes.actions.all")}</button>
                <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => clearDocumentAttributeSelections()}>{t("reportsCodes.actions.clear")}</button>
              </div>
            )}
            <ul className="code-list">
              {dataLoading
                ? <li className="code-list-empty">{t("reportsAnnotations.loadingEllipsis")}</li>
                : displayDocumentAttributeItems.length === 0
                  ? <li className="code-list-empty">{t("reportsAnnotations.empty.noDocumentAttributes")}</li>
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
                        <span className="users-filter-count">{item.dataType === "datetime" ? t("reportsAnnotations.attributeTypes.datetime") : item.dataType}</span>
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
        </SettingsModal>
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

export type CodeReportsViewProps = {
  initialNewReportOpen?: boolean;
  initialSavedReport?: ReportRow | null;
  postgresProjectId?: string;
  projectStoragePath?: string;
  onBackToReports?: () => void;
};

export function CodeReportsView({ initialNewReportOpen = false, initialSavedReport = null, postgresProjectId, projectStoragePath, onBackToReports }: CodeReportsViewProps = {}) {
  const { t } = useI18n();
  const cols = getCols(t);
  const canCreateReports = true;
  const canDeleteReports = true;

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

  const [openRow,        setOpenRow]        = useState<ReportRow | null>(initialSavedReport);
  const [showNew,        setShowNew]        = useState(initialNewReportOpen);
  const [newFromSettings, setNewFromSettings] = useState<ReportSettings | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadReports = useCallback(async () => {
    if (!postgresProjectId) return [];
    setLoading(true);
    setError(null);
    try {
      const records = await listPostgresReports(postgresProjectId);
      const mappedRows = records
        .filter((record) => record.reportType === "annotations")
        .map((record) => {
          try {
            const snapshot = JSON.parse(record.contentJson || "") as ReportSnapshot;
            if (snapshot?.reportType !== "annotations") return null;
            const settings = JSON.parse(record.settingsJson || "{}") as Partial<ReportSettings>;
            return {
              id: record.id,
              name: record.title,
              createdByName: record.createdByName || "-",
              createdAt: record.createdAt,
              caseIds: settings.caseIds ?? [],
              documentIds: settings.documentIds ?? snapshot.filteredAnns.map((ann) => ann.documentId),
              codeIds: settings.codeIds ?? snapshot.filteredAnns.map((ann) => ann.codeId),
              snapshot,
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean) as ReportRow[];
      setRows(mappedRows);
      return mappedRows;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("reportsAnnotations.errors.loadReportsFailed"));
      return [];
    } finally {
      setLoading(false);
    }
  }, [postgresProjectId, t]);

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
      if (!postgresProjectId) throw new Error(t("reportsCommon.projectWorkspaceRequired"));
      await deletePostgresReport(postgresProjectId, confirmDelete.id);
      setRows((prev) => prev.filter((r) => r.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("reportsAnnotations.errors.deleteReportFailed"));
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
        postgresProjectId={postgresProjectId}
        projectStoragePath={projectStoragePath}
        hideBackButton={!!onBackToReports}
        onSaved={async (id) => { 
          setShowNew(false); 
          setNewFromSettings(null); 
          const newRows = await loadReports();
          if (id) {
            const newRow = newRows.find((r) => r.id === id);
            if (newRow) setOpenRow(newRow);
          }
        }}
        onBack={() => {
          if (onBackToReports) {
            onBackToReports();
            return;
          }
          setShowNew(false);
          setNewFromSettings(null);
        }}
      />
    );
  }

  if (openRow) {
    return (
      <ReportPage
        key={`saved-report-${openRow.id}`}
        row={openRow}
        postgresProjectId={postgresProjectId}
        projectStoragePath={projectStoragePath}
        hideBackButton={!!onBackToReports}
        onSaved={() => { setOpenRow(null); loadReports(); }}
        onBack={() => {
          if (onBackToReports) {
            onBackToReports();
            return;
          }
          setOpenRow(null);
        }}
        onUseSettings={(settings) => { setOpenRow(null); setNewFromSettings(settings); }}
      />
    );
  }

  // ── Table ─────────────────────────────────────────────────────────────────

  return (
    <div className="view users-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>{t("reportsAnnotations.title")}</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            aria-label={t("reportsAnnotations.openHelp")}
            title={t("reportsAnnotations.openHelp")}
            onClick={() => setHelpOpen(true)}
          >
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
        <button
          className="btn btn--primary"
          onClick={() => setShowNew(true)}
          disabled={!canCreateReports}
          title={!canCreateReports ? t("reportsAnnotations.newReportDenied") : undefined}
        >
          {t("reportsAnnotations.newReport")}
        </button>
      </header>

      {error && <p className="users-error">{error}</p>}

      <div className="users-content">
        <section className="users-layout-main">
          <div className="users-table-wrap" style={{ maxHeight: 34 + (Math.max(loading || sorted.length === 0 ? 1 : sorted.length, 1) + 2) * 36 }}>
            <table className="users-table">
              <thead>
                <tr>
                  {cols.map((col) => (
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
                {loading && <tr><td colSpan={3} className="users-td-msg">{t("reportsAnnotations.loading")}</td></tr>}
                {!loading && sorted.length === 0 && <tr><td colSpan={3} className="users-td-msg">{t("reportsAnnotations.noReports")}</td></tr>}
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
        <SettingsModal title={t("reportsAnnotations.help.title")} onClose={() => setHelpOpen(false)} modalClassName="modal--help">
          <div className="app-settings-modal-body">
            <p className="users-guide-copy">
              {t("reportsAnnotations.help.line1")}
            </p>
            <p className="users-guide-copy">
              {t("reportsAnnotations.help.line2")}
            </p>
            <p className="users-guide-copy">
              {t("reportsAnnotations.help.line3")}
            </p>
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>
              {t("reportsAnnotations.close")}
            </button>
          </div>
        </SettingsModal>
      )}

      {contextMenu && (
        <div ref={contextMenuRef} className="context-menu" style={contextMenuStyle}>
          <button className="context-menu-item" onClick={() => { setOpenRow(contextMenu.row); setContextMenu(null); }}>{t("reportsAnnotations.openReport")}</button>
          {canDeleteReports ? (
            <button className="context-menu-item context-menu-item--danger" onClick={() => { setConfirmDelete(contextMenu.row); setContextMenu(null); }}>{t("reportsAnnotations.deleteReport")}</button>
          ) : (
            <div className="context-menu-item context-menu-item--disabled" title={t("reportsAnnotations.deleteDenied")}>{t("reportsAnnotations.deleteReport")}</div>
          )}
        </div>
      )}

      {confirmDelete && (
        <SettingsModal title={t("reportsAnnotations.deleteTitle")} onClose={() => setConfirmDelete(null)} closeDisabled={deleteLoading}>
          <div className="app-settings-modal-body">
            <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
              {t("reportsAnnotations.deleteBody", { name: confirmDelete.name })}
            </p>
            <p className="modal-warning-text">{t("reportsAnnotations.deleteWarning")}</p>
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button className="btn" onClick={() => setConfirmDelete(null)} disabled={deleteLoading}>{t("reportsAnnotations.cancel")}</button>
            <button className="btn btn--danger" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading ? t("reportsAnnotations.deleting") : t("reportsAnnotations.deleteReport")}
            </button>
          </div>
        </SettingsModal>
      )}
    </div>
  );
}

