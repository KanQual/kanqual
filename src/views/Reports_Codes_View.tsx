import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { EChartsCoreOption } from "echarts/core";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import type { Annotation, Code, Document as ProjectDocument } from "../types";
import { FilterIcon } from "../components/FilterIcon";
import { DownloadIcon, HelpIcon, RestartListIcon, SaveIcon } from "../components/AppIcons";
import { SettingsModal } from "../components/SettingsModal";
import { formatCurrentDateTime } from "../i18n/formatters";
import { useI18n } from "../i18n/provider";
import { createPostgresReport, deletePostgresReport, listPostgresReports, logPostgresReportExport } from "../lib/postgres";
import { loadPostgresReportBuilderData } from "../lib/postgresReportAdapters";
import { getFloatingTooltipStyle } from "./Postgres_Source_Coding_Shared";

const EChart = lazy(() => import("../components/EChart").then((module) => ({ default: module.EChart })));

let writeExcelFilePromise: Promise<typeof import("write-excel-file/browser")> | null = null;
let jsPdfPromise: Promise<typeof import("jspdf")> | null = null;
let docxPromise: Promise<typeof import("docx")> | null = null;

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

export type CodeReportKind = "frequencies" | "summary";
type CodeReportSortCol = "name" | "kind" | "createdByName" | "createdAt";
type SortDir = "asc" | "desc";
type RelationshipSortKey = "relationshipType" | "object1Name" | "object2Name";
type RelationshipSortDir = "asc" | "desc";

interface CaseItem {
  id: string;
  name: string;
  objectType?: string;
}

interface RelationshipItem {
  id: string;
  relationshipType?: string;
  object1Id?: string;
  object1Name?: string;
  object2Id?: string;
  object2Name?: string;
  name?: string;
}

interface UserItem {
  id: string;
  name: string;
}

interface AttributeItem {
  id: string;
  name: string;
  dataType: string;
}

interface CaseDocumentLink {
  caseId: string;
  documentId: string;
}

interface AttributeValueItem {
  id: string;
  ownerId: string;
  attributeId: string;
  value: string;
}

interface AttributeFilterConfig {
  min?: string;
  max?: string;
  selectedValues?: string[];
}

interface CodeTreeNode {
  code: Code;
  depth: number;
  hasChildren: boolean;
}

interface FrequencyColumn {
  id: string;
  label: string;
  annotationIds: Set<string>;
}

interface FrequencySection {
  key: string;
  title: string;
  columns: FrequencyColumn[];
}

interface FrequencyCodeBucket {
  id: string;
  label: string;
  color: string;
  codeIds: Set<string>;
}

interface FrozenFrequencyRow {
  section: string;
  category: string;
  values: Array<{ code: string; value: number }>;
}

interface CoOccurrenceCode {
  id: string;
  label: string;
  color: string;
}

interface CoOccurrenceCodeGroup extends CoOccurrenceCode {
  codeIds: Set<string>;
}

interface CoOccurrenceMatrix {
  id: string;
  subtitle?: string;
  diagonalEmpty?: boolean;
  codes: CoOccurrenceCode[];
  cells: number[][];
  entityCodeSets?: string[][];
  entityLabels?: string[];
  tooltipCells?: string[][][];
}

interface CoOccurrenceSingleEntityFreq {
  entityLabel: string;
  codeCounts: Array<{ code: CoOccurrenceCode; count: number }>;
}

interface CoOccurrenceSection {
  key: string;
  title: string;
  matrices: CoOccurrenceMatrix[];
  singleEntityFreq?: CoOccurrenceSingleEntityFreq;
}

interface CodeReportSettings {
  kind: CodeReportKind;
  caseIds: string[];
  documentIds: string[];
  relationshipIds?: string[];
  caseAttributeIds: string[];
  documentAttributeIds: string[];
  caseTypes?: string[];
  documentTypes?: string[];
  codeIds: string[];
  userIds: string[];
  caseAttributeFilters?: Record<string, AttributeFilterConfig>;
  documentAttributeFilters?: Record<string, AttributeFilterConfig>;
}

export interface CodeReportSnapshot {
  reportType: "code-report";
  kind: CodeReportKind;
  settings: CodeReportSettings;
  caseItems: CaseItem[];
  relationshipItems?: RelationshipItem[];
  userItems: UserItem[];
  caseAttributeItems: AttributeItem[];
  documentAttributeItems: AttributeItem[];
  documents: ProjectDocument[];
  codes: Code[];
  annotations: Annotation[];
  frozenFrequencyRows?: FrozenFrequencyRow[];
  frozenCoOccurrenceSections?: CoOccurrenceSection[];
  caseDocumentLinks: CaseDocumentLink[];
  caseAttributeValues: AttributeValueItem[];
  documentAttributeValues: AttributeValueItem[];
  description?: string;
}

export interface CodeReportRow {
  id: string;
  name: string;
  createdByName: string;
  createdAt: string;
  snapshot: CodeReportSnapshot;
}

type FrequencyViewMode = "table" | "chart" | "matrix";

function getFrequencyViewOptions(t: ReturnType<typeof useI18n>["t"]): Array<{ key: FrequencyViewMode; label: string }> {
  return [
    { key: "table", label: t("reportsCodes.frequencyViews.table") },
    { key: "chart", label: t("reportsCodes.frequencyViews.chart") },
    { key: "matrix", label: t("reportsCodes.frequencyViews.heatmap") },
  ];
}

function getCodeReportLabel(t: ReturnType<typeof useI18n>["t"], kind: CodeReportKind): string {
  return kind === "frequencies"
    ? t("reportsCodes.reportKinds.frequencies")
    : t("reportsCodes.reportKinds.summary");
}

function getCodeReportColumns(t: ReturnType<typeof useI18n>["t"]): { key: CodeReportSortCol; label: string; width: string }[] {
  return [
    { key: "name", label: t("reportsCodes.tableColumns.name"), width: "34%" },
    { key: "kind", label: t("reportsCodes.tableColumns.type"), width: "22%" },
    { key: "createdByName", label: t("reportsCodes.tableColumns.createdBy"), width: "22%" },
    { key: "createdAt", label: t("reportsCodes.tableColumns.created"), width: "22%" },
  ];
}

