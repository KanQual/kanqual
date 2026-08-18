import { type CSSProperties, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readFile as readTauriFile } from "@tauri-apps/plugin-fs";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import circleFilledShapeSvg from "../assets/object-shapes/circle-filled.svg?raw";
import circleOutlineShapeSvg from "../assets/object-shapes/circle-outline.svg?raw";
import rectangleFilledShapeSvg from "../assets/object-shapes/rectangle-filled.svg?raw";
import rectangleOutlineShapeSvg from "../assets/object-shapes/rectangle-outline.svg?raw";
import triangleFilledShapeSvg from "../assets/object-shapes/triangle-filled.svg?raw";
import triangleOutlineShapeSvg from "../assets/object-shapes/triangle-outline.svg?raw";
import diamondFilledShapeSvg from "../assets/object-shapes/diamond-filled.svg?raw";
import diamondOutlineShapeSvg from "../assets/object-shapes/diamond-outline.svg?raw";
import hexagonFilledShapeSvg from "../assets/object-shapes/hexagon-filled.svg?raw";
import hexagonOutlineShapeSvg from "../assets/object-shapes/hexagon-outline.svg?raw";
import octagonFilledShapeSvg from "../assets/object-shapes/octagon-filled.svg?raw";
import octagonOutlineShapeSvg from "../assets/object-shapes/octagon-outline.svg?raw";
import parallelogramFilledShapeSvg from "../assets/object-shapes/parallelogram-filled.svg?raw";
import parallelogramOutlineShapeSvg from "../assets/object-shapes/parallelogram-outline.svg?raw";
import trapezoidFilledShapeSvg from "../assets/object-shapes/trapezoid-filled.svg?raw";
import trapezoidOutlineShapeSvg from "../assets/object-shapes/trapezoid-outline.svg?raw";
import tagFilledShapeSvg from "../assets/object-shapes/tag-filled.svg?raw";
import tagOutlineShapeSvg from "../assets/object-shapes/tag-outline.svg?raw";
import starFilledShapeSvg from "../assets/object-shapes/star-filled.svg?raw";
import starOutlineShapeSvg from "../assets/object-shapes/star-outline.svg?raw";
import sourceTextOutlineShapeSvg from "../assets/object-shapes/source-text-outline.svg?raw";
import sourceProcessedTranscriptOutlineShapeSvg from "../assets/object-shapes/source-processed-transcript-outline.svg?raw";
import sourcePdfOutlineShapeSvg from "../assets/object-shapes/source-pdf-outline.svg?raw";
import sourceImageOutlineShapeSvg from "../assets/object-shapes/source-image-outline.svg?raw";
import sourceAudioOutlineShapeSvg from "../assets/object-shapes/source-audio-outline.svg?raw";
import sourceVideoOutlineShapeSvg from "../assets/object-shapes/source-video-outline.svg?raw";
import { type SharedAttributeDataType, type SharedAttributeDraft } from "../components/AttributeValuesModal";
import {
  PostgresAttributeValueHistoryModal,
  type PostgresAttributeValueHistoryTarget,
} from "../components/PostgresAttributeValueHistoryModal";
import {
  PostgresRelationshipModal,
  type PostgresRelationshipEndpointOption as SharedPostgresRelationshipEndpointOption,
} from "../components/PostgresRelationshipModal";
import { ProcessedTranscriptView, getProcessedTranscriptQuestionOutline, parseProcessedTranscriptSegments } from "../components/ProcessedTranscriptView";
import { formatCurrentDateTime, formatCurrentNumber } from "../i18n/formatters";
import { useI18n } from "../i18n/provider";
import { readAppSettings } from "../lib/appSettings";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import { createMediaWaveformCache, serializeMediaWaveformCache } from "../lib/mediaWaveform";
import { createMediaVideoFrameIndexCache, serializeMediaVideoFrameIndexCache } from "../lib/mediaVideoFrameIndex";
import { loadPostgresProjectWorkspaceSnapshot } from "../lib/postgresProjectWorkspace";
import {
  acquirePostgresSourceLock,
  createPostgresAnnotation,
  createPostgresCode,
  deletePostgresAnnotation,
  deletePostgresCode,
  type PostgresCode,
  type PostgresAnnotationSummary,
  type PostgresObject,
  type PostgresObjectType,
  type PostgresRelationship,
  type PostgresRelationshipAttributeDefinition,
  type PostgresRelationshipType,
  type PostgresSourceAttributeDefinition,
  type PostgresSourceAttributeValue,
  type PostgresSourceLock,
  type PostgresSourceObjectLink,
  createPostgresSource,
  deletePostgresSource,
  getPostgresProjectDocumentImportSettings,
  importPostgresSourceFile,
  kickPostgresSourceLock,
  listPostgresProjects,
  releasePostgresSourceLock,
  savePostgresSourceAttribute,
  savePostgresRelationship,
  savePostgresRelationshipType,
  setPostgresSourceObjects,
  updatePostgresAnnotation,
  updatePostgresCode,
  updatePostgresSource,
} from "../lib/postgres";
import { PostgresSourceAudioCodingView } from "./Postgres_Source_Audio_Coding_View";
import { PostgresSourceImageCodingView } from "./Postgres_Source_Image_Coding_View";
import {
  AnnotationEditorModal,
  SOURCE_TEXT_SIZE_DEFAULT_PX,
  SOURCE_TEXT_SIZE_MAX_PX,
  SOURCE_TEXT_SIZE_MIN_PX,
  SOURCE_TEXT_SIZE_STEP_PX,
  TextSizeControls,
} from "./Postgres_Source_Coding_Shared";
import { formatMediaTime } from "./Postgres_Source_Media_Timeline";
import { PostgresSourceAiTextCodingView } from "./Postgres_Source_AI_Text_Coding_View";
import { PostgresSourceTextCodingView } from "./Postgres_Source_Text_Coding_View";
import { PostgresSourceVideoCodingView } from "./Postgres_Source_Video_Coding_View";

type SortCol = "name" | "objects" | "annotations" | "createdAt";
type SortDir = "asc" | "desc";
type SourceKindSortCol = "label" | "count";
type AttributeSortCol = "name" | string;
type AttributeSortDir = "asc" | "desc";
type SourceUploadTab = "text" | "pdf" | "image" | "audio" | "video";
type SourceObjectTypeShape =
  | "rounded"
  | "rectangle"
  | "triangle"
  | "diamond"
  | "hexagon"
  | "octagon"
  | "parallelogram"
  | "trapezoid"
  | "tag"
  | "star";
type SourceObjectFill = "filled" | "outline";
type SourceObjectVisualKey = "source_text" | "source_processed_transcript" | "source_pdf" | "source_image" | "source_audio" | "source_video";

type SourceUploadDraft = {
  id: string;
  file: File;
  title: string;
  sourceKind: string;
  extractedText: string;
  fileTypeLabel: string;
  characterCount: number | null;
};

export type SourceRow = {
  id: string;
  name: string;
  type: string;
  sourceObjectType: string;
  sourceObjectTypeSystemKey: string | null;
  notes: string;
  content: string;
  structuredContentJson: string;
  waveformPeaksJson: string;
  videoFrameIndexJson: string;
  extractedFromVideoSourceId: string;
  extractedFromVideoTimeMs: number | null;
  filePath: string;
  annotationCount: number;
  objectCount: number;
  createdAt: string;
};

function normalizeSourceKindFilterValue(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/^source_/, "").replace(/_/g, " ");
  return normalized === "processed transcript" ? "transcript" : normalized;
}

function sourceRowMatchesAllowedKinds(row: SourceRow, allowedKinds: Set<string> | null): boolean {
  if (!allowedKinds) return true;
  return [
    row.type,
    row.sourceObjectType,
    row.sourceObjectTypeSystemKey ?? "",
  ].some((value) => allowedKinds.has(normalizeSourceKindFilterValue(value)));
}

export type SourceAnnotationRow = {
  id: string;
  codeIds: string[];
  codeLabels: string[];
  codeColors: string[];
  quote: string;
  note: string;
  anchorKind: string;
  timeStartMs: number | null;
  timeEndMs: number | null;
  imageRegion: {
    x: number;
    y: number;
    width: number;
    height: number;
    imageWidth: number;
    imageHeight: number;
    pageNumber?: number | null;
  } | null;
  startOffset: number | null;
  endOffset: number | null;
  createdByName: string;
  createdAt: string;
};

export type PendingSelection = {
  startOffset: number;
  endOffset: number;
  quote: string;
  anchorKind?: string;
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
  displayLabel?: string;
};

export type CodeOption = {
  id: string;
  label: string;
  color: string;
};

type SourceObjectRow = {
  id: string;
  title: string;
  objectType: string;
  objectTypeSystemKey: string | null;
};

type SourceRelationshipRow = {
  id: string;
  relationshipType: string;
  otherEndpointName: string;
  otherEndpointType: string;
  description: string;
};

type SourceAttributeDefinitionRow = {
  id: string;
  name: string;
  dataType: SharedAttributeDataType;
  description: string;
  options: string[];
  sourceKinds: string[];
  sortOrder: number;
};

type SourceAttributeDraft = SharedAttributeDraft & {
  sourceKinds: string[];
};

type SourceAttributeValueRow = {
  id: string;
  sourceId: string;
  attributeDefinitionId: string;
  value: string;
};

const SOURCE_LOCK_HEARTBEAT_MS = 15_000;
const SOURCE_IMPORT_ACCEPTED_EXTS = new Set([
  "txt",
  "rtf",
  "docx",
  "csv",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "mp3",
  "wav",
  "m4a",
  "aac",
  "ogg",
  "flac",
  "mp4",
  "mov",
  "avi",
  "mkv",
  "webm",
  "m4v",
]);
const SOURCE_IMPORT_TEXT_EXTS = new Set(["txt", "rtf", "docx", "csv"]);
const SOURCE_IMPORT_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
const SOURCE_IMPORT_AUDIO_EXTS = new Set(["mp3", "wav", "m4a", "aac", "ogg", "flac"]);
const SOURCE_IMPORT_VIDEO_EXTS = new Set(["mp4", "mov", "avi", "mkv", "webm", "m4v"]);
const POSTGRES_SOURCE_OBJECT_TYPE_SYSTEM_KEYS = [
  "source_text",
  "source_processed_transcript",
  "source_pdf",
  "source_image",
  "source_audio",
  "source_video",
] as const;
const POSTGRES_SOURCE_KIND_OPTIONS = [
  { value: "text", label: "Text" },
  { value: "Transcript", label: "Transcript" },
  { value: "pdf", label: "PDF" },
  { value: "image", label: "Image" },
  { value: "audio", label: "Audio" },
  { value: "video", label: "Video" },
] as const;
const POSTGRES_SOURCE_KIND_VISUALS: Record<string, { label: string; color: string; systemKey: SourceObjectVisualKey }> = {
  text: { label: "Text", color: "#355070", systemKey: "source_text" },
  transcript: { label: "Transcript", color: "#2a9d8f", systemKey: "source_processed_transcript" },
  pdf: { label: "PDF", color: "#7f5539", systemKey: "source_pdf" },
  image: { label: "Image", color: "#6d597a", systemKey: "source_image" },
  audio: { label: "Audio", color: "#b56576", systemKey: "source_audio" },
  video: { label: "Video", color: "#457b9d", systemKey: "source_video" },
};
const SOURCE_OBJECT_TYPE_DEFAULT_COLOR = "#355070";

