import type { CSSProperties } from "react";
import sourceTextOutlineShapeSvg from "../assets/object-shapes/source-text-outline.svg?raw";
import sourceProcessedTranscriptOutlineShapeSvg from "../assets/object-shapes/source-processed-transcript-outline.svg?raw";
import sourcePdfOutlineShapeSvg from "../assets/object-shapes/source-pdf-outline.svg?raw";
import sourceImageOutlineShapeSvg from "../assets/object-shapes/source-image-outline.svg?raw";
import sourceAudioOutlineShapeSvg from "../assets/object-shapes/source-audio-outline.svg?raw";
import sourceVideoOutlineShapeSvg from "../assets/object-shapes/source-video-outline.svg?raw";
import type {
  PostgresCanvasNodeState,
  PostgresObject,
  PostgresObjectType,
  PostgresRelationship,
  PostgresRelationshipType,
} from "./postgres";
import { POSTGRES_SOURCE_DOCUMENT_SILHOUETTE_POLYGON } from "./postgresCanvasGraph";

export type PostgresObjectTypeShape =
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

export type PostgresSourceObjectVisualKey =
  | "source_text"
  | "source_processed_transcript"
  | "source_pdf"
  | "source_image"
  | "source_audio"
  | "source_video";

export type PostgresObjectFill = "filled" | "outline";
export type PostgresRelationshipLineShape =
  | "solid"
  | "dashed"
  | "long_dashed"
  | "short_dashed"
  | "dotted"
  | "loose_dotted"
  | "dash_dot"
  | "dash_dot_dot";
export type PostgresRelationshipArrowhead = "one_sided" | "double_sided" | "none";

export const POSTGRES_OBJECT_TYPE_DEFAULT_COLOR = "#355070";
export const POSTGRES_OBJECT_TYPE_DEFAULT_FILL_TRANSPARENCY = 0;
export const POSTGRES_OBJECT_TYPE_DEFAULT_OUTLINE_WIDTH = 2;
export const POSTGRES_SHAPE_PICKER_PREVIEW_COLOR = "#64748b";
export const POSTGRES_SHAPE_PICKER_PREVIEW_FILL_TRANSPARENCY = 60;
export const POSTGRES_RELATIONSHIP_PICKER_PREVIEW_COLOR = "#64748b";
export const POSTGRES_RELATIONSHIP_DEFAULT_COLOR = "#355070";
export const POSTGRES_RELATIONSHIP_LINE_WEIGHT_MIN = 1;
export const POSTGRES_RELATIONSHIP_LINE_WEIGHT_MAX = 16;

export const POSTGRES_OBJECT_TYPE_SHAPE_OPTIONS: { value: PostgresObjectTypeShape; label: string }[] = [
  { value: "rounded", label: "Circle" },
  { value: "rectangle", label: "Rectangle" },
  { value: "triangle", label: "Triangle" },
  { value: "diamond", label: "Diamond" },
  { value: "hexagon", label: "Hexagon" },
  { value: "octagon", label: "Octagon" },
  { value: "parallelogram", label: "Parallelogram" },
  { value: "trapezoid", label: "Trapezoid" },
  { value: "tag", label: "Tag" },
  { value: "star", label: "Star" },
];

export const POSTGRES_OBJECT_FILL_OPTIONS: { value: PostgresObjectFill; label: string }[] = [
  { value: "filled", label: "Filled" },
  { value: "outline", label: "Outline" },
];

export const POSTGRES_RELATIONSHIP_LINE_SHAPE_OPTIONS: { value: PostgresRelationshipLineShape; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "long_dashed", label: "Long dash" },
  { value: "short_dashed", label: "Short dash" },
  { value: "dotted", label: "Dotted" },
  { value: "loose_dotted", label: "Loose dots" },
  { value: "dash_dot", label: "Dash-dot" },
  { value: "dash_dot_dot", label: "Dash-dot-dot" },
];

export const POSTGRES_RELATIONSHIP_LINE_WEIGHT_OPTIONS = [
  { value: 1, label: "Thin" },
  { value: 2, label: "Regular" },
  { value: 3, label: "Bold" },
  { value: 4, label: "Heavy" },
] as const;

export const POSTGRES_RELATIONSHIP_ARROWHEAD_OPTIONS: { value: PostgresRelationshipArrowhead; label: string }[] = [
  { value: "one_sided", label: "One-sided" },
  { value: "double_sided", label: "Double-sided" },
  { value: "none", label: "No arrows" },
];

