import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import sourcePdfOutlineShapeSvg from "../assets/object-shapes/source-pdf-outline.svg?raw";
import sourceImageOutlineShapeSvg from "../assets/object-shapes/source-image-outline.svg?raw";
import sourceAudioOutlineShapeSvg from "../assets/object-shapes/source-audio-outline.svg?raw";
import sourceVideoOutlineShapeSvg from "../assets/object-shapes/source-video-outline.svg?raw";
import {
  AttributeValuesModal as SharedAttributeValuesModal,
  type SharedAttributeDataType,
  type SharedAttributeDraft,
} from "../components/AttributeValuesModal";
import { ProcessedTranscriptView, getProcessedTranscriptQuestionOutline, parseProcessedTranscriptSegments } from "../components/ProcessedTranscriptView";
import { formatCurrentDateTime, formatCurrentNumber } from "../i18n/formatters";
import { useI18n } from "../i18n/provider";
import { readAppSettings } from "../lib/appSettings";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import { createMediaWaveformCache, serializeMediaWaveformCache } from "../lib/mediaWaveform";
import { createMediaVideoFrameIndexCache, serializeMediaVideoFrameIndexCache } from "../lib/mediaVideoFrameIndex";
import { loadPostgresProjectWorkspaceSnapshot } from "../lib/postgresProjectWorkspace";
import {
  acquirePostgresExperimentSourceLock,
  createPostgresExperimentAnnotation,
  deletePostgresExperimentAnnotation,
  type PostgresExperimentCode,
  type PostgresExperimentAnnotationSummary,
  type PostgresExperimentObject,
  type PostgresExperimentObjectType,
  type PostgresExperimentSourceAttributeDefinition,
  type PostgresExperimentSourceAttributeValue,
  type PostgresExperimentSourceLock,
  type PostgresExperimentSourceObjectLink,
  createPostgresExperimentSource,
  deletePostgresExperimentSource,
  getPostgresExperimentProjectDocumentImportSettings,
  importPostgresExperimentSourceFile,
  kickPostgresExperimentSourceLock,
  listPostgresExperimentProjects,
  releasePostgresExperimentSourceLock,
  savePostgresExperimentSourceAttribute,
  setPostgresExperimentSourceObjects,
  updatePostgresExperimentAnnotation,
  updatePostgresExperimentSource,
} from "../lib/postgresExperiment";
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
type SourceObjectVisualKey = "source_text" | "source_pdf" | "source_image" | "source_audio" | "source_video";

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
  sourceId: string | null;
};

type SourceAttributeDefinitionRow = {
  id: string;
  name: string;
  dataType: SharedAttributeDataType;
  description: string;
  options: string[];
  sortOrder: number;
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
  "source_pdf",
  "source_image",
  "source_audio",
  "source_video",
] as const;
const POSTGRES_SOURCE_KIND_OPTIONS = [
  { value: "text", label: "Text" },
  { value: "pdf", label: "PDF" },
  { value: "image", label: "Image" },
  { value: "audio", label: "Audio" },
  { value: "video", label: "Video" },
] as const;
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
    || systemKey === "source_pdf"
    || systemKey === "source_image"
    || systemKey === "source_audio"
    || systemKey === "source_video"
  ) {
    return systemKey;
  }
  return null;
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