function getAttributeTypeLabel(t: ReturnType<typeof useI18n>["t"], dataType: string): string {
  return dataType === "datetime" ? t("reportsCodes.attributeTypes.datetime") : dataType;
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

function hasDescriptionContent(html: string | undefined): boolean {
  if (!html) return false;
  return html.replace(/<[^>]*>/g, "").trim().length > 0;
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

function buildDefaultAttributeFilter(
  attr: AttributeItem,
  stats: Map<string, { textValues: string[]; minNumber: number | null; maxNumber: number | null; minDate: number | null; maxDate: number | null }>,
): AttributeFilterConfig {
  const stat = stats.get(attr.id);
  if (attr.dataType === "number") {
    return {
      min: stat?.minNumber != null ? String(stat.minNumber) : "",
      max: stat?.maxNumber != null ? String(stat.maxNumber) : "",
    };
  }
  if (attr.dataType === "datetime") {
    return {
      min: formatDateInputValue(stat?.minDate ?? null),
      max: formatDateInputValue(stat?.maxDate ?? null),
    };
  }
  return {
    selectedValues: stat?.textValues ?? [],
  };
}

function getReportSaveErrorMessage(error: unknown): string {
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

function fmtDate(iso?: string): string {
  if (!iso) return "-";
  try {
    return formatCurrentDateTime(iso, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "-";
  }
}

function buildCodeTree(codes: Code[]): CodeTreeNode[] {
  const childrenOf: Record<string, Code[]> = {};
  const roots: Code[] = [];

  for (const code of codes) {
    if (code.parentId) {
      (childrenOf[code.parentId] ??= []).push(code);
    } else {
      roots.push(code);
    }
  }

  const sortByLabel = (items: Code[]) => {
    items.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true }));
  };

  sortByLabel(roots);
  Object.values(childrenOf).forEach(sortByLabel);

  const result: CodeTreeNode[] = [];
  function traverse(nodes: Code[], depth: number) {
    for (const node of nodes) {
      result.push({ code: node, depth, hasChildren: !!childrenOf[node.id]?.length });
      traverse(childrenOf[node.id] ?? [], depth + 1);
    }
  }

  traverse(roots, 0);

  const seen = new Set(result.map((node) => node.code.id));
  for (const code of codes) {
    if (!seen.has(code.id)) result.push({ code, depth: 0, hasChildren: false });
  }

  return result;
}

// ─── PDF export helpers ───────────────────────────────────────────────────────

function svgToPngDataUrl(svgString: string): Promise<string> {
  const wMatch = svgString.match(/width="(\d+)"/);
  const hMatch = svgString.match(/height="(\d+)"/);
  const w = wMatch ? parseInt(wMatch[1], 10) : 700;
  const h = hMatch ? parseInt(hMatch[1], 10) : 400;
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = w * 2;
    canvas.height = h * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) { reject(new Error("no canvas context")); return; }
    ctx.scale(2, 2);
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

function escXml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function trunc(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function heatmapColorStatic(value: number, max: number): string {
  if (value <= 0 || max <= 0) return "#f1f5f9";
  const t = Math.min(1, value / max);
  const r = Math.round(0xdb + (0x1e - 0xdb) * t);
  const g = Math.round(0xea + (0x40 - 0xea) * t);
  const b = Math.round(0xfe + (0xaf - 0xfe) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function safeColor(color: string, fallback = "#4f6bed"): string {
  return color && color.startsWith("#") ? color : fallback;
}

function buildFreqBarChartSvg(
  tableRows: Array<{ id: string; label: string; values: number[] }>,
  displayBuckets: Array<{ id: string; label: string; color: string }>,
  maxCell: number,
): string {
  const svgW = 700;
  const labelW = 160;
  const barAreaW = svgW - labelW - 24;
  const barH = 14;
  const barGap = 3;
  const rowGap = 10;
  const paddingTop = 30;
  const bucketCount = displayBuckets.length;
  const groupH = bucketCount * (barH + barGap) + rowGap;
  const plotH = tableRows.length * groupH;
  const legendCols = Math.min(4, bucketCount);
  const legendH = Math.ceil(bucketCount / legendCols) * 22 + 16;
  const svgH = paddingTop + plotH + legendH;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" font-family="Helvetica,Arial,sans-serif">`;
  svg += `<rect width="${svgW}" height="${svgH}" fill="white"/>`;
  svg += `<line x1="${labelW}" y1="${paddingTop - 4}" x2="${labelW}" y2="${paddingTop + plotH}" stroke="#e2e8f0" stroke-width="1"/>`;

  for (let i = 0; i < tableRows.length; i++) {
    const row = tableRows[i];
    const yGroup = paddingTop + i * groupH;
    if (i > 0) svg += `<line x1="0" y1="${yGroup}" x2="${svgW}" y2="${yGroup}" stroke="#f1f5f9" stroke-width="1"/>`;
    const midY = yGroup + (bucketCount * (barH + barGap)) / 2;
    svg += `<text x="${labelW - 7}" y="${midY + 4}" text-anchor="end" font-size="11" fill="#374151">${escXml(trunc(row.label, 22))}</text>`;

    for (let j = 0; j < displayBuckets.length; j++) {
      const bucket = displayBuckets[j];
      const value = row.values[j] ?? 0;
      const yBar = yGroup + j * (barH + barGap);
      const barW = maxCell > 0 ? Math.max(value > 0 ? 2 : 0, Math.round((value / maxCell) * barAreaW)) : 0;
      const fill = safeColor(bucket.color);
      svg += `<rect x="${labelW}" y="${yBar}" width="${barW}" height="${barH}" fill="${fill}" rx="2"/>`;
      if (value > 0) {
        svg += `<text x="${labelW + barW + 5}" y="${yBar + barH - 2}" font-size="10" fill="#374151">${value}</text>`;
      }
    }
  }

  const yLeg = paddingTop + plotH + 10;
  const legendItemW = 150;
  const legendRowCount = Math.ceil(displayBuckets.length / legendCols);
  for (let r = 0; r < legendRowCount; r++) {
    const itemsInRow = Math.min(legendCols, displayBuckets.length - r * legendCols);
    const rowStartX = Math.max(0, (svgW - itemsInRow * legendItemW) / 2);
    for (let c = 0; c < itemsInRow; c++) {
      const j = r * legendCols + c;
      const bucket = displayBuckets[j];
      const lx = rowStartX + c * legendItemW;
      const ly = yLeg + r * 22;
      svg += `<rect x="${lx}" y="${ly}" width="12" height="12" fill="${safeColor(bucket.color)}" rx="2"/>`;
      svg += `<text x="${lx + 17}" y="${ly + 10}" font-size="10" fill="#374151">${escXml(trunc(bucket.label, 24))}</text>`;
    }
  }
  svg += `</svg>`;
  return svg;
}

function buildFreqHeatmapSvg(
  matrix: Array<{ bucket: { id: string; label: string; color: string }; cells: number[] }>,
  tableRows: Array<{ id: string; label: string }>,
  maxCell: number,
): string {
  const rowLabelW = 160;
  const numCols = tableRows.length;
  const cellW = numCols > 0 ? Math.min(100, Math.max(40, Math.floor((700 - rowLabelW - 20) / numCols))) : 60;
  const cellH = 26;
  const colHeaderH = 95;
  const svgW = rowLabelW + numCols * cellW + 20;
  const svgH = colHeaderH + matrix.length * cellH + 20;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" font-family="Helvetica,Arial,sans-serif">`;
  svg += `<rect width="${svgW}" height="${svgH}" fill="white"/>`;

  // Column headers: rotate(-45) + text-anchor="start" sends text up-right from the
  // cell boundary, keeping it fully inside the header area above the cells.
  for (let j = 0; j < tableRows.length; j++) {
    const cx = rowLabelW + j * cellW + cellW / 2;
    const cy = colHeaderH;
    svg += `<text transform="rotate(-45 ${cx} ${cy})" x="${cx}" y="${cy}" font-size="10" fill="#374151" text-anchor="start">${escXml(trunc(tableRows[j].label, 16))}</text>`;
  }

  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i];
    const yRow = colHeaderH + i * cellH;
    svg += `<text x="${rowLabelW - 7}" y="${yRow + cellH / 2 + 4}" text-anchor="end" font-size="11" fill="#374151">${escXml(trunc(row.bucket.label, 22))}</text>`;
    for (let j = 0; j < row.cells.length; j++) {
      const value = row.cells[j] ?? 0;
      const xCell = rowLabelW + j * cellW;
      const bg = heatmapColorStatic(value, maxCell);
      const textFill = value / Math.max(1, maxCell) > 0.55 ? "#ffffff" : "#374151";
      svg += `<rect x="${xCell}" y="${yRow}" width="${cellW}" height="${cellH}" fill="${bg}" stroke="#e2e8f0" stroke-width="0.5"/>`;
      if (value > 0) {
        svg += `<text x="${xCell + cellW / 2}" y="${yRow + cellH / 2 + 4}" text-anchor="middle" font-size="11" fill="${textFill}">${value}</text>`;
      }
    }
  }

  svg += `</svg>`;
  return svg;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function pngBytesFromDataUrl(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ─────────────────────────────────────────────────────────────────────────────

function heatmapColor(value: number, max: number): string {
  if (value <= 0 || max <= 0) return "var(--color-surface-alt)";
  const t = Math.min(1, value / max);
  return `color-mix(in srgb, var(--color-heatmap-high) ${Math.round(t * 100)}%, var(--color-heatmap-low))`;
}

function truncateTooltipLabel(label: string, maxLength = 80): string {
  const normalized = label.trim() || "Untitled";
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
}

function buildCoOccurrenceCodeGroups(
  allCodes: Code[],
  selectedCodes: CoOccurrenceCode[],
  collapseChildren: boolean,
): CoOccurrenceCodeGroup[] {
  if (!collapseChildren) {
    return selectedCodes.map((code) => ({ ...code, codeIds: new Set([code.id]) }));
  }

  const selectedIds = new Set(selectedCodes.map((code) => code.id));
  const selectedCodeById = new Map(selectedCodes.map((code) => [code.id, code]));
  const fullCodeById = new Map(allCodes.map((code) => [code.id, code]));
  const groupById = new Map<string, CoOccurrenceCodeGroup>();

  for (const selectedCode of selectedCodes) {
    let bucketId = selectedCode.id;
    let current = fullCodeById.get(selectedCode.id);
    while (current?.parentId && selectedIds.has(current.parentId)) {
      bucketId = current.parentId;
      current = fullCodeById.get(current.parentId);
    }

    const bucketCode = selectedCodeById.get(bucketId) ?? selectedCode;
    if (!groupById.has(bucketId)) {
      groupById.set(bucketId, {
        id: bucketCode.id,
        label: bucketCode.label,
        color: bucketCode.color,
        codeIds: new Set(),
      });
    }
    groupById.get(bucketId)!.codeIds.add(selectedCode.id);
  }

  const tree = buildCodeTree(allCodes);
  const ordered = tree
    .filter((node) => groupById.has(node.code.id))
    .map((node) => groupById.get(node.code.id)!);
  for (const selectedCode of selectedCodes) {
    if (!groupById.has(selectedCode.id) || ordered.some((group) => group.id === selectedCode.id)) continue;
    ordered.push(groupById.get(selectedCode.id)!);
  }
  return ordered;
}

function aggregateCoOccurrenceCodeCounts(
  codeCounts: Array<{ code: CoOccurrenceCode; count: number }>,
  allCodes: Code[],
  collapseChildren: boolean,
): Array<{ code: CoOccurrenceCode; count: number }> {
  const groups = buildCoOccurrenceCodeGroups(allCodes, codeCounts.map((item) => item.code), collapseChildren);
  return groups.map((group) => {
    let count = 0;
    for (const item of codeCounts) {
      if (group.codeIds.has(item.code.id)) count += item.count;
    }
    return { code: { id: group.id, label: group.label, color: group.color }, count };
  });
}

function aggregateCoOccurrenceMatrix(
  matrix: CoOccurrenceMatrix,
  allCodes: Code[],
  collapseChildren: boolean,
): CoOccurrenceMatrix {
  const groups = buildCoOccurrenceCodeGroups(allCodes, matrix.codes, collapseChildren);
  if (!collapseChildren) return matrix;

  const entityCodeSets = matrix.entityCodeSets?.map((codeIds) => new Set(codeIds));
  const entityLabels = matrix.entityLabels ?? [];
  return {
    ...matrix,
    codes: groups.map((group) => ({ id: group.id, label: group.label, color: group.color })),
    cells: groups.map((rowGroup) => groups.map((colGroup) => {
      if (matrix.diagonalEmpty && rowGroup.id === colGroup.id) return 0;
      if (entityCodeSets) {
        let count = 0;
        for (const codeSet of entityCodeSets) {
          const hasRowBucket = [...rowGroup.codeIds].some((codeId) => codeSet.has(codeId));
          const hasColBucket = [...colGroup.codeIds].some((codeId) => codeSet.has(codeId));
          if (hasRowBucket && hasColBucket) count += 1;
        }
        return count;
      }
      return Math.max(
        ...[...rowGroup.codeIds].flatMap((rowCodeId) => {
          const rowIndex = matrix.codes.findIndex((code) => code.id === rowCodeId);
          return [...colGroup.codeIds].map((colCodeId) => {
            const colIndex = matrix.codes.findIndex((code) => code.id === colCodeId);
            return rowIndex >= 0 && colIndex >= 0 ? matrix.cells[rowIndex]?.[colIndex] ?? 0 : 0;
          });
        }),
        0,
      );
    })),
    tooltipCells: entityCodeSets
      ? groups.map((rowGroup) => groups.map((colGroup) => {
          if (matrix.diagonalEmpty && rowGroup.id === colGroup.id) return [];
          const labels: string[] = [];
          entityCodeSets.forEach((codeSet, index) => {
            const hasRowBucket = [...rowGroup.codeIds].some((codeId) => codeSet.has(codeId));
            const hasColBucket = [...colGroup.codeIds].some((codeId) => codeSet.has(codeId));
            if (hasRowBucket && hasColBucket) labels.push(entityLabels[index] ?? "Untitled");
          });
          return labels;
        }))
      : matrix.tooltipCells,
  };
}

function FrequencyReportCard({
  section,
  codeBuckets,
  codes,
  annotations,
  frozenRows,
}: {
  section: FrequencySection;
  codeBuckets: FrequencyCodeBucket[];
  codes: Code[];
  annotations: Annotation[];
  frozenRows?: FrozenFrequencyRow[];
}) {
  const { t } = useI18n();
  const [viewMode, setViewMode] = useState<FrequencyViewMode>("table");
  const [collapseChildCodes, setCollapseChildCodes] = useState(false);
  const frequencyViewOptions = getFrequencyViewOptions(t);
  const annotationById = useMemo(() => new Map(annotations.map((ann) => [ann.id, ann])), [annotations]);
  const canCollapseChildCodes = !frozenRows?.length && (section.key === "users" || section.key === "documents");
  const activeCodeBuckets = useMemo(() => {
    if (!canCollapseChildCodes || !collapseChildCodes) return codeBuckets;
    return buildCoOccurrenceCodeGroups(codes, codeBuckets, true).map((group) => ({
      id: group.id,
      label: group.label,
      color: group.color,
      codeIds: group.codeIds,
    }));
  }, [canCollapseChildCodes, codeBuckets, codes, collapseChildCodes]);
  const countForBucket = (column: FrequencyColumn, bucket: FrequencyCodeBucket) => {
    let value = 0;
    for (const annotationId of column.annotationIds) {
      const ann = annotationById.get(annotationId);
      if (ann && bucket.codeIds.has(ann.codeId)) value += 1;
    }
    return value;
  };
  const displayBuckets = frozenRows && frozenRows.length > 0
    ? Array.from(new Set(frozenRows.flatMap((row) => row.values.map((value) => value.code)))).map((label) => ({
        id: label,
        label,
        color: activeCodeBuckets.find((bucket) => bucket.label === label)?.color ?? "var(--color-primary)",
        codeIds: new Set<string>(),
      }))
    : activeCodeBuckets;
  const tableRows = frozenRows && frozenRows.length > 0
    ? frozenRows.map((row) => ({
        id: row.category,
        label: row.category,
        values: displayBuckets.map((bucket) => row.values.find((value) => value.code === bucket.label)?.value ?? 0),
      }))
    : section.columns.map((column) => ({
        id: column.id,
        label: column.label,
        values: displayBuckets.map((bucket) => countForBucket(column, bucket)),
      }));
  const matrix = displayBuckets.map((bucket, bucketIndex) => {
    const cells = frozenRows && frozenRows.length > 0
      ? tableRows.map((row) => row.values[bucketIndex] ?? 0)
      : section.columns.map((column) => countForBucket(column, bucket));
    return { bucket, cells };
  });
  const maxCell = Math.max(0, ...matrix.flatMap((row) => row.cells));
  const isUsersFrequencyCard = section.key === "users";
  const isSourcesFrequencyCard = section.key === "documents";
  const isFacetedFrequencyCard = isUsersFrequencyCard || isSourcesFrequencyCard;
  const chartHeight = isUsersFrequencyCard
    ? Math.max(320, tableRows.length * 18 + 290)
    : Math.max(260, displayBuckets.length * Math.max(32, tableRows.length * 14) + 82);
  const facetChartOptions = useMemo<Array<{ id: string; label: string; option: EChartsCoreOption }>>(() => {
    if (!isFacetedFrequencyCard || tableRows.length === 0 || displayBuckets.length === 0) return [];

    const axisLabels = displayBuckets.map((bucket) => bucket.label);
    return tableRows.map((row) => ({
      id: row.id,
      label: row.label,
      option: {
        animation: false,
        grid: {
          left: 44,
          right: 22,
          top: 8,
          bottom: 74,
        },
        tooltip: {
          trigger: "axis",
          axisPointer: {
            type: "shadow",
          },
          formatter: (params: any) => {
            const item = Array.isArray(params) ? params[0] : params;
            const codeName = item?.name ?? "";
            const value = Number(item?.value ?? 0);
            return `${escapeHtml(String(codeName))}: ${value}`;
          },
        },
        xAxis: {
          type: "category",
          data: axisLabels,
          axisLabel: {
            color: "#687385",
            fontSize: 10,
            interval: 0,
            rotate: 35,
            overflow: "truncate",
            width: 82,
          },
          axisLine: {
            lineStyle: { color: "#d5dbe3" },
          },
          axisTick: {
            show: false,
          },
        },
        yAxis: {
          type: "value",
          minInterval: 1,
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
        series: [
          {
            name: row.label,
            type: "bar",
            barMaxWidth: 18,
            data: displayBuckets.map((bucket, bucketIndex) => ({
              name: bucket.label,
              value: row.values[bucketIndex] ?? 0,
              itemStyle: {
                color: bucket.color,
                borderRadius: [5, 5, 0, 0],
              },
            })),
          },
        ],
      },
    }));
  }, [displayBuckets, isFacetedFrequencyCard, tableRows]);
  const frequencyBarChartOption = useMemo<EChartsCoreOption>(() => {
    if (tableRows.length === 0 || displayBuckets.length === 0) return {};

    const axisLabels = displayBuckets.map((bucket) => bucket.label);
    return {
      animation: false,
      color: tableRows.map((_row, index) => {
        const palette = ["#B04A33", "#4F6F8F", "#6F7D52", "#9A6A3A", "#7B5CA7", "#3F7D7A", "#B85C7A", "#687385"];
        return palette[index % palette.length];
      }),
      grid: {
        left: 128,
        right: 42,
        top: 24,
        bottom: 28,
      },
      legend: {
        type: "scroll",
        top: 0,
        textStyle: {
          color: "#687385",
          fontSize: 11,
        },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "shadow",
        },
      },
      xAxis: {
        type: "value",
        minInterval: 1,
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
        data: axisLabels,
        inverse: true,
        axisLabel: {
          color: "#687385",
          fontSize: 10,
          overflow: "truncate",
          width: 116,
        },
        axisLine: {
          lineStyle: { color: "#d5dbe3" },
        },
        axisTick: {
          show: false,
        },
      },
      series: tableRows.map((row) => ({
        name: row.label,
        type: "bar",
        barMaxWidth: 12,
        data: displayBuckets.map((bucket, bucketIndex) => ({
          name: bucket.label,
          value: row.values[bucketIndex] ?? 0,
          itemStyle: {
            borderRadius: [0, 5, 5, 0],
          },
        })),
      })),
    };
  }, [displayBuckets, tableRows]);

  return (
    <div className="annotate-card" style={{ flexShrink: 0 }}>
      <div className="annotate-card-header">
        <span className="annotate-card-title">{section.title}</span>
        {canCollapseChildCodes && (
          <label
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 500,
              color: "var(--color-text-muted)",
            }}
          >
            <input
              type="checkbox"
              className="memo-sel-checkbox"
              checked={collapseChildCodes}
              onChange={(event) => setCollapseChildCodes(event.target.checked)}
            />
            {t("reportsCodes.collapseChildCodes")}
          </label>
        )}
      </div>
      <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="segmented-control" role="tablist" aria-label={section.title} style={{ alignSelf: "center" }}>
          {frequencyViewOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={viewMode === option.key}
              className={`segmented-control-option${viewMode === option.key ? " segmented-control-option--active" : ""}`}
              onClick={() => setViewMode(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {viewMode === "table" && (
          <div className="users-table-wrap" style={{ margin: 0, maxWidth: "none", borderRadius: 6, maxHeight: 230 }}>
            <table className="users-table">
              <thead>
                <tr>
                  <th className="users-th" style={{ minWidth: 150 }}>{section.title}</th>
                  {displayBuckets.map((bucket) => (
                    <th key={bucket.id} className="users-th" style={{ minWidth: 110 }}>{bucket.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.length === 0 || displayBuckets.length === 0 ? (
                  <tr><td colSpan={displayBuckets.length + 1} className="users-td-msg">{t("reportsCodes.noSelectedItems")}</td></tr>
                ) : tableRows.map((row) => (
                  <tr key={row.id} className="users-row">
                    <td className="users-td users-td--name">{row.label}</td>
                    {row.values.map((value, index) => (
                      <td key={`${row.id}-${displayBuckets[index].id}`} className="users-td">{value}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {viewMode === "chart" && (
          tableRows.length === 0 || displayBuckets.length === 0 ? (
            <div className="users-td-msg">{t("reportsCodes.noSelectedItems")}</div>
          ) : (
            <Suspense fallback={<div className="users-td-msg">{t("reportsCodes.loadingChart")}</div>}>
              {isFacetedFrequencyCard ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {facetChartOptions.map((facet) => (
                    <div
                      key={facet.id}
                      style={{
                        border: "var(--border-width) solid var(--color-border)",
                        borderRadius: 6,
                        background: "var(--color-surface)",
                        padding: "10px 12px 8px",
                      }}
                    >
                      <div
                        style={{
                          marginBottom: 6,
                          color: "var(--color-text)",
                          fontSize: 12,
                          fontWeight: 700,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={facet.label}
                      >
                        {facet.label}
                      </div>
                      <EChart
                        option={facet.option}
                        style={{
                          width: "100%",
                          height: 220,
                        }}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <EChart
                  option={frequencyBarChartOption}
                  style={{
                    width: "100%",
                    height: chartHeight,
                    minHeight: 260,
                  }}
                />
              )}
            </Suspense>
          )
        )}

        {viewMode === "matrix" && (
          <div className="users-table-wrap" style={{ margin: 0, maxWidth: "none", borderRadius: 6, maxHeight: 280 }}>
            <table className="users-table">
              <thead>
                <tr>
                  <th className="users-th" style={{ minWidth: 160 }}>{t("reportsCodes.singleEntity.code")}</th>
                  {tableRows.map((row) => (
                    <th
                      key={row.id}
                      className="users-th"
                      style={{
                        minWidth: isSourcesFrequencyCard ? 88 : 110,
                        maxWidth: isSourcesFrequencyCard ? 88 : undefined,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={row.label}
                    >
                      {isSourcesFrequencyCard ? truncateTooltipLabel(row.label, 18) : row.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.length === 0 ? (
                  <tr><td colSpan={tableRows.length + 1} className="users-td-msg">{t("reportsCodes.selectCodesToBuildMatrix")}</td></tr>
                ) : matrix.map((row) => (
                  <tr key={row.bucket.id} className="users-row">
                    <td className="users-td users-td--name">
                      <span className="code-swatch" style={{ background: row.bucket.color, marginRight: 8 }} />
                      {row.bucket.label}
                    </td>
                    {row.cells.map((value, index) => (
                      <td
                        key={`${row.bucket.id}-${tableRows[index].id}`}
                        className="users-td"
                        style={{
                          background: heatmapColor(value, maxCell),
                          color: value > 0 ? "var(--color-text)" : "var(--color-text-muted)",
                          textAlign: "center",
                        }}
                      >
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function CoOccurrenceMatrixCard({ section, codes }: { section: CoOccurrenceSection; codes: Code[] }) {
  const { t } = useI18n();
  const [collapseChildCodes, setCollapseChildCodes] = useState(false);
  const [cellTooltip, setCellTooltip] = useState<{
    x: number;
    y: number;
    rowColor: string;
    colColor: string;
    rowLabel: string;
    colLabel: string;
    value: number;
    contributors: string[];
  } | null>(null);
  const sectionTitle = section.key === "users"
    ? "Frequencies"
    : section.key === "documents"
      ? "Co-occurence per Source"
      : section.title;
  const canCollapseChildCodes = section.key === "users" || section.key === "documents";

  if (section.singleEntityFreq) {
    const { entityLabel, codeCounts } = section.singleEntityFreq;
    const displayCodeCounts = canCollapseChildCodes
      ? aggregateCoOccurrenceCodeCounts(codeCounts, codes, collapseChildCodes)
      : codeCounts;
    return (
      <div className="annotate-card" style={{ flexShrink: 0 }}>
        <div className="annotate-card-header">
          <span className="annotate-card-title">{sectionTitle}</span>
          {canCollapseChildCodes && (
            <label
              style={{
                marginLeft: "auto",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                fontWeight: 500,
                color: "var(--color-text-muted)",
              }}
            >
              <input
                type="checkbox"
                className="memo-sel-checkbox"
                checked={collapseChildCodes}
                onChange={(event) => setCollapseChildCodes(event.target.checked)}
              />
              {t("reportsCodes.collapseChildCodes")}
            </label>
          )}
        </div>
        <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            {t("reportsCodes.singleEntity.oneItemSelected", { name: entityLabel })}
          </div>
          <div className="users-table-wrap" style={{ margin: 0, maxWidth: "none", borderRadius: 6, maxHeight: 300 }}>
            <table className="users-table">
              <thead>
                <tr>
                  <th className="users-th" style={{ minWidth: 160 }}>{t("reportsCodes.singleEntity.code")}</th>
                  <th className="users-th" style={{ minWidth: 100 }}>{t("reportsCodes.singleEntity.annotations")}</th>
                </tr>
              </thead>
              <tbody>
                {displayCodeCounts.length === 0 ? (
                  <tr><td colSpan={2} className="users-td-msg">{t("reportsCodes.singleEntity.selectCodes")}</td></tr>
                ) : displayCodeCounts.map(({ code, count }) => (
                  <tr key={code.id} className="users-row">
                    <td className="users-td users-td--name">
                      <span className="code-swatch" style={{ background: code.color, marginRight: 8 }} />
                      {code.label}
                    </td>
                    <td className="users-td">{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="annotate-card" style={{ flexShrink: 0 }}>
      <div className="annotate-card-header">
        <span className="annotate-card-title">{sectionTitle}</span>
        {canCollapseChildCodes && (
          <label
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 500,
              color: "var(--color-text-muted)",
            }}
          >
            <input
              type="checkbox"
              className="memo-sel-checkbox"
              checked={collapseChildCodes}
              onChange={(event) => {
                setCellTooltip(null);
                setCollapseChildCodes(event.target.checked);
              }}
            />
            {t("reportsCodes.collapseChildCodes")}
          </label>
        )}
      </div>
      <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 16 }}>
        {section.matrices.length === 0 ? (
          <div className="users-td-msg">{t("reportsCodes.selectCodesToBuildMatrix")}</div>
        ) : section.matrices.map((sourceMatrix) => {
          const matrix = canCollapseChildCodes
            ? aggregateCoOccurrenceMatrix(sourceMatrix, codes, collapseChildCodes)
            : sourceMatrix;
          const maxCell = Math.max(0, ...matrix.cells.flatMap((row, rowIndex) => (
            row.filter((_value, colIndex) => !(matrix.diagonalEmpty && rowIndex === colIndex))
          )));

          return (
            <div key={matrix.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {matrix.subtitle && (
                <div style={{ fontSize: 12, fontStyle: "italic", color: "var(--color-text-muted)" }}>
                  {matrix.subtitle}
                </div>
              )}
              <div className="users-table-wrap" style={{ margin: 0, maxWidth: "none", borderRadius: 6, maxHeight: 300 }}>
                <table className="users-table">
                  <thead>
                    <tr>
                      <th className="users-th" style={{ minWidth: 150 }}>{t("reportsCodes.singleEntity.code")}</th>
                      {matrix.codes.map((code) => (
                        <th key={code.id} className="users-th" style={{ minWidth: 110 }}>{code.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.codes.length === 0 ? (
                      <tr><td colSpan={matrix.codes.length + 1} className="users-td-msg">{t("reportsCodes.selectCodesToBuildMatrix")}</td></tr>
                    ) : matrix.codes.map((rowCode, rowIndex) => (
                      <tr key={rowCode.id} className="users-row">
                        <td className="users-td users-td--name">
                          <span className="code-swatch" style={{ background: rowCode.color, marginRight: 8 }} />
                          {rowCode.label}
                        </td>
                        {matrix.codes.map((colCode, colIndex) => {
                          const isDiagonal = rowIndex === colIndex;
                          const value = matrix.cells[rowIndex]?.[colIndex] ?? 0;
                          const emptyCell = matrix.diagonalEmpty && isDiagonal;
                          const contributors = matrix.tooltipCells?.[rowIndex]?.[colIndex] ?? [];
                          return (
                            <td
                              key={`${rowCode.id}-${colCode.id}`}
                              className="users-td"
                              onMouseEnter={(event) => {
                                if (emptyCell) return;
                                setCellTooltip({
                                  x: event.clientX,
                                  y: event.clientY,
                                  rowColor: rowCode.color,
                                  colColor: colCode.color,
                                  rowLabel: rowCode.label,
                                  colLabel: colCode.label,
                                  value,
                                  contributors,
                                });
                              }}
                              onMouseMove={(event) => {
                                if (emptyCell) return;
                                setCellTooltip((current) => current ? { ...current, x: event.clientX, y: event.clientY } : current);
                              }}
                              onMouseLeave={() => setCellTooltip(null)}
                              style={{
                                background: emptyCell ? "var(--color-surface-muted, #f4f4f5)" : heatmapColor(value, maxCell),
                                color: value > 0 && !emptyCell ? "var(--color-text)" : "var(--color-text-muted)",
                                textAlign: "center",
                                cursor: emptyCell ? "default" : "help",
                              }}
                            >
                              {emptyCell ? "" : value}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
      {cellTooltip && (
        <div
          className="annotation-hover-tooltip"
          style={getFloatingTooltipStyle(
            cellTooltip.x,
            cellTooltip.y,
            340,
            Math.min(420, 64 + Math.max(1, Math.min(cellTooltip.contributors.length, 20)) * 74),
          )}
        >
          {cellTooltip.contributors.length === 0 ? (
            <div className="annotation-hover-tooltip-section">
              <div className="annotation-hover-tooltip-code">
                <span className="annotation-hover-tooltip-swatch" style={{ background: cellTooltip.rowColor }} />
                {cellTooltip.rowLabel}
                <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>x</span>
                <span className="annotation-hover-tooltip-swatch" style={{ background: cellTooltip.colColor }} />
                {cellTooltip.colLabel}: {cellTooltip.value}
              </div>
                <div className="annotation-hover-tooltip-quote">{t("reportsCodes.noMatchingSources")}</div>
            </div>
          ) : (
            <>
              {cellTooltip.contributors.slice(0, 20).map((contributor, index) => (
                <div key={`${contributor}-${index}`} className="annotation-hover-tooltip-section">
                  <div className="annotation-hover-tooltip-code">
                    <span className="annotation-hover-tooltip-swatch" style={{ background: cellTooltip.rowColor }} />
                    {cellTooltip.rowLabel}
                    <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>x</span>
                    <span className="annotation-hover-tooltip-swatch" style={{ background: cellTooltip.colColor }} />
                    {cellTooltip.colLabel}: {cellTooltip.value}
                  </div>
                  <div className="annotation-hover-tooltip-quote">{truncateTooltipLabel(contributor)}</div>
                </div>
              ))}
              {cellTooltip.contributors.length > 20 && (
                <div className="annotation-hover-tooltip-section">
                  <div className="annotation-hover-tooltip-code">
                    <span className="annotation-hover-tooltip-swatch" style={{ background: cellTooltip.rowColor }} />
                    {cellTooltip.rowLabel}
                    <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>x</span>
                    <span className="annotation-hover-tooltip-swatch" style={{ background: cellTooltip.colColor }} />
                    {cellTooltip.colLabel}: {cellTooltip.value}
                  </div>
                  <div className="annotation-hover-tooltip-quote">+{cellTooltip.contributors.length - 20} more</div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

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
      description: t("reportsCodes.exportWorkbookDescription"),
      onClick: onExportXLSX,
    },
  ] as const;

  return (
    <SettingsModal title={t("reportsCodes.exportTitle")} onClose={onClose} closeDisabled={!!exportingFormat} modalClassName="modal--wide">
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
                {exportingFormat === option.key ? t("reportsCodes.exporting") : t("reportsCodes.exportAs", { format: option.label })}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
        <button className="btn" onClick={onClose} disabled={!!exportingFormat}>{t("reportsCodes.cancel")}</button>
      </div>
    </SettingsModal>
  );
}

function NewCodeReportModal({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (kind: CodeReportKind) => void;
}) {
  const { t } = useI18n();
  const options = [
    {
      key: "frequencies",
      label: t("reportsCodes.newModal.frequenciesLabel"),
      description: t("reportsCodes.newModal.frequenciesDescription"),
      onClick: () => onSelect("frequencies"),
    },
    {
      key: "summary",
      label: t("reportsCodes.newModal.summaryLabel"),
      description: t("reportsCodes.newModal.summaryDescription"),
      onClick: () => onSelect("summary"),
    },
  ] as const;

  return (
    <SettingsModal title={t("reportsCodes.newModal.title")} onClose={onClose} modalClassName="modal--wide">
      <div className="app-settings-modal-body">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 12,
            alignItems: "stretch",
          }}
        >
          {options.map((option) => (
            <button
              key={option.key}
              className="btn export-option-card"
              onClick={option.onClick}
              style={{
                minHeight: 220,
                padding: 18,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "space-between",
                textAlign: "center",
                whiteSpace: "normal",
                color: "var(--color-text)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>{option.label}</div>
                <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--color-text-muted)" }}>
                  {option.description}
                </div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {option.label}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
        <button className="btn" onClick={onClose}>{t("reportsCodes.cancel")}</button>
      </div>
    </SettingsModal>
  );
}

function CodeReportCreationPage({
  kind,
  row,
  initialSettings,
  postgresProjectId,
  hideBackButton,
  onBack,
  onSaved,
  onUseSettings,
}: {
  kind: CodeReportKind;
  row?: CodeReportRow;
  initialSettings?: CodeReportSettings;
  postgresProjectId?: string;
  hideBackButton?: boolean;
  onBack: () => void;
  onSaved?: (row: CodeReportRow) => void;
  onUseSettings?: (settings: CodeReportSettings) => void;
}) {
  const { t } = useI18n();
  const isFrozen = !!row;
  const canStartReports = true;
  const canExportReports = true;
  const frozenSnapshot = row?.snapshot;
  const activeSettings = frozenSnapshot?.settings ?? initialSettings;
  const reportKind = frozenSnapshot?.kind ?? kind;

  const [name, setName] = useState(row?.name ?? "");
  const [caseItems, setCaseItems] = useState<CaseItem[]>(frozenSnapshot?.caseItems ?? []);
  const [relationshipItems, setRelationshipItems] = useState<RelationshipItem[]>(frozenSnapshot?.relationshipItems ?? []);
  const [userItems, setUserItems] = useState<UserItem[]>(frozenSnapshot?.userItems ?? []);
  const [caseAttributeItems, setCaseAttributeItems] = useState<AttributeItem[]>(frozenSnapshot?.caseAttributeItems ?? []);
  const [documentAttributeItems, setDocumentAttributeItems] = useState<AttributeItem[]>(frozenSnapshot?.documentAttributeItems ?? []);
  const [allAnnotations, setAllAnnotations] = useState<Annotation[]>(frozenSnapshot?.annotations ?? []);
  const [caseDocumentLinks, setCaseDocumentLinks] = useState<CaseDocumentLink[]>(frozenSnapshot?.caseDocumentLinks ?? []);
  const [caseAttributeValues, setCaseAttributeValues] = useState<AttributeValueItem[]>(frozenSnapshot?.caseAttributeValues ?? []);
  const [documentAttributeValues, setDocumentAttributeValues] = useState<AttributeValueItem[]>(frozenSnapshot?.documentAttributeValues ?? []);
  const [postgresDocuments, setPostgresDocuments] = useState<ProjectDocument[] | null>(null);
  const [postgresCodes, setPostgresCodes] = useState<Code[] | null>(null);
  const [loadingFilters, setLoadingFilters] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDescription, setShowDescription] = useState(() => hasDescriptionContent(frozenSnapshot?.description));
  const [saving, setSaving] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<string | null>(null);

  const [selCaseIds, setSelCaseIds] = useState<Set<string>>(() => new Set(activeSettings?.caseIds ?? []));
  const [selDocIds, setSelDocIds] = useState<Set<string>>(() => new Set(activeSettings?.documentIds ?? []));
  const [selRelationshipIds, setSelRelationshipIds] = useState<Set<string>>(() => new Set(activeSettings?.relationshipIds ?? []));
  const [selCaseAttrIds, setSelCaseAttrIds] = useState<Set<string>>(() => new Set(activeSettings?.caseAttributeIds ?? []));
  const [selDocAttrIds, setSelDocAttrIds] = useState<Set<string>>(() => new Set(activeSettings?.documentAttributeIds ?? []));
  const [selCaseTypes, setSelCaseTypes] = useState<Set<string>>(() => new Set(activeSettings?.caseTypes ?? []));
  const [selDocTypes, setSelDocTypes] = useState<Set<string>>(() => new Set(activeSettings?.documentTypes ?? []));
  const [selCodeIds, setSelCodeIds] = useState<Set<string>>(() => new Set(activeSettings?.codeIds ?? []));
  const [selUserIds, setSelUserIds] = useState<Set<string>>(() => new Set(activeSettings?.userIds ?? []));
  const [caseAttributeFilters, setCaseAttributeFilters] = useState<Record<string, AttributeFilterConfig>>(() => activeSettings?.caseAttributeFilters ?? {});
  const [documentAttributeFilters, setDocumentAttributeFilters] = useState<Record<string, AttributeFilterConfig>>(() => activeSettings?.documentAttributeFilters ?? {});
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(["cases", "documents", "relationships", "users"]));
  const [expandedSummaryCards, setExpandedSummaryCards] = useState<Set<string>>(new Set());
  const [showCaseAttributeFilters, setShowCaseAttributeFilters] = useState(false);
  const [showDocumentAttributeFilters, setShowDocumentAttributeFilters] = useState(false);
  const [relationshipSortKey, setRelationshipSortKey] = useState<RelationshipSortKey>("relationshipType");
  const [relationshipSortDir, setRelationshipSortDir] = useState<RelationshipSortDir>("asc");
  const descriptionEditor = useEditor({
    extensions: [StarterKit],
    editorProps: { attributes: { class: "report-description-editor" } },
    editable: !isFrozen,
    content: frozenSnapshot?.description ?? "",
  });
  const documents = frozenSnapshot?.documents ?? postgresDocuments ?? [];
  const codes = frozenSnapshot?.codes ?? postgresCodes ?? [];

  const caseTypeOptions = useMemo(() => {
    const values = new Set(caseItems.map((item) => formatObjectType(item.objectType)));
    return [...values].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
  }, [caseItems]);

  const documentTypeOptions = useMemo(() => {
    const values = new Set(documents.map((doc) => formatSourceType(doc.type)));
    return [...values].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
  }, [documents]);

  useEffect(() => {
    if (isFrozen || loadingFilters || selCaseTypes.size > 0 || caseTypeOptions.length === 0) return;
    setSelCaseTypes(new Set(caseTypeOptions));
  }, [caseTypeOptions, isFrozen, loadingFilters, selCaseTypes.size]);

  useEffect(() => {
    if (isFrozen || loadingFilters || selDocTypes.size > 0 || documentTypeOptions.length === 0) return;
    setSelDocTypes(new Set(documentTypeOptions));
  }, [documentTypeOptions, isFrozen, loadingFilters, selDocTypes.size]);

  useEffect(() => {
    if (isFrozen || !postgresProjectId) return;
    let cancelled = false;

    async function loadPostgresData() {
      setLoadingFilters(true);
      setError(null);
      try {
        const data = await loadPostgresReportBuilderData(postgresProjectId!);
        if (cancelled) return;
        setCaseItems(data.cases);
        setRelationshipItems(data.relationships);
        setUserItems(data.users);
        setCaseAttributeItems(data.caseAttributeItems);
        setDocumentAttributeItems(data.documentAttributeItems);
        setAllAnnotations(data.annotations);
        setCaseDocumentLinks(data.caseDocumentLinks);
        setCaseAttributeValues(data.caseAttributeValues);
        setDocumentAttributeValues(data.documentAttributeValues);
        setPostgresDocuments(data.documents);
        setPostgresCodes(data.codes);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load report data.");
      } finally {
        if (!cancelled) setLoadingFilters(false);
      }
    }

    void loadPostgresData();
    return () => {
      cancelled = true;
    };
  }, [isFrozen, postgresProjectId]);

  const reportLabel = getCodeReportLabel(t, reportKind);
  const createdBy = row?.createdByName || "-";
  const visibleRelationships = selRelationshipIds.size;
  const visibleCodes = selCodeIds.size;
  const visibleUsers = selUserIds.size;
  const visibleCaseAttrs = selCaseAttrIds.size;
  const visibleDocAttrs = selDocAttrIds.size;
  const selectedCodeLabels = useMemo(() => {
    if (selCodeIds.size === 0) return t("reportsCodes.noCodesSelected");
    const tree = buildCodeTree(codes);
    const labels = tree
      .filter((node) => selCodeIds.has(node.code.id))
      .map((node) => node.code.label);
    return labels.length > 0 ? labels.join(", ") : t("reportsCodes.noCodesSelected");
  }, [codes, selCodeIds, t]);

  const codeBuckets = useMemo(() => {
    if (selCodeIds.size === 0) return [] as FrequencyCodeBucket[];
    const tree = buildCodeTree(codes);
    return tree
      .filter((node) => selCodeIds.has(node.code.id))
      .map((node) => ({
        id: node.code.id,
        label: node.code.label,
        color: node.code.color,
        codeIds: new Set([node.code.id]),
      }));
  }, [codes, selCodeIds]);

  const selectedCoOccurrenceCodes = useMemo(() => buildCodeTree(codes)
    .filter((node) => selCodeIds.has(node.code.id))
    .map((node) => ({
      id: node.code.id,
      label: node.code.label,
      color: node.code.color,
    })), [codes, selCodeIds]);

  const caseDocumentMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const link of caseDocumentLinks) {
      if (!map.has(link.caseId)) map.set(link.caseId, new Set());
      map.get(link.caseId)!.add(link.documentId);
    }
    return map;
  }, [caseDocumentLinks]);

  const documentCaseMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const link of caseDocumentLinks) {
      if (!map.has(link.documentId)) map.set(link.documentId, new Set());
      map.get(link.documentId)!.add(link.caseId);
    }
    return map;
  }, [caseDocumentLinks]);

  const annotationsByUser = useMemo(() => {
    const map = new Map<string, Annotation[]>();
    for (const ann of allAnnotations) {
      if (!map.has(ann.createdById)) map.set(ann.createdById, []);
      map.get(ann.createdById)!.push(ann);
    }
    return map;
  }, [allAnnotations]);

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
    for (const doc of documents) {
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
  }, [selDocAttrIds, documents, documentAttributeMap, documentAttributeItems, documentAttributeFilters, documentAttributeValueStats]);

  const caseIdsMatchingSelectedTypes = useMemo(() => {
    if (caseTypeOptions.length === 0 || selCaseTypes.size === caseTypeOptions.length) return null;
    return new Set(caseItems.filter((item) => selCaseTypes.has(formatObjectType(item.objectType))).map((item) => item.id));
  }, [caseItems, caseTypeOptions.length, selCaseTypes]);

  const docIdsMatchingSelectedTypes = useMemo(() => {
    if (documentTypeOptions.length === 0 || selDocTypes.size === documentTypeOptions.length) return null;
    return new Set(documents.filter((doc) => selDocTypes.has(formatSourceType(doc.type))).map((doc) => doc.id));
  }, [documentTypeOptions.length, documents, selDocTypes]);

  const filteredSelectedCaseIds = useMemo(() => {
    return new Set([...selCaseIds].filter((caseId) => {
      if (caseIdsMatchingSelectedTypes && !caseIdsMatchingSelectedTypes.has(caseId)) return false;
      if (caseIdsMatchingSelectedAttributes && !caseIdsMatchingSelectedAttributes.has(caseId)) return false;
      return true;
    }));
  }, [selCaseIds, caseIdsMatchingSelectedTypes, caseIdsMatchingSelectedAttributes]);

  const filteredSelectedDocIds = useMemo(() => {
    let next = new Set(selDocIds);
    if (docIdsMatchingSelectedTypes) {
      next = new Set([...next].filter((docId) => docIdsMatchingSelectedTypes.has(docId)));
    }
    if (docIdsMatchingSelectedAttributes) {
      next = new Set([...next].filter((docId) => docIdsMatchingSelectedAttributes.has(docId)));
    }
    if (filteredSelectedCaseIds.size > 0) {
      const allowedByCases = new Set<string>();
      for (const caseId of filteredSelectedCaseIds) {
        for (const docId of caseDocumentMap.get(caseId) ?? []) {
          allowedByCases.add(docId);
        }
      }
      next = new Set(
        [...next].filter((docId) => allowedByCases.has(docId) || (documentCaseMap.get(docId)?.size ?? 0) === 0),
      );
    }
    return next;
  }, [selDocIds, docIdsMatchingSelectedTypes, docIdsMatchingSelectedAttributes, filteredSelectedCaseIds, caseDocumentMap, documentCaseMap]);

  const selectedAnnotations = useMemo(
    () => allAnnotations.filter((ann) =>
      selCodeIds.has(ann.codeId) &&
      selUserIds.has(ann.createdById) &&
      filteredSelectedDocIds.has(ann.documentId)
    ),
    [allAnnotations, selCodeIds, selUserIds, filteredSelectedDocIds],
  );
  const visibleCases = filteredSelectedCaseIds.size;
  const visibleDocs = filteredSelectedDocIds.size;

  const annotationsByDocument = useMemo(() => {
    const map = new Map<string, Annotation[]>();
    for (const ann of selectedAnnotations) {
      if (!map.has(ann.documentId)) map.set(ann.documentId, []);
      map.get(ann.documentId)!.push(ann);
    }
    return map;
  }, [selectedAnnotations]);

  const caseFilterDetails = useMemo(
    () => describeAttributeFilters(caseAttributeItems, selCaseAttrIds, caseAttributeFilters, caseAttributeValueStats),
    [caseAttributeItems, selCaseAttrIds, caseAttributeFilters, caseAttributeValueStats],
  );

  const documentFilterDetails = useMemo(
    () => describeAttributeFilters(documentAttributeItems, selDocAttrIds, documentAttributeFilters, documentAttributeValueStats),
    [documentAttributeItems, selDocAttrIds, documentAttributeFilters, documentAttributeValueStats],
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

  const relationshipColumnValue = (relationship: RelationshipItem, key: RelationshipSortKey) => {
    if (key === "relationshipType") return relationship.relationshipType || relationship.name || "Relationship";
    if (key === "object1Name") return relationship.object1Name || "Unknown object";
    return relationship.object2Name || "Unknown object";
  };

  const sortedRelationshipItems = useMemo(() => {
    return [...relationshipItems].sort((a, b) => {
      const cmp = relationshipColumnValue(a, relationshipSortKey).localeCompare(
        relationshipColumnValue(b, relationshipSortKey),
        undefined,
        { sensitivity: "base", numeric: true },
      );
      return relationshipSortDir === "asc" ? cmp : -cmp;
    });
  }, [relationshipItems, relationshipSortDir, relationshipSortKey]);

  function toggleRelationshipSort(key: RelationshipSortKey) {
    if (relationshipSortKey === key) {
      setRelationshipSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setRelationshipSortKey(key);
    setRelationshipSortDir("asc");
  }

  const coOccurrenceSections = useMemo(() => {
    if (isFrozen && frozenSnapshot?.frozenCoOccurrenceSections) {
      return frozenSnapshot.frozenCoOccurrenceSections;
    }

    const codesForMatrix = selectedCoOccurrenceCodes;
    const makeCodeSet = (annotations: Annotation[]) => {
      const set = new Set<string>();
      for (const ann of annotations) {
        if (selCodeIds.has(ann.codeId)) set.add(ann.codeId);
      }
      return set;
    };
    const buildMatrix = (
      id: string,
      entityCodeSets: Set<string>[],
      entityLabels: string[],
      subtitle?: string,
      diagonalEmpty = false,
    ): CoOccurrenceMatrix => ({
      id,
      subtitle,
      diagonalEmpty,
      codes: codesForMatrix,
      entityCodeSets: entityCodeSets.map((codeSet) => [...codeSet]),
      entityLabels,
      tooltipCells: codesForMatrix.map((rowCode, rowIndex) => codesForMatrix.map((colCode, colIndex) => {
        if (diagonalEmpty && rowIndex === colIndex) return [];
        const labels: string[] = [];
        entityCodeSets.forEach((codeSet, index) => {
          if (codeSet.has(rowCode.id) && codeSet.has(colCode.id)) labels.push(entityLabels[index] ?? "Untitled");
        });
        return labels;
      })),
      cells: codesForMatrix.map((rowCode, rowIndex) => codesForMatrix.map((colCode, colIndex) => {
        if (diagonalEmpty && rowIndex === colIndex) return 0;
        let count = 0;
        for (const codeSet of entityCodeSets) {
          if (codeSet.has(rowCode.id) && codeSet.has(colCode.id)) count += 1;
        }
        return count;
      })),
    });
      const normalizeValue = (value: string) => value.trim() || t("reportsCodes.exportSections.noValue");
    const countPerCode = (anns: Annotation[]) =>
      codesForMatrix.map((code) => ({ code, count: anns.filter((a) => a.codeId === code.id).length }));
    const sections: CoOccurrenceSection[] = [];

    if (selUserIds.size === 1) {
      const [userId] = [...selUserIds];
      const user = userItems.find((u) => u.id === userId);
      const anns = selectedAnnotations.filter((a) => a.createdById === userId && selCodeIds.has(a.codeId));
      sections.push({
        key: "users",
        title: "Frequencies",
        matrices: [],
        singleEntityFreq: { entityLabel: user?.name || t("reportsCodes.exportSections.unknown"), codeCounts: countPerCode(anns) },
      });
    } else if (selUserIds.size > 1) {
      const selectedUsers = userItems.filter((item) => selUserIds.has(item.id));
      const entityCodeSets = selectedUsers
        .map((item) => makeCodeSet(selectedAnnotations.filter((ann) => ann.createdById === item.id)));
      const entityLabels = selectedUsers.map((item) => item.name);
      sections.push({ key: "users", title: "Frequencies", matrices: [buildMatrix("users", entityCodeSets, entityLabels)] });
    }

    if (filteredSelectedCaseIds.size === 1) {
      const [caseId] = [...filteredSelectedCaseIds];
      const caseItem = caseItems.find((c) => c.id === caseId);
      const anns: Annotation[] = [];
      for (const docId of caseDocumentMap.get(caseId) ?? []) {
        if (filteredSelectedDocIds.has(docId)) anns.push(...(annotationsByDocument.get(docId) ?? []));
      }
      const filtered = anns.filter((a) => selCodeIds.has(a.codeId));
      sections.push({
        key: "cases",
        title: "Objects",
        matrices: [],
        singleEntityFreq: { entityLabel: caseItem?.name || t("reportsCodes.exportSections.unknown"), codeCounts: countPerCode(filtered) },
      });
    } else if (filteredSelectedCaseIds.size > 1) {
      const selectedCases = caseItems.filter((item) => filteredSelectedCaseIds.has(item.id));
      const entityCodeSets = selectedCases
        .map((item) => {
          const annotations: Annotation[] = [];
          for (const docId of caseDocumentMap.get(item.id) ?? []) {
            if (!filteredSelectedDocIds.has(docId)) continue;
            annotations.push(...(annotationsByDocument.get(docId) ?? []));
          }
          return makeCodeSet(annotations);
        });
      const entityLabels = selectedCases.map((item) => item.name);
      sections.push({ key: "cases", title: "Objects", matrices: [buildMatrix("cases", entityCodeSets, entityLabels)] });
    }

    if (filteredSelectedDocIds.size === 1) {
      const [docId] = [...filteredSelectedDocIds];
      const doc = documents.find((d) => d.id === docId);
      const anns = (annotationsByDocument.get(docId) ?? []).filter((a) => selCodeIds.has(a.codeId));
      sections.push({
        key: "documents",
        title: "Co-occurence per Source",
        matrices: [],
        singleEntityFreq: { entityLabel: doc?.name || t("reportsCodes.exportSections.unknown"), codeCounts: countPerCode(anns) },
      });
    } else if (filteredSelectedDocIds.size > 1) {
      const selectedDocuments = documents.filter((item) => filteredSelectedDocIds.has(item.id));
      const entityCodeSets = selectedDocuments.map((item) => makeCodeSet(annotationsByDocument.get(item.id) ?? []));
      const entityLabels = selectedDocuments.map((item) => item.name);
      sections.push({ key: "documents", title: "Co-occurence per Source", matrices: [buildMatrix("documents", entityCodeSets, entityLabels)] });
    }

    if (selCaseAttrIds.size > 0) {
      const matrices: CoOccurrenceMatrix[] = [];
      for (const attr of caseAttributeItems.filter((item) => selCaseAttrIds.has(item.id))) {
        const caseIdsByValue = new Map<string, Set<string>>();
        for (const value of caseAttributeValues.filter((item) => item.attributeId === attr.id)) {
          if (!filteredSelectedCaseIds.has(value.ownerId)) continue;
          const valueLabel = normalizeValue(value.value);
          if (!caseIdsByValue.has(valueLabel)) caseIdsByValue.set(valueLabel, new Set());
          caseIdsByValue.get(valueLabel)!.add(value.ownerId);
        }
        for (const [valueLabel, caseIds] of caseIdsByValue) {
          const selectedCases = [...caseIds]
            .map((caseId) => caseItems.find((item) => item.id === caseId))
            .filter((item): item is CaseItem => !!item);
          const entityCodeSets = selectedCases.map((caseItem) => {
            const annotations: Annotation[] = [];
            for (const docId of caseDocumentMap.get(caseItem.id) ?? []) {
              if (!filteredSelectedDocIds.has(docId)) continue;
              annotations.push(...(annotationsByDocument.get(docId) ?? []));
            }
            return makeCodeSet(annotations);
          });
          const entityLabels = selectedCases.map((item) => item.name);
          matrices.push(buildMatrix(`${attr.id}:${valueLabel}`, entityCodeSets, entityLabels, `${attr.name}: ${valueLabel}`, true));
        }
      }
      sections.push({ key: "case-attributes", title: "Case Attributes", matrices });
    }

    if (selDocAttrIds.size > 0) {
      const matrices: CoOccurrenceMatrix[] = [];
      for (const attr of documentAttributeItems.filter((item) => selDocAttrIds.has(item.id))) {
        const docIdsByValue = new Map<string, Set<string>>();
        for (const value of documentAttributeValues.filter((item) => item.attributeId === attr.id)) {
          if (!filteredSelectedDocIds.has(value.ownerId)) continue;
          const valueLabel = normalizeValue(value.value);
          if (!docIdsByValue.has(valueLabel)) docIdsByValue.set(valueLabel, new Set());
          docIdsByValue.get(valueLabel)!.add(value.ownerId);
        }
        for (const [valueLabel, docIds] of docIdsByValue) {
          const selectedDocuments = [...docIds]
            .map((docId) => documents.find((item) => item.id === docId))
            .filter((item): item is ProjectDocument => !!item);
          const entityCodeSets = selectedDocuments.map((doc) => makeCodeSet(annotationsByDocument.get(doc.id) ?? []));
          const entityLabels = selectedDocuments.map((item) => item.name);
          matrices.push(buildMatrix(`${attr.id}:${valueLabel}`, entityCodeSets, entityLabels, `${attr.name}: ${valueLabel}`, true));
        }
      }
      sections.push({ key: "document-attributes", title: "Document Attributes", matrices });
    }

    return sections;
  }, [
    annotationsByDocument,
    caseAttributeItems,
    caseAttributeValues,
    caseDocumentMap,
    caseItems,
    documentAttributeItems,
    documentAttributeValues,
    documents,
    frozenSnapshot,
    isFrozen,
    selCaseAttrIds,
    filteredSelectedCaseIds,
    selCodeIds,
    selDocAttrIds,
    filteredSelectedDocIds,
    selUserIds,
    selectedAnnotations,
    selectedCoOccurrenceCodes,
    userItems,
  ]);

  const frequencySections = useMemo(() => {
    const sections: FrequencySection[] = [];

    if (selUserIds.size > 0) {
      sections.push({
        key: "users",
        title: "Users",
        columns: userItems
          .filter((item) => selUserIds.has(item.id))
          .map((item) => ({
            id: item.id,
            label: item.name,
            annotationIds: new Set(selectedAnnotations.filter((ann) => ann.createdById === item.id).map((ann) => ann.id)),
          })),
      });
    }

    if (filteredSelectedCaseIds.size > 0) {
      sections.push({
        key: "cases",
        title: "Objects",
        columns: caseItems
          .filter((item) => filteredSelectedCaseIds.has(item.id))
          .map((item) => {
            const ids = new Set<string>();
            for (const docId of caseDocumentMap.get(item.id) ?? []) {
              if (!filteredSelectedDocIds.has(docId)) continue;
              for (const ann of annotationsByDocument.get(docId) ?? []) ids.add(ann.id);
            }
            return { id: item.id, label: item.name, annotationIds: ids };
          }),
      });
    }

    if (selCaseAttrIds.size > 0) {
      const caseAttrColumns = new Map<string, FrequencyColumn>();
      for (const attr of caseAttributeItems.filter((item) => selCaseAttrIds.has(item.id))) {
        const values = caseAttributeValues.filter((item) => item.attributeId === attr.id && filteredSelectedCaseIds.has(item.ownerId));
        for (const value of values) {
          const label = `${attr.name}: ${value.value.trim() || t("reportsCodes.exportSections.noValue")}`;
          const columnKey = `${attr.id}:${value.value.trim() || t("reportsCodes.exportSections.noValue")}`;
          if (!caseAttrColumns.has(columnKey)) {
            caseAttrColumns.set(columnKey, { id: columnKey, label, annotationIds: new Set() });
          }
          const column = caseAttrColumns.get(columnKey)!;
          for (const docId of caseDocumentMap.get(value.ownerId) ?? []) {
            if (!filteredSelectedDocIds.has(docId)) continue;
            for (const ann of annotationsByDocument.get(docId) ?? []) column.annotationIds.add(ann.id);
          }
        }
      }
      sections.push({ key: "case-attributes", title: "Case Attributes", columns: [...caseAttrColumns.values()] });
    }

    if (filteredSelectedDocIds.size > 0) {
      sections.push({
        key: "documents",
        title: "Sources",
        columns: documents
          .filter((item) => filteredSelectedDocIds.has(item.id))
          .map((item) => ({
            id: item.id,
            label: item.name,
            annotationIds: new Set((annotationsByDocument.get(item.id) ?? []).map((ann) => ann.id)),
          })),
      });
    }

    if (selDocAttrIds.size > 0) {
      const docAttrColumns = new Map<string, FrequencyColumn>();
      for (const attr of documentAttributeItems.filter((item) => selDocAttrIds.has(item.id))) {
        const values = documentAttributeValues.filter((item) => item.attributeId === attr.id && filteredSelectedDocIds.has(item.ownerId));
        for (const value of values) {
          const label = `${attr.name}: ${value.value.trim() || t("reportsCodes.exportSections.noValue")}`;
          const columnKey = `${attr.id}:${value.value.trim() || t("reportsCodes.exportSections.noValue")}`;
          if (!docAttrColumns.has(columnKey)) {
            docAttrColumns.set(columnKey, { id: columnKey, label, annotationIds: new Set() });
          }
          const column = docAttrColumns.get(columnKey)!;
          for (const ann of annotationsByDocument.get(value.ownerId) ?? []) column.annotationIds.add(ann.id);
        }
      }
      sections.push({ key: "document-attributes", title: "Document Attributes", columns: [...docAttrColumns.values()] });
    }

    return sections;
  }, [
    annotationsByDocument,
    caseAttributeItems,
    caseAttributeValues,
    caseDocumentMap,
    caseItems,
    documentAttributeItems,
    documentAttributeValues,
    documents,
    selCaseAttrIds,
    filteredSelectedCaseIds,
    selDocAttrIds,
    filteredSelectedDocIds,
    selUserIds,
    selectedAnnotations,
    userItems,
  ]);

  function togglePanel(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggle(set: Set<string>, id: string) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }

  function clearPrimarySelections() {
    setSelCaseIds(new Set());
    setSelDocIds(new Set());
    setSelRelationshipIds(new Set());
    setSelCodeIds(new Set());
    setSelUserIds(new Set());
  }

  function applyPrimarySelectionState(
    nextCaseIds: Set<string>,
    nextDocIds: Set<string>,
    nextCodeIds: Set<string>,
    nextUserIds: Set<string>,
    options?: { preserveRelationshipSelection?: boolean },
  ) {
    setSelCaseIds(nextCaseIds);
    setSelDocIds(nextDocIds);
    setSelCodeIds(nextCodeIds);
    setSelUserIds(nextUserIds);
    if (!options?.preserveRelationshipSelection) setSelRelationshipIds(new Set());
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
      for (const docId of caseDocumentMap.get(caseId) ?? []) {
        nextDocIds.add(docId);
      }
    }

    for (const docId of nextDocIds) {
      for (const ann of annotationsByDocument.get(docId) ?? []) {
        nextCodeIds.add(ann.codeId);
        nextUserIds.add(ann.createdById);
      }
    }

    applyPrimarySelectionState(nextCaseIds, nextDocIds, nextCodeIds, nextUserIds);
  }

  function applySelectionFromRelationships(nextRelationshipIds: Set<string>) {
    if (nextRelationshipIds.size === 0) {
      clearPrimarySelections();
      return;
    }
    const nextCaseIds = new Set<string>();
    for (const relationship of relationshipItems) {
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
      for (const docId of caseDocumentMap.get(caseId) ?? []) {
        nextDocIds.add(docId);
      }
    }
    for (const docId of nextDocIds) {
      for (const ann of annotationsByDocument.get(docId) ?? []) {
        nextCodeIds.add(ann.codeId);
        nextUserIds.add(ann.createdById);
      }
    }
    setSelRelationshipIds(new Set(nextRelationshipIds));
    applyPrimarySelectionState(nextCaseIds, nextDocIds, nextCodeIds, nextUserIds, { preserveRelationshipSelection: true });
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
      for (const caseId of documentCaseMap.get(docId) ?? []) {
        nextCaseIds.add(caseId);
      }
      for (const ann of annotationsByDocument.get(docId) ?? []) {
        nextCodeIds.add(ann.codeId);
        nextUserIds.add(ann.createdById);
      }
    }

    applyPrimarySelectionState(nextCaseIds, nextDocIds, nextCodeIds, nextUserIds);
  }

  function applySelectionFromCodes(nextCodeIds: Set<string>) {
    if (nextCodeIds.size === 0) {
      clearPrimarySelections();
      return;
    }
    const nextDocIds = new Set<string>();
    const nextCaseIds = new Set<string>();
    const nextUserIds = new Set<string>();

    for (const ann of allAnnotations) {
      if (!nextCodeIds.has(ann.codeId)) continue;
      nextDocIds.add(ann.documentId);
      nextUserIds.add(ann.createdById);
      for (const caseId of documentCaseMap.get(ann.documentId) ?? []) {
        nextCaseIds.add(caseId);
      }
    }

    applyPrimarySelectionState(nextCaseIds, nextDocIds, nextCodeIds, nextUserIds);
  }

  function applySelectionFromUsers(nextUserIds: Set<string>) {
    if (nextUserIds.size === 0) {
      clearPrimarySelections();
      return;
    }
    const nextDocIds = new Set<string>();
    const nextCaseIds = new Set<string>();
    const nextCodeIds = new Set<string>();

    for (const userId of nextUserIds) {
      for (const ann of annotationsByUser.get(userId) ?? []) {
        nextDocIds.add(ann.documentId);
        nextCodeIds.add(ann.codeId);
        for (const caseId of documentCaseMap.get(ann.documentId) ?? []) {
          nextCaseIds.add(caseId);
        }
      }
    }

    applyPrimarySelectionState(nextCaseIds, nextDocIds, nextCodeIds, nextUserIds);
  }

  function toggleCaseAttributeSelection(attr: AttributeItem) {
    const next = new Set(selCaseAttrIds);
    if (next.has(attr.id)) next.delete(attr.id);
    else next.add(attr.id);
    setSelCaseAttrIds(next);
    if (next.has(attr.id)) {
      setCaseAttributeFilters((prev) => prev[attr.id] ? prev : {
        ...prev,
        [attr.id]: buildDefaultAttributeFilter(attr, caseAttributeValueStats),
      });
    }
  }

  function toggleDocumentAttributeSelection(attr: AttributeItem) {
    const next = new Set(selDocAttrIds);
    if (next.has(attr.id)) next.delete(attr.id);
    else next.add(attr.id);
    setSelDocAttrIds(next);
    if (next.has(attr.id)) {
      setDocumentAttributeFilters((prev) => prev[attr.id] ? prev : {
        ...prev,
        [attr.id]: buildDefaultAttributeFilter(attr, documentAttributeValueStats),
      });
    }
  }

  function selectAllCaseAttributes() {
    setSelCaseAttrIds(new Set(caseAttributeItems.map((item) => item.id)));
    setCaseAttributeFilters((prev) => {
      const next = { ...prev };
      for (const item of caseAttributeItems) {
        if (!next[item.id]) next[item.id] = buildDefaultAttributeFilter(item, caseAttributeValueStats);
      }
      return next;
    });
  }

  function clearCaseAttributeSelections() {
    setSelCaseAttrIds(new Set());
  }

  function selectAllDocumentAttributes() {
    setSelDocAttrIds(new Set(documentAttributeItems.map((item) => item.id)));
    setDocumentAttributeFilters((prev) => {
      const next = { ...prev };
      for (const item of documentAttributeItems) {
        if (!next[item.id]) next[item.id] = buildDefaultAttributeFilter(item, documentAttributeValueStats);
      }
      return next;
    });
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
                  <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{t("reportsCodes.filterEditors.noNumericValues")}</div>
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
                        <span style={{ color: "var(--color-text-muted)" }}>{t("reportsCodes.filterEditors.minimum")}</span>
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
                        <span style={{ color: "var(--color-text-muted)" }}>{t("reportsCodes.filterEditors.maximum")}</span>
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
                    <span style={{ color: "var(--color-text-muted)" }}>{t("reportsCodes.filterEditors.from")}</span>
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
                    <span style={{ color: "var(--color-text-muted)" }}>{t("reportsCodes.filterEditors.to")}</span>
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
                  <div style={{ padding: 10, fontSize: 12, color: "var(--color-text-muted)" }}>{t("reportsCodes.filterEditors.noTextValues")}</div>
                ) : (
                  <ul className="code-list">
                    {(stat?.textValues ?? []).map((value) => (
                      <li
                        key={`${item.id}-${value}`}
                        className="code-item"
                        style={{ cursor: isFrozen ? "default" : "pointer" }}
                        onClick={isFrozen ? undefined : () => {
                          const next = new Set(selectedValues);
                          if (next.has(value)) next.delete(value);
                          else next.add(value);
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
                            if (next.has(value)) next.delete(value);
                            else next.add(value);
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
        if (selectedValues.length === 0) return `${item.name}: ${t("reportsCodes.exportSections.noValuesSelected")}`;
        if (selectedValues.length <= 3) return `${item.name}: ${selectedValues.join(", ")}`;
        return `${item.name}: ${selectedValues.slice(0, 3).join(", ")} ${t("reportsCodes.exportSections.more", { count: selectedValues.length - 3 })}`;
      });
  }

  function toggleSummaryCard(key: string) {
    setExpandedSummaryCards((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const selectedSummaryCards = [
    {
      key: "cases",
      label: t("reportsCodes.panels.cases"),
      value: visibleCases,
      items: caseItems
        .filter((item) => filteredSelectedCaseIds.has(item.id))
        .map((item) => ({ id: item.id, name: item.name })),
    },
    {
      key: "documents",
      label: t("reportsCodes.panels.documents"),
      value: visibleDocs,
      items: documents
        .filter((item) => filteredSelectedDocIds.has(item.id))
        .map((item) => ({ id: item.id, name: item.name })),
    },
    {
      key: "relationships",
      label: t("reportsCodes.panels.relationships"),
      value: visibleRelationships,
      items: relationshipItems
        .filter((item) => selRelationshipIds.has(item.id))
        .map((item) => ({
          id: item.id,
          name: `${relationshipColumnValue(item, "relationshipType")} (${relationshipColumnValue(item, "object1Name")} - ${relationshipColumnValue(item, "object2Name")})`,
        })),
    },
    {
      key: "codes",
      label: t("reportsCodes.panels.codes"),
      value: visibleCodes,
      items: buildCodeTree(codes)
        .filter((node) => selCodeIds.has(node.code.id))
        .map((node) => ({ id: node.code.id, name: node.code.label })),
    },
    {
      key: "users",
      label: t("reportsCodes.panels.users"),
      value: visibleUsers,
      items: userItems
        .filter((item) => selUserIds.has(item.id))
        .map((item) => ({ id: item.id, name: item.name })),
    },
  ];

  const includedCaseNames = useMemo(
    () => caseItems.filter((item) => filteredSelectedCaseIds.has(item.id)).map((item) => item.name),
    [caseItems, filteredSelectedCaseIds],
  );

  const includedDocumentNames = useMemo(
    () => documents.filter((item) => filteredSelectedDocIds.has(item.id)).map((item) => item.name),
    [documents, filteredSelectedDocIds],
  );

  const includedUserNames = useMemo(
    () => userItems.filter((item) => selUserIds.has(item.id)).map((item) => item.name),
    [userItems, selUserIds],
  );

  const frequencyExportRows = useMemo(() => frequencySections.flatMap((section) => {
    return section.columns.map((column) => ({
      section: section.title,
      category: column.label,
      values: codeBuckets.map((bucket) => {
        let value = 0;
        for (const annotationId of column.annotationIds) {
          const ann = selectedAnnotations.find((item) => item.id === annotationId);
          if (ann && bucket.codeIds.has(ann.codeId)) value += 1;
        }
        return { code: bucket.label, value };
      }),
    }));
  }), [codeBuckets, frequencySections, selectedAnnotations]);
  const coOccurrenceExportRows = useMemo(() => coOccurrenceSections.flatMap((section) => {
    return section.matrices.flatMap((matrix) => matrix.codes.map((rowCode, rowIndex) => ({
      section: section.title,
      category: matrix.subtitle ? `${matrix.subtitle} | ${rowCode.label}` : rowCode.label,
      values: matrix.codes.map((colCode, colIndex) => ({
        code: colCode.label,
        value: matrix.diagonalEmpty && rowIndex === colIndex ? "" : String(matrix.cells[rowIndex]?.[colIndex] ?? 0),
      })),
    })));
  }), [coOccurrenceSections]);
  const reportExportRows = reportKind === "frequencies" ? frequencyExportRows : coOccurrenceExportRows;
  const selectedAnnotationById = useMemo(() => new Map(selectedAnnotations.map((ann) => [ann.id, ann])), [selectedAnnotations]);

  const frequencyExportSections = useMemo(() => {
    return frequencySections.map((section) => {
      const frozenRows = frozenSnapshot?.frozenFrequencyRows?.filter((rowItem) => rowItem.section === section.title);
      const countForBucket = (column: FrequencyColumn, bucket: FrequencyCodeBucket) => {
        let value = 0;
        for (const annotationId of column.annotationIds) {
          const ann = selectedAnnotationById.get(annotationId);
          if (ann && bucket.codeIds.has(ann.codeId)) value += 1;
        }
        return value;
      };
      const displayBuckets = frozenRows && frozenRows.length > 0
        ? Array.from(new Set(frozenRows.flatMap((row) => row.values.map((value) => value.code)))).map((label) => ({
            id: label,
            label,
            color: codeBuckets.find((bucket) => bucket.label === label)?.color ?? "#B04A33",
            codeIds: new Set<string>(),
          }))
        : codeBuckets.map((bucket) => ({
            ...bucket,
            color: bucket.color || "#B04A33",
          }));
      const tableRows = frozenRows && frozenRows.length > 0
        ? frozenRows.map((row) => ({
            id: row.category,
            label: row.category,
            values: displayBuckets.map((bucket) => row.values.find((value) => value.code === bucket.label)?.value ?? 0),
          }))
        : section.columns.map((column) => ({
            id: column.id,
            label: column.label,
            values: displayBuckets.map((bucket) => countForBucket(column, bucket)),
          }));
      const matrix = displayBuckets.map((bucket, bucketIndex) => ({
        bucket,
        cells: tableRows.map((row) => row.values[bucketIndex] ?? 0),
      }));
      const maxCell = Math.max(0, ...matrix.flatMap((row) => row.cells));
      return { section, displayBuckets, tableRows, matrix, maxCell };
    });
  }, [frequencySections, frozenSnapshot, selectedAnnotationById, codeBuckets]);

  function currentSettings(): CodeReportSettings {
    return {
      kind: reportKind,
      caseIds: [...selCaseIds],
      documentIds: [...selDocIds],
      relationshipIds: [...selRelationshipIds],
      caseAttributeIds: [...selCaseAttrIds],
      documentAttributeIds: [...selDocAttrIds],
      caseTypes: [...selCaseTypes],
      documentTypes: [...selDocTypes],
      codeIds: [...selCodeIds],
      userIds: [...selUserIds],
      caseAttributeFilters,
      documentAttributeFilters,
    };
  }

  function currentDescriptionHtml(): string | undefined {
    if (!showDescription) return undefined;
    const html = descriptionEditor?.getHTML() ?? frozenSnapshot?.description ?? "";
    return hasDescriptionContent(html) ? html : undefined;
  }

  function buildSnapshot(): CodeReportSnapshot {
    return {
      reportType: "code-report",
      kind: reportKind,
      settings: currentSettings(),
      caseItems,
      relationshipItems,
      userItems,
      caseAttributeItems,
      documentAttributeItems,
      documents: documents
        .filter((doc) => selDocIds.has(doc.id))
        .map((doc) => ({ ...doc, content: "", filePath: "" })),
      codes: codes.map((code) => ({ ...code, description: "" })),
      annotations: [],
      frozenFrequencyRows: reportKind === "frequencies" ? frequencyExportRows : undefined,
      frozenCoOccurrenceSections: reportKind === "summary" ? coOccurrenceSections : undefined,
      caseDocumentLinks: [],
      caseAttributeValues: [],
      documentAttributeValues: [],
      description: currentDescriptionHtml(),
    };
  }

  async function recordReportExport(format: string, filePath: string) {
    if (!postgresProjectId || !row?.id) return;
    try {
      await logPostgresReportExport({
        projectId: postgresProjectId,
        reportId: row.id,
        title: name || row.name || "Report",
        reportType: "code-report",
        format,
        filePath,
      });
    } catch (e) {
      console.warn("Could not log report export:", e);
    }
  }

  function exportHeatmapColor(value: number, max: number): string {
    if (value <= 0 || max <= 0) return "#F7F1EF";
    const t = Math.min(1, value / max);
    const high = [176, 74, 51];
    const low = [241, 221, 215];
    const mix = low.map((channel, index) => Math.round(channel + (high[index] - channel) * t));
    return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
  }

  function getFrequencyBarChartSvg(sectionTitle: string, tableRows: Array<{ id: string; label: string; values: number[] }>, displayBuckets: Array<{ id: string; label: string; color: string }>, maxCell: number): string {
    const width = 920;
    const rowHeight = 112;
    const height = Math.max(120, 40 + tableRows.length * rowHeight);
    const labelWidth = 170;
    const chartLeft = labelWidth;
    const chartRight = width - 24;
    const chartWidth = chartRight - chartLeft;
    const scale = maxCell > 0 ? maxCell : 1;
    const rows = tableRows.map((row, rowIndex) => {
      const rowTop = 38 + rowIndex * rowHeight;
      const bucketCount = Math.max(displayBuckets.length, 1);
      const bucketSlot = chartWidth / bucketCount;
      const bars = row.values.map((value, index) => {
        const barWidth = Math.min(34, Math.max(18, bucketSlot - 12));
        const x = chartLeft + index * bucketSlot + (bucketSlot - barWidth) / 2;
        const barHeight = maxCell > 0 ? Math.max(4, (value / scale) * 58) : 0;
        const y = rowTop + 62 - barHeight;
        const color = displayBuckets[index]?.color || "#B04A33";
        const label = displayBuckets[index]?.label || "";
        return `
          <text x="${x + barWidth / 2}" y="${rowTop + 12}" text-anchor="middle" font-size="11" fill="#687385">${value}</text>
          <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4" fill="${escapeHtml(color)}" />
          <text x="${x + barWidth / 2}" y="${rowTop + 82}" text-anchor="middle" font-size="10" fill="#687385">${escapeHtml(label)}</text>
        `;
      }).join("");
      return `
        <text x="${labelWidth - 10}" y="${rowTop + 45}" text-anchor="end" font-size="12" fill="#1f2933">${escapeHtml(row.label)}</text>
        <line x1="${chartLeft}" y1="${rowTop + 64}" x2="${chartRight}" y2="${rowTop + 64}" stroke="#d5dbe3" stroke-width="1" />
        ${bars}
      `;
    }).join("");
    return `
      <svg xmlns="http://www.w3.org/2000/svg" font-family="Aptos, Calibri, Arial, sans-serif" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
        <rect width="100%" height="100%" fill="#ffffff" />
        <text x="18" y="22" font-size="16" font-weight="700" fill="#1f2933">${escapeHtml(sectionTitle)} ${escapeHtml(t("reportsCodes.exportSections.chartSuffix"))}</text>
        ${rows}
      </svg>
    `;
  }

  async function handleSave() {
    if (!canStartReports) return;
    if (!postgresProjectId || isFrozen) return;
    setSaving(true);
    setError(null);
    try {
      const reportName = name.trim() || `${reportLabel} Report`;
      const snapshot = buildSnapshot();
      const record = await createPostgresReport({
        projectId: postgresProjectId,
        title: reportName,
        reportType: "code-report",
        settingsJson: JSON.stringify(snapshot.settings),
        contentJson: JSON.stringify(snapshot),
        contentText: reportLabel,
      });
      const savedRow: CodeReportRow = {
        id: record.id,
        name: record.title || reportName,
        createdByName: record.createdByName || "-",
        createdAt: record.createdAt,
        snapshot,
      };
      onSaved?.(savedRow);
    } catch (e) {
      console.error(e);
      setError(getReportSaveErrorMessage(e));
      setSaving(false);
    }
  }

  function getExportHtml(): string {
    const description = currentDescriptionHtml();
    const appliedFilters = [
      ...caseFilterDetails.map((detail) => `${t("reportsCodes.panels.cases")}: ${detail}`),
      ...documentFilterDetails.map((detail) => `${t("reportsCodes.panels.documents")}: ${detail}`),
    ];
    const formatList = (values: string[], emptyLabel: string) => values.length > 0 ? values.join(", ") : emptyLabel;
    const resultsHtml = reportKind === "frequencies"
      ? (frequencySections.length === 0
        ? `<p class="muted">No frequency cards were included in this report.</p>`
        : frequencyExportSections.map(({ section, displayBuckets, tableRows, matrix, maxCell }) => {
          const tableHeader = displayBuckets.map((bucket) => `<th>${escapeHtml(bucket.label)}</th>`).join("");
          const tableRowsHtml = tableRows.map((row) => {
            const cells = row.values.map((value) => {
              const bg = exportHeatmapColor(value, maxCell);
              const color = value > 0 ? "#1f2933" : "#687385";
              return `<td style="background:${bg};color:${color};text-align:center;">${value}</td>`;
            }).join("");
            return `<tr><td>${escapeHtml(row.label)}</td>${cells}</tr>`;
          }).join("");
          const chartSvg = getFrequencyBarChartSvg(section.title, tableRows, displayBuckets, maxCell);
          const heatmapRows = matrix.map((row) => {
            const cells = row.cells.map((value) => `
              <td style="background:${exportHeatmapColor(value, maxCell)}; color:${value > 0 ? "#1f2933" : "#687385"}; text-align:center;">
                ${value}
              </td>
            `).join("");
            return `
              <tr>
                <td><span style="display:inline-block; width:10px; height:10px; border-radius:999px; background:${escapeHtml(row.bucket.color)}; margin-right:8px; vertical-align:middle;"></span>${escapeHtml(row.bucket.label)}</td>
                ${cells}
              </tr>
            `;
          }).join("");
          return `
            <h2>${escapeHtml(section.title)}</h2>
            <h3>Table</h3>
            <table class="summary">
              <tr><th>${escapeHtml(section.title)}</th>${tableHeader}</tr>
              ${tableRowsHtml || `<tr><td colspan="${displayBuckets.length + 1}" class="muted">No selected items.</td></tr>`}
            </table>
            <h3>{t("reportsCodes.frequencyViews.chart")}</h3>
            <div class="chart-block">${chartSvg}</div>
            <h3>{t("reportsCodes.frequencyViews.heatmap")}</h3>
            <table class="summary">
              <tr><th>Code</th>${tableRows.map((row) => `<th>${escapeHtml(row.label)}</th>`).join("")}</tr>
              ${heatmapRows || `<tr><td colspan="${tableRows.length + 1}" class="muted">Select codes to build the matrix.</td></tr>`}
            </table>
          `;
        }).join(""))
      : (coOccurrenceSections.length === 0
        ? `<p class="muted">No co-occurrence cards were included in this report.</p>`
        : coOccurrenceSections.map((section) => `
            <h2>${escapeHtml(section.title)}</h2>
            ${section.matrices.map((matrix) => {
              const maxCell = Math.max(0, ...matrix.cells.flatMap((row, rowIndex) => (
                row.filter((_value, colIndex) => !(matrix.diagonalEmpty && rowIndex === colIndex))
              )));
              const rows = matrix.codes.map((rowCode, rowIndex) => {
                const cells = matrix.codes.map((_colCode, colIndex) => {
                  const isEmpty = matrix.diagonalEmpty && rowIndex === colIndex;
                  const value = matrix.cells[rowIndex]?.[colIndex] ?? 0;
                  const background = isEmpty ? "#f4f4f5" : exportHeatmapColor(value, maxCell);
                  const color = value > 0 && !isEmpty ? "#1f2933" : "#687385";
                  return `<td style="background:${background}; color:${color}; text-align:center;">${isEmpty ? "" : value}</td>`;
                }).join("");
                return `<tr><td>${escapeHtml(rowCode.label)}</td>${cells}</tr>`;
              }).join("");
              return `
                ${matrix.subtitle ? `<p class="matrix-subtitle">${escapeHtml(matrix.subtitle)}</p>` : ""}
                <table class="summary">
                  <tr><th>Code</th>${matrix.codes.map((code) => `<th>${escapeHtml(code.label)}</th>`).join("")}</tr>
                  ${rows || `<tr><td colspan="${matrix.codes.length + 1}" class="muted">Select codes to build the matrix.</td></tr>`}
                </table>
              `;
            }).join("")}
          `).join(""));

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(name || t("reportsCodes.exportSections.untitledReport"))}</title>
    <style>
      body { font-family: Aptos, Calibri, Arial, sans-serif; color: #1f2933; line-height: 1.45; }
      h1 { font-size: 26px; margin: 0 0 8px; }
      h2 { font-size: 18px; margin: 24px 0 8px; border-bottom: 1px solid #d5dbe3; padding-bottom: 4px; }
      h3 { font-size: 14px; margin: 16px 0 8px; color: #334155; }
      .muted { color: #687385; }
      .details, .summary { width: 100%; border-collapse: collapse; margin: 12px 0 18px; }
      .details td, .summary td, .summary th { border: 1px solid #d5dbe3; padding: 7px 9px; vertical-align: top; }
      .summary th { background: #eef2f6; text-align: left; }
      .description { margin: 10px 0 18px; }
      .matrix-subtitle { color: #687385; font-style: italic; margin: 12px 0 4px; }
      .chart-block { margin: 8px 0 18px; }
      .chart-block svg { max-width: 100%; height: auto; display: block; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(name || t("reportsCodes.exportSections.untitledReport"))}</h1>
    <table class="details">
      <tr><td><strong>Type</strong></td><td>${escapeHtml(reportLabel)}</td></tr>
      <tr><td><strong>${escapeHtml(t("reportsCodes.exportSections.createdBy"))}</strong></td><td>${escapeHtml(createdBy)}</td></tr>
      <tr><td><strong>Created</strong></td><td>${escapeHtml(row ? fmtDate(row.createdAt) : fmtDate(new Date().toISOString()))}</td></tr>
      <tr><td><strong>${escapeHtml(t("reportsCodes.exportSections.selectedCodes"))}</strong></td><td>${escapeHtml(selectedCodeLabels)}</td></tr>
      <tr><td><strong>${escapeHtml(t("reportsCodes.includedCases"))}</strong></td><td>${escapeHtml(formatList(includedCaseNames, t("reportsCodes.noCasesSelected")))}</td></tr>
      <tr><td><strong>${escapeHtml(t("reportsCodes.includedDocuments"))}</strong></td><td>${escapeHtml(formatList(includedDocumentNames, t("reportsCodes.noDocumentsSelected")))}</td></tr>
      <tr><td><strong>${escapeHtml(t("reportsCodes.includedUsers"))}</strong></td><td>${escapeHtml(formatList(includedUserNames, t("reportsCodes.noUsersSelected")))}</td></tr>
      ${appliedFilters.length > 0 ? `<tr><td><strong>${escapeHtml(t("reportsCodes.exportSections.appliedFilters"))}</strong></td><td>${escapeHtml(appliedFilters.join(" | "))}</td></tr>` : ""}
    </table>
    ${description ? `<h2>${escapeHtml(t("reportsCodes.exportSections.description"))}</h2><div class="description">${description}</div>` : ""}
    <h2>${escapeHtml(t("reportsCodes.exportSections.summary"))}</h2>
    <table class="summary">
      <tr><th>Users</th><th>Objects</th><th>Object Attributes</th><th>Sources</th><th>Source Attributes</th><th>Codes</th></tr>
      <tr><td>${visibleUsers}</td><td>${visibleCases}</td><td>${visibleCaseAttrs}</td><td>${visibleDocs}</td><td>${visibleDocAttrs}</td><td>${visibleCodes}</td></tr>
    </table>
    ${resultsHtml}
  </body>
</html>`;
  }

  async function handleExportHTML() {
    if (!canExportReports) return;
    try {
      setExportingFormat("html");
      const path = await save({ defaultPath: `${name || "Report"}.html`, filters: [{ name: "HTML", extensions: ["html"] }] });
      if (!path) return;
      await writeTextFile(path, getExportHtml());
      await recordReportExport("html", path);
    } catch {
      setError("HTML export failed.");
    } finally {
      setExportingFormat(null);
      setShowExportModal(false);
    }
  }

  async function handleExportXLSX() {
    if (!canExportReports) return;
    try {
      setExportingFormat("xlsx");
      const path = await save({ defaultPath: `${name || "Report"}.xlsx`, filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }] });
      if (!path) return;

      const { default: writeXlsxFile } = await loadWriteExcelFile();
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
      const sectionCell = (value: string, columnSpan = 1) => ({
        value,
        fontWeight: "bold" as const,
        fontSize: 12,
        ...(columnSpan > 1 ? { columnSpan } : {}),
      });
      const colorValueCell = (value: number, maxValue: number) => {
        if (!(value > 0) || !(maxValue > 0)) return value;
        const backgroundColor = heatmapColorStatic(value, maxValue);
        const t = value / Math.max(1, maxValue);
        return {
          value,
          backgroundColor,
          textColor: t > 0.55 ? "#FFFFFF" : "#374151",
        };
      };

      // ── Metadata sheet ────────────────────────────────────────────────────
      const metaRows: Array<Array<any>> = [
        [titleCellValue(name || t("reportsCodes.exportSections.untitledReport"), 2), null],
        [],
        ["Type", reportLabel],
        [t("reportsCodes.exportSections.createdBy"), createdBy],
        ["Created", row ? fmtDate(row.createdAt) : fmtDate(new Date().toISOString())],
      ];

      const description = htmlToPlainText(currentDescriptionHtml() ?? "");
      if (description) {
        metaRows.push([]);
        metaRows.push([sectionCell(t("reportsCodes.exportSections.description"))]);
        for (const line of description.split(/\n+/).filter(Boolean)) metaRows.push([line]);
      }

      metaRows.push([]);
      metaRows.push([sectionCell(t("reportsCodes.exportSections.summary"))]);
      metaRows.push(["Users", visibleUsers]);
      metaRows.push(["Objects", visibleCases]);
      metaRows.push(["Case Attributes", visibleCaseAttrs]);
      metaRows.push(["Sources", visibleDocs]);
      metaRows.push(["Document Attributes", visibleDocAttrs]);
      metaRows.push(["Codes", visibleCodes]);

      const sheets: Array<any> = [
        {
          sheet: "Report",
          data: metaRows,
          columns: [{ width: 22 }, { width: 54 }],
        },
      ];

      // ── Frequency section sheets ──────────────────────────────────────────
      if (reportKind === "frequencies") {
        for (const { section, displayBuckets, tableRows, matrix, maxCell } of frequencyExportSections) {
          const sectionRows: Array<Array<any>> = [];
          const maxSheetColumns = Math.max(2, displayBuckets.length + 1, tableRows.length + 1);
          sectionRows.push([titleCellValue(section.title, maxSheetColumns), ...Array(Math.max(0, maxSheetColumns - 1)).fill(null)]);
          sectionRows.push([]);

          // — Frequency table —————————————————————————————————————————————
          sectionRows.push([sectionCell(t("reportsCodes.exportSections.frequencyTable"), Math.max(2, displayBuckets.length + 1)), ...Array(Math.max(0, Math.max(2, displayBuckets.length + 1) - 1)).fill(null)]);
          sectionRows.push([headerCell(section.title), ...displayBuckets.map((bucket) => headerCell(bucket.label))]);

          for (const tRow of tableRows) {
            sectionRows.push([
              tRow.label,
              ...displayBuckets.map((_, index) => colorValueCell(tRow.values[index] ?? 0, maxCell)),
            ]);
          }
          sectionRows.push([]);

          // — Bar chart ————————————————————————————————————————————————————
          

          // — Heatmap ——————————————————————————————————————————————————————
          if (matrix.length > 0 && tableRows.length > 0) {
            sectionRows.push([sectionCell(t("reportsCodes.frequencyViews.heatmap"), Math.max(2, tableRows.length + 1)), ...Array(Math.max(0, Math.max(2, tableRows.length + 1) - 1)).fill(null)]);
            sectionRows.push([headerCell("Code"), ...tableRows.map((tableRow) => headerCell(tableRow.label))]);
            // Adjust columns for heatmap (codes × categories — may differ from freq table)

            for (const matRow of matrix) {
              sectionRows.push([
                matRow.bucket.label,
                ...matRow.cells.map((value) => colorValueCell(value ?? 0, maxCell)),
              ]);
            }

          }
          sheets.push({
            sheet: section.title.slice(0, 31),
            data: sectionRows,
            columns: [
              { width: 26 },
              ...Array.from({ length: maxSheetColumns - 1 }, () => ({ width: 14 })),
            ],
          });
        }

      // ── Co-occurrence sheet ───────────────────────────────────────────────
      } else {
        sheets.push({
          sheet: "Co-Occurrence",
          data: [
            [t("reportsCodes.exportSections.section"), t("reportsCodes.exportSections.category"), t("reportsCodes.exportSections.code"), t("reportsCodes.exportSections.count")].map((value) => headerCell(value)),
            ...reportExportRows.flatMap((rowItem) =>
              rowItem.values.map((value) => [rowItem.section, rowItem.category, value.code, value.value]),
            ),
          ],
          columns: [{ width: 18 }, { width: 30 }, { width: 24 }, { width: 10 }],
        });
      }

      const file = writeXlsxFile(sheets, {
        fontFamily: "Calibri",
        fontSize: 11,
      });
      const blob = await file.toBlob();
      await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
      await recordReportExport("xlsx", path);
    } catch (e) {
      console.error("XLSX export failed:", e);
      setError("XLSX export failed.");
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

      const { jsPDF } = await loadJsPdf();
      const pdf = new jsPDF({ unit: "pt", format: "letter" });
      const margin = 54;
      const pageH = pdf.internal.pageSize.getHeight();
      const contentWidth = pdf.internal.pageSize.getWidth() - margin * 2;
      let y = margin;

      const ensureSpace = (h: number) => {
        if (y + h > pageH - margin) { pdf.addPage(); y = margin; }
      };

      const addText = (text: string, size = 10, style: "normal" | "bold" | "italic" = "normal", gap = 8) => {
        pdf.setFont("helvetica", style);
        pdf.setFontSize(size);
        const lines = pdf.splitTextToSize(text || "", contentWidth) as string[];
        const lh = size * 1.35;
        ensureSpace(lines.length * lh + gap);
        pdf.text(lines, margin, y);
        y += lines.length * lh + gap;
      };

      // ── Report header ────────────────────────────────────────────────────────
      addText(name || t("reportsCodes.exportSections.untitledReport"), 20, "bold", 14);
      addText(`Type: ${reportLabel}`, 10);
      addText(`${t("reportsCodes.exportSections.createdBy")}: ${createdBy}`, 10);
      addText(`${t("reportsCodes.exportSections.created")}: ${row ? fmtDate(row.createdAt) : fmtDate(new Date().toISOString())}`, 10, "normal", 14);

      const description = htmlToPlainText(currentDescriptionHtml() ?? "");
      if (description) {
        addText(t("reportsCodes.exportSections.description"), 14, "bold", 8);
        addText(description, 10, "normal", 14);
      }

      addText(t("reportsCodes.exportSections.summary"), 14, "bold", 8);
      addText(`${t("reportsCodes.panels.users")}: ${visibleUsers}   ${t("reportsCodes.panels.cases")}: ${visibleCases}   ${t("reportsCodes.filterButtons.caseAttributes")}: ${visibleCaseAttrs}   ${t("reportsCodes.panels.documents")}: ${visibleDocs}   ${t("reportsCodes.filterButtons.documentAttributes")}: ${visibleDocAttrs}   ${t("reportsCodes.panels.codes")}: ${visibleCodes}`, 10, "normal", 14);

      // ── Frequencies ──────────────────────────────────────────────────────────
      if (reportKind === "frequencies") {
        if (frequencyExportSections.length === 0) {
          addText(t("reportsCodes.noFrequencyData"), 10, "italic");
        }

        for (const { section, displayBuckets, tableRows, matrix, maxCell } of frequencyExportSections) {
          addText(section.title, 16, "bold", 10);

          // — Table ——————————————————————————————————————————————————————————
          addText(t("reportsCodes.exportSections.frequencyTable"), 12, "bold", 6);
          {
            const cellH = 18;
            const labelColW = Math.min(160, contentWidth * 0.32);
            const numDataCols = displayBuckets.length;
            const dataColW = numDataCols > 0 ? (contentWidth - labelColW) / numDataCols : contentWidth - labelColW;
            const fs = numDataCols > 7 ? 7 : numDataCols > 4 ? 8 : 9;
            const maxLabelChars = Math.max(4, Math.floor(labelColW / (fs * 0.52)));
            const maxDataChars  = Math.max(3, Math.floor(dataColW  / (fs * 0.52)));

            const drawCell = (text: string, x: number, maxChars: number) => {
              pdf.text(trunc(String(text), maxChars), x + 4, y + 13);
            };

            // Header row
            ensureSpace(cellH + 2);
            pdf.setFillColor(225, 228, 234);
            pdf.rect(margin, y, contentWidth, cellH, "F");
            pdf.setDrawColor(175, 180, 190);
            pdf.rect(margin, y, contentWidth, cellH, "S");
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(fs);
            pdf.setTextColor(0, 0, 0);
            drawCell(section.title, margin, maxLabelChars);
            for (let c = 0; c < numDataCols; c++) {
              const cx = margin + labelColW + c * dataColW;
              pdf.line(cx, y, cx, y + cellH);
              drawCell(displayBuckets[c].label, cx, maxDataChars);
            }
            y += cellH;

            // Data rows
            pdf.setFont("helvetica", "normal");
            for (const tRow of tableRows) {
              ensureSpace(cellH);
              pdf.setFillColor(255, 255, 255);
              pdf.rect(margin, y, contentWidth, cellH, "F");
              pdf.setDrawColor(205, 210, 218);
              pdf.rect(margin, y, contentWidth, cellH, "S");
              drawCell(tRow.label, margin, maxLabelChars);
              for (let c = 0; c < numDataCols; c++) {
                const cx = margin + labelColW + c * dataColW;
                pdf.line(cx, y, cx, y + cellH);
                drawCell(String(tRow.values[c] ?? 0), cx, maxDataChars);
              }
              y += cellH;
            }
            y += 14;
          }

          // — Bar chart ————————————————————————————————————————————————————————
          if (tableRows.length > 0 && displayBuckets.length > 0) {
            addText(t("reportsCodes.frequencyViews.chart"), 12, "bold", 6);
            try {
              const svg = buildFreqBarChartSvg(tableRows, displayBuckets, maxCell);
              const png = await svgToPngDataUrl(svg);
              const svgHMatch = svg.match(/height="(\d+)"/);
              const svgH = svgHMatch ? parseInt(svgHMatch[1], 10) : 400;
              const imgH = (svgH / 700) * contentWidth;
              ensureSpace(imgH + 12);
              pdf.addImage(png, "PNG", margin, y, contentWidth, imgH);
              y += imgH + 16;
            } catch { /* skip on canvas failure */ }
          }

          // — Heatmap ——————————————————————————————————————————————————————————
          if (matrix.length > 0 && tableRows.length > 0) {
            addText(t("reportsCodes.frequencyViews.heatmap"), 12, "bold", 6);
            try {
              const svg = buildFreqHeatmapSvg(matrix, tableRows, maxCell);
              const png = await svgToPngDataUrl(svg);
              const wMatch = svg.match(/width="(\d+)"/);
              const hMatch = svg.match(/height="(\d+)"/);
              const svgW = wMatch ? parseInt(wMatch[1], 10) : 700;
              const svgH = hMatch ? parseInt(hMatch[1], 10) : 300;
              const renderW = Math.min(contentWidth, (svgW / 700) * contentWidth);
              const renderH = (svgH / svgW) * renderW;
              ensureSpace(renderH + 12);
              pdf.addImage(png, "PNG", margin, y, renderW, renderH);
              y += renderH + 16;
            } catch { /* skip on canvas failure */ }
          }
        }

      // ── Co-occurrence ────────────────────────────────────────────────────────
      } else {
        if (coOccurrenceSections.length === 0) {
          addText(t("reportsCodes.noCoOccurrenceData"), 10, "italic");
        }

        for (const section of coOccurrenceSections) {
          addText(section.title, 16, "bold", 10);

          // — Single-entity frequency table ————————————————————————————————
          if (section.singleEntityFreq) {
            const { entityLabel, codeCounts } = section.singleEntityFreq;
            addText(t("reportsCodes.exportSections.oneItemSelected", { name: entityLabel }), 10, "italic", 6);

            const cellH = 18;
            const labelColW = Math.round(contentWidth * 0.6);
            const countColW = contentWidth - labelColW;
            const fs = 9;
            const maxLabelChars = Math.max(4, Math.floor(labelColW / (fs * 0.52)));
            const maxCountChars = Math.max(3, Math.floor(countColW / (fs * 0.52)));

            // Header
            ensureSpace(cellH + 2);
            pdf.setFillColor(225, 228, 234);
            pdf.rect(margin, y, contentWidth, cellH, "F");
            pdf.setDrawColor(175, 180, 190);
            pdf.rect(margin, y, contentWidth, cellH, "S");
            pdf.setFont("helvetica", "bold"); pdf.setFontSize(fs); pdf.setTextColor(0, 0, 0);
            pdf.text(trunc("Code", maxLabelChars), margin + 4, y + 13);
            pdf.line(margin + labelColW, y, margin + labelColW, y + cellH);
            pdf.text("Annotations", margin + labelColW + 4, y + 13);
            y += cellH;

            pdf.setFont("helvetica", "normal");
            const maxVal = Math.max(0, ...codeCounts.map((c) => c.count));
            for (const { code, count } of codeCounts) {
              ensureSpace(cellH);
              const [r, g, b] = hexToRgb(heatmapColorStatic(count, maxVal));
              pdf.setFillColor(r, g, b);
              pdf.rect(margin, y, contentWidth, cellH, "F");
              pdf.setDrawColor(205, 210, 218);
              pdf.rect(margin, y, contentWidth, cellH, "S");
              const textGray = count / Math.max(1, maxVal) > 0.55 ? 255 : 31;
              pdf.setTextColor(31, 31, 31);
              pdf.text(trunc(code.label, maxLabelChars), margin + 4, y + 13);
              pdf.line(margin + labelColW, y, margin + labelColW, y + cellH);
              pdf.setTextColor(textGray, textGray, textGray);
              pdf.text(trunc(String(count), maxCountChars), margin + labelColW + 4, y + 13);
              y += cellH;
            }
            y += 14;
            continue;
          }

          // — Co-occurrence matrix (one per matrix in section) ——————————————
          for (const matrix of section.matrices) {
            if (matrix.subtitle) addText(matrix.subtitle, 10, "italic", 6);

            const codes = matrix.codes;
            if (codes.length === 0) {
              addText("Select codes to build the matrix.", 10, "italic", 8);
              continue;
            }

            const cellH = 18;
            const labelColW = Math.min(160, contentWidth * 0.30);
            const numCols = codes.length;
            const dataColW = (contentWidth - labelColW) / numCols;
            const fs = numCols > 8 ? 7 : numCols > 5 ? 8 : 9;
            const maxLabelChars = Math.max(3, Math.floor(labelColW / (fs * 0.52)));
            const maxDataChars  = Math.max(2, Math.floor(dataColW  / (fs * 0.52)));

            const maxCell = Math.max(0, ...matrix.cells.flatMap((row, ri) =>
              row.filter((_, ci) => !(matrix.diagonalEmpty && ri === ci))
            ));

            // Header row
            ensureSpace(cellH + 2);
            pdf.setFillColor(225, 228, 234);
            pdf.rect(margin, y, contentWidth, cellH, "F");
            pdf.setDrawColor(175, 180, 190);
            pdf.rect(margin, y, contentWidth, cellH, "S");
            pdf.setFont("helvetica", "bold"); pdf.setFontSize(fs); pdf.setTextColor(0, 0, 0);
            pdf.text(trunc("Code", maxLabelChars), margin + 4, y + 13);
            for (let c = 0; c < numCols; c++) {
              const cx = margin + labelColW + c * dataColW;
              pdf.line(cx, y, cx, y + cellH);
              pdf.text(trunc(codes[c].label, maxDataChars), cx + 4, y + 13);
            }
            y += cellH;

            // Data rows
            pdf.setFont("helvetica", "normal");
            for (let ri = 0; ri < codes.length; ri++) {
              ensureSpace(cellH);
              // Row background — plain white for label cell
              pdf.setFillColor(255, 255, 255);
              pdf.rect(margin, y, labelColW, cellH, "F");
              pdf.setDrawColor(205, 210, 218);
              pdf.rect(margin, y, contentWidth, cellH, "S");
              pdf.setTextColor(31, 31, 31);
              pdf.text(trunc(codes[ri].label, maxLabelChars), margin + 4, y + 13);

              for (let ci = 0; ci < numCols; ci++) {
                const cx = margin + labelColW + ci * dataColW;
                pdf.line(cx, y, cx, y + cellH);
                const isDiag = matrix.diagonalEmpty && ri === ci;
                const value = matrix.cells[ri]?.[ci] ?? 0;
                if (isDiag) {
                  pdf.setFillColor(235, 235, 237);
                } else {
                  const [r, g, b] = hexToRgb(heatmapColorStatic(value, maxCell));
                  pdf.setFillColor(r, g, b);
                }
                pdf.rect(cx, y, dataColW, cellH, "F");
                // Redraw vertical divider after fill
                pdf.setDrawColor(205, 210, 218);
                pdf.line(cx, y, cx, y + cellH);
                if (!isDiag) {
                  const textGray = value / Math.max(1, maxCell) > 0.55 ? 255 : 31;
                  pdf.setTextColor(textGray, textGray, textGray);
                  pdf.text(trunc(String(value), maxDataChars), cx + 4, y + 13);
                }
              }
              y += cellH;
            }
            y += 14;
          }
        }
      }

      await writeFile(path, new Uint8Array(pdf.output("arraybuffer")));
      await recordReportExport("pdf", path);
    } catch {
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

      const {
        Document: DocxDocument,
        HeadingLevel,
        ImageRun,
        Packer,
        Paragraph,
        ShadingType,
        Table,
        TableCell,
        TableRow,
        TextRun,
        WidthType,
      } = await loadDocx();

      // DOCX content width in DXA (twentieths of a point): letter minus 1-inch margins each side
      const contentDXA = 9360;
      const headerShading = { type: ShadingType.SOLID, color: "E1E4EA", fill: "E1E4EA" };

      function makeTableCell(text: string, widthDXA: number, bold = false, shading?: typeof headerShading) {
        return new TableCell({
          width: { size: widthDXA, type: WidthType.DXA },
          shading,
          children: [new Paragraph({ children: [new TextRun({ text: String(text), bold })] })],
        });
      }

      function buildDocxFreqTable(
        sectionTitle: string,
        tableRows: Array<{ label: string; values: number[] }>,
        displayBuckets: Array<{ label: string }>,
      ) {
        const labelDXA = Math.round(contentDXA * 0.28);
        const numData = displayBuckets.length;
        const dataDXA = numData > 0 ? Math.round((contentDXA - labelDXA) / numData) : contentDXA - labelDXA;
        return new Table({
          width: { size: contentDXA, type: WidthType.DXA },
          rows: [
            new TableRow({
              tableHeader: true,
              children: [
                makeTableCell(sectionTitle, labelDXA, true, headerShading),
                ...displayBuckets.map((b) => makeTableCell(b.label, dataDXA, true, headerShading)),
              ],
            }),
            ...tableRows.map((tRow) => new TableRow({
              children: [
                makeTableCell(tRow.label, labelDXA),
                ...tRow.values.map((v) => makeTableCell(String(v ?? 0), dataDXA)),
              ],
            })),
          ],
        });
      }

      function buildDocxSingleValueTable(
        firstHeader: string,
        secondHeader: string,
        rows: Array<{ label: string; value: string | number }>,
      ) {
        const labelDXA = Math.round(contentDXA * 0.7);
        const valueDXA = contentDXA - labelDXA;
        return new Table({
          width: { size: contentDXA, type: WidthType.DXA },
          rows: [
            new TableRow({
              tableHeader: true,
              children: [
                makeTableCell(firstHeader, labelDXA, true, headerShading),
                makeTableCell(secondHeader, valueDXA, true, headerShading),
              ],
            }),
            ...rows.map((row) => new TableRow({
              children: [
                makeTableCell(row.label, labelDXA),
                makeTableCell(String(row.value), valueDXA),
              ],
            })),
          ],
        });
      }

      function buildDocxCoOccurrenceTable(matrix: CoOccurrenceMatrix) {
        const codes = matrix.codes;
        const labelDXA = Math.round(contentDXA * 0.3);
        const numCols = Math.max(codes.length, 1);
        const dataDXA = Math.round((contentDXA - labelDXA) / numCols);
        const maxCell = Math.max(0, ...matrix.cells.flatMap((row, ri) =>
          row.filter((_value, ci) => !(matrix.diagonalEmpty && ri === ci))
        ));
        return new Table({
          width: { size: contentDXA, type: WidthType.DXA },
          rows: [
            new TableRow({
              tableHeader: true,
              children: [
                makeTableCell("Code", labelDXA, true, headerShading),
                ...codes.map((code) => makeTableCell(code.label, dataDXA, true, headerShading)),
              ],
            }),
            ...codes.map((rowCode, rowIndex) => new TableRow({
              children: [
                makeTableCell(rowCode.label, labelDXA),
                ...codes.map((_colCode, colIndex) => {
                  const isDiag = matrix.diagonalEmpty && rowIndex === colIndex;
                  const value = matrix.cells[rowIndex]?.[colIndex] ?? 0;
                  const hex = isDiag ? "EBEBED" : heatmapColorStatic(value, maxCell).slice(1).toUpperCase();
                  return new TableCell({
                    width: { size: dataDXA, type: WidthType.DXA },
                    shading: { type: ShadingType.SOLID, color: hex, fill: hex },
                    children: [new Paragraph(isDiag ? "" : String(value))],
                  });
                }),
              ],
            })),
          ],
        });
      }

      const children: any[] = [
        new Paragraph({ text: name || t("reportsCodes.exportSections.untitledReport"), heading: HeadingLevel.TITLE }),
        new Paragraph(`Type: ${reportLabel}`),
        new Paragraph(`${t("reportsCodes.exportSections.createdBy")}: ${createdBy}`),
        new Paragraph(`${t("reportsCodes.exportSections.created")}: ${row ? fmtDate(row.createdAt) : fmtDate(new Date().toISOString())}`),
      ];

      const description = htmlToPlainText(currentDescriptionHtml() ?? "");
      const appliedFilters = [
        ...caseFilterDetails.map((detail) => `${t("reportsCodes.panels.cases")}: ${detail}`),
        ...documentFilterDetails.map((detail) => `${t("reportsCodes.panels.documents")}: ${detail}`),
      ];
      if (description) {
        children.push(new Paragraph({ text: t("reportsCodes.exportSections.description"), heading: HeadingLevel.HEADING_1 }));
        for (const line of description.split(/\n+/).filter(Boolean)) children.push(new Paragraph(line));
      }

      children.push(new Paragraph({ text: t("reportsCodes.reportDetails"), heading: HeadingLevel.HEADING_1 }));
      children.push(buildDocxSingleValueTable(t("reportsCodes.exportSections.field"), t("reportsCodes.exportSections.value"), [
        { label: t("reportsCodes.exportSections.selectedCodes"), value: selectedCodeLabels },
        { label: t("reportsCodes.includedCases"), value: includedCaseNames.length > 0 ? includedCaseNames.join(", ") : t("reportsCodes.noCasesSelected") },
        { label: t("reportsCodes.includedDocuments"), value: includedDocumentNames.length > 0 ? includedDocumentNames.join(", ") : t("reportsCodes.noDocumentsSelected") },
        { label: t("reportsCodes.includedUsers"), value: includedUserNames.length > 0 ? includedUserNames.join(", ") : t("reportsCodes.noUsersSelected") },
        ...(appliedFilters.length > 0 ? [{ label: t("reportsCodes.exportSections.appliedFilters"), value: appliedFilters.join(" | ") }] : []),
      ]));
      children.push(new Paragraph(""));

      children.push(new Paragraph({ text: t("reportsCodes.exportSections.summary"), heading: HeadingLevel.HEADING_1 }));
      children.push(buildDocxSingleValueTable(t("reportsCodes.exportSections.item"), t("reportsCodes.exportSections.count"), [
        { label: "Users", value: visibleUsers },
        { label: "Objects", value: visibleCases },
        { label: "Case Attributes", value: visibleCaseAttrs },
        { label: "Sources", value: visibleDocs },
        { label: "Document Attributes", value: visibleDocAttrs },
        { label: "Codes", value: visibleCodes },
      ]));
      children.push(new Paragraph(""));

      // ── Frequencies ────────────────────────────────────────────────────────
      if (reportKind === "frequencies") {
        if (frequencyExportSections.length === 0) {
          children.push(new Paragraph({ children: [new TextRun({ text: t("reportsCodes.noFrequencyData"), italics: true })] }));
        }

        for (const { section, displayBuckets, tableRows, matrix, maxCell } of frequencyExportSections) {
          children.push(new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_1 }));

          // — Table ————————————————————————————————————————————————————————
          children.push(new Paragraph({ children: [new TextRun({ text: t("reportsCodes.exportSections.frequencyTable"), bold: true })] }));
          children.push(buildDocxFreqTable(section.title, tableRows, displayBuckets));
          children.push(new Paragraph(""));

          // — Bar chart ——————————————————————————————————————————————————————
          if (tableRows.length > 0 && displayBuckets.length > 0) {
            children.push(new Paragraph({ children: [new TextRun({ text: t("reportsCodes.frequencyViews.chart"), bold: true })] }));
            try {
              const svg = buildFreqBarChartSvg(tableRows, displayBuckets, maxCell);
              const png = await svgToPngDataUrl(svg);
              const svgHMatch = svg.match(/height="(\d+)"/);
              const nativeH = svgHMatch ? parseInt(svgHMatch[1], 10) : 400;
              const displayW = 480;
              const displayH = Math.round((nativeH / 700) * displayW);
              children.push(new Paragraph({
                children: [new ImageRun({ type: "png", data: pngBytesFromDataUrl(png), transformation: { width: displayW, height: displayH } })],
              }));
            } catch { /* skip on canvas failure */ }
            children.push(new Paragraph(""));
          }

          // — Heatmap ————————————————————————————————————————————————————————
          if (matrix.length > 0 && tableRows.length > 0) {
            children.push(new Paragraph({ children: [new TextRun({ text: t("reportsCodes.frequencyViews.heatmap"), bold: true })] }));
            try {
              const svg = buildFreqHeatmapSvg(matrix, tableRows, maxCell);
              const png = await svgToPngDataUrl(svg);
              const wMatch = svg.match(/width="(\d+)"/);
              const hMatch = svg.match(/height="(\d+)"/);
              const nativeW = wMatch ? parseInt(wMatch[1], 10) : 700;
              const nativeH = hMatch ? parseInt(hMatch[1], 10) : 300;
              const displayW = Math.min(480, nativeW);
              const displayH = Math.round((nativeH / nativeW) * displayW);
              children.push(new Paragraph({
                children: [new ImageRun({ type: "png", data: pngBytesFromDataUrl(png), transformation: { width: displayW, height: displayH } })],
              }));
            } catch { /* skip on canvas failure */ }
            children.push(new Paragraph(""));
          }
        }

      // ── Co-occurrence ────────────────────────────────────────────────────
      } else {
        children.push(new Paragraph({ text: "Co-Occurrence", heading: HeadingLevel.HEADING_1 }));
        if (coOccurrenceSections.length === 0) {
          children.push(new Paragraph({ children: [new TextRun({ text: t("reportsCodes.noCoOccurrenceData"), italics: true })] }));
        } else {
          for (const section of coOccurrenceSections) {
            children.push(new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_2 }));

            if (section.singleEntityFreq) {
              const { entityLabel, codeCounts } = section.singleEntityFreq;
              children.push(new Paragraph({ children: [new TextRun({ text: t("reportsCodes.exportSections.oneItemSelected", { name: entityLabel }), italics: true })] }));
              children.push(buildDocxSingleValueTable(t("reportsCodes.exportSections.code"), t("reportsCodes.singleEntity.annotations"), codeCounts.map((item) => ({
                label: item.code.label,
                value: item.count,
              }))));
              children.push(new Paragraph(""));
              continue;
            }

            for (const matrix of section.matrices) {
              if (matrix.subtitle) {
                children.push(new Paragraph({ children: [new TextRun({ text: matrix.subtitle, italics: true })] }));
              }
              if (matrix.codes.length === 0) {
                children.push(new Paragraph({ children: [new TextRun({ text: "Select codes to build the matrix.", italics: true })] }));
                continue;
              }
              children.push(buildDocxCoOccurrenceTable(matrix));
              children.push(new Paragraph(""));
            }
          }
        }
      }

      const doc = new DocxDocument({
        creator: row?.createdByName || "Kanqual",
        title: name || "Report",
        sections: [{ children }],
      });
      const buffer = await (await Packer.toBlob(doc)).arrayBuffer();
      await writeFile(path, new Uint8Array(buffer));
      await recordReportExport("docx", path);
    } catch {
      setError("DOCX export failed.");
    } finally {
      setExportingFormat(null);
      setShowExportModal(false);
    }
  }

  return (
    <div className="annotate-view">
      <div className="workspace-back-row workspace-back-row--annotate workspace-back-row--split">
        {!hideBackButton && <button className="btn" onClick={onBack}>{t("reportsCodes.backToReports")}</button>}
        <div className="report-action-group" style={{ gap: 10, marginLeft: "auto" }}>
          {error && <span style={{ fontSize: 12, color: "var(--color-danger)" }}>{error}</span>}
        </div>
      </div>

      <div className="annotate-layout ann-report-annotate-layout">
        <div className="annotate-left">
          <div className="annotate-left-title">{t("reportsCodes.panels.includeInReport")}</div>

          {/* Objects */}
          <div className="annotate-card">
            <div className="annotate-card-header" style={{ gap: 8 }}>
              <button className="annotate-card-header" style={{ width: "100%", cursor: "pointer", background: "none", border: "none", padding: 0 }} onClick={() => togglePanel("cases")}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="annotate-card-title">{t("reportsCodes.panels.cases")}{selCaseIds.size > 0 ? ` (${selCaseIds.size})` : ""}</span>
                  <button
                    type="button"
                    className="filter-icon-button filter-icon-button--compact"
                    aria-label={t("reportsCodes.filterButtons.caseAttributes")}
                    title={t("reportsCodes.filterButtons.caseAttributes")}
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
                {!isFrozen && !loadingFilters && caseItems.length > 0 && (
                  <div style={{ padding: "2px 14px 4px", display: "flex", gap: 8 }}>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => applySelectionFromCases(new Set(caseItems.map((item) => item.id)))}>{t("reportsCodes.actions.all")}</button>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => clearPrimarySelections()}>{t("reportsCodes.actions.clear")}</button>
                  </div>
                )}
                <div className="code-list" style={{ padding: 0 }}>
                  {loadingFilters ? (
                    <div className="code-list-empty">{t("reportsCodes.empty.loading")}</div>
                  ) : caseItems.length === 0 ? (
                    <div className="code-list-empty">{t("reportsCodes.empty.noCases")}</div>
                  ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: "var(--text-xs)" }}>
                      <colgroup>
                        <col style={{ width: 24 }} />
                        <col style={{ width: 72 }} />
                        <col />
                      </colgroup>
                      <thead>
                        <tr style={{ color: "var(--color-text-muted)", textAlign: "left" }}>
                          <th aria-label={t("reportsCodes.selectObject")} style={{ padding: "6px 2px 6px 8px", fontWeight: 600 }} />
                          <th style={{ padding: "6px 6px 6px 4px", fontWeight: 600 }}>{t("reportsCodes.typeColumn")}</th>
                          <th style={{ padding: "6px 6px", fontWeight: 600 }}>{t("reportsCodes.titleColumn")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {caseItems.map((item) => {
                          const selected = selCaseIds.has(item.id);
                          return (
                            <tr
                              key={item.id}
                              onClick={isFrozen ? undefined : () => applySelectionFromCases(toggle(selCaseIds, item.id))}
                              style={{ cursor: isFrozen ? "default" : "pointer", background: selected ? "var(--color-surface-hover)" : "transparent" }}
                            >
                              <td style={{ padding: "6px 2px 6px 8px", verticalAlign: "top" }}>
                                <input
                                  type="checkbox"
                                  className="memo-sel-checkbox"
                                  checked={selected}
                                  disabled={isFrozen}
                                  onChange={isFrozen ? undefined : (e) => { e.stopPropagation(); applySelectionFromCases(toggle(selCaseIds, item.id)); }}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </td>
                              <td className="code-label" style={{ padding: "6px 6px 6px 4px", verticalAlign: "top" }}>{formatObjectType(item.objectType)}</td>
                              <td className="code-label" style={{ padding: "6px 6px", verticalAlign: "top" }}>{item.name}</td>
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
                  <span className="annotate-card-title">{t("reportsCodes.panels.documents")}{selDocIds.size > 0 ? ` (${selDocIds.size})` : ""}</span>
                  <button
                    type="button"
                    className="filter-icon-button filter-icon-button--compact"
                    aria-label={t("reportsCodes.filterButtons.documentAttributes")}
                    title={t("reportsCodes.filterButtons.documentAttributes")}
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
                {!isFrozen && documents.length > 0 && (
                  <div style={{ padding: "2px 14px 4px", display: "flex", gap: 8 }}>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => applySelectionFromDocuments(new Set(documents.map((item) => item.id)))}>{t("reportsCodes.actions.all")}</button>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => clearPrimarySelections()}>{t("reportsCodes.actions.clear")}</button>
                  </div>
                )}
                <div className="code-list" style={{ padding: 0 }}>
                  {documents.length === 0 ? (
                    <div className="code-list-empty">{t("reportsCodes.empty.noDocuments")}</div>
                  ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: "var(--text-xs)" }}>
                      <colgroup>
                        <col style={{ width: 24 }} />
                        <col style={{ width: 48 }} />
                        <col />
                      </colgroup>
                      <thead>
                        <tr style={{ color: "var(--color-text-muted)", textAlign: "left" }}>
                          <th aria-label={t("reportsCodes.selectSource")} style={{ padding: "6px 2px 6px 8px", fontWeight: 600 }} />
                          <th style={{ padding: "6px 6px 6px 4px", fontWeight: 600 }}>{t("reportsCodes.typeColumn")}</th>
                          <th style={{ padding: "6px 6px", fontWeight: 600 }}>{t("reportsCodes.titleColumn")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {documents.map((doc) => {
                          const selected = selDocIds.has(doc.id);
                          return (
                            <tr
                              key={doc.id}
                              onClick={isFrozen ? undefined : () => applySelectionFromDocuments(toggle(selDocIds, doc.id))}
                              style={{ cursor: isFrozen ? "default" : "pointer", background: selected ? "var(--color-surface-hover)" : "transparent" }}
                            >
                              <td style={{ padding: "6px 2px 6px 8px", verticalAlign: "top" }}>
                                <input
                                  type="checkbox"
                                  className="memo-sel-checkbox"
                                  checked={selected}
                                  disabled={isFrozen}
                                  onChange={isFrozen ? undefined : (e) => { e.stopPropagation(); applySelectionFromDocuments(toggle(selDocIds, doc.id)); }}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </td>
                              <td className="code-label" style={{ padding: "6px 6px 6px 4px", verticalAlign: "top" }}>{formatSourceType(doc.type)}</td>
                              <td className="code-label" style={{ padding: "6px 6px", verticalAlign: "top" }}>{doc.name}</td>
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
              <span className="annotate-card-title">{t("reportsCodes.panels.relationships")}{selRelationshipIds.size > 0 ? ` (${selRelationshipIds.size})` : ""}</span>
              <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-muted)" }}>{collapsed.has("relationships") ? "▶" : "▼"}</span>
            </button>
            {!collapsed.has("relationships") && (
              <>
                {!isFrozen && !loadingFilters && relationshipItems.length > 0 && (
                  <div style={{ padding: "2px 14px 4px", display: "flex", gap: 8 }}>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => applySelectionFromRelationships(new Set(relationshipItems.filter((relationship) => relationship.object1Id && relationship.object2Id).map((relationship) => relationship.id)))}>{t("reportsCodes.actions.all")}</button>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => clearPrimarySelections()}>{t("reportsCodes.actions.clear")}</button>
                  </div>
                )}
                <div className="code-list" style={{ padding: 0 }}>
                  {loadingFilters ? (
                    <div className="code-list-empty">{t("reportsCodes.empty.loading")}</div>
                  ) : relationshipItems.length === 0 ? (
                    <div className="code-list-empty">{t("reportsCodes.empty.noRelationships")}</div>
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
                          <th aria-label={t("reportsCodes.selectRelationship")} style={{ padding: "6px 2px 6px 8px", fontWeight: 600 }} />
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
                                <span aria-hidden="true">{relationshipSortKey === key ? (relationshipSortDir === "asc" ? "↑" : "↓") : "↕"}</span>
                              </button>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedRelationshipItems.map((relationship) => {
                          const canSelectRelationship = !isFrozen && !!relationship.object1Id && !!relationship.object2Id;
                          const selected = selRelationshipIds.has(relationship.id);
                          return (
                            <tr
                              key={relationship.id}
                              onClick={canSelectRelationship ? () => applySelectionFromRelationships(toggle(selRelationshipIds, relationship.id)) : undefined}
                              style={{ cursor: canSelectRelationship ? "pointer" : "default", background: selected ? "var(--color-surface-hover)" : "transparent" }}
                            >
                              <td style={{ padding: "6px 2px 6px 8px", verticalAlign: "top" }}>
                                <input
                                  type="checkbox"
                                  className="memo-sel-checkbox"
                                  checked={selected}
                                  disabled={!canSelectRelationship}
                                  onChange={canSelectRelationship ? (e) => { e.stopPropagation(); applySelectionFromRelationships(toggle(selRelationshipIds, relationship.id)); } : undefined}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </td>
                              <td className="code-label" style={{ padding: "6px 6px 6px 4px", verticalAlign: "top" }}>{relationshipColumnValue(relationship, "relationshipType")}</td>
                              <td className="code-label" style={{ padding: "6px 6px", verticalAlign: "top" }}>{relationshipColumnValue(relationship, "object1Name")}</td>
                              <td className="code-label" style={{ padding: "6px 6px", verticalAlign: "top" }}>{relationshipColumnValue(relationship, "object2Name")}</td>
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
          <div className="annotate-card annotate-card--featured report-codes-card">
            <button className="annotate-card-header" style={{ width: "100%", cursor: "pointer", background: "none", border: "none" }} onClick={() => togglePanel("codes")}>
              <span className="annotate-card-title">{t("reportsCodes.panels.codes")}{selCodeIds.size > 0 ? ` (${selCodeIds.size})` : ""}</span>
              <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-muted)" }}>{collapsed.has("codes") ? "▶" : "▼"}</span>
            </button>
            {!collapsed.has("codes") && (
              <>
                {!isFrozen && codes.length > 0 && (
                  <div style={{ padding: "2px 14px 4px", display: "flex", gap: 8 }}>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => applySelectionFromCodes(new Set(codes.map((item) => item.id)))}>{t("reportsCodes.actions.all")}</button>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => clearPrimarySelections()}>{t("reportsCodes.actions.clear")}</button>
                  </div>
                )}
                <ul className="code-list" style={{ overflowY: "auto", flex: 1 }}>
                  {codes.length === 0 ? (
                    <li className="code-list-empty">{t("reportsCodes.empty.noCodes")}</li>
                  ) : buildCodeTree(codes).map(({ code, depth }) => (
                    <li
                      key={code.id}
                      className="code-item"
                      style={{ cursor: isFrozen ? "default" : "pointer" }}
                      onClick={isFrozen ? undefined : () => applySelectionFromCodes(toggle(selCodeIds, code.id))}
                    >
                      <input
                        type="checkbox"
                        className="memo-sel-checkbox"
                        checked={selCodeIds.has(code.id)}
                        disabled={isFrozen}
                        onChange={isFrozen ? undefined : (e) => { e.stopPropagation(); applySelectionFromCodes(toggle(selCodeIds, code.id)); }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      {depth > 0 && <span aria-hidden="true" style={{ flex: "0 0 auto", width: depth * 16 }} />}
                      <span className="code-swatch" style={{ background: code.color }} />
                      <span className="code-label">{code.label}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {/* Users */}
          <div className="annotate-card">
            <button className="annotate-card-header" style={{ width: "100%", cursor: "pointer", background: "none", border: "none" }} onClick={() => togglePanel("users")}>
              <span className="annotate-card-title">{t("reportsCodes.panels.users")}{selUserIds.size > 0 ? ` (${selUserIds.size})` : ""}</span>
              <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-muted)" }}>{collapsed.has("users") ? "▶" : "▼"}</span>
            </button>
            {!collapsed.has("users") && (
              <>
                {!isFrozen && !loadingFilters && userItems.length > 0 && (
                  <div style={{ padding: "2px 14px 4px", display: "flex", gap: 8 }}>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => applySelectionFromUsers(new Set(userItems.map((item) => item.id)))}>{t("reportsCodes.actions.all")}</button>
                    <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => clearPrimarySelections()}>{t("reportsCodes.actions.clear")}</button>
                  </div>
                )}
                <ul className="code-list" style={{ overflowY: "auto", flex: 1 }}>
                  {loadingFilters ? (
                    <li className="code-list-empty">{t("reportsCodes.empty.loading")}</li>
                  ) : userItems.length === 0 ? (
                    <li className="code-list-empty">{t("reportsCodes.empty.noUsers")}</li>
                  ) : userItems.map((item) => (
                    <li
                      key={item.id}
                      className="code-item"
                      style={{ cursor: isFrozen ? "default" : "pointer" }}
                      onClick={isFrozen ? undefined : () => applySelectionFromUsers(toggle(selUserIds, item.id))}
                    >
                      <input
                        type="checkbox"
                        className="memo-sel-checkbox"
                        checked={selUserIds.has(item.id)}
                        disabled={isFrozen}
                        onChange={isFrozen ? undefined : (e) => { e.stopPropagation(); applySelectionFromUsers(toggle(selUserIds, item.id)); }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="code-label">{item.name}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

        </div>

        <div
          className="annotate-main"
          style={{ overflowY: "auto", gap: 10, flexDirection: "column", display: "flex", paddingTop: 2, paddingBottom: 2 }}
        >
          <div className="annotate-card" style={{ flexShrink: 0 }}>
            <div className="annotate-card-header" style={{ gap: 10 }}>
              <span className="annotate-card-title">{t("reportsCodes.reportTitle")}</span>
              <div className="report-action-group" style={{ gap: 8, marginLeft: "auto" }}>
                <button
                  type="button"
                  className="btn btn--secondary project-table-header-icon-button report-title-action-button"
                  title={
                    !isFrozen
                      ? t("reportsCodes.exportSavedOnly")
                      : !canExportReports
                        ? t("reportsCodes.exportDenied")
                        : t("reportsCodes.exportTitle")
                  }
                  disabled={!isFrozen || !canExportReports}
                  onClick={() => setShowExportModal(true)}
                  aria-label={t("reportsCodes.export")}
                >
                  <DownloadIcon className="project-table-header-icon" />
                </button>
                {isFrozen && onUseSettings && canStartReports ? (
                  <button
                    type="button"
                    className="btn btn--secondary project-table-header-icon-button report-title-action-button"
                    onClick={() => onUseSettings(row!.snapshot.settings)}
                    title={t("reportsCodes.newFromSettings")}
                    aria-label={t("reportsCodes.newFromSettings")}
                  >
                    <RestartListIcon className="project-table-header-icon" />
                  </button>
                ) : null}
                {!isFrozen ? (
                  <button
                    type="button"
                    className="btn btn--primary project-table-header-icon-button report-title-action-button"
                    onClick={handleSave}
                    disabled={saving || !canStartReports}
                    title={saving ? t("reportsCodes.actions.saving") : t("reportsCodes.actions.save")}
                    aria-label={saving ? t("reportsCodes.actions.saving") : t("reportsCodes.actions.save")}
                  >
                    <SaveIcon className="project-table-header-icon" />
                  </button>
                ) : null}
              </div>
            </div>
            <div style={{ padding: "10px 14px" }}>
              <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("reportsCodes.reportNamePlaceholder")} autoFocus={!isFrozen} disabled={isFrozen} />
            </div>
          </div>

          <div className="annotate-card" style={{ flexShrink: 0 }}>
            <div className="annotate-card-header"><span className="annotate-card-title">{t("reportsCodes.reportDetails")}</span></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 14px", fontSize: 13 }}>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                <span>
                  <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>{t("reportsCodes.summary.type")} </span>
                  <span>{reportLabel}</span>
                </span>
                <span>
                  <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>{t("reportsCodes.summary.createdBy")} </span>
                  <span>{createdBy}</span>
                </span>
                <span>
                  <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>{t("reportsCodes.summary.created")} </span>
                  <span>{row ? fmtDate(row.createdAt) : "-"}</span>
                </span>
              </div>
              <div>
                <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>{t("reportsCodes.selectedCodes")} </span>
                <span>{selectedCodeLabels}</span>
              </div>
            </div>
          </div>

          <div className="annotate-card" style={{ flexShrink: 0 }}>
            <div className="annotate-card-header">
              <span className="annotate-card-title">{t("reportsCodes.reportDescription")}</span>
              <button
                className="btn btn--small"
                onClick={() => setShowDescription((prev) => !prev)}
                aria-pressed={showDescription}
                disabled={isFrozen}
              >
                {showDescription ? t("reportsCodes.exportSections.removeDescription") : t("reportsCodes.exportSections.addDescription")}
              </button>
            </div>
            {showDescription && descriptionEditor && (
              <>
                {!isFrozen && <div className="report-description-toolbar" style={{ padding: "6px 10px", borderBottom: "1px solid var(--color-border)" }}>
                  <button className={`rte-btn${descriptionEditor.isActive("bold") ? " rte-btn--active" : ""}`} onMouseDown={(e) => { e.preventDefault(); descriptionEditor.chain().focus().toggleBold().run(); }} title={t("reportsCodes.richText.bold")}>B</button>
                  <button className={`rte-btn${descriptionEditor.isActive("italic") ? " rte-btn--active" : ""}`} onMouseDown={(e) => { e.preventDefault(); descriptionEditor.chain().focus().toggleItalic().run(); }} title={t("reportsCodes.richText.italic")}><em>I</em></button>
                  <button className={`rte-btn${descriptionEditor.isActive("strike") ? " rte-btn--active" : ""}`} onMouseDown={(e) => { e.preventDefault(); descriptionEditor.chain().focus().toggleStrike().run(); }} title={t("reportsCodes.richText.strikethrough")}><s>S</s></button>
                  <span className="rte-divider" />
                  <button className={`rte-btn${descriptionEditor.isActive("bulletList") ? " rte-btn--active" : ""}`} onMouseDown={(e) => { e.preventDefault(); descriptionEditor.chain().focus().toggleBulletList().run(); }} title={t("reportsCodes.richText.bulletList")}>-</button>
                  <button className={`rte-btn${descriptionEditor.isActive("orderedList") ? " rte-btn--active" : ""}`} onMouseDown={(e) => { e.preventDefault(); descriptionEditor.chain().focus().toggleOrderedList().run(); }} title={t("reportsCodes.richText.numberedList")}>1.</button>
                  <span className="rte-divider" />
                  <button className={`rte-btn${descriptionEditor.isActive("blockquote") ? " rte-btn--active" : ""}`} onMouseDown={(e) => { e.preventDefault(); descriptionEditor.chain().focus().toggleBlockquote().run(); }} title={t("reportsCodes.richText.blockquote")}>"</button>
                </div>}
                <EditorContent editor={descriptionEditor} />
              </>
            )}
          </div>

          <div className="annotate-card" style={{ flexShrink: 0 }}>
            <div className="annotate-card-header">
              <span className="annotate-card-title">{t("reportsCodes.filtersTitle")}</span>
            </div>
            <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
              {!hasActiveFilters ? (
                <div style={{ color: "var(--color-text-muted)" }}>{t("reportsCodes.allSelectedObjectsAndSources")}</div>
              ) : (
                <>
                  {activeCaseFilterDetails.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ fontWeight: 600 }}>{t("reportsCodes.panels.cases")}</div>
                      {activeCaseFilterDetails.map((detail) => (
                        <div key={`case-filter-${detail}`} style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                          {detail}
                        </div>
                      ))}
                    </div>
                  )}
                  {activeDocumentFilterDetails.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ fontWeight: 600 }}>{t("reportsCodes.panels.documents")}</div>
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

          <div style={{ display: "flex", gap: 10, flexShrink: 0, alignItems: "stretch" }}>
            {selectedSummaryCards.map((item) => (
              <button
                key={item.key}
                className="annotate-card"
                onClick={() => toggleSummaryCard(item.key)}
                aria-expanded={expandedSummaryCards.has(item.key)}
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
                <div className="summary-card-value">{item.value}</div>
                <div className="summary-card-label">
                  {item.label}
                  <span style={{ marginLeft: 6, fontSize: 10, color: "var(--color-text-muted)" }}>
                    {expandedSummaryCards.has(item.key) ? "v" : ">"}
                  </span>
                </div>
                {expandedSummaryCards.has(item.key) && (
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
                    {item.items.length === 0 ? (
                      <div style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center" }}>
                        {t("reportsCodes.noneIncluded")}
                      </div>
                    ) : item.items.map((included) => (
                      <div
                        key={`${item.key}-${included.id}`}
                        style={{
                          fontSize: 12,
                          lineHeight: 1.4,
                          overflow: "hidden",
                          padding: "2px 0",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {included.name}
                      </div>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>

          {reportKind === "frequencies" ? frequencySections.map((section) => (
            <FrequencyReportCard
              key={section.key}
              section={section}
              codeBuckets={codeBuckets}
              codes={codes}
              annotations={selectedAnnotations}
              frozenRows={frozenSnapshot?.frozenFrequencyRows?.filter((rowItem) => rowItem.section === section.title)}
            />
          )) : coOccurrenceSections.map((section) => (
            <CoOccurrenceMatrixCard key={section.key} section={section} codes={codes} />
          ))}
        </div>
      </div>
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

      {showCaseAttributeFilters && (
        <SettingsModal title={t("reportsCodes.filters.caseTitle")} onClose={() => setShowCaseAttributeFilters(false)} modalClassName="modal--wide">
          <div className="app-settings-modal-body">
            {!isFrozen && !loadingFilters && caseTypeOptions.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{t("reportsCodes.objectType")}</div>
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
            {!isFrozen && !loadingFilters && caseAttributeItems.length > 0 && (
              <div style={{ paddingBottom: 8, display: "flex", gap: 8 }}>
                <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={selectAllCaseAttributes}>{t("reportsCodes.actions.all")}</button>
                <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={clearCaseAttributeSelections}>{t("reportsCodes.actions.clear")}</button>
              </div>
            )}
            <ul className="code-list">
              {loadingFilters ? (
                <li className="code-list-empty">{t("reportsCodes.empty.loading")}</li>
              ) : caseAttributeItems.length === 0 ? (
                <li className="code-list-empty">{t("reportsCodes.empty.noCaseAttributes")}</li>
              ) : caseAttributeItems.map((item) => (
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
                    onChange={isFrozen ? undefined : (e) => {
                      e.stopPropagation();
                      toggleCaseAttributeSelection(item);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="code-label">{item.name}</span>
                  <span className="users-filter-count">{getAttributeTypeLabel(t, item.dataType)}</span>
                </li>
              ))}
            </ul>
            {renderAttributeFilterEditors(
              caseAttributeItems,
              selCaseAttrIds,
              caseAttributeFilters,
              caseAttributeValueStats,
              updateCaseAttributeFilter,
            )}
          </div>
        </SettingsModal>
      )}

      {showDocumentAttributeFilters && (
        <SettingsModal title={t("reportsCodes.filters.documentTitle")} onClose={() => setShowDocumentAttributeFilters(false)} modalClassName="modal--wide">
          <div className="app-settings-modal-body">
            {!isFrozen && !loadingFilters && documentTypeOptions.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{t("reportsCodes.sourceType")}</div>
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
                        {documents.filter((doc) => formatSourceType(doc.type) === typeLabel).length}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!isFrozen && !loadingFilters && documentAttributeItems.length > 0 && (
              <div style={{ paddingBottom: 8, display: "flex", gap: 8 }}>
                <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={selectAllDocumentAttributes}>{t("reportsCodes.actions.all")}</button>
                <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={clearDocumentAttributeSelections}>{t("reportsCodes.actions.clear")}</button>
              </div>
            )}
            <ul className="code-list">
              {loadingFilters ? (
                <li className="code-list-empty">{t("reportsCodes.empty.loading")}</li>
              ) : documentAttributeItems.length === 0 ? (
                <li className="code-list-empty">{t("reportsCodes.empty.noDocumentAttributes")}</li>
              ) : documentAttributeItems.map((item) => (
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
                    onChange={isFrozen ? undefined : (e) => {
                      e.stopPropagation();
                      toggleDocumentAttributeSelection(item);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="code-label">{item.name}</span>
                  <span className="users-filter-count">{getAttributeTypeLabel(t, item.dataType)}</span>
                </li>
              ))}
            </ul>
            {renderAttributeFilterEditors(
              documentAttributeItems,
              selDocAttrIds,
              documentAttributeFilters,
              documentAttributeValueStats,
              updateDocumentAttributeFilter,
            )}
          </div>
        </SettingsModal>
      )}
    </div>
  );
}

export type CodesViewProps = {
  initialNewModalOpen?: boolean;
  initialNewReportKind?: CodeReportKind;
  initialSavedReport?: CodeReportRow | null;
  postgresProjectId?: string;
  onBackToReports?: () => void;
};

export function CodesView({ initialNewModalOpen = false, initialNewReportKind, initialSavedReport = null, postgresProjectId, onBackToReports }: CodesViewProps = {}) {
  const { t } = useI18n();
  const codeReportColumns = getCodeReportColumns(t);
  const canCreateReports = true;
  const canDeleteReports = true;

  const [showNewModal, setShowNewModal] = useState(initialNewModalOpen && !initialNewReportKind);
  const [newReportKind, setNewReportKind] = useState<CodeReportKind | null>(initialNewReportKind ?? null);
  const [openSavedRow, setOpenSavedRow] = useState<CodeReportRow | null>(initialSavedReport);
  const [newFromSettings, setNewFromSettings] = useState<CodeReportSettings | null>(null);
  const [rows, setRows] = useState<CodeReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<CodeReportSortCol>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; row: CodeReportRow } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuStyle = useViewportContextMenuStyle(contextMenu, contextMenuRef);
  const [confirmDelete, setConfirmDelete] = useState<CodeReportRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const loadReports = useCallback(async () => {
    if (!postgresProjectId) return [];
    setLoading(true);
    setError(null);
    try {
      const records = await listPostgresReports(postgresProjectId);
      const mappedRows = records
        .filter((record) => record.reportType === "code-report")
        .map((record) => {
          try {
            const snapshot = JSON.parse(record.contentJson || "") as CodeReportSnapshot;
            if (snapshot?.reportType !== "code-report") return null;
            return {
              id: record.id,
              name: record.title,
              createdByName: record.createdByName || "-",
              createdAt: record.createdAt,
              snapshot,
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean) as CodeReportRow[];
      setRows(mappedRows);
      return mappedRows;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("reportsCodes.errors.loadReports"));
      return [];
    } finally {
      setLoading(false);
    }
  }, [postgresProjectId, t]);

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
    const aValue = sortCol === "kind" ? getCodeReportLabel(t, a.snapshot.kind) : String(a[sortCol]);
    const bValue = sortCol === "kind" ? getCodeReportLabel(t, b.snapshot.kind) : String(b[sortCol]);
    const cmp = aValue.localeCompare(bValue, undefined, { sensitivity: "base" });
    return sortDir === "asc" ? cmp : -cmp;
  });

  function handleSort(col: CodeReportSortCol) {
    if (col === sortCol) setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleteLoading(true);
    try {
      if (!postgresProjectId) throw new Error(t("reportsCommon.projectWorkspaceRequired"));
      await deletePostgresReport(postgresProjectId, confirmDelete.id);
      setRows((prev) => prev.filter((row) => row.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("reportsCodes.errors.deleteReport"));
      setConfirmDelete(null);
    } finally {
      setDeleteLoading(false);
    }
  }

  if (newReportKind || newFromSettings) {
    return (
      <CodeReportCreationPage
        kind={newFromSettings?.kind ?? newReportKind ?? "frequencies"}
        initialSettings={newFromSettings ?? undefined}
        postgresProjectId={postgresProjectId}
        hideBackButton={!!onBackToReports}
        onBack={() => {
          if (onBackToReports) {
            onBackToReports();
            return;
          }
          setNewReportKind(null);
          setNewFromSettings(null);
        }}
        onSaved={(row) => {
          setNewReportKind(null);
          setNewFromSettings(null);
          setRows((prev) => [row, ...prev.filter((item) => item.id !== row.id)]);
          setOpenSavedRow(row);
        }}
      />
    );
  }

  if (openSavedRow) {
    return (
      <CodeReportCreationPage
        kind={openSavedRow.snapshot.kind}
        row={openSavedRow}
        postgresProjectId={postgresProjectId}
        hideBackButton={!!onBackToReports}
        onBack={() => {
          if (onBackToReports) {
            onBackToReports();
            return;
          }
          setOpenSavedRow(null);
        }}
        onUseSettings={(settings) => {
          setOpenSavedRow(null);
          setNewFromSettings(settings);
        }}
      />
    );
  }

  return (
    <div className="view users-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>{t("reportsCodes.title")}</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            aria-label={t("reportsCodes.openHelp")}
            title={t("reportsCodes.openHelp")}
            onClick={() => setHelpOpen(true)}
          >
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
        <button
          className="btn btn--primary"
          onClick={() => setShowNewModal(true)}
          disabled={!canCreateReports}
          title={!canCreateReports ? t("reportsCodes.newReportDenied") : undefined}
        >
          {t("reportsCodes.newReport")}
        </button>
      </header>

      {error && <p className="users-error">{error}</p>}

      <div className="users-content">
        <section className="users-layout-main">
          <div className="users-table-wrap" style={{ maxHeight: 34 + (Math.max(loading || sorted.length === 0 ? 1 : sorted.length, 1) + 2) * 36 }}>
            <table className="users-table">
              <thead>
                <tr>
                  {codeReportColumns.map((col) => (
                    <th
                      key={col.key}
                      style={{ width: col.width }}
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
                {loading && <tr><td colSpan={4} className="users-td-msg">{t("reportsCodes.loading")}</td></tr>}
                {!loading && sorted.length === 0 && <tr><td colSpan={4} className="users-td-msg">{t("reportsCodes.noReports")}</td></tr>}
                {!loading && sorted.map((row) => (
                  <tr
                    key={row.id}
                    className="users-row"
                    onClick={() => setOpenSavedRow(row)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, row });
                    }}
                  >
                    <td className="users-td users-td--name">{row.name}</td>
                    <td className="users-td users-td--muted">{getCodeReportLabel(t, row.snapshot.kind)}</td>
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
        <SettingsModal title={t("reportsCodes.help.title")} onClose={() => setHelpOpen(false)} modalClassName="modal--help">
          <div className="app-settings-modal-body">
            <p className="users-guide-copy">
              {t("reportsCodes.help.line1")}
            </p>
            <p className="users-guide-copy">
              {t("reportsCodes.help.line2")}
            </p>
            <p className="users-guide-copy">
              {t("reportsCodes.help.line3")}
            </p>
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>
              {t("reportsCodes.close")}
            </button>
          </div>
        </SettingsModal>
      )}

      {contextMenu && (
        <div ref={contextMenuRef} className="context-menu" style={contextMenuStyle}>
          <button className="context-menu-item" onClick={() => { setOpenSavedRow(contextMenu.row); setContextMenu(null); }}>{t("reportsCodes.openReport")}</button>
          {canDeleteReports ? (
            <button className="context-menu-item context-menu-item--danger" onClick={() => { setConfirmDelete(contextMenu.row); setContextMenu(null); }}>{t("reportsCodes.deleteReport")}</button>
          ) : (
            <div className="context-menu-item context-menu-item--disabled" title={t("reportsCodes.deleteDenied")}>{t("reportsCodes.deleteReport")}</div>
          )}
        </div>
      )}

      {confirmDelete && (
        <SettingsModal title={t("reportsCodes.deleteTitle")} onClose={() => setConfirmDelete(null)} closeDisabled={deleteLoading}>
          <div className="app-settings-modal-body">
            <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
              {t("reportsCodes.deleteBody", { name: confirmDelete.name })}
            </p>
            <p className="modal-warning-text">{t("reportsCodes.deleteWarning")}</p>
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button className="btn" onClick={() => setConfirmDelete(null)} disabled={deleteLoading}>{t("reportsCodes.cancel")}</button>
            <button className="btn btn--danger" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading ? t("reportsCodes.deleting") : t("reportsCodes.deleteReport")}
            </button>
          </div>
        </SettingsModal>
      )}

      {showNewModal && (
        <NewCodeReportModal
          onClose={() => setShowNewModal(false)}
          onSelect={(kind) => {
            setShowNewModal(false);
            setNewReportKind(kind);
          }}
        />
      )}
    </div>
  );
}