export const POSTGRES_SOURCE_KIND_OPTIONS: Array<{
  id: string;
  label: string;
  color: string;
  sourceVisualKey: PostgresSourceObjectVisualKey;
}> = [
  { id: "Text", label: "Text", color: "#355070", sourceVisualKey: "source_text" },
  { id: "Transcript", label: "Transcript", color: "#2a9d8f", sourceVisualKey: "source_processed_transcript" },
  { id: "PDF", label: "PDF", color: "#7f5539", sourceVisualKey: "source_pdf" },
  { id: "Image", label: "Image", color: "#6d597a", sourceVisualKey: "source_image" },
  { id: "Audio", label: "Audio", color: "#b56576", sourceVisualKey: "source_audio" },
  { id: "Video", label: "Video", color: "#457b9d", sourceVisualKey: "source_video" },
];

function buildSvgDataUrl(svgMarkup: string): string {
  const normalizedMarkup = svgMarkup.replace("<svg ", '<svg width="100" height="100" ');
  return `data:image/svg+xml;utf8,${encodeURIComponent(normalizedMarkup)}`;
}

const POSTGRES_SOURCE_OBJECT_SHAPE_ASSET_URLS: Record<PostgresSourceObjectVisualKey, string> = {
  source_text: buildSvgDataUrl(sourceTextOutlineShapeSvg),
  source_processed_transcript: buildSvgDataUrl(sourceProcessedTranscriptOutlineShapeSvg),
  source_pdf: buildSvgDataUrl(sourcePdfOutlineShapeSvg),
  source_image: buildSvgDataUrl(sourceImageOutlineShapeSvg),
  source_audio: buildSvgDataUrl(sourceAudioOutlineShapeSvg),
  source_video: buildSvgDataUrl(sourceVideoOutlineShapeSvg),
};

export function isPostgresSourceObjectVisualKey(value: string | null | undefined): value is PostgresSourceObjectVisualKey {
  return value === "source_text"
    || value === "source_processed_transcript"
    || value === "source_pdf"
    || value === "source_image"
    || value === "source_audio"
    || value === "source_video";
}

export function getPostgresSourceObjectVisualKey(systemKey: string | null | undefined): PostgresSourceObjectVisualKey | null {
  return isPostgresSourceObjectVisualKey(systemKey) ? systemKey : null;
}

export function normalizePostgresObjectTypeShape(value: string): PostgresObjectTypeShape {
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

export function normalizePostgresObjectFill(value: string): PostgresObjectFill {
  return value.trim().toLowerCase() === "outline" ? "outline" : "filled";
}

export function normalizePostgresObjectTypeColor(value: string): string {
  const normalized = value.trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : POSTGRES_OBJECT_TYPE_DEFAULT_COLOR;
}

export function normalizeOptionalPostgresObjectTypeColor(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : "";
}

export function normalizePostgresObjectFillTransparency(value: number | null | undefined): number {
  return Math.max(0, Math.min(100, value ?? POSTGRES_OBJECT_TYPE_DEFAULT_FILL_TRANSPARENCY));
}

export function normalizePostgresObjectOutlineWidth(value: number | null | undefined): number {
  return Math.max(1, Math.min(10, value ?? POSTGRES_OBJECT_TYPE_DEFAULT_OUTLINE_WIDTH));
}

export function normalizePostgresRelationshipLineShape(value: string): PostgresRelationshipLineShape {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "dashed"
    || normalized === "long_dashed"
    || normalized === "short_dashed"
    || normalized === "dotted"
    || normalized === "loose_dotted"
    || normalized === "dash_dot"
    || normalized === "dash_dot_dot"
  ) return normalized;
  return "solid";
}

export function normalizePostgresRelationshipLineWeight(value: number | null | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 2;
  return Math.max(
    POSTGRES_RELATIONSHIP_LINE_WEIGHT_MIN,
    Math.min(POSTGRES_RELATIONSHIP_LINE_WEIGHT_MAX, Math.round(value)),
  );
}

export function normalizePostgresRelationshipArrowhead(value: string): PostgresRelationshipArrowhead {
  const normalized = value.trim().toLowerCase();
  if (normalized === "double_sided" || normalized === "none") return normalized;
  return "one_sided";
}

export function normalizePostgresRelationshipColor(value: string): string {
  const normalized = value.trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : POSTGRES_RELATIONSHIP_DEFAULT_COLOR;
}

export function normalizeOptionalPostgresRelationshipColor(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : "";
}