function describeSourceLock(
  lock: PostgresExperimentSourceLock | null | undefined,
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

function buildCodeOptions(codes: PostgresExperimentCode[]): CodeOption[] {
  const childrenOf = new Map<string, PostgresExperimentCode[]>();
  const roots: PostgresExperimentCode[] = [];
  for (const code of codes) {
    if (code.parentCodeId) {
      const group = childrenOf.get(code.parentCodeId) ?? [];
      group.push(code);
      childrenOf.set(code.parentCodeId, group);
    } else {
      roots.push(code);
    }
  }
  const sortGroup = (group: PostgresExperimentCode[]) => {
    group.sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
      return left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
    });
  };
  sortGroup(roots);
  for (const group of childrenOf.values()) sortGroup(group);

  const result: CodeOption[] = [];
  const visit = (group: PostgresExperimentCode[], depth: number) => {
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
          <div className="doc-mode-toggle">
            <button
              type="button"
              className={`doc-mode-toggle-btn${mode === "upload" && uploadTab === "text" ? " doc-mode-toggle-btn--active" : ""}`}
              onClick={() => setCreateMode("text")}
            >
              Text
            </button>
            <button
              type="button"
              className={`doc-mode-toggle-btn${mode === "upload" && uploadTab === "pdf" ? " doc-mode-toggle-btn--active" : ""}`}
              onClick={() => setCreateMode("pdf")}
            >
              PDF
            </button>
            <button
              type="button"
              className={`doc-mode-toggle-btn${mode === "upload" && uploadTab === "image" ? " doc-mode-toggle-btn--active" : ""}`}
              onClick={() => setCreateMode("image")}
            >
              Image
            </button>
            <button
              type="button"
              className={`doc-mode-toggle-btn${mode === "upload" && uploadTab === "audio" ? " doc-mode-toggle-btn--active" : ""}`}
              onClick={() => setCreateMode("audio")}
            >
              Audio
            </button>
            <button
              type="button"
              className={`doc-mode-toggle-btn${mode === "upload" && uploadTab === "video" ? " doc-mode-toggle-btn--active" : ""}`}
              onClick={() => setCreateMode("video")}
            >
              Video
            </button>
            <button
              type="button"
              className={`doc-mode-toggle-btn${mode === "paste" ? " doc-mode-toggle-btn--active" : ""}`}
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
  saving,
  error,
  onCancel,
  onSave,
}: {
  title: string;
  initialRow?: SourceRow | null;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (payload: {
    sourceKind: string;
    name: string;
    notes: string;
    content: string;
  }) => void;
}) {
  const [sourceKind, setSourceKind] = useState(normalizeSourceKindSelection(initialRow?.type));
  const [name, setName] = useState(initialRow?.name || "");
  const [notes, setNotes] = useState(initialRow?.notes || "");
  const [content, setContent] = useState(initialRow?.content || "");

  return (
    <div className="modal-overlay" onClick={() => !saving && onCancel()}>
      <div className="modal modal--wide assoc-doc-modal" onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        <div className="form">
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
        </div>
        {error && <p className="auth-error">{error}</p>}
        <div className="form-actions">
          <button className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
          <button
            className="btn btn--primary"
            onClick={() => onSave({ sourceKind, name, notes, content })}
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

function PostgresSourceDetail({
  row,
  codeOptions,
  linkedObjects,
  attributeValues,
  availableObjects,
  currentUserId,
  sourceLock,
  sourceLockConflict,
  lockSyncing,
  canManageSourceObjects,
  canKickSourceLocks,
  canManageAnnotations,
  saving,
  error,
  onCreateAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onKickSourceLock,
  onSaveSourceObjects,
  canManageSourceRecord,
  projectStoragePath,
  onEditSource,
  onDeleteSource,
  onBack,
}: {
  row: SourceRow;
  codeOptions: CodeOption[];
  linkedObjects: SourceObjectRow[];
  attributeValues: Array<{ name: string; dataType: SharedAttributeDataType; value: string }>;
  availableObjects: SourceObjectRow[];
  currentUserId: string;
  sourceLock: PostgresExperimentSourceLock | null;
  sourceLockConflict: PostgresExperimentSourceLock | null;
  lockSyncing: boolean;
  canManageSourceObjects: boolean;
  canKickSourceLocks: boolean;
  canManageAnnotations: boolean;
  saving: boolean;
  error: string | null;
  onCreateAnnotation: (sourceId: string, selection: PendingSelection, payload: { codeIds: string[]; note: string }) => Promise<void>;
  onUpdateAnnotation: (annotation: SourceAnnotationRow, payload: { codeIds: string[]; note: string }) => Promise<void>;
  onDeleteAnnotation: (annotationId: string) => Promise<void>;
  onKickSourceLock: (lock: PostgresExperimentSourceLock) => Promise<void>;
  onSaveSourceObjects: (sourceId: string, objectIds: string[]) => Promise<void>;
  canManageSourceRecord: boolean;
  projectStoragePath: string;
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

  const normalizedSourceType = row.type.trim().toLowerCase();
  const fileExt = row.filePath ? fileExtensionFromPath(row.filePath) : "";
  const isPdfSource = normalizedSourceType === "pdf";
  const isImageSource = SOURCE_IMPORT_IMAGE_EXTS.has(fileExt) || row.type.toLowerCase() === "image";
  const isAudioSource = SOURCE_IMPORT_AUDIO_EXTS.has(fileExt) || row.type.toLowerCase() === "audio";
  const isVideoSource = SOURCE_IMPORT_VIDEO_EXTS.has(fileExt) || row.type.toLowerCase() === "video";
  const resolvedFilePath = resolveProjectStoragePath(projectStoragePath, row.filePath);
  const processedTranscriptSegments =
    row.type === "Processed Transcript"
      ? parseProcessedTranscriptSegments(row.structuredContentJson)
      : [];
  const questionOutline = getProcessedTranscriptQuestionOutline(processedTranscriptSegments);
  const canEditAnnotations = canManageAnnotations && !!sourceLock && sourceLock.userId === currentUserId && !sourceLockConflict;
  const lockStatus = describeSourceLock(sourceLock, currentUserId);

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
            <dt>{t("projectDocuments.columns.type")}</dt> <dd>{row.type || "Source"}</dd>
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
              <dl className="user-detail-meta case-detail-meta">
                {attributeValues.map((attribute) => (
                  <div key={attribute.name} style={{ display: "contents" }}>
                    <dt>{attribute.name}</dt> <dd>{formatAttributeDisplay(attribute.value, attribute.dataType) || "—"}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          <div className="case-card">
            <div className="case-card-header">
              <h3 className="case-card-title">Research Objects</h3>
              {canManageSourceObjects ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setEditingSourceObjects(true)}
                  disabled={saving}
                >
                  Associate Objects
                </button>
              ) : null}
            </div>
            {linkedObjects.length === 0 ? (
              <p className="case-card-empty">No research objects are linked to this source yet.</p>
            ) : (
              <ul className="code-ann-list">
                {linkedObjects.map((object) => (
                  <li key={object.id} className="code-ann-item">
                    <div className="code-ann-doc">{object.title}</div>
                    <div className="code-ann-meta">{object.objectType || "Object"}</div>
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
              {!isPdfSource && !isImageSource && !isAudioSource && !isVideoSource && row.content ? (
                <TextSizeControls
                  fontSizePx={textSizePx}
                  onDecrease={decreaseTextSize}
                  onIncrease={increaseTextSize}
                />
              ) : null}
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
              row.type === "Processed Transcript" && processedTranscriptSegments.length > 0 ? (
                <div
                  ref={transcriptViewerRef}
                  className="doc-content-body doc-content-body--structured text-source-content-sized"
                  style={{ fontSize: textSizePx }}
                >
                  <ProcessedTranscriptView
                    segments={processedTranscriptSegments}
                    renderSegmentText={(segment) => segment.text}
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
                    {row.content}
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
  codingEnabled?: boolean;
  initialSourceId?: string | null;
  initialAnnotationId?: string | null;
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
  codingEnabled = false,
  initialSourceId,
  initialAnnotationId,
  onInitialNavigationHandled,
  onOpenPostgresMemoDraft,
}: PostgresSourcesViewProps) {
  const { t } = useI18n();
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [codes, setCodes] = useState<PostgresExperimentCode[]>([]);
  const [annotations, setAnnotations] = useState<PostgresExperimentAnnotationSummary[]>([]);
  const [objects, setObjects] = useState<PostgresExperimentObject[]>([]);
  const [objectTypes, setObjectTypes] = useState<PostgresExperimentObjectType[]>([]);
  const [sourceLocks, setSourceLocks] = useState<PostgresExperimentSourceLock[]>([]);
  const [sourceObjectLinks, setSourceObjectLinks] = useState<PostgresExperimentSourceObjectLink[]>([]);
  const [sourceAttributeDefinitions, setSourceAttributeDefinitions] = useState<PostgresExperimentSourceAttributeDefinition[]>([]);
  const [sourceAttributeValues, setSourceAttributeValues] = useState<PostgresExperimentSourceAttributeValue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<SourceRow | null>(null);
  const [sortCol, setSortCol] = useState<SortCol>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [showAttributesTable, setShowAttributesTable] = useState(false);
  const [selectedSourceKindFilter, setSelectedSourceKindFilter] = useState<string>("all");
  const [sourceKindSortCol, setSourceKindSortCol] = useState<SourceKindSortCol>("label");
  const [sourceKindSortDir, setSourceKindSortDir] = useState<SortDir>("asc");
  const [attributeSortCol, setAttributeSortCol] = useState<AttributeSortCol>("name");
  const [attributeSortDir, setAttributeSortDir] = useState<AttributeSortDir>("asc");
  const [attributeDraft, setAttributeDraft] = useState<SharedAttributeDraft | null>(null);
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
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<SourceRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<SourceRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [activeSourceLock, setActiveSourceLock] = useState<PostgresExperimentSourceLock | null>(null);
  const [sourceLockConflict, setSourceLockConflict] = useState<PostgresExperimentSourceLock | null>(null);
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
        listPostgresExperimentProjects(),
      ]);
      setProjectStoragePath(projects.find((project) => project.id === projectId)?.storagePath ?? "");
      setCodes(snapshot.codes);
      setAnnotations(snapshot.annotations);
      setObjects(snapshot.objects);
      setObjectTypes(snapshot.objectTypes);
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

      const sourceObjectBySourceId = new Map(
        snapshot.objects
          .filter((object) => object.sourceId)
          .map((object) => [object.sourceId!, object] as const),
      );

      setRows(
        snapshot.sources.map((source) => {
          const backingObject = sourceObjectBySourceId.get(source.id) ?? null;
          return {
            id: source.id,
            name: source.title,
            type: source.sourceKind || "source",
            sourceObjectType: backingObject?.objectType || source.sourceKind || "Source",
            sourceObjectTypeSystemKey: backingObject?.objectTypeSystemKey ?? null,
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
        const projectSettings = await getPostgresExperimentProjectDocumentImportSettings(projectId);
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

  useEffect(() => {
    if (!initialSourceId || rows.length === 0 || selectedRow?.id === initialSourceId) return;
    const matchingRow = rows.find((row) => row.id === initialSourceId);
    if (!matchingRow) return;
    setSelectedRow(matchingRow);
    onInitialNavigationHandled?.();
  }, [initialSourceId, onInitialNavigationHandled, rows, selectedRow?.id]);

  useEffect(() => {
    if (!selectedRow) return;
    const nextSelectedRow = rows.find((row) => row.id === selectedRow.id) ?? null;
    if (!nextSelectedRow) {
      setSelectedRow(null);
      return;
    }
    if (nextSelectedRow !== selectedRow) {
      setSelectedRow(nextSelectedRow);
    }
  }, [rows, selectedRow]);

  useEffect(() => {
    if (selectedSourceKindFilter === "all") return;
    if (!rows.some((row) => (row.sourceObjectTypeSystemKey || row.sourceObjectType) === selectedSourceKindFilter)) {
      setSelectedSourceKindFilter("all");
    }
  }, [rows, selectedSourceKindFilter]);

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
        void releasePostgresExperimentSourceLock(projectId, activeSourceLock.id);
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
        const result = await acquirePostgresExperimentSourceLock({
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
        void releasePostgresExperimentSourceLock(projectId, heldLockId);
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
    for (const row of rows) {
      const kindKey = row.sourceObjectTypeSystemKey || row.sourceObjectType || row.type || "source";
      const current = summaryByKind.get(kindKey);
      if (current) {
        current.count += 1;
      } else {
        summaryByKind.set(kindKey, {
          label: row.sourceObjectType || row.type || "Source",
          meta: row.sourceObjectTypeSystemKey || row.type || "source",
          count: 1,
          shape: "rounded",
          color: SOURCE_OBJECT_TYPE_DEFAULT_COLOR,
          fill: "filled",
          systemKey: row.sourceObjectTypeSystemKey,
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
  }, [objectTypes, rows, sourceKindSortCol, sourceKindSortDir]);

  const filteredRows = useMemo(
    () => (
      selectedSourceKindFilter === "all"
        ? rows
        : rows.filter((row) => (row.sourceObjectTypeSystemKey || row.sourceObjectType) === selectedSourceKindFilter)
    ),
    [rows, selectedSourceKindFilter],
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

  async function handleSaveSource(payload: {
    sourceKind: string;
    name: string;
    notes: string;
    content: string;
  }) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (editingRow) {
        await updatePostgresExperimentSource({
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
      } else {
        await createPostgresExperimentSource({
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
        await createPostgresExperimentSource({
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
          await importPostgresExperimentSourceFile({
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
      await importPostgresExperimentSourceFile({
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
      await deletePostgresExperimentSource(projectId, deleteRow.id);
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
      const createdAnnotation = await createPostgresExperimentAnnotation({
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
      const updatedAnnotation = await updatePostgresExperimentAnnotation({
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
      await deletePostgresExperimentAnnotation(projectId, annotationId);
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
      await setPostgresExperimentSourceObjects({
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

  async function handleKickSourceLock(lock: PostgresExperimentSourceLock) {
    setSourceLockSyncing(true);
    setSubmitError(null);
    try {
      await kickPostgresExperimentSourceLock({
        projectId,
        sourceId: lock.sourceId,
        lockId: lock.id,
      });
      setSourceLocks((current) => current.filter((entry) => entry.id !== lock.id));
      const result = await acquirePostgresExperimentSourceLock({
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
    draft: SharedAttributeDraft,
    valuesBySource: Record<string, string>,
  ) {
    setAttributeSaving(true);
    setAttributeError(null);
    try {
      await savePostgresExperimentSourceAttribute({
        projectId,
        attributeDefinitionId: draft.id ?? null,
        name: draft.name.trim(),
        dataType: draft.dataType,
        description: draft.description,
        options: draft.options,
        values: rows.map((row) => ({
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

  async function handleUpdateSourceWaveform(sourceId: string, waveformPeaksJson: string) {
    const sourceRow = rows.find((entry) => entry.id === sourceId);
    if (!sourceRow) return;

    await updatePostgresExperimentSource({
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

    await updatePostgresExperimentSource({
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
  const attributeDefs = useMemo<SourceAttributeDefinitionRow[]>(
    () => [...sourceAttributeDefinitions]
      .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, undefined, { sensitivity: "base" }))
      .map((definition) => ({
        id: definition.id,
        name: definition.name,
        dataType: definition.dataType,
        description: definition.description,
        options: definition.options,
        sortOrder: definition.sortOrder,
      })),
    [sourceAttributeDefinitions],
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
  const availableObjects = useMemo<SourceObjectRow[]>(
    () => [...objects]
      .sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: "base" }))
      .map((object) => ({
        id: object.id,
        title: object.title,
        objectType: object.objectType,
        objectTypeSystemKey: object.objectTypeSystemKey,
        sourceId: object.sourceId,
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
  const selectedSourceObjects = useMemo<SourceObjectRow[]>(() => {
    if (!selectedRow) return [];
    const objectById = new Map(availableObjects.map((object) => [object.id, object]));
    return sourceObjectLinks
      .filter((link) => link.sourceId === selectedRow.id)
      .map((link) => objectById.get(link.objectId) ?? null)
      .filter((object): object is SourceObjectRow => object != null)
      .sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: "base" }));
  }, [availableObjects, selectedRow, sourceObjectLinks]);
  const availableObjectsForSelectedSource = useMemo(
    () => availableObjects.filter((object) => object.sourceId !== selectedRow?.id),
    [availableObjects, selectedRow?.id],
  );
  const selectedSourceAttributeValues = useMemo<Array<{ name: string; dataType: SharedAttributeDataType; value: string }>>(() => {
    if (!selectedRow) return [];
    return attributeDefs
      .map((definition) => {
        const value = attributeValues[valueKey(selectedRow.id, definition.id)]?.value ?? "";
        if (!value) return null;
        return {
          name: definition.name,
          dataType: definition.dataType,
          value,
        };
      })
      .filter((value): value is { name: string; dataType: SharedAttributeDataType; value: string } => value != null);
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
  const pageTitle = showAttributesTable ? "Source Attributes" : codingEnabled ? "Code Sources" : "Sources";

  if (codingEnabled && selectedRow) {
    const normalizedSourceType = selectedRow.type.trim().toLowerCase();
    const selectedFileExt = selectedRow.filePath ? fileExtensionFromPath(selectedRow.filePath) : "";
    const isImageCodingSource = SOURCE_IMPORT_IMAGE_EXTS.has(selectedFileExt) || normalizedSourceType === "image" || normalizedSourceType === "pdf";
    const isAudioCodingSource = SOURCE_IMPORT_AUDIO_EXTS.has(selectedFileExt) || normalizedSourceType === "audio";
    const isVideoCodingSource = SOURCE_IMPORT_VIDEO_EXTS.has(selectedFileExt) || normalizedSourceType === "video";

    return (
      isImageCodingSource ? (
        <PostgresSourceImageCodingView
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
          initialSelectedAnnotationId={initialAnnotationId ?? null}
          projectStoragePath={projectStoragePath}
          saving={submitting}
          error={submitError}
          onCreateAnnotation={handleCreateAnnotation}
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
          initialSelectedAnnotationId={initialAnnotationId ?? null}
          projectStoragePath={projectStoragePath}
          saving={submitting}
          error={submitError}
          onCreateAnnotation={handleCreateAnnotation}
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
          initialSelectedAnnotationId={initialAnnotationId ?? null}
          projectStoragePath={projectStoragePath}
          saving={submitting}
          error={submitError}
          onCreateAnnotation={handleCreateAnnotation}
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
        <PostgresSourceTextCodingView
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
          initialSelectedAnnotationId={initialAnnotationId ?? null}
          saving={submitting}
          error={submitError}
          onCreateAnnotation={handleCreateAnnotation}
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
          attributeValues={selectedSourceAttributeValues}
          availableObjects={availableObjectsForSelectedSource}
          currentUserId={currentUserId}
          sourceLock={selectedSourceLock}
          sourceLockConflict={sourceLockConflict}
          lockSyncing={sourceLockSyncing}
          canManageSourceObjects={canManageSources}
          canKickSourceLocks={canKickSourceLocks}
          canManageAnnotations={false}
          saving={submitting}
          error={submitError}
          onCreateAnnotation={handleCreateAnnotation}
          onUpdateAnnotation={handleUpdateAnnotation}
          onDeleteAnnotation={handleDeleteAnnotation}
          onKickSourceLock={handleKickSourceLock}
          onSaveSourceObjects={handleSaveSourceObjects}
          canManageSourceRecord={canManageSources}
          projectStoragePath={projectStoragePath}
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
          <button
            className="btn btn--primary"
            onClick={() => {
              if (showAttributesTable) {
                setAttributeDraft({
                  name: "",
                  dataType: "text",
                  description: "",
                  options: [],
                });
                setAttributeError(null);
                return;
              }
              setNewSourceOpen(true);
              setSubmitError(null);
            }}
            disabled={!canManageSources}
            title={!canManageSources ? "Only project owners, administrators, or editors can manage sources." : undefined}
          >
            {showAttributesTable ? "Add Attribute" : "New Source"}
          </button>
        </div>
      </header>

      {error && <p className="users-error">{error}</p>}
      {attributeError && <p className="users-error">{attributeError}</p>}
      <p className="users-guide-copy" style={{ marginBottom: 16 }}>
        {showAttributesTable
          ? "Source attributes are stored directly in the PostgreSQL workspace. Define shared source metadata here and compare it across sources."
          : codingEnabled
            ? "Sources are loaded directly from the PostgreSQL workspace. This coding workspace supports source locks, annotations, and code assignment."
            : "Sources are loaded directly from the PostgreSQL workspace. This project view is read-only for source coding; use Analysis > Code Text to annotate."}
      </p>

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
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>Source object types</h2>
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
                    }}
                  >
                    <td
                      className="users-td users-td--name"
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setSelectedSourceKindFilter("all");
                        setSelectedRow(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedSourceKindFilter("all");
                          setSelectedRow(null);
                        }
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span>All</span>
                      </div>
                    </td>
                    <td className="users-td users-td--muted">{rows.length}</td>
                  </tr>
                  {sourceKindSummaries.map((summary) => (
                    <tr
                      key={summary.kind}
                      className="users-row"
                      style={{
                        background: selectedSourceKindFilter === summary.kind ? "rgba(53, 80, 112, 0.10)" : undefined,
                      }}
                    >
                      <td
                        className="users-td users-td--name"
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setSelectedSourceKindFilter(summary.kind);
                          setSelectedRow(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedSourceKindFilter(summary.kind);
                            setSelectedRow(null);
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
                      <tr key={row.id} className="users-row">
                        <td className="users-td users-td--name case-attributes-case-cell">{row.name}</td>
                        {attributeDefs.map((attribute) => (
                          <td key={attribute.id} className="users-td case-attributes-value-cell">
                            {attributeValues[valueKey(row.id, attribute.id)]?.value
                              ? formatAttributeDisplay(attributeValues[valueKey(row.id, attribute.id)]!.value, attribute.dataType)
                              : <span className="cases-no-docs">—</span>}
                          </td>
                        ))}
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
                attributeValues={selectedSourceAttributeValues}
                availableObjects={availableObjectsForSelectedSource}
                currentUserId={currentUserId}
                sourceLock={selectedSourceLock}
                sourceLockConflict={sourceLockConflict}
                lockSyncing={sourceLockSyncing}
                canManageSourceObjects={canManageSources}
                canKickSourceLocks={canKickSourceLocks}
                canManageAnnotations={canManageAnnotations && codingEnabled}
                saving={submitting}
                error={submitError}
                onCreateAnnotation={handleCreateAnnotation}
                onUpdateAnnotation={handleUpdateAnnotation}
                onDeleteAnnotation={handleDeleteAnnotation}
                onKickSourceLock={handleKickSourceLock}
                onSaveSourceObjects={handleSaveSourceObjects}
                canManageSourceRecord={canManageSources && !codingEnabled}
                projectStoragePath={projectStoragePath}
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
                        <td className="users-td users-td--muted">{row.type || "source"}</td>
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
      {editorOpen && !selectedRow && (
        <SourceEditorModal
          title={editingRow ? "Edit Source" : "New Source"}
          initialRow={editingRow}
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
        <SharedAttributeValuesModal
          draft={attributeDraft}
          rows={rows.map((row) => ({ id: row.id, name: row.name }))}
          initialValuesByOwner={Object.fromEntries(
            rows.map((row) => [
              row.id,
              attributeDraft.id ? attributeValues[valueKey(row.id, attributeDraft.id)]?.value ?? "" : "",
            ]),
          )}
          saving={attributeSaving}
          error={attributeError ?? undefined}
          onCancel={() => {
            if (attributeSaving) return;
            setAttributeDraft(null);
            setAttributeError(null);
          }}
          onSave={handleSaveAttribute}
          emptyStateLabel="No sources yet."
        />
      ) : null}
    </div>
  );
}