function buildSvgDataUrl(svgMarkup: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svgMarkup)}`;
}

const SOURCE_OBJECT_SHAPE_ASSET_URLS: Record<SourceObjectTypeShape, { filled: string; outline: string }> = {
  rounded: { filled: buildSvgDataUrl(circleFilledShapeSvg), outline: buildSvgDataUrl(circleOutlineShapeSvg) },
  rectangle: { filled: buildSvgDataUrl(rectangleFilledShapeSvg), outline: buildSvgDataUrl(rectangleOutlineShapeSvg) },
  triangle: { filled: buildSvgDataUrl(triangleFilledShapeSvg), outline: buildSvgDataUrl(triangleOutlineShapeSvg) },
  diamond: { filled: buildSvgDataUrl(diamondFilledShapeSvg), outline: buildSvgDataUrl(diamondOutlineShapeSvg) },
  hexagon: { filled: buildSvgDataUrl(hexagonFilledShapeSvg), outline: buildSvgDataUrl(hexagonOutlineShapeSvg) },
  octagon: { filled: buildSvgDataUrl(octagonFilledShapeSvg), outline: buildSvgDataUrl(octagonOutlineShapeSvg) },
  parallelogram: { filled: buildSvgDataUrl(parallelogramFilledShapeSvg), outline: buildSvgDataUrl(parallelogramOutlineShapeSvg) },
  trapezoid: { filled: buildSvgDataUrl(trapezoidFilledShapeSvg), outline: buildSvgDataUrl(trapezoidOutlineShapeSvg) },
  tag: { filled: buildSvgDataUrl(tagFilledShapeSvg), outline: buildSvgDataUrl(tagOutlineShapeSvg) },
  star: { filled: buildSvgDataUrl(starFilledShapeSvg), outline: buildSvgDataUrl(starOutlineShapeSvg) },
};
const SOURCE_OBJECT_VISUAL_ASSET_URLS: Record<SourceObjectVisualKey, string> = {
  source_text: buildSvgDataUrl(sourceTextOutlineShapeSvg),
  source_processed_transcript: buildSvgDataUrl(sourceProcessedTranscriptOutlineShapeSvg),
  source_pdf: buildSvgDataUrl(sourcePdfOutlineShapeSvg),
  source_image: buildSvgDataUrl(sourceImageOutlineShapeSvg),
  source_audio: buildSvgDataUrl(sourceAudioOutlineShapeSvg),
  source_video: buildSvgDataUrl(sourceVideoOutlineShapeSvg),
};

function normalizeSourceObjectTypeShape(value: string): SourceObjectTypeShape {
  const normalized = value.trim().toLowerCase();
  if (normalized === "pill" || normalized === "circle") return "rounded";
  if (
    normalized === "rectangle"
    || normalized === "triangle"
    || normalized === "diamond"
    || normalized === "hexagon"
    || normalized === "octagon"
    || normalized === "parallelogram"
    || normalized === "trapezoid"
    || normalized === "tag"
    || normalized === "star"
  ) {
    return normalized;
  }
  return "rounded";
}

function normalizeSourceObjectFill(value: string): SourceObjectFill {
  return value.trim().toLowerCase() === "outline" ? "outline" : "filled";
}

function normalizeSourceObjectColor(value: string): string {
  const normalized = value.trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : SOURCE_OBJECT_TYPE_DEFAULT_COLOR;
}

function getSourceObjectVisualKey(systemKey: string | null | undefined): SourceObjectVisualKey | null {
  if (
    systemKey === "source_text"
    || systemKey === "source_processed_transcript"
    || systemKey === "source_pdf"
    || systemKey === "source_image"
    || systemKey === "source_audio"
    || systemKey === "source_video"
  ) {
    return systemKey;
  }
  return null;
}

function getSourceKindVisual(sourceKind: string | null | undefined): { label: string; color: string; systemKey: SourceObjectVisualKey } | null {
  const normalized = normalizeSourceKindFilterValue(sourceKind ?? "");
  return POSTGRES_SOURCE_KIND_VISUALS[normalized] ?? null;
}

function getSourceObjectMaskStyle(url: string): CSSProperties {
  return {
    WebkitMaskImage: `url("${url}")`,
    maskImage: `url("${url}")`,
    WebkitMaskSize: "contain",
    maskSize: "contain",
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
  };
}

function SourceObjectTypeSwatch(props: {
  shape: SourceObjectTypeShape;
  fill: SourceObjectFill;
  color: string;
  sourceVisualKey: SourceObjectVisualKey | null;
}) {
  const { shape, fill, color, sourceVisualKey } = props;
  const sourceOutlineAsset = sourceVisualKey ? SOURCE_OBJECT_VISUAL_ASSET_URLS[sourceVisualKey] : null;
  const shapeAssets = sourceVisualKey ? null : SOURCE_OBJECT_SHAPE_ASSET_URLS[shape];
  const edgeColor = color;
  const background = fill === "outline" ? "transparent" : `${color}2e`;

  return (
    <span
      aria-hidden="true"
      style={{
        position: "relative",
        display: "inline-flex",
        width: 24,
        height: 18,
        overflow: "hidden",
        flexShrink: 0,
        verticalAlign: "middle",
        lineHeight: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          inset: 0,
          display: "block",
          background: sourceOutlineAsset ? "transparent" : background,
          ...(sourceOutlineAsset ? {} : getSourceObjectMaskStyle(shapeAssets!.filled)),
        }}
      />
      <span
        style={{
          position: "absolute",
          inset: 0,
          display: "block",
          background: edgeColor,
          ...getSourceObjectMaskStyle(sourceOutlineAsset ?? shapeAssets!.outline),
        }}
      />
    </span>
  );
}

let pdfJsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import("pdfjs-dist").then((module) => {
      module.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;
      return module;
    });
  }
  return pdfJsPromise;
}

function normalizeSourceKindSelection(value: string | null | undefined): string {
  const normalized = (value ?? "").trim().toLowerCase();
  if (POSTGRES_SOURCE_KIND_OPTIONS.some((option) => option.value === normalized)) {
    return normalized;
  }
  return "text";
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  try {
    return formatCurrentDateTime(iso, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function maskedFileLabel(filePath: string): string {
  return filePath || "N/A";
}

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
  const decoder = new TextDecoder();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdSignature = 0x06054b50;
  const centralDirectorySignature = 0x02014b50;
  const localFileHeaderSignature = 0x04034b50;
  const maxCommentLength = 0xffff;
  const searchStart = Math.max(0, bytes.length - (22 + maxCommentLength));

  async function inflateCompressedData(compressed: Uint8Array, method: number): Promise<string | null> {
    if (method === 0) return decoder.decode(compressed);
    if (method !== 8) return null;
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const out = await new Response(stream).arrayBuffer();
    return decoder.decode(out);
  }

  for (let off = bytes.length - 22; off >= searchStart; off -= 1) {
    if (view.getUint32(off, true) !== eocdSignature) continue;
    const centralDirectorySize = view.getUint32(off + 12, true);
    const centralDirectoryOffset = view.getUint32(off + 16, true);
    const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
    if (centralDirectoryEnd > bytes.length) break;

    let cursor = centralDirectoryOffset;
    while (cursor + 46 <= centralDirectoryEnd) {
      if (view.getUint32(cursor, true) !== centralDirectorySignature) break;
      const method = view.getUint16(cursor + 10, true);
      const cSize = view.getUint32(cursor + 20, true);
      const fnLen = view.getUint16(cursor + 28, true);
      const extraLen = view.getUint16(cursor + 30, true);
      const commentLen = view.getUint16(cursor + 32, true);
      const localHeaderOffset = view.getUint32(cursor + 42, true);
      const nameStart = cursor + 46;
      const nameEnd = nameStart + fnLen;
      const fname = decoder.decode(bytes.slice(nameStart, nameEnd));
      if (fname === target) {
        if (localHeaderOffset + 30 > bytes.length) return null;
        if (view.getUint32(localHeaderOffset, true) !== localFileHeaderSignature) return null;
        const localFnLen = view.getUint16(localHeaderOffset + 26, true);
        const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
        const dataOff = localHeaderOffset + 30 + localFnLen + localExtraLen;
        const compressed = bytes.slice(dataOff, dataOff + cSize);
        return inflateCompressedData(compressed, method);
      }
      cursor = nameEnd + extraLen + commentLen;
    }
  }

  return null;
}

function extractWordXmlText(xml: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    return xml
      .replace(/<w:tab[^>]*\/>/g, "\t")
      .replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<w:cr[^>]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/ {2,}/g, " ")
      .trim();
  }

  const wordNs = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const paragraphs = Array.from(doc.getElementsByTagNameNS(wordNs, "p"));
  const lines = paragraphs.map((paragraph) => {
    let text = "";
    for (const node of Array.from(paragraph.getElementsByTagName("*"))) {
      if (node.namespaceURI !== wordNs) continue;
      if (node.localName === "t") text += node.textContent ?? "";
      else if (node.localName === "tab") text += "\t";
      else if (node.localName === "br" || node.localName === "cr") text += "\n";
    }
    return text.replace(/ {2,}/g, " ").trimEnd();
  });
  return lines.filter((line, index) => line || index < lines.length - 1).join("\n").trim();
}

async function extractDocxText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const xml = await findZipEntry(bytes, "word/document.xml");
  if (!xml) return "";
  return extractWordXmlText(xml);
}

async function extractPdfText(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  const pdfjsLib = await loadPdfJs();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const parts: string[] = [];
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const content = await page.getTextContent();
    parts.push(
      content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" "),
    );
  }
  return parts.join("\n").replace(/ {2,}/g, " ").trim();
}

async function extractTextFromFile(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "txt" || ext === "csv") return file.text();
  if (ext === "rtf") return stripRtf(await file.text());
  if (ext === "docx") return extractDocxText(file);
  if (ext === "pdf") return extractPdfText(file);
  throw new Error(`File type ".${ext}" is not supported.`);
}

function sourceImportFileExtension(file: File): string {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

function shouldExtractTextFromUploadFile(file: File): boolean {
  return SOURCE_IMPORT_TEXT_EXTS.has(sourceImportFileExtension(file));
}

function inferSourceKindFromUploadFile(file: File): string | null {
  const ext = sourceImportFileExtension(file);
  const mediaType = file.type.toLowerCase();
  if (SOURCE_IMPORT_IMAGE_EXTS.has(ext) || mediaType.startsWith("image/")) return "image";
  if (SOURCE_IMPORT_AUDIO_EXTS.has(ext) || mediaType.startsWith("audio/")) return "audio";
  if (SOURCE_IMPORT_VIDEO_EXTS.has(ext) || mediaType.startsWith("video/")) return "video";
  return null;
}

function describeUploadProcessing(file: File): string {
  const ext = sourceImportFileExtension(file);
  if (shouldExtractTextFromUploadFile(file)) return "Text will be extracted for coding.";
  if (ext === "pdf") return "PDF will be stored as an original file without text extraction.";
  if (inferSourceKindFromUploadFile(file) === "image") return "Image will be stored as original media without text extraction.";
  if (inferSourceKindFromUploadFile(file) === "audio") return "Audio will be stored as original media without text extraction.";
  if (inferSourceKindFromUploadFile(file) === "video") return "Video will be stored as original media without text extraction.";
  return "Original file will be stored without text extraction.";
}

function inferUploadMediaType(file: File): string | null {
  if (file.type.trim()) return file.type;
  const ext = sourceImportFileExtension(file);
  return mediaTypeFromFileExtension(ext);
}

function mediaTypeFromFileExtension(ext: string): string | null {
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "bmp") return "image/bmp";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  if (ext === "m4a" || ext === "aac") return "audio/mp4";
  if (ext === "ogg") return "audio/ogg";
  if (ext === "flac") return "audio/flac";
  if (ext === "mp4" || ext === "m4v") return "video/mp4";
  if (ext === "mov") return "video/quicktime";
  if (ext === "avi") return "video/x-msvideo";
  if (ext === "mkv") return "video/x-matroska";
  if (ext === "webm") return "video/webm";
  return null;
}

function uploadTabAcceptValue(tab: SourceUploadTab): string {
  if (tab === "text") return ".txt,.rtf,.docx,.csv";
  if (tab === "pdf") return ".pdf,application/pdf";
  if (tab === "image") return "image/*,.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg";
  if (tab === "audio") return "audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac";
  return "video/*,.mp4,.mov,.avi,.mkv,.webm,.m4v";
}

function uploadTabHint(tab: SourceUploadTab): string {
  if (tab === "text") return "txt / rtf / docx / csv";
  if (tab === "pdf") return "pdf";
  if (tab === "image") return "png / jpg / gif / webp / bmp / svg";
  if (tab === "audio") return "mp3 / wav / m4a / aac / ogg / flac";
  return "mp4 / mov / avi / mkv / webm / m4v";
}

function uploadTabForFile(file: File): SourceUploadTab | null {
  const ext = sourceImportFileExtension(file);
  const mediaType = file.type.toLowerCase();
  if (SOURCE_IMPORT_TEXT_EXTS.has(ext)) return "text";
  if (ext === "pdf" || mediaType === "application/pdf") return "pdf";
  if (SOURCE_IMPORT_IMAGE_EXTS.has(ext) || mediaType.startsWith("image/")) return "image";
  if (SOURCE_IMPORT_AUDIO_EXTS.has(ext) || mediaType.startsWith("audio/")) return "audio";
  if (SOURCE_IMPORT_VIDEO_EXTS.has(ext) || mediaType.startsWith("video/")) return "video";
  return null;
}

function fileMatchesUploadTab(file: File, tab: SourceUploadTab): boolean {
  return uploadTabForFile(file) === tab;
}

function preliminarySourceTitleFromFileName(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, "").trim();
}

function sourceUploadFileTypeLabel(file: File): string {
  const ext = sourceImportFileExtension(file);
  if (ext === "pdf") return "PDF";
  if (SOURCE_IMPORT_IMAGE_EXTS.has(ext)) return "Image";
  if (SOURCE_IMPORT_VIDEO_EXTS.has(ext)) return "Video";
  if (SOURCE_IMPORT_TEXT_EXTS.has(ext)) return ext.toUpperCase();
  if (file.type.startsWith("image/")) return "Image";
  if (file.type.startsWith("video/")) return "Video";
  return ext ? ext.toUpperCase() : "File";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const name = normalized.split("/").pop();
  return name && name.trim() ? name : "Dropped file";
}

function fileExtensionFromPath(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function isAbsoluteStoragePath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("/");
}

function resolveProjectStoragePath(projectStoragePath: string, sourceStoragePath: string): string {
  const trimmedSourcePath = sourceStoragePath.trim();
  if (!trimmedSourcePath) return "";
  if (isAbsoluteStoragePath(trimmedSourcePath)) return trimmedSourcePath;
  const trimmedProjectPath = projectStoragePath.trim().replace(/[\\/]+$/, "");
  if (!trimmedProjectPath) return trimmedSourcePath;
  const normalizedSourcePath = trimmedSourcePath.replace(/^([\\/])+/, "");
  return `${trimmedProjectPath}\\${normalizedSourcePath.replace(/\//g, "\\")}`;
}

async function readDroppedFile(path: string): Promise<File> {
  const bytes = await readTauriFile(path);
  return new File([bytes], fileNameFromPath(path));
}

function valueKey(sourceId: string, attributeDefinitionId: string): string {
  return `${sourceId}:${attributeDefinitionId}`;
}

function sourceTypeRowLabel(label: string): string {
  const cleaned = label
    .replace(/\bsources?\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || label;
}

function sourceKindFromFilterValue(value: string): string | null {
  const normalized = normalizeSourceKindFilterValue(value);
  const visualEntry = Object.entries(POSTGRES_SOURCE_KIND_VISUALS)
    .find(([, visual]) => visual.systemKey === normalized);
  if (visualEntry) return visualEntry[1].label;
  const option = POSTGRES_SOURCE_KIND_OPTIONS.find((entry) => entry.value === normalized || entry.label.toLowerCase() === normalized);
  return option?.label ?? null;
}

function sourceTypeOptionLabel(kind: string, fallbackLabel?: string): string {
  return sourceTypeRowLabel(
    fallbackLabel
      || POSTGRES_SOURCE_KIND_VISUALS[kind.toLowerCase()]?.label
      || POSTGRES_SOURCE_KIND_OPTIONS.find((option) => option.value === kind || option.label === kind)?.label
      || kind,
  );
}

function sourceKindDisplayLabel(kind: string, fallbackLabel?: string): string {
  return fallbackLabel || kind || "Source";
}

function normalizeAttributeOptions(options: string[]): string[] {
  return options.map((option) => option.trim()).filter(Boolean);
}

function normalizeSourceAttributeKinds(sourceKinds: string[]): string[] {
  const normalized = new Set(sourceKinds);
  if (normalized.has("Text") || normalized.has("text")) {
    normalized.add("Transcript");
  }
  return Array.from(normalized);
}

function SourceAttributeTypesModal({
  draft,
  sourceTypeOptions,
  saving,
  error,
  onCancel,
  onSave,
}: {
  draft: SourceAttributeDraft;
  sourceTypeOptions: Array<{ kind: string; label: string; count: number }>;
  saving: boolean;
  error?: string;
  onCancel: () => void;
  onSave: (draft: SourceAttributeDraft) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(draft.name);
  const [dataType, setDataType] = useState<SharedAttributeDataType>(draft.dataType);
  const [description, setDescription] = useState(draft.description);
  const [options, setOptions] = useState<string[]>(draft.options.length > 0 ? draft.options : ["", ""]);
  const [sourceKinds, setSourceKinds] = useState<string[]>(draft.sourceKinds);
  const typeOptions: Array<{ value: SharedAttributeDataType; label: string }> = [
    { value: "text", label: t("attributeModal.types.text") },
    { value: "number", label: t("attributeModal.types.number") },
    { value: "datetime", label: t("attributeModal.types.datetime") },
    { value: "categorical", label: t("attributeModal.types.categorical") },
  ];
  const normalizedOptions = normalizeAttributeOptions(options);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
        <h2>{draft.id ? t("attributeModal.editTitle") : t("attributeModal.createTitle")}</h2>
        <div className="attribute-values-details">
          <label className="form-group">
            <span className="form-label">{t("attributeModal.attributeName")}</span>
            <input className="form-input" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <div className="form-group attribute-details-span">
            <span className="form-label">{t("attributeModal.dataType")}</span>
            <div className="attribute-type-picker">
              {typeOptions.map((option) => (
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
            <span className="form-label">{t("attributeModal.description")}</span>
            <textarea
              className="form-input attribute-description-input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
            />
          </label>
          {dataType === "categorical" ? (
            <div className="form-group attribute-details-span">
              <span className="form-label">{t("attributeModal.categories")}</span>
              <div className="attribute-category-list">
                {options.map((option, index) => (
                  <input
                    key={index}
                    className="form-input"
                    value={option}
                    onChange={(event) => setOptions((current) => current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))}
                    placeholder={t("attributeModal.categoryPlaceholder", { index: index + 1 })}
                  />
                ))}
              </div>
              <button type="button" className="btn btn--small" onClick={() => setOptions((current) => [...current, ""])}>
                {t("attributeModal.addMore")}
              </button>
            </div>
          ) : null}
        </div>
        <div className="attribute-values-list">
          {sourceTypeOptions.length === 0 ? (
            <p className="case-card-empty">No source types yet.</p>
          ) : (
            sourceTypeOptions.map((option) => (
              <label key={option.kind} className="attribute-value-row">
                <span>{option.label}</span>
                <input
                  type="checkbox"
                  checked={sourceKinds.includes(option.kind)}
                  onChange={(event) => {
                    setSourceKinds((current) => event.target.checked
                      ? [...current, option.kind]
                      : current.filter((kind) => kind !== option.kind));
                  }}
                />
              </label>
            ))
          )}
        </div>
        {error ? <div className="form-error" style={{ marginTop: 16 }}>{error}</div> : null}
        <div className="form-actions" style={{ marginTop: 20 }}>
          <button className="btn" onClick={onCancel} disabled={saving}>{t("common.cancel")}</button>
          <button
            className="btn btn--primary"
            onClick={() => onSave({
              ...draft,
              name: name.trim(),
              dataType,
              description: description.trim(),
              options: normalizedOptions,
              sourceKinds,
            })}
            disabled={saving || !name.trim() || sourceKinds.length === 0 || (dataType === "categorical" && normalizedOptions.length < 2)}
          >
            {saving ? t("attributeModal.saving") : t("attributeModal.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function describeSourceLock(
  lock: PostgresSourceLock | null | undefined,
  currentUserId: string,
): { label: string; title: string } {
  if (!lock) {
    return {
      label: "Available",
      title: "This source is currently available for coding.",
    };
  }
  if (lock.userId === currentUserId) {
    return {
      label: "You",
      title: "You are currently holding this source lock.",
    };
  }
  return {
    label: "Locked",
    title: `${lock.userName || "Another user"} is currently holding this source lock.`,
  };
}

function formatAttributeDisplay(value: string, dataType: SharedAttributeDataType): string {
  if (!value) return "";
  if (dataType === "datetime") {
    try {
      return formatCurrentDateTime(value, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return value;
    }
  }
  return value;
}

function relationshipTypeAllowsSourceEndpoint(
  relationshipType: PostgresRelationshipType,
  endpoint: "from" | "to",
  sourceKind: string,
): boolean {
  const objectTypeIds = endpoint === "from" ? relationshipType.fromObjectTypeIds : relationshipType.toObjectTypeIds;
  const sourceKinds = endpoint === "from" ? relationshipType.fromSourceKinds : relationshipType.toSourceKinds;
  const normalizedSourceKinds = new Set(sourceKinds.map(normalizeSourceKindFilterValue));
  const normalizedSourceKind = normalizeSourceKindFilterValue(sourceKind);
  if (normalizedSourceKinds.size > 0) return normalizedSourceKinds.has(normalizedSourceKind);
  return objectTypeIds.length === 0;
}

function relationshipTypeAllowsObjectEndpoint(
  relationshipType: PostgresRelationshipType,
  endpoint: "from" | "to",
  objectTypeId: string,
): boolean {
  const objectTypeIds = endpoint === "from" ? relationshipType.fromObjectTypeIds : relationshipType.toObjectTypeIds;
  const sourceKinds = endpoint === "from" ? relationshipType.fromSourceKinds : relationshipType.toSourceKinds;
  if (objectTypeIds.length > 0) return objectTypeIds.includes(objectTypeId);
  return sourceKinds.length === 0;
}

function toRelationshipAttributePayload(
  definitions: PostgresRelationshipAttributeDefinition[],
  valuesByDefinitionId: Record<string, string>,
) {
  return definitions.map((definition) => ({
    attributeDefinitionId: definition.id,
    value: valuesByDefinitionId[definition.id] ?? "",
  }));
}

function buildCodeOptions(codes: PostgresCode[]): CodeOption[] {
  const childrenOf = new Map<string, PostgresCode[]>();
  const roots: PostgresCode[] = [];
  for (const code of codes) {
    if (code.parentCodeId) {
      const group = childrenOf.get(code.parentCodeId) ?? [];
      group.push(code);
      childrenOf.set(code.parentCodeId, group);
    } else {
      roots.push(code);
    }
  }
  const sortGroup = (group: PostgresCode[]) => {
    group.sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
      return left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
    });
  };
  sortGroup(roots);
  for (const group of childrenOf.values()) sortGroup(group);

  const result: CodeOption[] = [];
  const visit = (group: PostgresCode[], depth: number) => {
    for (const code of group) {
      result.push({
        id: code.id,
        label: `${"  ".repeat(depth)}${code.label}`,
        color: code.color,
      });
      visit(childrenOf.get(code.id) ?? [], depth + 1);
    }
  };
  visit(roots, 0);
  return result;
}

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
  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = initialHtml;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const contentStyle = minRows
    ? { height: `${minRows * 1.5}em`, overflowY: "auto" as const }
    : undefined;

  return (
    <div className="rte">
      <div
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

function SourceImportModal({
  importSettings,
  saving,
  error,
  onCancel,
  onSave,
}: {
  importSettings: {
    defaultMode: "upload" | "paste";
    autoNameFromFile: boolean;
    trimImportedText: boolean;
    warnBeforeEmptyImport: boolean;
    storeOriginalFileName: boolean;
  };
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (payload:
    | {
        mode: "paste";
        title: string;
        sourceKind: string;
        notes: string;
        content: string;
      }
    | {
        mode: "upload";
        items: Array<{
          file: File;
          title: string;
          sourceKind: string;
          extractedText: string;
        }>;
      }
  ) => Promise<void>;
}) {
  const [mode, setMode] = useState<"upload" | "paste">(importSettings.defaultMode);
  const [uploadTab, setUploadTab] = useState<SourceUploadTab>("text");
  const [title, setTitle] = useState("");
  const [sourceKind, setSourceKind] = useState("text");
  const [notes, setNotes] = useState("");
  const [uploadDrafts, setUploadDrafts] = useState<SourceUploadDraft[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractingDraftIds, setExtractingDraftIds] = useState<string[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pasteHasContent, setPasteHasContent] = useState(false);
  const pastedRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepthRef = useRef(0);

  function resetUploadState() {
    setUploadDrafts([]);
    setExtractError(null);
    setExtracting(false);
    setExtractingDraftIds([]);
    setReviewOpen(false);
    dragDepthRef.current = 0;
    setDragging(false);
  }

  function setModeAndReset(nextMode: "upload" | "paste") {
    setMode(nextMode);
    resetUploadState();
  }

  function setUploadTabAndReset(nextTab: SourceUploadTab) {
    setUploadTab(nextTab);
    resetUploadState();
    if (nextTab === "image") setSourceKind("image");
    else if (nextTab === "audio") setSourceKind("audio");
    else if (nextTab === "video") setSourceKind("video");
    else setSourceKind("text");
  }

  function setCreateMode(nextMode: "paste" | SourceUploadTab) {
    if (nextMode === "paste") {
      setModeAndReset("paste");
      return;
    }
    setMode("upload");
    setUploadTabAndReset(nextMode);
  }

  async function processFiles(nextFiles: File[]) {
    const validFiles = nextFiles.filter((file) => {
      const ext = sourceImportFileExtension(file);
      return SOURCE_IMPORT_ACCEPTED_EXTS.has(ext);
    });
    const wrongTabFiles = validFiles.filter((file) => !fileMatchesUploadTab(file, uploadTab));
    const matchedFiles = validFiles.filter((file) => fileMatchesUploadTab(file, uploadTab));
    if (matchedFiles.length === 0) {
      const ext = sourceImportFileExtension(nextFiles[0] ?? new File([], ""));
      setExtractError(wrongTabFiles.length > 0
        ? `These files do not match the ${uploadTab.toUpperCase()} tab.`
        : `Unsupported file type ".${ext}".`);
      return;
    }

    setExtracting(true);
    setExtractError(null);
    try {
      const nextDrafts: SourceUploadDraft[] = [];
      for (const file of matchedFiles) {
        const inferredSourceKind = inferSourceKindFromUploadFile(file);
        const draftSourceKind = inferredSourceKind ?? (uploadTab === "pdf" ? "pdf" : sourceKind);
        const shouldExtractText = shouldExtractTextFromUploadFile(file);
        const extractedText = shouldExtractText
          ? (importSettings.trimImportedText ? (await extractTextFromFile(file)).trim() : await extractTextFromFile(file))
          : "";
        nextDrafts.push({
          id: `${file.name}-${file.size}-${file.lastModified}`,
          file,
          title: preliminarySourceTitleFromFileName(file.name),
          sourceKind: draftSourceKind,
          extractedText,
          fileTypeLabel: sourceUploadFileTypeLabel(file),
          characterCount: shouldExtractText ? extractedText.length : null,
        });
      }
      setUploadDrafts(nextDrafts);
      if (wrongTabFiles.length > 0) {
        setExtractError(`Some files were skipped because they do not match the ${uploadTab.toUpperCase()} tab.`);
      }
    } catch {
      setExtractError("Could not read one or more file contents.");
      setUploadDrafts([]);
    } finally {
      setExtracting(false);
    }
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    setDragging(true);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    setDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragging(false);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files ?? []);
    if (dropped.length > 0) void processFiles(dropped);
  }

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    async function attachDragDropListener() {
      try {
        unlisten = await getCurrentWindow().onDragDropEvent(async (event) => {
          if (disposed || mode !== "upload") return;
          if (event.payload.type === "enter" || event.payload.type === "over") {
            setDragging(true);
            return;
          }
          if (event.payload.type === "leave") {
            dragDepthRef.current = 0;
            setDragging(false);
            return;
          }
          dragDepthRef.current = 0;
          setDragging(false);
          const paths = event.payload.paths;
          if (paths.length === 0) return;
          try {
            const droppedFiles = await Promise.all(paths.map((path) => readDroppedFile(path)));
            await processFiles(droppedFiles);
          } catch (nextError) {
            setExtractError(nextError instanceof Error ? nextError.message : "Could not read dropped file.");
          }
        });
      } catch {
        // Browser builds rely on the DOM drag/drop handlers.
      }
    }

    void attachDragDropListener();
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [mode, uploadTab, sourceKind, importSettings.trimImportedText]);

  useEffect(() => {
    if (mode !== "upload" || uploadTab !== "text") return;
    setUploadDrafts((current) => current.map((draft) => ({ ...draft, sourceKind })));
  }, [mode, sourceKind, uploadTab]);

  const canSubmit = mode === "paste"
    ? title.trim().length > 0 && pasteHasContent
    : uploadDrafts.length > 0;

  const reviewSourceTypeLabel = (kind: string) =>
    kind === "pdf"
      ? "PDF"
      : POSTGRES_SOURCE_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind;

  function updateUploadDraftTitle(draftId: string, nextTitle: string) {
    setUploadDrafts((current) => current.map((draft) => (
      draft.id === draftId
        ? { ...draft, title: nextTitle }
        : draft
    )));
  }

  async function updateUploadDraftSourceKind(draftId: string, nextSourceKind: string) {
    const draft = uploadDrafts.find((item) => item.id === draftId) ?? null;
    if (!draft) return;

    if (nextSourceKind === draft.sourceKind) return;

    if (nextSourceKind === "pdf") {
      setUploadDrafts((current) => current.map((item) => (
        item.id === draftId
          ? { ...item, sourceKind: "pdf", extractedText: "", characterCount: null }
          : item
      )));
      return;
    }

    if (nextSourceKind !== "text") {
      setUploadDrafts((current) => current.map((item) => (
        item.id === draftId
          ? { ...item, sourceKind: nextSourceKind }
          : item
      )));
      return;
    }

    setExtractError(null);
    setExtractingDraftIds((current) => [...current, draftId]);
    try {
      const extractedText = importSettings.trimImportedText
        ? (await extractTextFromFile(draft.file)).trim()
        : await extractTextFromFile(draft.file);
      setUploadDrafts((current) => current.map((item) => (
        item.id === draftId
          ? {
              ...item,
              sourceKind: "text",
              extractedText,
              characterCount: extractedText.length,
            }
          : item
      )));
    } catch {
      setExtractError(`Could not extract text from ${draft.file.name}.`);
      setUploadDrafts((current) => current.map((item) => (
        item.id === draftId
          ? { ...item, sourceKind: "pdf", extractedText: "", characterCount: null }
          : item
      )));
    } finally {
      setExtractingDraftIds((current) => current.filter((item) => item !== draftId));
    }
  }

  return (
    <>
      <div className="modal-overlay" onClick={() => !saving && onCancel()}>
        <div
          className={`modal doc-upload-modal${mode === "paste" ? " doc-upload-modal--text-entry" : ""}`}
          onClick={(event) => event.stopPropagation()}
        >
        <div className="doc-upload-modal-title-row">
          <h2>New Source</h2>
          <div className="segmented-control">
            <button
              type="button"
              className={`segmented-control-option${mode === "upload" && uploadTab === "text" ? " segmented-control-option--active" : ""}`}
              onClick={() => setCreateMode("text")}
            >
              Text
            </button>
            <button
              type="button"
              className={`segmented-control-option${mode === "upload" && uploadTab === "pdf" ? " segmented-control-option--active" : ""}`}
              onClick={() => setCreateMode("pdf")}
            >
              PDF
            </button>
            <button
              type="button"
              className={`segmented-control-option${mode === "upload" && uploadTab === "image" ? " segmented-control-option--active" : ""}`}
              onClick={() => setCreateMode("image")}
            >
              Image
            </button>
            <button
              type="button"
              className={`segmented-control-option${mode === "upload" && uploadTab === "audio" ? " segmented-control-option--active" : ""}`}
              onClick={() => setCreateMode("audio")}
            >
              Audio
            </button>
            <button
              type="button"
              className={`segmented-control-option${mode === "upload" && uploadTab === "video" ? " segmented-control-option--active" : ""}`}
              onClick={() => setCreateMode("video")}
            >
              Video
            </button>
            <button
              type="button"
              className={`segmented-control-option${mode === "paste" ? " segmented-control-option--active" : ""}`}
              onClick={() => setCreateMode("paste")}
            >
              Text Entry
            </button>
          </div>
        </div>
        <div className="form">
          {mode === "upload" ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept={uploadTabAcceptValue(uploadTab)}
                multiple
                style={{ display: "none" }}
                onChange={(event) => {
                  const nextFiles = Array.from(event.target.files ?? []);
                  if (nextFiles.length > 0) void processFiles(nextFiles);
                  event.target.value = "";
                }}
              />
              <div
                className={`doc-dropzone${dragging ? " doc-dropzone--drag" : ""}${uploadDrafts.length > 0 ? " doc-dropzone--filled" : ""}`}
                onClick={() => !uploadDrafts.length && fileInputRef.current?.click()}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={onDrop}
              >
                {extracting ? (
                  <span className="doc-dropzone-primary">Reading files...</span>
                ) : uploadDrafts.length === 0 ? (
                  <>
                    <span className="doc-dropzone-icon">^</span>
                    <span className="doc-dropzone-primary">Click to browse or drag and drop files</span>
                    <span className="doc-dropzone-hint">{uploadTabHint(uploadTab)}</span>
                  </>
                ) : (
                  <>
                    <span className="doc-dropzone-filename">{formatCurrentNumber(uploadDrafts.length)} file(s) ready</span>
                    {extractError
                      ? <span className="doc-dropzone-warn">{extractError}</span>
                      : <span className="doc-dropzone-hint">{uploadDrafts[0] ? describeUploadProcessing(uploadDrafts[0].file) : uploadTabHint(uploadTab)}</span>}
                    <button
                      type="button"
                      className="doc-dropzone-change"
                      onClick={(event) => {
                        event.stopPropagation();
                        resetUploadState();
                        fileInputRef.current?.click();
                      }}
                    >
                      Change Files
                    </button>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <label className="form-label">
                Title
                <input
                  className="form-input"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  autoFocus
                />
              </label>
              <label className="form-label">
                Notes
                <textarea className="form-input" rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} />
              </label>
              <RichTextEditor
                initialHtml=""
                editorRef={pastedRef}
                minRows={14}
                onChange={() => setPasteHasContent(!!(pastedRef.current?.textContent?.trim()))}
              />
            </>
          )}

          {(error || extractError) && <p className="auth-error">{error ?? extractError}</p>}
          <div className="form-actions">
            <button className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
            <button
              className="btn btn--primary"
              disabled={saving || !canSubmit}
              onClick={() => {
                if (mode === "paste") {
                  const rawContent = pastedRef.current?.innerHTML ?? "";
                  const content = importSettings.trimImportedText ? rawContent.trim() : rawContent;
                  void onSave({
                    mode,
                    title: title.trim(),
                    sourceKind,
                    notes,
                    content,
                  });
                  return;
                }
                setReviewOpen(true);
              }}
            >
              {saving ? "Saving..." : mode === "upload" ? "Create Source" : "Create Source"}
            </button>
          </div>
        </div>
        </div>
      </div>
      {reviewOpen ? (
        <div className="modal-overlay" onClick={() => !saving && setReviewOpen(false)}>
          <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
            <h2>Approve Sources</h2>
            <p className="users-guide-copy" style={{ marginTop: 0, marginBottom: 16 }}>
              Review these files before creating sources.
            </p>
            <div className="users-table-wrap">
              <table className="users-table">
                <thead>
                  <tr>
                    <th className="users-th" style={{ width: "28%", cursor: "default" }}>Original Filename</th>
                    <th className="users-th" style={{ width: "14%", cursor: "default" }}>File Type</th>
                    <th className="users-th" style={{ width: "18%", cursor: "default" }}>Source Type</th>
                    <th className="users-th" style={{ width: "12%", cursor: "default" }}>Characters</th>
                    <th className="users-th" style={{ width: "28%", cursor: "default" }}>Preliminary Title</th>
                  </tr>
                </thead>
                <tbody>
                  {uploadDrafts.map((draft) => (
                    <tr key={draft.id}>
                      <td className="users-td users-td--name">{draft.file.name}</td>
                      <td className="users-td users-td--muted">{draft.fileTypeLabel}</td>
                      <td className="users-td">
                        <select
                          className="form-input"
                          value={draft.sourceKind}
                          disabled={saving || extractingDraftIds.includes(draft.id) || uploadTab !== "pdf"}
                          onChange={(event) => {
                            void updateUploadDraftSourceKind(draft.id, event.target.value);
                          }}
                        >
                          {uploadTab === "pdf" ? (
                            <>
                              <option value="pdf">PDF</option>
                              <option value="text">Text</option>
                            </>
                          ) : (
                            <option value={draft.sourceKind}>{reviewSourceTypeLabel(draft.sourceKind)}</option>
                          )}
                        </select>
                        {uploadTab === "pdf" && extractingDraftIds.includes(draft.id) ? (
                          <div className="postgres-users-meta" style={{ marginTop: 6 }}>Extracting text...</div>
                        ) : null}
                      </td>
                      <td className="users-td users-td--muted">
                        {draft.characterCount != null ? formatCurrentNumber(draft.characterCount) : "—"}
                      </td>
                      <td className="users-td">
                        <input
                          className="form-input"
                          value={draft.title}
                          onChange={(event) => updateUploadDraftTitle(draft.id, event.target.value)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(error || extractError) && <p className="auth-error">{error ?? extractError}</p>}
            <div className="form-actions" style={{ marginTop: 20 }}>
              <button className="btn" onClick={() => setReviewOpen(false)} disabled={saving}>Back</button>
              <button
                className="btn btn--primary"
                disabled={saving || uploadDrafts.length === 0 || extractingDraftIds.length > 0}
                onClick={() => {
                  void onSave({
                    mode: "upload",
                    items: uploadDrafts.map((draft) => ({
                      file: draft.file,
                      title: draft.title,
                      sourceKind: draft.sourceKind,
                      extractedText: draft.sourceKind === "text" ? draft.extractedText : "",
                    })),
                  });
                }}
              >
                {saving ? "Creating..." : "Approve and Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function SourceEditorModal({
  title,
  initialRow,
  attributeDefinitions,
  attributeValuesByDefinitionId,
  saving,
  error,
  onCancel,
  onSave,
}: {
  title: string;
  initialRow?: SourceRow | null;
  attributeDefinitions: PostgresSourceAttributeDefinition[];
  attributeValuesByDefinitionId: Record<string, string>;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (payload: {
    sourceKind: string;
    name: string;
    notes: string;
    content: string;
    attributeValuesByDefinitionId: Record<string, string>;
  }) => void;
}) {
  const [activeTab, setActiveTab] = useState<"details" | "attributes">("details");
  const [sourceKind, setSourceKind] = useState(normalizeSourceKindSelection(initialRow?.type));
  const [name, setName] = useState(initialRow?.name || "");
  const [notes, setNotes] = useState(initialRow?.notes || "");
  const [content, setContent] = useState(initialRow?.content || "");
  const [attributeDraftValues, setAttributeDraftValues] = useState<Record<string, string>>(() => ({
    ...attributeValuesByDefinitionId,
  }));

  function updateAttributeValue(attributeDefinitionId: string, value: string) {
    setAttributeDraftValues((current) => ({
      ...current,
      [attributeDefinitionId]: value,
    }));
  }

  return (
    <div className="modal-overlay" onClick={() => !saving && onCancel()}>
      <div className="modal modal--wide assoc-doc-modal" onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        <div className="segmented-control modal-segmented-control" role="tablist" aria-label="Source editor tabs">
          <button
            type="button"
            className={activeTab === "details" ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
            onClick={() => setActiveTab("details")}
          >
            Details
          </button>
          <button
            type="button"
            className={activeTab === "attributes" ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
            onClick={() => setActiveTab("attributes")}
          >
            Attributes
          </button>
        </div>
        <div className="form">
          {activeTab === "details" ? (
            <>
              <label className="form-label">
                Source Type
                <select className="form-input" value={sourceKind} onChange={(event) => setSourceKind(event.target.value)}>
                  {POSTGRES_SOURCE_KIND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-label">
                Title
                <input className="form-input" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
              </label>
              <label className="form-label">
                Notes
                <textarea className="form-input" rows={5} value={notes} onChange={(event) => setNotes(event.target.value)} />
              </label>
              <label className="form-label">
                Content
                <textarea className="form-input" rows={14} value={content} onChange={(event) => setContent(event.target.value)} />
              </label>
            </>
          ) : attributeDefinitions.length === 0 ? (
            <p className="case-card-empty">No source attributes have been created yet.</p>
          ) : (
            <div className="case-detail-attributes-table-wrap">
              <table className="case-detail-attributes-table">
                <thead>
                  <tr>
                    <th className="case-detail-attributes-label" scope="col">Attribute</th>
                    <th className="case-detail-attributes-value" scope="col">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {attributeDefinitions.map((definition) => (
                    <tr key={definition.id}>
                      <th className="case-detail-attributes-label" scope="row">{definition.name}</th>
                      <td className="case-detail-attributes-value">
                        {definition.dataType === "categorical" ? (
                          <select
                            className="form-input"
                            value={attributeDraftValues[definition.id] ?? ""}
                            onChange={(event) => updateAttributeValue(definition.id, event.target.value)}
                          >
                            <option value="">-</option>
                            {definition.options.map((option) => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className="form-input"
                            type={definition.dataType === "number" ? "number" : definition.dataType === "datetime" ? "datetime-local" : "text"}
                            step={definition.dataType === "number" ? "any" : undefined}
                            value={attributeDraftValues[definition.id] ?? ""}
                            onChange={(event) => updateAttributeValue(definition.id, event.target.value)}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {error && <p className="auth-error">{error}</p>}
        <div className="form-actions">
          <button className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
          <button
            className="btn btn--primary"
            onClick={() => onSave({ sourceKind, name, notes, content, attributeValuesByDefinitionId: attributeDraftValues })}
            disabled={saving || !name.trim()}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SourceObjectsModal({
  sourceName,
  objects,
  selectedObjectIds,
  saving,
  error,
  onCancel,
  onSave,
}: {
  sourceName: string;
  objects: SourceObjectRow[];
  selectedObjectIds: string[];
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (objectIds: string[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(selectedObjectIds));

  useEffect(() => {
    setSelected(new Set(selectedObjectIds));
  }, [selectedObjectIds]);

  function toggleObject(objectId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(objectId)) next.delete(objectId);
      else next.add(objectId);
      return next;
    });
  }

  return (
    <div className="modal-overlay" onClick={() => !saving && onCancel()}>
      <div className="modal modal--wide assoc-doc-modal" onClick={(event) => event.stopPropagation()}>
        <h2>Associate Objects</h2>
        <p className="users-guide-copy" style={{ marginBottom: 16 }}>
          Choose the research objects linked to <strong>{sourceName}</strong>.
        </p>
        {objects.length === 0 ? (
          <p className="case-card-empty">Create research objects before associating them with this source.</p>
        ) : (
          <div
            style={{
              maxHeight: 320,
              overflow: "auto",
              border: "1px solid var(--color-border, rgba(53, 80, 112, 0.14))",
              borderRadius: 12,
              padding: 10,
              background: "rgba(255,255,255,0.92)",
            }}
          >
            {objects.map((object) => (
              <label
                key={object.id}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(object.id)}
                  onChange={() => toggleObject(object.id)}
                />
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span>{object.title}</span>
                  <span className="users-guide-copy" style={{ margin: 0 }}>
                    {object.objectType || "Object"}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
        {error && <p className="auth-error">{error}</p>}
        <div className="form-actions">
          <button className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
          <button
            className="btn btn--primary"
            onClick={() => void onSave([...selected])}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save Associations"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateSourceRelationshipModal({
  source,
  projectId,
  sources,
  objects,
  relationshipTypes,
  relationshipAttributeDefinitions,
  saving,
  error,
  onCancel,
  onRelationshipTypeCreated,
  onSave,
}: {
  source: SourceRow;
  projectId: string;
  sources: SourceRow[];
  objects: PostgresObject[];
  relationshipTypes: PostgresRelationshipType[];
  relationshipAttributeDefinitions: PostgresRelationshipAttributeDefinition[];
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onRelationshipTypeCreated: (
    relationshipType: PostgresRelationshipType,
    attributeDefinitions: PostgresRelationshipAttributeDefinition[],
  ) => void;
  onSave: (payload: {
    relationshipTypeId: string;
    fromEntityType: "object" | "source";
    fromEntityId: string;
    toEntityType: "object" | "source";
    toEntityId: string;
    description: string;
    lineShapeOverride?: string | null;
    lineWeightOverride?: number | null;
    arrowheadOverride?: string | null;
    colorOverride?: string | null;
    attributeValues: Array<{ attributeDefinitionId: string; value: string }>;
  }) => Promise<void>;
}) {
  const availableRelationshipTypes = useMemo(
    () => [...relationshipTypes].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" })),
    [relationshipTypes],
  );
  const [relationshipTypeId, setRelationshipTypeId] = useState(availableRelationshipTypes[0]?.id ?? "");
  const selectedRelationshipType = relationshipTypes.find((relationshipType) => relationshipType.id === relationshipTypeId) ?? null;
  const [fromEntityType, setFromEntityType] = useState<"object" | "source">("source");
  const [fromEntityId, setFromEntityId] = useState(source.id);
  const [toEntityType, setToEntityType] = useState<"object" | "source">("object");
  const [toEntityId, setToEntityId] = useState("");
  const [modalTab, setModalTab] = useState<"details" | "graphics" | "attributes">("details");
  const [description, setDescription] = useState("");
  const [lineShapeOverride, setLineShapeOverride] = useState("");
  const [lineWeightOverride, setLineWeightOverride] = useState<number | null>(null);
  const [arrowheadOverride, setArrowheadOverride] = useState("");
  const [colorOverride, setColorOverride] = useState("");
  const [attributeValues, setAttributeValues] = useState<Record<string, string>>({});
  const [newTypeOpen, setNewTypeOpen] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");
  const [newTypeError, setNewTypeError] = useState("");
  const [newTypeSaving, setNewTypeSaving] = useState(false);

  const fromEndpointOptions = useMemo<SharedPostgresRelationshipEndpointOption[]>(() => {
    if (!selectedRelationshipType) return [];
    return [
      ...objects
        .filter((object) => relationshipTypeAllowsObjectEndpoint(selectedRelationshipType, "from", object.objectTypeId))
        .sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: "base" }))
        .map((object) => ({
          key: `object:${object.id}`,
          entityType: "object" as const,
          entityId: object.id,
          name: object.title,
          type: object.objectType || "Object",
        })),
      ...sources
        .filter((candidate) => relationshipTypeAllowsSourceEndpoint(selectedRelationshipType, "from", candidate.type))
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }))
        .map((candidate) => ({
          key: `source:${candidate.id}`,
          entityType: "source" as const,
          entityId: candidate.id,
          name: candidate.name,
          type: candidate.sourceObjectType || candidate.type || "Source",
        })),
    ].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  }, [objects, selectedRelationshipType, sources]);

  const toEndpointOptions = useMemo<SharedPostgresRelationshipEndpointOption[]>(() => {
    if (!selectedRelationshipType) return [];
    const fromKey = `${fromEntityType}:${fromEntityId}`;
    return [
      ...objects
        .filter((object) => relationshipTypeAllowsObjectEndpoint(selectedRelationshipType, "to", object.objectTypeId))
        .sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: "base" }))
        .map((object) => ({
          key: `object:${object.id}`,
          entityType: "object" as const,
          entityId: object.id,
          name: object.title,
          type: object.objectType || "Object",
        })),
      ...sources
        .filter((candidate) => relationshipTypeAllowsSourceEndpoint(selectedRelationshipType, "to", candidate.type))
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }))
        .map((candidate) => ({
          key: `source:${candidate.id}`,
          entityType: "source" as const,
          entityId: candidate.id,
          name: candidate.name,
          type: candidate.sourceObjectType || candidate.type || "Source",
        })),
    ].filter((option) => option.key !== fromKey)
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  }, [fromEntityId, fromEntityType, objects, selectedRelationshipType, sources]);

  const attributeDefinitionsForType = useMemo(
    () => relationshipAttributeDefinitions
      .filter((definition) => definition.relationshipTypeId === relationshipTypeId)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, undefined, { sensitivity: "base" })),
    [relationshipAttributeDefinitions, relationshipTypeId],
  );
  useEffect(() => {
    if (relationshipTypeId && availableRelationshipTypes.some((relationshipType) => relationshipType.id === relationshipTypeId)) return;
    setRelationshipTypeId(availableRelationshipTypes[0]?.id ?? "");
  }, [availableRelationshipTypes, relationshipTypeId]);

  useEffect(() => {
    if (fromEntityId && fromEndpointOptions.some((option) => option.entityType === fromEntityType && option.entityId === fromEntityId)) return;
    const preferredSource = fromEndpointOptions.find((option) => option.entityType === "source" && option.entityId === source.id);
    const nextOption = preferredSource ?? fromEndpointOptions[0] ?? null;
    setFromEntityType(nextOption?.entityType ?? "source");
    setFromEntityId(nextOption?.entityId ?? "");
  }, [fromEndpointOptions, fromEntityId, fromEntityType, source.id]);

  useEffect(() => {
    if (toEntityId && toEndpointOptions.some((option) => option.entityType === toEntityType && option.entityId === toEntityId)) return;
    const nextOption = toEndpointOptions[0] ?? null;
    setToEntityType(nextOption?.entityType ?? "object");
    setToEntityId(nextOption?.entityId ?? "");
  }, [toEndpointOptions, toEntityId, toEntityType]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!relationshipTypeId || !fromEntityId || !toEntityId) return;
    void onSave({
      relationshipTypeId,
      fromEntityType,
      fromEntityId,
      toEntityType,
      toEntityId,
      description: description.trim(),
      lineShapeOverride: lineShapeOverride.trim() || null,
      lineWeightOverride,
      arrowheadOverride: arrowheadOverride.trim() || null,
      colorOverride: colorOverride.trim() || null,
      attributeValues: toRelationshipAttributePayload(attributeDefinitionsForType, attributeValues),
    });
  }

  async function handleCreateRelationshipType(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = newTypeName.trim();
    setNewTypeError("");
    if (!nextName) {
      setNewTypeError("Enter a relationship type name.");
      return;
    }
    const existingType = relationshipTypes.find((relationshipType) => relationshipType.name.toLowerCase() === nextName.toLowerCase());
    if (existingType) {
      setRelationshipTypeId(existingType.id);
      setAttributeValues({});
      setNewTypeName("");
      setNewTypeOpen(false);
      return;
    }

    setNewTypeSaving(true);
    try {
      const saved = await savePostgresRelationshipType({
        projectId,
        relationshipTypeId: null,
        name: nextName,
        description: "",
        lineShape: "solid",
        lineWeight: 2,
        arrowhead: "one_sided",
        color: "#355070",
        fromObjectTypeIds: [],
        toObjectTypeIds: [],
        fromSourceKinds: [],
        toSourceKinds: [],
        attributes: [],
      });
      onRelationshipTypeCreated(saved.relationshipType, saved.attributeDefinitions);
      setRelationshipTypeId(saved.relationshipType.id);
      setAttributeValues({});
      setNewTypeName("");
      setNewTypeOpen(false);
    } catch (createError) {
      setNewTypeError(createError instanceof Error ? createError.message : "Failed to create relationship type.");
    } finally {
      setNewTypeSaving(false);
    }
  }

  return (
    <>
      <PostgresRelationshipModal
        title="Create relationship"
        ariaLabel="Create relationship tabs"
        tab={modalTab}
        setTab={setModalTab}
        submitLabel="Create relationship"
        relationshipTypes={availableRelationshipTypes}
        relationshipTypeId={relationshipTypeId}
        setRelationshipTypeId={setRelationshipTypeId}
        selectedType={selectedRelationshipType}
        fromEndpointKey={fromEntityId ? `${fromEntityType}:${fromEntityId}` : ""}
        setFromEndpointKey={(key) => {
          if (typeof key !== "string") return;
          const [nextEntityType, ...nextIdParts] = key.split(":");
          const nextEntityId = nextIdParts.join(":");
          if ((nextEntityType === "object" || nextEntityType === "source") && nextEntityId) {
            setFromEntityType(nextEntityType);
            setFromEntityId(nextEntityId);
          }
        }}
        toEndpointKey={toEntityId ? `${toEntityType}:${toEntityId}` : ""}
        setToEndpointKey={(key) => {
          if (typeof key !== "string") return;
          const [nextEntityType, ...nextIdParts] = key.split(":");
          const nextEntityId = nextIdParts.join(":");
          if ((nextEntityType === "object" || nextEntityType === "source") && nextEntityId) {
            setToEntityType(nextEntityType);
            setToEntityId(nextEntityId);
          }
        }}
        availableFromEndpoints={fromEndpointOptions}
        availableToEndpoints={toEndpointOptions}
        description={description}
        setDescription={setDescription}
        lineShapeOverride={lineShapeOverride}
        setLineShapeOverride={setLineShapeOverride}
        lineWeightOverride={lineWeightOverride}
        setLineWeightOverride={setLineWeightOverride}
        arrowheadOverride={arrowheadOverride}
        setArrowheadOverride={setArrowheadOverride}
        colorOverride={colorOverride}
        setColorOverride={setColorOverride}
        attributeDefinitions={attributeDefinitionsForType}
        attributeValues={attributeValues}
        setAttributeValues={setAttributeValues}
        submitting={saving}
        error={availableRelationshipTypes.length === 0
          ? "No relationship types are available."
          : fromEndpointOptions.length === 0 && relationshipTypeId
            ? "No from endpoints match this relationship type."
            : toEndpointOptions.length === 0 && relationshipTypeId
              ? "No endpoints match this relationship type."
              : error}
        submitDisabled={!relationshipTypeId || !fromEntityId || !toEntityId}
        onClose={onCancel}
        onSubmit={handleSubmit}
        onNewRelationshipType={() => {
          setNewTypeError("");
          setNewTypeOpen(true);
        }}
      />
      {newTypeOpen ? (
        <div className="modal-overlay" style={{ zIndex: 120 }} onClick={() => !newTypeSaving && setNewTypeOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h2>Add relationship type</h2>
            <form className="form" onSubmit={handleCreateRelationshipType}>
              <label className="form-label">
                Relationship type name
                <input
                  className="form-input"
                  value={newTypeName}
                  onChange={(event) => setNewTypeName(event.target.value)}
                  autoFocus
                />
              </label>
              {newTypeError ? <p className="auth-error">{newTypeError}</p> : null}
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setNewTypeOpen(false)} disabled={newTypeSaving}>
                  Cancel
                </button>
                <button type="submit" className="btn btn--primary" disabled={newTypeSaving || !newTypeName.trim()}>
                  {newTypeSaving ? "Saving..." : "Add relationship type"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );

}

function PostgresSourceDetail({
  row,
  codeOptions,
  linkedObjects,
  relationships,
  attributeValues,
  availableObjects,
  currentUserId,
  sourceLock,
  sourceLockConflict,
  lockSyncing,
  canKickSourceLocks,
  canManageAnnotations,
  saving,
  error,
  onCreateAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onKickSourceLock,
  onCreateRelationship,
  onSaveSourceObjects,
  canManageSourceRecord,
  projectStoragePath,
  onOpenAttributeHistory,
  onEditSource,
  onDeleteSource,
  onBack,
}: {
  row: SourceRow;
  codeOptions: CodeOption[];
  linkedObjects: SourceObjectRow[];
  relationships: SourceRelationshipRow[];
  attributeValues: Array<SharedAttributeDraft & { value: string }>;
  availableObjects: SourceObjectRow[];
  currentUserId: string;
  sourceLock: PostgresSourceLock | null;
  sourceLockConflict: PostgresSourceLock | null;
  lockSyncing: boolean;
  canKickSourceLocks: boolean;
  canManageAnnotations: boolean;
  saving: boolean;
  error: string | null;
  onCreateAnnotation: (sourceId: string, selection: PendingSelection, payload: { codeIds: string[]; note: string }) => Promise<void>;
  onUpdateAnnotation: (annotation: SourceAnnotationRow, payload: { codeIds: string[]; note: string }) => Promise<void>;
  onDeleteAnnotation: (annotationId: string) => Promise<void>;
  onKickSourceLock: (lock: PostgresSourceLock) => Promise<void>;
  onCreateRelationship: () => void;
  onSaveSourceObjects: (sourceId: string, objectIds: string[]) => Promise<void>;
  canManageSourceRecord: boolean;
  projectStoragePath: string;
  onOpenAttributeHistory: (attribute: SharedAttributeDraft) => void;
  onEditSource: () => void;
  onDeleteSource: () => void;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [selectedOutlineSortOrder, setSelectedOutlineSortOrder] = useState<number | null>(null);
  const transcriptViewerRef = useRef<HTMLDivElement | null>(null);
  const contentSelectionRef = useRef<HTMLDivElement | null>(null);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const [editingAnnotation, setEditingAnnotation] = useState<SourceAnnotationRow | null>(null);
  const [removingAnnotation, setRemovingAnnotation] = useState<SourceAnnotationRow | null>(null);
  const [editingSourceObjects, setEditingSourceObjects] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [pdfPreviewError, setPdfPreviewError] = useState<string | null>(null);
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imagePreviewError, setImagePreviewError] = useState<string | null>(null);
  const [imagePreviewLoading, setImagePreviewLoading] = useState(false);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [audioPreviewError, setAudioPreviewError] = useState<string | null>(null);
  const [audioPreviewLoading, setAudioPreviewLoading] = useState(false);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [videoPreviewError, setVideoPreviewError] = useState<string | null>(null);
  const [videoPreviewLoading, setVideoPreviewLoading] = useState(false);
  const [textSizePx, setTextSizePx] = useState(SOURCE_TEXT_SIZE_DEFAULT_PX);
  const [textSearchOpen, setTextSearchOpen] = useState(false);
  const [textSearchQuery, setTextSearchQuery] = useState("");
  const [activeTextSearchIndex, setActiveTextSearchIndex] = useState<number | null>(null);
  const textSearchInputRef = useRef<HTMLInputElement | null>(null);

  const normalizedSourceType = normalizeSourceKindFilterValue(row.type);
  const fileExt = row.filePath ? fileExtensionFromPath(row.filePath) : "";
  const isPdfSource = normalizedSourceType === "pdf";
  const isImageSource = SOURCE_IMPORT_IMAGE_EXTS.has(fileExt) || row.type.toLowerCase() === "image";
  const isAudioSource = SOURCE_IMPORT_AUDIO_EXTS.has(fileExt) || row.type.toLowerCase() === "audio";
  const isVideoSource = SOURCE_IMPORT_VIDEO_EXTS.has(fileExt) || row.type.toLowerCase() === "video";
  const resolvedFilePath = resolveProjectStoragePath(projectStoragePath, row.filePath);
  const processedTranscriptSegments =
    normalizedSourceType === "transcript"
      ? parseProcessedTranscriptSegments(row.structuredContentJson)
      : [];
  const questionOutline = getProcessedTranscriptQuestionOutline(processedTranscriptSegments);
  const isSearchableTextSource = Boolean(row.content)
    && (
      normalizedSourceType === "text"
      || normalizedSourceType === "transcript"
    );
  const activeTextSearchQuery = textSearchOpen ? textSearchQuery.trim() : "";
  const textSearchMatches = useMemo(() => {
    if (!activeTextSearchQuery) return [];
    const matches: Array<{ startOffset: number; endOffset: number }> = [];
    const wildcardPattern = activeTextSearchQuery.replace(/\*/g, "")
      ? activeTextSearchQuery
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("\\S*?")
      : "\\S+";
    const searchRegex = new RegExp(wildcardPattern, "giu");
    let match: RegExpExecArray | null;
    while ((match = searchRegex.exec(row.content)) != null) {
      const startOffset = match.index;
      const endOffset = startOffset + match[0].length;
      matches.push({ startOffset, endOffset });
      if (match[0].length === 0) {
        searchRegex.lastIndex += 1;
      }
    }
    return matches;
  }, [activeTextSearchQuery, row.content]);
  const canEditAnnotations = canManageAnnotations && !!sourceLock && sourceLock.userId === currentUserId && !sourceLockConflict;
  const lockStatus = describeSourceLock(sourceLock, currentUserId);

  useEffect(() => {
    if (textSearchOpen) {
      window.setTimeout(() => textSearchInputRef.current?.focus(), 0);
    }
  }, [textSearchOpen]);

  useEffect(() => {
    if (textSearchMatches.length === 0) {
      setActiveTextSearchIndex(null);
      return;
    }
    setActiveTextSearchIndex(0);
  }, [activeTextSearchQuery, row.id, textSearchMatches.length]);

  useEffect(() => {
    if (activeTextSearchIndex == null) return;
    const container = transcriptViewerRef.current ?? contentSelectionRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>("[data-source-search-active='true']");
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.classList.add("source-search-match-flash");
    const timer = window.setTimeout(() => target.classList.remove("source-search-match-flash"), 1100);
    return () => window.clearTimeout(timer);
  }, [activeTextSearchIndex, textSearchMatches]);

  useEffect(() => {
    if (selectedOutlineSortOrder == null || !transcriptViewerRef.current) return;
    const target = transcriptViewerRef.current.querySelector<HTMLElement>(
      `[data-transcript-sort-order="${selectedOutlineSortOrder}"]`,
    );
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [selectedOutlineSortOrder]);

  useEffect(() => {
    if (!isPdfSource || !resolvedFilePath) {
      setPdfPreviewLoading(false);
      setPdfPreviewError(null);
      setPdfPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    setPdfPreviewLoading(true);
    setPdfPreviewError(null);

    void readTauriFile(resolvedFilePath)
      .then((bytes) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        setPdfPreviewUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return objectUrl;
        });
      })
      .catch((loadError) => {
        if (cancelled) return;
        setPdfPreviewError(loadError instanceof Error ? loadError.message : "Failed to load PDF preview.");
        setPdfPreviewUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return null;
        });
      })
      .finally(() => {
        if (!cancelled) setPdfPreviewLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isPdfSource, resolvedFilePath]);

  useEffect(() => {
    if (!isImageSource || !resolvedFilePath) {
      setImagePreviewLoading(false);
      setImagePreviewError(null);
      setImagePreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    setImagePreviewLoading(true);
    setImagePreviewError(null);

    void readTauriFile(resolvedFilePath)
      .then((bytes) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([bytes]));
        setImagePreviewUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return objectUrl;
        });
      })
      .catch((loadError) => {
        if (cancelled) return;
        setImagePreviewError(loadError instanceof Error ? loadError.message : "Failed to load image preview.");
        setImagePreviewUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return null;
        });
      })
      .finally(() => {
        if (!cancelled) setImagePreviewLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isImageSource, resolvedFilePath]);

  useEffect(() => {
    if (!isAudioSource || !resolvedFilePath) {
      setAudioPreviewLoading(false);
      setAudioPreviewError(null);
      setAudioPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    setAudioPreviewLoading(true);
    setAudioPreviewError(null);

    void readTauriFile(resolvedFilePath)
      .then((bytes) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: mediaTypeFromFileExtension(fileExt) ?? undefined }));
        setAudioPreviewUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return objectUrl;
        });
      })
      .catch((loadError) => {
        if (cancelled) return;
        setAudioPreviewError(loadError instanceof Error ? loadError.message : "Failed to load audio preview.");
        setAudioPreviewUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return null;
        });
      })
      .finally(() => {
        if (!cancelled) setAudioPreviewLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileExt, isAudioSource, resolvedFilePath]);

  useEffect(() => {
    if (!isVideoSource || !resolvedFilePath) {
      setVideoPreviewLoading(false);
      setVideoPreviewError(null);
      setVideoPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    setVideoPreviewLoading(true);
    setVideoPreviewError(null);

    void readTauriFile(resolvedFilePath)
      .then((bytes) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: mediaTypeFromFileExtension(fileExt) ?? undefined }));
        setVideoPreviewUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return objectUrl;
        });
      })
      .catch((loadError) => {
        if (cancelled) return;
        setVideoPreviewError(loadError instanceof Error ? loadError.message : "Failed to load video preview.");
        setVideoPreviewUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return null;
        });
      })
      .finally(() => {
        if (!cancelled) setVideoPreviewLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileExt, isVideoSource, resolvedFilePath]);

  function handleMouseUp() {
    if (!canEditAnnotations || !contentSelectionRef.current) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!contentSelectionRef.current.contains(range.commonAncestorContainer)) return;
    const quote = selection.toString();
    if (!quote.trim()) return;

    const preRange = document.createRange();
    preRange.selectNodeContents(contentSelectionRef.current);
    preRange.setEnd(range.startContainer, range.startOffset);
    const startOffset = preRange.toString().length;
    const endOffset = startOffset + quote.length;
    setPendingSelection({ startOffset, endOffset, quote });
    selection.removeAllRanges();
  }

  function decreaseTextSize() {
    setTextSizePx((current) => Math.max(SOURCE_TEXT_SIZE_MIN_PX, current - SOURCE_TEXT_SIZE_STEP_PX));
  }

  function increaseTextSize() {
    setTextSizePx((current) => Math.min(SOURCE_TEXT_SIZE_MAX_PX, current + SOURCE_TEXT_SIZE_STEP_PX));
  }

  function goToPreviousTextSearchMatch() {
    if (textSearchMatches.length === 0) return;
    setActiveTextSearchIndex((current) => {
      const currentIndex = current ?? 0;
      return (currentIndex - 1 + textSearchMatches.length) % textSearchMatches.length;
    });
  }

  function goToNextTextSearchMatch() {
    if (textSearchMatches.length === 0) return;
    setActiveTextSearchIndex((current) => {
      const currentIndex = current ?? -1;
      return (currentIndex + 1) % textSearchMatches.length;
    });
  }

  function renderSearchHighlightedText(text: string, absoluteStartOffset: number, keyPrefix: string) {
    if (textSearchMatches.length === 0) return text;
    const absoluteEndOffset = absoluteStartOffset + text.length;
    const overlappingMatches = textSearchMatches
      .map((match, index) => ({ ...match, index }))
      .filter((match) => match.startOffset < absoluteEndOffset && match.endOffset > absoluteStartOffset);
    if (overlappingMatches.length === 0) return text;

    const boundaries = new Set<number>([absoluteStartOffset, absoluteEndOffset]);
    for (const match of overlappingMatches) {
      boundaries.add(Math.max(absoluteStartOffset, match.startOffset));
      boundaries.add(Math.min(absoluteEndOffset, match.endOffset));
    }
    const orderedBoundaries = Array.from(boundaries).sort((left, right) => left - right);
    return orderedBoundaries.slice(0, -1).map((startOffset, partIndex) => {
      const endOffset = orderedBoundaries[partIndex + 1];
      const match = overlappingMatches.find((item) => item.startOffset <= startOffset && item.endOffset >= endOffset);
      const partText = text.slice(startOffset - absoluteStartOffset, endOffset - absoluteStartOffset);
      if (!match) return <span key={`${keyPrefix}-${startOffset}-${endOffset}`}>{partText}</span>;
      const isActive = match.index === activeTextSearchIndex;
      return (
        <mark
          key={`${keyPrefix}-${startOffset}-${endOffset}`}
          className={`source-search-match${isActive ? " source-search-match--active" : ""}`}
          data-source-search-active={isActive ? "true" : undefined}
        >
          {partText}
        </mark>
      );
    });
  }

  return (
    <div className="view doc-detail-view">
      <div className="workspace-back-row workspace-back-row--split">
        <button className="btn" onClick={onBack}>{t("projectDocuments.detail.backToDocuments")}</button>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {canManageSourceRecord ? (
            <>
              <button type="button" className="btn" onClick={onEditSource}>
                Edit Source
              </button>
              <button type="button" className="btn btn--danger" onClick={onDeleteSource}>
                Delete Source
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="doc-detail-layout">
        <div className="doc-detail-left">
          <div className="case-card">
            <h3 className="case-card-title">Source</h3>
            <p className="case-card-value">{row.name}</p>
            <p className="users-guide-copy" style={{ marginTop: 8, marginBottom: 0 }} title={lockStatus.title}>
              Lock: {lockStatus.label}
            </p>
          </div>

          <dl className="user-detail-meta case-detail-meta">
            <dt>{t("projectDocuments.columns.type")}</dt> <dd>{sourceKindDisplayLabel(row.type || "source", row.sourceObjectType)}</dd>
            <dt>{t("projectDocuments.columns.created")}</dt> <dd>{fmtDate(row.createdAt)}</dd>
            <dt>File Name</dt> <dd>{maskedFileLabel(row.filePath)}</dd>
            <dt>Extension</dt> <dd>{fileExt ? `.${fileExt}` : "—"}</dd>
            {isImageSource && row.extractedFromVideoSourceId ? (
              <>
                <dt>Extracted From Video</dt> <dd>{row.extractedFromVideoSourceId}</dd>
                <dt>Extracted Timestamp</dt> <dd>{row.extractedFromVideoTimeMs != null ? formatMediaTime(row.extractedFromVideoTimeMs) : "N/A"}</dd>
              </>
            ) : null}
            <dt>Objects</dt> <dd>{formatCurrentNumber(row.objectCount)}</dd>
            <dt>{t("projectCodebook.detail.annotations")}</dt> <dd>{formatCurrentNumber(row.annotationCount)}</dd>
          </dl>

          <div className="case-card">
            <h3 className="case-card-title">{t("projectDocuments.detail.description")}</h3>
            {row.notes ? (
              <div className="case-notes-body" dangerouslySetInnerHTML={{ __html: row.notes }} />
            ) : (
              <p className="case-card-empty">{t("projectDocuments.detail.noDescription")}</p>
            )}
          </div>

          <div className="case-card">
            <h3 className="case-card-title">Attributes</h3>
            {attributeValues.length === 0 ? (
              <p className="case-card-empty">No source attributes are set for this source yet.</p>
            ) : (
              <div className="case-detail-attributes-table-wrap">
                <table className="case-detail-attributes-table">
                  <thead>
                    <tr>
                      <th className="case-detail-attributes-label" scope="col">Attribute</th>
                      <th className="case-detail-attributes-value" scope="col">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                {attributeValues.map((attribute) => (
                  <tr key={attribute.id ?? attribute.name}>
                    <th className="case-detail-attributes-label" scope="row">{attribute.name}</th>
                    <td className="case-detail-attributes-value">
                      <button
                        type="button"
                        className="case-detail-attribute-value-button"
                        onClick={() => onOpenAttributeHistory(attribute)}
                        title="View attribute value history"
                      >
                        {formatAttributeDisplay(attribute.value, attribute.dataType) || "-"}
                      </button>
                    </td>
                    {/*
                    <dt>{attribute.name}</dt> <dd>{formatAttributeDisplay(attribute.value, attribute.dataType) || "—"}</dd>
                    */}
                  </tr>
                ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="case-card">
            <div className="case-card-header">
              <h3 className="case-card-title">Relationships</h3>
              {canManageSourceRecord ? (
                <button
                  type="button"
                  className="codebook-icon-action"
                  onClick={onCreateRelationship}
                  aria-label="Create relationship from this source"
                  title="Create relationship"
                >
                  +
                </button>
              ) : null}
            </div>
            {relationships.length === 0 ? (
              <p className="case-card-empty">No relationships are connected to this source yet.</p>
            ) : (
              <ul className="code-ann-list">
                {relationships.map((relationship) => (
                  <li key={relationship.id} className="code-ann-item">
                    <div className="code-ann-doc">{relationship.relationshipType || "Relationship"}</div>
                    <div className="code-ann-meta">
                      {relationship.otherEndpointName}
                      {relationship.otherEndpointType ? ` (${relationship.otherEndpointType})` : ""}
                    </div>
                    {relationship.description.trim() ? (
                      <div className="code-ann-meta">{relationship.description}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

        </div>

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
              <div className="source-content-header-actions">
                {isSearchableTextSource ? (
                  <div className="source-content-search">
                    {textSearchOpen ? (
                      <>
                        <input
                          ref={textSearchInputRef}
                          className="source-content-search-input"
                          value={textSearchQuery}
                          onChange={(event) => setTextSearchQuery(event.target.value)}
                          placeholder="Search text"
                          aria-label="Search source text"
                        />
                        <span className="source-content-search-count">
                          {activeTextSearchQuery
                            ? textSearchMatches.length > 0 && activeTextSearchIndex != null
                              ? `${activeTextSearchIndex + 1}/${textSearchMatches.length}`
                              : "0/0"
                            : ""}
                        </span>
                        <button
                          type="button"
                          className="btn btn--small source-content-search-nav"
                          onClick={goToPreviousTextSearchMatch}
                          disabled={textSearchMatches.length === 0}
                          aria-label="Previous search match"
                          title="Previous"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="btn btn--small source-content-search-nav"
                          onClick={goToNextTextSearchMatch}
                          disabled={textSearchMatches.length === 0}
                          aria-label="Next search match"
                          title="Next"
                        >
                          ↓
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn--small source-content-search-toggle"
                      onClick={() => setTextSearchOpen((open) => !open)}
                      aria-label={textSearchOpen ? "Close text search" : "Search source text"}
                      title={textSearchOpen ? "Close search" : "Search"}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <circle cx="11" cy="11" r="6" />
                        <path d="M16 16l4 4" />
                      </svg>
                    </button>
                  </div>
                ) : null}
                {!isPdfSource && !isImageSource && !isAudioSource && !isVideoSource && row.content ? (
                  <TextSizeControls
                    fontSizePx={textSizePx}
                    onDecrease={decreaseTextSize}
                    onIncrease={increaseTextSize}
                  />
                ) : null}
              </div>
            </div>
            {isPdfSource ? (
              pdfPreviewLoading ? (
                <p className="users-guide-copy" style={{ margin: 0 }}>Loading PDF preview...</p>
              ) : pdfPreviewError ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <p className="auth-error" style={{ margin: 0 }}>{pdfPreviewError}</p>
                  <p className="users-guide-copy" style={{ margin: 0 }}>
                    The PDF file is stored with this source, but its preview could not be opened.
                  </p>
                </div>
              ) : pdfPreviewUrl ? (
                <div className="doc-content-scroll-shell" style={{ padding: 0, minHeight: "72vh" }}>
                  <iframe
                    title={`${row.name} PDF preview`}
                    src={pdfPreviewUrl}
                    style={{ width: "100%", height: "100%", minHeight: "72vh", border: "none", display: "block" }}
                  />
                </div>
              ) : (
                <p className="case-card-empty">No PDF preview is available for this source.</p>
              )
            ) : isImageSource ? (
              imagePreviewLoading ? (
                <p className="users-guide-copy" style={{ margin: 0 }}>Loading image preview...</p>
              ) : imagePreviewError ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <p className="auth-error" style={{ margin: 0 }}>{imagePreviewError}</p>
                  <p className="users-guide-copy" style={{ margin: 0 }}>
                    The image file is stored with this source, but its preview could not be opened.
                  </p>
                </div>
              ) : imagePreviewUrl ? (
                <div className="doc-content-scroll-shell" style={{ padding: 0, minHeight: "72vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <img
                    src={imagePreviewUrl}
                    alt={row.name}
                    style={{ display: "block", maxWidth: "100%", maxHeight: "72vh", objectFit: "contain" }}
                  />
                </div>
              ) : (
                <p className="case-card-empty">No image preview is available for this source.</p>
              )
            ) : isAudioSource ? (
              audioPreviewLoading ? (
                <div className="source-preview-busy-state" aria-live="polite">
                  <span className="source-preview-busy-spinner" aria-hidden="true" />
                  <p className="users-guide-copy" style={{ margin: 0 }}>Loading audio preview...</p>
                </div>
              ) : audioPreviewError ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <p className="auth-error" style={{ margin: 0 }}>{audioPreviewError}</p>
                  <p className="users-guide-copy" style={{ margin: 0 }}>
                    The audio file is stored with this source, but its preview could not be opened.
                  </p>
                </div>
              ) : audioPreviewUrl ? (
                <div className="doc-content-scroll-shell" style={{ padding: 24, minHeight: "24rem", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <audio
                    src={audioPreviewUrl}
                    controls
                    style={{ display: "block", width: "100%", maxWidth: 640 }}
                  />
                </div>
              ) : (
                <p className="case-card-empty">No audio preview is available for this source.</p>
              )
            ) : isVideoSource ? (
              videoPreviewLoading ? (
                <div className="source-preview-busy-state" aria-live="polite">
                  <span className="source-preview-busy-spinner" aria-hidden="true" />
                  <p className="users-guide-copy" style={{ margin: 0 }}>Loading video preview...</p>
                </div>
              ) : videoPreviewError ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <p className="auth-error" style={{ margin: 0 }}>{videoPreviewError}</p>
                  <p className="users-guide-copy" style={{ margin: 0 }}>
                    The video file is stored with this source, but its preview could not be opened.
                  </p>
                </div>
              ) : videoPreviewUrl ? (
                <div className="doc-content-scroll-shell" style={{ padding: 0, minHeight: "72vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <video
                    src={videoPreviewUrl}
                    controls
                    style={{ display: "block", maxWidth: "100%", maxHeight: "72vh" }}
                  />
                </div>
              ) : (
                <p className="case-card-empty">No video preview is available for this source.</p>
              )
            ) : row.content ? (
              normalizedSourceType === "transcript" && processedTranscriptSegments.length > 0 ? (
                <div
                  ref={transcriptViewerRef}
                  className="doc-content-body doc-content-body--structured text-source-content-sized"
                  style={{ fontSize: textSizePx }}
                >
                  <ProcessedTranscriptView
                    segments={processedTranscriptSegments}
                    renderSegmentText={(segment) => renderSearchHighlightedText(
                      segment.text,
                      segment.startOffset,
                      `processed-transcript-search-${segment.sortOrder}`,
                    )}
                    selectedSortOrder={selectedOutlineSortOrder}
                  />
                </div>
              ) : (
                <div
                  ref={contentSelectionRef}
                  className="doc-content-scroll-shell"
                  onMouseUp={handleMouseUp}
                >
                  <pre
                    className="doc-content-body"
                    style={{ fontSize: textSizePx, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                  >
                    {renderSearchHighlightedText(row.content, 0, "source-text-search")}
                  </pre>
                </div>
              )
            ) : (
              <p className="case-card-empty">{t("projectDocuments.detail.noContent")}</p>
            )}
            {canManageAnnotations ? (
              <div style={{ marginTop: 12 }}>
                {sourceLockConflict?.reason === "kicked" ? (
                  <p className="users-guide-copy" style={{ margin: 0 }}>
                    {sourceLockConflict.userName || "A project editor"} removed your source lock. Return to the source list or reacquire access before annotating again.
                  </p>
                ) : sourceLockConflict?.reason === "locked" ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    <p className="users-guide-copy" style={{ margin: 0 }}>
                      {sourceLockConflict.userName || "Another user"} is currently annotating this source.
                    </p>
                    {canKickSourceLocks ? (
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => void onKickSourceLock(sourceLockConflict)}
                        disabled={saving || lockSyncing}
                      >
                        {lockSyncing ? "Updating..." : "Take Lock"}
                      </button>
                    ) : null}
                  </div>
                ) : canEditAnnotations ? (
                  <p className="users-guide-copy" style={{ margin: 0 }}>
                    Select text in the source contents to create a PostgreSQL annotation.
                  </p>
                ) : (
                  <p className="users-guide-copy" style={{ margin: 0 }}>
                    {lockSyncing
                      ? "Claiming the source lock for annotation..."
                      : isPdfSource || isImageSource || isAudioSource || isVideoSource
                        ? `This ${isPdfSource ? "PDF" : isImageSource ? "image" : isAudioSource ? "audio" : "video"} source is currently available as a read-only preview.`
                        : "This source is currently read-only in the coding workspace."}
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {pendingSelection && canEditAnnotations ? (
        <AnnotationEditorModal
          title="New Annotation"
          codeOptions={codeOptions}
          selection={pendingSelection}
          saving={saving}
          error={error}
          onCancel={() => {
            if (saving) return;
            setPendingSelection(null);
          }}
          onSave={async (payload) => {
            await onCreateAnnotation(row.id, pendingSelection, payload);
            setPendingSelection(null);
          }}
        />
      ) : null}

      {editingAnnotation && canEditAnnotations ? (
        <AnnotationEditorModal
          title="Edit Annotation"
          codeOptions={codeOptions}
          selection={{
            startOffset: editingAnnotation.startOffset ?? 0,
            endOffset: editingAnnotation.endOffset ?? editingAnnotation.quote.length,
            quote: editingAnnotation.quote,
          }}
          initialAnnotation={editingAnnotation}
          saving={saving}
          error={error}
          onCancel={() => {
            if (saving) return;
            setEditingAnnotation(null);
          }}
          onSave={async (payload) => {
            await onUpdateAnnotation(editingAnnotation, payload);
            setEditingAnnotation(null);
          }}
        />
      ) : null}

      {removingAnnotation && canEditAnnotations ? (
        <div className="modal-overlay" onClick={() => !saving && setRemovingAnnotation(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h2>Delete Annotation</h2>
            <blockquote className="annotation-quote" style={{ margin: "0 0 16px" }}>
              "{removingAnnotation.quote}"
            </blockquote>
            {error ? <p className="auth-error">{error}</p> : null}
            <div className="form-actions">
              <button className="btn" onClick={() => setRemovingAnnotation(null)} disabled={saving}>Cancel</button>
              <button
                className="btn btn--danger"
                onClick={async () => {
                  await onDeleteAnnotation(removingAnnotation.id);
                  setRemovingAnnotation(null);
                }}
                disabled={saving}
              >
                {saving ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editingSourceObjects ? (
        <SourceObjectsModal
          sourceName={row.name}
          objects={availableObjects}
          selectedObjectIds={linkedObjects.map((object) => object.id)}
          saving={saving}
          error={error}
          onCancel={() => {
            if (saving) return;
            setEditingSourceObjects(false);
          }}
          onSave={async (objectIds) => {
            await onSaveSourceObjects(row.id, objectIds);
            setEditingSourceObjects(false);
          }}
        />
      ) : null}
    </div>
  );
}

export type PostgresSourcesViewProps = {
  projectId: string;
  currentUserId: string;
  canManageSources: boolean;
  canKickSourceLocks: boolean;
  canManageAnnotations: boolean;
  canManageMemos: boolean;
  canCreateCodes?: boolean;
  codingEnabled?: boolean;
  textCodingMode?: "analysis" | "ai-assisted";
  pageTitleOverride?: string;
  allowedSourceKinds?: string[];
  initialSourceId?: string | null;
  initialAnnotationId?: string | null;
  initialTextSegment?: { startOffset: number; endOffset: number } | null;
  onInitialNavigationHandled?: () => void;
  onOpenPostgresMemoDraft: (payload: { sourceIds?: string[]; annotationIds?: string[]; codeIds?: string[] }) => void;
};

export function PostgresSourcesView({
  projectId,
  currentUserId,
  canManageSources,
  canKickSourceLocks,
  canManageAnnotations,
  canManageMemos,
  canCreateCodes,
  codingEnabled = false,
  textCodingMode = "analysis",
  pageTitleOverride,
  allowedSourceKinds,
  initialSourceId,
  initialAnnotationId,
  initialTextSegment,
  onInitialNavigationHandled,
  onOpenPostgresMemoDraft,
}: PostgresSourcesViewProps) {
  const { t } = useI18n();
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [codes, setCodes] = useState<PostgresCode[]>([]);
  const [annotations, setAnnotations] = useState<PostgresAnnotationSummary[]>([]);
  const [objects, setObjects] = useState<PostgresObject[]>([]);
  const [objectTypes, setObjectTypes] = useState<PostgresObjectType[]>([]);
  const [relationships, setRelationships] = useState<PostgresRelationship[]>([]);
  const [relationshipTypes, setRelationshipTypes] = useState<PostgresRelationshipType[]>([]);
  const [relationshipAttributeDefinitions, setRelationshipAttributeDefinitions] = useState<PostgresRelationshipAttributeDefinition[]>([]);
  const [sourceLocks, setSourceLocks] = useState<PostgresSourceLock[]>([]);
  const [sourceObjectLinks, setSourceObjectLinks] = useState<PostgresSourceObjectLink[]>([]);
  const [sourceAttributeDefinitions, setSourceAttributeDefinitions] = useState<PostgresSourceAttributeDefinition[]>([]);
  const [sourceAttributeValues, setSourceAttributeValues] = useState<PostgresSourceAttributeValue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<SourceRow | null>(null);
  const [sortCol, setSortCol] = useState<SortCol>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [showAttributesTable, setShowAttributesTable] = useState(false);
  const [selectedSourceKindFilter, setSelectedSourceKindFilter] = useState<string>(
    textCodingMode === "ai-assisted" ? "source_text" : "all",
  );
  const [sourceKindSortCol, setSourceKindSortCol] = useState<SourceKindSortCol>("label");
  const [sourceKindSortDir, setSourceKindSortDir] = useState<SortDir>("asc");
  const [attributeSortCol, setAttributeSortCol] = useState<AttributeSortCol>("name");
  const [attributeSortDir, setAttributeSortDir] = useState<AttributeSortDir>("asc");
  const [attributeDraft, setAttributeDraft] = useState<SourceAttributeDraft | null>(null);
  const [attributeHistoryTarget, setAttributeHistoryTarget] = useState<PostgresAttributeValueHistoryTarget | null>(null);
  const [activeAttributeHistoryCell, setActiveAttributeHistoryCell] = useState<{ sourceId: string; attributeDefinitionId: string } | null>(null);
  const [attributeSaving, setAttributeSaving] = useState(false);
  const [attributeError, setAttributeError] = useState<string | null>(null);
  const [sourceImportSettings, setSourceImportSettings] = useState({
    defaultMode: readAppSettings().documentImport.defaultMode,
    autoNameFromFile: readAppSettings().documentImport.autoNameFromFile,
    trimImportedText: readAppSettings().documentImport.trimImportedText,
    warnBeforeEmptyImport: readAppSettings().documentImport.warnBeforeEmptyImport,
    storeOriginalFileName: true,
  });
  const [newSourceOpen, setNewSourceOpen] = useState(false);
  const [newRelationshipSource, setNewRelationshipSource] = useState<SourceRow | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<SourceRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<SourceRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [activeSourceLock, setActiveSourceLock] = useState<PostgresSourceLock | null>(null);
  const [sourceLockConflict, setSourceLockConflict] = useState<PostgresSourceLock | null>(null);
  const [sourceLockSyncing, setSourceLockSyncing] = useState(false);
  const [projectStoragePath, setProjectStoragePath] = useState("");
  const [sourceContextMenu, setSourceContextMenu] = useState<{ x: number; y: number; row: SourceRow } | null>(null);
  const sourceContextMenuRef = useRef<HTMLDivElement | null>(null);
  const sourceContextMenuStyle = useViewportContextMenuStyle(sourceContextMenu, sourceContextMenuRef);

  const loadSources = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [snapshot, projects] = await Promise.all([
        loadPostgresProjectWorkspaceSnapshot(projectId),
        listPostgresProjects(),
      ]);
      setProjectStoragePath(projects.find((project) => project.id === projectId)?.storagePath ?? "");
      setCodes(snapshot.codes);
      setAnnotations(snapshot.annotations);
      setObjects(snapshot.objects);
      setObjectTypes(snapshot.objectTypes);
      setRelationships(snapshot.relationships);
      setRelationshipTypes(snapshot.relationshipTypes);
      setRelationshipAttributeDefinitions(snapshot.relationshipAttributeDefinitions);
      setSourceLocks(snapshot.sourceLocks);
      setSourceObjectLinks(snapshot.sourceObjectLinks);
      setSourceAttributeDefinitions(snapshot.sourceAttributeDefinitions);
      setSourceAttributeValues(snapshot.sourceAttributeValues);
      const annotationCountBySourceId = new Map<string, number>();
      for (const annotation of snapshot.annotations) {
        annotationCountBySourceId.set(
          annotation.sourceId,
          (annotationCountBySourceId.get(annotation.sourceId) ?? 0) + 1,
        );
      }
      const objectCountBySourceId = new Map<string, number>();
      for (const link of snapshot.sourceObjectLinks) {
        objectCountBySourceId.set(
          link.sourceId,
          (objectCountBySourceId.get(link.sourceId) ?? 0) + 1,
        );
      }

      setRows(
        snapshot.sources.map((source) => {
          const sourceVisual = getSourceKindVisual(source.sourceKind);
          return {
            id: source.id,
            name: source.title,
            type: source.sourceKind || "source",
            sourceObjectType: sourceVisual?.label ?? source.sourceKind ?? "Source",
            sourceObjectTypeSystemKey: sourceVisual?.systemKey ?? null,
            notes: source.notes ?? "",
            content: source.textContent,
            structuredContentJson: source.structuredContentJson,
            waveformPeaksJson: source.waveformPeaksJson ?? "",
            videoFrameIndexJson: source.videoFrameIndexJson ?? "",
            extractedFromVideoSourceId: source.extractedFromVideoSourceId ?? "",
            extractedFromVideoTimeMs: source.extractedFromVideoTimeMs ?? null,
            filePath: source.storagePath,
            annotationCount: annotationCountBySourceId.get(source.id) ?? 0,
            objectCount: objectCountBySourceId.get(source.id) ?? 0,
            createdAt: source.createdAt,
          };
        }),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load sources.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  useEffect(() => {
    let cancelled = false;
    async function loadImportSettings() {
      try {
        const projectSettings = await getPostgresProjectDocumentImportSettings(projectId);
        if (cancelled) return;
        const appSettings = readAppSettings().documentImport;
        setSourceImportSettings({
          defaultMode: appSettings.defaultMode,
          autoNameFromFile: appSettings.autoNameFromFile,
          trimImportedText: appSettings.trimImportedText,
          warnBeforeEmptyImport: appSettings.warnBeforeEmptyImport,
          storeOriginalFileName: projectSettings.storeOriginalFileName,
        });
      } catch {
        if (cancelled) return;
        const appSettings = readAppSettings().documentImport;
        setSourceImportSettings({
          defaultMode: appSettings.defaultMode,
          autoNameFromFile: appSettings.autoNameFromFile,
          trimImportedText: appSettings.trimImportedText,
          warnBeforeEmptyImport: appSettings.warnBeforeEmptyImport,
          storeOriginalFileName: true,
        });
      }
    }
    void loadImportSettings();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!sourceContextMenu) return;

    function handlePointerDown(event: MouseEvent) {
      if (!sourceContextMenuRef.current?.contains(event.target as Node)) {
        setSourceContextMenu(null);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setSourceContextMenu(null);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [sourceContextMenu]);

  const allowedSourceKindSet = useMemo(() => {
    if (!allowedSourceKinds || allowedSourceKinds.length === 0) return null;
    return new Set(allowedSourceKinds.map(normalizeSourceKindFilterValue));
  }, [allowedSourceKinds]);

  const visibleRows = useMemo(
    () => rows.filter((row) => sourceRowMatchesAllowedKinds(row, allowedSourceKindSet)),
    [allowedSourceKindSet, rows],
  );

  useEffect(() => {
    if (!initialSourceId || visibleRows.length === 0) return;
    if (selectedRow?.id === initialSourceId) {
      return;
    }
    const matchingRow = visibleRows.find((row) => row.id === initialSourceId);
    if (!matchingRow) return;
    setSelectedRow(matchingRow);
  }, [initialSourceId, selectedRow?.id, visibleRows]);

  useEffect(() => {
    if (!selectedRow) return;
    const nextSelectedRow = visibleRows.find((row) => row.id === selectedRow.id) ?? null;
    if (!nextSelectedRow) {
      setSelectedRow(null);
      return;
    }
    if (nextSelectedRow !== selectedRow) {
      setSelectedRow(nextSelectedRow);
    }
  }, [selectedRow, visibleRows]);

  useEffect(() => {
    if (showAttributesTable) return;
    if (selectedSourceKindFilter === "all") return;
    if (!visibleRows.some((row) => (row.sourceObjectTypeSystemKey || row.sourceObjectType) === selectedSourceKindFilter)) {
      setSelectedSourceKindFilter("all");
    }
  }, [selectedSourceKindFilter, showAttributesTable, visibleRows]);

  useEffect(() => {
    if (!selectedRow || selectedSourceKindFilter === "all") return;
    if ((selectedRow.sourceObjectTypeSystemKey || selectedRow.sourceObjectType) !== selectedSourceKindFilter) {
      setSelectedRow(null);
    }
  }, [selectedRow, selectedSourceKindFilter]);

  useEffect(() => {
    if (!selectedRow || !canManageAnnotations || !codingEnabled) {
      setSourceLockConflict(null);
      if (activeSourceLock) {
        void releasePostgresSourceLock(projectId, activeSourceLock.id);
        setSourceLocks((current) => current.filter((lock) => lock.id !== activeSourceLock.id));
      }
      setActiveSourceLock(null);
      return;
    }

    let cancelled = false;
    let heartbeatId: ReturnType<typeof setInterval> | null = null;
    let heldLockId: string | null = null;

    const syncSourceLock = async () => {
      setSourceLockSyncing(true);
      try {
        const result = await acquirePostgresSourceLock({
          projectId,
          sourceId: selectedRow.id,
        });
        if (cancelled) return;
        if (result.ok && result.lock) {
          heldLockId = result.lock.id;
          setActiveSourceLock(result.lock);
          setSourceLockConflict(null);
          setSourceLocks((current) => {
            const filtered = current.filter((lock) => lock.sourceId !== result.lock!.sourceId);
            return [...filtered, result.lock!];
          });
        } else {
          setActiveSourceLock(null);
          setSourceLockConflict(result.conflict);
          setSourceLocks((current) => {
            const filtered = current.filter((lock) => lock.sourceId !== selectedRow.id);
            if (result.conflict?.reason === "locked") {
              return [...filtered, result.conflict];
            }
            return filtered;
          });
        }
      } catch (lockError) {
        if (!cancelled) {
          setActiveSourceLock(null);
          setSourceLockConflict(null);
          setSubmitError(lockError instanceof Error ? lockError.message : "Failed to synchronize the source lock.");
        }
      } finally {
        if (!cancelled) {
          setSourceLockSyncing(false);
        }
      }
    };

    void syncSourceLock();
    heartbeatId = setInterval(() => {
      void syncSourceLock();
    }, SOURCE_LOCK_HEARTBEAT_MS);

    return () => {
      cancelled = true;
      if (heartbeatId) clearInterval(heartbeatId);
      if (heldLockId) {
        void releasePostgresSourceLock(projectId, heldLockId);
        setSourceLocks((current) => current.filter((lock) => lock.id !== heldLockId));
      }
      setActiveSourceLock(null);
    };
  }, [canManageAnnotations, codingEnabled, projectId, selectedRow]);

  const sourceKindSummaries = useMemo(() => {
    const summaryByKind = new Map<string, {
      label: string;
      meta: string;
      count: number;
      shape: SourceObjectTypeShape;
      color: string;
      fill: SourceObjectFill;
      systemKey: string | null;
    }>();
    for (const objectType of objectTypes) {
      const systemKey = objectType.systemKey;
      if (!systemKey || !POSTGRES_SOURCE_OBJECT_TYPE_SYSTEM_KEYS.includes(systemKey as (typeof POSTGRES_SOURCE_OBJECT_TYPE_SYSTEM_KEYS)[number])) {
        continue;
      }
      if (allowedSourceKindSet && ![
        systemKey,
        objectType.name,
      ].some((value) => allowedSourceKindSet.has(normalizeSourceKindFilterValue(value)))) {
        continue;
      }
      summaryByKind.set(systemKey, {
        label: objectType.name,
        meta: systemKey,
        count: 0,
        shape: normalizeSourceObjectTypeShape(objectType.shape),
        color: normalizeSourceObjectColor(objectType.color),
        fill: normalizeSourceObjectFill(objectType.fill),
        systemKey,
      });
    }
    for (const row of visibleRows) {
      const kindKey = row.sourceObjectTypeSystemKey || row.sourceObjectType || row.type || "source";
      const current = summaryByKind.get(kindKey);
      if (current) {
        current.count += 1;
      } else {
        const sourceVisual = getSourceKindVisual(row.type);
        summaryByKind.set(kindKey, {
          label: sourceVisual?.label ?? row.sourceObjectType ?? row.type ?? "Source",
          meta: row.sourceObjectTypeSystemKey || row.type || "source",
          count: 1,
          shape: "rounded",
          color: sourceVisual?.color ?? SOURCE_OBJECT_TYPE_DEFAULT_COLOR,
          fill: "outline",
          systemKey: row.sourceObjectTypeSystemKey ?? sourceVisual?.systemKey ?? null,
        });
      }
    }
    return [...summaryByKind.entries()]
      .map(([kind, summary]) => ({
        kind,
        label: summary.label,
        meta: summary.meta,
        count: summary.count,
        shape: summary.shape,
        color: summary.color,
        fill: summary.fill,
        systemKey: summary.systemKey,
      }))
      .sort((left, right) => {
        let comparison = 0;
        if (sourceKindSortCol === "count") {
          comparison = left.count - right.count;
        } else {
          comparison = left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
        }
        if (comparison === 0) {
          comparison = left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
        }
        return sourceKindSortDir === "asc" ? comparison : -comparison;
      });
  }, [allowedSourceKindSet, objectTypes, sourceKindSortCol, sourceKindSortDir, visibleRows]);
  const sourceTypeOptions = useMemo(
    () => sourceKindSummaries
      .map((summary) => {
        const kind = sourceKindFromFilterValue(summary.kind);
        return kind
          ? {
              kind,
              label: sourceTypeOptionLabel(kind, summary.label),
              count: summary.count,
            }
          : null;
      })
      .filter((option): option is { kind: string; label: string; count: number } => option !== null),
    [sourceKindSummaries],
  );
  const selectedSourceKind = sourceKindFromFilterValue(selectedSourceKindFilter);

  const filteredRows = useMemo(
    () => (
      selectedSourceKindFilter === "all"
        ? visibleRows
        : visibleRows.filter((row) => (row.sourceObjectTypeSystemKey || row.sourceObjectType) === selectedSourceKindFilter)
    ),
    [selectedSourceKindFilter, visibleRows],
  );

  const sorted = [...filteredRows].sort((a, b) => {
    let cmp: number;
    if (sortCol === "annotations") {
      cmp = a.annotationCount - b.annotationCount;
    } else if (sortCol === "objects") {
      cmp = a.objectCount - b.objectCount;
    } else {
      const aVal = String((a as unknown as Record<string, unknown>)[sortCol] ?? "");
      const bVal = String((b as unknown as Record<string, unknown>)[sortCol] ?? "");
      cmp = aVal.localeCompare(bVal, undefined, { sensitivity: "base" });
    }
    return sortDir === "asc" ? cmp : -cmp;
  });
  const sourceLockBySourceId = useMemo(
    () => new Map(sourceLocks.map((lock) => [lock.sourceId, lock])),
    [sourceLocks],
  );

  function handleSort(col: SortCol) {
    if (col === sortCol) setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  function handleSourceKindSort(col: SourceKindSortCol) {
    if (col === sourceKindSortCol) setSourceKindSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    else {
      setSourceKindSortCol(col);
      setSourceKindSortDir("asc");
    }
  }

  function handleSelectSourceKind(kind: string) {
    setSelectedSourceKindFilter(kind);
    setSelectedRow(null);
  }

  async function handleSaveSource(payload: {
    sourceKind: string;
    name: string;
    notes: string;
    content: string;
    attributeValuesByDefinitionId: Record<string, string>;
  }) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      let savedSourceId = editingRow?.id ?? "";
      if (editingRow) {
        const saved = await updatePostgresSource({
          projectId,
          sourceId: editingRow.id,
          sourceKind: payload.sourceKind.trim(),
          title: payload.name.trim(),
          textContent: payload.content,
          notes: payload.notes,
          structuredContentJson: editingRow.structuredContentJson,
          waveformPeaksJson: editingRow.waveformPeaksJson,
          videoFrameIndexJson: editingRow.videoFrameIndexJson,
          extractedFromVideoSourceId: editingRow.extractedFromVideoSourceId,
          extractedFromVideoTimeMs: editingRow.extractedFromVideoTimeMs,
          originalFileName: editingRow.filePath,
          storagePath: editingRow.filePath,
        });
        savedSourceId = saved.id;
      } else {
        const saved = await createPostgresSource({
          projectId,
          sourceKind: payload.sourceKind.trim(),
          title: payload.name.trim(),
          textContent: payload.content,
          notes: payload.notes,
          structuredContentJson: "",
          waveformPeaksJson: "",
          videoFrameIndexJson: "",
          extractedFromVideoSourceId: "",
          extractedFromVideoTimeMs: null,
          originalFileName: "",
          storagePath: "",
        });
        savedSourceId = saved.id;
      }

      for (const definition of sourceAttributeDefinitions) {
        const previousValue = savedSourceId
          ? sourceAttributeValues.find((value) =>
              value.sourceId === savedSourceId && value.attributeDefinitionId === definition.id
            )?.value ?? ""
          : "";
        const nextValue = payload.attributeValuesByDefinitionId[definition.id] ?? "";
        if (nextValue === previousValue) continue;
        await savePostgresSourceAttribute({
          projectId,
          attributeDefinitionId: definition.id,
          name: definition.name,
          dataType: definition.dataType,
          description: definition.description,
          options: definition.options,
          values: rows
            .filter((row) => row.id !== savedSourceId)
            .map((row) => ({
              sourceId: row.id,
              value: sourceAttributeValues.find((value) =>
                value.sourceId === row.id && value.attributeDefinitionId === definition.id
              )?.value ?? "",
            }))
            .concat({ sourceId: savedSourceId, value: nextValue }),
        });
      }
      setEditorOpen(false);
      setEditingRow(null);
      await loadSources();
    } catch (saveError) {
      setSubmitError(saveError instanceof Error ? saveError.message : "Failed to save source.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateImportedSource(payload:
    | {
        mode: "paste";
        title: string;
        sourceKind: string;
        notes: string;
        content: string;
      }
    | {
        mode: "upload";
        items: Array<{
          file: File;
          title: string;
          sourceKind: string;
          extractedText: string;
        }>;
      }
  ) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (payload.mode === "paste") {
        await createPostgresSource({
          projectId,
          sourceKind: payload.sourceKind,
          title: payload.title,
          textContent: payload.content,
          notes: payload.notes,
          structuredContentJson: "",
          waveformPeaksJson: "",
          videoFrameIndexJson: "",
          extractedFromVideoSourceId: "",
          extractedFromVideoTimeMs: null,
          originalFileName: "",
          storagePath: "",
        });
      } else {
        for (const item of payload.items) {
          const bytes = new Uint8Array(await item.file.arrayBuffer());
          const waveformPeaksJson = item.sourceKind === "audio" || item.sourceKind === "video"
            ? serializeMediaWaveformCache(await createMediaWaveformCache(bytes))
            : "";
          const videoFrameIndexJson = item.sourceKind === "video"
            ? serializeMediaVideoFrameIndexCache(await createMediaVideoFrameIndexCache(bytes))
            : "";
          await importPostgresSourceFile({
            projectId,
            sourceKind: item.sourceKind,
            title: item.title,
            originalFileName: sourceImportSettings.storeOriginalFileName ? item.file.name : "",
            mediaType: inferUploadMediaType(item.file),
            fileBytesBase64: bytesToBase64(bytes),
            textContent: item.extractedText,
            structuredContentJson: "",
            waveformPeaksJson,
            videoFrameIndexJson,
            extractedFromVideoSourceId: "",
            extractedFromVideoTimeMs: null,
            notes: "",
          });
        }
      }
      setNewSourceOpen(false);
      await loadSources();
    } catch (saveError) {
      setSubmitError(saveError instanceof Error ? saveError.message : "Failed to create source.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleExtractVideoFrameSource(payload: { file: File; title: string; extractedFromVideoSourceId: string; extractedFromVideoTimeMs: number }) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const bytes = new Uint8Array(await payload.file.arrayBuffer());
      await importPostgresSourceFile({
        projectId,
        sourceKind: "image",
        title: payload.title.trim() || preliminarySourceTitleFromFileName(payload.file.name),
        originalFileName: sourceImportSettings.storeOriginalFileName ? payload.file.name : "",
        mediaType: inferUploadMediaType(payload.file) ?? "image/png",
        fileBytesBase64: bytesToBase64(bytes),
        textContent: "",
        structuredContentJson: "",
        waveformPeaksJson: "",
        videoFrameIndexJson: "",
        extractedFromVideoSourceId: payload.extractedFromVideoSourceId,
        extractedFromVideoTimeMs: payload.extractedFromVideoTimeMs,
        notes: "",
      });
      await loadSources();
    } catch (saveError) {
      setSubmitError(saveError instanceof Error ? saveError.message : "Failed to create frame source.");
      throw saveError;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteSource() {
    if (!deleteRow) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await deletePostgresSource(projectId, deleteRow.id);
      if (selectedRow?.id === deleteRow.id) setSelectedRow(null);
      setDeleteRow(null);
      await loadSources();
    } catch (deleteError) {
      setSubmitError(deleteError instanceof Error ? deleteError.message : "Failed to delete source.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateAnnotation(
    sourceId: string,
    selection: PendingSelection,
    payload: { codeIds: string[]; note: string },
  ) {
    if (!activeSourceLock || activeSourceLock.sourceId !== sourceId || activeSourceLock.userId !== currentUserId) {
      throw new Error("You need to hold the source lock before adding annotations.");
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const createdAnnotation = await createPostgresAnnotation({
        projectId,
        sourceId,
        codeIds: payload.codeIds,
        startOffset: selection.startOffset,
        endOffset: selection.endOffset,
        timeStartMs: selection.timeStartMs ?? null,
        timeEndMs: selection.timeEndMs ?? null,
        quote: selection.quote,
        note: payload.note,
        anchorKind: selection.anchorKind ?? "text_span",
        imageRegion: selection.imageRegion ?? null,
      });
      setAnnotations((current) => [...current, createdAnnotation]);
      setRows((current) => current.map((row) => (
        row.id === sourceId
          ? { ...row, annotationCount: row.annotationCount + 1 }
          : row
      )));
    } catch (annotationError) {
      setSubmitError(annotationError instanceof Error ? annotationError.message : "Failed to create annotation.");
      throw annotationError;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateAnnotation(
    annotation: SourceAnnotationRow,
    payload: {
      codeIds: string[];
      note: string;
      startOffset?: number | null;
      endOffset?: number | null;
      timeStartMs?: number | null;
      timeEndMs?: number | null;
      quote?: string;
      anchorKind?: string;
      imageRegion?: PendingSelection["imageRegion"];
    },
  ) {
    if (!selectedRow || !activeSourceLock || activeSourceLock.sourceId !== selectedRow.id || activeSourceLock.userId !== currentUserId) {
      throw new Error("You need to hold the source lock before editing annotations.");
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const updatedAnnotation = await updatePostgresAnnotation({
        projectId,
        annotationId: annotation.id,
        codeIds: payload.codeIds,
        startOffset: payload.startOffset ?? annotation.startOffset,
        endOffset: payload.endOffset ?? annotation.endOffset,
        timeStartMs: payload.timeStartMs ?? annotation.timeStartMs,
        timeEndMs: payload.timeEndMs ?? annotation.timeEndMs,
        quote: payload.quote ?? annotation.quote,
        note: payload.note,
        anchorKind: payload.anchorKind ?? annotation.anchorKind ?? "text_span",
        imageRegion: payload.imageRegion ?? annotation.imageRegion ?? null,
      });
      setAnnotations((current) => current.map((entry) => (
        entry.id === updatedAnnotation.id ? updatedAnnotation : entry
      )));
    } catch (annotationError) {
      setSubmitError(annotationError instanceof Error ? annotationError.message : "Failed to update annotation.");
      throw annotationError;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteAnnotation(annotationId: string) {
    if (!selectedRow || !activeSourceLock || activeSourceLock.sourceId !== selectedRow.id || activeSourceLock.userId !== currentUserId) {
      throw new Error("You need to hold the source lock before deleting annotations.");
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await deletePostgresAnnotation(projectId, annotationId);
      await loadSources();
    } catch (annotationError) {
      setSubmitError(annotationError instanceof Error ? annotationError.message : "Failed to delete annotation.");
      throw annotationError;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveSourceObjects(sourceId: string, objectIds: string[]) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await setPostgresSourceObjects({
        projectId,
        sourceId,
        objectIds,
      });
      await loadSources();
    } catch (sourceObjectError) {
      setSubmitError(sourceObjectError instanceof Error ? sourceObjectError.message : "Failed to save source associations.");
      throw sourceObjectError;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateSourceRelationship(payload: {
    relationshipTypeId: string;
    fromEntityType: "object" | "source";
    fromEntityId: string;
    toEntityType: "object" | "source";
    toEntityId: string;
    description: string;
    lineShapeOverride?: string | null;
    lineWeightOverride?: number | null;
    arrowheadOverride?: string | null;
    colorOverride?: string | null;
    attributeValues: Array<{ attributeDefinitionId: string; value: string }>;
  }) {
    if (!newRelationshipSource) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await savePostgresRelationship({
        projectId,
        relationshipId: null,
        fromEntityType: payload.fromEntityType,
        fromEntityId: payload.fromEntityId,
        toEntityType: payload.toEntityType,
        toEntityId: payload.toEntityId,
        relationshipTypeId: payload.relationshipTypeId,
        description: payload.description,
        lineShapeOverride: payload.lineShapeOverride ?? null,
        lineWeightOverride: payload.lineWeightOverride ?? null,
        arrowheadOverride: payload.arrowheadOverride ?? null,
        colorOverride: payload.colorOverride ?? null,
        attributeValues: payload.attributeValues,
      });
      setNewRelationshipSource(null);
      await loadSources();
    } catch (relationshipError) {
      setSubmitError(relationshipError instanceof Error ? relationshipError.message : "Failed to create relationship.");
      throw relationshipError;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleKickSourceLock(lock: PostgresSourceLock) {
    setSourceLockSyncing(true);
    setSubmitError(null);
    try {
      await kickPostgresSourceLock({
        projectId,
        sourceId: lock.sourceId,
        lockId: lock.id,
      });
      setSourceLocks((current) => current.filter((entry) => entry.id !== lock.id));
      const result = await acquirePostgresSourceLock({
        projectId,
        sourceId: lock.sourceId,
      });
      if (result.ok && result.lock) {
        setActiveSourceLock(result.lock);
        setSourceLockConflict(null);
        setSourceLocks((current) => {
          const filtered = current.filter((entry) => entry.sourceId !== result.lock!.sourceId);
          return [...filtered, result.lock!];
        });
      } else {
        setActiveSourceLock(null);
        setSourceLockConflict(result.conflict);
      }
    } catch (lockError) {
      setSubmitError(lockError instanceof Error ? lockError.message : "Failed to take the source lock.");
    } finally {
      setSourceLockSyncing(false);
    }
  }

  function handleAttributeSort(col: AttributeSortCol) {
    if (col === attributeSortCol) setAttributeSortDir((current) => (current === "asc" ? "desc" : "asc"));
    else {
      setAttributeSortCol(col);
      setAttributeSortDir("asc");
    }
  }

  async function handleSaveAttribute(
    draft: SourceAttributeDraft,
    valuesBySource: Record<string, string>,
  ) {
    setAttributeSaving(true);
    setAttributeError(null);
    try {
      const normalizedSourceKinds = normalizeSourceAttributeKinds(draft.sourceKinds);
      await savePostgresSourceAttribute({
        projectId,
        attributeDefinitionId: draft.id ?? null,
        name: draft.name.trim(),
        dataType: draft.dataType,
        description: draft.description,
        options: draft.options,
        sourceKinds: normalizedSourceKinds,
        values: rows
          .filter((row) => normalizedSourceKinds.length === 0 || normalizedSourceKinds.includes(row.type))
          .map((row) => ({
            sourceId: row.id,
            value: valuesBySource[row.id] ?? "",
          })),
      });
      setAttributeDraft(null);
      await loadSources();
    } catch (saveError) {
      setAttributeError(saveError instanceof Error ? saveError.message : "Failed to save source attribute.");
    } finally {
      setAttributeSaving(false);
    }
  }

  async function handleCreateCode(payload: { label: string; color: string; description: string; parentCodeId?: string | null }) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const createdCode = await createPostgresCode({
        projectId,
        label: payload.label,
        color: payload.color,
        description: payload.description,
        parentCodeId: payload.parentCodeId ?? null,
      });
      setCodes((current) => [...current, createdCode]);
      return createdCode;
    } catch (createError) {
      setSubmitError(createError instanceof Error ? createError.message : "Failed to create code.");
      throw createError;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateCode(codeId: string, payload: { label: string; color: string; description: string; parentCodeId?: string | null }) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const updatedCode = await updatePostgresCode({
        projectId,
        codeId,
        label: payload.label,
        color: payload.color,
        description: payload.description,
        parentCodeId: payload.parentCodeId ?? null,
        shortcut: "",
      });
      setCodes((current) => current.map((code) => (code.id === updatedCode.id ? updatedCode : code)));
      return updatedCode;
    } catch (updateError) {
      setSubmitError(updateError instanceof Error ? updateError.message : "Failed to update code.");
      throw updateError;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteCode(codeId: string) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await deletePostgresCode(projectId, codeId);
      setCodes((current) => current
        .filter((code) => code.id !== codeId)
        .map((code) => (code.parentCodeId === codeId ? { ...code, parentCodeId: "" } : code)));
    } catch (deleteError) {
      setSubmitError(deleteError instanceof Error ? deleteError.message : "Failed to delete code.");
      throw deleteError;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateSourceWaveform(sourceId: string, waveformPeaksJson: string) {
    const sourceRow = rows.find((entry) => entry.id === sourceId);
    if (!sourceRow) return;

    await updatePostgresSource({
      projectId,
      sourceId: sourceRow.id,
      sourceKind: sourceRow.type.trim(),
      title: sourceRow.name,
      textContent: sourceRow.content,
      notes: sourceRow.notes,
      structuredContentJson: sourceRow.structuredContentJson,
      waveformPeaksJson,
      videoFrameIndexJson: sourceRow.videoFrameIndexJson,
      extractedFromVideoSourceId: sourceRow.extractedFromVideoSourceId,
      extractedFromVideoTimeMs: sourceRow.extractedFromVideoTimeMs,
      originalFileName: sourceRow.filePath,
      storagePath: sourceRow.filePath,
    });

    setRows((current) => current.map((entry) => (
      entry.id === sourceId
        ? { ...entry, waveformPeaksJson }
        : entry
    )));
    setSelectedRow((current) => (
      current?.id === sourceId
        ? { ...current, waveformPeaksJson }
        : current
    ));
  }

  async function handleUpdateSourceVideoFrameIndex(sourceId: string, videoFrameIndexJson: string) {
    const sourceRow = rows.find((entry) => entry.id === sourceId);
    if (!sourceRow) return;

    await updatePostgresSource({
      projectId,
      sourceId: sourceRow.id,
      sourceKind: sourceRow.type.trim(),
      title: sourceRow.name,
      textContent: sourceRow.content,
      notes: sourceRow.notes,
      structuredContentJson: sourceRow.structuredContentJson,
      waveformPeaksJson: sourceRow.waveformPeaksJson,
      videoFrameIndexJson,
      extractedFromVideoSourceId: sourceRow.extractedFromVideoSourceId,
      extractedFromVideoTimeMs: sourceRow.extractedFromVideoTimeMs,
      originalFileName: sourceRow.filePath,
      storagePath: sourceRow.filePath,
    });

    setRows((current) => current.map((entry) => (
      entry.id === sourceId
        ? { ...entry, videoFrameIndexJson }
        : entry
    )));
    setSelectedRow((current) => (
      current?.id === sourceId
        ? { ...current, videoFrameIndexJson }
        : current
    ));
  }

  const codeOptions = useMemo(() => buildCodeOptions(codes), [codes]);
  const sourceAttributeDefinitionsForEditor = useMemo(
    () => [...sourceAttributeDefinitions]
      .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, undefined, { sensitivity: "base" })),
    [sourceAttributeDefinitions],
  );
  const attributeDefs = useMemo<SourceAttributeDefinitionRow[]>(
    () => sourceAttributeDefinitionsForEditor
      .filter((definition) => !selectedSourceKind
        || (definition.sourceKinds ?? []).length === 0
        || (definition.sourceKinds ?? []).includes(selectedSourceKind))
      .map((definition) => ({
        id: definition.id,
        name: definition.name,
        dataType: definition.dataType,
        description: definition.description,
        options: definition.options,
        sourceKinds: definition.sourceKinds ?? [],
        sortOrder: definition.sortOrder,
      })),
    [selectedSourceKind, sourceAttributeDefinitionsForEditor],
  );
  const attributeValues = useMemo<Record<string, SourceAttributeValueRow>>(
    () => Object.fromEntries(
      sourceAttributeValues.map((value) => [
        valueKey(value.sourceId, value.attributeDefinitionId),
        {
          id: value.id,
          sourceId: value.sourceId,
          attributeDefinitionId: value.attributeDefinitionId,
          value: value.value,
        },
      ]),
    ),
    [sourceAttributeValues],
  );

  function sourceAttributeDraftValuesFor(row: SourceRow | null | undefined): Record<string, string> {
    if (!row) return {};
    return Object.fromEntries(
      sourceAttributeDefinitionsForEditor.map((definition) => [
        definition.id,
        sourceAttributeValues.find((value) =>
          value.sourceId === row.id && value.attributeDefinitionId === definition.id
        )?.value ?? "",
      ]),
    );
  }
  const availableObjects = useMemo<SourceObjectRow[]>(
    () => [...objects]
      .sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: "base" }))
      .map((object) => ({
        id: object.id,
        title: object.title,
        objectType: object.objectType,
        objectTypeSystemKey: object.objectTypeSystemKey,
      })),
    [objects],
  );
  const selectedSourceAnnotations = useMemo<SourceAnnotationRow[]>(() => {
    if (!selectedRow) return [];
    const codeById = new Map(codes.map((code) => [code.id, code]));
    return annotations
      .filter((annotation) => annotation.sourceId === selectedRow.id)
      .map((annotation) => ({
        id: annotation.id,
        codeIds: annotation.codeIds,
        codeLabels: annotation.codeIds.map((codeId) => codeById.get(codeId)?.label ?? annotation.primaryCodeLabel).filter(Boolean),
        codeColors: annotation.codeIds.map((codeId) => codeById.get(codeId)?.color ?? "#888888"),
        quote: annotation.quote,
        note: annotation.note,
        anchorKind: annotation.anchorKind,
        timeStartMs: annotation.timeStartMs,
        timeEndMs: annotation.timeEndMs,
        imageRegion: annotation.imageRegion,
        startOffset: annotation.startOffset,
        endOffset: annotation.endOffset,
        createdByName: annotation.createdByName,
        createdAt: annotation.createdAt,
      }))
      .sort((left, right) => (left.startOffset ?? 0) - (right.startOffset ?? 0) || left.createdAt.localeCompare(right.createdAt));
  }, [annotations, codes, selectedRow]);

  useEffect(() => {
    if (!initialSourceId || selectedRow?.id !== initialSourceId) return;
    if (initialAnnotationId && !selectedSourceAnnotations.some((annotation) => annotation.id === initialAnnotationId)) return;
    onInitialNavigationHandled?.();
  }, [initialAnnotationId, initialSourceId, onInitialNavigationHandled, selectedRow?.id, selectedSourceAnnotations]);
  const selectedSourceObjects = useMemo<SourceObjectRow[]>(() => {
    if (!selectedRow) return [];
    const objectById = new Map(availableObjects.map((object) => [object.id, object]));
    return sourceObjectLinks
      .filter((link) => link.sourceId === selectedRow.id)
      .map((link) => objectById.get(link.objectId) ?? null)
      .filter((object): object is SourceObjectRow => object != null)
      .sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: "base" }));
  }, [availableObjects, selectedRow, sourceObjectLinks]);
  const selectedSourceRelationships = useMemo<SourceRelationshipRow[]>(() => {
    if (!selectedRow) return [];
    const objectById = new Map(objects.map((object) => [object.id, object]));
    const sourceById = new Map(rows.map((source) => [source.id, source]));
    function endpointLabel(entityType: string, entityId: string, fallbackName: string): { name: string; type: string } {
      if (entityType === "object") {
        const object = objectById.get(entityId);
        return {
          name: object?.title || fallbackName || entityId,
          type: object?.objectType || "Object",
        };
      }
      if (entityType === "source") {
        const source = sourceById.get(entityId);
        return {
          name: source?.name || fallbackName || entityId,
          type: source?.sourceObjectType || source?.type || "Source",
        };
      }
      return { name: fallbackName || entityId, type: entityType || "Endpoint" };
    }
    return relationships
      .filter((relationship) =>
        (relationship.fromEntityType === "source" && relationship.fromEntityId === selectedRow.id)
        || (relationship.toEntityType === "source" && relationship.toEntityId === selectedRow.id)
      )
      .map((relationship) => {
        const selectedIsFrom = relationship.fromEntityType === "source" && relationship.fromEntityId === selectedRow.id;
        const other = selectedIsFrom
          ? endpointLabel(relationship.toEntityType, relationship.toEntityId, relationship.toEntityName)
          : endpointLabel(relationship.fromEntityType, relationship.fromEntityId, relationship.fromEntityName);
        return {
          id: relationship.id,
          relationshipType: relationship.relationshipType,
          otherEndpointName: other.name,
          otherEndpointType: other.type,
          description: relationship.description,
        };
      })
      .sort((left, right) =>
        left.relationshipType.localeCompare(right.relationshipType, undefined, { sensitivity: "base" })
        || left.otherEndpointName.localeCompare(right.otherEndpointName, undefined, { sensitivity: "base" })
      );
  }, [objects, relationships, rows, selectedRow]);
  const availableObjectsForSelectedSource = useMemo(
    () => availableObjects,
    [availableObjects],
  );
  const selectedSourceAttributeValues = useMemo<Array<SharedAttributeDraft & { value: string }>>(() => {
    if (!selectedRow) return [];
    return attributeDefs
      .map((definition) => {
        const value = attributeValues[valueKey(selectedRow.id, definition.id)]?.value ?? "";
        return {
          id: definition.id,
          name: definition.name,
          dataType: definition.dataType,
          description: definition.description,
          options: definition.options,
          value,
        };
      });
  }, [attributeDefs, attributeValues, selectedRow]);
  const sortedAttributeRows = useMemo(() => {
    const nextRows = [...filteredRows];
    nextRows.sort((left, right) => {
      let comparison = 0;
      if (attributeSortCol === "name") {
        comparison = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
      } else {
        const definition = attributeDefs.find((item) => item.id === attributeSortCol);
        const leftValue = attributeValues[valueKey(left.id, attributeSortCol)]?.value ?? "";
        const rightValue = attributeValues[valueKey(right.id, attributeSortCol)]?.value ?? "";
        if (definition?.dataType === "number") {
          comparison = Number(leftValue || "-Infinity") - Number(rightValue || "-Infinity");
        } else {
          comparison = leftValue.localeCompare(rightValue, undefined, { sensitivity: "base" });
        }
      }
      return attributeSortDir === "asc" ? comparison : -comparison;
    });
    return nextRows;
  }, [attributeDefs, attributeSortCol, attributeSortDir, attributeValues, filteredRows]);

  const selectedSourceLock = selectedRow
    ? (activeSourceLock?.sourceId === selectedRow.id
      ? activeSourceLock
      : sourceLockBySourceId.get(selectedRow.id) ?? null)
    : null;
  const pageTitle = showAttributesTable
    ? "Source Attributes"
    : pageTitleOverride ?? (codingEnabled ? "Code Sources" : "Sources");

  if (codingEnabled && selectedRow) {
    const normalizedSourceType = selectedRow.type.trim().toLowerCase();
    const selectedFileExt = selectedRow.filePath ? fileExtensionFromPath(selectedRow.filePath) : "";
    const isImageCodingSource = SOURCE_IMPORT_IMAGE_EXTS.has(selectedFileExt) || normalizedSourceType === "image" || normalizedSourceType === "pdf";
    const isAudioCodingSource = SOURCE_IMPORT_AUDIO_EXTS.has(selectedFileExt) || normalizedSourceType === "audio";
    const isVideoCodingSource = SOURCE_IMPORT_VIDEO_EXTS.has(selectedFileExt) || normalizedSourceType === "video";
    const TextCodingView = textCodingMode === "ai-assisted" ? PostgresSourceAiTextCodingView : PostgresSourceTextCodingView;

    return (
      isImageCodingSource ? (
        <PostgresSourceImageCodingView
          projectId={projectId}
          row={selectedRow}
          codes={codes}
          annotations={selectedSourceAnnotations}
          codeOptions={codeOptions}
          currentUserId={currentUserId}
          sourceLock={selectedSourceLock}
          sourceLockConflict={sourceLockConflict}
          lockSyncing={sourceLockSyncing}
          canKickSourceLocks={canKickSourceLocks}
          canManageAnnotations={canManageAnnotations && codingEnabled}
          canManageMemos={canManageMemos}
          canCreateCodes={canCreateCodes}
          initialSelectedAnnotationId={initialAnnotationId ?? null}
          initialTextSegment={null}
          projectStoragePath={projectStoragePath}
          saving={submitting}
          error={submitError}
          onCreateAnnotation={handleCreateAnnotation}
          onCreateCode={handleCreateCode}
          onUpdateCode={handleUpdateCode}
          onDeleteCode={handleDeleteCode}
          onUpdateAnnotation={handleUpdateAnnotation}
          onDeleteAnnotation={handleDeleteAnnotation}
          onKickSourceLock={handleKickSourceLock}
          onOpenMemoDraft={onOpenPostgresMemoDraft}
          onUpdateSourceWaveform={handleUpdateSourceWaveform}
          onUpdateSourceVideoFrameIndex={handleUpdateSourceVideoFrameIndex}
          onBack={() => {
            setSelectedRow(null);
            setSubmitError(null);
          }}
        />
      ) : isAudioCodingSource ? (
        <PostgresSourceAudioCodingView
          projectId={projectId}
          row={selectedRow}
          codes={codes}
          annotations={selectedSourceAnnotations}
          codeOptions={codeOptions}
          currentUserId={currentUserId}
          sourceLock={selectedSourceLock}
          sourceLockConflict={sourceLockConflict}
          lockSyncing={sourceLockSyncing}
          canKickSourceLocks={canKickSourceLocks}
          canManageAnnotations={canManageAnnotations && codingEnabled}
          canManageMemos={canManageMemos}
          canCreateCodes={canCreateCodes}
          initialSelectedAnnotationId={initialAnnotationId ?? null}
          initialTextSegment={null}
          projectStoragePath={projectStoragePath}
          saving={submitting}
          error={submitError}
          onCreateAnnotation={handleCreateAnnotation}
          onCreateCode={handleCreateCode}
          onUpdateCode={handleUpdateCode}
          onDeleteCode={handleDeleteCode}
          onUpdateAnnotation={handleUpdateAnnotation}
          onDeleteAnnotation={handleDeleteAnnotation}
          onKickSourceLock={handleKickSourceLock}
          onOpenMemoDraft={onOpenPostgresMemoDraft}
          onUpdateSourceWaveform={handleUpdateSourceWaveform}
          onUpdateSourceVideoFrameIndex={handleUpdateSourceVideoFrameIndex}
          onBack={() => {
            setSelectedRow(null);
            setSubmitError(null);
          }}
        />
      ) : isVideoCodingSource ? (
        <PostgresSourceVideoCodingView
          projectId={projectId}
          row={selectedRow}
          codes={codes}
          annotations={selectedSourceAnnotations}
          codeOptions={codeOptions}
          currentUserId={currentUserId}
          sourceLock={selectedSourceLock}
          sourceLockConflict={sourceLockConflict}
          lockSyncing={sourceLockSyncing}
          canKickSourceLocks={canKickSourceLocks}
          canManageAnnotations={canManageAnnotations && codingEnabled}
          canManageMemos={canManageMemos}
          canCreateCodes={canCreateCodes}
          initialSelectedAnnotationId={initialAnnotationId ?? null}
          initialTextSegment={null}
          projectStoragePath={projectStoragePath}
          saving={submitting}
          error={submitError}
          onCreateAnnotation={handleCreateAnnotation}
          onCreateCode={handleCreateCode}
          onUpdateCode={handleUpdateCode}
          onDeleteCode={handleDeleteCode}
          onUpdateAnnotation={handleUpdateAnnotation}
          onDeleteAnnotation={handleDeleteAnnotation}
          onKickSourceLock={handleKickSourceLock}
          onOpenMemoDraft={onOpenPostgresMemoDraft}
          onUpdateSourceWaveform={handleUpdateSourceWaveform}
          onUpdateSourceVideoFrameIndex={handleUpdateSourceVideoFrameIndex}
          onExtractVideoFrame={handleExtractVideoFrameSource}
          onBack={() => {
            setSelectedRow(null);
            setSubmitError(null);
          }}
        />
      ) : (
        <TextCodingView
          projectId={projectId}
          row={selectedRow}
          codes={codes}
          annotations={selectedSourceAnnotations}
          codeOptions={codeOptions}
          currentUserId={currentUserId}
          sourceLock={selectedSourceLock}
          sourceLockConflict={sourceLockConflict}
          lockSyncing={sourceLockSyncing}
          canKickSourceLocks={canKickSourceLocks}
          canManageAnnotations={canManageAnnotations && codingEnabled}
          canManageMemos={canManageMemos}
          canCreateCodes={canCreateCodes}
          initialSelectedAnnotationId={initialAnnotationId ?? null}
          initialTextSegment={initialTextSegment ?? null}
          saving={submitting}
          error={submitError}
          onCreateAnnotation={handleCreateAnnotation}
          onCreateCode={handleCreateCode}
          onUpdateCode={handleUpdateCode}
          onDeleteCode={handleDeleteCode}
          onUpdateAnnotation={handleUpdateAnnotation}
          onDeleteAnnotation={handleDeleteAnnotation}
          onKickSourceLock={handleKickSourceLock}
          onOpenMemoDraft={onOpenPostgresMemoDraft}
          onUpdateSourceWaveform={handleUpdateSourceWaveform}
          onBack={() => {
            setSelectedRow(null);
            setSubmitError(null);
          }}
        />
      )
    );
  }

  if (!codingEnabled && !showAttributesTable && selectedRow) {
    return (
      <div className="view users-view">
        <PostgresSourceDetail
          row={selectedRow}
          codeOptions={codeOptions}
          linkedObjects={selectedSourceObjects}
          relationships={selectedSourceRelationships}
          attributeValues={selectedSourceAttributeValues}
          availableObjects={availableObjectsForSelectedSource}
          currentUserId={currentUserId}
          sourceLock={selectedSourceLock}
          sourceLockConflict={sourceLockConflict}
          lockSyncing={sourceLockSyncing}
          canKickSourceLocks={canKickSourceLocks}
          canManageAnnotations={false}
          saving={submitting}
          error={submitError}
          onCreateAnnotation={handleCreateAnnotation}
          onUpdateAnnotation={handleUpdateAnnotation}
          onDeleteAnnotation={handleDeleteAnnotation}
          onKickSourceLock={handleKickSourceLock}
          onCreateRelationship={() => {
            setNewRelationshipSource(selectedRow);
            setSubmitError(null);
          }}
          onSaveSourceObjects={handleSaveSourceObjects}
          canManageSourceRecord={canManageSources}
          projectStoragePath={projectStoragePath}
          onOpenAttributeHistory={(attribute) => {
            if (!attribute.id) return;
            setAttributeHistoryTarget({
              projectId,
              ownerKind: "source",
              ownerId: selectedRow.id,
              ownerName: selectedRow.name,
              attributeDefinitionId: attribute.id,
              attributeName: attribute.name,
            });
          }}
          onEditSource={() => {
            setEditingRow(selectedRow);
            setEditorOpen(true);
            setSubmitError(null);
          }}
          onDeleteSource={() => {
            setDeleteRow(selectedRow);
            setSubmitError(null);
          }}
          onBack={() => {
            setSelectedRow(null);
            setSubmitError(null);
          }}
        />
        {editorOpen ? (
          <SourceEditorModal
            title={editingRow ? "Edit Source" : "New Source"}
            initialRow={editingRow}
            attributeDefinitions={sourceAttributeDefinitionsForEditor}
            attributeValuesByDefinitionId={sourceAttributeDraftValuesFor(editingRow)}
            saving={submitting}
            error={submitError}
            onCancel={() => {
              if (submitting) return;
              setEditorOpen(false);
              setEditingRow(null);
              setSubmitError(null);
            }}
            onSave={handleSaveSource}
          />
        ) : null}
        {deleteRow ? (
          <div className="modal-overlay" onClick={() => !submitting && setDeleteRow(null)}>
            <div className="modal" onClick={(event) => event.stopPropagation()}>
              <h2>Delete Source</h2>
              <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                Delete <strong>{deleteRow.name}</strong>?
              </p>
              {submitError && <p className="auth-error">{submitError}</p>}
              <div className="form-actions" style={{ marginTop: 24 }}>
                <button className="btn" onClick={() => setDeleteRow(null)} disabled={submitting}>Cancel</button>
                <button className="btn btn--danger" onClick={() => void handleDeleteSource()} disabled={submitting}>
                  {submitting ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {newRelationshipSource ? (
          <CreateSourceRelationshipModal
            source={newRelationshipSource}
            projectId={projectId}
            sources={rows}
            objects={objects}
            relationshipTypes={relationshipTypes}
            relationshipAttributeDefinitions={relationshipAttributeDefinitions}
            saving={submitting}
            error={submitError}
            onCancel={() => {
              if (submitting) return;
              setNewRelationshipSource(null);
              setSubmitError(null);
            }}
            onRelationshipTypeCreated={(relationshipType, attributeDefinitions) => {
              setRelationshipTypes((current) => [...current.filter((entry) => entry.id !== relationshipType.id), relationshipType]);
              setRelationshipAttributeDefinitions((current) => [
                ...current.filter((definition) => definition.relationshipTypeId !== relationshipType.id),
                ...attributeDefinitions,
              ]);
            }}
            onSave={handleCreateSourceRelationship}
          />
        ) : null}
        {attributeHistoryTarget ? (
          <PostgresAttributeValueHistoryModal
            target={attributeHistoryTarget}
            onClose={() => setAttributeHistoryTarget(null)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="view users-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>{pageTitle}</h1>
        </div>
        <div className="view-header-actions">
          {showAttributesTable && selectedSourceKindFilter !== "all" ? (
            <button
              className="btn btn--primary"
              onClick={() => {
                const activeKind = sourceKindFromFilterValue(selectedSourceKindFilter);
                setAttributeDraft({
                  name: "",
                  dataType: "text",
                  description: "",
                  options: [],
                  sourceKinds: activeKind ? [activeKind] : [],
                });
                setAttributeError(null);
              }}
              disabled={!canManageSources}
              title={!canManageSources ? "Only project owners, administrators, or editors can manage sources." : undefined}
            >
              Add Attribute
            </button>
          ) : !showAttributesTable ? (
            <button
              className="btn btn--primary"
              onClick={() => {
                setNewSourceOpen(true);
                setSubmitError(null);
              }}
              disabled={!canManageSources}
              title={!canManageSources ? "Only project owners, administrators, or editors can manage sources." : undefined}
            >
              New Source
            </button>
          ) : null}
        </div>
      </header>

      {error && <p className="users-error">{error}</p>}
      {attributeError && <p className="users-error">{attributeError}</p>}
      {(showAttributesTable || !codingEnabled) && (
        <p className="users-guide-copy" style={{ marginBottom: 16 }}>
          {showAttributesTable
            ? "Source attributes are stored directly in the PostgreSQL workspace. Define shared source metadata here and compare it across sources."
            : "Sources are loaded directly from the PostgreSQL workspace. This project view is read-only for source coding; use Analysis > Code Text to annotate."}
        </p>
      )}

      <div
        className="postgres-sources-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(280px, 340px) minmax(0, 1fr)",
          gap: 20,
          alignItems: "center",
          flex: 1,
          minHeight: 0,
        }}
      >
        <div
          className="home-primary-column"
          style={{
            alignSelf: "center",
            justifyContent: "flex-start",
            gap: 16,
            minHeight: 0,
            maxHeight: "100%",
            overflowY: "auto",
            overflowX: "hidden",
            paddingRight: 4,
          }}
        >
          {!selectedRow ? (
            <div className="ai-assist-home-tabbar" style={{ marginBottom: 0, visibility: "hidden", pointerEvents: "none" }} aria-hidden="true">
              <div className="segmented-control" role="presentation">
                <button type="button" className="segmented-control-option segmented-control-option--active" tabIndex={-1}>
                  Details
                </button>
                <button type="button" className="segmented-control-option" tabIndex={-1}>
                  Attributes
                </button>
              </div>
            </div>
          ) : null}
          <section className="home-project-card" style={{ padding: 0, overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                padding: 18,
                borderBottom: "1px solid rgba(53, 80, 112, 0.08)",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <h2 style={{ margin: 0, fontSize: 18 }}>Source object types</h2>
                  {textCodingMode === "ai-assisted" ? (
                    <p className="users-guide-copy" style={{ margin: 0, fontSize: 12 }}>
                      Text and Transcripts only
                    </p>
                  ) : null}
                </div>
                <span className="home-restricted-value">{sourceKindSummaries.length}</span>
              </div>
            </div>

            <div>
              <table className="users-table" style={{ tableLayout: "fixed" }}>
                <thead>
                  <tr>
                    <th
                      className={`users-th${sourceKindSortCol === "label" ? " users-th--sorted" : ""}`}
                      style={{ width: "62%" }}
                      onClick={() => handleSourceKindSort("label")}
                    >
                      Type
                      <span className="users-sort-icon">
                        {sourceKindSortCol === "label" ? (sourceKindSortDir === "asc" ? " ↑" : " ↓") : " ↕"}
                      </span>
                    </th>
                    <th
                      className={`users-th${sourceKindSortCol === "count" ? " users-th--sorted" : ""}`}
                      style={{ width: "38%" }}
                      onClick={() => handleSourceKindSort("count")}
                    >
                      Count
                      <span className="users-sort-icon">
                        {sourceKindSortCol === "count" ? (sourceKindSortDir === "asc" ? " ↑" : " ↓") : " ↕"}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    className="users-row"
                    style={{
                      background: selectedSourceKindFilter === "all" ? "rgba(53, 80, 112, 0.10)" : undefined,
                      cursor: "pointer",
                    }}
                    onClick={() => handleSelectSourceKind("all")}
                  >
                    <td
                      className="users-td users-td--name"
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleSelectSourceKind("all");
                        }
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span>All</span>
                      </div>
                    </td>
                    <td className="users-td users-td--muted">{visibleRows.length}</td>
                  </tr>
                  {sourceKindSummaries.map((summary) => (
                    <tr
                      key={summary.kind}
                      className="users-row"
                      style={{
                        background: selectedSourceKindFilter === summary.kind ? "rgba(53, 80, 112, 0.10)" : undefined,
                        cursor: "pointer",
                      }}
                      onClick={() => handleSelectSourceKind(summary.kind)}
                    >
                      <td
                        className="users-td users-td--name"
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleSelectSourceKind(summary.kind);
                          }
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, paddingLeft: 18 }}>
                          <SourceObjectTypeSwatch
                            shape={summary.shape}
                            fill={summary.fill}
                            color={summary.color}
                            sourceVisualKey={getSourceObjectVisualKey(summary.systemKey)}
                          />
                          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {sourceTypeRowLabel(summary.label)}
                          </span>
                        </div>
                      </td>
                      <td className="users-td users-td--muted">{summary.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sourceKindSummaries.length === 0 ? (
                <div className="empty-state" style={{ minHeight: 140 }}>
                  <p>No source types yet.</p>
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <section
          className="users-content"
          style={{
            alignItems: "stretch",
            justifyContent: "center",
            gap: 16,
            minHeight: 0,
            maxHeight: "100%",
            overflowY: "auto",
            overflowX: "hidden",
            paddingRight: 4,
          }}
        >
          {!selectedRow ? (
            <div className="ai-assist-home-tabbar" style={{ marginBottom: 0 }}>
              <div className="segmented-control" role="tablist" aria-label="Source workspace views">
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
          ) : null}
          {showAttributesTable ? (
            <>
            {selectedSourceKindFilter === "all" ? (
              <div className="empty-state postgres-users-empty-state">
                <p>Select a source type in the left column to view its attributes.</p>
              </div>
            ) : (
              <div className="users-table-wrap case-attributes-table-wrap">
                <table className="users-table case-attributes-table">
                  <thead>
                    <tr>
                      <th
                        className={`users-th case-attributes-case-col${attributeSortCol === "name" ? " users-th--sorted" : ""}`}
                        onClick={() => handleAttributeSort("name")}
                      >
                        Source
                        <span className="users-sort-icon">
                          {attributeSortCol === "name" ? (attributeSortDir === "asc" ? " ↑" : " ↓") : " ↕"}
                        </span>
                      </th>
                      {attributeDefs.map((attribute) => (
                        <th
                          key={attribute.id}
                          className={`users-th case-attributes-value-col${attributeSortCol === attribute.id ? " users-th--sorted" : ""}`}
                          onClick={() => handleAttributeSort(attribute.id)}
                        >
                          {attribute.name}
                          <span className="users-sort-icon">
                            {attributeSortCol === attribute.id ? (attributeSortDir === "asc" ? " ↑" : " ↓") : " ↕"}
                          </span>
                          <span className="case-attribute-type-label">{attribute.dataType}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loading && <tr><td colSpan={Math.max(attributeDefs.length + 1, 1)} className="users-td-msg">{t("projectDocuments.empty.loading")}</td></tr>}
                    {!loading && sortedAttributeRows.length === 0 && (
                      <tr><td colSpan={Math.max(attributeDefs.length + 1, 1)} className="users-td-msg">No matching sources yet.</td></tr>
                    )}
                    {!loading && sortedAttributeRows.map((row) => (
                      <tr key={row.id} className="case-attributes-row">
                        <td className="users-td users-td--name case-attributes-case-cell">{row.name}</td>
                        {attributeDefs.map((attribute) => {
                          const cellActive = activeAttributeHistoryCell?.sourceId === row.id
                            && activeAttributeHistoryCell.attributeDefinitionId === attribute.id;
                          return (
                          <td
                            key={attribute.id}
                            className={`users-td case-attributes-value-cell${cellActive ? " case-attributes-cell--active" : ""}`}
                            role="button"
                            tabIndex={0}
                            title="View attribute value history"
                            onClick={() => {
                              setActiveAttributeHistoryCell({ sourceId: row.id, attributeDefinitionId: attribute.id });
                              setAttributeHistoryTarget({
                                projectId,
                                ownerKind: "source",
                                ownerId: row.id,
                                ownerName: row.name,
                                attributeDefinitionId: attribute.id,
                                attributeName: attribute.name,
                              });
                            }}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter" && event.key !== " ") return;
                              event.preventDefault();
                              setActiveAttributeHistoryCell({ sourceId: row.id, attributeDefinitionId: attribute.id });
                              setAttributeHistoryTarget({
                                projectId,
                                ownerKind: "source",
                                ownerId: row.id,
                                ownerName: row.name,
                                attributeDefinitionId: attribute.id,
                                attributeName: attribute.name,
                              });
                            }}
                          >
                            {attributeValues[valueKey(row.id, attribute.id)]?.value
                              ? formatAttributeDisplay(attributeValues[valueKey(row.id, attribute.id)]!.value, attribute.dataType)
                              : <span className="cases-no-docs">—</span>}
                          </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            </>
          ) : selectedRow ? (
            <>
              <PostgresSourceDetail
                row={selectedRow}
                codeOptions={codeOptions}
                linkedObjects={selectedSourceObjects}
                relationships={selectedSourceRelationships}
                attributeValues={selectedSourceAttributeValues}
                availableObjects={availableObjectsForSelectedSource}
                currentUserId={currentUserId}
                sourceLock={selectedSourceLock}
                sourceLockConflict={sourceLockConflict}
                lockSyncing={sourceLockSyncing}
                canKickSourceLocks={canKickSourceLocks}
                canManageAnnotations={canManageAnnotations && codingEnabled}
                saving={submitting}
                error={submitError}
                onCreateAnnotation={handleCreateAnnotation}
                onUpdateAnnotation={handleUpdateAnnotation}
                onDeleteAnnotation={handleDeleteAnnotation}
                onKickSourceLock={handleKickSourceLock}
                onCreateRelationship={() => {
                  setNewRelationshipSource(selectedRow);
                  setSubmitError(null);
                }}
                onSaveSourceObjects={handleSaveSourceObjects}
                canManageSourceRecord={canManageSources && !codingEnabled}
                projectStoragePath={projectStoragePath}
                onOpenAttributeHistory={(attribute) => {
                  if (!attribute.id) return;
                  setAttributeHistoryTarget({
                    projectId,
                    ownerKind: "source",
                    ownerId: selectedRow.id,
                    ownerName: selectedRow.name,
                    attributeDefinitionId: attribute.id,
                    attributeName: attribute.name,
                  });
                }}
                onEditSource={() => {
                  setEditingRow(selectedRow);
                  setEditorOpen(true);
                  setSubmitError(null);
                }}
                onDeleteSource={() => {
                  setDeleteRow(selectedRow);
                  setSubmitError(null);
                }}
                onBack={() => {
                  setSelectedRow(null);
                  setSubmitError(null);
                }}
              />
              {editorOpen ? (
                <SourceEditorModal
                  title={editingRow ? "Edit Source" : "New Source"}
                  initialRow={editingRow}
                  attributeDefinitions={sourceAttributeDefinitionsForEditor}
                  attributeValuesByDefinitionId={sourceAttributeDraftValuesFor(editingRow)}
                  saving={submitting}
                  error={submitError}
                  onCancel={() => {
                    if (submitting) return;
                    setEditorOpen(false);
                    setEditingRow(null);
                    setSubmitError(null);
                  }}
                  onSave={handleSaveSource}
                />
              ) : null}
              {deleteRow ? (
                <div className="modal-overlay" onClick={() => !submitting && setDeleteRow(null)}>
                  <div className="modal" onClick={(event) => event.stopPropagation()}>
                    <h2>Delete Source</h2>
                    <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                      Delete <strong>{deleteRow.name}</strong>?
                    </p>
                    {submitError && <p className="auth-error">{submitError}</p>}
                    <div className="form-actions" style={{ marginTop: 24 }}>
                      <button className="btn" onClick={() => setDeleteRow(null)} disabled={submitting}>Cancel</button>
                      <button className="btn btn--danger" onClick={() => void handleDeleteSource()} disabled={submitting}>
                        {submitting ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div
              className="users-table-wrap"
              style={{
                maxHeight: 34 + (Math.max(loading || sorted.length === 0 ? 1 : sorted.length, 1) + 2) * 36,
              }}
            >
              <table className="users-table">
                <thead>
                  <tr>
                    <th
                      style={{ width: "42%" }}
                      className={`users-th${sortCol === "name" ? " users-th--sorted" : ""}`}
                      onClick={() => handleSort("name")}
                    >
                      {t("projectDocuments.columns.name")}
                      <span className="users-sort-icon">{sortCol === "name" ? (sortDir === "asc" ? " ↑" : " ↓") : " ↕"}</span>
                    </th>
                    <th style={{ width: "18%" }} className="users-th">
                      {t("projectDocuments.columns.type")}
                    </th>
                    <th style={{ width: "16%" }} className="users-th">
                      Lock
                    </th>
                    <th
                      style={{ width: "24%" }}
                      className={`users-th${sortCol === "createdAt" ? " users-th--sorted" : ""}`}
                      onClick={() => handleSort("createdAt")}
                    >
                      {t("projectDocuments.columns.created")}
                      <span className="users-sort-icon">{sortCol === "createdAt" ? (sortDir === "asc" ? " ↑" : " ↓") : " ↕"}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan={4} className="users-td-msg">{t("projectDocuments.empty.loading")}</td></tr>
                  )}
                  {!loading && sorted.length === 0 && (
                    <tr><td colSpan={4} className="users-td-msg">No matching sources yet.</td></tr>
                  )}
                  {!loading && sorted.map((row) => {
                    const lock = sourceLockBySourceId.get(row.id) ?? null;
                    const lockStatus = describeSourceLock(lock, currentUserId);
                    return (
                      <tr
                        key={row.id}
                        className="users-row case-list-row"
                        onClick={() => setSelectedRow(row)}
                        onContextMenu={(event) => {
                          if (!canManageSources || showAttributesTable) return;
                          event.preventDefault();
                          setSourceContextMenu({ x: event.clientX, y: event.clientY, row });
                        }}
                        title={lockStatus.title}
                      >
                        <td className="users-td users-td--name">{row.name}</td>
                        <td className="users-td users-td--muted">{sourceKindDisplayLabel(row.type || "source", row.sourceObjectType)}</td>
                        <td className="users-td users-td--muted">{lockStatus.label}</td>
                        <td className="users-td users-td--muted">{fmtDate(row.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {sourceContextMenu ? (
        <div ref={sourceContextMenuRef} className="context-menu" style={sourceContextMenuStyle}>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              setEditingRow(sourceContextMenu.row);
              setEditorOpen(true);
              setSubmitError(null);
              setSourceContextMenu(null);
            }}
          >
            Edit Source
          </button>
          <button
            type="button"
            className="context-menu-item context-menu-item--danger"
            onClick={() => {
              setDeleteRow(sourceContextMenu.row);
              setSubmitError(null);
              setSourceContextMenu(null);
            }}
          >
            Delete Source
          </button>
        </div>
      ) : null}

      {newSourceOpen && (
        <SourceImportModal
          importSettings={sourceImportSettings}
          saving={submitting}
          error={submitError}
          onCancel={() => {
            if (submitting) return;
            setNewSourceOpen(false);
            setSubmitError(null);
          }}
          onSave={handleCreateImportedSource}
        />
      )}
      {newRelationshipSource ? (
        <CreateSourceRelationshipModal
          source={newRelationshipSource}
          projectId={projectId}
          sources={rows}
          objects={objects}
          relationshipTypes={relationshipTypes}
          relationshipAttributeDefinitions={relationshipAttributeDefinitions}
          saving={submitting}
          error={submitError}
          onCancel={() => {
            if (submitting) return;
            setNewRelationshipSource(null);
            setSubmitError(null);
          }}
          onRelationshipTypeCreated={(relationshipType, attributeDefinitions) => {
            setRelationshipTypes((current) => [...current.filter((entry) => entry.id !== relationshipType.id), relationshipType]);
            setRelationshipAttributeDefinitions((current) => [
              ...current.filter((definition) => definition.relationshipTypeId !== relationshipType.id),
              ...attributeDefinitions,
            ]);
          }}
          onSave={handleCreateSourceRelationship}
        />
      ) : null}
      {editorOpen && !selectedRow && (
        <SourceEditorModal
          title={editingRow ? "Edit Source" : "New Source"}
          initialRow={editingRow}
          attributeDefinitions={sourceAttributeDefinitionsForEditor}
          attributeValuesByDefinitionId={sourceAttributeDraftValuesFor(editingRow)}
          saving={submitting}
          error={submitError}
          onCancel={() => {
            if (submitting) return;
            setEditorOpen(false);
            setEditingRow(null);
            setSubmitError(null);
          }}
          onSave={handleSaveSource}
        />
      )}
      {deleteRow && !selectedRow && (
        <div className="modal-overlay" onClick={() => !submitting && setDeleteRow(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h2>Delete Source</h2>
            <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
              Delete <strong>{deleteRow.name}</strong>?
            </p>
            {submitError && <p className="auth-error">{submitError}</p>}
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button className="btn" onClick={() => setDeleteRow(null)} disabled={submitting}>Cancel</button>
              <button className="btn btn--danger" onClick={() => void handleDeleteSource()} disabled={submitting}>
                {submitting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
      {attributeDraft ? (
        <SourceAttributeTypesModal
          draft={attributeDraft}
          sourceTypeOptions={sourceTypeOptions}
          saving={attributeSaving}
          error={attributeError ?? undefined}
          onCancel={() => {
            if (attributeSaving) return;
            setAttributeDraft(null);
            setAttributeError(null);
          }}
          onSave={(draft) => void handleSaveAttribute(draft, {})}
        />
      ) : null}
      {attributeHistoryTarget ? (
        <PostgresAttributeValueHistoryModal
          target={attributeHistoryTarget}
          onClose={() => setAttributeHistoryTarget(null)}
        />
      ) : null}
    </div>
  );
}