export function resolvePostgresObjectShape(
  object: Pick<PostgresObject, "shapeOverride">,
  objectTypeRecord: Pick<PostgresObjectType, "shape"> | null,
): PostgresObjectTypeShape {
  return normalizePostgresObjectTypeShape(object.shapeOverride || objectTypeRecord?.shape || "");
}

export function resolvePostgresObjectColor(
  object: Pick<PostgresObject, "colorOverride">,
  objectTypeRecord: Pick<PostgresObjectType, "color"> | null,
): string {
  return normalizePostgresObjectTypeColor(object.colorOverride || objectTypeRecord?.color || "");
}

export function resolvePostgresObjectOutlineColor(
  object: Pick<PostgresObject, "outlineColorOverride" | "colorOverride">,
  objectTypeRecord: Pick<PostgresObjectType, "outlineColor" | "color"> | null,
): string {
  return normalizePostgresObjectTypeColor(
    object.outlineColorOverride
      || object.colorOverride
      || objectTypeRecord?.outlineColor
      || objectTypeRecord?.color
      || "",
  );
}

export function resolvePostgresObjectFill(
  object: Pick<PostgresObject, "fillOverride">,
  objectTypeRecord: Pick<PostgresObjectType, "fill"> | null,
): PostgresObjectFill {
  return normalizePostgresObjectFill(object.fillOverride || objectTypeRecord?.fill || "");
}

export function getPostgresObjectAppearance(
  object: Pick<PostgresObject, "shapeOverride" | "colorOverride" | "outlineColorOverride" | "fillOverride" | "imageStoragePath"> & {
    fillTransparencyOverride?: number | null;
    outlineWidthOverride?: number | null;
  },
  objectTypeRecord: Pick<PostgresObjectType, "shape" | "color" | "outlineColor" | "fill" | "fillTransparency" | "outlineWidth" | "systemKey" | "imageStoragePath"> | null,
): {
  shape: PostgresObjectTypeShape;
  color: string;
  outlineColor: string;
  fill: PostgresObjectFill;
  fillTransparency: number;
  outlineWidth: number;
  imageStoragePath: string;
  sourceVisualKey: PostgresSourceObjectVisualKey | null;
  sourceImage: string;
  sourceSilhouettePolygon: string;
  hasShapeOverride: boolean;
  hasColorOverride: boolean;
  hasOutlineColorOverride: boolean;
  hasFillOverride: boolean;
} {
  const hasShapeOverride = !!object.shapeOverride.trim();
  const sourceVisualKey = hasShapeOverride ? null : getPostgresSourceObjectVisualKey(objectTypeRecord?.systemKey);
  return {
    shape: resolvePostgresObjectShape(object, objectTypeRecord),
    color: resolvePostgresObjectColor(object, objectTypeRecord),
    outlineColor: resolvePostgresObjectOutlineColor(object, objectTypeRecord),
    fill: resolvePostgresObjectFill(object, objectTypeRecord),
    fillTransparency: normalizePostgresObjectFillTransparency(object.fillTransparencyOverride ?? objectTypeRecord?.fillTransparency),
    outlineWidth: normalizePostgresObjectOutlineWidth(object.outlineWidthOverride ?? objectTypeRecord?.outlineWidth),
    imageStoragePath: object.imageStoragePath || objectTypeRecord?.imageStoragePath || "",
    sourceVisualKey,
    sourceImage: sourceVisualKey ? POSTGRES_SOURCE_OBJECT_SHAPE_ASSET_URLS[sourceVisualKey] : "",
    sourceSilhouettePolygon: sourceVisualKey ? POSTGRES_SOURCE_DOCUMENT_SILHOUETTE_POLYGON : "",
    hasShapeOverride,
    hasColorOverride: !!object.colorOverride.trim(),
    hasOutlineColorOverride: !!object.outlineColorOverride.trim(),
    hasFillOverride: !!object.fillOverride.trim(),
  };
}

export function resolvePostgresRelationshipLineShape(
  relationship: Pick<PostgresRelationship, "lineShapeOverride">,
  relationshipTypeRecord: Pick<PostgresRelationshipType, "lineShape"> | null,
): PostgresRelationshipLineShape {
  return normalizePostgresRelationshipLineShape(
    relationship.lineShapeOverride || relationshipTypeRecord?.lineShape || "",
  );
}

