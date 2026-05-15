import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useStore } from "../context/StoreContext";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  Document as DocxDocument,
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
} from "docx";
import { jsPDF } from "jspdf";
import ExcelJS from "exceljs";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import type { Annotation, Code, Document as ProjectDocument } from "../types";
import { FilterIcon } from "../components/FilterIcon";
import helpIcon from "../assets/ic_help_outline_24px.svg";

type CodeReportKind = "frequencies" | "summary";
type CodeReportSortCol = "name" | "kind" | "createdByName" | "createdAt";
type SortDir = "asc" | "desc";

interface CaseItem {
  id: string;
  name: string;
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

interface CoOccurrenceMatrix {
  id: string;
  subtitle?: string;
  diagonalEmpty?: boolean;
  codes: CoOccurrenceCode[];
  cells: number[][];
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
  caseAttributeIds: string[];
  documentAttributeIds: string[];
  codeIds: string[];
  userIds: string[];
  caseAttributeFilters?: Record<string, AttributeFilterConfig>;
  documentAttributeFilters?: Record<string, AttributeFilterConfig>;
}

interface CodeReportSnapshot {
  reportType: "code-report";
  kind: CodeReportKind;
  settings: CodeReportSettings;
  caseItems: CaseItem[];
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

interface CodeReportRow {
  id: string;
  name: string;
  createdByName: string;
  createdAt: string;
  snapshot: CodeReportSnapshot;
}

type FrequencyViewMode = "table" | "chart" | "matrix";

const FREQUENCY_VIEW_OPTIONS: Array<{ key: FrequencyViewMode; label: string }> = [
  { key: "table", label: "Table" },
  { key: "chart", label: "Bar Chart" },
  { key: "matrix", label: "Heatmap" },
];

const REPORT_LABELS: Record<CodeReportKind, string> = {
  frequencies: "Code Frequencies",
  summary: "Code Co-Occurrance",
};

const CODE_REPORT_COLS: { key: CodeReportSortCol; label: string; width: string }[] = [
  { key: "name", label: "Name", width: "34%" },
  { key: "kind", label: "Type", width: "22%" },
  { key: "createdByName", label: "Created By", width: "22%" },
  { key: "createdAt", label: "Created", width: "22%" },
];

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

function relationPreview(ids: string[]): string[] {
  return ids.slice(0, 100);
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

function fmtDate(iso?: string): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString(undefined, {
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

function visibleCodeNodes(tree: CodeTreeNode[], collapsed: Set<string>): CodeTreeNode[] {
  const result: CodeTreeNode[] = [];
  const collapseStack: number[] = [];

  for (const node of tree) {
    while (collapseStack.length > 0 && node.depth <= collapseStack[collapseStack.length - 1]) {
      collapseStack.pop();
    }
    if (collapseStack.length > 0) continue;

    result.push(node);
    if (node.hasChildren && collapsed.has(node.code.id)) {
      collapseStack.push(node.depth);
    }
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

function ancestorAtDepth(codeId: string, targetDepth: number, codeById: Map<string, Code>, depthById: Map<string, number>): Code | null {
  let current = codeById.get(codeId);
  while (current && (depthById.get(current.id) ?? 0) > targetDepth) {
    current = current.parentId ? codeById.get(current.parentId) : undefined;
  }
  return current ?? null;
}

function FrequencyReportCard({
  section,
  codeBuckets,
  annotations,
  frozenRows,
}: {
  section: FrequencySection;
  codeBuckets: FrequencyCodeBucket[];
  annotations: Annotation[];
  frozenRows?: FrozenFrequencyRow[];
}) {
  const [viewMode, setViewMode] = useState<FrequencyViewMode>("table");
  const annotationById = useMemo(() => new Map(annotations.map((ann) => [ann.id, ann])), [annotations]);
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
        color: codeBuckets.find((bucket) => bucket.label === label)?.color ?? "var(--color-primary)",
        codeIds: new Set<string>(),
      }))
    : codeBuckets;
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

  return (
    <div className="annotate-card" style={{ flexShrink: 0 }}>
      <div className="annotate-card-header">
        <span className="annotate-card-title">{section.title}</span>
        <div role="tablist" aria-label={`${section.title} frequency view`} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {FREQUENCY_VIEW_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={viewMode === option.key}
              className={`btn btn--small${viewMode === option.key ? " btn--primary" : ""}`}
              onClick={() => setViewMode(option.key)}
              style={{
                fontSize: 11,
                fontWeight: viewMode === option.key ? 700 : 500,
                padding: "3px 8px",
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
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
                  <tr><td colSpan={displayBuckets.length + 1} className="users-td-msg">No selected items.</td></tr>
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
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {tableRows.length === 0 || displayBuckets.length === 0 ? (
              <div className="users-td-msg">No selected items.</div>
            ) : tableRows.map((row) => (
              <div key={`${row.id}-bar`} style={{ display: "grid", gridTemplateColumns: "minmax(90px, 28%) 1fr", gap: 10, alignItems: "end", fontSize: 12 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", alignSelf: "center" }}>{row.label}</span>
                <div style={{ display: "flex", gap: 8, alignItems: "end", minHeight: 86, borderBottom: "1px solid var(--color-border)", paddingTop: 4 }}>
                  {row.values.map((value, index) => (
                    <div
                      key={`${row.id}-${displayBuckets[index].id}-bar`}
                      title={`${displayBuckets[index].label}: ${value}`}
                      style={{ flex: 1, minWidth: 26, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}
                    >
                      <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{value}</span>
                      <div
                        style={{
                          width: "100%",
                          maxWidth: 34,
                          height: maxCell > 0 ? Math.max(4, (value / maxCell) * 58) : 0,
                          borderRadius: "4px 4px 0 0",
                          background: displayBuckets[index].color,
                        }}
                      />
                      <span style={{ maxWidth: 58, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-text-muted)", fontSize: 10 }}>
                        {displayBuckets[index].label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {viewMode === "matrix" && (
          <div className="users-table-wrap" style={{ margin: 0, maxWidth: "none", borderRadius: 6, maxHeight: 280 }}>
            <table className="users-table">
              <thead>
                <tr>
                  <th className="users-th" style={{ minWidth: 160 }}>Code</th>
                  {tableRows.map((row) => (
                    <th key={row.id} className="users-th" style={{ minWidth: 110 }}>{row.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.length === 0 ? (
                  <tr><td colSpan={tableRows.length + 1} className="users-td-msg">Select codes to build the matrix.</td></tr>
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

function CoOccurrenceMatrixCard({ section }: { section: CoOccurrenceSection }) {
  if (section.singleEntityFreq) {
    const { entityLabel, codeCounts } = section.singleEntityFreq;
    return (
      <div className="annotate-card" style={{ flexShrink: 0 }}>
        <div className="annotate-card-header">
          <span className="annotate-card-title">{section.title}</span>
        </div>
        <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            Only one item selected — showing code frequencies for <strong>{entityLabel}</strong>.
          </div>
          <div className="users-table-wrap" style={{ margin: 0, maxWidth: "none", borderRadius: 6, maxHeight: 300 }}>
            <table className="users-table">
              <thead>
                <tr>
                  <th className="users-th" style={{ minWidth: 160 }}>Code</th>
                  <th className="users-th" style={{ minWidth: 100 }}>Annotations</th>
                </tr>
              </thead>
              <tbody>
                {codeCounts.length === 0 ? (
                  <tr><td colSpan={2} className="users-td-msg">Select codes to see frequencies.</td></tr>
                ) : codeCounts.map(({ code, count }) => (
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
        <span className="annotate-card-title">{section.title}</span>
      </div>
      <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 16 }}>
        {section.matrices.length === 0 ? (
          <div className="users-td-msg">Select codes to build the matrix.</div>
        ) : section.matrices.map((matrix) => {
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
                      <th className="users-th" style={{ minWidth: 150 }}>Code</th>
                      {matrix.codes.map((code) => (
                        <th key={code.id} className="users-th" style={{ minWidth: 110 }}>{code.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.codes.length === 0 ? (
                      <tr><td colSpan={matrix.codes.length + 1} className="users-td-msg">Select codes to build the matrix.</td></tr>
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
                          return (
                            <td
                              key={`${rowCode.id}-${colCode.id}`}
                              className="users-td"
                              style={{
                                background: emptyCell ? "var(--color-surface-muted, #f4f4f5)" : heatmapColor(value, maxCell),
                                color: value > 0 && !emptyCell ? "var(--color-text)" : "var(--color-text-muted)",
                                textAlign: "center",
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
      description: "Exports metadata, report visuals, and detailed code-report results into a structured Excel workbook.",
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

function CodeHierarchySelectionPanel({
  codes,
  selectedIds,
  onChange,
  disabled = false,
  className,
  showAllClear = false,
}: {
  codes: Code[];
  selectedIds: Set<string>;
  onChange: (ids: Set<string>) => void;
  disabled?: boolean;
  className?: string;
  showAllClear?: boolean;
}) {
  const [collapsedCodes, setCollapsedCodes] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildCodeTree(codes), [codes]);
  const visible = useMemo(() => visibleCodeNodes(tree, collapsedCodes), [tree, collapsedCodes]);

  function toggleCollapse(id: string) {
    setCollapsedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleCodeClick(code: Code) {
    if (disabled) return;
    const next = new Set(selectedIds);
    if (next.has(code.id)) next.delete(code.id);
    else next.add(code.id);
    onChange(next);
  }

  return (
    <div className={`annotate-card${className ? ` ${className}` : ""}`}>
      <div className="annotate-card-header">
        <span className="annotate-card-title">Codes{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}</span>
      </div>
      {showAllClear && !disabled && codes.length > 0 && (
        <div style={{ padding: "2px 14px 4px", display: "flex", gap: 8 }}>
          <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => onChange(new Set(codes.map((item) => item.id)))}>All</button>
          <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => onChange(new Set())}>Clear</button>
        </div>
      )}
      <ul className="code-list" style={{ overflowY: "auto", flex: 1 }}>
        {codes.length === 0 ? (
          <li className="code-list-empty">No codes.</li>
        ) : visible.map(({ code, depth, hasChildren }) => (
          <li
            key={code.id}
            className="code-item"
            style={{ cursor: disabled ? "default" : "pointer", paddingLeft: 6 + depth * 16 }}
            onClick={() => handleCodeClick(code)}
          >
            {hasChildren ? (
              <button
                type="button"
                className="code-collapse-btn"
                onClick={(e) => { e.stopPropagation(); toggleCollapse(code.id); }}
                title={collapsedCodes.has(code.id) ? "Expand" : "Collapse"}
              >
                {collapsedCodes.has(code.id) ? "▶" : "▼"}
              </button>
            ) : (
              <span className="code-collapse-spacer" />
            )}
            <input
              type="checkbox"
              className="memo-sel-checkbox"
              checked={selectedIds.has(code.id)}
              disabled={disabled}
              onChange={(e) => { e.stopPropagation(); handleCodeClick(code); }}
              onClick={(e) => e.stopPropagation()}
            />
            <span className="code-swatch" style={{ background: code.color }} />
            <span className="code-label">{code.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SelectionPanel({
  title,
  count,
  collapsed,
  onToggleCollapsed,
  selectAll,
  disabled = false,
  headerExtra,
  children,
}: {
  title: string;
  count: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  selectAll?: {
    checked: boolean;
    disabled?: boolean;
    onToggle: () => void;
  };
  disabled?: boolean;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="annotate-card">
      <button
        className="annotate-card-header"
        style={{ width: "100%", cursor: "pointer", background: "none", border: "none" }}
        onClick={onToggleCollapsed}
      >
        <span style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
          <span className="annotate-card-title">{title}{count > 0 ? ` (${count})` : ""}</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {headerExtra}
          <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-muted)" }}>{collapsed ? "▶" : "▼"}</span>
        </span>
      </button>
      {!collapsed && selectAll && !disabled && !selectAll.disabled && (
        <div style={{ padding: "2px 14px 4px", display: "flex", gap: 8 }}>
          <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={(e) => { e.stopPropagation(); if (!selectAll.checked) selectAll.onToggle(); }}>All</button>
          <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={(e) => { e.stopPropagation(); if (selectAll.checked) selectAll.onToggle(); }}>Clear</button>
        </div>
      )}
      {!collapsed && children}
    </div>
  );
}

function NewCodeReportModal({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (kind: CodeReportKind) => void;
}) {
  const options = [
    {
      key: "frequencies",
      label: "Code Frequencies",
      description: "Compare how often codes appear across cases, documents, or coders with tables, charts, and heatmaps.",
      onClick: () => onSelect("frequencies"),
    },
    {
      key: "summary",
      label: "Code Co-Occurrance",
      description: "Explore how codes appear together across your data using co-occurrence matrices and summaries.",
      onClick: () => onSelect("summary"),
    },
  ] as const;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0, marginBottom: 16 }}>New Report</h2>
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
        <div className="form-actions" style={{ marginTop: 20 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function CodeReportCreationPage({
  kind,
  row,
  initialSettings,
  onBack,
  onSaved,
  onUseSettings,
}: {
  kind: CodeReportKind;
  row?: CodeReportRow;
  initialSettings?: CodeReportSettings;
  onBack: () => void;
  onSaved?: (row: CodeReportRow) => void;
  onUseSettings?: (settings: CodeReportSettings) => void;
}) {
  const { pb, activeProject, documents: storeDocuments, codes: storeCodes, createCodeReport, canCurrentUser } = useStore();
  const { user: currentUser } = useAuth();
  const isFrozen = !!row;
  const canCreateReports = canCurrentUser("createReports");
  const canEditReportConfiguration = canCurrentUser("editReportConfiguration");
  const canStartReports = canCreateReports && canEditReportConfiguration;
  const canExportReports = canCurrentUser("exportReports");
  const frozenSnapshot = row?.snapshot;
  const activeSettings = frozenSnapshot?.settings ?? initialSettings;
  const reportKind = frozenSnapshot?.kind ?? kind;

  const [name, setName] = useState(row?.name ?? "");
  const [caseItems, setCaseItems] = useState<CaseItem[]>(frozenSnapshot?.caseItems ?? []);
  const [userItems, setUserItems] = useState<UserItem[]>(frozenSnapshot?.userItems ?? []);
  const [caseAttributeItems, setCaseAttributeItems] = useState<AttributeItem[]>(frozenSnapshot?.caseAttributeItems ?? []);
  const [documentAttributeItems, setDocumentAttributeItems] = useState<AttributeItem[]>(frozenSnapshot?.documentAttributeItems ?? []);
  const [allAnnotations, setAllAnnotations] = useState<Annotation[]>(frozenSnapshot?.annotations ?? []);
  const [caseDocumentLinks, setCaseDocumentLinks] = useState<CaseDocumentLink[]>(frozenSnapshot?.caseDocumentLinks ?? []);
  const [caseAttributeValues, setCaseAttributeValues] = useState<AttributeValueItem[]>(frozenSnapshot?.caseAttributeValues ?? []);
  const [documentAttributeValues, setDocumentAttributeValues] = useState<AttributeValueItem[]>(frozenSnapshot?.documentAttributeValues ?? []);
  const [loadingFilters, setLoadingFilters] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDescription, setShowDescription] = useState(() => hasDescriptionContent(frozenSnapshot?.description));
  const [saving, setSaving] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<string | null>(null);

  const [selCaseIds, setSelCaseIds] = useState<Set<string>>(() => new Set(activeSettings?.caseIds ?? []));
  const [selDocIds, setSelDocIds] = useState<Set<string>>(() => new Set(activeSettings?.documentIds ?? []));
  const [selCaseAttrIds, setSelCaseAttrIds] = useState<Set<string>>(() => new Set(activeSettings?.caseAttributeIds ?? []));
  const [selDocAttrIds, setSelDocAttrIds] = useState<Set<string>>(() => new Set(activeSettings?.documentAttributeIds ?? []));
  const [selCodeIds, setSelCodeIds] = useState<Set<string>>(() => new Set(activeSettings?.codeIds ?? []));
  const [selUserIds, setSelUserIds] = useState<Set<string>>(() => new Set(activeSettings?.userIds ?? []));
  const [caseAttributeFilters, setCaseAttributeFilters] = useState<Record<string, AttributeFilterConfig>>(() => activeSettings?.caseAttributeFilters ?? {});
  const [documentAttributeFilters, setDocumentAttributeFilters] = useState<Record<string, AttributeFilterConfig>>(() => activeSettings?.documentAttributeFilters ?? {});
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(["cases", "documents", "users"]));
  const [expandedSummaryCards, setExpandedSummaryCards] = useState<Set<string>>(new Set());
  const [showCaseAttributeFilters, setShowCaseAttributeFilters] = useState(false);
  const [showDocumentAttributeFilters, setShowDocumentAttributeFilters] = useState(false);
  const descriptionEditor = useEditor({
    extensions: [StarterKit],
    editorProps: { attributes: { class: "report-description-editor" } },
    editable: !isFrozen,
    content: frozenSnapshot?.description ?? "",
  });
  const documents = frozenSnapshot?.documents ?? storeDocuments;
  const codes = frozenSnapshot?.codes ?? storeCodes;

  useEffect(() => {
    if (isFrozen || !pb || !activeProject) return;
    let cancelled = false;

    async function loadFilterData() {
      setLoadingFilters(true);
      setError(null);
      try {
        const [caseRecs, memberRecs, caseAttrRecs, docAttrRecs, annotationRecs] = await Promise.all([
          pb.collection("cases").getFullList({
            filter: `project="${activeProject!.id}"&&deleted_at=""`,
            sort: "name",
          }),
          pb.collection("project_members").getFullList({
            filter: `project="${activeProject!.id}"`,
            expand: "user",
          }),
          pb.collection("case_attribute_definitions").getFullList({
            filter: `project="${activeProject!.id}"&&deleted_at=""`,
            sort: "sort_order,name",
          }),
          pb.collection("document_attribute_definitions").getFullList({
            filter: `project="${activeProject!.id}"&&deleted_at=""`,
            sort: "sort_order,name",
          }),
          storeDocuments.length > 0
            ? pb.collection("annotations").getFullList({
                filter: `(${storeDocuments.map((doc) => `document="${doc.id}"`).join(" || ")})&&deleted_at=""`,
                sort: "created",
                expand: "created_by",
              })
            : Promise.resolve([]),
        ]);

        const [caseDocRecs, caseAttrValueRecs, docAttrValueRecs] = await Promise.all([
          caseRecs.length > 0
            ? pb.collection("case_documents").getFullList({
                filter: caseRecs.map((caseItem) => `case="${caseItem.id}"`).join(" || "),
              })
            : Promise.resolve([]),
          caseRecs.length > 0
            ? pb.collection("case_attribute_values").getFullList({
                filter: `(${caseRecs.map((caseItem) => `case="${caseItem.id}"`).join(" || ")})&&deleted_at=""`,
              })
            : Promise.resolve([]),
          storeDocuments.length > 0
            ? pb.collection("document_attribute_values").getFullList({
                filter: `(${storeDocuments.map((doc) => `document="${doc.id}"`).join(" || ")})&&deleted_at=""`,
              })
            : Promise.resolve([]),
        ]);

        if (cancelled) return;
        setCaseItems(caseRecs.map((r) => ({ id: r.id, name: r.name })));
        setAllAnnotations(annotationRecs.map((r) => ({
          id: r.id,
          documentId: r.document,
          codeId: r.code,
          startOffset: r.start_offset ?? 0,
          endOffset: r.end_offset ?? 0,
          quote: r.quote ?? "",
          note: r.note ?? "",
          createdAt: r.created,
          createdBy: r.expand?.created_by?.name || r.expand?.created_by?.email || "",
          createdById: r.created_by ?? "",
        })));
        setCaseDocumentLinks(caseDocRecs.map((r) => ({
          caseId: r.case,
          documentId: r.document,
        })));
        setCaseAttributeValues(caseAttrValueRecs.map((r) => ({
          id: r.id,
          ownerId: r.case,
          attributeId: r.attribute,
          value: r.value ?? "",
        })));
        setDocumentAttributeValues(docAttrValueRecs.map((r) => ({
          id: r.id,
          ownerId: r.document,
          attributeId: r.attribute,
          value: r.value ?? "",
        })));
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
        setUserItems(
          memberRecs
            .map((r) => {
              const u = r.expand?.user;
              return u ? { id: u.id, name: u.name || u.email || "Unknown" } : null;
            })
            .filter(Boolean) as UserItem[],
        );
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load report filters.");
      } finally {
        if (!cancelled) setLoadingFilters(false);
      }
    }

    loadFilterData();
    return () => { cancelled = true; };
  }, [isFrozen, pb, activeProject, storeDocuments]);

  const reportLabel = REPORT_LABELS[reportKind];
  const createdBy = row?.createdByName || currentUser?.name || currentUser?.email || "-";
  const visibleCases = selCaseIds.size;
  const visibleDocs = selDocIds.size;
  const visibleCodes = selCodeIds.size;
  const visibleUsers = selUserIds.size;
  const visibleCaseAttrs = selCaseAttrIds.size;
  const visibleDocAttrs = selDocAttrIds.size;
  const selectedCodeLabels = useMemo(() => {
    if (selCodeIds.size === 0) return "No codes selected";
    const tree = buildCodeTree(codes);
    const labels = tree
      .filter((node) => selCodeIds.has(node.code.id))
      .map((node) => node.code.label);
    return labels.length > 0 ? labels.join(", ") : "No codes selected";
  }, [codes, selCodeIds]);

  const codeBuckets = useMemo(() => {
    if (selCodeIds.size === 0) return [] as FrequencyCodeBucket[];
    const tree = buildCodeTree(codes);
    const codeById = new Map(codes.map((code) => [code.id, code]));
    const depthById = new Map(tree.map((node) => [node.code.id, node.depth]));
    const selectedExistingIds = [...selCodeIds].filter((id) => codeById.has(id));
    if (selectedExistingIds.length === 0) return [] as FrequencyCodeBucket[];
    const targetDepth = Math.min(...selectedExistingIds.map((id) => depthById.get(id) ?? 0));
    const bucketById = new Map<string, FrequencyCodeBucket>();

    for (const selectedId of selectedExistingIds) {
      const bucketCode = ancestorAtDepth(selectedId, targetDepth, codeById, depthById);
      if (!bucketCode) continue;
      if (!bucketById.has(bucketCode.id)) {
        bucketById.set(bucketCode.id, {
          id: bucketCode.id,
          label: bucketCode.label,
          color: bucketCode.color,
          codeIds: new Set(),
        });
      }
      bucketById.get(bucketCode.id)!.codeIds.add(selectedId);
    }

    return tree
      .filter((node) => bucketById.has(node.code.id))
      .map((node) => bucketById.get(node.code.id)!);
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

  const filteredSelectedCaseIds = useMemo(() => {
    if (!caseIdsMatchingSelectedAttributes) return new Set(selCaseIds);
    return new Set([...selCaseIds].filter((caseId) => caseIdsMatchingSelectedAttributes.has(caseId)));
  }, [selCaseIds, caseIdsMatchingSelectedAttributes]);

  const filteredSelectedDocIds = useMemo(() => {
    let next = new Set(selDocIds);
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
      next = new Set([...next].filter((docId) => allowedByCases.has(docId)));
    }
    return next;
  }, [selDocIds, docIdsMatchingSelectedAttributes, filteredSelectedCaseIds, caseDocumentMap]);

  const selectedAnnotations = useMemo(
    () => allAnnotations.filter((ann) =>
      selCodeIds.has(ann.codeId) &&
      selUserIds.has(ann.createdById) &&
      filteredSelectedDocIds.has(ann.documentId)
    ),
    [allAnnotations, selCodeIds, selUserIds, filteredSelectedDocIds],
  );

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
      subtitle?: string,
      diagonalEmpty = false,
    ): CoOccurrenceMatrix => ({
      id,
      subtitle,
      diagonalEmpty,
      codes: codesForMatrix,
      cells: codesForMatrix.map((rowCode, rowIndex) => codesForMatrix.map((colCode, colIndex) => {
        if (diagonalEmpty && rowIndex === colIndex) return 0;
        let count = 0;
        for (const codeSet of entityCodeSets) {
          if (codeSet.has(rowCode.id) && codeSet.has(colCode.id)) count += 1;
        }
        return count;
      })),
    });
    const normalizeValue = (value: string) => value.trim() || "No value";
    const countPerCode = (anns: Annotation[]) =>
      codesForMatrix.map((code) => ({ code, count: anns.filter((a) => a.codeId === code.id).length }));
    const sections: CoOccurrenceSection[] = [];

    if (selUserIds.size === 1) {
      const [userId] = [...selUserIds];
      const user = userItems.find((u) => u.id === userId);
      const anns = selectedAnnotations.filter((a) => a.createdById === userId && selCodeIds.has(a.codeId));
      sections.push({
        key: "users",
        title: "Users",
        matrices: [],
        singleEntityFreq: { entityLabel: user?.name || "Unknown", codeCounts: countPerCode(anns) },
      });
    } else if (selUserIds.size > 1) {
      const entityCodeSets = userItems
        .filter((item) => selUserIds.has(item.id))
        .map((item) => makeCodeSet(selectedAnnotations.filter((ann) => ann.createdById === item.id)));
      sections.push({ key: "users", title: "Users", matrices: [buildMatrix("users", entityCodeSets)] });
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
        title: "Cases",
        matrices: [],
        singleEntityFreq: { entityLabel: caseItem?.name || "Unknown", codeCounts: countPerCode(filtered) },
      });
    } else if (filteredSelectedCaseIds.size > 1) {
      const entityCodeSets = caseItems
        .filter((item) => filteredSelectedCaseIds.has(item.id))
        .map((item) => {
          const annotations: Annotation[] = [];
          for (const docId of caseDocumentMap.get(item.id) ?? []) {
            if (!filteredSelectedDocIds.has(docId)) continue;
            annotations.push(...(annotationsByDocument.get(docId) ?? []));
          }
          return makeCodeSet(annotations);
        });
      sections.push({ key: "cases", title: "Cases", matrices: [buildMatrix("cases", entityCodeSets)] });
    }

    if (filteredSelectedDocIds.size === 1) {
      const [docId] = [...filteredSelectedDocIds];
      const doc = documents.find((d) => d.id === docId);
      const anns = (annotationsByDocument.get(docId) ?? []).filter((a) => selCodeIds.has(a.codeId));
      sections.push({
        key: "documents",
        title: "Documents",
        matrices: [],
        singleEntityFreq: { entityLabel: doc?.name || "Unknown", codeCounts: countPerCode(anns) },
      });
    } else if (filteredSelectedDocIds.size > 1) {
      const entityCodeSets = documents
        .filter((item) => filteredSelectedDocIds.has(item.id))
        .map((item) => makeCodeSet(annotationsByDocument.get(item.id) ?? []));
      sections.push({ key: "documents", title: "Documents", matrices: [buildMatrix("documents", entityCodeSets)] });
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
          const entityCodeSets = [...caseIds].map((caseId) => {
            const annotations: Annotation[] = [];
            for (const docId of caseDocumentMap.get(caseId) ?? []) {
              if (!filteredSelectedDocIds.has(docId)) continue;
              annotations.push(...(annotationsByDocument.get(docId) ?? []));
            }
            return makeCodeSet(annotations);
          });
          matrices.push(buildMatrix(`${attr.id}:${valueLabel}`, entityCodeSets, `${attr.name}: ${valueLabel}`, true));
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
          const entityCodeSets = [...docIds].map((docId) => makeCodeSet(annotationsByDocument.get(docId) ?? []));
          matrices.push(buildMatrix(`${attr.id}:${valueLabel}`, entityCodeSets, `${attr.name}: ${valueLabel}`, true));
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
        title: "Cases",
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
          const label = `${attr.name}: ${value.value.trim() || "No value"}`;
          const columnKey = `${attr.id}:${value.value.trim() || "No value"}`;
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
        title: "Documents",
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
          const label = `${attr.name}: ${value.value.trim() || "No value"}`;
          const columnKey = `${attr.id}:${value.value.trim() || "No value"}`;
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

  function applyPrimarySelectionState(
    nextCaseIds: Set<string>,
    nextDocIds: Set<string>,
    nextCodeIds: Set<string>,
    nextUserIds: Set<string>,
  ) {
    setSelCaseIds(nextCaseIds);
    setSelDocIds(nextDocIds);
    setSelCodeIds(nextCodeIds);
    setSelUserIds(nextUserIds);
  }

  function applySelectionFromCases(nextCaseIds: Set<string>) {
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

  function applySelectionFromDocuments(nextDocIds: Set<string>) {
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
        if (selectedValues.length === 0) return `${item.name}: no values selected`;
        if (selectedValues.length <= 3) return `${item.name}: ${selectedValues.join(", ")}`;
        return `${item.name}: ${selectedValues.slice(0, 3).join(", ")} +${selectedValues.length - 3} more`;
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
      label: "Cases",
      value: visibleCases,
      items: caseItems
        .filter((item) => selCaseIds.has(item.id))
        .map((item) => ({ id: item.id, name: item.name })),
    },
    {
      key: "documents",
      label: "Documents",
      value: visibleDocs,
      items: documents
        .filter((item) => selDocIds.has(item.id))
        .map((item) => ({ id: item.id, name: item.name })),
    },
    {
      key: "codes",
      label: "Codes",
      value: visibleCodes,
      items: buildCodeTree(codes)
        .filter((node) => selCodeIds.has(node.code.id))
        .map((node) => ({ id: node.code.id, name: node.code.label })),
    },
    {
      key: "users",
      label: "Users",
      value: visibleUsers,
      items: userItems
        .filter((item) => selUserIds.has(item.id))
        .map((item) => ({ id: item.id, name: item.name })),
    },
  ];

  const includedCaseNames = useMemo(
    () => caseItems.filter((item) => selCaseIds.has(item.id)).map((item) => item.name),
    [caseItems, selCaseIds],
  );

  const includedDocumentNames = useMemo(
    () => documents.filter((item) => selDocIds.has(item.id)).map((item) => item.name),
    [documents, selDocIds],
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
      caseAttributeIds: [...selCaseAttrIds],
      documentAttributeIds: [...selDocAttrIds],
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
        <text x="18" y="22" font-size="16" font-weight="700" fill="#1f2933">${escapeHtml(sectionTitle)} Bar Chart</text>
        ${rows}
      </svg>
    `;
  }

  async function handleSave() {
    if (!canStartReports) return;
    if (!activeProject || isFrozen) return;
    setSaving(true);
    setError(null);
    try {
      const reportName = name.trim() || `${reportLabel} Report`;
      const snapshot = buildSnapshot();
      const record = await createCodeReport({
        name: reportName,
        caseIds: relationPreview(snapshot.settings.caseIds),
        documentIds: relationPreview(snapshot.settings.documentIds),
        codeIds: relationPreview(snapshot.settings.codeIds),
        createdBy: currentUser?.id,
        snapshot: JSON.stringify(snapshot),
      });
      if (!record) throw new Error("Failed to save report.");
      const savedRow: CodeReportRow = {
        id: record.id,
        name: record.name || reportName,
        createdByName: currentUser?.name || currentUser?.email || "-",
        createdAt: record.created,
        snapshot,
      };
      onSaved?.(savedRow);
    } catch (e) {
      console.error(e);
      setError(getPocketBaseErrorMessage(e));
      setSaving(false);
    }
  }

  function getExportHtml(): string {
    const description = currentDescriptionHtml();
    const appliedFilters = [
      ...caseFilterDetails.map((detail) => `Cases: ${detail}`),
      ...documentFilterDetails.map((detail) => `Documents: ${detail}`),
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
            <h3>Bar Chart</h3>
            <div class="chart-block">${chartSvg}</div>
            <h3>Heatmap</h3>
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
    <title>${escapeHtml(name || "Untitled Report")}</title>
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
    <h1>${escapeHtml(name || "Untitled Report")}</h1>
    <table class="details">
      <tr><td><strong>Type</strong></td><td>${escapeHtml(reportLabel)}</td></tr>
      <tr><td><strong>Created by</strong></td><td>${escapeHtml(createdBy)}</td></tr>
      <tr><td><strong>Created</strong></td><td>${escapeHtml(row ? fmtDate(row.createdAt) : fmtDate(new Date().toISOString()))}</td></tr>
      <tr><td><strong>Selected codes</strong></td><td>${escapeHtml(selectedCodeLabels)}</td></tr>
      <tr><td><strong>Included cases</strong></td><td>${escapeHtml(formatList(includedCaseNames, "No cases selected"))}</td></tr>
      <tr><td><strong>Included documents</strong></td><td>${escapeHtml(formatList(includedDocumentNames, "No documents selected"))}</td></tr>
      <tr><td><strong>Included users</strong></td><td>${escapeHtml(formatList(includedUserNames, "No users selected"))}</td></tr>
      ${appliedFilters.length > 0 ? `<tr><td><strong>Applied filters</strong></td><td>${escapeHtml(appliedFilters.join(" | "))}</td></tr>` : ""}
    </table>
    ${description ? `<h2>Description</h2><div class="description">${description}</div>` : ""}
    <h2>Summary</h2>
    <table class="summary">
      <tr><th>Users</th><th>Cases</th><th>Case Attributes</th><th>Documents</th><th>Document Attributes</th><th>Codes</th></tr>
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

      const workbook = new ExcelJS.Workbook();
      workbook.creator = currentUser?.name || currentUser?.email || "Kanqual";
      workbook.created = new Date();

      const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE1E4EA" } };

      function styleHeader(cell: ExcelJS.Cell) {
        cell.font = { bold: true };
        cell.fill = HEADER_FILL;
      }

      // ── Metadata sheet ────────────────────────────────────────────────────
      const meta = workbook.addWorksheet("Report");
      meta.columns = [{ width: 22 }, { width: 54 }];

      meta.mergeCells("A1:B1");
      const titleCell = meta.getCell("A1");
      titleCell.value = name || "Untitled Report";
      titleCell.font = { bold: true, size: 16 };

      meta.addRow([]);
      meta.addRow(["Type", reportLabel]);
      meta.addRow(["Created by", createdBy]);
      meta.addRow(["Created", row ? fmtDate(row.createdAt) : fmtDate(new Date().toISOString())]);

      const description = htmlToPlainText(currentDescriptionHtml() ?? "");
      if (description) {
        meta.addRow([]);
        const dh = meta.addRow(["Description"]);
        dh.getCell(1).font = { bold: true };
        for (const line of description.split(/\n+/).filter(Boolean)) meta.addRow([line]);
      }

      meta.addRow([]);
      const sh = meta.addRow(["Summary"]);
      sh.getCell(1).font = { bold: true };
      meta.addRow(["Users", visibleUsers]);
      meta.addRow(["Cases", visibleCases]);
      meta.addRow(["Case Attributes", visibleCaseAttrs]);
      meta.addRow(["Documents", visibleDocs]);
      meta.addRow(["Document Attributes", visibleDocAttrs]);
      meta.addRow(["Codes", visibleCodes]);

      // ── Frequency section sheets ──────────────────────────────────────────
      if (reportKind === "frequencies") {
        for (const { section, displayBuckets, tableRows, matrix, maxCell } of frequencyExportSections) {
          const ws = workbook.addWorksheet(section.title.slice(0, 31));
          ws.columns = [
            { width: 26 },
            ...displayBuckets.map(() => ({ width: 14 })),
          ];
          let r = 1;

          // Section title
          ws.mergeCells(r, 1, r, Math.max(2, displayBuckets.length + 1));
          const stCell = ws.getCell(r, 1);
          stCell.value = section.title;
          stCell.font = { bold: true, size: 14 };
          r += 2;

          // — Frequency table —————————————————————————————————————————————
          ws.getCell(r, 1).value = "Frequency Table";
          ws.getCell(r, 1).font = { bold: true, size: 12 };
          r++;

          const hRow = ws.getRow(r);
          styleHeader(hRow.getCell(1));
          hRow.getCell(1).value = section.title;
          for (let c = 0; c < displayBuckets.length; c++) {
            const hc = hRow.getCell(c + 2);
            styleHeader(hc);
            hc.value = displayBuckets[c].label;
          }
          r++;

          for (const tRow of tableRows) {
            const dRow = ws.getRow(r);
            dRow.getCell(1).value = tRow.label;
            for (let c = 0; c < displayBuckets.length; c++) {
              const value = tRow.values[c] ?? 0;
              const dc = dRow.getCell(c + 2);
              dc.value = value;
              if (value > 0 && maxCell > 0) {
                dc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + heatmapColorStatic(value, maxCell).slice(1) } };
              }
            }
            r++;
          }
          r++;

          // — Bar chart ————————————————————————————————————————————————————
          if (tableRows.length > 0 && displayBuckets.length > 0) {
            ws.getCell(r, 1).value = "Bar Chart";
            ws.getCell(r, 1).font = { bold: true, size: 12 };
            r++;
            try {
              const svg = buildFreqBarChartSvg(tableRows, displayBuckets, maxCell);
              const png = await svgToPngDataUrl(svg);
              const svgHMatch = svg.match(/height="(\d+)"/);
              const nativeH = svgHMatch ? parseInt(svgHMatch[1], 10) : 400;
              const imgW = 500;
              const imgH = Math.round((nativeH / 700) * imgW);
              const imgId = workbook.addImage({ base64: png.split(",")[1], extension: "png" });
              ws.addImage(imgId, { tl: { col: 0, row: r - 1 }, ext: { width: imgW, height: imgH } });
              r += Math.ceil(imgH / 19) + 1;
            } catch { /* skip on failure */ }
            r++;
          }

          // — Heatmap ——————————————————————————————————————————————————————
          if (matrix.length > 0 && tableRows.length > 0) {
            // Adjust columns for heatmap (codes × categories — may differ from freq table)
            const hmColCount = tableRows.length + 1;
            if (hmColCount > ws.columnCount) {
              for (let c = ws.columnCount + 1; c <= hmColCount; c++) ws.getColumn(c).width = 14;
            }

            ws.getCell(r, 1).value = "Heatmap";
            ws.getCell(r, 1).font = { bold: true, size: 12 };
            r++;

            const hmHdr = ws.getRow(r);
            styleHeader(hmHdr.getCell(1));
            hmHdr.getCell(1).value = "Code";
            for (let j = 0; j < tableRows.length; j++) {
              const hc = hmHdr.getCell(j + 2);
              styleHeader(hc);
              hc.value = tableRows[j].label;
            }
            r++;

            for (const matRow of matrix) {
              const mRow = ws.getRow(r);
              mRow.getCell(1).value = matRow.bucket.label;
              for (let j = 0; j < matRow.cells.length; j++) {
                const value = matRow.cells[j] ?? 0;
                const mc = mRow.getCell(j + 2);
                mc.value = value;
                const hexColor = heatmapColorStatic(value, maxCell).slice(1);
                mc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + hexColor } };
                const t = value / Math.max(1, maxCell);
                mc.font = { color: { argb: t > 0.55 ? "FFFFFFFF" : "FF374151" } };
              }
              r++;
            }
          }
        }

      // ── Co-occurrence sheet ───────────────────────────────────────────────
      } else {
        const ws = workbook.addWorksheet("Co-Occurrence");
        ws.columns = [{ width: 18 }, { width: 30 }, { width: 24 }, { width: 10 }];
        const coHdr = ws.addRow(["Section", "Category", "Code", "Count"]);
        coHdr.eachCell((cell) => styleHeader(cell));
        for (const rowItem of reportExportRows) {
          for (const v of rowItem.values) {
            ws.addRow([rowItem.section, rowItem.category, v.code, v.value]);
          }
        }
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

  async function handleExportPDF() {
    if (!canExportReports) return;
    try {
      setExportingFormat("pdf");
      const path = await save({ defaultPath: `${name || "Report"}.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (!path) return;

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
      addText(name || "Untitled Report", 20, "bold", 14);
      addText(`Type: ${reportLabel}`, 10);
      addText(`Created by: ${createdBy}`, 10);
      addText(`Created: ${row ? fmtDate(row.createdAt) : fmtDate(new Date().toISOString())}`, 10, "normal", 14);

      const description = htmlToPlainText(currentDescriptionHtml() ?? "");
      if (description) {
        addText("Description", 14, "bold", 8);
        addText(description, 10, "normal", 14);
      }

      addText("Summary", 14, "bold", 8);
      addText(`Users: ${visibleUsers}   Cases: ${visibleCases}   Case Attributes: ${visibleCaseAttrs}   Documents: ${visibleDocs}   Document Attributes: ${visibleDocAttrs}   Codes: ${visibleCodes}`, 10, "normal", 14);

      // ── Frequencies ──────────────────────────────────────────────────────────
      if (reportKind === "frequencies") {
        if (frequencyExportSections.length === 0) {
          addText("No frequency data was included in this report.", 10, "italic");
        }

        for (const { section, displayBuckets, tableRows, matrix, maxCell } of frequencyExportSections) {
          addText(section.title, 16, "bold", 10);

          // — Table ——————————————————————————————————————————————————————————
          addText("Frequency Table", 12, "bold", 6);
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
            addText("Bar Chart", 12, "bold", 6);
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
            addText("Heatmap", 12, "bold", 6);
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
          addText("No co-occurrence data was included in this report.", 10, "italic");
        }

        for (const section of coOccurrenceSections) {
          addText(section.title, 16, "bold", 10);

          // — Single-entity frequency table ————————————————————————————————
          if (section.singleEntityFreq) {
            const { entityLabel, codeCounts } = section.singleEntityFreq;
            addText(`Only one item selected — code frequencies for ${entityLabel}`, 10, "italic", 6);

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

      // DOCX content width in DXA (twentieths of a point): letter minus 1-inch margins each side
      const contentDXA = 9360;
      const headerShading = { type: ShadingType.SOLID, color: "E1E4EA", fill: "E1E4EA" };

      function makeTableCell(text: string, widthDXA: number, bold = false, shading?: typeof headerShading): TableCell {
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
      ): Table {
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
      ): Table {
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

      function buildDocxCoOccurrenceTable(matrix: CoOccurrenceMatrix): Table {
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

      const children: Array<Paragraph | Table> = [
        new Paragraph({ text: name || "Untitled Report", heading: HeadingLevel.TITLE }),
        new Paragraph(`Type: ${reportLabel}`),
        new Paragraph(`Created by: ${createdBy}`),
        new Paragraph(`Created: ${row ? fmtDate(row.createdAt) : fmtDate(new Date().toISOString())}`),
      ];

      const description = htmlToPlainText(currentDescriptionHtml() ?? "");
      const appliedFilters = [
        ...caseFilterDetails.map((detail) => `Cases: ${detail}`),
        ...documentFilterDetails.map((detail) => `Documents: ${detail}`),
      ];
      if (description) {
        children.push(new Paragraph({ text: "Description", heading: HeadingLevel.HEADING_1 }));
        for (const line of description.split(/\n+/).filter(Boolean)) children.push(new Paragraph(line));
      }

      children.push(new Paragraph({ text: "Report Details", heading: HeadingLevel.HEADING_1 }));
      children.push(buildDocxSingleValueTable("Field", "Value", [
        { label: "Selected codes", value: selectedCodeLabels },
        { label: "Included cases", value: includedCaseNames.length > 0 ? includedCaseNames.join(", ") : "No cases selected" },
        { label: "Included documents", value: includedDocumentNames.length > 0 ? includedDocumentNames.join(", ") : "No documents selected" },
        { label: "Included users", value: includedUserNames.length > 0 ? includedUserNames.join(", ") : "No users selected" },
        ...(appliedFilters.length > 0 ? [{ label: "Applied filters", value: appliedFilters.join(" | ") }] : []),
      ]));
      children.push(new Paragraph(""));

      children.push(new Paragraph({ text: "Summary", heading: HeadingLevel.HEADING_1 }));
      children.push(buildDocxSingleValueTable("Item", "Count", [
        { label: "Users", value: visibleUsers },
        { label: "Cases", value: visibleCases },
        { label: "Case Attributes", value: visibleCaseAttrs },
        { label: "Documents", value: visibleDocs },
        { label: "Document Attributes", value: visibleDocAttrs },
        { label: "Codes", value: visibleCodes },
      ]));
      children.push(new Paragraph(""));

      // ── Frequencies ────────────────────────────────────────────────────────
      if (reportKind === "frequencies") {
        if (frequencyExportSections.length === 0) {
          children.push(new Paragraph({ children: [new TextRun({ text: "No frequency data was included in this report.", italics: true })] }));
        }

        for (const { section, displayBuckets, tableRows, matrix, maxCell } of frequencyExportSections) {
          children.push(new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_1 }));

          // — Table ————————————————————————————————————————————————————————
          children.push(new Paragraph({ children: [new TextRun({ text: "Frequency Table", bold: true })] }));
          children.push(buildDocxFreqTable(section.title, tableRows, displayBuckets));
          children.push(new Paragraph(""));

          // — Bar chart ——————————————————————————————————————————————————————
          if (tableRows.length > 0 && displayBuckets.length > 0) {
            children.push(new Paragraph({ children: [new TextRun({ text: "Bar Chart", bold: true })] }));
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
            children.push(new Paragraph({ children: [new TextRun({ text: "Heatmap", bold: true })] }));
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
          children.push(new Paragraph({ children: [new TextRun({ text: "No co-occurrence data was included in this report.", italics: true })] }));
        } else {
          for (const section of coOccurrenceSections) {
            children.push(new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_2 }));

            if (section.singleEntityFreq) {
              const { entityLabel, codeCounts } = section.singleEntityFreq;
              children.push(new Paragraph({ children: [new TextRun({ text: `Only one item selected — code frequencies for ${entityLabel}`, italics: true })] }));
              children.push(buildDocxSingleValueTable("Code", "Annotations", codeCounts.map((item) => ({
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
        creator: currentUser?.name || currentUser?.email || "Kanqual",
        title: name || "Report",
        sections: [{ children }],
      });
      const buffer = await (await Packer.toBlob(doc)).arrayBuffer();
      await writeFile(path, new Uint8Array(buffer));
    } catch {
      setError("DOCX export failed.");
    } finally {
      setExportingFormat(null);
      setShowExportModal(false);
    }
  }

  return (
    <div className="annotate-view">
      <div className="annotate-back-bar" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 10 }}>
        <button className="btn" onClick={onBack}>Back to Reports</button>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {error && <span style={{ fontSize: 12, color: "var(--color-danger)" }}>{error}</span>}
          <button
            className="btn btn--secondary"
            title={
              !isFrozen
                ? "Only saved reports can be exported"
                : !canExportReports
                  ? "You do not have permission to export reports"
                  : "Export Report"
            }
            disabled={!isFrozen || !canExportReports}
            onClick={() => setShowExportModal(true)}
          >
            Export
          </button>
          {isFrozen ? (
            canStartReports ? (
            <button
              className="btn btn--primary"
              onClick={() => onUseSettings?.(row!.snapshot.settings)}
            >
              New Report From Settings
            </button>
            ) : null
          ) : (
            <button className="btn btn--primary" onClick={handleSave} disabled={saving || !canStartReports}>
              {saving ? "Saving..." : "Save"}
            </button>
          )}
        </div>
      </div>

      <div className="annotate-layout ann-report-annotate-layout">
        <div className="annotate-left">
          <div className="annotate-left-title">Include in Report:</div>

          <CodeHierarchySelectionPanel
            codes={codes}
            selectedIds={selCodeIds}
            onChange={applySelectionFromCodes}
            disabled={isFrozen}
            className="annotate-card--featured"
            showAllClear
          />

          <SelectionPanel
            title="Cases"
            count={selCaseIds.size}
            collapsed={collapsed.has("cases")}
            onToggleCollapsed={() => togglePanel("cases")}
            disabled={isFrozen}
            headerExtra={
              <button
                type="button"
                className="filter-icon-button filter-icon-button--compact"
                aria-label="Filter cases by attributes"
                title="Filter cases by attributes"
                onClick={(e) => { e.stopPropagation(); setShowCaseAttributeFilters(true); }}
              >
                <FilterIcon className="filter-icon-svg" />
              </button>
            }
            selectAll={{
              checked: caseItems.length > 0 && selCaseIds.size === caseItems.length,
              disabled: caseItems.length === 0,
              onToggle: () => applySelectionFromCases(
                caseItems.length > 0 && selCaseIds.size === caseItems.length ? new Set() : new Set(caseItems.map((item) => item.id))
              ),
            }}
          >
            <ul className="code-list">
              {loadingFilters ? (
                <li className="code-list-empty">Loading...</li>
              ) : caseItems.length === 0 ? (
                <li className="code-list-empty">No cases.</li>
              ) : caseItems.map((item) => (
                <li key={item.id} className="code-item" style={{ cursor: isFrozen ? "default" : "pointer" }} onClick={() => !isFrozen && applySelectionFromCases((() => { const next = new Set(selCaseIds); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })())}>
                  <input
                    type="checkbox"
                    className="memo-sel-checkbox"
                    checked={selCaseIds.has(item.id)}
                    disabled={isFrozen}
                    onChange={(e) => { e.stopPropagation(); if (!isFrozen) applySelectionFromCases((() => { const next = new Set(selCaseIds); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })()); }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="code-label">{item.name}</span>
                </li>
              ))}
            </ul>
          </SelectionPanel>

          <SelectionPanel
            title="Documents"
            count={selDocIds.size}
            collapsed={collapsed.has("documents")}
            onToggleCollapsed={() => togglePanel("documents")}
            disabled={isFrozen}
            headerExtra={
              <button
                type="button"
                className="filter-icon-button filter-icon-button--compact"
                aria-label="Filter documents by attributes"
                title="Filter documents by attributes"
                onClick={(e) => { e.stopPropagation(); setShowDocumentAttributeFilters(true); }}
              >
                <FilterIcon className="filter-icon-svg" />
              </button>
            }
            selectAll={{
              checked: documents.length > 0 && selDocIds.size === documents.length,
              disabled: documents.length === 0,
              onToggle: () => applySelectionFromDocuments(
                documents.length > 0 && selDocIds.size === documents.length ? new Set() : new Set(documents.map((item) => item.id))
              ),
            }}
          >
            <ul className="code-list">
              {documents.length === 0 ? (
                <li className="code-list-empty">No documents.</li>
              ) : documents.map((doc) => (
                <li key={doc.id} className="code-item" style={{ cursor: isFrozen ? "default" : "pointer" }} onClick={() => !isFrozen && applySelectionFromDocuments((() => { const next = new Set(selDocIds); if (next.has(doc.id)) next.delete(doc.id); else next.add(doc.id); return next; })())}>
                  <input
                    type="checkbox"
                    className="memo-sel-checkbox"
                    checked={selDocIds.has(doc.id)}
                    disabled={isFrozen}
                    onChange={(e) => { e.stopPropagation(); if (!isFrozen) applySelectionFromDocuments((() => { const next = new Set(selDocIds); if (next.has(doc.id)) next.delete(doc.id); else next.add(doc.id); return next; })()); }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="code-label">{doc.name}</span>
                </li>
              ))}
            </ul>
          </SelectionPanel>

          <SelectionPanel
            title="Users"
            count={selUserIds.size}
            collapsed={collapsed.has("users")}
            onToggleCollapsed={() => togglePanel("users")}
            disabled={isFrozen}
            selectAll={{
              checked: userItems.length > 0 && selUserIds.size === userItems.length,
              disabled: userItems.length === 0,
              onToggle: () => applySelectionFromUsers(
                userItems.length > 0 && selUserIds.size === userItems.length ? new Set() : new Set(userItems.map((item) => item.id))
              ),
            }}
          >
            <ul className="code-list">
              {loadingFilters ? (
                <li className="code-list-empty">Loading...</li>
              ) : userItems.length === 0 ? (
                <li className="code-list-empty">No users.</li>
              ) : userItems.map((item) => (
                <li key={item.id} className="code-item" style={{ cursor: isFrozen ? "default" : "pointer" }} onClick={() => !isFrozen && applySelectionFromUsers((() => { const next = new Set(selUserIds); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })())}>
                  <input
                    type="checkbox"
                    className="memo-sel-checkbox"
                    checked={selUserIds.has(item.id)}
                    disabled={isFrozen}
                    onChange={(e) => { e.stopPropagation(); if (!isFrozen) applySelectionFromUsers((() => { const next = new Set(selUserIds); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })()); }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="code-label">{item.name}</span>
                </li>
              ))}
            </ul>
          </SelectionPanel>

        </div>

        <div
          className="annotate-main"
          style={{ overflowY: "auto", gap: 10, flexDirection: "column", display: "flex", paddingTop: 2, paddingBottom: 2 }}
        >
          <div className="annotate-card" style={{ flexShrink: 0 }}>
            <div className="annotate-card-header"><span className="annotate-card-title">Report Title</span></div>
            <div style={{ padding: "10px 14px" }}>
              <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={`${reportLabel} report name...`} autoFocus={!isFrozen} disabled={isFrozen} />
            </div>
          </div>

          <div className="annotate-card" style={{ flexShrink: 0 }}>
            <div className="annotate-card-header"><span className="annotate-card-title">Report Details</span></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 14px", fontSize: 13 }}>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                <span>
                  <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>Type </span>
                  <span>{reportLabel}</span>
                </span>
                <span>
                  <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>Created By </span>
                  <span>{createdBy}</span>
                </span>
                <span>
                  <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>Created </span>
                  <span>{row ? fmtDate(row.createdAt) : fmtDate()}</span>
                </span>
              </div>
              <div>
                <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>Selected Codes </span>
                <span>{selectedCodeLabels}</span>
              </div>
              {(caseFilterDetails.length > 0 || documentFilterDetails.length > 0) && (
                <div>
                  <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>Applied Filters </span>
                  <span>
                    {[
                      ...caseFilterDetails.map((detail) => `Cases: ${detail}`),
                      ...documentFilterDetails.map((detail) => `Documents: ${detail}`),
                    ].join(" | ")}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="annotate-card" style={{ flexShrink: 0 }}>
            <div className="annotate-card-header">
              <span className="annotate-card-title">Report Description</span>
              <button
                className="btn btn--small"
                onClick={() => setShowDescription((prev) => !prev)}
                aria-pressed={showDescription}
                disabled={isFrozen}
              >
                {showDescription ? "Remove Description" : "Add Description"}
              </button>
            </div>
            {showDescription && descriptionEditor && (
              <>
                {!isFrozen && <div className="report-description-toolbar" style={{ padding: "6px 10px", borderBottom: "1px solid var(--color-border)" }}>
                  <button className={`rte-btn${descriptionEditor.isActive("bold") ? " rte-btn--active" : ""}`} onMouseDown={(e) => { e.preventDefault(); descriptionEditor.chain().focus().toggleBold().run(); }} title="Bold">B</button>
                  <button className={`rte-btn${descriptionEditor.isActive("italic") ? " rte-btn--active" : ""}`} onMouseDown={(e) => { e.preventDefault(); descriptionEditor.chain().focus().toggleItalic().run(); }} title="Italic"><em>I</em></button>
                  <button className={`rte-btn${descriptionEditor.isActive("strike") ? " rte-btn--active" : ""}`} onMouseDown={(e) => { e.preventDefault(); descriptionEditor.chain().focus().toggleStrike().run(); }} title="Strikethrough"><s>S</s></button>
                  <span className="rte-divider" />
                  <button className={`rte-btn${descriptionEditor.isActive("bulletList") ? " rte-btn--active" : ""}`} onMouseDown={(e) => { e.preventDefault(); descriptionEditor.chain().focus().toggleBulletList().run(); }} title="Bullet list">-</button>
                  <button className={`rte-btn${descriptionEditor.isActive("orderedList") ? " rte-btn--active" : ""}`} onMouseDown={(e) => { e.preventDefault(); descriptionEditor.chain().focus().toggleOrderedList().run(); }} title="Numbered list">1.</button>
                  <span className="rte-divider" />
                  <button className={`rte-btn${descriptionEditor.isActive("blockquote") ? " rte-btn--active" : ""}`} onMouseDown={(e) => { e.preventDefault(); descriptionEditor.chain().focus().toggleBlockquote().run(); }} title="Blockquote">"</button>
                </div>}
                <EditorContent editor={descriptionEditor} />
              </>
            )}
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
                        None included.
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
              annotations={selectedAnnotations}
              frozenRows={frozenSnapshot?.frozenFrequencyRows?.filter((rowItem) => rowItem.section === section.title)}
            />
          )) : coOccurrenceSections.map((section) => (
            <CoOccurrenceMatrixCard key={section.key} section={section} />
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
        <div className="modal-overlay" onClick={() => setShowCaseAttributeFilters(false)} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "var(--color-bg)", padding: 24, borderRadius: 8, minWidth: 320, maxWidth: 820, width: "min(820px, calc(100vw - 32px))", maxHeight: "calc(100vh - 48px)", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
              <h2 style={{ margin: 0 }}>Filter Cases by Attributes</h2>
              <button className="btn" onClick={() => setShowCaseAttributeFilters(false)}>Close</button>
            </div>
            {!isFrozen && !loadingFilters && caseAttributeItems.length > 0 && (
              <div style={{ paddingBottom: 8, display: "flex", gap: 8 }}>
                <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={selectAllCaseAttributes}>All</button>
                <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={clearCaseAttributeSelections}>Clear</button>
              </div>
            )}
            <ul className="code-list">
              {loadingFilters ? (
                <li className="code-list-empty">Loading...</li>
              ) : caseAttributeItems.length === 0 ? (
                <li className="code-list-empty">No case attributes.</li>
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
                  <span className="users-filter-count">{item.dataType === "datetime" ? "Date/time" : item.dataType}</span>
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
        </div>
      )}

      {showDocumentAttributeFilters && (
        <div className="modal-overlay" onClick={() => setShowDocumentAttributeFilters(false)} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "var(--color-bg)", padding: 24, borderRadius: 8, minWidth: 320, maxWidth: 820, width: "min(820px, calc(100vw - 32px))", maxHeight: "calc(100vh - 48px)", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
              <h2 style={{ margin: 0 }}>Filter Documents by Attributes</h2>
              <button className="btn" onClick={() => setShowDocumentAttributeFilters(false)}>Close</button>
            </div>
            {!isFrozen && !loadingFilters && documentAttributeItems.length > 0 && (
              <div style={{ paddingBottom: 8, display: "flex", gap: 8 }}>
                <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={selectAllDocumentAttributes}>All</button>
                <button className="btn" style={{ fontSize: 11, padding: "1px 8px" }} onClick={clearDocumentAttributeSelections}>Clear</button>
              </div>
            )}
            <ul className="code-list">
              {loadingFilters ? (
                <li className="code-list-empty">Loading...</li>
              ) : documentAttributeItems.length === 0 ? (
                <li className="code-list-empty">No document attributes.</li>
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
                  <span className="users-filter-count">{item.dataType === "datetime" ? "Date/time" : item.dataType}</span>
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
        </div>
      )}
    </div>
  );
}

export function CodesView() {
  const { activeProject, pb, canCurrentUser, deleteCodeReport } = useStore();
  const canCreateReports = canCurrentUser("createReports") && canCurrentUser("editReportConfiguration");
  const canDeleteReports = canCurrentUser("deleteReports");

  const [showNewModal, setShowNewModal] = useState(false);
  const [newReportKind, setNewReportKind] = useState<CodeReportKind | null>(null);
  const [openSavedRow, setOpenSavedRow] = useState<CodeReportRow | null>(null);
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
    if (!activeProject || !pb) return [];
    setLoading(true);
    setError(null);
    try {
      const records = await pb.collection("code_reports").getFullList({
        filter: `project="${activeProject.id}"&&deleted_at=""`,
        expand: "created_by",
        sort: "-created",
      });
      const mappedRows = records
        .map((record) => {
          let snapshot: CodeReportSnapshot | null = null;
          if (record.snapshot) {
            try {
              const parsed = JSON.parse(record.snapshot);
              if (parsed?.reportType === "code-report") snapshot = parsed as CodeReportSnapshot;
            } catch {
              snapshot = null;
            }
          }
          if (!snapshot) return null;
          const createdBy = record.expand?.created_by;
          return {
            id: record.id,
            name: record.name,
            createdByName: createdBy?.name || createdBy?.email || "-",
            createdAt: record.created,
            snapshot,
          };
        })
        .filter(Boolean) as CodeReportRow[];
      setRows(mappedRows);
      return mappedRows;
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
    const aValue = sortCol === "kind" ? REPORT_LABELS[a.snapshot.kind] : String(a[sortCol]);
    const bValue = sortCol === "kind" ? REPORT_LABELS[b.snapshot.kind] : String(b[sortCol]);
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
      await deleteCodeReport(confirmDelete.id);
      setRows((prev) => prev.filter((row) => row.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete report.");
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
        onBack={() => { setNewReportKind(null); setNewFromSettings(null); }}
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
        onBack={() => setOpenSavedRow(null)}
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
          <h1>Code Reports</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            aria-label="Show code reports help"
            title="Show Help"
            onClick={() => setHelpOpen(true)}
          >
            <img src={helpIcon} alt="" className="users-help-icon" />
          </button>
        </div>
        <button
          className="btn btn--primary"
          onClick={() => setShowNewModal(true)}
          disabled={!canCreateReports}
          title={!canCreateReports ? "You do not have permission to create code reports" : undefined}
        >
          + New Report
        </button>
      </header>

      {error && <p className="users-error">{error}</p>}

      <div className="users-content">
        <section className="users-layout-main">
          <div className="users-table-wrap" style={{ maxHeight: 34 + (Math.max(loading || sorted.length === 0 ? 1 : sorted.length, 1) + 2) * 36 }}>
            <table className="users-table">
              <thead>
                <tr>
                  {CODE_REPORT_COLS.map((col) => (
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
                {loading && <tr><td colSpan={4} className="users-td-msg">Loading...</td></tr>}
                {!loading && sorted.length === 0 && <tr><td colSpan={4} className="users-td-msg">No reports yet.</td></tr>}
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
                    <td className="users-td users-td--muted">{REPORT_LABELS[row.snapshot.kind]}</td>
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
          <div className="modal modal--help" onClick={(e) => e.stopPropagation()}>
            <h2>Code Reports Help</h2>
            <p className="users-guide-copy">
              Create or open a code report, review descriptions, summaries, and report sections, compare codes across project dimensions, and delete a report when permitted.
            </p>
            <p className="users-guide-copy">
              Use code reports to compare coding patterns across the project. Open a report from the list or create a new one, then read the summary sections generated for that report.
            </p>
            <p className="users-guide-copy">
              Report actions depend on your role. Reports reflect current project data and may change as coding changes.
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
          <button className="context-menu-item" onClick={() => { setOpenSavedRow(contextMenu.row); setContextMenu(null); }}>Open Report</button>
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
                {deleteLoading ? "Deleting..." : "Delete Report"}
              </button>
            </div>
          </div>
        </div>
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