export function resolvePostgresRelationshipColor(
  relationship: Pick<PostgresRelationship, "colorOverride">,
  relationshipTypeRecord: Pick<PostgresRelationshipType, "color"> | null,
): string {
  return normalizePostgresRelationshipColor(
    relationship.colorOverride || relationshipTypeRecord?.color || "",
  );
}

export function resolvePostgresRelationshipLineWeight(
  relationship: Pick<PostgresRelationship, "lineWeightOverride">,
  relationshipTypeRecord: Pick<PostgresRelationshipType, "lineWeight"> | null,
): number {
  return normalizePostgresRelationshipLineWeight(
    relationship.lineWeightOverride ?? relationshipTypeRecord?.lineWeight,
  );
}

export function resolvePostgresRelationshipArrowhead(
  relationship: Pick<PostgresRelationship, "arrowheadOverride">,
  relationshipTypeRecord: Pick<PostgresRelationshipType, "arrowhead"> | null,
): PostgresRelationshipArrowhead {
  return normalizePostgresRelationshipArrowhead(
    relationship.arrowheadOverride || relationshipTypeRecord?.arrowhead || "",
  );
}

export function getPostgresRelationshipAppearance(
  relationship: Pick<PostgresRelationship, "lineShapeOverride" | "lineWeightOverride" | "arrowheadOverride" | "colorOverride">,
  relationshipTypeRecord: Pick<PostgresRelationshipType, "lineShape" | "lineWeight" | "arrowhead" | "color"> | null,
): {
  lineShape: PostgresRelationshipLineShape;
  lineWeight: number;
  arrowhead: PostgresRelationshipArrowhead;
  color: string;
  hasLineShapeOverride: boolean;
  hasLineWeightOverride: boolean;
  hasArrowheadOverride: boolean;
  hasColorOverride: boolean;
} {
  return {
    lineShape: resolvePostgresRelationshipLineShape(relationship, relationshipTypeRecord),
    lineWeight: resolvePostgresRelationshipLineWeight(relationship, relationshipTypeRecord),
    arrowhead: resolvePostgresRelationshipArrowhead(relationship, relationshipTypeRecord),
    color: resolvePostgresRelationshipColor(relationship, relationshipTypeRecord),
    hasLineShapeOverride: !!relationship.lineShapeOverride.trim(),
    hasLineWeightOverride: relationship.lineWeightOverride !== null && relationship.lineWeightOverride !== undefined,
    hasArrowheadOverride: !!relationship.arrowheadOverride.trim(),
    hasColorOverride: !!relationship.colorOverride.trim(),
  };
}

export function formatPostgresObjectShapeLabel(shape: PostgresObjectTypeShape): string {
  return POSTGRES_OBJECT_TYPE_SHAPE_OPTIONS.find((option) => option.value === shape)?.label ?? "Circle";
}

export function formatPostgresObjectFillLabel(fill: PostgresObjectFill): string {
  return POSTGRES_OBJECT_FILL_OPTIONS.find((option) => option.value === fill)?.label ?? "Filled";
}

export function formatPostgresRelationshipLineShapeLabel(lineShape: PostgresRelationshipLineShape): string {
  return POSTGRES_RELATIONSHIP_LINE_SHAPE_OPTIONS.find((option) => option.value === lineShape)?.label ?? "Solid";
}

export function formatPostgresRelationshipLineWeightLabel(lineWeight: number): string {
  return `${normalizePostgresRelationshipLineWeight(lineWeight)}px`;
}

export function formatPostgresRelationshipArrowheadLabel(arrowhead: PostgresRelationshipArrowhead): string {
  return POSTGRES_RELATIONSHIP_ARROWHEAD_OPTIONS.find((option) => option.value === arrowhead)?.label ?? "One-sided";
}

export function getPostgresRelationshipStrokeWidth(lineWeight: number): number {
  return normalizePostgresRelationshipLineWeight(lineWeight);
}

export function getPostgresRelationshipStrokeDasharray(lineShape: PostgresRelationshipLineShape): string | undefined {
  if (lineShape === "dashed") return "8 6";
  if (lineShape === "long_dashed") return "14 7";
  if (lineShape === "short_dashed") return "5 5";
  if (lineShape === "dotted") return "2 6";
  if (lineShape === "loose_dotted") return "2 10";
  if (lineShape === "dash_dot") return "10 5 2 5";
  if (lineShape === "dash_dot_dot") return "10 5 2 5 2 5";
  return undefined;
}

export function hexToRgba(hex: string, alpha: number): string {
  const normalized = normalizePostgresObjectTypeColor(hex);
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function getCanvasNodeTextColor(hex: string): string {
  const normalized = normalizePostgresObjectTypeColor(hex);
  const red = Number.parseInt(normalized.slice(1, 3), 16) / 255;
  const green = Number.parseInt(normalized.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(normalized.slice(5, 7), 16) / 255;
  const luminance = (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
  return luminance > 0.65 ? "#1f2933" : "#f8fafc";
}

export function getPostgresObjectSurfaceStyle(
  color: string,
  fill: PostgresObjectFill,
  selected = false,
  outlineColor = color,
): {
  background: string;
  boxShadow: string;
  edgeColor: string;
  textColor: string;
} {
  const edgeColor = outlineColor;
  if (fill === "outline") {
    return {
      background: "rgba(255, 255, 255, 0.98)",
      boxShadow: selected ? `0 22px 42px ${hexToRgba(outlineColor, 0.16)}` : `0 18px 36px ${hexToRgba(outlineColor, 0.08)}`,
      edgeColor,
      textColor: "#1f2933",
    };
  }
  return {
    background: `linear-gradient(180deg, ${hexToRgba(color, 0.94)}, ${hexToRgba(color, 0.78)})`,
    boxShadow: selected ? `0 22px 42px ${hexToRgba(outlineColor, 0.22)}` : `0 18px 36px ${hexToRgba(outlineColor, 0.14)}`,
    edgeColor,
    textColor: getCanvasNodeTextColor(color),
  };
}

export type CanvasNodeShapeConfig = {
  width: number;
  height: number;
  borderRadius: number | string;
  clipPath?: string;
  previewWidth: number;
  previewHeight: number;
  contentPadding: string;
  contentAlign: {
    justifyContent: CSSProperties["justifyContent"];
    alignItems: CSSProperties["alignItems"];
    textAlign: CSSProperties["textAlign"];
  };
  handleTarget: CSSProperties;
  handleSource: CSSProperties;
};

const CANVAS_NODE_SHAPE_CONFIGS: Record<PostgresObjectTypeShape, CanvasNodeShapeConfig> = {
  rounded: {
    width: 184,
    height: 184,
    borderRadius: "50%",
    previewWidth: 48,
    previewHeight: 48,
    contentPadding: "30px 28px 28px",
    contentAlign: { justifyContent: "center", alignItems: "center", textAlign: "center" },
    handleTarget: { top: "50%", left: 10, transform: "translate(-50%, -50%)" },
    handleSource: { top: "50%", right: 10, transform: "translate(50%, -50%)" },
  },
  rectangle: {
    width: 228,
    height: 132,
    borderRadius: 10,
    previewWidth: 58,
    previewHeight: 40,
    contentPadding: "18px 20px",
    contentAlign: { justifyContent: "flex-start", alignItems: "stretch", textAlign: "left" },
    handleTarget: { top: "50%", transform: "translate(-50%, -50%)" },
    handleSource: { top: "50%", transform: "translate(50%, -50%)" },
  },
  triangle: {
    width: 230,
    height: 190,
    borderRadius: 0,
    clipPath: "polygon(50% 0%, 100% 100%, 0% 100%)",
    previewWidth: 52,
    previewHeight: 48,
    contentPadding: "54px 34px 22px",
    contentAlign: { justifyContent: "flex-end", alignItems: "center", textAlign: "center" },
    handleTarget: { top: "74%", left: 28, transform: "translate(-50%, -50%)" },
    handleSource: { top: "74%", right: 28, transform: "translate(50%, -50%)" },
  },
  diamond: {
    width: 204,
    height: 204,
    borderRadius: 0,
    clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
    previewWidth: 48,
    previewHeight: 48,
    contentPadding: "34px 40px",
    contentAlign: { justifyContent: "center", alignItems: "center", textAlign: "center" },
    handleTarget: { top: "50%", left: 14, transform: "translate(-50%, -50%)" },
    handleSource: { top: "50%", right: 14, transform: "translate(50%, -50%)" },
  },
  hexagon: {
    width: 208,
    height: 156,
    borderRadius: 0,
    clipPath: "polygon(12% 0%, 88% 0%, 100% 50%, 88% 100%, 12% 100%, 0% 50%)",
    previewWidth: 60,
    previewHeight: 42,
    contentPadding: "24px 30px",
    contentAlign: { justifyContent: "flex-start", alignItems: "stretch", textAlign: "left" },
    handleTarget: { top: "50%", left: 12, transform: "translate(-50%, -50%)" },
    handleSource: { top: "50%", right: 12, transform: "translate(50%, -50%)" },
  },
  octagon: {
    width: 188,
    height: 164,
    borderRadius: 0,
    clipPath: "polygon(18% 0%, 82% 0%, 100% 18%, 100% 82%, 82% 100%, 18% 100%, 0% 82%, 0% 18%)",
    previewWidth: 54,
    previewHeight: 46,
    contentPadding: "24px 28px",
    contentAlign: { justifyContent: "flex-start", alignItems: "stretch", textAlign: "left" },
    handleTarget: { top: "50%", left: 14, transform: "translate(-50%, -50%)" },
    handleSource: { top: "50%", right: 14, transform: "translate(50%, -50%)" },
  },
  parallelogram: {
    width: 210,
    height: 132,
    borderRadius: 0,
    clipPath: "polygon(14% 0%, 100% 0%, 86% 100%, 0% 100%)",
    previewWidth: 60,
    previewHeight: 40,
    contentPadding: "18px 30px 18px 34px",
    contentAlign: { justifyContent: "flex-start", alignItems: "stretch", textAlign: "left" },
    handleTarget: { top: "50%", left: 18, transform: "translate(-50%, -50%)" },
    handleSource: { top: "50%", right: 18, transform: "translate(50%, -50%)" },
  },
  trapezoid: {
    width: 188,
    height: 142,
    borderRadius: 0,
    clipPath: "polygon(14% 0%, 86% 0%, 100% 100%, 0% 100%)",
    previewWidth: 60,
    previewHeight: 42,
    contentPadding: "24px 28px 18px",
    contentAlign: { justifyContent: "flex-start", alignItems: "stretch", textAlign: "left" },
    handleTarget: { top: "58%", left: 14, transform: "translate(-50%, -50%)" },
    handleSource: { top: "58%", right: 14, transform: "translate(50%, -50%)" },
  },
  tag: {
    width: 206,
    height: 140,
    borderRadius: 0,
    clipPath: "polygon(0% 0%, 78% 0%, 100% 50%, 78% 100%, 0% 100%, 12% 50%)",
    previewWidth: 62,
    previewHeight: 40,
    contentPadding: "22px 34px 22px 30px",
    contentAlign: { justifyContent: "flex-start", alignItems: "stretch", textAlign: "left" },
    handleTarget: { top: "50%", left: 22, transform: "translate(-50%, -50%)" },
    handleSource: { top: "50%", right: 12, transform: "translate(50%, -50%)" },
  },
  star: {
    width: 214,
    height: 204,
    borderRadius: 0,
    clipPath: "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
    previewWidth: 54,
    previewHeight: 50,
    contentPadding: "42px 36px 34px",
    contentAlign: { justifyContent: "center", alignItems: "center", textAlign: "center" },
    handleTarget: { top: "43%", left: 22, transform: "translate(-50%, -50%)" },
    handleSource: { top: "43%", right: 22, transform: "translate(50%, -50%)" },
  },
};

export function getCanvasNodeShapeConfig(shape: PostgresObjectTypeShape): CanvasNodeShapeConfig {
  return CANVAS_NODE_SHAPE_CONFIGS[shape] ?? CANVAS_NODE_SHAPE_CONFIGS.rounded;
}

export function getObjectShapePreviewStyle(shape: PostgresObjectTypeShape): {
  width: number;
  minHeight: number;
  borderRadius: number | string;
  clipPath?: string;
} {
  const config = getCanvasNodeShapeConfig(shape);
  return {
    width: config.previewWidth,
    minHeight: config.previewHeight,
    borderRadius: config.borderRadius,
    clipPath: config.clipPath,
  };
}

export function getCanvasNodeDefaultDimensions(shape: PostgresObjectTypeShape): { width: number; height: number } {
  const config = getCanvasNodeShapeConfig(shape);
  return {
    width: config.width,
    height: config.height,
  };
}

export function getCanvasNodeRenderedDimensions(
  shape: PostgresObjectTypeShape,
  nodeState?: Pick<PostgresCanvasNodeState, "width" | "height"> | null,
): { width: number; height: number } {
  const defaultDimensions = getCanvasNodeDefaultDimensions(shape);
  return {
    width: nodeState?.width ?? defaultDimensions.width,
    height: nodeState?.height ?? defaultDimensions.height,
  };
}

export function getSvgShapePoints(shape: PostgresObjectTypeShape, width: number, height: number): string | null {
  switch (shape) {
    case "triangle":
      return `${width / 2},0 ${width},${height} 0,${height}`;
    case "diamond":
      return `${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}`;
    case "hexagon":
      return `${width * 0.12},0 ${width * 0.88},0 ${width},${height / 2} ${width * 0.88},${height} ${width * 0.12},${height} 0,${height / 2}`;
    case "octagon":
      return `${width * 0.18},0 ${width * 0.82},0 ${width},${height * 0.18} ${width},${height * 0.82} ${width * 0.82},${height} ${width * 0.18},${height} 0,${height * 0.82} 0,${height * 0.18}`;
    case "parallelogram":
      return `${width * 0.14},0 ${width},0 ${width * 0.86},${height} 0,${height}`;
    case "trapezoid":
      return `${width * 0.14},0 ${width * 0.86},0 ${width},${height} 0,${height}`;
    case "tag":
      return `0,0 ${width * 0.78},0 ${width},${height / 2} ${width * 0.78},${height} 0,${height} ${width * 0.12},${height / 2}`;
    case "star":
      return `${width * 0.5},0 ${width * 0.61},${height * 0.35} ${width * 0.98},${height * 0.35} ${width * 0.68},${height * 0.57} ${width * 0.79},${height * 0.91} ${width * 0.5},${height * 0.7} ${width * 0.21},${height * 0.91} ${width * 0.32},${height * 0.57} ${width * 0.02},${height * 0.35} ${width * 0.39},${height * 0.35}`;
    default:
      return null;
  }
}

function parseSvgPoints(points: string): { x: number; y: number }[] {
  return points
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(",");
      return { x: Number(x), y: Number(y) };
    })
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function getRayPolygonIntersection(
  center: { x: number; y: number },
  toward: { x: number; y: number },
  points: { x: number; y: number }[],
): { x: number; y: number } {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) return center;

  let bestT = Number.POSITIVE_INFINITY;
  let bestPoint = center;
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const edgeX = end.x - start.x;
    const edgeY = end.y - start.y;
    const denominator = (dx * edgeY) - (dy * edgeX);
    if (Math.abs(denominator) < 0.0001) continue;
    const offsetX = start.x - center.x;
    const offsetY = start.y - center.y;
    const t = ((offsetX * edgeY) - (offsetY * edgeX)) / denominator;
    const u = ((offsetX * dy) - (offsetY * dx)) / denominator;
    if (t >= 0 && u >= 0 && u <= 1 && t < bestT) {
      bestT = t;
      bestPoint = {
        x: center.x + dx * t,
        y: center.y + dy * t,
      };
    }
  }
  return bestPoint;
}

export function getCanvasNodeBoundaryPoint(
  shape: PostgresObjectTypeShape,
  bounds: { x: number; y: number; width: number; height: number },
  toward: { x: number; y: number },
): { x: number; y: number } {
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) return center;

  if (shape === "rounded") {
    const radiusX = bounds.width / 2;
    const radiusY = bounds.height / 2;
    const scale = 1 / Math.sqrt(((dx * dx) / (radiusX * radiusX)) + ((dy * dy) / (radiusY * radiusY)));
    return {
      x: center.x + dx * scale,
      y: center.y + dy * scale,
    };
  }

  const polygonPoints = getSvgShapePoints(shape, bounds.width, bounds.height);
  const points = parseSvgPoints(
    polygonPoints ?? `0,0 ${bounds.width},0 ${bounds.width},${bounds.height} 0,${bounds.height}`,
  ).map((point) => ({
    x: bounds.x + point.x,
    y: bounds.y + point.y,
  }));
  return getRayPolygonIntersection(center, toward, points);
}

export function renderSvgObjectShape(
  shape: PostgresObjectTypeShape,
  width: number,
  height: number,
  color: string,
  outlineColor: string,
  fill: PostgresObjectFill,
  sourceVisualKey: PostgresSourceObjectVisualKey | null = null,
  fillTransparency = 0,
  outlineWidth = 2,
): string {
  const strokeWidth = Math.max(1, Math.min(10, outlineWidth));
  if (sourceVisualKey) {
    const iconColor = color;
    let iconMarkup: string;
    switch (sourceVisualKey) {
      case "source_text":
        iconMarkup = [
          `<path d="M12 22h6a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v6" />`,
          `<path d="M14 2v5a1 1 0 0 0 1 1h5" />`,
          `<path d="M3 16v-1.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 .5.5V16" />`,
          `<path d="M6 22h2" />`,
          `<path d="M7 14v8" />`,
        ].join("");
        break;
      case "source_processed_transcript":
        iconMarkup = [
          `<path d="M15 8a1 1 0 0 1-1-1V2a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8z" />`,
          `<path d="M20 8v12a2 2 0 0 1-2 2h-4.182" />`,
          `<path d="m3.305 19.53.923-.382" />`,
          `<path d="M4 10.592V4a2 2 0 0 1 2-2h8" />`,
          `<path d="m4.228 16.852-.924-.383" />`,
          `<path d="m5.852 15.228-.383-.923" />`,
          `<path d="m5.852 20.772-.383.924" />`,
          `<path d="m8.148 15.228.383-.923" />`,
          `<path d="m8.53 21.696-.382-.924" />`,
          `<path d="m9.773 16.852.922-.383" />`,
          `<path d="m9.773 19.148.922.383" />`,
          `<circle cx="7" cy="18" r="3" />`,
        ].join("");
        break;
      case "source_pdf":
        iconMarkup = [
          `<path d="M14 22h4a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v6" />`,
          `<path d="M14 2v5a1 1 0 0 0 1 1h5" />`,
          `<path d="M5 14a1 1 0 0 0-1 1v2a1 1 0 0 1-1 1 1 1 0 0 1 1 1v2a1 1 0 0 0 1 1" />`,
          `<path d="M9 22a1 1 0 0 0 1-1v-2a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-2a1 1 0 0 0-1-1" />`,
        ].join("");
        break;
      case "source_audio":
        iconMarkup = [
          `<path d="M4 11.55V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2h-1.95" />`,
          `<path d="M14 2v5a1 1 0 0 0 1 1h5" />`,
          `<path d="M12 15a5 5 0 0 1 0 6" />`,
          `<path d="M8 14.502a.5.5 0 0 0-.826-.381l-1.893 1.631a1 1 0 0 1-.651.243H3.5a.5.5 0 0 0-.5.501v3.006a.5.5 0 0 0 .5.501h1.129a1 1 0 0 1 .652.243l1.893 1.633a.5.5 0 0 0 .826-.38z" />`,
        ].join("");
        break;
      case "source_video":
        iconMarkup = [
          `<path d="M4 12V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2" />`,
          `<path d="M14 2v5a1 1 0 0 0 1 1h5" />`,
          `<path d="m10 17.843 3.033-1.755a.64.64 0 0 1 .967.56v4.704a.65.65 0 0 1-.967.56L10 20.157" />`,
          `<rect width="7" height="6" x="3" y="16" rx="1" />`,
        ].join("");
        break;
      case "source_image":
        iconMarkup = [
          `<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />`,
          `<path d="M14 2v5a1 1 0 0 0 1 1h5" />`,
          `<circle cx="10" cy="12" r="2" />`,
          `<path d="m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22" />`,
        ].join("");
        break;
    }
    return `<g transform="scale(${width / 24} ${height / 24})" fill="none" stroke="${iconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconMarkup}</g>`;
  }
  const fillColor = fill === "filled" ? hexToRgba(color, 1 - (Math.max(0, Math.min(100, fillTransparency)) / 100)) : "transparent";
  const points = getSvgShapePoints(shape, width, height);
  if (points) {
    return `<polygon points="${points}" fill="${fillColor}" stroke="${outlineColor}" stroke-width="${strokeWidth}" />`;
  }
  if (shape === "rectangle") {
    return `<rect x="${strokeWidth / 2}" y="${strokeWidth / 2}" width="${Math.max(0, width - strokeWidth)}" height="${Math.max(0, height - strokeWidth)}" fill="${fillColor}" stroke="${outlineColor}" stroke-width="${strokeWidth}" />`;
  }
  if (shape === "rounded") {
    const radius = Math.max(0, (Math.min(width, height) / 2) - strokeWidth / 2);
    return `<circle cx="${width / 2}" cy="${height / 2}" r="${radius}" fill="${fillColor}" stroke="${outlineColor}" stroke-width="${strokeWidth}" />`;
  }
  return `<rect x="${strokeWidth / 2}" y="${strokeWidth / 2}" width="${Math.max(0, width - strokeWidth)}" height="${Math.max(0, height - strokeWidth)}" rx="${Math.min(22, height / 3)}" ry="${Math.min(22, height / 3)}" fill="${fillColor}" stroke="${outlineColor}" stroke-width="${strokeWidth}" />`;
}
